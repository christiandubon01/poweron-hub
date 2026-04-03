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
