-- ============================================================================
-- Migration 044 — Blueprint Intelligence
-- Session 13: Blueprint upload, PDF extraction, OHM analysis
-- ============================================================================

-- ── blueprint_extracts table ─────────────────────────────────────────────────
-- Stores extracted text from uploaded blueprint PDFs.
-- One row per uploaded file. org_id + project_id enable multi-tenant access.

CREATE TABLE IF NOT EXISTS blueprint_extracts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL,
  project_id     text        NOT NULL,
  filename       text        NOT NULL,
  label          text        NOT NULL DEFAULT 'Full Set'
                              CHECK (label IN ('Full Set', 'Electrical Only', 'Reference Sheet')),
  extracted_text text,
  page_count     integer,
  electrical_flags text[]   DEFAULT '{}',
  storage_path   text,
  analyzed       boolean     NOT NULL DEFAULT false,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_blueprint_extracts_org_project
  ON blueprint_extracts (org_id, project_id);

CREATE INDEX IF NOT EXISTS idx_blueprint_extracts_org
  ON blueprint_extracts (org_id);

CREATE INDEX IF NOT EXISTS idx_blueprint_extracts_uploaded_at
  ON blueprint_extracts (uploaded_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_blueprint_extracts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_blueprint_extracts_updated_at
  BEFORE UPDATE ON blueprint_extracts
  FOR EACH ROW
  EXECUTE FUNCTION update_blueprint_extracts_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE blueprint_extracts ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's extracts
CREATE POLICY blueprint_extracts_select ON blueprint_extracts
  FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Org members can insert
CREATE POLICY blueprint_extracts_insert ON blueprint_extracts
  FOR INSERT
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Org members can update their own records
CREATE POLICY blueprint_extracts_update ON blueprint_extracts
  FOR UPDATE
  USING (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Org members can delete their own records
CREATE POLICY blueprint_extracts_delete ON blueprint_extracts
  FOR DELETE
  USING (
    org_id IN (
      SELECT org_id FROM profiles WHERE id = auth.uid()
    )
  );

-- ── Supabase Storage bucket setup (run via Supabase dashboard or CLI) ─────────
-- The 'blueprints' storage bucket should be created with these settings:
--   - Name: blueprints
--   - Public: false (private bucket)
--   - File size limit: 50MB
--   - Allowed MIME types: application/pdf
--
-- Storage path convention: {org_id}/{project_id}/blueprints/{file_id}_{filename}
--
-- RLS policy on storage.objects for the blueprints bucket:
--   SELECT: auth.uid() IN (SELECT id FROM profiles WHERE org_id = split_part(name, '/', 1)::uuid)
--   INSERT: same check
--
-- These storage policies must be set via the Supabase dashboard or supabase CLI.
-- The app falls back to local-only mode if storage is unavailable.

-- ── Comment ───────────────────────────────────────────────────────────────────
COMMENT ON TABLE blueprint_extracts IS
  'Stores extracted text content from uploaded blueprint PDFs for OHM analysis. '
  'One row per file. electrical_flags contains detected NEC keywords. '
  'Part of Blueprint Intelligence feature (Session 13).';
