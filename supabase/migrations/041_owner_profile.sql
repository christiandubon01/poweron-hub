-- Migration 041: Business Owner Profile
-- Stores strategic context for the business owner so NEXUS can give
-- personalized strategic advice beyond operational data analysis.

CREATE TABLE IF NOT EXISTS owner_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  skill_inventory jsonb DEFAULT '[]',
  knowledge_gaps jsonb DEFAULT '[]',
  active_city_licenses jsonb DEFAULT '[]',
  open_permits jsonb DEFAULT '[]',
  business_goals jsonb DEFAULT '[]',
  bandwidth_notes text,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE owner_profile ENABLE ROW LEVEL SECURITY;

-- RLS: only the org that owns the profile can read/write it
CREATE POLICY "owner_profile_org_access" ON owner_profile
  USING (org_id::text = current_setting('request.jwt.claims', true)::json->>'org_id');
