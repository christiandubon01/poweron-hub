// @ts-nocheck
/**
 * Vector Memory Service — High-level wrapper for pgvector embeddings.
 * Uses Netlify proxy for server-side embedding generation (preferred)
 * with fallback to direct OpenAI API call.
 */

import { storeMemory, searchMemory, chunkText, type MemoryRecord, type EntityType as BaseEntityType } from '@/lib/memory/embeddings'

// Extended entity types for Phase F
export type ExtendedEntityType = BaseEntityType | 'service_call' | 'field_log' | 'code_question' | 'agent_proposal' | 'conversation' | 'pattern'

// ── DB1 Vector Memory Query Cache (5-minute TTL) ──────────────────────────────
// Prevents redundant pgvector semantic searches when the same query is issued
// multiple times within a conversation session (e.g. NEXUS context enrichment
// firing on every message with similar content).
const _vectorQueryCache = new Map<string, { result: MemoryRecord[]; expiresAt: number }>()
const VECTOR_CACHE_TTL_MS = 5 * 60 * 1000  // 5 minutes

function buildCacheKey(
  orgId: string,
  query: string,
  options?: { entityType?: string; agentId?: string; limit?: number; threshold?: number }
): string {
  return `${orgId}::${query.trim().toLowerCase()}::${options?.entityType ?? ''}::${options?.agentId ?? ''}::${options?.limit ?? 5}::${options?.threshold ?? 0.65}`
}

/** Clear all cached vector query results (call after storing new memories). */
export function clearVectorQueryCache(): void {
  _vectorQueryCache.clear()
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate embedding via Netlify proxy (routed through lib/memory/embeddings).
 */
export async function embedText(text: string): Promise<number[]> {
  const { createEmbedding } = await import('@/lib/memory/embeddings')
  return createEmbedding(text)
}

/**
 * Store an entity memory with extended type support.
 */
export async function storeEntityMemory(params: {
  orgId: string
  entityType: ExtendedEntityType
  entityId?: string
  agentId?: string
  content: string
  metadata?: Record<string, unknown>
}): Promise<string | null> {
  // Invalidate query cache when new memory is stored so subsequent searches
  // reflect the newly stored content.
  clearVectorQueryCache()
  return storeMemory({
    orgId: params.orgId,
    entityType: params.entityType as BaseEntityType,
    entityId: params.entityId,
    agentId: params.agentId,
    content: params.content,
    metadata: params.metadata,
  })
}

/**
 * Search related memories with sensible defaults.
 *
 * DB1 optimization: results are cached in-memory for 5 minutes per unique
 * (orgId, query, options) combination to avoid redundant pgvector queries
 * when NEXUS enrichment fires on back-to-back messages with similar content.
 */
export async function getRelatedMemories(
  orgId: string,
  query: string,
  options?: {
    entityType?: ExtendedEntityType
    agentId?: string
    limit?: number
    threshold?: number
  }
): Promise<MemoryRecord[]> {
  const cacheKey = buildCacheKey(orgId, query, options)
  const cached = _vectorQueryCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result
  }

  const result = await searchMemory({
    orgId,
    query,
    entityType: options?.entityType as BaseEntityType | undefined,
    agentId: options?.agentId,
    limit: options?.limit ?? 5,
    threshold: options?.threshold ?? 0.65,
  })

  _vectorQueryCache.set(cacheKey, { result, expiresAt: Date.now() + VECTOR_CACHE_TTL_MS })
  return result
}

/**
 * Convenience: embed text and store in one call.
 */
export async function embedAndStore(
  orgId: string,
  entityType: ExtendedEntityType,
  content: string,
  entityId?: string,
  agentId?: string,
  metadata?: Record<string, unknown>
): Promise<string | null> {
  // For long content, chunk and store each piece
  const chunks = chunkText(content)

  if (chunks.length === 1) {
    return storeEntityMemory({ orgId, entityType, entityId, agentId, content, metadata })
  }

  // Store each chunk, return the first ID
  let firstId: string | null = null
  for (let i = 0; i < chunks.length; i++) {
    const chunkMeta = { ...metadata, chunk_index: i, total_chunks: chunks.length }
    const id = await storeEntityMemory({
      orgId,
      entityType,
      entityId: entityId ? `${entityId}_chunk_${i}` : undefined,
      agentId,
      content: chunks[i],
      metadata: chunkMeta,
    })
    if (i === 0) firstId = id
  }

  return firstId
}

/**
 * Batch embed and store multiple items.
 */
export async function batchEmbedAndStore(
  orgId: string,
  items: Array<{
    entityType: ExtendedEntityType
    content: string
    entityId?: string
    agentId?: string
    metadata?: Record<string, unknown>
  }>
): Promise<Array<string | null>> {
  const results: Array<string | null> = []

  for (const item of items) {
    try {
      const id = await embedAndStore(
        orgId,
        item.entityType,
        item.content,
        item.entityId,
        item.agentId,
        item.metadata
      )
      results.push(id)
    } catch (err) {
      console.error('[VectorMemory] batchEmbedAndStore item failed:', err)
      results.push(null)
    }
  }

  return results
}

// Re-export useful types
export type { MemoryRecord } from '@/lib/memory/embeddings'
