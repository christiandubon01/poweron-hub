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
