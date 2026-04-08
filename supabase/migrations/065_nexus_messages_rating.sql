-- ── 065_nexus_messages_rating.sql ───────────────────────────────────────────
-- B61c: Multi-session chat — feedback loops + response rating
-- Adds `rating` column to nexus_messages for thumbs up/down feedback.
-- 1 = thumbs_up, -1 = thumbs_down, 0 = unrated (default)
-- ──────────────────────────────────────────────────────────────────────────────

alter table public.nexus_messages
  add column if not exists rating int not null default 0;

comment on column public.nexus_messages.rating
  is 'User rating: 1=thumbs_up, -1=thumbs_down, 0=unrated';

-- Index for efficient lookup of recently rated messages by agent
create index if not exists nexus_messages_rating_agent_idx
  on public.nexus_messages (rating, agent, created_at desc)
  where rating != 0;
