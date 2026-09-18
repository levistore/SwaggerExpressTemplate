// Audit trail — catat event keamanan ke audit_logs.
//
// ATURAN KERAS: metadata TIDAK PERNAH berisi password, token, refresh
// token, API key, atau kredensial apa pun. Field yang dilarang dibuang
// di sini (defence in depth) — pemanggil tidak perlu berpikir dua kali,
// tapi tetap jangan lempar secret.
//
// Logging audit TIDAK BOLEH bikin request gagal: semua error ditelan
// dan hanya muncul sebagai log peringatan.
const db = require('./db');
const log = require('./logger');

const FORBIDDEN_META_KEYS = new Set([
  'password', 'currentpassword', 'newpassword', 'token', 'refreshtoken',
  'accesstoken', 'authorization', 'apikey', 'key', 'secret', 'emailtoken',
  'resettoken', 'verificationtoken',
]);

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META_KEYS.has(k.toLowerCase())) continue;
    // jangan simpan string raksasa
    out[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) : v;
  }
  return out;
}

/**
 * Catat event audit. Semua argumen opsional kecuali action.
 * @param {object} opts
 * @param {number} [opts.actorUserId]  user pelaku (null utk anonymous, mis. login gagal)
 * @param {string} opts.action         mis. LOGIN_SUCCESS, API_KEY_CREATED
 * @param {string} [opts.targetType]   mis. 'user', 'api_key', 'session'
 * @param {string|number} [opts.targetId]
 * @param {object} [opts.req]          request Express (request_id, ip, ua diambil otomatis)
 * @param {object} [opts.metadata]     data tambahan aman (sudah disanitasi)
 */
async function audit({ actorUserId = null, action, targetType = null, targetId = null, req = null, metadata = {} }) {
  if (!action) return;
  try {
    await db.query(
      `insert into audit_logs (actor_user_id, action, target_type, target_id, request_id, ip_address, user_agent, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        actorUserId,
        String(action).slice(0, 64),
        targetType ? String(targetType).slice(0, 32) : null,
        targetId !== null && targetId !== undefined ? String(targetId).slice(0, 64) : null,
        req && req.id ? String(req.id).slice(0, 64) : null,
        req ? String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64) || null : null,
        req ? String(req.headers['user-agent'] || '').slice(0, 200) || null : null,
        JSON.stringify(sanitizeMeta(metadata)),
      ]
    );
  } catch (err) {
    // Audit gagal ≠ request gagal, tapi harus kelihatan.
    log.error('audit_write_failed', { action, error: err.message });
  }
}

module.exports = { audit };
