BEGIN;

-- GUARDIAN-3B3E2: Inactive-user RLS authorization boundary
--
-- Problem: user_org_id(), user_role(), and is_org_admin_for() did not check
-- is_active, so an authenticated user with a valid JWT but profiles.is_active=false
-- could still pass org-scoped RLS policies on 25+ tables.
--
-- Fix: Add AND is_active = true to all three SECURITY DEFINER helpers.
-- Active users are unaffected (their is_active is always true).
-- Inactive users resolve to NULL org / NULL role / false admin — every
-- dependent RLS policy then evaluates to no rows / no permission.
--
-- Does NOT modify: is_active values, organizations, projects, memberships,
-- agreements, NDA records, auth.users, user_sessions, security events, telemetry.
-- Pattern-B inline subquery policies (~25 older tables) are out of scope;
-- they do not use a named helper and require separate policy-level changes.

CREATE OR REPLACE FUNCTION public.user_org_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.user_role()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT role FROM profiles WHERE id = auth.uid() AND is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin_for(p_org_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE id = auth.uid()
      AND org_id = p_org_id
      AND role IN ('owner', 'admin')
      AND is_active = true
  );
$$;

-- ── Postcondition assertions ────────────────────────────────────────────────

DO $$
DECLARE
  v_def text;
BEGIN

  -- 1. user_org_id exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'user_org_id'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: user_org_id not found';
  END IF;

  -- 2. user_org_id checks is_active
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'user_org_id';

  IF v_def NOT LIKE '%is_active = true%' AND v_def NOT LIKE '%is_active=true%' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: user_org_id does not check is_active';
  END IF;

  -- 3. user_role exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'user_role'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: user_role not found';
  END IF;

  -- 4. user_role checks is_active
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'user_role';

  IF v_def NOT LIKE '%is_active = true%' AND v_def NOT LIKE '%is_active=true%' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: user_role does not check is_active';
  END IF;

  -- 5. is_org_admin_for exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_org_admin_for'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: is_org_admin_for not found';
  END IF;

  -- 6. is_org_admin_for checks is_active
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_org_admin_for';

  IF v_def NOT LIKE '%is_active = true%' AND v_def NOT LIKE '%is_active=true%' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: is_org_admin_for does not check is_active';
  END IF;

  -- 7. All three functions remain SECURITY DEFINER
  IF (
    SELECT COUNT(*) FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('user_org_id', 'user_role', 'is_org_admin_for')
      AND p.prosecdef = true
  ) < 3 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: one or more helpers lost SECURITY DEFINER';
  END IF;

  -- 8. profiles.is_active still exists and is boolean NOT NULL
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = 'is_active'
      AND data_type    = 'boolean'
      AND is_nullable  = 'NO'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: profiles.is_active missing or nullable';
  END IF;

  -- 9. No 'blocked', 'inactive', or 'revoked' role values introduced
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role_enum'
      AND e.enumlabel IN ('blocked', 'inactive', 'revoked')
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: forbidden role enum values introduced';
  END IF;

  RAISE NOTICE 'GUARDIAN-3B3E2 postconditions: all 9 passed';
END $$;

COMMIT;
