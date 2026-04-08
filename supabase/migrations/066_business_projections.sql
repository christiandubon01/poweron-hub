-- 066_business_projections.sql
-- B68: Business Overview — software projection factors storage
-- Simple key-value store per user for projection inputs and RMO deal state.

create table if not exists public.business_projections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null,
  value       text not null default '',
  updated_at  timestamptz not null default now(),

  unique (user_id, key)
);

-- Index for fast per-user lookups
create index if not exists idx_business_projections_user_id
  on public.business_projections(user_id);

-- Enable Row Level Security
alter table public.business_projections enable row level security;

-- Policy: users can only read/write their own rows
create policy "Users manage own projections"
  on public.business_projections
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Trigger: auto-update updated_at on row change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger business_projections_updated_at
  before update on public.business_projections
  for each row execute procedure public.set_updated_at();
