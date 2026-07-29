-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 092: Task Hours Spent
--
-- Workstream 1: hours_spent column on employee_task_assignments
-- Workstream 2: get_my_employee_tasks — expose hours_spent
-- Workstream 3: update_my_employee_task — accept + store p_hours_spent
--
-- DEPENDS ON: 085 (completed_at / completed_by columns + RPC versions)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. New column ─────────────────────────────────────────────────────────────

ALTER TABLE public.employee_task_assignments
  ADD COLUMN IF NOT EXISTS hours_spent NUMERIC(6, 2);

COMMENT ON COLUMN public.employee_task_assignments.hours_spent IS
  'Hours the lead employee logged when marking this task completed. '
  'Nullable — only set on completion via the employee portal.';

-- ── 2. get_my_employee_tasks — add hours_spent to return set ─────────────────

DROP FUNCTION IF EXISTS public.get_my_employee_tasks();

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
  hours_spent        NUMERIC,
  assigned_at        TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
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
    t.hours_spent,
    t.assigned_at,
    t.updated_at,
    t.completed_at,
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
  'Employee-facing task list. Omits lead_employee_id; exposes completed_at and hours_spent. '
  'can_complete is true only for the private lead.';

REVOKE ALL ON FUNCTION public.get_my_employee_tasks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_employee_tasks() TO authenticated;

-- ── 3. update_my_employee_task — accept p_hours_spent ────────────────────────
-- Must drop the existing 3-arg signature before adding the 4th parameter.

DROP FUNCTION IF EXISTS public.update_my_employee_task(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.update_my_employee_task(
  p_assignment_id    UUID,
  p_status           TEXT    DEFAULT NULL,
  p_completion_notes TEXT    DEFAULT NULL,
  p_hours_spent      NUMERIC DEFAULT NULL
)
RETURNS public.employee_task_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              UUID;
  v_profile          employee_profiles%ROWTYPE;
  v_row              employee_task_assignments%ROWTYPE;
  v_status           TEXT;
  v_new_completed_at TIMESTAMPTZ;
  v_new_completed_by UUID;
  v_log_completion   BOOLEAN := false;
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

  -- Apply status change
  IF p_status IS NOT NULL THEN
    v_status := lower(btrim(p_status));
    IF v_status NOT IN ('assigned', 'in_progress', 'completed') THEN
      RAISE EXCEPTION 'Invalid status: %', p_status;
    END IF;
    v_row.status := v_status;

    IF v_row.status = 'completed' THEN
      v_new_completed_at := now();
      v_new_completed_by := v_profile.id;
      v_log_completion   := true;
    ELSE
      -- Reverting from completed: clear stamps
      v_new_completed_at := NULL;
      v_new_completed_by := NULL;
    END IF;
  ELSE
    -- No status change: preserve existing completed_at / completed_by
    v_new_completed_at := v_row.completed_at;
    v_new_completed_by := v_row.completed_by;
  END IF;

  -- Apply notes change
  IF p_completion_notes IS NOT NULL THEN
    v_row.completion_notes := NULLIF(btrim(p_completion_notes), '');
  END IF;

  -- Apply hours change (only store positive values; NULL clears)
  IF p_hours_spent IS NOT NULL THEN
    IF p_hours_spent <= 0 THEN
      RAISE EXCEPTION 'hours_spent must be greater than zero';
    END IF;
    v_row.hours_spent := p_hours_spent;
  END IF;

  UPDATE employee_task_assignments
  SET
    status           = v_row.status,
    completion_notes = v_row.completion_notes,
    hours_spent      = v_row.hours_spent,
    completed_at     = v_new_completed_at,
    completed_by     = v_new_completed_by,
    updated_at       = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Log to completions table on completion
  IF v_log_completion THEN
    INSERT INTO employee_task_completions
      (org_id, assignment_id, employee_profile_id, notes)
    VALUES
      (v_row.org_id, p_assignment_id, v_profile.id, v_row.completion_notes)
    ON CONFLICT (assignment_id, employee_profile_id)
    DO UPDATE SET
      completed_at = now(),
      notes        = EXCLUDED.notes;
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC) IS
  'Lead-only update. When p_status=completed: stamps completed_at/by, stores hours_spent, '
  'and logs to employee_task_completions. When reverting: clears completed_at/by. '
  'Returns updated assignment row.';

REVOKE ALL ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT, NUMERIC) TO authenticated;

COMMIT;
