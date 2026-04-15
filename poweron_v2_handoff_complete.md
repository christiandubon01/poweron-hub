# Power On Hub V2 - Complete Technical Handoff

Version target: V4.0 React app
Architecture baseline: React 18 + TypeScript + Vite + Tailwind CSS
Governance baseline: v4.0 law stack
Approval: Christian - PIN Confirmed
Last updated: April 12, 2026

This document is the complete technical handoff reference for the Power On Hub app under the v4.0 operating model.

It is no longer just a technical snapshot. It is now governed by:
1. Christian's direct instruction
2. PIN-approved v4.0 laws
3. POWERON_MASTER_REFERENCE_v4_0
4. VERSION_CHANGELOG_v4_0

If this document conflicts with any higher authority in that stack, this document must defer upward.

---

## Section 1 - App Identity

### What this app is
Power On Hub is an internal operating system for Power On Solutions, LLC, a California electrical contractor.

It is used to run:
- estimating
- project tracking
- service call logging
- collections
- price book management
- material takeoff
- dashboards
- field/mobile operations
- AI-assisted operational workflows

### Who uses it
Primary user:
- Christian / owner-operator

Future support:
- crew/team support
- remote command workflows
- governed AI-assisted execution
- future CrewAI expansion

### Primary devices
- Windows desktop/laptop
- iPad
- iPhone

### Deployment model
- Frontend: React 18 + TypeScript + Vite + Tailwind
- Deploy target: Netlify
- Backend/data sync: Supabase
- AI integrations: OpenAI / Anthropic / ElevenLabs as approved
- Multi-device support: desktop + mobile
- Queue/execution system: external session queue + inject/get/done flow

---

## Section 2 - v4.0 Governance Layer

This app now operates under strict governance.

### New non-negotiable laws
- Channel B owns interviews and CHANGE_SPEC generation only
- Channel A owns Gemini audits, Cowork prompts, inject scripts, post-session flow, and failure analysis only
- Gemini is code-reading only
- Any law/rule/prompt/reference change requires Christian's PIN
- Cowork prompt format is frozen
- Codebase isolation is mandatory
- Small-batch quality protocol is mandatory
- Feedback loop law is mandatory
- Versioned changelog tracking is mandatory

### Execution consequence
No technical task should be treated as valid unless it fits inside the v4.0 approval and execution chain.

---

## Section 3 - Required Approval Sequence

Every feature or fix must follow this order:

1. Christian starts with Channel B
2. Channel B conducts interview
3. Channel B summarizes proposed change
4. Channel B asks:
   "Does this align with your 5/10/15/20 year vision?"
5. If no: iterate
6. If yes: request PIN
7. Christian provides PIN
8. Spec is locked
9. Channel A takes over
10. Gemini audit happens if required
11. Channel A prepares inject script / Cowork prompt
12. Session executes
13. Post-session sequence runs
14. Push/deploy happens only after validation

No other path is authorized.

---

## Section 4 - Role Boundaries

### Channel B
Owns:
- interviews
- strategic clarification
- summary
- alignment check
- PIN request
- CHANGE_SPEC lock

Never owns:
- Cowork prompts
- inject scripts
- failure analysis
- post-session commands

### Channel A
Owns:
- Gemini audit requests after spec lock
- Cowork prompt generation
- inject script generation
- queue operations
- post-session sequence
- failure analysis

Never owns:
- interviews
- CHANGE_SPEC writing

### Gemini
Owns:
- reading code
- tracing routes
- identifying actual fault points
- reporting findings

Never owns:
- writing specs
- proposing workflow law
- writing inject scripts
- writing implementation prompts as final authority

If any role drifts, stop and report.

---

## Section 5 - Codebase Isolation Architecture

This is now active law.

### Required direction
`src/views/` must move toward feature subfolders, not a flat file surface.

Examples:
- `src/views/visual-suite/`
- `src/views/neural-world/`
- `src/views/orb-lab/`

### Isolation rules
- every session must define an isolation folder
- no session edits outside its boundary
- parallel sessions must use non-overlapping boundaries
- protected files remain protected
- canary file support remains valid
- `ignition.js` is the runtime isolation enforcement layer

If file ownership or isolation is unclear, the session must stop.

---

## Section 6 - Ownership Map Principle

Each agent or feature zone must have bounded ownership.

Examples:
- Visual Suite work must stay inside Visual Suite boundaries
- Neural World work must stay inside Neural World boundaries
- ORB LAB work must stay inside ORB LAB boundaries
- queue/tooling work must not mutate unrelated app features
- protected app surfaces require explicit scope

A formal ownership map should be maintained as a separate companion reference.

---

## Section 7 - Prompt Format Lock

The Cowork prompt format is permanently frozen unless Christian changes it with PIN approval.

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

No improvisation is allowed.

---

## Section 8 - Execution Standard

A session is valid only if it:
- has an approved locked spec
- has the correct role owner
- has the correct working directory
- has defined isolation folder
- has protected files listed
- has canary file if needed
- uses the frozen prompt format
- ends with build verification
- ends with commit hash only
- ends with `node done.js`

If any requirement is missing, the session is not ready.

---

## Section 9 - Small Batch Quality Protocol

Scale must be earned.

### Rule
Start with 1-3 sequential sessions.

### Scale gate
Do not expand until:
- 20 sessions are completed
- rework is under 5%

After that, wave size may expand based on scope and proven quality.

### Priority
Quality over speed always.

---

## Section 10 - Feedback Loop Law

### Every 15 minutes
Each active model must report:
- Am I performing to my role?
- Am I aligned with the other models?

Output:
- `On role`
- or `Off role + what drifted`

### Every 60 minutes
Acknowledge prior checks and ask Christian:
- "How do you feel about the conversation flow? Is it working?"

Then listen and adjust.

### Every 4 hours
Detect:
- fatigue
- overload
- frustration
- context drift

Then report whether to continue or pause.

### Daily 10 PM checkpoint
Channel B + Channel A must summarize:
- what was attempted
- what shipped
- what needs adjustment tomorrow

---

## Section 11 - Technical Baseline

### Frontend
- React 18
- TypeScript
- Vite
- Tailwind CSS

### State
- Zustand and related app stores
- local persistence where applicable
- synced state support where applicable

### Data
- Supabase
- table-driven persistence
- storage buckets as needed

### AI / Voice
- Anthropic / OpenAI / ElevenLabs integrations where approved and wired
- governed through the v4.0 role system
- future CrewAI must inherit same control model

### Deployment
- Netlify deploy target
- GitHub-backed source
- protected deployment/config surfaces remain protected

---

## Section 12 - Protected Files

The following remain protected unless a session explicitly scopes them:

| File | Reason |
|---|---|
| `src/store/authStore.ts` | Auth state protection |
| `netlify.toml` | Deployment config protection |
| `src/services/backupDataService.ts` | Data safety protection |
| `vite.config.ts` | Build config protection |
| `src/components/v15r/charts/SVGCharts.tsx` | Frozen chart surface |

Additional protected files may be declared per session.

---

## Section 13 - Build and Completion Rule

A session is not complete until it finishes the required completion flow:

1. `npm run build`
2. `git add src/`
3. `git commit`
4. return hash only
5. `node done.js`

Anything short of that is incomplete.

---

## Section 14 - Post-Session Rule

The post-session command flow belongs to the established Channel A workflow.

This technical handoff recognizes that post-session discipline must be followed exactly in the approved order defined by the active habit/workflow guide.

Reference:
- `POWERON_USER_DAILY_HABIT_GUIDE_v4_0.html`

---

## Section 15 - Version Traceability

This document is part of the v4.0 governance package.

Required companion documents:
- `POWERON_MASTER_REFERENCE_v4_0.html`
- `POWERON_USER_DAILY_HABIT_GUIDE_v4_0.html`
- `VERSION_CHANGELOG_v4_0.md`
- `CREWAI_PRESPEC_v4_0.md`

Older versions must be archived and never deleted.

---

## Section 16 - Stop Conditions

Stop immediately and report if:
- the wrong role owns the task
- a spec is written by the wrong channel
- a governance change lacks PIN
- the prompt format drifts
- isolation boundary is unclear
- overlapping parallel sessions exist
- protected files are touched without scope
- visible UI does not match claimed fix
- build fails
- ownership map is violated

---

## Section 17 - Final Law

This document is now a governed technical handoff under v4.0.

It must be read as both:
- a technical baseline
- an execution control reference

If there is ever a conflict between speed and governed process, governed process wins.

---

## Status

Document Status: Updated for v4.0
Save Target: `C:\Users\chris\Desktop\Power On Hub\Power On Solutions APP - CoWork\poweron_v2_handoff_complete.md`