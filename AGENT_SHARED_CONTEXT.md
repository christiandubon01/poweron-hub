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
| CFOT-Markers-Swipe (prior session) | Graph Dashboard CFOT Project Start Dots + Swipe Timeline Navigation | src/components/v15r/V15rDashboard.tsx, src/components/v15r/charts/CFOTChart.tsx | DONE — committed 40f5225 | RELEASED | 2026-06-19 |
| CFOT-Pan-Zoom (this agent) | Graph Dashboard CFOT Smooth Pan + Zoom Navigation | src/components/v15r/charts/CFOTChart.tsx | DONE — awaiting user review | RELEASED | 2026-06-23 |
| CFOT-Source-Toggles (this agent) | Graph Dashboard CFOT Source Toggle Filters | src/components/v15r/charts/CFOTChart.tsx | DONE — awaiting user review | RELEASED | 2026-06-23 |
| CFOT-Final-Controls (this agent) | Graph Dashboard CFOT Final Toggle Placement + Service Call Markers | src/components/v15r/charts/CFOTChart.tsx | DONE — awaiting user review | RELEASED | 2026-06-23 |
| EVR-8Week-Audit (this agent) | Graph Dashboard EVR + 8-Week Cash Flow Projection Audit/Redesign | src/components/v15r/V15rDashboard.tsx, src/components/v15r/charts/EVRChart.tsx, src/components/v15r/charts/SVGCharts.tsx, src/services/revenueTimelineService.ts | AUDIT COMPLETE — awaiting user approval to implement | AWAITING APPROVAL | 2026-06-23 |
| Codex-Palm-Desert-Aura-Probe | Palm Desert Salesforce/Aura Permit Probe | netlify/functions/city-scraper.ts, AGENT_SHARED_CONTEXT.md | DONE — local live probe passed | RELEASED | 2026-06-24 |
| Codex-Palm-Desert-Aura-Dry-Run | Palm Desert Aura Dry-Run Importer | netlify/functions/city-scraper.ts, AGENT_SHARED_CONTEXT.md | DONE — local live dry run passed | RELEASED | 2026-06-24 |
| Codex-Palm-Desert-Aura-Controlled-Importer | Palm Desert Aura Controlled Importer | netlify/functions/city-scraper.ts, AGENT_SHARED_CONTEXT.md | DONE — safe paths verified, write not invoked | RELEASED | 2026-06-24 |

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

---

### 2026-06-23 — EnerGov City Scraper Response Parser Fix (COMMITTED 9f0ec9f)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Implementation
**Feature Area:** Sales Intelligence EnerGov City Scraper
**Branch:** main | HEAD after commit: `9f0ec9f`
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 18.93s (pre-existing chunk-size warnings only)

#### Files Inspected
- `netlify/functions/city-scraper/shared.ts` (primary target — full read)
- `netlify/functions/city-scraper/indio.ts` (config only — no changes needed)
- `netlify/functions/city-scraper/palm-springs.ts` (config only — no changes needed)
- `netlify/functions/city-scraper.ts` (entry point — no changes needed)

#### Files Changed
- `netlify/functions/city-scraper/shared.ts` (+47 lines, −2 lines)

#### Exact Bugs Fixed

**Bug 1 — Response shape mismatch (silent 0-permit returns):**
Line 129 original: `const permits: EnerGovPermit[] = data?.Result?.EntityResults ?? []`
The code comment on line 128 described a DIFFERENT shape: `{ Permits: { Result: [...], Total: N } }`.
These two cannot both be right — one shape was returning empty arrays on every run.

**Fix:** Replaced with `extractPermitsFromResponse(data, config.cityLabel, page)` — a new helper that tries four paths in priority order:
- Shape A: `data?.Result?.EntityResults` (CSS v2+)
- Shape B: `data?.Permits?.Result` (CSS v1 — what the original comment described)
- Shape C: `data?.Permits?.Result?.EntityResults` (nested variant)
- Shape D: top-level array (rare sandbox responses)

If none match, logs top-level key names (no values — no PII) and returns `[]`.
Every successful match logs which shape was matched + count to Netlify function log.

**Bug 2 — Duplicate object key:**
`leadRow` had `contractor_name` assigned twice (lines 327–328). Removed the duplicate. Harmless but a latent source of confusion.

#### Live / Dry-Run Verification
Live verification was **not possible** from this environment — the Netlify function requires a deployed Netlify environment and valid Supabase credentials. TypeScript and Vite build verification passed.

#### Manual Verification Steps
To confirm which shape the real EnerGov API returns and that the parser now works:

1. **DevTools capture (find the real shape):**
   - Open `https://indioca-energovweb.tylerhost.net/apps/SelfService` in Chrome
   - Open DevTools → Network tab → filter by `search`
   - Submit any permit search
   - Find the POST to `.../api/energov/search/search`
   - Inspect the JSON response — note which top-level key wraps the permit array

2. **Dry-run via deployed function (safest, no DB writes):**
   ```
   GET https://<your-netlify-site>.netlify.app/.netlify/functions/city-scraper?city=indio&dry_run=true
   ```
   Expected response: `{ city: "Indio", dry_run: true, permits_fetched: N, ... }` where N > 0.
   Check Netlify function logs for: `[city-scraper] Indio p1: shape=A ...` (or B/C/D).

3. **Live manual run (writes to Supabase):**
   ```
   GET https://<your-netlify-site>.netlify.app/.netlify/functions/city-scraper?city=indio&source=manual
   ```
   Then check `hunter_leads` for rows with `source_city = 'Indio'`.

#### Risks Remaining
- Still no geocoding for EnerGov leads (Indio/Palm Springs) — leads won't show on map.
- Still no cron trigger — function only runs on manual invocation.
- Still no run logging to `cron_run_log` — failures remain invisible.
- Real response shape still unconfirmed without a live DevTools capture. The multi-shape extractor will handle whichever shape the API returns, but the specific log line will tell us definitively which one.

#### Next Recommended Task
> **Add EnerGov geocoding** — copy the geocode-single pattern from `supabase/functions/tlma-scraper/supabase-client.ts` into `netlify/functions/city-scraper/shared.ts::scrapeCity()` so Indio and Palm Springs leads appear on the HUNTER map with distance-from-base.

**Lock released** — `netlify/functions/city-scraper/shared.ts` is free for other agents.

---

### 2026-06-23 — CFOT Smooth Pan + Zoom Navigation (awaiting user review)

**Agent:** Claude Code claude-opus-4-8
**Mode:** Implementation (UX/navigation only — NO math changes)
**Feature Area:** Graph Dashboard — Projects Cash Flow Over Time chart
**Branch:** main | HEAD = 40f5225
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 18.18s (pre-existing chunk-size warnings only)

#### Files Changed
- `src/components/v15r/charts/CFOTChart.tsx` — only file modified

#### What Was Changed

**Root cause of bouncing:** Y axis auto-scaled from the visible slice only. When panning shifted which weeks were visible, different peak values came into view and Recharts re-scaled the Y axis on every render, causing lines to visually jump/bounce vertically. Also, Recharts' line animation re-triggered on every data slice change during drag.

**FIX 1 — Stable Y axis (stops bouncing):**
- Added `fullYDomain` memo computed from the FULL `chartData` array, all 8 series keys + `markerY`.
- Includes negative values (min floored at 0 if all positive) and 10% top padding so peaks are not clipped.
- Applied `domain={fullYDomain}` to `<YAxis>` — Y axis no longer recalculates during pan.
- Added `isAnimationActive={false}` to all 9 `<Line>` components — prevents Recharts from re-animating every time the visible slice changes during drag. (Marker line already had this; added to all others.)

**FIX 2 — Zoom range controls (1M / 3M / 6M / 1Y / All):**
- Added `zoomRange` state (`useState<ZoomRange>('6M')`), default **6M** (~26 weeks, close to prior 32-week default).
- `ZOOM_WEEKS` maps: `1M=5, 3M=13, 6M=26, 1Y=52, All=total`.
- `windowSize` derived from `zoomRange` instead of hard-coded 32.
- `handleZoomChange()` keeps the current center date in view when switching ranges.
- `handleReset()` returns to 6M default, pinned to most-recent window.
- 'All' shows full dataset (no pan needed); hides Earlier/Later step buttons.

**FIX 3 — Smooth drag with RAF throttle:**
- `drag.current` ref now tracks `pendingIdx` and `rafPending` flag.
- `onPointerMove` queues one `requestAnimationFrame` callback per frame; skips if a frame is already pending.
- This throttles state updates to display refresh rate (≤60 fps) regardless of how fast pointer events fire.
- Drag threshold kept at 6px so tap/hover still triggers tooltip.
- Cursor changes to `grabbing` on pointer-down (direct DOM mutation, no re-render).

**FIX 4 — Wheel / trackpad horizontal pan (non-passive listener):**
- `useEffect` adds a `{ passive: false }` wheel listener to `containerRef` — this allows `e.preventDefault()` (React's synthetic `onWheel` cannot prevent default reliably).
- Captures **horizontal deltaX** (trackpad two-finger swipe) or **Shift + vertical deltaY** (mouse wheel + shift key).
- Plain vertical scroll passes through (not captured) → page scroll still works on desktop.
- `canSwipeRef`, `windowSizeRef`, `maxStartRef` refs updated each render so the wheel handler always has fresh values without stale closures.
- Cleanup removes the listener on unmount.

**FIX 5 — Mobile / touch:**
- `touchAction: 'pan-y'` on container div (already present) — browser handles vertical page scroll natively; horizontal swipe is captured by pointer events.
- No changes needed to pointer handlers; pointer events cover both mouse and touch.

**FIX 6 — UI navigation bar:**
- **Zoom buttons:** `1M / 3M / 6M / 1Y / All` — selected state shown with indigo highlight.
- **Range label:** `"Jun 2 – Dec 1 · drag or scroll to pan"` — subtle hint, only when `canSwipe`.
- **Earlier ← / Later →** step buttons: still present, step = `windowSize / 4` (reduced from `/2` for finer control).
- **Reset** button: returns to 6M default, most-recent window.

#### What Was NOT Changed
- All CFOT math formulas in `V15rDashboard.tsx` — untouched.
- All data keys: `exposure`, `activeExposure`, `projectedTotalExposure`, `serviceExposure`, `pending`, `svcPay`, `projPay`, `accum`, `markerY` — unchanged.
- Series colors, stroke widths, dash patterns — unchanged.
- `ProjectStartDot` and `CFOTTooltip` components — unchanged.
- Marker math/placement logic — unchanged.
- Now marker (`ReferenceLine`) — unchanged.
- Future gray area (`ReferenceArea`) — unchanged.
- Legend — unchanged.
- `V15rDashboard.tsx` — not modified.
- No commit made — awaiting user review.

**Lock released** — `src/components/v15r/charts/CFOTChart.tsx` is free for other agents.

---

### 2026-06-23 — CFOT Pan + Zoom Correction Pass (awaiting user review)

**Agent:** Claude Code claude-opus-4-8
**Mode:** UX/navigation correction — NO math changes
**Branch:** main | HEAD = 40f5225
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 16.19s (pre-existing chunk-size warnings only)

#### Files Changed
- `src/components/v15r/charts/CFOTChart.tsx` — only file modified

#### Fix 1 — Full-area drag from any chart location

**Root cause:** `onPointerLeave` on the container div was killing drags whenever the pointer moved over the Recharts tooltip div or reached the chart boundary. No pointer capture was set, so move events were lost when the pointer exited the element.

**What changed:**
- Added a transparent `overlayRef` div (`position: absolute; inset: 0; z-index: 1`) inside the chart wrapper.
- At rest the overlay is `pointer-events: none` — all hover/tooltip events reach Recharts normally.
- `onPointerDown` on the outer wrapper fires for ALL child clicks via event bubbling (SVG lines, empty areas, background). On pointer-down, the overlay is switched to `pointer-events: all` and `overlay.setPointerCapture(e.pointerId)` is called — routing all subsequent move/up events to the overlay regardless of where the pointer travels (over tooltips, past chart edges, etc.).
- `onPointerMove` and end-drag (`onPointerUp`, `onPointerCancel`) are on the overlay, which has capture.
- `onPointerLeave` removed entirely — pointer capture makes it unnecessary and it was the main source of drag drops.
- `touchAction: 'pan-y'` moved to the overlay — vertical page scroll still works on mobile/touch.

#### Fix 2 — 90/10 Now-anchored range buttons

**Root cause:** `handleZoomChange` kept the current viewport center, which with an empty initial state (or early-data default) meant the center was in early historical data (March). All range buttons then opened around March.

**Root cause deeper:** `useState(maxStart)` initializes `startIdx` once at mount. If `chartData` is empty or has few points at mount time, `maxStart = 0` and `startIdx = 0` (showing earliest data). Subsequent zoom button clicks computed `center = 0 + windowSize/2` → also early data.

**What changed:**
- Added `nowIndex` useMemo: index of the last non-projection row (= the "Now" boundary week).
- Added `anchorAtNow(win)` function: computes `startIdx` so the window shows 90% past / 10% future relative to `nowIndex`. Formula: `futureCount = max(1, round(win × 0.10))`, `rawStart = nowIndex + futureCount − win + 1`, clamped within `[0, maxStart]`.
- `handleZoomChange`: all named ranges (1M/3M/6M/1Y) now call `anchorAtNow(newWin)`. 'All' sets `startIdx = 0` (full dataset, no pan).
- `handleReset`: calls `anchorAtNow` with 6M window — returns to current Now view, not earliest data.
- Initial `startIdx`: lazy initializer `() => anchorAtNow(6M window)` — opens on Now by default.
- Safety `useEffect`: if data loads after mount (async edge case), runs once to re-anchor.

#### Preserved from previous pass
- `fullYDomain` stable Y axis (no bouncing) ✅
- `isAnimationActive={false}` on all lines ✅
- RAF throttle on pointer-move ✅
- Non-passive wheel listener (horizontal trackpad / Shift+wheel) ✅
- All CFOT math, data keys, colors, series, tooltip, markers, Now marker, gray area ✅
- No commit made ✅

---

### 2026-06-23 — Palm Desert Scraper Support (COMMITTED 7c5c168)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped feasibility implementation
**Feature Area:** Sales Intelligence Palm Desert Scraper
**Branch:** main | HEAD after commit: `7c5c168`
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 16.19s (pre-existing chunk-size warnings only)

#### Files Inspected
- `supabase/functions/tlma-scraper/index.ts` — confirmed `"PALM DESERT"` in CITIES array (index 3 of 13)
- `supabase/functions/tlma-scraper/types.ts` — city field on HunterLeadRow; TLMA writes it as-is from HTML
- `supabase/functions/tlma-scraper/parser.ts` — `cleanCell()` strips HTML/whitespace, preserves case; city is column 3
- `supabase/functions/tlma-scraper/supabase-client.ts` — `upsertLead()` writes `city: permit.city`
- `netlify/functions/city-scraper.ts` — routes only `indio` / `palm-springs`; no Palm Desert route
- `netlify/functions/city-scraper/indio.ts` — `cityLabel: 'Indio'` (title case)
- `netlify/functions/city-scraper/palm-springs.ts` — `cityLabel: 'Palm Springs'` (title case)
- `netlify/functions/city-scraper/shared.ts` — writes `city: config.cityLabel`; case-sensitive title case
- `src/components/hunter/HunterPanel.tsx` — geo filter type, switch, and button row

#### Files Changed
- `src/components/hunter/HunterPanel.tsx` (+5 lines, −4 lines)

#### Palm Desert Source Confirmed
**TLMA (Riverside County):** ✅ Already scraped. `"PALM DESERT"` is element 3 of the 13-city CITIES array. Every TLMA run already fetches all 8 permit types × Palm Desert, scores them, and upserts to `hunter_leads` with `source='tlma_riverside'`.

**Palm Desert city-owned portal (separate from TLMA):** ❌ Not Tyler EnerGov. The task description notes the city's portal appears Clariti/Salesforce-based. No `*.tylerhost.net` endpoint was confirmed for Palm Desert. A new scraper adapter architecture would be required — not attempted here.

#### Implementation Option
**OPTION A** (TLMA already covers Palm Desert) + **OPTION C** (city portal blocked — Clariti architecture)

**What changed in HunterPanel.tsx:**

1. `GeoFilter` type: added `'palm_desert'`
2. `geoFilteredLeads` switch: added `case 'palm_desert'` with case-insensitive city match; also fixed existing `'indio'` and `'palm_springs'` cases to `.toLowerCase()` — ensures TLMA leads (city stored as `"PALM DESERT"` / `"INDIO"` / `"PALM SPRINGS"` from HTML table) match alongside future EnerGov leads (title-case `cityLabel`)
3. Geo filter button row: inserted `['palm_desert', 'Palm Desert']` between Palm Springs and Portal

#### Risks Remaining
- Palm Desert city-owned portal (Clariti) not scraped — TLMA coverage only.
- No Tyler EnerGov endpoint confirmed for Palm Desert. If the city ever migrates to EnerGov, adding a `palm-desert.ts` config (~15 lines) + one route case would enable city-portal scraping.
- The case-insensitive fix for Indio/Palm Springs is strictly more inclusive (no leads disappear).

#### Next Recommended Tasks
1. **Verify Palm Desert city portal** — open the city's permit portal in Chrome DevTools and check whether it POSTs to `*.tylerhost.net/apps/selfservice/api/energov/search/search`. If yes: add `netlify/functions/city-scraper/palm-desert.ts` + route case. If no (Clariti): design a Clariti scraper adapter.
2. **Add EnerGov geocoding** — `netlify/functions/city-scraper/shared.ts::scrapeCity()` so Indio/Palm Springs leads appear on the HUNTER map.

**Lock released** — `src/components/hunter/HunterPanel.tsx` is free for other agents.

---

### 2026-06-23 — CFOT Source Toggle Filters (NOT COMMITTED — awaiting user review)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped feasibility inspection — no source files edited this session
**Feature Area:** Graph Dashboard CFOT Source Toggle Filters
**Branch:** main | HEAD = 7c5c168
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 18.50s (pre-existing chunk-size warnings only)

#### Finding
The CFOT-Pan-Zoom session (claude-opus-4-8, committed to the working tree, awaiting user review) **already implemented the full source toggle feature** as part of that change. No additional implementation was needed.

#### Files Inspected
- `src/components/v15r/charts/CFOTChart.tsx` — full read; source toggles confirmed present and complete

#### Files Changed
- **None** — feature was already implemented.

#### What Was Already in CFOTChart.tsx (confirmed present)

| Requirement | Status | Code location |
|---|---|---|
| `PROJECT_KEYS` / `SERVICE_KEYS` classification sets | ✅ | Lines 9–11 |
| `showProjects` / `showServiceCalls` state (both default true) | ✅ | Lines 125–126 |
| `toggleProjects()` / `toggleServiceCalls()` with "at least one active" guard | ✅ | Lines 129–136 |
| Source-aware stable `fullYDomain` (no bounce on toggle or pan) | ✅ | Lines 140–160 |
| Source toggle UI row ("SOURCES · Projects · Service Calls") | ✅ | Lines 310–326 |
| `toggleStyle()` helper for active/inactive pill styling | ✅ | Lines 297–305 |
| Project series conditionally rendered (`showProjects`) | ✅ | Lines 391–394 |
| Service Calls series conditionally rendered (`showServiceCalls`) | ✅ | Lines 397–399 |
| Accumulative Income shown only when BOTH sources ON | ✅ | Line 402 |
| Project-start markers hidden when Projects OFF | ✅ | Line 405 |
| `CFOTTooltip` filters rows by source; shows marker details only when Projects ON | ✅ | Lines 30–67 |
| Status hint text ("· showing projects only" / "service calls only") | ✅ | Lines 321–325 |
| All navigation (drag, wheel, zoom buttons, reset, Now marker, gray area) unchanged | ✅ | Lines 162–422 |
| All CFOT math keys untouched (`exposure`, `activeExposure`, `projectedTotalExposure`, `serviceExposure`, `pending`, `svcPay`, `projPay`, `accum`) | ✅ | Lines 91–116 |
| `V15rDashboard.tsx` not touched | ✅ | — |
| `backupDataService.ts` not touched | ✅ | — |

#### Visible Series Per Mode
| Mode | Visible series |
|---|---|
| Both ON | Projects Total Exposure · Active Exposure · Projected Total Exposure · Project Payment · Service Calls Exposure · Pending Invoice · Service Payment · Accumulative Income · Project start dots |
| Projects only | Projects Total Exposure · Active Exposure · Projected Total Exposure · Project Payment · Project start dots |
| Service Calls only | Service Calls Exposure · Pending Invoice · Service Payment |

#### Manual Verification Checklist (unchanged from CFOT-Pan-Zoom session — same file)
1. Dashboard opens with both toggles ON (default) — chart looks like previous combined view
2. Click "Projects" — service-call lines disappear; project lines and start dots remain
3. Click "Service Calls" — project lines disappear; service-call lines appear; start dots hidden
4. Click active toggle while the other is OFF → nothing happens (at-least-one guard holds)
5. Tooltip rows match the selected source mode
6. Legend entries match visible lines (Recharts auto)
7. Y-axis does not bounce when toggling or panning
8. "showing projects only" / "service calls only" hint text appears correctly
9. All zoom/nav/reset/swipe/wheel behavior unchanged

**Lock released** — `src/components/v15r/charts/CFOTChart.tsx` is free for other agents.

---

### 2026-06-23 — Sales Intelligence Scan Accuracy / Palm Desert Audit + Fix (COMMITTED 7898aa4)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Audit + scoped implementation
**Feature Area:** Sales Intelligence Scan Accuracy / Palm Desert
**Branch:** main | HEAD after commit: `7898aa4`
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 15.95s

#### Files Inspected
- `src/components/hunter/HunterPanel.tsx` — Scan Now handler, geo filter, button
- `supabase/functions/tlma-scraper/index.ts` — search matrix loop, error handling, LiveRunReport shape
- `supabase/functions/tlma-scraper/scoring.ts` — full scoring rules (BNR=70, BTI=65, … BMR=35)
- `supabase/functions/tlma-scraper/types.ts` — LiveRunReport (`inserts`, `updates`, `errors: string[]`, `search_matrix_size`)
- `supabase/functions/tlma-scraper/supabase-client.ts` — upsert/geocoding
- `supabase/functions/tlma-scraper/README.md` — search matrix docs, troubleshooting

#### Files Changed
- `src/components/hunter/HunterPanel.tsx` (+35 lines, −6 lines)

#### Root Cause of 104 Errors

**What `Scan Now` calls:** `${SUPABASE_URL}/functions/v1/tlma-scraper?source=manual` — no city filter, no days_back — triggers the full 8 permit types × 13 cities = **104-combo matrix**.

**Why 104 errors:** Every HTTP request to `publiclookup.rivco.org` failed. The actual error type (HTTP 403 WAF block, 429 rate limit, or network exception) was **invisible to the user** — only the count was shown. The messages live in `result.errors[]` but were never displayed.

**Timing issue:** 104 combos × 200ms polite delay = 20.8s of delays alone, before HTTP round-trips. Supabase Edge Function timeouts kill remaining requests mid-run.

**UI messaging bug:** Alert always said "Scan complete" regardless of failure rate.

#### Palm Desert TLMA Coverage

**TLMA covers:** Riverside County unincorporated areas via `publiclookup.rivco.org`.

**Palm Desert as an incorporated city:** Its commercial permits are issued by the City of Palm Desert's own building department, **NOT** by Riverside County TLMA. The user's two active commercial projects are **city permits** and would NOT appear through TLMA regardless of scan health.

**Palm Desert in TLMA CITIES array:** May return unincorporated county parcels with a Palm Desert mailing address. Unlikely to contain city-issued commercial construction permits.

**Conclusion:** Palm Desert city-owned commercial permits require a **Clariti/OpenGov scraper adapter** — a separate implementation. Portal: `https://online.palmdesert.gov/`

#### What Was Fixed (commit 7898aa4)

**Fix 1 — City-contextual scan:** When `palm_desert`, `indio`, or `palm_springs` geo filter is active, Scan Now sends `?city=CITYNAME&days_back=30` (8 combos, 30-day window). All other filters use the full 104-combo scan.

**Fix 2 — Honest error messaging:** `"Scan FAILED"` / `"Scan partial"` / `"Scan complete"` based on `errorCount vs matrixSize`. Includes `N/M requests failed` count.

**Fix 3 — Diagnostic hint:** First error message from `result.errors[0]` appended to the alert so the user immediately sees WHY (HTTP 403, network exception, etc.).

**Fix 4 — Button tooltip:** Shows `"Scan TLMA for PALM DESERT only (30 days)"` when on Palm Desert filter; `"Scan all 13 TLMA cities (7 days)"` otherwise.

#### What Was NOT Fixed (separate work needed)

1. **Root cause of 104 errors** — WAF/network issue unknown. Next step: click "Scan Now" on Indio filter → read first error message.
2. **Palm Desert Clariti scraper** — city-owned permits at `https://online.palmdesert.gov/` (Clariti/OpenGov). Needs DevTools inspection to determine if public search is a plain GET or requires JavaScript/session tokens.
3. **TLMA full-scan days_back** — still 7 days for full scan; not changed due to timeout risk.
4. **Cron trigger** — Scan Now still manual-only.

#### Palm Desert Clariti — Next Implementation Plan
| Step | Action |
|---|---|
| 1 | Open `https://online.palmdesert.gov/` in Chrome DevTools → Network tab |
| 2 | Submit a commercial permit search, capture XHR/fetch request |
| 3 | If plain GET: build `supabase/functions/palm-desert-scraper/` mirroring TLMA pattern |
| 4 | If requires session/CSRF tokens: evaluate serverless session strategy |

#### Risks Remaining
- 104-error root cause (WAF/network) still unknown. City-scoped scan reduces blast radius but doesn't fix TLMA access.
- Palm Desert TLMA results may be zero even if scan works (city permits aren't in county system).
- Clariti portal may require JavaScript/session tokens hard to automate from serverless.

#### Next Recommended Task
> **Step 1:** Click "Scan Now" with Indio filter active → read the first error in the alert → if "HTTP 403" = WAF block; if "Exception / fetch failed" = network issue. Check Supabase Edge Function logs at `supabase.com/dashboard/project/edxxbtyugohtowvslbfo/functions`.
> **Step 2:** Open `https://online.palmdesert.gov/` in DevTools, capture the permit search API request, and design the Clariti adapter.

**Lock released** — `src/components/hunter/HunterPanel.tsx` is free for other agents.

---

### 2026-06-23 — CFOT Final Controls: Toggle Placement + Service Call Markers (NOT COMMITTED — awaiting user review)

**Agent:** Claude Code Sonnet 4.6
**Mode:** UX/visual only — NO math formula changes
**Feature Area:** Graph Dashboard — CFOT Final Controls
**Branch:** main | HEAD = 7898aa4
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 18.18s (pre-existing chunk-size warnings only)

#### Files Changed
- `src/components/v15r/charts/CFOTChart.tsx` — only file modified

#### GOAL 1 — Source toggle row repositioned above range controls

**Before:** Source toggle row was left-aligned above the range/nav row.

**After:** Two-row header layout:
- **Row 1 (right-aligned):** `SOURCES · [Projects] [Service Calls] · showing x only`
- **Row 2:** `range label · drag or scroll to pan` ... `[1M][3M][6M][1Y][All] | [← Earlier] [Later →] [Reset]`

The source toggle pills now use `justifyContent: 'flex-end'` so they right-align flush with the range buttons. Service Calls pill color changed from green to pink (`#fca5a5`) to match the Service Calls Exposure line color in the chart.

#### GOAL 2 — Service call marker dots on Service Calls Exposure line

**New `ServiceCallDot` component:** Hollow pink square (`#fca5a5`), distinct from amber project rings. Renders only when `svcMarkerY` field is non-null.

**New `svcMarkersByWeek` useMemo:** Filters `backup.serviceLogs` with `isActiveServiceCall` (imported from backupDataService — no file change), groups by week using date priority `log.date → log.serviceDate → log.scheduledDate → log.createdAt`, includes only logs where `remaining = max(0, quoted − collected) > 0`.

**`chartData` useMemo:** added `svcMarkerY` (= serviceExposure value for that week, null if projection or no markers) and `svcMarkerList`.

**`fullYDomain`:** includes `svcMarkerY` in max calc when `showServiceCalls` is ON.

**`CFOTTooltip`:** excludes `svcMarkerY` from metric rows; renders 🔧 customer name, date, quoted, collected, remaining, status for each service marker in that week.

**Chart Line added** (`svcMarkerY`, legendType="none", transparent stroke, `dot={<ServiceCallDot />}`, only when `showServiceCalls`).

**Import updated:** added `isActiveServiceCall` to import from `@/services/backupDataService`.

#### What Was NOT Changed
- All CFOT math formulas (`V15rDashboard.tsx`) — untouched
- All data keys: `exposure`, `activeExposure`, `projectedTotalExposure`, `serviceExposure`, `pending`, `svcPay`, `projPay`, `accum`, `markerY` — unchanged
- All zoom/pan/drag/wheel navigation — unchanged
- `V15rDashboard.tsx` — not modified
- `backupDataService.ts` — not modified (only imported already-exported `isActiveServiceCall`)
- No commit made — awaiting user review

#### Manual Verification Checklist
1. Source toggle row is right-aligned above the range/nav controls
2. Service Calls pill is pink when active; Projects pill is indigo
3. Project start dots (amber rings) still appear on Projects Total Exposure line
4. Service call dots (hollow pink squares) appear on Service Calls Exposure line when Service Calls is ON
5. Turning Service Calls OFF hides service call dots
6. Tooltip shows 🔧 customer, date, quoted, collected, remaining, status for weeks with markers
7. Weeks where all service calls have remaining = 0 show no dot
8. Projection weeks show no service call dots
9. All zoom/pan/drag/wheel/reset behavior unchanged
10. Y-axis stable (no bounce during toggle or pan)

**Lock released** — `src/components/v15r/charts/CFOTChart.tsx` is free for other agents.

---

### 2026-06-23 — TLMA Scraper HTTP 403 Diagnostics Fix (committed 40bab75)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Implementation — diagnostics only (no auth bypass, no proxy, no new packages)
**Feature Area:** Sales Intelligence — TLMA scraper 403 fixes
**Branch:** main | HEAD = 40bab75
**Typecheck:** 0 errors ✅

#### Files Changed
- `supabase/functions/tlma-scraper/index.ts`
- `supabase/functions/tlma-scraper/types.ts`
- `src/components/hunter/HunterPanel.tsx`

#### Changes Made

**`index.ts` — header improvements:**
- User-Agent updated from `Chrome/130.0.0.0` to `Chrome/130.0.6723.116` (real stable build)
- Added `Cache-Control: max-age=0` to search headers (matches normal browser navigation)
- `Sec-Fetch-Site: same-origin` retained (correct: Referer and target share origin)

**`index.ts` — session cookie preflight (`fetchTlmaSessionCookie`):**
- Before the search loop, fetches the TLMA root page with `Sec-Fetch-Site: none`
- Extracts Set-Cookie, collapses into `name=val; name2=val2`, adds as Cookie header
- Non-fatal: proceeds without cookie if preflight fails

**`index.ts` — first-error body diagnostic:**
- On first HTTP error, reads response body (HTML-stripped, ≤240 chars)
- Appended to `errors[0]` as ` | body: <snippet>`; stored in `LiveRunReport.first_error_body`

**`types.ts`:** Added `first_error_body?: string` to `LiveRunReport`.

**`HunterPanel.tsx`:** Alert now shows body snippet + 403-block hint when 403 detected.

#### Root Cause Status
- Most likely cause: Supabase IP ranges blocked by RIVCO WAF
- These changes may fix it (missing session cookie) or will reveal the exact block type via body snippet
- Next step: deploy + run Scan with Indio filter, read body hint in alert

**Lock released** — all three files above are free for other agents.

---

### 2026-06-24 — TLMA Scraper 403 Verification (no code changes)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Verification only — no code changes made
**Feature Area:** TLMA Scraper — 403 root cause diagnosis
**Branch:** main | HEAD = 40bab75
**Typecheck:** 0 errors ✅

#### Deployment
- `tlma-scraper` was at v9 (2026-04-28) — pre-fix code
- Deployed v10 via `supabase functions deploy tlma-scraper --project-ref edxxbtyugohtowvslbfo`
- v10 confirmed active at 2026-06-24 05:12:17 UTC

#### Verification Scans Run

**Indio (8 combos, 30 days):**
- Matrix: 8 | Successes: 0 | Failures: 8 | Inserts: 0 | Updates: 0
- First error: `HTTP 403 for INDIO / Commercial Buildings (BNR) | body: Just a moment...`
- `first_error_body`: `Just a moment... *{box-sizing:border-box;margin:0;padding:0}html{line-height:1.15;...`

**Palm Desert (8 combos, 30 days):**
- Matrix: 8 | Successes: 0 | Failures: 8 | Inserts: 0 | Updates: 0
- First error: `HTTP 403 for PALM DESERT / Commercial Buildings (BNR) | body: Just a moment...`
- Same Cloudflare challenge page

#### Root Cause — CONFIRMED: Cloudflare Bot Management

`publiclookup.rivco.org` is behind **Cloudflare Bot Management**. The "Just a moment..." page is Cloudflare's JavaScript challenge response, served to requests from data-center IP ranges (Supabase included). This is **not a header issue** — no amount of User-Agent, Cookie, or Sec-Fetch header manipulation will bypass a Cloudflare JS challenge. The challenge requires real JavaScript execution in a browser context.

**Diagnostics that now work:** `first_error_body` correctly identifies the block type. The alert in HunterPanel shows the body snippet and the "portal may be blocking server-side requests" hint.

#### Architecture Recommendations (TLMA still blocked)

**Option A — Move to Netlify Functions:**
- Netlify's CDN/edge IPs may not be in Cloudflare's data-center blocklist
- Pros: Already have Netlify Functions for EnerGov; same codebase; no new packages
- Cons: Netlify outbound IPs may also be blocked (unknown until tested); Netlify timeout limits apply
- Risk: Medium. Worth a quick test before investing more.

**Option B — Manual CSV/Import:**
- TLMA public portal may offer a CSV export; user downloads directly in browser, imports into system
- Pros: Always works (browser passes Cloudflare); no architecture changes
- Cons: Manual; requires an import UI; not automated
- Risk: Low for reliability, medium for development effort.

**Option C — Browser-Assisted Operator Workflow:**
- User opens TLMA in their browser (passes Cloudflare), copies data, pastes into app
- Pros: Zero infra cost; Cloudflare-safe
- Cons: Very manual; doesn't scale
- Risk: Low technical risk, low value

**Option D — Disable TLMA, Prioritize City-Specific Scrapers (RECOMMENDED):**
- EnerGov already covers Indio + Palm Springs via Netlify (working)
- Build Clariti/OpenGov adapter for Palm Desert (`https://online.palmdesert.gov/`)
- Accept gap for unincorporated Riverside County areas
- Pros: High-value cities already covered or buildable; no Cloudflare issue
- Cons: Misses ~9 CITIES in TLMA list (Coachella, La Quinta, Rancho Mirage, etc.)
- Risk: Low technical risk; gap in coverage for non-EnerGov cities

**Recommended immediate next step:** Test Option A by adding a simple TLMA test endpoint to the existing Netlify city-scraper function and comparing results. If Netlify is also blocked, commit to Option D and build the Palm Desert Clariti adapter.

#### Files Changed This Session
None — verification only.

#### TLMA Status
- **TLMA is blocked from Supabase Edge Functions** — confirmed Cloudflare JS challenge
- **Palm Desert TLMA coverage** — blocked (same Cloudflare block; TLMA is not the right source anyway; Palm Desert uses Clariti)
- **EnerGov (Indio + Palm Springs)** — unaffected, runs from Netlify, not Supabase

---

### 2026-06-24 — Netlify TLMA Reachability Probe (committed 051834c)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped implementation — diagnostic probe only, no DB writes
**Feature Area:** Netlify TLMA Reachability Probe
**Branch:** main | HEAD = 051834c
**Typecheck:** 0 errors ✅

#### Files Inspected
- `netlify/functions/city-scraper.ts`
- `netlify/functions/city-scraper/shared.ts`
- `netlify.toml`
- `package.json` scripts
- `supabase/functions/tlma-scraper/index.ts` (for header/URL reference)

#### Files Changed
- `netlify/functions/city-scraper.ts` (+109 lines)

#### Probe Route Added
```
GET /.netlify/functions/city-scraper?action=tlma-probe
Optional: &city=INDIO&type=BNR&days_back=30
```

Defaults: city=INDIO, type=BNR, days_back=30.
Supported type codes: BNR, BTI, BMN, BRS, BAR, BAS, BSP, BMR.

#### What the Probe Returns
```json
{
  "probe": "tlma-reachability",
  "city": "INDIO",
  "permit_type": "Commercial Buildings (BNR)",
  "permit_type_code": "BNR",
  "days_back": 30,
  "target_url": "https://publiclookup.rivco.org/?...",
  "timestamp": "2026-06-24T...",
  "http_status": 200 | 403 | ...,
  "is_cloudflare_challenge": true | false,
  "looks_parseable": true | false,
  "body_snippet": "first 300 chars of HTML-stripped response"
}
```

#### Local Verification
No `netlify dev` script in repo — Netlify function invocation requires push + Netlify CI deploy. No local result available.

#### Deployment
Commit `051834c` pushed to `origin/main` will trigger Netlify CI auto-deploy.

**User must:**
1. Push: `git push`
2. Wait for Netlify build (~1–2 min)
3. Test: `https://<your-netlify-domain>/.netlify/functions/city-scraper?action=tlma-probe&city=INDIO&type=BNR&days_back=30`

#### Expected Outcomes After Deploy
- **If `is_cloudflare_challenge: false` and `http_status: 200`** → Netlify IPs can reach TLMA. Migrate the full TLMA scraper to Netlify (Option A).
- **If `is_cloudflare_challenge: true` and `http_status: 403`** → Both Supabase and Netlify are blocked. Abandon TLMA automated scraping; pivot to Option D (city-specific: EnerGov for Indio/Palm Springs, Clariti for Palm Desert).

#### Risks
- Probe makes one live request to a public portal per invocation — no abuse risk at manual-trigger frequency
- No DB changes; no side effects

#### Next Recommended Task
**Push commit `051834c`**, then run the probe and report the result back. The result determines whether to migrate TLMA to Netlify or abandon TLMA automation entirely.

---

### 2026-06-24 — Palm Desert Salesforce/Aura Permit Probe

**Agent:** Codex GPT-5.5 Medium Reasoning
**Mode:** Scoped implementation
**Feature Area:** Palm Desert Salesforce/Aura Permit Probe
**Branch:** main

#### Files Inspected
- `AGENT_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md` (Solar Upgrade-specific; not applicable here)
- `netlify/functions/city-scraper.ts`
- `netlify/functions/city-scraper/shared.ts`
- `netlify/functions/city-scraper/indio.ts`
- `netlify/functions/city-scraper/palm-springs.ts`
- `src/components/hunter/HunterPanel.tsx`
- `src/store/hunterStore.ts`
- `netlify.toml`
- `package.json`

#### Files Changed
- `netlify/functions/city-scraper.ts`
- `AGENT_SHARED_CONTEXT.md`

#### Probe Route Added
`GET /.netlify/functions/city-scraper?action=palm-desert-probe&term=el%20paseo&pageSize=5&page=1`

Defaults: `term=el paseo`, `pageSize=5`, `page=1`. `pageSize` is clamped to 1–50 and `page` to 1–100.

#### Aura Endpoint Used
`POST https://palmdesert.my.site.com/s/sfsites/aura?r=79&ui-search-components-forcesearch-scopedresultsdataprovider.ScopedResultsDataProvider.getItems=1`

Descriptor:
`serviceComponent://ui.search.components.forcesearch.scopedresultsdataprovider.ScopedResultsDataProviderController/ACTION$getItems`

The probe first fetches the public global-search page for the requested term and extracts the current `fwuid`, `app`, and loaded application value from its encoded Aura loader context. It then sends a form-encoded Aura request for `MUSW__Permit2__c`.

No copied browser cookies, authenticated session headers, request IDs, trace IDs, page scope IDs, or telemetry headers are used. No Supabase client is created on this route; there are no DB writes or scoring changes.

#### Fields Parsed
- Permit number and source record ID
- Address and city
- APN
- Stage and status (display labels preferred)
- Description
- Issue date and display date
- Created date and display date
- Last modified date
- Expiration date
- Public permit detail URL
- Recursive raw field-name discovery for diagnostics

Response classification covers successful Aura JSON, Salesforce/Aura error, HTML login page, blocked/challenge page, unexpected HTML, bootstrap parse failure, JSON parse failure, and fetch failure.

#### Local Verification
Bundled the Netlify function locally with the installed esbuild runtime and invoked the handler directly against the live public endpoint.

Result:
- `response_type`: `successful_aura_json`
- Bootstrap HTTP status: 200
- Aura HTTP status: 200
- `has_error`: false
- `totalSize`: 5
- `moreResultsAvailable`: true
- Sample count: 5
- Permits: `DEMO-26-0018`, `CRAD-25-5018`, `DFPP-26-0001`, `SIGN-26-0023`, `TIMP25-0058`

The public detail URL pattern was also checked and returned HTTP 200. Salesforce canonicalizes permit slugs to lowercase alphanumeric text.

#### Verification Results
- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS after rerunning outside the filesystem sandbox; existing Vite dynamic-import/chunk-size warnings only
- `git diff --check`: PASS

#### Production Verification URL
`https://app.poweronsolutionsllc.com/.netlify/functions/city-scraper?action=palm-desert-probe&term=el%20paseo&pageSize=5&page=1`

#### Risks
- Aura `fwuid` and loaded application values can rotate; the probe mitigates this by extracting them from a fresh public search page on every invocation.
- Salesforce can change the encoded loader URL or Aura response shape; explicit response classifications and body snippets make that diagnosable.
- The confirmed endpoint performs broad text search, not date-window filtering. A full importer will need a deliberate crawl/query strategy plus deduplication before any DB writes.
- Netlify production egress still requires post-deploy verification even though the local backend invocation succeeded without cookies/session state.

#### Next Recommended Task
After production verification, design the full Palm Desert importer as a separate scoped task: pagination/query strategy, permit relevance filtering, scoring integration, dedup/upsert behavior, run logging, and dry-run review before enabling any `hunter_leads` writes.

---

### 2026-06-24 — Palm Desert Aura Dry-Run Importer

**Agent:** Codex GPT-5.5 Medium Reasoning
**Mode:** Scoped dry-run implementation
**Feature Area:** Palm Desert Aura Dry-Run Importer
**Branch:** main

#### Files Inspected
- `AGENT_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md` (Solar Upgrade-specific; not applicable here)
- `netlify/functions/city-scraper.ts`
- `netlify/functions/city-scraper/shared.ts`
- `netlify/functions/city-scraper/indio.ts`
- `netlify/functions/city-scraper/palm-springs.ts`
- `src/components/hunter/HunterPanel.tsx`
- `src/store/hunterStore.ts`
- `netlify.toml`
- `package.json`

#### Files Changed
- `netlify/functions/city-scraper.ts`
- `AGENT_SHARED_CONTEXT.md`

#### Dry-Run Route Added
`GET /.netlify/functions/city-scraper?action=palm-desert-dry-run&pageSize=10&maxPages=2`

Optional parameters:
- `terms`: comma-separated, deduped, capped at 15
- `pageSize`: default 10, clamped to 1–25
- `maxPages`: default 2, clamped to 1–5
- `minScore`: default 40, clamped to 0–100
- `includeCompleted`: default false

Default terms:
`electrical`, `tenant improvement`, `lighting`, `panel`, `service`, `meter`, `sub meter`, `EV`, `solar`, `commercial`, `el paseo`.

The dry run uses one fresh public Aura bootstrap per invocation and reuses it across bounded three-term concurrency. Pages within each term remain sequential and stop when `moreResultsAvailable` is false, an empty page is returned, or an error occurs.

#### Normalized Fields
- `permit_number`
- `source_record_id`
- `address`
- `city`
- `apn`
- `stage`
- `status`
- `description`
- `issue_date`
- `issue_date_display`
- `created_date`
- `created_date_display`
- `last_modified_date`
- `expiration_date`
- `source_url`
- `matched_terms`

#### Dedupe Strategy
In-memory map keyed by `source_record_id` first. If no record ID is present, fallback is normalized lowercase `permit_number`. Duplicate hits merge their `matched_terms`.

#### Scoring / Classification Strategy
The existing EnerGov scorer was not reused because it depends on EnerGov-specific work-class and contractor fields that the Aura response does not provide. A dry-run-only classifier adds:
- +35 electrical keyword signal
- +25 tenant-improvement signal
- +20 commercial signal
- +15 active-status signal
- up to +10 for matching multiple search terms
- penalties for completed, cancelled/expired, or records stale by age

It returns `opportunity_score`, `opportunity_tier`, `score_factors`, `opportunity_flags`, and matched keyword groups. This is explicitly reported as a preview heuristic; a production importer should align it with the canonical HUNTER model before writes are enabled.

#### Local Verification
Bundled the Netlify function locally and invoked the handler against the live public Palm Desert Aura endpoint.

Default dry-run result:
- Elapsed: about 3.9 seconds
- Pages requested: 21
- Raw records seen: 200
- Unique records: 165
- Eligible records after completed/cancelled exclusion: 113
- Records meeting default minimum score 40: 84
- High-opportunity records (score 60+): 23
- Completed/cancelled skipped: 52
- Errors: 0

Top result:
- `CRAD-25-5018`
- Score: 99
- Status: In Progress
- Matched terms: tenant improvement, lighting, el paseo
- Flags: electrical, commercial, tenant improvement, active

The original `palm-desert-probe` route was regression-tested after the refactor and still returned the confirmed five records with `successful_aura_json`.

#### Verification Results
- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS; existing Vite dynamic-import/chunk-size warnings only
- `git diff --check`: PASS

#### Production Verification URL
`https://app.poweronsolutionsllc.com/.netlify/functions/city-scraper?action=palm-desert-dry-run&pageSize=10&maxPages=2`

#### Risks
- The global search action is relevance/term based, not a complete date-ordered permit feed. Search-term coverage must be reviewed before calling this exhaustive.
- Production scoring is not yet aligned; dry-run scores must not be persisted as canonical HUNTER scores.
- Search results can overlap heavily, making in-memory dedupe essential.
- Aura loader and response shapes can change; helper-level response classifications preserve diagnostics.
- The default request completed well inside the 26-second Netlify timeout locally, but production runtime should still be measured after deploy.

---

### 2026-06-24 — Palm Desert Aura Controlled Importer

**Agent:** Codex GPT-5.5 Medium Reasoning
**Mode:** Scoped implementation
**Feature Area:** Palm Desert Aura Controlled Importer
**Branch:** main

#### Files Inspected
- `AGENT_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md` (Solar Upgrade-specific; not applicable)
- `netlify/functions/city-scraper.ts`
- `netlify/functions/city-scraper/shared.ts`
- `netlify/functions/city-scraper/indio.ts`
- `netlify/functions/city-scraper/palm-springs.ts`
- `src/components/hunter/HunterPanel.tsx`
- `src/store/hunterStore.ts`
- `src/services/hunter/HunterTypes.ts`
- `src/services/hunter/cronRunLogService.ts`
- `supabase/migrations/052_hunter_tables.sql`
- `supabase/migrations/070_tlma_scraper_schema.sql`
- `supabase/migrations/071_geocoding_distance_settings.sql`
- `supabase/migrations/072_cron_run_log.sql`
- `supabase/migrations/074_source_city.sql`

#### Files Changed
- `netlify/functions/city-scraper.ts`
- `AGENT_SHARED_CONTEXT.md`

#### Import Route Behavior
The existing route remains:
`GET /.netlify/functions/city-scraper?action=palm-desert-dry-run`

Default invocation remains read-only. Controlled writes require both:
- `write=true`
- `confirm=palm-desert-import`

If `write=true` is supplied without the exact token, the function returns HTTP 400 immediately, before fetching Aura data or creating a Supabase client.

The response now includes:
- `dry_run`
- `write_requested`
- `write_confirmed`
- `rows_considered`
- `rows_inserted`
- `rows_updated`
- `rows_skipped`
- `duplicate_count`
- `in_memory_duplicate_count`
- `existing_duplicate_count`
- `error_count`
- `errors`

#### Dedupe / Upsert Strategy
- Aura results are first deduped in memory by `source_record_id`, falling back to permit number.
- Database lookup uses `tenant_id + permit_number`, matching the existing unique tenant/permit constraint.
- The later `(permit_number, source_city)` index is non-unique, so it cannot safely override the stricter tenant/permit uniqueness rule.
- Existing records are updated by ID; new records are inserted.
- Existing HUNTER workflow `status` and original `discovered_at` are preserved on updates.
- Existing lookups are batched in groups of 100. New leads are bulk inserted; existing leads are updated with bounded concurrency to stay within the Netlify timeout.

The current schema has no `source_record_id` column. It is retained in the route preview but not persisted. A later additive schema enhancement is recommended if Salesforce record identity needs to survive permit-number changes.

#### Field Mapping
- `source`: `palm_desert_aura`
- `source_tag`: `city-portal`
- `lead_type`: `permit`
- `permit_number`: Palm Desert permit number
- `permit_url` / `portal_url`: public Salesforce permit detail URL
- `permit_type_code`: alphabetic permit-number prefix such as `CRAD`, `ELEC`, or `SOLR`
- `permit_type_label`: `Palm Desert Permit`
- `permit_status`: normalized Aura status, falling back to stage
- `applied_date`: normalized created date
- `issued_date`: normalized issue date
- `expired_date`: normalized expiration date
- `address`, `city`, `description`
- `score`: dry-run opportunity score
- `score_tier`: mapped to existing elite/strong/qualified/expansion bands
- `score_factors`: numeric JSON factor map plus matched-term count
- `source_city`: `Palm Desert`
- `run_source`: `manual`
- `last_seen_at`, `last_updated`

APN, source record ID, matched term strings, and detailed opportunity flag objects are not written because no safe existing columns match those values.

#### Run Logging
Not added. `cron_run_log` is TLMA-oriented and has no source column. Its UI groups solely by city, so writing Palm Desert Aura rows there would incorrectly mix Aura health with TLMA health. Reuse requires a source-aware schema/UI change outside this scoped task.

#### Safe Local Verification
- Default dry run: HTTP 200, `dry_run=true`, `write_requested=false`, `write_confirmed=false`, 84 rows considered, 0 inserted, 0 updated, 0 errors.
- Invalid write confirmation: HTTP 400, `write_requested=true`, `write_confirmed=false`, 0 inserted. Rejected before portal fetch or Supabase access.
- Confirmed write route was intentionally not invoked.

#### Verification Results
- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS; existing Vite dynamic-import/chunk-size warnings only
- `git diff --check`: PASS

#### Manual Verification URLs
Dry run:
`https://app.poweronsolutionsllc.com/.netlify/functions/city-scraper?action=palm-desert-dry-run&pageSize=10&maxPages=2`

Controlled write, only when explicitly approved:
`https://app.poweronsolutionsllc.com/.netlify/functions/city-scraper?action=palm-desert-dry-run&pageSize=10&maxPages=2&write=true&confirm=palm-desert-import`

#### Risks
- The unique database constraint is tenant + permit number, so an identical permit number from another source would resolve to the existing tenant record.
- Dry-run scoring is still the imported score; production scoring alignment remains a recommended follow-up.
- Source record ID and APN are not persisted under the current schema.
- Batch inserts can fail as a batch if a concurrent importer creates one of the same permits between lookup and insert; errors are reported and the route remains safely retryable.
- No production write invocation has been performed yet.
