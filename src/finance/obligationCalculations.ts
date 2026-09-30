import { usd, type FinancialConfidence } from './domain'
import { generateRecurrenceDates, parseCalendarDate } from './recurrence'
import type {
  CashCommitment,
  ObligationOccurrence,
  PlannedCashOutflowEvent,
  PlannedOutflowSummary,
  RecurringObligation,
  ResolvedPlannedStatus,
} from './obligationsTypes'

function contributesToPlannedOutflow(event: PlannedCashOutflowEvent): boolean {
  return event.status === 'scheduled' && event.reconciliationState !== 'reconciled'
}

export function resolvePlannedStatus(
  event: Pick<PlannedCashOutflowEvent, 'date' | 'status' | 'reconciliationState'>,
  today: string,
): ResolvedPlannedStatus {
  parseCalendarDate(today)
  if (event.reconciliationState === 'reconciled' || event.status === 'satisfied') return 'satisfied'
  if (event.status === 'skipped') return 'skipped'
  if (event.status === 'canceled') return 'canceled'
  if (event.date === today) return 'due'
  return event.date < today ? 'overdue' : 'upcoming'
}

export function buildRecurringObligationEvents(
  obligation: RecurringObligation,
  occurrences: readonly ObligationOccurrence[],
  rangeStart: string,
  rangeEnd: string,
): PlannedCashOutflowEvent[] {
  if (obligation.status !== 'active') return []
  const occurrenceByDate = new Map(
    occurrences
      .filter((row) => row.obligationId === obligation.id)
      .map((row) => [row.scheduledDate, row]),
  )

  return generateRecurrenceDates(obligation.recurrence, rangeStart, rangeEnd).map((scheduledDate) => {
    const occurrence = occurrenceByDate.get(scheduledDate)
    const amount = occurrence?.overrideAmount ?? obligation.amount
    const date = occurrence?.overrideDate ?? scheduledDate
    const status = occurrence?.status ?? 'scheduled'
    const reconciliationState = occurrence?.reconciliationState ?? 'unreconciled'
    return {
      id: occurrence?.id ?? `${obligation.id}:${scheduledDate}`,
      organizationId: obligation.organizationId,
      sourceType: 'obligation_occurrence' as const,
      sourceRecordId: occurrence?.id ?? `${obligation.id}:${scheduledDate}`,
      date,
      direction: 'outflow' as const,
      amount,
      amountCertainty: obligation.amountCertainty,
      requirement: obligation.requirement,
      confidence: obligation.confidence,
      category: obligation.category ?? null,
      status,
      reconciliationState,
      actualTransactionId: occurrence?.actualTransactionId ?? null,
      attribution: {
        projectId: obligation.projectId ?? null,
        debtAccountId: obligation.debtAccountId ?? null,
        category: obligation.category ?? null,
      },
      provenance: {
        freshness: 'current' as const,
        note: occurrence ? 'Materialized occurrence exception/state.' : 'Generated from recurring obligation rule.',
      },
    }
  })
}

/**
 * Expand CASH-3 recurrence as usual, then include materialized occurrences whose
 * scheduled date falls outside that expansion but whose override moves them into
 * the effective window. `effectiveWindowStart=null` includes overdue overrides.
 */
export function buildRecurringObligationEventsIncludingOverrides(
  obligation: RecurringObligation,
  occurrences: readonly ObligationOccurrence[],
  rangeStart: string,
  rangeEnd: string,
  effectiveWindowStart: string | null = null,
): PlannedCashOutflowEvent[] {
  parseCalendarDate(rangeStart)
  parseCalendarDate(rangeEnd)
  if (effectiveWindowStart !== null) parseCalendarDate(effectiveWindowStart)
  if (obligation.status !== 'active') return []
  const own = occurrences.filter(row =>
    row.organizationId === obligation.organizationId && row.obligationId === obligation.id)
  const events = rangeStart <= rangeEnd
    ? buildRecurringObligationEvents(obligation, own, rangeStart, rangeEnd) : []
  const seen = new Set(events.map(event => event.sourceRecordId))
  for (const occurrence of own) {
    if (!occurrence.overrideDate) continue
    parseCalendarDate(occurrence.scheduledDate)
    parseCalendarDate(occurrence.overrideDate)
    if (occurrence.overrideDate > rangeEnd
      || (effectiveWindowStart !== null && occurrence.overrideDate < effectiveWindowStart)
      || (occurrence.scheduledDate >= rangeStart && occurrence.scheduledDate <= rangeEnd)
      || seen.has(occurrence.id)) continue
    // The existing recurrence builder is the authority for whether the
    // materialized scheduled date is a real occurrence of this rule.
    const exact = buildRecurringObligationEvents(
      obligation, [occurrence], occurrence.scheduledDate, occurrence.scheduledDate)
    if (exact.length !== 1 || exact[0].sourceRecordId !== occurrence.id) continue
    events.push(exact[0])
    seen.add(occurrence.id)
  }
  events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1
    : a.sourceRecordId < b.sourceRecordId ? -1 : a.sourceRecordId > b.sourceRecordId ? 1 : 0)
  const returned = new Set<string>()
  return events.filter(event => {
    if (returned.has(event.sourceRecordId)) return false
    returned.add(event.sourceRecordId)
    return true
  })
}

export function buildCommitmentEvent(commitment: CashCommitment): PlannedCashOutflowEvent {
  return {
    id: commitment.id,
    organizationId: commitment.organizationId,
    sourceType: 'cash_commitment',
    sourceRecordId: commitment.id,
    date: commitment.expectedDate,
    direction: 'outflow',
    amount: commitment.amount,
    amountCertainty: commitment.amountCertainty,
    requirement: commitment.requirement,
    confidence: commitment.confidence,
    category: commitment.category ?? null,
    status: commitment.status,
    reconciliationState: commitment.reconciliationState,
    actualTransactionId: commitment.actualTransactionId ?? null,
    attribution: {
      projectId: commitment.projectId ?? null,
      employeeId: commitment.employeeId ?? null,
      debtAccountId: commitment.debtAccountId ?? null,
      category: commitment.category ?? null,
    },
    provenance: {
      freshness: 'current',
      note: 'One-time planned cash commitment.',
    },
  }
}

export function summarizePlannedOutflows(
  events: readonly PlannedCashOutflowEvent[],
): PlannedOutflowSummary {
  let requiredMinor = 0
  let optionalMinor = 0
  const byConfidence: Record<FinancialConfidence, number> = {
    confirmed: 0,
    expected: 0,
    possible: 0,
  }
  const byCategory: Record<string, number> = {}
  const byDate: Record<string, number> = {}

  for (const event of events) {
    if (!contributesToPlannedOutflow(event)) continue
    const amount = event.amount.minor
    if (event.requirement === 'required') requiredMinor += amount
    else optionalMinor += amount
    byConfidence[event.confidence] += amount
    const category = event.category || 'uncategorized'
    byCategory[category] = (byCategory[category] || 0) + amount
    byDate[event.date] = (byDate[event.date] || 0) + amount
  }

  return {
    events: [...events],
    requiredMinor,
    optionalMinor,
    byConfidence,
    byCategory,
    byDate,
  }
}

export function makeMoneyFromDbMinor(value: number | string): ReturnType<typeof usd> {
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error('Database money must be integer cents')
  return usd(n)
}
