-- ============================================================================
-- Migration 025: Material Receipts — Stores parsed receipt data for VAULT
-- Material Variance Tracker. Links receipts to field_logs and projects,
-- then compares actual material spend against MTO (material takeoff) estimates.
-- ============================================================================

CREATE TABLE IF NOT EXISTS material_receipts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  field_log_id    UUID REFERENCES field_logs(id) ON DELETE SET NULL,
  uploaded_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,

  -- Source info
  source          TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'home_depot', 'lowes', 'crawford', 'platt', 'other')),
  receipt_url     TEXT,             -- external link (Home Depot order URL, etc.)
  receipt_date    DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Parsed line items stored as JSONB array
  -- Each item: { name, qty, unit_cost, total, sku?, category? }
  line_items      JSONB NOT NULL DEFAULT '[]',

  -- Totals
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax             NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Variance tracking
  phase           TEXT,             -- project phase this receipt applies to
  mto_estimated   NUMERIC(12,2),   -- estimated material cost from MTO for this phase
  variance_amount NUMERIC(12,2),   -- actual - estimated (negative = under budget)
  variance_pct    NUMERIC(6,2),    -- variance as percentage

  -- Notes
  notes           TEXT,
  store_name      TEXT,
  store_location  TEXT,

  -- Metadata
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_material_receipts_org     ON material_receipts(org_id);
CREATE INDEX IF NOT EXISTS idx_material_receipts_project ON material_receipts(project_id);
CREATE INDEX IF NOT EXISTS idx_material_receipts_log     ON material_receipts(field_log_id);
CREATE INDEX IF NOT EXISTS idx_material_receipts_date    ON material_receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_material_receipts_phase   ON material_receipts(phase);

-- Auto-update timestamp
CREATE TRIGGER mdt_material_receipts
  BEFORE UPDATE ON material_receipts
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

-- RLS
ALTER TABLE material_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY mr_org_select ON material_receipts FOR SELECT USING (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);
CREATE POLICY mr_org_insert ON material_receipts FOR INSERT WITH CHECK (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);
CREATE POLICY mr_org_update ON material_receipts FOR UPDATE USING (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);
CREATE POLICY mr_org_delete ON material_receipts FOR DELETE USING (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
