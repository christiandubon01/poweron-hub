// @ts-nocheck
/**
 * Vector memory layer — create and search embeddings via pgvector.
 *
 * Embeddings are created via an OpenAI API call (text-embedding-3-small, 1536d),
 * then stored in memory_embeddings via the upsert_memory() PostgreSQL function.
 * Retrieval uses the search_memory() function with cosine similarity.
 *
 * In Phase 01 the app scaffolding is wired up but agents won't call this
 * until Phase 02 when NEXUS and SCOUT are built.
 */

import { supabase } from '@/lib/supabase'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMS  = 1536
const EMBED_PROXY_URL = '/.netlify/functions/embed'

// ── Types ────────────────────────────────────────────────────────────────────

export type EntityType =
  | 'project' | 'estimate' | 'invoice' | 'rfi' | 'interaction'
  | 'proposal' | 'client'  | 'lead'    | 'compliance' | 'general'

export interface MemoryRecord {
  id:          string
  entity_type: EntityType
  entity_id:   string | null
  agent_id:    string | null
  content:     string
  similarity:  number
  metadata:    Record<string, unknown>
  created_at:  string
}

export interface CreateMemoryParams {
  orgId:      string
  entityType: EntityType
  entityId?:  string
  agentId?:   string
  content:    string
  metadata?:  Record<string, unknown>
}

export interface SearchMemoryParams {
  orgId:       string
  query:       string
  agentId?:    string
  entityType?: EntityType
  limit?:      number
  threshold?:  number
}


// ── OpenAI embedding ─────────────────────────────────────────────────────────

/**
 * Generate a 1536-dimensional embedding vector for the given text.
 * Routes through the Netlify serverless proxy at /.netlify/functions/embed
 * to keep the OPENAI_API_KEY server-side and avoid browser CORS issues.
 */
export async function createEmbedding(text: string): Promise<number[]> {
  const response = await fetch(EMBED_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text.slice(0, 8000) }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Embedding proxy failed: ${response.status} ${err}`)
  }

  const json = await response.json() as {
    data: Array<{ embedding: number[] }>
  }

  return json.data[0].embedding
}


// ── Store a memory ───────────────────────────────────────────────────────────

/**
 * Create and store a memory embedding for an entity.
 * Upserts — if a memory already exists for entity_id + agent_id, it's refreshed.
 */
export async function storeMemory(params: CreateMemoryParams): Promise<string | null> {
  try {
    const embedding = await createEmbedding(params.content)

    // Migration 040: upsert_memory now uses p_user_id (not p_org_id).
    // entity_id is TEXT NOT NULL — fallback to a generated id if not provided.
    // p_agent_id removed from function signature in 040.
    const { data, error } = await supabase.rpc('upsert_memory', {
      p_user_id:     params.orgId,
      p_entity_type: params.entityType,
      p_entity_id:   params.entityId   ?? crypto.randomUUID(),
      p_content:     params.content,
      p_embedding:   `[${embedding.join(',')}]`,
      p_metadata:    params.metadata   ?? {},
    })

    if (error) {
      console.error('[Memory] storeMemory error:', error)
      return null
    }

    return data as string
  } catch (err) {
    console.error('[Memory] storeMemory failed:', err)
    return null
  }
}


// ── Search memories ──────────────────────────────────────────────────────────

/**
 * Semantic search over the org's memory embeddings.
 * Returns results ordered by cosine similarity (most relevant first).
 */
export async function searchMemory(params: SearchMemoryParams): Promise<MemoryRecord[]> {
  try {
    const queryEmbedding = await createEmbedding(params.query)

    // Migration 040: function renamed search_memory → search_memories.
    // New signature: p_user_id, p_embedding, p_limit, p_threshold.
    // p_agent_id and p_entity_type removed — filter client-side if needed.
    const { data, error } = await supabase.rpc('search_memories', {
      p_user_id:   params.orgId,
      p_embedding: `[${queryEmbedding.join(',')}]`,
      p_limit:     params.limit     ?? 10,
      p_threshold: params.threshold ?? 0.70,
    })

    if (error) {
      console.warn('[Memory] searchMemory unavailable, continuing without memory context:', error.message || error)
      return []
    }

    return (data as MemoryRecord[]) ?? []
  } catch (err) {
    console.warn('[Memory] searchMemory unavailable, continuing without memory context:', err instanceof Error ? err.message : String(err))
    return []
  }
}


// ── Utility: chunk long text ─────────────────────────────────────────────────

/**
 * Split long content into chunks that fit within the embedding token limit.
 * Use when storing project descriptions, estimate details, etc.
 */
export function chunkText(text: string, maxChars = 6000): string[] {
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    let end = start + maxChars
    // Try to break at a sentence boundary
    const boundary = text.lastIndexOf('. ', end)
    if (boundary > start + maxChars * 0.5) end = boundary + 2
    chunks.push(text.slice(start, end).trim())
    start = end
  }

  return chunks
}

export { EMBEDDING_DIMS }
