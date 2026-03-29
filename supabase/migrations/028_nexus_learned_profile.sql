-- Migration: Create nexus_learned_profile table for Layer 3 implicit behavioral patterns
-- Run this in your Supabase SQL editor before deploying this feature.

CREATE TABLE IF NOT EXISTS nexus_learned_profile (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  pattern_type text NOT NULL,
  pattern_key text NOT NULL,
  pattern_value text NOT NULL,
  confidence integer DEFAULT 1,
  last_observed timestamptz DEFAULT now(),
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE nexus_learned_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own profile" ON nexus_learned_profile
  FOR ALL USING (auth.uid() = user_id);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_learned_profile_user
  ON nexus_learned_profile(org_id, user_id, active);

-- Index for pattern deduplication
CREATE INDEX IF NOT EXISTS idx_learned_profile_key
  ON nexus_learned_profile(org_id, user_id, pattern_key);
