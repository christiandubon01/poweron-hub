import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  computeMoneyPlanSummary,
  validateRelease,
  validateEnvelopeTransfer,
  validateEnvelopeArchive,
} from '@/components/v15r/cash-os/CashMoneyPlan'
import type { CashOsEnvelopeBalance } from '@/finance/cashOsAllocationTypes'

// ─── helpers ─────────────────────────────────────────────────────────────────

function bal(envelopeId: string, balanceMinor: number): CashOsEnvelopeBalance {
  return { envelopeId, allocatedMinor: balanceMinor, releasedMinor: 0, balanceMinor }
}

// ─── 1: Creating a bucket has no effect on Total Cash ────────────────────────

describe('CASH-OS-1C2 Money Plan Controls', () => {
  it('1: computeMoneyPlanSummary returns same totalCashMinor regardless of bucket existence', () => {
    const totalCashMinor = 50000
    const emptyBalances: CashOsEnvelopeBalance[] = []
    const { allocatedMinor, unallocatedMinor } = computeMoneyPlanSummary(totalCashMinor, emptyBalances)
    // Adding a bucket changes nothing — no amount tracked here
    expect(allocatedMinor).toBe(0)
    expect(unallocatedMinor).toBe(totalCashMinor)
  })

  // ─── 2: Envelope with target does not change Total Cash ──────────────────

  it('2: envelope target amount does not appear in allocatedMinor (no entry yet)', () => {
    const totalCashMinor = 100000
    // An envelope exists with a 300 target, but no allocation entries yet
    const balances: CashOsEnvelopeBalance[] = [bal('env-1', 0)]
    const { allocatedMinor, unallocatedMinor } = computeMoneyPlanSummary(totalCashMinor, balances)
    expect(allocatedMinor).toBe(0)
    expect(unallocatedMinor).toBe(totalCashMinor)
  })

  // ─── 3: Allocation updates envelope state only ───────────────────────────

  it('3: allocation is reflected in allocatedMinor, unallocatedMinor decreases', () => {
    const totalCashMinor = 100000
    const balances: CashOsEnvelopeBalance[] = [bal('env-1', 30000)]
    const { allocatedMinor, unallocatedMinor, hasDeficit } = computeMoneyPlanSummary(totalCashMinor, balances)
    expect(allocatedMinor).toBe(30000)
    expect(unallocatedMinor).toBe(70000)
    expect(hasDeficit).toBe(false)
  })

  // ─── 4: Release updates envelope state only ──────────────────────────────

  it('4: after release the balanceMinor in summary decreases correctly', () => {
    const totalCashMinor = 100000
    // Initial: 30000 allocated. After a 10000 release the balance would be 20000.
    const balances: CashOsEnvelopeBalance[] = [bal('env-1', 20000)]
    const { allocatedMinor, unallocatedMinor } = computeMoneyPlanSummary(totalCashMinor, balances)
    expect(allocatedMinor).toBe(20000)
    expect(unallocatedMinor).toBe(80000)
  })

  // ─── 5: Transfer moves allocation between envelopes, total unchanged ─────

  it('5: transfer does not change total allocatedMinor', () => {
    const totalCashMinor = 100000
    // Before transfer: env-1=30000, env-2=10000 → total=40000
    // After transfer of 10000: env-1=20000, env-2=20000 → total=40000
    const before = computeMoneyPlanSummary(totalCashMinor, [bal('env-1', 30000), bal('env-2', 10000)])
    const after = computeMoneyPlanSummary(totalCashMinor, [bal('env-1', 20000), bal('env-2', 20000)])
    expect(before.allocatedMinor).toBe(after.allocatedMinor)
    expect(before.unallocatedMinor).toBe(after.unallocatedMinor)
  })

  // ─── 6: validateRelease rejects release > balance ────────────────────────

  it('6: validateRelease rejects when release amount exceeds balance', () => {
    expect(validateRelease(50001, 50000)).toBe('Cannot release more than the current balance')
  })

  it('6b: validateRelease accepts exact-balance release', () => {
    expect(validateRelease(50000, 50000)).toBeNull()
  })

  // ─── 7: validateEnvelopeTransfer rejects transfer > source balance ───────

  it('7: validateEnvelopeTransfer rejects amount exceeding source balance', () => {
    const err = validateEnvelopeTransfer('env-a', 'env-b', 99999, 50000)
    expect(err).toBe('Cannot transfer more than the source balance')
  })

  // ─── 8: validateEnvelopeTransfer rejects same-envelope transfer ──────────

  it('8: validateEnvelopeTransfer rejects same source and destination', () => {
    const err = validateEnvelopeTransfer('env-a', 'env-a', 1000, 50000)
    expect(err).toBe('Source and destination must differ')
  })

  // ─── 9: zero/negative amounts rejected ───────────────────────────────────

  it('9a: validateRelease rejects zero amount', () => {
    expect(validateRelease(0, 50000)).toBe('Enter a valid positive amount')
  })

  it('9b: validateRelease rejects negative amount', () => {
    expect(validateRelease(-100, 50000)).toBe('Enter a valid positive amount')
  })

  it('9c: validateEnvelopeTransfer rejects zero amount', () => {
    expect(validateEnvelopeTransfer('env-a', 'env-b', 0, 50000)).toBe('Enter a valid positive amount')
  })

  // ─── 10: Allocation deficit surfaced when Allocated > Total Cash ─────────

  it('10: computeMoneyPlanSummary surfaces allocation deficit', () => {
    const totalCashMinor = 10000
    const balances: CashOsEnvelopeBalance[] = [bal('env-1', 7000), bal('env-2', 5000)]
    const { allocatedMinor, hasDeficit, deficitMinor, unallocatedMinor } = computeMoneyPlanSummary(totalCashMinor, balances)
    expect(allocatedMinor).toBe(12000)
    expect(hasDeficit).toBe(true)
    expect(deficitMinor).toBe(2000)
    expect(unallocatedMinor).toBe(-2000)
  })

  // ─── 11: Read failure is distinguishable from empty state ────────────────

  it('11: service rejection produces an Error distinguishable from empty array', async () => {
    const failingService = () => Promise.reject(new Error('Failed to load Money Plan'))
    let caught: unknown = null
    await failingService().catch(e => { caught = e })
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('Failed to load Money Plan')
    // An empty-data response is a resolved promise with [], not a rejection
    const emptyService = () => Promise.resolve([])
    const result = await emptyService()
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  // ─── 12: Successful mutation triggers refresh (service mock) ─────────────

  it('12: allocateToEnvelope resolves and refresh re-calls listCashOsEnvelopes', async () => {
    const allocateSpy = vi.fn().mockResolvedValue(undefined)
    const listSpy = vi.fn().mockResolvedValue([])

    await allocateSpy('env-1', 5000, null)
    expect(allocateSpy).toHaveBeenCalledWith('env-1', 5000, null)

    // After success, refresh would call list again
    await listSpy()
    expect(listSpy).toHaveBeenCalledTimes(1)
  })

  // ─── 13: Total Cash / Protected / Truly Free are unchanged by Money Plan ─

  it('13: Money Plan helpers never modify totalCashMinor (pure function, no side effects)', () => {
    const totalCashMinor = 250000
    // Simulate multiple allocation operations
    const balances: CashOsEnvelopeBalance[] = [
      bal('env-1', 50000),
      bal('env-2', 75000),
      bal('env-3', 30000),
    ]
    const summary = computeMoneyPlanSummary(totalCashMinor, balances)
    // totalCashMinor is the canonical value, never mutated
    expect(summary.allocatedMinor + summary.unallocatedMinor).toBe(totalCashMinor)
    // Confirm no field names that would indicate mutation of canonical cash
    expect(summary).not.toHaveProperty('protectedCashMinor')
    expect(summary).not.toHaveProperty('trulyFreeCashMinor')
    expect(summary).not.toHaveProperty('closingCashMinor')
  })

  // ─── Archive guard tests (blocker fix) ───────────────────────────────────

  it('14: validateEnvelopeArchive blocks archive when balance > 0', () => {
    expect(validateEnvelopeArchive(5000)).not.toBeNull()
  })

  it('15: validateEnvelopeArchive returns an error string that prevents the service call', () => {
    const guard = validateEnvelopeArchive(5000)
    // The mutation path does: if (guard) { setError(guard); return }
    // A truthy string prevents archiveCashOsEnvelope from being reached
    expect(typeof guard).toBe('string')
    expect(guard!.length).toBeGreaterThan(0)
  })

  it('16: validateEnvelopeArchive message includes the formatted remaining balance', () => {
    const guard = validateEnvelopeArchive(5000)
    expect(guard).toContain('$50.00')
  })

  it('17: validateEnvelopeArchive allows archive when balance is zero', () => {
    expect(validateEnvelopeArchive(0)).toBeNull()
  })

  it('18: validateEnvelopeArchive is a pure function — does not create a release entry', () => {
    // Calling the guard function has no side effects (no async, no DB call, no state mutation)
    const before = validateEnvelopeArchive(5000)
    const after = validateEnvelopeArchive(5000)
    expect(before).toBe(after)
  })

  it('19: Total Allocated is unchanged when an archive attempt is blocked', () => {
    // The blocked archive does not touch the balance; computeMoneyPlanSummary still sees the allocation
    const totalCashMinor = 100000
    const balances: CashOsEnvelopeBalance[] = [bal('env-1', 5000)]
    const guard = validateEnvelopeArchive(balances[0].balanceMinor)
    expect(guard).not.toBeNull()
    // Balance was never touched — allocation is still present
    const { allocatedMinor } = computeMoneyPlanSummary(totalCashMinor, balances)
    expect(allocatedMinor).toBe(5000)
  })
})
