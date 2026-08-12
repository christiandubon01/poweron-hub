-- 117_pilot_telemetry.sql
-- COMM-1E: durable event store for non-derivable pilot product telemetry only.
-- Business facts remain authoritative in their existing tables.

BEGIN;

CREATE TABLE IF NOT EXISTS public.pilot_telemetry_events (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_employee_profile_id UUID REFERENCES public.employee_profiles(id) ON DELETE SET NULL,
  actor_kind                TEXT NOT NULL DEFAULT 'owner_admin'
                              CHECK (actor_kind IN ('owner_admin', 'employee', 'founder', 'system')),
  event_name                TEXT NOT NULL,
  module                    TEXT,
  feature                   TEXT,
  object_id                 TEXT,
  metadata                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_demo                   BOOLEAN NOT NULL DEFAULT false,
  occurred_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pilot_telemetry_events IS
  'COMM-1E explicit product telemetry for the five-contractor pilot. '
  'Use only for non-derivable product interactions and founder support incidents.';

COMMENT ON COLUMN public.pilot_telemetry_events.metadata IS
  'Sparse categorical telemetry metadata only. Do not store customer names, addresses, payload dumps, estimate totals, document contents, or secrets.';

CREATE INDEX IF NOT EXISTS idx_pilot_telemetry_org_time
  ON public.pilot_telemetry_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_telemetry_event_time
  ON public.pilot_telemetry_events (event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_telemetry_actor
  ON public.pilot_telemetry_events (actor_user_id, occurred_at DESC);

ALTER TABLE public.pilot_telemetry_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pilot_telemetry_owner_admin_read ON public.pilot_telemetry_events;
CREATE POLICY pilot_telemetry_owner_admin_read
  ON public.pilot_telemetry_events
  FOR SELECT
  USING (
    is_demo = false
    AND public.is_org_admin_for(organization_id)
  );

COMMIT;
