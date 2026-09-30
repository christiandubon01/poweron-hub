import { supabase } from '@/lib/supabase'
import { makeMoneyFromDbMinor, buildCommitmentEvent, buildRecurringObligationEvents, summarizePlannedOutflows } from '@/finance/obligationCalculations'
import type {
  CashCommitment,
  ObligationOccurrence,
  PlannedOutflowSummary,
  RecurringObligation,
} from '@/finance/obligationsTypes'
import { resolveFinanceContext } from './manualLedgerService'
import { readCashPages } from './cashReadPagination'

function db(): any {
  return supabase as any
}

function provenance(organizationId: string, kind: 'financial_obligation' | 'cash_commitment', id: string, confidence: any) {
  return {
    source: { organizationId, kind, recordId: id },
    freshness: 'current' as const,
    confidence,
    reconciliationState: 'unreconciled' as const,
  }
}

function mapObligation(row: any): RecurringObligation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    category: row.category,
    amount: makeMoneyFromDbMinor(row.amount_minor),
    amountCertainty: row.amount_type,
    estimatedMinimum: row.estimated_min_minor == null ? null : makeMoneyFromDbMinor(row.estimated_min_minor),
    estimatedMaximum: row.estimated_max_minor == null ? null : makeMoneyFromDbMinor(row.estimated_max_minor),
    recurrence: {
      kind: row.recurrence_kind,
      interval: row.recurrence_interval,
      anchorDate: row.anchor_date,
      startDate: row.start_date,
      endDate: row.end_date,
    },
    requirement: row.is_required ? 'required' : 'optional',
    confidence: row.confidence,
    status: row.status,
    accountId: row.account_id,
    debtAccountId: row.debt_account_id,
    projectId: row.project_id,
    sourceType: row.source_type,
    provenance: provenance(row.organization_id, 'financial_obligation', row.id, row.confidence),
  }
}

function mapOccurrence(row: any): ObligationOccurrence {
  return {
    id: row.id,
    organizationId: row.organization_id,
    obligationId: row.obligation_id,
    scheduledDate: row.scheduled_date,
    overrideDate: row.override_date,
    overrideAmount: row.override_amount_minor == null ? null : makeMoneyFromDbMinor(row.override_amount_minor),
    status: row.status,
    reason: row.reason,
    reconciliationState: row.reconciliation_state,
    actualTransactionId: row.actual_transaction_id,
  }
}

function mapCommitment(row: any): CashCommitment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    description: row.description,
    expectedDate: row.expected_date,
    amount: makeMoneyFromDbMinor(row.amount_minor),
    amountCertainty: row.amount_type,
    estimatedMinimum: row.estimated_min_minor == null ? null : makeMoneyFromDbMinor(row.estimated_min_minor),
    estimatedMaximum: row.estimated_max_minor == null ? null : makeMoneyFromDbMinor(row.estimated_max_minor),
    requirement: row.is_required ? 'required' : 'optional',
    confidence: row.confidence,
    category: row.category,
    status: row.status,
    accountId: row.account_id,
    projectId: row.project_id,
    employeeId: row.employee_id,
    debtAccountId: row.debt_account_id,
    sourceType: 'manual',
    reconciliationState: row.reconciliation_state,
    actualTransactionId: row.actual_transaction_id,
    provenance: provenance(row.organization_id, 'cash_commitment', row.id, row.confidence),
  }
}

/** Raw CASH-3 authority, including overdue rows and occurrence overrides. */
export async function readCashObligationState(): Promise<{
  obligations: RecurringObligation[]
  occurrences: ObligationOccurrence[]
  commitments: CashCommitment[]
}> {
  const { organizationId } = await resolveFinanceContext()
  const from = db().from.bind(db())
  const [obligationRows, occurrenceRows, commitmentRows] = await Promise.all([
    readCashPages<any>('financial_obligations', q => q.select('*').eq('organization_id', organizationId), from),
    readCashPages<any>('financial_obligation_occurrences', q => q.select('*').eq('organization_id', organizationId), from),
    readCashPages<any>('cash_commitments', q => q.select('*').eq('organization_id', organizationId), from),
  ])
  const all = [...obligationRows, ...occurrenceRows, ...commitmentRows]
  if (all.some(row => row.organization_id !== organizationId)) throw new Error('Obligation organization mismatch')
  return {
    obligations: obligationRows.map(mapObligation),
    occurrences: occurrenceRows.map(mapOccurrence),
    commitments: commitmentRows.map(mapCommitment),
  }
}

export async function readPlannedOutflowSummary(
  rangeStart: string,
  rangeEnd: string,
): Promise<PlannedOutflowSummary> {
  const ctx = await resolveFinanceContext()
  const [obligationResult, occurrenceResult, commitmentResult] = await Promise.all([
    db().from('financial_obligations').select('*').eq('organization_id', ctx.organizationId),
    db().from('financial_obligation_occurrences').select('*').eq('organization_id', ctx.organizationId),
    db().from('cash_commitments').select('*')
      .eq('organization_id', ctx.organizationId)
      .gte('expected_date', rangeStart)
      .lte('expected_date', rangeEnd),
  ])

  for (const result of [obligationResult, occurrenceResult, commitmentResult]) {
    if (result.error) throw new Error(result.error.message)
  }

  const obligations = (obligationResult.data ?? []).map(mapObligation)
  const occurrences = (occurrenceResult.data ?? []).map(mapOccurrence)
  const commitments = (commitmentResult.data ?? []).map(mapCommitment)

  const events = obligations.flatMap((obligation: RecurringObligation) =>
    buildRecurringObligationEvents(obligation, occurrences, rangeStart, rangeEnd),
  )
  events.push(...commitments.map(buildCommitmentEvent))
  return summarizePlannedOutflows(events)
}

export async function reconcilePlannedOutflow(input: {
  occurrenceId?: string | null
  commitmentId?: string | null
  transactionId: string
}): Promise<any> {
  const ctx = await resolveFinanceContext()
  const { data, error } = await db().rpc('reconcile_financial_planned_outflow', {
    p_organization_id: ctx.organizationId,
    p_occurrence_id: input.occurrenceId ?? null,
    p_commitment_id: input.commitmentId ?? null,
    p_transaction_id: input.transactionId,
  })
  if (error) throw new Error(error.message)
  return Array.isArray(data) ? data[0] : data
}
