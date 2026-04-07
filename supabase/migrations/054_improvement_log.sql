-- Migration: 054_improvement_log
-- Purpose: Create improvement_log table for Tab 5 of Admin Command Center
-- Note: Run this migration manually in the Supabase SQL editor for project edxxbtyugohtowvslbfo

CREATE TABLE IF NOT EXISTS improvement_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'Bug',
  priority        TEXT NOT NULL DEFAULT 'Med',
  notes           TEXT,
  estimated_hours NUMERIC DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
  admin_added     BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for common filter queries
CREATE INDEX IF NOT EXISTS improvement_log_created_at_idx ON improvement_log (created_at DESC);
CREATE INDEX IF NOT EXISTS improvement_log_category_idx   ON improvement_log (category);
CREATE INDEX IF NOT EXISTS improvement_log_priority_idx   ON improvement_log (priority);
CREATE INDEX IF NOT EXISTS improvement_log_source_idx     ON improvement_log (source);

-- Enable Row Level Security (admin-only via service role for now)
ALTER TABLE improvement_log ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read and insert (admin gate is handled at app level)
CREATE POLICY "improvement_log_select" ON improvement_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "improvement_log_insert" ON improvement_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "improvement_log_update" ON improvement_log
  FOR UPDATE TO authenticated USING (true);
