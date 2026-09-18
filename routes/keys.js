// API key management: /api/keys
//
// Web auth (JWT) wajib untuk kelola key. Key sendiri dipakai di endpoint
// publik (download dkk) lewat Authorization: Bearer lcode_live_...
//
// Raw key HANYA dikembalikan sekali, di respons POST /api/keys.
const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { cleanString, ValidationError } = require('../lib/validate');
const apikeys = require('../lib/apikeys');
const { audit } = require('../lib/audit');

router.use(requireAuth);

// 30/menit per IP — operasi kelola key jarang, tapi bikin sulit brute-force
// endpoint create/rotate.
router.use(rateLimit(30, { scope: 'keys' }));

/**
 * @swagger
 * /api/keys:
 *   get:
 *     summary: Daftar API key aktif milik user
 *     tags: [API Keys]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Metadata key (TANPA raw key/hash)
 *       401: { description: Token tidak valid }
 */
router.get('/', async (req, res) => {
  try {
    const rows = await apikeys.listKeys(req.user.id);
    return res.json(rows);
  } catch (err) {
    console.error('[GET /api/keys]', err.message);
    return res.status(500).json({ message: 'Failed to list API keys' });
  }
});

/**
 * @swagger
 * /api/keys:
 *   post:
 *     summary: Buat API key baru (raw key hanya dikembalikan SEKALI)
 *     tags: [API Keys]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Website saya
 *               scopes:
 *                 type: array
 *                 items: { type: string, enum: [downloads:read, profile:read, profile:write] }
 *                 example: [downloads:read]
 *               expiresInDays:
 *                 type: integer
 *                 description: Opsional. Tanpa ini key tidak kedaluwarsa.
 *                 example: 365
 *     responses:
 *       201:
 *         description: Key dibuat. Simpan `key` — tidak akan dikirim lagi.
 *       400: { description: Input tidak valid }
 *       401: { description: Token tidak valid }
 *       409: { description: Batas jumlah key aktif tercapai }
 */
router.post('/', async (req, res) => {
  try {
    var name = cleanString(req.body && req.body.name, { field: 'Name', max: 100 });
  } catch (e) {
    if (e instanceof ValidationError) return res.status(400).json({ message: e.message });
    throw e;
  }

  // scopes: default downloads:read. Validasi ketat — tanpa wildcard.
  let scopes = req.body && req.body.scopes;
  if (scopes === undefined || scopes === null) scopes = ['downloads:read'];
  if (!Array.isArray(scopes) || scopes.length === 0 ||
      !scopes.every((s) => apikeys.isValidScope(s))) {
    return res.status(400).json({
      message: "scopes harus array berisi dari: downloads:read, profile:read, profile:write",
    });
  }
  scopes = [...new Set(scopes)]; // dedupe

  // expiresAt opsional: 1..3650 hari
  let expiresAt = null;
  const days = req.body && req.body.expiresInDays;
  if (days !== undefined && days !== null) {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 3650) {
      return res.status(400).json({ message: 'expiresInDays harus integer 1..3650' });
    }
    expiresAt = new Date(Date.now() + n * 24 * 60 * 60 * 1000);
  }

  try {
    const active = await apikeys.countActive(req.user.id);
    if (active >= apikeys.MAX_ACTIVE_KEYS_PER_USER) {
      return res.status(409).json({
        message: `Maksimal ${apikeys.MAX_ACTIVE_KEYS_PER_USER} key aktif. Revoke dulu yang tidak terpakai.`,
      });
    }

    const { raw, prefix, hash } = apikeys.generateKey();
    const { rows } = await db.query(
      `insert into api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at)
       values ($1, $2, $3, $4, $5, $6)
       returning id, name, key_prefix as prefix, scopes, created_at, expires_at`,
      [req.user.id, name, prefix, hash, scopes, expiresAt]
    );

    audit({ actorUserId: req.user.id, action: 'API_KEY_CREATED', targetType: 'api_key', targetId: rows[0].id, req, metadata: { scopes, has_expiry: !!expiresAt } });
    return res.status(201).json({ ...rows[0], key: raw });
  } catch (err) {
    console.error('[POST /api/keys]', err.message);
    return res.status(500).json({ message: 'Failed to create API key' });
  }
});

/**
 * @swagger
 * /api/keys/{id}:
 *   delete:
 *     summary: Revoke API key milik sendiri
 *     tags: [API Keys]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Key direvoke }
 *       404: { description: Key tidak ditemukan (atau bukan milikmu) }
 */
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ message: 'API key not found' });
  }
  try {
    const ok = await apikeys.revokeKey(id, req.user.id);
    if (!ok) return res.status(404).json({ message: 'API key not found' });
    audit({ actorUserId: req.user.id, action: 'API_KEY_REVOKED', targetType: 'api_key', targetId: id, req });
    return res.json({ message: 'API key revoked' });
  } catch (err) {
    console.error('[DELETE /api/keys/:id]', err.message);
    return res.status(500).json({ message: 'Failed to revoke API key' });
  }
});

/**
 * @swagger
 * /api/keys/{id}/rotate:
 *   post:
 *     summary: Rotasi key — key lama direvoke, key baru dibuat (raw key sekali)
 *     tags: [API Keys]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       201:
 *         description: Key baru. Simpan `key` — tidak akan dikirim lagi.
 *       404: { description: Key tidak ditemukan (atau bukan milikmu) }
 */
router.post('/:id/rotate', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(404).json({ message: 'API key not found' });
  }
  try {
    // Ambil metadata key lama (harus milik user & aktif)
    const { rows } = await db.query(
      `select id, name, scopes, expires_at from api_keys
       where id = $1 and user_id = $2 and revoked_at is null`,
      [id, req.user.id]
    );
    const old = rows[0];
    if (!old) return res.status(404).json({ message: 'API key not found' });

    const active = await apikeys.countActive(req.user.id);
    if (active >= apikeys.MAX_ACTIVE_KEYS_PER_USER + 1) {
      return res.status(409).json({ message: 'Batas key aktif tercapai.' });
    }

    const { raw, prefix, hash } = apikeys.generateKey();
    const inserted = await db.query(
      `insert into api_keys (user_id, name, key_prefix, key_hash, scopes, expires_at)
       values ($1, $2, $3, $4, $5, $6)
       returning id, name, key_prefix as prefix, scopes, created_at, expires_at`,
      [req.user.id, old.name, prefix, hash, old.scopes, old.expires_at]
    );
    await apikeys.revokeKey(id, req.user.id);

    audit({ actorUserId: req.user.id, action: 'API_KEY_ROTATED', targetType: 'api_key', targetId: inserted.rows[0].id, req, metadata: { old_key_id: id } });
    return res.status(201).json({ ...inserted.rows[0], key: raw });
  } catch (err) {
    console.error('[POST /api/keys/:id/rotate]', err.message);
    return res.status(500).json({ message: 'Failed to rotate API key' });
  }
});

module.exports = router;
