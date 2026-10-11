# Cash OS multi-account — production install and activation runbook

Status: PREPARED. **Nothing in this file has been executed.** Every step needs the owner's explicit approval, one step at a time.
All checks below are read-only SQL unless the step says "INSTALL". Project: `edxxbtyugohtowvslbfo`.

## 0. Rules that apply to every install

1. **Never** run `supabase db push`, `supabase migration repair`, or re-apply migrations 157/158. Production has the 157 and 158 objects installed but absent from migration history; that is a known, accepted state.
2. Install each proposal as **one named tracked migration** with the supported apply-migration operation (single transaction; every proposal file starts with `BEGIN;` and ends with `COMMIT;`). Do not paste into the SQL editor.
3. Before each install: run `node scripts/plaid/proposal-evidence.mjs` and store the SHA-256 in the approval record. After install, re-run it on the same commit and confirm the hash did not change.
4. Take the **evidence fingerprint** (section 1) before and after. It must be identical.
5. Install in this order; each is independent unless noted: `plaid1c` -> `plaid2a` -> `plaid2c` -> (later phases, see the ledger). Feature switches stay OFF until the install and its validation are confirmed.

## 1. Evidence fingerprint (read-only; run before and after every install)

```sql
SELECT count(*) AS rows,
       count(*) FILTER (WHERE removed_at IS NOT NULL) AS removed,
       md5(string_agg(concat_ws('|', id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, pending_provider_transaction_id,
                                 provider_amount_minor, transaction_date, name, merchant_name, removed_at), ',' ORDER BY id)) AS fingerprint
FROM public.financial_provider_transactions;

SELECT (SELECT count(*) FROM public.financial_provider_interpretations) AS interpretations,
       (SELECT count(*) FROM public.financial_provider_interpretations WHERE status = 'confirmed') AS confirmed,
       (SELECT count(*) FROM public.financial_provider_account_mappings WHERE status = 'active') AS active_mappings,
       (SELECT count(*) FROM public.financial_provider_items) AS items,
       (SELECT string_agg(id::text || ':' || coalesce(md5(sync_cursor), '-'), ',' ORDER BY id) FROM public.financial_provider_items) AS cursor_fingerprints;
```

Install must not change any value above (the new tables are empty). `cursor_fingerprints` shows an MD5 of each committed cursor, never the cursor.

## 2. Preflight (read-only)

```sql
-- 2.1 prerequisites from migrations 153-156 exist
SELECT to_regclass('public.financial_provider_items') IS NOT NULL AS items,
       to_regclass('public.financial_provider_transactions') IS NOT NULL AS transactions,
       to_regclass('public.financial_provider_interpretations') IS NOT NULL AS interpretations,
       to_regproc('public.financial_provider_enforce_immutable') IS NOT NULL AS immutable_guard,
       to_regproc('public.financial_provider_block_update') IS NOT NULL AS block_update_guard,
       to_regproc('public.financial_provider_replace_interpretation') IS NOT NULL AS replace_fn,
       to_regproc('public.financial_provider_connect_item') IS NOT NULL AS connect_fn;   -- all true

-- 2.2 none of the objects this proposal creates exist yet (all false / zero)
SELECT to_regclass('public.financial_provider_sync_staging_runs') IS NOT NULL AS plaid1c_runs,
       to_regclass('public.financial_provider_sync_staged_changes') IS NOT NULL AS plaid1c_staged,
       to_regclass('public.financial_provider_pending_posted_links') IS NOT NULL AS plaid2a_links,
       to_regclass('public.financial_provider_transaction_history') IS NOT NULL AS plaid2c_history;

-- 2.3 migration history: expect the last tracked version to be 156 and 157/158 absent although their objects exist (KNOWN; do not repair)
SELECT max(version) AS last_tracked FROM supabase_migrations.schema_migrations;
SELECT to_regclass('public.financial_provider_merchant_rules') IS NOT NULL AS has_157_objects;   -- true while the version is absent from history

-- 2.4 no sync is mid-flight (an install while a lease is held is safe but pointless)
SELECT id, sync_status, last_sync_started_at FROM public.financial_provider_items WHERE sync_status = 'syncing';

-- 2.5 roles the grants rely on
SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role');   -- three rows
```

Stop and report if any expectation fails.

## 3. INSTALL — PLAID-1C `plaid1c_resumable_sync`

File `docs/plaid1c/resumable-sync-proposal.sql` (hash from `proposal-evidence.mjs`). Creates 2 server-only tables and 6 service-role-only functions; alters nothing existing.

Post-install validation (read-only):

```sql
-- objects and RLS
SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('financial_provider_sync_staging_runs', 'financial_provider_sync_staged_changes');  -- both true
SELECT count(*) FROM public.financial_provider_sync_staging_runs;   -- 0
-- browser roles have NO access to the tables, service_role has
SELECT grantee, table_name, string_agg(privilege_type, ',') FROM information_schema.role_table_grants
 WHERE table_name IN ('financial_provider_sync_staging_runs', 'financial_provider_sync_staged_changes') GROUP BY 1, 2;   -- service_role only
-- functions: EXECUTE for service_role only
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
  FROM pg_proc p WHERE p.proname LIKE 'financial_provider_sync_%run%' OR p.proname = 'financial_provider_sync_stage_page';   -- false, false, true
```

Then re-run section 1 (identical). Switch: none yet.

**Activation (separate approval):** set `PLAID_RESUMABLE_SYNC_ENABLED=true` in Netlify; leave `PLAID_BACKGROUND_SYNC_ENABLED`, `PLAID_ACCOUNT_ADDITIONS_ENABLED` and `PLAID_SYNC_AUDIT_ENABLED` unset. Press Sync once on the existing Item; expect `synced`, progress UI, no new rows beyond Plaid's own changes; re-run section 1 and compare row counts only (new transactions are expected). **Rollback:** unset the switch (the one-shot sync returns). Tables stay as empty/inert evidence.

## 4. INSTALL — PLAID-2A `plaid2a_pending_posted_continuity`

File `docs/plaid2/pending-posted-continuity-proposal.sql`. Creates `financial_provider_pending_posted_links` (RLS: owner/admin select; service_role write) and `financial_provider_link_pending_posted` (service_role only). Adds one partial index on `financial_provider_transactions` (non-blocking for this table size; the index build holds a short write lock on that table).

```sql
SELECT relrowsecurity FROM pg_class WHERE relname = 'financial_provider_pending_posted_links';   -- true
SELECT has_function_privilege('authenticated', 'public.financial_provider_link_pending_posted(uuid,uuid,integer)', 'EXECUTE') AS auth_can,
       has_function_privilege('service_role',  'public.financial_provider_link_pending_posted(uuid,uuid,integer)', 'EXECUTE') AS svc_can;  -- false, true
SELECT count(*) FROM public.financial_provider_pending_posted_links;   -- 0
```

Re-run section 1 (identical). **Activation (separate approval):** `PLAID_PENDING_CONTINUITY_ENABLED=true`. First use: `POST plaid-sync {action:'relink_pending', itemId}`, then review the counts; `ambiguous`/`mismatch` rows are listed by `SELECT * FROM financial_provider_pending_posted_links WHERE status <> 'linked'`. **Rollback:** unset the switch. Inherited decisions are normal interpretation rows (`suggestion_basis.inherited_from_interpretation`) and can be undone one by one; the proposal never alters evidence.

## 5. INSTALL — PLAID-2C `plaid2c_provider_revision_history`

File `docs/plaid2/provider-revision-history-proposal.sql`. Creates the append-only `financial_provider_transaction_history`, three functions and one AFTER UPDATE trigger on `financial_provider_transactions`. **Do not also install the revisions half of the 1B draft.**

```sql
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('trg_fpt_81_history', 'trg_fpth_00_append_only', 'trg_fpth_01_no_truncate');   -- three rows, 'O'
SELECT has_table_privilege('service_role', 'public.financial_provider_transaction_history', 'INSERT') AS can_insert,
       has_table_privilege('service_role', 'public.financial_provider_transaction_history', 'SELECT') AS can_select;   -- false, true
SELECT count(*) FROM public.financial_provider_transaction_history;   -- 0
```

Re-run section 1 (identical). **Cost note:** the trigger adds roughly 2 ms per *changed* provider row on the scratch host; a normal sync changes tens of rows. A 5,000-row mass update measured 11.7 s on the slower scratch host, so very large modification batches should stay below the 50,000-row run cap and the 8 s statement timeout will block them safely (owner review) rather than half-apply. **Activation:** none needed (trigger is the capture). **Rollback:** `DROP TRIGGER trg_fpt_81_history ON public.financial_provider_transactions;` — history already written stays.
Weekly integrity check (read-only): `SELECT * FROM public.financial_provider_verify_history('<organization id>');` must return no rows.

## 6. Later phases

Sections for balances, reconciliation and economic events are appended here by those phases (see `IMPLEMENTATION_LEDGER.md`).
