-- ============================================================
-- Migration 002 — kolom password + email unik
--
-- Idempotent: aman dijalankan berulang kali.
--   npm run db:migrate
-- ============================================================

-- ------------------------------------------------------------
-- password_hash
--
-- Format: scrypt$N$r$p$salt_base64$hash_base64
-- Parameter ikut disimpan di string, jadi kalau nanti N dinaikin
-- password lama tetap bisa diverifikasi.
--
-- Nullable: baris lama (seed John/Jane) belum punya password dan
-- memang TIDAK bisa login. Itu disengaja — lebih jujur daripada
-- mengisi password karangan yang nggak diketahui siapa pun.
-- ------------------------------------------------------------
alter table users add column if not exists password_hash text;

-- ------------------------------------------------------------
-- email harus unik — ini konsekuensi nyata dari adanya login.
--
-- Sebelumnya email duplikat sengaja dibiarkan (kontrak lama).
-- Tapi begitu email jadi identitas login, duplikat bikin
-- "select where email = $1" balikin lebih dari satu baris dan
-- login jadi ambigu. Jadi index unik ini wajib.
--
-- lower(email): email itu case-insensitive di praktiknya, biar
-- Budi@Example.com nggak bisa daftar dua kali.
-- ------------------------------------------------------------
create unique index if not exists users_email_lower_key on users (lower(email));
