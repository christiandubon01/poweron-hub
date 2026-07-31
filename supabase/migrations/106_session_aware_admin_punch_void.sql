-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 106: Session-Aware Admin Punch Void
-- ADMIN-SESSION-PUNCH-VOID-1
--
-- DEPENDS ON: 090 (admin_void_punch), 099 (employee_work_sessions,
--                  sync_time_entry_from_sessions / sync_time_entry_from_punches)
--
-- Replaces public.admin_void_punch(UUID) in place (no overload):
--   • Legacy punches (session_id IS NULL): void event; punch sync rebuilds
--     time_entries (unchanged migration-090 behavior).
--   • Session-linked punches: lock punch + session, void the event, rebuild
--     employee_work_sessions from remaining non-void events; delete the session
--     when no Clock In remains; rebuild/remove the daily time_entries aggregate.
--
-- Active-session protection: voiding the last Clock Out reopens the session
-- only when no other open session exists for the employee; otherwise the
-- transaction fails without voiding the event.
--
-- One-time reconciliation (runs once on apply):
--   Cleans pre-existing ghost / stale sessions created when admin_void_punch
--   voided events without updating employee_work_sessions (pre-106).
--   • Sessions with no non-void session events are deleted.
--   • Partially voided sessions are rebuilt from remaining non-void events
--     using the same authoritative rules, skipping unsafe reopens that would
--     violate one-active-session protection.
--   • time_entries are rebuilt/removed for every affected employee+date.
--   • Voided time_punch_events are preserved (FK ON DELETE SET NULL).
--   • No hardcoded employee, session, assignment, or project IDs.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_void_punch(p_punch_id uuid)
RETURNS public.time_punch_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_punch              public.time_punch_events%ROWTYPE;
  v_session            public.employee_work_sessions%ROWTYPE;
  v_clock_in           TIMESTAMPTZ;
  v_lunch_out          TIMESTAMPTZ;
  v_lunch_in           TIMESTAMPTZ;
  v_clock_out          TIMESTAMPTZ;
  v_total_mins         INT;
  v_lunch_mins         INT;
  v_paid_mins          INT;
  v_status             TEXT;
  v_profile_id         UUID;
  v_work_date          DATE;
  v_org_id             UUID;
  v_emp_user_id        UUID;
  v_paid_minutes       INT;
  v_lunch_minutes      INT;
  v_total_minutes      INT;
  v_first_clock_in     TIMESTAMPTZ;
  v_last_clock_out     TIMESTAMPTZ;
  v_open_count         INT;
  v_session_count      INT;
  v_entry_status       TEXT;
  v_legacy_clock_in    TIMESTAMPTZ;
  v_legacy_lunch_out   TIMESTAMPTZ;
  v_legacy_lunch_in    TIMESTAMPTZ;
  v_legacy_clock_out   TIMESTAMPTZ;
BEGIN
  -- ── 1. Lock the punch row ──
  SELECT * INTO v_punch
  FROM public.time_punch_events
  WHERE id = p_punch_id
  FOR UPDATE;

  IF v_punch.id IS NULL THEN
    RAISE EXCEPTION 'Punch not found';
  END IF;

  IF NOT public.is_org_admin_for(v_punch.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Idempotent: already voided
  IF v_punch.is_void THEN
    RETURN v_punch;
  END IF;

  -- ── 2. Legacy path (no session): preserve migration-090 behavior ──
  IF v_punch.session_id IS NULL THEN
    UPDATE public.time_punch_events
    SET is_void = true
    WHERE id = p_punch_id
    RETURNING * INTO v_punch;

    RETURN v_punch;
  END IF;

  -- ── 3. Session-linked path: lock the session ──
  SELECT * INTO v_session
  FROM public.employee_work_sessions
  WHERE id = v_punch.session_id
  FOR UPDATE;

  IF v_session.id IS NULL THEN
    -- Orphaned session_id: void the event only (audit preserved).
    UPDATE public.time_punch_events
    SET is_void = true
    WHERE id = p_punch_id
    RETURNING * INTO v_punch;
    RETURN v_punch;
  END IF;

  -- ── 4. Clock Out reopen safety (before any mutation) ──
  -- If this void removes the last live Clock Out, the session would reopen.
  -- Reject when another active session already exists for the employee.
  IF v_punch.punch_type = 'clock_out'
     AND NOT EXISTS (
       SELECT 1
       FROM public.time_punch_events tpe
       WHERE tpe.session_id = v_session.id
         AND tpe.punch_type = 'clock_out'
         AND tpe.is_void = false
         AND tpe.id <> v_punch.id
     )
     AND EXISTS (
       SELECT 1
       FROM public.employee_work_sessions ews
       WHERE ews.employee_profile_id = v_session.employee_profile_id
         AND ews.id <> v_session.id
         AND ews.clock_out_at IS NULL
     )
  THEN
    RAISE EXCEPTION 'Cannot void clock_out: another active session exists';
  END IF;

  -- ── 5. Void the event (audit row retained) ──
  UPDATE public.time_punch_events
  SET is_void = true
  WHERE id = p_punch_id
  RETURNING * INTO v_punch;

  -- ── 6. Rebuild timestamps from remaining non-void events ──
  SELECT
    MIN(CASE WHEN tpe.punch_type = 'clock_in'  THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'lunch_out' THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'lunch_in'  THEN tpe.punched_at END),
    MIN(CASE WHEN tpe.punch_type = 'clock_out' THEN tpe.punched_at END)
  INTO v_clock_in, v_lunch_out, v_lunch_in, v_clock_out
  FROM public.time_punch_events tpe
  WHERE tpe.session_id = v_session.id
    AND tpe.is_void = false;

  -- No Clock In → delete the session and rebuild daily aggregate
  IF v_clock_in IS NULL THEN
    v_profile_id := v_session.employee_profile_id;
    v_work_date  := v_session.work_date;

    DELETE FROM public.employee_work_sessions
    WHERE id = v_session.id;

    -- Rebuild time_entries (DELETE does not fire trg_sync_time_entry_from_sessions)
    SELECT ep.org_id, ep.user_id
    INTO v_org_id, v_emp_user_id
    FROM public.employee_profiles ep
    WHERE ep.id = v_profile_id;

    IF v_org_id IS NOT NULL THEN
      SELECT
        COUNT(*) FILTER (WHERE clock_in_at IS NOT NULL),
        COUNT(*) FILTER (WHERE clock_out_at IS NULL AND clock_in_at IS NOT NULL),
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
      FROM public.employee_work_sessions
      WHERE employee_profile_id = v_profile_id
        AND work_date = v_work_date;

      IF v_session_count = 0 OR v_first_clock_in IS NULL THEN
        -- No sessions left: fall back to punch-based aggregate (legacy path),
        -- matching sync_time_entry_from_punches when sessions are absent.
        SELECT
          MIN(CASE WHEN tpe.punch_type = 'clock_in'  THEN tpe.punched_at END),
          MIN(CASE WHEN tpe.punch_type = 'lunch_out' THEN tpe.punched_at END),
          MIN(CASE WHEN tpe.punch_type = 'lunch_in'  THEN tpe.punched_at END),
          MIN(CASE WHEN tpe.punch_type = 'clock_out' THEN tpe.punched_at END)
        INTO v_legacy_clock_in, v_legacy_lunch_out, v_legacy_lunch_in, v_legacy_clock_out
        FROM public.time_punch_events tpe
        WHERE tpe.employee_profile_id = v_profile_id
          AND tpe.work_date = v_work_date
          AND tpe.is_void = false;

        IF v_legacy_clock_in IS NULL THEN
          DELETE FROM public.time_entries
          WHERE org_id = v_org_id
            AND employee_user_id = v_emp_user_id
            AND work_date = v_work_date;
        ELSE
          IF v_legacy_clock_out IS NOT NULL THEN
            v_total_mins := GREATEST(0,
              FLOOR(EXTRACT(EPOCH FROM (v_legacy_clock_out - v_legacy_clock_in)) / 60)::INT);
          ELSE
            v_total_mins := NULL;
          END IF;

          IF v_legacy_lunch_out IS NOT NULL AND v_legacy_lunch_in IS NOT NULL THEN
            v_lunch_mins := GREATEST(0,
              FLOOR(EXTRACT(EPOCH FROM (v_legacy_lunch_in - v_legacy_lunch_out)) / 60)::INT);
          ELSE
            v_lunch_mins := 0;
          END IF;

          v_paid_mins := CASE WHEN v_total_mins IS NOT NULL
            THEN GREATEST(v_total_mins - v_lunch_mins, 0)
            ELSE NULL
          END;

          v_entry_status := CASE WHEN v_legacy_clock_out IS NULL THEN 'open' ELSE 'complete' END;

          INSERT INTO public.time_entries (
            org_id, employee_user_id, employee_profile_id, work_date,
            clock_in_at, lunch_out_at, lunch_in_at, clock_out_at,
            total_minutes, lunch_minutes, paid_minutes, status
          )
          VALUES (
            v_org_id, v_emp_user_id, v_profile_id, v_work_date,
            v_legacy_clock_in, v_legacy_lunch_out, v_legacy_lunch_in, v_legacy_clock_out,
            v_total_mins, v_lunch_mins, v_paid_mins, v_entry_status
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
        END IF;
      ELSE
        v_entry_status := CASE WHEN v_open_count > 0 THEN 'open' ELSE 'complete' END;

        INSERT INTO public.time_entries (
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
          v_entry_status
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
      END IF;
    END IF;

    RETURN v_punch;
  END IF;

  -- Incomplete lunch pair → clear both lunch timestamps
  IF v_lunch_out IS NULL OR v_lunch_in IS NULL THEN
    v_lunch_out := NULL;
    v_lunch_in  := NULL;
    v_lunch_mins := 0;
  ELSE
    v_lunch_mins := GREATEST(0,
      FLOOR(EXTRACT(EPOCH FROM (v_lunch_in - v_lunch_out)) / 60)::INT);
  END IF;

  IF v_clock_out IS NOT NULL THEN
    v_total_mins := GREATEST(0,
      FLOOR(EXTRACT(EPOCH FROM (v_clock_out - v_clock_in)) / 60)::INT);
    v_paid_mins  := GREATEST(0, v_total_mins - v_lunch_mins);
    v_status     := 'complete';
  ELSE
    -- Reopen: Clock Out voided and no other live clock_out remains
    v_total_mins := NULL;
    v_paid_mins  := NULL;
    v_status     := 'open';
  END IF;

  UPDATE public.employee_work_sessions
  SET
    clock_in_at   = v_clock_in,
    lunch_out_at  = v_lunch_out,
    lunch_in_at   = v_lunch_in,
    clock_out_at  = v_clock_out,
    total_minutes = v_total_mins,
    lunch_minutes = v_lunch_mins,
    paid_minutes  = v_paid_mins,
    status        = v_status,
    updated_at    = now()
  WHERE id = v_session.id;

  -- trg_sync_time_entry_from_sessions fires on the UPDATE above and rebuilds
  -- the daily time_entries aggregate from all sessions for this employee+date.

  RETURN v_punch;
END;
$$;

COMMENT ON FUNCTION public.admin_void_punch(uuid) IS
  'Voids a punch by id. Legacy (session_id NULL) voids the event and lets the '
  'punch sync rebuild time_entries. Session-linked voids rebuild or delete the '
  'employee_work_sessions row from remaining non-void events and sync the daily '
  'aggregate. Clock Out void that would reopen is rejected when another active '
  'session exists. Caller must be owner/admin for the punch org.';

REVOKE ALL ON FUNCTION public.admin_void_punch(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_void_punch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_void_punch(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
-- One-time reconciliation: remove ghost sessions / rebuild partially voided
-- sessions created before session-aware void. Runs on migration apply only —
-- no admin click required. No hardcoded employee/session/project IDs.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_sess               public.employee_work_sessions%ROWTYPE;
  v_clock_in           TIMESTAMPTZ;
  v_lunch_out          TIMESTAMPTZ;
  v_lunch_in           TIMESTAMPTZ;
  v_clock_out          TIMESTAMPTZ;
  v_total_mins         INT;
  v_lunch_mins         INT;
  v_paid_mins          INT;
  v_status             TEXT;
  v_would_reopen       BOOLEAN;
  v_needs_rebuild      BOOLEAN;
  v_mutated            BOOLEAN;
  v_day                RECORD;
  v_org_id             UUID;
  v_emp_user_id        UUID;
  v_paid_minutes       INT;
  v_lunch_minutes      INT;
  v_total_minutes      INT;
  v_first_clock_in     TIMESTAMPTZ;
  v_last_clock_out     TIMESTAMPTZ;
  v_open_count         INT;
  v_session_count      INT;
  v_entry_status       TEXT;
  v_legacy_clock_in    TIMESTAMPTZ;
  v_legacy_lunch_out   TIMESTAMPTZ;
  v_legacy_lunch_in    TIMESTAMPTZ;
  v_legacy_clock_out   TIMESTAMPTZ;
BEGIN
  CREATE TEMP TABLE mig106_affected_days (
    employee_profile_id UUID NOT NULL,
    work_date           DATE NOT NULL,
    PRIMARY KEY (employee_profile_id, work_date)
  ) ON COMMIT DROP;

  FOR v_sess IN
    SELECT ews.*
    FROM public.employee_work_sessions ews
    WHERE
      -- Ghost: no remaining non-void session-linked events
      NOT EXISTS (
        SELECT 1
        FROM public.time_punch_events tpe
        WHERE tpe.session_id = ews.id
          AND tpe.is_void = false
      )
      OR
      -- Partially voided: at least one voided session event remains as audit
      EXISTS (
        SELECT 1
        FROM public.time_punch_events tpe
        WHERE tpe.session_id = ews.id
          AND tpe.is_void = true
      )
    ORDER BY ews.employee_profile_id, ews.work_date, ews.created_at
    FOR UPDATE
  LOOP
    v_mutated := false;

    SELECT
      MIN(CASE WHEN tpe.punch_type = 'clock_in'  THEN tpe.punched_at END),
      MIN(CASE WHEN tpe.punch_type = 'lunch_out' THEN tpe.punched_at END),
      MIN(CASE WHEN tpe.punch_type = 'lunch_in'  THEN tpe.punched_at END),
      MIN(CASE WHEN tpe.punch_type = 'clock_out' THEN tpe.punched_at END)
    INTO v_clock_in, v_lunch_out, v_lunch_in, v_clock_out
    FROM public.time_punch_events tpe
    WHERE tpe.session_id = v_sess.id
      AND tpe.is_void = false;

    -- No non-void Clock In → delete ghost / invalidated session
    IF v_clock_in IS NULL THEN
      DELETE FROM public.employee_work_sessions
      WHERE id = v_sess.id;
      -- Voided audit events retained; session_id set NULL via FK ON DELETE SET NULL.
      INSERT INTO mig106_affected_days (employee_profile_id, work_date)
      VALUES (v_sess.employee_profile_id, v_sess.work_date)
      ON CONFLICT DO NOTHING;
      CONTINUE;
    END IF;

    -- Incomplete lunch pair → clear both
    IF v_lunch_out IS NULL OR v_lunch_in IS NULL THEN
      v_lunch_out := NULL;
      v_lunch_in  := NULL;
      v_lunch_mins := 0;
    ELSE
      v_lunch_mins := GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (v_lunch_in - v_lunch_out)) / 60)::INT);
    END IF;

    IF v_clock_out IS NOT NULL THEN
      v_total_mins := GREATEST(0,
        FLOOR(EXTRACT(EPOCH FROM (v_clock_out - v_clock_in)) / 60)::INT);
      v_paid_mins  := GREATEST(0, v_total_mins - v_lunch_mins);
      v_status     := 'complete';
      v_would_reopen := false;
    ELSE
      v_total_mins := NULL;
      v_paid_mins  := NULL;
      v_status     := 'open';
      v_would_reopen := (v_sess.clock_out_at IS NOT NULL);
    END IF;

    -- Unsafe reopen: would clear clock_out while another active session exists.
    -- Skip rather than fail the migration or violate one-active-session index.
    IF v_would_reopen
       AND EXISTS (
         SELECT 1
         FROM public.employee_work_sessions ews
         WHERE ews.employee_profile_id = v_sess.employee_profile_id
           AND ews.id <> v_sess.id
           AND ews.clock_out_at IS NULL
       )
    THEN
      CONTINUE;
    END IF;

    v_needs_rebuild :=
         v_sess.clock_in_at  IS DISTINCT FROM v_clock_in
      OR v_sess.lunch_out_at IS DISTINCT FROM v_lunch_out
      OR v_sess.lunch_in_at  IS DISTINCT FROM v_lunch_in
      OR v_sess.clock_out_at IS DISTINCT FROM v_clock_out
      OR v_sess.total_minutes IS DISTINCT FROM v_total_mins
      OR v_sess.lunch_minutes IS DISTINCT FROM v_lunch_mins
      OR v_sess.paid_minutes  IS DISTINCT FROM v_paid_mins
      OR v_sess.status IS DISTINCT FROM v_status;

    IF NOT v_needs_rebuild THEN
      CONTINUE;
    END IF;

    UPDATE public.employee_work_sessions
    SET
      clock_in_at   = v_clock_in,
      lunch_out_at  = v_lunch_out,
      lunch_in_at   = v_lunch_in,
      clock_out_at  = v_clock_out,
      total_minutes = v_total_mins,
      lunch_minutes = v_lunch_mins,
      paid_minutes  = v_paid_mins,
      status        = v_status,
      updated_at    = now()
    WHERE id = v_sess.id;

    INSERT INTO mig106_affected_days (employee_profile_id, work_date)
    VALUES (v_sess.employee_profile_id, v_sess.work_date)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Rebuild or remove daily time_entries for every touched employee+date.
  -- Session DELETE does not fire trg_sync_time_entry_from_sessions; UPDATE does,
  -- but we still rebuild explicitly so delete-only days are corrected.
  FOR v_day IN
    SELECT employee_profile_id, work_date
    FROM mig106_affected_days
    ORDER BY employee_profile_id, work_date
  LOOP
    SELECT ep.org_id, ep.user_id
    INTO v_org_id, v_emp_user_id
    FROM public.employee_profiles ep
    WHERE ep.id = v_day.employee_profile_id;

    IF v_org_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      COUNT(*) FILTER (WHERE clock_in_at IS NOT NULL),
      COUNT(*) FILTER (WHERE clock_out_at IS NULL AND clock_in_at IS NOT NULL),
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
    FROM public.employee_work_sessions
    WHERE employee_profile_id = v_day.employee_profile_id
      AND work_date = v_day.work_date;

    IF v_session_count = 0 OR v_first_clock_in IS NULL THEN
      SELECT
        MIN(CASE WHEN tpe.punch_type = 'clock_in'  THEN tpe.punched_at END),
        MIN(CASE WHEN tpe.punch_type = 'lunch_out' THEN tpe.punched_at END),
        MIN(CASE WHEN tpe.punch_type = 'lunch_in'  THEN tpe.punched_at END),
        MIN(CASE WHEN tpe.punch_type = 'clock_out' THEN tpe.punched_at END)
      INTO v_legacy_clock_in, v_legacy_lunch_out, v_legacy_lunch_in, v_legacy_clock_out
      FROM public.time_punch_events tpe
      WHERE tpe.employee_profile_id = v_day.employee_profile_id
        AND tpe.work_date = v_day.work_date
        AND tpe.is_void = false;

      IF v_legacy_clock_in IS NULL THEN
        DELETE FROM public.time_entries
        WHERE org_id = v_org_id
          AND employee_user_id = v_emp_user_id
          AND work_date = v_day.work_date;
      ELSE
        IF v_legacy_clock_out IS NOT NULL THEN
          v_total_mins := GREATEST(0,
            FLOOR(EXTRACT(EPOCH FROM (v_legacy_clock_out - v_legacy_clock_in)) / 60)::INT);
        ELSE
          v_total_mins := NULL;
        END IF;

        IF v_legacy_lunch_out IS NOT NULL AND v_legacy_lunch_in IS NOT NULL THEN
          v_lunch_mins := GREATEST(0,
            FLOOR(EXTRACT(EPOCH FROM (v_legacy_lunch_in - v_legacy_lunch_out)) / 60)::INT);
        ELSE
          v_lunch_mins := 0;
        END IF;

        v_paid_mins := CASE WHEN v_total_mins IS NOT NULL
          THEN GREATEST(v_total_mins - v_lunch_mins, 0)
          ELSE NULL
        END;

        v_entry_status := CASE WHEN v_legacy_clock_out IS NULL THEN 'open' ELSE 'complete' END;

        INSERT INTO public.time_entries (
          org_id, employee_user_id, employee_profile_id, work_date,
          clock_in_at, lunch_out_at, lunch_in_at, clock_out_at,
          total_minutes, lunch_minutes, paid_minutes, status
        )
        VALUES (
          v_org_id, v_emp_user_id, v_day.employee_profile_id, v_day.work_date,
          v_legacy_clock_in, v_legacy_lunch_out, v_legacy_lunch_in, v_legacy_clock_out,
          v_total_mins, v_lunch_mins, v_paid_mins, v_entry_status
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
      END IF;
    ELSE
      v_entry_status := CASE WHEN v_open_count > 0 THEN 'open' ELSE 'complete' END;

      INSERT INTO public.time_entries (
        org_id, employee_user_id, employee_profile_id, work_date,
        clock_in_at, lunch_out_at, lunch_in_at, clock_out_at,
        total_minutes, lunch_minutes, paid_minutes, status
      )
      VALUES (
        v_org_id, v_emp_user_id, v_day.employee_profile_id, v_day.work_date,
        v_first_clock_in, NULL, NULL, v_last_clock_out,
        CASE WHEN v_open_count = 0 THEN v_total_minutes ELSE NULL END,
        v_lunch_minutes,
        CASE WHEN v_open_count = 0 THEN v_paid_minutes ELSE NULL END,
        v_entry_status
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
    END IF;
  END LOOP;
END;
$$;

COMMIT;
