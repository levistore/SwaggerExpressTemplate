// Downloader route: /api/download/:platform?url=...
// Provider logic ada di lib/providers.js (diekstrak Phase 3, behavior sama).
const express = require('express');
const router = express.Router();
const { requireAuth, requireScope } = require('../middleware/auth');
const { rateLimit } = require('../lib/ratelimit');
const { assertSafePublicUrl } = require('../lib/ssrf');
const providers = require('../lib/providers');
const { keyQuota } = require('../lib/quota');

const PLATFORMS = providers.PLATFORMS;


// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
router.use(requireAuth);
// Quota per API key (Phase 3): 60/menit & 1000/hari default (override per key
// via kolom api_keys). JWT tidak kena quota ini. Key revoked/expired sudah
// ditolak requireAuth sebelum sini.
router.use(keyQuota);

// Downloader = resource mahal (fetch provider eksternal 15s timeout).
// Limit 20 req/menit per IP — jauh lebih ketat dari global.
const downloadLimiter = rateLimit(20, { scope: 'download' });

/**
 * @swagger
 * /api/download/{platform}:
 *   get:
 *     summary: Dapatkan tautan unduhan media dari platform sosial
 *     description: |
 *       Mengembalikan daftar tautan unduhan langsung (video/gambar/audio) untuk
 *       konten publik. Sumbernya layanan pihak ketiga gratis — ketersediaan bisa
 *       berubah. Konten privat tidak didukung.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: platform
 *         required: true
 *         schema: { type: string, enum: [tiktok, youtube, facebook, instagram] }
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *         description: URL konten publik yang mau diunduh
 *     responses:
 *       200:
 *         description: Daftar tautan unduhan
 *       400: { description: URL tidak valid }
 *       401: { description: Token tidak ada atau kedaluwarsa }
 *       404: { description: Platform tidak dikenal }
 *       502: { description: Sumber pihak ketiga gagal atau media tidak tersedia }
 */
router.get('/:platform', downloadLimiter, requireScope('downloads:read'), async (req, res, next) => {
  const platform = (req.params.platform || '').toLowerCase();
  const url = (req.query.url || '').trim();

  if (!PLATFORMS.includes(platform)) {
    return res.status(404).json({
      ok: false,
      message: `Platform '${req.params.platform}' tidak dikenal. Pilihan: ${PLATFORMS.join(', ')}`,
    });
  }

  // Validasi + SSRF guard: tolak skema non-http, host internal/private,
  // cloud metadata, penyamaran IP (desimal/hex/oktal), dan DNS ke IP privat.
  if (!url) {
    return res.status(400).json({
      ok: false,
      message: "Query '?url=' wajib diisi dengan URL http(s) yang valid.",
    });
  }
  if (url.length > 2048) {
    return res.status(400).json({ ok: false, message: 'URL terlalu panjang (maksimal 2048 karakter).' });
  }
  try {
    await assertSafePublicUrl(url);
  } catch (e) {
    return res.status(400).json({ ok: false, message: e.message });
  }

  try {
    switch (platform) {
      case 'tiktok': return res.json(await providers.tiktok(url));
      case 'youtube': return res.json(await providers.youtube(url));
      case 'facebook': return res.json(await providers.facebook(url));
      case 'instagram': return res.json(await providers.instagram(url));
      default: return next();
    }
  } catch (e) {
    // Log detail internal (kategori + pesan asli) di server SAJA; respons client
    // memakai pesan yang sudah dinormalisasi (tanpa nama provider mentah/URL).
    if (e.payload) {
      require('../lib/logger').warn('provider_failure', {
        request_id: req.id,
        platform,
        category: e.category || 'DOWNLOAD_FAILED',
        breaker: e.breaker,
        detail: String(e.message).slice(0, 120),
      });
      return res.status(e.status || 502).json(e.payload);
    }
    return next(e);
  }
});

module.exports = router;
