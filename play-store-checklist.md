# Google Play Store Submission Checklist — PowerOn Hub

## App Identity

| Field | Value |
|-------|-------|
| **Package Name** | `com.poweronsolutions.hub` |
| **App Name** | PowerOn Hub |
| **Short Description** | AI-powered operations platform for electrical contractors |
| **Category** | Business |
| **Content Rating** | Everyone |
| **Price** | Free (in-app subscriptions) |
| **Target Audience** | 18+ (business professionals) |

## Store Listing

**Full Description (4000 chars max):**

> PowerOn Hub is the all-in-one AI operations platform built for electrical contractors. Manage estimates, invoices, scheduling, marketing, and project tracking — powered by 11 specialized AI agents that automate your daily workflow.
>
> KEY FEATURES:
> - NEXUS AI Assistant — Central command with voice activation and daily briefings
> - VAULT Estimating — Material cost tracking with receipt OCR scanning
> - PULSE Dashboard — Real-time revenue, cash flow, and KPI charts
> - BLUEPRINT Projects — Phase-based project management with crew tracking
> - LEDGER Invoicing — Create and send invoices, track payments
> - SPARK Marketing — Lead generation, pipeline management, campaigns
> - CHRONO Scheduling — Google Calendar sync, crew dispatch, job scheduling
> - OHM Code Reference — NEC code lookup and electrical calculations
> - SCOUT Proposals — AI-generated proposals and code analysis
> - ECHO Voice — Hands-free voice commands on the job site
> - ATLAS Reporting — Data insights and business intelligence
>
> Built by electricians, for electricians. PowerOn Hub replaces spreadsheets, paper invoices, and disconnected tools with one intelligent platform.

**Tags:** electrical contractor, field service, estimating, invoicing, project management, AI assistant, scheduling, CRM

## Graphics Assets

| Asset | Spec | Required |
|-------|------|----------|
| App Icon | 512x512 PNG (32-bit, no alpha) | Yes |
| Feature Graphic | 1024x500 PNG or JPG | Yes |
| Phone Screenshots | 16:9 or 9:16, min 320px, max 3840px | Yes (2-8) |
| Tablet Screenshots | 16:9 or 9:16 | If supports tablets |
| Promo Video | YouTube URL | Optional |

**Recommended screenshot screens (same as iOS):**

1. NEXUS Dashboard with morning briefing
2. VAULT Material variance tracker
3. CHRONO Calendar with Google sync
4. PULSE Financial charts
5. BLUEPRINT Project phases
6. SPARK Marketing lead pipeline

## Privacy & Legal

- [ ] **Privacy Policy URL:** `https://poweronsolutions.com/privacy` *(required)*
- [ ] **Terms of Service URL:** `https://poweronsolutions.com/terms`
- [ ] **Support Email:** `support@poweronsolutions.com`
- [ ] **Developer Website:** `https://poweronsolutions.com`

## Data Safety Section

Declare in Google Play Console:

| Data Type | Collected | Shared | Purpose |
|-----------|----------|--------|---------|
| Name | Yes | No | App functionality |
| Email | Yes | No | Account management |
| Phone number | Optional | No | App functionality |
| Approximate location | Yes | No | Mileage tracking |
| Precise location | Yes | No | Mileage tracking |
| Photos | Yes | No | Receipt scanning |
| Audio | Yes | No | Voice commands |
| App interactions | Yes | No | Analytics |
| Contacts | Yes | No | GC directory sync |

- [ ] Data encrypted in transit: Yes (HTTPS/TLS)
- [ ] Data deletion request mechanism: Yes
- [ ] App complies with Families Policy: N/A (not targeted at children)

## In-App Products / Subscriptions

Register in Google Play Console → Monetize → Subscriptions:

| Product ID | Name | Price |
|-----------|------|-------|
| `solo_monthly` | Solo Monthly | $49.99/mo |
| `solo_annual` | Solo Annual | $499.99/yr |
| `team_monthly` | Team Monthly | $199.99/mo |
| `team_annual` | Team Annual | $1,999.99/yr |
| `enterprise_monthly` | Enterprise Monthly | $999.99/mo |
| `enterprise_annual` | Enterprise Annual | $9,999.99/yr |

- [ ] Create base plan for each subscription
- [ ] Configure free trial offers (7 days)
- [ ] Set grace period (7 days)
- [ ] Set account hold (30 days)

## Build & Signing

- [ ] Google Play Developer Account enrolled ($25 one-time)
- [ ] App signing key generated (or use Play App Signing)
- [ ] Upload key generated for local signing
- [ ] `google-services.json` added to `android/app/`
- [ ] Firebase project created (for push notifications via OneSignal)
- [ ] Release keystore created and secured

## Capacitor Build Steps

```bash
# 1. Build web assets
npm run build

# 2. Sync to Android
npx cap sync android

# 3. Open in Android Studio
npx cap open android

# 4. In Android Studio:
#    - Build → Generate Signed Bundle / APK
#    - Select "Android App Bundle" (.aab)
#    - Choose release keystore
#    - Build variant: release
#    - Upload .aab to Play Console

# Alternative: CLI build
cd android
./gradlew bundleRelease
# Output: android/app/build/outputs/bundle/release/app-release.aab
```

## Android Manifest Permissions

Ensure all permissions from `ios-permissions.md` (Android section) are in `android/app/src/main/AndroidManifest.xml`:

```
RECORD_AUDIO, CAMERA, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION,
READ_CALENDAR, WRITE_CALENDAR, READ_CONTACTS, INTERNET,
ACCESS_NETWORK_STATE, VIBRATE, POST_NOTIFICATIONS, USE_BIOMETRIC
```

## Pre-Launch Checklist

- [ ] No placeholder content or test data
- [ ] All features functional (or graceful degradation)
- [ ] ProGuard/R8 rules configured (no crashes from minification)
- [ ] Target SDK set to latest stable (API 35 / Android 15)
- [ ] Min SDK set to API 24 (Android 7.0) for broad compatibility
- [ ] `android:usesCleartextTraffic="false"` in manifest
- [ ] Deep links configured (if applicable)
- [ ] App passes pre-launch report (automated testing in Play Console)
- [ ] No ANR (Application Not Responding) issues
- [ ] 64-bit support included in build
- [ ] Adaptive icon provided (`ic_launcher` with foreground + background layers)

## Release Tracks

| Track | Purpose |
|-------|---------|
| Internal testing | Team testing (up to 100 testers) |
| Closed testing | Beta users with invite |
| Open testing | Public beta |
| Production | Full public release |

Recommended: Start with Internal → Closed → Production (skip Open for B2B app).
