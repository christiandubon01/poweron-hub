-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 115: Service Call Employee Assignments
-- SERVICE-LOG-1
--
-- Adds the normalized many-to-many relation between a Service Log record
-- (service estimate / service call) and the employees assigned to it, replacing
-- the single `technicianId` string that lived only in BackupData JSON.
--
-- Why a new relation instead of employee_task_assignments:
--   employee_task_assignments is the Work Order relation. Its rows drive the
--   admin Work Order board, immutable Work Order versions, snapshot delivery,
--   assigned-hours archiving and — through migration 103 — Project-only clock-in
--   eligibility. Writing service calls into it would inject non-project rows into
--   all of those flows. This relation is deliberately separate and additive:
--   migrations 083/093–110 are untouched and no existing RLS is weakened.
--
-- Employee-safe by construction:
--   The table stores ONLY the job facts an employee needs (customer, address,
--   date, job type, work description, assignment status). There is no column for
--   Total Quoted, Suggested Quote, profit, margin, internal cost, amount
--   collected or balance due, so owner financials cannot reach the portal even
--   if a future query selects *.
--
-- The job fields are denormalized per assignment row on purpose: the service
-- call itself lives in BackupData JSON (app_state), which employees have no read
-- access to. Owner saves rewrite the rows for that service call.
--
-- Created locally only. Not applied to production by this phase.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.service_call_assignments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Service estimates / service calls live in BackupData JSON — TEXT id, no FK.
  service_call_id      TEXT NOT NULL,
  service_call_kind    TEXT NOT NULL DEFAULT 'service_call'
                         CHECK (service_call_kind IN ('service_estimate', 'service_call')),

  employee_profile_id  UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,

  -- Employee-visible job facts only.
  customer_name        TEXT NOT NULL DEFAULT '',
  address              TEXT NOT NULL DEFAULT '',
  scheduled_date       DATE,
  job_type             TEXT NOT NULL DEFAULT '',
  work_description     TEXT NOT NULL DEFAULT '',
  assignment_status    TEXT NOT NULL DEFAULT 'assigned'
                         CHECK (assignment_status IN ('assigned', 'in_progress', 'completed', 'cancelled')),

  assigned_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One employee can be assigned to one service call exactly once.
  CONSTRAINT service_call_assignments_unique_member
    UNIQUE (org_id, service_call_id, employee_profile_id)
);

COMMENT ON TABLE public.service_call_assignments IS
  'SERVICE-LOG-1: employees assigned to a Service Log service estimate / service call. '
  'Employee-safe columns only — never add quote, profit, margin, cost or collections fields here.';

COMMENT ON COLUMN public.service_call_assignments.service_call_id IS
  'BackupData service estimate / service log id (TEXT, not a SQL FK).';

COMMENT ON COLUMN public.service_call_assignments.employee_profile_id IS
  'Canonical portal identity (employee_profiles.id). Never a display name or email.';

CREATE INDEX IF NOT EXISTS idx_sca_org_service_call
  ON public.service_call_assignments (org_id, service_call_id);

CREATE INDEX IF NOT EXISTS idx_sca_employee_profile
  ON public.service_call_assignments (employee_profile_id, scheduled_date DESC NULLS LAST);

DROP TRIGGER IF EXISTS mdt_service_call_assignments ON public.service_call_assignments;
CREATE TRIGGER mdt_service_call_assignments
  BEFORE UPDATE ON public.service_call_assignments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.service_call_assignments ENABLE ROW LEVEL SECURITY;

-- Owner / admin: full management inside their own organization.

DROP POLICY IF EXISTS sca_owner_admin_select ON public.service_call_assignments;
CREATE POLICY sca_owner_admin_select ON public.service_call_assignments
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

DROP POLICY IF EXISTS sca_owner_admin_insert ON public.service_call_assignments;
CREATE POLICY sca_owner_admin_insert ON public.service_call_assignments
  FOR INSERT
  WITH CHECK (
    public.is_org_admin_for(org_id)
    AND org_id = public.user_org_id()
  );

DROP POLICY IF EXISTS sca_owner_admin_update ON public.service_call_assignments;
CREATE POLICY sca_owner_admin_update ON public.service_call_assignments
  FOR UPDATE
  USING (public.is_org_admin_for(org_id))
  WITH CHECK (public.is_org_admin_for(org_id));

DROP POLICY IF EXISTS sca_owner_admin_delete ON public.service_call_assignments;
CREATE POLICY sca_owner_admin_delete ON public.service_call_assignments
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

-- Employee: read-only, and ONLY the rows that assign the job to them.
-- No employee INSERT / UPDATE / DELETE policy exists, so employees cannot
-- assign themselves or anyone else.

DROP POLICY IF EXISTS sca_employee_select_own ON public.service_call_assignments;
CREATE POLICY sca_employee_select_own ON public.service_call_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.employee_profiles ep
      WHERE ep.id = service_call_assignments.employee_profile_id
        AND ep.user_id = auth.uid()
        AND ep.active = true
        AND ep.org_id = service_call_assignments.org_id
    )
  );

-- ── 3. Backfill the existing single technician assignment ─────────────────────
--
-- Pre-phase service estimates stored one `technicianId`, which is the BackupData
-- cost-model employee id. It maps to a portal identity ONLY through the stable
-- employee_profiles.backup_employee_id link (ROLE-2.4) — never by name or email.
-- Estimates whose technician has no linked portal profile are skipped; nothing
-- is invented and no profile is created.

INSERT INTO public.service_call_assignments (
  org_id, service_call_id, service_call_kind, employee_profile_id,
  customer_name, address, scheduled_date, job_type, work_description, assignment_status
)
SELECT
  ep.org_id,
  est->>'id',
  'service_estimate',
  ep.id,
  COALESCE(est->>'customer', ''),
  COALESCE(est->>'address', ''),
  CASE
    WHEN COALESCE(est->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (est->>'date')::DATE
    ELSE NULL
  END,
  COALESCE(est->>'jobType', ''),
  COALESCE(est->>'notes', ''),
  'assigned'
FROM public.organizations o
JOIN public.app_state ast
  ON ast.user_id::text = o.owner_id::text
 AND ast.state_key = 'poweron_v2'
JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(ast.data->'serviceEstimates') = 'array'
       THEN ast.data->'serviceEstimates'
       ELSE '[]'::jsonb
  END
) AS est ON true
JOIN public.employee_profiles ep
  ON ep.org_id = o.id
 AND ep.backup_employee_id = est->>'technicianId'
WHERE COALESCE(est->>'technicianId', '') <> ''
  AND COALESCE(est->>'id', '') <> ''
  AND est->>'deletedAt' IS NULL
  AND COALESCE(est->>'archived', 'false') <> 'true'
ON CONFLICT ON CONSTRAINT service_call_assignments_unique_member DO NOTHING;

COMMIT;
