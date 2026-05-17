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
