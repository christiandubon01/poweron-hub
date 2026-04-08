-- ── 064_nexus_messages.sql ─────────────────────────────────────────────────
-- B61a: Multi-session chat — nexus_messages table
-- Each row is a single message (user or assistant) within a nexus_session.
-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.nexus_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid references public.nexus_sessions(id) on delete cascade,
  user_id    uuid references auth.users on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  agent      text,
  created_at timestamptz default now()
);

-- Index for fast session message queries (ordered by time)
create index if not exists nexus_messages_session_id_created_at_idx
  on public.nexus_messages (session_id, created_at asc);

-- Index for user-scoped queries
create index if not exists nexus_messages_user_id_idx
  on public.nexus_messages (user_id);

-- ── Row Level Security ──────────────────────────────────────────────────────

alter table public.nexus_messages enable row level security;

-- Users can only see their own messages
create policy "nexus_messages: users read own"
  on public.nexus_messages
  for select
  using (user_id = auth.uid());

-- Users can insert their own messages
create policy "nexus_messages: users insert own"
  on public.nexus_messages
  for insert
  with check (user_id = auth.uid());

-- Users can update their own messages
create policy "nexus_messages: users update own"
  on public.nexus_messages
  for update
  using (user_id = auth.uid());

-- Users can delete their own messages (cascade handles this from session delete)
create policy "nexus_messages: users delete own"
  on public.nexus_messages
  for delete
  using (user_id = auth.uid());
