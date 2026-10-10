-- Separately reviewable BANK-6H prerequisite. NOT installed by code deployment.
-- Additive function only: no tables, migrations 157/158, data rewrites or grant weakening.
-- Install only after owner approval. Calls the existing category replacement RPC under its evidence-row lock.
BEGIN;
CREATE FUNCTION public.bank_spending_replace_category_checked(
  p_organization_id UUID,p_actor UUID,p_transaction_id UUID,p_category TEXT,p_expected JSONB
) RETURNS TABLE(outcome TEXT,interpretation_id UUID,replaced_id UUID)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE t RECORD; current_revision JSONB; current_key TEXT;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id=p_actor AND org_id=p_organization_id AND role IN ('owner','admin') AND is_active
  ) THEN RAISE EXCEPTION 'CATEGORY_BATCH_FORBIDDEN' USING ERRCODE='42501'; END IF;
  -- A capability probe reads authority only, with no writes.
  IF p_transaction_id IS NULL AND p_category IS NULL AND p_expected IS NULL THEN
    RETURN QUERY SELECT 'available'::text,NULL::uuid,NULL::uuid; RETURN;
  END IF;
  IF p_expected IS NULL OR jsonb_typeof(p_expected)<>'object' OR p_category IS NULL THEN
    RAISE EXCEPTION 'CATEGORY_BATCH_ARGUMENTS' USING ERRCODE='22023'; END IF;
  SELECT * INTO t FROM public.financial_provider_transactions
    WHERE organization_id=p_organization_id AND id=p_transaction_id FOR UPDATE;
  IF NOT FOUND OR t.removed_at IS NOT NULL OR t.pending THEN
    RAISE EXCEPTION 'CATEGORY_BATCH_INELIGIBLE' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM public.financial_provider_interpretations
    WHERE organization_id=p_organization_id AND provider_transaction_ref=p_transaction_id AND status='confirmed' FOR UPDATE;
  SELECT jsonb_build_object(
    'category',(SELECT id FROM public.financial_provider_interpretations WHERE organization_id=p_organization_id AND provider_transaction_ref=p_transaction_id AND status='confirmed' AND kind='category'),
    'relationship',(SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM public.financial_provider_interpretations WHERE organization_id=p_organization_id AND provider_transaction_ref=p_transaction_id AND status='confirmed' AND kind NOT IN ('category','ignored')),
    'ignored',(SELECT id FROM public.financial_provider_interpretations WHERE organization_id=p_organization_id AND provider_transaction_ref=p_transaction_id AND status='confirmed' AND kind='ignored'),
    'amountMinor',t.provider_amount_minor,'pending',t.pending,'removed',t.removed_at IS NOT NULL,
    'date',t.transaction_date,'accountRef',t.provider_account_ref,'name',t.name,'merchantName',t.merchant_name
  ) INTO current_revision;
  IF current_revision->>'ignored' IS NOT NULL THEN RAISE EXCEPTION 'CATEGORY_BATCH_IGNORED' USING ERRCODE='40001'; END IF;
  SELECT category INTO current_key FROM public.financial_provider_interpretations
    WHERE organization_id=p_organization_id AND provider_transaction_ref=p_transaction_id AND status='confirmed' AND kind='category';
  -- Safe uncertain-response retry: same category, same evidence/relationship/ignore state, no additional history.
  IF current_key=p_category AND (current_revision-'category')=(p_expected-'category') THEN
    RETURN QUERY SELECT 'unchanged'::text,(current_revision->>'category')::uuid,NULL::uuid; RETURN;
  END IF;
  IF current_revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'CATEGORY_BATCH_STALE_PREVIEW' USING ERRCODE='40001'; END IF;
  RETURN QUERY SELECT r.outcome,r.interpretation_id,r.replaced_id FROM public.financial_provider_replace_interpretation(
    p_organization_id=>p_organization_id,p_actor=>p_actor,p_provider_transaction_ref=>p_transaction_id,
    p_dimension=>'bucket',p_kind=>'category',p_source=>'owner',p_confidence=>'high',
    p_suggestion_basis=>jsonb_build_object('mode','merchant_explicit_category','expected',p_expected),p_category=>p_category
  ) r;
END; $$;
REVOKE ALL ON FUNCTION public.bank_spending_replace_category_checked(UUID,UUID,UUID,TEXT,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bank_spending_replace_category_checked(UUID,UUID,UUID,TEXT,JSONB) TO service_role;
COMMIT;
-- Rollback: keep function/data/history; stop exposing the batch action. No destructive data rollback.
