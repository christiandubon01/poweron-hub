-- Migration 042: Living Skill Intelligence — extend owner_profile table
-- Adds skill map, signals, ideal profile, and development log columns.

ALTER TABLE owner_profile
  ADD COLUMN IF NOT EXISTS skill_map jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS skill_signals jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ideal_profile jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS development_log jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_skill_update timestamptz;

-- Indexes for fast JSONB queries
CREATE INDEX IF NOT EXISTS idx_owner_profile_skill_map
  ON owner_profile USING gin(skill_map);

CREATE INDEX IF NOT EXISTS idx_owner_profile_skill_signals
  ON owner_profile USING gin(skill_signals);

-- Populate ideal_profile default for all existing rows
UPDATE owner_profile
SET ideal_profile = '{
  "field_execution": {
    "target": 90,
    "description": "Executes complex commercial and residential work independently, manages inspections, supervises crew on multi-phase jobs"
  },
  "estimating": {
    "target": 85,
    "description": "Builds accurate estimates for commercial TI, solar, service upgrades. Knows labor rates, material costs, markup strategy"
  },
  "project_management": {
    "target": 80,
    "description": "Runs 3-5 simultaneous projects, manages GC relationships, RFIs, change orders, milestone billing"
  },
  "business_development": {
    "target": 75,
    "description": "Builds referral network, converts 40%+ of estimates, maintains pipeline above $150K, leverages RMO arrangements"
  },
  "financial_literacy": {
    "target": 80,
    "description": "Reads own financials, understands AR aging, cashflow timing, job costing vs estimate, tax obligations"
  },
  "permitting_compliance": {
    "target": 75,
    "description": "Pulls permits independently in 5+ cities, knows NEC code requirements by job type, passes inspections first attempt"
  },
  "crew_management": {
    "target": 70,
    "description": "Hires, onboards, supervises 2-3 field employees, manages labor costs, enforces safety protocols"
  },
  "client_communication": {
    "target": 80,
    "description": "Sets clear scope, communicates delays proactively, handles difficult conversations, earns repeat business"
  },
  "technical_knowledge": {
    "target": 85,
    "description": "Expert in residential and commercial electrical systems, solar interconnection, generator integration, EV charging"
  },
  "systems_thinking": {
    "target": 75,
    "description": "Builds repeatable processes, uses software to leverage capacity, thinks in systems not tasks"
  }
}'::jsonb
WHERE ideal_profile = '{}'::jsonb OR ideal_profile IS NULL;
