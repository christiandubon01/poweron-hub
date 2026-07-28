-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 084: Employee trade role column
-- CREW-PORTAL-LIVE-2
--
-- Additive only: nullable employee_role on employee_profiles.
-- Does not alter existing `role` CHECK, RLS, or RPCs. No backfill.
--
-- DEPENDS ON: 081_employee_time_tracking.sql
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.employee_profiles
  ADD COLUMN IF NOT EXISTS employee_role TEXT
    CHECK (
      employee_role IS NULL
      OR employee_role IN ('tech_1', 'tech_2', 'lead', 'foreman')
    )
    DEFAULT NULL;

COMMENT ON COLUMN public.employee_profiles.employee_role IS
  'Optional trade role for display (Tech 1 / Tech 2 / Lead / Foreman). '
  'Independent of portal access role (employee | foreman). Nullable = unassigned.';

COMMIT;
