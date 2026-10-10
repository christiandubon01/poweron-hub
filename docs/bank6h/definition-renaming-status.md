# Classification Settings renaming

Verified 2026-10-10. This is a focused extension of the existing manager; BANK-6H bulk-saving capability and its SQL installation gate are unchanged.

## Reuse and implementation

Read-only production inspection confirmed that `bank_spending_manage_definition` already updates organization-scoped `name` for built-in and custom parents/leaves, and `parent_key` for leaves. `bank_spending_read_hierarchy` returns those names. No override table or second manager is necessary. The built-in `key`, `builtin` status, transaction category keys and financial meaning remain unchanged. Existing RLS, owner/admin checks, write gate, immutable-key guard and metadata audit triggers are retained.

Every displayed parent and category now explicitly says **Edit / Rename**, including unparented and built-in categories. Existing forms provide Name, parent selection, the 24-color picker, Save and Cancel. Built-in explanatory text identifies the organization-specific display name and preserved semantics. Save success and duplicate/server error feedback are clear. Existing hierarchy refresh and stable-key color mapping propagate names/grouping through Explorer, details, Smart Review, pickers, Colors and reporting without rewriting historical transactions or merchant rules.

The provider rejects case/whitespace-equivalent names within parents or leaves before saving, including archived definitions. Leaf names are organization-wide unique because search and pickers also expose ungrouped choices. Parent and leaf namespaces remain distinct and visibly labeled.

## SQL prerequisite for concurrent duplicate protection

Production currently has only key-based unique indexes. The read-only normalized-name duplicate check found **no conflicts**. [definition-names-proposal.sql](definition-names-proposal.sql) adds only two organization-scoped unique expression indexes. It changes no existing names, keys, permissions, records or functions. **Not installed; separate owner authorization required.** Until installation, application validation prevents known duplicates, but concurrent/stale clients or direct RPC calls can still create duplicate display names. SQL uniqueness errors receive a useful UI message after installation.

Installation order after approval: recheck duplicate names using the draft's exact normalization; install only the two-index draft as one separately tracked migration; verify index definitions and unchanged metadata/financial records read-only. Abort on duplicates rather than silently renaming. Never run unrestricted database push or reapply/repair migrations 157/158. Rollback is an application revert; retain saved metadata/history. Removal of the two indexes, if necessary, requires separate authorization and does not undo names.

## Verification

- **126 tests passed across eight files**: existing hierarchy PostgreSQL tests plus built-in/custom overrides, parent moves, persistent registry reads, unchanged evidence/interpretations, organization isolation, unauthorized actors, duplicate constraints, UI Save/Cancel/errors, reporting, palette behavior, interpretation replacement/undo and custom confirmation guards.
- TypeScript and production build passed. Existing build warnings unchanged.
- Synthetic Chromium touch checks passed at 1024, 768 and 390 pixels: rename leaf, move parent assignment, rename built-in parent, Save and both themes, no overflow/page errors. [Dark capture](screenshots/rename-dark.png), [light editor](screenshots/rename-light.png). Synthetic data only; native iPad Safari acceptance remains pending.
- No production SQL, category edits, classifications, financial records or bulk-write activation performed.

Owner test: Cash OS → Explorer → Colors / Classification Settings → Edit / Rename. Rename a custom and built-in definition, move an eligible leaf, check colors and refreshed names in Explorer/Smart Review/category picker, then reload to confirm persistence. Cancel should save nothing. Confirm separate financial-link labels remain unchanged. Database-level concurrent duplicate protection awaits the SQL approval above.

Release: commit/push follows passing gates. Netlify Published status must be checked independently; GitHub push is not deployment confirmation.
