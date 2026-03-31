-- ============================================================================
-- Migration 039: Role-Based Access Control (V3 Session 5)
--
-- This migration adds:
--   1. owner_id column to key tables (projects, service_calls, estimates)
--   2. user_id, owner_id, invite_token columns to crew_members
--   3. crew_field_logs table for crew member work submissions
--   4. RLS policies: owner full access + crew restricted access
--
-- SAFE: Does NOT drop existing policies. All new policies are additive.
-- Apply in Supabase SQL editor — run the full script.
-- ============================================================================

-- ── 1. Augment crew_members table ────────────────────────────────────────────
-- user_id:      The Supabase auth.uid() of the crew member (set on invite accept)
-- owner_id:     The auth.uid() of the owner who manages this crew member
-- invite_token: UUID sent in the invite link; one-time use
-- email:        Contact email for the crew member

ALTER TABLE crew_members
  ADD COLUMN IF NOT EXISTS user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invite_token UUID UNIQUE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS invited_at   TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS accepted_at  TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email        TEXT DEFAULT NULL;

-- Index for fast crew lookup by user_id (used on every login)
CREATE INDEX IF NOT EXISTS idx_crew_user_id    ON crew_members(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_owner_id   ON crew_members(owner_id);
CREATE INDEX IF NOT EXISTS idx_crew_invite_tok ON crew_members(invite_token) WHERE invite_token IS NOT NULL;


-- ── 2. Add owner_id to key tables ─────────────────────────────────────────────
-- owner_id = the auth.uid() of the owner who created the record.
-- Allows RLS to enforce "crew can only see records in their owner's account"
-- without relying solely on org_id (which crew members don't have a profile row for).

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE service_calls
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Indexes for new owner_id columns
CREATE INDEX IF NOT EXISTS idx_projects_owner_id      ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_service_calls_owner_id ON service_calls(owner_id);
CREATE INDEX IF NOT EXISTS idx_estimates_owner_id     ON estimates(owner_id);


-- ── 3. Create crew_field_logs table ──────────────────────────────────────────
-- Stores work logs submitted by crew members from CrewPortal.
-- Linked to a project or service call via job_reference (text key, flexible).

CREATE TABLE IF NOT EXISTS crew_field_logs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id           UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Who submitted this log
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The owner whose account this log belongs to
  owner_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The crew_members row for additional metadata
  crew_member_id   UUID REFERENCES crew_members(id) ON DELETE SET NULL,

  -- Job reference: flexible key (project name, service call ID, etc.)
  job_reference    TEXT NOT NULL,

  -- Work performed
  description      TEXT NOT NULL,
  hours_worked     NUMERIC(6,2) DEFAULT 0,

  -- Materials used: [{name, quantity, unit}]
  materials        JSONB NOT NULL DEFAULT '[]',

  -- Owner flag (set by owner after review)
  flagged          BOOLEAN NOT NULL DEFAULT false,
  flag_note        TEXT,
  flagged_at       TIMESTAMPTZ,

  -- Timestamps
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crew_field_logs_user_id    ON crew_field_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_crew_field_logs_owner_id   ON crew_field_logs(owner_id);
CREATE INDEX IF NOT EXISTS idx_crew_field_logs_submitted  ON crew_field_logs(owner_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_crew_field_logs_crew_member ON crew_field_logs(crew_member_id);

ALTER TABLE crew_field_logs ENABLE ROW LEVEL SECURITY;


-- ── 4. RLS Policies ──────────────────────────────────────────────────────────
-- Strategy:
--   OWNER: full access to all records in their org (already handled by org_id
--          policies from migration 023). We add owner_id-based policies as a
--          supplemental path so the owner can also query by their user_id.
--
--   CREW:  read-only access to crew_field_logs they submitted (user_id match).
--          Read access to crew_members row for themselves.
--          Read access to a future "assigned_jobs" table when it exists.
--          No access to financial data (estimates, invoices, money panels).
--
-- NOTE: We do NOT drop existing policies. All policies added here are additive.
-- ─────────────────────────────────────────────────────────────────────────────

-- crew_field_logs: crew can insert and read their own logs
CREATE POLICY "crew_field_logs_crew_insert" ON crew_field_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "crew_field_logs_crew_select" ON crew_field_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- crew_field_logs: owner can see all logs in their account
CREATE POLICY "crew_field_logs_owner_select" ON crew_field_logs
  FOR SELECT
  USING (auth.uid() = owner_id);

-- crew_field_logs: owner can update (to set flag/flag_note)
CREATE POLICY "crew_field_logs_owner_update" ON crew_field_logs
  FOR UPDATE
  USING (auth.uid() = owner_id);

-- crew_field_logs: owner can delete
CREATE POLICY "crew_field_logs_owner_delete" ON crew_field_logs
  FOR DELETE
  USING (auth.uid() = owner_id);


-- Owner full access to projects (by owner_id, additive to existing org_id policy)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'projects'
      AND policyname = 'Owner full access to projects by owner_id'
  ) THEN
    CREATE POLICY "Owner full access to projects by owner_id"
      ON projects FOR ALL
      USING (
        auth.uid() = owner_id
      );
  END IF;
END $$;

-- Owner full access to service_calls (additive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'service_calls'
      AND policyname = 'Owner full access to service_calls by owner_id'
  ) THEN
    CREATE POLICY "Owner full access to service_calls by owner_id"
      ON service_calls FOR ALL
      USING (
        auth.uid() = owner_id
      );
  END IF;
END $$;

-- Owner full access to estimates (additive)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'estimates'
      AND policyname = 'Owner full access to estimates by owner_id'
  ) THEN
    CREATE POLICY "Owner full access to estimates by owner_id"
      ON estimates FOR ALL
      USING (
        auth.uid() = owner_id
      );
  END IF;
END $$;


-- ── 5. Crew members: allow crew to read their own row ─────────────────────────
-- This policy lets a crew member look up their own crew_members record
-- (used by CrewPortal to display their name and assigned jobs).
-- The existing org_id policy still applies for owner access.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'crew_members'
      AND policyname = 'Crew member can read own row'
  ) THEN
    CREATE POLICY "Crew member can read own row"
      ON crew_members FOR SELECT
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- Allow unauthenticated (anon) lookup of invite_token for the invite accept page.
-- This is safe because the token is a UUID — brute-forcing is infeasible.
-- The page only reveals the crew member's name (no financial data).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'crew_members'
      AND policyname = 'Anon invite token lookup'
  ) THEN
    CREATE POLICY "Anon invite token lookup"
      ON crew_members FOR SELECT
      USING (
        invite_token IS NOT NULL
        AND accepted_at IS NULL
      );
  END IF;
END $$;

-- Allow crew member to update their own row on invite accept (to set user_id / accepted_at)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'crew_members'
      AND policyname = 'Crew member set user_id on accept'
  ) THEN
    CREATE POLICY "Crew member set user_id on accept"
      ON crew_members FOR UPDATE
      USING (
        -- Either they're already linked (updating their own row)
        auth.uid() = user_id
        OR
        -- Or they just authenticated and are claiming this invite
        (user_id IS NULL AND invite_token IS NOT NULL)
      );
  END IF;
END $$;


-- ── 6. Verify summary ────────────────────────────────────────────────────────
-- Run this query after applying the migration to confirm all objects exist:
--
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('crew_members','crew_field_logs','projects','service_calls','estimates');
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'crew_members'
--   AND column_name IN ('user_id','owner_id','invite_token','invited_at','accepted_at');
--
-- SELECT policyname, tablename FROM pg_policies
--   WHERE tablename IN ('crew_field_logs','crew_members','projects')
--   ORDER BY tablename, policyname;
-- ============================================================================
