-- ============================================================
-- 068_solar_training_system.sql
-- SOL1 — Solar Training System
-- Tables: training sessions, scenarios, rules, study queue,
--         certifications, and debriefs.
-- RLS: auth.uid() = user_id on all tables.
-- ============================================================

-- ── solar_training_sessions ──────────────────────────────────
CREATE TABLE IF NOT EXISTS solar_training_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  scenario_id       TEXT,
  mode              TEXT,             -- daily_rep | full_consultation | rescue | nabcep_study | field_debrief
  started_at        TIMESTAMPTZ DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  technical_score   INTEGER,
  sales_score       INTEGER,
  gap_score         INTEGER,
  voice_transcript  TEXT,
  lessons_extracted JSONB DEFAULT '[]',
  status            TEXT DEFAULT 'in_progress' -- in_progress | completed | abandoned
);

ALTER TABLE solar_training_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solar_training_sessions_owner" ON solar_training_sessions;
CREATE POLICY "solar_training_sessions_owner"
  ON solar_training_sessions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── solar_scenarios ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar_scenarios (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  category         TEXT,             -- residential | rescue | new_construction | commercial | existing_solar
  customer_type    TEXT,
  utility_territory TEXT,            -- SCE | IID
  system_size_kw   NUMERIC(8,2),
  panel_count      INTEGER,
  battery_included BOOLEAN DEFAULT false,
  objections       JSONB DEFAULT '[]',
  difficulty       TEXT DEFAULT 'medium', -- easy | medium | high | expert
  active           BOOLEAN DEFAULT true
);

ALTER TABLE solar_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solar_scenarios_read_all" ON solar_scenarios;
CREATE POLICY "solar_scenarios_read_all"
  ON solar_scenarios
  FOR SELECT
  USING (true);

-- ── solar_rules ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_text       TEXT NOT NULL,
  source_scenario TEXT,
  date_added      TIMESTAMPTZ DEFAULT now(),
  confirmed       BOOLEAN DEFAULT false
);

ALTER TABLE solar_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solar_rules_owner" ON solar_rules;
CREATE POLICY "solar_rules_owner"
  ON solar_rules
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── solar_study_queue ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar_study_queue (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  topic     TEXT NOT NULL,
  domain    TEXT,   -- System Design | Installation | Commissioning | etc.
  priority  TEXT DEFAULT 'normal', -- high | normal | low
  completed BOOLEAN DEFAULT false,
  notes     TEXT
);

ALTER TABLE solar_study_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solar_study_queue_owner" ON solar_study_queue;
CREATE POLICY "solar_study_queue_owner"
  ON solar_study_queue
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── solar_certifications ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar_certifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  cert_name      TEXT NOT NULL,
  provider       TEXT,
  status         TEXT DEFAULT 'pending', -- pending | in_progress | completed
  progress_pct   INTEGER DEFAULT 0,
  nabcep_ceus    NUMERIC(5,2),
  target_date    DATE,
  completed_date DATE
);

ALTER TABLE solar_certifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solar_certifications_owner" ON solar_certifications;
CREATE POLICY "solar_certifications_owner"
  ON solar_certifications
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── solar_debriefs ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solar_debriefs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type  TEXT,
  customer_type TEXT,
  outcome       TEXT,
  transcript    TEXT,
  lessons       JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE solar_debriefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "solar_debriefs_owner" ON solar_debriefs;
CREATE POLICY "solar_debriefs_owner"
  ON solar_debriefs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SEED DATA — solar_scenarios
-- ============================================================
INSERT INTO solar_scenarios (name, category, customer_type, utility_territory, system_size_kw, panel_count, battery_included, objections, difficulty)
VALUES
  (
    'ADU Dual System Consultation',
    'residential',
    'homeowner_adu',
    'SCE',
    8.5,
    20,
    false,
    '["Two separate systems needed", "Permit complexity for ADU", "NEM 3.0 time-of-use concerns"]',
    'medium'
  ),
  (
    'Renova Orphan Rescue',
    'rescue',
    'orphaned_solar_customer',
    'SCE',
    NULL,
    NULL,
    true,
    '["Angry — paying loan AND full bill", "System not activated", "Wants someone to blame", "Skeptical of new company"]',
    'high'
  ),
  (
    'New Construction Pre-Sale',
    'new_construction',
    'builder_buyer',
    'IID',
    6.44,
    16,
    true,
    '["Builder credit vs. third party", "IID interconnect timeline", "Battery sizing for IID rates"]',
    'medium'
  ),
  (
    'NEM 3.0 Skeptic',
    'residential',
    'research_savvy_homeowner',
    'SCE',
    6.44,
    16,
    true,
    '["NEM 3.0 killed solar ROI", "Seen negative YouTube reviews", "Time-of-use export rates too low", "Battery payback period"]',
    'high'
  ),
  (
    'Price Objection',
    'residential',
    'budget_conscious_homeowner',
    'SCE',
    6.44,
    16,
    false,
    '["Too expensive vs. competitors", "Seen $1.99/watt ads online", "Wants lowest price only", "Not interested in quality diff"]',
    'medium'
  ),
  (
    'Think About It Close',
    'residential',
    'hesitant_homeowner',
    'SCE',
    6.44,
    16,
    false,
    '["Need to talk to spouse", "Want to think about it", "Will call you back", "Not ready to decide today"]',
    'high'
  ),
  (
    'Battery Only Upsell',
    'existing_solar',
    'solar_owner_no_battery',
    'SCE',
    NULL,
    NULL,
    true,
    '["Already have solar — why add battery", "Cost vs. benefit question", "Installation disruption concern", "Will it work with existing inverter"]',
    'medium'
  ),
  (
    'Large Commercial Quote',
    'commercial',
    'small_business_owner',
    'SCE',
    27.6,
    60,
    false,
    '["Roof lease concerns", "Demand charge confusion", "Business interruption during install", "Long payback period", "Need board approval"]',
    'expert'
  )
ON CONFLICT DO NOTHING;

-- Note: solar_certifications seed data is inserted per-user via the app UI
-- (because user_id FK is required). The UI pre-populates on first load
-- when the table is empty for the authenticated user.
