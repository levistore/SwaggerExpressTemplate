# Express API with Swagger Documentation

This is a skeleton Express.js project with Swagger API documentation integration. It provides a basic structure for building RESTful APIs with automatic documentation, configured for both local development and Vercel deployment.

## Features

- Express.js web server
- Swagger UI for API documentation
- Example API routes with CRUD operations
- API documentation using JSDoc comments
- Development mode with auto-restart using nodemon
- Vercel deployment configuration with CDN for Swagger UI assets

## Project Structure

```
├── app.js                # Main application entry point
├── package.json          # Project dependencies and scripts
├── routes/               # API route definitions
│   └── users.js          # User routes with Swagger documentation
├── vercel.json           # Vercel deployment configuration
└── README.md             # Project documentation
```

## Getting Started

### Prerequisites

- Node.js (v12 or higher)
- npm (v6 or higher)

### Installation

1. Clone the repository or download the source code

2. Install dependencies
   ```
   npm install
   ```

### Running the Application

#### Development Mode

```
npm run dev
```

This will start the server with nodemon, which automatically restarts when you make changes to the code.

#### Production Mode

```
npm start
```

### Accessing the API

- API Base URL: http://localhost:3000
- Swagger Documentation: http://localhost:3000/api-docs

## Vercel Deployment

This project is configured for deployment on Vercel with the following features:

1. **vercel.json Configuration**:
   - Builds the app.js file using the Node.js runtime
   - Routes all requests to the Express application
   - Configures CDN routes for Swagger UI assets

2. **Swagger UI CDN Integration**:
   - Uses CDN links for Swagger UI CSS and JavaScript files
   - Improves loading performance in production
   - Routes configured:
     - `/api/swagger-ui.css` → CDN CSS file
     - `/api/swagger-ui-bundle.js` → CDN JS bundle
     - `/api/swagger-ui-standalone-preset.js` → CDN JS preset

3. **Environment Detection**:
   - Automatically detects Vercel environment
   - Uses appropriate server URLs based on environment
   - Configures Swagger UI differently in production vs development

### Deploying to Vercel

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket)

2. Import the project in the Vercel dashboard

3. Deploy with default settings (Vercel will detect the Node.js project)

4. Access your API at the provided Vercel URL

5. Access Swagger documentation at `https://your-vercel-url/api-docs`

## API Endpoints

### Users

- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get a specific user by ID
- `POST /api/users` - Create a new user
- `PUT /api/users/:id` - Update a user
- `DELETE /api/users/:id` - Delete a user

## License

ISC
## Security (Phase 1 Hardening)

API ini sudah menerapkan hardening berikut (tanpa mengubah perilaku endpoint yang ada):

### Rate limiting (429 + header `Retry-After`, `X-RateLimit-*`)

| Scope | Endpoint | Limit |
|---|---|---|
| Global | semua `/api/*` | 300 req/menit per IP |
| Auth | `/api/auth/register`, `/api/auth/login` | 10 req/menit per IP |
| Downloader | `/api/download/:platform` | 20 req/menit per IP |
| Admin | `/api/users*` | 60 req/menit per IP |

> Catatan jujur: limiter ini in-memory **per instance** function. Di Vercel
> serverless tidak ada memori bersama antar-instance, jadi ini penghalang
> efektif tingkat pertama, bukan quota global presisi. Store terdistribusi
> (Upstash Redis) **dibatalkan sebagai keputusan proyek (Phase 2A)** —
> limitation per-instance ini diterima sebagai known risk produksi, dan
> behavior limiter yang berjalan tidak diubah.
>
> Known risk lain: access JWT tetap valid sampai expiry setelah logout
> (tidak ada blacklist; mitigasi: refresh token 7 hari bisa di-revoke
> server-side, access token pendek umurninya).



### Developer Dashboard (Phase 4)

Halaman **`/dashboard`** (login wajib) — data 100% milik user yang login
(user-scoped di server, tanpa parameter user_id):

- **Overview**: total requests, requests hari ini, kuota harian agregat,
  API keys aktif, recent requests + recent activity (audit), onboarding singkat.
- **API Keys**: list (prefix saja), create (pilih scopes + expiry), revoke,
  rotate. Raw key hanya tampil SEKALI di modal sekali-lihat — tidak pernah
  disimpan di database, analytics, atau localStorage, dan tidak bisa diminta ulang.
- **Usage**: distribusi status code, endpoint teratas, grafik harian (CSS bars,
  tanpa library), durasi rata-rata — range 24h/7d/30d.
- **Requests**: riwayat dengan pagination, filter status/endpoint/rentang.
  Hanya metadata operasional (method, route, status, durasi, request_id) —
  tanpa header/credential apa pun.

Endpoint backend: `GET /api/v1/dashboard/overview`, `/usage`, `/requests`
(semua authenticated, user-scoped, parameterized SQL, rate limit 60/m,
terdokumentasi di OpenAPI).

**Sessions UI**: halaman Account (`/profile`) kini menampilkan session aktif
(metadata aman: user agent, IP, penanda current) dengan revoke per session dan
logout-all.

**Playground**: kini menampilkan `request_id` dan execution time dari respons nyata.

**Docs**: quickstart (base URL, auth, contoh curl) + changelog developer-facing.




### Observability & Operations (Phase 7)

- **Metrics** (`lib/metrics.js`): agregat realtime bounded (ring 2000 request)
  — latensi p50/p95, distribusi status, error kategori, rejection (quota/
  rate-limit/SSRF), provider & webhook counters. **Instance-local**, hilang
  saat cold-start; riwayat tetap dari `api_usage` (tanpa duplikasi tracking).
- **Ops endpoint**: `GET /api/v1/ops/summary?range=24h|7d|30d` — traffic,
  success rate, latensi (avg+p95 dari `api_usage`), top endpoints, webhook
  deliveries, provider health + circuit state. User-scoped (anti-IDOR),
  range bounded (tanpa arbitrary date), parameterized SQL, rate limit 60/m.
- **Request log**: kini menyertakan `user_id` + `key_id` + `request_id`
  (tanpa token/credential/body).
- **Webhook test** (`POST /api/webhooks/{id}/test`): rate limit ketat 10/m
  (outbound primitive), ownership + SSRF + timeout + bounded response.
- **Dashboard**: tab baru "Ops" (`/dashboard?tab=ops`) — API Health, Traffic,
  Providers, Webhooks; vanilla JS, SVG icons, tanpa data demo.
- **CI**: `.github/workflows/ci.yml` — Node 22, `npm ci`, syntax check semua
  file JS, build+validasi OpenAPI, migration+full test suite (jalan bila
  secret `NEON_DATABASE_URL` diset), `npm audit --audit-level=high`.
- **Database**: EXPLAIN ANALYZE query terpanjang (ops/dashboard) — Index Scan
  `api_usage_user_created_idx`, 0 seq scan, <1ms; tidak perlu index baru.
- **Docs**: `docs/OPERATIONS.md` (health, rollback, incident response,
  security incident), `docs/DEPLOYMENT.md` (checklist deploy/verify).

### API contracts, idempotency & webhooks (Phase 6)

- **Idempotency**: header `Idempotency-Key` (8..255 `[A-Za-z0-9._~-]`) pada
  `POST /api/keys`, `POST /api/keys/{id}/rotate`, `POST /api/webhooks`.
  Replay (key sama + payload sama) → respons tersimpan dikembalikan persis
  (retensi 24 jam); payload beda → 409; scoped per user; tidak untuk GET.
- **Webhooks** (`/api/webhooks`): create/list/update/delete, rotate secret,
  test delivery, riwayat delivery. Events: `API_KEY_CREATED`, `API_KEY_ROTATED`,
  `API_KEY_REVOKED`, `SESSION_REVOKED`. Secret `whsec_...` raw sekali-lihat,
  tersimpan sebagai SHA-256 hash (pola API keys).
- **Signature**: `X-LCODE-Signature: sha256=<hmac_sha256_hex(secret, RAW_BODY)>`
  + `X-LCODE-Event-Id` (dedup client). Verifikasi harus pakai RAW body —
  contoh di `examples/node/verify-webhook.js`. Delivery **at-least-once**.
- **Webhook delivery**: sinkron fire-and-forget pasca-aksi, timeout 8s,
  retry transient-only 1x — BUKAN queue enterprise (batasan serverless, jujur
  didokumentasikan).
- **Webhook SSRF**: HTTPS wajib, block loopback/private/link-local/metadata/
  reserved, redirect manual, timeout ketat. TIDAK menjadi bypass SSRF downloader.
- **OpenAPI** (`/api/docs.json`): reusable schemas (SuccessResponse, ErrorResponse,
  User, Session, APIKey, Usage, DashboardOverview/Usage/Request, HealthResponse,
  ProviderHealth, Webhook) + securitySchemes bearer/apiKey.
- **Examples**: `examples/curl/`, `examples/javascript/`, `examples/node/`
  (client prototype — BUKAN official SDK).

#### Error Code Catalog (source of truth = kode aktual)

| Kategori | Code | HTTP | Arti |
|---|---|---|---|
| Auth | `UNAUTHORIZED` | 401 | Tidak ada / token tidak valid |
| Auth | `INVALID_CREDENTIALS` (login gagal) | 401 | Email/password salah |
| Auth | `REFRESH_REUSE_DETECTED` | 401 | Refresh token dipakai ulang → family revoked |
| Authz | `FORBIDDEN` | 403 | Bukan admin / scope kurang (`SCOPE_DENIED`) |
| Validation | `INVALID_REQUEST` / `VALIDATION_ERROR` | 400 | Input tidak valid |
| Validation | `INVALID_RANGE` | 400 | Parameter range/filter tidak valid |
| Conflict | `CONFLICT` | 409 | Duplikat / batas key-webhook tercapai / idempotency conflict |
| Not Found | `NOT_FOUND` | 404 | Resource tidak ada / bukan milikmu |
| Rate/Quota | `RATE_LIMITED` | 429 | Rate limit per menit (Retry-After) |
| Rate/Quota | `QUOTA_EXCEEDED` | 429 | Quota harian/per-menit API key |
| Security | `SSRF_BLOCKED` | 400 | URL menarget internal/metadata |
| Provider | `PROVIDER_TIMEOUT` | 502 | Provider tidak merespons |
| Provider | `PROVIDER_UNAVAILABLE` | 502/503 | Provider down / circuit open |
| Provider | `PROVIDER_BAD_RESPONSE` | 502 | Respons provider tak bisa diproses |
| Provider | `PROVIDER_RATE_LIMITED` | 502 | Provider membatasi |
| Provider | `PROVIDER_UNSUPPORTED` | 400 | Platform/URL tidak didukung |
| Provider | `DOWNLOAD_FAILED` | 502 | Gagal mendapatkan link unduhan |
| Server | `INTERNAL_ERROR` | 500 | Kesalahan internal |
| Server | `SERVICE_UNAVAILABLE` | 503 | DB down / degraded |

#### API Lifecycle

- **Current**: `v1` (`/api/v1/*`, envelope standar).
- **Legacy**: `/api/*` tetap didukung penuh (compatibility layer), TIDAK dideprekasi.
- **Deprecation policy**: perubahan breaking hanya di versi baru; deprecation
  diumumkan via changelog + header/`Sunset` bila suatu saat relevan. Belum ada v2.
- **Non-breaking**: penambahan field respons, endpoint baru, error code baru boleh
  kapan saja.

### Provider resilience (Phase 5)

- **Timeout policy terpusat** (`lib/resilience.js`): setiap request ke provider
  eksternal lewat `providerFetch()` — bounded timeout (default 12s),
  redirect selalu `manual` (SSF/SSRF), respons tidak pernah menggantung.
- **Retry hanya transient**: timeout, network failure, upstream 5xx, dan 429
  di-retry maksimal 2x dengan exponential backoff + jitter. Permanent 4xx,
  SSRF rejection, dan input invalid TIDAK pernah di-retry.
- **Circuit breaker instance-local** (jujur: BUKAN distributed — Vercel
  serverless ephemeral, tanpa Redis sesuai keputusan proyek): threshold 5
  failure → OPEN 30 detik → HALF_OPEN probe → recovery. Manfaatnya: instance
  hangat berhenti menembak provider yang sedang down; fallback tetap jalan.
- **Health tracking** per provider (counter success/fail/timeout, latency,
  kategori error terakhir) — in-memory, tanpa URL user/credential. Lihat
  `GET /api/health/providers` (flag `instance_local: true`).
- **Error normalization**: client hanya menerima kategori aman —
  `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_BAD_RESPONSE`,
  `PROVIDER_RATE_LIMITED`, `PROVIDER_UNSUPPORTED`, `DOWNLOAD_FAILED` —
  dengan pesan manusiawi. Nama provider mentah, URL internal, dan detail
  error hanya di log server.
- **Usage retention**: cleanup `api_usage` > 30 hari, BOUNDED (maks 5000
  baris per panggilan, throttled per jam) — tidak pernah jadi massive DELETE
  di request user. Audit logs/sessions/keys tidak tersentuh.
- **Health endpoint**: `/api/health` kini membedakan app ok vs DB degraded
  (503, tanpa detail koneksi) + metadata lifecycle (`api.current/supported/docs`).

### API versioning & response envelope (Phase 3)

- **`/api/v1/...` = canonical API.** Router yang sama dengan legacy, format
  respons dibungkus envelope standar:

  ```json
  { "success": true,  "data": { ... }, "request_id": "req_..." }
  { "success": false, "error": { "code": "...", "message": "..." }, "request_id": "req_..." }
  ```

- Path legacy `/api/...` tetap bekerja 100% (compatibility layer, format lama).
- Spec OpenAPI programatis: `GET /api/docs.json` (Swagger UI tetap di `/api-docs`).

### Usage tracking & quota per API key (Phase 3)

- Setiap request `/api/*` dicatat di tabel `api_usage` (user/key id, route,
  status, durasi, request_id) — **tanpa** header Authorization, token, key raw,
  password, atau body. Retensi 30 hari. Write analytics fire-and-forget:
  gagal tidak pernah mempengaruhi request utama.
- Quota per API key (JWT tidak kena): default **60 req/menit** dan
  **1000 req/hari** (reset tengah malam UTC). Override per key via kolom
  `api_keys.rate_limit_per_min` / `api_keys.daily_quota` (migration 007).
  Penolakan = 429 `QUOTA_EXCEEDED`. Header `X-Quota-Daily-Limit` /
  `X-Quota-Daily-Remaining` di respons download via API key.

### Downloader provider layer (Phase 3)

Provider logic (TikTok/YouTube/Facebook/Instagram) diekstrak ke
`lib/providers.js` — behavior identik, SSRF guard tetap di route, fallback dan
normalisasi error tidak berubah.

### Caching

**SKIP** (keputusan Phase 3): URL media yang dikembalikan provider memakai
token kedaluwarsa singkat, sehingga cache tidak aman dan memberi nilai kecil;
data user tidak boleh di-cache. Tidak ada cache diterapkan.

### SSRF protection (`lib/ssrf.js`)

`GET /api/download/:platform?url=` memvalidasi URL sebelum dipakai:

- Hanya skema `http:`/`https:`; `file:`, `javascript:`, dll ditolak.
- `localhost`, `*.localhost`, `*.local`, `*.internal` ditolak.
- Hostname di-resolve DNS; **semua** hasilnya harus IP publik.
- Rentang yang diblokir: loopback, private (10/8, 172.16/12, 192.168/16),
  link-local 169.254/16 (cloud metadata), CGNAT 100.64/10, multicast,
  reserved, 0.0.0.0/8, dan IPv6 loopback/ULA/link-local/multicast.
- Penyamaran IP ditegakkan: bentuk desimal (`2130706433`), hex (`0x7f000001`),
  oktal (`0177.0.0.1`), IPv4-mapped IPv6 (`::ffff:127.0.0.1`) — semua
  dinormalisasi lalu diperiksa, bukan blacklist string.
- `redirect: 'manual'` pada fetch keluar — redirect provider tidak diikuti.

### Request ID & logging terstruktur

- Setiap respons membawa `X-Request-ID` (bisa dari upstream, diverifikasi formatnya).
- Error respons standar: `{ "success": false, "error": { "code", "message" }, "request_id" }`.
- Log JSON per request (level, path, status, durasi, IP, user_id) — **tanpa**
  password, token, atau header Authorization.

### Security headers

`Content-Security-Policy` (default-src 'self'; script-src 'self'),
`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`,
`HSTS`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`. Header `X-Powered-By` dihapus.

### CORS

Default: same-origin saja (frontend dan API satu domain). Origin tambahan
bisa didaftarkan lewat `CORS_ORIGINS` (dipisah koma). Origin tak terdaftar
tidak mendapat header allow.

### Input validation

Semua input server-side divalidasi (`lib/validate.js`): panjang nama ≤100,
email format + ≤254, password 8–128 karakter, body JSON maksimal 16 KB,
id harus integer 1..2^31-1, platform downloader hanya 4 yang didukung.

### Tests

```
npm test        # jalankan server lokal dulu (lihat README bagian dev)
```

`tests/security.test.js` menguji: auth (JWT invalid/expired/malformed, RBAC),
validasi input, SSRF (localhost/private/metadata/penyamaran IP), rate limit
429, format error standar, request ID, security headers.

## Phase 2 — Sessions, API Keys, Audit Trail

### Authentication: JWT + Refresh Token + Sessions

- **Login/register** tetap balikin `token` (JWT 7d, backward-compatible) + **baru**:
  `refreshToken` (opaque, 30 hari) & `sessionId`.
- **Refresh token** disimpan sebagai SHA-256 hash (`sessions.token_hash`) — raw token
  tidak pernah ada di database. Tiap `POST /api/auth/refresh` memutar token (rotation).
- **Reuse detection**: refresh token yang sudah revoked dipakai lagi → seluruh family
  sesi di-revoke (indikasi token dicuri).
- **Logout**: `POST /api/auth/logout {refreshToken}` revoke sesi di server.
  Access JWT tetap valid sampai expired (tidak ada access-token blacklist) — karena
  itu TTL-nya pendek dan logout selalu dipasangkan dengan pencabutan refresh token.
- **Sesi**: `GET /api/auth/sessions` (metadata tanpa token), `DELETE /api/auth/sessions/:id`
  (anti-IDOR), `POST /api/auth/logout-all`.
- **Ganti password** (`PUT /api/auth/me` + password baru) mencabut semua sesi LAIN;
  sesi saat ini dipertahankan (identifikasi via header opsional `X-Session-ID`).

### API Keys

- Format: `lcode_live_<43 char base64url>` — dibedakan dari JWT otomatis.
- Disimpan sebagai hash + prefix 14 char; raw key **hanya dikirim sekali** saat create/rotate.
- Endpoint: `POST /api/keys` (name, scopes, expiresInDays opsional ≤3650),
  `GET /api/keys` (metadata saja), `DELETE /api/keys/:id`, `POST /api/keys/:id/rotate`.
- Maksimal 10 key aktif per user.
- **Scopes** (tanpa wildcard): `downloads:read`, `profile:read`, `profile:write`.
  Endpoint admin **tidak bisa** diakses API key apa pun (`requireAdmin` menolak `api_key`).
- Autentikasi: `Authorization: Bearer lcode_live_...` — backend mengenali prefix
  dan mengalihkan ke jalur API key (lookup by hash, index).
- Rate limit identity: **IP + key** — key bocor tetap terbatas walau dipakai dari
  banyak IP, dan banyak developer di satu NAT tetap dapat kuota per-key.

### Audit Trail

Event yang dicatat: REGISTER, LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, LOGOUT_ALL,
PASSWORD_CHANGED, REFRESH_TOKEN_REUSE, SESSION_REVOKED, API_KEY_CREATED,
API_KEY_REVOKED, API_KEY_ROTATED, ADMIN_USER_CREATED/UPDATED/DELETED.
Metadata disanitasi (password/token/key dibuang otomatis); kegagalan audit tidak
membuat request gagal. Admin: `GET /api/users/audit-logs?limit=&offset=&action=&actor=&from=&to=`.

### Migrations

```
db/004_sessions.sql  — tabel sessions (refresh token hash, family rotation)
db/005_api_keys.sql  — tabel api_keys + kolom users.email_verified (persiapan 2C)
db/006_audit.sql     — tabel audit_logs (append-only)
npm run db:migrate   # idempotent, aman diulang
```

### Phase 2C (email verification & password reset): BELUM DIIMPLEMENT

Butuh kredensial email provider (Resend/SMTP) yang belum tersedia. Struktur DB
(`users.email_verified`) sudah disiapkan. Inilah satu-satunya bagian Phase 2 yang
belum selesai — dilaporkan jujur, bukan diam-diam dilewati.
