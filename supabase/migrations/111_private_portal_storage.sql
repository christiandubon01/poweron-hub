-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 111: Private Portal Attachment Storage — SEC-0S (R2 + R3 Repair)
-- ════════════════════════════════════════════════════════════════════════════════
--
-- R3 repairs (second security audit):
--   B1/B2: Signed-read path grammar accepts canonical UUID filenames and
--          request-bound historical timestamp filenames; customer + owner both
--          parse FilePaths: and Files: through one host-bound normalizer.
--   B3: Signed-read uses official Storage createSignedUrl (slash-preserving).
--   B4: append_portal_request_files is retired and revoked from browser roles.
--   B5: Destination-organization ambiguity still aborts (unchanged; owner must
--       mark exactly one organizations.settings.public_portal_destination=true).
--
-- R1 repairs the following critical blockers found in the initial SEC-0S audit:
--
--   BLOCKER 1: Old permissive policies (portal_uploads_public_read,
--              portal_uploads_public_insert) were never dropped.  This migration
--              now explicitly drops them before making the bucket private.
--
--   BLOCKER 2: The initial implementation allowed browser-side createSignedUrl
--              by granting anon/authenticated SELECT on storage.objects.  The
--              R1 design removes all storage.objects policies for portal-uploads.
--              All signed read URLs are now issued server-side only by the
--              portal-attachment-read Netlify function (service-role key).
--
--   BLOCKER 3: portal_uploads_anon_read relied on portal_request_exists() which
--              only proved request UUID existence — not customer authorization.
--              This design is removed.  portal_request_exists() is not created.
--
--   BLOCKER 4: get_portal_request_status() no longer returns attachment_paths.
--              Raw storage paths are never sent to the browser.  The server
--              endpoint derives paths independently from the request row.
--
--   BLOCKER 5: Owner/admin access is no longer a direct Storage SELECT policy.
--              It goes through portal-attachment-read (JWT verified + role check).
--
-- SECURITY MODEL (SEC-0S R1):
--   - Bucket public = false: permanent public URLs are invalid
--   - All signed upload URLs: issued by portal-upload-authorize (service role)
--   - All signed read URLs: issued by portal-attachment-read (service role)
--   - Browser never calls createSignedUrl / createSignedUrls / getPublicUrl
--   - Anon role: no direct Storage SELECT, INSERT, UPDATE, DELETE
--   - Authenticated (including ordinary employees): no direct Storage access
--   - Owner/admin: access through portal-attachment-read after JWT+role check
--   - Service-role operations bypass RLS (Supabase default)
--
-- ORGANIZATION BINDING (SEC-0S R2):
--   portal_requests.organization_id is the authoritative organization boundary.
--   It references public.organizations(id), is NOT NULL, and is assigned only
--   from the singleton server-side portal_request_configuration row.
--   Historical rows are backfilled only when exactly one destination can be
--   identified: one organization explicitly marked in organizations.settings
--   with public_portal_destination=true, or (as a safe fallback) exactly one
--   organization in the database. Zero/multiple candidates abort the migration.
--   Owner/admin RLS and the attachment-context RPC require exact equality with
--   public.user_org_id() plus public.is_org_admin_for(organization_id).
--
-- UPLOAD AUTHORIZATION BINDING (portal_upload_authorizations table):
--   When portal-upload-authorize generates signed upload URLs, it records
--   the exact authorized paths in portal_upload_authorizations.  The
--   register_portal_attachments RPC verifies that every submitted path
--   appears in a valid, unconsumed authorization record for this request.
--   This ensures finalization can only register paths actually issued by
--   the server — not arbitrary client-supplied paths.
--
-- OTHER HARDENING IN THIS MIGRATION:
--   - register_portal_attachments now verifies object existence in
--     storage.objects and checks stored MIME/size.
--   - get_portal_request_status returns no attachment paths (server endpoint
--     derives them independently).
--   - Postconditions prove: old policies absent, no new anon/authenticated
--     SELECT, RPCs intact, SEC-0R invariants preserved.
--
-- Does NOT execute any migration.
-- Does NOT deploy any Netlify function.
-- Does NOT modify migrations 107–110.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Authoritative Portal request organization identity ────────────────────

CREATE TABLE IF NOT EXISTS public.portal_request_configuration (
  singleton       BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  organization_id UUID NOT NULL UNIQUE
                  REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portal_request_configuration IS
  'SEC-0S R2 singleton server configuration selecting the canonical destination '
  'organization for anonymous Portal request submissions.';

ALTER TABLE public.portal_request_configuration ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.portal_request_configuration FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.portal_request_configuration FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.portal_request_configuration FROM authenticated;

DO $$
DECLARE
  v_destination UUID;
  v_count       INTEGER;
BEGIN
  -- Postgres 17 has no min(uuid); use ordered array_agg for a deterministic pick.
  SELECT count(*), (array_agg(id ORDER BY id))[1]
  INTO v_count, v_destination
  FROM public.organizations
  WHERE settings->>'public_portal_destination' = 'true';

  IF v_count = 0 THEN
    SELECT count(*), (array_agg(id ORDER BY id))[1]
    INTO v_count, v_destination
    FROM public.organizations;
  END IF;

  IF v_count <> 1 OR v_destination IS NULL THEN
    RAISE EXCEPTION
      'SEC-0S R2 cannot choose a Portal destination organization safely: '
      'expected exactly one configured candidate, found %. Mark exactly one '
      'organizations.settings.public_portal_destination=true before applying migration 111',
      v_count;
  END IF;

  INSERT INTO public.portal_request_configuration (singleton, organization_id)
  VALUES (true, v_destination)
  ON CONFLICT (singleton) DO UPDATE
  SET organization_id = EXCLUDED.organization_id,
      updated_at = now();
END $$;

ALTER TABLE public.portal_requests
  ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.portal_requests pr
SET organization_id = cfg.organization_id
FROM public.portal_request_configuration cfg
WHERE cfg.singleton = true
  AND pr.organization_id IS NULL;

ALTER TABLE public.portal_requests
  DROP CONSTRAINT IF EXISTS portal_requests_organization_id_fkey;

ALTER TABLE public.portal_requests
  ADD CONSTRAINT portal_requests_organization_id_fkey
  FOREIGN KEY (organization_id)
  REFERENCES public.organizations(id)
  ON DELETE RESTRICT;

ALTER TABLE public.portal_requests
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_portal_requests_organization_id
  ON public.portal_requests (organization_id);

COMMENT ON COLUMN public.portal_requests.organization_id IS
  'SEC-0S R2 canonical organization boundary. Server-assigned on public submit; '
  'never accepted from Portal clients.';

-- Replace the role-only policies from migration 107 with organization-bound
-- policies. A global owner/admin role is not an organization boundary.
DROP POLICY IF EXISTS portal_requests_owner_admin_select ON public.portal_requests;
DROP POLICY IF EXISTS portal_requests_owner_admin_update ON public.portal_requests;

CREATE POLICY portal_requests_owner_admin_select
  ON public.portal_requests
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

CREATE POLICY portal_requests_owner_admin_update
  ON public.portal_requests
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

-- Child Portal data keeps its existing customer-read behavior, but authenticated
-- writes are restricted to owner/admin of the parent request organization.
DROP POLICY IF EXISTS "job_timeline_auth_write" ON public.job_timeline;
CREATE POLICY job_timeline_owner_admin_write
  ON public.job_timeline
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.portal_requests pr
      WHERE pr.id = job_timeline.portal_request_id
        AND pr.organization_id = public.user_org_id()
        AND public.is_org_admin_for(pr.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.portal_requests pr
      WHERE pr.id = job_timeline.portal_request_id
        AND pr.organization_id = public.user_org_id()
        AND public.is_org_admin_for(pr.organization_id)
    )
  );

DROP POLICY IF EXISTS "technician_location_auth_write" ON public.technician_location;
CREATE POLICY technician_location_owner_admin_write
  ON public.technician_location
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.portal_requests pr
      WHERE pr.id = technician_location.portal_request_id
        AND pr.organization_id = public.user_org_id()
        AND public.is_org_admin_for(pr.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.portal_requests pr
      WHERE pr.id = technician_location.portal_request_id
        AND pr.organization_id = public.user_org_id()
        AND public.is_org_admin_for(pr.organization_id)
    )
  );

-- ── 2. Public submission assigns organization from server configuration ──────

CREATE OR REPLACE FUNCTION public.submit_portal_request(
  p_name              TEXT,
  p_phone             TEXT    DEFAULT NULL,
  p_email             TEXT    DEFAULT NULL,
  p_address           TEXT    DEFAULT NULL,
  p_city               TEXT    DEFAULT NULL,
  p_request_type      TEXT    DEFAULT 'homeowner',
  p_service_category  TEXT    DEFAULT NULL,
  p_description       TEXT    DEFAULT NULL,
  p_preferred_date    DATE    DEFAULT NULL,
  p_preferred_time    TEXT    DEFAULT NULL,
  p_notes             TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id               UUID;
  v_organization_id  UUID;
  v_raw_token        TEXT;
  v_token_hash       TEXT;
  v_valid_categories CONSTANT TEXT[] := ARRAY[
    'residential', 'commercial', 'solar', 'maintenance',
    'panel_upgrade', 'ev_charger', 'other'
  ];
  v_valid_types CONSTANT TEXT[] := ARRAY['homeowner', 'gc', 'sub'];
BEGIN
  SELECT organization_id
  INTO v_organization_id
  FROM public.portal_request_configuration
  WHERE singleton = true;

  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Portal destination organization is not configured';
  END IF;

  IF trim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;
  IF trim(coalesce(p_phone, '')) = '' AND trim(coalesce(p_email, '')) = '' THEN
    RAISE EXCEPTION 'phone or email is required';
  END IF;
  IF p_service_category IS NOT NULL
     AND trim(p_service_category) != ''
     AND NOT (trim(p_service_category) = ANY(v_valid_categories)) THEN
    RAISE EXCEPTION 'invalid service_category: %', p_service_category;
  END IF;
  IF p_request_type IS NOT NULL
     AND trim(p_request_type) != ''
     AND NOT (trim(p_request_type) = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'invalid request_type: %', p_request_type;
  END IF;

  IF char_length(coalesce(p_name, ''))           > 200   THEN RAISE EXCEPTION 'name too long (max 200)'; END IF;
  IF char_length(coalesce(p_phone, ''))          > 30    THEN RAISE EXCEPTION 'phone too long (max 30)'; END IF;
  IF char_length(coalesce(p_email, ''))          > 320   THEN RAISE EXCEPTION 'email too long (max 320)'; END IF;
  IF char_length(coalesce(p_address, ''))        > 500   THEN RAISE EXCEPTION 'address too long (max 500)'; END IF;
  IF char_length(coalesce(p_city, ''))           > 200   THEN RAISE EXCEPTION 'city too long (max 200)'; END IF;
  IF char_length(coalesce(p_description, ''))    > 5000  THEN RAISE EXCEPTION 'description too long (max 5000)'; END IF;
  IF char_length(coalesce(p_preferred_time, '')) > 200   THEN RAISE EXCEPTION 'preferred_time too long (max 200)'; END IF;
  IF char_length(coalesce(p_notes, ''))          > 10000 THEN RAISE EXCEPTION 'notes too long (max 10000)'; END IF;

  v_raw_token  := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token::bytea, 'sha256'), 'hex');

  INSERT INTO public.portal_requests (
    organization_id,
    name, phone, email, address, city, request_type, service_category,
    description, preferred_date, preferred_time, notes,
    status, source, created_at, attach_token_hash
  ) VALUES (
    v_organization_id,
    trim(p_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_city, '')), ''),
    coalesce(nullif(trim(coalesce(p_request_type, '')), ''), 'homeowner'),
    nullif(trim(coalesce(p_service_category, '')), ''),
    nullif(trim(coalesce(p_description, '')), ''),
    p_preferred_date,
    nullif(trim(coalesce(p_preferred_time, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    'new', 'customer_portal', now(), v_token_hash
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'request_id', v_id::text,
    'attach_token', v_raw_token
  );
END;
$$;

COMMENT ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) IS
  'SEC-0S R2 public submission RPC. Assigns organization_id exclusively from '
  'the singleton server-side Portal configuration; no organization parameter is '
  'accepted. Preserves the SEC-0R one-time attachment capability.';

REVOKE ALL ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) TO authenticated;

-- Authenticated owner/admin attachment context. The caller identity comes from
-- the JWT's auth.uid(); organization and authority come from canonical helpers.
-- Missing, cross-org, role-only, and ordinary-employee requests all return zero
-- rows, so callers cannot distinguish request existence.
CREATE OR REPLACE FUNCTION public.get_portal_attachment_context(p_id UUID)
RETURNS TABLE (
  request_id              UUID,
  caller_organization_id  UUID,
  request_organization_id UUID,
  notes                   TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pr.id,
    public.user_org_id(),
    pr.organization_id,
    pr.notes
  FROM public.portal_requests pr
  WHERE pr.id = p_id
    AND public.user_org_id() IS NOT NULL
    AND pr.organization_id = public.user_org_id()
    AND public.is_org_admin_for(pr.organization_id);
$$;

COMMENT ON FUNCTION public.get_portal_attachment_context(UUID) IS
  'SEC-0S R2 owner/admin attachment authorization. Returns context only when '
  'the verified JWT caller is canonical owner/admin of the exact request org.';

REVOKE ALL ON FUNCTION public.get_portal_attachment_context(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_portal_attachment_context(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_portal_attachment_context(UUID) TO authenticated;

-- ── 3. DROP old permissive policies (created via Supabase dashboard) ──────────
-- These policies exist on the live database and have never been dropped by any
-- migration.  They must be removed before the bucket becomes private.
-- IF EXISTS is required because local dev databases may not have them.

DROP POLICY IF EXISTS "portal_uploads_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "portal_uploads_public_insert" ON storage.objects;

-- Drop any policies from the initial (blocked) SEC-0S implementation:
DROP POLICY IF EXISTS "portal_uploads_anon_read"   ON storage.objects;
DROP POLICY IF EXISTS "portal_uploads_owner_read"  ON storage.objects;

-- ── 4. Make portal-uploads bucket private ────────────────────────────────────
-- public = false means no object is readable via permanent public URL.
-- file_size_limit and allowed_mime_types mirror the server contract exactly.

UPDATE storage.buckets
SET
  public             = false,
  file_size_limit    = 268435456,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/x-mov',
    'application/pdf'
  ]
WHERE id = 'portal-uploads';

-- ── 5. NO storage.objects policies for portal-uploads ────────────────────────
--
-- All browser access to portal-uploads is DENIED at the policy layer.
--
-- Signed upload URLs and signed read URLs bypass RLS at the storage layer
-- (they carry their own cryptographic authorization).  No SELECT, INSERT,
-- UPDATE, or DELETE policy is needed or created for anon / authenticated.
--
-- Service-role operations in server functions bypass RLS by default.
--
-- This section is intentionally empty to document the architectural choice.

-- ── 6. portal_upload_authorizations table ────────────────────────────────────
--
-- Records each batch of server-authorized upload paths.  Used by
-- register_portal_attachments to verify that submitted paths were actually
-- issued by portal-upload-authorize (not client-fabricated).
--
-- Lifecycle:
--   1. portal-upload-authorize inserts a row with paths[] and expires_at
--   2. register_portal_attachments checks that all submitted paths are
--      contained in an unconsumed row for this request
--   3. On success, consumed_at is stamped (one-time use)
--   4. Failed/abandoned uploads leave an unconsumed row; paths expire after
--      30 minutes with no further effect (orphan risk is bounded)

CREATE TABLE IF NOT EXISTS public.portal_upload_authorizations (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID         NOT NULL REFERENCES public.portal_requests(id) ON DELETE CASCADE,
  paths       TEXT[]       NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.portal_upload_authorizations IS
  'SEC-0S R1: Server-issued upload authorization records. Each row binds a set '
  'of server-generated storage paths to a specific portal request. '
  'register_portal_attachments verifies every submitted path appears here '
  'before finalizing attachment registration.';

-- Anon and authenticated cannot read or write this table.
-- Service-role key (used in Netlify functions) and SECURITY DEFINER functions
-- bypass RLS without requiring explicit policies.
ALTER TABLE public.portal_upload_authorizations ENABLE ROW LEVEL SECURITY;
-- (No policies created — deny-all for anon/authenticated)
REVOKE ALL PRIVILEGES ON TABLE public.portal_upload_authorizations FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.portal_upload_authorizations FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.portal_upload_authorizations FROM authenticated;

-- ── 7. register_portal_attachments RPC ───────────────────────────────────────
--
-- Replaces getPublicUrl + append_portal_request_files for new signed-upload
-- flow.  R1 adds:
--   - Authorization table binding (paths must be server-issued)
--   - Storage object existence check
--   - MIME and size verification from storage metadata
--
-- Path contract (unchanged from initial SEC-0S):
--   {request_id_uuid}/{uuid}.{2-5 char ext}
--
-- Stored in notes as:  "FilePaths: path1, path2"
--
-- SEC-0S R3: append_portal_request_files is retired after register_portal_attachments
-- is defined (see section 7b). New uploads must use the authorization-bound path.

CREATE OR REPLACE FUNCTION public.register_portal_attachments(
  p_id            UUID,
  p_paths         TEXT[],
  p_attach_token  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_existing_notes TEXT;
  v_new_notes      TEXT;
  v_provided_hash  TEXT;
  v_path           TEXT;
  v_paths_suffix   TEXT;
  v_obj_mime       TEXT;
  v_obj_size       BIGINT;
BEGIN
  -- Guard: paths array must be non-null and non-empty
  IF p_paths IS NULL OR array_length(p_paths, 1) IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Guard: count limit (belt-and-suspenders; also enforced at authorize time)
  IF array_length(p_paths, 1) > 10 THEN
    RAISE EXCEPTION 'too many attachments (max 10)';
  END IF;

  -- Guard: token format
  IF trim(coalesce(p_attach_token, '')) = '' THEN
    RETURN FALSE;
  END IF;
  IF char_length(p_attach_token) != 64 THEN
    RETURN FALSE;
  END IF;

  -- Validate each path format before any DB lookups
  FOREACH v_path IN ARRAY p_paths LOOP
    v_path := trim(v_path);

    IF char_length(v_path) > 500 THEN
      RAISE EXCEPTION 'attachment path too long (max 500 chars)';
    END IF;
    IF v_path LIKE '%..%' OR v_path LIKE '/%' OR v_path LIKE '\%' THEN
      RAISE EXCEPTION 'invalid attachment path: traversal or absolute path';
    END IF;
    IF NOT (v_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$') THEN
      RAISE EXCEPTION 'attachment path does not match expected format (uuid/uuid.ext)';
    END IF;
    IF split_part(v_path, '/', 1) != p_id::text THEN
      RAISE EXCEPTION 'attachment path first segment does not match request id';
    END IF;
  END LOOP;

  -- Compute SHA-256 hash of the provided token
  v_provided_hash := encode(extensions.digest(p_attach_token::bytea, 'sha256'), 'hex');

  -- Lock and validate the portal request atomically
  SELECT notes INTO v_existing_notes
  FROM   public.portal_requests
  WHERE  id               = p_id
    AND  status           = 'new'
    AND  hunter_lead_id   IS NULL
    AND  created_at      >= now() - INTERVAL '30 minutes'
    AND  attach_token_hash = v_provided_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Verify submitted paths against a valid server-issued authorization record.
  -- Every path submitted by the client must appear in an unconsumed authorization
  -- for this request (p_paths <@ authorization.paths).
  -- This rejects paths not issued by portal-upload-authorize.
  IF NOT EXISTS (
    SELECT 1
    FROM   public.portal_upload_authorizations
    WHERE  request_id    = p_id
      AND  paths         @> p_paths   -- authorization covers all submitted paths
      AND  expires_at    > now()
      AND  consumed_at   IS NULL
  ) THEN
    RAISE EXCEPTION 'submitted paths are not covered by a valid server-issued upload authorization';
  END IF;

  -- Verify each object exists in storage and validate MIME/size
  FOREACH v_path IN ARRAY p_paths LOOP
    v_path := trim(v_path);

    SELECT
      metadata->>'mimetype',
      (metadata->>'size')::bigint
    INTO v_obj_mime, v_obj_size
    FROM storage.objects
    WHERE bucket_id = 'portal-uploads' AND name = v_path;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'attachment object not found in storage';
    END IF;

    -- Size validation (belt-and-suspenders: bucket limit already enforces 256 MB)
    IF v_obj_size IS NOT NULL AND v_obj_size > 268435456 THEN
      RAISE EXCEPTION 'attachment exceeds maximum allowed size (256 MB)';
    END IF;
    IF v_obj_size IS NOT NULL AND v_obj_size = 0 THEN
      RAISE EXCEPTION 'attachment is empty (zero bytes not permitted)';
    END IF;

    -- MIME validation where metadata is available
    IF v_obj_mime IS NOT NULL AND v_obj_mime NOT IN (
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'image/webp', 'image/heic', 'image/heif',
      'video/mp4', 'video/quicktime', 'video/x-mov',
      'application/pdf'
    ) THEN
      RAISE EXCEPTION 'attachment MIME type not permitted: %', v_obj_mime;
    END IF;
  END LOOP;

  -- Consume the upload authorization (one-time use per request)
  UPDATE public.portal_upload_authorizations
  SET consumed_at = now()
  WHERE request_id  = p_id
    AND paths       @> p_paths
    AND expires_at  > now()
    AND consumed_at IS NULL;

  -- Build the paths suffix and store in notes
  v_paths_suffix := 'FilePaths: ' || array_to_string(p_paths, ', ');
  v_new_notes := CASE
    WHEN v_existing_notes IS NULL OR v_existing_notes = ''
    THEN v_paths_suffix
    ELSE v_existing_notes || ' | ' || v_paths_suffix
  END;

  -- Write notes and consume the one-time capability
  UPDATE public.portal_requests
  SET notes             = v_new_notes,
      attach_token_hash = NULL       -- one-time use; invalidates re-registration
  WHERE id = p_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.register_portal_attachments(UUID, TEXT[], TEXT) IS
  'SEC-0S R1: Registers private storage attachment paths for a portal request. '
  'Validates: token, path format, request ownership, server-issued authorization, '
  'object existence, MIME type, and size. Consumes the one-time attach_token and '
  'the upload authorization record. Stores paths as "FilePaths: ..." in notes. '
  'Replaces the public-URL approach of append_portal_request_files.';

REVOKE ALL   ON FUNCTION public.register_portal_attachments(UUID, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_portal_attachments(UUID, TEXT[], TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.register_portal_attachments(UUID, TEXT[], TEXT) TO authenticated;

-- ── 7b. Retire append_portal_request_files (SEC-0S R3) ────────────────────────
-- The legacy RPC accepted arbitrary https://…/portal-uploads/… metadata without
-- upload-authorization binding or object verification. Active frontend callers
-- use register_portal_attachments exclusively. Replace the body with a hard
-- refusal and revoke all browser-role EXECUTE grants. No insecure overload may
-- remain callable by PUBLIC/anon/authenticated.

CREATE OR REPLACE FUNCTION public.append_portal_request_files(
  p_id            UUID,
  p_notes_suffix  TEXT,
  p_attach_token  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'append_portal_request_files is retired; use register_portal_attachments';
END;
$$;

COMMENT ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) IS
  'SEC-0S R3: Retired. Formerly appended public-URL attachment metadata. '
  'Always raises. Use register_portal_attachments with server-issued paths.';

REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM authenticated;

-- ── 8. Update get_portal_request_status — remove attachment_paths ─────────────
--
-- SEC-0S R1: attachment_paths is no longer returned to the browser.
-- Raw storage paths must never reach the client.  The portal-attachment-read
-- server endpoint loads the request row independently using the service-role
-- key, extracts paths, and issues signed read URLs.
--
-- The function reverts to the same 10-field shape as before SEC-0S, plus the
-- secure new-format path without exposing notes.

CREATE OR REPLACE FUNCTION public.get_portal_request_status(
  p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.portal_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.portal_requests
  WHERE id = p_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Return only customer-safe fields.
  -- Notes, attachment paths, hunter_lead_id, review_*, source, submitted_ip,
  -- and attach_token_hash are deliberately excluded.
  -- Attachment access requires the server-side portal-attachment-read endpoint.
  RETURN jsonb_build_object(
    'id',               v_row.id::text,
    'name',             v_row.name,
    'service_category', v_row.service_category,
    'description',      v_row.description,
    'address',          v_row.address,
    'city',             v_row.city,
    'preferred_date',   v_row.preferred_date,
    'preferred_time',   v_row.preferred_time,
    'status',           v_row.status,
    'created_at',       v_row.created_at
  );
END;
$$;

COMMENT ON FUNCTION public.get_portal_request_status(UUID) IS
  'SEC-0S R1: Customer tracking read. Returns 10 customer-safe fields. '
  'Deliberately excludes notes, attachment paths, and all internal fields. '
  'Attachment signed-read access is handled by portal-attachment-read (server-side).';

REVOKE ALL   ON FUNCTION public.get_portal_request_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_request_status(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_request_status(UUID) TO authenticated;

-- ── 9. Postcondition assertions ───────────────────────────────────────────────
-- All checks run inside this transaction.  Any failure rolls back entirely.

DO $$
DECLARE
  v_public_flag BOOLEAN;
  v_fn_count    INTEGER;
  v_pol_count   INTEGER;
BEGIN

  -- A. Portal request organization identity is constrained and populated
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portal_requests'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
      AND udt_name = 'uuid'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_requests.organization_id is not UUID NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.portal_requests WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: a portal request lacks organization identity';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'portal_requests'
      AND c.conname = 'portal_requests_organization_id_fkey'
      AND c.contype = 'f'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_requests organization foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'portal_requests'
      AND indexname = 'idx_portal_requests_organization_id'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_requests organization index is missing';
  END IF;

  SELECT count(*) INTO v_fn_count
  FROM public.portal_request_configuration
  WHERE singleton = true;

  IF v_fn_count <> 1 THEN
    RAISE EXCEPTION
      'postcondition failed: expected exactly one Portal destination configuration, found %',
      v_fn_count;
  END IF;

  -- B. portal-uploads bucket must now be private
  SELECT public INTO v_public_flag
  FROM   storage.buckets
  WHERE  id = 'portal-uploads';

  IF v_public_flag IS TRUE OR v_public_flag IS NULL THEN
    RAISE EXCEPTION
      'postcondition failed: portal-uploads bucket is not private (public = %)', v_public_flag;
  END IF;

  -- C. Old permissive public_read policy must not exist
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'storage' AND tablename = 'objects'
      AND  policyname = 'portal_uploads_public_read'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_uploads_public_read still exists — drop was ineffective';
  END IF;

  -- D. Old permissive public_insert policy must not exist
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'storage' AND tablename = 'objects'
      AND  policyname = 'portal_uploads_public_insert'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_uploads_public_insert still exists — drop was ineffective';
  END IF;

  -- E. No existence-only anon SELECT policy on portal-uploads
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'storage' AND tablename = 'objects'
      AND  policyname = 'portal_uploads_anon_read'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_uploads_anon_read should not exist in R1 architecture';
  END IF;

  -- F. No authenticated SELECT policy on portal-uploads
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'storage' AND tablename = 'objects'
      AND  policyname = 'portal_uploads_owner_read'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_uploads_owner_read should not exist in R1 architecture';
  END IF;

  -- F2. No remaining Storage policy may reference portal-uploads for browser roles
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') ILIKE '%portal-uploads%'
        OR coalesce(with_check, '') ILIKE '%portal-uploads%'
        OR policyname ILIKE '%portal_uploads%'
        OR policyname ILIKE '%portal-uploads%'
      )
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: a Storage policy still references portal-uploads';
  END IF;

  -- G. register_portal_attachments function exists and is SECURITY DEFINER
  SELECT count(*) INTO v_fn_count
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'register_portal_attachments'
    AND  p.prosecdef = true;

  IF v_fn_count < 1 THEN
    RAISE EXCEPTION
      'postcondition failed: register_portal_attachments SECURITY DEFINER function missing';
  END IF;

  -- H. get_portal_request_status still exists and is SECURITY DEFINER
  SELECT count(*) INTO v_fn_count
  FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE  n.nspname = 'public' AND p.proname = 'get_portal_request_status'
    AND  p.prosecdef = true;

  IF v_fn_count < 1 THEN
    RAISE EXCEPTION
      'postcondition failed: get_portal_request_status SECURITY DEFINER function missing';
  END IF;

  -- I. portal_upload_authorizations table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE  table_schema = 'public'
      AND  table_name   = 'portal_upload_authorizations'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_upload_authorizations table missing';
  END IF;

  -- J. Portal request policies are organization-bound
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public' AND tablename = 'portal_requests'
      AND  policyname = 'portal_requests_owner_admin_select'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_requests_owner_admin_select is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE  schemaname = 'public' AND tablename = 'portal_requests'
      AND  policyname = 'portal_requests_owner_admin_update'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: portal_requests_owner_admin_update is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'portal_requests'
      AND policyname IN (
        'portal_requests_owner_admin_select',
        'portal_requests_owner_admin_update'
      )
      AND (
        coalesce(qual, '') NOT LIKE '%organization_id%'
        OR coalesce(qual, '') NOT LIKE '%user_org_id%'
        OR coalesce(qual, '') NOT LIKE '%is_org_admin_for%'
      )
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: a Portal owner/admin policy is not organization-bound';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'portal_requests'
      AND policyname = 'portal_requests_owner_admin_update'
      AND (
        coalesce(with_check, '') NOT LIKE '%organization_id%'
        OR coalesce(with_check, '') NOT LIKE '%user_org_id%'
        OR coalesce(with_check, '') NOT LIKE '%is_org_admin_for%'
      )
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: Portal update WITH CHECK is not organization-bound';
  END IF;

  -- K. Exactly 2 portal_requests policies
  SELECT count(*) INTO v_pol_count
  FROM   pg_policies
  WHERE  schemaname = 'public' AND tablename = 'portal_requests';

  IF v_pol_count <> 2 THEN
    RAISE EXCEPTION
      'postcondition failed: expected 2 portal_requests policies, found %', v_pol_count;
  END IF;

  -- L. Submission, attachment-context, and legacy append RPCs exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND p.proname = 'submit_portal_request'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: submit_portal_request was unexpectedly removed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_portal_attachment_context'
      AND p.prosecdef = true
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: get_portal_attachment_context SECURITY DEFINER RPC missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND p.proname = 'append_portal_request_files'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: append_portal_request_files was unexpectedly removed';
  END IF;

  -- L2. Exactly one append_portal_request_files overload, and it is retired
  SELECT count(*) INTO v_fn_count
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'append_portal_request_files';

  IF v_fn_count <> 1 THEN
    RAISE EXCEPTION
      'postcondition failed: expected 1 append_portal_request_files overload, found %',
      v_fn_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'append_portal_request_files'
      AND pg_get_function_identity_arguments(p.oid) =
        'p_id uuid, p_notes_suffix text, p_attach_token text'
      AND p.prosecdef = true
      AND pg_get_functiondef(p.oid) ILIKE '%is retired; use register_portal_attachments%'
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: append_portal_request_files is not the retired SEC-0S R3 stub';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'append_portal_request_files'
      AND (
        has_function_privilege('public', p.oid, 'EXECUTE')
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: append_portal_request_files remains executable by a browser role';
  END IF;

  -- L3. portal_upload_authorizations denies browser-table privileges
  IF has_table_privilege('anon', 'public.portal_upload_authorizations', 'SELECT')
     OR has_table_privilege('anon', 'public.portal_upload_authorizations', 'INSERT')
     OR has_table_privilege('anon', 'public.portal_upload_authorizations', 'UPDATE')
     OR has_table_privilege('anon', 'public.portal_upload_authorizations', 'DELETE')
     OR has_table_privilege('authenticated', 'public.portal_upload_authorizations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.portal_upload_authorizations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.portal_upload_authorizations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.portal_upload_authorizations', 'DELETE')
  THEN
    RAISE EXCEPTION
      'postcondition failed: portal_upload_authorizations remains accessible to browser roles';
  END IF;

  -- M. anon and authenticated have EXECUTE on register_portal_attachments
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND p.proname = 'register_portal_attachments'
      AND  has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: anon missing EXECUTE on register_portal_attachments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public' AND p.proname = 'register_portal_attachments'
      AND  has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated missing EXECUTE on register_portal_attachments';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_portal_attachment_context'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: anon can execute get_portal_attachment_context';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_portal_attachment_context'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION
      'postcondition failed: authenticated missing get_portal_attachment_context EXECUTE';
  END IF;

END $$;

COMMIT;
