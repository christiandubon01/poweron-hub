# Cash OS premium integration: session handoff (emergency checkpoint)

Written at the owner's request as a checkpoint before the session limit. **Nothing in production was installed, enabled, synced or modified.** Every new financial behavior is behind a switch that is OFF by default.

- Repository: `christiandubon01/poweron-hub`, branch `main`.
- Starting commit: `d460b43`.
- Last implementation commit (before this handoff): `9205343`. The handoff commit is the next commit on `main`; it changes docs only (this file, `PRODUCTION_RUNBOOK.md` and `scripts/plaid/proposal-evidence.mjs`).

---

## A. Starting point

- `main` at `d460b43` (PLAID-1/2 work already on main: runbook, 2A continuity SQL, 2C history SQL, 2E balances, 2F reconciliation engine, 2G position draft, 2H attention). Clean working tree.
- Baseline full suite at `d460b43`: 7,648 tests, 7,598 passed, 48 failed. The 48 are pre-existing and unrelated (auth store, migration-count guards, CASH-8 money entry, CASH-OS-2C checkbox, a load-sensitive composer test). The list is in the scratchpad of the earlier session (`d460.fails.json`); it is not in the repo.
- Assignment ("CASH OS — PREMIUM INTEGRATION & PRODUCTION READINESS"): forensics + ADR first; Track 1 reconciliation default-off switch at the calculation boundary with exact legacy behavior while off; Track 2 owner match review (confirm / reject / reverse, persistence, org and role checks, SQL prepared but not installed); Track 3 consolidated position on real data paths with provenance per figure; Track 4 integrity audit; Track 5 DB/security review; Track 6 performance on Netlify Free; four independent review passes (A financial, B security, C failure, D UX); full validation; final report. Financial correctness contract A–O (see `docs/plaid2/ARCHITECTURE_DECISION_RECORD.md`).

## B. Chronological work log

| # | Commit | What was discovered | What changed | Tests | State |
|---|---|---|---|---|---|
| 1 | `6ab352a` | The reconciliation engine from the previous session was **live without any switch** (F4); position `income` counted every unclassified deposit (F6); legacy rejected transfer pairs re-appear (F1); report source lacks account types (F3); others F2–F9 | `docs/plaid2/ARCHITECTURE_DECISION_RECORD.md` (ADR-1..6) | — | COMPLETE |
| 2 | `7c23c15` | — | `CASH_OS_RECONCILIATION_ENABLED` (exact `"true"`, default off) carried as `deps.reconciliationEnabled`, stamped on every loaded context (`spendingService.ts` `loadExplorerContext` / `loadCompleteContext`); `classifier.ts` / `explorer.ts` rebuilt from the frozen `27d1950` text with the engine only when ON; report-path account-type enrichment (`reportingRepo.ts`); read-only impact preview (`reconciliationImpact.ts`, `GET plaid-spending?impact=1`) | `plaid3aReconciliationSwitch` (400-scenario differential vs frozen `__tests__/legacy27d1950`), `plaid3aEngineRules` | COMPLETE_AND_TESTED |
| 3 | `fe49c19`, `99a396d` | — | Pair persistence design: one atomic SQL function `financial_provider_decide_match` (`docs/plaid2/match-decisions-proposal.sql`, **uninstalled**); read model `matchReview.ts`; service `matchReviewService.ts`; repo `loadPairDecisions` / `getPairEvidence` / `decideMatch`; routes `GET ?matches=1`, `POST match_confirm|match_reject|match_reverse` | `plaid3bMatchDecisions` (PGlite), `plaid3bMatchReviewService`, `plaid3bMatchReviewModel`, `plaid3bNativePgConcurrency` (opt-in, native PostgreSQL 16, race tests, mutation-checked) | COMPLETE_AND_TESTED (SQL BLOCKED_PENDING_OWNER_APPROVAL) |
| 4 | `b1beeef`, `225f303` | BANK-5 static guard forbids browser files naming server spending modules | Matches UI `MatchReview.tsx` + `useMatchReview.ts`; DTOs moved to `src/finance/bankMatchReview.ts`; third Workflow mode only when the explorer payload carries `matches` (added only while the switch is on) | `plaid3bMatchReviewUi` (23), `plaid3bMatchesMode` (2), payload-key test; Chromium 375/1280 px dark/light (no overflow, 44 px targets); fixed a "↓→" glyph found in screenshots | COMPLETE_AND_TESTED |
| 5 | `0dab9c6` | **F10: `getBalances` read Items of every environment** (a Sandbox test balance could appear as real money in production). Position draft had no data path | Position rewritten: `consolidatedPosition.ts` (pure, provenance per figure, null never 0, completeness, income only from owner-confirmed `customer_payment`, integrity signals), `positionService.ts`, `GET plaid-position` (`netlify/functions/bank/plaid-position.ts` + wrapper), `CASH_OS_POSITION_ENABLED`; `getBalances` filters by Item environment (`bankAccountRepo.ts` exposes it); `unusedCreditBasis`; browser `CashPositionPanel.tsx` / `usePosition.ts` in `CashTransactionsView`; manual-ledger comparison `compareManualLedger` in `src/finance/bankPosition.ts`; removed superseded `plaid2gConsolidated.test.ts` (intents re-covered) | `plaid3cPositionBuilder` (incl. 300-scenario conservation), `plaid3cPositionService` (real SQL + handler), `plaid3cPositionPanel` (14); 4 mutations each caught; Chromium screenshots | COMPLETE_AND_TESTED |
| 6 | `0918fba` | — | Integrity audit scenarios A–I | `plaid4Integrity` (9), 4 mutations caught | COMPLETE_AND_TESTED |
| 7 | `bbd42e9` | — | Security checks: every DB call of the new paths instrumented and proven org-scoped (2 orgs), cross-org adversarial, role denial before any read, static guards, SQL static review, replay | `plaid5Security` (9), 2 mutations caught | COMPLETE_AND_TESTED |
| 8 | `9205343` | **F11: reconciliation engine quadratic** (10.7 s at 20k rows, beyond Netlify's 10 s); **F12: legacy pairing (production default path) quadratic** (5.3 s at 20k) | Equal-amount indexes in `reconciliation.ts` `reconcile()` and legacy `classifier.ts` `transferSuggestions`; outputs unchanged | `plaid6EngineEquivalence` (600 orgs vs frozen `__tests__/preOptimization/reconciliation.ts`), dense parity in `plaid3aReconciliationSwitch`, `plaid6Performance`; 3 mutations caught | COMPLETE_AND_TESTED |
| 9 | uncommitted → handoff commit | — | `PRODUCTION_RUNBOOK.md` §9 (switches, impact preview, plaid3b install/validation SQL, activation, rollback, limits) and correction of the stale "engine always on" statement; `proposal-evidence.mjs` registers plaid3b | docs only | COMPLETE |
| 10 | — | — | Four review passes launched as fresh-context subagents (A–D) | **All four failed immediately on an API session limit (HTTP 429) before producing findings** | NOT_STARTED (effectively) |

## C. Last 10 meaningful actions (chronological)

1. `plaid6Performance.test.ts`: added the 50,000-row case; measured 1.7/2.3 s explorer rows, 0.4 s reconciliation. Saved, tested, committed in `9205343`, pushed.
2. Ran affected suites (bankProvider + netlify + spending-explorer + cash-position + bank-connection): 62 files, 1,003 passed, 0 failed. Not a commit.
3. Committed and pushed `9205343` (performance). Remote confirmed equal.
4. Wrote reviewer brief (`/tmp/.../scratchpad/review/BRIEF.md`, outside the repo). Not committed (scratch only).
5. Launched four reviewer subagents. **All failed on a rate limit; no findings exist.** Follow-up required.
6. `scripts/plaid/proposal-evidence.mjs`: added plaid3b entry (sha256 `d3a4a3f5…b4ca`). Saved; committed in the handoff commit.
7. `docs/plaid2/PRODUCTION_RUNBOOK.md`: §6 correction, §7 activation order, new §9. Saved; committed in the handoff commit.
8. Checkpoint: `npx tsc --noEmit` clean.
9. Checkpoint: focused suites 26 files, 394 passed, 7 skipped (opt-in native PG), 0 failed.
10. Checkpoint: `npm run build` passed (1 m 4 s; only the existing chunk-size warning).

## D. Architecture and financial integrity

```
Plaid /transactions/sync ─▶ financial_provider_transactions (+accounts, items with environment)   EVIDENCE (never edited by interpretation)
Plaid /accounts/get      ─▶ financial_provider_balance_snapshots (append-only)                     EVIDENCE (flag PLAID_BALANCES_ENABLED)
                                   │
owner decisions ─▶ financial_provider_interpretations (category/transfer/debt/…; confirmed/rejected/undone; never deleted)   OWNER TRUTH
   pair decisions: ONLY via financial_provider_decide_match (uninstalled): confirm = 2 rows naming each other; reject = 1 row; reverse = both undone
                                   │
loadExplorerContext (5,000-row window) / loadCompleteContext (BANK-6G report source, 50,000 cap) / loadContextForRange   ── stamp reconciliation switch
                                   │
classifier.ts + explorer.ts (DERIVED, recomputed per request)  OFF = frozen 27d1950 behavior; ON = reconciliation.ts engine
                                   │
consumers: Explorer · Smart Review · batch · reports (reporting.ts activityOf) · Matches review (matchReview.ts) · impact preview · POSITION (placeRow)
                                   │
UI: SpendingExplorer (+ Matches mode when ON) · CashPositionPanel (when CASH_OS_POSITION_ENABLED) ── compareManualLedger with CashOsSnapshot (browser; ledger never written)
Manual ledger (financial_accounts / financial_transactions): MANUAL TRUTH, read only by the browser snapshot.
```

Feature flags (all server env, exact `"true"`, default OFF): `CASH_OS_RECONCILIATION_ENABLED`, `CASH_OS_POSITION_ENABLED`, existing `PLAID_BALANCES_ENABLED`, `PLAID_RESUMABLE_SYNC_ENABLED`, `PLAID_PENDING_CONTINUITY_ENABLED`, `PLAID_ACCOUNT_ADDITIONS_ENABLED`, `PLAID_SYNC_AUDIT_ENABLED`, `PLAID_BACKGROUND_SYNC_ENABLED`.

Financial interpretation changes (only when switches are ON): proposed transfers/card payments are in no income/expense total until confirmed; ambiguous groups are never auto-paired; position income = owner-confirmed customer payments only; refunds never income. Two deliberate, tested differences between position and BANK-6G report: unclassified money in is not income in the position; a proposed debt payment on a personal account is "not resolved" in the position (report says personal).

Remaining risks: see section I.

## E. Completed versus incomplete

| Item | State |
|---|---|
| ADR / forensics | COMPLETE_AND_TESTED (doc) |
| Track 1 reconciliation switch + parity + impact preview | COMPLETE_AND_TESTED |
| Track 2 match review backend + UI | COMPLETE_AND_TESTED (local/PGlite/native PG) |
| Track 2 decisions in production | BLOCKED_PENDING_OWNER_APPROVAL (plaid3b SQL) |
| Track 3 consolidated position (server, endpoint, panel, ledger comparison) | COMPLETE_AND_TESTED; live balances NOT verified (needs production) |
| Track 4 integrity scenarios | COMPLETE_AND_TESTED |
| Track 5 security/DB review (executable checks) | COMPLETE_AND_TESTED |
| Track 6 performance + linearization | COMPLETE_AND_TESTED |
| Four independent review passes A–D | NOT_STARTED (agents failed on rate limit; no findings) |
| Full-suite comparison vs `d460b43` at final HEAD | IMPLEMENTED_NOT_FULLY_TESTED: broad affected-suite runs done (see G); full 7,600-test run not repeated at `9205343` |
| ADR addendum (F10–F12, ADR-7..9), IMPLEMENTATION_LEDGER update | PARTIALLY_IMPLEMENTED: facts are in this handoff; ledger/ADR files not yet updated |
| Production activation of anything | BLOCKED_PENDING_OWNER_APPROVAL |

## F. Database and production state

| SQL proposal | File | Installed in production |
|---|---|---|
| plaid1b sync audit | docs/plaid1b/sync-audit-proposal.sql | No |
| plaid1c resumable sync | docs/plaid1c/resumable-sync-proposal.sql | No |
| plaid2a pending→posted continuity | docs/plaid2/pending-posted-continuity-proposal.sql | No |
| plaid2c provider revision history | docs/plaid2/provider-revision-history-proposal.sql | No |
| **plaid3b match decisions** (sha256 `d3a4a3f5430bc828b15632579a5662814e5e930d7439d0c98571bd1631a3b4ca`) | docs/plaid2/match-decisions-proposal.sql | No |
| BANK-6G report source / BANK-6H checked category | docs/bank6g, docs/bank6h | per earlier ledgers; not changed here |

This session did **not** change production SQL, production Plaid connections, account synchronization, feature switches or financial data, and could not reach production to verify its state. Known discrepancy preserved: migrations **157/158** objects exist in production but are absent from migration history; do not repair, do not `db push`.

Deployment safety of what is pushed: with all switches unset, classification equals the frozen legacy implementation (differential tests), the explorer payload has no new key, `plaid-position` returns `{enabled:false}` before any read (tested), the Matches mode is not offered, and the position panel renders nothing. Behavioral deltas that DO ship with switches off: (1) `getBalances` now hides other-environment Items (safety tightening; balances are off in production anyway); (2) legacy pairing is faster with identical output (proven); (3) owners'/admins' browsers make one extra `GET plaid-position` per Transactions view (answers `{enabled:false}`; employees get 403 and see nothing).

## G. Test evidence

- `npx tsc --noEmit`: clean (checkpoint).
- `npm run build`: passed (checkpoint).
- Checkpoint focused run: `npx vitest run src/services/bankProvider/__tests__/plaid3 …plaid4Integrity …plaid5Security …plaid6EngineEquivalence …plaid2eBalances …bank5SpendingEndToEnd src/features/cash-position src/features/spending-explorer` → 26 files passed, 1 skipped; 394 passed, 7 skipped (opt-in native PG), **0 failed**.
- Before `9205343`: `npx vitest run src/services/bankProvider netlify src/features/spending-explorer src/features/cash-position src/features/bank-connection` → 62 files, 1,003 passed, 9 skipped, 0 failed.
- Broader run at `0dab9c6` (features, cash-os, bankProvider, finance, netlify; 3,256 tests): 11 failures, of which 8 are in the `d460b43` baseline set (CASH-8 ×3, QBO migration guards ×3, CASH-OS-2C ×2) and 3 were new (`plaid2eBalances` fake lacked the Item environment) — fixed in `0dab9c6` by adding the field to the fixture; re-run green.
- Opt-in native PostgreSQL 16 (`CASHOS_PG_PSQL="runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -h /tmp/pgsock -p 54329"`): `plaid3bNativePgConcurrency` passed earlier; `plaid6Performance` part 3 passed.
- Benchmarks (`plaid6Performance`): reconciliation 20k rows 10,752 → ~110–126 ms; legacy explorer rows 20k 5,272 → 557 ms; 50k rows: explorer 1.7/2.3 s, reconciliation 0.4 s, Matches model 0.1 s, position 0.07 s; PGlite end-to-end (5k rows) position 0.2–0.4 s, Matches review 0.2–0.3 s, impact 0.4–0.7 s; PG16: pair-decision read 3.9 ms, newest balance 0.1 ms, evidence page 20 ms, pair function p50/p95 51/58 ms.
- Not run at final HEAD: the full 7,600-test suite; flaky: one load-sensitive UI composer test noted in the earlier baseline.

## H. Git evidence

- Starting SHA `d460b43`. Session commits: `6ab352a`, `7c23c15`, `fe49c19`, `99a396d`, `b1beeef`, `225f303`, `0dab9c6`, `0918fba`, `bbd42e9`, `9205343`, then the handoff commit (docs only). All authored in this session; no other agent pushed to `main` since `d460b43`.
- Before the handoff commit: local HEAD = origin/main = `9205343`; uncommitted: `docs/plaid2/PRODUCTION_RUNBOOK.md`, `scripts/plaid/proposal-evidence.mjs`; no untracked files; no preservation branch needed.
- Final HEAD / push result: recorded in the owner report that accompanies this commit (not self-referenced here to avoid amending).
- Scratch only (not in repo): native PostgreSQL scratch cluster on port 54329 (`/var/lib/postgresql/cashos_scratch`), scratch databases created by opt-in tests are dropped by the tests; a stale `cashos_probe` DB may remain. Nothing there touches production.

## I. Unresolved issues and risks

1. **High — no independent review was obtained.** All four review agents failed (rate limit). Next: rerun passes A–D (brief text is reproducible from section A + the contract) and verify findings before fixing.
2. **Medium — `plaid3b` concurrency edge**: a legacy single-leg transfer decision written through `financial_provider_replace_interpretation` naming leg X can commit concurrently with a pair confirmation involving X (the "third transaction" check in `decide_match` is an unlocked `EXISTS`). Effect: inconsistent pairing, surfaced as "Evidence changed / one side later given a different meaning" in the review. Smallest action: document as accepted, or recheck after insert inside the function before installing.
3. **Medium — full suite not re-run at `9205343`.** Run `npx vitest run` and compare failure names with the `d460b43` set (48).
4. **Medium — live data unverified**: Wells Fargo multi-account balances/activity have never been observed through the position (needs `PLAID_BALANCES_ENABLED` + `CASH_OS_POSITION_ENABLED` with owner approval).
5. **Low — account mapping list (`listBankAccounts`) still shows other-environment accounts** (not money; noted, not changed).
6. **Low — ADR/ledger files not updated with F10–F12 and this session's results** (this handoff holds them).
7. **Low — `CORS: *` on bank endpoints** (pre-existing; bearer auth, no cookies).
8. **Known — refund confirmation does not persist a link to the original purchase** (UI says so).

## J. EXACT RESUME POINT

1. Last fully completed and validated action: checkpoint validation (tsc clean, 394 focused tests green, build green) on `9205343` + the runbook/evidence edits.
2. Last action attempted: four review subagents (A–D).
3. Result: failed (API session limit, HTTP 429), no output, no files changed by them (`git status` showed only my two doc edits).
4. Partially edited files: none (runbook + evidence script are complete and committed with this handoff).
5. Incomplete commands: the review passes; the full-suite comparison.
6. First command: `git fetch origin main && git log --oneline -3 origin/main && npx tsc --noEmit`.
7. First file to inspect: `docs/plaid2/OPUS_MAX_SESSION_HANDOFF.md` (this), then `src/services/bankProvider/spending/consolidatedPosition.ts` and `docs/plaid2/match-decisions-proposal.sql` for the reviews.
8. Smallest next task: run review pass A (financial) against the contract, verify each finding, fix only confirmed defects; then B, C, D.
9. Do NOT repeat: forensics/ADR, the switch and parity work, match backend/UI, position, integrity/security/perf suites, linearization; do not reintroduce the removed `plaid2gConsolidated` API.
10. Approval gates still closed: install plaid1c / plaid2a / plaid2c / plaid1b / **plaid3b**; enable any switch (`CASH_OS_RECONCILIATION_ENABLED`, `CASH_OS_POSITION_ENABLED`, `PLAID_BALANCES_ENABLED`, …); Plaid Link / account additions; production sync; 157/158 repair; Netlify upgrade; BANK-6H proposal.

## K. Next-session prompt

```
Continue the Cash OS premium integration in christiandubon01/poweron-hub on main. Start by reading
docs/plaid2/OPUS_MAX_SESSION_HANDOFF.md (handoff commit follows implementation commit 9205343).
Do not redo completed phases. Do not install SQL, enable switches, launch Plaid Link, sync, or touch production data.

1. git fetch origin main; confirm HEAD; npx tsc --noEmit.
2. Run the four independent review passes that failed last session (A financial auditor against
   contract A-O, B security incl. docs/plaid2/match-decisions-proposal.sql, C failure engineer incl.
   PostgREST-vs-shim differences, D product/UX on MatchReview.tsx and CashPositionPanel.tsx).
   Verify every finding by reproduction before fixing; fix only confirmed defects, keep switches default-off,
   never weaken tests. Disclose that same-model subagents are not independent human validation.
3. Run the full suite (npx vitest run) and compare failure names with the 48 pre-existing d460b43 failures.
4. Update docs/plaid2/ARCHITECTURE_DECISION_RECORD.md (F10-F12, ADR-7..9) and IMPLEMENTATION_LEDGER.md.
5. Produce the final executive report (A-O) with an honest GO/NO-GO; everything production-facing stays
   BLOCKED_PENDING_OWNER_APPROVAL.
```
