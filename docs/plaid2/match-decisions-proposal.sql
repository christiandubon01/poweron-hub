-- PLAID-3B REVIEW DRAFT. NOT a registered or approved production migration. Do not run with `supabase db push`.
-- Install only after separate owner approval, as ONE named tracked migration (suggested name: plaid3b_match_decisions), after re-checking the production
-- catalog. Never repair or reapply 157/158. Requires migrations 153-156 and 155's financial_provider_interpretations model (all installed).
--
-- WHAT IT IS
--   The one database function behind the Cash OS "Matches" review: the owner confirms, rejects or reverses a PAIR of provider transactions that the engine
--   proposes as an internal transfer or a credit-card payment. It adds NO table, NO column and NO index: a decision is stored as ordinary rows of
--   financial_provider_interpretations (kind 'transfer'), which is what every existing report already reads.
--
--     confirm   two rows, status 'confirmed', source 'owner' - one per leg, each naming the other leg as its counterpart (so meaning survives turning the
--               reconciliation switch off: the legacy reports read each leg's own row), in ONE transaction.
--     reject    one row on the outflow leg, status 'rejected', naming the inflow leg. History; never edited.
--     reverse   both confirmed rows -> 'undone' (who/when/why kept). The pair is simply undecided again.
--
-- WHAT IT REFUSES (each is a tested behavior)
--   * a pair that is not structurally a pair: legs must exist in THIS organization, be different accounts, carry equal amounts of opposite sign, be posted,
--     and be at most 7 days apart. card_payment needs a credit-card inflow; internal_transfer must not involve a credit card or loan as the receiver.
--   * a decision on evidence the owner did not review: the caller sends the evidence fingerprint it showed; the function rebuilds it from the LOCKED rows and
--     returns 'evidence_changed' on any difference (amount, date, account, pending flag, a removed leg).
--   * overriding another owner decision: a leg that is already in another confirmed pair, or already decided as a bill/project/payroll/debt/personal/
--     overhead, ignored, or categorized as something other than Transfers, returns 'conflict'. Nothing is replaced silently.
--   * partial results: any failure rolls the whole call back. Concurrent calls touching the same legs serialize on the evidence rows (locked in id order).
--
-- Security (conventions of migrations 153-156): SECURITY INVOKER with a fixed search_path; EXECUTE for service_role ONLY; the organization and the acting user
-- come from the trusted server (never the browser) and every table access is filtered by that organization, so a transaction id of another organization is
-- simply 'not_found'. It never reads or writes the ledger, a Cash OS account, a mapping, or provider evidence (evidence rows are only locked).
--
-- Capability probe: p_action = 'probe' returns 'available' without touching data (the same pattern as BANK-6H). Until this function is installed the
-- review screen reports "needs a database update" and every mutation is refused.
--
-- Rollback: stop calling it (unset CASH_OS_RECONCILIATION_ENABLED). Decisions already written are ordinary interpretation rows the owner can undo.
-- Dropping the function is safe and loses nothing.
BEGIN;

CREATE OR REPLACE FUNCTION public.financial_provider_decide_match(
  p_organization_id UUID,
  p_actor UUID,
  p_action TEXT,
  p_outflow_ref UUID DEFAULT NULL,
  p_inflow_ref UUID DEFAULT NULL,
  p_pair_kind TEXT DEFAULT NULL,
  p_fingerprint TEXT DEFAULT NULL,
  p_basis JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(outcome TEXT, pair_id UUID, detail TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  o RECORD;
  i RECORD;
  v_n INTEGER;
  v_o_type TEXT;
  v_i_type TEXT;
  v_fp TEXT;
  v_pair UUID := gen_random_uuid();
  v_old UUID;
  r RECORD;
  v_found_o BOOLEAN;
  v_found_i BOOLEAN;
BEGIN
  IF p_action = 'probe' THEN
    RETURN QUERY SELECT 'available'::TEXT, NULL::UUID, NULL::TEXT; RETURN;
  END IF;
  IF p_organization_id IS NULL OR p_actor IS NULL OR p_outflow_ref IS NULL OR p_inflow_ref IS NULL OR p_outflow_ref = p_inflow_ref
     OR p_action IS NULL OR p_action NOT IN ('confirm', 'reject', 'reverse') THEN
    RAISE EXCEPTION 'MATCH_ARGUMENTS_INVALID' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_action IN ('confirm', 'reject') THEN
    IF p_pair_kind IS NULL OR p_pair_kind NOT IN ('internal_transfer', 'card_payment')
       OR p_fingerprint IS NULL OR length(p_fingerprint) NOT BETWEEN 20 AND 400
       OR p_basis IS NULL OR jsonb_typeof(p_basis) <> 'object' OR NOT public.financial_provider_json_is_safe(p_basis) OR pg_column_size(p_basis) > 6000 THEN
      RAISE EXCEPTION 'MATCH_ARGUMENTS_INVALID' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- Lock the evidence rows of this organization, always in id order (concurrent decisions on overlapping legs serialize here and cannot deadlock).
  v_found_o := FALSE; v_found_i := FALSE;
  FOR r IN
    SELECT t.* FROM public.financial_provider_transactions t
     WHERE t.organization_id = p_organization_id AND t.id IN (p_outflow_ref, p_inflow_ref)
     ORDER BY t.id FOR UPDATE
  LOOP
    IF r.id = p_outflow_ref THEN o := r; v_found_o := TRUE; ELSE i := r; v_found_i := TRUE; END IF;
  END LOOP;

  -- ── reverse: needs no live evidence (the owner may undo a confirmation whose legs have since changed or gone) ──────────────────────────
  IF p_action = 'reverse' THEN
    v_n := 0; v_old := NULL;
    FOR r IN
      SELECT x.id, x.suggestion_basis FROM public.financial_provider_interpretations x
       WHERE x.organization_id = p_organization_id AND x.kind = 'transfer' AND x.status = 'confirmed'
         AND ((x.provider_transaction_ref = p_outflow_ref AND x.counterpart_provider_transaction_ref = p_inflow_ref)
           OR (x.provider_transaction_ref = p_inflow_ref AND x.counterpart_provider_transaction_ref = p_outflow_ref))
       ORDER BY x.created_at, x.id FOR UPDATE
    LOOP
      UPDATE public.financial_provider_interpretations
         SET status = 'undone', undone_by = p_actor, undone_at = now(), undo_reason = 'pair_reversed'
       WHERE id = r.id;
      v_n := v_n + 1;
      IF v_old IS NULL AND r.suggestion_basis ? 'pair_id' THEN v_old := (r.suggestion_basis ->> 'pair_id')::UUID; END IF;
    END LOOP;
    IF v_n = 0 THEN RETURN QUERY SELECT 'nothing_to_reverse'::TEXT, NULL::UUID, NULL::TEXT; RETURN; END IF;
    RETURN QUERY SELECT 'reversed'::TEXT, v_old, v_n::TEXT; RETURN;
  END IF;

  -- ── confirm / reject: the pair must be real, structurally valid and exactly what the owner reviewed ─────────────────────────────────────
  IF NOT v_found_o OR NOT v_found_i OR o.removed_at IS NOT NULL OR i.removed_at IS NOT NULL THEN
    RETURN QUERY SELECT CASE WHEN v_found_o AND v_found_i THEN 'evidence_changed' ELSE 'not_found' END::TEXT, NULL::UUID, 'LEG_UNAVAILABLE'::TEXT; RETURN;
  END IF;
  IF o.pending OR i.pending THEN RETURN QUERY SELECT 'pending_not_allowed'::TEXT, NULL::UUID, NULL::TEXT; RETURN; END IF;
  IF o.provider_account_ref = i.provider_account_ref THEN RETURN QUERY SELECT 'invalid_pair'::TEXT, NULL::UUID, 'SAME_ACCOUNT'::TEXT; RETURN; END IF;
  IF o.provider_amount_minor <= 0 OR i.provider_amount_minor >= 0 OR o.provider_amount_minor <> -i.provider_amount_minor THEN
    RETURN QUERY SELECT 'invalid_pair'::TEXT, NULL::UUID, 'AMOUNTS'::TEXT; RETURN;
  END IF;
  IF abs(o.transaction_date - i.transaction_date) > 7 THEN RETURN QUERY SELECT 'invalid_pair'::TEXT, NULL::UUID, 'DATES'::TEXT; RETURN; END IF;

  SELECT a.provider_account_type INTO v_o_type FROM public.financial_provider_accounts a WHERE a.id = o.provider_account_ref AND a.organization_id = p_organization_id;
  SELECT a.provider_account_type INTO v_i_type FROM public.financial_provider_accounts a WHERE a.id = i.provider_account_ref AND a.organization_id = p_organization_id;
  IF p_pair_kind = 'card_payment' AND (v_i_type IS DISTINCT FROM 'credit' OR v_o_type = 'credit') THEN
    RETURN QUERY SELECT 'invalid_pair'::TEXT, NULL::UUID, 'KIND'::TEXT; RETURN;
  END IF;
  IF p_pair_kind = 'internal_transfer' AND (v_i_type IN ('credit', 'loan') OR v_o_type = 'credit') THEN
    RETURN QUERY SELECT 'invalid_pair'::TEXT, NULL::UUID, 'KIND'::TEXT; RETURN;
  END IF;

  -- The evidence the owner reviewed, rebuilt from the locked rows (the same canonical string as src/services/bankProvider/spending/reconciliation.ts).
  v_fp := 'v1|o:' || o.id || ':' || o.provider_account_ref || ':' || o.provider_amount_minor || ':' || to_char(o.transaction_date, 'YYYY-MM-DD') || ':' || (CASE WHEN o.pending THEN '1' ELSE '0' END)
       || '|i:' || i.id || ':' || i.provider_account_ref || ':' || i.provider_amount_minor || ':' || to_char(i.transaction_date, 'YYYY-MM-DD') || ':' || (CASE WHEN i.pending THEN '1' ELSE '0' END);
  IF v_fp IS DISTINCT FROM p_fingerprint THEN RETURN QUERY SELECT 'evidence_changed'::TEXT, NULL::UUID, 'FINGERPRINT'::TEXT; RETURN; END IF;

  -- ── reject ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  IF p_action = 'reject' THEN
    IF EXISTS (SELECT 1 FROM public.financial_provider_interpretations x
                WHERE x.organization_id = p_organization_id AND x.kind = 'transfer' AND x.status = 'confirmed'
                  AND ((x.provider_transaction_ref = p_outflow_ref AND x.counterpart_provider_transaction_ref = p_inflow_ref)
                    OR (x.provider_transaction_ref = p_inflow_ref AND x.counterpart_provider_transaction_ref = p_outflow_ref))) THEN
      RETURN QUERY SELECT 'conflict'::TEXT, NULL::UUID, 'PAIR_CONFIRMED'::TEXT; RETURN; -- reverse the confirmation first; a rejection never replaces one
    END IF;
    SELECT (x.suggestion_basis ->> 'pair_id')::UUID INTO v_old FROM public.financial_provider_interpretations x
     WHERE x.organization_id = p_organization_id AND x.kind = 'transfer' AND x.status = 'rejected'
       AND x.provider_transaction_ref = p_outflow_ref AND x.counterpart_provider_transaction_ref = p_inflow_ref
       AND x.suggestion_basis ->> 'fingerprint' = p_fingerprint
     ORDER BY x.created_at DESC LIMIT 1;
    IF FOUND THEN RETURN QUERY SELECT 'unchanged'::TEXT, v_old, NULL::TEXT; RETURN; END IF;
    INSERT INTO public.financial_provider_interpretations (
      organization_id, provider_transaction_ref, kind, status, source, confidence, suggestion_basis, counterpart_provider_transaction_ref, decided_by, decided_at, created_by)
    VALUES (p_organization_id, p_outflow_ref, 'transfer', 'rejected', 'owner', NULL,
      p_basis || jsonb_build_object('mode', 'pair_review', 'pair_id', v_pair, 'pair_kind', p_pair_kind, 'fingerprint', p_fingerprint, 'role', 'outflow'),
      p_inflow_ref, p_actor, now(), p_actor);
    RETURN QUERY SELECT 'rejected'::TEXT, v_pair, NULL::TEXT; RETURN;
  END IF;

  -- ── confirm: look at everything the owner has already decided about these two legs ──────────────────────────────────────────────────────
  v_n := 0;
  FOR r IN
    SELECT x.* FROM public.financial_provider_interpretations x
     WHERE x.organization_id = p_organization_id AND x.provider_transaction_ref IN (p_outflow_ref, p_inflow_ref)
       AND x.status IN ('suggested', 'confirmed')
     ORDER BY x.created_at, x.id FOR UPDATE
  LOOP
    IF r.status = 'confirmed' THEN
      IF r.kind = 'ignored' THEN RETURN QUERY SELECT 'conflict'::TEXT, NULL::UUID, 'LEG_IGNORED'::TEXT; RETURN; END IF;
      IF r.kind = 'category' AND r.category IS DISTINCT FROM 'transfers' THEN RETURN QUERY SELECT 'conflict'::TEXT, NULL::UUID, 'LEG_CATEGORIZED'::TEXT; RETURN; END IF;
      IF r.kind NOT IN ('category', 'transfer') THEN RETURN QUERY SELECT 'conflict'::TEXT, NULL::UUID, 'LEG_ALREADY_DECIDED'::TEXT; RETURN; END IF;
      IF r.kind = 'transfer' THEN
        -- already confirmed with the OTHER leg of a different pair, or with some third transaction: the owner must reverse that first
        IF r.counterpart_provider_transaction_ref IS NOT NULL
           AND NOT ((r.provider_transaction_ref = p_outflow_ref AND r.counterpart_provider_transaction_ref = p_inflow_ref)
                 OR (r.provider_transaction_ref = p_inflow_ref AND r.counterpart_provider_transaction_ref = p_outflow_ref)) THEN
          RETURN QUERY SELECT 'conflict'::TEXT, NULL::UUID, 'LEG_ALREADY_PAIRED'::TEXT; RETURN;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- A third transaction whose own confirmed decision names one of these legs as ITS counterpart (a one-leg decision made earlier) already uses that leg.
  IF EXISTS (SELECT 1 FROM public.financial_provider_interpretations x
              WHERE x.organization_id = p_organization_id AND x.kind = 'transfer' AND x.status = 'confirmed'
                AND x.counterpart_provider_transaction_ref IN (p_outflow_ref, p_inflow_ref)
                AND x.provider_transaction_ref NOT IN (p_outflow_ref, p_inflow_ref)) THEN
    RETURN QUERY SELECT 'conflict'::TEXT, NULL::UUID, 'LEG_ALREADY_PAIRED'::TEXT; RETURN;
  END IF;

  -- Idempotent: both legs already confirmed for exactly this evidence.
  IF (SELECT count(*) FROM public.financial_provider_interpretations x
       WHERE x.organization_id = p_organization_id AND x.kind = 'transfer' AND x.status = 'confirmed'
         AND x.suggestion_basis ->> 'fingerprint' = p_fingerprint
         AND ((x.provider_transaction_ref = p_outflow_ref AND x.counterpart_provider_transaction_ref = p_inflow_ref)
           OR (x.provider_transaction_ref = p_inflow_ref AND x.counterpart_provider_transaction_ref = p_outflow_ref))) = 2 THEN
    SELECT (x.suggestion_basis ->> 'pair_id')::UUID INTO v_old FROM public.financial_provider_interpretations x
     WHERE x.organization_id = p_organization_id AND x.kind = 'transfer' AND x.status = 'confirmed' AND x.provider_transaction_ref = p_outflow_ref LIMIT 1;
    RETURN QUERY SELECT 'unchanged'::TEXT, v_old, NULL::TEXT; RETURN;
  END IF;

  -- Retire what the new pair replaces, as audit history (never edited, never deleted): unreviewed suggestions on either leg, an earlier confirmation of THIS pair
  -- made on older evidence, a one-leg or unpaired "transfer" decision that this pair completes.
  UPDATE public.financial_provider_interpretations x
     SET status = 'undone', undone_by = p_actor, undone_at = now(),
         undo_reason = CASE WHEN x.status = 'suggested' THEN 'superseded_by_pair_confirmation'
                            WHEN x.suggestion_basis ? 'pair_id' THEN 'pair_reconfirmed' ELSE 'completed_by_pair' END
   WHERE x.organization_id = p_organization_id AND x.provider_transaction_ref IN (p_outflow_ref, p_inflow_ref)
     AND x.kind NOT IN ('category', 'ignored') AND x.status IN ('suggested', 'confirmed');
  -- a suggested category row does not block anything and is left alone

  INSERT INTO public.financial_provider_interpretations (
    organization_id, provider_transaction_ref, kind, status, source, confidence, suggestion_basis, counterpart_provider_transaction_ref, decided_by, decided_at, created_by)
  VALUES
    (p_organization_id, p_outflow_ref, 'transfer', 'confirmed', 'owner', 'high',
      p_basis || jsonb_build_object('mode', 'pair_review', 'pair_id', v_pair, 'pair_kind', p_pair_kind, 'fingerprint', p_fingerprint, 'role', 'outflow'),
      p_inflow_ref, p_actor, now(), p_actor),
    (p_organization_id, p_inflow_ref, 'transfer', 'confirmed', 'owner', 'high',
      p_basis || jsonb_build_object('mode', 'pair_review', 'pair_id', v_pair, 'pair_kind', p_pair_kind, 'fingerprint', p_fingerprint, 'role', 'inflow'),
      p_outflow_ref, p_actor, now(), p_actor);
  RETURN QUERY SELECT 'confirmed'::TEXT, v_pair, NULL::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.financial_provider_decide_match(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_provider_decide_match(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;

COMMENT ON FUNCTION public.financial_provider_decide_match(UUID, UUID, TEXT, UUID, UUID, TEXT, TEXT, JSONB) IS
  'PLAID-3B (service_role only). Atomic owner decision on a PAIR of provider transactions (internal transfer / credit-card payment): confirm writes both legs, reject writes one history row, reverse undoes both. Validates organization, structure and the reviewed evidence fingerprint under row locks; never overrides another owner decision; never touches evidence, ledger, accounts or mappings.';

COMMIT;
