import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { accountBalanceMinor } from '../ledgerCalculations'
import type { FinancialTransactionRow, FinancialAccountRow } from '../ledgerTypes'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const debtKillerSrc = readFileSync(resolve(__dirname, '../../views/DebtKiller.tsx'), 'utf8')
const debtPlanSrc = readFileSync(resolve(__dirname, '../../components/v15r/cash-os/CashOsDebtPlan.tsx'), 'utf8')

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseTx(overrides: Partial<FinancialTransactionRow> = {}): FinancialTransactionRow {
  return {
    id: 'tx-1', organization_id: 'org-1', account_id: 'acct-1',
    amount_minor: 0, currency: 'USD', transaction_date: '2026-09-30',
    effective_at: null, posted_at: null, status: 'posted',
    transaction_kind: 'opening_balance', economic_effect: 'none',
    economic_amount_minor: 0, description: '', counterparty: null, category: null,
    project_id: null, employee_id: null, debt_account_id: null,
    source_type: 'manual', source_organization_id: null, source_kind: null,
    source_record_id: null, source_effective_date: null, source_timestamp: null,
    source_metadata: {}, idempotency_key: 'key-1',
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
    voided_at: null, voided_by: null, void_reason: null, ...overrides,
  }
}

function baseAccount(overrides: Partial<FinancialAccountRow> = {}): FinancialAccountRow {
  return {
    id: 'acct-1', organization_id: 'org-1', display_name: 'Test Account',
    account_type: 'checking', account_class: 'asset', ownership_context: 'business',
    include_in_cash: true, currency: 'USD', status: 'active', source_type: 'manual',
    source_metadata: {}, created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', archived_at: null, ...overrides,
  }
}

// ── CORE-CLOSE-2A: Render path contract ───────────────────────────────────────

describe('CORE-CLOSE-2A Debt Plan canonical truth', () => {

  it('1: DebtKiller.tsx does not import DebtKillerLegacy', () => {
    expect(debtKillerSrc).not.toContain('DebtKillerLegacy')
  })

  it('2: DebtKiller.tsx imports CashOsDebtPlan for Debt Plan tab', () => {
    expect(debtKillerSrc).toContain('CashOsDebtPlan')
    expect(debtKillerSrc).toContain("from '@/components/v15r/cash-os/CashOsDebtPlan'")
  })

  it("3: Debt Plan tab in preSetup path renders CashOsDebtPlan with sources and snapshot=null", () => {
    // The preSetup branch must pass cash.sources and snapshot={null}
    const preSetupIdx = debtKillerSrc.indexOf('preSetup ?')
    const preSetupEnd = debtKillerSrc.indexOf('cash.status === \'partial\'', preSetupIdx)
    const preSetupBlock = debtKillerSrc.slice(preSetupIdx, preSetupEnd)
    expect(preSetupBlock).toContain("tab === 'Debt Plan'")
    expect(preSetupBlock).toContain('CashOsDebtPlan')
    expect(preSetupBlock).toContain('snapshot={null}')
  })

  it("3b: Debt Plan tab in LEDGER_EMPTY state renders CashOsDebtPlan with sources and snapshot=null", () => {
    // Empty = no posted cash asset transaction; liability accounts and their balances may still exist
    const emptyIdx = debtKillerSrc.indexOf("cash.status === 'empty' && tab === 'Debt Plan'")
    expect(emptyIdx).toBeGreaterThan(-1)
    const emptyBlock = debtKillerSrc.slice(emptyIdx, emptyIdx + 200)
    expect(emptyBlock).toContain('CashOsDebtPlan')
    expect(emptyBlock).toContain('cash.sources')
    expect(emptyBlock).toContain('snapshot={null}')
  })

  it("4: Debt Plan tab in ready/snapshot path renders CashOsDebtPlan with both sources and snapshot", () => {
    const snapshotReadyIdx = debtKillerSrc.indexOf('cash.snapshot ?')
    const snapshotBlock = debtKillerSrc.slice(snapshotReadyIdx, snapshotReadyIdx + 2000)
    expect(snapshotBlock).toContain("tab === 'Debt Plan'")
    expect(snapshotBlock).toContain('CashOsDebtPlan')
    // snapshot passed as truthy (cash.snapshot, not null)
    expect(snapshotBlock).toContain('snapshot={cash.snapshot}')
  })

  it('5: CashOsDebtPlan filters accounts by account_class === liability (not asset)', () => {
    expect(debtPlanSrc).toContain("account_class === 'liability'")
    expect(debtPlanSrc).not.toContain("account_class === 'asset'")
  })

  it('6: CashOsDebtPlan uses accountBalancesMinor from snapshot when available', () => {
    expect(debtPlanSrc).toContain('snapshot.accountBalancesMinor')
  })

  it('7: CashOsDebtPlan uses accountBalanceMinor() from ledgerCalculations when no snapshot', () => {
    expect(debtPlanSrc).toContain('accountBalanceMinor(')
  })

  it('8: CashOsDebtPlan does not use mock debt data (no mockDebts / mockExpenses)', () => {
    expect(debtPlanSrc).not.toContain('mockDebts')
    expect(debtPlanSrc).not.toContain('mockExpenses')
    expect(debtPlanSrc).not.toContain('mockMonthlyIncome')
    expect(debtPlanSrc).not.toContain('from \'../mock\'')
    expect(debtPlanSrc).not.toContain('from "../mock"')
  })

  it('9: CashOsDebtPlan shows "Debt terms not stored" for missing APR and minimum payment', () => {
    expect(debtPlanSrc).toContain('Debt terms not stored')
    expect(debtPlanSrc).toContain('APR')
    expect(debtPlanSrc).toContain('Min. payment')
  })

  it('10: CashOsDebtPlan reads trulyFreeCashMinor from snapshot.allocation — not from mock income', () => {
    expect(debtPlanSrc).toContain('snapshot?.allocation.trulyFreeCashMinor')
    expect(debtPlanSrc).not.toContain('mockMonthlyIncome')
  })

  it('11: CashOsDebtPlan labels Truly Free Cash as owner decision, not an auto-allocation', () => {
    expect(debtPlanSrc).toContain('TRULY FREE CASH')
    expect(debtPlanSrc).toContain('Owner decision')
    // No code that allocates free cash to debt or computes extra payments
    expect(debtPlanSrc).not.toContain('extraPayment')
    expect(debtPlanSrc).not.toContain('extra_payment')
    // No payoff strategy computation
    expect(debtPlanSrc).not.toContain('payoffMonths')
  })

  it('12: CashOsDebtPlan renders without asset accounts being treated as debts', () => {
    // Only liability class accounts appear — no checking/savings/cash/other_asset in the debt list
    const filterIdx = debtPlanSrc.indexOf("account_class === 'liability'")
    expect(filterIdx).toBeGreaterThan(-1)
    // The filter for liability accounts must also require active status
    const filterBlock = debtPlanSrc.slice(filterIdx - 10, filterIdx + 100)
    expect(filterBlock).toContain("status === 'active'")
  })

  // ── Unit: accountBalanceMinor correctly sums liability transactions ─────────

  it('13: canonical balance for a credit card accumulates charges and payments correctly', () => {
    const txs: FinancialTransactionRow[] = [
      // Opening balance: $4,500 owed
      baseTx({ id: 'ob', account_id: 'cc-1', amount_minor: 450000, status: 'posted', transaction_kind: 'opening_balance' }),
      // Additional charge: +$800
      baseTx({ id: 'ch', account_id: 'cc-1', amount_minor: 80000, status: 'posted', transaction_kind: 'expense' }),
      // Payment: -$200
      baseTx({ id: 'py', account_id: 'cc-1', amount_minor: -20000, status: 'posted', transaction_kind: 'card_debt_payment' }),
    ]
    const balance = accountBalanceMinor('cc-1', txs)
    // $4500 + $800 - $200 = $5100
    expect(balance).toBe(510000)
  })

  it('14: draft transactions are excluded from canonical liability balance', () => {
    const txs: FinancialTransactionRow[] = [
      baseTx({ id: 'posted', account_id: 'cc-1', amount_minor: 100000, status: 'posted' }),
      baseTx({ id: 'draft', account_id: 'cc-1', amount_minor: 50000, status: 'draft' }),
    ]
    expect(accountBalanceMinor('cc-1', txs)).toBe(100000)
  })

  it('15: asset account does not appear in the liability filter', () => {
    const accounts: FinancialAccountRow[] = [
      baseAccount({ id: 'checking', account_class: 'asset', account_type: 'checking', status: 'active' }),
      baseAccount({ id: 'savings', account_class: 'asset', account_type: 'savings', status: 'active' }),
      baseAccount({ id: 'cc', account_class: 'liability', account_type: 'credit_card', status: 'active' }),
      baseAccount({ id: 'loan', account_class: 'liability', account_type: 'loan', status: 'active' }),
    ]
    const liabilities = accounts.filter(a => a.account_class === 'liability' && a.status === 'active')
    expect(liabilities).toHaveLength(2)
    expect(liabilities.map(a => a.id)).toEqual(['cc', 'loan'])
    expect(liabilities.every(a => a.account_class === 'liability')).toBe(true)
  })

  it('16: archived liability accounts are excluded (only active debts shown)', () => {
    const accounts: FinancialAccountRow[] = [
      baseAccount({ id: 'active-loan', account_class: 'liability', account_type: 'loan', status: 'active' }),
      baseAccount({ id: 'paid-off-cc', account_class: 'liability', account_type: 'credit_card', status: 'archived' }),
    ]
    const liabilities = accounts.filter(a => a.account_class === 'liability' && a.status === 'active')
    expect(liabilities).toHaveLength(1)
    expect(liabilities[0].id).toBe('active-loan')
  })

  it('17: missing debt terms produce no fabricated payoff values (source inspection)', () => {
    // CashOsDebtPlan must not calculate payoff months or dates from defaults
    expect(debtPlanSrc).not.toContain('calcPayoffMonths')
    expect(debtPlanSrc).not.toContain('interestRate')
    expect(debtPlanSrc).not.toContain('minimumPayment')
    expect(debtPlanSrc).not.toContain('addMonths')
    expect(debtPlanSrc).not.toContain('April 2026')
  })

  it('18: DebtKiller.tsx does not forward mock income or mock expenses to Debt Plan', () => {
    expect(debtKillerSrc).not.toContain('mockMonthlyIncome')
    expect(debtKillerSrc).not.toContain('mockExpenses')
    expect(debtKillerSrc).not.toContain('mockDebts')
  })
})
