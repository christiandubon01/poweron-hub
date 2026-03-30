-- Migration 030: Create snapshots table for PowerOn Hub V2 snapshot system
-- Rolling point-in-time saves of app state, user-browsable, preview-before-restore

CREATE TABLE IF NOT EXISTS snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  snapshot_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_pinned BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_snapshots_user_created ON snapshots(user_id, created_at DESC);

ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own snapshots" ON snapshots
  FOR ALL USING (auth.uid() = user_id);
