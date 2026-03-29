# Power On Hub — Master Build & Integration Handoff Spec
# For All Coding AI Models (Claude, Cowork, and others)

> **CRITICAL FIRST INSTRUCTION — READ BEFORE ANYTHING ELSE**
> This document is the law for this project. Before writing a single line of code, read this entire file.
> Also read `poweron_v2_handoff_complete.md` in the project root if it exists.
> Every implementation decision must comply with both documents.
> Do not redesign. Do not rewrite. Extend carefully. Preserve everything working.

---

## Purpose

This document is a **full implementation handoff** for any coding AI model continuing work on the Power On Hub app. It exists to prevent regressions, preserve working logic, and ensure every future session builds on what already works without breaking it.

The target is **not** to redesign from scratch.
The target is to:
- preserve the current working model,
- integrate improvements carefully,
- keep the app stable across **Windows, iPad, and iPhone**,
- keep **Netlify deployment + Supabase backup/sync** working,
- and avoid regressions in service history, collections, and dashboard navigation.

---

## Section 1 — App Identity

**What this app is:**
Power On Hub is an internal operating system for a small California electrical contractor business (Power On Solutions LLC, C-10 License #1151468, Coachella Valley / Desert Hot Springs, CA). It is the owner's primary daily operations tool.

**It is used for:**
- active project tracking
- service call logging
- collections follow-up
- field logs
- project exposure overview
- cost/profit visibility
- coordination/task tracking
- graph dashboard views
- home-page operational summaries
- estimating and material takeoff
- price book management
- team/employee tracking
- income and RMO calculator

The app must feel like a **contractor dashboard**, not a spreadsheet clone.

**Primary user devices:**
- Windows desktop/laptop
- iPad 13
- iPhone 16

**Deployment / storage model:**
- **V2 React app** (primary): auto-deployed via **Netlify** from `github.com/christiandubon01/poweron-hub`
- **Legacy HTML app**: `poweron_v16j_cashflow_1_5x_taller.html` (stable reference, not actively deployed)
- Cloud backup / cross-device sync via **Supabase** (table: `app_state`, key: `poweron_v2`, project: `edxxbtyugohtowvslbfo`)
- All 27 Supabase migrations applied
- Multi-device sync working: Windows + iPhone via Supabase with device ID system
- Local-first — app must work offline

**Architecture:**
V2 React app (React 18 + TypeScript + Vite 5 + Tailwind CSS) with component-per-panel structure. Original single-file HTML app preserved as stable reference. State held in one main object (`S`) for backward compatibility. Claude AI proxy via `netlify/functions/claude.ts`. Export format is identical between HTML and React apps — same JSON, same keys.

---

## Section 2 — Complete State Schema

The main state object `S` contains these keys. All must be preserved on read/write.

| Key | Type | Contents | Used By | Risk Level |
|-----|------|----------|---------|------------|
| `projects` | array | Project records (see Section 9) | Projects, Home, Money, Field Log | CRITICAL |
| `serviceLogs` | array | Service call records (see Section 8) | Field Log, Home, Money | CRITICAL |
| `logs` | array | Project field log entries | Field Log, Home | CRITICAL |
| `fieldLogs` | array | Additional field log store | Field Log | CRITICAL |
| `priceBook` | array | 240+ price book items (see Section 11) | Price Book, MTO | HIGH |
| `templates` | array | 4 project templates | Templates | MEDIUM |
| `gcContacts` | array | GC contact records | Leads | MEDIUM |
| `serviceLeads` | array | Service lead pipeline | Leads | MEDIUM |
| `weeklyReviews` | array | Weekly review records | Leads | MEDIUM |
| `weeklyData` | array | 52-week cash flow tracker | Money, Dashboard | HIGH |
| `agendaSections` | array | Home agenda sections with tasks | Home | MEDIUM |
| `triggerRules` | array | 8 business trigger rules | Field Log Triggers | MEDIUM |
| `employees` | array | Employee records | Team, Field Log | MEDIUM |
| `taskSchedule` | array | Scheduled tasks | Home | LOW |
| `completedArchive` | array | Archived completed jobs | Pricing Intelligence | MEDIUM |
| `settings` | object | App settings (see Section 12) | Settings, all panels | HIGH |
| `calcRefs` | object | RMO/Income calculator inputs | Income Calc | MEDIUM |
| `blueprintSummaries` | object | Per-project framework data (p1-p9) | Project Framework | MEDIUM |
| `projectDashboards` | object | Per-project dashboard snapshots | Projects | MEDIUM |
| `activeServiceCalls` | array | Active service call queue | Service Log | HIGH |
| `serviceEstimates` | array | Service estimates | Service Log | MEDIUM |
| `customers` | array | Customer records | Service Log | MEDIUM |
| `vendors` | array | Vendor records | Settings | LOW |
| `quotes` | array | Quote records | Estimates | MEDIUM |
| `history` | array | Undo history stack | Ctrl+Z/Y | HIGH |
| `snapshots` | array/object | Named state snapshots | Settings | HIGH |
| `gcalCache` | array | Google Calendar cache | Home | LOW |
| `gcalOnline` | boolean | Calendar connection status | Home | LOW |
| `currentProjectId` | string | Active project ID | All project tabs | HIGH |
| `activeId` | string | Active project (legacy) | Projects | MEDIUM |
| `view` | string | Current active panel | Navigation | HIGH |
| `theme` | string | dark/light | Layout | LOW |
| `_lastSavedAt` | number | Timestamp of last save | Sync | CRITICAL |
| `_schemaVersion` | number | Schema version number | Sync | HIGH |

**Backward compatibility rule:** When loading state, normalize missing keys safely. Never assume a new key exists. Never delete older keys silently. Never convert old records destructively on load.

---

## Section 3 — Function Index (HTML App)

Key render functions in the HTML app that must be ported faithfully to React:

| Function | Panel/Tab | Reads | Writes | Notes |
|----------|-----------|-------|--------|-------|
| `renderHome()` | Home | projects, serviceLogs, logs, agendaSections | agendaSections | Google Calendar embed, Job Health, Service Jobs Requiring Attention, Recent Activity |
| `renderProjects()` | Projects | projects | projects | Uses resolveProjectBucket(), health(), getProjectFinancials() |
| `renderEstimate()` | Project > Estimate | projects[active] | projects[active].laborRows, ohRows | Labor/Materials/Overhead/Mileage, donut chart, margin calc |
| `renderMaterialTakeoff()` | Project > MTO | projects[active].mtoRows | projects[active].mtoRows | Phase tabs, source links, PDF import |
| `renderProgress()` | Project > Progress | projects[active].phases, tasks | projects[active] | Health score, phase weights, task schedule |
| `renderProjectFramework()` | Project > Framework | blueprintSummaries | blueprintSummaries | Import/export framework, 3-column layout |
| `renderRFITracker()` | Project > RFI | projects[active].rfis | projects[active].rfis | RFI CRUD |
| `renderCoordination()` | Project > Coordination | projects[active].coord | projects[active].coord | 7 sections with add/edit/complete/delete |
| `renderFieldLog()` | Field Log | logs, serviceLogs, projects | logs, serviceLogs | 3 tabs: Project Log, Service Log, Triggers |
| `renderMoney()` | Money | projects, serviceLogs, weeklyData | weeklyData | KPIs, Exposure Framework, Cash Waterfall, Payment Tracker |
| `renderIncomeCalc()` | Income Calc | calcRefs | calcRefs | RMO calculator, per-system breakdown, charts |
| `renderPriceBook()` | Price Book | priceBook | priceBook | Grouped by category, supplier cost vs client price |
| `renderLeads()` | Leads | gcContacts, serviceLeads, weeklyReviews | all three | 3 tabs |
| `renderTemplates()` | Templates | templates, completedArchive | templates | 4 templates with phases, risk notes |
| `renderPricingIntelligence()` | Pricing Intelligence | completedArchive, projects | completedArchive | Archive queue, job-type benchmarks |
| `renderTeam()` | Team | employees, logs | employees | Employee cards, hours by employee table |
| `renderSettings()` | Settings | settings, all overhead | settings | Business identity, estimating defaults, overhead, sync |
| `renderGraphDashboard()` | Graph Dashboard | projects, weeklyData, serviceLogs | none | CFOT, OPP, PCD, EVR charts — nav regression risk |

**Key utility functions:**
- `health(p)` — 0-100 project health score with reasons and color class
- `getProjectFinancials(p)` — finance buckets with overrides (contract, billed, paid, unbilled, AR)
- `resolveProjectBucket(p)` — returns 'active', 'coming', or 'completed'
- `ov(p)` / `getOverallCompletion(p)` — weighted phase completion percentage
- `num(v)` — safe number parse, returns 0 for undefined/null
- `fmt(v)` — currency formatter
- `fmtK(v)` — compact currency formatter ($1.2k)
- `pct(v)` — percentage formatter
- `daysSince(dateStr)` — days elapsed since date
- `getPhaseWeights()` — reads phase weights from settings
- `buildProjectLogRollup(p)` — cumulative field log totals per project
- `syncAllProjectFinanceBuckets()` — syncs all project finance calculations
- `exportBackup()` — exports full state as PowerOn_Backup_[timestamp].json
- `pushHistory()` — pushes current state to undo stack
- `undo()` / `redo()` — Ctrl+Z / Ctrl+Y handlers

---

## Section 4 — Supabase Sync Architecture

**Configuration:**
- Table: `app_state`
- State key: `poweron_v2`
- Project ref: `edxxbtyugohtowvslbfo` (PowerOn Solutions Operations Hub)

**Sync principles (non-negotiable):**
1. **Local-first** — app works fully offline
2. **No blind overwrite by timestamp** — newer remote is not always better
3. **Richness guard** — if remote snapshot has fewer serviceLogs or projects than local, prefer local
4. **No fragile UI coupling** — opening a panel never triggers a required cloud read
5. **Graceful degradation** — 401/403 errors degrade silently, app stays functional

**Richness guard logic:**
```
if (remote._lastSavedAt > local._lastSavedAt) {
  if (remote.serviceLogs.length >= local.serviceLogs.length &&
      remote.projects.length >= local.projects.length) {
    // remote is newer AND richer — use remote
  } else {
    // remote is newer but THINNER — keep local
  }
}
```

**Disconnect/test mode:**
- A toggle in Settings pauses all Supabase writes
- Used for testing changes without corrupting live data
- Must remain functional in V2 React app

---

## Section 5 — Undo/Redo System

**Keyboard shortcuts:** Ctrl+Z (undo), Ctrl+Y (redo)

**Implementation:**
- Every data mutation calls `pushHistory()` before applying the change
- `pushHistory()` deep-clones current state and pushes to `S.history` array
- History depth: 50 steps (prune oldest when exceeded)
- Undo: pop last history entry, restore to state, re-render
- Redo: maintain a separate redo stack, push on undo, pop on redo
- Toast notification on undo/redo showing what was undone

**Triggers a history push:**
- Any add/edit/delete on projects, service logs, field logs, price book, leads, templates, trigger rules, settings, overhead items

**Must be preserved in V2 React app** — wire Ctrl+Z/Y listeners at layout level.

---

## Section 6 — Snapshot System

**What it is:** Named point-in-time saves of the entire state, distinct from the undo history.

**Storage:** Stored in `S.snapshots` object, keyed by snapshot name/timestamp. Also backed up to Supabase.

**How save works:**
- User gives snapshot a name
- Current state deep-cloned and stored in `S.snapshots[name]`
- Timestamp recorded
- Snapshot appears in Settings > Snapshot Manager list

**How restore works:**
- User selects snapshot from list
- Current state replaced with snapshot state
- History push before restore so it's undoable

**Must be preserved in V2 React app** — Settings panel must include Snapshot Manager.

---

## Section 7 — Navigation Architecture

**Desktop sidebar sections:**
```
WORKSPACE
  Home
  Projects
  Leads
  Templates
  Pricing Intelligence

ACTIVE PROJECT (shows when project selected)
  Estimate
  Material Takeoff
  Progress
  Project Framework
  RFI Tracker
  Coordination

BUSINESS
  Field Log
  Money
  Income Calc
  Price Book
  Team
  Settings
```

**Navigation regression history:**
- Graph Dashboard has been accidentally removed from nav in past rebuilds — always verify it has a sidebar entry AND a render function AND a routing case
- Triggers tab inside Field Log has been orphaned before — verify 3-tab structure
- Active Project section disappears when project selection logic breaks — verify currentProjectId triggers sidebar switch

**Navigation rules:**
Any time a tab is added or modified, verify:
1. Desktop sidebar entry exists
2. Mobile nav entry exists if applicable
3. Router/switch case recognizes the tab ID
4. Render function exists and is called
5. No orphaned sections

---

## Section 8 — Service Job Model (CRITICAL — Most Fragile)

**Complete service log record structure:**
```javascript
{
  id: string,
  customer: string,
  address: string,
  date: string (YYYY-MM-DD),
  hrs: number,
  miles: number,
  quoted: number,        // base quote
  collected: number,     // amount collected so far
  mat: number,           // materials cost
  opCost: number,        // operating cost
  jtype: string,         // job type
  payStatus: string,     // NEVER use this as source of truth — use money math
  notes: string,
  store: string,
  detailLink: string,
  emergencyMatInfo: string,
  adjustments: [],       // ledger adjustments array
  mileCost: number,
  balanceDue: number,    // derived, not authoritative
  profit: number,        // derived
  triggersAtSave: [],
  compareWarnings: [],
  estimateComparison: {}
}
```

**Ledger adjustment types (must remain tied to service call ID):**
- `Add Expense` — increases total actual cost
- `Add Mileage` — increases total actual cost and all added cost
- `Add Income` — increases total billable

**Roll-up formulas (exact):**
```
Total Billable = quoted + sum(adjustments where type=income)
Total Actual Cost = mat + opCost + mileCost + sum(adjustments where type=expense or mileage)
Remaining Balance = Total Billable - collected
Projected Margin = Total Billable - Total Actual Cost
Cash-real Margin = collected - Total Actual Cost
```

**Collections Queue inclusion rule (always use money math, never stale label):**
```
show in queue if: collected < Total Billable OR Remaining Balance > 0
```

**Payment status display (derived, never from stale flag):**
```
if collected === 0: "Unpaid / Full balance left"
if 0 < collected < Total Billable: "Partial balance left"
if collected >= Total Billable: "Paid in full"
```

---

## Section 9 — Project Model

**Complete project record structure:**
```javascript
{
  id: string,             // p1, p2, p3...
  name: string,
  type: string,           // New Construction, Service, Commercial TI, Solar
  status: string,         // active, coming, completed
  contract: number,
  billed: number,
  paid: number,
  mileRT: number,         // round trip miles
  miDays: number,
  lastMove: string,       // date of last phase update
  phases: {               // phase name: completion %
    Planning: 0-100,
    Estimating: 0-100,
    "Site Prep": 0-100,
    "Rough-in": 0-100,
    Trim: 0-100,
    Finish: 0-100
  },
  tasks: {                // phase name: task array
    Planning: [],
    ...
  },
  laborRows: [],          // estimate labor line items
  ohRows: [],             // estimate overhead rows
  matRows: [],            // estimate material rows
  mtoRows: [],            // material takeoff line items
  phaseEstimateRows: {},  // MTO organized by phase
  rfis: [],               // RFI records
  coord: {},              // coordination sections
  logs: [],               // embedded field logs
  finance: {              // finance overrides
    contractOverride: number,
    billedOverride: number,
    manualPaidAdjustment: number
  },
  templateId: string,
  templateName: string,
  projectCode: string,    // POS-001 format
  estimateReference: {},
  lastCollectedAt: string,
  lastCollectedAmount: number
}
```

**Finance bucket (getProjectFinancials):**
```
contract = finance.contractOverride || contract
billed = finance.billedOverride || billed
paid = paid + finance.manualPaidAdjustment
unbilled = contract - billed
AR = billed - paid
```

**Health score (0-100):**
```
starts at 100
-20 if stale > 14 days (no phase movement)
-15 if has open RFIs
-10 if exposure > contract * 0.5
-10 if completion < 10% and status is active
+0 minimum (floor at 0)

color: 80-100 = green, 60-79 = yellow, 0-59 = red
```

**resolveProjectBucket:**
```
completed: status === 'completed' OR overall completion >= 100%
active: status === 'active'
coming: everything else
```

---

## Section 10 — Dashboard and Graph Panel

**Graph Dashboard reads:**
- `projects` — for CFOT (Cash Flow Over Time) and OPP (Open Projects Pipeline)
- `weeklyData` — for cash flow charts
- `serviceLogs` — for service revenue lines
- `settings` — for financial targets

**Chart types:**
- CFOT — cash flow over time (line chart)
- OPP — open projects pipeline (bar chart)
- PCD — project completion distribution
- EVR — exposure vs revenue ratio

**Nav regression history:** Graph Dashboard has been removed from nav accidentally in at least one rebuild. Always verify sidebar entry, mobile nav entry, and render function are all present.

---

## Section 11 — Price Book Model

**Item structure:**
```javascript
{
  id: string,
  name: string,
  cat: string,           // category name
  cost: number,          // my cost (supplier cost)
  unit: string,          // ft, ea, box, etc.
  pack: number,          // pack size
  waste: number,         // waste factor %
  src: string,           // supplier source
  link: string,          // supplier URL
  pidBlock: string,      // product ID block
  pidBand: string,       // product ID band
  legacyId: string
}
```

**Category grouping:** Items grouped by `cat` field. Categories include: Wire — Romex, Wire — Stranded, Wire — MC Cable, Conduit — PVC, Conduit — EMT, Boxes, Breakers, Panels, etc.

**Client price calculation:** `clientPrice = cost * (1 + markup/100)` where markup comes from `settings.markup` (default 150%)

**MTO link:** MTO line items reference price book items by `id` for cost lookups.

---

## Section 12 — Settings and Overhead Model

**Settings object keys:**
```javascript
{
  tax: number,           // sales tax %
  markup: number,        // material markup % (default 150)
  billRate: number,      // owner bill rate $/hr (default 95)
  opCost: number,        // default OB rate $/hr
  mileRate: number,      // IRS mileage rate (default 0.67)
  amBlock: number,       // AM revenue target $
  pmBlock: number,       // PM revenue target $
  company: string,       // Power On Solutions, LLC
  license: string,       // C-10 Contractor #1151468
  gcalUrl: string,       // Google Calendar embed URL
  waste: number,         // default waste factor %
  dailyTarget: number    // daily revenue target $
}
```

**Overhead sections:** Essential Overhead, Extra Acquired Overhead, Loans & Credit Cards, Vehicle Expenses. Each section contains line items with description and monthly amount. Totals roll up to Monthly Overhead → Annual Overhead → Real Cost per Billable Hour.

**Phase weights:** Configurable % per phase (Trim, Finish, Planning, Rough-in, Site Prep, Estimating). Must sum to 100%.

---

## Section 13 — Backup/Export Format

**Export filename:** `PowerOn_Backup_[YYYY-MM-DD]_[HH-MM-SS].json`

**All exported keys (from backup analysis):**
`logs, view, theme, quotes, catalog, history, vendors, activeId, calcRefs, projects, settings, calOffset, customers, dailyJobs, employees, fieldLogs, gcalCache, priceBook, templates, gcContacts, gcalOnline, weeklyData, serviceLogs, _lastSavedAt, serviceLeads, taskSchedule, triggerRules, gcalLastError, gcalLastFetch, weeklyReviews, _schemaVersion, agendaSections, completedArchive, currentProjectId, serviceEstimates, projectDashboards, activeServiceCalls, blueprintSummaries`

**Import/restore:** Import reads the JSON file, validates schema version, merges with current state (does not blindly overwrite — applies richness guard), then saves to localStorage and Supabase.

**V2 React compatibility:** Export from HTML app must be importable into V2 React app and vice versa. Same JSON format, same keys. `backupDataService.ts` maps these keys to React panel components.

---

## Section 14 — Known Regressions and Fixes

1. **Cloud snapshot overwrote richer local state** — Caused by blind timestamp comparison. Fixed by richness guard checking serviceLogs.length and projects.length before overwriting.

2. **Service logs disappeared after rebuild** — Caused by strict filter on a newly introduced `status` field that old records didn't have. Fixed by initializing missing fields to defaults on load.

3. **Graph Dashboard disappeared from nav** — Caused by nav rebuild that forgot to include graph dashboard entry. Fixed by adding sidebar item, mobile tab, and router case.

4. **Collections Queue showed wrong payment status** — Caused by reading stale `payStatus` flag instead of calculating from money math. Fixed by always deriving status from `collected` vs `Total Billable`.

5. **Active Project tabs disappeared** — Caused by `currentProjectId` not being set when navigating to project from Projects panel. Fixed by setting `currentProjectId` on project card click.

6. **Open Projects Exposure included Coming Up projects** — Caused by filtering on wrong field. Fixed by using `resolveProjectBucket()` and only including `active` bucket.

7. **Calendar defaulted to month view** — Caused by missing `defaultView: 'week'` in Google Calendar embed URL params. Fixed by appending `&mode=WEEK` to embed URL.

8. **UI interactions triggered cloud reads causing 401 errors** — Caused by click handlers that called `supabaseRead()` unnecessarily. Fixed by making reads lazy (only on explicit sync action, not on panel open).

---

## Section 15 — Non-Negotiable Rules

These rules must never be violated under any circumstances:

- **Never overwrite richer local state with thinner remote state**
- **Never rebuild the service model wholesale** — extend with ledger adjustments only
- **Never remove undo/redo (Ctrl+Z/Y)** — it is a core user feature
- **Never remove the snapshot system** — it is a core user feature
- **Never break Graph Dashboard navigation** — always verify sidebar + mobile + router
- **Collections Queue must always use money math, never stale labels**
- **Open Projects Exposure only includes Active bucket projects**
- **Calendar must default to week view**
- **All AI suggestions require explicit user confirmation before saving** — never auto-apply
- **Prefer stable + slightly simpler over clever + fragile**
- **Every feature change must be a surgical extension, not a sweeping rewrite**
- **Backward compatibility is mandatory** — old records must load correctly after any change
- **Local-first** — app must work without Supabase connection
- **Sync table: `app_state`, key: `poweron_v2`** — do not change without migration

---

## Section 16 — Current Build Status (Updated March 28, 2026)

**HTML app:** `poweron_v16j_cashflow_1_5x_taller.html` (latest stable HTML branch)

**V2 React app:** Located at `C:\Users\chris\Desktop\Power On Solutions APP - CoWork\`
Running at `localhost:5173`, deployed via **Netlify auto-deploy** from `github.com/christiandubon01/poweron-hub`
Stack: React 18 + TypeScript + Vite 5 + Tailwind CSS

**Current Phase:** Phase E (SPARK Full Automation) — NOT YET STARTED

### Completed Phases

**Phase A — Intelligence Layer: COMPLETE**
- Claude proxy via `netlify/functions/claude.ts`
- All 11 agents proactive with real Claude API integration
- Voice pipeline working (Whisper STT + ElevenLabs TTS + speechSynthesis fallback)
- NEXUS classifier with electrical contractor domain routing
- Persistent memory via `nexusMemory.ts`
- Voice transcript panel
- Multi-turn conversation on all agents
- Agent interview system (`AgentInterviewCard.tsx`)

**Phase B — Cross-Agent Communication: COMPLETE**
- `agentEventBus.ts` with 16+ event types
- `ledgerDataBridge.ts` with real financial data
- VAULT → LEDGER estimate-to-invoice pipeline
- OHM → BLUEPRINT compliance flag propagation
- SPARK → CHRONO lead booking suggestions
- PULSE → NEXUS weekly digest
- SCOUT gap detection and proposals

**Phase C — MiroFish Verification: COMPLETE**
- `miroFish.ts` 5-step verification chain
- `ProposalQueuePanel.tsx` with approve/reject UI
- `auditTrail.ts` with Supabase logging
- MiroFish gates on VAULT, LEDGER, BLUEPRINT, OHM, CHRONO, SPARK

**Phase D — CHRONO Automation: COMPLETE**
- Smart job scheduling with crew/travel/permit scoring
- Crew dispatch with geography clustering
- Idle slot detection (14-day scanner)
- Conflict alerts 48h advance
- Client reminder drafts through MiroFish
- Google Calendar two-way sync

### Infrastructure Status
- **Netlify deploy:** Working, auto-deploy from `github.com/christiandubon01/poweron-hub`
- **Supabase:** Project `edxxbtyugohtowvslbfo` — all 27 migrations applied
- **Data sync:** Timestamp-only resolution, device ID system, force sync button
- **Multi-device sync:** Windows + iPhone syncing correctly via Supabase
- **API keys in Netlify:** `ANTHROPIC_API_KEY`, `VITE_ANTHROPIC_API_KEY`, `VITE_ELEVENLABS_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`

### Working in V2
- Auth (passcode + biometric)
- Top bar KPI pills
- Sidebar navigation
- Home panel (partial — see open items below)
- Projects panel
- Active Project tabs: Estimate, Material Takeoff, Progress, Project Framework, RFI Tracker, Coordination
- Leads panel
- Field Log (partial — see open items below)
- Money panel
- Price Book
- Team panel
- Settings panel
- Income Calculator (inputs work, visualization incomplete)
- All 11 AI agents via Claude API with multi-turn conversation
- Voice pipeline (Whisper + ElevenLabs + speechSynthesis fallback)
- Agent interview system
- Cross-agent communication (16+ event types)
- MiroFish verification chain with approve/reject UI
- CHRONO smart scheduling, crew dispatch, idle slot detection
- Backup import/export
- Undo/redo service (`undoRedoService.ts` exists — wiring to layout unverified)
- Graph Dashboard (`V15rDashboard.tsx` exists — full nav wiring unverified)

### Known Open Items (Queued for Next Prompt)
1. SVC Unbilled topbar — show whole dollars only (no cents)
2. Home page AI button with voice/chat for daily analysis
3. Revenue vs Cost Analysis — project filter + timeline like CFOT
4. Field Log triggers — bucket selector (projects vs service calls) + AI study
5. 52-week tracker — correct project vs service call bucket separation
6. Solar Income — employee cost breakdown option
7. Solar Income Deal Outlook — replace with revenue streams comparison
8. Teams tab — add accumulating cost vs revenue linear graph
9. Dark/Light theme — still not switching correctly
10. Mobile AI agents — record/transcribe/think but no audio response on iPhone/iPad
11. CFOT chart boxes (exposure, unbilled, pending, service, project, accumulative) not populating correctly

---

## Section 17 — V2 React Integration Points

**Component → HTML function mapping:**
| React Component | HTML Function |
|----------------|---------------|
| `V15rHome.tsx` | `renderHome()` |
| `V15rProjectsPanel.tsx` | `renderProjects()` |
| `V15rProjectInner.tsx` | All 6 project inner tabs |
| `V15rEstimateTab.tsx` | `renderEstimate()` |
| `V15rMTOTab.tsx` | `renderMaterialTakeoff()` |
| `V15rProgressTab.tsx` | `renderProgress()` |
| `V15rFrameworkTab.tsx` | `renderProjectFramework()` |
| `V15rRFITab.tsx` | `renderRFITracker()` |
| `V15rCoordinationTab.tsx` | `renderCoordination()` |
| `V15rFieldLogPanel.tsx` | `renderFieldLog()` |
| `V15rMoneyPanel.tsx` | `renderMoney()` |
| `V15rIncomeCalc.tsx` | `renderIncomeCalc()` |
| `V15rPriceBookPanel.tsx` | `renderPriceBook()` |
| `V15rLeadsPanel.tsx` | `renderLeads()` |
| `V15rTemplatesPanel.tsx` | `renderTemplates()` |
| `V15rPricingIntelligence.tsx` | `renderPricingIntelligence()` |
| `V15rTeamPanel.tsx` | `renderTeam()` |
| `V15rSettingsPanel.tsx` | `renderSettings()` |

**backupDataService.ts key mappings:**
- `backup.projects` → ProjectsPanel, ProjectInner, Home, Money
- `backup.serviceLogs` → FieldLog Service tab, Home, Money
- `backup.logs` → FieldLog Project tab, Home
- `backup.gcContacts` → Leads GC/Relations tab
- `backup.serviceLeads` → Leads Service Pipeline tab
- `backup.weeklyReviews` → Leads Weekly Review tab
- `backup.priceBook` → PriceBook, MTO
- `backup.weeklyData` → Money 52-week table, Dashboard charts
- `backup.agendaSections` → Home Agenda section
- `backup.triggerRules` → FieldLog Triggers tab
- `backup.employees` → Team panel, FieldLog employee dropdown
- `backup.templates` → Templates panel
- `backup.completedArchive` → Pricing Intelligence
- `backup.calcRefs` → Income Calculator
- `backup.settings` → Settings panel, all calculations
- `backup.blueprintSummaries` → Project Framework tab

**Shared Supabase project:**
Both HTML app and V2 React app point to the same Supabase project (`edxxbtyugohtowvslbfo`). They share the same `app_state` table and `poweron_v2` key. An export from either app can be imported into the other — format is identical.

---

## Handoff Generation Prompt (For Other AI Models)

If you need to regenerate a comprehensive technical handoff from the HTML source code, give this prompt to the AI that built the HTML app:

> Create a complete technical handoff document called `poweron_v2_handoff_complete.md` with these 17 sections:
> Section 1: App Identity (what it is, devices, deployment)
> Section 2: Complete State Schema (every key in S with type, purpose, risk level)
> Section 3: Complete Function Index (every render/utility function with reads/writes/edge cases)
> Section 4: Supabase Sync Architecture (table, key, richness guard, failure modes, disconnect mode)
> Section 5: Undo/Redo System (exact Ctrl+Z/Y implementation)
> Section 6: Snapshot System (save/restore/edge cases)
> Section 7: Navigation Architecture (all tabs, sidebar, mobile, regression history)
> Section 8: Service Job Model — CRITICAL (data structure, ledger adjustments, roll-up formulas, collections queue rules)
> Section 9: Project Model (data structure, finance buckets, phases, health score, MTO, estimate, RFI, coordination)
> Section 10: Dashboard and Graph Panel (data sources, chart types, nav regression history)
> Section 11: Price Book Model (item structure, category grouping, product ID, MTO link)
> Section 12: Settings and Overhead Model (all keys, overhead calc, phase weights, financial targets)
> Section 13: Backup/Export Format (complete JSON structure, all keys, import/restore logic)
> Section 14: Known Regressions and Fixes (every bug from rebuild/refactor with cause and fix)
> Section 15: Non-Negotiable Rules (absolute rules that must never be violated)
> Section 16: Current Build Status (working/partial/missing/recently changed)
> Section 17: V2 React Integration Points (component mapping, backupDataService.ts key mappings, shared Supabase)
> Be exhaustive. This document is used by an AI that has never seen this codebase.

---

## Acceptance Test Checklist

Any finished change must pass ALL of these before considering it done:

### Service history
- [ ] Old service entries still show
- [ ] Edit still works
- [ ] Unpaid jobs show correctly
- [ ] Partial jobs show correctly
- [ ] Paid jobs do not appear in collections queue

### Collections queue
- [ ] collected=0 → "Full balance left"
- [ ] 0 < collected < total billable → "Partial balance left"
- [ ] collected >= total billable → removed from queue
- [ ] Queue totals match open balances

### Ledger adjustments
- [ ] Add Expense updates total cost
- [ ] Add Mileage updates total cost
- [ ] Add Income updates total billable
- [ ] Remaining balance recalculates correctly

### Project exposure
- [ ] Open Projects Exposure uses only Active projects
- [ ] Coming Up excluded
- [ ] Completed excluded

### Home page
- [ ] Job Health shows only Active projects, stays compact
- [ ] Service Jobs Requiring Attention visible
- [ ] Recent Activity below that section
- [ ] Recent Activity includes both project logs and service logs

### Navigation
- [ ] Graph Dashboard nav item visible and reachable
- [ ] All 6 Active Project tabs accessible when project selected
- [ ] Calendar defaults to week view
- [ ] No orphaned panels

### Sync / recovery
- [ ] App does not lose service logs on load
- [ ] Richer local state not overwritten by thinner newer remote
- [ ] App works locally if Supabase read fails
- [ ] Disconnect/test mode pauses writes correctly

### AI integration
- [ ] Every AI suggestion shows in reviewable modal before saving
- [ ] User can dismiss any AI suggestion without it applying
- [ ] No AI action auto-saves without explicit confirmation

---

## Implementation Philosophy

The correct approach is:
- extend carefully
- preserve working logic
- prefer additive changes
- use the app's existing visual language
- stabilize before inventing new architecture

Do not chase elegant rewrites if they risk data loss.
Do not overengineer.
Do not remove current workflows the user already likes.

If a tradeoff is necessary, choose:
**stable + slightly simpler** over **clever + fragile**

---

*Last updated: March 28, 2026*
*Power On Solutions LLC — C-10 #1151468 — Desert Hot Springs, CA*
