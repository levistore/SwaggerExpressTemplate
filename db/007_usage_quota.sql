-- ============================================================
-- Migration 007 — usage tracking (api_usage) + per-key quota kolom
--
-- Idempotent. Tidak mengubah/menghapus data lama.
-- ============================================================

-- Usage/analytics per request API (ringan; TIDAK berisi secret apa pun —
-- header Authorization, token, key raw, password, body tidak pernah disimpan).
create table if not exists api_usage (
  id          bigserial   primary key,
  user_id     integer     references users(id) on delete set null,
  api_key_id  bigint      references api_keys(id) on delete set null,
  method      text        not null,
  route       text        not null,
  status_code integer     not null,
  duration_ms integer     not null,
  platform    text,
  request_id  text,
  created_at  timestamptz not null default now()
);

-- Analytics umum
create index if not exists api_usage_created_idx on api_usage (created_at);
-- Quota harian per key / per user
create index if not exists api_usage_key_created_idx on api_usage (api_key_id, created_at);
create index if not exists api_usage_user_created_idx on api_usage (user_id, created_at);

-- Per-key quota (opsional override per key). NULL = pakai default kode:
--   rate_limit_per_min default 60, daily_quota default 1000.
alter table api_keys add column if not exists rate_limit_per_min integer;
alter table api_keys add column if not exists daily_quota integer;
