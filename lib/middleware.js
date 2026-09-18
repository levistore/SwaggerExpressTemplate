// Middleware lintas-cutting: request ID, logging, headers, error handler.
const crypto = require('crypto');
const log = require('./logger');
const { clientIp } = require('./ratelimit');

// ---------------------------------------------------------------------------
// Request ID
// ---------------------------------------------------------------------------
const REQ_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  // Terima ID dari upstream (mis. load balancer) hanya kalau formatnya aman —
  // jangan pernah echo balik string sembarang ke header/log (header injection).
  req.id = (typeof incoming === 'string' && REQ_ID_RE.test(incoming))
    ? incoming
    : 'req_' + crypto.randomBytes(9).toString('base64url');
  res.setHeader('X-Request-ID', req.id);
  next();
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
// CSP dirancang supaya frontend & Swagger UI tetap jalan:
//   - inline style diizinkan (Swagger UI & halaman pakai style inline).
//   - script: 'self' SAJA — semua halaman pakai file .js eksternal, bukan inline.
//   - Swagger UI di produksi load aset dari /api/* (di-route-kan ke CDN lewat
//     vercel.json) — tetap 'self' dari sudut pandang browser.
//   - img: 'self' data: (maskot, favicon, placeholder respons playground).
//   - connect 'self' — semua fetch API relatif (/api/...).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  // HSTS hanya efektif via HTTPS — Vercel production selalu HTTPS. Set di sini
  // aman juga untuk lokal (header diabaikan browser di http biasa).
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
}

// ---------------------------------------------------------------------------
// CORS — eksplisit, bukan '*'.
//
// Frontend production dilayani dari domain yang SAMA dengan API (halaman
// statis dan /api berada di satu deployment Vercel), jadi browser tidak
// butuh CORS sama sekali. Origin tambahan (mis. dev di port lain) bisa
// didaftarkan lewat env CORS_ORIGINS (dipisah koma), khusus non-production.
// ---------------------------------------------------------------------------
function parseAllowedOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin / curl → CORS tidak relevan

  const allowed = parseAllowedOrigins();
  const isProd = process.env.VERCEL_ENV === 'production';

  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }

  // Origin tidak diizinkan: JANGAN set header allow → browser menolak respons.
  // Kalau non-production dan belum ada CORS_ORIGINS sama sekali, kasih log biar
  // salah konfigurasi ketahuan.
  if (!isProd && allowed.length === 0) {
    log.warn('cors_origin_rejected_dev', { origin });
  }
  if (req.method === 'OPTIONS') return res.status(204).end(); // preflight gagal diam
  return next();
}

// ---------------------------------------------------------------------------
// Request log terstruktur (satu baris JSON per request)
// ---------------------------------------------------------------------------
function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    log.info('request', {
      request_id: req.id,
      method: req.method,
      path: req.originalUrl ? req.originalUrl.split('?')[0] : req.url,
      status: res.statusCode,
      duration_ms: Math.round(durMs),
      ip: clientIp(req),
      user_id: req.user ? req.user.id : undefined,
      key_id: req.apiKey ? req.apiKey.id : undefined,
    });
    require('./metrics').recordRequest({
      status: res.statusCode,
      durationMs: durMs,
      errorCode: res.locals && res.locals.error_code,
      authType: req.apiKey ? 'api_key' : req.user ? 'jwt' : 'anon',
    });
  });
  next();
}

// ---------------------------------------------------------------------------
// Body size guard — express.json sendiri punya limit, tapi kita pakai batas
// lebih ketat dan error yang konsisten.
// ---------------------------------------------------------------------------
function bodyLimit(req, res, next) {
  const len = Number(req.headers['content-length'] || 0);
  if (len > 16 * 1024) {
    const e = new Error('Body terlalu besar.');
    e.status = 413;
    e.code = 'PAYLOAD_TOO_LARGE';
    return next(e);
  }
  next();
}

// ---------------------------------------------------------------------------
// Error handler terpusat — format respons standar, aman untuk produksi.
// ---------------------------------------------------------------------------
const STATUS_CODES = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' },
    request_id: req.id,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Error dgn .status (dari fail() downloader, rate limiter, validasi) → hormati.
  const status = err.status || 500;
  const code = err.code || STATUS_CODES[status] || 'INTERNAL_ERROR';
  // Untuk metrics (Phase 7): kategori error tersedia saat request 'finish'.
  res.locals = res.locals || {};
  res.locals.error_code = code;

  // Log detail lengkap secara internal; balikin pesan aman ke klien.
  const safeMessage = status < 500 ? err.message : 'Terjadi kesalahan internal.';
  log.error('request_error', {
    request_id: req.id,
    method: req.method,
    path: req.originalUrl ? req.originalUrl.split('?')[0] : req.url,
    status,
    error_code: code,
    error: status >= 500 ? String(err.message) : undefined,
    stack: status >= 500 && process.env.VERCEL_ENV !== 'production' ? err.stack : undefined,
  });

  if (res.headersSent) return; // jangan crash kalau respons mulai terkirim
  res.status(status).json({
    success: false,
    error: { code, message: safeMessage },
    request_id: req.id,
  });
}

module.exports = {
  requestId,
  securityHeaders,
  cors,
  requestLogger,
  bodyLimit,
  notFoundHandler,
  errorHandler,
};
