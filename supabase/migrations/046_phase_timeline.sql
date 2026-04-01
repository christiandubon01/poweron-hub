-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 046: Phase Timeline Intelligence
-- Revenue Timeline Dashboard — Phase date tracking & payment schedule engine
--
-- Adds to the existing `projects` table:
--   phase_timeline   JSONB  — per-phase date/duration/payment entries
--   deposit_pct      NUMERIC — % of contract collected at project start
--   phase_deposit_pct NUMERIC — % collected at each phase start (default 0)
--
-- NOTE: The PowerOn Hub app is local-first (localStorage via backupDataService).
-- This migration tracks the Supabase schema for multi-device sync and future
-- server-side queries. The authoritative state lives in the `app_state` row
-- (key: poweron_v2). phase_timeline is stored on each project object in that blob.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Add phase_timeline JSONB to projects ─────────────────────────────────────
-- Stores an array of per-phase entries:
-- [{
--   phase_name: string,            -- matches settings.phaseWeights labels
--   confirmed_start_date: date | null,
--   estimated_duration_days: number | null,
--   actual_start_date: date | null,
--   actual_end_date: date | null,
--   quoted_labor_hours: number | null,
--   quoted_material_cost: number | null,
--   payment_trigger_pct: number    -- % of contract due at phase completion
-- }]
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS phase_timeline JSONB NOT NULL DEFAULT '[]';

-- ── Deposit structure fields ──────────────────────────────────────────────────
-- deposit_pct: % of contract collected at project convert-to-active
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS deposit_pct NUMERIC(5,2) NOT NULL DEFAULT 10;

-- phase_deposit_pct: % collected at the start of each phase (default 0)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS phase_deposit_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- ── contract_value alias (confirm existing column name is `contract`) ─────────
-- The app uses `contract` on the local state. No rename needed — document only.
-- contract NUMERIC already exists from 002_core_tables.sql

-- ── Index for phase_timeline queries ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_phase_timeline
  ON projects USING gin (phase_timeline);

-- ── Comment documentation ─────────────────────────────────────────────────────
COMMENT ON COLUMN projects.phase_timeline IS
  'Array of phase timeline entries: confirmed start dates, estimated durations, payment trigger percentages, quoted vs actual labor/materials per phase.';

COMMENT ON COLUMN projects.deposit_pct IS
  'Percentage of contract value collected as deposit when project converts to active. Default 10%.';

COMMENT ON COLUMN projects.phase_deposit_pct IS
  'Percentage of contract value collected at the start of each phase. Default 0 (payment on phase completion instead).';
