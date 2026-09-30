import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cashOsSessionKey, cashOsTimezoneReason, clearCashOsSessionSetup,
  loadCashOsSessionSetup, missingCashOsSessionReason, saveCashOsSessionSetup, validateCashOsSessionSetup,
  type CashOsSessionSetup } from '@/services/cashOsSessionSetup'

const ORG = 'org-1'
const setup: CashOsSessionSetup = { version: 1, organizationId: ORG,
  payrollPaidThroughDate: '2026-09-28', protectionHorizonDays: 0, operatingFloorMinor: 0,
  taxReserve: { kind: 'disabled' }, includeOptionalObligations: false,
  includeOpenShiftEstimates: false, timezoneConfirmed: true,
  confirmedAt: '2026-09-29T20:00:00.000Z' }

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
  })
})

describe('CASH-8 session assumptions', () => {
  it('keys session values by organization', () => {
    expect(cashOsSessionKey('org-1')).not.toBe(cashOsSessionKey('org-2'))
  })
  it('accepts explicit zero floor and zero protection horizon', () => {
    expect(validateCashOsSessionSetup(setup, ORG)).toEqual(setup)
  })
  it('accepts explicit disabled tax', () => {
    expect(validateCashOsSessionSetup(setup, ORG)?.taxReserve).toEqual({ kind: 'disabled' })
  })
  it('accepts an explicit fixed tax amount', () => {
    expect(validateCashOsSessionSetup({ ...setup, taxReserve: { kind: 'fixed_amount', amountMinor: 300 } }, ORG)?.taxReserve)
      .toEqual({ kind: 'fixed_amount', amountMinor: 300 })
  })
  it('requires an explicitly chosen paid-through date', () => {
    expect(validateCashOsSessionSetup({ ...setup, payrollPaidThroughDate: '' }, ORG)).toBeNull()
  })
  it('identifies a missing paid-through authority without using invalid stored policy', () => {
    sessionStorage.setItem(cashOsSessionKey(ORG), JSON.stringify({ ...setup, payrollPaidThroughDate: '' }))
    expect(loadCashOsSessionSetup(ORG)).toBeNull()
    expect(missingCashOsSessionReason(ORG)).toBe('PAYROLL_PAID_THROUGH_REQUIRED')
  })
  it('rejects malformed dates', () => {
    expect(validateCashOsSessionSetup({ ...setup, payrollPaidThroughDate: '2026-02-30' }, ORG)).toBeNull()
  })
  it('rejects an absent floor rather than inferring zero', () => {
    expect(validateCashOsSessionSetup({ ...setup, operatingFloorMinor: undefined }, ORG)).toBeNull()
  })
  it('rejects an absent tax choice', () => {
    expect(validateCashOsSessionSetup({ ...setup, taxReserve: undefined }, ORG)).toBeNull()
  })
  it('rejects an absent optional-obligation choice', () => {
    expect(validateCashOsSessionSetup({ ...setup, includeOptionalObligations: undefined }, ORG)).toBeNull()
  })
  it('rejects an absent open-shift choice', () => {
    expect(validateCashOsSessionSetup({ ...setup, includeOpenShiftEstimates: undefined }, ORG)).toBeNull()
  })
  it('rejects unconfirmed timezone', () => {
    expect(validateCashOsSessionSetup({ ...setup, timezoneConfirmed: false }, ORG)).toBeNull()
  })
  it('requires confirmation when the raw stored timezone is absent', () => {
    expect(cashOsTimezoneReason(null, null)).toBe('TIMEZONE_CONFIRMATION_REQUIRED')
  })
  it('blocks a stored timezone mismatch even with a confirmed session', () => {
    expect(cashOsTimezoneReason('America/New_York', setup)).toBe('TIMEZONE_MISMATCH')
  })
  it('accepts stored Los Angeles authority', () => {
    expect(cashOsTimezoneReason('America/Los_Angeles', setup)).toBeNull()
  })
  it('does not share session setup with another org', () => {
    saveCashOsSessionSetup(setup)
    expect(loadCashOsSessionSetup('org-2')).toBeNull()
  })
  it('round-trips only validated assumptions', () => {
    saveCashOsSessionSetup(setup)
    expect(loadCashOsSessionSetup(ORG)).toEqual(setup)
  })
  it('ignores malformed prior session JSON', () => {
    sessionStorage.setItem(cashOsSessionKey(ORG), '{broken')
    expect(loadCashOsSessionSetup(ORG)).toBeNull()
  })
  it('ignores an older schema version', () => {
    sessionStorage.setItem(cashOsSessionKey(ORG), JSON.stringify({ ...setup, version: 0 }))
    expect(loadCashOsSessionSetup(ORG)).toBeNull()
  })
  it('rejects a wrong-organization payload even under this org key', () => {
    sessionStorage.setItem(cashOsSessionKey(ORG), JSON.stringify({ ...setup, organizationId: 'org-2' }))
    expect(loadCashOsSessionSetup(ORG)).toBeNull()
  })
  it('clears session assumptions on Reset', () => {
    saveCashOsSessionSetup(setup)
    clearCashOsSessionSetup(ORG)
    expect(loadCashOsSessionSetup(ORG)).toBeNull()
  })
})
