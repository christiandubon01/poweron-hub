-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 103: Project-only Assignment Project Eligibility
-- EMERG-PROJECT-ONLY-CLOCK-103
--
-- DEPENDS ON: 102 (canonical record_session_punch(TEXT, UUID, TEXT) only)
--
-- Root cause of Project-only Clock In failure after migrations 101–102:
--   Project-only clock_in validated exclusively against app_state
--   (state_key = 'poweron_v2', data.projects, active/archive filters).
--   EmployeeJobPicker also surfaces Projects from eligible
--   employee_task_assignments. A Project can therefore be visible and
--   employee-authorized via an assignment while absent from, archived in,
--   or otherwise rejected by app_state — causing Project-only Clock In to
--   fail even though the frontend payload is correct:
--     { p_action: 'clock_in', p_assignment_id: null, p_project_id: 'proj...' }
--
-- Fix:
--   CREATE OR REPLACE the canonical three-argument record_session_punch.
--   Project-only clock_in accepts a Project when EITHER:
--     A. Active org Project via existing app_state validation, OR
--     B. Current employee has ≥1 eligible assignment for that exact
--        canonical project_id TEXT (org-scoped, assigned_employee_ids,
--        status IN ('assigned','in_progress')).
--   Fallback B keeps assignment_id NULL (still a Project-only session),
--   stores the canonical TEXT project_id, and takes project_name from the
--   eligible assignment row. No Work Package attach, no public.projects
--   UUID, no name-only match, no fake assignment.
--
-- Preserved unchanged:
--   Assignment-mode clock_in
--   lunch_out / lunch_in / clock_out
--   Punch timestamps and minute calculations
--   One-active-session protection
--   Multiple sequential sessions
--   sync_time_entry_from_sessions aggregation trigger
--   RLS policies
--   Migrations 097–102 SQL files (immutable)
--
-- No table or data changes.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.record_session_punch(
  p_action        TEXT,
  p_assignment_id UUID DEFAULT NULL,
  p_project_id    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid             UUID;
  v_profile         employee_profiles%ROWTYPE;
  v_org_id          UUID;
  v_owner_id        UUID;
  v_now             TIMESTAMPTZ;
  v_work_date       DATE;
  v_session         employee_work_sessions%ROWTYPE;
  v_assignment      employee_task_assignments%ROWTYPE;
  v_project_ref_id  TEXT;
  v_project_name    TEXT;
  v_work_pkg_name   TEXT;
  v_assignment_id   UUID;
  v_wo_version      INTEGER;
  v_total_mins      INT;
  v_lunch_mins      INT;
  v_paid_mins       INT;
  v_project_json    JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_action NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  SELECT *
  INTO v_profile
  FROM employee_profiles ep
  WHERE ep.user_id = v_uid
    AND ep.active = true
    AND (
      ep.portal_access @> '{"time_tracking": true}'::jsonb
      OR ep.portal_access->>'time_tracking' = 'true'
    )
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'No active employee profile with time tracking access';
  END IF;

  v_org_id    := v_profile.org_id;
  v_now       := now();
  v_work_date := public.tenant_work_date(v_now, v_org_id);

  -- ── Clock In ──────────────────────────────────────────────────────────────

  IF p_action = 'clock_in' THEN

    IF p_assignment_id IS NULL AND p_project_id IS NULL THEN
      RAISE EXCEPTION 'Either p_assignment_id or p_project_id required for clock_in';
    END IF;

    -- Duplicate-submission guard (any clock_in within 60 s for this employee)
    IF EXISTS (
      SELECT 1 FROM time_punch_events tpe
      WHERE tpe.employee_profile_id = v_profile.id
        AND tpe.work_date = v_work_date
        AND tpe.punch_type = 'clock_in'
        AND tpe.is_void = false
        AND tpe.punched_at > v_now - INTERVAL '60 seconds'
    ) THEN
      RAISE EXCEPTION 'Duplicate clock_in: wait 60 seconds before trying again';
    END IF;

    -- Block clock_in if a previous day''s session is still open
    IF EXISTS (
      SELECT 1 FROM employee_work_sessions ews
      WHERE ews.employee_profile_id = v_profile.id
        AND ews.clock_out_at IS NULL
        AND ews.clock_in_at IS NOT NULL
        AND ews.work_date < v_work_date
    ) THEN
      RAISE EXCEPTION 'clock_in not allowed: previous workday session still open';
    END IF;

    IF p_assignment_id IS NOT NULL THEN
      -- ── ASSIGNMENT MODE ──────────────────────────────────────────────────────
      -- Validate assignment membership and status. Store canonical BackupData
      -- project_id TEXT directly from the assignment — no UUID conversion needed.

      SELECT *
      INTO v_assignment
      FROM public.employee_task_assignments t
      WHERE t.id = p_assignment_id
        AND t.org_id = v_org_id
        AND t.status IN ('assigned', 'in_progress')
        AND v_profile.id = ANY(t.assigned_employee_ids)
      LIMIT 1;

      IF v_assignment.id IS NULL THEN
        RAISE EXCEPTION 'Assignment not found or not eligible';
      END IF;

      v_project_ref_id := v_assignment.project_id;
      v_project_name   := v_assignment.project_name;
      v_work_pkg_name  := v_assignment.work_package_name;
      v_assignment_id  := v_assignment.id;
      v_wo_version     := v_assignment.current_work_order_version;

    ELSE
      -- ── PROJECT-ONLY MODE ─────────────────────────────────────────────────────
      -- Path A: active org Project via app_state JSON (existing validation).
      -- Path B: eligible employee assignment for the exact canonical project_id.
      -- Org membership is guaranteed by the employee_profiles scoping above.

      SELECT o.owner_id INTO v_owner_id
      FROM public.organizations o
      WHERE o.id = v_org_id;

      IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Organization owner not configured';
      END IF;

      SELECT sub.proj INTO v_project_json
      FROM public.app_state ast
      JOIN LATERAL (
        SELECT value AS proj
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(ast.data->'projects') = 'array'
               THEN ast.data->'projects'
               ELSE '[]'::jsonb
          END
        )
      ) sub ON true
      WHERE ast.user_id::text = v_owner_id::text
        AND ast.state_key = 'poweron_v2'
        AND sub.proj->>'id' = p_project_id
        AND (sub.proj->>'deletedAt')   IS NULL
        AND (sub.proj->>'archived')    IS DISTINCT FROM 'true'
        AND (sub.proj->>'isArchived')  IS DISTINCT FROM 'true'
        AND (sub.proj->>'archivedAt')  IS NULL
        AND COALESCE(sub.proj->>'status',  '')
              NOT IN ('deleted','lost','rejected','cancelled','canceled','archived')
        AND COALESCE(sub.proj->>'outcome', '')
              NOT IN ('lost','cancelled','canceled')
      LIMIT 1;

      IF v_project_json IS NOT NULL THEN
        -- Path A: app_state active project
        v_project_ref_id := p_project_id;
        v_project_name   := v_project_json->>'name';
        v_work_pkg_name  := NULL;
        v_assignment_id  := NULL;
        v_wo_version     := NULL;
      ELSE
        -- Path B: assignment-backed Project eligibility for THIS employee only.
        -- Requires org match, exact canonical project_id, employee in
        -- assigned_employee_ids, and eligible status. Does NOT attach the
        -- Work Package — session remains Project-only (assignment_id NULL).

        SELECT *
        INTO v_assignment
        FROM public.employee_task_assignments t
        WHERE t.org_id = v_org_id
          AND t.project_id = p_project_id
          AND t.status IN ('assigned', 'in_progress')
          AND v_profile.id = ANY(t.assigned_employee_ids)
        LIMIT 1;

        IF v_assignment.id IS NULL THEN
          RAISE EXCEPTION 'Project not found, not active, or does not belong to this organization';
        END IF;

        v_project_ref_id := p_project_id;
        v_project_name   := v_assignment.project_name;
        v_work_pkg_name  := NULL;
        v_assignment_id  := NULL;
        v_wo_version     := NULL;
      END IF;

    END IF;

    -- Insert new session; unique partial index prevents overlapping active sessions
    BEGIN
      INSERT INTO employee_work_sessions (
        org_id, employee_profile_id, assignment_id, project_id, work_order_version,
        project_name, work_package_name, work_date, clock_in_at, status
      ) VALUES (
        v_org_id,
        v_profile.id,
        v_assignment_id,
        v_project_ref_id,
        v_wo_version,
        v_project_name,
        v_work_pkg_name,
        v_work_date,
        v_now,
        'open'
      )
      RETURNING * INTO v_session;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'An active session already exists; clock out before starting a new one';
    END;

    INSERT INTO time_punch_events (
      org_id, employee_user_id, employee_profile_id,
      work_date, punch_type, punched_at, source, session_id
    ) VALUES (
      v_org_id, v_uid, v_profile.id,
      v_work_date, 'clock_in', v_now, 'employee_portal', v_session.id
    );

  -- ── Lunch Out, Lunch In, Clock Out ────────────────────────────────────────

  ELSE

    SELECT *
    INTO v_session
    FROM employee_work_sessions ews
    WHERE ews.employee_profile_id = v_profile.id
      AND ews.work_date = v_work_date
      AND ews.clock_in_at IS NOT NULL
      AND ews.clock_out_at IS NULL
    ORDER BY ews.clock_in_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_session.id IS NULL THEN
      RAISE EXCEPTION 'No active session found for today; clock in first';
    END IF;

    IF p_action = 'lunch_out' THEN

      IF v_session.lunch_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Lunch already started for this session';
      END IF;
      IF v_session.clock_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Session already closed';
      END IF;

      UPDATE employee_work_sessions
      SET lunch_out_at = v_now, updated_at = v_now
      WHERE id = v_session.id
      RETURNING * INTO v_session;

    ELSIF p_action = 'lunch_in' THEN

      IF v_session.lunch_out_at IS NULL THEN
        RAISE EXCEPTION 'Must start lunch before ending it';
      END IF;
      IF v_session.lunch_in_at IS NOT NULL THEN
        RAISE EXCEPTION 'Lunch already ended for this session';
      END IF;
      IF v_session.clock_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Session already closed';
      END IF;

      UPDATE employee_work_sessions
      SET lunch_in_at = v_now, updated_at = v_now
      WHERE id = v_session.id
      RETURNING * INTO v_session;

    ELSIF p_action = 'clock_out' THEN

      IF v_session.clock_out_at IS NOT NULL THEN
        RAISE EXCEPTION 'Session already closed';
      END IF;
      IF v_session.lunch_out_at IS NOT NULL AND v_session.lunch_in_at IS NULL THEN
        RAISE EXCEPTION 'clock_out not allowed: lunch started but not ended';
      END IF;

      v_total_mins := GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (v_now - v_session.clock_in_at)) / 60)::INT);

      IF v_session.lunch_out_at IS NOT NULL AND v_session.lunch_in_at IS NOT NULL THEN
        v_lunch_mins := GREATEST(0,
          FLOOR(EXTRACT(EPOCH FROM (v_session.lunch_in_at - v_session.lunch_out_at)) / 60)::INT);
      ELSE
        v_lunch_mins := 0;
      END IF;

      v_paid_mins := GREATEST(0, v_total_mins - v_lunch_mins);

      UPDATE employee_work_sessions
      SET
        clock_out_at  = v_now,
        total_minutes = v_total_mins,
        lunch_minutes = v_lunch_mins,
        paid_minutes  = v_paid_mins,
        status        = 'complete',
        updated_at    = v_now
      WHERE id = v_session.id
      RETURNING * INTO v_session;

    END IF;

    INSERT INTO time_punch_events (
      org_id, employee_user_id, employee_profile_id,
      work_date, punch_type, punched_at, source, session_id
    ) VALUES (
      v_org_id, v_uid, v_profile.id,
      v_work_date, p_action, v_now, 'employee_portal', v_session.id
    );

  END IF;

  RETURN jsonb_build_object(
    'sessionId',       v_session.id,
    'status',          v_session.status,
    'workDate',        v_session.work_date,
    'projectId',       v_session.project_id,
    'assignmentId',    v_session.assignment_id,
    'projectName',     v_session.project_name,
    'workPackageName', v_session.work_package_name,
    'clockInAt',       v_session.clock_in_at,
    'lunchOutAt',      v_session.lunch_out_at,
    'lunchInAt',       v_session.lunch_in_at,
    'clockOutAt',      v_session.clock_out_at,
    'paidMinutes',     v_session.paid_minutes,
    'lunchMinutes',    v_session.lunch_minutes,
    'totalMinutes',    v_session.total_minutes
  );
END;
$$;

COMMENT ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) IS
  'Multi-session punch (migration 103). clock_in accepts either '
  'p_assignment_id UUID (assignment mode) or p_project_id TEXT (project-only: '
  'accepted via app_state active project OR eligible employee assignment for '
  'that exact canonical project_id; assignment_id remains NULL). Other actions '
  'resolve the active session server-side. Returns authoritative session state.';

REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) TO authenticated;

COMMIT;

-- ── Verification (run manually after apply) ───────────────────────────────────

-- 1. Only one record_session_punch overload exists
-- SELECT proname, pg_get_function_arguments(oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname = 'record_session_punch'
-- ORDER BY args;
-- Expected: exactly one row with (text, uuid DEFAULT NULL, text DEFAULT NULL)

-- 2. authenticated can execute; anon cannot
-- SELECT has_function_privilege('authenticated',
--   'public.record_session_punch(text, uuid, text)', 'EXECUTE');  -- true
-- SELECT has_function_privilege('anon',
--   'public.record_session_punch(text, uuid, text)', 'EXECUTE');  -- false
