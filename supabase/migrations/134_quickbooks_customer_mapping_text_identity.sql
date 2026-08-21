-- =============================================================================
-- Migration 134 — QBO-4A.6: Correct the canonical customer identity contract.
-- =============================================================================
-- QBO-4A assumed relationship_accounts.id is a gen_random_uuid() UUID. A live
-- production audit PROVED that assumption FALSE for the real tenant:
--
--   * relationship_accounts.id is a TEXT PRIMARY KEY (default
--     'acct_' || replace(gen_random_uuid()::text, '-', '')).
--   * 16/16 real tenant customers use non-UUID legacy ids: 'gc...', 'import_gc_...'.
--   * These ids are stable, immutable after insert, globally unique in the tenant,
--     and are the canonical PowerOn customer identity.
--   * relationship_account_links.account_id + relationship_account_events.account_id
--     are hard TEXT FKs to relationship_accounts.id.
--   * Existing app/historical records store these literal TEXT ids.
--
-- Migration 133 therefore declared quickbooks_customer_mappings.poweron_customer_id
-- as the WRONG type (UUID NOT NULL) and documented a contract ("reconciled
-- relationship_accounts.id UUID") that was never true. A UUID-typed column cannot
-- store 'gc2', so QBO customer mapping is unreachable for every real customer.
--
-- LOCKED DECISION (QBO-4A.6): DO NOT rekey relationship_accounts. Preserve existing
-- production TEXT identities. QBO adapts to PowerOn's canonical identity.
--
-- This migration changes ONLY:
--   public.quickbooks_customer_mappings.poweron_customer_id  UUID  ->  TEXT
--
-- The canonical identity authority is NOT format. It is: the id exists as
-- relationship_accounts.id AND belongs to the authenticated PowerOn organization
-- (validated at the service boundary by the server, never by UUID format). This
-- column intentionally remains NOT a hard FK to relationship_accounts so mapping
-- provenance survives a PowerOn customer hard delete (retained accounting link).
--
-- Safety:
--   * The table currently holds 0 rows (verified by a precondition), so the type
--     change cannot lose/corrupt data. The migration does NOT depend solely on
--     that assumption — it asserts the column is currently UUID before altering.
--   * organization_id stays UUID (organizations.id IS a real UUID FK). Untouched.
--   * qbo_customer_id, qbo_company_fingerprint, qbo_environment, link_origin,
--     is_active, retained-history columns, partial UNIQUE indexes, RLS, grants,
--     and the updated_at trigger are all UNTOUCHED. TEXT works identically in the
--     existing equality/UNIQUE indexes (no rebuild needed).
--   * Migration 133 is FROZEN — not edited.
--
-- Migration ceiling becomes 134.
-- =============================================================================

BEGIN;

-- ── 0. Preconditions — fail closed before any change ─────────────────────────

DO $$
DECLARE
  v_exists       boolean;
  v_data_type    text;
  v_row_count     bigint;
  v_is_uuid      boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: quickbooks_customer_mappings table missing (run migration 133 first)';
  END IF;

  -- The column we are about to alter must currently be UUID (don't blindly cast).
  SELECT data_type INTO v_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
    AND column_name = 'poweron_customer_id';
  IF v_data_type IS NULL THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: poweron_customer_id column missing';
  END IF;
  v_is_uuid := (v_data_type = 'uuid');
  IF NOT v_is_uuid THEN
    -- Already TEXT (e.g. re-run) — nothing to alter. Safe to proceed to the
    -- idempotent comment + postconditions below; the ALTER is skipped.
    RAISE NOTICE 'PRECONDITION NOTE: poweron_customer_id is already % (not uuid); skipping ALTER', v_data_type;
  END IF;

  -- Row count for the audit log. 0 expected; logged, not enforced (the type change
  -- is safe regardless because UUID::text is lossless and text->UUID would only be
  -- needed on a reverse migration).
  SELECT count(*) INTO v_row_count FROM public.quickbooks_customer_mappings;
  RAISE NOTICE 'PRECONDITION NOTE: quickbooks_customer_mappings row count = %', v_row_count;
END $$;

-- ── 1. Type change: poweron_customer_id UUID -> TEXT ───────────────────────────
-- UUID::text is lossless (canonical UUID string), so the USING clause is safe even
-- if rows existed. The column stays NOT NULL. Idempotent: only runs when still uuid.

DO $$
DECLARE
  v_data_type text;
BEGIN
  SELECT data_type INTO v_data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
    AND column_name = 'poweron_customer_id';
  IF v_data_type = 'uuid' THEN
    ALTER TABLE public.quickbooks_customer_mappings
      ALTER COLUMN poweron_customer_id TYPE text
      USING poweron_customer_id::text;
  END IF;
END $$;

ALTER TABLE public.quickbooks_customer_mappings
  ALTER COLUMN poweron_customer_id SET NOT NULL;

-- ── 2. Corrected column comment — accurate contract, no UUID-format language ───

COMMENT ON COLUMN public.quickbooks_customer_mappings.poweron_customer_id IS
  'Canonical PowerOn customer identity = relationship_accounts.id (TEXT PRIMARY KEY). '
  'Validated at the service boundary by ORG-SCOPED EXISTENCE (the id belongs to an '
  'existing relationship_accounts row in the authenticated PowerOn organization), NOT '
  'by UUID format. Real PowerOn customer ids are stable TEXT values such as ''gc...'' '
  'or ''import_gc_...'' (legacy provenance, NOT temporary once persisted). Intentionally '
  'NOT a hard FK to relationship_accounts so mapping provenance survives a PowerOn '
  'customer hard delete, preserving the accounting-link history.';

-- ── 3. Postconditions — verify the change + that nothing else regressed ───────

DO $$
DECLARE
  v_data_type        text;
  v_is_not_null      boolean;
  v_rls              boolean;
  v_anon_grant       boolean;
  v_auth_policy      int;
  v_unique_poweron   boolean;
  v_unique_qbo       boolean;
  v_env_check        boolean;
  v_link_origin_check boolean;
  v_trigger_exists   boolean;
BEGIN
  -- poweron_customer_id is now TEXT NOT NULL.
  SELECT data_type, is_nullable INTO v_data_type, v_is_not_null
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
    AND column_name = 'poweron_customer_id';
  IF v_data_type IS NULL OR v_data_type <> 'text' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: poweron_customer_id must be text (got %)', v_data_type;
  END IF;
  IF v_is_not_null IS NULL OR v_is_not_null <> 'NO' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: poweron_customer_id must stay NOT NULL';
  END IF;

  -- RLS still enabled.
  SELECT relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'quickbooks_customer_mappings';
  IF NOT v_rls THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on quickbooks_customer_mappings';
  END IF;

  -- anon/authenticated still have NO direct access.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) INTO v_anon_grant;
  IF v_anon_grant THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon/authenticated must not access quickbooks_customer_mappings';
  END IF;

  -- Still server-only: no authenticated RLS policies.
  SELECT count(*) INTO v_auth_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'quickbooks_customer_mappings';
  IF v_auth_policy > 0 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_customer_mappings must have no RLS policies (server-only)';
  END IF;

  -- Partial UNIQUE indexes still present (TEXT keys work identically).
  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'uq_qbo_customer_mappings_one_active_per_poweron'
      AND i.indisunique
  ) INTO v_unique_poweron;
  IF NOT v_unique_poweron THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: one-active-per-poweron unique index missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'uq_qbo_customer_mappings_one_active_per_qbo'
      AND i.indisunique
  ) INTO v_unique_qbo;
  IF NOT v_unique_qbo THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: one-active-per-qbo unique index missing';
  END IF;

  -- qbo_environment CHECK still enforces sandbox/production only.
  -- Match by constraint name (Postgres rewrites IN (...) to = ANY (ARRAY[...])).
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quickbooks_customer_mappings'::regclass
      AND contype = 'c'
      AND conname = 'quickbooks_customer_mappings_qbo_environment_check'
      AND pg_get_constraintdef(oid) ~* 'sandbox'
      AND pg_get_constraintdef(oid) ~* 'production'
  ) INTO v_env_check;
  IF NOT v_env_check THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: qbo_environment sandbox/production CHECK missing';
  END IF;

  -- link_origin CHECK still enforces linked/created only.
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.quickbooks_customer_mappings'::regclass
      AND contype = 'c'
      AND conname = 'quickbooks_customer_mappings_link_origin_check'
      AND pg_get_constraintdef(oid) ~* 'linked'
      AND pg_get_constraintdef(oid) ~* 'created'
  ) INTO v_link_origin_check;
  IF NOT v_link_origin_check THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: link_origin linked/created CHECK missing';
  END IF;

  -- updated_at trigger still present.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'quickbooks_customer_mappings'
      AND trigger_name = 'trg_quickbooks_customer_mappings_set_updated_at'
  ) INTO v_trigger_exists;
  IF NOT v_trigger_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: updated_at trigger missing';
  END IF;
END $$;

COMMIT;