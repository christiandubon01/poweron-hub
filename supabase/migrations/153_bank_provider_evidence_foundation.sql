-- BANK-1: provider evidence + owner-controlled interpretation foundation.
--
-- Purpose: durable, provider-neutral storage that a future Plaid integration can land in WITHOUT touching
-- canonical Cash OS truth. Nothing here is read by Cash OS calculations, and nothing here writes to the ledger.
--
--   RAW EVIDENCE            financial_provider_items / _accounts / _transactions / _balance_snapshots / _webhook_events
--   OWNER INTERPRETATION    financial_provider_account_mappings / financial_provider_interpretations
--   CANONICAL (unchanged)   financial_accounts / financial_transactions / planned reconciliations / links
--
-- Boundaries (deliberate):
--   * No access token, public token, secret or credential column exists. Token storage is a BANK-2 decision and must be
--     encrypted and server-only; it is intentionally NOT modelled here.
--   * No economic-event table: the posted cash-account ledger row stays the cash-side anchor. Business meaning points AT it
--     through financial_provider_interpretations (and the existing planned-reconciliation / transaction-link tables).
--   * Provider rows never modify financial_accounts (include_in_cash, class, type) or financial_transactions.
--   * No project-payment or payroll-paid target exists yet (they have no durable canonical id). Those relationships are
--     added later (BANK-6) as new nullable targets without changing this model.
--
-- Safe to re-run: tables/indexes use IF NOT EXISTS, triggers/policies are drop-guarded, functions use CREATE OR REPLACE.
-- Apply ONLY with the reviewed single-file procedure (see BANK-0A). Never via `supabase db push`.
BEGIN;

-- ── Shared guard: raw JSON evidence must never carry credentials ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.financial_provider_json_is_safe(p_json JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_json IS NOT NULL
     AND jsonb_typeof(p_json) = 'object'
     AND NOT (p_json ?| ARRAY['access_token', 'public_token', 'refresh_token', 'client_secret', 'secret', 'password', 'credentials']);
$$;

-- ── 1. Provider items (a connection). SERVER-ONLY: holds the sync cursor and diagnostics. ───────────────────
CREATE TABLE IF NOT EXISTS public.financial_provider_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  provider_item_id TEXT NOT NULL CHECK (length(trim(provider_item_id)) > 0),
  institution_id TEXT CHECK (institution_id IS NULL OR length(trim(institution_id)) > 0),
  institution_name TEXT CHECK (institution_name IS NULL OR length(trim(institution_name)) > 0),
  status TEXT NOT NULL DEFAULT 'connecting'
    CHECK (status IN ('connecting', 'healthy', 'login_required', 'error', 'disconnected')),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  consent_expires_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'failed')),
  sync_cursor TEXT,
  last_sync_started_at TIMESTAMPTZ,
  last_sync_completed_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  last_error_at TIMESTAMPTZ,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_items_id_org_unique UNIQUE (id, organization_id),
  -- Globally unique so a webhook can resolve exactly one organization from a provider item id.
  CONSTRAINT financial_provider_items_identity_unique UNIQUE (provider, provider_item_id),
  CONSTRAINT financial_provider_items_disconnect_consistent CHECK ((status = 'disconnected') = (disconnected_at IS NOT NULL))
);

-- ── 2. Provider accounts (evidence about an account at the institution). Identity is the provider id, never the name.
CREATE TABLE IF NOT EXISTS public.financial_provider_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_item_ref UUID NOT NULL,
  provider_account_id TEXT NOT NULL CHECK (length(trim(provider_account_id)) > 0),
  name TEXT CHECK (name IS NULL OR length(trim(name)) > 0),
  official_name TEXT CHECK (official_name IS NULL OR length(trim(official_name)) > 0),
  mask TEXT CHECK (mask IS NULL OR length(mask) BETWEEN 1 AND 16),
  provider_account_type TEXT,
  provider_account_subtype TEXT,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  deactivated_at TIMESTAMPTZ,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (public.financial_provider_json_is_safe(provider_metadata)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_accounts_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_accounts_id_item_org_unique UNIQUE (id, provider_item_ref, organization_id),
  CONSTRAINT financial_provider_accounts_identity_unique UNIQUE (provider_item_ref, provider_account_id),
  CONSTRAINT financial_provider_accounts_item_org_fk
    FOREIGN KEY (provider_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_accounts_inactive_consistent CHECK ((status = 'inactive') = (deactivated_at IS NOT NULL))
);

-- ── 3. Owner-controlled mapping: provider account <-> existing Cash OS financial account. ───────────────────
CREATE TABLE IF NOT EXISTS public.financial_provider_account_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_account_ref UUID NOT NULL,
  financial_account_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  mapped_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  mapped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deactivated_at TIMESTAMPTZ,
  deactivation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_mappings_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_mappings_provider_account_fk
    FOREIGN KEY (provider_account_ref, organization_id)
    REFERENCES public.financial_provider_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_mappings_financial_account_fk
    FOREIGN KEY (financial_account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_mappings_inactive_consistent CHECK ((status = 'inactive') = (deactivated_at IS NOT NULL))
);

-- One ACTIVE mapping each way: a provider account cannot feed two Cash OS accounts, and a Cash OS account cannot be fed
-- by two provider accounts. Inactive rows are kept as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_mappings_active_provider_account
  ON public.financial_provider_account_mappings (provider_account_ref) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_mappings_active_financial_account
  ON public.financial_provider_account_mappings (financial_account_id) WHERE status = 'active';

-- ── 4. Raw provider transactions: WHAT THE PROVIDER TOLD US. Not the ledger. ───────────────────────────
CREATE TABLE IF NOT EXISTS public.financial_provider_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_item_ref UUID NOT NULL,
  provider_account_ref UUID NOT NULL,
  provider_transaction_id TEXT NOT NULL CHECK (length(trim(provider_transaction_id)) > 0),
  pending BOOLEAN NOT NULL,
  -- On a POSTED row: the provider id of the pending transaction it replaces (if the provider says so).
  pending_provider_transaction_id TEXT CHECK (pending_provider_transaction_id IS NULL OR length(trim(pending_provider_transaction_id)) > 0),
  -- Exact provider decimal (as reported, provider sign convention) and its deterministic minor-unit form.
  -- The sign is NOT interpreted here: depository vs card/loan meaning is decided later, per account class.
  provider_amount NUMERIC(20, 4) NOT NULL,
  provider_amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  transaction_date DATE NOT NULL,
  authorized_date DATE,
  name TEXT,
  merchant_name TEXT,
  original_description TEXT,
  provider_category JSONB,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (public.financial_provider_json_is_safe(raw_payload)),
  removed_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_transactions_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_transactions_identity_unique UNIQUE (provider_item_ref, provider_transaction_id),
  CONSTRAINT financial_provider_transactions_account_fk
    FOREIGN KEY (provider_account_ref, provider_item_ref, organization_id)
    REFERENCES public.financial_provider_accounts(id, provider_item_ref, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_transactions_minor_exact CHECK (
    provider_amount * 100 = trunc(provider_amount * 100)
    AND provider_amount_minor::NUMERIC = provider_amount * 100
  ),
  CONSTRAINT financial_provider_transactions_pending_link CHECK (pending_provider_transaction_id IS NULL OR NOT pending),
  CONSTRAINT financial_provider_transactions_seen_order CHECK (last_seen_at >= first_seen_at)
);

-- ── 5. Balance snapshots: provider-reported balances. EVIDENCE for reconciliation; never the ledger. Append-only. ─
CREATE TABLE IF NOT EXISTS public.financial_provider_balance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_account_ref UUID NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  current_balance NUMERIC(20, 4),
  current_balance_minor BIGINT,
  available_balance NUMERIC(20, 4),
  available_balance_minor BIGINT,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  source TEXT NOT NULL CHECK (length(trim(source)) > 0),
  raw_evidence JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (public.financial_provider_json_is_safe(raw_evidence)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_snapshots_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_snapshots_identity_unique UNIQUE (provider_account_ref, observed_at, source),
  CONSTRAINT financial_provider_snapshots_account_fk
    FOREIGN KEY (provider_account_ref, organization_id)
    REFERENCES public.financial_provider_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_snapshots_has_balance CHECK (current_balance_minor IS NOT NULL OR available_balance_minor IS NOT NULL),
  CONSTRAINT financial_provider_snapshots_current_exact CHECK (
    (current_balance IS NULL AND current_balance_minor IS NULL)
    OR (current_balance IS NOT NULL AND current_balance_minor IS NOT NULL
        AND current_balance * 100 = trunc(current_balance * 100) AND current_balance_minor::NUMERIC = current_balance * 100)
  ),
  CONSTRAINT financial_provider_snapshots_available_exact CHECK (
    (available_balance IS NULL AND available_balance_minor IS NULL)
    OR (available_balance IS NOT NULL AND available_balance_minor IS NOT NULL
        AND available_balance * 100 = trunc(available_balance * 100) AND available_balance_minor::NUMERIC = available_balance * 100)
  )
);

-- ── 6. Webhook idempotency foundation. SERVER-ONLY. event_key is a GENERIC idempotency key: BANK-2 decides its semantics.
CREATE TABLE IF NOT EXISTS public.financial_provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_item_ref UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,31}$'),
  event_key TEXT NOT NULL CHECK (length(trim(event_key)) > 0),
  webhook_type TEXT,
  webhook_code TEXT,
  payload_hash TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (public.financial_provider_json_is_safe(payload)),
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processing', 'processed', 'failed', 'ignored')),
  delivery_count INTEGER NOT NULL DEFAULT 1 CHECK (delivery_count >= 1),
  first_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_webhooks_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_webhooks_idempotency_unique UNIQUE (organization_id, provider, event_key),
  CONSTRAINT financial_provider_webhooks_item_fk
    FOREIGN KEY (provider_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_webhooks_processed_consistent CHECK (processing_status <> 'processed' OR processed_at IS NOT NULL)
);

-- ── 7. Owner interpretation of a provider transaction. Reversible, auditable, separate from the raw row. ────
CREATE TABLE IF NOT EXISTS public.financial_provider_interpretations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_transaction_ref UUID NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('ledger_match', 'category', 'transfer', 'obligation', 'project', 'debt', 'payroll', 'ignored')),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'rejected', 'undone')),
  -- Who/what produced it. Browser inserts are restricted to 'owner' by RLS; suggestions come from the server.
  source TEXT NOT NULL CHECK (source IN ('owner', 'system_suggestion', 'rule')),
  confidence TEXT CHECK (confidence IN ('high', 'possible', 'low')),
  suggestion_basis JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Canonical targets. Each is an existing, org-checked canonical record; none is invented here.
  ledger_transaction_id UUID,
  match_mode TEXT CHECK (match_mode IN ('adopted', 'linked')),
  category TEXT CHECK (category IS NULL OR length(trim(category)) > 0),
  obligation_occurrence_id UUID,
  cash_commitment_id UUID,
  transaction_link_id UUID REFERENCES public.financial_transaction_links(id) ON DELETE RESTRICT,
  counterpart_provider_transaction_ref UUID,
  debt_account_id UUID,
  project_id TEXT CHECK (project_id IS NULL OR length(trim(project_id)) > 0),
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  undone_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  undone_at TIMESTAMPTZ,
  undo_reason TEXT,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_interpretations_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_interpretations_provider_tx_fk
    FOREIGN KEY (provider_transaction_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_interpretations_counterpart_fk
    FOREIGN KEY (counterpart_provider_transaction_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_interpretations_ledger_fk
    FOREIGN KEY (ledger_transaction_id, organization_id)
    REFERENCES public.financial_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_interpretations_occurrence_fk
    FOREIGN KEY (obligation_occurrence_id, organization_id)
    REFERENCES public.financial_obligation_occurrences(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_interpretations_commitment_fk
    FOREIGN KEY (cash_commitment_id, organization_id)
    REFERENCES public.cash_commitments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_interpretations_debt_account_fk
    FOREIGN KEY (debt_account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_interpretations_distinct_counterpart
    CHECK (counterpart_provider_transaction_ref IS NULL OR counterpart_provider_transaction_ref <> provider_transaction_ref),
  -- Each kind carries exactly the targets that make sense for it. There is deliberately NO project-payment or
  -- payroll-paid target: those have no durable canonical id yet, and nothing is fabricated for them.
  CONSTRAINT financial_provider_interpretations_kind_targets CHECK (
    (kind = 'ledger_match' AND ledger_transaction_id IS NOT NULL AND match_mode IS NOT NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
    OR (kind = 'category' AND category IS NOT NULL AND match_mode IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
    OR (kind = 'transfer' AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL
       AND debt_account_id IS NULL AND project_id IS NULL
       AND (transaction_link_id IS NOT NULL OR counterpart_provider_transaction_ref IS NOT NULL))
    OR (kind = 'obligation' AND num_nonnulls(obligation_occurrence_id, cash_commitment_id) = 1
       AND match_mode IS NULL AND category IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
    OR (kind = 'debt' AND debt_account_id IS NOT NULL AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND project_id IS NULL)
    OR (kind = 'project' AND project_id IS NOT NULL AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL)
    OR (kind IN ('payroll', 'ignored') AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
  ),
  -- Business meaning that moves money-adjacent truth needs the canonical cash-side ledger row first.
  CONSTRAINT financial_provider_interpretations_confirmed_needs_ledger CHECK (
    status <> 'confirmed' OR kind IN ('category', 'ignored') OR ledger_transaction_id IS NOT NULL
  ),
  CONSTRAINT financial_provider_interpretations_decision_audit CHECK (
    (status NOT IN ('confirmed', 'rejected') OR decided_at IS NOT NULL)
    AND (status <> 'undone' OR undone_at IS NOT NULL)
    AND (source <> 'owner' OR status NOT IN ('confirmed', 'rejected') OR decided_by IS NOT NULL)
  )
);

-- At most one ACTIVE (suggested or confirmed) interpretation per provider transaction and kind.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_interpretations_active_kind
  ON public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind)
  WHERE status IN ('suggested', 'confirmed');
-- A canonical ledger row is the confirmed match of at most one provider transaction: with the existing ledger source
-- uniqueness this keeps provider transaction <-> financial transaction strictly one-to-one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_interpretations_confirmed_ledger_match
  ON public.financial_provider_interpretations (organization_id, ledger_transaction_id)
  WHERE kind = 'ledger_match' AND status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_financial_provider_items_org ON public.financial_provider_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_financial_provider_accounts_org_item ON public.financial_provider_accounts (organization_id, provider_item_ref);
CREATE INDEX IF NOT EXISTS idx_financial_provider_transactions_org_account_date
  ON public.financial_provider_transactions (organization_id, provider_account_ref, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_provider_transactions_pending
  ON public.financial_provider_transactions (organization_id, provider_account_ref) WHERE pending AND removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_financial_provider_snapshots_account_observed
  ON public.financial_provider_balance_snapshots (provider_account_ref, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_provider_interpretations_tx
  ON public.financial_provider_interpretations (organization_id, provider_transaction_ref);
CREATE INDEX IF NOT EXISTS idx_financial_provider_interpretations_status
  ON public.financial_provider_interpretations (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_financial_provider_webhooks_item
  ON public.financial_provider_webhook_events (organization_id, provider_item_ref, first_received_at DESC);

-- ── Guards ────────────────────────────────────────────────────────────────────────────────────────────────
-- Generic immutability: TG_ARGV lists the columns that may never change after insert.
CREATE OR REPLACE FUNCTION public.financial_provider_enforce_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  i INTEGER;
  v_old JSONB := to_jsonb(OLD);
  v_new JSONB := to_jsonb(NEW);
BEGIN
  FOR i IN 0 .. TG_NARGS - 1 LOOP
    IF v_old -> TG_ARGV[i] IS DISTINCT FROM v_new -> TG_ARGV[i] THEN
      RAISE EXCEPTION '% is immutable on %', TG_ARGV[i], TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_block_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; insert a new row instead', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_validate_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_financial_status TEXT;
  v_provider_status TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'inactive' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'An inactive account mapping cannot be reactivated; create a new mapping' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'active' AND NEW.status = 'inactive' THEN
      NEW.deactivated_at := coalesce(NEW.deactivated_at, now());
      IF auth.uid() IS NOT NULL THEN NEW.deactivated_by := auth.uid(); END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'active' THEN
    RAISE EXCEPTION 'A new account mapping must be active' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO v_financial_status FROM public.financial_accounts
    WHERE id = NEW.financial_account_id AND organization_id = NEW.organization_id;
  IF v_financial_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'The Cash OS account must exist in this organization and be active' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO v_provider_status FROM public.financial_provider_accounts
    WHERE id = NEW.provider_account_ref AND organization_id = NEW.organization_id;
  IF v_provider_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'The provider account must exist in this organization and be active' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_validate_interpretation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_changed BOOLEAN := (TG_OP = 'INSERT');
  v_removed_at TIMESTAMPTZ;
  v_pending BOOLEAN;
  v_source_type TEXT;
  v_source_kind TEXT;
  v_source_record TEXT;
  v_class TEXT;
  v_link_org UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'undone' THEN
      RAISE EXCEPTION 'An interpretation cannot be created already undone' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    v_changed := OLD.status IS DISTINCT FROM NEW.status;
    IF v_changed AND NOT (
         (OLD.status = 'suggested' AND NEW.status IN ('confirmed', 'rejected', 'undone'))
      OR (OLD.status = 'confirmed' AND NEW.status = 'undone')
    ) THEN
      RAISE EXCEPTION 'Invalid interpretation transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Audit stamping. A browser caller's identity always wins over any value it supplied.
  IF v_changed AND NEW.status IN ('confirmed', 'rejected') THEN
    NEW.decided_at := coalesce(NEW.decided_at, now());
    IF auth.uid() IS NOT NULL THEN NEW.decided_by := auth.uid(); END IF;
  END IF;
  IF v_changed AND NEW.status = 'undone' THEN
    NEW.undone_at := coalesce(NEW.undone_at, now());
    IF auth.uid() IS NOT NULL THEN NEW.undone_by := auth.uid(); END IF;
  END IF;

  -- Structural integrity of the targets (all statuses).
  IF NEW.debt_account_id IS NOT NULL THEN
    SELECT account_class INTO v_class FROM public.financial_accounts
      WHERE id = NEW.debt_account_id AND organization_id = NEW.organization_id;
    IF v_class IS DISTINCT FROM 'liability' THEN
      RAISE EXCEPTION 'A debt interpretation must point at a liability account' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.transaction_link_id IS NOT NULL THEN
    SELECT organization_id INTO v_link_org FROM public.financial_transaction_links WHERE id = NEW.transaction_link_id;
    IF v_link_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'The transaction link belongs to a different organization' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Confirmation rules (only at the moment of confirming).
  IF v_changed AND NEW.status = 'confirmed' THEN
    SELECT removed_at, pending INTO v_removed_at, v_pending FROM public.financial_provider_transactions
      WHERE id = NEW.provider_transaction_ref AND organization_id = NEW.organization_id;
    IF v_removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'A removed provider transaction cannot be confirmed' USING ERRCODE = 'check_violation';
    END IF;
    IF v_pending AND NEW.kind NOT IN ('category', 'ignored') THEN
      RAISE EXCEPTION 'A pending provider transaction can only be categorized or ignored' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.ledger_transaction_id IS NOT NULL THEN
      SELECT source_type, source_kind, source_record_id INTO v_source_type, v_source_kind, v_source_record
        FROM public.financial_transactions
        WHERE id = NEW.ledger_transaction_id AND organization_id = NEW.organization_id;
      IF NEW.kind = 'ledger_match' AND NEW.match_mode = 'adopted' THEN
        IF v_source_type IS DISTINCT FROM 'future_provider'
           OR v_source_kind IS DISTINCT FROM 'provider_transaction'
           OR v_source_record IS DISTINCT FROM NEW.provider_transaction_ref::TEXT THEN
          RAISE EXCEPTION 'An adopted ledger row must carry this provider transaction as its source identity' USING ERRCODE = 'check_violation';
        END IF;
      ELSIF v_source_kind = 'provider_transaction' AND v_source_record IS DISTINCT FROM NEW.provider_transaction_ref::TEXT THEN
        RAISE EXCEPTION 'That ledger row already represents a different provider transaction' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Triggers (drop-guarded so the migration is re-runnable) ─────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_fpi_00_immutable ON public.financial_provider_items;
CREATE TRIGGER trg_fpi_00_immutable BEFORE UPDATE ON public.financial_provider_items
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable('organization_id', 'provider', 'provider_item_id', 'created_at', 'created_by');
DROP TRIGGER IF EXISTS trg_fpi_90_updated_at ON public.financial_provider_items;
CREATE TRIGGER trg_fpi_90_updated_at BEFORE UPDATE ON public.financial_provider_items
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

DROP TRIGGER IF EXISTS trg_fpa_00_immutable ON public.financial_provider_accounts;
CREATE TRIGGER trg_fpa_00_immutable BEFORE UPDATE ON public.financial_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable('organization_id', 'provider_item_ref', 'provider_account_id', 'created_at');
DROP TRIGGER IF EXISTS trg_fpa_90_updated_at ON public.financial_provider_accounts;
CREATE TRIGGER trg_fpa_90_updated_at BEFORE UPDATE ON public.financial_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

DROP TRIGGER IF EXISTS trg_fpm_00_immutable ON public.financial_provider_account_mappings;
CREATE TRIGGER trg_fpm_00_immutable BEFORE UPDATE ON public.financial_provider_account_mappings
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable(
    'organization_id', 'provider_account_ref', 'financial_account_id', 'mapped_by', 'mapped_at', 'created_at');
DROP TRIGGER IF EXISTS trg_fpm_10_validate ON public.financial_provider_account_mappings;
CREATE TRIGGER trg_fpm_10_validate BEFORE INSERT OR UPDATE ON public.financial_provider_account_mappings
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_validate_mapping();
DROP TRIGGER IF EXISTS trg_fpm_90_updated_at ON public.financial_provider_account_mappings;
CREATE TRIGGER trg_fpm_90_updated_at BEFORE UPDATE ON public.financial_provider_account_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

DROP TRIGGER IF EXISTS trg_fpt_00_immutable ON public.financial_provider_transactions;
CREATE TRIGGER trg_fpt_00_immutable BEFORE UPDATE ON public.financial_provider_transactions
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable(
    'organization_id', 'provider_item_ref', 'provider_account_ref', 'provider_transaction_id', 'first_seen_at', 'created_at');
DROP TRIGGER IF EXISTS trg_fpt_90_updated_at ON public.financial_provider_transactions;
CREATE TRIGGER trg_fpt_90_updated_at BEFORE UPDATE ON public.financial_provider_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

DROP TRIGGER IF EXISTS trg_fps_00_append_only ON public.financial_provider_balance_snapshots;
CREATE TRIGGER trg_fps_00_append_only BEFORE UPDATE ON public.financial_provider_balance_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_block_update();

DROP TRIGGER IF EXISTS trg_fpw_00_immutable ON public.financial_provider_webhook_events;
CREATE TRIGGER trg_fpw_00_immutable BEFORE UPDATE ON public.financial_provider_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable(
    'organization_id', 'provider_item_ref', 'provider', 'event_key', 'first_received_at', 'created_at');
DROP TRIGGER IF EXISTS trg_fpw_90_updated_at ON public.financial_provider_webhook_events;
CREATE TRIGGER trg_fpw_90_updated_at BEFORE UPDATE ON public.financial_provider_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

DROP TRIGGER IF EXISTS trg_fpx_00_immutable ON public.financial_provider_interpretations;
CREATE TRIGGER trg_fpx_00_immutable BEFORE UPDATE ON public.financial_provider_interpretations
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable(
    'organization_id', 'provider_transaction_ref', 'kind', 'source', 'ledger_transaction_id', 'match_mode', 'category',
    'obligation_occurrence_id', 'cash_commitment_id', 'transaction_link_id', 'counterpart_provider_transaction_ref',
    'debt_account_id', 'project_id', 'created_by', 'created_at');
DROP TRIGGER IF EXISTS trg_fpx_10_validate ON public.financial_provider_interpretations;
CREATE TRIGGER trg_fpx_10_validate BEFORE INSERT OR UPDATE ON public.financial_provider_interpretations
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_validate_interpretation();
DROP TRIGGER IF EXISTS trg_fpx_90_updated_at ON public.financial_provider_interpretations;
CREATE TRIGGER trg_fpx_90_updated_at BEFORE UPDATE ON public.financial_provider_interpretations
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

-- ── Row level security ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.financial_provider_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_balance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_interpretations ENABLE ROW LEVEL SECURITY;

-- Server-only tables (items, webhook events) deliberately have NO policy: only the service role may touch them.

DROP POLICY IF EXISTS financial_provider_accounts_owner_admin_select ON public.financial_provider_accounts;
CREATE POLICY financial_provider_accounts_owner_admin_select ON public.financial_provider_accounts FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

DROP POLICY IF EXISTS financial_provider_mappings_owner_admin_select ON public.financial_provider_account_mappings;
CREATE POLICY financial_provider_mappings_owner_admin_select ON public.financial_provider_account_mappings FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
DROP POLICY IF EXISTS financial_provider_mappings_owner_admin_insert ON public.financial_provider_account_mappings;
CREATE POLICY financial_provider_mappings_owner_admin_insert ON public.financial_provider_account_mappings FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id) AND mapped_by = auth.uid());
DROP POLICY IF EXISTS financial_provider_mappings_owner_admin_update ON public.financial_provider_account_mappings;
CREATE POLICY financial_provider_mappings_owner_admin_update ON public.financial_provider_account_mappings FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

DROP POLICY IF EXISTS financial_provider_transactions_owner_admin_select ON public.financial_provider_transactions;
CREATE POLICY financial_provider_transactions_owner_admin_select ON public.financial_provider_transactions FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

DROP POLICY IF EXISTS financial_provider_snapshots_owner_admin_select ON public.financial_provider_balance_snapshots;
CREATE POLICY financial_provider_snapshots_owner_admin_select ON public.financial_provider_balance_snapshots FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

DROP POLICY IF EXISTS financial_provider_interpretations_owner_admin_select ON public.financial_provider_interpretations;
CREATE POLICY financial_provider_interpretations_owner_admin_select ON public.financial_provider_interpretations FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
DROP POLICY IF EXISTS financial_provider_interpretations_owner_admin_insert ON public.financial_provider_interpretations;
CREATE POLICY financial_provider_interpretations_owner_admin_insert ON public.financial_provider_interpretations FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id) AND source = 'owner');
DROP POLICY IF EXISTS financial_provider_interpretations_owner_admin_update ON public.financial_provider_interpretations;
CREATE POLICY financial_provider_interpretations_owner_admin_update ON public.financial_provider_interpretations FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

-- ── Grants: least privilege. Nothing for PUBLIC or anon. ──────────────────────────────────────────────────
REVOKE ALL ON public.financial_provider_items,
              public.financial_provider_accounts,
              public.financial_provider_account_mappings,
              public.financial_provider_transactions,
              public.financial_provider_balance_snapshots,
              public.financial_provider_webhook_events,
              public.financial_provider_interpretations
  FROM PUBLIC, anon, authenticated;

-- Browser-readable evidence (needed later for the owner review screens). Writes are server-only.
GRANT SELECT ON public.financial_provider_accounts, public.financial_provider_transactions,
                public.financial_provider_balance_snapshots TO authenticated;
-- Owner-controlled tables.
GRANT SELECT, INSERT, UPDATE ON public.financial_provider_account_mappings, public.financial_provider_interpretations TO authenticated;

REVOKE ALL ON FUNCTION public.financial_provider_enforce_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_block_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_validate_mapping() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_validate_interpretation() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.financial_provider_items IS
  'SERVER-ONLY provider connection (one per provider item). Holds the sync cursor and diagnostics. No token/secret column exists by design; token storage is a separate, encrypted, server-only structure (BANK-2).';
COMMENT ON TABLE public.financial_provider_accounts IS
  'Provider account evidence. Identity is the provider account id, never the name or mask. Browser read-only; server writes.';
COMMENT ON TABLE public.financial_provider_account_mappings IS
  'Owner-controlled link between a provider account and an existing Cash OS financial account. Provider data can never change the Cash OS account (include_in_cash, class, type).';
COMMENT ON TABLE public.financial_provider_transactions IS
  'RAW provider evidence of a transaction (what the provider told us). NOT the ledger and NOT business meaning. provider_amount keeps the provider sign convention; Cash OS sign is derived later per account class. Browser read-only; server writes.';
COMMENT ON TABLE public.financial_provider_balance_snapshots IS
  'Append-only provider-reported balances. Evidence for reconciliation; never overwrites ledger-derived balances.';
COMMENT ON TABLE public.financial_provider_webhook_events IS
  'SERVER-ONLY webhook idempotency record. event_key is a generic idempotency key (semantics defined when the webhook endpoint is built).';
COMMENT ON TABLE public.financial_provider_interpretations IS
  'Owner-controlled, reversible meaning of a provider transaction (match, category, transfer, obligation, project, debt, payroll, ignored). Raw evidence is never modified; undo changes only this row''s status.';
COMMENT ON COLUMN public.financial_provider_transactions.raw_payload IS
  'Evidence only. Never business truth, never queried as the financial model, and must not contain credentials (enforced for top-level keys).';

COMMIT;
