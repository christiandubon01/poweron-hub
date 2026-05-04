-- Migration 077: Yelp Ad Spend Tracker
CREATE TABLE IF NOT EXISTS yelp_spend_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month text NOT NULL,
  daily_budget numeric(10,2) NOT NULL DEFAULT 0,
  monthly_spend numeric(10,2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yelp_spend_user ON yelp_spend_log(user_id);
ALTER TABLE yelp_spend_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY yelp_spend_user_isolation ON yelp_spend_log FOR ALL USING (auth.uid() = user_id);
