-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 012: Project Cost Entries (Labor / Material / Overhead)
-- Migrates the per-project laborRows, matRows, and ohRows from the
-- Operations Hub into normalized line-item tables.
--
-- These are ESTIMATE-TIME line items (what the project *should* cost).
-- Field logs (migration 008) track what *actually* happened.
--
-- DEPENDS ON: 002 (organizations, projects, profiles, crew_members),
--             009 (price_book_items)
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. PROJECT LABOR ENTRIES
-- Planned labor line items per project (from laborRows in the Hub)
-- ══════════════════════════════════
CREATE TABLE project_labor_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  description   TEXT NOT NULL,                     -- "Rough-in wiring", "Panel install", etc.
  employee_id   UUID REFERENCES crew_members(id) ON DELETE SET NULL,
  employee_name TEXT,                              -- denormalized snapshot

  hours         NUMERIC(8,2) NOT NULL DEFAULT 0,
  hourly_rate   NUMERIC(8,2) NOT NULL DEFAULT 0,
  line_total    NUMERIC(12,2) GENERATED ALWAYS AS (
    ROUND(hours * hourly_rate, 2)
  ) STORED,

  phase         TEXT,                              -- optional: which project phase
  sort_order    INT DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ple_org      ON project_labor_entries(org_id);
CREATE INDEX idx_ple_project  ON project_labor_entries(project_id);
CREATE INDEX idx_ple_employee ON project_labor_entries(employee_id);

CREATE TRIGGER mdt_project_labor_entries
  BEFORE UPDATE ON project_labor_entries
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_project_labor_entries
  AFTER INSERT OR UPDATE OR DELETE ON project_labor_entries
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();


-- ══════════════════════════════════
-- 2. PROJECT MATERIAL ENTRIES
-- Planned material line items per project (from matRows in the Hub)
-- ══════════════════════════════════
CREATE TABLE project_material_entries (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  price_book_item_id  UUID REFERENCES price_book_items(id) ON DELETE SET NULL,

  material_name       TEXT NOT NULL,               -- denormalized from price book
  quantity            NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_cost           NUMERIC(10,2) NOT NULL DEFAULT 0,   -- snapshot at time of estimate
  waste_factor        NUMERIC(4,3) DEFAULT 0.000,
  line_total          NUMERIC(12,2) GENERATED ALWAYS AS (
    ROUND(quantity * unit_cost * (1 + waste_factor), 2)
  ) STORED,

  phase               TEXT,
  sort_order          INT DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pme_org      ON project_material_entries(org_id);
CREATE INDEX idx_pme_project  ON project_material_entries(project_id);
CREATE INDEX idx_pme_item     ON project_material_entries(price_book_item_id);

CREATE TRIGGER mdt_project_material_entries
  BEFORE UPDATE ON project_material_entries
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_project_material_entries
  AFTER INSERT OR UPDATE OR DELETE ON project_material_entries
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();


-- ══════════════════════════════════
-- 3. PROJECT OVERHEAD ENTRIES
-- Planned overhead line items per project (from ohRows in the Hub)
-- Covers: estimating time, material pickup, permit runs, travel, etc.
-- ══════════════════════════════════
CREATE TABLE project_overhead_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  description   TEXT NOT NULL,                     -- "Estimating", "Material pickup", "Permit run"
  hours         NUMERIC(8,2) NOT NULL DEFAULT 0,
  hourly_rate   NUMERIC(8,2) NOT NULL DEFAULT 0,
  line_total    NUMERIC(12,2) GENERATED ALWAYS AS (
    ROUND(hours * hourly_rate, 2)
  ) STORED,

  category      TEXT DEFAULT 'general'
    CHECK (category IN (
      'estimating','material_pickup','permit','travel',
      'supervision','admin','cleanup','general'
    )),

  sort_order    INT DEFAULT 0,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_poe_org      ON project_overhead_entries(org_id);
CREATE INDEX idx_poe_project  ON project_overhead_entries(project_id);
CREATE INDEX idx_poe_category ON project_overhead_entries(category);

CREATE TRIGGER mdt_project_overhead_entries
  BEFORE UPDATE ON project_overhead_entries
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_project_overhead_entries
  AFTER INSERT OR UPDATE OR DELETE ON project_overhead_entries
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();


-- ══════════════════════════════════
-- 4. PROJECT COST SUMMARY VIEW
-- Convenient view joining all three cost types per project.
-- ══════════════════════════════════
CREATE OR REPLACE VIEW project_cost_summary AS
SELECT
  p.id                 AS project_id,
  p.org_id,
  p.name               AS project_name,
  p.contract_value,

  -- Labor totals
  COALESCE(l.total_hours, 0)     AS est_labor_hours,
  COALESCE(l.total_cost, 0)      AS est_labor_cost,

  -- Material totals
  COALESCE(m.total_cost, 0)      AS est_material_cost,

  -- Overhead totals
  COALESCE(o.total_hours, 0)     AS est_overhead_hours,
  COALESCE(o.total_cost, 0)      AS est_overhead_cost,

  -- Grand total estimated cost
  COALESCE(l.total_cost, 0)
    + COALESCE(m.total_cost, 0)
    + COALESCE(o.total_cost, 0)  AS est_total_cost,

  -- Estimated margin
  CASE WHEN p.contract_value > 0 THEN
    ROUND(
      (p.contract_value - (COALESCE(l.total_cost,0) + COALESCE(m.total_cost,0) + COALESCE(o.total_cost,0)))
      / p.contract_value * 100, 2
    )
  END AS est_margin_pct

FROM projects p
LEFT JOIN LATERAL (
  SELECT SUM(hours) AS total_hours, SUM(line_total) AS total_cost
  FROM project_labor_entries WHERE project_id = p.id
) l ON true
LEFT JOIN LATERAL (
  SELECT SUM(line_total) AS total_cost
  FROM project_material_entries WHERE project_id = p.id
) m ON true
LEFT JOIN LATERAL (
  SELECT SUM(hours) AS total_hours, SUM(line_total) AS total_cost
  FROM project_overhead_entries WHERE project_id = p.id
) o ON true;

COMMENT ON VIEW project_cost_summary IS
  'Aggregated estimate-time cost breakdown per project. '
  'Joins labor, material, and overhead entries for a single-query cost view.';
