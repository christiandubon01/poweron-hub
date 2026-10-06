# Panel Planner backend foundation — Phase 4C

Status: isolated, uncommitted backend implementation. No live migration, deployment, environment change, merge or push has been performed. The website is frozen and untouched.

Base: origin/main `2c84d4e6c5b5e618b9e480af1e480ce751ab2d89`.
Branch: `codex/panel-planner-backend`.
Worktree: `C:/Users/chris/Desktop/Power On Hub/PowerOn-panel-planner-backend`.

## Architecture and persistence

Migration `148_panel_planner_submission_foundation.sql` follows migrations 146 and 147 (`147_cash_owner_facts.sql`). It adds one private `portal_request_planner_details` row per normal `portal_requests` record, a notification outbox, a bounded IP-hash rate counter, and privileged RPCs. No second CRM, lead pipeline or authentication system is added.

The details row has a composite request/organization FK and scoped unique (organization, client, idempotency key) constraint. Its immutable fields include the complete frozen schema-1 snapshot, customer note, preferred contact, service-request consent, photo manifest, creation time and deadlines. Snapshot is bounded to 128 KiB in both transport and PostgreSQL JSONB representation; the manifest is at most 10 photos/16 KiB; mutable photo transport is bounded to 128 KiB. RLS is enabled, anonymous/employee table access is denied, and authenticated users have no direct grant to secret columns. Server timestamps establish every deadline.

The only public description is a fixed short professional-review summary. Snapshot, note, preference, consent, manifests, transport, recovery and idempotency data never enter public description or the unchanged legacy tracking projection. A canonical FilePaths marker in private request notes supports the existing authenticated owner attachment reader after registration. The complete snapshot remains attached to the request through HUNTER conversion.

Client result markers remain client-derived/preliminary/workflow-only/unvalidated. Reported or instrument measurements remain customer claims; this backend never upgrades them to a professional verification or capacity determination.

## Public HTTP contract

Endpoint: `POST https://app.poweronsolutionsllc.com/.netlify/functions/panel-planner-request`.

Every body is JSON with `contract_version: 1`, an allowlisted `action`, and a 64-character lowercase hexadecimal `recovery_token` containing 256 random bits. Unknown fields and browser-supplied organization, source, status or tenant are rejected. All UUIDs are v4. Names and supplied phone/email formats are bounded and validated. Name plus phone or email is mandatory. Preferred contact is nullable phone/text/email and must have the corresponding contact channel.

| Action | Additional required fields |
| --- | --- |
| create | idempotency_key, planner_payload, customer_note (string or null), consent_version, photo_manifest |
| recover | idempotency_key |
| authorize_photos | request_id, authorization_key, photo_ids |
| finalize_photos | request_id, finalization_key, authorization_id, photo_ids, close_photos |
| read_photos | request_id |

The create envelope wraps the unchanged output of `PowerOnPanelPlannerOutputs.buildLeadPayload(...)`. The transport manifest is an array of `{client_photo_id, payload_photo_index}`; immutable category, caption, original name, declared size and MIME come only from the validated payload at that index. Manifest and payload photos must correspond one-to-one. Full validation uses a frozen enum/taxonomy copy and real generated fixtures, including present/absent/null observations. No website model/output code is modified.

Canonical request fields are server controlled: homeowner, panel_upgrade, customer_portal, new, and the existing configured organization. Mandatory consent is payload submission.consent=true and envelope consent_version=panel_planner_contact_v1; consent_recorded_at is server controlled and does not imply marketing consent.

New create returns HTTP 201; replay and the other successful actions return 200. Request receipts contain contract_version, request_id, request_state=saved, replayed, tracking_url, photos {state, write_deadline, registered_photo_ids, remaining_photo_ids, retry_allowed}, and owner/customer notification states. Recovery never returns contact, snapshot, notes, internal tenant/lead IDs, hashes or photo URLs. Only read_photos returns short-lived signed URLs for registered photos.

HTTP errors are `{contract_version:1,error:{code,retryable,...}}`. Proven saved requests also carry request_state=saved/request_id on optional-photo transport failures and closed/expired write errors. Raw PostgreSQL, provider, stack and credential information is never forwarded. A network timeout remains ambiguous: recover or retry the identical create envelope with the same key/proof.

Stable codes: INVALID_PAYLOAD, CONTACT_REQUIRED, INVALID_CONTACT, CONSENT_REQUIRED, UNSUPPORTED_SCHEMA, ORIGIN_DENIED, CAPABILITY_INVALID, REQUEST_UNAVAILABLE, IDEMPOTENCY_CONFLICT, FINALIZATION_CONFLICT, PHOTO_REQUEST_CLOSED, PHOTO_WINDOW_EXPIRED, RECOVERY_EXPIRED, SNAPSHOT_TOO_LARGE, PHOTO_TOO_LARGE, PHOTO_TYPE_INVALID, PHOTO_COUNT_EXCEEDED, PHOTO_OBJECT_INVALID, RATE_LIMITED, TEMPORARILY_UNAVAILABLE. The contract module is the authoritative HTTP status mapping.

## Idempotency and recovery

Create takes a transaction advisory lock for server organization/client/key, then atomically inserts request, immutable details and unique notification intents. The unique constraint provides a second defense. Canonical JSONB produces a SHA-256 digest over validated payload, note, consent version and manifest.

Same key/same digest/valid proof returns the original receipt; changed payload returns IDEMPOTENCY_CONFLICT; wrong proof is denied. After 24 hours even the identical create replay cannot use expired recovery proof. It does not create a second request. After 90 days historical keys remain permanent rejection tombstones; digest/hash can be cleared without deleting the record, snapshot or registered photos. Clients must not mint a new key to resolve an ambiguous save.

The recovery secret is supplied by the future client and stored server-side only as SHA-256. Capability access lasts 24 hours. The future website may store only key and secret in sessionStorage, never contact, snapshot or files. This phase contains no browser recovery-storage implementation.

## Private photos

JPEG/PNG/WebP only, 10 files total, 10 MiB each. Authorization verifies proof, canonical request state=new, no HUNTER link, open photo state and the ORIGINAL creation+30-minute deadline. No retry resets it. Authorization IDs and object paths are generated by the server; each manifest photo gets one stable request-scoped path across all authorization keys. Same-key/same-selection replay retains its logical receipt. Distinct paths remain at most 10; logical authorization and finalization records are capped at 60 each.

Storage signing uses upsert=false. Upload links use Supabase's provider TTL (currently two hours); that TTL is explicitly separate from the strict 30-minute registration deadline. A late PUT cannot register a photo or reopen the saved request. Unregistered late objects become cleanup candidates. See [Supabase signed upload documentation](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl).

Finalization first validates eligibility and canonical selected paths, then inspects a bounded GET Range response and PNG/JPEG/WebP magic bytes. Actual size/MIME must match the immutable manifest; missing/bad partial-response metadata fails closed. The reader consumes at most 32 bytes even if a proxy ignores Range, and cancels the response. Current Supabase Storage object routes disable HEAD, so verification does not depend on HEAD. See [Storage GET source](https://github.com/supabase/storage/blob/master/src/http/routes/object/getObject.ts). This is file-signature validation, not malware scanning, full image decoding or EXIF removal.

The registration RPC rechecks capability/deadline/state under row locks and independently checks storage.objects metadata. A selected batch registers atomically or not at all. Prior batches remain saved if a later batch fails. A finalization key stores the exact receipt and digest; a successful replay works after the write deadline while recovery proof is still valid, without reopening writes. Empty selection is permitted only with explicit close_photos=true.

Photo states: not_requested, pending, partial, complete, closed_without_all_photos, expired, unavailable_after_acceptance. PUT success alone is never registration success.

Customer planner reads require request ID plus its own unexpired recovery capability. UUID-only legacy attachment reads explicitly reject planner rows; lookup failures fail closed. Legacy non-planner behavior is preserved once migration 148 is present. Deploy the migration BEFORE the guarded reader, otherwise legacy customer reads deliberately fail closed while the details table is unavailable. Existing JWT/org-scoped owner reading is preserved. Planner customer read links last 300 seconds. No bucket/public-policy change is made.

## Authenticated owner and HUNTER contracts

`get_panel_planner_owner_details(request_id)` checks auth.uid, active organization and owner/admin role. It returns full professional-review context, private note, consent, preference and safe manifest/registration metadata; it removes the submission idempotency key and excludes recovery hashes, digest, transport and internal paths. `src/services/portal/plannerDetails.ts` exposes the safe service for app callers; no visual redesign or website client is included.

`accept_portal_request_to_hunter(request_id)` locks the canonical org-scoped request, uses organizations.hunter_tenant_id plus user_tenants membership, and inserts/links one lead atomically. Replay returns the existing link only if it belongs to that canonical tenant. Insert/link failure rolls back. Existing lead-type/source/channel/score/value-profile midpoint/margin behavior is retained for valid stored profiles; malformed profiles are ignored. The app conversion service calls this RPC and performs existing geocoding/timeline work only on first acceptance. Best-effort timeline/geocoding recovery is not part of the acceptance transaction.

## Durable notifications and maintenance

Create stores unique owner_new_request and, only when email is present, customer_submission_confirmation events. Outbox state is mirrored into private planner details. Saved request state is independent of delivery. Owner recipient/sender come from backend configuration; customer address and message content come from persisted request data. No browser recipient/content fields and no SMS path exist.

The server-only runner is `node scripts/panel-planner-maintenance.mjs --run`. Without --run it performs no work. It deletes only known planner, allocated, unregistered portal-uploads objects older than 24 hours through the Storage API; registered objects and unrelated legacy objects are excluded. It expires 90-day technical hashes/digests and old rate counters without deleting legitimate submissions.

The same runner claims durable events with a five-minute lease and freezes the exact delivery payload before its first Resend attempt. Provider key is deterministic request/event. Ambiguous network/429/5xx delivery remains sending and is reclaimed with the same payload/key within 23 hours. After that it becomes uncertain for human provider-log reconciliation, with no automatic resend. Definite failed events require operator correction/reconciliation before controlled requeue; never blindly reset uncertain events. Resend documents a 24-hour idempotency window, so this does not claim unconditional provider-level exactly-once delivery. [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).

No scheduler is installed and no production notification is sent in this phase. Before deployment an approved backend scheduler must invoke the runner (recommend every five minutes), alert on failures and uncertain events, and prove orphan deletion/delivery on staging. Without that job cleanup and delivery are implemented but inactive.

Backend environment requirements:
- SUPABASE_URL (HTTPS; existing VITE_SUPABASE_URL fallback) and SUPABASE_SERVICE_ROLE_KEY, server-side only.
- RESEND_API_KEY, PANEL_PLANNER_FROM_EMAIL (verified sender), PANEL_PLANNER_OWNER_EMAIL (trusted owner address).
- Optional PANEL_PLANNER_PREVIEW_ORIGIN: one exact HTTPS origin, no wildcard, path, query, fragment or guessed URL.

Allowed endpoint origins are apex website, www website, and app.poweronsolutionsllc.com, plus the explicit preview entry. Preflight allows POST/OPTIONS and Content-Type only. Missing/unapproved Origin is rejected. Legacy endpoint origins are not broadened. Signed upload operations use provider capability URLs; actual Storage CORS/preflight must be verified in staging from the approved website origins. Existing private bucket size policy must permit the 10 MiB planner policy; no live configuration change was attempted.

The endpoint uses a durable 60-actions/10-minute rate bucket keyed by HMAC of Netlify's reserved connection IP header. Raw IP is not stored; unknown connection identity shares a fail-safe bucket. CORS alone is not bot protection; the capability, strict schema, rate gate and existing platform controls remain necessary.

## Verification and limits

Baseline at the exact base commit: 303 files, 6,227 tests: 6,167 passed, 59 failed, 1 skipped. Final full suite: 304 files, 6,366 tests: 6,306 passed, 59 failed, 1 skipped. The failure identities were compared to the clean baseline; no new failing test is introduced. The 59 failures are pre-existing migration-boundary, auth/UI and QBO contract/environment assertions and remain unmodified outside three targeted conversion assertions.

Focused Portal/security gate: five files, 462 passing tests, including all 139 new planner tests. The new suite executes migration 148 on PostgreSQL through pinned development-only PGlite 0.5.8/pgcrypto, checks real rollback/RLS/ACL/tracking/receipt/authorization/finalization/HUNTER/outbox behavior, uses generated frozen payload fixtures, and tests HTTP, Storage byte checks, legacy bypass denial and notification delivery failure. Existing affected source assertions were updated to verify the authoritative atomic RPC contract rather than old client-side insertion.

PGlite serializes queries within one local engine. Concurrent Promise callers are regression tests, not independent-session MVCC proof. A separate-session PostgreSQL/Supabase staging race test remains required for create, finalize/accept and queue leasing. Storage/provider HTTP is simulated locally; actual signed upload/read/CORS and Resend delivery/reconciliation remain staging gates. Docker is installed but its daemon was not running; it was not started. No test uses live Supabase writes.

All pre-existing migration files, website model/outputs/Steps 1–7/design, Solar profile code and original dirty app checkout remain untouched. No commit is permitted while the full suite is not green, so changes remain uncommitted for backend review.

## Migration review, deployment order and rollback

Migration 148 is transactional and additive. It adds tables/functions/policies plus a composite unique constraint to portal_requests, with no destructive rewrite or historical-data deletion. The unique index may take a table lock while built: assess table size/lock timeout in staging. Existing request policies/bucket configuration/tracking functions are unchanged. The owner/admin role and canonical tenant helper functions remain the authority.

Before deployment:
1. Review migration/endpoint ACLs, contracts, private projections and complete baseline failure list; resolve or formally triage the 59 pre-existing failures under the normal owner workflow.
2. Apply the migration ONLY to an approved disposable/staging Supabase environment and run independent-session races, owner/employee/cross-org/private bucket tests, provider/CORS/10 MiB end-to-end checks and rollback rehearsal.
3. Confirm server-only env entries, exact preview origin if needed, verified owner/sender and an approved monitored scheduler; do not broaden origins.
4. Obtain owner review before live apply/deploy. Apply reviewed migration before deploying app atomic conversion and guarded attachment reader. Deploy planner endpoint and job together once dependencies are ready. No website client rollout is included here.

Rollback is explicit and data-preserving:
1. Stop public planner creates/upload signing and pause the notification/cleanup job. Temporarily disable acceptance rather than exposing a client-side non-atomic fallback.
2. Keep planner photo privacy guard and owner projection available for retained records. Never roll the UUID-only reader back while planner records/photos exist.
3. Preserve private tables, request/HUNTER links and registered Storage objects. Take a verified encrypted backup/export before any schema-removal decision. Operational rollback can disable new functionality and leave additive schema in place without data loss.
4. Only if planner-details/outbox rows are confirmed empty may a reviewed transactional reverse migration drop the two owner RPCs, twelve service RPCs, event/private triggers, rate/outbox/details tables, planner_private schema and the newly added portal_requests_id_org_unique constraint (without CASCADE). Inventory dependencies first; abort if any user data or new dependency exists. This empty-schema removal has NOT been executed.
5. With populated tables, do not drop them or remove request-linked data. Resume from corrected reviewed code/migration; any later archive/schema extraction requires a separate approved, validated preservation plan.

Production changes, environment edits and website integration remain deferred. The implementation is ready to inspect; deployment remains blocked by the full-suite baseline failures and the explicit staging/configuration/job gates above.

## Exact baseline failure inventory

The following failing-file counts are identical before and after Phase 4C (59 total). No new or removed failing test identities were found.

| Existing failing file | Count |
| --- | ---: |
| src/__tests__/coachLink2SalesSession.test.ts | 1 |
| src/__tests__/coachLink3aLiveCallLaunch.test.ts | 1 |
| src/__tests__/guardian1ContractorDetailView.test.ts | 2 |
| src/__tests__/guardian2FounderOpsConsolidation.test.ts | 1 |
| src/__tests__/guardianPresenceRuntime.test.ts | 1 |
| src/__tests__/guardianPresenceSecurityContract.test.ts | 1 |
| src/__tests__/leadSrc4kLiveRefreshProfileEdit.test.ts | 1 |
| src/__tests__/projectIdentityCompatibility.test.ts | 1 |
| src/__tests__/projectOnlyAssignmentProjectEligibility.test.ts | 1 |
| src/__tests__/projectOnlyWorkSessions.test.ts | 1 |
| src/__tests__/role22aLinkExistingAccount.test.ts | 1 |
| src/__tests__/role23CompleteRoleWorkflow.test.ts | 1 |
| src/__tests__/serviceLogQuoteAssignmentModal.test.ts | 1 |
| src/__tests__/sessionCloseout.test.ts | 1 |
| src/components/admin/__tests__/adminSessionPunchCorrection.test.ts | 3 |
| src/components/admin/__tests__/adminSessionPunchVoid.test.ts | 1 |
| src/components/blueprint/__tests__/desktopLabelControls.test.ts | 1 |
| src/components/employee/__tests__/employeeMonthCalendarUiContract.test.ts | 1 |
| src/components/employee/__tests__/employeeWeeklyTaskViewUiContract.test.ts | 1 |
| src/components/v15r/__tests__/serviceLegacyReconciliationQueueUi.test.ts | 3 |
| src/components/v15r/cash-os/cash8MoneyEntry.test.tsx | 3 |
| src/features/billing-draft/__tests__/billingDraft.test.ts | 1 |
| src/features/billing-draft/__tests__/prepareInvoiceOwnerWorkflow.test.ts | 1 |
| src/features/blueprint-snapshots/__tests__/snapshotLibraryLoadingContract.test.ts | 2 |
| src/features/invoice-drafts/__tests__/quickbooksConnectionsMigration.test.ts | 1 |
| src/finance/__tests__/cash3ObligationOwnerControls.test.ts | 2 |
| src/finance/__tests__/cash4MigrationContract.test.ts | 3 |
| src/services/__tests__/revenueTimelineService.test.ts | 1 |
| src/services/quickbooks/__tests__/qbo1a2FinancialAuthorityFirewall.test.ts | 1 |
| src/services/quickbooks/__tests__/qbo3aRun2FunctionRegistration.test.ts | 1 |
| src/store/__tests__/authStoreDualPortalContext.test.ts | 3 |
| src/store/__tests__/authStoreExistingEmployeeOwnerBootstrap.test.ts | 1 |
| src/store/__tests__/authStoreInitialSetupBootstrap.test.ts | 4 |
| src/store/__tests__/authStorePostPinHydration.test.ts | 10 |

Final build checks: npm run build (TypeScript + Vite) passed; both planner and guarded legacy Netlify functions bundled with esbuild and expose callable handlers. The legacy reader retains its pre-existing CommonJS-in-ESM esbuild warning. Existing Vite chunk-size/Browserslist warnings were not changed.

## Final isolation evidence

Website aggregate SHA-256 (256 tracked/nonignored files): 346BEAB2782CB20D7FAF7EF538FA758888EA728E1F979B8C55E73CDF97051ED8; unchanged.

Original CoWork aggregate SHA-256 (1,964 tracked/nonignored files): E488EA8FFD19E1D680468C7179EA25D454CAD4C90A5650333F8F5D55D8E28A00; unchanged. Its pre-existing CLI temp modification and ct-shot-root.png remain present.

Unrelated website assets/brand/logo-candidate.png SHA-256: 7F557A23460EC778BC98FF23658462CB8ED10CE0355440FABE21B0F68BFD9BB8; unchanged/untracked.

Final feature status (exact 22-file implementation boundary, nothing staged):

```text
## codex/panel-planner-backend...origin/main
 M netlify/functions/portal-attachment-read.ts
 M package-lock.json
 M package.json
 M src/__tests__/leadSrc6cPortalAttribution.test.ts
 M src/__tests__/portalStorageSecurityContract.test.ts
 M src/services/portal/__tests__/leadValueProfiles.test.ts
 M src/services/portal/portalService.ts
?? docs/panel-planner-backend.md
?? netlify/functions/lib/planner-contract.cjs
?? netlify/functions/lib/planner-handler.cjs
?? netlify/functions/lib/planner-legacy-guard.cjs
?? netlify/functions/lib/planner-maintenance.cjs
?? netlify/functions/lib/planner-runtime.cjs
?? netlify/functions/lib/planner-taxonomy.json
?? netlify/functions/panel-planner-request.ts
?? scripts/panel-planner-maintenance.mjs
?? src/__tests__/fixtures/planner-database.ts
?? src/__tests__/fixtures/planner-payload-v1.json
?? src/__tests__/fixtures/planner-payload-variants-v1.json
?? src/__tests__/panelPlannerBackend.test.ts
?? src/services/portal/plannerDetails.ts
?? supabase/migrations/148_panel_planner_submission_foundation.sql
```

Git diff --check and no-index whitespace checks of all new files passed. Temporary baseline worktree and execution logs were removed after capturing results. No commits or pushes were made.

Explicit same-organization admin access, missing canonical tenant mapping and missing mapped-tenant membership checks also pass. Final full-suite totals are 6,306 passed, 59 pre-existing failures and one skipped (6,366 total); focused totals are 462 passed including 139 new planner checks. Failing-file counts still exactly match the captured clean baseline inventory.

## Phase 4D staging validation record (2026-10-06)

No isolated staging Supabase/Netlify target exists (the only linked project, `supabase/.temp/linked-project.json`, is production and was not used). Validation ran on a disposable local PostgreSQL 16 cluster with independent client sessions. The repository migration history cannot be replayed from empty (pgvector/pg_cron/pg_net, MySQL-style `COMMENT` in 052, and objects created outside the migration files), so prerequisites were layered on top of the replayable migrations through 147 (including `147_cash_owner_facts.sql`). Results: migration 148 applies cleanly with no object/policy/grant collisions and no change to any non-planner object; the empty-data rollback below returns the schema byte-for-byte to its pre-148 state; independent-session races (12 callers) for create, HUNTER acceptance, authorization, finalization and notification leasing all pass. Real Supabase Storage, signed-URL CORS and Resend delivery remain open staging gates.

### Verified empty-data rollback order

`planner_private` functions depend on the details row type, so drop the schema BEFORE the tables. The script aborts if any planner row exists.

```sql
BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.portal_request_planner_details)
  OR EXISTS(SELECT 1 FROM public.portal_planner_notification_events)
  OR EXISTS(SELECT 1 FROM public.portal_planner_rate_limits)
  THEN RAISE EXCEPTION 'planner data present: rollback aborted'; END IF; END $$;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    AND (p.proname ~ 'panel_planner' OR p.proname='accept_portal_request_to_hunter')
  LOOP EXECUTE 'DROP FUNCTION '||r.sig; END LOOP; END $$;
DROP SCHEMA planner_private CASCADE;
DROP TABLE public.portal_planner_notification_events, public.portal_planner_rate_limits, public.portal_request_planner_details;
ALTER TABLE public.portal_requests DROP CONSTRAINT portal_requests_id_org_unique;
COMMIT;
```

Note: the pre-existing-failure counts quoted above are the Phase 4C figures; the current-main baseline (Phase 4C-R) is 6287 passed / 47 failed / 1 skipped, identical to the reconciled feature.
