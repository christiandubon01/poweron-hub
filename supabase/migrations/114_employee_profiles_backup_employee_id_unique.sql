-- 114: Organization-safe unique link between employee_profiles and cost-model employees
--
-- ROLE-2.2A — Stable identity integrity for backup_employee_id.
--
-- Guarantees:
--   • One employee_profiles row links to at most one Cost Model employee
--     (single-column field — already true).
--   • One Cost Model employee links to at most one employee_profiles row
--     within the same organization (this unique index).
--   • NULL backup_employee_id values remain allowed (unlinked / prepared later).
--
-- Authorization is unchanged: ep_owner_admin_update (migration 081) restricts
-- UPDATE to owner/admin of the org. Ordinary employees cannot set this field.
--
-- DEPENDS ON: 081_employee_time_tracking.sql (employee_profiles.backup_employee_id)

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_profiles_org_backup_employee_unique
  ON public.employee_profiles (org_id, backup_employee_id)
  WHERE backup_employee_id IS NOT NULL;

COMMENT ON INDEX public.idx_employee_profiles_org_backup_employee_unique IS
  'ROLE-2.2A: At most one portal profile per Cost Model employee within an organization.';
