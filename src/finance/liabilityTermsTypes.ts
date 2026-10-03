export type DebtStructure = 'revolving' | 'installment' | 'other'

/**
 * Economic structure of a promotional financing arrangement.
 * - intro_apr: reduced/zero APR for promo period; balance converts to standard APR after expiry.
 * - deferred_interest: no interest if paid in full by expiry; interest accrues from promo_started_on
 *   and is assessed retroactively if the balance is not cleared in time.
 * - reduced_apr_fixed_payment: promotional APR paired with a fixed required payment schedule.
 * - other: promotional arrangement not covered by the above.
 *
 * Do NOT infer deferred_interest merely because promo_apr_basis_points = 0.
 * This distinction is required for correct payoff calculation in CORE-CLOSE-2C.
 */
export type PromoType = 'intro_apr' | 'deferred_interest' | 'reduced_apr_fixed_payment' | 'other'

export interface LiabilityTermsRow {
  id: string
  organization_id: string
  account_id: string
  debt_structure: DebtStructure | null
  apr_basis_points: number | null
  promo_apr_basis_points: number | null
  promo_type: PromoType | null
  promo_started_on: string | null
  promo_expires_on: string | null
  minimum_payment_minor: number | null
  payment_due_day: number | null
  next_due_date: string | null
  scheduled_payment_minor: number | null
  original_principal_minor: number | null
  maturity_date: string | null
  owner_notes: string | null
  created_at: string
  updated_at: string
}

export interface LiabilityTermsInput {
  debt_structure?: DebtStructure | null
  apr_basis_points?: number | null
  promo_apr_basis_points?: number | null
  promo_type?: PromoType | null
  promo_started_on?: string | null
  promo_expires_on?: string | null
  minimum_payment_minor?: number | null
  payment_due_day?: number | null
  next_due_date?: string | null
  scheduled_payment_minor?: number | null
  original_principal_minor?: number | null
  maturity_date?: string | null
  owner_notes?: string | null
}
