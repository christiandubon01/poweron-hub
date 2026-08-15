-- =============================================================================
-- Migration 127: Call logs foundation — LEAD-SRC-3B
-- =============================================================================
-- Durable org-scoped call records for manual + dialer-initiated logging.
-- Prospective only. Does NOT backfill, rewrite leads/clients/portal rows, or
-- invent telephony facts (duration, connect, inbound detection, ads attribution).
--
-- Marketing source field intentionally omitted: LEAD-SRC-1 categories are web
-- UTM/referrer classifiers; portal RPC maps empty → 'other'. Calls cannot infer
-- marketing source from the browser, so UNKNOWN stays out of this table until a
-- clean optional assert path is designed.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.call_logs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  hunter_tenant_id   UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  -- Nullable at rest so auth-user deletion retains call history (SET NULL).
  -- INSERT RLS still requires logged_by = auth.uid() for new attribution.
  logged_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  occurred_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  direction          TEXT NOT NULL
                       CHECK (direction IN ('inbound', 'outbound')),
  outcome            TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (outcome IN (
                         'unknown', 'answered', 'missed', 'no_answer', 'voicemail'
                       )),
  classification     TEXT NOT NULL DEFAULT 'unclassified'
                       CHECK (classification IN (
                         'unclassified', 'new_lead', 'existing_customer',
                         'spam', 'vendor', 'other'
                       )),

  phone_raw          TEXT NOT NULL,
  phone_normalized   TEXT,

  notes              TEXT,

  hunter_lead_id     UUID REFERENCES public.hunter_leads(id) ON DELETE SET NULL,
  portal_request_id  UUID REFERENCES public.portal_requests(id) ON DELETE SET NULL,
  client_id          UUID REFERENCES public.clients(id) ON DELETE SET NULL,

  CONSTRAINT call_logs_phone_raw_len
    CHECK (char_length(phone_raw) BETWEEN 1 AND 40),
  CONSTRAINT call_logs_phone_normalized_len
    CHECK (phone_normalized IS NULL OR char_length(phone_normalized) BETWEEN 10 AND 15),
  CONSTRAINT call_logs_notes_len
    CHECK (notes IS NULL OR char_length(notes) <= 5000)
);

COMMENT ON TABLE public.call_logs IS
  'LEAD-SRC-3B: owner/admin call history. Manual classification only; '
  'browser cannot know connect/duration/inbound events/provider attribution.';

COMMENT ON COLUMN public.call_logs.phone_normalized IS
  'Canonical US 10-digit match key when normalizeable; NULL when malformed.';

COMMENT ON COLUMN public.call_logs.hunter_tenant_id IS
  'Set when call is Hunter-scoped via organizations.hunter_tenant_id authority. '
  'Never from user_tenants LIMIT 1.';

CREATE INDEX IF NOT EXISTS call_logs_org_occurred_idx
  ON public.call_logs (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS call_logs_org_phone_norm_idx
  ON public.call_logs (organization_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_logs_hunter_lead_idx
  ON public.call_logs (hunter_lead_id)
  WHERE hunter_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_logs_hunter_tenant_idx
  ON public.call_logs (hunter_tenant_id, occurred_at DESC)
  WHERE hunter_tenant_id IS NOT NULL;

DROP TRIGGER IF EXISTS call_logs_updated_at ON public.call_logs;
CREATE TRIGGER call_logs_updated_at
  BEFORE UPDATE ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- Owner/admin of the active organization only. No employee broadening.
DROP POLICY IF EXISTS call_logs_owner_admin_select ON public.call_logs;
CREATE POLICY call_logs_owner_admin_select
  ON public.call_logs
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

DROP POLICY IF EXISTS call_logs_owner_admin_insert ON public.call_logs;
CREATE POLICY call_logs_owner_admin_insert
  ON public.call_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
    AND logged_by = auth.uid()
  );

DROP POLICY IF EXISTS call_logs_owner_admin_update ON public.call_logs;
CREATE POLICY call_logs_owner_admin_update
  ON public.call_logs
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

-- Intentionally no DELETE policy: call history is retained.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'call_logs'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: call_logs missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'call_logs'
      AND policyname = 'call_logs_owner_admin_select'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: call_logs_owner_admin_select missing';
  END IF;
END $$;

COMMIT;
