CREATE TABLE IF NOT EXISTS field_observation_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id text NOT NULL,
  project_name text,
  zone text,
  source text DEFAULT 'voice',
  original_sequence text,
  observed_condition text,
  blocking_dependency text,
  revised_sequence text,
  urgency text DEFAULT 'before_next_mobilization',
  affects text[] DEFAULT '{}',
  ai_summary text,
  next_action text,
  next_action_due text,
  status text DEFAULT 'open',
  photo_ids text[] DEFAULT '{}',
  transcript text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE field_observation_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON field_observation_cards
  FOR ALL USING (org_id = (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  ));
CREATE INDEX ON field_observation_cards(org_id, project_id);
CREATE INDEX ON field_observation_cards(org_id, status);
