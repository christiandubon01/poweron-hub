import { parseCalendarDate } from '@/finance/recurrence'
import type { TaxReservePolicy } from '@/finance/allocationTypes'
import { CASH_OS_TIMEZONE } from './cashOsReadService'

export interface CashOsSessionSetup {
  version: 1
  organizationId: string
  payrollPaidThroughDate: string
  protectionHorizonDays: number
  operatingFloorMinor: number
  taxReserve: TaxReservePolicy
  includeOptionalObligations: boolean
  includeOpenShiftEstimates: boolean
  timezoneConfirmed: true
  confirmedAt: string
}

export function cashOsSessionKey(organizationId: string): string {
  return `poweron:cash-os-session:${organizationId}`
}

export function validateCashOsSessionSetup(value: unknown, organizationId: string): CashOsSessionSetup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, any>
  if (row.version !== 1 || row.organizationId !== organizationId || row.timezoneConfirmed !== true) return null
  try { parseCalendarDate(row.payrollPaidThroughDate) } catch { return null }
  if (!Number.isSafeInteger(row.protectionHorizonDays) || row.protectionHorizonDays < 0) return null
  if (!Number.isSafeInteger(row.operatingFloorMinor) || row.operatingFloorMinor < 0) return null
  if (row.taxReserve?.kind !== 'disabled'
    && !(row.taxReserve?.kind === 'fixed_amount' && Number.isSafeInteger(row.taxReserve.amountMinor)
      && row.taxReserve.amountMinor >= 0)) return null
  if (typeof row.includeOptionalObligations !== 'boolean'
    || typeof row.includeOpenShiftEstimates !== 'boolean') return null
  if (typeof row.confirmedAt !== 'string' || !Number.isFinite(Date.parse(row.confirmedAt))) return null
  return row as CashOsSessionSetup
}

export function loadCashOsSessionSetup(organizationId: string): CashOsSessionSetup | null {
  try {
    const raw = sessionStorage.getItem(cashOsSessionKey(organizationId))
    return raw ? validateCashOsSessionSetup(JSON.parse(raw), organizationId) : null
  } catch { return null }
}

/** Diagnostic only: never accepts or migrates an invalid stored assumption. */
export function missingCashOsSessionReason(organizationId: string):
  'SESSION_SETUP_REQUIRED' | 'PAYROLL_PAID_THROUGH_REQUIRED' {
  try {
    const raw = sessionStorage.getItem(cashOsSessionKey(organizationId))
    if (!raw) return 'SESSION_SETUP_REQUIRED'
    const row = JSON.parse(raw)
    if (row?.version === 1 && row?.organizationId === organizationId
      && !row.payrollPaidThroughDate) return 'PAYROLL_PAID_THROUGH_REQUIRED'
  } catch { /* Invalid stored data is ignored. */ }
  return 'SESSION_SETUP_REQUIRED'
}

export function saveCashOsSessionSetup(setup: CashOsSessionSetup): void {
  const valid = validateCashOsSessionSetup(setup, setup.organizationId)
  if (!valid) throw new Error('Invalid Cash OS session setup')
  sessionStorage.setItem(cashOsSessionKey(setup.organizationId), JSON.stringify(valid))
}

export function clearCashOsSessionSetup(organizationId: string): void {
  sessionStorage.removeItem(cashOsSessionKey(organizationId))
}

export function cashOsTimezoneReason(storedTimezone: string | null, setup: CashOsSessionSetup | null):
  'TIMEZONE_MISMATCH' | 'TIMEZONE_CONFIRMATION_REQUIRED' | null {
  if (storedTimezone && storedTimezone !== CASH_OS_TIMEZONE) return 'TIMEZONE_MISMATCH'
  if (!storedTimezone && !setup?.timezoneConfirmed) return 'TIMEZONE_CONFIRMATION_REQUIRED'
  return null
}
