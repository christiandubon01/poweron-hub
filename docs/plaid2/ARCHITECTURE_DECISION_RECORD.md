# ADR — Cash OS premium integration (reconciliation, match review, consolidated position)

Status: accepted for implementation (PLAID-3A … 3D). Baseline: `main` @ `d460b43`. Nothing in this ADR is installed or switched on in production.
Written **before** the implementation, from the code as it actually is, not from the previous ledger.

## 1. What was verified against the repository (not taken from the previous report)

| Previous claim | Result | Evidence |
|---|---|---|
| Track A runbook + hashes | true | `docs/plaid2/PRODUCTION_RUNBOOK.md`, `scripts/plaid/proposal-evidence.mjs` runs |
| Track B pending→posted continuity | true, **inert until SQL installed** and `PLAID_PENDING_CONTINUITY_ENABLED` | function lives only in the uninstalled proposal; hook is flag-guarded; 18 PGlite tests |
| Track C provider history | true, inert until SQL installed | proposal only; 9 PGlite tests |
| Track D account additions | true (PLAID-1A), flag-guarded | no new work needed |
| Track E balances | true, flag-guarded (`PLAID_BALANCES_ENABLED`), server-gated endpoint | `plaid-balances.ts` refuses when off |
| Track F reconciliation "switch off" | **FALSE.** The new engine replaced the legacy pairing **unconditionally** in `classifier.ts`, the refund suggestion in `inflowBucketFor`, and the confirmed-pair mirroring in `explorer.ts`. It is live in Explorer, Smart Review, batch approval, accept/reject suggestion, merchant explorer and BANK-6G reports the moment `main` deploys | `git diff 27d1950..d460b43 -- spending/` |
| Track G consolidated position "done" | partly. It is a pure module with **no data path**, and its `income` line is the 6G `income` activity, which contains **every unclassified deposit** (violates correctness rules D/E) | `activityOf()` → `money_in` ⇒ `income` unless the bucket is a *confirmed* refund |
| Track H blocked-run review | true (needs the 1C SQL to ever see a blocked run) | tests in `plaid1cResumableSync` |

Baseline tests at `d460b43` (full suite, recorded in the ledger): 7,648 tests, 7,598 passed, 48 failed. The 48 are the pre-existing set (auth-store, migration-count guards, CASH-8, scope-pack composer — the last is load-sensitive). None touches Cash OS bank code.

## 2. The real data flow and the source of truth at each stage

```
Plaid /transactions/sync                      SOURCE: Plaid (fact as reported)            never edited
  │  resumableSyncStep → stage → apply (one SQL transaction with the cursor)
  ▼
financial_provider_transactions (+accounts)   SOURCE OF TRUTH: provider EVIDENCE          append/update-in-place by sync only;
  │  pending row ──(Plaid pending_transaction_id)──▶ posted row; pending row gets removed_at   history: 2C (uninstalled)
  │  identity = (provider_item_ref, provider_transaction_id); internal id = uuid `id`
  ▼
financial_provider_interpretations            SOURCE OF TRUTH: OWNER DECISIONS             rows are never deleted; undo = status
  kinds: category | transfer | obligation | project | debt | payroll | overhead | personal | ignored
  status: suggested | confirmed | rejected | undone       one ACTIVE row per (tx, kind) and one ACTIVE relationship per tx
  ▼
spending/classifier.ts + explorer.ts          DERIVED, recomputed on every request, never stored
  evidence + decisions + merchant rules + known bills  ──▶  one suggestion per dimension per transaction
  ▼
ExplorerRow.{bucket, relationship, review, scope, unassigned}    DERIVED view of the three independent dimensions
  ▼
Consumers (all call explorerFromContext → buildRows):
  getExplorer · getSmartReview · confirm_batch · accept/reject_suggestion · merchantExplorer (6H) · getSpendingReport (6G, via buildSpendingReport/activityOf)
  ▼
UI: SpendingExplorer · SmartReview · SpendingReports · TransactionDetail · BankConnectionCard

Cash OS ledger (financial_accounts, financial_transactions)   SOURCE OF TRUTH: MANUAL LEDGER (signed minor units; liability + = owed)
  browser-side: readCashOsSources → buildCashOsSnapshot → accountBalancesMinor      Never written by bank code.
Provider balances (financial_provider_balance_snapshots)      SOURCE: Plaid cached balances; append-only; flag-guarded
```

Identities: Plaid transaction id (stable) → `financial_provider_transactions.id` (uuid, what decisions point at). Account: Plaid account id → `financial_provider_accounts.id` → optional **owner mapping** → `financial_accounts.id` (ownership business/personal comes only from the mapped Cash OS account).

Aggregation rules that already exist and are preserved (BANK-6G `activityOf`): ignored → `ignored`; confirmed transfer **with a counterpart** → `transfer`; confirmed debt → `debt`; money out in a personal-scoped account or owner draw → `personal`; money in → `refund` only if the *confirmed* bucket is refund, else `income` (a **cash-movement** label, "Money in"); money out in a business-scoped account → `business` (scope can come from the account default); anything with a suggested transfer/debt, or no scope → `unresolved`. Pending and removed rows are excluded from every money total.

## 3. Paths that can silently change financial meaning (findings, with evidence)

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| F1 | **Rejecting a paired transfer suggestion does not stick** in the legacy engine: the rejection key omits the counterpart, so the suggestion re-appears (`transfer/suggested/high`) | scratch probe on the frozen `27d1950` classifier | Fixed **only behind the new switch** (pair-level, fingerprint-aware rejection). Switch OFF keeps legacy exactly, defect included — documented |
| F2 | Legacy pairing is greedy: with 2 outflows and 1 inflow of the same amount it pairs the first and silently leaves the other unmatched | probe | New engine (switch ON) reports the whole group as ambiguous |
| F3 | The BANK-6G report source RPC returns accounts **without provider type/subtype**, so on the report path the new engine cannot tell a card purchase from a transfer leg and behaves like the legacy one (Explorer ≠ Report for the same data) | `bank_spending_report_source` in `docs/bank6g/hierarchy-proposal.sql`; probe | Enrich report-path accounts from `financial_provider_accounts` (existing columns, org-scoped read, no SQL). Unknown class ⇒ never `high`, never a card payment |
| F4 | New engine, mirror and refund suggestion were live without any switch | diff | Switch `CASH_OS_RECONCILIATION_ENABLED`, default OFF, enforced at the classifier/explorer boundary |
| F5 | A one-leg confirmed transfer was mirrored to the other leg only in the Explorer; switching the feature off would silently flip the other leg back to "unresolved" | `explorer.ts` mirror block | Pair confirmation now writes **both legs** as ordinary interpretation rows, so meaning survives a rollback of the switch. Mirroring remains only for legacy single-leg decisions and only when ON |
| F6 | Position `income` included unclassified deposits | `activityOf` | Position recomputed from rows: income = owner-confirmed customer payments only; everything else money-in is shown as *not yet income* |
| F7 | `loadContext` caps evidence at 5,000 rows per request; a leg beyond the cap looks "unmatched" | `spendingRepo.pageAll` | Match review prefers the complete report source and always surfaces coverage; incomplete ⇒ no confident claims at the edges |
| F8 | A confirmed pair whose evidence later changed (amount modified, leg removed) kept its meaning with no signal | no code path | Evidence fingerprint stored with the decision; changed ⇒ state "Evidence changed", still honored for reports (owner precedence) but flagged |
| F9 | Cross-scope pairs (business ↔ personal account) looked like ordinary transfers although the business meaning is an owner draw/contribution | engine had no ownership input | `crossScope` flag: confidence capped at *possible*, explanation shown, never auto-resolved |

## 4. Decisions

**ADR-1 — The reconciliation switch lives at the calculation boundary.** `CASH_OS_RECONCILIATION_ENABLED` (server env, exactly `"true"`, default off) is read once in the Netlify handler, carried as `deps.reconciliationEnabled`, and stamped onto every loaded context by one helper. `classifyAll`/`buildRows` take an explicit `reconciliation` option that defaults to **false**, in which case the legacy code path (restored verbatim from `27d1950`) runs. A differential test replays hundreds of randomized scenarios against a frozen copy of the `27d1950` classifier+explorer and requires deep equality with the switch OFF. The browser can never set it.

**ADR-2 — The unit of owner review is the pair; persistence reuses `financial_provider_interpretations`.** Confirm = two `transfer` rows (each leg points at the other), reject = one `transfer`/`rejected` row on the outflow leg, reverse = both confirmed rows → `undone`. All three happen inside **one** SQL function (`financial_provider_decide_match`, proposal `plaid3b`, **uninstalled**) that locks both evidence rows, re-validates org, sign, amount, accounts, kind and the evidence fingerprint, and refuses to override another owner decision. No new table; existing unique indexes give leg exclusivity (each leg always has its own active row). Reports keep reading interpretation rows only, so a rollback of the switch cannot change a confirmed pair. The feature is **inactive until the SQL is installed** (capability probe, same pattern as BANK-6H).

**ADR-3 — Impact preview before activation.** A read-only owner action computes the classification of every row with the switch OFF and ON and lists the differences (counts and amounts per activity). This is the evidence for the GO decision and is available while the switch is OFF.

**ADR-4 — The consolidated position is composed on the server from existing services and merged with the manual ledger in the browser by a pure function.** Provider balances (`getBalances`), report rows (`explorerFromContext`), sync state, and the Cash OS snapshot's ledger balances. Every figure carries a provenance (`provider_reported | derived_from_transactions | owner_classified | manual_ledger | unavailable`). There is no profit figure and no net-cash figure. Bank cash is never reduced by card debt; unused credit is never cash; an incomplete or stale set of balances makes the total *incomplete*, not "current". Gated by `CASH_OS_POSITION_ENABLED` (default off) at the endpoint.

**ADR-5 — Conservative engine rules (switch ON).** Posted-with-posted only for confirmation; legs already decided by the owner (relationship, ignore, non-transfer category) are excluded; ambiguity ⇒ review, never a guess; unknown account class, cross-scope, or beyond-3-day gaps ⇒ never `high`; a rejected pair stays suppressed in every computation and is re-offered **only** on the review screen when its evidence fingerprint changed, labeled "Evidence changed".

**ADR-6 — No SQL is required for anything except pair persistence.** Report-path enrichment, impact preview, position, flags and UI work on the schema already in production. Everything else uses prepared-but-uninstalled proposals listed in the ledger.

## 5. Non-goals

QuickBooks, payroll, taxes, forecasting, automatic money movement, any production change, any redesign of existing Cash OS screens, replacing the category tree, or changing BANK-6G report semantics.

## 6. Verification plan

Differential parity (switch OFF), lifecycle tests on real SQL (PGlite) and on a scratch native PostgreSQL 16 (true multi-connection races), organization/employee/privilege denial tests, end-to-end double-counting scenarios, UI tests at mobile and desktop widths, benchmarks on multi-account fixtures, four documented review passes (financial, security, failure, UX), full-suite comparison against `d460b43`.
