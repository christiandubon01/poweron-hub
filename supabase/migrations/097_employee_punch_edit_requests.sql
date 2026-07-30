-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 097: Employee Punch Edit Requests
-- EMPLOYEE-MY-TIME-WEEK-1 — Employee-submitted punch correction requests
--
-- DEPENDS ON: 081 (time_punch_events, time_entries, employee_profiles,
--                  is_org_admin_for, moddatetime),
--             090 (admin_record_punch — used by admin to apply approved corrections)
--
-- Adds:
--   time_punch_edit_requests  — immutable request record (one per punch per day)
--   submit_punch_edit_request — employee RPC; captures server-side original_time
--   admin_review_punch_edit_request — admin approve/reject (does NOT auto-apply)
--
-- Approval does NOT auto-rewrite the punch. The admin reviews the request in
-- AdminPunchHistoryModal and calls admin_record_punch (migration 090) to apply it,
-- then calls admin_review_punch_edit_request to mark the request resolved.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.time_punch_edit_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  time_entry_id       UUID NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  punch_event_id      UUID REFERENCES public.time_punch_events(id) ON DELETE SET NULL,
  punch_type          TEXT NOT NULL
                        CHECK (punch_type IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out')),
  original_time       TIMESTAMPTZ,
  requested_time      TIMESTAMPTZ NOT NULL,
  employee_reason     TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.time_punch_edit_requests IS
  'Employee punch correction requests. Created via submit_punch_edit_request RPC. '
  'Reviewed by admin in AdminPunchHistoryModal. Approval requires a separate '
  'admin_record_punch call (migration 090) to apply the actual correction.';

COMMENT ON COLUMN public.time_punch_edit_requests.original_time IS
  'Authoritative value captured server-side at submission time. NULL for missing punch requests.';

COMMENT ON COLUMN public.time_punch_edit_requests.punch_event_id IS
  'Optional reference to the source punch event for audit trail.';

CREATE INDEX IF NOT EXISTS idx_tper_org_status
  ON public.time_punch_edit_requests (org_id, status);

CREATE INDEX IF NOT EXISTS idx_tper_profile_status
  ON public.time_punch_edit_requests (employee_profile_id, status);

CREATE INDEX IF NOT EXISTS idx_tper_time_entry
  ON public.time_punch_edit_requests (time_entry_id);

CREATE TRIGGER mdt_time_punch_edit_requests
  BEFORE UPDATE ON public.time_punch_edit_requests
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- ── 2. submit_punch_edit_request ──────────────────────────────────────────────
-- Employee-only RPC. Captures authoritative original_time from the server.
-- Never trusts a browser-supplied current value.

CREATE OR REPLACE FUNCTION public.submit_punch_edit_request(
  p_time_entry_id   UUID,
  p_punch_type      TEXT,
  p_requested_time  TIMESTAMPTZ,
  p_employee_reason TEXT
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

  -- Active employee profile with time tracking
  SELECT *
  INTO v_profile
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

  -- Verify the time entry belongs to this employee
  SELECT *
  INTO v_entry
  FROM time_entries
  WHERE id = p_time_entry_id
    AND employee_profile_id = v_profile.id;

  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'Time entry not found or does not belong to this employee';
  END IF;

  -- Authoritative original time from the server (not from the browser)
  v_original_time := CASE p_punch_type
    WHEN 'clock_in'  THEN v_entry.clock_in_at
    WHEN 'lunch_out' THEN v_entry.lunch_out_at
    WHEN 'lunch_in'  THEN v_entry.lunch_in_at
    WHEN 'clock_out' THEN v_entry.clock_out_at
  END;

  -- Reject unchanged requests
  IF v_original_time IS NOT NULL AND v_original_time = p_requested_time THEN
    RAISE EXCEPTION 'Requested time matches the current time; no correction needed';
  END IF;

  -- Block duplicate pending requests for the same punch point
  IF EXISTS (
    SELECT 1
    FROM time_punch_edit_requests
    WHERE employee_profile_id = v_profile.id
      AND time_entry_id = p_time_entry_id
      AND punch_type = p_punch_type
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A pending request already exists for this punch';
  END IF;

  -- Find the matching non-void punch event for the audit trail (optional)
  SELECT *
  INTO v_punch_event
  FROM time_punch_events
  WHERE employee_profile_id = v_profile.id
    AND work_date = v_entry.work_date
    AND punch_type = p_punch_type
    AND is_void = false
  ORDER BY punched_at
  LIMIT 1;

  INSERT INTO time_punch_edit_requests (
    org_id,
    employee_profile_id,
    time_entry_id,
    punch_event_id,
    punch_type,
    original_time,
    requested_time,
    employee_reason
  ) VALUES (
    v_profile.org_id,
    v_profile.id,
    p_time_entry_id,
    v_punch_event.id,
    p_punch_type,
    v_original_time,
    p_requested_time,
    trim(p_employee_reason)
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT) IS
  'Employee submits a punch correction request. Captures authoritative original_time '
  'from the server. Blocks duplicates for the same punch_type + time_entry_id.';

REVOKE ALL ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_punch_edit_request(UUID, TEXT, TIMESTAMPTZ, TEXT)
  TO authenticated;

-- ── 3. admin_review_punch_edit_request ───────────────────────────────────────
-- Admin marks a pending request approved or rejected. Does NOT apply the
-- correction — admin must separately call admin_record_punch (migration 090).

CREATE OR REPLACE FUNCTION public.admin_review_punch_edit_request(
  p_request_id UUID,
  p_status     TEXT
)
RETURNS public.time_punch_edit_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request time_punch_edit_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM time_punch_edit_requests
  WHERE id = p_request_id;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF NOT public.is_org_admin_for(v_request.org_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid status: must be approved or rejected';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending requests can be reviewed';
  END IF;

  UPDATE time_punch_edit_requests
  SET status      = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at  = now()
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  RETURN v_request;
END;
$$;

COMMENT ON FUNCTION public.admin_review_punch_edit_request(UUID, TEXT) IS
  'Admin approves or rejects a pending punch edit request. Does NOT auto-apply '
  'the correction — admin must still call admin_record_punch (migration 090).';

REVOKE ALL ON FUNCTION public.admin_review_punch_edit_request(UUID, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_review_punch_edit_request(UUID, TEXT)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_review_punch_edit_request(UUID, TEXT)
  TO authenticated;

-- ── 4. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.time_punch_edit_requests ENABLE ROW LEVEL SECURITY;

-- Employee: read only their own requests
CREATE POLICY tper_employee_select_own ON public.time_punch_edit_requests
  FOR SELECT
  USING (
    employee_profile_id IN (
      SELECT id FROM public.employee_profiles
      WHERE user_id = auth.uid()
    )
  );

-- Admin/owner: read all requests in their org
CREATE POLICY tper_owner_admin_select_org ON public.time_punch_edit_requests
  FOR SELECT
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );

-- Service role: full access
CREATE POLICY tper_service_role_all ON public.time_punch_edit_requests
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMIT;
