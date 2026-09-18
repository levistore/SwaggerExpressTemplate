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
> efektif tingkat pertama, bukan quota global presisi. Quota global butuh
> store terdistribusi (mis. Upstash Redis) — rencana fase berikutnya.

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
