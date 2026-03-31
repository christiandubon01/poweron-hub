// @ts-nocheck
/**
 * voiceJournalService — Voice journal layer for NEXUS.
 *
 * Provides save, search, retrieval, and plain-English summary functions
 * for the voice_journal Supabase table (migration 037).
 *
 * V3 Session 2 additions: semanticSearch() + searchJournal() upgraded to
 * try semantic search first, fall back to text search on failure.
 *
 * Additive only — no existing service logic modified.
 */

import { supabase } from '@/lib/supabase'
import { createEmbedding } from '@/lib/memory/embeddings'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JournalEntry {
  id: string
  raw_transcript: string
  context_tag: string
  job_reference?: string
  action_items: string[]
  created_at: string
}

// ── Action item extraction ─────────────────────────────────────────────────────

/**
 * Extracts action items from transcript using simple keyword detection.
 * Any sentence containing a trigger keyword becomes an action item.
 */
const ACTION_KEYWORDS = [
  'need', 'must', 'have to', 'remind', 'remember',
  'follow up', 'call', 'order', 'buy', 'fix',
  'check', 'schedule',
]

function extractActionItems(transcript: string): string[] {
  // Split into sentences (period, exclamation, question mark, or "and" as separator)
  const sentences = transcript
    .split(/(?<=[.!?])\s+|(?<=\band\b)\s+/i)
    .map(s => s.trim())
    .filter(s => s.length > 4)

  const items: string[] = []
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    const hasKeyword = ACTION_KEYWORDS.some(kw => {
      // Match whole-word and multi-word keywords
      if (kw.includes(' ')) {
        return lower.includes(kw)
      }
      return new RegExp(`\\b${kw}\\b`).test(lower)
    })
    if (hasKeyword) {
      items.push(sentence)
    }
  }
  return items
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Save a voice journal entry.
 * Extracts action items automatically from the transcript.
 * Returns null silently if there is no authenticated user.
 */
export async function saveJournalEntry(params: {
  transcript: string
  contextTag?: string
  jobReference?: string
}): Promise<JournalEntry | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const actionItems = extractActionItems(params.transcript)
    const contextTag = params.contextTag || 'general'

    const { data, error } = await supabase
      .from('voice_journal')
      .insert({
        user_id: user.id,
        raw_transcript: params.transcript,
        context_tag: contextTag,
        job_reference: params.jobReference || null,
        action_items: actionItems,
      })
      .select()
      .single()

    if (error) {
      console.error('[VoiceJournal] Save error:', error)
      return null
    }

    const entry = {
      id: data.id,
      raw_transcript: data.raw_transcript,
      context_tag: data.context_tag,
      job_reference: data.job_reference,
      action_items: Array.isArray(data.action_items) ? data.action_items : [],
      created_at: data.created_at,
    }

    // V3 Session 2: Store embedding for semantic search (fire-and-forget)
    ;(async () => {
      try {
        const embedding = await createEmbedding(params.transcript)
        await supabase.rpc('upsert_memory', {
          p_user_id:     user.id,
          p_entity_type: 'voice_journal',
          p_entity_id:   entry.id,
          p_content:     params.transcript,
          p_embedding:   `[${embedding.join(',')}]`,
          p_metadata: {
            context_tag:   entry.context_tag,
            job_reference: entry.job_reference,
          },
        })
      } catch (embedErr) {
        // Non-critical — semantic search will fall back to text search
        console.warn('[VoiceJournal] embedding store failed (non-critical):', embedErr)
      }
    })()

    return entry
  } catch (err) {
    console.error('[VoiceJournal] Unexpected error in saveJournalEntry:', err)
    return null
  }
}

/**
 * Search voice journal entries.
 * V3 Session 2: tries semantic search first; falls back to ilike text search.
 * Returns most relevant / most recent matches first.
 */
export async function searchJournal(
  query: string,
  limit = 10,
): Promise<JournalEntry[]> {
  // Try semantic search first (V3 Session 2 upgrade)
  try {
    const semantic = await semanticSearch(query, limit)
    if (semantic.length > 0) return semantic
  } catch {
    // Non-critical — fall through to text search
  }
  return _textSearchJournal(query, limit)
}

/**
 * Internal text-only search (ilike on raw_transcript).
 * Used as fallback by searchJournal() and semanticSearch().
 */
async function _textSearchJournal(
  query: string,
  limit = 10,
): Promise<JournalEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)
      .ilike('raw_transcript', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[VoiceJournal] Search error:', error)
      return []
    }

    return (data || []).map(row => ({
      id: row.id,
      raw_transcript: row.raw_transcript,
      context_tag: row.context_tag,
      job_reference: row.job_reference,
      action_items: Array.isArray(row.action_items) ? row.action_items : [],
      created_at: row.created_at,
    }))
  } catch (err) {
    console.error('[VoiceJournal] Unexpected error in _textSearchJournal:', err)
    return []
  }
}

/**
 * Returns the last N journal entries, most recent first.
 */
export async function getRecentJournal(limit = 10): Promise<JournalEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[VoiceJournal] getRecentJournal error:', error)
      return []
    }

    return (data || []).map(row => ({
      id: row.id,
      raw_transcript: row.raw_transcript,
      context_tag: row.context_tag,
      job_reference: row.job_reference,
      action_items: Array.isArray(row.action_items) ? row.action_items : [],
      created_at: row.created_at,
    }))
  } catch (err) {
    console.error('[VoiceJournal] Unexpected error in getRecentJournal:', err)
    return []
  }
}

/**
 * Returns a plain-English summary of journal entries from the last N hours.
 *
 * Example output:
 *   "In the last 24 hours you captured 3 voice notes:
 *    You need conduit for rough-in on the TI job.
 *    You flagged the panel location for the architect.
 *    You're waiting on mobile deposit to clear for materials."
 */
export async function getJournalSummary(hours = 24): Promise<string> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'No journal entries found.'

    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[VoiceJournal] getJournalSummary error:', error)
      return 'Could not retrieve journal entries.'
    }

    const entries: JournalEntry[] = (data || []).map(row => ({
      id: row.id,
      raw_transcript: row.raw_transcript,
      context_tag: row.context_tag,
      job_reference: row.job_reference,
      action_items: Array.isArray(row.action_items) ? row.action_items : [],
      created_at: row.created_at,
    }))

    if (entries.length === 0) {
      return `No voice notes captured in the last ${hours} hours.`
    }

    // Collect all action items across entries
    const allActionItems = entries.flatMap(e => e.action_items).filter(Boolean)

    // Build summary lines — prefer action items, fall back to transcript snippet
    const summaryLines = entries.map(e => {
      if (e.action_items.length > 0) {
        return e.action_items[0]
      }
      return e.raw_transcript.slice(0, 120)
    })

    const timeLabel = hours <= 24 ? `${hours} hours` : `${Math.round(hours / 24)} days`
    const noteWord = entries.length === 1 ? 'voice note' : 'voice notes'
    const header = `In the last ${timeLabel} you captured ${entries.length} ${noteWord}:`

    return [header, ...summaryLines].join('\n')
  } catch (err) {
    console.error('[VoiceJournal] Unexpected error in getJournalSummary:', err)
    return 'Could not retrieve journal summary.'
  }
}

// ── V3 Session 2: Semantic Search ─────────────────────────────────────────────

/**
 * Semantic similarity search over voice journal entries.
 * Uses memory_embeddings (entity_type='voice_journal') via pgvector cosine similarity
 * through the search_memories RPC (migration 040).
 * Falls back to ilike text search if embeddings fail or return no results.
 * Returns top 5 most relevant entries.
 */
export async function semanticSearch(
  query: string,
  limit = 5,
): Promise<JournalEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return _textSearchJournal(query, limit)

    // ── Generate query embedding ──────────────────────────────────────────
    const embedding = await createEmbedding(query)

    // ── Call search_memories RPC (migration 040 signature) ────────────────
    // Fetch more than needed so we can filter to voice_journal entries
    const { data: memData, error: memError } = await supabase.rpc('search_memories', {
      p_user_id:   user.id,
      p_embedding: `[${embedding.join(',')}]`,
      p_limit:     20,
      p_threshold: 0.60,
    })

    if (memError || !memData || (memData as unknown[]).length === 0) {
      return _textSearchJournal(query, limit)
    }

    // ── Filter to voice_journal entity type ───────────────────────────────
    const journalHits = (memData as Array<Record<string, unknown>>)
      .filter(r => r.entity_type === 'voice_journal')
      .slice(0, limit)

    if (journalHits.length === 0) return _textSearchJournal(query, limit)

    const entityIds = journalHits
      .map(r => r.entity_id as string)
      .filter(Boolean)

    // ── Fetch full journal entries from voice_journal ─────────────────────
    const { data: rows, error: fetchError } = await supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)
      .in('id', entityIds)
      .order('created_at', { ascending: false })

    if (fetchError || !rows || (rows as unknown[]).length === 0) {
      return _textSearchJournal(query, limit)
    }

    return (rows as Record<string, unknown>[]).map(row => ({
      id:            row.id as string,
      raw_transcript: row.raw_transcript as string,
      context_tag:   row.context_tag as string,
      job_reference: row.job_reference as string | undefined,
      action_items:  Array.isArray(row.action_items) ? row.action_items as string[] : [],
      created_at:    row.created_at as string,
    }))
  } catch (err) {
    console.warn('[VoiceJournal] semanticSearch fell back to text search:', err)
    return _textSearchJournal(query, limit)
  }
}
