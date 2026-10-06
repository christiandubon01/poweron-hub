-- 151: Fail-closed compatibility, generic recovery and request-bound public branding.
BEGIN;

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
  p_referred_by_text  TEXT    DEFAULT NULL,
  p_site_key          TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id               UUID;
  v_organization_id  UUID;
  v_integration      public.portal_site_integrations;
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
  IF p_site_key IS NOT NULL THEN
    -- Site-key routing: the key resolves server-side to exactly one enabled integration.
    -- Unknown/disabled/malformed key or a request Origin outside that integration fails closed.
    v_integration := portal_private.resolve_site(p_site_key, portal_private.request_origin());
    v_organization_id := v_integration.organization_id;
  ELSE
    -- BOUNDED COMPATIBILITY BRIDGE: stale clients resolve the existing Power On key
    -- through the SAME enabled-integration and exact-origin checks. No singleton lookup.
    v_integration := portal_private.resolve_site('ps_3f9c1e7ab25d4086b1c7e0aa', portal_private.request_origin());
    v_organization_id := v_integration.organization_id;
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
    organization_id, portal_site_integration_id,
    name, phone, email, address, city, request_type, service_category,
    description, preferred_date, preferred_time, notes,
    gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    referrer, landing_page, page_url, source_category,
    status, source, created_at, attach_token_hash
  ) VALUES (
    v_organization_id, v_integration.id,
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

CREATE OR REPLACE FUNCTION public.recover_panel_planner_request(p_idempotency_key uuid,p_recovery_token text,p_site_key text,p_origin text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,planner_private AS $$
DECLARE d public.portal_request_planner_details; site public.portal_site_integrations;
BEGIN
  site:=portal_private.resolve_site(p_site_key,p_origin);
  -- Same organization AND same originating integration: no cross-org or cross-site recovery.
  SELECT d0.* INTO d FROM public.portal_request_planner_details d0 JOIN public.portal_requests r0
    ON r0.id=d0.request_id AND r0.organization_id=d0.organization_id
    WHERE d0.organization_id=site.organization_id AND r0.portal_site_integration_id=site.id
      AND d0.client='panel-planner-web-v1' AND d0.idempotency_key=p_idempotency_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  BEGIN
    PERFORM planner_private.proof(d,p_recovery_token);
  EXCEPTION WHEN raise_exception THEN
    -- An invalid proof and a missing request must be indistinguishable.
    -- Expiry still applies; the caller receives the same generic recovery failure.
    RAISE EXCEPTION 'REQUEST_UNAVAILABLE';
  END;
  RETURN planner_private.receipt(d,true);
END $$;

-- Public tracking branding is resolved from the ORIGINAL request, never a browser site key.
-- Separate RPC preserves the existing tracking status projection and its ACLs.
CREATE FUNCTION public.get_portal_request_public_config(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.portal_requests; i public.portal_site_integrations; o public.organizations; ident jsonb; logo text;
BEGIN
  SELECT * INTO r FROM public.portal_requests WHERE id=p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id=r.organization_id;
  SELECT * INTO i FROM public.portal_site_integrations WHERE id=r.portal_site_integration_id AND organization_id=r.organization_id;
  ident:=CASE WHEN jsonb_typeof(o.settings->'identity')='object' THEN o.settings->'identity' ELSE '{}'::jsonb END;
  logo:=ident->>'logoLight';
  IF logo IS NOT NULL AND logo !~ '^https://' THEN logo:=NULL; END IF;
  RETURN jsonb_build_object('display_name',coalesce(nullif(btrim(ident->>'companyName'),''),o.name),
    'logo_url',logo,'public_phone',nullif(btrim(ident->>'supportPhone'),''),'public_email',i.public_email,
    'site_key',i.public_site_key,'power_on_compatibility',coalesce(i.legacy_default,false) OR
      (r.portal_site_integration_id IS NULL AND EXISTS(SELECT 1 FROM public.portal_site_integrations s WHERE s.organization_id=r.organization_id AND s.legacy_default)));
END $$;
REVOKE ALL ON FUNCTION public.get_portal_request_public_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_request_public_config(uuid) TO anon,authenticated;

COMMIT;
