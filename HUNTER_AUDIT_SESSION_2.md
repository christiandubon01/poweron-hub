# HUNTER Service Audit — Session 2

Read-only classification of 5 Hunter service files. No edits, no commits.
Audit date: 2026-04-23

---

**File:** src/services/hunter/HunterCompetitorScanner.ts
**Size:** 432 lines
**Classification:** PROTOTYPE
**Supabase wired:** no
**Claude API wired:** not applicable
**External API wired:** no (Google Maps Places API and Yelp Fusion API are *documented in comments only* — the constructor accepts `googleMapsApiKey` and `yelpApiKey` but neither key is ever used; `scanGoogleMaps` and `scanYelpCompetitors` return hard-coded mock arrays)
**External dependencies:** none (self-contained, no imports from outside hunter/)
**Public exports:** `HunterCompetitorScanner` (class, default export), enums `GapType`, `CompetitorStrength`, interfaces `CompetitorLocation`, `CompetitorGap`, `CompetitorScanResult`
**What it does (2 sentences max):** Defines a scanner for discovering competing electricians and detecting market gaps (underserved areas, weak competitors, missing 24/7 emergency, specialty gaps). Gap-detection logic (`detectCompetitorGaps`) is real and runs on whatever competitor array you pass it — but the scan methods that should *produce* that array return mock data.
**Verdict (1 sentence):** Real gap-analysis algorithm sitting on top of fake scan inputs — needs wiring to Google Maps Places API and Yelp Fusion API before it can produce real leads.
**Blocks for Track C (ingestion):** No Supabase persistence (scan results are in-memory only, nothing is written to `hunter_competitor_scans` or similar table); no API client wiring so no real competitor data to ingest; `zipCode` is taken from mock strings — Track C needs a geocoding fallback; `assessStrength` duplicated inline inside the mock arrays AND applied via `.map` — confusing but not blocking; no retry/rate-limit logic for when real APIs are wired.

---

**File:** src/services/hunter/HunterDigitalSignals.ts
**Size:** 445 lines
**Classification:** PROTOTYPE
**Supabase wired:** no
**Claude API wired:** no (intent detection is keyword-matching only — no LLM call)
**External API wired:** not applicable (the service is a *processor* for signals supplied from outside — does not itself call Nextdoor/Facebook/LinkedIn/Craigslist APIs)
**External dependencies:** `./HunterTypes` (LeadType, LeadStatus, ScoreTier, HunterLead) — all internal to hunter/
**Public exports:** `SignalProcessor` (class with static methods, default export), enums `SignalSource`, `SignalIntent`, interfaces `RawSignal`, `ProcessedSignal`, `SignalIntentResult`
**What it does (2 sentences max):** Classifies pasted-in text from Nextdoor/Facebook/LinkedIn/Craigslist/Google Alerts into real-lead vs noise using keyword lists, then assigns urgency, extracts contact info via regex, and converts to a HunterLead shape. Used by `HunterSignalInbox.tsx` for manual copy-paste lead entry.
**Verdict (1 sentence):** Callable today for the manual-paste workflow — but the "digital signals" name implies automated scraping that doesn't exist here, and scoring uses `Math.random()` for base score which is a red flag for production use.
**Blocks for Track C (ingestion):** `convertSignalToLead` uses `Math.random() * 15` to add jitter to base score (line 388) — non-deterministic, will make testing an aggregator painful; no persistence layer — `ProcessedSignal` is never written to Supabase so Track C can't query history of processed signals; regex extraction is brittle (phone regex only matches US format, address regex is narrow); `id` generated with `Math.random().toString(36).substr(2, 9)` (line 167) — `substr` is deprecated and IDs are not UUIDs, will collide under concurrent ingestion.

---

**File:** src/services/hunter/HunterSEOManager.ts
**Size:** 539 lines
**Classification:** STUB
**Supabase wired:** no
**Claude API wired:** no (would be the obvious home for LLM-generated blog posts / business descriptions — none present)
**External API wired:** no (no Google Business Profile API, no Google Search Console, no keyword research API — all "generation" methods return hard-coded template strings)
**External dependencies:** none (no imports at all)
**Public exports:** `HunterSEOManager` class (not exported by name — only a default-exported singleton `new HunterSEOManager()`), interfaces `GoogleBusinessContent`, `GoogleBusinessPost`, `ReviewResponse`, `ServicePageContent`, `BlogPost`, `LocalKeyword`, `DirectoryListing`, `DirectoryProfile`, `NAPConsistency`, `DirectoryHealthReport`
**What it does (2 sentences max):** Returns pre-written template strings for Google Business descriptions, post content, review responses, service pages, blog posts, local keywords, and directory profiles. Also contains a real-looking `trackListingConsistency` NAP-check function — the only method that actually computes anything.
**Verdict (1 sentence):** Stubbed out — every "generate" method returns canned template text with interpolated variables and `Math.random()` for "monthly search volume" (line 432); no external callers found anywhere in src/.
**Blocks for Track C (ingestion):** Zero callers in the codebase — this is dead code from Track C's perspective (won't produce data to ingest); `generateLocalKeywords` fabricates search volume with `Math.random()` which must not be treated as real data; singleton default export pattern differs from the other 4 files (which export classes directly) — inconsistency to note; no persistence, so nothing to aggregate.

---

**File:** src/services/hunter/HunterSourceAnalytics.ts
**Size:** 473 lines (has `// @ts-nocheck` at top — line 1)
**Classification:** PRODUCTION
**Supabase wired:** yes (reads `hunter_leads` table via `supabase.from('hunter_leads').select('*')` in three places; comments reference `hunter_debriefs` but file does not actually query it)
**Claude API wired:** no (recommendation strings are template-concatenated, not LLM-generated, despite the JSDoc claim of "AI-powered recommendation")
**External API wired:** not applicable
**External dependencies:** `@/lib/supabase` (Supabase client), `./HunterTypes` (HunterLead, LeadStatus, PitchAngle)
**Public exports:** `hunterSourceAnalytics` (named singleton, also default export), interfaces `SourceMetrics`, `SourceAnalysis`, `PitchAnglePerformance`, `TimePattern`, `HeatmapEntry`
**What it does (2 sentences max):** Pulls `hunter_leads` from Supabase, groups by source/pitch-angle/day, and calculates win rate, ROI, trend (improving/declining/stable), and best-time-to-contact metrics. Consumed by `HunterAnalyticsPanel.tsx` — this is a working analytics layer.
**Verdict (1 sentence):** Callable today — real Supabase queries, real aggregation math, real consumer in the UI; the biggest caveat is `costPerLead` is hard-coded as `$200/mo for 40 leads` heuristic (line 391), so ROI numbers are approximate, not real.
**Blocks for Track C (ingestion):** `@ts-nocheck` disables TypeScript checking for the whole file — risky for a production analytics service and any Track C code that imports `SourceAnalysis` won't get type-checking; the `generateSourceRecommendation` JSDoc falsely claims "AI-powered" — anyone building on top expecting LLM output will be surprised; cost assumption `$200/40 leads` is baked in — Track C aggregator cannot trust `roi` or `costPerLead` without supplying real cost data; `HeatmapEntry` interface exported but never produced by any method — dead export.

---

**File:** src/services/hunter/HunterScheduler.ts
**Size:** 411 lines
**Classification:** STUB (framing-wise; the scheduling plumbing is real, but the `executeScan` body is a no-op)
**Supabase wired:** no (reads from `useHunterStore` Zustand store only; comment on line 198 explicitly says "In a real implementation, this would: 1. Query external lead sources... 3. Add to store and Supabase. For now, we'll count leads that were already found")
**Claude API wired:** not applicable
**External API wired:** no (comment references "Facebook Leads, Google Ads, etc." as future work — none wired)
**External dependencies:** `@/store/hunterStore` (Zustand), `./HunterNexusIntegration` (`publishLeadsReadyEvent`), `./HunterTypes`
**Public exports:** functions `getScanStatus`, `getScanMetadata`, `runOnDemandScan`, `scheduleNightlyScan`, `checkPipelineThreshold`, `setPipelineThreshold`, `getPipelineThreshold`, `startThresholdMonitoring`, `initHunterScheduler`; types `ScanStatus`, `ScanMetadata`, `PipelineThreshold`, `ScanTriggerResult`; default export = object re-bundling all functions
**What it does (2 sentences max):** Implements a scheduler framework (nightly 5am scan, on-demand trigger, pipeline-threshold auto-trigger, localStorage-backed scan metadata) around a lead-discovery `executeScan` function. But `executeScan` does nothing except sleep 100–300ms and report the pre-existing count of leads in the store — it discovers zero new leads.
**Verdict (1 sentence):** Dead code in practice — no external caller anywhere in src/ invokes `initHunterScheduler`, `runOnDemandScan`, or any other export, and even if called the scan body is a simulated `setTimeout` with no actual ingestion.
**Blocks for Track C (ingestion):** `executeScan` is explicitly a simulation (`await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100))`) — Track C's "trigger a scan" entry point is a fake; uses `localStorage` directly (lines 75–105) which is browser-only — will throw in SSR/Node contexts and prevents any server-side scheduled task from using this module; no dedupe or cursor tracking for incremental ingestion; `scheduleNightlyScan` uses in-process `setTimeout`/`setInterval` — will not survive page refresh, tab close, or server restart (this is the wrong mechanism for a truly scheduled scan — needs a cron/worker/edge-function); `publishLeadsReadyEvent(true)` is called even when zero new leads found, which will send false positives to NEXUS.

---

## Overall read on these 5 files

These are a layered illusion. From the outside, the folder looks like a complete lead-generation system — competitor scanning, digital signal processing, SEO content, source analytics, and a scheduler to tie it all together. When you look inside: **one of the five is real, two are prototypes, and two are stubs.**

- **Real (PRODUCTION):** `HunterSourceAnalytics.ts` is the only file actually wired to Supabase and consumed by the UI. Its math is real and the Zustand/Supabase integration works — but it ships with `@ts-nocheck`, a JSDoc that overclaims "AI-powered," and a fake cost-per-lead constant.
- **Prototype (structure real, data fake):** `HunterCompetitorScanner.ts` has a genuine gap-detection algorithm but feeds on mock competitor data — the Google Maps and Yelp API keys are accepted in the constructor and then silently ignored. `HunterDigitalSignals.ts` has a working keyword-based classifier used by a real UI inbox, but `Math.random()` in scoring and deprecated `substr` in ID generation signal it never went through hardening.
- **Stub (canned output):** `HunterSEOManager.ts` is pure template output with fabricated search-volume numbers — zero callers, effectively dead. `HunterScheduler.ts` is more insidious: 411 lines of real-looking scheduling plumbing wrapping an `executeScan` function whose comment openly admits it's a simulation, and with zero external callers found.

**External API integration — real vs fake check:**
- Supabase → **real** in `HunterSourceAnalytics.ts` (3 actual queries against `hunter_leads`); **absent** everywhere else, including the file named `HunterScheduler.ts` that explicitly promises to write to Supabase in a comment.
- Google Maps / Yelp → **fake** (documented in comments, keys accepted, never used).
- Google Business Profile / Search Console / keyword research → **fake** (templates only).
- Facebook Leads / Google Ads / LinkedIn / Nextdoor / Craigslist → **absent** (the one file that references them just calls `setTimeout` instead).
- Claude / LLM → **absent in every file**, despite `HunterSourceAnalytics.generateSourceRecommendation` being JSDoc'd as "AI-powered."

**Pattern for Track C (ingestion) to know:** the scheduler and digital-signals code both use `Math.random()` for IDs or scoring and both lean on `localStorage`/in-memory state instead of Supabase. Any aggregator built on top will need to supply its own deterministic IDs, its own persistence, and its own real scrapers before the "scan" verb means anything. The one trustworthy data source in this folder is the `hunter_leads` table that `HunterSourceAnalytics` reads from — everything else is scaffolding waiting for a body.
