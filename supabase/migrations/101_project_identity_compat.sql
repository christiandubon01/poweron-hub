-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 101: Project Identity Compatibility
-- PROJECT-IDENTITY-COMPAT-101
--
-- DEPENDS ON: 100 (employee_work_sessions.project_id UUID column already added,
--                  get_employee_active_projects, record_session_punch(TEXT,UUID,UUID),
--                  admin_attach_session_assignment, get_project_assignments_for_admin(UUID))
--
-- Root cause of migration-100 incompatibility:
--   employee_task_assignments.project_id is TEXT because Work Packages and
--   Project context originate from the BackupData model (IDs generated
--   client-side as 'proj' + Date.now() + random chars). These IDs can never
--   match public.projects.id (UUID format). Migration-100's backfill joined
--   through public.projects using a text-cast comparison that always found
--   zero rows for BackupData-origin assignments, leaving all assignment
--   sessions with project_id = NULL after the backfill.
--
-- This migration:
--   1. Removes the incorrect UUID FK from employee_work_sessions.project_id
--   2. Changes the column to TEXT (same canonical identity as assignments)
--   3. Backfills project_id TEXT directly from employee_task_assignments
--   4. Replaces get_employee_active_projects to query app_state JSONB
--   5. Replaces record_session_punch with corrected p_project_id TEXT param
--   6. Replaces admin_attach_session_assignment with TEXT vs TEXT comparison
--   7. Replaces get_project_assignments_for_admin with TEXT p_project_id param
--
-- Preserved unchanged by this migration:
--   All punch timestamps in employee_work_sessions
--   paid_minutes, lunch_minutes, total_minutes
--   assignment_id, project_name, work_package_name
--   The one-active-session-per-employee partial unique index
--   sync_time_entry_from_sessions trigger
--   admin_record_session_punch
--   submit_punch_edit_request
--   All time_punch_events rows
--   Migrations 097–100 SQL files
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Remove UUID FK constraint ──────────────────────────────────────────────

ALTER TABLE public.employee_work_sessions
  DROP CONSTRAINT IF EXISTS employee_work_sessions_project_id_fkey;

-- ── 2. Drop the UUID-typed index ──────────────────────────────────────────────

DROP INDEX IF EXISTS public.idx_ews_project_id;

-- ── 3. Change project_id column: UUID → TEXT ──────────────────────────────────
-- Migration-100 backfill found zero rows because BackupData project IDs cannot
-- match UUID format. All sessions have project_id = NULL. Safe to retype.
-- Any rows that somehow received a UUID value are preserved as their ::text form.

ALTER TABLE public.employee_work_sessions
  ALTER COLUMN project_id TYPE TEXT USING project_id::text;

COMMENT ON COLUMN public.employee_work_sessions.project_id IS
  'Canonical BackupData project reference (TEXT). Same identity as '
  'employee_task_assignments.project_id (e.g. proj + timestamp + random chars). '
  'Set on Clock In. Nullable for pre-100 rows. '
  'For project-only sessions: assignment_id IS NULL, project_id IS NOT NULL. '
  'For assignment sessions: both are set (project_id copied from assignment). '
  'No SQL FK — BackupData IDs cannot reference public.projects. Migration 101.';

-- ── 4. Add TEXT-typed index ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_ews_project_ref_id
  ON public.employee_work_sessions (project_id)
  WHERE project_id IS NOT NULL;

-- ── 5. Backfill: direct TEXT copy from assignment rows ────────────────────────
-- employee_task_assignments.project_id is the authoritative source.
-- No UUID conversion needed — both sides are TEXT.
-- This naturally resolves any session whose migration-100 backfill found no match,
-- including any session whose assignment holds a BackupData project reference
-- that the migration-100 backfill could not resolve via the UUID join.

UPDATE public.employee_work_sessions ews
SET project_id = eta.project_id
FROM public.employee_task_assignments eta
WHERE ews.assignment_id = eta.id
  AND ews.project_id IS NULL
  AND eta.project_id IS NOT NULL
  AND eta.project_id <> '';

-- ── 6. Drop old record_session_punch(TEXT, UUID, UUID) ───────────────────────
-- Migration-100 created this 3-arg overload with p_project_id UUID.
-- The new version below uses p_project_id TEXT.

DROP FUNCTION IF EXISTS public.record_session_punch(TEXT, UUID, UUID);

-- ── 7. get_employee_active_projects — correct source: app_state JSONB ─────────
-- Migration-100 version queried public.projects (wrong registry).
-- Correct version reads the org owner's BackupData JSON (poweron_v2 key)
-- and applies the same active/archive/delete filter used client-side.

CREATE OR REPLACE FUNCTION public.get_employee_active_projects()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      UUID;
  v_profile  employee_profiles%ROWTYPE;
  v_owner_id UUID;
  v_result   JSONB;
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

  -- Resolve org → org owner → app_state row
  SELECT o.owner_id INTO v_owner_id
  FROM public.organizations o
  WHERE o.id = v_profile.org_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Organization owner not configured';
  END IF;

  -- Extract active BackupData projects from app_state JSONB.
  -- Filter mirrors isActiveProject() in backupDataService.ts:
  --   no deletedAt, not archived/isArchived/archivedAt,
  --   status not in terminal set, outcome not in lost/cancelled set.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',     proj->>'id',
        'name',   proj->>'name',
        'status', proj->>'status'
      )
      ORDER BY proj->>'name'
    ),
    '[]'::jsonb
  )
  INTO v_result
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
    AND ast.state_key      = 'poweron_v2'
    AND (sub.proj->>'id')  IS NOT NULL
    AND (sub.proj->>'id')  <> ''
    AND (sub.proj->>'deletedAt')   IS NULL
    AND (sub.proj->>'archived')    IS DISTINCT FROM 'true'
    AND (sub.proj->>'isArchived')  IS DISTINCT FROM 'true'
    AND (sub.proj->>'archivedAt')  IS NULL
    AND COALESCE(sub.proj->>'status',  '')
          NOT IN ('deleted','lost','rejected','cancelled','canceled','archived')
    AND COALESCE(sub.proj->>'outcome', '')
          NOT IN ('lost','cancelled','canceled');

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_employee_active_projects() IS
  'Returns the org''s active BackupData projects for employee project-only Clock In. '
  'Reads the org owner''s app_state JSON (poweron_v2) and filters for non-archived, '
  'non-deleted projects. Returns id (BackupData TEXT), name, status only. '
  'No financial, client, estimate, or margin data. '
  'Migration 101 corrects the migration-100 version that queried public.projects.';

REVOKE ALL ON FUNCTION public.get_employee_active_projects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_employee_active_projects() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_employee_active_projects() TO authenticated;

-- ── 8. record_session_punch — corrected p_project_id TEXT ────────────────────
-- Assignment mode: stores v_assignment.project_id TEXT directly.
-- Project-only mode: validates via app_state JSONB, stores BackupData ID TEXT.
-- No UUID resolution through public.projects at any point.

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
      -- Validate BackupData project via org owner''s app_state JSON.
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

      IF v_project_json IS NULL THEN
        RAISE EXCEPTION 'Project not found, not active, or does not belong to this organization';
      END IF;

      v_project_ref_id := p_project_id;
      v_project_name   := v_project_json->>'name';
      v_work_pkg_name  := NULL;
      v_assignment_id  := NULL;
      v_wo_version     := NULL;

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
  'Corrected multi-session punch (migration 101). clock_in accepts either '
  'p_assignment_id UUID (assignment mode: stores BackupData project_id TEXT '
  'directly from assignment) or p_project_id TEXT (project-only mode: validated '
  'via org owner''s app_state JSON). Other actions resolve the active session '
  'server-side. Returns authoritative session state JSONB including projectId. '
  'Replaces migration-100 version that used p_project_id UUID.';

REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID, TEXT) TO authenticated;

-- ── 9. admin_attach_session_assignment — TEXT vs TEXT project comparison ──────
-- Replaces migration-100 version that resolved UUID via public.projects join.
-- Both session.project_id and assignment.project_id are now TEXT; compare directly.

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

  -- ── 3b. Same-project guard: TEXT vs TEXT ──────────────────────────────────
  -- employee_work_sessions.project_id and employee_task_assignments.project_id
  -- are both TEXT (BackupData canonical identity). Direct equality — no UUID cast.
  IF v_session.project_id IS NOT NULL
     AND v_assignment.project_id IS NOT NULL
     AND v_session.project_id <> v_assignment.project_id THEN
    RAISE EXCEPTION 'Assignment belongs to a different project than the session';
  END IF;

  -- ── 4. Attach assignment — preserve all timestamps and minute totals ──
  UPDATE public.employee_work_sessions
  SET
    assignment_id      = v_assignment.id,
    project_id         = COALESCE(v_session.project_id, v_assignment.project_id),
    work_package_name  = v_assignment.work_package_name,
    work_order_version = v_assignment.current_work_order_version,
    updated_at         = now()
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  -- Note: clock_in_at, lunch_out_at, lunch_in_at, clock_out_at,
  --       total_minutes, lunch_minutes, paid_minutes intentionally NOT modified.

  RETURN v_session;
END;
$$;

COMMENT ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) IS
  'Attach a Work Package/assignment to a project-only session. '
  'session.project_id (TEXT) and assignment.project_id (TEXT) are both BackupData '
  'canonical identities; compared directly, no UUID resolution needed. '
  'Punch timestamps and minute totals preserved exactly. '
  'Migration 101 corrects migration-100 version that resolved UUID via public.projects.';

REVOKE ALL ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_attach_session_assignment(UUID, UUID) TO authenticated;

-- ── 10. Drop old get_project_assignments_for_admin(UUID) ─────────────────────

DROP FUNCTION IF EXISTS public.get_project_assignments_for_admin(UUID);

-- ── 11. get_project_assignments_for_admin — corrected to accept TEXT ──────────

CREATE OR REPLACE FUNCTION public.get_project_assignments_for_admin(
  p_project_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID;
  v_org_id UUID;
  v_result JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Authorization: caller must be admin for an org that has assignments
  -- referencing this BackupData project_id.
  SELECT t.org_id INTO v_org_id
  FROM public.employee_task_assignments t
  WHERE t.project_id = p_project_id
    AND public.is_org_admin_for(t.org_id)
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Not authorized or project not found';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                t.id,
        'work_package_name', t.work_package_name,
        'status',            t.status
      )
      ORDER BY t.work_package_name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.employee_task_assignments t
  WHERE t.project_id = p_project_id
    AND t.org_id = v_org_id
    AND t.status IN ('assigned', 'in_progress');

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_project_assignments_for_admin(TEXT) IS
  'Returns active assignments for a BackupData project for the admin '
  'Attach Work Package UI. p_project_id is the canonical BackupData TEXT id. '
  'Authorization: caller must be admin for an org with assignments in this project. '
  'Migration 101 corrects migration-100 version that accepted UUID.';

REVOKE ALL ON FUNCTION public.get_project_assignments_for_admin(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_project_assignments_for_admin(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_project_assignments_for_admin(TEXT) TO authenticated;

COMMIT;

-- ── Verification (run manually after apply) ───────────────────────────────────

-- 1. Column is now TEXT (not UUID)
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'employee_work_sessions'
--   AND column_name = 'project_id';
-- Expected: data_type = 'text'

-- 2. No UUID FK on project_id
-- SELECT constraint_name
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON kcu.constraint_name = tc.constraint_name
-- WHERE tc.table_schema = 'public'
--   AND tc.table_name = 'employee_work_sessions'
--   AND kcu.column_name = 'project_id'
--   AND tc.constraint_type = 'FOREIGN KEY';
-- Expected: 0 rows

-- 3. Backfill succeeded — unresolved assignment sessions should be 0
-- SELECT COUNT(*) AS still_unresolved
-- FROM public.employee_work_sessions ews
-- JOIN public.employee_task_assignments eta ON eta.id = ews.assignment_id
-- WHERE ews.project_id IS NULL
--   AND eta.project_id IS NOT NULL
--   AND eta.project_id <> '';
-- Expected: 0

-- 4. Spot-check backfilled sessions (BackupData IDs visible in project_id TEXT)
-- SELECT id, assignment_id, project_id, project_name
-- FROM public.employee_work_sessions
-- WHERE assignment_id IS NOT NULL
-- ORDER BY created_at DESC LIMIT 10;
-- Expected: project_id is non-null, matches BackupData proj-style ID from assignment

-- 5. Correct RPC signatures exist
-- SELECT proname, pg_get_function_arguments(oid) AS args
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname IN (
--   'record_session_punch',
--   'get_employee_active_projects',
--   'admin_attach_session_assignment',
--   'get_project_assignments_for_admin'
-- ) ORDER BY proname, args;
-- Expected for record_session_punch: (text, uuid DEFAULT NULL, text DEFAULT NULL)
-- Expected for get_project_assignments_for_admin: (text)

-- 6. No old UUID-based overloads remain
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND proname = 'record_session_punch'
--   AND pg_get_function_arguments(p.oid) LIKE '%uuid%uuid%';
-- Expected: 0 rows (only one record_session_punch with TEXT,UUID,TEXT remains)

-- 7. get_project_assignments_for_admin accepts TEXT, not UUID
-- SELECT proname, pg_get_function_arguments(oid)
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND proname = 'get_project_assignments_for_admin';
-- Expected: p_project_id text

-- 8. active-session partial unique index preserved
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'employee_work_sessions'
--   AND indexname = 'idx_ews_one_active_session_per_employee';

-- 9. aggregation trigger preserved
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.employee_work_sessions'::regclass
--   AND tgname = 'trg_sync_time_entry_from_sessions';
