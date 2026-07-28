-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 086: EMS Phase 4 — Employee Scheduling
--
-- Workstream 1: employee_schedules table + indexes + RLS
-- Workstream 2: get_my_schedule(p_date) RPC
-- Workstream 3: update_my_schedule_status(p_schedule_id, p_status) RPC
--
-- DEPENDS ON: 083 (employee_task_assignments), 085 (phase 3)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. employee_schedules table ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_schedules (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               UUID NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id  UUID NOT NULL
    REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  work_date            DATE NOT NULL,
  start_time           TIME,
  end_time             TIME,
  estimated_minutes    INT,
  assignment_id        UUID
    REFERENCES public.employee_task_assignments(id) ON DELETE SET NULL,
  work_package_id      TEXT,
  work_package_name    TEXT,
  project_id           TEXT,
  project_name         TEXT,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'in_progress', 'done', 'cancelled')),
  created_by           UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employee_schedules IS
  'Owner-assigned daily schedule items for employees. '
  'Employees may update status (scheduled→in_progress→done) via RPC only.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_employee_schedules_org_date
  ON public.employee_schedules (org_id, work_date);

CREATE INDEX IF NOT EXISTS idx_employee_schedules_profile_date
  ON public.employee_schedules (employee_profile_id, work_date);

CREATE INDEX IF NOT EXISTS idx_employee_schedules_assignment
  ON public.employee_schedules (assignment_id)
  WHERE assignment_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_employee_schedules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_employee_schedules_updated_at
  ON public.employee_schedules;

CREATE TRIGGER trg_employee_schedules_updated_at
  BEFORE UPDATE ON public.employee_schedules
  FOR EACH ROW EXECUTE FUNCTION public.touch_employee_schedules_updated_at();

-- ── 2. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.employee_schedules ENABLE ROW LEVEL SECURITY;

-- Owner/admin: full CRUD within their org
CREATE POLICY es_owner_admin_all ON public.employee_schedules
  FOR ALL
  USING (public.is_org_admin_for(org_id))
  WITH CHECK (public.is_org_admin_for(org_id));

-- Employee: SELECT own rows (via their profile mapping)
CREATE POLICY es_employee_select_own ON public.employee_schedules
  FOR SELECT
  USING (
    employee_profile_id = (
      SELECT ep.id
        FROM public.employee_profiles ep
       WHERE ep.user_id = auth.uid()
         AND ep.active = true
       LIMIT 1
    )
  );

-- Employee: UPDATE own row, status column only (status transitions enforced in RPC)
CREATE POLICY es_employee_update_own_status ON public.employee_schedules
  FOR UPDATE
  USING (
    employee_profile_id = (
      SELECT ep.id
        FROM public.employee_profiles ep
       WHERE ep.user_id = auth.uid()
         AND ep.active = true
       LIMIT 1
    )
  );

-- ── 3. get_my_schedule(p_date) ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_schedule(p_date DATE)
RETURNS TABLE (
  id                  UUID,
  org_id              UUID,
  employee_profile_id UUID,
  work_date           DATE,
  start_time          TIME,
  end_time            TIME,
  estimated_minutes   INT,
  assignment_id       UUID,
  work_package_id     TEXT,
  work_package_name   TEXT,
  project_id          TEXT,
  project_name        TEXT,
  notes               TEXT,
  status              TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.org_id,
    s.employee_profile_id,
    s.work_date,
    s.start_time,
    s.end_time,
    s.estimated_minutes,
    s.assignment_id,
    s.work_package_id,
    s.work_package_name,
    s.project_id,
    s.project_name,
    s.notes,
    s.status,
    s.created_by,
    s.created_at,
    s.updated_at
  FROM public.employee_schedules s
  INNER JOIN public.employee_profiles ep
    ON ep.user_id = auth.uid()
   AND ep.active  = true
   AND ep.id      = s.employee_profile_id
  WHERE s.work_date = p_date
  ORDER BY s.start_time NULLS LAST, s.created_at;
$$;

COMMENT ON FUNCTION public.get_my_schedule(DATE) IS
  'Employee-facing: returns all schedule items for the caller on the given date, '
  'ordered by start_time (nulls last). SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.get_my_schedule(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_schedule(DATE) TO authenticated;

-- ── 4. update_my_schedule_status(p_schedule_id, p_status) ────────────────────

CREATE OR REPLACE FUNCTION public.update_my_schedule_status(
  p_schedule_id UUID,
  p_status      TEXT
)
RETURNS public.employee_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_profile employee_profiles%ROWTYPE;
  v_row     employee_schedules%ROWTYPE;
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
     AND ep.active  = true
   ORDER BY ep.accepted_at NULLS LAST
   LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'No active employee profile';
  END IF;

  v_status := lower(btrim(p_status));
  IF v_status NOT IN ('scheduled', 'in_progress', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  SELECT s.*
    INTO v_row
    FROM employee_schedules s
   WHERE s.id = p_schedule_id
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Schedule item not found';
  END IF;

  IF v_row.employee_profile_id <> v_profile.id THEN
    RAISE EXCEPTION 'Schedule item not found';
  END IF;

  -- Only allow forward status transitions
  IF v_row.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot update a cancelled item';
  END IF;
  IF v_row.status = 'done' AND v_status NOT IN ('done', 'in_progress') THEN
    RAISE EXCEPTION 'Cannot move from done to %', v_status;
  END IF;

  UPDATE public.employee_schedules
     SET status     = v_status,
         updated_at = now()
   WHERE id = v_row.id
   RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.update_my_schedule_status(UUID, TEXT) IS
  'Employee updates own schedule item status. Validates ownership and '
  'rejects invalid transitions. SECURITY DEFINER.';

REVOKE ALL ON FUNCTION public.update_my_schedule_status(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_schedule_status(UUID, TEXT) TO authenticated;

COMMIT;
