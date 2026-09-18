-- 008: idempotency foundation + webhooks (Phase 6)
-- Idempotent, tanpa DROP, tanpa destructive change.

-- Idempotency keys: scoped per user, fingerprint mencegah reuse untuk payload beda.
create table if not exists idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id integer not null references users(id) on delete cascade,
  request_fingerprint text not null,
  endpoint text not null,
  response_status integer not null,
  response_body text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  idem_key text not null,
  unique (user_id, idem_key)
);
create index if not exists idx_idempotency_expiry on idempotency_keys (expires_at);

-- Webhooks per user. Secret TIDAK pernah disimpan mentah — hanya SHA-256 hash
-- (pola sama dengan API keys). Prefix disimpan untuk identifikasi.
create table if not exists webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id integer not null references users(id) on delete cascade,
  url text not null,
  events text[] not null,
  active boolean not null default true,
  secret_prefix text not null,
  secret_hash text not null,
  failure_count integer not null default 0,
  last_failure_at timestamptz,
  last_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_webhooks_user on webhooks (user_id);

-- Delivery log: event id unik untuk dedup di sisi client (at-least-once).
create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references webhooks(id) on delete cascade,
  event_id text not null unique,
  event_type text not null,
  status integer,
  ok boolean not null,
  error_category text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists idx_webhook_deliveries_hook on webhook_deliveries (webhook_id, created_at desc);
