# Cash OS multi-account integration — implementation ledger

Durable record for resuming this workstream in any session. Newest checkpoints at the bottom of each section. Nothing here is activated or installed in production.

## Baseline verified (session start)

- Repository `main`, local copy was stale (`fe8b671`); fast-forwarded to `origin/main` = `27d1950` (PLAID-1E). No history rewrite.
- `npx tsc --noEmit`: clean. `npx vitest run src/services/bankProvider`: 28 files / 555 tests, all passing (the earlier "583 bank tests" figure includes other bank folders).
- Feature switches (all OFF/unset in production per owner report; not verifiable from this environment): `PLAID_RESUMABLE_SYNC_ENABLED`, `PLAID_ACCOUNT_ADDITIONS_ENABLED`, `PLAID_BACKGROUND_SYNC_ENABLED`, `PLAID_SYNC_AUDIT_ENABLED`.

## Phases

| Phase | Track | Status | Commit | Notes |
|---|---|---|---|---|
| PLAID-1A..1E | D/H | done (earlier) | 28c8efb, 6fbd085, 04d815e, 27d1950 | inactive |
| PLAID-2-RUNBOOK | A | done | see checkpoint 1 | `PRODUCTION_RUNBOOK.md`, `scripts/plaid/proposal-evidence.mjs` |
| PLAID-2A | B | done, inactive | see checkpoint 1 | pending→posted continuity |
| PLAID-2C | C | done, inactive | see checkpoint 1 | hash-chained provider-fact history |

## Prepared but UNINSTALLED SQL

| Proposal | File | Suggested migration name | Depends on | Switch |
|---|---|---|---|---|
| PLAID-1B audit (sync_runs half) | docs/plaid1b/sync-audit-proposal.sql | plaid1b_sync_audit | 153-156 | PLAID_SYNC_AUDIT_ENABLED |
| PLAID-1C resumable sync (+1E) | docs/plaid1c/resumable-sync-proposal.sql | plaid1c_resumable_sync | 153-156 | PLAID_RESUMABLE_SYNC_ENABLED |
| PLAID-2A continuity | docs/plaid2/pending-posted-continuity-proposal.sql | plaid2a_pending_posted_continuity | 153-156 | PLAID_PENDING_CONTINUITY_ENABLED |
| PLAID-2C revision history | docs/plaid2/provider-revision-history-proposal.sql | plaid2c_provider_revision_history | 153-156 (1C optional, for run provenance) | none (trigger) |

Hashes: `node scripts/plaid/proposal-evidence.mjs`. 1B's revisions half is superseded by 2C: install 1B only for `financial_provider_sync_runs`, or skip it.

## Owner approval gates (all BLOCKED_PENDING_OWNER_APPROVAL)

1. Install plaid1c SQL → then enable `PLAID_RESUMABLE_SYNC_ENABLED`.
2. Install plaid2a SQL → then enable `PLAID_PENDING_CONTINUITY_ENABLED`; run `relink_pending` once and review non-linked rows.
3. Install plaid2c SQL.
4. Install plaid1b sync_runs (optional) → `PLAID_SYNC_AUDIT_ENABLED`.
5. Enable `PLAID_ACCOUNT_ADDITIONS_ENABLED`; launch Plaid Link update mode for the Wells Fargo Item; save previewed accounts.
6. Never without a separate request: BANK-6H category proposal; repair of migrations 157/158; Netlify upgrade; production sync.

## Checkpoints

(appended per phase)
