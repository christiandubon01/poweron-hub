-- CORE-CLOSE-2B: Liability debt terms.
--
-- Dedicated org-scoped metadata table for owner-managed debt contract terms.
-- Keyed to financial_accounts via composite FK; one row per account.
-- All contract fields are nullable — unknown must remain unknown.
-- Current balance authority remains financial_transactions (canonical ledger).
--
-- CORE-CLOSE-2C LIMITATION NOTE:
-- This model represents ONE account-level promotional financing arrangement.
-- If an account carries multiple simultaneous promotional balances (e.g. separate
-- purchase tranches at different promo rates), 2B does NOT model them.
-- Multi-tranche/multi-promotion allocation requires promotion/tranche modeling in 2C
-- and must not be approximated by treating one promo_type as the whole account.

CREATE TABLE IF NOT EXISTS public.financial_liability_terms (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  account_id                UUID         NOT NULL,

  -- Distinguishes revolving (credit card) from installment (loan, vehicle, student) vs other
  debt_structure            TEXT
    CHECK (debt_structure IN ('revolving', 'installment', 'other')),

  -- Regular/post-promo APR in basis points (integer, 1 bp = 0.01 %).
  -- Example: 24.99 % APR → 2499. Integer storage eliminates floating-point ambiguity.
  -- Never overwrite with the promotional rate; use promo_apr_basis_points for that.
  apr_basis_points          INTEGER
    CHECK (apr_basis_points >= 0 AND apr_basis_points <= 1000000),

  -- Promotional/introductory APR stored separately so regular APR is never overwritten.
  -- NULL = no known promotional rate (or not applicable to this promo type, e.g. deferred interest
  -- where the standard apr_basis_points is the retroactive rate, not a separate promo rate).
  promo_apr_basis_points    INTEGER
    CHECK (promo_apr_basis_points >= 0),

  -- Known beginning/purchase date for the promotional financing arrangement.
  -- Required for deferred-interest payoff calculation in CORE-CLOSE-2C.
  -- NULL = unknown.
  promo_started_on          DATE,

  -- Known deadline or expiration of the promotional period.
  -- NULL = unknown.
  promo_expires_on          DATE,

  -- Economic structure of the promotional financing. Critical for correct payoff behavior.
  --   intro_apr               Reduced/zero APR for the promotional period; remaining balance
  --                           converts to standard APR after promo_expires_on.
  --   deferred_interest       No interest charged during promo IF paid in full by promo_expires_on;
  --                           interest may have accrued from promo_started_on and is assessed
  --                           retroactively if the balance is not cleared in time.
  --   reduced_apr_fixed_payment  Promotional APR paired with a fixed required payment schedule.
  --   other                   Promotional arrangement not covered by the above types.
  -- NULL = no known promotion, or promotional structure not specified by owner.
  -- IMPORTANT: Do NOT infer deferred_interest merely because promo_apr_basis_points = 0.
  promo_type                TEXT
    CHECK (promo_type IN ('intro_apr', 'deferred_interest', 'reduced_apr_fixed_payment', 'other')),

  -- Minimum or required payment amount in minor currency units (cents)
  minimum_payment_minor     BIGINT
    CHECK (minimum_payment_minor >= 0),

  -- Day of month (1–31) on which payment is regularly due
  payment_due_day           SMALLINT
    CHECK (payment_due_day BETWEEN 1 AND 31),

  -- Explicit next due date for irregular or precisely known due dates
  next_due_date             DATE,

  -- Installment: fixed contractual periodic payment (distinct from minimum payment)
  scheduled_payment_minor   BIGINT
    CHECK (scheduled_payment_minor >= 0),

  -- Original/principal amount from loan contract, when known
  original_principal_minor  BIGINT
    CHECK (original_principal_minor >= 0),

  -- Maturity or payoff date from loan contract (not a computed projection)
  maturity_date             DATE,

  -- Free-form owner notes for unusual terms or context
  owner_notes               TEXT,

  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Composite FK: account must belong to the same org; terms are removed when account is deleted
  CONSTRAINT financial_liability_terms_account_org_fk
    FOREIGN KEY (account_id, organization_id)
    REFERENCES public.financial_accounts(id, organization_id)
    ON DELETE CASCADE,

  -- One terms record per account per org
  CONSTRAINT financial_liability_terms_one_per_account
    UNIQUE (account_id, organization_id),

  -- Enables composite FK from downstream tables if ever needed
  CONSTRAINT financial_liability_terms_id_org_unique
    UNIQUE (id, organization_id),

  -- Promo expiration requires at least one promo context field so it is not orphaned.
  -- promo_apr_basis_points covers intro_apr and reduced_apr_fixed_payment cases.
  -- promo_type covers deferred_interest (where promo_apr_basis_points may be null
  -- because the retroactive rate is the standard apr_basis_points, not a distinct promo rate).
  CONSTRAINT financial_liability_terms_promo_coherence
    CHECK (
      promo_expires_on IS NULL
      OR promo_apr_basis_points IS NOT NULL
      OR promo_type IS NOT NULL
    )
);

COMMENT ON TABLE public.financial_liability_terms IS
  'Owner-managed debt contract metadata for liability accounts. '
  'Current balance is derived exclusively from financial_transactions (canonical ledger) — '
  'never stored or computed here. All term fields are nullable; unknown terms remain null. '
  'One row per account; represents a single promotional arrangement. Multi-tranche promotions '
  'require separate modeling in a future phase (CORE-CLOSE-2C or later).';

COMMENT ON COLUMN public.financial_liability_terms.apr_basis_points IS
  'Regular or post-promotional APR in basis points (integer). 1 bp = 0.01 %. '
  'Never overwrite with the promotional rate — use promo_apr_basis_points instead. '
  'For deferred interest this is the retroactive standard rate that applies if the promo balance '
  'is not paid in full by promo_expires_on.';

COMMENT ON COLUMN public.financial_liability_terms.promo_apr_basis_points IS
  'Promotional/introductory APR in basis points. Stored separately from regular APR. '
  'For deferred interest this may be null — the standard apr_basis_points is the retroactive rate.';

COMMENT ON COLUMN public.financial_liability_terms.promo_type IS
  'Economic structure of the promotional financing: intro_apr, deferred_interest, '
  'reduced_apr_fixed_payment, or other. '
  'NULL means no known promotion or structure unspecified. '
  'Do NOT infer deferred_interest from promo_apr_basis_points = 0 alone.';

COMMENT ON COLUMN public.financial_liability_terms.promo_started_on IS
  'Known start/purchase date of the promotional arrangement. '
  'Required by CORE-CLOSE-2C to calculate deferred interest from origination. NULL = unknown.';

COMMENT ON COLUMN public.financial_liability_terms.minimum_payment_minor IS
  'Required minimum payment in minor currency units. Informational only; '
  'actual payments are recorded as financial_transactions.';

-- Reuse the existing ledger updated_at trigger function
CREATE TRIGGER trg_financial_liability_terms_updated_at
  BEFORE UPDATE ON public.financial_liability_terms
  FOR EACH ROW EXECUTE FUNCTION set_cash_ledger_updated_at();

-- RLS: same pattern as financial_accounts (migration 139) and cash_os_buckets (migration 144)
ALTER TABLE public.financial_liability_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_liability_terms FROM PUBLIC, anon, authenticated;

CREATE POLICY financial_liability_terms_owner_admin_all
  ON public.financial_liability_terms
  FOR ALL TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id))
  WITH CHECK (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

-- No DELETE grant: terms are removed by account deletion (CASCADE) or by nulling fields via UPDATE
GRANT SELECT, INSERT, UPDATE ON public.financial_liability_terms TO authenticated;
