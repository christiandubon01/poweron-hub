// @ts-nocheck
/**
 * Memory Buckets Service
 *
 * Voice-first note capture with auto-tagging, Supabase persistence,
 * and localStorage fallback. Supports create/add/retrieve/list/delete.
 */

import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

export interface MemoryBucket {
  id: string
  org_id?: string
  user_id?: string
  bucket_name: string
  bucket_slug: string
  description?: string
  color: string
  active: boolean
  created_at: string
  updated_at: string
}

export interface MemoryEntry {
  id: string
  bucket_id: string
  org_id?: string
  user_id?: string
  content: string
  entry_type: string
  tags: string[]
  project_context?: string
  agent_context?: string
  source: string
  created_at: string
}

export interface BucketWithEntries extends MemoryBucket {
  entries: MemoryEntry[]
}

export interface BucketSummary extends MemoryBucket {
  entry_count: number
  last_entry_at?: string
}

// ── Constants ───────────────────────────────────────────────────────────────

const LS_BUCKETS_KEY = 'memory_buckets'
const LS_ENTRIES_KEY = 'memory_entries'
const DEFAULT_BUCKET_NAME = 'Field Notes'
const DEFAULT_BUCKET_SLUG = 'field-notes'

// ── Auto-tagging ────────────────────────────────────────────────────────────

export const autoTag = (content: string): string[] => {
  const tags: string[] = []
  if (/NEC|CEC|title 24|CBC|code|compliance/i.test(content)) tags.push('compliance-research')
  if (/research|look up|find out|investigate/i.test(content)) tags.push('research')
  if (/next week|schedule|plan|upcoming/i.test(content)) tags.push('scheduling')
  if (/material|supply|order|conduit|wire|panel|breaker/i.test(content)) tags.push('materials')
  if (/app|feature|improve|fix|bug|integrate|build/i.test(content)) tags.push('app-improvement')
  if (/estimate|quote|bid|proposal/i.test(content)) tags.push('estimating')
  if (/RTU|HVAC|solar|battery|EV|gate|access control/i.test(content)) tags.push('specialty-work')
  if (/client|customer|GC|follow.?up|call/i.test(content)) tags.push('relationship')
  return tags
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function generateId(): string {
  return `mb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

// ── localStorage helpers ────────────────────────────────────────────────────

function getLocalBuckets(): MemoryBucket[] {
  try {
    const raw = localStorage.getItem(LS_BUCKETS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function setLocalBuckets(buckets: MemoryBucket[]): void {
  try {
    localStorage.setItem(LS_BUCKETS_KEY, JSON.stringify(buckets))
  } catch (e) {
    console.error('[MemoryBuckets] Failed to persist buckets to localStorage:', e)
  }
}

function getLocalEntries(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_ENTRIES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function setLocalEntries(entries: MemoryEntry[]): void {
  try {
    localStorage.setItem(LS_ENTRIES_KEY, JSON.stringify(entries))
  } catch (e) {
    console.error('[MemoryBuckets] Failed to persist entries to localStorage:', e)
  }
}

// ── Ensure default "Field Notes" bucket exists ──────────────────────────────

async function ensureDefaultBucket(orgId?: string, userId?: string): Promise<MemoryBucket> {
  // Check local first
  const localBuckets = getLocalBuckets()
  const existing = localBuckets.find(b => b.bucket_slug === DEFAULT_BUCKET_SLUG)
  if (existing) return existing

  // Create default bucket
  const bucket: MemoryBucket = {
    id: generateId(),
    org_id: orgId,
    user_id: userId,
    bucket_name: DEFAULT_BUCKET_NAME,
    bucket_slug: DEFAULT_BUCKET_SLUG,
    description: 'Quick voice captures and field observations',
    color: '#2EE89A',
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Try Supabase
  if (userId) {
    try {
      const { data } = await supabase
        .from('memory_buckets')
        .insert({
          org_id: orgId,
          user_id: userId,
          bucket_name: bucket.bucket_name,
          bucket_slug: bucket.bucket_slug,
          description: bucket.description,
          color: bucket.color,
        })
        .select()
        .single()
      if (data) {
        bucket.id = data.id
      }
    } catch {
      // Supabase not available — localStorage fallback
    }
  }

  setLocalBuckets([...localBuckets, bucket])
  return bucket
}

// ── CRUD Operations ─────────────────────────────────────────────────────────

/**
 * Create a new memory bucket.
 */
export async function createBucket(
  name: string,
  orgId?: string,
  userId?: string,
  description?: string,
  color?: string
): Promise<MemoryBucket> {
  const slug = slugify(name)
  const localBuckets = getLocalBuckets()

  // Check if already exists
  const existing = localBuckets.find(b => b.bucket_slug === slug && b.active)
  if (existing) return existing

  const bucket: MemoryBucket = {
    id: generateId(),
    org_id: orgId,
    user_id: userId,
    bucket_name: name,
    bucket_slug: slug,
    description: description || '',
    color: color || '#2EE89A',
    active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Try Supabase
  if (userId) {
    try {
      const { data } = await supabase
        .from('memory_buckets')
        .insert({
          org_id: orgId,
          user_id: userId,
          bucket_name: name,
          bucket_slug: slug,
          description: bucket.description,
          color: bucket.color,
        })
        .select()
        .single()
      if (data) {
        bucket.id = data.id
      }
    } catch {
      console.warn('[MemoryBuckets] Supabase insert failed, using localStorage')
    }
  }

  setLocalBuckets([...localBuckets, bucket])
  console.log(`[MemoryBuckets] Created bucket: "${name}" (${slug})`)
  return bucket
}

/**
 * Add an entry to a named bucket. Auto-creates bucket if missing.
 */
export async function addEntry(
  bucketNameOrSlug: string,
  content: string,
  context?: { orgId?: string; userId?: string; projectContext?: string; agentContext?: string; source?: string }
): Promise<{ entry: MemoryEntry; bucket: MemoryBucket; totalEntries: number }> {
  const slug = slugify(bucketNameOrSlug)
  const localBuckets = getLocalBuckets()
  const localEntries = getLocalEntries()

  // Find or create bucket
  let bucket = localBuckets.find(b => b.bucket_slug === slug || b.bucket_name.toLowerCase() === bucketNameOrSlug.toLowerCase())
  if (!bucket) {
    bucket = await createBucket(bucketNameOrSlug, context?.orgId, context?.userId)
  }

  const tags = autoTag(content)

  const entry: MemoryEntry = {
    id: generateId(),
    bucket_id: bucket.id,
    org_id: context?.orgId,
    user_id: context?.userId,
    content,
    entry_type: 'note',
    tags,
    project_context: context?.projectContext,
    agent_context: context?.agentContext,
    source: context?.source || 'voice',
    created_at: new Date().toISOString(),
  }

  // Try Supabase
  if (context?.userId) {
    try {
      const { data } = await supabase
        .from('memory_entries')
        .insert({
          bucket_id: bucket.id,
          org_id: context.orgId,
          user_id: context.userId,
          content,
          entry_type: 'note',
          tags,
          project_context: context.projectContext,
          agent_context: context.agentContext,
          source: context.source || 'voice',
        })
        .select()
        .single()
      if (data) {
        entry.id = data.id
      }
    } catch {
      console.warn('[MemoryBuckets] Supabase entry insert failed, using localStorage')
    }
  }

  // Update bucket timestamp
  bucket.updated_at = new Date().toISOString()
  const updatedBuckets = localBuckets.map(b => b.id === bucket!.id ? bucket! : b)
  setLocalBuckets(updatedBuckets)

  const updatedEntries = [...localEntries, entry]
  setLocalEntries(updatedEntries)

  const totalEntries = updatedEntries.filter(e => e.bucket_id === bucket!.id).length

  console.log(`[MemoryBuckets] Added entry to "${bucket.bucket_name}": "${content.slice(0, 60)}..." [${tags.join(', ')}]`)
  return { entry, bucket, totalEntries }
}

/**
 * Passive capture — add to the default "Field Notes" bucket with auto-tags.
 */
export async function addPassiveCapture(
  content: string,
  context?: { orgId?: string; userId?: string; projectContext?: string; agentContext?: string }
): Promise<{ entry: MemoryEntry; bucket: MemoryBucket; totalEntries: number }> {
  const defaultBucket = await ensureDefaultBucket(context?.orgId, context?.userId)
  return addEntry(defaultBucket.bucket_name, content, { ...context, source: 'voice-passive' })
}

/**
 * Fuzzy bucket finder — matches by exact slug, exact name, partial slug,
 * or partial name (normalized, ignoring hyphens/spaces).
 */
function findBucketFuzzy(localBuckets: MemoryBucket[], nameOrSlug: string): MemoryBucket | undefined {
  const slug = slugify(nameOrSlug)
  const lower = nameOrSlug.toLowerCase().replace(/[-\s]+/g, '')
  const activeBuckets = localBuckets.filter(b => b.active)

  // 1. Exact slug match
  const exact = activeBuckets.find(b => b.bucket_slug === slug)
  if (exact) return exact

  // 2. Exact name match (case-insensitive)
  const nameMatch = activeBuckets.find(b => b.bucket_name.toLowerCase() === nameOrSlug.toLowerCase())
  if (nameMatch) return nameMatch

  // 3. Normalized match — strip hyphens/spaces and compare
  const normalized = activeBuckets.find(b => {
    const bNorm = b.bucket_name.toLowerCase().replace(/[-\s]+/g, '')
    const bSlugNorm = b.bucket_slug.replace(/-/g, '')
    return bNorm === lower || bSlugNorm === lower
  })
  if (normalized) return normalized

  // 4. Partial/contains match — input is substring of bucket name or vice versa
  const partial = activeBuckets.find(b => {
    const bNorm = b.bucket_name.toLowerCase().replace(/[-\s]+/g, '')
    return bNorm.includes(lower) || lower.includes(bNorm)
  })
  if (partial) return partial

  return undefined
}

/**
 * Get a bucket with all its entries, sorted by created_at DESC.
 */
export async function getBucket(
  nameOrSlug: string,
  orgId?: string,
  userId?: string
): Promise<BucketWithEntries | null> {
  const localBuckets = getLocalBuckets()
  const localEntries = getLocalEntries()

  const bucket = findBucketFuzzy(localBuckets, nameOrSlug)
  if (!bucket) return null

  // Try Supabase first for entries
  let entries: MemoryEntry[] = []
  if (userId) {
    try {
      const { data } = await supabase
        .from('memory_entries')
        .select('*')
        .eq('bucket_id', bucket.id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (data && data.length > 0) {
        entries = data as MemoryEntry[]
      }
    } catch {
      // Fallback to local
    }
  }

  // Merge local entries
  const localBucketEntries = localEntries
    .filter(e => e.bucket_id === bucket.id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Deduplicate: by content + close timestamp (within 5 seconds)
  const seen = new Set<string>()
  const merged: MemoryEntry[] = []
  for (const e of [...entries, ...localBucketEntries]) {
    const key = `${e.content}|${Math.floor(new Date(e.created_at).getTime() / 5000)}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(e)
    }
  }

  // Sort DESC
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  return { ...bucket, entries: merged }
}

/**
 * List all active buckets with entry counts.
 */
export async function listBuckets(
  orgId?: string,
  userId?: string
): Promise<BucketSummary[]> {
  const localBuckets = getLocalBuckets().filter(b => b.active)
  const localEntries = getLocalEntries()

  // Try to merge from Supabase
  if (userId) {
    try {
      const { data: sbBuckets } = await supabase
        .from('memory_buckets')
        .select('*')
        .eq('user_id', userId)
        .eq('active', true)

      if (sbBuckets && sbBuckets.length > 0) {
        // Merge — deduplicate by slug
        const slugSet = new Set(localBuckets.map(b => b.bucket_slug))
        for (const sb of sbBuckets as MemoryBucket[]) {
          if (!slugSet.has(sb.bucket_slug)) {
            localBuckets.push(sb)
            slugSet.add(sb.bucket_slug)
          }
        }
        // Persist merged set locally
        setLocalBuckets(localBuckets)
      }
    } catch {
      // Non-critical
    }
  }

  return localBuckets.map(bucket => {
    const bucketEntries = localEntries.filter(e => e.bucket_id === bucket.id)
    const lastEntry = bucketEntries.sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]

    return {
      ...bucket,
      entry_count: bucketEntries.length,
      last_entry_at: lastEntry?.created_at,
    }
  })
}

/**
 * Soft-delete an entry (removes from local, marks deleted in Supabase).
 */
export async function deleteEntry(entryId: string, userId?: string): Promise<boolean> {
  const localEntries = getLocalEntries()
  const filtered = localEntries.filter(e => e.id !== entryId)

  if (filtered.length === localEntries.length) return false // Not found

  setLocalEntries(filtered)

  // Try Supabase delete
  if (userId) {
    try {
      await supabase
        .from('memory_entries')
        .delete()
        .eq('id', entryId)
        .eq('user_id', userId)
    } catch {
      // Non-critical
    }
  }

  console.log(`[MemoryBuckets] Deleted entry: ${entryId}`)
  return true
}

/**
 * Get all saved entries (for voice retrieval — "what did I save?")
 */
export async function getAllEntries(
  userId?: string,
  limit = 20
): Promise<MemoryEntry[]> {
  const localEntries = getLocalEntries()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)

  return localEntries
}

/**
 * Initialize — merge Supabase + localStorage, deduplicate.
 * Call once on app startup.
 */
export async function initMemoryBuckets(orgId?: string, userId?: string): Promise<void> {
  if (!userId) return

  try {
    // Sync buckets
    const { data: sbBuckets } = await supabase
      .from('memory_buckets')
      .select('*')
      .eq('user_id', userId)

    if (sbBuckets && sbBuckets.length > 0) {
      const localBuckets = getLocalBuckets()
      const slugSet = new Set(localBuckets.map(b => b.bucket_slug))
      for (const sb of sbBuckets as MemoryBucket[]) {
        if (!slugSet.has(sb.bucket_slug)) {
          localBuckets.push(sb)
          slugSet.add(sb.bucket_slug)
        }
      }
      setLocalBuckets(localBuckets)
    }

    // Sync entries
    const { data: sbEntries } = await supabase
      .from('memory_entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(200)

    if (sbEntries && sbEntries.length > 0) {
      const localEntries = getLocalEntries()
      const seen = new Set<string>()
      for (const e of localEntries) {
        seen.add(`${e.content}|${Math.floor(new Date(e.created_at).getTime() / 5000)}`)
      }
      for (const sb of sbEntries as MemoryEntry[]) {
        const key = `${sb.content}|${Math.floor(new Date(sb.created_at).getTime() / 5000)}`
        if (!seen.has(key)) {
          localEntries.push(sb)
          seen.add(key)
        }
      }
      setLocalEntries(localEntries)
    }

    console.log('[MemoryBuckets] Initialized — Supabase + localStorage merged')
  } catch (err) {
    console.warn('[MemoryBuckets] Init sync failed, using localStorage only:', err)
  }
}

/**
 * Ensure default buckets exist on first load.
 * Call once at app startup alongside initMemoryBuckets.
 */
export async function initDefaultBuckets(orgId?: string, userId?: string): Promise<void> {
  await ensureDefaultBucket(orgId, userId)
  console.log('[MemoryBuckets] Default buckets ensured')
}
