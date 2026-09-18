// Webhook management routes (Phase 6). User-scoped, anti-IDOR.
// Secret raw hanya muncul sekali saat create/rotate (pola API keys).
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const webhooks = require('../lib/webhooks');
const { ValidationError, cleanString, cleanId } = require('../lib/validate');


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function cleanUuid(raw) {
  const s = String(raw || '');
  return UUID_RE.test(s) ? s : null;
}

router.use(requireAuth);
router.use(rateLimit(30, { scope: 'webhooks' }));

/**
 * @swagger
 * /api/webhooks:
 *   get:
 *     summary: Daftar webhook milik user (tanpa secret)
 *     tags: [Webhooks]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Daftar webhook }
 */
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `select id, url, events, active, secret_prefix as secret_prefix, failure_count, last_status, last_failure_at, created_at, updated_at
       from webhooks where user_id = $1 order by created_at desc`,
    [req.user.id]
  );
  return res.json(rows);
});

/**
 * @swagger
 * /api/webhooks:
 *   post:
 *     summary: Buat webhook (secret raw hanya ditampilkan sekali)
 *     tags: [Webhooks]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [url, events]
 *             properties:
 *               url: { type: string, example: "https://example.com/hooks/lcode" }
 *               events: { type: array, items: { type: string, enum: [API_KEY_CREATED, API_KEY_ROTATED, API_KEY_REVOKED, SESSION_REVOKED] } }
 *     responses:
 *       201: { description: Webhook dibuat, termasuk secret raw sekali-lihat }
 *       400: { description: Input tidak valid / URL tidak aman }
 *       409: { description: Maksimal webhook tercapai }
 */
router.post('/', async (req, res) => {
  let url, events;
  try {
    url = cleanString(req.body && req.body.url, { field: 'URL', max: 2048 });
    events = req.body && req.body.events;
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ message: e.message });
    throw e;
  }
  if (!webhooks.isValidUrl(url)) {
    return res.status(400).json({ message: 'URL harus HTTPS dan berupa endpoint path root (tanpa query).' });
  }
  if (!Array.isArray(events) || events.length === 0 || !events.every(webhooks.isValidEvent)) {
    return res.status(400).json({ message: `events harus array dari: ${webhooks.EVENTS.join(', ')}` });
  }
  events = [...new Set(events)];
  const active = await db.query(`select count(*)::int as n from webhooks where user_id = $1`, [req.user.id]);
  if (active.rows[0].n >= webhooks.MAX_WEBHOOKS_PER_USER) {
    return res.status(409).json({ message: `Maksimal ${webhooks.MAX_WEBHOOKS_PER_USER} webhook.` });
  }
  const { raw, prefix, hash } = webhooks.generateSecret();
  try {
    // SSRF check sebelum menyimpan — tolak private/loopback/metadata.
    await require('../lib/ssrf').assertSafePublicUrl(url);
  } catch (err) {
    return res.status(400).json({ message: 'URL tidak diizinkan (SSRF protection).' });
  }
  const { rows } = await db.query(
    `insert into webhooks (user_id, url, events, secret_prefix, secret_hash)
     values ($1,$2,$3,$4,$5)
     returning id, url, events, active, secret_prefix, created_at`,
    [req.user.id, url, events, prefix, hash]
  );
  require('../lib/audit').audit({ actorUserId: req.user.id, action: 'WEBHOOK_CREATED', targetType: 'webhook', targetId: rows[0].id, req, metadata: { events } });
  return res.status(201).json({ ...rows[0], secret: raw });
});

/**
 * @swagger
 * /api/webhooks/{id}:
 *   delete:
 *     summary: Hapus webhook milik sendiri
 *     tags: [Webhooks]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Terhapus }
 *       404: { description: Tidak ditemukan }
 */
router.delete('/:id', async (req, res) => {
  const id = cleanUuid(req.params.id);
  if (!id) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  const { rowCount } = await db.query(`delete from webhooks where id = $1 and user_id = $2`, [id, req.user.id]);
  if (!rowCount) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  require('../lib/audit').audit({ actorUserId: req.user.id, action: 'WEBHOOK_DELETED', targetType: 'webhook', targetId: id, req });
  return res.status(204).end();
});

/**
 * @swagger
 * /api/webhooks/{id}:
 *   patch:
 *     summary: Update webhook (aktif/nonaktif, events)
 *     tags: [Webhooks]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Webhook diperbarui }
 *       400: { description: Input tidak valid }
 *       404: { description: Tidak ditemukan }
 */
router.patch('/:id', async (req, res) => {
  const id = cleanUuid(req.params.id);
  if (!id) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  const updates = [];
  const params = [req.user.id, id];
  let body = req.body || {};
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') return res.status(400).json({ message: 'active harus boolean.' });
    params.push(body.active); updates.push(`active = $${params.length}`);
  }
  if (body.events !== undefined) {
    if (!Array.isArray(body.events) || body.events.length === 0 || !body.events.every(webhooks.isValidEvent)) {
      return res.status(400).json({ message: `events harus array dari: ${webhooks.EVENTS.join(', ')}` });
    }
    params.push([...new Set(body.events)]); updates.push(`events = $${params.length}`);
  }
  if (!updates.length) return res.status(400).json({ message: 'Tidak ada perubahan.' });
  const { rows, rowCount } = await db.query(
    `update webhooks set ${updates.join(', ')}, updated_at = now()
      where user_id = $1 and id = $2
      returning id, url, events, active, secret_prefix, failure_count, last_status, created_at, updated_at`,
    params
  );
  if (!rowCount) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  return res.json(rows[0]);
});

/**
 * @swagger
 * /api/webhooks/{id}/rotate:
 *   post:
 *     summary: Rotasi secret webhook (raw sekali-lihat)
 *     tags: [Webhooks]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Secret baru }
 *       404: { description: Tidak ditemukan }
 */
router.post('/:id/rotate', async (req, res) => {
  const id = cleanUuid(req.params.id);
  if (!id) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  const { raw, prefix, hash } = webhooks.generateSecret();
  const { rows, rowCount } = await db.query(
    `update webhooks set secret_prefix = $3, secret_hash = $4, updated_at = now()
      where user_id = $1 and id = $2
      returning id, secret_prefix`,
    [req.user.id, id, prefix, hash]
  );
  if (!rowCount) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  require('../lib/audit').audit({ actorUserId: req.user.id, action: 'WEBHOOK_ROTATED', targetType: 'webhook', targetId: id, req });
  return res.json({ id: rows[0].id, secret: raw });
});

/**
 * @swagger
 * /api/webhooks/{id}/test:
 *   post:
 *     summary: Kirim test delivery (event WEBHOOK_TEST tidak didispatch ke DB events — hanya ping delivery)
 *     tags: [Webhooks]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Hasil delivery }
 *       404: { description: Tidak ditemukan }
 */
// Webhook test = outbound request primitive → limiter lebih ketat (10/m).
const { rateLimit: _rl } = require('../lib/ratelimit');
router.post('/:id/test', _rl(10, { scope: 'webhook_test' }), async (req, res) => {
  const id = cleanUuid(req.params.id);
  if (!id) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  const { rows } = await db.query(
    `select id, url, events from webhooks where user_id = $1 and id = $2`,
    [req.user.id, id]
  );
  if (!rows.length) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  const eventId = require('crypto').randomBytes(12).toString('base64url');
  const payload = JSON.stringify({ id: 'evt_' + eventId, type: 'WEBHOOK_TEST', created_at: new Date().toISOString(), data: { webhook_id: rows[0].id } });
  const sig = webhooks.signPayload((await db.query(`select secret_hash from webhooks where id = $1`, [id])).rows[0].secret_hash, payload);
  let ok = false, status = null, category = null;
  const t0 = Date.now();
  try {
    await require('../lib/ssrf').assertSafePublicUrl(rows[0].url);
    const r = await require('../lib/resilience').providerFetch('webhook', rows[0].url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lcode-signature': sig, 'x-lcode-event-id': 'evt_' + eventId, 'x-lcode-event-type': 'WEBHOOK_TEST' },
      body: payload,
    }, { timeoutMs: 8000, retries: 0 });
    status = r ? r.status : null;
    ok = !!status && status >= 200 && status < 300;
  } catch (err) { category = err.code || 'WEBHOOK_FAILED'; }
  require('../lib/metrics').recordWebhookDelivery({ ok, retry: false, durationMs: Date.now() - t0 });
  await db.query(
    `insert into webhook_deliveries (webhook_id, event_id, event_type, status, ok, error_category, duration_ms)
     values ($1,$2,'WEBHOOK_TEST',$3,$4,$5,$6) on conflict (event_id) do nothing`,
    [id, 'evt_' + eventId, status, ok, category, Date.now() - t0]
  );
  return res.json({ delivered: ok, status, error_category: category, duration_ms: Date.now() - t0 });
});

/**
 * @swagger
 * /api/webhooks/{id}/deliveries:
 *   get:
 *     summary: Riwayat delivery webhook (20 terakhir)
 *     tags: [Webhooks]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Daftar delivery }
 *       404: { description: Tidak ditemukan }
 */
router.get('/:id/deliveries', async (req, res) => {
  const id = cleanUuid(req.params.id);
  if (!id) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  const own = await db.query(`select 1 from webhooks where user_id = $1 and id = $2`, [req.user.id, id]);
  if (!own.rowCount) return res.status(404).json({ message: 'Webhook tidak ditemukan.' });
  const { rows } = await db.query(
    `select event_id, event_type, status, ok, error_category, duration_ms, created_at
       from webhook_deliveries where webhook_id = $1 order by created_at desc limit 20`,
    [id]
  );
  return res.json(rows);
});

module.exports = router;
