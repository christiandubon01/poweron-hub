# B44 — netlify.toml Security Audit Report

**Date:** 2026-04-07
**Branch:** main
**HEAD at audit start:** `61acf99` (fix B43)
**Commit produced by this audit:** `39698aa` (fix B44 netlify toml lock investigation)

---

## Pre-Flight: git diff HEAD~1 — Out-of-Scope File Check

Running `git diff HEAD~1 --name-only` at the start of the session showed:

```
.gitignore
dist/index.html
netlify.toml          ← FLAGGED (protected file — working tree modification)
src/components/v15r/V15rMoneyPanel.tsx
```

**Important clarification:** The B43 commit (`61acf99`) only touched `src/components/v15r/V15rMoneyPanel.tsx`. The other files (.gitignore, dist/index.html, netlify.toml) appeared in `git diff HEAD~1` because they have **uncommitted working-tree modifications**, not because they were committed in B43.

**Flag:** `netlify.toml` is a protected file and it has an uncommitted modification. See Step 1–3 for full analysis.

---

## STEP 1 — netlify.toml Git History (All Commits That Touched It)

`git log --oneline --follow netlify.toml`

| Commit | Date | Message | Change Summary |
|--------|------|---------|---------------|
| `7f86515` | 2026-04-05 | fix: B9 — crash fixes, API proxy wave 2, pagination, voice capture trigger | **Removed** `[functions."weeklyDigest"]` stanza |
| `a01b8f8` | 2026-04-05 | chore: add weeklyDigest scheduled function to netlify.toml | **Added** `[functions."weeklyDigest"]` + schedule |
| `e95c46f` | 2026-04-01 | fix: exclude recharts from Vite optimizer + CSP allow Google Fonts | Extended CSP `connect-src` with Google Fonts domains |
| `b86268a` | 2026-03-29 | fix: NEXUS briefing mode, agent context accuracy, persistent conversation | Added `/auth/callback` redirect rule (Safari iOS fix) |
| `c847edc` | 2026-03-28 | fix: duplicate activeProjects variable, remove invalid netlify functions redirect | Removed `/.netlify/functions/*` redirect (invalid) |
| `56fa2ee` | 2026-03-28 | feat: claude proxy, all 11 agents proactive, voice full pipeline | Added `[functions]` directory block; added functions redirect; expanded CSP for ElevenLabs/OpenAI |
| `f5d2e65` | 2026-03-28 | feat: voice mic permissions, AskAI real Claude integration | Updated `Permissions-Policy` — opened mic/camera/speaker for self |
| `8a5ab3b` | 2026-03-28 | fix: price book reactive sync, solar income double-ring chart | Extended CSP `frame-src` for Google Calendar |
| `538f5e5` | 2026-03-28 | initial commit | Created netlify.toml with all base config |

**Total:** 9 commits touched netlify.toml since initial commit.

---

## STEP 2 — Current netlify.toml Contents

**git HEAD version** (`61acf99`) — does NOT contain weeklyDigest:

```toml
[build]
  command   = "npm run build"
  publish   = "dist"

[build.environment]
  NODE_VERSION = "20"

[functions]
  directory = "netlify/functions"

# Auth callback — must be before the wildcard (Safari iOS strips fragment on redirect)
[[redirects]]
  from   = "/auth/callback"
  to     = "/index.html"
  status = 200

# SPA routing: all paths serve index.html
[[redirects]]
  from   = "/*"
  to     = "/index.html"
  status = 200

# Security headers
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options        = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy        = "strict-origin-when-cross-origin"
    Permissions-Policy     = "camera=(self), microphone=(self), speaker-selection=(self), geolocation=(self)"
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io https://api.anthropic.com https://api.elevenlabs.io https://api.openai.com https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: https://*.supabase.co; frame-src 'self' https://calendar.google.com https://*.google.com; media-src 'self' blob:"

# Cache static assets aggressively
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

**Working tree (current disk file)** — HAS extra stanza appended:

```toml
[functions."weeklyDigest"]
  schedule = "0 16 * * 1"
```

**⚠️ ANOMALY:** The working tree has an uncommitted modification re-adding the `[functions."weeklyDigest"]` stanza that was explicitly removed by commit `7f86515`. This is a drift between HEAD and disk state. No automated process caused this (see Step 3). Manual edit suspected.

**Unexpected lines assessment:**
- Everything in HEAD matches expected V2 deployment config.
- The `Permissions-Policy` opening mic/camera for self (`camera=(self), microphone=(self), speaker-selection=(self)`) is intentional — added in `f5d2e65` for voice pipeline support.
- The working-tree weeklyDigest stanza is the only anomaly. It references `netlify/functions/weeklyDigest.ts` (which exists and is a legitimate scheduled digest function), but the commit history shows the stanza was intentionally removed in `7f86515`.

---

## STEP 3 — Source of Modifications (Root Cause Analysis)

**Q: Does any build script write to netlify.toml?**
Searched all `.ts`, `.js`, `.mjs`, `.sh` files (excluding node_modules) for `netlify.toml` and `writeFile`/`appendFile`/`fs.` patterns in vite.config, scripts/, netlify/:

**Result: NO.** No build script, Vite plugin, or npm script writes to netlify.toml.

**Q: Does the weeklyDigest function write to netlify.toml?**
Inspected `netlify/functions/weeklyDigest.ts`. It explicitly states in its header comment:

> "Schedule config (add to netlify.toml manually — DO NOT auto-modify netlify.toml)"

**Result: NO.** The function itself contains the explicit prohibition.

**Q: Does any Netlify CLI command modify it?**
No `netlify.toml` write patterns found in any tracked file.

**Root cause conclusion:**
All 8 committed changes to netlify.toml were made by **direct manual edits** committed intentionally during feature development (Mar–Apr 2026). The current uncommitted working-tree modification is also a manual edit — someone added the `[functions."weeklyDigest"]` stanza back to the disk file after commit `7f86515` removed it, without committing the change.

---

## STEP 4 — Lockdown Actions Taken

### 4a. Pre-commit hook — UPDATED ✅

**Location:** `.git/hooks/pre-commit` (active hook, not tracked by git)
**Tracked reference copy:** `.hooks/pre-commit` (new, committed in 39698aa)

**Previous hook** only checked for API key leaks (`sk-(ant|proj)-...` pattern).

**Updated hook** adds a protected-file guard:

```sh
#!/bin/sh

# API key leak guard
if git diff --cached | grep -qE "sk-(ant|proj)-[a-zA-Z0-9]{20}"; then
  echo "ERROR: Possible API key detected in staged files. Commit blocked."
  exit 1
fi

# Protected file guard (B44)
PROTECTED="netlify.toml src/store/authStore.ts src/services/backupDataService.ts vite.config.ts src/components/v15r/charts/SVGCharts.tsx"

for f in $PROTECTED; do
  if git diff --cached --name-only | grep -qF "$f"; then
    echo "ERROR: Attempt to commit protected file: $f"
    echo "       Changes to this file require a B-ticket audit sign-off."
    exit 1
  fi
done
```

This hook will now **block any future commit** that stages netlify.toml or any of the other 4 protected files without the hook being intentionally bypassed.

### 4b. .gitattributes — CREATED ✅

New file `.gitattributes` committed in `39698aa`. Marks all 5 protected files with `merge=ours` to prevent auto-merge from silently overwriting them during branch merges:

```
netlify.toml                               merge=ours
src/store/authStore.ts                     merge=ours
src/services/backupDataService.ts          merge=ours
vite.config.ts                             merge=ours
src/components/v15r/charts/SVGCharts.tsx   merge=ours
```

### 4c. Uncommitted netlify.toml modification — NOT reverted (operator decision needed)

The working-tree addition of `[functions."weeklyDigest"]` was NOT reverted or committed. Reasoning:
- The stanza points to a real, legitimate function (`netlify/functions/weeklyDigest.ts`).
- Whether the schedule should be re-enabled is a business decision, not a lockdown decision.
- The new pre-commit hook will block accidental staging of this change.

**Operator action required:** Decide whether to:
- `git restore netlify.toml` — discard the stanza (keep HEAD state, function exists but isn't scheduled)
- Stage + commit it through the audit process — re-enable the Monday digest schedule

### 4d. Auto-modification prevention — N/A

No script was found to be auto-modifying netlify.toml. No removal action needed.

---

## STEP 5 — Full Summary

### What was modifying netlify.toml?
**Manual human edits only.** No automated build script, Vite plugin, or Netlify CLI command was writing to the file.

### What commits affected it?
9 commits total, from initial commit (`538f5e5`, 2026-03-28) through `7f86515` (2026-04-05). All changes were legitimate deployment configuration updates — CSP expansions, function directory setup, redirect rules, permissions policy updates.

### Current state at audit close?

| Item | State |
|------|-------|
| git HEAD netlify.toml | Clean, matches expected V2 config |
| Working-tree netlify.toml | Modified — weeklyDigest stanza re-added (uncommitted) |
| Pre-commit hook | ✅ Updated — now blocks all 5 protected files |
| .gitattributes | ✅ Created — merge=ours on all protected files |
| Tracked hook reference | ✅ `.hooks/pre-commit` committed |
| Auto-modification source | None found — all edits are manual |

### What was done to prevent future modifications?

1. **Pre-commit hook** — any future `git commit` that stages netlify.toml will be rejected with an error pointing to the B-ticket audit requirement. Hook is live at `.git/hooks/pre-commit`.
2. **.gitattributes** — `merge=ours` prevents branch merges from silently overwriting the file.
3. **Tracked reference copy** — `.hooks/pre-commit` is in the repo so the hook definition survives re-clones. New developers/sessions should install it with `cp .hooks/pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit`.

---

## Commit Reference

| Commit | Purpose |
|--------|---------|
| `39698aa` | B44 lockdown — .gitattributes + pre-commit hook guard |

**Not pushed.** (Per task spec: "Do not push.")

---

*Report generated: 2026-04-07 | Auditor: Claude Sonnet 4.6 (Cowork scheduled task)*
