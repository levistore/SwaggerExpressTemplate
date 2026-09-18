-- ============================================================
-- Migration 006 — audit_logs
--
-- Append-only: tidak ada update/delete di jalur aplikasi. Metadata
-- TIDAK PERNAH berisi password/token/key (ditegakkan di lib/audit.js).
-- ============================================================

create table if not exists audit_logs (
  id            bigserial   primary key,
  actor_user_id integer     references users(id) on delete set null,
  action        text        not null,
  target_type   text,
  target_id     text,
  request_id    text,
  ip_address    text,
  user_agent    text,
  metadata      jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Query admin: filter action + rentang waktu
create index if not exists audit_logs_action_idx on audit_logs (action, created_at desc);
-- Query admin: filter actor
create index if not exists audit_logs_actor_idx on audit_logs (actor_user_id, created_at desc);
-- Pagination default (terbaru dulu)
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);
