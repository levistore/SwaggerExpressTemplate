#!/usr/bin/env node
/**
 * Phase 7 tests — observability, ops endpoint, webhook abuse control,
 * metrics boundaries, security regression.
 *   BASE=http://127.0.0.1:3311 node --env-file=.env.local tests/phase7.test.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
const crypto = require('crypto');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NOT OK -', name, extra !== undefined ? JSON.stringify(extra).slice(0, 180) : ''); }
}
async function req(path, opts = {}, headers = {}) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.30.' + (1 + Math.floor(Math.random() * 250)), ...headers },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, headers: r.headers, ms: Date.now() - t0 };
}

(async () => {
  console.log('A. Metrics layer (unit)');
  const M = require('../lib/metrics');
  M.recordRequest({ status: 200, durationMs: 10 });
  M.recordRequest({ status: 429, durationMs: 20, errorCode: 'QUOTA_EXCEEDED' });
  M.recordRequest({ status: 400, durationMs: 5, errorCode: 'SSRF_BLOCKED' });
  M.recordProvider('unit-provider', { ok: true, timeout: false, retry: false, durationMs: 33 });
  M.recordWebhookDelivery({ ok: true, retry: false, durationMs: 111 });
  const snap = M.snapshot();
  ok(snap.requests.total === 3 && snap.requests.failed === 2, 'request counters', snap.requests);
  ok(snap.latency.p50_ms === 10, 'latency p50', snap.latency);
  ok(snap.rejected.QUOTA_EXCEEDED === 1 && snap.rejected.SSRF_BLOCKED === 1, 'rejection counters', snap.rejected);
  ok(snap.providers['unit-provider'].avg_ms === 33, 'provider metrics', snap.providers);
  ok(snap.webhooks.total === 1 && snap.webhooks.success === 1, 'webhook metrics', snap.webhooks);
  ok(snap.instance_local === true, 'flag instance-local jujur');
  // bounded ring
  for (let i = 0; i < 2100; i++) M.recordRequest({ status: 200, durationMs: 1 });
  ok(M.snapshot().requests.total > 2100 && M.RING_MAX === 2000, 'ring bounded (counter jalan, ring max 2000)');

  console.log('B. Ops endpoint (integration)');
  const stamp = Date.now();
  const reg = await req('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name: 'P7', email: `p7a${stamp}@lcode.test`, password: 'Testpass123' }) });
  const tok = (reg.body.data && reg.body.data.token) || reg.body.token;
  ok(reg.status === 201 && !!tok, 'register v1');
  // generate traffic supaya api_usage terisi
  await req('/api/v1/dashboard/overview', {}, { authorization: 'Bearer ' + tok });
  await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'ops-key' }) }, { authorization: 'Bearer ' + tok });
  const ops = await req('/api/v1/ops/summary?range=24h', {}, { authorization: 'Bearer ' + tok });
  ok(ops.status === 200 && ops.body.success === true, 'ops/summary 200 envelope');
  const d = ops.body.data;
  ok(d.traffic && typeof d.traffic.total === 'number' && d.traffic.total >= 2, 'traffic terisi dari api_usage (tanpa duplikasi tracking)', d.traffic);
  ok(d.traffic.latency && (d.traffic.latency.avg_ms !== null || d.traffic.latency.p95_ms !== null), 'latency metrics');
  ok(d.providers && typeof d.providers === 'object', 'provider health tersedia');
  ok(d.webhooks && typeof d.webhooks.total === 'number', 'webhook summary');
  ok(d.realtime && d.realtime.instance_local === true, 'realtime metrics dilampirkan + flag instance-local');
  const badRange = await req('/api/v1/ops/summary?range=999d', {}, { authorization: 'Bearer ' + tok });
  ok(badRange.status === 400, 'range arbitrary ditolak (hanya 24h/7d/30d)', badRange.status);
  const noAuth = await req('/api/v1/ops/summary');
  ok(noAuth.status === 401, 'ops tanpa auth → 401');
  // IDOR: user B tidak melihat data user A
  const regB = await req('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name: 'P7B', email: `p7b${stamp}@lcode.test`, password: 'Testpass123' }) });
  const tokB = (regB.body.data && regB.body.data.token) || regB.body.token;
  const opsB = await req('/api/v1/ops/summary?range=24h', {}, { authorization: 'Bearer ' + tokB });
  ok(opsB.body.data.traffic.total <= 2, 'ops user-scoped (B tidak melihat traffic A)', opsB.body.data.traffic);

  console.log('C. Webhook test abuse control');
  const w = await req('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://httpbin.org/post', events: ['API_KEY_CREATED'] }) }, { authorization: 'Bearer ' + tok });
  ok(w.status === 201, 'webhook create');
  const tr = await req(`/api/webhooks/${w.body.id}/test`, { method: 'POST' }, { authorization: 'Bearer ' + tok });
  ok(tr.status === 200 && typeof tr.body.delivered === 'boolean', 'test delivery bounded response', tr.body);
  const trB = await req(`/api/webhooks/${w.body.id}/test`, { method: 'POST' }, { authorization: 'Bearer ' + tokB });
  ok(trB.status === 404, 'cross-user webhook test ditolak (IDOR)', trB.status);

  console.log('D. Security regression');
  const ssrf = await req('/api/v1/download/tiktok?url=http://169.254.169.254/x', {}, { authorization: 'Bearer ' + tok });
  ok(ssrf.status === 400, 'SSRF metadata tetap diblok');
  const h = await req('/api/health');
  ok(h.status === 200 && h.body.status === 'ok' && !JSON.stringify(h.body).match(/postgres|@|password/i), 'health aman tanpa credential');
  ok(!!h.headers.get('x-request-id'), 'request id correlation tetap ada');
  const idemH = 'p7-idem-' + crypto.randomBytes(8).toString('hex');
  const i1 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'idem7' }) }, { authorization: 'Bearer ' + tok, 'idempotency-key': idemH });
  const i2 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'idem7' }) }, { authorization: 'Bearer ' + tok, 'idempotency-key': idemH });
  ok(i1.status === 201 && i2.status === 201 && i1.body.key === i2.body.key, 'idempotency race fix regression (replay konsisten)');

  console.log('E. Sensitive logging check');
  const fs = require('fs');
  const logSrc = fs.readFileSync('lib/middleware.js', 'utf8') + fs.readFileSync('lib/webhooks.js', 'utf8');
  ok(!/req\.headers\.authorization|req\.headers\.cookie|req\.body\.password/.test(logSrc), 'tidak ada authorization/cookie/password di log source');

  console.log(`\n== PHASE 7: ${pass} lolos, ${fail} gagal ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
