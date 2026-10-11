# PLAID-1E — final apply performance correction

Status: corrected and tested; still **not installed and not activated**. No production SQL, no switch, no Plaid or financial-data change.

## Correction (docs/plaid1c/resumable-sync-proposal.sql)

`financial_provider_sync_apply_run`, removal step only. PLAID-1D measured the old version as quadratic. It updated evidence through a join against a window query over the staged rows, and the planner re-sorted every staged row once per existing evidence row on the Item.

The corrected step does this instead:

1. Collect, once, the transaction ids whose last staged event is a removal (same ordering as before: page, then added < modified < removed, then position) into `v_removed_ids`.
2. Run `UPDATE ... SET removed_at = now() WHERE provider_item_ref = p_item_id AND provider_transaction_id = ANY (v_removed_ids) AND organization_id = p_organization_id AND removed_at IS NULL`. This goes through the identity index.
3. Read the removed count with `GET DIAGNOSTICS ... ROW_COUNT`.

Everything else in the apply is unchanged:

- One transaction for the evidence and the cursor.
- Lease fencing, the generation check and the cursor compare-and-set.
- Organization checks.
- Upserts that keep row ids.
- Soft removal only.

## Safeguards

- **Run-size limit: 50,000 staged rows.**
  - `financial_provider_sync_stage_page(..., p_max_rows DEFAULT 50000)` keeps a `staged_rows` counter on the run.
  - A page that would exceed the limit is not staged. The run becomes `blocked` with `RUN_TOO_LARGE`, and the rows already staged are kept.
  - Callers can lower the limit but never raise it.
- **Repeated apply failures.**
  - New function: `financial_provider_sync_record_apply_failure`, service-role only and SECURITY INVOKER.
  - After a failed apply, which rolls back completely, the step counts the failure in its own transaction. Only the request holding the lease, on the current generation, is counted.
  - The third failure blocks the run with `APPLY_FAILED_REPEATEDLY`. The limit can be lowered, never raised.
- **Behaviour of a blocked run.**
  - It is never applied, restarted, expired or replaced automatically.
  - The open run is returned as is, and the step reports `RUN_TOO_LARGE` or `APPLY_BLOCKED` (recovery `owner_review`) without calling Plaid.
  - The only exit is an explicit `financial_provider_sync_abandon_run` after owner review. There is no UI for that yet.
- **Schema additions** (the SQL is still uninstalled, so the draft table definition was edited directly):
  - Run status `blocked`.
  - Columns `staged_rows`, `apply_failures` and `blocked_reason`.
  - The open-run unique index now includes `blocked`.

## Measurements

Scratch PostgreSQL 16, `statement_timeout = 8s` (Supabase's effective `service_role` default), bank migrations 153–158 loaded, executed as `service_role`, staging and apply timed separately.

| Case | Staging (pages × avg) | Final apply |
|---|---|---|
| 2,000 added | 4 × 24 ms | 60 ms |
| 12,000 added | 24 × 20 ms | 468 ms |
| 25,000 added | 50 × 19 ms | 1,002 ms |
| 50,000 added | 100 × 20 ms | 1,989 ms |
| 10,000 mixed on 10,000 existing | 20 × 15 ms | 585 ms |
| 50,000 mixed on 50,000 existing | 100 × 15 ms | 2,923 ms |
| 500 mixed on 50,000 existing | 1 × 16 ms | 59 ms |
| 500 mixed on 100,000 existing | 1 × 16 ms | 67 ms |

The PLAID-1D figures for the old form were 61 s at 12,000 and 260 s at 25,000.

- **Real statement-timeout cancel.** I applied 50,000 mixed changes over 20,000 existing rows with a 500 ms timeout, and the apply was cancelled at about 500 ms. Afterwards:
  - The evidence hash was unchanged.
  - The cursor and lease were unchanged.
  - The run was still `fetched` with 50,000 staged rows.
  - Re-applying with the 8 s timeout succeeded in 2.37 s.
- **PGlite** (the test suite) gives these timings: 12k apply 0.85 s, 50k apply 3.9 s, 500 changes on 50k existing 0.08 s.

## Tests

- `src/services/bankProvider/__tests__/plaid1eFinalApply.test.ts` (9 tests, SQL level, PGlite, migrations 139–147 and 153–158). It covers:
  - 12k and 50k apply, with a linearity bound.
  - A small update on 50k existing rows.
  - 10k mixed changes with row ids kept.
  - Last-event ordering across pages.
  - Rollback after an injected `query_canceled` (57014) part-way through the apply.
  - Repeated-failure blocking, plus the stale, lease, generation and organization checks.
  - The 50,000-row cap, which a caller cannot raise.
  - Fencing, the cursor compare-and-set and isolation.
  - Function security.
- `plaid1cResumableSync.test.ts`: two new end-to-end step tests, for run size and for repeated apply failures, both ending in owner review with no Plaid call. The 24-page / 12,000-row test now takes 1.7 s instead of 97 s.

## Remaining risks

- Production compute is Supabase nano/shared and slower than the scratch host. A 50k apply measured at 2–4 s, which leaves headroom under 8 s but not unlimited headroom. The 50k cap bounds it.
- A blocked run needs a manual, owner-approved abandon. No UI is provided.
- `record_apply_failure` is not called when Netlify kills the request mid-apply. The database statement still ends by commit or by its own timeout, and a timeout error is returned to a live request within 8 s, which is less than the Netlify limit.
- Pending-to-posted decision inheritance and revision history are unchanged from PLAID-1B and PLAID-1C.

## Activation (unchanged; each step needs separate owner approval)

1. Install the corrected `docs/plaid1c/resumable-sync-proposal.sql` as ONE tracked migration, `plaid1c_resumable_sync`, on `edxxbtyugohtowvslbfo`. Use the supported tracked apply-migration operation, not `supabase db push`, migration repair or the SQL Editor. 157/158 stay as they are.
2. Set `PLAID_RESUMABLE_SYNC_ENABLED=true`, leaving background sync unset.
