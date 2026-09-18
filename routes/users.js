const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { hashPassword, MIN_PASSWORD_LENGTH } = require('../lib/auth');

// Semua endpoint di router ini butuh login DAN role admin.
// Baca daftar email user itu data sensitif, nggak boleh publik.
router.use(requireAuth, requireAdmin);

const COLUMNS = 'id, name, email, role';

// Kode error Postgres untuk unique violation (email sudah dipakai).
const UNIQUE_VIOLATION = '23505';

// id di Postgres bertipe integer (int4). Angka di luar rentang ini bikin
// Postgres error 500, padahal di versi in-memory dulu cuma "nggak ketemu" (404).
const MAX_INT4 = 2147483647;

/**
 * parseInt yang aman: balikin null kalau bukan integer yang masuk akal.
 * Perilaku lama dipertahankan — id non-numerik jadi 404, bukan 500.
 */
function parseId(raw) {
  const id = parseInt(raw, 10);
  if (!Number.isInteger(id) || id < 1 || id > MAX_INT4) return null;
  return id;
}

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
    const { rows } = await db.query(`select ${COLUMNS} from users order by id`);
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/users]', err.message);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

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
  const id = parseId(req.params.id);
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
  const { name, email, password } = req.body || {};

  // Di-trim dulu supaya sama persis dengan register. Login mencocokkan
  // lower(email) = lower(trim(input)), jadi email berspasi nggak akan
  // pernah ketemu kalau disimpan apa adanya.
  const cleanName = typeof name === 'string' ? name.trim() : name;
  const cleanEmail = typeof email === 'string' ? email.trim() : email;

  if (!cleanName || !cleanEmail) {
    return res.status(400).json({ message: 'Name and email are required' });
  }

  // password OPSIONAL — inilah celah yang diperbaiki di sini. Sebelumnya
  // endpoint ini bikin baris user tanpa password_hash, jadi akunnya muncul
  // di daftar tapi nggak bisa login. Sekarang kalau password dikirim, dia
  // divalidasi dan di-hash dengan aturan yang sama dengan /api/auth/register.
  let passwordHash = null;
  if (password !== undefined && password !== null) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }
    passwordHash = await hashPassword(password);
  }

  try {
    // id dari sequence Postgres, bukan users.length + 1 kayak sebelumnya —
    // versi lama bikin id duplikat begitu ada user yang dihapus.
    const { rows } = await db.query(
      `insert into users (name, email, password_hash) values ($1, $2, $3) returning ${COLUMNS}`,
      [cleanName, cleanEmail, passwordHash]
    );

    const user = rows[0];
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
  const { name, email } = req.body;

  // Urutan cek dipertahankan seperti aslinya: body dulu (400), baru id (404).
  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required' });
  }

  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: 'User not found' });
  }

  try {
    // returning bikin Postgres balikin baris hasil update; rowCount 0 = nggak ada
    // user dengan id itu, jadi nggak perlu query cek dulu.
    const { rows } = await db.query(
      `update users set name = $1, email = $2 where id = $3 returning ${COLUMNS}`,
      [name, email, id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
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
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(404).json({ message: 'User not found' });
  }

  try {
    const { rowCount } = await db.query('delete from users where id = $1 returning id', [id]);
    if (rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('[DELETE /api/users/:id]', err.message);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

module.exports = router;
