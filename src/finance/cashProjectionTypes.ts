import type { CashAllocationPolicy, CashAllocationSnapshot, FinancialLiabilityInput, AllocationBucket } from './allocationTypes'
import type { FinancialAttribution, FinancialConfidence } from './domain'
import type { FinancialAccountRow, FinancialTransactionRow } from './ledgerTypes'
import type { CashCommitment, ObligationOccurrence, RecurringObligation, PlannedRequirement } from './obligationsTypes'
import type { ClockProject, ProjectCollectionClockResult, ProjectCollectionEvidence } from './projectCollectionClockTypes'

export type CashProjectionHorizon = 7 | 14 | 30 | 60 | 90
export type CashProjectionConfidenceMode = 'conservative' | 'likely' | 'upside'

export interface CashProjectionPolicy {
  organizationId: string
  asOfDate: string
  horizonDays: CashProjectionHorizon
  confidenceMode: CashProjectionConfidenceMode
  cashAllocationPolicy: CashAllocationPolicy
}

export type ProjectionMovementBasis = 'future_posted_ledger' | 'planned_obligation' | 'cash_commitment' | 'project_collection' | 'scenario'

export interface ProjectionCashEvent {
  id: string
  organizationId: string
  date: string
  direction: 'inflow' | 'outflow'
  amountMinor: number
  confidence: FinancialConfidence
  requirement: PlannedRequirement
  sourceKey: string
  sourceType: string
  category: string | null
  attribution: FinancialAttribution
  label: string
  movementBasis: ProjectionMovementBasis
  /** Exact original key for an in-memory scenario replacement. */
  replacesSourceKey?: string
}

export interface ProjectionProtectedClaim {
  canonicalSourceKey: string
  amountMinor: number
  protectionDate: string
  confidence: FinancialConfidence
  requirement: PlannedRequirement
  bucket: AllocationBucket
  category: string | null
  attribution: FinancialAttribution
  paymentEventSourceKey: string | null
  sourceType: string
  label: string
}

export type ProjectionMarkerReason =
  | 'unknown_amount' | 'unknown_date' | 'unknown_payment_date'
  | 'overdue_unsettled' | 'confidence_excluded' | 'source_overlap'

export interface ProjectionMarker {
  sourceKey: string
  organizationId: string
  date: string | null
  amountMinor: number | null
  reason: ProjectionMarkerReason
  /** More specific source semantics when the shared reason is intentionally broad. */
  semanticCode?: 'payment_timing_unknown'
  label: string
  category: string | null
  attribution: FinancialAttribution
}

export interface ProjectionUncertainty {
  highestIncludedConfidence: FinancialConfidence | null
  includedExpectedEventCount: number
  includedPossibleEventCount: number
  unresolvedMarkerCount: number
  unresolvedSourceKeys: string[]
}

export interface DailyCashProjection {
  date: string
  openingCashMinor: number
  inflowMinor: number
  outflowMinor: number
  closingCashMinor: number
  totalProtectedRequirementMinor: number
  protectedCashMinor: number
  trulyFreeCashMinor: number
  protectionDeficitMinor: number
  operatingFloorMinor: number
  events: ProjectionCashEvent[]
  markers: ProjectionMarker[]
  uncertainty: ProjectionUncertainty
}

export interface CashProjectionSummary {
  lowestTotalCashMinor: number
  lowestTotalCashDate: string
  lowestTrulyFreeCashMinor: number
  lowestTrulyFreeCashDate: string
  firstProtectionDeficitDate: string | null
  fourteenDayLowestTotalCashMinor: number
  fourteenDayLowestTotalCashDate: string
  daysCovered: { days: number; bounded: boolean }
}

export interface ScenarioProjectionEvent {
  scenarioId: string
  action: 'add' | 'replace'
  replacesSourceKey?: string
  date: string
  direction: 'inflow' | 'outflow'
  amountMinor: number
  confidence: FinancialConfidence
  requirement: PlannedRequirement
  label: string
  category?: string | null
  attribution?: FinancialAttribution
}

export interface CashProjectionInput {
  policy: CashProjectionPolicy
  allocationSnapshot: CashAllocationSnapshot
  accounts: readonly FinancialAccountRow[]
  transactions: readonly FinancialTransactionRow[]
  obligations: readonly RecurringObligation[]
  occurrences: readonly ObligationOccurrence[]
  commitments: readonly CashCommitment[]
  derivedLiabilities: readonly FinancialLiabilityInput[]
  projects: readonly ClockProject[]
  collectionEvidence: readonly ProjectCollectionEvidence[]
  collectionClock: ProjectCollectionClockResult
  scenarioEvents?: readonly ScenarioProjectionEvent[]
}

export interface CashProjectionResult {
  organizationId: string
  asOfDate: string
  horizonDays: CashProjectionHorizon
  confidenceMode: CashProjectionConfidenceMode
  anchor: DailyCashProjection
  days: DailyCashProjection[]
  summary: CashProjectionSummary
  datedEvents: ProjectionCashEvent[]
  datedMarkers: ProjectionMarker[]
  undatedMarkers: ProjectionMarker[]
  diagnostics: string[]
}
