# Contoh cURL — LCODE API (Phase 6)

Base URL produksi: `https://swagger-express-template-beta.vercel.app`

## 1. Register + Login
```bash
curl -X POST https://swagger-express-template-beta.vercel.app/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"name":"Dev","email":"dev@example.com","password":"YOUR_PASSWORD"}'
```
Respons: `{"success":true,"data":{"token":"YOUR_ACCESS_TOKEN","refreshToken":"..."},"request_id":"req_..."}`

## 2. Panggil API dengan token
```bash
curl -H "authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://swagger-express-template-beta.vercel.app/api/v1/auth/me
```

## 3. Buat API key (idempotent)
```bash
curl -X POST https://swagger-express-template-beta.vercel.app/api/keys \
  -H "authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H 'idempotency-key: my-unique-key-12345678' \
  -H 'content-type: application/json' \
  -d '{"name":"prod-key","scopes":["downloads:read"]}'
```
`key` hanya dikirim SEKALI di respons create/rotate. Replay dengan header
`Idempotency-Key` yang sama mengembalikan respons persis sama (24 jam).

## 4. Panggil API dengan API key
```bash
curl -H "authorization: Bearer YOUR_API_KEY" \
  "https://swagger-express-template-beta.vercel.app/api/download/youtube?url=YOUR_URL"
```

## 5. Quota / usage
```bash
curl -H "authorization: Bearer YOUR_ACCESS_TOKEN" \
  https://swagger-express-template-beta.vercel.app/api/v1/dashboard/overview
```
Quota per key (default 60/menit & 1000/hari) → 429 `QUOTA_EXCEEDED` bila lebih.

## 6. Webhook
```bash
curl -X POST https://swagger-express-template-beta.vercel.app/api/webhooks \
  -H "authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/hooks/lcode","events":["API_KEY_CREATED"]}'
```
Verifikasi `X-LCODE-Signature: sha256=<hmac_sha256_hex(secret, RAW_BODY)>`.

## 7. Error
Format error v1: `{"success":false,"error":{"code":"...","message":"..."},"request_id":"..."}`.
Daftar code lengkap: README (Error Code Catalog) & `/api/docs.json`.
