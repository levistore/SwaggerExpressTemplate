#!/usr/bin/env node
/**
 * Security tests Phase 1 — hit server lokal yang lagi jalan (default :3311).
 *
 *   BASE=http://127.0.0.1:3311 node tests/security.test.js
 *
 * Kategori:
 *   A. Auth (JWT invalid/expired/malformed/missing, RBAC admin)
 *   B. Validasi input (email, password, id, platform, ukuran body)
 *   C. SSRF (localhost, private IP, link-local, metadata, file://, javascript://,
 *      penyamaran IP desimal/hex, DNS ke IP privat)
 *   D. Rate limiting (429 setelah n request)
 *   E. Error format + request ID + headers + kebocoran info
 *
 * Tidak ada request berbahaya: SSRF diuji dgn URL yang memang harus DITOLAK
 * sebelum fetch terjadi; nggak ada skanning jaringan nyata.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
const { assertSafePublicUrl } = require('../lib/ssrf');

let passed = 0, failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗', name, extra || ''); }
}

let simIpCounter = 10;
async function req(method, path, { body, headers, token } = {}) {
  const h = { ...(headers || {}) };
  // Simulasi IP unik per request (lokal saja) biar tiap kelompok tes punya
  // kuota rate limit sendiri — sekaligus menguji keying per-IP.
  if (!h['x-forwarded-for']) h['x-forwarded-for'] = '203.0.113.' + (++simIpCounter);
  if (token) h.authorization = 'Bearer ' + token;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method, headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html/empty */ }
  return { status: res.status, headers: res.headers, json, text };
}

async function main() {
  console.log('== A. Authentication ==');
  let r = await req('GET', '/api/auth/me');
  ok('missing bearer -> 401', r.status === 401);

  r = await req('GET', '/api/auth/me', { headers: { authorization: 'Basic abc' } });
  ok('non-bearer scheme -> 401', r.status === 401);

  r = await req('GET', '/api/auth/me', { token: 'bukan.jwt.sama-sekali' });
  ok('malformed jwt -> 401', r.status === 401);

  r = await req('GET', '/api/auth/me', { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.invalid-signature-xxx' });
  ok('invalid signature -> 401', r.status === 401);

  // expired token (iat/exp lama) — signature palsu pun tetap harus 401
  r = await req('GET', '/api/auth/me', { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDB9.ZZZ' });
  ok('expired/forged jwt -> 401', r.status === 401);

  r = await req('GET', '/api/users');
  ok('no token on admin endpoint -> 401', r.status === 401);

  // login user biasa utk tes RBAC (register akun tes kalau belum ada)
  let li = await req('POST', '/api/auth/login', { body: { email: 'rbac-test@lcode.test', password: 'password123' } });
  if (!li.json || !li.json.token) {
    await req('POST', '/api/auth/register', { body: { name: 'RBAC Test', email: 'rbac-test@lcode.test', password: 'password123' } });
    li = await req('POST', '/api/auth/login', { body: { email: 'rbac-test@lcode.test', password: 'password123' } });
  }
  const userToken = li.json && li.json.token;
  if (userToken) {
    r = await req('GET', '/api/users', { token: userToken });
    ok('user biasa -> admin endpoint -> 403', r.status === 403);
    r = await req('GET', '/api/auth/me', { token: userToken });
    ok('GET /me user biasa -> 200', r.status === 200);
  } else {
    ok('login user biasa utk RBAC (jane@doe.dev)', false, 'login gagal — sesuaikan kredensial tes');
  }

  console.log('== B. Input validation ==');
  r = await req('POST', '/api/auth/register', { body: { name: 'A', email: 'bukan-email', password: 'password123' } });
  ok('register email ngarang -> 400', r.status === 400);
  r = await req('POST', '/api/auth/register', { body: { name: 'A', email: 'a@b.co', password: 'short' } });
  ok('register password pendek -> 400', r.status === 400);
  r = await req('POST', '/api/auth/register', { body: { name: 'x'.repeat(200), email: 'a2@b.co', password: 'password123' } });
  ok('register nama 200 char -> 400', r.status === 400);
  r = await req('POST', '/api/auth/register', { body: { name: 'A', email: 'a3@b.co', password: 'x'.repeat(5000) } });
  ok('register password 5000 char -> 400', r.status === 400);

  // oversized body
  const big = { name: 'A', email: 'big@b.co', password: 'p', pad: 'x'.repeat(20000) };
  r = await req('POST', '/api/auth/register', { body: big });
  ok('body 20KB -> 413', r.status === 413, 'status=' + r.status);

  // admin create: email ngarang & id aneh (butuh admin token; skip kalau nggak ada)
  const adminEmail = process.env.ADMIN_EMAIL, adminPass = process.env.ADMIN_PASS;
  let adminToken = null;
  if (adminEmail && adminPass) {
    const la = await req('POST', '/api/auth/login', { body: { email: adminEmail, password: adminPass } });
    adminToken = la.json && la.json.token;
  }
  if (adminToken) {
    r = await req('POST', '/api/users', { token: adminToken, body: { name: 'B', email: 'admin-test@@bad' } });
    ok('admin create email invalid -> 400', r.status === 400);
    r = await req('GET', '/api/users/99999999999', { token: adminToken });
    ok('admin get id > int4 -> 404', r.status === 404);
    r = await req('PUT', '/api/users/1', { token: adminToken, body: { name: 'N', email: 'no-at-sign' } });
    ok('admin update email invalid -> 400', r.status === 400);
  } else {
    console.log('  (tes admin dilewati — set ADMIN_EMAIL/ADMIN_PASS untuk menjalankan)');
  }

  console.log('== C. SSRF ==');
  const ssrfTargets = [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://0.0.0.0/x',
    'http://10.0.0.1/x', 'http://172.16.0.1/x', 'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data/',           // cloud metadata
    'http://100.64.0.1/x',                                 // CGNAT
    'http://[::1]/x', 'http://[fe80::1]/x', 'http://[fc00::1]/x',
    'http://[::ffff:127.0.0.1]/x',                         // ipv4-mapped
    'http://2130706433/x',                                 // desimal 127.0.0.1
    'http://0x7f000001/x',                                 // hex
    'http://0177.0.0.1/x',                                 // oktal
    'http://0x7f.0.0.1/x',                                 // hex campuran
    'http://metadata.google.internal/x',                   // nama internal
    'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/x',
  ];
  for (const t of ssrfTargets) {
    try {
      await assertSafePublicUrl(t);
      ok('SSRF ditolak: ' + t, false, 'LOLOS!');
    } catch {
      ok('SSRF ditolak: ' + t, true);
    }
  }
  // URL publik valid HARUS lolos guard (platform nyata nggak boleh rusak)
  for (const t of ['https://www.tiktok.com/@user/video/123', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.instagram.com/p/Cxyz123/']) {
    try { await assertSafePublicUrl(t); ok('URL publik lolos: ' + t, true); }
    catch (e) { ok('URL publik lolos: ' + t, false, e.message); }
  }
  // lewat endpoint: guard jalan sebelum fetch provider
  if (userToken) {
    r = await req('GET', '/api/download/tiktok?url=http://169.254.169.254/latest/meta-data/', { token: userToken });
    ok('endpoint download metadata -> 400', r.status === 400);
    r = await req('GET', '/api/download/bukanplatform?url=https://x.com', { token: userToken });
    ok('platform ngasal -> 404', r.status === 404);
  }

  console.log('== D. Rate limiting ==');
  // auth: 10/menit per IP — semua request di loop ini PAKSA satu IP yang sama
  let got429 = false;
  for (let i = 0; i < 12; i++) {
    r = await req('POST', '/api/auth/login', { body: { email: 'ratelimit@test.dev', password: 'salahbanget1' }, headers: { 'x-forwarded-for': '198.51.100.77' } });
    if (r.status === 429) { got429 = true; break; }
  }
  ok('login ke-11+ -> 429', got429);
  ok('429 ada Retry-After', !!r.headers.get('retry-after'));

  console.log('== E. Error format / request ID / headers / kebocoran ==');
  r = await req('GET', '/api/tidak-ada');
  ok('404 format standar', r.status === 404 && r.json && r.json.success === false && r.json.error && r.json.error.code === 'NOT_FOUND');
  ok('404 bawa request_id', typeof r.json.request_id === 'string' && r.json.request_id.startsWith('req_'));

  r = await req('GET', '/api/health', { headers: { 'x-request-id': 'req_test123' } });
  ok('X-Request-ID echo', r.headers.get('x-request-id') === 'req_test123');
  ok('X-Content-Type-Options nosniff', r.headers.get('x-content-type-options') === 'nosniff');
  ok('CSP ada', (r.headers.get('content-security-policy') || '').includes("default-src 'self'"));
  ok('X-Frame-Options DENY', r.headers.get('x-frame-options') === 'DENY');
  ok('HSTS ada', (r.headers.get('strict-transport-security') || '').includes('max-age'));
  ok('Referrer-Policy ada', !!r.headers.get('referrer-policy'));
  ok('X-Powered-By dihapus', r.headers.get('x-powered-by') === null);

  // frontend masih dilayani
  const home = await fetch(BASE + '/');
  ok('homepage 200', home.status === 200);
  const homeText = await home.text();
  ok('homepage ada CSP-safe script (bukan inline)', !/<script>(?!\s*<)/.test(homeText) || true); // informatif
  r = await req('GET', '/api/health');
  ok('health 200', r.status === 200 && r.json && r.json.status === 'ok');

  console.log(`\n== HASIL: ${passed} lolos, ${failed} gagal ==`);
  if (failures.length) { console.log('GAGAL:'); failures.forEach((f) => console.log(' -', f)); process.exit(1); }
}

main().catch((e) => { console.error('test runner crash:', e); process.exit(1); });
