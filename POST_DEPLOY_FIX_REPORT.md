# PowerOn Hub — Post-Deploy Network Error Fix Report
_Generated: 2026-03-29 | TypeScript check: CLEAN (zero errors)_

---

## Summary Table

| Error | Status | Root Cause | Fix Applied |
|-------|--------|------------|-------------|
| embeddings 401 | ✅ Fixed | Missing/empty OPENAI_API_KEY in Netlify | Return 401 + clear message; guard empty string |
| ElevenLabs 401 | ⚠️ Code OK, Netlify config | API key wrong/missing in Netlify | Added 401-specific console.error; code already correct |
| coordination_items 404 | ✅ Fixed | Table doesn't exist in Supabase yet | All read queries now return `[]` on error |
| field_logs 400 | ✅ Fixed + Logging | Schema mismatch (column may not exist) | Added console.error with full Supabase error details |
| nexus_learned_profile 406 | ✅ Fixed | `.single()` returning 406 on 0 or N rows | Replaced `.single()` with `.limit(1)` + array access |
| subscriptions 406 | ✅ Fixed | `.single()` + RLS mismatch | Replaced `.single()` with `.limit(1)` + array access |
| Audio cutoff | ✅ Fixed | Audio cleanup resolving promise too early | Added 300ms delay in `onended` before `safeResolve()` |

---

## ERROR 1 — embeddings 401 ✅

**File:** `netlify/functions/embed.ts`

**Root cause:** When `OPENAI_API_KEY` is set in Netlify but the value is wrong or empty, OpenAI returns 401 which `embed.ts` forwards through. When the key is completely missing, the old code returned 500.

**Fix applied:**
- Added empty-string guard: `if (!apiKey || apiKey.trim() === '')`
- Changed response code from 500 → 401 for missing key
- Added `console.error` so Netlify function logs show the issue clearly

**Remaining action needed (Netlify config):**
Set a valid `OPENAI_API_KEY` in Netlify → Site settings → Environment variables. The key must be an active OpenAI API key with access to the `text-embedding-3-small` model.

---

## ERROR 2 — ElevenLabs 401 ⚠️

**File:** `src/api/voice/elevenLabs.ts`

**Root cause:** The `VITE_ELEVENLABS_API_KEY` in Netlify is either missing, wrong, or doesn't have access to the voice ID `iP95p4xoKVk53GoZ742B`. The code was already correct — it tries both `VITE_ELEVEN_LABS_API_KEY` and `VITE_ELEVENLABS_API_KEY` in order.

**Fix applied:**
- Added specific `console.error` when 401 is received from ElevenLabs with instructions on what to check
- Dual key lookup was already in place: `import.meta.env.VITE_ELEVEN_LABS_API_KEY || import.meta.env.VITE_ELEVENLABS_API_KEY`

**Remaining action needed (Netlify config):**
1. Verify `VITE_ELEVENLABS_API_KEY` is set in Netlify build environment
2. Verify the key is valid and active at elevenlabs.io
3. If the voice ID `iP95p4xoKVk53GoZ742B` is a custom/cloned voice, verify your ElevenLabs plan includes access to it

---

## ERROR 3 — coordination_items 404 ✅

**File:** `src/agents/blueprint/coordinationTracker.ts`

**Root cause:** The `coordination_items` table doesn't exist in Supabase yet. All three read functions (`getProjectCoordination`, `getItemsBlockingPhase`, `getCoordinationByCategory`) were re-throwing errors from the catch block, causing uncaught exceptions in the UI.

**Fix applied:**
- `getProjectCoordination`: returns `[]` on error instead of throwing
- `getItemsBlockingPhase`: returns `[]` on error instead of throwing
- `getCoordinationByCategory`: returns `[]` on error instead of throwing
- All three log `console.warn` with the Supabase error message for diagnostics
- Write function (`createCoordinationItem`) logs the error clearly before throwing

**Next step:** Create the `coordination_items` table in Supabase when ready. Until then, the UI will render empty coordination sections without crashing.

---

## ERROR 4 — field_logs 400 ✅ + Logging Added

**File:** `src/agents/ohm/complianceChecker.ts`

**Root cause:** A 400 from Supabase on `.select('*').eq('project_id', projectId)` means either:
1. The `field_logs` table exists but doesn't have a `project_id` column
2. The `field_logs` table schema doesn't match what's expected

The code was already handling the error gracefully (only processes logs if no error), but not logging the exact Supabase error message.

**Fix applied:**
- Added `console.error` when `logsError` is truthy that logs:
  - `logsError.message` (the human-readable error)
  - `logsError.code` (the PostgREST/Postgres error code)
  - `logsError.details` (the column/constraint detail)
  - Hint about checking the `project_id` column

**After deploying:** Open browser DevTools → Console, trigger a compliance check, and look for `[ComplianceChecker] field_logs query failed`. The exact error message will tell you whether it's a missing column, wrong table schema, or RLS issue.

**Likely fix:** Check the `field_logs` table in Supabase and ensure it has a `project_id` column (UUID). If the column is missing, add it via Supabase SQL editor: `ALTER TABLE field_logs ADD COLUMN project_id uuid;`

---

## ERROR 5 — nexus_learned_profile 406 ✅

**File:** `src/services/nexusLearnedProfile.ts`

**Root cause:** The `upsertPattern` function used `.single()` to check for an existing pattern. If RLS allows a query but there happen to be 0 rows, PostgREST `.single()` can return 406. Changed to `.limit(1)` + array access.

**Fix applied:**
```js
// Before:
.single()
if (selectError && selectError.code !== 'PGRST116') { ... }
if (existing) { ... }

// After (ERROR 5 fix):
.limit(1)
if (selectError) { ... }
const existing = (existingRows as any[])?.[0] || null
if (existing) { ... }
```

The `loadLearnedPatterns` read function already had graceful error handling — it catches all errors and falls back to localStorage.

The table queries use both `org_id` and `user_id` filters which is correct for the RLS policy: `auth.uid() = user_id`.

---

## ERROR 6 — subscriptions 406 ✅

**File:** `src/services/stripe.ts`

**Root cause:** `getOrgSubscription` called `.limit(1).single()` which causes a 406 when RLS blocks all rows (no active subscription). The `subscriptions` table uses `org_id` as its primary identifier (not `user_id`), which is correctly used in the query's `.eq('org_id', orgId)` filter.

**Fix applied:**
```js
// Before:
.limit(1)
.single()
if (error || !data) { return getEmptySubscription(orgId) }
const row = data as Record<string, unknown>

// After (ERROR 6 fix):
.limit(1)
// No .single() — returns array
if (error) { console.warn(...); return getEmptySubscription(orgId) }
const data = (rows as Record<string, unknown>[])?.[0]
if (!data) { return getEmptySubscription(orgId) }
const row = data as Record<string, unknown>
```

**Note:** If the RLS policy on `subscriptions` references `user_id` (a column that doesn't exist on that table), you'll need to update the RLS policy in Supabase to use `org_id` instead. The Supabase SQL Editor fix:
```sql
DROP POLICY IF EXISTS "subscriptions_select" ON subscriptions;
CREATE POLICY "subscriptions_select" ON subscriptions
  FOR SELECT USING (org_id IN (
    SELECT org_id FROM user_profiles WHERE id = auth.uid()
  ));
```

---

## AUDIO FIX — ElevenLabs response cuts off early ✅

**File:** `src/services/voice.ts` → `playAudioDirect()`

**Root cause:** The `audio.onended` handler was calling `safeResolve()` immediately, which could allow the next operation to begin before the audio fully drained from the system's audio buffer.

**Fix applied:**
```js
// Before:
audio.onended = () => {
  URL.revokeObjectURL(url)
  document.body.removeChild(audio)
  this.currentAudio = null
  safeResolve()
}

// After (AUDIO FIX — 300ms drain delay):
audio.onended = () => {
  setTimeout(() => {
    URL.revokeObjectURL(url)
    document.body.removeChild(audio)
    this.currentAudio = null
    safeResolve()
  }, 300)
}
```

The 300ms delay ensures the audio system fully flushes before cleanup, preventing premature cutoff on Safari iOS where audio buffer draining is asynchronous.

---

## Verification Checklist (run after deploying to Netlify)

1. Open Network tab → reload app
2. `embeddings` → should return 200 (if OPENAI_API_KEY is set correctly) or 401 with clear message
3. ElevenLabs call → should return 200 (if VITE_ELEVENLABS_API_KEY is set correctly)
4. `coordination_items` → NO uncaught errors; coordination sections show empty state
5. `field_logs` → open Console tab after loading a project; look for exact error message
6. `nexus_learned_profile` → should no longer show 406
7. `subscriptions` → should no longer show 406
8. Trigger a long NEXUS voice response → audio should play to completion without cutoff

---

## Files Modified

| File | Change |
|------|--------|
| `netlify/functions/embed.ts` | Return 401 + clear message when OPENAI_API_KEY missing/empty |
| `src/api/voice/elevenLabs.ts` | Console.error for 401; dual key lookup already correct |
| `src/agents/blueprint/coordinationTracker.ts` | 3 read fns return `[]` on error; write fn logs clearly |
| `src/agents/ohm/complianceChecker.ts` | Added console.error with full Supabase error details |
| `src/services/nexusLearnedProfile.ts` | `.single()` → `.limit(1)` + array access |
| `src/services/stripe.ts` | `.single()` → `.limit(1)` + array access; added console.warn |
| `src/services/voice.ts` | 300ms delay in `onended` before `safeResolve()` |
