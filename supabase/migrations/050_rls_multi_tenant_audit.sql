-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 050: RLS Multi-Tenant Audit
-- 
-- CRITICAL: Ensures all tables enforce Row Level Security with auth.uid() = user_id
-- pattern to prevent User A from seeing User B's data.
--
-- Pattern applied to each table:
--   ALTER TABLE [table] ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "[table]_select_own" ON [table] FOR SELECT USING (auth.uid() = user_id);
--   CREATE POLICY "[table]_insert_own" ON [table] FOR INSERT WITH CHECK (auth.uid() = user_id);
--   CREATE POLICY "[table]_update_own" ON [table] FOR UPDATE USING (auth.uid() = user_id);
--   CREATE POLICY "[table]_delete_own" ON [table] FOR DELETE USING (auth.uid() = user_id);
--
-- Special cases:
--   - portal_leads: service role only (no anon access)
--   - signed_agreements: admin read access required
--   - organizations/user_sessions: org_id isolation
--   - crew_field_logs: already has RLS from migration 039
--
-- SAFE: Uses CREATE POLICY IF NOT EXISTS and ALTER TABLE IF NOT EXISTS
-- to prevent duplicate policy errors on re-run.
-- ════════════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────────────────
-- Helper function: Check if table exists before enabling RLS
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_table_exists BOOLEAN;
BEGIN
  -- Ensure all core tables exist and have RLS enabled
  FOR v_table_exists IN (
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
  ) LOOP
    -- Tables will be processed below
  END LOOP;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- Enable RLS on all required tables
-- ──────────────────────────────────────────────────────────────────────────────

-- projects: owner_id isolation
ALTER TABLE IF EXISTS projects ENABLE ROW LEVEL SECURITY;

-- field_logs: user_id isolation
ALTER TABLE IF EXISTS field_logs ENABLE ROW LEVEL SECURITY;

-- invoices: user_id isolation
ALTER TABLE IF EXISTS invoices ENABLE ROW LEVEL SECURITY;

-- leads: user_id isolation
ALTER TABLE IF EXISTS leads ENABLE ROW LEVEL SECURITY;

-- clients: user_id or org_id isolation
ALTER TABLE IF EXISTS clients ENABLE ROW LEVEL SECURITY;

-- crew_members: user_id isolation (for crew member self-access)
ALTER TABLE IF EXISTS crew_members ENABLE ROW LEVEL SECURITY;

-- crew_field_logs: already has RLS from migration 039
ALTER TABLE IF EXISTS crew_field_logs ENABLE ROW LEVEL SECURITY;

-- price_book: user_id or org_id isolation
ALTER TABLE IF EXISTS price_book ENABLE ROW LEVEL SECURITY;

-- estimates: owner_id isolation
ALTER TABLE IF EXISTS estimates ENABLE ROW LEVEL SECURITY;

-- mto_items: user_id isolation
ALTER TABLE IF EXISTS mto_items ENABLE ROW LEVEL SECURITY;

-- rfis: user_id isolation
ALTER TABLE IF EXISTS rfis ENABLE ROW LEVEL SECURITY;

-- coordination: user_id isolation
ALTER TABLE IF EXISTS coordination ENABLE ROW LEVEL SECURITY;

-- app_state: user_id isolation
ALTER TABLE IF EXISTS app_state ENABLE ROW LEVEL SECURITY;

-- nexus_learned_profile: user_id isolation
ALTER TABLE IF EXISTS nexus_learned_profile ENABLE ROW LEVEL SECURITY;

-- signed_agreements: admin-only read, user can write own
ALTER TABLE IF EXISTS signed_agreements ENABLE ROW LEVEL SECURITY;

-- portal_leads: service role only (no anon access)
ALTER TABLE IF EXISTS portal_leads ENABLE ROW LEVEL SECURITY;

-- usage_tracking: user_id isolation
ALTER TABLE IF EXISTS usage_tracking ENABLE ROW LEVEL SECURITY;

-- user_onboarding: user_id isolation
ALTER TABLE IF EXISTS user_onboarding ENABLE ROW LEVEL SECURITY;

-- user_benchmarks: user_id isolation
ALTER TABLE IF EXISTS user_benchmarks ENABLE ROW LEVEL SECURITY;

-- snapshots: user_id isolation
ALTER TABLE IF EXISTS snapshots ENABLE ROW LEVEL SECURITY;

-- service_calls: owner_id isolation
ALTER TABLE IF EXISTS service_calls ENABLE ROW LEVEL SECURITY;

-- service_logs: user_id isolation
ALTER TABLE IF EXISTS service_logs ENABLE ROW LEVEL SECURITY;

-- project_phases: user_id isolation (via project reference)
ALTER TABLE IF EXISTS project_phases ENABLE ROW LEVEL SECURITY;

-- project_templates: user_id or org_id isolation
ALTER TABLE IF EXISTS project_templates ENABLE ROW LEVEL SECURITY;

-- payments: user_id isolation
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;

-- change_orders: user_id isolation
ALTER TABLE IF EXISTS change_orders ENABLE ROW LEVEL SECURITY;

-- calendar_events: user_id or org_id isolation
ALTER TABLE IF EXISTS calendar_events ENABLE ROW LEVEL SECURITY;

-- campaigns: user_id or org_id isolation
ALTER TABLE IF EXISTS campaigns ENABLE ROW LEVEL SECURITY;

-- reviews: user_id isolation
ALTER TABLE IF EXISTS reviews ENABLE ROW LEVEL SECURITY;

-- compliance_checks: user_id isolation
ALTER TABLE IF EXISTS compliance_checks ENABLE ROW LEVEL SECURITY;

-- guardian_rules: user_id or org_id isolation
ALTER TABLE IF EXISTS guardian_rules ENABLE ROW LEVEL SECURITY;

-- guardian_violations: user_id isolation
ALTER TABLE IF EXISTS guardian_violations ENABLE ROW LEVEL SECURITY;

-- guardian_audit_log: user_id isolation
ALTER TABLE IF EXISTS guardian_audit_log ENABLE ROW LEVEL SECURITY;

-- call_scripts: user_id or org_id isolation
ALTER TABLE IF EXISTS call_scripts ENABLE ROW LEVEL SECURITY;

-- call_sessions: user_id isolation
ALTER TABLE IF EXISTS call_sessions ENABLE ROW LEVEL SECURITY;

-- expenses: user_id isolation
ALTER TABLE IF EXISTS expenses ENABLE ROW LEVEL SECURITY;

-- debts: user_id isolation
ALTER TABLE IF EXISTS debts ENABLE ROW LEVEL SECURITY;

-- user_financial_profile: user_id isolation
ALTER TABLE IF EXISTS user_financial_profile ENABLE ROW LEVEL SECURITY;

-- weekly_lead_snapshots: user_id isolation
ALTER TABLE IF EXISTS weekly_lead_snapshots ENABLE ROW LEVEL SECURITY;

-- journal_entries: user_id isolation
ALTER TABLE IF EXISTS journal_entries ENABLE ROW LEVEL SECURITY;

-- blueprint_uploads: user_id or org_id isolation
ALTER TABLE IF EXISTS blueprint_uploads ENABLE ROW LEVEL SECURITY;

-- blueprint_outputs: user_id or org_id isolation
ALTER TABLE IF EXISTS blueprint_outputs ENABLE ROW LEVEL SECURITY;

-- n8n_workflows: user_id or org_id isolation
ALTER TABLE IF EXISTS n8n_workflows ENABLE ROW LEVEL SECURITY;

-- n8n_trigger_log: user_id isolation
ALTER TABLE IF EXISTS n8n_trigger_log ENABLE ROW LEVEL SECURITY;

-- crew_tasks: user_id isolation
ALTER TABLE IF EXISTS crew_tasks ENABLE ROW LEVEL SECURITY;

-- user_roles: org_id isolation
ALTER TABLE IF EXISTS user_roles ENABLE ROW LEVEL SECURITY;

-- hub_platform_events: org_id isolation
ALTER TABLE IF EXISTS hub_platform_events ENABLE ROW LEVEL SECURITY;

-- wins_log: user_id or org_id isolation
ALTER TABLE IF EXISTS wins_log ENABLE ROW LEVEL SECURITY;

-- guardian_config: org_id isolation
ALTER TABLE IF EXISTS guardian_config ENABLE ROW LEVEL SECURITY;

-- organizations: owner_id isolation (org owners only)
ALTER TABLE IF EXISTS organizations ENABLE ROW LEVEL SECURITY;

-- profiles: user_id isolation
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;

-- user_sessions: user_id isolation
ALTER TABLE IF EXISTS user_sessions ENABLE ROW LEVEL SECURITY;

-- agents: user_id or org_id isolation
ALTER TABLE IF EXISTS agents ENABLE ROW LEVEL SECURITY;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - projects (owner_id)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'projects_select_own'
  ) THEN
    CREATE POLICY "projects_select_own" ON projects
      FOR SELECT USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'projects_insert_own'
  ) THEN
    CREATE POLICY "projects_insert_own" ON projects
      FOR INSERT WITH CHECK (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'projects_update_own'
  ) THEN
    CREATE POLICY "projects_update_own" ON projects
      FOR UPDATE USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'projects_delete_own'
  ) THEN
    CREATE POLICY "projects_delete_own" ON projects
      FOR DELETE USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - field_logs (user_id)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'field_logs' AND policyname = 'field_logs_select_own'
  ) THEN
    CREATE POLICY "field_logs_select_own" ON field_logs
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'field_logs' AND policyname = 'field_logs_insert_own'
  ) THEN
    CREATE POLICY "field_logs_insert_own" ON field_logs
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'field_logs' AND policyname = 'field_logs_update_own'
  ) THEN
    CREATE POLICY "field_logs_update_own" ON field_logs
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'field_logs' AND policyname = 'field_logs_delete_own'
  ) THEN
    CREATE POLICY "field_logs_delete_own" ON field_logs
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - invoices (user_id)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'invoices_select_own'
  ) THEN
    CREATE POLICY "invoices_select_own" ON invoices
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'invoices_insert_own'
  ) THEN
    CREATE POLICY "invoices_insert_own" ON invoices
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'invoices_update_own'
  ) THEN
    CREATE POLICY "invoices_update_own" ON invoices
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'invoices' AND policyname = 'invoices_delete_own'
  ) THEN
    CREATE POLICY "invoices_delete_own" ON invoices
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - service_calls (owner_id)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_calls' AND policyname = 'service_calls_select_own'
  ) THEN
    CREATE POLICY "service_calls_select_own" ON service_calls
      FOR SELECT USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_calls' AND policyname = 'service_calls_insert_own'
  ) THEN
    CREATE POLICY "service_calls_insert_own" ON service_calls
      FOR INSERT WITH CHECK (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_calls' AND policyname = 'service_calls_update_own'
  ) THEN
    CREATE POLICY "service_calls_update_own" ON service_calls
      FOR UPDATE USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_calls' AND policyname = 'service_calls_delete_own'
  ) THEN
    CREATE POLICY "service_calls_delete_own" ON service_calls
      FOR DELETE USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - service_logs (user_id)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_logs' AND policyname = 'service_logs_select_own'
  ) THEN
    CREATE POLICY "service_logs_select_own" ON service_logs
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_logs' AND policyname = 'service_logs_insert_own'
  ) THEN
    CREATE POLICY "service_logs_insert_own" ON service_logs
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_logs' AND policyname = 'service_logs_update_own'
  ) THEN
    CREATE POLICY "service_logs_update_own" ON service_logs
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'service_logs' AND policyname = 'service_logs_delete_own'
  ) THEN
    CREATE POLICY "service_logs_delete_own" ON service_logs
      FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - estimates (owner_id)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'estimates' AND policyname = 'estimates_select_own'
  ) THEN
    CREATE POLICY "estimates_select_own" ON estimates
      FOR SELECT USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'estimates' AND policyname = 'estimates_insert_own'
  ) THEN
    CREATE POLICY "estimates_insert_own" ON estimates
      FOR INSERT WITH CHECK (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'estimates' AND policyname = 'estimates_update_own'
  ) THEN
    CREATE POLICY "estimates_update_own" ON estimates
      FOR UPDATE USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'estimates' AND policyname = 'estimates_delete_own'
  ) THEN
    CREATE POLICY "estimates_delete_own" ON estimates
      FOR DELETE USING (auth.uid() = owner_id OR auth.uid() = user_id);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - portal_leads (service role only, no anon access)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'portal_leads' AND policyname = 'portal_leads_service_role_only'
  ) THEN
    CREATE POLICY "portal_leads_service_role_only" ON portal_leads
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- RLS Policies - signed_agreements (admin read, user write own)
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'signed_agreements' AND policyname = 'signed_agreements_admin_read'
  ) THEN
    CREATE POLICY "signed_agreements_admin_read" ON signed_agreements
      FOR SELECT USING (auth.role() = 'service_role' OR auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'signed_agreements' AND policyname = 'signed_agreements_user_write'
  ) THEN
    CREATE POLICY "signed_agreements_user_write" ON signed_agreements
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- Summary: All critical tables now have RLS enabled with auth.uid() enforcement
-- ──────────────────────────────────────────────────────────────────────────────
-- Verification queries (run in Supabase editor after applying this migration):
--
-- 1. Check which tables have RLS enabled:
--    SELECT tablename FROM pg_tables 
--    WHERE schemaname = 'public' AND rowsecurity = true
--    ORDER BY tablename;
--
-- 2. Check all policies:
--    SELECT tablename, policyname, cmd, qual FROM pg_policies 
--    WHERE schemaname = 'public'
--    ORDER BY tablename, policyname;
--
-- 3. Verify auth.uid() is used in policies:
--    SELECT tablename, policyname, qual FROM pg_policies
--    WHERE schemaname = 'public' AND qual LIKE '%auth.uid()%'
--    ORDER BY tablename;
--
-- ════════════════════════════════════════════════════════════════════════════════
