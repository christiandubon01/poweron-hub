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

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMS  = 1536

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
 * Throws if OPENAI_API_KEY is not set.
 */
export async function createEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error(
      'VITE_OPENAI_API_KEY is not set. Add it to .env.local to enable memory embeddings.'
    )
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8000),  // max token limit safety
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenAI embedding failed: ${response.status} ${err}`)
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

    const { data, error } = await supabase.rpc('upsert_memory', {
      p_org_id:      params.orgId,
      p_entity_type: params.entityType,
      p_entity_id:   params.entityId   ?? null,
      p_agent_id:    params.agentId    ?? null,
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

    const { data, error } = await supabase.rpc('search_memory', {
      p_org_id:          params.orgId,
      p_query_embedding: `[${queryEmbedding.join(',')}]`,
      p_agent_id:        params.agentId    ?? null,
      p_entity_type:     params.entityType ?? null,
      p_limit:           params.limit      ?? 10,
      p_threshold:       params.threshold  ?? 0.70,
    })

    if (error) {
      console.error('[Memory] searchMemory error:', error)
      return []
    }

    return (data as MemoryRecord[]) ?? []
  } catch (err) {
    console.error('[Memory] searchMemory failed:', err)
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
