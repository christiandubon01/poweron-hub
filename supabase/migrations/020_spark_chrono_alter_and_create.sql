-- 020_spark_chrono_alter_and_create.sql
-- Adds missing columns to existing tables (leads, campaigns, reviews)
-- Creates 7 missing tables for SPARK + CHRONO agents
-- Updates calendar_events with any missing columns

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. ALTER leads — add columns our SPARK agent needs
--    Existing cols: id, org_id, client_id, name, phone, email, address, source,
--                   status, service_needed, urgency, estimated_value,
--                   first_contact_at, follow_up_count, last_follow_up,
--                   conversion_date, lost_reason, notes, created_at, updated_at
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_source VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source_detail TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS gc_contact_id UUID;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_type VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimate_scheduled_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimate_delivery_date DATE;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS close_notes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Backfill lead_source from existing source column
UPDATE leads SET lead_source = source WHERE lead_source IS NULL AND source IS NOT NULL;
UPDATE leads SET lead_source = 'direct' WHERE lead_source IS NULL;

-- Backfill contacted_at from first_contact_at
UPDATE leads SET contacted_at = first_contact_at WHERE contacted_at IS NULL AND first_contact_at IS NOT NULL;

-- Backfill closed_at from conversion_date
UPDATE leads SET closed_at = conversion_date WHERE closed_at IS NULL AND conversion_date IS NOT NULL;

-- Backfill close_notes from notes
UPDATE leads SET close_notes = notes WHERE close_notes IS NULL AND notes IS NOT NULL;

-- Drop old status constraint if it exists, then add new one that includes all states
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_valid;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
-- Allow all status values (old + new)
ALTER TABLE leads ADD CONSTRAINT leads_status_valid CHECK (
  status IN ('new', 'contacted', 'estimate_scheduled', 'estimate_delivered',
             'negotiating', 'won', 'lost', 'open', 'qualified', 'converted', 'closed')
);

CREATE INDEX IF NOT EXISTS idx_leads_org_status ON leads(org_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_org_source ON leads(org_id, lead_source);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. ALTER campaigns — add columns our SPARK agent needs
--    Existing cols: id, org_id, name, type, status, channel, content, audience,
--                   scheduled_at, sent_at, recipients, opens, clicks,
--                   conversions, revenue_attributed, created_by, created_at, updated_at
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(50);
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS budget DECIMAL(12,2);

-- Backfill campaign_type from existing type column
UPDATE campaigns SET campaign_type = type WHERE campaign_type IS NULL AND type IS NOT NULL;
UPDATE campaigns SET campaign_type = 'other' WHERE campaign_type IS NULL;

-- Backfill start_date from scheduled_at or created_at
UPDATE campaigns SET start_date = COALESCE(scheduled_at::date, created_at::date) WHERE start_date IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. ALTER reviews — add columns our SPARK agent needs
--    Existing cols: id, org_id, project_id, client_id, platform, rating,
--                   content, author_name, response_status, drafted_response,
--                   final_response, responded_at, external_id, review_date, created_at
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS review_id VARCHAR(255);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS reviewer_name VARCHAR(255);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS sentiment VARCHAR(20);
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS themes JSONB DEFAULT '{}';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS response_needed BOOLEAN DEFAULT FALSE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS escalated BOOLEAN DEFAULT FALSE;

-- Backfill from existing columns
UPDATE reviews SET review_id = external_id WHERE review_id IS NULL AND external_id IS NOT NULL;
UPDATE reviews SET reviewer_name = author_name WHERE reviewer_name IS NULL AND author_name IS NOT NULL;
UPDATE reviews SET body = content WHERE body IS NULL AND content IS NOT NULL;
UPDATE reviews SET response_needed = (response_status = 'pending' OR response_status = 'needed')
  WHERE response_needed IS NULL AND response_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_org ON reviews(org_id);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. ALTER calendar_events — add missing columns for CHRONO
--    Existing cols: id, org_id, project_id, client_id, title, type, status,
--                   start_time, end_time, all_day, assigned_to, location,
--                   travel_time_min, client_reminded, reminder_sent_at,
--                   client_confirmed, google_event_id, google_calendar_id,
--                   sync_status, recurrence, notes, created_by, created_at, updated_at
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(50);
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);

-- Backfill event_type from type column
UPDATE calendar_events SET event_type = type WHERE event_type IS NULL AND type IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. CREATE gc_activity_log (MISSING)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gc_activity_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gc_contact_id   UUID NOT NULL REFERENCES gc_contacts(id) ON DELETE CASCADE,
  activity_type   VARCHAR(50) NOT NULL,
  activity_date   TIMESTAMPTZ DEFAULT NOW(),
  description     TEXT,
  logged_by       UUID,
  lead_id         UUID,
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


-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. CREATE campaign_leads (MISSING)
-- ═══════════════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. CREATE review_responses (MISSING)
-- ═══════════════════════════════════════════════════════════════════════════════

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
-- 8. CREATE crew_availability (MISSING)
-- ═══════════════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- 9. CREATE job_schedules (MISSING)
-- ═══════════════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- 10. CREATE agenda_tasks (MISSING)
-- ═══════════════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- 11. CREATE travel_times (MISSING)
-- ═══════════════════════════════════════════════════════════════════════════════

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


-- ═══════════════════════════════════════════════════════════════════════════════
-- 12. Ensure RLS is enabled on existing tables that may not have it
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for leads if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'leads_select_spark') THEN
    CREATE POLICY "leads_select_spark" ON leads FOR SELECT USING (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'leads_insert_spark') THEN
    CREATE POLICY "leads_insert_spark" ON leads FOR INSERT WITH CHECK (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'leads_update_spark') THEN
    CREATE POLICY "leads_update_spark" ON leads FOR UPDATE USING (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- Create RLS policies for campaigns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'camp_select_spark') THEN
    CREATE POLICY "camp_select_spark" ON campaigns FOR SELECT USING (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'camp_insert_spark') THEN
    CREATE POLICY "camp_insert_spark" ON campaigns FOR INSERT WITH CHECK (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'campaigns' AND policyname = 'camp_update_spark') THEN
    CREATE POLICY "camp_update_spark" ON campaigns FOR UPDATE USING (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;

-- Create RLS policies for reviews if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reviews' AND policyname = 'rev_select_spark') THEN
    CREATE POLICY "rev_select_spark" ON reviews FOR SELECT USING (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reviews' AND policyname = 'rev_insert_spark') THEN
    CREATE POLICY "rev_insert_spark" ON reviews FOR INSERT WITH CHECK (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reviews' AND policyname = 'rev_update_spark') THEN
    CREATE POLICY "rev_update_spark" ON reviews FOR UPDATE USING (
      org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;


-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
