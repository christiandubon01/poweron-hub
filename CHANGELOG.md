# PowerOn Hub — Changelog

All sessions commissioned by Christian Dubon,
Power On Solutions LLC, C-10 #1151468.
This document is a legal audit trail of all
development work performed on this codebase.

---

## [v2.1.0] — 2026-04-02

### Session S1 | MTO + Estimate Fixes
- Commit: 849ae01
- Files: src/components/v15r/V15rMTOTab.tsx,
  src/components/v15r/V15rEstimateTab.tsx
- Changes: Quantity decrement fixed to whole numbers.
  Employee dropdown added per labor task pulling from
  team roster. Task description textarea overflow fixed.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director

### Session S2 | MTO PDF Export Rebuild
- Commit: 849ae01
- Files: src/services/mtoExportService.ts,
  src/components/v15r/V15rMTOTab.tsx
- Changes: Material Summary PDF rebuilt matching exact
  old HTML app format. Supplier-facing, no cost columns,
  deduplicated by item name, grouped by material family.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director

### Session S3 | MTO Zone Tagging
- Commit: 9ca69bc
- Files: src/components/v15r/V15rMTOTab.tsx
- Changes: Optional placement and note fields per MTO
  row. Grouping by placement when tagged. Multi-select
  with drag range and Ctrl+Click. Floating action bar
  for bulk assign. Confirmation dialog for 2+ items.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director

### Session S4 | RFI Stage Fields
- Commit: 20ffb58
- Files: src/components/v15r/V15rRFITab.tsx
- Changes: Stage Recorded and Stage Applies dropdowns
  added to every RFI card. Options: Estimating,
  Underground, Rough-In, Trim, Finish, General.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director

### Session S5 | MTO Placement Bug Fix
- Commit: 9ced518
- Files: src/components/v15r/V15rMTOTab.tsx
- Changes: Fixed focus loss on placement field typing.
  Fixed live bucket collapsing on keystroke. Fixed
  empty field always visible. Local state pattern
  implemented — commits on blur/Enter only.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director

### Session S6 | Progress Tab Redesign
- Commit: e14c68d
- Files: src/components/v15r/V15rProgressTab.tsx
- Changes: Default phase order enforced. Custom phase
  creation added. Task drag-to-reorder within phases
  using HTML5 native API.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director

### Session S7 | Offline Sync Root Cause Fix
- Commit: a645a73
- Files: public/sw.js,
  src/components/v15r/V15rLayout.tsx
- Changes: Service worker no longer intercepts Supabase
  REST POST requests. Active connectivity check added.
  visibilitychange flush trigger added. 60-second
  periodic flush added.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director

---

## [v2v3-beta] — 2026-04-03

### Session B1 | GUARDIAN Missing Exports Fix 1
- Commit: 7008643
- Files: src/agents/guardian.ts
- Changes: Added CrewFieldLog type and
  reviewPendingLogs stub to unblock
  MorningBriefingCard import.
- Commissioned by: Christian Dubon
- Executed by: Claude Console
- Verified by: Claude Architect/Director

### Session B2 | GUARDIAN Missing Exports Fix 2
- Commit: df39f9e
- Files: src/agents/guardian.ts
- Changes: Added markLogReviewed, markAllLogsReviewed,
  getActivityFeed, runActivityAnalysis,
  routeGuardianAlerts, Flag, ActivityEntry,
  ActivityAnomalyType stubs to unblock
  GuardianPanel build.
- Commissioned by: Christian Dubon
- Executed by: Claude Console
- Verified by: Claude Architect/Director

### Session B3 | Chrome iOS Auth Fix + PIN Foundation
- Commit: fca2763
- Files: public/sw.js,
  src/components/auth/LoginFlow.tsx,
  src/components/auth/PinAuth.tsx
- Changes: Service worker auth bypass added for all
  auth callback routes. PIN auth foundation built —
  6-digit, SHA-256 hashed, 5-attempt lockout, 30s
  cooldown, setup flow, magic link fallback.
- Commissioned by: Christian Dubon
- Executed by: Cowork AI Builder
- Verified by: Claude Architect/Director
