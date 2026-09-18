const { verifyToken } = require('../lib/auth');
const apikeys = require('../lib/apikeys');

/**
 * Middleware: butuh credential di header `Authorization: Bearer <x>`.
 *
 * Dual-mode (Phase 2D):
 *   - JWT access token  → req.auth = { type: 'jwt', user, scopes: ['*'] }
 *   - API key lcode_*    → req.auth = { type: 'api_key', user, scopes }
 *
 * req.user selalu diisi (id, email, role) supaya handler lama tetap jalan.
 * Untuk API key, role TIDAK dipakai — endpoint admin selalu butuh JWT
 * (requireAdmin menolak api_key), jadi admin panel tak bisa diakses key.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, credential] = header.split(' ');

  if (!credential || scheme.toLowerCase() !== 'bearer') {
    return res.status(401).json({
      message: 'Missing bearer token. Kirim header: Authorization: Bearer ***',
    });
  }

  // ---- API key ----
  if (apikeys.looksLikeApiKey(credential)) {
    const key = await apikeys.authenticate(credential);
    if (!key) {
      return res.status(401).json({ message: 'Invalid, expired, or revoked API key' });
    }
    apikeys.touchKey(key.keyId); // async, throttled; jangan ditunggu
    req.auth = { type: 'api_key', keyId: key.keyId, scopes: key.scopes };
    req.user = { id: key.userId, email: key.email, role: key.role };
    req.scopes = key.scopes;
    return next();
  }

  // ---- JWT ----
  const payload = await verifyToken(credential);
  if (!payload) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id)) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  req.auth = { type: 'jwt' };
  req.user = { id, email: payload.email, role: payload.role === 'admin' ? 'admin' : 'user' };
  // JWT punya akses penuh dalam batas role (scopes diabaikan)
  req.scopes = null;

  // Session binding opsional (Phase 2B): X-Session-Id utk "kecuali sesi ini".
  const sid = parseInt(req.headers['x-session-id'], 10);
  if (Number.isInteger(sid) && sid > 0) {
    try {
      const db = require('../lib/db');
      const { rows } = await db.query(
        `select id from sessions where id = $1 and user_id = $2 and revoked_at is null and expires_at > now()`,
        [sid, req.user.id]
      );
      if (rows.length > 0) req.sessionId = sid;
    } catch { /* opsional */ }
  }

  return next();
}

/**
 * Middleware lanjutan setelah requireAuth: cuma lewat kalau req.user.role
 * === 'admin' — dan HANYA lewat JWT (API key tidak pernah punya hak admin).
 */
function requireAdmin(req, res, next) {
  if (req.auth && req.auth.type === 'api_key') {
    return res.status(403).json({
      message: 'Admin only. API keys tidak punya akses ke endpoint admin.',
    });
  }
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      message: 'Admin only. Endpoint ini cuma bisa diakses akun admin.',
    });
  }
  return next();
}

/**
 * Middleware scope untuk API key. JWT selalu lolos (scope-nya null).
 * Contoh: router.get('/', requireAuth, requireScope('downloads:read'), handler)
 */
function requireScope(scope) {
  return function (req, res, next) {
    if (!req.auth || req.auth.type === 'jwt') return next();
    if (Array.isArray(req.scopes) && req.scopes.includes(scope)) return next();
    return res.status(403).json({
      message: `API key tidak punya scope '${scope}'.`,
      code: 'SCOPE_DENIED',
      required_scope: scope,
    });
  };
}

module.exports = { requireAuth, requireAdmin, requireScope };
