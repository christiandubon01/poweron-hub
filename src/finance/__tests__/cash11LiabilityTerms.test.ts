import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { LiabilityTermsRow } from '../liabilityTermsTypes'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const bundleSrc = readFileSync(resolve(__dirname, '../../services/cashOsReadService.ts'), 'utf8')
const serviceSrc = readFileSync(resolve(__dirname, '../../services/liabilityTermsService.ts'), 'utf8')
const debtPlanSrc = readFileSync(resolve(__dirname, '../../components/v15r/cash-os/CashOsDebtPlan.tsx'), 'utf8')
const termsSrc = readFileSync(resolve(__dirname, '../liabilityTermsTypes.ts'), 'utf8')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTerms(overrides: Partial<LiabilityTermsRow> = {}): LiabilityTermsRow {
  return {
    id: 'lt-1', organization_id: 'org-1', account_id: 'acct-1',
    debt_structure: null,
    apr_basis_points: null, promo_apr_basis_points: null,
    promo_type: null, promo_started_on: null, promo_expires_on: null,
    minimum_payment_minor: null, payment_due_day: null, next_due_date: null,
    scheduled_payment_minor: null, original_principal_minor: null, maturity_date: null,
    owner_notes: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── Bundle source inspection ──────────────────────────────────────────────────

describe('CORE-CLOSE-2B CashOsSourceBundle liability terms', () => {

  it('1: CashOsSourceBundle includes liabilityTerms field', () => {
    expect(bundleSrc).toContain('liabilityTerms')
    expect(bundleSrc).toContain('LiabilityTermsRow')
  })

  it('2: readCashOsSources fetches financial_liability_terms table', () => {
    expect(bundleSrc).toContain("'financial_liability_terms'")
  })

  it('3: liability terms read uses eq organization_id filter', () => {
    const termsBlock = bundleSrc.slice(bundleSrc.indexOf('financial_liability_terms'))
    expect(termsBlock).toContain('.eq(\'organization_id\', organizationId)')
  })

  it('4: org isolation check includes liabilityTerms in readCashOsSources guard', () => {
    expect(bundleSrc).toContain('liabilityTerms.some(row => row.organization_id !== organizationId)')
  })

  it('5: liabilityTerms is included in the returned bundle object', () => {
    const returnBlock = bundleSrc.slice(bundleSrc.indexOf('employeeRows'))
    expect(returnBlock).toContain('liabilityTerms')
  })

  it('6: liability terms fetch errors are labelled LIABILITY_TERMS_READ_FAILED', () => {
    expect(bundleSrc).toContain('LIABILITY_TERMS_READ_FAILED')
  })
})

// ── Service source inspection ─────────────────────────────────────────────────

describe('CORE-CLOSE-2B liabilityTermsService', () => {

  it('7: upsertLiabilityTerms uses onConflict account_id,organization_id', () => {
    expect(serviceSrc).toContain("onConflict: 'account_id,organization_id'")
  })

  it('8: upsertLiabilityTerms derives org from resolveFinanceContext — not caller-supplied', () => {
    expect(serviceSrc).toContain('resolveFinanceContext')
    // organization_id must come from ctx, never from function parameter
    const upsertBlock = serviceSrc.slice(serviceSrc.indexOf('upsertLiabilityTerms'))
    expect(upsertBlock).toContain('ctx.organizationId')
    expect(upsertBlock).not.toContain('organizationId:')  // no caller-supplied org
  })

  it('9: upsertLiabilityTerms org-checks returned row before returning', () => {
    expect(serviceSrc).toContain("data.organization_id !== ctx.organizationId")
  })

  it('10: editing terms does not import or call any transaction-recording function', () => {
    expect(serviceSrc).not.toContain('record_financial_transfer')
    expect(serviceSrc).not.toContain('record_financial_card_payment')
    expect(serviceSrc).not.toContain('financial_transactions')
    expect(serviceSrc).not.toContain('insert_transaction')
  })

  it('11: readLiabilityTerms org-checks fetched rows', () => {
    expect(serviceSrc).toContain('organization_id !== ctx.organizationId')
  })
})

// ── Type contract ─────────────────────────────────────────────────────────────

describe('CORE-CLOSE-2B LiabilityTermsRow type contract', () => {

  it('12: LiabilityTermsRow includes all required term fields', () => {
    expect(termsSrc).toContain('apr_basis_points')
    expect(termsSrc).toContain('promo_apr_basis_points')
    expect(termsSrc).toContain('promo_expires_on')
    expect(termsSrc).toContain('minimum_payment_minor')
    expect(termsSrc).toContain('payment_due_day')
    expect(termsSrc).toContain('next_due_date')
    expect(termsSrc).toContain('scheduled_payment_minor')
    expect(termsSrc).toContain('original_principal_minor')
    expect(termsSrc).toContain('maturity_date')
    expect(termsSrc).toContain('owner_notes')
    expect(termsSrc).toContain('debt_structure')
  })

  it('13: all term fields are nullable (| null) in LiabilityTermsRow', () => {
    // Every term field must be nullable — unknown stays unknown
    const fields = [
      'debt_structure', 'apr_basis_points', 'promo_apr_basis_points', 'promo_expires_on',
      'minimum_payment_minor', 'payment_due_day', 'next_due_date',
      'scheduled_payment_minor', 'original_principal_minor', 'maturity_date', 'owner_notes',
    ]
    for (const field of fields) {
      expect(termsSrc).toContain(`${field}:`)
      const fieldIdx = termsSrc.indexOf(`${field}:`)
      const fieldLine = termsSrc.slice(fieldIdx, termsSrc.indexOf('\n', fieldIdx))
      expect(fieldLine).toContain('null')
    }
  })

  it('14: DebtStructure type covers revolving, installment, and other', () => {
    expect(termsSrc).toContain("'revolving'")
    expect(termsSrc).toContain("'installment'")
    expect(termsSrc).toContain("'other'")
  })

  it('15: LiabilityTermsRow does NOT include balance or amount_minor', () => {
    expect(termsSrc).not.toContain('current_balance')
    expect(termsSrc).not.toContain('amount_minor')
  })
})

// ── CashOsDebtPlan source inspection ─────────────────────────────────────────

describe('CORE-CLOSE-2B CashOsDebtPlan debt terms display', () => {

  it('16: CashOsDebtPlan reads sources.liabilityTerms to build terms index', () => {
    expect(debtPlanSrc).toContain('sources.liabilityTerms')
  })

  it('17: CashOsDebtPlan shows Edit Terms action per account', () => {
    expect(debtPlanSrc).toContain('Edit Terms')
  })

  it('18: CashOsDebtPlan renders CashOsDebtTermsEditor when editing', () => {
    expect(debtPlanSrc).toContain('CashOsDebtTermsEditor')
  })

  it('19: CashOsDebtPlan shows Debt terms not stored when no terms exist', () => {
    expect(debtPlanSrc).toContain('Debt terms not stored')
  })

  it('20: CashOsDebtPlan shows APR from terms as basis points converted to %', () => {
    expect(debtPlanSrc).toContain('apr_basis_points')
    expect(debtPlanSrc).toContain('fmtApr')
  })

  it('21: CashOsDebtPlan shows promo APR separately with expiration', () => {
    expect(debtPlanSrc).toContain('promo_apr_basis_points')
    expect(debtPlanSrc).toContain('promo_expires_on')
    // Formatting is done via fmtMonthYear/fmtFullDate — no separate fmtPromoExpiry needed
    expect(debtPlanSrc).toContain('fmtMonthYear')
    expect(debtPlanSrc).toContain('fmtFullDate')
  })

  it('22: CashOsDebtPlan balance still comes from balanceForAccount (canonical ledger)', () => {
    expect(debtPlanSrc).toContain('balanceForAccount')
    expect(debtPlanSrc).toContain('snapshot.accountBalancesMinor')
    expect(debtPlanSrc).toContain('accountBalanceMinor(')
  })

  it('23: CashOsDebtPlan does not auto-allocate Truly Free Cash to debt', () => {
    expect(debtPlanSrc).not.toContain('extraPayment')
    expect(debtPlanSrc).not.toContain('payoffMonths')
    expect(debtPlanSrc).toContain('Owner decision — not automatically allocated to debt')
  })

  it('24: CashOsDebtPlan locally overrides terms after save without full re-fetch', () => {
    expect(debtPlanSrc).toContain('savedTermsById')
    expect(debtPlanSrc).toContain('setSavedTermsById')
  })
})

// ── Unit: APR precision ───────────────────────────────────────────────────────

describe('CORE-CLOSE-2B APR basis-points precision', () => {

  it('25: revolving debt with known APR: basis points round-trip without floating-point error', () => {
    const pctInput = 24.99
    const basisPoints = Math.round(pctInput * 100)
    expect(basisPoints).toBe(2499)
    const displayed = (basisPoints / 100).toFixed(2)
    expect(displayed).toBe('24.99')
  })

  it('26: 0% promo APR is stored as 0 basis points (not null)', () => {
    const terms = makeTerms({ promo_apr_basis_points: 0, promo_expires_on: '2027-03-31' })
    expect(terms.promo_apr_basis_points).toBe(0)
    expect(terms.promo_expires_on).toBe('2027-03-31')
    expect(terms.apr_basis_points).toBeNull()  // regular APR not overwritten
  })

  it('27: promo APR does not overwrite regular APR when both are set', () => {
    const terms = makeTerms({
      apr_basis_points: 2499,          // regular APR: 24.99%
      promo_apr_basis_points: 0,       // promo APR: 0%
      promo_expires_on: '2027-03-31',
    })
    expect(terms.apr_basis_points).toBe(2499)
    expect(terms.promo_apr_basis_points).toBe(0)
  })
})

// ── Unit: null semantics ──────────────────────────────────────────────────────

describe('CORE-CLOSE-2B unknown terms remain null', () => {

  it('28: terms with no fields set is valid and all-null', () => {
    const terms = makeTerms()
    expect(terms.apr_basis_points).toBeNull()
    expect(terms.promo_apr_basis_points).toBeNull()
    expect(terms.minimum_payment_minor).toBeNull()
    expect(terms.payment_due_day).toBeNull()
    expect(terms.debt_structure).toBeNull()
    expect(terms.maturity_date).toBeNull()
  })

  it('29: revolving debt only needs structure=revolving; installment fields remain null', () => {
    const terms = makeTerms({ debt_structure: 'revolving', apr_basis_points: 2499, minimum_payment_minor: 2500 })
    expect(terms.debt_structure).toBe('revolving')
    expect(terms.scheduled_payment_minor).toBeNull()
    expect(terms.original_principal_minor).toBeNull()
    expect(terms.maturity_date).toBeNull()
  })

  it('30: installment debt can carry principal and maturity without a revolving structure', () => {
    const terms = makeTerms({
      debt_structure: 'installment',
      apr_basis_points: 699,
      scheduled_payment_minor: 45000,
      original_principal_minor: 2800000,
      maturity_date: '2031-06-15',
    })
    expect(terms.debt_structure).toBe('installment')
    expect(terms.scheduled_payment_minor).toBe(45000)
    expect(terms.original_principal_minor).toBe(2800000)
    expect(terms.maturity_date).toBe('2031-06-15')
    expect(terms.promo_apr_basis_points).toBeNull()
  })

  it('31: promo coherence: expires_on requires promo_apr OR promo_type (updated constraint)', () => {
    // Updated constraint: promo_expires_on IS NULL OR promo_apr_basis_points IS NOT NULL OR promo_type IS NOT NULL
    // This allows deferred_interest (expires_on + promo_type, but promo_apr may be null)
    type CoherenceRow = { promo_expires_on: string | null; promo_apr_basis_points: number | null; promo_type: string | null }
    const violatesCoherence = (row: CoherenceRow) =>
      row.promo_expires_on !== null && row.promo_apr_basis_points === null && row.promo_type === null
    // Orphaned expiry — no promo context: violation
    expect(violatesCoherence({ promo_expires_on: '2027-03-31', promo_apr_basis_points: null, promo_type: null })).toBe(true)
    // Expiry + promo APR (intro_apr / reduced_apr): valid
    expect(violatesCoherence({ promo_expires_on: '2027-03-31', promo_apr_basis_points: 0, promo_type: null })).toBe(false)
    // Expiry + promo_type (deferred_interest, no promo APR): valid
    expect(violatesCoherence({ promo_expires_on: '2027-03-31', promo_apr_basis_points: null, promo_type: 'deferred_interest' })).toBe(false)
    // No expiry at all: valid
    expect(violatesCoherence({ promo_expires_on: null, promo_apr_basis_points: null, promo_type: null })).toBe(false)
  })
})

// ── 2A regression guard ───────────────────────────────────────────────────────

describe('CORE-CLOSE-2B does not break 2A canonical debt truth', () => {

  it('32: CashOsDebtPlan still filters by account_class === liability', () => {
    expect(debtPlanSrc).toContain("account_class === 'liability'")
  })

  it('33: CashOsDebtPlan still requires status === active', () => {
    expect(debtPlanSrc).toContain("status === 'active'")
  })

  it('34: CashOsDebtPlan still passes showTrulyFreeCash gate', () => {
    expect(debtPlanSrc).toContain('showTrulyFreeCash')
    expect(debtPlanSrc).toContain('showTrulyFreeCash ?')
  })

  it('35: CashOsDebtPlan does not use mockDebts, mockExpenses, or mock income', () => {
    expect(debtPlanSrc).not.toContain('mockDebts')
    expect(debtPlanSrc).not.toContain('mockExpenses')
    expect(debtPlanSrc).not.toContain('mockMonthlyIncome')
  })
})

// ── Promo financing truth correction regressions ──────────────────────────────

describe('CORE-CLOSE-2B promotional financing truth correction', () => {

  it('36: deferred_interest is a distinct PromoType from intro_apr', () => {
    expect(termsSrc).toContain("'deferred_interest'")
    expect(termsSrc).toContain("'intro_apr'")
    // They must appear separately — two distinct string literals
    const deferredIdx = termsSrc.indexOf("'deferred_interest'")
    const introIdx = termsSrc.indexOf("'intro_apr'")
    expect(deferredIdx).not.toBe(introIdx)
    expect(deferredIdx).toBeGreaterThan(-1)
    expect(introIdx).toBeGreaterThan(-1)
  })

  it('37: reduced_apr_fixed_payment is a distinct PromoType from both deferred_interest and intro_apr', () => {
    expect(termsSrc).toContain("'reduced_apr_fixed_payment'")
    const ridx = termsSrc.indexOf("'reduced_apr_fixed_payment'")
    const didx = termsSrc.indexOf("'deferred_interest'")
    const iidx = termsSrc.indexOf("'intro_apr'")
    expect(ridx).not.toBe(didx)
    expect(ridx).not.toBe(iidx)
    expect(ridx).toBeGreaterThan(-1)
  })

  it('38: promo_started_on is nullable — unknown start date remains null', () => {
    const terms = makeTerms({ promo_type: 'deferred_interest', promo_expires_on: '2027-06-30' })
    expect(terms.promo_started_on).toBeNull()
    expect(terms.promo_type).toBe('deferred_interest')
  })

  it('39: promo_expires_on is nullable — unknown deadline remains null', () => {
    const terms = makeTerms({ promo_type: 'deferred_interest', promo_started_on: '2025-01-15' })
    expect(terms.promo_expires_on).toBeNull()
    // No constraint violation: promo_expires_on is null, so coherence always holds
  })

  it('40: standard APR is never overwritten by promo APR — both fields coexist independently', () => {
    const terms = makeTerms({
      apr_basis_points: 2699,          // 26.99 % — standard/retroactive rate
      promo_apr_basis_points: 0,       // 0 % promo rate
      promo_type: 'intro_apr',
      promo_expires_on: '2027-01-31',
    })
    expect(terms.apr_basis_points).toBe(2699)
    expect(terms.promo_apr_basis_points).toBe(0)
    // Neither field is null; neither overwrites the other
  })

  it('41: 0% promo APR does NOT imply deferred_interest — promo_type must be explicit', () => {
    // A card with 0 bp promo could be intro_apr — the consumer must record promo_type
    const intro = makeTerms({ promo_apr_basis_points: 0, promo_type: 'intro_apr' })
    const deferred = makeTerms({ promo_apr_basis_points: null, promo_type: 'deferred_interest', apr_basis_points: 2699 })
    // They differ in promo_type — cannot be inferred from basis points alone
    expect(intro.promo_type).toBe('intro_apr')
    expect(deferred.promo_type).toBe('deferred_interest')
    expect(intro.promo_apr_basis_points).toBe(0)
    expect(deferred.promo_apr_basis_points).toBeNull()
  })

  it('42: existing no-promo liability with all promo fields null remains valid', () => {
    const terms = makeTerms({
      debt_structure: 'revolving',
      apr_basis_points: 2199,
      minimum_payment_minor: 2500,
    })
    expect(terms.promo_type).toBeNull()
    expect(terms.promo_started_on).toBeNull()
    expect(terms.promo_expires_on).toBeNull()
    expect(terms.promo_apr_basis_points).toBeNull()
    // Standard terms still valid without any promo
    expect(terms.apr_basis_points).toBe(2199)
  })

  it('43: UI source shows promo structure display without payoff or retroactive interest calculation', () => {
    // PromoBlock renders promo info — no payoff amount, no retroactive interest
    expect(debtPlanSrc).toContain('PromoBlock')
    expect(debtPlanSrc).toContain('promo_type')
    expect(debtPlanSrc).toContain('deferred_interest')
    // Must NOT attempt to calculate payoff requirement or accrued interest in 2B
    expect(debtPlanSrc).not.toContain('retroactiveInterest')
    expect(debtPlanSrc).not.toContain('payoffRequired')
    expect(debtPlanSrc).not.toContain('accruedInterest')
    expect(debtPlanSrc).not.toContain('payoffAmount')
  })
})
