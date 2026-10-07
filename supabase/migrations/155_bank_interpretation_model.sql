-- BANK-5: make financial_provider_interpretations able to hold the three-dimension interpretation model WITHOUT touching canonical truth.
--
--   ECONOMIC BUCKET  -> kind 'category'   (category = bucket key, evolvable TEXT)               [already supported by 153]
--   RELATIONSHIP     -> kind 'obligation' | 'project' | 'debt' | 'payroll' | 'transfer'         [153]
--                       + 'overhead' | 'personal'                                              [NEW here]
--   REVIEW STATE     -> status suggested/confirmed/rejected/undone, plus kind 'ignored'         [153]
--   CONFIDENCE       -> confidence high/possible/low (independent of review state)             [153]
--
-- Why a migration is required (each point proven against 153 on a real database in the BANK-5 tests):
--   1. A confirmed relationship interpretation was IMPOSSIBLE: CHECK confirmed_needs_ledger demanded a canonical ledger row for every
--      confirmed kind except category/ignored. BANK-5 deliberately confirms interpretations WITHOUT any canonical adoption (that is BANK-6).
--   2. A recurring obligation could not be referenced: only a materialized occurrence row or a commitment could be targeted, and
--      occurrences are virtual until a reconciliation (a canonical write) materializes them. BANK-5 must never materialize one.
--   3. 'General overhead' and 'Personal' relationships had no kind; without them the owner cannot say "this is reviewed overhead".
--   4. A transfer interpretation required an already-paired counterpart or link; the owner may confirm a transfer to an account that
--      is not connected, and BANK-5 never pairs or canonicalizes transfers.
--   5. Nothing stopped a provider transaction from holding TWO active relationships at once (the 153 index is per kind).
--   6. Changing an owner decision was two application writes (undo, then insert) with a best-effort restore. BANK-5 is the durable layer
--      BANK-6 may consume, so replacement is now ONE database function (financial_provider_replace_interpretation): it either completes
--      entirely or changes nothing, and the table's own constraints stay authoritative.
--
-- PERMANENT CONTRACT (also in COMMENTs below and in src/services/bankProvider/spending/contract.ts):
--   status = 'confirmed' means ONLY "the owner confirmed this interpretation of provider evidence". It never means a ledger transaction
--   exists, a bill/debt/payroll was paid, a project payment was received, a transfer was reconciled, or the evidence was adopted into
--   canonical Cash OS truth. Canonical adoption/reconciliation (BANK-6) must be a separate, explicit operation with its own reference;
--   the only interpretation that carries a ledger reference today is kind 'ledger_match', whose ledger_transaction_id is required by the
--   existing schema rules. Nothing in BANK-5 creates one.
--
-- What this does NOT do: it adds no column that can carry money and no trigger that writes canonical tables. Its ONLY grant is EXECUTE on the
-- one function below, to service_role. Interpretations remain evidence about evidence. Provider evidence rows, the ledger, accounts,
-- obligations, projects, debt and payroll are not touched. RLS policies and table grants from 153 are unchanged. Production holds no
-- interpretation rows, so every changed constraint is trivially satisfiable.
--
-- Rollback (before any decision uses the new kinds/column): drop the function and the two new indexes, drop obligation_id, then restore
-- 153's kind_check / kind_targets / confirmed_needs_ledger definitions. This whole file runs in ONE transaction, so a failed apply leaves
-- the database exactly as it was.
--
-- Safe to re-run (drop-guarded / IF NOT EXISTS). Apply ONLY with the reviewed single-file procedure (BANK-0A). Never via `supabase db push`.
-- Do not modify migrations 153/154.
BEGIN;

-- ── 1. Recurring-obligation reference that does not require a materialized occurrence ───────────────────────────
ALTER TABLE public.financial_provider_interpretations ADD COLUMN IF NOT EXISTS obligation_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_provider_interpretations_obligation_fk') THEN
    ALTER TABLE public.financial_provider_interpretations
      ADD CONSTRAINT financial_provider_interpretations_obligation_fk
      FOREIGN KEY (obligation_id, organization_id)
      REFERENCES public.financial_obligations(id, organization_id) ON DELETE RESTRICT;
  END IF;
END
$$;

-- ── 2. Kinds: add the two relationship kinds the owner needs to finish a review ──────────────────────────────────
ALTER TABLE public.financial_provider_interpretations DROP CONSTRAINT IF EXISTS financial_provider_interpretations_kind_check;
ALTER TABLE public.financial_provider_interpretations
  ADD CONSTRAINT financial_provider_interpretations_kind_check
  CHECK (kind IN ('ledger_match', 'category', 'transfer', 'obligation', 'project', 'debt', 'payroll', 'ignored', 'overhead', 'personal'));

-- ── 3. Target shape per kind (153's rules, plus obligation_id, and no pairing requirement for transfers) ──────────
ALTER TABLE public.financial_provider_interpretations DROP CONSTRAINT IF EXISTS financial_provider_interpretations_kind_targets;
ALTER TABLE public.financial_provider_interpretations
  ADD CONSTRAINT financial_provider_interpretations_kind_targets CHECK (
    (kind = 'ledger_match' AND ledger_transaction_id IS NOT NULL AND match_mode IS NOT NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND obligation_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
    OR (kind = 'category' AND category IS NOT NULL AND match_mode IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND obligation_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
    -- transfer: the owner's statement "this is a transfer". A counterpart / link is OPTIONAL evidence; nothing is paired or canonicalized here.
    OR (kind = 'transfer' AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND obligation_id IS NULL
       AND debt_account_id IS NULL AND project_id IS NULL)
    OR (kind = 'obligation' AND num_nonnulls(obligation_occurrence_id, cash_commitment_id, obligation_id) = 1
       AND match_mode IS NULL AND category IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
    OR (kind = 'debt' AND debt_account_id IS NOT NULL AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND obligation_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND project_id IS NULL)
    OR (kind = 'project' AND project_id IS NOT NULL AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND obligation_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL)
    OR (kind IN ('payroll', 'ignored', 'overhead', 'personal') AND match_mode IS NULL AND category IS NULL
       AND obligation_occurrence_id IS NULL AND cash_commitment_id IS NULL AND obligation_id IS NULL AND transaction_link_id IS NULL
       AND counterpart_provider_transaction_ref IS NULL AND debt_account_id IS NULL AND project_id IS NULL)
  );

-- ── 4. Confirmation no longer implies a canonical ledger row, EXCEPT for a ledger match (which is the ledger link by definition) ──
ALTER TABLE public.financial_provider_interpretations DROP CONSTRAINT IF EXISTS financial_provider_interpretations_confirmed_needs_ledger;
ALTER TABLE public.financial_provider_interpretations
  ADD CONSTRAINT financial_provider_interpretations_confirmed_needs_ledger CHECK (
    status <> 'confirmed' OR kind <> 'ledger_match' OR ledger_transaction_id IS NOT NULL
  );

-- ── 5. obligation_id is as immutable as every other target ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_fpx_00_immutable ON public.financial_provider_interpretations;
CREATE TRIGGER trg_fpx_00_immutable BEFORE UPDATE ON public.financial_provider_interpretations
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable(
    'organization_id', 'provider_transaction_ref', 'kind', 'source', 'ledger_transaction_id', 'match_mode', 'category',
    'obligation_occurrence_id', 'cash_commitment_id', 'obligation_id', 'transaction_link_id', 'counterpart_provider_transaction_ref',
    'debt_account_id', 'project_id', 'created_by', 'created_at');

-- ── 6. One ACTIVE relationship per provider transaction, across relationship kinds ───────────────────────────────
-- (153 only had one active row per transaction AND kind, so a transaction could be "project" and "obligation" at once.)
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_interpretations_active_relationship
  ON public.financial_provider_interpretations (organization_id, provider_transaction_ref)
  WHERE status IN ('suggested', 'confirmed')
    AND kind IN ('transfer', 'obligation', 'project', 'debt', 'payroll', 'overhead', 'personal');

CREATE INDEX IF NOT EXISTS idx_financial_provider_interpretations_obligation
  ON public.financial_provider_interpretations (organization_id, obligation_id) WHERE obligation_id IS NOT NULL;

-- ── 7. Atomic owner-decision replacement ──────────────────────────────────────────────────────────────────────────
-- ONE call = ONE transaction. It locks the provider transaction row (which also proves the row belongs to the organization), validates
-- every referenced target inside that organization, retires the active decision of the same dimension as audit history ('undone', with
-- who/when/why), and inserts the new confirmed decision. If ANY step raises, the whole call rolls back and nothing has changed. Every
-- table constraint and trigger (immutable targets, one active relationship, pending rule, org-scoped foreign keys) still applies to the
-- insert: this function adds checks, it cannot bypass any.
--
-- Security model (same convention as migration 154): SECURITY INVOKER with a fixed search_path; EXECUTE is revoked from PUBLIC/anon/
-- authenticated and granted to service_role only. The organization and actor are supplied by the trusted server (derived from the
-- authenticated profile, never from the browser); the function re-validates that every id it touches belongs to that organization.
-- A browser role cannot call it. It never creates a 'ledger_match' and never reads or writes a canonical financial table.
CREATE OR REPLACE FUNCTION public.financial_provider_replace_interpretation(
  p_organization_id UUID,
  p_actor UUID,
  p_provider_transaction_ref UUID,
  p_dimension TEXT,
  p_kind TEXT,
  p_source TEXT,
  p_confidence TEXT,
  p_suggestion_basis JSONB DEFAULT '{}'::jsonb,
  p_category TEXT DEFAULT NULL,
  p_project_id TEXT DEFAULT NULL,
  p_obligation_id UUID DEFAULT NULL,
  p_commitment_id UUID DEFAULT NULL,
  p_debt_account_id UUID DEFAULT NULL,
  p_counterpart_provider_transaction_ref UUID DEFAULT NULL,
  p_undo_reason TEXT DEFAULT 'changed_by_owner'
)
RETURNS TABLE(outcome TEXT, interpretation_id UUID, replaced_id UUID)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tx RECORD;
  v_existing RECORD;
  v_kinds TEXT[];
  v_new UUID;
  v_replaced UUID;
  v_ok BOOLEAN;
BEGIN
  IF p_organization_id IS NULL OR p_actor IS NULL OR p_provider_transaction_ref IS NULL THEN
    RAISE EXCEPTION 'INTERPRETATION_ARGUMENTS_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_source NOT IN ('owner', 'rule') OR p_confidence NOT IN ('high', 'possible', 'low')
     OR p_suggestion_basis IS NULL OR jsonb_typeof(p_suggestion_basis) <> 'object' THEN
    RAISE EXCEPTION 'INTERPRETATION_ARGUMENTS_INVALID' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_dimension = 'bucket' AND p_kind = 'category' THEN
    v_kinds := ARRAY['category'];
  ELSIF p_dimension = 'ignore' AND p_kind = 'ignored' THEN
    v_kinds := ARRAY['ignored'];
  ELSIF p_dimension = 'relationship' AND p_kind IN ('transfer', 'obligation', 'project', 'debt', 'payroll', 'overhead', 'personal') THEN
    v_kinds := ARRAY['transfer', 'obligation', 'project', 'debt', 'payroll', 'overhead', 'personal'];
  ELSE
    -- includes 'ledger_match': an interpretation that carries a ledger reference is NEVER created by this function
    RAISE EXCEPTION 'INTERPRETATION_DIMENSION_INVALID' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock the evidence row first: concurrent decisions on one transaction are serialized here, and a row of another organization is "not found".
  SELECT id, pending, removed_at INTO v_tx
    FROM public.financial_provider_transactions
    WHERE id = p_provider_transaction_ref AND organization_id = p_organization_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INTERPRETATION_TRANSACTION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_tx.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'INTERPRETATION_TRANSACTION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_tx.pending AND p_dimension = 'relationship' THEN
    RAISE EXCEPTION 'INTERPRETATION_PENDING_RELATIONSHIP' USING ERRCODE = 'check_violation';
  END IF;

  -- Every referenced target must exist INSIDE this organization (and be usable). The foreign keys re-check organization on insert.
  IF p_obligation_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.financial_obligations WHERE id = p_obligation_id AND organization_id = p_organization_id AND status = 'active') INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'INTERPRETATION_TARGET_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  END IF;
  IF p_commitment_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.cash_commitments WHERE id = p_commitment_id AND organization_id = p_organization_id AND status = 'scheduled') INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'INTERPRETATION_TARGET_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  END IF;
  IF p_debt_account_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.financial_accounts WHERE id = p_debt_account_id AND organization_id = p_organization_id AND account_class = 'liability' AND status = 'active') INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'INTERPRETATION_TARGET_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  END IF;
  IF p_counterpart_provider_transaction_ref IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.financial_provider_transactions
                   WHERE id = p_counterpart_provider_transaction_ref AND organization_id = p_organization_id
                     AND removed_at IS NULL AND id <> p_provider_transaction_ref) INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'INTERPRETATION_TARGET_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  END IF;
  IF p_project_id IS NOT NULL THEN
    -- projects live in the legacy `projects` table and have no foreign key from here, so the function is the enforcement point
    IF to_regclass('public.projects') IS NULL THEN
      RAISE EXCEPTION 'INTERPRETATION_TARGET_NOT_FOUND' USING ERRCODE = 'no_data_found';
    END IF;
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.projects WHERE id::text = $1 AND org_id = $2)' INTO v_ok USING p_project_id, p_organization_id;
    IF NOT v_ok THEN RAISE EXCEPTION 'INTERPRETATION_TARGET_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  END IF;

  -- The active decision of this dimension (at most one: the table's partial unique indexes guarantee it). Locked for the swap.
  FOR v_existing IN
    SELECT * FROM public.financial_provider_interpretations
      WHERE organization_id = p_organization_id AND provider_transaction_ref = p_provider_transaction_ref
        AND status IN ('suggested', 'confirmed') AND kind = ANY (v_kinds)
      ORDER BY created_at, id
      FOR UPDATE
  LOOP
    IF v_existing.status = 'confirmed' AND v_existing.kind = p_kind
       AND v_existing.category IS NOT DISTINCT FROM p_category
       AND v_existing.project_id IS NOT DISTINCT FROM p_project_id
       AND v_existing.obligation_id IS NOT DISTINCT FROM p_obligation_id
       AND v_existing.cash_commitment_id IS NOT DISTINCT FROM p_commitment_id
       AND v_existing.debt_account_id IS NOT DISTINCT FROM p_debt_account_id
       AND v_existing.counterpart_provider_transaction_ref IS NOT DISTINCT FROM p_counterpart_provider_transaction_ref THEN
      RETURN QUERY SELECT 'unchanged'::TEXT, v_existing.id, NULL::UUID; -- already exactly this decision: nothing to do
      RETURN;
    END IF;
    UPDATE public.financial_provider_interpretations
      SET status = 'undone', undone_by = p_actor, undone_at = now(), undo_reason = left(coalesce(p_undo_reason, 'changed_by_owner'), 120)
      WHERE id = v_existing.id;
    v_replaced := v_existing.id;
  END LOOP;

  INSERT INTO public.financial_provider_interpretations (
    organization_id, provider_transaction_ref, kind, status, source, confidence, suggestion_basis,
    category, project_id, obligation_id, cash_commitment_id, debt_account_id, counterpart_provider_transaction_ref,
    decided_by, decided_at, created_by)
  VALUES (
    p_organization_id, p_provider_transaction_ref, p_kind, 'confirmed', p_source, p_confidence, p_suggestion_basis,
    p_category, p_project_id, p_obligation_id, p_commitment_id, p_debt_account_id, p_counterpart_provider_transaction_ref,
    p_actor, now(), p_actor)
  RETURNING id INTO v_new;

  RETURN QUERY SELECT (CASE WHEN v_replaced IS NULL THEN 'created' ELSE 'changed' END)::TEXT, v_new, v_replaced;
END;
$$;

REVOKE ALL ON FUNCTION public.financial_provider_replace_interpretation(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_replace_interpretation(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.financial_provider_replace_interpretation(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT) IS
  'BANK-5 atomic owner-decision replacement (service_role only). One transaction: validate, retire the previous active decision as audit history, insert the new confirmed decision. All-or-nothing. Never creates a ledger_match and never touches a canonical financial table.';

COMMENT ON COLUMN public.financial_provider_interpretations.status IS
  'CONTRACT: confirmed means ONLY that the owner confirmed this INTERPRETATION of provider evidence. It never means a ledger transaction exists, a bill/debt/payroll was paid, a project payment was received, a transfer was reconciled, or the evidence was adopted into canonical truth. Canonical adoption (BANK-6) must be a separate explicit operation with its own reference; the only kind that carries a ledger reference is ledger_match.';

COMMENT ON COLUMN public.financial_provider_interpretations.obligation_id IS
  'BANK-5: the recurring obligation an owner says a provider transaction belongs to. Interpretation only: it never materializes an occurrence or reconciles anything.';
COMMENT ON TABLE public.financial_provider_interpretations IS
  'Owner-controlled, reversible meaning of a provider transaction: ECONOMIC BUCKET (kind category), RELATIONSHIP (obligation/project/debt/payroll/transfer/overhead/personal), review state (status, and kind ignored). Raw evidence is never modified; undo changes only this row''s status. Confirming an interpretation changes NO canonical financial truth (BANK-6 decides adoption).';

COMMIT;
