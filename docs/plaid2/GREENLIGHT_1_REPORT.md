# GREENLIGHT-1 — independent audit, corrections, owner-testing readiness

**Status: IN PROGRESS (interim checkpoint).** This file is rewritten at each checkpoint; the final version replaces this one.
Baseline `d460b43` · audited checkpoint `7efd734` · current HEAD: see `git log -1` (first GREENLIGHT-1 commit `371521a`).
Nothing in production was touched: no SQL installed, no switch changed, no Plaid call, no sync, no data change, 157/158 untouched.

## Recovery note (session limit)
The first GREENLIGHT-1 session ended at an API session limit. Recovered state: the checkpoint full suite had completed; the
two runbook preflight fixes and the migration-order test were uncommitted in the working tree (now committed as `371521a`);
all four reviewer agents had stopped with partial notes only (B: one recorded finding; C and D: drafts; A: probes only).
The reviewers were relaunched with instructions to continue from their own notes, not to start over.

## Evidence so far
- **Full suite at 7efd734 vs d460b43** (same machine, `vitest run`, JSON reports compared test by test):
  d460b43 = 7,648 tests, 7,598 passed, 48 failed, 2 skipped; 7efd734 = 7,838 tests, 7,780 passed, 47 failed, 11 skipped.
  **New failures: 0.** One baseline failure passed at the checkpoint (`scopePackComposer.test.tsx`, ATB-5; a file not touched by the
  change, timing-sensitive under load). All 47 remaining failures are pre-existing and outside Cash OS bank code (auth store, migration
  guards, QuickBooks, admin/employee UI contracts). The 9 extra skips are the opt-in native-PostgreSQL tests.
- **SQL install order on PostgreSQL 16** (`greenlight1MigrationOrder.test.ts`, opt-in): production-equivalent schema (139-147,
  153-158 + BANK-6G) with seeded evidence; plaid1c -> plaid2c -> plaid2a -> plaid3b each apply cleanly; the runbook's own
  fingerprint/preflight/validation SQL, read from the runbook and run verbatim, passes after every step; evidence and decision
  fingerprints identical before/after every install; plaid3b installs alone; each proposal is atomic (an injected failure leaves nothing).
- **Runbook corrections (371521a)**, found by running the runbook verbatim:
  1. §2.1 `to_regproc('public.financial_provider_connect_item')` is NULL in production (156 keeps two overloads) -> false stop.
  2. §9.2 `to_regproc('name(args)')` always NULL -> `json_guard` false (false stop) and `already_there` could never be true.
  3. §3 function check saw 5 of the 6 plaid1c functions (missed `record_apply_failure`); grants note now expects the owner row.
  4. §0.5 install order aligned with §7.
  Severity P2 (operational): they would have stopped or misled an approved install; none touches data.

## Reviewer findings (partial, being verified — NOT yet triaged)
- B-1 (reviewer: P1) owner/admin can write `financial_provider_interpretations` directly via PostgREST (grants/policies of installed
  migrations 153/156), forging audit fields and bypassing plaid3b invariants. Insider-only; no cross-org. Being checked: baseline status.
- C-1 (draft) synchronous sync applies a multi-page update page by page; a stop mid-apply can leave half an update visible.
  Being checked: baseline status and realistic reachability.
- D drafts: Matches refund confirm/reject stores the Explorer's current suggestion bucket (P1 candidate, switch ON only);
  Smart Review settings panel stays open in Matches mode (P2, switch ON only).

## Next action
Collect the four reviewer reports -> reproduce every P0/P1 independently -> fix within scope (default-off) with regression tests ->
tsc, build, focused suites, full suite at final HEAD vs d460b43/7efd734 -> final report and verdict.
