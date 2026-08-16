-- =============================================================================
-- Migration 129: LEAD-SRC-4H — Confirmed-unlinked referral state
-- =============================================================================
-- Adds 'confirmed_unlinked' to referral_claims.resolution_status.
--
-- Meaning: The owner confirms that the customer really was referred by the
-- person/text submitted, but that referrer is not currently linked to a
-- Client or Hunter Lead.
--
-- Schema impact: Only referral_claims_status_values CHECK needs updating.
-- The existing referral_claims_resolution_consistency CHECK already handles
-- confirmed_unlinked correctly: the ELSE branch (covers all non-resolved)
-- requires both identity IDs to be null, which is exactly the desired rule.
--
-- Nothing else changes:
--   • No historical row backfill.
--   • No new referral table.
--   • submit_portal_request RPC untouched.
--   • FKs, RLS, policies, grants preserved.
-- =============================================================================

BEGIN;

-- ── 1. Extend status values ───────────────────────────────────────────────────

ALTER TABLE public.referral_claims
  DROP CONSTRAINT IF EXISTS referral_claims_status_values;

ALTER TABLE public.referral_claims
  ADD CONSTRAINT referral_claims_status_values CHECK (
    resolution_status IN ('unresolved', 'resolved', 'ambiguous', 'confirmed_unlinked')
  );

-- ── 2. Postconditions ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_status_constraint_exists   boolean;
  v_status_constraint_def      text;
  v_consistency_constraint_def text;
  v_has_rls                    boolean;
  v_client_fk_deltype          char;
  v_lead_fk_deltype            char;
BEGIN

  -- ── Postcondition 1: confirmed_unlinked is accepted by the status constraint ──

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname       = 'referral_claims_status_values'
      AND conrelid      = 'public.referral_claims'::regclass
      AND contype       = 'c'
  ) INTO v_status_constraint_exists;
  IF NOT v_status_constraint_exists THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: referral_claims_status_values constraint missing';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO   v_status_constraint_def
  FROM   pg_constraint
  WHERE  conname   = 'referral_claims_status_values'
    AND  conrelid  = 'public.referral_claims'::regclass;

  IF v_status_constraint_def NOT LIKE '%confirmed_unlinked%' THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: confirmed_unlinked not present in status_values: %',
      v_status_constraint_def;
  END IF;

  -- ── Postcondition 2: confirmed_unlinked requires both identity IDs null
  -- ── Postcondition 3: resolved still requires exactly one ID
  -- ── Postcondition 4: unresolved/ambiguous still require zero IDs
  -- (All three are enforced by referral_claims_resolution_consistency,
  --  which is unchanged. Verifying it is still present and intact.) ──

  SELECT pg_get_constraintdef(oid)
  INTO   v_consistency_constraint_def
  FROM   pg_constraint
  WHERE  conname  = 'referral_claims_resolution_consistency'
    AND  conrelid = 'public.referral_claims'::regclass;

  IF v_consistency_constraint_def IS NULL THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: referral_claims_resolution_consistency missing';
  END IF;

  -- Must still contain the resolved branch requiring exactly one ID
  IF v_consistency_constraint_def NOT LIKE '%resolved%' THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: resolution_consistency no longer references resolved: %',
      v_consistency_constraint_def;
  END IF;

  -- Must still contain the IS NULL / IS NOT NULL logic
  IF v_consistency_constraint_def NOT LIKE '%IS NULL%' THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: resolution_consistency appears malformed: %',
      v_consistency_constraint_def;
  END IF;

  -- ── Postcondition 5: identity FKs remain ON DELETE RESTRICT ──────────────

  SELECT confdeltype
  INTO   v_client_fk_deltype
  FROM   pg_constraint
  WHERE  conname   = 'referral_claims_resolved_client_id_fkey'
    AND  conrelid  = 'public.referral_claims'::regclass;

  IF v_client_fk_deltype IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: resolved_client_id FK must be RESTRICT (r), found: %',
      v_client_fk_deltype;
  END IF;

  SELECT confdeltype
  INTO   v_lead_fk_deltype
  FROM   pg_constraint
  WHERE  conname   = 'referral_claims_resolved_lead_id_fkey'
    AND  conrelid  = 'public.referral_claims'::regclass;

  IF v_lead_fk_deltype IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: resolved_lead_id FK must be RESTRICT (r), found: %',
      v_lead_fk_deltype;
  END IF;

  -- ── Postcondition 6: RLS still enabled ───────────────────────────────────

  SELECT relrowsecurity
  INTO   v_has_rls
  FROM   pg_class      c
  JOIN   pg_namespace  n ON n.oid = c.relnamespace
  WHERE  n.nspname = 'public'
    AND  c.relname = 'referral_claims';

  IF NOT v_has_rls THEN
    RAISE EXCEPTION
      'POSTCONDITION FAILED: RLS not enabled on referral_claims';
  END IF;

END $$;

COMMIT;
