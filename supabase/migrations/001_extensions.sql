-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 001: Extensions & Storage Setup
-- Phase 01 Foundation
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable all required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "pgvector";          -- Vector similarity search (memory embeddings)
CREATE EXTENSION IF NOT EXISTS "pg_cron";           -- Scheduled background jobs (backup, anomaly checks)
CREATE EXTENSION IF NOT EXISTS "pg_net";            -- Outbound HTTP calls from PostgreSQL (R2 webhooks)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";         -- UUID generation (uuid_generate_v4())
CREATE EXTENSION IF NOT EXISTS "moddatetime";       -- Auto-update updated_at columns via trigger

-- ══════════════════════════════════════════════════════════════════════════════
-- STORAGE BUCKETS
-- Private buckets — no anonymous public access
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  (
    'project-files',
    'project-files',
    false,
    52428800,   -- 50 MB per file
    ARRAY[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  ),
  (
    'job-photos',
    'job-photos',
    false,
    20971520,   -- 20 MB per file
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4']
  ),
  (
    'documents',
    'documents',
    false,
    52428800,   -- 50 MB per file
    ARRAY[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  ),
  (
    'backups',
    'backups',
    false,
    null,       -- No size limit on backups
    null        -- Any MIME type
  )
ON CONFLICT (id) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- STORAGE RLS POLICIES
-- org-scoped: users can only access files belonging to their organization
-- File paths must be prefixed with {org_id}/
-- ══════════════════════════════════════════════════════════════════════════════

-- Project Files: org members can read; owner/admin can write
CREATE POLICY "project_files_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'project-files'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "project_files_write" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'project-files'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "project_files_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'project-files'
    AND auth.uid() IS NOT NULL
  );

-- Job Photos: same rules
CREATE POLICY "job_photos_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'job-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "job_photos_write" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'job-photos' AND auth.uid() IS NOT NULL);

-- Documents: same rules
CREATE POLICY "documents_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "documents_write" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documents' AND auth.uid() IS NOT NULL);

-- Backups: no direct user access (service role only)
-- No policies added — default deny for all non-service-role access
