# B1 Nav Entry Point — Audit Verification Report

**Run date:** 2026-04-23
**Scheduled task:** `b1-nav-entry-point`
**Scope:** Verify the claims in the uploaded audit covering 5 HUNTER service files in `src/services/hunter/`.

This run executed autonomously (user not present). No source files were modified — this is a read-only verification pass with evidence gathered via grep/sed against the live codebase mounted at `Power On Solutions APP - CoWork/`.

---

## Summary

Of the five files audited, the audit's claims hold up almost entirely. Four files — `HunterNexusIntegration.ts`, `HunterPortfolioService.ts`, `HunterRuleService.ts`, `HunterCostCalculator.ts` — verify cleanly against the source, including the specific line numbers called out. The one file where the audit is partially inaccurate is `HunterStudyService.ts`: the audit claims three component callers (`HunterStudyQueue.tsx`, `ProposalQueuePanel.tsx`, `VoiceHub.tsx`) but only `HunterStudyQueue.tsx` actually imports from it. See "Disputed claims" below.

The headline verdict — that `HunterNexusIntegration.ts` cannot talk to the existing NEXUS voice pipeline today — is confirmed. `initHunterNexusIntegration` has no call site outside its own export block, and the only wired piece (`publishLeadsReadyEvent`, called from `HunterScheduler.ts:216`) publishes under a cast-away event type.

---

## File-by-file verification

### HunterNexusIntegration.ts — CONFIRMED PROTOTYPE

| Claim | Status | Evidence |
| --- | --- | --- |
| 384 lines | Confirmed | `wc -l` returns 384 |
| `initHunterNexusIntegration` has no call site | **Confirmed** | Only refs are the declaration at line 343 and its re-export at line 383 |
| Typo export `handleDebrieflCommandForLead` (extra `l`) | **Confirmed** | Declared at line 180, exported at line 375 |
| `publishLeadsReadyEvent` wired from `HunterScheduler.ts` | Confirmed | `HunterScheduler.ts:16` imports it, `HunterScheduler.ts:216` calls it |
| Uses `publish('HIGH_VALUE_LEAD' as any, ...)` instead of documented `'hunter:leads_ready'` | **Confirmed** | Line 275: `publish('HIGH_VALUE_LEAD' as any, 'hunter', payload, summary)` |
| `'hunter:leads_ready'` is not in `AgentEventType` | Confirmed | `agentEventBus.ts` lists event types including `'HIGH_VALUE_LEAD'` at line 45 but no `hunter:leads_ready` |

Net: the audit's sharpest finding — this file is a specification-style scaffold, not a working bridge — is fully substantiated.

### HunterPortfolioService.ts — CONFIRMED PROTOTYPE

| Claim | Status | Evidence |
| --- | --- | --- |
| 806 lines | Confirmed | `wc -l` |
| `// @ts-nocheck` at top | **Confirmed** | First line of file |
| Duplicate `buildTestimonialEmailTemplate` at lines 698 and 774 | **Confirmed** (exact lines) | grep output matches |
| Duplicate `buildTestimonialSMSTemplate` at lines 720 and 789 | **Confirmed** (exact lines) | grep output matches |
| `requestClientTestimonial` signed `Promise<void>` but returns `{emailTemplate, smsTemplate} as any` | **Confirmed** | Lines 221–257; signature `Promise<void>`, final line `return { emailTemplate, smsTemplate } as any;` |

### HunterRuleService.ts — CONFIRMED PRODUCTION

| Claim | Status | Evidence |
| --- | --- | --- |
| 404 lines | Confirmed | `wc -l` |
| Live caller in `HunterRuleSetPanel.tsx` using `fetchRules / addRule / editRule / archiveRule / restoreRule` | Confirmed | Imports at lines 21–30, called at lines 74, 158, 204, 236, 270 |
| `getRuleVersionHistory` returns current-version-only because `hunter_rule_history` table doesn't exist | **Confirmed** | Comment at line 372 says "hunter_rule_history table. For now, return the current version." |

### HunterStudyService.ts — MIXED (partial disputes below)

| Claim | Status | Evidence |
| --- | --- | --- |
| 427 lines | Confirmed | `wc -l` |
| Consumed by `HunterStudyQueue.tsx` | Confirmed | Imports at lines 34–43, calls at 100/121/158 |
| Consumed by `ProposalQueuePanel.tsx` | **Disputed** | File does not exist in `src/components/hunter/` |
| Consumed by `VoiceHub.tsx` | **Disputed** | `VoiceHub.tsx:20` imports `getPendingCount` from `@/services/offlineCaptureService`, NOT from `HunterStudyService`. The audit's note "VoiceHub.tsx imports from this one" appears to be wrong |
| Three different `getPendingCount` functions exist (HunterStudyService, miroFish, offlineCaptureService) | **Confirmed** | `HunterStudyService.ts:260`, `miroFish.ts:680`, `offlineCaptureService.ts:104` |

Notably, the audit's own shadowing concern ("confirm no accidental shadowing at call sites") is warranted — but the actual shadowing risk is the opposite of what the audit states: VoiceHub is **not** using the HunterStudyService version, it's using the `offlineCaptureService` version. If someone assumed VoiceHub's pending-count badge was tied to the study queue, they'd be wrong. That is a real bug lurking in the audit's framing, worth flagging for Track D.

### HunterCostCalculator.ts — CONFIRMED PRODUCTION

| Claim | Status | Evidence |
| --- | --- | --- |
| 299 lines | Confirmed | `wc -l` |
| Duplicate `calculateRealCost` in `SparkDataBridge.ts:601` | **Confirmed** (exact line) | grep shows it at `src/services/sparkLiveCall/SparkDataBridge.ts:601` |
| `HunterScoringEngine.ts` references neither `estimateJobCost` nor `calculateRealCost` | **Confirmed** | grep returns zero matches in that file |
| Hardcoded `TRUCK_COST_PER_HOUR=8` and `OVERHEAD_COST_PER_HOUR=12` | **Confirmed** | Lines 28 and 31 |

---

## Disputed / corrected claims (what the audit got wrong)

1. **`ProposalQueuePanel.tsx` is not a real file.** The audit lists it as a consumer of `HunterStudyService`. It does not exist under `src/components/hunter/`. Only `HunterStudyQueue.tsx` is present.
2. **`VoiceHub.tsx` does not import from `HunterStudyService`.** It imports `getPendingCount` from `@/services/offlineCaptureService` (line 20 of `src/components/voice/VoiceHub.tsx`). This is a notable correction because the audit builds part of its reasoning on VoiceHub's pending-count badge being tied to the study queue; in reality it is tied to offline captures.

Both are minor corrections that do not change the overall classification of `HunterStudyService.ts` as production-grade — they simply narrow its real blast-radius to `HunterStudyQueue.tsx`.

---

## Recommendation (Track B / Track D impact)

The audit's production-vs-prototype split holds. Before any Track D debrief/voice wiring can rely on `HunterNexusIntegration.ts`:

1. A caller of `initHunterNexusIntegration()` must be added at app startup.
2. `AgentEventType` must gain `'hunter:leads_ready'`, and the `as any` casts on lines 275 and 286 must be removed.
3. The real NEXUS classifier (`src/agents/nexus/classifier.ts`, Claude-Sonnet-based) must dispatch to the `handleBriefCommand` / `handleFilterByScoreCommand` / `handleDebrieflCommandForLead` handlers — currently it does not import any of them.
4. The typo export `handleDebrieflCommandForLead` should be fixed to `handleDebriefCommandForLead` before any router route names it.

For `HunterPortfolioService.ts`, the duplicate function bodies at 774/789 should be deleted and `@ts-nocheck` removed before Track B relies on the portfolio path.

No action is required for `HunterRuleService.ts`, `HunterStudyService.ts`, or `HunterCostCalculator.ts` beyond the minor cleanups already enumerated in the audit.
