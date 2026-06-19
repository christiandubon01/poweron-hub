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
