-- ============================================================================
-- Migration 027: Daily Briefing pg_cron Job
-- Schedules the daily-briefing Edge Function at 6:30 AM Pacific (13:30 UTC)
-- ============================================================================

-- NOTE: pg_cron and pg_net must be enabled in Supabase Dashboard → Extensions
-- before running this migration.

-- Enable extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Schedule the daily briefing
-- 6:30 AM Pacific = 13:30 UTC (standard time) / 12:30 UTC (daylight time)
-- Using 13:30 UTC as the baseline; adjust seasonally or use a timezone-aware scheduler.
SELECT cron.schedule(
  'daily-nexus-briefing',
  '30 13 * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/daily-briefing',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- To manually test: run the Edge Function directly from Supabase Dashboard
-- or use: SELECT net.http_post(...) with the URL above.
