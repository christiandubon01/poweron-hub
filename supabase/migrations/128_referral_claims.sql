-- =============================================================================
-- Migration 128: LEAD-SRC-4B — Private referral index
-- =============================================================================
-- Creates referral_claims and extends submit_portal_request (23-param → 24-param)
-- to atomically record an optional human referral at submission time.
--
-- Security:
--   • referral_claims: deny-all for anon; owner/admin SELECT + UPDATE only.
--   • INSERT is exclusively via the SECURITY DEFINER RPC.
--   • No public customer lookup. No historical backfill.
-- =============================================================================

BEGIN;

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.referral_claims (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID         NOT NULL
                      REFERENCES public.organizations(id) ON DELETE RESTRICT,
  portal_request_id   UUID         NOT NULL
                      REFERENCES public.portal_requests(id) ON DELETE RESTRICT,
  raw_referral_text   TEXT         NOT NULL,
  resolution_status   TEXT         NOT NULL DEFAULT 'unresolved',
  resolved_client_id  UUID         REFERENCES public.clients(id)        ON DELETE RESTRICT,
  resolved_lead_id    UUID         REFERENCES public.hunter_leads(id)   ON DELETE RESTRICT,
  resolved_by         UUID         REFERENCES auth.users(id)            ON DELETE SET NULL,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT referral_claims_portal_request_unique UNIQUE (portal_request_id),
  CONSTRAINT referral_claims_text_nonempty  CHECK (trim(raw_referral_text) != ''),
  CONSTRAINT referral_claims_text_maxlen    CHECK (char_length(raw_referral_text) <= 500),
  CONSTRAINT referral_claims_status_values  CHECK (
    resolution_status IN ('unresolved', 'resolved', 'ambiguous')
  ),
  CONSTRAINT referral_claims_resolution_consistency CHECK (
    CASE resolution_status
      WHEN 'resolved' THEN
        (resolved_client_id IS NOT NULL) != (resolved_lead_id IS NOT NULL)
      ELSE
        resolved_client_id IS NULL AND resolved_lead_id IS NULL
    END
  )
);

COMMENT ON TABLE public.referral_claims IS
  'LEAD-SRC-4B: Private human-referral index. One row per portal submission that named a '
  'referrer. Populated atomically by submit_portal_request. Owner confirms match via owner-side '
  'UI. No public access. Aggregated analytics deferred to LEAD-SRC-6.';

COMMENT ON COLUMN public.referral_claims.raw_referral_text IS
  'Verbatim trimmed text from "Were you referred by someone?". Stored as-is; owner matches manually.';
COMMENT ON COLUMN public.referral_claims.resolution_status IS
  'unresolved: no owner action. resolved: matched to exactly one client or lead. '
  'ambiguous: owner flagged as unclear.';
COMMENT ON COLUMN public.referral_claims.resolved_client_id IS
  'FK to clients.id. Populated when referrer confirmed as an existing client. '
  'Mutually exclusive with resolved_lead_id. ON DELETE RESTRICT — confirmed referral is '
  'historical business data; owner must unlink the claim before the client can be deleted.';
COMMENT ON COLUMN public.referral_claims.resolved_lead_id IS
  'FK to hunter_leads.id. Populated when referrer confirmed as a hunter lead. '
  'Mutually exclusive with resolved_client_id. ON DELETE RESTRICT — confirmed referral is '
  'historical business data; owner must unlink the claim before the lead can be deleted.';
COMMENT ON COLUMN public.referral_claims.resolved_by IS
  'auth.users.id of the owner who performed the resolution.';

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_referral_claims_organization_id
  ON public.referral_claims (organization_id);

CREATE INDEX IF NOT EXISTS idx_referral_claims_resolution_status
  ON public.referral_claims (organization_id, resolution_status);

CREATE INDEX IF NOT EXISTS idx_referral_claims_resolved_client_id
  ON public.referral_claims (resolved_client_id)
  WHERE resolved_client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_claims_resolved_lead_id
  ON public.referral_claims (resolved_lead_id)
  WHERE resolved_lead_id IS NOT NULL;

-- ── 3. Row-level security ─────────────────────────────────────────────────────

ALTER TABLE public.referral_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.referral_claims FROM PUBLIC;
REVOKE ALL ON TABLE public.referral_claims FROM anon;
REVOKE ALL ON TABLE public.referral_claims FROM authenticated;

CREATE POLICY referral_claims_owner_admin_select
  ON public.referral_claims FOR SELECT
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

CREATE POLICY referral_claims_owner_admin_update
  ON public.referral_claims FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  )
  WITH CHECK (
    organization_id = public.user_org_id()
    AND public.is_org_admin_for(organization_id)
  );

GRANT SELECT, UPDATE ON TABLE public.referral_claims TO authenticated;

-- ── 4. Replace submit_portal_request (23-param → 24-param) ───────────────────

DROP FUNCTION IF EXISTS public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

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
  p_notes             TEXT    DEFAULT NULL,
  p_gclid             TEXT    DEFAULT NULL,
  p_gbraid            TEXT    DEFAULT NULL,
  p_wbraid            TEXT    DEFAULT NULL,
  p_utm_source        TEXT    DEFAULT NULL,
  p_utm_medium        TEXT    DEFAULT NULL,
  p_utm_campaign      TEXT    DEFAULT NULL,
  p_utm_term          TEXT    DEFAULT NULL,
  p_utm_content       TEXT    DEFAULT NULL,
  p_referrer          TEXT    DEFAULT NULL,
  p_landing_page      TEXT    DEFAULT NULL,
  p_page_url          TEXT    DEFAULT NULL,
  p_source_category   TEXT    DEFAULT NULL,
  p_referred_by_text  TEXT    DEFAULT NULL
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
  v_referred_by      TEXT;
  v_valid_categories CONSTANT TEXT[] := ARRAY[
    'residential', 'commercial', 'solar', 'maintenance',
    'panel_upgrade', 'ev_charger', 'other'
  ];
  v_valid_types CONSTANT TEXT[] := ARRAY['homeowner', 'gc', 'sub'];
  v_valid_source_categories CONSTANT TEXT[] := ARRAY[
    'paid_search', 'ai_assistant', 'gbp', 'referral_site',
    'social', 'organic_search', 'direct', 'other'
  ];
  v_source_category  TEXT;
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

  IF char_length(coalesce(p_name, ''))             > 200   THEN RAISE EXCEPTION 'name too long (max 200)'; END IF;
  IF char_length(coalesce(p_phone, ''))            > 30    THEN RAISE EXCEPTION 'phone too long (max 30)'; END IF;
  IF char_length(coalesce(p_email, ''))            > 320   THEN RAISE EXCEPTION 'email too long (max 320)'; END IF;
  IF char_length(coalesce(p_address, ''))          > 500   THEN RAISE EXCEPTION 'address too long (max 500)'; END IF;
  IF char_length(coalesce(p_city, ''))             > 200   THEN RAISE EXCEPTION 'city too long (max 200)'; END IF;
  IF char_length(coalesce(p_description, ''))      > 5000  THEN RAISE EXCEPTION 'description too long (max 5000)'; END IF;
  IF char_length(coalesce(p_preferred_time, ''))   > 200   THEN RAISE EXCEPTION 'preferred_time too long (max 200)'; END IF;
  IF char_length(coalesce(p_notes, ''))            > 10000 THEN RAISE EXCEPTION 'notes too long (max 10000)'; END IF;
  IF char_length(coalesce(p_gclid, ''))            > 512   THEN RAISE EXCEPTION 'gclid too long (max 512)'; END IF;
  IF char_length(coalesce(p_gbraid, ''))           > 512   THEN RAISE EXCEPTION 'gbraid too long (max 512)'; END IF;
  IF char_length(coalesce(p_wbraid, ''))           > 512   THEN RAISE EXCEPTION 'wbraid too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_source, ''))       > 512   THEN RAISE EXCEPTION 'utm_source too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_medium, ''))       > 512   THEN RAISE EXCEPTION 'utm_medium too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_campaign, ''))     > 512   THEN RAISE EXCEPTION 'utm_campaign too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_term, ''))         > 512   THEN RAISE EXCEPTION 'utm_term too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_content, ''))      > 512   THEN RAISE EXCEPTION 'utm_content too long (max 512)'; END IF;
  IF char_length(coalesce(p_referrer, ''))         > 2048  THEN RAISE EXCEPTION 'referrer too long (max 2048)'; END IF;
  IF char_length(coalesce(p_landing_page, ''))     > 2048  THEN RAISE EXCEPTION 'landing_page too long (max 2048)'; END IF;
  IF char_length(coalesce(p_page_url, ''))         > 2048  THEN RAISE EXCEPTION 'page_url too long (max 2048)'; END IF;
  IF char_length(coalesce(p_source_category, ''))  > 40    THEN RAISE EXCEPTION 'source_category too long (max 40)'; END IF;
  IF char_length(coalesce(p_referred_by_text, '')) > 500   THEN RAISE EXCEPTION 'referred_by_text too long (max 500)'; END IF;

  v_source_category := lower(trim(coalesce(p_source_category, '')));
  IF v_source_category = '' OR NOT (v_source_category = ANY(v_valid_source_categories)) THEN
    v_source_category := 'other';
  END IF;

  -- Normalize referral text: trim whitespace; treat blank/whitespace-only as absent
  v_referred_by := nullif(trim(coalesce(p_referred_by_text, '')), '');

  v_raw_token  := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token::bytea, 'sha256'), 'hex');

  INSERT INTO public.portal_requests (
    organization_id,
    name, phone, email, address, city, request_type, service_category,
    description, preferred_date, preferred_time, notes,
    gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    referrer, landing_page, page_url, source_category,
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
    nullif(trim(coalesce(p_gclid, '')), ''),
    nullif(trim(coalesce(p_gbraid, '')), ''),
    nullif(trim(coalesce(p_wbraid, '')), ''),
    nullif(trim(coalesce(p_utm_source, '')), ''),
    nullif(trim(coalesce(p_utm_medium, '')), ''),
    nullif(trim(coalesce(p_utm_campaign, '')), ''),
    nullif(trim(coalesce(p_utm_term, '')), ''),
    nullif(trim(coalesce(p_utm_content, '')), ''),
    nullif(trim(coalesce(p_referrer, '')), ''),
    nullif(trim(coalesce(p_landing_page, '')), ''),
    nullif(trim(coalesce(p_page_url, '')), ''),
    v_source_category,
    'new', 'customer_portal', now(), v_token_hash
  )
  RETURNING id INTO v_id;

  -- Atomic referral claim: only created when submitter named a referrer
  IF v_referred_by IS NOT NULL THEN
    INSERT INTO public.referral_claims (
      organization_id,
      portal_request_id,
      raw_referral_text
    ) VALUES (
      v_organization_id,
      v_id,
      v_referred_by
    );
  END IF;

  RETURN jsonb_build_object(
    'request_id',  v_id::text,
    'attach_token', v_raw_token
  );
END;
$$;

COMMENT ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'SEC-0S R2 / LEAD-SRC-4B: public submission RPC. organization_id assigned server-side from '
  'singleton portal configuration. p_referred_by_text (param 24, DEFAULT NULL) atomically '
  'creates a referral_claims row when non-empty. Return shape unchanged from migration 120.';

REVOKE ALL ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

-- ── 5. Postconditions ─────────────────────────────────────────────────────────

DO $$
DECLARE
  v_has_table             boolean;
  v_has_rls               boolean;
  v_anon_can_select       boolean;
  v_anon_can_insert       boolean;
  v_has_select_policy     boolean;
  v_has_update_policy     boolean;
  v_overload_count        integer;
  v_param_count           integer;
  v_has_unique            boolean;
  v_attach_column_exists  boolean;
  v_register_fn_exists    boolean;
  v_client_fk_deltype     char;
  v_lead_fk_deltype       char;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'referral_claims'
  ) INTO v_has_table;
  IF NOT v_has_table THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: referral_claims table missing';
  END IF;

  SELECT relrowsecurity INTO v_has_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'referral_claims';
  IF NOT v_has_rls THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: RLS not enabled on referral_claims';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'referral_claims'
      AND grantee = 'anon' AND privilege_type = 'SELECT'
  ) INTO v_anon_can_select;
  IF v_anon_can_select THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon has SELECT on referral_claims';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'referral_claims'
      AND grantee = 'anon' AND privilege_type = 'INSERT'
  ) INTO v_anon_can_insert;
  IF v_anon_can_insert THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon has INSERT on referral_claims';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_claims'
      AND cmd = 'SELECT' AND policyname = 'referral_claims_owner_admin_select'
  ) INTO v_has_select_policy;
  IF NOT v_has_select_policy THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: referral_claims_owner_admin_select policy missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'referral_claims'
      AND cmd = 'UPDATE' AND policyname = 'referral_claims_owner_admin_update'
  ) INTO v_has_update_policy;
  IF NOT v_has_update_policy THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: referral_claims_owner_admin_update policy missing';
  END IF;

  SELECT COUNT(*) INTO v_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'submit_portal_request';
  IF v_overload_count != 1 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: expected 1 submit_portal_request overload, found %', v_overload_count;
  END IF;

  SELECT pronargs INTO v_param_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'submit_portal_request';
  IF v_param_count != 24 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: submit_portal_request has % params, expected 24', v_param_count;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'referral_claims_portal_request_unique'
      AND conrelid = 'public.referral_claims'::regclass
      AND contype = 'u'
  ) INTO v_has_unique;
  IF NOT v_has_unique THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: referral_claims_portal_request_unique constraint missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'portal_requests'
      AND column_name = 'attach_token_hash'
  ) INTO v_attach_column_exists;
  IF NOT v_attach_column_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: portal_requests.attach_token_hash missing (regression)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'register_portal_attachments'
  ) INTO v_register_fn_exists;
  IF NOT v_register_fn_exists THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: register_portal_attachments missing (regression)';
  END IF;

  -- resolved_client_id FK must be RESTRICT (not SET NULL) to preserve confirmed history
  SELECT confdeltype INTO v_client_fk_deltype
  FROM pg_constraint
  WHERE conname = 'referral_claims_resolved_client_id_fkey'
    AND conrelid = 'public.referral_claims'::regclass;
  IF v_client_fk_deltype IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: resolved_client_id FK must be RESTRICT (r), found %', v_client_fk_deltype;
  END IF;

  -- resolved_lead_id FK must be RESTRICT
  SELECT confdeltype INTO v_lead_fk_deltype
  FROM pg_constraint
  WHERE conname = 'referral_claims_resolved_lead_id_fkey'
    AND conrelid = 'public.referral_claims'::regclass;
  IF v_lead_fk_deltype IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: resolved_lead_id FK must be RESTRICT (r), found %', v_lead_fk_deltype;
  END IF;
END $$;

COMMIT;
