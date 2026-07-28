-- 088: Add missing DELETE RLS policy for employee_profiles
--
-- Migration 081 created SELECT/INSERT/UPDATE policies for owners but omitted DELETE.
-- Without this, owner DELETE calls silently affect 0 rows (Postgres RLS filters out
-- the row), causing the "Delete Portal Record" action to appear successful while the
-- record remains in the database.
--
-- The service-layer guard in deleteEmployeePortalRecord() still enforces business
-- rules (active+accepted employees must be archived before deletion).

CREATE POLICY ep_owner_admin_delete ON public.employee_profiles
  FOR DELETE
  USING (
    org_id = public.user_org_id()
    AND public.user_role() IN ('owner', 'admin')
  );
