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

/** Ensure a concrete occurrence row exists for a specific obligation + scheduled date.
 *  Uses the unique constraint (organization_id, obligation_id, scheduled_date) to
 *  safely re-enter: returns the existing id if already present and still reconcilable. */
export async function materializeObligation(input: {
  obligationId: string
  scheduledDate: string
}): Promise<{ id: string }> {
  if (!input.obligationId) throw new Error('obligationId is required')
  if (!input.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
    throw new Error('Enter a valid scheduled date')
  }
  const ctx = await resolveFinanceContext()
  const { data: existing } = await db()
    .from('financial_obligation_occurrences')
    .select('id, status, reconciliation_state')
    .eq('organization_id', ctx.organizationId)
    .eq('obligation_id', input.obligationId)
    .eq('scheduled_date', input.scheduledDate)
    .maybeSingle()
  if (existing) {
    if (existing.reconciliation_state === 'reconciled') throw new Error('This occurrence has already been reconciled')
    if (existing.status !== 'scheduled') throw new Error('Only scheduled occurrences can be reconciled')
    return { id: existing.id }
  }
  const { data, error } = await db()
    .from('financial_obligation_occurrences')
    .insert({ organization_id: ctx.organizationId, obligation_id: input.obligationId, scheduled_date: input.scheduledDate })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  if (!data?.id || typeof data.id !== 'string') throw new Error('Occurrence materialization did not return an id')
  return { id: data.id }
}

// ─── CASH-OS-2C: Obligation + Commitment write authority ─────────────────────

export type ObligationRecurrenceSchedule =
  | 'weekly'
  | 'every_2_weeks'
  | 'every_4_weeks'
  | 'monthly'
  | 'quarterly'
  | 'yearly'

const RECURRENCE_SCHEDULE_MAP: Record<ObligationRecurrenceSchedule, { kind: string; interval: number }> = {
  weekly:       { kind: 'weekly',        interval: 1 },
  every_2_weeks:{ kind: 'every_n_weeks', interval: 2 },
  every_4_weeks:{ kind: 'every_n_weeks', interval: 4 },
  monthly:      { kind: 'monthly',       interval: 1 },
  quarterly:    { kind: 'monthly',       interval: 3 },
  yearly:       { kind: 'yearly',        interval: 1 },
}

export const OBLIGATION_SCHEDULES: ObligationRecurrenceSchedule[] = [
  'weekly', 'every_2_weeks', 'every_4_weeks', 'monthly', 'quarterly', 'yearly',
]

export const OBLIGATION_SCHEDULE_LABELS: Record<ObligationRecurrenceSchedule, string> = {
  weekly: 'Weekly', every_2_weeks: 'Every 2 weeks', every_4_weeks: 'Every 4 weeks',
  monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly',
}

export interface CreateObligationInput {
  name: string
  category?: string | null
  amountMinor: number
  schedule: ObligationRecurrenceSchedule
  anchorDate: string
  isRequired: boolean
  confidence: 'confirmed' | 'expected' | 'possible'
  debtAccountId?: string | null
}

export interface UpdateObligationInput {
  name?: string
  category?: string | null
  amountMinor?: number
  schedule?: ObligationRecurrenceSchedule
  anchorDate?: string
  isRequired?: boolean
  confidence?: 'confirmed' | 'expected' | 'possible'
  debtAccountId?: string | null
}

export interface CreateCommitmentInput {
  title: string
  category?: string | null
  amountMinor: number
  expectedDate: string
  isRequired: boolean
  confidence: 'confirmed' | 'expected' | 'possible'
  debtAccountId?: string | null
}

export interface UpdateCommitmentInput {
  title?: string
  category?: string | null
  amountMinor?: number
  expectedDate?: string
  isRequired?: boolean
  confidence?: 'confirmed' | 'expected' | 'possible'
  debtAccountId?: string | null
}

// ─── Validation helpers (pure, no side effects) ───────────────────────────────

export function validateObligationInput(input: {
  name: string
  amountMinor: number
  schedule: string
  anchorDate: string
}): string | null {
  if (!input.name.trim()) return 'Name is required'
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) return 'Enter a valid positive amount'
  if (!OBLIGATION_SCHEDULES.includes(input.schedule as ObligationRecurrenceSchedule)) return 'Choose a recurrence schedule'
  if (!input.anchorDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.anchorDate)) return 'Enter a valid start date'
  return null
}

export function validateCommitmentInput(input: {
  title: string
  amountMinor: number
  expectedDate: string
}): string | null {
  if (!input.title.trim()) return 'Title is required'
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) return 'Enter a valid positive amount'
  if (!input.expectedDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedDate)) return 'Enter a valid expected date'
  return null
}

// ─── Write functions ──────────────────────────────────────────────────────────

export async function createFinancialObligation(input: CreateObligationInput): Promise<{ id: string }> {
  const guard = validateObligationInput({ name: input.name, amountMinor: input.amountMinor, schedule: input.schedule, anchorDate: input.anchorDate })
  if (guard) throw new Error(guard)
  const ctx = await resolveFinanceContext()
  const { kind, interval } = RECURRENCE_SCHEDULE_MAP[input.schedule]
  const { data, error } = await db()
    .from('financial_obligations')
    .insert({
      organization_id: ctx.organizationId,
      name: input.name.trim(),
      category: input.category?.trim() || null,
      amount_type: 'fixed',
      amount_minor: input.amountMinor,
      recurrence_kind: kind,
      recurrence_interval: interval,
      anchor_date: input.anchorDate,
      start_date: input.anchorDate,
      is_required: input.isRequired,
      confidence: input.confidence,
      debt_account_id: input.debtAccountId ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  if (!data?.id || typeof data.id !== 'string') throw new Error('Obligation creation did not return an id')
  return { id: data.id }
}

export async function updateFinancialObligation(id: string, input: UpdateObligationInput): Promise<void> {
  if (!id) throw new Error('id is required')
  const ctx = await resolveFinanceContext()
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('Name is required')
    patch.name = input.name.trim()
  }
  if ('category' in input) patch.category = input.category?.trim() || null
  if (input.amountMinor !== undefined) {
    if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) throw new Error('Enter a valid positive amount')
    patch.amount_minor = input.amountMinor
  }
  if (input.schedule !== undefined) {
    const rec = RECURRENCE_SCHEDULE_MAP[input.schedule]
    if (!rec) throw new Error('Choose a recurrence schedule')
    patch.recurrence_kind = rec.kind
    patch.recurrence_interval = rec.interval
    if (input.anchorDate !== undefined) {
      patch.anchor_date = input.anchorDate
      patch.start_date = input.anchorDate
    }
  } else if (input.anchorDate !== undefined) {
    patch.anchor_date = input.anchorDate
    patch.start_date = input.anchorDate
  }
  if (input.isRequired !== undefined) patch.is_required = input.isRequired
  if (input.confidence !== undefined) patch.confidence = input.confidence
  if ('debtAccountId' in input) patch.debt_account_id = input.debtAccountId ?? null
  if (Object.keys(patch).length === 0) return
  const { error } = await db()
    .from('financial_obligations')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
  if (error) throw new Error(error.message)
}

export async function archiveFinancialObligation(id: string): Promise<void> {
  if (!id) throw new Error('id is required')
  const ctx = await resolveFinanceContext()
  const { error } = await db()
    .from('financial_obligations')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'active')
  if (error) throw new Error(error.message)
}

export async function createCashCommitment(input: CreateCommitmentInput): Promise<{ id: string }> {
  const guard = validateCommitmentInput({ title: input.title, amountMinor: input.amountMinor, expectedDate: input.expectedDate })
  if (guard) throw new Error(guard)
  const ctx = await resolveFinanceContext()
  const { data, error } = await db()
    .from('cash_commitments')
    .insert({
      organization_id: ctx.organizationId,
      title: input.title.trim(),
      category: input.category?.trim() || null,
      amount_type: 'fixed',
      amount_minor: input.amountMinor,
      expected_date: input.expectedDate,
      is_required: input.isRequired,
      confidence: input.confidence,
      debt_account_id: input.debtAccountId ?? null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  if (!data?.id || typeof data.id !== 'string') throw new Error('Commitment creation did not return an id')
  return { id: data.id }
}

export async function updateCashCommitment(id: string, input: UpdateCommitmentInput): Promise<void> {
  if (!id) throw new Error('id is required')
  const ctx = await resolveFinanceContext()
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) {
    if (!input.title.trim()) throw new Error('Title is required')
    patch.title = input.title.trim()
  }
  if ('category' in input) patch.category = input.category?.trim() || null
  if (input.amountMinor !== undefined) {
    if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) throw new Error('Enter a valid positive amount')
    patch.amount_minor = input.amountMinor
  }
  if (input.expectedDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedDate)) throw new Error('Enter a valid expected date')
    patch.expected_date = input.expectedDate
  }
  if (input.isRequired !== undefined) patch.is_required = input.isRequired
  if (input.confidence !== undefined) patch.confidence = input.confidence
  if ('debtAccountId' in input) patch.debt_account_id = input.debtAccountId ?? null
  if (Object.keys(patch).length === 0) return
  const { error } = await db()
    .from('cash_commitments')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'scheduled')
    .eq('reconciliation_state', 'unreconciled')
  if (error) throw new Error(error.message)
}

export async function cancelCashCommitment(id: string): Promise<void> {
  if (!id) throw new Error('id is required')
  const ctx = await resolveFinanceContext()
  const { error } = await db()
    .from('cash_commitments')
    .update({ status: 'canceled' })
    .eq('id', id)
    .eq('organization_id', ctx.organizationId)
    .eq('status', 'scheduled')
    .eq('reconciliation_state', 'unreconciled')
  if (error) throw new Error(error.message)
}
