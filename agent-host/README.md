# Agent Host ORCH-1

This directory contains the repo-local source for the PowerOn Agent Host foundation introduced in ORCH-1.

Current scope:

- Canonical repo detection
- Linked-worktree rejection
- Stable host identity and per-process instance identity
- External runtime state under `%LOCALAPPDATA%\PowerOn\AgentHost`
- Single-instance lock, heartbeat, lifecycle events, and owner status
- Local CLI version discovery for supported tools
- Deterministic tests using Node's built-in test runner

Out of scope for ORCH-1:

- Provider task execution
- App Brain wiring
- HTTP servers
- SQLite or Supabase runtime state
- Production interactions
