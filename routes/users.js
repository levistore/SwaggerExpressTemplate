const express = require('express');
const router = express.Router();
const db = require('../lib/db');

const COLUMNS = 'id, name, email';

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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       201:
 *         description: The user was successfully created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Some server error
 */
router.post('/', async (req, res) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Name and email are required' });
  }

  try {
    // id dari sequence Postgres, bukan users.length + 1 kayak sebelumnya —
    // versi lama bikin id duplikat begitu ada user yang dihapus.
    const { rows } = await db.query(
      `insert into users (name, email) values ($1, $2) returning ${COLUMNS}`,
      [name, email]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
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
 *         description: Some error happened
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
