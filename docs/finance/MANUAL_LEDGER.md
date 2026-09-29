# CASH-2 Manual Ledger

CASH-2 introduces organization-scoped financial accounts and a manual ledger.

## Accounts

`financial_accounts` stores account identity and owner-selected cash inclusion. Balances are derived from transactions; there is no editable current-balance column.

- Assets: checking, savings, cash, other asset.
- Liabilities: credit card, loan, other liability.
- Business/personal is an explicit dimension.
- Only active asset accounts with `include_in_cash=true` contribute to Total Cash.

## Transactions

`financial_transactions.amount_minor` is signed integer cents.

Opening balances, internal transfers, and card/debt payments have zero economic effect. They move account balances without manufacturing income or expense.

Income and expense carry a separate unsigned `economic_amount_minor` so reporting meaning is not inferred from liability-account signs.

Posted facts are immutable. Corrections use void/reversal behavior rather than rewriting posted history.

## Opening balances

An opening balance is a posted ledger transaction with `economic_effect='none'`. It affects account balance and as-of cash, but never income.

Only one non-voided opening balance is permitted per account.

## Paired movements

`record_financial_transfer` creates an atomic source/target pair and a confirmed `transfer_pair` link.

`record_financial_card_payment` creates the cash-side and liability-side movement and a confirmed `card_debt_payment_pair` link.

Confirmed pairs are one lifecycle unit. One-sided voiding is rejected. `void_financial_transaction_pair` voids exactly two transactions and preserves the link for audit history.

## Security

All Cash ledger tables have RLS enabled. Authenticated access requires the caller to be an active owner/admin of the same organization. The mutation RPCs are `SECURITY INVOKER` and PUBLIC/anon execution is revoked.

## Deferred runtime gate

`PAIR-VOID-RUNTIME-SMOKE` remains a release gate before any owner-facing UI exposes pair voiding. The final implementation has static/live schema evidence and one-sided void rejection was proven against PostgreSQL; the post-fix atomic void + replay path still requires a representative owner/admin runtime smoke.
