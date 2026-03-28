# Power On Hub — Project Status Snapshot
**Generated:** March 28, 2026
**Package:** poweron-hub v0.1.0
**Stack:** React 18 + TypeScript + Vite 5 + Tailwind CSS
**Deploy target:** Netlify (auto-deploy from `main` branch)

---

## 1. Current Phase

**Phase:** Post-TDZ stabilization / Pre-data-sync verification

**Completed:**
- Initial commit of full React V2 app (all components, agents, services, migrations)
- TDZ crash fix #1: Lazy Supabase proxy in `src/lib/supabase.ts` (defers `createClient()` from module scope to first access)
- TDZ crash fix #2: Lazy `EMPTY_SUBSCRIPTION` in `src/services/stripe.ts` (replaced module-scope const with `getEmptySubscription()` function)
- TDZ crash fix #3: Dynamic import of `getOrgSubscription` in `src/lib/auth/session.ts`
- TDZ crash fix #4: Lazy `onAuthStateChange` registration in `src/store/authStore.ts` (moved into `registerAuthListener()`, called inside `initialize()`)
- TDZ crash fix #5 (ROOT CAUSE): Moved `isMobile` / `isTablet` / `isDesktop` declarations before all `useEffect` calls in `src/components/v15r/V15rLayout.tsx`
- forwardRef crash fix: Reverted `manualChunks` in `vite.config.ts` from aggressive function-based splitter to simple object form (keeps lucide-react in same chunk as React)
- Removed `node_modules` from git, added to `.gitignore`
- TypeScript type check passes (`tsc --noEmit` = 0 errors)

**In progress:**
- Netlify build is passing and app loads in browser
- Data connection to Supabase `app_state` table needs verification (app loads fresh/empty)
- Need to confirm backup import from existing `poweron_backup_data` localStorage or Supabase remote sync populates the app with real data

---

## 2. File Tree — `src/`

### Core
- `src/App.tsx` — Root component with routing
- `src/main.tsx` — Entry point
- `src/index.css` — Global styles
- `src/vite-env.d.ts` — Vite type declarations

### Components — V15r (Main App Panels)
- `V15rLayout.tsx` — Main layout shell with sidebar, responsive breakpoints, Supabase sync
- `V15rHome.tsx` — Home dashboard
- `V15rProjectsPanel.tsx` — Projects list
- `V15rProjects.tsx` — Projects sub-component
- `V15rProjectInner.tsx` — Active project inner tab router
- `V15rEstimateTab.tsx` — Project estimate
- `V15rEstimateMTO.tsx` — Estimate + MTO combined
- `V15rMTOTab.tsx` — Material takeoff
- `V15rProgressTab.tsx` — Project progress
- `V15rFrameworkTab.tsx` — Project framework
- `V15rRFITab.tsx` — RFI tracker
- `V15rCoordinationTab.tsx` — Coordination sections
- `V15rFieldLogPanel.tsx` — Field log (3-tab: Project, Service, Triggers)
- `V15rFieldLogs.tsx` — Field log sub-component
- `V15rServiceCalls.tsx` — Service calls sub-component
- `V15rTriggerMatrix.tsx` — Trigger rules matrix
- `V15rMoneyPanel.tsx` — Money / financial overview
- `V15rCashFlow.tsx` — Cash flow sub-component
- `V15rIncomeCalc.tsx` — Income / RMO calculator
- `V15rPriceBookPanel.tsx` — Price book management
- `V15rLeadsPanel.tsx` — Leads (GC, Service, Weekly Review tabs)
- `V15rTemplatesPanel.tsx` — Project templates
- `V15rPricingIntelligencePanel.tsx` — Pricing intelligence
- `V15rTeamPanel.tsx` — Team / employee management
- `V15rSettingsPanel.tsx` — Settings panel
- `V15rDashboard.tsx` — Graph dashboard
- `AskAIPanel.tsx` — AI chat panel
- `QuickBooksImportModal.tsx` — QuickBooks import modal

### Components — Auth
- `LoginFlow.tsx` — Top-level auth orchestrator
- `PasscodeScreen.tsx` — 6-digit passcode entry
- `BiometricPrompt.tsx` — Biometric auth prompt

### Components — Agent UIs
- `blueprint/` — ChangeOrderPanel, ProjectPanel, ProjectTimeline, RFIList
- `chrono/` — CalendarView, CrewDispatch, JobScheduler, SchedulePanel
- `ledger/` — InvoiceDetail, InvoicePanel, PaymentForm
- `nexus/` — MessageBubble, MorningBriefingCard, NexusChatPanel
- `ohm/` — Calculator, CodePanel, ComplianceReport
- `pulse/` — CashFlowChart, DashboardPanel, KPICard, RevenueChart
- `scout/` — CodeAnalysisPanel
- `spark/` — CampaignTracker, GCDashboard, LeadPipeline, MarketingPanel, ReviewManager
- `vault/` — EstimateBuilder, EstimateDetail, EstimatePanel, MaterialVariancePanel, ReceiptScanModal
- `voice/` — VoiceActivationButton, VoiceSettings, VoiceStatusBar

### Components — Other
- `ErrorBoundary.tsx` — React error boundary
- `ImportBackupButton.tsx` — Backup import button
- `layout/AppShell.tsx` — Layout shell
- `onboarding/OnboardingModal.tsx` — Onboarding flow
- `pricing/PricingPanel.tsx` — Subscription pricing
- `proposals/` — IdeaSubmissionPanel, ProposalCard, ProposalFeed

### Agents (11 total)
- `nexus/` — Manager agent (classifier, router)
- `blueprint/` — Project management (change orders, coordination, RFI, project manager)
- `chrono/` — Scheduling (calendar, crew dispatch, job scheduler)
- `ledger/` — Financial (cash flow analyzer, invoice manager)
- `ohm/` — Technical (calculators, code search, compliance checker)
- `pulse/` — Analytics (KPI calculator, trend analyzer)
- `scout/` — Research (analyzer, code analyzer, data gatherer, idea analyzer, MiroFish, version watcher)
- `spark/` — Marketing (campaign manager, GC manager, lead manager, review manager)
- `vault/` — Estimating (estimate builder, margin analyzer)

### Services
- `backupDataService.ts` — Full v15r backup data layer (localStorage + Supabase sync)
- `stripe.ts` — Subscription/billing service
- `undoRedoService.ts` — Undo/redo service
- `googleCalendar.ts` — Google Calendar integration
- `notifications.ts` — Push notifications (OneSignal)
- `quickbooksImportService.ts` — QuickBooks import
- `materialVariance.ts` — Material variance tracking
- `receiptOCR.ts` / `receiptParser.ts` — Receipt scanning
- `audioPreprocessing.ts` / `voice.ts` / `voiceCommandExecutor.ts` / `wakeWordDetector.ts` — Voice system

### Store
- `authStore.ts` — Zustand auth state machine (7 states, lazy auth listener)

### Lib
- `supabase.ts` — Lazy Supabase singleton via Proxy pattern
- `redis.ts` — Lazy Upstash Redis singleton
- `auth/passcode.ts` — PBKDF2 passcode hashing + lockout
- `auth/biometric.ts` — WebAuthn biometric auth
- `auth/session.ts` — Redis-backed app sessions
- `db/types.ts` — Supabase generated types
- `memory/audit.ts` — Audit logging
- `memory/embeddings.ts` — OpenAI vector embeddings
- `memory/redis-context.ts` — Redis context layer

### Config
- `config/subscriptionTiers.ts` — Stripe subscription tier definitions

### Hooks
- `useAuth.ts` — Auth store wrapper hook
- `usePulseChartData.ts` — Chart data hook
- `useSubscription.ts` — Subscription hook

### Scripts
- `scripts/adaptV15rBackup.ts` — Backup adapter
- `scripts/migrateFromV15r.ts` — V15r migration script
- `scripts/runMigration.ts` — Migration runner

### Voice API
- `api/voice/elevenLabs.ts` — ElevenLabs TTS
- `api/voice/whisper.ts` — Whisper STT
- `api/voice/routing.ts` — Voice routing
- `api/voice/index.ts` — Voice API barrel

---

## 3. DB Migrations

27 migration files in `supabase/migrations/`:

| # | File | Contents |
|---|------|----------|
| 001 | `001_extensions.sql` | PostgreSQL extensions (uuid-ossp, moddatetime, etc.) |
| 002 | `002_core_tables.sql` | organizations, profiles, user_sessions, clients, project_templates, projects, project_phases, estimates, invoices, payments, rfis, change_orders, calendar_events, crew_members, leads, campaigns, reviews, compliance_checks |
| 003 | `003_agent_tables.sql` | agents, agent_proposals, agent_messages, notifications |
| 004 | `004_memory_tables.sql` | memory_embeddings |
| 005 | `005_audit_system.sql` | audit_log |
| 006 | `006_rls_policies.sql` | Row-level security policies |
| 007 | `007_seed_agents.sql` | Seeds 11 agent records |
| 008 | `008_field_logs.sql` | field_logs, service_logs |
| 009 | `009_price_book_and_material_takeoff.sql` | price_book_categories, price_book_items, material_takeoffs, material_takeoff_lines |
| 010 | `010_weekly_tracker.sql` | weekly_tracker |
| 011 | `011_coordination_and_agenda.sql` | coordination_items, agenda_sections, agenda_tasks |
| 012 | `012_project_cost_entries.sql` | project_labor_entries, project_material_entries, project_overhead_entries |
| 013 | `013_gc_contacts.sql` | gc_contacts, gc_activity_log |
| 014 | `014_rls_new_tables.sql` | RLS for new tables |
| 015 | `015_update_agent_scopes.sql` | Agent scope updates |
| 016 | `016_auto_profile_trigger.sql` | Auto-profile creation on signup |
| 017 | `017_trigger_rules.sql` | trigger_rules |
| 018 | `018_price_book_and_field_logs.sql` | Price book + field log alterations |
| 019 | `019_spark_chrono_tables.sql` | campaign_leads, crew_availability, job_schedules, travel_times |
| 020 | `020_spark_chrono_alter_and_create.sql` | Alter + create for Spark/Chrono |
| 021 | `021_voice_tables.sql` | voice_sessions, voice_memos, voice_preferences, voice_response_cache |
| 022 | `022_subscriptions_table.sql` | billing_customers, subscriptions, subscription_events |
| 023 | `023_rls_hardening.sql` | Additional RLS hardening |
| 024 | `024_field_log_upsert.sql` | Field log upsert function |
| 025 | `025_material_receipts.sql` | material_receipts |
| 026 | `026_onboarding.sql` | onboarding_progress |
| 027 | `027_daily_briefing_cron.sql` | Daily briefing cron job |

**Applied status:** Unknown from this environment. Migrations are SQL files in repo — whether each has been run against the live Supabase project (`edxxbtyugohtowvslbfo`) must be verified via `supabase migration list` with project access or by checking the Supabase dashboard.

---

## 4. Supabase Tables (54 total)

agenda_sections, agenda_tasks, agent_messages, agent_proposals, agents, audit_log, billing_customers, calendar_events, campaign_leads, campaigns, change_orders, clients, compliance_checks, coordination_items, crew_availability, crew_members, estimates, field_logs, gc_activity_log, gc_contacts, invoices, job_schedules, leads, material_receipts, material_takeoff_lines, material_takeoffs, memory_embeddings, notifications, onboarding_progress, organizations, payments, price_book_categories, price_book_items, profiles, project_labor_entries, project_material_entries, project_overhead_entries, project_phases, project_templates, projects, review_responses, reviews, rfis, service_logs, subscription_events, subscriptions, travel_times, trigger_rules, user_sessions, voice_memos, voice_preferences, voice_response_cache, voice_sessions, weekly_tracker

**Critical for data sync:** `app_state` table (key: `poweron_v2`) — this is the primary sync mechanism used by `backupDataService.ts`. It stores the entire app state as a JSONB blob. This table is NOT in the migration files — it was created manually or via the Supabase dashboard.

---

## 5. Auth Flow (End to End)

1. **App loads** → `V15rLayout.tsx` renders → `LoginFlow.tsx` checks auth status from `authStore.ts`
2. **authStore.initialize()** runs:
   - Registers auth listener via lazy `registerAuthListener()` (one-time)
   - Calls `supabase.auth.getSession()` to check for existing JWT
   - If URL contains auth tokens (magic link callback), Supabase `detectSessionInUrl: true` processes them automatically via the Proxy-based lazy client
3. **No session** → status = `unauthenticated` → `EmailSignIn` component renders:
   - User enters email → `signInWithMagicLink(email)` → Supabase sends magic link email
   - User clicks link → redirected back to app with token in URL → Supabase processes token
4. **Session exists, first time** → status = `needs_passcode_setup`:
   - User sets 6-digit passcode → hashed with PBKDF2 (Web Crypto API) → stored in `profiles.passcode_hash`
   - Optionally prompted for biometric enrollment (WebAuthn)
5. **Session exists, returning user** → status = `needs_passcode` or `biometric_prompt`:
   - User enters passcode → verified against stored hash → Redis session created via `createAppSession()`
   - Or uses biometric (WebAuthn) → verified → Redis session created
6. **5 failed attempts** → status = `locked` → 15-minute lockout stored in Redis
7. **Passcode/biometric verified** → status = `authenticated` → dashboard loads
8. **Supabase auth config:** PKCE flow, `detectSessionInUrl: true`, `persistSession: true`, `autoRefreshToken: true`

---

## 6. Known Bugs / Open Issues

1. **Data not loading on fresh Netlify deploy** — App loads but shows empty state. Need to verify:
   - Is `app_state` table populated in Supabase with key `poweron_v2`?
   - Is `backupDataService.ts` `loadFromSupabase()` being called on mount?
   - Is localStorage `poweron_backup_data` populated on the user's browser?
   - Are CORS/CSP headers allowing Supabase connections from the Netlify domain?

2. **Migration application status unknown** — 27 migration files exist but whether all are applied to the live Supabase instance is unverified.

3. **`// @ts-nocheck` on all v15r component files** — TypeScript checking is disabled across the main UI components. This masks potential type errors.

4. **Missing from V2 (per handoff spec Section 16):**
   - Graph Dashboard — `V15rDashboard.tsx` exists but may not be fully wired into nav
   - Undo/redo (Ctrl+Z/Y) — `undoRedoService.ts` exists but wiring to layout unverified
   - Snapshot system — not confirmed wired into Settings panel
   - Disconnect/test mode for Supabase — not confirmed implemented
   - Home: Google Calendar embed, Service Jobs Requiring Attention — partial
   - Field Log: live profit preview — partial
   - Income Calculator: visualization incomplete

5. **CSP may block some connections** — `connect-src` in `netlify.toml` allows `*.supabase.co`, `*.upstash.io`, `api.anthropic.com` but does NOT include `api.openai.com` (needed for embeddings) or `api.elevenlabs.io` (needed for voice TTS).

---

## 7. Last Thing Built

**Most recent completed work (commits c8901fc through 1336a88):**
- Fixed the production-only TDZ crash (`"Cannot access 'I' before initialization"`) by moving `isMobile`/`isTablet`/`isDesktop` declarations before all `useEffect` calls in `V15rLayout.tsx`
- Fixed the lucide-react `forwardRef` crash by reverting `manualChunks` in `vite.config.ts` to simple object form
- Applied defensive TDZ fixes to supabase.ts (Proxy-based lazy singleton), stripe.ts (lazy `getEmptySubscription()`), session.ts (dynamic import), authStore.ts (lazy listener registration)
- Cleaned up git history (removed `node_modules` from tracking)

---

## 8. Next Planned Task

1. **Verify data sync on Netlify** — Confirm the deployed app connects to Supabase `app_state` table and loads existing data (or accepts a backup import)
2. **Test full auth flow on production URL** — Magic link email → click link → redirect → passcode → dashboard loads with data
3. **If data doesn't load:** Debug `backupDataService.ts` `loadFromSupabase()` — check network tab for Supabase calls, check CSP blocks, check `app_state` table contents

---

## 9. Environment Variables

**`.env` (34 variables):**

| Variable | Service |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase |
| `VITE_SUPABASE_ANON_KEY` | Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase (server-side only) |
| `SUPABASE_PROJECT_REF` | Supabase |
| `SUPABASE_URL` | Supabase |
| `VITE_UPSTASH_REDIS_URL` | Upstash Redis |
| `VITE_UPSTASH_REDIS_TOKEN` | Upstash Redis |
| `VITE_OPENAI_API_KEY` | OpenAI (embeddings) |
| `VITE_ANTHROPIC_API_KEY` | Anthropic (agents) |
| `R2_ENDPOINT` | Cloudflare R2 (backups) |
| `R2_ACCESS_KEY` | Cloudflare R2 |
| `R2_SECRET_KEY` | Cloudflare R2 |
| `R2_BUCKET` | Cloudflare R2 |
| `STRIPE_SECRET_KEY` | Stripe (server-side) |
| `STRIPE_WEBHOOK_SECRET` | Stripe |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe (client-side) |
| `VITE_STRIPE_PRICE_SOLO_MONTHLY` | Stripe price ID |
| `VITE_STRIPE_PRICE_SOLO_ANNUAL` | Stripe price ID |
| `VITE_STRIPE_PRICE_TEAM_MONTHLY` | Stripe price ID |
| `VITE_STRIPE_PRICE_TEAM_ANNUAL` | Stripe price ID |
| `VITE_STRIPE_PRICE_ENTERPRISE_MONTHLY` | Stripe price ID |
| `VITE_STRIPE_PRICE_ENTERPRISE_ANNUAL` | Stripe price ID |
| `VITE_ONESIGNAL_APP_ID` | OneSignal (push) |
| `ONESIGNAL_API_KEY` | OneSignal (server-side) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google (server-side) |
| `VITE_GOOGLE_CALENDAR_API_KEY` | Google Calendar |
| `VITE_ELEVENLABS_API_KEY` | ElevenLabs (voice TTS) |
| `VITE_PICOVOICE_ACCESS_KEY` | Picovoice (wake word) |

**Note:** All `VITE_` prefixed variables are exposed to the browser bundle at build time. `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_SECRET`, `ONESIGNAL_API_KEY`, and all `R2_*` keys are server-side only and should NOT be in the Netlify build environment (only in Edge Functions or server contexts).

---

## 10. Netlify Deploy Status

**Current state:** Build is PASSING. App loads in browser.

**Configuration (`netlify.toml`):**
- Build command: `npm run build`
- Publish directory: `dist`
- Node version: 20
- SPA redirect: `/* → /index.html` (status 200)
- Security headers: X-Frame-Options DENY, X-Content-Type-Options nosniff, CSP configured
- Asset caching: 1-year immutable cache for `/assets/*`

**Known deploy issue:** App loads but displays empty/fresh state — this is a data sync issue, not a build issue.

---

## 11. Recent Bug Fixes

| File Changed | Bug | Fix | Deployed? | Confirmed? |
|---|---|---|---|---|
| `src/components/v15r/V15rLayout.tsx` | TDZ crash: `"Cannot access 'I' before initialization"` in production. `isMobile` declared at line 279 but used in `useEffect` dependency array at line 158. Minified as `I`. | Moved `isMobile`, `isTablet`, `isDesktop` declarations to line 56, before all `useEffect` calls. | Yes (c8901fc) | Yes — TDZ crash gone |
| `vite.config.ts` | `"Cannot read properties of undefined (reading 'forwardRef')"` — lucide-react Icon.js couldn't find `React.forwardRef` because aggressive `manualChunks` put React and lucide-react in different chunks. | Reverted `manualChunks` from function-based splitter to simple object: `{ 'react-vendor': ['react', 'react-dom', 'react-router-dom'], ... }`. lucide-react now stays in default chunk with React available. | Yes (c8901fc) | Yes — app loads |
| `src/lib/supabase.ts` | Potential TDZ: `createClient()` called at module scope could hit TDZ if Rollup evaluates modules in wrong order. | Replaced with Proxy-based lazy singleton — `createClient()` deferred to first property access. | Yes (a1a501f) | Yes — no regression |
| `src/services/stripe.ts` | Potential TDZ: `EMPTY_SUBSCRIPTION` const called `getFreeTierFeatures()` at module scope. | Replaced with lazy `getEmptySubscription()` function. | Yes (1336a88) | Yes — no regression |
| `src/lib/auth/session.ts` | Potential TDZ: Static import of `getOrgSubscription` from stripe.ts created circular dependency risk. | Replaced with `const { getOrgSubscription } = await import('@/services/stripe')` inside `createAppSession()`. | Yes (1336a88) | Yes — no regression |
| `src/store/authStore.ts` | Potential TDZ: `onAuthStateChange` callback registered at module scope. | Moved into lazy `registerAuthListener()` function, called as first line of `initialize()`. | Yes (a1a501f) | Yes — no regression |

---

*End of status snapshot.*
