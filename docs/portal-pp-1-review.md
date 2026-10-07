# PORTAL-PP-1 review

Base: `c0182a2fa475e736b350fa81695c0043e7b7fd3a`.
Branch: `codex/portal-pp-1-planner-presentation`.

The existing Sales Intelligence → Leads flow renders `LeadsTab` → `HunterPanel` → `PortalInbox`. Opening its existing request modal now probes `getPlannerOwnerDetails(requestId)`: a non-null owner-safe RPC result identifies Planner detail, and null leaves ordinary requests unchanged. A small announced loading/error state never disables Convert to Lead or Dismiss. Async results are ignored after the modal unmounts or request changes.

The new separated Planner section displays intent, reported service/custom amps, existing/planned equipment and details, panel observations, preliminary capacity/condition guidance, reasons, unknowns, possible paths, next step, customer note, preferred contact, consent and timestamps. Provenance distinguishes customer report, estimate, unknown, required verification, preliminary website assumption and measured claim. Observations distinguish reported concern, no concern reported and unsure; neither measurements nor website guidance imply inspection or a final Power On determination. Presentation uses explicit fields rather than dumping or enumerating the snapshot.

Registered photos show category, caption, thumbnail and “Not reviewed.” The existing authenticated attachment reader verifies JWT and same-organization owner/admin authority first, then selects registered Planner objects server-side. Only manifest-linked registered objects can be signed for five minutes. Superseded allocations and notes cannot substitute Planner paths. Its response adds safe client photo ID/category/caption metadata; raw object paths and private transport are excluded. Ordinary attachments retain their notes-based flow. No bucket policy, migration or public submission contract changes.

Owner alert presentation uses the colors, card treatment, gold header/CTA, badges and logo from `notify-new-lead.ts` through a small presentation-only helper. The normal template is untouched. The subject is `New Panel Planner Lead — {name} | Panel Upgrade`, with a Customer fallback. Inline table-based HTML includes contact and request cards, request description, request-specific tracking CTA and Power On license footer, with a text alternative. Values are escaped; the CTA must be HTTPS. Other integration brands retain their display names without Power On's logo/license.

The durable worker still resolves the owner recipient from integration `notification_email`, sender from `PANEL_PLANNER_FROM_EMAIL`, and key from `panel-planner/{request_id}/{event_type}`. The existing legacy fallback is unchanged and is not created or configured by this change. Payload preparation still precedes the first provider call and freezes HTML/text together. Previously frozen text-only payloads remain frozen. Customer confirmation content, Resend, outbox claiming, attempts, terminal states and scheduler activation are unchanged.

## Validation

Dependencies restored from the existing lockfile with lifecycle scripts disabled. The initial installation lacked PGlite; after restoration the unmodified base in a disposable local worktree passed 430 tests across seven focused files.

Final: 464 tests across ten files pass (34 added). Coverage includes the mounted current Inbox, ordinary/failing/unauthorized detail flows, all provenance labels, private-field exclusion, registered-photo signing and authorization, conversion first/replay with owner detail and registered metadata still resolving, email escaping, HTML/text freezing, customer confirmation equivalence, terminal events excluded from claims, routing and disabled-by-default scheduler. Database regressions use local PGlite only; provider calls use mocks.

`tsc --noEmit` and `git diff --check` pass. The old `src/components/portal/PortalLeadInbox.tsx`, `portalService.ts`, migrations 148–152, `notify-new-lead.ts`, and scheduler are unchanged from the base.

No production calls, DB changes, requests, notification claims/requeues, emails, configuration changes, pushes or deployments. Website and unrelated systems untouched.

## Remaining runtime checks

After review and separately authorized deployment, validate the authenticated modal with real owner access, signed-photo previews, tablet/mobile layout and assistive navigation. Preview email rendering in the actual mail clients, including blocked images/dark mode; live delivery requires separate approval. Keep maintenance disabled and leave the pending controlled synthetic event untouched. The existing request-specific `/portal/track/{request_id}` route is retained as requested; this change does not add an owner deep-link route or make customer tracking an owner detail view.
