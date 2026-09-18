#!/usr/bin/env node
/**
 * Phase 2 tests — jalankan server lokal dulu (BASE env, default :3311).
 *   BASE=http://127.0.0.1:3311 node tests/phase2.test.js
 *
 * A. Sessions/refresh: valid, invalid, reuse, logout, logout-all, IDOR
 * B. API keys: create/list/rotate/revoke, scope denial, admin denial, raw leakage
 * C. Audit: events tercatat, request_id, tanpa secret
 * D. Endpoint baru Swagger/front: /api/keys terdaftar
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
let passed = 0, failed = 0;
const failures = [];
let simIp = 100;

function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; failures.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗', name, extra || ''); }
}

async function req(method, path, { body, token, headers } = {}) {
  const h = { ...(headers || {}) };
  h['x-forwarded-for'] = '198.18.9.' + (++simIp % 250);
  if (token) h.authorization = 'Bearer ' + token;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function main() {
  const stamp = Date.now();
  const email = `p2test${stamp}@lcode.test`;
  const pass = 'Testpass123';

  console.log('== A. Sessions & refresh token ==');
  let r = await req('POST', '/api/auth/register', { body: { name: 'P2 Test', email, password: pass } });
  ok('register dapat refreshToken', !!r.json.refreshToken);
  const rt1 = r.json.refreshToken;

  let r2 = await req('POST', '/api/auth/refresh', { body: { refreshToken: rt1 } });
  ok('refresh valid → token baru', r2.status === 200 && !!r2.json.token);
  const rt2 = r2.json.refreshToken;

  r = await req('POST', '/api/auth/refresh', { body: { refreshToken: rt1 } });
  ok('REUSE token lama → 401', r.status === 401);
  ok('reuse bawa kode REFRESH_REUSE_DETECTED', r.json.code === 'REFRESH_REUSE_DETECTED');

  r = await req('POST', '/api/auth/refresh', { body: { refreshToken: rt2 } });
  ok('token family setelah reuse juga mati → 401', r.status === 401);

  r = await req('POST', '/api/auth/refresh', { body: { refreshToken: 'ngasal-gak-valid-1234567890' } });
  ok('refresh invalid → 401', r.status === 401);

  r = await req('POST', '/api/auth/refresh', { body: {} });
  ok('refresh tanpa body → 400', r.status === 400);

  // login lagi untuk sesi bersih
  r = await req('POST', '/api/auth/login', { body: { email, password: pass } });
  const tok = r.json.token, rtLogin = r.json.refreshToken;
  r = await req('GET', '/api/auth/sessions', { token: tok });
  ok('sessions list metadata tanpa token', r.status === 200 && r.json.length >= 1 &&
     !JSON.stringify(r.json).includes('token_hash') && !JSON.stringify(r.json).includes('hash'));

  r = await req('DELETE', '/api/auth/sessions/99999999', { token: tok });
  ok('revoke sesi orang lain → 404 (anti-IDOR)', r.status === 404);

  // logout revoke
  r = await req('POST', '/api/auth/logout', { body: { refreshToken: rtLogin } });
  ok('logout 200', r.status === 200);
  r = await req('POST', '/api/auth/refresh', { body: { refreshToken: rtLogin } });
  ok('refresh setelah logout → 401', r.status === 401);

  // logout-all
  r = await req('POST', '/api/auth/login', { body: { email, password: pass } });
  const tok2 = r.json.token;
  await req('POST', '/api/auth/login', { body: { email, password: pass } });
  r = await req('POST', '/api/auth/logout-all', { token: tok2 });
  ok('logout-all 200', r.status === 200);
  r = await req('GET', '/api/auth/sessions', { token: tok2 });
  ok('semua sesi mati setelah logout-all', r.status === 200 && r.json.length === 0);

  // ganti password → sesi lain mati
  const l1 = await req('POST', '/api/auth/login', { body: { email, password: pass } });
  const l2 = await req('POST', '/api/auth/login', { body: { email, password: pass } });
  await req('PUT', '/api/auth/me', { token: l2.json.token, headers: { 'x-session-id': String(l2.json.sessionId) },
    body: { currentPassword: pass, password: 'Newpass1234' } });
  r = await req('POST', '/api/auth/refresh', { body: { refreshToken: l1.json.refreshToken } });
  ok('ganti password mematikan sesi lain', r.status === 401);
  await req('PUT', '/api/auth/me', { token: l2.json.token, body: { currentPassword: 'Newpass1234', password: pass } });

  console.log('== B. API keys ==');
  r = await req('POST', '/api/keys', { token: l2.json.token, body: { name: 'Test Key', scopes: ['downloads:read'] } });
  ok('create key 201 + format lcode_live_', r.status === 201 && r.json.key.startsWith('lcode_live_'));
  const rawKey = r.json.key, keyId = r.json.id;

  r = await req('GET', '/api/keys', { token: l2.json.token });
  ok('list tanpa raw/hash', r.status === 200 && !JSON.stringify(r.json).includes(rawKey) &&
     !JSON.stringify(r.json).includes('key_hash'));

  r = await req('GET', '/api/download/bukanplatform?url=https://x.com', { token: rawKey });
  ok('API key auth di endpoint download (404 platform ngasal)', r.status === 404);

  r = await req('PUT', '/api/auth/me', { token: rawKey, body: { name: 'Hack' } });
  ok('key tanpa scope profile:write → 403', r.status === 403);

  r = await req('GET', '/api/auth/me', { token: rawKey });
  ok('key tanpa scope profile:read → 403', r.status === 403);

  r = await req('GET', '/api/users', { token: rawKey });
  ok('API key ke admin endpoint → 403', r.status === 403);

  r = await req('POST', '/api/keys/' + keyId + '/rotate', { token: l2.json.token });
  ok('rotate 201 + raw baru', r.status === 201 && r.json.key.startsWith('lcode_live_'));
  const raw2 = r.json.key, newId = r.json.id;

  r = await req('GET', '/api/download/bukanplatform?url=https://x.com', { token: rawKey });
  ok('key lama mati setelah rotate', r.status === 401);

  r = await req('GET', '/api/auth/me', { token: 'lcode_live_fakefakefakefakefakefake123' });
  ok('key ngarang → 401', r.status === 401);

  r = await req('DELETE', '/api/keys/' + newId, { token: l2.json.token });
  ok('revoke key 200', r.status === 200);
  r = await req('GET', '/api/auth/me', { token: raw2 });
  ok('key revoked → 401', r.status === 401);

  r = await req('POST', '/api/keys', { token: l2.json.token, body: { name: 'Bad', scopes: ['*'] } });
  ok('scope wildcard ditolak', r.status === 400);

  r = await req('POST', '/api/keys', { token: raw2, body: { name: 'X' } });
  ok('API key tidak bisa bikin API key (harus JWT)', r.status === 401);

  console.log('== C. Audit ==');
  // login admin? pakai akun ini saja kalau admin; kalau bukan, cukup cek via DB di luar test.
  // Test inti: events sudah masuk diuji manual/E2E. Di sini cek tidak bocor via error.
  r = await req('GET', '/api/users/audit-logs', { token: l2.json.token });
  ok('audit-logs non-admin → 403', r.status === 403);

  console.log('== D. Regression singkat ==');
  r = await req('GET', '/api/health');
  ok('health 200', r.status === 200);
  r = await req('GET', '/api/tidak-ada');
  ok('404 format standar tetap', r.status === 404 && r.json.error && r.json.error.code === 'NOT_FOUND');

  console.log(`\n== PHASE 2: ${passed} lolos, ${failed} gagal ==`);
  if (failures.length) { failures.forEach((f) => console.log(' -', f)); process.exit(1); }
}

main().catch((e) => { console.error('crash:', e); process.exit(1); });
