-- NAV1: Agent Intelligence table
-- Tracks per-agent vision completion and AI efficiency scores.
-- Manually maintained by admin; "Run Analysis" button fires Claude API per agent.

CREATE TABLE IF NOT EXISTS agent_intelligence (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name text NOT NULL,
  tier integer NOT NULL,
  vision_completion integer NOT NULL DEFAULT 0,
  ai_efficiency integer NOT NULL DEFAULT 0,
  last_analysis_at timestamptz,
  analysis_notes text,
  is_absorbed boolean DEFAULT false,
  absorbed_into text,
  absorbed_date text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed data: confirmed values as of NAV1 (April 11, 2026)
INSERT INTO agent_intelligence (agent_name, tier, vision_completion, ai_efficiency, is_absorbed, absorbed_into, absorbed_date) VALUES
  -- Tier 1
  ('NEXUS',     1, 90,  78, false, null, null),
  -- Tier 2
  ('SPARK',     2, 90,  75, false, null, null),
  ('HUNTER',    2, 100, 88, false, null, null),
  ('VAULT',     2, 70,  60, false, null, null),
  -- Tier 3
  ('PULSE',     3, 85,  72, false, null, null),
  ('BLUEPRINT', 3, 80,  65, false, null, null),
  ('LEDGER',    3, 80,  68, false, null, null),
  ('CHRONO',    3, 75,  60, false, null, null),
  ('ATLAS',     3, 0,   0,  false, null, null),
  -- Tier 4
  ('OHM',       4, 0,   0,  false, null, null),
  ('ECHO',      4, 80,  70, false, null, null),
  ('SCOUT',     4, 75,  62, false, null, null),
  ('GUARDIAN',  4, 100, 85, false, null, null),
  -- Tier 5
  ('NEGOTIATE', 5, 0,   0,  true,  'SPARK', 'April 9, 2026'),
  ('SENTINEL',  5, 0,   0,  false, null, null)
ON CONFLICT DO NOTHING;

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_agent_intelligence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_intelligence_updated_at ON agent_intelligence;
CREATE TRIGGER trg_agent_intelligence_updated_at
  BEFORE UPDATE ON agent_intelligence
  FOR EACH ROW EXECUTE FUNCTION update_agent_intelligence_updated_at();
