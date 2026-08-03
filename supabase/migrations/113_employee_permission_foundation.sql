-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 113: Employee Permission Foundation — ROLE-1
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Purpose: Adds the secure database-backed multi-role permission engine for
-- employees. This is purely additive: no existing tables, RLS policies, RPCs,
-- portal security, or employee behaviour changes.
--
-- Tables added:
--   emp_roles               — named roles scoped to an org
--   emp_role_assignments    — employee_profile → role join
--   emp_role_permissions    — role → permission key grants
--   emp_permission_overrides — per-employee allow/deny overrides
--
-- Function added:
--   current_employee_has_permission(TEXT) → BOOLEAN
--     canonical browser-safe permission resolver (see STEP 7 contract below)
--
-- Precedence (highest to lowest):
--   OWNER/ADMIN of employer org  → true  (unconditional)
--   EXPLICIT DENY override       → false (beats allow and role grants)
--   EXPLICIT ALLOW override      → true
--   ANY ROLE GRANT               → true
--   DEFAULT                      → false
--
-- Organization model:
--   All new records are scoped to org_id. emp_roles and emp_role_permissions
--   are org-scoped so organizations can define their own named roles without
--   colliding with other tenants. Cross-org assignment is blocked at RLS and
--   enforced by a trigger on emp_role_assignments.
--
-- Permission key format: '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
--   Valid examples: time.view, tasks.complete, portal.view, admin.any
--
-- Migration number safety:
--   Last applied migration is 111_private_portal_storage.sql.
--   112 is reserved for unrelated Solar work (uncommitted). 113 is the next safe number.
--
-- Does NOT modify:
--   profiles, employee_profiles, organizations, portal_requests, any existing
--   RLS policy, any applied migration (001–111), deno.lock, or any non-ROLE-1 file.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. emp_roles ──────────────────────────────────────────────────────────────
-- Named roles owned by an org. Org A's roles are invisible to Org B.

CREATE TABLE IF NOT EXISTS public.emp_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT emp_roles_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT emp_roles_name_lower CHECK (name = lower(btrim(name))),
  UNIQUE (org_id, name)
);

COMMENT ON TABLE public.emp_roles IS
  'ROLE-1: Named employee roles scoped to an org. '
  'An org can define any named role (e.g. "dispatcher", "lead_tech"). '
  'Do not confuse with profiles.role (owner/admin/field/viewer).';

CREATE INDEX IF NOT EXISTS idx_emp_roles_org ON public.emp_roles (org_id);

CREATE TRIGGER mdt_emp_roles
  BEFORE UPDATE ON public.emp_roles
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.emp_roles ENABLE ROW LEVEL SECURITY;

-- Owner/admin: full access within their org
CREATE POLICY empr_owner_admin_select ON public.emp_roles
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

CREATE POLICY empr_owner_admin_insert ON public.emp_roles
  FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY empr_owner_admin_update ON public.emp_roles
  FOR UPDATE
  USING  (public.is_org_admin_for(org_id))
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY empr_owner_admin_delete ON public.emp_roles
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

-- Employees: read-only view of roles in their employer org
-- (so UIs can display role names without exposing management capability)
CREATE POLICY empr_employee_select_own_org ON public.emp_roles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_profiles ep
      WHERE ep.user_id = auth.uid()
        AND ep.org_id  = emp_roles.org_id
        AND ep.active  = true
    )
  );

-- ── 2. emp_role_assignments ───────────────────────────────────────────────────
-- Maps an employee_profiles row to one or more emp_roles.
-- Security invariant: an employee cannot insert their own assignment.

CREATE TABLE IF NOT EXISTS public.emp_role_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  role_id             UUID NOT NULL REFERENCES public.emp_roles(id) ON DELETE CASCADE,
  assigned_by         UUID NOT NULL REFERENCES auth.users(id),
  assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_profile_id, role_id)
);

COMMENT ON TABLE public.emp_role_assignments IS
  'ROLE-1: Links employee_profiles to emp_roles. '
  'Only owner/admin may insert. An employee cannot assign themselves a role. '
  'org_id must match both the employee_profile and the emp_role (enforced by trigger).';

CREATE INDEX IF NOT EXISTS idx_era_org ON public.emp_role_assignments (org_id);
CREATE INDEX IF NOT EXISTS idx_era_employee ON public.emp_role_assignments (employee_profile_id);
CREATE INDEX IF NOT EXISTS idx_era_role ON public.emp_role_assignments (role_id);

ALTER TABLE public.emp_role_assignments ENABLE ROW LEVEL SECURITY;

-- Owner/admin only for all writes. Employees cannot insert, update, or delete.
CREATE POLICY era_owner_admin_select ON public.emp_role_assignments
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

CREATE POLICY era_owner_admin_insert ON public.emp_role_assignments
  FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY era_owner_admin_update ON public.emp_role_assignments
  FOR UPDATE
  USING  (public.is_org_admin_for(org_id))
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY era_owner_admin_delete ON public.emp_role_assignments
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

-- Employees: can read their own assignments (to know which roles they hold)
CREATE POLICY era_employee_select_own ON public.emp_role_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_profiles ep
      WHERE ep.id     = emp_role_assignments.employee_profile_id
        AND ep.user_id = auth.uid()
        AND ep.active  = true
    )
  );

-- ── 2b. Cross-org consistency trigger ────────────────────────────────────────
-- Prevents a role from Org A being assigned to an employee from Org B even
-- when data is inserted through an elevated context.

CREATE OR REPLACE FUNCTION public.trg_era_check_org_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ep_org  UUID;
  v_role_org UUID;
BEGIN
  SELECT org_id INTO v_ep_org
  FROM employee_profiles WHERE id = NEW.employee_profile_id;

  SELECT org_id INTO v_role_org
  FROM emp_roles WHERE id = NEW.role_id;

  IF v_ep_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION
      'ROLE-1: emp_role_assignments.org_id (%) does not match employee_profile org_id (%)',
      NEW.org_id, v_ep_org;
  END IF;

  IF v_role_org IS DISTINCT FROM NEW.org_id THEN
    RAISE EXCEPTION
      'ROLE-1: emp_role_assignments.org_id (%) does not match emp_role org_id (%)',
      NEW.org_id, v_role_org;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_era_check_org_consistency() IS
  'ROLE-1: Prevents cross-org role assignment even under service-role context. '
  'Fires BEFORE INSERT OR UPDATE on emp_role_assignments.';

CREATE TRIGGER trg_era_org_check
  BEFORE INSERT OR UPDATE ON public.emp_role_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_era_check_org_consistency();

-- ── 3. emp_role_permissions ───────────────────────────────────────────────────
-- Grants a permission key to an emp_role.

CREATE TABLE IF NOT EXISTS public.emp_role_permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role_id        UUID NOT NULL REFERENCES public.emp_roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT erp_key_format CHECK (
    permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  ),
  UNIQUE (role_id, permission_key)
);

COMMENT ON TABLE public.emp_role_permissions IS
  'ROLE-1: Maps emp_roles to permission keys. '
  'permission_key format: domain.action (e.g. time.view, tasks.complete). '
  'Keys are validated by CHECK constraint — blank or malformed keys are rejected.';

CREATE INDEX IF NOT EXISTS idx_erp_role ON public.emp_role_permissions (role_id);
CREATE INDEX IF NOT EXISTS idx_erp_key  ON public.emp_role_permissions (permission_key);

ALTER TABLE public.emp_role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY erperm_owner_admin_select ON public.emp_role_permissions
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

CREATE POLICY erperm_owner_admin_insert ON public.emp_role_permissions
  FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY erperm_owner_admin_update ON public.emp_role_permissions
  FOR UPDATE
  USING  (public.is_org_admin_for(org_id))
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY erperm_owner_admin_delete ON public.emp_role_permissions
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

-- Employees: read-only so UIs can display granted permissions for their roles
CREATE POLICY erperm_employee_select_own_org ON public.emp_role_permissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_profiles ep
      WHERE ep.user_id = auth.uid()
        AND ep.org_id  = emp_role_permissions.org_id
        AND ep.active  = true
    )
  );

-- ── 4. emp_permission_overrides ───────────────────────────────────────────────
-- Per-employee allow/deny that supplement (or override) role grants.
-- is_deny = true  → explicit deny (beats allow and role grants)
-- is_deny = false → explicit allow

CREATE TABLE IF NOT EXISTS public.emp_permission_overrides (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_profile_id UUID NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  permission_key      TEXT NOT NULL,
  is_deny             BOOLEAN NOT NULL DEFAULT false,
  granted_by          UUID NOT NULL REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT epo_key_format CHECK (
    permission_key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  ),
  UNIQUE (employee_profile_id, permission_key)
);

COMMENT ON TABLE public.emp_permission_overrides IS
  'ROLE-1: Per-employee allow or deny overrides. '
  'is_deny=true is an explicit deny that beats any allow or role grant. '
  'is_deny=false is an explicit allow. '
  'Ordinary employees cannot insert or modify — owner/admin only.';

CREATE INDEX IF NOT EXISTS idx_epo_employee ON public.emp_permission_overrides (employee_profile_id);
CREATE INDEX IF NOT EXISTS idx_epo_key      ON public.emp_permission_overrides (permission_key);

CREATE TRIGGER mdt_emp_permission_overrides
  BEFORE UPDATE ON public.emp_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.emp_permission_overrides ENABLE ROW LEVEL SECURITY;

-- Owner/admin: full access within their org only
CREATE POLICY epo_owner_admin_select ON public.emp_permission_overrides
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

CREATE POLICY epo_owner_admin_insert ON public.emp_permission_overrides
  FOR INSERT
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY epo_owner_admin_update ON public.emp_permission_overrides
  FOR UPDATE
  USING  (public.is_org_admin_for(org_id))
  WITH CHECK (
    org_id = public.user_org_id()
    AND public.is_org_admin_for(org_id)
  );

CREATE POLICY epo_owner_admin_delete ON public.emp_permission_overrides
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

-- Employees: read-only for their own overrides (so portal UIs know their grants)
CREATE POLICY epo_employee_select_own ON public.emp_permission_overrides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.employee_profiles ep
      WHERE ep.id     = emp_permission_overrides.employee_profile_id
        AND ep.user_id = auth.uid()
        AND ep.active  = true
    )
  );

-- ── 5. GRANT table-level DML to authenticated (RLS scopes it further) ─────────
-- Ordinary employees get SELECT only on the four tables (RLS limits to their rows).
-- INSERT/UPDATE/DELETE on the management tables is RLS-gated to owner/admin.

GRANT SELECT                    ON public.emp_roles                TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emp_roles           TO authenticated;  -- RLS enforces owner/admin

GRANT SELECT                    ON public.emp_role_assignments      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emp_role_assignments TO authenticated;  -- RLS enforces owner/admin

GRANT SELECT                    ON public.emp_role_permissions      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emp_role_permissions TO authenticated;  -- RLS enforces owner/admin

GRANT SELECT                    ON public.emp_permission_overrides  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.emp_permission_overrides TO authenticated;  -- RLS enforces owner/admin

REVOKE ALL ON public.emp_roles                FROM PUBLIC;
REVOKE ALL ON public.emp_role_assignments      FROM PUBLIC;
REVOKE ALL ON public.emp_role_permissions      FROM PUBLIC;
REVOKE ALL ON public.emp_permission_overrides  FROM PUBLIC;

REVOKE ALL ON public.emp_roles                FROM anon;
REVOKE ALL ON public.emp_role_assignments      FROM anon;
REVOKE ALL ON public.emp_role_permissions      FROM anon;
REVOKE ALL ON public.emp_permission_overrides  FROM anon;

-- ── 6. Canonical permission resolver ─────────────────────────────────────────
-- current_employee_has_permission(TEXT) → BOOLEAN
--
-- Contract:
--   Resolves auth.uid() — never accepts an arbitrary employee UUID.
--   Precedence:
--     1. Owner/admin of the employer org → true
--     2. Explicit deny for this employee + key → false
--     3. Explicit allow for this employee + key → true
--     4. Any assigned role grants this key → true
--     5. Default → false
--
-- SECURITY DEFINER with fixed search_path prevents search-path injection.
-- STABLE allows the planner to cache within a statement (same as user_role()).

CREATE OR REPLACE FUNCTION public.current_employee_has_permission(
  p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_ep      employee_profiles%ROWTYPE;
  v_is_deny BOOLEAN;
BEGIN
  -- 0. Must be authenticated
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN false; END IF;

  -- 1. Validate permission key format (early-exit on garbage input)
  IF p_permission_key IS NULL
     OR p_permission_key !~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  THEN
    RETURN false;
  END IF;

  -- 2. Look up caller's active employee_profile
  SELECT ep.*
    INTO v_ep
    FROM employee_profiles ep
   WHERE ep.user_id = v_uid
     AND ep.active  = true
   LIMIT 1;

  IF v_ep.id IS NULL THEN
    -- No employee_profiles row: treat as owner/admin if profiles.role qualifies.
    -- This path is taken when an owner (who has no employee_profiles row) calls
    -- this function — e.g. from an owner UI component that uses the same guard.
    RETURN EXISTS (
      SELECT 1 FROM profiles
       WHERE id   = v_uid
         AND role IN ('owner', 'admin')
    );
  END IF;

  -- 3. Owner/admin of the EMPLOYER org → unconditional true
  --    Uses is_org_admin_for so the check is scoped to the employer org, not
  --    any org where the person might happen to be owner.
  IF public.is_org_admin_for(v_ep.org_id) THEN
    RETURN true;
  END IF;

  -- 4. Explicit deny (beats allow and all role grants)
  SELECT epo.is_deny
    INTO v_is_deny
    FROM emp_permission_overrides epo
   WHERE epo.employee_profile_id = v_ep.id
     AND epo.permission_key      = p_permission_key
     AND epo.is_deny             = true
   LIMIT 1;

  IF FOUND AND v_is_deny THEN
    RETURN false;
  END IF;

  -- 5. Explicit allow
  IF EXISTS (
    SELECT 1
      FROM emp_permission_overrides epo
     WHERE epo.employee_profile_id = v_ep.id
       AND epo.permission_key      = p_permission_key
       AND epo.is_deny             = false
  ) THEN
    RETURN true;
  END IF;

  -- 6. Any assigned role grants this key (scoped to employer org)
  RETURN EXISTS (
    SELECT 1
      FROM emp_role_assignments  era
      JOIN emp_role_permissions  erp ON erp.role_id = era.role_id
     WHERE era.employee_profile_id = v_ep.id
       AND era.org_id              = v_ep.org_id
       AND erp.org_id              = v_ep.org_id
       AND erp.permission_key      = p_permission_key
  );
END;
$$;

COMMENT ON FUNCTION public.current_employee_has_permission(TEXT) IS
  'ROLE-1 canonical permission resolver. Resolves auth.uid() — never accepts '
  'an arbitrary employee UUID. Precedence: owner/admin > explicit deny > '
  'explicit allow > role grant > default false. SECURITY DEFINER + fixed '
  'search_path. Not callable by PUBLIC or anon.';

REVOKE ALL   ON FUNCTION public.current_employee_has_permission(TEXT) FROM PUBLIC;
REVOKE ALL   ON FUNCTION public.current_employee_has_permission(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.current_employee_has_permission(TEXT) TO authenticated;

-- ── 7. Trigger function execute privilege ─────────────────────────────────────
REVOKE ALL ON FUNCTION public.trg_era_check_org_consistency() FROM PUBLIC;
-- Trigger functions are invoked by the trigger infrastructure, not directly.

-- ── 8. Postcondition assertions ───────────────────────────────────────────────
-- Run after COMMIT to verify all objects exist.
--
-- SELECT table_name
--   FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN (
--      'emp_roles','emp_role_assignments',
--      'emp_role_permissions','emp_permission_overrides'
--    );
--
-- SELECT policyname, tablename
--   FROM pg_policies
--  WHERE tablename IN (
--    'emp_roles','emp_role_assignments',
--    'emp_role_permissions','emp_permission_overrides'
--  )
--  ORDER BY tablename, policyname;
--
-- SELECT proname FROM pg_proc
--  WHERE proname IN (
--    'current_employee_has_permission',
--    'trg_era_check_org_consistency'
--  );
--
-- SELECT grantee, privilege_type
--   FROM information_schema.role_routine_grants
--  WHERE routine_name = 'current_employee_has_permission';

COMMIT;
