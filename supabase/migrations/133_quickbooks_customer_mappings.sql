-- =============================================================================
-- Migration 133: QBO-4A.2 — QuickBooks Customer Mapping persistence + security
-- =============================================================================
-- Adds ONE SERVER-ONLY table that records the owner-approved link between a
-- PowerOn customer and a QuickBooks Online customer:
--
--   public.quickbooks_customer_mappings
--     A customer-LEVEL mapping (never project/service/draft-specific):
--
--       PowerOn organization
--         + reconciled PowerOn customer UUID (relationship_accounts.id)
--         + current QBO company/realm fingerprint
--         + QBO environment (sandbox | production)
--       -> QuickBooks Customer Id
--
--     The mapping is scoped to (organization, poweron_customer, qbo company
--     fingerprint, environment) so a Sandbox mapping is NEVER reused in
--     Production, and a Company-A mapping is NEVER reused after the owner
--     connects Company B. The QBO company fingerprint is a deterministic
--     server-derived SHA-256 of the decrypted realmId (domain-separated), NEVER
--     the raw realmId — the raw realmId stays encrypted in quickbooks_connections.
--
-- LOCAL IDENTITY: poweron_customer_id is UUID NOT NULL. It is NOT a hard FK to
--   relationship_accounts(id). Reasons (from the QBO-4A.1 audit):
--     1. relationship_accounts has NO CREATE TABLE in any migration (its DDL
--        lives outside the migrations folder), so a hard FK is fragile across
--        fresh/reset environments and migration ordering.
--     2. relationship_accounts is HARD-DELETEd by the app
--        (deleteRelationshipAccount, including batch duplicate-cleanup), not
--        soft-deleted/archived.
--     3. No existing table in the repo has a hard FK to relationship_accounts
--        (grep "REFERENCES relationship_accounts" returns nothing) — the
--        architecture deliberately does not hard-FK to it.
--     4. ON DELETE CASCADE would silently destroy accounting-link history
--        (forbidden); ON DELETE RESTRICT would break the existing batch
--        duplicate-cleanup delete; ON DELETE SET NULL is impossible on a NOT
--        NULL column.
--   The UUID is validated at the service/repository boundary (reject names,
--   project names, customer_reference, and temporary 'gc123456' ids). A
--   mapping row therefore SURVIVES a later hard-delete of the PowerOn customer,
--   preserving accounting-link provenance via poweron_customer_snapshot.
--
-- RETAINED UNLINK/RELINK HISTORY (model B): rows are never hard-deleted on
--   unlink. `is_active` flips to false with unlinked_at/unlinked_by_user_id,
--   and partial UNIQUE indexes (WHERE is_active = true) enforce "at most one
--   active mapping per scope" while retaining the old link as provenance for
--   future "Change mapping" / audit. This is the minimal history model — not a
--   broad event/audit subsystem.
--
-- SERVER-ONLY: RLS enabled, REVOKE ALL from PUBLIC/anon/authenticated, NO
--   authenticated policies. The browser has no direct CRUD path; Netlify
--   functions drive it with the service role key. The browser receives only the
--   sanitized shape { linked, customer: { id, displayName, active } | null } —
--   no realmId, no fingerprint, no tokens, no envelopes.
--
-- Financial authority firewall (QBO-1A2 / QBO-3A / QBO-4A): this migration writes
--   no payment ledger, collected-cash, KPI, invoice_draft, service ledger, or
--   historical-payment data. Customer mapping is identity/link plumbing only.
--
-- Migration 132 is frozen and untouched. No prior migration is edited.
-- =============================================================================

BEGIN;

-- ── 1. quickbooks_customer_mappings ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quickbooks_customer_mappings (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy: one PowerOn organization owns the mapping.
  organization_id             UUID         NOT NULL
                              REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- LOCAL IDENTITY: reconciled relationship_accounts.id UUID. NOT a hard FK
  -- (see header). Validated at the service boundary; never a name, project name,
  -- customer_reference, or temporary 'gc...' id.
  poweron_customer_id         UUID         NOT NULL,

  -- QBO-side identity: QuickBooks Customer.Id (string, stable per realm/company).
  -- NEVER use DisplayName as identity (it can be renamed in QBO).
  qbo_customer_id             TEXT         NOT NULL,

  -- Deterministic server-derived fingerprint of the current QBO company/realm
  -- (domain-separated SHA-256 of the decrypted realmId). Scoping only; never the
  -- raw realmId; never browser-visible; never a substitute for realmId when
  -- calling Intuit.
  qbo_company_fingerprint     TEXT         NOT NULL,

  -- sandbox | production. Prevents a sandbox mapping being reused in production.
  qbo_environment             TEXT         NOT NULL
                              CHECK (qbo_environment IN ('sandbox', 'production')),

  -- Provenance: was this link established by linking an existing QBO customer,
  -- or by creating a new one in QuickBooks? (Create is never automatic.)
  link_origin                 TEXT         NOT NULL DEFAULT 'linked'
                              CHECK (link_origin IN ('linked', 'created')),

  -- Provenance/DISPLAY snapshots only — NEVER identity. DisplayName can be
  -- renamed in QBO; the PowerOn snapshot preserves who was linked at link time.
  qbo_display_name            TEXT         NULL,
  poweron_customer_snapshot   JSONB        NULL,

  -- Retained-history unlink model: only one ACTIVE mapping per scope.
  is_active                   BOOLEAN      NOT NULL DEFAULT true,
  unlinked_at                 TIMESTAMPTZ  NULL,
  unlinked_by_user_id         UUID         NULL
                              REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Who established the link (auth.users id, matching quickbooks_connections
  -- created_by/connected_by convention).
  linked_by_user_id           UUID         NULL
                              REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.quickbooks_customer_mappings IS
  'QBO-4A.2: Customer-LEVEL mapping PowerOn customer <-> QuickBooks customer. Scoped to '
  '(organization, poweron_customer, qbo company fingerprint, environment). SERVER-ONLY (RLS, '
  'no authenticated policies). Retained unlink/relink history via is_active. poweron_customer_id '
  'is UUID NOT NULL validated at the service boundary — NOT a hard FK to relationship_accounts.';
COMMENT ON COLUMN public.quickbooks_customer_mappings.poweron_customer_id IS
  'Reconciled relationship_accounts.id UUID. Validated at the service boundary (rejects names, '
  'project names, customer_reference, and temporary gc... ids). Not a hard FK — survives '
  'hard-delete of the PowerOn customer, preserving accounting-link provenance.';
COMMENT ON COLUMN public.quickbooks_customer_mappings.qbo_company_fingerprint IS
  'Domain-separated SHA-256 of the decrypted realmId. Scoping only; never the raw realmId; '
  'never browser-visible. Prevents sandbox/prod and Company-A/Company-B mapping reuse.';
COMMENT ON COLUMN public.quickbooks_customer_mappings.qbo_display_name IS
  'Provenance/display snapshot of the QBO DisplayName at link time. NEVER identity (renameable).';
COMMENT ON COLUMN public.quickbooks_customer_mappings.poweron_customer_snapshot IS
  'Provenance snapshot of the PowerOn customer at link time. NEVER identity.';
COMMENT ON COLUMN public.quickbooks_customer_mappings.is_active IS
  'true for the current link; false retains unlinked history. Partial UNIQUE indexes enforce '
  'at most one active mapping per scope.';
COMMENT ON COLUMN public.quickbooks_customer_mappings.link_origin IS
  'linked: owner linked an existing QBO customer. created: owner created a new QBO customer. '
  'Creation is never automatic.';

-- ── 2. Indexes + duplicate-prevention uniqueness ────────────────────────────

CREATE INDEX IF NOT EXISTS idx_qbo_customer_mappings_organization
  ON public.quickbooks_customer_mappings (organization_id);

-- Fast lookup of the active mapping for a PowerOn customer in a given company/env.
CREATE INDEX IF NOT EXISTS idx_qbo_customer_mappings_active_lookup
  ON public.quickbooks_customer_mappings (organization_id, poweron_customer_id, qbo_company_fingerprint, qbo_environment)
  WHERE is_active = true;

-- One ACTIVE mapping per PowerOn customer per company/environment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbo_customer_mappings_one_active_per_poweron
  ON public.quickbooks_customer_mappings (organization_id, poweron_customer_id, qbo_company_fingerprint, qbo_environment)
  WHERE is_active = true;

-- Prevent two different PowerOn customers from claiming the SAME QBO customer
-- inside the same organization + company + environment.
CREATE UNIQUE INDEX IF NOT EXISTS uq_qbo_customer_mappings_one_active_per_qbo
  ON public.quickbooks_customer_mappings (organization_id, qbo_customer_id, qbo_company_fingerprint, qbo_environment)
  WHERE is_active = true;

-- ── 3. updated_at trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_quickbooks_customer_mappings_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quickbooks_customer_mappings_set_updated_at
  ON public.quickbooks_customer_mappings;
CREATE TRIGGER trg_quickbooks_customer_mappings_set_updated_at
  BEFORE UPDATE ON public.quickbooks_customer_mappings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_quickbooks_customer_mappings_updated_at();

-- ── 4. RLS — SERVER-ONLY (no authenticated policies) ──────────────────────────

ALTER TABLE public.quickbooks_customer_mappings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.quickbooks_customer_mappings FROM PUBLIC;
REVOKE ALL ON TABLE public.quickbooks_customer_mappings FROM anon;
REVOKE ALL ON TABLE public.quickbooks_customer_mappings FROM authenticated;

-- Deliberately NO CREATE POLICY ... TO authenticated ... — the browser has no
-- direct CRUD path to mapping rows. Authenticated Netlify functions use the
-- service role key (SUPABASE_SERVICE_ROLE_KEY), which bypasses RLS, as the sole
-- data authority. The company fingerprint is never exposed to the browser.
GRANT USAGE ON SCHEMA public TO authenticated;

-- ── 5. Postconditions ────────────────────────────────────────────────────────

DO $$
DECLARE
  v_exists           boolean;
  v_rls               boolean;
  v_anon_grant       boolean;
  v_auth_policy      int;
  v_unique_poweron   boolean;
  v_unique_qbo       boolean;
  v_col_exists       boolean;
  v_default          text;
BEGIN
  -- Table exists.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_customer_mappings missing';
  END IF;

  -- RLS enabled.
  SELECT relrowsecurity INTO v_rls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'quickbooks_customer_mappings';
  IF NOT v_rls THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on quickbooks_customer_mappings';
  END IF;

  -- anon/authenticated must have NO direct table access.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
      AND grantee IN ('anon', 'authenticated')
      AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) INTO v_anon_grant;
  IF v_anon_grant THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon/authenticated must not access quickbooks_customer_mappings';
  END IF;

  -- SERVER-ONLY: NO authenticated RLS policies.
  SELECT count(*) INTO v_auth_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'quickbooks_customer_mappings';
  IF v_auth_policy > 0 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: quickbooks_customer_mappings must have no RLS policies (server-only)';
  END IF;

  -- Partial UNIQUE index: one active mapping per PowerOn customer per company/env.
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'uq_qbo_customer_mappings_one_active_per_poweron'
      AND i.indisunique
  ) INTO v_unique_poweron;
  IF NOT v_unique_poweron THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: one-active-per-poweron unique index missing';
  END IF;

  -- Partial UNIQUE index: one active QBO customer per org/company/env.
  SELECT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'uq_qbo_customer_mappings_one_active_per_qbo'
      AND i.indisunique
  ) INTO v_unique_qbo;
  IF NOT v_unique_qbo THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: one-active-per-qbo unique index missing';
  END IF;

  -- environment CHECK + link_origin CHECK columns exist.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
      AND column_name = 'qbo_environment'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: qbo_environment column missing';
  END IF;

  -- is_active default true.
  SELECT column_default INTO v_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'quickbooks_customer_mappings'
    AND column_name = 'is_active';
  IF v_default IS NULL OR v_default NOT LIKE '%true%' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: is_active default must be true';
  END IF;

  -- updated_at trigger exists.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'quickbooks_customer_mappings'
      AND trigger_name = 'trg_quickbooks_customer_mappings_set_updated_at'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: updated_at trigger missing';
  END IF;
END $$;

COMMIT;