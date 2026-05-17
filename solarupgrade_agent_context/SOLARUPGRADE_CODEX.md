# SOLARUPGRADE_CODEX.md

## EVERGREEN CODEX AGENT FILE

You are Codex GPT-5.5 Medium working inside the PowerOn Hub / V15r app.

Branch:
solarupgrade

This file is not a one-phase prompt. It is a permanent operating file for Codex phases in the Solar Upgrade cascade.

The source of truth is:
`solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`

Before editing code, you must:
1. Confirm the current branch is `solarupgrade`.
2. Confirm the working tree is clean before starting, unless the user explicitly tells you to continue from existing uncommitted work.
3. Read `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`.
4. Read this file.
5. Locate `ACTIVE PHASE CONTROL` in the shared context.
6. Confirm the active phase is assigned to Codex GPT-5.5 Medium.
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

- the active phase is assigned to Claude
- the branch is not `solarupgrade`
- typecheck is already failing before your changes and the active phase does not cover fixing it
- required files are missing in a way that changes the phase scope
- completing the phase requires broad refactors
- completing the phase requires package installs or API keys not already present

If blocked, update the context files with the blocker and report:

`NEXT PHASE READY: NO`

---

## CODEX PHASE RESPONSIBILITIES

Codex is generally responsible for:

- building scoped UI shells
- adding form screens
- implementing presentational flow
- applying UI structure from the architecture
- wiring existing local state into UI
- keeping user-facing screens polished and responsive

Claude is generally responsible for:

- audits
- architecture
- safety checks
- state/data modeling
- integration review
- stabilization
- final polish/review phases

If the active phase is assigned to Claude, do not edit code. Instead, report:

`Active phase is assigned to Claude. No Codex action taken.`

---

## REQUIRED PHASE EXECUTION FORMAT

When running an active Codex phase, follow the user’s standard task structure from the shared context.

TASK TITLE:
Use the active task title from `ACTIVE PHASE CONTROL`.

MODEL / TOOL:
Use Codex GPT-5.5 Medium for this task.

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

For every Codex phase:

1. Read the active phase from `ACTIVE PHASE CONTROL`.
2. Confirm it is assigned to Codex.
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

At the end of every Codex phase:

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
   - Codex file updated YES/NO
   - next active phase
   - whether next phase is ready

---

## REQUIRED COMPLETION LOG TEMPLATE

Append this template at the end of this file after every Codex phase.

```text
## PHASE X COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:

FILES CHANGED:

ACTIVE PHASE COMPLETED:

WHAT CHANGED:

WHAT WAS LEARNED:

LEARNED SKILLS / REUSABLE PATTERNS:

BUGS / RISKS:

TYPECHECK RESULT:

SHARED CONTEXT UPDATED:

CODEX FILE UPDATED:

NEXT ACTIVE PHASE:

NEXT PHASE ADJUSTMENTS:

NEXT PHASE READY:

COMPACT HANDOFF FOR NEXT CHAT:
```

---

## PHASE 4 COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Phase 4 — Solar Estimate Interview Flow UI

WHAT CHANGED:
- Built real UI screens for Address, Home Details, Energy Use, System Config, and Review/pre-summary.
- Wired all visible inputs and selection controls to the existing local `updateField` state handler.
- Used the Phase 3 option arrays from `SolarEstimateTypes.ts` instead of redefining choices.
- Added safe Google Places suggestions and dark Google Map pin preview through the existing app loader/key path, with text-only fallback when Maps is unavailable.
- Kept the Review step as a pre-summary handoff only, with no estimate math or savings calculations.

WHAT WAS LEARNED:
- The existing Maps loader can be used directly in typed components; typecheck passes without adding `@ts-nocheck`.
- The Phase 3 state model already covers Phase 4 UI needs.
- Utility-specific rate plan rendering is straightforward through `RATE_PLANS_BY_UTILITY`.

LEARNED SKILLS / REUSABLE PATTERNS:
- Local step helper components keep the interview UI readable while staying scoped to one feature file.
- A shared option-card helper keeps premium dark selected states consistent across different input groups.
- Manual address edits should clear place metadata until a Places suggestion is selected again.

BUGS / RISKS:
- Maps/Places behavior depends on the existing runtime key and loader; fallback is safe, but visual map verification was not run in browser.
- Phase 5 should avoid false precision and clearly label assumptions for any generated estimate numbers.

TYPECHECK RESULT:
PASS — `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
Phase 5 — Claude/Codex — Estimate Summary + Editable System Controls

NEXT PHASE ADJUSTMENTS:
- Use the Review/pre-summary state as the handoff into summary rendering.
- Reuse existing NEM 3.0 calculator data conservatively if calculations are introduced.
- Consider extracting summary subcomponents only if the Phase 5 UI becomes too large for the current file.

NEXT PHASE READY:
YES

COMPACT HANDOFF FOR NEXT CHAT:
Phase 4 built the full local Solar Estimate interview flow in `SolarEstimateTab.tsx`. It uses existing option arrays and local state only, supports optional existing Google Places/map preview, and leaves all final summary math and editable output cards for Phase 5. Typecheck passes.

---

## SOLAR ESTIMATE CHART HEIGHT POLISH COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate Summary chart-height polish pass

WHAT CHANGED:
- Increased the vertical plot area for the Summary chart subtabs: Monthly Bill, 24H Flow, 25 Yr Savings, Elec. Cost, Cumulative, and Payments.
- Removed the inline SVG `maxHeight` caps that were keeping charts visually shallow.
- Raised SVG viewBox heights to about 2.25x their previous visual height while preserving the existing dark NEM 3.0-style chart language.
- Added matching vertical breathing room to the Payments chart panel without changing payment assumptions or values.

WHAT WAS LEARNED:
- Chart readability was constrained by presentation dimensions, not data generation.
- The chart module can be polished safely through local SVG dimension changes without touching formulas, saved estimates, Supabase, or unrelated tabs.

LEARNED SKILLS / REUSABLE PATTERNS:
- Use taller SVG viewBoxes plus no `maxHeight` cap to preserve responsive width and avoid horizontal overflow.
- Keep non-SVG chart tabs visually aligned with SVG tabs by adjusting only panel height and bar thickness.

BUGS / RISKS:
- Screenshot QA is still recommended across desktop and mobile.
- No formulas, assumptions, localStorage behavior, Supabase behavior, or chart values were changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Run screenshot QA on the Solar Estimate Summary chart module and confirm all six chart subtabs remain readable without horizontal overflow.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Solar Estimate chart-height polish complete. `SolarEstimateTab.tsx` now renders the Summary chart subtabs about 2.25x taller vertically by increasing SVG viewBox heights, removing max-height caps, and giving the Payments tab a taller panel. Chart data, formulas, assumptions, saved estimates, Supabase, and unrelated tabs were not touched. Typecheck passes.

---

## SOLAR ESTIMATE CHART RENDER CONSISTENCY COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate chart render consistency pass

WHAT CHANGED:
- Used Monthly Bill Comparison as the chart render baseline: W=575, H=170, compact plot padding, full month labels, larger title/subtitle text, and readable legend styling.
- Aligned 24H Flow, 25 Yr Savings, Elec. Cost, and Cumulative SVG chart proportions to the same compact 575x170 render feel.
- Increased Summary chart subtab button size, text, and padding across Monthly Bill, 24H Flow, 25 Yr Savings, Elec. Cost, Cumulative, and Payments.
- Kept the active tab state premium PowerOn cyan/teal with a restrained background and no aggressive glow.
- Matched Payments title/subtitle scale to the other chart subtabs without changing payment assumptions or values.

WHAT WAS LEARNED:
- Monthly Bill had already been tuned to the desired compact chart feel; the other subtabs needed presentation constants and readability styling aligned to it.
- Consistency could be achieved without touching formulas, modeled values, localStorage, Supabase, or unrelated Solar Training tabs.

LEARNED SKILLS / REUSABLE PATTERNS:
- Use a shared SVG canvas size across related chart subtabs when the visual goal is consistent panel rhythm.
- Preserve chart readability with compact padding plus small per-chart side-padding adjustments for longer axis labels.

BUGS / RISKS:
- Screenshot QA is still recommended for all six chart subtabs across desktop and narrow widths.
- No formulas, values, assumptions, persistence, Supabase behavior, or unrelated tabs were changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Run screenshot QA on all six Solar Estimate summary chart subtabs and confirm no horizontal overflow.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Chart render consistency pass complete in `src/components/solarTraining/SolarEstimateTab.tsx`. Monthly Bill remains the visual baseline at 575x170 with compact padding, full month labels, larger title/subtitle, and readable legend. 24H Flow, 25 Yr Savings, Elec. Cost, and Cumulative now match that compact render proportion. Summary chart tab buttons are larger across all six subtabs with restrained cyan active state. Typecheck passes. Ready for screenshot QA.

---

## SOLAR ESTIMATE CHART TOOLTIP COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate chart tooltip pass

WHAT CHANGED:
- Added reusable `ChartHoverCard`, tooltip row types, and a cursor-position helper inside `SolarEstimateTab.tsx`.
- Monthly Bill hover cards show current monthly cost, new projected cost, and monthly savings using the same monthly before/after values already rendered by the chart.
- 24H Flow hover cards show hour, home load, solar production, grid import/export, battery-enabled context when applicable, and existing TOU period/import-rate context from the selected rate plan.
- 25 Yr Savings hover cards show year, projected current electric cost, projected cost with system, annual savings, and cumulative savings.
- Elec. Cost hover cards show year, utility rate path, projected system rate path, rate difference, and provider context.
- Cumulative hover cards show year, annual savings, cumulative savings, and payback note.

WHAT WAS LEARNED:
- The existing generated chart data already supports the requested hover detail cards without changing chart math or assumptions.
- Fixed-position cards are the least invasive way to avoid clipping inside nested chart wrappers.

LEARNED SKILLS / REUSABLE PATTERNS:
- Transparent SVG hover targets can sit over existing chart marks to preserve visible chart layout while adding detail-on-hover.
- Keep each chart's tooltip state local while sharing a small card renderer for consistent PowerOn styling.

BUGS / RISKS:
- Payments intentionally has no hover card because it was outside scope.
- Touch/mobile hover is intentionally limited; no touch-specific card behavior was added.
- Screenshot QA is still recommended for tooltip placement and readability.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Run screenshot QA hovering each of the five tooltip-enabled chart subtabs.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Chart tooltip pass complete in `src/components/solarTraining/SolarEstimateTab.tsx`. Monthly Bill, 24H Flow, 25 Yr Savings, Elec. Cost, and Cumulative now have premium dark hover cards driven by existing chart data. Payments is intentionally unchanged by scope. Typecheck passes. Ready for screenshot QA.

---

## SOLAR ESTIMATE ADDRESS MAP UPGRADE COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Pending at log-write time; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate Address map upgrade

WHAT CHANGED:
- Upgraded Solar Estimate Step 1 Address to render a larger Google Maps roof preview under the address fields after a Places suggestion provides latitude/longitude.
- Reused the existing `@react-google-maps/api`, `useV15rGoogleMapsLoader`, and `VITE_GOOGLE_MAPS_BROWSER_KEY` path.
- Switched the preview map to `hybrid` satellite imagery, centered on the selected coordinates, with top-down tilt forced to `0`.
- Added a clear marker at the selected property location and kept the map centered/zoomed when the selected address changes.
- Preserved the polished fallback card for missing API key, load failure, or missing coordinates.

WHAT WAS LEARNED:
- The address autocomplete behavior was already correctly wired in `SolarEstimateTab.tsx`; this pass only needed to upgrade the map mode, framing, placement, and zoom.
- Zoom `19` is a better roof-level starting point than the old zoom `15` while keeping the wide panel near the requested 500-foot context.

LEARNED SKILLS / REUSABLE PATTERNS:
- `mapTypeId: 'hybrid'` with `map.setTilt(0)` is the scoped pattern for top-down satellite roof previews.
- Moving map previews below form fields gives more useful inspection space without introducing horizontal overflow.

BUGS / RISKS:
- Browser screenshot QA is still needed with a real Maps key and selected address to validate satellite imagery, marker visibility, and exact framing.
- Visible radius varies by viewport width and latitude.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Run screenshot QA on Step 1 Address with a configured Maps key, select an address, and confirm hybrid imagery plus marker are clear at zoom `19`.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Address map upgrade complete in `src/components/solarTraining/SolarEstimateTab.tsx`. Step 1 Address now shows a larger premium dark framed Google Maps `hybrid` satellite roof preview under the address form when coordinates exist. It centers on selected coordinates, uses zoom `19`, forces tilt `0`, and shows a marker. Existing Places autocomplete and fallback behavior are preserved. Typecheck passes.

---

## SOLAR ESTIMATE MAP RENDER BUG FIX COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate map render bug fix

WHAT CHANGED:
- Hardened the Step 1 Satellite Roof Preview sizing chain so the live Google map paints inside a large visible panel.
- Added full-width, `min-w-0`, and `min-h-[360px]` constraints to the live map wrapper and fallback states.
- Made the live map surface `relative`, full-width, non-collapsing, overflow-hidden, and at least `360px` tall, with `sm:h-[420px]` for a larger desktop roof preview.
- Kept the `GoogleMap` container style as `{ width: '100%', height: '100%' }` and added a full-size `mapContainerClassName`.
- Preserved hybrid satellite map type, zoom `19`, selected-coordinate centering, centered marker, existing loader, and address autocomplete behavior.

WHAT WAS LEARNED:
- The visible-header/empty-card failure was a layout sizing issue: the GoogleMap was mounted but depended on a percentage-height internal container without a strong non-collapsing parent map surface.
- The existing coordinate flow, Maps API loader, marker, and zoom settings did not need changes.

LEARNED SKILLS / REUSABLE PATTERNS:
- Google Maps components need an explicit measured parent surface plus a full-size map container to reliably render tiles.
- `min-w-0` is important for map/card wrappers inside responsive layouts to avoid shrink collapse and hidden overflow.

BUGS / RISKS:
- Live satellite imagery still requires a configured Google Maps browser key and available Maps API.
- Browser screenshot QA is recommended with a selected Places address to verify real tile rendering and marker placement.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Run browser QA on Step 1 Address with a configured Maps key and selected Places suggestion to confirm hybrid imagery and the centered marker.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Map render bug fix complete in `src/components/solarTraining/SolarEstimateTab.tsx`. Satellite Roof Preview now has a guaranteed visible map surface (`min-height: 360px`, full width, no shrink collapse) and GoogleMap fills it with `{ width: '100%', height: '100%' }`. Autocomplete, coordinates, hybrid map mode, zoom `19`, and centered marker are unchanged. Typecheck passes.

---

## SOLAR ESTIMATE MAP QUALITY POLISH COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate map quality polish pass

WHAT CHANGED:
- Replaced the fixed Step 1 roof preview zoom `19` with a target/fallback zoom model.
- Added `SOLAR_ROOF_TARGET_ZOOM = 20` and `SOLAR_ROOF_FALLBACK_ZOOM = 19`.
- Added Google Maps `MaxZoomService` lookup for selected address coordinates when available.
- The preview initially uses fallback zoom `19`, then applies `min(20, reportedMaxZoom)` so areas with lower native satellite resolution are not over-zoomed.
- If `MaxZoomService` is missing or fails, the preview stays at fallback zoom `19`.
- Kept the map centered on selected coordinates with the marker centered there.
- Preserved `GoogleMap` `mapContainerStyle={{ width: '100%', height: '100%' }}` and the existing non-collapsing map surface.
- Added/kept map options for hybrid imagery, `tilt: 0`, `heading: 0`, clickable icons off, fullscreen/map type/zoom controls on, and Street View off.
- Removed unused custom dark map styles from the satellite preview so this component does not style the native imagery surface.

WHAT WAS LEARNED:
- `MaxZoomService` lets the app prefer roof-level zoom `20` without forcing Google to scale lower-resolution satellite tiles where native imagery tops out below that.
- The existing map sizing fix remained valid; this pass only needed zoom and map option polish.

LEARNED SKILLS / REUSABLE PATTERNS:
- Apply a quick fallback zoom for initial map paint, then update zoom asynchronously after native imagery max zoom is known.
- Use `google.maps.MapTypeId.HYBRID` once the Maps API is loaded while keeping a string fallback for pre-load safety.

BUGS / RISKS:
- Final imagery clarity still depends on Google's tile availability for the selected roof.
- Browser QA with a real Maps key is recommended to confirm behavior across high-resolution and lower-resolution addresses.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Run Step 1 Address screenshot QA with a configured Maps key and multiple selected addresses to verify zoom `20` where available and lower max zoom where Google reports it.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Map quality polish complete in `src/components/solarTraining/SolarEstimateTab.tsx`. Step 1 roof preview now targets zoom `20`, falls back to `19`, and uses `MaxZoomService` to cap zoom to the selected coordinate's native satellite max. It remains hybrid, top-down, manually zoomable, centered on the selected marker, and keeps existing fallback behavior. Typecheck passes.

---

## SOLAR ESTIMATE ADDRESS LAYOUT POLISH COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate Address layout polish pass

WHAT CHANGED:
- Changed Step 1 Address from a single vertical column to a responsive two-column layout on wide screens.
- Address input, suggestions, place ID, latitude, and longitude now sit in the left column.
- The existing satellite roof map preview now sits in the right column.
- Smaller widths still stack address first and map second.
- Added `min-w-0` guards to the layout columns and made the metadata cards compact inside the left rail.

WHAT WAS LEARNED:
- The desired compact layout did not require changes to autocomplete state, selected address data, map behavior, markers, zoom logic, or fallback rendering.
- The existing `AddressMapPreview` component can be repositioned safely when its wrapper preserves full width and a non-shrinking column.

LEARNED SKILLS / REUSABLE PATTERNS:
- Use `lg:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.35fr)]` for a compact form rail plus inspectable map panel.
- Let metadata chips switch from row to column inside a narrow desktop rail to preserve readability.

BUGS / RISKS:
- Screenshot QA is still recommended near the `lg` breakpoint and on wide desktop with a real selected address.
- No map API logic, autocomplete logic, estimate math, saved estimates, summary charts, unrelated steps, or unrelated tabs were changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Screenshot QA Step 1 Address across mobile, tablet, `lg`, and wide desktop widths, with missing-map fallback and live map states.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Address layout polish complete in `src/components/solarTraining/SolarEstimateTab.tsx`. Step 1 now uses a desktop two-column grid: left address/input/suggestions/place metadata, right existing satellite roof preview. Smaller widths stack cleanly. Existing autocomplete, selected address data, map behavior, marker, zoom quality logic, and fallback cards are unchanged. Typecheck passes.

---

## SOLAR ESTIMATE STEP 1 LAYOUT CORRECTION COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Scoped Solar Estimate Step 1 layout correction

WHAT CHANGED:
- Moved the Step 1 intro/header into the left column with the address input, suggestions, place ID, latitude, and longitude.
- Kept the Satellite Roof Preview map in the right column as a sibling of that complete left Step 1 address column.
- Updated the parent responsive grid to `xl:grid-cols-[minmax(360px,0.85fr)_minmax(640px,1.35fr)]` and kept `min-w-0` on both grid children.
- Preserved stacked layout on smaller widths with address first and map second.

WHAT WAS LEARNED:
- The prior layout still felt full-width because the Step 1 intro was outside the split grid.
- The correct fix was to make the full Step 1 address content and map preview siblings in one grid row.

LEARNED SKILLS / REUSABLE PATTERNS:
- Keep the full form/intro column and preview column together inside one grid when the visual requirement is a true horizontal split.
- Use explicit `xl` column minimums for wide desktop preview layouts while preserving stacked behavior below that breakpoint.

BUGS / RISKS:
- Screenshot QA remains recommended at `xl` and wider desktop widths.
- No map API logic, autocomplete logic, selected address data, saved estimates, estimate math, summary charts, unrelated steps, or unrelated tabs were changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Run screenshot QA below the five step cards on desktop to confirm left Step 1 content and right Satellite Roof Preview share the same row.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Step 1 layout correction complete in `src/components/solarTraining/SolarEstimateTab.tsx`. The Step 1 intro/header plus address form and metadata now occupy the left column; Satellite Roof Preview is the right-column sibling on `xl` desktop widths. Smaller screens stack address then map. Typecheck passes.

---

## SOLAR ESTIMATE ADMIN COST SETTINGS COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/v15r/V15rSettingsPanel.tsx`
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/services/solarTraining/SolarEstimateSettings.ts`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Add Solar Estimate Settings modal/card and connect install cost logic

WHAT CHANGED:
- Added a Solar Estimate Settings admin card under HUNTER Operations below HUNTER Home Base.
- Added local-only cost settings with safe defaults for labor rates, per-panel labor, mobility, permit tiers, blueprint tiers, and delivery.
- Added a shared Solar Estimate settings service for localStorage persistence, normalization, combined hourly labor rate, tier selection, and cost breakdown calculation.
- Removed the manual Step 4 Install Cost slider and replaced it with a settings-driven modeled cost preview.
- Updated Summary estimated cost and cost-sensitive chart inputs to use the modeled settings total.
- Added a compact internal cost breakdown in Summary.

WHAT WAS LEARNED:
- Settings Hub is `src/components/v15r/V15rSettingsPanel.tsx`, with HUNTER tools grouped in the HUNTER Operations card.
- The Solar Estimate tab can listen for same-tab settings changes through a custom local event after settings are saved.
- Distance cannot be safely inferred in this scope, so mobility and delivery use base/flat costs only while keeping mileage rates configurable for later.

LEARNED SKILLS / REUSABLE PATTERNS:
- Use a small local service to keep Settings Hub defaults and feature calculations aligned.
- Keep old persisted fields compatible while changing the active calculation source.

BUGS / RISKS:
- Screenshot QA is recommended for the Settings Hub card, Step 4 System Config, and Summary cost breakdown.
- Per-mile mobility/delivery settings are stored but not used until scoped distance modeling exists.
- Combined hourly labor is displayed but not applied because no labor-hours assumption exists.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Verify settings persist after reload and Summary updates from changed settings.
- If future work enables distance, explicitly model HUNTER home base to project distance before applying per-mile rates.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Solar Estimate install cost is now settings-driven. New localStorage key is `poweron.solarTraining.solarEstimateSettings`; defaults and calculator live in `src/services/solarTraining/SolarEstimateSettings.ts`. Settings Hub card is below HUNTER Home Base. Step 4 install cost slider is removed. Summary uses the settings total and shows panel labor, permit, blueprint, mobility, delivery, and total internal cost breakdown. Typecheck passes.

---

## SOLAR ESTIMATE SETTINGS PLACEMENT AND COLLAPSE POLISH COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/v15r/V15rSettingsPanel.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Polish Solar Estimate Settings placement, labor totals, and collapsible admin sections

WHAT CHANGED:
- Reordered Settings Hub so Solar Estimate Settings renders below the full HUNTER Command Center, after Cron Run Status.
- Added persisted collapse/expand behavior for HUNTER Command Center and Solar Estimate Settings.
- Removed the Combined labor header pill from Solar Estimate Settings.
- Moved Combined crew labor rate into the Labor box below the three hourly role fields.
- Split the Labor box into Hourly crew labor rates and Panel labor rate so Cost per panel installed is visually separate.

WHAT WAS LEARNED:
- Solar Estimate Settings had been inserted inside the HUNTER Command Center content stack, which split Home Base from Cron Run Status.
- The Solar Estimate settings value storage and calculation helper did not need changes for this polish.

LEARNED SKILLS / REUSABLE PATTERNS:
- Persist collapsible admin UI state with dedicated localStorage keys, separate from actual settings values.
- Use a sibling section under a shared SettingCard when two admin tools belong in the same broader Settings Hub category but should not share one body hierarchy.

BUGS / RISKS:
- Screenshot QA remains recommended for collapsed and expanded states.
- No Solar Estimate interview UI, estimate calculation logic, HUNTER geocoding, Cron behavior, Supabase, or packages were touched.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Verify collapse state persists after reload for both new keys.
- Verify Solar Estimate Settings values still persist under `poweron.solarTraining.solarEstimateSettings`.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Settings Hub-only polish complete in `src/components/v15r/V15rSettingsPanel.tsx`. Solar Estimate Settings now sits below HUNTER Home Base and Cron Run Status. Collapse keys are `poweron.settings.hunterCommandCenter.collapsed` and `poweron.settings.solarEstimateSettings.collapsed`. Combined crew labor rate is inside the Labor section, and per-panel labor is separated. Typecheck passes.

---

## SOLAR ESTIMATE SETTINGS SIZE-RANGE LABELS COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/v15r/V15rSettingsPanel.tsx`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Add size-range labels to Solar Estimate Settings size tiers

WHAT CHANGED:
- Added `5–15 kW`, `15–30 kW`, and `30–50 kW` hints beside Small, Medium, and Large system labels in `Permit Cost by Size`.
- Added the same tier range hints beside Small, Medium, and Large system labels in `Blueprint Cost by Size`.
- Updated section helper copy to reference shared system-size ranges instead of the previous threshold wording.

WHAT WAS LEARNED:
- The Settings Hub field renderer already accepts optional hint text, so the range labels could be added without changing settings state, input values, or persistence.

LEARNED SKILLS / REUSABLE PATTERNS:
- Prefer existing label/hint affordances for small Settings Hub clarity improvements.

BUGS / RISKS:
- Screenshot QA is still useful to verify the hint labels read cleanly on narrow widths.
- No formula, threshold, localStorage, Supabase, or unrelated UI logic was changed.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Verify in Settings Hub > Solar Estimate Settings that both Permit and Blueprint sections show Small `5–15 kW`, Medium `15–30 kW`, and Large `30–50 kW`.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Size-range label polish complete in `src/components/v15r/V15rSettingsPanel.tsx`. Permit Cost by Size and Blueprint Cost by Size now visibly label each tier: Small `5–15 kW`, Medium `15–30 kW`, Large `30–50 kW`. Existing input keys, saved values, formulas, threshold logic, persistence, Supabase behavior, and unrelated Settings Hub/Solar Estimate logic were not changed. Typecheck passes.

---

## SOLAR ESTIMATE SYSTEM CONFIG DESIGN CLEANUP COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/services/solarTraining/SolarEstimateTypes.ts`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Clean System Config design step and add main panel upgrade toggle

WHAT CHANGED:
- Removed the Step 4 green `Modeled install cost` display card.
- Removed Step 4's `Settings cost` design row and kept Summary's Settings-driven install cost logic unchanged.
- Added `mainPanelUpgradeNeeded` to `SolarEstimateData` with default `false`.
- Added breaker-based defaulting: `100A`, `125A`, and `150A` default ON; `200A`, `225A`, `400A`, and `unknown` default OFF.
- Added a clean `Main panel upgrade` toggle directly below the Solar Plus Battery toggle in Step 4.
- Reworked the Solar Plus Battery toggle into a premium dark card with label/helper text on the left and an unclipped right-aligned switch.
- Added Main panel upgrade Yes/No to Step 4 design info and Step 5 Summary values.
- Preserved explicit saved/draft toggle values while deriving a default for older saved data without the field.

WHAT WAS LEARNED:
- Main breaker values are typed with `A` suffixes, not bare numbers.
- Step 4 can be decoupled from install-cost display without affecting Summary's `calculateSolarEstimateInstallCost` flow.

LEARNED SKILLS / REUSABLE PATTERNS:
- Derive new local-state defaults during normalization only when old saved records do not have the new field.
- Keep switches inside a padded flex card and move the knob with a block transform to avoid clipped toggle rendering.

BUGS / RISKS:
- Screenshot QA is recommended for Step 4 toggles and the conditional battery-size slider.
- An unrelated modified `src/components/v15r/V15rSettingsPanel.tsx` existed before this commit and was not staged.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Verify Step 4 no longer displays any install cost card or settings-cost row.
- Verify Main Panel Upgrade defaults ON for `100A`, `125A`, `150A`, and OFF for `200A`, `225A`, `400A`, and `unknown`, while remaining manually toggleable.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Step 4 System Config design cleanup complete in `src/components/solarTraining/SolarEstimateTab.tsx`, with typed state added in `SolarEstimateTypes.ts`. Step 4 is now design-only and includes clean Solar Plus Battery and Main Panel Upgrade toggles. `mainPanelUpgradeNeeded` persists in drafts/saved estimates and older records derive the default from breaker size. Summary cost logic remains unchanged and Summary now shows Main panel upgrade Yes/No. Typecheck passes.

---

## SOLAR ESTIMATE SYSTEM CONFIG LAYOUT AND PANEL COST COMPLETION LOG

AGENT:
Codex GPT-5.5 Medium

COMMIT HASH:
Committed; see final Codex report for the actual commit hash.

FILES CHANGED:
- `src/components/solarTraining/SolarEstimateTab.tsx`
- `src/components/v15r/V15rSettingsPanel.tsx`
- `src/services/solarTraining/SolarEstimateSettings.ts`
- `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md`
- `solarupgrade_agent_context/SOLARUPGRADE_CODEX.md`

ACTIVE PHASE COMPLETED:
Reorganize System Config layout and add main panel upgrade setting

WHAT CHANGED:
- Moved Solar Plus Battery into the left Step 4 design panel below Panel Wattage.
- Kept Battery Size directly below Solar Plus Battery when battery mode is ON.
- Kept Main Panel Upgrade below the Battery Size area in the left design panel.
- Kept the right Step 4 rail to only Target Solar Offset and the four summary boxes.
- Added `mainPanelUpgradeCost` to Solar Estimate Settings with default `$2,500`.
- Added a Settings Hub Electrical Upgrades card with `Main panel upgrade cost`.
- Included main panel upgrade cost in Summary install cost only when `mainPanelUpgradeNeeded` is ON.
- Added a conditional Main panel upgrade row to the Summary cost breakdown.

WHAT WAS LEARNED:
- The settings helper already centralizes default values, normalization, localStorage persistence, and cost calculation, so the new setting could be added without touching Step 4 cost display.
- The previous Settings Hub file had local size-range label edits in progress; they were preserved while adding the new field.

LEARNED SKILLS / REUSABLE PATTERNS:
- Keep Step 4 as design-only and route all internal cost additions through Summary's shared calculator.
- Use conditional cost breakdown rows for settings that apply only under a selected design option.

BUGS / RISKS:
- Screenshot QA should verify the Step 4 left/right balance and the new Settings Hub field.

TYPECHECK RESULT:
PASS - `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

CODEX FILE UPDATED:
YES

NEXT ACTIVE PHASE:
No active build phase defined

NEXT PHASE ADJUSTMENTS:
- Verify Summary total and cost breakdown with Main Panel Upgrade ON and OFF.

NEXT PHASE READY:
NO active build phase. Ready for screenshot QA.

COMPACT HANDOFF FOR NEXT CHAT:
Step 4 layout and main panel cost setting complete. Left side has Monthly Usage, System Size, Panel Wattage, Solar Plus Battery, conditional Battery Size, and Main Panel Upgrade. Right side only has Target Solar Offset and four summary boxes. `mainPanelUpgradeCost` defaults to `$2,500`, persists in existing Solar Estimate Settings localStorage, and is included in Summary cost only when the Step 4 toggle is ON. Typecheck passes.
