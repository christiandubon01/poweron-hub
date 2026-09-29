import type { FinancialAccountRow, FinancialTransactionRow } from './ledgerTypes'

export function postedTransactions(
  rows: readonly FinancialTransactionRow[],
): FinancialTransactionRow[] {
  return rows.filter((row) => row.status === 'posted')
}

export function accountBalanceMinor(
  accountId: string,
  rows: readonly FinancialTransactionRow[],
  asOfDate?: string,
): number {
  return rows.reduce((sum, row) => {
    if (row.account_id !== accountId || row.status !== 'posted') return sum
    if (asOfDate && row.transaction_date > asOfDate) return sum
    return sum + row.amount_minor
  }, 0)
}

export function totalCashMinor(
  accounts: readonly FinancialAccountRow[],
  transactions: readonly FinancialTransactionRow[],
  asOfDate?: string,
): number {
  return accounts
    .filter((account) =>
      account.status === 'active' &&
      account.account_class === 'asset' &&
      account.include_in_cash,
    )
    .reduce(
      (sum, account) => sum + accountBalanceMinor(account.id, transactions, asOfDate),
      0,
    )
}

export interface EconomicTotals {
  inflowMinor: number
  outflowMinor: number
  netMinor: number
}

export function economicTotals(
  rows: readonly FinancialTransactionRow[],
  options?: { startDate?: string; endDate?: string },
): EconomicTotals {
  let inflowMinor = 0
  let outflowMinor = 0
  for (const row of rows) {
    if (row.status !== 'posted') continue
    if (options?.startDate && row.transaction_date < options.startDate) continue
    if (options?.endDate && row.transaction_date > options.endDate) continue
    if (row.economic_effect === 'inflow') inflowMinor += row.economic_amount_minor
    if (row.economic_effect === 'outflow') outflowMinor += row.economic_amount_minor
  }
  return { inflowMinor, outflowMinor, netMinor: inflowMinor - outflowMinor }
}

export function isEconomicNeutralTransaction(row: FinancialTransactionRow): boolean {
  return row.economic_effect === 'none' && row.economic_amount_minor === 0
}
