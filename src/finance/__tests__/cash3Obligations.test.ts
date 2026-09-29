import { describe, expect, it } from 'vitest'
import { usd } from '../domain'
import {
  buildCommitmentEvent,
  buildRecurringObligationEvents,
  resolvePlannedStatus,
  summarizePlannedOutflows,
} from '../obligationCalculations'
import { generateRecurrenceDates, parseCalendarDate } from '../recurrence'
import type { CashCommitment, ObligationOccurrence, RecurringObligation } from '../obligationsTypes'

function obligation(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: 'ob-1',
    organizationId: 'org-1',
    name: 'Truck',
    description: null,
    category: 'vehicle',
    amount: usd(55913),
    amountCertainty: 'fixed',
    estimatedMinimum: null,
    estimatedMaximum: null,
    recurrence: {
      kind: 'monthly',
      interval: 1,
      anchorDate: '2026-01-31',
      startDate: '2026-01-31',
      endDate: null,
    },
    requirement: 'required',
    confidence: 'confirmed',
    status: 'active',
    accountId: null,
    debtAccountId: 'debt-1',
    projectId: null,
    sourceType: 'manual',
    provenance: {
      source: { organizationId: 'org-1', kind: 'financial_obligation', recordId: 'ob-1' },
      freshness: 'current',
      confidence: 'confirmed',
      reconciliationState: 'unreconciled',
    },
    ...overrides,
  }
}

function commitment(overrides: Partial<CashCommitment> = {}): CashCommitment {
  return {
    id: 'c-1',
    organizationId: 'org-1',
    title: 'Material',
    description: null,
    expectedDate: '2026-10-03',
    amount: usd(65000),
    amountCertainty: 'estimated',
    estimatedMinimum: null,
    estimatedMaximum: null,
    requirement: 'required',
    confidence: 'expected',
    category: 'materials',
    status: 'scheduled',
    accountId: null,
    projectId: 'rockn',
    employeeId: null,
    debtAccountId: null,
    sourceType: 'manual',
    reconciliationState: 'unreconciled',
    actualTransactionId: null,
    provenance: {
      source: { organizationId: 'org-1', kind: 'cash_commitment', recordId: 'c-1' },
      freshness: 'current',
      confidence: 'expected',
      reconciliationState: 'unreconciled',
    },
    ...overrides,
  }
}

describe('CASH-3 dated obligations', () => {
  it('expands a fixed monthly obligation to future due dates', () => {
    expect(generateRecurrenceDates(obligation().recurrence, '2026-01-01', '2026-04-30'))
      .toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('clamps month-end recurrence safely in February', () => {
    expect(generateRecurrenceDates(obligation().recurrence, '2026-02-01', '2026-02-28'))
      .toEqual(['2026-02-28'])
  })

  it('weekly recurrence is deterministic', () => {
    expect(generateRecurrenceDates({
      kind: 'weekly', interval: 1, anchorDate: '2026-09-01', startDate: '2026-09-01',
    }, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29',
    ])
  })

  it('every-N-weeks recurrence is deterministic', () => {
    expect(generateRecurrenceDates({
      kind: 'every_n_weeks', interval: 2, anchorDate: '2026-09-01', startDate: '2026-09-01',
    }, '2026-09-01', '2026-10-15')).toEqual([
      '2026-09-01', '2026-09-15', '2026-09-29', '2026-10-13',
    ])
  })

  it('yearly leap-date policy clamps to February 28', () => {
    expect(generateRecurrenceDates({
      kind: 'yearly', interval: 1, anchorDate: '2024-02-29', startDate: '2024-02-29',
    }, '2024-01-01', '2027-12-31')).toEqual([
      '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28',
    ])
  })

  it('rejects invalid calendar dates', () => {
    expect(() => parseCalendarDate('2026-02-30')).toThrow(/Invalid calendar date/)
  })

  it('rejects reversed read ranges', () => {
    expect(() => generateRecurrenceDates(obligation().recurrence, '2026-04-01', '2026-03-01'))
      .toThrow(/rangeStart/)
  })

  it('uses exact integer-cent amounts', () => {
    expect(obligation().amount.minor).toBe(55913)
  })

  it('project attribution does not create another monetary event', () => {
    const event = buildCommitmentEvent(commitment())
    expect(event.amount.minor).toBe(65000)
    expect(event.attribution.projectId).toBe('rockn')
  })

  it('debt attribution does not create another monetary event', () => {
    const events = buildRecurringObligationEvents(obligation(), [], '2026-01-01', '2026-01-31')
    expect(events).toHaveLength(1)
    expect(events[0].attribution.debtAccountId).toBe('debt-1')
  })

  it('paused obligations generate no future events', () => {
    expect(buildRecurringObligationEvents(obligation({ status: 'paused' }), [], '2026-01-01', '2026-12-31')).toEqual([])
  })

  it('canceled obligations generate no future events', () => {
    expect(buildRecurringObligationEvents(obligation({ status: 'canceled' }), [], '2026-01-01', '2026-12-31')).toEqual([])
  })

  it('archived obligations generate no future events', () => {
    expect(buildRecurringObligationEvents(obligation({ status: 'archived' }), [], '2026-01-01', '2026-12-31')).toEqual([])
  })

  it('skipped occurrence no longer contributes to planned required outflow', () => {
    const occ: ObligationOccurrence = {
      id: 'occ-1', organizationId: 'org-1', obligationId: 'ob-1',
      scheduledDate: '2026-01-31', status: 'skipped',
      reconciliationState: 'unreconciled',
    }
    const events = buildRecurringObligationEvents(obligation(), [occ], '2026-01-01', '2026-01-31')
    expect(summarizePlannedOutflows(events).requiredMinor).toBe(0)
  })

  it('date override changes only the planned event date', () => {
    const occ: ObligationOccurrence = {
      id: 'occ-1', organizationId: 'org-1', obligationId: 'ob-1',
      scheduledDate: '2026-01-31', overrideDate: '2026-02-02',
      status: 'scheduled', reconciliationState: 'unreconciled',
    }
    const events = buildRecurringObligationEvents(obligation(), [occ], '2026-01-01', '2026-01-31')
    expect(events[0].date).toBe('2026-02-02')
    expect(events[0].amount.minor).toBe(55913)
  })

  it('amount override changes only the occurrence amount', () => {
    const occ: ObligationOccurrence = {
      id: 'occ-1', organizationId: 'org-1', obligationId: 'ob-1',
      scheduledDate: '2026-01-31', overrideAmount: usd(60000),
      status: 'scheduled', reconciliationState: 'unreconciled',
    }
    const events = buildRecurringObligationEvents(obligation(), [occ], '2026-01-01', '2026-01-31')
    expect(events[0].amount.minor).toBe(60000)
  })

  it('keeps required and optional totals separate', () => {
    const required = buildCommitmentEvent(commitment({ id: 'r', amount: usd(10000), requirement: 'required' }))
    const optional = buildCommitmentEvent(commitment({ id: 'o', amount: usd(3000), requirement: 'optional' }))
    const summary = summarizePlannedOutflows([required, optional])
    expect(summary.requiredMinor).toBe(10000)
    expect(summary.optionalMinor).toBe(3000)
  })

  it('keeps confidence totals separate', () => {
    const confirmed = buildCommitmentEvent(commitment({ id: 'a', amount: usd(100), confidence: 'confirmed' }))
    const expected = buildCommitmentEvent(commitment({ id: 'b', amount: usd(200), confidence: 'expected' }))
    const possible = buildCommitmentEvent(commitment({ id: 'c', amount: usd(300), confidence: 'possible' }))
    expect(summarizePlannedOutflows([confirmed, expected, possible]).byConfidence)
      .toEqual({ confirmed: 100, expected: 200, possible: 300 })
  })

  it('totals by category and date exactly', () => {
    const a = buildCommitmentEvent(commitment({ id: 'a', amount: usd(100), expectedDate: '2026-10-01', category: 'vehicle' }))
    const b = buildCommitmentEvent(commitment({ id: 'b', amount: usd(200), expectedDate: '2026-10-01', category: 'vehicle' }))
    const summary = summarizePlannedOutflows([a, b])
    expect(summary.byCategory.vehicle).toBe(300)
    expect(summary.byDate['2026-10-01']).toBe(300)
  })

  it('reconciled planned event is not counted as another outflow', () => {
    const event = buildCommitmentEvent(commitment({
      status: 'satisfied',
      reconciliationState: 'reconciled',
      actualTransactionId: 'tx-1',
    }))
    expect(summarizePlannedOutflows([event]).requiredMinor).toBe(0)
  })

  it('resolves upcoming, due, and overdue deterministically', () => {
    const event = buildCommitmentEvent(commitment({ expectedDate: '2026-10-03' }))
    expect(resolvePlannedStatus(event, '2026-10-01')).toBe('upcoming')
    expect(resolvePlannedStatus(event, '2026-10-03')).toBe('due')
    expect(resolvePlannedStatus(event, '2026-10-04')).toBe('overdue')
  })

  it('preserves terminal skipped/canceled/satisfied states', () => {
    expect(resolvePlannedStatus(buildCommitmentEvent(commitment({ status: 'skipped' })), '2026-10-03')).toBe('skipped')
    expect(resolvePlannedStatus(buildCommitmentEvent(commitment({ status: 'canceled' })), '2026-10-03')).toBe('canceled')
    expect(resolvePlannedStatus(buildCommitmentEvent(commitment({
      status: 'satisfied', reconciliationState: 'reconciled', actualTransactionId: 'tx',
    })), '2026-10-03')).toBe('satisfied')
  })
})
