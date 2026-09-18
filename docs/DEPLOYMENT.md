# DEPLOYMENT — LCODE API

## Before Deploy

- [ ] `git status` bersih, sinkron origin
- [ ] Full test suite hijau (206+/206+): `BASE=http://127.0.0.1:3311 node tests/{security,phase2..7}.test.js`
- [ ] `npm audit` → 0 vulnerabilities
- [ ] Migration baru? Jalankan `node --env-file=.env.local scripts/migrate.js` DULU (idempotent, additive)
- [ ] OpenAPI: `GET /api/docs.json` lokal respons normal
- [ ] Env vars Vercel lengkap: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `LOG_LEVEL`
      (Tidak ada: Upstash — DIBATALKAN, email — PENDING PROVIDER)

## Deploy

```bash
npx vercel --prod --yes --token $(cat /tmp/.vtok)
```
Tunggu status **READY**.

## After Deploy (smoke, bounded)

- [ ] `GET /api/health` → 200 ok, `api.current: v1`
- [ ] `GET /api/health/providers` → 200, `instance_local: true`
- [ ] `GET /api/docs.json` → 200, schemas & paths
- [ ] Register + login QA → token valid
- [ ] API key create/list/revoke
- [ ] `/api/v1/dashboard/overview` dengan token
- [ ] Webhook create/list/deliveries
- [ ] Error contract: respons error punya `request_id` + `error.code`
- [ ] Hapus akun QA setelah verifikasi

## Rollback

Vercel dashboard → Deployments → Promote deployment sebelumnya, atau
`npx vercel rollback <url>`. Migration tidak perlu di-rollback (additive).
