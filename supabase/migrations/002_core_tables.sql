-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 002: Core Business Tables
-- Phase 01 Foundation
--
-- CREATION ORDER (dependency-safe):
--   1. organizations
--   2. profiles (→ auth.users, organizations)
--   3. user_sessions (→ profiles, organizations)
--   4. clients (→ organizations)
--   5. project_templates (→ organizations)          ← MOVED BEFORE projects
--   6. projects (→ organizations, clients, profiles, project_templates)
--   7. project_phases (→ projects)
--   8. estimates (→ organizations, projects, clients, profiles)
--   9. invoices (→ organizations, projects, clients, profiles)
--  10. payments (→ organizations, invoices, profiles)
--  11. rfis (→ organizations, projects, profiles)   ← WITHOUT linked_change_order_id (circular)
--  12. change_orders (→ organizations, projects, rfis, profiles)
--  13. ALTER TABLE rfis ADD COLUMN linked_change_order_id ← resolves circular FK
--  14. calendar_events (→ organizations, projects, clients, profiles)
--  15. crew_members (→ organizations, profiles)
--  16. leads (→ organizations, clients)
--  17. campaigns (→ organizations, profiles)
--  18. reviews (→ organizations, projects, clients)
--  19. compliance_checks (→ organizations, projects) ← agents table added in 003
--  20. moddatetime triggers for all updated_at columns
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. ORGANIZATIONS (multi-tenant root)
-- ══════════════════════════════════
CREATE TABLE organizations (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    TEXT NOT NULL,
  slug                    TEXT UNIQUE NOT NULL,
  owner_id                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_status     TEXT NOT NULL DEFAULT 'trial'
                            CHECK (subscription_status IN ('trial','active','past_due','canceled')),
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  settings                JSONB NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_owner ON organizations(owner_id);
CREATE INDEX idx_org_slug  ON organizations(slug);


-- ══════════════════════════════════
-- 2. PROFILES (extends Supabase auth.users)
-- ══════════════════════════════════
CREATE TABLE profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name           TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'viewer'
                        CHECK (role IN ('owner','admin','field','viewer')),
  phone               TEXT,
  avatar_url          TEXT,
  passcode_hash       TEXT,           -- bcrypt hash of 6-digit passcode
  biometric_enabled   BOOLEAN NOT NULL DEFAULT false,
  last_login_at       TIMESTAMPTZ,
  last_login_ip       INET,
  last_login_device   TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_org  ON profiles(org_id);
CREATE INDEX idx_profiles_role ON profiles(org_id, role);


-- ══════════════════════════════════
-- 3. USER SESSIONS (anomaly detection)
-- ══════════════════════════════════
CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_type     TEXT CHECK (device_type IN ('ios','android','web','desktop')),
  device_info     JSONB,         -- user_agent, os_version, app_version
  ip_address      INET,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  is_anomalous    BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_org  ON user_sessions(org_id);
CREATE INDEX idx_user_sessions_time ON user_sessions(started_at DESC);


-- ══════════════════════════════════
-- 4. CLIENTS
-- ══════════════════════════════════
CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  company     TEXT,
  email       TEXT,
  phone       TEXT,
  address     JSONB,   -- {street, city, state, zip, lat, lng}
  type        TEXT NOT NULL DEFAULT 'residential'
                CHECK (type IN ('residential','commercial','industrial')),
  source      TEXT,   -- 'referral','google','website','repeat'
  notes       TEXT,
  tags        TEXT[],
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_org  ON clients(org_id);
CREATE INDEX idx_clients_type ON clients(org_id, type);


-- ══════════════════════════════════
-- 5. PROJECT TEMPLATES (BLUEPRINT domain)
-- CREATED BEFORE projects to satisfy FK
-- ══════════════════════════════════
CREATE TABLE project_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  phases          JSONB NOT NULL,   -- [{name, order_index, checklist[], estimated_days}]
  default_tasks   JSONB,
  compliance_reqs JSONB,            -- default permit/inspection requirements per project type
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_templates_org  ON project_templates(org_id);
CREATE INDEX idx_templates_type ON project_templates(org_id, type);


-- ══════════════════════════════════
-- 6. PROJECTS (central entity — all agents reference this)
-- References project_templates (safe now that it's defined above)
-- ══════════════════════════════════
CREATE TABLE projects (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  type              TEXT NOT NULL CHECK (type IN (
    'residential_service','residential_remodel','residential_new',
    'commercial_ti','commercial_new','commercial_service',
    'industrial','solar','ev_charger','panel_upgrade','other'
  )),
  status            TEXT NOT NULL DEFAULT 'estimate' CHECK (status IN (
    'lead','estimate','pending','approved','in_progress',
    'on_hold','punch_list','closeout','completed','canceled'
  )),
  phase             TEXT,
  template_id       UUID REFERENCES project_templates(id) ON DELETE SET NULL,
  priority          TEXT NOT NULL DEFAULT 'normal'
                      CHECK (priority IN ('low','normal','high','urgent')),
  address           JSONB,          -- {street, city, state, zip, lat, lng}

  -- Financial snapshot (live totals are calculated; stored here for quick queries)
  estimated_value   NUMERIC(12,2),
  contract_value    NUMERIC(12,2),
  actual_cost       NUMERIC(12,2),

  -- Dates
  estimated_start   DATE,
  estimated_end     DATE,
  actual_start      DATE,
  actual_end        DATE,

  -- Compliance (BLUEPRINT + OHM domain)
  permit_status     TEXT NOT NULL DEFAULT 'not_required' CHECK (permit_status IN (
    'not_required','pending','submitted','approved','failed','expired'
  )),
  permit_number     TEXT,
  inspection_status TEXT,
  ahj_jurisdiction  TEXT,           -- Authority Having Jurisdiction
  nec_version       TEXT NOT NULL DEFAULT '2023',

  -- Closeout scoring (BLUEPRINT calculates, VAULT archives)
  closeout_score    NUMERIC(5,2),

  -- Metadata
  tags              TEXT[],
  metadata          JSONB NOT NULL DEFAULT '{}',
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_org        ON projects(org_id);
CREATE INDEX idx_projects_client     ON projects(client_id);
CREATE INDEX idx_projects_status     ON projects(org_id, status);
CREATE INDEX idx_projects_type       ON projects(org_id, type);
CREATE INDEX idx_projects_created_by ON projects(created_by);


-- ══════════════════════════════════
-- 7. PROJECT PHASES (live phase tracking — BLUEPRINT domain)
-- ══════════════════════════════════
CREATE TABLE project_phases (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  order_index   INT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','in_progress','completed','skipped')),
  checklist     JSONB,     -- [{item, completed, completed_by, completed_at}]
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  notes         TEXT
);

CREATE INDEX idx_phases_project ON project_phases(project_id);
CREATE INDEX idx_phases_status  ON project_phases(project_id, status);
CREATE UNIQUE INDEX idx_phases_order ON project_phases(project_id, order_index);


-- ══════════════════════════════════
-- 8. ESTIMATES (VAULT domain)
-- ══════════════════════════════════
CREATE TABLE estimates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  estimate_number   TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','sent','viewed','approved','rejected','expired'
  )),

  -- Line items: [{description, quantity, unit, unit_price, total, category, labor_hours}]
  line_items        JSONB NOT NULL DEFAULT '[]',

  subtotal          NUMERIC(12,2),
  tax_rate          NUMERIC(5,4),
  tax_amount        NUMERIC(12,2),
  total             NUMERIC(12,2),

  -- VAULT intelligence fields
  margin_pct        NUMERIC(5,2),
  vault_confidence  NUMERIC(3,2),  -- VAULT confidence score 0.00–1.00
  vault_notes       TEXT,
  comparable_jobs   UUID[],        -- UUIDs of similar past project records

  valid_until       DATE,
  sent_at           TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, estimate_number)
);

CREATE INDEX idx_estimates_org     ON estimates(org_id);
CREATE INDEX idx_estimates_project ON estimates(project_id);
CREATE INDEX idx_estimates_client  ON estimates(client_id);
CREATE INDEX idx_estimates_status  ON estimates(org_id, status);


-- ══════════════════════════════════
-- 9. INVOICES (LEDGER domain)
-- ══════════════════════════════════
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  invoice_number  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','sent','viewed','partial','paid','overdue','void','disputed'
  )),

  -- Line items: [{description, quantity, unit, unit_price, total, category}]
  line_items      JSONB NOT NULL DEFAULT '[]',

  subtotal        NUMERIC(12,2),
  tax_rate        NUMERIC(5,4),
  tax_amount      NUMERIC(12,2),
  total           NUMERIC(12,2),
  amount_paid     NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance_due     NUMERIC(12,2),

  -- LEDGER tracking fields
  due_date              DATE,
  days_overdue          INT GENERATED ALWAYS AS (
    CASE
      WHEN status = 'overdue' AND due_date IS NOT NULL
      THEN GREATEST(0, EXTRACT(DAY FROM NOW() - due_date)::INT)
      ELSE 0
    END
  ) STORED,
  last_reminder_at      TIMESTAMPTZ,
  reminder_count        INT NOT NULL DEFAULT 0,
  payment_method        TEXT,

  sent_at         TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, invoice_number)
);

CREATE INDEX idx_invoices_org     ON invoices(org_id);
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_invoices_client  ON invoices(client_id);
CREATE INDEX idx_invoices_status  ON invoices(org_id, status);
CREATE INDEX idx_invoices_due     ON invoices(org_id, due_date) WHERE status = 'overdue';


-- ══════════════════════════════════
-- 10. PAYMENTS (LEDGER domain)
-- ══════════════════════════════════
CREATE TABLE payments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id    UUID REFERENCES invoices(id) ON DELETE SET NULL,
  amount        NUMERIC(12,2) NOT NULL,
  method        TEXT CHECK (method IN (
    'check','cash','credit_card','ach','zelle','venmo','other'
  )),
  reference     TEXT,           -- check number, transaction ID, etc.
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_org     ON payments(org_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);


-- ══════════════════════════════════
-- 11. RFIs (BLUEPRINT domain — merged from SIGNAL)
-- NOTE: linked_change_order_id added AFTER change_orders is created (see below)
-- ══════════════════════════════════
CREATE TABLE rfis (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rfi_number          TEXT NOT NULL,
  subject             TEXT NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'draft','open','pending','answered','closed'
  )),
  priority            TEXT NOT NULL DEFAULT 'normal'
                        CHECK (priority IN ('low','normal','high','urgent')),

  submitted_to        TEXT,           -- GC name or entity
  submitted_at        TIMESTAMPTZ,
  response_due        DATE,
  responded_at        TIMESTAMPTZ,
  response            TEXT,

  -- BLUEPRINT computed tracking fields
  days_until_due      INT,
  is_overdue          BOOLEAN NOT NULL DEFAULT false,

  -- linked_change_order_id added via ALTER TABLE below (circular FK resolution)

  attachments         JSONB NOT NULL DEFAULT '[]',
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, project_id, rfi_number)
);

CREATE INDEX idx_rfis_org       ON rfis(org_id);
CREATE INDEX idx_rfis_project   ON rfis(project_id);
CREATE INDEX idx_rfis_status    ON rfis(org_id, status);
CREATE INDEX idx_rfis_priority  ON rfis(org_id, priority);


-- ══════════════════════════════════
-- 12. CHANGE ORDERS (BLUEPRINT domain)
-- References rfis — safe because rfis is already created above
-- ══════════════════════════════════
CREATE TABLE change_orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rfi_id        UUID REFERENCES rfis(id) ON DELETE SET NULL,
  co_number     TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'draft','pending','approved','rejected','void'
  )),

  amount        NUMERIC(12,2),
  labor_hours   NUMERIC(8,2),

  submitted_at  TIMESTAMPTZ,
  approved_at   TIMESTAMPTZ,
  approved_by   TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, project_id, co_number)
);

CREATE INDEX idx_co_org     ON change_orders(org_id);
CREATE INDEX idx_co_project ON change_orders(project_id);
CREATE INDEX idx_co_rfi     ON change_orders(rfi_id);
CREATE INDEX idx_co_status  ON change_orders(org_id, status);


-- ══════════════════════════════════
-- CIRCULAR FK RESOLUTION
-- Now that both rfis and change_orders exist, add the forward FK on rfis
-- ══════════════════════════════════
ALTER TABLE rfis
  ADD COLUMN linked_change_order_id UUID REFERENCES change_orders(id) ON DELETE SET NULL;

CREATE INDEX idx_rfis_change_order ON rfis(linked_change_order_id);


-- ══════════════════════════════════
-- 13. CALENDAR EVENTS (CHRONO domain)
-- ══════════════════════════════════
CREATE TABLE calendar_events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,

  title               TEXT NOT NULL,
  type                TEXT NOT NULL CHECK (type IN (
    'job','estimate','follow_up','inspection','material_pickup',
    'meeting','service_call','blocked','personal'
  )),
  status              TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled','confirmed','in_progress','completed','canceled','rescheduled'
  )),

  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ NOT NULL,
  all_day             BOOLEAN NOT NULL DEFAULT false,

  -- CHRONO dispatch fields
  assigned_to         UUID[] NOT NULL DEFAULT '{}',  -- crew member profile IDs
  location            JSONB,                          -- {address, lat, lng}
  travel_time_min     INT,                            -- estimated travel minutes

  -- Client reminders (CHRONO auto-manages)
  client_reminded     BOOLEAN NOT NULL DEFAULT false,
  reminder_sent_at    TIMESTAMPTZ,
  client_confirmed    BOOLEAN,

  -- Google Calendar sync
  google_event_id     TEXT,
  google_calendar_id  TEXT,
  sync_status         TEXT NOT NULL DEFAULT 'local'
                        CHECK (sync_status IN ('local','synced','conflict')),

  recurrence          JSONB,       -- iCal-style recurrence rules
  notes               TEXT,
  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cal_org          ON calendar_events(org_id);
CREATE INDEX idx_cal_project      ON calendar_events(project_id);
CREATE INDEX idx_cal_start        ON calendar_events(org_id, start_time);
CREATE INDEX idx_cal_assigned     ON calendar_events USING GIN(assigned_to);
CREATE INDEX idx_cal_google_sync  ON calendar_events(google_event_id) WHERE google_event_id IS NOT NULL;


-- ══════════════════════════════════
-- 14. CREW MEMBERS (CHRONO dispatch)
-- ══════════════════════════════════
CREATE TABLE crew_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  role          TEXT CHECK (role IN ('journeyman','apprentice','foreman','helper','estimator','pm')),
  phone         TEXT,
  hourly_rate   NUMERIC(8,2),
  skills        TEXT[],       -- ['residential','commercial','solar','ev','service','industrial']
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crew_org    ON crew_members(org_id);
CREATE INDEX idx_crew_active ON crew_members(org_id, is_active);


-- ══════════════════════════════════
-- 15. LEADS (SPARK domain)
-- ══════════════════════════════════
CREATE TABLE leads (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,  -- linked after conversion

  name              TEXT NOT NULL,
  phone             TEXT,
  email             TEXT,
  address           JSONB,
  source            TEXT CHECK (source IN (
    'google_ads','google_organic','website_form','phone','referral',
    'facebook','instagram','linkedin','yelp','nextdoor','other'
  )),
  status            TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','contacted','estimate_scheduled','estimate_sent',
    'won','lost','unresponsive'
  )),

  service_needed    TEXT,
  urgency           TEXT NOT NULL DEFAULT 'normal'
                      CHECK (urgency IN ('low','normal','high','emergency')),
  estimated_value   NUMERIC(12,2),

  -- SPARK tracking fields
  first_contact_at  TIMESTAMPTZ,
  follow_up_count   INT NOT NULL DEFAULT 0,
  last_follow_up    TIMESTAMPTZ,
  conversion_date   TIMESTAMPTZ,
  lost_reason       TEXT,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_leads_org     ON leads(org_id);
CREATE INDEX idx_leads_status  ON leads(org_id, status);
CREATE INDEX idx_leads_source  ON leads(org_id, source);
CREATE INDEX idx_leads_client  ON leads(client_id);


-- ══════════════════════════════════
-- 16. MARKETING CAMPAIGNS (SPARK domain)
-- ══════════════════════════════════
CREATE TABLE campaigns (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  type                TEXT CHECK (type IN (
    'email','social','google_ads','review_request','seasonal'
  )),
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft','scheduled','active','paused','completed'
  )),
  channel             TEXT,           -- 'instagram','facebook','email','google'

  content             JSONB,          -- {subject, body, images[], cta}
  audience            JSONB,          -- {segment, filters, count}

  scheduled_at        TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,

  -- Performance metrics (SPARK + PULSE)
  recipients          INT NOT NULL DEFAULT 0,
  opens               INT NOT NULL DEFAULT 0,
  clicks              INT NOT NULL DEFAULT 0,
  conversions         INT NOT NULL DEFAULT 0,
  revenue_attributed  NUMERIC(12,2) NOT NULL DEFAULT 0,

  created_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_org    ON campaigns(org_id);
CREATE INDEX idx_campaigns_status ON campaigns(org_id, status);


-- ══════════════════════════════════
-- 17. REVIEWS (SPARK domain)
-- ══════════════════════════════════
CREATE TABLE reviews (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,

  platform          TEXT CHECK (platform IN (
    'google','yelp','facebook','nextdoor','other'
  )),
  rating            INT CHECK (rating BETWEEN 1 AND 5),
  content           TEXT,
  author_name       TEXT,

  -- SPARK response management
  response_status   TEXT NOT NULL DEFAULT 'pending' CHECK (response_status IN (
    'pending','drafted','approved','responded','skipped'
  )),
  drafted_response  TEXT,    -- SPARK drafts, owner approves
  final_response    TEXT,
  responded_at      TIMESTAMPTZ,

  external_id       TEXT,    -- Platform's own review ID (for dedup)
  review_date       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (org_id, platform, external_id)
);

CREATE INDEX idx_reviews_org      ON reviews(org_id);
CREATE INDEX idx_reviews_rating   ON reviews(org_id, rating);
CREATE INDEX idx_reviews_platform ON reviews(org_id, platform);
CREATE INDEX idx_reviews_response ON reviews(org_id, response_status);


-- ══════════════════════════════════
-- 18. COMPLIANCE CHECKS (OHM domain)
-- NOTE: agent_id FK (→ agents table) added via migration 003 after agents table exists
-- ══════════════════════════════════
CREATE TABLE compliance_checks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id        TEXT NOT NULL DEFAULT 'ohm',  -- FK added in 003_agent_tables.sql

  check_type      TEXT NOT NULL CHECK (check_type IN (
    'nec','osha','title24','ahj','general'
  )),
  code_reference  TEXT,     -- e.g., 'NEC 210.52', 'OSHA 1910.333'
  code_version    TEXT,     -- e.g., '2023', '2020'

  finding         TEXT NOT NULL,
  severity        TEXT CHECK (severity IN ('info','warning','violation','critical')),
  recommendation  TEXT,

  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open','acknowledged','resolved','not_applicable'
  )),
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compliance_org      ON compliance_checks(org_id);
CREATE INDEX idx_compliance_project  ON compliance_checks(project_id);
CREATE INDEX idx_compliance_status   ON compliance_checks(org_id, status);
CREATE INDEX idx_compliance_severity ON compliance_checks(org_id, severity);


-- ══════════════════════════════════
-- MODDATETIME TRIGGERS
-- Auto-update updated_at on all relevant tables
-- ══════════════════════════════════
CREATE TRIGGER mdt_organizations
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_profiles
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_clients
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_project_templates
  BEFORE UPDATE ON project_templates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_projects
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_estimates
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_invoices
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_rfis
  BEFORE UPDATE ON rfis
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_change_orders
  BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_calendar_events
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_leads
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER mdt_campaigns
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);
