-- Migration 053: Create missing tables (snapshots, profiles)
-- Run manually in Supabase SQL editor for project edxxbtyugohtowvslbfo

CREATE TABLE IF NOT EXISTS public.snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id TEXT,
  user_id UUID,
  snapshot_data JSONB,
  label TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE,
  audit_token TEXT,
  org_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
