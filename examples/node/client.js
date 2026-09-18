// LCODE API — contoh client prototype (BUKAN official stable SDK).
// Tanpa dependency. Menunjukkan: auth, API key, request, error handling,
// request_id extraction.
//
// Pakai: node examples/node/client.js

const BASE_URL = process.env.LCODE_BASE_URL || 'https://swagger-express-template-beta.vercel.app';

class LcodeClient {
  constructor({ baseUrl = BASE_URL, token = null, apiKey = null } = {}) {
    this.baseUrl = baseUrl;
    this.token = token;     // JWT access token dari /api/v1/auth/login
    this.apiKey = apiKey;   // lcode_live_...
  }

  // Authorization: JWT atau API key (sama-sama lewat Bearer).
  _authHeader() {
    if (this.apiKey) return { authorization: `Bearer ${this.apiKey}` };
    if (this.token) return { authorization: `Bearer ${this.token}` };
    return {};
  }

  async request(method, path, body = null, extraHeaders = {}) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...this._authHeader(), ...extraHeaders },
      body: body === null ? undefined : JSON.stringify(body),
    });
    const requestId = res.headers.get('x-request-id');
    let data = null;
    try { data = await res.json(); } catch { /* 204 dsb. */ }

    if (!res.ok) {
      // Error envelope v1: { success:false, error:{ code, message }, request_id }
      const code = data && data.error ? data.error.code : 'UNKNOWN';
      const message = data && data.error ? data.error.message : `HTTP ${res.status}`;
      const err = new Error(`[${code}] ${message}`);
      err.code = code;
      err.status = res.status;
      err.requestId = requestId || (data && data.request_id);
      throw err;
    }
    // Sukses v1: { success:true, data, request_id }
    return { ok: true, status: res.status, data: data && data.data !== undefined ? data.data : data, requestId: data && data.request_id };
  }

  // --- Auth ---
  async register(name, email, password) { return this.request('POST', '/api/v1/auth/register', { name, email, password }); }
  async login(email, password) {
    const r = await this.request('POST', '/api/v1/auth/login', { email, password });
    if (r.data && r.data.token) this.token = r.data.token;
    return r;
  }

  // --- API keys ---
  async createKey(name, { scopes, expiresInDays, idempotencyKey } = {}) {
    return this.request('POST', '/api/keys', { name, scopes, expiresInDays },
      idempotencyKey ? { 'idempotency-key': idempotencyKey } : {});
  }
  async listKeys() { return this.request('GET', '/api/keys'); }
  async rotateKey(id, idempotencyKey) {
    return this.request('POST', `/api/keys/${id}/rotate`, null,
      idempotencyKey ? { 'idempotency-key': idempotencyKey } : {});
  }
  async revokeKey(id) { return this.request('DELETE', `/api/keys/${id}`); }

  // --- Webhooks ---
  async createWebhook(url, events) { return this.request('POST', '/api/webhooks', { url, events }); }
  async listWebhooks() { return this.request('GET', '/api/webhooks'); }

  // --- Dashboard / usage ---
  async overview() { return this.request('GET', '/api/v1/dashboard/overview'); }
}

module.exports = { LcodeClient, BASE_URL };

// Demo singkat kalau dijalankan langsung + env tersedia:
if (require.main === module) {
  const email = process.env.LCODE_EMAIL;
  const password = process.env.LCODE_PASSWORD;
  if (!email || !password) {
    console.log('Set LCODE_EMAIL & LCODE_PASSWORD untuk menjalankan demo.');
    process.exit(0);
  }
  (async () => {
    const c = new LcodeClient();
    await c.login(email, password);
    const key = await c.createKey('demo-from-client', { idempotencyKey: 'demo-' + Date.now() });
    console.log('API key (simpan sekarang, tidak dikirim ulang):', key.data.key);
    const o = await c.overview();
    console.log('Overview:', JSON.stringify(o.data).slice(0, 200));
  })().catch((e) => { console.error('Gagal:', e.code, e.message, 'request_id:', e.requestId); process.exit(1); });
}
