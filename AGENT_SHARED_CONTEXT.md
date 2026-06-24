# AGENT SHARED CONTEXT

Coordination ledger for concurrent Claude Code agents working in this repo.
Created 2026-06-19 (file did not previously exist). Read this before touching files.

## How to use
1. Check **Active File Locks** below before inspecting/editing.
2. If a target file is locked by another *active* agent, stop and report the conflict.
3. Claim your work under **Active File Locks** before editing.
4. Append results/findings under **Audit & Change Log** when done; release the lock.

---

## Active File Locks

| Agent | Feature Area | Files | Mode | Status | Claimed (UTC-ish) |
|---|---|---|---|---|---|
| CFOT-Math (prior session) | Graph Dashboard CFOT Math Correction | V15rDashboard.tsx, CFOTChart.tsx, backupDataService.ts | DONE — committed bcf0aa8 | RELEASED | 2026-06-19 |
| CFOT-Markers-Swipe (this agent) | Graph Dashboard CFOT Project Start Dots + Swipe Timeline Navigation | src/components/v15r/V15rDashboard.tsx, src/components/v15r/charts/CFOTChart.tsx | Implementation (visual/UX only — NO math changes) | IN PROGRESS | 2026-06-19 |

> Markers+Swipe pass is VISUAL/UX only — exposure math, cards, legend, tooltip, Now marker, gray area, and Projected Total Exposure line must stay intact. Will not commit until user reviews the app.

---

## Audit & Change Log

### 2026-06-19 — CFOT Math Correction Audit (CFOT-Math-Audit agent)

**Baseline:** branch `main`, working tree clean, HEAD = caf9f7b. `npm run typecheck` = 0 errors.

**Where CFOT is computed:** `cfotData` IIFE in `V15rDashboard.tsx` (per-week loop ~L863–966) + `cfotSummary` (~L971–987). `CFOTChart.tsx` only renders the series. `backupDataService.ts` supplies CO helpers.

**Current post-caf9f7b formulas (per week / per card):**
- Total Exposure (line `totalExposure`) = Σ projects `max(0, contract − collected)` + ALL service uncollected. Card `exposure` = Σ `max(0, contract − paid)` (projects only). ❌ subtracts payments; ❌ mixes service into the line; ❌ no COs.
- Active Exposure (`activeExp`) = Σ projects `max(0, contract − collected) + getProjectCOExposure(p)`. ❌ `getProjectCOExposure` = {Sent, Pending Approval, Invoiced} → includes UNAPPROVED COs and MISSES Approved.
- Projected Active Exposure (`projectedExposure`) = future weeks, same (wrong) Active formula.
- Unbilled (`unbilled`) = Σ projects `max(0, contract − collected)` + uninvoiced service uncollected. ❌ mixes project + service. (Card `unbilled` = contract − billed.)
- Pending Invoice (`pendingInv`) = invoiced service uncollected (service-only). ✅
- Service/Project Payment, Accumulative Income = unchanged, correct. ✅ (out of scope)

**CO model (backupDataService.ts):** statuses = Draft | Sent | Pending Approval | Approved | Rejected | Completed | Invoiced | Paid. CO has `totalCost`, `status`, `approvalAt`, `createdAt` — NO per-CO collected/paid amount (payment = status==='Paid'). `getProjectCOTotal` = {Approved, Completed, Paid}. `getProjectCOExposure` = {Sent, Pending Approval, Invoiced}.

**Helper reuse constraint:** `getProjectCOExposure`/`getProjectCOTotal` are also used by `ProjectCard.tsx` and `V15rProjectsPanel.tsx` (project cards = DO-NOT-CHANGE). → CFOT must use a NEW helper or local status filter; do not modify existing helpers.

**Decision needed from user:** whether Draft/Sent/Pending-Approval COs count toward "Projects Total Exposure" (recommend: Total = all non-Rejected COs incl. pending = gross ceiling; Active = approved-unpaid only {Approved, Invoiced(, Completed?)}). "Completed" payment-state is ambiguous.

**User decisions (2026-06-19):**
1. Projects Total Exposure CO set = **Confirmed COs only** → status ∈ {Approved, Completed, Invoiced, Paid} (exclude Draft, Sent, Pending Approval, Rejected).
2. Active Exposure CO set = **{Approved, Invoiced, Completed} minus Paid** (Completed treated as owed-until-Paid).
3. Proceed? = **Wait for explicit approval** — do NOT implement yet.

**Locked formulas (ready to implement on approval):**
- Projects Total Exposure(W) = Σ(projects active as-of W) p.contract + Σ CO.totalCost where status ∈ {Approved, Completed, Invoiced, Paid} and CO.date ≤ W. CO.date = approvalAt || createdAt || project start. (No payment subtraction; projects only.)
- Active Exposure(W) = Σ [ max(0, contract − collectedAsOf) + Σ CO.totalCost where status ∈ {Approved, Invoiced, Completed} ], floored at 0. (Projects only; new helper, not getProjectCOExposure.)
- Projected Active Exposure = Active formula over the 12 future weeks.
- Service Calls Exposure(W) = Σ max(0, service billable − collected) (= existing service-uncollected total; replaces "Unbilled" label).
- New helpers to add (leave existing untouched): `getProjectCOConfirmedTotal` = {Approved, Completed, Invoiced, Paid}; `getProjectCOApprovedUnpaid` = {Approved, Invoiced, Completed}.

**Status (audit phase):** STOPPED after audit. Awaited approval.

---

### 2026-06-19 — CFOT Math Correction IMPLEMENTED (uncommitted)

User approved implementation with the audited decisions. Changes made (NOT committed — awaiting user review):

**Files changed (3):**
- `src/services/backupDataService.ts` (+32): added `getProjectCOConfirmedTotal` ({Approved, Completed, Invoiced, Paid}) and `getProjectCOApprovedUnpaid` ({Approved, Invoiced, Completed}). Existing `getProjectCOExposure`/`getProjectCOTotal` left untouched (project cards depend on them).
- `src/components/v15r/V15rDashboard.tsx` (62 ins / 35 del, excl. EOL): rewrote `cfotData` per-week exposure math + `cfotSummary` + chart subtitle + summary cards (7→6).
- `src/components/v15r/charts/CFOTChart.tsx` (3/3): renamed "Total Exposure"→"Projects Total Exposure", "Unbilled"→"Service Calls Exposure" (dataKey `unbilled`→`serviceExposure`).

**Formulas implemented (per week W, projects active as-of W; COs placed by date approvalAt→createdAt→project start):**
- Projects Total Exposure(W) = Σ p.contract + Σ confirmed-CO.totalCost (status ∈ {Approved, Completed, Invoiced, Paid}, date ≤ W). No payment subtraction. Projects only.
- Active Exposure(W) = Σ [ max(0, contract − collectedAsOf) + Σ approved-unpaid-CO (status ∈ {Approved, Invoiced, Completed}, date ≤ W) ]. Projects only.
- Projected Active Exposure = Active formula over the 12 future weeks (dashed).
- Service Calls Exposure(W) = Σ max(0, svc quoted − collected) (invoiced + uninvoiced). Service only. (Pending Invoice line kept = invoiced subset.)
- Service Payment / Project Payment / Accumulative Income: UNCHANGED.

**Summary cards (6):** Project Total Exp · Active Exp · Service Calls Exp · Service $ · Project $ · Accum. (Removed redundant "Pending" card; "Unbilled" card renamed to Service Calls Exp.) `cfotSummary.unbilled`/`.pending` retained in the object for the NEXUS/PULSE analyzers.

**Verification:** `npm run typecheck` = 0 errors. `npm run build` = ✓ built in ~15s, 0 errors (pre-existing chunk-size warning only). EOL preserved (V15rDashboard reconstructed to keep HEAD's mixed CRLF/LF; diff is real changes only).

**Not done (per instructions):** no git commit. Untouched: Phase Timeline, Gantt, Planned vs Actual, Blueprint, layout, project cards, auth, sync, storage, and the existing CO helpers.

**Lock released** — file area free for other agents.

---

### 2026-06-19 — CFOT Math CORRECTION PASS (uncommitted)

User reported Active Exposure too high (~$33.4k vs expected ~$23.2k) and wanted the projected line to be Total, not Active. Adjusted the existing uncommitted implementation (no full re-audit).

**Root cause of the ~$10k Active Exposure over-statement:** the card used the deprecated/stale `p.paid` scalar and the line used `collectedAsOf` (field-logs only). The app's source-of-truth collected is `getProjectFinancials().paid = logged payments + manualPaidAdjustment` (the `p.paid` scalar "is no longer written to" per the COLLECTION-PATH-PARITY note). So collected was under-counted → remaining (and Active Exposure) over-stated.

**Changes (V15rDashboard.tsx + CFOTChart.tsx only; backupDataService.ts unchanged this pass):**
1. **Active Exposure fix (Correction 1):**
   - Card: `Math.max(0, contract − getProjectFinancials(p, backup).paid) + getProjectCOApprovedUnpaid(p)` (was `num(p.paid)`).
   - Line: new `collectedCanonicalAsOf` = `collectedAsOf(W) + (getProjectFinancials().paid − totalLogged)` so it equals canonical paid at "Now" while keeping the historical decline.
   - Active Exposure now restricted to `p.status === 'active'` projects only (coming/future excluded). Total Exposure still spans `isProjectActiveAsOf`.
2. **Total Exposure (Correction 2):** unchanged math; CO date priority extended to `approvalAt → approvedAt → createdAt → date → project start`.
3. **Projected Active → Projected Total (Correction 3):** future dashed line now = Projects Total Exposure carried forward (contract + confirmed COs), so a future project adds its contract on/after its start date. Data key `projectedExposure`→`projectedTotalExposure`; legend/tooltip "Projected Active Exposure"→"Projected Total Exposure"; anchored at "Now" to current Projects Total Exposure. Active Exposure is no longer projected into the future.
4. **Service Calls Exposure (Correction 4):** unchanged (service-only). 
5. **Colors (Correction 5):** unchanged.

**Expected after fix:** Project Total Exp ≈ $47.19k; Active Exp ≈ $23.2k; Service Calls Exp = $1,471; Projected Total Exposure ≈ $82.19k after 06/25/2026 (+$35k future project).

**Verification:** `npm run typecheck` = 0 errors; `npm run build` = ✓ ~15s, 0 errors. V15rDashboard EOL reconstructed (diff = real changes only). NOT committed.

---

### 2026-06-23 — Sales Intelligence Scraper + Portal Lead Audit

**Agent:** Claude Code Sonnet 4.6
**Mode:** Audit Only — no source file edits
**Feature Area:** Sales Intelligence Scrapers + Portal Leads (HUNTER system)
**Branch:** main (up to date with origin/main)
**Typecheck baseline:** `npm run typecheck` = 0 errors ✅

---

#### Files Inspected

| File | Purpose |
|---|---|
| `src/views/SalesIntelligenceView.tsx` | Top-level view — thin shell, just renders SalesIntelligencePanel |
| `src/components/salesIntel/SalesIntelligencePanel.tsx` | 5-tab container: Practice, Live Call, Leads, Pipeline, Coach |
| `src/components/salesIntel/tabs/LeadsTab.tsx` | Leads tab — renders `<HunterPanel />` with no props |
| `src/components/hunter/HunterPanel.tsx` | HUNTER lead inbox UI — geo filters, map, score buckets |
| `src/store/hunterStore.ts` | Zustand store — fetches `hunter_leads` from Supabase, all CRUD |
| `src/components/hunter/PortalInbox.tsx` | Portal inbox rendered above lead list, polls every 60s |
| `src/services/portal/portalService.ts` | `fetchNewPortalRequests`, `convertToLead`, `dismissPortalRequest` |
| `netlify/functions/city-scraper.ts` | Netlify function entry — routes ?city=indio or city=palm-springs |
| `netlify/functions/city-scraper/shared.ts` | Shared EnerGov fetch engine, scoring, Supabase write layer |
| `netlify/functions/city-scraper/indio.ts` | Indio EnerGov config |
| `netlify/functions/city-scraper/palm-springs.ts` | Palm Springs EnerGov config |
| `supabase/functions/tlma-scraper/index.ts` | Supabase Edge Function — Riverside County TLMA 13-city scraper |
| `supabase/functions/tlma-scraper/parser.ts` | Regex HTML parser for TLMA results table (position-based, 23 columns) |
| `supabase/functions/tlma-scraper/scoring.ts` | Pure-function TLMA scoring engine (base score + sqft + keywords + contact + status + force overrides) |
| `supabase/functions/tlma-scraper/types.ts` | TypeScript interfaces: TLMAPermit, ScoreResult, HunterLeadRow |
| `supabase/functions/tlma-scraper/supabase-client.ts` | Geocoding, dedup/upsert, revision diffing logic |
| `supabase/functions/tlma-scraper/README.md` | Full operator guide |
| `supabase/migrations/072_cron_run_log.sql` | cron_run_log table for scraper run visibility |
| `supabase/migrations/074_source_city.sql` | Added source_city, portal_url, run_source to hunter_leads |
| `src/services/hunter/cronRunLogService.ts` | Client reads cron_run_log per-city status |
| `src/services/notifications.ts` | OneSignal push notification setup (stub/partial) |
| `src/services/emailCampaigns.ts` | Email campaign generation via Claude (SPARK — not lead notifications) |
| `netlify.toml` | city-scraper declared as Netlify function, 26s timeout |

**Files claimed for source editing:** none — audit only.

---

#### Sales Intelligence Entry Point

`AppShell` → routes to `SalesIntelligenceView` → `SalesIntelligencePanel` (5 tabs) → "Leads" tab → `LeadsTab` → `HunterPanel`.
Entry path is clean and shallow. Tab bar is in `SalesIntelTabBar.tsx` / `SalesIntelStore.ts`.

---

#### Scraper Architecture Summary

**Two separate scraper systems exist:**

**System 1 — Netlify city-scraper (EnerGov / Tyler Technologies)**
- Entry: `netlify/functions/city-scraper.ts`
- Current cities: **Indio**, **Palm Springs**
- Mechanism: POST to Tyler EnerGov CSS REST API (`/apps/selfservice/api/energov/search/search`)
- Authentication: browser-shaped headers (`tenantname`, `tyler-tenanturl`, cookie `Tyler-Tenant-Culture=en-US`)
- Pagination: up to 2 pages × 50 results = 100 permits per run
- Date range: `daysBack` param (default 30 days for manual invocations)
- Permit filter: all permit types (`PermitTypeId: 'none'`) + all statuses (`PermitStatusId: 'none'`)
- Keywords/scoring: 7 tiers in `scorePermit()` (direct_electrical +35, new_construction +30, solar_pv +25, ADU +22, addition_remodel +18, commercial +20, pool_spa +12) + description keywords + status signals + no-contractor bonus
- Dedup key: `(permit_number, source_city)` in `hunter_leads`
- Output: upsert to `hunter_leads`, `source='city-portal'`, `source_city=cityLabel`
- Invocation: `?city=indio` or `?city=palm-springs` query param via Netlify function URL

**System 2 — Supabase Edge Function tlma-scraper (Riverside County TLMA)**
- Entry: `supabase/functions/tlma-scraper/index.ts`
- Current cities: **13 cities** — COACHELLA, INDIO, LA QUINTA, PALM DESERT, PALM SPRINGS, RANCHO MIRAGE, DESERT HOT SPRINGS, BERMUDA DUNES, MECCA, THERMAL, THOUSAND PALMS, WHITE WATER, CATHEDRAL CITY
- Source: `https://publiclookup.rivco.org/` — Riverside County unincorporated + CV cities
- Mechanism: GET requests with query params, HTML scraping (regex parser, position-based 23-column table)
- Authentication: browser-shaped User-Agent + Accept headers to bypass WAF
- Pagination: up to 5 pages × 100 results = 500 permits per (type × city) combo
- Search matrix: 8 permit types × 13 cities = 104 combinations per run
- Date range: `days_back` param (default 7 days)
- Scoring: base scores by type code (BNR=70, BTI=65 … BMR=35) + sqft bonus + 30+ keyword rules + contact signal + status modifier + 5 force-override rules; score tiers elite/strong/qualified/expansion/archived
- Dedup key: `permit_number` (no per-city scoping)
- Output: upsert to `hunter_leads`, `source='tlma_riverside'`; revision diffing to `hunter_lead_revisions`; geocoding via `geocode-single` Edge Function; run logging to `cron_run_log`
- Invocation: Edge Function URL, optional `?city=NAME` to target one city, `?dry_run=true` for preview

---

#### Scraper Parameters Detail

| Parameter | EnerGov city-scraper | TLMA scraper |
|---|---|---|
| Source URL | Hardcoded per-city `tylerhost.net` URL | Hardcoded `publiclookup.rivco.org` |
| Date range | `daysBack` (default 30) | `days_back` (default 7) |
| Permit type | All (PermitTypeId: 'none') | 8 specific TLMA codes |
| Status filter | All (PermitStatusId: 'none') | All (no filter) |
| Keywords | Score engine checks `CaseWorkclass` + `Description` | Score engine checks `permit_description` + `project_name` |
| Address | `AddressDisplay` → `address` | `street_name` → `address` |
| Contractor | `ContractorName` → `contractor_name` | `contact_name` + `contact_company` → `contact_name`, `company_name` |
| License | Not extracted | Not extracted from TLMA |
| Pagination | 2 pages max × 50/page | 5 pages max × 100/page |
| Dedup | `(permit_number, source_city)` | `permit_number` only |
| Geocoding | Not geocoded at write time | Geocoded via `geocode-single` Edge Function |
| Run logging | No cron_run_log | Yes — `cron_run_log` table |

---

#### Scraper Health Assessment

**EnerGov city-scraper (Netlify):**

| Risk | Detail |
|---|---|
| ⚠️ Hardcoded tenant headers | `tenantName`, `tenantUrl` per city — if Tyler host migrates, changes tenant config, or rotates these values, scraper silently returns 0 results or 4xx |
| ⚠️ Response shape assumption | `data?.Result?.EntityResults` — but code comment says `{ Permits: { Result: [...], Total: N } }` mismatch — **current parser likely returning empty array for all runs** |
| ⚠️ Max 2 pages | Caps at 100 permits per run; could miss high-volume months |
| ⚠️ No run logging | No `cron_run_log` equivalent — no visibility into whether runs succeed |
| ⚠️ No cron trigger in code | No cron schedule found — function only runs on manual `?source=manual` or external scheduler |
| ⚠️ Duplicate key in leadRow | `contractor_name` assigned twice (line 327 and 328 of shared.ts) — TypeScript silently ignores the duplicate |
| ⚠️ No geocoding | Leads written without lat/lng — won't appear on HUNTER map |
| 🟡 Likely status | **Unknown — possibly returning 0 results due to response shape mismatch** |

**TLMA scraper (Supabase Edge Function):**

| Risk | Detail |
|---|---|
| ⚠️ Regex HTML parser | Parser relies on `<table class="results-table">` and exact 23-column position order — if TLMA redesigns their table, parser silently returns empty |
| ⚠️ WAF risk | Browser-shaped headers bypass WAF but TLMA could add bot detection; no retry/backoff on 403 |
| ⚠️ 104-combo loop vs Edge Function timeout | Full 13-city run often exceeds Supabase Edge Function timeout — README recommends `?city=NAME` per invocation for reliability |
| ✅ Pagination | Up to 5 pages per combo, handles large datasets well |
| ✅ Dedup + revision diffing | Mature upsert logic with `hunter_lead_revisions` audit trail |
| ✅ Geocoding | Per-permit geocoding via `geocode-single` Edge Function |
| ✅ Run logging | `cron_run_log` tracks every run with status, counts, errors |
| ✅ Dry run mode | Safe preview mode returns report without DB writes |
| 🟢 Likely status | **Functional, used in production** |

---

#### Portal Lead Intake Flow

1. **Customer submits** on external website via a form → inserts row into `portal_requests` table (`status='new'`)
2. **PortalInbox component** (`src/components/hunter/PortalInbox.tsx`) polls `portal_requests WHERE status='new'` every 60 seconds via `fetchNewPortalRequests()`
3. **Inbox rendered** above the HUNTER lead list as a collapsible amber banner
4. **Owner action — Convert to Lead**: calls `convertToLead(req)` in `portalService.ts`:
   - Inserts into `hunter_leads` (source='customer_portal', score=82, score_tier='strong')
   - Geocodes address async via `geocode-single` Edge Function
   - Updates `portal_requests` → status='accepted', links `hunter_lead_id`
   - Inserts two `job_timeline` milestones: "Request Accepted" + "Scheduling in Progress"
5. **Lead appears** in HUNTER Panel under "Unscored Leads" or "Top Leads" depending on score
6. **Customer tracking**: customer can view their request status at `/portal/track/:requestId` (PortalTrackView) — public, no auth

**Portal lead storage:** Supabase `portal_requests` table (primary) → `hunter_leads` (after conversion)

**Portal source detection in HunterPanel geo filter:** `source === 'customer_portal' || sourceTag === 'customer_portal'` → shown under `⚡ Portal` geo filter button

---

#### Email / SMS Notification Support

| Channel | Status |
|---|---|
| Push (OneSignal) | `src/services/notifications.ts` — stub implemented, `VITE_ONESIGNAL_APP_ID` env var required, not confirmed wired to portal lead events |
| Email campaigns | `src/services/emailCampaigns.ts` — SPARK agent campaign tool, NOT triggered by lead intake |
| Email transactional | **Not found** — no Mailgun/SendGrid/Resend/SES integration |
| SMS / Twilio | **Not found** — no SMS service wired anywhere |
| Supabase Edge send-notification | Referenced in `notifications.ts` as proxy target (`supabase.functions.invoke('send-notification', ...)`) but **`supabase/functions/send-notification/` does not exist** in repo |

**Summary:** No real-time email or SMS notification fires when a portal lead comes in. The OneSignal push path is wired at the SDK level but the `send-notification` Edge Function it proxies through does not exist. A new portal lead will appear in PortalInbox on next 60s poll — owner only knows about it if they have the app open.

---

#### Palm Desert Feasibility Assessment

**TLMA scraper (existing):** Palm Desert IS already covered. It is one of the 13 cities in the TLMA search matrix (`CITIES` array, `tlma-scraper/index.ts:20`). Any Palm Desert permit that appears on `publiclookup.rivco.org` is already scraped by TLMA on every run. `cronRunLogService.ts` already tracks `'PALM DESERT'` city. **No new scraper is needed for TLMA coverage of Palm Desert.**

**EnerGov / Tyler city portal (city-owned portal):** Palm Desert may have its own Tyler EnerGov CSS portal separate from TLMA. Palm Desert has historically used eTrakit or similar city portal. Whether Palm Desert uses Tyler EnerGov requires a DevTools lookup at the city's permit portal. The EnerGov scraper architecture supports adding a new city with 1 config file (4 fields: `baseUrl`, `tenantName`, `tenantUrl`, `cityLabel`) — identical to how Indio and Palm Springs were added. If the city uses Tyler EnerGov, adding Palm Desert = ~15 lines of code in a new `netlify/functions/city-scraper/palm-desert.ts` + one route case in `city-scraper.ts`. **Architecture is ready; only the portal URL and tenant values need to be confirmed by DevTools inspection.**

---

#### Notification Insertion Points (for future implementation)

| Trigger | Where to hook | What to call |
|---|---|---|
| Portal lead arrives (new submission) | `portalService.ts::convertToLead()` — after insert succeeds | `notifications.ts::sendNotification()` or new SMS edge function |
| Portal lead arrives (raw — before conversion) | `supabase/functions/` — Supabase DB webhook on `portal_requests` INSERT where `status='new'` | New Edge Function: `portal-lead-notify` |
| TLMA new high-score lead | `supabase/functions/tlma-scraper/index.ts` — after upsert loop, filter inserts where `score >= 75` | New Edge Function or POST to notification service |
| City-scraper new lead | `netlify/functions/city-scraper/shared.ts::scrapeCity()` — after `newCount++` | Same notification hook |

**Cleanest approach for portal lead notifications:** Supabase DB Webhook (pg_net or pg_cron) that fires on `portal_requests` INSERT → calls a new `supabase/functions/portal-lead-notify/` Edge Function → sends push via OneSignal (with existing `send-notification` stub wired) and/or SMS via Twilio. This requires zero changes to existing app source files.

---

#### Exact Files Needing Edits for Future Work

| Future Task | Files to Edit | Risk |
|---|---|---|
| Fix EnerGov city-scraper response parsing | `netlify/functions/city-scraper/shared.ts` L129 | Low — change `data?.Result?.EntityResults` to correct path after DevTools inspection |
| Add EnerGov geocoding | `netlify/functions/city-scraper/shared.ts` | Low — add geocode-single call after each upsert (pattern exists in TLMA) |
| Add EnerGov run logging | `netlify/functions/city-scraper/shared.ts`, `netlify/functions/city-scraper.ts` | Low — mirror TLMA's cron_run_log pattern |
| Add Palm Desert EnerGov scraper | `netlify/functions/city-scraper/palm-desert.ts` (new), `netlify/functions/city-scraper.ts` | Low — 15 lines + route case |
| Add portal lead push notification | `src/services/notifications.ts` already has wrapper; need `supabase/functions/send-notification/index.ts` (new) | Medium — requires OneSignal config + Edge Function deploy |
| Add portal lead SMS | New `supabase/functions/portal-lead-sms/index.ts` + Twilio account | Medium |
| Wire portal arrival notification to PortalInbox | `src/services/portal/portalService.ts::convertToLead()` | Low — 2-3 lines after insert |
| Add EnerGov cron trigger | Supabase cron or Netlify scheduled function config | Low |

---

#### Risks Summary

1. **EnerGov response shape bug** — `data?.Result?.EntityResults` vs actual shape (likely `data?.Permits?.Result` or similar) — city-portal scraper may be writing 0 leads silently. Needs live DevTools verification.
2. **TLMA timeout risk** — full 13-city run may time out on Supabase Edge Function. Per README, should be run per-city in cron to stay under limit.
3. **TLMA HTML parser fragility** — any TLMA table restructure silently returns empty. No alerting on 0-result runs.
4. **No portal lead notification** — operator only sees new portal leads if the app is open and PortalInbox refreshes. No push/SMS/email fires on new submission.
5. **`send-notification` Edge Function missing** — `notifications.ts` calls `supabase.functions.invoke('send-notification')` but this function does not exist in `supabase/functions/`.
6. **EnerGov duplicate contractor_name key** — `shared.ts` L327–328 assigns `contractor_name` twice in object literal; harmless but sloppy.
7. **EnerGov no geocoding** — city-portal leads (Indio, Palm Springs) have no lat/lng and won't show on HUNTER map.

---

**Proposed edits:** Listed in "Exact Files Needing Edits" table above.
**User approval needed:** YES — before any implementation.
**Status:** Audit complete, no source files modified.
