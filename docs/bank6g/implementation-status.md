# BANK-6G release acceptance checkpoint

Updated 2026-10-09. Owner-approved ignored-activity policy is implemented. Production recommendation: **NO-GO pending the gates below**. Overall completion: **93%**; implementation and local verification complete, hosted/Safari acceptance outstanding, production rollout 0%.

## Recovered state

Branch `bank-6g-hierarchy`, original HEAD/BANK-6F baseline `2ca7eaf03375ea386014715538a0836513885069`. Recovery found all BANK-6G implementation and evidence uncommitted, including this previously stale document. No unrelated tracked changes were identified. No implementation was restarted. All intended BANK-6G changes and this checkpoint are now saved in a local review commit; working tree is clean. Use `git rev-parse HEAD` for its exact SHA. No push, merge, deployment, production writes or migration application was performed.

## Five phases

| Phase | Verified result | Remaining gate |
|---|---|---|
| 1. Compatibility | Confirmed unfamiliar keys remain reviewed; built-in contracts and custom suggestion exclusions preserved. | Preserve these readers through any rollback after custom assignment. |
| 2. Metadata/security | Review-only SQL; local PostgreSQL tests for org isolation, owner/admin authority, gate, stable keys, parent/category lifecycle, atomic colors and audit. Integration installs draft over actual application migrations locally. | SQL approval, registered migration, nonproduction Supabase validation and concurrent-session testing. |
| 3. Workflows/reporting | Hierarchy management, leaf-only inline creation, Smart Review, three report modes and parent → leaf → evidence drill-down implemented. Definition creation does not approve transactions. | Hosted acceptance with a separate database and synthetic organization. |
| 4. Tests/UI | Previous reported run: 629 tests / 31 files and production build passed. Recovery run: 45 targeted tests / 6 files passed. Eighteen screenshots retained/captured. | Real Safari/iPad acceptance; previous broad-run logs were lost with temporary execution storage. |
| 5. Release preparation | This status, SQL draft, deployment/rollback gates and evidence index refreshed. | Separate owner approvals for migration, merge, deployment and production custom-write enablement. |

## Targeted regression evidence

Command:

```sh
npx vitest run src/services/bankProvider/__tests__/bank6g*.test.ts \
  src/features/spending-explorer/bank6gWorkflow.test.tsx \
  src/features/spending-explorer/bank6fContract.test.tsx --maxWorkers=2
npm run build
```

45 tests passed: reporting 16, compatibility 2, SQL security/lifecycle 10, application-migration integration 2, workflow 4, BANK-6F contracts 11. The first recovery attempt lacked temporary PGlite/Plaid dependencies; restoring the existing pinned dependencies outside the repository resolved it. No package manifests/lockfiles changed. Recovery production build passed (TypeScript and Vite, existing browser-data/eval/chunk-size warnings). Build result is recorded in `acceptance-build.log`; targeted results in `acceptance-tests.log`.

Invariants: existing evidence/confirmed decisions and amounts unchanged; custom creation separate from assignment/approval; all three populations reconcile parent/leaf/row counts and amounts; ignored posted evidence contributes once to All Money Activity and never to either spending population or normal expense hierarchy; personal, debt, verified paired transfers and refunds remain distinct. Category names cannot establish relationships. Pending/removed evidence never contributes posted totals. Duplicate IDs, unsafe amounts, source caps or response-size limits withhold complete totals. Reports are bank-evidence views, not canonical accounting or tax reports. No new financial ledger or Money Plan allocation writes are introduced.

Relevant implementation: `src/services/bankProvider/spending/reporting.ts`, `reportingRepo.ts`, `hierarchy.ts`, `spendingService.ts`; UI `src/features/spending-explorer/SpendingReports.tsx`, `HierarchyManager.tsx`, `HierarchyProvider.tsx`, `BucketPicker.tsx`, `SmartReview.tsx`. Tests named above verify the same paths, including RLS and unchanged interpretation RPC authority.

## Hosted preview: exact blocker

No hosted preview URL was produced. `netlify.toml` defines the existing production build/functions workflow, but has no checked-in deploy-preview database isolation configuration; no `.github/workflows` exists. Current managed environment reports no configured credentials/capabilities and restricts outbound networking to package-manager hosts (Netlify is absent). Netlify account-side preview settings and database credentials therefore cannot be verified here. A branch preview must not be assumed to isolate Supabase merely because its URL differs.

Even if the app were built on a preview URL, hierarchy management and complete reporting require the draft's registry/control tables and RPCs. The production database does not have those BANK-6G objects. Missing hierarchy RPC falls back to protected built-ins/write-disabled; missing report source withholds totals. This is not a working hierarchy acceptance environment.

Use an existing isolated nonproduction Netlify context and Supabase project only after verifying isolation; apply separately approved SQL there, seed synthetic evidence and enable writes for the synthetic owner organization. No production credentials/data or Plaid connections are required for this acceptance. The local fixture at `preview.html` demonstrates actual UI components with synthetic data and injected persistence; it is not hosted database/end-to-end acceptance.

## Migration dependencies and deployment order

Review draft: `hierarchy-proposal.sql`, deliberately outside `supabase/migrations`; not queued or applied. Prior read-only production catalog verification on 2026-10-09: Supabase project `edxxbtyugohtowvslbfo` history ends at 156; 157/158 entries absent although merchant-rule/display-color objects exist. Existing `cash_os_set_display_color(text,text,text)` and 15-argument `financial_provider_replace_interpretation` are SECURITY INVOKER. Do not reapply 157/158 or repair history in BANK-6G; do not use production `supabase db push`.

1. Technical lead reviews exact SQL, grants/RLS/trigger locks, snapshot limits and new-organization initialization. Register a uniquely identified migration using the normal CLI workflow only after review; no migration number is guessed here.
2. Verify isolated nonproduction deployment/database scope. Apply approved SQL there; validate actual Supabase auth/PostgREST grants, concurrent archive/assign and parent archive/child creation, complete source reads and response caps with synthetic data. Test old/new readers with writes disabled.
3. Obtain hosted owner acceptance and real iPad Safari light/dark verification. Freeze the reviewed SQL and app commit.
4. Obtain separate production migration approval. Immediately recheck production catalog prerequisites and history read-only; apply only the approved BANK-6G SQL through the approved controlled procedure, with custom writes disabled. Seed metadata only; no evidence/interpretation rewrites.
5. After separate merge/deployment approval, release compatible application readers/UI (write gate still off). Production smoke checks must confirm existing categories and explicit incomplete states without changing financial data.
6. Obtain separate production custom-write enablement approval; enable only approved organizations after backup and smoke validation. Existing/new organizations need seeded definitions and controls; automatic future-organization initialization is not supplied by this draft.

## Owner acceptance and remaining risks

- Review parent taxonomy and broad built-in meanings; no silent historical splitting.
- On isolated hosted data: create a parent/leaf, optionally color, save definition, then separately Apply/approve. Cancel must preserve existing transaction decisions. Repeat in Smart Review; custom merchant remembering remains unavailable.
- Rename/move/recolor/archive custom leaves, verify historical reporting uses current hierarchy and audits retain prior metadata. Verify members/anonymous/other organizations cannot manage/read it.
- Confirm all three scopes and drill-down totals, separate refunds, personal/debt/transfers, unresolved relationships, ignored subtotal as a component, pending/removed visibility and incomplete-coverage behavior.
- Verify iPad Safari sheets, focus/scroll, touch interaction, themes and date/account controls. Chromium touch viewport testing is not Safari PASS.
- Validate full hosted PostgreSQL/RLS behavior and concurrency; local PGlite is useful regression evidence but not hosted acceptance. Snapshot/response caps intentionally return incomplete coverage rather than misleading totals; large organizations may require later pagination architecture.

## Rollback readiness

Disable custom writes first. Preserve registry/control/history and every interpretation. Restore a reader-compatible application commit; hide new reporting/management surfaces if necessary. Never delete registry metadata or restore the unpatched BANK-6F reader once custom keys exist. If reverting the UI, retain the custom-key compatibility reader patch. No financial posting reversal is required because no ledger/allocation posting is introduced. The draft is not a destructive down migration; preservation is the safe rollback. These procedures remain review plans, not executed production actions.

See `evidence.md` for clickable screenshots. No production changes are authorized by this checkpoint.
