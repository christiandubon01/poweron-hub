-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 100: Project-Only Work Sessions
-- EMPLOYEE-CLOCK-WORKSPACE-1
--
-- DEPENDS ON: 099 (employee_work_sessions, record_session_punch,
--                  get_my_eligible_assignments, admin_record_session_punch)
--
-- Overview:
--   Employees may now Clock In by selecting a Project only, with no specific
--   Work Package/Work Order required. Owners can attach the correct Work Package
--   to a project-only session later via the Admin Punch History interface.
--
-- Changes:
--   employee_work_sessions.project_id  — new nullable FK to projects
--   Backfill project_id from existing assignment relationships
--   get_employee_active_projects()     — RPC: employee-safe active project list
--   record_session_punch()             — extended: accepts p_project_id for
--                                        project-only Clock In (replaces mig-099
--                                        version with backward-compatible new arg)
--   admin_attach_session_assignment()  — RPC: owner attaches assignment to a
--                                        project-only session after the fact
--
-- Preserved unchanged:
--   All punch timestamps in employee_work_sessions
--   paid_minutes, lunch_minutes, total_minutes
--   The one-active-session-per-employee partial unique index
--   sync_time_entry_from_sessions trigger
--   admin_record_session_punch
--   submit_punch_edit_request
--   All time_punch_events rows
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Add project_id column to employee_work_sessions ────────────────────────

ALTER TABLE public.employee_work_sessions
  ADD COLUMN IF NOT EXISTS project_id UUID
    REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ews_project_id
  ON public.employee_work_sessions (project_id)
  WHERE project_id IS NOT NULL;

COMMENT ON COLUMN public.employee_work_sessions.project_id IS
  'FK to projects; set on Clock In. Nullable for backward compat with pre-100 rows. '
  'For project-only sessions: assignment_id IS NULL, project_id IS NOT NULL. '
  'For assignment sessions: both are set (project_id resolved from assignment).';

-- ── 2. Backfill project_id for existing assignment sessions ───────────────────
-- Derive from the authoritative assignment relationship; never infer from text.
--
-- Type compatibility: employee_task_assignments.project_id is TEXT (BackupData
-- legacy identity, no SQL FK to projects). employee_work_sessions.project_id is
-- UUID. We resolve the authoritative UUID by joining through projects on text
-- equality (p.id::text = eta.project_id). Sessions whose assignment has a stale,
-- blank, or non-UUID project_id are left with project_id NULL and preserved intact.
-- The verification query below counts any such unresolved rows after deployment.

UPDATE public.employee_work_sessions ews
SET project_id = p.id
FROM public.employee_task_assignments eta
JOIN public.projects p ON p.id::text = eta.project_id
WHERE ews.assignment_id = eta.id
  AND ews.project_id IS NULL;

-- ── 3. get_employee_active_projects — employee-safe project list ──────────────
--
-- Returns projects the employee may select for project-only clocking.
-- Deliberately excludes: estimated_value, contract_value, actual_cost,
-- client financial details, private notes, margins, owner-only contacts,
-- Blueprint data, unrelated Work Packages.

CREATE OR REPLACE FUNCTION public.get_employee_active_projects()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_profile employee_profiles%ROWTYPE;
  v_result  JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',     p.id,
        'name',   p.name,
        'status', p.status
      )
      ORDER BY p.name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.projects p
  WHERE p.org_id = v_profile.org_id
    AND p.status IN ('approved', 'in_progress', 'punch_list');

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_employee_active_projects() IS
  'Returns the org''s active projects (approved/in_progress/punch_list) for the '
  'employee-facing project-only Clock In flow. Exposes only id, name, status. '
  'No financial, client, estimate, or margin data.';

REVOKE ALL ON FUNCTION public.get_employee_active_projects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_employee_active_projects() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_employee_active_projects() TO authenticated;

-- ── 4. record_session_punch — extended for project-only Clock In ──────────────
--
-- Replaces the migration-099 version with a backward-compatible new parameter:
--   p_project_id UUID DEFAULT NULL
--
-- Clock In now supports two modes:
--   ASSIGNMENT MODE:    p_assignment_id supplied, p_project_id ignored
--   PROJECT-ONLY MODE: p_project_id supplied, p_assignment_id NULL
--
-- At least one of p_assignment_id or p_project_id is required for clock_in.
-- For all other actions (lunch_out, lunch_in, clock_out) both are ignored;
-- the server resolves the active session by employee profile.
--
-- The JSONB return is extended with 'projectId' so the frontend can update
-- state without a round-trip even for project-only sessions.

CREATE OR REPLACE FUNCTION public.record_session_punch(
  p_action        TEXT,
  p_assignment_id UUID DEFAULT NULL,
  p_project_id    UUID DEFAULT NULL
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
  v_now             TIMESTAMPTZ;
  v_work_date       DATE;
  v_session         employee_work_sessions%ROWTYPE;
  v_assignment      employee_task_assignments%ROWTYPE;
  v_project         projects%ROWTYPE;
  v_project_id      UUID;
  v_project_name    TEXT;
  v_work_pkg_name   TEXT;
  v_assignment_id   UUID;
  v_wo_version      INTEGER;
  v_total_mins      INT;
  v_lunch_mins      INT;
  v_paid_mins       INT;
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
      -- ── ASSIGNMENT MODE ──

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

      -- employee_task_assignments.project_id is TEXT (BackupData legacy identity;
      -- no SQL FK). Resolve the authoritative UUID through public.projects before
      -- storing in employee_work_sessions.project_id (UUID column).
      SELECT *
      INTO v_project
      FROM public.projects p
      WHERE p.id::text = v_assignment.project_id
        AND p.org_id = v_org_id
      LIMIT 1;

      IF v_project.id IS NULL THEN
        RAISE EXCEPTION 'Assignment references a project that no longer exists in this organization';
      END IF;

      v_project_id    := v_project.id;
      v_project_name  := v_assignment.project_name;
      v_work_pkg_name := v_assignment.work_package_name;
      v_assignment_id := v_assignment.id;
      v_wo_version    := v_assignment.current_work_order_version;

    ELSE
      -- ── PROJECT-ONLY MODE ──

      SELECT *
      INTO v_project
      FROM public.projects p
      WHERE p.id = p_project_id
        AND p.org_id = v_org_id
        AND p.status IN ('approved', 'in_progress', 'punch_list');

      IF v_project.id IS NULL THEN
        RAISE EXCEPTION 'Project not found, not active, or does not belong to this organization';
      END IF;

      v_project_id    := v_project.id;
      v_project_name  := v_project.name;
      v_work_pkg_name := NULL;
      v_assignment_id := NULL;
      v_wo_version    := NULL;

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
        v_project_id,
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

  -- Return full session state so the frontend can update immediately
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

COMMENT ON FUNCTION public.record_session_punch(TEXT, UUID, UUID) IS
  'Extended multi-session punch (migration 100). clock_in accepts either '
  'p_assignment_id (assignment mode) or p_project_id (project-only mode). '
  'Other actions resolve the active session server-side — p_project_id and '
  'p_assignment_id are ignored. Returns authoritative session state JSONB '
  'including projectId so the frontend never needs a round-trip reload.';

REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, UUID) TO authenticated;

-- ── 5. admin_attach_session_assignment — owner attaches a Work Package later ──
--
-- For project-only sessions (assignment_id IS NULL, project_id IS NOT NULL):
-- the owner can link a specific Work Package/Work Order assignment after the
-- employee finishes their shift. No punch timestamps are changed.

CREATE OR REPLACE FUNCTION public.admin_attach_session_assignment(
  p_session_id    UUID,
  p_assignment_id UUID
)
RETURNS public.employee_work_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session    employee_work_sessions%ROWTYPE;
  v_assignment employee_task_assignments%ROWTYPE;
  v_project    projects%ROWTYPE;
BEGIN
  -- ── 1. Fetch and lock the session ──
  SELECT * INTO v_session
  FROM employee_work_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session not found';
  END IF;

  -- ── 2. Authorization ──
  IF NOT public.is_org_admin_for(v_session.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- ── 3. Validate assignment (same org, eligible status) ──
  SELECT * INTO v_assignment
  FROM public.employee_task_assignments t
  WHERE t.id = p_assignment_id
    AND t.org_id = v_session.org_id
    AND t.status IN ('assigned', 'in_progress');

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'Assignment not found, belongs to a different organization, or is not in an eligible status';
  END IF;

  -- ── 3b. Resolve assignment project UUID ──
  -- employee_task_assignments.project_id is TEXT (BackupData legacy identity;
  -- no SQL FK to projects). Resolve the authoritative UUID through projects so
  -- every comparison and assignment is UUID vs UUID — never TEXT vs UUID.
  SELECT * INTO v_project
  FROM public.projects p
  WHERE p.id::text = v_assignment.project_id
    AND p.org_id = v_session.org_id
  LIMIT 1;

  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'Assignment references a project that no longer exists in this organization';
  END IF;

  -- Reject if resolved project differs from the session project (UUID vs UUID)
  IF v_session.project_id IS NOT NULL
     AND v_project.id != v_session.project_id THEN
    RAISE EXCEPTION 'Assignment belongs to a different project than the session';
  END IF;

  -- ── 4. Attach assignment — preserve all timestamps and minute totals ──
  UPDATE public.employee_work_sessions
  SET
    assignment_id      = v_assignment.id,
    project_id         = COALESCE(v_session.project_id, v_project.id),
    work_package_name  = v_assignment.work_package_name,
    work_order_version = v_assignment.current_work_order_version,
    updated_at         = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  -- Note: clock_in_at, lunch_out_at, lunch_in_at, clock_out_at,
  --       total_minutes, lunch_minutes, paid_minutes are intentionally
  --       NOT modified. The sync trigger fires but totals stay identical.

  RETURN v_session;
END;
$$;

COMMENT ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) IS
  'Attach a Work Package/assignment to a project-only session (assignment_id IS NULL). '
  'Updates assignment_id, work_package_name, work_order_version. '
  'Punch timestamps and minute totals are preserved exactly. '
  'Validates: caller is owner/admin for the session org; assignment belongs to '
  'the same org; project matches when session has project_id set. '
  'The sync trigger rebuilds time_entries but totals are unchanged.';

REVOKE ALL ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) TO authenticated;

-- ── 6. Admin-visible assignments per project ──────────────────────────────────
-- Lightweight read helper so the Attach Work Package UI can show a dropdown
-- without exposing any RLS-restricted financial columns.

CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(
  p_project_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_org_id  UUID;
  v_result  JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Confirm caller is an admin for the project's org
  SELECT p.org_id INTO v_org_id
  FROM public.projects p
  WHERE p.id = p_project_id;

  IF v_org_id IS NULL OR NOT public.is_org_admin_for(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized or project not found';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',               t.id,
        'work_package_name', t.work_package_name,
        'status',           t.status
      )
      ORDER BY t.work_package_name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.employee_task_assignments t
  WHERE t.project_id = p_project_id::text
    AND t.org_id = v_org_id
    AND t.status IN ('assigned', 'in_progress');

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_project_assignments_for_admin(UUID) IS
  'Returns active assignments for a project for the admin Attach Work Package UI. '
  'Caller must be owner/admin for the project''s org.';

REVOKE ALL ON FUNCTION public.get_project_assignments_for_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_project_assignments_for_admin(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_assignments_for_admin(UUID) TO authenticated;

COMMIT;

-- ── Verification (run manually after apply) ───────────────────────────────────

-- 1. project_id column exists with correct type
-- SELECT column_name, data_type, udt_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'employee_work_sessions'
--   AND column_name = 'project_id';
-- Expected: column_name=project_id, data_type=uuid

-- 2. Assignment-linked sessions that were backfilled
-- SELECT COUNT(*) AS backfilled
-- FROM public.employee_work_sessions
-- WHERE assignment_id IS NOT NULL AND project_id IS NOT NULL;

-- 3. Assignment-linked sessions with UNRESOLVED project reference (should be 0)
-- If non-zero, the assignment's project_id was stale/missing at migration time.
-- SELECT COUNT(*) AS unresolved_legacy_references
-- FROM public.employee_work_sessions ews
-- JOIN public.employee_task_assignments eta ON eta.id = ews.assignment_id
-- WHERE ews.project_id IS NULL
--   AND eta.project_id IS NOT NULL
--   AND eta.project_id != '';

-- 4. All migration-100 RPCs exist
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname IN (
--   'get_employee_active_projects',
--   'record_session_punch',
--   'admin_attach_session_assignment',
--   'get_project_assignments_for_admin'
-- ) ORDER BY proname;

-- 5. authenticated execute allowed (expect 4 rows — one per RPC)
-- SELECT r.rolname, p.proname, has_function_privilege(r.oid, p.oid, 'EXECUTE') AS can_exec
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- JOIN pg_roles r ON r.rolname = 'authenticated'
-- WHERE n.nspname = 'public'
--   AND p.proname IN (
--     'get_employee_active_projects',
--     'admin_attach_session_assignment',
--     'get_project_assignments_for_admin'
--   );

-- 6. anon execute denied
-- SELECT has_function_privilege('anon',
--   'public.get_employee_active_projects()', 'EXECUTE') AS anon_can_exec;
-- Expected: false

-- 7. active-session partial unique index preserved
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'employee_work_sessions'
--   AND indexname = 'idx_ews_one_active_session_per_employee';

-- 8. aggregation trigger preserved
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.employee_work_sessions'::regclass
--   AND tgname = 'trg_sync_time_entry_from_sessions';
