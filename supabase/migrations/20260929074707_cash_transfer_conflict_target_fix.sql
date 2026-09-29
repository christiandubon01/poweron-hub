BEGIN;

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
  ON CONFLICT ON CONSTRAINT financial_links_unique
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

REVOKE ALL ON FUNCTION public.record_financial_transfer(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_financial_transfer(UUID, UUID, UUID, BIGINT, DATE, TEXT, TEXT)
  TO authenticated;

COMMIT;
