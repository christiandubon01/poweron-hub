-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 082: Employee Invite RPCs
-- TIME-2A — Pre-auth validation + authenticated accept for employee_profiles
--
-- DEPENDS ON: 081_employee_time_tracking.sql (employee_profiles, organizations)
--
-- Does NOT use auth.user_org_id() or auth.user_role() — remote DB may lack them.
-- Uses auth.uid(), auth.jwt(), and direct profiles / employee_profiles lookups.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. validate_employee_invite ───────────────────────────────────────────────
-- Safe pre-auth lookup for /employee/invite/:token (no broad anon SELECT policy).

CREATE OR REPLACE FUNCTION public.validate_employee_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     employee_profiles%ROWTYPE;
  v_org_name TEXT;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'missing_token');
  END IF;

  SELECT ep.*
    INTO v_row
    FROM employee_profiles ep
   WHERE ep.invite_token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF v_row.user_id IS NOT NULL OR v_row.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'already_accepted');
  END IF;

  IF v_row.active IS NOT TRUE THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'inactive');
  END IF;

  SELECT o.name
    INTO v_org_name
    FROM organizations o
   WHERE o.id = v_row.org_id;

  RETURN jsonb_build_object(
    'valid',           true,
    'display_name',    v_row.display_name,
    'email',           v_row.email,
    'org_name',        COALESCE(v_org_name, ''),
    'role',            v_row.role,
    'employment_type', v_row.employment_type
  );
END;
$$;

COMMENT ON FUNCTION public.validate_employee_invite(TEXT) IS
  'Pre-auth validation for employee invite links. Returns minimal public fields only.';

REVOKE ALL ON FUNCTION public.validate_employee_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_employee_invite(TEXT) TO anon, authenticated;


-- ── 2. accept_employee_invite ─────────────────────────────────────────────────
-- Authenticated user claims a pending employee_profiles invite by token.

CREATE OR REPLACE FUNCTION public.accept_employee_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       UUID;
  v_jwt_email TEXT;
  v_row       employee_profiles%ROWTYPE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_authenticated');
  END IF;

  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  SELECT ep.*
    INTO v_row
    FROM employee_profiles ep
   WHERE ep.invite_token = p_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_found');
  END IF;

  IF v_row.user_id IS NOT NULL OR v_row.accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_accepted');
  END IF;

  IF v_row.active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inactive');
  END IF;

  v_jwt_email := lower(trim(COALESCE(auth.jwt()->>'email', '')));
  IF v_row.email IS NOT NULL AND v_jwt_email <> '' THEN
    IF lower(trim(v_row.email)) <> v_jwt_email THEN
      RETURN jsonb_build_object('success', false, 'reason', 'email_mismatch');
    END IF;
  END IF;

  UPDATE employee_profiles
     SET user_id      = v_uid,
         accepted_at  = now(),
         invite_token = NULL,
         updated_at   = now()
   WHERE id = v_row.id;

  SELECT ep.*
    INTO v_row
    FROM employee_profiles ep
   WHERE ep.id = v_row.id;

  RETURN jsonb_build_object(
    'success',             true,
    'employee_profile_id', v_row.id,
    'org_id',              v_row.org_id,
    'role',                v_row.role,
    'portal_access',       v_row.portal_access
  );
END;
$$;

COMMENT ON FUNCTION public.accept_employee_invite(TEXT) IS
  'Links auth.uid() to a pending employee_profiles row and clears invite_token.';

REVOKE ALL ON FUNCTION public.accept_employee_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_employee_invite(TEXT) TO authenticated;

COMMIT;
