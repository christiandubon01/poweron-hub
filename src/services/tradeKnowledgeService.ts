// @ts-nocheck
/**
 * Trade Knowledge Service
 *
 * Queries the trade_knowledge table to surface field-proven contractor judgment
 * beyond NEC code compliance. Used by the OHM agent to enrich responses with
 * real-world field experience before calling Claude.
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface TradeKnowledgeEntry {
  id: string
  scenario: string
  tags: string[]
  code_answer: string | null
  field_answer: string | null
  material_options: Array<Record<string, string>> | null
  regional_factors: string | null
  failure_modes: string | null
  source: string
  owner_notes: string | null
  org_id: string | null
  created_at: string
}

export interface TradeKnowledgeMatch {
  entry: TradeKnowledgeEntry
  relevance: number // 0-1 score for UI ordering
}

// ── Keyword extraction helper ────────────────────────────────────────────────

/**
 * Extract relevant keywords from a user question for tag matching.
 * Simple token-based approach — no embedding required.
 */
function extractKeywords(question: string): string[] {
  const lower = question.toLowerCase()
  // Remove common stopwords
  const stopwords = new Set([
    'what','is','are','the','a','an','for','in','to','of','on','at','with',
    'how','do','i','we','should','can','does','need','my','our','this','that',
    'and','or','but','if','when','where','which','who','would','will','be',
  ])
  return lower
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
}

// ── Tag match scoring ────────────────────────────────────────────────────────

/**
 * Score how well an entry's tags match the extracted keywords.
 * Returns 0-1 relevance score.
 */
function scoreTagMatch(entry: TradeKnowledgeEntry, keywords: string[]): number {
  if (!entry.tags || entry.tags.length === 0 || keywords.length === 0) return 0
  const tagSet = new Set(entry.tags.map(t => t.toLowerCase()))
  const scenarioLower = entry.scenario.toLowerCase()

  let score = 0
  for (const kw of keywords) {
    // Exact tag match
    if (tagSet.has(kw)) score += 1.0
    // Partial tag match
    else if ([...tagSet].some(tag => tag.includes(kw) || kw.includes(tag))) score += 0.5
    // Scenario text match
    if (scenarioLower.includes(kw)) score += 0.3
  }
  // Normalize by keyword count
  return Math.min(score / keywords.length, 1.0)
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Query trade_knowledge for entries relevant to the user's question.
 * Returns up to maxResults entries scored by relevance (highest first).
 *
 * Strategy:
 * 1. Extract keywords from question
 * 2. Pull all entries (system + org) — table is small, full scan is fine
 * 3. Score by tag overlap + scenario text match
 * 4. Return entries above relevance threshold
 */
export async function queryTradeKnowledge(
  question: string,
  orgId: string,
  maxResults = 3,
  minScore = 0.2
): Promise<TradeKnowledgeMatch[]> {
  try {
    // Fetch system entries (org_id IS NULL) and org-specific entries
    const { data, error } = await supabase
      .from('trade_knowledge')
      .select('*')
      .or(`org_id.is.null,org_id.eq.${orgId}`)
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('[TradeKnowledge] Query failed:', error.message)
      return []
    }

    const entries: TradeKnowledgeEntry[] = data || []
    const keywords = extractKeywords(question)

    if (keywords.length === 0) return []

    const scored: TradeKnowledgeMatch[] = entries
      .map(entry => ({ entry, relevance: scoreTagMatch(entry, keywords) }))
      .filter(m => m.relevance >= minScore)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults)

    return scored
  } catch (err) {
    console.warn('[TradeKnowledge] Unexpected error:', err)
    return []
  }
}

/**
 * Format matching trade knowledge entries into a prompt injection block
 * for the OHM agent system prompt.
 */
export function formatTradeKnowledgeContext(matches: TradeKnowledgeMatch[]): string {
  if (matches.length === 0) return ''

  const sections = matches.map(({ entry }) => {
    const lines: string[] = [`**${entry.scenario}**`]

    if (entry.code_answer) {
      lines.push(`Code: ${entry.code_answer}`)
    }
    if (entry.field_answer) {
      lines.push(`Field judgment: ${entry.field_answer}`)
    }
    if (entry.failure_modes) {
      lines.push(`Failure modes: ${entry.failure_modes}`)
    }
    if (entry.material_options && Array.isArray(entry.material_options) && entry.material_options.length > 0) {
      const opts = entry.material_options
        .map((o: Record<string, string>) => {
          const parts = Object.entries(o).map(([k, v]) => `${k}: ${v}`)
          return `  - ${parts.join(' | ')}`
        })
        .join('\n')
      lines.push(`Material options:\n${opts}`)
    }
    if (entry.owner_notes) {
      lines.push(`Owner field note: ${entry.owner_notes}`)
    }

    return lines.join('\n')
  })

  return `## Trade Knowledge Base\nBeyond code compliance, experienced contractors note:\n\n${sections.join('\n\n---\n\n')}`
}

/**
 * Save owner field notes to a trade_knowledge entry.
 * Appends to existing notes with a timestamp separator.
 */
export async function saveOwnerNote(
  entryId: string,
  note: string,
  orgId: string
): Promise<boolean> {
  try {
    // Get existing notes
    const { data: existing } = await supabase
      .from('trade_knowledge')
      .select('owner_notes')
      .eq('id', entryId)
      .single()

    const timestamp = new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
    const newNote = `[${timestamp}] ${note.trim()}`
    const combined = existing?.owner_notes
      ? `${existing.owner_notes}\n\n${newNote}`
      : newNote

    const { error } = await supabase
      .from('trade_knowledge')
      .update({ owner_notes: combined })
      .eq('id', entryId)

    if (error) {
      console.error('[TradeKnowledge] Save note failed:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('[TradeKnowledge] Save note error:', err)
    return false
  }
}

/**
 * Create a new trade knowledge entry (user-authored).
 */
export async function createTradeEntry(
  entry: Omit<TradeKnowledgeEntry, 'id' | 'created_at'>,
  orgId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('trade_knowledge')
      .insert({ ...entry, org_id: orgId, source: 'owner' })
      .select('id')
      .single()

    if (error) {
      console.error('[TradeKnowledge] Create failed:', error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.error('[TradeKnowledge] Create error:', err)
    return null
  }
}

/**
 * Fetch all entries for the Trade Library panel.
 * Returns system entries + org-specific entries.
 */
export async function getAllTradeEntries(orgId: string): Promise<TradeKnowledgeEntry[]> {
  try {
    const { data, error } = await supabase
      .from('trade_knowledge')
      .select('*')
      .or(`org_id.is.null,org_id.eq.${orgId}`)
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('[TradeKnowledge] Fetch all failed:', error.message)
      return []
    }
    return data || []
  } catch (err) {
    console.warn('[TradeKnowledge] Fetch all error:', err)
    return []
  }
}
