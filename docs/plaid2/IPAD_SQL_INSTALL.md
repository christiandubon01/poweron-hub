# Cash OS — production SQL install from the iPad (Supabase SQL Editor)

Project `edxxbtyugohtowvslbfo`. Reviewed files pinned to commit `6554844` (identical to the reviewed versions; SHA-256 below).
Each block below is ONE statement that returns ONE row, because the SQL Editor shows only the last result of a run. Run them one at a
time: tap **New query**, paste, tap **Run**.

**Stop rule.** If any result differs from "expect", stop and send me the screenshot. Do not retry an install that failed, and do not
"fix" data. Never run `supabase db push`, never run migration repair, and never touch 157/158.

## Why there is an extra "record" step

The SQL Editor runs SQL but does not write a migration-history row. After each install you run one INSERT that records the migration
under its exact name in `supabase_migrations.schema_migrations`. That is the same row Supabase's own apply-migration tool writes. It only
ever adds the five new names and never touches 157/158 or any other history row.

If step P0 shows columns other than `version`, `statements`, `name` (plus optional nullable ones), stop. Then use the alternative: in the
Claude app on the iPad, connect the **Supabase** connector and ask Claude to run `apply_migration` with each file and name below.

## The five files (open each in Safari → "Raw" → Select All → Copy)

| # | Migration name | File | SHA-256 |
|---|---|---|---|
| 1 | `plaid1c_resumable_sync` | [docs/plaid1c/resumable-sync-proposal.sql](https://github.com/christiandubon01/poweron-hub/blob/6554844/docs/plaid1c/resumable-sync-proposal.sql) (409 lines) | `de072e5b85c36a2ca92432085137cc21ea99852b674fd6a8d999dd9a732aa35d` |
| 2 | `plaid2c_provider_revision_history` | [docs/plaid2/provider-revision-history-proposal.sql](https://github.com/christiandubon01/poweron-hub/blob/6554844/docs/plaid2/provider-revision-history-proposal.sql) (175 lines) | `0696b9cac46c923a2c89a6ea49c0f35885114ab3c4ab8b92fe01768c2e6cc023` |
| 3 | `plaid2a_pending_posted_continuity` | [docs/plaid2/pending-posted-continuity-proposal.sql](https://github.com/christiandubon01/poweron-hub/blob/6554844/docs/plaid2/pending-posted-continuity-proposal.sql) (198 lines) | `2458556ba82052c81b9e601d49c3f648adbf5061195cae96693af2fba5704385` |
| 4 | `greenlight1_interpretation_write_lockdown` | [docs/plaid2/interpretation-write-lockdown-proposal.sql](https://github.com/christiandubon01/poweron-hub/blob/6554844/docs/plaid2/interpretation-write-lockdown-proposal.sql) (26 lines) | `a09d996cc76e58a019ed7985f1b151e37eebcb50c0ede8e068a7b007600bd8e8` |
| 5 | `plaid3b_match_decisions` | [docs/plaid2/match-decisions-proposal.sql](https://github.com/christiandubon01/poweron-hub/blob/6554844/docs/plaid2/match-decisions-proposal.sql) (226 lines) | `d3a4a3f5430bc828b15632579a5662814e5e930d7439d0c98571bd1631a3b4ca` |

Every file starts with `BEGIN;` and ends with `COMMIT;`, so it installs completely or not at all. After pasting, check that the first
statement line is `BEGIN;` and the last line is `COMMIT;`, which means the copy is complete. Paste the WHOLE file and nothing else.

---

## Preflight (read-only, once)

**P0 — migration history shape and last entries**

```sql
-- [P0]
SELECT (SELECT string_agg(column_name || ':' || is_nullable, ', ' ORDER BY ordinal_position) FROM information_schema.columns
         WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations') AS columns,
       (SELECT string_agg(version || ' ' || coalesce(name, '-'), ' | ' ORDER BY version DESC) FROM
         (SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3) t) AS last_three;
```

Expect `columns` to contain `version:NO`, `statements:YES` and `name:YES`; any other column must end in `:YES`. Expect `last_three`
to end at the 156 migration. 157/158 being absent is known and accepted.

**FINGERPRINT — run now and save the screenshot as BASELINE (it is re-run after every install)**

```sql
-- [FINGERPRINT]
SELECT (SELECT count(*) FROM public.financial_provider_transactions) AS rows,
       (SELECT count(*) FROM public.financial_provider_transactions WHERE removed_at IS NOT NULL) AS removed,
       (SELECT md5(string_agg(concat_ws('|', id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, pending_provider_transaction_id,
                                         provider_amount_minor, transaction_date, name, merchant_name, removed_at), ',' ORDER BY id))
          FROM public.financial_provider_transactions) AS evidence,
       (SELECT count(*) FROM public.financial_provider_interpretations) AS interpretations,
       (SELECT count(*) FROM public.financial_provider_interpretations WHERE status = 'confirmed') AS confirmed,
       (SELECT count(*) FROM public.financial_provider_account_mappings WHERE status = 'active') AS active_mappings,
       (SELECT count(*) FROM public.financial_provider_items) AS items,
       (SELECT md5(string_agg(id::text || ':' || coalesce(md5(sync_cursor), '-'), ',' ORDER BY id)) FROM public.financial_provider_items) AS cursors;
```

Expected today: rows 505, interpretations 325, active_mappings 1, items 3. All eight values must be identical after every install.

**P1 — prerequisites (migrations 153-156)**

```sql
-- [P1]
SELECT to_regclass('public.financial_provider_items') IS NOT NULL
   AND to_regclass('public.financial_provider_transactions') IS NOT NULL
   AND to_regclass('public.financial_provider_interpretations') IS NOT NULL
   AND to_regproc('public.financial_provider_enforce_immutable') IS NOT NULL
   AND to_regproc('public.financial_provider_block_update') IS NOT NULL
   AND to_regproc('public.financial_provider_replace_interpretation') IS NOT NULL
   AND to_regprocedure('public.financial_provider_connect_item(uuid,text,text,text,text,text,uuid,text)') IS NOT NULL
   AND to_regprocedure('public.financial_provider_json_is_safe(jsonb)') IS NOT NULL
   AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) = 3 AS prerequisites_ok;
```

Expect `prerequisites_ok` = **true**.

**P2 — nothing of the five is installed or recorded yet; no sync in flight**

```sql
-- [P2]
SELECT to_regclass('public.financial_provider_sync_staging_runs') IS NULL AS no_1c,
       to_regclass('public.financial_provider_transaction_history') IS NULL AS no_2c,
       to_regclass('public.financial_provider_pending_posted_links') IS NULL AS no_2a,
       has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'INSERT') AS lockdown_not_yet,
       to_regprocedure('public.financial_provider_decide_match(uuid,uuid,text,uuid,uuid,text,text,jsonb)') IS NULL AS no_3b,
       (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE name IN ('plaid1c_resumable_sync', 'plaid2c_provider_revision_history',
          'plaid2a_pending_posted_continuity', 'greenlight1_interpretation_write_lockdown', 'plaid3b_match_decisions')) AS already_recorded,
       (SELECT count(*) FROM public.financial_provider_items WHERE sync_status = 'syncing') AS syncing_now;
```

Expect `true, true, true, true, true, 0, 0`. If a sync is in flight, wait a few minutes and re-run.

---

## Install 1 — `plaid1c_resumable_sync`

1. Paste and run the whole file `docs/plaid1c/resumable-sync-proposal.sql`. Expect "Success. No rows returned".
2. Record it:

```sql
-- [R1]
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), 'plaid1c_resumable_sync',
        ARRAY['-- installed from docs/plaid1c/resumable-sync-proposal.sql @ 6554844, sha256 de072e5b85c36a2ca92432085137cc21ea99852b674fd6a8d999dd9a732aa35d'])
RETURNING version, name;
```

3. Validate:

```sql
-- [V1]
SELECT (SELECT count(*) FROM pg_class WHERE relname IN ('financial_provider_sync_staging_runs', 'financial_provider_sync_staged_changes') AND relrowsecurity) AS tables_with_rls,
       (SELECT count(*) FROM public.financial_provider_sync_staging_runs) AS runs,
       (SELECT count(*) FROM information_schema.role_table_grants
         WHERE table_name IN ('financial_provider_sync_staging_runs', 'financial_provider_sync_staged_changes') AND grantee IN ('anon', 'authenticated', 'PUBLIC')) AS browser_grants,
       (SELECT count(*) FROM pg_proc p WHERE p.proname IN ('financial_provider_sync_open_run', 'financial_provider_sync_stage_page', 'financial_provider_sync_restart_run',
          'financial_provider_sync_abandon_run', 'financial_provider_sync_apply_run', 'financial_provider_sync_record_apply_failure')
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND has_function_privilege('service_role', p.oid, 'EXECUTE')) AS functions_server_only;
```

Expect `2, 0, 0, 6`.

4. Re-run **FINGERPRINT** and confirm it is identical to BASELINE.

## Install 2 — `plaid2c_provider_revision_history`

1. Paste and run `docs/plaid2/provider-revision-history-proposal.sql`. Expect "Success".
2. Record it:

```sql
-- [R2]
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), 'plaid2c_provider_revision_history',
        ARRAY['-- installed from docs/plaid2/provider-revision-history-proposal.sql @ 6554844, sha256 0696b9cac46c923a2c89a6ea49c0f35885114ab3c4ab8b92fe01768c2e6cc023'])
RETURNING version, name;
```

3. Validate:

```sql
-- [V2]
SELECT (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_fpt_81_history', 'trg_fpth_00_append_only', 'trg_fpth_01_no_truncate') AND tgenabled = 'O') AS triggers,
       has_table_privilege('service_role', 'public.financial_provider_transaction_history', 'INSERT') AS server_can_insert,
       has_table_privilege('service_role', 'public.financial_provider_transaction_history', 'SELECT') AS server_can_read,
       (SELECT count(*) FROM public.financial_provider_transaction_history) AS history_rows;
```

Expect `3, false, true, 0`.

4. Re-run **FINGERPRINT** and confirm it is identical.

## Install 3 — `plaid2a_pending_posted_continuity`

1. Paste and run `docs/plaid2/pending-posted-continuity-proposal.sql`. Expect "Success".
2. Record it:

```sql
-- [R3]
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), 'plaid2a_pending_posted_continuity',
        ARRAY['-- installed from docs/plaid2/pending-posted-continuity-proposal.sql @ 6554844, sha256 2458556ba82052c81b9e601d49c3f648adbf5061195cae96693af2fba5704385'])
RETURNING version, name;
```

3. Validate:

```sql
-- [V3]
SELECT (SELECT relrowsecurity FROM pg_class WHERE relname = 'financial_provider_pending_posted_links') AS rls_on,
       has_function_privilege('authenticated', 'public.financial_provider_link_pending_posted(uuid,uuid,integer)', 'EXECUTE') AS browser_can_run,
       has_function_privilege('service_role', 'public.financial_provider_link_pending_posted(uuid,uuid,integer)', 'EXECUTE') AS server_can_run,
       (SELECT count(*) FROM public.financial_provider_pending_posted_links) AS links;
```

Expect `true, false, true, 0`.

4. Re-run **FINGERPRINT** and confirm it is identical.

## Install 4 — `greenlight1_interpretation_write_lockdown`

1. Paste and run `docs/plaid2/interpretation-write-lockdown-proposal.sql`. Expect "Success".
2. Record it:

```sql
-- [R4]
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), 'greenlight1_interpretation_write_lockdown',
        ARRAY['-- installed from docs/plaid2/interpretation-write-lockdown-proposal.sql @ 6554844, sha256 a09d996cc76e58a019ed7985f1b151e37eebcb50c0ede8e068a7b007600bd8e8'])
RETURNING version, name;
```

3. Validate:

```sql
-- [V4]
SELECT has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'SELECT') AS browser_can_read,
       has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'INSERT') AS browser_can_insert,
       has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'UPDATE') AS browser_can_update,
       has_table_privilege('service_role', 'public.financial_provider_interpretations', 'INSERT') AS server_can_insert,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'financial_provider_interpretations' AND cmd IN ('INSERT', 'UPDATE')) AS write_policies;
```

Expect `true, false, false, true, 0`.

4. Re-run **FINGERPRINT** and confirm it is identical.
5. In the app, confirm one category on any transaction that needs review: it must save as before. The server writes it, so the
   lockdown does not affect it. Interpretations then grows by one; that is the only expected change.

## Install 5 — `plaid3b_match_decisions`

1. Paste and run `docs/plaid2/match-decisions-proposal.sql`. Expect "Success".
2. Record it:

```sql
-- [R5]
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES (to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'), 'plaid3b_match_decisions',
        ARRAY['-- installed from docs/plaid2/match-decisions-proposal.sql @ 6554844, sha256 d3a4a3f5430bc828b15632579a5662814e5e930d7439d0c98571bd1631a3b4ca'])
RETURNING version, name;
```

3. Validate:

```sql
-- [V5]
SELECT p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role,
       array_to_string(p.proconfig, ';') AS config,
       (SELECT outcome FROM public.financial_provider_decide_match(NULL, NULL, 'probe')) AS probe
  FROM pg_proc p WHERE p.proname = 'financial_provider_decide_match';
```

Expect `false, false, false, true, search_path=public, available`. The probe reads and writes nothing.

4. Re-run **FINGERPRINT**. Expect it identical to the value after install 4: the same evidence, and interpretations differing from
   BASELINE only by the one category you saved in install 4, step 5.

**Final check: all five recorded**

```sql
-- [DONE]
SELECT count(*) AS recorded FROM supabase_migrations.schema_migrations
 WHERE name IN ('plaid1c_resumable_sync', 'plaid2c_provider_revision_history', 'plaid2a_pending_posted_continuity',
                'greenlight1_interpretation_write_lockdown', 'plaid3b_match_decisions');
```

Expect `5`.

**Rollback of an individual install** (only if its validation fails): see runbook §3-§5, §9.4 and §9.6. Nothing here deletes evidence.

---

# Netlify switches (after the five installs pass)

**How to set one switch on the iPad.** Go to app.netlify.com → your site → **Site configuration** → **Environment variables**.
- **New switch:** **Add a variable** → **Add a single variable**. Key = the switch name. Choose **Different value for each deploy
  context** and set **Production** = `true`. Leave the other contexts empty, and keep **Functions** included in the scopes. Tap **Create variable**.
- **Existing switch:** **Edit** its Production value instead.

**Then redeploy.** **Deploys** → **Trigger deploy** → **Deploy site**. Wait for **Published**, about 2-3 minutes; functions only read new
values after a deploy. Verify the switch before setting the next one.

First, read the current values and send them to me. The list must show none of these switches, or none set to `true`, and `PLAID_ENV`
must be `production`. Never add `PLAID_BACKGROUND_SYNC_ENABLED`.

| # | Switch | Verify on the iPad before the next one |
|---|---|---|
| 1 | `PLAID_RESUMABLE_SYNC_ENABLED` | Cash OS → Transactions → bank card → **Sync again**. Expect progress, then "Synced". Re-run FINGERPRINT: rows the same or only higher, items 3, interpretations unchanged. Then run [S1] below and expect `0`. |
| 2 | `PLAID_PENDING_CONTINUITY_ENABLED` | **Sync again** once more. Expect "Synced". Run [S2]. Links appear only when a pending charge has since posted, so `0` rows is fine. |
| 3 | `PLAID_BALANCES_ENABLED` | Bank card → **Refresh balances**. Each account shows a balance and its time. Compare with the Wells Fargo app. Any difference beyond pending activity means stop. |
| 4 | `CASH_OS_RECONCILIATION_ENABLED` | Spending explorer → Workflow shows **Matches**; there is NO "needs a database update" banner, because plaid3b is installed. Do not confirm anything yet. Run the Preview classification changes panel: switch now reads "On". |
| 5 | `CASH_OS_POSITION_ENABLED` | A **Cash position** panel appears above the Spending explorer: bank cash per scope, "What you owe" for cards, unused credit marked "not cash", "Bank time unknown" where Wells Fargo gives no time, and nothing missing shown as $0. |
| 6 | `PLAID_ACCOUNT_ADDITIONS_ENABLED` | Only after 1-5 pass. Bank card shows **Add accounts at this bank**. Do NOT tap it until we do the account step together. |

```sql
-- [S1] no resumable run left blocked or mid-flight after the sync
SELECT count(*) AS unfinished_runs FROM public.financial_provider_sync_staging_runs WHERE status NOT IN ('applied', 'abandoned');
```

```sql
-- [S2] pending/posted links by status (empty is fine)
SELECT coalesce(string_agg(status || ':' || n, ', '), 'none') AS links FROM (SELECT status, count(*) AS n FROM public.financial_provider_pending_posted_links GROUP BY status) t;
```

**Rollback of any switch:** set it back to empty (or delete the variable), then **Trigger deploy**. Decisions already saved stay as normal
records you can undo in the app.
