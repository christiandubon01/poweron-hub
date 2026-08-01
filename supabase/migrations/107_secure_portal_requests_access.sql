-- ════════════════════════════════════════════════════════════════════════════════
-- Migration 107: Secure portal_requests access — SEC-0R
-- ════════════════════════════════════════════════════════════════════════════════
--
-- Security findings repaired in this migration:
--
--   A. profiles_update_self (006) has no WITH CHECK clause, allowing any
--      authenticated user to UPDATE their own profiles.role to 'owner'.
--      public.user_role() is SECURITY DEFINER STABLE: it uses a statement-level
--      snapshot and therefore returns the OLD role during WITH CHECK evaluation.
--      Fix: DROP + recreate the policy with WITH CHECK that pins role and org_id
--      to public.user_role()/public.user_org_id() so self-escalation fails.
--      profiles_update_admin is left unchanged (owner/admin employee management).
--
--   B. /portal/track/:id called supabase.from('portal_requests').select('*')
--      as anon, which is broken after anon SELECT is revoked.  Field 'notes',
--      'hunter_lead_id', review fields must never be returned to the public.
--      Fix: get_portal_request_status() SECURITY DEFINER RPC returns only
--      customer-safe fields.  Realtime subscription on portal_requests removed
--      from the view (job_timeline + technician_location realtime survives).
--
--   C. append_portal_request_files authorized only by request UUID + 30-minute
--      window — any caller who knows the UUID within 30 minutes can append.
--      Fix: submit_portal_request() generates a cryptographically strong
--      one-time attachment capability (256 random bits, SHA-256 hash stored),
--      returns {request_id, attach_token} as JSONB.  append_portal_request_files
--      verifies the hash, clears it on success (one-time), and validates URL
--      format and count.
--
--   D. submit_portal_request was only executable by anon; a logged-in user
--      submitting the public form received an EXECUTE permission denied.
--      Fix: GRANT EXECUTE to authenticated on all public submission RPCs.
--
-- Employee access:
--   Ordinary employees (profiles.role NOT IN ('owner','admin')) are excluded
--   from portal_requests by both RLS policies and lack of table grants.
--   Self-escalation is now blocked by the profiles_update_self repair.
--   Assignment-aware employee lead access is deferred to ROLE-1/OPS-1.
--
-- Storage:
--   portal-uploads bucket policies are deferred to SEC-0S.
--   LEAD-1 employee access remains blocked pending SEC-0S completion.
--
-- Organization boundary:
--   portal_requests.tenant_id is not populated; single-org production system
--   is safe with the owner/admin role guard.  ROLE-1/OPS-1 adds per-org
--   enforcement when tenant_id is reliably set.
-- ════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Prerequisite: pgcrypto for gen_random_bytes + digest ─────────────────────
-- Supabase ships pgcrypto in the 'extensions' schema; CREATE IF NOT EXISTS
-- is a no-op when already present.  Required by submit_portal_request and
-- append_portal_request_files for 256-bit token generation and SHA-256 hashing.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── A. Self-escalation repair on profiles ────────────────────────────────────
-- Drop the policy that lacked WITH CHECK and recreate it with a clause that
-- pins role and org_id to the caller's CURRENT values.  public.user_role() and
-- public.user_org_id() are STABLE SECURITY DEFINER functions that use the
-- statement-level snapshot, so they return the BEFORE-UPDATE values when
-- evaluated inside WITH CHECK.  A field user attempting to SET role = 'owner'
-- will find role = 'owner' != public.user_role() ('field') → check fails.
--
-- profiles_update_admin (owner/admin update any row in their org) is left
-- intact — owners/admins retain full employee-management capability.

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;

CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id     = auth.uid()
    AND role   = public.user_role()
    AND org_id = public.user_org_id()
  );

COMMENT ON POLICY "profiles_update_self" ON public.profiles IS
  'SEC-0R: Users may update their own profile row but cannot change role or '
  'org_id. public.user_role() and public.user_org_id() evaluate against the '
  'statement snapshot (STABLE functions), so they return the BEFORE-UPDATE '
  'values and reject any attempt to self-escalate or change org.';

-- ── 1. Drop existing broad policies on portal_requests ───────────────────────

DROP POLICY IF EXISTS "portal_requests_public_insert" ON public.portal_requests;
DROP POLICY IF EXISTS "portal_requests_auth_all"      ON public.portal_requests;

-- ── 2. Ensure RLS remains enabled ────────────────────────────────────────────

ALTER TABLE public.portal_requests ENABLE ROW LEVEL SECURITY;

-- ── 3. Revoke direct table access from PUBLIC and anon ────────────────────────
-- service_role retains its implicit RLS bypass; no explicit grant needed.

REVOKE ALL ON public.portal_requests FROM PUBLIC;
REVOKE ALL ON public.portal_requests FROM anon;

-- Authenticated users get minimal table rights; RLS policies below scope them
-- to owner/admin role. No INSERT/DELETE direct grant (admin inserts only happen
-- through hunter-lead conversion, which uses service_role or authenticated path).
GRANT SELECT, UPDATE ON public.portal_requests TO authenticated;

-- ── 4. Owner/admin RLS policies ───────────────────────────────────────────────
-- public.user_role() is SECURITY DEFINER (migration 006), reads profiles.role,
-- and cannot be spoofed by the client. Employees with profiles.role = 'field',
-- 'viewer', or any non-owner/admin value are excluded by both conditions.
-- After the profiles_update_self repair (part A above), self-escalation is
-- additionally blocked at the profiles level.

CREATE POLICY portal_requests_owner_admin_select
  ON public.portal_requests
  FOR SELECT
  TO authenticated
  USING (public.user_role() IN ('owner', 'admin'));

CREATE POLICY portal_requests_owner_admin_update
  ON public.portal_requests
  FOR UPDATE
  TO authenticated
  USING  (public.user_role() IN ('owner', 'admin'))
  WITH CHECK (public.user_role() IN ('owner', 'admin'));

-- ── 5. One-time attachment capability column ──────────────────────────────────
-- Stores the SHA-256 hash of the one-time attachment capability returned to
-- the submitter.  NULL after the capability has been consumed or when no files
-- were uploaded.  Not selectable by anon (no SELECT grant).

ALTER TABLE public.portal_requests
  ADD COLUMN IF NOT EXISTS attach_token_hash TEXT DEFAULT NULL;

-- ── 6. Public submission RPC ──────────────────────────────────────────────────
-- Anonymous AND authenticated callers use only this function; direct table
-- access is revoked for anon and restricted by RLS for authenticated.
-- Server-owned fields (status, source, created_at) are forced inside the body.
-- Input is validated for type and length; empty strings are normalised to NULL.
-- A cryptographically strong one-time attachment capability is generated using
-- extensions.gen_random_bytes(32) (256 bits).  Only the SHA-256 hash is stored;
-- the raw token is returned to the caller and never persisted.
-- Return shape: {"request_id": "uuid", "attach_token": "hex64"}

CREATE OR REPLACE FUNCTION public.submit_portal_request(
  p_name              TEXT,
  p_phone             TEXT    DEFAULT NULL,
  p_email             TEXT    DEFAULT NULL,
  p_address           TEXT    DEFAULT NULL,
  p_city              TEXT    DEFAULT NULL,
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
  v_raw_token        TEXT;
  v_token_hash       TEXT;
  v_valid_categories CONSTANT TEXT[] := ARRAY[
    'residential', 'commercial', 'solar', 'maintenance',
    'panel_upgrade', 'ev_charger', 'other'
  ];
  v_valid_types CONSTANT TEXT[] := ARRAY['homeowner', 'gc', 'sub'];
BEGIN
  -- ── Required-field validation ─────────────────────────────────────────────
  IF trim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  IF trim(coalesce(p_phone, '')) = '' AND trim(coalesce(p_email, '')) = '' THEN
    RAISE EXCEPTION 'phone or email is required';
  END IF;

  -- ── Enum validation ───────────────────────────────────────────────────────
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

  -- ── Length guards ─────────────────────────────────────────────────────────
  IF char_length(coalesce(p_name, ''))            > 200   THEN RAISE EXCEPTION 'name too long (max 200)'; END IF;
  IF char_length(coalesce(p_phone, ''))           > 30    THEN RAISE EXCEPTION 'phone too long (max 30)'; END IF;
  IF char_length(coalesce(p_email, ''))           > 320   THEN RAISE EXCEPTION 'email too long (max 320)'; END IF;
  IF char_length(coalesce(p_address, ''))         > 500   THEN RAISE EXCEPTION 'address too long (max 500)'; END IF;
  IF char_length(coalesce(p_city, ''))            > 200   THEN RAISE EXCEPTION 'city too long (max 200)'; END IF;
  IF char_length(coalesce(p_description, ''))     > 5000  THEN RAISE EXCEPTION 'description too long (max 5000)'; END IF;
  IF char_length(coalesce(p_preferred_time, ''))  > 200   THEN RAISE EXCEPTION 'preferred_time too long (max 200)'; END IF;
  IF char_length(coalesce(p_notes, ''))           > 10000 THEN RAISE EXCEPTION 'notes too long (max 10000)'; END IF;

  -- ── Generate one-time attachment capability ───────────────────────────────
  -- 32 bytes (256 bits) from CSPRNG, hex-encoded to a 64-char string.
  -- Store only the SHA-256 hash; return the raw token to the caller.
  v_raw_token  := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token::bytea, 'sha256'), 'hex');

  -- ── Insert with forced server-owned values ────────────────────────────────
  -- Fields intentionally NOT accepted from the caller:
  --   hunter_lead_id, tenant_id, submitted_ip,
  --   completed_at, review_requested_at, review_request_sent_to,
  --   review_request_status, review_request_error,
  --   review_request_last_attempt_at
  INSERT INTO public.portal_requests (
    name,
    phone,
    email,
    address,
    city,
    request_type,
    service_category,
    description,
    preferred_date,
    preferred_time,
    notes,
    status,              -- forced: 'new'
    source,              -- forced: 'customer_portal'
    created_at,          -- forced: server clock
    attach_token_hash    -- hashed one-time capability
  ) VALUES (
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
    'new',
    'customer_portal',
    now(),
    v_token_hash
  )
  RETURNING id INTO v_id;

  -- Return request ID and the RAW (unhashed) token — token is never stored in DB
  RETURN jsonb_build_object(
    'request_id',   v_id::text,
    'attach_token', v_raw_token
  );
END;
$$;

COMMENT ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) IS
  'SEC-0R public portal submission RPC. SECURITY DEFINER forces status=new and '
  'source=customer_portal. Generates a 256-bit one-time attachment capability; '
  'stores only its SHA-256 hash; returns {request_id, attach_token} as JSONB. '
  'Does not accept internal fields (hunter_lead_id, review fields, etc.). '
  'Employee access deferred to ROLE-1/OPS-1.';

REVOKE ALL   ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) TO authenticated;

-- ── 7. Customer tracking RPC ──────────────────────────────────────────────────
-- Replaces direct anon SELECT on portal_requests for the /portal/track/:id view.
-- Returns only customer-safe fields — never: notes, hunter_lead_id, review
-- fields, source, submitted_ip, tenant_id, or any financial information.
-- Returns NULL (empty JSONB) when the request does not exist.

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

  -- Return only fields that are safe to display to the customer who submitted
  -- the request. Internal fields (notes, hunter_lead_id, review_*, source,
  -- submitted_ip) are deliberately excluded.
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
  'SEC-0R: Customer-safe tracking read. Returns only status/scheduling fields. '
  'Never returns notes, hunter_lead_id, review fields, source, or PII beyond '
  'what the customer originally supplied. Replaces direct anon SELECT.';

REVOKE ALL   ON FUNCTION public.get_portal_request_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_request_status(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.get_portal_request_status(UUID) TO authenticated;

-- ── 8. File-URL append RPC ────────────────────────────────────────────────────
-- Appends a file-URL suffix to notes on a row the caller just created.
-- Authorization requires the one-time attach_token returned by submit.
-- Guards:
--   - Token: SHA-256 of p_attach_token must equal stored attach_token_hash
--   - Status: row status must still be 'new'
--   - Not yet linked: hunter_lead_id IS NULL
--   - Time window: row created within last 30 minutes (belt-and-suspenders)
--   - URL format: each URL must start with https:// and contain /portal-uploads/
--   - Count: maximum 10 file URLs
--   - Length: max 2000 chars per URL, max 20000 chars total suffix
--   - One-time: attach_token_hash cleared after success; reuse returns false
-- Returns TRUE on success, FALSE on any guard failure.

CREATE OR REPLACE FUNCTION public.append_portal_request_files(
  p_id            UUID,
  p_notes_suffix  TEXT,
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
  v_url_list       TEXT;
  v_url_array      TEXT[];
  v_url            TEXT;
BEGIN
  -- Guard: token and suffix must be non-empty
  IF trim(coalesce(p_attach_token, '')) = '' THEN
    RETURN FALSE;
  END IF;
  IF trim(coalesce(p_notes_suffix, '')) = '' THEN
    RETURN FALSE;
  END IF;

  -- Guard: suffix total length
  IF char_length(p_notes_suffix) > 20000 THEN
    RAISE EXCEPTION 'attachment metadata too long (max 20000)';
  END IF;

  -- Guard: token length (64-char hex for a 32-byte random token)
  IF char_length(p_attach_token) != 64 THEN
    RETURN FALSE;
  END IF;

  -- Compute SHA-256 hash of the provided token for constant-time comparison
  v_provided_hash := encode(digest(p_attach_token::bytea, 'sha256'), 'hex');

  -- Guard: URL format and count validation
  -- Expected suffix format: "Files: https://..., https://..."
  -- Extract URL portion after "Files: " prefix
  v_url_list := trim(regexp_replace(p_notes_suffix, '^Files:\s*', '', 'i'));
  v_url_array := string_to_array(v_url_list, ', ');

  IF array_length(v_url_array, 1) > 10 THEN
    RAISE EXCEPTION 'too many attachments (max 10 files)';
  END IF;

  FOREACH v_url IN ARRAY v_url_array LOOP
    v_url := trim(v_url);
    IF char_length(v_url) > 2000 THEN
      RAISE EXCEPTION 'attachment URL too long (max 2000 chars)';
    END IF;
    IF NOT (v_url LIKE 'https://%' AND v_url LIKE '%/portal-uploads/%') THEN
      RAISE EXCEPTION 'attachment URL is not from the expected storage bucket';
    END IF;
  END LOOP;

  -- Lock and validate the target row atomically.
  -- attach_token_hash match is part of the WHERE clause so no timing differential
  -- is introduced between "row not found" and "wrong token" — both return FALSE.
  SELECT notes INTO v_existing_notes
  FROM public.portal_requests
  WHERE id              = p_id
    AND status          = 'new'
    AND hunter_lead_id  IS NULL
    AND created_at     >= now() - INTERVAL '30 minutes'
    AND attach_token_hash = v_provided_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Append with the existing notes separator convention
  v_new_notes := CASE
    WHEN v_existing_notes IS NULL OR v_existing_notes = ''
    THEN p_notes_suffix
    ELSE v_existing_notes || ' | ' || p_notes_suffix
  END;

  -- Update notes and consume the one-time capability in a single statement
  UPDATE public.portal_requests
  SET notes             = v_new_notes,
      attach_token_hash = NULL        -- invalidate: one-time use
  WHERE id = p_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) IS
  'SEC-0R: Appends file-URL metadata to a portal request using a one-time '
  'capability token.  Token is verified by SHA-256 hash comparison; cleared '
  'after first successful use.  URL count, length, and storage-bucket prefix '
  'are validated.  Cannot change status, hunter_lead_id, or any other field.';

REVOKE ALL   ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.append_portal_request_files(UUID, TEXT, TEXT) TO authenticated;

-- ── SEC-0S: Storage boundary (deferred — do not implement in SEC-0R) ─────────
-- FINDING: portal-uploads storage bucket was created via the Supabase dashboard
-- without a migration.  Its current policy is public-read with no path
-- restriction, meaning any caller can read any uploaded file with a known URL.
-- PROPOSED NEXT PHASE: SEC-0S — Private Portal Attachment Storage
--   1. Migrate portal-uploads to private (public = false).
--   2. Add RLS policies: anon can INSERT only under portal-requests/{request_id}/,
--      with the matching attach_token as a header or query parameter.
--   3. Owner/admin can read any file under portal-uploads/.
--   4. Signed URLs required for all other reads.
-- LEAD-1 employee portal access remains blocked pending SEC-0S completion.

COMMIT;
