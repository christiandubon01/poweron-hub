import type {
  FinancialAttribution,
  FinancialConfidence,
  FinancialFreshness,
  FinancialProvenance,
  MoneyAmount,
} from './domain'

export type AmountCertainty = 'fixed' | 'estimated'
export type PlannedRequirement = 'required' | 'optional'
export type ObligationStatus = 'active' | 'paused' | 'canceled' | 'archived'
export type OccurrenceStatus = 'scheduled' | 'satisfied' | 'skipped' | 'canceled'
export type CommitmentStatus = 'scheduled' | 'satisfied' | 'skipped' | 'canceled'
export type PlannedReconciliationState = 'unreconciled' | 'reconciled'

export type RecurrenceKind = 'weekly' | 'every_n_weeks' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  kind: RecurrenceKind
  interval: number
  anchorDate: string
  startDate: string
  endDate?: string | null
}

export interface RecurringObligation {
  id: string
  organizationId: string
  name: string
  description?: string | null
  category?: string | null
  amount: MoneyAmount
  amountCertainty: AmountCertainty
  estimatedMinimum?: MoneyAmount | null
  estimatedMaximum?: MoneyAmount | null
  recurrence: RecurrenceRule
  requirement: PlannedRequirement
  confidence: FinancialConfidence
  status: ObligationStatus
  accountId?: string | null
  debtAccountId?: string | null
  projectId?: string | null
  /** Owner fact: missing this would interfere with the ability to keep working. Never inferred. */
  operationallyCritical?: boolean
  criticalReason?: string | null
  sourceType: 'manual' | 'owner_reviewed_overhead'
  provenance: FinancialProvenance
}

export interface ObligationOccurrence {
  id: string
  organizationId: string
  obligationId: string
  scheduledDate: string
  overrideDate?: string | null
  overrideAmount?: MoneyAmount | null
  status: OccurrenceStatus
  reason?: string | null
  reconciliationState: PlannedReconciliationState
  actualTransactionId?: string | null
}

export interface CashCommitment {
  id: string
  organizationId: string
  title: string
  description?: string | null
  expectedDate: string
  amount: MoneyAmount
  amountCertainty: AmountCertainty
  estimatedMinimum?: MoneyAmount | null
  estimatedMaximum?: MoneyAmount | null
  requirement: PlannedRequirement
  confidence: FinancialConfidence
  category?: string | null
  status: CommitmentStatus
  accountId?: string | null
  projectId?: string | null
  employeeId?: string | null
  debtAccountId?: string | null
  /** Owner fact: missing this would interfere with the ability to keep working. Never inferred. */
  operationallyCritical?: boolean
  criticalReason?: string | null
  sourceType: 'manual'
  reconciliationState: PlannedReconciliationState
  actualTransactionId?: string | null
  provenance: FinancialProvenance
}

export type ResolvedPlannedStatus =
  | 'upcoming'
  | 'due'
  | 'overdue'
  | 'satisfied'
  | 'skipped'
  | 'canceled'

export interface PlannedCashOutflowEvent {
  id: string
  organizationId: string
  sourceType: 'obligation_occurrence' | 'cash_commitment'
  sourceRecordId: string
  date: string
  direction: 'outflow'
  amount: MoneyAmount
  amountCertainty: AmountCertainty
  requirement: PlannedRequirement
  confidence: FinancialConfidence
  category?: string | null
  status: OccurrenceStatus | CommitmentStatus
  reconciliationState: PlannedReconciliationState
  actualTransactionId?: string | null
  attribution: FinancialAttribution
  provenance: {
    freshness: FinancialFreshness
    note?: string
  }
}

export interface PlannedOutflowSummary {
  events: PlannedCashOutflowEvent[]
  requiredMinor: number
  optionalMinor: number
  byConfidence: Record<FinancialConfidence, number>
  byCategory: Record<string, number>
  byDate: Record<string, number>
}
