#!/usr/bin/env node
/**
 * Phase 4 tests — dashboard endpoints + keamanan.
 *   BASE=http://127.0.0.1:3311 node tests/phase4.test.js
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3311';
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok -', name); }
  else { fail++; console.log('  NOT OK -', name, extra !== undefined ? JSON.stringify(extra).slice(0, 220) : ''); }
}
async function req(path, opts = {}, headers = {}) {
  const r = await fetch(BASE + path, {
    ...opts,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.11.' + (1 + Math.floor(Math.random() * 250)), ...headers },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body, headers: r.headers };
}

(async () => {
  const stamp = Date.now();
  const mkUser = async (n) => {
    const email = `p4test${n}${stamp}@lcode.test`;
    const r = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'P4 ' + n, email, password: 'Testpass123' }) });
    return { email, token: r.body.token, refresh: r.body.refreshToken };
  };

  console.log('Auth dashboard');
  const a = await mkUser('A');
  const b = await mkUser('B');
  const noauth = await req('/api/v1/dashboard/overview');
  ok(noauth.status === 401, 'overview tanpa auth → 401', noauth.status);
  const noauth2 = await req('/api/v1/dashboard/requests');
  ok(noauth2.status === 401, 'requests tanpa auth → 401', noauth2.status);

  console.log('Overview');
  const ov = await req('/api/v1/dashboard/overview', {}, { authorization: 'Bearer ' + a.token });
  ok(ov.status === 200 && ov.body.success === true, 'overview envelope 200', ov.body);
  ok(ov.body.data && ov.body.data.totals && typeof ov.body.data.totals.requests === 'number', 'overview totals ada (angka nyata)', ov.body.data);
  ok(ov.body.data.totals.requests === 0, 'overview user baru = 0 requests (bukan fake data)', ov.body.data && ov.body.data.totals);
  ok(ov.body.data.totals.active_api_keys === 0, 'user baru 0 key aktif');
  ok(Array.isArray(ov.body.data.recent_requests), 'recent_requests array');
  ok(ov.body.data.api_version === 'v1', 'api_version v1');

  console.log('Cross-user isolation (IDOR)');
  // Buat aktivitas user A: register + create key + download hit (404 murah)
  const kc = await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'p4a', scopes: ['downloads:read'] }) }, { authorization: 'Bearer ' + a.token });
  ok(kc.status === 201, 'user A create key');
  const aKey = kc.body.key;
  await req('/api/download/tiktok?url=https://x.com/a', {}, { authorization: 'Bearer ' + a.token }); // tercatat di api_usage
  const ovB = await req('/api/v1/dashboard/overview', {}, { authorization: 'Bearer ' + b.token });
  ok(ovB.body.data.totals.requests <= 1, 'user B TIDAK melihat requests user A', ovB.body.data && ovB.body.data.totals);
  ok(ovB.body.data.totals.active_api_keys === 0, 'user B TIDAK melihat API key user A');
  // requests list scoped
  const rqA = await req('/api/v1/dashboard/requests?limit=100', {}, { authorization: 'Bearer ' + a.token });
  ok(rqA.status === 200 && rqA.body.data.total >= 1, 'user A lihat requests sendiri', rqA.body.data && rqA.body.data.total);
  const rqB = await req('/api/v1/dashboard/requests?limit=100', {}, { authorization: 'Bearer ' + b.token });
  ok(rqB.body.data.requests.every((x) => !x.route.includes('download')), 'user B tidak melihat request milik A (download) — hanya aktivitas B sendiri', rqB.body.data);
  // tidak ada param user_id yang bisa dipakai
  const inject = await req('/api/v1/dashboard/requests?user_id=' + a.email + '&endpoint=download', {}, { authorization: 'Bearer ' + b.token });
  ok(inject.body.data.total === 0, 'param user_id diabaikan (tetap scoped)', inject.body.data);

  console.log('Requests non-sensitif');
  const row = rqA.body.data.requests[0] || {};
  ok(!('authorization' in row) && !('token' in row) && !('refresh_token' in row) && !('api_key' in row), 'baris requests tanpa kolom credential', Object.keys(row));
  ok(row.request_id !== undefined && row.status_code !== undefined, 'kolom request_id + status ada');

  console.log('Usage');
  const us = await req('/api/v1/dashboard/usage?range=7d', {}, { authorization: 'Bearer ' + a.token });
  ok(us.status === 200 && us.body.success === true && us.body.data.range === '7d', 'usage 7d envelope', us.body);
  ok(Array.isArray(us.body.data.daily) && Array.isArray(us.body.data.top_endpoints), 'usage daily + endpoints arrays');
  const usBad = await req('/api/v1/dashboard/usage?range=hack', {}, { authorization: 'Bearer ' + a.token });
  ok(usBad.status === 400, 'range invalid → 400', usBad.status);

  console.log('Pagination & filters');
  const pag = await req('/api/v1/dashboard/requests?limit=1&offset=0', {}, { authorization: 'Bearer ' + a.token });
  ok(pag.body.data.requests.length <= 1, 'limit=1 dihormati');
  const filt = await req('/api/v1/dashboard/requests?status=error', {}, { authorization: 'Bearer ' + a.token });
  ok(filt.status === 200, 'filter status=error ok');
  const filtEp = await req('/api/v1/dashboard/requests?endpoint=download', {}, { authorization: 'Bearer ' + a.token });
  ok(filtEp.status === 200 && filtEp.body.data.requests.every((x) => x.route.includes('download')), 'filter endpoint substring');

  console.log('API key raw non-retrievability');
  const list = await req('/api/keys', {}, { authorization: 'Bearer ' + a.token });
  ok(list.body.every((k) => !k.key && !k.key_hash && k.prefix), 'list keys tanpa raw/hash, prefix ada');
  // rotate → raw baru sekali, list tetap tanpa raw
  const rot = await req('/api/keys/' + kc.body.id + '/rotate', { method: 'POST' }, { authorization: 'Bearer ' + a.token });
  ok(rot.status === 201 && rot.body.key && rot.body.key.startsWith('lcode_live_'), 'rotate return raw sekali');
  const list2 = await req('/api/keys', {}, { authorization: 'Bearer ' + a.token });
  ok(list2.body.every((k) => !k.key), 'setelah rotate, list tetap tanpa raw');
  // revoke rotated old implicitly: old key dead
  const oldKeyUse = await req('/api/download/tiktok?url=https://x.com/b', {}, { authorization: 'Bearer ' + aKey });
  ok(oldKeyUse.status === 401, 'key lama (rotated) ditolak 401');

  console.log('Quota display');
  const qh = await req('/api/v1/download/bukanplatform?url=https://x.com/c', {}, { authorization: 'Bearer ' + rot.body.key });
  ok(qh.headers.get('x-quota-daily-limit') === '1000', 'X-Quota-Daily-Limit via key baru');
  const ov2 = await req('/api/v1/dashboard/overview', {}, { authorization: 'Bearer ' + a.token });
  ok(ov2.body.data.totals.daily_quota >= 1000, 'overview daily_quota >= 1000 (dari key aktif)', ov2.body.data && ov2.body.data.totals);

  console.log('OpenAPI + frontend');
  const docs = await req('/api/docs.json');
  const paths = Object.keys(docs.body.paths || {});
  ok(paths.includes('/api/v1/dashboard/overview') && paths.includes('/api/v1/dashboard/usage') && paths.includes('/api/v1/dashboard/requests'), 'dashboard endpoints terdokumentasi');
  const page = await fetch(BASE + '/dashboard');
  const html = await page.text();
  ok(page.status === 200 && html.includes('dashContent') && html.includes('keyModal'), 'halaman /dashboard served');
  const djs = await fetch(BASE + '/dashboard.js');
  ok(djs.status === 200, 'dashboard.js served');

  console.log('Security regression (SSRF + headers)');
  const ssrf = await req('/api/v1/download/tiktok?url=http://127.0.0.1:8080/x', {}, { authorization: 'Bearer ' + rot.body.key });
  ok(ssrf.status === 400, 'SSRF localhost tetap diblok');
  const hh = await req('/api/health');
  ok(!!hh.headers.get('x-request-id') && hh.headers.get('x-content-type-options') === 'nosniff', 'headers tetap aktif');

  console.log(`\n== PHASE 4: ${pass} lolos, ${fail} gagal ==`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
