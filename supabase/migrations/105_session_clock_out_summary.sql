-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 105: Session Clock Out End-of-Day Summary
-- EMPLOYEE-SESSION-CLOSEOUT-1
--
-- DEPENDS ON: 104 (canonical record_session_punch(TEXT, UUID, TEXT))
--
-- Root cause:
--   Session Clock Out calls record_session_punch without an end-of-day summary.
--   The historical daily closeout UI was removed with job-linked sessions.
--   time_punch_events.end_of_day_summary already exists (migration 083) but
--   record_session_punch never wrote it.
--
-- Fix:
--   Drop the 3-arg canonical overload and create one 4-arg function with
--   p_end_of_day_summary TEXT DEFAULT NULL. Preserve the full migration-104
--   body. On clock_out only, trim/null empty text (max 4000 chars) and persist
--   on the exact Clock Out time_punch_events row for that session.
--
-- Preserved unchanged:
--   Project-only and assignment clock_in
--   lunch_out / lunch_in / clock_out calculations
--   Duplicate clock_in 60s guard / one-active-session protection
--   sync_time_entry_from_sessions aggregation
--   RLS / org and employee validation
--   Migrations 097–104 SQL files (immutable)
--
-- Exactly one record_session_punch overload remains after this migration.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Replace the 3-arg canonical function with a 4-arg signature.
-- CREATE OR REPLACE cannot add a parameter; drop then recreate.
DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.record_session_punch(
  p_action              TEXT,
  p_assignment_id       UUID DEFAULT NULL,
  p_project_id          TEXT DEFAULT NULL,
  p_end_of_day_summary  TEXT DEFAULT NULL
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
  v_summary         TEXT;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_action NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  -- Summary accepted only on clock_out; trim empties to NULL; cap length.
  v_summary := NULL;
  IF p_action = 'clock_out' AND p_end_of_day_summary IS NOT NULL THEN
    v_summary := NULLIF(btrim(p_end_of_day_summary), '');
    IF v_summary IS NOT NULL AND char_length(v_summary) > 4000 THEN
      RAISE EXCEPTION 'End-of-day summary is too long';
    END IF;
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
      -- Path A: app_state when owner_id present; Path B: eligible assignment.
      v_project_json := NULL;

      SELECT o.owner_id INTO v_owner_id
      FROM public.organizations o
      WHERE o.id = v_org_id;

      IF v_owner_id IS NOT NULL THEN
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
      END IF;

      IF v_project_json IS NOT NULL THEN
        v_project_ref_id := p_project_id;
        v_project_name   := v_project_json->>'name';
        v_work_pkg_name  := NULL;
        v_assignment_id  := NULL;
        v_wo_version     := NULL;
      ELSE
        SELECT *
        INTO v_assignment
        FROM public.employee_task_assignments t
        WHERE t.org_id = v_org_id
          AND t.project_id = p_project_id
          AND t.status IN ('assigned', 'in_progress')
          AND v_profile.id = ANY(t.assigned_employee_ids)
        LIMIT 1;

        IF v_assignment.id IS NULL THEN
          RAISE EXCEPTION 'Project not found, not active, or not available to this employee';
        END IF;

        v_project_ref_id := p_project_id;
        v_project_name   := v_assignment.project_name;
        v_work_pkg_name  := NULL;
        v_assignment_id  := NULL;
        v_wo_version     := NULL;
      END IF;

    END IF;

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

    -- Persist punch event. end_of_day_summary is set only for clock_out
    -- (v_summary is NULL for lunch_out / lunch_in).
    INSERT INTO time_punch_events (
      org_id, employee_user_id, employee_profile_id,
      work_date, punch_type, punched_at, source, session_id,
      end_of_day_summary
    ) VALUES (
      v_org_id, v_uid, v_profile.id,
      v_work_date, p_action, v_now, 'employee_portal', v_session.id,
      v_summary
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

COMMENT ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) IS
  'Multi-session punch (migration 105). Same as 104 plus optional '
  'p_end_of_day_summary on clock_out only, stored on the Clock Out '
  'time_punch_events row for the session.';

REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT, TEXT) TO authenticated;

COMMIT;

-- ── Verification (run manually after apply) ───────────────────────────────────
-- SELECT proname, pg_get_function_arguments(oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname = 'record_session_punch';
-- Expected: exactly one row — (text, uuid, text, text)
