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
| EVR-8Week-Audit (this agent) | Graph Dashboard EVR + 8-Week Cash Flow Projection Audit/Redesign | src/components/v15r/V15rDashboard.tsx, src/components/v15r/charts/EVRChart.tsx, src/components/v15r/charts/SVGCharts.tsx, src/services/revenueTimelineService.ts | DONE — awaiting user review (not committed) | RELEASED | 2026-06-23 |
| 8Week-DateLogic-Hover (this agent) | 8-Week Cash Flow Projection Date Logic + Hover Usability | src/services/revenueTimelineService.ts, src/components/v15r/charts/SVGCharts.tsx, src/components/v15r/V15rDashboard.tsx (labels only if needed) | IN PROGRESS | ACTIVE | 2026-06-23 |
| Codex-Palm-Desert-Aura-Probe | Palm Desert Salesforce/Aura Permit Probe | netlify/functions/city-scraper.ts, AGENT_SHARED_CONTEXT.md | DONE — local live probe passed | RELEASED | 2026-06-24 |
| Codex-Palm-Desert-Aura-Dry-Run | Palm Desert Aura Dry-Run Importer | netlify/functions/city-scraper.ts, AGENT_SHARED_CONTEXT.md | DONE — local live dry run passed | RELEASED | 2026-06-24 |
| Codex-Palm-Desert-Aura-Controlled-Importer | Palm Desert Aura Controlled Importer | netlify/functions/city-scraper.ts, AGENT_SHARED_CONTEXT.md | DONE — safe paths verified, write not invoked | RELEASED | 2026-06-24 |
| Codex-Permit-Lead-Title-Fallback | Imported Permit Lead Title Fallback | src/components/hunter/HunterLeadCard.tsx, AGENT_SHARED_CONTEXT.md | DONE — title fallback implemented | RELEASED | 2026-06-24 |
| Codex-Palm-Desert-Geocode-Backfill | Palm Desert Imported Lead Map Coordinates | netlify/functions/city-scraper.ts, AGENT_SHARED_CONTEXT.md | DONE — guarded backfill dry-run passed | RELEASED | 2026-06-24 |
| App-Phase1-Lead-Notify | Internal lead notification + attribution capture | src/views/CustomerPortalView.tsx, netlify/functions/notify-new-lead.ts, netlify/functions/portal-confirm-email.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ | RELEASED | 2026-06-24 |
| Step12B-Hide-Lighting-Effects (this agent) | Blueprint Viewer — Hide Lighting Effects toggle | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12C-Free-Line-Endpoints (Cursor) | Blueprint Viewer — Free Line Endpoint Editing | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12D-Guide-Assist (Cursor) | Blueprint Viewer — Alignment Guide Helper | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12D-R-Guide-Assist-Repair (Cursor) | Blueprint Viewer — Repair Guide Assist placement flow | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12D-R2-Move-Guide-Assist (Cursor) | Blueprint Viewer — Guide Assist while moving existing shapes | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12E-Electrical-Symbols (Cursor) | Blueprint Viewer — Electrical Symbols Foundation | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12E-R-Electrical-Symbol-Polish (Cursor) | Blueprint Viewer — Electrical Symbols Visual Polish | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12E-R2-Switch-Dimmer-Labels (Cursor) | Blueprint Viewer — Switch/Dimmer Polish + Electrical Label Toggle | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12F-Fixed-Blueprint-Colors (Cursor) | Blueprint Viewer — Add 25 Fixed Blueprint Colors | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, src/components/blueprint/ToolPopover.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12E-R3-Switch-Dimmer-Vertical-Line (Cursor) | Blueprint Viewer — Switch/Dimmer Vertical Line Polish | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step12G-Electrical-Opacity-Fix (Cursor) | Blueprint Viewer — Electrical Symbol Opacity + New Shape Defaults | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13A-Symbol-Metadata (Cursor) | Blueprint Viewer — Symbol Metadata Foundation | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-Scope-Layers (Cursor) | Blueprint Viewer — Scope Layers / Work Packages Foundation | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-R-Work-Package-Repair (Cursor) | Blueprint Viewer — Repair Work Package Selection and Save | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-S1-Header-Save-Safety (Cursor) | Header Save — Remote Freshness Guard + Localhost Warning | src/services/backupDataService.ts, src/components/v15r/V15rLayout.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-S1-R-Fail-Closed (Cursor) | Header Save — Fail Closed When Freshness Unverified | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-S2-Header-Save-Snapshot (Cursor) | Header Save — Safety Snapshot Before Overwrite | src/services/backupDataService.ts, src/services/snapshotService.ts, src/components/v15r/V15rLayout.tsx, src/components/SnapshotPanel.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-S3-Sync-Stale-Guard (Cursor) | Cloud Sync — Stale Full-Backup Overwrite Guard | src/services/backupDataService.ts, src/components/v15r/V15rLayout.tsx, src/components/SnapshotPanel.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-S3-R-Baseline-Guard (Cursor) | Cloud Sync — Remote Baseline Stale Edit Guard | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-P-Scope-Layers-Persist (Cursor) | Blueprint Work Packages — Persist Scope Layers | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, src/services/blueprintLibraryService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-P-R-Scope-Layers-Remote-Merge (Cursor) | Work Package Save — Merge Scope Layers Into Latest Remote | src/services/backupDataService.ts, src/services/blueprintLibraryService.ts, src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-I-Scope-Layer-Isolate (Cursor) | Work Package — Canvas Isolate Toggle | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-QA1-Fullscreen-Shapes-Save (Cursor) | Blueprint QA — Fullscreen Controls, Shapes Menu, S3/S4, Save Notice | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, src/components/blueprint/ToolPopover.tsx, src/services/blueprintLibraryService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-QA1-R-Light-Glare-All-Lights (Cursor) | Blueprint — Light Output/Glare for All Light Symbols | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-06-30 |
| Step13B-QA1-HOTFIX (Claude Code Sonnet 4.6) | Blueprint Viewer — Fix `clearStaleSyncMessages` TDZ Runtime Crash | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA2-Center-Guide-Assist (Claude Code Sonnet 4.6) | Blueprint Viewer — Center-to-Center Guide Assist Repair | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA3-Zoom-Rotation-Arc-S3S4 (Claude Code Sonnet 4.6) | Blueprint Viewer — Zoom to 1000%, Symbol Rotation, Arc-Line Overlay Placement, S3/S4 Visual Polish | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA4-Arc-Measure-Compact-Symbols (Claude Code Sonnet 4.6) | Blueprint Viewer — Arc Line Final Shape, Measure Tool, Compact Symbol Selection Bounds | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, src/services/blueprintLibraryService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA5-MultiPoint-Circuit-Polyline-Measure (Claude Code Sonnet 4.6) | Blueprint Viewer — Multi-Point Circuit Path, Polyline, Multi-Point Measure | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA5-R-Measure-Finalize-Circuit-Distance-Sync-Spam (Claude Code Sonnet 4.6) | Multi-Point Measure Finalize + Circuit Distance + Sync Spam Repair | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, src/services/backupDataService.ts, src/components/v15r/V15rLayout.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA5-R2-Open-MultiPoint-Measure-Path (Claude Code Sonnet 4.6) | Multi-Point Measure — Open Path Repair (finalized polygon→polyline) | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA5-R3-Sync-Failed-Status-Clear (Claude Code Sonnet 4.6) | Header Sync Status — Clear Failed/Blocked State After Successful Sync | src/components/v15r/V15rLayout.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA5-R4-Cloud-Paused-Status (Claude Code Sonnet 4.6) | Header Sync Status — Quiet "Cloud Paused" State for Remote-Newer Guard Blocks | src/components/v15r/V15rLayout.tsx, src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA5-R4B-Blueprint-Banner-Spam-ConflictCode (Claude Code Sonnet 4.6) | Blueprint Banner De-Spam + conflictCode Classification + 20min Source Dedupe | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, src/components/v15r/V15rLayout.tsx, src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA6-Annotation-List-Dot-Color (Claude Code Sonnet 4.6) | Blueprint Viewer — Match Annotation List Dot Color to Placed Shape Color | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-iPad-Viewport-1000-Zoom (Claude Code) | Blueprint Viewer — Repair Default/Fullscreen Viewport After 1000% Zoom (canvas raster cap + CSS zoom remainder) | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-R-iPad-Layout-Restore (Claude Code) | Blueprint Viewer — Keep annotations at bottom on iPad default mode (remove tablet-only xl side column), preserve QA7 raster cap | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-R2-iPad-Fullscreen-Stacked (Claude Code) | Blueprint Viewer — Robust tablet detection so iPad fullscreen renders stacked layout, never desktop 3-column | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-R3-Emergency-Layout-Override (Claude Code) | Blueprint Viewer — Fix maxTouchPoints>1 emulation gap + hard override: three-pane never renders on tablet/immersive | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-R4-Fullscreen-Containment (Claude Code) | Blueprint Viewer — Fullscreen root was position:relative (fixed+relative class conflict); inline fixed containment + default scroll-area viewport clamp | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-R5-Fullscreen-WorkScreen (Claude Code Opus) | Blueprint Viewer — Fullscreen: document fills the screen, annotations moved BELOW the work screen (internal vertical scroller) | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-R6-Fullscreen-Scroll-Handle (Claude Code Opus) | Blueprint Viewer — Custom overlay scroll handle for the fullscreen vertical scroller (touch + hover-widen, zero layout impact) | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |

---

## Active File Locks (current)

| Agent | Feature Area | Files | Mode | Status | Claimed |
|---|---|---|---|---|---|
| Codex-Phase6B-CO-Scoped-Merge | Project Change Orders item-level scoped merge | src/services/projectScopeMerge.ts, src/components/v15r/V15rChangeOrdersTab.tsx, src/services/scopeRegistry.ts, src/services/backupDataService.ts, src/components/v15r/V15rDashboard.tsx, AGENT_SHARED_CONTEXT.md | DONE - typecheck PASS, build PASS, localhost blocked by logged-out/demo-readonly state | RELEASED | 2026-07-04 |
| Codex-Phase6H-Materials-Scoped-Merge | Project Materials / MTO item-level scoped merge | src/services/projectScopeMerge.ts, src/components/v15r/V15rMTOTab.tsx, src/services/scopeRegistry.ts, src/services/backupDataService.ts, src/services/mtoExportService.ts, src/components/v15r/V15rEstimateTab.tsx, AGENT_SHARED_CONTEXT.md | DONE - typecheck PASS, build PASS, diff-check PASS, localhost manual test blocked by browser policy | RELEASED | 2026-07-04 |
| Step13D-SoftGuide-HDMI-LabelSize (Claude Opus 4.8) | Blueprint Viewer — soft (visual-only) Guide Assist, HDMI/Data symbols, Symbols Size label-scale popup | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-02 |
| ProjectLogs-Fix-LogsKey (Claude Opus 4.8) | Project/Field Logs — mark 'logs' changed key so production merge preserves new entries | src/components/v15r/V15rProjectLogsTab.tsx, src/components/v15r/V15rFieldLogPanel.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-02 |
| Step13C-R2-Reorder-Packages (Claude Opus 4.8) | Blueprint Viewer — drag + up/down reorder of Work Package / Scope Layer cards | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-02 |
| Step13C-R1-Smoke-PickHighlight (Claude Opus 4.8) | Blueprint Viewer — redesign Smoke Alarm glyph + on-canvas Package Pick highlight | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed, now COMMITTED a9a8296) | RELEASED | 2026-07-02 |
| Step13C-Package-Speed-Symbols (Claude Opus 4.8) | Blueprint Viewer — Package Pick mode (+LeftControl toggle), Work Package add/remove items, Smoke/CO Alarm symbols, multi-package visibility | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-02 |
| Step13B-QA9-Production-Sync-Guard (Claude Opus 4.8) | Multi-device sync guard — localhost block only, production merge-before-save | src/services/backupDataService.ts, src/services/blueprintLibraryService.ts, src/components/v15r/V15rLayout.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA8-Zoom-Symbol-Audit (Claude Opus 4.8) | Blueprint Viewer — zoom/symbol coordinate audit + fix | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13B-QA7-R7-Default-Annotations (Claude Code Opus) | Blueprint Viewer — default/embedded iPad annotations panel: expand naturally below document, not collapsed/capped drawer | src/components/blueprint/OperationsBlueprintPdfViewer.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-01 |
| Step13E-Emergency-Prod-Sync-Rollback (Claude Opus 4.8) | Emergency rollback — neutralize ad30ad4 production merge/freshness guard so production saves upload normally; localhost/dev stale-overwrite guard unchanged | src/services/backupDataService.ts, src/components/v15r/V15rLayout.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (NOT committed) | RELEASED | 2026-07-03 |
| Phase2-Stop-Bleeding-Stale-Save-Block (Claude Opus 4.8) | Re-enable stale-save freshness BLOCK on production + localhost (no auto-merge); supersedes Step 13E production ungating | src/services/backupDataService.ts, src/components/v15r/V15rLayout.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ diff-check ✅ (COMMITTED b37a034) | RELEASED | 2026-07-03 |
| Phase4-Verified-Save-Readback (Claude Opus 4.8) | Header Save now requires cloud read-back verification; baseline advances only from verified read-back; production sync-conflict UI gate fixed | src/services/backupDataService.ts, src/components/v15r/V15rLayout.tsx, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (COMMITTED 163d579) | RELEASED | 2026-07-03 |
| Phase4B-Baseline-Server-UpdatedAt (Claude Opus 4.8) | Fix false stale-block after successful write — syncToSupabase baselines from Supabase server updated_at returned by upsert, not client now | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (COMMITTED 248711f) | RELEASED | 2026-07-03 |
| Phase4D-ForceSync-Baseline-Poison-Fix (Claude Opus 4.8) | Remove redundant client-time baseline overwrite in forceSyncToCloud that re-poisoned the server baseline set by syncToSupabase | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (NOT committed) | RELEASED | 2026-07-03 |
| Phase4F-Verified-Save-False-Mismatch-Fix (Claude Opus 4.8) | Fix verified-save false mismatch — expected summary from post-sync payload, bounded read-back retry, timestamp-lag no longer becomes data mismatch | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (NOT committed) | RELEASED | 2026-07-03 |
| Phase4G-Sync-Block-Diagnostics (Claude Opus 4.8) | DIAGNOSTIC ONLY — temporary console logging around the stale/freshness guard + baseline to root-cause the persistent false stale-block. No fix, no behavior change. | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (COMMITTED a973c73) | RELEASED | 2026-07-03 |
| Phase4H-Monotonic-Baseline-SameDevice-Allowance (Claude Opus 4.8) | Monotonic remote baseline (older realtime/load/sync rows can't move it backward) + same-device local-newer allowance in the freshness guard. Stale other-device saves still block. Phase 4G diagnostics kept. | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (COMMITTED 2ff28de) | RELEASED | 2026-07-04 |
| Phase4I-Remove-Sync-Diagnostics (Claude Opus 4.8) | CLEANUP ONLY — remove temporary Phase 4G/4H [POWERON_*] console diagnostics + __POWERON_SYNC_DEBUG__ helper. Behavior unchanged. | src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (COMMITTED 6e74bf2) | RELEASED | 2026-07-04 |
| Phase5A-Scope-Registry-Scaffold (Claude Opus 4.8) | Add typed DataScope registry + legacy changedKey→scope map + resolver helpers + dev-only unscoped-save warning. NO scoped merge, NO tab changes, NO save/stale/baseline behavior change. | src/services/scopeRegistry.ts (new), src/services/backupDataService.ts, AGENT_SHARED_CONTEXT.md | DONE — typecheck ✅ build ✅ (NOT committed) | RELEASED | 2026-07-04 |

## Audit & Change Log

### 2026-07-06 — Phase 6R-C UI Hotfix 2: Field Log Action Row Layout + Red Delete (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** UI hotfix 2 on uncommitted 6R-C — same-row action layout for service log cards.
**Branch:** main | NOT committed | NOT pushed

**Changes:**
- **`V15rFieldLogPanel.tsx`**: moved Edit / Archive / Delete into the bottom action row on the far right (same height as Paid / +Expense / +Mileage / +Income / Convert to Estimate); Delete now uses red danger styling (`bg-red-500/15 border-red-500/30 text-red-300`).

**Untouched:** Service calculations; 6R-C scoped merge; adjustment description rendering; click handlers.

**Lock released.**

---

### 2026-07-06 — Phase 6R-C UI Hotfix: Field Log Service Call Layout + Adjustment Descriptions (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** UI hotfix on uncommitted 6R-C — Field Log service call card layout + adjustment description display.
**Branch:** main | NOT committed | NOT pushed

**Changes:**
- **`V15rFieldLogPanel.tsx`**: moved Edit / Archive / Delete to the right-side totals column (below quote/lab/mat/mi totals) on service log entries, Open Estimates, and Active Service Calls; financial workflow buttons (Paid, +Expense, +Mileage, +Income, Convert to Estimate, Confirm Job, Mark Lost, Log as Complete) remain on the lower-left action row. Expense/Mileage/Income adjustment line items in the ledger rollup now render saved `desc` (with fallback to description/note/notes/memo/label/title).

**Untouched:** 6R-C scoped merge/sync behavior; calculations; adjustment save shape (`adjustments[].desc` already persisted).

**Lock released.**

---

### 2026-07-06 — Phase 6R-C: service.multiDayCalls Scoped Merge (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Scoped implementation — protect multiDayServiceCalls / ServiceCallsV2 from stale broad-save overwrite.
**Branch:** main | Baseline HEAD = `9ef7f75` (Add scoped merge for home agenda alerts) | NOT committed | NOT pushed

**Changes:**
- **`scopeRegistry.ts`**: added `service.multiDayCalls` scope for `BackupData.multiDayServiceCalls[]` (id-merge with tombstones, high priority); legacy changedKey mappings `service.multiDayCalls`, `multiDayServiceCalls`, `ServiceCallsV2`. Existing `service.calls` scope untouched.
- **`backupDataService.ts`**: added `BackupMultiDayServiceCall` type + `multiDayServiceCalls?` on `BackupData`; added `isServiceMultiDayCallsSyncSource` and narrow pre-sync preservation fold calling `mergeRemoteMultiDayServiceCallsIntoOutgoing` on non-service.multiDayCalls saves.
- **`serviceScopeMerge.ts`**: added multi-day service call merge helpers — getMultiDayServiceCallId, stampMultiDayServiceCall, createMultiDayServiceCallTombstone, isDeletedMultiDayServiceCall, getLiveMultiDayServiceCalls, mergeMultiDayServiceCallRecords, mergeMultiDayServiceCallsIntoRemote, mergeRemoteMultiDayServiceCallsIntoOutgoing.
- **`serviceCallService.ts`**: `saveServiceCallRecords` now stamps stable ids + createdAt/updatedAt before writing.
- **`V15rServiceCallsV2.tsx`**: persist converted to optimistic local save + `saveMultiDayServiceCallsScoped` (fetch latest remote → mergeMultiDayServiceCallsIntoRemote → saveBackupWithRemoteBaselineSync); active UI reads via getLiveMultiDayServiceCalls.

**Untouched:** service.calls (serviceLogs/serviceEstimates/activeServiceCalls); project scopes; home.agendaAlerts; estimate scopes; team/weekly/blueprint scopes; sync/save/baseline core except narrow multiDayServiceCalls preservation hook.

**Lock released.**

---

### 2026-07-06 — Phase 6S-G Follow-up Hotfix: Guardian customAlerts Scoped Save (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Hotfix on uncommitted 6S-G — convert remaining Guardian customAlerts writer to home.agendaAlerts scoped save.
**Branch:** main | NOT committed | NOT pushed

**Changes:**
- **`backupDataService.ts`**: extracted shared `saveHomeAgendaAlertsScoped(incomingBackup, { source })` for V15rHome + Guardian.
- **`src/agents/guardian/index.ts`**: `routeGuardianAlerts` now stamps alerts via `stampCustomAlert` and saves through `saveHomeAgendaAlertsScoped(..., { source: 'home-agenda-alerts-guardian-remote-merge' })` with `changedKey: 'home.agendaAlerts'`.
- **`V15rHome.tsx`**: reuses shared `saveHomeAgendaAlertsScoped` helper (behavior unchanged).

**Untouched:** Computed Nexus alerts (render-time only); GuardianMetricsService (read-only); V15rHome agenda/custom alert CRUD semantics; AI dismiss suppression behavior.

**Lock released.**

---

### 2026-07-06 — Phase 6S-G: home.agendaAlerts Scoped Merge (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Scoped implementation — protect Home agenda sections and custom alerts from stale full-blob overwrite.
**Branch:** main | Baseline HEAD = `a1d419c` (Add scoped merge for estimate versions) | NOT committed | NOT pushed

**Changes:**
- **`scopeRegistry.ts`**: added `home.agendaAlerts` scope for `BackupData.agendaSections[]` + `BackupData.customAlerts[]` (id-merge with tombstones, medium priority); legacy changedKey mappings `home.agendaAlerts`, `agendaSections`, `customAlerts`.
- **`backupDataService.ts`**: extended `BackupAgendaSection` / `BackupCustomAlert` types with optional id/timestamp/tombstone metadata; added `isHomeAgendaAlertsSyncSource` and narrow pre-sync preservation fold calling `mergeRemoteHomeAgendaAlertsIntoOutgoing` on non-home.agendaAlerts saves (reuses existing remote fetch; never blocks save).
- **`projectScopeMerge.ts`**: added Home agenda/custom alert merge helpers — normalizeHomeId, stamp helpers, tombstone creators, getLiveAgendaSections/getLiveCustomAlerts, mergeAgendaItemArrays/mergeAgendaSections/mergeCustomAlerts, mergeHomeAgendaAlertsIntoRemote, mergeRemoteHomeAgendaAlertsIntoOutgoing.
- **`V15rHome.tsx`**: agenda/custom alert writers converted to optimistic local save + `saveHomeAgendaAlertsScoped` (fetch latest remote → mergeHomeAgendaAlertsIntoRemote → saveBackupWithRemoteBaselineSync); deletes use tombstones; UI reads via getLiveAgendaSections/getLiveCustomAlerts.

**Untouched:** Home Job Health deleted-project filter; Service Jobs Requiring Attention filter; auto-generated Nexus agenda alerts (project/service derived); project.timeline/progress/schedule/coordination; project.estimate/project.estimateVersions; project.finance; finance.weeklyData; team.members; service scopes; sync/save/baseline core except narrow home.agendaAlerts preservation hook.

**Lock released.**

---

### 2026-07-06 — Phase 6S-F FINAL TINY HOTFIX: Snapshot Rename Clear Persists (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Tiny hotfix on uncommitted 6S-F — clearing a renamed snapshot title must persist across merge.
**Branch:** main | NOT committed | NOT pushed

**Changes:**
- **`projectScopeMerge.ts`**: `mergeEstimateVersionPair` now uses `hasOwnProperty` for `name`/`notes` so the metadata-newer side wins even when value is explicit `''`; prevents older remote name from resurrecting after clear.
- **`V15rEstimateTab.tsx`**: rename save stores `name: ''` when user clears title (no longer converts to `undefined`).

**Untouched:** Restore preview modal, Rename/Restore/Delete handlers (except rename clear save), restore/delete logic, laborRows/ohRows payload, scoped save path.

**Lock released.**

---

### 2026-07-05 — Phase 6S-F HOTFIX 3: Restore Preview Modal Full Row Details (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Hotfix on uncommitted 6S-F — restore preview modal shows full row details.
**Branch:** main | NOT committed | NOT pushed

**Changes:**
- **`V15rEstimateTab.tsx`**: Restore preview modal now shows full row details instead of label-only rows. Labor preview rows show Entry, Employee, Phase, Hours, Rate, Total. Changed rows show Current vs Snapshot side-by-side blocks. Removed rows show current details; restored rows show snapshot details. Overhead rows show Entry, Qty, Cost, Price, Total, and Notes when available.

**Untouched:** Restore logic, tombstone logic, Rename/Restore/Delete behavior, scoped save behavior, estimateVersions merge helpers.

**Lock released.**

---

### 2026-07-05 — Phase 6S-F HOTFIX 2B: Restore Preview Modal (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Hotfix on uncommitted 6S-F — Restore opens preview modal before applying authoritative restore.
**Branch:** main | NOT committed | NOT pushed

**Changes:**
- **`V15rEstimateTab.tsx`**: Restore button opens preview modal (no immediate restore); modal compares current live labor/OH rows vs snapshot with badges Will be removed / Will be restored / Will change; summary counts; Cancel + Restore Snapshot footer; only Restore Snapshot calls authoritative restore; Rename/Delete unchanged; Edit removed.

**Untouched:** SnapshotPanel full snapshots; contract/mileRT/miDays; laborPhaseColors; sync/baseline core.

**Lock released.**

---

### 2026-07-05 — Phase 6S-F HOTFIX 2: Rename / Restore / Delete Snapshot Buttons (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Hotfix on uncommitted 6S-F — simplify snapshot actions to Rename / Restore / Delete.
**Branch:** main | NOT committed | NOT pushed

**Changes:**
- **`V15rEstimateTab.tsx`**: removed Edit/details button; button order is Rename | Restore | Delete; Rename only updates `version.name` via `updateEstimateVersionName` (notes/payload preserved); Delete confirms then tombstones via `createEstimateVersionTombstone` + `saveEstimateVersionsScoped`; UI filters deleted via `getVisibleEstimateVersions`; restore behavior from prior hotfix unchanged.

**Untouched:** SnapshotPanel full snapshots; live estimate rows; contract/mileRT/miDays; laborPhaseColors; sync/baseline core.

**Lock released.**

---

### 2026-07-05 — Phase 6S-F HOTFIX: Authoritative Restore + Version Metadata (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Hotfix on uncommitted 6S-F — restore must tombstone rows added after selected snapshot; add rename/edit metadata.
**Branch:** main (no branch switch) | NOT committed | NOT pushed

**Root cause:** `reconcileLaborReplacement` / `reconcileOverheadReplacement` compared row identities using replacement-only context, so live rows could miss tombstoning when stable IDs differed between snapshot copies and live `p.laborRows`. Restore also relied on debounced async row save without immediate local persist or explicit draft reset — UI draft (`laborDraftRows`) could keep rows visible after restore.

**Fix:**
- **`V15rEstimateTab.tsx`**: authoritative reconcile uses combined existing+replacement identity context; restored rows stamped `updatedAt: now` (clears `deletedAt`); live rows absent from snapshot get `createLaborRowTombstone` / `createOverheadRowTombstone` with `now`; restore resets draft refs + `setLaborDraftRows`/`setOverheadDraftRows`; `persistEstimateRowsSnapshotLocal` + `saveEstimateRowsScoped(..., 0)`; updated confirm text; `saveEstimateVersionsScoped` helper; Rename/Edit buttons via `prompt()` updating `name`/`notes` only (payload immutable); display via `getEstimateVersionDisplayLabel`.
- **`projectScopeMerge.ts`**: `mergeEstimateVersionPair` preserves `laborRows`/`ohRows` payload, LWW-merges `name`/`notes` by `updatedAt`; exported `getEstimateVersionDisplayLabel`.
- **`backupDataService.ts`**: `BackupEstimateVersion.name?` / `notes?` documented on type.

**Untouched:** SnapshotPanel full restore; project.estimate scalar/color save paths except restore reconcile; timeline/progress/schedule/coordination/finance/service/team scopes.

**Lock released.**

---

### 2026-07-05 — Phase 6S-F: project.estimateVersions Scoped Merge (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Scoped implementation — protect Estimate tab saved version history from stale full-blob overwrite.
**Branch:** main | HEAD before edits = `0d22f02` (Add scoped merge for labor phase colors)
**Files changed:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rEstimateTab.tsx`, `AGENT_SHARED_CONTEXT.md`

**What was implemented:**
- **`scopeRegistry.ts`**: added `project.estimateVersions` scope (id-merge, high priority); legacy changedKey mappings `project.estimateVersions` and `estimateVersions`.
- **`backupDataService.ts`**: added `BackupEstimateVersion` type and `BackupData.estimateVersions`; added `isProjectEstimateVersionsSyncSource` and narrow pre-sync preservation fold calling `mergeRemoteEstimateVersionsIntoOutgoing` on non-project.estimateVersions saves (reuses existing remote fetch; never blocks save).
- **`projectScopeMerge.ts`**: added `getEstimateVersionIdentity`, `ensureEstimateVersionIdentity`, `isDeletedEstimateVersion`, `createEstimateVersionTombstone`, `mergeEstimateVersionArrays`, `getVisibleEstimateVersions`, `mergeEstimateVersionsIntoRemote`, `mergeAllEstimateVersionsIntoRemote`, and `mergeRemoteEstimateVersionsIntoOutgoing` — id-merge with tombstone support; max 5 visible non-deleted versions per project.
- **`V15rEstimateTab.tsx`**: `saveEstimateVersion` now stamps `versionId`/`createdAt`/`updatedAt`, saves locally for instant UI, then fetch-latest → `mergeEstimateVersionsIntoRemote` → `saveBackupWithRemoteBaselineSync({ changedKey: 'project.estimateVersions', _scopes: ['project.estimateVersions'] })`; fallback `saveBackupDataAndSync`. Version list uses `getVisibleEstimateVersions`. Restore confirm warns about multi-device overwrite.

**Explicitly NOT done / deferred:** SnapshotPanel full restore (intentionally destructive, unchanged). `backup.snapshots` embedded snapshots. localStorage `poweron_snapshots`. `importBackupFromFile` estimateVersions import. `restoreEstimateVersion` row merge behavior unchanged except confirm text. project.estimate live rows/scalars/laborPhaseColors unchanged. project.timeline/progress/schedule/coordination untouched. project.finance untouched. finance.weeklyData untouched. team.members untouched. service scopes untouched. Sync/stale/baseline/verified-save core unchanged except narrow estimateVersions preservation hook. Not committed; no push.

**Lock released.**

---

### 2026-07-05 — Phase 6S-E / 6L-B: laborPhaseColors Scoped Merge Under project.estimate (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Scoped implementation — protect Estimate tab labor phase header colors from stale broad project saves. UI metadata only.
**Branch:** main | HEAD before edits = `6c00ba4` (Hide deleted projects from home job health)
**Files changed:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rEstimateTab.tsx`, `AGENT_SHARED_CONTEXT.md`

**What was implemented:**
- **`projectScopeMerge.ts`**: added `normalizeLaborPhaseColorKey`, `stampLaborPhaseColor`, `mergeLaborPhaseColorMaps`, `mergeProjectLaborPhaseColorsIntoRemote`, `mergeAllProjectLaborPhaseColorsIntoRemote`, and `mergeRemoteLaborPhaseColorsIntoOutgoing` — per-phase LWW keyed by `projects[].laborPhaseColorUpdatedAt[phaseKey]`; newer timestamp wins; tie prefers incoming on explicit estimate saves / remote on broad-save preservation; never wipes a remote defined color with incoming blank; no tombstones.
- **`backupDataService.ts`**: type-only `BackupProject.laborPhaseColors` + `laborPhaseColorUpdatedAt`; removed unused `estimateScalarUpdatedAt.laborPhaseColors` placeholder; added `isProjectEstimateSyncSource` and narrow pre-sync preservation fold calling `mergeRemoteLaborPhaseColorsIntoOutgoing` on non-project.estimate saves (reuses existing remote fetch; never blocks save).
- **`scopeRegistry.ts`**: extended `project.estimate` descriptor for laborPhaseColors; added `'project.estimate'` legacy changedKey mapping.
- **`V15rEstimateTab.tsx`**: `scheduleLaborPhaseColorCommit` / `flushLaborPhaseColor` now stamp `laborPhaseColorUpdatedAt` and save via fetch-latest → `mergeProjectLaborPhaseColorsIntoRemote` → `saveBackupWithRemoteBaselineSync({ changedKey: 'project.estimate', _scopes: ['project.estimate'] })`; fallback `saveBackupDataAndSync(..., 'project.estimate', ...)`. Debounce preserved. No broad `saveBackupDataAndSync(backup, 'projects')` for color commits.

**Explicitly NOT done / untouched:** `progressPhaseColors` (already protected by project.progress / 6S-D2). `settings.phaseWeights` / `settings.mtoPhases` merge. Global settings singleton merge. Home `agendaSections` / `customAlerts`. `estimateVersions`. project.timeline / project.progress / project.schedule / project.coordination implementations. project.finance. finance.weeklyData. team.members. service scopes. Sync/stale/baseline/verified-save core unchanged except the narrow laborPhaseColors preservation hook. Not committed; no push.

**Lock released.**

---

### 2026-07-05 — Phase 6Q-B: Recently Deleted / Restore Project UI (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** UI-only implementation — add a restore path for the soft-deleted projects introduced in Phase 6Q. No services touched, no data-model change, no hard purge.
**Branch:** main | HEAD before edits = `3446734` (Add scoped project soft delete)
**Files changed:** `src/components/v15r/V15rProjectsPanel.tsx`, `AGENT_SHARED_CONTEXT.md`

**Root context:** Phase 6Q soft-deletes projects (deletedAt/deletedBy/status='deleted') but they became invisible with no UI restore path; `restoreProject` only handles ARCHIVED projects and never clears the delete tombstone.

**What was implemented (V15rProjectsPanel.tsx only):**
- Added `deletedProjects = allProjects.filter(isDeletedProject)` and a `showDeletedProjects` toggle state.
- Added a **new** `restoreDeletedProject(id)` (kept separate from the archived `restoreProject`): `pushState` → `delete deletedAt` / `delete deletedBy` → if `status==='deleted'` set `status='active'` → set `updatedAt=now` → save through the existing **`saveProjectLifecycleScoped(id)`** (project.lifecycle scoped merge, no broad persist). Every child array/field, top-level `logs[]`, collected/payment history, serviceLogs, and child scopes are untouched.
- Added a **"Recently Deleted"** collapsible section (`renderDeletedProjects()`) rendered right after the Archived section, gated by a header toggle button that only appears when `deletedProjects.length > 0`. Each card shows name, client/customer, `deletedAt`, `deletedBy`, and a single **Restore** button (→ `restoreDeletedProject`). No Permanent-Delete/purge button.
- Restored projects return to Active (via `isActiveProject`) and drop out of Recently Deleted. Archive and Delete remain fully separate; `archiveProject`/`restoreProject`/`deleteProject`/`moveStatus`/`markProjectLost` unchanged.

**Explicitly NOT done / untouched:** permanent hard purge / export flow / Recovery Center (deferred); exact pre-delete-status restoration (restore lands in Active — prior bucket not stored by 6Q's tombstone); child-record cascade; `logs[]`; serviceLogs / service payments / `manualPaidAdjustment`; blueprint; `projectScopeMerge.ts` / `backupDataService.ts` / `scopeRegistry.ts` (read-only, not edited — the existing `mergeProjectLifecycleIntoRemote` already propagates a cleared tombstone); `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`. Not committed; no push.

**Lock released.**

---

### 2026-07-05 — Phase 6Q: Project Soft-Delete Lifecycle + Scoped Sync Safety (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation — replace the hard project delete with a delete-safe soft-delete (Model A). No child-record cascade tombstoning, no service-log change, no Save/stale/baseline change, no blueprint change.
**Branch:** main | HEAD before edits = `b7df027` (Convert remaining project log creators)
**Files changed:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rProjectsPanel.tsx`, `AGENT_SHARED_CONTEXT.md`

**Root context:** Phase 6Q audit found `deleteProject` (the only hard-delete path) hard-removed the project from `projects[]` AND hard-filtered `logs[]` by projId (destroying collected/payment history with no tombstone), via a broad `persist('projects')` save. Converted to a scoped soft-delete.

**What was implemented:**
- **`scopeRegistry.ts`**: added `project.lifecycle` `DataScope` + descriptor (fields deletedAt/deletedBy/status; field-lww; nested; critical) and added it to the `projects` legacy changedKey mapping. No existing scope changed.
- **`projectScopeMerge.ts`**: added `isDeletedProject(project)` (true when `deletedAt` valid or `status==='deleted'`), `createProjectTombstone(project, deletedBy?)` (returns a copy stamped deletedAt[idempotent]/deletedBy['system' default]/status='deleted'/updatedAt, preserving every field + child array), and `mergeProjectLifecycleIntoRemote(remote, incoming, projectId)` (clones remote, patches ONLY deletedAt/deletedBy/status/updatedAt onto the matching remote project; if remote lacks the project it appends the incoming soft-deleted copy to propagate the tombstone; all child arrays, top-level logs[], other projects, serviceLogs, and blueprint data untouched). No existing item merge altered.
- **`backupDataService.ts`**: type-only added `BackupProject.deletedAt?/deletedBy?/updatedAt?`; `isActiveProject` now returns false when `record.deletedAt` is set (status='deleted' was already excluded). No sync/save/baseline logic changed.
- **`V15rProjectsPanel.tsx`**: `deleteProject` no longer hard-removes the project or hard-filters `logs[]`. It now `pushState`s, replaces the project in `projects[]` with `createProjectTombstone(p)`, and saves through a new demo-aware `saveProjectLifecycleScoped(id)` (optimistic local → `fetchLatestRemoteBackup` → `mergeProjectLifecycleIntoRemote` → `saveBackupWithRemoteBaselineSync({ source:'project-lifecycle-remote-merge', changedKey:'projects', _scopes:['project.lifecycle'] })`; first-sync/fetch-failure fallback = `saveBackupDataAndSync(...,'projects',{_scopes:['project.lifecycle']})`). The hunter_leads `won_archived` disposition side effect is preserved. Confirm dialog reworded (history preserved). The Archived list now excludes soft-deleted projects (`isArchivedRecord(p) && !isDeletedProject(p)`); active/coming/completed already exclude them via `isActiveProject`. `archiveProject`/`restoreProject`/`markProjectLost`/`moveStatus` unchanged.

**Explicitly NOT done / untouched:** child-record cascade tombstoning (COs/RFIs/materials/estimate rows ride with the retained soft-deleted project); logs[] no longer filtered on delete; hard export-gated purge + Recovery Center UI (deferred); serviceLogs / service payments / `statusEvents` / `manualPaidAdjustment`; blueprint annotations/work packages / `OperationsBlueprintPdfViewer.tsx`; existing item merges (CO/RFI/materials/estimate/logs); Home log readers; Project Logs display sorting; Phase 6P log creators; `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`. Not committed; no push.

**Lock released.**

---

### 2026-07-04 — Phase 6P: Remaining Project-Log Creators → Scoped Merge + Payment-Creator Corruption Repair (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation — convert the last three project-log CREATORS to the Phase 6N scoped `logs[]` merge path and repair committed source corruption in the payment creators. No Save/stale/baseline change, no service-log change, no new merge/service helpers, no services files edited.
**Branch:** main | HEAD before edits = `47a21f2` (Hide tombstoned logs on home)
**Files changed:** `src/components/v15r/V15rProjectsPanel.tsx`, `src/components/v15r/V15rFieldLogs.tsx`, `AGENT_SHARED_CONTEXT.md`

**Root context:** Phase 6O audit found three creators still broad-saving / corrupted: `V15rFieldLogs.handleAddLog`, and `V15rProjectsPanel.handleMarkFullPayment` / `handleLogPartialPayment`. The latter two sat inside committed corruption: `saveBackupDbackup.logs = …` (undefined ref → runtime throw on Mark Full Payment), an orphan `handleLogPartialPayment(p){ata(backup)` fragment, and a duplicate/malformed `handleLogPartialPayment` declaration.

**What was implemented:**
- **`V15rProjectsPanel.tsx`**: Repaired the corruption — removed `saveBackupDbackup.logs = …` and the duplicated `p.lastCollected*` lines, deleted the orphan/malformed duplicate `handleLogPartialPayment` block. Now exactly one valid `handleMarkFullPayment` and one valid `handleLogPartialPayment`; no `saveBackupDbackup`, no orphan `ata(backup)`. Added a local demo-aware `saveProjectLogCreatorScoped(projectId)` (optimistic local `saveBackupData` → `fetchLatestRemoteBackup` → `mergeProjectLogsIntoRemote(remote, incoming, projId)` → `saveBackupWithRemoteBaselineSync({ source:'project-logs-remote-merge', changedKey:'logs', _scopes:['project.logs','project.payments'] })`; first-sync/fetch-failure fallback = `saveBackupDataAndSync(...,'logs',{_scopes})`; demo mode keeps prior local-sync behavior). Both payment creators now stamp `logId` (`makeLogInternalId`) + `createdAt`/`updatedAt`, keep `collected` on the same row, append to `backup.logs[]`, and persist through the scoped save (no broad `saveBackupData` for the log write). Added imports `fetchLatestRemoteBackup`, `saveBackupWithRemoteBaselineSync`, `mergeProjectLogsIntoRemote`.
- **`V15rFieldLogs.tsx`**: `handleAddLog` now stamps `logId`/`createdAt`/`updatedAt` (preserving `id`/`projId`/`date`/`phase`/`emp`/`hrs`/`miles`/`mat`/`collected`/`notes`/`projName` from the form emitter), appends to `backup.logs[]`, and saves through a new `saveFieldLogScoped(projId)` mirroring the Phase 6N path (fetch-latest → `mergeProjectLogsIntoRemote` → `saveBackupWithRemoteBaselineSync`; fallback `saveBackupDataAndSync(...,'logs',{_scopes})`). Removed `window.location.reload()` in favor of `forceUpdate` + `storage`/`poweron-data-saved` events; modal closes via `setShowAddForm(false)`. UI/layout unchanged. Added imports `saveBackupDataAndSync`, `fetchLatestRemoteBackup`, `saveBackupWithRemoteBaselineSync`, `useCallback`, and `mergeProjectLogsIntoRemote`.

**Explicitly NOT done / untouched:** `deleteProject` cascade (still hard-filters `logs` by projId — deferred to Phase 6Q); serviceLogs / service-call payments / `statusEvents`; `manualPaidAdjustment`; `V15rProjectLogsTab.tsx` / `V15rFieldLogPanel.tsx` (already compliant); dashboard/chart readers; all services files (`projectScopeMerge.ts`, `backupDataService.ts`, `scopeRegistry.ts` — read-only, not edited); `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`. Not committed; no push.

**Lock released.**

---

### 2026-07-04 — Phase 6N: Project Logs + Payment Row Scoped Tombstone Merge (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation — combined project.logs + project.payments row-level merge. No Save/stale/baseline change, no service-log change.
**Branch:** main | HEAD before edits = `c13b3a6`
**File Lock:** `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rProjectLogsTab.tsx`, `src/components/v15r/V15rFieldLogPanel.tsx`, `src/services/scopeRegistry.ts`, `AGENT_SHARED_CONTEXT.md` — CLAIMED then RELEASED.

**Model decision:** did NOT split project.payments from project.logs. A project payment is the `collected` field ON a top-level `logs[]` row (no separate payment entity), so the whole row is one merge unit and `collected` always travels with it.

**What was implemented:**
- **`projectScopeMerge.ts`**: added `ProjectLog` type, `logProjectId` (projId primary, projectId fallback), log timestamp normalizers (updatedAt→createdAt→id-embedded ms→date→epoch; deletedAt supersedes; never defaults to now), identity helpers (`getLogStableId` = `logId` else legacy `legacy:<projId>:logs:<id>` + content fingerprint on legacy-id collision), `sanitizeLogForMerge`, `isDeletedLog` (tombstone marker) / `isDeadProjectLog` (deleted OR archived OR void, for UI/financial filtering), `getLiveProjectLogsFromArray`, `createLogTombstone`, `mergeLogsByStableId` (reuses `pickEstimateRowWinner`: tombstone beats equal-or-older live edit, both-live newest updatedAt wins, tie→remote), and `mergeProjectLogsIntoRemote` — splits the top-level `logs[]` into target-projId vs other, merges ONLY the target slice onto a fresh remote clone, and re-appends all other projects' logs untouched. No other BackupData branch is read/written.
- **`backupDataService.ts`**: extended `BackupLog` with optional `logId/createdAt/updatedAt/deletedAt/deletedBy/archivedAt/status`; added `isDeletedOrArchivedProjectLog` + `getLiveProjectLogs`; **`projectLogsFor` now filters tombstoned/archived logs**, so all financial readers (`getProjectFinancials` loggedPaid/lastCollected, `buildProjectLogRollup`, pricing analytics) exclude deleted logs and their `collected` from paid/collected/ar/risk. No sync/save/baseline logic changed.
- **`V15rProjectLogsTab.tsx`** & **`V15rFieldLogPanel.tsx`** (both write the same top-level `logs[]`): create stamps `logId/createdAt/updatedAt`; edit preserves `logId/id/createdAt` and bumps `updatedAt`; delete writes a `createLogTombstone` (no hard-delete); lists render live logs only; project-log saves route through a new `saveProjectLogsScoped(projId)` (optimistic local → fetch-latest → `mergeProjectLogsIntoRemote` → `saveBackupWithRemoteBaselineSync({ source:'project-logs-remote-merge', changedKey:'logs', _scopes:['project.logs','project.payments'] })`; first-sync/fetch-failure fallback = existing `saveBackupDataAndSync(...,'logs',{_scopes})`). FieldLogPanel scopes each save by the edited row's `projId` and keeps prior demo-mode behavior; its **service-log CRUD still uses the untouched `persist()`**.
- **`scopeRegistry.ts`**: `project.logs`/`project.payments` notes updated (identityField `logId`, timestamp `updatedAt`, tombstone `deletedAt`, combined merge).

**Explicitly NOT done / untouched:** serviceLogs / service.calls / service payment `statusEvents`; `manualPaidAdjustment`; fieldLogs.entries + team.time as separate scopes; project-delete cascade (still hard-filters `logs` by projId in `V15rProjectsPanel` — flagged as a future project-lifecycle concern, NOT converted); dashboard/chart readers (read-only); estimate/materials/RFI/CO/blueprint/leads/pricebook/team/settings; `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`. `V15rFieldLogs.tsx` and `V15rProjectsPanel.tsx` log creators were NOT modified (see risks). Not committed; no push.

**Lock released.**

---

### 2026-07-04 — Phase 6L: Project Estimate Scalar Fields Scoped Merge (contract/mileRT/miDays) (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation — per-field LWW scalar merge only. No Save/stale/baseline change, no row-merge change.
**Branch:** main | HEAD before edits = `c4b4bae`
**File Lock:** `src/services/projectScopeMerge.ts`, `src/components/v15r/V15rEstimateTab.tsx`, `src/services/scopeRegistry.ts`, `src/services/backupDataService.ts` (type only), `AGENT_SHARED_CONTEXT.md` — CLAIMED then RELEASED.

**What was implemented:**
- Implemented scoped merge for the project.estimate **scalar** fields `contract`, `mileRT`, `miDays`. Previously these saved through broad `saveBackupDataAndSync(backup)` / `saveBackupDataAndSync(backup, 'projects')` whole-project paths; they now fetch latest remote and patch only their own fields.
- **`projectScopeMerge.ts`**: added `EstimateScalarField`, `ESTIMATE_SCALAR_FIELDS = ['contract','mileRT','miDays']`, `EstimateScalarUpdatedAt`, and `mergeProjectEstimateScalarsIntoRemote(remoteBackup, incomingBackup, projectId)`. Per-field LWW keyed by `projects[].estimateScalarUpdatedAt.<field>` using the existing `comparableMs`/`isValidDateString` helpers. Different scalar fields can merge independently; the same field resolves by newest per-field timestamp; **exact tie keeps remote**; missing/invalid timestamps compare as `-Infinity` and are **never defaulted to now**. Only whitelisted fields + `estimateScalarUpdatedAt` are written; unknown/legacy metadata keys are preserved (never deleted); no row/material/RFI/CO/blueprint/logs/other-project branch is touched.
- **`V15rEstimateTab.tsx`**: added `mergeProjectEstimateScalarsIntoRemote`/`ESTIMATE_SCALAR_FIELDS` import, an `estimateScalarsSaveQueueRef` (debounced fetch-latest→merge→`saveBackupWithRemoteBaselineSync({ source:'project-estimate-scalars-remote-merge', changedKey:'projects', _scopes:['project.estimate'] })`; first-sync fallback = existing `saveBackupDataAndSync(incoming,'projects',{source:'project.estimate',_scopes:['project.estimate']})`), a `stampEstimateScalar(project, field, ts)` helper, and `saveEstimateScalarsScoped()`. Repointed the contract input `onBlur`, contract slider `onPointerUp`, and `editMileage` (mileRT/miDays) to stamp only the edited field + queue the scoped scalar save. UI stays optimistic (`p` mutate + `forceUpdate`); layout unchanged. Scalar-queue timer added to the unmount cleanup effect.
- **`scopeRegistry.ts`**: `project.estimate` descriptor notes updated to document Phase 6L scalar LWW alongside the Phase 6J row merge; strategy/priority unchanged.
- **`backupDataService.ts`**: type-only addition of `BackupProject.estimateScalarUpdatedAt?: { contract?; mileRT?; miDays?; laborPhaseColors? }`. No sync/save/baseline logic changed.

**Explicitly NOT done:** `laborPhaseColors` (still on its existing debounced broad save — future Phase 6L-B), `estimateVersions` (separate top-level future scope; `saveEstimateVersion`/`restoreEstimateVersion` untouched), `estimateReference`/`phaseEstimateRows`/`lastEstimateSyncAt` (legacy/dead). No change to labor/OH row merge, Materials/MTO, RFIs, Change Orders, Blueprint, logs/payments, `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, or `mergeLocalChangesIntoRemote`. Not committed; no push.

**Lock released.**

---

### 2026-07-04 — Phase 5A: scope registry scaffolding (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Additive scaffolding only — no scoped merge, no runtime save-behavior change.
**Branch:** main | HEAD before edits = `6e74bf2`
**File Lock:** `src/services/scopeRegistry.ts` (new), `src/services/backupDataService.ts`, `AGENT_SHARED_CONTEXT.md` — CLAIMED then RELEASED.

**What was added:**
- **NEW `src/services/scopeRegistry.ts`** (pure module — no React / Supabase / localStorage / side effects): `DataScope` union (30 scopes: blueprint.annotations/workPackages; project.rfis/changeOrders/estimate/payments/logs/materials/schedule/notes/files; fieldLogs.entries/materials/photos/payments; leads.accounts/relationships/pipeline/map/cleanup; team.members/roles/assignments/time; priceBook.items/categories/laborRates/materials; service.calls; settings), plus `ScopeMergeStrategy` (id-merge | map-merge | lww | field-lww | future), `ScopePriority` (critical | high | medium | low | future), `ScopeDescriptor` interface, `SCOPE_REGISTRY` (readonly descriptor per scope with dataPath/owner/level/identity/timestamp/tombstone/strategy/priority from the Phase 5 audit), `LEGACY_CHANGED_KEY_TO_SCOPES` map, and helpers `isDataScope`, `getScopeDescriptor`, `getAllScopes`, `normalizeScopes`, `describeScopes`, `resolveScopesFromLegacyChangedKey`, `resolveScopesForSyncInput`.
- **`backupDataService.ts`**: static import of the pure registry; `resolveSyncOptionsForChangedKey` now resolves scopes from `source`/`changedKey` and attaches them as internal `_scopes` **option metadata only** (never written to BackupData, never sent to Supabase — `syncToSupabase` reads only guard-related option fields). Added `SyncToSupabaseOptions._scopes?: DataScope[]` (metadata field). Added `warnIfUnscopedSyncSave` — a **dev-only** (`import.meta.env.DEV`) `console.warn('[ScopeRegistry] Unscoped sync save detected. …')`; never throws/blocks/mutates; wired into `resolveSyncOptionsForChangedKey` (covers `saveBackupDataAndSync`/`saveBackupDataAndSyncNow`) and directly into `saveAndImmediateSync` (which bypasses that resolver).

**Explicitly NOT done:** no scoped merge / fetch-latest-patch / tombstone / per-scope write logic; no feature-tab changes; no change to `source`, `allowOverwriteNewerRemote`, `requireFreshRemote`, `failClosed`, monotonic baseline, same-device allowance, or verified Save; `saveBackupWithRemoteBaselineSync` untouched; `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` stay dead; no Supabase migration / Recovery Center. app_state payload shape unchanged.

**Lock released.**

---

### 2026-07-04 - Phase 6B: Project Change Orders Scoped Merge

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6B)
**Baseline HEAD:** `e2cde5c` (Keep text annotation IDs stable)
**Files touched:** `src/services/projectScopeMerge.ts`, `src/components/v15r/V15rChangeOrdersTab.tsx`, `src/services/scopeRegistry.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rDashboard.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE - typecheck PASS, build PASS, localhost CRUD test blocked by logged-out/demo-readonly state

Implemented delete-safe, item-level nested merge for `project.changeOrders` only.

**What changed**
- Added pure `projectScopeMerge.ts` helpers for timestamp parsing, Change Order sanitization, live filtering, tombstone creation, id merge, and `mergeProjectChangeOrdersIntoRemote`.
- `V15rChangeOrdersTab.tsx` now renders/sums only live Change Orders via `getLiveChangeOrders`; create/edit stamp `updatedAt`; delete writes a `deletedAt`/`updatedAt` tombstone instead of hard-filtering.
- Change Order saves fetch latest remote and patch only `projects[id].changeOrders`, then use the existing remote-baseline save path. If there is no remote row/remote project, the tab falls back to the existing guarded `projects` save.
- `scopeRegistry.ts` updated only for `project.changeOrders`: `timestampField: updatedAt`, `tombstoneField: deletedAt`, notes describe Phase 6B nested item-level merge; other project scopes remain future/unimplemented.
- `backupDataService.ts` touched minimally: optional CO timestamp/tombstone fields, shared CO total helpers filter tombstones, and `saveBackupWithRemoteBaselineSync` accepts an optional `changedKey` so CO saves can mark `projects` while preserving existing Blueprint default behavior.
- `V15rDashboard.tsx` touched only because it had direct raw `p.changeOrders` CFOT loops that would otherwise count deleted/tombstoned COs; those loops now use `getLiveChangeOrders`.

**Preserved / NOT changed**
- No RFIs, estimate/MTO, project logs, payments/logs shared merge behavior, Field Logs, Leads, Price Book, Team, Service Calls, Settings, or Blueprint files changed.
- Save/stale/baseline freshness logic, verified save, sync guard, and dead merge helpers remain unchanged/not reconnected.
- No branch, commit, push, deploy, restore script, manual Supabase action, or manual localStorage write.

**Verification**
- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS (existing Vite dynamic-import/chunk warnings only)
- `npm.cmd run dev` started on `http://127.0.0.1:5173`.
- Manual localhost CRUD test could not be completed: the browser reached the logged-out landing page; `?demo=true` exists but demo mode hides Add/Edit/Delete for Change Orders, so the requested add/edit/delete/refresh/save flow requires an authenticated localhost session.

**Risks**
- Tombstones are retained indefinitely; no GC.
- Merge ordering uses client-clock timestamps, so severe clock skew can misorder truly concurrent edits.
- Existing hard-deleted COs from before Phase 6B cannot be reconstructed.

**Lock released.**

### 2026-07-04 — Phase 4I: remove temporary sync diagnostics (CLEANUP ONLY, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Cleanup only — remove temporary Phase 4G/4H diagnostics. No behavior change.
**Branch:** main | HEAD before edits = `2ff28de`
**File Lock:** `src/services/backupDataService.ts`, `AGENT_SHARED_CONTEXT.md` — CLAIMED then RELEASED.

**Context:** Phase 4H tested green (Save with no changes → Saved & verified; Save again → Saved & verified; small edit + Save → Saved & verified). The temporary diagnostics are no longer needed.

**Removed (console-only, all wrapped in the temporary `try/catch { diagnostics must never throw }`):**
- `[POWERON_SYNC_BLOCK_DEBUG]` (both block paths in `checkManualSaveFreshness`)
- `[POWERON_BASELINE_SET]` (in `setKnownRemoteBaseline`)
- `[POWERON_BASELINE_IGNORED_OLDER]` (in `setKnownRemoteBaseline`)
- `[POWERON_SYNC_SUCCESS_BASELINE]` (in `syncToSupabase` success path)
- `[POWERON_LOAD_BASELINE]` (in `loadFromSupabase`)
- `[POWERON_VERIFIED_SAVE_START]` (in `saveLiveDataVerified`)
- `[POWERON_VERIFIED_SAVE_STALE_BLOCKED]` (in `saveLiveDataVerified`)
- `[POWERON_SYNC_BLOCK_BYPASSED_SAME_DEVICE_LOCAL_NEWER]` (in `checkManualSaveFreshness`)
- The `__POWERON_SYNC_DEBUG__` global helper (assigned on `globalThis`) and its `[POWERON_SYNC_DEBUG]` log.

**Kept (unchanged behavior):**
- Monotonic `setKnownRemoteBaseline` — never moves backward within a tenant session (Phase 4H).
- Same-device local-newer allowance in `checkManualSaveFreshness` (Phase 4H); real stale other-device saves still block.
- `fetchRemoteAppStateFreshness` still returns `remoteSavedBy` (needed by the allowance) — this is real logic, not a diagnostic, so it stayed.
- `syncToSupabase` baselines from server `updated_at` (Phase 4B); `forceSyncToCloud` does not overwrite baseline with client `_lastSavedAt` (Phase 4D); `saveLiveDataVerified` computes expected summary from the post-sync payload + read-back retry (Phase 4F).
- Pre-existing non-diagnostic `[Sync]` console logs (`Save/sync blocked …`, `Synced tenant …`, etc.) were left in place.

**NOT touched / NOT reconnected:** `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` stay dead. No return values, freshness comparisons, monotonic behavior, same-device allowance, or verified-Save behavior changed. No UI, no Blueprint/RFI/FieldLog/Leads/PriceBook/Team changes.

**Lock released.**

### 2026-07-04 — Phase 4H: monotonic baseline + same-device local-newer allowance (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Scoped fix in `backupDataService.ts` sync-guard internals — no UI, no merge, no feature tabs.
**Branch:** main | HEAD before edits = `a973c73`
**File Lock:** `src/services/backupDataService.ts`, `AGENT_SHARED_CONTEXT.md` — CLAIMED then RELEASED.

**Root cause (confirmed by Phase 4G logs):** After a verified first Save, a small edit + an out-of-order realtime/load/sync event fed `setKnownRemoteBaseline` an OLDER remote row, which moved the session baseline BACKWARD. loadFromSupabase then still (correctly) kept the newer local data, but the lowered baseline meant the next Save's freshness check saw the real (newer) server `updated_at` as "remote advanced past baseline" and blocked — even though the remote row was written by THIS device and local was newer. Net effect: false *"Cloud sync was blocked because remote data is newer than this local session."*

**Fix 1 — monotonic `setKnownRemoteBaseline`:** Computes the candidate from `remoteUpdatedAt`/`remoteDataLastSavedAt` as before, but now only assigns `_lastKnownRemoteSavedAt` when `candidateBaselineMs > 0 && candidateBaselineMs >= currentBaselineMs`. An older candidate is refused (baseline stays put) and logged as `[POWERON_BASELINE_IGNORED_OLDER]`. The function still RETURNS the candidate value (not the retained baseline), so loadFromSupabase's remote-vs-local selection is unchanged. Baseline may init from zero, may move forward, may never move backward within a tenant session. Explicit tenant reset (`setActiveTenantUser`/`clearActiveTenantUser` → `_lastKnownRemoteSavedAt = null`) is untouched and remains the only path to zero.

**Fix 2 (A2 audit):** loadFromSupabase needed NO logic change — with the monotonic guard, an older realtime row can no longer lower the baseline, while the returned `remoteTime` still carries the actual remote freshness for the keep-local decision. `saveBackupWithRemoteBaselineSync` (read-only reference) also unaffected: it seeds the baseline from a freshly-fetched latest remote, which is forward, not backward.

**Fix 3 — same-device local-newer allowance in `checkManualSaveFreshness`:** In the "remote advanced past baseline" branch, BEFORE blocking, it now checks `remoteSavedBy === getDeviceId()` AND `localFreshnessMs >= remoteFreshnessMs - FRESHNESS_TOLERANCE_MS`. If both hold, the save is allowed (logged `[POWERON_SYNC_BLOCK_BYPASSED_SAME_DEVICE_LOCAL_NEWER]`) — this device pushing its own newer local edits over an older/equal cloud copy of its own work. To supply `remoteSavedBy`, `fetchRemoteAppStateFreshness` now also returns `_syncMeta.savedBy` from the already-fetched row (same source the load path prints as "saved by <device>"). No extra network call.

**Stale protection preserved:** The bypass requires BOTH same-device AND local-at-least-as-new. A stale device (local older than remote) fails the second condition and still blocks; a row from a DIFFERENT device fails the first and still blocks; the no-known-baseline block path is untouched. `requireFreshRemote`/`failClosed` unchanged, `checkManualSaveFreshness` still runs first, no global bypass.

**NOT touched / NOT reconnected:** `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` stay dead. `saveBackupWithRemoteBaselineSync` read-only. `saveLiveDataVerified` unchanged (still consumes the freshness result as-is). `syncToSupabase` only interacts via the monotonic helper (no direct edit). No UI, no Blueprint/RFI/FieldLog/Leads/PriceBook/Team changes. Phase 4G `[POWERON_*]` diagnostics kept for one more validation cycle; two new diagnostics added (`[POWERON_BASELINE_IGNORED_OLDER]`, `[POWERON_SYNC_BLOCK_BYPASSED_SAME_DEVICE_LOCAL_NEWER]`).

**Lock released.**

### 2026-07-03 — Phase 4G: false stale-block diagnostics (DIAGNOSTIC ONLY, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Temporary runtime diagnostics only — NO fix, NO behavior change.
**Branch:** main | HEAD before edits = `0657442`
**File Lock:** `src/services/backupDataService.ts`, `AGENT_SHARED_CONTEXT.md` — CLAIMED then RELEASED.

**Why:** After Phase 4F, Save still shows *"Cloud sync was blocked because remote data is newer than this local session."* The stale/freshness guard is blocking before the verified-save write/read-back flow can complete. Before guessing another fix we need the actual runtime values (baseline vs remote timestamps, who set the baseline last, and from which path).

**Diagnostics added (all wrapped in `try/catch` so they can never throw; console-only; no secrets / no Supabase keys):**
- `checkManualSaveFreshness` — on BOTH remote-newer block paths, a `console.warn('[POWERON_SYNC_BLOCK_DEBUG]', {...})` with `blockPath` (`no-known-baseline` | `remote-advanced-past-baseline`), message, userId, failClosed, local/remote/baseline timestamps + ms, `freshnessToleranceMs`, environment, origin, `_dataChanged`, `changedKeys`, `Date.now()`, ISO. (`source`/`requireFreshRemote` are not passed into this fn — logged as `null` with a note.)
- `setKnownRemoteBaseline` — `console.info('[POWERON_BASELINE_SET]', {...})` with inputs, computed baseline ms/ISO, whether it was applied, a `callerHint` from the stack, `Date.now()`, ISO. Fires on every baseline write (load, sync-success, verified-save) so we can see WHO set the baseline last.
- `syncToSupabase` success path — `console.info('[POWERON_SYNC_SUCCESS_BASELINE]', {...})` with source, `serverUpdatedAt` (from upsert), client `now`, `payload._lastSavedAt`, `_suppressSuccessEvent`, resulting baseline, `changedKeys`.
- `loadFromSupabase` (after baseline set) — `console.info('[POWERON_LOAD_BASELINE]', {...})` with `row.updated_at`, `remote._lastSavedAt`, computed baseline, local vs remote timestamps + a `chosenHint`, remote/local project counts.
- `saveLiveDataVerified` — `console.info('[POWERON_VERIFIED_SAVE_START]', {...})` before the freshness check (userId, local `_lastSavedAt`, current baseline, project count, changed keys); and `console.warn('[POWERON_VERIFIED_SAVE_STALE_BLOCKED]', {...})` with the full `freshness` result object when it stale-blocks.
- `window.__POWERON_SYNC_DEBUG__()` global helper (assigned on `globalThis`) — prints/returns known baseline, `dataChanged`, `changedKeys`, active tenant id, tenant-ready flag, local `_lastSavedAt`, local project count, environment, origin. No secrets.

**Explicitly NOT done:** no guard logic changed, no thresholds/tolerances touched, no baseline rollback/advance logic changed, stale-save blocking NOT weakened, `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` NOT reconnected, `saveBackupWithRemoteBaselineSync` untouched, no UI, no Blueprint/RFI/FieldLog/Leads/PriceBook/Team changes.

**Removal:** every insert is tagged `[Phase 4G diagnostic — TEMPORARY]` for easy grep-and-remove once the root cause is captured.

**Lock released.**

### 2026-07-03 — Phase 4F: verified-save false mismatch fix (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Scoped fix inside `saveLiveDataVerified` (+ two small helpers) — no UI, no merge, no feature tabs.
**Branch:** main | HEAD before edits = `0657442`
**File Lock:** `src/services/backupDataService.ts`, `AGENT_SHARED_CONTEXT.md` — CLAIMED then RELEASED.

**Bug (Phase 4E audit):** First header Save ran the full verified flow (snapshot → saving → verifying) then reported *"Cloud save could not be verified — data may not be saved."*; the next Save then reported *"Cloud sync was blocked because remote data is newer than this local session."* Root cause: `saveLiveDataVerified` computed the **expected** summary from the local object stamped at T0 **before** `syncToSupabase` built/re-stamped the final payload at T1. `syncToSupabase` re-stamps `_lastSavedAt` to its own `now` (T1) and writes that to the cloud, so the cloud row legitimately carried T1 while `expected` still held T0. A single immediate read-back could also briefly return the pre-write row. Either produced a false `verify-mismatch`; the mismatch path then rolled `_lastKnownRemoteSavedAt` back to `preBaseline`, so the next Save saw the (real, newer) server `updated_at` and false stale-blocked.

**Fix — `backupDataService.ts`, `saveLiveDataVerified` + helpers only:**
1. **Expected summary now comes from the post-sync payload.** Removed the pre-write `computeVerificationSummary(local, …)`. After `syncToSupabase` returns success we re-read `getBackupData(userId)` (which `syncToSupabase` just wrote back via `saveBackupDataSilent` with its T1 `_lastSavedAt`) and compute `expected` from that. `expected._lastSavedAt` now equals the exact value written to the cloud, so a fresh read-back matches. The pre-write local read/stamp/`saveBackupData(local)` is kept purely for freshness/snapshot/write prep.
2. **Bounded read-back retry.** The single `fetchRemoteAppStateRow` call is now a loop: up to 3 attempts, `wait(300ms)` between them (new `const wait = ms => new Promise(...)` helper). Verified → break to success. Read-back error/no-row → retry, then `readback-failed`. Not-verified-but-stale → retry; stable mismatch → stop early.
3. **Stale read-back ≠ data mismatch.** New `classifyUnverifiedReadback(comparison)` helper: if the cloud row's `_lastSavedAt` is OLDER than `expected` (or missing) it's read-your-write lag → `stale`; only a **current** cloud timestamp with a differing critical count (`projectsCount`, `logsCount`, `serviceLogsCount`, `rfiTotalCount`, `blueprintAnnotationSetCount`, `blueprintWorkPackageSetCount`) or `tenantUserId` is a `mismatch`. A timestamp-only difference with matching counts is treated as `stale`, never a mismatch.
4. **Baseline behavior after the fix:**
   - `saved-verified` → `setKnownRemoteBaseline` from the verified read-back row (unchanged).
   - `verify-mismatch` (stable count/tenant diff on a current row) → baseline rolled back to `preBaseline` (protected; next Save re-checks freshness). Does not pretend success.
   - `readback-failed` (read-back error/no-row, OR stale/lagged after retries) → **no baseline rollback.** `syncToSupabase` already advanced the baseline from the server `updated_at`; leaving it there prevents the Phase 4E next-save false-block loop, because the write ACK actually succeeded. Success is still NOT shown.
   - `cloud-write-failed` (write never ACKed) → baseline rolled back to `preBaseline` (unchanged).

**Protection preserved / NOT touched:** `checkManualSaveFreshness` still runs first and can still `stale-blocked` before any write — stale-save blocking is NOT weakened, a stale browser still cannot overwrite the cloud. `syncToSupabase` unchanged. `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` stay dead (NOT reconnected). `saveBackupWithRemoteBaselineSync` untouched. No UI changes. No Blueprint/RFI/FieldLog/Leads/PriceBook/Team changes. No Supabase/migration/Recovery Center work.

**Lock released.**

### 2026-07-03 — Phase 4D: remove forceSyncToCloud client-time baseline poison (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Single-line baseline fix in forceSyncToCloud — no UI, no merge, no feature tabs.
**Branch:** main | HEAD before edits = `248711f`

**Bug (Phase 4C audit):** After Phase 4B, the false "Cloud sync was blocked because remote data is newer than this local session" persisted. `syncToSupabase` baselines correctly from the server `updated_at`, but `forceSyncToCloud`'s success branch then ran `setKnownRemoteBaseline(data._lastSavedAt, data._lastSavedAt)` — overwriting the correct server baseline with the CLIENT `_lastSavedAt` (stamped a few ms earlier, and older than the server `updated_at` set by the `moddatetime` trigger). The next freshness check read the newer server `updated_at` and false-blocked. `forceSyncToCloud` is reached from the header sync-status "tap to retry" pill (`source:'sync-retry'`), Settings cloud-sync/restore, and Snapshot restore — so any of those poisoned the baseline for the subsequent header Save, which then could not self-heal (its freshness pre-check blocks before it can re-baseline from a read-back). Reload cleared it because `loadFromSupabase` re-seeds the baseline from the server `updated_at`.

**Fix — `backupDataService.ts` `forceSyncToCloud` only:**
- Deleted `setKnownRemoteBaseline(data._lastSavedAt, data._lastSavedAt)` from the `result.success` branch. The preceding `await syncToSupabase(...)` already set the authoritative baseline from the server `updated_at` (Phase 4B), so this call was both redundant and wrong. Kept `_dataChanged = false`, `_lastSyncedAt = Date.now()`, `_changedKeys.clear()`.
- `syncToSupabase` is now the sole baseline owner for the force-sync write path.

**NOT touched / NOT reconnected:** `syncToSupabase`, `saveLiveDataVerified`, `checkManualSaveFreshness`, `saveBackupWithRemoteBaselineSync` all unchanged. `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` stay dead. No UI change. Phase 2 stale-save blocking intact.

**Deploy/cache note (from 4C audit, not a code change):** `public/sw.js` is cache-first on the app shell (`/`, `/index.html`) and `/assets/`, so a returning browser can serve a stale bundle after deploy — verify the new build is actually running (hard-reload / SW update) when validating.

**Lock released.**

### 2026-07-03 — Phase 4B: baseline from server updated_at (false stale-block hotfix, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Single sync-baseline fix — no UI, no merge, no feature tabs.
**Branch:** main | HEAD before edits = `163d579`

**Bug:** After Phase 4, a header Save could write successfully (item confirmed present in a fresh Incognito window) yet still show "Cloud sync was blocked because remote data is newer than this local session." The block re-appeared on the same session/device that had just saved.

**Root cause (Phase 4A audit):** `syncToSupabase` upserts `app_state` sending a client-generated `updated_at: now`, but the `app_state.updated_at` column is set server-side (`moddatetime` BEFORE-UPDATE trigger — schema-wide convention, see migrations 001/002). The stored server `updated_at` is slightly newer than the client `now` (network latency + clock skew). `syncToSupabase` then baselined the session with `setKnownRemoteBaseline(now, now)` (client `now`). The next `checkManualSaveFreshness` read the newer server `updated_at` and compared it against the older client-`now` baseline → `remoteFreshnessMs > baseline + 1s` → false `REMOTE_FRESHER_THAN_LOCAL_MSG`. `loadFromSupabase` baselines from the server `updated_at`, which is why a reload cleared it until the next write re-poisoned the baseline.

**Fix — `backupDataService.ts` `syncToSupabase` only:**
- The upsert now chains `.select('updated_at').single()` and captures the returned row.
- `const serverUpdatedAt = writtenRow?.updated_at ? String(writtenRow.updated_at) : now` (falls back to client `now` if no row returned — no regression).
- Baseline is now `setKnownRemoteBaseline(serverUpdatedAt, now)` instead of `setKnownRemoteBaseline(now, now)`. Since `computeRemoteFreshnessMs` takes the max, the baseline equals the server `updated_at` the next freshness check will read → no false block. Genuinely stale tabs (older baseline than a remotely-advanced row) still block — Phase 2 protection intact.
- `payload._lastSavedAt` and `_syncMeta.savedAt` remain client `now` (unchanged). Only the baseline uses `serverUpdatedAt`.

**Fixes every path through `syncToSupabase`:** background `saveBackupDataAndSync`, periodic sync, `saveAndImmediateSync`, `forceSyncToCloud`, and `saveLiveDataVerified`'s internal write.

**NOT touched / NOT reconnected:** `attemptProductionMergeAndSync` and merge helpers stay dead. `saveBackupWithRemoteBaselineSync` unchanged. `saveLiveDataVerified` unchanged (its own read-back already baselines from server `updated_at`; no type change needed). No UI change (`V15rLayout.tsx` untouched). No schema/migration change.

**Lock released.**

### 2026-07-03 — Phase 4: verified Save with cloud read-back (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Save-button truth contract only — header Save path + sync-status UI. No merge logic, no schema, no feature tabs.
**Branch:** main | HEAD before edits = `b37a034`

**Goal:** The header Save button must mean "cloud was read back and verified," not "write request finished." Previously success was asserted from the Supabase write-ACK with no proof the blob landed with the expected data.

**Implementation — `backupDataService.ts` (additive):**
- `computeVerificationSummary(data, userId?)` — pure, cheap count-based fingerprint: `projectsCount`, `logsCount`, `serviceLogsCount`, `rfiTotalCount` (Σ `projects[i].rfis[]`), `blueprintAnnotationSetCount` (keys of `blueprintSummaries.operationsBlueprintAnnotations`), `blueprintWorkPackageSetCount` (keys of `operationsBlueprintScopeLayers`), `lastSavedAt`, `tenantUserId`. No deep-hash / no full-blob stringify.
- `compareVerificationSummary(expected, actual)` — all six counts must match exactly; cloud `lastSavedAt` must be ≥ sent value (within `FRESHNESS_TOLERANCE_MS`); tenant owner must match. Returns `{ verified, mismatches[], expected, actual }`.
- `saveLiveDataVerified(options)` — orchestrates: (1) read local + compute expected summary, (2) `checkManualSaveFreshness` (Phase 2 guard; stale → `stale-blocked`, no write), (3) `createHeaderSaveSafetySnapshot` (fail → `snapshot-failed`, no write), (4) stamp + `saveBackupData` + `syncToSupabase` (with `_suppressSuccessEvent`), (5) `fetchRemoteAppStateRow` read-back (fail → `readback-failed`), (6) recompute + compare (mismatch → `verify-mismatch`), (7) on verified: `setKnownRemoteBaseline` **from the read-back row**, clear dirty state, dispatch `poweron:sync-success`, return `saved-verified`. Result union: `saved-verified | stale-blocked | snapshot-failed | cloud-write-failed | readback-failed | verify-mismatch | error`. Optional `onPhase` callback emits `checking-cloud | creating-snapshot | saving | verifying`.
- Baseline safety: captures pre-write `_lastKnownRemoteSavedAt` and **restores it** on `cloud-write-failed` / `readback-failed` / `verify-mismatch` so an unproven save can never advance the baseline (a later stale write would otherwise slip through).
- Added internal `SyncToSupabaseOptions._suppressSuccessEvent` and gated the optimistic `poweron:sync-success` dispatch in `syncToSupabase` so the verified path fires success only after read-back.

**NOT touched / NOT reconnected:** `attemptProductionMergeAndSync` and all merge helpers remain dead/unreferenced (verified path never calls them). `saveBackupWithRemoteBaselineSync` unchanged. `forceSyncToCloud` unchanged and still used by the header "tap to retry" button and other callers. Phase 2 stale-save blocking preserved.

**UI — `V15rLayout.tsx`:**
- `handleHeaderSaveLiveData` now calls `saveLiveDataVerified` and maps its status union to statuses/toasts: `saved-verified`→'synced' "Saved and verified"; `stale-blocked`→'paused' "Cloud has newer data — reload latest before saving"; `snapshot-failed`→'failed' "Safety snapshot failed — cloud save blocked"; `readback-failed`→'failed' "Could not verify cloud — saved locally only"; `verify-mismatch`→'failed' "Cloud save could not be verified — data may not be saved"; `cloud-write-failed`/`error`→'failed' "Sync failed". `onPhase` drives "Checking cloud… / Creating safety snapshot… / Saving to cloud… / Verifying cloud save…". Green success shows ONLY on `saved-verified`.
- `handleSyncConflict` production early-return removed — background/periodic production stale-blocks now surface as 'paused' in both environments (no production merge exists post-Phase 2).
- Mount effect no longer asserts `setSyncStatus('synced')`; uses `'idle'` (neutral) until a real sync/verification confirms.

**Not done (out of scope):** snapshots schema migration, Recovery Center, Blueprint/RFI merge, Field Logs/Leads/Price Book/Team/inner-tab merge logic. typecheck ✅ build ✅.

**Lock released.**

### 2026-07-03 — Phase 2: re-enable stale-save blocking on production + localhost (block-only, no merge; NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Sync/save freshness guard only — supersedes the Step 13E production ungating
**Branch:** main | HEAD before edits = `8980b83`

**Goal:** Stop the bleed identified in Phase 1: the uncommitted Step 13E rollback disabled production freshness checks, letting a stale tab/device silently overwrite newer cloud data. Phase 2 re-enables stale-save BLOCKING in production (and keeps it in localhost), but does NOT restore `attemptProductionMergeAndSync` — its whole-object "projects" merge could clobber nested `project.rfis[]`. Block-only: a stale session is refused and the user is told to reload latest before syncing. No automatic merge yet.

**Fix — freshness guard runs in production AND localhost, everywhere:**
- `backupDataService.ts` `syncToSupabase`: `guardEnabled` reverted to `!options.allowOverwriteNewerRemote && options.requireFreshRemote !== false` (removed the `&& getSaveEnvironment() === 'localhost'` limiter). On block it dispatches the sync-conflict and returns `{ blocked, conflict }`. `attemptProductionMergeAndSync` is NOT called (the Step 13E deletion of that inner merge block stays — it was never re-added).
- `backupDataService.ts` `forceSyncToCloud` requireFreshRemote guard: reverted to `if (options?.requireFreshRemote)` (removed `&& getSaveEnvironment() === 'localhost'`). Stale header save blocks before overwrite. No merge fallback.
- `backupDataService.ts` `forceSyncToCloud` pre-stamp guard: `skipPreStampGuard` reverted to `allowOverwriteNewerRemote === true || requireFreshRemote === true` (removed the `|| getSaveEnvironment() !== 'localhost'` production bypass). Production no longer skips the pre-stamp guard. No merge fallback.
- `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`, `mergeArrayByIdPreferNewer`, `mergeBlueprintSummariesObject`, and the `_skipProductionMerge` option remain in place as dead/unreferenced code — NOT deleted this pass (Phase 2 is stop-bleeding only, no merge-logic rewrite).
- `saveBackupWithRemoteBaselineSync` UNCHANGED — its remote-baseline-then-sync path (blueprint annotations) was already freshness-safe.

**UI — restore accurate paused state (`V15rLayout.tsx`):**
- `handleHeaderSaveLiveData` blocked branch: now `setSyncStatus('paused')` for both environments with reload-latest messaging (was Step 13E's `isLocalhostDev ? 'paused' : 'failed'`; pre-13E's production `'synced'` was inaccurate). A blocked header save means cloud is newer (or the safety snapshot failed) — local data is safe, not "synced" and not a generic failure.
- Header sync-status "tap to retry" blocked branch: reverted to a single `setSyncStatus('paused')` + "Cloud sync is paused because newer remote data exists. Reload latest before cloud syncing." (removed the Step 13E `isLocalDevRetry` production→`'failed'` split).
- The localhost header-save `window.confirm` warning and `getSaveEnvironment()`/`isLocalDevOrigin()` are unchanged.

**Not done this pass (explicitly out of scope):** automatic merge/reconciliation of concurrent edits; snapshots schema; Recovery Center; any Blueprint viewer / RFI tab / Field Log / Leads / Price Book / Team / inner-tab merge-logic changes; Supabase migrations; snapshotService / milestoneBackupService. Concurrent production editors still get block-then-reload (last-writer must reload), not auto-merge — that is the intended stop-bleeding behavior.

**Preserved (not touched):** RFI tab, Project/Field Logs tabs, Leads, Price Book, Team, `blueprintLibraryService.ts`, Blueprint viewer, all migrations, data models, snapshot/milestone services, untracked `*.CURRENT-BACKUP` files. typecheck (pending) build (pending).

**Lock released.**

### 2026-07-03 — Emergency rollback: neutralize ad30ad4 production sync guard (Step 13E, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Sync/save guard only — RFI tab, Project/Field Logs, Blueprint viewer, blueprintLibraryService NOT touched
**Branch:** main | HEAD before edits = `8980b83`

**Problem:** Production showed "Cloud paused — saved locally just now" and RFI/project saves could be dropped. Root cause (per prior audit): ad30ad4's `attemptProductionMergeAndSync` whole-object "projects" merge (no `project.updatedAt` granularity) could silently clobber nested `project.rfis[]`, and one un-gated `setSyncStatus('paused')` call site (the header sync-status "tap to retry" button) still fired the scary paused state on production.

**Fix — guard now applies to localhost/dev only, everywhere:**
- `backupDataService.ts` `syncToSupabase`: `guardEnabled` now also requires `getSaveEnvironment() === 'localhost'`. Removed the `attemptProductionMergeAndSync` call inside (it only ever ran when the guard fired, which is now localhost-only, and the function itself already short-circuits to `null` on localhost — so the call was permanently dead there).
- `backupDataService.ts` `forceSyncToCloud`: both guard blocks (`requireFreshRemote` branch + pre-stamp `skipPreStampGuard` branch) gated the same way — `requireFreshRemote &&`/`|| getSaveEnvironment() !== 'localhost'` — and their `attemptProductionMergeAndSync` calls removed. Production force-sync (header "Save Live Data", "tap to retry") now uploads directly, same as any other write.
- `attemptProductionMergeAndSync` function definition, its `SyncToSupabaseOptions._skipProductionMerge` field, and `mergeArrayByIdPreferNewer`/`mergeLocalChangesIntoRemote` are left in place (unreferenced/dead) — not deleted, per emergency-rollback scope (no data-model/merge-logic rewrite this pass).
- `V15rLayout.tsx`: the "tap to retry" button's blocked branch (previously the one un-gated `setSyncStatus('paused')` call) now checks `isLocalDevRetry` the same way `handleSyncConflict`/`handleHeaderSaveLiveData` already did — production shows `'failed'` + "Sync failed" toast instead of `'paused'` + "Cloud paused". `handleHeaderSaveLiveData`'s blocked branch changed `isLocalhostDev ? 'paused' : 'synced'` → `isLocalhostDev ? 'paused' : 'failed'` (production `blocked` on this path can now only mean the safety-snapshot step failed — mislabeling that as "synced" was inaccurate and is now `'failed'` with an accurate toast).
- `getSaveEnvironment()`, `isLocalDevOrigin()`, and the localhost/127.0.0.1 stale-overwrite block/toast are unchanged and still fully active for localhost/dev.

**Not fixed this pass (explicitly out of scope):** the nested `project.rfis[]` merge-granularity issue itself no longer matters for production (production no longer merges at all — it just uploads current local state like pre-ad30ad4), but if two production tabs/devices race on the same project concurrently, last-write-wins still applies at the whole-payload level (unchanged from pre-ad30ad4 behavior, not a regression from this fix).

**Preserved (not touched):** RFI tab, Project/Field Logs tabs, `blueprintLibraryService.ts` (its own remote-merge for annotations is separate from `attemptProductionMergeAndSync` and untouched), Blueprint viewer/rendering/packages/symbols, all migrations, data models. typecheck ✅ build ✅ `git diff --check` ✅.

**Lock released.**

### 2026-07-02 — Soft Guide Assist + HDMI/Data symbols + Symbols Size label scale (Step 13D, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Guide behavior + symbols + label-scale UI only — zoom/rendering/layout/sync NOT touched
**File:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` (+ this ledger)
**Branch:** main | HEAD before edits = `fdc08b3d5589351053ac7293eab83210d1b363a5`

**1) Guide Assist → soft/visual-only:** `applyCenterSnap()` neutralized to return the rect unchanged (single choke point), so every consumer — move (`updateMoveGuideLines`), new placement (finalNorm), and arch control-point carry (snapDx/Dy now 0) — no longer moves the annotation; the user's drop is final. Detection threshold `ALIGNMENT_GUIDE_THRESHOLD_NORM` 0.018→0.03 (earlier/more forgiving). `AlignmentGuideLine` gained `refId`; `calculateAlignmentGuides` records the matched annotation; `renderAlignmentGuideLines` now draws a cyan ring around the reference item(s) in the SAME imperative guide SVG (zero React re-renders, no data change). Circuit-Path `findNearestAnnotationCenterNorm` (a separate deliberate connect-to-symbol feature) left untouched.

**2) HDMI + Data symbols:** added `electrical-hdmi` (HDMI) and `electrical-data` (DATA) to ShapeKind/ElectricalSymbolKind unions, metadata (category 'power', low-voltage), and `renderElectricalSymbolSvg` (HDMI = plate + trapezoid connector mouth; Data = plate + RJ45 keyed jack). Auto-appear in Electrical Symbols; reuse full symbol system (placement/color/opacity/label/select/move/edit/copy/delete/package-pick/work-package/persistence/annotation-list). No zoom/render math touched.

**3) Symbols Size (label scale only):** new local state `symbolLabelScale` (0.75–1.75, default 1), `isSymbolSizePanelOpen`, `symbolSizePanelPos`. "Symbols Size (NN%)" button added under Hide Labels; opens a draggable (pointer-capture) floating popup titled "Symbols Size" with a range slider + live % + Reset 100%. Scale threads into `renderElectricalSymbolSvg` style → `externalLabel` scales badge/text ONLY (anchored at x=96 right edge, y=78 top) — symbol glyphs, boxes, and coordinates unchanged. Respects Hide Labels (externalLabel returns null when off). Local UI only — no persistence this pass (would be a separate follow-up; sync services deliberately not touched).

**Preserved:** zoom/rendering/overlay math, canvas, PDF pan, fullscreen/default layout, sync/save, package pick, work packages, reorder, CO Alarm. typecheck ✅ build ✅ `git diff --check` ✅.

**Lock released.**

### 2026-07-02 — Project/Field Logs mark 'logs' changed key (NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Minimal audited fix only — backupDataService/sync guard/Blueprint NOT touched
**Files:** `V15rProjectLogsTab.tsx`, `V15rFieldLogPanel.tsx` (+ this ledger)

**Root cause (from prior audit):** Both log tabs write top-level `backup.logs` but called `saveBackupDataAndSync(backup)` with NO `changedKey`, so `_changedKeys` never contained `'logs'`. When the production guard blocked a sync (no baseline / remote newer), `attemptProductionMergeAndSync` saw `changedKeys.size === 0` and OVERWROTE local with remote (which lacked the new log) — entry disappeared. `mergeLocalChangesIntoRemote` already lists `'logs'` in its array-merge allowlist, so marking the key is sufficient; backupDataService untouched.

**Fix:** `saveBackupDataAndSync(backup)` → `saveBackupDataAndSync(backup, 'logs')` in `V15rProjectLogsTab.tsx` `persist()` (line 137) and `V15rFieldLogPanel.tsx` `persist()` (line 658). One line each; no behavior/UI/data-model change.

**EOL note:** `V15rFieldLogPanel.tsx` is committed with CRLF baked into blob content (unlike LF-normalized siblings). The Edit tool writing LF produced phantom whitespace hunks + `git diff --check` failures. Resolved by a byte-precise replace that keeps every unchanged line's original CRLF and terminates only the changed line with LF (no trailing CR) → clean minimal diff, `git diff --check` passes.

typecheck ✅ build ✅ `git diff --check` ✅. **Lock released.**

### 2026-07-02 — Reorder Work Package / Scope Layer cards (Step 13C-R2, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Scope-layer list ordering only — zoom/rendering/layout/sync/symbol NOT touched
**File:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` (+ this ledger)
**Branch:** main | HEAD before edits = `a9a82960f93d48c6417246203d0f1983d06efe5b`

**Audit:** Work Packages live in `scopeLayers: BlueprintScopeLayer[]`; the panel renders `scopeLayers.map(...)` in array order — array order IS the display/persist order, there is NO separate index field. Persisted whole via existing `persistScopeLayers(nextLayers)` → `saveOperationsBlueprintScopeLayers(backup, blueprintId, nextLayers)` (same path used by create/edit/delete). So reorder = rebuild array + persist; no schema change, fully backward compatible (existing packages keep current order).

**Changes:**
- Added local UI state `draggingScopeLayerId` / `dragOverScopeLayerId`.
- Added `persistReorderedScopeLayers(nextLayers)` (setScopeLayers + persistScopeLayers, reload on failure — mirrors deleteScopeLayer), `reorderScopeLayer(fromId,toId)` (splice from→to), `moveScopeLayer(id,'up'|'down')` (swap with neighbor).
- Card UI: `GripVertical` drag handle (draggable span, HTML5 DnD), card `onDragOver/onDragEnter/onDrop`, dragged card `opacity-40`, drop-target `emerald ring`. Up/down chevron buttons (disabled at first/last). Subtitle hint added.
- Persist uses existing package save path only.

**Preserved:** package membership (selectedAnnotationIds/itemRefs), names/details, eye visibility toggle + multi-package filter, Package Pick selection, edit/delete, badges, counts. Only array position changes. typecheck ✅ build ✅ `git diff --check` ✅.

**Lock released.**

### 2026-07-02 — Smoke Alarm glyph redesign + on-canvas Package Pick highlight (Step 13C-R1, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Symbol glyph + selection-feedback visuals only — zoom/rendering/layout/sync NOT touched
**File:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` (+ this ledger)

**1) Smoke Alarm glyph:** Rewrote only the `kind === 'electrical-smoke-alarm'` branch in `renderElectricalSymbolSvg`. Now a circular detector base + faint inner ring with three stacked wavy "smoke plume" lines (`q6.5 -7 13 0 t13 0`) inside the body — reads clearly as smoke and stays distinct from CO Alarm (straight horizontal vent slots). Keeps external `SA` label, same viewBox/coords, same style props (color/opacity/rotation/selection/persistence unchanged). CO Alarm branch untouched.

**2) On-canvas Package Pick highlight:** Added one dedicated highlight pass immediately after the annotation `.map()` inside the overlay: for each `canvasPageAnnotations` item in `selectedForPackageIds`, renders a `pointer-events:none` div at the SAME `rect→percentage` position the map already uses (`clampRectToPage(a.rect)`), styled as an emerald dashed ring + glow + light tint + a small `Check` badge. Distinct from the white single-selection ring; visible on the plan without opening the annotation list; works for all package-pickable annotation types. Shows whenever `selectedForPackageIds.size > 0`. Does not read/modify displaySize/overlayRef/zoom, never mutates annotation data, and cannot intercept clicks/movement/editing (pointer-events:none).

**Preserved:** Package Pick behavior/toggle/count/clear, edit add/remove items, CO Alarm glyph, multi-package visibility, zoom/rendering/overlay math, PDF canvas, sync/save, document size, fullscreen/default layout. typecheck ✅ build ✅ `git diff --check` ✅.

**Lock released.**

### 2026-07-02 — HOTFIX: Blueprint route crash — togglePackagePickMode TDZ (Step 13C-HOTFIX, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Initialization-order only — no behavior/zoom/rendering/layout/sync change
**File:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`

**Bug:** "Cannot access 'togglePackagePickMode' before initialization." The Package Pick keyboard `useEffect` (references `togglePackagePickMode` in body + dependency array) sat ~830 lines ABOVE the `const togglePackagePickMode = useCallback(...)` declaration. `const` is not hoisted, so evaluating the effect's dependency array during render hit the temporal dead zone → route crash.

**Fix:** Moved only the 3-line `togglePackagePickMode` useCallback declaration to immediately above the keyboard effect that uses it (it depends solely on the hoisted `setIsPackagePickMode` state setter, so the relocation is safe). Added a 2-line explanatory comment. No other callback needed moving — `togglePackagePickId`/`clearPackagePickSelection`/`removeScopeDraftItem`/`addPickedItemsToScopeDraft`/`clearScopeLayerVisibilityFilter` are all declared before their first use (capture handler / JSX). No behavior, feature, geometry, or data-model change. typecheck ✅ build ✅ `git diff --check` ✅.

### 2026-07-02 — Package Builder Speed Tools + Smoke/CO Symbols (Step 13C, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Package/symbol UI + local state only — zoom/rendering/layout/sync NOT touched
**Branch:** main | HEAD before edits = `ad30ad4daa30376eb9297ab7f4d630b19b9aa8e7`
**File:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` (+ this ledger)

#### Audit findings
1. Work Package items already stored as `BlueprintScopeLayer.selectedAnnotationIds` + derived `itemRefs`; save rebuilds itemRefs from `scopeLayerDraftIds` in `saveScopeLayerFromModal`.
2. `selectedForPackageIds: Set<string>` already existed as the package-pick set (previously only toggled via annotation-list checkboxes).
3. Canvas selection funnels through `handleAnnotationSelectCapture` (pointerdown-capture on the overlay) — a single universal interception point; inner per-annotation `selectAnnotation` handles click.
4. Isolate was single-package: `isolatedScopeLayerId: string | null` → `isolatedAnnotationIdSet` filter.
5. Electrical symbols are data-driven: `ELECTRICAL_SYMBOL_METADATA` Record + `ELECTRICAL_SYMBOL_OPTIONS` auto-render the picker; glyphs in `renderElectricalSymbolSvg`.

#### Changes
- **Package Pick mode:** new `isPackagePickMode` state + on-screen toggle button (annotations header) + Left Control (`e.code==='ControlLeft'`, `!e.repeat`, ignores editable fields, no preventDefault so Ctrl+S/Z/C unaffected) + Escape exits. Canvas clicks intercepted in `handleAnnotationSelectCapture` (toggle once on pointerdown, stop propagation → no move/edit/delete); inner `selectAnnotation` guarded to block focus. Count "Package Pick: N selected" + Clear button.
- **Add/remove package items:** edit modal Items section now has per-item remove (`removeScopeDraftItem`, package-only) + "Add selected items (N)" (`addPickedItemsToScopeDraft`, dedup). `openEditScopeLayerModal` no longer clobbers the pick set. Save path unchanged.
- **Smoke/CO symbols:** added `electrical-smoke-alarm` (SA) + `electrical-co-alarm` (CO) to ShapeKind/ElectricalSymbolKind unions, metadata, and `renderElectricalSymbolSvg`. Auto-appear in Electrical Symbols; reuse existing placement/color/opacity/select/move/copy/delete/persistence.
- **Multi-package visibility:** `isolatedScopeLayerId` → `isolatedScopeLayerIds: Set<string>`; `isolatedAnnotationIdSet` = union across visible packages (null=show all). Eye toggles add/remove; empty set → show all. "Showing N packages" + "Show All" (`clearScopeLayerVisibilityFilter`).

#### Preserved (not touched)
visualScale/renderedZoom/visualPageSize/displaySize, pageFrameRef sizing, overlayRef coordinate math, canvas rendering, PDF zoom/pan, fullscreen/default layout, production sync guard, save/sync service files, ToolPopover. typecheck ✅ build ✅ `git diff --check` ✅.

**Lock released.**

### 2026-07-01 — Production multi-device sync guard (localhost block only) (Step 13B-QA9, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Sync/save guard only — Blueprint rendering/zoom/layout NOT touched
**Branch:** main | HEAD = `cd5ba699ee460066208d6621c1879a314095e1ec`

#### Audit findings
1. **Warning source:** `checkManualSaveFreshness()` → `syncToSupabase()` / `forceSyncToCloud()` → `dispatchSyncConflict()` → `V15rLayout` `poweron:sync-conflict` listener. Message constants in `backupDataService.ts` (`REMOTE_FRESHER_THAN_LOCAL_MSG`, `SYNC_BLOCKED_REMOTE_NEWER_MSG`).
2. **Trigger:** `remote.remoteFreshnessMs > knownRemoteBaselineMs + 1000ms` — any device that loaded before another device saved gets blocked on ALL syncs (periodic, header save, blueprint annotations).
3. **localhost vs production:** `getSaveEnvironment()` existed but was only used for snapshot labels — guard applied identically everywhere.
4. **Scope:** Blocked all cloud writes via `syncToSupabase` default guard — not just header Save.
5. **Blueprint annotations:** Used plain `saveBackupDataAndSyncNow` (no remote merge); scope layers already had `saveBackupWithRemoteBaselineSync`.
6. **Baseline update:** Successful sync calls `setKnownRemoteBaseline(now, now)` — but blocked saves never reached that path.
7. **Why production showed localhost-style warning:** Same guard + same `dispatchSyncConflict` toast on all origins; iPad/Windows cross-device saves advance remote while other tabs retain stale baseline.

#### Fix
- **`isLocalDevOrigin()` / `LOCALHOST_STALE_SNAPSHOT_BLOCKED_MSG`:** localhost-only scary block message.
- **`attemptProductionMergeAndSync()`:** on production, when guard would block: fetch remote → merge local `_changedKeys` into remote (annotation id merge by newer `updatedAt`) → advance baseline → sync.
- **`saveOperationsBlueprintAnnotations()`:** remote-latest merge via `saveBackupWithRemoteBaselineSync` (same pattern as scope layers).
- **`V15rLayout`:** `poweron:sync-conflict` paused toast only on localhost; production relies on merge + `poweron:sync-success` for normal status.

#### Preserved
Blueprint viewer rendering/zoom/layout untouched. Data safety: localhost still blocks stale full snapshot; production never blindly overwrites — merges changed keys only, annotations merge by id with newer-wins.

**Lock released.**

### 2026-07-01 — Blueprint zoom/symbol unified overlay coordinate system (Step 13B-QA8, NOT COMMITTED)

**Agent:** Claude Opus 4.8
**Mode:** Zoom/symbol rendering audit + fix only — no layout/panel/save changes
**Branch:** main | **HEAD before fix:** `9be326205aec3dea26da1bd4876d1a8986690c57` (revert of c72f930)

#### Audit — coordinate systems before fix (HEAD = 9be3262)
1. **PDF canvas:** Raster capped at `displaySize` (touch 15M px / 8000 dim). `pageFrame` sized to `visualDisplayWidth/Height` (= `displaySize × visualScale`). Canvas CSS `width/height: 100%` of pageFrame, BUT render effect also set `canvas.style.width/height` to **raster px** — mismatch above raster cap.
2. **Visible page/scroll:** Spacer + `pageFrame` use `visualDisplayWidth/Height`; scroll/pan math uses visual dimensions. No CSS `transform` (c72f930 reverted).
3. **Symbol overlay:** `absolute inset-0` on pageFrame. Rect annotations use `%` of overlay (visual). Full-page SVGs mixed `width="100%" viewBox=displaySize` with draft previews using `viewBox=visualDisplayWidth/Height` and visual-pixel line/ink coords.
4. **Pointer/hit-test:** `overlayRef.getBoundingClientRect()` (visual size) → `toNorm(px, py, rect.width, rect.height)` for normalized storage. Measure/path cursors mapped to `displaySize` px. Ink/line drafts stored visual px into mismatched viewBoxes.

#### Root cause
Above ~350% on iPad the raster cap stops growing (`renderedZoom` capped, `visualScale > 1`). The PDF render effect wrote `canvas.style.width/height = displaySize` while `pageFrame`/overlay grew to `visualDisplay*` — canvas displayed at raster px inside a larger frame, drifting symbols from the overlay. Draft SVGs also mixed visual-pixel coords with `displaySize` vs `visualDisplay` viewBoxes.

#### c72f930 status
Present in history but **reverted at HEAD (9be3262)**. Its CSS `transform: scale(visualScale)` on a raster-sized pageFrame was **not** re-applied — it made symbols disappear on iPad (composited transform layer paint failure). This fix keeps visual page sizing (b3742ad approach) and fixes alignment without CSS transform.

#### Fix architecture
- **Keep:** visual page/spacer sizing for scroll; raster cap; 1000% zoom; no layout/panel changes; no CSS transform on pageFrame.
- **Remove:** `canvas.style.width/height` raster override in PDF render effect.
- **Unify:** `pageOverlaySvgProps` = `{ width: visualDisplayW, height: visualDisplayH, viewBox: '0 0 displaySize.w displaySize.h' }` for all full-page SVG layers (pen/marker, callout leaders, measure/circuit paths, alignment guides, drafts).
- **Canvas + overlay:** explicit `visualDisplayWidth/Height` CSS dimensions (not inset-0 + 100%).
- **Helper:** `overlayPxToPagePx()` for draft ink/line/arch SVG coords; pointer normalized coords unchanged.

#### Code areas changed
- `overlayPxToPagePx` helper (~680)
- PDF render effect: removed canvas.style raster override (~2456)
- `pageOverlaySvgProps` bundle (~5140)
- Canvas/overlay explicit visual dimensions (~6971)
- All full-page SVG layers → `{...pageOverlaySvgProps}`
- Line/arch/ink draft pointer → page px for SVG attributes

#### Preserved (verified by diff)
Fullscreen layout, default annotations panel, document display size / fit-scale, scroll-to-annotations, save/sync, raster cap, max zoom 1000%, wheel/pinch zoom math, ToolPopover and all other files untouched.

**Lock released** — `OperationsBlueprintPdfViewer.tsx` free for other agents.

### 2026-07-01 — Remove pageFrame willChange:transform (annotations vanish on zoom) (Step 13B-QA7-R8, NOT COMMITTED)

**Agent:** Claude Code (Fable 5, task labeled Opus)
**Mode:** Surgical one-line compositing-hint removal
**Branch:** main | HEAD = 2767e1c
**Typecheck:** 0 errors ✅ | **Build:** ✅ 17.11s | **git diff --check:** PASS ✅

**Change:** Removed `willChange: visualScale !== 1 ? 'transform' : undefined` from the `pageFrameRef` style ([OperationsBlueprintPdfViewer.tsx:6920](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)). Nothing else touched.

**Why:** QA7 made normal button/wheel zoom apply `transform: scale(visualScale)` above the raster cap (pre-QA7 it only rendered a bigger canvas). `willChange: transform` forced the page frame into a persistent composited layer sized to `displaySize × visualScale`; at high zoom that exceeded the browser max texture/layer size and its painted DOM/SVG content (the annotation overlay) dropped out — annotations vanished on zoom-in while the canvas looked fine. Removing the hint lets the browser rasterize the transformed content on demand.

**Unchanged (verified by diff):** transform, transformOrigin, width, height, displaySize, renderedZoom, visualScale, raster cap, canvas rendering, overlay dims, SVG viewBox, annotation math, z-index, fullscreen layout, default embedded layout, annotations panel, scroll handle, document viewport sizing. Diff is the single style line → comment. Manual zoom QA (100/250/500/1000% default + fullscreen) still pending on-device.

**Lock released.**

### 2026-07-01 — Default/Embedded iPad Annotations Panel Expands Naturally (Step 13B-QA7-R7, NOT COMMITTED)

**Agent:** Claude Code (Fable 5, task labeled Opus)
**Mode:** Default-mode-only annotations layout fix — fullscreen, zoom, PDF scroller untouched
**Branch:** main | HEAD = 49f6103
**Typecheck:** 0 errors ✅ | **Build:** ✅ 19.05s | **git diff --check:** PASS ✅

#### Wrapper/condition that broke default annotations
In default embedded iPad/mobile mode (`!useDesktopThreePaneLayout && !fullscreen`) the annotations panel used the fullscreen-drawer paradigm: (a) `annotationPanelExpanded = tabletAnnotationsOpen` which defaults **false** → panel rendered as a collapsed 40px `h-10` strip; (b) when expanded, `annotationPanelSizeClass = 'h-auto max-h-56 min-h-0'` — a 224px cap with internal `overflow-auto` scroll, so the list looked clipped/compressed; (c) the shared `operations-pdf-scroll` class set `touch-action: none`, which would block the app page from scrolling under a finger on a tall panel.

#### Fix (default mode only)
- `annotationPanelExpanded` is now `true` in every non-fullscreen mode (desktop three-pane already was; default embedded now is too) — fullscreen keeps `tabletAnnotationsOpen` so the accepted collapsible drawer is unchanged.
- New `isDefaultEmbeddedLayout` flag. Its size class changed `'h-auto max-h-56 min-h-0'` → `'h-auto min-h-[240px]'`: grows naturally below the document, no internal-scroll cap, the normal app page scrolls.
- Inline `touchAction: 'auto'` + `overscrollBehavior: 'auto'` on the panel div only when `isDefaultEmbeddedLayout`, overriding the shared class so finger-scroll of the page works over the annotations.
- Collapse chevron now shows only in fullscreen (was `!useDesktopThreePaneLayout || fullscreen`) — in default embedded it would be a dead control since the panel is always expanded.

#### Preserved (verified)
Fullscreen stacked layout (QA7-R5) and its overlay scroll handle (QA7-R6): the `(isFullScreenView || isTabletImmersiveFullscreen)` size-class branch and `fsStackedFullscreen` logic are byte-for-byte unchanged. Desktop three-pane branch unchanged. Document display size, 1000% zoom, raster cap, renderedZoom, visualScale, and the inner PDF `operations-pdf-scroll` zoom/pan area untouched (touch-action override applies only to the annotations panel element in default embedded, never the PDF scroll area). No `resize:` CSS. All tools/features and save/sync untouched.

**Lock released.**

### 2026-07-01 — Fullscreen Overlay Scroll Handle (Step 13B-QA7-R6, NOT COMMITTED)

**Agent:** Claude Code (Fable 5, task labeled Opus)
**Mode:** Additive UI affordance — no document sizing, zoom, or PDF-scroller logic changed
**Branch:** main | HEAD = 43c538f
**Typecheck:** 0 errors ✅ | **Build:** ✅ 20.76s | **git diff --check:** PASS ✅

#### Scroller identified
The R5 fullscreen vertical content scroller (`flex-1 min-h-0 overflow-y-auto overflow-x-hidden`, ~line 6690) — the outer scroller holding the document work-screen + annotations-below. NOT the inner PDF zoom/pan `operations-pdf-scroll` (`scrollAreaRef`), which was left untouched.

#### What was added
- New `fullscreenScrollerRef` on that scroller + `onScroll` (fullscreen only) → `updateFsRail()`.
- `updateFsRail()` reads scrollTop/scrollHeight/clientHeight + `getBoundingClientRect` (root is fixed at 0,0 so rect.top = offset in root) → derives an overlay thumb: height = max(44px, ratio·rail) for a finger target, positioned by scroll ratio. Shows only when content overflows and only in stacked fullscreen (`fsStackedFullscreen`).
- Effect: rAF initial + `ResizeObserver` on the scroller + window resize; deps include `tabletAnnotationsOpen`/`currentPage`/`allAnnotations.length` so the thumb re-measures when the annotations drawer expands/collapses.
- Pointer handlers (`handleFsThumbPointerDown/Move/Up`) with `setPointerCapture` → drag maps dy→scrollTop of the fullscreen scroller only; `stopPropagation` + `touch-action: none` so it never reaches the PDF pan/zoom.
- Overlay rail+thumb rendered as an `absolute` sibling on the fixed root (right edge, z-100045) — clear of the top tools and the bottom-centered Move/Edit/Copy/Delete toolbar.
- `.bv-fs-scroll-thumb` CSS: 8px → 14px on hover/active with a subtle color bump.

#### Why an overlay (not native `::-webkit-scrollbar` widening)
"Bigger on hover" + "no layout jump" + "don't change document size" conflict for a native scrollbar (widening reflows; a stable gutter reserves width and shrinks the document/fit-scale, which is computed from the inner scroll area). An absolute overlay has zero layout width → document size and fit-scale are byte-for-byte unchanged, no hover reflow. Native scrollbars were deliberately NOT modified.

#### Preserved
Document display size, fullscreen work-screen height, PDF zoom scale, 1000% zoom, raster cap, renderedZoom, visualScale, and the inner PDF scroller are all unchanged. No `resize:` CSS anywhere in the viewer. All tools (symbols, S3/S4, glare, hide toggles, colors, opacity, rotation, arc line, circuit path, measure, Guide Assist, Work Packages, dot colors), save/sync, and the Move/Edit/Copy/Delete toolbar untouched.

**Lock released.**

---

### 2026-07-01 — Fullscreen Work Screen: Document Fills Viewport, Annotations Below (Step 13B-QA7-R5, NOT COMMITTED)

**Agent:** Claude Code (Fable 5, task labeled Opus)
**Mode:** Fullscreen layout restructure only — zoom math, raster cap, tools, save/sync untouched
**Branch:** main | HEAD = 43c538f
**Typecheck:** 0 errors ✅ | **Build:** ✅ 21.89s | **git diff --check:** PASS ✅

#### Wrapper that was shrinking the document
The fullscreen inner wrapper `'flex flex-1 min-h-0 flex-col gap-2'` made the PDF scroll area and the annotations panel SPLIT the same visible flex height — an expanded annotations drawer (`max-h-[38vh]`) stole up to 38vh from the document inside the fixed 100dvh shell (the R4 containment made the shell honest, which surfaced this split).

#### New fullscreen structure (immersive AND non-desktop native fullscreen)
fixed root (inline: fixed, 100vw×100dvh, overflow hidden — from R4) → pinned header/tool rows (flex-none) → container `flex-1 flex flex-col min-h-0` (now also applied to non-desktop `isFullScreenView`, whose branch was previously an empty class breaking the height chain) → **internal vertical scroller** (`flex-1 min-h-0 overflow-y-auto overflow-x-hidden`, `overscrollBehavior: contain`) → inner wrapper `contents` → **PDF scroll area `h-full`** (= exactly one full work screen; document fills all height below the tools) followed by the **annotations panel below** (`mt-2`, natural height, no max-h cap) — reached by scrolling down, never subtracting from the document. Percentage height resolves because `contents` makes the scroll area a box-child of the definite-height scroller.
Also parenthesized the long-standing `isFullScreenView || isTabletImmersiveFullscreen && !useDesktopThreePaneLayout` precedence quirk on the scroll-area class. Desktop three-pane fullscreen unchanged (its scroll area is height-styled by the grid branch). Default embedded mode unchanged (grid + R4 viewport clamp). Zoomed spacer still lives only inside `operations-pdf-scroll`. No `resize:` CSS exists in the viewer (corner handle in screenshots = V15r workspace panel, out of scope).

**Lock released.**

---

### 2026-07-01 — Fullscreen Root Containment + Scroll-Area Viewport Clamp (Step 13B-QA7-R4, NOT COMMITTED)

**Agent:** Claude Code (Fable 5)
**Mode:** Overflow/containment repair only — no tools, zoom math, raster cap, or layout branching changed
**Branch:** main | HEAD = 43c538f
**Typecheck:** 0 errors ✅ | **Build:** ✅ 16.00s | **git diff --check:** PASS ✅

#### Root cause 1 — fullscreen page growth (THE expanding ancestor)
The fullscreen/immersive viewer root's class list combined `fixed` with `relative` (`'fixed inset-0 z-[9999] … isolate relative'`, the `isolate relative` pair added in QA1/5a902b5 — matching exactly when "fullscreen expands the page" was first reported). Tailwind emits `.relative` AFTER `.fixed` in its position utilities, so at equal specificity the cascade resolved the root to `position: relative` — an ordinary in-flow element. `inset-0` became inert offsets, the root's height came from its content, and the zoomed document sized the entire app page. Fix: fullscreen branches now use inline styles that cannot lose a cascade fight — `position: fixed; top/left/right/bottom: 0; width: 100vw; height: 100dvh; maxWidth/maxHeight: 100vw/100dvh; overflow: hidden` — and the `fixed`/`relative`/`overflow-hidden`/`inset-0` classes were removed from those branches (kept `z-[9999] bg flex flex-col isolate`). Default embedded mode keeps its original classes/style untouched.

#### Root cause 2 — default-mode runaway height
`scrollAreaHeight` is measured as `window.innerHeight - toolbarArea.getBoundingClientRect().bottom`. If the page is scrolled past the toolbar when a resize event fires (iOS Safari URL-bar collapse fires resize on scroll), `bottom` is negative and the measured height EXCEEDS the viewport → the scroll area grows the page → more scrolling → more resize events (runaway growth). Fix: the default-mode scroll area height is now `min(measured, calc(100dvh - 140px))` with `maxHeight: calc(100dvh - 140px)` — the document viewport can never exceed the visible viewport; only its internal scroll pans the zoomed document.

#### Confirmed contained
The large zoom spacer (`visualDisplayWidth/Height`) and page frame transform live only inside `scrollAreaRef` (`overflow-scroll`, `overscroll-behavior: contain`) — no parent uses document-derived sizing. No `resize:` CSS exists in the viewer (the corner handle in the user's screenshot is the V15r workspace panel, outside this file). QA7 raster cap, renderedZoom/visualScale, 1000% zoom, R2/R3 tablet detection + stacked layout all preserved.

**Lock released.**

---

### 2026-07-01 — Emergency Layout Override: Three-Pane Never on Tablet/Immersive (Step 13B-QA7-R3, NOT COMMITTED)

**Agent:** Claude Code (Fable 5)
**Mode:** Two-line layout-decision repair guided by user's DevTools DOM screenshot
**Branch:** main | HEAD = 43c538f
**Typecheck:** 0 errors ✅ | **Build:** ✅ 16.63s | **git diff --check:** PASS ✅

#### Evidence from user screenshot (DevTools, responsive 1377×865, fullscreen active)
DOM showed viewer root `fixed inset-0 z-[9999]` containing the live desktop three-pane grid (`grid-template-columns: 343px 6px 1fr 6px 358px`) — `useDesktopThreePaneLayout` was still true.

#### Why R2's detection missed
R2's `isTouchFirstDevice()` required `maxTouchPoints > 1`. **Chrome DevTools device/responsive emulation reports `navigator.maxTouchPoints === 1`** (real iPads report 5), so emulated-iPad testing fell through both signals to the width check (1377 ≥ 1280) → desktop three-pane + native fullscreen.

#### Fix
1. `isTouchFirstDevice()`: `maxTouchPoints > 0` (still requires `pointer: coarse` primary pointer, so touch-screen laptops with mouse/trackpad stay desktop).
2. Hard override at the layout decision: `useDesktopThreePaneLayout = isDesktopBlueprintLayout && !isTabletImmersiveFullscreen && !isTabletDevice()` — the left-controls/right-annotations three-pane can never render while immersive fullscreen is active or on any tablet/touch-first device, regardless of width. Tablet default + fullscreen = tools top, document middle, annotations bottom.
QA7 raster cap, 1000% zoom, all tools/save/sync untouched.

**Lock released.**

---

### 2026-07-01 — iPad Fullscreen Renders Stacked Layout, Never Desktop 3-Column (Step 13B-QA7-R2, NOT COMMITTED)

**Agent:** Claude Code (Fable 5)
**Mode:** Device-detection hardening — no layout JSX changed this pass; QA7 raster cap and QA7-R bottom-annotations fix preserved
**Feature Area:** Blueprint Viewer — `shouldUseDesktopBlueprintLayout()` / `isTabletDevice()`
**Branch:** main | HEAD = 43c538f
**Typecheck:** 0 errors ✅ | **Build:** ✅ 18.28s (pre-existing chunk warnings only) | **git diff --check:** PASS ✅

#### Root cause of desktop 3-column fullscreen on iPad
Both `shouldUseDesktopBlueprintLayout()` (drives `useDesktopThreePaneLayout` = left controls column + right annotations column) and `isTabletDevice()` (routes the fullscreen button to immersive vs native/desktop fullscreen) relied on a single UA/platform sniff (`/iPad/` in UA, or MacIntel/Macintosh + maxTouchPoints > 1). When that sniff misses (DevTools iPad emulation without full touch emulation, third-party iPad browsers, UA changes), an iPad Pro landscape viewport (1366px ≥ 1280) falls straight into the desktop three-pane layout AND native desktop fullscreen — exactly the 3-column fullscreen in the user's screenshot. Width was effectively the deciding signal.

#### Fix
Refactored the duplicated sniff into `isIPadLikeDevice()` and added a capability-based `isTouchFirstDevice()` (`matchMedia('(pointer: coarse)')` + `maxTouchPoints > 1`). Now:
- `shouldUseDesktopBlueprintLayout()` = NOT iPad-like AND NOT touch-first AND width ≥ 1280 — a wide window is only "desktop" when both signals agree it isn't a touch device.
- `isTabletDevice()` = iPad-like OR touch-first — fullscreen routes to the immersive stacked overlay (2-row tool header top, document flex-1 middle, annotations bottom drawer max-h-[38vh], root fixed inset-0 overflow-hidden) whenever either signal fires. Touch-capable laptops keep a fine primary pointer → still desktop.
- QA7's raster budget also keys off `isTabletDevice()`, so the touch budget now covers the same devices consistently.
No JSX/layout branches were edited this pass — with detection fixed, the existing branches produce: iPad default = tools top / document middle / annotations bottom (QA7-R); iPad fullscreen = immersive stacked (never 3-column); desktop unchanged.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Restore Accepted iPad Layout, Keep QA7 Raster Cap (Step 13B-QA7-R, NOT COMMITTED)

**Agent:** Claude Code (Fable 5)
**Mode:** One-line layout branch fix + git-history audit — QA7 zoom/raster work fully preserved
**Feature Area:** Blueprint Viewer — default-mode iPad annotations panel placement
**Branch:** main | HEAD = 43c538f
**Typecheck:** 0 errors ✅ | **Build:** ✅ 17.63s (pre-existing chunk warnings only) | **git diff --check:** PASS ✅

#### Audit finding
Git-history comparison (462f1a5 → 43c538f → QA7 working tree) confirmed QA7's uncommitted diff contains ZERO layout/className changes — it is raster/zoom math only. The layout branches were also structurally stable across the recent commits except QA1 (5a902b5), which moved fullscreen/immersive annotations to the bottom drawer (`max-h-[38vh]`) — i.e. TOWARD the accepted layout. The one branch still contradicting the accepted iPad layout: the default-mode container `grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]`. Since `useDesktopThreePaneLayout` already captures every non-iPad browser ≥1280px, that `xl:` side column was reachable ONLY on iPad-Pro-landscape-width devices (1366px ≥ xl 1280) — on exactly those iPads it moved the annotations panel from the bottom to a 300px right sidebar.

#### Fix
Default-mode container is now always single-column: `grid grid-cols-1 gap-3 sm:gap-4` (annotations panel renders full-width BELOW the document scroll area, bounded by its existing `max-h-56` expanded / `h-10` collapsed classes). No effect on any non-iPad device: desktop ≥1280 takes the three-pane branch, everything else was already below the xl breakpoint. Fullscreen/immersive branches untouched (already: tools top via 2-row header, document `flex-1` middle, annotations bottom drawer). QA7's raster budgets, `renderedZoom` bookkeeping, and 1000% zoom are untouched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Repair iPad Default/Fullscreen Viewport After 1000% Zoom (Step 13B-QA7, NOT COMMITTED)

**Agent:** Claude Code (Fable 5)
**Mode:** Rendering-pipeline repair — zoom UX/math preserved, no annotation data model or persistence touched
**Feature Area:** Blueprint Viewer — PDF canvas raster sizing, zoom containment, iPad Safari stability
**Branch:** main | HEAD = 43c538f
**Typecheck:** 0 errors ✅ | **Build:** ✅ 16.67s (pre-existing chunk-size warnings only) | **git diff --check:** PASS ✅

#### Root cause
Step 13B-QA3 raised `MAX_RELATIVE_ZOOM_*`/`MAX_RENDER_SCALE` from 4.5 to 10. The render effect rasters the PDF canvas at the FULL committed zoom (`fitScale × relativeZoom`), and the annotation SVG overlays are sized to the same `displaySize`. At high zoom on large sheets this produces 50–100M-pixel canvases/layers. iPad Safari silently paints nothing past ~16.7M px (canvas area) / 8192px (texture dimension) — blank documents, dropped annotation layers (document-size dependent → "some documents"; default vs fullscreen differ because fit scale differs), and giant composited elements destabilizing the viewport. Pre-QA3, mobile already implicitly relied on the absolute 4.5 render cap keeping canvases under these limits.

#### Fix (all in OperationsBlueprintPdfViewer.tsx)
- New raster budgets: `MAX_CANVAS_AREA_TOUCH = 15M px` / `MAX_CANVAS_AREA_DESKTOP = 33M px`, plus per-dimension caps 8000/16000. Render effect computes `actualRenderScale = min(MAX_RENDER_SCALE, maxAreaScale, maxDimScale, fitScale × relativeZoom)` — the canvas is never rastered past what the platform can paint.
- New `renderedZoom` (ref + state): the relative zoom the current raster actually represents (`actualRenderScale / fitScale`), recorded on every successful render, reset to 1 in `clearDoc`.
- The zoom remainder (up to the full 1000%) is carried by the existing CSS `visualScale` transform on `pageFrameRef` (same mechanism as the live pinch preview): `visualScale = livePinchZoom / renderedZoom` instead of `/ relativeZoom`. All 4 gesture-math sites (`handleWheel`, pinch start, pinch move, `endTouchPointer`) now derive visual page sizes from `renderedZoomRef`; the post-render pinch-anchor application multiplies by the commit visual scale.
- Zoom state machine (`relativeZoom`, clamps, buttons, % label, Fit Full Page reset) untouched — max zoom stays 1000%.

#### Containment
Zoom scales the document inside the existing scroll container (`scrollAreaRef`, `overflow-scroll`, explicit height in every mode) via the spacer div + transform; the outer app shell never grows. This architecture was already correct — the instability came from the oversized rasters, not the containers, so no layout container was changed.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Match Annotation List Dot Color to Placed Shape Color (Step 13B-QA6, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** UI-only display fix — no annotation save format, scope layer persistence, or Work Package data model touched
**Feature Area:** Blueprint Viewer — annotations side panel list dot/bullet color, Work Package "Selected Items" list indicator
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ (`npm run typecheck`, whole project) | **Build:** ✅ 0 errors, 14.75s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅ (exit 0)

#### Root cause
The annotations-list row dot ([OperationsBlueprintPdfViewer.tsx:7902](src/components/blueprint/OperationsBlueprintPdfViewer.tsx), inside `AnnotationRow`) rendered `backgroundColor: a.color || '#facc15'` — reading only the annotation's top-level `color` field. But the canvas renderer for every `type: 'shape'` annotation (which covers electrical symbols, can lights, generic shapes, lines, arc lines, circuit paths, and polylines — all differentiated only by `meta.shapeKind`) resolves its visible border/stroke color as `meta.borderColor || (a.color || default)` ([OperationsBlueprintPdfViewer.tsx:6716](src/components/blueprint/OperationsBlueprintPdfViewer.tsx), reused identically at the electrical-symbol/can-light/generic-shape render branches). Critically, the color-edit popover for shapes persists color changes to `meta.borderColor` via `persistEditAnnotationMeta({ borderColor: c })` ([OperationsBlueprintPdfViewer.tsx:5442](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) — **not** back onto `a.color`. So any Recessed Light (or other shape/symbol) whose color was changed after initial placement kept showing its original/default dot color in the list while the canvas correctly showed the new color — exactly the reported mismatch ("all Recessed Lights the same category color" instead of each one's actual placed color).

#### Fix
- New helper `getAnnotationDisplayColor(annotation, fallback = '#facc15')` added directly after `annotationLabel()` ([OperationsBlueprintPdfViewer.tsx:1259](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)): for `annotation.type === 'shape'`, returns `meta.borderColor` if set, otherwise falls back to `annotation.color || fallback` — an exact mirror of the canvas's own priority, reusing the existing `getAnnotationMeta()` helper (no new meta-reading logic invented).
- `AnnotationRow`'s dot ([OperationsBlueprintPdfViewer.tsx:7902](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) now calls `getAnnotationDisplayColor(a)` instead of `a.color || '#facc15'` directly. This row is shared by every non-"generate" annotation group in the list (text inserts, highlights, underlines, notes, callouts, pen/marker, shapes/electrical symbols/can lights/lines/arc lines/circuit paths/polylines, measurements) — non-shape types (notes, pen, marker, highlights, etc.) are unaffected since they only ever set `a.color` directly and have no `meta.borderColor` concept, so the helper falls through to the exact same `a.color || fallback` it used before.
- `GeneratedRow` (RFI/Coordination Question entries, [OperationsBlueprintPdfViewer.tsx:7952](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) was intentionally left on its hardcoded `bg-amber-400` dot — these aren't placed shapes/symbols with a user-selected color, they're a fixed category indicator (RFI vs. Coordination), so there is no "actual placed color" to match.
- Work Package modal's "Selected Items" list ([OperationsBlueprintPdfViewer.tsx:8277-8287](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) previously showed only plain text (`Pg N: label`) with no color indicator at all. Added a small dot per row, resolved by looking up the matching annotation from the already-computed `selectedPackageAnnotations` array (by `item.annotationId`) and calling the same `getAnnotationDisplayColor()` helper — so when building a Work Package, the selected-items summary now shows the same color as the main list and the canvas, helping the user visually confirm they selected the correct colored fixtures (e.g., only the green Recessed Lights) before saving.

#### Color fields used, in priority order
1. `meta.borderColor` (only for `type === 'shape'` — covers electrical symbols, can lights, generic shapes, lines, arc lines, circuit paths, polylines) — this is what the color-edit popover writes and what the canvas renders first.
2. `annotation.color` (top-level field, set at creation time for every annotation type, and still the only color field for non-shape types like notes/pen/marker/highlights).
3. `'#facc15'` (existing default amber, unchanged — used when neither field is set, e.g. very old annotations).

No `meta.strokeColor` / `meta.fillColor` / `meta.lightColor` / `meta.symbolColor` fields exist anywhere in this codebase's annotation model — verified by grep before writing the helper — so only the two real fields above (plus the pre-existing default) were wired in.

#### Confirmed
- Electrical symbols and can lights: use their actual canvas `meta.borderColor`/`a.color` via the shared `type === 'shape'` code path — no separate logic needed since they render through the identical branch as generic shapes.
- Generic shapes, lines, arc lines, circuit paths, polylines: all `type: 'shape'` with different `meta.shapeKind` values, all covered by the same helper/priority.
- Work Package selection rows ("Selected Items" list in the Create/Edit Work Package modal) now show a matching color dot.
- Annotation grouping, checkbox selection, delete buttons, selected-count display, isolate-package eye toggle, and Work Package creation/save flow: none of that logic was touched — this pass only changed what color value feeds two `style={{ backgroundColor }}` spans.
- Save safety guards (`checkManualSaveFreshness`, `resolveSyncGuardError`, stale-overwrite guards, snapshot-before-overwrite, remote-baseline tracking): not touched, not opened this pass.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `src/services/blueprintLibraryService.ts` was not opened — this was resolvable entirely from data already available on the client (`meta`/`color` already pass through `sanitizeAnnotation()` unfiltered from prior QA passes), so no service-layer change was needed.
- Multi-Point Measure open path, Circuit Path distance, Arc Line shape, Measure calibration, compact symbol selection boxes, center-to-center Guide Assist, zoom to 1000%, symbol rotation, fullscreen controls, S3/S4, light output/glare, Work Package persistence/isolate, Shapes dropdown, sync status behavior — no logic in any of these paths was modified.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Blueprint Banner De-Spam + conflictCode Classification + 20-Minute Source Dedupe (Step 13B-QA5-R4B, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** UX/status-lifecycle repair, additive classification only — no sync guard, freshness, or overwrite logic touched
**Feature Area:** Blueprint viewer's `syncNotice` banner, backupDataService's conflict-event classification/dedupe, header status/tap wording alignment
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ (`npm run typecheck`, whole project) | **Build:** ✅ 0 errors, 23.91s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅ (exit 0)

This is a direct follow-up to Step 13B-QA5-R4 (same task title, expanded scope): R4 fixed the **header** status label; this pass fixes the **Blueprint canvas banner** that was still repeating the raw guard text, plus adds the explicit `conflictCode` classification and widens the source-level dedupe window that R4 introduced at 60s to the full 20 minutes the task specified.

#### Root cause of the repeating Blueprint banner
`showTransientSyncNotice()` in `OperationsBlueprintPdfViewer.tsx` had **no dedupe at all** — every call replaced `syncNotice` and reset its 8s auto-dismiss timer. Three call sites (`persistAnnotation`, `removeAnnotation`, `persistScopeLayers`) called it with the raw guard message (`saveResult.warning` / `result.warning`, sourced from `blueprintLibraryService.ts`'s hardcoded remote-newer text) every single time a local save succeeded but cloud sync was guard-blocked. During active Blueprint editing (drawing, moving shapes, placing symbols) this fires on nearly every interaction, so the large top-center amber banner ("Cloud sync was blocked because remote data is newer than this local session...") kept re-appearing continuously instead of the intended "once, then quiet."

#### Fix — Blueprint banner suppression
- New `syncBlockedNoticeShownRef` ([OperationsBlueprintPdfViewer.tsx:1501-1505](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) and `showSyncPausedNoticeOnce()` helper ([OperationsBlueprintPdfViewer.tsx:2109-2121](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)): shows the banner with the calm, task-specified text **`"Saved locally — cloud paused until reload."`** exactly once per unresolved conflict, then silently no-ops on every subsequent call until the gate is reset.
- All 5 sync-blocked call sites (`persistAnnotation`'s success-with-warning branch and its catch's `isSyncBlockedMessage` branch, `removeAnnotation`'s equivalent two branches, `persistScopeLayers`'s warning branch) now call `showSyncPausedNoticeOnce()` instead of `showTransientSyncNotice(rawGuardMessage + suffix)`. `showTransientSyncNotice` itself is untouched and still used as-is for its other legitimate purposes (Circuit Path "calibrate to show distance" hint, "Calibrate measure first." measure-tool prompts) — those are unrelated to the sync guard and were never part of the spam.
- `clearStaleSyncMessages()` ([OperationsBlueprintPdfViewer.tsx:2090-2099](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) now also resets `syncBlockedNoticeShownRef.current = false` — the same function already called on every `cloudSynced: true` result and on `poweron:data-saved`, so the gate re-arms automatically the moment the conflict actually resolves.
- New listener: the viewer now also listens for `poweron:sync-success` ([OperationsBlueprintPdfViewer.tsx:2569-2578](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) and calls `clearStaleSyncMessages()` on it — previously the viewer only reacted to its own save's `cloudSynced` flag, so a conflict resolved by an *unrelated* successful sync (e.g. periodic sync succeeding while no Blueprint edit was in flight) would leave the gate stuck shown-once/suppressed with no way to re-arm until the page reloaded.

#### Remote-newer conflict classification (Part 1)
Added an explicit, reliable `conflictCode` to the event payload instead of relying only on message-string matching:
- New exported type `SyncConflictCode = 'remote-newer' | 'no-baseline' | 'unknown'` and `resolveSyncGuardCode()` ([backupDataService.ts](src/services/backupDataService.ts), mirrors `resolveSyncGuardError`'s exact branches) — classifies every guard block deterministically from the same freshness data already computed for the error message, no new risk to the guard logic itself (pure additional classification, zero behavior change).
- `dispatchSyncConflict(error, source, code)` now includes `conflictCode` in `detail` alongside the existing `error`/`source` fields (both call sites — `syncToSupabase`'s guard and `forceSyncToCloud`'s pre-stamp guard — updated to pass the resolved code).
- `V15rLayout.tsx`'s `handleSyncConflict` reads `detail.conflictCode` and documents that all three codes get identical `'paused'` treatment today (since `dispatchSyncConflict` is exclusively guard-driven, never a real failure) — the code is available for any future listener that wants to react differently per sub-reason, without needing to parse message text.

#### Source-level dedupe widened to 20 minutes (Part 5)
R4 had introduced a 60-second dedupe inside `dispatchSyncConflict`; this pass widens `CONFLICT_DISPATCH_DEDUPE_MS` to `20 * 60 * 1000` to match the task's explicit "suppress repeated identical remote-newer conflict events for at least 20 minutes" and the existing UI-side toast throttle window, so both layers now agree. A genuinely different guard message is never suppressed (dedupe key is the exact message string). `_lastConflictDispatch` is cleared the instant `syncToSupabase()` succeeds (same success branch as the existing `poweron:sync-success` dispatch) — a real resolution is never held back by the window.

#### Header/tap wording alignment
The header tap-guidance toast (shown when tapping a `'paused'` status) now uses the exact task-specified sentence — `"Cloud sync is paused because newer remote data exists. Reload latest before cloud syncing."` — matching the conflict-toast wording exactly instead of a shorter paraphrase, for consistency across the two surfaces.

#### Whether dispatchSyncConflict was changed
Yes — added an optional third `code` parameter and the `conflictCode` field in the event detail, and widened the internal dedupe window from 60s to 20 minutes. Its two call sites, the `error`/`source` fields, and the guard logic that decides *whether* to block are all unchanged.

#### How paused/conflict state clears after success/reload
- Backend: `_lastConflictDispatch` cleared in `syncToSupabase()`'s success branch (unchanged location from R4, just re-verified).
- Header: `poweron:sync-success` listener sets `syncStatus('synced')` immediately (unchanged from R4/R3).
- Blueprint: `poweron:sync-success` (new listener, this pass) and `poweron:data-saved`/a `cloudSynced: true` save result all call `clearStaleSyncMessages()`, which clears the visible `syncNotice`, cancels its timer, and resets `syncBlockedNoticeShownRef` so a *future* conflict can show its own one-time banner.

#### Preserved (verified untouched)
- **Save safety guards unchanged**: `checkManualSaveFreshness`, `resolveSyncGuardError`, the stale-overwrite guard in `syncToSupabase`/`forceSyncToCloud`, header-save freshness guard, safety-snapshot-before-overwrite, remote-baseline tracking, and `allowOverwriteNewerRemote`/snapshot-restore-bypass semantics were not touched. `resolveSyncGuardCode` is a pure, additive read of the same freshness data — it cannot change whether a write is blocked.
- True network/auth/unknown sync failures are unaffected — those never call `dispatchSyncConflict` and still flow through `handleHeaderSaveLiveData`'s/the retry-tap's `catch`/`else` branches straight to `setSyncStatus('failed')` with "Sync failed" wording, exactly as before R4/this pass.
- Multi-Point Measure open-path rendering, Circuit Path distance/placement, Arc Line final shape, Measure calibration, compact electrical symbol selection bounds, Guide Assist center-to-center, zoom-to-1000%, symbol rotation, fullscreen controls, S3/S4 symbols, light output/glare, Work Package persistence/isolate, Shapes dropdown cleanup — no logic in any of these paths was touched.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `blueprintLibraryService.ts` was inspected (to confirm `warning` fields are always guard-blocked-family text) but required zero changes.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`, `src/components/v15r/V15rLayout.tsx`, and `src/services/backupDataService.ts` are free for other agents.

---

### 2026-07-01 — Replace Remote-Newer Sync Failed Spam With Quiet Cloud Paused State (Step 13B-QA5-R4, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** UX/status-state repair only — no sync guard, freshness, or overwrite logic touched
**Feature Area:** Header sync status indicator + conflict toast, for the stale-overwrite safety guard specifically
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ (`npm run typecheck`, whole project) | **Build:** ✅ 0 errors, 14.70s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅ (exit 0)

#### Root cause of repeated "Sync Failed" status
`dispatchSyncConflict()` ([backupDataService.ts](src/services/backupDataService.ts)) is called **exclusively** from the stale-overwrite safety guard inside `syncToSupabase()` and `forceSyncToCloud()` — never from a real network/auth/unknown error. But the `poweron:sync-conflict` listener in `V15rLayout.tsx` set `setSyncStatus('failed')` every time it fired, using the same scary red "Sync failed — tap to retry" label as a genuine sync error. While remote stayed newer than the local session and local edits kept marking `_dataChanged`, `startPeriodicSync()` retried every `SYNC_INTERVAL_MS` (13s) and the guard correctly re-blocked each attempt — so the header sat on "Sync Failed" almost continuously (QA5-R had already throttled the *toast* to once per 20 minutes, but the persistent header label itself was still the alarming "failed" wording the whole time). This is a safety guard working exactly as designed, not a failure — the local save was always succeeding.

#### New status used for the remote-newer safety block
Added `'paused'` to the `syncStatus` union: `'idle' | 'syncing' | 'synced' | 'failed' | 'paused'` ([V15rLayout.tsx:286-289](src/components/v15r/V15rLayout.tsx)). `'failed'` is now reserved for genuine sync errors (Supabase not configured, network/auth errors, unknown write failures) — those code paths were left untouched. Every code path that reacts to the guard blocking a write (`handleSyncConflict` for `poweron:sync-conflict`, the manual retry-tap's `result.blocked` branch, and `handleHeaderSaveLiveData`'s `result.blocked` branch) now sets `'paused'` instead of `'failed'`.

#### Header label
- Status dot: new `bg-orange-400` for `paused` (distinct from green/synced, yellow-pulse/syncing, red/failed).
- Label text: `Cloud paused — saved locally <relative time>` (amber `text-amber-400`), replacing what would have been "Sync failed — tap to retry" for this condition — matches the task's "Saved locally — cloud paused until reload" intent without claiming lost work.
- Tooltip: `Cloud sync paused — tap for details`.

#### Tap behavior
The header button's `onClick` now checks `syncStatus === 'paused'` first and **returns early with a guidance toast** — `"Reload latest remote data before syncing to cloud."` (5s) — instead of falling into the existing blind-retry branch (which only still runs for `'failed'`/`'idle'`). Tapping a paused status can no longer re-trigger the same blocked sync in a loop.

#### Toast dedupe/spam fix
Two layers, both scoped to the stale-overwrite guard only:
1. **UI-side (already existed from QA5-R, reused here):** `handleSyncConflict`'s 20-minute per-message suppression window (`SYNC_CONFLICT_SUPPRESS_MS`) is unchanged — still only shows the explanatory toast once per unresolved conflict, not on every retry tick. The toast text itself was changed from the raw technical guard string to the calmer, task-specified copy: `"Cloud sync is paused because newer remote data exists. Reload latest before cloud syncing."` (`SYNC_PAUSED_TOAST_MSG`, declared once inside the effect and reused by both the conflict handler and the success-clear comparison).
2. **Source-side (new, Part 6):** `dispatchSyncConflict()` itself now dedupes identical messages within `CONFLICT_DISPATCH_DEDUPE_MS` (1 minute) via a new module-level `_lastConflictDispatch` ref — the periodic-sync loop retrying an unresolved conflict every 13s no longer re-dispatches the `poweron:sync-conflict` event (and its `console.warn`) on every tick, only once per minute at most. A genuinely different guard message (e.g. flips from "remote newer" to "no verified baseline") is never suppressed, since the dedupe key is the exact message string. Cleared immediately (`_lastConflictDispatch = null`) the moment `syncToSupabase()` succeeds, right alongside the existing `poweron:sync-success` dispatch — so a real resolution is picked up instantly, not throttled.

#### Was `dispatchSyncConflict` changed?
Yes, but only to add the 1-minute source-level dedupe described above — its call sites, its `error`/`source` parameters, and the event payload shape (`detail: { error, source }`) are all unchanged. `resolveSyncGuardError`, `SYNC_BLOCKED_REMOTE_NEWER_MSG`, `SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG`, `REMOTE_FRESHNESS_UNKNOWN_MSG`, and every guard-evaluation function (`checkManualSaveFreshness`, the stale-overwrite checks in `syncToSupabase`/`forceSyncToCloud`) are untouched.

#### How paused/conflict state clears after success
Unchanged mechanism from QA5-R3, now correctly clearing `'paused'` too since `handleSyncSuccessEvent` always sets `setSyncStatus('synced')` regardless of which non-synced state preceded it: a real `syncToSupabase()` success dispatches `poweron:sync-success` (with `savedBy`/`savedAt`), the listener sets `syncStatus('synced')` immediately, updates `lastSyncTime`/`lastSyncDevice` from the event detail, clears `lastSyncConflictRef`, and dismisses the toast if it's still showing the exact `SYNC_PAUSED_TOAST_MSG` text (never clobbers an unrelated toast). The new source-level `_lastConflictDispatch` dedupe is cleared in the same success branch in `backupDataService.ts`.

#### Preserved (verified untouched)
- **Save safety guards unchanged**: `checkManualSaveFreshness`, `resolveSyncGuardError`, the stale-overwrite guard in `syncToSupabase`, `forceSyncToCloud`'s pre-stamp guard, header-save freshness guard, safety-snapshot-before-overwrite, remote-baseline tracking (`setKnownRemoteBaseline`), and `allowOverwriteNewerRemote`/snapshot-restore-bypass semantics were not touched — a genuinely newer remote still blocks every write attempt exactly as before, and no new caller passes `allowOverwriteNewerRemote` for a normal save. This pass only changed which *status label* the UI shows for an already-correct block, plus how often the underlying event fires for an unresolved one.
- Multi-Point Measure open-path rendering (QA5-R2), Circuit Path distance/placement, Arc Line final shape, Measure calibration, compact electrical symbol selection bounds, Guide Assist center-to-center, zoom-to-1000%, symbol rotation, fullscreen controls, S3/S4 symbols, light output/glare, Work Package persistence/isolate — no logic in any of these paths was touched.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched.

**Lock released** — `src/components/v15r/V15rLayout.tsx` and `src/services/backupDataService.ts` are free for other agents.

---

### 2026-07-01 — Sync Failed Status Clears After Successful Save (Step 13B-QA5-R3, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Status-lifecycle repair only — no sync guard, freshness, or snapshot logic touched
**Feature Area:** Blueprint/App header — cloud sync status indicator + conflict toast
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ (`npm run typecheck`, whole project) | **Build:** ✅ 0 errors, 17.49s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅ (exit 0)

#### Root cause
In the Step 13B-QA5-R conflict-dedupe effect ([V15rLayout.tsx:375-399](src/components/v15r/V15rLayout.tsx)), `handleSyncConflict` correctly set `setSyncStatus('failed')` when `poweron:sync-conflict` fired (a real stale-overwrite block from `syncToSupabase`'s guard). But the listener registered for the success events — `clearSyncConflictSuppression`, bound to both `poweron:sync-success` and `poweron:data-saved` — only reset the dedupe ref (`lastSyncConflictRef.current = null`); it never called `setSyncStatus('synced')` or touched the visible toast. So once the header flipped to "Sync Failed", the *only* thing that could clear it back to "Synced" was the unrelated 30s status-poll `setInterval` ([V15rLayout.tsx:358-365](src/components/v15r/V15rLayout.tsx)), which only fires if `getLastSyncMeta()?.savedBy` happens to be truthy at that tick — meaning the header could show a stale "Sync Failed" for up to ~30 seconds (or longer if that interval wasn't running) after the app had already saved successfully, exactly matching the report.

#### Fix
[V15rLayout.tsx:388-411](src/components/v15r/V15rLayout.tsx): replaced the shared `clearSyncConflictSuppression` handler on `poweron:sync-success` with a dedicated `handleSyncSuccessEvent`:
- Clears `lastSyncConflictRef` (unchanged behavior).
- Calls `setSyncStatus('synced')` immediately — this is the actual fix, making the header reflect success the instant the real cloud write completes rather than waiting on the polling interval.
- Reads the event's existing `detail: { savedBy, savedAt }` (already dispatched by `syncToSupabase` at [backupDataService.ts:1819](src/services/backupDataService.ts) — unmodified) to update `lastSyncTime`/`lastSyncDevice` with the actual sync timestamp/device instead of `Date.now()`.
- Only dismisses the toast if it is still showing the *exact* conflict message that was suppressed (`current === conflictMessage`, checked via functional `setToastMessage` update) — never clobbers an unrelated toast that happens to be visible at the same moment.
- `poweron:data-saved` keeps the old `clearSyncConflictSuppression` (dedupe-ref-only) behavior, since that event only signals a local save, not a confirmed cloud sync, and (per the QA5-R note) is not dispatched anywhere in this codebase today anyway — no incorrect "synced" flip could happen from a merely-local save once/if that event starts firing.

#### Which success event clears the state
`poweron:sync-success`, dispatched from `syncToSupabase()` ([backupDataService.ts:1819](src/services/backupDataService.ts)) on every successful Supabase write — covers periodic sync (`startPeriodicSync` → `syncToSupabase`), header "Save Live Data" (`forceSyncToCloud` → `syncToSupabase`), and the header status button's manual retry-tap (calls `forceSyncToCloud` directly), since all three funnel through the same `syncToSupabase` success path. No new event was added; **`poweron:sync-success` and `poweron:data-saved` dispatch sites in `backupDataService.ts` were not modified** — both already fired with the payload this fix needed.

#### Verified: blocked → later success clears correctly
- `poweron:sync-conflict` fires (stale-overwrite guard blocks a write) → header flips to "Sync Failed", one throttled toast shown (20-minute dedupe from QA5-R, untouched).
- A later sync succeeds (remote catches up, or the guard passes on retry) → `poweron:sync-success` fires → header flips to "Synced" **immediately**, the conflict toast (if still visible) is dismissed, `lastSyncConflictRef` is cleared so a *new* future conflict can surface its own toast without waiting out the old 20-minute window.

#### Preserved (verified untouched)
- **Save safety guards unchanged**: `checkManualSaveFreshness`, `resolveSyncGuardError`, `dispatchSyncConflict`'s call sites/payload, the stale-overwrite guard in `syncToSupabase`, `forceSyncToCloud`'s pre-stamp guard, and `allowOverwriteNewerRemote` semantics were not touched — a genuinely newer remote still blocks every write attempt exactly as before. No new caller passes `allowOverwriteNewerRemote` for a normal save.
- Header-save freshness guard, safety-snapshot-before-overwrite (`createHeaderSaveSafetySnapshot`), and remote-baseline tracking (`setKnownRemoteBaseline`) — untouched.
- The QA5-R 20-minute duplicate-conflict-toast throttle (`SYNC_CONFLICT_SUPPRESS_MS`, `handleSyncConflict`'s `isDuplicate` check) is completely unmodified — only the *success* side of the effect changed.
- `handleHeaderSaveLiveData`'s own direct `setSyncStatus('synced')` on success ([V15rLayout.tsx:734](src/components/v15r/V15rLayout.tsx)) and the status-button retry handler's own direct success/failure branches were not touched — they already worked correctly for their own immediate call; this fix specifically closes the gap for *out-of-band* successes (e.g., a periodic sync succeeding after an earlier manual save was blocked).
- Multi-Point Measure open-path rendering (QA5-R2), Circuit Path distance/placement, Arc Line final shape, Measure calibration, compact electrical symbol selection bounds, Guide Assist center-to-center, zoom-to-1000%, symbol rotation, fullscreen controls, S3/S4 symbols, light output/glare, Work Package persistence/isolate — no logic in any of these paths was touched; this pass only edited one `useEffect` in `V15rLayout.tsx`.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `backupDataService.ts` was inspected (to confirm `poweron:sync-success`'s existing detail payload and that every success path already funnels through it) but required zero changes.

**Lock released** — `src/components/v15r/V15rLayout.tsx` is free for other agents.

---

### 2026-07-01 — Open Multi-Point Measure Path Repair (Step 13B-QA5-R2, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Single scoped rendering fix — no distance-calc or finalize logic changed
**Feature Area:** Blueprint Viewer — finalized Multi-Point Measure (`measure-perimeter`) annotation rendering
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ (`npm run typecheck`, whole project) | **Build:** ✅ 0 errors, 15.78s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅ (exit 0)

#### Root cause
The **finalized** `measure-perimeter` annotation render ([OperationsBlueprintPdfViewer.tsx:7158](src/components/blueprint/OperationsBlueprintPdfViewer.tsx), inside the main annotation-map loop) drew the committed path with an SVG `<polygon>`. `<polygon>` always implicitly closes its point list by drawing an extra segment from the last point back to the first — this is what produced the unwanted perimeter/closed-shape look the user reported, purely a rendering artifact. It only affected the *finalized* (saved) annotation: the **live in-progress draft** ([OperationsBlueprintPdfViewer.tsx:7314-7338](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) already correctly used `<polyline>` for every tool except `measure-area`, so the path looked open while drawing and only "snapped shut" the instant it was committed/reloaded. The distance-sum math ([OperationsBlueprintPdfViewer.tsx:3331-3335](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) was already correct — it only ever summed consecutive segments `i=1..N` and never added a closing `pointN → point1` term — so no distance-calc change was needed; only the visual was wrong.

#### Fix
- [OperationsBlueprintPdfViewer.tsx:7158](src/components/blueprint/OperationsBlueprintPdfViewer.tsx): changed the finalized `measure-perimeter` branch from `<polygon>` to `<polyline>` (same points, stroke, markers, `strokeLinejoin` — only the element tag changed). The sibling `measure-area` branch (line 7161, true closed-area tool, unaffected/unchanged) still renders `<polygon>` with fill, since Area is meant to be a closed shape and was explicitly out of scope to preserve.
- [OperationsBlueprintPdfViewer.tsx:3342,3348](src/components/blueprint/OperationsBlueprintPdfViewer.tsx): added explicit `closed: false` to both the calibrated and not-calibrated `meta` branches for `measure-perimeter`, alongside the pre-existing `measureType: 'multi-point'` — makes the open-path intent explicit in stored data (previously implicit/absent), no behavior change since nothing read `meta.closed` for this type before.
- No change to how points are captured, how Stop Measuring finalizes (`measurePendingCommit` effect, still adds every clicked point in order, no closing point appended), or to `points` array construction anywhere — a user who intentionally clicks back near their first point still gets a visually "closed-looking" path, because that's what they placed, not because the renderer forces it.

#### Verified behavior
- 4 points clicked in an open arrangement → Stop Measuring → path renders as 3 open segments (1→2, 2→3, 3→4), no 4→1 closing line, total distance = sum of those 3 segments only.
- Placing the last point intentionally back near point 1 → still renders correctly (it's just point 4 sitting near point 1's coordinates — no different code path, no forced closure).
- Circuit Path and Polyline (`kind === 'circuit-path'` / `'polyline'`, [OperationsBlueprintPdfViewer.tsx:6758](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) were inspected and already use `<polyline>` — completely untouched by this fix, confirmed still open-path and still showing distance for Circuit Path.
- Measure Area (`measure-area`) closed-polygon rendering, fill pattern, and area-sum math untouched — still closes intentionally, as designed.

#### Preserved (verified untouched)
- Circuit Path placement/snap/distance/persistence, Polyline drawing, Arc Line final shape, Measure calibration, compact electrical symbol selection bounds, Guide Assist center-to-center, zoom-to-1000%, symbol rotation, fullscreen controls, Shapes dropdown, S3/S4 symbols/labels, all light output/glare behavior, Hide Lighting Effects, Hide Labels, Work Package persistence/isolate eye toggle, header-save safety guards/snapshots/freshness guard, sync-conflict toast throttle — no logic in any of these paths was touched; this pass changed one JSX element tag plus two additive `meta.closed` keys.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `blueprintLibraryService.ts` required zero changes for this fix (not opened this pass; its uncommitted QA4 diff is pre-existing).

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Multi-Point Measure Finalize + Circuit Path Distance + Sync-Blocked Toast Spam Repair (Step 13B-QA5-R, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped QA repair — 3 independent fixes preserving all Step 12/13/QA1-5 work
**Feature Area:** Blueprint Viewer — Multi-Point Measure finalize, Circuit Path distance, global cloud-sync-blocked toast spam
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ (`tsc --noEmit`, whole project) | **Build:** ✅ 0 errors, 14.71s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅ (exit 0)

#### Part 1/2 — Multi-Point Measure: Stop Measuring erased the path instead of finalizing it
- **Root cause:** the "Stop Measuring" button cleared `measureDraftPoints`/`measureDraftRef` (the live-draft render source) synchronously, then queued the finalized annotation via `setMeasurePendingCommit(...)`, processed by a separate `useEffect`. That effect called `persistAnnotation(ann)` — an **async** local-save + cloud-sync round trip — but never added the new annotation to `allAnnotations` itself; it relied entirely on `persistAnnotation`'s `finally` block calling `loadAnnotations()` once the mutation queue drained. Result: the draft vanished immediately on click, and nothing re-appeared until the async save/reload resolved (or never, if calibration was missing, since the effect returned early with only a toast and no annotation at all). This is exactly the reported "whole measure line disappears" bug. Circuit Path/Polyline (`finalizePathDraft`) never had this bug because it already called `setAllAnnotations((prev) => [...prev, ann])` optimistically before persisting.
- **Fix** ([OperationsBlueprintPdfViewer.tsx:3251](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)): the `measurePendingCommit` effect now adds the finalized annotation to `allAnnotations` optimistically (`setAllAnnotations((prev) => [...prev, ann])`) before calling `persistAnnotation`, matching the pattern already proven for Circuit Path/Polyline — the path is visible on the very next render, with no gap.
- **Calibration is no longer required to finalize a multi-point measure.** Previously the effect bailed out entirely (no annotation created) when the page had no calibration. Now, only for `measure-perimeter` (Multi-Point Measure), the early-return is skipped: the path still commits and renders with `meta.label = 'Calibrate measure first.'` (shown on-canvas next to the path, using the annotation's existing label-rendering) plus the existing transient toast. `measure-distance`/`measure-area` keep their prior no-calibration behavior unchanged (silent discard + toast) since neither was reported broken and both are out of scope.
- **Total distance calc (unchanged math, now always reaches render):** sum of consecutive segment lengths (`Math.hypot` between each pair, i=1..N), divided by the calibrated scale (manual calibration takes precedence over single-candidate auto-detected scale — same precedence already used elsewhere). Stored as `meta.realWorldPerimeter` (pre-existing field) plus new `meta.totalDistance` (same value, added per the task's preferred meta shape) and `meta.measureType: 'multi-point'`, `meta.calibrated: true|false`. Label text changed from `"12.34 ft"` to `"Total: 12.34 ft"` for on-canvas clarity per the QA ask; this only affects the multi-point/perimeter tool's committed label, not distance/area.
- Cancel (discard-without-persisting) was already correct and untouched — it only clears the draft refs/state, never reaches the commit effect.

#### Part 3/4 — Circuit Path: no distance shown
- **Root cause:** `finalizePathDraft()` (shared by Circuit Path and Polyline) never computed a distance at all — it only stored `meta.points`/`pathType`/`closed`.
- **Fix** ([OperationsBlueprintPdfViewer.tsx:3210](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)): for `shapeKind === 'circuit-path'` only (Polyline is unaffected — no distance requirement was requested for it), finalize now reads the same manual-over-auto calibration precedence used by the measure tools and, on the current page:
  - **Calibrated:** sums consecutive segment lengths across `meta.points`, divides by scale, stores `meta.totalDistance`, `meta.distanceUnit`, `meta.distanceLabel = "Total: X.XX ft"`.
  - **Not calibrated:** stores `meta.distanceLabel = "Circuit path saved — calibrate measure to show distance."` and fires the same non-blocking transient toast (`showTransientSyncNotice`) — the path still saves; calibration is never required to create it.
- **Render** ([OperationsBlueprintPdfViewer.tsx:6758](src/components/blueprint/OperationsBlueprintPdfViewer.tsx), `kind === 'circuit-path'` branch): added a plain absolutely-positioned HTML label (not SVG text) centered on the average of the path's local vertex positions. It is deliberately **not** drawn inside the existing `viewBox="0 0 100 100" preserveAspectRatio="none"` SVG — that viewBox stretches x/y independently to fit the annotation's bounding box, which would visually distort any text glyphs drawn inside it for a non-square circuit path. The HTML label uses percentage `left`/`top`, so it moves and stays correctly positioned with the path at any zoom level/pan without distortion, and does not require a fixed max-width for the calibrated case (short "Total: X ft" text) while wrapping at ~170px for the longer not-calibrated note so it doesn't overlap large areas of the drawing.
- Polyline's own render/finalize path is completely unchanged (`isCircuit` gates every new line added).
- Circuit Path persistence is unchanged (`setAllAnnotations` optimistic add + `persistAnnotation`, already correct from Step 13B-QA5) — the new distance fields are additive `meta` keys, passed through unfiltered by `blueprintLibraryService.sanitizeAnnotation` exactly like every other `meta` key on this shape type, so the path (and its distance label) survives a hard reload with zero service-layer changes.

#### Part 6 — Cloud sync-blocked toast spam ("remote data is newer" popping up every few minutes)
- **Root cause:** `startPeriodicSync()` ([backupDataService.ts:141](src/services/backupDataService.ts)) retries `syncToSupabase()` every `SYNC_INTERVAL_MS` (13s) whenever `_dataChanged` is true. When the stale-overwrite guard blocks the sync (remote genuinely newer than the session's known baseline — the guard itself is correct and was NOT touched), `_dataChanged` is never cleared, so the same blocked sync retries and re-dispatches `poweron:sync-conflict` on every future tick. `V15rLayout.tsx`'s `handleSyncConflict` listener ([V15rLayout.tsx:369](src/components/v15r/V15rLayout.tsx), before this fix) unconditionally called `setToastMessage(...)` on every single event with no dedupe — so the identical "Cloud sync was blocked..." toast re-appeared repeatedly until the user reloaded or the remote/local state changed.
- **Fix (dedupe/throttle only — no guard logic touched):**
  - [V15rLayout.tsx:286](src/components/v15r/V15rLayout.tsx): added `lastSyncConflictRef` (`{ message, shownAt } | null`).
  - [V15rLayout.tsx:368](src/components/v15r/V15rLayout.tsx): `handleSyncConflict` now compares the incoming message + timestamp against the ref. If the same message was already shown within the last 20 minutes (`SYNC_CONFLICT_SUPPRESS_MS`), the toast is suppressed (header `syncStatus` still flips to `'failed'` every time, so the small persistent status indicator remains accurate — only the interruptive toast is throttled). A genuinely different conflict message, or the same message after the window elapses, shows immediately.
  - Suppression clears (and the next conflict, if any, will show again) on: a real successful cloud sync (new `poweron:sync-success` event, dispatched from [backupDataService.ts:1813](src/services/backupDataService.ts) right after `_lastSyncMeta`/`setKnownRemoteBaseline` are updated on a successful `syncToSupabase` — covers periodic sync, manual retry, and header Save's final sync), the pre-existing `poweron:data-saved` event (listener wired per the task's explicit acceptance criteria; harmless no-op today since nothing in this codebase currently dispatches that event, but it activates for free if/when something does), and implicitly on page reload (the ref re-inits to `null`).
  - `syncToSupabase`'s stale-overwrite guard, `checkManualSaveFreshness`, `resolveSyncGuardError`, `dispatchSyncConflict`'s call sites/payload, and `forceSyncToCloud`'s guard were **not modified** — save safety is unchanged; a genuinely newer remote still blocks every write attempt exactly as before. `allowOverwriteNewerRemote` was not touched or added to any normal save path.

#### Preserved (verified untouched)
- Circuit Path snap-to-symbol-center placement, Polyline drawing, Stop/Cancel button semantics (Stop = finalize & keep, Cancel = discard), Arc Line final shape, Measure calibration/manual-entry parsing, compact electrical symbol selection bounds, Guide Assist center-to-center, zoom-to-1000%, symbol rotation, fullscreen controls, Shapes dropdown, S3/S4 symbols/labels, all light output/glare behavior, Hide Lighting Effects, Hide Labels, Work Package persistence/isolate eye toggle, header-save safety guards/snapshots/freshness guard, iPad stale-warning cleanup — no logic in any of these paths was modified, only additive branches gated on `type === 'measure-perimeter'` / `shapeKind === 'circuit-path'`, plus the toast-dedupe wrapper around the existing (unchanged) sync-conflict payload.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `src/services/blueprintLibraryService.ts` required zero changes — `sanitizeAnnotation()` already passes all new `meta` keys through unfiltered.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`, `src/services/backupDataService.ts`, and `src/components/v15r/V15rLayout.tsx` are free for other agents.

---

### 2026-07-01 — Multi-Point Circuit Path, Polyline, Multi-Point Measure (Step 13B-QA5, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Additive feature pass — 3 new multi-point tracing workflows preserving all Step 12/13/QA1-4 work
**Feature Area:** Blueprint Viewer — Circuit/Switch-Leg Path, Polyline/Multi-Point Line, Multi-Point Measure
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ (file is `@ts-nocheck`, verified whole-project `tsc --noEmit` still 0 errors) | **Build:** ✅ 0 errors, 14.87s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅ (exit 0)

#### Part 1 — Circuit / Switch-Leg Path
- New `ShapeKind` value `'circuit-path'`, activated via a dedicated "Circuit Path" toolbar button (Waypoints icon) next to Shapes, in the Electrical Symbols section — sets `toolMode('shape')` + `shapeKind('circuit-path')`, same pattern as the existing Can Light/Electrical Symbol quick-pick buttons.
- Each click adds one point to a shared draft array (`pathDraftPoints`/`pathDraftRef`, page-normalized). If the click lands within `CIRCUIT_PATH_SNAP_RADIUS_NORM` (0.03) of an existing same-page, non-isolated annotation's center (`findNearestAnnotationCenterNorm`, reusing `getRectCenterNorm` from Guide Assist), the point snaps to that symbol's center instead of the raw click — so clicking 4 recessed lights + a switch produces a path anchored exactly on each symbol.
- The capture-phase and per-annotation `selectAnnotation` pointerdown bypasses (previously Arc-Line-only) were extended to also skip hit-testing for `polyline`/`circuit-path`, so clicking directly on top of an existing symbol reaches the canvas draw handler instead of selecting/moving it.
- A floating "Circuit Path — N points" pill with **Stop Circuit Path** and **Cancel** buttons appears fixed at the bottom-center of the viewer (`z-[100050]`, viewport-anchored so it stays reachable at any zoom/pan, including 1000%, and is easy to tap on iPad) whenever the draft has ≥1 point. Stop calls `finalizePathDraft()`, which commits one `type: 'shape'` annotation with `meta.points` (absolute page-normalized), `meta.pathType: 'circuit'`, `meta.closed: false`; fewer than 2 points discards silently.
- Rendering: a new shape-kind branch draws an SVG `<polyline>` (no fill, existing border color/thickness/style) plus small filled dots at each vertex for the circuit variant — reuses the exact same `viewBox="0 0 100 100"` / `preserveAspectRatio="none"` technique as Arch Line.
- Escape and tool/shapeKind/page-change effects clear the draft without persisting (new `useEffect` mirroring the existing measure-draft cleanup, keyed on `[effectiveTool, shapeKind, currentPage]`).

#### Part 2 — Polyline / Multi-Point Line
- New `ShapeKind` value `'polyline'`, added to `GENERIC_SHAPE_KIND_OPTIONS` under the existing Shapes dropdown ("Polyline / Multi-Point Line"). Shares 100% of the click-to-add-point / Stop-button / render machinery built for Part 1 (same `pathDraftPoints` state, same finalize function, same render branch) — the only behavioral difference is no symbol-center snapping and no vertex dots. The floating action bar shows "Polyline — N points" / **Stop Drawing** / **Cancel**.
- Also added `'circuit-path'` to `GENERIC_SHAPE_KIND_OPTIONS` so the shape-edit popover's "Shape" dropdown has a matching entry when editing an existing circuit-path annotation (avoids an unmatched `<select>` value).

#### Part 3 — Multi-Point Measure
- Reused the **existing** `measure-perimeter` tool rather than adding a new type — it already accumulates unlimited clicked points, sums consecutive segment lengths (open path, not closed), requires calibration (`showTransientSyncNotice('Calibrate measure first.')`, from QA4), and persists as one `measure-perimeter` annotation. This is architecturally identical to what "Multi-Point Measure" asks for.
- Added a live running-total readout: `measurePathLiveTotal` (computed each render from `measureDraftPoints` + a live rubber-band segment to `measureCursorPx`, divided by the existing `detectedScale` — manual calibration takes precedence over auto-detected, same precedence already established for the committed measurement) shown in a new floating pill: "Total: X.XX ft" once calibrated, or "N points — not calibrated" otherwise.
- Added an explicit **Stop Measuring** button (previously only double-click-near-last-point or Enter could finish) in the same floating pill, plus **Cancel** to discard. The Measure popover's Perimeter button was relabeled "Multi-Point / Perimeter" with a clarifying title tooltip — the underlying tool key, annotation type, and persistence path are unchanged.

#### Part 4/5 — Stop buttons + touch/iPad behavior
- All three Stop actions render as fixed-position (`position: absolute` on the outer `viewerRootRef`, not inside the scrollable/zoomable canvas) pill bars at `bottom-4, left-1/2` with large tap targets — reachable and consistent regardless of scroll position or zoom level (verified against the existing `MAX_RELATIVE_ZOOM_* = 10` / 1000% ceiling from QA3, since these overlays sit outside the transformed canvas).
- Point placement uses the same `overlayRef.getBoundingClientRect()` + `toNorm()` conversion already used by every other tool (pen, measure, line/arrow, arch-line) — page/document-normalized coordinates, not raw screen pixels, so points do not jump between zoom/pan changes.
- Escape-key cancel (extended existing handler) and tool-switch cleanup (new effect) both safely discard an in-progress draft, matching the existing measure-tool pattern the user referenced ("similar to Copy/Paste Stop Pasting").

#### Part 6 — Data model (verified safe, no service-layer changes needed)
- Both new shapes use `type: 'shape'` (already an allowed `BlueprintAnnotation.type`) with `meta.shapeKind: 'polyline' | 'circuit-path'`, `meta.points: [{x,y}, ...]` (absolute page-normalized, same convention as pen/marker freehand strokes), `meta.pathType`, `meta.closed: false`.
- `blueprintLibraryService.ts` **required zero changes** — `sanitizeAnnotation()` already allows `type: 'shape'` and passes `meta` through unfiltered (`meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : undefined`), and `shapeKind` is typed as a bare `string` with no enum restriction. Old annotations without `meta.points` are unaffected since every new code path only runs when `meta.shapeKind` is one of the two new values.
- Move-drag (`startAnnotationLayoutDrag` / `handleAnnotationLayoutPointerMove`) was extended with an `isPathLike` branch (mirroring the existing `isLineLike` absolute-endpoint translation) that shifts every point in `meta.points` by the drag delta — without this, dragging a polyline/circuit-path would only move its bounding box and visually distort the path. Copy/paste required **no changes**: `pasteCopiedAnnotationAt` already generically translates any `meta.points` array by the paste offset (pre-existing code for pen/marker), and `cloneAnnotationForPaste` already deep-clones `meta` via `JSON.parse(JSON.stringify(...))`.

#### Preserved (verified untouched)
- Arc Line placement/editing, Measure calibration, compact electrical symbol selection bounds (QA4); Guide Assist center-to-center, zoom-to-1000%, symbol rotation, arc-line-over-existing-items, S3/S4 polish (QA3); Work Package persistence/isolate eye toggle; header-save safety guards/snapshots/freshness guard; Hide Lighting Effects/Hide Labels; light output/glare. No logic in any of these paths was modified — only additive branches gated on the two brand-new `shapeKind` values, plus the reused-unchanged `measure-perimeter` tool's UI layer.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `src/services/blueprintLibraryService.ts` shows only the pre-existing uncommitted QA4 diff (4 lines) — this pass did not open or edit that file.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Arc Line Final Shape, Measure Tool, Compact Symbol Selection Bounds (Step 13B-QA4, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped QA pass — 3 independent fixes preserving Step 12/13/QA1/QA2/QA3 work
**Feature Area:** Blueprint Viewer — arc-line placement geometry, measure/calibrate tool, electrical symbol selection bounds
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ via Node CLI workaround | **Build:** ✅ 0 errors, 15.29s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅

#### Part 1 — Arc Line final shape mismatch
- Root cause: the live preview computed the bezier control point in screen-pixel space (`cpx = mid.x + 0.5*(y-p1.y)`, isotropic — x and y pixels are the same physical unit). The pointerup finalize code instead computed it in page-normalized space, applying the same `0.5` factor to a normalized y-delta to offset a normalized x-coordinate (`archCtrlX = amx + 0.5*(abs2y-abs1y)`). Normalized x is a fraction of page *width*, normalized y a fraction of page *height* — for any non-square page these are different physical scales, so the reconstructed control point was distorted by the page's aspect ratio, producing a much larger (or smaller) arc than the preview on release.
- Fix ([OperationsBlueprintPdfViewer.tsx:4543](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)): finalize now computes the control point using the exact same pixel-space formula as the preview (`activeDragStart`/`x`,`y`), then converts it once to normalized coords via `toNorm()` (which divides x by width and y by height independently — the correct per-axis conversion). The existing Guide Assist center-snap translation (`finalNorm.x - norm.x`, `finalNorm.y - norm.y`) is re-applied to the converted point so a snapped arc still keeps its control point attached to the endpoints.
- `archCtrlX`/`archCtrlY` meta fields, `archFactor`, and all edit-handle/drag code (`archControlDragRef`, the yellow control-point handle, `startArchControlDrag`) were not touched — arc editability after placement is unaffected.
- Part 2 (arc-line placement over existing items, from Step 13B-QA3) was not touched — verified the capture/bubble-phase pointerdown early-returns for `shapeKind === 'arch-line'` are untouched.

#### Part 3/4 — Measure tool never displayed a distance
- Root cause: `sanitizeAnnotation()` in `blueprintLibraryService.ts` had a hardcoded runtime type allowlist that did **not** include `'measure-distance'`, `'measure-area'`, `'measure-perimeter'`, or `'calibrate'` (and the `BlueprintAnnotation.type` TS union didn't either). Every measurement created by the viewer was silently rejected by `upsertOperationsBlueprintAnnotation` (`sanitizeAnnotation` returns `null` → `{ localSaved: false, error: 'Invalid annotation.' }`), so the annotation never saved and vanished the moment `loadAnnotations()` re-synced from the (now annotation-less) backup — matching the user's "no distance appeared" report exactly. Calibration storage itself (`savedCalibrations` state + `localStorage blueprint_calibrations_${id}`, keyed per page) was already working correctly and was not touched.
- Fix ([blueprintLibraryService.ts:66,479](src/services/blueprintLibraryService.ts)): added the four measure/calibrate types to both the `BlueprintAnnotation['type']` union and the `sanitizeAnnotation` runtime allowlist (also added `'textHighlight'`, which was already allowed at runtime but missing from the type union).
- Added a `parseCalibrationLength()` helper ([OperationsBlueprintPdfViewer.tsx:547](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) supporting `10`, `10 ft`, `10'`, `10' 6"`, `10'-6"`, `10.5 ft`, `126 in`, `126"` — feet-inches and explicit-unit input override the unit dropdown; a plain number falls back to the dropdown's selected unit. The Calibrate manual-length `<input>` was changed from `type="number"` (which outright blocks `'`/`"` characters, so users could never type feet-inches) to `type="text" inputMode="decimal"`, wired to the new parser in both the Enter-key and Save-button handlers.
- Added a `showTransientSyncNotice('Calibrate measure first.')` call when a measurement is completed with no calibration on the page (reuses the existing global amber toast at `z-[100050]`, already visible above canvas/panels — no new UI surface needed).
- Measurement rendering (label box + line/polygon + zoom-aware `displaySize`-based pixel conversion) was already correct and untouched — it only needed the annotation to actually persist.

#### Part 6 — Compact electrical symbol selection bounds
- Root cause: the selection-highlight ring (`ring-2 ring-white/80`) was drawn around the full annotation `rect` (the user's placed/dragged box), but several device-symbol glyphs (Switch/S3/S4 "S"+line, Sconce's wall-mounted arc) only occupy a narrow, sometimes off-center portion of their 0-100 SVG viewBox — leaving a large visually-empty margin inside the selection box, most pronounced for Sconce (glyph confined to the left ~45% of the box) and Switch/S3/S4 (narrow vertical glyph with wide empty margins left/right).
- Fix: added `ELECTRICAL_SYMBOL_VISUAL_BOUNDS` ([OperationsBlueprintPdfViewer.tsx:914](src/components/blueprint/OperationsBlueprintPdfViewer.tsx)) — per-symbol ink bounding boxes (0-100 viewBox units, with touch-friendly padding baked in) for the 9 flagged kinds (Switch, S3, S4, Dimmer, Receptacle, GFCI, Sconce, Photocell, Timer Control Box). `renderElectricalSymbolSvg()` now draws a white compact selection outline `<rect>` from these bounds **inside the same rotated `<g transform>` as the body**, so it rotates correctly with the symbol at 0/90/180/270°. Light/LED/can-light symbols (not in the flagged list) keep the previous full-box ring unchanged.
- The full-size wrapper `<div>` (`{ left, top, width, height }`, `data-annotation-id`, `onPointerDown`/`onClick`) is completely unchanged — the actual touch/click hit target stays exactly as large as before, so tap-friendliness on iPad is preserved. Only the *visual* highlight outline was tightened; hit-testing, Move/Edit/Copy/Delete toolbar positioning (which reads this same unchanged div's bounding rect), rotation, and Work Package isolate filtering are all unaffected.
- The compact bounds are computed purely from each symbol's body glyph geometry — light-output glow (`renderLightOutputGlowSvg`, fixed `cx=50,cy=50` radius, rendered as a sibling outside `renderElectricalSymbolSvg`'s return) and external labels/badges (`externalLabel()`, positioned bottom-right outside the chosen bounds) do not influence the selection box size.
- Known minor limitation: the compact selection rect is nested inside the same `<g opacity={fillOpacity}>` group as the symbol body, so at very low fill opacity the selection outline dims proportionally too (previously the CSS ring was opacity-independent). Still clearly visible at typical/default opacity; not a functional regression.

#### Preserved (verified untouched)
- Guide Assist center-to-center repair, zoom-to-1000% ceiling, symbol rotation (`ROTATABLE_ELECTRICAL_SHAPE_KINDS`, `rotateAnnotationSymbol`), fullscreen portal controls, Shapes dropdown cleanup, S3/S4 body/label split, light output/glare for all light symbols, Hide Lighting Effects, Hide Labels, Work Package persistence/isolate eye toggle, header-save safety guards/snapshots/freshness guard, and the QA1-HOTFIX TDZ fix — no logic in any of these paths was modified.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `blueprintLibraryService.ts` was touched only for the minimal type-allowlist fix required to make measurements persist at all (explicitly permitted by the task brief as "only touch if absolutely necessary").

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` and `src/services/blueprintLibraryService.ts` are free for other agents.

---

### 2026-07-01 — Zoom to 1000%, Symbol Rotation, Arc-Line Overlay Placement, S3/S4 Visual Polish (Step 13B-QA3, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped QA pass — 4 independent fixes preserving Step 12/13/QA1/QA2 work
**Feature Area:** Blueprint Viewer — zoom ceiling, wall-symbol rotation, arc-line hit-testing, S3/S4 rendering
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ via Node CLI workaround | **Build:** ✅ 0 errors, 18.74s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅

#### Part 1 — Zoom to 1000%
- `MAX_RELATIVE_ZOOM_DESKTOP` and `MAX_RELATIVE_ZOOM_MOBILE` raised from 4.5/8 to `10` (1000% of Fit-to-Full-Page).
- `MAX_RENDER_SCALE` raised from `4.5` to `10` to match — this constant caps the actual PDF raster resolution (`actualRenderScale = min(MAX_RENDER_SCALE, fitWidthScale * relativeZoom)`), and the page-frame CSS size is bound directly to that raster's pixel dimensions. Raising only the relative-zoom cap without raising `MAX_RENDER_SCALE` would let the % readout say 1000% while the visible page stopped growing at the old 450% raster ceiling — so both had to move together, preserving the pre-existing 1:1 relationship between the two constants.
- Zoom in/out buttons, wheel-zoom debounce/commit flow, pinch-zoom preview, Fit to Full Page, and Lock View were not touched — only the two ceiling constants changed.

#### Part 2 — Rotation for wall-mounted electrical symbols
- New `ROTATABLE_ELECTRICAL_SHAPE_KINDS` set: receptacle, switch, 3-way switch, 4-way switch, dimmer, sconce, GFCI, photocell, timer control box. Can lights, recessed/pendant lights, LED panels, and all non-electrical shapes are excluded.
- New `getAnnotationRotationDeg(meta)` reads `meta.rotationDeg`, normalizes to one of 0/90/180/270.
- `renderElectricalSymbolSvg()` was restructured to build `body` (the rotatable glyph) and `label` (the external badge, e.g. GFCI/DIM/TMR/PC/S3/S4) as separate values, then wraps only `body` in `<g transform="rotate(deg 50 50)">` while `label` renders unrotated afterward — so external labels stay horizontally readable at any rotation, matching the existing GFCI label pattern.
- Added a `Rotate` button (RotateCw icon) to the floating Move/Edit/Copy/Delete selection action bar, gated by `fCanRotate = focusedAnn.type === 'shape' && isRotatableElectricalShapeKind(shapeKind)`. Clicking cycles `meta.rotationDeg` 0° → 90° → 180° → 270° → 0° via a new `rotateAnnotationSymbol()` callback that optimistically updates local state and persists through the existing `persistAnnotation()` queue — no new storage path.
- Rotation persists (stored additively in `meta`, passed through `blueprintLibraryService.sanitizeAnnotation` unchanged — no allowlist strips unknown meta keys) and copies correctly (the existing `cloneAnnotationForPaste()` deep-clones the entire `meta` object, so `rotationDeg` carries over for free). Works in Work Package isolate view since rotation is only a render-time transform on the same annotation node already covered by isolate filtering.

#### Part 3 — Arc Line can be placed over existing items
- Root cause: `handleAnnotationSelectCapture` (capture-phase pointerdown handler on the page overlay) and the per-item `selectAnnotation` closure (bubble-phase, attached to every rendered annotation's wrapper div/stroke) both unconditionally called `preventDefault()` + `stopPropagation()` whenever a pointerdown landed on an existing annotation's DOM element — regardless of which tool was active. This blocked the two-click Arc Line placement flow (`handlePointerDown`, bound via bubble-phase on the overlay) from ever firing when a click landed on top of an existing symbol/light/switch.
- Fix: both handlers now return early — doing nothing, letting the event propagate untouched — when `effectiveTool === 'shape' && shapeKind === 'arch-line'`. This is scoped narrowly to the active Arc Line tool only; normal selection behavior for Select mode and every other tool (including other shapes/pen/marker) is unchanged.
- The newly created arc-line annotation is appended to the end of the `allAnnotations` array (existing behavior, unchanged), so it renders after — and visually on top of — the item it was drawn over, with no z-order changes needed.
- After placement, the arc-line is a normal shape annotation and is selectable/editable/deletable/persistable exactly like any other line-like shape; existing items underneath are untouched. Guide Assist and Work Package isolate filtering are unaffected since neither was touched.

#### Part 4 — S3/S4 visual polish
- `electrical-switch-3way` and `electrical-switch-4way` bodies now reuse the exact same body JSX as `electrical-switch` (the `S` glyph + vertical center line) instead of rendering custom `S3`/`S4` text as the symbol body.
- `S3` / `S4` are now rendered as external bottom-right labels via the same `externalLabel()` helper GFCI/DIM/TMR/PC use — respecting `Hide Labels`.
- Work Package summary labels (`3-Way Switch` / `4-Way Switch`), `ELECTRICAL_SYMBOL_METADATA`, `Object`/count-value plumbing, opacity, and light-glow exclusion (`isLightOutputShapeKind` already excludes switches) were not touched — only the SVG body/label split changed.

#### Preserved (verified untouched)
- Guide Assist center-to-center repair (Step 13B-QA2), fullscreen portal controls, Shapes dropdown cleanup, light output/glare for all light symbols, Hide Lighting Effects, Hide Labels, Work Package persistence/isolate eye toggle, header-save safety guards/snapshots/freshness guard, and the QA1-HOTFIX TDZ fix — no logic in any of these paths was modified.
- No Supabase migrations, export behavior, material list engine, labor engine, dashboard files, or project tab files were touched. `blueprintLibraryService.ts` was inspected but required no changes — `sanitizeAnnotation()` already passes `meta` through unfiltered.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Center-to-Center Guide Assist Repair (Step 13B-QA2, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped repair of Step 12D/12D-R/12D-R2 Guide Assist — center-only matching + real snap/lock
**Feature Area:** Blueprint Viewer — Guide Assist placement + move alignment
**Branch:** main | HEAD = 5a902b5
**Typecheck:** 0 errors ✅ via Node CLI workaround | **Build:** ✅ 0 errors, 19.67s (pre-existing Vite chunk-size warnings only) | **git diff --check:** PASS ✅

#### User complaint
Guide Assist compared each shape's left/center/right and top/center/bottom edges against every other shape's same three points (`getRectAlignmentCandidates`), so up to 9 point-pairs per candidate could match at once — producing multiple competing, jittery lines that made it hard to line up lights, especially on iPad.

#### Fix
- Replaced `getRectAlignmentCandidates` with `getRectCenterNorm(rect)` — returns only the rect's own center `{x, y}` in page-normalized coordinates. This is now the single source of truth for every Guide Assist comparison.
- Rewrote `calculateAlignmentGuides()` to compare the active rect's center against only the center of each candidate annotation — one delta per axis per candidate, keeping the single nearest match per axis (still at most one vertical + one horizontal guide, now edge-free).
- Added `applyCenterSnap(rect, guides)` — when a guide matches, shifts the rect's x and/or y so its center lands exactly on the matched axis value, size unchanged.
- Added `isGuideTargetVisible(annotationId)` backed by a new `isolatedAnnotationIdSetRef` (mirrored from the existing `isolatedAnnotationIdSet` via a `useEffect`, to avoid a TDZ hook-ordering issue) — isolated Work Package hidden annotations are excluded from Guide Assist candidates entirely, so they never render a guide line or snap the active shape.
- `updateMoveGuideLines()` now returns the (possibly snapped) rect instead of void; `handleAnnotationLayoutPointerMove` applies that returned rect on every move tick (both the line-like absolute-endpoint branch and the generic branch), so existing-annotation dragging snaps center-to-center in real time, including on touch.
- `handlePointerUp` snapshots `activeAlignmentGuidesRef.current` into `pendingAlignmentGuides` before calling `clearAlignmentGuides()`, then for `effectiveTool === 'shape'` only, applies `applyCenterSnap` to the final placement rect (`finalNorm`). The line/arch-line endpoint math (`lineX1/Y1/X2/Y2`, `archCtrlX/Y`) was repointed from the old unsnapped `rawNorm` box origin to `finalNorm`, so a snapped line/arrow/arch-line translates as one rigid piece instead of its internal geometry drifting from the box.
- New-symbol placement and the existing two-click line/arrow/arch-line mode both funnel through the same `handlePointerUp` commit path, so both are covered by one fix — no separate code path was needed for point-to-point line drawing.

#### Verified untouched
- Light output/glare glow (`renderLightOutputGlowSvg`, `getLightOutputGlowMetrics`) uses a fixed local `cx=50,cy=50` symbol-space radius — never read by Guide Assist, confirming glow/output radius cannot affect guide centers.
- Work Package persistence, isolate toggle logic itself, S3/S4 switch symbols, Hide Lighting Effects, Hide Labels, fullscreen controls, shape dropdown cleanup, and save safety guards were not modified — only Guide Assist's own helper functions and the two call sites that apply its output.
- No migrations, export changes, or dashboard/project-tab files touched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-01 — Fix `clearStaleSyncMessages` TDZ Runtime Crash (Step 13B-QA1-HOTFIX, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped hotfix — declaration-order repair only, no behavior change
**Feature Area:** Blueprint Viewer — runtime crash introduced by Step 13B-QA1 stale sync warning cleanup
**Branch:** main | HEAD = a4e927b
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Root cause
`clearStaleSyncMessages` and `showTransientSyncNotice` were declared via `useCallback` at (former) lines 2343/2353, but `persistScopeLayers` (line ~1926, from Step 13B-P) referenced `clearStaleSyncMessages` in its body and dependency array at line ~1933/1956 — earlier in the component function's execution order. This is a JS temporal-dead-zone violation: the `const` binding for `clearStaleSyncMessages` had not yet been initialized when `persistScopeLayers`'s `useCallback` dependency array was evaluated during render, throwing "Cannot access 'clearStaleSyncMessages' before initialization" and crashing the whole app (error boundary "Something went wrong").

#### Fix
Moved both `clearStaleSyncMessages` and `showTransientSyncNotice` `useCallback` declarations to immediately before `loadAnnotations` (now ~line 1897), ahead of every reference including `persistScopeLayers`. Both callbacks only depend on `setError`, `setActionMsg`, `setSyncNotice`, `syncNoticeTimerRef`, and module-level `isSyncBlockedMessage` — all declared earlier in the component (state hooks near line 1313-1365) — so the move is safe and has empty dependency arrays (`[]`), unchanged. No logic inside either function was altered. Removed the old duplicate declaration block from its former location.

#### Preserved
- Stale iPad/cloud-sync warning cleanup behavior (Step 13B-QA1) unchanged — same 8s auto-dismiss, same `poweron:data-saved` listener, same guard-message clearing logic.
- Fullscreen portal fix, S3/S4 symbols, Shapes dropdown cleanup, light output/glare for all light symbols (Step 13B-QA1-R), Work Package persistence, and save safety guards — untouched, no logic changed anywhere else in the file.
- No migrations, export changes, PDF loading changes, AppShell changes, dashboard files, or project tab files were touched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Light Output/Glare for All Light Symbols (Step 13B-QA1-R, NOT COMMITTED)

**Agent:** Cursor

**Behavior:**
- `isLightOutputShapeKind()` / `LIGHT_OUTPUT_SHAPE_KINDS` classify all 7 light symbol types
- Shared `renderLightOutputGlowSvg()` + `getLightOutputGlowMetrics()` — same Kelvin-tinted soft radial glow as can lights
- Electrical light symbols (recessed, pendant, sconce, 2x2/2x4 LED) render glow when `lightingEffectsVisible`
- Light Output + Color Temperature edit controls extended to all light symbols
- Non-light symbols (switch, S3, S4, dimmer, GFCI, receptacle, timer, photocell) unchanged — no glow
- Hide Lighting Effects / isolate / opacity behavior preserved via existing canvas filter + `lightingEffectsVisible` gate

### 2026-06-30 — Blueprint QA: Fullscreen, Shapes Menu, S3/S4, Save Notice (Step 13B-QA1, NOT COMMITTED)

**Agent:** Cursor

**Fixes:**
1. **Fullscreen controls** — Portals (Move/Edit/Copy/Delete bar, ToolPopover, modals) render into `viewerRootRef` during fullscreen so they appear inside the browser Fullscreen API element (not clipped). Raised z-index to 100050. Tablet/desktop fullscreen auto-expands annotations drawer; canvas + panel use flex split (panel max 38vh).
2. **Generic Shapes cleanup** — `GENERIC_SHAPE_KIND_OPTIONS` excludes all electrical symbols and can lights. Can lights + electrical symbols only under ELECTRICAL SYMBOLS toolbar section.
3. **S3/S4 switches** — New shape kinds `electrical-switch-3way` and `electrical-switch-4way` with metadata, rendering, and Work Package labels ("3-Way Switch", "4-Way Switch").
4. **Stale sync warning** — Annotation saves no longer throw on blocked cloud sync when local save succeeded. Transient amber notice (8s auto-dismiss); cleared on `poweron:data-saved` or next successful cloud sync. Save safety guards unchanged.

**Not touched:** backupDataService guards, migrations, export, AppShell, V15rLayout (except no change needed)

### 2026-06-30 — Work Package Canvas Isolate (Step 13B-I, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Eye button on Work Package card isolates canvas annotations (local UI state only)

**Files touched:**
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

**Behavior:**
- `isolatedScopeLayerId` local state (not persisted — avoids noisy cloud saves on every eye click)
- `canvasPageAnnotations` filters `pageAnnotations` to `selectedAnnotationIds` when isolated
- Eye button toggles isolate; clicking another package switches isolate; click again clears
- Side panel shows "Isolated — viewing only …" banner and per-card badge
- Hidden focused/layout-edit annotations cleared via `useEffect`
- Empty package shows canvas overlay: "This package has no linked annotations."
- `visible` field on scope layers preserved (no longer toggled by eye button)
- Work Package create/edit/delete persistence unchanged; no save guard bypass

**Not touched:** backupDataService, blueprintLibraryService, migrations, export, PDF loading, AppShell, V15rLayout

### 2026-06-30 — Work Package Remote Merge Save (Step 13B-P-R, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Merge scope layers into latest remote backup before sync (not full stale-local overwrite)
**Branch:** main (no commit)
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Fix
- `saveOperationsBlueprintScopeLayers` fetches latest remote, patches only `operationsBlueprintScopeLayers[blueprintSetId]`, saves via `saveBackupWithRemoteBaselineSync`
- `saveBackupWithRemoteBaselineSync` sets session baseline from fetched remote row, then guarded sync (no blind allowOverwrite)
- Remote fetch fail → local-only save + `SCOPE_LAYER_CLOUD_SYNC_WARNING_MSG`
- First sync (no remote row) → normal local guarded save

#### Files
- `src/services/backupDataService.ts` — `fetchLatestRemoteBackup`, `saveBackupWithRemoteBaselineSync`
- `src/services/blueprintLibraryService.ts` — remote-merge save path
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` — result handling / warning UX

---

### 2026-06-30 — Persist Blueprint Scope Layers / Work Packages (Step 13B-P, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Persist Work Packages under `blueprintSummaries.operationsBlueprintScopeLayers`
**Branch:** main (no commit)
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Persistence path
`backup.blueprintSummaries.operationsBlueprintScopeLayers[blueprintSetId][]`

#### Files
- `src/services/blueprintLibraryService.ts` — types, sanitize, get/save, delete on blueprint set removal
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` — load on blueprint open, persist on create/edit/delete/show-hide

#### Save path
Uses guarded `saveBackupDataAndSyncNow(backup, 'blueprintSummaries')` — no stale-overwrite bypass.

---

### 2026-06-30 — Remote Baseline Stale Edit Guard (Step 13B-S3-R, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Fix S3 guard — compare remote vs session baseline, not local edited `_lastSavedAt`
**Branch:** main (no commit)
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Root cause fixed
`checkManualSaveFreshness` compared remote vs `local._lastSavedAt`, which `saveBackupDataAndSync` bumps on every edit — stale sessions could appear safe after any local change.

#### Fix
- Guard now compares: `remoteFreshnessMs > _lastKnownRemoteSavedAt + tolerance`
- `fetchRemoteAppStateFreshness` no longer advances baseline on read
- Baseline updated only on: `loadFromSupabase` (remote row present), successful `syncToSupabase`, successful `forceSyncToCloud`, tenant clear/switch resets baseline
- No baseline + remote row exists → block with `SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG`

---

### 2026-06-30 — Cloud Sync Stale Overwrite Guard (Step 13B-S3, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Central stale-overwrite guard on all normal full-backup cloud sync paths
**Branch:** main (no commit)
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/services/backupDataService.ts` — `SyncToSupabaseOptions`, guard in `syncToSupabase`, `resolveSyncGuardError`, `dispatchSyncConflict`, save helpers + periodic sync + forceSyncToCloud pre-stamp guard
- `src/components/v15r/V15rLayout.tsx` — `poweron:sync-conflict` listener, sync retry blocked messaging
- `src/components/SnapshotPanel.tsx` — restore uses `allowOverwriteNewerRemote: true`
- `AGENT_SHARED_CONTEXT.md`

#### Guarded paths (default)
- `syncToSupabase()` — all callers unless `allowOverwriteNewerRemote: true`
- `saveBackupDataAndSync` / `saveBackupDataAndSyncNow` / `saveAndImmediateSync`
- `startPeriodicSync` (only clears dirty flags on success)
- `forceSyncToCloud` without intentional overwrite (pre-stamp guard + sync guard)

#### Bypass paths
- `saveBackupDataAndSync(..., 'snapshotRestore')` — auto-inferred
- `forceSyncToCloud({ allowOverwriteNewerRemote: true, source: 'snapshot-restore' })`
- Header Save final sync after S1/S2 (`requireFreshRemote` / `createSafetySnapshot` skips duplicate sync guard)

#### Messages
- Remote newer: `SYNC_BLOCKED_REMOTE_NEWER_MSG`
- Freshness unknown: `REMOTE_FRESHNESS_UNKNOWN_MSG` (fail closed)

---

### 2026-06-30 — Header Save Safety Snapshot (Step 13B-S2, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Create recoverable snapshot before manual header Save overwrites remote app_state
**Branch:** main (no commit)
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/services/backupDataService.ts` — `createHeaderSaveSafetySnapshot`, `fetchRemoteAppStateRow`, `forceSyncToCloud({ createSafetySnapshot })`
- `src/services/snapshotService.ts` — `getSnapshotRestorePayload` for header-save-safety restore
- `src/components/v15r/V15rLayout.tsx` — header Save passes `createSafetySnapshot: true`
- `src/components/SnapshotPanel.tsx` — restore/preview uses `getSnapshotRestorePayload` (minimal compat)
- `AGENT_SHARED_CONTEXT.md`

#### Snapshot system reused
Supabase `public.snapshots` table via `snapshotService.createSnapshot()` (same as SnapshotPanel).

#### Flow
Header Save → freshness guard pass → safety snapshot → then `_lastSavedAt` stamp → `saveBackupData` → `syncToSupabase`.

#### Snapshot payload (`snapshotType: header-save-safety`)
- `localBeforeSave`, `remoteBeforeOverwrite` (if row exists), `restoreData` (remote preferred)
- metadata: source, environment, timestamps, userId, remote `updated_at`

#### Fail closed
Snapshot failure blocks header Save with `HEADER_SAVE_SNAPSHOT_FAILED_MSG`.

---

### 2026-06-30 — Header Save Fail-Closed Repair (Step 13B-S1-R, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Repair S1 freshness guard — block Header Save when remote cannot be verified
**Branch:** main (no commit)
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/services/backupDataService.ts` — `checkManualSaveFreshness({ failClosed })`, `REMOTE_FRESHNESS_UNKNOWN_MSG`, fetch timeout, fail-closed on auth/network/timeout errors
- `AGENT_SHARED_CONTEXT.md`

#### Behavior change (header Save only via `requireFreshRemote` + `failClosed: true`)
- No remote row → still allow (first sync)
- Remote older/equal → allow
- Remote newer → block (`REMOTE_FRESHER_THAN_LOCAL_MSG`)
- Fetch error / timeout / auth fail / missing remote data → **block** (`REMOTE_FRESHNESS_UNKNOWN_MSG`)
- Settings restore, sync retry, auto-save → unchanged (no `requireFreshRemote`)

---

### 2026-06-30 — Header Save Safety Patch (Step 13B-S1, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Immediate save safety guard — no snapshots, no Work Package persistence
**Feature Area:** Header Save / forceSyncToCloud remote freshness guard
**Branch:** main (no commit)
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/services/backupDataService.ts` — `checkManualSaveFreshness`, `fetchRemoteAppStateFreshness`, `forceSyncToCloud({ requireFreshRemote, source })`, `_lastKnownRemoteSavedAt`
- `src/components/v15r/V15rLayout.tsx` — `handleHeaderSaveLiveData` localhost confirm + guarded sync + blocked-save toast
- `AGENT_SHARED_CONTEXT.md`

#### Guard behavior
- Header Save calls `forceSyncToCloud({ requireFreshRemote: true, source: 'header-save' })`.
- Before stamping local `_lastSavedAt`, fetches remote `app_state` (`state_key = poweron_v2`) and compares `max(updated_at, data._lastSavedAt)` vs local `data._lastSavedAt` (1s tolerance).
- If remote newer → blocked with message: "Remote data is newer than this local session. Reload before saving, or create a backup before overwriting."
- Localhost/127.0.0.1 + Supabase configured → `window.confirm` before header Save.
- Sync retry button, Settings save, Snapshot restore → **unchanged** (no `requireFreshRemote`).

#### Not touched
- Work Package persistence, migrations, export, OperationsBlueprintPdfViewer.tsx, blueprintLibraryService.ts

---

### 2026-06-30 — Blueprint Viewer: Repair Work Package Selection and Save (Step 13B-R, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped repair preserving Step 13A/13B work
**Feature Area:** Blueprint Viewer — work package selection/save UX
**Branch:** main | HEAD = 1105038
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Repaired
- Made package-selected annotation rows visually obvious with accent checkboxes, cyan border/background, left accent, and a `Selected` pill.
- Highlighted the selected count in the right-panel header when one or more annotations are checked.
- Snapshotted selected annotation IDs into modal draft state when creating/editing a work package, so Save no longer depends on live checkbox state while the modal is open.
- Added inline work-package modal validation errors instead of relying on distant shared action messages.
- Moved saved Scope Layers / Work Packages cards above annotation groups and scrolls them into view after save.
- Clear checkbox selection after successful create/edit save.

#### Preserved
- Work packages remain in-memory only for this step.
- Checkbox selection remains separate from `focusedAnnotationId`; row click focus/edit behavior is still separate.
- Package create/edit/delete/show-hide actions remain local viewer state only.
- No migrations, export changes, PDF loading changes, AppShell changes, material list engine, labor engine, color palette behavior, electrical symbol rendering, 2D/3D Layout Builder, or VR files were touched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Scope Layers / Work Packages Foundation (Step 13B, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped v1 Scope Layers foundation preserving Step 13A metadata
**Feature Area:** Blueprint Viewer — side-panel work package basket
**Branch:** main | HEAD = 1105038
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Added `BlueprintScopeLayer` and `BlueprintScopeItemRef` v1 data models inside the viewer.
- Added `selectedForPackageIds` as a side-panel checkbox basket independent of `focusedAnnotationId`.
- Added Create Work Package modal with name, description, color, labor hour buckets, crew notes, proposal summary, selected item count, item refs, grouped summary, and labor total.
- Added in-memory `scopeLayers` cards in a Scope Layers section under the right annotation panel.
- Added v1 actions: create, edit, delete, and show/hide card state.
- Used Step 13A symbol metadata to populate item ref `category` and `countValue` for electrical symbols.

#### Preserved
- Work packages are not mixed into the annotation array and annotations are not mutated to create packages.
- Existing row click focus/select behavior remains separate from checkbox selection.
- Move/Edit/Copy/Delete still operate on `focusedAnnotationId`.
- No migrations, export changes, PDF loading changes, AppShell changes, material lists, labor engine, estimate generation, color palette behavior, 2D/3D Layout Builder, or VR files were touched.

**Persistence note:** Scope Layers are in-memory only for Step 13B. Persistence is deferred until a safer dedicated storage helper/key is added.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Symbol Metadata Foundation (Step 13A, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped Symbol Intelligence metadata foundation after Step 12 drawing tools batch
**Feature Area:** Blueprint Viewer — electrical symbol metadata
**Branch:** main
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Added local electrical symbol metadata helpers: `isElectricalShapeKind`, `getElectricalSymbolMetadata`, `getElectricalSymbolDisplayName`, and `getElectricalSymbolCountValue`.
- Kept electrical symbols as existing `type: "shape"` annotations using `meta.shapeKind`; no saved annotations are migrated or automatically mutated.
- Added derived metadata for `symbolKind`, `displayName`, `shortLabel`, `category`, `countValue`, `defaultPhase`, `materialKey`, `laborKey`, and `isElectricalSymbol`.
- Additively stamps `symbolCategory`, `countValue`, `materialKey`, and `laborKey` only on newly placed electrical symbols or when editing a shape into an electrical symbol.
- Added a compact read-only symbol/category/count line to the shape edit popover for electrical symbols.

#### Preserved
- Emergency recessed lights still use `meta.emergency` on `electrical-recessed-light` and display as `Recessed Light · EM`.
- Hide Lighting Effects, Guide Assist, free line endpoint editing, electrical label visibility, symbol opacity, fixed palette behavior, and switch/dimmer vertical-line styling remain intact.
- No migrations, export changes, PDF loading changes, AppShell changes, portal/request/review/email files, dashboard files, service log files, Scope Layers, Work Packages, material lists, labor engine, 2D/3D Layout Builder, or VR files were touched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Electrical Symbol Opacity + New Shape Defaults (Step 12G, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Narrow bugfix after Step 12 drawing tools batch
**Feature Area:** Blueprint Viewer — shape opacity behavior
**Branch:** main | HEAD = 4032ed0
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Fixed
- Set new shape placement defaults to `fillOpacity: 1` via `DEFAULT_SHAPE_FILL_OPACITY`.
- Preserved old saved/missing-opacity render fallback with `LEGACY_SHAPE_FILL_OPACITY = 0.22`; no saved annotations were migrated or mutated.
- Wrapped electrical symbol SVG output in an opacity group using the resolved shape `fillOpacity`, so strokes, fills, and external labels/badges now follow the same opacity control.
- Kept selection rings, move/resize handles, and popovers outside the opacity group.

#### Preserved
- Hide Labels still only hides electrical external labels/badges.
- Hide Lighting Effects still only controls can-light glow/output.
- Guide Assist remains unchanged.
- Free line endpoint editing remains unchanged.
- No migrations, export changes, PDF loading changes, AppShell changes, Scope Layers, Work Packages, material counts, labor engine, portal/request/review/email, dashboard, or service log files were touched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Switch/Dimmer Vertical Line Polish (Step 12E-R3, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped visual correction preserving Step 12B/12C/12D/12E/12F
**Feature Area:** Blueprint Viewer — electrical switch/dimmer symbol polish
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Changed `electrical-switch` from an `S` with a horizontal line to an `S` with a vertical center line.
- Changed `electrical-dimmer` to use the same vertical-line switch base while keeping the external `DIM` label.

#### Preserved
- Hide Labels still only hides external electrical labels/badges; the switch/dimmer `S` and vertical line remain symbol bodies.
- Step 12F fixed colors remain intact; `ToolPopover.tsx` was not changed in this step.
- Step 12B Hide/Show Lighting Effects remains intact.
- Step 12C free line endpoint editing remains intact.
- Step 12D Guide Assist remains intact.
- No migrations, export changes, PDF loading changes, AppShell changes, Scope Layers, Work Packages, material counts, labor engine, portal/request/review/email, dashboard, or service log files were touched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Add 25 Fixed Blueprint Colors (Step 12F, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped palette expansion preserving Step 12B/12C/12D/12E/12E-R/12E-R2
**Feature Area:** Blueprint Viewer — fixed annotation color palette
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `src/components/blueprint/ToolPopover.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Expanded the fixed Blueprint annotation palette with exactly 25 distinct added colors.
- Preserved existing palette colors, including existing orange `#f97316` and near-black `#111827`.
- Replaced requested duplicate `#F97316` with distinct fixed color `#EA580C`.
- Replaced requested duplicate `#111827` with distinct fixed color `#0F172A`.
- Updated `ToolPopover`'s shared `ColorRow` palette so shape Border Color and Fill Color popovers show the expanded palette consistently.
- Kept text/highlight-specific palettes unchanged where they intentionally pass custom color arrays.

#### Preserved
- No color picker was added.
- Step 12B Hide/Show Lighting Effects remains intact.
- Step 12C free line endpoint editing remains intact.
- Step 12D Guide Assist remains intact.
- Step 12E electrical symbols, emergency metadata, Hide/Show Labels, and polished switch/dimmer render path remain intact; electrical symbols use the same expanded shape color controls.
- No migrations, export changes, PDF loading changes, AppShell changes, Scope Layers, Work Packages, material counts, labor engine, portal/request/review/email, dashboard, or service log files were touched.

**Lock released** — Blueprint palette files are free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Switch/Dimmer Polish + Electrical Label Toggle (Step 12E-R2, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped correction preserving Step 12B/12C/12D/12E/12E-R
**Feature Area:** Blueprint Viewer — Switch/Dimmer symbol polish and electrical label visibility
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Updated `electrical-switch` to render as an app-styled blueprint switch mark: an `S` with a horizontal middle line, no circle.
- Updated `electrical-dimmer` to use the same `S` with middle-line switch base while keeping the external `DIM` corner label.
- Added local UI state `electricalSymbolLabelsVisible` defaulting to `true`.
- Added a `Hide Labels` / `Show Labels` button below the Electrical Symbols grid.
- Updated the shared external electrical label helper so `DIM`, `2x2`, `2x4`, `GFCI`, `REC`, `TMR`, `PC`, and `EM` labels hide while symbol bodies remain visible.

#### Preserved
- Step 12B Hide/Show Lighting Effects remains intact and still only controls can-light glow/output.
- Step 12C free line endpoint editing remains intact.
- Step 12D Guide Assist remains intact because electrical symbols still use the existing `shape` rect path.
- Step 12E shape kinds, side-panel labels, shape popover emergency toggle, and additive `meta.emergency` persistence remain intact.
- Step 12E-R external corner label format remains the default when labels are visible.
- No Step 12F color palette work, migrations, export changes, PDF loading changes, AppShell changes, Scope Layers, Work Packages, material counts, or labor metadata were added.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Electrical Symbols Visual Polish (Step 12E-R, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped polish preserving Step 12B/12C/12D/12E
**Feature Area:** Blueprint Viewer — Electrical Symbols visual polish
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Polished
- Reworked `renderElectricalSymbolSvg()` to use a shared small bottom-right external label badge for labeled electrical symbols.
- Replaced centered labels for Dimmer, panel sizes, GFCI/Receptacle, Timer Control, Photocell, and Emergency Recessed Light with bottom-right labels that do not cover the main symbol.
- Redesigned Switch from a circled/diagonal-over-S mark into a stroke-based architectural switch glyph with a terminal dot and switch-leg detail.
- Updated Dimmer to use a switch-style base glyph with dimmer tick marks and external `DIM` label.
- Kept Recessed Light circular and moved its emergency `EM` badge to the shared bottom-right label style.

#### Preserved
- Step 12B Hide/Show Lighting Effects remains intact and still only controls can-light glow/output.
- Step 12C free line endpoint editing remains intact.
- Step 12D Guide Assist remains intact because electrical symbols still use the existing `shape` rect path.
- Step 12E shape kinds, side-panel labels, shape popover emergency toggle, and additive `meta.emergency` persistence remain intact.
- No Step 12F color palette work, migrations, export changes, PDF loading changes, AppShell changes, Scope Layers, Work Packages, material counts, or labor metadata were added.
- Browser smoke check reached the auth landing page locally; deeper placement QA was blocked without logging in or creating an account.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Electrical Symbols Foundation (Step 12E, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped implementation preserving Step 12B/12C/12D/12D-R/12D-R2
**Feature Area:** Blueprint Viewer — Electrical Symbols Foundation
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ via Node npm CLI workaround | **Build:** ✅ 0 errors, 20.15s (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Added electrical symbol `shapeKind` values for Switch, Dimmer, Recessed Light, Pendant Light, Sconce, 2x2 LED Panel, 2x4 LED Panel, GFCI, Receptacle, Timer Control Box, and Photocell.
- Added an "Electrical Symbols" section under Draw / Mark, below Pen, Marker, Eraser, and Shapes.
- Rendered electrical symbols through the existing `shape` annotation path using simple SVG bodies that respect existing border/fill/opacity controls.
- Added a Recessed Light edit toggle for `meta.emergency`, displayed as an EM badge on the recessed light symbol.
- Added readable side-panel labels for electrical symbols, including `Recessed Light · EM`.

#### Preserved
- Step 12B Hide/Show Lighting Effects remains intact and still only controls can-light glow/output, not symbol bodies or EM badges.
- Step 12C absolute line endpoint metadata and free endpoint dragging remain intact.
- Step 12D/12D-R/12D-R2 Guide Assist remains UI-only and works through existing shape rects for placement and move.
- Existing `can-light-4` / `can-light-6` rendering and controls remain on their existing branch.
- No migrations, export changes, PDF loading changes, AppShell changes, portal/request/review/email changes, Scope Layers, Work Packages, material counts, or labor metadata were added.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Guide Assist While Moving Existing Shapes (Step 12D-R2, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped repair preserving Step 12B/12C/12D/12D-R
**Feature Area:** Blueprint Viewer — Guide Assist during existing annotation move
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 21.77s (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Added `updateMoveGuideLines()` to reuse the existing Guide Assist candidate/rendering path while moving existing annotations.
- Connected `handleAnnotationLayoutPointerMove()` move branches to Guide Assist using the same clamped normalized rect used by the existing move behavior.
- Excluded the dragged annotation ID from guide targets so moved shapes only compare against other same-page annotations.
- Cleared move guide lines on layout pointer up and pointer cancel.

#### Preserved
- Step 12D-R new placement guides continue to use the live preview rect path.
- Step 12B Hide/Show Lighting Effects remains intact.
- Step 12C free line endpoint editing remains intact; endpoint and arch-control drags were not connected to move guides.
- Guide lines remain UI-only: no annotations, no persistence, no counts, no export changes.
- No Step 12E Electrical Symbols, migrations, AppShell, PDF loading, export, portal/request/review/email, dashboard, service log, Scope Layers, Work Packages, or color palette work was started.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Guide Assist Repair (Step 12D-R, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped repair preserving Step 12B/12C/12D
**Feature Area:** Blueprint Viewer — Guide Assist placement flow
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 21.57s (pre-existing Vite eval/dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Repaired
- Guide Assist now derives the active placement rect from the same live pixel preview source that updates `draftRectDomRef`, then normalizes that rect for same-page alignment matching.
- Guide lines now render imperatively into a persistent overlay SVG ref (`alignmentGuideSvgRef`) so pointer-move guide updates no longer depend on React-rendered children while the draft preview is also being mutated directly.
- Increased the normalized threshold to a more forgiving value for manual square-to-square alignment.
- Kept Guide Assist visual-only: no annotations, no persistence, no counts, no export changes.

#### Preserved
- Step 12B Hide/Show Lighting Effects and can-light glow conditional rendering remain intact.
- Step 12C free line endpoint metadata/editing remains intact.
- No Step 12E Electrical Symbols, migrations, AppShell, PDF loading, export, portal/request/review/email, dashboard, service log, Scope Layers, Work Packages, or color palette work was started.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Alignment Guide Helper (Step 12D, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped implementation preserving Step 12B/12C
**Feature Area:** Blueprint Viewer — Guide Assist placement helper
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 17.11s (pre-existing Vite dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Added local UI-only `alignmentGuidesEnabled` and `activeAlignmentGuides` state.
- Added a View toolbar `Guide Assist` toggle near Hide Annotations and Hide Lighting Effects.
- While drawing/placing via the existing draft flow, Guide Assist compares the draft rect's left/center/right and top/center/bottom positions against same-page existing annotations.
- Matching positions render temporary dashed cyan guide lines across the current page overlay.
- Guide lines clear on pointer up, pointer cancel, Escape, tool/page changes, and when annotations/guides are hidden.

#### Preserved
- Step 12B `lightingEffectsVisible`, Hide/Show Lighting Effects button, and can-light glow conditional rendering remain intact.
- Step 12C absolute endpoint metadata, relative fallback, and free line endpoint dragging remain intact.
- Guide lines are not annotations, are not saved, do not affect counts, and do not affect export.
- No migration, service, PDF loading, export, portal/request/review/email, dashboard, website, or AppShell changes were made.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Free Line Endpoint Editing (Step 12C, NOT COMMITTED)

**Agent:** Cursor
**Mode:** Scoped implementation continuing stale Claude partial
**Feature Area:** Blueprint Viewer — line/arrow/arch endpoint editing
**Branch:** main | HEAD = 5017337
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 27.84s (pre-existing Vite dynamic-import/chunk warnings only) | **git diff --check:** PASS ✅

#### Files Changed
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### What Was Implemented
- Completed the additive absolute endpoint model for line-like shapes using `meta.lineAbsX1`, `meta.lineAbsY1`, `meta.lineAbsX2`, and `meta.lineAbsY2`.
- Straight line, arrow, and arch-line rendering now prefers absolute page-normalized endpoints when present and falls back to existing `lineX1`, `lineY1`, `lineX2`, and `lineY2` relative metadata for old annotations.
- Endpoint drag now updates only the dragged endpoint, follows pointer movement freely in page-normalized coordinates, and persists absolute endpoint metadata.
- The old relative endpoint fields are still written during edits as a compatibility fallback; no migration was added.
- Moving an edited line-like shape shifts absolute endpoints with the shape. Arch-line control metadata (`archCtrlX`, `archCtrlY`) remains absolute and shifts during whole-shape moves.
- Copy/paste now shifts absolute endpoint metadata when an edited line-like annotation is pasted.

#### Preserved
- Step 12B `lightingEffectsVisible`, Hide/Show Lighting Effects button, and can-light glow conditional rendering remain intact.
- Hide Annotations behavior, PDF loading, annotation save/load, export behavior, selection popover, Move/Edit/Copy/Delete, and non-line shapes were not intentionally changed.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-30 — Blueprint Viewer: Hide Lighting Effects Toggle (Step 12B, NOT COMMITTED)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped implementation
**Feature Area:** Blueprint Viewer — can-light glow/output overlay visibility
**Branch:** main | HEAD = 4c2fdc8
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 16.24s (pre-existing chunk-size warnings only)

#### Files Changed (1)
- `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`

#### What Was Implemented
- New state `lightingEffectsVisible` (default `true`), declared next to existing `annotationsVisible`.
- New "Hide Lighting Effects" / "Show Lighting Effects" button added to the View toolbar bucket, between "Hide Annotations" and "Fit to Full Page", styled identically to the existing Hide Annotations toggle (amber active state, Eye/EyeOff icon).
- The can-light glow `<circle>` (the radial-gradient light-output overlay, previously always rendered) is now wrapped in `{lightingEffectsVisible && (...)}`. This is the ONLY visual affected — trim ring, crosshair, aperture circle, and size label all render unconditionally as before.
- Toggle does not touch `focusedAnnotationId`, selection, side-panel listing, annotation counts, or storage — purely a render-time conditional on one SVG element.

#### What Was NOT Changed
- `annotationsVisible` / Hide Annotations behavior — untouched.
- Symbol bodies, annotation storage, annotation counts — untouched.
- `AppShell.tsx`, Supabase migrations, portal/service/dashboard files — untouched.
- No commit made.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-06-24 — App Phase 1: Internal Lead Notification + Attribution Capture

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped implementation
**Feature Area:** Portal lead notification + marketing attribution
**Branch:** main
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 15.25s (pre-existing chunk-size warnings only)

#### Files Changed (3)

| File | Change |
|---|---|
| `netlify/functions/notify-new-lead.ts` | NEW — internal Resend email notification function |
| `src/views/CustomerPortalView.tsx` | Attribution capture at mount + fire notify-new-lead after save |
| `netlify/functions/portal-confirm-email.ts` | Fixed placeholder phone `(760) 555-0100` → `(760) 623-8962` |

#### What Was Implemented

**1. `notify-new-lead.ts` (new Netlify function)**
- POST endpoint, same pattern as `notifyNewBetaUser.ts`
- FROM: `app@poweronsolutionsllc.com` (consistent with `portal-confirm-email.ts` verified domain)
- TO: `app@poweronsolutionsllc.com`
- Subject: `New Portal Lead — {name} · {serviceCategory}`
- HTML email: lead table (name, phone, email, address, city, service, request type, submitted, request ID) + notes block + green attribution block
- Attribution section extracted from notes string for clean visual display
- Requires `RESEND_API_KEY` env var (same as all other notification functions)

**2. `CustomerPortalView.tsx` — Attribution capture**
- New `attribution` state (`Record<string, string>`)
- New `useEffect` at mount (try/catch, non-critical) captures: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `gclid`, `gbraid`, `wbraid`, `page_url` (`window.location.href`), `referrer` (`document.referrer`)
- Attribution appended to `payload.notes` as `Attribution: key=val key=val ...` using the existing `|` separator pattern — existing GC company/ideal_date notes are preserved
- No new Supabase columns added; attribution lives in the existing `notes` field

**3. `CustomerPortalView.tsx` — Notify call**
- After `setSubmitted(true)` (inside try block), fire-and-forget `fetch('/.netlify/functions/notify-new-lead', {...}).catch(() => {})`
- Passes: requestId, name, phone, email, address, city, serviceCategory, requestType, notes (with attribution), submittedAt
- Lead creation flow is completely unaffected by any failure in this call

#### Safety Guarantees
- Lead creation (`portal_requests` insert) never fails because of notification or attribution logic
- Attribution capture is wrapped in try/catch; a missing `window.location` or `document.referrer` is silently ignored
- Notification fetch failure is caught with `.catch(() => {})`
- No new Supabase columns required; attribution is stored in the existing `notes` field

#### Files NOT Changed
- `/portal` form behavior — identical to before
- Supabase schema — no changes
- Dashboard, revenue, blueprint, v15r files — untouched
- Static website folder — untouched
- `notifyNewBetaUser.ts` FROM domain — left as-is (cannot confirm Resend domain verification without account access)

#### Manual Test Steps
1. Open `/portal` with UTM params: `/portal?utm_source=google&utm_medium=cpc&utm_campaign=summer`
2. Fill in the form (name, phone or email, service category)
3. Submit — form should behave identically to before (success screen, tracking link)
4. Check `portal_requests` in Supabase: `notes` column should contain `Attribution: utm_source=google utm_medium=cpc utm_campaign=summer page_url=...`
5. Check `app@poweronsolutionsllc.com` inbox: email titled `New Portal Lead — {name} · {ServiceCategory}` should arrive within seconds

#### Future Supabase SQL (optional schema enhancement)
```sql
-- Add dedicated attribution columns if you want to query/filter by UTM source later:
ALTER TABLE portal_requests
  ADD COLUMN IF NOT EXISTS utm_source   text,
  ADD COLUMN IF NOT EXISTS utm_medium   text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content  text,
  ADD COLUMN IF NOT EXISTS utm_term     text,
  ADD COLUMN IF NOT EXISTS gclid        text,
  ADD COLUMN IF NOT EXISTS gbraid       text,
  ADD COLUMN IF NOT EXISTS wbraid       text,
  ADD COLUMN IF NOT EXISTS page_url     text,
  ADD COLUMN IF NOT EXISTS referrer     text;
```
Once these columns exist, `CustomerPortalView.tsx` can be updated to write attribution directly rather than into `notes`.

**Lock released** — all files free for other agents.

---

### 2026-06-24 — Palm Desert Imported Lead Map Coordinates

**Agent:** Codex
**Mode:** Scoped audit + controlled coordinate backfill
**Branch:** main

#### Root cause

- Production read-only audit found 84 `source='palm_desert_aura'` leads.
- All 84 are active with `status='new'`.
- All 84 have `geocoding_status='pending'`.
- Zero have `latitude`/`longitude`; therefore zero qualify for normal HUNTER map pins.
- `HunterMap` requires numeric `latitude`/`longitude` (translated to `lat`/`lng`) and active status. It does not exclude Palm Desert by source or city.
- The Aura importer wrote addresses but did not geocode. TLMA geocodes before upsert; EnerGov also currently writes without geocoding.

#### Files inspected

- `AGENT_SHARED_CONTEXT.md`
- `.agents/AGENTS.md`
- `src/components/hunter/HunterPanel.tsx`
- `src/components/hunter/HunterMap.tsx`
- `src/store/hunterStore.ts`
- `src/services/hunter/HunterTypes.ts`
- `src/services/geocoding/GeocodingClient.ts`
- `src/utils/googleMapsLoader.ts`
- `netlify/functions/city-scraper.ts`
- `netlify/functions/city-scraper/shared.ts`
- `supabase/functions/geocode-backfill/index.ts`
- `supabase/functions/geocode-single/index.ts`
- `supabase/functions/tlma-scraper/geocoding.ts`
- `supabase/functions/tlma-scraper/supabase-client.ts`
- `supabase/migrations/052_hunter_tables.sql`
- `supabase/migrations/070_tlma_scraper_schema.sql`
- `supabase/migrations/071_geocoding_distance_settings.sql`
- `supabase/migrations/074_source_city.sql`

#### Files changed

- `netlify/functions/city-scraper.ts`
- `AGENT_SHARED_CONTEXT.md`

#### Backfill route

Dry-run:
`https://app.poweronsolutionsllc.com/.netlify/functions/city-scraper?action=palm-desert-geocode-backfill&batchSize=25`

Controlled coordinate write:
`https://app.poweronsolutionsllc.com/.netlify/functions/city-scraper?action=palm-desert-geocode-backfill&batchSize=25&write=true&confirm=palm-desert-geocode`

- Dry-run is the default.
- A write requires the exact `palm-desert-geocode` token.
- Invalid confirmation returns HTTP 400 before database or geocoder access.
- Selection and update guards require the fixed tenant plus `source='palm_desert_aura'`, `source_city='Palm Desert'`, `lead_type='permit'`, and missing latitude or longitude.
- The route never inserts leads and only updates `latitude`, `longitude`, `geocoded_at`, `geocoding_status`, and `distance_from_base_miles`.
- Response includes dry/write flags, total missing rows, selected/geocoded/updated/skipped counts, remaining rows, errors, and sample addresses.

#### Geocoding behavior

- The existing Supabase `geocode-single`/Google path remains the primary provider.
- Local safe dry-run found that deployed Google geocoding currently returns `REQUEST_DENIED` because the server API key configuration is invalid/restricted.
- Added an official U.S. Census Geocoding Services fallback using `Public_AR_Current`.
- Census results must fall inside broad Coachella Valley coordinate bounds before acceptance.
- Palm Desert Aura addresses are already full street/city/state/ZIP strings and produced valid matches.
- Future newly inserted Palm Desert Aura leads now use the same geocoding path before insert. Existing lead updates preserve coordinates.

#### Verification

- Production read-only audit: 84 total, 0 with coordinates, 84 missing coordinates.
- Invalid-confirmation test: HTTP 400, 0 writes.
- Ten-row backfill dry-run: 10 selected, 10 geocoded, 0 updated, 0 skipped, 0 errors, 1.27 seconds.
- Post-dry-run production read-only audit: still 0 with coordinates and 84 missing, confirming no writes occurred.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed; existing Vite dynamic-import/chunk-size warnings only.
- No production backfill write was invoked.

#### Risks / next task

- The Google server-side geocoding key remains misconfigured; Census fallback is currently carrying the route.
- U.S. Census coordinates are address-range interpolations and may be less precise than rooftop Google coordinates.
- Live HUNTER map pins cannot be visually confirmed until the controlled backfill is deployed and explicitly approved for write.
- Next: deploy, run the production dry-run, then request explicit approval for bounded write batches and verify HUNTER → Palm Desert pins.

---

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

### 2026-06-23 — EVR + 8-Week Cash Flow Projection Accuracy + Control Redesign (NOT COMMITTED — awaiting user review)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Implementation (accuracy fix + UX redesign — NO CFOT math changes)
**Feature Area:** Graph Dashboard — EVR + 8-Week Cash Flow Projection
**Branch:** main | HEAD = 40f5225 (at start); no commit made
**Typecheck:** 0 errors ✅ | **Build:** ✅ 0 errors, 16.67s (pre-existing chunk-size warnings only)

#### Files Changed (4)

| File | Change |
|---|---|
| `src/services/revenueTimelineService.ts` | Service actual: `getServiceLogTotalBillable(svc)` → `n(svc.collected)` |
| `src/components/v15r/charts/EVRChart.tsx` | `EVRTooltip` accepts `hasDateFilter` prop; income marked "(window)"; contextual footer |
| `src/components/v15r/charts/SVGCharts.tsx` | `CashFlowProjectionChart`: wider bars (0.35→0.42), current-week indigo highlight, cleaner tooltip text, updated legend |
| `src/components/v15r/V15rDashboard.tsx` | EVR + 8-Week control blocks redesigned (compact inline-style buttons); updated subtitles |

#### 1. revenueTimelineService.ts — Service Actual Accuracy Fix

**Bug:** `get8WeekCashFlow()` used `getServiceLogTotalBillable(svc)` (total invoiced) as the "actual collected" amount. This overstated actuals for partially-paid calls and incorrectly treated invoiced-but-not-collected amounts as received.

**Fix:** Changed service actual section to `n(svc.collected)` — money actually received. Skips the log if `collected === 0` (no revenue received). Tooltip detail label changed from `Total Billable - date` to `collected · date`.

#### 2. EVRChart.tsx — Tooltip Clarity

**Bug:** "Previous Week / Next Week" buttons shift the income-log filter window, NOT the project sequence. AR and Pipeline lines never change on click. Users expected the chart to shift but only the income calculation changed.

**EVRTooltip changes:**
- Accepts `hasDateFilter` prop (computed as `!!(dateStart || dateEnd)`)
- When a date window is active: income entry shows `(window)` annotation; footer explains "Income = logs collected in the selected window only. AR and Pipeline are current totals, unfiltered."
- When no filter: footer reads "Income = all collected payments to date. AR and Pipeline are current totals."

Tooltip usage: `<Tooltip content={<EVRTooltip hasDateFilter={!!(dateStart || dateEnd)} />} />`

#### 3. SVGCharts.tsx — CashFlowProjectionChart UX

**Bar width:** `var barW = groupW * 0.42` (was 0.35) — wider bars, easier to read.

**Current-week highlight:** Before the SVG bar rendering loop, detects current calendar week by comparing each bucket's `weekStart` to today. Renders an indigo rect (`fill="#6366f1"`, `fillOpacity=0.08`) spanning the full column height for the current week.

**Tooltip text:**
- `Actual:` → `Actually collected:`
- `service-log Total Billable` → `service collected`
- Empty-state labels updated to match

**Legend (4 items):**
- `Projected` → `Projected (phase schedule)`
- `Actual` → `Actually collected`
- `Overlap window` → `Overlap pressure window`
- Added: `Current week` (indigo tint swatch)

#### 4. V15rDashboard.tsx — Control Block Redesign

**EVR controls (was: Previous Week / Next Week / Timeline):**
- Now: `← Earlier Window · Later Window → | Reset Window · Timeline`
- Compact inline-style buttons (no Tailwind h-7/min-w), matching CFOT nav style
- Hover: `rgba(59,130,246,0.12)` blue tint
- Subtitle: `Projects sorted by pipeline entry date · Income window: {evrWindowLabel} · AR and Pipeline reflect current totals`
- "Reset Window" resets to `rcaDefaultStart` / `rcaDefaultEnd` inline (no new function needed)

**8-Week controls (was: Previous Week / Next Week / Timeline):**
- Now: `← Earlier · Later → | Reset · Timeline`
- Same compact inline-style buttons
- Subtitle: `{cashFlowWindowLabel} · Amber outline = projected (phase schedule) · Green fill = actually collected · 🔴 = overlap pressure window`
- "Reset" resets to `todayIso` (existing variable)

#### What Was NOT Changed
- All CFOT math formulas in `V15rDashboard.tsx` — untouched
- `CFOTChart.tsx` — not touched
- Blueprint files — untouched
- Phase Timeline, Gantt, Planned vs Actual — untouched
- Layout/header, project cards, auth/sync/storage — untouched
- No commit made — awaiting user review

#### Manual Verification Checklist
1. EVR controls say "← Earlier Window" / "Later Window →" / "Reset Window" / "Timeline"
2. EVR subtitle mentions "Income window" and "AR and Pipeline reflect current totals"
3. EVR tooltip shows "(window)" next to income when a date filter is active
4. EVR tooltip footer explains income vs AR/Pipeline distinction
5. 8-Week controls say "← Earlier" / "Later →" / "Reset" / "Timeline"
6. 8-Week subtitle explains amber/green/red legend
7. 8-Week chart current week has faint indigo column highlight
8. 8-Week bars are slightly wider than before
9. 8-Week tooltip says "Actually collected:" (not "Actual:")
10. 8-Week legend: "Projected (phase schedule)" / "Actually collected" / "Overlap pressure window" / "Current week"
11. Service actual in 8-Week now reflects collected (not invoiced total) — check calls where quoted > collected

**Lock status:** EVR-8Week-Audit lock RELEASED — all four files free for other agents.

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

#### Next Recommended Task
Deploy and verify the production dry-run report, review false positives/negatives in the highest-scoring records, then define a production importer contract covering canonical scoring, dedup/upsert keys, run logging, dry-run approval, and safe `hunter_leads` writes.

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

#### Next Recommended Task
After deploy, verify the dry-run and invalid-confirmation routes. Then, with explicit user approval, run one controlled write and inspect inserted/updated counts plus several `hunter_leads` records before considering UI controls, source-aware run logging, scheduling, or schema enhancements.
### 2026-06-24 — Imported Permit Lead Title Fallback

**Agent:** Codex
**Mode:** Scoped UI/data display fix
**Branch:** main

#### Files inspected

- `AGENT_SHARED_CONTEXT.md`
- `.agents/AGENTS.md`
- `src/components/hunter/HunterPanel.tsx`
- `src/components/hunter/HunterLeadCard.tsx`
- `src/stores/hunterStore.ts`
- `src/types/hunter.ts`
- `netlify/functions/city-scraper.ts`

#### Files changed

- `src/components/hunter/HunterLeadCard.tsx`
- `AGENT_SHARED_CONTEXT.md`

#### Result

- Permit lead card headers now prefer existing project/name/title/contact values.
- When those are absent, permit leads fall back through permit number + short address, permit number, short address, short description, then `Permit Lead`.
- A Palm Desert record such as permit `CRAD-25-5018` with address `73010 EL PASEO 1 PALM DESERT, CA 92260` displays as `CRAD-25-5018 — 73010 EL PASEO 1`.
- Both collapsed and expanded lead-card headers use the same display title.
- Portal/source badge labeling and source URL behavior were not changed.
- Scraper/import behavior, schema, TLMA, dashboards, Blueprint, Solar Training, and app chrome were not changed.

#### Verification

- `npm.cmd run typecheck` — passed.
- `npm.cmd run build` — passed; existing Vite chunk-size/dynamic-import warnings only.
- Live browser verification was attempted, but no reachable local Vite instance was available in the in-app browser. Palm Desert title behavior was verified through the rendered card data path and fallback logic; post-deploy visual confirmation remains recommended.

#### Risks / next task

- Low risk: title generation is isolated to permit lead card display.
- Next recommended task: after deployment, open Sales Intelligence → HUNTER → Palm Desert and visually confirm imported cards and unchanged website Portal cards.

---

### 2026-06-27 - Portal Status Sync + Review Request Flow

**Agent:** Codex
**Mode:** Scoped implementation
**Feature Area:** Portal Tracking + Review Automation
**Branch:** main

#### Files changed

- `src/services/portal/portalService.ts`
- `src/components/hunter/HunterLeadCard.tsx`
- `src/components/layout/AppShell.tsx`
- `src/components/v15r/V15rProjectsPanel.tsx`
- `src/components/v15r/V15rFieldLogPanel.tsx`
- `src/views/PortalTrackView.tsx`
- `netlify/functions/send-review-request.ts`
- `supabase/migrations/079_portal_review_request_fields.sql`

#### Result

- Added idempotent `portal_requests` + `job_timeline` helpers for `on_my_way`, `arrived`, `work_started`, and `work_completed`.
- Existing accepted/scheduling/confirmed writers now reuse the shared helper rather than blindly inserting duplicate milestone rows.
- Customer Tracker controls now appear inside expanded HUNTER cards only when the lead is connected to a live `portal_requests` row.
- Work Completed writes a `work_completed` timeline event, sets `portal_requests.status = 'closed'`, sets `completed_at`, then opens a review request modal.
- Added `send-review-request` Netlify function using Resend and the approved Google review link only.
- Added additive nullable review-tracking columns to `portal_requests`.

### 2026-07-01 — Blueprint Viewer Overlay Layer Lock

**Agent:** Codex
**Mode:** Scoped bug fix
**File Lock:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`
**Baseline:** `61381da` accepted (`Fix Blueprint annotations disappearing on zoom`)
**Frozen Zones:** iPad fullscreen layout; default/non-fullscreen document and annotations-panel layout; scrollbars/scroll handle behavior; 1000% max zoom; raster cap/renderedZoom/visualScale mechanism; canvas backing-store sizing; save/sync; Work Packages; colors; opacity; labels; light/glare effects; selection/move/edit/copy/delete; rotation; measurements; circuit paths; canvas/overlay/selection z-order.
**Open Item:** overlay out of transformed layer.

#### Verification

- `npm.cmd run typecheck`: PASS
- `npm.cmd run build`: PASS, with existing Vite dynamic-import/chunk-size warnings.
- `git diff --check`: PASS, with normal CRLF warnings only.

**Lock released** - portal status/review files free for other agents.

---

### 2026-06-27 — Portal Tracker Relocation (Step 11D)

**Agent:** Claude Code Sonnet 4.6
**Mode:** Scoped implementation
**Feature Area:** Portal Tracking + Service Call Workflow Cleanup
**Branch:** main
**Typecheck:** 0 errors ✅ | **Build:** ✅ built in 14.86s, 0 errors (pre-existing chunk-size warnings only)
**git diff --check:** PASS — CRLF warnings only (pre-existing for this file; same as Step 11B)

#### Files Changed (4 source + 1 new)

| File | Change |
|---|---|
| `src/components/portal/PortalStatusControls.tsx` | NEW — extracted shared component from HunterLeadCard; accepts `lead` or `hunterLeadId` |
| `src/components/hunter/HunterLeadCard.tsx` | Removed full `PortalStatusControls`; replaced with read-only `PortalTrackingBadge` |
| `src/components/salesIntel/tabs/PipelineTab.tsx` | Added `PortalStatusControls` in `LeadTypeToggle` — only when portal lead + `service_call` mode |
| `src/components/v15r/V15rFieldLogPanel.tsx` | Added `PortalStatusControls` import; added `hunterLeadId` field to saved estimate object; added `PortalStatusControls` render in Open Estimates bucket for estimates with `hunterLeadId` |
| `AGENT_SHARED_CONTEXT.md` | This log entry |

#### What Changed

**Step 11B backend helpers preserved (unchanged):**
- `portalService.ts` — all lifecycle helpers, idempotent `writePortalTimelineEvent`, `writePortalLifecycleEvent`, `sendPortalReviewRequest`
- `PortalTrackView.tsx`, `send-review-request.ts`, migration 079 — untouched

**`PortalStatusControls.tsx` (new shared component):**
- Extracted from `HunterLeadCard.tsx` Step 11B implementation
- Props: `lead?: HunterLead` (Pipeline usage) OR `hunterLeadId?: string` (Open Estimates usage)
- Uses `fetchPortalTrackerStateForLead` to load state for whichever id is supplied
- Full On My Way / Arrived / Work Started / Work Completed buttons preserved
- Review request modal after Work Completed preserved
- Duplicate send protection (review_requested_at guard) preserved

**`HunterLeadCard.tsx`:**
- Removed `PortalStatusControls` component (193 lines)
- Removed no-longer-needed imports: `Loader2`, `Zap`, `PORTAL_LIFECYCLE_EVENT_TYPES`, `getPortalTimelineMeta`, `sendPortalReviewRequest`, `writePortalLifecycleEvent`
- Added `PortalTrackingBadge` — read-only status badge showing current `portal_requests.status` + link to `/portal/track/:requestId`
- Render call in expanded view: `<PortalTrackingBadge lead={lead} />` (was `<PortalStatusControls lead={lead} />`)

**`PipelineTab.tsx`:**
- Added import: `PortalStatusControls` from shared file
- `LeadTypeToggle`: detects portal lead via `source === 'customer_portal' || source_tag === 'customer_portal'`
- Renders `<PortalStatusControls lead={lead} />` only when: portal lead AND `type === 'service_call'`
- Project mode: no tracker buttons (correct — projects don't need field-day status)
- All existing toggle/Open Estimate/Return to Leads behavior unchanged

**`V15rFieldLogPanel.tsx`:**
- Added import: `PortalStatusControls` from shared file
- Estimate save: adds `hunterLeadId: (!editEstimateId && portalLeadId) ? portalLeadId : undefined` — only on new estimates from portal prefill; edits don't overwrite
- Open Estimates bucket: each estimate card layout changed from flat `flex items-center justify-between` to `space-y-2`; if `est.hunterLeadId` is set, renders `<PortalStatusControls hunterLeadId={est.hunterLeadId} />`
- Old estimates without `hunterLeadId` are completely unaffected

#### Correct Workflow After Step 11D

1. Portal request arrives → Portal Inbox → Convert to Lead → HUNTER lead (source='customer_portal')
2. HUNTER lead card expanded → shows read-only ⚡ Portal Tracking badge + Track link; no operational buttons
3. Mark lead Won → appears in Pipeline
4. Pipeline card: select 📋 Project → no tracker; select 🔧 Service Call → Customer Tracker buttons appear
5. "Open as Service Call" → Field Log / Service Log estimate form pre-filled; saves estimate with `hunterLeadId`
6. Estimate appears in Open Estimates → Customer Tracker buttons visible via saved `hunterLeadId`
7. Click On My Way / Arrived / Work Started / Work Completed → updates `job_timeline` + `portal_requests`
8. Work Completed → opens review request modal → send review email

#### Safety Notes
- Non-portal service estimates: `hunterLeadId` is `undefined` → no tracker rendered
- Editing an existing estimate: `hunterLeadId` not overwritten (guard: `!editEstimateId`)
- HUNTER cards for non-portal leads: `PortalTrackingBadge` returns null (isPortalLead guard)
- `portal_requests`, `job_timeline`, `PortalTrackView` unchanged

**Lock released** — `HunterLeadCard.tsx`, `PipelineTab.tsx` (salesIntel/tabs), `V15rFieldLogPanel.tsx`, `PortalStatusControls.tsx` are free for other agents.

---

### 2026-07-02 — Blueprint Symbols Size Popup Position + 500% Label Scale + Label Color Override (Step 13D-R1)

**Agent:** Claude (Opus 4.8)
**Mode:** Scoped implementation
**File Lock:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` — CLAIMED
**Baseline:** `7ad5e06` (Add Blueprint soft guides data symbols and label size control)
**Status:** IN PROGRESS

Task: reposition Symbols Size popup to open below its button (clamped to viewport, still draggable), raise label scale max from 175% to 500%, and add a label-only "Custom Label Colors" toggle (text/border/fill) that overrides label styling only — symbol bodies/geometry untouched. No zoom/rendering/sync/layout changes.

**Verification**
- `npm.cmd run typecheck`: PASS (0 errors)
- `npm.cmd run build`: PASS (existing chunk-size warnings only, no errors)
- `git diff --check`: PASS (CRLF-only warnings, no conflict markers/whitespace errors)

**What changed**
- Symbols Size popup now opens just below its toggle button (measured via new `symbolSizeButtonRef` + `openSymbolSizePanel`), clamped to viewport; remains draggable, closable, resettable as before.
- `symbolLabelScale` slider range raised from 75%–175% to 75%–500% (clamp in `renderElectricalSymbolSvg` raised from 2.5 to 5); label-only, symbol glyph/geometry untouched.
- Added "Custom Label Colors" toggle (`symbolLabelCustomColorsEnabled`) with Text/Border/Fill color pickers (`symbolLabelTextColor`, `symbolLabelBorderColor`, `symbolLabelFillColor`) + Reset Colors button, applied only inside `externalLabel()`'s badge — symbol bodies/paths/annotation data untouched. OFF (default) preserves prior per-symbol default label colors exactly.
- All new state is local component UI state (useState) — resets on reload, not persisted, no sync/service files touched.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-02 — Blueprint 240V Receptacle Symbol (Step 13D-R2)

**Agent:** Claude (Opus 4.8)
**Mode:** Scoped implementation
**File Lock:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` — CLAIMED (applied on top of uncommitted R1 changes, not reset/reverted)
**Baseline:** `7ad5e06` + uncommitted R1 (Symbols Size popup position/500%/custom label colors)
**Status:** IN PROGRESS

Task: add a visually distinct 240V receptacle electrical symbol (separate from Standard Receptacle) with a "240V" label routed through the existing shared `externalLabel` path so Symbols Size, custom label colors, and Hide Labels all apply. No zoom/rendering/sync/layout/package changes.

**Verification**
- `npm.cmd run typecheck`: PASS (0 errors)
- `npm.cmd run build`: PASS (existing chunk-size warnings only, no errors)
- `git diff --check`: PASS (CRLF-only warnings, no conflict markers/whitespace errors)

**What changed**
- Added new `ElectricalSymbolKind`/`ShapeKind` member `electrical-receptacle-240v` alongside existing `electrical-receptacle` (Standard Receptacle glyph/branch untouched).
- Added metadata entry: displayName `240V Receptacle`, shortLabel `240V`, category `power`, materialKey/laborKey `receptacle-240v` — auto-appears in `ELECTRICAL_SYMBOL_OPTIONS` (Electrical Symbols palette) since that list derives from `Object.values(ELECTRICAL_SYMBOL_METADATA)`.
- New glyph branch in `renderElectricalSymbolSvg`: same outlet-face silhouette as Standard Receptacle but with angled/diagonal blade-slot lines instead of round slots, a round ground hole below, and a heavier outline stroke — visually distinct from Standard Receptacle and GFCI.
- Label routed through the shared `externalLabel('240V')` call — same path as every other electrical symbol, so it automatically respects Hide Labels, Symbols Size (`symbolLabelScale`), and the R1 Custom Label Colors override (all from the same uncommitted working tree, preserved).
- Added to `ROTATABLE_ELECTRICAL_SHAPE_KINDS` and `ELECTRICAL_SYMBOL_VISUAL_BOUNDS` (reusing receptacle's compact selection-box bounds) so placement/rotation/selection behave consistently with other power symbols.
- No changes to placement system, package/work-package logic, sync, persistence, or any other symbol kind's rendering.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` is free for other agents.

---

### 2026-07-02 — Blueprint Work Packages Page-Aware Scoping (Step 14A)

**Agent:** Claude (Opus 4.8)
**Mode:** Scoped implementation
**File Lock:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`, `src/services/blueprintLibraryService.ts` — CLAIMED (applied on top of uncommitted prior R1/R2 changes, not reset/reverted)
**Baseline HEAD:** `d0a4292` (+ uncommitted R1/R2 Symbols Size/500%/custom label colors/240V receptacle, all preserved)
**Status:** DONE

Task: make Work Packages / Scope Layers page-aware like annotations, so a package created on Page X shows on Page X by default instead of on every page.

**Verification**
- `npm.cmd run typecheck`: PASS (0 errors)
- `npm.cmd run build`: PASS (existing chunk-size warnings only, no errors)
- `git diff --check`: PASS (CRLF-only warnings, no conflict markers/whitespace errors)

**What changed**
- `BlueprintScopeLayer` gained optional `pageNumber?: number` (`blueprintLibraryService.ts`).
- `sanitizeScopeLayer()`: keeps `raw.pageNumber` if valid; else infers from `itemRefs[0].pageNumber` if present; else leaves `pageNumber` undefined (old packages are never rejected or forced onto Page 1).
- `saveScopeLayerFromModal()` (create path only): new packages store `pageNumber: currentPage` as the package's home page. Edit path spreads `...layer, ...payloadBase` — `payloadBase` has no `pageNumber` key, so an existing package's `pageNumber` is untouched by edits (adding/removing items never moves its home page).
- New `pageFilteredScopeLayers` memo: when `scopeLayerShowAllPages` is false (default), shows packages where `pageNumber == null || pageNumber === currentPage`; when true, shows all. Both existing panel render blocks (`scopeLayers.length > 0` and the `=== 0` fallback) now map over this filtered list instead of raw `scopeLayers`.
- Added "Showing: Current Page" / "Showing: All Pages" toggle button in the Work Packages panel header (`scopeLayerShowAllPages` state, local UI only, not persisted).
- Added a page badge per card: `Page N` or `Unscoped`; added a `Spans N pages` badge (via new `getBlueprintScopeLayerDistinctPageCount` helper) when a package's `itemRefs` cover more than one distinct page — informational only.
- Eye toggle/isolate, edit, delete, reorder (up/down + drag) all continue to operate on the full `scopeLayers` array by id — filtering only changes which cards render, never mutates visibility/isolation state. Turning "Show All Pages" off does not clear `isolatedScopeLayerIds`.
- No changes to annotation filtering/rendering, zoom/canvas/overlay math, sync guard, or persistence path — `pageNumber` rides through the existing `saveOperationsBlueprintScopeLayers` flow as a normal field on the layer object.

**Lock released** — `src/components/blueprint/OperationsBlueprintPdfViewer.tsx` and `src/services/blueprintLibraryService.ts` are free for other agents.

---

### 2026-07-04 — Phase 5C: Blueprint Scope Registry Retrofit (metadata-only)

**Agent:** Claude (Opus 4.8)
**Mode:** Scoped implementation (Phase 5C)
**Baseline HEAD:** `ab65f62` (Phase 5A "Add data scope registry scaffold")
**Files touched:** `src/services/blueprintLibraryService.ts`, `src/services/scopeRegistry.ts`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE

Retrofitted the existing Blueprint save paths onto the Phase 5A scope registry as **metadata only**. No behavior change.

**What changed**
- Tagged the Blueprint annotation save path with the `blueprint.annotations` scope: `saveOperationsBlueprintAnnotations` now passes `_scopes: ['blueprint.annotations']` alongside the existing `source` strings on both the remote-merge (`annotations-remote-merge` → `saveBackupWithRemoteBaselineSync`) and first-sync (`annotations-first-sync` → `saveBackupDataAndSyncNow`) call sites.
- Tagged the Blueprint work-package/scope-layer save path with the `blueprint.workPackages` scope: `saveOperationsBlueprintScopeLayers` now passes `_scopes: ['blueprint.workPackages']` on both the remote-merge (`scope-layers-remote-merge`) and first-sync (`scope-layers-first-sync`) call sites.
- `_scopes` is an existing `SyncToSupabaseOptions` field (backupDataService.ts, Phase 5A). It is internal metadata only — never written into `BackupData` nor sent to Supabase, and `syncToSupabase` ignores it for guard logic. `backupDataService.ts` was **not** modified.
- Added a dev-only, non-throwing `console.warn` assertion in `blueprintLibraryService.ts` that the two registry descriptors' `dataPath` still reference `operationsBlueprintAnnotations` / `operationsBlueprintScopeLayers`. No-op in production.
- Corrected the `notes` on `SCOPE_REGISTRY['blueprint.annotations']` and `['blueprint.workPackages']` in `scopeRegistry.ts` to state the current implementation is **per-blueprint-set whole-array replacement onto a freshly fetched remote BackupData**, NOT true item-level id-merge, and that tombstones are still needed before item-level delete-safe merge. `DataScope` union and all descriptors otherwise unchanged.

**Explicitly NOT done**
- Did not implement item-level id-merge.
- Did not add tombstones.
- Did not change Blueprint UI (`OperationsBlueprintPdfViewer.tsx` untouched — still consumes `cloudSynced`/`localSaved`/`warning` unchanged).
- Did not change the fetch-latest → patch-blueprint-branch → remote-baseline-sync merge behavior, sanitization, array-replacement, remote-fetch, local-only fallback, warning, or return shapes.
- Did not change Phase 4 Save/stale/baseline behavior.
- Did NOT reconnect `attemptProductionMergeAndSync` or `mergeLocalChangesIntoRemote`.
- Did not touch RFIs, Field Logs, Leads, Price Book, Team, Service Calls, or Settings.

---

### 2026-07-04 — Phase 5E: Blueprint Tombstones + Item-Level Delete-Safe Merge

**Agent:** Claude (Opus 4.8)
**Mode:** Scoped implementation (Phase 5E)
**Baseline HEAD:** `3a69cf0` (Phase 5C "Tag blueprint saves with data scopes")
**Files touched:** `src/services/blueprintLibraryService.ts`, `src/services/scopeRegistry.ts`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck ✅ build ✅ (NOT committed)

Upgraded Blueprint annotations and work packages (scope layers) from per-set whole-array replacement + hard delete to **soft-delete tombstones + item-level, delete-safe id-merge**, so a stale same-set save from a second tab/device can no longer resurrect a deleted item. Runs entirely inside `blueprintLibraryService.ts` on top of the existing fetch-latest → patch-branch → remote-baseline save path. **No Save/stale/baseline change; `backupDataService.ts` untouched; `OperationsBlueprintPdfViewer.tsx` untouched.**

**Tombstone model**
- Added optional `deletedAt?: string` + `deletedBy?: string` to `BlueprintAnnotation` and `BlueprintScopeLayer`. Presence of `deletedAt` = deleted. Tombstones stay **inline** in the same per-set raw arrays (`operationsBlueprintAnnotations[setId][]` / `operationsBlueprintScopeLayers[setId][]`).
- Backward compatible: old backups without the fields are unaffected; absence never deletes.

**Timestamp defaulting fix (prerequisite)**
- New pure helpers `isValidDateString`, `parseTimestampMs`, `timestampFromId`, `normalizeCreatedAt`, `normalizeUpdatedAt`. Sanitizers no longer default a missing `createdAt`/`updatedAt` to `now()` (which made legacy rows look freshly edited and could beat real deletes). Fallback chain: valid value → timestamp parsed from the id's embedded 13-digit ms epoch → stable `1970` epoch. A tombstone's `updatedAt` is bumped to at least its `deletedAt`.

**Delete behavior**
- Annotations: `deleteOperationsBlueprintAnnotation` now writes a tombstone (`deletedAt`/`deletedBy`/`updatedAt = now`) into the raw list instead of `filter`-dropping the item, then saves the full raw list.
- Work packages: `deleteScopeLayer` in the UI still just filters the array (viewer untouched). `saveOperationsBlueprintScopeLayers` **infers** tombstones — it compares the previous raw local layers for the set against the incoming complete live array and synthesizes a tombstone for any previously-live id now missing; previously-tombstoned layers are carried forward. Safe because the pre-edit caller check confirmed every caller passes the complete live array for the set (no partial patches).

**Item-level merge**
- New pure `mergeBlueprintAnnotationsById` / `mergeBlueprintScopeLayersById` (id-keyed union). Winner per id: both live → newest `updatedAt` (exact tie → remote); tombstone vs live → tombstone wins unless the live edit is strictly newer than `deletedAt` (genuine re-edit/undelete); both tombstones → newest `deletedAt`. Tombstones are preserved in the merged raw output.
- `applyAnnotationsToBackup` / `applySanitizedScopeLayersToBackup` now **merge** the incoming array into the target backup's existing raw array for that set (was whole-array overwrite). Only the one set / one branch is touched. Because the merge runs against the freshly fetched remote (which carries the tombstone), a stale live copy loses → **no resurrection**.
- **Order:** merge is incoming-order-first, then remote-only ids appended. Deliberately deviates from the audit's "remote-order-first" suggestion so a single-device Work Package **reorder survives** the merge-against-own-remote round-trip (remote-first would have silently reverted reorders). Ordering never affects which version wins, so delete-safety is unchanged. No new order field added.

**Tombstones hidden from UI**
- Added raw accessors `getOperationsBlueprintAnnotationsRaw` / `getOperationsBlueprintScopeLayersRaw` (include tombstones, for merge/save). The public `getOperationsBlueprintAnnotations` / `getOperationsBlueprintScopeLayers` now filter out `deletedAt` items, so the viewer, summaries, and counts never render tombstones. `locallyDeletedIdsRef` in the viewer was left in place (harmless belt-and-suspenders) — not needed but not removed.

**scopeRegistry.ts** — updated only the `blueprint.annotations` / `blueprint.workPackages` descriptors: `tombstoneField: 'deletedAt'`, `needsTombstone: false`, notes now state item-level merge is implemented and record the client-clock + no-GC limitations. `DataScope` union and all other descriptors unchanged.

**Explicitly NOT done / preserved**
- `backupDataService.ts` NOT modified; `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` / `mergeBlueprintSummariesObject` remain dead (not reconnected).
- Phase 4 Save/stale/baseline, verified-save, freshness guard, monotonic baseline, same-device allowance — all unchanged.
- `OperationsBlueprintPdfViewer.tsx` NOT modified. `V15rLayout.tsx`, snapshot/milestone services, Supabase migrations, Recovery Center — untouched.
- Did not touch RFIs, Field Logs, Leads, Price Book, Team, Service Calls, or Settings.
- Existing hard-deleted items remain unrecoverable (pre-5E deletes have no tombstone); resurrection protection applies to deletes made from 5E onward. Tombstones retained indefinitely — a future phase should add GC.

**Lock released.**

---

### 2026-07-04 — Phase 5G: Fix Text-Box ID Swap Delete Bug

**Agent:** Claude (Opus 4.8)
**Mode:** Scoped implementation (Phase 5G)
**Baseline HEAD:** `cacb16b` (Phase 5E "Add blueprint tombstones and item-level merge")
**Files touched:** `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck ✅ build ✅ (NOT committed)

Fixed the isolated Blueprint UI bug found in the Phase 5F audit: an inline text annotation received a temporary `ann_draft_…` id at placement and a **different** `ann_…` id at inline commit. Deleting the box immediately (before a refresh) could pass the stale pre-swap id to `deleteOperationsBlueprintAnnotation`, which then found nothing in storage and no-op'd (`[Annotations] delete: annotation not found; nothing to tombstone`). Refresh masked it because state reloaded with the persisted id.

**What changed (two lines, one file):**
- `openCreateRichTextEditor` (Insert Text placement): the text-box id is now generated as the **final** stable `ann_${Date.now()}_${rand}` instead of `ann_draft_${…}`. Draft status is still tracked via `draftTextBoxIdRef` (unchanged), not the id string.
- `saveTextBoxEditSession` (inline commit): `persistedId = current.id` — the commit no longer mints a new id. The id is now identical across placement → inline edit → commit → persist → selection → delete, eliminating the divergence window.

**Preserved / NOT changed:**
- Empty-draft discard still works (keys off `isDraft = draftTextBoxIdRef.current === editingId`, not the id prefix).
- Rect re-measure, `withAnnotationMeta`, the in-place `setAllAnnotations` swap, `setFocusedAnnotationId`, `persistAnnotation`, and the mutation-queue ordering are all unchanged.
- `removeAnnotation` and `deleteOperationsBlueprintAnnotation` are untouched — the fix is id-identity stability, not a service-side fallback.
- No tombstone or item-level merge behavior changed. No Save/stale/baseline behavior changed. No service files changed (`backupDataService.ts`, `blueprintLibraryService.ts`, `scopeRegistry.ts` all untouched). `attemptProductionMergeAndSync` / `mergeLocalChangesIntoRemote` remain dead.
- Only affected path was inline text boxes; notes, shapes, copy/paste, rich-text-modal, moves, and existing-annotation edits already minted one stable id and were never affected.

**Lock released.**

---

### 2026-07-04 — Phase 6D: Change Order Modal Input Drag Close Fix

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6D)
**Baseline HEAD:** `015e856` (Phase 6B "Add scoped merge for project change orders")
**Files touched:** `src/components/v15r/V15rChangeOrdersTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck PASS, build PASS, localhost manual test deferred to user (NOT committed)

Fixed the Change Order modal backdrop close behavior. `COModal` now tracks whether pointer-down started on the backdrop and only allows a backdrop click close when both pointer-down and click target are the backdrop, so input drag/select gestures that start inside the modal do not close it.

Normal intentional backdrop click still closes. X/Cancel still close directly. No Change Order scoped merge, tombstone, create/edit/delete business logic, Save/stale/baseline behavior, app sync logic, dashboard calculation, or service code was changed.

This pointer-down origin tracking pattern should be reused later for other hand-coded modals that close from backdrop clicks.

---

### 2026-07-04 - Phase 6F: Project RFI Collision-Safe IDs + Scoped Tombstone Merge

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6F)
**Baseline HEAD:** `4b75fb3` (Phase 6D "Fix change order modal drag close")
**Files touched:** `src/services/projectScopeMerge.ts`, `src/components/v15r/V15rRFITab.tsx`, `src/services/scopeRegistry.ts`, `src/services/backupDataService.ts`, `src/components/v15r/ProjectCard.tsx`, `src/components/v15r/V15rProgressTab.tsx`, `src/components/v15r/V15rProjectsPanel.tsx`, `src/components/v15r/V15rHome.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE - verification pending

Implemented collision-safe `project.rfis` identity and scoped delete-safe merge. New Project RFIs get `rfiId` as the internal stable id and `rfiNumber` as the visible display number; legacy `id` remains preserved for display/backward compatibility. Existing legacy RFIs receive deterministic merge identities (`legacy:${projectId}:${id}` with a stable fingerprint suffix only when duplicate legacy ids exist in the same project) instead of random backfills, so devices agree on old-row identity.

Added RFI timestamp/defaulting helpers in `projectScopeMerge.ts`: `updatedAt` wins; then `submitted`, `createdAt`, `created_at`, `created`, `questionAt`; then stable epoch fallback. Missing timestamps are never defaulted to now during merge. Tombstones bump `updatedAt` to at least `deletedAt`.

Changed Project RFI delete from hard delete to inline tombstone (`deletedAt`, optional `deletedBy`, `updatedAt`). Added item-level `mergeRFIsByStableId` and `mergeProjectRFIsIntoRemote`: merge only `projects[target].rfis`, keep tombstones raw, tombstone wins over equal/older live rows, live can win only when strictly newer than the tombstone, both-live newest `updatedAt` wins, exact live ties prefer remote, and order is incoming-first plus remote-only append.

`V15rRFITab` now renders only `getLiveRFIs(...)`, displays `rfiNumber || id`, targets actions by stable id, creates RFIs with `crypto.randomUUID()` where available, and saves through the Phase 6B-style remote-baseline path: fetch latest remote, patch only `project.rfis`, then `saveBackupWithRemoteBaselineSync(..., { changedKey: 'projects', _scopes: ['project.rfis'] })`. Fallback remains guarded `saveBackupDataAndSync(..., 'projects', { source: 'project.rfis' })`.

Updated allowed v15r RFI count readers to ignore tombstones: central `health`, `getKPIs`, `computeVerificationSummary`, `ProjectCard`, `V15rProgressTab`, `V15rProjectsPanel`, and `V15rHome` critical-RFI alerts. Out-of-scope direct RFI readers still exist in `src/views/AbsoluteDashboardView.tsx`, `src/components/blueprint/ProjectPanel.tsx`, `src/services/proactiveAlertService.ts`, and `src/services/guardian/GuardianMetricsService.ts`; these were reported before editing and left untouched because this phase forbids Blueprint and limits non-tab count fixes to v15r readers.

`scopeRegistry.ts` updated only for `project.rfis`: identity `rfiId`, timestamp `updatedAt`, tombstone `deletedAt`, implemented flags set false, and notes record `rfiNumber` display compatibility.

Explicitly NOT changed: Change Orders, Blueprint files, Estimate/MTO, Project Logs, Payments/logs, Field Logs, Leads, Price Book, Team, Service Calls, Settings, Recovery Center, Phase 4 Save/stale/baseline behavior, `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `attemptProductionMergeAndSync`, or `mergeLocalChangesIntoRemote`.

No commit, push, deploy, manual Supabase touch, restore script, or manual localStorage write.

---

### 2026-07-04 - Phase 6H: Project Materials / MTO Scoped Tombstone Merge

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6H)
**Baseline HEAD:** `a6ab9ef` (Phase 6F "Add scoped merge for project RFIs")
**Files touched:** `src/services/projectScopeMerge.ts`, `src/components/v15r/V15rMTOTab.tsx`, `src/services/scopeRegistry.ts`, `src/services/backupDataService.ts`, `src/services/mtoExportService.ts`, `src/components/v15r/V15rEstimateTab.tsx`, `src/components/v15r/V15rPricingIntelligencePanel.tsx`, `src/components/vault/EstimatePanel.tsx`, `src/components/guardian/GuardianOwnerWalkthrough.tsx`, `src/services/embeddingService.ts`, `src/services/patternService.ts`, `src/agents/nexus/nexusContextBuilder.ts`, `src/services/hunter/HunterPortfolioService.ts`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE - typecheck PASS, build PASS, diff-check PASS

Implemented delete-safe, item-level scoped merge for `project.materials`. New MTO rows now receive stable internal `materialId`/`mtoId` values plus `createdAt`/`updatedAt`; legacy rows keep deterministic fallback identities (`legacy:${projectId}:${bucket}:${id}` with a stable content fingerprint when duplicate legacy ids exist in the same bucket). Missing timestamps are never defaulted to now during merge; fallback is `updatedAt`, then `createdAt`, then a timestamp parsed from timestamp-ish ids such as `mto${Date.now()}`, then stable epoch.

Changed normal MTO delete from hard delete to inline tombstone (`deletedAt`, optional `deletedBy`, `updatedAt`). Added pure material helpers in `projectScopeMerge.ts`: live filtering, tombstone creation, item-level merge, and `mergeProjectMaterialsIntoRemote`, which patches only `projects[target].mtoRows` and supported legacy `matRows`. Tombstones stay in raw arrays, tombstone wins against equal/older live rows, live can win only if strictly newer than the tombstone, both-live newest `updatedAt` wins, exact ties prefer remote, and output order is incoming-first plus remote-only append.

`V15rMTOTab` now renders only `getLiveMaterialRows(...)`, targets edit/delete/reorder actions by stable material identity, creates timestamped rows, and saves normal MTO row changes through the fetch-latest -> merge `project.materials` -> `saveBackupWithRemoteBaselineSync(..., { changedKey: 'projects', _scopes: ['project.materials'] })` path. The existing Add-to-Price-Book modal still writes the Price Book branch through its legacy broad save path because Phase 6H explicitly did not take ownership of Price Book writes.

Updated material readers/exports to exclude tombstones: MTO PDF export, Estimate tab read-only MTO totals/counts, central legacy `matRows` financial cost, Pricing Intelligence legacy material totals, Vault estimate-risk context, Guardian owner walkthrough legacy material line items, Embedding seed context, Pattern Service line item learning, NEXUS MTO context, and Hunter portfolio MTO highlight summaries.

`scopeRegistry.ts` updated only for `project.materials`: identity `materialId/mtoId`, timestamp `updatedAt`, tombstone `deletedAt`, implemented flags set false, and notes record that `project.estimate` remains future/unimplemented.

Explicitly NOT implemented or changed: `project.estimate`, `laborRows`, `ohRows`, `contract`, `mileRT`, `miDays`, `laborPhaseColors`, `estimateReference`, `phaseEstimateRows`, Change Orders, RFIs, Blueprint, Project Logs, Payments/logs, Field Logs, Leads, Price Book ownership, Team, Service Calls, Settings, Recovery Center, Phase 4 Save/stale/baseline behavior, `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `attemptProductionMergeAndSync`, or `mergeLocalChangesIntoRemote`.

---

### 2026-07-04 - Phase 6J: Project Estimate Labor/OH Scoped Tombstone Merge

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6J)
**Baseline HEAD:** `6ed58f5` (Phase 6H "Add scoped merge for project materials")
**Files touched:** `src/services/projectScopeMerge.ts`, `src/components/v15r/V15rEstimateTab.tsx`, `src/services/scopeRegistry.ts`, `src/services/embeddingService.ts`, `src/services/patternService.ts`, `src/agents/chrono/jobScheduler.ts`, `src/agents/nexus/nexusContextBuilder.ts`, `src/components/vault/EstimatePanel.tsx`, `src/components/guardian/GuardianOwnerWalkthrough.tsx`, `src/components/v15r/V15rPricingIntelligencePanel.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE - verification pending

Implemented delete-safe, item-level scoped merge for `project.estimate` labor/OH rows only. New Estimate labor rows receive stable internal `laborId` plus `createdAt`/`updatedAt`; new overhead rows receive stable internal `overheadId` plus `createdAt`/`updatedAt`. Legacy row `id` remains preserved for UI/backward compatibility, and old rows receive deterministic fallback identities (`legacy:${projectId}:laborRows:${id}` / `legacy:${projectId}:ohRows:${id}`, with a stable content fingerprint for duplicate legacy ids in the same bucket). Missing timestamps are never defaulted to now during merge; fallback is `updatedAt`, then `createdAt`, then a timestamp parsed from timestamp-ish row ids, then stable epoch.

Changed labor/OH deletes from hard delete to inline tombstones (`deletedAt`, optional `deletedBy`, `updatedAt`). Added pure estimate-row helpers in `projectScopeMerge.ts`: live filtering, tombstone creation, item-level labor/OH merge, and `mergeProjectEstimateRowsIntoRemote`, which patches only `projects[target].laborRows` and `projects[target].ohRows`. Tombstones stay in raw arrays, tombstone wins against equal/older live rows, live can win only if strictly newer than the tombstone, both-live newest `updatedAt` wins, exact live ties prefer remote, and output order is incoming-first plus remote-only append.

`V15rEstimateTab` now renders/calculates labor/OH from live row helpers, targets row edits/deletes by stable identity, creates timestamped rows, and saves labor/OH row changes through fetch-latest -> merge `project.estimate` rows -> `saveBackupWithRemoteBaselineSync(..., { changedKey: 'projects', _scopes: ['project.estimate'] })`. Quick Start and version restore synthesize tombstones for removed live rows and preserve existing tombstones. Labor Calculator rows are timestamped and saved through the same scoped path. Estimate version metadata remains a legacy local snapshot feature; scalar estimate fields are not implemented in the scoped merge.

Updated direct labor estimate readers to exclude tombstones: Estimate tab AI/totals, Embedding seed context, Pattern Service line item learning, CHRONO job duration estimate, NEXUS labor context, Vault estimate-risk context, Guardian owner walkthrough labor line items, and Pricing Intelligence labor totals.

`scopeRegistry.ts` updated only for `project.estimate`: identity `laborId/overheadId`, timestamp `updatedAt`, tombstone `deletedAt`, implemented flags set false for the Phase 6J row subset, and notes explicitly state estimate scalars remain future/unimplemented and `project.materials` remains separate.

Explicitly NOT implemented or changed: project estimate scalars (`contract`, `mileRT`, `miDays`, `laborPhaseColors`, `estimateReference`, `phaseEstimateRows`, `estimateVersions` merge), Materials/MTO ownership, Change Orders, RFIs, Blueprint, Project Logs, Payments/logs, Field Logs, Leads, Price Book ownership, Team, Service Calls, Settings, Recovery Center, Phase 4 Save/stale/baseline behavior, `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `attemptProductionMergeAndSync`, or `mergeLocalChangesIntoRemote`.

No commit, push, deploy, manual Supabase touch, restore script, or manual localStorage write.

---

### 2026-07-05 - Phase 6R-A: Service Logs + Embedded Service Payments Scoped Tombstone Merge

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation (Phase 6R-A)
**Baseline HEAD:** `9d1bc22` (Phase 6Q "Add recently deleted project restore")
**Files touched:** `src/services/serviceScopeMerge.ts` (NEW), `src/components/v15r/V15rFieldLogPanel.tsx`, `src/components/v15r/V15rMoneyPanel.tsx`, `src/services/scopeRegistry.ts`, `src/services/backupDataService.ts`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck + build pass; interactive localhost test BLOCKED (no authenticated Supabase session available in this environment)

Added `serviceScopeMerge.ts`: a service-side, delete-safe, item-level id-merge for the top-level `serviceLogs[]` array, kept entirely separate from `projectScopeMerge.ts`. Exports: `getServiceLogIdentity` (prefer `serviceLogId`, fall back to legacy `id`, then a deterministic customer/account/address/date/type/quoted/collected fingerprint), `ensureServiceLogIdentity` (backfills `serviceLogId`/`id`/`createdAt`/`updatedAt` without overwriting existing values or touching payment fields), `isDeletedOrArchivedServiceLog` (deletedAt OR archivedAt OR archived/isArchived flags OR terminal status deleted/lost/cancelled/rejected/void), `createServiceLogTombstone` (adds `deletedAt`/`deletedBy`/`updatedAt`, preserves collected/payStatus/balanceDue/adjustments[]/statusEvents[] and all fields), `mergeServiceLogsById`, and `mergeServiceLogsIntoRemote(remote, incoming)` which patches ONLY `serviceLogs[]` on a fresh remote clone. Winner logic mirrors the project pattern: both-deleted → newer deletedAt; one-deleted → tombstone wins unless the live side's updatedAt is strictly newer than the tombstone's deletedAt; both-live → newer updatedAt (exact tie prefers remote). The append-only `adjustments[]` (union by id, else fingerprint) and `statusEvents[]` (union by id, else date/status/collected/invoiced fingerprint) ledgers are unioned across BOTH sides on the winning row so payment/collection history is never dropped.

Service payments remain EMBEDDED on the serviceLog row (collected / payStatus / balanceDue / adjustments[] / statusEvents[]) — no separate payment entity, no payment-model rewrite. Because the merge unit is the whole row, protecting the row protects the payment.

`V15rFieldLogPanel` service-log writers converted from broad `saveBackupDataAndSync(backup,'logs')` to a new `saveServiceLogsScoped()` / `persistServiceLogs()` helper that persists locally, fetches latest remote, runs `mergeServiceLogsIntoRemote`, and saves via the existing `saveBackupWithRemoteBaselineSync(..., { source:'service-logs-remote-merge', changedKey:'serviceLogs', _scopes:['service.calls'] })` path (Save/stale/baseline internals untouched; broad-save fallback on no-remote-row / error). Converted writers: `saveSvcEntry` (create/edit), the `editSvcId` branch of the estimate modal (service-log edit), `quickSetSvcPayment`, `addServiceAdjustment`, `archiveSvcEntry`, the `service_log` branch of `restoreArchivedServiceEntry`, and `deleteSvcEntry`. `deleteSvcEntry` NO LONGER hard-filters `serviceLogs[]` — it maps the row to `createServiceLogTombstone(row)`, so a stale second device cannot resurrect the delete and payment history is preserved. All create/edit/payment writers stamp `serviceLogId`/`id`/`createdAt`/`updatedAt` via `ensureServiceLogIdentity`.

Reader fixes: `isActiveServiceCall` (backupDataService) now also returns false when `record.deletedAt` is set (mirrors the Phase 6Q `isActiveProject` guard), so tombstoned service logs are hidden from every active list/KPI centrally. `V15rMoneyPanel` service money totals (svcCollected/svcQuoted/svcOutstanding/svcProfit/totalExposure) and the `recalcWeeklyFromData` weeklyData derivation (svc/pendingInv) now filter `serviceLogs` through `!isDeletedOrArchivedServiceLog(l)` so deleted/archived rows no longer inflate collected/outstanding/exposure. `BackupServiceLog` gained optional `serviceLogId`/`createdAt`/`updatedAt`/`deletedAt`/`deletedBy`/`statusEvents` fields. `scopeRegistry` `service.calls` descriptor updated to document serviceLogs identity/timestamp/tombstone and record that activeServiceCalls/serviceEstimates remain deferred; the existing `serviceLogs` changedKey → `service.calls` mapping was already correct and unchanged.

Explicitly DEFERRED / NOT changed (Phase 6R-B or later): `activeServiceCalls[]` and `serviceEstimates[]` item-level tombstone merge (their hard deletes and the mixed `completeAndLogService` + estimate-form writers stay on the existing broad `persist()` save — `completeAndLogService` only got identity stamping on the row it creates), `multiDayServiceCalls`, Recently Deleted service UI, hard purge, and any service payment-model rewrite. Explicitly NOT touched: `projectScopeMerge.ts`, project logs/payments/lifecycle, `V15rProjectLogsTab`, `V15rProjectsPanel` project code, Change Orders/RFIs/materials/estimate rows/scalars, Blueprint, Leads, Team, Price Book, Settings, Phase 4 Save/stale/baseline behavior, `syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`.

No commit, push, deploy, manual Supabase touch, restore script, or manual localStorage write. NOTE: the editor re-saved `V15rFieldLogPanel.tsx` with uniform CRLF endings, which flipped ~10 previously-LF lines in two untouched JSX blocks to CRLF (benign line-ending-only diff; `core.autocrlf=true` normalizes on commit; `git diff --ignore-all-space` shows only the 9 intended content hunks).

---

### 2026-07-05 - Phase 6R-B: serviceEstimates + activeServiceCalls Lifecycle Scoped Merge

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation (Phase 6R-B)
**Baseline HEAD:** `ebbcb8a` (Phase 6R-A "Add scoped merge for service logs")
**Files touched:** `src/services/serviceScopeMerge.ts`, `src/components/v15r/V15rFieldLogPanel.tsx`, `src/components/v15r/V15rEstimateTab.tsx`, `src/services/scopeRegistry.ts`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck + build pass; interactive localhost test BLOCKED (no authenticated Supabase session in this environment)

Extended `serviceScopeMerge.ts` (beside, not touching, the 6R-A serviceLogs helpers) with a generic lifecycle-merge core shared by both remaining pipeline arrays. New exports: `getServiceEstimateIdentity` / `ensureServiceEstimateIdentity` / `createServiceEstimateTombstone` / `mergeServiceEstimatesById` / `mergeServiceEstimatesIntoRemote`, and the parallel `getActiveServiceCallIdentity` / `ensureActiveServiceCallIdentity` / `createActiveServiceCallTombstone` / `mergeActiveServiceCallsById` / `mergeActiveServiceCallsIntoRemote`. Identity prefers `serviceEstimateId` / `activeServiceCallId`, falls back to legacy `id`, then a deterministic fingerprint (customer/accountId/address/date/quoted/internalCost/status for estimates; +fromEstimateId/serviceStatus for active calls). `createdAt`/`updatedAt` are stamped without overwriting existing values; deletes write `deletedAt`/`deletedBy` tombstones. Merge is delete-safe LWW: both-deleted → newer deletedAt; one-deleted → tombstone wins unless the live side's updatedAt is strictly newer than the tombstone's deletedAt; both-live → newer updatedAt (tie keeps remote). Unlike serviceLogs, these rows have no embedded payment ledgers, so there is no adjustments/statusEvents union. New combined export `mergeServiceCallsScopeIntoRemote(remote, incoming)` merges all three service.calls arrays in ONE remote clone — serviceLogs via the existing 6R-A row merge (tombstone + ledger union intact), estimates and active calls via the new lifecycle merge — leaving logs[]/projects[]/multiDayServiceCalls and everything else untouched.

`scopeRegistry`: `service.calls` descriptor now documents all three arrays with identity/timestamp/tombstone support; added `serviceEstimates → ['service.calls']`, `activeServiceCalls → ['service.calls']`, and `service.calls → ['service.calls']` changedKey mappings (serviceLogs mapping unchanged). No project scope touched.

`V15rFieldLogPanel`: added `saveServiceCallsScoped()` / `persistServiceCalls()` (fetch latest remote → `mergeServiceCallsScopeIntoRemote` → `saveBackupWithRemoteBaselineSync({ changedKey:'service.calls', _scopes:['service.calls'] })`, broad-save fallback). Converted `saveServiceEstimate` (estimate branch — identity stamp, preserve prior on edit), `deleteEstimate` (hard-filter → `createServiceEstimateTombstone`), `archiveEstimate` + `markEstimateLost` (stamp updatedAt on both estimate and cascaded active call), `confirmEstimateToActiveCall` (stamp estimate; create active call with a DISTINCT `activeServiceCallId` + `fromEstimateId`, no more same-id ambiguity), `completeAndLogService` (identity-stamp new serviceLog AND mark estimate completed, route through scoped save — fixes the changedKey 'logs' / silo mismatch that could lose the new log + completion), the active_call/estimate branches of `restoreArchivedServiceEntry`, and `deleteArchivedActiveServiceCall` (hard-filter → active-call tombstone). The serviceLog `editSvcId` branch and all other serviceLog writers still use the 6R-A `persistServiceLogs()` path (unchanged). The archived-review builder now also excludes `deletedAt` rows.

`V15rEstimateTab`: added `saveServiceCallsScopedEst()` / `persistServiceCallsEst()`. Converted `saveEstimate` (identity stamp), `deleteEstimate` (→ estimate tombstone), `moveToActive` (tombstone source estimate + create active call with stable `activeServiceCallId`/`fromEstimateId`, one scoped save), `completeAndLog` (identity-stamp new serviceLog + tombstone source active call, one scoped save — replaces the old broad `saveBackupDataAndSync(backup,'serviceLogs')`), and `deleteActiveCall` (→ active-call tombstone). All now use `persistServiceCallsEst()` instead of broad `nonCriticalWrite`/`saveBackupDataAndSync`. Because EstimateTab renders the raw `backup.serviceEstimates` / `backup.activeServiceCalls` arrays, added `.filter(x => !x?.deletedAt)` to the Open Service Estimates list, the Active Service Calls list + count, and skipped tombstoned rows in the pipelineLost history/risk box, so tombstoned rows disappear exactly as hard-deleted rows used to.

Readers: no MoneyPanel/Home/Dashboard/weeklyData changes — those never referenced these two arrays. FieldLogPanel Open/Active lists already filter through `isActiveServiceCall` (which excludes `deletedAt` since 6R-A), so tombstones are hidden there automatically.

serviceLogs 6R-A merge remains fully intact (untouched helpers + ledger union). multiDayServiceCalls / V15rServiceCallsV2 / serviceCallService.ts DEFERRED. Project scopes, blueprint, and all sync/save/baseline internals (`syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`) untouched. No commit, push, or deploy.

### 2026-07-05 - Phase 6S-A: project.finance Field-LWW Scoped Merge

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation (Phase 6S-A)
**Baseline HEAD:** `958aaeb` (Phase 6R "Add scoped lifecycle merge for service pipeline")
**Files touched:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rProjectsPanel.tsx`, `src/components/v15r/V15rProgressTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck + build pass; interactive localhost test BLOCKED (no authenticated Supabase session in this environment)

- Added `project.finance` scope. Protects the money-critical `projects[].finance` scalar fields from stale broad `projects[]` saves: `manualPaidAdjustment`, `lastCollectedAt`, `billedOverride`, `contractOverride`, `matCostOverride`. `manualPaidAdjustment` feeds `getProjectFinancials` paid → AR/exposure/risk → Dashboard/MoneyPanel/Home/NEXUS.
- Added finance field-LWW merge in `projectScopeMerge.ts`: `FINANCE_SCALAR_FIELDS`, `stampProjectFinanceField(project, field, ts?)`, `mergeProjectFinanceIntoRemote(remote, incoming, projectId)` (single-project, remote-based, faithful to the estimate-scalar pattern), and `mergeAllProjectFinanceIntoRemote(remote, incoming)` (broad-saver, INCOMING-based). Per-field winner = strictly-newer `financeUpdatedAt`; on a timestamp tie (commonly both-missing legacy/imported data) the side that has a value wins, so a remote legacy value is never wiped by a local blank; a value is never deleted with a stale undefined. Only finance + financeUpdatedAt are read/written — logs[], service payments, estimate rows/scalars, and lifecycle are untouched.
- Added `financeUpdatedAt?: Partial<Record<string, string>>` to `BackupProject` (type-only). `getProjectFinancials` and every reader keep reading `finance.manualPaidAdjustment` exactly as before — no financial-calc changes.
- `V15rProjectsPanel.persist()` and `V15rProgressTab.persistProjectChange()` now save locally for instant UI, then fire a finance-preserving remote-baseline merge: fetch latest remote → `mergeAllProjectFinanceIntoRemote(remote, local)` → `saveBackupWithRemoteBaselineSync(merged, baseline, { source:'project-finance-remote-merge', changedKey:'projects', _scopes:['project.finance'] })`, fallback `saveBackupDataAndSync(local, 'projects', { _scopes:['project.finance'] })`. The broad-saver helper is INCOMING-based so all local project edits (status/archive/name/progress/logs) are preserved in full while a stale local finance bucket can never overwrite a newer remote `manualPaidAdjustment`/override.
- `scopeRegistry`: `project.finance` descriptor (field-lww, critical) + `projects` changedKey now includes `project.finance`, plus a `project.finance → ['project.finance']` changedKey entry. No manualPaidAdjustment UI added (none exists; no wiring needed).
- No project logs/payments/lifecycle changes. No service changes. weeklyData / team.members / project.schedule / laborPhaseColors / estimateVersions / agenda / customAlerts DEFERRED. Sync/save/baseline internals (`syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`) untouched. No commit, push, or deploy.

### 2026-07-05 - Phase 6S-B: finance.weeklyData Scoped Merge + Recalc Safety

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation (Phase 6S-B)
**Baseline HEAD:** `3aeebb2` (Phase 6S-A "Add scoped merge for project finance")
**Files touched:** `src/services/weeklyDataScopeMerge.ts` (new), `src/services/scopeRegistry.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rMoneyPanel.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck + build pass; interactive localhost test BLOCKED (no authenticated Supabase session in this environment)

- Added `finance.weeklyData` scope. `weeklyData[]` is a PERSISTED DERIVED financial cache / imported historical weekly-row store that drives MoneyPanel, Cash Flow, Business Overview, and the pulse fallback charts. It is NOT `project.payments` — the source of truth for project payments remains `logs[].collected` (`project.logs`/`project.payments`). `scopeRegistry`: new `finance.weeklyData` descriptor (id-merge by `wk`, critical); the legacy `weeklyData` changedKey mapping was corrected from the misleading `['project.payments']` to `['finance.weeklyData']` (project.payments/logs behavior unchanged).
- Added `src/services/weeklyDataScopeMerge.ts` (new, kept separate from project/service merges). Exports: `getWeeklyDataIdentity` (String(wk) → start → deterministic fingerprint, never random), `normalizeWeeklyRow` (preserves all/unknown fields; coerces manualOverride to boolean; stamps derivedAt+weeklyUpdatedAt on non-manual rows when a timestamp is supplied), `mergeWeeklyRowsByWk`, `mergeWeeklyDataIntoRemote`, `mergeRemoteWeeklyDataIntoOutgoing`.
- **manualOverride-aware merge rules** (`mergeWeeklyRowsByWk`, merge by `wk`, both sides' rows preserved, sorted by wk asc): `manualOverride === true` beats a non-manual derived row for the same wk; two manual rows → newer `weeklyUpdatedAt` wins, tie/missing → remote wins (never overwrite manual data); two derived rows → newer `derivedAt`/`weeklyUpdatedAt` wins, tie/missing → incoming wins (so an explicit recalc save applies). Winner's defined fields overlay the remote row so a remote field is never wiped by an undefined incoming field.
- **BackupWeeklyData type**: added optional `manualOverride?`, `derivedAt?`, `weeklyUpdatedAt?`, plus `serviceExposure?`/`activeExposure?`/`projectedTotalExposure?`/`isProjection?` (used dynamically by CFOT/pulse charts). Type-only; no financial-calc change.
- **Pre-sync preservation hook** (Section D): in `backupDataService.ts` `syncToSupabase`, immediately after `const data = getBackupData(userId)` and BEFORE building the upsert payload, for any save that is NOT a weeklyData save (`isWeeklyDataSyncSource(options.source)` false — checks source substring and resolved `finance.weeklyData` scope), fetch latest remote via existing `fetchLatestRemoteBackup(userId)` and fold newer remote weeklyData into the outgoing blob via `mergeRemoteWeeklyDataIntoOutgoing(outgoing, remote)`. Wrapped in try/catch: on remote-fetch failure it warns and continues with the un-merged blob — never blocks a save, never recurses, only patches weeklyData[]. Freshness guard, verified-Save semantics, and every other sync/save/baseline internal are untouched.
- **MoneyPanel `recalcWeeklyFromData`** converted to a `finance.weeklyData` scoped save (async): derived rows stamped `derivedAt`/`weeklyUpdatedAt`; manualOverride rows preserved verbatim BUT their stored proj/svc now fold into the running accum so later derived weeks stay cumulative-correct (fixes the old `continue`-broke-accumulation bug); tombstoned/archived PROJECT logs excluded via `isDeadProjectLog` and service logs via `isDeletedOrArchivedServiceLog`; then fetch latest remote → `mergeWeeklyDataIntoRemote(remote, local)` → `saveBackupWithRemoteBaselineSync(merged, baseline, { source:'finance-weeklyData-remote-merge', changedKey:'weeklyData', _scopes:['finance.weeklyData'] })`; fallback `saveBackupDataAndSync(local, 'weeklyData', { source:'finance.weeklyData', _scopes:['finance.weeklyData'] })`. MoneyPanel UI/table layout unchanged; no manualOverride UI; ytdAccum not migrated to live derivation.
- Dashboard / BusinessOverview / CashFlow reader migration DEFERRED (no reader migration this phase). `project.finance` untouched. Project logs/payments untouched. Service scopes untouched. Nexus weeklyData writer, weeklyData schema split, project.schedule, team.members, estimateVersions merge DEFERRED. Same client-clock/no-GC limitations as the other scopes. No commit, push, or deploy.
- **6S-B hotfix (MoneyPanel reader filter only):** archived + soft-deleted projects were still showing in the Money tab. Added a local `isActiveMoneyProject(project)` helper in `V15rMoneyPanel.tsx` (false for `deletedAt` / `status==='deleted'` / `archived` / `archivedAt` / `status==='archived'`; true otherwise) and filter project inputs at the source: `moneyProjects = projects.filter(isActiveMoneyProject)` now feeds `projectMoney` (→ Business Roll-Up totals, Exposure Framework table, Cash Waterfall bars, activeProjectMoney/openProjectMoney) and `calcPipeline(moneyProjects)`; the `BusinessHealthChart` revenue-breakdown totals filter the same way. Display/calculation-input filter ONLY — no project data changed, no deletion, restore/reactivation and Recently Deleted logic untouched. Deliberately narrower than `isActiveProject` (does NOT hide lost/cancelled) to target exactly the archived/deleted bug. weeklyData 6S-B merge/scope/hook untouched (only the shared MoneyPanel file changed).

### 2026-07-05 - Phase 6S-C: team.members Scoped Merge + Employee Tombstones

**Agent:** Claude Opus 4.8
**Mode:** Scoped implementation (Phase 6S-C)
**Baseline HEAD:** `88f3609` (Phase 6S-B "Add scoped merge for weekly financial data")
**Files touched:** `src/services/teamScopeMerge.ts` (new), `src/services/scopeRegistry.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rTeamPanel.tsx`, `src/components/v15r/V15rFieldLogPanel.tsx`, `src/components/v15r/V15rProjectLogsTab.tsx`, `src/components/v15r/V15rEstimateTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck + build pass; interactive localhost test BLOCKED (no authenticated Supabase session in this environment)

- Added `team.members` scoped merge for the top-level `employees[]` array (previously local-only `saveBackupData`, hard-delete filtered, no updatedAt/deletedAt). Employees affect loaded labor cost, team planning, estimate labor allocations, field/project log dropdowns, and crew/capacity workflows, so a stale broad save must never wipe a newer roster/rates or resurrect a deleted employee.
- Added `src/services/teamScopeMerge.ts` (new, kept separate from project/service/weekly merges). Exports: `getEmployeeIdentity` (id → employeeId → deterministic name/role/rate fingerprint, never random), `ensureEmployeeIdentity(emp, ts?)` (stamps id/createdAt/updatedAt without overwriting existing), `isDeletedEmployee` (deletedAt or status 'deleted'), `isInactiveEmployee` (deleted or status Inactive/Closed, any case), `getLiveEmployees`, `createEmployeeTombstone` (preserves id/name/role/billRate/costRate/hourly_rate/applyMultiplier/employee_type/classification; sets deletedAt/deletedBy/updatedAt/status='Deleted'), `mergeEmployeesById`, `mergeEmployeesIntoRemote`, `mergeRemoteEmployeesIntoOutgoing`.
- **Employee merge behavior** (delete-safe LWW by id): both-deleted → newer deletedAt; one-deleted → tombstone beats an equal-or-older live row (live wins only if strictly newer updatedAt); both-live → newer updatedAt, tie → more complete rate data, still tied → remote. A `coalesceEmployee` step fills blank winner fields from the loser so a remote value (e.g. rates) is never wiped by a local blank; unknown fields preserved.
- **BackupEmployee type**: added optional `createdAt?`/`updatedAt?`/`deletedAt?`/`deletedBy?` (type-only; no model rewrite).
- **Employees pre-sync preservation hook** (Section D): extended the existing 6S-B guard block in `backupDataService.ts` `syncToSupabase` (right after `const data = getBackupData(userId)`, before building the payload) to ALSO fold newer remote `employees[]` into the outgoing blob for any save whose source is NOT an employees/team.members save (`isEmployeesSyncSource` false — checks source substring `employee`/`team.members`/`team-members` and resolved `team.members` scope). One shared `fetchLatestRemoteBackup` now serves BOTH the weeklyData and employees folds. Wrapped in try/catch: on remote-fetch failure it warns and continues un-merged — never blocks a save, never recurses, only patches weeklyData[]/employees[]. Freshness guard, verified-Save semantics, and every other sync/save/baseline internal untouched.
- **V15rTeamPanel CRUD** converted from local-only `saveBackupData` to a remote-baseline scoped save via new `saveEmployeesScoped(incomingBackup)` (optimistic local save → fetch latest remote → `mergeEmployeesIntoRemote(remote, local)` → `saveBackupWithRemoteBaselineSync(merged, baseline, { source:'team-members-remote-merge', changedKey:'employees', _scopes:['team.members'] })`; fallback `saveBackupDataAndSync(local, 'employees', { source:'team.members', _scopes:['team.members'] })`). Converted: `handleAddTeamMember` (ensureEmployeeIdentity stamp), `handleEditSave` (preserve id/createdAt, stamp updatedAt), `toggleMultiplier` (stamp updatedAt), `markComplianceAcknowledged` (stamp updatedAt), and `deleteEmployee` (no hard-filter → `createEmployeeTombstone` mapped in place; blocks owner/me records: isOwner / id 'me'/'owner'/'owner-virtual' / name 'Owner / Me'). settings.projectionScenarios/payroll CRUD intentionally NOT converted (still `saveBackupData`).
- **Reader filters**: `getLiveEmployees` now gates active pickers/rosters while the FULL raw array remains for historical resolution. Team panel: `liveEmployees` drives employeeStats/cost projections, the Employee Cards grid, empty-state, Team Cost Summary, Per-Project Labor Flow, and default scenario rosters (`logsWithCost` keeps the full array for name resolution). V15rFieldLogPanel + V15rProjectLogsTab: the new-log Employee `<select>` uses `liveEmployees`, but if the edited row already references a now-deleted employee that id is appended so the row stays editable. V15rEstimateTab: the multi-employee labor picker offers `getLiveEmployees(teamRoster)` plus any already-assigned deleted/inactive employee on that row (via getRowEmployees), and all empId→employee name/cost resolution keeps the full array — no laborRow is dropped or rewritten.
- Historical logs / estimate rows preserve employee references (tombstones keep name+rates; empId never rewritten). Project logs/payments unchanged (team.time stays logs[], protected by project.logs). project.finance unchanged. finance.weeklyData unchanged. Service scopes unchanged. Sync/save/baseline internals unchanged except the narrow employees preservation fold added to the existing guard. team.roles/team.assignments merge, restore-deleted-employee UI, and a Supabase employees table migration remain DEFERRED. Same client-clock/no-GC limitations as the other scopes. No commit, push, or deploy.
- **6S-C hotfix (TeamPanel Org Pyramid reader only):** the Interactive Org Pyramid still rendered tombstoned employees ("Test — W-2 — Deleted") because its non-owner grid mapped the full `employees` array. Switched both the grid's presence check and `.map` from `employees.filter(e => !e.isOwner)` to `liveEmployees.filter(e => !e.isOwner)` (V15rTeamPanel.tsx, ~line 1742) so deleted/inactive employees drop out of the pyramid too. Owner is rendered separately at the top (unchanged, still visible). No employee data deleted; tombstone/merge/sync logic, employee cards/list, and Field Log / Project Logs / Estimate dropdowns all untouched.
- **Blueprint AI hotfix (last-open document + page restore):** Blueprint AI stopped reopening the last document/page (jumped to page 1). Root cause: the restore relied on a fragile rAF→`externalPage`→`numPages`-re-fire race in `BlueprintAI.tsx`, while the viewer's `loadPdf` hard-reset `setCurrentPage(1)`; the viewer's load-time `onPageChange(1)` clobbered `currentViewerPage` (and localStorage) before the restore could re-assert. Fix (viewer + view only): added an `initialPage?: number` prop to `OperationsBlueprintPdfViewer` (synced to `initialPageRef`) and `loadPdf` now applies that page clamped to `[1, numPages]` instead of 1. `BlueprintAI.tsx` derives `viewerInitialPage` from the saved per-document page (`loadBlueprintPage(selectedId)`, key `poweron.blueprint.page.<id>`) captured on each `selectedId` change — immune to the load-time `onPageChange(1)` — and passes it as `initialPage`; the brittle mount-jump rAF and `openLibraryItem` rAF were removed. Active-document id persistence (`poweron.blueprint.activeId`) is unchanged. Per-document keys retained; page clamped on restore; no cloud/save-spam added (localStorage only, existing debounce untouched); annotation/save/sheet-jump (`externalPage`/`viewerJumpPage`) behavior unchanged. No 6S-C team/service/home/merge files touched.
- **6S-C hotfix (Home "Service Jobs Requiring Attention" reader only):** a deleted service call ("test customer") still appeared on Home because `serviceJobsNeedingAttention` mapped the raw `serviceLogs` array. Imported the existing `isDeletedOrArchivedServiceLog` from `serviceScopeMerge.ts` (import-only) and added `visibleServiceLogs = serviceLogs.filter(l => !isDeletedOrArchivedServiceLog(l))` (V15rHome.tsx, ~line 508) as the source for the attention list. Deleted/tombstoned/archived service logs now hide from Home's attention section (and Mark Collected only sees live rows, since the button only renders on visible attention entries); rows stay in backup for sync/tombstone safety. No service data deleted; service merge/tombstone logic, Field Log behavior, service payment behavior, and the Team 6S-C work all untouched.

### 2026-07-05 - Phase 6S-D1: project.timeline Scoped Merge (phase_timeline + deposit fields)

**Agent:** Claude Sonnet
**Mode:** Scoped implementation (Phase 6S-D1)
**Baseline HEAD:** `6edb89f` (Phase 6S "Add scoped team merge and UI filters")
**Files touched:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rPhaseTimelineTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE — typecheck + build pass; interactive localhost test BLOCKED (no authenticated Supabase session in this environment)

- Added `project.timeline` scope (`ScopeMergeStrategy` gained a new `'mixed'` member for it: item-level row merge + field-LWW in one scope). Protects `projects[].phase_timeline` (feeds projected cash flow / payment schedule via `revenueTimelineService`/`revenueTimelineQueries`) and the `deposit_pct` / `phase_deposit_pct` scalar fields from a stale broad `projects[]` save clobbering newer timeline/deposit data from another device. This is SEPARATE from `project.schedule` (phases/plannedStart/plannedEnd/tasks) and `project.progress`/`project.coordination`, all of which remain unimplemented/deferred.
- Added timeline helpers in `projectScopeMerge.ts`: `PROJECT_TIMELINE_FIELD_KEYS` (`deposit_pct`, `phase_deposit_pct`), `getPhaseTimelineIdentity` (normalized `phase_name` → legacy `id` → deterministic fingerprint, never random), `ensurePhaseTimelineEntryIdentity` (stamps `updatedAt` when a timestamp is supplied, preserves all fields, never invents `phase_name`), `stampProjectTimelineField` (writes only `project.timelineUpdatedAt[field]`), `mergePhaseTimelineRowsByPhase` (merges by `phase_name`; newer `updatedAt` wins; tie/missing prefers incoming; a winner never wipes a loser's defined field with an undefined/blank one; incoming-first + remote-only append), `mergeProjectTimelineIntoRemote` (single-project, remote-based — patches only the target project's `phase_timeline`/deposit fields onto a remote clone), `mergeAllProjectTimelineIntoRemote` (broad-saver, INCOMING-based, mirrors `mergeAllProjectFinanceIntoRemote`, provided for a future broad project saver), and `mergeRemoteProjectTimelineIntoOutgoing` (narrow pre-sync fold; remote passed as the "incoming" side so it wins ties/missing timestamps).
- **Deposit field-LWW**: `deposit_pct`/`phase_deposit_pct` resolve per-field by strictly-newer `projects[].timelineUpdatedAt[field]`; on a timestamp tie the side that actually has a value wins (a remote legacy value is never wiped by a local blank); a value is never deleted by an undefined winner. Mirrors the `project.finance`/`project.estimate` scalar pattern exactly.
- **Type changes** (`backupDataService.ts`, type-only): added `timelineUpdatedAt?: Partial<Record<string, string>>`, `phase_timeline?: any[]`, `deposit_pct?: number`, `phase_deposit_pct?: number` to `BackupProject`. The `PhaseTimelineEntry` interface itself lives in `revenueTimelineService.ts` (out of scope for this phase — not edited); `phase_timeline` rows are still handled as loosely-typed objects in the merge helpers, same convention as the existing `@ts-nocheck` UI files that read/write them.
- **Pre-sync preservation hook**: extended the existing 6S-B/6S-C guard block in `backupDataService.ts` `syncToSupabase` (same `const data = getBackupData(userId)` block, same shared `fetchLatestRemoteBackup` call) to ALSO fold newer remote `phase_timeline`/deposit data into the outgoing blob for any save whose source/scope is NOT project.timeline. Added `isProjectTimelineSyncSource(options)` (checks `options.source` substring `project.timeline`, `options._scopes` array membership, and the legacy changedKey→scope resolution of `source`). Wrapped in the same try/catch as the weeklyData/employees folds: on remote-fetch failure it warns and continues un-merged — never blocks a save, never recurses, only patches `phase_timeline`/`deposit_pct`/`phase_deposit_pct`/`timelineUpdatedAt`. Freshness guard, verified-Save semantics, and every other sync/save/baseline internal untouched.
- **V15rPhaseTimelineTab** converted from local-only broad `saveBackupDataAndSync(backup,'projects')` to a remote-baseline scoped save via new `saveProjectTimelineScoped(incomingBackup, projectId)` (optimistic local save → fetch latest remote → `mergeProjectTimelineIntoRemote(remote, incoming, projectId)` → `saveBackupWithRemoteBaselineSync(merged, baseline, { source:'project-timeline-remote-merge', changedKey:'projects', _scopes:['project.timeline'] })`; fallback `saveBackupDataAndSync(incoming, 'projects', { source:'project.timeline', _scopes:['project.timeline'] })` on no-remote-row or error). Converted: `handlePhaseEntryUpdate` (stamps the updated/created `phase_timeline` entry's `updatedAt` via `ensurePhaseTimelineEntryIdentity`, merges by `phase_name`, routes through the scoped save) and `handleDepositSave` (stamps `project.timelineUpdatedAt.deposit_pct` via `stampProjectTimelineField`, routes through the scoped save). Timeline UI, `revenueTimelineService`, and projected cash flow calculations unchanged; logs/payments untouched.
- **Deferred (explicitly NOT implemented this phase):** `project.progress`, `project.schedule` date merge, `project.coordination`, task tombstones, custom phase tombstones, `progressPhaseColors` merge, `V15rProgressTab` conversion, `V15rCoordinationTab` conversion, `V15rProjectsPanel` planned-date conversion, `revenueTimelineService` rewrite, dashboard reader migration, project logs/payments changes, `project.finance` changes, `finance.weeklyData` changes, `team.members` changes, service changes, blueprint changes. Sync/save/baseline internals (`syncToSupabase` freshness guard, verified Save, `setKnownRemoteBaseline`, `saveBackupWithRemoteBaselineSync` internals, `attemptProductionMergeAndSync`, `mergeLocalChangesIntoRemote`) unchanged except the narrow project.timeline preservation fold added to the existing guard block. Same client-clock/no-GC limitations as the other project scopes.

No commit, push, deploy, manual Supabase touch, restore script, or manual localStorage write.

### 2026-07-05 - Phase 6S-D2: project.progress Scoped Merge

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6S-D2)
**Baseline HEAD:** `9481cb4` (Phase 6S-D1 "Add scoped merge for project timeline")
**Files touched:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rProgressTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE locally - typecheck PASS, build PASS, diff-check PASS; localhost manual test BLOCKED because the dev server could not start under sandbox access rules and escalated dev-server approval was denied. No commit, push, or deploy

- Added `project.progress` scope, separate from `project.timeline` and deferred `project.schedule` planned-date work. It covers `projects[].phases`, `projects[].tasks`, `projects[].customPhases`, `projects[].progressPhaseColors`, and `projects[].progressPhaseOverrideEnabled`.
- Added progress merge helpers in `projectScopeMerge.ts`: task identity/tombstone helpers, live task filtering, task bucket merge by stable task `id`, phase-key normalization, progress map stamping/deletion metadata, single-project progress merge, all-project progress merge, and non-progress outgoing preservation fold.
- Task deletes are now tombstones (`deletedAt`/`deletedBy`/`updatedAt`/`status: "deleted"`) instead of hard filters. Live Progress UI filters tombstoned tasks while raw backup data retains them for merge safety.
- Progress map fields now use `projects[].progressUpdatedAt.<mapName>[phaseKey]`; custom/map deletes use `projects[].progressDeletedAt.<mapName>[phaseKey]` so stale devices cannot resurrect removed custom phase metadata.
- Converted `V15rProgressTab` progress saves from the old broad projects/project.finance remote save to optimistic local save followed by `mergeProjectProgressIntoRemote(...)` and `saveBackupWithRemoteBaselineSync(..., { changedKey: "project.progress", _scopes: ["project.progress"] })`; fallback uses `saveBackupDataAndSync(..., "project.progress", { source: "project.progress", _scopes: ["project.progress"] })`.
- Added the narrow `project.progress` pre-sync preservation fold in `backupDataService.ts` inside the existing weeklyData/employees/project.timeline guard block immediately after `getBackupData(userId)` and before payload construction. It skips true `project.progress` saves and folds newer remote progress fields into unrelated outgoing full-blob saves via `mergeRemoteProjectProgressIntoOutgoing`.
- `project.timeline` unchanged from 6S-D1. `project.schedule` plannedStart/plannedEnd/lastMove remains deferred. `project.coordination` remains deferred. Project logs/payments, project.finance, finance.weeklyData, team.members, service scopes, and blueprint scopes untouched. Sync/save/baseline internals unchanged except the narrow project.progress preservation hook.

### 2026-07-05 - Phase 6S-D3: project.schedule Field-LWW Merge

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6S-D3)
**Baseline HEAD:** `23423c4` (Phase 6S-D2 "Add scoped merge for project progress")
**Files touched:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rProjectsPanel.tsx`, `src/components/v15r/V15rProgressTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE locally - typecheck PASS, build PASS, diff-check PASS; localhost manual test BLOCKED because dev server startup needs sandbox escalation and approval was denied. No commit, push, deploy, pull, rebase, reset, or branch change.

- Added `project.schedule` scope for `projects[].plannedStart`, `projects[].plannedEnd`, and `projects[].lastMove` with per-field LWW metadata at `projects[].scheduleUpdatedAt.<field>`. Scope is separate from `project.timeline` and `project.progress`.
- Added schedule merge helpers in `projectScopeMerge.ts`: `PROJECT_SCHEDULE_FIELD_KEYS`, `isProjectScheduleField`, `stampProjectScheduleField`, `stampProjectScheduleFields`, `mergeProjectScheduleFields`, `mergeProjectScheduleIntoRemote`, `mergeAllProjectScheduleIntoRemote`, and `mergeRemoteProjectScheduleIntoOutgoing`. Only plannedStart/plannedEnd/lastMove/scheduleUpdatedAt are patched; phase_timeline, progress fields, logs, COs, RFIs, materials, estimate rows, lifecycle, finance, weeklyData, employees, and service data are untouched.
- Added `BackupProject.scheduleUpdatedAt?: Partial<Record<'plannedStart' | 'plannedEnd' | 'lastMove', string>>` as a type-only metadata field.
- Added the narrow `project.schedule` pre-sync preservation fold in `backupDataService.ts` inside the existing weeklyData/employees/project.timeline/project.progress guard block immediately after `getBackupData(userId)` and before payload construction. It skips true `project.schedule` saves and folds newer remote plannedStart/plannedEnd/lastMove into unrelated outgoing full-blob saves via `mergeRemoteProjectScheduleIntoOutgoing`; it reuses the existing single remote fetch and does not block saves if the fetch fails.
- `V15rProjectsPanel` now stamps schedule metadata when creating a project and when Edit Project changes plannedStart/plannedEnd/lastMove. Mixed project edits keep the existing broad project behavior but use a combined project.finance + project.schedule remote-baseline merge when schedule fields changed.
- `V15rProgressTab` had a `lastMove` writer in `overridePhase`; it now stamps `scheduleUpdatedAt.lastMove` and routes that save through a combined project.progress + project.schedule remote-baseline merge. Other progress behavior is unchanged.
- `project.timeline` unchanged from 6S-D1. `project.progress` unchanged except minimal lastMove/schedule coordination. `project.coordination`, project status/lifecycle scope work, project logs/payments, project.finance, finance.weeklyData, team.members, service scopes, and blueprint scopes are untouched. Sync/save/baseline internals unchanged except the narrow project.schedule preservation hook.

### 2026-07-05 - Phase 6S-D3 Hotfix: Progress Override Slider Reset

**Agent:** Codex
**Mode:** Hotfix only
**Files touched:** `src/components/v15r/V15rProgressTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE locally - typecheck PASS, build PASS, diff-check PASS; localhost manual test BLOCKED because Vite dev-server startup needs sandbox escalation and approval was denied. No commit, push, deploy, pull, rebase, reset, or branch change.

- Fixed Progress tab manual phase override regression where slider/number changes could save the percent but leave `progressPhaseOverrideEnabled[phase]` false, causing the displayed value to recompute from tasks and appear to jump/reset to 0%.
- `overridePhase` now clamps percent with explicit finite-number handling so 0 and 100 are valid, writes `projects[].phases[phase]`, forces `projects[].progressPhaseOverrideEnabled[phase] = true`, stamps both `progressUpdatedAt.phases[phase]` and `progressUpdatedAt.progressPhaseOverrideEnabled[phase]`, and keeps the Phase 6S-D3 `scheduleUpdatedAt.lastMove` stamp.
- The override slider/number input now uses an in-memory draft for smooth drag/edit feedback and persists on drag end / blur / Enter instead of remote-saving on every tiny `onChange`. Duplicate release events are de-duped briefly.
- Project progress scoped save and combined project.progress + project.schedule save path remain intact. project.timeline and other protected scopes untouched.

### 2026-07-05 - Phase 6S-D3 Hotfix 2: Progress Override Persistence

**Agent:** Codex
**Mode:** Repair only
**Files touched:** `src/components/v15r/V15rProgressTab.tsx`, `src/services/projectScopeMerge.ts`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE locally - typecheck PASS, build PASS, diff-check PASS; localhost manual test BLOCKED because Vite dev-server startup needs sandbox escalation and approval was denied. No commit, push, deploy, pull, rebase, reset, or branch change.

- Root cause: `mergeProgressMapObject` used the progress value as the output label for non-custom progress maps. A manual override like `phases.Trim = 50` could merge into `phases["50"] = 50`, and `progressPhaseOverrideEnabled.Trim = true` into `progressPhaseOverrideEnabled["true"] = true`, so the UI later read `phases[phase]` as missing and returned to 0%.
- Fixed the project.progress merge so non-custom maps keep the phase key as the output key; 0 and 100 remain valid values because merge blank checks only treat `undefined`/`null`/empty string as blank.
- Added a local `getProgressPhaseStorageKey` helper in `V15rProgressTab` so display reads, `phases` writes, `progressPhaseOverrideEnabled` writes, and both progressUpdatedAt stamps use the same canonical phase key. The persisted project override map is now authoritative over stale local view prefs when it has an explicit value.
- Existing project.progress scoped save remains optimistic local first, then remote-baseline merge. Combined project.progress + project.schedule save order remains progress merge first, schedule merge second. project.timeline and other protected scopes untouched.

### 2026-07-05 - Phase 6S-D4: project.coordination Scoped Merge

**Agent:** Codex
**Mode:** Scoped implementation (Phase 6S-D4)
**Baseline HEAD:** `17914f1` (Phase 6S-D3 "Add scoped merge for project schedule")
**Files touched:** `src/services/scopeRegistry.ts`, `src/services/projectScopeMerge.ts`, `src/services/backupDataService.ts`, `src/components/v15r/V15rCoordinationTab.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE locally - typecheck PASS, build PASS, diff-check PASS; localhost manual test BLOCKED because Vite dev-server startup needs sandbox escalation and approval was denied. No commit, push, deploy, pull, rebase, reset, or branch change.

- Added `project.coordination` scope for `projects[].coord[section][]`, separate from `project.timeline`, `project.progress`, and `project.schedule`. Coordination is workflow/planning data; project payments/logs source remains `logs[]`.
- Added coordination merge helpers in `projectScopeMerge.ts`: section-key normalization, stable item identity, createdAt/updatedAt stamping, delete detection, tombstone creation, live-item filtering, item-array id merge, section-map merge, single-project remote-baseline merge, all-project merge, and non-coordination outgoing preservation fold.
- Coordination deletes are tombstones (`deletedAt`/`deletedBy`/`updatedAt`/`status: "deleted"`) instead of hard filters. Text/status/response/solvedBy/section and unknown fields are preserved for history/debug; active Coordination UI filters tombstoned rows from section displays and counts.
- `V15rCoordinationTab` coordination writes now save locally first, then fetch latest remote, run `mergeProjectCoordinationIntoRemote(remote, incoming, projectId)`, and save through `saveBackupWithRemoteBaselineSync(..., { source: "project-coordination-remote-merge", changedKey: "project.coordination", _scopes: ["project.coordination"] })`; fallback uses `saveBackupDataAndSync(..., "project.coordination", { source: "project.coordination", _scopes: ["project.coordination"] })`.
- Converted `confirmAdd`, inline `editItem` text/status changes, `saveEditCoordModal` text/status/response/solvedBy changes, and `delItem`. Creates use the existing `ci${Date.now()}` pattern plus createdAt/updatedAt stamping; edits stamp updatedAt; deletes map the row to a tombstone.
- Added the narrow `project.coordination` pre-sync preservation fold in `backupDataService.ts` inside the existing weeklyData/employees/project.timeline/project.progress/project.schedule guard block immediately after `getBackupData(userId)` and before payload construction. It skips true `project.coordination` saves and folds newer remote `coord` data into unrelated outgoing full-blob saves via `mergeRemoteProjectCoordinationIntoOutgoing`; it reuses the existing single remote fetch and does not block saves if the fetch fails.
- Type-only project metadata added: optional `coordUpdatedAt` and `coordDeletedAt`; coord rows carry optional createdAt/updatedAt/deletedAt/deletedBy/status dynamically.
- `project.timeline` unchanged from 6S-D1. `project.progress` unchanged from 6S-D2. `project.schedule` unchanged from 6S-D3. Project status/lifecycle remains deferred. Project logs/payments, project.finance, finance.weeklyData, team.members, service scopes, and blueprint scopes untouched. Sync/save/baseline internals unchanged except the narrow project.coordination preservation hook.

### 2026-07-06 - Phase 6T: Live Remote Refresh / Cross-Device UI Updates

**Agent:** Cursor Composer 2.5 Fast
**Mode:** IMPLEMENT ONLY (minimum safe version)
**Baseline HEAD:** `c466a43` (Phase 6S-H "Add scoped merge for multi-day service calls")
**Files touched:** `src/services/liveCloudRefreshService.ts` (new), `src/hooks/useRemoteDataRefresh.ts` (new), `src/services/backupDataService.ts`, `src/services/realtimeSyncService.ts`, `src/components/v15r/V15rLayout.tsx`, `src/components/v15r/V15rEstimateTab.tsx`, `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`, `src/components/v15r/V15rHome.tsx`, `src/components/v15r/V15rServiceCallsV2.tsx`, `src/components/v15r/V15rDashboard.tsx`, `src/components/v15r/V15rMoneyPanel.tsx`, `AGENT_SHARED_CONTEXT.md`
**Status:** DONE locally — static verify pending; user manually tests localhost. No commit, push, deploy, pull, rebase, reset, or branch change.

- Added live remote refresh service (`liveCloudRefreshService.ts`). Detects newer remote `app_state` on window focus, `visibilitychange` to visible, `online`, and a 60s interval while visible/online.
- Applies remote data silently via `applyRemoteBackupDataSilent` only when no dirty scopes are registered; never sets `_dataChanged`, never calls `syncToSupabase` / `saveBackupDataAndSync`.
- Dispatches `poweron-remote-data-refreshed` when applied; `poweron-remote-data-available` when newer remote exists but dirty scopes block auto-apply. Also dispatches `poweron-data-saved` with `{ source: 'remote-refresh' }` to wake existing same-tab listeners.
- Added dirty registry (`registerDirtyScope`, `setDirtyScope`, `hasDirtyScopes`, etc.) and `useRemoteDataRefresh` hook for tab-level dirty registration + refresh callbacks.
- `V15rLayout` mounts live refresh service and shows banner: "Cloud changes loaded." (auto-dismiss) or "New cloud changes are available…" with Refresh now / Dismiss.
- Wired Estimate, Blueprint viewer, Home, ServiceCallsV2. Dashboard and MoneyPanel listen as safe readers (re-render from localStorage).
- Realtime subscribe handler delegates to `requestRemoteRefresh({ source: 'realtime' })` instead of direct `loadFromSupabase` pull; stale-check on load unchanged.
- No scoped merge logic changed. No stale-overwrite guard changes. No verified Save changes.

---

### 2026-07-06 — Phase 6U: Estimate + Material Takeoff Typing Reliability (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** IMPLEMENT ONLY — component-level input reliability fix
**Branch:** main @ `5db1463` | NOT committed | NOT pushed | user manually tests localhost

**Estimate (`V15rEstimateTab.tsx`):**
- Row saves now read from `latestEstimateRowsRef` / save queue snapshot, not stale `p.laborRows`/`p.ohRows` closures.
- Blur keeps `estimateEditingRef` true until row flush completes; reconciliation blocked while debounce/in-flight/pending flush.
- `saveEstimateRowsSnapshotRemote` checks seq before local persist; older async saves cannot write stale localStorage.
- Unmount/tab-switch clears debounce timers and flushes latest row + scalar drafts via ref-stored flush callbacks.
- Expanded Phase 6T dirty detection: focused input, editing ref, row/scalar debounce timer, in-flight, needsFlush, phase color timers.
- Added local scalar draft ref for contract/mileRT/miDays with blur-immediate flush.

**MTO (`V15rMTOTab.tsx`):**
- name/qty/note now draft-first with `latestMtoDraftRef` + 300ms debounced scoped save (seq guard).
- Removed per-keystroke `persistMaterialChange` + `forceUpdate` for name/qty/note.
- Blur/unmount flush latest draft immediately.
- Registered `useRemoteDataRefresh` scopeId `mto`; remote apply refreshes when not dirty.
- Preserved localPlacements/localUnitCosts/localSupplierNotes commit-on-blur pattern.

**Untouched:** `projectScopeMerge.ts`, `scopeRegistry.ts`, `backupDataService` save/stale/baseline/verified-save core, `liveCloudRefreshService` core, calculations, scoped merge paths.

**Lock released.**

---

### 2026-07-06 — Phase 6U Hotfix: MTO Typing Matches Estimate Draft Pattern (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** Hotfix on uncommitted 6U — MTO typing reliability only

**Root cause:** MTO drafts lived in ref-only storage with tick-bump re-renders; debounced save deleted drafts while still focused and called `forceUpdate`/`onUpdate` on every keystroke cycle via `persistMaterialChange`.

**Fix (`V15rMTOTab.tsx`):**
- `mtoRowDrafts` React state + `latestMtoDraftRef` mirror (Estimate-style).
- Keypress updates state/ref only; no `forceUpdate`, no direct `persistMaterialChange`.
- Debounced draft saves use `skipUiRefresh: true`; drafts not cleared until blur flush completes.
- Blur uses rAF + `[data-mto-draft-input]` guard; keeps `mtoEditingRef` until flush done; tab name→qty safe.
- Expanded dirty/reconcile guards include `mtoEditingRef`, modals, pending queue.

**Untouched:** Estimate tab, scoped merge, backupDataService, liveCloudRefreshService, calculations.

**Lock released.**

---

### 2026-07-06 — Phase HUNTER-1: Gated Source Safety + Partial Results UX (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** IMPLEMENT ONLY — Hunter scan safety when publiclookup.rivco.org blocks automated access
**Branch:** main @ `048be15` | NOT committed | NOT pushed | user manually tests

**Edge function (`supabase/functions/tlma-scraper/index.ts`, `types.ts`):**
- Added `stripHtmlForHint`, `isCloudflareOrWafChallenge`, and `classifyHttpFailure` helpers to detect Cloudflare/WAF/browser-challenge responses (HTTP 403/503 with "Just a moment", etc.).
- Added circuit breaker: after 3 consecutive blocked responses, aborts remaining search matrix for the run with clear error message. No anti-bot bypass attempted.
- Optional backoff delay (800ms) after a blocked response below threshold.
- Extended `LiveRunReport` with `blocked_count`, `http_error_count`, `blocked`, `aborted_for_blocked_source`, `blocked_reason`, `manual_review_required`, `source_host`, `source_status`, `completed_matrix_count`, and backward-compatible `new_leads`/`updated_leads` aliases.
- Fixed `cron_run_log` error counting: HTTP non-OK and blocked responses now increment `errorCount`; status uses success/partial/failed with human-readable `error_message` for blocked cases. No DB migration — counts in report + error_message.

**HunterPanel (`src/components/hunter/HunterPanel.tsx`):**
- Replaced scary generic "Scan FAILED" alert with inline scan result panel showing partial/blocked/complete status.
- Shows blocked count, manual review note, first error/reason, source status, and "Open public source" link for manual review.
- Clarifies existing leads were not deleted on blocked scans.

**Deferred to HUNTER-2:** Official Riverside County open-data/API replacement, CSV/PDF import, persistent source-health DB columns.

**No live scans run during implementation. No deploy.**

**Lock released.**

---

### 2026-07-06 — Phase HUNTER-TLMA-PROBE: Netlify TLMA Reachability Probe (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** IMPLEMENT ONLY — small Netlify probe for TLMA public lookup
**Branch:** main @ `048be15` | commit/push after verify

**Added TLMA Netlify probe action to `netlify/functions/city-scraper.ts`:**
- `?action=tlma-probe` performs one safe GET to `publiclookup.rivco.org` with the captured public lookup query shape.
- No Supabase writes, no lead import, no bypass/evasion (no cookies, proxies, CAPTCHA solving, or session tokens).
- Returns JSON with `blocked`, `table_detected`, `rough_row_count`, and optional `sample_permits` to decide whether TLMA can move from Supabase to Netlify or needs browser-assisted import.

**Untouched:** Indio scanner, Palm Springs scanner, Palm Desert Aura paths, Supabase `tlma-scraper`, Hunter UI, lead scoring, Supabase write/upsert logic.

**No live TLMA probe run during implementation. No deploy during implementation.**

**Lock released.**

---

### 2026-07-06 — Phase HUNTER-2: TLMA Browser-Assisted Table Import (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** IMPLEMENT ONLY — browser-assisted TLMA import when server auto-fetch is blocked
**Branch:** main @ `f794598` | NOT committed | NOT pushed | NOT deployed

**HunterPanel (`src/components/hunter/HunterPanel.tsx`):**
- Added compact TLMA import controls near Scan Now: Open TLMA Search, Paste TLMA Table, and helper note.
- Paste modal parses pasted `#resultsScroll` / `results-table` HTML, previews rows, and imports via Netlify.
- Simplified blocked auto-scan UX: plain message + browser import actions; raw diagnostics hidden under details.

**Parser/mapper (`src/services/hunter/tlmaTableParser.ts`, `tlmaLeadMapper.ts`):**
- Browser `DOMParser` extracts permit rows by header text with column-order fallback.
- Maps TLMA fields (permit number, status, dates, contact, sqft, print URL, etc.) and applies TLMA scoring before import.

**Netlify (`netlify/functions/city-scraper.ts`):**
- Added isolated `?action=tlma-import` POST handler (auth required, service-role upsert only).
- Accepts parsed rows JSON from authenticated app; no outbound TLMA fetch.

**No Cloudflare bypass, cookies, tokens, or server TLMA auto-scan added. Supabase/Netlify TLMA auto-fetch remains blocked by design.**

**Untouched:** Indio scanner, Palm Springs scanner, Palm Desert Aura paths, Supabase `tlma-scraper` Edge Function.

**Lock released.**

---

### 2026-07-06 — Phase HUNTER-2B: TLMA Search Builder Expansion (NOT COMMITTED)

**Agent:** Cursor Composer 2.5 Fast
**Mode:** IMPLEMENT ONLY — broaden TLMA browser import search scope
**Branch:** main @ `f794598` | NOT committed | NOT pushed | NOT deployed

**HunterPanel + parser/mapper:**
- Replaced narrow Coachella-only default with TLMA Search Builder controls (city, permit type, page size, page, optional applied/issued date ranges).
- Default lead-hunting search: Any City + Commercial Buildings (BNR) + PageSize 100 + IssuedDate desc.
- Preview now shows city, permit type, status, address, description, and score.
- Added page workflow note: import only copies the current TLMA page; page 2+ requires another paste/import.

**Scoring:** Expanded high-opportunity keyword list (electric, panel, meter, lighting, tenant improvement, commercial, EV, solar, generator, switchgear, Title 24, low voltage, sign, kitchen, restaurant, retail, shell, buildout).

**Still browser-assisted only:** no Cloudflare bypass, no server TLMA fetch. City scanners untouched.

**Lock released.**
