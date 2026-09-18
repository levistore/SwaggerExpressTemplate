const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth, requireScope } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { cleanString, cleanEmail, cleanPassword, ValidationError } = require('../lib/validate');
const sessions = require('../lib/sessions');
const { audit } = require('../lib/audit');
const { clientIp } = require('../lib/ratelimit');
const {
  hashPassword,
  verifyPassword,
  signToken,
  isValidEmail,
  DUMMY_HASH,
  MIN_PASSWORD_LENGTH,
  TOKEN_TTL,
} = require('../lib/auth');

// Rate limit ketat khusus auth — brute-force login & spam register.
// Global limiter /api (300/menit) tetap jalan di atasnya.
const authLimiter = rateLimit(10, { scope: 'auth' });
router.use(authLimiter);

const COLUMNS = 'id, name, email, role';

// Kode error Postgres untuk unique violation.
const UNIQUE_VIOLATION = '23505';

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: |
 *         Kirim token dari /api/auth/login atau /api/auth/register:
 *         `Authorization: Bearer <token>`
 *   schemas:
 *     AuthResponse:
 *       type: object
 *       properties:
 *         token:
 *           type: string
 *           description: JWT (HS256), berlaku 7 hari
 *         tokenType:
 *           type: string
 *           example: Bearer
 *         expiresIn:
 *           type: string
 *           example: 7d
 *         user:
 *           $ref: '#/components/schemas/User'
 *     Credentials:
 *       type: object
 *       required: [email, password]
 *       properties:
 *         email:
 *           type: string
 *           example: budi@example.com
 *         password:
 *           type: string
 *           format: password
 *           example: rahasia123
 *     RegisterRequest:
 *       type: object
 *       required: [name, email, password]
 *       properties:
 *         name:
 *           type: string
 *           example: Budi
 *         email:
 *           type: string
 *           example: budi@example.com
 *         password:
 *           type: string
 *           format: password
 *           minLength: 8
 *           example: rahasia123
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Daftar akun baru, langsung dapat token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Akun dibuat
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Input nggak valid (nama/email/password)
 *       409:
 *         description: Email sudah terdaftar
 */
router.post('/register', async (req, res) => {
  const { password } = req.body || {};

  // Validasi server-side penuh (frontend validation bukan security).
  let name, email;
  try {
    name = cleanString(req.body && req.body.name, { field: 'Name', max: 100 });
    email = cleanEmail(req.body && req.body.email);
    cleanPassword(password);
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ message: e.message });
    }
    throw e;
  }

  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await db.query(
      `insert into users (name, email, password_hash) values ($1, $2, $3) returning ${COLUMNS}`,
      [name, email, passwordHash]
    );

    const user = rows[0];
    const token = await signToken(user);

    // Phase 2B: register juga langsung dapat session (konsisten dengan login).
    const sess = await sessions.createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    }).catch(() => null);

    audit({ actorUserId: user.id, action: 'REGISTER', targetType: 'user', targetId: user.id, req });

    return res.status(201).json({
      token,
      tokenType: 'Bearer',
      expiresIn: TOKEN_TTL,
      user,
      ...(sess ? { refreshToken: sess.refreshToken, sessionId: sess.session.id } : {}),
    });
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ message: 'Email is already registered' });
    }
    console.error('[POST /api/auth/register]', err.message);
    return res.status(500).json({ message: 'Failed to register user' });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login, balikin JWT
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Credentials'
 *     responses:
 *       200:
 *         description: Login berhasil
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Email atau password nggak diisi
 *       401:
 *         description: Email atau password salah
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  // Bentuk + panjang dicek sebelum kena DB/scrypt — jangan biarkan input
  // raksasa makan CPU scrypt. Tipe nggak valid tetap 400, bukan 500.
  if (typeof email !== 'string' || typeof password !== 'string' ||
      email.length > 254 || password.length === 0 || password.length > 128) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    const { rows } = await db.query(
      `select ${COLUMNS}, password_hash from users where lower(email) = lower($1)`,
      [String(email).trim()]
    );

    const user = rows[0];

    // Selalu jalankan verifikasi, walau emailnya nggak ada. Kalau langsung
    // balik 401 di sini, selisih waktunya bocorin email mana yang terdaftar.
    const storedHash = user && user.password_hash ? user.password_hash : DUMMY_HASH;
    const ok = await verifyPassword(String(password), storedHash);

    if (!user || !user.password_hash || !ok) {
      audit({ actorUserId: user ? user.id : null, action: 'LOGIN_FAILED', targetType: 'user', targetId: user ? user.id : null, req });
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = await signToken(user);

    // Phase 2B: session + refresh token (backwards-compatible — field lama
    // tetap, field baru ditambahkan: refreshToken, sessionId).
    const sess = await sessions.createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    }).catch(() => null); // kegagalan sesi jangan bikin login gagal total

    audit({ actorUserId: user.id, action: 'LOGIN_SUCCESS', targetType: 'user', targetId: user.id, req });

    return res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: TOKEN_TTL,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      ...(sess ? { refreshToken: sess.refreshToken, sessionId: sess.session.id } : {}),
    });
  } catch (err) {
    console.error('[POST /api/auth/login]', err.message);
    return res.status(500).json({ message: 'Failed to log in' });
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Ambil profil dari token yang dikirim
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Profil user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Token nggak ada atau nggak valid
 *       404:
 *         description: User di token sudah nggak ada (akun dihapus)
 */
router.get('/me', requireAuth, requireScope('profile:read'), async (req, res) => {
  try {
    // Dibaca ulang dari DB, bukan cuma dari isi token — kalau user-nya
    // sudah dihapus, token lama nggak boleh tetap dianggap sah.
    const { rows } = await db.query(`select ${COLUMNS} from users where id = $1`, [req.user.id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('[GET /api/auth/me]', err.message);
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/auth/me — user ubah profil sendiri (nama/email) atau ganti password.
// Kalau body bawa currentPassword + password → ganti password (verifikasi dulu).
// ---------------------------------------------------------------------------
router.put('/me', requireAuth, requireScope('profile:write'), async (req, res) => {
  try {
    const { name, email, currentPassword, password } = req.body || {};
    const { rows } = await db.query(
      `select ${COLUMNS}, password_hash from users where id = $1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    const user = rows[0];

    const sets = [];
    const vals = [];

    if (name !== undefined) {
      // Server-side validation: nama wajib teks non-kosong, maks 100 char.
      try {
        vals.push(cleanString(name, { field: 'Name', max: 100 }));
      } catch (e) {
        return res.status(400).json({ message: e.message });
      }
      sets.push(`name = $${vals.length}`);
    }

    if (email !== undefined) {
      let e;
      try {
        e = cleanEmail(email);
      } catch (err) {
        return res.status(400).json({ message: err.message });
      }
      // cek unik: email milik user lain?
      const dup = await db.query(
        'select id from users where lower(email) = lower($1) and id <> $2',
        [e, req.user.id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ message: 'Email sudah dipakai akun lain' });
      }
      vals.push(e);
      sets.push(`email = $${vals.length}`);
    }

    if (password !== undefined) {
      if (!currentPassword) {
        return res.status(400).json({ message: 'Password baru butuh currentPassword' });
      }
      const ok = await verifyPassword(String(currentPassword), user.password_hash);
      if (!ok) {
        return res.status(401).json({ message: 'Current password salah' });
      }
      // Password baru: panjang + komposisi (aturan lama dipertahankan),
      // plus batas atas supaya scrypt nggak disuapi input raksasa.
      if (typeof password !== 'string' || password.length < 8 || password.length > 128 ||
          !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({
          message: 'Password minimal 8 karakter, harus ada huruf besar, kecil, dan angka'
        });
      }
      vals.push(await hashPassword(password));
      sets.push(`password_hash = $${vals.length}`);
    }

    if (sets.length === 0) {
      return res.status(400).json({ message: 'Nggak ada field yang diubah' });
    }

    vals.push(req.user.id);
    const upd = await db.query(
      `update users set ${sets.join(', ')} where id = $${vals.length} returning ${COLUMNS}`,
      vals
    );

    // Ganti password → semua sesi LAIN dicabut (sesi saat ini tetap dipakai,
    // biar user nggak ke-logout sendiri). Perilaku didokumentasikan di README.
    if (password !== undefined) {
      const revoked = await sessions.revokeAllSessions(req.user.id, { exceptSessionId: req.sessionId }).catch(() => 0);
      audit({ actorUserId: req.user.id, action: 'PASSWORD_CHANGED', targetType: 'user', targetId: req.user.id, req, metadata: { other_sessions_revoked: revoked } });
    }

    return res.json(upd.rows[0]);
  } catch (err) {
    console.error('[PUT /api/auth/me]', err.message);
    return res.status(500).json({ message: 'Failed to update profile' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh — tukar refresh token dgn access token baru.
// Refresh token diputar di tiap pemakaian; reuse → seluruh family direvoke.
// ---------------------------------------------------------------------------
router.post('/refresh', async (req, res, next) => {
  const raw = req.body && req.body.refreshToken;
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 512) {
    return res.status(400).json({ message: 'refreshToken wajib diisi.' });
  }
  try {
    const result = await sessions.rotateSession(raw, {
      userAgent: req.headers['user-agent'],
      ip: clientIp(req),
    });
    // Access token baru dibuat dari data user terkini (role bisa berubah).
    const { rows } = await db.query(
      `select ${COLUMNS} from users where id = $1`,
      [result.user_id]
    );
    if (rows.length === 0) {
      await sessions.revokeSession(result.session.id, result.user_id);
      return res.status(401).json({ message: 'User not found' });
    }
    const token = await signToken(rows[0]);
    return res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: TOKEN_TTL,
      refreshToken: result.refreshToken,
      sessionId: result.session.id,
      user: rows[0],
    });
  } catch (e) {
    if (e.code === 'INVALID' || e.code === 'EXPIRED') {
      return res.status(401).json({ message: e.message });
    }
    if (e.code === 'REUSE') {
      audit({ action: 'REFRESH_TOKEN_REUSE', req, metadata: { family_revoked: true } });
      return res.status(401).json({ message: e.message, code: 'REFRESH_REUSE_DETECTED' });
    }
    return next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout — revoke refresh token yang dikirim.
// Access JWT yang masih berlaku TETAP valid sampai expired (tidak ada
// blacklist access token) — didokumentasikan; refresh token-nya mati.
// ---------------------------------------------------------------------------
router.post('/logout', async (req, res) => {
  const raw = req.body && req.body.refreshToken;
  if (typeof raw !== 'string' || raw.length > 512) {
    return res.status(400).json({ message: 'refreshToken wajib diisi.' });
  }
  // Revoke by hash — tanpa perlu auth, karena pemegang token adalah pemiliknya.
  const h = sessions.hashToken(raw);
  try {
    const { rowCount } = await db.query(
      `update sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`,
      [h]
    );
    if (rowCount > 0) {
      const owner = await db.query(`select user_id from sessions where token_hash = $1`, [h]);
      audit({ actorUserId: owner.rows[0] ? owner.rows[0].user_id : null, action: 'LOGOUT', targetType: 'session', req });
    }
    return res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('[POST /api/auth/logout]', err.message);
    return res.status(500).json({ message: 'Failed to log out' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/sessions — metadata sesi aktif milik user (tanpa token).
// ---------------------------------------------------------------------------
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const rows = await sessions.listSessions(req.user.id);
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/auth/sessions]', err.message);
    return res.status(500).json({ message: 'Failed to list sessions' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/auth/sessions/:id — revoke satu sesi milik user (anti-IDOR).
// ---------------------------------------------------------------------------
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ message: 'Session not found' });
  }
  try {
    const ok = await sessions.revokeSession(id, req.user.id);
    if (!ok) return res.status(404).json({ message: 'Session not found' });
    audit({ actorUserId: req.user.id, action: 'SESSION_REVOKED', targetType: 'session', targetId: id, req });
    return res.json({ message: 'Session revoked' });
  } catch (err) {
    console.error('[DELETE /api/auth/sessions/:id]', err.message);
    return res.status(500).json({ message: 'Failed to revoke session' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout-all — revoke semua sesi user.
// ---------------------------------------------------------------------------
router.post('/logout-all', requireAuth, async (req, res) => {
  try {
    const n = await sessions.revokeAllSessions(req.user.id);
    audit({ actorUserId: req.user.id, action: 'LOGOUT_ALL', targetType: 'user', targetId: req.user.id, req, metadata: { revoked: n } });
    return res.json({ message: 'All sessions revoked', revoked: n });
  } catch (err) {
    console.error('[POST /api/auth/logout-all]', err.message);
    return res.status(500).json({ message: 'Failed to revoke sessions' });
  }
});

module.exports = router;
