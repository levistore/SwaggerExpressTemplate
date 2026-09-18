// Rate limiting ringan, tanpa dependency.
//
// CATATAN JUJUR UNTUK SERVERLESS:
// Store-nya in-memory per-instance function. Di Vercel, tiap instance punya
// memorinya sendiri dan bisa dingin/hangat, jadi limit ini BUKAN quota global
// yang presisi — dia penghalang pertama (first line of defense) yang tetap
// efektif karena trafik biasanya melewati sedikit instance hangat, dan tiap
// instance menegakkan limit-nya sendiri. Quota global presisi butuh store
// terdistribusi (Upstash/Redis) — itu infrastruktur baru, di luar Phase 1,
// dan disebut sebagai rekomendasi lanjutan.
//
// Desain:
//   - Sliding window sederhana (array timestamp per key, di-trim).
//   - Key default = IP (dari x-forwarded-for yang diset Vercel).
//   - Cleanup periodik biar nggak kebanyakan entry mati.
//   - Respons 429 format standar + header Retry-After.

const WINDOW_MS = 60_000;
const CLEANUP_EVERY_MS = 5 * 60_000;

const buckets = new Map(); // key -> array timestamp ms
let lastCleanup = Date.now();

function cleanup(now) {
  if (now - lastCleanup < CLEANUP_EVERY_MS) return;
  lastCleanup = now;
  for (const [k, arr] of buckets) {
    const alive = arr.filter((t) => now - t < WINDOW_MS);
    if (alive.length === 0) buckets.delete(k);
    else buckets.set(k, alive);
  }
}

/**
 * Bikin middleware limiter.
 * @param {number} max        jumlah request maksimum per window
 * @param {object} opts
 * @param {string} opts.scope nama scope buat log (auth, download, admin, api)
 * @param {(req)=>string} opts.keyFn  custom key (default: IP)
 */
function rateLimit(max, opts = {}) {
  const scope = opts.scope || 'api';
  // Identity default: API key (kalau ada) + IP. Key bocor tetap dibatasi
  // meski dipakai dari banyak IP, dan banyak developer di satu NAT tetap
  // dapat kuota per-key masing-masing.
  const keyFn = opts.keyFn || ((req) =>
    req.auth && req.auth.type === 'api_key'
      ? clientIp(req) + ':key' + req.auth.keyId
      : clientIp(req));

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    cleanup(now);

    const key = scope + ':' + (keyFn(req) || 'unknown');
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }

    // buang timestamp di luar window
    while (arr.length > 0 && now - arr[0] >= WINDOW_MS) arr.shift();

    if (arr.length >= max) {
      const retryAfter = Math.ceil((WINDOW_MS - (now - arr[0])) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', '0');
      const e = new Error('Terlalu banyak permintaan. Coba lagi sebentar lagi.');
      e.status = 429;
      e.code = 'RATE_LIMITED';
      return next(e);
    }

    arr.push(now);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(max - arr.length));
    return next();
  };
}

/** IP klien. Di Vercel, x-forwarded-for hop pertama adalah klien asli. */
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress || 'unknown';
}

module.exports = { rateLimit, clientIp };
