// Downloader route: /api/download/:platform?url=...
//
// Menyalurkan permintaan ke layanan publik pihak ketiga (gratis, tanpa API key):
//   TikTok    -> ssstik.io        (HTML, di-parse)
//   YouTube   -> api.vidssave.com (form POST, JSON)
//   Facebook  -> snapsave.app     (form POST, JS obfuscate di-dekode minimal)
//   Instagram -> instagram.com/graphql/query (doc_id publik, sering rate-limit)
//
// Semua timeout 15s. Respons selalu JSON: { ok, platform, url, media: [...] }
// Kalau sumber gagal, ok=false + message yang jujur — tidak ada data karangan.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 15000;

const PLATFORMS = ['tiktok', 'youtube', 'facebook', 'instagram'];

// ---------------------------------------------------------------------------
// util fetch
// ---------------------------------------------------------------------------
function fetchWithTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Bungkus hasil jadi format respons standar. */
function ok(platform, url, media, extra = {}) {
  return { ok: true, platform, url, count: media.length, media, ...extra };
}

function fail(platform, url, message, status = 502) {
  const e = new Error(message);
  e.status = status;
  e.payload = { ok: false, platform, url: url || null, message, media: [] };
  return e;
}

// ---------------------------------------------------------------------------
// TikTok — ssstik.io (HTML hasil POST, di-parse dengan regex sederhana)
// ---------------------------------------------------------------------------
async function tiktok(url) {
  const body = new URLSearchParams({
    id: url, locale: 'en', tt: 'dHl6Ylg4',
  }).toString();

  let html;
  try {
    const r = await fetchWithTimeout('https://ssstik.io/abc?url=dl', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': UA,
        referer: 'https://ssstik.io/en-1',
        'hx-request': 'true',
        'hx-target': 'target',
        'hx-trigger': '_gcaptcha_pt',
      },
      body,
    });
    if (!r.ok) throw new Error('ssstik HTTP ' + r.status);
    html = await r.text();
  } catch (e) {
    throw fail('tiktok', url, 'Gagal menghubungi ssstik: ' + e.message);
  }

  const media = [];
  // link unduhan: <a href="https://tikcdn.io/...">Label</a>
  const re = /<a[^>]+href="(https:\/\/tikcdn\.io\/ssstik\/[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].replace(/&amp;/g, '&');
    const label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href || href === '#') continue;
    let kind = 'video';
    if (/mp3|music|sound/i.test(label)) kind = 'audio';
    else if (/photo|slide|image/i.test(label)) kind = 'image';
    media.push({ kind, label: label || 'unduhan', url: href });
  }

  if (media.length === 0) {
    throw fail('tiktok', url,
      'ssstik tidak mengembalikan tautan unduhan. Video mungkin privat atau dihapus.');
  }

  const title = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
  return ok('tiktok', url, media, {
    title: title ? title.replace(/<[^>]+>/g, '').trim() : null,
  });
}

// ---------------------------------------------------------------------------
// YouTube — api.vidssave.com
// ---------------------------------------------------------------------------
async function youtube(rawUrl) {
  const body = new URLSearchParams({
    auth: '20250901majwlqo',
    domain: 'api-ak.vidssave.com',
    origin: 'cache',
    link: rawUrl,
  }).toString();

  let data;
  try {
    const r = await fetchWithTimeout(
      'https://api.vidssave.com/api/contentsite_api/media/parse',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          accept: 'application/json, text/plain, */*',
          origin: 'https://vidssave.com',
          referer: 'https://vidssave.com/',
          'user-agent': UA,
          'x-requested-with': 'XMLHttpRequest',
        },
        body,
      });
    if (!r.ok) throw new Error('vidssave HTTP ' + r.status);
    data = await r.json();
  } catch (e) {
    throw fail('youtube', rawUrl, 'Gagal menghubungi vidssave: ' + e.message);
  }

  if (!data || data.status !== 1 || !data.data) {
    throw fail('youtube', rawUrl, 'vidssave menolak URL ini (mungkin bukan video publik).');
  }

  const v = data.data;
  const media = [];
  (v.resources || []).forEach((r) => {
    if (!r.download_url) return;
    media.push({
      kind: r.type === 'audio' ? 'audio' : 'video',
      label: `${r.format || ''} ${r.quality || ''}`.trim() || 'unduhan',
      url: r.download_url,
      sizeMB: r.size ? +(r.size / 1024 / 1024).toFixed(2) : null,
    });
  });

  if (media.length === 0) {
    throw fail('youtube', rawUrl, 'Tidak ada sumber unduhan untuk video ini.');
  }

  return ok('youtube', rawUrl, media, {
    title: v.title || null,
    thumbnail: v.thumbnail || null,
    duration: v.duration || null,
  });
}

// ---------------------------------------------------------------------------
// Facebook — snapsave.app (respons JS obfuscate; kita dekode pattern eval terakhir)
// ---------------------------------------------------------------------------
async function facebook(rawUrl) {
  const body = new URLSearchParams({ url: rawUrl }).toString();

  let html;
  try {
    const r = await fetchWithTimeout('https://snapsave.app/action.php?lang=en', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': UA,
        referer: 'https://snapsave.app/',
        'x-requested-with': 'XMLHttpRequest',
      },
      body,
    });
    if (!r.ok) throw new Error('snapsave HTTP ' + r.status);
    html = await r.text();
  } catch (e) {
    throw fail('facebook', rawUrl, 'Gagal menghubungi snapsave: ' + e.message);
  }

  // Respons berisi JS: head (deoberfuscator) + eval(payload).
  const idx = html.lastIndexOf('eval(');
  if (idx >= 0) {
    const head = html.slice(0, idx);
    const expr = html.slice(idx + 5).replace(/\)\)?\s*$/, '');
    // sandbox node: tanpa require/process, murni operasi string
    const vm = require('vm');
    const sandbox = { String, Math, RegExp, Array, Object, parseInt, decodeURIComponent, escape };
    try {
      vm.createContext(sandbox);
      vm.runInContext(head, sandbox, { timeout: 3000 });
      const decoded = vm.runInContext('(' + expr + '))', sandbox, { timeout: 3000 });
      if (decoded && /rapidcdn|video-quality/.test(decoded)) html = decoded;
    } catch {
      /* kalau gagal dekode, coba parse html mentah di bawah */
    }
  }

  if (/error_api_get|Error:/.test(html) && !/rapidcdn|download/i.test(html)) {
    const msg = (html.match(/Error: ([^"\\]+)/) || [])[1];
    throw fail('facebook', rawUrl, msg || 'Video privat atau tidak ditemukan.');
  }

  // URL video: d.rapidcdn.app/v2 (token-nya snapsave singkat pakai "..." tapi
  // tetap valid). Kualitas ada di <td class="video-quality">720p (HD)</td> sebelum link.
  const media = [];
  const qualRe = /video-quality\\">([^<]+)</g;
  const quals = [];
  let q;
  while ((q = qualRe.exec(html)) !== null) quals.push(q[1]);

  const urlRe = /https:\/\/d\.rapidcdn\.app\/v2\?token=[^"\\\s]+/g;
  let i = 0, u;
  while ((u = urlRe.exec(html)) !== null) {
    media.push({
      kind: 'video',
      label: quals[i] ? `video ${quals[i]}` : 'video',
      url: u[0],
    });
    i++;
  }

  if (media.length === 0) {
    throw fail('facebook', rawUrl,
      'snapsave tidak mengembalikan tautan. Video mungkin privat, bukan video, atau dihapus.');
  }

  return ok('facebook', rawUrl, media);
}

// ---------------------------------------------------------------------------
// Instagram — graphql publik IG (doc_id downloadgram). Sering rate-limit;
// kalau begitu kita bilang jujur.
// ---------------------------------------------------------------------------
const IG_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function igShortcodeToId(code) {
  let id = 0n;
  for (const c of code) {
    const i = IG_ALPHABET.indexOf(c);
    if (i < 0) return null;
    id = id * 64n + BigInt(i);
  }
  return id.toString();
}

function igShortcodeFromUrl(rawUrl) {
  const m = rawUrl.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function instagram(rawUrl) {
  const shortcode = igShortcodeFromUrl(rawUrl);
  if (!shortcode) {
    throw fail('instagram', rawUrl,
      'URL Instagram tidak dikenali. Pakai format instagram.com/p/<kode> atau /reel/<kode>.', 400);
  }
  const mediaId = igShortcodeToId(shortcode);

  // 1. coba graphql web (doc_id publik yang dipakai downloadgram.org)
  const variables = JSON.stringify({
    shortcode, fetch_tagged_user_count: null,
    hoisted_comment_id: null, hoisted_reply_id: null,
  });
  const gqlUrl = 'https://www.instagram.com/graphql/query/?doc_id=8845758582119845&variables=' +
    encodeURIComponent(variables);

  let data = null;
  try {
    const r = await fetchWithTimeout(gqlUrl, {
      headers: {
        'user-agent': UA,
        'x-requested-with': 'XMLHttpRequest',
        referer: 'https://www.instagram.com/',
      },
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.data && j.data.shortcode_media) data = j.data.shortcode_media;
    }
  } catch { /* lanjut ke fallback */ }

  // 2. fallback: api web resmi pakai app-id publik
  if (!data) {
    try {
      const r = await fetchWithTimeout(
        `https://i.instagram.com/api/v1/media/${mediaId}/info/`, {
          headers: {
            'user-agent': 'Instagram 76.0.0.15.395 Android',
            'x-ig-app-id': '936619743392459',
          },
        });
      if (r.ok) {
        const j = await r.json();
        const item = j && j.items && j.items[0];
        if (item) {
          // bentuk respons beda — normalisasi manual
          const media = [];
          const versions = (item.video_versions || []);
          versions.forEach((v) => media.push({
            kind: 'video', label: `video ${v.type || ''}`.trim(), url: v.url,
          }));
          const imgs = ((item.image_versions2 || {}).candidates || []);
          if (imgs.length && media.length === 0) {
            media.push({ kind: 'image', label: 'gambar', url: imgs[0].url });
          }
          if (media.length) {
            return ok('instagram', rawUrl, media, {
              title: (item.caption && item.caption.text) ? item.caption.text.slice(0, 120) : null,
            });
          }
        }
      }
    } catch { /* dianggap gagal */ }
  }

  if (!data) {
    throw fail('instagram', rawUrl,
      'Sumber Instagram menolak permintaan dari server ini (rate-limit / login wajib). ' +
      'Coba lagi beberapa menit lagi.');
  }

  // parse graphql shortcode_media
  const media = [];
  const push = (u, kind, label) => {
    if (u && !media.some((x) => x.url === u)) media.push({ kind, label, url: u });
  };
  if (data.is_video && data.video_url) push(data.video_url, 'video', 'video');
  if (data.display_url) push(data.display_url, data.is_video ? 'thumbnail' : 'image',
    data.is_video ? 'thumbnail' : 'gambar');
  (data.edge_sidecar_to_children && data.edge_sidecar_to_children.edges || []).forEach((e) => {
    const n = e.node || {};
    if (n.is_video && n.video_url) push(n.video_url, 'video', 'video (carousel)');
    if (n.display_url) push(n.display_url, n.is_video ? 'thumbnail' : 'image',
      n.is_video ? 'thumbnail (carousel)' : 'gambar (carousel)');
  });

  if (media.length === 0) {
    throw fail('instagram', rawUrl, 'Media tidak ditemukan untuk URL ini.');
  }

  const capText = data.edge_media_to_caption && data.edge_media_to_caption.edges &&
    data.edge_media_to_caption.edges[0] && data.edge_media_to_caption.edges[0].node &&
    data.edge_media_to_caption.edges[0].node.text;

  return ok('instagram', rawUrl, media, { title: capText ? capText.slice(0, 120) : null });
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------
router.use(requireAuth);

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
router.get('/:platform', async (req, res, next) => {
  const platform = (req.params.platform || '').toLowerCase();
  const url = (req.query.url || '').trim();

  if (!PLATFORMS.includes(platform)) {
    return res.status(404).json({
      ok: false,
      message: `Platform '${req.params.platform}' tidak dikenal. Pilihan: ${PLATFORMS.join(', ')}`,
    });
  }

  if (!url || !isHttpUrl(url)) {
    return res.status(400).json({
      ok: false,
      message: "Query '?url=' wajib diisi dengan URL http(s) yang valid.",
    });
  }

  try {
    switch (platform) {
      case 'tiktok': return res.json(await tiktok(url));
      case 'youtube': return res.json(await youtube(url));
      case 'facebook': return res.json(await facebook(url));
      case 'instagram': return res.json(await instagram(url));
      default: return next();
    }
  } catch (e) {
    if (e.payload) return res.status(e.status || 502).json(e.payload);
    return next(e);
  }
});

module.exports = router;
