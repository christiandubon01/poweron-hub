# B30 — Numbers Audit Report
**Session:** B30 | Numbers Audit Prep + Clean Test Data
**Date:** 2026-04-07
**Scope:** Read-only audit of all financial calculations in source code
**Protected files check:** ✅ Verified — no protected files were modified in this session

---

## ⚠️ PROTECTED FILE FLAG

`netlify.toml` appears in `git diff HEAD~1 --name-only`. This file is on the protected list per the handoff spec. **Christian must review whether this change was intentional.**

Other files in that diff (all appear in-scope):
- `src/components/ProactiveAlertCards.tsx`
- `src/components/nexus/NexusChatPanel.tsx`
- `src/services/feedbackLoopService.ts`
- `src/views/GuardianView.tsx`
- `.gitignore`
- `dist/index.html`

---

## STEP 1 — Complete Financial Calculation Audit

### 1.1 Pipeline Total

**Primary source:** `src/services/backupDataService.ts` → `getKPIs()` (used in header bar / KPI widgets)

```
pipeline = projectContract (active/coming only, excludes completed/deleted/lost/rejected) + svcQuoted (ALL service logs)
```

**BusinessHealthChart** in `V15rMoneyPanel.tsx` (line 56):
```
pipeline = ALL projects.reduce(contract)   // ← NO status filter
```

**V15rMoneyPanel header section** (line 319):
```
totalPipeline = projectContract (ALL projects via projectMoney) + max(0, svcQuoted - svcCollected)
```

**Summary:** Three different pipeline formulas exist across the codebase. The KPI bar is the most defensible (excludes completed/lost). The MoneyPanel uses unfiltered project contracts and subtracts collected service revenue from the svc portion (making it a "remaining revenue" number, not true pipeline). The BusinessHealthChart donut uses a raw sum with no filtering.

---

### 1.2 Paid Total

**Source:** `getKPIs()` in `backupDataService.ts` (line 753–755):
```
paid = projectPaid + svcCollected
projectPaid = projects.reduce(getProjectFinancials(p).paid)
svcCollected = serviceLogs.reduce(l.collected)
```

**How `getProjectFinancials().paid` works:**
```
loggedPaid = backup.logs.filter(l.projId === p.id).reduce(l.collected)
manualPaidAdjustment = p.finance.manualPaidAdjustment || 0
paid = max(0, loggedPaid + manualPaidAdjustment)
```

Paid reads from `backup.logs` (field logs with a `collected` field), not from `p.paid` directly. The `p.paid` field on the project object is treated as legacy/fallback. The definitive source is summed from individual field log entries.

**Consistent across MoneyPanel:** `cashReceived` and `totalCollected` both use `projectPaid + svcCollected`. ✅

---

### 1.3 Exposure Calculation

**KPI bar (`getKPIs()` line 758–761):**
```
exposure = ACTIVE bucket projects only → sum of max(0, contract - paid)
```

**MoneyPanel `totalExposure` (line 312):**
```
totalExposure = projectAR + projectUnbilled + max(0, svcOutstanding)
             = (billed - paid) + (contract - billed) + (svcQuoted - svcCollected)
             = (contract - paid) + (svcQuoted - svcCollected)
```
This applies to ALL projects (including completed), plus service outstanding.

**These two formulas produce different numbers.** The KPI bar shows active project risk only. The MoneyPanel shows a broader "everything owed" figure. Both are useful but are not the same metric, and they're both labeled "Exposure" in the UI.

---

### 1.4 Unbilled SVC Calculation

**KPI bar (`getKPIs()` line 764–772):**
```
svcUnbilled = serviceLogs.reduce(
  max(0, (quoted + addIncome) - collected)
)
// where addIncome = sum of adjustments[type==='income'].amount
```
✅ Includes income adjustment entries.

**MoneyPanel `svcOutstanding` (line 276):**
```
svcOutstanding = svcQuoted - svcCollected
```
❌ Does NOT include income adjustments. If a service call has `adjustments[type='income']`, those added amounts are counted in the KPI svcUnbilled but missed by `svcOutstanding` in MoneyPanel.

**Also:** The weekly data `pendingInv` (line 229–231) uses:
```
pendingInv = serviceLogs.filter(l.collected === 0 && l.quoted > 0).reduce(l.quoted)
```
This counts fully uncollected service calls only, missing any partially paid ones. It also ignores income adjustments.

---

### 1.5 Service Net Calculation

**Header bar (`V15rLayout.tsx` lines 599–609):**
```
serviceNet = totalQuoted - totalMaterial - totalMileage
totalMaterial = serviceLogs.reduce(l.materialCost || l.material || 0)
totalMileage  = serviceLogs.reduce(l.mileage || 0) * mileRate
```

**MoneyPanel `svcProfit` (line 275):**
```
svcProfit = serviceLogs.reduce(
  l.profit ?? (l.quoted - l.mat - l.miles * mileRate - l.hrs * opCostRate)
)
```

**Two bugs in the header bar formula:**
1. `BackupServiceLog` interface defines material cost as `l.mat` (not `l.materialCost` or `l.material`). The header bar reads `l.materialCost || l.material`, which will be `0` for all logs if data uses `l.mat`. Result: material cost is NOT subtracted in the header Service Net.
2. `BackupServiceLog` defines mileage as `l.miles` (not `l.mileage`). Header bar reads `l.mileage`, which will be `0`. Result: mileage cost is NOT subtracted in the header Service Net.
3. Header Service Net does not subtract labor cost (`l.hrs * opCostRate`). MoneyPanel does.

**Practical effect:** The header "Service Net" likely equals `svcQuoted` (gross, not net) because the field names don't match. The MoneyPanel's `svcProfit` is the correct net figure when `l.profit` is null.

---

### 1.6 AR Aging Thresholds

The app does not implement formal 30/60/90-day AR aging buckets. AR aging logic is limited to:

- **`generateMoneyInsights()` (line 347–350):** Flags projects where `unbilled / contract > 50%` — this is an exposure %, not a time-based aging bucket.
- **`overdue` sort (lines 362–368):** Sorts projects with `unbilled > 1000` by `lastCollectDate` (days since last collection). Note: the field used is `m.p.lastCollectDate` but `BackupProject` defines this as `lastCollectedAt` — **field name mismatch**, likely always returns `daysSince('1970-01-01')` = very large number for all projects.
- **`recalcWeeklyFromData()` weekly `pendingInv`:** Counts uncollected quotes but is not segmented by age.

There are no 30/60/90-day AR aging calculations in the codebase.

---

### 1.7 Health Score Formula

**Source:** `backupDataService.ts` → `health()` function (lines 578–617)

```
Base:        50
Completion:  + (overallCompletion * 0.28)    max +28 at 100% done
Recency:     + 15 if last move < 7 days ago
             +  5 if last move 7-13 days ago
             - 20 if last move >= 14 days ago
Open RFIs:   - (openRFIcount * 5)
Has logs:    + 10 if any logs exist
Payment:     + (paid / contract) * 8          max +8 when fully paid
Schedule:    - 5 if 1–7 days past plannedEnd
             - 10 if 8–14 days past plannedEnd
             - 20 if 15+ days past plannedEnd

Final:       clamp(0, 100)
```

**Phase weights used in `getOverallCompletion()`:**
```
Default: { Estimating: 5, Planning: 10, 'Site Prep': 15, 'Rough-in': 35, Finish: 25, Trim: 10 }
Total = 100%
Can be overridden per-user via settings.phaseWeights
```

**Score classification:**
- `sc >= 70`: Healthy (green `#10b981`)
- `50 <= sc < 70`: Watch (amber `#f59e0b`)
- `sc < 50`: At Risk (red `#ef4444`)

---

### 1.8 EVR Chart Data Points

**Source:** `src/components/v15r/charts/EVRChart.tsx`

The EVR chart accumulates across projects (not over time):
```
cumIncome   += dateFiltered ? logs.reduce(l.collected) : max(fin.paid, p.paid)
cumAR       += max(0, fin.billed - fin.paid)
cumPipeline += p.contract
```

Each x-axis point = one project (in array order, not sorted by date). Three lines:
- **Accumulated Income** (green) — running total of received cash
- **Outstanding AR** (red) — running total of billed-not-paid
- **Total Pipeline** (blue dashed) — running total of contract values

No issue with the math — it's a cumulative waterfall by project. The x-axis ordering (array order vs. date order) may affect visual interpretation.

---

### 1.9 CFOT Chart Data Points

**Source:** `src/components/v15r/charts/CFOTChart.tsx`

Reads from `backup.weeklyData[]`. Each point:
```
exposure = d.totalExposure || (d.unbilled + d.pendingInv + max(0, d.svc - d.svcCollected))
unbilled = d.unbilled
pending  = d.pendingInv
svcPay   = d.svc
projPay  = d.proj
accum    = d.accum
```

The `weeklyData` records are populated by `recalcWeeklyFromData()` in MoneyPanel. The `accum` field is a running sum of `projCollected + svcCollected` per week. The CFOT chart is a passive renderer — it only reads what's in `weeklyData`. Any errors originate upstream in the recalc function.

---

### 1.10 Revenue Timeline Accumulation (weeklyData recalc)

**Source:** `V15rMoneyPanel.tsx` → `recalcWeeklyFromData()` (lines 153–238)

```
For each week (non-overridden):
  projCollected = backup.logs.filter(date in week).reduce(l.paymentsCollected || l.collected)
  svcCollected  = backup.serviceLogs.filter(date in week).reduce(l.collected)
  (with 3 validations: no future dates, cap vs total, require at least 1 log in week)
  w.proj  = projCollected
  w.svc   = svcCollected
  accum  += projCollected + svcCollected   // running total, resets each recalc
  w.accum = accum
  w.unbilled  = activeProjects.reduce(max(0, contract - billed))
  w.pendingInv = serviceLogs.filter(collected===0 && quoted>0).reduce(quoted)
```

Note: `unbilled` and `pendingInv` are set to the **same value for every week** in the loop (not per-week historical snapshots) — they reflect the current state as of the recalc run, not the historical state at that week.

---

## STEP 2 — Math Issues Found

### 🔴 BUG 1 (HIGH): `l.projectId` vs `l.projId` — Direct cost totals always zero

**File:** `V15rMoneyPanel.tsx` lines 325, 329, 332

```typescript
// BUG: BackupLog schema uses l.projId, NOT l.projectId
const projectMatCost = projectMoney.reduce((s, m) =>
  s + logs.filter(l => l.projectId === m.p.id)  // ← l.projectId never matches!
  ...

const totalLaborCost = ...logs.filter(l => l.projectId === m.p.id)...
const totalMileageCost = ...logs.filter(l => l.projectId === m.p.id)...
```

`BackupLog` is defined with `projId: string` (not `projectId`). Every filter returns empty, making `projectMatCost`, the project portion of `totalLaborCost`, and the project portion of `totalMileageCost` always **$0**.

This causes:
- **Gross Margin %** to be inflated (costs understated)
- **Net Revenue** to be inflated (project costs not subtracted)
- **Combined Total Cost** understated (no project-side costs)

The `getProjectFinancials()` function correctly uses `projectLogsFor()` which filters by `l.projId === projId`, so `paid` calculations are fine. Only the direct cost rollups in MoneyPanel are broken.

---

### 🔴 BUG 2 (HIGH): Service Net field name mismatch — header always shows gross

**File:** `V15rLayout.tsx` lines 605–606

```typescript
totalMaterial += Number(l.materialCost || l.material || 0)  // ← BackupServiceLog uses l.mat
totalMileage  += Number(l.mileage || 0) * mileRate          // ← BackupServiceLog uses l.miles
```

`BackupServiceLog` defines `mat: number` and `miles: number`. Neither `l.materialCost`, `l.material`, nor `l.mileage` exist in the interface. Both always evaluate to 0.

Result: `serviceNet = svcQuoted - 0 - 0 = svcQuoted`. The header "Service Net" is showing **gross quoted revenue**, not net profit. This inflates the header KPI.

---

### 🟡 BUG 3 (MEDIUM): `svcOutstanding` misses income adjustments

**File:** `V15rMoneyPanel.tsx` line 276

```typescript
const svcOutstanding = svcQuoted - svcCollected  // ← missing addIncome adjustments
```

`getKPIs()` correctly adds `adjustments[type='income'].amount` to `totalBillable` before computing unbilled. `svcOutstanding` in MoneyPanel does not, so if any service log has income adjustments, `svcOutstanding < svcUnbilled` from the KPI bar.

---

### 🟡 BUG 4 (MEDIUM): `lastCollectDate` field does not exist on `BackupProject`

**File:** `V15rMoneyPanel.tsx` lines 364–375

```typescript
const aDays = daysSince(a.p.lastCollectDate || '1970-01-01')
```

`BackupProject` has `lastCollectedAt` (not `lastCollectDate`). This field is always undefined, so `daysSince('1970-01-01')` (~20,000+ days) is used for every project. The "Top follow-up" insight sorts by days since collection, but since all projects get the same fallback date, the sort order is undefined.

---

### 🟡 BUG 5 (MEDIUM): `totalExposure` redeclared in `generateMoneyInsights()`

**File:** `V15rMoneyPanel.tsx` line 396

```typescript
// Outer scope (line 312):
const totalExposure = projectAR + projectUnbilled + max(0, svcOutstanding)

// Inside generateMoneyInsights() (line 396):
const totalExposure = projectMoney.reduce((s, m) => s + m.unbilled, 0)
```

The inner `totalExposure` shadows the outer. The insight check (`if totalExposure > totalCollected`) uses only project unbilled — no AR, no service outstanding. The alert text says "Total exposure" but uses an incomplete number. This means the alert may fire/not fire at a different threshold than expected.

---

### 🟡 BUG 6 (MEDIUM): Pipeline definition inconsistency across the app

Three different "pipeline" formulas coexist:

| Location | Formula | Status filter |
|---|---|---|
| `getKPIs()` | `activeProjects.contract + svcQuoted` | Excludes completed/deleted/lost |
| `BusinessHealthChart` | `allProjects.reduce(contract)` | None — includes completed |
| `MoneyPanel totalPipeline` | `allProjects.contract + max(0, svcQuoted - svcCollected)` | None — includes completed |

The KPI bar (header) will show a lower pipeline than the MoneyPanel donut chart. This will confuse number verification.

---

### 🟢 NOTE: Weekly unbilled/pendingInv are not historical snapshots

**File:** `V15rMoneyPanel.tsx` lines 219–232

`w.unbilled` and `w.pendingInv` are set during recalc to current values, not the values as-of that week. Every week row in the CFOT chart will show the same current unbilled/pending amounts. This is a design limitation, not a calculation bug, but it means the CFOT exposure lines are flat and don't reflect historical trends.

---

## STEP 3 — Test Data Setup Instructions

### Scenario A: One Regular Project

Create one project with these exact values:

| Field | Value |
|---|---|
| Name | `TEST PROJECT ALPHA` |
| Status | `active` |
| Contract | `$10,000` |
| Billed | `$6,000` |

Then add exactly two field logs tied to this project (`projId` = project's id):

**Log 1:**
- `collected`: `$4,000`
- `hrs`: `8`
- `mat`: `500`
- `miles`: `40`
- `date`: any past date

**Log 2:**
- `collected`: `$1,000`
- `hrs`: `4`
- `mat`: `200`
- `miles`: `20`
- `date`: any past date

#### Expected numbers (if math is correct):

| Metric | Formula | Expected Value |
|---|---|---|
| `paid` (project) | loggedPaid = 4000 + 1000 | **$5,000** |
| `ar` | billed - paid = 6000 - 5000 | **$1,000** |
| `unbilled` | contract - billed = 10000 - 6000 | **$4,000** |
| `risk` | contract - paid = 10000 - 5000 | **$5,000** |
| **Pipeline (KPI bar)** | includes this project: +$10,000 | +$10,000 |
| **Exposure (KPI bar)** | risk for active = 5000 | **$5,000** |
| Project `mat` cost (if BUG 1 fixed) | 500 + 200 = | **$700** |
| Project labor cost (if BUG 1 fixed) | (8+4) hrs × opCostRate ($42.45) | **$509.40** |
| Project mileage cost (if BUG 1 fixed) | (40+20) miles × mileRate ($0.66) | **$39.60** |
| Health score (baseline, no RFIs, no planned end) | 50 + 0*0.28 + (-20 if >14d stale) + 10 (has logs) + (5000/10000)*8 = 50 + 0 - 20 + 10 + 4 | **~44** (At Risk color) |

> ⚠️ If BUG 1 is NOT fixed: `projectMatCost`, `totalLaborCost` (project portion), and `totalMileageCost` (project portion) will all read **$0** in the MoneyPanel — you will see inflated Net Revenue and Gross Margin %.

---

### Scenario B: One Service Call

Create one service log entry with these exact values:

| Field | Value |
|---|---|
| `customer` | `TEST SVC CUSTOMER` |
| `quoted` | `$800` |
| `collected` | `$0` (unpaid) |
| `mat` | `$150` |
| `miles` | `20` |
| `hrs` | `2` |
| `date` | any past date |

#### Expected numbers (if math is correct):

| Metric | Formula | Expected Value |
|---|---|---|
| `svcQuoted` | sum of all quoted | **$800** |
| `svcCollected` | sum of all collected | **$0** |
| `svcUnbilled` (KPI bar) | max(0, 800 - 0) | **$800** |
| `svcOutstanding` (MoneyPanel) | 800 - 0 | **$800** (matches if no adjustments) |
| `pendingInv` (weekly) | collected=0 && quoted>0 → 800 | **$800** |
| `svcProfit` (MoneyPanel, if l.profit is null) | 800 - 150 - (20 × 0.66) - (2 × 42.45) | **$800 - 150 - 13.20 - 84.90 = $551.90** |
| **Service Net (header bar)** | Should be ~$551.90 but due to BUG 2 field mismatch | **$800** (gross, not net) |

> ⚠️ To confirm BUG 2: The header "Service Net" will show **$800** not ~$552. If you fix the field names to `l.mat` and `l.miles`, it should drop to ~$552.

---

### Combined Scenario: Both running at once

With just TEST PROJECT ALPHA + TEST SVC CUSTOMER active and all other data at zero:

| Display Location | Metric | Expected |
|---|---|---|
| KPI bar | Pipeline | $10,800 ($10k project + $800 svc) |
| KPI bar | Paid | $5,000 |
| KPI bar | Exposure | $5,000 (active project risk only) |
| KPI bar | SVC Unbilled | $800 |
| MoneyPanel | Gross Revenue | $10,800 |
| MoneyPanel | Cash Received | $5,000 |
| MoneyPanel | Total Exposure | $6,800 ($1k AR + $4k unbilled + $800 svc) |
| MoneyPanel header | Service Net | $800 ← **BUG 2**: should be ~$552 |
| MoneyPanel | Gross Margin % | Inflated ← **BUG 1**: project costs read as $0 |
| Project health score | (if no RFIs, no planned end, logs exist) | ~44 (At Risk) |

---

## Summary of Issues

| # | Severity | File | Issue |
|---|---|---|---|
| 1 | 🔴 HIGH | `V15rMoneyPanel.tsx` L325/329/332 | `l.projectId` used instead of `l.projId` — project direct costs always $0 |
| 2 | 🔴 HIGH | `V15rLayout.tsx` L605–606 | `l.materialCost`, `l.material`, `l.mileage` don't exist — Service Net = gross revenue |
| 3 | 🟡 MED | `V15rMoneyPanel.tsx` L276 | `svcOutstanding` misses income adjustments vs `getKPIs().svcUnbilled` |
| 4 | 🟡 MED | `V15rMoneyPanel.tsx` L364–375 | `lastCollectDate` doesn't exist on project — AR aging sort always wrong |
| 5 | 🟡 MED | `V15rMoneyPanel.tsx` L396 | `totalExposure` shadowed inside insights fn — alert uses incomplete number |
| 6 | 🟡 MED | Multiple files | Three different pipeline formulas — KPI bar, donut chart, header section disagree |

---

*Audit session complete. No code was modified. No commits were made.*
