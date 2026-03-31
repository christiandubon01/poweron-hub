-- 038_guardian.sql
-- GUARDIAN agent: crew field logs + crew members tables
-- Additive only — no existing tables modified

-- ── Crew Field Logs ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_field_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id)
    ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  -- owner_id = the owner who invited this crew
  crew_name TEXT NOT NULL,
  job_reference TEXT,
  work_description TEXT NOT NULL,
  hours_logged DECIMAL(4,2),
  materials_used JSONB DEFAULT '[]',
  -- array of {name, quantity, unit}
  photos JSONB DEFAULT '[]',
  -- array of storage URLs
  flags JSONB DEFAULT '[]',
  -- array of {type, message, severity}
  reviewed_by_owner BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Crew Members ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crew_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  -- null until crew member creates account
  name TEXT NOT NULL,
  role TEXT DEFAULT 'crew',
  -- 'crew' or 'lead'
  phone TEXT,
  email TEXT,
  invite_token TEXT UNIQUE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_crew_logs_owner
  ON crew_field_logs(owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_crew_logs_reviewed
  ON crew_field_logs(owner_id, reviewed_by_owner, created_at DESC);

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE crew_field_logs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE crew_members
  ENABLE ROW LEVEL SECURITY;

-- Owner sees all their crew logs
CREATE POLICY "Owner sees crew logs"
  ON crew_field_logs FOR ALL
  USING (owner_id = auth.uid());

-- Crew sees only their own logs
CREATE POLICY "Crew sees own logs"
  ON crew_field_logs FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Crew inserts own logs"
  ON crew_field_logs FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Owner manages crew members
CREATE POLICY "Owner manages crew"
  ON crew_members FOR ALL
  USING (owner_id = auth.uid());
