# PowerOn Hub V3 — Architecture Roadmap

**Status:** Planning — No code yet
**Target:** Q4 2026
**Compatibility:** Same Supabase DB, same `org_id` + auth — seamless upgrade from V2

---

## Design Principles

V3 shares the V2 foundation (React + Vite + TypeScript + Supabase) and extends it with three new AI agents, deeper native integration, and a refined UX layer. Any V2 user's data, subscriptions, and org membership carry over without migration. V3 features are additive — nothing in V2 breaks.

---

## New AI Agents

### NEGOTIATE — Automated Pricing Intelligence

Analyzes historical job data (estimates, actuals, margins) across the org to recommend optimal pricing for new bids. Pulls regional labor rates, material cost trends, and competitor benchmarks from public data sources.

**Capabilities:**
- Suggest markup percentages per project type based on historical win rates
- Flag bids that are significantly above or below market range
- Generate "pricing confidence" scores on estimates before sending
- Compare actual vs estimated margins post-completion to refine future suggestions

**Tables (new):**
- `pricing_benchmarks` — regional rate snapshots, refreshed weekly
- `bid_analysis` — per-estimate scoring with recommended adjustments

**Integration points:** VAULT (estimates), PULSE (margin data), SCOUT (proposals)

### GUARDIAN — Compliance & Safety Monitor

Monitors project activity for compliance risks: expired licenses, missing permits, safety checklist gaps, insurance lapses, and NEC code violations flagged by OHM.

**Capabilities:**
- Dashboard with compliance health score per project and org-wide
- Automated alerts when licenses/permits approach expiration
- Pre-inspection checklist generator based on project type and jurisdiction
- Integration with local permitting APIs where available
- Safety incident logging with photo evidence and timestamping

**Tables (new):**
- `compliance_items` — licenses, permits, insurance with expiry tracking
- `safety_incidents` — incident reports with severity, photos, resolution
- `inspection_checklists` — generated checklists per project phase

**Integration points:** BLUEPRINT (project phases), OHM (code violations), ATLAS (reporting)

### SENTINEL — Client Communication Hub

Manages all outward-facing client communication: automated project status updates, change order approvals, payment reminders, and satisfaction surveys.

**Capabilities:**
- Auto-generated weekly status emails to project clients
- Change order approval workflow with digital signatures
- Payment reminder sequences (3-day, 7-day, 14-day)
- Post-project satisfaction survey with NPS scoring
- Client portal with read-only project visibility

**Tables (new):**
- `client_communications` — sent messages with delivery status
- `change_orders` — approval workflow with signature tracking
- `client_surveys` — NPS scores and feedback

**Integration points:** LEDGER (invoices), BLUEPRINT (project status), SPARK (client relationships)

---

## Enhanced Native Features

### Back Tap NEXUS Activation (iOS)

Double-tap or triple-tap the back of the phone to instantly activate NEXUS voice mode. Uses iOS Accessibility Back Tap → Shortcuts → PowerOn Hub deep link.

**Implementation:**
- Register `com.poweronsolutions.hub://nexus/voice` deep link in Capacitor
- Provide guided setup in onboarding (iOS Settings → Accessibility → Touch → Back Tap)
- On activation: skip wake word, go straight to listening state
- Works even from lock screen when app is backgrounded

### Apple Watch Companion (watchOS)

Lightweight watchOS app for field use — no phone required.

**Features:**
- Voice-to-NEXUS commands from the wrist
- Today's schedule at a glance (CHRONO)
- Quick field log entry (hours + project selection)
- Push notification actions (approve/dismiss)

### Offline-First Architecture

Full offline support using Supabase local-first with PowerSync or ElectricSQL.

**Implementation:**
- Local SQLite database mirrors key tables (field_logs, schedule_entries, projects)
- Bidirectional sync on reconnect with conflict resolution (last-write-wins with manual merge for conflicts)
- Offline field log entry, receipt scanning (queue uploads), and schedule viewing
- Visual indicator for sync status (synced/pending/conflict)

---

## UX Improvements

### Redesigned Dashboard

- Customizable widget grid (drag-and-drop arrangement)
- Role-based default layouts (Owner sees PULSE + SCOUT; Journeyman sees CHRONO + BLUEPRINT)
- Persistent NEXUS chat as a collapsible side panel (always accessible)

### Agent Workspace Tabs

- Each agent gets a dedicated workspace tab (like browser tabs)
- Tabs persist state across navigation
- Drag tabs to rearrange, pin frequently used agents
- Split-screen mode: two agents side by side

### Dark/Light Theme Toggle

- Full light theme with proper contrast ratios
- System preference detection with manual override
- Smooth transition animations between themes

---

## Technical Upgrades

### React 19 + Server Components

- Migrate to React 19 when stable
- Server Components for initial data loading (via Supabase SSR)
- Streaming for large data sets (ATLAS reports, VAULT variance tables)

### Edge Function Consolidation

- Single `api-gateway` Edge Function with route-based dispatch
- Shared middleware for auth, rate limiting, logging
- WebSocket support for real-time NEXUS chat (replace polling)

### Enhanced Security

- Row-level encryption for sensitive fields (SSN, bank details in future payroll module)
- Audit log table with immutable append-only design
- SOC 2 compliance preparation
- Two-factor authentication option

---

## Database Compatibility

V3 adds new tables but never modifies V2 table schemas in breaking ways. All V2 migrations remain valid. V3 migrations are numbered from `030_` onward.

| V2 Table | V3 Change |
|----------|-----------|
| `profiles` | Add `theme_preference`, `dashboard_layout` columns |
| `projects` | Add `compliance_score`, `client_portal_enabled` columns |
| `field_logs` | No changes |
| `subscriptions` | Add `v3_features_enabled` boolean |
| All others | No changes |

The `org_id` foreign key pattern remains identical. RLS policies extend naturally to new tables.

---

## Subscription Tiers (V3 Additions)

| Feature | Solo | Team | Enterprise |
|---------|------|------|------------|
| V2 features | All | All | All |
| NEGOTIATE agent | — | Basic | Full |
| GUARDIAN compliance | — | Basic | Full |
| SENTINEL client hub | — | — | Full |
| Apple Watch app | Add-on | Included | Included |
| Offline mode | — | Included | Included |
| Custom dashboard | Basic | Full | Full |
| White-label client portal | — | — | Included |

---

## Migration Path

1. User upgrades app (App Store / Play Store update)
2. V3 migrations run on first launch (additive only)
3. New agent tabs appear in navigation
4. Onboarding card introduces V3 features
5. No data migration needed — same database, same org, same auth
6. V2 users who don't update continue working normally

---

## Timeline Estimate

| Phase | Target | Scope |
|-------|--------|-------|
| V3-alpha | Aug 2026 | NEGOTIATE + GUARDIAN agents, dashboard redesign |
| V3-beta | Oct 2026 | SENTINEL, offline mode, Apple Watch |
| V3-rc | Nov 2026 | Back Tap activation, theme toggle, polish |
| V3-release | Dec 2026 | Full launch, App Store + Play Store update |

---

*This document is a planning artifact. Implementation begins after V2 reaches production stability with real user feedback.*
