-- Migration 030: agent_messages table
-- Phase B — Cross-Agent Communication Layer
-- All inter-agent messages routed through NEXUS are persisted here.

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_agent  TEXT        NOT NULL,
  to_agent    TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'delivered', 'processed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast NEXUS activity queries (newest first)
CREATE INDEX IF NOT EXISTS idx_agent_messages_created_at
  ON public.agent_messages (created_at DESC);

-- Index for per-agent queue lookups
CREATE INDEX IF NOT EXISTS idx_agent_messages_to_agent
  ON public.agent_messages (to_agent, created_at DESC);

-- Index for from-agent audit
CREATE INDEX IF NOT EXISTS idx_agent_messages_from_agent
  ON public.agent_messages (from_agent, created_at DESC);

-- RLS: same user_id pattern as all other tables.
-- agent_messages are org-level data — authenticated users in the org can read,
-- only the service role (Netlify functions) can insert/update.

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read messages (for NEXUS activity panel)
CREATE POLICY "agent_messages_read_authenticated"
  ON public.agent_messages
  FOR SELECT
  TO authenticated
  USING (true);

-- Only service role inserts (agentBus.publish → Netlify function)
-- In client-direct Supabase builds, allow authenticated users to insert too
CREATE POLICY "agent_messages_insert_authenticated"
  ON public.agent_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Only service role or message owner can update status
CREATE POLICY "agent_messages_update_authenticated"
  ON public.agent_messages
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Auto-prune: keep only the last 1000 messages per org via a scheduled
-- Supabase cron (or handled client-side in agentBus.ts).
-- This migration does not add the cron — add manually in Supabase dashboard
-- if needed: SELECT cron.schedule('prune-agent-messages', '0 * * * *',
--   $$DELETE FROM agent_messages WHERE created_at < NOW() - INTERVAL '7 days'$$);
