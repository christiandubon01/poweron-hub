# PLAID-1C — Netlify Free resumable sync

Status: tested, **not activated**. No production SQL, no switch enabled, no Plaid or financial-data change. The PLAID-1B background worker stays unrouted and off.

## Why

The owner decision is to stay on the Netlify Free plan. Background functions (15 min) are Pro/Enterprise only. Synchronous functions are short: Netlify's docs give 10 s in older pages and 30–60 s in newer ones, and this design assumes the strictest figure, 10 s. A multi-account backfill can be dozens of `/transactions/sync` pages (at most 500 rows each), so it cannot be fetched in one request.

Saving the cursor after every page is **not** safe. When Plaid returns `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, the whole update must restart from the cursor it started with. If earlier pages were already applied and the cursor had already moved, the data would be inconsistent or duplicated, and the start cursor would be lost.

## Architecture

- Each request runs one **step**: `resumableSyncStep(deps, actor, { itemId })` via `POST plaid-sync { action: 'sync_step' }`.
  - It claims the Item lease (fenced token = request start time).
  - It opens or resumes the Item's single open **staging run** (identity: run id plus generation).
  - It fetches pages for at most `STEP_BUDGET_MS` (5 s), staging each page atomically (rows plus the next page cursor, compare-and-set on generation and page number).
- **Applying.** Once Plaid reports `has_more = false`, the step applies the run, but only if at least 4 s remain in a 10 s request window. Otherwise it releases the lease and returns `more: true`, and the next step applies.
- **One transaction for the apply.** `financial_provider_sync_apply_run` applies all staged changes to evidence in provider order (last event per transaction wins), moves the committed cursor, stamps success, releases the lease and clears the staged rows. It refuses unless the caller still holds the lease **and** the committed cursor still equals the run's start cursor.
- **Mutation during pagination.** The step bumps the generation and restarts from the run's **start** cursor; older-generation rows are discarded. After 3 restarts the run is abandoned with `SYNC_CONFLICT`. Nothing becomes visible, and the cursor does not move.
- **Interruptions.** A timeout, killed function, closed browser or network loss leaves the staged pages and page cursor. The next press resumes from the last staged page. If the lease was held by a killed request, it expires after `SYNC_LEASE_MS` (2 min).
- **Duplicates and overlaps.** A second request is refused (409) while the lease is held. A stale writer (wrong generation or page number, lost lease, moved cursor) changes nothing. A run whose start cursor no longer matches is abandoned (`CURSOR_MOVED`), and so is one older than 24 h (`EXPIRED`).
- **No partial visibility.** Reports read only `financial_provider_transactions`, which changes only inside the apply transaction. The staging tables are server-only (RLS on, no policy, no grants to anon or authenticated).
- **UI.**
  - The bank card loops `sync_step` (bounded at 300 steps; a 409 is retried up to 6 times at 5 s) and shows "Fetching page N…".
  - `sync_status` reports `partial` with progress (pages staged, restarts, phase) and never includes a cursor.
- **Mutually exclusive switches.** `plaid-sync { action: 'sync' }` (one-shot) is refused while `PLAID_RESUMABLE_SYNC_ENABLED=true`. The step refuses if background sync is enabled.

## SQL (prepared, not installed)

`docs/plaid1c/resumable-sync-proposal.sql` creates two server-only tables and five service-role-only functions. It is additive: it alters, rewrites and deletes no existing evidence. It is verified locally on PGlite with migrations 139–143, 146, 153 and 154, including a re-run.

Install it only as ONE named tracked migration (`plaid1c_resumable_sync`) after owner approval. Never use `supabase db push`, and never repair or reapply 157/158.

## Test evidence

`src/services/bankProvider/__tests__/plaid1cResumableSync.test.ts` (13 tests, real SQL on PGlite) covers:

- A 24-page / 12,000-row three-account backfill over many requests, with nothing visible and the cursor null until the final apply.
- Interrupted-request resume at the staged page.
- A mutation in a later request, restarting from START, with no generation-1 rows applied.
- Repeated mutations, ending in abandon and a clean restart.
- Duplicate and overlapping requests, plus stale stage writes.
- Lease fencing and the `CURSOR_MOVED` check.
- Modified, removed and pending-to-posted rows.
- `ACCOUNT_UNKNOWN` failing closed, with partial status.
- Org isolation, browser (anon/authenticated) denial and staged-row validation.
- Endpoint switch behaviour.

Full suite: the same 47 pre-existing failures as on base `6fbd085`, none new. `tsc` and `npm run build` pass.

## Limitations

- After a killed request, a retry waits up to 2 minutes for the lease to expire.
- The apply must fit within the database statement timeout. Very large updates apply in one statement batch; the largest test applied 12,000 rows.
- Pending-to-posted decision inheritance is still not implemented (see PLAID-1B).
- Revision history for modified rows requires the PLAID-1B audit SQL.
- Runs left partial for 24 h are abandoned and refetched from the committed cursor.
- History depth stays at the Item's original 90-day request.

## Activation (each step needs separate owner approval)

1. Install `docs/plaid1c/resumable-sync-proposal.sql` as the tracked migration `plaid1c_resumable_sync`.
2. Set `PLAID_RESUMABLE_SYNC_ENABLED=true` in Netlify. Leave `PLAID_BACKGROUND_SYNC_ENABLED` unset.

Rollback: unset the switch. The one-shot sync returns unchanged.
