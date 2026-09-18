-- ============================================================
-- Migration 005 — api_keys + email_verified (kolom users)
--
-- Idempotent. Tidak mengubah/menghapus kolom lama.
-- ============================================================

-- email_verified: disiapkan untuk Phase 2C (default false; akun lama
-- dibiarkan false sampai fitur verifikasi aktif).
alter table users add column if not exists email_verified boolean not null default false;

-- API keys:
--   key_hash   = SHA-256 hex dari key mentah (raw key TIDAK disimpan)
--   key_prefix = 14 char pertama raw key (untuk identifikasi di UI, bukan secret)
--   scopes     = array teks, mis. {downloads:read,profile:read}
create table if not exists api_keys (
  id           bigserial   primary key,
  user_id      integer     not null references users(id) on delete cascade,
  name         text        not null,
  key_prefix   text        not null,
  key_hash     text        not null unique,
  scopes       text[]      not null default '{downloads:read}',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  revoked_at   timestamptz
);

-- Lookup panas: autentikasi by key_hash
create index if not exists api_keys_key_hash_idx on api_keys (key_hash);
-- Daftar key milik user
create index if not exists api_keys_user_id_idx on api_keys (user_id);
create index if not exists api_keys_revoked_at_idx on api_keys (revoked_at);
create index if not exists api_keys_expires_at_idx on api_keys (expires_at);

-- Batas jumlah key aktif per user (anti-spam): ditegakkan di kode, index
-- partial ini bantu query hitung cepat.
create index if not exists api_keys_active_user_idx on api_keys (user_id)
  where revoked_at is null;
