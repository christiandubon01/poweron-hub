# API Key Security Audit — 2026-04-05

**Task:** Remove all hardcoded OpenAI/Anthropic API keys from source files
**Triggered by:** Netlify secrets scanner detection
**Status:** ✅ SOURCE FILES ALREADY CLEAN — No action required on src/

---

## Step 1 — Git Diff Review

`git diff HEAD~1 --name-only` showed 46 changed `src/` files in the most recent commit. **No protected files were touched** (authStore.ts, netlify.toml, backupDataService.ts, vite.config.ts, SVGCharts.tsx are all unchanged).

---

## Step 2 — Grep Results

```
grep -r "sk-" src/ --include="*.ts" --include="*.tsx" -l
```

**Files returned:** 2

| File | sk- Match | Type | API Key? |
|------|-----------|------|----------|
| `src/agents/blueprint/systemPrompt.ts` | "risk-conscious" | English word | ❌ Not a key |
| `src/views/CrewPortal.tsx` | "sub-panel", "pre-inspection" | Task descriptions | ❌ Not a key |

**Result: Zero actual API keys found in src/.**

---

## Step 3 — Target Files Inspected

All files specifically named in the task were checked:

| File | Hardcoded Key? | API Key Reference |
|------|---------------|-------------------|
| `src/components/ohm/Calculator.tsx` | ❌ None | None needed |
| `src/agents/ohm/calculators.ts` | ❌ None | None needed |
| `src/components/ohm/CodePanel.tsx` | ❌ None | `import.meta.env.VITE_ANTHROPIC_API_KEY` ✅ |
| `src/agents/ohm/codeSearch.ts` | ❌ None | `import.meta.env.VITE_ANTHROPIC_API_KEY` ✅ |
| `src/components/proposals/ProposalFeed.tsx` | ❌ None | None |
| `src/components/chrono/SchedulePanel.tsx` | ❌ None | None |
| `src/services/tradeKnowledgeService.ts` | ❌ None | None |

---

## Step 4 — Where the Leaked Key Came From

A rotated Anthropic key (`sk-ant-api03-_ndndLx3...`) was found in:

- `dist/assets/Calculator-BQesn-vv.js` — **Old dist artifact** (stale build output, key already rotated)
- `android/app/src/main/assets/public/assets/Calculator-CP5EGrvv.js` — **Stale Android build artifact**

The current dist file (`dist/assets/Calculator-CP5EGrvv.js`, from the latest commit) is **clean** — no hardcoded key.

The key was already removed from source before this task ran. The Netlify scanner likely detected it in an older dist bundle that was committed to the repo.

---

## Step 5 — Pre-commit Hook

Created `.git/hooks/pre-commit` as specified:

```sh
#!/bin/sh
if git diff --cached | grep -q "sk-"; then
  echo "ERROR: Possible OpenAI API key detected in staged files. Commit blocked."
  exit 1
fi
```

Made executable. This hook will block future commits containing `sk-` strings.

> **Note:** `.git/hooks/` is not tracked by git, so this hook is local-only. Consider committing a `scripts/install-hooks.sh` or using Husky to share it with the team.

---

## Step 6 — Commit

**No source file changes were needed** — source files were already clean.

No commit was created because there was nothing to commit. The commit message "fix: remove hardcoded OpenAI keys, replace with env var" would only apply if source changes were made.

---

## Outstanding Flag (Out of Scope for This Task)

⚠️ `android/app/src/main/assets/public/assets/Calculator-CP5EGrvv.js` contains the OLD rotated key. This is a stale Android build artifact committed to the repo. While the key has been rotated and is no longer valid, it is best practice to:
1. Rebuild the Android assets from clean source: `npm run build && npx cap sync android`
2. Stage and commit the refreshed Android assets to replace the stale file

This is outside the surgical scope of this task but is recommended follow-up.
