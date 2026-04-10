-- Hunter Agent Tables Migration
-- =====================================
-- 6 core tables for HUNTER lead hunting and pipeline intelligence agent

-- 1. hunter_leads: Main lead records with scoring and status
CREATE TABLE IF NOT EXISTS hunter_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  source TEXT NOT NULL COMMENT 'Where the lead came from: facebook, google, referral, web, etc.',
  source_tag TEXT COMMENT 'Tag to group leads by source category',
  lead_type TEXT NOT NULL COMMENT 'residential, commercial, solar, service, gc_sub',
  contact_name TEXT,
  company_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  description TEXT COMMENT 'Lead description from discovery',
  estimated_value NUMERIC(12, 2) COMMENT 'Estimated job/contract value',
  estimated_margin NUMERIC(5, 2) COMMENT 'Estimated profit margin %',
  urgency_level INTEGER CHECK (urgency_level BETWEEN 1 AND 5) COMMENT 'Urgency 1-5 (5=most urgent)',
  urgency_reason TEXT COMMENT 'Why this lead is urgent',
  score INTEGER CHECK (score BETWEEN 0 AND 100) COMMENT 'Overall lead quality score 0-100',
  score_tier TEXT COMMENT 'elite, strong, qualified, expansion, archived',
  score_factors JSONB COMMENT 'Breakdown of scoring factors {factor: value}',
  pitch_script TEXT COMMENT 'Customized pitch for this lead',
  pitch_angle TEXT COMMENT 'urgency, pain, opportunity, competitor_gap, relationship, seasonal, financial',
  comparable_jobs JSONB COMMENT 'Array of past similar job IDs for reference',
  status TEXT NOT NULL DEFAULT 'new' COMMENT 'new, contacted, quoted, won, lost, deferred, archived',
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

CREATE INDEX idx_hunter_leads_user_id ON hunter_leads(user_id);
CREATE INDEX idx_hunter_leads_status ON hunter_leads(status);
CREATE INDEX idx_hunter_leads_score ON hunter_leads(score DESC);
CREATE INDEX idx_hunter_leads_score_tier ON hunter_leads(score_tier);
CREATE INDEX idx_hunter_leads_discovered ON hunter_leads(discovered_at DESC);

-- Enable RLS
ALTER TABLE hunter_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY hunter_leads_user_isolation ON hunter_leads
  FOR ALL USING (auth.uid() = user_id);

-- 2. hunter_scores: Score history and audit trail
CREATE TABLE IF NOT EXISTS hunter_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  score INTEGER CHECK (score BETWEEN 0 AND 100),
  factors JSONB COMMENT 'Scoring breakdown {recency: 10, quality: 20, fit: 25, ...}',
  scored_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_lead FOREIGN KEY (lead_id) REFERENCES hunter_leads(id) ON DELETE CASCADE
);

CREATE INDEX idx_hunter_scores_lead ON hunter_scores(lead_id);
CREATE INDEX idx_hunter_scores_scored_at ON hunter_scores(scored_at DESC);

ALTER TABLE hunter_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY hunter_scores_via_leads ON hunter_scores
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hunter_leads WHERE id = lead_id AND user_id = auth.uid())
  );

-- 3. hunter_rules: Pitch, suppression, urgency, and objection handling rules
CREATE TABLE IF NOT EXISTS hunter_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  rule_type TEXT NOT NULL COMMENT 'pitch, suppression, urgency, objection, source, timing',
  rule_text TEXT NOT NULL COMMENT 'The rule content/pattern',
  source_lead_id UUID COMMENT 'Optional: reference lead this rule was derived from',
  version INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active' COMMENT 'active, archived',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_source_lead FOREIGN KEY (source_lead_id) REFERENCES hunter_leads(id) ON DELETE SET NULL
);

CREATE INDEX idx_hunter_rules_user ON hunter_rules(user_id);
CREATE INDEX idx_hunter_rules_type ON hunter_rules(rule_type);
CREATE INDEX idx_hunter_rules_status ON hunter_rules(status);

ALTER TABLE hunter_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY hunter_rules_user_isolation ON hunter_rules
  FOR ALL USING (auth.uid() = user_id);

-- 4. hunter_debriefs: Outcome analysis and lesson capture
CREATE TABLE IF NOT EXISTS hunter_debriefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  outcome TEXT NOT NULL COMMENT 'won, lost',
  transcript TEXT COMMENT 'Conversation/debrief transcript',
  lessons JSONB COMMENT 'Array of lesson objects {lesson, applied_date}',
  approved_rules JSONB COMMENT 'Rules generated/approved from this debrief',
  debriefed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_lead FOREIGN KEY (lead_id) REFERENCES hunter_leads(id) ON DELETE CASCADE
);

CREATE INDEX idx_hunter_debriefs_lead ON hunter_debriefs(lead_id);
CREATE INDEX idx_hunter_debriefs_outcome ON hunter_debriefs(outcome);
CREATE INDEX idx_hunter_debriefs_debriefed_at ON hunter_debriefs(debriefed_at DESC);

ALTER TABLE hunter_debriefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY hunter_debriefs_via_leads ON hunter_debriefs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hunter_leads WHERE id = lead_id AND user_id = auth.uid())
  );

-- 5. hunter_study_queue: Learning items from debriefs
CREATE TABLE IF NOT EXISTS hunter_study_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  debrief_id UUID NOT NULL,
  topic TEXT NOT NULL COMMENT 'Study topic: objection, pitch_angle, source_quality, timing, etc.',
  status TEXT DEFAULT 'pending' COMMENT 'pending, completed',
  scheduled_for TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_debrief FOREIGN KEY (debrief_id) REFERENCES hunter_debriefs(id) ON DELETE CASCADE
);

CREATE INDEX idx_hunter_study_queue_user ON hunter_study_queue(user_id);
CREATE INDEX idx_hunter_study_queue_status ON hunter_study_queue(status);
CREATE INDEX idx_hunter_study_queue_scheduled ON hunter_study_queue(scheduled_for);

ALTER TABLE hunter_study_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY hunter_study_queue_user_isolation ON hunter_study_queue
  FOR ALL USING (auth.uid() = user_id);

-- 6. hunter_playbooks: Step-by-step action playbooks for each lead
CREATE TABLE IF NOT EXISTS hunter_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  steps JSONB NOT NULL COMMENT 'Array of {text, checked: bool, notes}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_lead FOREIGN KEY (lead_id) REFERENCES hunter_leads(id) ON DELETE CASCADE
);

CREATE INDEX idx_hunter_playbooks_lead ON hunter_playbooks(lead_id);

ALTER TABLE hunter_playbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY hunter_playbooks_via_leads ON hunter_playbooks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM hunter_leads WHERE id = lead_id AND user_id = auth.uid())
  );
