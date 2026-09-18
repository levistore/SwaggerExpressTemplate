// Developer dashboard endpoints (Phase 4) — /api/v1/dashboard/*
//
// SEMUA data user-scoped (req.user.id dari requireAuth — JWT atau API key).
// Tidak ada parameter user_id dari luar: cross-user access mustahil by design.
// SQL terparameterisasi; pagination + validation; respons lewat envelope v1.
//
// Sumber data: api_usage (Phase 3) + audit_logs (Phase 2E) + api_keys (2D).
// Tidak ada secret yang dikembalikan — key prefix saja, hash/raw tidak pernah keluar.
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { cleanId } = require('../lib/validate');

router.use(requireAuth);
// Dashboard = read-heavy tapi murah (aggregate SQL); 60/m per IP cukup longgar,
// tetap di bawah global 300/m.
router.use(rateLimit(60, { scope: 'dashboard' }));

// Range yang diizinkan (jam) — default 24h.
const RANGES = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

function rangeHours(v) {
  if (v === undefined || v === null || v === '') return RANGES['24h'];
  return RANGES[String(v)] || null;
}

/**
 * @swagger
 * /api/v1/dashboard/overview:
 *   get:
 *     summary: Ringkasan dashboard developer (data milik user sendiri)
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Total requests, requests hari ini, kuota harian, key aktif, recent requests, recent activity, versi API }
 *       401: { description: Tidak terautentikasi }
 */
router.get('/overview', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const [totals, today, keys, recent, activity] = await Promise.all([
      db.query(`select count(*)::int as n from api_usage where user_id = $1`, [uid]),
      db.query(
        `select count(*)::int as n from api_usage
         where user_id = $1 and created_at >= date_trunc('day', now())`, [uid]),
      db.query(
        `select count(*)::int as n from api_keys where user_id = $1 and revoked_at is null`, [uid]),
      db.query(
        `select method, route, status_code, duration_ms, request_id, created_at
         from api_usage where user_id = $1 order by created_at desc limit 8`, [uid]),
      db.query(
        `select action, target_type, target_id, created_at from audit_logs
         where actor_user_id = $1 order by created_at desc limit 8`, [uid]),
    ]);

    // Quota harian: agregat dari key aktif milik user (default kode 1000/key).
    // Kuota efektif user = jumlah daily_quota semua key aktif.
    const { rows: qrows } = await db.query(
      `select coalesce(sum(coalesce(daily_quota, 1000)), 0)::int as quota
       from api_keys where user_id = $1 and revoked_at is null`, [uid]);

    return res.json({
      api_version: 'v1',
      totals: {
        requests: totals.rows[0].n,
        requests_today: today.rows[0].n,
        daily_quota: qrows[0].quota,
        active_api_keys: keys.rows[0].n,
      },
      recent_requests: recent.rows,
      recent_activity: activity.rows,
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/dashboard/usage:
 *   get:
 *     summary: Analitik usage milik sendiri (range 24h / 7d / 30d)
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: range
 *         schema: { type: string, enum: [24h, 7d, 30d], default: 24h }
 *     responses:
 *       200: { description: Distribusi status, endpoint teratas, seri harian, durasi rata-rata }
 *       400: { description: Range tidak valid }
 *       401: { description: Tidak terautentikasi }
 */
router.get('/usage', async (req, res, next) => {
  const hours = rangeHours(req.query.range);
  if (!hours) {
    return res.status(400).json({ code: 'INVALID_RANGE', message: 'range harus 24h, 7d, atau 30d' });
  }
  try {
    const uid = req.user.id;
    const since = `now() - ($2 || ' hours')::interval`;
    const params = [uid, String(hours)];

    const [status, endpoints, daily, total] = await Promise.all([
      db.query(
        `select status_code, count(*)::int as n from api_usage
         where user_id = $1 and created_at >= ${since} group by status_code order by status_code`, params),
      db.query(
        `select route, count(*)::int as n, round(avg(duration_ms))::int as avg_ms
         from api_usage where user_id = $1 and created_at >= ${since}
         group by route order by n desc limit 10`, params),
      db.query(
        `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as n
         from api_usage where user_id = $1 and created_at >= ${since}
         group by 1 order by 1`, params),
      db.query(
        `select count(*)::int as n, coalesce(round(avg(duration_ms)), 0)::int as avg_ms,
                count(*) filter (where status_code >= 400)::int as failures
         from api_usage where user_id = $1 and created_at >= ${since}`, params),
    ]);

    return res.json({
      range: hours === 24 ? '24h' : hours === 168 ? '7d' : '30d',
      total: total.rows[0].n,
      failures: total.rows[0].failures,
      avg_duration_ms: total.rows[0].avg_ms,
      status_distribution: status.rows,
      top_endpoints: endpoints.rows,
      daily: daily.rows,
    });
  } catch (err) { next(err); }
});

/**
 * @swagger
 * /api/v1/dashboard/requests:
 *   get:
 *     summary: Riwayat request milik sendiri (pagination + filter)
 *     tags: [Dashboard]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, default: 25, maximum: 100 } }
 *       - { in: query, name: offset, schema: { type: integer, default: 0 } }
 *       - { in: query, name: status, schema: { type: string, enum: [success, error] } }
 *       - { in: query, name: endpoint, schema: { type: string }, description: substring route }
 *       - { in: query, name: range, schema: { type: string, enum: [24h, 7d, 30d] } }
 *     responses:
 *       200: { description: Daftar request non-sensitif (tanpa header/credential apa pun) }
 *       401: { description: Tidak terautentikasi }
 */
router.get('/requests', async (req, res, next) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const hours = rangeHours(req.query.range);
  if (!hours) {
    return res.status(400).json({ code: 'INVALID_RANGE', message: 'range harus 24h, 7d, atau 30d' });
  }
  const where = ['user_id = $1', `created_at >= now() - ($2 || ' hours')::interval`];
  const vals = [req.user.id, String(hours)];
  if (req.query.status === 'success') where.push('status_code < 400');
  else if (req.query.status === 'error') where.push('status_code >= 400');
  if (req.query.endpoint) {
    vals.push(String(req.query.endpoint).slice(0, 120));
    where.push(`route ilike '%' || $${vals.length} || '%'`);
  }
  const whereSql = 'where ' + where.join(' and ');
  try {
    const [rows, cnt] = await Promise.all([
      db.query(
        `select id, method, route, status_code, duration_ms, platform, request_id, created_at
         from api_usage ${whereSql}
         order by created_at desc limit ${limit} offset ${offset}`, vals),
      db.query(`select count(*)::int as n from api_usage ${whereSql}`, vals),
    ]);
    return res.json({ total: cnt.rows[0].n, limit, offset, requests: rows.rows });
  } catch (err) { next(err); }
});

module.exports = router;
