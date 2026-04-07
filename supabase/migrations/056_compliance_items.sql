-- Migration: 056_compliance_items
-- Purpose: Compliance checklist for Tab 10 of Admin Command Center
-- Note: Run this migration manually in the Supabase SQL editor for project edxxbtyugohtowvslbfo

CREATE TABLE IF NOT EXISTS compliance_items (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT        NOT NULL DEFAULT 'General',
  title         TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'Pending'
                            CHECK (status IN ('Pending', 'In Progress', 'Filed', 'Active', 'Partial', 'Complete')),
  due_date      DATE,
  notes         TEXT,
  last_reviewed TIMESTAMPTZ,
  checked       BOOLEAN     NOT NULL DEFAULT false,
  checked_at    TIMESTAMPTZ,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS compliance_items_category_idx    ON compliance_items (category);
CREATE INDEX IF NOT EXISTS compliance_items_status_idx      ON compliance_items (status);
CREATE INDEX IF NOT EXISTS compliance_items_sort_order_idx  ON compliance_items (sort_order);

-- RLS
ALTER TABLE compliance_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compliance_items_select" ON compliance_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "compliance_items_insert" ON compliance_items
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "compliance_items_update" ON compliance_items
  FOR UPDATE TO authenticated USING (true);

-- Pre-populate default items
INSERT INTO compliance_items (category, title, status, sort_order) VALUES
  ('Legal',    'Attorney review of NDA',             'Pending',     1),
  ('Legal',    'Attorney review of ToS',             'Pending',     2),
  ('Legal',    'Attorney review of Privacy Policy',  'Pending',     3),
  ('Business', 'CDTFA Seller Permit',                'In Progress', 4),
  ('Business', 'USPTO Trademark #99745330',          'Filed',       5),
  ('Business', 'Copyright #1-15135532761',           'Filed',       6),
  ('Business', 'C-10 License #1151468',              'Active',      7),
  ('Business', 'GL Insurance (NEXT Insurance)',      'Active',      8),
  ('Business', 'Contractor Bond',                    'Active',      9),
  ('Tech',     'RLS policies audited on all Supabase tables', 'Partial', 10),
  ('Tech',     'No API keys in frontend bundle',     'Active',      11),
  ('Tech',     'Breach testing completed',           'Pending',     12),
  ('Tech',     'Pre-commit security hook active',    'Active',      13),
  ('Beta',     'Beta invite NDA flow tested end-to-end', 'Partial', 14),
  ('Beta',     'Attorney reviewed NDA before external use', 'Pending', 15)
ON CONFLICT DO NOTHING;
