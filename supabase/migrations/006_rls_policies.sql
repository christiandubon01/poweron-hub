-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 006: Row Level Security (RLS) Policies
-- Phase 01 Foundation
--
-- Role matrix:
--   owner   — Full access. Org settings, billing, all data, user management.
--   admin   — Full project/financial access. Cannot manage billing or users.
--   field   — Assigned project read + phase updates + calendar. No financials.
--   viewer  — Read-only on projects and calendar. No financials, no leads.
--
-- Security model:
--   - Every table that contains org data is scoped to auth.user_org_id()
--   - Financial tables (invoices, payments, estimates) require owner OR admin
--   - Audit log is append-only; read access owner+admin only; no delete policy
--   - Agent tables use SECURITY DEFINER functions — agents bypass RLS via
--     service-role key in the backend; RLS here covers direct client access
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- HELPER FUNCTIONS
-- SECURITY DEFINER so they run with elevated privilege (no recursion into RLS)
-- Cached as STABLE so the planner can optimize within a single query
-- ══════════════════════════════════

-- Returns the org_id of the currently authenticated user
CREATE OR REPLACE FUNCTION auth.user_org_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT org_id FROM profiles WHERE id = auth.uid();
$$;

-- Returns the role string of the currently authenticated user
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION auth.user_org_id IS 'Returns org_id for the authenticated user. Used in RLS policies.';
COMMENT ON FUNCTION auth.user_role   IS 'Returns role for the authenticated user. Used in RLS policies.';


-- ══════════════════════════════════
-- ENABLE RLS ON ALL TABLES
-- Must be done before policies are created
-- ══════════════════════════════════
ALTER TABLE organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_phases        ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews               ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_checks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents                ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_proposals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_embeddings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════
-- ORGANIZATIONS
-- Owner can see and update their own org. Admins can read.
-- ══════════════════════════════════
CREATE POLICY "org_read" ON organizations FOR SELECT
  USING (id = auth.user_org_id());

CREATE POLICY "org_update" ON organizations FOR UPDATE
  USING (id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- PROFILES
-- Users see all profiles in their org; can update only their own.
-- Owner/admin can update any profile in their org.
-- ══════════════════════════════════
CREATE POLICY "profiles_read" ON profiles FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "profiles_update_self" ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "profiles_update_admin" ON profiles FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- USER SESSIONS
-- Users see only their own sessions. Owner/admin see all org sessions.
-- ══════════════════════════════════
CREATE POLICY "sessions_read_own" ON user_sessions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "sessions_read_admin" ON user_sessions FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "sessions_insert" ON user_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());


-- ══════════════════════════════════
-- CLIENTS
-- All org members can read. Owner/admin can write.
-- ══════════════════════════════════
CREATE POLICY "clients_read" ON clients FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "clients_write" ON clients FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "clients_update" ON clients FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "clients_delete" ON clients FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- PROJECT TEMPLATES
-- All org members can read. Owner/admin can write.
-- ══════════════════════════════════
CREATE POLICY "templates_read" ON project_templates FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "templates_write" ON project_templates FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- PROJECTS
-- All org members read. Owner/admin write. Field workers cannot modify financials
-- (financial fields are protected via application logic; schema access is broader
-- to allow phase/status updates by field workers — enforced at API layer).
-- ══════════════════════════════════
CREATE POLICY "projects_read" ON projects FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "projects_write" ON projects FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "projects_update_admin" ON projects FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

-- Field workers can update limited status/phase fields (enforced at application layer)
CREATE POLICY "projects_update_field" ON projects FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'field');

CREATE POLICY "projects_delete" ON projects FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- PROJECT PHASES
-- All org members read. Owner/admin/field write (field workers update checklist items).
-- ══════════════════════════════════
CREATE POLICY "phases_read" ON project_phases FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_phases.project_id
        AND p.org_id = auth.user_org_id()
    )
  );

CREATE POLICY "phases_write" ON project_phases FOR ALL
  USING (
    auth.user_role() IN ('owner','admin','field')
    AND EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = project_phases.project_id
        AND p.org_id = auth.user_org_id()
    )
  );


-- ══════════════════════════════════
-- ESTIMATES (VAULT domain)
-- Owner/admin only — sensitive financial data
-- ══════════════════════════════════
CREATE POLICY "estimates_read" ON estimates FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "estimates_write" ON estimates FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "estimates_update" ON estimates FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "estimates_delete" ON estimates FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- INVOICES (LEDGER domain)
-- Owner/admin read + write. Only owner can delete.
-- ══════════════════════════════════
CREATE POLICY "invoices_read" ON invoices FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "invoices_write" ON invoices FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "invoices_update" ON invoices FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "invoices_delete" ON invoices FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- PAYMENTS (LEDGER domain)
-- Owner/admin only — sensitive financial records
-- ══════════════════════════════════
CREATE POLICY "payments_read" ON payments FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "payments_write" ON payments FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

-- Payments are never deleted — void via invoice status change instead
-- No DELETE policy on payments (append-only financial records)


-- ══════════════════════════════════
-- RFIs (BLUEPRINT domain)
-- All org members read. Owner/admin/field write.
-- ══════════════════════════════════
CREATE POLICY "rfis_read" ON rfis FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "rfis_write" ON rfis FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

CREATE POLICY "rfis_update" ON rfis FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin','field'));

CREATE POLICY "rfis_delete" ON rfis FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- CHANGE ORDERS (BLUEPRINT domain)
-- Owner/admin read + write. Only owner can approve/delete.
-- ══════════════════════════════════
CREATE POLICY "co_read" ON change_orders FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "co_write" ON change_orders FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "co_update" ON change_orders FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "co_delete" ON change_orders FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- CALENDAR EVENTS (CHRONO domain)
-- All org members read. Owner/admin write. Field can view their assignments.
-- ══════════════════════════════════
CREATE POLICY "calendar_read" ON calendar_events FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "calendar_write" ON calendar_events FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "calendar_update" ON calendar_events FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "calendar_delete" ON calendar_events FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- CREW MEMBERS
-- All org members read. Owner/admin write.
-- ══════════════════════════════════
CREATE POLICY "crew_read" ON crew_members FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "crew_write" ON crew_members FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- LEADS (SPARK domain)
-- Owner/admin only (lead data is sensitive business intelligence)
-- ══════════════════════════════════
CREATE POLICY "leads_read" ON leads FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "leads_write" ON leads FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "leads_update" ON leads FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "leads_delete" ON leads FOR DELETE
  USING (org_id = auth.user_org_id() AND auth.user_role() = 'owner');


-- ══════════════════════════════════
-- CAMPAIGNS (SPARK domain)
-- Owner/admin only
-- ══════════════════════════════════
CREATE POLICY "campaigns_read" ON campaigns FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "campaigns_write" ON campaigns FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- REVIEWS (SPARK domain)
-- All org members can read (good for morale visibility). Owner/admin write.
-- ══════════════════════════════════
CREATE POLICY "reviews_read" ON reviews FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "reviews_write" ON reviews FOR ALL
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- COMPLIANCE CHECKS (OHM domain)
-- All org members read. Owner/admin write/resolve.
-- ══════════════════════════════════
CREATE POLICY "compliance_read" ON compliance_checks FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "compliance_write" ON compliance_checks FOR INSERT
  WITH CHECK (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

CREATE POLICY "compliance_update" ON compliance_checks FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- AGENTS REGISTRY
-- All authenticated users can read (agents are org-agnostic system records).
-- Only service role (backend) can write — no user-facing insert/update policy.
-- ══════════════════════════════════
CREATE POLICY "agents_read" ON agents FOR SELECT
  USING (auth.uid() IS NOT NULL);


-- ══════════════════════════════════
-- AGENT PROPOSALS
-- All org members read. Owner/admin can approve/reject. Agents write via service role.
-- ══════════════════════════════════
CREATE POLICY "proposals_read" ON agent_proposals FOR SELECT
  USING (org_id = auth.user_org_id());

CREATE POLICY "proposals_update_admin" ON agent_proposals FOR UPDATE
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

-- Agents write proposals via service role key — no user-facing INSERT policy needed


-- ══════════════════════════════════
-- AGENT MESSAGES
-- Owner/admin can read message history (debugging, oversight).
-- Agents write via service role key.
-- ══════════════════════════════════
CREATE POLICY "agent_messages_read" ON agent_messages FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- NOTIFICATIONS
-- Users see only their own notifications. Agents write via service role.
-- ══════════════════════════════════
CREATE POLICY "notifications_own" ON notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "notifications_mark_read" ON notifications FOR UPDATE
  USING (user_id = auth.uid());


-- ══════════════════════════════════
-- MEMORY EMBEDDINGS
-- Agents read/write via service role. Owner/admin can query for debugging.
-- ══════════════════════════════════
CREATE POLICY "memory_read_admin" ON memory_embeddings FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));


-- ══════════════════════════════════
-- AUDIT LOG
-- INSERT: any org member (triggers write on their behalf via SECURITY DEFINER)
-- SELECT: owner/admin only
-- NO UPDATE policy
-- NO DELETE policy
-- ══════════════════════════════════
CREATE POLICY "audit_insert" ON audit_log FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

CREATE POLICY "audit_read" ON audit_log FOR SELECT
  USING (org_id = auth.user_org_id() AND auth.user_role() IN ('owner','admin'));

-- Intentionally no UPDATE or DELETE policy on audit_log.
-- This makes the table functionally immutable for all client-facing operations.
