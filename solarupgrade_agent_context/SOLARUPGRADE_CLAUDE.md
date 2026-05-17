# SOLARUPGRADE_CLAUDE.md

## AGENT ROLE

You are Claude Code working inside the PowerOn Hub / V15r app.

Branch:
solarupgrade

Primary job:
Audit and stabilize the existing Solar Training tab before any new Solar Estimate build work begins.

You must keep work scoped, avoid broad refactors, and update this file at the end of the phase.

---

TASK TITLE:
Audit Solar Training System and fix Retention crash

MODEL / TOOL:
Use Claude Code in VS Code for this task.

CONTEXT:
This is the PowerOn Hub / V15r app.
Current branch must be `solarupgrade`.

The Solar Training tab already includes these subtabs:
- Certifications
- Training Modes
- Scores
- Rules Library
- Quick Quiz
- NEM 3.0
- Retention

The user wants to keep all existing subtabs and later add a new subtab called `Solar Estimate` immediately after `Retention`.

The visual language must match the existing premium PowerOn design:
- dark navy panels
- subtle teal/cyan/green/yellow solar accents
- soft borders
- restrained glow
- clean spacing
- no aggressive glare
- no bulky typography
- no reload loops

TARGET FILES:
First inspect and identify the actual Solar Training files.
Likely areas:
- src/components
- src/pages
- src/features
- any V15r/SolarTraining/NEM/Retention related files

Do not assume file paths. Search the repo first.

REFERENCE FILES / DESIGN REFERENCES:
Use the existing NEM 3.0 Savings Visualizer as the best internal reference.
Use existing Solar Training subtab implementation patterns.
Use existing PowerOn premium card/panel style.

External visual references provided by user:
- Enphase-style address intake flow
- residential information interview
- energy consumption interview
- system configuration interview
- estimate summary page with:
  - top metric cards
  - bill savings card
  - consumption profile graph
  - disclaimer section
  - bottom adjustable solar size / battery size controls

Do not build the new Solar Estimate feature in this phase. Only audit and stabilize.

SCOPE:
Only do:
1. Deep audit of the existing Solar Training tab and all its subtab components.
2. Map component structure, state flow, data flow, tab switching, persistence/local storage/Supabase touchpoints if present.
3. Find why the Retention subtab crashes with:
   `Cannot read properties of undefined (reading 'length')`
4. Fix the Retention crash with the smallest safe change.
5. Add defensive defaults/guards only where needed.
6. Create/update:
   - solarupgrade_agent_context/SOLARUPGRADE_SHARED_CONTEXT.md
   - solarupgrade_agent_context/SOLARUPGRADE_CLAUDE.md
7. Report what files were inspected and changed.

Do NOT touch:
- NEM 3.0 formulas
- bill calculations
- savings formulas
- Supabase behavior
- persistence behavior unless required to prevent the Retention crash
- unrelated app chrome
- unrelated tabs outside Solar Training
- sidebar/topbar
- floating action buttons
- broad component refactors
- route architecture
- package dependencies unless absolutely required

CURRENT ISSUE:
The Retention subtab breaks the app and throws:
`Cannot read properties of undefined (reading 'length')`

The existing Solar Training tab also needs a full code audit before adding the Solar Estimate subtab.

DESIRED RESULT:
The Solar Training tab should be fully understood and documented.
The Retention tab should no longer crash, even if its source data is undefined, empty, missing, or partially migrated.
All existing Solar Training subtabs should still render.
No unrelated behavior should change.

REQUIREMENTS:
1. Search the repo for Solar Training, NEM 3.0, Retention, rules, quiz, certifications, and scores components.
2. Identify the main Solar Training parent component.
3. Identify how subtabs are defined and rendered.
4. Identify all Retention data inputs.
5. Fix the undefined `.length` crash safely.
6. Prefer default empty arrays, nullish coalescing, optional chaining, or local normalized variables.
7. Do not hide real errors with broad try/catch unless there is no better option.
8. Add no fake production data.
9. Do not add the Solar Estimate tab yet.
10. Update the shared context markdown with useful findings for the next agent.

VISUAL REQUIREMENTS:
- Preserve existing layout and styling.
- Do not redesign the tab in this phase.
- If Retention needs an empty state, keep it premium, compact, and consistent with the existing PowerOn dark style.

DATA / LOGIC REQUIREMENTS:
- Keep existing formulas exactly the same.
- Keep existing values exactly the same.
- Do not change reducers/scanners/helpers unless required for the Retention crash.
- Do not change persistence unless required for the Retention crash.
- Do not change Supabase behavior unless required for the Retention crash.
- Do not introduce new estimate calculations.

RESPONSIVE REQUIREMENTS:
- Existing Solar Training pages must still work on wide desktop.
- No new horizontal overflow.
- No overlap with floating buttons.
- Retention empty state should wrap cleanly.

ACCEPTANCE CRITERIA:
- Retention subtab no longer crashes.
- Solar Training parent tab still loads.
- Certifications still renders.
- Training Modes still renders.
- Scores still renders.
- Rules Library still renders.
- Quick Quiz still renders.
- NEM 3.0 still renders.
- Existing NEM 3.0 numbers remain unchanged.
- No unrelated area changed.
- Typecheck passes.
- App does not reload endlessly.
- Context markdown files are updated with audit findings and next-step notes.

QA:
Run:
npm.cmd run typecheck

If PowerShell blocks npm, use:
npm.cmd run typecheck

Also run any existing lint/test command only if already obvious from package scripts. Do not spend time inventing new test setup.

COMMIT:
After typecheck passes, commit only the scoped files.

Commit message:
Fix Solar Training retention crash and add solarupgrade audit context

END OF PHASE REPORT REQUIRED:
After committing, report:
- branch name
- commit hash
- files changed
- Retention crash root cause
- exact fix made
- typecheck result
- whether SOLARUPGRADE_SHARED_CONTEXT.md was updated
- compact context for next chat
- whether next session is ready

APPEND THIS SECTION AT THE END OF THIS FILE AFTER COMPLETION:

## PHASE 1 COMPLETION LOG

COMMIT HASH:
FILES CHANGED:
WHAT CHANGED:
RETENTION CRASH ROOT CAUSE:
WHAT WAS LEARNED:
BUGS / RISKS:
TYPECHECK RESULT:
SHARED CONTEXT UPDATED:
NEXT PHASE READY: