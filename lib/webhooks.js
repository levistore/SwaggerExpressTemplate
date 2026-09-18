// Webhook foundation (Phase 6).
// - Secret: 32-byte base64url, hash SHA-256 tersimpan (pola API keys). Raw hanya
//   ditampilkan sekali saat create/rotate.
// - Signature: HMAC-SHA256 atas RAW body, header `X-LCODE-Signature: sha256=<hex>`,
//   plus `X-LCODE-Event-Id` untuk dedup client (delivery at-least-once — didokumentasikan).
// - Outbound: lewat lib/resilience.providerFetch (timeout ketat, retry transient-only,
//   circuit breaker instance-local) + lib/ssrf.assertSafePublicUrl (HTTPS wajib,
//   redirect manual — tidak mengikuti redirect otomatis).
// - Serverless reality: delivery sinkron setelah aksi user (fire-and-forget dari
//   request handler). TIDAK ada queue enterprise — didokumentasikan sebagai batasan.
const crypto = require('crypto');
const db = require('./db');
const ssrf = require('./ssrf');
const resilience = require('./resilience');

const EVENTS = ['API_KEY_CREATED', 'API_KEY_ROTATED', 'API_KEY_REVOKED', 'SESSION_REVOKED'];
const MAX_WEBHOOKS_PER_USER = 10;

function generateSecret() {
  const raw = 'whsec_' + crypto.randomBytes(32).toString('base64url');
  return { raw, prefix: raw.slice(0, 11), hash: crypto.createHash('sha256').update(raw).digest('hex') };
}

function hashSecret(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function signPayload(secretRaw, rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', secretRaw).update(rawBody).digest('hex');
}

function isValidEvent(e) {
  return EVENTS.includes(e);
}

function isValidUrl(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:';
  } catch { return false; }
}

/**
 * Kirim event ke semua webhook aktif user yang subscribe event tsb.
 * Fire-and-forget — TIDAK PERNAH menggagalkan request sumber.
 */
function dispatch(userId, eventType, data) {
  if (!EVENTS.includes(eventType)) return;
  const eventId = 'evt_' + crypto.randomBytes(12).toString('base64url');
  const payload = JSON.stringify({
    id: eventId,
    type: eventType,
    created_at: new Date().toISOString(),
    data: data || {},
  });
  // Fire-and-forget async
  (async () => {
    try {
      const { rows } = await db.query(
        `select id, url, secret_hash from webhooks where user_id = $1 and active = true and $2 = any(events)`,
        [userId, eventType]
      );
      for (const hook of rows) {
        // secret_hash = SHA-256(secret) tidak bisa dipakai HMAC — kita butuh raw.
        // Solusi aman: HMAC key = secret hash? TIDAK — kita simpan HMAC key terpisah?
        // Keputusan: signature dihitung dengan HMAC key = SHA-256 digest (hex) itu sendiri,
        // dan verifikasi client memakai raw secret → tidak cocok.
        // Oleh karena itu: signature memakai key = secret_hash (dokumentasikan: verify
        // dengan `sha256hex(secret)` sebagai key). Raw secret tetap tidak tersimpan.
        const sig = signPayload(hook.secret_hash, payload);
        let ok = false, status = null, category = null, t0 = Date.now();
        try {
          await ssrf.assertSafePublicUrl(hook.url);
          const res = await resilience.providerFetch('webhook', hook.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-lcode-signature': sig,
              'x-lcode-event-id': eventId,
              'x-lcode-event-type': eventType,
            },
            body: payload,
          }, { timeoutMs: 8000, retries: 1 });
          status = res ? res.status : null;
          ok = !!status && status >= 200 && status < 300;
          if (!ok) category = resilience.ERR.BAD_RESPONSE;
        } catch (err) {
          category = err.code || 'WEBHOOK_FAILED';
        }
        await db.query(
          `insert into webhook_deliveries (webhook_id, event_id, event_type, status, ok, error_category, duration_ms)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (event_id) do nothing`,
          [hook.id, eventId, eventType, status, ok, category, Date.now() - t0]
        );
        await db.query(
          `update webhooks set last_status = $2, last_failure_at = case when $3 then last_failure_at else now() end,
             failure_count = failure_count + case when $3 then 0 else 1 end, updated_at = now()
           where id = $1`,
          [hook.id, status, ok]
        );
      }
    } catch (err) {
      console.error('[webhook dispatch]', err.message);
    }
  })();
  return eventId;
}

module.exports = {
  generateSecret, hashSecret, signPayload, dispatch,
  isValidEvent, isValidUrl, EVENTS, MAX_WEBHOOKS_PER_USER,
};
