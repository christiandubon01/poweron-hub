import { supabase } from '@/lib/supabase'
import type {
  FinancialAccountRow,
  FinancialTransactionRow,
  FinancialAccountClass,
  FinancialAccountType,
  FinancialOwnershipContext,
  FinancialTransactionKind,
} from '@/finance/ledgerTypes'
import { readCashPages } from './cashReadPagination'

type DbError = { code?: string; message: string }

export interface FinanceContext {
  userId: string
  organizationId: string
}

/** Complete ledger source for CASH-2/4/7. Links are not projection inputs. */
export async function readFinancialLedgerState(): Promise<{
  context: FinanceContext
  accounts: FinancialAccountRow[]
  transactions: FinancialTransactionRow[]
}> {
  const context = await resolveFinanceContext()
  const from = untypedSupabase().from.bind(untypedSupabase())
  const [accounts, transactions] = await Promise.all([
    readCashPages<FinancialAccountRow>('financial_accounts', q =>
      q.select('*').eq('organization_id', context.organizationId), from),
    readCashPages<FinancialTransactionRow>('financial_transactions', q =>
      q.select('*').eq('organization_id', context.organizationId), from),
  ])
  if (accounts.some(row => row.organization_id !== context.organizationId)
    || transactions.some(row => row.organization_id !== context.organizationId)) {
    throw new Error('Ledger organization mismatch')
  }
  return { context, accounts, transactions }
}

interface QueryResult<T> {
  data: T | null
  error: DbError | null
}

function untypedSupabase(): any {
  return supabase as any
}

export async function resolveFinanceContext(): Promise<FinanceContext> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user?.id) throw new Error('Not authenticated')

  const { data: orgId, error: orgError } = await untypedSupabase().rpc('user_org_id')
  if (orgError || typeof orgId !== 'string' || !orgId) {
    throw new Error('No active organization')
  }

  return { userId: user.id, organizationId: orgId }
}

export interface CreateFinancialAccountInput {
  displayName: string
  accountType: FinancialAccountType
  accountClass: FinancialAccountClass
  ownershipContext: FinancialOwnershipContext
  includeInCash?: boolean
}

export async function createFinancialAccount(
  input: CreateFinancialAccountInput,
): Promise<any> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await untypedSupabase()
    .from('financial_accounts')
    .insert({
      organization_id: ctx.organizationId,
      display_name: input.displayName.trim(),
      account_type: input.accountType,
      account_class: input.accountClass,
      ownership_context: input.ownershipContext,
      include_in_cash: Boolean(input.includeInCash),
      source_type: 'manual',
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export interface RecordManualTransactionInput {
  accountId: string
  amountMinor: number
  transactionDate: string
  kind: Exclude<FinancialTransactionKind, 'transfer' | 'card_debt_payment'>
  economicEffect: 'none' | 'inflow' | 'outflow'
  economicAmountMinor: number
  description?: string
  counterparty?: string | null
  category?: string | null
  projectId?: string | null
  employeeId?: string | null
  debtAccountId?: string | null
  idempotencyKey: string
  sourceType?: 'manual' | 'opening_balance' | 'operational_reference' | 'future_provider'
  sourceKind?: string | null
  sourceRecordId?: string | null
}

export async function recordManualTransaction(
  input: RecordManualTransactionInput,
): Promise<any> {
  if (!Number.isSafeInteger(input.amountMinor)) throw new Error('amountMinor must be integer cents')
  if (!Number.isSafeInteger(input.economicAmountMinor) || input.economicAmountMinor < 0) {
    throw new Error('economicAmountMinor must be non-negative integer cents')
  }

  const ctx = await resolveFinanceContext()
  const { data, error } = await untypedSupabase()
    .from('financial_transactions')
    .insert({
      organization_id: ctx.organizationId,
      account_id: input.accountId,
      amount_minor: input.amountMinor,
      transaction_date: input.transactionDate,
      posted_at: new Date().toISOString(),
      transaction_kind: input.kind,
      economic_effect: input.economicEffect,
      economic_amount_minor: input.economicAmountMinor,
      description: input.description ?? '',
      counterparty: input.counterparty ?? null,
      category: input.category ?? null,
      project_id: input.projectId ?? null,
      employee_id: input.employeeId ?? null,
      debt_account_id: input.debtAccountId ?? null,
      source_type: input.sourceType ?? (input.kind === 'opening_balance' ? 'opening_balance' : 'manual'),
      source_organization_id: input.sourceKind ? ctx.organizationId : null,
      source_kind: input.sourceKind ?? null,
      source_record_id: input.sourceKind ? input.sourceRecordId ?? null : null,
      idempotency_key: input.idempotencyKey,
    })
    .select('*')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export function computeReconciliationDeltaMinor(
  targetOwnerMinor: number,
  currentCanonicalMinor: number,
): number {
  // Owner always enters a positive natural balance (dollars owed or dollars held).
  // Both asset and liability accounts use the same positive-means-balance-present
  // canonical sign convention, so the delta is a straight subtraction.
  return targetOwnerMinor - currentCanonicalMinor
}

export async function recordBalanceReconciliation(input: {
  accountId: string
  targetOwnerMinor: number
  currentCanonicalMinor: number
  asOfDate: string
  idempotencyKey: string
}): Promise<any | null> {
  const deltaMinor = computeReconciliationDeltaMinor(
    input.targetOwnerMinor,
    input.currentCanonicalMinor,
  )
  if (deltaMinor === 0) return null
  return recordManualTransaction({
    accountId: input.accountId,
    amountMinor: deltaMinor,
    transactionDate: input.asOfDate,
    kind: 'balance_reconciliation',
    economicEffect: 'none',
    economicAmountMinor: 0,
    description: 'Balance reconciliation',
    sourceType: 'manual',
    idempotencyKey: input.idempotencyKey,
  })
}

export async function recordOpeningBalance(input: {
  accountId: string
  amountMinor: number
  asOfDate: string
  idempotencyKey: string
}): Promise<any> {
  return recordManualTransaction({
    accountId: input.accountId,
    amountMinor: input.amountMinor,
    transactionDate: input.asOfDate,
    kind: 'opening_balance',
    economicEffect: 'none',
    economicAmountMinor: 0,
    description: 'Opening balance',
    sourceType: 'opening_balance',
    idempotencyKey: input.idempotencyKey,
  })
}

export async function recordFinancialTransfer(input: {
  sourceAccountId: string
  targetAccountId: string
  amountMinor: number
  transactionDate: string
  description?: string
  idempotencyKey: string
}): Promise<any> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await untypedSupabase().rpc('record_financial_transfer', {
    p_organization_id: ctx.organizationId,
    p_source_account_id: input.sourceAccountId,
    p_target_account_id: input.targetAccountId,
    p_amount_minor: input.amountMinor,
    p_transaction_date: input.transactionDate,
    p_description: input.description ?? '',
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : data
}

export async function recordFinancialCardPayment(input: {
  cashAccountId: string
  liabilityAccountId: string
  amountMinor: number
  transactionDate: string
  description?: string
  idempotencyKey: string
}): Promise<any> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await untypedSupabase().rpc('record_financial_card_payment', {
    p_organization_id: ctx.organizationId,
    p_cash_account_id: input.cashAccountId,
    p_liability_account_id: input.liabilityAccountId,
    p_amount_minor: input.amountMinor,
    p_transaction_date: input.transactionDate,
    p_description: input.description ?? '',
    p_idempotency_key: input.idempotencyKey,
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : data
}

export interface UpdateFinancialAccountInput {
  displayName?: string
  ownershipContext?: FinancialOwnershipContext
  includeInCash?: boolean
}

export async function updateFinancialAccount(
  id: string,
  input: UpdateFinancialAccountInput,
): Promise<void> {
  if (!id) throw new Error('id is required')
  const patch: Record<string, unknown> = {}
  if (input.displayName !== undefined) {
    const trimmed = input.displayName.trim()
    if (!trimmed) throw new Error('Account name cannot be blank')
    patch.display_name = trimmed
  }
  if (input.ownershipContext !== undefined) patch.ownership_context = input.ownershipContext
  if (input.includeInCash !== undefined) patch.include_in_cash = input.includeInCash
  if (Object.keys(patch).length === 0) return

  const ctx = await resolveFinanceContext()
  const { error } = await untypedSupabase()
    .from('financial_accounts')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
  if (error) throw new Error(error.message)
}

export async function archiveFinancialAccount(id: string): Promise<void> {
  if (!id) throw new Error('id is required')
  const ctx = await resolveFinanceContext()
  const { error } = await untypedSupabase()
    .from('financial_accounts')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
  if (error) throw new Error(error.message)
}

export async function restoreFinancialAccount(id: string): Promise<void> {
  if (!id) throw new Error('id is required')
  const ctx = await resolveFinanceContext()
  const { error } = await untypedSupabase()
    .from('financial_accounts')
    .update({ status: 'active', archived_at: null })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'archived')
  if (error) throw new Error(error.message)
}

export async function voidStandaloneFinancialTransaction(
  transactionId: string,
  reason: string,
): Promise<void> {
  const ctx = await resolveFinanceContext()

  const { data: links, error: linkError } = await untypedSupabase()
    .from('financial_transaction_links')
    .select('id,relationship_type,status')
    .eq('organization_id', ctx.organizationId)
    .or(`source_transaction_id.eq.${transactionId},target_transaction_id.eq.${transactionId}`)
    .eq('status', 'confirmed')

  if (linkError) throw new Error(linkError.message)
  const protectedPair = (links ?? []).some((link: any) =>
    link.relationship_type === 'transfer_pair' ||
    link.relationship_type === 'card_debt_payment_pair',
  )
  if (protectedPair) {
    throw new Error('Paired transfer/card-payment transactions must be voided together')
  }

  const { error } = await untypedSupabase()
    .from('financial_transactions')
    .update({ status: 'voided', void_reason: reason })
    .eq('organization_id', ctx.organizationId)
    .eq('id', transactionId)

  if (error) throw new Error(error.message)
}

export async function voidFinancialTransactionPair(
  linkId: string,
  reason: string,
): Promise<{ lifecycle_result: 'voided' | 'already_voided' } & Record<string, unknown>> {
  const ctx = await resolveFinanceContext()
  const { data, error }: QueryResult<any> = await untypedSupabase().rpc(
    'void_financial_transaction_pair',
    {
      p_organization_id: ctx.organizationId,
      p_link_id: linkId,
      p_reason: reason,
    },
  )
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return row
}
