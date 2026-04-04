# PowerOn Hub — Outsource Log

All external development work commissioned by
Christian Dubon, Power On Solutions LLC.
This document serves as the legal chain of custody
for all externally commissioned code.

Each entry references: developer identity, agreement
type, session scope, commit hash delivered, files
changed, scope verification result, and acceptance
status. This document is admissible as evidence of
IP ownership and development authorship.

---

## Log Format

Each entry follows this structure:
- Entry ID: sequential number
- Date: YYYY-MM-DD
- Developer: name or entity
- Agreement: NDA reference or "Internal"
- Session: session name and scope description
- Commit Hash: delivered hash
- Files Changed: list of files
- Scope Verified: Yes / No / Partial
- Accepted: Yes / No / Revision Required
- Notes: any flags, issues, or observations

---

## Entries

### Entry 001
- Date: 2026-04-02
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: S1 — MTO quantity fix, employee dropdown,
  textarea wrap
- Commit Hash: 849ae01
- Files Changed: V15rMTOTab.tsx, V15rEstimateTab.tsx,
  mtoExportService.ts
- Scope Verified: Yes
- Accepted: Yes
- Notes: Clean. No protected files touched.

### Entry 002
- Date: 2026-04-02
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: S3 — MTO zone tagging and multi-select
- Commit Hash: 9ca69bc
- Files Changed: V15rMTOTab.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Clean. One file only.

### Entry 003
- Date: 2026-04-02
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: S4 — RFI stage fields
- Commit Hash: 20ffb58
- Files Changed: V15rRFITab.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Clean. One file only. 56 lines added.

### Entry 004
- Date: 2026-04-02
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: S5 — MTO placement bug fix
- Commit Hash: 9ced518
- Files Changed: V15rMTOTab.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Clean. Root cause was onChange committing
  to data layer on every keystroke.

### Entry 005
- Date: 2026-04-02
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: S6 — Progress tab phase order and drag
- Commit Hash: e14c68d
- Files Changed: V15rProgressTab.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Clean. HTML5 native DnD, no new dependency.

### Entry 006
- Date: 2026-04-02
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: S7 — Offline sync root cause fix
- Commit Hash: a645a73
- Files Changed: public/sw.js, V15rLayout.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Root cause: SW intercepting Supabase POST
  requests with expiring auth tokens. Fixed.

### Entry 007
- Date: 2026-04-03
- Developer: Claude Console
- Agreement: Internal — no NDA required
- Session: B1 — GUARDIAN missing export fix 1
- Commit Hash: 7008643
- Files Changed: src/agents/guardian.ts
- Scope Verified: Yes
- Accepted: Yes
- Notes: Console used for surgical single-function
  addition. Clean.

### Entry 008
- Date: 2026-04-03
- Developer: Claude Console
- Agreement: Internal — no NDA required
- Session: B2 — GUARDIAN missing export fix 2
- Commit Hash: df39f9e
- Files Changed: src/agents/guardian.ts
- Scope Verified: Yes
- Accepted: Yes
- Notes: All GuardianPanel stubs added in one shot.
  Clean.

### Entry 009
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B3 — Chrome iOS auth fix + PIN foundation
- Commit Hash: fca2763
- Files Changed: public/sw.js, LoginFlow.tsx,
  PinAuth.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: SW auth bypass confirmed. PIN SHA-256 hashed.
  authStore.ts not touched. Clean.

### Entry 010
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B4 — CHANGELOG and OUTSOURCE_LOG creation
- Commit Hash: 4990bf7
- Files Changed: CHANGELOG.md, OUTSOURCE_LOG.md
- Scope Verified: Yes
- Accepted: Yes
- Notes: Two new audit documents created. No existing files modified.

### Entry 011
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B5 — Demo mode banner z-index fix
- Commit Hash: fe6a6f4
- Files Changed: src/App.tsx, src/components/v15r/V15rLayout.tsx, src/components/v15r/V15rSettingsPanel.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Banner moved below header. Nav z-index raised. Sidebar z-index raised. Hamburger button now accessible on iPhone and iPad.

### Entry 012
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B6 — Logout button and session security
- Commit Hash: a5b27bf
- Files Changed: src/components/v15r/V15rLayout.tsx, src/components/v15r/V15rSettingsPanel.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Sign Out button added to sidebar and Settings. PIN change toast with Sign Out Everywhere added. Session persistence already configured — no change needed.

### Entry 013
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B7 — Demo user invite flow
- Commit Hash: ab09314
- Files Changed: src/components/admin/DemoInvite.tsx, src/hooks/useDemoLimits.ts, src/services/demoDataService.ts, src/components/v15r/V15rTeamPanel.tsx, src/components/v15r/V15rSettingsPanel.tsx, src/App.tsx, supabase/migrations/049_add_demo_tier_columns.sql
- Scope Verified: Yes
- Accepted: Yes
- Notes: Schema migration renamed from 031 to 049 to avoid sequence conflict. Migration applied directly via Supabase SQL Editor. Demo data auto-population: 3 projects + 5 service calls per invited user.

### Entry 014
- Date: 2026-04-03
- Developer: Console / Christian Dubon
- Agreement: Internal — no NDA required
- Session: Migration sequence fix — renamed 031 to 049
- Commit Hash: 62adc26
- Files Changed: supabase/migrations/049_add_demo_tier_columns.sql
- Scope Verified: Yes
- Accepted: Yes
- Notes: Two sequence conflicts found (031, 046). Resolved by renaming to 049. No SQL changes — rename only.

### Entry 015
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B8 — Pipeline logic + Estimate Overview + RFI stage fields
- Commit Hash: d4525e6
- Files Changed: backupDataService.ts, V15rLayout.tsx, V15rEstimateTab.tsx, V15rProjectsPanel.tsx, V15rRFITab.tsx
- Scope Verified: Yes — backupDataService.ts change reviewed and accepted (getKPIs filter + event dispatch only)
- Accepted: Yes
- Notes: Pipeline now filters active projects only. WON box reads active project contracts. RFI closure bug fixed — reads fresh localStorage on every edit.

### Entry 016
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B9 — Home greeting + Progress layout + Collection routing
- Commit Hash: 450b277
- Files Changed: V15rHome.tsx, V15rProgressTab.tsx, V15rProjectsPanel.tsx, AppShell.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Greeting now time-aware with first name from profiles.full_name. Progress tab redesigned to two-column layout. Collect badge and payment modal added to completed projects.

### Entry 015
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B8 — Pipeline logic + Estimate Overview + RFI stage fields
- Commit Hash: d4525e6
- Files Changed: backupDataService.ts, V15rLayout.tsx, V15rEstimateTab.tsx, V15rProjectsPanel.tsx, V15rRFITab.tsx
- Scope Verified: Yes — backupDataService.ts reviewed and accepted
- Accepted: Yes
- Notes: Pipeline filters active projects only. WON box reads active contracts. RFI closure bug fixed.

### Entry 016
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B9 — Home greeting + Progress layout + Collection routing
- Commit Hash: 450b277
- Files Changed: V15rHome.tsx, V15rProgressTab.tsx, V15rProjectsPanel.tsx, AppShell.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Time-aware greeting with first name. Progress two-column layout. Collect badge and payment modal added.

### Entry 017
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: B10 — MTO Google search button
- Commit Hash: 64fc361
- Files Changed: src/components/v15r/V15rMTOTab.tsx
- Scope Verified: Yes — one file only
- Accepted: Yes
- Notes: Search button appears inline when item not in price book. Opens Google search in new tab. Disappears on price book match. No new dependencies.

### Entry 018
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: V1+V2 — NEXUS routing fix + agent response quality
- Commit Hash: fcc4516
- Files Changed: classifier.ts, router.ts, index.ts, nexus/systemPrompt.ts, ledger/systemPrompt.ts, scout/systemPrompt.ts
- Scope Verified: Yes
- Accepted: Yes
- Notes: NEXUS now responds first. Specialist agents suppressed when redundant. Narrative format replacing bullet dumps. SCOUT silenced in conversation thread.

### Entry 019
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: V3 — SCOUT background mode
- Commit Hash: f2c4bb3
- Files Changed: scoutQueue.ts, NexusChatPanel.tsx, ProposalFeed.tsx
- Scope Verified: Yes
- Accepted: Yes
- Notes: Silent queue wired in code. SCOUT responses filtered from chat thread. Flagged Improvements tab added to Scout panel.

### Entry 020
- Date: 2026-04-03
- Developer: Cowork AI Builder
- Agreement: Internal — no NDA required
- Session: V4 — Command vs insight detection
- Commit Hash: 1898a77
- Files Changed: classifier.ts, index.ts
- Scope Verified: Yes — vite.config.ts flag from prior commit, not this session
- Accepted: Yes
- Notes: Four intent types: command, action, insight, ambiguous. Ambiguous triggers one-time clarification question. Commands confirmed with storage acknowledgment.
