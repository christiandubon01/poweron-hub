BEGIN;

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
    AND l.relationship_type IN ('transfer_pair', 'card_debt_payment_pair');

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

REVOKE ALL ON FUNCTION public.void_financial_transaction_pair(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_financial_transaction_pair(UUID, UUID, TEXT)
  TO authenticated;

COMMIT;
