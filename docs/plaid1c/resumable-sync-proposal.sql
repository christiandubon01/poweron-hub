-- PLAID-1C REVIEW DRAFT. NOT a registered or approved production migration. Do not run with `supabase db push`.
-- Install only after separate owner approval, as ONE named tracked migration (suggested name: plaid1c_resumable_sync), after re-checking the
-- production catalog (history ends at 156 although the 157/158 objects exist; BANK-6G was installed separately). Never repair or reapply 157/158.
-- Independent of the PLAID-1B audit draft; both may be installed, in either order.
--
-- WHY: Netlify Free functions are short. A large /transactions/sync update (a multi-account backfill) must be fetched over SEVERAL requests, but
-- Plaid requires restarting an update from the cursor it STARTED with when TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION occurs, so the committed
-- cursor and the visible evidence must not move until the WHOLE update has been received. Pages are therefore STAGED here, then applied together
-- with the cursor in ONE transaction:
--   financial_provider_sync_staging_runs     one row per Plaid update being fetched (run identity, generation, page progress, server-only cursors)
--   financial_provider_sync_staged_changes   the allowlisted added / modified / removed rows of each staged page (never read by any report)
--   financial_provider_sync_open_run         resume the Item's open run, or start one at the Item's committed cursor
--   financial_provider_sync_stage_page       ONE page, atomically: replace that page's rows and advance the page cursor (compare-and-set)
--   financial_provider_sync_restart_run      mutation during pagination: new generation from the START cursor; older staged rows discarded
--   financial_provider_sync_abandon_run      give up a run (its staged rows are discarded; evidence and cursor untouched)
--   financial_provider_sync_record_apply_failure  count a failed final apply; the third one BLOCKS the run for owner review (PLAID-1E)
--   financial_provider_sync_apply_run        ONE transaction: apply the update to financial_provider_transactions in provider order, move the
--                                            committed cursor, stamp success, release the Item lease. Refuses unless the caller still holds the
--                                            lease and the committed cursor is still the run's start cursor.
--
-- Safeguards (PLAID-1E): a run holds at most 50,000 staged rows (callers may lower, never raise, the limit); a larger update BLOCKS the run
-- (status 'blocked', staged rows kept) instead of growing an apply that could not finish inside the database statement timeout. A run whose
-- final apply fails three times is blocked the same way, so a deterministic failure cannot retry forever. A blocked run is never applied,
-- restarted, expired or replaced automatically: it needs owner review (financial_provider_sync_abandon_run is the only exit).
--
-- Security (conventions of migrations 153-156): both tables are SERVER-ONLY (RLS on, no policy, nothing for PUBLIC/anon/authenticated) because
-- they hold Plaid cursors. Functions are SECURITY INVOKER with a fixed search_path, EXECUTE for service_role only, and re-check that every id
-- belongs to the given organization. Evidence rows are never deleted; existing evidence, interpretations, mappings and the ledger are untouched.
--
-- Rollback (nothing else depends on these objects): unset PLAID_RESUMABLE_SYNC_ENABLED, then drop the six functions and the two tables. Staged
-- data is transient by design; applied changes already live in financial_provider_transactions.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_provider_sync_staging_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_item_ref UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'fetching' CHECK (status IN ('fetching', 'fetched', 'blocked', 'applied', 'abandoned')),
  start_cursor TEXT,
  page_cursor TEXT,
  final_cursor TEXT,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation >= 1),
  pages_staged INTEGER NOT NULL DEFAULT 0 CHECK (pages_staged >= 0),
  restarts INTEGER NOT NULL DEFAULT 0 CHECK (restarts >= 0),
  staged_rows INTEGER NOT NULL DEFAULT 0 CHECK (staged_rows >= 0),
  apply_failures INTEGER NOT NULL DEFAULT 0 CHECK (apply_failures >= 0),
  blocked_reason TEXT CHECK (blocked_reason IS NULL OR blocked_reason IN ('RUN_TOO_LARGE', 'APPLY_FAILED_REPEATEDLY')),
  update_status TEXT CHECK (update_status IS NULL OR length(update_status) BETWEEN 1 AND 64),
  abandon_reason TEXT CHECK (abandon_reason IS NULL OR abandon_reason ~ '^[A-Z0-9_]{1,64}$'),
  added_count INTEGER CHECK (added_count IS NULL OR added_count >= 0),
  modified_count INTEGER CHECK (modified_count IS NULL OR modified_count >= 0),
  removed_count INTEGER CHECK (removed_count IS NULL OR removed_count >= 0),
  pending_linked_count INTEGER CHECK (pending_linked_count IS NULL OR pending_linked_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT financial_provider_sync_staging_runs_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT financial_provider_sync_staging_runs_item_fk FOREIGN KEY (provider_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_sync_staging_runs_final_shape CHECK (status NOT IN ('fetched', 'applied') OR final_cursor IS NOT NULL),
  CONSTRAINT financial_provider_sync_staging_runs_finished_shape CHECK ((status IN ('applied', 'abandoned')) = (finished_at IS NOT NULL)),
  CONSTRAINT financial_provider_sync_staging_runs_abandon_shape CHECK ((status = 'abandoned') = (abandon_reason IS NOT NULL)),
  CONSTRAINT financial_provider_sync_staging_runs_blocked_shape CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);
-- At most ONE open run per Item: concurrent requests resume the same run instead of starting a second one. A blocked run stays open.
CREATE UNIQUE INDEX IF NOT EXISTS uq_financial_provider_sync_staging_runs_open
  ON public.financial_provider_sync_staging_runs (provider_item_ref) WHERE status IN ('fetching', 'fetched', 'blocked');
CREATE INDEX IF NOT EXISTS idx_financial_provider_sync_staging_runs_org_item
  ON public.financial_provider_sync_staging_runs (organization_id, provider_item_ref, created_at DESC);

CREATE TABLE IF NOT EXISTS public.financial_provider_sync_staged_changes (
  run_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  generation INTEGER NOT NULL CHECK (generation >= 1),
  page_no INTEGER NOT NULL CHECK (page_no >= 0),
  seq INTEGER NOT NULL CHECK (seq >= 0),
  change_kind TEXT NOT NULL CHECK (change_kind IN ('added', 'modified', 'removed')),
  provider_transaction_id TEXT NOT NULL CHECK (length(trim(provider_transaction_id)) > 0),
  provider_account_ref UUID,
  pending BOOLEAN,
  pending_provider_transaction_id TEXT CHECK (pending_provider_transaction_id IS NULL OR length(trim(pending_provider_transaction_id)) > 0),
  provider_amount NUMERIC(20, 4),
  provider_amount_minor BIGINT,
  currency TEXT CHECK (currency IS NULL OR currency = 'USD'),
  transaction_date DATE,
  authorized_date DATE,
  name TEXT,
  merchant_name TEXT,
  provider_category JSONB,
  PRIMARY KEY (run_id, generation, page_no, seq),
  CONSTRAINT financial_provider_sync_staged_changes_run_fk FOREIGN KEY (run_id, organization_id)
    REFERENCES public.financial_provider_sync_staging_runs(id, organization_id) ON DELETE CASCADE,
  -- The same rules financial_provider_transactions enforces, checked at staging so a bad row can never make the final apply fail.
  CONSTRAINT financial_provider_sync_staged_changes_shape CHECK (
    (change_kind = 'removed' AND provider_account_ref IS NULL AND provider_amount IS NULL AND provider_amount_minor IS NULL)
    OR (change_kind IN ('added', 'modified') AND provider_account_ref IS NOT NULL AND pending IS NOT NULL AND currency = 'USD'
        AND transaction_date IS NOT NULL AND provider_amount IS NOT NULL AND provider_amount_minor IS NOT NULL
        AND provider_amount * 100 = trunc(provider_amount * 100) AND provider_amount_minor::NUMERIC = provider_amount * 100
        AND (pending_provider_transaction_id IS NULL OR NOT pending)
        AND (provider_category IS NULL OR public.financial_provider_json_is_safe(provider_category)))
  )
);

-- ── Open or resume ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.financial_provider_sync_open_run(p_organization_id UUID, p_item_id UUID, p_max_age_seconds INTEGER DEFAULT 86400)
RETURNS TABLE(run_id UUID, status TEXT, generation INTEGER, page_cursor TEXT, pages_staged INTEGER, restarts INTEGER, start_cursor TEXT,
              update_status TEXT, staged_rows INTEGER, opened TEXT, blocked_reason TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_run public.financial_provider_sync_staging_runs%ROWTYPE;
  v_have BOOLEAN := FALSE;
  v_opened TEXT := 'resumed';
BEGIN
  IF p_organization_id IS NULL OR p_item_id IS NULL OR coalesce(p_max_age_seconds, 0) < 60 THEN
    RAISE EXCEPTION 'SYNC_ARGUMENTS_INVALID' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT i.id, i.sync_cursor, i.status INTO v_item FROM public.financial_provider_items i
    WHERE i.id = p_item_id AND i.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_ITEM_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF v_item.status = 'disconnected' THEN RAISE EXCEPTION 'SYNC_ITEM_DISCONNECTED' USING ERRCODE = 'check_violation'; END IF;

  SELECT * INTO v_run FROM public.financial_provider_sync_staging_runs r
    WHERE r.provider_item_ref = p_item_id AND r.organization_id = p_organization_id AND r.status IN ('fetching', 'fetched', 'blocked') FOR UPDATE;
  v_have := FOUND;
  -- A blocked run waits for owner review: it is returned as is, never expired or replaced automatically.
  IF v_have AND v_run.status <> 'blocked' AND (v_run.start_cursor IS DISTINCT FROM v_item.sync_cursor OR v_run.created_at < now() - make_interval(secs => p_max_age_seconds)) THEN
    -- The committed cursor moved by another path, or the run is too old to resume confidently: it can never be applied. Start over.
    UPDATE public.financial_provider_sync_staging_runs SET status = 'abandoned', finished_at = now(), updated_at = now(),
      abandon_reason = CASE WHEN v_run.start_cursor IS DISTINCT FROM v_item.sync_cursor THEN 'CURSOR_MOVED' ELSE 'EXPIRED' END
      WHERE id = v_run.id;
    DELETE FROM public.financial_provider_sync_staged_changes WHERE financial_provider_sync_staged_changes.run_id = v_run.id;
    v_have := FALSE;
  END IF;
  IF NOT v_have THEN
    INSERT INTO public.financial_provider_sync_staging_runs (organization_id, provider_item_ref, start_cursor, page_cursor)
      VALUES (p_organization_id, p_item_id, v_item.sync_cursor, v_item.sync_cursor) RETURNING * INTO v_run;
    v_opened := 'created';
  END IF;
  RETURN QUERY SELECT v_run.id, v_run.status, v_run.generation, v_run.page_cursor, v_run.pages_staged, v_run.restarts, v_run.start_cursor,
    v_run.update_status, v_run.staged_rows, v_opened, v_run.blocked_reason;
END;
$$;

-- ── Stage one page (atomic, compare-and-set on generation + page number) ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.financial_provider_sync_stage_page(
  p_organization_id UUID, p_run_id UUID, p_generation INTEGER, p_page_no INTEGER,
  p_next_cursor TEXT, p_has_more BOOLEAN, p_update_status TEXT, p_changes JSONB, p_max_rows INTEGER DEFAULT 50000)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_run public.financial_provider_sync_staging_runs%ROWTYPE;
  -- Callers may lower the run-size limit (tests do), never raise it above 50,000 rows.
  v_limit INTEGER := least(greatest(coalesce(p_max_rows, 50000), 1), 50000);
BEGIN
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) > 2000
     OR coalesce(p_next_cursor, '') = '' OR p_has_more IS NULL OR p_page_no IS NULL OR p_page_no < 0 THEN
    RAISE EXCEPTION 'SYNC_STAGE_INVALID' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_run FROM public.financial_provider_sync_staging_runs r
    WHERE r.id = p_run_id AND r.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_RUN_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  -- A stale writer (older generation, page already staged by someone else, run finished) changes nothing.
  IF v_run.status <> 'fetching' OR v_run.generation <> p_generation OR v_run.pages_staged <> p_page_no THEN
    RETURN 'stale';
  END IF;
  -- Run-size limit: an update this large is blocked for owner review instead of being applied. Rows staged so far are kept.
  IF v_run.staged_rows + jsonb_array_length(p_changes) > v_limit THEN
    UPDATE public.financial_provider_sync_staging_runs SET status = 'blocked', blocked_reason = 'RUN_TOO_LARGE', updated_at = now() WHERE id = p_run_id;
    RETURN 'blocked';
  END IF;

  DELETE FROM public.financial_provider_sync_staged_changes s
    WHERE s.run_id = p_run_id AND s.generation = p_generation AND s.page_no = p_page_no;
  INSERT INTO public.financial_provider_sync_staged_changes (run_id, organization_id, generation, page_no, seq, change_kind, provider_transaction_id,
    provider_account_ref, pending, pending_provider_transaction_id, provider_amount, provider_amount_minor, currency, transaction_date, authorized_date,
    name, merchant_name, provider_category)
  SELECT p_run_id, p_organization_id, p_generation, p_page_no, (e.ord - 1)::INTEGER, c.change_kind, c.provider_transaction_id,
    c.provider_account_ref, c.pending, c.pending_provider_transaction_id, c.provider_amount, c.provider_amount_minor, c.currency, c.transaction_date,
    c.authorized_date, c.name, c.merchant_name, c.provider_category
  FROM jsonb_array_elements(p_changes) WITH ORDINALITY AS e(value, ord)
  CROSS JOIN LATERAL jsonb_to_record(e.value) AS c(change_kind TEXT, provider_transaction_id TEXT, provider_account_ref UUID, pending BOOLEAN,
    pending_provider_transaction_id TEXT, provider_amount NUMERIC, provider_amount_minor BIGINT, currency TEXT, transaction_date DATE,
    authorized_date DATE, name TEXT, merchant_name TEXT, provider_category JSONB);

  -- Every referenced account must be a provider account of THIS run's Item and organization.
  IF EXISTS (SELECT 1 FROM public.financial_provider_sync_staged_changes s
             WHERE s.run_id = p_run_id AND s.generation = p_generation AND s.page_no = p_page_no AND s.provider_account_ref IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.financial_provider_accounts a
                               WHERE a.id = s.provider_account_ref AND a.provider_item_ref = v_run.provider_item_ref AND a.organization_id = p_organization_id)) THEN
    RAISE EXCEPTION 'SYNC_STAGE_ACCOUNT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.financial_provider_sync_staging_runs SET
    page_cursor = p_next_cursor, pages_staged = pages_staged + 1, staged_rows = staged_rows + jsonb_array_length(p_changes), update_status = left(p_update_status, 64), updated_at = now(),
    status = CASE WHEN p_has_more THEN 'fetching' ELSE 'fetched' END,
    final_cursor = CASE WHEN p_has_more THEN NULL ELSE p_next_cursor END
  WHERE id = p_run_id;
  RETURN 'staged';
END;
$$;

-- ── Mutation during pagination: restart the WHOLE update from its start cursor (Plaid's documented rule) ────────────────────────
CREATE OR REPLACE FUNCTION public.financial_provider_sync_restart_run(p_organization_id UUID, p_run_id UUID, p_generation INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_run public.financial_provider_sync_staging_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.financial_provider_sync_staging_runs r
    WHERE r.id = p_run_id AND r.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_RUN_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF v_run.status <> 'fetching' OR v_run.generation <> p_generation THEN RETURN 'stale'; END IF;
  DELETE FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = p_run_id;
  UPDATE public.financial_provider_sync_staging_runs SET
    generation = generation + 1, page_cursor = start_cursor, pages_staged = 0, staged_rows = 0, restarts = restarts + 1,
    final_cursor = NULL, update_status = NULL, updated_at = now()
  WHERE id = p_run_id;
  RETURN 'restarted';
END;
$$;

CREATE OR REPLACE FUNCTION public.financial_provider_sync_abandon_run(p_organization_id UUID, p_run_id UUID, p_reason TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_reason IS NULL OR p_reason !~ '^[A-Z0-9_]{1,64}$' THEN RAISE EXCEPTION 'SYNC_ARGUMENTS_INVALID' USING ERRCODE = 'invalid_parameter_value'; END IF;
  UPDATE public.financial_provider_sync_staging_runs SET status = 'abandoned', abandon_reason = p_reason, finished_at = now(), updated_at = now()
    WHERE id = p_run_id AND organization_id = p_organization_id AND status IN ('fetching', 'fetched', 'blocked');
  IF NOT FOUND THEN RETURN 'unchanged'; END IF;
  DELETE FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = p_run_id;
  RETURN 'abandoned';
END;
$$;

-- ── Apply the complete update and commit the cursor: ONE transaction ─────────────────────────────────────────────────────────
-- Equivalent to processing the staged pages in provider order (page, then added -> modified -> removed, then position), which is exactly what
-- the synchronous sync does: every transaction ends with the values of its LAST added/modified occurrence, and is marked removed when its LAST
-- occurrence is a removal. Upserts keep the existing evidence row (and therefore every interpretation pointing at it); nothing is deleted.
CREATE OR REPLACE FUNCTION public.financial_provider_sync_apply_run(
  p_organization_id UUID, p_item_id UUID, p_run_id UUID, p_generation INTEGER, p_lease_started_at TIMESTAMPTZ, p_outcome TEXT)
RETURNS TABLE(outcome TEXT, added_count INTEGER, modified_count INTEGER, removed_count INTEGER, pending_linked_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_run public.financial_provider_sync_staging_runs%ROWTYPE;
  v_added INTEGER; v_modified INTEGER; v_removed INTEGER; v_linked INTEGER;
  v_removed_ids TEXT[];
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('synced', 'waiting', 'unconfirmed') THEN
    RAISE EXCEPTION 'SYNC_ARGUMENTS_INVALID' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT i.id, i.sync_cursor, i.sync_status, i.last_sync_started_at INTO v_item FROM public.financial_provider_items i
    WHERE i.id = p_item_id AND i.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_ITEM_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO v_run FROM public.financial_provider_sync_staging_runs r
    WHERE r.id = p_run_id AND r.organization_id = p_organization_id AND r.provider_item_ref = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_RUN_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;

  IF v_run.status = 'applied' THEN
    RETURN QUERY SELECT 'already_applied'::TEXT, v_run.added_count, v_run.modified_count, v_run.removed_count, v_run.pending_linked_count; RETURN;
  END IF;
  IF v_run.status = 'blocked' THEN
    RETURN QUERY SELECT 'blocked'::TEXT, 0, 0, 0, 0; RETURN;
  END IF;
  IF v_run.status <> 'fetched' OR v_run.generation <> p_generation THEN
    RETURN QUERY SELECT 'stale'::TEXT, 0, 0, 0, 0; RETURN;
  END IF;
  -- Fencing: only the request that still holds the Item's sync lease may commit.
  IF v_item.sync_status IS DISTINCT FROM 'syncing' OR v_item.last_sync_started_at IS DISTINCT FROM p_lease_started_at THEN
    RETURN QUERY SELECT 'lease_lost'::TEXT, 0, 0, 0, 0; RETURN;
  END IF;
  -- Cursor compare-and-set: the update must start from the cursor that is still committed.
  IF v_run.start_cursor IS DISTINCT FROM v_item.sync_cursor THEN
    UPDATE public.financial_provider_sync_staging_runs SET status = 'abandoned', abandon_reason = 'CURSOR_MOVED', finished_at = now(), updated_at = now()
      WHERE id = v_run.id;
    DELETE FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = v_run.id;
    RETURN QUERY SELECT 'stale'::TEXT, 0, 0, 0, 0; RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE s.change_kind = 'added'), count(*) FILTER (WHERE s.change_kind = 'modified'),
         count(*) FILTER (WHERE s.change_kind <> 'removed' AND s.pending_provider_transaction_id IS NOT NULL)
    INTO v_added, v_modified, v_linked
    FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = p_run_id AND s.generation = p_generation;

  INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending,
    pending_provider_transaction_id, provider_amount, provider_amount_minor, currency, transaction_date, authorized_date, name, merchant_name,
    provider_category, removed_at)
  SELECT p_organization_id, p_item_id, l.provider_account_ref, l.provider_transaction_id, l.pending, l.pending_provider_transaction_id, l.provider_amount,
    l.provider_amount_minor, l.currency, l.transaction_date, l.authorized_date, l.name, l.merchant_name, l.provider_category, NULL
  FROM (
    SELECT s.*, row_number() OVER (PARTITION BY s.provider_transaction_id
                                   ORDER BY s.page_no DESC, CASE s.change_kind WHEN 'added' THEN 0 ELSE 1 END DESC, s.seq DESC) AS rn
    FROM public.financial_provider_sync_staged_changes s
    WHERE s.run_id = p_run_id AND s.generation = p_generation AND s.change_kind IN ('added', 'modified')
  ) l
  WHERE l.rn = 1
  ON CONFLICT (provider_item_ref, provider_transaction_id) DO UPDATE SET
    provider_account_ref = EXCLUDED.provider_account_ref, pending = EXCLUDED.pending, pending_provider_transaction_id = EXCLUDED.pending_provider_transaction_id,
    provider_amount = EXCLUDED.provider_amount, provider_amount_minor = EXCLUDED.provider_amount_minor, currency = EXCLUDED.currency,
    transaction_date = EXCLUDED.transaction_date, authorized_date = EXCLUDED.authorized_date, name = EXCLUDED.name, merchant_name = EXCLUDED.merchant_name,
    provider_category = EXCLUDED.provider_category, removed_at = NULL;

  -- Removals (PLAID-1E): the ids whose LAST event is a removal are computed ONCE, then marked through the identity index
  -- (provider_item_ref, provider_transaction_id). A join here let the planner rescan every staged row per existing evidence row (quadratic).
  SELECT coalesce(array_agg(x.provider_transaction_id), '{}') INTO v_removed_ids FROM (
    SELECT s.provider_transaction_id, s.change_kind,
           row_number() OVER (PARTITION BY s.provider_transaction_id
                              ORDER BY s.page_no DESC, CASE s.change_kind WHEN 'added' THEN 0 WHEN 'modified' THEN 1 ELSE 2 END DESC, s.seq DESC) AS rn
    FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = p_run_id AND s.generation = p_generation
  ) x
  WHERE x.rn = 1 AND x.change_kind = 'removed';
  UPDATE public.financial_provider_transactions t SET removed_at = now()
    WHERE t.provider_item_ref = p_item_id AND t.provider_transaction_id = ANY (v_removed_ids)
      AND t.organization_id = p_organization_id AND t.removed_at IS NULL;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  UPDATE public.financial_provider_items SET
    sync_cursor = v_run.final_cursor, sync_status = 'idle', last_sync_completed_at = now(),
    last_successful_sync_at = CASE WHEN p_outcome = 'synced' THEN now() ELSE last_successful_sync_at END,
    last_error_code = CASE WHEN p_outcome = 'waiting' THEN 'WAITING_FOR_PLAID' ELSE NULL END, last_error_message = NULL, last_error_at = NULL
  WHERE id = p_item_id AND organization_id = p_organization_id;

  UPDATE public.financial_provider_sync_staging_runs SET status = 'applied', finished_at = now(), updated_at = now(),
    added_count = v_added, modified_count = v_modified, removed_count = v_removed, pending_linked_count = v_linked
    WHERE id = p_run_id;
  DELETE FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = p_run_id;

  RETURN QUERY SELECT 'applied'::TEXT, v_added, v_modified, v_removed, v_linked;
END;
$$;

-- ── A failed final apply (PLAID-1E) ───────────────────────────────────────────────────────────────────────────────────────────
-- The apply rolled back, so evidence, cursor and staged rows are unchanged. This counts the failure in its own transaction; the third failure
-- blocks the run for owner review, so a deterministic failure (statement timeout, a constraint) cannot retry forever. Only the request that
-- still holds the Item's lease, on the run's current generation, may count a failure.
CREATE OR REPLACE FUNCTION public.financial_provider_sync_record_apply_failure(
  p_organization_id UUID, p_item_id UUID, p_run_id UUID, p_generation INTEGER, p_lease_started_at TIMESTAMPTZ, p_max_failures INTEGER DEFAULT 3)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_run public.financial_provider_sync_staging_runs%ROWTYPE;
  v_limit INTEGER := least(greatest(coalesce(p_max_failures, 3), 1), 3);
BEGIN
  SELECT i.id, i.sync_status, i.last_sync_started_at INTO v_item FROM public.financial_provider_items i
    WHERE i.id = p_item_id AND i.organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_ITEM_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO v_run FROM public.financial_provider_sync_staging_runs r
    WHERE r.id = p_run_id AND r.organization_id = p_organization_id AND r.provider_item_ref = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SYNC_RUN_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  IF v_run.status = 'blocked' THEN RETURN 'blocked'; END IF;
  IF v_run.status <> 'fetched' OR v_run.generation <> p_generation
     OR v_item.sync_status IS DISTINCT FROM 'syncing' OR v_item.last_sync_started_at IS DISTINCT FROM p_lease_started_at THEN
    RETURN 'stale';
  END IF;
  UPDATE public.financial_provider_sync_staging_runs SET apply_failures = apply_failures + 1, updated_at = now(),
    status = CASE WHEN apply_failures + 1 >= v_limit THEN 'blocked' ELSE status END,
    blocked_reason = CASE WHEN apply_failures + 1 >= v_limit THEN 'APPLY_FAILED_REPEATEDLY' ELSE blocked_reason END
  WHERE id = p_run_id;
  RETURN CASE WHEN v_run.apply_failures + 1 >= v_limit THEN 'blocked' ELSE 'retry' END;
END;
$$;

ALTER TABLE public.financial_provider_sync_staging_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_provider_sync_staged_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_provider_sync_staging_runs, public.financial_provider_sync_staged_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_provider_sync_staging_runs, public.financial_provider_sync_staged_changes TO service_role;

REVOKE ALL ON FUNCTION public.financial_provider_sync_open_run(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_sync_stage_page(UUID, UUID, INTEGER, INTEGER, TEXT, BOOLEAN, TEXT, JSONB, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_sync_record_apply_failure(UUID, UUID, UUID, INTEGER, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_sync_restart_run(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_sync_abandon_run(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.financial_provider_sync_apply_run(UUID, UUID, UUID, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_sync_open_run(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_sync_stage_page(UUID, UUID, INTEGER, INTEGER, TEXT, BOOLEAN, TEXT, JSONB, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_sync_record_apply_failure(UUID, UUID, UUID, INTEGER, TIMESTAMPTZ, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_sync_restart_run(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_sync_abandon_run(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.financial_provider_sync_apply_run(UUID, UUID, UUID, INTEGER, TIMESTAMPTZ, TEXT) TO service_role;

COMMENT ON TABLE public.financial_provider_sync_staging_runs IS
  'PLAID-1C SERVER-ONLY resumable sync runs (one Plaid update fetched over several short requests). Holds Plaid cursors: no browser access.';
COMMENT ON TABLE public.financial_provider_sync_staged_changes IS
  'PLAID-1C SERVER-ONLY staged rows of an incomplete Plaid update. Never read by any report; applied atomically with the cursor, then discarded.';

COMMIT;
