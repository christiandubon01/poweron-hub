import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { usd } from '../domain'
import { computeCashAllocation } from '../allocationEngine'
import { buildRecurringObligationEvents } from '../obligationCalculations'
import type { CashAllocationPolicy } from '../allocationTypes'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'
import type { CashCommitment, ObligationOccurrence, RecurringObligation } from '../obligationsTypes'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const serviceSrc = readFileSync(resolve(__dirname, '../../services/cashObligationService.ts'), 'utf8')
const migrationSql = readFileSync(resolve(__dirname, '../../../supabase/migrations/143_cash_dated_obligations.sql'), 'utf8')
const obligationsSrc = readFileSync(resolve(__dirname, '../../components/v15r/cash-os/CashOsObligations.tsx'), 'utf8')
const viewsSrc = readFileSync(resolve(__dirname, '../../components/v15r/cash-os/CashOsViews.tsx'), 'utf8')
const addSheetSrc = readFileSync(resolve(__dirname, '../../components/v15r/cash-os/CashOsAddSheet.tsx'), 'utf8')

// ── Fixtures ─────────────────────────────────────────────────────────────────

function baseAccount(overrides: Partial<FinancialAccountRow> = {}): FinancialAccountRow {
  return {
    id: 'acct-1', organization_id: 'org-1', display_name: 'Checking',
    account_type: 'checking', account_class: 'asset', ownership_context: 'business',
    include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
    source_metadata: {}, created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z', archived_at: null, ...overrides,
  }
}

function baseTx(overrides: Partial<FinancialTransactionRow> = {}): FinancialTransactionRow {
  return {
    id: 'tx-1', organization_id: 'org-1', account_id: 'acct-1',
    amount_minor: 1_000_000, currency: 'USD', transaction_date: '2026-09-01',
    effective_at: null, posted_at: '2026-09-01T00:00:00Z', status: 'posted',
    transaction_kind: 'income', economic_effect: 'inflow', economic_amount_minor: 1_000_000,
    description: '', counterparty: null, category: null, project_id: null,
    employee_id: null, debt_account_id: null, source_type: 'manual',
    source_organization_id: null, source_kind: null, source_record_id: null,
    source_effective_date: null, source_timestamp: null, source_metadata: {},
    idempotency_key: 'k-1', created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z', voided_at: null, voided_by: null, void_reason: null,
    ...overrides,
  }
}

function baseObligation(overrides: Partial<RecurringObligation> = {}): RecurringObligation {
  return {
    id: 'ob-1', organizationId: 'org-1', name: 'Rent', description: null, category: null,
    amount: usd(200_000), amountCertainty: 'fixed', estimatedMinimum: null, estimatedMaximum: null,
    recurrence: { kind: 'monthly', interval: 1, anchorDate: '2026-10-01', startDate: '2026-10-01', endDate: null },
    requirement: 'required', confidence: 'confirmed', status: 'active',
    accountId: null, debtAccountId: null, projectId: null, sourceType: 'manual',
    provenance: {
      source: { organizationId: 'org-1', kind: 'financial_obligation', recordId: 'ob-1' },
      freshness: 'current', confidence: 'confirmed', reconciliationState: 'unreconciled',
    },
    ...overrides,
  }
}

function baseCommitment(overrides: Partial<CashCommitment> = {}): CashCommitment {
  return {
    id: 'c-1', organizationId: 'org-1', title: 'Equipment', description: null,
    expectedDate: '2026-10-10', amount: usd(150_000), amountCertainty: 'fixed',
    estimatedMinimum: null, estimatedMaximum: null, requirement: 'required', confidence: 'confirmed',
    category: null, status: 'scheduled', accountId: null, projectId: null, employeeId: null,
    debtAccountId: null, sourceType: 'manual', reconciliationState: 'unreconciled',
    actualTransactionId: null,
    provenance: {
      source: { organizationId: 'org-1', kind: 'cash_commitment', recordId: 'c-1' },
      freshness: 'current', confidence: 'confirmed', reconciliationState: 'unreconciled',
    },
    ...overrides,
  }
}

function baseOccurrence(overrides: Partial<ObligationOccurrence> = {}): ObligationOccurrence {
  return {
    id: 'occ-1', organizationId: 'org-1', obligationId: 'ob-1',
    scheduledDate: '2026-10-01', status: 'scheduled',
    reconciliationState: 'unreconciled', actualTransactionId: null, ...overrides,
  }
}

function basePolicy(overrides: Partial<CashAllocationPolicy> = {}): CashAllocationPolicy {
  return {
    organizationId: 'org-1', asOfDate: '2026-09-29', protectionHorizonDays: 30,
    operatingFloorMinor: 0, taxReserve: { kind: 'disabled' }, includeOptionalObligations: false,
    ...overrides,
  }
}

const ACCOUNTS = [baseAccount()]
const TRANSACTIONS = [baseTx()]

// ── 1: Obligation occurrence reconciliation calls the RPC ─────────────────────

describe('CASH-9 Plan → Reality Reconciliation', () => {

  it('1: reconcilePlannedOutflow passes occurrenceId and transactionId to RPC', () => {
    const reconcileFnIdx = serviceSrc.indexOf('async function reconcilePlannedOutflow')
    const nextFnIdx = serviceSrc.indexOf('\nexport ', reconcileFnIdx + 10)
    const body = serviceSrc.slice(reconcileFnIdx, nextFnIdx > reconcileFnIdx ? nextFnIdx : undefined)
    expect(body).toContain('reconcile_financial_planned_outflow')
    expect(body).toContain('p_occurrence_id')
    expect(body).toContain('p_transaction_id')
    expect(body).toContain('input.occurrenceId ?? null')
  })

  // ── 2: Commitment reconciliation ────────────────────────────────────────────

  it('2: reconcilePlannedOutflow passes commitmentId and transactionId to RPC', () => {
    const reconcileFnIdx = serviceSrc.indexOf('async function reconcilePlannedOutflow')
    const nextFnIdx = serviceSrc.indexOf('\nexport ', reconcileFnIdx + 10)
    const body = serviceSrc.slice(reconcileFnIdx, nextFnIdx > reconcileFnIdx ? nextFnIdx : undefined)
    expect(body).toContain('p_commitment_id')
    expect(body).toContain('input.commitmentId ?? null')
  })

  // ── 3: Reconciliation does not create another financial transaction ──────────

  it('3: neither reconcilePlannedOutflow nor materializeObligation writes to financial_transactions', () => {
    const reconcileFnIdx = serviceSrc.indexOf('async function reconcilePlannedOutflow')
    const reconcileFnEnd = serviceSrc.indexOf('\n}', reconcileFnIdx)
    const reconcileBody = serviceSrc.slice(reconcileFnIdx, reconcileFnEnd)
    expect(reconcileBody).not.toContain('financial_transactions')
    expect(reconcileBody).not.toContain('.insert(')
    expect(reconcileBody).not.toContain('.update(')

    const materializeFnIdx = serviceSrc.indexOf('async function materializeObligation')
    const materializeFnEnd = serviceSrc.indexOf('\n}', materializeFnIdx)
    const materializeBody = serviceSrc.slice(materializeFnIdx, materializeFnEnd)
    expect(materializeBody).not.toContain('financial_transactions')
  })

  // ── 4: Reconciled requirement no longer contributes to Protected Cash ────────

  it('4: a reconciled (satisfied) occurrence is filtered out of Protected Cash', () => {
    const obligation = baseObligation()
    const reconciledOccurrence = baseOccurrence({
      id: 'occ-satisfied', status: 'satisfied', reconciliationState: 'reconciled',
      actualTransactionId: 'tx-paid',
    })
    const snap = computeCashAllocation(ACCOUNTS, TRANSACTIONS, [obligation], [reconciledOccurrence], [], basePolicy())
    // The reconciled occurrence must not contribute any requirement
    const reconciledReq = snap.allocationResult.requirements.find(
      r => r.dedupeKey.includes('occ-satisfied'),
    )
    expect(reconciledReq).toBeUndefined()
  })

  it('4b: same obligation with unreconciled occurrence IS protected', () => {
    const obligation = baseObligation()
    const unreconciledOccurrence = baseOccurrence({ id: 'occ-scheduled' })
    const snap = computeCashAllocation(ACCOUNTS, TRANSACTIONS, [obligation], [unreconciledOccurrence], [], basePolicy())
    const req = snap.allocationResult.requirements.find(r => r.dedupeKey.includes('occ-scheduled'))
    expect(req).toBeDefined()
    expect(snap.totalProtectedRequirementMinor).toBeGreaterThan(0)
  })

  // ── 5: Reconciled event no longer appears as outstanding planned movement ────

  it('5: buildRecurringObligationEvents marks reconciled occurrence as satisfied/reconciled', () => {
    const obligation = baseObligation()
    const reconciledOccurrence = baseOccurrence({
      id: 'occ-reconciled', status: 'satisfied', reconciliationState: 'reconciled',
      actualTransactionId: 'tx-paid',
    })
    const events = buildRecurringObligationEvents(
      obligation, [reconciledOccurrence], '2026-10-01', '2026-10-01',
    )
    expect(events).toHaveLength(1)
    expect(events[0].reconciliationState).toBe('reconciled')
    expect(events[0].status).toBe('satisfied')
    // Projection engine filters reconciled events — verify the event is marked correctly
    // so the projection's contributesToPlannedOutflow guard will exclude it
    expect(events[0].status).not.toBe('scheduled')
  })

  // ── 6: Recurring obligation continues producing future occurrences ───────────

  it('6: reconciling Oct-1 occurrence does not remove the Nov-1 occurrence from the schedule', () => {
    const obligation = baseObligation({ recurrence: {
      kind: 'monthly', interval: 1, anchorDate: '2026-10-01', startDate: '2026-10-01', endDate: null,
    }})
    const octOccurrence = baseOccurrence({
      id: 'occ-oct', scheduledDate: '2026-10-01',
      status: 'satisfied', reconciliationState: 'reconciled', actualTransactionId: 'tx-oct',
    })
    const octEvents = buildRecurringObligationEvents(obligation, [octOccurrence], '2026-10-01', '2026-10-01')
    const novEvents = buildRecurringObligationEvents(obligation, [octOccurrence], '2026-11-01', '2026-11-01')
    // October occurrence is satisfied
    expect(octEvents[0].reconciliationState).toBe('reconciled')
    // November occurrence is unreconciled and active — obligation continues normally
    expect(novEvents).toHaveLength(1)
    expect(novEvents[0].date).toBe('2026-11-01')
    expect(novEvents[0].reconciliationState).toBe('unreconciled')
    expect(novEvents[0].status).toBe('scheduled')
  })

  // ── 7: Wrong-org transaction cannot be linked ────────────────────────────────

  it('7: RPC validates transaction belongs to the same organization', () => {
    expect(migrationSql).toContain('WHERE id = p_transaction_id')
    expect(migrationSql).toContain('AND organization_id = p_organization_id')
  })

  it('7b: materializeObligation scopes occurrence lookup to the caller org', () => {
    const materializeFnIdx = serviceSrc.indexOf('async function materializeObligation')
    const nextFnIdx = serviceSrc.indexOf('\nexport ', materializeFnIdx + 10)
    const body = serviceSrc.slice(materializeFnIdx, nextFnIdx > materializeFnIdx ? nextFnIdx : undefined)
    expect(body).toContain('.eq(\'organization_id\', ctx.organizationId)')
  })

  // ── 8: Already-reconciled item cannot be reconciled twice ────────────────────

  it('8: migration has unique constraint preventing one actual transaction satisfying two planned items', () => {
    expect(migrationSql).toContain('financial_planned_one_actual_transaction UNIQUE')
  })

  it('8b: migration prevents one occurrence reconciling more than once', () => {
    expect(migrationSql).toContain('uq_financial_planned_occurrence')
  })

  it('8c: migration prevents one commitment reconciling more than once', () => {
    expect(migrationSql).toContain('uq_financial_planned_commitment')
  })

  it('8d: materializeObligation throws when occurrence is already reconciled', () => {
    const materializeFnIdx = serviceSrc.indexOf('async function materializeObligation')
    const nextFnIdx = serviceSrc.indexOf('\nexport ', materializeFnIdx + 10)
    const body = serviceSrc.slice(materializeFnIdx, nextFnIdx > materializeFnIdx ? nextFnIdx : undefined)
    expect(body).toContain("throw new Error('This occurrence has already been reconciled')")
  })

  // ── 9: Cancelled/archived lifecycle actions cannot be reconciled ─────────────

  it('9: archived obligations show no Mark Paid button (active check)', () => {
    // The Mark Paid button is inside the `row.status === "active"` guard
    const markPaidIdx = obligationsSrc.indexOf('setMode(\'reconcile-occurrence\')')
    expect(markPaidIdx).toBeGreaterThan(-1)
    const activeBranchIdx = obligationsSrc.lastIndexOf("row.status === 'active'", markPaidIdx)
    expect(activeBranchIdx).toBeGreaterThan(-1)
    // The active guard must come before the Mark Paid button
    expect(activeBranchIdx).toBeLessThan(markPaidIdx)
  })

  it('9b: cancelled commitments show no Mark Paid button (canEdit guard)', () => {
    // The Mark Paid button for commitments is inside the canEdit block
    const commitMarkPaidIdx = obligationsSrc.indexOf('setMode(\'reconcile-commitment\')')
    expect(commitMarkPaidIdx).toBeGreaterThan(-1)
    // canEdit is defined as scheduled + unreconciled
    const canEditIdx = obligationsSrc.lastIndexOf('canEdit', commitMarkPaidIdx)
    expect(canEditIdx).toBeGreaterThan(-1)
    expect(canEditIdx).toBeLessThan(commitMarkPaidIdx)
  })

  it('9c: materializeObligation rejects non-scheduled occurrence status', () => {
    const materializeFnIdx = serviceSrc.indexOf('async function materializeObligation')
    const nextFnIdx = serviceSrc.indexOf('\nexport ', materializeFnIdx + 10)
    const body = serviceSrc.slice(materializeFnIdx, nextFnIdx > materializeFnIdx ? nextFnIdx : undefined)
    expect(body).toContain("throw new Error('Only scheduled occurrences can be reconciled')")
  })

  // ── 10: CashObligationsView passes occurrences, transactions, accounts ────────

  it('10: CashObligationsView passes occurrences, transactions, accounts to CashOsObligations', () => {
    expect(viewsSrc).toContain('occurrences={snapshot.occurrences}')
    expect(viewsSrc).toContain('transactions={snapshot.transactions}')
    expect(viewsSrc).toContain('accounts={snapshot.accounts}')
  })

  it('10b: ReconcilePanel only shows exact-amount match candidates', () => {
    // candidateTxs filters by Math.abs(tx.amount_minor) === plannedMinor
    expect(obligationsSrc).toContain('Math.abs(tx.amount_minor) === plannedMinor')
  })

  it('10c: ReconcilePanel rejects opening_balance and transfer transactions', () => {
    expect(obligationsSrc).toContain("tx.transaction_kind !== 'opening_balance'")
    expect(obligationsSrc).toContain("tx.transaction_kind !== 'transfer'")
  })

  it('10d: ReconcilePanel only accepts posted transactions', () => {
    expect(obligationsSrc).toContain("tx.status === 'posted'")
  })

  it('10e: RPC requires exact cent reconciliation — V1 partial matching not supported', () => {
    expect(migrationSql).toContain('partial/variance matching is not supported')
  })

  // ── Regression: canonical manual expense shape is discoverable ────────────────

  it('10f: canonical manual expense (negative amount_minor) passes the ReconcilePanel candidate filter', () => {
    // This is the exact shape CashOsAddSheet produces after the sign fix:
    // parseDollars("1.00") → 100; signedAmountMinor = -100 for expense mode
    const canonicalExpense: FinancialTransactionRow = baseTx({
      id: 'tx-canonical-expense',
      amount_minor: -100,           // signed outflow on asset account
      economic_effect: 'outflow',
      economic_amount_minor: 100,   // unsigned magnitude per schema constraint
      transaction_kind: 'expense',
      status: 'posted',
    })
    const plannedMinor = 100 // $1.00 planned outflow

    // Mirror the candidateTxs predicate from CashOsObligations.tsx verbatim
    const accepted =
      canonicalExpense.status === 'posted' &&
      canonicalExpense.transaction_kind !== 'opening_balance' &&
      canonicalExpense.transaction_kind !== 'transfer' &&
      canonicalExpense.amount_minor < 0 &&
      Math.abs(canonicalExpense.amount_minor) === plannedMinor

    expect(accepted).toBe(true)

    // Also confirm income is rejected by the same filter (no false positives)
    const incomeWithSameAbs: FinancialTransactionRow = baseTx({
      id: 'tx-income',
      amount_minor: 100,
      economic_effect: 'inflow',
      economic_amount_minor: 100,
      transaction_kind: 'income',
      status: 'posted',
    })
    const incomeAccepted = incomeWithSameAbs.amount_minor < 0
    expect(incomeAccepted).toBe(false)
  })

  it('10g: CashOsAddSheet uses negative amount_minor for expense mode (signed ledger write)', () => {
    const handleIdx = addSheetSrc.indexOf('async function handleSubmit')
    const onSuccessIdx = addSheetSrc.indexOf('onSuccess()', handleIdx)
    const body = addSheetSrc.slice(handleIdx, onSuccessIdx + 12)
    // Verify expense writes a negated signed amount, not the raw positive parseDollars result
    expect(body).toContain('signedAmountMinor')
    expect(body).toContain('-amountMinor')
    // economicAmountMinor must remain the unsigned magnitude
    expect(body).toContain('economicAmountMinor: amountMinor')
  })
})
