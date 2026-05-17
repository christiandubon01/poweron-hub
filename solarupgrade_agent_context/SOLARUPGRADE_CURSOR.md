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
