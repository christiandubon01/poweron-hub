-- 019_spark_chrono_tables.sql
-- Creates tables for SPARK (marketing/leads) and CHRONO (calendar/scheduling) agents
-- Required for Phase 05

-- ═══════════════════════════════════════════════════════════════════════════════
-- SPARK TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Leads — Lead pipeline for SPARK agent
CREATE TABLE IF NOT EXISTS leads (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_source           VARCHAR(50) NOT NULL DEFAULT 'direct',
  source_detail         TEXT,
  name                  VARCHAR(255) NOT NULL,
  phone                 VARCHAR(20),
  email                 VARCHAR(255),
  gc_contact_id         UUID REFERENCES gc_contacts(id) ON DELETE SET NULL,
  client_id             UUID REFERENCES clients(id) ON DELETE SET NULL,
  project_type          VARCHAR(50),
  estimated_value       DECIMAL(12,2),
  status                VARCHAR(50) NOT NULL DEFAULT 'new',
  assigned_to           UUID,
  assigned_at           TIMESTAMPTZ DEFAULT NOW(),
  contacted_at          TIMESTAMPTZ,
  estimate_scheduled_at TIMESTAMPTZ,
  estimate_delivery_date DATE,
  closed_at             TIMESTAMPTZ,
  lost_reason           VARCHAR(255),
  close_notes           TEXT,
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leads_status_valid CHECK (status IN ('new', 'contacted', 'estimate_scheduled', 'estimate_delivered', 'negotiating', 'won', 'lost'))
);

CREATE INDEX IF NOT EXISTS idx_leads_org_id ON leads(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(org_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(org_id, lead_source);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_select" ON leads FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "leads_insert" ON leads FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "leads_update" ON leads FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "leads_delete" ON leads FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 2. GC Activity Log — Activity tracking for GC relationships
-- NOTE: gc_contacts table already exists from migration 013
CREATE TABLE IF NOT EXISTS gc_activity_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gc_contact_id   UUID NOT NULL REFERENCES gc_contacts(id) ON DELETE CASCADE,
  activity_type   VARCHAR(50) NOT NULL,
  activity_date   TIMESTAMPTZ DEFAULT NOW(),
  description     TEXT,
  logged_by       UUID,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gc_activity_type_valid CHECK (activity_type IN ('call', 'email', 'in_person', 'proposal_sent', 'follow_up', 'project_closed'))
);

CREATE INDEX IF NOT EXISTS idx_gc_activity_log_org ON gc_activity_log(org_id);
CREATE INDEX IF NOT EXISTS idx_gc_activity_log_gc ON gc_activity_log(gc_contact_id);

ALTER TABLE gc_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gcal_select" ON gc_activity_log FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "gcal_insert" ON gc_activity_log FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "gcal_update" ON gc_activity_log FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "gcal_delete" ON gc_activity_log FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 3. Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  campaign_type   VARCHAR(50) NOT NULL DEFAULT 'other',
  start_date      DATE NOT NULL,
  end_date        DATE,
  budget          DECIMAL(12,2),
  status          VARCHAR(20) DEFAULT 'planning',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT campaign_type_valid CHECK (campaign_type IN ('social_media', 'email_blast', 'referral_program', 'trade_show', 'in_person_event', 'retargeting', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_campaigns_org ON campaigns(org_id);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "camp_select" ON campaigns FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "camp_insert" ON campaigns FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "camp_update" ON campaigns FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "camp_delete" ON campaigns FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 4. Campaign Leads — Attribution junction table
CREATE TABLE IF NOT EXISTS campaign_leads (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id       UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id           UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  attributed_at     TIMESTAMPTZ DEFAULT NOW(),
  revenue_from_lead DECIMAL(12,2),
  UNIQUE(campaign_id, lead_id)
);

ALTER TABLE campaign_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cl_select" ON campaign_leads FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "cl_insert" ON campaign_leads FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "cl_update" ON campaign_leads FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "cl_delete" ON campaign_leads FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 5. Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform        VARCHAR(50) NOT NULL,
  review_id       VARCHAR(255),
  reviewer_name   VARCHAR(255),
  rating          INTEGER NOT NULL,
  title           VARCHAR(255),
  body            TEXT,
  review_date     TIMESTAMPTZ NOT NULL,
  sentiment       VARCHAR(20),
  themes          JSONB DEFAULT '{}',
  response_needed BOOLEAN DEFAULT FALSE,
  escalated       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT review_rating_valid CHECK (rating >= 1 AND rating <= 5)
);

CREATE INDEX IF NOT EXISTS idx_reviews_org ON reviews(org_id);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rev_select" ON reviews FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "rev_insert" ON reviews FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "rev_update" ON reviews FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "rev_delete" ON reviews FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 6. Review Responses
CREATE TABLE IF NOT EXISTS review_responses (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id           UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  draft_response      TEXT,
  published_response  TEXT,
  drafted_by          UUID,
  approved_by         UUID,
  published_at        TIMESTAMPTZ,
  status              VARCHAR(20) DEFAULT 'draft',
  CONSTRAINT rr_status_valid CHECK (status IN ('draft', 'approved', 'published'))
);

ALTER TABLE review_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rr_select" ON review_responses FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "rr_insert" ON review_responses FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "rr_update" ON review_responses FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "rr_delete" ON review_responses FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- CHRONO TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- NOTE: calendar_events table already exists from migration 011
-- NOTE: crew_members table already exists from migration 002

-- 7. Crew Availability
CREATE TABLE IF NOT EXISTS crew_availability (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL,
  availability_date   DATE NOT NULL,
  availability_status VARCHAR(20) NOT NULL,
  hours_available     DECIMAL(4,2),
  skills              JSONB DEFAULT '[]',
  certifications      JSONB DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crew_avail_status_valid CHECK (availability_status IN ('available', 'unavailable', 'vacation', 'sick', 'pto', 'training')),
  UNIQUE(org_id, employee_id, availability_date)
);

CREATE INDEX IF NOT EXISTS idx_crew_avail_org ON crew_availability(org_id);
CREATE INDEX IF NOT EXISTS idx_crew_avail_date ON crew_availability(org_id, availability_date);

ALTER TABLE crew_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ca_select" ON crew_availability FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "ca_insert" ON crew_availability FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "ca_update" ON crew_availability FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "ca_delete" ON crew_availability FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 8. Job Schedules
CREATE TABLE IF NOT EXISTS job_schedules (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  calendar_event_id   UUID NOT NULL,
  employee_id         UUID NOT NULL,
  lead_role           VARCHAR(50) NOT NULL,
  job_status          VARCHAR(20) DEFAULT 'scheduled',
  estimated_hours     DECIMAL(5,2),
  travel_time_to_job  INTEGER,
  travel_distance     DECIMAL(8,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT js_role_valid CHECK (lead_role IN ('lead_tech', 'tech_2', 'helper', 'supervisor')),
  CONSTRAINT js_status_valid CHECK (job_status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'no_show', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_job_schedules_org ON job_schedules(org_id);
CREATE INDEX IF NOT EXISTS idx_job_schedules_event ON job_schedules(calendar_event_id);

ALTER TABLE job_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "js_select" ON job_schedules FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "js_insert" ON job_schedules FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "js_update" ON job_schedules FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "js_delete" ON job_schedules FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 9. Agenda Tasks
CREATE TABLE IF NOT EXISTS agenda_tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title       VARCHAR(255) NOT NULL,
  task_type   VARCHAR(50) NOT NULL DEFAULT 'follow_up',
  assigned_to UUID,
  due_date    DATE NOT NULL,
  status      VARCHAR(20) DEFAULT 'pending',
  priority    VARCHAR(20) DEFAULT 'medium',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT at_type_valid CHECK (task_type IN ('standup', 'follow_up', 'reminder', 'deadline', 'escalation')),
  CONSTRAINT at_status_valid CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_agenda_tasks_org ON agenda_tasks(org_id);
CREATE INDEX IF NOT EXISTS idx_agenda_tasks_due ON agenda_tasks(org_id, due_date);

ALTER TABLE agenda_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "at_select" ON agenda_tasks FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "at_insert" ON agenda_tasks FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "at_update" ON agenda_tasks FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "at_delete" ON agenda_tasks FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 10. Travel Times — Cached travel estimates between locations
CREATE TABLE IF NOT EXISTS travel_times (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id                   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_location            VARCHAR(255) NOT NULL,
  to_location              VARCHAR(255) NOT NULL,
  distance_miles           DECIMAL(8,2),
  duration_minutes_normal  INTEGER,
  duration_minutes_peak    INTEGER,
  last_updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, from_location, to_location)
);

ALTER TABLE travel_times ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tt_select" ON travel_times FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "tt_insert" ON travel_times FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "tt_update" ON travel_times FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "tt_delete" ON travel_times FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
