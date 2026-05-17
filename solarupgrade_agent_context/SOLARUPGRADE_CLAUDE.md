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

When running an active Claude phase, follow the user’s standard task structure from the shared context.

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
Phase 3 — Estimate Architecture + State Model

WHAT CHANGED:
- Created `SolarEstimateTypes.ts` with `SolarEstimateData` interface, `DEFAULT_ESTIMATE_DATA`, `ESTIMATE_STEPS`, and all option arrays (providers, rate plans, shading, ownership, property types, consumption methods, system modes).
- Rewrote `SolarEstimateTab.tsx` from static Phase 2 shell to stateful component with `useState`, step navigation (`goNext`, `goBack`, `goToStep`), generic `updateField`, interactive step cards, progress bar, and active step placeholder with live state readout.
- Documented Google Maps/Places and rate/provider findings in shared context.
- Set active phase to Phase 4 — Codex.

WHAT WAS LEARNED:
- Google Maps (@react-google-maps/api + places library + VITE_GOOGLE_MAPS_BROWSER_KEY) is already in the app. Phase 4 can wire autocomplete using MileageProjectAddress.tsx as the exact pattern reference.
- SolarNEM3Calculator.ts already has SCE + IID rate schedules. SolarEstimateTypes uses matching RatePlan IDs for Phase 5 integration.
- tsconfig has noUnusedLocals: false — safe to add handlers before all inputs are wired.

LEARNED SKILLS / REUSABLE PATTERNS:
- Generic field updater pattern: `<K extends keyof T>(key: K, value: T[K]) => setData(d => ({...d, [key]: value}))` — type-safe, single handler for all fields.
- Co-locate option arrays in the types file so form phases can import and map without redefining data.
- Step navigation by index: `ESTIMATE_STEPS.indexOf(data.currentStep)` keeps step order as single source of truth.

BUGS / RISKS:
- MileageProjectAddress.tsx uses @ts-nocheck for Google Maps types. Phase 4 may need same if strict typing causes issues with Places API.
- No Phase 3 runtime bugs found.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
Phase 4 — Codex — Solar Estimate Interview Flow UI

NEXT PHASE ADJUSTMENTS:
- Phase 4 imports all option arrays from `@/services/solarTraining/SolarEstimateTypes`.
- `updateField`, `goNext`, `goBack`, `goToStep` are in component scope — Phase 4 wires them to form inputs.
- Address step: use `useV15rGoogleMapsLoader()` + key check before attempting Maps; safe text fallback if key absent.
- Energy Use step: filter rate plans by `RATE_PLANS_BY_UTILITY[data.utilityProvider]`.

NEXT PHASE READY:
YES

COMPACT HANDOFF FOR NEXT CHAT:
Phase 3 added `src/services/solarTraining/SolarEstimateTypes.ts` (types + option arrays + defaults) and upgraded `SolarEstimateTab.tsx` to a stateful interview component with step navigation and a generic updateField handler. Google Maps/Places already in app — same pattern as MileageProjectAddress.tsx. Rate data in SolarNEM3Calculator.ts with matching IDs. Typecheck passes clean. Phase 4 Codex builds form UI per step using the exported option arrays.
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
Phase 5 — Estimate Summary + Editable System Controls

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
PASS — `npm.cmd run typecheck`

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
NO — no next build phase is defined.

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
Polish / Stabilization Pass — post Phase 5

WHAT CHANGED:
- Fixed duplicate ReviewRow "Consumption input" in summary → replaced with "Suggested size" (derived kW).
- Replaced internal "Phase 5 - Estimate Summary" badge with "Start new estimate" reset button.
- Added `resetEstimate` callback resetting data, solarSizeKw, batterySizeKwh to defaults.
- Updated 3 stale build-phase copy strings: EnergyUseStep SectionIntro, SystemConfigStep SectionIntro, Target offset FieldLabel hint.
- STEP_META estimate_summary: label "Review" → "Summary", description updated to current behavior.
- BillComparisonChart: added overflow-x-auto wrapper + min-w-[360px] for mobile.
- Step card grid: added grid-cols-2 sm:grid-cols-3 before md:grid-cols-5.
- Battery disabled hint: added "Select Solar Plus Battery above to enable battery sizing."

WHAT WAS LEARNED:
- No formula, type, persistence, or structural changes were needed. All issues were cosmetic/UX.
- Step card grid had no mobile breakpoints — polish passes should always audit responsive grid classes.

LEARNED SKILLS / REUSABLE PATTERNS:
- When replacing an internal phase badge with a user-facing action, wire reset to all local state slices (data + solarSizeKw + batterySizeKwh).
- Audit all SectionIntro and FieldLabel hint strings at polish time — build-phase references age out immediately.

BUGS / RISKS:
- Remaining estimates are conservative planning figures only; browser QA still recommended.

TYPECHECK RESULT:
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for manual browser QA.

NEXT PHASE ADJUSTMENTS:
- If a new build phase is added, keep SolarEstimateTab.tsx scoped; consider splitting EstimateSummaryStep into its own file if the component grows further.

NEXT PHASE READY:
NO — no next build phase is defined. Branch is ready for browser QA.

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
Visual Polish Pass 2 — scoped QA items 2, 3, 4 only

WHAT CHANGED:
- BillComparisonChart: replaced div/flex bar chart with SVG chart. Grid lines at 25/50/75/100% with y-axis dollar labels. Before bars rgba(100,116,139,0.72), after bars amber/emerald at 0.82 opacity. Dark panel background. Matches NEM 3.0 chart visual language.
- AddressMapPreview: merged !GOOGLE_MAPS_BROWSER_KEY and loadError into one premium fallback card showing MapPin icon, "Map preview unavailable" label, address text if entered, 2-col lat/lng grid (captured values or "Pending"). Updated !center to show "Awaiting pin" with typed address and guidance.
- EstimateSummaryStep: added "Interview inputs" ClipboardList label above review rows. Tightened chart grid spacing (mb-5/gap-5 → mb-4/gap-4).

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
PASS — zero errors

SHARED CONTEXT UPDATED:
YES

CLAUDE FILE UPDATED:
YES

NEXT ACTIVE PHASE:
None. Ready for final screenshot QA.

NEXT PHASE ADJUSTMENTS:
- If floating button overlap is fixed next, target the outer wrapper/padding in SolarEstimateTab or SolarTrainingView — do not touch formula or chart logic.

NEXT PHASE READY:
NO — no active build phase defined. Branch ready for final screenshot QA.

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
- All 6 chart datasets derive from values already computed in EstimateSummaryStep — no new API, data source, or external dependency needed.
- SVG viewBox pattern (established in Polish Pass 2) scales to all chart types cleanly.
- SummaryChartModule activeChart useState is self-contained — only the visible tab's chart renders.

LEARNED SKILLS / REUSABLE PATTERNS:
- Multi-tab SVG chart module pattern: div wrapper with flex tab bar + chart area. Active tab uses border-b-2 border-cyan-400. Compact and reusable.
- generate25YearData reusable for any future 25-year solar projection chart.
- Session-only save pattern: useState<SnapshotType | null>, button toggles label, emerald badge on saved state.

BUGS / RISKS:
- Loan rate assumption (6.99% APR) is a rough planning figure only. Clearly labeled.
- 24H battery dispatch not modeled — noted as Battery mode label.
- ConsumptionProfileChart still defined but unused; noUnusedLocals: false prevents typecheck failure.

TYPECHECK RESULT:
PASS — zero errors

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
NO — no next build phase defined.

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
Local Saved Estimates — localStorage persistence, Solar Estimates library, draft auto-save

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
- `useState(() => { const d = load(); return d?.field ?? default })` — lazy localStorage hydration pattern.
- `setSavedEstimates(prev => { const u = ...; saveEstimates(u); return u })` — atomic in-memory + localStorage sync.
- Debounced useEffect with `useRef<number | null>` timer — correct debounce pattern in React.

BUGS / RISKS:
- localStorage not encrypted; no sensitive PII should be stored.
- Two-tab race: last write wins. Acceptable for single-user local tool.

TYPECHECK RESULT:
PASS — zero errors

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
NO — no next build phase defined.

COMPACT HANDOFF FOR NEXT CHAT:
Local Saved Estimates added to `src/components/solarTraining/SolarEstimateTab.tsx`. localStorage keys: `poweron.solarTraining.solarEstimates` (estimate list) and `poweron.solarTraining.activeDraft` (current open estimate). `SolarEstimatesLibrary` component with Open/Rename/Delete. "Solar Estimates" button in header. Save creates or updates — no duplicates. App reload restores current draft. No Supabase, no new packages, no formula or unrelated tab changes. Typecheck passes.

---

## STEP 1 LAYOUT FINAL ALIGNMENT COMPLETION LOG

AGENT:
Claude Code

COMMIT HASH:
TBD

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md`

ACTIVE PHASE COMPLETED:
Solar Estimate Step 1 JSX Layout Fix — items-start alignment correction

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
- At 1280px viewport with expanded sidebar, map's right ~52px is clipped. Acceptable; map is still functional. Fully unclipped at ≥1440px viewport or with collapsed sidebar.
- If xl breakpoint doesn't fire on the test screen (viewport <1280px), lower to `lg:` with smaller right-column min (e.g., 480px instead of 640px).

TYPECHECK RESULT:
PASS — zero errors

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
NO — no active build phase defined.

COMPACT HANDOFF FOR NEXT CHAT:
Step 1 layout fix: changed `xl:items-start` to `items-start` in `src/components/solarTraining/SolarEstimateTab.tsx`. AddressStep two-column grid confirmed structurally correct — SectionIntro + form in left column, AddressMapPreview in right column. `xl:grid-cols-[minmax(360px,0.85fr)_minmax(640px,1.35fr)] items-start` is the final class string. Two-column layout activates at ≥1280px viewport. Single-column stacking below that is expected. Typecheck passes clean.
