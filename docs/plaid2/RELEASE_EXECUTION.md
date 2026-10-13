# Cash OS production release — execution kit

Status: **BLOCKED ON ACCESS**. The cloud session that prepared this release cannot reach `app.poweronsolutionsllc.com`,
`edxxbtyugohtowvslbfo.supabase.co`, `api.supabase.com` or `api.netlify.com` (the environment's network policy denies them), and it has no
Supabase or Netlify connector or credential. Code is pushed: `main` = `c45b7b4`. Nothing has been installed or switched in production.

Everything below reuses `PRODUCTION_RUNBOOK.md` and the proposal files exactly. Nothing here is new design.

## 1. Grant access once (owner, about 5 minutes)

1. **Network.** Open this cloud environment's settings (environment menu in the session title bar → Edit → Network access) and add
   these Allowed domains: `app.poweronsolutionsllc.com`, `edxxbtyugohtowvslbfo.supabase.co`, `api.supabase.com`, `api.netlify.com`.
   Keep "Allow package managers" ticked. Docs: https://code.claude.com/docs/en/cloud-environments#network-access
2. **Supabase.** At https://claude.ai/customize/connectors connect **Supabase**, limited to project `edxxbtyugohtowvslbfo`. Its
   `apply_migration` tool installs ONE named migration and records it in the migration history. That is the "named, tracked migration"
   the runbook requires. Its `execute_sql` tool runs the read-only checks.
3. **Netlify.** Connect **Netlify** the same way, if it is offered, so environment variables can be read and set and deploys checked.
   If it is not offered, do section 3 in the Netlify UI yourself.
4. Start a **new** session (connectors and network settings load at session start) and send it:
   > Execute docs/plaid2/RELEASE_EXECUTION.md sections 2-6 exactly. Stop on any check that differs.

**Why not the Supabase CLI.** `supabase db push` and `supabase migration up` are forbidden here. Production has the 157/158 objects
without history rows, so the CLI would try to apply them again. Pasting into the SQL editor would install the SQL without recording a
migration. Use `apply_migration` with the exact name and the exact file contents, and nothing else.

## 2. Verify the deployed code (read-only)

- Netlify → site → Deploys: the latest **Published** production deploy must show commit `c45b7b4` ("Preview classification changes"). If
  the build failed, open its log; fix only that blocker.
- iPad: Cash OS → Transactions → Spending explorer → **Preview classification changes** → Run preview. Record: available, complete,
  money conserved, reconciliation switch (must be Off), transactions compared, would change. **Stop** if complete or money conserved is "No".

## 3. Record the current switch values (read-only first)

Netlify → Site configuration → Environment variables (Production context). Record the value of each variable, or "unset":
`CASH_OS_RECONCILIATION_ENABLED`, `CASH_OS_POSITION_ENABLED`, `PLAID_BALANCES_ENABLED`, `PLAID_RESUMABLE_SYNC_ENABLED`,
`PLAID_PENDING_CONTINUITY_ENABLED`, `PLAID_ACCOUNT_ADDITIONS_ENABLED`, `PLAID_SYNC_AUDIT_ENABLED`, `PLAID_BACKGROUND_SYNC_ENABLED`, `PLAID_ENV`.
`PLAID_ENV` must be `production`. If any switch is already `true`, stop and report before changing anything.

## 4. Install the five migrations (each one: preflight → install → validate → fingerprint)

Before the first install:
1. On commit `c45b7b4`, run `node scripts/plaid/proposal-evidence.mjs`. The five hashes must match the ones recorded in the approval record.
2. Run runbook §1 (evidence fingerprint) and keep the output as BASELINE.
3. Run runbook §2.1, §2.2, §2.4 and §2.5. All expectations must hold. §2.3 must show the last tracked version 156 and 157/158 objects
   present. Do not repair anything.

Then, in this order, each as `apply_migration(name, <exact file contents>)`:

| # | name | file | validate with |
|---|---|---|---|
| 1 | `plaid1c_resumable_sync` | `docs/plaid1c/resumable-sync-proposal.sql` | runbook §3 |
| 2 | `plaid2c_provider_revision_history` | `docs/plaid2/provider-revision-history-proposal.sql` | runbook §5 |
| 3 | `plaid2a_pending_posted_continuity` | `docs/plaid2/pending-posted-continuity-proposal.sql` | runbook §4 |
| 4 | `greenlight1_interpretation_write_lockdown` | `docs/plaid2/interpretation-write-lockdown-proposal.sql` | runbook §9.6 |
| 5 | `plaid3b_match_decisions` | `docs/plaid2/match-decisions-proposal.sql` | runbook §9.2 (preflight before, validation after) |

After **each** install:
- `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;` shows the new name.
- The runbook section's validation passes, exactly as written.
- Runbook §1 output is **identical** to BASELINE: evidence rows and fingerprint, interpretations, confirmed count, active mappings,
  items, cursor fingerprints. Any difference means **stop**: do not continue and do not "fix" data.

This is the same order and the same checks proven on PostgreSQL 16 by `greenlight1MigrationOrder.test.ts`.

## 5. Activate the switches, one at a time (Netlify env var `true` → Trigger deploy → verify → next)

| Order | Switch | Verify before the next one |
|---|---|---|
| 1 | `PLAID_RESUMABLE_SYNC_ENABLED` | Owner presses Sync on the existing Wells Fargo connection once: outcome `synced`. Runbook §1: rows only grow, item count unchanged, the cursor moved once. No staging run left in `blocked`. |
| 2 | `PLAID_PENDING_CONTINUITY_ENABLED` | `POST plaid-sync {action:'relink_pending', itemId}` once (owner session), then `SELECT status, count(*) FROM financial_provider_pending_posted_links GROUP BY 1;` Review any `ambiguous`/`mismatch` rows; nothing is auto-decided. |
| 3 | `PLAID_BALANCES_ENABLED` | Owner presses "Refresh balances" once. Compare each balance with the Wells Fargo app. `financial_provider_balance_snapshots` grows by at most one row per account. |
| 4 | `CASH_OS_RECONCILIATION_ENABLED` | Spending explorer shows **Matches**; the proposals equal the Stage 1 preview list; confirmed owner categories unchanged (runbook §1 confirmed count identical). |
| 5 | `CASH_OS_POSITION_ENABLED` | The "Cash position" panel shows bank cash separately from "What you owe"; unused credit says "not cash"; balances without a bank time say "Bank time unknown"; nothing missing shows as $0. |
| 6 | `PLAID_ACCOUNT_ADDITIONS_ENABLED` | Only after step 1 has been verified on a real sync. Then the owner, present, runs section 6. |

Never set `PLAID_BACKGROUND_SYNC_ENABLED` (Netlify Free). Rollback for any step: unset that variable and trigger a deploy (runbook §8 and §9.4).
Do not delete evidence or decisions.

## 6. Remaining Wells Fargo accounts (owner present; Plaid Link update mode)

Cash OS → Transactions → bank card → **Add accounts at this bank** (existing Item, update mode). Keep all existing accounts selected; the
owner chooses the new ones. Then **Review shared accounts** → **Save new accounts** → **Sync** → map each new account in Cash OS. History
depth is what Plaid provides under the original 90-day request. Never disconnect or recreate the Item.

## 7. Financial checks that need real decisions (owner, in the app; never automated)

- Matches: confirm ONE obvious checking→savings pair. Both legs become a confirmed transfer, Money in is unchanged by it, and
  "Reverse…" restores it.
- A card purchase stays Business spending, and the payment to the card shows under unresolved or transfer, never a second expense.
- A refund confirmed in Matches shows category Refund and is not income.
- Security (read-only SQL after the lockdown): `SELECT has_table_privilege('authenticated','public.financial_provider_interpretations','INSERT');` returns `false`.
