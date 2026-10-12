# GREENLIGHT-1 — independent audit, corrections, owner-testing readiness

Baseline `d460b43` · audited checkpoint `7efd734` · **code tested at `8edbe1d`** (this report is committed on top of it; it changes no code).
Nothing in production was touched: no SQL installed, no switch changed, no Plaid call, no sync, no bank account added or removed, no
production data changed, migrations 157/158 untouched, no `supabase db push`, no Netlify change.

## Verdict

**CONDITIONAL GO — SAFE FOR CONTROLLED OWNER TESTING; SPECIFIC APPROVAL GATES REMAIN.**

- **Code readiness: ready.** Every P1 the four reviews found in the new work is fixed and covered by a regression test. Two P1s remain
  open, and both need the owner's approval to fix. B-1 has been present since migration 153 and needs a SQL install, which is prepared and
  tested. A-1 with the switch OFF is pre-existing production behavior, which only the owner may change. All new behavior stays behind
  switches that are off by default. With every switch off, production behaves as before: the frozen-legacy differential proofs pass, and the
  full suite shows no new failures against `d460b43`.
- **Production activation: not done and not authorized here.** Each stage below needs its own owner approval. Stage 0 and Stage 1 are
  read-only and can start immediately.
- Gates:
  - **G1.** Owner approval for each switch and each SQL install, one at a time, in the order of section 6.
  - **G2.** Install the B-1 lockdown before an admin other than the owner uses Cash OS, and before the plaid3b decisions are used.
  - **G3.** Do not run a large first backfill on the one-shot sync, such as adding the remaining Wells Fargo accounts. Install plaid1c and
    turn on resumable sync first (C-1).
  - **G4.** Before relying on the figures, compare the balances with the bank's own screens (A-3: Plaid's cached balances carry no bank
    time).

## 1. The four reviews

**How they ran.** Four reviewers each started with a fresh context and shared one brief (`scratchpad/g1/BRIEF.md`). They worked read-only
on the repository and produced their own reproductions in scratch directories. They are **sub-agents of the same model, not human or
organizationally independent reviewers**: independent context and independent reproduction, not independent judgment in the strict sense.
The first run was cut off by an API session limit. The resumed run continued from each reviewer's own notes on disk, and every report
below is final. Severity follows the brief: P0 is corruption, breach or data loss; P1 is wrong results, a broken core workflow, an
authorization defect or unsafe activation; P2 is non-blocking.

### A — Financial correctness

**Reviewer's summary.** No P0. With all switches OFF, behavior is identical to the frozen pre-engine implementation: the reviewer re-ran
`plaid3aReconciliationSwitch` and `plaid6EngineEquivalence`, 21/21. Findings:

| ID | Sev | Reachable | Finding | Outcome |
|---|---|---|---|---|
| A-1 | P1 | ON (and OFF, pre-existing since BANK-6G) | An owner-confirmed category lost to an unconfirmed transfer or debt suggestion: payroll paid by Zelle was "unresolved", not Business spending. | **Fixed for ON** (`0d27a36`). OFF is unchanged and documented, because changing it would change production behavior without approval. Turning reconciliation ON is the remedy. |
| A-2 | P1 | ON | A loan payment, or a card cash advance, became Business spending or Money in with the switch ON; OFF held them back. | **Fixed** (`0d27a36`): they are held as unresolved, as with OFF. An unrelated same-amount purchase and deposit are not held. |
| A-3 | P1 | ON position + balances | A cached balance with no bank timestamp showed as "Current". | **Fixed** (`0d27a36`): it shows "Bank time unknown" and is never counted as current. |
| A-4 | P1 | ON, then rollback to OFF | An Explorer "Confirm" of a pair wrote one leg only. After the switch was turned off, the other leg became "Money in". The mirrored leg could also override a confirmed customer payment. | **Fixed** (`0d27a36`): while ON, pairs can only be confirmed in Matches, where both legs are written together. The mirror never overrides a confirmed category. |
| A-5 | P2 | OFF/ON | Sandbox and production evidence are classified together, so they can pair in rare cases. | Documented. |
| A-6 | P2 | ON | The refund engine treats "CHECK 1023" and "CHECK 2210" as the same merchant, so a deposit can be suggested as a refund. | Documented (suggestion only, never auto-applied). |
| A-7 | P2 | OFF, legacy | A card autopay without Plaid's category, with the card credit arriving 4 days later, is double counted. | Documented (pre-existing; ON pairs it correctly). |
| A-8 | P2 | after plaid3b | Reverse does not restore an earlier one-leg transfer decision that a pair "completed". | Documented (the audit trail keeps it). |

**Checked and sound:**
- OFF equals legacy.
- Position cash and credit stay separate; missing balances are never shown as 0.
- Every posted row lands in exactly one position line; income requires a confirmed customer payment.
- The manual ledger stays read-only and separate.
- `decide_match`: organization scope, row locks, a fingerprint rebuilt on the server, refusals and idempotency all held.

### B — Security and organization isolation

| ID | Sev | Reachable | Finding | Outcome |
|---|---|---|---|---|
| B-1 | P1 | **OFF, production today** (migrations 153/156, unchanged since d460b43) | An active owner or admin can INSERT/UPDATE `financial_provider_interpretations` directly through PostgREST. That allows forged or backdated decisions, pairs the server would refuse, and fingerprints rewritten to hide "evidence changed". Employees and other organizations are refused. | **Prepared, not installed:** `docs/plaid2/interpretation-write-lockdown-proposal.sql` (`8edbe1d`), runbook 9.6. Tested on PGlite (reproduction, refusal, server paths intact) and PostgreSQL 16 (install order, no data change). Needs owner approval (gate G2). |
| B-2 | P2 | ON + plaid3b | `match_reverse` skipped the environment check that confirm and reject apply. | **Fixed** (`b3de713`); a cross-org or cross-environment reverse now returns 404 before the SQL runs. |

**Checked and sound:**
- Role checks happen before any read on every new route; `plaid5Security` passes 9/9.
- Organization and actor are never taken from the request.
- Input validation covers ids, fingerprint, dates, tab, limit and body size.
- Cross-org pairs are refused in the service, the SQL function and the composite foreign keys.
- Every uninstalled SQL function is SECURITY INVOKER, has a fixed search_path and grants EXECUTE to service_role only.
- No secret, token or database error text reaches a response.
- With all switches off, every new route refuses before reading, except the deliberate read-only `?impact`.

### C — Failure recovery and concurrency

| ID | Sev | Reachable | Finding | Outcome |
|---|---|---|---|---|
| C-1 | P2 | OFF (pre-existing since BANK-4) | The one-shot sync applies a multi-page update page by page. A time-budget stop or a 10 s kill can leave half an update live while the owner is told "nothing was saved". An expired lease reads as "synced". | Documented. Realistic trigger: a first 90-day backfill of more than 500 changes. The intended fix is plaid1c plus `PLAID_RESUMABLE_SYNC_ENABLED` (gate G3). Daily syncs are a single page. |
| C-2 | P2 | after plaid3b | Legacy `replace_interpretation` accepts a one-leg transfer naming a leg that is already in a confirmed pair (the reverse direction is refused). | Documented. While ON, A-4's fix stops the Explorer from writing such rows; only a direct API call reaches it, and the B-1 lockdown closes that path. |

**Checked and sound, on real PostgreSQL 16:**
- `decide_match` races: double-tap, two tabs, confirm against reverse, reject against confirm, an amount update in flight, and an injected
  failure (whole call rolled back).
- Sync lease fencing.
- Idempotent evidence upserts.
- Every read endpoint fits within Netlify Free's 10 s limit.

### D — Product and user experience

| ID | Sev | Reachable | Finding | Outcome |
|---|---|---|---|---|
| D-1 | P1 | ON + plaid3b | "Confirm refund" and "Not a refund" saved whatever the Explorer suggested. A PayPal refund worded "TRANSFER" was saved as Transfers while the screen said "Confirmed as a refund". | **Fixed** (`b3de713`): new `refund_*` actions always act on the category `refund`, behind the switch; regression test included. |
| D-2 | P2 | ON | Smart Review settings stayed open inside Matches. | **Fixed** (`b3de713`). |
| D-3 | P2 | ON + plaid3b | "Undo" on "Not a refund" did nothing but said "undone". | **Fixed** (`b3de713`): the message reflects what the server did, and a rejected card offers "It is a refund". |
| D-4 | P2 | ON position | After a failed period change, the new period stays selected over the old figures. | Documented. |
| D-5 | P2 | ON | Wording ("Refresh" only reloads stored figures; card ledger comparison wording; a "Derived" label on mixed spending lines). | Documented. |

**Checked and sound:**
- Explorer with all switches off: nothing visible changes; there is one extra authenticated request, answered `{enabled:false}`.
- Match flows and messages; loading, empty, error, disabled and read-only states.
- Position honesty: no $0 for missing values, credit marked "not cash", pending excluded, unclassified money in is not income.
- Phone width 360–375 px, light and dark.

### Recovered from the first session (my own checks, before the reviewers)
- Three runbook checks could never pass as written: §2.1 used `to_regproc` on a name with two overloads, §9.2 passed an argument list to
  `to_regproc`, and §3 checked 5 of the 6 functions. All are corrected (`371521a`). A test now reads the runbook and runs its SQL verbatim
  on PostgreSQL 16, so the document cannot drift from what works.

## 2. Corrections made (all pushed to `main`)

| Commit | What |
|---|---|
| `371521a` | Runbook preflight and validation SQL fixed; `greenlight1MigrationOrder.test.ts` (PG16, opt-in) runs the runbook verbatim. |
| `9040c29` | Interim checkpoint report. |
| `b3de713` | D-1, D-3, D-2, B-2; `greenlight1Corrections.test.ts` (real SQL). |
| `0d27a36` | A-1 (ON), A-2, A-3, A-4; `greenlight1Precedence.test.ts`, plus the A-4 refusal in `greenlight1Corrections.test.ts`. |
| `8edbe1d` | B-1 lockdown SQL proposal (uninstalled), runbook 9.6, evidence script, `greenlight1InterpretationLockdown.test.ts`, PG16 order test. |

Every runtime change sits behind `CASH_OS_RECONCILIATION_ENABLED` or the position switch. The existing tests that changed are:
- the Matches UI test, which now expects the new refund requests;
- two cross-organization tests, where reverse is now refused with 404 instead of reaching SQL and answering `nothing_to_reverse`. Both
  are refusals, and data is still asserted unchanged in the service test.

## 3. Test evidence

- **Full repository suite** (`vitest run`, the same machine, JSON reports compared test by test):

  | Run | Tests | Passed | Failed | Skipped |
  |---|---|---|---|---|
  | `d460b43` (baseline) | 7,648 | 7,598 | 48 | 2 |
  | `7efd734` (checkpoint) | 7,838 | 7,780 | 47 | 11 |
  | `8edbe1d` (final code) | 7,857 | 7,795 | 48 | 14 |

  - **Final against d460b43: 0 new failures and 0 newly passing.** The failing set is identical, test for test. Every one of those
    failures is pre-existing and outside the Cash OS bank code (auth store, migration guards, QuickBooks, admin and employee UI contracts).
  - **Final against 7efd734: one difference.** `scopePackComposer.test.tsx` (ATB-5) fails in the full run. It also failed at the
    baseline, passed at the checkpoint, and passes 12/12 when run alone at `8edbe1d`. Its directory's only change since the baseline is
    `CashOsViews.tsx`, the panel mount, which it does not import. It is timing-sensitive under full-suite load and not caused by this work.
  - The extra skips are the opt-in native-PostgreSQL tests (no `CASHOS_PG_PSQL` in the full run); they ran separately, below.

- Focused suites at `8edbe1d`, run together: all bank provider, spending explorer, cash position and bank connection tests, 60 files and
  977 tests, all passing. This includes the OFF-equals-legacy differential proofs (`plaid3aReconciliationSwitch`, `plaid6EngineEquivalence`),
  `plaid4Integrity`, `plaid5Security`, the plaid3b service, model and UI tests, `bank5SpendingEndToEnd`, and the new GREENLIGHT-1 tests
  (`greenlight1Corrections` 8, `greenlight1Precedence` 4, `greenlight1InterpretationLockdown` 4).
- Opt-in native PostgreSQL 16: 19/19 at `8edbe1d`: `greenlight1MigrationOrder` 3, `plaid3bNativePgConcurrency` 7, `plaid6Performance` 9.
- `npx tsc --noEmit`: clean. `npm run build`: succeeds (51.7 s; only the existing chunk-size warning).
- The reviewers' own reproductions were re-run against the fixed code. A's probes now show:
  - S5c and S5d as Business with the switch ON;
  - the loan payment and cash advance unresolved, ON as OFF;
  - balance freshness "aging" with `bankTimeKnown: false`.

## 4. Final commit

Code: `8edbe1d` (tested). The report commits on top of it change documentation only. Working tree clean after the push; the scratch worktree and scratch databases have been removed.

## 5. SQL migration order (none installed; each one needs approval, is one named tracked migration, and is never `db push`)

Proven on PostgreSQL 16 against a production-equivalent schema (139-147, 153-158, plus BANK-6G) with seeded evidence. After every step the
runbook's own checks pass verbatim and the evidence fingerprint is unchanged.

1. `plaid1c_resumable_sync`, file `docs/plaid1c/resumable-sync-proposal.sql`, runbook §3.
2. `plaid2c_provider_revision_history`, file `docs/plaid2/provider-revision-history-proposal.sql`, runbook §5.
3. `plaid2a_pending_posted_continuity`, file `docs/plaid2/pending-posted-continuity-proposal.sql`, runbook §4.
4. `plaid3b_match_decisions`, file `docs/plaid2/match-decisions-proposal.sql`, runbook §9.2.
5. `greenlight1_interpretation_write_lockdown`, file `docs/plaid2/interpretation-write-lockdown-proposal.sql`, runbook §9.6. It is
   independent of the others, can go first, and is **recommended before step 4 is used**.

Not in this order:
- the plaid1b draft (only its `sync_runs` half, later and optional; never its revisions half);
- BANK-6H (out of scope).

Each proposal is atomic: an injected failure leaves nothing behind. Get the SHA-256 for each from `node scripts/plaid/proposal-evidence.mjs`.

## 6. Feature-switch activation order (Netlify environment variables, exact value `true`, one at a time, each with approval)

1. No switch: the read-only impact preview (runbook §9.1).
2. `CASH_OS_RECONCILIATION_ENABLED`: Matches is read-only until plaid3b is installed. With it installed, pairs and refund decisions become
   available.
3. `CASH_OS_POSITION_ENABLED`, and for balance figures also `PLAID_BALANCES_ENABLED` with one "Refresh balances" while the owner is present.
4. After plaid1c: `PLAID_RESUMABLE_SYNC_ENABLED`. After plaid2a: `PLAID_PENDING_CONTINUITY_ENABLED`.
5. Last, with the owner present: `PLAID_ACCOUNT_ADDITIONS_ENABLED`, after step 4 (gate G3).

Never on Netlify Free: `PLAID_BACKGROUND_SYNC_ENABLED`. Optional and later: `PLAID_SYNC_AUDIT_ENABLED` (needs plaid1b's `sync_runs` half).

Preview isolation: `netlify.toml` defines no deploy contexts, and per-context variables live in the Netlify UI, which could not be verified
from here. Assume a deploy preview shares production's database and variables, so it is not an isolated test environment. Use the stages
below.

## 7. Owner testing checklist (stop at the first unexpected result; each stage needs its own approval)

**A. Without production SQL**

**Stage 0 — today, nothing to approve**
1. Open Cash OS → Transactions.
2. Expect: the bank card and the Spending explorer with Explore / Smart Review; no "Matches"; no "Cash position" panel.
3. Expect the totals for the same period to be unchanged from before.

**Stage 1 — impact preview, read-only, switch still OFF**
1. Signed in as the owner, run in the browser console:
   `const t = JSON.parse(localStorage.getItem('poweron-hub-auth')).access_token; await (await fetch('/.netlify/functions/plaid-spending?impact=1', { headers: { Authorization: 'Bearer ' + t } })).json()`
   (reload the page first if the session has expired).
2. Expect `available: true`, `complete: true` and `summary.conserved: true`.
3. Read `changes`: the rows that would move to "unresolved". This is where you decide whether to continue.

**Stage 2 — `CASH_OS_RECONCILIATION_ENABLED=true`, redeploy, no SQL**
1. Open Spending explorer → Workflow → "Matches".
2. Expect proposed pairs side by side with "Why this match?" and business↔personal pairs flagged.
3. Expect a banner saying decisions need a database update; every decision button (pairs and refunds) is disabled.
4. In the Explorer, expect proposed transfers and card payments under "unresolved", exactly the Stage 1 list.
5. Expect a confirmed payroll or vendor category to stay in Business spending (A-1).
6. Expect loan payments and cash advances to stay unresolved (A-2).
7. "Confirm" on a pair suggestion in the Explorer says "Confirm matched pairs in the Matches review" and saves nothing (A-4).
8. Rollback: unset the switch and redeploy; Stage 0 behavior returns.

**B. With approved SQL**

**Stage 3 — install the B-1 lockdown (§9.6), then plaid3b (§9.2), each validated**
1. Matches → pick one obvious checking→savings pair → Confirm match.
2. Expect "Match confirmed…", the pair under Confirmed, and both legs as a confirmed transfer in the Explorer.
3. Run read-only §9.3 step 2: expect two rows that name each other.
4. Reverse… → Yes. Expect the pair back in "To review", marked "Reversed".
5. Not a match on a pair you know is wrong. Expect it to stay out of "To review" after a reload.
6. Refunds: Confirm refund. Expect the Explorer to show the category Refund, never Transfers, and the money not counted as income.
7. Not a refund. Expect the card under "Not a refund"; its only action is "It is a refund".
8. Rollback: reverse decisions in the UI and unset the switch. Pairs recorded here keep their meaning with the switch off, because both
   legs are written.

**C. Live Wells Fargo, owner present**

**Stage 4 — `CASH_OS_POSITION_ENABLED=true`, and `PLAID_BALANCES_ENABLED=true` with one "Refresh balances"**
1. Expect a Cash position panel per scope: balance, available (or "not reported"), "as of", and the account status.
2. Expect status "Bank time unknown" where Wells Fargo gives no time (A-3). It is not "Current"; that is expected.
3. Compare every balance with the Wells Fargo app at the same moment. Any difference beyond pending activity is a stop.
4. Expect only customer payments you confirmed under income; other deposits appear as "not income until you confirm".
5. Rollback: unset the switches; snapshots already stored stay as history.

**Stage 5 — later, after plaid1c and resumable sync**
- Add the remaining Wells Fargo accounts (runbook §7 step 6). Do not do this on the one-shot sync (C-1).

## 8. Rollback procedure

- **Switch:** unset it in Netlify and redeploy. The feature disappears, and the code returns to the proven legacy behavior.
- **What stays:** decisions already written are ordinary interpretation rows. Pairs from Matches keep both legs; refund and category
  decisions can be undone from the UI. Balance snapshots stay as history.
- **SQL:** each proposal's header gives its rollback.
  - plaid3b: `DROP FUNCTION public.financial_provider_decide_match(uuid, uuid, text, uuid, uuid, text, text, jsonb);`
  - Lockdown: re-create the 156 policies and grant INSERT/UPDATE back.
  - plaid2c: `DROP TRIGGER trg_fpt_81_history ON public.financial_provider_transactions;`
  - plaid1c and plaid2a: unset their switches; their tables stay empty and inert.
- **Never:** `db push`, migration repair, 157/158 changes, or deleting provider evidence.

## 9. Remaining risks

1. **B-1** is live in production until the lockdown is installed. Only an insider can use it (an active owner or admin); there is no
   cross-org exposure.
2. **A-1 with the switch OFF** (pre-existing): owner-confirmed payroll or vendor categories on transfer-looking rows are reported as
   "unresolved". Turning reconciliation ON fixes it. Changing OFF needs the owner's decision.
3. **C-1:** the one-shot sync can half-apply a large update. Avoid large backfills until plaid1c and resumable sync are on.
4. **A-3:** balance freshness is honest but conservative. Wells Fargo balances will usually show "Bank time unknown".
5. Open P2s: A-5, A-6, A-7, A-8, C-2, D-4 and D-5. None of them changes data without an owner action.
6. **Not verified:**
   - the production catalog itself (grants, policies, the real 157/158 objects), because there was no access;
   - real PostgREST and GoTrue (the RLS proofs use PGlite);
   - real Plaid and Supabase latency;
   - Netlify per-context variables;
   - real devices and a screen-reader pass.
7. The reviewers share the author's model family (see section 1). Their reproductions are concrete, but independence is limited.

## 10. Completion

- **Code and verification readiness for controlled owner testing: about 90%.** Findings are triaged, every P1 in the new work is fixed and
  tested, SQL order is proven, and the runbook is verified verbatim. The remainder is the open P2s and the B-1 install.
- **End-to-end, including production activation: about 35%.** No SQL is installed and no switch is enabled. Stages 1–5 still need the
  owner's approvals and hands-on checks.

**Next action:** the owner approves Stage 1 (read-only impact preview) and decides on gate G2 (B-1 lockdown install).
