const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { hashPassword, MIN_PASSWORD_LENGTH } = require('../lib/auth');
const { rateLimit } = require('../lib/ratelimit');
const { cleanString, cleanEmail, cleanId, ValidationError } = require('../lib/validate');
const { audit } = require('../lib/audit');

// Semua endpoint di router ini butuh login DAN role admin.
// Baca daftar email user itu data sensitif, nggak boleh publik.
router.use(requireAuth, requireAdmin);

// Admin juga dibatasi (defence in depth kalau token admin bocor):
// 60 req/menit per IP untuk seluruh operasi manajemen user.
router.use(rateLimit(60, { scope: 'admin' }));

const COLUMNS = 'id, name, email, role';

// Kode error Postgres untuk unique violation (email sudah dipakai).
const UNIQUE_VIOLATION = '23505';

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - email
 *       properties:
 *         id:
 *           type: integer
 *           description: The user ID
 *         name:
 *           type: string
 *           description: The user name
 *         email:
 *           type: string
 *           description: The user email
 *       example:
 *         id: 1
 *         name: John Doe
 *         email: john@example.com
 *     CreateUserRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
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
 *           description: |
 *             Opsional. Kalau diisi, user ini bisa login lewat
 *             /api/auth/login. Kalau nggak diisi, akunnya tetap dibuat
 *             tapi TIDAK punya password dan nggak bisa login.
 *     UserCreated:
 *       allOf:
 *         - $ref: '#/components/schemas/User'
 *         - type: object
 *           properties:
 *             hasPassword:
 *               type: boolean
 *               description: true kalau user ini punya password dan bisa login
 */

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Returns the list of all users
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: The list of users
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query('select id, name, email, role, created_at from users order by id');
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/users]', err.message);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

router.use(require('./audit'));

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get a user by id
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The user id
 *     responses:
 *       200:
 *         description: The user description by id
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: The user was not found
 */
router.get('/:id', async (req, res) => {
  const id = cleanId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: 'User not found' });
  }

  try {
    const { rows } = await db.query(`select ${COLUMNS} from users where id = $1`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error('[GET /api/users/:id]', err.message);
    res.status(500).json({ message: 'Failed to fetch user' });
  }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create a new user
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateUserRequest'
 *     responses:
 *       201:
 *         description: |
 *           User dibuat. Cek `hasPassword`: kalau `false`, user ini nggak
 *           punya password dan TIDAK bisa login lewat /api/auth/login.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserCreated'
 *       400:
 *         description: |
 *           Name/email nggak diisi, atau password diisi tapi kurang dari
 *           8 karakter
 *       401:
 *         description: Bearer token nggak ada atau nggak valid
 *       409:
 *         description: Email sudah dipakai user lain
 */
router.post('/', async (req, res) => {
  const { password } = req.body || {};

  // Validasi server-side: hanya field yang dikenal, tipe & panjang dicek.
  let cleanName, cleanEmailVal;
  try {
    cleanName = cleanString(req.body && req.body.name, { field: 'Name', max: 100 });
    cleanEmailVal = cleanEmail(req.body && req.body.email);
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ message: e.message });
    }
    throw e;
  }

  // password OPSIONAL — kalau diisi, divalidasi dan di-hash dengan aturan
  // yang sama dengan /api/auth/register.
  let passwordHash = null;
  if (password !== undefined && password !== null) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 128) {
      return res.status(400).json({
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }
    passwordHash = await hashPassword(password);
  }

  try {
    // id dari sequence Postgres — id duplikat nggak mungkin.
    const { rows } = await db.query(
      `insert into users (name, email, password_hash) values ($1, $2, $3) returning ${COLUMNS}`,
      [cleanName, cleanEmailVal, passwordHash]
    );

    const user = rows[0];
    audit({ actorUserId: req.user.id, action: 'ADMIN_USER_CREATED', targetType: 'user', targetId: user.id, req, metadata: { has_password: passwordHash !== null } });
    // hasPassword bikin status akun ini eksplisit, bukan diam-diam setengah jadi.
    res.status(201).json({ ...user, hasPassword: passwordHash !== null });
  } catch (err) {
    // Sejak 002_auth.sql email unik (case-insensitive). Kalau nggak
    // ditangani di sini, error Postgres jadi 500 padahal masalahnya di input.
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ message: 'Email is already registered' });
    }
    console.error('[POST /api/users]', err.message);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update a user by id
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The user id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       200:
 *         description: The user was updated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         description: The user was not found
 *       400:
 *         description: Name or email is missing
 *       401:
 *         description: Bearer token nggak ada atau nggak valid
 *       409:
 *         description: Email sudah dipakai user lain
 */
router.put('/:id', async (req, res) => {
  const { name, email } = req.body || {};

  // Urutan cek dipertahankan seperti aslinya: body dulu (400), baru id (404).
  // Validasi server-side: tipe, format email, panjang — field nggak dikenal
  // diabaikan (tidak pernah diteruskan ke SQL).
  let cleanNameVal, cleanEmailVal;
  try {
    cleanNameVal = cleanString(name, { field: 'Name', max: 100 });
    cleanEmailVal = cleanEmail(email);
  } catch (e) {
    if (e instanceof ValidationError) {
      return res.status(400).json({ message: e.message });
    }
    throw e;
  }

  const id = cleanId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: 'User not found' });
  }

  try {
    // returning bikin Postgres balikin baris hasil update; rowCount 0 = nggak ada
    // user dengan id itu, jadi nggak perlu query cek dulu.
    const { rows } = await db.query(
      `update users set name = $1, email = $2 where id = $3 returning ${COLUMNS}`,
      [cleanNameVal, cleanEmailVal, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    audit({ actorUserId: req.user.id, action: 'ADMIN_USER_UPDATED', targetType: 'user', targetId: id, req });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({ message: 'Email is already registered' });
    }
    console.error('[PUT /api/users/:id]', err.message);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Remove a user by id
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The user id
 *     responses:
 *       200:
 *         description: The user was deleted
 *       401:
 *         description: Bearer token nggak ada atau nggak valid
 *       404:
 *         description: The user was not found
 */
router.delete('/:id', async (req, res) => {
  const id = cleanId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: 'User not found' });
  }

  try {
    const { rowCount } = await db.query('delete from users where id = $1 returning id', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    audit({ actorUserId: req.user.id, action: 'ADMIN_USER_DELETED', targetType: 'user', targetId: id, req });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('[DELETE /api/users/:id]', err.message);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

module.exports = router;
