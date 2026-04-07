-- Migration 058: Daily Snapshots table (Feature F6 B42)
-- Stores one row per calendar day with a JSON blob of platform metrics.

create table if not exists public.daily_snapshots (
  id            uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  metrics_json  jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  -- Only one snapshot per calendar day
  constraint daily_snapshots_date_unique unique (snapshot_date)
);

-- Index for date-range queries used by the Daily Progress timeline
create index if not exists daily_snapshots_date_idx
  on public.daily_snapshots (snapshot_date desc);

-- RLS: admin-only read/write (anon cannot access)
alter table public.daily_snapshots enable row level security;

create policy "admins can select daily_snapshots"
  on public.daily_snapshots for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

create policy "admins can insert daily_snapshots"
  on public.daily_snapshots for insert
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
