# App Brain Watch Mode Design Contract

**Version:** 1.0  
**Date:** June 7, 2026  
**Status:** Design Specification (Not Implemented)  
**Scope:** Future watch mode implementation guidance  
**Wave:** APPBRAIN-WAVE03-A5  

---

## Executive Summary

This document specifies the design contract for a future **App Brain Watch Mode** that will monitor source-controlled development artifacts and maintain real-time awareness of repository state, work manifest freshness, directory structure changes, and git status snapshots.

Watch mode is **defined but not implemented** in this wave. This document serves as a specification boundary for a future implementation session.

---

## Watch Mode Purpose

The App Brain Watch Mode will:
- Continuously monitor the workspace for changes to work manifests, directory structure, and git status
- Maintain a lightweight snapshot of repository state without modifying files
- Refresh metadata artifacts that track development progress and architecture state
- Enable command-driven watch execution through a future `npm run app-brain:watch` command
- Provide type-safe interfaces for watch events, sources, and results

**Non-Goal:** Watch mode does NOT execute build tasks, modify business logic, or create persistent deployment state.

---

## Core Responsibilities

### 1. Work Manifest Refresh
- Monitor `generatedAppBrainWorkManifest.ts` for staleness relative to actual work artifacts
- Track when manifest last reflected actual component/panel registrations
- Queue refresh signal (does not execute refresh, only signals need)
- Report refresh timestamp and staleness indicator

### 2. Directory Manifest Refresh
- Monitor `generatedAppBrainDirectory.ts` for staleness relative to actual file structure
- Track scoped file boundaries and isolation folder assignments
- Queue refresh signal when directory structure changes detected
- Report directory change timestamp and affected paths

### 3. Context Freshness Validation
- Monitor `solarupgrade_agent_context/` metadata files for coherence with active session state
- Validate that session reports, rules, and active sessions JSON remain synchronized
- Flag stale or orphaned session records
- Report freshness status and age of last update

### 4. Git Status Snapshot
- Capture current git branch, staging status, and pending commits
- Record HEAD commit hash and diff status
- Snapshot untracked files and modified files
- **Do NOT stage or commit** — snapshot only

### 5. Safety Constraints
- **Never modify `.claude/settings.local.json`**
- **Never modify `package.json` or `package-lock.json`**
- **Never modify protected files** without explicit scope approval
- **Never create uncontrolled commits** — staging is manual and explicit
- **Never capture secrets** — ignore `.env` files and credential data
- **Never include noisy build artifacts** — exclude `node_modules`, `dist`, `.vite` cache

### 6. No Live Claim Unless Running
- Watch mode must NOT claim ownership of a file or command unless actively running
- State file must reflect watch status (idle, running, paused)
- Only report active watches when subprocess is alive

---

## Type Contract

All watch mode types are defined in `src/components/v15r/app-brain/appBrainWatchModeContract.ts` and must include:

### WatchEvent
```typescript
interface WatchEvent {
  id: string;                      // unique event ID
  timestamp: number;               // epoch ms
  source: WatchSource;             // what triggered this
  type: 'refresh' | 'status' | 'snapshot' | 'error';
  payload: Record<string, unknown>;
  severity: 'info' | 'warning' | 'error';
}
```

### WatchSource
```typescript
type WatchSource = 
  | 'work-manifest'
  | 'directory-manifest'
  | 'context-freshness'
  | 'git-status'
  | 'isolation-boundary'
  | 'config-watch'
  | 'user-command';
```

### SnapshotStatus
```typescript
interface SnapshotStatus {
  branch: string;
  currentCommit: string;
  isDirty: boolean;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  timestamp: number;
}
```

### RefreshResult
```typescript
interface RefreshResult {
  source: WatchSource;
  needsRefresh: boolean;
  lastRefreshTime: number;
  staleness: 'fresh' | 'stale' | 'unknown';
  message: string;
  affectedPaths?: string[];
}
```

### WatchErrorState
```typescript
interface WatchErrorState {
  eventId: string;
  source: WatchSource;
  error: string;
  context?: Record<string, unknown>;
  recoverable: boolean;
  timestamp: number;
}
```

### WatchModeConfig
```typescript
interface WatchModeConfig {
  enabled: boolean;
  pollIntervalMs: number;           // how often to check for changes
  includeUntracked: boolean;        // whether to track untracked files
  includeGitStatus: boolean;        // whether to snapshot git status
  refreshOnDirectoryChange: boolean;
  refreshOnManifestAge: boolean;
  maxSnapshotAge: number;           // ms before forcing new snapshot
  excludePatterns: string[];        // glob patterns to ignore
  safeMode: boolean;                // if true, never stages or commits
}
```

---

## Future Command Contract

A future implementation will support:

```bash
npm run app-brain:watch
```

**Expected behavior (future):**
- Runs watch mode subprocess
- Polls work manifest, directory manifest, context freshness every 5 seconds
- Captures git status snapshot every 30 seconds
- Logs watch events to `solarupgrade_agent_context/watch-mode-events.log`
- Allows graceful shutdown with `Ctrl+C`
- Respects safe mode constraints (never stages, never commits)

**Exit behavior (future):**
- Returns exit code 0 on graceful shutdown
- Returns exit code 1 if unrecoverable error occurs
- Removes any watch state file on exit

---

## Safety Design

Watch mode must implement these constraints:

### 1. No Implicit Staging
- Watch mode NEVER auto-stages files
- Manual `git add` commands remain user responsibility
- Watch events are logged only

### 2. No Implicit Commits
- Watch mode NEVER auto-commits changes
- User must run `git commit` explicitly
- Watch mode may suggest commit messages, but never executes them

### 3. No Secrets in Events
- Filter `.env*` files from watch events
- Filter credential files from snapshots
- Never log env values or secret keys

### 4. Opt-In Design
- Watch mode is disabled by default
- User must explicitly enable via config or `--enable` flag (future)
- No watch mode runs without explicit user action

### 5. Graceful Degradation
- If a watch source fails (e.g., git command timeout), log error and continue
- Never crash the entire watch process for one source failure
- Report errors in event log with recovery suggestions

---

## Interaction with App Brain State

Watch mode events must integrate with App Brain without modifying its state machine:

- Watch events feed into `AppBrainContextHubPanel` for visibility (future UI)
- Watch status appears in `AppBrainSkillsPanel` or dedicated status panel (future UI)
- Watch events are logged to JSON file for audit trail
- Watch mode does NOT modify `generatedAppBrainManifest.ts`, `generatedAppBrainDirectory.ts`, or work manifest

**Generation happens separately:** Manifest refresh is triggered manually via `npm run generate-app-brain-*` scripts. Watch mode only signals the need.

---

## File Locations and Naming

### Configuration
- `solarupgrade_agent_context/watch-mode-config.json` (future)
- `solarupgrade_agent_context/watch-mode-state.json` (future, ephemeral)

### Logs
- `solarupgrade_agent_context/watch-mode-events.log` (future)
- `solarupgrade_agent_context/watch-mode-errors.log` (future)

### Type Definitions
- `src/components/v15r/app-brain/appBrainWatchModeContract.ts` (current session)

### Design Reference
- `solarupgrade_agent_context/APP_BRAIN_WATCH_MODE_DESIGN.md` (current session)

---

## Implementation Phases (Future)

### Phase 1: Type Definition & Config
- Define all types in contract file ✓ (this session)
- Define config interface (this session)
- Create watch-mode-config.json template (future)

### Phase 2: Core Watch Loop
- Implement file system watcher (future)
- Implement git status snapshot logic (future)
- Implement manifest staleness detection (future)
- Implement event logging (future)

### Phase 3: Command Integration
- Wire `npm run app-brain:watch` script (future)
- Add graceful shutdown handling (future)
- Add error recovery logic (future)

### Phase 4: UI Integration
- Create watch status panel (future)
- Display watch events in context hub (future)
- Add watch enable/disable toggle (future)

---

## Constraints & Dependencies

### No Script Implementation in This Wave
- This document defines the contract only
- No `scripts/watch-app-brain.mjs` is created
- No package.json modifications
- No npm script definitions

### Protected Surface
- Watch mode is a **read-only observer**
- Does not modify any source files
- Does not modify any generated manifests
- Does not execute builds or scripts
- Does not commit to git

### Dependencies on Future Sessions
- UI integration depends on Wave 04 or later
- Config template depends on finalization of all watch sources
- Error recovery patterns may depend on observing real watch behavior

---

## Success Criteria for This Session

- [x] Type definitions are complete and compile
- [x] Design document covers all core responsibilities
- [x] Safety constraints are explicit
- [x] No implementation code exists
- [x] No script changes
- [x] No package.json changes
- [x] File locations and naming conventions are defined
- [x] Future implementation phases are clear

---

## Next Steps After This Session

1. **Future Wave Implementation:** Create scripts/watch-app-brain.mjs with watch loop logic
2. **Config Template:** Create watch-mode-config.json with sensible defaults
3. **Test Watch Loop:** Verify watch events are captured correctly without side effects
4. **UI Integration:** Wire watch status and events into App Brain UI panels
5. **Merge to Main:** After UI integration tested, merge appbrain-w03-a5-watch-mode-contract

---

## References

- `src/components/v15r/app-brain/appBrainWatchModeContract.ts` — Type definitions
- `scripts/generate-app-brain-manifest.mjs` — Manifest generation (watch mode complements, not replaces)
- `solarupgrade_agent_context/` — Session and context metadata that watch mode monitors
- App Brain architecture in `V15rAppBrainTab.tsx`, `V15rAppBrainScene.tsx`

---

**Document Status:** Complete design specification  
**Implementation Status:** Not started  
**Ready for Future Implementation:** Yes
