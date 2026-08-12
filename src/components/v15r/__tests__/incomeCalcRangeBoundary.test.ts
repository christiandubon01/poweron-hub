import { describe, expect, it } from 'vitest'
import { getServiceCashForRange } from '@/features/service-quote/serviceCashDate'

/**
 * FORENSIC-KPI-2B2-2C: pins the rolling 3-month Service-cash range that
 * V15rIncomeCalc builds and feeds to getServiceCashForRange.
 *
 * The component constructs (local-day → UTC midnight, half-open [start, end)):
 *   start = first day of the month 3 months before "today"
 *   end   = start of TOMORROW  (so a payment received TODAY is included)
 *
 * getServiceCashForRange is half-open [startInclusive, endExclusive), so today's
 * UTC midnight must be strictly less than endUtc — i.e. endUtc is tomorrow's
 * UTC midnight. This test replicates that construction with a fixed reference
 * "today" and asserts the three required guarantees.
 */

const TODAY = new Date('2026-08-11T10:30:00.000Z') // reference "now"

function incomeCalcRange(now: Date) {
  const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  const startUtc = new Date(
    `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-${String(
      threeMonthsAgo.getDate(),
    ).padStart(2, '0')}T00:00:00.000Z`,
  )
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const endUtc = new Date(
    `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(
      tomorrow.getDate(),
    ).padStart(2, '0')}T00:00:00.000Z`,
  )
  return { startUtc, endUtc }
}

function paymentEvent(overrides: Record<string, any> = {}): any {
  return {
    id: `pay-${overrides.amount ?? 'x'}`,
    amount: overrides.amount ?? 0,
    receivedAt: overrides.receivedAt ?? null,
    recordedAt: '2026-08-11T00:00:00.000Z',
    kind: 'payment',
    voidedAt: null,
    ...overrides,
  }
}

function serviceLog(overrides: Record<string, any> = {}): any {
  return {
    id: 'svc-1',
    serviceLogId: 'svc-1',
    date: '2026-06-05',
    quoted: 500,
    collected: 0,
    ...overrides,
  }
}

describe('FORENSIC-KPI-2B2-2C Income Calculator 3-month range boundary', () => {
  it('includes a Service payment received TODAY', () => {
    const { startUtc, endUtc } = incomeCalcRange(TODAY)
    // today = 2026-08-11; range = [2026-05-01, 2026-08-12)
    expect(startUtc.toISOString()).toBe('2026-05-01T00:00:00.000Z')
    expect(endUtc.toISOString()).toBe('2026-08-12T00:00:00.000Z')

    const svc = serviceLog({
      collected: 500,
      payments: [paymentEvent({ amount: 500, receivedAt: '2026-08-11' })],
    })
    const { knownDatedCash } = getServiceCashForRange([svc], startUtc, endUtc)
    expect(knownDatedCash).toBe(500)
  })

  it('excludes a Service payment received the day BEFORE the start boundary', () => {
    const { startUtc, endUtc } = incomeCalcRange(TODAY)
    // start = 2026-05-01; the day before is 2026-04-30 → excluded (half-open).
    const svc = serviceLog({
      collected: 400,
      payments: [paymentEvent({ amount: 400, receivedAt: '2026-04-30' })],
    })
    const { knownDatedCash, unknownDateCash } = getServiceCashForRange([svc], startUtc, endUtc)
    expect(knownDatedCash).toBe(0)
    // Dated but out-of-range is neither known-in-range nor unknown-date.
    expect(unknownDateCash).toBe(0)
  })

  it('does NOT fall back to the service-log date when no payment receivedAt exists', () => {
    const { startUtc, endUtc } = incomeCalcRange(TODAY)
    // Service work happened 2026-06-05 (inside the range) but there is no payment
    // event — only a legacy scalar collected. It must not be credited to June as
    // known dated cash; it is unknown-date cash.
    const svc = serviceLog({ date: '2026-06-05', collected: 300 })
    const { knownDatedCash, unknownDateCash } = getServiceCashForRange([svc], startUtc, endUtc)
    expect(knownDatedCash).toBe(0)
    expect(unknownDateCash).toBe(300)
  })
})