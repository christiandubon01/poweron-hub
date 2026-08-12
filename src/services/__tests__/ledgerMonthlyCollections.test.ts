import { describe, expect, it, vi } from 'vitest'
import { getMonthlyCollections } from '../ledgerDataBridge'
import * as backupDataService from '../backupDataService'

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

function mockBackup(overrides: Record<string, any> = {}) {
  return {
    projects: [],
    logs: [],
    serviceLogs: [],
    weeklyData: [],
    activeServiceCalls: [],
    settings: { dayTarget: 1_000 },
    ...overrides,
  }
}

describe('FORENSIC-KPI-2B2-2 ledger monthly collections', () => {
  it('TEST 1 — service collected is grouped by payment receivedAt, not service log date', () => {
    vi.spyOn(backupDataService, 'getBackupData').mockReturnValue(
      mockBackup({
        serviceLogs: [
          serviceLog({
            date: '2026-06-05',
            collected: 400,
            payments: [paymentEvent({ amount: 400, receivedAt: '2026-08-15' })],
          }),
        ],
      }) as any,
    )

    const months = getMonthlyCollections(12)
    const august = months.find(m => m.month === '2026-08')
    const june = months.find(m => m.month === '2026-06')

    expect(august?.collected).toBe(400)
    expect(june?.collected).toBe(0)
  })

  it('TEST 2 — service stock fields remain grouped by service log date', () => {
    vi.spyOn(backupDataService, 'getBackupData').mockReturnValue(
      mockBackup({
        serviceLogs: [
          serviceLog({
            date: '2026-06-05',
            quoted: 500,
            collected: 400,
            payments: [paymentEvent({ amount: 400, receivedAt: '2026-08-15' })],
          }),
        ],
      }) as any,
    )

    const months = getMonthlyCollections(12)
    const june = months.find(m => m.month === '2026-06')

    expect(june?.quoted).toBe(500)
    expect(june?.balance).toBe(100)
    expect(june?.count).toBe(1)
    expect(june?.collected).toBe(0)
  })

  it('TEST 3 — project logs still contribute collected by log date', () => {
    vi.spyOn(backupDataService, 'getBackupData').mockReturnValue(
      mockBackup({
        logs: [{ id: 'log-1', projectId: 'proj-1', date: '2026-08-10', collected: 250 }],
      }) as any,
    )

    const months = getMonthlyCollections(12)
    const august = months.find(m => m.month === '2026-08')

    expect(august?.collected).toBe(250)
  })

  it('TEST 4 — unknown-date service collected does not land in a month bucket', () => {
    vi.spyOn(backupDataService, 'getBackupData').mockReturnValue(
      mockBackup({
        serviceLogs: [serviceLog({ date: '2026-08-12', collected: 300 })],
      }) as any,
    )

    const months = getMonthlyCollections(12)
    const august = months.find(m => m.month === '2026-08')

    expect(august?.collected).toBe(0)
  })
})
