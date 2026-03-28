# Power On Hub — Data Integrity Audit

**Date:** March 28, 2026
**Mode:** Read-only — no code changes made
**Scope:** Full lifecycle trace of 5 core data entities

---

## 1. PROJECTS

### Identity

| Field | Value |
|-------|-------|
| **Storage key** | `backup.projects` (array) |
| **ID format** | `'proj' + Date.now() + Math.random().toString(36).slice(2, 6)` |
| **Example ID** | `proj1711234567890a1b2` |
| **Type definition** | `BackupProject` in backupDataService.ts |

### Creation Points (2)

| Location | File | Trigger |
|----------|------|---------|
| QuickBooks PDF import | `QuickBooksImportModal.tsx` | User imports QB estimate PDF, reviews form, clicks "Save to App" |
| QuickBooks CSV import | `QuickBooksImportModal.tsx` | User imports QBO CSV in project mode |

**Notable gap:** There is no standalone "New Project" button in V15rProjectsPanel. Projects are only created through QuickBooks import. The HTML app had a direct create flow — the React app relies on import only.

### Edit Points (6)

| Component | File | What it edits |
|-----------|------|---------------|
| V15rProjectsPanel | `V15rProjectsPanel.tsx` | Status changes, project deletion (cascades log cleanup) |
| V15rEstimateTab | `V15rEstimateTab.tsx` | `laborRows`, `ohRows`, `mileRT`, `miDays` |
| V15rProgressTab | `V15rProgressTab.tsx` | `phases`, `tasks`, `lastMove` |
| V15rRFITab | `V15rRFITab.tsx` | `rfis` array (CRUD) |
| V15rCoordinationTab | `V15rCoordinationTab.tsx` | `coord` object |
| V15rMTOTab | `V15rMTOTab.tsx` | `mtoRows`, `matRows` |

### Read Points (15+)

| Component | What it reads | Purpose |
|-----------|---------------|---------|
| **V15rHome** | `backup.projects` | KPIs, health scores, stagnancy alerts, recent activity |
| **V15rProjectsPanel** | `backup.projects` | Project cards, status filters, health scores |
| **V15rDashboard** | `backup.projects` | CFOT milestone overlay, OPP pipeline bars, EVR exposure chart, PCD completion distribution |
| **V15rMoneyPanel** | `backup.projects` | Pipeline total, paid total, exposure, AR, per-project financial table |
| **V15rFieldLogPanel** | `backup.projects` | Project dropdown for field log entry, filters logs by projId |
| **V15rEstimateTab** | `projects.find(id)` | Active project estimate detail |
| **V15rProgressTab** | `projects.find(id)` | Phase completion, tasks |
| **V15rRFITab** | `projects.find(id)` | RFI list for active project |
| **V15rMTOTab** | `projects.find(id)` | Material takeoff rows |
| **V15rTeamPanel** | `backup.projects` | Employee allocation across projects |
| **V15rLayout** | `backup.projects` | Topbar KPI pills (Pipeline, Open RFIs) |
| **V15rIncomeCalc** | `backup.projects` | Financial modeling inputs |
| **V15rPricingIntelligencePanel** | `backup.projects` | Cross-project margin benchmarks |
| **V15rTemplatesPanel** | `backup.projects` | Template application context |
| **V15rSettingsPanel** | `backup.projects` | Project count in status display |

### 52-Week Tracker

`weeklyData` is a **separate, manually-tracked** array — NOT auto-derived from projects. Each row has `{ wk, start, proj, svc, accum, unbilled, pendingInv }`. The `proj` field stores a weekly project revenue number, but it is **not** computed from `backup.projects` at write time. This creates a **potential drift risk**: if project financials change retroactively, weeklyData is not recalculated.

### Graph Dashboard

V15rDashboard reads `backup.projects` for 4 of 5 charts: CFOT (milestone overlay), OPP (pipeline bars), EVR (exposure vs revenue), PCD (completion distribution). All read directly from projects array — no stale intermediary.

### Money Panel

Reads `backup.projects` directly. Computes: pipeline (`SUM(p.contract)`), paid (`SUM(getProjectFinancials(p).paid)`), AR, unbilled, exposure per project. Also reads `backup.logs` filtered by `projId` for cost rollup.

### Cross-Reference Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Orphaned logs on delete | **OK** | V15rProjectsPanel cleans up `backup.logs` when project deleted |
| No "New Project" in React app | **MEDIUM** | Only creation path is QuickBooks import — no direct create UI |
| weeklyData drift | **LOW** | weeklyData.proj is manually entered, not synced from project financials |
| No project-to-lead link | **MEDIUM** | Projects don't reference the lead/GC contact that originated them |

---

## 2. SERVICE CALLS

### Identity

| Field | Value |
|-------|-------|
| **Storage key** | `backup.serviceLogs` (array) |
| **ID format** | `'svc' + Date.now()` (field log) or `'svc' + Date.now() + random` (QB import) |
| **Example ID** | `svc1711296000000` or `svc1711296000000a7f2` |
| **Type definition** | `BackupServiceLog` in backupDataService.ts |

### Creation Points (5)

| Location | File | Trigger |
|----------|------|---------|
| Field Log service tab | `V15rFieldLogPanel.tsx` `saveSvcEntry()` | Manual entry form |
| Service estimate completion | `V15rFieldLogPanel.tsx` `completeAndLogService()` | 3-step estimate workflow |
| Estimate tab conversion | `V15rEstimateTab.tsx` `convertToServiceLog()` | Convert project estimate to service log |
| QuickBooks PDF import | `QuickBooksImportModal.tsx` | Single PDF extraction |
| QuickBooks CSV import | `QuickBooksImportModal.tsx` `handleSaveCSVToApp()` | Batch QBO CSV import |

### Edit Points (1)

| Component | File | What it edits |
|-----------|------|---------------|
| V15rFieldLogPanel | `V15rFieldLogPanel.tsx` | All fields via `saveSvcEntry()` with `editSvcId` |

### Delete Points (1)

| Component | File | Method |
|-----------|------|--------|
| V15rFieldLogPanel | `V15rFieldLogPanel.tsx` | `deleteLogEntry()` — filters by ID with confirm prompt |

### Read Points (6)

| Component | What it reads | Purpose |
|-----------|---------------|---------|
| **V15rFieldLogPanel** | `backup.serviceLogs` | Service log tab — full CRUD, trigger analysis |
| **V15rHome** | `backup.serviceLogs` | "Service Jobs Requiring Attention" alerts (unpaid balance > 0) |
| **V15rDashboard** | `serviceLogs.slice(-8)` | SCP chart — last 8 service calls performance |
| **V15rMoneyPanel** | `backup.serviceLogs` | 12 service KPIs: svcQuoted, svcCollected, svcProfit, svcMatTotal, svcOutstanding, etc. |
| **V15rLayout** | `backup.serviceLogs` | SERVICE NET topbar pill (total unbilled from service calls) |
| **V15rServiceCalls** | `backup.serviceLogs` | Dedicated service calls view with filters |

### 52-Week Tracker

weeklyData has a `svc` field per week. Like `proj`, this is **manually entered, not auto-derived** from `backup.serviceLogs`. Same drift risk as projects.

### Graph Dashboard SCP Chart

V15rDashboard reads `serviceLogs.slice(-8)` and passes to `<SCPChart>`. Displays Quoted vs Material vs Net Profit for last 8 service calls. Reads directly from serviceLogs — no intermediary.

### Money Panel

Computes 12 aggregated KPIs directly from `backup.serviceLogs`: svcQuoted, svcCollected, svcMatTotal, svcMilesTotal, svcOpTotal, svcDirectCosts, svcProfit, svcOutstanding, svcAvgTicket, svcMargin. Split material cost into separate "Projects" vs "Service Calls" sub-lines.

### Cross-Reference Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| No service-to-project FK | **LOW** | Service calls and projects are separate domains by design |
| Estimate-to-service log: no FK | **LOW** | When estimate completes, a new svc ID is created. No back-reference to estimate ID. |
| weeklyData.svc drift | **LOW** | Manually entered, not derived from serviceLogs |
| Service leads not linked to svc logs | **MEDIUM** | A service lead that converts to a booked job has no FK to the resulting service log |

---

## 3. FIELD LOGS

### Identity

| Field | Value |
|-------|-------|
| **Storage key** | `backup.logs` (array) |
| **ID format** | `'log' + Date.now()` |
| **Example ID** | `log1710123456789` |
| **Type definition** | `BackupLog` in backupDataService.ts |

### Creation Points (1)

| Location | File | Trigger |
|----------|------|---------|
| Field Log project tab | `V15rFieldLogPanel.tsx` `saveProjEntry()` | Manual log entry linked to project |

### Linkage

| Field | Target | Description |
|-------|--------|-------------|
| `projId` | `BackupProject.id` | **YES** — every field log is linked to a project by ID |
| `projName` | Denormalized | Stored alongside projId for display convenience |
| `empId` | `BackupEmployee.id` | Links to employee for labor tracking |

**Cascade delete:** YES — `V15rProjectsPanel.tsx` filters `backup.logs` when a project is deleted.

### Read Points (8)

| Component | Purpose |
|-----------|---------|
| **V15rFieldLogPanel** | Primary CRUD — displays, creates, edits, deletes project logs |
| **V15rHome** | Recent activity feed |
| **V15rDashboard** | Financial data for charts |
| **V15rMoneyPanel** | Per-project cost rollup (mat, hrs, miles from logs) |
| **V15rProjects** | Log count and recent activity per project |
| **V15rTeamPanel** | Hours by employee (groups logs by empId) |
| **V15rEstimateTab** | Actual vs estimated comparison |
| **V15rSettingsPanel** | Log count in status display |

### 52-Week Tracker

weeklyData is **not auto-derived** from `backup.logs`. The `proj` field in weeklyData is separately entered. This means retroactive log edits (adding a forgotten field log from 3 weeks ago) will **not** update the 52-week tracker.

### Cross-Reference Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| No log-to-service-call link | **OK** | By design — separate entity (service logs handle their own) |
| weeklyData not synced from logs | **MEDIUM** | Retroactive log changes don't flow to 52-week tracker |
| projName denormalization | **LOW** | If project renamed, old logs still show old name |

---

## 4. PRICE BOOK

### Identity

| Field | Value |
|-------|-------|
| **Storage key** | `backup.priceBook` (array or Record) |
| **Dual storage** | `poweron_v2` localStorage key (HTML app) AND `poweron_backup_data` (React app) |
| **Read priority** | `getPriceBookSource()` reads `poweron_v2` first, falls back to `poweron_backup_data` |
| **ID format** | Custom string (no standard prefix, varies by source) |
| **Type definition** | `BackupPriceBookItem` in backupDataService.ts |

### Fields

```
id, cat, name, cost, src, unit, pack, waste, link, pidBand, pidBlock, legacyId, notes
```

### Write Points (4)

| Component | File | Operation |
|-----------|------|-----------|
| V15rPriceBookPanel | `V15rPriceBookPanel.tsx` | Import PDF — adds parsed items |
| V15rPriceBookPanel | `V15rPriceBookPanel.tsx` | Import CSV/Excel — adds parsed items |
| V15rPriceBookPanel | `V15rPriceBookPanel.tsx` | Edit notes, delete items |
| ImportBackupButton | `ImportBackupButton.tsx` | Merge during backup import |

### Read Points (3)

| Component | Purpose |
|-----------|---------|
| **V15rPriceBookPanel** | Primary display — grouped by category, search, filter |
| **V15rMTOTab** | Lookups via `getPBItem(matId)` — resolves MTO row materials to price book costs |
| **V15rEstimateTab** | Indirectly via MTO cost rollup |

### MTO Linking

**YES** — MTO rows (`p.mtoRows[]`) reference price book items via `matId` field. The `getPBItem(matId)` function in V15rMTOTab looks up the price book item by ID to get current cost, unit, and waste factor.

### Service Call Linking

**NO** — `BackupServiceLog.mat` is a raw dollar amount. Service calls do **not** reference individual price book items. There is no `matId` or `priceBookId` on service logs.

### Cross-Reference Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Dual storage keys | **HIGH** | Price book exists in both `poweron_v2` and `poweron_backup_data`. `getPriceBookSource()` reads v2 first. Writes go to correct key via `persistPriceBook()`. Risk of divergence if one key updated without the other. |
| Service logs no PB link | **MEDIUM** | Service call materials are raw $ — no traceability to specific price book items |
| MTO orphaned refs | **LOW** | If a price book item is deleted, MTO rows referencing its ID will fail `getPBItem()` lookup (returns null) — no cascade cleanup |
| No cost history | **LOW** | Price book stores current cost only — no historical pricing for retroactive estimate comparison |

---

## 5. LEADS

### Identity

| Entity | Storage Key | ID Format | Example |
|--------|-------------|-----------|---------|
| GC Contacts | `backup.gcContacts` | `'gc' + Date.now()` | `gc1710123456789` |
| Service Leads | `backup.serviceLeads` | `'slead' + Date.now()` | `slead1710123456789` |
| Weekly Reviews | `backup.weeklyReviews` | varies | — |

### GC Contact Creation (1)

| Location | File | Trigger |
|----------|------|---------|
| Leads panel | `V15rLeadsPanel.tsx` `addGC()` | Manual form entry |

**Fields:** `id, company, contact, role, phone, email, intro, sent, awarded, avg, pay, phase, fit, action, due, notes, created, contactLog[]`

### Service Lead Creation (2)

| Location | File | Trigger |
|----------|------|---------|
| Leads panel | `V15rLeadsPanel.tsx` `addSvcLead()` | Manual form entry |
| Estimate tab | `V15rEstimateTab.tsx` `saveAsServiceLead()` | Convert estimate to service lead |

**Fields:** `id, customer, address, jtype, estHours, billRate, estMaterials, milesRT, notes, totalQuote, status, created`

### Read Points (2)

| Component | Purpose |
|-----------|---------|
| **V15rLeadsPanel** | Primary display — 3 tabs: GC contacts, service leads, weekly reviews |
| **LeadPipeline** (Spark) | Visualization of lead pipeline |

### Write Points (2)

| Component | Operations |
|-----------|-----------|
| **V15rLeadsPanel** | Full CRUD for GC contacts and service leads. Contact log entries for GC contacts. |
| **V15rEstimateTab** | Creates service leads from estimates |

### Lead-to-Project Conversion

**NOT IMPLEMENTED.** Neither `gcContacts` nor `serviceLeads` have a `projectId` or `convertedProjectId` field. There is:

- GC Contact `phase` field (First Contact, Prospecting, Qualified, Active Bidding, Awarded, Dormant) — tracks progression but no project FK
- Service Lead `status` field (Advance, Quoted, Booked, Park, Kill) — tracks pipeline stage but no project FK
- **No "Convert to Project" button** in any panel
- **No reverse lookup** — given a project, you cannot find which lead originated it

### Cross-Reference Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| No lead-to-project FK | **HIGH** | Leads that convert to projects lose their provenance. Cannot trace which GC contact or service lead led to a project. |
| No "Convert to Project" UI | **HIGH** | Service leads in "Booked" status have no one-click conversion to create a project. |
| No lead-to-service-log FK | **MEDIUM** | Service leads don't link to resulting service logs either. |
| Contact log not shared | **LOW** | GC contact activity (contactLog) is per-contact, not visible from project context. |

---

## Cross-Entity Summary

### Data Flow Diagram

```
GC Contacts ──(no FK)──> Projects ──(projId)──> Field Logs
                              │                      │
Service Leads ─(no FK)──>    │                      └──> V15rMoneyPanel (cost rollup)
                              │
                              ├──> V15rDashboard (4 charts)
                              ├──> V15rHome (KPIs, alerts)
                              └──> V15rLayout (topbar pills)

Service Logs ──────────────> V15rMoneyPanel (12 KPIs)
     │                       V15rDashboard (SCP chart)
     │                       V15rHome (attention alerts)
     │                       V15rLayout (SERVICE NET pill)
     └──(no FK)──> Service Leads (no back-reference)

Price Book ──(matId)──> MTO Rows (inside projects)
     └──(no link)──> Service Logs (raw $ only)

weeklyData ──(no auto-sync)──> Separate manual tracking
```

### Top Priority Gaps

| # | Gap | Severity | Impact |
|---|-----|----------|--------|
| 1 | **No lead-to-project conversion** | HIGH | Cannot track which leads became projects. No conversion UI. |
| 2 | **No "New Project" UI in React app** | MEDIUM | Projects can only be created through QuickBooks import. |
| 3 | **weeklyData not auto-derived** | MEDIUM | 52-week tracker is manually maintained, drifts from actual project/service data. |
| 4 | **Dual price book storage** | HIGH | Two localStorage keys can diverge; `getPriceBookSource()` mitigates but doesn't eliminate risk. |
| 5 | **Service log materials not linked to price book** | MEDIUM | No traceability from service call material costs to specific items. |
| 6 | **No estimate-to-service-log back-reference** | LOW | When an estimate completes to a service log, no FK preserved. |
| 7 | **projName denormalized in logs** | LOW | Renaming a project doesn't update historical log entries. |
