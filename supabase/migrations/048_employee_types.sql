-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 048: Employee Types System
-- Implements three distinct employee types for the Team panel:
--   permanent    — W-2, appears in all cost calculations permanently
--   per_project  — 1099 default, labor cost flows into assigned project budget
--   hypothetical — Planning only, not in real calculations; 6-Month Forecast
--
-- NOTE: The PowerOn Hub app is local-first (localStorage via backupDataService).
-- This migration documents the Supabase schema for multi-device sync.
-- The authoritative employee records live in the `app_state` row
-- (key: poweron_v2) under the `employees[]` array in the JSON blob.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Create employees table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  -- Core identity (matches BackupEmployee in backupDataService.ts)
  id              TEXT        NOT NULL PRIMARY KEY,
  name            TEXT,
  role            TEXT,
  bill_rate       NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost_rate       NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Type system (new in migration 048)
  employee_type   TEXT        NOT NULL DEFAULT 'permanent'
                  CHECK (employee_type IN ('permanent','per_project','hypothetical')),

  -- Classification: W-2 forced for permanent, default 1099 for per_project
  classification  TEXT        NOT NULL DEFAULT 'W-2'
                  CHECK (classification IN ('W-2','1099')),

  -- Hourly rate (primary rate for cost calculations)
  hourly_rate     NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Dates
  hire_date       DATE,                        -- permanent & per_project
  separation_date DATE,                        -- permanent when Inactive
  estimated_end_date DATE,                     -- per_project estimated close
  start_month     TEXT,                        -- hypothetical: 'YYYY-MM' future month

  -- Status
  status          TEXT        NOT NULL DEFAULT 'Active'
                  CHECK (status IN ('Active','Inactive','Closed')),

  -- Project link (per_project only)
  project_id      TEXT,                        -- links to projects.id

  -- Cost modifiers (inherited from existing employee model)
  is_owner        BOOLEAN     NOT NULL DEFAULT false,
  apply_multiplier BOOLEAN    NOT NULL DEFAULT true,

  -- OHM compliance tracking
  compliance_acknowledged BOOLEAN NOT NULL DEFAULT false,

  -- Audit
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_type
  ON employees (employee_type);

CREATE INDEX IF NOT EXISTS idx_employees_status
  ON employees (status);

CREATE INDEX IF NOT EXISTS idx_employees_project_id
  ON employees (project_id);

-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE employees IS
  'Employee records for Power On Hub Team panel. Three types: permanent (W-2, always in cost calculations), per_project (1099 default, labor flows into project budget), hypothetical (planning only, 6-Month Forecast model).';

COMMENT ON COLUMN employees.employee_type IS
  'permanent: W-2, always in calculations | per_project: 1099 default, flows to project | hypothetical: planning only, no real cost impact';

COMMENT ON COLUMN employees.classification IS
  'W-2 (permanent employees only) or 1099 (per_project default). Changing this triggers OHM compliance card.';

COMMENT ON COLUMN employees.project_id IS
  'For per_project type only. References active project. Auto-archive prompt fires when linked project completes.';

COMMENT ON COLUMN employees.start_month IS
  'For hypothetical type only. Format: YYYY-MM. Used in 6-Month Cost Forecast modeling.';

COMMENT ON COLUMN employees.compliance_acknowledged IS
  'Set true when user acknowledges the OHM compliance checklist for this employee. Non-blocking — does not prevent saving.';

COMMENT ON COLUMN employees.separation_date IS
  'For permanent employees set to Inactive. Records effective separation date.';

-- ── OHM Compliance Prompts (documentation) ───────────────────────────────────
-- PERMANENT (W-2) compliance checklist shown after save:
--   □ Form I-9 (identity + work authorization)
--   □ Form W-4 (federal withholding)
--   □ CA DE-4 (state withholding)
--   □ DFEH harassment prevention notice
--   □ Workers comp certificate (required for ANY CA employee)
--   □ Written employment agreement
--   □ Riverside County: confirm business license covers work location
--   Note: Workers comp required before first day of work in California — no exceptions.
--
-- PER-PROJECT (1099) compliance checklist shown after save:
--   □ Form W-9
--   □ Written Independent Contractor Agreement
--   □ Agreement must NOT include behavioral control language
--   □ CA AB5 compliance check: ABC test
--     A) Free from control and direction
--     B) Work is outside usual business
--     C) Worker has an independent business
--   Warning: Misclassification is a major CA risk — failing ABC test = must be W-2.
--
-- HYPOTHETICAL: No compliance card.
