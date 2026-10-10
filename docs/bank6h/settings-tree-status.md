# Cash OS Settings tree and cleanup

2026-10-10. Continues from main `fec71c75`. No production SQL, category organization changes, financial writes or BANK-6H bulk-write activation.

## Shipped safe application changes

- Existing **Colors** button is now **Settings**, including Smart Review access. The existing Classification Settings manager is the single expandable tree. The previous duplicate parent/category color lists are retired from Explorer Settings; existing account colors, tint controls and device-color import remain accessible.
- **Business** and **Personal** are visual navigation folders, not a new persisted classification level or ownership decision. The existing built-in spending groups appear under Business and the existing Personal group under Personal, using stable keys, never names or bank accounts. Income and movement groups remain under **Other money activity**. Unknown custom groups and unparented leaves remain **Unorganized**, rather than being guessed into a financial context.
- Existing parents remain expandable and leaves are indented with aligned branches, color dots, explicit Parent bucket/Category labels and touch targets. Every definition appears once. This deliberately preserves existing parent membership rather than silently converting the production taxonomy into the requested flatter example. New Debt, Bills, Education or repeated Subscriptions/Fuel leaves can be created explicitly using the existing form; names never prove financial relationships.
- Add, Rename, Change Color, leaf Move and custom Archive/Restore reuse existing services, forms, immutable keys, audit and organization gate. Built-in destructive controls are protected. The existing 24-color palette stays keyed by definition identity. Business Add starts an explicit draft under an available Business/Overhead group; Personal Add uses the existing Personal group. Nothing is saved until the owner saves the form.
- Category-name validation now allows identical leaf names under different parents while rejecting case/whitespace-equivalent names under the same parent, including archived definitions. Parent names remain organization-wide unique; unparented leaves share one null-parent scope. Moving a leaf checks its destination scope.

## Cleanup previews and protected actions

Merge, Delete and parent-to-category conversion open read-only planning panels. A new GET on the existing authenticated spending endpoint inventories organization-scoped category references in **all interpretation statuses** and **all merchant-rule statuses**, across all dates/environments. Parent previews include all existing children. Exact per-table counts and up to 200 records/table are shown; larger lists explicitly say partial. An inventory is not deletion eligibility: separate reads are not an atomic snapshot, and audit/other references are not fully enumerated.

Populated deletion previews offer **Review merge instead**. Merge lets the owner choose a destination and inspect the source reference IDs/statuses. Parent merges plan child-membership moves; leaf merges plan category-only reassignment. Historical decisions, merchant rules, financial links and evidence are never changed by previews. A final exact eligible-record preview, expected-version checks and explicit confirmation remain required before any future execution.

Conversion collects a proposed new leaf name and destination parent, shows the existing children/reference inventory, and explains creation of a distinct leaf key, explicit child relocation, preservation of the old identity/history and retirement only after eligibility checks. It never mutates a record's identity/type.

**All Merge/Delete/conversion execution is disabled unconditionally.** Parent navigation-root Move is also pending a reviewed persisted mapping or conversion plan; no name-based root inference is offered. No cleanup POST action, deletion privilege, execution RPC, automatic merchant rule or classification write was added. BANK-6H bulk saving is unchanged and remains behind its existing installation gate.

## SQL review requirements

The pending [definition-names-proposal.sql](definition-names-proposal.sql) was revised **before installation**: two unique expression indexes, parent names per organization and leaf names per organization + parent. No table, key, record, authorization, audit or financial semantics change. Read-only production preflight confirmed only the existing primary-key indexes and **zero duplicate leaf names within a parent**. The draft refuses to run if the earlier uninstalled global leaf-name index unexpectedly exists; it never silently drops that index. Recheck duplicates before separately authorized installation and record only this named change. Never reapply/repair migrations 157/158 or run unrestricted database push.

Until the index draft is approved/installed, UI duplicate checks cannot prevent simultaneous or direct-RPC duplicate saves. This limitation is unchanged in nature from the earlier release, with corrected parent scope.

Future cleanup SQL requires separate review and approval: authenticated owner/admin organization checks, registry locking, an atomic inventory including confirmed/suggested/undone decisions, merchant rules, audit and dependent metadata; no physical deletion of referenced identities; a tombstone/archive policy preserving history; immutable built-in protections; version-checked category-only replacement for any explicitly selected current transaction changes; idempotent retries and auditable metadata moves. It must never rewrite old decisions, mutate canonical evidence/ledger, infer debt/ownership, or enable BANK-6H saving as a side effect. No destructive SQL is supplied or installed in this release.

## Verification and evidence

- **226 focused tests passed across 17 files**, covering existing Explorer/Smart Review/color contracts, parent-scoped names, persistent registry reads and unchanged historical classifications, local PostgreSQL isolation/authorization, guard/replacement/undo, BANK-6H selection integrity, read-only cleanup scope/caps/errors and disabled execution. The final manager/cleanup changes were additionally rechecked: **7/7 tests**.
- TypeScript and production build passed. Existing bundle-size/Browserslist/eruda warnings remain unrelated.
- Synthetic Chromium touch checks: expandable roots, shared palette, explicit rename/move, both themes and widths 1024/768/390; no horizontal overflow or page errors. **Not actual Safari/WebKit verification.**
- Evidence: [dark tree](screenshots/settings-tree-dark.png), [palette](screenshots/settings-palette-dark.png), [moved leaf](screenshots/settings-moved-leaf.png), [light tree](screenshots/settings-tree-light.png), [390 touch](screenshots/settings-touch-390.png), [browser results](screenshots/settings-browser-evidence.json), [cleanup inventory](screenshots/settings-cleanup-preview.png), [merge draft](screenshots/settings-merge-draft.png), [conversion draft](screenshots/settings-conversion-draft.png). All captures use synthetic data; cleanup execution is disabled.

## Acceptance and rollback

Owner iPad acceptance: open Settings; expand Business/Personal/current groups; check branch alignment, colors and readable actions; create an explicit custom leaf; rename/move it, refresh and confirm persistence; use the same name under another parent; verify a same-parent duplicate is rejected; archive/restore a custom leaf; inspect read-only cleanup references and confirm execution stays disabled. Check income/refunds/transfers remain accessible and all Explorer/Smart Review financial-link distinctions remain intact.

No production categories were flattened, merged, deleted or reclassified. Approving an eventual flatter Business/Personal taxonomy is a separate explicit organization plan; this release shows the safe existing structure. Roll back application code with a normal revert; retain existing definitions/history and installed BANK-6G foundation. GitHub push uses the established automatic Netlify workflow; publication verification is not a release blocker and is not claimed without confirmation.
