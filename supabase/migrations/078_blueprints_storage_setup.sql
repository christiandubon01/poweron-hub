-- ============================================================================
-- Migration 078 — Reproducible Blueprint Storage Setup
-- Ensures the private `blueprints` bucket and org-scoped storage.objects RLS
-- policies exist in every environment.
-- ============================================================================

-- Create/update bucket with required limits and MIME type.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'blueprints',
  'blueprints',
  false,
  536870912, -- 512 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Ensure RLS is active on storage.objects (safe if already enabled).
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Idempotent policy recreation.
DROP POLICY IF EXISTS blueprints_select_by_org ON storage.objects;
DROP POLICY IF EXISTS blueprints_insert_by_org ON storage.objects;
DROP POLICY IF EXISTS blueprints_update_by_org ON storage.objects;
DROP POLICY IF EXISTS blueprints_delete_by_org ON storage.objects;

-- Path convention:
--   {org_id}/{project_id}/blueprints/{file}
-- The first path segment must match the authenticated user's profile.org_id.
CREATE POLICY blueprints_select_by_org
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'blueprints'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.org_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY blueprints_insert_by_org
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'blueprints'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.org_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY blueprints_update_by_org
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'blueprints'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.org_id::text = split_part(name, '/', 1)
  )
)
WITH CHECK (
  bucket_id = 'blueprints'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.org_id::text = split_part(name, '/', 1)
  )
);

CREATE POLICY blueprints_delete_by_org
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'blueprints'
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.org_id::text = split_part(name, '/', 1)
  )
);
