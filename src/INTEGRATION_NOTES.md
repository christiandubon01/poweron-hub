# PowerOn Hub V3 — Integration Notes

Generated: 2026-04-05 (Updated V3-21 Final Audit)
Scope: E15 Integration Prep — External prototype → Main app handoff

---

## V3-21 Audit Updates

**Build Status:** ✅ PASS — zero errors, 1517 modules transformed
**Lint:** ESLint not installed (package not in devDependencies — pre-existing gap, add eslint before merge)
**en-US → en:** Fixed in 5 files (AgentModeSelector.tsx, DebtKiller.tsx, GuardianView.tsx, N8nAutomation.tsx, VoiceJournalingV2.tsx)
**NEXUS Prompt Engine routing:** ✅ 3/3 sample queries route correctly

---

## All V3 New Files

### Views (10 total)
| File | Status |
|---|---|
| `src/views/AgentModeSelector.tsx` | Placeholder view — agent shell stub |
| `src/views/BlueprintAI.tsx` | Full view — full pipeline built |
| `src/views/CrewPortal.tsx` | Full view — agent shell stub |
| `src/views/DebtKiller.tsx` | Full view — agent shell stub |
| `src/views/DemoMode.tsx` | Placeholder view — agent shell stub |
| `src/views/GuardianView.tsx` | Full view — agent shell stub |
| `src/views/LeadRollingTrend.tsx` | Full view — agent shell stub |
| `src/views/N8nAutomation.tsx` | Full view — agent shell stub |
| `src/views/SparkLiveCall.tsx` | Full view — full call engine built |
| `src/views/VoiceJournalingV2.tsx` | Full view — agent shell stub |

### Agents (13 total)
| File | Notes |
|---|---|
| `src/agents/agentModeSelector.ts` | Stub |
| `src/agents/blueprint.ts` | Full keyword-matching pipeline (stub Claude calls) |
| `src/agents/blueprintAI.ts` | Full pipeline orchestrator (stub Claude calls) |
| `src/agents/crewPortal.ts` | Stub |
| `src/agents/debtKiller.ts` | Stub |
| `src/agents/demoMode.ts` | Stub |
| `src/agents/guardian.ts` | Stub |
| `src/agents/leadRollingTrend.ts` | Stub |
| `src/agents/n8nAutomation.ts` | Stub |
| `src/agents/nexusPromptEngine.ts` | **Full implementation** — NEXUS Prompt Engine V3-19 |
| `src/agents/spark.ts` | Full call script engine (mock scripts) |
| `src/agents/sparkLiveCall.ts` | Full call session manager |
| `src/agents/voiceJournalingV2.ts` | Stub |

### Services (3 total)
| File | Notes |
|---|---|
| `src/services/claudeService.ts` | Stub — replace with real Anthropic SDK |
| `src/services/elevenLabsService.ts` | Stub — replace with real ElevenLabs SDK |
| `src/services/supabaseService.ts` | Stub — replace with real Supabase client |

### Store / Types / Mock (3 total)
| File | Notes |
|---|---|
| `src/store/index.ts` | AppState with agentMode, demoMode — **SAFE COPY** |
| `src/types/index.ts` | All V3 types — **MERGE REQUIRED** (extends V2 types) |
| `src/mock/index.ts` | All mock data — **DO NOT COPY** to main (replace with Supabase queries) |

### App Shell (2 total)
| File | Notes |
|---|---|
| `src/App.tsx` | Full V3 shell — 10 lazy-loaded views, sidebar, demo banner |
| `src/main.tsx` | Standard React entry — no changes from V2 |

---

## Modified Files (V3 vs V2 Baseline)

These files were modified during V3 development and diverge from the V2 main repo:

| File | Change Type | Conflict Risk |
|---|---|---|
| `src/App.tsx` | Full rewrite — new sidebar, lazy routes, demo mode | **HIGH** — V2 has different routing structure |
| `src/types/index.ts` | Additive — 20+ new types added | **MEDIUM** — merge new types, don't overwrite existing |
| `src/store/index.ts` | Additive — agentMode + demoMode added to AppState | **MEDIUM** — merge new fields into V2 AppState |
| `src/mock/index.ts` | Additive — mock data for all 10 features | **LOW** — only used in external build, gate behind demoMode |

---

## Merge Order

### Phase 1 — Safe Direct Copies (no conflicts expected)
Copy these files verbatim from V3 external → V2 main:
1. `src/views/BlueprintAI.tsx`
2. `src/views/CrewPortal.tsx`
3. `src/views/DebtKiller.tsx`
4. `src/views/GuardianView.tsx`
5. `src/views/LeadRollingTrend.tsx`
6. `src/views/SparkLiveCall.tsx`
7. `src/views/VoiceJournalingV2.tsx`
8. `src/views/N8nAutomation.tsx`
9. `src/views/DemoMode.tsx`
10. `src/views/AgentModeSelector.tsx`
11. `src/agents/nexusPromptEngine.ts`
12. `src/agents/blueprint.ts`
13. `src/agents/blueprintAI.ts`
14. `src/agents/spark.ts`
15. `src/agents/sparkLiveCall.ts`
16. `src/agents/crewPortal.ts`
17. `src/agents/debtKiller.ts`
18. `src/agents/guardian.ts`
19. `src/agents/leadRollingTrend.ts`
20. `src/agents/voiceJournalingV2.ts`
21. `src/agents/n8nAutomation.ts`
22. `src/agents/agentModeSelector.ts`
23. `src/agents/demoMode.ts`
24. `src/services/claudeService.ts` (stub — replace with real SDK)
25. `src/services/elevenLabsService.ts` (stub)
26. `src/services/supabaseService.ts` (stub)

### Phase 2 — Manual Merges Required
These files require careful diff and hand-merge:

27. `src/types/index.ts` — Add all new V3 types to existing V2 types file; do not overwrite
28. `src/store/index.ts` — Add `agentMode` and `demoMode` fields to existing V2 AppState interface

### Phase 3 — App Routing Additions (manual, in V2 App.tsx or router)
29. Register all 10 views as routes in V2's routing system (React Router or equivalent)
30. Add all 10 sidebar entries to V2 navigation
31. Add GUARDIAN and HUNTER references to V2 agent registry
32. Add demo mode banner logic to V2 App root
33. Add `<Suspense>` wrapper around lazy-loaded route components

### Phase 4 — Protected Files (verify, do not touch)
These files must NOT be modified during merge:
- `src/store/authStore.ts`
- `netlify.toml`
- `src/services/backupDataService.ts`
- `vite.config.ts`
- `src/components/v15r/charts/SVGCharts.tsx`

---

## Potential Conflicts with V2 Main Repo

| Conflict | Risk Level | Resolution |
|---|---|---|
| `App.tsx` routing structure | HIGH | Do not copy V3 App.tsx wholesale; manually add routes/sidebar entries |
| `types/index.ts` name collisions | MEDIUM | Check for duplicate type names before merging (e.g., `Lead`, `UserRole`) |
| `store/index.ts` AppState shape | MEDIUM | Use spread/extend pattern — add V3 fields, preserve V2 fields |
| `mock/index.ts` in production | LOW | Gate all mock data behind `isDemoMode` flag; do not import in prod paths |
| Missing ESLint config | LOW | Add eslint + typescript-eslint before merge; baseline warnings exist |

---

## Feature 1 — Agent Mode Selector

**Status:** Placeholder view only. Agent shell stub only.

**Files to copy into main app:**
- `src/agents/agentModeSelector.ts`
- `src/store/index.ts` (AppState.agentMode + defaultState reference)

**Supabase tables/columns needed:**
- `user_preferences` — `user_id`, `agent_mode` (enum: standard | field | office | estimating | executive)

**Agent bus events to register:**
- `mode_switch` — emitted on every agent mode change; payload: `{ from: AgentMode, to: AgentMode, userId }`

**New dependencies added:** None

**Estimated session count to integrate:** 1–2 sessions
- Build AgentModeSelector.tsx view (selector UI + persistence call)
- Wire `syncToSupabase` to `user_preferences` on mode change

---

## Feature 2 — Demo Mode

**Status:** Placeholder view only. Agent shell stub only.

**Files to copy into main app:**
- `src/agents/demoMode.ts`
- `src/store/index.ts` (AppState.demoMode reference)
- `src/types/index.ts` (DemoMode type)

**Supabase tables/columns needed:**
- `user_preferences` — `demo_mode` (boolean)

**Agent bus events to register:**
- None at this stage — demo mode is a UI flag only

**New dependencies added:** None

**Estimated session count to integrate:** 1 session
- Build DemoMode.tsx toggle view
- Wire demoMode boolean to Supabase `user_preferences`
- Gate all mock data imports behind `demoMode` flag in app context

---

## Feature 3 — GUARDIAN

**Status:** Full view built (`GuardianView.tsx`). Agent shell stub only (`guardian.ts`). Mock data fully wired.

**Files to copy into main app:**
- `src/views/GuardianView.tsx`
- `src/agents/guardian.ts`
- `src/types/index.ts` (GuardianRule, GuardianViolation, GuardianAuditEntry)
- `src/mock/index.ts` → replace with Supabase queries (mockGuardianRules, mockViolations, mockAuditLog)

**Supabase tables/columns needed:**
- `guardian_rules` — `id`, `name`, `description`, `severity` (low|medium|high), `active` (boolean), `user_id`
- `guardian_violations` — `id`, `rule_id`, `rule_name`, `detected_at`, `description`, `status` (open|resolved), `project_id`
- `guardian_audit_log` — `id`, `timestamp`, `agent_id`, `action`, `result`

**Agent bus events to register:**
- `alert_triggered` — emitted when a new violation is detected
- `task_completed` — emitted when a violation is resolved

**New dependencies added:** None

**Estimated session count to integrate:** 2–3 sessions
- Replace `mockGuardianRules`, `mockViolations`, `mockAuditLog` with Supabase queries
- Build `initGuardianAgent()` to subscribe to project events and evaluate rules
- Wire Export Log button (currently disabled) to CSV export or Supabase function

---

## Feature 4 — SPARK Live Call

**Status:** Full view built (`SparkLiveCall.tsx`). Full call engine built (`spark.ts`). Mock scripts used via `spark.loadScript()`.

**Files to copy into main app:**
- `src/views/SparkLiveCall.tsx`
- `src/agents/spark.ts`
- `src/agents/sparkLiveCall.ts`
- `src/types/index.ts` (CallType, CallOption, CallStage, CallSession)
- `src/mock/index.ts` → replace mockVendorScript, mockSubScript, mockGCScript with Supabase queries

**Supabase tables/columns needed:**
- `call_scripts` — `id`, `call_type` (vendor|sub|gc), `stages` (JSONB array of CallStage)
- `call_sessions` — `id`, `call_type`, `history` (JSONB), `started_at`, `user_id`, `outcome_summary`

**Agent bus events to register:**
- `voice_note` — emitted on call end with outcome summary
- `lead_updated` — emitted if call results in a lead status change

**New dependencies added:** None (clipboard API already used natively)

**Estimated session count to integrate:** 2 sessions
- Replace `spark.loadScript()` mock source with Supabase fetch for `call_scripts`
- Persist `CallSession` to `call_sessions` on End Call
- Wire outcome summary save to `call_sessions.outcome_summary`

---

## Feature 5 — Debt Killer

**Status:** Full view built (`DebtKiller.tsx`). Agent shell stub only (`debtKiller.ts`). Mock data fully wired.

**Files to copy into main app:**
- `src/views/DebtKiller.tsx`
- `src/agents/debtKiller.ts`
- `src/types/index.ts` (Expense, DebtItem, BurnRateSnapshot, ExpenseCategory, ExpenseFrequency)
- `src/mock/index.ts` → replace mockExpenses, mockDebts, mockMonthlyIncome

**Supabase tables/columns needed:**
- `expenses` — `id`, `user_id`, `name`, `amount`, `category`, `frequency`
- `debts` — `id`, `user_id`, `name`, `balance`, `minimum_payment`, `interest_rate`
- `user_financial_profile` — `user_id`, `monthly_income`, `cash_on_hand`

**Agent bus events to register:**
- None at this stage — purely financial read/write

**New dependencies added:** None (all math is in-component)

**Estimated session count to integrate:** 2 sessions
- Replace all three mock data sources with Supabase queries
- Add real CRUD for expense add/remove (currently local state only)
- Wire income and cash-on-hand edits to persist in `user_financial_profile`

---

## Feature 6 — Lead Rolling Trend

**Status:** Full view built (`LeadRollingTrend.tsx`). Agent shell stub only (`leadRollingTrend.ts`). Chart is pure div/SVG — no charting lib dependency.

**Files to copy into main app:**
- `src/views/LeadRollingTrend.tsx`
- `src/agents/leadRollingTrend.ts`
- `src/types/index.ts` (WeeklyLeadSnapshot, Lead, LeadStatus)
- `src/mock/index.ts` → replace mockWeeklySnapshots

**Supabase tables/columns needed:**
- `leads` — `id`, `user_id`, `name`, `company`, `phone`, `email`, `status`, `estimated_value`, `source`, `created_at`, `notes`
- `weekly_lead_snapshots` — `id`, `user_id`, `week` (string label), `advance_count`, `park_count`, `kill_count`, `revenue_per_lead`, `total_leads`
  - Note: snapshots can be computed from `leads` table or cached as a materialized view

**Agent bus events to register:**
- `lead_updated` — emitted on advance/park/kill status change

**New dependencies added:** None

**Estimated session count to integrate:** 1–2 sessions
- Replace `mockWeeklySnapshots` with Supabase query (or computed aggregation from `leads`)
- Optionally add click-through on chart bars to show lead list for that week

---

## Feature 7 — Voice Journaling V2

**Status:** Full view built (`VoiceJournalingV2.tsx`). Agent shell stub only (`voiceJournalingV2.ts`). Recording is simulated; transcription is stub only.

**Files to copy into main app:**
- `src/views/VoiceJournalingV2.tsx`
- `src/agents/voiceJournalingV2.ts`
- `src/services/elevenLabsService.ts` (stub — replace with real ElevenLabs SDK)
- `src/types/index.ts` (JournalEntry, JournalCategory)
- `src/mock/index.ts` → replace mockJournalEntries

**Supabase tables/columns needed:**
- `journal_entries` — `id`, `user_id`, `timestamp`, `category`, `transcript`, `audio_url`, `duration`, `tags` (JSONB array)
- Supabase Storage bucket: `voice-notes` — for storing raw audio files

**Agent bus events to register:**
- `voice_note` — emitted on every saved journal entry; payload: `{ entryId, category, tags }`
- `field_log_created` — emitted when category is `field`

**New dependencies added:**
- Real microphone recording: browser `MediaRecorder` API or `react-media-recorder`
- Real transcription: ElevenLabs API or OpenAI Whisper (language param: `en`)

**Estimated session count to integrate:** 3 sessions
- Wire `MediaRecorder` for real audio capture
- Connect transcription to ElevenLabs or Whisper API (use language: `en`)
- Store audio file to Supabase Storage and save `audio_url` in `journal_entries`
- Replace `mockJournalEntries` with Supabase query

---

## Feature 8 — Blueprint AI

**Status:** Full view built (`BlueprintAI.tsx`). Full pipeline logic built (`blueprint.ts`). Hardcoded mock blueprint text used instead of real PDF extraction.

**Files to copy into main app:**
- `src/views/BlueprintAI.tsx`
- `src/agents/blueprint.ts`
- `src/agents/blueprintAI.ts`
- `src/services/claudeService.ts` (stub — replace with real Anthropic SDK)
- `src/types/index.ts` (BlueprintUpload, BlueprintOutput)

**Supabase tables/columns needed:**
- `blueprint_uploads` — `id`, `user_id`, `project_id`, `file_name`, `file_url`, `uploaded_at`, `status`
- `blueprint_outputs` — `id`, `upload_id`, `compliance_flags` (JSONB), `mto_items` (JSONB), `coordination_items` (JSONB), `task_schedule` (JSONB), `generated_at`
- Supabase Storage bucket: `blueprints` — for storing uploaded PDFs

**Agent bus events to register:**
- `blueprint_generated` — emitted on successful processing; payload: `{ uploadId, projectId }`
- `task_created` — emitted for each item in task schedule when exported to project

**New dependencies added:**
- PDF text extraction: `pdfjs-dist` or Supabase Edge Function with PDF parser
- Real Claude API: `@anthropic-ai/sdk` replacing stub `callClaude()`

**Estimated session count to integrate:** 3–4 sessions
- Replace hardcoded `mockBlueprintText` with real PDF extraction (pdfjs or Edge Function)
- Replace all `blueprint.ts` keyword-matching stubs with real Claude API calls
- Persist upload and output to Supabase tables
- Wire Add to MTO and Export to Project buttons to Supabase writes

---

## Feature 9 — n8n Automation

**Status:** Full view built (`N8nAutomation.tsx`). Agent shell stub only (`n8nAutomation.ts`).

**Files to copy into main app:**
- `src/views/N8nAutomation.tsx`
- `src/agents/n8nAutomation.ts`

**Supabase tables/columns needed:**
- `n8n_workflows` — `id`, `user_id`, `workflow_name`, `webhook_url`, `trigger_event`, `active` (boolean), `last_triggered_at`
- `n8n_trigger_log` — `id`, `workflow_id`, `triggered_at`, `payload` (JSONB), `response_status`

**Agent bus events to register:**
- `automation_triggered` — emitted after any n8n webhook is fired; payload: `{ workflowId, triggerEvent }`

**New dependencies added:**
- n8n webhook calls: native `fetch()` — no package needed
- Optional: n8n Cloud API client for workflow listing

**Estimated session count to integrate:** 2–3 sessions
- Build `N8nAutomation.tsx` view (workflow list, trigger button, log history)
- Wire webhook calls to n8n endpoints via `fetch()`
- Persist trigger log to Supabase

---

## Feature 10 — Crew Portal

**Status:** Full view built (`CrewPortal.tsx`). Agent shell stub only (`crewPortal.ts`). Role switching is prototype-only (no auth). Mock crew data fully wired.

**Files to copy into main app:**
- `src/views/CrewPortal.tsx`
- `src/agents/crewPortal.ts`
- `src/types/index.ts` (UserRole, CrewMember, TeamMember, Team)
- `src/mock/index.ts` → replace mockCrewMembers

**Supabase tables/columns needed:**
- `crew_members` — `id`, `user_id`, `name`, `role` (owner|crew|guest), `assigned_projects` (JSONB array), `hours_this_week`
- `crew_tasks` — `id`, `crew_member_id`, `title`, `status` (pending|in_progress|done), `project_id`, `due_date`
- `user_roles` — `user_id`, `role` (owner|crew|guest) — drives role-based view rendering

**Agent bus events to register:**
- `task_completed` — emitted when a crew task is marked done
- `field_log_created` — emitted when crew submits a field log

**New dependencies added:**
- Supabase Auth (Row Level Security) — required to enforce role-based data access

**Estimated session count to integrate:** 2–3 sessions
- Replace mock role switcher with Supabase Auth-derived role
- Replace `mockCrewMembers` with Supabase query
- Wire Log Hours button to real time-tracking write
- Wire Request Access button to owner notification (Supabase function or email)

---

## Feature 11 — NEXUS Prompt Engine

**Status:** ✅ Full implementation complete (`nexusPromptEngine.ts`). V3-19 / E16.

**Files to copy into main app:**
- `src/agents/nexusPromptEngine.ts`
- `src/services/claudeService.ts` (stub — replace with real Anthropic SDK)

**Routing verified (V3-21 audit):**
- "What's the NEC requirement for kitchen receptacles?" → OHM (100%)
- "How much do I have in unbilled work?" → LEDGER (100%)
- "My pipeline is at $66k, should I take on more work?" → NEXUS (75%)

**Agent route targets:**
- VAULT (pricing/estimating), OHM (NEC compliance), LEDGER (AR/collections), BLUEPRINT (project docs), CHRONO (scheduling), SPARK (leads/marketing), ATLAS (location/travel), NEXUS (strategy/general), MULTI (multi-agent)

**ECHO context window:** 24-hour rolling, relevance-scored (Jaccard similarity + tag boost), 4,000 token budget

**New dependencies added:**
- Real Claude API: `@anthropic-ai/sdk` (replace `callClaude()` stub in claudeService.ts)

**Estimated session count to integrate:** 1–2 sessions
- Replace `callClaude()` stub with real Anthropic SDK
- Wire ECHO window to Supabase query (last 24h context entries per user)
- Register NEXUS as the primary query dispatcher in V2 main app

---

## Summary

| Feature | View Status | Agent Status | Integration Complexity |
|---|---|---|---|
| Agent Mode Selector | Placeholder | Stub | Low |
| Demo Mode | Placeholder | Stub | Low |
| GUARDIAN | Built | Stub | Medium |
| SPARK Live Call | Built | Full engine | Medium |
| Debt Killer | Built | Stub | Medium |
| Lead Rolling Trend | Built | Stub | Low |
| Voice Journaling V2 | Built | Stub | High |
| Blueprint AI | Built | Full pipeline | High |
| n8n Automation | Built | Stub | Medium |
| Crew Portal | Built | Stub | Medium |
| NEXUS Prompt Engine | N/A | **Full implementation** | Low |

**Total source files:** 32 (10 views, 13 agents, 3 services, 3 core, 1 App, 1 main, 1 mock)
**Total direct-copy files:** 26
**Total manual-merge files:** 2 (types/index.ts, store/index.ts)
**App routing additions:** 5 manual steps
**Services requiring real wiring:** claudeService (Anthropic SDK), supabaseService (Supabase client), elevenLabsService (ElevenLabs API)
**New Supabase tables needed:** ~16 tables
**Protected files (do not touch):** authStore.ts, netlify.toml, backupDataService.ts, vite.config.ts, SVGCharts.tsx
