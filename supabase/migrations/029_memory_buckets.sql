-- 029_memory_buckets.sql
-- Memory bucket system for NEXUS — voice-first note capture with auto-tagging

CREATE TABLE memory_buckets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket_name text NOT NULL,
  bucket_slug text NOT NULL,
  description text,
  color text DEFAULT '#2EE89A',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, bucket_slug)
);

CREATE TABLE memory_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id uuid REFERENCES memory_buckets(id) ON DELETE CASCADE,
  org_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  entry_type text DEFAULT 'note',
  tags text[],
  project_context text,
  agent_context text,
  source text DEFAULT 'voice',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE memory_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own buckets" ON memory_buckets FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own entries" ON memory_entries FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_memory_entries_bucket ON memory_entries(bucket_id);
CREATE INDEX idx_memory_entries_user ON memory_entries(user_id, created_at DESC);
CREATE INDEX idx_memory_entries_tags ON memory_entries USING gin(tags);
