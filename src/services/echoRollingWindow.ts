// @ts-nocheck
/**
 * src/services/echoRollingWindow.ts
 * B11 — ECHO Rolling Window
 *
 * Builds the ECHO Memory context block injected into every NEXUS session.
 * Pulls last 24 hours of session_conclusions + last 5 voice journal entries,
 * compresses into a max-200-token summary block.
 *
 * Injection point: NEXUS system prompt, after liveBusinessCtx (B10), before user messages.
 */

import { supabase } from '@/lib/supabase'
import { getRecentJournal, type JournalEntry } from './voiceJournalService'
import type { SessionConclusion } from './sessionConclusionService'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EchoRollingBlock {
  /** Formatted prompt fragment ready for injection */
  promptBlock: string
  /** Raw conclusions fetched (for debugging / tests) */
  conclusions: SessionConclusion[]
  /** Raw journal entries fetched (for debugging / tests) */
  journalEntries: JournalEntry[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Rough token estimator — 1 token ≈ 4 characters for English prose.
 * Used to guard the 200-token budget.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Truncate a string to fit within a token budget, appending '…' if needed.
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars - 1) + '…'
}

// ── Detect repeated themes ────────────────────────────────────────────────────

const THEME_KEYWORDS: Record<string, string[]> = {
  collections:   ['collect', 'invoice', 'payment', 'owed', 'AR', 'overdue', 'uncollected'],
  estimating:    ['estimate', 'bid', 'quote', 'pricing', 'margin', 'markup'],
  scheduling:    ['schedule', 'calendar', 'crew', 'dispatch', 'availability'],
  permitting:    ['permit', 'inspection', 'plan check', 'AHJ'],
  solar:         ['solar', 'PV', 'RMO', 'MTZ', 'interconnect', 'NEM'],
  pipeline:      ['pipeline', 'lead', 'prospect', 'GC', 'contract'],
  cashflow:      ['cash', 'revenue', 'profit', 'income', 'expense', 'payroll'],
  compliance:    ['NEC', 'CEC', 'code', 'compliance', 'title 24'],
  crew:          ['crew', 'hire', 'employee', 'apprentice', 'helper'],
}

function detectThemes(texts: string[]): string[] {
  const combined = texts.join(' ').toLowerCase()
  const hitCounts: Record<string, number> = {}

  for (const [theme, keywords] of Object.entries(THEME_KEYWORDS)) {
    const hits = keywords.filter(kw => combined.includes(kw.toLowerCase())).length
    if (hits > 0) hitCounts[theme] = hits
  }

  // Return themes that appear more than once (i.e. "ongoing")
  return Object.entries(hitCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([theme]) => theme)
}

// ── Fetch last 24h session_conclusions ───────────────────────────────────────

async function fetchRecentConclusions(userId: string): Promise<SessionConclusion[]> {
  try {
    // Pull last 90 days — memory accumulates from day 1, never resets
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('session_conclusions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      console.warn('[ECHO] fetchRecentConclusions error (non-critical):', error.message)
      return []
    }

    return (data || []) as SessionConclusion[]
  } catch (err) {
    console.warn('[ECHO] fetchRecentConclusions unexpected error (non-critical):', err)
    return []
  }
}

// ── Build the rolling window block ────────────────────────────────────────────

/**
 * buildEchoRollingBlock
 *
 * Main entry point. Fetches last 24h conclusions + last 5 journal entries,
 * compresses into a max-200-token summary block for NEXUS system prompt injection.
 *
 * Always returns a block — never skips it entirely (per B11 spec).
 * If no history exists, returns the "No recent session history" placeholder.
 *
 * @param userId  - Authenticated user ID (for scoping Supabase queries)
 */
export async function buildEchoRollingBlock(userId: string): Promise<EchoRollingBlock> {
  // Parallel fetch — conclusions + journal entries
  const [conclusions, journalEntries] = await Promise.all([
    fetchRecentConclusions(userId),
    getRecentJournal(5).catch(() => [] as JournalEntry[]),
  ])

  // Build prompt block
  const promptBlock = compressToBlock(conclusions, journalEntries)

  return { promptBlock, conclusions, journalEntries }
}

// ── Compression ───────────────────────────────────────────────────────────────

/**
 * Compress conclusions + journal entries into a max-200-token summary block.
 *
 * Format:
 * ## ECHO Memory — Last 24 Hours
 * Key conclusions: [list]
 * Recent notes: [from voice journal]
 * Ongoing topics: [repeated themes]
 */
function compressToBlock(
  conclusions: SessionConclusion[],
  journalEntries: JournalEntry[],
): string {
  const TOKEN_BUDGET = 400
  const lines: string[] = ['## ECHO Memory — Rolling Daily Digest']

  // ── Key conclusions ───────────────────────────────────────────────────────
  if (conclusions.length > 0) {
    // Today's conclusions — full detail
    const todayStart = new Date(); todayStart.setHours(0,0,0,0)
    const todayConclusions = conclusions.filter(c =>
      c.created_at && new Date(c.created_at) >= todayStart
    )
    // Last 7 days — recent detail (exclude today)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentConclusions = conclusions.filter(c =>
      c.created_at &&
      new Date(c.created_at) >= sevenDaysAgo &&
      new Date(c.created_at) < todayStart
    )
    // Older conclusions — compressed
    const olderConclusions = conclusions.filter(c =>
      c.created_at && new Date(c.created_at) < sevenDaysAgo
    )

    if (todayConclusions.length > 0) {
      const texts = todayConclusions.slice(0, 5).map(c => {
        const agentTag = c.agent_refs?.length ? ` [${c.agent_refs[0].toUpperCase()}]` : ''
        return `- ${c.conclusion_text}${agentTag}`
      })
      lines.push(`Today so far:\n${texts.join('\n')}`)
    }

    if (recentConclusions.length > 0) {
      const texts = recentConclusions.slice(0, 6).map(c => {
        const dateStr = c.created_at
          ? new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : ''
        const agentTag = c.agent_refs?.length ? ` [${c.agent_refs[0].toUpperCase()}]` : ''
        return `- [${dateStr}] ${c.conclusion_text}${agentTag}`
      })
      lines.push(`Last 7 days:\n${texts.join('\n')}`)
    }

    if (olderConclusions.length > 0) {
      // Compress older conclusions into a single summary line
      const themes = detectThemes(olderConclusions.map(c => c.conclusion_text))
      const dateStr = olderConclusions[olderConclusions.length - 1]?.created_at
        ? new Date(olderConclusions[olderConclusions.length - 1].created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : 'earlier'
      lines.push(`Older history (${olderConclusions.length} sessions since ${dateStr}): recurring topics — ${themes.length > 0 ? themes.join(', ') : 'varied'}`)
    }
  }

  // ── Recent journal notes ──────────────────────────────────────────────────
  if (journalEntries.length > 0) {
    const journalTexts = journalEntries
      .slice(0, 5)
      .map(j => {
        const dateStr = j.created_at
          ? new Date(j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : ''
        const snippet = (j.raw_transcript || '').slice(0, 80)
        return `- [${dateStr}] ${snippet}${snippet.length >= 80 ? '…' : ''}`
      })
    lines.push(`Recent notes:\n${journalTexts.join('\n')}`)
  }

  // ── Ongoing topics ────────────────────────────────────────────────────────
  const allTexts = [
    ...conclusions.map(c => c.conclusion_text),
    ...journalEntries.map(j => j.raw_transcript || ''),
  ]
  const themes = detectThemes(allTexts)
  if (themes.length > 0) {
    lines.push(`Ongoing topics: ${themes.slice(0, 5).join(', ')}`)
  }

  // If nothing was added beyond the header, use placeholder
  if (lines.length === 1) {
    lines.push('No recent session history.')
    return lines.join('\n')
  }

  // Enforce 200-token budget by truncating the assembled block
  const assembled = lines.join('\n')
  return truncateToTokens(assembled, TOKEN_BUDGET)
}

// ── Fallback block (no auth / error) ─────────────────────────────────────────

/**
 * Returns the "No recent session history" placeholder block.
 * Used when userId is not available or fetching fails entirely.
 */
export function getEmptyEchoBlock(): string {
  return '## ECHO Memory — Rolling Daily Digest\nNo session history yet.'
}
