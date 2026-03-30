// @ts-nocheck
/**
 * Embedding Service — Phase F canonical API for vector memory operations.
 *
 * This is the primary interface agents should use for all embedding work.
 * It wraps the lower-level vectorMemory.ts + lib/memory/embeddings.ts with
 * a simpler, spec-aligned API.
 *
 * Functions:
 *   embedText(text)                          — generate embedding vector
 *   storeEmbedding(entityType, entityId, content, metadata)  — embed + store
 *   searchSimilar(query, entityType?, limit?) — semantic search, top-N results
 *   seedMemory()                             — one-time seed of all existing data
 */

import { embedAndStore, getRelatedMemories, batchEmbedAndStore, type ExtendedEntityType } from '@/services/vectorMemory'
import { createEmbedding } from '@/lib/memory/embeddings'
import { getBackupData } from '@/services/backupDataService'

// ── Re-export types used across the app ─────────────────────────────────────
export type { ExtendedEntityType }

// ── Org ID fallback (used when no explicit orgId is passed) ──────────────────
// In the PowerOn app, the user's org ID is stored in Supabase user metadata
// or can be read from the backup state. We use a stable default for single-org apps.
const DEFAULT_ORG_ID = 'poweron-default-org'

function resolveOrgId(orgId?: string): string {
  return orgId || DEFAULT_ORG_ID
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Generate a 1536-dim embedding for the given text.
 * Routes through Netlify proxy via createEmbedding (server-side key, no CORS).
 */
export async function embedText(text: string): Promise<number[]> {
  return createEmbedding(text)
}

/**
 * Embed content and store it in the memory_embeddings table.
 * Fire-and-forget safe — always call without await from agent write paths.
 *
 * @param entityType  - e.g. 'estimate', 'project', 'payment', 'compliance_flag', 'scout_finding'
 * @param entityId    - string ID of the source record
 * @param content     - human-readable text describing the record
 * @param metadata    - optional JSON metadata attached to the record
 * @param orgId       - org context (defaults to DEFAULT_ORG_ID)
 */
export async function storeEmbedding(
  entityType: ExtendedEntityType,
  entityId: string,
  content: string,
  metadata?: Record<string, unknown>,
  orgId?: string
): Promise<string | null> {
  try {
    return await embedAndStore(resolveOrgId(orgId), entityType, content, entityId, undefined, metadata)
  } catch (err) {
    // Never throw from fire-and-forget paths
    console.warn('[EmbeddingService] storeEmbedding failed (non-critical):', err)
    return null
  }
}

/**
 * Semantic similarity search over memory_embeddings.
 * Returns top `limit` results ordered by cosine similarity.
 *
 * @param query      - natural language search query
 * @param entityType - optional filter to a specific entity type
 * @param limit      - max results (default 5)
 * @param orgId      - org context
 */
export async function searchSimilar(
  query: string,
  entityType?: ExtendedEntityType,
  limit = 5,
  orgId?: string
): Promise<Array<{
  id: string
  entity_type: string
  entity_id: string | null
  content: string
  similarity: number
  metadata: Record<string, unknown>
  created_at: string
}>> {
  try {
    const results = await getRelatedMemories(resolveOrgId(orgId), query, {
      entityType,
      limit,
      threshold: 0.60, // slightly lower threshold for broader discovery
    })
    return results
  } catch (err) {
    console.warn('[EmbeddingService] searchSimilar failed:', err)
    return []
  }
}

// ── Seed Memory ──────────────────────────────────────────────────────────────

/**
 * One-time seed of all existing app data into memory_embeddings.
 *
 * Reads from the app backup state (projects, estimates, serviceLogs, field logs)
 * and embeds each record. Safe to call multiple times — embedAndStore upserts.
 *
 * Exposed on window.__memory.seedMemory() for console testing.
 * Returns a summary of what was seeded.
 */
export async function seedMemory(orgId?: string): Promise<{
  seeded: number
  errors: number
  summary: string
}> {
  const resolvedOrgId = resolveOrgId(orgId)
  const backup = getBackupData()

  if (!backup) {
    return { seeded: 0, errors: 0, summary: 'No backup data found — open the app first to load state.' }
  }

  let seeded = 0
  let errors = 0
  const batchItems: Array<{
    entityType: ExtendedEntityType
    content: string
    entityId: string
    agentId: string
    metadata: Record<string, unknown>
  }> = []

  // ── Projects ──────────────────────────────────────────────────────────────
  const projects = backup.projects || []
  for (const p of projects) {
    if (!p) continue
    const content = [
      `Project: ${p.name || 'Unnamed'}`,
      p.type ? `Type: ${p.type}` : '',
      p.status ? `Status: ${p.status}` : '',
      p.contract ? `Contract: $${p.contract}` : '',
      p.notes ? `Notes: ${String(p.notes).slice(0, 200)}` : '',
    ].filter(Boolean).join('. ')

    batchItems.push({
      entityType: 'project',
      content,
      entityId: String(p.id || p.projectCode || `proj_${Math.random()}`),
      agentId: 'blueprint',
      metadata: { project_type: p.type, status: p.status, contract: p.contract },
    })
  }

  // ── Estimates (from project laborRows/matRows) ────────────────────────────
  for (const p of projects) {
    if (!p) continue
    const laborRows = p.laborRows || []
    const matRows = p.matRows || p.mtoRows || []
    if (laborRows.length === 0 && matRows.length === 0) continue

    const lineItemText = [
      ...laborRows.map((r: any) => r.description || r.task || r.name || '').filter(Boolean),
      ...matRows.map((r: any) => r.description || r.name || r.item || '').filter(Boolean),
    ].join(', ')

    if (lineItemText.length < 5) continue

    const content = `Estimate for ${p.name || 'project'}: ${lineItemText.slice(0, 600)}`
    batchItems.push({
      entityType: 'estimate',
      content,
      entityId: `est_proj_${p.id || p.projectCode}`,
      agentId: 'vault',
      metadata: { project_id: p.id, project_name: p.name },
    })
  }

  // ── Service Calls ─────────────────────────────────────────────────────────
  const serviceLogs = backup.serviceLogs || []
  for (const s of serviceLogs) {
    if (!s) continue
    const content = [
      s.customer ? `Customer: ${s.customer}` : '',
      s.jtype ? `Job type: ${s.jtype}` : '',
      s.notes ? `Notes: ${String(s.notes).slice(0, 200)}` : '',
      s.quoted ? `Quoted: $${s.quoted}` : '',
      s.collected ? `Collected: $${s.collected}` : '',
    ].filter(Boolean).join('. ')

    if (content.length < 10) continue

    batchItems.push({
      entityType: 'service_call',
      content,
      entityId: String(s.id || `svc_${Math.random()}`),
      agentId: 'ledger',
      metadata: {
        job_type: s.jtype,
        customer: s.customer,
        quoted: s.quoted,
        collected: s.collected,
        date: s.date,
      },
    })
  }

  // ── Field Logs ────────────────────────────────────────────────────────────
  const fieldLogs = backup.logs || backup.fieldLogs || []
  for (const log of fieldLogs) {
    if (!log) continue
    const content = [
      log.note || log.notes || log.text || log.description || '',
      log.employee ? `Employee: ${log.employee}` : '',
      log.projectId ? `Project: ${log.projectId}` : '',
    ].filter(s => s.length > 3).join('. ')

    if (content.length < 10) continue

    batchItems.push({
      entityType: 'field_log',
      content: content.slice(0, 400),
      entityId: String(log.id || `log_${Math.random()}`),
      agentId: 'blueprint',
      metadata: { project_id: log.projectId, date: log.date },
    })
  }

  // ── Batch store ───────────────────────────────────────────────────────────
  console.log(`[SeedMemory] Seeding ${batchItems.length} items to vector memory...`)

  // Process in batches of 10 to avoid rate limits
  const BATCH_SIZE = 10
  for (let i = 0; i < batchItems.length; i += BATCH_SIZE) {
    const batch = batchItems.slice(i, i + BATCH_SIZE)
    try {
      const results = await batchEmbedAndStore(resolvedOrgId, batch)
      seeded += results.filter(r => r !== null).length
      errors += results.filter(r => r === null).length
    } catch (err) {
      console.warn('[SeedMemory] Batch failed:', err)
      errors += batch.length
    }
    // Small delay between batches
    if (i + BATCH_SIZE < batchItems.length) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  const summary = `Seeded ${seeded} records (${errors} errors). Sources: ${projects.length} projects, ${serviceLogs.length} service calls, ${fieldLogs.length} field logs.`
  console.log('[SeedMemory] Done:', summary)

  return { seeded, errors, summary }
}

// ── Console helper exposure ───────────────────────────────────────────────────
// Expose on window for manual testing: window.__memory.seedMemory()
if (typeof window !== 'undefined') {
  (window as any).__memory = {
    seedMemory,
    searchSimilar,
    embedText,
    storeEmbedding,
  }
}
