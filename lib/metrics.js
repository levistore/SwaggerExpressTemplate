// Lightweight in-memory metrics (Phase 7) — BOUNDED, instance-local.
//
// Sumber data:
//  - api_usage (PostgreSQL) = source of truth riwayat per-request (sudah ada
//    sejak Phase 3, fire-and-forget). TIDAK ada duplikasi tracking per-request.
//  - Layer ini hanya menambah agregat realtime ringan untuk ops dashboard:
//    latensi p50/p95, distribusi status, error kategori, provider & webhook.
//
// Serverless reality: data in-memory per-instance & hilang saat instance
// cold-start. BUKAN global monitoring — didokumentasikan jujur.

const RING_MAX = 2000; // bounded — mencegah memory growth
const ring = [];       // { t, status, dur, code, auth }
const counters = {
  requests: 0, success: 0, failed: 0,
  provider: {},   // name -> { total, success, fail, timeout, retry, ms_sum }
  webhook: { total: 0, success: 0, failed: 0, ms_sum: 0, retry: 0 },
  rejected: { QUOTA_EXCEEDED: 0, RATE_LIMITED: 0, SSRF_BLOCKED: 0 },
};

function recordRequest({ status, durationMs, errorCode, authType }) {
  counters.requests++;
  if (status < 400) counters.success++; else counters.failed++;
  const entry = {
    t: Date.now(),
    s: status,
    d: Math.round(durationMs),
    c: status >= 400 ? String(errorCode || 'HTTP_' + status).slice(0, 40) : undefined,
    a: authType ? String(authType).slice(0, 10) : 'anon',
  };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  if (status === 429 && errorCode === 'QUOTA_EXCEEDED') counters.rejected.QUOTA_EXCEEDED++;
  else if (status === 429) counters.rejected.RATE_LIMITED++;
  else if (errorCode === 'SSRF_BLOCKED') counters.rejected.SSRF_BLOCKED++;
}

function recordProvider(name, { ok, timeout, retry, durationMs }) {
  const p = counters.provider[name] || (counters.provider[name] = { total: 0, success: 0, fail: 0, timeout: 0, retry: 0, ms_sum: 0 });
  p.total++;
  if (ok) p.success++; else p.fail++;
  if (timeout) p.timeout++;
  if (retry) p.retry++;
  p.ms_sum += Math.round(durationMs || 0);
}

function recordWebhookDelivery({ ok, retry, durationMs }) {
  counters.webhook.total++;
  if (ok) counters.webhook.success++; else counters.webhook.failed++;
  if (retry) counters.webhook.retry++;
  counters.webhook.ms_sum += Math.round(durationMs || 0);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function snapshot() {
  const durs = ring.map((r) => r.d).sort((a, b) => a - b);
  const statuses = {};
  const errors = {};
  for (const r of ring) {
    const bucket = `${Math.floor(r.s / 100)}xx`;
    statuses[bucket] = (statuses[bucket] || 0) + 1;
    if (r.c) errors[r.c] = (errors[r.c] || 0) + 1;
  }
  const provider = {};
  for (const [name, p] of Object.entries(counters.provider)) {
    provider[name] = {
      total: p.total, success: p.success, failures: p.fail, timeouts: p.timeout, retries: p.retry,
      avg_ms: p.total ? Math.round(p.ms_sum / p.total) : null,
    };
  }
  const w = counters.webhook;
  return {
    instance_local: true,
    window_note: 'agregat realtime instance ini saja (bounded ring 2000 request terakhir)',
    requests: { total: counters.requests, success: counters.success, failed: counters.failed },
    latency: { p50_ms: percentile(durs, 50), p95_ms: percentile(durs, 95), max_ms: durs[durs.length - 1] || null },
    status_distribution: statuses,
    error_categories: errors,
    rejected: counters.rejected,
    providers: provider,
    webhooks: {
      total: w.total, success: w.success, failed: w.failed, retries: w.retry,
      avg_ms: w.total ? Math.round(w.ms_sum / w.total) : null,
    },
  };
}

module.exports = { recordRequest, recordProvider, recordWebhookDelivery, snapshot, RING_MAX };
