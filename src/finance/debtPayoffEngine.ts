// Debt payoff engine — pure functions, no network calls, no ledger mutations.
// Monthly interest convention: Math.round(balance × APR / 12), in minor units.
// These are planning estimates; actual issuer calculations may differ.

export type PayoffStrategy = 'baseline' | 'avalanche' | 'snowball' | 'target_debt'
export type OwnershipScope = 'all' | 'business' | 'personal'

export interface DebtInputRaw {
  accountId: string
  label: string
  ownershipContext: 'business' | 'personal'
  balanceMinor: number
  debtStructure: 'revolving' | 'installment' | 'other' | null
  aprBasisPoints: number | null
  minimumPaymentMinor: number | null
  scheduledPaymentMinor: number | null
  promoAprBasisPoints: number | null
  promoType: 'intro_apr' | 'deferred_interest' | 'reduced_apr_fixed_payment' | 'other' | null
  promoStartedOn: string | null
  promoExpiresOn: string | null
}

export type PayoffSufficiencyResult =
  | { ok: true; contractualPaymentMinor: number }
  | { ok: false; reason: 'no_balance' | 'needs_terms'; missingFields: string[] }

export interface DebtPayoffResult {
  accountId: string
  label: string
  ownershipContext: 'business' | 'personal'
  balanceMinor: number
  contractualPaymentMinor: number | null
  modeledExtraMinor: number
  totalMonthlyPaymentMinor: number | null
  payoffMonths: number
  payoffDate: string | null
  estimatedInterestMinor: number
  nonAmortizing: boolean
  promoDeadlineRisk: boolean
  promoExpiresOn: string | null
  sufficiency: PayoffSufficiencyResult
  payoffOrder: number
}

export interface PortfolioPayoffResult {
  strategy: PayoffStrategy
  scope: OwnershipScope
  targetDebtAccountId: string | null
  extraAvailableMinor: number
  projectionStartDate: string
  debts: DebtPayoffResult[]
  portfolioPayoffDate: string | null
  portfolioPayoffMonths: number | null
  totalPortfolioInterestMinor: number | null
  portfolioComplete: boolean
  incompleteAccountIds: string[]
}

export interface ComputePortfolioPayoffInput {
  debts: DebtInputRaw[]
  strategy: PayoffStrategy
  scope: OwnershipScope
  extraAvailableMinor: number
  targetDebtAccountId?: string | null
  projectionStartDate: string
  trulyFreeCashMinor?: number | null
}

const MAX_MONTHS = 600

// ── Helpers ────────────────────────────────────────────────────────────────────

function addMonthsToDate(isoDate: string, months: number): string {
  const [y, mo, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, mo - 1 + months, d))
  return date.toISOString().slice(0, 10)
}

function effectiveAprBpForMonth(
  monthDate: string,
  aprBp: number,
  promoAprBp: number | null,
  promoType: string | null,
  promoExpiresOn: string | null,
): number {
  if (promoAprBp === null || promoType === null || promoExpiresOn === null) return aprBp
  if (monthDate > promoExpiresOn) return aprBp
  if (promoType === 'deferred_interest') return 0
  return promoAprBp
}

// ── Sufficiency gate ───────────────────────────────────────────────────────────

export function checkPayoffSufficiency(debt: DebtInputRaw): PayoffSufficiencyResult {
  if (debt.balanceMinor <= 0) {
    return { ok: false, reason: 'no_balance', missingFields: [] }
  }
  const missing: string[] = []
  if (debt.aprBasisPoints == null) missing.push('APR')

  let contractual: number | null = null
  const { debtStructure, scheduledPaymentMinor, minimumPaymentMinor } = debt

  if (debtStructure === 'installment') {
    contractual = scheduledPaymentMinor ?? minimumPaymentMinor
    if (contractual == null) missing.push('scheduled or minimum payment')
  } else if (debtStructure === 'revolving') {
    contractual = minimumPaymentMinor
    if (contractual == null) missing.push('minimum payment')
  } else if (debtStructure === 'other') {
    contractual = scheduledPaymentMinor ?? minimumPaymentMinor
    if (contractual == null) missing.push('contractual payment')
  } else {
    missing.push('debt structure')
    if (scheduledPaymentMinor == null && minimumPaymentMinor == null) {
      missing.push('contractual payment')
    } else {
      contractual = scheduledPaymentMinor ?? minimumPaymentMinor
    }
  }

  if (missing.length > 0) return { ok: false, reason: 'needs_terms', missingFields: missing }
  return { ok: true, contractualPaymentMinor: contractual! }
}

// ── Strategy ordering ──────────────────────────────────────────────────────────

interface SufficientDebt {
  debt: DebtInputRaw
  contractualPaymentMinor: number
}

function sortDebtsForStrategy(
  debts: SufficientDebt[],
  strategy: PayoffStrategy,
  targetDebtAccountId: string | null,
): SufficientDebt[] {
  const sorted = [...debts]
  if (strategy === 'avalanche') {
    // Highest APR first; tie-break: highest balance first; then accountId for determinism
    sorted.sort((a, b) => {
      const aprDiff = (b.debt.aprBasisPoints ?? 0) - (a.debt.aprBasisPoints ?? 0)
      if (aprDiff !== 0) return aprDiff
      const balDiff = b.debt.balanceMinor - a.debt.balanceMinor
      if (balDiff !== 0) return balDiff
      return a.debt.accountId.localeCompare(b.debt.accountId)
    })
  } else if (strategy === 'snowball') {
    // Lowest balance first; tie-break: highest APR first; then accountId for determinism
    sorted.sort((a, b) => {
      const balDiff = a.debt.balanceMinor - b.debt.balanceMinor
      if (balDiff !== 0) return balDiff
      const aprDiff = (b.debt.aprBasisPoints ?? 0) - (a.debt.aprBasisPoints ?? 0)
      if (aprDiff !== 0) return aprDiff
      return a.debt.accountId.localeCompare(b.debt.accountId)
    })
  } else if (strategy === 'target_debt' && targetDebtAccountId) {
    // Target debt first, then original order
    sorted.sort((a, b) => {
      if (a.debt.accountId === targetDebtAccountId) return -1
      if (b.debt.accountId === targetDebtAccountId) return 1
      return 0
    })
  }
  // baseline: no sorting needed; contractual only, no cascade
  return sorted
}

// ── Portfolio simulation ───────────────────────────────────────────────────────

interface SimState {
  accountId: string
  balance: number
  contractualPayment: number
  payoffMonth: number | null  // null = not paid off
  totalInterest: number
  totalExtraReceived: number
  nonAmortizing: boolean
  promoDeadlineRisk: boolean
}

function simulatePortfolio(
  sortedDebts: SufficientDebt[],
  extraPerMonth: number,
  projectionStartDate: string,
  isBaseline: boolean,
): SimState[] {
  const states: SimState[] = sortedDebts.map(d => ({
    accountId: d.debt.accountId,
    balance: d.debt.balanceMinor,
    contractualPayment: d.contractualPaymentMinor,
    payoffMonth: null,
    totalInterest: 0,
    totalExtraReceived: 0,
    nonAmortizing: false,
    promoDeadlineRisk: false,
  }))

  const debtMap = new Map(sortedDebts.map(d => [d.debt.accountId, d.debt]))
  let cascadePool = 0

  for (let m = 0; m < MAX_MONTHS; m++) {
    const monthDate = addMonthsToDate(projectionStartDate, m)
    const active = states.filter(s => s.payoffMonth === null && !s.nonAmortizing)
    if (active.length === 0) break

    // Phase 1: compute interest for all active debts
    const interestMap = new Map<string, number>()
    for (const state of active) {
      const debt = debtMap.get(state.accountId)!
      const aprBp = effectiveAprBpForMonth(monthDate, debt.aprBasisPoints ?? 0,
        debt.promoAprBasisPoints, debt.promoType, debt.promoExpiresOn)
      const interest = Math.round(state.balance * aprBp / 10000 / 12)
      interestMap.set(state.accountId, interest)
    }

    // Month-0 non-amortizing check
    if (m === 0) {
      for (let i = 0; i < active.length; i++) {
        const state = active[i]
        const interest = interestMap.get(state.accountId) ?? 0
        if (interest === 0) continue  // zero-rate debt always amortizes
        const isExtraTarget = !isBaseline && i === 0
        const totalPayment = state.contractualPayment + (isExtraTarget ? extraPerMonth + cascadePool : 0)
        if (totalPayment <= interest) {
          state.nonAmortizing = true
        }
      }
    }

    const eligibleActive = active.filter(s => !s.nonAmortizing)
    if (eligibleActive.length === 0) break

    let withinMonthExtra = isBaseline ? 0 : extraPerMonth + cascadePool
    cascadePool = 0  // will be replenished from payoffs this month

    // Phase 2: apply interest and payments in priority order
    for (let i = 0; i < eligibleActive.length; i++) {
      const state = eligibleActive[i]
      const interest = interestMap.get(state.accountId) ?? 0
      const debt = debtMap.get(state.accountId)!

      state.balance += interest
      state.totalInterest += interest

      const isExtraTarget = !isBaseline && i === 0
      const allocation = state.contractualPayment + (isExtraTarget ? withinMonthExtra : 0)
      const actualPayment = Math.min(allocation, state.balance)
      const surplus = allocation - actualPayment

      state.balance -= actualPayment
      if (isExtraTarget) {
        state.totalExtraReceived += Math.max(0, actualPayment - state.contractualPayment)
      }

      if (state.balance <= 0) {
        state.payoffMonth = m + 1
        // Promo deadline risk for deferred_interest
        if (debt.promoType === 'deferred_interest' && debt.promoExpiresOn) {
          const payoffDate = addMonthsToDate(projectionStartDate, m + 1)
          state.promoDeadlineRisk = payoffDate > debt.promoExpiresOn
        }
        // Cascade freed contractual + surplus to next debt in this month
        cascadePool += state.contractualPayment
        if (isExtraTarget && surplus > 0) {
          withinMonthExtra = surplus
          // Next debt (i+1) now becomes the extra target
        }
      }
    }
  }

  return states
}

// ── Main entry point ───────────────────────────────────────────────────────────

export function computePortfolioPayoff(input: ComputePortfolioPayoffInput): PortfolioPayoffResult {
  const { strategy, scope, targetDebtAccountId = null, projectionStartDate } = input

  // Clamp extra to available TFC if provided
  const clampedExtra = input.trulyFreeCashMinor != null
    ? Math.min(Math.max(0, input.extraAvailableMinor), Math.max(0, input.trulyFreeCashMinor))
    : Math.max(0, input.extraAvailableMinor)

  // Filter by scope
  const scopedDebts = input.debts.filter(d =>
    scope === 'all' || d.ownershipContext === scope,
  )

  // Check sufficiency per debt
  const sufficientDebts: SufficientDebt[] = []
  const insufficientResults: DebtPayoffResult[] = []

  for (const debt of scopedDebts) {
    const suf = checkPayoffSufficiency(debt)
    if (suf.ok) {
      sufficientDebts.push({ debt, contractualPaymentMinor: suf.contractualPaymentMinor })
    } else {
      insufficientResults.push({
        accountId: debt.accountId,
        label: debt.label,
        ownershipContext: debt.ownershipContext,
        balanceMinor: debt.balanceMinor,
        contractualPaymentMinor: null,
        modeledExtraMinor: 0,
        totalMonthlyPaymentMinor: null,
        payoffMonths: Infinity,
        payoffDate: null,
        estimatedInterestMinor: Infinity,
        nonAmortizing: false,
        promoDeadlineRisk: false,
        promoExpiresOn: debt.promoExpiresOn,
        sufficiency: suf,
        payoffOrder: 0,
      })
    }
  }

  if (sufficientDebts.length === 0) {
    return {
      strategy, scope, targetDebtAccountId, extraAvailableMinor: clampedExtra,
      projectionStartDate,
      debts: insufficientResults,
      portfolioPayoffDate: null, portfolioPayoffMonths: null,
      totalPortfolioInterestMinor: null, portfolioComplete: false,
      incompleteAccountIds: insufficientResults.map(r => r.accountId),
    }
  }

  const isBaseline = strategy === 'baseline'
  const sorted = sortDebtsForStrategy(sufficientDebts, strategy, targetDebtAccountId)
  const simStates = simulatePortfolio(sorted, clampedExtra, projectionStartDate, isBaseline)

  // Build per-debt results
  const debtResults: DebtPayoffResult[] = sorted.map((sd, idx) => {
    const state = simStates.find(s => s.accountId === sd.debt.accountId)!
    const nonAmortizing = state.nonAmortizing
    const payoffMonths = state.payoffMonth ?? Infinity
    const payoffDate = state.payoffMonth
      ? addMonthsToDate(projectionStartDate, state.payoffMonth)
      : null
    const estimatedInterestMinor = nonAmortizing ? Infinity :
      (state.payoffMonth == null ? Infinity : state.totalInterest)

    return {
      accountId: sd.debt.accountId,
      label: sd.debt.label,
      ownershipContext: sd.debt.ownershipContext,
      balanceMinor: sd.debt.balanceMinor,
      contractualPaymentMinor: sd.contractualPaymentMinor,
      modeledExtraMinor: state.totalExtraReceived,
      totalMonthlyPaymentMinor: sd.contractualPaymentMinor + (idx === 0 && !isBaseline ? clampedExtra : 0),
      payoffMonths,
      payoffDate,
      estimatedInterestMinor,
      nonAmortizing,
      promoDeadlineRisk: state.promoDeadlineRisk,
      promoExpiresOn: sd.debt.promoExpiresOn,
      sufficiency: { ok: true, contractualPaymentMinor: sd.contractualPaymentMinor },
      payoffOrder: idx + 1,
    }
  })

  const allResults = [...insufficientResults, ...debtResults]
  const incompleteIds = insufficientResults.map(r => r.accountId)
  const portfolioComplete = incompleteIds.length === 0

  // Portfolio payoff: latest payoff month across sufficient debts
  const allPayoffMonths = debtResults.map(r => r.payoffMonths).filter(m => isFinite(m))
  const portfolioPayoffMonths = allPayoffMonths.length === debtResults.length
    ? Math.max(...allPayoffMonths)
    : null
  const portfolioPayoffDate = portfolioPayoffMonths != null
    ? addMonthsToDate(projectionStartDate, portfolioPayoffMonths)
    : null
  const totalPortfolioInterestMinor = portfolioComplete &&
    debtResults.every(r => isFinite(r.estimatedInterestMinor))
    ? debtResults.reduce((sum, r) => sum + r.estimatedInterestMinor, 0)
    : null

  return {
    strategy, scope, targetDebtAccountId, extraAvailableMinor: clampedExtra,
    projectionStartDate, debts: allResults, portfolioPayoffDate, portfolioPayoffMonths,
    totalPortfolioInterestMinor, portfolioComplete, incompleteAccountIds: incompleteIds,
  }
}
