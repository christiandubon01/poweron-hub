BEGIN;

ALTER TABLE public.portal_requests
  ADD COLUMN IF NOT EXISTS gclid TEXT,
  ADD COLUMN IF NOT EXISTS gbraid TEXT,
  ADD COLUMN IF NOT EXISTS wbraid TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_term TEXT,
  ADD COLUMN IF NOT EXISTS utm_content TEXT,
  ADD COLUMN IF NOT EXISTS referrer TEXT,
  ADD COLUMN IF NOT EXISTS landing_page TEXT,
  ADD COLUMN IF NOT EXISTS page_url TEXT,
  ADD COLUMN IF NOT EXISTS source_category TEXT;

CREATE INDEX IF NOT EXISTS idx_portal_requests_source_category
  ON public.portal_requests (source_category);

CREATE INDEX IF NOT EXISTS idx_portal_requests_gclid
  ON public.portal_requests (gclid)
  WHERE gclid IS NOT NULL;

DROP FUNCTION IF EXISTS public.submit_portal_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT);

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
  p_source_category   TEXT    DEFAULT NULL
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

  IF char_length(coalesce(p_name, ''))           > 200   THEN RAISE EXCEPTION 'name too long (max 200)'; END IF;
  IF char_length(coalesce(p_phone, ''))          > 30    THEN RAISE EXCEPTION 'phone too long (max 30)'; END IF;
  IF char_length(coalesce(p_email, ''))          > 320   THEN RAISE EXCEPTION 'email too long (max 320)'; END IF;
  IF char_length(coalesce(p_address, ''))        > 500   THEN RAISE EXCEPTION 'address too long (max 500)'; END IF;
  IF char_length(coalesce(p_city, ''))           > 200   THEN RAISE EXCEPTION 'city too long (max 200)'; END IF;
  IF char_length(coalesce(p_description, ''))    > 5000  THEN RAISE EXCEPTION 'description too long (max 5000)'; END IF;
  IF char_length(coalesce(p_preferred_time, '')) > 200   THEN RAISE EXCEPTION 'preferred_time too long (max 200)'; END IF;
  IF char_length(coalesce(p_notes, ''))          > 10000 THEN RAISE EXCEPTION 'notes too long (max 10000)'; END IF;
  IF char_length(coalesce(p_gclid, ''))          > 512   THEN RAISE EXCEPTION 'gclid too long (max 512)'; END IF;
  IF char_length(coalesce(p_gbraid, ''))         > 512   THEN RAISE EXCEPTION 'gbraid too long (max 512)'; END IF;
  IF char_length(coalesce(p_wbraid, ''))         > 512   THEN RAISE EXCEPTION 'wbraid too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_source, ''))     > 512   THEN RAISE EXCEPTION 'utm_source too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_medium, ''))     > 512   THEN RAISE EXCEPTION 'utm_medium too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_campaign, ''))   > 512   THEN RAISE EXCEPTION 'utm_campaign too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_term, ''))       > 512   THEN RAISE EXCEPTION 'utm_term too long (max 512)'; END IF;
  IF char_length(coalesce(p_utm_content, ''))    > 512   THEN RAISE EXCEPTION 'utm_content too long (max 512)'; END IF;
  IF char_length(coalesce(p_referrer, ''))       > 2048  THEN RAISE EXCEPTION 'referrer too long (max 2048)'; END IF;
  IF char_length(coalesce(p_landing_page, ''))   > 2048  THEN RAISE EXCEPTION 'landing_page too long (max 2048)'; END IF;
  IF char_length(coalesce(p_page_url, ''))       > 2048  THEN RAISE EXCEPTION 'page_url too long (max 2048)'; END IF;
  IF char_length(coalesce(p_source_category, '')) > 40   THEN RAISE EXCEPTION 'source_category too long (max 40)'; END IF;

  v_source_category := lower(trim(coalesce(p_source_category, '')));
  IF v_source_category = '' OR NOT (v_source_category = ANY(v_valid_source_categories)) THEN
    v_source_category := 'other';
  END IF;

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

  RETURN jsonb_build_object(
    'request_id', v_id::text,
    'attach_token', v_raw_token
  );
END;
$$;

COMMENT ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'SEC-0S R2 public submission RPC. Assigns organization_id exclusively from '
  'the singleton server-side Portal configuration; no organization parameter is '
  'accepted. Preserves the SEC-0R one-time attachment capability.';

REVOKE ALL ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMIT;
