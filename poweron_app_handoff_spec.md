# PowerOn App - Handoff Specification

Version: V4.0 Production
Date: 2026-04-12
Status: PRODUCTION
Approval: Christian - PIN Confirmed
Version Source of Truth: VERSION_CHANGELOG_v4_0.md

---

## Overview

PowerOn Hub is an intelligent business OS for electrical contractors.

This handoff spec is now governed by the v4.0 law stack. It is no longer a loose merge note. It is a controlled execution reference for all build sessions touching the PowerOn Hub app.

If any instruction conflicts with:
1. Christian's direct instruction
2. PIN-approved v4.0 laws
3. POWERON_MASTER_REFERENCE_v4_0
4. VERSION_CHANGELOG_v4_0

then this document must defer upward to that authority stack.

---

## v4.0 Governance Lock

The following are now permanent execution laws for this handoff flow:

- Only Channel B conducts interviews and writes CHANGE_SPEC documents
- Only Channel A writes Cowork prompts, inject scripts, post-session sequences, and failure analysis
- Gemini is code-reading only
- Any change to laws, prompt format, rules, flows, or master references requires Christian's 4-digit PIN
- Prompt format is frozen unless Christian changes it with PIN approval
- Small batch quality protocol is active
- Codebase isolation architecture is mandatory
- Versioned changelog tracking is mandatory
- Feedback loop laws are active across the operating system
- If any model drifts out of role, stop and report

---

## Channel Roles

### Channel B
Owns:
- interviews
- strategic discovery
- summary
- alignment check
- PIN request
- CHANGE_SPEC lock

Does not own:
- inject scripts
- Cowork prompts
- failure analysis
- post-session command flow

### Channel A
Owns:
- Gemini audit requests after spec lock
- Cowork prompt generation
- inject script generation
- post-session sequence
- failure analysis
- queue and execution support

Does not own:
- interviews
- CHANGE_SPEC writing

### Gemini
Owns:
- code reading
- route tracing
- root-cause reporting
- file-level findings

Does not own:
- fixes
- specs
- prompts
- implementation strategy beyond observed findings

---

## Mandatory Approval Sequence

All feature work must follow this sequence:

1. Christian starts with Channel B
2. Channel B conducts interview
3. Channel B summarizes proposed change
4. Channel B asks:
   "Does this align with your 5/10/15/20 year vision?"
5. If no: iterate
6. If yes: Channel B requests PIN
7. Christian provides PIN
8. Spec is locked
9. Channel A takes over
10. Gemini audit happens if required
11. Channel A writes inject script / Cowork prompt
12. Session executes
13. Post-session sequence runs
14. Only then can push/deploy happen

No shortcuts are allowed.

---

## Codebase Isolation Architecture

This is active immediately.

### Rule
`src/views/` must no longer be treated as a flat shared space.

### Required direction
Feature views must move into bounded folders such as:

- `src/views/visual-suite/`
- `src/views/neural-world/`
- `src/views/orb-lab/`

This pattern mirrors the already-correct modular direction used in `src/services/`.

### Isolation law
- Each session must have a defined isolation folder
- No session may edit outside its assigned boundary
- Parallel sessions must use non-overlapping isolation folders
- Protected files remain protected
- Canary files remain enforceable
- `ignition.js` is the runtime enforcement layer for isolation

If isolation is unclear, stop and report.

---

## Ownership Boundary Rule

Every agent or workstream must own a specific file boundary.

Examples of required ownership behavior:
- Visual Suite work should not drift into Neural World files
- ORB LAB work should not touch unrelated panels
- Queue/tooling work should not mutate app feature code without explicit scope
- Parallel sessions must not overlap file boundaries

A formal ownership map is required under v4.0 and should be maintained separately.

---

## Frozen Cowork Prompt Format

The Cowork prompt format is now locked.

### Required Header
Every execution prompt must include:

- IGNITION CODE
- SESSION KEY
- ALLOWED TOOLS
- WORKING DIR
- ISOLATION FOLDER
- PROTECTED FILES
- CANARY FILE

### Required Footer
Every execution prompt must end with:

- `npm run build`
- `git add src/`
- `git commit`
- hash only
- `node done.js`

No changes are allowed without Christian's PIN approval.

---

## Execution Standard

Every execution session must:
- use the locked prompt format
- use the correct working directory
- define isolation boundary
- define protected files
- define canary file if needed
- stay within role law
- end with build verification
- end with commit hash only
- end with `node done.js`

If any of those are missing, the session is not ready to run.

---

## Small Batch Quality Protocol

Scale must be earned.

### Rule
Start with 1-3 sequential sessions before parallelizing.

### Scale-up threshold
Target:
- 20 sessions
- less than 5% rework

Only after that threshold is achieved may wave size expand flexibly, such as 7-10 sessions depending on scope.

### Priority
Quality over speed always.

---

## Feedback Loop Law

The following loop structure is mandatory.

### Every 15 minutes
Each active model must report:
- Am I performing to my role?
- Am I aligned with the other models?

Output:
- `On role`
- or `Off role + what drifted`

### Every 60 minutes
Acknowledge all 15-minute checks and ask Christian:
- "How do you feel about the conversation flow? Is it working?"

Then listen and adjust.

### Every 4 hours
Detect signs of:
- fatigue
- overload
- frustration
- context drift

Then report:
- what was observed
- whether to continue or pause

### Daily 10 PM checkpoint
Channel B and Channel A must output:
- what was attempted
- what shipped
- what needs adjustment tomorrow

---

## CrewAI Pre-Spec Dependency

CrewAI is not yet active, but all future CrewAI behavior must inherit v4.0 governance.

CrewAI will be governed by:
- v4.0 law stack
- role boundaries
- feedback loop law
- isolation law
- prompt format lock
- version traceability
- approval discipline

Reference:
- `CREWAI_PRESPEC_v4_0.md`

---

## Protected Files

The following remain protected unless a session explicitly and validly scopes them:

| File | Reason |
|---|---|
| `src/store/authStore.ts` | Auth state protection |
| `netlify.toml` | Deployment protection |
| `src/services/backupDataService.ts` | Data safety protection |
| `vite.config.ts` | Build config protection |
| `src/components/v15r/charts/SVGCharts.tsx` | Frozen chart surface |

Additional protected files may be defined per session in the prompt header.

---

## Build and Completion Rule

A session is not complete until all required end conditions are satisfied.

Required end flow:
1. `npm run build`
2. `git add src/`
3. `git commit`
4. return hash only
5. `node done.js`

Then run the post-session operational sequence defined by Channel A.

---

## Post-Session Rule

After every completed session, the proper sequence must be followed by the established workflow.

This handoff spec does not replace the user daily habit guide, but it recognizes the v4.0 ordered post-session discipline.

Reference:
- `POWERON_USER_DAILY_HABIT_GUIDE_v4_0.html`

---

## Version Traceability

This document is part of the v4.0 governance set.

Required companion documents:
- `POWERON_MASTER_REFERENCE_v4_0.html`
- `POWERON_USER_DAILY_HABIT_GUIDE_v4_0.html`
- `VERSION_CHANGELOG_v4_0.md`
- `CREWAI_PRESPEC_v4_0.md`

Older versions must be archived and never deleted.

---

## Stop Conditions

Stop immediately and report if any of the following occur:

- model role drift
- spec written by the wrong role
- prompt format mutation
- missing PIN for governance change
- session touches files outside isolation boundary
- overlapping parallel session boundaries
- protected file touched without scope approval
- build failure
- unclear ownership
- verification mismatch between reported fix and visible UI outcome

---

## Final Law

This document is no longer just a handoff note.
It is an execution-control document under v4.0 governance.

If there is ever a conflict between speed and governed process, governed process wins.

---

## Status

Document Status: Updated for v4.0
Save Target: `C:\Users\chris\Desktop\Power On Hub\Power On Solutions APP - CoWork\poweron_app_handoff_spec.md`