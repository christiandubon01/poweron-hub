-- PLAID-1B REVIEW DRAFT. NOT a registered or approved production migration. Do not run with `supabase db push`.
-- Install only after separate owner approval, as ONE named tracked migration (suggested name: plaid1b_sync_audit), after re-checking the production
-- catalog (migration history ends at 156 although the 157/158 objects exist; BANK-6G was installed separately). Never repair or reapply 157/158.
--
-- Adds two APPEND-ONLY audit tables. Nothing existing is altered, rewritten or deleted:
--   1. financial_provider_sync_runs           one row per sync-run event (started / completed / failed / superseded). No cursor, token, account id,
--                                              transaction id, name or amount: cursor progress is a 16-hex one-way fingerprint.
--   2. financial_provider_transaction_revisions  the PRIOR values of a provider transaction whenever Plaid modifies it, or it is removed / restored,
--                                              written by an AFTER UPDATE trigger on financial_provider_transactions. Evidence rows are still never
--                                              deleted; this keeps what an in-place update used to overwrite.
--
-- Security (same conventions as migrations 153-156): RLS on; owners/admins of the organization may SELECT; nothing for anon/PUBLIC; inserts come
-- only from the service role (server sync) or from the trigger running as that writer; UPDATE and DELETE are refused for every role by trigger.
--
-- Rollback (preserving data is the default): `DROP TRIGGER trg_fpt_80_revision ON public.financial_provider_transactions;` stops new revisions;
-- unset PLAID_SYNC_AUDIT_ENABLED stops run rows. Dropping the two tables is a separate, explicit decision because it deletes audit history.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_provider_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_item_ref UUID NOT NULL,
  run_id UUID NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('started', 'completed', 'failed', 'superseded')),
  run_trigger TEXT NOT NULL CHECK (run_trigger IN ('owner', 'owner_background', 'webhook', 'schedule')),
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('synced', 'waiting', 'unconfirmed')),
  added_count INTEGER CHECK (added_count IS NULL OR added_count >= 0),
  modified_count INTEGER CHECK (modified_count IS NULL OR modified_count >= 0),
  removed_count INTEGER CHECK (removed_count IS NULL OR removed_count >= 0),
  pending_count INTEGER CHECK (pending_count IS NULL OR pending_count >= 0),
  pending_linked_count INTEGER CHECK (pending_linked_count IS NULL OR pending_linked_count >= 0),
  page_count INTEGER CHECK (page_count IS NULL OR page_count >= 0),
  restart_count INTEGER CHECK (restart_count IS NULL OR restart_count >= 0),
  skipped_count INTEGER CHECK (skipped_count IS NULL OR skipped_count >= 0),
  start_cursor_fingerprint TEXT CHECK (start_cursor_fingerprint IS NULL OR start_cursor_fingerprint ~ '^[0-9a-f]{16}$'),
  end_cursor_fingerprint TEXT CHECK (end_cursor_fingerprint IS NULL OR end_cursor_fingerprint ~ '^[0-9a-f]{16}$'),
  cursor_advanced BOOLEAN,
  error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,64}$'),
  error_stage TEXT CHECK (error_stage IS NULL OR error_stage IN ('credential', 'provider_request', 'provider_response', 'transform', 'account_resolution', 'evidence_persistence', 'cursor_finalize')),
  recovery TEXT CHECK (recovery IS NULL OR recovery IN ('retry', 'reconnect', 'refresh_accounts', 'owner_review', 'none')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_sync_runs_event_unique UNIQUE (run_id, event),
  CONSTRAINT financial_provider_sync_runs_item_fk FOREIGN KEY (provider_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_sync_runs_completed_shape CHECK (event <> 'completed' OR (outcome IS NOT NULL AND error_code IS NULL)),
  CONSTRAINT financial_provider_sync_runs_failure_shape CHECK (event NOT IN ('failed', 'superseded') OR (error_code IS NOT NULL AND cursor_advanced IS NOT TRUE))
);
CREATE INDEX IF NOT EXISTS idx_financial_provider_sync_runs_item_time
  ON public.financial_provider_sync_runs (organization_id, provider_item_ref, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.financial_provider_transaction_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_transaction_ref UUID NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('modified', 'removed', 'restored')),
  prior_values JSONB NOT NULL CHECK (jsonb_typeof(prior_values) = 'object' AND public.financial_provider_json_is_safe(prior_values)),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_revisions_tx_fk FOREIGN KEY (provider_transaction_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_financial_provider_revisions_tx
  ON public.financial_provider_transaction_revisions (organization_id, provider_transaction_ref, changed_at);

-- Prior values only for the evidence fields Plaid can change. Identity columns are already immutable (migration 153).
CREATE OR REPLACE FUNCTION public.financial_provider_record_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.financial_provider_transaction_revisions (organization_id, provider_transaction_ref, change_kind, prior_values)
  VALUES (OLD.organization_id, OLD.id,
    CASE WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN 'removed'
         WHEN OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL THEN 'restored'
         ELSE 'modified' END,
    jsonb_build_object(
      'pending', OLD.pending, 'pending_provider_transaction_id', OLD.pending_provider_transaction_id,
      'provider_amount', OLD.provider_amount, 'provider_amount_minor', OLD.provider_amount_minor,
      'transaction_date', OLD.transaction_date, 'authorized_date', OLD.authorized_date,
      'name', OLD.name, 'merchant_name', OLD.merchant_name, 'provider_category', OLD.provider_category,
      'removed_at', OLD.removed_at, 'last_updated_at', OLD.updated_at));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_fpt_80_revision ON public.financial_provider_transactions;
CREATE TRIGGER trg_fpt_80_revision AFTER UPDATE ON public.financial_provider_transactions
  FOR EACH ROW
  WHEN ((OLD.pending, OLD.pending_provider_transaction_id, OLD.provider_amount_minor, OLD.transaction_date, OLD.authorized_date,
         OLD.name, OLD.merchant_name, OLD.provider_category, OLD.removed_at)
        IS DISTINCT FROM
        (NEW.pending, NEW.pending_provider_transaction_id, NEW.provider_amount_minor, NEW.transaction_date, NEW.authorized_date,
         NEW.name, NEW.merchant_name, NEW.provider_category, NEW.removed_at))
  EXECUTE FUNCTION public.financial_provider_record_revision();

-- Append-only for every role (migration 153's guard raises on any UPDATE; the same function refuses DELETE here).
DROP TRIGGER IF EXISTS trg_fpsr_00_append_only ON public.financial_provider_sync_runs;
CREATE TRIGGER trg_fpsr_00_append_only BEFORE UPDATE OR DELETE ON public.financial_provider_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_block_update();
DROP TRIGGER IF EXISTS trg_fptr_00_append_only ON public.financial_provider_transaction_revisions;
CREATE TRIGGER trg_fptr_00_append_only BEFORE UPDATE OR DELETE ON public.financial_provider_transaction_revisions
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_block_update();

ALTER TABLE public.financial_provider_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_transaction_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_provider_sync_runs, public.financial_provider_transaction_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_provider_sync_runs, public.financial_provider_transaction_revisions TO authenticated;
GRANT SELECT, INSERT ON public.financial_provider_sync_runs, public.financial_provider_transaction_revisions TO service_role;

DROP POLICY IF EXISTS financial_provider_sync_runs_owner_admin_select ON public.financial_provider_sync_runs;
CREATE POLICY financial_provider_sync_runs_owner_admin_select ON public.financial_provider_sync_runs FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
DROP POLICY IF EXISTS financial_provider_revisions_owner_admin_select ON public.financial_provider_transaction_revisions;
CREATE POLICY financial_provider_revisions_owner_admin_select ON public.financial_provider_transaction_revisions FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

REVOKE ALL ON FUNCTION public.financial_provider_record_revision() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.financial_provider_sync_runs IS
  'PLAID-1B append-only sync-run audit. No cursor, token, provider id or transaction text: cursor progress is a one-way 16-hex fingerprint.';
COMMENT ON TABLE public.financial_provider_transaction_revisions IS
  'PLAID-1B append-only prior values of provider transaction evidence before Plaid modified, removed or restored it. Evidence rows are never deleted.';

COMMIT;
