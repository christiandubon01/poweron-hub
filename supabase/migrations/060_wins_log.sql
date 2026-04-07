-- B51 | Wins Log
CREATE TABLE IF NOT EXISTS wins_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  category text NOT NULL,
  impact text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE wins_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_wins ON wins_log FOR SELECT TO authenticated USING (true);
CREATE POLICY insert_wins ON wins_log FOR INSERT TO authenticated WITH CHECK (true);
