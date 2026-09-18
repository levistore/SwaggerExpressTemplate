// Quota per API key (Phase 3) — mekanisme internal, TANPA billing/payment.
//
// Lapisan:
//   1. Rate limit per-menit per key (in-memory sliding window, sama seperti
//      rate limiter Phase 1 — limitation per-instance tetap berlaku & tercatat).
//   2. Daily quota per key (dari tabel api_usage, reset tiap tengah malam UTC).
//
// Default: 60 req/menit, 1000 req/hari per key. Bisa dioverride per key via
// kolom api_keys.rate_limit_per_min / daily_quota (migration 007).
//
// Penolakan: 429 format standar {success:false,error:{code:QUOTA_EXCEEDED|RATE_LIMITED}}.
// JWT requests tidak melewati quota ini (quota = kontrol untuk API key).
const { rateLimit, clientIp } = require('./ratelimit');
const usage = require('./usage');

const DEFAULT_PER_MIN = 60;
const DEFAULT_DAILY = 1000;

/** Sliding window per key — reuse pola limiter Phase 1. */
const buckets = new Map();
const WINDOW_MS = 60_000;

function perMinuteLimiter(maxPerMin) {
  return function (req, res, next) {
    const key = 'keyquota:' + req.auth.keyId;
    const now = Date.now();
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    while (arr.length > 0 && now - arr[0] >= WINDOW_MS) arr.shift();
    if (arr.length >= maxPerMin) {
      const retryAfter = Math.ceil((WINDOW_MS - (now - arr[0])) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
      const e = new Error('Kuota API key per menit tercapai (' + maxPerMin + '/menit).');
      e.status = 429;
      e.code = 'QUOTA_EXCEEDED';
      return next(e);
    }
    arr.push(now);
    return next();
  };
}

/**
 * Middleware lengkap: panggil SETELAH requireAuth (butuh req.auth.type === 'api_key').
 * JWT lolos langsung. Key revoked/expired sudah ditolak requireAuth sebelum sini.
 */
function keyQuota(req, res, next) {
  if (!req.auth || req.auth.type !== 'api_key') return next();

  dbKeyLimits(req)
    .then((limits) => {
      const { perMin, daily } = limits;
      res.setHeader('X-Quota-Daily-Limit', String(daily));

      // 1. per-minute (in-memory)
      perMinuteLimiter(perMin)(req, res, (err) => {
        if (err) return next(err);
        // 2. daily (DB count — cached 30 dtk per key supaya murah)
        dailyCountCached(req.auth.keyId, daily)
          .then((used) => {
            res.setHeader('X-Quota-Daily-Remaining', String(Math.max(daily - used, 0)));
            if (used >= daily) {
              const e = new Error('Kuota harian API key tercapai (' + daily + '/hari). Reset tengah malam UTC.');
              e.status = 429;
              e.code = 'QUOTA_EXCEEDED';
              return next(e);
            }
            next();
          })
          .catch(() => next()); // DB quota check gagal → jangan blok request
      });
    })
    .catch(() => next());
}

// Kolom limits di-cache 5 menit per key (hindari query ekstra tiap request).
const limitsCache = new Map();
const LIMITS_TTL = 300_000;

async function dbKeyLimits(req) {
  const cacheKey = req.auth.keyId;
  const hit = limitsCache.get(cacheKey);
  if (hit && Date.now() - hit.t < LIMITS_TTL) return hit.v;
  const db = require('./db');
  const { rows } = await db.query(
    `select rate_limit_per_min, daily_quota from api_keys where id = $1`,
    [req.auth.keyId]
  );
  const v = {
    perMin: (rows[0] && rows[0].rate_limit_per_min) || DEFAULT_PER_MIN,
    daily: (rows[0] && rows[0].daily_quota) || DEFAULT_DAILY,
  };
  limitsCache.set(cacheKey, { t: Date.now(), v });
  return v;
}

// Daily count cache 30 dtk per key.
const dailyCache = new Map();
const DAILY_TTL = 30_000;

function dailyCountCached(keyId, daily) {
  const hit = dailyCache.get(keyId);
  if (hit && Date.now() - hit.t < DAILY_TTL) return Promise.resolve(hit.n);
  return usage.dailyCountForKey(keyId).then((n) => {
    dailyCache.set(keyId, { t: Date.now(), n });
    return n;
  });
}

module.exports = { keyQuota, DEFAULT_PER_MIN, DEFAULT_DAILY };
