-- CASH-UX-2: Owner facts foundation.
--
-- Gives the read-only Decision Layer canonical homes for the few business facts it lacked, captured
-- where the owner naturally meets them. Nothing here is a balance, a receivable or a payment:
--   * Project balances stay derived from the project's contract and collected payments.
--   * Cash a job needs is NOT stored here; it is the sum of the job's linked required commitments
--     (cash_commitments.project_id, which already exists and is now written by the app).
--   * Debt balances stay in the ledger; the contractual payment stays in minimum/scheduled payment.
--
-- Additive only: nullable columns / one new table. No data is rewritten.
BEGIN;

-- ── Debt: past-due and catch-up are distinct from the normal payment and from the balance ──────────
ALTER TABLE public.financial_liability_terms
  ADD COLUMN IF NOT EXISTS past_due_minor BIGINT
    CHECK (past_due_minor IS NULL OR past_due_minor >= 0),
  ADD COLUMN IF NOT EXISTS catch_up_minor BIGINT
    CHECK (catch_up_minor IS NULL OR catch_up_minor >= 0),
  ADD COLUMN IF NOT EXISTS consequence_note TEXT
    CHECK (consequence_note IS NULL OR length(trim(consequence_note)) > 0),
  ADD COLUMN IF NOT EXISTS operationally_critical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS critical_reason TEXT
    CHECK (critical_reason IS NULL OR length(trim(critical_reason)) > 0);

COMMENT ON COLUMN public.financial_liability_terms.past_due_minor IS
  'Owner-entered amount currently past due. NULL = unknown. Distinct from minimum/scheduled payment and from the ledger balance.';
COMMENT ON COLUMN public.financial_liability_terms.catch_up_minor IS
  'Owner-entered amount required to bring the account current. NULL = unknown. May differ from past_due_minor.';
COMMENT ON COLUMN public.financial_liability_terms.operationally_critical IS
  'Owner fact: missing this payment would interfere with the ability to keep working. Never inferred from account type or name.';

-- ── Operational criticality on planned outflows ─────────────────────────────────────────────────────
ALTER TABLE public.financial_obligations
  ADD COLUMN IF NOT EXISTS operationally_critical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS critical_reason TEXT
    CHECK (critical_reason IS NULL OR length(trim(critical_reason)) > 0);

ALTER TABLE public.cash_commitments
  ADD COLUMN IF NOT EXISTS operationally_critical BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS critical_reason TEXT
    CHECK (critical_reason IS NULL OR length(trim(critical_reason)) > 0);

-- ── Project cash facts: one row per project, every field nullable (unknown stays unknown) ───────────
CREATE TABLE IF NOT EXISTS public.cash_project_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- TEXT on purpose: project ids are the app's legacy text ids (same convention as obligations/commitments).
  project_id TEXT NOT NULL CHECK (length(trim(project_id)) > 0),
  billing_type TEXT CHECK (billing_type IN ('fixed', 'time_and_material')),
  -- Explicit owner statement about the remaining balance. NULL = not stated.
  readiness TEXT CHECK (readiness IN ('work_required', 'ready_to_bill')),
  completion_requirement TEXT CHECK (completion_requirement IS NULL OR length(trim(completion_requirement)) > 0),
  -- A non-null reason means the job is blocked right now.
  blocked_reason TEXT CHECK (blocked_reason IS NULL OR length(trim(blocked_reason)) > 0),
  -- NULL = not answered, false = no spend needed to finish, true = spend needed.
  needs_spend BOOLEAN,
  work_hours_remaining NUMERIC(7, 1) CHECK (work_hours_remaining IS NULL OR work_hours_remaining >= 0),
  expected_collection_date DATE,
  collection_confidence TEXT CHECK (collection_confidence IN ('high', 'medium', 'low')),
  next_action TEXT CHECK (next_action IS NULL OR length(trim(next_action)) > 0),
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cash_project_facts_one_per_project UNIQUE (organization_id, project_id),
  CONSTRAINT cash_project_facts_id_org_unique UNIQUE (id, organization_id)
);

COMMENT ON TABLE public.cash_project_facts IS
  'Owner-stated facts about a project that Cash OS cannot derive (billing type, collection readiness, blocker, '
  'spend/time needed, expected collection). Never stores a balance or receivable: the remaining balance is derived '
  'from the project contract and collected payments, and the cash a job needs is the sum of its linked commitments.';

CREATE TRIGGER trg_cash_project_facts_updated_at
  BEFORE UPDATE ON public.cash_project_facts
  FOR EACH ROW EXECUTE FUNCTION public.set_cash_ledger_updated_at();

ALTER TABLE public.cash_project_facts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_project_facts FROM PUBLIC, anon, authenticated;

CREATE POLICY cash_project_facts_owner_admin_all
  ON public.cash_project_facts
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

GRANT SELECT, INSERT, UPDATE ON public.cash_project_facts TO authenticated;

COMMIT;
