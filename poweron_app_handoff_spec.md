# PowerOn App — Handoff Specification

Version: V3.0 Production
Date: 2026-04-07
Status: **PRODUCTION**
Sessions Completed: B41–B50
Recent Commits: B47=2a31db6 · B48=adf4537 · B49=7d80579 · B50=0a0d6db

---

## Overview

PowerOn Hub is an intelligent business OS for electrical contractors. The V3 external prototype contains 10 feature views, 13 agent shells, a full NEXUS Prompt Engine, and all service stubs required to wire the app to Supabase, ElevenLabs, and Anthropic Claude.

This spec is the law for V3 → V2 main merge decisions. When in doubt, defer to this document.

---

## Architecture

**Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
**State:** Zustand (V2 main) / `store/index.ts` placeholder (V3 external)
**Data:** Supabase (PostgreSQL + Storage + Auth)
**AI Routing:** NEXUS Prompt Engine (`nexusPromptEngine.ts`)
**Voice:** OpenAI Whisper (transcription, language: `en`) + ElevenLabs (synthesis)
**Automation:** n8n (webhook-based)

---

## Panel Inventory (All 10 Views)

| Panel ID | Label | Section | View File | Status |
|---|---|---|---|---|
| `blueprint-ai` | Blueprint AI | Intelligence | `BlueprintAI.tsx` | Full view |
| `agent-mode-selector` | Agent Mode Selector | Intelligence | `AgentModeSelector.tsx` | Placeholder |
| `n8n-automation` | n8n Automation | Intelligence | `N8nAutomation.tsx` | Full view |
| `guardian` | GUARDIAN | Intelligence | `GuardianView.tsx` | Full view |
| `spark-live-call` | SPARK Live Call | Intelligence | `SparkLiveCall.tsx` | Full view |
| `lead-rolling-trend` | Lead Rolling Trend | Intelligence | `LeadRollingTrend.tsx` | Full view |
| `debt-killer` | Debt Killer | Business | `DebtKiller.tsx` | Full view |
| `voice-journaling-v2` | Voice Journaling V2 | Business | `VoiceJournalingV2.tsx` | Full view |
| `crew-portal` | Crew Portal | Business | `CrewPortal.tsx` | Full view |
| `demo-mode` | Demo Mode | Business | `DemoMode.tsx` | Placeholder |

All 10 views are registered in `App.tsx` as lazy-loaded React components wrapped in `<Suspense>`.

---

## Agent Descriptions

### GUARDIAN
**File:** `src/agents/guardian.ts`
**Role:** Proactive project health monitor. Evaluates guardian rules against project events and emits `alert_triggered` when violations are detected.
**Status:** Shell stub — `initGuardianAgent()` wires to agent bus on integration.
**Events emitted:** `alert_triggered`, `task_completed`
**View:** `GuardianView.tsx` — shows active rules, violations list, audit log, severity badges

### HUNTER
**Role:** Lead hunting and pipeline intelligence agent (referenced in V2 main roadmap).
**Status:** Not yet built in V3 external — planned for E17 integration sprint.
**Expected file:** `src/agents/hunter.ts`
**Expected events:** `lead_identified`, `lead_updated`
**Notes:** HUNTER will be wired to SPARK's lead pipeline. NEXUS routes `SPARK` queries to SPARK agent until HUNTER is live.

### SPARK
**File:** `src/agents/spark.ts` + `src/agents/sparkLiveCall.ts`
**Role:** Live call intelligence engine. Manages call scripts, stage progression, and outcome capture.
**Status:** Full call engine built. Scripts are mock; replace with Supabase `call_scripts` on integration.
**Events emitted:** `voice_note`, `lead_updated`

### NEXUS Prompt Engine
**File:** `src/agents/nexusPromptEngine.ts`
**Role:** Orchestration brain for all AI queries in PowerOn Hub. Handles query classification, ECHO context injection, multi-agent routing, prompt assembly, and structured response parsing.
**Status:** ✅ Full implementation — V3-19 / E16
**Agent route targets:** VAULT, OHM, LEDGER, BLUEPRINT, CHRONO, SPARK, ATLAS, NEXUS, MULTI

---

## NEXUS Prompt Engine — Full Documentation

### Public API

```typescript
classifyQuery(query: string): QueryClassification
injectEchoContext(query: string, window: EchoEntry[]): EchoInjection
buildNexusPrompt(request: NexusRequest): string
runNexusEngine(request: NexusRequest): Promise<NexusResponse>
```

### Query Classification

`classifyQuery()` scores each agent target via keyword matching and returns:
- `primaryTarget`: the best-matching agent route
- `secondaryTargets`: additional matched agents
- `confidence`: 0.0–1.0 normalized score
- `requiresDisambiguation`: true if vague entity references detected (e.g., "the project")
- `disambiguationQuestion`: a single clarifying question to ask the user
- `isMultiAgent`: true if BLUEPRINT + CHRONO co-occur, or if two agents tie

**Routing verified (V3-21 audit):**
- "What's the NEC requirement for kitchen receptacles?" → OHM (100%)
- "How much do I have in unbilled work?" → LEDGER (100%)
- "My pipeline is at $66k, should I take on more work?" → NEXUS (75%)

### ECHO Context Window

- Rolling 24-hour memory window per user
- Relevance scored using Jaccard similarity + tag boost
- Threshold: 0.6 (entries below threshold are not injected)
- Token budget: 4,000 tokens max injected per query
- Format: `[AGENT_SOURCE @ ISO_TIMESTAMP]: content`

### Response Format

NEXUS expects Claude to return raw JSON with this shape:

```json
{
  "speak": "Natural voice-ready text, 1–3 sentences",
  "display": [
    { "type": "metric_card|alert|chart|action_item|link", "title": "...", "value": "...", "label": "..." }
  ],
  "captures": [
    { "type": "entity|decision|task|financial|note", "label": "...", "value": "...", "agentSource": "...", "timestamp": "ISO" }
  ]
}
```

### Integration Requirements

1. Replace `callClaude()` stub in `claudeService.ts` with real `@anthropic-ai/sdk` call
2. Wire `echoWindow` parameter to Supabase query for last 24h context entries per user
3. Wire `agentMode` parameter to user's current AppState.agentMode
4. Register `runNexusEngine()` as the single entry point for all AI queries in V2 main

---

## Whisper Integration

**Language parameter:** `en` (not `en-US` — Whisper uses ISO 639-1 codes)
**Use case:** VoiceJournalingV2, SparkLiveCall transcription
**Integration point:** `elevenLabsService.ts` or a new `whisperService.ts`
**Confirmed:** All `en-US` locale references in source files updated to `en` as of V3-21

---

## Agent Mode

**Type:**
```typescript
type AgentMode = 'standard' | 'field' | 'office' | 'estimating' | 'executive';
```

**Store field:** `AppState.agentMode` (default: `standard`)
**Persistence:** `user_preferences.agent_mode` in Supabase
**NEXUS usage:** Injected as `USER MODE: FIELD` etc. into every NEXUS prompt

---

## Demo Mode

**Store field:** `AppState.demoMode` (default: `false`)
**UI indicator:** Orange banner at top of app — "⚠ DEMO MODE ACTIVE — Data shown is not real"
**Gate:** All mock data imports must check `demoMode` flag before loading
**Persistence:** `user_preferences.demo_mode` in Supabase

---

## Protected Files

The following files must NOT be modified during any merge or integration session:

| File | Reason |
|---|---|
| `src/store/authStore.ts` | Auth state — modify only in dedicated auth session |
| `netlify.toml` | Deployment config — modify only with DevOps approval |
| `src/services/backupDataService.ts` | Data safety service — modify only in dedicated session |
| `vite.config.ts` | Build config — frozen for V3 external build |
| `src/components/v15r/charts/SVGCharts.tsx` | V15R chart components — frozen, do not regress |

---

## Supabase Tables Required (V3 additions)

| Table | Feature |
|---|---|
| `user_preferences` | Agent Mode, Demo Mode |
| `guardian_rules` | GUARDIAN |
| `guardian_violations` | GUARDIAN |
| `guardian_audit_log` | GUARDIAN |
| `call_scripts` | SPARK Live Call |
| `call_sessions` | SPARK Live Call |
| `expenses` | Debt Killer |
| `debts` | Debt Killer |
| `user_financial_profile` | Debt Killer |
| `leads` | Lead Rolling Trend |
| `weekly_lead_snapshots` | Lead Rolling Trend |
| `journal_entries` | Voice Journaling V2 |
| `blueprint_uploads` | Blueprint AI |
| `blueprint_outputs` | Blueprint AI |
| `n8n_workflows` | n8n Automation |
| `n8n_trigger_log` | n8n Automation |
| `crew_members` | Crew Portal |
| `crew_tasks` | Crew Portal |
| `user_roles` | Crew Portal |

| `hub_platform_events` | Command Center / Hub Platform |
| `wins_log` | Wins Log (B51) |
| `guardian_config` | GUARDIAN Config (B51) |

**Supabase Storage buckets:** `voice-notes`, `blueprints`

**Migrations added (B46–B51 wave):**
- `059_hub_platform_events.sql`
- `060_wins_log.sql` (B51)
- `061_guardian_config.sql` (B51)

---

## Agent Bus Events

| Event | Emitter | Payload |
|---|---|---|
| `mode_switch` | AgentModeSelector | `{ from, to, userId }` |
| `alert_triggered` | GUARDIAN | `{ ruleId, violationId }` |
| `task_completed` | GUARDIAN, CrewPortal | `{ taskId }` |
| `voice_note` | VoiceJournaling, SparkLiveCall | `{ entryId, category, tags }` |
| `lead_updated` | LeadRollingTrend, SparkLiveCall | `{ leadId, status }` |
| `lead_identified` | HUNTER (planned) | `{ leadId }` |
| `field_log_created` | VoiceJournaling, CrewPortal | `{ logId }` |
| `blueprint_generated` | BlueprintAI | `{ uploadId, projectId }` |
| `task_created` | BlueprintAI | `{ taskId, projectId }` |
| `automation_triggered` | n8nAutomation | `{ workflowId, triggerEvent }` |

---

## New Dependencies for V2 Integration

| Package | Feature | Priority |
|---|---|---|
| `@anthropic-ai/sdk` | NEXUS / Blueprint AI | P0 |
| `@supabase/supabase-js` | All features | P0 |
| `pdfjs-dist` | Blueprint AI PDF extraction | P1 |
| `react-media-recorder` or `MediaRecorder` API | Voice Journaling | P1 |
| `elevenlabs` SDK | Voice synthesis | P2 |
| `eslint` + `@typescript-eslint/*` | Code quality | P1 (before merge) |

---

## New Files Added (B46–B51 Wave)

| Path | Description |
|---|---|
| `src/components/v15r/AIVisualSuite/` | Full AI Visual Suite folder — 15+ files, 43 modes, 3 buckets |
| `src/components/v15r/WinsLog/` | Wins Log component (B51) |
| `supabase/migrations/059_hub_platform_events.sql` | Hub Platform Events migration |
| `supabase/migrations/060_wins_log.sql` | Wins Log migration (B51) |
| `supabase/migrations/061_guardian_config.sql` | GUARDIAN Config migration (B51) |
| `POWERON_WORKFLOW.md` | Workflow rules document |

---

## AI Visual Suite

- **Location:** `src/components/v15r/AIVisualSuite/`
- **Modes:** 43 visual modes across 3 buckets
- **NEXUS default:** QuantumFoam
- **Audio pipeline:** `useNEXUSAudio` hook — live FFT wired to visuals
- **Navigation:** VISUAL SUITE available as a standalone panel; Visualization Lab accessible via admin; NEXUS Voice in sidebar

---

## Command Center

- **Tab 12:** Split View — live as of B46–B50 wave
- **Tab 13:** Unified Command — live as of B46–B50 wave

---

## Navigation Updates (B46–B51 Wave)

- VISUAL SUITE: standalone panel in nav
- Visualization Lab: admin-accessible
- NEXUS Voice: sidebar integration
- Collapsible sidebar: implemented
- Responsive layout: improved across breakpoints

---

## Known Remaining Items

- DaSparkyHub Session 2: pending
- Beta prep: pending

---

## Build Status (V3.0 Production)

- **npm run build:** ✅ PASS — zero TypeScript errors, zero Vite errors
- **ESLint:** Not configured — eslint package missing from devDependencies
- **All lazy-loaded views:** ✅ Present as separate chunk files in dist/
- **NEXUS routing:** ✅ 3/3 sample queries route correctly
- **en-US → en:** ✅ Applied to 5 files
- **AI Visual Suite:** ✅ 43 modes, QuantumFoam as NEXUS default
- **Command Center tabs 12+13:** ✅ Live (Split View + Unified Command)
- **Audio pipeline:** ✅ useNEXUSAudio hook, FFT wired to visuals
