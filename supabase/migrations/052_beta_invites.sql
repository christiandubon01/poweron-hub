-- ============================================================
-- Migration 052: Beta Invite System
-- B7 — Beta Invite System | April 2026
-- ============================================================

create table if not exists public.beta_invites (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  invited_by     uuid references auth.users(id) on delete set null,
  invite_token   text unique not null,
  industry       text,
  status         text not null default 'pending'
                   check (status in ('pending', 'accepted', 'expired')),
  invited_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  expires_at     timestamptz not null default (now() + interval '7 days')
);

-- Index for fast token lookups (validation on app load)
create index if not exists beta_invites_token_idx
  on public.beta_invites (invite_token);

-- Index for listing invites by owner
create index if not exists beta_invites_invited_by_idx
  on public.beta_invites (invited_by);

-- Index for status filtering
create index if not exists beta_invites_status_idx
  on public.beta_invites (status);

-- Auto-expire: rows with expires_at in the past but still 'pending'
-- can be swept to 'expired' by a scheduled job or via the revokeInvite helper.
-- We add a convenience view for "active pending" invites.
create or replace view public.beta_invites_active as
  select *
  from public.beta_invites
  where status = 'pending'
    and expires_at > now();

-- RLS: owners (service role) manage all rows; anon can validate a token
alter table public.beta_invites enable row level security;

-- Service role bypass — all Netlify functions run with service key
create policy "service_role_all" on public.beta_invites
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Authenticated owner can read own invites
create policy "owner_read" on public.beta_invites
  for select
  using (invited_by = auth.uid());

-- Anon can look up a specific token (validate invite)
create policy "anon_token_lookup" on public.beta_invites
  for select
  using (true);
