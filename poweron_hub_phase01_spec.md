# PowerOn Hub — Phase 01 Implementation Spec
## Foundation · Backend · Auth · Memory · Audit Trail
### v2.0 Blueprint · 11-Agent Architecture · Weeks 1–3

---

## Table of Contents

1. Overview & Architecture Summary
2. Supabase Project Setup
3. Database Schema (All Tables)
4. Role-Based Access Control (RBAC)
5. Authentication Flow (Passcode + Biometric)
6. Shared Memory Bus Architecture
7. Audit Trail System
8. Encrypted Backup Automation
9. Environment Variables & Secrets
10. Migration Checklist from Existing Hub
11. What Phase 02 Expects from Phase 01

---

## 1. Overview & Architecture Summary

PowerOn Hub is an 11-agent AI platform for Power On Solutions, an electrical contracting business. Phase 01 builds the foundation that every subsequent phase depends on: the database, authentication, memory system, and audit trail.

### The 11 Agents (for schema context)

| Agent | Domain | Key Data |
|-------|--------|----------|
| NEXUS | Manager / Command | Delegates, reports, voice interface |
| VAULT | Estimating | Bids, cost history, margin analysis |
| PULSE | Dashboard | Charts, KPIs, trend data |
| LEDGER | Money | Invoices, AR, payments, cash flow |
| SPARK | Marketing | Leads, campaigns, reviews, social |
| BLUEPRINT | Projects + Compliance + RFI | Phases, templates, permits, RFIs, change orders |
| OHM | Electrical Coach | NEC compliance, safety, training proposals |
| CHRONO | Calendar | Jobs, estimates, crew dispatch, reminders |
| SCOUT | System Analyzer | Proposals, pattern detection, MiroFish |
| SIGNAL | RFI (merged into BLUEPRINT in v2) | Legacy — data migrates to BLUEPRINT |
| FRAME | Projects (merged into BLUEPRINT in v2) | Legacy — data migrates to BLUEPRINT |

### Tech Stack for Phase 01

- **Database**: Supabase (PostgreSQL 15+)
- **Vector Store**: pgvector extension (installed in Supabase)
- **Session Cache**: Upstash Redis (serverless)
- **Auth**: Supabase Auth + custom passcode layer
- **Backup**: Cloudflare R2 (encrypted, nightly)
- **Frontend**: React + Vite (scaffolded, not fully built in Phase 01)
- **Hosting**: Netlify (deploy preview in Phase 01)

---

## 2. Supabase Project Setup

### 2.1 Create Project

```
Project name: poweron-hub
Region: us-west-1 (closest to Southern California)
Database password: [generate strong, store in vault]
```

### 2.2 Enable Extensions

```sql
-- Run in Supabase SQL Editor
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "pg_cron";      -- for scheduled backup triggers
CREATE EXTENSION IF NOT EXISTS "pg_net";       -- for HTTP calls to R2
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";    -- UUID generation
CREATE EXTENSION IF NOT EXISTS "moddatetime"; -- auto-update updated_at
```

### 2.3 Enable Realtime

Enable Realtime on these tables after creation:
- `projects`
- `invoices`
- `calendar_events`
- `agent_proposals`
- `notifications`

### 2.4 Storage Buckets

```sql
-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('project-files', 'project-files', false),
  ('job-photos', 'job-photos', false),
  ('documents', 'documents', false),
  ('backups', 'backups', false);
```

---

## 3. Database Schema

### 3.1 Core Identity & Auth

```sql
-- ══════════════════════════════════
-- ORGANIZATIONS (multi-tenant ready)
-- ══════════════════════════════════
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  owner_id        UUID REFERENCES auth.users(id),
  subscription_status TEXT DEFAULT 'trial' CHECK (subscription_status IN ('trial','active','past_due','canceled')),
  stripe_customer_id  TEXT,
  stripe_subscription_id TEXT,
  settings        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- PROFILES (extends Supabase auth.users)
-- ══════════════════════════════════
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','admin','field','viewer')),
  phone           TEXT,
  avatar_url      TEXT,
  passcode_hash   TEXT,           -- bcrypt hash of 6-digit passcode
  biometric_enabled BOOLEAN DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  last_login_ip   INET,
  last_login_device TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- USER SESSIONS (for anomaly detection)
-- ══════════════════════════════════
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id),
  device_type     TEXT,          -- 'ios', 'android', 'web', 'desktop'
  device_info     JSONB,         -- user agent, OS version, app version
  ip_address      INET,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  is_anomalous    BOOLEAN DEFAULT false
);
```

### 3.2 Projects & Jobs (BLUEPRINT agent domain)

```sql
-- ══════════════════════════════════
-- CLIENTS
-- ══════════════════════════════════
CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  company         TEXT,
  email           TEXT,
  phone           TEXT,
  address         JSONB,         -- {street, city, state, zip, lat, lng}
  type            TEXT DEFAULT 'residential' CHECK (type IN ('residential','commercial','industrial')),
  source          TEXT,          -- 'referral', 'google', 'website', 'repeat'
  notes           TEXT,
  tags            TEXT[],
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- PROJECTS (the central entity)
-- ══════════════════════════════════
CREATE TABLE projects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES clients(id),
  name            TEXT NOT NULL,
  description     TEXT,
  type            TEXT NOT NULL CHECK (type IN (
    'residential_service','residential_remodel','residential_new',
    'commercial_ti','commercial_new','commercial_service',
    'industrial','solar','ev_charger','panel_upgrade','other'
  )),
  status          TEXT NOT NULL DEFAULT 'estimate' CHECK (status IN (
    'lead','estimate','pending','approved','in_progress',
    'on_hold','punch_list','closeout','completed','canceled'
  )),
  phase           TEXT,          -- current phase from template
  template_id     UUID REFERENCES project_templates(id),
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  address         JSONB,
  
  -- Financial
  estimated_value NUMERIC(12,2),
  contract_value  NUMERIC(12,2),
  actual_cost     NUMERIC(12,2),
  
  -- Dates
  estimated_start DATE,
  estimated_end   DATE,
  actual_start    DATE,
  actual_end      DATE,
  
  -- Compliance (BLUEPRINT + OHM domain)
  permit_status   TEXT DEFAULT 'not_required' CHECK (permit_status IN (
    'not_required','pending','submitted','approved','failed','expired'
  )),
  permit_number   TEXT,
  inspection_status TEXT,
  ahj_jurisdiction TEXT,         -- Authority Having Jurisdiction
  nec_version     TEXT DEFAULT '2023',
  
  -- Closeout
  closeout_score  NUMERIC(5,2),  -- BLUEPRINT calculates this
  
  -- Metadata
  tags            TEXT[],
  metadata        JSONB DEFAULT '{}',
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- PROJECT TEMPLATES (BLUEPRINT)
-- ══════════════════════════════════
CREATE TABLE project_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  phases          JSONB NOT NULL,   -- [{name, order, checklist[], estimated_days}]
  default_tasks   JSONB,
  compliance_reqs JSONB,            -- default permit/inspection requirements
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- PROJECT PHASES (live tracking)
-- ══════════════════════════════════
CREATE TABLE project_phases (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  order_index     INT NOT NULL,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
  checklist       JSONB,           -- [{item, completed, completed_by, completed_at}]
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  notes           TEXT
);
```

### 3.3 Estimates & Financials (VAULT + LEDGER domain)

```sql
-- ══════════════════════════════════
-- ESTIMATES (VAULT domain)
-- ══════════════════════════════════
CREATE TABLE estimates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID REFERENCES projects(id),
  client_id       UUID REFERENCES clients(id),
  estimate_number TEXT NOT NULL,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','approved','rejected','expired')),
  
  -- Line items stored as JSONB array
  line_items      JSONB NOT NULL DEFAULT '[]',
  -- [{description, quantity, unit, unit_price, total, category, labor_hours}]
  
  subtotal        NUMERIC(12,2),
  tax_rate        NUMERIC(5,4),
  tax_amount      NUMERIC(12,2),
  total           NUMERIC(12,2),
  
  -- VAULT intelligence
  margin_pct      NUMERIC(5,2),
  vault_confidence NUMERIC(3,2),  -- how confident VAULT is in pricing (0-1)
  vault_notes     TEXT,            -- VAULT's analysis notes
  comparable_jobs UUID[],          -- references to similar past projects
  
  valid_until     DATE,
  sent_at         TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- INVOICES (LEDGER domain)
-- ══════════════════════════════════
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID REFERENCES projects(id),
  client_id       UUID REFERENCES clients(id),
  invoice_number  TEXT NOT NULL,
  status          TEXT DEFAULT 'draft' CHECK (status IN (
    'draft','sent','viewed','partial','paid','overdue','void','disputed'
  )),
  
  line_items      JSONB NOT NULL DEFAULT '[]',
  subtotal        NUMERIC(12,2),
  tax_rate        NUMERIC(5,4),
  tax_amount      NUMERIC(12,2),
  total           NUMERIC(12,2),
  amount_paid     NUMERIC(12,2) DEFAULT 0,
  balance_due     NUMERIC(12,2),
  
  -- LEDGER tracking
  due_date        DATE,
  days_overdue    INT GENERATED ALWAYS AS (
    CASE WHEN status = 'overdue' THEN EXTRACT(DAY FROM NOW() - due_date)::INT ELSE 0 END
  ) STORED,
  last_reminder_at TIMESTAMPTZ,
  reminder_count  INT DEFAULT 0,
  payment_method  TEXT,
  
  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- PAYMENTS (LEDGER domain)
-- ══════════════════════════════════
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  invoice_id      UUID REFERENCES invoices(id),
  amount          NUMERIC(12,2) NOT NULL,
  method          TEXT CHECK (method IN ('check','cash','credit_card','ach','zelle','venmo','other')),
  reference       TEXT,           -- check number, transaction ID
  received_at     TIMESTAMPTZ DEFAULT NOW(),
  recorded_by     UUID REFERENCES profiles(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.4 RFIs & Change Orders (BLUEPRINT domain)

```sql
-- ══════════════════════════════════
-- RFIs (Request for Information)
-- ══════════════════════════════════
CREATE TABLE rfis (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID NOT NULL REFERENCES projects(id),
  rfi_number      TEXT NOT NULL,
  subject         TEXT NOT NULL,
  description     TEXT,
  status          TEXT DEFAULT 'open' CHECK (status IN ('draft','open','pending','answered','closed')),
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  
  submitted_to    TEXT,           -- GC name or entity
  submitted_at    TIMESTAMPTZ,
  response_due    DATE,
  responded_at    TIMESTAMPTZ,
  response        TEXT,
  
  -- BLUEPRINT tracking
  days_until_due  INT,
  is_overdue      BOOLEAN DEFAULT false,
  linked_change_order_id UUID,   -- if RFI results in a change order
  
  attachments     JSONB DEFAULT '[]',
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- CHANGE ORDERS
-- ══════════════════════════════════
CREATE TABLE change_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID NOT NULL REFERENCES projects(id),
  rfi_id          UUID REFERENCES rfis(id),
  co_number       TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT DEFAULT 'pending' CHECK (status IN ('draft','pending','approved','rejected','void')),
  
  amount          NUMERIC(12,2),
  labor_hours     NUMERIC(8,2),
  
  submitted_at    TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  approved_by     TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.5 Calendar & Scheduling (CHRONO domain)

```sql
-- ══════════════════════════════════
-- CALENDAR EVENTS
-- ══════════════════════════════════
CREATE TABLE calendar_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID REFERENCES projects(id),
  client_id       UUID REFERENCES clients(id),
  
  title           TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN (
    'job','estimate','follow_up','inspection','material_pickup',
    'meeting','service_call','blocked','personal'
  )),
  status          TEXT DEFAULT 'scheduled' CHECK (status IN (
    'scheduled','confirmed','in_progress','completed','canceled','rescheduled'
  )),
  
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  all_day         BOOLEAN DEFAULT false,
  
  -- CHRONO fields
  assigned_to     UUID[] DEFAULT '{}',   -- crew member profile IDs
  location        JSONB,                  -- {address, lat, lng}
  travel_time_min INT,                    -- estimated travel time
  
  -- Reminders
  client_reminded BOOLEAN DEFAULT false,
  reminder_sent_at TIMESTAMPTZ,
  client_confirmed BOOLEAN,
  
  -- Google Calendar sync
  google_event_id TEXT,
  google_calendar_id TEXT,
  sync_status     TEXT DEFAULT 'local' CHECK (sync_status IN ('local','synced','conflict')),
  
  recurrence      JSONB,          -- for recurring events
  notes           TEXT,
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- CREW MEMBERS (for CHRONO dispatch)
-- ══════════════════════════════════
CREATE TABLE crew_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  profile_id      UUID REFERENCES profiles(id),
  name            TEXT NOT NULL,
  role            TEXT,           -- 'journeyman', 'apprentice', 'foreman', 'helper'
  phone           TEXT,
  hourly_rate     NUMERIC(8,2),
  skills          TEXT[],         -- ['residential', 'commercial', 'solar', 'ev']
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.6 Marketing & Leads (SPARK domain)

```sql
-- ══════════════════════════════════
-- LEADS (SPARK domain)
-- ══════════════════════════════════
CREATE TABLE leads (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  client_id       UUID REFERENCES clients(id),   -- linked after conversion
  
  name            TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  address         JSONB,
  source          TEXT CHECK (source IN (
    'google_ads','google_organic','website_form','phone','referral',
    'facebook','instagram','linkedin','yelp','nextdoor','other'
  )),
  
  status          TEXT DEFAULT 'new' CHECK (status IN (
    'new','contacted','estimate_scheduled','estimate_sent',
    'won','lost','unresponsive'
  )),
  
  service_needed  TEXT,
  urgency         TEXT DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','emergency')),
  estimated_value NUMERIC(12,2),
  
  -- SPARK tracking
  first_contact_at TIMESTAMPTZ,
  follow_up_count INT DEFAULT 0,
  last_follow_up  TIMESTAMPTZ,
  conversion_date TIMESTAMPTZ,
  lost_reason     TEXT,
  
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- MARKETING CAMPAIGNS (SPARK domain)
-- ══════════════════════════════════
CREATE TABLE campaigns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  name            TEXT NOT NULL,
  type            TEXT CHECK (type IN ('email','social','google_ads','review_request','seasonal')),
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','active','paused','completed')),
  channel         TEXT,           -- 'instagram', 'facebook', 'email', 'google'
  
  content         JSONB,          -- {subject, body, images[], cta}
  audience        JSONB,          -- {segment, filters, count}
  
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  
  -- Performance (SPARK + PULSE)
  recipients      INT DEFAULT 0,
  opens           INT DEFAULT 0,
  clicks          INT DEFAULT 0,
  conversions     INT DEFAULT 0,
  revenue_attributed NUMERIC(12,2) DEFAULT 0,
  
  created_by      UUID REFERENCES profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- REVIEWS (SPARK domain)
-- ══════════════════════════════════
CREATE TABLE reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID REFERENCES projects(id),
  client_id       UUID REFERENCES clients(id),
  
  platform        TEXT CHECK (platform IN ('google','yelp','facebook','nextdoor','other')),
  rating          INT CHECK (rating BETWEEN 1 AND 5),
  content         TEXT,
  author_name     TEXT,
  
  -- SPARK response management
  response_status TEXT DEFAULT 'pending' CHECK (response_status IN ('pending','drafted','approved','responded','skipped')),
  drafted_response TEXT,          -- SPARK drafts, you approve
  final_response  TEXT,
  responded_at    TIMESTAMPTZ,
  
  external_id     TEXT,           -- platform's review ID
  review_date     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.7 Agent System Tables

```sql
-- ══════════════════════════════════
-- AGENT REGISTRY
-- ══════════════════════════════════
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,    -- 'nexus', 'vault', 'pulse', etc.
  name            TEXT NOT NULL,
  display_name    TEXT NOT NULL,       -- 'NEXUS — Manager Agent'
  domain          TEXT NOT NULL,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','paused','error','maintenance')),
  config          JSONB DEFAULT '{}',  -- agent-specific configuration
  memory_scope    TEXT[] DEFAULT '{}', -- which tables this agent can read
  last_active_at  TIMESTAMPTZ,
  error_count     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the 11 agents
INSERT INTO agents (id, name, display_name, domain, memory_scope) VALUES
  ('nexus',     'NEXUS',     'NEXUS — Manager Agent',          'command',    ARRAY['*']),
  ('vault',     'VAULT',     'VAULT — Estimating Agent',       'estimating', ARRAY['estimates','projects','clients']),
  ('pulse',     'PULSE',     'PULSE — Dashboard Agent',        'dashboard',  ARRAY['projects','invoices','estimates','leads','campaigns']),
  ('ledger',    'LEDGER',    'LEDGER — Money Agent',           'finance',    ARRAY['invoices','payments','projects']),
  ('spark',     'SPARK',     'SPARK — Marketing Agent',        'marketing',  ARRAY['leads','campaigns','reviews','clients']),
  ('blueprint', 'BLUEPRINT', 'BLUEPRINT — Project Framework',  'projects',   ARRAY['projects','project_phases','rfis','change_orders','project_templates']),
  ('ohm',       'OHM',       'OHM — Electrical Coach',         'compliance', ARRAY['projects','rfis','compliance_checks']),
  ('chrono',    'CHRONO',    'CHRONO — Calendar Agent',        'calendar',   ARRAY['calendar_events','crew_members','projects','leads']),
  ('scout',     'SCOUT',     'SCOUT — System Analyzer',        'analysis',   ARRAY['*']),
  ('signal',    'SIGNAL',    'SIGNAL — RFI Agent (Legacy)',    'rfi',        ARRAY['rfis','projects']),
  ('frame',     'FRAME',     'FRAME — Project Agent (Legacy)', 'projects',   ARRAY['projects','project_phases']);

-- ══════════════════════════════════
-- AGENT PROPOSALS (SCOUT + OHM)
-- ══════════════════════════════════
CREATE TABLE agent_proposals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  proposing_agent TEXT NOT NULL REFERENCES agents(id),
  
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  category        TEXT,           -- 'nec_compliance', 'operations', 'safety', 'feature', 'optimization'
  source_data     JSONB,          -- what triggered this proposal
  
  impact_score    NUMERIC(3,2),   -- 0-1 how impactful
  risk_score      NUMERIC(3,2),   -- 0-1 how risky
  
  status          TEXT DEFAULT 'proposed' CHECK (status IN (
    'proposed','reviewing','confirmed','integrating','completed','skipped','rejected'
  )),
  
  -- MiroFish verification chain
  mirofish_step   INT DEFAULT 0,  -- 0-5 (which verification step)
  mirofish_log    JSONB DEFAULT '[]',  -- [{step, agent, action, timestamp}]
  
  confirmed_by    UUID REFERENCES profiles(id),
  confirmed_at    TIMESTAMPTZ,
  integrated_at   TIMESTAMPTZ,
  
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- AGENT MESSAGES (inter-agent comms)
-- ══════════════════════════════════
CREATE TABLE agent_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  from_agent      TEXT NOT NULL REFERENCES agents(id),
  to_agent        TEXT NOT NULL REFERENCES agents(id),
  
  type            TEXT NOT NULL CHECK (type IN (
    'delegation','report','alert','query','response','escalation'
  )),
  priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  
  subject         TEXT,
  payload         JSONB NOT NULL,    -- the actual message content
  
  status          TEXT DEFAULT 'sent' CHECK (status IN ('sent','received','processed','failed')),
  processed_at    TIMESTAMPTZ,
  
  -- Context
  project_id      UUID REFERENCES projects(id),
  related_entity  TEXT,             -- 'invoice:uuid', 'rfi:uuid', etc.
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════
-- NOTIFICATIONS (agent → user)
-- ══════════════════════════════════
CREATE TABLE notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  user_id         UUID NOT NULL REFERENCES profiles(id),
  agent_id        TEXT REFERENCES agents(id),
  
  type            TEXT NOT NULL,     -- 'alert', 'reminder', 'proposal', 'report', 'anomaly'
  title           TEXT NOT NULL,
  body            TEXT,
  data            JSONB,             -- deep link info, action buttons
  
  channel         TEXT DEFAULT 'push' CHECK (channel IN ('push','email','sms','in_app')),
  is_read         BOOLEAN DEFAULT false,
  read_at         TIMESTAMPTZ,
  
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.8 NEC Compliance (OHM domain)

```sql
-- ══════════════════════════════════
-- COMPLIANCE CHECKS (OHM domain)
-- ══════════════════════════════════
CREATE TABLE compliance_checks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  project_id      UUID REFERENCES projects(id),
  agent_id        TEXT DEFAULT 'ohm' REFERENCES agents(id),
  
  check_type      TEXT NOT NULL CHECK (check_type IN (
    'nec','osha','title24','ahj','general'
  )),
  code_reference  TEXT,           -- 'NEC 210.52', 'OSHA 1910.333'
  code_version    TEXT,           -- '2023', '2020'
  
  finding         TEXT NOT NULL,
  severity        TEXT CHECK (severity IN ('info','warning','violation','critical')),
  recommendation  TEXT,
  
  status          TEXT DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','not_applicable')),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES profiles(id),
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Role-Based Access Control (RBAC)

### 4.1 Role Definitions

```sql
-- ══════════════════════════════════
-- ROLE PERMISSIONS MATRIX
-- ══════════════════════════════════
-- Stored as reference; enforced via RLS policies

-- owner:  Full access. Can manage org settings, billing, users.
-- admin:  Full project/financial access. Cannot manage billing.
-- field:  Can view assigned projects, update phases, log time. No financial data.
-- viewer: Read-only access to projects and calendar. No financials.
```

### 4.2 Row Level Security Policies

```sql
-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Helper function: get user's org_id
CREATE OR REPLACE FUNCTION auth.user_org_id()
RETURNS UUID AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Helper function: get user's role
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ══════════════════════════════════
-- EXAMPLE RLS POLICIES
-- ══════════════════════════════════

-- Projects: all org members can read, owner/admin can write
CREATE POLICY "projects_read" ON projects FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "projects_write" ON projects FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

-- Invoices: only owner/admin can see financial data
CREATE POLICY "invoices_read" ON invoices FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "invoices_write" ON invoices FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');

-- Calendar: all can read, owner/admin can write
CREATE POLICY "calendar_read" ON calendar_events FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "calendar_write" ON calendar_events FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

-- Notifications: users see only their own
CREATE POLICY "notifications_own" ON notifications FOR SELECT
  USING (user_id = auth.uid());
```

---

## 5. Authentication Flow

### 5.1 Flow Diagram

```
App Launch
  ├─ First time? → Supabase Auth (email/password or magic link)
  │                  → Create profile → Set 6-digit passcode
  │                  → Optional: enable biometric
  │
  └─ Returning? → Passcode screen (6-digit PIN)
                    ├─ Biometric available? → Face ID / Touch ID / Windows Hello
                    └─ Correct? → Load dashboard
                        └─ 5 failed attempts → Lock for 15 min → notify owner
```

### 5.2 Passcode Implementation

```typescript
// lib/auth/passcode.ts — pseudocode for the passcode layer

import bcrypt from 'bcryptjs';
import { supabase } from '../supabase';

// Set passcode (during onboarding or settings)
export async function setPasscode(userId: string, passcode: string) {
  const hash = await bcrypt.hash(passcode, 12);
  await supabase
    .from('profiles')
    .update({ passcode_hash: hash })
    .eq('id', userId);
}

// Verify passcode (at app launch)
export async function verifyPasscode(userId: string, passcode: string): Promise<boolean> {
  const { data } = await supabase
    .from('profiles')
    .select('passcode_hash')
    .eq('id', userId)
    .single();
  
  if (!data?.passcode_hash) return false;
  return bcrypt.compare(passcode, data.passcode_hash);
}

// Biometric: use platform APIs
// iOS: LocalAuthentication framework via Capacitor plugin
// Android: BiometricPrompt via Capacitor plugin
// Windows: Windows Hello via Tauri plugin
```

### 5.3 Session Management with Redis

```typescript
// lib/auth/session.ts — Redis session layer via Upstash

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_URL,
  token: process.env.UPSTASH_REDIS_TOKEN,
});

// Create session after successful passcode/biometric
export async function createSession(userId: string, deviceInfo: object) {
  const sessionId = crypto.randomUUID();
  await redis.setex(`session:${sessionId}`, 86400, {  // 24h TTL
    userId,
    deviceInfo,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  });
  return sessionId;
}

// Validate on each request
export async function validateSession(sessionId: string) {
  const session = await redis.get(`session:${sessionId}`);
  if (!session) return null;
  
  // Refresh TTL on activity
  await redis.expire(`session:${sessionId}`, 86400);
  await redis.set(`session:${sessionId}`, {
    ...session,
    lastActiveAt: Date.now(),
  });
  
  return session;
}
```

---

## 6. Shared Memory Bus Architecture

### 6.1 Three-Layer Memory

```
┌──────────────────────────────────────────────────────────┐
│  LAYER 1: SHORT-TERM (Upstash Redis)                     │
│  TTL: 1-24 hours                                         │
│  Contents: Active session state, live agent context,     │
│  current conversation thread, real-time flags            │
│  Access: All agents during active sessions               │
├──────────────────────────────────────────────────────────┤
│  LAYER 2: LONG-TERM (Supabase PostgreSQL + pgvector)     │
│  TTL: Permanent                                          │
│  Contents: Full interaction history, project data,       │
│  embeddings for semantic search, agent decision logs     │
│  Access: Scoped per agent (see agents.memory_scope)      │
├──────────────────────────────────────────────────────────┤
│  LAYER 3: AUDIT LOG (PostgreSQL, append-only)            │
│  TTL: Permanent, immutable                               │
│  Contents: Every action by every actor (user or agent),  │
│  timestamped, IP-tagged, device-tagged                   │
│  Access: Owner + Admin read-only. No deletes.            │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Vector Memory Table (pgvector)

```sql
-- ══════════════════════════════════
-- MEMORY EMBEDDINGS (semantic search)
-- ══════════════════════════════════
CREATE TABLE memory_embeddings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  
  -- What is this memory about?
  entity_type     TEXT NOT NULL,   -- 'project', 'estimate', 'invoice', 'rfi', 'interaction', 'proposal'
  entity_id       UUID,            -- reference to the source record
  agent_id        TEXT REFERENCES agents(id),  -- which agent created this memory
  
  -- The content
  content         TEXT NOT NULL,    -- human-readable text of the memory
  embedding       vector(1536),    -- OpenAI text-embedding-3-small (1536 dims)
  
  -- Metadata for filtering
  metadata        JSONB DEFAULT '{}',
  -- {project_type, client_id, date_range, tags, importance}
  
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Create HNSW index for fast similarity search
CREATE INDEX ON memory_embeddings 
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Index for filtered searches
CREATE INDEX idx_memory_org ON memory_embeddings(org_id);
CREATE INDEX idx_memory_entity ON memory_embeddings(entity_type, entity_id);
CREATE INDEX idx_memory_agent ON memory_embeddings(agent_id);
```

### 6.3 Semantic Search Function

```sql
-- Search memory by semantic similarity
CREATE OR REPLACE FUNCTION search_memory(
  p_org_id UUID,
  p_query_embedding vector(1536),
  p_agent_id TEXT DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_limit INT DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  entity_type TEXT,
  entity_id UUID,
  content TEXT,
  similarity FLOAT,
  metadata JSONB,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.id,
    me.entity_type,
    me.entity_id,
    me.content,
    1 - (me.embedding <=> p_query_embedding) AS similarity,
    me.metadata,
    me.created_at
  FROM memory_embeddings me
  WHERE me.org_id = p_org_id
    AND (p_agent_id IS NULL OR me.agent_id = p_agent_id)
    AND (p_entity_type IS NULL OR me.entity_type = p_entity_type)
    AND 1 - (me.embedding <=> p_query_embedding) >= p_threshold
  ORDER BY me.embedding <=> p_query_embedding
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 6.4 Redis Memory Keys (Short-Term)

```
# Key structure for Upstash Redis

# Active agent context (per org, per agent)
agent:context:{org_id}:{agent_id}     → JSON  (TTL: 4h)
  {current_tasks, recent_decisions, active_flags, last_query}

# Live session state
session:{session_id}                   → JSON  (TTL: 24h)
  {userId, orgId, deviceInfo, lastActiveAt}

# Real-time flags (LEDGER overdue, CHRONO conflict, etc.)
flags:{org_id}                         → SORTED SET (TTL: 12h)
  score = timestamp, member = {agent, type, entity_id, message}

# NEXUS conversation thread
conversation:{org_id}:{thread_id}      → LIST  (TTL: 2h)
  [{role, content, agent, timestamp}]

# Rate limiting (per agent, per org)
ratelimit:{org_id}:{agent_id}          → counter (TTL: 60s)
```

---

## 7. Audit Trail System

### 7.1 Audit Log Table

```sql
-- ══════════════════════════════════
-- AUDIT LOG (immutable, append-only)
-- ══════════════════════════════════
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,  -- sequential for ordering
  org_id          UUID NOT NULL REFERENCES organizations(id),
  
  -- Who
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_id        TEXT NOT NULL,    -- user UUID or agent ID
  actor_name      TEXT,             -- display name at time of action
  
  -- What
  action          TEXT NOT NULL,    -- 'create', 'update', 'delete', 'view', 'export', 'login', 'send'
  entity_type     TEXT NOT NULL,    -- 'project', 'invoice', 'estimate', etc.
  entity_id       UUID,
  
  -- Details
  description     TEXT,             -- human-readable: "LEDGER sent payment reminder for Invoice #1042"
  changes         JSONB,            -- {field: {old: x, new: y}} for updates
  metadata        JSONB DEFAULT '{}',
  
  -- Context
  ip_address      INET,
  device_type     TEXT,
  session_id      UUID,
  
  -- Timestamp (never trust client time)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- CRITICAL: No UPDATE or DELETE policies on audit_log
-- Make it append-only via RLS
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_insert" ON audit_log FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

CREATE POLICY "audit_read" ON audit_log FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

-- No UPDATE or DELETE policies = truly immutable

-- Indexes for searching
CREATE INDEX idx_audit_org_time ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_type, actor_id);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_action ON audit_log(action);
```

### 7.2 Audit Trigger Function

```sql
-- Auto-log changes on any tracked table
CREATE OR REPLACE FUNCTION log_audit_change()
RETURNS TRIGGER AS $$
DECLARE
  v_changes JSONB;
  v_action TEXT;
  v_actor_id TEXT;
  v_actor_type TEXT;
BEGIN
  -- Determine action
  v_action := TG_OP;  -- INSERT, UPDATE, DELETE
  
  -- Actor: check if triggered by agent (via app_metadata) or user
  v_actor_id := COALESCE(
    current_setting('app.current_agent', true),
    auth.uid()::TEXT,
    'system'
  );
  v_actor_type := CASE
    WHEN current_setting('app.current_agent', true) IS NOT NULL THEN 'agent'
    WHEN auth.uid() IS NOT NULL THEN 'user'
    ELSE 'system'
  END;
  
  -- Calculate changes for UPDATE
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(key, jsonb_build_object('old', old_val, 'new', new_val))
    INTO v_changes
    FROM (
      SELECT key, 
             row_to_json(OLD)::jsonb -> key AS old_val,
             row_to_json(NEW)::jsonb -> key AS new_val
      FROM jsonb_object_keys(row_to_json(NEW)::jsonb) AS key
      WHERE row_to_json(OLD)::jsonb -> key IS DISTINCT FROM row_to_json(NEW)::jsonb -> key
        AND key NOT IN ('updated_at')
    ) diff;
  END IF;
  
  -- Insert audit record
  INSERT INTO audit_log (org_id, actor_type, actor_id, action, entity_type, entity_id, changes)
  VALUES (
    COALESCE(NEW.org_id, OLD.org_id),
    v_actor_type,
    v_actor_id,
    LOWER(v_action),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    v_changes
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply trigger to all tracked tables
CREATE TRIGGER audit_projects AFTER INSERT OR UPDATE OR DELETE ON projects
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
CREATE TRIGGER audit_estimates AFTER INSERT OR UPDATE OR DELETE ON estimates
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
CREATE TRIGGER audit_rfis AFTER INSERT OR UPDATE OR DELETE ON rfis
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
CREATE TRIGGER audit_calendar AFTER INSERT OR UPDATE OR DELETE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
CREATE TRIGGER audit_leads AFTER INSERT OR UPDATE OR DELETE ON leads
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
CREATE TRIGGER audit_proposals AFTER INSERT OR UPDATE OR DELETE ON agent_proposals
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
```

### 7.3 Anomaly Detection Function

```sql
-- Detect anomalous activity patterns
CREATE OR REPLACE FUNCTION check_anomalies()
RETURNS VOID AS $$
DECLARE
  v_record RECORD;
BEGIN
  -- Flag 1: Login from new device + new IP
  -- Flag 2: Bulk export (>10 records in 1 min)
  -- Flag 3: Off-hours access (outside 5am-10pm local)
  -- Flag 4: Rapid-fire deletes (>3 in 5 min)
  
  -- Bulk export detection
  FOR v_record IN
    SELECT actor_id, org_id, COUNT(*) as action_count
    FROM audit_log
    WHERE action = 'export'
      AND created_at > NOW() - INTERVAL '1 minute'
    GROUP BY actor_id, org_id
    HAVING COUNT(*) > 10
  LOOP
    INSERT INTO notifications (org_id, user_id, agent_id, type, title, body)
    SELECT v_record.org_id, p.id, 'scout', 'anomaly',
           'Bulk Export Detected',
           'Unusual export activity detected: ' || v_record.action_count || ' exports in the last minute.'
    FROM profiles p
    WHERE p.org_id = v_record.org_id AND p.role = 'owner';
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule anomaly check every 5 minutes
SELECT cron.schedule('anomaly-check', '*/5 * * * *', 'SELECT check_anomalies()');
```

---

## 8. Encrypted Backup Automation

### 8.1 Backup Strategy

```
Schedule: Nightly at 2:00 AM PST
Target: Cloudflare R2 bucket (encrypted)
Retention: 30 days (rolling)
Contents: Full database dump + storage bucket files
Encryption: AES-256 at rest (R2 default) + client-side GPG
Recovery: Point-in-time via Supabase PITR + R2 snapshots
```

### 8.2 Backup Edge Function

```typescript
// supabase/functions/nightly-backup/index.ts
// Triggered by pg_cron at 2:00 AM PST

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: Deno.env.get('R2_ENDPOINT'),
  credentials: {
    accessKeyId: Deno.env.get('R2_ACCESS_KEY')!,
    secretAccessKey: Deno.env.get('R2_SECRET_KEY')!,
  },
});

Deno.serve(async () => {
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `poweron-backup-${timestamp}.sql.gz.enc`;
  
  // 1. Trigger Supabase database backup via management API
  // 2. Encrypt with GPG
  // 3. Upload to R2
  
  await r2.send(new PutObjectCommand({
    Bucket: 'poweron-backups',
    Key: `daily/${filename}`,
    // Body: encrypted backup stream
    Metadata: {
      'backup-date': timestamp,
      'encryption': 'aes-256-gcm',
    },
  }));
  
  // 4. Log to audit trail
  // 5. Clean up backups older than 30 days
  // 6. Send confirmation notification
  
  return new Response(JSON.stringify({ status: 'ok', file: filename }));
});
```

---

## 9. Environment Variables

```bash
# ══════════════════════════════════
# .env.local (NEVER commit this file)
# ══════════════════════════════════

# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-side only

# Upstash Redis
UPSTASH_REDIS_URL=https://xxxxx.upstash.io
UPSTASH_REDIS_TOKEN=AX...

# Cloudflare R2
R2_ENDPOINT=https://xxxxx.r2.cloudflarestorage.com
R2_ACCESS_KEY=xxxxx
R2_SECRET_KEY=xxxxx
R2_BUCKET=poweron-backups

# OpenAI (for embeddings)
OPENAI_API_KEY=sk-...

# Anthropic (for agents — Phase 02)
ANTHROPIC_API_KEY=sk-ant-...

# Stripe (Phase 08, but set up early)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...

# OneSignal (push notifications)
ONESIGNAL_APP_ID=xxxxx
ONESIGNAL_API_KEY=xxxxx

# ElevenLabs (Phase 06)
ELEVENLABS_API_KEY=xxxxx

# Google APIs (Phase 05)
GOOGLE_CLIENT_ID=xxxxx
GOOGLE_CLIENT_SECRET=xxxxx
GOOGLE_CALENDAR_API_KEY=xxxxx
```

---

## 10. Migration Checklist from Existing Hub

```
[ ] Export all client data from current Hub → map to `clients` table
[ ] Export all project/job data → map to `projects` table
[ ] Export estimates → map to `estimates` table  
[ ] Export invoices + payment records → map to `invoices` + `payments`
[ ] Export any RFI data → map to `rfis` table
[ ] Export calendar/scheduling data → map to `calendar_events`
[ ] Map existing user accounts → create `profiles` entries
[ ] Verify data integrity after migration (row counts, totals)
[ ] Generate initial vector embeddings for all migrated project data
[ ] Seed `project_templates` with your standard job types
[ ] Run closeout scoring on completed projects to populate VAULT's archive
[ ] Verify RLS policies work correctly with migrated data
```

---

## 11. What Phase 02 Expects from Phase 01

Phase 02 builds NEXUS (manager agent), SCOUT (analyzer), and MiroFish verification. It requires:

- **Database fully operational** with all tables above created and RLS active
- **Auth flow working** — user can sign up, set passcode, log in with biometric
- **Redis connected** — session management and agent context keys functional
- **Vector store ready** — `memory_embeddings` table with HNSW index, `search_memory()` function working
- **Audit trail active** — triggers firing on all tracked tables
- **Agent registry seeded** — all 11 agents in `agents` table with memory scopes
- **Agent messages table ready** — NEXUS will use this to delegate to sub-agents
- **Agent proposals table ready** — SCOUT will write proposals here, MiroFish will process them
- **Notifications table ready** — agents will push alerts to users
- **At least one project template** created so BLUEPRINT has something to work with
- **Backup automation running** — nightly R2 snapshots verified
- **Operations Hub data tables live** (migrations 008–013) — field_logs, service_logs, price_book_items, price_book_categories, material_takeoffs, material_takeoff_lines, weekly_tracker, coordination_items, agenda_sections, agenda_tasks, project_labor_entries, project_material_entries, project_overhead_entries, gc_contacts, gc_activity_log
- **RLS policies active on all new tables** (migration 014) — same role matrix as 006
- **Agent memory_scope arrays expanded** (migration 015) — VAULT sees price book + cost entries; BLUEPRINT sees coordination + MTOs + field logs; PULSE sees weekly tracker + field logs; LEDGER sees field logs + cost entries; SPARK sees GC contacts; OHM sees field logs + coordination; CHRONO sees agenda tasks + field logs
- **memory_embeddings entity_type constraint expanded** to include: field_log, service_log, price_book_item, material_takeoff, weekly_tracker, coordination_item, agenda_task, labor_entry, material_entry, overhead_entry, gc_contact, gc_activity
- **project_cost_summary view** available — aggregates labor + material + overhead per project with estimated margin percentage

### NEXUS Context Loader — Additional Data Sources

When NEXUS initializes context for a user session, it should load these additional data streams alongside the original tables:

| Data Source | Table(s) | Agent Domain | Load Strategy |
|---|---|---|---|
| Field Logs | `field_logs`, `service_logs` | BLUEPRINT, OHM, CHRONO, LEDGER | Last 30 days + unpaid |
| Price Book | `price_book_items`, `price_book_categories` | VAULT, BLUEPRINT | Full catalog (cached) |
| Material Takeoffs | `material_takeoffs`, `material_takeoff_lines` | VAULT, BLUEPRINT | Active projects only |
| 52-Week Tracker | `weekly_tracker` | PULSE, LEDGER | Current fiscal year |
| Coordination Items | `coordination_items` | BLUEPRINT, OHM | Open + in_progress only |
| Agenda Tasks | `agenda_sections`, `agenda_tasks` | CHRONO, BLUEPRINT | Pending tasks only |
| Project Costs | `project_labor_entries`, `project_material_entries`, `project_overhead_entries` | VAULT, LEDGER, PULSE | Active projects |
| Cost Summary | `project_cost_summary` (view) | VAULT, PULSE | All projects with contract_value |
| GC Contacts | `gc_contacts`, `gc_activity_log` | SPARK, PULSE | Active pipeline + last 90 days activity |

### NEXUS System Prompt — Additional Context Block

When building the NEXUS system prompt, append this block after the existing agent summaries:

```
## Operations Hub Data (Migrated from v15r)

You have access to the following operational data streams from the field:

FIELD LOGS: Daily work entries per project — hours, mileage, materials, pay status.
  Query: field_logs (project_id, employee_id, log_date, hours, material_cost, pay_status)
  Also: service_logs for service-call variants with job_type classification.

PRICE BOOK: Master material catalog with 275+ items across 15 categories.
  Query: price_book_items (name, unit_cost, unit, supplier, waste_factor, category_name)
  Categories: Wire, Conduit, Boxes, Devices, Breakers, Panels, Lighting, EV, Solar, Hardware.

MATERIAL TAKEOFFS: Per-project bill of materials with phase breakdown.
  Query: material_takeoffs → material_takeoff_lines (phase, quantity, unit_cost, waste_factor, line_total)

52-WEEK TRACKER: Weekly revenue and activity KPIs for the fiscal year.
  Query: weekly_tracker (week_number, active_projects, service_revenue, project_revenue, unbilled_amount, ytd_revenue)

COORDINATION ITEMS: Per-project items across 6 categories (light, main, urgent, research, permit, inspect).
  Query: coordination_items (project_id, category, title, status, due_date)

AGENDA TASKS: Daily task management grouped by section (Today, This Week, etc.).
  Query: agenda_sections → agenda_tasks (text, status, assigned_to, due_date)

PROJECT COST BREAKDOWN: Estimated labor, material, and overhead line items per project.
  Query: project_labor_entries, project_material_entries, project_overhead_entries
  Summary view: project_cost_summary (est_labor_cost, est_material_cost, est_overhead_cost, est_margin_pct)

GC RELATIONSHIP DATABASE: General contractor pipeline with bid history and payment behavior.
  Query: gc_contacts (company, pipeline_phase, bids_sent, bids_awarded, win_rate, fit_score, payment_rating)
  Activity: gc_activity_log (activity_type, description, amount)

When a user asks about job costs, compare field_logs (actuals) against project cost entries (estimates).
When a user asks about materials, reference the price_book_items catalog and any active MTOs.
When a user asks about GC relationships, query gc_contacts and gc_activity_log for full pipeline context.
When a user asks about weekly/monthly performance, query weekly_tracker for the relevant date range.
```

### Files You Should Have After Phase 01

```
poweron-hub/
├── src/
│   ├── lib/
│   │   ├── supabase.ts           # Supabase client init
│   │   ├── redis.ts              # Upstash Redis client
│   │   ├── auth/
│   │   │   ├── passcode.ts       # Passcode set/verify
│   │   │   ├── biometric.ts      # Platform biometric wrappers
│   │   │   └── session.ts        # Redis session management
│   │   ├── memory/
│   │   │   ├── embeddings.ts     # Create + search embeddings
│   │   │   ├── redis-context.ts  # Agent short-term context
│   │   │   └── audit.ts          # Audit log helpers
│   │   └── db/
│   │       └── types.ts          # Generated Supabase types
│   ├── components/
│   │   ├── auth/
│   │   │   ├── PasscodeScreen.tsx
│   │   │   ├── BiometricPrompt.tsx
│   │   │   └── LoginFlow.tsx
│   │   └── layout/
│   │       └── AppShell.tsx      # Basic app layout
│   └── App.tsx
├── supabase/
│   ├── migrations/
│   │   ├── 001_extensions.sql
│   │   ├── 002_core_tables.sql
│   │   ├── 003_agent_tables.sql
│   │   ├── 004_memory_tables.sql
│   │   ├── 005_audit_system.sql
│   │   ├── 006_rls_policies.sql
│   │   ├── 007_seed_agents.sql
│   │   ├── 008_field_logs.sql                 # Field logs + service logs
│   │   ├── 009_price_book_and_material_takeoff.sql  # Price book + MTO tables
│   │   ├── 010_weekly_tracker.sql             # 52-week revenue tracker
│   │   ├── 011_coordination_and_agenda.sql    # Coordination items + agenda tasks
│   │   ├── 012_project_cost_entries.sql       # Labor/material/overhead + cost view
│   │   ├── 013_gc_contacts.sql                # GC relationship database + activity log
│   │   ├── 014_rls_new_tables.sql             # RLS policies for tables 008–013
│   │   └── 015_update_agent_scopes.sql        # Agent memory_scope + entity_type expansion
│   └── functions/
│       └── nightly-backup/
│           └── index.ts
├── .env.local
├── package.json
├── vite.config.ts
└── README.md
```

---

## End of Phase 01 Spec

**Hand this document to Claude Code or Cowork.** It contains everything needed to build the foundation — database schema, auth, memory, audit trail, backup, and the file structure for Phase 02 to build on top of.

**Next spec needed:** Phase 02 — NEXUS Manager Agent + SCOUT Analyzer + MiroFish Verification Chain.
