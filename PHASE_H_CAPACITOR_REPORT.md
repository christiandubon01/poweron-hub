# Phase H — Capacitor Scaffold Report
**Date:** 2026-03-30
**Status:** PARTIALLY COMPLETE — All file-level tasks done; platform add commands require host machine execution

---

## What Was Completed (Automated)

### 1. capacitor.config.ts — UPDATED ✅
- Already existed with a comprehensive config (better than spec baseline)
- Updated SplashScreen to match spec:
  - `backgroundColor: '#0a0a0a'` (was `'#111827'`)
  - `showSpinner: false` (was `true`)
- All other required values confirmed present:
  - `appId: 'com.poweronsolutions.hub'`
  - `appName: 'PowerOn Hub'`
  - `webDir: 'dist'`
  - `server.androidScheme: 'https'`

### 2. Capacitor Packages — ALREADY INSTALLED ✅
All four packages confirmed in `node_modules/@capacitor/`:
- `@capacitor/core` v8.3.0
- `@capacitor/android` v8.3.0
- `@capacitor/ios` v8.3.0
- `@capacitor/app` v8.1.0 (peer dep from biometric-auth)

Note: `@capacitor/cli` not yet in node_modules — was blocked by sandbox network policy. Add it on the host machine (see Host Machine Steps below).

### 3. package.json — UPDATED ✅
Added explicit Capacitor dependencies so they survive future `npm install` calls:
- `dependencies`: `@capacitor/android ^8.3.0`, `@capacitor/core ^8.3.0`, `@capacitor/ios ^8.3.0`
- `devDependencies`: `@capacitor/cli ^8.3.0`

### 4. dist/ folder — CONFIRMED ✅
Pre-built assets present from previous host machine build:
- `dist/index.html`
- `dist/assets/`
- `dist/_redirects`

Note: `npm run build` was attempted but failed in the Linux sandbox because node_modules were installed on Windows (missing `@rollup/rollup-linux-x64-gnu`). Build must run on the Windows host. The existing `dist/` is from the last host build.

### 5. public/manifest.json — CREATED ✅
```json
{
  "name": "PowerOn Hub",
  "short_name": "PowerOn",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "orientation": "portrait",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### 6. index.html — UPDATED ✅
Added to `<head>` (all three were missing):
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.json">
```
(viewport-fit=cover added to existing viewport tag)

### 7. public/_redirects — CONFIRMED ✅
Already contains: `/* /index.html 200`
(also confirmed in dist/_redirects)

---

## What Requires Host Machine Execution

### Step 1 — Install @capacitor/cli
```bash
npm install @capacitor/cli --save-dev
```

### Step 2 — Build web assets
```bash
npm run build
```
(required before cap add, so dist/ is fresh)

### Step 3 — Add iOS platform
```bash
npx cap add ios
```
Requires: macOS with Xcode installed

### Step 4 — Add Android platform
```bash
npx cap add android
```
Requires: Android Studio installed

### Step 5 — Sync
```bash
npx cap sync
```

### Step 6 — Verification
```bash
npx cap ls
# Should show: ios, android

npx cap doctor
# Report any missing dependencies
```

---

## Why Platform Add Cannot Run Automatically

1. `npx cap add ios` requires **macOS + Xcode** — the sandbox is Linux
2. `npx cap add android` requires **Android Studio**
3. `@capacitor/cli` npm package was blocked by sandbox network policy (403 Forbidden from registry)
4. `npm run build` fails in Linux sandbox due to missing Windows-installed rollup native binary

These are infrastructure constraints, not errors in the scaffold files themselves.

---

## Files Changed

| File | Status | Change |
|------|--------|--------|
| `capacitor.config.ts` | Updated | SplashScreen backgroundColor + showSpinner aligned to spec |
| `package.json` | Updated | Added @capacitor/core, @capacitor/ios, @capacitor/android, @capacitor/cli as explicit deps |
| `public/manifest.json` | Created | New PWA manifest with spec values |
| `index.html` | Updated | Added apple-mobile-web-app meta tags, viewport-fit=cover, manifest link |
| `public/_redirects` | Confirmed | Already correct (/* /index.html 200) |

---

## Compliance with DO NOT Rules

- ✅ Did NOT touch any agent files
- ✅ Did NOT modify Supabase config
- ✅ Did NOT change any voice or UI logic
- ✅ Did NOT commit or deploy
- ✅ Did NOT touch Phase B/C files (agentEventBus, miroFish, etc.)

---

*Phase H Capacitor scaffold automated run — 2026-03-30*
