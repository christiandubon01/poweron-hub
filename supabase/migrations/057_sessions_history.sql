-- Migration: 057_sessions_history
-- Purpose: Sessions history for Tab 11 Sessions Queue of Admin Command Center
-- Survives across deploys — never cleared by front-end resets
-- Note: Run this migration manually in the Supabase SQL editor for project edxxbtyugohtowvslbfo

CREATE TABLE IF NOT EXISTS sessions_history (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            TEXT        NOT NULL UNIQUE,   -- e.g. "B21", "B40"
  session_name          TEXT        NOT NULL,
  description           TEXT,
  commit_hash           TEXT,
  deployed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  improvements_projected TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for recent sessions query
CREATE INDEX IF NOT EXISTS sessions_history_deployed_at_idx ON sessions_history (deployed_at DESC);
CREATE INDEX IF NOT EXISTS sessions_history_session_id_idx  ON sessions_history (session_id);

-- RLS
ALTER TABLE sessions_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_history_select" ON sessions_history
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "sessions_history_insert" ON sessions_history
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "sessions_history_update" ON sessions_history
  FOR UPDATE TO authenticated USING (true);
