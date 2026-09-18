const { verifyToken } = require('../lib/auth');

/**
 * Middleware: butuh header `Authorization: Bearer <token>`.
 *
 * Kalau valid, req.user diisi { id, email, role } dan request diteruskan.
 * Kalau tidak, langsung 401 dan handler-nya nggak pernah jalan.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (!token || scheme.toLowerCase() !== 'bearer') {
    return res.status(401).json({
      message: 'Missing bearer token. Kirim header: Authorization: Bearer <token>',
    });
  }

  const payload = await verifyToken(token);
  if (!payload) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id)) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  req.user = { id, email: payload.email, role: payload.role === 'admin' ? 'admin' : 'user' };

  // Session binding opsional: klien boleh kirim X-Session-Id supaya operasi
  // "kecuali sesi ini" (ganti password) tahu sesi mana yang dipertahankan.
  // ID diverifikasi milik user & masih aktif — kalau nggak, diabaikan diam.
  const sid = parseInt(req.headers['x-session-id'], 10);
  if (Number.isInteger(sid) && sid > 0) {
    try {
      const db = require('../lib/db');
      const { rows } = await db.query(
        `select id from sessions where id = $1 and user_id = $2 and revoked_at is null and expires_at > now()`,
        [sid, req.user.id]
      );
      if (rows.length > 0) req.sessionId = sid;
    } catch { /* opsional — jangan blok request karena ini */ }
  }

  return next();
}

/**
 * Middleware lanjutan setelah requireAuth: cuma lewat kalau req.user.role
 * === 'admin'. Dipakai buat endpoint manajemen user.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      message: 'Admin only. Endpoint ini cuma bisa diakses akun admin.',
    });
  }
  return next();
}

module.exports = { requireAuth, requireAdmin };
