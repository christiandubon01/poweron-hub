-- ══════════════════════════════════════════════════════════════════════════════
-- PowerOn Hub — Migration 035: Vector Memory Phase F Extensions
-- Phase F — vector memory + pattern learning
--
-- NOTE: memory_embeddings already exists from migration 004 with org-scoped
-- schema. This migration adds:
--   1. learned_patterns table — persists detected business patterns to Supabase
--   2. Expanded entity_type check for memory_embeddings (service_call, field_log,
--      compliance_flag, scout_finding, pattern — new Phase F types)
--   3. seedMemory console helper exposure marker
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════
-- 1. LEARNED PATTERNS TABLE
-- Stores recurring business patterns discovered from data writes.
-- Persisted per org (not per user) to enable cross-session learning.
-- ══════════════════════════════════
CREATE TABLE IF NOT EXISTS learned_patterns (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pattern_type  TEXT NOT NULL,  -- material_cost_pattern, job_duration_pattern, lead_source_pattern, compliance_flag_pattern
  description   TEXT NOT NULL,
  confidence    NUMERIC(3,2)   DEFAULT 0.50,
  source_count  INT            DEFAULT 1,
  last_seen     TIMESTAMPTZ    DEFAULT NOW(),
  metadata      JSONB          DEFAULT '{}',
  created_at    TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learned_patterns_org
  ON learned_patterns(org_id, pattern_type);
CREATE INDEX IF NOT EXISTS idx_learned_patterns_confidence
  ON learned_patterns(org_id, confidence DESC);

-- RLS
ALTER TABLE learned_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Org members can read patterns"
  ON learned_patterns FOR SELECT
  USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY IF NOT EXISTS "Org members can manage patterns"
  ON learned_patterns FOR ALL
  USING (
    org_id IN (
      SELECT org_id FROM org_members WHERE user_id = auth.uid()
    )
  );

-- ══════════════════════════════════
-- 2. EXPAND ENTITY TYPES
-- The original migration 004 constrains entity_type to a fixed list.
-- Drop and recreate the check constraint to include Phase F types.
-- ══════════════════════════════════

-- Remove old check constraint (if it exists by the default name)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'CHECK'
      AND table_name = 'memory_embeddings'
      AND constraint_name LIKE '%entity_type%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE memory_embeddings DROP CONSTRAINT ' || constraint_name
      FROM information_schema.table_constraints
      WHERE constraint_type = 'CHECK'
        AND table_name = 'memory_embeddings'
        AND constraint_name LIKE '%entity_type%'
      LIMIT 1
    );
  END IF;
END;
$$;

-- Add expanded constraint
ALTER TABLE memory_embeddings
  ADD CONSTRAINT memory_embeddings_entity_type_check
    CHECK (entity_type IN (
      'project', 'estimate', 'invoice', 'rfi', 'interaction',
      'proposal', 'client', 'lead', 'compliance', 'general',
      -- Phase F additions
      'service_call', 'field_log', 'compliance_flag', 'scout_finding', 'pattern', 'payment'
    ));

-- ══════════════════════════════════
-- 3. PATTERN UPSERT FUNCTION
-- Agents call this to store/update a learned pattern.
-- Deduplicates by org + pattern_type + description prefix.
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION upsert_pattern(
  p_org_id       UUID,
  p_pattern_type TEXT,
  p_description  TEXT,
  p_confidence   NUMERIC DEFAULT 0.5,
  p_metadata     JSONB   DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
  v_prefix TEXT;
BEGIN
  -- Use first 80 chars of description as dedup key
  v_prefix := LEFT(p_description, 80);

  -- Try update first
  UPDATE learned_patterns
  SET
    confidence   = GREATEST(confidence, p_confidence),
    source_count = source_count + 1,
    last_seen    = NOW(),
    metadata     = p_metadata
  WHERE org_id       = p_org_id
    AND pattern_type = p_pattern_type
    AND LEFT(description, 80) = v_prefix
  RETURNING id INTO v_id;

  -- Insert if no match
  IF v_id IS NULL THEN
    INSERT INTO learned_patterns (org_id, pattern_type, description, confidence, metadata)
    VALUES (p_org_id, p_pattern_type, p_description, p_confidence, p_metadata)
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION upsert_pattern IS
  'Store or increment a learned business pattern for an org. '
  'Deduplicates on first 80 chars of description. Increments source_count on repeat.';

-- ══════════════════════════════════
-- 4. GET PATTERNS FUNCTION
-- Returns patterns for an org sorted by confidence DESC.
-- Optionally filter by pattern_type.
-- ══════════════════════════════════
CREATE OR REPLACE FUNCTION get_patterns(
  p_org_id       UUID,
  p_pattern_type TEXT  DEFAULT NULL,
  p_limit        INT   DEFAULT 20
)
RETURNS TABLE (
  id           UUID,
  pattern_type TEXT,
  description  TEXT,
  confidence   NUMERIC,
  source_count INT,
  last_seen    TIMESTAMPTZ,
  metadata     JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    lp.id,
    lp.pattern_type,
    lp.description,
    lp.confidence,
    lp.source_count,
    lp.last_seen,
    lp.metadata
  FROM learned_patterns lp
  WHERE lp.org_id = p_org_id
    AND (p_pattern_type IS NULL OR lp.pattern_type = p_pattern_type)
  ORDER BY lp.confidence DESC, lp.source_count DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON TABLE learned_patterns IS
  'Phase F: Stores recurring business patterns detected by agents. '
  'Updated by patternService.analyzeAfterWrite() on every data write.';
