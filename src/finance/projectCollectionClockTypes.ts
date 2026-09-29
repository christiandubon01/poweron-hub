import type { CashAllocationSnapshot, FinancialLiabilityInput } from './allocationTypes'
import type { FinancialConfidence } from './domain'
import type { CashCommitment, ObligationOccurrence, RecurringObligation } from './obligationsTypes'

export interface ProjectCollectionEvidence {
  organizationId: string
  projectId: string
  lifetimeCollectedMinor: number
  unknownDateCollectedMinor: number
  manualAdjustmentMinor: number
  syntheticBackfillMinor: number
  unresolvedLogMinor: number
  /** Compatibility summaries are exposed for comparison and never added to lifetime cash. */
  headerPaidMinor: number | null
  headerLastCollectedAmountMinor: number | null
  datedCollections: { sourceKey: string; date: string; amountMinor: number }[]
  diagnostics: string[]
}

export interface ClockPhase {
  phaseName: string
  paymentTriggerPct?: number | null
  confirmedStartDate?: string | null
  actualStartDate?: string | null
  actualEndDate?: string | null
}

export interface ClockProject {
  organizationId: string
  projectId: string
  projectName: string
  status: string
  outcome?: string | null
  archived?: boolean
  deletedAt?: string | null
  contractMinor: number
  depositPct?: number | null
  plannedStart?: string | null
  startDate?: string | null
  phaseTimeline: readonly ClockPhase[]
}

export interface ProjectCollectionSignal {
  projectId: string
  amountMinor: number | null
  expectedDate: string | null
  confidence: FinancialConfidence | null
  phase: string | null
  sourceKey: string | null
  amountEvidence: string
  dateEvidence: string
  timingState: 'overdue' | 'due_today' | 'future' | 'unknown'
}

export interface PayrollAttributionSession {
  id: string
  employeeProfileId: string
  workDate: string
  paidMinutes: number | null
  projectId: string | null
}

export interface PayrollProjectSlice {
  canonicalSourceKey: string
  sliceKey: string
  projectId: string | null
  amountMinor: number
}

export interface PayrollProjectAllocation {
  canonicalSourceKey: string
  canonicalAmountMinor: number
  /** True only after a complete session set reconciles exactly to the daily minutes. */
  reconciled: boolean
  slices: PayrollProjectSlice[]
  unattributedAmountMinor: number
  diagnostics: string[]
}

export interface ProjectRequiredCost {
  projectId: string
  amountMinor: number
  dueDate: string
  category: string
  canonicalSourceKey: string
  sliceKey?: string
  confidence: FinancialConfidence
  sourceType: 'cash_commitment' | 'obligation_occurrence' | 'derived_payroll'
}

export interface ProjectFundingSnapshot {
  projectId: string
  nextCollection: ProjectCollectionSignal | null
  requiredCosts: ProjectRequiredCost[]
  requiredBeforeCollectionMinor: number | null
  reservedForRequiredCostsMinor: number | null
  fundingGapMinor: number | null
  /** Project-specific unattributed amount; shared unattributed payroll is returned on the result. */
  unattributedRequiredMinor: number
  coverageStatus: 'fully_covered' | 'explicitly_allocated' | 'indeterminate' | 'no_required_cost'
  diagnostics: string[]
}

export interface CollectionClockEntry extends ProjectFundingSnapshot {
  projectName: string
  group: 'active_funding' | 'collection_follow_up'
  riskState: 'known_gap' | 'coverage_unknown' | 'covered' | 'no_required_cost'
  sortReasons: string[]
}

export interface ProjectCollectionClockInput {
  organizationId: string
  asOfDate: string
  projects: readonly ClockProject[]
  collectionEvidence: readonly ProjectCollectionEvidence[]
  commitments: readonly CashCommitment[]
  obligations: readonly RecurringObligation[]
  occurrences: readonly ObligationOccurrence[]
  payrollLiabilities: readonly FinancialLiabilityInput[]
  payrollAllocations?: readonly PayrollProjectAllocation[]
  allocationSnapshot: CashAllocationSnapshot
  explicitReservations?: Readonly<Record<string, number>>
}

export interface ProjectCollectionClockResult {
  activeFunding: CollectionClockEntry[]
  collectionFollowUp: CollectionClockEntry[]
  unattributedPayrollMinor: number
  diagnostics: string[]
}
