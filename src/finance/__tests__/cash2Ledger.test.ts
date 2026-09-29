import { describe, expect, it } from 'vitest'
import { accountBalanceMinor, economicTotals, isEconomicNeutralTransaction, totalCashMinor } from '../ledgerCalculations'
import type { FinancialAccountRow, FinancialTransactionRow } from '../ledgerTypes'

function account(overrides: Partial<FinancialAccountRow>): FinancialAccountRow {
  return {
    id: 'a',
    organization_id: 'org',
    display_name: 'Checking',
    account_type: 'checking',
    account_class: 'asset',
    ownership_context: 'business',
    include_in_cash: true,
    currency: 'USD',
    status: 'active',
    source_type: 'manual',
    source_metadata: {},
    created_at: '2026-09-29T00:00:00Z',
    updated_at: '2026-09-29T00:00:00Z',
    archived_at: null,
    ...overrides,
  }
}

function tx(overrides: Partial<FinancialTransactionRow>): FinancialTransactionRow {
  return {
    id: 't',
    organization_id: 'org',
    account_id: 'a',
    amount_minor: 100,
    currency: 'USD',
    transaction_date: '2026-09-29',
    effective_at: null,
    posted_at: '2026-09-29T00:00:00Z',
    status: 'posted',
    transaction_kind: 'income',
    economic_effect: 'inflow',
    economic_amount_minor: 100,
    description: '',
    counterparty: null,
    category: null,
    project_id: null,
    employee_id: null,
    debt_account_id: null,
    source_type: 'manual',
    source_organization_id: null,
    source_kind: null,
    source_record_id: null,
    source_effective_date: null,
    source_timestamp: null,
    source_metadata: {},
    idempotency_key: 'k',
    created_at: '2026-09-29T00:00:00Z',
    updated_at: '2026-09-29T00:00:00Z',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...overrides,
  }
}

describe('CASH-2 ledger calculations', () => {
  it('derives account balance from posted movements', () => {
    expect(accountBalanceMinor('a', [tx({ amount_minor: 1000 }), tx({ id: 't2', amount_minor: -250 })])).toBe(750)
  })

  it('ignores voided movements', () => {
    expect(accountBalanceMinor('a', [tx({ status: 'voided', amount_minor: 1000 })])).toBe(0)
  })

  it('supports as-of account balance', () => {
    expect(accountBalanceMinor('a', [
      tx({ amount_minor: 1000, transaction_date: '2026-09-29' }),
      tx({ id: 'later', amount_minor: 500, transaction_date: '2026-10-01' }),
    ], '2026-09-29')).toBe(1000)
  })

  it('includes active opted-in personal asset accounts in Total Cash', () => {
    expect(totalCashMinor(
      [account({ id: 'p', ownership_context: 'personal', include_in_cash: true })],
      [tx({ account_id: 'p', amount_minor: 4000 })],
    )).toBe(4000)
  })

  it('excludes assets not opted into Total Cash', () => {
    expect(totalCashMinor(
      [account({ id: 'p', ownership_context: 'personal', include_in_cash: false })],
      [tx({ account_id: 'p', amount_minor: 4000 })],
    )).toBe(0)
  })

  it('excludes liability accounts from Total Cash', () => {
    expect(totalCashMinor(
      [account({ id: 'l', account_type: 'loan', account_class: 'liability', include_in_cash: false })],
      [tx({ account_id: 'l', amount_minor: 4000 })],
    )).toBe(0)
  })

  it('opening balance is economically neutral', () => {
    expect(isEconomicNeutralTransaction(tx({
      transaction_kind: 'opening_balance',
      economic_effect: 'none',
      economic_amount_minor: 0,
    }))).toBe(true)
  })

  it('transfer legs are economically neutral', () => {
    expect(isEconomicNeutralTransaction(tx({
      transaction_kind: 'transfer',
      economic_effect: 'none',
      economic_amount_minor: 0,
    }))).toBe(true)
  })

  it('card/debt payment legs are economically neutral', () => {
    expect(isEconomicNeutralTransaction(tx({
      transaction_kind: 'card_debt_payment',
      economic_effect: 'none',
      economic_amount_minor: 0,
    }))).toBe(true)
  })

  it('economic totals do not count neutral account movements', () => {
    const result = economicTotals([
      tx({ economic_effect: 'inflow', economic_amount_minor: 5000 }),
      tx({ id: 'e', economic_effect: 'outflow', economic_amount_minor: 2000 }),
      tx({ id: 'x', transaction_kind: 'transfer', economic_effect: 'none', economic_amount_minor: 0 }),
    ])
    expect(result).toEqual({ inflowMinor: 5000, outflowMinor: 2000, netMinor: 3000 })
  })
})
