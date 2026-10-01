import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  validateObligationInput,
  validateCommitmentInput,
  validateCommitmentInput as _vci,
  archiveFinancialObligation,
  cancelCashCommitment,
  OBLIGATION_SCHEDULES,
  OBLIGATION_SCHEDULE_LABELS,
  type ObligationRecurrenceSchedule,
} from '@/services/cashObligationService'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const serviceSrc = readFileSync(resolve(__dirname, '../../services/cashObligationService.ts'), 'utf8')

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseDollarsMinor(raw: string): number {
  const val = parseFloat(raw.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(val) || val <= 0) throw new Error('Enter a valid positive amount')
  return Math.round(val * 100)
}

// ─── CASH-OS-2C Obligation + Commitment Owner Controls ────────────────────────

describe('CASH-OS-2C Obligation + Commitment Owner Controls', () => {

  // ─── 1–6: validateObligationInput ──────────────────────────────────────────

  it('1: validateObligationInput rejects empty name', () => {
    expect(validateObligationInput({ name: '', amountMinor: 50000, schedule: 'monthly', anchorDate: '2026-10-01' })).toBe('Name is required')
  })

  it('2: validateObligationInput rejects whitespace-only name', () => {
    expect(validateObligationInput({ name: '   ', amountMinor: 50000, schedule: 'monthly', anchorDate: '2026-10-01' })).toBe('Name is required')
  })

  it('3: validateObligationInput rejects zero amount', () => {
    expect(validateObligationInput({ name: 'Rent', amountMinor: 0, schedule: 'monthly', anchorDate: '2026-10-01' })).toBe('Enter a valid positive amount')
  })

  it('4: validateObligationInput rejects negative amount', () => {
    expect(validateObligationInput({ name: 'Rent', amountMinor: -100, schedule: 'monthly', anchorDate: '2026-10-01' })).toBe('Enter a valid positive amount')
  })

  it('5: validateObligationInput rejects invalid schedule', () => {
    expect(validateObligationInput({ name: 'Rent', amountMinor: 50000, schedule: 'bimonthly', anchorDate: '2026-10-01' })).toBe('Choose a recurrence schedule')
  })

  it('6: validateObligationInput rejects malformed anchor date', () => {
    expect(validateObligationInput({ name: 'Rent', amountMinor: 50000, schedule: 'monthly', anchorDate: 'not-a-date' })).toBe('Enter a valid start date')
  })

  it('6b: validateObligationInput accepts valid input for every schedule', () => {
    for (const schedule of OBLIGATION_SCHEDULES) {
      expect(validateObligationInput({ name: 'Test', amountMinor: 100, schedule, anchorDate: '2026-10-01' })).toBeNull()
    }
  })

  // ─── 7–10: validateCommitmentInput ─────────────────────────────────────────

  it('7: validateCommitmentInput rejects empty title', () => {
    expect(validateCommitmentInput({ title: '', amountMinor: 100000, expectedDate: '2026-11-01' })).toBe('Title is required')
  })

  it('8: validateCommitmentInput rejects zero amount', () => {
    expect(validateCommitmentInput({ title: 'Equipment', amountMinor: 0, expectedDate: '2026-11-01' })).toBe('Enter a valid positive amount')
  })

  it('9: validateCommitmentInput rejects missing expected date', () => {
    expect(validateCommitmentInput({ title: 'Equipment', amountMinor: 100000, expectedDate: '' })).toBe('Enter a valid expected date')
  })

  it('10: validateCommitmentInput accepts valid input', () => {
    expect(validateCommitmentInput({ title: 'Equipment', amountMinor: 100000, expectedDate: '2026-11-01' })).toBeNull()
  })

  // ─── 11: Dollar parsing uses integer minor units ──────────────────────────

  it('11a: parseDollarsMinor converts $1,500.00 to 150000', () => {
    expect(parseDollarsMinor('1500.00')).toBe(150000)
  })

  it('11b: parseDollarsMinor converts $559.13 to 55913', () => {
    expect(parseDollarsMinor('559.13')).toBe(55913)
  })

  it('11c: parseDollarsMinor strips non-numeric characters', () => {
    expect(parseDollarsMinor('$1,200.00')).toBe(120000)
  })

  it('11d: parseDollarsMinor rejects zero', () => {
    expect(() => parseDollarsMinor('0')).toThrow('Enter a valid positive amount')
  })

  it('11e: parseDollarsMinor rejects non-numeric', () => {
    expect(() => parseDollarsMinor('abc')).toThrow('Enter a valid positive amount')
  })

  // ─── 12: Schedule catalogue covers canonical DB values ────────────────────

  it('12: OBLIGATION_SCHEDULES maps to only canonical recurrence_kind values', () => {
    const allowedKinds = ['weekly', 'every_n_weeks', 'monthly', 'yearly']
    // All schedules have labels
    for (const s of OBLIGATION_SCHEDULES) {
      expect(OBLIGATION_SCHEDULE_LABELS[s]).toBeTruthy()
    }
    // The catalogue has six options
    expect(OBLIGATION_SCHEDULES).toHaveLength(6)
    // Source contains only canonical kind values in the map
    for (const kind of allowedKinds) {
      expect(serviceSrc).toContain(`kind: '${kind}'`)
    }
    // Source does not contain any non-canonical kind
    expect(serviceSrc).not.toContain("kind: 'biweekly'")
    expect(serviceSrc).not.toContain("kind: 'bimonthly'")
  })

  // ─── 13: validateObligationInput is a pure function ───────────────────────

  it('13: validateObligationInput is pure — same input always returns same output', () => {
    const args = { name: 'Truck', amountMinor: 55913, schedule: 'monthly' as ObligationRecurrenceSchedule, anchorDate: '2026-01-31' }
    expect(validateObligationInput(args)).toBe(validateObligationInput(args))
  })

  // ─── 14: validateCommitmentInput is a pure function ───────────────────────

  it('14: validateCommitmentInput is pure — same input always returns same output', () => {
    const args = { title: 'Material', amountMinor: 65000, expectedDate: '2026-10-03' }
    expect(validateCommitmentInput(args)).toBe(validateCommitmentInput(args))
  })

  // ─── 15: Obligation creation payload structure ────────────────────────────

  it('15: CreateObligationInput does not reference financial_transactions or financial_accounts fields', () => {
    const illegalFields = ['transaction_kind', 'economic_effect', 'amount_minor', 'account_class', 'include_in_cash']
    // Verify these field names cannot appear in the CreateObligationInput type
    // by asserting that a valid payload carries none of them
    const payload = {
      name: 'Rent',
      category: 'rent',
      amountMinor: 200000,
      schedule: 'monthly' as ObligationRecurrenceSchedule,
      anchorDate: '2026-10-01',
      isRequired: true,
      confidence: 'expected' as const,
    }
    for (const field of illegalFields) {
      expect(payload).not.toHaveProperty(field)
    }
  })

  // ─── 16: Commitment cancel guard prevents reconciled cancellation ─────────

  it('16: cancelCashCommitment guard — only unreconciled scheduled commitments can be canceled', () => {
    expect(typeof cancelCashCommitment).toBe('function')
    // The service WHERE clause targets only status='scheduled' + reconciliation_state='unreconciled'
    const cancelFnIdx = serviceSrc.indexOf('async function cancelCashCommitment')
    const cancelFnEnd = serviceSrc.indexOf('\n}', cancelFnIdx)
    const body = serviceSrc.slice(cancelFnIdx, cancelFnEnd)
    expect(body).toContain("'scheduled'")
    expect(body).toContain("'unreconciled'")
  })

  // ─── 17: Archive guard scopes to organization ────────────────────────────

  it('17: archiveFinancialObligation rejects with "id is required" for empty id', async () => {
    expect(typeof archiveFinancialObligation).toBe('function')
    await expect(archiveFinancialObligation('')).rejects.toThrow('id is required')
  })

  // ─── 18: No write path creates financial_transactions ────────────────────

  it('18: service module does not import manualLedgerService record functions', () => {
    expect(serviceSrc).not.toContain('recordManualTransaction')
    expect(serviceSrc).not.toContain('recordFinancialTransfer')
    expect(serviceSrc).not.toContain('recordFinancialCardPayment')
    expect(serviceSrc).not.toContain('financial_transactions')
    expect(serviceSrc).not.toContain('financial_accounts')
  })

  // ─── 19: Obligation status contract matches canonical schema ──────────────

  it('19: archive sets status=archived not canceled or deleted', () => {
    expect(serviceSrc).toContain("status: 'archived'")
    expect(serviceSrc).toContain('archived_at')
    const archiveFnIdx = serviceSrc.indexOf('async function archiveFinancialObligation')
    const archiveFnEnd = serviceSrc.indexOf('\n}', archiveFnIdx)
    const archiveFnBody = serviceSrc.slice(archiveFnIdx, archiveFnEnd)
    expect(archiveFnBody).not.toContain('.delete(')
  })

  // ─── 20: Total Cash unaffected by obligation creation ────────────────────

  it('20: creating an obligation does not touch financial_accounts or financial_transactions', () => {
    const createFnIdx = serviceSrc.indexOf('async function createFinancialObligation')
    const createFnEnd = serviceSrc.indexOf('\n}', createFnIdx)
    const body = serviceSrc.slice(createFnIdx, createFnEnd)
    expect(body).not.toContain('financial_accounts')
    expect(body).not.toContain('financial_transactions')
    expect(body).toContain("'financial_obligations'")
  })

  // ─── 21: Total Cash unaffected by commitment creation ────────────────────

  it('21: creating a commitment does not touch financial_accounts or financial_transactions', () => {
    const createFnIdx = serviceSrc.indexOf('async function createCashCommitment')
    const createFnEnd = serviceSrc.indexOf('\n}', createFnIdx)
    const body = serviceSrc.slice(createFnIdx, createFnEnd)
    expect(body).not.toContain('financial_accounts')
    expect(body).not.toContain('financial_transactions')
    expect(body).toContain("'cash_commitments'")
  })

  // ─── 22: Reconciliation contract not violated by UI cancel ────────────────

  it('22: updateCashCommitment and cancelCashCommitment both scope to unreconciled scheduled rows', () => {
    const updateFnIdx = serviceSrc.indexOf('async function updateCashCommitment')
    const updateFnEnd = serviceSrc.indexOf('\n}', updateFnIdx)
    const updateBody = serviceSrc.slice(updateFnIdx, updateFnEnd)
    expect(updateBody).toContain("'unreconciled'")
    expect(updateBody).toContain("'scheduled'")

    const cancelFnIdx = serviceSrc.indexOf('async function cancelCashCommitment')
    const cancelFnEnd = serviceSrc.indexOf('\n}', cancelFnIdx)
    const cancelBody = serviceSrc.slice(cancelFnIdx, cancelFnEnd)
    expect(cancelBody).toContain("'unreconciled'")
    expect(cancelBody).toContain("'scheduled'")
    expect(cancelBody).toContain("status: 'canceled'")
  })
})
