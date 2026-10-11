# Cash OS multi-account integration — implementation ledger

Durable record for resuming this workstream in any session. Newest checkpoints at the bottom of each section. Nothing here is activated or installed in production.

## Baseline verified (session start)

- Repository `main`, local copy was stale (`fe8b671`); fast-forwarded to `origin/main` = `27d1950` (PLAID-1E). No history rewrite.
- `npx tsc --noEmit`: clean. `npx vitest run src/services/bankProvider`: 28 files / 555 tests, all passing (the earlier "583 bank tests" figure includes other bank folders).
- Feature switches (all OFF/unset in production per owner report; not verifiable from this environment): `PLAID_RESUMABLE_SYNC_ENABLED`, `PLAID_ACCOUNT_ADDITIONS_ENABLED`, `PLAID_BACKGROUND_SYNC_ENABLED`, `PLAID_SYNC_AUDIT_ENABLED`.

## Phases

| Phase | Track | Status | Commit | Notes |
|---|---|---|---|---|
| PLAID-1A..1E | D/H | done (earlier) | 28c8efb, 6fbd085, 04d815e, 27d1950 | inactive |
| PLAID-2-RUNBOOK | A | done | 3dc9c55 | `PRODUCTION_RUNBOOK.md`, `scripts/plaid/proposal-evidence.mjs` (hashes, objects, preflight/validation SQL, rollback) |
| PLAID-2A | B | done, inactive | 3dc9c55 | pending→posted link table + decision inheritance (SQL + repo + step hook + `relink_pending`) |
| PLAID-2C | C | done, inactive | 3dc9c55 | hash-chained, trigger-only provider-fact history; 1C apply stamps run provenance |
| PLAID-2E | E | done, switch off | 211b2aa, 24f60d8 | balances from cached `/accounts/get` into the EXISTING snapshot table (no new SQL); card/UI section |
| PLAID-2F | F | done | af776ef | reconciliation engine (transfers, card payments, refunds), wired into the classifier; confirmed pair confirms both legs |
| PLAID-2G | G | done (pure + tests) | af776ef | `consolidatedPosition.ts`; end-to-end no-double-count test over the BANK-6G report |
| PLAID-2H | H | done | d53b929 | blocked-run review + confirmed discard, attention list, freshness |
| Track D | D | no new work needed | — | 1A already covers update mode, preview, duplicate guard, explicit save; remaining steps are owner-gated (see runbook §7) |

## Prepared but UNINSTALLED SQL

| Proposal | File | Suggested migration name | Depends on | Switch |
|---|---|---|---|---|
| PLAID-1B audit (sync_runs half) | docs/plaid1b/sync-audit-proposal.sql | plaid1b_sync_audit | 153-156 | PLAID_SYNC_AUDIT_ENABLED |
| PLAID-1C resumable sync (+1E) | docs/plaid1c/resumable-sync-proposal.sql | plaid1c_resumable_sync | 153-156 | PLAID_RESUMABLE_SYNC_ENABLED |
| PLAID-2A continuity | docs/plaid2/pending-posted-continuity-proposal.sql | plaid2a_pending_posted_continuity | 153-156 | PLAID_PENDING_CONTINUITY_ENABLED |
| PLAID-2C revision history | docs/plaid2/provider-revision-history-proposal.sql | plaid2c_provider_revision_history | 153-156 (1C optional, for run provenance) | none (trigger) |

Hashes: `node scripts/plaid/proposal-evidence.mjs`. 1B's revisions half is superseded by 2C: install 1B only for `financial_provider_sync_runs`, or skip it.

## Owner approval gates (all BLOCKED_PENDING_OWNER_APPROVAL)

1. Install plaid1c SQL → then enable `PLAID_RESUMABLE_SYNC_ENABLED`.
2. Install plaid2a SQL → then enable `PLAID_PENDING_CONTINUITY_ENABLED`; run `relink_pending` once and review non-linked rows.
3. Install plaid2c SQL.
4. Install plaid1b sync_runs (optional) → `PLAID_SYNC_AUDIT_ENABLED`.
5. Enable `PLAID_ACCOUNT_ADDITIONS_ENABLED`; launch Plaid Link update mode for the Wells Fargo Item; save previewed accounts.
6. Never without a separate request: BANK-6H category proposal; repair of migrations 157/158; Netlify upgrade; production sync.

## Tests and measured results

- Baseline `27d1950`: full suite 7,567 tests, 7,517 passed, 48 failed. HEAD: 7,648 tests, 7,599 passed, 47 failed. **No test fails on HEAD that did not fail on the baseline** (same-name comparison; the failures are migration-count guards, auth-store, CASH-8 and similar, all unrelated; one load-sensitive UI test differs between the two concurrent runs).
- `npx tsc --noEmit` clean; `npm run build` passes.
- New suites (PGlite = real PostgreSQL SQL): `plaid2aPendingPostedContinuity` (18), `plaid2cProviderHistory` (9), `plaid2eBalances` (14), `plaid2fReconciliation` (10), `plaid2fExplorerIntegration` (4), `plaid2gConsolidated` (7), `plaid2hAttention` (3), UI `plaid2eBalancesCard` (5), plus additions to `plaid1cResumableSync` (continuity step, blocked-run review) and `bankHandlers`.
- Measured on PGlite (WebAssembly, several times slower than native PostgreSQL): continuity 3,000 pairs in 1.4 s (3 bounded calls), settled re-run 39 ms; history trigger 5,000 changed rows in 11.7 s (≈2.3 ms/row) and chain verification of 5,000 rows 92 ms; reconciliation 6,000 transactions < 3 s (≈0.2 s measured).
- Nothing here is a production verification.

## Checkpoints

1. **3dc9c55** — runbook + 2A + 2C. Decision inheritance is deterministic (Plaid's pending_transaction_id inside one Item), same account and direction only, ambiguity (two posted claim one pending) and mismatches inherit nothing, never overwrites a confirmed decision or a newer owner decision/undo, idempotent, bounded per call. History: tamper test proves the server role cannot insert/update/delete/truncate and that edits/deletions made by someone who disables triggers are detected by the chain verifier.
2. **211b2aa** — balances. Bank cash / card owed / unused credit are separate fields by construction; `availableMinor` is null when the bank did not report it; freshness uses the bank's timestamp when sane; exact cents or the account reading is rejected; duplicate bank timestamps are ignored; no ledger/account/mapping write (asserted by row counts).
3. **af776ef** — reconciliation + consolidated position. Replaces the old greedy equal-amount pairing (which could pair arbitrarily when several movements matched). Behaviour change to note: ambiguous groups are now low-confidence "pick the right ones" instead of an arbitrary pair; a refund inflow gets a *refund* suggestion (never income); confirmed transfer decisions that name a counterpart now confirm the other leg in the Explorer too.
4. **d53b929** — operations: a blocked run is visible with counts, can be discarded only with the named run id and the typed word DISCARD; an attention list orders actions > warnings > info.

## Remaining blockers and risks

- **RUN_TOO_LARGE has no in-app exit that makes the update fit.** Discarding re-fetches the same update and stops at the 50,000-row cap again. Raising the cap is a separate owner-approved SQL change (the cap is the default of `financial_provider_sync_stage_page`) and must be re-measured against the 8 s statement timeout.
- **2C trigger cost** adds ≈2 ms per *changed* row on PGlite. A pathological update that modifies tens of thousands of existing rows could now exceed the statement timeout; it would be rolled back and blocked for review (safe), never half-applied. Normal syncs change tens of rows.
- Continuity runs after a committed apply and is re-runnable; if a request ends first, run `relink_pending` (also bounded). Late owner decisions on a pending row are picked up for 14 days after linking.
- Pending/posted ids are only linked when Plaid supplies `pending_transaction_id`. There is deliberately no fuzzy fallback.
- Reconciliation pairs only within the data loaded (Explorer window) and only posted-with-posted / pending-with-pending; a payment to a card that is **not connected** is a one-sided hint, not a pair.
- Balances come from Plaid's cached `/accounts/get`; real-time `/accounts/balance/get` is billed per call and is intentionally not used. Banks may return stale cached numbers; the UI shows the bank's own timestamp and freshness.
- `plaid-balances` is a new routed Netlify function (deployed, refuses everything unless `PLAID_BALANCES_ENABLED=true`).
- Not verifiable here: Netlify plan/limits, production env flags, production catalog state (the preflight SQL in the runbook checks it).
- Wells Fargo may show Account Select regardless of the update-mode flag; previously shared accounts must stay selected (PLAID-1A note).
- Not built (out of safe scope): a UI to confirm/reject reconciliation pairs beyond the existing Smart Review/Explorer decision actions; a dated per-day balance history chart; manual-ledger comparison fed from the live ledger (the function accepts it; no caller wires it yet).

## Estimated completion of the full multi-account scope

Code complete and tested for tracks A–H except the owner-gated activation and the items above. Roughly **80–85%**: the remaining ~15–20% is production installation/validation (nothing proven in production), observing what Plaid actually returns for the new Wells Fargo accounts, wiring the live ledger into the consolidated position, and a pair-review UI.

