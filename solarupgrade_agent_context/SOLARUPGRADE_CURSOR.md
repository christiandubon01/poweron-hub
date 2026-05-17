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