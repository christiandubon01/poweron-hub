-- CORE-CLOSE-2B1: balance_reconciliation transaction kind
-- Adds a ledger-only kind for owner-facing balance establishment and reconciliation.
-- economic_effect is always 'none', economic_amount_minor is always 0.
-- Excluded from all income/expense/transfer/payment accounting downstream.
-- Multiple balance_reconciliation entries are allowed per account (no unique constraint).

ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_transaction_kind_check;

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_transaction_kind_check CHECK (transaction_kind IN (
    'opening_balance', 'income', 'expense', 'transfer', 'card_debt_payment',
    'refund_reversal', 'adjustment', 'balance_reconciliation'
  ));

ALTER TABLE public.financial_transactions
  DROP CONSTRAINT IF EXISTS financial_transactions_kind_effect;

ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_kind_effect CHECK (
    (transaction_kind IN (
        'opening_balance', 'transfer', 'card_debt_payment', 'balance_reconciliation'
      ) AND economic_effect = 'none' AND economic_amount_minor = 0) OR
    (transaction_kind = 'income'  AND economic_effect = 'inflow'  AND economic_amount_minor > 0) OR
    (transaction_kind = 'expense' AND economic_effect = 'outflow' AND economic_amount_minor > 0) OR
    transaction_kind IN ('refund_reversal', 'adjustment')
  );
