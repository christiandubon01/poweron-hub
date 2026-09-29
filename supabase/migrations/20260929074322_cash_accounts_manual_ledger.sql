-- CASH-2: organization-scoped accounts and manual ledger foundation.
-- Additive only. No legacy/project/service values are imported by this migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  account_type TEXT NOT NULL CHECK (account_type IN (
    'checking', 'savings', 'cash', 'credit_card', 'loan', 'other_asset', 'other_liability'
  )),
  account_class TEXT NOT NULL CHECK (account_class IN ('asset', 'liability')),
  ownership_context TEXT NOT NULL CHECK (ownership_context IN ('business', 'personal')),
  include_in_cash BOOLEAN NOT NULL DEFAULT false,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'imported', 'future_provider')),
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT financial_accounts_cash_assets_only CHECK (include_in_cash = false OR account_class = 'asset'),
  CONSTRAINT financial_accounts_type_class_consistency CHECK (
    (account_type IN ('checking', 'savings', 'cash', 'other_asset') AND account_class = 'asset') OR
    (account_type IN ('credit_card', 'loan', 'other_liability') AND account_class = 'liability')
  ),
  CONSTRAINT financial_accounts_archive_consistency CHECK (
    (status = 'active' AND archived_at IS NULL) OR
    (status = 'archived' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT financial_accounts_id_org_unique UNIQUE (id, organization_id)
);

COMMENT ON COLUMN public.financial_accounts.include_in_cash IS
  'Explicit owner selection for Total Cash. Personal accounts may be included; liability accounts never may.';
COMMENT ON COLUMN public.financial_accounts.source_metadata IS
  'Non-secret provenance metadata only. Provider credentials must never be stored here.';

CREATE TABLE IF NOT EXISTS public.financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  account_id UUID NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  transaction_date DATE NOT NULL,
  effective_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'voided')),
  transaction_kind TEXT NOT NULL CHECK (transaction_kind IN (
    'opening_balance', 'income', 'expense', 'transfer', 'card_debt_payment',
    'refund_reversal', 'adjustment'
  )),
  economic_effect TEXT NOT NULL CHECK (economic_effect IN ('none', 'inflow', 'outflow')),
  economic_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (economic_amount_minor >= 0),
  description TEXT NOT NULL DEFAULT '',
  counterparty TEXT,
  category TEXT,
  project_id TEXT,
  employee_id TEXT,
  debt_account_id UUID,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN (
    'manual', 'opening_balance', 'operational_reference', 'future_provider'
  )),
  source_organization_id UUID,
  source_kind TEXT,
  source_record_id TEXT,
  source_effective_date DATE,
  source_timestamp TIMESTAMPTZ,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT NOT NULL CHECK (length(trim(idempotency_key)) > 0),
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  CONSTRAINT financial_transactions_account_org_fk
    FOREIGN KEY (account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_transactions_debt_org_fk
    FOREIGN KEY (debt_account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_transactions_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_transactions_idempotency_unique UNIQUE (organization_id, idempotency_key),
  CONSTRAINT financial_transactions_source_pair CHECK (
    (source_kind IS NULL AND source_record_id IS NULL AND source_organization_id IS NULL) OR
    (source_kind IS NOT NULL AND source_record_id IS NOT NULL AND source_organization_id = organization_id)
  ),
  CONSTRAINT financial_transactions_kind_effect CHECK (
    (transaction_kind IN ('opening_balance', 'transfer', 'card_debt_payment') AND economic_effect = 'none' AND economic_amount_minor = 0) OR
    (transaction_kind = 'income' AND economic_effect = 'inflow' AND economic_amount_minor > 0) OR
    (transaction_kind = 'expense' AND economic_effect = 'outflow' AND economic_amount_minor > 0) OR
    transaction_kind IN ('refund_reversal', 'adjustment')
  ),
  CONSTRAINT financial_transactions_nonzero CHECK (
    amount_minor <> 0 OR transaction_kind = 'opening_balance'
  ),
  CONSTRAINT financial_transactions_void_consistency CHECK (
    (status <> 'voided' AND voided_at IS NULL AND voided_by IS NULL) OR
    (status = 'voided' AND voided_at IS NOT NULL)
  )
);

COMMENT ON COLUMN public.financial_transactions.amount_minor IS
  'Signed USD cents. Asset positive increases cash; liability positive increases amount owed.';
COMMENT ON COLUMN public.financial_transactions.economic_effect IS
  'Economic reporting meaning, separate from account movement. Opening balances, transfers, and card/debt payments are none.';
COMMENT ON COLUMN public.financial_transactions.economic_amount_minor IS
  'Unsigned cents for economic reporting. Separate because liability movement sign is not an expense/income sign.';
COMMENT ON COLUMN public.financial_transactions.source_kind IS
  'Optional CASH-1 FinancialSourceRef kind. Attaching provenance never creates another amount.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_transactions_one_live_opening
  ON public.financial_transactions (account_id)
  WHERE transaction_kind = 'opening_balance' AND status <> 'voided';
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_transactions_operational_source
  ON public.financial_transactions (organization_id, source_kind, source_record_id)
  WHERE source_kind IS NOT NULL AND source_record_id IS NOT NULL AND status <> 'voided';

CREATE TABLE IF NOT EXISTS public.financial_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_transaction_id UUID NOT NULL,
  target_transaction_id UUID NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'transfer_pair', 'card_debt_payment_pair', 'reversal_of',
    'correction_of', 'operational_reconciliation'
  )),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  confidence TEXT NOT NULL DEFAULT 'confirmed' CHECK (confidence IN ('confirmed', 'expected', 'possible')),
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT financial_links_source_org_fk
    FOREIGN KEY (source_transaction_id, organization_id)
    REFERENCES public.financial_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_links_target_org_fk
    FOREIGN KEY (target_transaction_id, organization_id)
    REFERENCES public.financial_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_links_distinct_transactions CHECK (source_transaction_id <> target_transaction_id),
  CONSTRAINT financial_links_unique UNIQUE (
    organization_id, source_transaction_id, target_transaction_id, relationship_type
  )
);

CREATE INDEX IF NOT EXISTS idx_financial_accounts_org ON public.financial_accounts (organization_id);
CREATE INDEX IF NOT EXISTS idx_financial_accounts_cash ON public.financial_accounts (organization_id, include_in_cash)
  WHERE status = 'active' AND account_class = 'asset';
CREATE INDEX IF NOT EXISTS idx_financial_transactions_org_date
  ON public.financial_transactions (organization_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_transactions_account_date
  ON public.financial_transactions (account_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_financial_links_org ON public.financial_transaction_links (organization_id);
CREATE INDEX IF NOT EXISTS idx_financial_links_source ON public.financial_transaction_links (source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_financial_links_target ON public.financial_transaction_links (target_transaction_id);

CREATE OR REPLACE FUNCTION public.set_cash_ledger_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_financial_transaction_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'Voided financial transactions are immutable';
  END IF;
  IF OLD.status = 'posted' THEN
    IF NEW.status <> 'voided' THEN
      RAISE EXCEPTION 'Posted financial transactions may only be voided';
    END IF;
    IF (NEW.organization_id, NEW.account_id, NEW.amount_minor, NEW.currency,
        NEW.transaction_date, NEW.transaction_kind, NEW.economic_effect, NEW.economic_amount_minor,
        NEW.source_kind, NEW.source_record_id, NEW.idempotency_key)
       IS DISTINCT FROM
       (OLD.organization_id, OLD.account_id, OLD.amount_minor, OLD.currency,
        OLD.transaction_date, OLD.transaction_kind, OLD.economic_effect, OLD.economic_amount_minor,
        OLD.source_kind, OLD.source_record_id, OLD.idempotency_key) THEN
      RAISE EXCEPTION 'Posted financial facts are immutable';
    END IF;
  END IF;
  IF NEW.status = 'voided' AND OLD.status <> 'voided' THEN
    NEW.voided_at := coalesce(NEW.voided_at, now());
    NEW.voided_by := coalesce(NEW.voided_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_financial_account_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (NEW.organization_id, NEW.account_type, NEW.account_class, NEW.currency)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.account_type, OLD.account_class, OLD.currency) THEN
    RAISE EXCEPTION 'Financial account identity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_financial_accounts_updated_at
  BEFORE UPDATE ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();
CREATE TRIGGER trg_financial_transactions_updated_at
  BEFORE UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();
CREATE TRIGGER trg_financial_transactions_lifecycle
  BEFORE UPDATE ON public.financial_transactions FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_transaction_lifecycle();
CREATE TRIGGER trg_financial_accounts_identity
  BEFORE UPDATE ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION public.enforce_financial_account_identity();

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transaction_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_accounts, public.financial_transactions, public.financial_transaction_links FROM PUBLIC, anon;
REVOKE ALL ON public.financial_accounts, public.financial_transactions, public.financial_transaction_links FROM authenticated;

CREATE POLICY financial_accounts_owner_admin_select ON public.financial_accounts FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY financial_accounts_owner_admin_insert ON public.financial_accounts FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY financial_accounts_owner_admin_update ON public.financial_accounts FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE POLICY financial_transactions_owner_admin_select ON public.financial_transactions FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY financial_transactions_owner_admin_insert ON public.financial_transactions FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY financial_transactions_owner_admin_update ON public.financial_transactions FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

CREATE POLICY financial_links_owner_admin_select ON public.financial_transaction_links FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY financial_links_owner_admin_insert ON public.financial_transaction_links FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

GRANT SELECT, INSERT, UPDATE ON public.financial_accounts, public.financial_transactions TO authenticated;
GRANT SELECT, INSERT ON public.financial_transaction_links TO authenticated;

CREATE OR REPLACE FUNCTION public.record_financial_transfer(
  p_organization_id UUID, p_source_account_id UUID, p_target_account_id UUID,
  p_amount_minor BIGINT, p_transaction_date DATE, p_description TEXT, p_idempotency_key TEXT
) RETURNS TABLE(source_transaction_id UUID, target_transaction_id UUID, link_id UUID)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_source UUID; v_target UUID; v_link UUID;
BEGIN
  IF p_amount_minor <= 0 OR p_source_account_id = p_target_account_id THEN
    RAISE EXCEPTION 'Transfer requires positive amount and distinct accounts';
  END IF;
  SELECT id INTO v_source FROM public.financial_transactions
    WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key || ':source';
  SELECT id INTO v_target FROM public.financial_transactions
    WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key || ':target';
  IF v_source IS NULL AND v_target IS NULL THEN
    INSERT INTO public.financial_transactions
      (organization_id, account_id, amount_minor, transaction_date, posted_at, transaction_kind,
       economic_effect, description, source_type, idempotency_key, created_by)
    VALUES
      (p_organization_id, p_source_account_id, -p_amount_minor, p_transaction_date, now(), 'transfer',
       'none', coalesce(p_description, ''), 'manual', p_idempotency_key || ':source', auth.uid()) RETURNING id INTO v_source;
    INSERT INTO public.financial_transactions
      (organization_id, account_id, amount_minor, transaction_date, posted_at, transaction_kind,
       economic_effect, description, source_type, idempotency_key, created_by)
    VALUES
      (p_organization_id, p_target_account_id, p_amount_minor, p_transaction_date, now(), 'transfer',
       'none', coalesce(p_description, ''), 'manual', p_idempotency_key || ':target', auth.uid()) RETURNING id INTO v_target;
  ELSIF v_source IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'Incomplete idempotent transfer pair';
  ELSIF EXISTS (
    SELECT 1 FROM public.financial_transactions
    WHERE (id = v_source AND (account_id <> p_source_account_id OR amount_minor <> -p_amount_minor OR transaction_date <> p_transaction_date))
       OR (id = v_target AND (account_id <> p_target_account_id OR amount_minor <> p_amount_minor OR transaction_date <> p_transaction_date))
  ) THEN
    RAISE EXCEPTION 'Idempotency key was already used with different transfer facts';
  END IF;
  INSERT INTO public.financial_transaction_links
    (organization_id, source_transaction_id, target_transaction_id, relationship_type, created_by)
  VALUES (p_organization_id, v_source, v_target, 'transfer_pair', auth.uid())
  ON CONFLICT (organization_id, source_transaction_id, target_transaction_id, relationship_type)
  DO NOTHING
  RETURNING id INTO v_link;
  IF v_link IS NULL THEN
    SELECT id INTO v_link FROM public.financial_transaction_links
      WHERE organization_id = p_organization_id
        AND source_transaction_id = v_source AND target_transaction_id = v_target
        AND relationship_type = 'transfer_pair';
  END IF;
  RETURN QUERY SELECT v_source, v_target, v_link;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_financial_card_payment(
  p_organization_id UUID, p_cash_account_id UUID, p_liability_account_id UUID,
  p_amount_minor BIGINT, p_transaction_date DATE, p_description TEXT, p_idempotency_key TEXT
) RETURNS TABLE(cash_transaction_id UUID, liability_transaction_id UUID, link_id UUID)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_cash UUID; v_liability UUID; v_link UUID; v_class TEXT;
BEGIN
  IF p_amount_minor <= 0 OR p_cash_account_id = p_liability_account_id THEN
    RAISE EXCEPTION 'Card/debt payment requires positive amount and distinct accounts';
  END IF;
  SELECT account_class INTO v_class FROM public.financial_accounts
    WHERE id = p_cash_account_id AND organization_id = p_organization_id;
  IF v_class IS DISTINCT FROM 'asset' THEN RAISE EXCEPTION 'Cash payment source must be an asset account'; END IF;
  SELECT account_class INTO v_class FROM public.financial_accounts
    WHERE id = p_liability_account_id AND organization_id = p_organization_id;
  IF v_class IS DISTINCT FROM 'liability' THEN RAISE EXCEPTION 'Payment target must be a liability account'; END IF;
  SELECT id INTO v_cash FROM public.financial_transactions
    WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key || ':cash';
  SELECT id INTO v_liability FROM public.financial_transactions
    WHERE organization_id = p_organization_id AND idempotency_key = p_idempotency_key || ':liability';
  IF v_cash IS NULL AND v_liability IS NULL THEN
    INSERT INTO public.financial_transactions
      (organization_id, account_id, amount_minor, transaction_date, posted_at, transaction_kind,
       economic_effect, debt_account_id, description, source_type, idempotency_key, created_by)
    VALUES
      (p_organization_id, p_cash_account_id, -p_amount_minor, p_transaction_date, now(), 'card_debt_payment',
       'none', p_liability_account_id, coalesce(p_description, ''), 'manual', p_idempotency_key || ':cash', auth.uid()) RETURNING id INTO v_cash;
    INSERT INTO public.financial_transactions
      (organization_id, account_id, amount_minor, transaction_date, posted_at, transaction_kind,
       economic_effect, debt_account_id, description, source_type, idempotency_key, created_by)
    VALUES
      (p_organization_id, p_liability_account_id, -p_amount_minor, p_transaction_date, now(), 'card_debt_payment',
       'none', p_liability_account_id, coalesce(p_description, ''), 'manual', p_idempotency_key || ':liability', auth.uid()) RETURNING id INTO v_liability;
  ELSIF v_cash IS NULL OR v_liability IS NULL THEN
    RAISE EXCEPTION 'Incomplete idempotent card/debt payment pair';
  ELSIF EXISTS (
    SELECT 1 FROM public.financial_transactions
    WHERE (id = v_cash AND (account_id <> p_cash_account_id OR amount_minor <> -p_amount_minor OR transaction_date <> p_transaction_date))
       OR (id = v_liability AND (account_id <> p_liability_account_id OR amount_minor <> -p_amount_minor OR transaction_date <> p_transaction_date))
  ) THEN
    RAISE EXCEPTION 'Idempotency key was already used with different card/debt payment facts';
  END IF;
  INSERT INTO public.financial_transaction_links
    (organization_id, source_transaction_id, target_transaction_id, relationship_type, created_by)
  VALUES (p_organization_id, v_cash, v_liability, 'card_debt_payment_pair', auth.uid())
  ON CONFLICT (organization_id, source_transaction_id, target_transaction_id, relationship_type)
  DO NOTHING
  RETURNING id INTO v_link;
  IF v_link IS NULL THEN
    SELECT id INTO v_link FROM public.financial_transaction_links
      WHERE organization_id = p_organization_id
        AND source_transaction_id = v_cash AND target_transaction_id = v_liability
        AND relationship_type = 'card_debt_payment_pair';
  END IF;
  RETURN QUERY SELECT v_cash, v_liability, v_link;
END;
$$;

REVOKE ALL ON FUNCTION public.record_financial_transfer(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_financial_card_payment(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_financial_transfer(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_financial_card_payment(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT) TO authenticated;

COMMIT;
