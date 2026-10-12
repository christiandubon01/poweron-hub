# Cash OS multi-account — production install and activation runbook

Status: PREPARED. **Nothing in this file has been executed.** Every step needs the owner's explicit approval, one step at a time.
All checks below are read-only SQL unless the step says "INSTALL". Project: `edxxbtyugohtowvslbfo`.

## 0. Rules that apply to every install

1. **Never** run `supabase db push`, `supabase migration repair`, or re-apply migrations 157/158. Production has the 157 and 158 objects installed but absent from migration history; that is a known, accepted state.
2. Install each proposal as **one named tracked migration** with the supported apply-migration operation (single transaction; every proposal file starts with `BEGIN;` and ends with `COMMIT;`). Do not paste into the SQL editor.
3. Before each install: run `node scripts/plaid/proposal-evidence.mjs` and store the SHA-256 in the approval record. After install, re-run it on the same commit and confirm the hash did not change.
4. Take the **evidence fingerprint** (section 1) before and after. It must be identical.
5. Install in this order (proven on PostgreSQL 16 by `greenlight1MigrationOrder.test.ts`, which runs this runbook's own checks verbatim): `plaid1c` -> `plaid2c` -> `plaid2a` -> `plaid3b` (same order as section 7; plaid3b also installs alone). Feature switches stay OFF until the install and its validation are confirmed.

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
       to_regprocedure('public.financial_provider_connect_item(uuid,text,text,text,text,text,uuid,text)') IS NOT NULL AS connect_fn;   -- all true
-- (GREENLIGHT-1 correction: migration 156 keeps a 7-argument AND an 8-argument connect function on purpose, so the bare name is ambiguous and
--  to_regproc('public.financial_provider_connect_item') returns NULL in production even though both exist. Always name the full signature.)

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
 WHERE table_name IN ('financial_provider_sync_staging_runs', 'financial_provider_sync_staged_changes') GROUP BY 1, 2;   -- service_role (+ the table owner, e.g. postgres); NO anon or authenticated row
-- functions: EXECUTE for service_role only
SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role
  FROM pg_proc p WHERE p.proname IN ('financial_provider_sync_open_run', 'financial_provider_sync_stage_page', 'financial_provider_sync_restart_run',
                                      'financial_provider_sync_abandon_run', 'financial_provider_sync_apply_run', 'financial_provider_sync_record_apply_failure');   -- six rows: false, false, true
-- (GREENLIGHT-1 correction: the earlier filter LIKE '%run%' OR stage_page matched only five of the six functions and missed record_apply_failure.)
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

## 6. Switch-only activations (no SQL to install)

These use tables that already exist in production (migration 153). Each still needs the owner's separate approval, because it makes new reads/writes against production data.

| Switch | Feature | What the first use does | Read-only check afterwards | Rollback |
|---|---|---|---|---|
| `PLAID_BALANCES_ENABLED=true` | PLAID-2E balances | `Refresh balances` on a connection: ONE cached `/accounts/get` (no per-call fee), appends rows to `financial_provider_balance_snapshots` | `SELECT count(*), max(observed_at) FROM financial_provider_balance_snapshots;` rows grow by at most one per account per refresh; `financial_accounts`, `financial_transactions` and mappings unchanged (section 1 fingerprint) | unset the switch; snapshots stay as history |

Not a switch (always on once deployed, harmless without the SQL): the attention list and the blocked-run review (needs the 1C SQL to ever see a blocked run).

**Correction (PLAID-3A):** the reconciliation engine and the Explorer's mirrored confirmed-transfer leg are NOT always on. An earlier version of this section said they were, and the code did run them unconditionally. They now run only when `CASH_OS_RECONCILIATION_ENABLED` is exactly `true`; with it unset the classification is proven identical to the pre-engine implementation (section 9).

## 7. Recommended activation order (each step waits for approval and a green validation)

1. Install **plaid1c** → validate (section 3) → `PLAID_RESUMABLE_SYNC_ENABLED=true` → one owner Sync of the existing Item → check section 1 (rows only grow; cursor moves once).
2. Install **plaid2c** (history) *before* the first large modification batches, so revisions are captured from the start → validate (section 5).
3. Install **plaid2a** → validate (section 4) → `PLAID_PENDING_CONTINUITY_ENABLED=true` → `relink_pending` once → review `status <> 'linked'` rows.
4. `PLAID_BALANCES_ENABLED=true` → Refresh balances → compare against the bank's own screens before trusting them (freshness shown per account).
5. Cash OS reconciliation, Matches review and the consolidated position (PLAID-3; section 9): impact preview first (read-only, switch still off) -> install **plaid3b** -> `CASH_OS_RECONCILIATION_ENABLED=true` -> review proposals one at a time -> `CASH_OS_POSITION_ENABLED=true` (needs `PLAID_BALANCES_ENABLED=true` for balance figures).
6. Only then, with the owner present: `PLAID_ACCOUNT_ADDITIONS_ENABLED=true` → Add accounts at this bank (Plaid Link update mode, keep existing accounts selected) → Review shared accounts → Save new accounts → Sync (new accounts arrive through the same cursor; history depth is whatever Plaid makes available; the Item's 90-day request is fixed) → map the new accounts in Cash OS.
7. Optional: install the **plaid1b** `financial_provider_sync_runs` half (not its revisions half) → `PLAID_SYNC_AUDIT_ENABLED=true`.

Never: `PLAID_BACKGROUND_SYNC_ENABLED` on Netlify Free (background functions are Pro/Enterprise; unverified for this site).

## 8. Disable / rollback summary

Unset the switch → feature off, nothing else changes. History, snapshots, links and inherited decisions already written are ordinary rows the owner can read; inherited decisions can be undone individually. No step deletes provider evidence.

## 9. PLAID-3: reconciliation switch, Matches review, consolidated position

Status: PREPARED. Nothing here has been installed or enabled. Three independent switches and one SQL proposal:

| Switch (Netlify env, exact value `true`) | Default | What it turns on | Needs |
|---|---|---|---|
| `CASH_OS_RECONCILIATION_ENABLED` | off | the pairing engine (transfers, card payments, refunds), the **Matches** mode in the Spending Explorer, pair-aware reports | nothing for reading; **plaid3b** for deciding |
| `CASH_OS_POSITION_ENABLED` | off | `GET plaid-position` and the cash position panel | `PLAID_BALANCES_ENABLED=true` for any balance figure (otherwise "not available", never zero) |
| `PLAID_BALANCES_ENABLED` | off | (existing) balances | see section 6 |

With every switch unset, the product behaves exactly as it did before this work: the classification is the frozen pre-engine implementation (a differential test replays hundreds of generated organizations, including dense histories, against it), the Explorer payload gains no key, `plaid-position` answers `{enabled:false}` before reading anything, and the Matches mode is not offered.

### 9.1 Read-only impact preview (do this BEFORE enabling anything; the switch stays off)

As the signed-in owner, request `GET /.netlify/functions/plaid-spending?impact=1&from=YYYY-MM-DD&to=YYYY-MM-DD`. It classifies every posted row twice (switch off and on) and lists, per activity (income / business / personal / debt / transfer / refund / unresolved), the counts and amounts both ways and every row that moves (capped at 200, with a note when truncated). Money in and out must be **conserved** (`summary.conserved: true`). Expected differences: proposed transfer and card-payment legs leave "Money in" / "Business spending" and become "unresolved" until confirmed; ambiguous groups are no longer paired arbitrarily. Read the list; nothing changes in the database.

### 9.2 INSTALL — PLAID-3B `plaid3b_match_decisions` (needs approval)

File `docs/plaid2/match-decisions-proposal.sql` (hash: `node scripts/plaid/proposal-evidence.mjs`). One function, `financial_provider_decide_match`, **SECURITY INVOKER**, fixed `search_path`, `EXECUTE` for `service_role` only. It creates no table, column or index and writes only `financial_provider_interpretations` rows (it only *locks* provider evidence). Install as one named tracked migration; never `db push`. Preflight: section 2.1 plus

```sql
SELECT to_regprocedure('public.financial_provider_decide_match(uuid,uuid,text,uuid,uuid,text,text,jsonb)') IS NOT NULL AS already_there;   -- false
SELECT to_regprocedure('public.financial_provider_json_is_safe(jsonb)') IS NOT NULL AS json_guard;                                         -- true
-- (GREENLIGHT-1 correction: these two lines used to call to_regproc with an argument list. to_regproc only accepts a bare name and returns NULL
--  for 'name(args)', so the old lines answered already_there=false and json_guard=false whatever the database contained: the install would have
--  been stopped by a false failure, and an existing function would never have been noticed. to_regprocedure takes the full signature.)
```

Post-install validation (read-only):

```sql
SELECT p.prosecdef AS security_definer,                                             -- false
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,           -- false
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,  -- false
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,   -- true
       p.proconfig                                                                  -- {search_path=public}
  FROM pg_proc p WHERE p.proname = 'financial_provider_decide_match';
```

Then re-run the section 1 fingerprint (identical: nothing was written). With the SQL installed and the switch on, the Matches screen's "database update" banner disappears (a probe call, which touches no data).

### 9.3 Activation (separate approval, one switch at a time)

1. `CASH_OS_RECONCILIATION_ENABLED=true`. Open Cash OS -> Transactions -> Spending explorer -> **Matches**. Nothing is decided for the owner. Work the **To review** list one pair at a time: "Why this match?", both accounts, dates and amounts side by side. **Confirm match** writes two interpretation rows; **Not a match** writes one; **Reverse…** (two taps) undoes both. A business<->personal pair is flagged: confirming it records an owner draw or contribution, not an ordinary transfer.
2. Check after the first confirmation (read-only): `SELECT provider_transaction_ref, kind, status, counterpart_provider_transaction_ref, suggestion_basis ->> 'pair_id' AS pair FROM financial_provider_interpretations WHERE kind = 'transfer' ORDER BY created_at DESC LIMIT 4;` — two `confirmed` rows naming each other with the same pair id. Section 1 fingerprint: evidence, mappings and items unchanged (only the interpretation count grows).
3. `CASH_OS_POSITION_ENABLED=true` (with `PLAID_BALANCES_ENABLED=true` and one Refresh balances). The **Cash position** panel appears above the Spending explorer. Compare each balance with the bank's own screen; unclassified money in is deliberately **not** income until you confirm it as a customer payment.

### 9.4 Rollback

Unset a switch and redeploy the environment: the feature disappears and the code returns to the proven legacy behavior. Pair decisions already written are ordinary interpretation rows: each leg names the other, so the reports keep treating a confirmed pair as one internal movement even with the switch off (a test pins this); the owner can still undo any decision from the Explorer. Dropping the function after uninstalling loses nothing: `DROP FUNCTION public.financial_provider_decide_match(uuid, uuid, text, uuid, uuid, text, text, jsonb);`

### 9.5 Operational limits (Netlify Free, measured; see the ledger)

At the largest evidence set a request can hold (50,000 rows, the complete report source) the in-process computation is about 2-3 s (explorer rows 1.7-2.3 s, reconciliation 0.4 s, position 0.07 s). The Explorer window is capped at 5,000 rows (about 0.2 s). Native PostgreSQL 16 at 50,000 evidence / 20,000 decision rows: pair-decision read 4 ms, newest balance 0.1 ms, evidence page 20 ms, pair function p50/p95 51/58 ms. These are measurements on a scratch host, not a production verification.


### 9.6 INSTALL — GREENLIGHT-1 `greenlight1_interpretation_write_lockdown` (finding B-1; needs approval; recommended before 9.2 is used)

File `docs/plaid2/interpretation-write-lockdown-proposal.sql` (hash: `node scripts/plaid/proposal-evidence.mjs`). Drops the two owner/admin INSERT/UPDATE
policies on `financial_provider_interpretations` and revokes INSERT/UPDATE from browser roles. Owners/admins keep SELECT; the server (service_role) is
unaffected; no row, column or object is created or changed. Why: since migration 153 an owner or admin could write decision rows directly through the
public API (bypassing the server), including rows attributed to another person or backdated. No browser code uses that access.

Preflight (read-only):

```sql
SELECT has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'INSERT') AS browser_can_insert;   -- true (today)
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'financial_provider_interpretations' ORDER BY policyname;     -- select + insert + update policies
```

Post-install validation (read-only):

```sql
SELECT has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'SELECT') AS can_read,     -- true
       has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'INSERT') AS can_insert,   -- false
       has_table_privilege('authenticated', 'public.financial_provider_interpretations', 'UPDATE') AS can_update,   -- false
       has_table_privilege('service_role',  'public.financial_provider_interpretations', 'INSERT') AS server_can_insert;   -- true
SELECT count(*) FROM pg_policies WHERE tablename = 'financial_provider_interpretations' AND cmd IN ('INSERT', 'UPDATE');   -- 0
```

Then re-run the section 1 fingerprint (identical) and make one ordinary decision in the Explorer (e.g. confirm a category): it must save as before.
**Rollback:** re-create the two policies exactly as in migration 156 (lines 206-212) and `GRANT INSERT, UPDATE ON public.financial_provider_interpretations TO authenticated;`.
