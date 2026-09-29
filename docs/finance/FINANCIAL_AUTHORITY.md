# Financial Authority Contract

CASH-1 establishes the financial source-of-truth boundary for PowerOn Hub.

## Canonical rules

- Money is represented in integer USD cents.
- Project collections come from live project payment/log evidence, not a second header total.
- Service collections come from the append-only `payments[]` event ledger when present. Legacy scalar `collected` is compatibility fallback only.
- Project actual costs and estimate/planned costs are separate concepts.
- Paid time-entry minutes are payroll quantity truth. Work sessions may add attribution/context, but never a second quantity.
- Employee identity joins use stable IDs; names are display values, never financial identity.
- `settings.overhead` is an assumption source, not bank-transaction truth.
- Normalized payment tables are potential overlap until reconciled.
- Debt Killer mock/localStorage state is explicitly non-canonical.
- CASH-2 `financial_transactions` is canonical account-movement truth once an entry is explicitly recorded/reconciled.
- CASH-3 obligations and commitments are canonical planned-outflow inputs, not actual account movements.

## No double counting

Attribution is dimensional metadata. A single monetary liability may be visible by project, employee, payroll, calendar, or debt dimensions, but it remains one financial event.

A future planned outflow becomes actual only through explicit reconciliation to one CASH-2 transaction. Reconciliation itself carries no second amount.
