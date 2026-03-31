-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 040: Rebuild memory_embeddings with correct TEXT columns
-- V3 Session 6 — permanent fix for seedMemory / vector memory stabilization
--
-- IMPORTANT: Run this migration in Supabase SQL editor BEFORE deploying code.
-- Apply steps sequentially. Each step is idempotent or wrapped in DO blocks.
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════
-- Step 1: Backup existing data
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS memory_embeddings_backup
  AS SELECT * FROM memory_embeddings;

-- ══════════════════════════════════
-- Step 2: Drop existing table and functions
-- ══════════════════════════════════
DROP FUNCTION IF EXISTS upsert_memory CASCADE;
DROP FUNCTION IF EXISTS search_memories CASCADE;
DROP TABLE IF EXISTS memory_embeddings CASCADE;

-- ══════════════════════════════════
-- Step 3: Recreate with correct types
-- entity_id is TEXT (not UUID) — stores 'p1', 'sl001', etc.
-- ══════════════════════════════════
CREATE TABLE memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id)
    ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  -- TEXT not UUID — stores 'p1', 'sl001' etc
  agent_id TEXT,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, entity_type, entity_id)
);

CREATE INDEX idx_memory_user
  ON memory_embeddings(user_id);
CREATE INDEX idx_memory_embedding
  ON memory_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE memory_embeddings
  ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own memories"
  ON memory_embeddings FOR ALL
  USING (auth.uid() = user_id);

-- ══════════════════════════════════
-- Step 4: Recreate upsert_memory function
-- Parameters use p_user_id (not p_org_id) matching user-scoped auth model
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION upsert_memory(
  p_user_id UUID,
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_content TEXT,
  p_embedding vector(1536),
  p_metadata JSONB DEFAULT '{}'
) RETURNS void AS $$
BEGIN
  INSERT INTO memory_embeddings (
    user_id, entity_type, entity_id,
    content, embedding, metadata
  )
  VALUES (
    p_user_id, p_entity_type, p_entity_id,
    p_content, p_embedding, p_metadata
  )
  ON CONFLICT (user_id, entity_type, entity_id)
  DO UPDATE SET
    content = EXCLUDED.content,
    embedding = EXCLUDED.embedding,
    metadata = EXCLUDED.metadata,
    created_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ══════════════════════════════════
-- Step 5: Recreate search_memories function
-- Uses p_user_id, p_embedding, p_limit, p_threshold
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION search_memories(
  p_user_id UUID,
  p_embedding vector(1536),
  p_limit INT DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.7
) RETURNS TABLE (
  entity_type TEXT,
  entity_id TEXT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.entity_type,
    me.entity_id,
    me.content,
    me.metadata,
    1 - (me.embedding <=> p_embedding) as similarity
  FROM memory_embeddings me
  WHERE me.user_id = p_user_id
    AND 1 - (me.embedding <=> p_embedding)
      > p_threshold
  ORDER BY me.embedding <=> p_embedding
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE memory_embeddings IS
  'Migration 040: Rebuilt with TEXT entity_id (not UUID). '
  'Scoped per user_id. Used by NEXUS semantic search and seedMemory.';

COMMENT ON FUNCTION upsert_memory IS
  'Store or update a memory embedding. Upserts on (user_id, entity_type, entity_id).';

COMMENT ON FUNCTION search_memories IS
  'Semantic similarity search over a user''s memory_embeddings using pgvector cosine distance.';
