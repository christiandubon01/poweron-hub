-- CASH-2A: harden mutation RPC privileges and make confirmed financial pairs
-- one atomic lifecycle unit. Additive/replacement-function migration only.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_financial_pair_lifecycle_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.financial_transaction_links l
    JOIN public.financial_transactions source_tx
      ON source_tx.id = l.source_transaction_id
     AND source_tx.organization_id = l.organization_id
    JOIN public.financial_transactions target_tx
      ON target_tx.id = l.target_transaction_id
     AND target_tx.organization_id = l.organization_id
    WHERE l.organization_id = NEW.organization_id
      AND l.status = 'confirmed'
      AND l.relationship_type IN ('transfer_pair', 'card_debt_payment_pair')
      AND NEW.id IN (l.source_transaction_id, l.target_transaction_id)
      AND source_tx.status IS DISTINCT FROM target_tx.status
  ) THEN
    RAISE EXCEPTION 'Confirmed transfer/card-payment pairs must share one lifecycle state';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_pair_lifecycle_consistency
  ON public.financial_transactions;
CREATE CONSTRAINT TRIGGER trg_financial_pair_lifecycle_consistency
  AFTER INSERT OR UPDATE OF status ON public.financial_transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_financial_pair_lifecycle_consistency();

CREATE OR REPLACE FUNCTION public.enforce_financial_link_initial_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_source_status TEXT; v_target_status TEXT;
BEGIN
  IF NEW.status = 'confirmed'
     AND NEW.relationship_type IN ('transfer_pair', 'card_debt_payment_pair') THEN
    SELECT status INTO v_source_status FROM public.financial_transactions
      WHERE id = NEW.source_transaction_id AND organization_id = NEW.organization_id;
    SELECT status INTO v_target_status FROM public.financial_transactions
      WHERE id = NEW.target_transaction_id AND organization_id = NEW.organization_id;
    IF v_source_status IS NULL OR v_target_status IS NULL
       OR v_source_status IS DISTINCT FROM v_target_status THEN
      RAISE EXCEPTION 'Confirmed financial pair link requires matching transaction lifecycle states';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_financial_link_initial_consistency
  ON public.financial_transaction_links;
CREATE TRIGGER trg_financial_link_initial_consistency
  BEFORE INSERT OR UPDATE OF status, relationship_type,
    source_transaction_id, target_transaction_id
  ON public.financial_transaction_links
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_financial_link_initial_consistency();

CREATE OR REPLACE FUNCTION public.void_financial_transaction_pair(
  p_organization_id UUID,
  p_link_id UUID,
  p_reason TEXT
)
RETURNS TABLE(
  source_transaction_id UUID,
  target_transaction_id UUID,
  lifecycle_result TEXT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_source UUID;
  v_target UUID;
  v_source_status TEXT;
  v_target_status TEXT;
  v_updated_count INTEGER;
BEGIN
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'Pair void reason is required';
  END IF;

  SELECT l.source_transaction_id, l.target_transaction_id
    INTO v_source, v_target
  FROM public.financial_transaction_links l
  WHERE l.id = p_link_id
    AND l.organization_id = p_organization_id
    AND l.status = 'confirmed'
    AND l.relationship_type IN ('transfer_pair', 'card_debt_payment_pair')
  FOR UPDATE;

  IF v_source IS NULL OR v_target IS NULL THEN
    RAISE EXCEPTION 'Confirmed financial transaction pair not found';
  END IF;

  SELECT status INTO v_source_status
  FROM public.financial_transactions
  WHERE id = v_source AND organization_id = p_organization_id
  FOR UPDATE;
  SELECT status INTO v_target_status
  FROM public.financial_transactions
  WHERE id = v_target AND organization_id = p_organization_id
  FOR UPDATE;

  IF v_source_status = 'voided' AND v_target_status = 'voided' THEN
    RETURN QUERY SELECT v_source, v_target, 'already_voided'::TEXT;
    RETURN;
  END IF;
  IF v_source_status IS DISTINCT FROM 'posted' OR v_target_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'Financial pair is not in a compatible posted lifecycle state';
  END IF;

  UPDATE public.financial_transactions
  SET status = 'voided',
      voided_at = now(),
      voided_by = auth.uid(),
      void_reason = p_reason
  WHERE organization_id = p_organization_id
    AND id IN (v_source, v_target);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 2 THEN
    RAISE EXCEPTION 'Financial pair void must update exactly two transactions';
  END IF;

  RETURN QUERY SELECT v_source, v_target, 'voided'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.record_financial_transfer(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_financial_card_payment(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_financial_transaction_pair(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_financial_pair_lifecycle_consistency()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_financial_link_initial_consistency()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_financial_transfer(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_financial_card_payment(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_financial_transaction_pair(UUID, UUID, TEXT)
  TO authenticated;

COMMIT;
