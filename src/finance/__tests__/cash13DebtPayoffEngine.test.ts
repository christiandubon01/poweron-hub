import { describe, expect, it } from 'vitest'
import {
  computePortfolioPayoff,
  checkPayoffSufficiency,
  type DebtInputRaw,
} from '../debtPayoffEngine'
import type { CreateObligationInput, CreateCommitmentInput } from '../../services/cashObligationService'

// ── Helpers ───────────────────────────────────────────────────────────────────

function debt(overrides: Partial<DebtInputRaw> & { accountId: string }): DebtInputRaw {
  return {
    label: overrides.accountId,
    ownershipContext: 'business',
    balanceMinor: 100_000,
    debtStructure: 'revolving',
    aprBasisPoints: 1200,
    minimumPaymentMinor: 5_000,
    scheduledPaymentMinor: null,
    promoAprBasisPoints: null,
    promoType: null,
    promoStartedOn: null,
    promoExpiresOn: null,
    ...overrides,
  }
}

describe('CORE-CLOSE-2C Debt Payoff Engine', () => {

  // ── Contractual payment selection ─────────────────────────────────────────

  it('1: installment debt uses scheduledPaymentMinor, not minimumPaymentMinor', () => {
    const d = debt({ accountId: 'inst', debtStructure: 'installment', minimumPaymentMinor: 5_000, scheduledPaymentMinor: 8_000 })
    const suf = checkPayoffSufficiency(d)
    expect(suf.ok).toBe(true)
    if (!suf.ok) return
    expect(suf.contractualPaymentMinor).toBe(8_000)
  })

  it('2: installment falls back to minimumPaymentMinor when scheduled is null', () => {
    const d = debt({ accountId: 'inst2', debtStructure: 'installment', minimumPaymentMinor: 5_000, scheduledPaymentMinor: null })
    const suf = checkPayoffSufficiency(d)
    expect(suf.ok).toBe(true)
    if (!suf.ok) return
    expect(suf.contractualPaymentMinor).toBe(5_000)
  })

  it('3: revolving debt uses minimumPaymentMinor', () => {
    const d = debt({ accountId: 'rev', debtStructure: 'revolving', minimumPaymentMinor: 3_000, scheduledPaymentMinor: null })
    const suf = checkPayoffSufficiency(d)
    expect(suf.ok).toBe(true)
    if (!suf.ok) return
    expect(suf.contractualPaymentMinor).toBe(3_000)
  })

  // ── Production-shaped Wells Fargo example ─────────────────────────────────

  it('4: WF production example — balance $4877, APR 1%, min $103 → finite baseline', () => {
    const wf = debt({
      accountId: 'wf', label: 'Wells Fargo CC',
      balanceMinor: 487_700, debtStructure: 'revolving',
      aprBasisPoints: 100, minimumPaymentMinor: 10_300, scheduledPaymentMinor: null,
    })
    const result = computePortfolioPayoff({
      debts: [wf], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    const d = result.debts[0]
    expect(d.nonAmortizing).toBe(false)
    expect(d.payoffMonths).toBeLessThan(Infinity)
    expect(d.payoffDate).not.toBeNull()
    expect(result.portfolioPayoffMonths).toBeGreaterThan(0)
    expect(result.portfolioPayoffMonths).toBeLessThan(600)
    // APR 1%, payment $103 on $4877 → interest ~$4/month, clears in ~50 months
    expect(d.payoffMonths).toBeLessThan(60)
  })

  // ── Zero-APR debt ─────────────────────────────────────────────────────────

  it('5: zero APR debt: pays off in exact payment-count months with zero interest', () => {
    const d = debt({
      accountId: 'zero', debtStructure: 'installment',
      balanceMinor: 120_000, aprBasisPoints: 0,
      minimumPaymentMinor: null, scheduledPaymentMinor: 10_000,
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts[0].payoffMonths).toBe(12)
    expect(result.debts[0].estimatedInterestMinor).toBe(0)
    expect(result.debts[0].nonAmortizing).toBe(false)
  })

  // ── Non-amortizing ────────────────────────────────────────────────────────

  it('6: non-amortizing payment: nonAmortizing flag set, no payoff date', () => {
    // balance $1000, APR 24%, monthly interest = round(100_000 * 0.24/12) = 2000
    // payment $1000 ≤ $2000 → non-amortizing
    const d = debt({
      accountId: 'na', balanceMinor: 100_000, debtStructure: 'revolving',
      aprBasisPoints: 2400, minimumPaymentMinor: 1_000, scheduledPaymentMinor: null,
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts[0].nonAmortizing).toBe(true)
    expect(result.debts[0].payoffDate).toBeNull()
    expect(result.debts[0].payoffMonths).toBe(Infinity)
  })

  it('7: extra payment on non-amortizing baseline debt is not applied (isBaseline=true)', () => {
    const d = debt({
      accountId: 'na2', balanceMinor: 100_000, debtStructure: 'revolving',
      aprBasisPoints: 2400, minimumPaymentMinor: 1_000, scheduledPaymentMinor: null,
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 50_000, projectionStartDate: '2026-10-01',
    })
    // Baseline ignores extra — still non-amortizing
    expect(result.debts[0].nonAmortizing).toBe(true)
  })

  // ── Avalanche ordering ────────────────────────────────────────────────────

  it('8: avalanche orders by highest APR first', () => {
    const debts = [
      debt({ accountId: 'low', aprBasisPoints: 500, balanceMinor: 50_000 }),
      debt({ accountId: 'high', aprBasisPoints: 2000, balanceMinor: 50_000 }),
    ]
    const result = computePortfolioPayoff({
      debts, strategy: 'avalanche', scope: 'all',
      extraAvailableMinor: 20_000, projectionStartDate: '2026-10-01',
    })
    const highDebt = result.debts.find(d => d.accountId === 'high')!
    const lowDebt = result.debts.find(d => d.accountId === 'low')!
    expect(highDebt.payoffOrder).toBe(1)
    expect(lowDebt.payoffOrder).toBe(2)
    // High APR gets extra, pays off sooner
    expect(highDebt.payoffMonths).toBeLessThan(lowDebt.payoffMonths)
  })

  it('9: avalanche tie-break on APR: higher balance first', () => {
    const debts = [
      debt({ accountId: 'b', aprBasisPoints: 1500, balanceMinor: 50_000 }),
      debt({ accountId: 'a', aprBasisPoints: 1500, balanceMinor: 80_000 }), // same APR, higher balance
    ]
    const result = computePortfolioPayoff({
      debts, strategy: 'avalanche', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    const higher = result.debts.find(d => d.accountId === 'a')!
    expect(higher.payoffOrder).toBe(1)
  })

  it('10: avalanche tie-break on APR+balance: accountId lexicographic', () => {
    const debts = [
      debt({ accountId: 'z', aprBasisPoints: 1500, balanceMinor: 50_000 }),
      debt({ accountId: 'a', aprBasisPoints: 1500, balanceMinor: 50_000 }),
    ]
    const result = computePortfolioPayoff({
      debts, strategy: 'avalanche', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts.find(d => d.accountId === 'a')!.payoffOrder).toBe(1)
    expect(result.debts.find(d => d.accountId === 'z')!.payoffOrder).toBe(2)
  })

  // ── Snowball ordering ─────────────────────────────────────────────────────

  it('11: snowball orders by lowest balance first', () => {
    const debts = [
      debt({ accountId: 'big', balanceMinor: 200_000, aprBasisPoints: 1500 }),
      debt({ accountId: 'small', balanceMinor: 30_000, aprBasisPoints: 1000 }),
    ]
    const result = computePortfolioPayoff({
      debts, strategy: 'snowball', scope: 'all',
      extraAvailableMinor: 20_000, projectionStartDate: '2026-10-01',
    })
    expect(result.debts.find(d => d.accountId === 'small')!.payoffOrder).toBe(1)
    expect(result.debts.find(d => d.accountId === 'big')!.payoffOrder).toBe(2)
  })

  it('12: snowball tie-break on balance: higher APR first', () => {
    const debts = [
      debt({ accountId: 'lowapr', balanceMinor: 50_000, aprBasisPoints: 500 }),
      debt({ accountId: 'highapr', balanceMinor: 50_000, aprBasisPoints: 1800 }),
    ]
    const result = computePortfolioPayoff({
      debts, strategy: 'snowball', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts.find(d => d.accountId === 'highapr')!.payoffOrder).toBe(1)
  })

  // ── Target debt extra allocation ──────────────────────────────────────────

  it('13: target-debt extra goes to the specified debt first, regardless of APR order', () => {
    const debts = [
      debt({ accountId: 'target', balanceMinor: 100_000, aprBasisPoints: 500 }),  // lower APR
      debt({ accountId: 'other', balanceMinor: 100_000, aprBasisPoints: 1500 }),  // higher APR
    ]
    const result = computePortfolioPayoff({
      debts, strategy: 'target_debt', scope: 'all',
      extraAvailableMinor: 20_000, targetDebtAccountId: 'target',
      projectionStartDate: '2026-10-01',
    })
    const targetDebt = result.debts.find(d => d.accountId === 'target')!
    expect(targetDebt.payoffOrder).toBe(1)
    // Target receives extra, pays off sooner despite lower APR
    expect(targetDebt.payoffMonths).toBeLessThan(result.debts.find(d => d.accountId === 'other')!.payoffMonths)
  })

  // ── Input immutability ────────────────────────────────────────────────────

  it('14: computePortfolioPayoff never mutates the input debt objects', () => {
    const d = debt({ accountId: 'd1', balanceMinor: 200_000 })
    const originalBalance = d.balanceMinor
    const originalApr = d.aprBasisPoints
    computePortfolioPayoff({
      debts: [d], strategy: 'avalanche', scope: 'all',
      extraAvailableMinor: 50_000, projectionStartDate: '2026-10-01',
    })
    expect(d.balanceMinor).toBe(originalBalance)
    expect(d.aprBasisPoints).toBe(originalApr)
  })

  // ── TFC clamping ──────────────────────────────────────────────────────────

  it('15: modeled extra is capped at trulyFreeCashMinor when TFC is provided', () => {
    const d = debt({ accountId: 'd1', balanceMinor: 200_000, aprBasisPoints: 1200, minimumPaymentMinor: 2_000 })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'avalanche', scope: 'all',
      extraAvailableMinor: 50_000, trulyFreeCashMinor: 10_000,
      projectionStartDate: '2026-10-01',
    })
    // extra was 50_000 but TFC is only 10_000 → clamped
    expect(result.extraAvailableMinor).toBe(10_000)
    expect(result.debts[0].totalMonthlyPaymentMinor).toBe(2_000 + 10_000)
  })

  it('16: baseline strategy works without TFC and uses no extra', () => {
    const d = debt({
      accountId: 'd1', debtStructure: 'installment',
      balanceMinor: 50_000, aprBasisPoints: 600,
      minimumPaymentMinor: null, scheduledPaymentMinor: 5_000,
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts[0].payoffMonths).toBeLessThan(Infinity)
    expect(result.debts[0].modeledExtraMinor).toBe(0)
    expect(result.extraAvailableMinor).toBe(0)
  })

  // ── Missing terms ─────────────────────────────────────────────────────────

  it('17: missing terms mark only that debt incomplete; other debts still project', () => {
    const goodDebt = debt({ accountId: 'good', balanceMinor: 50_000 })
    const badDebt = debt({
      accountId: 'bad', debtStructure: null,
      aprBasisPoints: null, minimumPaymentMinor: null, scheduledPaymentMinor: null,
    })
    const result = computePortfolioPayoff({
      debts: [goodDebt, badDebt], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    const good = result.debts.find(d => d.accountId === 'good')!
    const bad = result.debts.find(d => d.accountId === 'bad')!
    expect(good.sufficiency.ok).toBe(true)
    expect(good.payoffMonths).toBeLessThan(Infinity)
    expect(bad.sufficiency.ok).toBe(false)
    expect(result.incompleteAccountIds).toContain('bad')
    expect(result.incompleteAccountIds).not.toContain('good')
  })

  // ── Scope filtering ───────────────────────────────────────────────────────

  it('18: business scope excludes personal debts', () => {
    const bizDebt = debt({ accountId: 'biz', ownershipContext: 'business' })
    const persDebt = debt({ accountId: 'pers', ownershipContext: 'personal' })
    const result = computePortfolioPayoff({
      debts: [bizDebt, persDebt], strategy: 'baseline', scope: 'business',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts).toHaveLength(1)
    expect(result.debts[0].accountId).toBe('biz')
  })

  it('19: personal scope excludes business debts', () => {
    const bizDebt = debt({ accountId: 'biz', ownershipContext: 'business' })
    const persDebt = debt({ accountId: 'pers', ownershipContext: 'personal' })
    const result = computePortfolioPayoff({
      debts: [bizDebt, persDebt], strategy: 'baseline', scope: 'personal',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts).toHaveLength(1)
    expect(result.debts[0].accountId).toBe('pers')
  })

  it('20: all scope includes both business and personal debts', () => {
    const bizDebt = debt({ accountId: 'biz', ownershipContext: 'business' })
    const persDebt = debt({ accountId: 'pers', ownershipContext: 'personal' })
    const result = computePortfolioPayoff({
      debts: [bizDebt, persDebt], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts).toHaveLength(2)
    expect(result.debts.map(d => d.accountId).sort()).toEqual(['biz', 'pers'])
  })

  // ── Promo APR handling ────────────────────────────────────────────────────

  it('21: promo APR reverts to standard APR after expiration', () => {
    // Promo intro_apr of 100bp expires at end of Oct 2026; standard is 2000bp
    // Month 1 (Oct): promoApr applies (100bp) → low interest
    // Month 2+ (Nov onward): standard APR (2000bp) → higher interest
    const promoDebt = debt({
      accountId: 'promo', balanceMinor: 100_000,
      aprBasisPoints: 2000, minimumPaymentMinor: 3_000,
      promoAprBasisPoints: 100, promoType: 'intro_apr',
      promoStartedOn: '2026-01-01', promoExpiresOn: '2026-10-31',
    })
    const noPromoDebt = debt({
      accountId: 'nopromo', balanceMinor: 100_000,
      aprBasisPoints: 2000, minimumPaymentMinor: 3_000,
    })
    const promoResult = computePortfolioPayoff({
      debts: [promoDebt], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    const noPromoResult = computePortfolioPayoff({
      debts: [noPromoDebt], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    // One month of promo rate → slightly less total interest
    expect(promoResult.debts[0].estimatedInterestMinor).toBeLessThan(
      noPromoResult.debts[0].estimatedInterestMinor,
    )
  })

  // ── Deferred interest ─────────────────────────────────────────────────────

  it('22: deferred interest: promoDeadlineRisk set when payoff exceeds promo expiry', () => {
    // Balance $20,000, payment $1,000/month, promo expires Jan 2027 (15 months)
    // At $1000/month with 0% interest: payoff in 20 months > 15 → risk = true
    const d = debt({
      accountId: 'deferred', balanceMinor: 2_000_000, minimumPaymentMinor: 100_000,
      aprBasisPoints: 2400,
      promoAprBasisPoints: 0, promoType: 'deferred_interest',
      promoStartedOn: '2026-01-01', promoExpiresOn: '2027-01-01',
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts[0].promoDeadlineRisk).toBe(true)
  })

  it('23: deferred interest: no promoDeadlineRisk when paid off before expiry', () => {
    // Balance $2,000, payment $1,000/month, promo expires Jan 2027
    // Pays off in 2 months → no risk
    const d = debt({
      accountId: 'deferred2', balanceMinor: 200_000, minimumPaymentMinor: 100_000,
      aprBasisPoints: 2400,
      promoAprBasisPoints: 0, promoType: 'deferred_interest',
      promoStartedOn: '2026-01-01', promoExpiresOn: '2027-01-01',
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts[0].promoDeadlineRisk).toBe(false)
    // APR = 0 during promo, paid off during promo → 0 interest (no fabricated retroactive charge)
    expect(result.debts[0].estimatedInterestMinor).toBe(0)
  })

  it('24: deferred interest: no fabricated retroactive interest in projection', () => {
    // Interest during deferred period is 0 per the engine spec — no back-calculation
    const d = debt({
      accountId: 'deferred3', balanceMinor: 500_000, minimumPaymentMinor: 100_000,
      aprBasisPoints: 0, // hypothetical 0% standard so we isolate promo effect
      promoAprBasisPoints: 0, promoType: 'deferred_interest',
      promoStartedOn: '2026-01-01', promoExpiresOn: '2027-01-01',
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    // 5 months to pay off, 0 interest (standard APR 0, deferred APR 0)
    expect(result.debts[0].payoffMonths).toBe(5)
    expect(result.debts[0].estimatedInterestMinor).toBe(0)
  })

  // ── Final partial payment ─────────────────────────────────────────────────

  it('25: final partial payment does not overstate interest', () => {
    // balance $100, APR 12%, payment $100
    // month 1: interest = round(10_000 * 0.12/12) = 100; balance 10_100; pay 10_000; remaining 100
    // month 2: interest = round(100 * 0.12/12) = 1; balance 101; pay 101; done
    // total interest = 101
    const d = debt({
      accountId: 'partial', debtStructure: 'installment',
      balanceMinor: 10_000, aprBasisPoints: 1200,
      minimumPaymentMinor: null, scheduledPaymentMinor: 10_000,
    })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.debts[0].payoffMonths).toBe(2)
    expect(result.debts[0].estimatedInterestMinor).toBe(101)
  })

  // ── Cascade behavior ──────────────────────────────────────────────────────

  it('26: cascade frees contractual payment from paid-off debt to next debt', () => {
    // Debt A: balance $500, payment $500, APR 0% → pays off in month 1
    // Debt B: balance $2000, payment $100, APR 0% → with cascade gets extra $500 from month 2
    // avalanche: APR equal → higher balance (B) would go first, but B has same APR as A and higher balance
    // Let's use target_debt to control order: target A first
    const debtA = debt({
      accountId: 'a', balanceMinor: 50_000, debtStructure: 'installment',
      aprBasisPoints: 0, minimumPaymentMinor: null, scheduledPaymentMinor: 50_000,
    })
    const debtB = debt({
      accountId: 'b', balanceMinor: 200_000, debtStructure: 'installment',
      aprBasisPoints: 0, minimumPaymentMinor: null, scheduledPaymentMinor: 10_000,
    })
    const withCascade = computePortfolioPayoff({
      debts: [debtA, debtB], strategy: 'target_debt', scope: 'all',
      extraAvailableMinor: 0, targetDebtAccountId: 'a',
      projectionStartDate: '2026-10-01',
    })
    const noCascade = computePortfolioPayoff({
      debts: [debtB], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    // With cascade, B gets A's freed $500/month starting month 2
    // noCascade: 200_000 / 10_000 = 20 months; with cascade: much less
    const bWithCascade = withCascade.debts.find(d => d.accountId === 'b')!
    expect(bWithCascade.payoffMonths).toBeLessThan(noCascade.debts[0].payoffMonths)
  })

  // ── Obligation linkage types ──────────────────────────────────────────────

  it('27: CreateObligationInput accepts debtAccountId field', () => {
    const input = {
      name: 'CC minimum payment',
      amountMinor: 10_300,
      schedule: 'monthly' as const,
      anchorDate: '2026-10-01',
      isRequired: true,
      confidence: 'confirmed' as const,
      debtAccountId: 'wf-cc-account-id',
    } satisfies CreateObligationInput
    expect(input.debtAccountId).toBe('wf-cc-account-id')
  })

  it('28: CreateCommitmentInput accepts debtAccountId field', () => {
    const input = {
      title: 'Balance payoff',
      amountMinor: 487_700,
      expectedDate: '2026-10-15',
      isRequired: true,
      confidence: 'expected' as const,
      debtAccountId: 'wf-cc-account-id',
    } satisfies CreateCommitmentInput
    expect(input.debtAccountId).toBe('wf-cc-account-id')
  })

  it('29: debtAccountId is optional (null is valid)', () => {
    const input = {
      name: 'Rent', amountMinor: 200_000, schedule: 'monthly' as const,
      anchorDate: '2026-10-01', isRequired: true, confidence: 'confirmed' as const,
      debtAccountId: null,
    } satisfies CreateObligationInput
    expect(input.debtAccountId).toBeNull()
  })

  // ── Pure function: no side effects ────────────────────────────────────────

  it('30: computePortfolioPayoff is synchronous and creates no financial_transactions', () => {
    const d = debt({ accountId: 'd1', balanceMinor: 100_000 })
    const result = computePortfolioPayoff({
      debts: [d], strategy: 'avalanche', scope: 'all',
      extraAvailableMinor: 10_000, projectionStartDate: '2026-10-01',
    })
    // Synchronous: result is not a Promise
    expect(result instanceof Promise).toBe(false)
    // Result type does not include a transactions array (no DB writes)
    expect('transactions' in result).toBe(false)
    // Has the expected shape
    expect(typeof result.strategy).toBe('string')
    expect(Array.isArray(result.debts)).toBe(true)
  })

  // ── portfolioPayoffDate round-trip ────────────────────────────────────────

  it('31: portfolioPayoffDate is null when any sufficient debt has no payoff date', () => {
    const amortizing = debt({ accountId: 'am', balanceMinor: 50_000, aprBasisPoints: 1200, minimumPaymentMinor: 5_000 })
    const nonAmortizing = debt({ accountId: 'na', balanceMinor: 100_000, aprBasisPoints: 2400, minimumPaymentMinor: 1_000 })
    const result = computePortfolioPayoff({
      debts: [amortizing, nonAmortizing], strategy: 'baseline', scope: 'all',
      extraAvailableMinor: 0, projectionStartDate: '2026-10-01',
    })
    expect(result.portfolioPayoffDate).toBeNull()
    expect(result.portfolioPayoffMonths).toBeNull()
  })

})
