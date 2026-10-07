# PORTAL-PP-1 review

Base: `c0182a2fa475e736b350fa81695c0043e7b7fd3a`.
Branch: `codex/portal-pp-1-planner-presentation`.

The existing Sales Intelligence → Leads flow renders `LeadsTab` → `HunterPanel` → `PortalInbox`. Opening its existing request modal now probes `getPlannerOwnerDetails(requestId)`: a non-null owner-safe RPC result identifies Planner detail, and null leaves ordinary requests unchanged. A small announced loading/error state never disables Convert to Lead or Dismiss. Async results are ignored after the modal unmounts or request changes.

The new separated Planner section displays intent, reported service/custom amps, existing/planned equipment and details, panel observations, preliminary capacity/condition guidance, reasons, unknowns, possible paths, next step, customer note, preferred contact, consent and timestamps. Provenance distinguishes customer report, estimate, unknown, required verification, preliminary website assumption and measured claim. Observations distinguish reported concern, no concern reported and unsure; neither measurements nor website guidance imply inspection or a final Power On determination. Presentation uses explicit fields rather than dumping or enumerating the snapshot.

Registered photos show category, caption, thumbnail and “Not reviewed.” The existing authenticated attachment reader verifies JWT and same-organization owner/admin authority first, then selects registered Planner objects server-side. Only manifest-linked registered objects can be signed for five minutes. Superseded allocations and notes cannot substitute Planner paths. Its response adds safe client photo ID/category/caption metadata; raw object paths and private transport are excluded. Ordinary attachments retain their notes-based flow. No bucket policy, migration or public submission contract changes.

Owner alert presentation uses the colors, card treatment, gold header/CTA, badges and logo from `notify-new-lead.ts` through a small presentation-only helper. The normal template is untouched. The subject is `New Panel Planner Lead — {name} | Panel Upgrade`, with a Customer fallback. Inline table-based HTML includes contact and request cards, request description, owner app homepage CTA and Power On license footer, with a text alternative. Values are escaped; the owner CTA is fixed to `https://app.poweronsolutionsllc.com/` in HTML and text. Other integration brands retain their display names without Power On's logo/license.

The durable worker still resolves the owner recipient from integration `notification_email`, sender from `PANEL_PLANNER_FROM_EMAIL`, and key from `panel-planner/{request_id}/{event_type}`. The existing legacy fallback is unchanged and is not created or configured by this change. Payload preparation still precedes the first provider call and freezes HTML/text together. Previously frozen text-only payloads remain frozen. Customer confirmation content, Resend, outbox claiming, attempts, terminal states and scheduler activation are unchanged.

## Validation

Dependencies restored from the existing lockfile with lifecycle scripts disabled. The initial installation lacked PGlite; after restoration the unmodified base in a disposable local worktree passed 430 tests across seven focused files.

Final: 464 tests across ten files pass (34 added). Coverage includes the mounted current Inbox, ordinary/failing/unauthorized detail flows, all provenance labels, private-field exclusion, registered-photo signing and authorization, conversion first/replay with owner detail and registered metadata still resolving, email escaping, HTML/text freezing, customer confirmation equivalence, terminal events excluded from claims, routing and disabled-by-default scheduler. Database regressions use local PGlite only; provider calls use mocks.

R1 validation: 465 tests across the same ten files pass, including fixed owner CTA, unchanged customer tracking, normal Portal owner CTA, and frozen-payload replay.

`tsc --noEmit` and `git diff --check` pass. The old `src/components/portal/PortalLeadInbox.tsx`, `portalService.ts`, migrations 148–152, `notify-new-lead.ts`, and scheduler are unchanged from the base.

No production calls, DB changes, requests, notification claims/requeues, emails, configuration changes, pushes or deployments. Website and unrelated systems untouched.

## Remaining runtime checks

After review and separately authorized deployment, validate the authenticated modal with real owner access, signed-photo previews, tablet/mobile layout and assistive navigation. Preview email rendering in the actual mail clients, including blocked images/dark mode; live delivery requires separate approval. Keep maintenance disabled and leave the pending controlled synthetic event untouched. R1 corrects the owner CTA to `https://app.poweronsolutionsllc.com/`, labeled “Open in Power On Hub →”, matching the normal Portal owner alert. Customer confirmation retains `/portal/track/{request_id}`. No owner deep-link or query-parameter system is added. Existing frozen outbox payloads are not rewritten.

## R2 visual polish and preview photo diagnosis

R2 starts at `bcead55f93069176a1a03d90d1ae0599dab9ad34`. The existing modal now has a responsive 920px maximum width with safe phone margins and its original scrolling/sticky actions. Planner presentation adds a four-tile overview, intent chips, paired equipment cards, structured observation cards, a gold guidance panel with all reasons/unknowns/paths/next step, and a compact request-context grid. All original information and safety/provenance meaning remain. Photos use a one/two/three-column layout, larger signed thumbnails and compact unavailable states, including failed image loads. The map stays collapsed until geocoding succeeds and map tiles load; script/initialization/geocoding/tile failure never reserves a visible empty rectangle. Address and Open Maps are retained.

R2 validation: 477 tests across eleven focused files pass; `tsc --noEmit` and whitespace checks pass. Existing service, conversion, registered-only server projection, private Storage policies, owner/admin RPC, email/CTA, scheduler and customer tracking code are unchanged. No production data/configuration changes or worker invocations.

### Photo diagnosis: runtime evidence still required

The reported photo count comes from the owner-details RPC's registered manifest; it does not prove the separate attachment-read endpoint returned signed URLs. `fetchAttachmentSignedUrls` returns an empty list for non-OK responses/network errors. Consequently, “Photo preview unavailable” alone cannot distinguish missing preview secrets, CORS, JWT/context failure, projection failure, or Storage signing failure.

Verified locally with endpoint integration tests:

- The Inbox passes its current owner JWT; no anonymous fallback is used.
- An exact preview origin in `DEPLOY_PRIME_URL` passes CORS; untrusted origins fail.
- Missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` produces HTTP 500 / `Server configuration error` before any authentication/DB/Storage access.
- Failed `get_portal_attachment_context` produces HTTP 503 before private projection/signing.
- Three manifest-linked registered objects produce three metadata/URL entries when signing succeeds; allocation history is never used.
- Storage signing failure produces HTTP 200 with null signed URLs and safe metadata, with no public URL fallback.

Actual preview requests from this session were denied at the outbound proxy (CONNECT HTTP 403), before reaching Netlify. This is a session access restriction, not evidence of the application's CORS response. No Netlify environment/log capability is attached. No owner browser JWT was obtained or fabricated. The actual preview secret availability, context result, projection result and signing result remain unverified. Missing deploy-preview secrets are a possible cause, not a confirmed diagnosis. No speculative backend/security/configuration repair was made.

To resolve the photo gate, obtain the preview browser's POST status/body, omitting Authorization/tokens/signed URLs. If it is the configuration error above, a Netlify owner must verify deploy-preview availability of the existing server variables without changing production. If HTTP 200, inspect safe metadata/count and whether URLs are null; use authorized Netlify runtime logs to isolate context/projection/signing as needed. Do not invoke notification workers or use the synthetic event to test delivery.

## R3 safe owner photo diagnostic

R3 starts at `a422f3a580e7d045b22f6d1f3b3141f75878f01b`. The public `fetchAttachmentSignedUrls(requestId, jwt)` implementation remains unchanged. A separate authenticated detailed helper returns attachments plus bounded HTTP status, result classification, attachment count and signed-URL count. Known failures normalize to fixed labels; arbitrary response/error text is discarded. Diagnostic state and text exclude JWTs, headers, secrets, signed URLs, raw paths, hashes and transport payloads. Signed URLs remain internal to the existing image rendering flow.

Only the current owner Inbox Planner section on a Netlify Deploy Preview uses the detailed helper. A subdued line appears beneath unavailable photos, including image-load failure after signed URLs were returned. Ordinary attachments, production presentation and customer tracking retain the original path. No server, Storage policy, authorization, email, scheduler or production configuration repair is attempted. The actual failure remains for owner retest to identify from HTTP status and counts.

R3 validation: 498 focused tests across twelve files, TypeScript and whitespace checks. All requests in tests are mocked or use local test databases; no production activity. The review branch is updated by normal push only; PR #3 remains draft and unmerged.
