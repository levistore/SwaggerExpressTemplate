// Ops observability (Phase 7) — operational summary untuk dashboard.
// Semua data user-scoped (anti-IDOR): req.user.id selalu sumber filter.
// Range bounded: 24h / 7d / 30d — TANPA arbitrary date input dari client.
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const metrics = require('../lib/metrics');

router.use(requireAuth);
router.use(rateLimit(60, { scope: 'dashboard' }));

const RANGES = { '24h': 1, '7d': 7, '30d': 30 };

/**
 * @swagger
 * /api/v1/ops/summary:
 *   get:
 *     summary: Ringkasan operasional user (traffic, error, latensi, provider, webhook)
 *     tags: [Ops]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: range
 *         schema: { type: string, enum: [24h, 7d, 30d], default: 24h }
 *     responses:
 *       200:
 *         description: Metrics terkonsolidasi (instance-local untuk bagian in-memory)
 *       400: { description: range tidak valid }
 */
router.get('/summary', async (req, res) => {
  const range = RANGES[req.query.range] !== undefined ? req.query.range : '24h';
  if (req.query.range && RANGES[req.query.range] === undefined) {
    return res.status(400).json({ message: 'range harus 24h, 7d, atau 30d.' });
  }
  const days = RANGES[range];
  const uid = req.user.id;
  const since = `now() - interval '${days} days'`;

  // Bounded, parameterized, user-scoped. Agregasi di DB — bukan per-row ke memori.
  const [traffic, byStatus, byRoute, webhookAgg, latency] = await Promise.all([
    db.query(
      `select count(*)::int as n from api_usage where user_id = $1 and created_at >= ${since}`,
      [uid]
    ),
    db.query(
      `select status_code, count(*)::int as n from api_usage
        where user_id = $1 and created_at >= ${since} group by status_code order by n desc`,
      [uid]
    ),
    db.query(
      `select route, count(*)::int as n, round(avg(duration_ms))::int as avg_ms
         from api_usage where user_id = $1 and created_at >= ${since}
        group by route order by n desc limit 10`,
      [uid]
    ),
    db.query(
      `select count(*)::int as total,
              count(*) filter (where ok) as success,
              count(*) filter (where not ok) as failed,
              round(avg(duration_ms))::int as avg_ms
         from webhook_deliveries d join webhooks w on w.id = d.webhook_id
        where w.user_id = $1 and d.created_at >= ${since}`,
      [uid]
    ),
    db.query(
      `select round(avg(duration_ms))::int as avg_ms,
              percentile_cont(0.95) within group (order by duration_ms)::int as p95_ms
         from api_usage where user_id = $1 and created_at >= ${since} and duration_ms is not null`,
      [uid]
    ),
  ]);

  const providerHealth = require('../lib/resilience').healthSnapshot();
  // Sanitasi: hanya counter/latency/circuit — tanpa URL internal/credential.
  const providers = Object.fromEntries(
    Object.entries(providerHealth).map(([name, h]) => [name, {
      total: h.total, success: h.success, failures: h.failures, timeouts: h.timeout,
      avg_ms: h.avg_ms, circuit: h.state || 'closed',
    }])
  );

  return res.json({
    range,
    traffic: {
      total: traffic.rows[0].n,
      success_rate: traffic.rows[0].n
        ? Math.round(((traffic.rows[0].n - (byStatus.rows.find((r) => r.status_code >= 400) || { n: 0 }).n) / traffic.rows[0].n) * 1000) / 10
        : null,
      by_status: Object.fromEntries(byStatus.rows.map((r) => [r.status_code, r.n])),
      top_endpoints: byRoute.rows,
      latency: { avg_ms: latency.rows[0].avg_ms, p95_ms: latency.rows[0].p95_ms },
    },
    webhooks: webhookAgg.rows[0].total
      ? webhookAgg.rows[0]
      : { total: 0, success: 0, failed: 0, avg_ms: null },
    providers,
    realtime: metrics.snapshot(),
  });
});

module.exports = router;
