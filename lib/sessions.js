// Session & refresh token service.
//
// Refresh token: opaque, 48 byte random (base64url, ~256 bit entropy).
// Database hanya menyimpan SHA-256 hash-nya — DB bocor ≠ token bisa dipakai.
//
// Rotation: setiap POST /api/auth/refresh memutar token. Token lama
// ditandai revoked dan sesi barunya dibuat dalam family yang sama.
// Kalau token yang sudah revoked dipakai lagi → tanda token dicuri →
// SELURUH family di-revoke (reuse detection).
const crypto = require('crypto');
const db = require('./db');
const log = require('./logger');

const SESSION_TTL_DAYS = 30;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function newRefreshToken() {
  return crypto.randomBytes(48).toString('base64url');
}

function expiryDate() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Buat sesi baru (mis. saat login). Balikin { session, refreshToken }.
 * Raw token HANYA ada di return value ini — sekali terkirim, tak bisa
 * direkonstruksi dari DB.
 */
async function createSession(userId, { userAgent, ip } = {}) {
  const refreshToken = newRefreshToken();
  const { rows } = await db.query(
    `insert into sessions (user_id, token_hash, expires_at, user_agent, ip_address)
     values ($1, $2, $3, $4, $5)
     returning id, family_id, expires_at`,
    [userId, hashToken(refreshToken), expiryDate(),
     (userAgent || '').slice(0, 200) || null, (ip || '').slice(0, 64) || null]
  );
  return { session: rows[0], refreshToken };
}

/**
 * Rotasi: token lama (harus valid & aktif) → revoked, sesi baru dibuat
 * dengan family yang sama. Balikin { session, refreshToken, user_id }.
 * Throw { code } kalau token nggak valid/expired/revoked/reuse.
 */
async function rotateSession(rawToken, { userAgent, ip } = {}) {
  const h = hashToken(String(rawToken));
  const { rows } = await db.query(
    `select id, user_id, family_id, expires_at, revoked_at
     from sessions where token_hash = $1`,
    [h]
  );
  const old = rows[0];
  if (!old) {
    const e = new Error('Refresh token tidak valid.'); e.code = 'INVALID';
    throw e;
  }
  if (old.revoked_at) {
    // REUSE DETECTION — token sudah pernah dipakai/di-revoke. Anggap dicuri:
    // bunuh seluruh family supaya penyerang yang memegang token turunannya
    // juga kehilangan akses.
    await db.query(
      `update sessions set revoked_at = now()
       where family_id = $1 and revoked_at is null`,
      [old.family_id]
    );
    log.warn('refresh_token_reuse', { session_family: old.family_id, user_id: old.user_id });
    const e = new Error('Refresh token sudah dicabut (kemungkinan reuse). Semua sesi terkait direvoke.');
    e.code = 'REUSE';
    throw e;
  }
  if (new Date(old.expires_at) < new Date()) {
    const e = new Error('Refresh token kedaluwarsa.'); e.code = 'EXPIRED';
    throw e;
  }

  const refreshToken = newRefreshToken();
  const { rows: created } = await db.query(
    `insert into sessions (user_id, token_hash, family_id, expires_at, user_agent, ip_address)
     values ($1, $2, $3, $4, $5, $6)
     returning id, family_id, expires_at`,
    [old.user_id, hashToken(refreshToken), old.family_id, expiryDate(),
     (userAgent || '').slice(0, 200) || null, (ip || '').slice(0, 64) || null]
  );
  await db.query(
    `update sessions set revoked_at = now() where id = $1`,
    [old.id]
  );
  return { session: created[0], refreshToken, user_id: old.user_id };
}

/** Revoke satu sesi milik user tertentu (anti-IDOR: user_id selalu dicek). */
async function revokeSession(sessionId, userId) {
  const { rowCount } = await db.query(
    `update sessions set revoked_at = now()
     where id = $1 and user_id = $2 and revoked_at is null`,
    [sessionId, userId]
  );
  return rowCount > 0;
}

/** Revoke semua sesi milik user (logout-all / password reset). */
async function revokeAllSessions(userId, { exceptSessionId = null } = {}) {
  if (exceptSessionId) {
    const { rowCount } = await db.query(
      `update sessions set revoked_at = now()
       where user_id = $1 and revoked_at is null and id <> $2`,
      [userId, exceptSessionId]
    );
    return rowCount;
  }
  const { rowCount } = await db.query(
    `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`,
    [userId]
  );
  return rowCount;
}

/** Metadata sesi aktif — TANPA token/hash apa pun. */
async function listSessions(userId) {
  const { rows } = await db.query(
    `select id, created_at, expires_at, last_used_at, user_agent, ip_address
     from sessions
     where user_id = $1 and revoked_at is null and expires_at > now()
     order by created_at desc`,
    [userId]
  );
  return rows;
}

/**
 * Update last_used_at — throttled: maksimum sekali per 60 detik per sesi.
 * Menghindari DB write di tiap request (serverless performance).
 * Balikin true kalau update dilakukan.
 */
const lastTouch = new Map(); // sessionId -> ts (proses lokal, cukup sebagai throttle)
async function touchSession(sessionId) {
  const now = Date.now();
  const prev = lastTouch.get(sessionId) || 0;
  if (now - prev < 60_000) return false;
  lastTouch.set(sessionId, now);
  if (lastTouch.size > 10_000) {
    // jaga memori tetap kecil
    for (const [k, v] of lastTouch) if (now - v > 300_000) lastTouch.delete(k);
  }
  await db.query(`update sessions set last_used_at = now() where id = $1`, [sessionId]);
  return true;
}

/** Hapus sesi kedaluwarsa lama (dipanggil opsional/periodik). */
async function purgeExpired() {
  const { rowCount } = await db.query(
    `delete from sessions where expires_at < now() - interval '7 days'`
  );
  return rowCount;
}

module.exports = {
  createSession, rotateSession, revokeSession, revokeAllSessions,
  listSessions, touchSession, purgeExpired, hashToken,
  SESSION_TTL_DAYS,
};
