-- 067_neural_world_settings.sql
-- NW2: Persist Neural World atmosphere, camera, and position per org.
-- One row per org — upsert on change.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.neural_world_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  atmosphere_mode  text NOT NULL DEFAULT 'SCIFI_V1',
  active_layers    jsonb NOT NULL DEFAULT '[]',
  camera_mode      text NOT NULL DEFAULT 'FIRST_PERSON',
  last_position    jsonb NOT NULL DEFAULT '{"x":0,"y":2,"z":10}',
  updated_at       timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id)
);

-- ── Index ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_neural_world_settings_org_id
  ON public.neural_world_settings(org_id);

-- ── Updated-at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.nw_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trig_nw_settings_updated_at ON public.neural_world_settings;
CREATE TRIGGER trig_nw_settings_updated_at
  BEFORE UPDATE ON public.neural_world_settings
  FOR EACH ROW EXECUTE PROCEDURE public.nw_set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.neural_world_settings ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's settings
CREATE POLICY "nw_settings_read"
  ON public.neural_world_settings FOR SELECT
  USING (org_id = auth.user_org_id());

-- Org members can insert settings for their org
CREATE POLICY "nw_settings_insert"
  ON public.neural_world_settings FOR INSERT
  WITH CHECK (org_id = auth.user_org_id());

-- Org members can update their own org's settings
CREATE POLICY "nw_settings_update"
  ON public.neural_world_settings FOR UPDATE
  USING (org_id = auth.user_org_id())
  WITH CHECK (org_id = auth.user_org_id());
