const { verifyToken } = require('../lib/auth');

/**
 * Middleware: butuh header `Authorization: Bearer <token>`.
 *
 * Kalau valid, req.user diisi { id, email } dan request diteruskan.
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

  req.user = { id, email: payload.email };
  return next();
}

module.exports = { requireAuth };
