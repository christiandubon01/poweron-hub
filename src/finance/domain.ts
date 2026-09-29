/**
 * CASH-1 financial truth contracts.
 *
 * This module is intentionally storage-agnostic. It defines the normalized
 * financial vocabulary used by the Cash OS without making legacy/project data
 * or UI-local Debt Killer state canonical.
 */

export type CurrencyCode = 'USD'

export interface MoneyAmount {
  currency: CurrencyCode
  /** Integer cents. Never a floating-point dollar amount. */
  minor: number
}

export function usd(minor: number): MoneyAmount {
  if (!Number.isSafeInteger(minor)) {
    throw new Error('MoneyAmount.minor must be a safe integer number of cents')
  }
  return { currency: 'USD', minor }
}

export function dollarsToMinor(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

export type FinancialConfidence = 'confirmed' | 'expected' | 'possible'
export type FinancialFreshness = 'current' | 'stale' | 'unknown'
export type FinancialReconciliationState = 'unreconciled' | 'reconciled' | 'ambiguous'

export type FinancialSourceKind =
  | 'project_collection'
  | 'project_actual_cost'
  | 'project_planned_cost'
  | 'service_collection'
  | 'employee_time_entry'
  | 'employee_work_session'
  | 'overhead_assumption'
  | 'normalized_payment'
  | 'manual_ledger'
  | 'future_provider'
  | 'financial_obligation'
  | 'financial_obligation_occurrence'
  | 'cash_commitment'

export interface FinancialSourceRef {
  organizationId: string
  kind: FinancialSourceKind
  recordId: string
  effectiveDate?: string | null
  timestamp?: string | null
}

export function financialReconciliationKey(ref: FinancialSourceRef): string {
  return `${ref.organizationId}:${ref.kind}:${ref.recordId}`
}

export interface FinancialProvenance {
  source: FinancialSourceRef
  freshness: FinancialFreshness
  confidence: FinancialConfidence
  reconciliationState: FinancialReconciliationState
  note?: string
}

export type FinancialMeaning =
  | 'actual_cash_inflow'
  | 'actual_cash_outflow'
  | 'account_movement'
  | 'liability_movement'
  | 'actual_cost'
  | 'planned_cost'
  | 'planned_cash_outflow'
  | 'quantity_only'
  | 'assumption_only'

export interface FinancialAttribution {
  projectId?: string | null
  employeeId?: string | null
  debtAccountId?: string | null
  category?: string | null
}

export interface ActualCashEvent {
  id: string
  organizationId: string
  accountId?: string | null
  date: string
  direction: 'inflow' | 'outflow'
  amount: MoneyAmount
  meaning: Extract<FinancialMeaning, 'actual_cash_inflow' | 'actual_cash_outflow'>
  provenance: FinancialProvenance
  attribution?: FinancialAttribution
}

export interface ActualCostEvent {
  id: string
  organizationId: string
  date?: string | null
  amount: MoneyAmount
  meaning: 'actual_cost'
  provenance: FinancialProvenance
  attribution?: FinancialAttribution
}

export interface PlannedCostEvent {
  id: string
  organizationId: string
  date?: string | null
  amount: MoneyAmount
  meaning: 'planned_cost'
  provenance: FinancialProvenance
  attribution?: FinancialAttribution
}

export interface FinancialLiability {
  id: string
  organizationId: string
  amount: MoneyAmount
  dueDate?: string | null
  required: boolean
  confidence: FinancialConfidence
  provenance: FinancialProvenance
  attribution?: FinancialAttribution
}

export interface FinanceAdapterScope {
  organizationId: string
  asOfDate?: string | null
}
