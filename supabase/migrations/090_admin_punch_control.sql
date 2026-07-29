-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 090: Admin Punch Control RPCs
-- ADMIN-TIMESHEET-1 — Full admin punch write access + approval workflow
--
-- DEPENDS ON: 081 (time_punch_events, time_entries, is_org_admin_for)
--
-- Adds three SECURITY DEFINER RPCs callable by authenticated owner/admin:
--   admin_record_punch          — insert a punch (or correct an existing one)
--   admin_void_punch            — void an existing punch by id
--   admin_update_approval_status — approve/reject a time_entries row
--
-- All admin writes set source = 'admin_edit' so they are distinguishable
-- from employee punches in the audit trail. The existing
-- sync_time_entry_from_punches trigger (migration 081) fires on every
-- INSERT and on UPDATE OF is_void, rebuilding time_entries from non-void
-- punches automatically — no changes to the trigger are needed.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. admin_record_punch ─────────────────────────────────────────────────────
-- Inserts a new punch on behalf of an employee. When p_supersedes_id is
-- supplied the original punch is voided first (which triggers a
-- time_entries rebuild), then the correction is inserted (second rebuild).
-- The caller must be owner/admin for the employee's org.

CREATE OR REPLACE FUNCTION public.admin_record_punch(
  p_employee_profile_id uuid,
  p_punch_type          text,
  p_punched_at          timestamptz,
  p_work_date           date,
  p_notes               text    DEFAULT NULL,
  p_supersedes_id       uuid    DEFAULT NULL
)
RETURNS public.time_punch_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp    employee_profiles%ROWTYPE;
  v_result time_punch_events%ROWTYPE;
BEGIN
  SELECT * INTO v_emp
  FROM employee_profiles
  WHERE id = p_employee_profile_id;

  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF NOT public.is_org_admin_for(v_emp.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_punch_type NOT IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out') THEN
    RAISE EXCEPTION 'Invalid punch type: %', p_punch_type;
  END IF;

  -- Void the original punch before inserting the correction.
  IF p_supersedes_id IS NOT NULL THEN
    UPDATE public.time_punch_events
    SET is_void = true
    WHERE id = p_supersedes_id
      AND org_id = v_emp.org_id;
  END IF;

  INSERT INTO public.time_punch_events (
    org_id,
    employee_user_id,
    employee_profile_id,
    work_date,
    punch_type,
    punched_at,
    source,
    supersedes_id,
    notes
  ) VALUES (
    v_emp.org_id,
    COALESCE(v_emp.user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    p_employee_profile_id,
    p_work_date,
    p_punch_type,
    p_punched_at,
    'admin_edit',
    p_supersedes_id,
    p_notes
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.admin_record_punch(uuid, text, timestamptz, date, text, uuid) IS
  'Admin inserts or corrects a punch. source=admin_edit is stamped automatically. '
  'When p_supersedes_id is set the original is voided before the correction is written. '
  'Caller must be owner/admin for the employee org.';

REVOKE ALL ON FUNCTION public.admin_record_punch(uuid, text, timestamptz, date, text, uuid)
  FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_record_punch(uuid, text, timestamptz, date, text, uuid)
  TO authenticated;

-- ── 2. admin_void_punch ───────────────────────────────────────────────────────
-- Sets is_void = true on an existing punch. The sync trigger fires and
-- rebuilds the time_entries row without that punch.

CREATE OR REPLACE FUNCTION public.admin_void_punch(p_punch_id uuid)
RETURNS public.time_punch_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_punch time_punch_events%ROWTYPE;
BEGIN
  SELECT * INTO v_punch
  FROM public.time_punch_events
  WHERE id = p_punch_id;

  IF v_punch.id IS NULL THEN
    RAISE EXCEPTION 'Punch not found';
  END IF;

  IF NOT public.is_org_admin_for(v_punch.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.time_punch_events
  SET is_void = true
  WHERE id = p_punch_id
  RETURNING * INTO v_punch;

  RETURN v_punch;
END;
$$;

COMMENT ON FUNCTION public.admin_void_punch(uuid) IS
  'Voids a punch by id. Caller must be owner/admin for the punch org. '
  'The sync trigger rebuilds time_entries automatically.';

REVOKE ALL ON FUNCTION public.admin_void_punch(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_void_punch(uuid) TO authenticated;

-- ── 3. admin_update_approval_status ──────────────────────────────────────────
-- Updates time_entries.approval_status. There is no admin UPDATE policy on
-- time_entries (only SELECT) so this SECURITY DEFINER function bypasses RLS.

CREATE OR REPLACE FUNCTION public.admin_update_approval_status(
  p_time_entry_id   uuid,
  p_approval_status text
)
RETURNS public.time_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry time_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_entry
  FROM public.time_entries
  WHERE id = p_time_entry_id;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'Time entry not found';
  END IF;

  IF NOT public.is_org_admin_for(v_entry.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_approval_status NOT IN ('none', 'pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid approval status: %', p_approval_status;
  END IF;

  UPDATE public.time_entries
  SET approval_status = p_approval_status,
      updated_at      = now()
  WHERE id = p_time_entry_id
  RETURNING * INTO v_entry;

  RETURN v_entry;
END;
$$;

COMMENT ON FUNCTION public.admin_update_approval_status(uuid, text) IS
  'Owner/admin updates approval_status on a time_entries row. '
  'Valid values: none, pending, approved, rejected.';

REVOKE ALL ON FUNCTION public.admin_update_approval_status(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_update_approval_status(uuid, text) TO authenticated;

COMMIT;
