-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 083: Employee Portal Feature 1
--
-- Workstream 1: end_of_day_summary on time_punch_events + record_time_punch arg
-- Workstream 2: employee_task_assignments + RLS + employee RPCs (lead privacy)
--
-- DEPENDS ON: 081 (employee time tracking), 082 (employee invite RPCs)
--
-- NOTE: Work packages live in BackupData JSON (operationsBlueprintScopeLayers),
-- not a SQL work_packages table. Assignments store work_package_id as TEXT with
-- denormalized name/project context — no FK to a nonexistent table.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Clock-out summary column ───────────────────────────────────────────────

ALTER TABLE public.time_punch_events
  ADD COLUMN IF NOT EXISTS end_of_day_summary TEXT;

COMMENT ON COLUMN public.time_punch_events.end_of_day_summary IS
  'Optional end-of-day summary captured on clock_out. Nullable; empty means omitted.';

-- ── 2. record_time_punch — optional end-of-day summary ────────────────────────
-- Replace the 1-arg signature with a 2-arg version (second arg defaults NULL).

DROP FUNCTION IF EXISTS public.record_time_punch(TEXT);

CREATE OR REPLACE FUNCTION public.record_time_punch(
  p_punch_type TEXT,
  p_end_of_day_summary TEXT DEFAULT NULL
)
RETURNS public.time_punch_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid               UUID;
  v_profile           employee_profiles%ROWTYPE;
  v_profile_count     INT;
  v_org_id            UUID;
  v_work_date         DATE;
  v_now               TIMESTAMPTZ;
  v_has_clock_in      BOOLEAN;
  v_has_lunch_out     BOOLEAN;
  v_has_lunch_in      BOOLEAN;
  v_has_clock_out     BOOLEAN;
  v_punch_count_today INT;
  v_inserted          time_punch_events%ROWTYPE;
  v_summary           TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_punch_type NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid punch type: %', p_punch_type;
  END IF;

  -- Only persist summary on clock_out; trim empties to NULL.
  v_summary := NULL;
  IF p_punch_type = 'clock_out' AND p_end_of_day_summary IS NOT NULL THEN
    v_summary := NULLIF(btrim(p_end_of_day_summary), '');
  END IF;

  SELECT COUNT(*)
  INTO v_profile_count
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
    AND (
      ep.portal_access @> '{"time_tracking": true}'::jsonb
      OR ep.portal_access->>'time_tracking' = 'true'
    );

  IF v_profile_count = 0 THEN
    RAISE EXCEPTION 'No active employee profile with time tracking access';
  END IF;

  IF v_profile_count > 1 THEN
    RAISE EXCEPTION 'Multiple active employee profiles found; Phase 1 requires exactly one';
  END IF;

  SELECT ep.*
  INTO v_profile
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
    AND (
      ep.portal_access @> '{"time_tracking": true}'::jsonb
      OR ep.portal_access->>'time_tracking' = 'true'
    )
  LIMIT 1;

  v_org_id    := v_profile.org_id;
  v_now       := now();
  v_work_date := public.tenant_work_date(v_now, v_org_id);

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'clock_in'
      AND tpe.is_void = false
  ) INTO v_has_clock_in;

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'lunch_out'
      AND tpe.is_void = false
  ) INTO v_has_lunch_out;

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'lunch_in'
      AND tpe.is_void = false
  ) INTO v_has_lunch_in;

  SELECT EXISTS (
    SELECT 1 FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = 'clock_out'
      AND tpe.is_void = false
  ) INTO v_has_clock_out;

  SELECT COUNT(*)
  INTO v_punch_count_today
  FROM time_punch_events tpe
  WHERE tpe.employee_profile_id = v_profile.id
    AND tpe.work_date = v_work_date
    AND tpe.is_void = false;

  IF EXISTS (
    SELECT 1
    FROM time_punch_events tpe
    WHERE tpe.employee_profile_id = v_profile.id
      AND tpe.work_date = v_work_date
      AND tpe.punch_type = p_punch_type
      AND tpe.is_void = false
      AND tpe.punched_at > v_now - INTERVAL '60 seconds'
  ) THEN
    RAISE EXCEPTION 'Duplicate punch: wait 60 seconds before repeating the same punch type';
  END IF;

  IF p_punch_type = 'clock_in' THEN
    IF v_punch_count_today > 0 THEN
      RAISE EXCEPTION 'clock_in not allowed: punches already exist for today';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM time_entries te
      WHERE te.employee_user_id = v_uid
        AND te.status = 'open'
        AND te.work_date < v_work_date
    ) THEN
      RAISE EXCEPTION 'clock_in not allowed: previous workday still open';
    END IF;

  ELSIF p_punch_type = 'lunch_out' THEN
    IF NOT v_has_clock_in THEN
      RAISE EXCEPTION 'lunch_out requires clock_in first';
    END IF;
    IF v_has_lunch_out THEN
      RAISE EXCEPTION 'lunch_out already recorded for today';
    END IF;
    IF v_has_clock_out THEN
      RAISE EXCEPTION 'lunch_out not allowed after clock_out';
    END IF;

  ELSIF p_punch_type = 'lunch_in' THEN
    IF NOT v_has_lunch_out THEN
      RAISE EXCEPTION 'lunch_in requires lunch_out first';
    END IF;
    IF v_has_lunch_in THEN
      RAISE EXCEPTION 'lunch_in already recorded for today';
    END IF;
    IF v_has_clock_out THEN
      RAISE EXCEPTION 'lunch_in not allowed after clock_out';
    END IF;

  ELSIF p_punch_type = 'clock_out' THEN
    IF NOT v_has_clock_in THEN
      RAISE EXCEPTION 'clock_out requires clock_in first';
    END IF;
    IF v_has_clock_out THEN
      RAISE EXCEPTION 'clock_out already recorded for today';
    END IF;
    IF v_has_lunch_out AND NOT v_has_lunch_in THEN
      RAISE EXCEPTION 'clock_out not allowed: lunch_out exists without lunch_in';
    END IF;
  END IF;

  INSERT INTO time_punch_events (
    org_id,
    employee_user_id,
    employee_profile_id,
    work_date,
    punch_type,
    punched_at,
    source,
    end_of_day_summary
  )
  VALUES (
    v_org_id,
    v_uid,
    v_profile.id,
    v_work_date,
    p_punch_type,
    v_now,
    'employee_portal',
    v_summary
  )
  RETURNING * INTO v_inserted;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.record_time_punch(TEXT, TEXT) IS
  'Records an employee time punch after validating sequence and duplicates. '
  'Optional p_end_of_day_summary is stored only on clock_out. '
  'Returns the inserted time_punch_events row. Client must not INSERT directly.';

REVOKE ALL ON FUNCTION public.record_time_punch(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_time_punch(TEXT, TEXT) TO authenticated;

-- ── 3. employee_task_assignments ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_task_assignments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Work packages live in BackupData JSON — TEXT id, no FK.
  work_package_id         TEXT NOT NULL,
  work_package_name       TEXT NOT NULL,
  project_id              TEXT,
  project_name            TEXT,
  blueprint_set_id        TEXT,
  lead_employee_id        UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE RESTRICT,
  assigned_employee_ids   UUID[] NOT NULL,
  assigned_by             UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date                DATE,
  status                  TEXT NOT NULL DEFAULT 'assigned'
                            CHECK (status IN ('assigned', 'in_progress', 'completed')),
  completion_notes        TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT eta_assigned_nonempty CHECK (cardinality(assigned_employee_ids) >= 1),
  CONSTRAINT eta_lead_in_assigned CHECK (lead_employee_id = ANY (assigned_employee_ids))
);

COMMENT ON TABLE public.employee_task_assignments IS
  'Owner-delegated work package assignments to portal employees. '
  'lead_employee_id is owner/admin-only — never exposed via employee RPCs.';

COMMENT ON COLUMN public.employee_task_assignments.lead_employee_id IS
  'Private primary assignee. Employees must not see this column or any lead badge.';

COMMENT ON COLUMN public.employee_task_assignments.work_package_id IS
  'BackupData scope-layer / work-package id (not a SQL FK).';

CREATE INDEX IF NOT EXISTS idx_eta_org_status
  ON public.employee_task_assignments (org_id, status);

CREATE INDEX IF NOT EXISTS idx_eta_org_assigned_at
  ON public.employee_task_assignments (org_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_eta_lead
  ON public.employee_task_assignments (lead_employee_id);

CREATE INDEX IF NOT EXISTS idx_eta_assigned_gin
  ON public.employee_task_assignments USING GIN (assigned_employee_ids);

CREATE TRIGGER mdt_employee_task_assignments
  BEFORE UPDATE ON public.employee_task_assignments
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.employee_task_assignments ENABLE ROW LEVEL SECURITY;

-- Owner/admin: full access within their org. No employee SELECT on the base table
-- (employees use SECURITY DEFINER RPCs that omit lead_employee_id).

CREATE POLICY eta_owner_admin_select ON public.employee_task_assignments
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

CREATE POLICY eta_owner_admin_insert ON public.employee_task_assignments
  FOR INSERT
  WITH CHECK (
    public.is_org_admin_for(org_id)
    AND org_id = public.user_org_id()
  );

CREATE POLICY eta_owner_admin_update ON public.employee_task_assignments
  FOR UPDATE
  USING (public.is_org_admin_for(org_id))
  WITH CHECK (public.is_org_admin_for(org_id));

CREATE POLICY eta_owner_admin_delete ON public.employee_task_assignments
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

-- ── 4. Employee read RPC (no lead_employee_id) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_employee_tasks()
RETURNS TABLE (
  id                 UUID,
  org_id             UUID,
  work_package_id    TEXT,
  work_package_name  TEXT,
  project_id         TEXT,
  project_name       TEXT,
  due_date           DATE,
  status             TEXT,
  completion_notes   TEXT,
  assigned_at        TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ,
  can_complete       BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.org_id,
    t.work_package_id,
    t.work_package_name,
    t.project_id,
    t.project_name,
    t.due_date,
    t.status,
    t.completion_notes,
    t.assigned_at,
    t.updated_at,
    (t.lead_employee_id = ep.id) AS can_complete
  FROM public.employee_task_assignments t
  INNER JOIN public.employee_profiles ep
    ON ep.user_id = auth.uid()
   AND ep.active = true
   AND ep.org_id = t.org_id
  WHERE ep.id = ANY (t.assigned_employee_ids)
  ORDER BY t.due_date NULLS LAST, t.assigned_at DESC;
$$;

COMMENT ON FUNCTION public.get_my_employee_tasks() IS
  'Employee-facing task list. Omits lead_employee_id; can_complete is true only for the private lead.';

REVOKE ALL ON FUNCTION public.get_my_employee_tasks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_employee_tasks() TO authenticated;

-- ── 5. Employee write RPC (lead only: status + completion_notes) ──────────────

CREATE OR REPLACE FUNCTION public.update_my_employee_task(
  p_assignment_id UUID,
  p_status TEXT DEFAULT NULL,
  p_completion_notes TEXT DEFAULT NULL
)
RETURNS public.employee_task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_profile employee_profiles%ROWTYPE;
  v_row     employee_task_assignments%ROWTYPE;
  v_status  TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ep.*
  INTO v_profile
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
  ORDER BY ep.accepted_at NULLS LAST
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'No active employee profile';
  END IF;

  SELECT t.*
  INTO v_row
  FROM employee_task_assignments t
  WHERE t.id = p_assignment_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_row.org_id <> v_profile.org_id THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF v_row.lead_employee_id <> v_profile.id THEN
    RAISE EXCEPTION 'Only the primary assignee can update this task';
  END IF;

  IF NOT (v_profile.id = ANY (v_row.assigned_employee_ids)) THEN
    RAISE EXCEPTION 'Not assigned to this task';
  END IF;

  IF p_status IS NOT NULL THEN
    v_status := lower(btrim(p_status));
    IF v_status NOT IN ('assigned', 'in_progress', 'completed') THEN
      RAISE EXCEPTION 'Invalid status: %', p_status;
    END IF;
    v_row.status := v_status;
  END IF;

  IF p_completion_notes IS NOT NULL THEN
    v_row.completion_notes := NULLIF(btrim(p_completion_notes), '');
  END IF;

  UPDATE employee_task_assignments
  SET
    status           = v_row.status,
    completion_notes = v_row.completion_notes,
    updated_at       = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT) IS
  'Lead-only update of status and completion_notes. Non-leads are rejected. '
  'Return row is for the RPC only — clients should re-fetch via get_my_employee_tasks.';

REVOKE ALL ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
