#!/usr/bin/env node
/**
 * Phase 6 tests — contract, idempotency, webhooks, OpenAPI, security regression.
 *   BASE=http://127.0.0.1:3311 node --env-file=.env.local tests/phase6.test.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
const crypto = require('crypto');
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NOT OK -', name, extra !== undefined ? JSON.stringify(extra).slice(0, 160) : ''); }
}
async function req(path, opts = {}, headers = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.20.' + (1 + Math.floor(Math.random() * 250)), ...headers },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, headers: r.headers };
}
const idem = () => crypto.randomBytes(10).toString('hex');

(async () => {
  console.log('A. OpenAPI contract');
  const docs = await req('/api/docs.json');
  ok(docs.status === 200 && docs.body.openapi, 'docs.json tersedia + openapi version', docs.body.openapi);
  const paths = Object.keys(docs.body.paths || {});
  for (const p of ['/api/auth/register', '/api/auth/login', '/api/keys', '/api/webhooks', '/api/webhooks/{id}', '/api/keys/{id}/rotate', '/api/v1/dashboard/overview']) {
    ok(paths.includes(p), `path terdokumentasi: ${p}`);
  }
  const sec = docs.body.components?.securitySchemes || {};
  ok(sec.bearerAuth && sec.apiKeyAuth, 'securitySchemes bearer + apiKey');
  const schemas = docs.body.components?.schemas || {};
  for (const s of ['SuccessResponse', 'ErrorResponse', 'User', 'APIKey', 'Webhook', 'HealthResponse']) {
    ok(!!schemas[s], `schema reusable: ${s}`);
  }
  const errSchema = JSON.stringify(schemas.ErrorResponse || {});
  ok(errSchema.includes('code') && errSchema.includes('request_id'), 'ErrorResponse punya code+request_id');

  console.log('B. Envelope & request_id');
  const stamp = Date.now();
  const reg = await req('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name: 'P6', email: `p6c${stamp}@lcode.test`, password: 'Testpass123' }) });
  ok(reg.status === 201 && reg.body.request_id && typeof reg.body.request_id === 'string', 'v1 register: envelope + request_id', reg.body);
  ok(reg.body.success === true && 'data' in reg.body, 'success envelope benar');
  const tok = (reg.body.data && reg.body.data.token) || reg.body.token;
  const err = await req('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: `p6c${stamp}@lcode.test`, password: 'salahbanget123' }) });
  ok(err.status === 401 && err.body.success === false && err.body.error.code && err.body.request_id, 'error envelope benar (code+request_id)', err.body);
  const legacy = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: `p6c${stamp}@lcode.test`, password: 'Testpass123' }) });
  ok(legacy.status === 200, 'legacy login tetap bekerja');

  console.log('C. Idempotency');
  const H = (k) => ({ authorization: 'Bearer ' + tok, 'idempotency-key': k });
  const key1 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'idem-a' }) }, H(idem()));
  const K = key1.headers.get('x-idempotency-replayed');
  const key2 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'idem-a' }) }, H(key1._k || ''));
  // gunakan key literal yang sama via manual header:
  const ik = 'phase6-key-' + idem();
  const c1 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'idem-b' }) }, { authorization: 'Bearer ' + tok, 'idempotency-key': ik });
  const c2 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'idem-b' }) }, { authorization: 'Bearer ' + tok, 'idempotency-key': ik });
  ok(c1.status === 201 && c2.status === 201 && c2.body.id === c1.body.id, 'replay: id konsisten', [c1.body.id, c2.body.id]);
  ok(c1.body.key === c2.body.key, 'replay: raw key konsisten (disimpan server-side, bukan generate ulang)');
  ok(c1.body.key !== c2.body.key ? false : true, 'raw key replay identik');
  const c3 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'beda-payload' }) }, { authorization: 'Bearer ' + tok, 'idempotency-key': ik });
  ok(c3.status === 409, 'key sama + payload beda → 409', c3.status);
  const c4 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'x' }) }, { authorization: 'Bearer ' + tok, 'idempotency-key': 'pendek' });
  ok(c4.status === 400, 'idempotency key invalid → 400');
  // cross-user isolation
  const regB = await req('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name: 'P6B', email: `p6d${stamp}@lcode.test`, password: 'Testpass123' }) });
  const tokB = (regB.body.data && regB.body.data.token) || regB.body.token;
  const c5 = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'idem-b' }) }, { authorization: 'Bearer ' + tokB, 'idempotency-key': ik });
  ok(c5.status === 201 && c5.body.id !== c1.body.id, 'idempotency scoped per user (cross-user tidak replay)', c5.status);
  // rotate idempotent
  const rk = 'phase6-rot-' + idem();
  const r1 = await req(`/api/keys/${c1.body.id}/rotate`, { method: 'POST' }, { authorization: 'Bearer ' + tok, 'idempotency-key': rk });
  const r2 = await req(`/api/keys/${c1.body.id}/rotate`, { method: 'POST' }, { authorization: 'Bearer ' + tok, 'idempotency-key': rk });
  ok(r1.status === 201 && r2.status === 201 && r1.body.key === r2.body.key, 'rotate idempotent replay');
  // GET tidak boleh punya efek idempotency (header diabaikan — tetap 200 normal)
  const g1 = await req('/api/keys', {}, { authorization: 'Bearer ' + tok, 'idempotency-key': 'get-no-effect-1234' });
  ok(g1.status === 200, 'GET dengan idempotency-key tetap normal');

  console.log('D. Webhooks');
  const wres = await req('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://httpbin.org/post', events: ['API_KEY_CREATED'] }) }, { authorization: 'Bearer ' + tok });
  ok(wres.status === 201 && wres.body.secret && wres.body.secret.startsWith('whsec_'), 'webhook create + secret raw sekali-lihat', wres.body);
  const wlist = await req('/api/webhooks', {}, { authorization: 'Bearer ' + tok });
  ok(wlist.status === 200 && !JSON.stringify(wlist.body).includes(wres.body.secret), 'list TIDAK mengandung secret raw');
  ok(wlist.body[0].secret_prefix && !wlist.body[0].secret_hash, 'list: prefix ada, hash tidak diekspos', wlist.body[0]);
  const ssrf = await req('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:9/x', events: ['API_KEY_CREATED'] }) }, { authorization: 'Bearer ' + tok });
  ok(ssrf.status === 400, 'webhook loopback ditolak');
  const ssrf2 = await req('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://169.254.169.254/x', events: ['API_KEY_CREATED'] }) }, { authorization: 'Bearer ' + tok });
  ok(ssrf2.status === 400, 'webhook metadata IP ditolak');
  const badEv = await req('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://httpbin.org/post', events: ['NOT_AN_EVENT'] }) }, { authorization: 'Bearer ' + tok });
  ok(badEv.status === 400, 'event tidak dikenal ditolak');
  // cross-user IDOR
  const wB = await req(`/api/webhooks/${wres.body.id}`, { method: 'DELETE' }, { authorization: 'Bearer ' + tokB });
  ok(wB.status === 404, 'IDOR: webhook user lain tak bisa dihapus', wB.status);
  const wDel = await req(`/api/webhooks/${wres.body.id}`, { method: 'DELETE' }, { authorization: 'Bearer ' + tok });
  ok(wDel.status === 204, 'hapus webhook milik sendiri');

  console.log('E. Signature util');
  const W = require('../lib/webhooks');
  const sig = W.signPayload('secret', 'payload');
  ok(sig.startsWith('sha256=') && sig.length === 71, 'format X-LCODE-Signature: sha256=<hex>', sig.slice(0, 15));
  const { createHmac } = crypto;
  const expected = 'sha256=' + createHmac('sha256', 'secret').update('payload').digest('hex');
  ok(sig === expected, 'signature = HMAC-SHA256 raw body');

  console.log('F. Security regression');
  const ssrfDl = await req('/api/v1/download/tiktok?url=http://169.254.169.254/x', {}, { authorization: 'Bearer ' + tok });
  ok(ssrfDl.status === 400, 'downloader SSRF tetap diblok');
  const noAuth = await req('/api/webhooks');
  ok(noAuth.status === 401, 'webhooks tanpa auth → 401');

  console.log(`\n== PHASE 6: ${pass} lolos, ${fail} gagal ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
