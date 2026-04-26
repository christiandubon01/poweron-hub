BEGIN;

-- Add geocoding columns to hunter_leads
ALTER TABLE public.hunter_leads
  ADD COLUMN IF NOT EXISTS latitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10, 7),
  ADD COLUMN IF NOT EXISTS distance_from_base_miles numeric(8, 2),
  ADD COLUMN IF NOT EXISTS geocoded_at timestamptz,
  ADD COLUMN IF NOT EXISTS geocoding_status text DEFAULT 'pending';

-- Index for spatial queries (nearest-first sort)
CREATE INDEX IF NOT EXISTS hunter_leads_distance_idx
  ON public.hunter_leads (tenant_id, distance_from_base_miles)
  WHERE distance_from_base_miles IS NOT NULL;

-- Index for un-geocoded leads (for backfill efficiency)
CREATE INDEX IF NOT EXISTS hunter_leads_geocoding_pending_idx
  ON public.hunter_leads (tenant_id, geocoding_status)
  WHERE geocoding_status IN ('pending', 'failed');

-- New table: tenant_settings (key-value, tenant-scoped)
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT tenant_settings_tenant_key_uniq UNIQUE (tenant_id, setting_key)
);

COMMENT ON TABLE public.tenant_settings IS
  'Key-value settings scoped per tenant. Used for home_base_address (geocoded shop location), display preferences, etc.';

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_settings_tenant_isolation
  ON public.tenant_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_tenants
      WHERE user_tenants.user_id = auth.uid()
        AND user_tenants.tenant_id = tenant_settings.tenant_id
    )
  );

CREATE INDEX IF NOT EXISTS tenant_settings_lookup_idx
  ON public.tenant_settings (tenant_id, setting_key);

COMMIT;
