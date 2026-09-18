// Contoh browser/JavaScript (fetch) — LCODE API.
// CATATAN: di browser, jangan simpan token/API key di localStorage untuk
// produksi. Contoh ini memakai variable in-memory + sessionStorage.

const BASE_URL = 'https://swagger-express-template-beta.vercel.app';

async function api(path, { method = 'GET', body, token, idempotencyKey } = {}) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const requestId = res.headers.get('x-request-id');
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.code = data?.error?.code;
    err.requestId = data?.request_id || requestId;
    throw err;
  }
  return data; // { success, data, request_id }
}

// 1) Login
const { data: loginData } = await api('/api/v1/auth/login', {
  method: 'POST',
  body: { email: 'dev@example.com', password: 'YOUR_PASSWORD' },
});
const token = loginData.token;
sessionStorage.setItem('lcode_token', token);

// 2) Buat API key (idempotent — aman untuk retry)
const created = await api('/api/keys', {
  method: 'POST',
  token,
  idempotencyKey: crypto.randomUUID(),
  body: { name: 'frontend-key', scopes: ['downloads:read'] },
});
console.log('Simpan raw key sekarang (tidak dikirim ulang):', created.key);

// 3) Tangani error + tampilkan request_id untuk support
try {
  await api('/api/download/youtube?url=YOUR_URL', { token });
} catch (e) {
  console.error(`[${e.code}] ${e.message} (request_id: ${e.requestId})`);
}
