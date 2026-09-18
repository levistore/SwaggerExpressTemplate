const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const {
  hashPassword,
  verifyPassword,
  signToken,
  isValidEmail,
  DUMMY_HASH,
  MIN_PASSWORD_LENGTH,
  TOKEN_TTL,
} = require('../lib/auth');

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
  const { name, email, password } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ message: 'Name is required' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ message: 'Valid email is required' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await db.query(
      `insert into users (name, email, password_hash) values ($1, $2, $3) returning ${COLUMNS}`,
      [name.trim(), email.trim(), passwordHash]
    );

    const user = rows[0];
    const token = await signToken(user);
    return res.status(201).json({ token, tokenType: 'Bearer', expiresIn: TOKEN_TTL, user });
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

  if (!email || !password) {
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
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = await signToken(user);
    return res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: TOKEN_TTL,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
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
router.get('/me', requireAuth, async (req, res) => {
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
router.put('/me', requireAuth, async (req, res) => {
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
      if (!String(name).trim()) {
        return res.status(400).json({ message: 'Name nggak boleh kosong' });
      }
      vals.push(String(name).trim());
      sets.push(`name = $${vals.length}`);
    }

    if (email !== undefined) {
      const e = String(email).trim();
      if (!isValidEmail(e)) {
        return res.status(400).json({ message: 'Valid email is required' });
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
      if (typeof password !== 'string' || password.length < 8 ||
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
    return res.json(upd.rows[0]);
  } catch (err) {
    console.error('[PUT /api/auth/me]', err.message);
    return res.status(500).json({ message: 'Failed to update profile' });
  }
});

module.exports = router;
