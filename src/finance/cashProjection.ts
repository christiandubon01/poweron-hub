import { financialReconciliationKey, type FinancialConfidence, type FinancialAttribution } from './domain'
import { totalCashMinor } from './ledgerCalculations'
import { buildCommitmentEvent, buildRecurringObligationEventsIncludingOverrides } from './obligationCalculations'
import { addCalendarDays, parseCalendarDate } from './recurrence'
import { deriveProjectCollectionSignals } from './projectCollectionClock'
import type { AllocationBucket, ProtectedRequirement } from './allocationTypes'
import type { PlannedCashOutflowEvent } from './obligationsTypes'
import type {
  CashProjectionInput, CashProjectionResult, DailyCashProjection, ProjectionCashEvent,
  ProjectionMarker, ProjectionProtectedClaim, ProjectionUncertainty,
} from './cashProjectionTypes'

function cents(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative safe integer cents`)
  return value
}

function safeSum(a: number, b: number): number {
  const result = a + b
  if (!Number.isSafeInteger(result)) throw new Error('Projection exceeds safe integer cents')
  return result
}

function bucket(attribution: FinancialAttribution): AllocationBucket {
  if (attribution.employeeId) return 'payroll'
  if (attribution.debtAccountId) return 'debt_service'
  if (attribution.category === 'vehicle') return 'vehicle'
  if (attribution.category === 'owner_pay') return 'owner_pay'
  if (attribution.category === 'overhead') return 'overhead'
  if (attribution.projectId) return 'project_reserve'
  return 'other'
}

function confidenceRank(value: FinancialConfidence): number {
  return value === 'confirmed' ? 0 : value === 'expected' ? 1 : 2
}

function admitsInflow(mode: CashProjectionInput['policy']['confidenceMode'], value: FinancialConfidence): boolean {
  return confidenceRank(value) <= (mode === 'conservative' ? 0 : mode === 'likely' ? 1 : 2)
}

function plannedKey(event: PlannedCashOutflowEvent): string {
  return financialReconciliationKey({
    organizationId: event.organizationId,
    kind: event.sourceType === 'cash_commitment' ? 'cash_commitment' : 'financial_obligation_occurrence',
    recordId: event.sourceRecordId,
  })
}

function requirementMap(rows: readonly { dedupeKey: string; amountMinor: number }[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    cents(row.amountMinor, `Requirement ${row.dedupeKey}`)
    if (map.has(row.dedupeKey)) throw new Error(`Duplicate Day-0 requirement: ${row.dedupeKey}`)
    map.set(row.dedupeKey, row.amountMinor)
  }
  return map
}

function validateAnchor(input: CashProjectionInput, claims: readonly ProjectionProtectedClaim[]): void {
  const { policy, allocationSnapshot: snapshot } = input
  const allocationPolicy = policy.cashAllocationPolicy
  if (snapshot.organizationId !== policy.organizationId || snapshot.asOfDate !== policy.asOfDate
    || snapshot.allocationResult.organizationId !== policy.organizationId
    || snapshot.allocationResult.asOfDate !== policy.asOfDate) throw new Error('Day-0 CASH-4 snapshot scope/date mismatch')
  if (snapshot.policy.organizationId !== allocationPolicy.organizationId
    || snapshot.policy.asOfDate !== allocationPolicy.asOfDate
    || snapshot.policy.protectionHorizonDays !== allocationPolicy.protectionHorizonDays
    || snapshot.policy.operatingFloorMinor !== allocationPolicy.operatingFloorMinor
    || snapshot.policy.includeOptionalObligations !== allocationPolicy.includeOptionalObligations
    || snapshot.policy.taxReserve.kind !== allocationPolicy.taxReserve.kind
    || (snapshot.policy.taxReserve.kind === 'fixed_amount' && allocationPolicy.taxReserve.kind === 'fixed_amount'
      && snapshot.policy.taxReserve.amountMinor !== allocationPolicy.taxReserve.amountMinor)) {
    throw new Error('Day-0 CASH-4 policy mismatch')
  }
  const cash = totalCashMinor(
    input.accounts.filter(a => a.organization_id === policy.organizationId),
    input.transactions.filter(t => t.organization_id === policy.organizationId), policy.asOfDate,
  )
  if (!Number.isSafeInteger(cash)) throw new Error('Day-0 cash exceeds safe integer cents')
  if (cash !== snapshot.totalCashMinor) throw new Error('Day-0 CASH-2/CASH-4 anchor mismatch')
  const horizonEnd = addCalendarDays(policy.asOfDate, allocationPolicy.protectionHorizonDays)
  const expected: { dedupeKey: string; amountMinor: number }[] = claims
    .filter(c => c.protectionDate <= horizonEnd).map(c => ({ dedupeKey: c.canonicalSourceKey, amountMinor: c.amountMinor }))
  if (allocationPolicy.operatingFloorMinor > 0) expected.push({
    dedupeKey: `policy:${policy.organizationId}:operating_floor`, amountMinor: allocationPolicy.operatingFloorMinor,
  })
  if (allocationPolicy.taxReserve.kind === 'fixed_amount' && allocationPolicy.taxReserve.amountMinor > 0) expected.push({
    dedupeKey: `policy:${policy.organizationId}:tax_reserve`, amountMinor: allocationPolicy.taxReserve.amountMinor,
  })
  const expectedMap = requirementMap(expected)
  const actualMap = requirementMap(snapshot.allocationResult.requirements)
  if (expectedMap.size !== actualMap.size || [...expectedMap].some(([key, amount]) => actualMap.get(key) !== amount)) {
    throw new Error('Day-0 CASH-4 protection parity mismatch')
  }
  const total = [...expectedMap.values()].reduce(safeSum, 0)
  if (total !== snapshot.totalProtectedRequirementMinor || total !== snapshot.allocationResult.totalProtectedRequirementMinor
    || snapshot.protectedCashMinor !== Math.max(0, Math.min(cash, total))
    || snapshot.trulyFreeCashMinor !== Math.max(0, safeSum(cash, -total))
    || snapshot.uncoveredProtectionDeficitMinor !== Math.max(0, safeSum(total, -cash))) {
    throw new Error('Day-0 CASH-4 protection totals mismatch')
  }
}

function uncertainty(events: readonly ProjectionCashEvent[], markers: readonly ProjectionMarker[]): ProjectionUncertainty {
  let highestIncludedConfidence: FinancialConfidence | null = null
  let includedExpectedEventCount = 0
  let includedPossibleEventCount = 0
  for (const event of events) {
    if (event.confidence === 'expected') includedExpectedEventCount++
    if (event.confidence === 'possible') includedPossibleEventCount++
    if (highestIncludedConfidence === null || confidenceRank(event.confidence) > confidenceRank(highestIncludedConfidence)) {
      highestIncludedConfidence = event.confidence
    }
  }
  return {
    highestIncludedConfidence, includedExpectedEventCount, includedPossibleEventCount,
    unresolvedMarkerCount: markers.length,
    unresolvedSourceKeys: [...new Set(markers.map(m => m.sourceKey))].sort(),
  }
}

export function computeCashProjection(input: CashProjectionInput): CashProjectionResult {
  const { policy, allocationSnapshot: snapshot } = input
  parseCalendarDate(policy.asOfDate)
  if (![7, 14, 30, 60, 90].includes(policy.horizonDays)) throw new Error('Invalid cash projection horizon')
  if (!['conservative', 'likely', 'upside'].includes(policy.confidenceMode)) throw new Error('Invalid confidence mode')
  const allocation = policy.cashAllocationPolicy
  if (allocation.organizationId !== policy.organizationId || allocation.asOfDate !== policy.asOfDate) {
    throw new Error('Cash projection/allocation policy scope/date mismatch')
  }
  if (!Number.isInteger(allocation.protectionHorizonDays) || allocation.protectionHorizonDays < 0) throw new Error('Invalid protection horizon')
  cents(allocation.operatingFloorMinor, 'Operating floor')
  if (allocation.taxReserve.kind === 'fixed_amount') cents(allocation.taxReserve.amountMinor, 'Tax reserve')
  const summaryHorizon = Math.max(policy.horizonDays, 14)
  const summaryEnd = addCalendarDays(policy.asOfDate, summaryHorizon)
  const internalEnd = addCalendarDays(summaryEnd, allocation.protectionHorizonDays)
  const displayEnd = addCalendarDays(policy.asOfDate, policy.horizonDays)
  const org = policy.organizationId
  const events = new Map<string, ProjectionCashEvent>()
  const claims = new Map<string, ProjectionProtectedClaim>()
  const markers: ProjectionMarker[] = []
  const diagnostics: string[] = []
  const addEvent = (event: ProjectionCashEvent) => {
    parseCalendarDate(event.date)
    cents(event.amountMinor, `Event ${event.sourceKey}`)
    const prior = events.get(event.sourceKey)
    if (prior) {
      if (prior.date !== event.date || prior.amountMinor !== event.amountMinor || prior.direction !== event.direction) {
        throw new Error(`Conflicting projection movement: ${event.sourceKey}`)
      }
      return
    }
    events.set(event.sourceKey, event)
  }
  const addClaim = (claim: ProjectionProtectedClaim) => {
    parseCalendarDate(claim.protectionDate)
    cents(claim.amountMinor, `Claim ${claim.canonicalSourceKey}`)
    const prior = claims.get(claim.canonicalSourceKey)
    if (prior) {
      if (prior.amountMinor !== claim.amountMinor || prior.protectionDate !== claim.protectionDate) {
        throw new Error(`Conflicting projection claim: ${claim.canonicalSourceKey}`)
      }
      return
    }
    claims.set(claim.canonicalSourceKey, claim)
  }

  const cashAccounts = new Set(input.accounts.filter(a => a.organization_id === org && a.status === 'active'
    && a.account_class === 'asset' && a.include_in_cash).map(a => a.id))
  const postedCashLedgerById = new Map<string, { sourceKey: string; date: string;
    amountMinor: number; direction: 'inflow' | 'outflow' }>()
  for (const tx of input.transactions) {
    if (tx.organization_id !== org || tx.status !== 'posted' || !cashAccounts.has(tx.account_id)) continue
    parseCalendarDate(tx.transaction_date)
    if (!Number.isSafeInteger(tx.amount_minor)) throw new Error(`Invalid ledger cents: ${tx.id}`)
    if (tx.amount_minor === 0) continue
    const key = `${org}:financial_transaction:${tx.id}`
    postedCashLedgerById.set(tx.id, { sourceKey: key, date: tx.transaction_date, amountMinor: Math.abs(tx.amount_minor),
      direction: tx.amount_minor > 0 ? 'inflow' : 'outflow' })
    if (tx.transaction_date <= policy.asOfDate) continue
    if (tx.transaction_date > internalEnd) continue
    addEvent({ id: key, organizationId: org, date: tx.transaction_date,
      direction: tx.amount_minor > 0 ? 'inflow' : 'outflow', amountMinor: Math.abs(tx.amount_minor),
      confidence: 'confirmed', requirement: 'required', sourceKey: key, sourceType: 'financial_transaction',
      category: tx.category, attribution: { projectId: tx.project_id, employeeId: tx.employee_id,
        debtAccountId: tx.debt_account_id, category: tx.category },
      label: tx.description, movementBasis: 'future_posted_ledger' })
  }

  const planned: { event: PlannedCashOutflowEvent; label: string }[] = []
  for (const obligation of input.obligations) {
    if (obligation.organizationId !== org) continue
    planned.push(...buildRecurringObligationEventsIncludingOverrides(
      obligation, input.occurrences, obligation.recurrence.startDate, internalEnd,
    ).map(event => ({ event, label: obligation.name })))
  }
  for (const commitment of input.commitments) {
    if (commitment.organizationId === org) planned.push({ event: buildCommitmentEvent(commitment), label: commitment.title })
  }
  for (const { event, label } of planned) {
    if (event.status !== 'scheduled' || event.reconciliationState === 'reconciled') continue
    if (event.requirement === 'optional' && !allocation.includeOptionalObligations) continue
    parseCalendarDate(event.date)
    if (event.date > internalEnd) continue
    const key = plannedKey(event)
    addClaim({ canonicalSourceKey: key, amountMinor: event.amount.minor, protectionDate: event.date,
      confidence: event.confidence, requirement: event.requirement, bucket: bucket(event.attribution),
      category: event.category ?? null, attribution: event.attribution, paymentEventSourceKey: key,
      sourceType: event.sourceType, label })
    const linked = event.actualTransactionId ? postedCashLedgerById.get(event.actualTransactionId) : undefined
    if (event.actualTransactionId) {
      markers.push({ sourceKey: key, organizationId: org, date: event.date, amountMinor: event.amount.minor,
        reason: 'source_overlap', label, category: event.category ?? null, attribution: event.attribution })
      diagnostics.push(`${linked ? 'exact_ledger_link' : 'unresolved_actual_link'}:${key}:${event.actualTransactionId}`)
    }
    if (linked) {
      if (linked.direction === 'outflow' && linked.amountMinor === event.amount.minor) {
        claims.get(key)!.paymentEventSourceKey = linked.date > policy.asOfDate ? linked.sourceKey : null
        if (linked.date <= policy.asOfDate) diagnostics.push(`linked_payment_in_opening:${key}:${event.actualTransactionId}`)
      } else {
        claims.get(key)!.paymentEventSourceKey = null
        diagnostics.push(`linked_payment_mismatch:${key}:${event.actualTransactionId}`)
      }
    }
    if (event.date <= policy.asOfDate) {
      markers.push({ sourceKey: key, organizationId: org, date: event.date, amountMinor: event.amount.minor,
        reason: 'overdue_unsettled', label, category: event.category ?? null, attribution: event.attribution })
      continue
    }
    if (linked) continue
    addEvent({ id: key, organizationId: org, date: event.date, direction: 'outflow',
      amountMinor: event.amount.minor, confidence: event.confidence, requirement: event.requirement,
      sourceKey: key, sourceType: event.sourceType, category: event.category ?? null,
      attribution: event.attribution, label,
      movementBasis: event.sourceType === 'cash_commitment' ? 'cash_commitment' : 'planned_obligation' })
  }

  for (const liability of input.derivedLiabilities) {
    if (liability.organizationId !== org) continue
    if (liability.provenance.source.organizationId !== org) throw new Error('Liability provenance organization mismatch')
    if (liability.provenance.reconciliationState === 'reconciled') continue
    if (liability.requirement === 'optional' && !allocation.includeOptionalObligations) continue
    parseCalendarDate(liability.dueDate)
    if (liability.dueDate > internalEnd) continue
    const key = financialReconciliationKey(liability.provenance.source)
    addClaim({ canonicalSourceKey: key, amountMinor: liability.amountMinor, protectionDate: liability.dueDate,
      confidence: liability.provenance.confidence, requirement: liability.requirement, bucket: bucket(liability.attribution),
      category: liability.attribution.category ?? null, attribution: liability.attribution,
      paymentEventSourceKey: null, sourceType: 'derived_liability', label: liability.label })
    markers.push({ sourceKey: key, organizationId: org, date: null, amountMinor: liability.amountMinor,
      reason: 'unknown_payment_date', semanticCode: 'payment_timing_unknown',
      label: liability.label, category: liability.attribution.category ?? null,
      attribution: liability.attribution })
  }

  // Validate the canonical state before applying in-memory what-if changes.
  validateAnchor(input, [...claims.values()])

  const projectsById = new Map(input.projects.filter(p => p.organizationId === org).map(p => [p.projectId, p]))
  const evidenceById = new Map(input.collectionEvidence.filter(e => e.organizationId === org).map(e => [e.projectId, e]))
  const clockEntries = [...input.collectionClock.activeFunding, ...input.collectionClock.collectionFollowUp]
  const seenProjects = new Set<string>()
  for (const entry of clockEntries) {
    if (seenProjects.has(entry.projectId)) throw new Error(`Duplicate clock project: ${entry.projectId}`)
    seenProjects.add(entry.projectId)
    const project = projectsById.get(entry.projectId)
    if (!project) throw new Error(`Clock project missing from projection input: ${entry.projectId}`)
    const evidence = evidenceById.get(entry.projectId) ?? {
      organizationId: org, projectId: entry.projectId, lifetimeCollectedMinor: 0,
      unknownDateCollectedMinor: 0, manualAdjustmentMinor: 0, syntheticBackfillMinor: 0,
      unresolvedLogMinor: 0, headerPaidMinor: null, headerLastCollectedAmountMinor: null,
      datedCollections: [], diagnostics: ['missing_collection_evidence'],
    }
    cents(evidence.lifetimeCollectedMinor, `Project evidence ${entry.projectId}`)
    const schedule = deriveProjectCollectionSignals(project, evidence, policy.asOfDate)
    diagnostics.push(...schedule.diagnostics.map(d => `${entry.projectId}:${d}`))
    for (const signal of schedule.signals) {
      const key = signal.sourceKey
      if (!key) continue
      if (signal.expectedDate) parseCalendarDate(signal.expectedDate)
      if (signal.amountMinor !== null) cents(signal.amountMinor, `Collection ${key}`)
      const common = { sourceKey: key, organizationId: org, date: signal.expectedDate,
        amountMinor: signal.amountMinor, label: `${project.projectName}: ${signal.phase ?? 'Collection'}`,
        category: 'project_collection', attribution: { projectId: project.projectId, category: 'project_collection' } }
      if (signal.amountMinor === null) markers.push({ ...common, reason: 'unknown_amount' })
      else if (signal.expectedDate === null) markers.push({ ...common, reason: 'unknown_date' })
      else if (signal.expectedDate <= policy.asOfDate) markers.push({ ...common, reason: 'overdue_unsettled' })
      else if (!signal.confidence || !admitsInflow(policy.confidenceMode, signal.confidence)) {
        markers.push({ ...common, reason: 'confidence_excluded' })
      } else if (signal.expectedDate <= internalEnd) {
        addEvent({ id: key, organizationId: org, date: signal.expectedDate, direction: 'inflow',
          amountMinor: signal.amountMinor, confidence: signal.confidence, requirement: 'optional',
          sourceKey: key, sourceType: 'project_schedule', category: 'project_collection',
          attribution: common.attribution, label: common.label, movementBasis: 'project_collection' })
      }
    }
  }

  const scenarioIds = new Set<string>()
  const replaced = new Set<string>()
  for (const scenario of input.scenarioEvents ?? []) {
    if (!scenario.scenarioId || scenarioIds.has(scenario.scenarioId)) throw new Error(`Duplicate scenario identity: ${scenario.scenarioId}`)
    scenarioIds.add(scenario.scenarioId)
    parseCalendarDate(scenario.date)
    if (scenario.date <= policy.asOfDate) throw new Error('Scenario date must be after asOfDate')
    cents(scenario.amountMinor, `Scenario ${scenario.scenarioId}`)
    const key = `scenario:${scenario.scenarioId}`
    let original: ProjectionCashEvent | undefined
    if (scenario.action === 'replace') {
      if (!scenario.replacesSourceKey || replaced.has(scenario.replacesSourceKey)) throw new Error('Invalid scenario replacement identity')
      original = events.get(scenario.replacesSourceKey)
      if (!original) throw new Error(`Scenario replacement source missing: ${scenario.replacesSourceKey}`)
      if (original.direction !== scenario.direction) throw new Error('Scenario replacement direction mismatch')
      if (original.requirement !== scenario.requirement) throw new Error('Scenario replacement requirement mismatch')
      const originalSourceKey = original.sourceKey
      const plannedClaim = claims.get(originalSourceKey)
      const linkedClaim = plannedClaim ? undefined
        : [...claims.values()].find(c => c.paymentEventSourceKey === originalSourceKey)
      if (linkedClaim && scenario.amountMinor !== linkedClaim.amountMinor) {
        throw new Error('Unsupported partial settlement for linked ledger scenario replacement')
      }
      replaced.add(scenario.replacesSourceKey)
      events.delete(scenario.replacesSourceKey)
      if (plannedClaim) {
        plannedClaim.paymentEventSourceKey = key
        plannedClaim.amountMinor = scenario.amountMinor
        plannedClaim.protectionDate = scenario.date
      } else if (linkedClaim) {
        linkedClaim.paymentEventSourceKey = key
      }
    } else if (scenario.action !== 'add') throw new Error('Invalid scenario action')
    const event: ProjectionCashEvent = { id: key, organizationId: org, date: scenario.date,
      direction: scenario.direction, amountMinor: scenario.amountMinor, confidence: scenario.confidence,
      requirement: scenario.requirement, sourceKey: key, sourceType: 'scenario',
      category: scenario.category ?? null, attribution: scenario.attribution ?? {},
      label: scenario.label, movementBasis: 'scenario', replacesSourceKey: original?.sourceKey }
    addEvent(event)
    if (!original && event.direction === 'outflow' && (event.requirement === 'required' || allocation.includeOptionalObligations)) {
      addClaim({ canonicalSourceKey: key, amountMinor: event.amountMinor, protectionDate: event.date,
        confidence: event.confidence, requirement: event.requirement, bucket: bucket(event.attribution),
        category: event.category, attribution: event.attribution, paymentEventSourceKey: key,
        sourceType: 'scenario', label: event.label })
    }
  }

  const admitted = [...events.values()].filter(event => event.direction === 'outflow'
    ? (event.requirement === 'required' || allocation.includeOptionalObligations)
    : event.movementBasis === 'future_posted_ledger' || admitsInflow(policy.confidenceMode, event.confidence))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sourceKey.localeCompare(b.sourceKey))
  const byDate = new Map<string, ProjectionCashEvent[]>()
  for (const event of admitted) {
    const day = byDate.get(event.date) ?? []
    day.push(event)
    byDate.set(event.date, day)
  }
  const retired = new Set<string>()
  const dayMarkers = (date: string): ProjectionMarker[] => markers.filter(m => m.date === date)
  const unresolvedThrough = (date: string): ProjectionMarker[] => markers.filter(m => m.date === null || m.date <= date)
  const anchor: DailyCashProjection = {
    date: policy.asOfDate, openingCashMinor: snapshot.totalCashMinor, inflowMinor: 0, outflowMinor: 0,
    closingCashMinor: snapshot.totalCashMinor, totalProtectedRequirementMinor: snapshot.totalProtectedRequirementMinor,
    protectedCashMinor: snapshot.protectedCashMinor, trulyFreeCashMinor: snapshot.trulyFreeCashMinor,
    protectionDeficitMinor: snapshot.uncoveredProtectionDeficitMinor, operatingFloorMinor: allocation.operatingFloorMinor,
    events: [], markers: markers.filter(m => m.date !== null && m.date <= policy.asOfDate),
    uncertainty: uncertainty([], unresolvedThrough(policy.asOfDate)),
  }
  const allDays: DailyCashProjection[] = []
  let priorCash = anchor.closingCashMinor
  let includedSoFar: ProjectionCashEvent[] = []
  for (let offset = 1; offset <= summaryHorizon; offset++) {
    const date = addCalendarDays(policy.asOfDate, offset)
    const todayEvents = byDate.get(date) ?? []
    let inflowMinor = 0
    let outflowMinor = 0
    for (const event of todayEvents) {
      if (event.direction === 'inflow') inflowMinor = safeSum(inflowMinor, event.amountMinor)
      else outflowMinor = safeSum(outflowMinor, event.amountMinor)
    }
    const closingCashMinor = safeSum(safeSum(priorCash, inflowMinor), -outflowMinor)
    for (const claim of claims.values()) {
      if (claim.paymentEventSourceKey && todayEvents.some(e => e.sourceKey === claim.paymentEventSourceKey)) {
        retired.add(claim.canonicalSourceKey)
      }
    }
    const protectionEnd = addCalendarDays(date, allocation.protectionHorizonDays)
    let protectedRequirement = 0
    for (const claim of claims.values()) {
      if (!retired.has(claim.canonicalSourceKey) && claim.protectionDate <= protectionEnd) {
        protectedRequirement = safeSum(protectedRequirement, claim.amountMinor)
      }
    }
    protectedRequirement = safeSum(protectedRequirement, allocation.operatingFloorMinor)
    if (allocation.taxReserve.kind === 'fixed_amount') {
      protectedRequirement = safeSum(protectedRequirement, allocation.taxReserve.amountMinor)
    }
    includedSoFar = [...includedSoFar, ...todayEvents]
    allDays.push({ date, openingCashMinor: priorCash, inflowMinor, outflowMinor, closingCashMinor,
      totalProtectedRequirementMinor: protectedRequirement,
      protectedCashMinor: Math.max(0, Math.min(closingCashMinor, protectedRequirement)),
      trulyFreeCashMinor: Math.max(0, safeSum(closingCashMinor, -protectedRequirement)),
      protectionDeficitMinor: Math.max(0, safeSum(protectedRequirement, -closingCashMinor)),
      operatingFloorMinor: allocation.operatingFloorMinor, events: todayEvents,
      markers: dayMarkers(date), uncertainty: uncertainty(includedSoFar, unresolvedThrough(date)) })
    priorCash = closingCashMinor
  }
  const days = allDays.slice(0, policy.horizonDays)
  const displayed = [anchor, ...days]
  const fourteen = [anchor, ...allDays.slice(0, 14)]
  const minimum = (rows: readonly DailyCashProjection[], field: 'closingCashMinor' | 'trulyFreeCashMinor') =>
    rows.reduce((best, row) => row[field] < best[field] ? row : best)
  const lowTotal = minimum(displayed, 'closingCashMinor')
  const lowFree = minimum(displayed, 'trulyFreeCashMinor')
  const low14 = minimum(fourteen, 'closingCashMinor')
  const firstDeficit = displayed.find(day => day.protectionDeficitMinor > 0)
  let covered = 0
  if (anchor.closingCashMinor >= 0 && anchor.protectionDeficitMinor === 0) {
    for (const day of days) {
      if (day.closingCashMinor < 0 || day.protectionDeficitMinor > 0) break
      covered++
    }
  }
  return { organizationId: org, asOfDate: policy.asOfDate, horizonDays: policy.horizonDays,
    confidenceMode: policy.confidenceMode, anchor, days,
    summary: {
      lowestTotalCashMinor: lowTotal.closingCashMinor, lowestTotalCashDate: lowTotal.date,
      lowestTrulyFreeCashMinor: lowFree.trulyFreeCashMinor, lowestTrulyFreeCashDate: lowFree.date,
      firstProtectionDeficitDate: firstDeficit?.date ?? null,
      fourteenDayLowestTotalCashMinor: low14.closingCashMinor, fourteenDayLowestTotalCashDate: low14.date,
      daysCovered: { days: covered, bounded: covered === policy.horizonDays },
    },
    datedEvents: admitted.filter(e => e.date > policy.asOfDate && e.date <= displayEnd),
    datedMarkers: markers.filter(m => m.date !== null),
    undatedMarkers: markers.filter(m => m.date === null), diagnostics,
  }
}
