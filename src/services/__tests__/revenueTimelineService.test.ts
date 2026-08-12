import { describe, expect, it } from 'vitest'
import { get8WeekCashFlow, getMonthlyRevenueComparison } from '../revenueTimelineService'

function paymentEvent(overrides: Record<string, any> = {}): any {
  return {
    id: `pay-${overrides.amount ?? 'x'}`,
    amount: overrides.amount ?? 0,
    receivedAt: overrides.receivedAt ?? null,
    recordedAt: overrides.recordedAt ?? '2026-08-12T00:00:00.000Z',
    kind: overrides.kind ?? 'payment',
    voidedAt: overrides.voidedAt ?? null,
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

describe('FORENSIC-KPI-2B2-2 revenue timeline service cash date truth', () => {
  it('TEST 1 — 8-week actual buckets service cash by payment receivedAt, not service log date', () => {
    const anchor = '2026-08-12'
    const serviceRecords = [
      serviceLog({
        date: '2026-06-05',
        collected: 400,
        payments: [paymentEvent({ amount: 400, receivedAt: '2026-08-12' })],
      }),
    ]

    const buckets = get8WeekCashFlow([], [], serviceRecords, anchor)
    const currentWeek = buckets.find(b => b.weekLabel === 'Aug 10')

    expect(currentWeek?.actual).toBe(400)
    expect(currentWeek?.actualSources?.serviceCollections).toHaveLength(1)
    expect(currentWeek?.actualSources?.serviceCollections[0].detail).toContain('2026-08-12')
  })

  it('TEST 2 — 8-week actual excludes service cash with no receivedAt', () => {
    const anchor = '2026-08-12'
    const serviceRecords = [serviceLog({ date: '2026-08-12', collected: 300 })]

    const buckets = get8WeekCashFlow([], [], serviceRecords, anchor)
    const currentWeek = buckets.find(b => b.weekLabel === 'Aug 10')

    expect(currentWeek?.actual).toBe(0)
  })

  it('TEST 3 — monthly comparison buckets service actual by receivedAt month', () => {
    const serviceRecords = [
      serviceLog({
        date: '2026-06-05',
        collected: 500,
        payments: [paymentEvent({ amount: 500, receivedAt: '2026-08-15' })],
      }),
    ]

    const months = getMonthlyRevenueComparison([], [], serviceRecords, 6, -2)
    const august = months.find(m => m.month === 'Aug 26')
    const june = months.find(m => m.month === 'Jun 26')

    expect(august?.actual).toBe(500)
    expect(june?.actual).toBe(0)
  })

  it('TEST 4 — refunds reduce the received period in 8-week actual', () => {
    const anchor = '2026-08-12'
    const serviceRecords = [
      serviceLog({
        collected: 300,
        payments: [
          paymentEvent({ amount: 500, receivedAt: '2026-08-12' }),
          paymentEvent({ amount: -200, receivedAt: '2026-08-12', kind: 'refund' }),
        ],
      }),
    ]

    const buckets = get8WeekCashFlow([], [], serviceRecords, anchor)
    const currentWeek = buckets.find(b => b.weekLabel === 'Aug 10')

    expect(currentWeek?.actual).toBe(300)
  })
})
