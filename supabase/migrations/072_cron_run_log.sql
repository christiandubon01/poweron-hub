-- Migration 072: cron_run_log
-- Adds operational visibility into the TLMA scraper cron system.
-- Each invocation of tlma-scraper writes one row here at start and
-- updates it at end. UI reads this table to show per-city status.
-- Additive only — does not modify hunter_leads or tenant_settings.

CREATE TABLE IF NOT EXISTS public.cron_run_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID,                               -- nullable; cron has no tenant
  city            TEXT NOT NULL,                      -- "PALM DESERT", etc
  run_source      TEXT NOT NULL CHECK (run_source IN ('cron','manual')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('running','success','partial','failed')),
  new_leads       INTEGER NOT NULL DEFAULT 0,
  updated_leads   INTEGER NOT NULL DEFAULT 0,
  errors          INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  duration_ms     INTEGER,
  permit_types_processed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cron_run_log_started_at
  ON public.cron_run_log (started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_run_log_city_started
  ON public.cron_run_log (city, started_at DESC);

ALTER TABLE public.cron_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cron_run_log_select_authenticated"
  ON public.cron_run_log FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.cron_run_log TO authenticated;
GRANT INSERT, UPDATE ON public.cron_run_log TO service_role;
