-- ============================================================
-- Migration 017: Trigger Rules
-- Stores automation trigger rules from the Operations Hub v15r.
-- These rules define conditions and actions that fire
-- automatically (e.g., "if material_cost > 500, flag for review").
-- ============================================================

-- --------------------------------------------------------
-- 1. TRIGGER RULES — automation conditions + actions
-- --------------------------------------------------------
CREATE TABLE trigger_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name        TEXT NOT NULL,                   -- human-readable rule name
  description TEXT,                            -- what this rule does

  -- Rule definition
  conditions  JSONB NOT NULL DEFAULT '{}',     -- {field, operator, value, scope}
  actions     JSONB NOT NULL DEFAULT '[]',     -- [{type, target, payload}]

  -- State
  is_active   BOOLEAN NOT NULL DEFAULT true,
  priority    INT DEFAULT 0,                   -- higher = fires first
  fire_count  INT DEFAULT 0,                   -- how many times this rule has fired

  -- Metadata
  legacy_id   TEXT,                            -- original ID from v15r Hub
  metadata    JSONB DEFAULT '{}',              -- extra context from migration
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trigger_rules_org    ON trigger_rules(org_id);
CREATE INDEX idx_trigger_rules_active ON trigger_rules(org_id, is_active);

-- --------------------------------------------------------
-- 2. RLS POLICIES — org_id scoping
-- --------------------------------------------------------
ALTER TABLE trigger_rules ENABLE ROW LEVEL SECURITY;

-- Select: users can read their own org's rules
CREATE POLICY "trigger_rules_select_own_org"
  ON trigger_rules FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Insert: users can create rules for their own org
CREATE POLICY "trigger_rules_insert_own_org"
  ON trigger_rules FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Update: users can update their own org's rules
CREATE POLICY "trigger_rules_update_own_org"
  ON trigger_rules FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Delete: only owners/admins can delete rules
CREATE POLICY "trigger_rules_delete_admin"
  ON trigger_rules FOR DELETE
  USING (
    org_id IN (
      SELECT org_id FROM profiles
      WHERE id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- --------------------------------------------------------
-- 3. AUTO-UPDATE updated_at
-- --------------------------------------------------------
CREATE TRIGGER set_trigger_rules_updated_at
  BEFORE UPDATE ON trigger_rules
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime(updated_at);
