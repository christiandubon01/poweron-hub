# Power On Hub V2 — Complete Technical Handoff

Version target: **V2 React app** (React 18 + TypeScript + Vite 5 + Tailwind CSS)
HTML reference baseline: **`poweron_v16j_cashflow_1_5x_taller.html`**
Created for: **Claude via Cowork** or any successor coding model
Architecture baseline: **React V2 app auto-deployed on Netlify from `github.com/christiandubon01/poweron-hub`, syncing to Supabase**
Current phase: **Phase E (SPARK Full Automation) — NOT YET STARTED**
Last updated: **March 28, 2026**

This document is intentionally exhaustive. It captures both code-inspected facts from the current React V2 build, the HTML reference baseline, and institutional knowledge learned through many regressions and fixes during iterative development.

---

## Section 1 — App Identity

### What this app is
Power On Hub is an internal operations system for **Power On Solutions, LLC**, a California electrical contractor. It is used by the owner/operator to run the day-to-day business across estimating, project tracking, service call logging, collections, price book management, material takeoff, project health, graphing, overhead settings, and mobile field usage.

### Who uses it
Primary user is the business owner. The app is effectively a custom contractor ERP / command center optimized for a single owner-operator with room to expand to crew/team support later.

### Primary devices
- **Windows desktop/laptop** for planning, estimating, review, graphing, and admin
- **iPad** for mid-field and mobile office use
- **iPhone** for quick service entries, collection follow-up, and reviewing dashboards

### Deployment model
- **Frontend:** React V2 app (React 18 + TypeScript + Vite 5 + Tailwind CSS) auto-deployed via **Netlify** from `github.com/christiandubon01/poweron-hub`
- **Legacy HTML reference:** `poweron_v16j_cashflow_1_5x_taller.html` (preserved as stable reference, not actively deployed)
- **Persistence:** browser local storage + mirror backup + snapshots + undo/redo history
- **Cloud sync:** **Supabase REST** table-based snapshot sync using table **`app_state`** and state key **`poweron_v2`**
- **AI proxy:** Claude API via `netlify/functions/claude.ts`
- **Multi-device sync:** Windows + iPhone syncing correctly via Supabase with device ID system and force sync button
- **All 27 Supabase migrations applied** to project `edxxbtyugohtowvslbfo`
- **API keys in Netlify:** `ANTHROPIC_API_KEY`, `VITE_ANTHROPIC_API_KEY`, `VITE_ELEVENLABS_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`

### Architecture evolution
The original single-file HTML architecture provided trivial deployment, no build tooling, easy backup, and direct AI editability. The V2 React app preserves these principles (single deploy target, same JSON state format, same Supabase sync) while adding component-per-panel structure, TypeScript safety, and a proper build pipeline. The HTML app is preserved as a stable reference and the export format is identical between both apps.

---

## Section 2 — Complete State Schema

The main runtime state is global object **`S`**, initialized by `loadState()` and normalized by `normalizeStateShape()`.

### Top-level state keys

| Key | Type | Purpose | Main consumers | Safe to modify? |
|---|---|---|---|---|
| `theme` | string | `'dark'` / `'light'` UI theme | topbar/theme/app shell | safe |
| `settings` | object | company settings, overhead, calendar URL, phase weights, financial targets | settings, estimates, money, graphs, field/service costing | **critical** |
| `calcRefs` | object | income calculator / RMO installer calculator reference values | income calc tab (`incalc`) and graphing | moderate |
| `activeId` | string | currently selected project id | projects / estimate / progress / MTO / RFI / coordination | moderate |
| `projects` | array<object> | all project records | almost every project panel | **critical** |
| `employees` | array<object> | employee/cost-rate list | estimate labor rows, service costing | moderate |
| `weeklyData` | array<object> | 52-week cashflow / tracker rows | graphs, money, weekly table | **critical for graph dashboard** |
| `priceBook` | array<object> | material master list with product IDs and links | price book, MTO, estimate, PDF import | **critical** |
| `logs` | array<object> | project field logs (project-side, not service-side) | field logs, recent activity, graphs, financial rollups | **critical** |
| `gcContacts` | array<object> | GC / relationship lead pipeline | leads tab | safe/moderate |
| `serviceLeads` | array<object> | service-lead list | leads tab service view | safe/moderate |
| `serviceLogs` | array<object> | service history records, collections source of truth, service trigger analysis | field → service, collections queue, home attention, recent activity | **critical** |
| `taskSchedule` | array<object> | cross-project scheduled tasks | field/task schedule and home/task-linked views | moderate |
| `agendaSections` | array<object> | home agenda categories and tasks | home agenda panel | moderate |
| `calOffset` | number | calendar week offset for embedded calendar navigation | home calendar | safe |
| `gcalCache` | array | Google calendar event cache | home calendar | safe |
| `gcalLastFetch` | number | last calendar refresh timestamp | home calendar | safe |
| `triggerRules` | array<object> | trigger matrix rules for service/job warnings | field → triggers analyzer | **critical** |
| `_schemaVersion` | number/string | internal shape version | normalization, import/export | **critical** |
| `_lastSavedAt` | number | local state freshness marker | sync, recovery, export/import | **critical** |
| `view` | string | currently active panel id | navigation / render | moderate |
| `customers` | array | reserved customer list | normalized for compatibility, lightly used | safe |
| `vendors` | array | reserved vendor list | compatibility placeholder | safe |
| `quotes` | array | reserved quote list | compatibility placeholder | safe |
| `catalog` | array | reserved catalog list | compatibility placeholder | safe |
| `history` | array | reserved generic history | compatibility placeholder | safe |
| `fieldLogs` | array | reserved older field log schema | compatibility / migration | fragile legacy |
| `dailyJobs` | array | reserved older schema | compatibility | fragile legacy |
| `weeklyReviews` | array | reserved review schema | compatibility | fragile legacy |
| `serviceEstimates` | array<object> | open service estimates before activation | estimate → service call tracker | important |
| `activeServiceCalls` | array<object> | active service-call tracker records | estimate/service-call tracker | important |
| `projectDashboard` | object | framework / dashboard bucket for project dashboard tab | dashboard/framework | important |
| `templates` / `projectTemplates` | array/object | job templates if present in migrated builds | templates tab | moderate |

### `settings` schema

| Key | Type | Purpose | Used by | Criticality |
|---|---|---|---|---|
| `company` | string | company name | settings/export/UI | safe |
| `license` | string | contractor license text | settings/docs | safe |
| `billRate` | number | default labor billing rate | estimates / service entry | important |
| `defaultOHRate` | number | default overhead rate | estimate overhead rows | important |
| `markup` | number | percent markup | estimate/pricing displays | important |
| `tax` | number | tax percent | estimate/pricing displays | important |
| `wasteDefault` | number | default waste factor | material calculations | important |
| `mileRate` | number | mileage cost rate | service costing / field costing / queue | **critical** |
| `dayTarget` | number | daily target | triggers / dashboard | **critical** |
| `amBlock` | number | AM revenue target | settings / goals | important |
| `pmBlock` | number | PM revenue target | settings / goals | important |
| `gcalUrl` | string | embedded Google calendar URL | home calendar | **critical to calendar** |
| `salaryTarget` | number | annual/target comp input | overhead model | **critical** |
| `billableHrsYear` | number | denominator for real cost/hour | overhead model | **critical** |
| `phaseWeights` | object | phase weight percentages used in project completion / health / summaries | projects/progress/dashboard | **critical** |
| `mtoPhases` | array<string> | allowed MTO phases | MTO tab | important |
| `overhead` | object | grouped recurring expenses | settings/money/real cost/hr | **critical** |
| `opCost` | number | derived operating cost per billable hour | service/project costing | derived, critical consumer |

### `settings.overhead`

Object with groups:
- `essential: array<{id,name,monthly}>`
- `extra: array<{id,name,monthly}>`
- `loans: array<{id,name,monthly}>`
- `vehicle: array<{id,name,monthly}>`

### `calcRefs` schema
This powers the Income Calc / RMO-Installer calculator.

Important keys:
- `rmoFee`
- `monthlyBaseFee`
- `custPerWatt`
- `installPerWatt`
- `panelWatts`
- `panelsPerSystem`
- `systemsPerMonth`
- `totalProjectsPerMonth`
- `selfInstallProjectsPerMonth`
- `visitsPerMonth`
- `projectedVolume`
- `installEnabled`
- `crewSize`
- `installDays`
- `laborCostPerHr`
- `payrollLoadMult`
- `batteryRmoFeePct`
- `panelUpgradeRmoFeePct`
- `batteryInstallFeePerSystem`
- `batteryInstallHoursPerSystem`
- `panelUpgradeInstallFeePerSystem`
- `panelUpgradeInstallHoursPerSystem`
- `solarOnlyPct`
- `batteryOnlyPct`
- `panelOnlyPct`
- `batteryPanelPct`
- `rmoVisitHours`
- `rmoVisitCostPerMile`
- `rmoVisitMilesRT`
- `rmoVisitFlatCost`

### `projects[]` schema
Each project is normalized through `hydrateProjectDefaults()` and should be assumed to contain at minimum:
- `id: string`
- `name: string`
- `type: string`
- `contract: number`
- `billed: number`
- `paid: number`
- `laborHrs: number`
- `mileRT: number`
- `miDays: number`
- `status: 'active'|'coming'|'completed'` (normalized from legacy values)
- `completedAt: string`
- `completionPromptSig: string`
- `completionDeclinedSig: string`
- `phases: object<phaseName, percent>`
- `lastMove: string`
- `laborRows: array`
- `matRows: array`
- `ohRows: array`
- `phaseEstimateRows: array`
- `mtoRows: array`
- `rfis: array`
- `logs: array`
- `coord: object`
- `tasks: object<phaseName, array>`
- finance-bucket helper fields may also appear in newer builds

### `employees[]`
- `id`
- `name`
- `role`
- `costRate`
- `billRate`

### `weeklyData[]`
- `wk`
- `start`
- `proj`
- `svc`
- `unbilled`
- `pendingInv`
- `accum`

### `priceBook[]`
Core keys commonly used:
- `id`
- `pid` / product ID
- `pidBlock`
- `pidBand`
- `name`
- `src`
- `unit`
- `cost`
- `link`
- `category`
- `family`
- optional AI/search metadata

### `logs[]` (project field logs)
Typical structure by usage:
- `id`
- `projectId`
- `date`
- `hrs`
- `miles`
- `mat`
- `note`
- optional `paymentsCollected`
- optional phase/task metadata

### `serviceLogs[]` — service record structure
Critical. See Section 8 for formulas. Keys commonly present:
- `id`
- `date`
- `customer`
- `address`
- `jtype`
- `hrs`
- `miles`
- `quoted`
- `mat`
- `collected`
- `payStatus` (legacy only; do **not** trust alone)
- `store`
- `notes`
- `profit`
- `mileCost`
- `opCost`
- `triggersAtSave`
- `balanceDue` (derived/overridden in some later builds)
- `adjustments: array<object>`

`adjustments[]` schema:
- `id`
- `kind: 'income' | 'expense'` (mileage is stored as expense + `category:'mileage'`)
- `category`
- `amount`
- `note`
- `date`

### `agendaSections[]`
- `id`
- `title`
- `projectId`
- `tasks[]`

### `triggerRules[]`
Each rule contains:
- `id`
- `name`
- `active`
- `type` (`bad_day`, `good_day`, `travel`, `material`, etc.)
- `condition`
- `threshold`
- `thresholdLabel`
- `situation`
- `review`
- `reflection`
- `solution`
- `color`

### State keys that are fragile/critical
Treat these as **fragile / critical** and do not rename casually:
- `projects`
- `serviceLogs`
- `logs`
- `weeklyData`
- `priceBook`
- `settings`
- `triggerRules`
- `_lastSavedAt`
- `_schemaVersion`
- `serviceEstimates`
- `activeServiceCalls`
- any key used by sync/recovery/export

---

## Section 3 — Complete Function Index

This section lists **major** render functions and **major** utility functions with what they do. A complete raw symbol roster for all discovered functions is included at the end of this section.

### App shell, persistence, recovery, sync

| Function | Responsibility | Reads | Writes | Fragility |
|---|---|---|---|---|
| `normalizeStateShape` | normalizes loaded/imported/remote state into current schema | raw payload, `DEFS` | returns normalized object, ensures arrays/keys exist | **very fragile** |
| `loadState` | local-first load from main and mirror copies | local storage main/backup | `S` via caller | **very fragile** |
| `savePrimaryAndBackup` | writes main + mirror local copies, pushes undo, snapshots | `S` | local main, mirror, meta, snapshots | **very fragile** |
| `saveState` | debounced save entry point | `S` | local persistence + cloud sync | **very fragile** |
| `createSnapshot` | snapshot current `S` | `S` | snapshot store | critical |
| `restoreUndoSnapshot` / `restoreRedoSnapshot` | undo / redo restores | undo/redo stacks, current `S` | `S`, local stores | critical |
| `initCloudSync` | startup pull-first cloud init | local `S`, remote snapshot | may replace `S`, may guarded-write | **very fragile** |
| `syncToSupabase` | guarded sync write flow | `S`, cloud runtime, remote | remote row and runtime | **very fragile** |
| `startSupabaseWatch` | poll-based remote watch | remote snapshot, `S` | may apply remote or warn | **very fragile** |
| `isRemoteMateriallyThinner` | richness guard comparator | remote + local payloads | none | **critical** |
| `applyRemoteEnvelope` | applies remote state safely | remote payload | mutates `S`, local copies | **critical** |
| `preserveConflictSnapshot` | keeps local copy before conflict replacement | `S` | snapshots | critical |
| `disconnectCloudSync` | test/disconnect/local-only mode | localStorage config | clears provider state | important |

### Navigation and panel rendering

| Function | Panel / scope | Reads | Writes | Notes |
|---|---|---|---|---|
| `nav` | desktop navigation | `S.view` | sets `S.view`, toggles active panel/nav item | **nav regressions happened here** |
| `mobNav` | mobile navigation | same | same | keep parity with `nav` |
| `renderPanel` | top-level panel dispatcher | `S.view` | panel DOM only | **must know every panel id** |
| `render` | full app rerender entry point | broad `S` | DOM | broad and fragile |
| `renderHome` | home dashboard | projects, service logs, task schedule, calendar cache | DOM | stable but frequently restyled |
| `renderProjects` | projects list/cards | `projects`, `activeId` | DOM | depends on bucket logic |
| `renderEstimate` | estimate tab | active project, service estimate state | DOM and estimate arrays | important |
| `renderMTO` | MTO panel | active project, price book | DOM and project MTO rows | important |
| `renderProgress` | progress/tasks | project phases/tasks | DOM and task/phase changes | important |
| `renderRFI` | RFI panel | project RFIs | DOM and RFI writes | important |
| `renderCoord` | coordination panel | project `coord` | DOM and coord edits | important |
| `renderDashboard` / framework render path | project framework/dashboard | projectDashboard + active project | DOM | historically fragile |
| `renderMoney` | money summary | settings, projects, service logs, weeklyData | DOM | important |
| `renderPriceBook` | price book tab | priceBook | DOM, price book writes | important |
| `renderTriggers` / `renderTriggerAnalysis` | field triggers | triggerRules, service logs | DOM | was broken by rebuilds |
| `renderServiceLogs` | service history + collections subpanels | serviceLogs | DOM | **critical** |
| `renderServiceCollectionsQueue` | open collections summary | serviceLogs via money math | DOM | **critical** |
| `renderGraphDashboard` / graphs panel functions | graphs tab | weeklyData, projects, logs, service logs, settings | charts/DOM | **nav regressions common** |

### Project utilities

| Function | Purpose | Reads | Writes | Notes |
|---|---|---|---|---|
| `resolveProjectBucket` | resolves `active` / `coming` / `completed` | `project.status` | none | **must be reused everywhere** |
| `setProjectStatus` | normalized project status updates | project | project status fields | critical |
| `maybePromptProjectCompletion` | prompts when all phases 100% | project phases/status | completion markers/status | critical |
| `health` | health score 0–100 | project completion, lastMove, RFIs, logs, paid vs contract | none | used by home |
| `getProjectFinancials` | project finance rollup | projects/logs/settings | may return helper object | important |
| `ensureProjectFinanceBucket` | finance-bucket compatibility | project | project finance helpers | important |
| `projectPortfolioBuckets` | project portfolio summary | projects | none | important |

### Service model utilities

| Function | Purpose | Reads | Writes | Fragility |
|---|---|---|---|---|
| `ensureServiceCallState` | service estimate / active call state existence | `S` | service arrays if missing | important |
| `ensureServiceAdjustments` | guarantees `adjustments[]` on service row | service row | row.adjustments | critical |
| `getServiceRollup` | rolls service ledger totals | service row + adjustments | none | **critical** |
| `serviceBalanceDue` | computes true money due | service row + rollup | none | **critical** |
| `getServicePaymentMeta` | derives status and labels from money math | service row + rollup | none | **critical** |
| `getServiceCollectionsRows` | queue source rows | serviceLogs | none | **critical** |
| `addServiceLedgerAdjustment` | add expense / mileage / income to existing service call | serviceLogs | mutates one row adjustments and derived balance | **critical** |
| `renderServiceLedger` | inline ledger UI | service row | DOM | important |
| `renderServiceCollectionsQueue` | queue widget | serviceLogs | DOM | **critical** |
| `markServiceCollected`, `setPartial`, `editServiceLog` (names vary by branch) | payment updates/edit path | serviceLogs | service row | important |

### Calendar utilities

| Function | Purpose | Notes |
|---|---|---|
| `normalizeGcalUrl` | sanitize Google Calendar URL/embed |
| `extractCalendarEmbedSrc` | derive embed URL | **must preserve week default** |
| `calendarEmbedSrcWithTs` | embed URL builder with anti-cache timestamp |
| `renderCalendar` | renders embedded calendar |
| `gcalRefresh` | refreshes calendar cache/embed |
| `calNav` / `calWeekStart` | week navigation |
| `startGcalAutoRefresh` / `gcalAutoRefreshTick` | auto refresh |

### Graph / dashboard utilities

| Function | Purpose | Fragility |
|---|---|---|
| graph render helpers for cashflow, risk, business-linked projections | build chart datasets, instantiate Chart.js objects | graph panel was repeatedly broken by nav or resize regressions |
| chart resize/height helpers | lock canvas sizes | shrink-loop bug happened here |

### Export / import / backup

| Function | Purpose | Notes |
|---|---|---|
| `exportData` | exports plain JSON of `S` | canonical backup |
| `exportRecoveryBundle` | exports main + mirror + snapshots + meta | recovery-first |
| `commitImportedState` | writes imported state with quota fallbacks | **critical** |
| `importData` | imports backup | normalizes and writes |
| `restoreLatestSnapshot` | restore latest local snapshot |
| `downloadSuggestedBackup` / `downloadSuggestedRecoveryBundle` | convenience backup downloads |
| `exportLocalOnlyPackage` | local-only restore package |

### Complete raw function roster

The current HTML build exposes the following discovered function symbols (top-level declarations and top-level arrow assignments):

- `fmtBackupStamp` — line 2396
- `getActiveProjectSlug` — line 2406
- `getSuggestedBackupName` — line 2418
- `readPromptMeta` — line 2422
- `writePromptMeta` — line 2425
- `noteWorkActivity` — line 2428
- `recordManualBackup` — line 2435
- `getBackupPromptDue` — line 2445
- `showBackupPrompt` — line 2456
- `hideBackupPrompt` — line 2463
- `dismissBackupPrompt` — line 2467
- `evaluateBackupPrompt` — line 2474
- `triggerJSONDownload` — line 2479
- `downloadSuggestedBackup` — line 2488
- `downloadSuggestedRecoveryBundle` — line 2502
- `deepClone` — line 2524
- `hasOwn` — line 2527
- `toNumOr` — line 2528
- `hydrateProjectDefaults` — line 2532
- `materialSearchUrl` — line 2567
- `hydratePriceBookLinks` — line 2580
- `normalizeStateShape` — line 2589
- `readJSONSafe` — line 2627
- `writeJSONSafe` — line 2634
- `isQuotaError` — line 2637
- `trimLocalCachesForRetry` — line 2641
- `writeCriticalLocalCopies` — line 2655
- `statesEqual` — line 2659
- `readUndoHistory` — line 2662
- `writeUndoHistory` — line 2665
- `readRedoHistory` — line 2668
- `writeRedoHistory` — line 2671
- `clearRedoHistory` — line 2674
- `pushUndoState` — line 2677
- `captureCurrentUiContext` — line 2695
- `restoreUiContext` — line 2703
- `restoreUndoSnapshot` — line 2712
- `restoreRedoSnapshot` — line 2762
- `attachUndoHotkey` — line 2812
- `saveMeta` — line 2833
- `getMeta` — line 2838
- `createSnapshot` — line 2839
- `savePrimaryAndBackup` — line 2853
- `loadState` — line 2891
- `updateDataProtectionBadge` — line 2923
- `saveState` — line 2940
- `attachAutoSave` — line 2972
- `attachDataLossGuards` — line 2989
- `getDeviceId` — line 3008
- `getRemoteStampMs` — line 3020
- `updateCloudSeen` — line 3026
- `markCloudDirty` — line 3031
- `syncCurrentViewAfterRemoteApply` — line 3035
- `persistStateLocallyOnly` — line 3046
- `preserveConflictSnapshot` — line 3055
- `applyRemoteEnvelope` — line 3066
- `gzipCompress` — line 3087
- `gzipDecompress` — line 3101
- `cloudSync` — line 3110
- `setSyncBadge` — line 3131
- `cloudWrite` — line 3147
- `cloudRead` — line 3154
- `getSupabaseTable` — line 3163
- `getSupabaseStateKey` — line 3164
- `isSupabaseReadAuthError` — line 3165
- `syncToJSONBin` — line 3171
- `readFromJSONBin` — line 3173
- `syncToGitHub` — line 3176
- `readFromGitHub` — line 3188
- `readSupabaseEnvelope` — line 3201
- `insertSupabaseEnvelope` — line 3217
- `patchSupabaseEnvelopeGuarded` — line 3252
- `syncToSupabase` — line 3286
- `runSupaDiag` — line 3341
- `readFromSupabase` — line 3379
- `getCoreDataRichness` — line 3396
- `isRemoteMateriallyThinner` — line 3406
- `startSupabaseWatch` — line 3414
- `testSupabaseConnection` — line 3458
- `initCloudSync` — line 3477
- `showCloudSetup` — line 3524
- `updateCloudFields` — line 3574
- `testCloudConnection` — line 3657
- `saveCloudConfig` — line 3699
- `disconnectCloudSync` — line 3742
- `exportLocalOnlyPackage` — line 3752
- `today` — line 3779
- `uid` — line 3783
- `getP` — line 3784
- `pw` — line 3795
- `ov` — line 3797
- `getTrackedPhaseKeys` — line 3802
- `normalizeProjectStatusValue` — line 3809
- `getCompletionSignature` — line 3816
- `areAllProjectPhasesComplete` — line 3820
- `resolveProjectBucket` — line 3826
- `setProjectStatus` — line 3833
- `maybePromptProjectCompletion` — line 3856
- `health` — line 3888
- `calcDerived` — line 3902
- `getOpCostRate` — line 3919
- `num` — line 3925
- `estTotals` — line 3930
- `syncEstimateToProjectBucket` — line 3964
- `applyTheme` — line 3983
- `toggleTheme` — line 3988
- `nav` — line 3991
- `renderPanel` — line 4009
- `updateStrip` — line 4030
- `normalizeGcalUrl` — line 4078
- `extractCalendarEmbedSrc` — line 4083
- `getGcalUrl` — line 4090
- `openCalendarSettingsLink` — line 4093
- `pad2` — line 4100
- `escHtml` — line 4101
- `normalizeUrl` — line 4106
- `renderOptionalLogExtras` — line 4113
- `removeHomeUpgradePass` — line 4120
- `saveCalendarSettings` — line 4131
- `testCalendarSettings` — line 4144
- `gcalRefresh` — line 4149
- `calWeekStart` — line 4155
- `calNav` — line 4162
- `calendarEmbedSrcWithTs` — line 4169
- `renderCalendar` — line 4177
- `gcalAutoRefreshTick` — line 4203
- `startGcalAutoRefresh` — line 4206
- `initCalendar` — line 4212
- `getAgendaProjectName` — line 4218
- `ensureAgendaState` — line 4222
- `pickAgendaProjectId` — line 4234
- `addAgendaCategory` — line 4242
- `editAgendaCategory` — line 4251
- `removeAgendaCategory` — line 4263
- `addAgendaTaskPrompt` — line 4271
- `editAgendaTask` — line 4290
- `moveAgendaTask` — line 4301
- `removeAgendaTask` — line 4320
- `cycleAgendaTaskStatus` — line 4327
- `agendaStatusChip` — line 4337
- `renderHome` — line 4343
- `renderProjects` — line 4502
- `projCard` — line 4510
- `moveProjStatus` — line 4594
- `openProj` — line 4611
- `renderHero` — line 4614
- `switchProj` — line 4645
- `normalizePhaseName` — line 4650
- `getEstimateMaterialPhases` — line 4663
- `getMTOActivePhaseBreakdown` — line 4676
- `renderMatPhaseRows` — line 4697
- `getMTOPhaseCosts` — line 4715
- `ensurePhaseEstimateRows` — line 4727
- `renderPhaseEstimateRows` — line 4741
- `addPhaseEstimateRow` — line 4759
- `delPhaseEstimateRow` — line 4765
- `updatePhaseEstimate` — line 4770
- `ensureServiceCallState` — line 4780
- `createOpenEstimateFromServiceTemplate` — line 4785
- `addServiceEstimate` — line 4838
- `editServiceEstimate` — line 4856
- `removeServiceEstimate` — line 4874
- `moveEstimateToActiveServiceCall` — line 4882
- `removeActiveServiceCall` — line 4903
- `renderServiceCallTracker` — line 4911
- `renderEstimate` — line 5006
- `renderLR` — line 5023
- `renderMR` — line 5038
- `renderOR` — line 5042
- `recalc` — line 5054
- `addLaborRow` — line 5082
- `addOHRow` — line 5083
- `delRow` — line 5084
- `editN` — line 5087
- `editGlobal` — line 5123
- `editMile` — line 5138
- `srchEstMat` — line 5148
- `addMatEst` — line 5160
- `showMTOImportStatus` — line 5168
- `hideMTOImportStatus` — line 5175
- `buildMTOImportReviewHTML` — line 5176
- `refreshMTOFromCloud` — line 5204
- `mtoPhaseName` — line 5233
- `mtoIsQty` — line 5241
- `mtoIsMoney` — line 5242
- `mtoClean` — line 5243
- `mtoShouldSkip` — line 5244
- `mtoMaterialStartIndex` — line 5249
- `mtoSplitPlacementAndDesc` — line 5270
- `mtoExtractEntriesFromLine` — line 5288
- `mtoPdfLinesFromItems` — line 5302
- `extractPdfLines` — line 5324
- `parseMtoPdfLines` — line 5336
- `supplierSearchLink` — line 5408
- `inferPreferredSupplier` — line 5419
- `buildPriceBookLinkMeta` — line 5426
- `editPriceBookLink` — line 5431
- `findOrCreatePriceBookEntry` — line 5444
- `openMTOPDFPicker` — line 5463
- `importMTOPDF` — line 5469
- `normalizeMTOName` — line 5534
- `getCombinedMTOSummary` — line 5537
- `verifyCombinedMTO` — line 5560
- `getPriceBookItemById` — line 5580
- `ensureMTORowMatId` — line 5583
- `editMTOItemGlobalPrice` — line 5591
- `editMTORowDescription` — line 5606
- `editMTORowLinkedItem` — line 5619
- `ensureMTORowMeta` — line 5634
- `editMTORowNote` — line 5644
- `normalizePIDName` — line 5676
- `classifyPIDGroup` — line 5685
- `nextIdInBlock` — line 5792
- `getUsedProductIds` — line 5805
- `assignMatrixIdToPriceBookItem` — line 5813
- `integrateProductIdMatrix` — line 5827
- `renderMTO` — line 5862
- `srchMTO` — line 5935
- `addToMTO` — line 5945
- `delMTO` — line 5952
- `recalcPhase` — line 5955
- `renderProgress` — line 5961
- `toggleAcc` — line 6026
- `toggleScheduleTask` — line 6029
- `renderTaskSchedule` — line 6050
- `updSchedField` — line 6106
- `removeFromSchedule` — line 6111
- `clearSchedule` — line 6117
- `updTask` — line 6124
- `updTaskDesc` — line 6141
- `updTaskHrs` — line 6147
- `overridePhase` — line 6153
- `normalizeTaskStatus` — line 6168
- `taskStatusBadge` — line 6172
- `cycleTaskStatus` — line 6177
- `setTaskStatusPrompt` — line 6192
- `addTask` — line 6209
- `confirmAddTask` — line 6232
- `cancelAddTask` — line 6243
- `delTask` — line 6248
- `addPhase` — line 6253
- `renderRFI` — line 6267
- `toggleRFI` — line 6292
- `delRFI` — line 6293
- `renderCoord` — line 6296
- `addCQ` — line 6322
- `delCQ` — line 6323
- `getFieldProjectQuote` — line 6328
- `refreshFieldProjectQuote` — line 6332
- `projectPortfolioBuckets` — line 6342
- `getTriggerTypeMeta` — line 6358
- `projectLogsFor` — line 6372
- `ensureProjectFinanceBucket` — line 6376
- `getProjectFinancials` — line 6385
- `syncProjectFinanceBucket` — line 6405
- `syncAllProjectFinanceBuckets` — line 6418
- `calcLogActualCost` — line 6421
- `buildProjectLogRollup` — line 6435
- `getProjectFieldMetrics` — line 6463
- `getProjectWarningSignals` — line 6493
- `renderFieldBudgetSummary` — line 6520
- `renderPaymentTimeline` — line 6578
- `renderField` — line 6616
- `previewProfit` — line 6624
- `renderLogs` — line 6642
- `resetLogForm` — line 6685
- `beginLogEdit` — line 6696
- `cancelLogEdit` — line 6718
- `updateProjectLogMirror` — line 6722
- `removeProjectLogMirror` — line 6730
- `updateLogEntry` — line 6735
- `deleteLogEntry` — line 6769
- `saveLog` — line 6788
- `updateHrsBudget` — line 6814
- `renderPayTracker` — line 6821
- `openPayEdit` — line 6877
- `updatePayPreview` — line 6935
- `savePayEdit` — line 6953
- `getBusinessRevenueMetrics` — line 6978
- `getIncomeCalcState` — line 7008
- `getIncomeCalcDraft` — line 7041
- `primeIncomeCalcDraft` — line 7045
- `setIncomeCalcDraftField` — line 7049
- `parseIncomeCalcField` — line 7053
- `commitIncomeCalcDraftField` — line 7061
- `handleIncomeCalcFieldKey` — line 7078
- `setIncomeCalcField` — line 7091
- `incomeCalcSignalColor` — line 7103
- `renderIncomeCalcCharts` — line 7106
- `ensureHost` — line 7115
- `fmtMoney` — line 7129
- `esc` — line 7135
- `yFor` — line 7136
- `buildChart` — line 7141
- `show` — line 7200
- `hide` — line 7211
- `renderIncomeCalc` — line 7244
- `metric` — line 7393
- `field` — line 7396
- `section` — line 7401
- `renderMoney` — line 7568
- `renderPB` — line 7704
- `editMaterialLink` — line 7731
- `delPB` — line 7740
- `renderTeam` — line 7743
- `editEmpR` — line 7774
- `renderSettings` — line 7785
- `renderOHSection` — line 7815
- `editOHV` — line 7831
- `editOHN` — line 7850
- `addOHLine` — line 7856
- `delOHL` — line 7865
- `editSal` — line 7871
- `editHrs` — line 7879
- `liveTargets` — line 7887
- `renderPWEditor` — line 7894
- `updPW` — line 7908
- `delPW` — line 7916
- `renderMTOPhed` — line 7923
- `addMTOPhase` — line 7933
- `delMTOPh` — line 7934
- `saveAllSettings` — line 7936
- `exportData` — line 7950
- `exportRecoveryBundle` — line 7957
- `restoreLatestSnapshot` — line 7971
- `commitImportedState` — line 7981
- `importData` — line 8025
- `printEst` — line 8145
- `showModal` — line 8204
- `mtoMSearch` — line 8488
- `selMTOMat` — line 8498
- `openActiveServiceCallToFieldLog` — line 8500
- `buildSvcCompareWarnings` — line 8520
- `saveSvcCompareToFieldLog` — line 8549
- `closeModal` — line 8607
- `saveQLog` — line 8609
- `saveProj` — line 8620
- `saveEmp` — line 8641
- `ensureProjectDashboardState` — line 8650
- `getDashboardProjId` — line 8657
- `getDashboardBucket` — line 8658
- `normalizeDashSeed` — line 8668
- `hydrateDashSelectors` — line 8676
- `seedProjectDashboard` — line 8682
- `importProjectDashboard` — line 8692
- `exportProjectDashboard` — line 8731
- `dashboardInferKind` — line 8744
- `dashboardRowTitle` — line 8752
- `dashboardRowBody` — line 8755
- `dashboardAttn` — line 8758
- `setDashboardCategory` — line 8761
- `pdLaneLabel` — line 8765
- `pdLaneHint` — line 8766
- `addDashLaneItem` — line 8767
- `editDashLaneItem` — line 8776
- `removeDashLaneItem` — line 8790
- `moveDashLaneItem` — line 8796
- `toggleDashLaneCleared` — line 8804
- `pushDashRowToRFI` — line 8811
- `pushDashRowToCoord` — line 8820
- `normalizeDashStatus` — line 8831
- `dashStatusBadge` — line 8835
- `ensureDashRowStatus` — line 8840
- `dashGetRow` — line 8856
- `dashSetRow` — line 8861
- `editDashCategoryItem` — line 8865
- `removeDashCategoryItem` — line 8882
- `toggleDashCategoryCleared` — line 8889
- `setDashCategoryStatus` — line 8898
- `escapeHtml` — line 8912
- `extractCodeGroups` — line 8915
- `renderCodeGroups` — line 8936
- `extractBuildingDeptSchedule` — line 8948
- `normalizePhaseBucket` — line 8994
- `autoLaneFromKind` — line 9046
- `laneItemExists` — line 9051
- `seedDashboardLanesFromCategories` — line 9054
- `getFrameworkStamp` — line 9099
- `peekSupabaseRemoteStamp` — line 9102
- `refreshProjectFrameworkFromCloud` — line 9121
- `initFrameworkCloudWatch` — line 9160
- `renderProjectDashboard` — line 9174
- `saveRFI` — line 9332
- `markAnswered` — line 9340
- `savePBItem` — line 9346
- `saveCustomMaterial` — line 9354
- `saveMargins` — line 9375
- `get52WeekYear` — line 9380
- `weekDateFromStart` — line 9385
- `getWeekIndexForDate` — line 9393
- `ensureWeekStarts` — line 9404
- `refreshFinancialViews` — line 9423
- `sync52WeeksFromBusinessData` — line 9432
- `build52Weeks` — line 9502
- `recomputeAccum` — line 9508
- `getCurrentWk` — line 9523
- `render52Weeks` — line 9536
- `wkEdit` — line 9590
- `saveWeek` — line 9618
- `saveMTOModal` — line 9632
- `savePayUpdate` — line 9639
- `saveEditProj` — line 9646
- `delProj` — line 9665
- `populateSels` — line 9675
- `renderLeads` — line 9689
- `switchLeadTab` — line 9695
- `showLeadScripts` — line 9706
- `showDecisionFramework` — line 9713
- `updateFrameworkTargets` — line 9721
- `updateLeadBadge` — line 9727
- `renderGCTable` — line 9736
- `saveGC` — line 9774
- `deleteGC` — line 9800
- `editGC` — line 9807
- `saveEditGC` — line 9844
- `renderSvcTable` — line 9864
- `saveServiceLead` — line 9888
- `cycleSvcStatus` — line 9909
- `deleteSvcLead` — line 9916
- `renderWeeklyReview` — line 9922
- `renderWeeklySummary` — line 9942
- `saveWeeklyReview` — line 9958
- `deleteWeeklyReview` — line 9977
- `switchFieldTab` — line 9987
- `previewSvcProfit` — line 10014
- `checkLiveTriggers` — line 10035
- `serviceLogFormData` — line 10060
- `resetServiceLogForm` — line 10097
- `loadServiceLogForEdit` — line 10109
- `cancelServiceLogEdit` — line 10135
- `populateServiceLogForm` — line 10136
- `quickSetServicePayment` — line 10158
- `saveServiceLog` — line 10183
- `getFiredTriggerNames` — line 10207
- `ensureServiceAdjustments` — line 10222
- `getServiceRollup` — line 10227
- `serviceBalanceDue` — line 10255
- `getServicePaymentMeta` — line 10266
- `getServiceCollectionsRows` — line 10289
- `focusServiceCollections` — line 10297
- `applyServiceCollectionsFilter` — line 10304
- `addServiceLedgerAdjustment` — line 10311
- `toggleServiceLedger` — line 10338
- `renderServiceLedger` — line 10343
- `renderServiceCollectionsQueue` — line 10361
- `editServiceLogById` — line 10410
- `renderServiceLogs` — line 10414
- `deleteServiceLog` — line 10493
- `getTriggerTargetOptions` — line 10501
- `ensureTriggerTargetSelection` — line 10518
- `getFiredTriggerNamesForData` — line 10527
- `getSelectedTriggerTargetData` — line 10540
- `renderSelectedTriggerTarget` — line 10565
- `renderTriggerAnalysis` — line 10594
- `renderTriggerRules` — line 10678
- `toggleTrigger` — line 10726
- `deleteTrigger` — line 10731
- `editTrigger` — line 10737
- `saveTriggerEdit` — line 10768
- `saveNewTrigger` — line 10786
- `getRelTop` — line 10815
- `toast` — line 10872
- `toggleMobNav` — line 10880
- `closeMobNav` — line 10890
- `mobNav` — line 10900
- `switchEstTab` — line 10941
- `calcServiceCall` — line 10967
- `renderSCPie` — line 11003
- `logServiceCallFromEstimate` — line 11092
- `destroyChart` — line 11096
- `isDark` — line 11097
- `gridColor` — line 11098
- `textColor` — line 11099
- `renderEstChart` — line 11107
- `ensureChartsCardMessage` — line 11175
- `clearChartsCardMessage` — line 11193
- `chartsAvailable` — line 11204
- `renderGraphs` — line 11208
- `prepGdCanvas` — line 11356
- `gdCFOTLine` — line 11371
- `gdOPPBar` — line 11432
- `gdPCDScatter` — line 11503
- `gdEVRBar` — line 11619
- `gdWCBBar` — line 11666
- `getFamilyLabelFromMaterial` — line 11777
- `getFinalMTOQuantitySummary` — line 11802
- `formatHomeDepotAIQty` — line 11833
- `hdBatchButtonLabel` — line 11837
- `hdBatchMetaLabel` — line 11843
- `getHomeDepotBatchText` — line 11849
- `buildHomeDepotAIBatches` — line 11852
- `pushBatch` — line 11903
- `renderHomeDepotAIModal` — line 11958
- `setHomeDepotAIBatch` — line 11986
- `openHomeDepotAIList` — line 11994
- `copyHomeDepotAIBatch` — line 12007
- `printMTOPDF` — line 12029
- `ensureExtensionState` — line 12308
- `getTemplate` — line 12330
- `inferTemplateIdFromProject` — line 12331
- `buildTasks` — line 12339
- `buildPhaseDefaults` — line 12345
- `weightedLaborRate` — line 12349
- `actualLaborHours` — line 12361
- `actualMaterialCost` — line 12366
- `buildArchiveEntry` — line 12372
- `archiveProject` — line 12411
- `templateUsage` — line 12428
- `projectFromTemplate` — line 12435
- `promptCreateFromTemplate` — line 12459
- `injectNavAndPanels` — line 12475
- `renderTemplates` — line 12493
- `archiveCandidates` — line 12541
- `pricingStats` — line 12548
- `renderIntelligence` — line 12573
- `enhanceAddProjectModal` — line 12675
- `applyTemplateToProjectForm` — line 12692

---

## Section 4 — Supabase Sync Architecture

### Sync target
- **Provider:** Supabase
- **Table:** `app_state`
- **State key:** `poweron_v2`
- These are accessed by:
  - `getSupabaseTable()` → default `app_state`
  - `getSupabaseStateKey()` → default `poweron_v2`

### Row shape
The app expects a row shaped approximately like:

```json
{
  "state_key": "poweron_v2",
  "data": { ...full normalized state... },
  "updated_at": "2026-03-27T00:00:00.000Z"
}
```

### Exact sync logic
#### On startup (`initCloudSync`)
1. If no cloud provider configured, stay local-only.
2. If provider exists, `cloudRead()` fetches remote state.
3. Remote state is normalized.
4. Compare `remoteTs` vs `localTs` using `_lastSavedAt`.
5. If remote is newer **and not materially thinner**, apply remote.
6. If remote is newer **but materially thinner**, preserve local and warn.
7. If local is newer, guarded-write local to cloud.
8. If no remote exists, upload local.
9. Start Supabase watch polling.

#### On save (`saveState` → `cloudSync`)
1. Save local first (main + mirror + snapshots / undo as needed).
2. Mark cloud dirty unless currently applying remote.
3. `cloudSync()` waits 1500 ms debounce.
4. `syncToSupabase()` reads remote envelope.
5. If another device advanced remote while local dirty, preserve local snapshot and load remote.
6. Else patch remote using `patchSupabaseEnvelopeGuarded()` filtered by `lastSeenIso`.
7. If guarded patch misses, re-read remote and treat as conflict.

#### On watch (`startSupabaseWatch`)
- Poll every 2500 ms while visible.
- Also poll on `focus` and when visibility becomes `visible`.
- If remote timestamp is newer:
  - if local dirty → warn only, do not auto-apply
  - if remote materially thinner than local → keep local, warn
  - else apply remote

### Richness guard logic
Implemented by:
- `getCoreDataRichness(payload)`
- `isRemoteMateriallyThinner(remoteData, localData)`

Current richness score prioritizes:
- `serviceLogs` count heavily
- then `projects`
- then `logs`
- then `activeServiceCalls`

Guard rules:
- remote is thinner if `serviceLogs + 1 < local.serviceLogs`
- remote is thinner if `projects + 2 < local.projects` and local has projects
- remote is thinner if `logs + 3 < local.logs` and local has logs

### Local-first recovery behavior
The app is explicitly **local-first**:
- local main and local mirror are written before cloud write
- conflict snapshots are preserved before remote replacement
- if Supabase read auth fails (401/403), app can continue from local copy
- `loadState()` prefers whichever of local main or local mirror is newer

### Known failure modes and handling
| Failure mode | Cause | Handling |
|---|---|---|
| thinner remote overwrites richer local | timestamp-only sync | fixed by richness guard |
| stale device overwrites newer remote | unguarded full-state write | fixed by guarded patch + conflict snapshot |
| false “Save failed” on iPad | localStorage quota pressure | trim caches and retry critical writes |
| watch loop read 401/403 | Supabase policy/key mismatch | watch pauses gracefully, app continues locally |
| wrong table / wrong state key | old defaults `app_states` / `main` | fixed to `app_state` / `poweron_v2` |
| hidden older branch opening empty bucket | bad config or stale sync setup | manual sync setup confirmation required |

### Disconnect / test mode implementation
- `disconnectCloudSync()` removes active provider usage and returns app to local-only behavior
- `testSupabaseConnection()` validates URL/key/table reachability
- `runSupaDiag()` performs deeper console diagnostics
- `showCloudSetup()` exposes config modal
- `saveCloudConfig()` saves provider settings to local storage

---

## Section 5 — Undo/Redo System

### Implementation
- Hotkeys attached by `attachUndoHotkey()`
- Undo:
  - `Ctrl+Z` / `Cmd+Z`
- Redo:
  - `Ctrl+Y` / `Cmd+Y`
  - `Ctrl+Shift+Z` / `Cmd+Shift+Z`
- Disabled while focused in editable controls (`input`, `textarea`, `select`, contentEditable)

### History stack structure
Undo/redo items are objects like:

```json
{
  "ts": 1710000000000,
  "reason": "save",
  "data": { ...normalized state snapshot... }
}
```

### Storage
- Undo history: `STORE_UNDO_KEY`
- Redo history: `STORE_REDO_KEY`
- Both stored in localStorage JSON

### What triggers a history push
`pushUndoState(prevState, reason)` is called inside `savePrimaryAndBackup()` before writing the new main state. It only pushes when:
- previous state exists
- previous normalized state differs from current normalized state
- previous state is not already at the top of undo history

### History depth and pruning
- Depth controlled by `MAX_UNDO_HISTORY`
- On overflow, oldest items are popped
- On iPad quota pressure, histories are trimmed aggressively (`trimLocalCachesForRetry()`)

### Redo logic
- Redo stack is cleared on normal save
- Redo buffer is populated when undo restore happens

---

## Section 6 — Snapshot System

### How snapshots are saved
Snapshots are created by `createSnapshot(reason)` and contain:

```json
{
  "ts": 1710000000000,
  "reason": "save | cloud-conflict | manual_download_backup | ...",
  "data": { ...deep clone of S... }
}
```

### Where stored
- localStorage key: `STORE_SNAPSHOTS_KEY`

### Naming / reason patterns
Observed reasons include:
- `save`
- `manual_download_backup`
- `manual_download_recovery`
- `cloud-conflict-before-remote-load`
- `cloud-watch-thinner-remote`
- `cloud-init-thinner-remote`
- `pre_restore_latest_snapshot`
- `restore_latest_snapshot`

### Snapshot creation cadence
- time-based via `SNAPSHOT_INTERVAL_MS`
- manual backup actions also create snapshots
- cloud conflicts create preservation snapshots

### Restore behavior
- `restoreLatestSnapshot()` restores newest snapshot after confirmation
- snapshot restore writes main + mirror via `savePrimaryAndBackup()`
- snapshot restore rerenders app, reapplies theme, repopulates selectors

### Known edge cases
- large snapshot history can trigger iPad localStorage quota issues
- on quota pressure, snapshots are trimmed to keep only newest ~2
- snapshots are local only; they are **not** mirrored to Supabase automatically

---

## Section 7 — Navigation Architecture

### Panel / nav ids
Current discovered panel ids:
- `home`
- `projects`
- `estimate`
- `field`
- `progress`
- `dashboard`
- `mto`
- `rfi`
- `coord`
- `pricebook`
- `money`
- `graphs`
- `incalc`
- `leads`
- `team`
- `templates`
- `intelligence`
- `settings`

### Desktop sidebar structure
Desktop nav uses `.ni2[data-v="..."]` entries and `nav(view, this)` click handlers.

### Mobile nav structure
Mobile nav uses `.mob-tab[data-v="..."]` entries and `mobNav(view, this)` click handlers.

### Active tab switching
- `S.view` is the source of truth
- `nav()` / `mobNav()` update active item classes and call `renderPanel(view)`
- some nested tabs also exist:
  - leads subviews
  - estimate subviews
  - field subviews (`proj`, `svc`, `triggers`)

### Panels previously broken by nav regressions
These are historically fragile and must be explicitly protected:
- **Graph Dashboard / `graphs`** — panel still existed but nav link disappeared
- **Triggers tab** — panel blanked after rebuilds
- **Field service subview** — row actions or selectors broke when subview wiring changed

### Non-negotiable nav requirement
Whenever editing navigation, verify:
- desktop sidebar item exists
- mobile tab exists if applicable
- `renderPanel()` can reach panel
- any nested view toggles still work

---

## Section 8 — Service Job Model (Critical)

### Core service log entry structure
Each `serviceLogs[]` entry is one service job record:

```json
{
  "id": "sl001",
  "date": "2026-01-05",
  "customer": "Claudio",
  "address": "...",
  "jtype": "Lighting | Troubleshoot | GFCI / Receptacles | ...",
  "hrs": 2,
  "miles": 42,
  "quoted": 195,
  "mat": 32.95,
  "collected": 0,
  "payStatus": "N | P | Y",
  "store": "Home Depot",
  "notes": "...",
  "profit": 0,
  "mileCost": 27.72,
  "opCost": 84.9,
  "triggersAtSave": [],
  "adjustments": []
}
```

### Ledger adjustment types
Implemented through `addServiceLedgerAdjustment(id, kind)`.

Supported user-facing actions:
- **Add Expense**
- **Add Mileage**
- **Add Income**

Stored as `adjustments[]` objects:
- expense:
  - `kind: 'expense'`
  - `category: 'expense'`
- mileage:
  - stored as `kind: 'expense'`
  - `category: 'mileage'`
- income:
  - `kind: 'income'`
  - `category: 'income'` or omitted

### Roll-up formulas
Implemented by `getServiceRollup(row)`.

Definitions:
- `baseQuoted = num(row.quoted)`
- `addIncome = sum(adjustments where kind='income')`
- `addExpense = sum(adjustments where kind='expense' and category!='mileage')`
- `addMileage = sum(adjustments where kind='mileage' OR category='mileage')`
- `totalAddedCost = addExpense + addMileage`
- `totalBillable = baseQuoted + addIncome`
- `baseActual = num(row.mat) + num(row.mileCost) + num(row.opCost)`
- `totalActual = baseActual + totalAddedCost`
- `collected = num(row.collected)`
- `remaining = max(0, totalBillable - collected)`
- `projectedProfit = totalBillable - totalActual`

### Collections Queue inclusion rules
Implemented by `getServiceCollectionsRows()`.

A row is included if:
- `remaining > 0.009`

Rows are normalized through `getServicePaymentMeta()` and sorted by:
1. highest remaining balance
2. latest date descending

### Payment status calculation
**Never trust `payStatus` alone.** The canonical rule is money math.

Implemented by `getServicePaymentMeta(row)`:
- `remaining = serviceBalanceDue(row)`
- `fullyPaid = remaining <= 0.009 && totalBillable > 0`
- `partialPaid = !fullyPaid && collected > 0.009`
- derived `status`:
  - `Y` if fully paid
  - `P` if partial
  - `N` otherwise
- labels:
  - `Paid in full`
  - `Partial balance left`
  - `Full balance left`

### `serviceBalanceDue()` exact logic
1. compute rollup
2. look for explicit remaining override fields:
   - `balanceDue`
   - `remainingDue`
   - `remainingBalance`
   - `balance`
3. if an explicit positive value is larger than computed remaining, use explicit
4. else if computed remaining positive, use computed remaining
5. else if legacy status is `'N'` and total billable > 0, use total billable
6. else 0

### Why this matters
This logic fixed the regression where an unpaid job like **Stephanie** was incorrectly shown as partial or zero remaining.

### Edge cases that have caused bugs before
- stale `payStatus:'P'` with `collected = 0` → must still show unpaid/full balance left
- duplicate service entries used to simulate multiple trips → overstates collections if treated as separate invoices
- adjustments can increase billable without increasing collected
- collections queue must summarize by money due, not stale labels

### Current multi-trip-safe approach
The app does **not** fully rebuild service calls into parent/child trip tables yet. Instead it safely supports multi-visit economics by attaching **ledger adjustments** to the original service call ID:
- add income for approved adders
- add expense for extra cost
- add mileage for extra trip travel

This preserves existing service history logic without a wholesale schema break.

---

## Section 9 — Project Model

### Complete project structure (practical schema)
Each project should be assumed to carry:
- identity: `id`, `name`, `type`
- status: `status`, `completedAt`, `lastMove`, completion signature fields
- finance: `contract`, `billed`, `paid`
- production assumptions: `laborHrs`, `mileRT`, `miDays`
- progress: `phases`
- estimate arrays: `laborRows`, `matRows`, `ohRows`, `phaseEstimateRows`
- MTO: `mtoRows`
- field execution: `logs`
- communications: `rfis`, `coord`
- tasks: `tasks`

### Finance bucket system
Core visible finance fields:
- `contract`
- `billed`
- `paid`
- optional finance bucket helpers from `ensureProjectFinanceBucket()` / `getProjectFinancials()`

Interpretation:
- **Open Projects Exposure** = remaining active-project bucket, not including coming/completed
- billed/paid can be overridden by explicit finance-bucket logic if present

### Phase model
Default weighted phases from settings:
- `Estimating`
- `Planning`
- `Site Prep`
- `Rough-in`
- `Finish`
- `Trim`

Default weights:
- Estimating 5
- Planning 10
- Site Prep 15
- Rough-in 35
- Finish 25
- Trim 10

Completion logic:
- `getTrackedPhaseKeys(p)` enumerates relevant project phases
- `areAllProjectPhasesComplete(p)` returns true when all tracked phases reach 100%
- `maybePromptProjectCompletion(p)` asks user whether to mark project complete

### Health score calculation
Implemented by `health(p)`.

Formula:
- base 50
- `+ o * .28` where `o = ov(p)` completion percent
- `+15` if last move < 7 days
- `+5` if last move < 14 days
- `-20` otherwise
- `-5 * openRFIcount`
- `+10` if project has logs
- `+8 * (paid / contract)` capped via formula
- clamp 0–100

Thresholds:
- `>=70` green
- `>=50` yellow
- else red

### Bucket logic (`resolveProjectBucket()`)
Normalized result is always one of:
- `active`
- `coming`
- `completed`

Rules:
- if normalized status is `completed` → completed
- if normalized status is `coming` → coming
- else active

### MTO structure
`mtoRows[]` entries commonly contain:
- `id`
- `phase`
- `matId`
- `name`
- `qty`
- `note`
- linked product metadata may be added later

### Estimate structure
#### `laborRows[]`
- `id`
- `desc`
- `empId`
- `hrs`
- `rate`

#### `matRows[]`
- `id`
- `matId`
- `name`
- `qty`
- `costUnit`
- `waste`

#### `ohRows[]`
- `id`
- `desc`
- `hrs`
- `rate`

#### `phaseEstimateRows[]`
Phase-level estimate summary rows aligned to project phases.

### RFI structure
`rfis[]` entries commonly contain:
- `id`
- `status` (`critical`, `open`, `answered`)
- `question`
- `directedTo`
- `submitted`
- `response`
- `costImpact`

### Coordination structure
`coord` object usually contains arrays such as:
- `light`
- `main`
- `urgent`
- `research`
- `permit`
- `inspect`

### Framework / blueprint structure
The project dashboard/framework area stores project-specific structured notes, warnings, coordination, city/inspection/phase boxes, and imported framework information. It is UI-fragile and has been repeatedly reorganized; preserve data keys if found and avoid schema churn.

---

## Section 10 — Dashboard and Graph Panel

### What the graph dashboard reads
Primary sources:
- `weeklyData` for 52-week cashflow and accumulation views
- `projects` for project finance and exposure summaries
- `logs` for project activity / actuals
- `serviceLogs` for service-side contributions where applicable
- `settings` for overhead/targets and graph annotations

### Chart types and data sources
Observed/known graph areas:
- **52-Week Cash Flow Overview** — line/series chart using `weeklyData`
- **Exposure & Risk** — chart/card fed by project/service exposure summaries
- **Business-Linked Projections** — projections based on business targets, active buckets, and/or income calc refs
- other dashboard KPI charts depending on branch

### Known graph-specific regressions
1. **Graph Dashboard nav disappeared** even though panel/render code still existed.
   - Cause: nav items removed during UI refactor.
   - Fix: restore desktop sidebar item and mobile tab.
2. **Graph dashboard kept shrinking / zooming out**.
   - Cause: Chart.js responsive auto-resize loop inside hidden/shown panel.
   - Fix: explicit canvas sizing / locked render sizes.
3. **52-week cashflow chart became too thin**.
   - Cause: height reduced during graph stabilization.
   - Fix: restore taller proportions; latest file made it 1.5× taller.

### Current graph non-negotiables
- Graph panel nav must exist
- Graph panel must render after tab switch
- Chart canvases must not self-shrink
- 52-week cashflow height must remain readable

---

## Section 11 — Price Book Model

### Item structure
Each price book item typically contains:
- `id`
- `pid` or product ID
- `pidBlock`
- `pidBand`
- `name`
- `src`
- `cost` / `price`
- `unit`
- `category`
- `family`
- `link`
- optional notes / supplier preferences

### Category grouping logic
Price book and product ID system use material families and thousand-block grouping. Known intent:
- plastic boxes within one thousand-block
- metal boxes in another
- metal raceway/conduit in another
- non-metal conduit in another
- fittings grouped with respective raceway families
- breakers/panels/disconnects grouped together

### Product ID system (`pidBlock` / `pidBand`)
The matrix is open-ended and should continue sequence order within family bands. Functions involved:
- `normalizePIDName`
- `classifyPIDGroup`
- `nextIdInBlock`
- `getUsedProductIds`
- `assignMatrixIdToPriceBookItem`
- `integrateProductIdMatrix`

### Price book → MTO link
MTO rows may reference `matId` / linked price book items. Supporting functions include:
- `getPriceBookItemById`
- `ensureMTORowMatId`
- `editMTORowLinkedItem`
- `findOrCreatePriceBookEntry`

---

## Section 12 — Settings and Overhead Model

### All settings keys and purpose
See Section 2 `settings` schema.

### Overhead calculation logic
Implemented by `calcDerived()`.

Formula:
- `ess = sum(settings.overhead.essential.monthly)`
- `ext = sum(settings.overhead.extra.monthly)`
- `ln = sum(settings.overhead.loans.monthly)`
- `vh = sum(settings.overhead.vehicle.monthly)`
- `mo = ess + ext + ln + vh`
- `yr = mo * 12`
- `sal = settings.salaryTarget`
- `hrs = settings.billableHrsYear`
- `opYr = yr + sal`
- `cph = hrs > 0 ? opYr / hrs : 0`
- saved to `settings.opCost`

### Expense group semantics
- **essential** = recurring business essentials
- **extra** = software/tools/subscriptions
- **loans** = debt service
- **vehicle** = insurance/maintenance/registration for work vehicles

### Phase weight system
Stored at `settings.phaseWeights`. Used in:
- project hydration defaults
- progress percentages
- portfolio completion summaries
- home health and dashboard summaries

### Financial targets
- `dayTarget`
- `amBlock`
- `pmBlock`

These feed:
- trigger matrix
- dashboard KPI thinking
- owner revenue planning

---

## Section 13 — Backup/Export Format

### Standard export JSON
`exportData()` exports `JSON.stringify(S, null, 2)`.

So top-level keys exported are simply the current top-level keys of `S`, including at minimum:
- `theme`
- `settings`
- `calcRefs`
- `activeId`
- `projects`
- `employees`
- `weeklyData`
- `priceBook`
- `logs`
- `gcContacts`
- `serviceLeads`
- `serviceLogs`
- `taskSchedule`
- `agendaSections`
- `calOffset`
- `gcalCache`
- `gcalLastFetch`
- `triggerRules`
- `_schemaVersion`
- `_lastSavedAt`
- `view`
- any compatibility arrays / newer extension keys present

### Recovery bundle format
`exportRecoveryBundle()` exports:

```json
{
  "exportedAt": 1710000000000,
  "main": { ...main local state... },
  "mirror": { ...mirror local state... },
  "snapshots": [ ...snapshot objects... ],
  "meta": { ...save/import/snapshot metadata... }
}
```

### Intentionally excluded from standard export
Standard export does **not** include:
- undo history stack
- redo history stack
- local-only UI caches outside `S`
- provider credentials from localStorage

### Import / restore behavior
- imported payload is normalized
- `_lastSavedAt` and `_schemaVersion` are refreshed in `commitImportedState()`
- import writes main and mirror, with quota-fallback degradation:
  1. try normal write
  2. if quota: clear undo + snapshots, retry
  3. if still quota: clear mirror too, retry

### Compatibility requirements between versions
- never remove `serviceLogs`, `projects`, `logs`, `settings`, `weeklyData`
- always run imported state through `normalizeStateShape()`
- preserve legacy arrays even if lightly used
- if adding new keys, make them optional and normalize defaults

---

## Section 14 — Known Regressions and How They Were Fixed

This section is the institutional memory section. **Do not repeat these failures.**

### 1. Thinner remote snapshot replaced richer local state
- **Cause:** startup sync trusted newer timestamp only
- **Symptom:** service history looked lost after sync
- **Fix:** add richness guard (`isRemoteMateriallyThinner`) and preserve richer local state

### 2. Wrong Supabase defaults (`app_states` / `main`)
- **Cause:** Cloud Sync setup UI used stale defaults inconsistent with code
- **Symptom:** app loaded empty bucket; service history appeared gone
- **Fix:** normalize defaults to `app_state` / `poweron_v2`

### 3. iPad showed “Save Failed” while sync still worked
- **Cause:** localStorage quota pressure from snapshots + undo + backup writes
- **Symptom:** false failure badge despite successful cloud sync
- **Fix:** trim local caches for retry and soften save badge behavior

### 4. Service history vanished after collections experiments
- **Cause:** new branches changed state recovery path and/or trusted thin state
- **Fix:** revert to stable base; repair sync/recovery before adding new features

### 5. Service Unbilled click popup repeatedly failed / triggered Supabase 401
- **Cause:** UI action path depended on cloud read / brittle modal wiring
- **Fix:** abandon popup-on-KPI approach; use local-only collections queue within service panel

### 6. Collections Queue used stale payment labels instead of money math
- **Cause:** queue trusted `payStatus`
- **Symptom:** unpaid jobs showed partial or zero remaining
- **Fix:** derive queue rows from `collected`, rollup totals, and `serviceBalanceDue()`

### 7. Stephanie showed as partial with zero payment
- **Cause:** partial flag had precedence over real money values
- **Fix:** unpaid/full-balance-left takes precedence whenever `collected == 0`

### 8. Graph Dashboard disappeared again
- **Cause:** navigation entries removed while panel/render code still existed
- **Fix:** restore desktop sidebar and mobile tab nav IDs for `graphs`

### 9. Graph dashboard kept shrinking continuously
- **Cause:** Chart.js responsive resize loop in hidden/shown panel
- **Fix:** lock explicit chart/canvas sizes and stabilize render dimensions

### 10. 52-week cashflow overview became too thin
- **Cause:** chart stabilization pass reduced height too much
- **Fix:** restore old proportions; later increase height 1.5×

### 11. Job Health / home task-linked layouts looked good empty but broke when populated
- **Cause:** multi-box compact layout did not scale with real data density
- **Fix:** switch to single full-width task layout and compact but scalable home cards

### 12. Triggers tab became blank after rebuilds
- **Cause:** brittle render path and missing defensive fallbacks
- **Fix:** rebuild from stable base and make render tolerant of sparse data

### 13. Open Projects Exposure incorrectly included Coming Up projects
- **Cause:** finance summary lost project reference or failed bucket filtering
- **Fix:** explicitly filter through `resolveProjectBucket() === 'active'`

### 14. Collections queue / service history UI drifted from stable branch
- **Cause:** applying feature patches on top of broken branches
- **Fix:** always build new work on last stable confirmed branch, not on speculative rebuilds

### 15. Multiple-trip service tracking broke service history
- **Cause:** attempted model change interfered with existing service record assumptions
- **Fix:** defer full parent/child trip model; use additive ledger adjustments on existing service call ID instead

---

## Section 15 — Non-Negotiable Rules

- Never overwrite richer local state with thinner remote state.
- Never rebuild the service model wholesale unless the user explicitly agrees to a migration plan.
- Never remove undo/redo.
- Never remove snapshots.
- Never break Graph Dashboard nav.
- Collections Queue must always use money math, not stale labels.
- Open Projects Exposure only includes **Active** projects.
- Calendar must default to **week view**.
- All AI suggestions require user confirmation before saving when the change is speculative or architectural.
- Prefer **stable + simple** over **clever + fragile**.
- Build on the **last user-confirmed stable version**, not the most experimental file.
- Do not attach cloud reads to simple UI drill-downs when local state already has the needed data.

---

## Section 16 — Current Build Status (Updated March 28, 2026)

### Current phase
**Phase E (SPARK Full Automation) — NOT YET STARTED**

### Completed phases

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

### Latest version / filename
- **V2 React app** is now primary — auto-deployed via Netlify from `github.com/christiandubon01/poweron-hub`
- HTML reference baseline: **`poweron_v16j_cashflow_1_5x_taller.html`**

### Infrastructure status
- **Netlify deploy:** Working, auto-deploy from GitHub
- **Supabase:** Project `edxxbtyugohtowvslbfo` — all 27 migrations applied
- **Data sync:** Timestamp-only resolution, device ID system, force sync button
- **Multi-device sync:** Windows + iPhone syncing correctly via Supabase
- **API keys in Netlify:** `ANTHROPIC_API_KEY`, `VITE_ANTHROPIC_API_KEY`, `VITE_ELEVENLABS_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`

### What is working well
- local save + mirror backup + snapshots + undo/redo
- Supabase sync using `app_state / poweron_v2`
- richness guard preventing thin remote overwrite
- service history and collections queue with money-math rules
- service ledger adjustments: Add Expense / Add Mileage / Add Income
- home page compacted job health + service attention
- recent activity includes service logs
- graph dashboard nav restored
- calendar intended to remain on week default
- 52-week chart made taller for readability
- all 11 AI agents with real Claude integration and multi-turn conversation
- voice pipeline (Whisper + ElevenLabs + speechSynthesis fallback)
- cross-agent communication (16+ event types)
- MiroFish verification chain with approve/reject UI
- CHRONO smart scheduling, crew dispatch, idle slot detection
- auth (passcode + biometric)
- all TDZ production crashes resolved

### What is partially working / cautionary
- graph dashboard still needs careful handling because chart sizing is fragile
- framework/dashboard/project dashboard area is functional but layout-sensitive
- triggers tab and advanced analyzer paths are historically fragile
- multi-trip service handling is only partially addressed through ledger adjustments, not a full trip child-table model
- dark/light theme not switching correctly
- mobile AI agents: record/transcribe/think but no audio response on iPhone/iPad
- CFOT chart boxes (exposure, unbilled, pending, service, project, accumulative) not populating correctly

### What is known to be missing or still not ideal
- no full parent/child service trip system yet
- no true multi-user row-level sync; sync is still full-state snapshot based
- some reserved compatibility arrays remain underused but must stay for import compatibility
- `@ts-nocheck` on all v15r component files — TypeScript checking masked
- CSP in netlify.toml missing `api.openai.com` and `api.elevenlabs.io`
- graph dashboard full nav wiring in V2 unverified
- undo/redo service exists but layout wiring unverified
- snapshot system not confirmed wired into V2 Settings panel
- disconnect/test mode not confirmed in V2

### Known open items (queued for next prompt)
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

### Most recent changes (prior to Phase E)
- Fixed 5 production-only TDZ crashes (V15rLayout.tsx, supabase.ts, stripe.ts, session.ts, authStore.ts)
- Fixed lucide-react forwardRef crash (vite.config.ts manualChunks)
- Completed Phase D (CHRONO Automation) — scheduling, dispatch, idle detection, conflict alerts, calendar sync
- Completed Phase C (MiroFish Verification) — 5-step chain, proposal queue, audit trail
- Completed Phase B (Cross-Agent Communication) — event bus, data bridge, agent pipelines
- Completed Phase A (Intelligence Layer) — Claude proxy, all 11 agents, voice pipeline, NEXUS classifier
- Cleaned up git history (removed node_modules from tracking)
- TypeScript type check passes (tsc --noEmit = 0 errors)

---

## Section 17 — Integration Points for V2 React App

### Overall strategy
The React V2 app is now the primary deployed app. It uses the same data contract as the HTML app — same JSON export/import format, same Supabase `app_state` table and `poweron_v2` key. Both apps remain import/export compatible.

### React component mapping to HTML render functions
Suggested mapping:

| React component | HTML render function / area |
|---|---|
| `HomePage` | `renderHome()` |
| `ProjectsPage` | `renderProjects()` |
| `EstimatePage` | `renderEstimate()` |
| `FieldPage` | field panel, including `renderServiceLogs()` and trigger views |
| `ProgressPage` | `renderProgress()` |
| `DashboardPage` | project dashboard/framework render path |
| `MTOPage` | `renderMTO()` |
| `RFIPage` | `renderRFI()` |
| `CoordinationPage` | `renderCoord()` |
| `PriceBookPage` | price book render path |
| `MoneyPage` | money rollup render path |
| `GraphsPage` | graph dashboard render path |
| `IncomeCalcPage` | income calc / `calcRefs` UI |
| `LeadsPage` | leads render paths |
| `TeamPage` | employees/team render path |
| `TemplatesPage` | templates render path |
| `IntelligencePage` | intelligence panel if retained |
| `SettingsPage` | settings render path |

### `backupDataService.ts` mapping guidance
No TypeScript source was provided in this workspace, so this section is conceptual and should be implemented to mirror the HTML export format.

Recommended mapping in `backupDataService.ts`:
- `backup.settings` ↔ `S.settings`
- `backup.calcRefs` ↔ `S.calcRefs`
- `backup.projects` ↔ `S.projects`
- `backup.employees` ↔ `S.employees`
- `backup.weeklyData` ↔ `S.weeklyData`
- `backup.priceBook` ↔ `S.priceBook`
- `backup.logs` ↔ `S.logs`
- `backup.gcContacts` ↔ `S.gcContacts`
- `backup.serviceLeads` ↔ `S.serviceLeads`
- `backup.serviceLogs` ↔ `S.serviceLogs`
- `backup.taskSchedule` ↔ `S.taskSchedule`
- `backup.agendaSections` ↔ `S.agendaSections`
- `backup.gcalCache` / `backup.gcalLastFetch` / `backup.calOffset` ↔ calendar state
- `backup.triggerRules` ↔ trigger matrix
- include `_schemaVersion` and `_lastSavedAt`

### Export format bridge between HTML and React
Both apps should support the same canonical backup JSON:
- import any HTML backup into React
- export React state in HTML-compatible shape
- always normalize optional arrays/keys on import

### Sharing the same Supabase project
Both apps can share the same Supabase project **if and only if**:
- they use the same table name (`app_state`)
- they agree on the same `state_key` (`poweron_v2`) or a deliberately versioned alternative
- they preserve the full-state snapshot contract while the HTML app remains in use

Recommended transitional approach:
- React app uses a different state key during development, e.g. `poweron_v2_react_dev`
- once validated, either:
  - migrate to the same key intentionally, or
  - build an explicit one-time migration utility

### Migration status
React V2 is now the deployed source of truth. It meets all migration requirements:
- imports/exports HTML backups using the same JSON format
- preserves service ledger adjustments correctly
- preserves graph dashboard data inputs
- preserves sync guard behavior
- preserves money-math collections rules
- multi-device sync verified (Windows + iPhone)

---

## Appendix — Stable source files worth preserving

Highest-value reference files in this workspace:
- `poweron_v15u_stable_sync_richness_guard.html` — stable sync guard baseline
- `poweron_v15r_collections_actions_updated.html` — stable service collections action branch
- `poweron_v16g_graph_dashboard_nav_restored.html` — graph nav repair baseline
- `poweron_v16h_graph_dashboard_shrink_fix.html` — graph shrink fix baseline
- `poweron_v16j_cashflow_1_5x_taller.html` — latest graph height baseline

## Appendix — Final guidance to any successor model

1. Read **both** `poweron_app_handoff_spec.md` and `poweron_v2_handoff_complete.md` before any work.
2. The **V2 React app** is the primary codebase. The HTML file is a stable reference only.
3. Current phase is **Phase E (SPARK Full Automation)** — Phases A through D are complete.
4. Patch narrowly. Preserve state shape.
5. Verify nav, sync, collections, and graphs after every change.
6. Prefer additive enhancements over rewrites.
7. If a change touches `serviceLogs`, `sync`, `nav`, or `graphs`, treat it as high-risk.
8. Check the **Known open items** list in Section 16 for the current work queue.

---

## B46–B51 Wave Summary — April 7 2026

**Version promoted to:** V3.0 Production
**Sessions completed:** B41–B50 (B51 files included in this wave)
**Commit references:** B47=2a31db6 · B48=adf4537 · B49=7d80579 · B50=0a0d6db

### New Files Added

- `src/components/v15r/AIVisualSuite/` — Full AI Visual Suite folder (15+ files, 43 modes, 3 buckets)
- `src/components/v15r/WinsLog/` — Wins Log component (B51)
- `supabase/migrations/059_hub_platform_events.sql` — Hub Platform Events migration
- `supabase/migrations/060_wins_log.sql` — Wins Log migration (B51)
- `supabase/migrations/061_guardian_config.sql` — GUARDIAN Config migration (B51)
- `POWERON_WORKFLOW.md` — Workflow rules document

### New Supabase Tables

- `hub_platform_events` — Command Center / Hub Platform event tracking
- `wins_log` — Wins Log feature (B51)
- `guardian_config` — GUARDIAN configuration table (B51)

### AI Visual Suite

- 43 visual modes across 3 buckets
- QuantumFoam established as the NEXUS default mode
- `useNEXUSAudio` hook implemented — live FFT data wired to visuals
- Standalone VISUAL SUITE panel added to navigation

### Command Center

- Tab 12 (Split View): live
- Tab 13 (Unified Command): live

### Navigation & Layout

- VISUAL SUITE available as standalone nav panel
- Visualization Lab accessible via admin route
- NEXUS Voice integrated into sidebar
- Collapsible sidebar implemented
- Responsive layout improvements across breakpoints

### Known Remaining Items

- DaSparkyHub Session 2: pending
- Beta prep: pending

### Build Status at Close of Wave

- `npm run build`: ✅ PASS — zero TypeScript errors, zero Vite errors
- AI Visual Suite (43 modes, QuantumFoam default): ✅ Live
- Command Center tabs 12+13 (Split View + Unified Command): ✅ Live
- Audio pipeline (useNEXUSAudio, FFT→visuals): ✅ Live
- All lazy-loaded views: ✅ Present as separate chunk files in dist/
