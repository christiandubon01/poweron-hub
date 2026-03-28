-- ============================================================
-- Migration 010: 52-Week Revenue & Activity Tracker
-- Migrates the weekly tracker from the Operations Hub.
-- One row per fiscal week per org, tracking revenue KPIs.
-- ============================================================

CREATE TABLE weekly_tracker (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  fiscal_year     INT NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INT,
  week_number     INT NOT NULL CHECK (week_number BETWEEN 1 AND 53),
  week_start      DATE NOT NULL,                 -- Monday of that week
  week_end        DATE GENERATED ALWAYS AS (week_start + INTERVAL '6 days') STORED,

  -- Activity metrics
  active_projects INT DEFAULT 0,                 -- projects active that week
  service_calls   INT DEFAULT 0,                 -- service calls completed

  -- Revenue metrics
  service_revenue     NUMERIC(12,2) DEFAULT 0,   -- service call revenue
  project_revenue     NUMERIC(12,2) DEFAULT 0,   -- project billing revenue
  total_revenue       NUMERIC(12,2) GENERATED ALWAYS AS (
    COALESCE(service_revenue, 0) + COALESCE(project_revenue, 0)
  ) STORED,

  -- Outstanding
  unbilled_amount     NUMERIC(12,2) DEFAULT 0,   -- work done but not invoiced
  pending_invoices    NUMERIC(12,2) DEFAULT 0,   -- invoiced but not paid

  -- Cumulative
  ytd_revenue         NUMERIC(14,2) DEFAULT 0,   -- year-to-date accumulation
  ytd_expenses        NUMERIC(14,2) DEFAULT 0,   -- year-to-date expenses
  ytd_profit          NUMERIC(14,2) DEFAULT 0,   -- ytd_revenue - ytd_expenses

  -- Labor
  total_labor_hours   NUMERIC(8,2) DEFAULT 0,
  total_miles         NUMERIC(8,2) DEFAULT 0,

  -- Notes
  notes           TEXT,
  metadata        JSONB DEFAULT '{}',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One entry per week per org per year
  UNIQUE (org_id, fiscal_year, week_number)
);

CREATE INDEX idx_wt_org        ON weekly_tracker(org_id);
CREATE INDEX idx_wt_year       ON weekly_tracker(fiscal_year);
CREATE INDEX idx_wt_week_start ON weekly_tracker(week_start);

CREATE TRIGGER mdt_weekly_tracker
  BEFORE UPDATE ON weekly_tracker
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_weekly_tracker
  AFTER INSERT OR UPDATE OR DELETE ON weekly_tracker
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- --------------------------------------------------------
-- Helper: Get or create a weekly tracker row for the current week
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION get_or_create_weekly_tracker(
  p_org_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_week_start DATE;
  v_week_num INT;
  v_year INT;
  v_id UUID;
BEGIN
  -- Calculate Monday of the week
  v_week_start := p_date - ((EXTRACT(ISODOW FROM p_date)::INT - 1) || ' days')::INTERVAL;
  v_week_num := EXTRACT(WEEK FROM p_date)::INT;
  v_year := EXTRACT(YEAR FROM p_date)::INT;

  -- Try to find existing
  SELECT id INTO v_id
  FROM weekly_tracker
  WHERE org_id = p_org_id
    AND fiscal_year = v_year
    AND week_number = v_week_num;

  -- Create if missing
  IF v_id IS NULL THEN
    INSERT INTO weekly_tracker (org_id, fiscal_year, week_number, week_start)
    VALUES (p_org_id, v_year, v_week_num, v_week_start)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;
