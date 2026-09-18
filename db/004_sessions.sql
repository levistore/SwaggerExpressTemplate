-- ============================================================
-- Migration 004 — sessions (refresh token server-side)
--
-- Idempotent: aman dijalankan berulang kali.
--   npm run db:migrate
--
-- Desain:
--   - token_hash SHA-256 (hex) dari refresh token mentah. Raw token
--     TIDAK PERNAH disimpan — kalau DB bocor, token tidak bisa dipakai.
--   - family_id: grup rotasi. Refresh token diputar tiap pakai; kalau
--     token yang SUDAH dipakai muncul lagi (reuse/theft), satu family
--     di-revoke semua.
--   - revoked_at nullable: null = aktif.
--   - Tidak ada password / JWT access token di sini.
--   - FK ke users dengan ON DELETE CASCADE: hapus user = sesi ikut hilang.
-- ============================================================

create table if not exists sessions (
  id          bigserial    primary key,
  user_id     integer      not null references users(id) on delete cascade,
  token_hash  text         not null unique,
  family_id   uuid         not null default gen_random_uuid(),
  created_at  timestamptz  not null default now(),
  expires_at  timestamptz  not null,
  last_used_at timestamptz,
  revoked_at  timestamptz,
  user_agent  text,
  ip_address  text
);

-- Lookup saat refresh/auth: cari by token_hash (satu-satunya jalur panas)
create index if not exists sessions_token_hash_idx on sessions (token_hash);
-- Daftar sesi milik user + revokasi massal
create index if not exists sessions_user_id_idx on sessions (user_id);
-- Reuse detection: cari family yang masih aktif
create index if not exists sessions_family_id_idx on sessions (family_id);
-- Cleanup sesi kedaluwarsa
create index if not exists sessions_expires_at_idx on sessions (expires_at);
