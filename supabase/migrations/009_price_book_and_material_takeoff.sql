-- ============================================================
-- Migration 009: Price Book + Material Takeoff
-- Migrates the 275-item price book and per-project MTO system
-- from the Operations Hub into normalized Supabase tables.
-- ============================================================

-- --------------------------------------------------------
-- 1. PRICE BOOK CATEGORIES — lookup table
-- --------------------------------------------------------
CREATE TABLE price_book_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,                     -- e.g. "Wire—Romex", "Conduit—PVC"
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pbc_org_name ON price_book_categories(org_id, name);

-- --------------------------------------------------------
-- 2. PRICE BOOK ITEMS — master material catalog
-- --------------------------------------------------------
CREATE TABLE price_book_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES price_book_categories(id) ON DELETE SET NULL,

  legacy_id     TEXT,                            -- original ID from Hub (m001–m275)
  name          TEXT NOT NULL,                   -- material description
  category_name TEXT,                            -- denormalized for quick display

  -- Pricing
  unit_cost     NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit          TEXT DEFAULT 'EA'
    CHECK (unit IN ('EA','RL','SP','FT','BX','PK','PR','LF','CF','SET','LOT')),
  pack_qty      INT DEFAULT 1,                   -- units per pack
  waste_factor  NUMERIC(4,3) DEFAULT 0.000,      -- 0.000–0.150 (0–15%)

  -- Supplier
  supplier      TEXT,                            -- Home Depot, Lowes, Crawford Electric, Rexel, etc.

  -- Status
  is_active     BOOLEAN DEFAULT true,
  last_price_update TIMESTAMPTZ,

  -- Metadata
  metadata      JSONB DEFAULT '{}',              -- spec sheet URL, alt SKUs, notes
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pbi_org        ON price_book_items(org_id);
CREATE INDEX idx_pbi_category   ON price_book_items(category_id);
CREATE INDEX idx_pbi_legacy     ON price_book_items(org_id, legacy_id);
CREATE INDEX idx_pbi_supplier   ON price_book_items(supplier);
CREATE INDEX idx_pbi_active     ON price_book_items(org_id) WHERE is_active = true;

CREATE TRIGGER mdt_price_book_items
  BEFORE UPDATE ON price_book_items
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

CREATE TRIGGER audit_price_book_items
  AFTER INSERT OR UPDATE OR DELETE ON price_book_items
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- --------------------------------------------------------
-- 3. MATERIAL TAKEOFFS — per-project bill of materials
-- --------------------------------------------------------
CREATE TABLE material_takeoffs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  name        TEXT DEFAULT 'Primary MTO',        -- allows multiple MTOs per project
  status      TEXT DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','ordered','received')),
  total_cost  NUMERIC(12,2) DEFAULT 0,           -- calculated sum of line items

  notes       TEXT,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mto_org      ON material_takeoffs(org_id);
CREATE INDEX idx_mto_project  ON material_takeoffs(project_id);

CREATE TRIGGER mdt_material_takeoffs
  BEFORE UPDATE ON material_takeoffs
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- --------------------------------------------------------
-- 4. MATERIAL TAKEOFF LINES — individual MTO rows
-- --------------------------------------------------------
CREATE TABLE material_takeoff_lines (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  takeoff_id      UUID NOT NULL REFERENCES material_takeoffs(id) ON DELETE CASCADE,
  price_book_item_id UUID REFERENCES price_book_items(id) ON DELETE SET NULL,

  phase           TEXT,                          -- Underground, Rough In, Trim, etc.
  material_name   TEXT NOT NULL,                 -- denormalized for display
  quantity        NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_cost       NUMERIC(10,2) DEFAULT 0,       -- snapshot from price book at time of creation
  waste_factor    NUMERIC(4,3) DEFAULT 0.000,
  line_total      NUMERIC(12,2) GENERATED ALWAYS AS (
    ROUND(quantity * unit_cost * (1 + waste_factor), 2)
  ) STORED,

  note            TEXT,                          -- e.g. "Circuit Raceway", "Sub Panel Feeder"
  sort_order      INT DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mtol_takeoff   ON material_takeoff_lines(takeoff_id);
CREATE INDEX idx_mtol_item      ON material_takeoff_lines(price_book_item_id);
CREATE INDEX idx_mtol_phase     ON material_takeoff_lines(phase);

CREATE TRIGGER audit_material_takeoffs
  AFTER INSERT OR UPDATE OR DELETE ON material_takeoffs
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_material_takeoff_lines
  AFTER INSERT OR UPDATE OR DELETE ON material_takeoff_lines
  FOR EACH ROW EXECUTE FUNCTION log_audit_change();
