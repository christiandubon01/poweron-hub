-- BANK-6B: owner-approved MERCHANT RULES for Smart Review.
--
-- A rule says "when this normalized merchant appears again, SUGGEST this category". It is a remembered owner preference and nothing more:
--   * It only ever improves a SUGGESTION. It never confirms a transaction, never creates an interpretation row, never writes a ledger
--     row, never touches a balance, bill, project, debt or payroll. Every transaction still needs the owner's explicit approval.
--   * An explicit owner decision on a transaction always wins over a rule (the rule is consulted only for undecided transactions).
--   * Rules are organization-scoped (RLS on, no browser policy and no browser grant: the table is service_role only), one active rule
--     per (organization, merchant_key). Revoking keeps the row (audit) and stops it from influencing suggestions.
--   * Only everyday-expense categories can be remembered (CHECK below): payroll, personal, transfers, owner draws and money-in
--     categories are always individual decisions and cannot become a merchant rule.
--
-- Why a new table (and not financial_provider_interpretations): that table is keyed by ONE provider transaction and carries the
-- confirmed/undone lifecycle of one decision; a merchant-level preference has no transaction and must not look like a decision.
--
-- Rollback: DROP TABLE public.financial_provider_merchant_rules; (nothing references it). Runs in one transaction.
-- Apply ONLY with the reviewed single-file procedure (BANK-0A). Never via `supabase db push`. Do not modify migrations 153-156.
BEGIN;

CREATE TABLE IF NOT EXISTS public.financial_provider_merchant_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  merchant_key TEXT NOT NULL CHECK (char_length(merchant_key) BETWEEN 1 AND 80),
  merchant_label TEXT CHECK (merchant_label IS NULL OR char_length(merchant_label) <= 80),
  category TEXT NOT NULL CHECK (category IN ('materials', 'fuel_vehicle', 'tools_equipment', 'software_subscriptions', 'insurance', 'permits_fees', 'marketing', 'meals', 'office_admin', 'bank_finance_fees', 'taxes')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  CONSTRAINT financial_provider_merchant_rules_org_merchant_unique UNIQUE (organization_id, merchant_key),
  CONSTRAINT financial_provider_merchant_rules_revoked_consistent CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

ALTER TABLE public.financial_provider_merchant_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_provider_merchant_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.financial_provider_merchant_rules TO service_role;

COMMENT ON TABLE public.financial_provider_merchant_rules IS
  'BANK-6B owner-approved merchant->category preference. Improves suggestions only; never an interpretation, never a decision, never canonical. service_role only.';

COMMIT;
