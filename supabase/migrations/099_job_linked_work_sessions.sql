-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 099: Job-Linked Work Sessions
-- EMPLOYEE-JOB-CLOCK-SESSIONS-1
--
-- DEPENDS ON: 081 (time_punch_events, time_entries, employee_profiles,
--                  sync_time_entry_from_punches, tenant_work_date, moddatetime)
--             083 (employee_task_assignments, get_my_employee_tasks)
--             097 (time_punch_edit_requests, submit_punch_edit_request)
--
-- Overview:
--   Employees may clock in and out multiple times per work day, each time
--   linked to a specific assigned Work Order. Each session is an independent
--   row in employee_work_sessions, replacing the one-session-per-day assumption
--   that was hardcoded in migration 081's record_time_punch RPC.
--
-- New objects:
--   employee_work_sessions           — per-session clock row (many per day)
--   sync_time_entry_from_sessions()  — trigger: rebuilds time_entries aggregate
--   sync_time_entry_from_punches()   — replaces mig-081 version; session-aware
--   get_my_eligible_assignments()    — RPC: clock job picker data
--   record_session_punch()           — RPC: job-linked multi-session punching
--
-- Modified objects (backward-compatible column additions only):
--   time_punch_events.session_id                     — nullable FK (new column)
--   time_punch_edit_requests.session_id              — nullable FK (new column)
--   submit_punch_edit_request()                      — gains p_session_id param
--
-- Admin backward compat:
--   time_entries (one aggregate per employee per day) remains; the new trigger
--   sync_time_entry_from_sessions fires on session INSERT/UPDATE and rebuilds
--   the aggregate from all sessions for the day so admin dashboards and
--   Schedule Hours Worked continue to read correct totals.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. employee_work_sessions ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_work_sessions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id   UUID        NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  assignment_id         UUID        REFERENCES public.employee_task_assignments(id) ON DELETE SET NULL,
  work_order_version    INTEGER,
  project_name          TEXT,
  work_package_name     TEXT,
  work_date             DATE        NOT NULL,
  clock_in_at           TIMESTAMPTZ,
  lunch_out_at          TIMESTAMPTZ,
  lunch_in_at           TIMESTAMPTZ,
  clock_out_at          TIMESTAMPTZ,
  total_minutes         INTEGER,
  lunch_minutes         INTEGER     NOT NULL DEFAULT 0,
  paid_minutes          INTEGER,
  status                TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'complete', 'incomplete')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.employee_work_sessions IS
  'Per-session time record. Many rows per employee per work day are allowed. '
  'Created and updated exclusively by record_session_punch(). '
  'time_entries is rebuilt from these rows by sync_time_entry_from_sessions.';

COMMENT ON COLUMN public.employee_work_sessions.assignment_id IS
  'FK to employee_task_assignments; nullable so the row survives assignment deletion.';
COMMENT ON COLUMN public.employee_work_sessions.project_name IS
  'Denormalized from assignment at session start. Stable display label.';
COMMENT ON COLUMN public.employee_work_sessions.work_package_name IS
  'Denormalized from assignment at session start. Stable display label.';
COMMENT ON COLUMN public.employee_work_sessions.work_order_version IS
  'assignment.current_work_order_version at session creation. Immutable audit reference.';

CREATE TRIGGER mdt_employee_work_sessions
  BEFORE UPDATE ON public.employee_work_sessions
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Unique partial index: at most ONE active (no clock_out) session per employee.
-- Prevents race conditions (double-click / concurrent clock_in) at DB level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ews_one_active_session_per_employee
  ON public.employee_work_sessions (employee_profile_id)
  WHERE clock_out_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ews_profile_date
  ON public.employee_work_sessions (employee_profile_id, work_date);

CREATE INDEX IF NOT EXISTS idx_ews_org_date
  ON public.employee_work_sessions (org_id, work_date);

-- ── 2. session_id on time_punch_events ───────────────────────────────────────

ALTER TABLE public.time_punch_events
  ADD COLUMN IF NOT EXISTS session_id UUID
    REFERENCES public.employee_work_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tpe_session_id
  ON public.time_punch_events (session_id)
  WHERE session_id IS NOT NULL;

-- ── 3. session_id on time_punch_edit_requests ─────────────────────────────────

ALTER TABLE public.time_punch_edit_requests
  ADD COLUMN IF NOT EXISTS session_id UUID
    REFERENCES public.employee_work_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tper_session_id
  ON public.time_punch_edit_requests (session_id)
  WHERE session_id IS NOT NULL;

-- ── 4. sync_time_entry_from_sessions — trigger fn (fires on ews INSERT/UPDATE)

CREATE OR REPLACE FUNCTION public.sync_time_entry_from_sessions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id      UUID;
  v_work_date       DATE;
  v_org_id          UUID;
  v_emp_user_id     UUID;
  v_paid_minutes    INT;
  v_lunch_minutes   INT;
  v_total_minutes   INT;
  v_first_clock_in  TIMESTAMPTZ;
  v_last_clock_out  TIMESTAMPTZ;
  v_open_count      INT;
  v_session_count   INT;
  v_status          TEXT;
BEGIN
  v_profile_id := COALESCE(NEW.employee_profile_id, OLD.employee_profile_id);
  v_work_date  := COALESCE(NEW.work_date, OLD.work_date);

  SELECT ep.org_id, ep.user_id
  INTO v_org_id, v_emp_user_id
  FROM employee_profiles ep
  WHERE ep.id = v_profile_id;

  IF v_org_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Aggregate across ALL sessions for this profile+date
  SELECT
    COUNT(*)                  FILTER (WHERE clock_in_at IS NOT NULL),
    COUNT(*)                  FILTER (WHERE clock_out_at IS NULL AND clock_in_at IS NOT NULL),
    COALESCE(SUM(paid_minutes)  FILTER (WHERE paid_minutes IS NOT NULL), 0),
    COALESCE(SUM(lunch_minutes) FILTER (WHERE lunch_minutes IS NOT NULL), 0),
    COALESCE(SUM(total_minutes) FILTER (WHERE total_minutes IS NOT NULL), 0),
    MIN(clock_in_at),
    MAX(clock_out_at)
  INTO
    v_session_count,
    v_open_count,
    v_paid_minutes,
    v_lunch_minutes,
    v_total_minutes,
    v_first_clock_in,
    v_last_clock_out
  FROM employee_work_sessions
  WHERE employee_profile_id = v_profile_id
    AND work_date = v_work_date;

  IF v_session_count = 0 OR v_first_clock_in IS NULL THEN
    -- No sessions: remove the aggregate row if it exists
    DELETE FROM time_entries
    WHERE org_id = v_org_id
      AND employee_user_id = v_emp_user_id
      AND work_date = v_work_date;
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- At least one open session → overall status is open
  v_status := CASE WHEN v_open_count > 0 THEN 'open' ELSE 'complete' END;

  INSERT INTO time_entries (
    org_id, employee_user_id, employee_profile_id, work_date,
    clock_in_at, lunch_out_at, lunch_in_at, clock_out_at,
    total_minutes, lunch_minutes, paid_minutes, status
  )
  VALUES (
    v_org_id, v_emp_user_id, v_profile_id, v_work_date,
    v_first_clock_in, NULL, NULL, v_last_clock_out,
    CASE WHEN v_open_count = 0 THEN v_total_minutes ELSE NULL END,
    v_lunch_minutes,
    CASE WHEN v_open_count = 0 THEN v_paid_minutes ELSE NULL END,
    v_status
  )
  ON CONFLICT ON CONSTRAINT time_entries_org_employee_date_unique
  DO UPDATE SET
    employee_profile_id = EXCLUDED.employee_profile_id,
    clock_in_at         = EXCLUDED.clock_in_at,
    lunch_out_at        = EXCLUDED.lunch_out_at,
    lunch_in_at         = EXCLUDED.lunch_in_at,
    clock_out_at        = EXCLUDED.clock_out_at,
    total_minutes       = EXCLUDED.total_minutes,
    lunch_minutes       = EXCLUDED.lunch_minutes,
    paid_minutes        = EXCLUDED.paid_minutes,
    status              = EXCLUDED.status,
    updated_at          = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.sync_time_entry_from_sessions() IS
  'Rebuilds the time_entries aggregate (one per employee per day) from all '
  'employee_work_sessions rows for that employee+date.';

CREATE TRIGGER trg_sync_time_entry_from_sessions
  AFTER INSERT OR UPDATE
  ON public.employee_work_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_time_entry_from_sessions();

-- ── 5. Replace sync_time_entry_from_punches with a session-aware version ──────
-- When sessions exist for the profile+date the sessions trigger already rebuilt
-- time_entries; skip the punch-based rebuild to avoid overwriting it.
-- For legacy data (no sessions) the original punch-based logic is preserved.

CREATE OR REPLACE FUNCTION public.sync_time_entry_from_punches()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id        UUID;
  v_work_date         DATE;
  v_org_id            UUID;
  v_employee_user_id  UUID;
  v_clock_in          TIMESTAMPTZ;
  v_lunch_out         TIMESTAMPTZ;
  v_lunch_in          TIMESTAMPTZ;
  v_clock_out         TIMESTAMPTZ;
  v_total_minutes     INT;
  v_lunch_minutes     INT;
  v_paid_minutes      INT;
  v_status            TEXT;
  v_has_sessions      BOOLEAN;
BEGIN
  v_profile_id := COALESCE(NEW.employee_profile_id, OLD.employee_profile_id);
  v_work_date  := COALESCE(NEW.work_date, OLD.work_date);

  SELECT ep.org_id, ep.user_id
  INTO v_org_id, v_employee_user_id
  FROM employee_profiles ep
  WHERE ep.id = v_profile_id;

  IF v_org_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- If sessions exist, the session trigger already manages time_entries.
  -- Do NOT overwrite it here.
  SELECT EXISTS (
    SELECT 1 FROM employee_work_sessions
    WHERE employee_profile_id = v_profile_id
      AND work_date = v_work_date
  ) INTO v_has_sessions;

  IF v_has_sessions THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Legacy path: no sessions for this employee+date. Use punch-based aggregate
  -- (original migration 081 behavior — unchanged).
  SELECT
    MIN(CASE WHEN tpe.punch_type = 'clock_in'   THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'lunch_out'  THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'lunch_in'   THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'clock_out'  THEN tpe.punched_at END)
  INTO v_clock_in, v_lunch_out, v_lunch_in, v_clock_out
  FROM time_punch_events tpe
  WHERE tpe.employee_profile_id = v_profile_id
    AND tpe.work_date = v_work_date
    AND tpe.is_void = false;

  IF v_clock_in IS NULL THEN
    DELETE FROM time_entries
    WHERE org_id = v_org_id
      AND employee_user_id = v_employee_user_id
      AND work_date = v_work_date;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_clock_out IS NOT NULL THEN
    v_total_minutes := GREATEST(0,
      FLOOR(EXTRACT(EPOCH FROM (v_clock_out - v_clock_in)) / 60)::INT);
  ELSE
    v_total_minutes := NULL;
  END IF;

  IF v_lunch_out IS NOT NULL AND v_lunch_in IS NOT NULL THEN
    v_lunch_minutes := GREATEST(0,
      FLOOR(EXTRACT(EPOCH FROM (v_lunch_in - v_lunch_out)) / 60)::INT);
  ELSE
    v_lunch_minutes := 0;
  END IF;

  v_paid_minutes := CASE WHEN v_total_minutes IS NOT NULL
    THEN GREATEST(v_total_minutes - v_lunch_minutes, 0)
    ELSE NULL
  END;

  v_status := CASE WHEN v_clock_out IS NULL THEN 'open' ELSE 'complete' END;

  INSERT INTO time_entries (
    org_id, employee_user_id, employee_profile_id, work_date,
    clock_in_at, lunch_out_at, lunch_in_at, clock_out_at,
    total_minutes, lunch_minutes, paid_minutes, status
  )
  VALUES (
    v_org_id, v_employee_user_id, v_profile_id, v_work_date,
    v_clock_in, v_lunch_out, v_lunch_in, v_clock_out,
    v_total_minutes, v_lunch_minutes, v_paid_minutes, v_status
  )
  ON CONFLICT ON CONSTRAINT time_entries_org_employee_date_unique
  DO UPDATE SET
    employee_profile_id = EXCLUDED.employee_profile_id,
    clock_in_at         = EXCLUDED.clock_in_at,
    lunch_out_at        = EXCLUDED.lunch_out_at,
    lunch_in_at         = EXCLUDED.lunch_in_at,
    clock_out_at        = EXCLUDED.clock_out_at,
    total_minutes       = EXCLUDED.total_minutes,
    lunch_minutes       = EXCLUDED.lunch_minutes,
    paid_minutes        = EXCLUDED.paid_minutes,
    status              = EXCLUDED.status,
    updated_at          = now();

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.sync_time_entry_from_punches() IS
  'Session-aware replacement for the migration 081 trigger function. '
  'When employee_work_sessions rows exist for the profile+date the session '
  'trigger has already rebuilt time_entries, so this is a no-op for that day. '
  'For legacy days without sessions the original punch-based aggregate is applied.';

-- ── 6. get_my_eligible_assignments — job picker data ──────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_eligible_assignments()
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
        'id',               t.id,
        'project_id',       t.project_id,
        'project_name',     t.project_name,
        'work_package_id',  t.work_package_id,
        'work_package_name',t.work_package_name,
        'due_date',         t.due_date,
        'status',           t.status,
        'work_order_version', t.current_work_order_version
      )
      ORDER BY t.project_name, t.work_package_name
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM public.employee_task_assignments t
  WHERE t.org_id = v_profile.org_id
    AND t.status IN ('assigned', 'in_progress')
    AND v_profile.id = ANY(t.assigned_employee_ids);

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_my_eligible_assignments() IS
  'Returns a JSONB array of assigned + in_progress task assignments for the '
  'signed-in employee, ordered by project then work package. Used to populate '
  'the job picker in the employee Clock tab.';

REVOKE ALL ON FUNCTION public.get_my_eligible_assignments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_eligible_assignments() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_eligible_assignments() TO authenticated;

-- ── 7. record_session_punch — job-linked multi-session punch RPC ──────────────

CREATE OR REPLACE FUNCTION public.record_session_punch(
  p_action        TEXT,
  p_assignment_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           UUID;
  v_profile       employee_profiles%ROWTYPE;
  v_org_id        UUID;
  v_now           TIMESTAMPTZ;
  v_work_date     DATE;
  v_session       employee_work_sessions%ROWTYPE;
  v_assignment    employee_task_assignments%ROWTYPE;
  v_total_mins    INT;
  v_lunch_mins    INT;
  v_paid_mins     INT;
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

  -- ── Clock In: requires an eligible assignment, creates a new session ──────

  IF p_action = 'clock_in' THEN

    IF p_assignment_id IS NULL THEN
      RAISE EXCEPTION 'Assignment required for clock_in';
    END IF;

    -- Validate assignment: belongs to this org, employee is assigned, eligible status
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

    -- Duplicate-submission guard (same assignment within 60 s)
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

    -- Block clock_in if a previous day's session is still open
    IF EXISTS (
      SELECT 1 FROM employee_work_sessions ews
      WHERE ews.employee_profile_id = v_profile.id
        AND ews.clock_out_at IS NULL
        AND ews.clock_in_at IS NOT NULL
        AND ews.work_date < v_work_date
    ) THEN
      RAISE EXCEPTION 'clock_in not allowed: previous workday session still open';
    END IF;

    -- Insert new session; the unique partial index prevents overlapping active sessions
    BEGIN
      INSERT INTO employee_work_sessions (
        org_id, employee_profile_id, assignment_id, work_order_version,
        project_name, work_package_name, work_date, clock_in_at, status
      ) VALUES (
        v_org_id,
        v_profile.id,
        v_assignment.id,
        v_assignment.current_work_order_version,
        v_assignment.project_name,
        v_assignment.work_package_name,
        v_work_date,
        v_now,
        'open'
      )
      RETURNING * INTO v_session;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'An active session already exists; clock out before starting a new one';
    END;

    -- Record the punch event linked to this session
    INSERT INTO time_punch_events (
      org_id, employee_user_id, employee_profile_id,
      work_date, punch_type, punched_at, source, session_id
    ) VALUES (
      v_org_id, v_uid, v_profile.id,
      v_work_date, 'clock_in', v_now, 'employee_portal', v_session.id
    );

  -- ── Lunch Out, Lunch In, Clock Out: resolve the active session ────────────

  ELSE

    -- Find and lock the active open session for today
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

      -- Compute minutes for this session
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

    -- Record the punch event linked to this session
    INSERT INTO time_punch_events (
      org_id, employee_user_id, employee_profile_id,
      work_date, punch_type, punched_at, source, session_id
    ) VALUES (
      v_org_id, v_uid, v_profile.id,
      v_work_date, p_action, v_now, 'employee_portal', v_session.id
    );

  END IF;

  -- Return full session state so the frontend can update without a round-trip
  RETURN jsonb_build_object(
    'sessionId',       v_session.id,
    'status',          v_session.status,
    'workDate',        v_session.work_date,
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

COMMENT ON FUNCTION public.record_session_punch(TEXT, UUID) IS
  'Job-linked multi-session employee punch. clock_in requires p_assignment_id '
  'and creates a new employee_work_sessions row; other actions resolve the '
  'active session server-side. Prevents overlapping sessions via partial unique '
  'index. Returns authoritative session state JSONB for UI update.';

REVOKE ALL ON FUNCTION public.record_session_punch(TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_session_punch(TEXT, UUID) TO authenticated;

-- ── 8. Extend submit_punch_edit_request with optional p_session_id ────────────
-- Replaces the migration 097 version. The new p_session_id parameter is
-- optional (DEFAULT NULL) so existing callers remain compatible.
-- When p_session_id is provided, punch times are read from the session row
-- rather than from the daily aggregate time_entry.

CREATE OR REPLACE FUNCTION public.submit_punch_edit_request(
  p_time_entry_id   UUID,
  p_punch_type      TEXT,
  p_requested_time  TIMESTAMPTZ,
  p_employee_reason TEXT,
  p_session_id      UUID DEFAULT NULL
)
RETURNS public.time_punch_edit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           UUID;
  v_profile       employee_profiles%ROWTYPE;
  v_entry         time_entries%ROWTYPE;
  v_session       employee_work_sessions%ROWTYPE;
  v_original_time TIMESTAMPTZ;
  v_punch_event   time_punch_events%ROWTYPE;
  v_result        time_punch_edit_requests%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_punch_type NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid punch type: %', p_punch_type;
  END IF;

  IF p_requested_time IS NULL THEN
    RAISE EXCEPTION 'Requested time is required';
  END IF;

  IF trim(p_employee_reason) = '' OR p_employee_reason IS NULL THEN
    RAISE EXCEPTION 'Reason is required';
  END IF;

  SELECT * INTO v_profile
  FROM employee_profiles
  WHERE user_id = v_uid
    AND active = true
    AND (
      portal_access @> '{"time_tracking": true}'::jsonb
      OR portal_access->>'time_tracking' = 'true'
    )
  LIMIT 1;

  IF v_profile.id IS NULL THEN
    RAISE EXCEPTION 'No active employee profile with time tracking access';
  END IF;

  -- Verify the time_entry belongs to this employee
  SELECT * INTO v_entry
  FROM time_entries
  WHERE id = p_time_entry_id
    AND employee_profile_id = v_profile.id;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'Time entry not found or does not belong to this employee';
  END IF;

  -- When a session is specified, verify it belongs to this employee+entry date
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session
    FROM employee_work_sessions
    WHERE id = p_session_id
      AND employee_profile_id = v_profile.id
      AND work_date = v_entry.work_date;

    IF v_session.id IS NULL THEN
      RAISE EXCEPTION 'Work session not found or does not belong to this employee';
    END IF;

    -- Authoritative original time from the session
    v_original_time := CASE p_punch_type
      WHEN 'clock_in'  THEN v_session.clock_in_at
      WHEN 'lunch_out' THEN v_session.lunch_out_at
      WHEN 'lunch_in'  THEN v_session.lunch_in_at
      WHEN 'clock_out' THEN v_session.clock_out_at
    END;
  ELSE
    -- Legacy path: original time from the daily aggregate entry
    v_original_time := CASE p_punch_type
      WHEN 'clock_in'  THEN v_entry.clock_in_at
      WHEN 'lunch_out' THEN v_entry.lunch_out_at
      WHEN 'lunch_in'  THEN v_entry.lunch_in_at
      WHEN 'clock_out' THEN v_entry.clock_out_at
    END;
  END IF;

  -- Reject unchanged requests
  IF v_original_time IS NOT NULL AND v_original_time = p_requested_time THEN
    RAISE EXCEPTION 'Requested time matches the current time; no correction needed';
  END IF;

  -- Block duplicate pending requests for the same punch point within the same session scope
  IF EXISTS (
    SELECT 1
    FROM time_punch_edit_requests
    WHERE employee_profile_id = v_profile.id
      AND time_entry_id = p_time_entry_id
      AND punch_type = p_punch_type
      AND status = 'pending'
      AND (
        (p_session_id IS NULL AND session_id IS NULL)
        OR session_id = p_session_id
      )
  ) THEN
    RAISE EXCEPTION 'A pending request already exists for this punch';
  END IF;

  -- Find matching non-void punch event for the audit trail
  SELECT * INTO v_punch_event
  FROM time_punch_events
  WHERE employee_profile_id = v_profile.id
    AND work_date = v_entry.work_date
    AND punch_type = p_punch_type
    AND is_void = false
    AND (p_session_id IS NULL OR session_id = p_session_id)
  ORDER BY punched_at
  LIMIT 1;

  INSERT INTO time_punch_edit_requests (
    org_id, employee_profile_id, time_entry_id, session_id,
    punch_event_id, punch_type, original_time, requested_time, employee_reason
  ) VALUES (
    v_profile.org_id, v_profile.id, p_time_entry_id, p_session_id,
    v_punch_event.id, p_punch_type, v_original_time, p_requested_time,
    trim(p_employee_reason)
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID) IS
  'Employee submits a punch correction request. Accepts an optional p_session_id '
  'to target a specific session in multi-session days. Captures authoritative '
  'original_time from the session or entry. Blocks duplicates scoped by '
  'session_id when provided.';

REVOKE ALL ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT, UUID)
  TO authenticated;

-- ── 9. Row Level Security for employee_work_sessions ─────────────────────────

ALTER TABLE public.employee_work_sessions ENABLE ROW LEVEL SECURITY;

-- Employee: read only their own sessions
CREATE POLICY ews_employee_select_own ON public.employee_work_sessions
  FOR SELECT
  USING (
    employee_profile_id IN (
      SELECT ep.id FROM public.employee_profiles ep
      WHERE ep.user_id = auth.uid()
        AND ep.active = true
    )
  );

-- Admin/owner: read all sessions in their org
CREATE POLICY ews_owner_admin_select_org ON public.employee_work_sessions
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );

-- Service role: full access (triggers, admin corrections)
CREATE POLICY ews_service_role_all ON public.employee_work_sessions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 10. Function execute grants ───────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.sync_time_entry_from_sessions() FROM PUBLIC;
-- Trigger-only; do not grant EXECUTE to authenticated.

REVOKE ALL ON FUNCTION public.sync_time_entry_from_punches() FROM PUBLIC;
-- Trigger-only; do not grant EXECUTE to authenticated.

-- ── 11. admin_record_session_punch — session-aware admin correction ───────────
-- Replaces admin_record_punch (migration 090) when the target punch is
-- session-linked (time_punch_events.session_id IS NOT NULL).
--
-- What this RPC does:
--   1. Fetches and row-locks the employee_work_sessions row.
--   2. Verifies caller is owner/admin for that org.
--   3. Validates punch type and the new timestamp against existing sequence.
--   4. Updates exactly one of clock_in_at, lunch_out_at, lunch_in_at, clock_out_at.
--   5. Recomputes total/lunch/paid minutes (whenever clock_out_at is present).
--   6. Voids the original punch event (p_supersedes_id, if supplied).
--   7. Inserts a new admin_edit punch event linked to the session.
--   8. The UPDATE on employee_work_sessions fires sync_time_entry_from_sessions,
--      which rebuilds the daily time_entries aggregate automatically.
--
-- Returns the updated session row.

CREATE OR REPLACE FUNCTION public.admin_record_session_punch(
  p_session_id    UUID,
  p_punch_type    TEXT,
  p_punched_at    TIMESTAMPTZ,
  p_supersedes_id UUID    DEFAULT NULL,
  p_notes         TEXT    DEFAULT NULL
)
RETURNS public.employee_work_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session    employee_work_sessions%ROWTYPE;
  v_total_mins INT;
  v_lunch_mins INT;
  v_paid_mins  INT;
  v_emp_user_id UUID;
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

  -- ── 3. Punch type and timestamp validation ──
  IF p_punch_type NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid punch type: %', p_punch_type;
  END IF;

  IF p_punched_at IS NULL THEN
    RAISE EXCEPTION 'Punched_at is required';
  END IF;

  -- Sequence guard: validate new timestamp against existing session boundaries.
  CASE p_punch_type
    WHEN 'clock_in' THEN
      IF v_session.lunch_out_at IS NOT NULL AND p_punched_at >= v_session.lunch_out_at THEN
        RAISE EXCEPTION 'clock_in must be before lunch_out';
      END IF;
      IF v_session.clock_out_at IS NOT NULL AND p_punched_at >= v_session.clock_out_at THEN
        RAISE EXCEPTION 'clock_in must be before clock_out';
      END IF;

    WHEN 'lunch_out' THEN
      IF v_session.clock_in_at IS NOT NULL AND p_punched_at <= v_session.clock_in_at THEN
        RAISE EXCEPTION 'lunch_out must be after clock_in';
      END IF;
      IF v_session.lunch_in_at IS NOT NULL AND p_punched_at >= v_session.lunch_in_at THEN
        RAISE EXCEPTION 'lunch_out must be before lunch_in';
      END IF;
      IF v_session.clock_out_at IS NOT NULL AND p_punched_at >= v_session.clock_out_at THEN
        RAISE EXCEPTION 'lunch_out must be before clock_out';
      END IF;

    WHEN 'lunch_in' THEN
      IF v_session.lunch_out_at IS NULL THEN
        RAISE EXCEPTION 'Cannot set lunch_in: session has no lunch_out';
      END IF;
      IF p_punched_at <= v_session.lunch_out_at THEN
        RAISE EXCEPTION 'lunch_in must be after lunch_out';
      END IF;
      IF v_session.clock_out_at IS NOT NULL AND p_punched_at >= v_session.clock_out_at THEN
        RAISE EXCEPTION 'lunch_in must be before clock_out';
      END IF;

    WHEN 'clock_out' THEN
      IF v_session.clock_in_at IS NULL THEN
        RAISE EXCEPTION 'Cannot set clock_out: session has no clock_in';
      END IF;
      IF p_punched_at <= v_session.clock_in_at THEN
        RAISE EXCEPTION 'clock_out must be after clock_in';
      END IF;
      -- Allow setting clock_out even when lunch is open (admin override) but
      -- not if lunch ended after the proposed clock_out.
      IF v_session.lunch_in_at IS NOT NULL AND p_punched_at <= v_session.lunch_in_at THEN
        RAISE EXCEPTION 'clock_out must be after lunch_in';
      END IF;
  END CASE;

  -- ── 4. Update the session row ──
  CASE p_punch_type
    WHEN 'clock_in' THEN
      UPDATE employee_work_sessions
      SET clock_in_at = p_punched_at, updated_at = now()
      WHERE id = p_session_id
      RETURNING * INTO v_session;

    WHEN 'lunch_out' THEN
      UPDATE employee_work_sessions
      SET lunch_out_at = p_punched_at, updated_at = now()
      WHERE id = p_session_id
      RETURNING * INTO v_session;

    WHEN 'lunch_in' THEN
      UPDATE employee_work_sessions
      SET lunch_in_at = p_punched_at, updated_at = now()
      WHERE id = p_session_id
      RETURNING * INTO v_session;

    WHEN 'clock_out' THEN
      UPDATE employee_work_sessions
      SET clock_out_at = p_punched_at, status = 'complete', updated_at = now()
      WHERE id = p_session_id
      RETURNING * INTO v_session;
  END CASE;

  -- ── 5. Recompute minutes whenever clock_out is present ──
  IF v_session.clock_out_at IS NOT NULL AND v_session.clock_in_at IS NOT NULL THEN
    v_total_mins := GREATEST(0,
      FLOOR(EXTRACT(EPOCH FROM (v_session.clock_out_at - v_session.clock_in_at)) / 60)::INT);

    IF v_session.lunch_out_at IS NOT NULL AND v_session.lunch_in_at IS NOT NULL THEN
      v_lunch_mins := GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (v_session.lunch_in_at - v_session.lunch_out_at)) / 60)::INT);
    ELSE
      v_lunch_mins := 0;
    END IF;

    v_paid_mins := GREATEST(0, v_total_mins - v_lunch_mins);

    UPDATE employee_work_sessions
    SET total_minutes = v_total_mins,
        lunch_minutes = v_lunch_mins,
        paid_minutes  = v_paid_mins
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  END IF;

  -- ── 6. Void the original punch event (if provided) ──
  IF p_supersedes_id IS NOT NULL THEN
    UPDATE public.time_punch_events
    SET is_void = true
    WHERE id = p_supersedes_id
      AND org_id = v_session.org_id;
  END IF;

  -- ── 7. Insert a new admin_edit punch event linked to the session ──
  SELECT ep.user_id INTO v_emp_user_id
  FROM employee_profiles ep
  WHERE ep.id = v_session.employee_profile_id;

  INSERT INTO public.time_punch_events (
    org_id,
    employee_user_id,
    employee_profile_id,
    work_date,
    punch_type,
    punched_at,
    source,
    session_id,
    supersedes_id,
    notes
  ) VALUES (
    v_session.org_id,
    COALESCE(v_emp_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    v_session.employee_profile_id,
    v_session.work_date,
    p_punch_type,
    p_punched_at,
    'admin_edit',
    p_session_id,
    p_supersedes_id,
    p_notes
  );

  -- Step 8 is automatic: the UPDATEs on employee_work_sessions above fire
  -- trg_sync_time_entry_from_sessions, which rebuilds the daily time_entries
  -- aggregate from all sessions for this employee+date.

  RETURN v_session;
END;
$$;

COMMENT ON FUNCTION public.admin_record_session_punch(UUID, TEXT, TIMESTAMPTZ, UUID, TEXT) IS
  'Session-aware admin punch correction. Updates the exact employee_work_sessions '
  'row for the given punch type, validates sequence, recomputes paid/lunch minutes, '
  'voids the original punch event (when p_supersedes_id supplied), writes a new '
  'admin_edit punch event with session_id, and rebuilds the daily time_entries '
  'aggregate via the sync_time_entry_from_sessions trigger. Caller must be '
  'owner/admin for the session org.';

REVOKE ALL ON FUNCTION public.admin_record_session_punch(UUID, TEXT, TIMESTAMPTZ, UUID, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_record_session_punch(UUID, TEXT, TIMESTAMPTZ, UUID, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_record_session_punch(UUID, TEXT, TIMESTAMPTZ, UUID, TEXT)
  TO authenticated;

COMMIT;

-- ── Verification (run manually after apply) ───────────────────────────────────
-- SELECT 'employee_work_sessions exists' AS check WHERE EXISTS (
--   SELECT 1 FROM pg_tables WHERE tablename = 'employee_work_sessions' AND schemaname = 'public'
-- );
-- SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'employee_work_sessions';
-- SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND proname IN (
--     'record_session_punch', 'get_my_eligible_assignments', 'sync_time_entry_from_sessions'
--   );
