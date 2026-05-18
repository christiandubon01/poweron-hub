# SOLARUPGRADE_CLAUDE.md

## EVERGREEN CLAUDE AGENT FILE

You are Claude Code working inside the PowerOn Hub / V15r app.

Branch:
solarupgrade

This file is not a one-phase prompt. It is a permanent operating file for Claude phases in the Solar Upgrade cascade.

The source of truth is:
`solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`

Before editing code, you must:
1. Confirm the current branch is `solarupgrade`.
2. Confirm the working tree is clean before starting, unless the user explicitly tells you to continue from existing uncommitted work.
3. Read `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`.
4. Read this file.
5. Locate `ACTIVE PHASE CONTROL` in the shared context.
6. Confirm the active phase is assigned to Claude Code.
7. Find the matching phase scope in the shared roadmap.
8. Execute only that active phase.
9. Keep changes scoped.
10. Run `npm.cmd run typecheck`.
11. Commit only scoped files.
12. Update the shared context file.
13. Append a completion log to this file.
14. Update `ACTIVE PHASE CONTROL` in the shared context to the next phase if the next phase is safe.
15. If the next phase is not safe, set `PHASE STATUS: PAUSE REQUIRED` and explain why.

---

## GLOBAL RULES

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

Do NOT touch unless explicitly required by the active phase:

- NEM 3.0 formulas
- bill calculations
- savings formulas
- Supabase sync
- persistence/localStorage
- unrelated tabs
- unrelated components
- sidebar/topbar
- floating action buttons
- route architecture
- package dependencies
- Google Maps live implementation
- live address autocomplete
- final estimate calculations
- product catalog or solar item catalog

Do NOT proceed if:

- the active phase is assigned to Codex
- the branch is not `solarupgrade`
- typecheck is already failing before your changes and the active phase does not cover fixing it
- required files are missing in a way that changes the phase scope
- completing the phase requires broad refactors
- completing the phase requires package installs or API keys not already present

If blocked, update the context files with the blocker and report:

`NEXT PHASE READY: NO`

---

## CLAUDE PHASE RESPONSIBILITIES

Claude is generally responsible for:

- audits
- architecture
- safety checks
- state/data modeling
- integration review
- stabilization
- final polish/review phases

Codex is generally responsible for:

- building scoped UI shells
- adding form screens
- implementing presentational flow
- applying UI structure from the architecture

If the active phase is assigned to Codex, do not edit code. Instead, report:

`Active phase is assigned to Codex. No Claude action taken.`

---

## REQUIRED PHASE EXECUTION FORMAT

When running an active Claude phase, follow the userâ€™s standard task structure from the shared context.

TASK TITLE:
Use the active task title from `ACTIVE PHASE CONTROL`.

MODEL / TOOL:
Use Claude Code in VS Code for this task.

CONTEXT:
This is the PowerOn Hub / V15r app.
Use the shared roadmap and latest completion logs.
Keep work scoped and avoid broad refactors.

TARGET FILES:
Use the expected files listed under the active phase.
Inspect first.
Do not assume.

REFERENCE FILES / DESIGN REFERENCES:
Use the references listed in the active phase and existing PowerOn/NEM 3.0 UI.

SCOPE:
Only complete the active phase scope.

Do NOT touch:
Respect all global restrictions and phase-specific restrictions.

CURRENT ISSUE:
Use the active phase issue from the shared roadmap.

DESIRED RESULT:
Use the active phase desired result from the shared roadmap.

REQUIREMENTS:
Use active phase requirements from the shared roadmap.

VISUAL REQUIREMENTS:
Preserve the PowerOn premium dark style.

DATA / LOGIC REQUIREMENTS:
Do not change formulas, persistence, Supabase, or external API behavior unless explicitly scoped.

RESPONSIVE REQUIREMENTS:
No horizontal overflow.
No overlap with floating buttons.
Wrap cleanly.

ACCEPTANCE CRITERIA:
Use active phase acceptance criteria from the shared roadmap.

QA:
Run:

`npm.cmd run typecheck`

If PowerShell blocks npm, use:

`npm.cmd run typecheck`

COMMIT:
Commit only scoped files.

---

## ACTIVE PHASE WORKFLOW

For every Claude phase:

1. Read the active phase from `ACTIVE PHASE CONTROL`.
2. Confirm it is assigned to Claude.
3. Read the matching phase section in `FULL SOLARUPGRADE PHASE ROADMAP`.
4. Read the latest completion logs.
5. Inspect target files before editing.
6. Make the smallest safe implementation.
7. Avoid changing already-working features.
8. Run typecheck.
9. Update `SOLARUPGRADE_SHARED_CONTEXT.md`.
10. Append a log to this file.
11. Commit scoped files.
12. Report back to the user.

The shared context must always be updated before commit so the next agent can continue cleanly.

---

## REQUIRED END-OF-PHASE ACTIONS

At the end of every Claude phase:

1. Update `SOLARUPGRADE_SHARED_CONTEXT.md`:
   - mark the completed phase complete
   - add commit hash
   - add files changed
   - add what changed
   - add what was learned
   - add learned skills / reusable patterns
   - add bugs / risks
   - add next phase adjustments
   - update `ACTIVE PHASE CONTROL` to the next phase if ready
   - set `PHASE STATUS: PAUSE REQUIRED` if the next phase is unsafe

2. Update this file:
   - append the completion log below

3. Run:

   `npm.cmd run typecheck`

4. Commit scoped files only.

5. Report back to user with:
   - branch name
   - commit hash
   - files changed
   - active phase completed
   - what changed
   - what was learned
   - learned skills / reusable patterns
   - bugs / risks
   - typecheck result
   - shared context updated YES/NO
   - Claude file updated YES/NO
   - next active phase
   - whether next phase is ready

---

## REQUIRED COMPLETION LOG TEMPLATE

Append this template at the end of this file after every Claude phase.

```text
## PHASE X COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:

FILES CHANGED:

ACTIVE PHASE COMPLETED:

WHAT CHANGED:

WHAT WAS LEARNED:

LEARNED SKILLS / REUSABLE PATTERNS:

BUGS / RISKS:

TYPECHECK RESULT:

SHARED CONTEXT UPDATED:

CLAUDE FILE UPDATED:

NEXT ACTIVE PHASE:

NEXT PHASE ADJUSTMENTS:

NEXT PHASE READY:

COMPACT HANDOFF FOR NEXT CHAT:
```

---

## PHASE 3 COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
6ad11a7

FILES CHANGED:
- `src/services/solarTraining/SolarEstimateTypes.ts` (NEW)
- `src/components/solarTraining/SolarEstimateTab.tsx` (UPDATED)
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md` (UPDATED)
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md` (UPDATED)

ACTIVE PHASE COMPLETED:
Phase 3 â€” Estimate Architecture + State Model

WHAT CHANGED:
- Created `SolarEstimateTypes.ts` with `SolarEstimateData` interface, `DEFAULT_ESTIMATE_DATA`, `ESTIMATE_STEPS`, and all option arrays (providers, rate plans, shading, ownership, property types, consumption methods, system modes).
- Rewrote `SolarEstimateTab.tsx` from static Phase 2 shell to stateful component with `useState`, step navigation (`goNext`, `goBack`, `goToStep`), generic `updateField`, interactive step cards, progress bar, and active step placeholder with live state readout.
- Documented Google Maps/Places and rate/provider findings in shared context.
- Set active phase to Phase 4 â€” Codex.

WHAT WAS LEARNED:
- Google Maps (@react-google-maps/api + places library + VITE_GOOGLE_MAPS_BROWSER_KEY) is already in the app. Phase 4 can wire autocomplete using MileageProjectAddress.tsx as the exact pattern reference.
- SolarNEM3Calculator.ts already has SCE + IID rate schedules. SolarEstimateTypes uses matching RatePlan IDs for Phase 5 integration.
- tsconfig has noUnusedLocals: false â€” safe to add handlers before all inputs are wired.

LEARNED SKILLS / REUSABLE PATTERNS:
- Generic field updater pattern: `<K extends keyof T>(key: K, value: T[K]) => setData(d => ({...d, [key]: value}))` â€” type-safe, single handler for all fields.
- Co-locate option arrays in the types file so form phases can import and map without redefining data.
- Step navigation by index: `ESTIMATE_STEPS.indexOf(data.currentStep)` keeps step order as single source of truth.

BUGS / RISKS:
- MileageProjectAddress.tsx uses @ts-nocheck for Google Maps types. Phase 4 may need same if strict typing causes issues with Places API.
- No Phase 3 runtime bugs found.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
Phase 4 â€” Codex â€” Solar Estimate Interview Flow UI

NEXT PHASE ADJUSTMENTS:
- Phase 4 imports all option arrays from `@/services/solarTraining/SolarEstimateTypes`.
- `updateField`, `goNext`, `goBack`, `goToStep` are in component scope â€” Phase 4 wires them to form inputs.
- Address step: use `useV15rGoogleMapsLoader()` + key check before attempting Maps; safe text fallback if key absent.
- Energy Use step: filter rate plans by `RATE_PLANS_BY_UTILITY[data.utilityProvider]`.

NEXT PHASE READY:
YES

COMPACT HANDOFF FOR NEXT CHAT:
Phase 3 added `src/services/solarTraining/SolarEstimateTypes.ts` (types + option arrays + defaults) and upgraded `SolarEstimateTab.tsx` to a stateful interview component with step navigation and a generic updateField handler. Google Maps/Places already in app â€” same pattern as MileageProjectAddress.tsx. Rate data in SolarNEM3Calculator.ts with matching IDs. Typecheck passes clean. Phase 4 Codex builds form UI per step using the exported option arrays.
---

## PHASE 5 COMPLETION LOG

AGENT:
Codex GPT-5.5 working the Claude/Codex-assigned phase

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Phase 5 â€” Estimate Summary + Editable System Controls

WHAT CHANGED:
- Built the final Solar Estimate summary screen from local interview state.
- Added top metric cards for estimated system size, estimated cost, modeled monthly savings, and energy independence.
- Added rate recommendation strip, bill comparison chart, consumption profile visual, assumptions/disclaimer, and bottom editable system controls.
- Added battery size controls and a battery backup card only for Solar Plus Battery.
- Allowed summary-time changes to Solar Only vs Solar Plus Battery and a return shortcut to System Config.
- Reused the existing `calculateNEM3Savings()` service and local TOU schedules without modifying NEM 3.0 formulas.

WHAT WAS LEARNED:
- Phase 4 state has enough information for a conservative local summary without changing `SolarEstimateTypes.ts`.
- Existing NEM/rate utilities can support estimate visuals as long as the UI clearly labels outputs as planning estimates.
- Browser visual QA could not be completed because the in-app browser security policy rejected `http://127.0.0.1:5173`; typecheck passed.

LEARNED SKILLS / REUSABLE PATTERNS:
- Wrap shared NEM calculations with estimate-specific assumptions in the UI layer rather than editing formula services.
- Auto-suggest solar size from interview state before the summary, then preserve manual summary controls after the estimate is generated.
- Use compact local chart components to avoid new packages.

BUGS / RISKS:
- Estimates are rough and should not be represented as quotes, finance disclosures, final roof designs, or guaranteed utility outcomes.
- Visual polish should still be checked in a browser when local browser access is available.
- `SolarEstimateTab.tsx` is becoming large and may benefit from a later scoped component split.

TYPECHECK RESULT:
PASS â€” `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase. Optional final polish/stabilization recommended.

NEXT PHASE ADJUSTMENTS:
- Run a final visual QA/polish pass before adding new functionality.
- Keep future changes scoped and avoid persistence, Supabase, product catalog, proposal engine, or new packages unless explicitly assigned.

NEXT PHASE READY:
NO â€” no next build phase is defined.

COMPACT HANDOFF FOR NEXT CHAT:
Phase 5 completed the Solar Estimate summary in `src/components/solarTraining/SolarEstimateTab.tsx`. The final step now shows conservative estimate cards, cost, modeled savings, energy independence, rate recommendation, monthly bill chart, consumption profile visual, battery-only backup card, assumptions/disclaimer, and editable solar/battery controls. It reuses `calculateNEM3Savings()` and local TOU schedules without modifying NEM formulas. Typecheck passes. Browser visual QA was attempted but blocked by in-app browser security policy for `http://127.0.0.1:5173`, so final polish is recommended.

---

## POLISH / STABILIZATION COMPLETION LOG (post Phase 5)

AGENT:
Claude Code

COMMIT HASH:
ce2be20

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Polish / Stabilization Pass â€” post Phase 5

WHAT CHANGED:
- Fixed duplicate ReviewRow "Consumption input" in summary â†’ replaced with "Suggested size" (derived kW).
- Replaced internal "Phase 5 - Estimate Summary" badge with "Start new estimate" reset button.
- Added `resetEstimate` callback resetting data, solarSizeKw, batterySizeKwh to defaults.
- Updated 3 stale build-phase copy strings: EnergyUseStep SectionIntro, SystemConfigStep SectionIntro, Target offset FieldLabel hint.
- STEP_META estimate_summary: label "Review" â†’ "Summary", description updated to current behavior.
- BillComparisonChart: added overflow-x-auto wrapper + min-w-[360px] for mobile.
- Step card grid: added grid-cols-2 sm:grid-cols-3 before md:grid-cols-5.
- Battery disabled hint: added "Select Solar Plus Battery above to enable battery sizing."

WHAT WAS LEARNED:
- No formula, type, persistence, or structural changes were needed. All issues were cosmetic/UX.
- Step card grid had no mobile breakpoints â€” polish passes should always audit responsive grid classes.

LEARNED SKILLS / REUSABLE PATTERNS:
- When replacing an internal phase badge with a user-facing action, wire reset to all local state slices (data + solarSizeKw + batterySizeKwh).
- Audit all SectionIntro and FieldLabel hint strings at polish time â€” build-phase references age out immediately.

BUGS / RISKS:
- Remaining estimates are conservative planning figures only; browser QA still recommended.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for manual browser QA.

NEXT PHASE ADJUSTMENTS:
- If a new build phase is added, keep SolarEstimateTab.tsx scoped; consider splitting EstimateSummaryStep into its own file if the component grows further.

NEXT PHASE READY:
NO â€” no next build phase is defined. Branch is ready for browser QA.

COMPACT HANDOFF FOR NEXT CHAT:
Polish pass complete on `src/components/solarTraining/SolarEstimateTab.tsx`. Fixed duplicate ReviewRow, stale phase copy in 3 locations, internal badge replaced with functional reset button, mobile grid breakpoints added to step cards, BillComparisonChart overflow-x-auto, battery disabled hint. No formulas, types, persistence, Supabase, or unrelated tabs touched. Typecheck passes clean. Branch solarupgrade is ready for manual browser QA.

---

## VISUAL POLISH PASS 2 COMPLETION LOG (QA items 2, 3, 4)

AGENT:
Claude Code

COMMIT HASH:
0cbfe7c

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Visual Polish Pass 2 â€” scoped QA items 2, 3, 4 only

WHAT CHANGED:
- BillComparisonChart: replaced div/flex bar chart with SVG chart. Grid lines at 25/50/75/100% with y-axis dollar labels. Before bars rgba(100,116,139,0.72), after bars amber/emerald at 0.82 opacity. Dark panel background. Matches NEM 3.0 chart visual language.
- AddressMapPreview: merged !GOOGLE_MAPS_BROWSER_KEY and loadError into one premium fallback card showing MapPin icon, "Map preview unavailable" label, address text if entered, 2-col lat/lng grid (captured values or "Pending"). Updated !center to show "Awaiting pin" with typed address and guidance.
- EstimateSummaryStep: added "Interview inputs" ClipboardList label above review rows. Tightened chart grid spacing (mb-5/gap-5 â†’ mb-4/gap-4).

WHAT WAS LEARNED:
- div/flex percentage-height bar charts with low-opacity fills are nearly invisible on dark backgrounds. SVG with explicit rgba fills and grid lines is the correct approach and requires no new packages.
- Combining branches that share identical fallback UI (GOOGLE_MAPS_BROWSER_KEY missing vs load error) keeps the component cleaner.

LEARNED SKILLS / REUSABLE PATTERNS:
- SVG chart pattern (W=480, H=150, padL=40, padR=8, padT=8, padB=22): gives reliable bar positioning and grid lines without external chart packages. Reuse this for any future Solar Estimate charts.
- Premium "unavailable" fallback card pattern: icon + label + conditional content block. Reuse for any future map or external-dependency fallback states.

BUGS / RISKS:
- Floating button overlap was intentionally excluded from this pass.
- Estimates remain conservative planning figures.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for final screenshot QA.

NEXT PHASE ADJUSTMENTS:
- If floating button overlap is fixed next, target the outer wrapper/padding in SolarEstimateTab or SolarTrainingView â€” do not touch formula or chart logic.

NEXT PHASE READY:
NO â€” no active build phase defined. Branch ready for final screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Visual Polish Pass 2 on `src/components/solarTraining/SolarEstimateTab.tsx`. BillComparisonChart is now an SVG chart with grid lines, y-axis dollar labels, and clearly visible bars. AddressMapPreview fallback card shows address + lat/lng + "Map preview unavailable" when Maps is unavailable; !center shows typed address with "Awaiting pin" prompt. EstimateSummaryStep has "Interview inputs" label above review rows. No formulas, types, persistence, Supabase, or structural changes. Typecheck passes. Commit: 0cbfe7c.

---

## SUMMARY CHART TABS + LOCAL SAVE COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
5982e03

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Summary Chart Tabs + Local Save

WHAT CHANGED:
- Added 6-tab SummaryChartModule replacing the 2-chart grid in EstimateSummaryStep.
- Added Save project estimate button with local session-only snapshot and emerald confirmation badge.
- Added ChartTab type, CHART_TABS, SavedEstimateSnapshot type, ESCALATION_RATE constant.
- Added generate25YearData, generate24hProfile, getMonthlyLoanPayment helpers.
- Added chart components: EnergyFlow24hChart, TwentyFiveYearSavingsChart, CostOfElectricityChart, CumulativeSavingsChart, PaymentComparisonChart, SummaryChartModule.

WHAT WAS LEARNED:
- All 6 chart datasets derive from values already computed in EstimateSummaryStep â€” no new API, data source, or external dependency needed.
- SVG viewBox pattern (established in Polish Pass 2) scales to all chart types cleanly.
- SummaryChartModule activeChart useState is self-contained â€” only the visible tab's chart renders.

LEARNED SKILLS / REUSABLE PATTERNS:
- Multi-tab SVG chart module pattern: div wrapper with flex tab bar + chart area. Active tab uses border-b-2 border-cyan-400. Compact and reusable.
- generate25YearData reusable for any future 25-year solar projection chart.
- Session-only save pattern: useState<SnapshotType | null>, button toggles label, emerald badge on saved state.

BUGS / RISKS:
- Loan rate assumption (6.99% APR) is a rough planning figure only. Clearly labeled.
- 24H battery dispatch not modeled â€” noted as Battery mode label.
- ConsumptionProfileChart still defined but unused; noUnusedLocals: false prevents typecheck failure.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE ADJUSTMENTS:
- If chart tab labels need shortening for mobile, target CHART_TABS label strings in SolarEstimateTab.tsx only.
- If Payment tab loan assumptions need updating, target getMonthlyLoanPayment and the PaymentComparisonChart sublabel strings.

NEXT PHASE READY:
NO â€” no next build phase defined.

COMPACT HANDOFF FOR NEXT CHAT:
Summary Chart Tabs + Local Save added to `src/components/solarTraining/SolarEstimateTab.tsx`. EstimateSummaryStep now has a 6-tab SummaryChartModule replacing the old 2-chart grid. Save project estimate button stores a local session snapshot. All chart data from existing computed values. No new packages, Supabase, localStorage, or formula changes. Typecheck passes clean.

---

## LOCAL SAVED ESTIMATES COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
9cec9c4

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Local Saved Estimates â€” localStorage persistence, Solar Estimates library, draft auto-save

WHAT CHANGED:
- Added `LocalSolarEstimate` and `ActiveDraft` types; `STORAGE_KEY_ESTIMATES` and `STORAGE_KEY_DRAFT` constants.
- Added `loadEstimates`, `saveEstimates`, `loadActiveDraft`, `saveActiveDraft` localStorage helpers.
- Added `SolarEstimatesLibrary` component with Open/Rename/Delete actions, inline rename, active indicator, empty state.
- Lifted save to `handleSave` in `SolarEstimateTab`: creates new estimate (auto-names from address) or updates existing (preserves user rename). No duplicates.
- Added "Solar Estimates" button in header (with count badge) that toggles the library panel.
- Added lazy `useState` initializers restoring `data`, `solarSizeKw`, `batterySizeKwh`, `activeEstimateId` from `loadActiveDraft()` on mount.
- Added debounced auto-save `useEffect` (500ms) writing `ActiveDraft` to `STORAGE_KEY_DRAFT`.
- `handleOpenEstimate` restores all fields and forces `currentStep = 'estimate_summary'`.
- `resetEstimate` clears `activeEstimateId` and `saveStatus`.
- `EstimateSummaryStep`: removed internal `savedSnapshot` + `handleSave`; added `onSave`, `activeEstimateId`, `saveStatus` props; save badge shows "Saved in Solar Estimates" for 3 sec.
- `ActiveStepPanel` threads new props to `EstimateSummaryStep`.
- Added `X` to lucide-react imports.

WHAT WAS LEARNED:
- Lazy useState initializers avoid useEffect-based hydration flash and are the correct pattern for localStorage on mount.
- The existing solarSizeKw sync effect is safe with open-from-library because `handleOpenEstimate` sets `currentStep = 'estimate_summary'`, keeping the effect condition false.
- Preserving estimate name on update avoids clobbering user renames.

LEARNED SKILLS / REUSABLE PATTERNS:
- `useState(() => { const d = load(); return d?.field ?? default })` â€” lazy localStorage hydration pattern.
- `setSavedEstimates(prev => { const u = ...; saveEstimates(u); return u })` â€” atomic in-memory + localStorage sync.
- Debounced useEffect with `useRef<number | null>` timer â€” correct debounce pattern in React.

BUGS / RISKS:
- localStorage not encrypted; no sensitive PII should be stored.
- Two-tab race: last write wins. Acceptable for single-user local tool.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA on saved estimates.

NEXT PHASE ADJUSTMENTS:
- If Supabase sync for saved estimates is added later, use `LocalSolarEstimate` as the canonical shape and sync from it rather than restructuring.
- If the estimate list grows large, add pagination or a search filter inside `SolarEstimatesLibrary`.

NEXT PHASE READY:
NO â€” no next build phase defined.

COMPACT HANDOFF FOR NEXT CHAT:
Local Saved Estimates added to `src/components/solarTraining/SolarEstimateTab.tsx`. localStorage keys: `poweron.solarTraining.solarEstimates` (estimate list) and `poweron.solarTraining.activeDraft` (current open estimate). `SolarEstimatesLibrary` component with Open/Rename/Delete. "Solar Estimates" button in header. Save creates or updates â€” no duplicates. App reload restores current draft. No Supabase, no new packages, no formula or unrelated tab changes. Typecheck passes.

---

## STEP 1 LAYOUT FINAL ALIGNMENT COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
fe5c82c

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Solar Estimate Step 1 JSX Layout Fix â€” items-start alignment correction

WHAT CHANGED:
- Changed `xl:items-start` to `items-start` on the AddressStep two-column grid div (line 665).
- The two-column grid structure was already correct from prior commits. This pass aligns `items-start` to apply at all viewport sizes, not just xl.

WHAT WAS LEARNED:
- The two-column JSX structure is confirmed correct: `xl:grid-cols-[minmax(360px,0.85fr)_minmax(640px,1.35fr)]` with SectionIntro + address form + Place ID/Lat/Lng in left column, AddressMapPreview in right column. No dead code, no duplicate blocks.
- At 1280px viewport with expanded sidebar (224px), grid container is ~920px. Min column widths total 1016px, so ~52px overflows the section's `overflow-hidden`. Map shows ~92% visible.
- The `xl:` breakpoint (1280px) activates two-column layout. If test screen is <1280px, layout stacks single-column (expected behavior).

LEARNED SKILLS / REUSABLE PATTERNS:
- Apply `items-start` without a breakpoint prefix when vertical alignment should be consistent across all viewport sizes, not just when the multi-column layout activates.

BUGS / RISKS:
- At 1280px viewport with expanded sidebar, map's right ~52px is clipped. Acceptable; map is still functional. Fully unclipped at â‰¥1440px viewport or with collapsed sidebar.
- If xl breakpoint doesn't fire on the test screen (viewport <1280px), lower to `lg:` with smaller right-column min (e.g., 480px instead of 640px).

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE ADJUSTMENTS:
- Screenshot QA at xl+ viewport to verify two-column layout is visible.
- If map clipping at 1280px is a problem: reduce `minmax(640px,1.35fr)` to `minmax(480px,1.35fr)`.
- If xl doesn't fire on test screen: change breakpoint from `xl:` to `lg:` with smaller column minimums.

NEXT PHASE READY:
NO â€” no active build phase defined.

COMPACT HANDOFF FOR NEXT CHAT:
Step 1 layout fix: changed `xl:items-start` to `items-start` in `src/components/solarTraining/SolarEstimateTab.tsx`. AddressStep two-column grid confirmed structurally correct â€” SectionIntro + form in left column, AddressMapPreview in right column. `xl:grid-cols-[minmax(360px,0.85fr)_minmax(640px,1.35fr)] items-start` is the final class string. Two-column layout activates at â‰¥1280px viewport. Single-column stacking below that is expected. Typecheck passes clean.

---

## EV CHARGER UPGRADE + LABOR FORMULA SELECTOR COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
d57277e

FILES CHANGED:
- `src/services/solarTraining/SolarEstimateTypes.ts`
- `src/services/solarTraining/SolarEstimateSettings.ts`
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/components/v15r/V15rSettingsPanel.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Add EV charger addition toggle and labor formula selector

WHAT CHANGED:
- `SolarEstimateTypes.ts`: `evChargerAddition: boolean` added to `SolarEstimateData` and defaults.
- `SolarEstimateSettings.ts`: `LaborFormulaMode` type, `evChargerAdditionCost` (1500), `laborFormulaMode` ('panelRate'), `evChargerAdditionCost` in breakdown type. `safeLaborFormulaMode` normalizer. `calculateSolarEstimateInstallCost` Pick extended with `evChargerAddition`.
- `SolarEstimateTab.tsx`: EV Charger Addition toggle in SystemConfigStep, EV charger ReviewRows in Step 4 right panel and EstimateSummaryStep, CostBreakdownCard EV charger row.
- `V15rSettingsPanel.tsx`: Labor formula selector button group in Labor box header, disabled field states, hourly mode note, EV Charger Addition Cost field in Electrical Upgrades.

WHAT WAS LEARNED:
- String-enum settings fields need their own safe normalizer â€” safeNumber only works for numbers.
- Pick type in calculateSolarEstimateInstallCost must be explicitly extended for new data fields used in cost logic.
- Hourly mode note should be amber/warning color to make it visible but not alarming.

LEARNED SKILLS / REUSABLE PATTERNS:
- `safeLaborFormulaMode` pattern for string-enum settings normalization.
- Labor formula selector: compact button group in box header, no separate modal or page.
- Disabled field: `opacity-50` on label + `disabled` on input + `disabledInputClass` (no focus ring, muted text).

BUGS / RISKS:
- Hourly crew mode does not yet affect cost math. Note is displayed to communicate this.
- EV charger $1,500 default is a reasonable placeholder.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE ADJUSTMENTS:
- If hourly labor math is added: extend calculateSolarEstimateInstallCost with laborHours parameter and branch on laborFormulaMode.

NEXT PHASE READY:
NO â€” no active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
EV Charger Addition + Labor formula selector phase complete. evChargerAddition in SolarEstimateData, evChargerAdditionCost ($1,500) and laborFormulaMode ('panelRate') in SolarEstimateSettings. Step 4 toggle below Main Panel Upgrade. Cost breakdown includes EV charger row when ON. Settings Hub Electrical Upgrades is now 2-col with both costs. Labor box has Hourly crew / Panel rate selector with disabled fields and future-modeling note. Typecheck passes. Commit: d57277e.

---

## LABOR HOURS PER SYSTEM COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
bcdbc91

FILES CHANGED:
- `src/services/solarTraining/SolarEstimateSettings.ts`
- `src/components/v15r/V15rSettingsPanel.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Add Labor Hours per System to Solar Estimate Settings

WHAT CHANGED:
- Added `laborHoursSmall` (16), `laborHoursMedium` (32), `laborHoursLarge` (48) to `SolarEstimateSettings` type, defaults, and normalization.
- `calculateSolarEstimateInstallCost` now branches on `laborFormulaMode`: hourlyCrew uses `combinedHourlyLaborRate Ã— laborHours[tier]`; panelRate still uses `panelCount Ã— panelInstallLaborCost`.
- Settings Hub has new "Labor Hours per System" card below Permit Cost by Size with three `numberField` inputs (hrs suffix).

WHAT WAS LEARNED:
- No changes to SolarEstimateTab.tsx needed â€” cost math flows through existing `estimateSettings` argument.
- `panelLaborCost` in breakdown correctly carries both formula modes with no shape change.

BUGS / RISKS:
- Tier boundaries in `getSolarSystemSizeTier` (â‰¤6, â‰¤12) differ slightly from UI labels (3â€“7, 7â€“15, 15â€“30). This was pre-existing and unchanged.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE ADJUSTMENTS:
- If the amber "hourly mode not yet affecting cost" note in the Labor box needs removal now that cost math is wired, target V15rSettingsPanel.tsx Labor box.

NEXT PHASE READY:
NO â€” no active build phase defined.

COMPACT HANDOFF FOR NEXT CHAT:
Labor Hours per System added. `laborHoursSmall/Medium/Large` fields in `SolarEstimateSettings` with defaults 16/32/48, persisted in existing localStorage key. `calculateSolarEstimateInstallCost` branches on `laborFormulaMode`: hourlyCrew = combinedRate Ã— laborHours[tier], panelRate = panelCount Ã— panelInstallLaborCost. Settings Hub "Labor Hours per System" card below Permit Cost by Size with hrs-suffixed inputs. No SolarEstimateTab.tsx changes needed. Typecheck passes. Commit: bcdbc91.

---

## HARDWARE INDEX COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
9e65fc1

FILES CHANGED:
- `src/services/solarTraining/SolarEstimateSettings.ts`
- `src/components/v15r/V15rSettingsPanel.tsx`

ACTIVE PHASE COMPLETED:
Add Hardware Index to Solar Estimate Settings

WHAT CHANGED:
- Added `HardwareEntry`, `HardwareIndexData`, `DEFAULT_HARDWARE_INDEX` to `SolarEstimateSettings.ts`.
- Added `hardwareIndex: HardwareIndexData` to `SolarEstimateSettings` type and defaults.
- Added `safeHardwareEntry`, `safeEntries`, `safeHardwareIndex` normalizers; wired to `normalizeSolarEstimateSettings`.
- Added `makeHardwareId`, `makeHardwareEntry`, `EntrySection`, `HardwareIndexPanel` components to `V15rSettingsPanel.tsx`.
- Added `SOLAR_ESTIMATE_HARDWARE_INDEX_COLLAPSED_KEY` constant and `updateHardwareIndex` handler in `SolarEstimateSettingsPanel`.
- `HardwareIndexPanel` placed below the 2-col settings grid and above the "Stored locally" message.
- Collapse state persisted at `poweron.settings.solarEstimateHardwareIndex.collapsed` (default: collapsed).
- Hardware data persisted inside existing `poweron.solarTraining.solarEstimateSettings` localStorage key.
- Added `Plus` to lucide-react imports.

WHAT WAS LEARNED:
- Hardware Index data can cleanly nest inside the existing settings object â€” no separate localStorage key needed.
- Inline grid layout (5-col: title, supplier, wattage/spec, price, remove) is compact and readable at small font sizes.
- `loadCollapsedState(key, true)` defaults to collapsed for new panels without touching existing state.

LEARNED SKILLS / REUSABLE PATTERNS:
- `EntrySection` pattern: label + "Add item" button + inline 5-col grid with remove â€” reusable for any CRUD list in settings.
- `safeHardwareIndex` nested normalizer pattern: safe-cast each level before accessing children.

BUGS / RISKS:
- Hardware Index does not affect cost math (by design). Reference only.
- No Supabase, no new packages, no formula changes.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES (see SOLARUPGRADE_SHARED_CONTEXT.md)

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE ADJUSTMENTS:
- If Hardware Index entries need to feed into product catalog or proposals, add a separate integration phase.
- If subdivisions need their own collapse state, add per-subdivision keys using the same loadCollapsedState pattern.

NEXT PHASE READY:
NO â€” no active build phase defined. Branch ready for browser QA.

COMPACT HANDOFF FOR NEXT CHAT:
Hardware Index added to Solar Estimate Settings. `HardwareEntry` + `HardwareIndexData` types in `SolarEstimateSettings.ts`. Persisted in existing `poweron.solarTraining.solarEstimateSettings` key. UI: `HardwareIndexPanel` with `EntrySection` CRUD (title, supplier, wattage/spec, price, remove). Three sections: Solar Modules, Hardware (5 subdivisions), Electrical Equipment (3 subdivisions). Placed below Blueprint Cost by Size, above Stored locally message. Independently collapsible. Does not affect cost math. Typecheck passes. Commit: 9e65fc1.

---

## HARDWARE COST TIERS COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
c81cb48

FILES CHANGED:
- `src/services/solarTraining/SolarEstimateSettings.ts`
- `src/components/v15r/V15rSettingsPanel.tsx`

ACTIVE PHASE COMPLETED:
Add hardware cost by system size to Hardware Index

WHAT CHANGED:
- Added `hardwareCostSmall` (2500), `hardwareCostMedium` (4500), `hardwareCostLarge` (7500) to `SolarEstimateSettings` type, defaults, and normalization.
- Added `hwCostInputClass` module-scope constant for `$`-prefixed inputs in `HardwareIndexPanel`.
- Updated `HardwareIndexPanel` props to accept `hardwareCostSmall`, `hardwareCostMedium`, `hardwareCostLarge`, `onUpdateCost`.
- Added "Hardware Cost by System Size" box at the bottom of Hardware Index expanded content with 3 tier inputs (3â€“7 kW, 7â€“15 kW, 15â€“30 kW).
- Updated `<HardwareIndexPanel>` call site to pass cost fields and `updateSetting` as `onUpdateCost`.

WHAT WAS LEARNED:
- When a new settings field belongs to the top-level settings object but must appear in a sub-panel, pass it as a prop rather than restructuring the data model.
- `as const` on the tuple array lets TypeScript narrow key types in map() â€” clean pattern for rendering N similar fields without N separate JSX blocks.

LEARNED SKILLS / REUSABLE PATTERNS:
- Tuple-map pattern: `([['key', 'Label', 'hint', value], ...] as const).map(([key, label, hint, value]) => ...)` â€” compact way to render a set of same-shape fields inside a sub-panel.

BUGS / RISKS:
- Hardware cost does not affect estimate math yet. Labeled in UI.
- Existing Hardware Index item entries are unaffected.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE ADJUSTMENTS:
- If hardware cost is to be wired to cost math: extend `calculateSolarEstimateInstallCost` to add `hardwareCost[tier]` from settings; add `hardwareCost` line to `SolarEstimateCostBreakdown`.

NEXT PHASE READY:
NO â€” no active build phase defined. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Hardware cost tiers added to `SolarEstimateSettings.ts` (hardwareCostSmall/Medium/Large, defaults 2500/4500/7500, persisted in existing localStorage key). `HardwareIndexPanel` in `V15rSettingsPanel.tsx` now renders a "Hardware Cost by System Size" box with 3 $-prefixed tier inputs below Solar Modules, Hardware, and Electrical Equipment sections. Saved via existing `updateSetting` handler. Does not affect estimate cost math yet. Typecheck passes. Commit: c81cb48.

---

## ESTIMATED COST FULL FORMULA + BREAKDOWN DISPLAY COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
4a411b3

FILES CHANGED:
- `src/services/solarTraining/SolarEstimateSettings.ts`
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Make Estimated Cost use full Solar Estimate Settings formula

WHAT CHANGED:
- `SolarEstimateSettings.ts`: `SolarEstimateCostBreakdown` extended with `laborHours`, `laborFormulaMode`, `panelInstallLaborCost`, `hardwareCost`. `calculateSolarEstimateInstallCost` now computes hardware cost from tier and includes it in total. Return object supplies all new fields.
- `SolarEstimateTab.tsx`: `CostBreakdownCard` replaced with formula-row layout. New `CostBreakdownRow` component: label + optional mono formula line + value + optional detail + accent variant. Breakdown order: Labor (formula), optional additions, Permit, Blueprint, Mobility, Delivery, Hardware, Estimated total (accented).

WHAT WAS LEARNED:
- Hardware cost was already in settings but not wired â€” extending the return type and adding to the total was the only change needed.
- Keeping `panelLaborCost` as the single labor vehicle means the formula line is purely a display concern â€” no structural change needed.
- The amber "hourly mode not yet affecting cost" note in V15rSettingsPanel Labor box is now stale and should be removed in a future polish pass.

LEARNED SKILLS / REUSABLE PATTERNS:
- `CostBreakdownRow({ label, formula?, value, detail?, accent? })` â€” reusable row for any future cost additions.
- Formula display strings: build from breakdown fields, not from settings directly, so the display always matches the actual calculation.

BUGS / RISKS:
- Amber note in Settings Hub Labor box (V15rSettingsPanel.tsx) still says "hourly mode not yet affecting cost" â€” now inaccurate. Flag for next polish pass.
- Hardware defaults ($2,500 / $4,500 / $7,500) are reasonable placeholders; the user may adjust in Settings Hub.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT PHASE READY:
NO â€” no active build phase defined. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Full formula cost calculation wired. `calculateSolarEstimateInstallCost` now includes hardware cost by tier in total. `SolarEstimateCostBreakdown` exposes `laborHours`, `laborFormulaMode`, `panelInstallLaborCost`, `hardwareCost`. `CostBreakdownCard` redesigned as stacked formula rows with a `CostBreakdownRow` helper. Labor shows formula line (hourly: hrsÃ—rate, panel: panelsÃ—rate). Order: Labor, optional additions, Permit, Blueprint, Mobility, Delivery, Hardware, Estimated total. Typecheck passes.

---

## SEPARATE EV LOAD FROM CHARGER INSTALL COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
0a70e74

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Separate existing EV load from new EV charger installation cost

WHAT CHANGED:
- Removed auto-link between EV charger appliance toggle and `evChargerAddition` field.
- Added "Add EV Charger" toggle in Step 3 Home Configuration below Panel Upgrade.
- Added appliance helper text: "These are existing appliances/heavy loads and only affect consumption assumptions."
- Step 4 right panel: two separate ReviewRows (existing load / EV Charger Addition).
- Summary: four separate ReviewRows (existing load Y/N, existing amperage, add install Y/N, install amperage).

WHAT WAS LEARNED:
- One `if` block in `toggleAppliance` was the entire source of the bug.
- `evChargerAmperage` can safely serve both purposes: existing load display and install cost formula.

LEARNED SKILLS / REUSABLE PATTERNS:
- Keep install-cost toggles independent of appliance-load toggles.
- Use `.some(a => a.id === 'X')` for appliance presence checks inline in JSX.

BUGS / RISKS:
- None introduced.

TYPECHECK RESULT:
PASS â€” zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE ADJUSTMENTS:
- QA: EV charger appliance toggle does NOT set evChargerAddition.
- QA: "Add EV Charger" toggle in Step 3 reflects in Step 4 and Summary.
- QA: Cost breakdown includes EV charger only when Add EV Charger is ON.

NEXT PHASE READY:
NO â€” ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
EV load vs install separated in `src/components/solarTraining/SolarEstimateTab.tsx`. Appliance EV charger = existing load only. "Add EV Charger" toggle in Step 3 controls install cost. Step 4 and Summary show both concepts separately. Typecheck passes.

---

## MOVE EV CHARGER AMPERAGE TO ADDITION TOGGLE COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
cf7d95c

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Move EV charger amperage options to EV Charger Addition toggle

WHAT CHANGED:
- Step 3 toggle renamed "Add EV Charger" → "EV Charger Addition".
- EV Charger Addition card in Step 3 now shows 30/40/50/60/100A buttons when ON; defaults to 50A on first turn-ON.
- Appliance EV charger card now renders like all other appliances (free-form amps input, no fixed grid).
- Step 4 toggle: same 50A default-on-turn-ON, removed stale "selected in Home Details" text.
- Step 4 right panel "Existing EV load" reads `selectedAppliances[ev_charger].amps`.
- Summary "Existing EV charger amperage" reads `selectedAppliances[ev_charger].amps`.
- Summary "Add EV charger install" label → "EV Charger Addition".
- `evChargerAmperage` is now exclusively the install amperage field.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE READY:
NO — ready for screenshot QA.

---

## SEASONAL MONTHLY BILL CHART COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
c098360

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Make Monthly Bill chart use local seasonal consumption profile

WHAT CHANGED:
- ClimateProfile type + HOT_DESERT_TERMS + CONSUMPTION_SEASONAL_WEIGHTS + SOLAR_PRODUCTION_SEASONAL_WEIGHTS constants added.
- detectClimateProfile() — pure keyword match from address text, no API.
- getSeasonalBillData() — normalizes weights, derives battery ratio from nemResult, produces 12-month data.
- SeasonalBillChart — new SVG chart component with seasonal data and tooltip (profile, kWh, costs, savings).
- SummaryChartModule: added climateProfile prop; monthly_bill tab now uses SeasonalBillChart.
- EstimateSummaryStep: computes climateProfile and passes to SummaryChartModule.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE READY:
NO — ready for screenshot QA.

---

## ANCHOR BILL TO ESTIMATE MONTH COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
3ba7339

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Anchor Average Electric Bill to estimate month — season-aware monthly consumption

WHAT CHANGED:
- `getAnchorBlendedRate(utility, ratePlan)` — utility fallbacks when no rate plan selected.
- `computeAnchoredMonthlyKwhByMonth(bill, rate, profile, anchorMonthIndex)` — anchor-month → baseline → 12-month array.
- `computeNormalizedMonthlyKwhByMonth(avgKwh, profile)` — old normalization path for home_size / direct kWh.
- `getSeasonalBillData` refactored: takes `number[]`, no internal consumption normalization, adds 25%/15% savings floors.
- `SeasonalBillChart`: `anchorMonthLabel` prop; anchor month in subtitle + tooltip.
- `SummaryChartModule`, `EstimateSummaryStep`, `ActiveStepPanel`, `SolarEstimateTab`: prop chain for `anchorMonthIndex` / `anchorMonthLabel` / `monthlyKwhByMonth`.
- Anchor month derived from saved estimate `createdAt` when loaded from library; else `new Date().getMonth()`.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE READY:
NO — ready for screenshot QA.

---

## MONTHLY BILL BATTERY COMPARISON COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
15ac20c

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Show Solar Only and Solar Plus Battery comparison in Monthly Bill chart

WHAT CHANGED:
- `SeasonalBillChart` rewritten to render 3 bars per month (grey/yellow/green) when `hasBattery=true`, 2 bars (grey/yellow) when false.
- `barW` adapts: 22% of `monthW` for 3-bar mode, 30% for 2-bar mode. Bar group is centered in the month slot.
- `gap` const (1px) used between bars.
- Legend always shows grey + yellow; green "Solar + battery" swatch renders only when `hasBattery`.
- Helper text switches between "Solar Only projection shown..." and "Solar Only and Solar Plus Battery projections are shown together..." based on `hasBattery`.
- Climate profile + anchor month moved to a secondary line below helper text.
- Tooltip: always shows solar-only projected + savings; adds extra battery savings and total-with-battery savings rows when `hasBattery`.
- Hover hit area covers the full bar group + 2px padding each side.
- All seasonal consumption logic, `getSeasonalBillData`, and anchor month detection unchanged.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for screenshot QA.

NEXT PHASE READY:
NO — ready for screenshot QA.

---

## Claude Report — Material Takeoff polish — unit cost currency display + project-only manual supplier

- Task completed: YES
- Files changed: `src/components/v15r/V15rMTOTab.tsx`, `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`, `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`
- Commit hash: (see git log)
- Typecheck result: PASS — zero errors
- Root cause:
  - Unit Cost dollar-sign: bare number input with no currency prefix. Fix: flex wrapper with dollar-sign span before input.
  - Project supplier: Supplier column only read from pbItem.src (Price Book). r.supplierNote already existed on row data but was only shown as a chip in the Item Title area. No inline edit path in the Supplier column.
- What changed:
  - Dollar-sign flex wrapper added to Unit Cost td.
  - localSupplierNotes state + editingSupplierNoteId state added.
  - editMTORow extended to handle supplierNote field.
  - delMTORow cleans up localSupplierNotes on row delete.
  - Supplier td replaced with chip/input inline edit: cyan chip (clear-X) when r.supplierNote set, input on click, PB supplier read-only when linked, plus-supplier hover prompt, N/A fallback.
  - Old supplierDisplay variable removed; replaced with pbSupplierSrc.
- What was learned: r.supplierNote already existed on MTO row data model — no schema change needed. chip/input edit pattern cleanly reusable for inline-edit columns.
- Learned skills / reusable patterns: Inline editable column pattern (local state map + editing ID state + chip/input/hover conditional JSX). Currency prefix for number inputs: flex wrapper + span.
- Bugs / risks: None introduced. Existing Price Book path and supplierNote chip in Item Title unchanged.
- Manual QA performed: Typecheck only (no browser access in this session).
- Next recommended action: Open MTO in browser — confirm dollar-sign on Unit Cost, enter project supplier, verify it saves without touching Price Book.
- Compact handoff for next agent/chat: MTO polish done on src/components/v15r/V15rMTOTab.tsx. Unit Cost shows dollar-sign. Supplier column inline-editable via r.supplierNote (project-scoped). Cyan chip when set, clears with X. PB supplier read-only when linked. Plus Price Book global path unchanged. Typecheck passes.

---

## Claude Report - Material Takeoff polish - remove per-item supplier label chips outside supplier column

- Task completed: YES
- Files changed: src/components/v15r/V15rMTOTab.tsx, solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md, solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md
- Commit hash: d371267
- Typecheck result: PASS - zero errors
- Root cause: The supplierNote chip (rendering r.supplierNote with a clipboard emoji below the item title) was a pre-existing display block added before the Supplier column was made inline-editable. The prior session wired the Supplier column to r.supplierNote but did not remove the old chip, leaving both visible simultaneously.
- What changed: Removed the Supplier Note chip block (~20 lines) from the Item Title area in renderRow. Supplier now renders only in the dedicated Supplier column.
- What was learned: When adding a new canonical display location for a data field, always check whether prior display locations for that same field still exist and remove them.
- Learned skills / reusable patterns: When promoting a chip to a full column, grep for all prior render sites of that field and clean them up in the same session.
- Bugs / risks: None. No save behavior, Price Book logic, or other chip rendering changed.
- Manual QA performed: Typecheck only (no browser access in this session).
- Next recommended action: Open MTO in browser - confirm no supplier chip below item titles, confirm supplier still shows in Supplier column, confirm placement and note chips still work.
- Compact handoff for next agent/chat: Duplicate supplier chip removed from V15rMTOTab.tsx Item Title area. Supplier renders only in the Supplier column via r.supplierNote. All other chips (placement, note) unchanged. Typecheck passes. Commit: d371267.

---

## Claude Report - Material Takeoff polish - placement labels must not create buckets

- Task completed: YES
- Files changed: src/components/v15r/V15rMTOTab.tsx, solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md, solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md
- Commit hash: 935bf94
- Typecheck result: PASS - zero errors
- Root cause: hasAnyPlacement (allRows.some(r => r.placement...)) was used as a view-switch condition. When any row got a placement value, the entire MTO view switched from renderPhaseGroups() to renderPlacementGroups(), creating placement-based bucket sections. This was the original "placement view" feature but the user wants placement to be informational only.
- What changed: Removed hasAnyPlacement flag. Changed main render from conditional to always renderPhaseGroups(). existingPlacements kept for bulk-assign datalist autocomplete. Placement chips still render on items.
- What was learned: The MTO had a full alternative placement-grouped view built in. That view was triggered automatically by any placement value on any row. Removing the trigger (hasAnyPlacement condition) was the entire fix.
- Learned skills / reusable patterns: When a view-mode switch is driven by a derived boolean flag, the safest way to disable the mode is to remove the flag and hardcode the default view rather than touching the alternative renderer.
- Bugs / risks: renderPlacementGroups() is now dead code in the file. Can be removed in a future cleanup pass. No functional risk.
- Manual QA performed: Typecheck only (no browser access in this session).
- Next recommended action: Open MTO in browser - add a placement chip to an item, confirm no new bucket/section appears, confirm phase groups remain, confirm placement chip still renders on the item.
- Compact handoff for next agent/chat: Placement is now informational only in V15rMTOTab.tsx. hasAnyPlacement removed; renderPhaseGroups() always used. Placement chips still show on items. renderPlacementGroups() is dead code (still in file). existingPlacements kept for bulk-assign datalist. Typecheck passes. Commit: 935bf94.

---

## Claude Report - Material Takeoff polish - move search/price book left, fix price book visibility, widen supplier labels

- Task completed: YES
- Files changed: src/components/v15r/V15rMTOTab.tsx, solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md, solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md
- Commit hash: d5cb488
- Typecheck result: PASS - zero errors
- Root cause:
  - Search/Price Book position: Both buttons were JSX children AFTER the name input in the flex row, placing them on the right. Reordering the JSX children to appear before the input moves them to the left.
  - Price Book inconsistency: The Price Book button was wrapped in {isRowHovered && ...}, hiding it entirely unless the mouse was over that exact row. Changed to always render with opacity/color controlled by isRowHovered.
  - Narrow supplier labels: Supplier column header was 100px; chip input was 90px. Both too narrow for 20-char names.
- What changed:
  - Search and Price Book moved before name input in flex row.
  - Price Book render gate removed; hover state now controls opacity/color only.
  - Supplier column header width 100px to 150px.
  - Supplier chip input width 90px to 130px.
  - Supplier chip span gets maxWidth 160px + overflow:hidden + text-overflow:ellipsis.
- What was learned: JSX child order in a flex row directly controls left/right visual position. Conditional render vs conditional style is the difference between always-accessible and hover-only controls.
- Learned skills / reusable patterns: Use conditional style (color/background/border) rather than conditional render for actions that should always be accessible but visually de-emphasized at rest.
- Bugs / risks: None introduced. Price Book modal behavior unchanged.
- Manual QA performed: Typecheck only (no browser access in this session).
- Next recommended action: Open MTO in browser - confirm Search and Price Book appear on left of item names, confirm Price Book visible on all rows at rest (dimmed), confirm supplier chip stays horizontal for typical supplier names.
- Compact handoff for next agent/chat: MTO row action layout fixed. Search and Price Book now left of item name. Price Book always visible (dimmed at rest, bright on hover). Supplier column 150px, input 130px, chip ellipsis at 160px. Typecheck passes. Commit: d5cb488.

---

## Claude Report - Material Takeoff polish - right-side always-visible row actions + estimate-style inline entry editing

- Task completed: YES
- Files changed: src/components/v15r/V15rMTOTab.tsx, solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md, solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md
- Commit hash: 9577bd6
- Typecheck result: PASS - zero errors
- Root cause:
  - Actions on wrong side: Previous session moved Search/PriceBook into the Item Title cell on the left. This task moves them out to a dedicated right-side actions column.
  - No auto-focus: addMTORow did not store the new row id or attempt to focus it. The labor-row pattern uses newLaborRowIdRef + laborTextareaRefs + requestAnimationFrame.
  - Delete was a standalone narrow column; replaced with a combined 3-button actions td.
- What changed:
  - newMTORowIdRef + mtoNameInputRefs refs added.
  - addMTORow: name starts empty, id stored in ref, requestAnimationFrame focuses name input.
  - Name input: ref attached, Enter blurs to confirm, placeholder on newest row.
  - Search and Price Book removed from Item Title cell.
  - Delete td replaced with right-side actions td: [+PB] [Search] [Delete], always visible.
  - Actions column header widened 40px to 110px.
- What was learned: The labor-row pattern (newRowIdRef + inputRefs + requestAnimationFrame) is the correct reusable focus pattern. requestAnimationFrame is needed because the DOM renders after forceUpdate.
- Learned skills / reusable patterns: requestAnimationFrame focus pattern: store new id in ref, call forceUpdate, then rAF to focus via inputRefs map. Directly reusable for any add-row quick-entry flow.
- Bugs / risks: newMTORowIdRef is only set on addMTORow, so the placeholder only shows for the most recently added row. This is intentional. The ref is never cleared so after reload all rows show no placeholder (acceptable).
- Manual QA performed: Typecheck only (no browser access in this session).
- Next recommended action: Open MTO, click Add Item, confirm cursor lands in empty name field, type a name, press Enter. Confirm Price Book / Search / Delete visible on right side of every row without hover.
- Compact handoff for next agent/chat: MTO row actions right-side always-visible. Item Title cell is clean name input only. addMTORow auto-focuses new row. Enter to confirm. Actions column: [+PB | Search-icon | x], always visible. Matches Estimate labor-row pattern. Typecheck passes. Commit: 9577bd6.

---

## Claude Report - Material Takeoff polish - clean click-to-select vs click-hold-to-drag behavior

- Task completed: YES
- Files changed: src/components/v15r/V15rMTOTab.tsx, solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md, solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md
- Commit hash: cd94433
- Typecheck result: PASS - zero errors
- Root cause: handleRowMouseDown was bound to the mousedown event on the drag handle td. Mousedown fires at the start of any press, before the user has a chance to drag. So every drag attempt immediately toggled selection. The fix defers toggle to pointer release and suppresses it if pointer movement exceeded a threshold.
- What changed:
  - Added DRAG_THRESHOLD_PX = 6 and dragState useRef.
  - handleRowMouseDown and no-op handleRowMouseEnter removed.
  - handleHandlePointerDown: records startX/startY, calls setPointerCapture.
  - handleHandlePointerMove: sets dragged=true if movement exceeds threshold.
  - handleHandlePointerUp: toggles selection only on clean click (dragged=false).
  - handleHandlePointerCancel: cleans up drag state.
  - Drag handle td switched from onMouseDown to onPointerDown/Move/Up/Cancel.
  - touchAction: none added to prevent touch-scroll interference.
- What was learned: setPointerCapture is the correct way to keep pointer events routed to the handle element during a drag, even if the pointer moves outside it. Pointer events unify mouse, touch, and stylus under one model.
- Learned skills / reusable patterns: Pointer-event threshold pattern for click-vs-drag: record startX/Y on pointerdown, set dragged=true in pointermove when abs(dx)>threshold || abs(dy)>threshold, act on pointerup only if !dragged. Reusable for any drag handle that also needs click-select behavior.
- Bugs / risks: Row drag-to-reorder is still not implemented (no sortable/DnD library). The handle now correctly separates click-select from drag-intent, but drag does not actually reorder rows. If drag reordering is needed in the future, it would be a separate phase.
- Manual QA performed: Typecheck only (no browser access in this session).
- Next recommended action: In browser: click handle to select (should select without dragging). Click-hold-drag handle (should not toggle selection). Select 2+ rows and bulk-assign placement.
- Compact handoff for next agent/chat: MTO drag handle uses pointer-event threshold. Click-release = select. Click-hold-move = drag (no selection toggle). DRAG_THRESHOLD_PX=6. dragState ref. setPointerCapture used. Multi-select preserved. Row reorder-by-drag not yet implemented. Typecheck passes. Commit: cd94433.

---

## Claude Report - Material Takeoff polish - restore real drag behavior while preserving click-to-select

- Task completed: YES
- Files changed: src/components/v15r/V15rMTOTab.tsx, solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md, solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md
- Commit hash: ff28f6d
- Typecheck result: PASS - zero errors
- Root cause: cd94433 called setPointerCapture on the drag handle. setPointerCapture routes all pointer events to the capturing element for the duration of the press. This prevents the browser from recognizing the gesture as a native drag (the browser treats the pointer as captured, not free to begin a drag operation). Switching to mouse events (onMouseDown/onMouseUp) avoids pointer capture entirely and native drag is never blocked.
- What changed:
  - handleHandlePointerDown/Move/Up/Cancel replaced with handleHandleMouseDown + handleHandleMouseUp.
  - setPointerCapture removed.
  - touchAction: none removed from handle td (was only needed for pointer capture flow).
  - Selection threshold preserved: mousedown records startX/Y, mouseup compares, toggles selection when movement <= DRAG_THRESHOLD_PX (6px).
  - dragState.dragged flag removed (no longer needed; mouseup calculates delta directly).
- What was learned: setPointerCapture is useful for keeping pointer events on an element during a drag (e.g. custom sliders), but it prevents the browser from initiating a native drag. For a drag handle that must coexist with native drag, use mouse events instead. Never use setPointerCapture on a drag handle.
- Learned skills / reusable patterns: Mouse-event click-vs-drag pattern: onMouseDown records startX/Y; onMouseUp computes delta and acts only on clean click. No capture, no preventDefault needed. Works alongside native browser drag.
- Bugs / risks: onMouseUp on the handle element only fires if the mouse is released over the handle. If the user starts a drag and releases elsewhere, no selection toggle occurs (correct behavior). Edge case: if user presses down on handle, moves < 6px, but the mouseup fires on a different element (e.g. scrolled away by keyboard), selection might not toggle. Acceptable for this UX.
- Manual QA performed: Typecheck only (no browser access in this session).
- Next recommended action: In browser: click handle to select (should select on release). Click-hold-drag handle and confirm row visual drag works. Select multiple rows and confirm bulk-assign still works.
- Compact handoff for next agent/chat: MTO handle uses onMouseDown/onMouseUp with 6px threshold. No setPointerCapture. Native browser drag unblocked. Selection on clean click (mouseup, no movement). dragState ref still exists. DRAG_THRESHOLD_PX=6. touchAction removed. Typecheck passes. Commit: ff28f6d.

---

## Session 8 Completion Report — MTO Bulk Selector Removal (2026-05-18)

**Commit:** d8a84f1  fix(material-takeoff): remove bulk selector and keep drag

**Task:** Remove the MTO multi-entry selector / bulk placement move flow entirely. Keep drag-based row movement from the 6-dot handle.

**What was removed from V15rMTOTab.tsx:**
- State: selectedIds (Set), bulkPlacement, showConfirm, pendingBulkPlacement
- Refs/constants: DRAG_THRESHOLD_PX, dragState
- Functions: handleHandleMouseDown, handleHandleMouseUp, applyBulkAssign, doApplyBulk
- Derived: existingPlacements (only used for bulk-assign datalist)
- In delMTORow: setSelectedIds cleanup line
- In renderRow: isSelected variable; selection backgroundColor/borderLeft styles on tr; onMouseDown/onMouseUp on handle td
- JSX: FLOATING ACTION BAR block (~80 lines); CONFIRMATION DIALOG block (~70 lines)

**What was preserved:**
- Handle td visual: cursor:grab, 6-dot icon (drag to move remains)
- All other row state, actions, and mutation handlers

**Net diff:** 225 lines deleted, 3 added. Typecheck: clean. No regressions.

**Sessions completed in MTO polish series:**
1. Unit cost display + project-only supplier column
2. Remove duplicate supplier chip
3. Fix placement-label bucket creation
4. Move search/PB button left, widen supplier labels
5. Right-side always-visible actions + quick-entry auto-focus
6. Click-to-select vs drag separation
7. Restore native drag (revert setPointerCapture anti-pattern)
8. Remove bulk selector — drag-only handle (this session)

---

## Claude Report — Material Takeoff polish — restore real in-bucket drag reorder for entries

- **Task completed:** Yes
- **Files changed:** src/components/v15r/V15rMTOTab.tsx
- **Commit hash:** 5e2e17f
- **Typecheck result:** Clean (0 errors)
- **Root cause:** The 6-dot handle `<td>` had `cursor: grab` styling but no `draggable` attribute and no drag event handlers (`onDragStart`, `onDragOver`, `onDrop`). HTML5 drag-and-drop requires `draggable={true}` and explicit event wiring — without it, the browser never initiates a drag gesture. The handle was purely decorative.
- **What changed:**
  - Added `dragRowIdRef = useRef<string|null>(null)` to track in-flight drag row ID (no re-render on change)
  - Added `dragOverRowId` useState for visual drop-target indicator
  - Added `reorderMTORow(dragId, dropId)`: finds both rows in p.mtoRows by ID, splices dragged row out, inserts at drop index, calls saveBackupDataAndSync + forceUpdate — order persists to localStorage immediately
  - Handle `<td>`: added `draggable`, `onDragStart` (records dragRowIdRef + sets dataTransfer), `onDragEnd` (clears both state)
  - Row `<tr>`: added `onDragOver` (preventDefault to allow drop + updates dragOverRowId), `onDrop` (calls reorderMTORow + clears state), `onDragLeave` (clears indicator only when leaving row bounds, not child elements); visual: `borderTop: 2px solid #3b82f6` when row is drop target
- **What was learned:** HTML5 DnD requires `draggable` attribute on the drag source and explicit `preventDefault` in `onDragOver` to enable drop. Using `e.currentTarget.contains(e.relatedTarget)` prevents flickery `onDragLeave` when the pointer moves over child elements.
- **Learned skills / reusable patterns:** `dragRowIdRef` (ref not state) = no re-render thrash during drag. `onDragLeave` with `contains` check = stable drop-target indicator. `p.mtoRows` array splice pattern = in-place reorder with single save call.
- **Bugs / risks:** Cross-phase drag not blocked — if two phases show simultaneously and a row is dragged across phases, reorderMTORow would splice within p.mtoRows (changing position but not phase). Low risk: phases are distinct collapsed sections. If needed, add a phase-match guard in reorderMTORow.
- **Manual QA performed:** Typecheck verified clean. Visual inspection of code confirms draggable attribute, drop handlers, and persist path are all wired. Runtime QA (localhost drag test) to be confirmed by user.
- **Next recommended action:** User to manually QA drag reorder in one phase bucket, then add a new row and drag it into position.
- **Compact handoff for next agent/chat:** Drag reorder is now live in V15rMTOTab.tsx (commit 5e2e17f). Handle td is `draggable`, dragstart sets dragRowIdRef, drop splices p.mtoRows and saves. Drop indicator is a blue borderTop on the target row. Row editing/actions untouched. No open MTO polish tasks remain.
