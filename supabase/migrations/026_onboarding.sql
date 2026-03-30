-- ============================================================================
-- Migration 026: Onboarding — Adds onboarding_completed flag to profiles
-- and an onboarding_progress table for tracking step completion.
-- ============================================================================

-- Add onboarding flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Onboarding progress — tracks which steps each user has completed
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Step completion flags
  step_welcome    BOOLEAN NOT NULL DEFAULT false,
  step_profile    BOOLEAN NOT NULL DEFAULT false,
  step_company    BOOLEAN NOT NULL DEFAULT false,
  step_first_project BOOLEAN NOT NULL DEFAULT false,
  step_meet_agents   BOOLEAN NOT NULL DEFAULT false,

  -- Metadata
  current_step    INT NOT NULL DEFAULT 0,
  completed_at    TIMESTAMPTZ,
  skipped         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_user ON onboarding_progress(user_id);

-- RLS
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY onboarding_select ON onboarding_progress FOR SELECT USING (
  user_id = auth.uid()
);
CREATE POLICY onboarding_insert ON onboarding_progress FOR INSERT WITH CHECK (
  user_id = auth.uid()
);
CREATE POLICY onboarding_update ON onboarding_progress FOR UPDATE USING (
  user_id = auth.uid()
);

-- Auto-update timestamp
CREATE TRIGGER mdt_onboarding_progress
  BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
