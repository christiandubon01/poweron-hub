-- PLAID-2A REVIEW DRAFT. NOT a registered or approved production migration. Do not run with `supabase db push`.
-- Install only after separate owner approval, as ONE named tracked migration (suggested name: plaid2a_pending_posted_continuity), after re-checking the
-- production catalog. Never repair or reapply 157/158. Requires migrations 153-156 (already installed); independent of the PLAID-1B/1C drafts.
--
-- WHAT IT DOES
--   Plaid replaces a pending transaction with a posted one and tells us so with `pending_transaction_id` on the posted row (stored as
--   financial_provider_transactions.pending_provider_transaction_id). Both rows stay as evidence. This draft:
--     1. records the relationship in an explicit, explainable link table (one row per posted transaction), and
--     2. carries the owner's CONFIRMED category / ignore decisions from the pending row to the posted row as NEW interpretation rows that say
--        where they came from (suggestion_basis.inherited_from_*). The pending row's own decisions are never touched.
--
-- SAFETY RULES (each is a tested behaviour)
--   * Deterministic only: the link is Plaid's pending_transaction_id inside the same Item. No fuzzy matching of names or amounts.
--   * Same provider account, same money direction. Anything else is recorded as 'mismatch' and inherits nothing.
--   * If two live posted rows claim the same pending id, BOTH are 'ambiguous' and nothing is inherited (owner review).
--   * A posted row that already has a confirmed decision of the same kind keeps it. A decision the owner made or undid on the posted row AFTER the
--     pending decision (newer decided_at / undone_at) is never overwritten or re-created. A merely 'suggested' row is superseded (status undone).
--   * Idempotent: re-running changes nothing. Each pending decision is inherited at most once per posted row.
--   * Provider evidence (amounts, dates, names, removed_at) is never modified. Nothing is deleted.
--   * Relationship decisions (transfer, project, bill ...) are never inherited: a pending row cannot hold one, and the owner decides those on the posted row.
--
-- Security (conventions of migrations 153-156): RLS on; owner/admin of the organization may SELECT links; the function is SECURITY INVOKER, EXECUTE for
-- service_role only; the organization is supplied by the trusted server and every row it touches is re-checked against it.
--
-- Rollback: stop calling the function (unset PLAID_PENDING_CONTINUITY_ENABLED). Inherited interpretations are ordinary rows that the owner can undo.
-- Dropping the link table is a separate, explicit decision because it deletes the explanation of why decisions were inherited.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_provider_pending_posted_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  provider_item_ref UUID NOT NULL,
  posted_ref UUID NOT NULL,
  pending_ref UUID,
  pending_provider_transaction_id TEXT NOT NULL CHECK (length(trim(pending_provider_transaction_id)) > 0),
  status TEXT NOT NULL CHECK (status IN ('linked', 'ambiguous', 'unresolved', 'mismatch')),
  reason TEXT CHECK (reason IS NULL OR reason ~ '^[A-Z0-9_]{1,64}$'),
  inherited_count INTEGER NOT NULL DEFAULT 0 CHECK (inherited_count >= 0),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT financial_provider_pp_links_posted_unique UNIQUE (posted_ref),
  CONSTRAINT financial_provider_pp_links_linked_has_pending CHECK (status <> 'linked' OR pending_ref IS NOT NULL),
  CONSTRAINT financial_provider_pp_links_distinct CHECK (pending_ref IS NULL OR pending_ref <> posted_ref),
  CONSTRAINT financial_provider_pp_links_posted_fk FOREIGN KEY (posted_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_pp_links_pending_fk FOREIGN KEY (pending_ref, organization_id)
    REFERENCES public.financial_provider_transactions(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT financial_provider_pp_links_item_fk FOREIGN KEY (provider_item_ref, organization_id)
    REFERENCES public.financial_provider_items(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_financial_provider_pp_links_review
  ON public.financial_provider_pending_posted_links (organization_id, status) WHERE status <> 'linked';
CREATE INDEX IF NOT EXISTS idx_financial_provider_pp_links_pending
  ON public.financial_provider_pending_posted_links (pending_ref) WHERE pending_ref IS NOT NULL;
-- Lets the function find "which posted rows claim this pending id" and "which posted rows still need a link" without scanning the Item.
CREATE INDEX IF NOT EXISTS idx_financial_provider_transactions_pending_claim
  ON public.financial_provider_transactions (provider_item_ref, pending_provider_transaction_id)
  WHERE pending_provider_transaction_id IS NOT NULL AND removed_at IS NULL;

DROP TRIGGER IF EXISTS trg_fppl_00_immutable ON public.financial_provider_pending_posted_links;
CREATE TRIGGER trg_fppl_00_immutable BEFORE UPDATE ON public.financial_provider_pending_posted_links
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_enforce_immutable('organization_id', 'provider_item_ref', 'posted_ref', 'pending_provider_transaction_id', 'created_at');
DROP TRIGGER IF EXISTS trg_fppl_10_no_delete ON public.financial_provider_pending_posted_links;
CREATE TRIGGER trg_fppl_10_no_delete BEFORE DELETE ON public.financial_provider_pending_posted_links
  FOR EACH ROW EXECUTE FUNCTION public.financial_provider_block_update();

ALTER TABLE public.financial_provider_pending_posted_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_provider_pp_links_owner_admin_select ON public.financial_provider_pending_posted_links;
CREATE POLICY financial_provider_pp_links_owner_admin_select ON public.financial_provider_pending_posted_links FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));
REVOKE ALL ON public.financial_provider_pending_posted_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_provider_pending_posted_links TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_provider_pending_posted_links TO service_role;

-- ── The link + inherit step. Safe to call after every sync, concurrently, repeatedly. ───────────────────────────────────────────
-- Set-based (a handful of statements per call, whatever the batch): classify -> record links -> plan inheritance -> apply. The plan lives in a
-- transaction-local temporary table so the retire / supersede / insert statements all use ONE decision per pending decision.
CREATE OR REPLACE FUNCTION public.financial_provider_link_pending_posted(
  p_organization_id UUID, p_item_id UUID, p_limit INTEGER DEFAULT 500)
RETURNS TABLE(linked_count INTEGER, ambiguous_count INTEGER, unresolved_count INTEGER, mismatch_count INTEGER, inherited_count INTEGER, skipped_count INTEGER)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_linked INTEGER; v_ambiguous INTEGER; v_unresolved INTEGER; v_mismatch INTEGER; v_inherited INTEGER; v_skipped INTEGER;
BEGIN
  IF p_organization_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'CONTINUITY_ARGUMENTS_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM 1 FROM public.financial_provider_items i WHERE i.id = p_item_id AND i.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONTINUITY_ITEM_NOT_FOUND' USING ERRCODE = 'no_data_found'; END IF;
  -- One evaluation per Item at a time (two overlapping requests cannot both inherit).
  PERFORM pg_advisory_xact_lock(hashtextextended('plaid2a:' || p_item_id::text, 0));

  DROP TABLE IF EXISTS pg_temp.fp_pp_cand;
  DROP TABLE IF EXISTS pg_temp.fp_pp_plan;

  -- 1. Candidates: posted rows that name a pending row and are not settled. A 'linked' row is looked at again only while the pending row still has a
  --    confirmed decision that has not been carried over (the owner may decide on the pending row after the posted row already arrived).
  CREATE TEMP TABLE fp_pp_cand ON COMMIT DROP AS
  SELECT t.id AS posted_id, t.provider_account_ref, t.provider_amount, t.pending_provider_transaction_id AS pend_pid,
         p.id AS pending_id, p.pending AS p_pending, p.provider_account_ref AS p_account, p.provider_amount AS p_amount,
         (SELECT count(*) FROM public.financial_provider_transactions q
           WHERE q.provider_item_ref = p_item_id AND q.pending_provider_transaction_id = t.pending_provider_transaction_id
             AND q.pending = false AND q.removed_at IS NULL) AS claims
    FROM public.financial_provider_transactions t
    LEFT JOIN public.financial_provider_transactions p
           ON p.provider_item_ref = p_item_id AND p.provider_transaction_id = t.pending_provider_transaction_id
    LEFT JOIN public.financial_provider_pending_posted_links l ON l.posted_ref = t.id
   WHERE t.provider_item_ref = p_item_id AND t.organization_id = p_organization_id
     AND t.pending = false AND t.removed_at IS NULL AND t.pending_provider_transaction_id IS NOT NULL
     AND (l.id IS NULL OR l.status <> 'linked'
          OR (l.evaluated_at >= now() - interval '14 days' AND EXISTS (
                SELECT 1 FROM public.financial_provider_interpretations i
                 WHERE i.organization_id = p_organization_id AND i.provider_transaction_ref = l.pending_ref
                   AND i.status = 'confirmed' AND i.kind IN ('category', 'ignored')
                   AND NOT EXISTS (SELECT 1 FROM public.financial_provider_interpretations c
                                    WHERE c.organization_id = p_organization_id AND c.provider_transaction_ref = t.id AND c.suggestion_basis ->> 'inherited_from_interpretation' = i.id::text))))
   ORDER BY t.created_at, t.id
   LIMIT v_limit;

  -- 2. Record the verdict for every candidate (deterministic rules only).
  INSERT INTO public.financial_provider_pending_posted_links AS l (
    organization_id, provider_item_ref, posted_ref, pending_ref, pending_provider_transaction_id, status, reason)
  SELECT p_organization_id, p_item_id, c.posted_id,
         CASE WHEN c.pending_id IS NULL THEN NULL ELSE c.pending_id END,
         c.pend_pid,
         CASE WHEN c.pending_id IS NULL THEN 'unresolved'
              WHEN c.p_pending IS DISTINCT FROM true OR c.p_account <> c.provider_account_ref
                   OR (c.p_amount <> 0 AND c.provider_amount <> 0 AND sign(c.p_amount) <> sign(c.provider_amount)) THEN 'mismatch'
              WHEN c.claims > 1 THEN 'ambiguous' ELSE 'linked' END,
         CASE WHEN c.pending_id IS NULL THEN 'PENDING_NOT_IN_EVIDENCE'
              WHEN c.p_pending IS DISTINCT FROM true THEN 'PENDING_ROW_NOT_PENDING'
              WHEN c.p_account <> c.provider_account_ref THEN 'ACCOUNT_DIFFERS'
              WHEN c.p_amount <> 0 AND c.provider_amount <> 0 AND sign(c.p_amount) <> sign(c.provider_amount) THEN 'DIRECTION_DIFFERS'
              WHEN c.claims > 1 THEN 'MULTIPLE_POSTED_CLAIM_PENDING' END
    FROM fp_pp_cand c
  ON CONFLICT (posted_ref) DO UPDATE SET pending_ref = EXCLUDED.pending_ref, status = EXCLUDED.status, reason = EXCLUDED.reason, evaluated_at = now();

  -- 3. Plan: one row per confirmed category/ignore decision on a LINKED pending row, with the single action that is safe for it.
  CREATE TEMP TABLE fp_pp_plan ON COMMIT DROP AS
  SELECT l.posted_ref AS posted_id, l.pending_ref AS pending_id, c.pend_pid, i.id AS pi_id, i.kind, i.source, i.confidence, i.category, i.decided_by,
         coalesce(i.decided_at, i.created_at) AS decided_at, prior.id AS prior_id,
         CASE WHEN i.source = 'owner' AND i.decided_by IS NULL THEN 'skip'                                   -- attribution cannot be preserved
              WHEN prior.id IS NULL AND EXISTS (SELECT 1 FROM public.financial_provider_interpretations x      -- the posted row keeps its own confirmed decision
                    WHERE x.organization_id = p_organization_id AND x.provider_transaction_ref = l.posted_ref AND x.kind = i.kind AND x.status = 'confirmed') THEN 'skip'
              WHEN EXISTS (SELECT 1 FROM public.financial_provider_interpretations x                           -- a newer owner decision or undo on the posted row wins
                    WHERE x.organization_id = p_organization_id AND x.provider_transaction_ref = l.posted_ref AND x.kind = i.kind AND x.source = 'owner'
                      AND x.id IS DISTINCT FROM prior.id
                      AND greatest(coalesce(x.decided_at, 'epoch'::timestamptz), coalesce(x.undone_at, 'epoch'::timestamptz)) >= coalesce(i.decided_at, i.created_at)) THEN 'skip'
              ELSE 'insert' END AS action
    FROM fp_pp_cand c
    JOIN public.financial_provider_pending_posted_links l ON l.posted_ref = c.posted_id AND l.status = 'linked'
    JOIN public.financial_provider_interpretations i
      ON i.organization_id = p_organization_id AND i.provider_transaction_ref = l.pending_ref AND i.status = 'confirmed' AND i.kind IN ('category', 'ignored')
    LEFT JOIN LATERAL (SELECT x.id FROM public.financial_provider_interpretations x           -- an unmodified copy inherited from this same pending row
                        WHERE x.organization_id = p_organization_id AND x.provider_transaction_ref = l.posted_ref AND x.kind = i.kind AND x.status = 'confirmed'
                          AND x.suggestion_basis ->> 'inherited_from_pending_transaction' = l.pending_ref::text LIMIT 1) prior ON true
   WHERE NOT EXISTS (SELECT 1 FROM public.financial_provider_interpretations x                     -- this exact pending decision was already carried over (in any status)
                      WHERE x.organization_id = p_organization_id AND x.provider_transaction_ref = l.posted_ref AND x.suggestion_basis ->> 'inherited_from_interpretation' = i.id::text);

  -- 4. Apply. Retire the superseded copy (never edit it), supersede unreviewed suggestions, then insert the attributed inherited decisions.
  UPDATE public.financial_provider_interpretations x SET status = 'undone', undo_reason = 'pending_decision_changed'
    FROM fp_pp_plan p WHERE p.action = 'insert' AND p.prior_id = x.id AND x.status = 'confirmed';
  UPDATE public.financial_provider_interpretations x SET status = 'undone', undo_reason = 'superseded_by_pending_decision'
    FROM fp_pp_plan p WHERE p.action = 'insert' AND x.provider_transaction_ref = p.posted_id AND x.kind = p.kind AND x.status = 'suggested';
  INSERT INTO public.financial_provider_interpretations (
    organization_id, provider_transaction_ref, kind, status, source, confidence, suggestion_basis, category, decided_by, decided_at, created_by)
  SELECT p_organization_id, p.posted_id, p.kind, 'confirmed', p.source, p.confidence,
         jsonb_build_object('inherited_from_interpretation', p.pi_id, 'inherited_from_pending_transaction', p.pending_id,
                            'pending_provider_transaction_id', p.pend_pid, 'inherited_at', now(), 'original_decided_at', p.decided_at),
         p.category, p.decided_by, p.decided_at, p.decided_by
    FROM fp_pp_plan p WHERE p.action = 'insert';
  GET DIAGNOSTICS v_inherited = ROW_COUNT;
  SELECT count(*)::INTEGER INTO v_skipped FROM fp_pp_plan WHERE action = 'skip';
  UPDATE public.financial_provider_pending_posted_links l SET inherited_count = l.inherited_count + n.cnt
    FROM (SELECT posted_id, count(*)::INTEGER AS cnt FROM fp_pp_plan WHERE action = 'insert' GROUP BY posted_id) n WHERE l.posted_ref = n.posted_id;

  SELECT count(*) FILTER (WHERE l.status = 'linked')::INTEGER, count(*) FILTER (WHERE l.status = 'ambiguous')::INTEGER,
         count(*) FILTER (WHERE l.status = 'unresolved')::INTEGER, count(*) FILTER (WHERE l.status = 'mismatch')::INTEGER
    INTO v_linked, v_ambiguous, v_unresolved, v_mismatch
    FROM fp_pp_cand c JOIN public.financial_provider_pending_posted_links l ON l.posted_ref = c.posted_id;

  RETURN QUERY SELECT v_linked, v_ambiguous, v_unresolved, v_mismatch, v_inherited, v_skipped;
END;
$$;

REVOKE ALL ON FUNCTION public.financial_provider_link_pending_posted(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_link_pending_posted(UUID, UUID, INTEGER) TO service_role;

COMMENT ON TABLE public.financial_provider_pending_posted_links IS
  'PLAID-2A explainable pending-to-posted continuity (one row per posted transaction that names a pending one). Derived, never provider evidence; ambiguous or mismatched links inherit nothing and wait for owner review.';
COMMENT ON FUNCTION public.financial_provider_link_pending_posted(UUID, UUID, INTEGER) IS
  'PLAID-2A (service_role only). Links posted transactions to the pending row Plaid names and carries confirmed category/ignore decisions across as new, attributed interpretation rows. Deterministic, idempotent, never overwrites a newer owner decision, never edits evidence.';

COMMIT;
