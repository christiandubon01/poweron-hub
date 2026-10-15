-- PLAID-730 controlled replacement recovery. REVIEWED FILE ONLY: do not apply without owner approval.
-- Requires migrations 153-156 and the installed PLAID-1C resumable-sync objects.
--
-- Safety contract:
--   * source and replacement Items coexist; neither Item, cursor, transaction, interpretation or balance is deleted;
--   * replacement accounts stay unmapped until one atomic activation after coverage/overlap verification;
--   * provider IDs match automatically only within a confirmed account pair; the fallback signature requires every
--     retained provider fact and a unique 1:1 result. Collisions go to review and block activation;
--   * January 1 is an oldest-observed-transaction gate, not proof that the institution supplied every historical day;
--   * activation copies non-ledger interpretation state only after conflict checks; ledger associations require separate review;
--   * mappings transfer atomically, and activation never calls Plaid /item/remove.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_provider_history_recoveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_item_ref UUID NOT NULL,
  replacement_item_ref UUID,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
  requested_days INTEGER NOT NULL CHECK (requested_days = 730),
  required_coverage_start DATE NOT NULL DEFAULT DATE '2026-01-01',
  expected_account_count INTEGER NOT NULL DEFAULT 4 CHECK (expected_account_count = 4),
  state TEXT NOT NULL CHECK (state IN ('link_pending','accounts_pending','account_review','syncing','transaction_review','ready','activated','error','cancelled')),
  missing_overlap_count INTEGER NOT NULL DEFAULT 0 CHECK (missing_overlap_count >= 0),
  error_code TEXT,
  partial_coverage_accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  partial_coverage_accepted_at TIMESTAMPTZ,
  partial_coverage_reason TEXT,
  partial_coverage_details JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fphr_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT fphr_source_org_fk FOREIGN KEY (source_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphr_replacement_org_fk FOREIGN KEY (replacement_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphr_items_distinct CHECK (replacement_item_ref IS NULL OR replacement_item_ref <> source_item_ref),
  CONSTRAINT fphr_partial_coverage_consistent CHECK (
    (partial_coverage_accepted_at IS NULL AND partial_coverage_accepted_by IS NULL AND partial_coverage_reason IS NULL AND partial_coverage_details IS NULL)
    OR (partial_coverage_accepted_at IS NOT NULL AND partial_coverage_accepted_by IS NOT NULL
      AND length(trim(partial_coverage_reason)) > 0 AND jsonb_typeof(partial_coverage_details) = 'object'
      AND length(coalesce(partial_coverage_details->>'fingerprint','')) = 32
      AND jsonb_typeof(partial_coverage_details->'accounts') = 'array')
  ),
  CONSTRAINT fphr_activation_consistent CHECK ((state = 'activated') = (activated_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fphr_active_source ON public.financial_provider_history_recoveries(source_item_ref)
  WHERE state NOT IN ('activated','cancelled');
CREATE UNIQUE INDEX IF NOT EXISTS uq_fphr_replacement ON public.financial_provider_history_recoveries(replacement_item_ref)
  WHERE replacement_item_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fphr_org ON public.financial_provider_history_recoveries(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.financial_provider_history_recovery_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  recovery_ref UUID NOT NULL,
  source_account_ref UUID NOT NULL,
  replacement_account_ref UUID,
  financial_account_id UUID NOT NULL,
  match_basis TEXT NOT NULL CHECK (match_basis IN ('provider_account_id','account_details','owner_confirmed','ambiguous')),
  status TEXT NOT NULL CHECK (status IN ('confirmed','review')),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fphra_recovery_org_fk FOREIGN KEY (recovery_ref, organization_id)
    REFERENCES public.financial_provider_history_recoveries(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphra_source_org_fk FOREIGN KEY (source_account_ref, organization_id)
    REFERENCES public.financial_provider_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphra_replacement_org_fk FOREIGN KEY (replacement_account_ref, organization_id)
    REFERENCES public.financial_provider_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphra_financial_org_fk FOREIGN KEY (financial_account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphra_source_unique UNIQUE (recovery_ref, source_account_ref),
  CONSTRAINT fphra_replacement_unique UNIQUE (recovery_ref, replacement_account_ref),
  CONSTRAINT fphra_confirmation_consistent CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_fphra_org_recovery ON public.financial_provider_history_recovery_accounts(organization_id, recovery_ref);

CREATE TABLE IF NOT EXISTS public.financial_provider_history_recovery_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  recovery_ref UUID NOT NULL,
  source_transaction_ref UUID NOT NULL,
  replacement_transaction_ref UUID NOT NULL,
  match_basis TEXT NOT NULL CHECK (match_basis IN ('provider_transaction_id','unique_full_provider_facts','ambiguous_full_provider_facts')),
  status TEXT NOT NULL CHECK (status IN ('confirmed','review','rejected')),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  invalidation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fphrt_recovery_org_fk FOREIGN KEY (recovery_ref, organization_id)
    REFERENCES public.financial_provider_history_recoveries(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphrt_source_org_fk FOREIGN KEY (source_transaction_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphrt_replacement_org_fk FOREIGN KEY (replacement_transaction_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT fphrt_pair_unique UNIQUE (recovery_ref, source_transaction_ref, replacement_transaction_ref),
  CONSTRAINT fphrt_invalidation_consistent CHECK (
    (invalidated_at IS NULL AND invalidation_reason IS NULL)
    OR (status = 'rejected' AND invalidated_at IS NOT NULL AND length(trim(invalidation_reason)) > 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fphrt_confirmed_source ON public.financial_provider_history_recovery_transactions(recovery_ref, source_transaction_ref) WHERE status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_fphrt_confirmed_replacement ON public.financial_provider_history_recovery_transactions(recovery_ref, replacement_transaction_ref) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS idx_fphrt_org_recovery ON public.financial_provider_history_recovery_transactions(organization_id, recovery_ref, status);

ALTER TABLE public.financial_provider_history_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_history_recovery_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_history_recovery_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_provider_history_recoveries, public.financial_provider_history_recovery_accounts,
  public.financial_provider_history_recovery_transactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_provider_history_recoveries, public.financial_provider_history_recovery_accounts,
  public.financial_provider_history_recovery_transactions TO service_role;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_payload(p_organization_id UUID, p_recovery_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'sourceItemId', r.source_item_ref, 'replacementItemId', r.replacement_item_ref,
    'sourceProviderItemId', si.provider_item_id, 'institutionId', si.institution_id, 'institutionName', si.institution_name,
    'environment', r.environment, 'state', r.state, 'requestedDays', r.requested_days,
    'requiredCoverageStart', r.required_coverage_start, 'expectedAccountCount', r.expected_account_count,
    'partialCoverageAcceptedAt', r.partial_coverage_accepted_at, 'partialCoverageReason', r.partial_coverage_reason,
    'partialCoverageDetails', r.partial_coverage_details,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'errorCode', r.error_code,
    'accounts', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', a.id, 'oldAccountId', a.source_account_ref, 'newAccountId', a.replacement_account_ref,
      'oldLabel', coalesce(sa.name,sa.official_name,'Bank account') || coalesce(' ••••'||sa.mask,''),
      'newLabel', CASE WHEN na.id IS NULL THEN NULL ELSE coalesce(na.name,na.official_name,'Bank account') || coalesce(' ••••'||na.mask,'') END,
      'financialAccountName', fa.display_name, 'matchBasis', a.match_basis, 'status', a.status,
      'oldestDate', cov.oldest_date, 'newestDate', cov.newest_date, 'transactionCount', coalesce(cov.transaction_count,0),
      'coverageSatisfied', coalesce(cov.oldest_date::date <= r.required_coverage_start, false),
      'coverageBasis', 'oldest_observed_transaction'
    ) ORDER BY sa.mask, sa.id)
      FROM public.financial_provider_history_recovery_accounts a
      JOIN public.financial_provider_accounts sa ON sa.id=a.source_account_ref AND sa.organization_id=a.organization_id
      LEFT JOIN public.financial_provider_accounts na ON na.id=a.replacement_account_ref AND na.organization_id=a.organization_id
      JOIN public.financial_accounts fa ON fa.id=a.financial_account_id AND fa.organization_id=a.organization_id
      LEFT JOIN LATERAL (SELECT min(t.transaction_date)::text oldest_date, max(t.transaction_date)::text newest_date, count(*)::int transaction_count
        FROM public.financial_provider_transactions t WHERE t.organization_id=a.organization_id AND t.provider_account_ref=a.replacement_account_ref AND t.removed_at IS NULL) cov ON true
      WHERE a.organization_id=r.organization_id AND a.recovery_ref=r.id), '[]'::jsonb),
    'overlap', jsonb_build_object(
      'confirmed', (SELECT count(*) FROM public.financial_provider_history_recovery_transactions x WHERE x.recovery_ref=r.id AND x.organization_id=r.organization_id AND x.status='confirmed'),
      'review', (SELECT count(DISTINCT x.source_transaction_ref) FROM public.financial_provider_history_recovery_transactions x WHERE x.recovery_ref=r.id AND x.organization_id=r.organization_id AND x.status='review'),
      'missingFromReplacement', r.missing_overlap_count),
    'transactionReview', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', q.id, 'sourceTransactionId', q.source_transaction_ref, 'replacementTransactionId', q.replacement_transaction_ref,
      'accountLabel', q.account_label, 'date', q.transaction_date, 'name', q.tx_name, 'amountMinor', q.provider_amount_minor,
      'sourceRef', q.source_ref, 'replacementRef', q.replacement_ref) ORDER BY q.transaction_date,q.id)
      FROM (SELECT x.id,x.source_transaction_ref,x.replacement_transaction_ref,o.transaction_date::text transaction_date,
        coalesce(o.merchant_name,o.name,'Transaction') tx_name,o.provider_amount_minor,
        coalesce(sa.name,sa.official_name,'Bank account')||coalesce(' ••••'||sa.mask,'') account_label,
        substr(md5(o.provider_transaction_id),1,10) source_ref,substr(md5(n.provider_transaction_id),1,10) replacement_ref
        FROM public.financial_provider_history_recovery_transactions x
        JOIN public.financial_provider_transactions o ON o.id=x.source_transaction_ref AND o.organization_id=x.organization_id
        JOIN public.financial_provider_transactions n ON n.id=x.replacement_transaction_ref AND n.organization_id=x.organization_id
        JOIN public.financial_provider_accounts sa ON sa.id=o.provider_account_ref AND sa.organization_id=o.organization_id
        WHERE x.recovery_ref=r.id AND x.organization_id=r.organization_id AND x.status='review'
        ORDER BY o.transaction_date,x.id LIMIT 100) q), '[]'::jsonb)
  )
  FROM public.financial_provider_history_recoveries r
  JOIN public.financial_provider_items si ON si.id=r.source_item_ref AND si.organization_id=r.organization_id
  WHERE r.organization_id=p_organization_id AND r.id=p_recovery_id;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_get(p_organization_id UUID, p_recovery_id UUID)
RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT public.financial_provider_history_recovery_payload(p_organization_id,p_recovery_id);
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_list(p_organization_id UUID, p_environment TEXT)
RETURNS SETOF JSONB LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT public.financial_provider_history_recovery_payload(r.organization_id,r.id)
  FROM public.financial_provider_history_recoveries r
  WHERE r.organization_id=p_organization_id AND r.environment=p_environment ORDER BY r.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_accounts_complete(p_organization_id UUID,p_recovery_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.financial_provider_history_recoveries r
    WHERE r.id=p_recovery_id AND r.organization_id=p_organization_id AND r.replacement_item_ref IS NOT NULL
      AND (SELECT count(*) FROM public.financial_provider_history_recovery_accounts a
        JOIN public.financial_provider_accounts sa ON sa.id=a.source_account_ref AND sa.organization_id=a.organization_id AND sa.provider_item_ref=r.source_item_ref AND sa.status='active'
        JOIN public.financial_provider_accounts na ON na.id=a.replacement_account_ref AND na.organization_id=a.organization_id AND na.provider_item_ref=r.replacement_item_ref AND na.status='active'
        WHERE a.recovery_ref=r.id AND a.organization_id=r.organization_id AND a.status='confirmed')=r.expected_account_count
      AND (SELECT count(DISTINCT a.source_account_ref) FROM public.financial_provider_history_recovery_accounts a WHERE a.recovery_ref=r.id AND a.organization_id=r.organization_id)=r.expected_account_count
      AND (SELECT count(DISTINCT a.replacement_account_ref) FROM public.financial_provider_history_recovery_accounts a WHERE a.recovery_ref=r.id AND a.organization_id=r.organization_id)=r.expected_account_count
      AND (SELECT count(DISTINCT a.financial_account_id) FROM public.financial_provider_history_recovery_accounts a WHERE a.recovery_ref=r.id AND a.organization_id=r.organization_id)=r.expected_account_count
      AND (SELECT count(*) FROM public.financial_provider_accounts sa
        JOIN public.financial_provider_account_mappings m ON m.provider_account_ref=sa.id AND m.organization_id=sa.organization_id AND m.status='active'
        WHERE sa.organization_id=r.organization_id AND sa.provider_item_ref=r.source_item_ref AND sa.status='active')=r.expected_account_count
      AND (SELECT count(*) FROM public.financial_provider_accounts na
        WHERE na.organization_id=r.organization_id AND na.provider_item_ref=r.replacement_item_ref AND na.status='active')=r.expected_account_count
  );
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_coverage_fingerprint(p_organization_id UUID,p_recovery_id UUID)
RETURNS TEXT LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT md5(coalesce(string_agg(concat_ws('|',
    a.source_account_ref::text,a.replacement_account_ref::text,a.financial_account_id::text,a.match_basis,
    coalesce(cov.oldest_date::text,''),coalesce(cov.newest_date::text,''),cov.transaction_count::text,cov.evidence_hash),''
    ORDER BY a.source_account_ref),''))
  FROM public.financial_provider_history_recovery_accounts a
  LEFT JOIN LATERAL (
    SELECT min(t.transaction_date) oldest_date,max(t.transaction_date) newest_date,count(*)::int transaction_count,
      md5(coalesce(string_agg(concat_ws(':',t.provider_transaction_id,t.transaction_date::text,t.pending::text),''
        ORDER BY t.provider_transaction_id),'')) evidence_hash
    FROM public.financial_provider_transactions t
    WHERE t.organization_id=a.organization_id AND t.provider_account_ref=a.replacement_account_ref AND t.removed_at IS NULL
  ) cov ON true
  WHERE a.organization_id=p_organization_id AND a.recovery_ref=p_recovery_id AND a.status='confirmed';
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_start(
  p_organization_id UUID, p_source_item_id UUID, p_actor UUID, p_environment TEXT, p_requested_days INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_item RECORD; v_id UUID;
BEGIN
  IF p_requested_days <> 730 OR p_environment <> 'production' THEN RAISE EXCEPTION 'HISTORY_RECOVERY_CONFIGURATION_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_item FROM public.financial_provider_items WHERE id=p_source_item_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR v_item.status='disconnected' OR v_item.environment<>p_environment OR v_item.institution_id IS NULL THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_SOURCE_INVALID' USING ERRCODE='P0002';
  END IF;
  SELECT id INTO v_id FROM public.financial_provider_history_recoveries
    WHERE source_item_ref=p_source_item_id AND state NOT IN ('activated','cancelled') FOR UPDATE;
  IF v_id IS NULL THEN
    INSERT INTO public.financial_provider_history_recoveries(organization_id,source_item_ref,environment,requested_days,state,created_by)
      VALUES(p_organization_id,p_source_item_id,p_environment,730,'link_pending',p_actor) RETURNING id INTO v_id;
  ELSIF EXISTS (SELECT 1 FROM public.financial_provider_history_recoveries WHERE id=v_id AND replacement_item_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_REPLACEMENT_EXISTS' USING ERRCODE='23505';
  ELSE
    UPDATE public.financial_provider_history_recoveries SET state='link_pending',error_code=NULL,updated_at=now() WHERE id=v_id;
  END IF;
  RETURN public.financial_provider_history_recovery_payload(p_organization_id,v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_confirm_transaction(
  p_organization_id UUID,p_recovery_id UUID,p_match_id UUID,p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_match public.financial_provider_history_recovery_transactions%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.financial_provider_history_recoveries WHERE id=p_recovery_id AND organization_id=p_organization_id AND state='transaction_review' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORY_RECOVERY_NOT_REVIEWABLE' USING ERRCODE='55000'; END IF;
  SELECT * INTO v_match FROM public.financial_provider_history_recovery_transactions
    WHERE id=p_match_id AND recovery_ref=p_recovery_id AND organization_id=p_organization_id AND status='review' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORY_RECOVERY_TRANSACTION_MATCH_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_transactions x WHERE x.recovery_ref=p_recovery_id AND x.status='confirmed'
    AND (x.source_transaction_ref=v_match.source_transaction_ref OR x.replacement_transaction_ref=v_match.replacement_transaction_ref)) THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_TRANSACTION_ALREADY_MATCHED' USING ERRCODE='23505'; END IF;
  UPDATE public.financial_provider_history_recovery_transactions SET status='rejected'
    WHERE recovery_ref=p_recovery_id AND organization_id=p_organization_id AND status='review'
      AND (source_transaction_ref=v_match.source_transaction_ref OR replacement_transaction_ref=v_match.replacement_transaction_ref);
  UPDATE public.financial_provider_history_recovery_transactions SET status='confirmed',confirmed_by=p_actor,confirmed_at=now() WHERE id=v_match.id;
  UPDATE public.financial_provider_history_recoveries SET updated_at=now() WHERE id=p_recovery_id;
END; $$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_connect_item(
  p_organization_id UUID, p_recovery_id UUID, p_provider_item_id TEXT, p_institution_id TEXT, p_institution_name TEXT,
  p_encrypted_access_token TEXT, p_actor UUID, p_environment TEXT)
RETURNS TABLE(item_id UUID) LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.financial_provider_history_recoveries%ROWTYPE; s RECORD; v_item UUID; v_outcome TEXT;
BEGIN
  SELECT * INTO r FROM public.financial_provider_history_recoveries WHERE id=p_recovery_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.replacement_item_ref IS NOT NULL OR r.state NOT IN ('link_pending','error') THEN RAISE EXCEPTION 'HISTORY_RECOVERY_NOT_LINKABLE' USING ERRCODE='55000'; END IF;
  SELECT * INTO s FROM public.financial_provider_items WHERE id=r.source_item_ref AND organization_id=p_organization_id FOR UPDATE;
  IF s.status='disconnected' OR s.environment<>p_environment OR r.environment<>p_environment OR s.institution_id IS DISTINCT FROM p_institution_id THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_INSTITUTION_MISMATCH' USING ERRCODE='23514';
  END IF;
  SELECT c.item_id,c.outcome INTO v_item,v_outcome FROM public.financial_provider_connect_item(p_organization_id,'plaid',p_provider_item_id,p_institution_id,p_institution_name,p_encrypted_access_token,p_actor,p_environment) c;
  IF v_item=r.source_item_ref OR v_outcome<>'created' THEN RAISE EXCEPTION 'HISTORY_RECOVERY_ITEM_REUSED' USING ERRCODE='23514'; END IF;
  UPDATE public.financial_provider_history_recoveries SET replacement_item_ref=v_item,state='accounts_pending',error_code=NULL,updated_at=now() WHERE id=r.id;
  RETURN QUERY SELECT v_item;
END; $$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_mark_error(p_organization_id UUID,p_recovery_id UUID,p_error_code TEXT)
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  UPDATE public.financial_provider_history_recoveries SET state='error',error_code=left(coalesce(p_error_code,'ERROR'),64),updated_at=now()
  WHERE id=p_recovery_id AND organization_id=p_organization_id AND state NOT IN ('activated','cancelled');
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_prepare_accounts(p_organization_id UUID,p_recovery_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.financial_provider_history_recoveries%ROWTYPE; o RECORD; v_new UUID; v_count INTEGER; v_basis TEXT; v_status TEXT;
BEGIN
  SELECT * INTO r FROM public.financial_provider_history_recoveries WHERE id=p_recovery_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.replacement_item_ref IS NULL OR r.state IN ('activated','cancelled') THEN RAISE EXCEPTION 'HISTORY_RECOVERY_NOT_READY' USING ERRCODE='55000'; END IF;
  FOR o IN SELECT a.*,m.financial_account_id FROM public.financial_provider_accounts a
    JOIN public.financial_provider_account_mappings m ON m.provider_account_ref=a.id AND m.organization_id=a.organization_id AND m.status='active'
    WHERE a.organization_id=p_organization_id AND a.provider_item_ref=r.source_item_ref AND a.status='active' LOOP
    SELECT count(*),(array_agg(n.id ORDER BY n.id))[1] INTO v_count,v_new FROM public.financial_provider_accounts n
      WHERE n.organization_id=p_organization_id AND n.provider_item_ref=r.replacement_item_ref AND n.status='active' AND n.provider_account_id=o.provider_account_id;
    IF v_count=1 THEN v_basis:='provider_account_id'; v_status:='confirmed';
    ELSE
      SELECT count(*),(array_agg(n.id ORDER BY n.id))[1] INTO v_count,v_new FROM public.financial_provider_accounts n
        WHERE n.organization_id=p_organization_id AND n.provider_item_ref=r.replacement_item_ref AND n.status='active'
          AND n.mask IS NOT DISTINCT FROM o.mask AND n.provider_account_type IS NOT DISTINCT FROM o.provider_account_type
          AND n.provider_account_subtype IS NOT DISTINCT FROM o.provider_account_subtype
          AND lower(coalesce(n.official_name,n.name,''))=lower(coalesce(o.official_name,o.name,''));
      v_basis:=CASE WHEN v_count=1 THEN 'account_details' ELSE 'ambiguous' END; v_status:='review'; IF v_count<>1 THEN v_new:=NULL; END IF;
    END IF;
    INSERT INTO public.financial_provider_history_recovery_accounts(organization_id,recovery_ref,source_account_ref,replacement_account_ref,financial_account_id,match_basis,status,confirmed_at)
      VALUES(p_organization_id,r.id,o.id,v_new,o.financial_account_id,v_basis,v_status,CASE WHEN v_status='confirmed' THEN now() ELSE NULL END)
      ON CONFLICT(recovery_ref,source_account_ref) DO UPDATE SET replacement_account_ref=excluded.replacement_account_ref,match_basis=excluded.match_basis,status=excluded.status,
        confirmed_at=excluded.confirmed_at,updated_at=now()
      WHERE financial_provider_history_recovery_accounts.status<>'confirmed';
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_accounts WHERE recovery_ref=r.id) THEN RAISE EXCEPTION 'HISTORY_RECOVERY_NO_MAPPED_ACCOUNTS' USING ERRCODE='55000'; END IF;
  UPDATE public.financial_provider_history_recoveries SET state=CASE WHEN public.financial_provider_history_recovery_accounts_complete(p_organization_id,r.id) THEN 'syncing' ELSE 'account_review' END,error_code=NULL,updated_at=now() WHERE id=r.id;
END; $$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_confirm_account(
  p_organization_id UUID,p_recovery_id UUID,p_match_id UUID,p_replacement_account_id UUID,p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.financial_provider_history_recoveries%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.financial_provider_history_recoveries WHERE id=p_recovery_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.replacement_item_ref IS NULL OR r.state IN ('activated','cancelled') THEN RAISE EXCEPTION 'HISTORY_RECOVERY_NOT_REVIEWABLE' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.financial_provider_accounts WHERE id=p_replacement_account_id AND organization_id=p_organization_id AND provider_item_ref=r.replacement_item_ref AND status='active')
    OR EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_accounts WHERE recovery_ref=r.id AND replacement_account_ref=p_replacement_account_id AND id<>p_match_id) THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_ACCOUNT_INVALID' USING ERRCODE='23514'; END IF;
  UPDATE public.financial_provider_history_recovery_accounts SET replacement_account_ref=p_replacement_account_id,match_basis='owner_confirmed',status='confirmed',confirmed_by=p_actor,confirmed_at=now(),updated_at=now()
    WHERE id=p_match_id AND recovery_ref=r.id AND organization_id=p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORY_RECOVERY_ACCOUNT_MATCH_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  UPDATE public.financial_provider_history_recoveries SET state=CASE WHEN public.financial_provider_history_recovery_accounts_complete(p_organization_id,r.id) THEN 'syncing' ELSE 'account_review' END,updated_at=now() WHERE id=r.id;
END; $$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_accept_partial_coverage(
  p_organization_id UUID,p_recovery_id UUID,p_actor UUID,p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.financial_provider_history_recoveries%ROWTYPE; v_accounts JSONB; v_details JSONB; v_fingerprint TEXT;
BEGIN
  SELECT * INTO r FROM public.financial_provider_history_recoveries WHERE id=p_recovery_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.state<>'transaction_review' OR r.replacement_item_ref IS NULL THEN RAISE EXCEPTION 'HISTORY_RECOVERY_PARTIAL_COVERAGE_NOT_REVIEWABLE' USING ERRCODE='55000'; END IF;
  IF p_actor IS NULL OR length(trim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'HISTORY_RECOVERY_PARTIAL_COVERAGE_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
  IF NOT public.financial_provider_history_recovery_accounts_complete(p_organization_id,p_recovery_id) THEN RAISE EXCEPTION 'HISTORY_RECOVERY_ACCOUNT_PAIRING_INCOMPLETE' USING ERRCODE='55000'; END IF;
  v_fingerprint:=public.financial_provider_history_recovery_coverage_fingerprint(p_organization_id,p_recovery_id);
  IF r.partial_coverage_accepted_at IS NOT NULL AND r.partial_coverage_details->>'fingerprint'=v_fingerprint THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_PARTIAL_COVERAGE_ALREADY_ACCEPTED' USING ERRCODE='55000'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'sourceAccountId',a.source_account_ref,'replacementAccountId',a.replacement_account_ref,
    'oldestObservedTransactionDate',cov.oldest_date,'newestObservedTransactionDate',cov.newest_date,
    'transactionCount',coalesce(cov.transaction_count,0),'requiredObservedTransactionStart',r.required_coverage_start)
    ORDER BY a.source_account_ref)
  INTO v_accounts
  FROM public.financial_provider_history_recovery_accounts a
  LEFT JOIN LATERAL (SELECT min(t.transaction_date) oldest_date,max(t.transaction_date) newest_date,count(*)::int transaction_count
    FROM public.financial_provider_transactions t WHERE t.organization_id=a.organization_id AND t.provider_account_ref=a.replacement_account_ref AND t.removed_at IS NULL) cov ON true
  WHERE a.recovery_ref=r.id AND a.organization_id=r.organization_id;
  v_details:=jsonb_build_object('fingerprint',v_fingerprint,'accounts',coalesce(v_accounts,'[]'::jsonb),
    'coverageBasis','oldest_observed_transaction_not_complete_history');
  IF r.partial_coverage_accepted_at IS NOT NULL THEN
    v_details:=v_details||jsonb_build_object('previousAcceptance',jsonb_build_object(
      'acceptedBy',r.partial_coverage_accepted_by,'acceptedAt',r.partial_coverage_accepted_at,
      'reason',r.partial_coverage_reason,'details',r.partial_coverage_details));
  END IF;
  UPDATE public.financial_provider_history_recoveries SET partial_coverage_accepted_by=p_actor,partial_coverage_accepted_at=now(),
    partial_coverage_reason=trim(p_reason),partial_coverage_details=v_details,updated_at=now() WHERE id=r.id;
END; $$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_reconcile(p_organization_id UUID,p_recovery_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.financial_provider_history_recoveries%ROWTYPE; v_review INTEGER; v_missing INTEGER;
BEGIN
  SELECT * INTO r FROM public.financial_provider_history_recoveries WHERE id=p_recovery_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND OR r.replacement_item_ref IS NULL OR r.state IN ('activated','cancelled') THEN RAISE EXCEPTION 'HISTORY_RECOVERY_NOT_RECONCILABLE' USING ERRCODE='55000'; END IF;
  IF NOT public.financial_provider_history_recovery_accounts_complete(p_organization_id,p_recovery_id) THEN RAISE EXCEPTION 'HISTORY_RECOVERY_ACCOUNT_PAIRING_INCOMPLETE' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.financial_provider_items WHERE id=r.replacement_item_ref AND organization_id=p_organization_id AND last_successful_sync_at IS NOT NULL) THEN RAISE EXCEPTION 'HISTORY_RECOVERY_SYNC_INCOMPLETE' USING ERRCODE='55000'; END IF;

  UPDATE public.financial_provider_history_recovery_transactions SET status='rejected',invalidated_at=now(),invalidation_reason='candidate_rebuilt'
    WHERE recovery_ref=r.id AND organization_id=p_organization_id
      AND (status='review' OR (status='confirmed' AND (confirmed_by IS NULL
        OR match_basis IN ('unique_full_provider_facts','ambiguous_full_provider_facts'))));
  UPDATE public.financial_provider_history_recovery_transactions x SET status='rejected',invalidated_at=now(),invalidation_reason='provider_evidence_changed'
    WHERE x.recovery_ref=r.id AND x.organization_id=p_organization_id AND x.status='confirmed'
      AND NOT EXISTS(
        SELECT 1 FROM public.financial_provider_history_recovery_accounts a
        JOIN public.financial_provider_transactions o ON o.id=x.source_transaction_ref AND o.organization_id=a.organization_id AND o.provider_account_ref=a.source_account_ref AND o.removed_at IS NULL
        JOIN public.financial_provider_transactions n ON n.id=x.replacement_transaction_ref AND n.organization_id=a.organization_id AND n.provider_account_ref=a.replacement_account_ref AND n.removed_at IS NULL
        WHERE a.recovery_ref=r.id AND a.organization_id=p_organization_id AND a.status='confirmed'
          AND ((x.match_basis='provider_transaction_id' AND o.provider_transaction_id=n.provider_transaction_id)
            OR (x.match_basis IN ('unique_full_provider_facts','ambiguous_full_provider_facts')
              AND n.provider_amount_minor=o.provider_amount_minor AND n.currency=o.currency AND n.transaction_date=o.transaction_date
              AND n.authorized_date IS NOT DISTINCT FROM o.authorized_date AND n.name IS NOT DISTINCT FROM o.name
              AND n.merchant_name IS NOT DISTINCT FROM o.merchant_name AND n.pending=o.pending))
      );

  INSERT INTO public.financial_provider_history_recovery_transactions(organization_id,recovery_ref,source_transaction_ref,replacement_transaction_ref,match_basis,status)
  SELECT p_organization_id,r.id,o.id,n.id,'provider_transaction_id','confirmed'
  FROM public.financial_provider_history_recovery_accounts a
  JOIN public.financial_provider_transactions o ON o.provider_account_ref=a.source_account_ref AND o.organization_id=a.organization_id
  JOIN public.financial_provider_transactions n ON n.provider_account_ref=a.replacement_account_ref AND n.organization_id=a.organization_id AND n.provider_transaction_id=o.provider_transaction_id
  WHERE a.recovery_ref=r.id AND a.status='confirmed' AND o.removed_at IS NULL AND n.removed_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_transactions x
      WHERE x.recovery_ref=r.id AND x.status='confirmed'
        AND (x.source_transaction_ref=o.id OR x.replacement_transaction_ref=n.id))
  ORDER BY o.id,n.id
  ON CONFLICT(recovery_ref,source_transaction_ref,replacement_transaction_ref) DO UPDATE SET
    match_basis=excluded.match_basis,status=excluded.status,invalidated_at=NULL,invalidation_reason=NULL
  WHERE financial_provider_history_recovery_transactions.invalidated_at IS NOT NULL;

  WITH old_f AS (
    SELECT o.id,a.id account_match,o.provider_amount_minor,o.currency,o.transaction_date,o.authorized_date,o.name,o.merchant_name,o.pending
    FROM public.financial_provider_history_recovery_accounts a JOIN public.financial_provider_transactions o ON o.provider_account_ref=a.source_account_ref AND o.organization_id=a.organization_id
    WHERE a.recovery_ref=r.id AND o.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_transactions x WHERE x.recovery_ref=r.id AND x.source_transaction_ref=o.id AND x.status='confirmed')
  ), new_f AS (
    SELECT n.id,a.id account_match,n.provider_amount_minor,n.currency,n.transaction_date,n.authorized_date,n.name,n.merchant_name,n.pending
    FROM public.financial_provider_history_recovery_accounts a JOIN public.financial_provider_transactions n ON n.provider_account_ref=a.replacement_account_ref AND n.organization_id=a.organization_id
    WHERE a.recovery_ref=r.id AND n.removed_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_transactions x WHERE x.recovery_ref=r.id AND x.replacement_transaction_ref=n.id AND x.status='confirmed')
  ), pairs AS (SELECT o.id old_id,n.id new_id,count(*) OVER(PARTITION BY o.id) old_candidates,
      count(*) OVER(PARTITION BY n.id) new_candidates FROM old_f o JOIN new_f n ON n.account_match=o.account_match
        AND n.provider_amount_minor=o.provider_amount_minor AND n.currency=o.currency AND n.transaction_date=o.transaction_date
        AND n.authorized_date IS NOT DISTINCT FROM o.authorized_date AND n.name IS NOT DISTINCT FROM o.name
        AND n.merchant_name IS NOT DISTINCT FROM o.merchant_name AND n.pending=o.pending)
  INSERT INTO public.financial_provider_history_recovery_transactions(organization_id,recovery_ref,source_transaction_ref,replacement_transaction_ref,match_basis,status)
  SELECT p_organization_id,r.id,old_id,new_id,CASE WHEN old_candidates=1 AND new_candidates=1 THEN 'unique_full_provider_facts' ELSE 'ambiguous_full_provider_facts' END,
    CASE WHEN old_candidates=1 AND new_candidates=1 THEN 'confirmed' ELSE 'review' END FROM pairs
  ORDER BY old_id,new_id
  ON CONFLICT(recovery_ref,source_transaction_ref,replacement_transaction_ref) DO UPDATE SET
    match_basis=excluded.match_basis,status=excluded.status,invalidated_at=NULL,invalidation_reason=NULL
  WHERE financial_provider_history_recovery_transactions.invalidated_at IS NOT NULL;

  SELECT count(DISTINCT source_transaction_ref) INTO v_review FROM public.financial_provider_history_recovery_transactions WHERE recovery_ref=r.id AND status='review';
  SELECT count(*) INTO v_missing FROM public.financial_provider_history_recovery_accounts a
  JOIN public.financial_provider_transactions o ON o.provider_account_ref=a.source_account_ref AND o.organization_id=a.organization_id AND o.removed_at IS NULL
  WHERE a.recovery_ref=r.id AND o.transaction_date >= (SELECT min(n.transaction_date) FROM public.financial_provider_transactions n WHERE n.provider_account_ref=a.replacement_account_ref AND n.removed_at IS NULL)
    AND o.transaction_date <= (SELECT max(n.transaction_date) FROM public.financial_provider_transactions n WHERE n.provider_account_ref=a.replacement_account_ref AND n.removed_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_transactions x WHERE x.recovery_ref=r.id AND x.source_transaction_ref=o.id AND x.status='confirmed');
  UPDATE public.financial_provider_history_recoveries SET missing_overlap_count=v_missing,state=CASE WHEN v_review=0 AND v_missing=0
    AND public.financial_provider_history_recovery_accounts_complete(p_organization_id,r.id)
    AND NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_accounts a WHERE a.recovery_ref=r.id AND NOT EXISTS(SELECT 1 FROM public.financial_provider_transactions t WHERE t.provider_account_ref=a.replacement_account_ref AND t.removed_at IS NULL))
    AND NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_accounts a WHERE a.recovery_ref=r.id
      AND EXISTS(SELECT 1 FROM public.financial_provider_balance_snapshots b WHERE b.provider_account_ref=a.source_account_ref)
      AND NOT EXISTS(SELECT 1 FROM public.financial_provider_balance_snapshots b WHERE b.provider_account_ref=a.replacement_account_ref))
    AND ((r.partial_coverage_accepted_at IS NOT NULL
      AND r.partial_coverage_details->>'fingerprint'=public.financial_provider_history_recovery_coverage_fingerprint(p_organization_id,r.id)) OR NOT EXISTS(
      SELECT 1 FROM public.financial_provider_history_recovery_accounts a WHERE a.recovery_ref=r.id
        AND coalesce((SELECT min(t.transaction_date) FROM public.financial_provider_transactions t
          WHERE t.provider_account_ref=a.replacement_account_ref AND t.removed_at IS NULL) > r.required_coverage_start,true)))
    THEN 'ready' ELSE 'transaction_review' END,error_code=NULL,updated_at=now() WHERE id=r.id;
END; $$;

-- Exactly one side of a recovery participates in consolidated provider balances: source until activation, replacement afterward.
-- This does not delete or rewrite a snapshot and remains effective while the old Item is retained.
CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_balance_exclusions(p_organization_id UUID,p_environment TEXT)
RETURNS TABLE(account_id UUID) LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT CASE WHEN r.state='activated' THEN a.source_account_ref ELSE a.replacement_account_ref END
  FROM public.financial_provider_history_recoveries r
  JOIN public.financial_provider_history_recovery_accounts a ON a.recovery_ref=r.id AND a.organization_id=r.organization_id
  WHERE r.organization_id=p_organization_id AND r.environment=p_environment AND r.state<>'cancelled'
    AND a.replacement_account_ref IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_history_recovery_activate(p_organization_id UUID,p_recovery_id UUID,p_actor UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE r public.financial_provider_history_recoveries%ROWTYPE; v_account RECORD;
BEGIN
  SELECT * INTO r FROM public.financial_provider_history_recoveries WHERE id=p_recovery_id AND organization_id=p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HISTORY_RECOVERY_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF r.state='activated' THEN RETURN; END IF;
  IF r.state<>'ready' OR r.missing_overlap_count<>0 OR EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_transactions WHERE recovery_ref=r.id AND status='review') THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_NOT_READY' USING ERRCODE='55000'; END IF;
  IF NOT public.financial_provider_history_recovery_accounts_complete(p_organization_id,p_recovery_id) THEN RAISE EXCEPTION 'HISTORY_RECOVERY_ACCOUNT_PAIRING_INCOMPLETE' USING ERRCODE='55000'; END IF;
  IF (r.partial_coverage_accepted_at IS NULL
      OR r.partial_coverage_details->>'fingerprint' IS DISTINCT FROM public.financial_provider_history_recovery_coverage_fingerprint(p_organization_id,r.id)) AND EXISTS(
    SELECT 1 FROM public.financial_provider_history_recovery_accounts a WHERE a.recovery_ref=r.id
      AND coalesce((SELECT min(t.transaction_date) FROM public.financial_provider_transactions t
        WHERE t.provider_account_ref=a.replacement_account_ref AND t.removed_at IS NULL) > r.required_coverage_start,true)) THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_COVERAGE_INCOMPLETE' USING ERRCODE='55000'; END IF;
  FOR v_account IN SELECT * FROM public.financial_provider_history_recovery_accounts WHERE recovery_ref=r.id AND organization_id=p_organization_id ORDER BY id FOR UPDATE LOOP
    IF v_account.status<>'confirmed' OR NOT EXISTS(SELECT 1 FROM public.financial_provider_account_mappings WHERE organization_id=p_organization_id AND provider_account_ref=v_account.source_account_ref AND financial_account_id=v_account.financial_account_id AND status='active') THEN
      RAISE EXCEPTION 'HISTORY_RECOVERY_MAPPING_CHANGED' USING ERRCODE='40001'; END IF;
  END LOOP;

  IF EXISTS(
    SELECT 1 FROM public.financial_provider_history_recovery_transactions m
    JOIN public.financial_provider_interpretations i ON i.organization_id=m.organization_id AND i.provider_transaction_ref=m.replacement_transaction_ref
    WHERE m.recovery_ref=r.id AND m.status='confirmed' AND i.status IN ('suggested','confirmed')) THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_INTERPRETATION_CONFLICT' USING ERRCODE='55000'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.financial_provider_history_recovery_transactions m
    JOIN public.financial_provider_interpretations i ON i.organization_id=m.organization_id AND i.provider_transaction_ref=m.source_transaction_ref AND i.status<>'undone'
    JOIN public.financial_provider_transactions c ON c.id=i.counterpart_provider_transaction_ref AND c.organization_id=i.organization_id
    WHERE m.recovery_ref=r.id AND m.status='confirmed' AND i.counterpart_provider_transaction_ref IS NOT NULL
      AND (c.removed_at IS NOT NULL
        OR (c.provider_item_ref=r.source_item_ref AND NOT EXISTS(
          SELECT 1 FROM public.financial_provider_history_recovery_transactions cm
          WHERE cm.recovery_ref=r.id AND cm.source_transaction_ref=c.id AND cm.status='confirmed'))
        OR coalesce((SELECT cm.replacement_transaction_ref FROM public.financial_provider_history_recovery_transactions cm
          WHERE cm.recovery_ref=r.id AND cm.source_transaction_ref=c.id AND cm.status='confirmed'),c.id)=m.replacement_transaction_ref)) THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_COUNTERPART_INVALID' USING ERRCODE='55000'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.financial_provider_interpretations i
    JOIN public.financial_provider_history_recovery_transactions m ON m.recovery_ref=r.id AND m.replacement_transaction_ref=i.counterpart_provider_transaction_ref AND m.status='confirmed'
    WHERE i.organization_id=p_organization_id AND i.status IN ('suggested','confirmed')
      AND NOT EXISTS(SELECT 1 FROM public.financial_provider_history_recovery_transactions own
        WHERE own.recovery_ref=r.id AND own.replacement_transaction_ref=i.provider_transaction_ref AND own.status='confirmed')) THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_COUNTERPART_CONFLICT' USING ERRCODE='55000'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.financial_provider_history_recovery_transactions m
    JOIN public.financial_provider_interpretations i ON i.organization_id=m.organization_id AND i.provider_transaction_ref=m.source_transaction_ref
    WHERE m.recovery_ref=r.id AND m.status='confirmed' AND i.kind='ledger_match' AND i.status<>'undone') THEN
    RAISE EXCEPTION 'HISTORY_RECOVERY_LEDGER_ASSOCIATION_REVIEW_REQUIRED' USING ERRCODE='55000'; END IF;

  INSERT INTO public.financial_provider_interpretations(organization_id,provider_transaction_ref,kind,status,source,confidence,suggestion_basis,
    ledger_transaction_id,match_mode,category,obligation_occurrence_id,cash_commitment_id,transaction_link_id,counterpart_provider_transaction_ref,
    debt_account_id,project_id,obligation_id,decided_by,decided_at,undone_by,undone_at,undo_reason,created_by)
  SELECT i.organization_id,m.replacement_transaction_ref,i.kind,i.status,i.source,i.confidence,
    i.suggestion_basis||jsonb_build_object('history_recovery_source_interpretation',i.id,'history_recovery',r.id),
    i.ledger_transaction_id,i.match_mode,i.category,i.obligation_occurrence_id,i.cash_commitment_id,i.transaction_link_id,
    coalesce(cm.replacement_transaction_ref,i.counterpart_provider_transaction_ref),i.debt_account_id,i.project_id,i.obligation_id,
    i.decided_by,i.decided_at,i.undone_by,i.undone_at,i.undo_reason,i.created_by
  FROM public.financial_provider_history_recovery_transactions m
  JOIN public.financial_provider_interpretations i ON i.provider_transaction_ref=m.source_transaction_ref AND i.organization_id=m.organization_id
  LEFT JOIN public.financial_provider_history_recovery_transactions cm ON cm.recovery_ref=r.id AND cm.source_transaction_ref=i.counterpart_provider_transaction_ref AND cm.status='confirmed'
  WHERE m.recovery_ref=r.id AND m.status='confirmed' AND i.kind<>'ledger_match' AND i.status<>'undone'
    AND NOT EXISTS(SELECT 1 FROM public.financial_provider_interpretations x WHERE x.organization_id=i.organization_id AND x.provider_transaction_ref=m.replacement_transaction_ref AND x.suggestion_basis->>'history_recovery_source_interpretation'=i.id::text)
  ORDER BY i.created_at,i.id;

  UPDATE public.financial_provider_account_mappings m SET status='inactive',deactivated_by=p_actor,deactivated_at=now(),deactivation_reason='history_recovery_replaced',updated_at=now()
  FROM public.financial_provider_history_recovery_accounts ra WHERE ra.recovery_ref=r.id AND m.organization_id=p_organization_id AND m.provider_account_ref=ra.source_account_ref AND m.status='active';
  INSERT INTO public.financial_provider_account_mappings(organization_id,provider_account_ref,financial_account_id,status,mapped_by)
    SELECT p_organization_id,replacement_account_ref,financial_account_id,'active',p_actor FROM public.financial_provider_history_recovery_accounts WHERE recovery_ref=r.id;
  UPDATE public.financial_provider_history_recoveries SET state='activated',activated_by=p_actor,activated_at=now(),updated_at=now() WHERE id=r.id;
END; $$;

REVOKE ALL ON FUNCTION public.financial_provider_history_recovery_payload(UUID,UUID),
  public.financial_provider_history_recovery_get(UUID,UUID), public.financial_provider_history_recovery_list(UUID,TEXT),
  public.financial_provider_history_recovery_accounts_complete(UUID,UUID),
  public.financial_provider_history_recovery_coverage_fingerprint(UUID,UUID),
  public.financial_provider_history_recovery_start(UUID,UUID,UUID,TEXT,INTEGER),
  public.financial_provider_history_recovery_connect_item(UUID,UUID,TEXT,TEXT,TEXT,TEXT,UUID,TEXT),
  public.financial_provider_history_recovery_mark_error(UUID,UUID,TEXT), public.financial_provider_history_recovery_prepare_accounts(UUID,UUID),
  public.financial_provider_history_recovery_confirm_account(UUID,UUID,UUID,UUID,UUID),
  public.financial_provider_history_recovery_confirm_transaction(UUID,UUID,UUID,UUID),
  public.financial_provider_history_recovery_accept_partial_coverage(UUID,UUID,UUID,TEXT),
  public.financial_provider_history_recovery_reconcile(UUID,UUID), public.financial_provider_history_recovery_activate(UUID,UUID,UUID),
  public.financial_provider_history_recovery_balance_exclusions(UUID,TEXT)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_history_recovery_payload(UUID,UUID), public.financial_provider_history_recovery_get(UUID,UUID), public.financial_provider_history_recovery_list(UUID,TEXT),
  public.financial_provider_history_recovery_accounts_complete(UUID,UUID),
  public.financial_provider_history_recovery_coverage_fingerprint(UUID,UUID),
  public.financial_provider_history_recovery_start(UUID,UUID,UUID,TEXT,INTEGER),
  public.financial_provider_history_recovery_connect_item(UUID,UUID,TEXT,TEXT,TEXT,TEXT,UUID,TEXT),
  public.financial_provider_history_recovery_mark_error(UUID,UUID,TEXT), public.financial_provider_history_recovery_prepare_accounts(UUID,UUID),
  public.financial_provider_history_recovery_confirm_account(UUID,UUID,UUID,UUID,UUID),
  public.financial_provider_history_recovery_confirm_transaction(UUID,UUID,UUID,UUID),
  public.financial_provider_history_recovery_accept_partial_coverage(UUID,UUID,UUID,TEXT),
  public.financial_provider_history_recovery_reconcile(UUID,UUID), public.financial_provider_history_recovery_activate(UUID,UUID,UUID),
  public.financial_provider_history_recovery_balance_exclusions(UUID,TEXT)
  TO service_role;

COMMENT ON TABLE public.financial_provider_history_recoveries IS 'Controlled 730-day replacement workflow. Source Item and all evidence remain; replacement is isolated until verified atomic mapping activation.';
COMMENT ON COLUMN public.financial_provider_history_recoveries.required_coverage_start IS 'Conservative gate against each replacement account''s oldest observed transaction date. This does not prove the institution supplied complete history from that date.';
COMMIT;
