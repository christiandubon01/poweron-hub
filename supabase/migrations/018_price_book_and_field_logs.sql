-- 018_price_book_and_field_logs.sql
-- Creates price_book_categories, price_book_items, and field_logs tables
-- Required for v15r data migration

-- 1. Price Book Categories
CREATE TABLE IF NOT EXISTS price_book_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pbc_org_name ON price_book_categories(org_id, name);

ALTER TABLE price_book_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pbc_select" ON price_book_categories FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "pbc_insert" ON price_book_categories FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "pbc_update" ON price_book_categories FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "pbc_delete" ON price_book_categories FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 2. Price Book Items
CREATE TABLE IF NOT EXISTS price_book_items (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  legacy_id         TEXT,
  name              TEXT NOT NULL,
  category_id       UUID REFERENCES price_book_categories(id) ON DELETE SET NULL,
  category_name     TEXT,
  unit_cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit              TEXT NOT NULL DEFAULT 'EA',
  pack_qty          INT DEFAULT 1,
  waste_factor      NUMERIC(5,3) DEFAULT 0,
  supplier          TEXT,
  metadata          JSONB DEFAULT '{}',
  is_active         BOOLEAN NOT NULL DEFAULT true,
  last_price_update TIMESTAMPTZ DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE price_book_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pbi_select" ON price_book_items FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "pbi_insert" ON price_book_items FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "pbi_update" ON price_book_items FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "pbi_delete" ON price_book_items FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- 3. Field Logs
CREATE TABLE IF NOT EXISTS field_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  logged_by       UUID NOT NULL,
  log_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  hours           NUMERIC(6,2) DEFAULT 0,
  material_cost   NUMERIC(10,2) DEFAULT 0,
  miles_round_trip NUMERIC(8,1) DEFAULT 0,
  notes           TEXT,
  quoted_amount   NUMERIC(10,2),
  collected       NUMERIC(10,2) DEFAULT 0,
  profit          NUMERIC(10,2) DEFAULT 0,
  pay_status      TEXT DEFAULT 'unpaid',
  material_store  TEXT,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE field_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fl_select" ON field_logs FOR SELECT USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "fl_insert" ON field_logs FOR INSERT WITH CHECK (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "fl_update" ON field_logs FOR UPDATE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "fl_delete" ON field_logs FOR DELETE USING (
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
