-- Migration 036: Activity Log
-- Plain English audit trail queryable from NEXUS by voice or text.
-- Additive only — no existing tables modified.

CREATE TABLE IF NOT EXISTS activity_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name   TEXT        NOT NULL,
  action_type  TEXT        NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_label TEXT,
  summary      TEXT        NOT NULL,
  details      JSONB       DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_user_created
  ON activity_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_agent
  ON activity_log(user_id, agent_name, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own activity"
  ON activity_log FOR ALL
  USING (auth.uid() = user_id);
