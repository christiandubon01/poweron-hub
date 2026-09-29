-- CASH-3: dated obligations + one-time cash commitments.
-- Planned future outflows stay separate from actual CASH-2 ledger truth.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  category TEXT,
  amount_type TEXT NOT NULL CHECK (amount_type IN ('fixed','estimated')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  estimated_min_minor BIGINT CHECK (estimated_min_minor IS NULL OR estimated_min_minor >= 0),
  estimated_max_minor BIGINT CHECK (estimated_max_minor IS NULL OR estimated_max_minor >= 0),
  recurrence_kind TEXT NOT NULL CHECK (recurrence_kind IN ('weekly','every_n_weeks','monthly','yearly')),
  recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval > 0),
  anchor_date DATE NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE,
  is_required BOOLEAN NOT NULL DEFAULT true,
  confidence TEXT NOT NULL DEFAULT 'expected' CHECK (confidence IN ('confirmed','expected','possible')),
  account_id UUID,
  debt_account_id UUID,
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','canceled','archived')),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','owner_reviewed_overhead')),
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT financial_obligations_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_obligations_date_order CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT financial_obligations_estimate_range CHECK (
    amount_type = 'fixed'
    OR (
      (estimated_min_minor IS NULL OR estimated_min_minor <= amount_minor)
      AND (estimated_max_minor IS NULL OR estimated_max_minor >= amount_minor)
      AND (estimated_min_minor IS NULL OR estimated_max_minor IS NULL OR estimated_min_minor <= estimated_max_minor)
    )
  ),
  CONSTRAINT financial_obligations_account_org_fk
    FOREIGN KEY (account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_obligations_debt_org_fk
    FOREIGN KEY (debt_account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.financial_obligation_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  obligation_id UUID NOT NULL,
  scheduled_date DATE NOT NULL,
  override_date DATE,
  override_amount_minor BIGINT CHECK (override_amount_minor IS NULL OR override_amount_minor > 0),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','satisfied','skipped','canceled')),
  reason TEXT,
  reconciliation_state TEXT NOT NULL DEFAULT 'unreconciled' CHECK (reconciliation_state IN ('unreconciled','reconciled')),
  actual_transaction_id UUID,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_obligation_occurrences_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_occurrence_obligation_org_fk
    FOREIGN KEY (obligation_id, organization_id)
    REFERENCES public.financial_obligations(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT financial_occurrence_actual_tx_org_fk
    FOREIGN KEY (actual_transaction_id, organization_id)
    REFERENCES public.financial_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_occurrence_unique UNIQUE (organization_id, obligation_id, scheduled_date),
  CONSTRAINT financial_occurrence_reconciliation_shape CHECK (
    (reconciliation_state = 'unreconciled' AND actual_transaction_id IS NULL AND status <> 'satisfied')
    OR
    (reconciliation_state = 'reconciled' AND actual_transaction_id IS NOT NULL AND status = 'satisfied')
  )
);

CREATE TABLE IF NOT EXISTS public.cash_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  expected_date DATE NOT NULL,
  amount_type TEXT NOT NULL CHECK (amount_type IN ('fixed','estimated')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  estimated_min_minor BIGINT CHECK (estimated_min_minor IS NULL OR estimated_min_minor >= 0),
  estimated_max_minor BIGINT CHECK (estimated_max_minor IS NULL OR estimated_max_minor >= 0),
  is_required BOOLEAN NOT NULL DEFAULT true,
  confidence TEXT NOT NULL DEFAULT 'expected' CHECK (confidence IN ('confirmed','expected','possible')),
  category TEXT,
  account_id UUID,
  project_id TEXT,
  employee_id TEXT,
  debt_account_id UUID,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','satisfied','skipped','canceled')),
  reconciliation_state TEXT NOT NULL DEFAULT 'unreconciled' CHECK (reconciliation_state IN ('unreconciled','reconciled')),
  actual_transaction_id UUID,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual')),
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_commitments_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT cash_commitments_estimate_range CHECK (
    amount_type = 'fixed'
    OR (
      (estimated_min_minor IS NULL OR estimated_min_minor <= amount_minor)
      AND (estimated_max_minor IS NULL OR estimated_max_minor >= amount_minor)
      AND (estimated_min_minor IS NULL OR estimated_max_minor IS NULL OR estimated_min_minor <= estimated_max_minor)
    )
  ),
  CONSTRAINT cash_commitments_account_org_fk
    FOREIGN KEY (account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT cash_commitments_debt_org_fk
    FOREIGN KEY (debt_account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT cash_commitments_actual_tx_org_fk
    FOREIGN KEY (actual_transaction_id, organization_id)
    REFERENCES public.financial_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT cash_commitments_reconciliation_shape CHECK (
    (reconciliation_state = 'unreconciled' AND actual_transaction_id IS NULL AND status <> 'satisfied')
    OR
    (reconciliation_state = 'reconciled' AND actual_transaction_id IS NOT NULL AND status = 'satisfied')
  )
);

CREATE TABLE IF NOT EXISTS public.financial_planned_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  occurrence_id UUID,
  commitment_id UUID,
  transaction_id UUID NOT NULL,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  CONSTRAINT financial_planned_reconciliations_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_planned_exactly_one_source CHECK (
    (occurrence_id IS NOT NULL AND commitment_id IS NULL)
    OR
    (occurrence_id IS NULL AND commitment_id IS NOT NULL)
  ),
  CONSTRAINT financial_planned_occurrence_org_fk
    FOREIGN KEY (occurrence_id, organization_id)
    REFERENCES public.financial_obligation_occurrences(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_planned_commitment_org_fk
    FOREIGN KEY (commitment_id, organization_id)
    REFERENCES public.cash_commitments(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_planned_transaction_org_fk
    FOREIGN KEY (transaction_id, organization_id)
    REFERENCES public.financial_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_planned_one_actual_transaction UNIQUE (organization_id, transaction_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_planned_occurrence
  ON public.financial_planned_reconciliations (organization_id, occurrence_id)
  WHERE occurrence_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_planned_commitment
  ON public.financial_planned_reconciliations (organization_id, commitment_id)
  WHERE commitment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_financial_obligations_org_status
  ON public.financial_obligations (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_financial_occurrences_org_date
  ON public.financial_obligation_occurrences (organization_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_cash_commitments_org_date
  ON public.cash_commitments (organization_id, expected_date);
CREATE INDEX IF NOT EXISTS idx_financial_planned_reconciliations_org
  ON public.financial_planned_reconciliations (organization_id);

CREATE TRIGGER trg_financial_obligations_updated_at
  BEFORE UPDATE ON public.financial_obligations
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();
CREATE TRIGGER trg_financial_obligation_occurrences_updated_at
  BEFORE UPDATE ON public.financial_obligation_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();
CREATE TRIGGER trg_cash_commitments_updated_at
  BEFORE UPDATE ON public.cash_commitments
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

CREATE OR REPLACE FUNCTION public.guard_planned_satisfied_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_transaction_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'financial_obligation_occurrences' THEN
    SELECT r.transaction_id INTO v_transaction_id
    FROM public.financial_planned_reconciliations r
    WHERE r.organization_id = NEW.organization_id
      AND r.occurrence_id = NEW.id;

    IF v_transaction_id IS NULL THEN
      IF NEW.status = 'satisfied'
         OR NEW.reconciliation_state = 'reconciled'
         OR NEW.actual_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'Occurrence may only become satisfied through an explicit reconciliation';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM 'satisfied'
       OR NEW.reconciliation_state IS DISTINCT FROM 'reconciled'
       OR NEW.actual_transaction_id IS DISTINCT FROM v_transaction_id THEN
      RAISE EXCEPTION 'Reconciled occurrence lifecycle is immutable without an explicit reconciliation lifecycle operation';
    END IF;
  ELSIF TG_TABLE_NAME = 'cash_commitments' THEN
    SELECT r.transaction_id INTO v_transaction_id
    FROM public.financial_planned_reconciliations r
    WHERE r.organization_id = NEW.organization_id
      AND r.commitment_id = NEW.id;

    IF v_transaction_id IS NULL THEN
      IF NEW.status = 'satisfied'
         OR NEW.reconciliation_state = 'reconciled'
         OR NEW.actual_transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'Commitment may only become satisfied through an explicit reconciliation';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM 'satisfied'
       OR NEW.reconciliation_state IS DISTINCT FROM 'reconciled'
       OR NEW.actual_transaction_id IS DISTINCT FROM v_transaction_id THEN
      RAISE EXCEPTION 'Reconciled commitment lifecycle is immutable without an explicit reconciliation lifecycle operation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_financial_occurrence_reconciliation_guard_insert
  BEFORE INSERT ON public.financial_obligation_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.guard_planned_satisfied_lifecycle();
CREATE TRIGGER trg_financial_occurrence_reconciliation_guard_update
  BEFORE UPDATE OF status, reconciliation_state, actual_transaction_id
  ON public.financial_obligation_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.guard_planned_satisfied_lifecycle();

CREATE TRIGGER trg_cash_commitment_reconciliation_guard_insert
  BEFORE INSERT ON public.cash_commitments
  FOR EACH ROW EXECUTE FUNCTION public.guard_planned_satisfied_lifecycle();
CREATE TRIGGER trg_cash_commitment_reconciliation_guard_update
  BEFORE UPDATE OF status, reconciliation_state, actual_transaction_id
  ON public.cash_commitments
  FOR EACH ROW EXECUTE FUNCTION public.guard_planned_satisfied_lifecycle();

CREATE OR REPLACE FUNCTION public.validate_financial_planned_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_tx_status TEXT;
  v_tx_kind TEXT;
  v_tx_amount BIGINT;
  v_plan_status TEXT;
  v_plan_reconciliation TEXT;
  v_plan_amount BIGINT;
BEGIN
  SELECT status, transaction_kind, amount_minor
    INTO v_tx_status, v_tx_kind, v_tx_amount
  FROM public.financial_transactions
  WHERE id = NEW.transaction_id
    AND organization_id = NEW.organization_id
  FOR UPDATE;

  IF v_tx_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'Planned reconciliation requires a posted actual transaction';
  END IF;
  IF v_tx_kind IN ('opening_balance','transfer') OR v_tx_amount >= 0 THEN
    RAISE EXCEPTION 'Only a posted cash outflow may satisfy a planned outflow';
  END IF;

  IF NEW.occurrence_id IS NOT NULL THEN
    SELECT occ.status, occ.reconciliation_state,
           coalesce(occ.override_amount_minor, o.amount_minor)
      INTO v_plan_status, v_plan_reconciliation, v_plan_amount
    FROM public.financial_obligation_occurrences occ
    JOIN public.financial_obligations o
      ON o.id = occ.obligation_id
     AND o.organization_id = occ.organization_id
    WHERE occ.id = NEW.occurrence_id
      AND occ.organization_id = NEW.organization_id
    FOR UPDATE OF occ;
  ELSE
    SELECT status, reconciliation_state, amount_minor
      INTO v_plan_status, v_plan_reconciliation, v_plan_amount
    FROM public.cash_commitments
    WHERE id = NEW.commitment_id
      AND organization_id = NEW.organization_id
    FOR UPDATE;
  END IF;

  IF v_plan_status IS DISTINCT FROM 'scheduled'
     OR v_plan_reconciliation IS DISTINCT FROM 'unreconciled' THEN
    RAISE EXCEPTION 'Only an unreconciled scheduled planned outflow may be reconciled';
  END IF;

  IF abs(v_tx_amount) <> v_plan_amount THEN
    RAISE EXCEPTION 'CASH-3 V1 requires exact-cent full reconciliation; partial/variance matching is not supported';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_financial_planned_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.occurrence_id IS NOT NULL THEN
    UPDATE public.financial_obligation_occurrences
    SET status = 'satisfied',
        reconciliation_state = 'reconciled',
        actual_transaction_id = NEW.transaction_id
    WHERE id = NEW.occurrence_id
      AND organization_id = NEW.organization_id;
  ELSE
    UPDATE public.cash_commitments
    SET status = 'satisfied',
        reconciliation_state = 'reconciled',
        actual_transaction_id = NEW.transaction_id
    WHERE id = NEW.commitment_id
      AND organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_financial_planned_reconciliation
  BEFORE INSERT ON public.financial_planned_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.validate_financial_planned_reconciliation();

CREATE TRIGGER trg_apply_financial_planned_reconciliation
  AFTER INSERT ON public.financial_planned_reconciliations
  FOR EACH ROW EXECUTE FUNCTION public.apply_financial_planned_reconciliation();

ALTER TABLE public.financial_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_obligation_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_planned_reconciliations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_obligations,
  public.financial_obligation_occurrences,
  public.cash_commitments,
  public.financial_planned_reconciliations
FROM PUBLIC, anon, authenticated;

CREATE POLICY financial_obligations_owner_admin_all
  ON public.financial_obligations
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE POLICY financial_occurrences_owner_admin_all
  ON public.financial_obligation_occurrences
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE POLICY cash_commitments_owner_admin_all
  ON public.cash_commitments
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE POLICY financial_planned_reconciliations_owner_admin_all
  ON public.financial_planned_reconciliations
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_obligations,
  public.financial_obligation_occurrences,
  public.cash_commitments
TO authenticated;
GRANT SELECT, INSERT ON public.financial_planned_reconciliations TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_financial_planned_outflow(
  p_organization_id UUID,
  p_occurrence_id UUID,
  p_commitment_id UUID,
  p_transaction_id UUID
)
RETURNS TABLE(reconciliation_id UUID, lifecycle_result TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF (p_occurrence_id IS NULL) = (p_commitment_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one planned source must be provided';
  END IF;

  PERFORM 1 FROM public.financial_transactions
   WHERE id = p_transaction_id
     AND organization_id = p_organization_id
   FOR UPDATE;

  IF p_occurrence_id IS NOT NULL THEN
    PERFORM 1 FROM public.financial_obligation_occurrences
     WHERE id = p_occurrence_id
       AND organization_id = p_organization_id
     FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.cash_commitments
     WHERE id = p_commitment_id
       AND organization_id = p_organization_id
     FOR UPDATE;
  END IF;

  INSERT INTO public.financial_planned_reconciliations
    (organization_id, occurrence_id, commitment_id, transaction_id, created_by)
  VALUES
    (p_organization_id, p_occurrence_id, p_commitment_id, p_transaction_id, auth.uid())
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'reconciled'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_financial_planned_outflow(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_planned_satisfied_lifecycle()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_financial_planned_reconciliation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_financial_planned_reconciliation()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_financial_planned_outflow(UUID, UUID, UUID, UUID)
  TO authenticated;

COMMENT ON TABLE public.financial_obligations IS
  'CASH-3 recurring planned outflow definitions. These are not ledger transactions.';
COMMENT ON TABLE public.financial_obligation_occurrences IS
  'Only materialized exceptions/state for recurring obligations; ordinary future dates are generated on read.';
COMMENT ON TABLE public.cash_commitments IS
  'CASH-3 one-time future planned outflows, distinct from actual CASH-2 transactions.';
COMMENT ON TABLE public.financial_planned_reconciliations IS
  'One-to-one relationship between a planned outflow and one actual CASH-2 transaction. Stores no second amount.';

COMMIT;
