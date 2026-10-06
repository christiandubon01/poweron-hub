# Portal / website multi-tenant intake routing (migrations 149–151)

Canonical intake record stays `portal_requests` (organization-scoped RLS). Tool-specific records such as
`portal_request_planner_details` remain child rows. One Supabase project, many organizations, many websites.

## Model

`public.portal_site_integrations` — WEBSITE / PUBLIC INTEGRATION → ORGANIZATION.

| column | purpose |
| --- | --- |
| `id`, `organization_id` (FK, immutable) | integration identity and its one organization; `UNIQUE(id, organization_id)` |
| `public_site_key` | opaque public routing id `^ps_[a-z0-9]{24,64}$` (NOT a secret, never an organization id) |
| `label`, `primary_origin`, `allowed_origins[]` | exact origins only (`https://host[:port]`; `http://localhost` for dev); no wildcards/paths/uppercase; primary must be listed |
| `notification_email` | trusted server-side owner recipient for this site |
| `public_email` | optional customer-facing email; private emails are never exposed unless set here |
| `tracking_base_url` | optional platform tracking host (NULL = `https://app.poweronsolutionsllc.com`) |
| `legacy_default` | at most one row (unique index). Marks the Power On bridge (see below) |
| `enabled` | disabled integrations fail closed |

RLS on, anon/authenticated have no table privileges except a same-org owner/admin `SELECT` policy.
Writes are service-role only (no admin UI in this phase). Organization identity/branding is **not** duplicated:
the public projection reads `organizations.settings.identity`.

`portal_requests.portal_site_integration_id` (nullable) records the originating website. Composite FK
`(portal_site_integration_id, organization_id) → portal_site_integrations(id, organization_id)` makes the integration's
organization agree with the request's organization. Legacy rows are untouched (NULL).

## Resolution (one path)

`portal_private.resolve_site(site_key, origin)`: well-formed key → ENABLED integration → organization. Unknown, disabled or
malformed key → `REQUEST_UNAVAILABLE` (generic). If an Origin is supplied it must exactly match `allowed_origins`
(`ORIGIN_DENIED`). Origin is a supplementary abuse control, never tenant authentication; `page_url`/referrer/UTM remain attribution only.
For PostgREST calls the Origin is read from `request.headers`; for the Netlify planner adapter it is passed explicitly.
No browser parameter carries an organization UUID; RPC signatures accept none.

## Normal portal

`submit_portal_request` gains a trailing `p_site_key text DEFAULT NULL` (24 → 25 params, same return shape, same grants).
`CustomerPortalView` sends `resolvePortalSiteKey()` = `VITE_PORTAL_SITE_KEY` → explicit `?site=` link parameter → the Power On key
(`ps_3f9c1e7ab25d4086b1c7e0aa`, seeded by migration 149 from the existing singleton configuration). The shared app origin alone never selects a tenant.

**Bounded bridge (151):** a call with NO key (stale cached clients) resolves the fixed Power On public key through the same canonical resolver and is stamped with its integration. Disabled integration and mismatched origin fail closed; the singleton is no longer runtime routing authority. `portal_request_configuration` is kept (migrations 111/120/128 and
tests reference it). Remove the bridge once every public entry point sends a key.

Because the Power On notification functions (`notify-new-lead`, `portal-schedule` confirmation) hard-code Power On
recipients/branding, the portal now calls them **only** for the Power On site key. Other organizations' normal-portal
notifications are a follow-up (see blockers).

## Panel Planner (migration 150; 148 is unchanged)

* `submit_panel_planner_request(..., p_site_key, p_origin)` and `recover_panel_planner_request(idem, token, p_site_key, p_origin)` replace the
  6-/2-arg versions (unreleased, no other callers). The singleton is no longer consulted.
* Idempotency uniqueness remains `(organization_id, client, idempotency_key)`. The same UUID on two organizations = two requests. An existing key reused
  from a different integration inside the same organization → `IDEMPOTENCY_CONFLICT`.
* Recovery matches organization **and** originating integration plus the recovery capability; absent / other-site / other-org all return the same generic
  `REQUEST_UNAVAILABLE`; wrong capability and expired proof return the same `REQUEST_UNAVAILABLE` as an absent request (151). No enumeration.
* The envelope gains a required `site_key` for `create` and `recover` only (other actions are already bound to request id + capability). Extra
  routing fields (`organization_id`, `recipient`, …) are rejected by the exact-shape validator.
* Receipt `tracking_url` uses the integration's `tracking_base_url`, else the platform host. The existing status RPC is unchanged. Migration 151 adds request-bound safe branding for the tracking page.

## Notifications

`claim_panel_planner_notifications` additionally returns trusted per-site data: `owner_email`, `owner_email_fallback_allowed`
(= `legacy_default`), `site_label`, `display_name`, `tracking_base_url`. The runner sends owner mail to `owner_email`; `PANEL_PLANNER_OWNER_EMAIL`
is a **temporary fallback honored only for the legacy Power On integration**. A non-legacy site without its own recipient fails (never mails Power On).
Customer mail is branded with the site's display name. Frozen payloads, provider idempotency keys, no-SMS and dedupe are unchanged.

## Public config / branding

`get_portal_site_public_config(site_key)` (anon-callable) returns only `site_label, display_name, logo_url (https only), public_phone, public_email,
tracking_base_url`; `NULL` for unknown/disabled keys. No ids, tenant ids, settings, billing, recipients or unconfigured emails. Helper:
`src/services/portal/portalSite.ts`. CustomerPortalView is not redesigned. PortalTrackView consumes request-bound safe branding through `get_portal_request_public_config(request_id)` (151); it never uses a URL site key to choose another request's identity.

## CORS

`allowedOrigins(env)` keeps the Power On bootstrap origins + one exact `PANEL_PLANNER_PREVIEW_ORIGIN`. For other origins the handler asks
`portal_site_allowed_origins()` (service-only union of ENABLED integrations' exact origins); lookup failure or no match → 403. For `create`/`recover`
the RPC then requires the origin to belong to the **resolved** integration, so one site's origin cannot act as another site. No wildcard anywhere.

## Tracking URLs

Platform tracking host is separated from organization identity (`DEFAULT_TRACKING_BASE_URL`, `tracking_base_url`, `buildTrackingUrl`). Existing Power On URLs are unchanged.
`PortalTrackView` header, phone, footer and resubmission link now use the original request's identity/site key. A missing branding lookup displays a generic provider, never another organization. Power On logo/phone/license fallbacks are limited to server-confirmed Power On compatibility. `portal-schedule.ts` remains Power On-specific and is called by CustomerPortalView only for the Power On integration.

## Legacy `portal_leads` assessment (no changes made)

`portal_leads` has **no creating migration** in this repo (only RLS hardening in 050), is written only by `netlify/functions/portal-submit.ts`
(no caller in `src/`; referenced by pen-test fixtures), and is read by `PortalLeadInboxView`/`PortalLeadService`/`PortalDataFirewall` in the owner shell.
`CustomerPortalView` does not use it — the live customer flow is `submit_portal_request` → `portal_requests`. It is a parallel legacy subsystem.
Recommendation: separate phase — confirm production row counts/last write, export, migrate or retire the inbox view, delete `portal-submit.ts`, drop the table. Never point the planner at it.

## Rollout / rollback

Apply order: 148 → 149 → 150 → 151, then deploy functions/app together (150 drops the old planner signatures; the old planner handler would fail, but the planner is unreleased).
149 is additive (new table/schema/functions, one nullable column + FK) and replaces `submit_portal_request` with a signature-compatible superset. 
For rollback of 151, restore the submit/recover definitions from 149/150 and drop `get_portal_request_public_config(uuid)` before removing integration schema. Rollback of 149/150 with no planner data: drop 150's functions, recreate 148's two functions, drop new functions/table/column; with data present, leave additive schema and disable via `enabled=false`.

## Remaining decisions

1. Per-organization notifications for the NORMAL portal (`notify-new-lead`, `portal-schedule`, `portal-confirm-email`) and their branding.
2. Admin UI/RPC for managing integrations (currently service-role SQL only).
3. Re-theming `CustomerPortalView` from the public config projection (tracking identity is already request-bound).
4. Retire the singleton bridge; legacy `portal_leads` cleanup.
5. Staging: apply 148–151 to a real isolated project; real Storage/CORS/Resend gates from Phase 4D remain open.


## Reconciliation follow-up (151)

The 2026-10-06 local checkout was behind the already-pushed routing implementation. It was fast-forwarded without discarding prior work. Migration 151 is additive; 148–150 are unchanged. Explicit malformed frontend keys now reach the database rejection instead of silently falling back to Power On. Recovery retains the 24-hour capability deadline while returning one generic denial. Existing photo deadlines, cleanup, outbox/provider idempotency, HUNTER authority and organization RLS remain unchanged.

The legacy subsystem recommendation is to first confirm production usage in a separately authorized audit. Repository references alone cannot prove it is unused in production; no legacy deletion/migration is authorized here.
