# PLAID-1B — reliable multi-account historical sync

Status: tested, **not activated**. No production SQL, no new routed function, no switch enabled, no Plaid or financial-data change.

## Hosting verification (blocker for activation)

Netlify background functions run up to 15 minutes and answer the caller 202 immediately (Netlify docs). Netlify's documentation lists them for Pro and Enterprise plans. This repository has never used one, and this review has no Netlify account access, so **plan support for this site is unverified**. Per the phase rule, the worker is built and tested but not routed.

## Architecture

- `bankSyncService.syncTransactions(deps, actor, { itemId }, options)` is unchanged in semantics: the whole update is fetched, validated and applied, and the committed cursor moves only after every page is durably written. New `options`: `budgetMs`, `leaseMs`, `trigger`. Background values: 12-minute budget, 16-minute lease (outlives the 15-minute platform limit).
- **Lease-token fencing** (active, no SQL): the claim stamps this run's start time; finishing and failing apply only while the Item still carries that token. A run whose lease expired (killed, frozen, duplicate invocation) ends as `superseded` and cannot overwrite the cursor or state of the run that re-claimed the Item. A lease shorter than the budget is refused.
- `netlify/functions/bank/plaid-sync-background.ts`: owner/admin-authenticated handler (same boundary as `plaid-sync`; organization from the caller's profile, body names only the Item). Refuses unless `PLAID_BACKGROUND_SYNC_ENABLED=true`. Kept in the nested folder, so Netlify does not route it.
- `plaid-sync` refuses synchronous syncs while background sync is on. The bank card uses the background path only when the server reports it enabled and Netlify answers 202, then follows status for at most the lease.
- Status (active): sanitized last error code, recovery action (`retry`, `reconnect`, `refresh_accounts`, `owner_review`), recovery text, last attempt and last success.
- Audit: `recordRunEvent` writes append-only `started` / `completed` / `failed` / `superseded` rows with counts, pending-link count and cursor fingerprints (16-hex SHA-256 prefix, never the cursor). Off unless `PLAID_SYNC_AUDIT_ENABLED=true`; audit failures never change a sync outcome.

## SQL (prepared, not installed)

`docs/plaid1b/sync-audit-proposal.sql`: `financial_provider_sync_runs` and `financial_provider_transaction_revisions` (prior values on Plaid modify / remove / restore, via an AFTER UPDATE trigger). Additive, append-only (UPDATE/DELETE refused for every role), RLS owner/admin read, service-role insert, nothing for anon. Verified locally on PGlite, including re-run, isolation and unchanged existing evidence. Install only as one named tracked migration after owner approval; never `supabase db push`; never repair or reapply 157/158.

## Limitations

- Pending to posted: evidence keeps both rows (pending marked removed) and Plaid's `pending_provider_transaction_id` link, and each run counts linked postings. Owner decisions made on a pending row are still **not** carried to the posted row; that needs a reporting/interpretation phase (decision inheritance), outside this phase's boundaries.
- Until the revision SQL is installed, Plaid modifications still overwrite the evidence row in place (the row is never deleted).
- History depth stays at the Item's original 90-day request; all history Plaid actually provides for newly shared accounts arrives through the normal cursor.
- Transactions of a shared-but-unsaved account still fail the whole sync closed (`ACCOUNT_UNKNOWN`, cursor kept; recovery `refresh_accounts`).
- Memory bound unchanged: at most 100 pages / 50,000 rows per update.

## Activation (each step needs separate owner approval)

1. Confirm in the Netlify dashboard that the site's plan includes background functions.
2. Install the audit SQL as one tracked migration (optional for background sync, required for the audit switch); verify grants/RLS read-only.
3. Add `netlify/functions/plaid-sync-background.ts` containing `export { handler } from './bank/plaid-sync-background'`; deploy.
4. Set `PLAID_BACKGROUND_SYNC_ENABLED=true` (and `PLAID_SYNC_AUDIT_ENABLED=true` if installed); run one owner sync; confirm status, Netlify log and audit rows.
5. Only then consider `PLAID_ACCOUNT_ADDITIONS_ENABLED`.

Rollback: unset the switches (the synchronous path returns); keep audit rows.

Tests: `src/services/bankProvider/__tests__/plaid1bReliableSync.test.ts`.
