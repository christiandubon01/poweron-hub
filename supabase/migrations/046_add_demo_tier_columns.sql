-- Migration: add_demo_tier_columns
-- Session: B7 Demo User Invite Flow
-- Adds demo tier tracking columns to the existing `profiles` table.
-- These columns support the Demo User Invite system: magic link invites,
-- access duration enforcement, and auto-populated project data.

-- ── Add demo tier columns to profiles ─────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS demo_tier         boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS demo_expires_at   timestamptz         DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS demo_projects_limit integer  NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS demo_invited_by   text                DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS demo_invited_at   timestamptz         DEFAULT NULL;

-- ── Index for efficiently querying expired demo users ─────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_demo_tier
  ON public.profiles (demo_tier)
  WHERE demo_tier = true;

CREATE INDEX IF NOT EXISTS idx_profiles_demo_expires_at
  ON public.profiles (demo_expires_at)
  WHERE demo_tier = true;

-- ── Comment the new columns ────────────────────────────────────────────────
COMMENT ON COLUMN public.profiles.demo_tier
  IS 'True if this user is a demo/beta user invited by the owner.';

COMMENT ON COLUMN public.profiles.demo_expires_at
  IS 'Timestamp when this user''s demo access expires. NULL = never expires.';

COMMENT ON COLUMN public.profiles.demo_projects_limit
  IS 'Maximum number of projects this demo user can create (default 3).';

COMMENT ON COLUMN public.profiles.demo_invited_by
  IS 'User ID of the owner who sent this demo invite.';

COMMENT ON COLUMN public.profiles.demo_invited_at
  IS 'Timestamp when the demo invite was sent.';
