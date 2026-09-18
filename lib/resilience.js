// Provider resilience (Phase 5): timeout policy, retry aman, circuit breaker,
// health tracking — semua INSTANCE-LOCAL (Vercel serverless ephemeral).
//
// JUJUR: state di sini per-instance, BUKAN distributed. Tidak ada Redis
// (dibatalkan sebagai keputusan proyek). Manfaat nyata yang tetap didapat:
//  - bound timeout terpusat (request tak bisa menggantung)
//  - retry hanya utk error transient, bounded + backoff + jitter
//  - instance hangat berhenti menembak provider yang sedang down (breaker)
//  - metrics latency/success rate per provider (log + /api/health internal)
//
// TIDAK menyimpan URL user, credential, header, atau data personal.

const DEFAULT_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Error categories (normalisasi) — kategori ini yang boleh sampai ke client.
// ---------------------------------------------------------------------------
const ERR = {
  TIMEOUT: 'PROVIDER_TIMEOUT',
  UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  BAD_RESPONSE: 'PROVIDER_BAD_RESPONSE',
  UNSUPPORTED: 'PROVIDER_UNSUPPORTED',
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
};

function providerError(category, message, status = 502) {
  const e = new Error(message);
  e.code = category;
  e.status = status;
  return e;
}

/** Klasifikasi error mentah → kategori internal. */
function classify(err) {
  if (err && err.code && String(err.code).startsWith('PROVIDER_')) return err.code;
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return ERR.TIMEOUT;
  const status = err && err.status;
  if (status === 429) return ERR.RATE_LIMITED;
  if (status >= 500) return ERR.UNAVAILABLE;
  if (typeof err && err instanceof TypeError) return ERR.UNAVAILABLE; // fetch network fail
  return ERR.BAD_RESPONSE;
}

// ---------------------------------------------------------------------------
// Circuit breaker — per provider, instance-local, bounded memory.
// CLOSED → OPEN (threshold failures) → HALF_OPEN setelah cooldown → recovery.
// ---------------------------------------------------------------------------
const BREAKER_THRESHOLD = 5;     // failure berturut-turut sebelum open
const BREAKER_COOLDOWN_MS = 30_000; // setelah ini → half_open (coba lagi)

const breakers = new Map(); // name -> {state, fails, openedAt, lastRecovery}

function breakerState(name) {
  let b = breakers.get(name);
  if (!b) { b = { state: 'closed', fails: 0, openedAt: 0 }; breakers.set(name, b); }
  return b;
}

/** Boleh request keluar? Return {allow, state}. HALF_OPEN = izinkan 1 probe. */
function breakerCheck(name) {
  const b = breakerState(name);
  if (b.state === 'open' && Date.now() - b.openedAt >= BREAKER_COOLDOWN_MS) {
    b.state = 'half_open';
  }
  return { allow: b.state !== 'open', state: b.state };
}

/** Catat hasil percobaan ke breaker. */
function breakerRecord(name, ok) {
  const b = breakerState(name);
  if (ok) {
    if (b.state === 'half_open') b.state = 'closed';
    b.fails = 0;
  } else {
    b.fails += 1;
    if (b.fails >= BREAKER_THRESHOLD || b.state === 'half_open') {
      b.state = 'open';
      b.openedAt = Date.now();
    }
  }
  return b.state;
}

// ---------------------------------------------------------------------------
// Health tracking — in-memory ring counters per provider (bounded).
// ---------------------------------------------------------------------------
const health = new Map(); // name -> counters

function healthRecord(name, outcome, durationMs) {
  let h = health.get(name);
  if (!h) { h = { total: 0, ok: 0, fail: 0, timeout: 0, msSum: 0, lastFailureAt: null, lastErrorCategory: null }; health.set(name, h); }
  h.total += 1;
  h.msSum += durationMs;
  if (outcome === 'ok') h.ok += 1;
  else {
    h.fail += 1;
    h.lastFailureAt = new Date().toISOString();
    h.lastErrorCategory = outcome === 'timeout' ? ERR.TIMEOUT : outcome;
    if (outcome === 'timeout') h.timeout += 1;
  }
  return h;
}

function healthSnapshot() {
  const out = {};
  for (const [name, h] of health) {
    out[name] = {
      total: h.total,
      ok: h.ok,
      fail: h.fail,
      timeout: h.timeout,
      avg_ms: h.total ? Math.round(h.msSum / h.total) : 0,
      last_failure_at: h.lastFailureAt,
      last_error_category: h.lastErrorCategory,
      breaker: (breakers.get(name) || {}).state || 'closed',
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Retry — HANYA transient (timeout / network / upstream 5xx / 429).
// 4xx permanen, SSRF rejection, input invalid: TIDAK pernah di-retry.
// ---------------------------------------------------------------------------
const RETRY_MAX = 2;            // total attempts maks = 1 + RETRY_MAX
const RETRY_BASE_MS = 250;

function isTransient(err) {
  const c = classify(err);
  return c === ERR.TIMEOUT || c === ERR.UNAVAILABLE || c === ERR.RATE_LIMITED;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * fetch dengan timeout policy + retry bounded + jitter.
 * @param {string} providerName nama logis provider (untuk breaker/health/log)
 * @param {string} url
 * @param {object} opts    opsi fetch (method/headers/body) — redirect ditambahkan di sini
 * @param {object} policy  { timeoutMs, retries, onFetch (opsional: validasi respons) }
 * onFetch(response) boleh throw — error-nya diklasifikasi juga.
 */
async function providerFetch(providerName, url, opts = {}, policy = {}) {
  const timeoutMs = policy.timeoutMs || DEFAULT_TIMEOUT_MS;
  const retries = policy.retries !== undefined ? policy.retries : RETRY_MAX;

  const breaker = breakerCheck(providerName);
  if (!breaker.allow) {
    if (!policy.silentMetrics) require('./metrics').recordProvider(providerName, { ok: false, timeout: false, retry: false, durationMs: 0 });
    const e = providerError(ERR.UNAVAILABLE,
      'Layanan sumber sedang tidak tersedia. Coba lagi beberapa saat lagi.');
    e.breaker = 'open';
    throw e;
  }

  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        ...opts,
        redirect: 'manual', // SSRF: redirect tidak pernah diikuti otomatis
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const e = new Error('redirect tidak diikuti');
        e.status = 502;
        throw e;
      }
      if (policy.onFetch) await policy.onFetch(res);
      const dur = Date.now() - t0;
      healthRecord(providerName, 'ok', dur);
      breakerRecord(providerName, true);
      if (!policy.silentMetrics) require('./metrics').recordProvider(providerName, { ok: true, timeout: false, retry: false, durationMs: dur });
      return res;
    } catch (err) {
      const dur = Date.now() - t0;
      const cat = classify(err);
      healthRecord(providerName, cat === ERR.TIMEOUT ? 'timeout' : cat, dur);
      lastErr = err;
      if (!policy.silentMetrics) require('./metrics').recordProvider(providerName, { ok: false, timeout: cat === ERR.TIMEOUT, retry: isTransient(err) && attempt < retries, durationMs: dur });
      if (!isTransient(err) || attempt === retries) break;
      // exponential backoff + jitter (maks ~1s) — anti retry-storm
      const backoff = Math.min(RETRY_BASE_MS * Math.pow(2, attempt), 1000) + Math.floor(Math.random() * 200);
      await delay(backoff);
    }
  }
  const openState = breakerRecord(providerName, false);
  const e = providerError(classify(lastErr),
    'Sumber data gagal atau tidak merespons. Coba lagi nanti.');
  e.breaker = openState;
  throw e;
}

module.exports = {
  ERR, providerError, classify,
  DEFAULT_TIMEOUT_MS,
  breakerCheck, breakerRecord, breakerState,
  healthRecord, healthSnapshot,
  isTransient, providerFetch,
  RETRY_MAX,
};
