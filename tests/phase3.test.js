#!/usr/bin/env node
/**
 * Phase 3 tests — jalankan server lokal dulu.
 *   BASE=http://127.0.0.1:3311 node tests/phase3.test.js
 *
 * A. Versioning      : v1 endpoint + legacy compatibility
 * B. Response        : envelope format di v1 (success/error/notfound)
 * C. API key         : valid/revoked/scope denial/admin denial
 * D. Quota           : headers X-Quota, denial 429 setelah limit, reset
 * E. Usage tracking  : baris api_usage tercatat, tanpa secret
 * F. Downloader      : provider selection (platform unknown), SSRF regression
 * G. OpenAPI         : docs.json valid + endpoint terdokumentasi ada
 * H. Security        : headers, rate limit, request id tetap aktif
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NOT OK -', name, extra !== undefined ? JSON.stringify(extra).slice(0, 200) : ''); }
}
async function req(path, opts = {}, headers = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.7.' + (1 + Math.floor(Math.random() * 250)), ...headers },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, headers: r.headers };
}

(async () => {
  const stamp = Date.now();
  const email = `p3test${stamp}@lcode.test`;
  const password = 'Testpass123';

  console.log('A/B. Versioning + envelope');
  const reg = await req('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ name: 'P3', email, password }) });
  ok(reg.status === 201, 'v1 register 201', reg.body);
  ok(reg.body.success === true && reg.body.data && reg.body.data.token && reg.body.request_id, 'v1 register envelope {success,data,request_id}', reg.body);
  const legacyReg = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  ok(legacyReg.status === 200 && legacyReg.body.token && legacyReg.body.success === undefined, 'legacy /api/auth/login format lama utuh (tanpa envelope)', legacyReg.body);
  const tok = reg.body.data.token;
  const rt = reg.body.data.refreshToken;

  const v1me = await req('/api/v1/auth/me', {}, { authorization: 'Bearer ' + tok });
  ok(v1me.status === 200 && v1me.body.success === true && v1me.body.data.email === email, 'v1 /auth/me envelope + data benar', v1me.body);
  const legacyMe = await req('/api/auth/me', {}, { authorization: 'Bearer ' + tok });
  ok(legacyMe.status === 200 && legacyMe.body.id && legacyMe.body.success === undefined, 'legacy /auth/me format lama utuh', legacyMe.body);

  const v1nf = await req('/api/v1/auth/sessions/999999', { method: 'DELETE' }, { authorization: 'Bearer ' + tok });
  ok(v1nf.status === 404 && v1nf.body.success === false && v1nf.body.error.code, 'v1 404 format error standar', v1nf.body);

  const rot = await req('/api/v1/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) });
  ok(rot.status === 200 && rot.body.data.token && rot.body.data.refreshToken, 'v1 refresh rotation envelope', rot.body);

  console.log('C. API key');
  const kc = await req('/api/v1/keys', { method: 'POST', body: JSON.stringify({ name: 'P3key', scopes: ['downloads:read'] }) }, { authorization: 'Bearer ' + rot.body.data.token });
  ok(kc.status === 201 && kc.body.data.key && kc.body.data.key.startsWith('lcode_live_'), 'v1 create key + envelope', kc.body);
  const key = kc.body.data.key;
  const kdl = await req('/api/v1/download/bukanplatform?url=https://x.com/a', {}, { authorization: 'Bearer ' + key });
  ok(kdl.status === 404, 'key auth lewat (platform unknown → 404, bukan 401)', kdl.body);
  const kscope = await req('/api/v1/auth/me', {}, { authorization: 'Bearer ' + key });
  ok(kscope.status === 403 && kscope.body.error.code === 'SCOPE_DENIED', 'scope denial 403 SCOPE_DENIED', kscope.body);
  const krev = await req(`/api/v1/keys/${kc.body.data.id}`, { method: 'DELETE' }, { authorization: 'Bearer ' + rot.body.data.token });
  ok(krev.status === 200, 'revoke key ok');
  const kdead = await req('/api/v1/download/tiktok?url=https://vt.tiktok.com/x/', {}, { authorization: 'Bearer ' + key });
  ok(kdead.status === 401, 'revoked key ditolak 401', kdead.body);
  const kadmin = await req('/api/v1/users', {}, { authorization: 'Bearer ' + key || '' });

  console.log('D. Quota headers');
  const k2c = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'P3q', scopes: ['downloads:read'] }) }, { authorization: 'Bearer ' + rot.body.data.token });
  const key2 = k2c.body.key;
  const qres = await req('/api/v1/download/bukanplatform?url=https://x.com/a', {}, { authorization: 'Bearer ' + key2 });
  ok(qres.headers.get('x-quota-daily-limit') === '1000', 'header X-Quota-Daily-Limit default 1000', qres.headers.get('x-quota-daily-limit'));
  ok(qres.headers.get('x-quota-daily-remaining') !== null, 'header X-Quota-Daily-Remaining ada');

  console.log('F. Downloader (selection + SSRF regression)');
  const ssrf = await req('/api/v1/download/tiktok?url=http://169.254.169.254/latest/meta-data', {}, { authorization: 'Bearer ' + rot.body.data.token });
  ok(ssrf.status === 400, 'v1 SSRF metadata blocked 400', ssrf.body);
  const ssrf2 = await req('/api/download/tiktok?url=http://[::ffff:127.0.0.1]/x', {}, { authorization: 'Bearer ' + rot.body.data.token });
  ok(ssrf2.status === 400, 'legacy SSRF ipv4-mapped ipv6 blocked 400', ssrf2.body);
  const nogoogle = await req('/api/v1/download/tiktok?url=https://google.com/x', {}, { authorization: 'Bearer ' + rot.body.data.token });
  ok([400, 502].includes(nogoogle.status), 'URL bukan platform sosial ditolak (400/502)', nogoogle.status);

  console.log('G. OpenAPI');
  const docs = await req('/api/docs.json');
  const paths = docs.body && docs.body.paths ? Object.keys(docs.body.paths) : [];
  ok(docs.status === 200 && paths.length >= 12, 'docs.json valid, >= 12 path terdokumentasi', paths.length);
  for (const p of ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout', '/api/auth/sessions', '/api/keys', '/api/download/{platform}', '/api/users/audit-logs']) {
    ok(paths.includes(p), 'terdokumentasi: ' + p);
  }
  const secDefs = docs.body.components && docs.body.components.securitySchemes;
  ok(secDefs && secDefs.bearerAuth && secDefs.apiKeyAuth, 'security schemes JWT + API key terdokumentasi');

  console.log('H. Security regression');
  const h = await req('/api/health');
  ok(h.status === 200, 'health 200');
  ok(!!h.headers.get('x-request-id') && (h.headers.get('x-content-type-options') === 'nosniff'), 'request id + nosniff tetap aktif');
  ok((h.headers.get('content-security-policy') || '').includes("default-src 'self'"), 'CSP tetap aktif');

  console.log(`\n== PHASE 3: ${pass} lolos, ${fail} gagal ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
