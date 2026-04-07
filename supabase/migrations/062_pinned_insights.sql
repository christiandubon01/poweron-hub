-- B52: Pinned Insights table
CREATE TABLE IF NOT EXISTS pinned_insights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,        -- 'nexus' or 'katsuro'
  content text NOT NULL,
  context text,                -- what the user was doing when they pinned it
  category text,               -- agent name or topic
  pinned_at timestamptz DEFAULT now()
);

ALTER TABLE pinned_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_insights ON pinned_insights
  FOR SELECT TO authenticated USING (true);

CREATE POLICY insert_insights ON pinned_insights
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY delete_insights ON pinned_insights
  FOR DELETE TO authenticated USING (true);
