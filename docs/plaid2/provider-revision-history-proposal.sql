-- PLAID-2C REVIEW DRAFT. NOT a registered or approved production migration. Do not run with `supabase db push`.
-- Install only after separate owner approval, as ONE named tracked migration (suggested name: plaid2c_provider_revision_history), after re-checking the
-- production catalog. Never repair or reapply 157/158. Requires migrations 153-156 (already installed).
--
-- RELATION TO THE PLAID-1B DRAFT (docs/plaid1b/sync-audit-proposal.sql)
--   1B proposed a `financial_provider_transaction_revisions` table holding PRIOR values only. This draft replaces that half of 1B with a stronger form:
--   it records prior AND new values, which fields changed, which sync run caused it, and chains each row to the previous one by hash, so a missing or
--   edited row is detectable. If this draft is approved, install 1B's `financial_provider_sync_runs` half only (or skip 1B), NOT its revisions half:
--   both would watch the same table. The two table names differ on purpose so neither draft breaks the other.
--
-- WHAT IS KEPT, AND WHAT IS NOT
--   * Provider FACTS only: pending flag, pending link, amount, dates, names, category, original description, raw payload, removed_at.
--   * Never owner classifications (financial_provider_interpretations) or derived reporting interpretations: those keep their own audit trail.
--   * Never credentials: the existing JSON safety check (financial_provider_json_is_safe) is applied to both snapshots.
--
-- TAMPER RESISTANCE
--   * No role can INSERT: rows are written only by the AFTER UPDATE trigger, a SECURITY DEFINER function with a fixed search_path.
--     service_role keeps SELECT only, so the server that syncs cannot forge, edit or delete history.
--   * UPDATE, DELETE and TRUNCATE are refused by trigger for every role that does not own the table.
--   * Each row stores row_hash = sha256(previous row's hash || transaction || revision number || kind || prior || new). The verification function
--     recomputes the chain; a deleted, reordered or edited row breaks it.
--   * Idempotent by construction: the trigger fires only when a provider fact actually changed, so re-applying the same sync records nothing, and
--     (transaction, revision_no) is unique.
--
-- PROVENANCE: the sync apply function sets the transaction-local setting `poweron.sync_run_id`; the trigger copies it. It is an advisory pointer to the
-- staging/audit run (only the server can write evidence at all) and is NULL for changes made outside a sync.
--
-- Security (conventions of migrations 153-156): RLS on; owner/admin of the organization may SELECT; nothing for anon/PUBLIC.
-- Rollback: `DROP TRIGGER trg_fpt_81_history ON public.financial_provider_transactions;` stops new rows and changes nothing else. Dropping the table is
-- a separate, explicit decision because it deletes audit history.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_provider_transaction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_transaction_ref UUID NOT NULL,
  revision_no INTEGER NOT NULL CHECK (revision_no >= 1),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('modified', 'removed', 'restored')),
  changed_fields TEXT[] NOT NULL CHECK (cardinality(changed_fields) >= 1),
  prior_values JSONB NOT NULL CHECK (jsonb_typeof(prior_values) = 'object' AND public.financial_provider_json_is_safe(prior_values)),
  new_values JSONB NOT NULL CHECK (jsonb_typeof(new_values) = 'object' AND public.financial_provider_json_is_safe(new_values)),
  sync_run_id UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash TEXT CHECK (prev_hash IS NULL OR prev_hash ~ '^[0-9a-f]{64}$'),
  row_hash TEXT NOT NULL CHECK (row_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT financial_provider_history_revision_unique UNIQUE (provider_transaction_ref, revision_no),
  CONSTRAINT financial_provider_history_first_has_no_prev CHECK ((revision_no = 1) = (prev_hash IS NULL)),
  CONSTRAINT financial_provider_history_tx_fk FOREIGN KEY (provider_transaction_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_financial_provider_history_tx
  ON public.financial_provider_transaction_history (organization_id, provider_transaction_ref, revision_no);

-- The provider facts of one evidence row as a JSON object (single definition used for both snapshots).
CREATE OR REPLACE FUNCTION public.financial_provider_fact_snapshot(p public.financial_provider_transactions)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'pending', p.pending, 'pending_provider_transaction_id', p.pending_provider_transaction_id,
    'provider_amount', p.provider_amount, 'provider_amount_minor', p.provider_amount_minor, 'currency', p.currency,
    'transaction_date', p.transaction_date, 'authorized_date', p.authorized_date,
    'name', p.name, 'merchant_name', p.merchant_name, 'original_description', p.original_description,
    'provider_category', p.provider_category, 'raw_payload', p.raw_payload, 'removed_at', p.removed_at);
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_record_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prior JSONB := public.financial_provider_fact_snapshot(OLD);
  v_new JSONB := public.financial_provider_fact_snapshot(NEW);
  v_fields TEXT[];
  v_no INTEGER;
  v_prev TEXT;
  v_kind TEXT;
  v_run UUID;
BEGIN
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::TEXT[]) INTO v_fields
    FROM jsonb_object_keys(v_new) k WHERE v_prior -> k IS DISTINCT FROM v_new -> k;
  IF cardinality(v_fields) = 0 THEN RETURN NULL; END IF;
  v_kind := CASE WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN 'removed'
                 WHEN OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL THEN 'restored'
                 ELSE 'modified' END;
  BEGIN
    v_run := nullif(current_setting('poweron.sync_run_id', true), '')::UUID;
  EXCEPTION WHEN others THEN v_run := NULL;
  END;
  -- The evidence row is locked by the UPDATE that fired this trigger, so revision numbers for one transaction are serialized.
  SELECT h.revision_no, h.row_hash INTO v_no, v_prev FROM public.financial_provider_transaction_history h
    WHERE h.organization_id = OLD.organization_id AND h.provider_transaction_ref = OLD.id ORDER BY h.revision_no DESC LIMIT 1;
  v_no := coalesce(v_no, 0) + 1;
  INSERT INTO public.financial_provider_transaction_history (
    organization_id, provider_transaction_ref, revision_no, change_kind, changed_fields, prior_values, new_values, sync_run_id, prev_hash, row_hash)
  VALUES (OLD.organization_id, OLD.id, v_no, v_kind, v_fields, v_prior, v_new, v_run, v_prev,
    encode(sha256(convert_to(coalesce(v_prev, '') || '|' || OLD.id::text || '|' || v_no::text || '|' || v_kind || '|' || v_prior::text || '|' || v_new::text, 'UTF8')), 'hex'));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_fpt_81_history ON public.financial_provider_transactions;
CREATE TRIGGER trg_fpt_81_history AFTER UPDATE ON public.financial_provider_transactions
  FOR EACH ROW
  WHEN ((OLD.pending, OLD.pending_provider_transaction_id, OLD.provider_amount, OLD.provider_amount_minor, OLD.currency, OLD.transaction_date, OLD.authorized_date,
         OLD.name, OLD.merchant_name, OLD.original_description, OLD.provider_category, OLD.raw_payload, OLD.removed_at)
        IS DISTINCT FROM
        (NEW.pending, NEW.pending_provider_transaction_id, NEW.provider_amount, NEW.provider_amount_minor, NEW.currency, NEW.transaction_date, NEW.authorized_date,
         NEW.name, NEW.merchant_name, NEW.original_description, NEW.provider_category, NEW.raw_payload, NEW.removed_at))
  EXECUTE FUNCTION public.financial_provider_record_history();

-- Append-only for every role that is not the table owner: UPDATE, DELETE and TRUNCATE are refused.
CREATE OR REPLACE FUNCTION public.financial_provider_history_refuse()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;
DROP TRIGGER IF EXISTS trg_fpth_00_append_only ON public.financial_provider_transaction_history;
CREATE TRIGGER trg_fpth_00_append_only BEFORE UPDATE OR DELETE ON public.financial_provider_transaction_history
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_history_refuse();
DROP TRIGGER IF EXISTS trg_fpth_01_no_truncate ON public.financial_provider_transaction_history;
CREATE TRIGGER trg_fpth_01_no_truncate BEFORE TRUNCATE ON public.financial_provider_transaction_history
  FOR EACH STATEMENT EXECUTE FUNCTION public.financial_provider_history_refuse();

-- Chain verification for one transaction (or, with NULL, one organization): returns the first transaction whose chain is broken, if any.
CREATE OR REPLACE FUNCTION public.financial_provider_verify_history(p_organization_id UUID, p_provider_transaction_ref UUID DEFAULT NULL)
RETURNS TABLE(provider_transaction_ref UUID, first_bad_revision INTEGER, problem TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ordered AS (
    SELECT h.*, lag(h.row_hash) OVER (PARTITION BY h.provider_transaction_ref ORDER BY h.revision_no) AS expected_prev,
           lag(h.revision_no) OVER (PARTITION BY h.provider_transaction_ref ORDER BY h.revision_no) AS prev_no
      FROM public.financial_provider_transaction_history h
     WHERE h.organization_id = p_organization_id AND (p_provider_transaction_ref IS NULL OR h.provider_transaction_ref = p_provider_transaction_ref)
  ), checked AS (
    SELECT o.provider_transaction_ref, o.revision_no,
      CASE WHEN (o.prev_no IS NULL AND o.revision_no <> 1) OR (o.prev_no IS NOT NULL AND o.revision_no <> o.prev_no + 1) THEN 'REVISION_GAP'
           WHEN o.prev_hash IS DISTINCT FROM o.expected_prev THEN 'CHAIN_BROKEN'
           WHEN o.row_hash <> encode(sha256(convert_to(coalesce(o.prev_hash, '') || '|' || o.provider_transaction_ref::text || '|' || o.revision_no::text || '|' ||
                 o.change_kind || '|' || o.prior_values::text || '|' || o.new_values::text, 'UTF8')), 'hex') THEN 'ROW_ALTERED' END AS problem
      FROM ordered o)
  SELECT c.provider_transaction_ref, min(c.revision_no), (array_agg(c.problem ORDER BY c.revision_no))[1]
    FROM checked c WHERE c.problem IS NOT NULL GROUP BY c.provider_transaction_ref;
$$;

ALTER TABLE public.financial_provider_transaction_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_provider_history_owner_admin_select ON public.financial_provider_transaction_history;
CREATE POLICY financial_provider_history_owner_admin_select ON public.financial_provider_transaction_history FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
REVOKE ALL ON public.financial_provider_transaction_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.financial_provider_transaction_history TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.financial_provider_record_history() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.financial_provider_history_refuse() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_fact_snapshot(public.financial_provider_transactions) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_fact_snapshot(public.financial_provider_transactions) TO service_role;
REVOKE ALL ON FUNCTION public.financial_provider_verify_history(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_verify_history(UUID, UUID) TO service_role;

COMMENT ON TABLE public.financial_provider_transaction_history IS
  'PLAID-2C append-only, hash-chained history of PROVIDER FACTS of a transaction (prior and new values, changed fields, sync run). Written only by trigger; never contains owner classifications or derived interpretations.';
COMMENT ON FUNCTION public.financial_provider_verify_history(UUID, UUID) IS
  'PLAID-2C (service_role only). Recomputes the hash chain; returns each transaction whose history has a gap, a broken link or an altered row.';

COMMIT;
