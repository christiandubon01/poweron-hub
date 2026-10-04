import type { FinancialSourceRef } from './domain'

export type FinancialAccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'credit_card'
  | 'loan'
  | 'other_asset'
  | 'other_liability'

export type FinancialAccountClass = 'asset' | 'liability'
export type FinancialOwnershipContext = 'business' | 'personal'
export type FinancialAccountStatus = 'active' | 'archived'

export interface FinancialAccountRow {
  id: string
  organization_id: string
  display_name: string
  account_type: FinancialAccountType
  account_class: FinancialAccountClass
  ownership_context: FinancialOwnershipContext
  include_in_cash: boolean
  currency: 'USD'
  status: FinancialAccountStatus
  source_type: 'manual' | 'imported' | 'future_provider'
  source_metadata: Record<string, unknown>
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type FinancialTransactionStatus = 'draft' | 'posted' | 'voided'
export type FinancialTransactionKind =
  | 'opening_balance'
  | 'income'
  | 'expense'
  | 'transfer'
  | 'card_debt_payment'
  | 'refund_reversal'
  | 'adjustment'
  | 'balance_reconciliation'

export type EconomicEffect = 'none' | 'inflow' | 'outflow'

export interface FinancialTransactionRow {
  id: string
  organization_id: string
  account_id: string
  amount_minor: number
  currency: 'USD'
  transaction_date: string
  effective_at: string | null
  posted_at: string | null
  status: FinancialTransactionStatus
  transaction_kind: FinancialTransactionKind
  economic_effect: EconomicEffect
  economic_amount_minor: number
  description: string
  counterparty: string | null
  category: string | null
  project_id: string | null
  employee_id: string | null
  debt_account_id: string | null
  source_type: 'manual' | 'opening_balance' | 'operational_reference' | 'future_provider'
  source_organization_id: string | null
  source_kind: FinancialSourceRef['kind'] | string | null
  source_record_id: string | null
  source_effective_date: string | null
  source_timestamp: string | null
  source_metadata: Record<string, unknown>
  idempotency_key: string
  created_at: string
  updated_at: string
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
}

export type FinancialLinkRelationship =
  | 'transfer_pair'
  | 'card_debt_payment_pair'
  | 'reversal_of'
  | 'correction_of'
  | 'operational_reconciliation'

export interface FinancialTransactionLinkRow {
  id: string
  organization_id: string
  source_transaction_id: string
  target_transaction_id: string
  relationship_type: FinancialLinkRelationship
  status: 'pending' | 'confirmed' | 'rejected'
  confidence: 'confirmed' | 'expected' | 'possible'
  created_at: string
  metadata: Record<string, unknown>
}
