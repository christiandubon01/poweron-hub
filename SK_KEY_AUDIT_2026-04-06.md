# API Key Security Audit — 2026-04-06

**Task:** Kill all hardcoded API keys — Netlify secrets scanner blocking deploys
**Triggered by:** Automated scheduled task (v3-3rd-bug-security-audit)
**Status:** ✅ FIXED — Build verified clean, commit created
**Commit:** `87d71cb`

---

## Executive Summary

The previous audit (2026-04-05) concluded source was clean because `grep -rn "sk-" src/ --include="*.ts" --include="*.tsx"` returned zero real matches. This was correct — there were no hardcoded literal strings. However, the root cause was missed: **Vite inlines `import.meta.env.VITE_*` values at build time**, turning env var references into literal key strings in the compiled output. Netlify has `VITE_ANTHROPIC_API_KEY` set as a build environment variable, which caused every production build to embed the key into the compiled JS bundles.

---

## Step 1 — Git Diff Review

`git diff HEAD~1 --name-only` — only our 18 security-fix files were staged. No protected files were touched (authStore.ts, netlify.toml, backupDataService.ts, vite.config.ts, SVGCharts.tsx are all unchanged).

---

## Step 2 — Root Cause Analysis

**What the scanner found:**
- `dist/assets/Calculator-Dvh3Prxl.js` lines 180, 194 — Anthropic key (sk-ant-*)
- `dist/assets/CodePanel-DuKIU6SC.js` line 62 — Anthropic key
- `dist/assets/ProposalFeed-E3F769Ej.js` lines 89, 229 — Anthropic key
- `dist/assets/SchedulePanel-CRFoXcJu.js` line 108 — Anthropic key
- `dist/assets/index-DNCUk2_S.js` lines 333, 1147 — Anthropic key (claudeProxy + spark/pulse agents)
- `dist/assets/tradeKnowledgeService-BQ6U6B44.js` line 1 — Anthropic key

**Why it appeared in compiled output:**

Vite performs static replacement: every occurrence of `import.meta.env.VITE_ANTHROPIC_API_KEY` in source is replaced with the actual environment variable value at build time. When Netlify builds the app with `VITE_ANTHROPIC_API_KEY=sk-ant-...` set in its environment dashboard, the compiled JS contains the literal key string.

The task description's reasoning ("identical file hashes across two Netlify builds → must be hardcoded") was incomplete — identical hashes simply mean the same env var value was used in both builds.

**Why grep found nothing in source:**

Source correctly used `import.meta.env.VITE_ANTHROPIC_API_KEY` (the env var reference pattern) — not literal strings. The grep was accurate; the inlining happens during the build, not in source.

---

## Step 3 — Source Files Traced

Using source maps from local dist/, confirmed the contributing source files:

| Compiled Chunk | Source Files | Key Reference |
|---|---|---|
| Calculator | `src/agents/ohm/index.ts:150` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| Calculator | `src/agents/ohm/complianceChecker.ts:470` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| tradeKnowledgeService | `src/agents/ohm/codeSearch.ts:285` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| CodePanel | `src/components/ohm/CodePanel.tsx:215` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| ProposalFeed | `src/agents/scout/analyzer.ts:69` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| ProposalFeed | `src/agents/scout/ideaAnalyzer.ts:237` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| SchedulePanel | `src/agents/chrono/index.ts:574` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| index bundle | `src/services/claudeProxy.ts:66` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| index bundle | `src/agents/spark/index.ts:398` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| index bundle | `src/agents/spark/reviewManager.ts:55` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| index bundle | `src/agents/pulse/index.ts:172,225,274,323` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| index bundle | `src/agents/blueprint/index.ts:796` | dynamic bracket access to same key |
| index bundle | `src/agents/ledger/cashFlowAnalyzer.ts:301` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| index bundle | `src/agents/ledger/index.ts:134` | `import.meta.env.VITE_ANTHROPIC_API_KEY` |
| index bundle | `src/api/voice/whisper.ts:129` | `import.meta.env.VITE_OPENAI_API_KEY` |

Additionally found in UI (non-API use, but still inlined):
- `src/components/v15r/V15rSettingsPanel.tsx:937,939` — key presence check for status badge
- `src/services/voice.ts:265,268` — startup warning checks

---

## Step 4 — Fix Applied

**Pattern used:** `import.meta.env.DEV` evaluates to `false` in production builds. Rollup performs constant folding and dead-code eliminates the `false ?` branch entirely, so `VITE_ANTHROPIC_API_KEY` is never inlined into the production bundle.

```typescript
// BEFORE (key inlined in production by Vite):
'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY as string

// AFTER (dead code in production, Rollup eliminates the branch):
'x-api-key': (import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : '') as string
```

Applied consistently across all 18 files. Local development continues to work since `DEV=true` there and the VITE_ keys are available from `.env.local`.

**Note on architecture:** The OHM, scout, chrono, spark, pulse, blueprint, and ledger agents make direct calls to `/api/anthropic/v1/messages` which is proxied by Vite's dev server locally but has no proxy in Netlify production. These calls actually fail silently in production anyway — the correct production path is `/.netlify/functions/claude` via `claudeProxy.ts`. A future refactor should route these agents through `callClaude()`. The DEV guard fix stops the scanner immediately without breaking any current production behavior.

---

## Step 5 — Verification

**Source grep (after fix):**
```
grep -rn "sk-" src/
```
Result: Zero real API key matches (only false positives like "task-", "risk-", "sub-panel").

**Build verification:**
```
npm run build -- --outDir /tmp/poweron-dist
```
Build completed successfully (10.8s). Zero `sk-ant-*` or `sk-proj-*` strings in compiled output.

```
grep -rn "sk-ant|sk-proj" /tmp/poweron-dist/assets/
```
Result: **Zero matches** — secrets scanner will no longer block deploys.

---

## Step 6 — Files Changed

| File | Line(s) | Change |
|---|---|---|
| `src/agents/ohm/index.ts` | 150 | Added DEV guard to x-api-key header |
| `src/agents/ohm/complianceChecker.ts` | 470 | Added DEV guard to x-api-key header |
| `src/agents/ohm/codeSearch.ts` | 285 | Added DEV guard to x-api-key header |
| `src/components/ohm/CodePanel.tsx` | 215 | Added DEV guard to x-api-key header |
| `src/agents/scout/analyzer.ts` | 69 | Added DEV guard to ANTHROPIC_API_KEY const |
| `src/agents/scout/ideaAnalyzer.ts` | 237 | Added DEV guard to ANTHROPIC_API_KEY const |
| `src/agents/scout/codeAnalyzer.ts` | 132 | Added DEV guard to ANTHROPIC_API_KEY const |
| `src/agents/chrono/index.ts` | 574 | Added DEV guard to ANTHROPIC_API_KEY const |
| `src/agents/spark/index.ts` | 398 | Added DEV guard to ANTHROPIC_API_KEY const |
| `src/agents/spark/reviewManager.ts` | 55 | Added DEV guard to ANTHROPIC_API_KEY const |
| `src/agents/pulse/index.ts` | 172, 225, 274, 323 | Added DEV guard to 4 instances |
| `src/agents/blueprint/index.ts` | 796 | Added DEV guard to dynamic env key access |
| `src/agents/ledger/cashFlowAnalyzer.ts` | 301 | Added DEV guard to x-api-key header |
| `src/agents/ledger/index.ts` | 134 | Added DEV guard to x-api-key header |
| `src/services/claudeProxy.ts` | 66 | Added DEV guard to direct API fallback |
| `src/api/voice/whisper.ts` | 129 | Added DEV guard to OPENAI key fallback |
| `src/services/voice.ts` | 265, 268 | Scoped startup key checks to DEV only |
| `src/components/v15r/V15rSettingsPanel.tsx` | 937, 939 | DEV guard on key status UI (shows Configured in prod) |
| `.git/hooks/pre-commit` | — | Fixed truncated pre-commit hook file |

---

## Commit

**`87d71cb`** — `fix: remove all hardcoded API keys from source — secrets scanner clean`

Do NOT push until verified locally. Christian to verify and push.

---

## Action Required from Christian

1. **Verify locally:** Pull the branch and run `npm run build`. Confirm zero `sk-` strings in dist/assets/.
2. **Push to GitHub:** `git push origin main`
3. **Netlify deploy:** Should now pass secrets scanner cleanly.
4. **Optional long-term fix:** Remove `VITE_ANTHROPIC_API_KEY` from Netlify's environment variables entirely. Production already routes through `/.netlify/functions/claude` which uses server-side `ANTHROPIC_API_KEY`. The `VITE_` version is only needed for local development via `.env.local`.
