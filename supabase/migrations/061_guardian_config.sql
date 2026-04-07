-- B51 | Guardian Agent Config
CREATE TABLE IF NOT EXISTS guardian_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);
