import { financialReconciliationKey } from './domain'
import { totalCashMinor } from './ledgerCalculations'
import { buildCommitmentEvent, buildRecurringObligationEvents } from './obligationCalculations'
import { addCalendarDays, parseCalendarDate } from './recurrence'
import type { FinancialAccountRow, FinancialTransactionRow } from './ledgerTypes'
import type {
  CashCommitment,
  ObligationOccurrence,
  PlannedCashOutflowEvent,
  RecurringObligation,
} from './obligationsTypes'
import type {
  AllocationBucket,
  CashAllocationPolicy,
  CashAllocationSnapshot,
  FinancialLiabilityInput,
  ProtectedAllocationResult,
  ProtectedRequirement,
  ProtectedRequirementReason,
} from './allocationTypes'

// ── Policy validation ────────────────────────────────────────────────────────

function validatePolicy(policy: CashAllocationPolicy): void {
  parseCalendarDate(policy.asOfDate)
  if (!Number.isInteger(policy.protectionHorizonDays) || policy.protectionHorizonDays < 0) {
    throw new Error('protectionHorizonDays must be a non-negative integer')
  }
  if (!Number.isSafeInteger(policy.operatingFloorMinor) || policy.operatingFloorMinor < 0) {
    throw new Error('operatingFloorMinor must be a non-negative safe integer')
  }
  if (policy.taxReserve.kind === 'fixed_amount') {
    if (!Number.isSafeInteger(policy.taxReserve.amountMinor) || policy.taxReserve.amountMinor < 0) {
      throw new Error('taxReserve.amountMinor must be a non-negative safe integer')
    }
  }
}

// ── Bucket classification ────────────────────────────────────────────────────

function classifyBucket(attribution: PlannedCashOutflowEvent['attribution']): AllocationBucket {
  // employeeId wins — a payroll item attributed to a project is still payroll
  if (attribution.employeeId) return 'payroll'
  if (attribution.debtAccountId) return 'debt_service'
  if (attribution.category === 'vehicle') return 'vehicle'
  if (attribution.category === 'owner_pay') return 'owner_pay'
  if (attribution.category === 'overhead') return 'overhead'
  if (attribution.projectId) return 'project_reserve'
  return 'other'
}

// ── Dedup key ────────────────────────────────────────────────────────────────

function dedupeKeyForEvent(event: PlannedCashOutflowEvent): string {
  // Map PlannedCashOutflowEvent.sourceType to the canonical FinancialSourceKind
  const kind = event.sourceType === 'obligation_occurrence'
    ? 'financial_obligation_occurrence' as const
    : 'cash_commitment' as const
  return financialReconciliationKey({
    organizationId: event.organizationId,
    kind,
    recordId: event.sourceRecordId,
  })
}

// ── Reason ───────────────────────────────────────────────────────────────────

function reasonForDate(
  eventDate: string,
  asOfDate: string,
): Extract<ProtectedRequirementReason, 'overdue' | 'in_horizon'> {
  return eventDate < asOfDate ? 'overdue' : 'in_horizon'
}

// ── Main engine ──────────────────────────────────────────────────────────────

/**
 * Compute the canonical Protected Cash / Truly Free Cash snapshot.
 *
 * Pure function. Reads no global state. Makes no network calls.
 * All inputs must be pre-loaded by the caller.
 *
 * Organization scope is enforced internally: only rows whose organizationId
 * matches policy.organizationId contribute to the result.
 *
 * CASH-5/6 will supply additional PlannedCashOutflowEvent rows (future payroll
 * exposure, project funding-gap obligations) by wrapping or augmenting the
 * obligations/commitments inputs. They must not create a second monetary claim
 * for the same canonical source record.
 */
export function computeCashAllocation(
  accounts: readonly FinancialAccountRow[],
  transactions: readonly FinancialTransactionRow[],
  obligations: readonly RecurringObligation[],
  occurrences: readonly ObligationOccurrence[],
  commitments: readonly CashCommitment[],
  policy: CashAllocationPolicy,
  derivedLiabilities: readonly FinancialLiabilityInput[] = [],
): CashAllocationSnapshot {
  validatePolicy(policy)

  const orgId = policy.organizationId

  // ── Organization scope enforcement ────────────────────────────────────────
  const orgAccounts = accounts.filter((a) => a.organization_id === orgId)
  const orgTransactions = transactions.filter((t) => t.organization_id === orgId)
  const orgObligations = obligations.filter((o) => o.organizationId === orgId)
  const orgOccurrences = occurrences.filter((o) => o.organizationId === orgId)
  const orgCommitments = commitments.filter((c) => c.organizationId === orgId)

  // ── Step 1: Total Cash ─────────────────────────────────────────────────────
  const cashTotal = totalCashMinor(orgAccounts, orgTransactions, policy.asOfDate)

  // ── Step 2: Expand planned outflow events ──────────────────────────────────
  const horizonEnd = addCalendarDays(policy.asOfDate, policy.protectionHorizonDays)

  // Pair events with their label source so label is resolved at build time
  interface LabeledEvent {
    event: PlannedCashOutflowEvent
    label: string
  }
  const labeledEvents: LabeledEvent[] = []

  for (const obligation of orgObligations) {
    // Skip obligations that haven't started yet relative to the horizon window.
    // generateRecurrenceDates throws when rangeStart > rangeEnd, so guard here.
    if (obligation.recurrence.startDate > horizonEnd) continue

    // Generate from the obligation's own startDate through the horizon end.
    // No arbitrary historical cutoff: an old overdue obligation whose occurrences
    // remain scheduled/unreconciled must still appear as protected.
    const events = buildRecurringObligationEvents(
      obligation,
      orgOccurrences,
      obligation.recurrence.startDate,
      horizonEnd,
    )
    for (const event of events) {
      labeledEvents.push({ event, label: obligation.name })
    }
  }

  for (const commitment of orgCommitments) {
    labeledEvents.push({
      event: buildCommitmentEvent(commitment),
      label: commitment.title,
    })
  }

  // ── Step 3: Filter to protection-eligible events ───────────────────────────
  // An event is eligible when:
  //   (a) scheduled and unreconciled
  //   (b) meets the requirement gate
  //   (c) within the horizon (naturally includes overdue)
  //
  // CASH-4 V1 has no "confirmed required beyond horizon" escape hatch.
  // The owner extends the horizon explicitly via protectionHorizonDays.
  const eligible = labeledEvents.filter(({ event }) => {
    if (event.status !== 'scheduled') return false
    if (event.reconciliationState === 'reconciled') return false
    if (event.requirement !== 'required' && !policy.includeOptionalObligations) return false
    if (event.date > horizonEnd) return false
    return true
  })

  // ── Step 4: Dedup and build ProtectedRequirement[] ────────────────────────
  const seen = new Set<string>()
  const requirements: ProtectedRequirement[] = []
  const suppressedDuplicateSourceKeys: string[] = []

  for (const { event, label } of eligible) {
    const key = dedupeKeyForEvent(event)
    if (seen.has(key)) {
      suppressedDuplicateSourceKeys.push(key)
      continue
    }
    if (!Number.isSafeInteger(event.amount.minor) || event.amount.minor < 0) {
      throw new Error(
        `PlannedCashOutflowEvent ${event.sourceRecordId} has invalid amount ${event.amount.minor}; must be a non-negative safe integer`,
      )
    }
    seen.add(key)
    requirements.push({
      dedupeKey: key,
      label,
      bucket: classifyBucket(event.attribution),
      amountMinor: event.amount.minor,
      reason: reasonForDate(event.date, policy.asOfDate),
      confidence: event.confidence,
      sourceType: event.sourceType,
      sourceRecordId: event.sourceRecordId,
      attribution: event.attribution,
    })
  }

  // ── Step 4b: Derived liabilities (CASH-5+ payroll exposure, etc.) ──────────
  // Each liability retains its canonical source provenance — never masquerades
  // as a commitment or obligation occurrence.
  const orgLiabilities = derivedLiabilities.filter((l) => l.organizationId === orgId)
  for (const liability of orgLiabilities) {
    if (liability.provenance.source.organizationId !== liability.organizationId) {
      throw new Error(
        `FinancialLiabilityInput ${liability.provenance.source.recordId} has provenance organizationId that does not match liability organizationId`,
      )
    }
    parseCalendarDate(liability.dueDate)
    if (liability.provenance.reconciliationState === 'reconciled') continue
    if (liability.requirement !== 'required' && !policy.includeOptionalObligations) continue
    if (liability.dueDate > horizonEnd) continue
    if (!Number.isSafeInteger(liability.amountMinor) || liability.amountMinor < 0) {
      throw new Error(
        `FinancialLiabilityInput ${liability.provenance.source.recordId} has invalid amountMinor ${liability.amountMinor}; must be a non-negative safe integer`,
      )
    }
    const key = financialReconciliationKey(liability.provenance.source)
    if (seen.has(key)) {
      suppressedDuplicateSourceKeys.push(key)
      continue
    }
    seen.add(key)
    requirements.push({
      dedupeKey: key,
      label: liability.label,
      bucket: classifyBucket(liability.attribution),
      amountMinor: liability.amountMinor,
      reason: reasonForDate(liability.dueDate, policy.asOfDate),
      confidence: liability.provenance.confidence,
      sourceType: 'derived_liability',
      sourceRecordId: liability.provenance.source.recordId,
      attribution: liability.attribution,
    })
  }

  // ── Step 5: Policy-driven slots ────────────────────────────────────────────

  if (policy.operatingFloorMinor > 0) {
    requirements.push({
      dedupeKey: `policy:${orgId}:operating_floor`,
      label: 'Operating Floor',
      bucket: 'operating_floor',
      amountMinor: policy.operatingFloorMinor,
      reason: 'operating_floor',
      confidence: 'confirmed',
      sourceType: 'policy',
      sourceRecordId: null,
      attribution: {},
    })
  }

  if (
    policy.taxReserve.kind === 'fixed_amount' &&
    policy.taxReserve.amountMinor > 0
  ) {
    requirements.push({
      dedupeKey: `policy:${orgId}:tax_reserve`,
      label: 'Tax Reserve',
      bucket: 'tax',
      amountMinor: policy.taxReserve.amountMinor,
      reason: 'tax_reserve',
      confidence: 'confirmed',
      sourceType: 'policy',
      sourceRecordId: null,
      attribution: {},
    })
  }

  // ── Step 6: Compute snapshot ───────────────────────────────────────────────
  const totalProtected = requirements.reduce((sum, r) => sum + r.amountMinor, 0)

  const trulyFree = Math.max(0, cashTotal - totalProtected)
  const uncoveredDeficit = Math.max(0, totalProtected - cashTotal)
  const protectedCash = Math.max(0, Math.min(cashTotal, totalProtected))

  const allocationResult: ProtectedAllocationResult = {
    organizationId: orgId,
    asOfDate: policy.asOfDate,
    requirements,
    totalProtectedRequirementMinor: totalProtected,
    suppressedDuplicateSourceKeys,
  }

  return {
    organizationId: orgId,
    asOfDate: policy.asOfDate,
    totalCashMinor: cashTotal,
    totalProtectedRequirementMinor: totalProtected,
    protectedCashMinor: protectedCash,
    trulyFreeCashMinor: trulyFree,
    uncoveredProtectionDeficitMinor: uncoveredDeficit,
    allocationResult,
    policy,
  }
}
