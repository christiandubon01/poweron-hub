-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 085: EMS Phase 3 — Task Completion Tracking
--
-- Workstream 1: Add completed_at / completed_by to employee_task_assignments
-- Workstream 2: employee_task_completions log table + RLS
-- Workstream 3: UPDATE get_my_employee_tasks (expose completed_at)
-- Workstream 4: UPDATE update_my_employee_task (stamp + log completion)
--
-- DEPENDS ON: 083 (employee_task_assignments, update_my_employee_task),
--             084 (employee_role_column)
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. New columns on employee_task_assignments ───────────────────────────────

ALTER TABLE public.employee_task_assignments
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_by UUID
    REFERENCES public.employee_profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.employee_task_assignments.completed_at IS
  'Timestamp when the lead employee marked this task completed. NULL if not yet completed.';

COMMENT ON COLUMN public.employee_task_assignments.completed_by IS
  'employee_profiles.id of the lead who completed the task. NULL if not yet completed.';

-- ── 2. employee_task_completions log table ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_task_completions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id       UUID NOT NULL
    REFERENCES public.employee_task_assignments(id) ON DELETE CASCADE,
  employee_profile_id UUID NOT NULL
    REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  completed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes               TEXT,
  UNIQUE (assignment_id, employee_profile_id)
);

COMMENT ON TABLE public.employee_task_completions IS
  'Per-assignee completion log for employee_task_assignments. '
  'Upserted by update_my_employee_task when status = completed.';

CREATE INDEX IF NOT EXISTS idx_etc_assignment
  ON public.employee_task_completions (assignment_id);

CREATE INDEX IF NOT EXISTS idx_etc_profile_completed
  ON public.employee_task_completions (employee_profile_id, completed_at DESC);

ALTER TABLE public.employee_task_completions ENABLE ROW LEVEL SECURITY;

-- Owner/admin: full read within their org
CREATE POLICY etc_owner_admin_select ON public.employee_task_completions
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

-- Owner/admin: allow insert (admin overrides, back-fills)
CREATE POLICY etc_owner_admin_insert ON public.employee_task_completions
  FOR INSERT
  WITH CHECK (public.is_org_admin_for(org_id));

-- Employee INSERT own row (direct client path; primary path is via SECURITY DEFINER RPC)
CREATE POLICY etc_employee_insert_own ON public.employee_task_completions
  FOR INSERT
  WITH CHECK (
    employee_profile_id = (
      SELECT ep.id
        FROM public.employee_profiles ep
       WHERE ep.user_id = auth.uid()
         AND ep.active = true
       LIMIT 1
    )
  );

-- Employee SELECT own rows only
CREATE POLICY etc_employee_select_own ON public.employee_task_completions
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

-- ── 3. get_my_employee_tasks — expose completed_at ────────────────────────────

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
  'Employee-facing task list. Omits lead_employee_id; exposes completed_at. '
  'can_complete is true only for the private lead.';

REVOKE ALL ON FUNCTION public.get_my_employee_tasks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_employee_tasks() TO authenticated;

-- ── 4. update_my_employee_task — stamp completion, log to completions ─────────

CREATE OR REPLACE FUNCTION public.update_my_employee_task(
  p_assignment_id    UUID,
  p_status           TEXT DEFAULT NULL,
  p_completion_notes TEXT DEFAULT NULL
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
      -- Reverting from completed: clear stamp
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

  UPDATE employee_task_assignments
  SET
    status           = v_row.status,
    completion_notes = v_row.completion_notes,
    completed_at     = v_new_completed_at,
    completed_by     = v_new_completed_by,
    updated_at       = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  -- Log to completions table on completion (upsert: updating notes refreshes timestamp)
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

COMMENT ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT) IS
  'Lead-only update. When p_status=completed: stamps completed_at/by and logs to '
  'employee_task_completions. When reverting: clears completed_at/by. '
  'Returns updated assignment row.';

REVOKE ALL ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_employee_task(UUID, TEXT, TEXT) TO authenticated;

COMMIT;
