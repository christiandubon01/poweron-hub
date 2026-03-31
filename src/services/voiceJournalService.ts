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
 * Session 8 additions: auto-tagging via ECHO, getJournalWithFilters(),
 * getJournalEntriesForProject(), getWeeklyJournalEntries() for weekly summary.
 * Additive only — no existing service logic modified.
 */

import { supabase } from '@/lib/supabase'
import { createEmbedding } from '@/lib/memory/embeddings'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── Types ─────────────────────────────────────────────────────────────────────

/** Tag type for a journal entry — what kind of note it represents */
export type JournalTagType =
  | 'project_note'
  | 'collection_note'
  | 'lead_note'
  | 'personal'
  | 'task'
  | 'decision'

/** Priority level for a journal entry */
export type JournalPriority = 'high' | 'medium' | 'low'

export interface JournalEntry {
  id: string
  raw_transcript: string
  context_tag: string
  job_reference?: string
  action_items: string[]
  created_at: string
  // Session 8: ECHO auto-tagging fields (optional — may not exist on older entries)
  tag_type?: JournalTagType
  project_name?: string
  priority?: JournalPriority
}

export interface JournalFilterOptions {
  search?: string
  tag_type?: JournalTagType | ''
  project_name?: string
  date_from?: string   // ISO date string
  date_to?: string     // ISO date string
  sort_by?: 'date_desc' | 'date_asc' | 'priority_high'
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

    // Session 8: ECHO auto-tag and project memory routing (fire-and-forget)
    echoTagAndRoute(entry.id, params.transcript, user.id)

    // Session 10: Passive skill signal extraction (fire-and-forget)
    try {
      const { processSkillSignals } = await import('@/services/skillSignalExtractor')
      processSkillSignals(params.transcript, 'journal')
    } catch { /* non-critical */ }

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
      tag_type:     row.tag_type ?? undefined,
      project_name: row.project_name ?? undefined,
      priority:     row.priority ?? undefined,
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
      tag_type:     row.tag_type ?? undefined,
      project_name: row.project_name ?? undefined,
      priority:     row.priority ?? undefined,
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
      tag_type:      row.tag_type as JournalTagType | undefined,
      project_name:  row.project_name as string | undefined,
      priority:      row.priority as JournalPriority | undefined,
    }))
  } catch (err) {
    console.warn('[VoiceJournal] semanticSearch fell back to text search:', err)
    return _textSearchJournal(query, limit)
  }
}

// ── Session 8: ECHO Auto-Tagging ──────────────────────────────────────────────

/**
 * Analyzes a transcript with Claude (via ECHO persona) and returns
 * tag_type, project_name, and priority. Fire-and-forget — returns null on failure.
 */
async function _echoAnalyzeEntry(transcript: string): Promise<{
  tag_type: JournalTagType
  project_name: string
  priority: JournalPriority
} | null> {
  try {
    const response = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: `You are ECHO, the long-term memory agent for Power On Solutions LLC, a C-10 electrical contractor in Coachella Valley, CA. Analyze a journal entry and return a JSON object with exactly three fields:
- tag_type: one of "project_note" | "collection_note" | "lead_note" | "personal" | "task" | "decision"
- project_name: the project or company name mentioned (empty string if none)
- priority: one of "high" | "medium" | "low" based on urgency and business impact

Rules:
- project_note: mentions a specific job, project, or construction site
- collection_note: mentions payment, invoice, money owed, collections, AR
- lead_note: mentions a potential new customer, bid, or lead
- personal: personal thoughts, health, non-business content
- task: a to-do, reminder, or action item
- decision: a business or operational decision made
- high priority: urgent, safety risk, money at risk >$500, time-sensitive
- medium priority: important but not urgent
- low priority: general notes, observations

Return ONLY valid JSON with these three keys. No extra text.`,
      messages: [{
        role: 'user',
        content: `Journal entry: "${transcript.slice(0, 800)}"`,
      }],
    })
    const text = extractText(response).trim()
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    const validTagTypes: JournalTagType[] = ['project_note', 'collection_note', 'lead_note', 'personal', 'task', 'decision']
    const validPriorities: JournalPriority[] = ['high', 'medium', 'low']
    return {
      tag_type:     validTagTypes.includes(parsed.tag_type) ? parsed.tag_type : 'personal',
      project_name: typeof parsed.project_name === 'string' ? parsed.project_name.trim() : '',
      priority:     validPriorities.includes(parsed.priority) ? parsed.priority : 'medium',
    }
  } catch (err) {
    console.warn('[VoiceJournal/ECHO] Auto-tag analysis failed (non-critical):', err)
    return null
  }
}

/**
 * Fire-and-forget: analyze entry and update Supabase row + project coord cross-reference.
 * Called after a journal entry is saved. Non-critical — never throws.
 */
export function echoTagAndRoute(entryId: string, transcript: string, userId: string): void {
  ;(async () => {
    try {
      const tags = await _echoAnalyzeEntry(transcript)
      if (!tags) return

      // ── Update journal row with tags ────────────────────────────────────────
      const { error: updateError } = await supabase
        .from('voice_journal')
        .update({
          tag_type:     tags.tag_type,
          project_name: tags.project_name || null,
          priority:     tags.priority,
        })
        .eq('id', entryId)

      if (updateError) {
        console.warn('[VoiceJournal/ECHO] DB update failed (non-critical):', updateError.message)
      }

      // ── Part 2: Cross-reference into project coordination tab ───────────────
      if (tags.project_name) {
        try {
          const { getBackupData, saveBackupData } = await import('@/services/backupDataService')
          const backup = getBackupData()
          if (backup) {
            // Find project by name (case-insensitive substring match)
            const nameLC = tags.project_name.toLowerCase()
            const project = (backup.projects || []).find((p: any) =>
              (p.name || '').toLowerCase().includes(nameLC) ||
              nameLC.includes((p.name || '').toLowerCase())
            )
            if (project) {
              if (!project.coord) project.coord = {}
              if (!Array.isArray(project.coord.journal_links)) project.coord.journal_links = []

              const snippet = transcript.length > 120 ? transcript.slice(0, 120) + '…' : transcript
              const alreadyLinked = project.coord.journal_links.some((l: any) => l.id === entryId)
              if (!alreadyLinked) {
                project.coord.journal_links.push({
                  id:      entryId,
                  date:    new Date().toISOString(),
                  summary: snippet,
                  priority: tags.priority,
                })
                saveBackupData(backup)
                console.log(`[VoiceJournal/ECHO] Cross-linked journal entry to project "${project.name}"`)
              }
            }
          }
        } catch (crossRefErr) {
          console.warn('[VoiceJournal/ECHO] Project cross-reference failed (non-critical):', crossRefErr)
        }
      }
    } catch (outerErr) {
      console.warn('[VoiceJournal/ECHO] echoTagAndRoute outer error (non-critical):', outerErr)
    }
  })()
}

// ── Session 8: Filtered Journal Query ────────────────────────────────────────

/**
 * Retrieves journal entries with optional search, tag, project, and date filters.
 * All filters are optional — with no filters behaves like getRecentJournal().
 */
export async function getJournalWithFilters(
  options: JournalFilterOptions = {},
  limit = 100,
): Promise<JournalEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    let query = supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)

    if (options.date_from) {
      query = query.gte('created_at', new Date(options.date_from).toISOString())
    }
    if (options.date_to) {
      // Include full end day by moving to next day
      const endDate = new Date(options.date_to)
      endDate.setDate(endDate.getDate() + 1)
      query = query.lt('created_at', endDate.toISOString())
    }
    if (options.tag_type) {
      query = query.eq('tag_type', options.tag_type)
    }
    if (options.project_name) {
      query = query.ilike('project_name', `%${options.project_name}%`)
    }
    if (options.search) {
      query = query.ilike('raw_transcript', `%${options.search}%`)
    }

    // Sort
    if (options.sort_by === 'date_asc') {
      query = query.order('created_at', { ascending: true })
    } else {
      // date_desc is the default; priority_high also sorts by date desc (priority is client-side)
      query = query.order('created_at', { ascending: false })
    }

    query = query.limit(limit)

    const { data, error } = await query

    if (error) {
      console.error('[VoiceJournal] getJournalWithFilters error:', error)
      return []
    }

    let entries: JournalEntry[] = (data || []).map(row => ({
      id:            row.id,
      raw_transcript: row.raw_transcript,
      context_tag:   row.context_tag,
      job_reference: row.job_reference,
      action_items:  Array.isArray(row.action_items) ? row.action_items : [],
      created_at:    row.created_at,
      tag_type:      row.tag_type ?? undefined,
      project_name:  row.project_name ?? undefined,
      priority:      row.priority ?? undefined,
    }))

    // Client-side priority sort if requested
    if (options.sort_by === 'priority_high') {
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
      entries = entries.sort((a, b) =>
        (priorityOrder[a.priority ?? 'low'] ?? 2) - (priorityOrder[b.priority ?? 'low'] ?? 2)
      )
    }

    return entries
  } catch (err) {
    console.error('[VoiceJournal] Unexpected error in getJournalWithFilters:', err)
    return []
  }
}

// ── Session 8: Project-linked Journal Entries ─────────────────────────────────

/**
 * Returns journal entries linked to a specific project by name.
 * Used by the coordination tab to show "Linked from Journal" section.
 */
export async function getJournalEntriesForProject(
  projectName: string,
  limit = 10,
): Promise<JournalEntry[]> {
  if (!projectName) return []
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const { data, error } = await supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)
      .ilike('project_name', `%${projectName}%`)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[VoiceJournal] getJournalEntriesForProject error:', error)
      return []
    }

    return (data || []).map(row => ({
      id:            row.id,
      raw_transcript: row.raw_transcript,
      context_tag:   row.context_tag,
      job_reference: row.job_reference,
      action_items:  Array.isArray(row.action_items) ? row.action_items : [],
      created_at:    row.created_at,
      tag_type:      row.tag_type ?? undefined,
      project_name:  row.project_name ?? undefined,
      priority:      row.priority ?? undefined,
    }))
  } catch (err) {
    console.error('[VoiceJournal] Unexpected error in getJournalEntriesForProject:', err)
    return []
  }
}

// ── Session 8: Weekly Journal Entries ────────────────────────────────────────

/**
 * Returns all journal entries from the last 7 days, most recent first.
 * Used by the Weekly Summary button.
 */
export async function getWeeklyJournalEntries(): Promise<JournalEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[VoiceJournal] getWeeklyJournalEntries error:', error)
      return []
    }

    return (data || []).map(row => ({
      id:            row.id,
      raw_transcript: row.raw_transcript,
      context_tag:   row.context_tag,
      job_reference: row.job_reference,
      action_items:  Array.isArray(row.action_items) ? row.action_items : [],
      created_at:    row.created_at,
      tag_type:      row.tag_type ?? undefined,
      project_name:  row.project_name ?? undefined,
      priority:      row.priority ?? undefined,
    }))
  } catch (err) {
    console.error('[VoiceJournal] Unexpected error in getWeeklyJournalEntries:', err)
    return []
  }
}

// ── Session 8: Relevant Recent Journal Entries ───────────────────────────────

/**
 * Returns journal entries from the last 30 days most relevant to a search query.
 * Used by NEXUS for journal recall context injection.
 * Tries semantic search first, falls back to recent entries on error.
 */
export async function getRecentRelevantEntries(
  query: string,
  limit = 3,
): Promise<JournalEntry[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  try {
    // Try semantic search limited to last 30 days
    const semantic = await semanticSearch(query, limit)
    // Filter to last 30 days
    const recent = semantic.filter(e => e.created_at >= since)
    if (recent.length > 0) return recent
  } catch {
    // Fall through
  }

  // Fallback: keyword text search limited to 30 days
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return []

    // Extract first meaningful words from query for text search
    const searchTerm = query
      .replace(/^(?:what|how|when|where|who|why|is|are|was|were|do|did|does|can|could|should|tell me about)\s+/i, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')

    const { data, error } = await supabase
      .from('voice_journal')
      .select('*')
      .eq('user_id', user.id)
      .gte('created_at', since)
      .ilike('raw_transcript', `%${searchTerm}%`)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return (data as Record<string, unknown>[]).map(row => ({
      id:            row.id as string,
      raw_transcript: row.raw_transcript as string,
      context_tag:   row.context_tag as string,
      job_reference: row.job_reference as string | undefined,
      action_items:  Array.isArray(row.action_items) ? row.action_items as string[] : [],
      created_at:    row.created_at as string,
      tag_type:      row.tag_type as JournalTagType | undefined,
      project_name:  row.project_name as string | undefined,
      priority:      row.priority as JournalPriority | undefined,
    }))
  } catch {
    return []
  }
}
