# BANK-6H implementation and release evidence

Verified 2026-10-10. Code complete; production batch saving remains safely gated pending separately authorized installation of the checked replacement function. Overall completion: **90%**. No production classifications, evidence, ledger records, schema or merchant rules were changed during implementation.

## Implemented workflow

- Existing Explorer transaction rows open one inline **View related transactions** panel, independently of Smart Review. Existing transaction details, category picker, hierarchy, colors and history are reused.
- Bank-provided merchant names are matched conservatively by case and whitespace. An explicit description grouping supports overdraft/insufficient-funds patterns and exact descriptions. Accounts are never merchant identities. Merchant names can collide: the exact-record preview remains essential; provider entity IDs are not available in the existing sanitized evidence.
- Current date/account/environment, reporting population, search and parent/leaf/direction filters are preserved. The explicitly disclosed historical option lifts date, population, search and classification filters while retaining authorized account/environment scope.
- Complete matching records are shown 50 at a time. Selection is independent and capped at 100. Select-all means visible eligible records only and refuses a selection exceeding the cap. Counts never imply incomplete evidence is complete. Existing evidence limits (50,000 transactions/100,000 active interpretations) and a 4.5 MB response ceiling fail closed.
- Preview shows exact selected records, current/proposed categories, accounts, dates, amounts, exclusions and unchanged financial links. Saving requires explicit confirmation; partial results and uncertain responses require explicit refresh/re-preview. No future rules are created.
- Parent, leaf category, financial link and account context are labeled separately. An unresolved financial link remains unresolved after category confirmation.

## Safety and compatibility

Existing `confirm_batch` is limited to Smart Review suggestion approval and has no expected-version guard. It was preserved. New `preview_categories` and `confirm_categories` actions reuse the existing authenticated spending endpoint and owner/admin authority. Existing request size contracts remain unchanged.

The checked function locks the evidence row, compares the preview revision including all confirmed financial/ledger-match interpretation IDs, and delegates only category replacement to the established atomic replacement RPC. It preserves financial relationships, custom-category guard, history and undo. An identical uncertain-response retry is idempotent only if all other revision fields are unchanged. Browser roles cannot execute this service-only function. Missing-function capability detection disables bulk saving, while exploration and preview remain operational.

## Verified checks

- Focused regression suite: **277 tests passed across 19 files**, including real local PostgreSQL/PGlite authorization, category replacement, undo, stale previews, retries, custom category gating, foreign organizations, incomplete coverage, selection and existing reporting/interpretation contracts.
- TypeScript check passed; final production build (`tsc && vite build`) passed. Existing bundle-size, Browserslist-age and eruda-eval warnings remain.
- Eight synthetic Chromium touch-viewport captures passed with no page errors or horizontal overflow at 1024, 768 and 390 pixels. **Native iPad Safari/WebKit has not been verified for BANK-6H.** Synthetic confirmation is explicitly simulated and is not evidence of production SQL installation.

Evidence: [related dark](screenshots/related-dark.png), [exact preview](screenshots/preview-dark.png), [synthetic save](screenshots/saved-synthetic-dark.png), [historical scope](screenshots/historical-dark.png), [description grouping](screenshots/description-dark.png), [light theme](screenshots/related-light.png), [768 touch](screenshots/touch-768.png), [390 touch](screenshots/touch-390.png), [browser checks](screenshots/browser-evidence.json). Local synthetic harness: `docs/bank6h/preview.html`.

## Installation gate and rollout

Production read-only preflight confirmed the existing replacement RPC signature and BANK-6G guard, owner organization `2443697b-25e4-48ee-931e-1758f635ddee`, and its enabled custom-write gate. The new checked function is absent. No gate state was changed.

1. Deploy tested code through the normal main/Netlify workflow. Before SQL installation, read/preview works and bulk confirmation is clearly unavailable.
2. Obtain separate owner SQL authorization. Review [checked-category-proposal.sql](checked-category-proposal.sql), SHA-256 `64af51bda2187bfba1941c8354053eecd9363d39acb36a964af4bf1a060096f7`.
3. Install only this additive function as one named tracked migration, `bank6h_checked_category_replacement`. Do not run unrestricted database push, reapply or mark migrations 157/158, repair their history, or change the existing BANK-6G gate. The draft creates no tables and changes no financial records.
4. Read-only verify function signature, service-only grants, authority/capability and unchanged production records. Do not perform demonstration classification writes. Installed capability then enables the existing confirmed-preview button.
5. Confirm Netlify Published commit and owner native Safari acceptance. A pushed GitHub commit alone is not proof of a published deployment.

Rollback: restore the prior code baseline `6edb121c5ba3fb2b62af6ca8b51cf5e2ed40bed9` through a normal revert/release. Retain any installed additive function and decision history; do not reverse financial data or reinstall BANK-6G. No schema rollback is needed for old readers.

## Owner acceptance

On iPad, check reviewed and unreviewed transactions: related merchant versus explicit fee descriptions; current versus disclosed historical scope; all three reporting scopes and Money In/Out; individual/select-visible/clear; active custom categories; exact preview and exclusions; light/dark layout; separate parent/category/account/link labels. After SQL authorization and installation, confirm a deliberately selected owner transaction set, inspect independent relationship preservation/history/undo, and reconcile the refreshed Explorer. Large histories, merchant-name ambiguity and partial conflicts must remain explicit.
