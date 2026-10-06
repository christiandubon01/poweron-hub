/**
 * BANK-1 provider evidence + interpretation types.
 *
 * Boundary: these describe RAW PROVIDER EVIDENCE and OWNER INTERPRETATION rows. They are not read by any Cash OS calculation
 * (projection, allocation, decisions), and creating them has no financial effect. Canonical truth stays in `ledgerTypes`.
 * The core is provider-neutral; the first provider (Plaid) is just a value of `provider`.
 */

export type ProviderItemStatus = 'connecting' | 'healthy' | 'login_required' | 'error' | 'disconnected'
/** `not_connected` is the absence of an item, so it is not a persisted state. */
export const PROVIDER_ITEM_STATUSES: readonly ProviderItemStatus[] = ['connecting', 'healthy', 'login_required', 'error', 'disconnected']

export type ProviderSyncStatus = 'idle' | 'syncing' | 'failed'
export type ProviderAccountStatus = 'active' | 'inactive'
export type ProviderMappingStatus = 'active' | 'inactive'
export type WebhookProcessingStatus = 'received' | 'processing' | 'processed' | 'failed' | 'ignored'

export type InterpretationKind = 'ledger_match' | 'category' | 'transfer' | 'obligation' | 'project' | 'debt' | 'payroll' | 'ignored'
export const INTERPRETATION_KINDS: readonly InterpretationKind[] = ['ledger_match', 'category', 'transfer', 'obligation', 'project', 'debt', 'payroll', 'ignored']
export type InterpretationStatus = 'suggested' | 'confirmed' | 'rejected' | 'undone'
export type InterpretationSource = 'owner' | 'system_suggestion' | 'rule'
export type InterpretationConfidence = 'high' | 'possible' | 'low'
/** `adopted`: the ledger row was created FROM the provider transaction. `linked`: an existing (manual) ledger row is the match. */
export type LedgerMatchMode = 'adopted' | 'linked'

/** SERVER-ONLY. Deliberately has no token/secret field. */
export interface FinancialProviderItemRow {
  id: string
  organization_id: string
  provider: string
  provider_item_id: string
  institution_id: string | null
  institution_name: string | null
  status: ProviderItemStatus
  status_changed_at: string
  connected_at: string | null
  disconnected_at: string | null
  consent_expires_at: string | null
  sync_status: ProviderSyncStatus
  sync_cursor: string | null
  last_sync_started_at: string | null
  last_sync_completed_at: string | null
  last_successful_sync_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  last_error_at: string | null
  created_at: string
  updated_at: string
}

export interface FinancialProviderAccountRow {
  id: string
  organization_id: string
  provider_item_ref: string
  provider_account_id: string
  name: string | null
  official_name: string | null
  mask: string | null
  provider_account_type: string | null
  provider_account_subtype: string | null
  currency: 'USD'
  status: ProviderAccountStatus
  deactivated_at: string | null
  provider_metadata: Record<string, unknown>
}

export interface FinancialProviderAccountMappingRow {
  id: string
  organization_id: string
  provider_account_ref: string
  financial_account_id: string
  status: ProviderMappingStatus
  mapped_by: string | null
  mapped_at: string
  deactivated_by: string | null
  deactivated_at: string | null
  deactivation_reason: string | null
}

/** Raw evidence. `provider_amount` keeps the provider's sign convention; the Cash OS sign is derived later, per account class. */
export interface FinancialProviderTransactionRow {
  id: string
  organization_id: string
  provider_item_ref: string
  provider_account_ref: string
  provider_transaction_id: string
  pending: boolean
  pending_provider_transaction_id: string | null
  provider_amount: string
  provider_amount_minor: number
  currency: 'USD'
  transaction_date: string
  authorized_date: string | null
  name: string | null
  merchant_name: string | null
  original_description: string | null
  provider_category: unknown
  raw_payload: Record<string, unknown>
  removed_at: string | null
  first_seen_at: string
  last_seen_at: string
}

export interface FinancialProviderBalanceSnapshotRow {
  id: string
  organization_id: string
  provider_account_ref: string
  observed_at: string
  current_balance: string | null
  current_balance_minor: number | null
  available_balance: string | null
  available_balance_minor: number | null
  source: string
}

export interface FinancialProviderInterpretationRow {
  id: string
  organization_id: string
  provider_transaction_ref: string
  kind: InterpretationKind
  status: InterpretationStatus
  source: InterpretationSource
  confidence: InterpretationConfidence | null
  ledger_transaction_id: string | null
  match_mode: LedgerMatchMode | null
  category: string | null
  obligation_occurrence_id: string | null
  cash_commitment_id: string | null
  transaction_link_id: string | null
  counterpart_provider_transaction_ref: string | null
  debt_account_id: string | null
  project_id: string | null
  decided_by: string | null
  decided_at: string | null
  undone_by: string | null
  undone_at: string | null
  undo_reason: string | null
}
