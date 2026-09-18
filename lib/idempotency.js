// Idempotency foundation (Phase 6).
// Header `Idempotency-Key` pada POST /api/keys, POST /api/keys/:id/rotate,
// POST /api/webhooks. Perilaku:
//  - key scoped per user (unique (user_id, idem_key))
//  - fingerprint SHA-256 dari endpoint + raw body: key sama + body beda → 409 IDEMPOTENCY_CONFLICT
//  - replay (key + fingerprint sama) → respons TERSIMPAN dikembalikan persis
//  - retention 24 jam, cleanup bounded (dipanggil fire-and-forget)
// Tidak ada Redis. Storage = PostgreSQL.
const crypto = require('crypto');
const db = require('./db');

const RETENTION_HOURS = 24;
const MAX_KEY_LEN = 255;
const KEY_RE = /^[A-Za-z0-9._~-]{8,255}$/;

function fingerprint(userId, endpoint, rawBody) {
  return crypto.createHash('sha256')
    .update(`${userId}|${endpoint}|${rawBody || ''}`)
    .digest('hex');
}

/**
 * Middleware factory. `store` = fungsi async(req) yang mengembalikan
 * { status, body } — hanya dipanggil pada request BARU.
 */
function withIdempotency(store) {
  return async (req, res) => {
    const key = req.headers['idempotency-key'];
    const fp = fingerprint(req.user.id, req.baseUrl + req.path, req.rawBody || '');
    if (key !== undefined) {
      if (typeof key !== 'string' || !KEY_RE.test(key)) {
        return res.status(400).json({ message: 'Idempotency-Key: 8..255 karakter [A-Za-z0-9._~-]' });
      }
      // Replay / conflict check
      try {
        const { rows } = await db.query(
          `select request_fingerprint, response_status, response_body
             from idempotency_keys where user_id = $1 and idem_key = $2 and expires_at > now()`,
          [req.user.id, key]
        );
        if (rows.length) {
          const prev = rows[0];
          if (prev.request_fingerprint !== fp) {
            return res.status(409).json({
              message: 'Idempotency-Key sudah dipakai untuk payload berbeda.',
            });
          }
          return res.status(prev.response_status).json(prev.response_body);
        }
      } catch (err) {
        console.error('[idempotency lookup]', err.message);
        // Fallback: jalan tanpa idempotency (fail-open) — lebih baik daripada gagal total.
      }
    }

    // Capture raw body utk fingerprint sebelum parser konsumsi stream sudah terjadi
    // (rawBody diisi oleh middleware rawBodyCapture di app.js).
    const result = await store(req);

    if (key && result && result.status < 500) {
      // Fire-and-forget: simpan respons untuk replay. Kegagalan tidak menggagalkan request.
      db.query(
        `insert into idempotency_keys
           (user_id, idem_key, request_fingerprint, endpoint, response_status, response_body, expires_at)
         values ($1,$2,$3,$4,$5,$6, now() + interval '${RETENTION_HOURS} hours')
         on conflict (user_id, idem_key) do nothing`,
        [req.user.id, key, fp, req.baseUrl + req.path, result.status, JSON.stringify(result.body || {})]
      ).catch((err) => console.error('[idempotency store]', err.message));
      db.query(
        `delete from idempotency_keys where expires_at < now()`
      ).catch(() => {});
    }
    return res.status(result.status).json(result.body);
  };
}

module.exports = { withIdempotency, fingerprint, RETENTION_HOURS, KEY_RE };
