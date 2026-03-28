-- ============================================================================
-- Migration 023: RLS Security Hardening
-- Enables Row Level Security on all 12 tables that were missing it.
-- ============================================================================

-- ── Standard org_id pattern (10 tables) ───────────────────────────────────────
-- These tables have org_id directly, so the standard RLS pattern applies.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'agent_messages', 'agent_proposals', 'audit_log', 'clients',
      'compliance_checks', 'crew_members', 'memory_embeddings',
      'project_templates', 'trigger_rules', 'user_sessions'
    ])
  LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- SELECT: org members can read their org's rows
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (
        org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
      )',
      tbl || '_org_select', tbl
    );

    -- INSERT: org members can insert into their org
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (
        org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
      )',
      tbl || '_org_insert', tbl
    );

    -- UPDATE: org members can update their org's rows
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (
        org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
      )',
      tbl || '_org_update', tbl
    );

    -- DELETE: org members can delete their org's rows
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE USING (
        org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
      )',
      tbl || '_org_delete', tbl
    );

    RAISE NOTICE 'RLS enabled on %', tbl;
  END LOOP;
END $$;


-- ── agents table (system reference — no org_id) ──────────────────────────────
-- Agents are global system records. All authenticated users can read them.
-- Only service_role can insert/update/delete.

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY agents_authenticated_select ON agents
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY agents_service_insert ON agents
  FOR INSERT WITH CHECK (true);

CREATE POLICY agents_service_update ON agents
  FOR UPDATE USING (true);

CREATE POLICY agents_service_delete ON agents
  FOR DELETE USING (true);


-- ── project_phases table (join through projects for org_id) ──────────────────
-- project_phases belongs to a project. RLS checks the parent project's org_id.

ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_phases_org_select ON project_phases
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM projects p
      WHERE p.org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );

CREATE POLICY project_phases_org_insert ON project_phases
  FOR INSERT WITH CHECK (
    project_id IN (
      SELECT p.id FROM projects p
      WHERE p.org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );

CREATE POLICY project_phases_org_update ON project_phases
  FOR UPDATE USING (
    project_id IN (
      SELECT p.id FROM projects p
      WHERE p.org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );

CREATE POLICY project_phases_org_delete ON project_phases
  FOR DELETE USING (
    project_id IN (
      SELECT p.id FROM projects p
      WHERE p.org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    )
  );
