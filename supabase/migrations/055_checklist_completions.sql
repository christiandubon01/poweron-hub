-- Migration: 055_checklist_completions
-- Purpose: Create checklist_completions table for Tab 6 of Admin Command Center
-- Permanent historical record from April 6 2026 onward — completed items never deleted
-- Note: Run this migration manually in the Supabase SQL editor for project edxxbtyugohtowvslbfo

CREATE TABLE IF NOT EXISTS checklist_completions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT 'General',
  notes        TEXT,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  week_label   TEXT,
  month_label  TEXT
);

-- Indexes for date-range filtering and category queries
CREATE INDEX IF NOT EXISTS checklist_completions_completed_at_idx ON checklist_completions (completed_at DESC);
CREATE INDEX IF NOT EXISTS checklist_completions_category_idx     ON checklist_completions (category);
CREATE INDEX IF NOT EXISTS checklist_completions_week_label_idx   ON checklist_completions (week_label);
CREATE INDEX IF NOT EXISTS checklist_completions_month_label_idx  ON checklist_completions (month_label);

-- Enable Row Level Security (admin-only via service role; app-level gate enforces admin-only UI)
ALTER TABLE checklist_completions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read and insert (admin gate handled at app level)
CREATE POLICY "checklist_completions_select" ON checklist_completions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "checklist_completions_insert" ON checklist_completions
  FOR INSERT TO authenticated WITH CHECK (true);
