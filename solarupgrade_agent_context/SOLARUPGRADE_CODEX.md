# SOLARUPGRADE_CODEX.md

Branch:
solarupgrade

Agent:
Codex GPT-5.5 Medium

Purpose:
Codex-specific handoff file for Solar Training / Solar Estimate upgrade phases.

Rules:
- Read `solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md` before edits.
- Keep each phase scoped.
- Preserve existing Solar Training subtabs and existing NEM 3.0 behavior.
- Do not add external requests, Supabase changes, persistence, or estimate math unless the active phase explicitly allows it.
- Run `npm.cmd run typecheck`.
- Update this file and the shared context before committing.

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
- Added Solar Estimate as the new subtab after Retention.
- Created a shell-only `SolarEstimateTab` component.
- Rendered the shell when the `estimate` tab is active.
- Listed only the planned wizard steps: Address, Home Details, Energy Use, System Config, Estimate Summary.
- Kept the shell presentational with no Google Maps, autocomplete, estimate math, provider/rate logic, persistence, Supabase changes, NEM 3.0 changes, or broad refactors.

WHAT WAS LEARNED:
- Solar Training tab integration is still centralized in `SolarTrainingView.tsx`.
- The legacy Retention id remains `progress`; the new Solar Estimate id is `estimate`.
- `SolarTrainingView.tsx` has `@ts-nocheck`, but the new shell component is typed normally.

LEARNED SKILLS / REUSABLE PATTERNS:
- For future Solar Training tabs, update the `SolarTab` union, `TABS` array, and active render block together.
- Use typed component-local step metadata for simple shells.
- Keep shell phases free of state and calculations so architecture phases can add them cleanly.

BUGS / RISKS:
- No Phase 2 bugs found.
- The new tab currently inherits the `int1` reduced-opacity tab treatment.
- Phase 3 should confirm final grouping/treatment and add the state model.

TYPECHECK RESULT:
PASS — `npm.cmd run typecheck`

SHARED CONTEXT UPDATED:
YES

AGENT FILE UPDATED:
YES

NEXT PHASE ADJUSTMENTS:
- Phase 3 should review the shell and add typed local interview state, safe defaults, placeholder handlers, and step navigation.
- Phase 3 should document existing provider/rate sources and whether Maps/autocomplete support exists in the repo.
- Do not add live Google requests, estimate math, persistence, Supabase writes, product catalog, or proposal engine in Phase 3.

NEXT PHASE READY:
YES

COMPACT HANDOFF FOR NEXT CHAT:
Phase 2 added `estimate` after Retention and created `src/components/solarTraining/SolarEstimateTab.tsx`. The shell displays only Address, Home Details, Energy Use, System Config, and Estimate Summary in the PowerOn dark style. It is intentionally presentational and has no external integrations, persistence, rates, or math. Typecheck passed. Phase 3 is ready.
