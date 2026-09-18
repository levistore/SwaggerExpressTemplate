# Changelog — LCODE API

Format: berdasarkan fase pengembangan. Tanggal mengikuti commit aktual.

## Phase 7 — Observability, Operations & Production Hardening

### Added
- `lib/metrics.js`: metrics layer in-memory bounded (ring 2000) — latency
  p50/p95, status distribution, error categories, rejections, provider &
  webhook counters. Flag `instance_local: true` selalu disertakan.
- `GET /api/v1/ops/summary?range=24h|7d|30d` — ops summary user-scoped:
  traffic/success-rate/latency dari `api_usage` (sumber riwayat, tanpa
  duplikasi), webhook deliveries aggregation, provider health + circuit.
- Dashboard tab "Ops" (`/dashboard?tab=ops`) dengan range switcher.
- Request log: `key_id` ditambahkan (menggabung `request_id` + `user_id`).
- CI: `.github/workflows/ci.yml` (Node 22, syntax, OpenAPI validation,
  integration tests via `NEON_DATABASE_URL` secret, npm audit).
- `docs/OPERATIONS.md`, `docs/DEPLOYMENT.md`.

### Changed
- `errorHandler` menandai `error_code` untuk metrics; `requestLogger`
  mencatat auth type (jwt/api_key/anon) + `key_id`.
- Webhook test endpoint: rate limit ketat 10/m (outbound primitive).
- `.env.example`: variabel admin bootstrap didokumentasikan.

### Verified
- EXPLAIN ANALYZE query terpanjang: Index Scan `api_usage_user_created_idx`,
  tanpa seq scan — tidak ada migration index baru (yang ada sudah cukup).

## Phase 6 — API Ecosystem, Contracts & Developer Tooling

### Added
- **Idempotency** untuk mutation endpoint: `POST /api/keys`, `POST /api/keys/{id}/rotate`,
  `POST /api/webhooks` via header `Idempotency-Key` (8..255 karakter `[A-Za-z0-9._~-]`).
  Replay (key + payload sama) → respons tersimpan dikembalikan persis (retensi 24 jam);
  key sama + payload beda → `409`; scoped per user; TIDAK berlaku untuk GET.
- **Webhooks**: CRUD `POST/GET /api/webhooks`, `PATCH/DELETE /api/webhooks/{id}`,
  `POST /api/webhooks/{id}/rotate` (secret baru), `POST /api/webhooks/{id}/test`
  (test delivery), `GET /api/webhooks/{id}/deliveries` (riwayat 20 terakhir).
  Secret `whsec_...` hash SHA-256 (raw sekali-lihat saat create/rotate).
- **Webhook signature**: `X-LCODE-Signature: sha256=<hmac_sha256_hex(secret, RAW_BODY)>`,
  `X-LCODE-Event-Id` untuk dedup client. Delivery **at-least-once** (bukan exactly-once).
- **Webhook events**: `API_KEY_CREATED`, `API_KEY_ROTATED`, `API_KEY_REVOKED`, `SESSION_REVOKED`.
- **OpenAPI**: reusable schemas (`SuccessResponse`, `ErrorResponse`, `User`, `Session`,
  `APIKey`, `Usage`, `DashboardOverview`, `DashboardUsage`, `DashboardRequest`,
  `HealthResponse`, `ProviderHealth`, `Webhook`), securitySchemes, dokumentasi webhooks.
- **Examples**: `examples/node/` (client prototype + verifikasi webhook signature),
  `examples/javascript/`, `examples/curl/`.
- **Migration `008_idempotency_webhooks.sql`**: `idempotency_keys`, `webhooks`,
  `webhook_deliveries` (idempotent, tanpa DROP).

### Security
- Webhook URL divalidasi SSRF (sama seperti downloader): HTTPS wajib, block
  loopback/private/link-local/metadata/reserved, redirect manual, timeout 8s.
- Secret webhook tidak pernah di-log atau diekspos di list endpoint.

### Known limitations
- Webhook delivery sinkron fire-and-forget pasca-aksi — bukan queue enterprise.
- Circuit breaker/health tetap instance-local (serverless).

## Phase 5 — Production Reliability, Observability & Provider Resilience
- `lib/resilience.js`: timeout terpusat 12s, retry transient-only (maks 2x, backoff+jitter),
  circuit breaker instance-local (threshold 5, cooldown 30s, half-open), health tracking.
- Capability matrix provider; error normalization (client hanya menerima kategori aman:
  `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_BAD_RESPONSE`, `PROVIDER_RATE_LIMITED`,
  `PROVIDER_UNSUPPORTED`, `DOWNLOAD_FAILED`).
- `GET /api/health/providers`; `/api/health` DB-aware + metadata lifecycle.
- Usage retention: cleanup `api_usage` > 30 hari, bounded 5000 baris/panggilan.
- Frontend: penanganan 401/429/error yang manusiawi di dashboard.

## Phase 4 — Developer Experience & Dashboard
- `/dashboard`: Overview, API Keys, Usage, Requests (vanilla JS, cinematic dark, SVG icons).
- API key UI (raw sekali-lihat), sessions UI, playground request_id+timing,
  docs quickstart + changelog, `tests/phase4` (33 tes).

## Phase 3 — Platform Quality
- Versioning `/api/v1/*` (envelope `{success, data|error, request_id}`), legacy kompatibel.
- `api_usage` tracking (fire-and-forget), per-key quota (60/m + 1000/hari, override kolom),
  provider layer `lib/providers.js`, `GET /api/docs.json`, Swagger audit-logs/sessions.

## Phase 2 — Sessions, API Keys, Audit
- 2B: refresh token rotasi + reuse detection (`db/004`), logout/logout-all/sessions.
- 2D: API keys `lcode_live_` (hash+prefix, scopes) (`db/005`), dual-mode auth.
- 2E: audit trail append-only (`db/006`), `GET /api/users/audit-logs`.
- 2A Upstash Redis: **DIBATALKAN** (keputusan proyek). 2C email: **PENDING PROVIDER**.

## Phase 1 — Security Hardening
- SSRF protection (IPv6-mapped, redirect, metadata), rate limiter, validasi input,
  security headers, logger terstruktur, error handler terpusat.
