import { financialReconciliationKey } from './domain'
import { buildCommitmentEvent, buildRecurringObligationEvents } from './obligationCalculations'
import { parseCalendarDate } from './recurrence'
import type { FinancialLiabilityInput } from './allocationTypes'
import type {
  ClockProject, CollectionClockEntry, PayrollAttributionSession, PayrollProjectAllocation,
  PayrollProjectSlice, ProjectCollectionClockInput, ProjectCollectionClockResult,
  ProjectCollectionEvidence, ProjectCollectionSignal, ProjectRequiredCost,
} from './projectCollectionClockTypes'

function nonnegativeMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative safe integer cents`)
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function validDate(value: string | null | undefined, diagnostics: string[], label: string): string | null {
  if (!value) return null
  try { parseCalendarDate(value); return value }
  catch { diagnostics.push(`invalid_date:${label}:${value}`); return null }
}

/** Exact integer-cent apportionment with stable, largest-remainder tie breaking. */
function apportionMinor(total: number, parts: readonly { key: string; weight: number }[]): number[] {
  nonnegativeMinor(total, 'Allocation total')
  for (const part of parts) nonnegativeMinor(part.weight, `Allocation weight ${part.key}`)
  const weightSum = parts.reduce((sum, part) => sum + BigInt(part.weight), 0n)
  if (weightSum === 0n) return parts.map(() => 0)
  const amounts = parts.map(part => Number(BigInt(total) * BigInt(part.weight) / weightSum))
  let remainder = total - amounts.reduce((sum, amount) => sum + amount, 0)
  const order = parts.map((part, index) => ({
    index,
    key: part.key,
    fraction: BigInt(total) * BigInt(part.weight) % weightSum,
  })).sort((a, b) => a.fraction === b.fraction ? compareText(a.key, b.key) : a.fraction > b.fraction ? -1 : 1)
  for (const item of order) {
    if (remainder-- <= 0) break
    amounts[item.index] += 1
  }
  return amounts
}

/** Sessions are attribution only: this never creates or changes a payroll liability. */
export function allocatePayrollLiabilityToProjects(
  liability: FinancialLiabilityInput,
  employeeProfileId: string,
  workDate: string,
  canonicalDailyPaidMinutes: number,
  sessions: readonly PayrollAttributionSession[],
  completeSet: boolean,
): PayrollProjectAllocation {
  const key = financialReconciliationKey(liability.provenance.source)
  nonnegativeMinor(liability.amountMinor, 'Payroll liability')
  const fail = (reason: string): PayrollProjectAllocation => ({
    canonicalSourceKey: key, canonicalAmountMinor: liability.amountMinor, reconciled: false,
    slices: [{ canonicalSourceKey: key, sliceKey: JSON.stringify([key, null]), projectId: null, amountMinor: liability.amountMinor }],
    unattributedAmountMinor: liability.amountMinor, diagnostics: [reason],
  })
  if (liability.provenance.source.kind !== 'employee_time_entry') return fail('not_finalized_time_entry')
  if (!completeSet) return fail('incomplete_session_set')
  try { parseCalendarDate(workDate) } catch { return fail('invalid_work_date') }
  if (liability.dueDate !== workDate || liability.provenance.source.effectiveDate !== workDate) return fail('payroll_day_mismatch')
  if (!Number.isSafeInteger(canonicalDailyPaidMinutes) || canonicalDailyPaidMinutes < 0) return fail('invalid_daily_paid_minutes')
  const ids = new Set<string>()
  let sessionMinutes = 0
  for (const session of sessions) {
    if (!session.id || ids.has(session.id)) return fail('duplicate_or_missing_session_id')
    ids.add(session.id)
    if (session.employeeProfileId !== employeeProfileId || session.workDate !== workDate) return fail('session_identity_mismatch')
    if (!Number.isSafeInteger(session.paidMinutes) || session.paidMinutes === null || session.paidMinutes < 0) return fail('invalid_session_paid_minutes')
    sessionMinutes += session.paidMinutes
  }
  if (!Number.isSafeInteger(sessionMinutes) || sessionMinutes !== canonicalDailyPaidMinutes) return fail('session_minutes_do_not_reconcile')
  if (sessionMinutes === 0) return liability.amountMinor === 0
    ? { canonicalSourceKey: key, canonicalAmountMinor: 0, reconciled: true, slices: [], unattributedAmountMinor: 0, diagnostics: [] }
    : fail('positive_liability_without_paid_minutes')

  const ordered = [...sessions].sort((a, b) => compareText(a.id, b.id))
  const amounts = apportionMinor(liability.amountMinor, ordered.map(s => ({ key: s.id, weight: s.paidMinutes! })))
  const byProject = new Map<string | null, number>()
  ordered.forEach((session, index) => {
    const projectId = session.projectId || null
    byProject.set(projectId, (byProject.get(projectId) || 0) + amounts[index])
  })
  const slices: PayrollProjectSlice[] = [...byProject.entries()]
    .sort(([a], [b]) => compareText(a ?? '', b ?? ''))
    .map(([projectId, amountMinor]) => ({
      canonicalSourceKey: key,
      sliceKey: JSON.stringify([key, projectId]),
      projectId, amountMinor,
    }))
  if (slices.reduce((sum, slice) => sum + slice.amountMinor, 0) !== liability.amountMinor) throw new Error('Payroll slice sum invariant failed')
  return {
    canonicalSourceKey: key, canonicalAmountMinor: liability.amountMinor, reconciled: true, slices,
    unattributedAmountMinor: byProject.get(null) || 0, diagnostics: [],
  }
}

interface ScheduledSignal {
  sourceKey: string
  phase: string
  date: string | null
  amountMinor: number
  dateEvidence: string
}

function nextCollection(
  project: ClockProject, evidence: ProjectCollectionEvidence, asOfDate: string, diagnostics: string[],
): ProjectCollectionSignal | null {
  nonnegativeMinor(project.contractMinor, `Project ${project.projectId} contract`)
  if (project.contractMinor === 0) return null
  const remaining = Math.max(0, project.contractMinor - evidence.lifetimeCollectedMinor)
  if (remaining === 0) return null
  const phases = project.phaseTimeline
  const percentages = [project.depositPct, ...phases.map(p => p.paymentTriggerPct)]
  if (percentages.some(pct => pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100))) {
    diagnostics.push('invalid_schedule_percentage')
    return null
  }
  const totalPct = percentages.reduce<number>((sum, pct) => sum + (pct ?? 0), 0)
  if (totalPct > 100) {
    diagnostics.push('oversubscribed_schedule')
    return null
  }
  const events: ScheduledSignal[] = []
  const phaseStart = (index: number): [string | null, string] => {
    const phase = phases[index]
    if (!phase) return [null, 'missing_phase']
    const confirmed = validDate(phase.confirmedStartDate, diagnostics, `phase_start:${index}`)
    if (confirmed) return [confirmed, 'stored_confirmed_phase_start']
    const actual = validDate(phase.actualStartDate, diagnostics, `actual_phase_start:${index}`)
    return [actual, actual ? 'stored_actual_phase_start' : 'missing_phase_start']
  }
  const amountForPct = (pct: number) => Math.round(project.contractMinor * pct / 100)
  if (project.depositPct != null && project.depositPct > 0) {
    let [date, dateEvidence] = phaseStart(0)
    if (!date) {
      date = validDate(project.plannedStart, diagnostics, 'planned_start')
        || validDate(project.startDate, diagnostics, 'project_start')
      dateEvidence = date ? 'stored_project_start_context' : 'unknown'
    }
    events.push({ sourceKey: `${project.organizationId}:project_schedule:${project.projectId}:deposit`, phase: 'Deposit', date,
      amountMinor: amountForPct(project.depositPct), dateEvidence })
  }
  phases.forEach((phase, index) => {
    const pct = phase.paymentTriggerPct
    if (pct == null || pct <= 0) return
    let [date, dateEvidence] = phaseStart(index + 1)
    if (!date) {
      date = validDate(phase.actualEndDate, diagnostics, `phase_end:${index}`)
      dateEvidence = date ? 'stored_actual_phase_end' : 'unknown'
    }
    events.push({ sourceKey: `${project.organizationId}:project_schedule:${project.projectId}:phase:${index}`,
      phase: phase.phaseName || `Phase ${index + 1}`, date, amountMinor: amountForPct(pct), dateEvidence })
  })
  const scheduledMinor = events.reduce((sum, event) => sum + event.amountMinor, 0)
  if (!Number.isSafeInteger(scheduledMinor) || scheduledMinor > project.contractMinor) {
    diagnostics.push('oversubscribed_schedule_cents')
    return null
  }
  // A final residual needs at least one stored payment term and an explicit last-phase end.
  if (events.length > 0 && phases.length > 0 && scheduledMinor < project.contractMinor) {
    const date = validDate(phases[phases.length - 1].actualEndDate, diagnostics, 'final_phase_end')
    if (date) events.push({ sourceKey: `${project.organizationId}:project_schedule:${project.projectId}:final`,
      phase: 'Final Payment', date, amountMinor: project.contractMinor - scheduledMinor, dateEvidence: 'stored_actual_phase_end' })
  }
  const candidates = events.filter(event => event.amountMinor > 0)
  if (candidates.length === 0) return null
  let previousDatedEvent: string | null = null
  for (const event of candidates) {
    if (!event.date) continue
    if (previousDatedEvent && event.date < previousDatedEvent) {
      diagnostics.push('inconsistent_schedule_dates')
      return null
    }
    previousDatedEvent = event.date
  }
  const hasPriorCollections = evidence.lifetimeCollectedMinor > 0
  const candidate = hasPriorCollections
    ? candidates.find(event => event.date !== null && event.date >= asOfDate)
    : candidates[0]
  if (!candidate) {
    diagnostics.push('unlinked_historical_collections')
    return null
  }
  if (hasPriorCollections && candidates.slice(0, candidates.indexOf(candidate)).some(event => event.date === null)) {
    diagnostics.push('unknown_prior_schedule_date')
    return null
  }
  if (hasPriorCollections) diagnostics.push('unlinked_historical_collections')
  const timingState = candidate.date === null ? 'unknown'
    : candidate.date < asOfDate ? 'overdue'
    : candidate.date === asOfDate ? 'due_today' : 'future'
  return {
    projectId: project.projectId,
    amountMinor: hasPriorCollections ? null : candidate.amountMinor,
    expectedDate: candidate.date,
    confidence: 'possible',
    phase: candidate.phase,
    sourceKey: candidate.sourceKey,
    amountEvidence: hasPriorCollections ? 'unlinked_historical_collections' : 'stored_unverified_percentage_of_contract',
    dateEvidence: candidate.dateEvidence,
    timingState,
  }
}

function riskClass(entry: CollectionClockEntry): number {
  if (entry.fundingGapMinor !== null && entry.fundingGapMinor > 0) return 0
  if (entry.coverageStatus === 'indeterminate') return 1
  if (entry.requiredBeforeCollectionMinor !== null && entry.requiredBeforeCollectionMinor > 0) return 2
  return 3
}

function timingClass(signal: ProjectCollectionSignal | null): number {
  switch (signal?.timingState) {
    case 'overdue': return 0
    case 'due_today': return 1
    case 'unknown': return 2
    case 'future': return 3
    default: return 2
  }
}

function confidenceClass(signal: ProjectCollectionSignal | null): number {
  switch (signal?.confidence) {
    case 'possible': return 0
    case 'expected': return 1
    case 'confirmed': return 2
    default: return -1
  }
}

function sortEntries(a: CollectionClockEntry, b: CollectionClockEntry): number {
  const risk = riskClass(a) - riskClass(b)
  if (risk) return risk
  const magnitude = riskClass(a) === 0 ? (b.fundingGapMinor! - a.fundingGapMinor!)
    : riskClass(a) === 1 ? ((b.requiredBeforeCollectionMinor ?? 0) - (a.requiredBeforeCollectionMinor ?? 0)) : 0
  if (magnitude) return magnitude
  const timing = timingClass(a.nextCollection) - timingClass(b.nextCollection)
  if (timing) return timing
  const date = compareText(a.nextCollection?.expectedDate ?? '9999-99-99', b.nextCollection?.expectedDate ?? '9999-99-99')
  if (date) return date
  return confidenceClass(a.nextCollection) - confidenceClass(b.nextCollection) || compareText(a.projectId, b.projectId)
}

export function computeProjectCollectionClock(input: ProjectCollectionClockInput): ProjectCollectionClockResult {
  parseCalendarDate(input.asOfDate)
  const snapshot = input.allocationSnapshot
  if (snapshot.organizationId !== input.organizationId || snapshot.asOfDate !== input.asOfDate
    || snapshot.allocationResult.organizationId !== input.organizationId) throw new Error('CASH-4 snapshot scope/date mismatch')
  const evidenceByProject = new Map<string, ProjectCollectionEvidence>()
  for (const item of input.collectionEvidence) {
    if (item.organizationId !== input.organizationId) continue
    if (evidenceByProject.has(item.projectId)) throw new Error(`Duplicate collection evidence: ${item.projectId}`)
    if (!Number.isSafeInteger(item.lifetimeCollectedMinor) || !Number.isSafeInteger(item.unknownDateCollectedMinor)) {
      throw new Error(`Invalid collection evidence cents: ${item.projectId}`)
    }
    evidenceByProject.set(item.projectId, item)
  }
  const allocationByKey = new Map((input.payrollAllocations || []).map(a => [a.canonicalSourceKey, a]))
  if (allocationByKey.size !== (input.payrollAllocations || []).length) throw new Error('Duplicate payroll allocation key')
  const sourceCaps = new Map<string, number>()
  const slicesBySource = new Map<string, PayrollProjectSlice[]>()
  const payrollCosts: ProjectRequiredCost[] = []
  const diagnostics: string[] = []
  let unattributedPayrollMinor = 0
  const seenPayroll = new Set<string>()
  for (const liability of input.payrollLiabilities) {
    if (liability.organizationId !== input.organizationId) continue
    if (liability.provenance.source.organizationId !== input.organizationId) throw new Error('Payroll provenance organization mismatch')
    parseCalendarDate(liability.dueDate)
    nonnegativeMinor(liability.amountMinor, 'Payroll liability')
    if (liability.requirement !== 'required' || liability.provenance.reconciliationState !== 'unreconciled') continue
    const key = financialReconciliationKey(liability.provenance.source)
    if (seenPayroll.has(key)) { diagnostics.push(`duplicate_payroll_source:${key}`); continue }
    seenPayroll.add(key)
    sourceCaps.set(key, liability.amountMinor)
    let slices: PayrollProjectSlice[]
    if (liability.provenance.source.kind === 'employee_time_entry') {
      const allocation = allocationByKey.get(key)
      if (!allocation) {
        slices = [{ canonicalSourceKey: key, sliceKey: JSON.stringify([key, null]), projectId: null, amountMinor: liability.amountMinor }]
        diagnostics.push(`unattributed_payroll:${key}`)
      } else {
        if (allocation.canonicalAmountMinor !== liability.amountMinor) throw new Error(`Payroll allocation amount mismatch: ${key}`)
        if (!allocation.reconciled && allocation.slices.some(slice => slice.projectId !== null)) throw new Error(`Unproven payroll project slice: ${key}`)
        slices = allocation.slices
        diagnostics.push(...allocation.diagnostics.map(d => `${key}:${d}`))
      }
    } else if (liability.provenance.source.kind === 'employee_work_session') {
      slices = [{ canonicalSourceKey: key, sliceKey: JSON.stringify([key, liability.attribution.projectId ?? null]),
        projectId: liability.attribution.projectId ?? null, amountMinor: liability.amountMinor }]
    } else {
      slices = [{ canonicalSourceKey: key, sliceKey: JSON.stringify([key, null]), projectId: null, amountMinor: liability.amountMinor }]
    }
    const sliceKeys = new Set<string>()
    let sliceTotal = 0
    for (const slice of slices) {
      if (slice.canonicalSourceKey !== key || sliceKeys.has(slice.sliceKey)) throw new Error(`Invalid payroll slice identity: ${key}`)
      sliceKeys.add(slice.sliceKey)
      nonnegativeMinor(slice.amountMinor, 'Payroll slice')
      sliceTotal += slice.amountMinor
      if (!Number.isSafeInteger(sliceTotal)) throw new Error('Payroll slice total exceeds safe integer cents')
      if (slice.projectId) payrollCosts.push({ projectId: slice.projectId, amountMinor: slice.amountMinor,
        dueDate: liability.dueDate, category: 'payroll', canonicalSourceKey: key, sliceKey: slice.sliceKey,
        confidence: liability.provenance.confidence, sourceType: 'derived_payroll' })
      else unattributedPayrollMinor += slice.amountMinor
    }
    if (sliceTotal !== liability.amountMinor) throw new Error(`Payroll slice sum mismatch: ${key}`)
    slicesBySource.set(key, slices)
  }
  if (!Number.isSafeInteger(unattributedPayrollMinor)) throw new Error('Unattributed payroll exceeds safe integer cents')

  const seenCost = new Map<string, string>()
  const seenProjects = new Set<string>()
  const entries: CollectionClockEntry[] = []
  for (const project of input.projects) {
    if (project.organizationId !== input.organizationId) continue
    if (seenProjects.has(project.projectId)) throw new Error(`Duplicate project identity: ${project.projectId}`)
    seenProjects.add(project.projectId)
    const status = project.status.toLowerCase().trim()
    const outcome = project.outcome?.toLowerCase().trim()
    if (project.archived || project.deletedAt || ['canceled', 'cancelled', 'archived', 'deleted', 'lost', 'rejected'].includes(status)
      || ['canceled', 'cancelled', 'lost'].includes(outcome || '')) continue
    const evidence = evidenceByProject.get(project.projectId) || {
      organizationId: input.organizationId, projectId: project.projectId,
      lifetimeCollectedMinor: 0, unknownDateCollectedMinor: 0, manualAdjustmentMinor: 0,
      syntheticBackfillMinor: 0, unresolvedLogMinor: 0, headerPaidMinor: null, headerLastCollectedAmountMinor: null,
      datedCollections: [], diagnostics: ['missing_collection_evidence'],
    }
    const projectDiagnostics = [...evidence.diagnostics]
    const group = status === 'completed' || outcome === 'completed' ? 'collection_follow_up' as const : 'active_funding' as const
    if (group === 'collection_follow_up' && evidence.lifetimeCollectedMinor >= project.contractMinor) continue
    const signal = nextCollection(project, evidence, input.asOfDate, projectDiagnostics)
    const boundary = signal?.expectedDate ?? null
    const costs: ProjectRequiredCost[] = []
    if (boundary) {
      for (const commitment of input.commitments) {
        if (commitment.organizationId !== input.organizationId || commitment.projectId !== project.projectId) continue
        if (commitment.status !== 'scheduled' || commitment.reconciliationState === 'reconciled' || commitment.requirement !== 'required') continue
        const date = validDate(commitment.expectedDate, projectDiagnostics, `commitment:${commitment.id}`)
        if (!date || date > boundary) continue
        nonnegativeMinor(commitment.amount.minor, 'Commitment')
        const event = buildCommitmentEvent(commitment)
        const key = `${input.organizationId}:cash_commitment:${event.sourceRecordId}`
        if (seenCost.has(key)) {
          if (seenCost.get(key) !== project.projectId) throw new Error(`Required source belongs to multiple projects: ${key}`)
          projectDiagnostics.push(`duplicate_required_source:${key}`); continue
        }
        seenCost.set(key, project.projectId)
        sourceCaps.set(key, event.amount.minor)
        costs.push({ projectId: project.projectId, amountMinor: event.amount.minor, dueDate: date,
          category: event.category || 'other', canonicalSourceKey: key, confidence: event.confidence, sourceType: 'cash_commitment' })
      }
      for (const obligation of input.obligations) {
        if (obligation.organizationId !== input.organizationId || obligation.projectId !== project.projectId
          || obligation.status !== 'active' || obligation.requirement !== 'required') continue
        if (obligation.recurrence.startDate > boundary) continue
        for (const event of buildRecurringObligationEvents(obligation,
          input.occurrences.filter(occurrence => occurrence.organizationId === input.organizationId),
          obligation.recurrence.startDate, boundary)) {
          if (event.status !== 'scheduled' || event.reconciliationState === 'reconciled') continue
          const date = validDate(event.date, projectDiagnostics, `occurrence:${event.sourceRecordId}`)
          if (!date || date > boundary) continue
          nonnegativeMinor(event.amount.minor, 'Obligation occurrence')
          const key = `${input.organizationId}:financial_obligation_occurrence:${event.sourceRecordId}`
          if (seenCost.has(key)) {
            if (seenCost.get(key) !== project.projectId) throw new Error(`Required source belongs to multiple projects: ${key}`)
            projectDiagnostics.push(`duplicate_required_source:${key}`); continue
          }
          seenCost.set(key, project.projectId)
          sourceCaps.set(key, event.amount.minor)
          costs.push({ projectId: project.projectId, amountMinor: event.amount.minor, dueDate: date,
            category: event.category || 'other', canonicalSourceKey: key, confidence: event.confidence, sourceType: 'obligation_occurrence' })
        }
      }
      for (const cost of payrollCosts) {
        if (cost.projectId !== project.projectId || cost.dueDate > boundary) continue
        const identity = cost.sliceKey || cost.canonicalSourceKey
        if (seenCost.has(identity)) { projectDiagnostics.push(`duplicate_required_source:${identity}`); continue }
        seenCost.set(identity, project.projectId)
        costs.push(cost)
      }
    }
    const required = boundary ? costs.reduce((sum, cost) => sum + cost.amountMinor, 0) : null
    if (required !== null && !Number.isSafeInteger(required)) throw new Error('Required project cost exceeds safe integer cents')
    entries.push({ projectId: project.projectId, projectName: project.projectName, group, nextCollection: signal,
      requiredCosts: costs, requiredBeforeCollectionMinor: required, reservedForRequiredCostsMinor: null,
      fundingGapMinor: null, unattributedRequiredMinor: 0, coverageStatus: 'indeterminate', diagnostics: projectDiagnostics,
      riskState: 'coverage_unknown', sortReasons: [] })
  }

  const explicit = input.explicitReservations || {}
  let explicitTotal = 0
  for (const [key, reserved] of Object.entries(explicit)) {
    nonnegativeMinor(reserved, `Reservation ${key}`)
    const cap = sourceCaps.get(key)
    if (cap === undefined || reserved > cap) throw new Error(`Reservation exceeds or lacks canonical liability: ${key}`)
    explicitTotal += reserved
  }
  if (!Number.isSafeInteger(explicitTotal) || explicitTotal > Math.max(0, snapshot.totalCashMinor)) throw new Error('Explicit reservations exceed available cash')
  const fullyFunded = snapshot.protectedCashMinor === snapshot.totalProtectedRequirementMinor
  const protectedByKey = new Map(snapshot.allocationResult.requirements.map(req => [req.dedupeKey, req.amountMinor]))
  if (fullyFunded) {
    const extraReservations = Object.entries(explicit).reduce((sum, [key, amount]) =>
      sum + (protectedByKey.get(key) === sourceCaps.get(key) ? 0 : amount), 0)
    if (extraReservations > Math.max(0, snapshot.totalCashMinor - snapshot.totalProtectedRequirementMinor)) {
      throw new Error('Explicit reservations exceed cash beyond globally protected requirements')
    }
  }
  const reservedSlices = new Map<string, number>()
  for (const [key, slices] of slicesBySource) {
    if (!Object.prototype.hasOwnProperty.call(explicit, key)) continue
    const shares = apportionMinor(explicit[key], slices.map(slice => ({ key: slice.sliceKey, weight: slice.amountMinor })))
    slices.forEach((slice, index) => reservedSlices.set(slice.sliceKey, shares[index]))
  }
  for (const entry of entries) {
    if (entry.requiredBeforeCollectionMinor === null) {
      entry.diagnostics.push('unknown_collection_boundary')
      continue
    }
    if (entry.requiredCosts.length === 0) {
      entry.reservedForRequiredCostsMinor = 0
      entry.fundingGapMinor = 0
      entry.coverageStatus = 'no_required_cost'
    } else {
      let reserved = 0
      let unknown = false
      let allGlobal = true
      for (const cost of entry.requiredCosts) {
        const key = cost.canonicalSourceKey
        const cap = sourceCaps.get(key)!
        if (fullyFunded && protectedByKey.get(key) === cap) {
          reserved += cost.amountMinor
        } else if (Object.prototype.hasOwnProperty.call(explicit, key)) {
          reserved += cost.sliceKey ? reservedSlices.get(cost.sliceKey)! : explicit[key]
          allGlobal = false
        } else {
          unknown = true
          entry.diagnostics.push(`coverage_indeterminate:${key}`)
        }
      }
      if (!unknown) {
        entry.reservedForRequiredCostsMinor = reserved
        entry.fundingGapMinor = Math.max(0, entry.requiredBeforeCollectionMinor - reserved)
        entry.coverageStatus = allGlobal ? 'fully_covered' : 'explicitly_allocated'
      }
    }
    entry.riskState = entry.fundingGapMinor !== null && entry.fundingGapMinor > 0 ? 'known_gap'
      : entry.coverageStatus === 'indeterminate' ? 'coverage_unknown'
      : entry.requiredBeforeCollectionMinor! > 0 ? 'covered' : 'no_required_cost'
  }
  for (const entry of entries) {
    entry.sortReasons = [
      `risk:${entry.riskState}`,
      entry.fundingGapMinor !== null ? `gap_minor:${entry.fundingGapMinor}` : `required_minor:${entry.requiredBeforeCollectionMinor ?? 'unknown'}`,
      `timing:${entry.nextCollection?.timingState ?? 'unknown'}`,
      `date:${entry.nextCollection?.expectedDate ?? 'unknown'}`,
      `confidence:${entry.nextCollection?.confidence ?? 'unknown'}`,
      `project:${entry.projectId}`,
    ]
  }
  return {
    activeFunding: entries.filter(entry => entry.group === 'active_funding').sort(sortEntries),
    collectionFollowUp: entries.filter(entry => entry.group === 'collection_follow_up').sort(sortEntries),
    unattributedPayrollMinor, diagnostics,
  }
}
