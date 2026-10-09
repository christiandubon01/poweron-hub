-- BANK-6G REVIEW DRAFT. NOT a registered or approved production migration.
-- Metadata only. No evidence, interpretation, canonical, Money Plan, or migration-history writes.
-- Production history must be checked again immediately before a separately approved application.
BEGIN;

CREATE TABLE public.bank_spending_hierarchy_controls (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  writes_enabled BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE public.bank_spending_parent_definitions (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z_]{1,39}$'),
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 80),
  color TEXT CHECK (color IS NULL OR color IN (
    '#a8841f','#b8761c','#c0652f','#c2533f','#e85060','#cf4f7d','#9a7442','#a88868',
    '#2f8fcf','#1098b0','#14998f','#5a72d9','#7f68d6','#a256b8','#c4469e','#a080a8',
    '#3a9461','#3f9a1e','#86932b','#809080','#7f8aa3','#507880','#a08080','#787078')),
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (organization_id, key)
);
CREATE TABLE public.bank_spending_category_definitions (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL CHECK (key ~ '^[a-z][a-z_]{1,39}$'),
  name TEXT NOT NULL CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 80),
  parent_key TEXT,
  builtin BOOLEAN NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (organization_id, key),
  FOREIGN KEY (organization_id, parent_key)
    REFERENCES public.bank_spending_parent_definitions(organization_id, key),
  CHECK (builtin = (key IN ('materials','fuel_vehicle','tools_equipment','software_subscriptions',
    'insurance','payroll_people','permits_fees','marketing','meals','office_admin','bank_finance_fees',
    'personal_owner','taxes','transfers','owner_draw','customer_payment','refund','other_needs_review')))
);
CREATE TABLE public.bank_spending_hierarchy_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  definition_type TEXT NOT NULL CHECK (definition_type IN ('parent','category')),
  definition_key TEXT NOT NULL,
  before_value JSONB,
  after_value JSONB NOT NULL,
  actor_user_id UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bank_spending_hierarchy_history_org_time
  ON public.bank_spending_hierarchy_history(organization_id, changed_at DESC);

-- Seed metadata only; never reinterpret historical transactions or split existing broad built-ins.
INSERT INTO public.bank_spending_hierarchy_controls (organization_id)
  SELECT id FROM public.organizations;
INSERT INTO public.bank_spending_parent_definitions (organization_id,key,name)
  SELECT o.id, d.key, d.name FROM public.organizations o CROSS JOIN (VALUES
    ('vehicle','Vehicle Expenses'),('overhead','Business Overhead'),('materials','Materials & Supplies'),
    ('tools','Tools & Equipment'),('insurance','Insurance & Protection'),('people','People & Payroll'),
    ('permits','Permits & Licensing'),('marketing','Marketing'),('meals','Meals'),('taxes','Taxes'),
    ('personal','Personal & Owner'),('movement','Money Movement'),('income','Money In')
  ) d(key,name);
INSERT INTO public.bank_spending_category_definitions (organization_id,key,name,parent_key,builtin)
  SELECT o.id,d.key,d.name,d.parent_key,TRUE FROM public.organizations o CROSS JOIN (VALUES
    ('materials','Materials','materials'),('fuel_vehicle','Fuel / Vehicle','vehicle'),
    ('tools_equipment','Tools & Equipment','tools'),('software_subscriptions','Software / Subscriptions','overhead'),
    ('insurance','Insurance','insurance'),('payroll_people','Payroll / People','people'),
    ('permits_fees','Permits & Fees','permits'),('marketing','Marketing','marketing'),('meals','Meals','meals'),
    ('office_admin','Office / Admin','overhead'),('bank_finance_fees','Bank / Finance Fees','overhead'),
    ('personal_owner','Personal / Owner','personal'),('taxes','Taxes','taxes'),('transfers','Transfers','movement'),
    ('owner_draw','Owner draw','personal'),('customer_payment','Customer payment','income'),
    ('refund','Refund','income'),('other_needs_review','Other / Needs Review',NULL)
  ) d(key,name,parent_key);

ALTER TABLE public.bank_spending_hierarchy_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_spending_parent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_spending_category_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_spending_hierarchy_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bank_spending_hierarchy_controls,public.bank_spending_parent_definitions,
  public.bank_spending_category_definitions,public.bank_spending_hierarchy_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.bank_spending_hierarchy_controls,public.bank_spending_parent_definitions,
  public.bank_spending_category_definitions,public.bank_spending_hierarchy_history TO authenticated;
GRANT INSERT,UPDATE ON public.bank_spending_parent_definitions,public.bank_spending_category_definitions TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.bank_spending_hierarchy_controls,public.bank_spending_parent_definitions,
  public.bank_spending_category_definitions TO service_role;
GRANT SELECT ON public.bank_spending_hierarchy_history TO service_role;

CREATE POLICY hierarchy_control_read ON public.bank_spending_hierarchy_controls FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY hierarchy_parent_read ON public.bank_spending_parent_definitions FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY hierarchy_category_read ON public.bank_spending_category_definitions FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY hierarchy_history_read ON public.bank_spending_hierarchy_history FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY hierarchy_parent_insert ON public.bank_spending_parent_definitions FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY hierarchy_parent_update ON public.bank_spending_parent_definitions FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY hierarchy_category_insert ON public.bank_spending_category_definitions FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
CREATE POLICY hierarchy_category_update ON public.bank_spending_category_definitions FOR UPDATE TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

-- Gate also protects service-role callers. Only a separately authorized service operation can enable it.
CREATE FUNCTION public.bank_spending_validate_definition() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.bank_spending_hierarchy_controls c
      WHERE c.organization_id = NEW.organization_id AND c.writes_enabled) THEN
    RAISE EXCEPTION 'HIERARCHY_WRITES_DISABLED' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.organization_id <> OLD.organization_id OR NEW.key <> OLD.key) THEN
    RAISE EXCEPTION 'IMMUTABLE_DEFINITION_IDENTITY' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'bank_spending_category_definitions' THEN
    IF TG_OP = 'INSERT' AND NEW.builtin THEN
      RAISE EXCEPTION 'BUILTIN_DEFINITION_PROTECTED' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.builtin <> OLD.builtin OR NEW.builtin AND NEW.archived) THEN
      RAISE EXCEPTION 'BUILTIN_DEFINITION_PROTECTED' USING ERRCODE = '23514';
    END IF;
    IF NEW.parent_key IS NOT NULL THEN
      PERFORM 1 FROM public.bank_spending_parent_definitions p
        WHERE p.organization_id = NEW.organization_id AND p.key = NEW.parent_key AND NOT p.archived FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'PARENT_UNAVAILABLE' USING ERRCODE = '23514'; END IF;
    END IF;
  ELSIF NEW.archived AND EXISTS (SELECT 1 FROM public.bank_spending_category_definitions c
      WHERE c.organization_id = NEW.organization_id AND c.parent_key = NEW.key AND NOT c.archived) THEN
    RAISE EXCEPTION 'MOVE_ACTIVE_CHILDREN_BEFORE_ARCHIVING_PARENT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER bank_spending_validate_parent BEFORE INSERT OR UPDATE ON public.bank_spending_parent_definitions
  FOR EACH ROW EXECUTE FUNCTION public.bank_spending_validate_definition();
CREATE TRIGGER bank_spending_validate_category BEFORE INSERT OR UPDATE ON public.bank_spending_category_definitions
  FOR EACH ROW EXECUTE FUNCTION public.bank_spending_validate_definition();

-- Narrow definer trigger: only writes a history row for the triggering metadata record.
-- Callers have no direct INSERT/UPDATE/DELETE permission on history.
CREATE FUNCTION public.bank_spending_audit_definition() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.bank_spending_hierarchy_history
    (organization_id,definition_type,definition_key,before_value,after_value,actor_user_id)
  VALUES (NEW.organization_id,CASE WHEN TG_TABLE_NAME = 'bank_spending_parent_definitions' THEN 'parent' ELSE 'category' END,
    NEW.key,CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),auth.uid());
  RETURN NEW;
END; $$;
CREATE TRIGGER bank_spending_audit_parent AFTER INSERT OR UPDATE ON public.bank_spending_parent_definitions
  FOR EACH ROW EXECUTE FUNCTION public.bank_spending_audit_definition();
CREATE TRIGGER bank_spending_audit_category AFTER INSERT OR UPDATE ON public.bank_spending_category_definitions
  FOR EACH ROW EXECUTE FUNCTION public.bank_spending_audit_definition();
REVOKE ALL ON FUNCTION public.bank_spending_validate_definition(),public.bank_spending_audit_definition()
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.bank_spending_read_hierarchy(p_organization_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IS DISTINCT FROM 'service_role' AND
    (p_organization_id IS DISTINCT FROM public.user_org_id() OR NOT public.is_org_admin_for(p_organization_id)) THEN
    RAISE EXCEPTION 'HIERARCHY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT jsonb_build_object(
    'writes_enabled',COALESCE((SELECT writes_enabled FROM public.bank_spending_hierarchy_controls WHERE organization_id = p_organization_id),FALSE),
    'parents',COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'organization_id' ORDER BY p.key)
      FROM public.bank_spending_parent_definitions p WHERE organization_id = p_organization_id),'[]'::JSONB),
    'categories',COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'organization_id' ORDER BY c.key)
      FROM public.bank_spending_category_definitions c WHERE organization_id = p_organization_id),'[]'::JSONB)));
END; $$;
REVOKE ALL ON FUNCTION public.bank_spending_read_hierarchy(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bank_spending_read_hierarchy(UUID) TO authenticated,service_role;

-- Atomic definition save with optional existing category color persistence. No assignment occurs here.
CREATE FUNCTION public.bank_spending_manage_definition(p_type TEXT,p_key TEXT,p_name TEXT,p_parent_key TEXT DEFAULT NULL,p_color TEXT DEFAULT NULL,p_archived BOOLEAN DEFAULT FALSE) RETURNS TEXT
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_org UUID := public.user_org_id(); v_key TEXT := p_key;
BEGIN
  IF v_org IS NULL OR NOT public.is_org_admin_for(v_org) THEN RAISE EXCEPTION 'HIERARCHY_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_type NOT IN ('parent','category') OR p_type IS NULL THEN RAISE EXCEPTION 'INVALID_DEFINITION_TYPE' USING ERRCODE = '23514'; END IF;
  IF p_color IS NOT NULL AND p_color NOT IN (
    '#a8841f','#b8761c','#c0652f','#c2533f','#e85060','#cf4f7d','#9a7442','#a88868',
    '#2f8fcf','#1098b0','#14998f','#5a72d9','#7f68d6','#a256b8','#c4469e','#a080a8',
    '#3a9461','#3f9a1e','#86932b','#809080','#7f8aa3','#507880','#a08080','#787078') THEN
    RAISE EXCEPTION 'HIERARCHY_INVALID_COLOR' USING ERRCODE = '23514';
  END IF;
  IF v_key IS NULL THEN
    v_key := 'custom_' || translate(replace(gen_random_uuid()::text,'-',''),'0123456789','ghijklmnop');
    IF p_type = 'parent' THEN
      INSERT INTO public.bank_spending_parent_definitions(organization_id,key,name,color) VALUES(v_org,v_key,trim(p_name),p_color);
    ELSE
      INSERT INTO public.bank_spending_category_definitions(organization_id,key,name,parent_key,builtin) VALUES(v_org,v_key,trim(p_name),p_parent_key,FALSE);
    END IF;
  ELSIF p_type = 'parent' THEN
    UPDATE public.bank_spending_parent_definitions SET name = trim(p_name),color = p_color,archived = p_archived WHERE organization_id = v_org AND key = v_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'DEFINITION_NOT_FOUND' USING ERRCODE = '23514'; END IF;
  ELSE
    UPDATE public.bank_spending_category_definitions SET name = trim(p_name),parent_key = p_parent_key,archived = p_archived WHERE organization_id = v_org AND key = v_key;
    IF NOT FOUND THEN RAISE EXCEPTION 'DEFINITION_NOT_FOUND' USING ERRCODE = '23514'; END IF;
  END IF;
  IF p_type = 'category' THEN PERFORM public.cash_os_set_display_color('category',v_key,p_color); END IF;
  RETURN v_key;
END; $$;
REVOKE ALL ON FUNCTION public.bank_spending_manage_definition(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bank_spending_manage_definition(TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN) TO authenticated;

-- Audit leaf recolors in their EXISTING authoritative display-color store, including direct Colors-panel changes.
CREATE FUNCTION public.bank_spending_audit_category_color() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org UUID; v_key TEXT; v_kind TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN v_org := OLD.organization_id; v_key := OLD.category_key; v_kind := OLD.target_kind;
  ELSE v_org := NEW.organization_id; v_key := NEW.category_key; v_kind := NEW.target_kind; END IF;
  IF v_kind = 'category' AND EXISTS (SELECT 1 FROM public.bank_spending_category_definitions WHERE organization_id = v_org AND key = v_key) THEN
    INSERT INTO public.bank_spending_hierarchy_history(organization_id,definition_type,definition_key,before_value,after_value,actor_user_id)
    VALUES(v_org,'category',v_key,CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE jsonb_build_object('color',OLD.color) END,
      jsonb_build_object('color',CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.color END),auth.uid());
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER bank_spending_audit_category_color AFTER INSERT OR UPDATE OR DELETE ON public.cash_os_display_colors
  FOR EACH ROW EXECUTE FUNCTION public.bank_spending_audit_category_color();
REVOKE ALL ON FUNCTION public.bank_spending_audit_category_color() FROM PUBLIC,anon,authenticated;

-- Guard new confirmations, including direct suggested -> confirmed updates.
-- Run after trg_fpx_00_immutable and before trg_fpx_10_validate. Existing
-- identity immutability still rejects combined key/org/kind/status changes.
-- Non-confirming updates (including atomic replacement undo/history) remain valid.
-- Narrow definer: locked reads only. FOR SHARE needs UPDATE privileges, which
-- owners must not receive on controls. Explicit caller checks preserve authority;
-- direct EXECUTE is revoked and no financial/metadata row is written here.
CREATE FUNCTION public.bank_spending_guard_custom_assignment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'confirmed' OR NEW.status IS DISTINCT FROM 'confirmed' THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.kind = 'category' AND NEW.status = 'confirmed' AND NEW.category NOT IN
    ('materials','fuel_vehicle','tools_equipment','software_subscriptions','insurance','payroll_people','permits_fees',
     'marketing','meals','office_admin','bank_finance_fees','personal_owner','taxes','transfers','owner_draw','customer_payment','refund','other_needs_review') THEN
    IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND
      (NEW.organization_id IS DISTINCT FROM public.user_org_id() OR NOT public.is_org_admin_for(NEW.organization_id)) THEN
      RAISE EXCEPTION 'HIERARCHY_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.bank_spending_hierarchy_controls WHERE organization_id = NEW.organization_id AND writes_enabled FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'HIERARCHY_WRITES_DISABLED' USING ERRCODE = '42501'; END IF;
    PERFORM 1 FROM public.bank_spending_category_definitions WHERE organization_id = NEW.organization_id AND key = NEW.category AND NOT builtin AND NOT archived FOR SHARE;
    IF NOT FOUND OR NEW.source <> 'owner' THEN RAISE EXCEPTION 'CUSTOM_CATEGORY_UNAVAILABLE' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_fpx_01_bank6g_custom_confirmation BEFORE INSERT OR UPDATE ON public.financial_provider_interpretations
  FOR EACH ROW EXECUTE FUNCTION public.bank_spending_guard_custom_assignment();
REVOKE ALL ON FUNCTION public.bank_spending_guard_custom_assignment() FROM PUBLIC,anon,authenticated;
-- Single-statement, service-only report source. A cap is explicitly incomplete, never a total.
CREATE FUNCTION public.bank_spending_report_source(p_organization_id UUID, p_since DATE) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH tx AS MATERIALIZED (
    SELECT id,provider_account_ref,transaction_date,name,merchant_name,provider_amount_minor,pending,removed_at,provider_category
    FROM public.financial_provider_transactions WHERE organization_id = p_organization_id AND transaction_date >= p_since
    ORDER BY transaction_date DESC,id LIMIT 50001
  ), dec AS MATERIALIZED (
    SELECT id,provider_transaction_ref,kind,status,category,project_id,obligation_id,cash_commitment_id,debt_account_id,
      counterpart_provider_transaction_ref,confidence,source,decided_at
    FROM public.financial_provider_interpretations WHERE organization_id = p_organization_id AND status IN ('confirmed','rejected')
    ORDER BY created_at,id LIMIT 100001
  ), obl AS MATERIALIZED (
    SELECT id,name,amount_minor AS "amountMinor",amount_type AS "amountType",estimated_min_minor AS "estimatedMinMinor",estimated_max_minor AS "estimatedMaxMinor",
      recurrence_kind AS "recurrenceKind",recurrence_interval AS "recurrenceInterval",anchor_date AS "anchorDate",start_date AS "startDate",end_date AS "endDate",status,account_id AS "accountId"
    FROM public.financial_obligations WHERE organization_id = p_organization_id AND status = 'active' ORDER BY id LIMIT 10001
  ), occ AS MATERIALIZED (
    SELECT obligation_id AS "obligationId",scheduled_date AS "scheduledDate",override_date AS "overrideDate",override_amount_minor AS "overrideAmountMinor",status,reconciliation_state AS "reconciliationState"
    FROM public.financial_obligation_occurrences WHERE organization_id = p_organization_id ORDER BY obligation_id,scheduled_date LIMIT 10001
  ), com AS MATERIALIZED (
    SELECT id,title,expected_date AS "expectedDate",amount_minor AS "amountMinor",amount_type AS "amountType",estimated_min_minor AS "estimatedMinMinor",estimated_max_minor AS "estimatedMaxMinor",status,reconciliation_state AS "reconciliationState",account_id AS "accountId"
    FROM public.cash_commitments WHERE organization_id = p_organization_id AND status = 'scheduled' ORDER BY id LIMIT 10001
  ), project AS MATERIALIZED (
    SELECT id::text AS id,name FROM public.projects WHERE org_id = p_organization_id AND status <> 'canceled' ORDER BY id LIMIT 10001
  ), rule AS MATERIALIZED (
    SELECT id,merchant_key AS "merchantKey",merchant_label AS "merchantLabel",category,updated_at AS "updatedAt"
    FROM public.financial_provider_merchant_rules WHERE organization_id = p_organization_id AND status = 'active' ORDER BY id LIMIT 10001
  )
  SELECT jsonb_build_object('complete',(SELECT count(*) <= 50000 FROM tx) AND (SELECT count(*) <= 100000 FROM dec)
    AND (SELECT count(*) <= 10000 FROM obl) AND (SELECT count(*) <= 10000 FROM occ) AND (SELECT count(*) <= 10000 FROM com)
    AND (SELECT count(*) <= 10000 FROM project) AND (SELECT count(*) <= 10000 FROM rule),
    'txs',CASE WHEN (SELECT count(*) <= 50000 FROM tx) AND (SELECT count(*) <= 100000 FROM dec)
      THEN COALESCE((SELECT jsonb_agg(to_jsonb(tx)) FROM tx),'[]'::jsonb) ELSE '[]'::jsonb END,
    'decisions',CASE WHEN (SELECT count(*) <= 100000 FROM dec) THEN COALESCE((SELECT jsonb_agg(to_jsonb(dec)) FROM dec),'[]'::jsonb) ELSE '[]'::jsonb END,
    'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('providerAccountRef',a.id,'label',a.name,'mask',a.mask,
      'ownership',f.ownership_context,'financialAccountId',f.id,'financialAccountName',f.display_name,'environment',i.environment))
      FROM public.financial_provider_accounts a
      JOIN public.financial_provider_items i ON i.id = a.provider_item_ref AND i.organization_id = a.organization_id
      LEFT JOIN public.financial_provider_account_mappings m ON m.provider_account_ref = a.id AND m.organization_id = a.organization_id AND m.status = 'active'
      LEFT JOIN public.financial_accounts f ON f.id = m.financial_account_id AND f.organization_id = a.organization_id
      WHERE a.organization_id = p_organization_id),'[]'::jsonb),
    'hierarchy',public.bank_spending_read_hierarchy(p_organization_id),
    'context',jsonb_build_object(
      'obligations',COALESCE((SELECT jsonb_agg(to_jsonb(obl)) FROM obl),'[]'::jsonb),
      'occurrences',COALESCE((SELECT jsonb_agg(to_jsonb(occ)) FROM occ),'[]'::jsonb),
      'commitments',COALESCE((SELECT jsonb_agg(to_jsonb(com)) FROM com),'[]'::jsonb),
      'projects',COALESCE((SELECT jsonb_agg(to_jsonb(project)) FROM project),'[]'::jsonb),
      'merchantRules',COALESCE((SELECT jsonb_agg(to_jsonb(rule)) FROM rule),'[]'::jsonb),
      'debts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'label',display_name,'accountType',account_type)) FROM public.financial_accounts
        WHERE organization_id = p_organization_id AND account_class = 'liability' AND status = 'active'),'[]'::jsonb)));
$$;
REVOKE ALL ON FUNCTION public.bank_spending_report_source(UUID,DATE) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bank_spending_report_source(UUID,DATE) TO service_role;
COMMIT;
