-- B49 — hub_platform_events: track platform-level events (sessions, agent calls, deploys, etc.)

CREATE TABLE IF NOT EXISTS hub_platform_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type text NOT NULL,
  event_label text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_events_type
  ON hub_platform_events(event_type);
CREATE INDEX IF NOT EXISTS idx_hub_events_created
  ON hub_platform_events(created_at DESC);

ALTER TABLE hub_platform_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read" ON hub_platform_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated insert" ON hub_platform_events
  FOR INSERT TO authenticated WITH CHECK (true);
