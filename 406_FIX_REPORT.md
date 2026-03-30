# PowerOn Hub — 406 Fix Report (3 remaining errors)
_Generated: 2026-03-29 | TypeScript check: CLEAN (zero errors)_

---

## Summary

| Error | File(s) Modified | SQL Required? | Status |
|-------|-----------------|---------------|--------|
| subscriptions 406 | `src/services/stripe.ts` | No | ✅ Code fix only |
| voice_preferences 406 | `src/services/voice.ts`, `src/components/voice/VoiceSettings.tsx` | No | ✅ Code fix only |
| nexus_learned_profile 406 | `src/services/nexusLearnedProfile.ts` | **YES** — run in Supabase | ✅ Code + SQL |

---

## FIX 1 — subscriptions 406 ✅

**File:** `src/services/stripe.ts`

**Root cause:** The query included `.eq('org_id', orgId)` as an explicit filter. The RLS policy is:
```sql
org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
```
When the code ALSO filters by `org_id`, any mismatch between the JS value and what RLS resolves causes a 406. Letting RLS handle all scoping removes the conflict.

**Change applied:**
```js
// BEFORE:
.select('*')
.eq('org_id', orgId)        ← removed
.in('status', ['active', 'trialing', 'past_due'])
.order('created_at', { ascending: false })
.limit(1)

// AFTER:
.select('*')
.in('status', ['active', 'trialing', 'past_due'])
.order('created_at', { ascending: false })
.limit(1)
```

RLS automatically limits the query to the authenticated user's org. No SQL needed.

---

## FIX 2 — voice_preferences 406 ✅

**Files:** `src/services/voice.ts` (loadPreferences), `src/components/voice/VoiceSettings.tsx` (load useEffect)

**Root cause:** Two issues combined:
1. `.eq('org_id', ...)` filter was present — but the RLS policy uses `user_id = auth.uid()`
2. `.single()` was used — returns 406 when RLS blocks the row or no row exists yet

**Change applied to both files:**
```js
// BEFORE:
.select('*')
.eq('org_id', orgId)     ← removed
.eq('user_id', userId)
.single()                ← removed

// AFTER:
.select('*')
.eq('user_id', userId)   ← user_id filter kept (matches RLS policy)
.limit(1)                ← safe array result instead of single()

const data = (rows as any[])?.[0] || null   // access first element
```

The `savePreferences` / `upsert` paths were not changed — they write data to the row and already include both `org_id` and `user_id` as data columns, which is correct.

No SQL needed.

---

## FIX 3 — nexus_learned_profile 406 ✅ (Code + SQL)

**Column check:** The table has BOTH `org_id` AND `user_id` columns — **Option A applies.**

**SQL to run in Supabase SQL Editor** ← run this now:
```sql
-- Enable RLS (if not already enabled)
ALTER TABLE nexus_learned_profile ENABLE ROW LEVEL SECURITY;

-- Create the policy (Option A — user_id matches auth.uid())
CREATE POLICY "Users manage own profile"
  ON nexus_learned_profile
  FOR ALL
  USING (auth.uid() = user_id);
```

**File:** `src/services/nexusLearnedProfile.ts` (`loadLearnedPatterns`)

**Code change applied:**
```js
// BEFORE:
.select('*')
.eq('org_id', orgId)     ← removed
.eq('user_id', userId)
.eq('active', true)
.order('confidence', { ascending: false })

// AFTER:
.select('*')
.eq('user_id', userId)   ← user_id only, matches RLS policy
.eq('active', true)
.order('confidence', { ascending: false })
```

The `upsertPattern` function already uses `.limit(1)` (fixed in the previous session) and writes with both columns in the INSERT payload — no changes needed there.

---

## Verification Steps (after deploy + SQL)

1. Run the SQL above in Supabase SQL Editor (Project `edxxbtyugohtowvslbfo`)
2. Deploy to Netlify (push to GitHub → auto-deploy)
3. Open Network tab → reload app
4. Confirm `subscriptions` → **200** (was 406)
5. Confirm `voice_preferences` → **200** (was 406)
6. Confirm `nexus_learned_profile` → **200** (was 406, requires SQL above)
7. Zero 406 errors on load

---

## Files Changed

| File | Change |
|------|--------|
| `src/services/stripe.ts` | Removed `.eq('org_id', orgId)` from subscriptions SELECT |
| `src/services/voice.ts` | `loadPreferences`: removed `.eq('org_id')`, replaced `.single()` with `.limit(1)` |
| `src/components/voice/VoiceSettings.tsx` | Same pattern as voice.ts — removed org_id filter, replaced `.single()` |
| `src/services/nexusLearnedProfile.ts` | `loadLearnedPatterns`: removed `.eq('org_id', orgId)` |
