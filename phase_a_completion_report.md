# Phase A Bug Fix — Completion Report
**Date:** 2026-03-29
**Task:** phase-a-completion (scheduled autonomous run)
**App:** PowerOn Hub V2 — Power On Solutions LLC

---

## Summary

All 5 Phase A bugs were investigated. 3 required code changes; 2 were already resolved in the codebase.

---

## Fix-by-Fix Results

### Fix 1 — Auto-Silence Detection Threshold
**Status: ✅ Already Done — No Change Needed**

`src/components/voice/VoiceActivationButton.tsx` already has:
```typescript
const SILENCE_DURATION_MS = 2000  // 2 seconds
```
The 17-second threshold mentioned in the spec was not present. The current value is correct.

---

### Fix 2 — ElevenLabs API Key Fallback
**Status: ✅ Fixed**
**File:** `src/api/voice/elevenLabs.ts`

**Root cause:** All three functions (`synthesizeWithElevenLabs`, `streamSynthesis`, `fetchElevenLabsVoices`) only checked `VITE_ELEVEN_LABS_API_KEY`. If the Netlify env var is named `VITE_ELEVENLABS_API_KEY` (no underscores between ELEVEN and LABS), the API key lookup silently returns undefined and voice synthesis throws.

**Fix applied:** Added `|| import.meta.env.VITE_ELEVENLABS_API_KEY` fallback to all three `apiKey` declarations. Both naming conventions now work.

```typescript
// Before
const apiKey = import.meta.env.VITE_ELEVEN_LABS_API_KEY

// After
const apiKey = import.meta.env.VITE_ELEVEN_LABS_API_KEY || import.meta.env.VITE_ELEVENLABS_API_KEY
```

**Note:** Voice ID wiring was already correct — `VoiceSettings.tsx` writes to `localStorage('nexus_voice_id')`, and `voice.ts` reads it at call time and passes it as `voice_id` to `synthesizeWithElevenLabs()`.

---

### Fix 3 — Passive Capture Routing to Wrong Destination
**Status: ✅ Fixed**
**File:** `src/services/nexusPreferences.ts`

**Root cause:** `passiveCaptureIntent` in `nexus/index.ts` uses a `^` anchor so it only fires when the message _starts_ with a trigger word. Messages with verbal preambles (e.g. "hey, remember that we need more wire") bypass passive capture. The old `PREFERENCE_TRIGGERS` list contained ambiguous terms that matched these operational notes and incorrectly routed them to the preference system (`savePreference()` → Supabase `nexus_preferences`) instead of Field Notes (`addPassiveCapture()`).

**Removed from PREFERENCE_TRIGGERS:**
- `'remember that'` — caught "remember we need more wire" type messages
- `'always '` — caught "always wear PPE on this job" type messages
- `'never '` — caught "never skip grounding on panel work" type messages
- `'i like'` — colloquial usage, not reliably a preference
- `'make sure you'` — duplicate with passiveCaptureIntent anchor patterns
- `'keep in mind'` — duplicate with passiveCaptureIntent anchor patterns
- `'don't forget'` — duplicate with passiveCaptureIntent anchor patterns

**Remaining triggers are unambiguous:** `'moving forward'`, `'from now on'`, `'i prefer'`, `'i want you to'`, `'going forward'`, `'note that i'`, `'my preference is'`, `'default to'`, `'when i ask'`

---

### Fix 4 — Branch Cards Not Rendering
**Status: ✅ Fixed**
**File:** `src/agents/nexus/index.ts`

**Root cause:** `isBranchQuery` was detected at line ~406 but the `modeInstruction` ternary never used it. Branch queries fell through to `BRIEFING_FORMAT_INSTRUCTION`, which never tells Claude to output `BRANCH_CARDS: [...]` format. The UI's `parseBranchCards()` regex never found a match, so the cards block never rendered.

Additionally, `isOpBriefing` was defined as `isOperationalQuery(request.message) && !isBranchQuery`, meaning operational queries would incorrectly absorb branch-style queries that happened to match both patterns.

**Fix applied — two changes:**

1. Added new `BRANCH_FORMAT_INSTRUCTION` constant immediately after `OPERATIONAL_BRIEFING_FORMAT_INSTRUCTION`, instructing Claude to output a snapshot paragraph followed by `BRANCH_CARDS: [{...}]` JSON on a single line with `title`, `summary`, `relevance` (HIGH/MEDIUM/LOW), and `relevance_reason` fields.

2. Updated `modeInstruction` ternary to check `isBranchQuery` _before_ `isOpBriefing`:
```typescript
// Before
const modeInstruction = isListQuery
  ? LIST_FORMAT_INSTRUCTION
  : isOpBriefing
    ? OPERATIONAL_BRIEFING_FORMAT_INSTRUCTION
    : mode === 'deepdive'
      ? DEEP_DIVE_FORMAT_INSTRUCTION
      : BRIEFING_FORMAT_INSTRUCTION

// After
const modeInstruction = isListQuery
  ? LIST_FORMAT_INSTRUCTION
  : isBranchQuery
    ? BRANCH_FORMAT_INSTRUCTION
    : isOpBriefing
      ? OPERATIONAL_BRIEFING_FORMAT_INSTRUCTION
      : mode === 'deepdive'
        ? DEEP_DIVE_FORMAT_INSTRUCTION
        : BRIEFING_FORMAT_INSTRUCTION
```

The `BRANCH_FORMAT_INSTRUCTION` matches the regex `parseBranchCards()` expects in `VoiceTranscriptPanel.tsx`:
```
/^([\s\S]*?)BRANCH_CARDS:\s*(\[[\s\S]+\])/
```

---

### Fix 5 — Orb Default State on Mobile
**Status: ✅ Already Done — No Change Needed**

`src/components/voice/VoiceTranscriptPanel.tsx` already correctly initializes:
```typescript
const [orbCollapsed, setOrbCollapsed] = useState(
  typeof window !== 'undefined' && window.innerWidth < 768
)
```
Mobile-first collapse is already implemented.

---

## TypeScript Validation

`npx tsc --noEmit --skipLibCheck` passed with zero errors after all changes.

---

## Files Modified

| File | Change |
|------|--------|
| `src/api/voice/elevenLabs.ts` | Added `VITE_ELEVENLABS_API_KEY` fallback in 3 functions |
| `src/services/nexusPreferences.ts` | Removed 7 ambiguous triggers from `PREFERENCE_TRIGGERS` |
| `src/agents/nexus/index.ts` | Added `BRANCH_FORMAT_INSTRUCTION` constant; fixed `modeInstruction` priority order |

## Files Unchanged (bugs pre-resolved)

| File | Reason |
|------|--------|
| `src/components/voice/VoiceActivationButton.tsx` | `SILENCE_DURATION_MS` already = 2000 |
| `src/components/voice/VoiceTranscriptPanel.tsx` | Orb `useState` already uses `window.innerWidth < 768` |
