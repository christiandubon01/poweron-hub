-- ============================================================================
-- PowerOn Hub - Migration 089: Work Order Snapshot Storage
--
-- Private Blueprint Work Order snapshot storage, metadata, assignment
-- attachments, owner/admin RLS, and org-scoped Storage policies.
-- ============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blueprint-snapshots',
  'blueprint-snapshots',
  false,
  10485760,
  ARRAY['image/png']
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS public.blueprint_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  project_name TEXT NOT NULL,
  blueprint_set_id TEXT NOT NULL,
  work_package_id TEXT,
  work_package_name TEXT,
  storage_path TEXT NOT NULL,
  caption TEXT,
  captured_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  page_number INTEGER,
  capture_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT blueprint_snapshots_storage_path_key UNIQUE (storage_path),
  CONSTRAINT blueprint_snapshots_org_id_id_key UNIQUE (org_id, id),
  CONSTRAINT blueprint_snapshots_width_check CHECK (width > 0 AND width <= 4096),
  CONSTRAINT blueprint_snapshots_height_check CHECK (height > 0 AND height <= 4096),
  CONSTRAINT blueprint_snapshots_file_size_check CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760),
  CONSTRAINT blueprint_snapshots_mime_type_check CHECK (mime_type = 'image/png'),
  CONSTRAINT blueprint_snapshots_page_number_check CHECK (page_number IS NULL OR page_number > 0),
  CONSTRAINT blueprint_snapshots_capture_metadata_object_check CHECK (jsonb_typeof(capture_metadata) = 'object'),
  CONSTRAINT blueprint_snapshots_project_id_not_blank CHECK (btrim(project_id) <> ''),
  CONSTRAINT blueprint_snapshots_project_name_not_blank CHECK (btrim(project_name) <> ''),
  CONSTRAINT blueprint_snapshots_blueprint_set_id_not_blank CHECK (btrim(blueprint_set_id) <> ''),
  CONSTRAINT blueprint_snapshots_storage_path_not_blank CHECK (btrim(storage_path) <> '')
);

COMMENT ON TABLE public.blueprint_snapshots IS
  'Private Blueprint Work Order snapshot metadata. Storage objects remain private and are served only through authorized signed URLs.';

COMMENT ON COLUMN public.blueprint_snapshots.deleted_at IS
  'Soft-delete marker for owner/admin library listing. Historical assignment attachments may still serve signed URLs.';

CREATE INDEX IF NOT EXISTS idx_blueprint_snapshots_org
  ON public.blueprint_snapshots (org_id);

CREATE INDEX IF NOT EXISTS idx_blueprint_snapshots_org_project
  ON public.blueprint_snapshots (org_id, project_id);

CREATE INDEX IF NOT EXISTS idx_blueprint_snapshots_org_blueprint_set
  ON public.blueprint_snapshots (org_id, blueprint_set_id);

CREATE INDEX IF NOT EXISTS idx_blueprint_snapshots_org_work_package
  ON public.blueprint_snapshots (org_id, work_package_id);

CREATE INDEX IF NOT EXISTS idx_blueprint_snapshots_live
  ON public.blueprint_snapshots (org_id, captured_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_blueprint_snapshots_captured_at
  ON public.blueprint_snapshots (captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_blueprint_snapshots_storage_path
  ON public.blueprint_snapshots (storage_path);

DROP TRIGGER IF EXISTS mdt_blueprint_snapshots ON public.blueprint_snapshots;
CREATE TRIGGER mdt_blueprint_snapshots
  BEFORE UPDATE ON public.blueprint_snapshots
  FOR EACH ROW EXECUTE FUNCTION moddatetime(updated_at);

ALTER TABLE public.employee_task_assignments
  ADD CONSTRAINT employee_task_assignments_org_id_id_key UNIQUE (org_id, id);

CREATE TABLE IF NOT EXISTS public.assignment_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL,
  snapshot_id UUID NOT NULL,
  attached_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  display_order INTEGER NOT NULL DEFAULT 0,
  caption_override TEXT,
  CONSTRAINT assignment_snapshots_display_order_check CHECK (display_order >= 0),
  CONSTRAINT assignment_snapshots_assignment_snapshot_key UNIQUE (assignment_id, snapshot_id),
  CONSTRAINT assignment_snapshots_assignment_org_fk
    FOREIGN KEY (org_id, assignment_id)
    REFERENCES public.employee_task_assignments(org_id, id)
    ON DELETE CASCADE,
  CONSTRAINT assignment_snapshots_snapshot_org_fk
    FOREIGN KEY (org_id, snapshot_id)
    REFERENCES public.blueprint_snapshots(org_id, id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.assignment_snapshots IS
  'Attachment table from immutable employee task assignments to private Blueprint snapshot metadata.';

CREATE INDEX IF NOT EXISTS idx_assignment_snapshots_assignment
  ON public.assignment_snapshots (assignment_id);

CREATE INDEX IF NOT EXISTS idx_assignment_snapshots_snapshot
  ON public.assignment_snapshots (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_assignment_snapshots_org
  ON public.assignment_snapshots (org_id);

CREATE INDEX IF NOT EXISTS idx_assignment_snapshots_assignment_order
  ON public.assignment_snapshots (assignment_id, display_order, attached_at, snapshot_id);

CREATE OR REPLACE FUNCTION public.enforce_assignment_snapshot_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  PERFORM 1
  FROM public.employee_task_assignments eta
  WHERE eta.org_id = NEW.org_id
    AND eta.id = NEW.assignment_id
  FOR UPDATE;

  SELECT COUNT(*)
  INTO v_count
  FROM public.assignment_snapshots ats
  WHERE ats.org_id = NEW.org_id
    AND ats.assignment_id = NEW.assignment_id
    AND (TG_OP = 'INSERT' OR ats.id <> NEW.id);

  IF v_count >= 8 THEN
    RAISE EXCEPTION 'A work order assignment cannot have more than 8 snapshots';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_assignment_snapshot_limit() IS
  'Concurrency-safe guard that rejects a ninth snapshot attachment for a single assignment.';

DROP TRIGGER IF EXISTS trg_assignment_snapshots_limit ON public.assignment_snapshots;
CREATE TRIGGER trg_assignment_snapshots_limit
  BEFORE INSERT OR UPDATE OF org_id, assignment_id ON public.assignment_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_snapshot_limit();

ALTER TABLE public.blueprint_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY blueprint_snapshots_owner_admin_select ON public.blueprint_snapshots
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

CREATE POLICY blueprint_snapshots_owner_admin_insert ON public.blueprint_snapshots
  FOR INSERT
  WITH CHECK (public.is_org_admin_for(org_id));

CREATE POLICY blueprint_snapshots_owner_admin_update ON public.blueprint_snapshots
  FOR UPDATE
  USING (public.is_org_admin_for(org_id))
  WITH CHECK (public.is_org_admin_for(org_id));

CREATE POLICY blueprint_snapshots_owner_admin_delete ON public.blueprint_snapshots
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

CREATE POLICY assignment_snapshots_owner_admin_select ON public.assignment_snapshots
  FOR SELECT
  USING (public.is_org_admin_for(org_id));

CREATE POLICY assignment_snapshots_owner_admin_insert ON public.assignment_snapshots
  FOR INSERT
  WITH CHECK (public.is_org_admin_for(org_id));

CREATE POLICY assignment_snapshots_owner_admin_update ON public.assignment_snapshots
  FOR UPDATE
  USING (public.is_org_admin_for(org_id))
  WITH CHECK (public.is_org_admin_for(org_id));

CREATE POLICY assignment_snapshots_owner_admin_delete ON public.assignment_snapshots
  FOR DELETE
  USING (public.is_org_admin_for(org_id));

DROP POLICY IF EXISTS blueprint_snapshots_objects_select_admin ON storage.objects;
DROP POLICY IF EXISTS blueprint_snapshots_objects_insert_admin ON storage.objects;
DROP POLICY IF EXISTS blueprint_snapshots_objects_update_admin ON storage.objects;
DROP POLICY IF EXISTS blueprint_snapshots_objects_delete_admin ON storage.objects;

CREATE POLICY blueprint_snapshots_objects_select_admin
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'blueprint-snapshots'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  AND CASE
    WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_org_admin_for(split_part(name, '/', 1)::uuid)
    ELSE false
  END
);

CREATE POLICY blueprint_snapshots_objects_insert_admin
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'blueprint-snapshots'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  AND CASE
    WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_org_admin_for(split_part(name, '/', 1)::uuid)
    ELSE false
  END
);

CREATE POLICY blueprint_snapshots_objects_update_admin
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'blueprint-snapshots'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  AND CASE
    WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_org_admin_for(split_part(name, '/', 1)::uuid)
    ELSE false
  END
)
WITH CHECK (
  bucket_id = 'blueprint-snapshots'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  AND CASE
    WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_org_admin_for(split_part(name, '/', 1)::uuid)
    ELSE false
  END
);

CREATE POLICY blueprint_snapshots_objects_delete_admin
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'blueprint-snapshots'
  AND name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+/[^/]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  AND CASE
    WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN public.is_org_admin_for(split_part(name, '/', 1)::uuid)
    ELSE false
  END
);

REVOKE ALL ON public.blueprint_snapshots FROM anon;
REVOKE ALL ON public.assignment_snapshots FROM anon;
REVOKE ALL ON FUNCTION public.enforce_assignment_snapshot_limit() FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_snapshots TO authenticated;

COMMIT;
