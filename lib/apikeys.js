// API key service.
//
// Format key: lcode_live_<32 byte base64url> — prefix "lcode_live_" bikin
// key gampang dibedakan dari JWT di Authorization header, dan mudah
// dikenali kalau bocor di log/user.
//
// Penyimpanan: SHA-256 hash + prefix 14 char. Raw key HANYA muncul sekali,
// di respons POST /api/keys.
//
// Scopes (minimal, tanpa wildcard):
//   downloads:read  — /api/download/*
//   profile:read    — GET /api/auth/me
//   profile:write   — PUT /api/auth/me
// Admin/user management TIDAK pernah bisa lewat API key.
const crypto = require('crypto');
const db = require('./db');

const PREFIX_LIVE = 'lcode_live_';
const MAX_ACTIVE_KEYS_PER_USER = 10;

// Scope → validator keandalan
const VALID_SCOPES = new Set(['downloads:read', 'profile:read', 'profile:write']);

function isValidScope(s) {
  return VALID_SCOPES.has(s);
}

/** Key mentah baru. Balikin { raw, prefix, hash }. */
function generateKey() {
  const raw = PREFIX_LIVE + crypto.randomBytes(32).toString('base64url');
  return {
    raw,
    prefix: raw.slice(0, PREFIX_LIVE.length + 6), // lcode_live_ + 6 char
    hash: hashKey(raw),
  };
}

function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

/** Apakah string ini berbentuk API key kita (vs JWT)? */
function looksLikeApiKey(credential) {
  return typeof credential === 'string' && credential.startsWith(PREFIX_LIVE);
}

/**
 * Autentikasi API key: lookup by hash (indexed), cek revoked & expired,
 * balikin owner + scopes. Null kalau nggak valid.
 */
async function authenticate(rawKey) {
  if (!looksLikeApiKey(rawKey)) return null;
  const h = hashKey(rawKey);
  const { rows } = await db.query(
    `select k.id, k.user_id, k.scopes, k.expires_at, k.revoked_at, k.last_used_at,
            u.email, u.role
     from api_keys k join users u on u.id = k.user_id
     where k.key_hash = $1`,
    [h]
  );
  const key = rows[0];
  if (!key) return null;
  if (key.revoked_at) return null;
  if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

  return {
    keyId: key.id,
    userId: key.user_id,
    email: key.email,
    role: key.role === 'admin' ? 'admin' : 'user',
    scopes: Array.isArray(key.scopes) ? key.scopes : [],
    lastUsedAt: key.last_used_at,
  };
}

/**
 * Update last_used_at — throttled in-process 60 dtk per key (serverless:
 * hindari write tiap request; throttle lokal cukup efektif, worst case
 * beberapa write ekstra per window).
 */
const lastTouch = new Map();
async function touchKey(keyId) {
  const now = Date.now();
  if (now - (lastTouch.get(keyId) || 0) < 60_000) return;
  lastTouch.set(keyId, now);
  if (lastTouch.size > 10_000) {
    for (const [k, v] of lastTouch) if (now - v > 300_000) lastTouch.delete(k);
  }
  await db.query(`update api_keys set last_used_at = now() where id = $1`, [keyId]).catch(() => {});
}

/** List key milik user — TANPA hash/raw. */
async function listKeys(userId) {
  const { rows } = await db.query(
    `select id, name, key_prefix as prefix, scopes, created_at, expires_at, last_used_at
     from api_keys where user_id = $1 and revoked_at is null
     order by created_at desc`,
    [userId]
  );
  return rows;
}

/** Jumlah key aktif (untuk cap). */
async function countActive(userId) {
  const { rows } = await db.query(
    `select count(*)::int as n from api_keys where user_id = $1 and revoked_at is null`,
    [userId]
  );
  return rows[0].n;
}

/** Revoke (anti-IDOR: selalu scoping user_id). */
async function revokeKey(keyId, userId) {
  const { rowCount } = await db.query(
    `update api_keys set revoked_at = now()
     where id = $1 and user_id = $2 and revoked_at is null`,
    [keyId, userId]
  );
  return rowCount > 0;
}

module.exports = {
  generateKey, hashKey, looksLikeApiKey, authenticate, touchKey,
  listKeys, countActive, revokeKey, isValidScope,
  MAX_ACTIVE_KEYS_PER_USER,
};
