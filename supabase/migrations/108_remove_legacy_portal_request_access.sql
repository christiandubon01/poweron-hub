-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 108: Remove legacy portal_requests access — SEC-0R2
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Context:
--   Migration 107 (SEC-0R) introduced owner/admin RLS policies and attempted to
--   drop the legacy broad policies.  The DROP statements used names that did not
--   match the actual production policy names, so the legacy policies survived
--   and continued to override the new owner/admin policies through permissive
--   RLS OR-semantics.  Additionally, the 107 GRANT SELECT,UPDATE was additive
--   because REVOKE ALL FROM authenticated was never run, leaving authenticated
--   with full DELETE/INSERT/TRUNCATE/REFERENCES/TRIGGER privileges.
--
-- This migration:
--   1. Drops the actual legacy production policy names.
--   2. Defensively drops the names assumed by migration 107.
--   3. Revokes all table privileges from PUBLIC, anon, and authenticated.
--   4. Grants only SELECT and UPDATE to authenticated.
--   5. Asserts postconditions inside the transaction so any violation rolls back.
--
-- Does not alter:
--   - portal_requests_owner_admin_select
--   - portal_requests_owner_admin_update
--   - profiles_update_self
--   - submit_portal_request, get_portal_request_status, append_portal_request_files
--   - RPC EXECUTE grants
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Drop legacy policies by their actual production names ──────────────────

DROP POLICY IF EXISTS "allow_all_inserts"  ON public.portal_requests;
DROP POLICY IF EXISTS "allow_auth_all"     ON public.portal_requests;

-- ── 2. Defensively drop the names migration 107 assumed (already absent) ──────

DROP POLICY IF EXISTS "portal_requests_public_insert" ON public.portal_requests;
DROP POLICY IF EXISTS "portal_requests_auth_all"      ON public.portal_requests;

-- ── 3. Revoke all direct table privileges ─────────────────────────────────────

REVOKE ALL PRIVILEGES ON TABLE public.portal_requests FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.portal_requests FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.portal_requests FROM authenticated;

-- ── 4. Grant only the minimum needed for owner/admin RLS path ─────────────────

GRANT SELECT, UPDATE ON TABLE public.portal_requests TO authenticated;

-- ── 5. Postcondition assertions ───────────────────────────────────────────────
-- All checks run inside this transaction; any RAISE EXCEPTION rolls back
-- the entire migration, leaving production in its prior state.

DO $$
DECLARE
  v_count     integer;
  v_rls_on    boolean;
  v_fn_oid    oid;
BEGIN

  -- A. RLS remains enabled ────────────────────────────────────────────────────
  SELECT c.relrowsecurity
  INTO   v_rls_on
  FROM   pg_class c
  JOIN   pg_namespace n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public' AND c.relname = 'portal_requests';

  IF NOT v_rls_on THEN
    RAISE EXCEPTION
      'postcondition failed: RLS is not enabled on portal_requests';
  END IF;

  -- B. Exactly two portal_requests policies remain ────────────────────────────
  SELECT count(*) INTO v_count
  FROM   pg_policies
  WHERE  schemaname = 'public' AND tablename = 'portal_requests';

  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'postcondition failed: expected 2 portal_requests policies, found %', v_count;
  END IF;

  -- C. Their exact names are portal_requests_owner_admin_select/update ─────────
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'portal_requests'
      AND  policyname = 'portal_requests_owner_admin_select'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_requests_owner_admin_select is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'portal_requests'
      AND  policyname = 'portal_requests_owner_admin_update'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_requests_owner_admin_update is missing';
  END IF;

  -- D. No FOR ALL or unrestricted true policy remains ─────────────────────────
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public'
      AND  tablename  = 'portal_requests'
      AND  (cmd = 'ALL' OR qual = 'true' OR with_check = 'true')
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: a broad or unrestricted policy remains on portal_requests';
  END IF;

  -- E. PUBLIC has no table privileges ─────────────────────────────────────────
  IF has_table_privilege('public', 'public.portal_requests', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC retains SELECT on portal_requests';
  END IF;
  IF has_table_privilege('public', 'public.portal_requests', 'INSERT') THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC retains INSERT on portal_requests';
  END IF;
  IF has_table_privilege('public', 'public.portal_requests', 'UPDATE') THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC retains UPDATE on portal_requests';
  END IF;
  IF has_table_privilege('public', 'public.portal_requests', 'DELETE') THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC retains DELETE on portal_requests';
  END IF;

  -- F. anon has no table privileges ───────────────────────────────────────────
  IF has_table_privilege('anon', 'public.portal_requests', 'SELECT') THEN
    RAISE EXCEPTION 'postcondition failed: anon retains SELECT on portal_requests';
  END IF;
  IF has_table_privilege('anon', 'public.portal_requests', 'INSERT') THEN
    RAISE EXCEPTION 'postcondition failed: anon retains INSERT on portal_requests';
  END IF;
  IF has_table_privilege('anon', 'public.portal_requests', 'UPDATE') THEN
    RAISE EXCEPTION 'postcondition failed: anon retains UPDATE on portal_requests';
  END IF;
  IF has_table_privilege('anon', 'public.portal_requests', 'DELETE') THEN
    RAISE EXCEPTION 'postcondition failed: anon retains DELETE on portal_requests';
  END IF;

  -- G. authenticated has exactly SELECT and UPDATE ─────────────────────────────
  IF NOT has_table_privilege('authenticated', 'public.portal_requests', 'SELECT') THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated is missing SELECT on portal_requests';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.portal_requests', 'UPDATE') THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated is missing UPDATE on portal_requests';
  END IF;

  -- H. authenticated lacks INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ────────
  IF has_table_privilege('authenticated', 'public.portal_requests', 'INSERT') THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated retains INSERT on portal_requests';
  END IF;
  IF has_table_privilege('authenticated', 'public.portal_requests', 'DELETE') THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated retains DELETE on portal_requests';
  END IF;
  IF has_table_privilege('authenticated', 'public.portal_requests', 'TRUNCATE') THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated retains TRUNCATE on portal_requests';
  END IF;
  IF has_table_privilege('authenticated', 'public.portal_requests', 'REFERENCES') THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated retains REFERENCES on portal_requests';
  END IF;
  IF has_table_privilege('authenticated', 'public.portal_requests', 'TRIGGER') THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated retains TRIGGER on portal_requests';
  END IF;

  -- I. Exactly one overload exists for each approved RPC ────────────────────────
  SELECT count(*) INTO v_count
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'submit_portal_request';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'postcondition failed: expected 1 overload for submit_portal_request, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_portal_request_status';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'postcondition failed: expected 1 overload for get_portal_request_status, found %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'append_portal_request_files';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'postcondition failed: expected 1 overload for append_portal_request_files, found %', v_count;
  END IF;

  -- J. All three remain SECURITY DEFINER ────────────────────────────────────────
  SELECT count(*) INTO v_count
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public'
    AND  p.proname IN ('submit_portal_request','get_portal_request_status','append_portal_request_files')
    AND  NOT p.prosecdef;
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'postcondition failed: % RPC(s) are no longer SECURITY DEFINER', v_count;
  END IF;

  -- K. anon retains EXECUTE on all three RPCs ───────────────────────────────────
  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'submit_portal_request';
  IF NOT has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: anon missing EXECUTE on submit_portal_request';
  END IF;

  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_portal_request_status';
  IF NOT has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: anon missing EXECUTE on get_portal_request_status';
  END IF;

  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'append_portal_request_files';
  IF NOT has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: anon missing EXECUTE on append_portal_request_files';
  END IF;

  -- L. authenticated retains EXECUTE on all three RPCs ─────────────────────────
  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'submit_portal_request';
  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: authenticated missing EXECUTE on submit_portal_request';
  END IF;

  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_portal_request_status';
  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: authenticated missing EXECUTE on get_portal_request_status';
  END IF;

  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'append_portal_request_files';
  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: authenticated missing EXECUTE on append_portal_request_files';
  END IF;

  -- M. PUBLIC has no EXECUTE on any of the three RPCs ──────────────────────────
  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'submit_portal_request';
  IF has_function_privilege('public', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC has EXECUTE on submit_portal_request';
  END IF;

  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_portal_request_status';
  IF has_function_privilege('public', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC has EXECUTE on get_portal_request_status';
  END IF;

  SELECT p.oid INTO v_fn_oid
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'append_portal_request_files';
  IF has_function_privilege('public', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'postcondition failed: PUBLIC has EXECUTE on append_portal_request_files';
  END IF;

END $$;

COMMIT;
