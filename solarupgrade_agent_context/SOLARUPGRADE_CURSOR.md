# SOLARUPGRADE_CURSOR.md

## EVERGREEN CURSOR AGENT FILE

You are Cursor working inside the PowerOn Hub / V15r app.

Branch:
solarupgrade

This file is a permanent operating file for Cursor phases in the Solar Upgrade cascade.

The source of truth is:
`solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`

Before editing code, you must:
1. Confirm the current branch is `solarupgrade`.
2. Confirm working tree is clean unless user says otherwise.
3. Read `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`.
4. Read this file.
5. Execute only the task explicitly given by the user.
6. Keep changes scoped.
7. Run `npm.cmd run typecheck`.
8. Commit only scoped files.
9. Update shared context if the task changes Solar Estimate behavior.
10. Append a completion log to this file.

---

## GLOBAL RULES

Keep work scoped. Avoid broad refactors.

Preserve:
- existing Solar Training subtabs
- existing NEM 3.0 behavior
- Step 1 Address layout/map unless explicitly requested
- saved estimates behavior unless explicitly requested
- summary chart logic unless explicitly requested

Do NOT touch unless explicitly required:
- Supabase
- main app projects
- main app estimates
- NEM formulas
- estimate math
- package dependencies
- unrelated tabs/components
- persistence outside the Solar Estimate tab

Visual style:
- premium PowerOn dark style
- dark navy panels
- cyan/teal/green/gold accents
- soft borders
- restrained glow
- clean spacing
- no bulky typography
- no horizontal overflow

---

## CURSOR RESPONSIBILITIES

Cursor is used for scoped component edits where the user wants targeted implementation help.

Cursor should:
- inspect before editing
- avoid dead JSX
- avoid duplicate render blocks
- make minimal changes
- preserve current working behavior
- run typecheck
- commit scoped files only
- report clearly

---

## REQUIRED END-OF-TASK REPORT

Report:
- branch
- commit hash
- files changed
- what changed
- typecheck result
- risks
- whether ready for screenshot QA

---

## COMPLETION LOGS

Append Cursor task logs below this line.

---

## HOME DETAILS ELECTRICAL CONFIGURATION COMPLETION LOG

AGENT:
Cursor GPT-5.5

COMMIT HASH:
Pending at log-write time; see final Cursor report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/services/solarTraining/SolarEstimateTypes.ts`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`

WHAT CHANGED:
- Added `mainBreakerSize` and `selectedAppliances` to the typed Solar Estimate data model.
- Added Step 2 Home Configuration UI for breaker size and appliance/heavy-load multi-select.
- Added active appliance card states, selected count, and selected summary in Home Details.
- Added breaker size and selected appliances to Step 5 interview inputs.
- Added localStorage restore normalization so older saved estimates and drafts receive safe defaults.

FIELDS ADDED:
- `mainBreakerSize` defaulting to `unknown`
- `selectedAppliances` defaulting to `[]`

APPLIANCES ADDED:
- AC unit
- Microwave
- Hot tub
- EV charger
- Electric stove
- Dryer
- Washer
- Furnace
- Pool equipment
- Extra heavy load appliance

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

RISKS:
- Screenshot QA should verify dropdown layout and saved estimate reopen behavior.
- These fields are captured/reviewed only; no estimate math consumes them.

READY FOR SCREENSHOT QA:
YES

---

## SYSTEM CONFIG SIZING CONTROLS COMPLETION LOG

AGENT:
Codex GPT-5.5

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/services/solarTraining/SolarEstimateTypes.ts`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`

WHAT CHANGED:
- Added Step 4 monthly usage, system size, panel wattage, battery toggle, battery size, and install cost controls.
- Stored system sizing values in typed Solar Estimate data so Summary, drafts, and saved estimates restore the same values.
- Replaced the two-card system mode chooser with a Solar Plus Battery toggle backed by `systemMode`.
- Updated Summary and review rows to reflect the selected system size, battery state/size, panel wattage, monthly usage, and install cost.

FIELDS ADDED:
- `monthlyUsageKwh`
- `systemSizeKw`
- `panelWattage`
- `batterySizeKwh`
- `installCost`

BATTERY TOGGLE:
- OFF stores `systemMode: 'solar_only'`.
- ON stores `systemMode: 'solar_plus_battery'`.
- Battery size only appears and affects Summary when ON.

INSTALL COST:
- Step 4 slider stores `installCost`.
- Summary estimated cost and NEM summary input now use `data.installCost`.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

RISKS:
- Screenshot QA should verify Step 4 slider spacing, toggle behavior, and narrow-width layout.

READY FOR SCREENSHOT QA:
YES

---

## ENERGY-FIRST STEP ORDER COMPLETION LOG

AGENT:
Codex GPT-5.5

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/services/solarTraining/SolarEstimateTypes.ts`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`

WHAT CHANGED:
- Reordered the Solar Estimate step flow to Address, Energy Use, Home Details, System Config, Summary.
- Updated `ESTIMATE_STEPS` and `STEP_META` to keep navigation, progress, and cards aligned.
- Changed Energy Use to display `Step 02` and Home Details to display `Step 03`.

SAVED ESTIMATE COMPATIBILITY:
- Preserved. Saved estimates use semantic step IDs and full interview data, and no data fields were removed or renamed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

RISKS:
- Screenshot QA should verify the new card order and Back/Next flow in-browser.

READY FOR SCREENSHOT QA:
YES

---

## APPLIANCE LOAD SELECTOR COMPLETION LOG

AGENT:
Codex GPT-5.5

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/services/solarTraining/SolarEstimateTypes.ts`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`

WHAT CHANGED:
- Changed `selectedAppliances` from appliance IDs to typed entries that can store per-appliance amperage.
- Kept all ten appliance options available in Step 2 Home Details.
- Reworked the appliance selector into an inline scrollable panel to avoid clipping and overlap.
- Added icons, selected states, and selected-only numeric `Amps` inputs on appliance cards.
- Updated Step 5 interview inputs to display appliance amperage values.
- Normalized saved estimates and active drafts so older ID-only appliance arrays restore safely.

DATA SHAPE:
- `selectedAppliances: { id: SolarEstimateAppliance; amps?: number }[]`

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

RISKS:
- Screenshot QA should verify Step 2 Home Details panel scrolling, mobile wrapping, and saved-estimate reopen behavior.
- Amperage is not used by estimate math yet.

READY FOR SCREENSHOT QA:
YES

---

## COMPACT STEP 5 SUMMARY HEADER SPACING COMPLETION LOG

AGENT:
Cursor GPT-5.5

TASK COMPLETED:
Compact Step 5 Summary header spacing

COMMIT HASH:
Pending at log-write time; see final Cursor report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`

WHAT CHANGED:
- Replaced the Step 5 Summary-only `SectionIntro` plus separate save/status row with one compact header row.
- Aligned `Estimate summary` left and the `Update estimate` / `Save project estimate` button right on desktop.
- Kept the saved-status badge as an inline compact badge next to the save action when present.
- Reduced the header spacing so the metric cards move upward directly under the header.

WHAT WAS LEARNED:
- Removing Summary intro copy left two stacked margin blocks, which created the large empty gap.
- A local Summary header is preferable here because the shared `SectionIntro` still provides good spacing for full intro sections elsewhere.

LEARNED SKILLS / REUSABLE PATTERNS:
- Use a single responsive `flex` header for compact step title plus primary action rows.
- Keep action groups wrapped with `flex-wrap` to prevent horizontal overflow with status badges.

BUGS / RISKS:
- Screenshot QA should verify the saved badge plus button wraps cleanly on small widths.
- No chart logic, estimate math, saved-estimate behavior, or other steps were changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

NEXT RECOMMENDED ACTION:
- Screenshot QA Step 5 Summary after navigating to an existing saved estimate and a new unsaved estimate.

COMPACT HANDOFF FOR NEXT CHAT:
Step 5 Summary header spacing compacted. `Estimate summary` and the save/update button now share one responsive row; metric cards sit closer under the header. Saved badge remains inline when present. Scope was limited to Summary header layout and context logs. Typecheck passed. Commit pending at log-write time.

---

## CONSERVATIVE SUMMARY CHART MODELING COMPLETION LOG

AGENT:
Cursor GPT-5.5

TASK COMPLETED:
Apply conservative NEM modeling to 24H Flow and 25 Yr Savings charts

COMMIT HASH:
Pending at log-write time; see final Cursor report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`

WHAT CHANGED:
- Added reusable conservative NEM constants and helpers for anchor-month solar production, 24-hour flow, and 25-year annual projections.
- Updated Summary > 24H Flow to render solar curve/area, load line, grid import bars, solar export bars, conditional battery discharge bars, 4-9 PM peak shading, TOU import strip, legend, tooltip, and NEM 3.0 callout.
- Updated Summary > 25 Yr Savings to annualize the same conservative monthly model used by Monthly Bill instead of using target-offset-style savings.
- Added Solar Only yellow bars and conditional Solar Plus Battery green bars against grey no-solar spending.

WHAT WAS LEARNED:
- `getSeasonalBillData` already contains the right conservative monthly current / solar-only / battery cost outputs for the 25-year chart.
- A believable 24H view needs normalized hourly shapes so daily totals match the anchor month instead of arbitrary curve height.
- Battery savings should only come from otherwise-exported solar and should be limited by battery size and 4-9 PM import demand.

LEARNED SKILLS / REUSABLE PATTERNS:
- Normalize hourly profile weights to preserve daily kWh totals.
- Use shared monthly NEM outputs as the source for annual projections to keep Summary tabs consistent.
- Keep chart tooltips data-rich while preserving compact SVG dimensions and PowerOn dark styling.

BUGS / RISKS:
- 24H Flow is a representative planning visual, not a detailed interval-data simulation.
- Screenshot QA should check hover tooltips and narrow widths because the 24H legend now has more series.
- Other tabs were intentionally not changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

NEXT RECOMMENDED ACTION:
- Screenshot QA 24H Flow and 25 Yr Savings in Solar Only and Solar Plus Battery states, especially 4-9 PM battery discharge behavior.

COMPACT HANDOFF FOR NEXT CHAT:
24H Flow and 25 Yr Savings now share conservative NEM 3.0 assumptions with Monthly Bill. 24H Flow uses anchor-month usage/production, normalized hourly load/solar, import/export bars, constrained battery discharge, peak shading, TOU strip, tooltip, and callout. 25 Yr Savings uses annualized modeled monthly costs with 3% escalation and shows Solar Only plus conditional Battery. Typecheck passed. Commit pending at log-write time.

---

## 24H FLOW VISUALIZER LAYOUT POLISH COMPLETION LOG

AGENT:
Cursor GPT-5.5

TASK COMPLETED:
Polish 24H Flow chart layout to match NEM 3.0 visualizer organization

COMMIT HASH:
Pending at log-write time; see final Cursor report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`

WHAT CHANGED:
- Reorganized the Summary 24H Flow card to mirror the NEM visualizer: compact header context, main graph, separate legend, separate TOU rate strip, tooltip, and NEM callout.
- Added a right-side compact rate/peak pill in the chart header.
- Moved the TOU strip out of the SVG into its own labeled row with segmented hourly blocks and hour labels.
- Cleaned the graph with more padding, y-axis labels, subtle gridlines, smaller bars, yellow solar line/area, dashed blue load line, and a translucent 4-9 PM peak band.
- Replaced the compact one-line note with a styled `Why NEM 3.0 Changes the Math` callout.

WHAT WAS LEARNED:
- `NEM3Visualizer.tsx` keeps the rate strip and insight box outside the main SVG, which prevents the plotted data from feeling crowded.
- The Summary chart needed organization and scale changes only; the conservative import/export/battery model stayed intact.
- The legend reads better below the plot because it no longer competes with the title row.

LEARNED SKILLS / REUSABLE PATTERNS:
- Use separate rows for legend and rate strips in compact SVG chart cards.
- Keep line series visually distinct with a solid solar curve and dashed load curve.
- Use header pills for rate-plan context instead of plot annotations when space is tight.

BUGS / RISKS:
- Screenshot QA should verify the larger legend still wraps cleanly on small widths.
- Battery OFF should hide battery discharge bars and legend; Battery ON should show both.
- No Monthly Bill, 25 Yr Savings, math helpers, other steps, saved estimates, or packages were changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

NEXT RECOMMENDED ACTION:
- Screenshot QA the 24H Flow tab at desktop and narrow widths with battery off/on.

COMPACT HANDOFF FOR NEXT CHAT:
Summary 24H Flow is now organized like the NEM visualizer: title plus rate/peak pill, clean main graph, separate legend, separate TOU Import Rate by Hour strip, and polished NEM callout. Tooltip data remains unchanged. This was a layout/rendering polish only; conservative 24H math stayed intact. Typecheck passed. Commit pending at log-write time.

---

## Cursor Report — Admin App Brain — Phase 1 admin-only premium tab foundation

- Task completed: Admin App Brain Phase 1 admin-only premium tab foundation.
- Files changed:
  - `src/components/layout/AppShell.tsx`
  - `src/components/v15r/V15rLayout.tsx`
  - `src/components/v15r/V15rAppBrainTab.tsx`
  - `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
  - `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`
- Commit hash: Pending at log-write time; see final Cursor report for the actual commit hash.
- Typecheck result: BLOCKED - attempted `npm.cmd run typecheck`, `cmd /c npm.cmd run typecheck`, and direct `node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json`; the shell harness returned no exit status for each non-git command. Basic `cmd /c echo shell-ok` also returned no exit status, while git commands continued to work.
- What changed:
  - Added an admin-only `App brain` nav item to the existing V15r admin Visualization bucket.
  - Added lazy App Brain route rendering in `AppShell` using the same view-switch pattern as Admin Tools.
  - Added `V15rAppBrainTab`, a Phase 1 premium dark command-center shell with status cards, a 3D neural app map visual placeholder, Brain Inspector placeholder, and roadmap preview.
  - Kept Phase 1 free of customer/project data, mutations, fake live metrics, package changes, and new dependencies.
- What was learned:
  - Existing admin-only nav gating is `isAdmin && !isPreviewMode && b32Role === 'owner'` in `V15rLayout`.
  - Existing Admin Tools rendering is a lazy-loaded `AppShell` view case keyed by `admin-tools`; App Brain follows that route/view pattern.
  - The visual systems are data-heavy and immersive; App Brain should keep its own architecture-brain direction rather than copying their canvases or Three.js implementations.
- Learned skills / reusable patterns:
  - Register admin-only tabs by adding to the existing admin bucket under the owner/email gate.
  - Use a standalone v15r component for admin foundation screens and lazy-load it through `AppShell`.
  - For Phase 1 visual foundations, label planned/live areas clearly so placeholders do not imply live data.
- Bugs / risks:
  - Typecheck could not be completed because non-git shell commands did not return an exit status in this session.
  - Direct navigation to `app-brain` uses the same AppShell view-switch pattern as Admin Tools; visibility is gated through the existing admin nav section.
  - Manual browser QA is still needed on localhost.
- Manual QA performed: Code-path inspection only. Browser QA not performed because the session could not run non-git shell commands reliably.
- Next recommended action: Run `npm.cmd run typecheck` locally, then manually open the app as the admin owner and confirm the App brain tab appears under Visualization, renders the premium shell, and no unrelated tabs changed.
- Compact handoff for next agent/chat: App Brain Phase 1 foundation is added on `main`: admin Visualization nav item, AppShell lazy route, and `V15rAppBrainTab` premium placeholder shell. No package files or dependencies changed. No customer/project data, mutations, or fake live metrics. Typecheck was attempted but blocked by shell exit-status failures for non-git commands; rerun locally before further work.

---

## Cursor Report — Admin App Brain — Phase 2 premium 3D neural render MVP

* Task completed: Admin App Brain Phase 2 premium 3D neural render MVP.
* Files changed:
  * `src/components/v15r/V15rAppBrainTab.tsx`
  * `src/components/v15r/V15rAppBrainScene.tsx`
  * `src/components/v15r/appBrainMap.ts`
  * `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
  * `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`
* Commit hash: Pending at log-write time; see final Cursor report for the actual commit hash.
* Typecheck result: BLOCKED - attempted `npm.cmd run typecheck` and required fallback `cmd /c npm.cmd run typecheck`; both returned no exit status from the shell harness, so success/failure could not be determined.
* What changed:
  * Replaced the Phase 1 SVG placeholder with a real Three.js App Brain scene using the existing `three` dependency.
  * Added typed static App Brain architecture data for nodes, edges, categories, risk levels, related files, and connections.
  * Added glowing 3D node orbs, colored architecture clusters, animated connection pulses, starfield depth, slow rotational/breathing motion, hover previews, and click-to-select inspector behavior.
  * Updated the Brain Inspector to show selected/hovered node label, category, description, related files, connections, and risk level.
  * Added a category legend and explicit static-MVP copy so the UI does not claim live git or generated repo data yet.
* What was learned:
  * Existing Three.js code uses direct `WebGLRenderer` setup, `ResizeObserver`, `requestAnimationFrame`, raycaster event handlers, and explicit renderer/material/geometry cleanup on unmount.
  * The App Brain route/nav foundation from Phase 1 did not need changes; Phase 2 could stay scoped to App Brain components and context files.
  * The repo still had unrelated staged/unstaged Field Log/Codex context changes present, so commit staging must be path-scoped.
* Learned skills / reusable patterns:
  * Keep architecture map data separate from the scene renderer so future generated manifests can replace static arrays without rewriting UI.
  * Use refs for selected/hovered callback state inside long-lived Three.js event handlers to avoid recreating renderers on every interaction.
  * Dispose sprite textures, geometries, materials, resize observers, renderer events, renderer, and animation frames in one unmount cleanup.
* Bugs / risks:
  * Typecheck could not be completed due to the shell harness no-exit-status blocker for non-git commands.
  * Manual browser QA is still needed for animation smoothness, interaction accuracy, resize behavior, and navigating away/back.
  * Static map data is manually curated and not yet generated from the repo.
* Manual QA performed: Code-path and diff inspection only. Browser QA was not performed in this session.
* Next recommended action: Run `npm.cmd run typecheck` locally and manually QA App Brain as the admin owner, including hover/click inspector updates, resize, and navigating away/back to confirm no duplicate canvas/render loop.
* Compact handoff for next agent/chat: App Brain Phase 2 is implemented as a scoped Three.js MVP. `appBrainMap.ts` holds typed static architecture nodes/edges; `V15rAppBrainScene.tsx` owns renderer lifecycle, animated glowing nodes, connection pulses, raycaster hover/click, resize, and cleanup; `V15rAppBrainTab.tsx` owns shell, status cards, legend, inspector, and static-MVP roadmap copy. No packages or unrelated app areas changed. Typecheck was attempted but blocked by shell no-exit-status behavior; rerun locally before the next phase.

---

## Cursor Report — Admin App Brain — Phase 3 intelligence layer, filters, and richer inspector

* Task completed: Admin App Brain Phase 3 intelligence layer, filters, and richer inspector.
* Files changed:
  * `src/components/v15r/V15rAppBrainTab.tsx`
  * `src/components/v15r/V15rAppBrainScene.tsx`
  * `src/components/v15r/appBrainMap.ts`
  * `src/components/v15r/appBrainFilters.ts`
  * `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
  * `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`
* Commit hash: Pending at log-write time; see final Cursor report for the actual commit hash.
* Typecheck result: BLOCKED - attempted `npm.cmd run typecheck` and required fallback `cmd /c npm.cmd run typecheck`; both returned no exit status from the shell harness, so success/failure could not be determined.
* What changed:
  * Expanded App Brain static node metadata with owner area, connected systems, safe edit guidance, overlap warnings, and next-phase notes.
  * Added search, category filter, risk-level filter, and low-risk show/hide controls.
  * Added filtered node counts, System Map Summary, and Agent Safety panels.
  * Improved Brain Inspector with owner area, connected systems, node connections, safe edit notes, overlap warnings, and next useful phase guidance.
  * Updated the Three.js scene to dim filtered-out nodes and remove them from hover/click hit testing while preserving animation.
* What was learned:
  * The Phase 2 scene could support filtering without recreating the renderer by passing visible node IDs through refs and using them during animation and raycaster picking.
  * `appBrainMap.ts` is the right boundary for manual intelligence metadata until generated manifests are explicitly scoped.
  * There were unrelated unstaged changes in `.claude/settings.local.json` and `src/components/blueprint/OperationsBlueprintPdfViewer.tsx`; this phase must remain path-scoped.
* Learned skills / reusable patterns:
  * Keep filter logic in a small helper so scene rendering, summary cards, and inspector behavior derive from one predicate.
  * Preserve selected-node stability by falling back to the first visible node only in the inspector while leaving the user's locked selection intact.
  * Treat App Brain guidance as static advisory copy until live git and agent overlap detection are implemented.
* Bugs / risks:
  * Typecheck could not be completed due to the shell harness no-exit-status blocker for non-git commands.
  * Manual browser QA is still needed for filters, hit testing after filtering, resize, and navigate-away/back cleanup.
  * Static guidance is manually curated and may drift until manifest generation exists.
* Manual QA performed: Code-path and diff inspection only. Browser QA was not performed in this session.
* Next recommended action: Run `npm.cmd run typecheck` locally and manually QA App Brain as admin owner: search, category/risk filters, low-risk toggle, visible-node click behavior, inspector updates, resize, and navigation away/back.
* Compact handoff for next agent/chat: App Brain Phase 3 adds the static intelligence layer. `appBrainMap.ts` now includes richer ownership/safety/overlap metadata, `appBrainFilters.ts` centralizes filter matching, `V15rAppBrainTab.tsx` adds search/filter controls, System Map Summary, Agent Safety, and richer inspector sections, and `V15rAppBrainScene.tsx` dims filtered nodes and excludes hidden nodes from raycaster hits. No packages changed. Typecheck attempted but blocked by no-exit-status shell behavior.

---

## Cursor Report — Admin App Brain — Phase 4 generated architecture manifest MVP

* Task completed: Admin App Brain Phase 4 generated architecture manifest MVP.
* Files changed:
  * `scripts/generate-app-brain-manifest.mjs`
  * `package.json`
  * `src/components/v15r/generatedAppBrainManifest.ts`
  * `src/components/v15r/V15rAppBrainTab.tsx`
  * `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
  * `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`
* Commit hash: Pending at log-write time; see final Cursor report for the actual commit hash.
* Typecheck result: BLOCKED - attempted `npm.cmd run typecheck` and required fallback `cmd /c npm.cmd run typecheck`; both returned no exit status from the shell harness, so success/failure could not be determined.
* Generator result: PASS - `node scripts/generate-app-brain-manifest.mjs` generated `src/components/v15r/generatedAppBrainManifest.ts` with 355 files, 1490 imports, and 598 detected local edges.
* What changed:
  * Added a conservative Node fs/path manifest generator that scans scoped app source folders and skips generated, env, build, git, and dependency folders/files.
  * Added `app-brain:generate` npm script without changing dependencies or package-lock.
  * Generated the first `generatedAppBrainManifest.ts` with area summaries, file records, import counts, local edges, high-touch files, shared-system candidates, admin candidates, and route/view candidates.
  * Added a Generated Manifest panel to App Brain that displays scanner stats, top high-touch files, shared system candidates, admin candidates, and scanned area counts.
  * Kept the generated manifest complementary to the curated static map; curated nodes still drive the 3D scene and inspector.
* What was learned:
  * Regex-based import scanning is enough for a safe MVP but should be treated as approximate until an AST/parser phase is explicitly scoped.
  * The current scoped folders contain 355 scanned source files, with Neural World and V15r as the largest scanned areas.
  * `generatedAt` changes on each generator run and is documented in the generated file header.
* Learned skills / reusable patterns:
  * Keep generated manifest output deterministic through stable path/import/edge sorting.
  * Separate curated architecture intelligence from generated repository scan data so UI can compare both without replacing one with the other.
  * Use a standalone generator script instead of runtime filesystem access in the browser app.
* Bugs / risks:
  * Typecheck could not be completed due to the shell harness no-exit-status blocker for non-git commands.
  * The scanner is regex-based and may miss dynamic or unusual import patterns.
  * `generatedAt` changes every time the generator runs, creating expected manifest churn.
* Manual QA performed: Generator run and code/diff inspection only. Browser QA was not performed in this session.
* Next recommended action: Run `npm.cmd run typecheck` locally, then manually QA App Brain as admin owner and verify the Generated Manifest panel, existing filters, 3D scene, resize, and navigate-away/back behavior.
* Compact handoff for next agent/chat: App Brain Phase 4 adds the first generated manifest pipeline. Run `npm run app-brain:generate` or `node scripts/generate-app-brain-manifest.mjs` to scan scoped source folders and regenerate `generatedAppBrainManifest.ts`. The App Brain UI now shows manifest stats alongside the curated map, but does not replace curated nodes or claim live git updates. Typecheck was attempted but blocked by no-exit-status shell behavior.

---

## Cursor Report — Admin App Brain — Phase 5A manifest refresh workflow and stale-state visibility

* Task completed: Admin App Brain Phase 5A manifest refresh workflow and stale-state visibility.
* Files changed:
  * `scripts/generate-app-brain-manifest.mjs`
  * `src/components/v15r/generatedAppBrainManifest.ts`
  * `src/components/v15r/V15rAppBrainTab.tsx`
  * `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
  * `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`
* Commit hash: Pending at log-write time; see final Cursor report for the actual commit hash.
* Typecheck result: BLOCKED - attempted `npm.cmd run typecheck` and required fallback `cmd /c npm.cmd run typecheck`; both returned no exit status from the shell harness, so success/failure could not be determined.
* Generator result: PASS - `npm run app-brain:generate` regenerated `src/components/v15r/generatedAppBrainManifest.ts` with 355 files, 1490 imports, and 598 detected local edges.
* What changed:
  * Added manifest metadata: `schemaVersion`, `generatedBy`, `refreshCommand`, `scannedRoots`, `skippedPatterns`, and `repoRelative`.
  * Updated generated-file header to say it is generated, should not be hand edited, and should be refreshed with `npm run app-brain:generate`.
  * Reduced generated-file bloat by removing raw per-file import arrays while preserving totals, area summaries, file summary records, local edges, high-touch files, shared-system candidates, admin candidates, and route/view candidates.
  * Added visible refresh workflow UI in the Generated Manifest panel with generatedAt, stale/recent badge, manual refresh command, and the note to run after major file changes or before committing App Brain updates.
* What was learned:
  * The manifest can stay useful without storing every raw import string per file.
  * Browser-side stale visibility only needs `Date.parse(manifest.generatedAt)` and a 24-hour threshold.
  * Manual refresh copy is safer than git hook automation until hook timing and agent overlap behavior are explicitly scoped.
* Learned skills / reusable patterns:
  * Put refresh command and scanner provenance in the generated manifest so UI and docs read from the same source.
  * Keep generated output reviewable by storing compact summaries and deterministic sorted collections.
  * Make stale-state language explicit: recent/stale based on timestamp only, not live git watching.
* Bugs / risks:
  * Typecheck could not be completed due to the shell harness no-exit-status blocker for non-git commands.
  * `generatedAt` remains the expected changing field on each refresh.
  * The stale badge is time-based only and does not know whether source files changed.
* Manual QA performed: Generator run and code/diff inspection only. Browser QA was not performed in this session.
* Next recommended action: Run `npm.cmd run typecheck` locally, then manually QA App Brain as admin owner and verify the Generated Manifest panel shows generatedAt, refresh command, stale/recent badge, and existing scene/filter behavior still works.
* Compact handoff for next agent/chat: App Brain Phase 5A keeps refresh manual. `npm run app-brain:generate` refreshes the compact manifest, which now includes schema/provenance/scanned-root/skipped-pattern metadata. The UI surfaces generatedAt, a 24-hour stale/recent badge, refresh command, and manual-refresh note. No hooks were added, package-lock is untouched, and curated nodes still drive the 3D map.

---

## Cursor Report — App Brain Wave 1 — privacy cleanup and control tower panels

* Task completed: Sequential Wave 1 privacy cleanup and read-only Control Tower panel integration.
* Branch: `main` (no new branch).
* Privacy cleanup: When `activeView === 'app-brain'`, operational finance KPIs (Pipeline, Paid, Exposure, SVC Unbilled, Service Net, Daily Target, revenue target bar) are hidden and replaced with architecture-safe header cards (Architecture Mode, Files Indexed, Imports Tracked, Active Work Panels, Context Registries, Risk Map). Sync/online status and nav preserved.
* Panels added (read-only, static seed): Live Work, Rules, Skills, Directory, Backlog under `src/components/v15r/app-brain/`.
* Files changed:
  * `src/components/v15r/V15rLayout.tsx`
  * `src/components/v15r/V15rAppBrainTab.tsx`
  * `src/components/v15r/app-brain/appBrainSeedData.ts`
  * `src/components/v15r/app-brain/appBrainPanelShared.tsx`
  * `src/components/v15r/app-brain/AppBrainLiveWorkPanel.tsx`
  * `src/components/v15r/app-brain/AppBrainRulesPanel.tsx`
  * `src/components/v15r/app-brain/AppBrainSkillsPanel.tsx`
  * `src/components/v15r/app-brain/AppBrainDirectoryPanel.tsx`
  * `src/components/v15r/app-brain/AppBrainBacklogPanel.tsx`
  * `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
  * `solarupgrade_agent_context/SOLARUPGRADE_CURSOR.md`
* Build result: PASS — `npm run build`.
* Typecheck result: `npm.cmd run typecheck` blocked (no exit status from shell harness); `npx tsc --noEmit -p tsconfig.json` PASS.
* Package files: untouched (`package.json`, `package-lock.json` not modified).
* Next recommended phase: Wave 2 — full directory file tree, live registry ingestion, and optional git/session overlay wiring behind explicit scope.
* Compact handoff: App Brain now hides operational finance KPIs in architecture mode and shows five read-only Control Tower panels from Wave 01 JSON seeds via `appBrainSeedData.ts`. 3D map, filters, inspector, and generated manifest panel preserved. No live tracking claims yet.
