# SOLARUPGRADE_SHARED_CONTEXT.md

Branch:
solarupgrade

Master purpose:
This is the source-of-truth cascade file for the Solar Training / Solar Estimate upgrade.

Every Claude Code and Codex session must read this file before editing code. Each phase must update this file with what changed, what was learned, what risks remain, and what the next phase must consider.

The user is acting as the executive builder. The agents should complete only the active phase, update this file, update their own agent file, commit scoped files, and report back. The user will decide whether to continue, pause, or run an in-between polish/stabilization session.

---

# SOLARUPGRADE MASTER CASCADE RULES

Every agent must:

1. Confirm current branch is `solarupgrade`.
2. Read this file before editing code.
3. Read its own agent file before editing code:
   - Claude reads `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`
   - Codex reads `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`
4. Work only on the active phase unless the user explicitly changes scope.
5. Keep changes scoped.
6. Avoid broad refactors.
7. Preserve all existing Solar Training subtabs.
8. Preserve NEM 3.0 formulas and calculations.
9. Preserve Supabase behavior unless explicitly scoped.
10. Preserve existing persistence behavior unless explicitly scoped.
11. Do not touch unrelated app chrome, sidebar, topbar, floating buttons, or unrelated tabs.
12. Run `npm.cmd run typecheck`.
13. Commit only scoped files.
14. Update this file before committing.
15. Update the agent-specific file before committing.
16. Add a completion log after every phase.
17. Update next-phase notes based on what was actually learned in code.
18. Report back with commit hash, changed files, typecheck result, and whether the next phase is ready.

If the next phase becomes unsafe because of code structure, dependency issues, missing API keys, broken typecheck, unclear data flow, overlapping files, or unexpected side effects, the agent must pause and mark:

NEXT PHASE READY: NO
RECOMMENDED PAUSE REASON:
RECOMMENDED POLISH / STABILIZATION SESSION:

Do not proceed into another phase automatically.

---

# REQUIRED END-OF-PHASE FILE UPDATE FORMAT

At the end of every phase, the active agent must append or update a completion section with:

## PHASE X COMPLETION LOG

AGENT:
COMMIT HASH:
FILES CHANGED:
WHAT CHANGED:
WHAT WAS LEARNED:
LEARNED SKILLS / REUSABLE PATTERNS:
BUGS / RISKS:
TYPECHECK RESULT:
SHARED CONTEXT UPDATED:
AGENT FILE UPDATED:
NEXT PHASE ADJUSTMENTS:
NEXT PHASE READY:
COMPACT HANDOFF FOR NEXT CHAT:

The agent must also update the appropriate phase status below.

---

# REQUIRED AGENT REPORT FORMAT TO USER

After committing, the agent must report:

- branch name
- commit hash
- files changed
- active phase completed
- what changed
- what was learned
- learned skills / reusable patterns
- bugs or risks
- typecheck result
- whether this shared file was updated
- whether the agent file was updated
- compact context for next chat
- whether next phase is ready

---

# USER STANDARD PHASE PROMPT TEMPLATE

Every phase prompt inside the agent files must follow this structure:

TASK TITLE:
[Short direct title]

MODEL / TOOL:
Use [Codex GPT-5.5 Medium / Claude Code] for this task.

CONTEXT:
This is the PowerOn Hub / V15r app.
Keep the work scoped and avoid broad refactors.
The visual language should match the existing premium PowerOn design:
- dark navy panels
- subtle teal/cyan/green/yellow solar accents
- soft borders
- restrained glow
- clean spacing
- no aggressive glare
- no bulky typography
- no reload loops

TARGET FILES:
[Exact files or expected files. Inspect first if uncertain.]

REFERENCE FILES / DESIGN REFERENCES:
[Existing files/components/UI references to follow.]

SCOPE:
Only change:
[Very specific thing to change.]

Do NOT touch:
- calculations unless explicitly scoped
- formulas unless explicitly scoped
- Supabase sync unless explicitly scoped
- data model unless explicitly scoped
- handlers unless explicitly required
- unrelated tabs
- unrelated components
- unrelated app chrome
- filters unless explicitly requested
- calendar unless explicitly requested
- service log unless explicitly requested
- Home tab unless explicitly requested
- broad refactors

CURRENT ISSUE:
[Describe what is wrong right now.]

DESIRED RESULT:
[Describe desired visual/functionality result.]

REQUIREMENTS:
1. [Requirement]
2. [Requirement]
3. [Requirement]

VISUAL REQUIREMENTS:
- Keep the premium PowerOn dark style.
- Use subtle gradients only.
- Keep text readable.
- Do not make fonts too fat.
- Preserve existing color meanings.
- Keep spacing clean and symmetrical.
- Avoid oversized cards unless requested.

DATA / LOGIC REQUIREMENTS:
- Keep all existing formulas exactly the same unless the phase explicitly introduces new estimate calculations.
- Keep existing values exactly the same.
- Do not change reducers/scanners/helpers unless required.
- Do not change persistence unless requested.
- Do not change Supabase behavior unless requested.

RESPONSIVE REQUIREMENTS:
- Works on wide desktop.
- No horizontal overflow.
- No overlap with floating buttons.
- Wrap cleanly on smaller widths if needed.

ACCEPTANCE CRITERIA:
- [Specific visual result]
- [Specific behavior result]
- [No unrelated area changed]
- Existing numbers remain accurate.
- Typecheck passes.
- App does not reload endlessly.

QA:
Run:
npm.cmd run typecheck

If PowerShell blocks npm, use:
npm.cmd run typecheck

COMMIT:
After typecheck passes, commit only the scoped files.

Commit message:
[commit message]

END OF PHASE REPORT REQUIRED:
[Use required report format.]

---

# PROJECT GOAL

Upgrade the Solar Training area in phases while keeping the existing subtabs and adding a new `Solar Estimate` subtab after `Retention`.

Existing subtabs to preserve:

1. Certifications
2. Training Modes
3. Scores
4. Rules Library
5. Quick Quiz
6. NEM 3.0
7. Retention

New subtab to add:

8. Solar Estimate

---

# USER REQUIREMENTS

- Keep work scoped.
- Avoid broad refactors.
- Match premium PowerOn dark visual language.
- Preserve existing calculations and behavior unless explicitly scoped.
- Fix Retention crash first.
- Build Solar Estimate in multiple phases.
- Keep existing Solar Training subtabs.
- Add `Solar Estimate` immediately after `Retention`.
- Each agent must update its context file and this shared context after each phase.
- Each agent must commit scoped files only.
- Each agent must report what it changed and what the next phase must consider.
- Each phase prompt must follow the user’s standard template.
- The system should support clean handoff between chat sessions without relying on hidden memory.

---

# SOLAR ESTIMATE LONG-TERM TARGET

The final Solar Estimate tool should support a data interview flow for generating homeowner-facing solar estimates.

Required long-term capabilities:

## Address Intake
- Add address input.
- Use Google address suggestions/autocomplete if existing app dependencies/API support it.
- If Google autocomplete is not already available, create a safe interface/placeholder and document what is needed.
- After address save, render a map with a location pin if existing app dependencies/API support it.
- Do not send private/customer data to external services except through approved app integration.

## Home Details
- Add shading selection:
  - No shade on my roof
  - A little shade on my roof
  - A lot of shade on my roof
- Add rent/own selection.
- Add property type:
  - Single family home
  - Condo/apartment
  - Mobile home
  - Commercial

## Energy Consumption
- Add energy consumption method:
  - Average electric bill
  - Home size
- Keep providers:
  - Southern California Edison Co
  - Imperial Irrigation District
- Use appropriate rates depending on location/provider.
- Use existing app rate data first if present.
- SCE rate option reference includes names such as:
  - Domestic (D)
  - Domestic - CARE (D-CARE)
  - Domestic - Time of Use - PRIME (TOU-D-PRIME)
  - Residential - Domestic - Time of Use, PRIME, NEM 3.0 (TOU-D-PRIME-NEM3)
  - Other SCE residential options if already present in local app data

## System Configuration
- Add system configuration selection:
  - Solar Only
  - Solar Plus Battery
- Do not add solar item/catalog build in early phases.
- Do not create a full product inventory system.
- The purpose is the estimate interview input process, not a full proposal catalog.

## Estimate Summary
Generate a summary page inspired by the user’s Enphase-style reference screenshots while matching PowerOn dark premium style.

Summary should eventually include:
- system size
- estimated cost
- savings breakdown
- bill savings
- energy independence
- backup estimate if battery is selected
- rate recommendation strip
- NEM 3.0-style bill comparison graph
- consumption profile graph
- disclaimer section
- bottom adjustable system controls:
  - solar size
  - battery size if battery selected
- ability to edit/adjust the system configuration directly from the summary page after the generated estimate is shown

---

# PRIVACY / EXTERNAL REQUEST RULE

If inspecting public websites or docs for implementation details:
- Do it anonymously.
- Do not send customer/private app data.
- Prefer existing local code and existing local data over external requests.
- Do not add new external dependencies unless explicitly scoped.
- Do not wire live Google requests unless the app already has approved keys/dependencies and the phase explicitly allows it.
- If required keys or dependencies are missing, create a safe adapter/placeholder and document the missing integration.

---

# FULL SOLARUPGRADE PHASE ROADMAP

## Phase 1 — Claude — Audit + Retention Crash Fix
Status:
COMPLETE

Goal:
Audit the existing Solar Training tab and fix the Retention crash.

Completed:
- Solar Training parent identified as `src/views/SolarTrainingView.tsx`.
- Existing tabs identified:
  - `certifications`
  - `training`
  - `scores`
  - `rules`
  - `quiz`
  - `nem3`
  - `progress` = Retention
- Retention crash fixed in `src/components/solarTraining/SolarRetentionHeatmap.tsx`.
- Root cause: component was called with no props while render still used raw `data.length`, `data.flat()`, and `data.every(...)`.
- Fix: made props optional and changed render references to `safeData`.
- Shared context updated with audit findings.

Commits:
- `72193d5` — Fix Solar Training retention crash and add solarupgrade audit context
- `ed7bf01` — chore: backfill commit hash in phase 1 completion log

Next phase:
Phase 2 may add Solar Estimate tab shell after Retention.

---

## Phase 2 — Codex — Solar Estimate Tab Shell
Status:
COMPLETE

Goal:
Add the new `Solar Estimate` subtab after Retention with a polished shell only.

Allowed:
- Add tab definition.
- Add render condition.
- Add `SolarEstimateTab.tsx`.
- Show planned wizard steps:
  - Address
  - Home Details
  - Energy Use
  - System Config
  - Estimate Summary
- Update context docs.

Not allowed:
- No Google Maps implementation.
- No address autocomplete implementation.
- No estimate formulas.
- No rate calculations.
- No persistence.
- No Supabase.
- No NEM 3.0 edits.
- No broad refactor.

Expected completion:
- New `Solar Estimate` tab appears after Retention.
- Shell renders cleanly.
- Existing tabs still work.
- Retention still does not crash.
- Typecheck passes.
- Context files updated with actual file paths and tab id.

Expected files:
- `src/views/SolarTrainingView.tsx`
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

Phase 2 completion:
Complete.

---

## Phase 3 — Claude — Estimate Architecture + State Model
Status:
COMPLETE

Goal:
Review Phase 2 shell and add clean architecture for the Solar Estimate interview.

Allowed:
- Review the shell created in Phase 2.
- Tighten integration if needed.
- Create types/interfaces for estimate interview data.
- Add local state model.
- Add step navigation.
- Add safe defaults.
- Add placeholder handlers.
- Add utility/rate option constants if no existing better source exists.
- Document provider/rate findings.
- Document whether Google Maps/autocomplete support already exists in the repo.
- Prepare the data model so Phase 4 can build UI without guessing.

Suggested data fields:
- addressText
- selectedAddressLabel
- placeId
- latitude
- longitude
- utilityProvider
- ratePlan
- shading
- ownership
- propertyType
- consumptionMethod
- averageMonthlyBill
- homeSizeSqft
- estimatedMonthlyKwh
- systemMode
- targetOffset
- batteryPreference
- currentStep

Not allowed:
- No final estimate math.
- No real external requests unless existing app already has approved helpers and the phase explicitly allows it.
- No Supabase persistence.
- No broad refactor.
- No product catalog.
- No quote/proposal engine.

Expected completion:
- Solar Estimate shell has a clean internal data model.
- Step state exists safely.
- Next UI phase can build form screens without guessing structure.
- Shared context includes actual architecture notes.

Expected files:
- Phase 2 files, plus any new local type/helper file if needed.
- Agent must choose the smallest clean structure after inspecting code.

Phase 3 completion:
Complete.

---

## Phase 4 — Codex — Solar Estimate Interview Flow UI
Status:
COMPLETE

Goal:
Build the Solar Estimate interview screens using the architecture from Phase 3.

Screens:
1. Address
2. Home Details
3. Energy Use
4. System Config
5. Review handoff / pre-summary

Required fields:
- Address text
- Address suggestion selection UI
- Coordinates/pin placeholder or real map only if existing app support exists
- Shading:
  - No shade on my roof
  - A little shade on my roof
  - A lot of shade on my roof
- Rent or own
- Property type:
  - Single family home
  - Condo/apartment
  - Mobile home
  - Commercial
- Energy consumption method:
  - Average electric bill
  - Home size
- Utility provider:
  - Southern California Edison Co
  - Imperial Irrigation District
- Rate plan
- System configuration:
  - Solar Only
  - Solar Plus Battery

Visual direction:
- Match PowerOn dark style.
- Do not copy Enphase white UI directly.
- Use Enphase reference for flow and summary logic only.
- Keep cards compact and premium.
- Use subtle accent states.
- Keep labels readable.
- No aggressive glow.

Not allowed:
- No final quote math.
- No real customer data persistence.
- No unrelated Solar Training edits.
- No hidden external requests.
- No broad refactor.
- No final summary calculations beyond safe placeholders if required for UI continuity.

Expected completion:
- User can walk through the interview.
- State is retained while staying on the tab.
- Required values can be selected/input.
- Summary phase has all required input data.
- Shared context includes actual UI/file notes.

Phase 4 completion:
Complete.

---

## Phase 5 — Claude/Codex — Estimate Summary + Editable System Controls
Status:
COMPLETE

Goal:
Create the final estimate summary experience inspired by the Enphase summary reference while matching PowerOn dark style.

Required summary areas:
- Top metric cards
- Estimated system size
- Estimated cost
- Bill savings
- Energy independence
- Backup estimate if battery selected
- Rate recommendation strip
- Bill comparison chart inspired by NEM 3.0
- Consumption profile chart
- Disclaimer
- Bottom adjustable controls:
  - solar size
  - battery size if battery selected
- Ability to edit system configuration after generated summary

Important design reference:
The user wants a summary page that breaks down details like the Enphase reference:
- overview cards at top
- clear savings/bill breakdown
- consumption graph
- recommendation strip
- assumptions/disclaimer
- adjustable system-size and battery controls near the bottom

Data/logic approach:
- Prefer existing NEM 3.0 calculator patterns and local utility/rate data.
- Use conservative placeholder assumptions only if formulas are not yet verified.
- Do not make false precision claims.
- Clearly label estimates and assumptions.
- Preserve all existing NEM 3.0 formulas unless intentionally reusing them without changing them.

Not allowed:
- No false precision.
- No unverified financial claims.
- No hidden external requests with customer data.
- No broad app refactor.
- No unrelated app changes.

Expected completion:
- Summary page renders from interview data.
- Controls can adjust displayed system configuration.
- User can return/edit system configuration after summary is generated.
- Typecheck passes.
- Final context is updated.
- Agent recommends whether further polish is needed.

Phase 5 completion:
Complete.

---

# PHASE 1 AUDIT FINDINGS

## File Map

- Main parent:
  - `src/views/SolarTrainingView.tsx`
  - Has `// @ts-nocheck`
  - 7 subtabs rendered via `activeTab` state
  - All subtab panels are self-contained sub-components in the same file except NEM3Visualizer, SolarRetentionHeatmap, SolarQuizCard

- Retention tab component:
  - `src/components/solarTraining/SolarRetentionHeatmap.tsx`
  - Expects `topics`, `periods`, `data` props
  - Fixed crash here

- Quiz engine:
  - `src/services/solarTraining/SolarQuizEngine.ts`

- Curriculum sequencer:
  - `src/services/solarTraining/SolarCurriculumSequencer.ts`

- Retention tracker:
  - `src/services/solarTraining/SolarRetentionTracker.ts`
  - localStorage-first
  - Supabase sync stub not yet wired

- NEM3 calculator:
  - `src/services/solarTraining/SolarNEM3Calculator.ts`
  - Do not touch formulas unless a later phase explicitly scopes it

- Daily scheduler:
  - `src/services/solarTraining/SolarDailyScheduler.ts`

- Nexus integration:
  - `src/services/solarTraining/SolarNexusIntegration.ts`

- NEM3 visualizer:
  - `src/components/solarTraining/NEM3Visualizer.tsx`

- Quiz card:
  - `src/components/solarTraining/SolarQuizCard.tsx`

## Tab IDs

SolarTab type currently includes:

- `certifications`
- `training`
- `scores`
- `rules`
- `quiz`
- `nem3`
- `progress`

The tab with label `Retention` uses id `progress` because of legacy naming.

Phase 2 should add a new tab id:
- recommended: `estimate`

## State / Data Flow

- `SolarTrainingView` holds only `activeTab` state.
- Each panel manages its own state.
- Supabase tables discovered:
  - `solar_certifications`
  - `solar_scenarios`
  - `solar_training_sessions`
  - `solar_rules`
  - `solar_study_queue`
  - `solar_debriefs`
- Retention heatmap receives no data from Supabase in current implementation.
- Retention heatmap is called with zero props.
- After Phase 1 fix, it shows an empty/CTA state safely.
- No localStorage or persistence touches in the view itself.
- Persistence is in `SolarRetentionTracker` service, not wired to the heatmap.

## Retention Crash Root Cause

`<SolarRetentionHeatmap />` was called with no props at approximately line 1061 of `SolarTrainingView.tsx`.

The component already had `safeTopics`, `safePeriods`, and `safeData` guards, but three render locations still referenced the raw `data` prop directly:

- `data.length`
- `data.flat()`
- `data.every(...)`

When `data` was undefined, the app threw:

`Cannot read properties of undefined (reading 'length')`

## Retention Fix Applied

In `src/components/solarTraining/SolarRetentionHeatmap.tsx`:

1. Made `topics`, `periods`, and `data` optional in `SolarRetentionHeatmapProps`.
2. Replaced `data.length` with `safeData.length`.
3. Replaced `data.flat()` with `safeData.flat()`.
4. Replaced `data.every(...)` with `safeData.every(...)`.

## Phase 1 Learned Skills / Reusable Patterns

- When a component is rendered without props but has fallback arrays, all render-time references must use normalized safe variables, not the raw prop.
- Optional props should be reflected in the TypeScript interface when the parent intentionally renders the component with no props.
- Retention currently behaves as a placeholder/empty state, not a fully wired data dashboard.
- `SolarTrainingView.tsx` is large and uses `@ts-nocheck`; future new files should be typed carefully to avoid expanding unchecked code.
- Solar Training tab integration should be done through the existing `TABS` array and active-tab render section.

---

# NEXT PHASE ACTIVE INSTRUCTIONS

Current active phase:
No active build phase. Phase 5 is complete; optional final polish/stabilization is recommended before defining the next build phase.

Agent:
Claude/Codex, as assigned by the executive builder

Required starting point:
- Branch: `solarupgrade`
- Latest completed Phase 4 commit: see Phase 4 completion log below.
- Working tree should be clean before starting.
- Phase 3 added `src/services/solarTraining/SolarEstimateTypes.ts` with all interview types, constants, and defaults.
- Phase 4 replaced the placeholder area in `src/components/solarTraining/SolarEstimateTab.tsx` with the full local interview flow UI.

Phase 5 must:
1. Read this shared context file.
2. Read the assigned agent-specific context file.
3. Confirm Phase 5 is assigned to that agent by the executive builder.
4. Inspect `src/components/solarTraining/SolarEstimateTab.tsx`, `src/services/solarTraining/SolarEstimateTypes.ts`, and `src/services/solarTraining/SolarNEM3Calculator.ts`.
5. Build the final estimate summary experience from local interview state.
6. Add top metric cards, bill comparison/consumption visuals, rate recommendation strip, disclaimer, and editable system controls.
7. Include solar size and battery size controls when battery mode is selected.
8. Keep claims conservative, clearly label assumptions, and avoid false precision.
9. Preserve existing NEM 3.0 formulas unless reusing them directly.
10. Run `npm.cmd run typecheck`.
11. Update shared and agent context files, then commit scoped files only.

Phase 5 must not:
- Add hidden external requests with customer data.
- Add Supabase persistence.
- Add product catalog or proposal engine.
- Change NEM 3.0 formulas.
- Broadly refactor SolarTrainingView.tsx or unrelated Solar Training subtabs.

Next agent start prompt:
Read `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md` and your agent-specific context file. Run the current active phase assigned by the executive builder. Use the shared context as the source of truth. After completion, update the shared context, append your agent completion log, set the next active phase if safe, run `npm.cmd run typecheck`, commit scoped files, and report back.

---

# EXECUTIVE BUILDER CONTROL LOG

The user will paste each agent report back into chat.

After each report, the executive builder will decide:

- Continue to next phase
- Pause for polish/stabilization
- Rewrite/adjust next phase scope
- Split a phase into smaller phases
- Stop and review manually

Agents should not assume approval to continue beyond their active phase.

---

# LATEST PHASE STATUS

Latest completed phase:
Local Saved Estimates — localStorage persistence, Solar Estimates library, draft auto-save, open/rename/delete

Latest completed commits:
- Phase 1: `72193d5`, `ed7bf01`
- Phase 2: `ecb0b5b`
- Phase 3: `6ad11a7`, `91cf6d2`
- Phase 4: see Phase 4 completion log below
- Phase 5: see Phase 5 completion log below
- Polish pass (post Phase 5): `ce2be20`
- Visual Polish Pass 2: `0cbfe7c`
- Summary Chart Tabs + Local Save: `5982e03`
- Local Saved Estimates: see Local Saved Estimates completion log below

Current ready phase:
No active build phase. Ready for screenshot QA on saved estimates feature.

Current risk level:
Low. All changes are inside SolarEstimateTab.tsx only. No formula, Supabase, or unrelated tab changes. Typecheck passes clean.

Recommended action:
Screenshot QA: create an estimate, fill all 5 steps, save it, start a new estimate, then reopen the saved estimate from the Solar Estimates library. Verify all fields restore and the address, bill, system config, and summary controls are correct. Verify app reload restores the active draft. Do not proceed into a new build phase without user review.

---

# PHASE 2 COMPLETION LOG

Status:
Complete

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/views/SolarTrainingView.tsx`
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

TAB ID ADDED:
`estimate`

SHELL COMPONENT PATH:
`src/components/solarTraining/SolarEstimateTab.tsx`

WHAT CHANGED:
- Added the `estimate` Solar Training subtab after legacy `progress` / Retention.
- Imported and rendered `SolarEstimateTab` when the new tab is active.
- Created a shell-only Solar Estimate component in the premium PowerOn dark style.
- Displayed only the planned wizard steps: Address, Home Details, Energy Use, System Config, Estimate Summary.
- Did not add maps, autocomplete, estimate math, provider/rate logic, persistence, Supabase changes, NEM 3.0 changes, or broad refactors.

WHAT WAS LEARNED:
- `src/views/SolarTrainingView.tsx` still owns the subtab registry through the `SolarTab` union and `TABS` array.
- The active-tab render list is the narrow integration point for adding this shell.
- New components can be typed normally even though the parent view remains `@ts-nocheck`.
- The existing tab bar marks `int1` tabs with reduced opacity, so the new Solar Estimate tab inherits that treatment.

LEARNED SKILLS / REUSABLE PATTERNS:
- Add Solar Training subtabs by updating the `SolarTab` union, `TABS` array, and active-tab render block together.
- Keep new Solar Training UI presentational when later phases are expected to define state/data architecture.
- Use small typed component-local arrays for ordered shell steps.

BUGS / RISKS:
- No Phase 2 runtime issues found.
- Phase 3 should decide whether Solar Estimate belongs in `int1` visual grouping or needs a new group/treatment.
- The shared context file had pending edits before this phase began; Codex preserved and completed them rather than reverting.

TYPECHECK RESULT:
PASS — `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE ADJUSTMENTS:
- Phase 3 should review `SolarEstimateTab.tsx` before introducing local state and types.
- Recommended tab id is now actual: `estimate`.
- Shell is intentionally presentational; Phase 3 can add interview state without untangling any placeholder logic.
- Phase 3 should inspect whether Google Maps/autocomplete support exists elsewhere in the repo, but should not wire live requests unless explicitly scoped.

NEXT PHASE READY:
YES

COMPACT HANDOFF FOR NEXT CHAT:
Phase 2 added the `estimate` tab after Retention in `src/views/SolarTrainingView.tsx` and created `src/components/solarTraining/SolarEstimateTab.tsx`. The shell shows only the five planned steps: Address, Home Details, Energy Use, System Config, Estimate Summary. No estimate math, rates, persistence, Supabase, Google Maps/autocomplete, NEM 3.0, or broad refactors were added. Typecheck passed. Phase 3 is ready to add typed local interview architecture/state and document provider/rate plus Maps/autocomplete findings.

---

# PHASE 3 ARCHITECTURE FINDINGS

## Google Maps / Places Autocomplete
VERDICT: Already supported — Phase 4 can wire it without new installs.

- `@react-google-maps/api` is already installed.
- `VITE_GOOGLE_MAPS_BROWSER_KEY` env var is already configured.
- `src/utils/googleMapsLoader.ts` already loads the `places` library.
- `src/components/v15r/MileageProjectAddress.tsx` already shows the full pattern:
  - `useV15rGoogleMapsLoader()` hook
  - `GoogleMap` + `MarkerF` + dark map styles
  - Places autocomplete input
- Phase 4 should use the same pattern for the Address step.
- Do NOT add new Maps packages. Do NOT expose API keys in new files.
- If the Maps key is missing at runtime, fall back to a plain text input — do not block the step.

## Rate / Provider Data
VERDICT: Existing data in `SolarNEM3Calculator.ts` is sufficient for Phase 5 integration.

- `src/services/solarTraining/SolarNEM3Calculator.ts` exports:
  - `Utility` type: `'SCE' | 'IID'`
  - `RatePlan` type: `SCE_TOU_D_PRIME`, `SCE_TOU_D_4_9PM`, `SCE_TOU_D_PRIME_2`, `IID_TOU_RESIDENTIAL`, `IID_STANDARD`
  - Full `TOUSchedule` objects with hourly import/export rates
  - `calculateNEM3Savings()` — Phase 5 may call this directly
- `SolarEstimateTypes.ts` `SolarEstimateRatePlan` uses the same IDs for future alignment.

## Phase 3 Types File
NEW FILE: `src/services/solarTraining/SolarEstimateTypes.ts`

Exports:
- `SolarEstimateData` interface — full interview data shape
- `DEFAULT_ESTIMATE_DATA` — safe initial values
- `ESTIMATE_STEPS` — ordered step ID array
- `UTILITY_PROVIDERS`, `RATE_PLANS_BY_UTILITY`, `SHADING_OPTIONS`, `OWNERSHIP_OPTIONS`, `PROPERTY_TYPES`, `CONSUMPTION_METHODS`, `SYSTEM_MODES` — all option arrays for Phase 4 form UI

## Phase 3 Component Changes
UPDATED: `src/components/solarTraining/SolarEstimateTab.tsx`

- Now stateful — `useState<SolarEstimateData>(DEFAULT_ESTIMATE_DATA)`
- Step navigation: `goNext()`, `goBack()`, `goToStep(step)`
- Generic field updater: `updateField(key, value)` — Phase 4 wires inputs to this
- Progress bar showing completed / active / pending steps with color coding
- Step cards are now clickable buttons with active/completed visual states
- Active step placeholder area with live state readout (step, utility, systemMode, bill)
- Back/Next navigation buttons with disabled states at boundaries
- Phase 4 handoff notes embedded in component file comment block

---

# PHASE 3 COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
6ad11a7

FILES CHANGED:
- `src/services/solarTraining/SolarEstimateTypes.ts` (NEW)
- `src/components/solarTraining/SolarEstimateTab.tsx` (UPDATED)
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md` (UPDATED)
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md` (UPDATED)

WHAT CHANGED:
- Created `SolarEstimateTypes.ts` with complete interview data interface, safe defaults, step order, and all option constant arrays (providers, rate plans, shading, ownership, property type, consumption method, system mode).
- Rewrote `SolarEstimateTab.tsx` from static shell to stateful component with step navigation, generic field updater, interactive step cards, progress bar, and active step placeholder.
- Documented Google Maps/Places and rate/provider findings in shared context.
- Advanced active phase to Phase 4 — Codex.

WHAT WAS LEARNED:
- `@react-google-maps/api` + `places` library + `VITE_GOOGLE_MAPS_BROWSER_KEY` are already present. Phase 4 can wire Places autocomplete using the `MileageProjectAddress.tsx` pattern without any new packages.
- `SolarNEM3Calculator.ts` has full TOU schedules for SCE and IID. Rate plan IDs in the new types file are aligned to allow Phase 5 to call `calculateNEM3Savings()` directly.
- `tsconfig.json` has `noUnusedLocals: false` and `noUnusedParameters: false` — Phase 4 can add handlers even before all inputs are wired.
- `SolarTrainingView.tsx` uses `@ts-nocheck`; new Solar Estimate files are fully typed.

LEARNED SKILLS / REUSABLE PATTERNS:
- Use `<K extends keyof SolarEstimateData>(key: K, value: SolarEstimateData[K])` pattern for a type-safe generic field updater. Avoids a separate handler per field.
- Co-locate option arrays (e.g. SHADING_OPTIONS, PROPERTY_TYPES) in the types file so Phase 4 can import and map over them directly without re-defining the data.
- Step navigation driven by `ESTIMATE_STEPS.indexOf(data.currentStep)` keeps the step order as the single source of truth.

BUGS / RISKS:
- No runtime issues found.
- `MileageProjectAddress.tsx` uses `@ts-nocheck` because of Google Maps type complexity — Phase 4 may need the same if TypeScript strictness causes issues with the Places API.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE ADJUSTMENTS:
- Phase 4 form screens must import from `@/services/solarTraining/SolarEstimateTypes` — all options and types are ready there.
- `updateField`, `goNext`, `goBack`, `goToStep` are already in component scope — pass them as props or restructure into a step sub-component pattern (Codex's choice).
- Address step: use `useV15rGoogleMapsLoader()` + `GOOGLE_MAPS_BROWSER_KEY` check before attempting Maps — safe text fallback if key is absent at runtime.
- Energy Use step: use `RATE_PLANS_BY_UTILITY[data.utilityProvider]` to show only relevant rate plans.
- System Config step: `data.systemMode === 'solar_plus_battery'` gates battery-specific fields in Phase 5.

NEXT PHASE READY:
YES

COMPACT HANDOFF FOR NEXT CHAT:
Phase 3 added `src/services/solarTraining/SolarEstimateTypes.ts` (all interview types, option arrays, defaults) and rewrote `SolarEstimateTab.tsx` with stateful step navigation and a generic `updateField` updater. Google Maps/Places support is confirmed already in the app (same pattern as MileageProjectAddress.tsx). Rate data is already in SolarNEM3Calculator.ts with matching IDs. Typecheck passes. Phase 4 Codex should build form UI per step using the exported option arrays and wire inputs to `updateField`.

---

# PHASE 4 COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

WHAT CHANGED:
- Replaced the active-step placeholder in `SolarEstimateTab.tsx` with full local interview screens for Address, Home Details, Energy Use, System Config, and Review.
- Wired every input and option card to the existing `updateField` state handler.
- Used the option arrays from `SolarEstimateTypes.ts` for shading, ownership, property type, consumption method, utility provider, rate plan, and system mode.
- Added safe address text entry with Google Places suggestions and a dark map pin preview only when the existing `VITE_GOOGLE_MAPS_BROWSER_KEY` and loader are available.
- Added a Review/pre-summary screen that displays collected inputs and clearly defers estimate math and savings claims to Phase 5.

WHAT WAS LEARNED:
- The existing `useV15rGoogleMapsLoader()` hook and Google Maps typings work from a typed Solar Estimate component without needing `@ts-nocheck`.
- The Phase 3 data model is sufficient for the full interview UI; no type changes were needed.
- Rate plan filtering works cleanly through `RATE_PLANS_BY_UTILITY[data.utilityProvider]`.

LEARNED SKILLS / REUSABLE PATTERNS:
- Keep Solar Estimate step screens as local helper components in `SolarEstimateTab.tsx` while the feature is still compact.
- Use a shared option-card class helper so selected/unselected states stay consistent across the wizard.
- Reset address place metadata when the user manually edits the address, then refill placeId/coordinates only after a Places selection.

BUGS / RISKS:
- Google Places and map preview still depend on the existing browser key being available at runtime; the UI safely falls back to text-only address entry when it is missing or fails to load.
- Phase 5 should be careful not to present unverified savings or cost outputs as precise quotes.

TYPECHECK RESULT:
PASS — `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE ADJUSTMENTS:
- Phase 5 can use the Review/pre-summary data directly from `SolarEstimateTab` local state.
- Phase 5 should consider splitting the component if summary UI becomes large, but avoid broad Solar Training refactors.
- Existing NEM 3.0 service data should be reused conservatively if estimate math is introduced.

NEXT PHASE READY:
YES

COMPACT HANDOFF FOR NEXT CHAT:
Phase 4 built the Solar Estimate interview UI in `src/components/solarTraining/SolarEstimateTab.tsx`. Address supports text entry, optional existing Google Places suggestions, placeId/lat/lng capture, and a dark map pin preview when the configured loader/key are available. Home Details, Energy Use, System Config, and Review all use the Phase 3 option arrays and local `updateField` state only. No persistence, Supabase, final estimate math, product catalog, proposal engine, or NEM 3.0 formula changes were added. Typecheck passes. Phase 5 is ready to build the estimate summary and editable system controls.

---

# PHASE 5 COMPLETION LOG

AGENT:
Codex GPT-5.5 working the Claude/Codex-assigned phase

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

WHAT CHANGED:
- Replaced the Phase 4 Review placeholder with a final Estimate Summary screen driven by local interview state.
- Added top metric cards for system size, estimated cost, modeled monthly savings, and energy independence.
- Reused the existing `calculateNEM3Savings()` service and `TOU_RATE_SCHEDULES` as a read-only source for conservative bill-shape estimates without changing NEM 3.0 formulas.
- Added a rate recommendation strip, monthly bill comparison chart, consumption profile visual, assumptions/disclaimer section, and bottom editable controls for solar size and battery size.
- Added direct summary controls to switch Solar Only vs Solar Plus Battery and a shortcut back to System Config.
- Added a battery backup estimate card only when Solar Plus Battery is selected.

WHAT WAS LEARNED:
- The Phase 4 interview state is sufficient to generate a local planning summary without adding new types or persistence.
- The existing NEM 3.0 calculator can safely support the summary page when wrapped with conservative labels and rough input assumptions.
- `SolarEstimateTypes.ts` did not need changes for Phase 5.
- Browser visual QA could not be completed because the in-app browser security policy rejected `http://127.0.0.1:5173`; the dev server was stopped after the blocked attempt.

LEARNED SKILLS / REUSABLE PATTERNS:
- Keep estimate-specific assumption wrappers in the UI component while leaving shared NEM training formulas untouched.
- Derive conservative kWh and system-size defaults from interview data, then let the user adjust the final display with local controls.
- Use lightweight SVG/div chart patterns already present in the Solar Training area instead of adding packages.

BUGS / RISKS:
- Estimate math is intentionally rough and should not be treated as a quote, proposal, finance disclosure, roof design, or guaranteed utility outcome.
- Visual QA is still recommended because browser access to the local dev URL was blocked in this session.
- `SolarEstimateTab.tsx` is now large; a later polish pass may split summary subcomponents if the feature grows further.

TYPECHECK RESULT:
PASS — `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE ADJUSTMENTS:
- Recommend final polish/stabilization before adding new functionality.
- Visually review the Estimate Summary on desktop and mobile when local browser access is available.
- Keep future work scoped; do not add proposal engine, persistence, Supabase, product catalog, or new packages unless explicitly assigned.

NEXT PHASE READY:
NO — no next build phase is defined. Optional polish/stabilization is recommended.

COMPACT HANDOFF FOR NEXT CHAT:
Phase 5 completed the Solar Estimate summary in `src/components/solarTraining/SolarEstimateTab.tsx`. The final step now shows conservative estimate cards, cost, modeled savings, energy independence, rate recommendation, monthly bill chart, consumption profile visual, battery-only backup card, assumptions/disclaimer, and editable solar/battery controls. It reuses `calculateNEM3Savings()` and local TOU schedules without modifying NEM formulas. No type changes, persistence, Supabase, product catalog, proposal engine, or unrelated tabs were added. Typecheck passes. Browser visual QA was attempted but blocked by in-app browser security policy for `http://127.0.0.1:5173`, so final polish is recommended.

---

# POLISH / STABILIZATION COMPLETION LOG (post Phase 5)

AGENT:
Claude Code

COMMIT HASH:
ce2be20

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

WHAT CHANGED:
- Fixed duplicate `ReviewRow label="Consumption input"` in the summary grid — replaced second occurrence with `label="Suggested size"` showing the derived kW figure.
- Replaced stale "Phase 5 - Estimate Summary" internal badge in the header with a functional "Start new estimate" reset button that clears all state back to safe defaults.
- Added `resetEstimate` callback in `SolarEstimateTab` that resets `data`, `solarSizeKw`, and `batterySizeKwh` to initial defaults.
- Fixed stale build-phase language in EnergyUseStep SectionIntro ("Phase 5 can translate...") and SystemConfigStep SectionIntro ("No product catalog or estimate math is attached in this phase.") — updated to describe actual current behavior.
- Fixed stale FieldLabel hint for Target offset ("Phase 5 can use this as a summary control") → "Carried into the estimate summary".
- Updated `STEP_META` entry for `estimate_summary`: label changed from "Review" to "Summary"; description updated from stale Phase 5 text to "Conservative planning estimate with editable system controls."
- Added `overflow-x-auto` wrapper with `min-w-[360px]` inner div on `BillComparisonChart` to prevent bar squishing on narrow/mobile viewports.
- Added responsive step card grid breakpoints: `grid-cols-2 sm:grid-cols-3 md:grid-cols-5` (was `md:grid-cols-5` only, showing 1 col on mobile).
- Added "Select Solar Plus Battery above to enable battery sizing." hint text under the disabled battery slider.

WHAT WAS LEARNED:
- Phase 5 completion logs had pending "see Codex report" commit hash placeholders; the polish pass preserved them accurately.
- No formula, type, persistence, or structural changes were needed. All issues were UI copy, responsive layout, and a duplicate row bug.

BUGS / RISKS:
- All remaining estimates are conservative planning figures, not quotes or proposals.
- Browser visual QA is still the recommended next step; no in-browser testing was done in this session.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE READY:
NO active build phase. Ready for browser QA.

COMPACT HANDOFF FOR NEXT CHAT:
Polish pass on `src/components/solarTraining/SolarEstimateTab.tsx` complete. Fixed: duplicate ReviewRow (now shows Suggested Size), stale phase-build copy in 3 SectionIntro/FieldLabel locations, internal phase badge replaced with "Start new estimate" reset button, step card grid now has 2-col mobile / 3-col sm / 5-col md responsive layout, BillComparisonChart wrapped with overflow-x-auto for mobile, battery disabled hint added. No formulas, types, persistence, Supabase, or unrelated tabs touched. Typecheck passes. Branch is ready for manual browser QA.

---

# VISUAL POLISH PASS 2 COMPLETION LOG (QA items 2, 3, 4)

AGENT:
Claude Code

COMMIT HASH:
0cbfe7c

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

WHAT CHANGED:
- BillComparisonChart: replaced div/flex percentage-height bars with a proper SVG chart. Added horizontal grid lines at 25/50/75/100% with y-axis dollar labels. Before bars now use rgba(100,116,139,0.72) (slate-500 equivalent, clearly visible on dark bg). After bars use amber or emerald at 0.82 opacity. Layout matches NEM 3.0 chart visual language: dark panel, subtle grid, compact labels, readable legend.
- AddressMapPreview: merged `!GOOGLE_MAPS_BROWSER_KEY` and `loadError` branches into a single premium fallback card. Card shows MapPin icon, "Map preview unavailable" label, address text if entered, and a 2-col lat/lng grid (shows captured values or "Pending"). Updated `!center` branch to show "Awaiting pin" header plus typed address text with guidance to select a suggestion.
- EstimateSummaryStep: added "Interview inputs" section label (ClipboardList icon) above the 12-item review rows grid. Tightened chart grid from mb-5/gap-5 to mb-4/gap-4.

WHAT WAS LEARNED:
- The original div/flex percentage-height bars were near-invisible because `bg-slate-500/55` on `bg-slate-950/45` has very low contrast. SVG with explicit rgba fills solves this cleanly.
- SVG viewBox approach (W=480, H=150) with per-pixel bar positioning gives precise control and matches NEM 3.0 chart language without new packages.
- Combining `!GOOGLE_MAPS_BROWSER_KEY` and `loadError` into one branch avoids duplicated fallback JSX and simplifies the state machine.

BUGS / RISKS:
- Estimates remain conservative planning figures; browser QA still recommended.
- Floating button overlap was intentionally excluded from this pass per task scope.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT PHASE READY:
NO active build phase. Ready for final screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Visual Polish Pass 2 on `src/components/solarTraining/SolarEstimateTab.tsx`. Fixed: BillComparisonChart now renders an SVG chart with grid lines, y-axis dollar labels, and clearly visible before/after bars matching NEM 3.0 style; AddressMapPreview fallback card now shows address + lat/lng + "Map preview unavailable" when Maps is unavailable; !center state shows typed address with "Awaiting pin" prompt; EstimateSummaryStep has "Interview inputs" section header above review rows and tighter chart spacing. No formulas, types, persistence, Supabase, or structural changes. Typecheck passes. Branch ready for final screenshot QA.

---

# SUMMARY CHART TABS + LOCAL SAVE COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
5982e03

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

WHAT CHANGED:
- Replaced the 2-chart grid in EstimateSummaryStep (BillComparisonChart + ConsumptionProfileChart side-by-side) with a 6-tab SummaryChartModule.
- Chart tabs: Monthly Bill | 24H Flow | 25 Yr Savings | Elec. Cost | Cumulative | Payments.
- Tab 1 (Monthly Bill): reuses existing SVG BillComparisonChart — before/after bars by month.
- Tab 2 (24H Flow): new SVG chart — Gaussian solar curve (yellow fill) + load line (blue), hourly modeled from monthlyKwh and solarSizeKw.
- Tab 3 (25 Yr Savings): new SVG grouped bar chart — annual bill without solar vs. with solar over 25 years, 4% utility escalation assumed.
- Tab 4 (Elec. Cost): new SVG line chart — utility rate escalation path vs. flat solar LCOE line over 20 years.
- Tab 5 (Cumulative): new SVG area/line chart — cumulative modeled savings 1–25 yr, with system cost payback reference line and dot.
- Tab 6 (Payments): card-based comparison — No Solar / New Electric Bill / Loan Payment (25yr @6.99% APR) / Total w/ Solar + loan.
- Added Save project estimate button in EstimateSummaryStep header row; on click shows "Estimate saved in this session — HH:MM" with emerald badge. Button becomes "Update saved estimate" after first save. Snapshot stored in local useState — no Supabase, no localStorage, no persistence outside the tab session.
- Added ChartTab type, CHART_TABS constant, SavedEstimateSnapshot type, ESCALATION_RATE constant, generate25YearData, generate24hProfile, getMonthlyLoanPayment helper functions.

WHAT WAS LEARNED:
- SVG viewBox chart pattern scales cleanly across all 6 chart types without new packages.
- All chart data derives entirely from existing nemResult, monthlyKwh, solarSizeKw, avgBeforeBill, avgAfterBill, systemCost already computed in EstimateSummaryStep — no new data sources.
- SummaryChartModule useState for activeChart is self-contained; the 6 chart components are lazy (only the active tab renders).

LEARNED SKILLS / REUSABLE PATTERNS:
- Subtab chart module pattern: wrapper div with flex tab bar (border-b) + chart content div. border-b-2 border-cyan-400 active state. Reuse for any future multi-chart panel.
- generate25YearData / generate24hProfile: reusable local helpers for solar planning visuals. ESCALATION_RATE=0.04 is the single source of truth for all 25-year projections.
- SavedEstimateSnapshot type: minimal session-only save pattern — useState, no persistence, clear UI feedback. Reuse for other "save in session" patterns.

BUGS / RISKS:
- All chart values are modeled estimates; label copy clearly says "modeled estimate — not a financial projection."
- Loan payment assumptions (25yr, 6.99% APR, no down payment) are rough — actual financing will differ.
- 24H Energy Flow battery dispatch is not modeled; only noted as "Battery mode" label when hasBattery is true.
- ConsumptionProfileChart is still defined in the file but no longer called (BillComparisonChart is now inside SummaryChartModule tab 1). noUnusedLocals: false so typecheck passes.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE READY:
NO — no next build phase defined. Ready for screenshot QA on the 6-tab chart module.

COMPACT HANDOFF FOR NEXT CHAT:
Summary Chart Tabs + Local Save added to `src/components/solarTraining/SolarEstimateTab.tsx`. EstimateSummaryStep now has a 6-tab SummaryChartModule replacing the old 2-chart grid: Monthly Bill (SVG bars), 24H Flow (SVG solar+load curves), 25 Yr Savings (SVG grouped bars), Elec. Cost (SVG LCOE vs rate lines), Cumulative (SVG area+line with payback dot), Payments (card grid). Save project estimate button in summary header stores a local session snapshot with emerald confirmation badge. All chart data derived from existing computed values — no new data sources, no Supabase, no localStorage. Typecheck passes.

---

# LOCAL SAVED ESTIMATES COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
9cec9c4

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

WHAT CHANGED:
- Added `LocalSolarEstimate` type and `ActiveDraft` type for full persistent saved estimate shape.
- Added `STORAGE_KEY_ESTIMATES = 'poweron.solarTraining.solarEstimates'` and `STORAGE_KEY_DRAFT = 'poweron.solarTraining.activeDraft'` constants.
- Added `loadEstimates`, `saveEstimates`, `loadActiveDraft`, `saveActiveDraft` localStorage helpers (all try/catch safe).
- Added `SolarEstimatesLibrary` component: list of saved estimates (most recent first), Open/Rename/Delete actions, inline rename via input, "Open" pill badge on the active estimate, empty state.
- Moved save action to `SolarEstimateTab` parent as `handleSave` callback. Save creates a new estimate (auto-names from address) or updates the existing one (preserves user rename). Shows "Saved in Solar Estimates" emerald badge for 3 seconds after save. Button label changes to "Update estimate" when an estimate is open.
- Added "Solar Estimates" button beside "Start new estimate" in the header. Active/inactive visual state. Shows count when estimates exist.
- When library is open the step wizard is hidden (replaced by `SolarEstimatesLibrary`). Close button returns to wizard.
- `SolarEstimateTab` now uses lazy `useState` initializers that call `loadActiveDraft()` on mount — restoring `data`, `solarSizeKw`, `batterySizeKwh`, and `activeEstimateId` from the last session.
- Added debounced auto-save `useEffect` (500ms) that writes `ActiveDraft` to `STORAGE_KEY_DRAFT` whenever `data`, `solarSizeKw`, `batterySizeKwh`, or `activeEstimateId` changes.
- `handleOpenEstimate` loads interview data + system controls from a saved estimate, forces `currentStep = 'estimate_summary'` so the user lands on the summary, and closes the library.
- `resetEstimate` now also clears `activeEstimateId` and `saveStatus`.
- `EstimateSummaryStep` props extended: removed internal `savedSnapshot` state + `handleSave`; added `onSave`, `activeEstimateId`, `saveStatus` props.
- `ActiveStepPanel` props extended to thread `onSave`, `activeEstimateId`, `saveStatus` down to `EstimateSummaryStep`.
- Added `X` to lucide-react imports for the library close button.

WHAT WAS LEARNED:
- Lazy useState initializers are the correct pattern for reading localStorage on mount without a separate useEffect or double-render.
- The existing solarSizeKw sync useEffect (resets to suggestedSystemSize when step is not estimate_summary) is safe with the restored draft because `handleOpenEstimate` always sets `currentStep = 'estimate_summary'`, which keeps the condition false.
- Debounced localStorage write prevents thrashing on every keystroke while the user edits interview fields.
- Preserving the estimate name on update (not auto-generating from address again) avoids overwriting user renames.

LEARNED SKILLS / REUSABLE PATTERNS:
- `useState(() => { const draft = load(); return draft?.field ?? default })` pattern: single-read lazy init for localStorage draft restoration without useEffect.
- `try { localStorage.setItem(...) } catch {}` pattern: safe localStorage write, silent on QuotaExceededError.
- `setSavedEstimates(prev => { const updated = ...; saveEstimates(updated); return updated })` pattern: atomic in-memory + localStorage sync inside a state updater.
- Debounced useEffect with `useRef<number | null>` timer and cleanup: correct pattern for debounced side effects in React.

BUGS / RISKS:
- localStorage is not encrypted. Do not store sensitive customer PII (SSN, full financial data). Addresses and bill amounts are acceptable for a local planning tool.
- If the user opens the app in two tabs simultaneously, the last write wins. This is acceptable for a single-user local tool.
- ConsumptionProfileChart remains defined but unused (noUnusedLocals: false, typecheck still passes).

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE READY:
NO — no next build phase defined. Ready for screenshot QA on saved estimates feature.

COMPACT HANDOFF FOR NEXT CHAT:
Local Saved Estimates added to `src/components/solarTraining/SolarEstimateTab.tsx`. localStorage keys: `poweron.solarTraining.solarEstimates` (estimate list) and `poweron.solarTraining.activeDraft` (current open estimate + step + system controls). `SolarEstimatesLibrary` component shows saved estimates with Open/Rename/Delete. "Solar Estimates" button in header opens/closes the library. Save creates or updates (no duplicates). Active draft auto-saves on every change (500ms debounce). App reload restores current draft via lazy useState initializers. No Supabase, no new packages, no formula or unrelated tab changes. Typecheck passes.
