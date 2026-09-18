-- ============================================================
-- Migration 003 — role user (admin/user)
--
-- Idempotent: aman dijalankan berulang kali.
--   npm run db:migrate
-- ============================================================

-- Kolom role: 'user' default, 'admin' untuk akses penuh.
alter table users add column if not exists role text
  not null default 'user'
  check (role in ('user', 'admin'));

-- Admin pertama: Levi (levidev999@gmail.com). Kalau belum ada,
-- tidak ada yang bisa mengelola user lain.
update users set role = 'admin' where lower(email) = 'levidev999@gmail.com';
