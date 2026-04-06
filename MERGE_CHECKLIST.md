# V3 → V2 Merge Checklist

Generated: 2026-04-05 (V3-21 Final Audit)
Purpose: Step-by-step instructions for merging PowerOn Hub V3 external prototype into V2 main repo.

Complete steps in order. Check off each item before proceeding.

---

## Pre-Merge Verification

- [ ] 1. Confirm V3 build passes: `npm run build` exits zero in V3 external repo
- [ ] 2. Confirm V2 main repo is on a clean branch (no uncommitted changes)
- [ ] 3. Create a new feature branch in V2 main: `git checkout -b feature/v3-integration`
- [ ] 4. Back up V2 main `src/types/index.ts` and `src/store/index.ts` to `/tmp/` before modifying
- [ ] 5. Verify protected files are unchanged in V2: `authStore.ts`, `netlify.toml`, `backupDataService.ts`, `vite.config.ts`, `SVGCharts.tsx`

---

## Phase 1 — Direct File Copies (no conflicts expected)

Copy these files verbatim from V3 external → V2 main `src/`:

### Views
- [ ] 6. Copy `src/views/BlueprintAI.tsx`
- [ ] 7. Copy `src/views/CrewPortal.tsx`
- [ ] 8. Copy `src/views/DebtKiller.tsx`
- [ ] 9. Copy `src/views/GuardianView.tsx`
- [ ] 10. Copy `src/views/LeadRollingTrend.tsx`
- [ ] 11. Copy `src/views/SparkLiveCall.tsx`
- [ ] 12. Copy `src/views/VoiceJournalingV2.tsx`
- [ ] 13. Copy `src/views/N8nAutomation.tsx`
- [ ] 14. Copy `src/views/DemoMode.tsx`
- [ ] 15. Copy `src/views/AgentModeSelector.tsx`

### Agents
- [ ] 16. Copy `src/agents/nexusPromptEngine.ts`
- [ ] 17. Copy `src/agents/blueprint.ts`
- [ ] 18. Copy `src/agents/blueprintAI.ts`
- [ ] 19. Copy `src/agents/spark.ts`
- [ ] 20. Copy `src/agents/sparkLiveCall.ts`
- [ ] 21. Copy `src/agents/guardian.ts`
- [ ] 22. Copy `src/agents/crewPortal.ts`
- [ ] 23. Copy `src/agents/debtKiller.ts`
- [ ] 24. Copy `src/agents/leadRollingTrend.ts`
- [ ] 25. Copy `src/agents/voiceJournalingV2.ts`
- [ ] 26. Copy `src/agents/n8nAutomation.ts`
- [ ] 27. Copy `src/agents/agentModeSelector.ts`
- [ ] 28. Copy `src/agents/demoMode.ts`

### Services (stubs — will be replaced with real SDKs)
- [ ] 29. Copy `src/services/claudeService.ts` (stub)
- [ ] 30. Copy `src/services/elevenLabsService.ts` (stub)
- [ ] 31. Copy `src/services/supabaseService.ts` (stub)

---

## Phase 2 — Manual Merges Required

These files must be hand-merged. Do NOT overwrite — add V3 additions to existing V2 content.

### types/index.ts
- [ ] 32. Open V2 `src/types/index.ts` and V3 `src/types/index.ts` side by side
- [ ] 33. Add all new V3 types to V2 file (GuardianRule, GuardianViolation, GuardianAuditEntry, CallType, CallOption, CallStage, CallSession, Expense, DebtItem, BurnRateSnapshot, ExpenseCategory, ExpenseFrequency, WeeklyLeadSnapshot, Lead, LeadStatus, JournalEntry, JournalCategory, BlueprintUpload, BlueprintOutput, UserRole, CrewMember, TeamMember, Team, DemoMode)
- [ ] 34. Check for type name collisions with existing V2 types (especially `Lead`, `UserRole`)
- [ ] 35. Resolve any collisions before committing

### store/index.ts
- [ ] 36. Open V2 `src/store/index.ts` and V3 `src/store/index.ts` side by side
- [ ] 37. Add `agentMode: AgentMode` field to V2 AppState interface (default: `'standard'`)
- [ ] 38. Add `demoMode: boolean` field to V2 AppState interface (default: `false`)
- [ ] 39. Verify existing V2 AppState fields are preserved and not overwritten

---

## Phase 3 — Route and Sidebar Additions (in V2 App.tsx or Router)

- [ ] 40. Import all 10 views as lazy-loaded components in V2 App.tsx:
  ```tsx
  const BlueprintAI = lazy(() => import('./views/BlueprintAI'));
  const CrewPortal = lazy(() => import('./views/CrewPortal'));
  const DebtKiller = lazy(() => import('./views/DebtKiller'));
  const GuardianView = lazy(() => import('./views/GuardianView'));
  const LeadRollingTrend = lazy(() => import('./views/LeadRollingTrend'));
  const SparkLiveCall = lazy(() => import('./views/SparkLiveCall'));
  const VoiceJournalingV2 = lazy(() => import('./views/VoiceJournalingV2'));
  const AgentModeSelector = lazy(() => import('./views/AgentModeSelector'));
  const DemoMode = lazy(() => import('./views/DemoMode'));
  const N8nAutomation = lazy(() => import('./views/N8nAutomation'));
  ```
- [ ] 41. Wrap all V3 routes in `<Suspense fallback={<LoadingSpinner />}>` in V2 router
- [ ] 42. Add all 10 panel IDs to V2 sidebar navigation (see panel inventory in handoff spec)
  - Intelligence section: Blueprint AI, Agent Mode Selector, n8n Automation, GUARDIAN, SPARK Live Call, Lead Rolling Trend
  - Business section: Debt Killer, Voice Journaling V2, Crew Portal, Demo Mode
- [ ] 43. Register GUARDIAN in V2 agent registry if one exists
- [ ] 44. Register NEXUS Prompt Engine as primary AI query dispatcher in V2 (replace any existing query handler)
- [ ] 45. Add demo mode banner to V2 App root (orange bar, conditionally rendered when `demoMode === true`)

---

## Phase 4 — Protected File Verification

Run a diff check to confirm none of these were modified:

- [ ] 46. `git diff HEAD -- src/store/authStore.ts` → must show no changes
- [ ] 47. `git diff HEAD -- netlify.toml` → must show no changes
- [ ] 48. `git diff HEAD -- src/services/backupDataService.ts` → must show no changes
- [ ] 49. `git diff HEAD -- vite.config.ts` → must show no changes
- [ ] 50. `git diff HEAD -- src/components/v15r/charts/SVGCharts.tsx` → must show no changes

---

## Phase 5 — Dependency Updates

- [ ] 51. Install Anthropic SDK: `npm install @anthropic-ai/sdk`
- [ ] 52. Install ESLint: `npm install -D eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser`
- [ ] 53. Add `.eslintrc.json` or `eslint.config.js` to V2 repo root
- [ ] 54. Verify `npm run lint` passes (or baseline any pre-existing warnings)
- [ ] 55. Note: `pdfjs-dist` (Blueprint AI PDF), `react-media-recorder` (Voice Journaling), ElevenLabs SDK — defer to individual feature integration sessions

---

## Phase 6 — Build Verification

- [ ] 56. Run `npm run build` in V2 main — must complete with zero errors
- [ ] 57. Confirm all 10 views appear as separate lazy-loaded chunks in `dist/assets/`
- [ ] 58. Run `npm run lint` — resolve any errors; document any baseline warnings
- [ ] 59. Smoke test 3 NEXUS queries in the browser (see handoff spec for sample queries)
- [ ] 60. Verify demo mode banner appears and disappears correctly when toggled

---

## Phase 7 — Supabase Schema Prep (defer to integration sessions — do not block merge)

- [ ] 61. Create Supabase migration file for all 19 new V3 tables (see handoff spec table list)
- [ ] 62. Create `voice-notes` storage bucket (Voice Journaling)
- [ ] 63. Create `blueprints` storage bucket (Blueprint AI)
- [ ] 64. Wire Row Level Security policies for `crew_members`, `user_roles`, `user_preferences`

---

## Phase 8 — Git Tag and Commit

- [ ] 65. Stage all changes: `git add src/ MERGE_CHECKLIST.md poweron_app_handoff_spec.md`
- [ ] 66. Commit: `git commit -m "feat: V3 integration — 10 views, 13 agents, NEXUS Prompt Engine"`
- [ ] 67. Confirm V3 external tag: `git tag v3-ready` (applied to V3 external repo at V3-21)
- [ ] 68. Push feature branch to remote: `git push origin feature/v3-integration`
- [ ] 69. Open PR against V2 main — title: "V3 Integration: 10 Views + NEXUS Prompt Engine"

---

## Summary

| Phase | Steps | Description |
|---|---|---|
| Pre-Merge Verification | 1–5 | Branch setup + protect files |
| Phase 1 — Direct Copies | 6–31 | 26 files, no conflicts |
| Phase 2 — Manual Merges | 32–39 | types + store — hand-merge only |
| Phase 3 — Routing | 40–45 | App.tsx + sidebar + Suspense |
| Phase 4 — Protected Files | 46–50 | Diff verification |
| Phase 5 — Dependencies | 51–55 | Anthropic SDK + ESLint |
| Phase 6 — Build Verification | 56–60 | Build + lint + smoke test |
| Phase 7 — Supabase Schema | 61–64 | Defer to feature sessions |
| Phase 8 — Git | 65–69 | Tag + commit + PR |

**Total steps: 69**
**Estimated merge session time:** 1–2 sessions (Phases 1–6); Supabase schema deferred
