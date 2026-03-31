-- Migration 037: Voice Journal
-- Adds voice_journal table for raw thought capture from job site, driving, office, or general contexts.
-- Additive only — no existing tables modified.

CREATE TABLE IF NOT EXISTS voice_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id)
    ON DELETE CASCADE,
  raw_transcript TEXT NOT NULL,
  context_tag TEXT DEFAULT 'general',
  -- context_tag values: 'job_site', 'driving', 'office', 'general'
  job_reference TEXT,
  -- optional free-text job name or ID
  action_items JSONB DEFAULT '[]',
  -- extracted action items array
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_user_created
  ON voice_journal(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_context
  ON voice_journal(user_id, context_tag, created_at DESC);

ALTER TABLE voice_journal
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own journal"
  ON voice_journal FOR ALL
  USING (auth.uid() = user_id);
