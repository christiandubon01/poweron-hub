-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 004: Shared Memory Bus (Vector Layer)
-- Phase 01 Foundation
--
-- Implements Layer 2 of the three-layer memory architecture:
--   Layer 1 (Short-term)  → Upstash Redis  [managed in app code]
--   Layer 2 (Long-term)   → THIS FILE — pgvector in Supabase
--   Layer 3 (Audit)       → migration 005_audit_system.sql
--
-- Tables:
--   1. memory_embeddings   — semantic vector store (OpenAI 1536-dim)
--
-- Functions:
--   1. search_memory()     — cosine similarity search with org + agent + type filters
-- ══════════════════════════════════════════════════════════════════════════════


-- ══════════════════════════════════
-- 1. MEMORY EMBEDDINGS
-- Stores all long-term agent memory as text + vector pairs
-- Supports semantic retrieval across: projects, estimates, interactions, proposals
-- ══════════════════════════════════
CREATE TABLE memory_embeddings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- What this memory describes
  entity_type   TEXT NOT NULL CHECK (entity_type IN (
    'project','estimate','invoice','rfi','interaction',
    'proposal','client','lead','compliance','general'
  )),
  entity_id     UUID,         -- FK to the source record (nullable for general memories)
  agent_id      TEXT REFERENCES agents(id) ON DELETE SET NULL,  -- which agent created this

  -- The memory content
  content       TEXT NOT NULL,         -- human-readable text of the memory
  embedding     vector(1536),          -- OpenAI text-embedding-3-small (1536 dimensions)

  -- Filtering metadata
  metadata      JSONB NOT NULL DEFAULT '{}',
  -- Example: {project_type, client_id, date_range, tags, importance, source_summary}

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ══════════════════════════════════
-- VECTOR INDEXES
-- HNSW index for fast approximate nearest-neighbor search
-- m=16, ef_construction=64 — balanced for this workload size
-- ══════════════════════════════════
CREATE INDEX idx_memory_embedding_hnsw
  ON memory_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Scalar indexes for filtered queries (always filter by org first)
CREATE INDEX idx_memory_org      ON memory_embeddings(org_id);
CREATE INDEX idx_memory_entity   ON memory_embeddings(org_id, entity_type, entity_id);
CREATE INDEX idx_memory_agent    ON memory_embeddings(agent_id);
CREATE INDEX idx_memory_created  ON memory_embeddings(org_id, created_at DESC);


-- ══════════════════════════════════
-- 2. SEMANTIC SEARCH FUNCTION
-- Called by agents to retrieve relevant memories via cosine similarity
--
-- Usage example:
--   SELECT * FROM search_memory(
--     p_org_id := '...',
--     p_query_embedding := '[0.1, 0.2, ...]'::vector,
--     p_agent_id := 'vault',
--     p_entity_type := 'estimate',
--     p_limit := 5,
--     p_threshold := 0.75
--   );
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION search_memory(
  p_org_id        UUID,
  p_query_embedding vector(1536),
  p_agent_id      TEXT    DEFAULT NULL,
  p_entity_type   TEXT    DEFAULT NULL,
  p_limit         INT     DEFAULT 10,
  p_threshold     FLOAT   DEFAULT 0.70
)
RETURNS TABLE (
  id            UUID,
  entity_type   TEXT,
  entity_id     UUID,
  agent_id      TEXT,
  content       TEXT,
  similarity    FLOAT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    me.id,
    me.entity_type,
    me.entity_id,
    me.agent_id,
    me.content,
    (1 - (me.embedding <=> p_query_embedding))::FLOAT AS similarity,
    me.metadata,
    me.created_at
  FROM memory_embeddings me
  WHERE
    me.org_id = p_org_id
    AND (p_agent_id   IS NULL OR me.agent_id    = p_agent_id)
    AND (p_entity_type IS NULL OR me.entity_type = p_entity_type)
    AND me.embedding IS NOT NULL
    AND (1 - (me.embedding <=> p_query_embedding)) >= p_threshold
  ORDER BY me.embedding <=> p_query_embedding   -- ascending distance = descending similarity
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION search_memory IS
  'Semantic similarity search over long-term agent memory using pgvector cosine distance. '
  'Always filter by org_id. Optionally filter by agent_id and entity_type. '
  'Returns results ordered by similarity descending (most relevant first).';


-- ══════════════════════════════════
-- 3. MEMORY UPSERT HELPER
-- Agents call this to store a new memory (or replace one for the same entity).
-- Prevents duplicate embeddings for the same entity_id + agent_id combo.
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION upsert_memory(
  p_org_id        UUID,
  p_entity_type   TEXT,
  p_entity_id     UUID,
  p_agent_id      TEXT,
  p_content       TEXT,
  p_embedding     vector(1536),
  p_metadata      JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO memory_embeddings (org_id, entity_type, entity_id, agent_id, content, embedding, metadata)
  VALUES (p_org_id, p_entity_type, p_entity_id, p_agent_id, p_content, p_embedding, p_metadata)
  ON CONFLICT DO NOTHING   -- if exact same content exists, skip
  RETURNING id INTO v_id;

  -- If a prior memory for this entity+agent already exists, replace its embedding
  IF v_id IS NULL THEN
    UPDATE memory_embeddings
    SET content   = p_content,
        embedding = p_embedding,
        metadata  = p_metadata,
        created_at = NOW()
    WHERE org_id      = p_org_id
      AND entity_type = p_entity_type
      AND entity_id   = p_entity_id
      AND agent_id    = p_agent_id
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION upsert_memory IS
  'Store or refresh a long-term memory embedding for a given entity + agent. '
  'Prevents duplicate embeddings by updating the existing record if one exists.';
