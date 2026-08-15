BEGIN;

-- GUARDIAN-3B3E2A: Inactive-user authenticated data gate
--
-- Problem: ~32 tables grant org authority via inline subqueries such as:
--   org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
-- These bypass the hardened helpers fixed in migration 124. An authenticated user
-- with profiles.is_active = false and a still-valid JWT can access org data.
--
-- Fix: One canonical STABLE helper + one RESTRICTIVE policy per affected table.
--
-- active_user_gate (AS RESTRICTIVE) is an AND-gate. For any authenticated user:
--   result = (ANY permissive policy) AND (ALL restrictive policies)
--
-- Active users  (is_active = true)  → current_user_is_active() = true  → gate passes → no change
-- Inactive users (is_active = false) → current_user_is_active() = false → gate blocks all ops
--
-- Scope boundary:
--   Included:  32 tables with authenticated org-scoped inline profile lookups
--   Excluded:  emp_permission_overrides, emp_role_assignments, emp_role_permissions,
--              emp_roles, employee_schedules, employee_task_completions,
--              employee_work_sessions, service_call_assignments, time_punch_edit_requests
--              (use employee_profiles.user_id, not profiles.org_id; different access model)
--
-- Does NOT modify: profiles.is_active, organizations, memberships, auth.users,
--   user_sessions data rows, existing permissive policies, role semantics.

-- ── Helper function ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_user_is_active()
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
      AND is_active = true
  );
$$;

-- ── Restrictive active-user gate: one policy per affected table ─────────────
-- Policy name 'active_user_gate' is the same on every table (names are per-table).
-- FOR ALL covers: SELECT (USING), INSERT (WITH CHECK), UPDATE (both), DELETE (USING).

CREATE POLICY active_user_gate ON public.agenda_tasks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.agent_messages
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.agent_proposals
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.audit_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.billing_customers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.campaign_leads
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.campaigns
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.clients
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.compliance_checks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.field_logs
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.gc_activity_log
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.gc_contacts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.hunter_conversion_receipts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.job_schedules
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.price_book_categories
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.price_book_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.project_phases
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.project_templates
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.relationship_account_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.relationship_account_links
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.relationship_accounts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.relationship_data_snapshots
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.review_responses
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.reviews
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.subscription_events
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.subscriptions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.travel_times
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.trigger_rules
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.user_sessions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.voice_memos
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.voice_response_cache
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

CREATE POLICY active_user_gate ON public.voice_sessions
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.current_user_is_active())
  WITH CHECK (public.current_user_is_active());

-- ── Postcondition assertions ─────────────────────────────────────────────────

DO $$
DECLARE
  v_def text;
  v_count integer;
BEGIN

  -- 1. current_user_is_active() exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_user_is_active'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: current_user_is_active not found';
  END IF;

  -- 2. current_user_is_active() checks is_active
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'current_user_is_active';

  IF v_def NOT LIKE '%is_active = true%' AND v_def NOT LIKE '%is_active=true%' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: current_user_is_active does not check is_active';
  END IF;

  -- 3. current_user_is_active() is SECURITY DEFINER
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_user_is_active' AND p.prosecdef = true
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: current_user_is_active is not SECURITY DEFINER';
  END IF;

  -- 4. Exactly 32 restrictive 'active_user_gate' policies exist
  SELECT COUNT(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = 'active_user_gate';

  IF v_count != 32 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: expected 32 active_user_gate policies, found %', v_count;
  END IF;

  -- 5. profiles does NOT have active_user_gate (self-bootstrap must remain open)
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'active_user_gate'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: profiles should not have active_user_gate (breaks auth bootstrap)';
  END IF;

  -- 6. profiles.is_active still exists as boolean NOT NULL
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

  RAISE NOTICE 'GUARDIAN-3B3E2A postconditions: all 6 passed';
END $$;

COMMIT;
