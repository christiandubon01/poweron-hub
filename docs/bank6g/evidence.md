# BANK-6G UI evidence

## Latest unified Explorer evidence

The images below supersede the earlier separate-report presentation; earlier images are retained as historical evidence. Actual SpendingExplorer is rendered with synthetic read-only fetch fixtures. No production data or transaction writes. Chromium touch testing is not Safari certification.

| View | Evidence |
|---|---|
| Business parents, dark/light | [Dark](screenshots/unified-dark-business.png) · [Light](screenshots/unified-light-business.png) |
| All Money Activity, dark/light | [Dark](screenshots/unified-dark-all_money.png) · [Light](screenshots/unified-light-all_money.png) |
| Unassigned Spending, dark/light | [Dark](screenshots/unified-dark-unassigned.png) · [Light](screenshots/unified-light-unassigned.png) |
| Leaf breakdown / existing transaction detail | [Leaves](screenshots/unified-subcategories.png) · [Detail](screenshots/unified-transaction-detail.png) |
| Creation disabled / shared Colors settings | [Gate](screenshots/unified-category-write-gate.png) · [Settings](screenshots/unified-shared-colors-settings.png) |
| Ignored / Smart Review | [Ignored](screenshots/unified-ignored.png) · [Smart Review](screenshots/unified-smart-review.png) |
| Smaller touch viewports | [768](screenshots/unified-dark-768.png) · [390](screenshots/unified-dark-390.png) |

[Browser assertions](screenshots/unified-browser-evidence.json): one Snapshot and transaction list per reporting population, zero horizontal overflow, zero page errors. Smart Review has no duplicate Snapshot/list.


All images use synthetic nonproduction evidence and actual application components. No production financial data or database writes. The ten original captures are preserved; eight additional captures were made during recovery.

Chromium: 1024 × 1366, touch enabled. This is **not actual iPad Safari/WebKit testing**. Real Safari remains unverified. Original browser metadata: [browser-evidence.json](screenshots/browser-evidence.json). Recovery metadata: [acceptance-browser-evidence.json](screenshots/acceptance-browser-evidence.json). Both report no page errors; recovery checked horizontal overflow.

| View | Dark | Light |
|---|---|---|
| Parent-bucket overview | [Image](screenshots/business-dark.png) | [Image](screenshots/business-light.png) |
| Subcategory breakdown | [Image](screenshots/subcategory-dark.png) | [Image](screenshots/subcategory-light.png) |
| Transaction drill-down | [Image](screenshots/drilldown-dark.png) | [Image](screenshots/drilldown-light.png) |
| Inline category creation | [Image](screenshots/inline-create-dark.png) | [Image](screenshots/inline-create-light.png) |
| Smart Review creation | [Image](screenshots/smart-create-dark.png) | [Image](screenshots/smart-create-light.png) |
| Personal, debt, transfers and refunds | [Image](screenshots/activity-dark.png) | [Image](screenshots/activity-light.png) |
| Business overhead | [Image](screenshots/overhead-dark.png) | [Image](screenshots/overhead-light.png) |
| Ignored activity | [Image](screenshots/ignored-dark.png) | [Image](screenshots/ignored-light.png) |
| Hierarchy management | [Image](screenshots/management-dark.png) | [Image](screenshots/management-light.png) |

Local fixture: [preview.html](preview.html), [preview.tsx](preview.tsx). Run the existing Vite dev server and open `/docs/bank6g/preview.html`. Its injected save function and synthetic Smart Review response demonstrate UI behavior; they do not establish hosted persistence or Supabase auth acceptance. The individual transaction fixture uses the real category picker in a synthetic transaction shell.

No hosted preview URL is available. See [implementation-status.md](implementation-status.md) for the precise deployment/database/network prerequisites.
