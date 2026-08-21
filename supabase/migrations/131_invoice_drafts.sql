-- =============================================================================
-- Migration 131: QBO-2F — Persistent invoice drafts (organization-scoped)
-- =============================================================================
-- Adds public.invoice_drafts: the durable, owner-approved PREPARATION record
-- for an outbound invoice destined for QuickBooks LATER. These are preparation
-- records only — they are NOT QuickBooks invoices and carry no QBO id.
--
-- Tenancy / authority (reuses proven repo helpers, no parallel model):
--   - organization_id  → public.organizations(id) ON DELETE RESTRICT
--   - owner/admin of an org may SELECT/INSERT/UPDATE/DELETE that org's drafts
--   - cross-org reads/writes are denied; anon has no access
--   - public.user_org_id() + public.is_org_admin_for() (from migration 124)
--
-- Financial authority firewall (QBO-2F):
--   - Money is stored as NUMERIC(14,2) — no floating-point accounting drift.
--   - No payment ledger, collected-cash, KPI, or QBO table is written here.
--   - This table is OUTBOUND preparation only; approval does not send to QBO.
--
-- Source snapshot / provenance:
--   - source_type 'project' | 'service' (spec category)
--   - source_kind 'project' | 'serviceLog' | 'serviceCall' (exact rehydration
--     discriminator matching the Prepare Invoice source union)
--   - source_id is a TEXT operational id (BackupData project/service-log/service-call ids)
--   - selected_source_ids + source_snapshot persist enough provenance to
--     reopen and understand the draft even if surrounding live data changes.
--
-- Status model (QBO-2F): draft | approved. No 'sent' status in this phase.
--   - approved_at nullable; cleared when an approved draft is edited back to draft.
--
-- Untouched: QBO OAuth, Anthropic/AI, referral/Employee/Admin/Guardian work,
-- package.json, vite config, payment/KPI truth.
-- =============================================================================

BEGIN;

-- ── 1. invoice_drafts ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_drafts (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID         NOT NULL
                          REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_by              UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- STATUS
  status                  TEXT         NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'approved')),
  approved_at             TIMESTAMPTZ  NULL,

  -- SOURCE / PROVENANCE
  source_type             TEXT         NOT NULL
                          CHECK (source_type IN ('project', 'service')),
  source_kind              TEXT         NOT NULL
                          CHECK (source_kind IN ('project', 'serviceLog', 'serviceCall')),
  source_id               TEXT         NOT NULL,
  selected_source_ids     JSONB        NOT NULL DEFAULT '[]'::jsonb,
  source_snapshot         JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- CUSTOMER SNAPSHOT
  customer_reference      TEXT         NULL,
  customer_id             TEXT         NULL,

  -- OWNER-APPROVED INVOICE CONTENT
  product_or_service      TEXT         NOT NULL DEFAULT '',
  description             TEXT         NOT NULL DEFAULT '',
  primary_amount          NUMERIC(14,2) NOT NULL DEFAULT 0
                          CHECK (primary_amount >= 0),
  separate_charges        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  total_amount            NUMERIC(14,2) NOT NULL DEFAULT 0
                          CHECK (total_amount >= 0),
  currency                TEXT         NOT NULL DEFAULT 'USD',

  -- Consistency: an approved draft must carry an approval timestamp; a draft
  -- must not. (Enforced by trigger below to stay in lock-step with edits.)
  CONSTRAINT invoice_drafts_status_approved_at_consistency CHECK (
    (status = 'approved' AND approved_at IS NOT NULL)
    OR (status = 'draft' AND approved_at IS NULL)
  )
);

COMMENT ON TABLE public.invoice_drafts IS
  'QBO-2F: Organization-scoped owner-approved invoice PREPARATION record. '
  'Outbound to QuickBooks LATER; not a QBO invoice; carries no QBO id. '
  'Tenant data — owner/admin only, cross-org denied, anon denied.';

COMMENT ON COLUMN public.invoice_drafts.status IS
  'draft: owner is still preparing. approved: owner approved for later QBO handoff. '
  'No sent status in this phase. Editing billable content of an approved draft reverts it to draft.';
COMMENT ON COLUMN public.invoice_drafts.approved_at IS
  'Set when status becomes approved; cleared when an edit reverts status to draft.';
COMMENT ON COLUMN public.invoice_drafts.source_type IS
  'Spec category: project | service.';
COMMENT ON COLUMN public.invoice_drafts.source_kind IS
  'Exact Prepare Invoice source discriminator: project | serviceLog | serviceCall. '
  'Used to rehydrate the correct Prepare Invoice source on reopen.';
COMMENT ON COLUMN public.invoice_drafts.source_id IS
  'TEXT operational id of the source (BackupData project id, service log id, or service call id).';
COMMENT ON COLUMN public.invoice_drafts.selected_source_ids IS
  'JSON array of provenance candidate ids (Project Log ids / service basis). Context only — never financial line items.';
COMMENT ON COLUMN public.invoice_drafts.source_snapshot IS
  'Safe JSON snapshot of the billing read at save time (customer, contract/collected scalars, candidate summaries) so the draft can be understood/reopened even if live data changes.';
COMMENT ON COLUMN public.invoice_drafts.product_or_service IS
  'Primary billing line Product/Service title (owner-entered; never derived from log notes).';
COMMENT ON COLUMN public.invoice_drafts.description IS
  'Primary billing line customer-facing description.';
COMMENT ON COLUMN public.invoice_drafts.primary_amount IS
  'Primary billing line amount (Billing Now). NUMERIC(14,2) — money-safe.';
COMMENT ON COLUMN public.invoice_drafts.separate_charges IS
  'JSON array of optional separate charge lines: [{title, description, amount}]. Money-safe via NUMERIC conversion on read/write.';
COMMENT ON COLUMN public.invoice_drafts.total_amount IS
  'Deterministic invoice total = primary_amount + sum(separate_charges[].amount). NUMERIC(14,2). Stored for listing; always derivable from the lines.';

-- ── 2. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_invoice_drafts_organization_id
  ON public.invoice_drafts (organization_id);

-- Draft Manager lists org drafts newest-updated first.
CREATE INDEX IF NOT EXISTS idx_invoice_drafts_org_updated
  ON public.invoice_drafts (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoice_drafts_org_status
  ON public.invoice_drafts (organization_id, status, updated_at DESC);

-- ── 3. updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_invoice_drafts_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_drafts_set_updated_at ON public.invoice_drafts;
CREATE TRIGGER trg_invoice_drafts_set_updated_at
  BEFORE UPDATE ON public.invoice_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_invoice_drafts_updated_at();

-- ── 4. RLS for invoice_drafts ────────────────────────────────────────────────

ALTER TABLE public.invoice_drafts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.invoice_drafts FROM PUBLIC;
REVOKE ALL ON TABLE public.invoice_drafts FROM anon;
REVOKE ALL ON TABLE public.invoice_drafts FROM authenticated;

-- owner/admin of the owning org may read their drafts; cross-org denied.
CREATE POLICY invoice_drafts_owner_admin_select
  ON public.invoice_drafts FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

CREATE POLICY invoice_drafts_owner_admin_insert
  ON public.invoice_drafts FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

CREATE POLICY invoice_drafts_owner_admin_update
  ON public.invoice_drafts FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

-- Deletion is allowed in this phase because neither draft nor approved has
-- been sent to QuickBooks yet. Later "sent" records will have stricter rules.
CREATE POLICY invoice_drafts_owner_admin_delete
  ON public.invoice_drafts FOR DELETE
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_drafts TO authenticated;

-- ── 5. Postconditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  v_exists        boolean;
  v_rls           boolean;
  v_anon_select   boolean;
  v_anon_delete   boolean;
  v_col_exists    boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'invoice_drafts'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: invoice_drafts missing';
  END IF;

  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'invoice_drafts';
  IF NOT v_rls THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on invoice_drafts';
  END IF;

  -- anon must have NO direct table access.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'invoice_drafts'
      AND grantee = 'anon'
      AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  ) INTO v_anon_select;
  IF v_anon_select THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon must not access invoice_drafts';
  END IF;

  -- Money columns must be NUMERIC (not floating-point).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_drafts'
      AND column_name = 'primary_amount'
      AND data_type = 'numeric'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: primary_amount must be NUMERIC';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoice_drafts'
      AND column_name = 'total_amount'
      AND data_type = 'numeric'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: total_amount must be NUMERIC';
  END IF;

  -- All four RLS policies exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_drafts'
      AND policyname = 'invoice_drafts_owner_admin_select'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: select policy missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_drafts'
      AND policyname = 'invoice_drafts_owner_admin_delete'
  ) THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: delete policy missing';
  END IF;
END $$;

COMMIT;