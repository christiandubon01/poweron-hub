# App Store Submission Checklist — PowerOn Hub

## App Identity

| Field | Value |
|-------|-------|
| **Bundle ID** | `com.poweronsolutions.hub` |
| **App Name** | PowerOn Hub |
| **Subtitle** | AI-Powered Electrical Contractor Platform |
| **Primary Category** | Business |
| **Secondary Category** | Productivity |
| **Age Rating** | 4+ (no objectionable content) |
| **Price** | Free (in-app subscriptions) |
| **SKU** | `poweron-hub-ios` |

## App Description

> PowerOn Hub is the all-in-one AI operations platform built for electrical contractors. Manage estimates, invoices, scheduling, marketing, and project tracking — powered by 11 specialized AI agents that automate your daily workflow.
>
> Features include voice-activated commands, receipt scanning with OCR, Google Calendar sync, crew dispatch, real-time financial dashboards, and NEC code reference tools.

**Keywords (100 chars max):**
`electrical,contractor,estimating,invoicing,scheduling,AI,project management,field service,CRM`

## Screenshots Required

Provide screenshots for each device size:

| Device | Resolution | Required |
|--------|-----------|----------|
| iPhone 6.9" (16 Pro Max) | 1320 x 2868 | Yes |
| iPhone 6.7" (15 Plus) | 1290 x 2796 | Yes |
| iPhone 6.5" (14 Plus) | 1284 x 2778 | Yes |
| iPhone 5.5" (SE/8 Plus) | 1242 x 2208 | Optional |
| iPad Pro 13" | 2064 x 2752 | If universal |
| iPad Pro 11" | 1668 x 2388 | If universal |

**Recommended screenshot screens:**

1. NEXUS Dashboard — AI chat with morning briefing card
2. VAULT Estimating — Material variance tracker with receipt scan
3. CHRONO Calendar — Schedule view with Google Calendar sync
4. PULSE Financial — Revenue and cash flow charts
5. BLUEPRINT Projects — Project phases and progress tracking
6. SPARK Marketing — Lead pipeline and campaign dashboard

## Required Assets

- [ ] App Icon: 1024x1024 PNG (no alpha, no rounded corners — App Store rounds them)
- [ ] Screenshots for all required device sizes (see above)
- [ ] App Preview video (optional, 15-30 seconds, recommended)

## Privacy & Legal

- [ ] **Privacy Policy URL:** `https://poweronsolutions.com/privacy` *(create before submission)*
- [ ] **Terms of Service URL:** `https://poweronsolutions.com/terms` *(create before submission)*
- [ ] **Support URL:** `https://poweronsolutions.com/support`
- [ ] **Marketing URL:** `https://poweronsolutions.com`

## App Privacy (Data Collection)

Declare the following data types in App Store Connect:

| Data Type | Collection | Usage |
|-----------|-----------|-------|
| Name | Yes | App Functionality |
| Email Address | Yes | App Functionality |
| Phone Number | Optional | App Functionality |
| Precise Location | Yes | App Functionality (mileage tracking) |
| Photos | Yes | App Functionality (receipt scanning) |
| Contacts | Yes | App Functionality (GC directory sync) |
| Audio Data | Yes | App Functionality (voice commands) |
| Financial Info | No | N/A |
| Identifiers (User ID) | Yes | App Functionality |

## In-App Purchases / Subscriptions

Register these subscription products in App Store Connect:

| Product ID | Display Name | Price |
|-----------|-------------|-------|
| `com.poweronsolutions.hub.solo.monthly` | Solo Monthly | $49.99/mo |
| `com.poweronsolutions.hub.solo.annual` | Solo Annual | $499.99/yr |
| `com.poweronsolutions.hub.team.monthly` | Team Monthly | $199.99/mo |
| `com.poweronsolutions.hub.team.annual` | Team Annual | $1,999.99/yr |
| `com.poweronsolutions.hub.enterprise.monthly` | Enterprise Monthly | $999.99/mo |
| `com.poweronsolutions.hub.enterprise.annual` | Enterprise Annual | $9,999.99/yr |

- [ ] Create subscription group: "PowerOn Hub Plans"
- [ ] Add all 6 products to the group
- [ ] Configure free trial period (7 days recommended)
- [ ] Upload subscription marketing images

## Build & Signing

- [ ] Apple Developer Account enrolled ($99/year)
- [ ] App ID registered in Apple Developer Portal
- [ ] Distribution certificate generated
- [ ] Provisioning profile (App Store distribution) created
- [ ] Push notification entitlement enabled
- [ ] Associated Domains entitlement (if using deep links)
- [ ] Xcode archive built with Release configuration
- [ ] Build uploaded via Xcode or Transporter

## Capacitor Build Steps

```bash
# 1. Build web assets
npm run build

# 2. Sync to iOS
npx cap sync ios

# 3. Open in Xcode
npx cap open ios

# 4. In Xcode:
#    - Set signing team
#    - Set bundle identifier to com.poweronsolutions.hub
#    - Select "Any iOS Device" as build target
#    - Product → Archive
#    - Distribute App → App Store Connect
```

## Review Guidelines Checklist

- [ ] No placeholder content or lorem ipsum
- [ ] All features functional (or graceful degradation with API keys)
- [ ] Login/auth flow works end-to-end
- [ ] Subscription restore button present
- [ ] No private API usage
- [ ] Info.plist permissions match actual usage (see `ios-permissions.md`)
- [ ] HTTPS only for all network calls
- [ ] No crash on launch
- [ ] Supports latest iOS version
- [ ] Accessibility: VoiceOver labels on interactive elements
