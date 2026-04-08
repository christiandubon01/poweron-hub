-- ── 063_nexus_sessions.sql ─────────────────────────────────────────────────
-- B61a: Multi-session chat — nexus_sessions table
-- Each row is a named conversation session for a user.
-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.nexus_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users on delete cascade,
  org_id        uuid,
  topic_name    text not null default 'New Session',
  agent         text default 'nexus',
  created_at    timestamptz default now(),
  last_active   timestamptz default now(),
  message_count int default 0
);

-- Index for fast user-scoped queries (newest first)
create index if not exists nexus_sessions_user_id_last_active_idx
  on public.nexus_sessions (user_id, last_active desc);

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.nexus_sessions enable row level security;

-- Users can only see their own sessions
create policy "nexus_sessions: users read own"
  on public.nexus_sessions
  for select
  using (user_id = auth.uid());

-- Users can insert their own sessions
create policy "nexus_sessions: users insert own"
  on public.nexus_sessions
  for insert
  with check (user_id = auth.uid());

-- Users can update their own sessions
create policy "nexus_sessions: users update own"
  on public.nexus_sessions
  for update
  using (user_id = auth.uid());

-- Users can delete their own sessions
create policy "nexus_sessions: users delete own"
  on public.nexus_sessions
  for delete
  using (user_id = auth.uid());
