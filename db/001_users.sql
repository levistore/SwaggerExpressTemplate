-- ============================================================
-- Migration 001 — tabel users
--
-- Menggantikan array in-memory di routes/users.js. Bentuk kolomnya
-- sengaja dibuat sama seperti objek lama (id, name, email) supaya
-- response API nggak berubah.
--
-- Idempotent: aman dijalankan berulang kali.
--   npm run db:migrate
-- ============================================================

create table if not exists users (
  id         integer generated always as identity primary key,
  name       text        not null,
  email      text        not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- updated_at otomatis
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_set_updated_at on users;
create trigger users_set_updated_at
  before update on users
  for each row
  execute function set_updated_at();

-- ------------------------------------------------------------
-- Seed: 2 user yang sama seperti array awal di kode lama
-- ------------------------------------------------------------
insert into users (id, name, email)
overriding system value
values
  (1, 'John Doe', 'john@example.com'),
  (2, 'Jane Doe', 'jane@example.com')
on conflict (id) do nothing;

-- Geser sequence biar user berikutnya dapat id 3, bukan 1 (yang bikin tabrakan).
select setval(
  pg_get_serial_sequence('users', 'id'),
  greatest((select max(id) from users), 1)
);
