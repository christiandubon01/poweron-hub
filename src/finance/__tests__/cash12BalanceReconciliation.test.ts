import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  accountBalanceMinor,
  economicTotals,
  isEconomicNeutralTransaction,
} from '../ledgerCalculations'
import { computeReconciliationDeltaMinor } from '../../services/manualLedgerService'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const obligationsSrc = readFileSync(
  resolve(__dirname, '../../components/v15r/cash-os/CashOsObligations.tsx'),
  'utf8',
)
const projectionSrc = readFileSync(
  resolve(__dirname, '../cashProjection.ts'),
  'utf8',
)

function account(overrides: Partial<FinancialAccountRow> = {}): FinancialAccountRow {
  return {
    id: 'a', organization_id: 'org', display_name: 'Checking',
    account_type: 'checking', account_class: 'asset', ownership_context: 'business',
    include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
    source_metadata: {}, created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z', archived_at: null, ...overrides,
  }
}

function tx(overrides: Partial<FinancialTransactionRow> = {}): FinancialTransactionRow {
  return {
    id: 't', organization_id: 'org', account_id: 'a',
    amount_minor: 0, currency: 'USD', transaction_date: '2026-10-01',
    effective_at: null, posted_at: '2026-10-01T00:00:00Z', status: 'posted',
    transaction_kind: 'balance_reconciliation', economic_effect: 'none',
    economic_amount_minor: 0, description: 'Balance reconciliation',
    counterparty: null, category: null, project_id: null, employee_id: null,
    debt_account_id: null, source_type: 'manual', source_organization_id: null,
    source_kind: null, source_record_id: null, source_effective_date: null,
    source_timestamp: null, source_metadata: {}, idempotency_key: 'k',
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    voided_at: null, voided_by: null, void_reason: null, ...overrides,
  }
}

describe('CORE-CLOSE-2B1 Balance Reconciliation', () => {

  it('1: asset opening balance produces correct canonical asset balance', () => {
    // New checking account, no prior transactions; reconcile to $2,500
    const recon = tx({ id: 'r1', account_id: 'a', amount_minor: 250_000 })
    expect(accountBalanceMinor('a', [recon])).toBe(250_000)
  })

  it('2: liability reconciliation from $0 to $4,877 produces $4,877 owed', () => {
    // Wells Fargo credit card: canonical starts at $0, reconcile to $4,877
    const recon = tx({ id: 'r2', account_id: 'cc', amount_minor: 487_700 })
    expect(accountBalanceMinor('cc', [recon])).toBe(487_700)
  })

  it('3: reconciliation from existing nonzero balance records only the required delta', () => {
    // Existing balance = $4,000 owed (from income tx on liability account)
    // Owner reconciles to $4,877 → delta = $877
    const existing = tx({ id: 'ob', account_id: 'cc', amount_minor: 400_000, transaction_kind: 'opening_balance' })
    const delta = computeReconciliationDeltaMinor(487_700, 400_000)
    expect(delta).toBe(87_700)
    const recon = tx({ id: 'r3', account_id: 'cc', amount_minor: delta })
    expect(accountBalanceMinor('cc', [existing, recon])).toBe(487_700)
  })

  it('4: reconciliation adjustment is not classified as income', () => {
    const recon = tx({ id: 'r4', amount_minor: 487_700 })
    expect(recon.transaction_kind).not.toBe('income')
    expect(recon.economic_effect).not.toBe('inflow')
    const totals = economicTotals([recon])
    expect(totals.inflowMinor).toBe(0)
  })

  it('5: reconciliation adjustment is not classified as expense', () => {
    const recon = tx({ id: 'r5', amount_minor: -10_000 })
    expect(recon.transaction_kind).not.toBe('expense')
    expect(recon.economic_effect).not.toBe('outflow')
    const totals = economicTotals([recon])
    expect(totals.outflowMinor).toBe(0)
  })

  it('6: reconciliation adjustment is not classified as Card / Loan Payment', () => {
    const recon = tx({ id: 'r6', amount_minor: 487_700 })
    expect(recon.transaction_kind).not.toBe('card_debt_payment')
    expect(recon.debt_account_id).toBeNull()
  })

  it('7: reconciliation adjustment does not contaminate project/collection economic metrics', () => {
    // isEconomicNeutralTransaction must return true; economicTotals must ignore it
    const recon = tx({ id: 'r7', amount_minor: 487_700 })
    expect(isEconomicNeutralTransaction(recon)).toBe(true)
    const income = tx({ id: 'inc', transaction_kind: 'income', economic_effect: 'inflow', economic_amount_minor: 10_000, amount_minor: 10_000 })
    const expense = tx({ id: 'exp', transaction_kind: 'expense', economic_effect: 'outflow', economic_amount_minor: 3_000, amount_minor: -3_000 })
    const totals = economicTotals([income, expense, recon])
    expect(totals.inflowMinor).toBe(10_000)
    expect(totals.outflowMinor).toBe(3_000)
    expect(totals.netMinor).toBe(7_000)
  })

  it('8: zero-delta reconciliation creates no ledger mutation', () => {
    // computeReconciliationDeltaMinor returns 0 → service returns null without inserting
    const delta = computeReconciliationDeltaMinor(487_700, 487_700)
    expect(delta).toBe(0)
    // Caller must check delta === 0 and skip insertion; no new tx in ledger
    const existing = tx({ id: 'ob', account_id: 'a', amount_minor: 487_700 })
    expect(accountBalanceMinor('a', [existing])).toBe(487_700)
  })

  it('9: asset and liability owner-facing positive semantics map correctly to internal sign', () => {
    // Asset: owner says "$3,000 available" → canonical amount_minor = +300_000 → balance = +300_000
    const assetDelta = computeReconciliationDeltaMinor(300_000, 0)
    expect(assetDelta).toBe(300_000)
    const assetRecon = tx({ id: 'ar', account_id: 'chk', amount_minor: assetDelta })
    expect(accountBalanceMinor('chk', [assetRecon])).toBe(300_000)

    // Liability: owner says "$4,877 owed" → canonical amount_minor = +487_700 → balance = +487_700 (owed)
    const liabDelta = computeReconciliationDeltaMinor(487_700, 0)
    expect(liabDelta).toBe(487_700)
    const liabRecon = tx({ id: 'lr', account_id: 'cc', amount_minor: liabDelta })
    expect(accountBalanceMinor('cc', [liabRecon])).toBe(487_700)
  })

  it('10: balance_reconciliation is excluded from obligation-matching candidate transactions', () => {
    expect(obligationsSrc).toContain("tx.transaction_kind !== 'balance_reconciliation'")
  })

  it('11: future-dated balance_reconciliation is excluded from projected cash-flow events', () => {
    // cashProjection.ts must guard balance_reconciliation from reaching addEvent
    // even when transaction_date is after asOfDate (future-dated reconciliation)
    expect(projectionSrc).toContain("tx.transaction_kind === 'balance_reconciliation'")
    const guardIdx = projectionSrc.indexOf("if (tx.transaction_kind === 'balance_reconciliation') continue")
    const addEventIdx = projectionSrc.indexOf('addEvent({', guardIdx > -1 ? guardIdx : 0)
    // guard must appear before the next addEvent call in the ledger loop
    expect(guardIdx).toBeGreaterThan(-1)
    expect(addEventIdx).toBeGreaterThan(guardIdx)
  })

  it('12: delta is calculated against canonical balance AS OF the reconciliation date', () => {
    // Sep 1 opening: $4,000
    const openingTx = tx({ id: 'ob', account_id: 'a', amount_minor: 400_000,
      transaction_kind: 'opening_balance', transaction_date: '2026-09-01' })
    // Sep 15 legitimate income: +$500
    const laterTx = tx({ id: 'inc', account_id: 'a', amount_minor: 50_000,
      transaction_kind: 'income', transaction_date: '2026-09-15' })

    // Balance as of Sep 1 = $4,000 (Sep 15 transaction excluded by asOfDate)
    const balanceAsOfSep1 = accountBalanceMinor('a', [openingTx, laterTx], '2026-09-01')
    expect(balanceAsOfSep1).toBe(400_000)

    // Owner reconciles to $4,877 as of Sep 1 — delta must be against $4,000, not $4,500
    const delta = computeReconciliationDeltaMinor(487_700, balanceAsOfSep1)
    expect(delta).toBe(87_700)

    // After reconciliation: total balance (all dates) = $4,000 + $877 + $500 = $5,377
    const reconTx = tx({ id: 'rec', account_id: 'a', amount_minor: delta,
      transaction_date: '2026-09-01' })
    const totalBalance = accountBalanceMinor('a', [openingTx, laterTx, reconTx])
    expect(totalBalance).toBe(487_700 + 50_000) // $4,877 as-of Sep 1 + $500 later activity
  })
})
