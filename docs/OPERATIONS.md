# OPERATIONS — LCODE API

Panduan operasional: health check, deployment, migration, incident response.
Tidak ada credential di dokumen ini — semua secret di Vercel environment vars.

## Health Checks

| Endpoint | Arti |
|---|---|
| `GET /api/health` | App + DB. `200 {"status":"ok","database":"connected"}` = sehat. `503 {"status":"degraded"}` = app hidup, DB tidak bisa di-ping. |
| `GET /api/health/providers` | Health provider downloader + circuit breaker. `instance_local: true` selalu — data hanya instance ini. |

Health tidak pernah menyentuh provider downloader eksternal.

## Deployment

1. Lihat `docs/DEPLOYMENT.md` (checklist lengkap).

## Rollback

Vercel: buka dashboard project → Deployments → pilih deployment sebelumnya → **Promote to Production**.
Alternatif CLI: `npx vercel rollback <deployment-url> --token <TOKEN>`.
Migration bersifat additive/idempotent — rollback kode TIDAK perlu rollback DB.

## Database Migration

```bash
node --env-file=.env.local scripts/migrate.js
```
- Idempotent (`IF NOT EXISTS` / `ON CONFLICT`), additive, tanpa DROP.
- Jalankan SEBELUM deploy kode yang bergantung pada schema baru.
- Migration dijalankan dari lokal koneksi langsung ke Neon (non-pooling URL untuk DDL).

## Incident Response

### 5xx meningkat
1. `GET /api/health` — apakah DB degraded?
2. Vercel logs: filter `level":"error"` — cek `error_code` dominan.
3. Jika `INTERNAL_ERROR` + error berbau DB: cek Neon status/koneksi (pool max: 3, timeout 10s di `lib/db.js`).
4. Jika berhubungan provider: lanjut ke "Provider down".

### DB degraded
1. Cek Neon console (status, connection limit, autosuspend).
2. App tetap hidup selama DB down, tapi auth/keys/dashboard gagal — komunikasikan degradasi.
3. Health endpoint otomatis 503; tidak perlu aksi kode.

### Provider down (downloader)
1. `GET /api/health/providers` — lihat failure/timeout/circuit.
2. Circuit breaker instance-local akan membuka otomatis setelah 5 failure (cooldown 30s) dan fallback ke provider berikutnya.
3. Provider tidak diubah dari kode — outage = tunggu/fallback; kalau permanen, keputusan ganti provider perlu keputusan eksplisit.

### Webhook failure meningkat
1. Cek `webhook_deliveries` per webhook: `error_category`, `status`, `duration_ms`.
2. `PROVIDER_TIMEOUT` banyak = endpoint tujuan lambat/down.
3. Delivery at-least-once — client dedup via `event_id`.

### Quota abuse
1. `api_usage` per key: cek request per menit/hari.
2. Turunkan `api_keys.rate_limit_per_min` / `daily_quota` (kolom override) untuk key bermasalah, atau revoke.
3. Rate limiter per-menit in-memory per-instance (keputusan: Upstash DIBATALKAN) — harap diingat saat investigasi.

### Authentication failure meningkat
1. Log `request_error` dengan `error_code: UNAUTHORIZED / REFRESH_REUSE_DETECTED`.
2. Lonjakan `REFRESH_REUSE_DETECTED` = kemungkinan token dicuri → family auto-revoked (by design).
3. Komromis key: revoke via dashboard/API; kompromis massal: rotate JWT_SECRET (memaksa re-login).

## Security Incident

### API key compromised
1. `DELETE /api/keys/{id}` (atau dashboard) — revoke segera.
2. Audit trail otomatis mencatat `API_KEY_REVOKED`.
3. Buat key baru + rotasi di client.

### Webhook secret compromised
1. `POST /api/webhooks/{id}/rotate` — secret baru sekali-lihat.
2. Delivery lama dengan secret lama akan gagal verifikasi di client (expected).

### Refresh token reuse detected
1. Sudah otomatis: seluruh token family di-revoke (Phase 2B).
2. User harus login ulang. Jika pola berulang dari IP sama: cek rate limit logs & pertimbangkan investigasi akun.

## Limitations (jujur)

- Rate limiter, per-minute quota, circuit breaker, provider health, dan metrics realtime **instance-local** (Vercel serverless ephemeral, tanpa Redis sesuai keputusan proyek).
- Metrics realtime (`lib/metrics.js`) bounded ring 2000 request, hilang saat cold-start.
- Usage retention: `api_usage` > 30 hari dibersihkan bounded (maks 5000 baris/panggilan, throttle per jam).
