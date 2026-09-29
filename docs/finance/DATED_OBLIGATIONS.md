# CASH-3 Dated Obligations and Cash Commitments

CASH-3 adds future planned outflows without polluting the actual CASH-2 ledger.

## Core boundary

A future bill is **not** a draft `financial_transaction`.

- CASH-2 = actual/manual account movements.
- CASH-3 = planned future outflows.
- Reconciliation links one planned item to one actual posted CASH-2 transaction.
- The reconciliation row stores no monetary amount, so it cannot double-count expense.

## Recurring obligations

`financial_obligations` stores a recurrence rule, integer-cent amount, fixed/estimated certainty, required/optional planning treatment, confidence, attribution, and lifecycle.

Supported recurrence:
- weekly
- every N weeks
- monthly
- yearly

Due dates are calendar dates. Monthly anchors clamp to the last valid day in short months. A Feb 29 yearly anchor clamps to Feb 28 in non-leap years.

Paused, canceled, and archived rules generate no new planned events.

## Bounded occurrence strategy

Ordinary recurring dates are generated only for the requested read horizon. The database does not materialize an infinite schedule.

`financial_obligation_occurrences` exists only for exceptions/state such as:
- date override
- amount override
- skip/cancel
- explicit reconciliation target

## One-time commitments

`cash_commitments` represents dated one-time planned cash needs such as project material, permits, registration, or other known payments.

Required/optional and confirmed/expected/possible are independent dimensions.

## Reconciliation

CASH-3 V1 uses explicit full-payment reconciliation:
- one planned item to one actual transaction
- one actual transaction to one planned item
- actual must be posted
- opening balances and transfers cannot satisfy an obligation
- amount must match exact cents
- no partial/variance matching in V1

Satisfied planned items contribute zero future planned outflow; the actual ledger transaction remains the only economic/account movement.

## Legacy overhead

`settings.overhead` is not auto-imported. `owner_reviewed_overhead` provenance exists for a future explicit owner-reviewed conversion only.

## Deferred decisions

- canonical organization financial timezone when calendar dates must become timestamps
- partial/variance reconciliation policy
- standardized category taxonomy
- default protection/planning horizons for CASH-4/CASH-7
