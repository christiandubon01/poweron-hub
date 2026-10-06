-- 149: Portal site integrations — WEBSITE / PUBLIC INTEGRATION -> ORGANIZATION routing.
-- Additive. Replaces the single-destination assumption (portal_request_configuration singleton)
-- for public intake. The singleton table is KEPT as a bounded compatibility bridge only for
-- clients that send no site key. portal_requests.organization_id remains the security boundary.
-- Do not apply to production until staging review (see docs/portal-multitenant-routing.md).
BEGIN;

CREATE SCHEMA IF NOT EXISTS portal_private;
REVOKE ALL ON SCHEMA portal_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.portal_site_integrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  -- PUBLIC routing identifier (not a secret): opaque, non-sequential, resolved server-side only.
  public_site_key    text NOT NULL UNIQUE CHECK (public_site_key ~ '^ps_[a-z0-9]{24,64}$'),
  label              text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  primary_origin     text NOT NULL,
  -- Exact origins only: https://host[:port] (http only for localhost), never wildcards/paths.
  allowed_origins    text[] NOT NULL,
  -- Trusted server-side owner-notification recipient for this site (never browser supplied).
  notification_email text CHECK (notification_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  -- Optional customer-facing contact email; private emails are never exposed unless set here.
  public_email       text CHECK (public_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  -- Platform tracking host for links sent to customers; NULL = platform default host.
  tracking_base_url  text CHECK (tracking_base_url ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'),
  -- Bounded bridge: the Power On integration may keep using PANEL_PLANNER_OWNER_EMAIL and is the
  -- target of legacy key-less /portal submissions. Never true for other organizations' sites.
  legacy_default     boolean NOT NULL DEFAULT false,
  enabled            boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT portal_site_origin_format CHECK (
    primary_origin ~ '^(https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?|http://localhost(:[0-9]{1,5})?)$'),
  CONSTRAINT portal_site_origins_format CHECK (
    cardinality(allowed_origins) BETWEEN 1 AND 20 AND
    primary_origin = ANY(allowed_origins) AND
    array_to_string(allowed_origins, ' ') ~ '^(https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?|http://localhost(:[0-9]{1,5})?)( (https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?|http://localhost(:[0-9]{1,5})?))*$')
);
CREATE UNIQUE INDEX portal_site_one_legacy_default ON public.portal_site_integrations ((true)) WHERE legacy_default;
CREATE INDEX portal_site_integrations_org_idx ON public.portal_site_integrations(organization_id);

CREATE FUNCTION portal_private.touch_site_integration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'portal_site_integrations.organization_id is immutable';
  END IF;
  NEW.updated_at := now(); RETURN NEW;
END $$;
CREATE TRIGGER portal_site_integrations_touch BEFORE UPDATE ON public.portal_site_integrations
  FOR EACH ROW EXECUTE FUNCTION portal_private.touch_site_integration();

ALTER TABLE public.portal_site_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_site_integrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.portal_site_integrations TO service_role;
-- Owner/admin may READ their own organization's integrations (same-org JWT authority).
GRANT SELECT ON public.portal_site_integrations TO authenticated;
CREATE POLICY portal_site_integrations_owner_read ON public.portal_site_integrations
  FOR SELECT TO authenticated
  USING (organization_id = public.user_org_id() AND public.is_org_admin_for(organization_id));

-- Which website created the request. NULL for legacy rows (never rewritten).
ALTER TABLE public.portal_requests ADD COLUMN portal_site_integration_id uuid;
ALTER TABLE public.portal_requests ADD CONSTRAINT portal_requests_site_integration_org_fk
  FOREIGN KEY (portal_site_integration_id, organization_id)
  REFERENCES public.portal_site_integrations(id, organization_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.portal_requests VALIDATE CONSTRAINT portal_requests_site_integration_org_fk;
CREATE INDEX portal_requests_site_integration_idx ON public.portal_requests(portal_site_integration_id)
  WHERE portal_site_integration_id IS NOT NULL;

-- Seed the existing Power On destination as an explicit integration (only if configured).
DO $$
DECLARE cfg uuid;
BEGIN
  SELECT organization_id INTO cfg FROM public.portal_request_configuration WHERE singleton = true;
  IF cfg IS NOT NULL THEN
    INSERT INTO public.portal_site_integrations(organization_id, public_site_key, label, primary_origin,
      allowed_origins, legacy_default)
    VALUES (cfg, 'ps_3f9c1e7ab25d4086b1c7e0aa', 'Power On Solutions', 'https://poweronsolutionsllc.com',
      ARRAY['https://poweronsolutionsllc.com','https://www.poweronsolutionsllc.com','https://app.poweronsolutionsllc.com'], true);
  END IF;
END $$;

-- Request Origin as exposed by PostgREST (NULL outside HTTP). Attribution/abuse control only;
-- the site key, not Origin, selects the tenant.
CREATE FUNCTION portal_private.request_origin() RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE h text;
BEGIN
  h := nullif(current_setting('request.headers', true), '');
  IF h IS NULL THEN RETURN NULL; END IF;
  RETURN nullif(btrim(h::json->>'origin'), '');
EXCEPTION WHEN others THEN RETURN NULL;
END $$;

-- Canonical resolution: public_site_key -> ENABLED integration -> organization.
-- Generic failures (no enumeration of which keys exist). Origin, when supplied, must exactly match.
CREATE FUNCTION portal_private.resolve_site(p_site_key text, p_origin text DEFAULT NULL)
RETURNS public.portal_site_integrations LANGUAGE plpgsql STABLE AS $$
DECLARE i public.portal_site_integrations;
BEGIN
  IF p_site_key IS NULL OR p_site_key !~ '^ps_[a-z0-9]{24,64}$' THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  SELECT * INTO i FROM public.portal_site_integrations WHERE public_site_key = p_site_key AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_UNAVAILABLE'; END IF;
  IF p_origin IS NOT NULL AND NOT (p_origin = ANY(i.allowed_origins)) THEN RAISE EXCEPTION 'ORIGIN_DENIED'; END IF;
  RETURN i;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_private FROM PUBLIC, anon, authenticated;

-- Union of enabled integration origins for CORS preflight (service only; per-site check is in the RPCs).
CREATE FUNCTION public.portal_site_allowed_origins() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(array_agg(DISTINCT o), '{}') FROM public.portal_site_integrations i, unnest(i.allowed_origins) o
  WHERE i.enabled
$$;
REVOKE ALL ON FUNCTION public.portal_site_allowed_origins() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.portal_site_allowed_origins() TO service_role;

-- Narrow public projection for a site's branding. Never returns ids, tenant ids, settings, billing,
-- notification recipients or unconfigured emails. Unknown/disabled -> NULL (no enumeration).
CREATE FUNCTION public.get_portal_site_public_config(p_site_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE i public.portal_site_integrations; o public.organizations; ident jsonb; logo text;
BEGIN
  IF p_site_key IS NULL OR p_site_key !~ '^ps_[a-z0-9]{24,64}$' THEN RETURN NULL; END IF;
  SELECT * INTO i FROM public.portal_site_integrations WHERE public_site_key = p_site_key AND enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.organizations WHERE id = i.organization_id;
  ident := CASE WHEN jsonb_typeof(o.settings->'identity') = 'object' THEN o.settings->'identity' ELSE '{}'::jsonb END;
  logo := ident->>'logoLight';
  IF logo IS NOT NULL AND logo !~ '^https://' THEN logo := NULL; END IF;
  RETURN jsonb_build_object(
    'site_label', i.label,
    'display_name', coalesce(nullif(btrim(ident->>'companyName'), ''), o.name),
    'logo_url', logo,
    'public_phone', nullif(btrim(ident->>'supportPhone'), ''),
    'public_email', i.public_email,
    'tracking_base_url', coalesce(i.tracking_base_url, 'https://app.poweronsolutionsllc.com'));
END $$;
REVOKE ALL ON FUNCTION public.get_portal_site_public_config(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_site_public_config(text) TO anon, authenticated, service_role;

-- Normal portal: 24-param (migration 128) -> 25-param with trailing p_site_key (DEFAULT NULL = bridge).
DROP FUNCTION IF EXISTS public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
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
    -- BOUNDED COMPATIBILITY BRIDGE (migration 149): clients that predate site keys keep
    -- landing in the legacy singleton destination. Remove once every public entry point sends a key.
    SELECT organization_id INTO v_organization_id
    FROM public.portal_request_configuration WHERE singleton = true;
    IF v_organization_id IS NULL THEN
      RAISE EXCEPTION 'Portal destination organization is not configured';
    END IF;
    SELECT * INTO v_integration FROM public.portal_site_integrations
    WHERE organization_id = v_organization_id AND legacy_default AND enabled
    ORDER BY created_at LIMIT 1;
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

COMMENT ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'Migration 149: organization resolved server-side from p_site_key via portal_site_integrations '
  '(fail closed; Origin checked when present). NULL key = bounded legacy singleton bridge. '
  'Browser never supplies organization_id. Return shape unchanged.';
REVOKE ALL ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_portal_request(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

DO $$
DECLARE fn oid;
BEGIN
  SELECT p.oid INTO fn FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'submit_portal_request';
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'submit_portal_request') <> 1 THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: submit_portal_request overload count';
  END IF;
  IF NOT has_function_privilege('anon', fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon cannot execute submit_portal_request';
  END IF;
  IF has_table_privilege('anon', 'public.portal_site_integrations', 'SELECT') THEN
    RAISE EXCEPTION 'POSTCONDITION FAILED: anon can read portal_site_integrations';
  END IF;
END $$;

COMMIT;
