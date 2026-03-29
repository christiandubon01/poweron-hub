// @ts-nocheck
/**
 * NEXUS Learned Profile — Layer 3 of the three-layer context architecture.
 *
 * Tracks implicit behavioral patterns observed across sessions.
 * Patterns are stored in Supabase `nexus_learned_profile` and cached in localStorage.
 *
 * Pattern types:
 *   - communication_style: how the user prefers to communicate
 *   - priority_preference: what topics/data the user cares about most
 *   - response_format: how the user wants responses structured
 *   - focus_area: topics the user repeatedly asks about
 *
 * Patterns are observed, not stated. They accumulate confidence over time
 * as the same pattern is detected across multiple sessions.
 */

import { supabase } from '@/lib/supabase'
import { callClaude, extractText } from './claudeProxy'

// ── Types ────────────────────────────────────────────────────────────────────

export interface LearnedPattern {
  id: string
  org_id: string
  user_id: string
  pattern_type: PatternType
  pattern_key: string
  pattern_value: string
  confidence: number
  last_observed: string
  active: boolean
  created_at: string
}

export type PatternType =
  | 'communication_style'
  | 'priority_preference'
  | 'response_format'
  | 'focus_area'

interface DetectedPattern {
  pattern_type: PatternType
  pattern_key: string
  pattern_value: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_KEY = 'nexus_learned_profile'
const MIN_CONFIDENCE_FOR_PROMPT = 2 // Only include patterns observed 2+ times

// ── Load patterns ─────────────────────────────────────────────────────────────

/**
 * Load all active learned patterns for a user.
 * Loads from BOTH Supabase AND localStorage, merges and deduplicates by pattern_key.
 * This ensures patterns are never lost even if Supabase table doesn't exist yet.
 */
export async function loadLearnedPatterns(
  orgId: string,
  userId: string
): Promise<LearnedPattern[]> {
  // Always load local patterns first as baseline
  const localPatterns = getCachedPatterns(userId)

  let supabasePatterns: LearnedPattern[] = []
  try {
    const { data, error } = await supabase
      .from('nexus_learned_profile' as never)
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('active', true)
      .order('confidence', { ascending: false })

    if (error) {
      console.warn('[LearnedProfile] Supabase load failed, using localStorage only:', error.message)
    } else if (data) {
      supabasePatterns = data as LearnedPattern[]
    }
  } catch (err) {
    console.warn('[LearnedProfile] Supabase unreachable, using localStorage only:', err)
  }

  // Merge: Supabase patterns take priority, then add any local-only patterns
  const merged = new Map<string, LearnedPattern>()
  for (const p of supabasePatterns) {
    merged.set(p.pattern_key, p)
  }
  for (const p of localPatterns) {
    if (!merged.has(p.pattern_key)) {
      merged.set(p.pattern_key, p)
    } else {
      // If local has higher confidence, use local's confidence
      const existing = merged.get(p.pattern_key)!
      if (p.confidence > existing.confidence) {
        merged.set(p.pattern_key, { ...existing, confidence: p.confidence })
      }
    }
  }

  const result = Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence)

  // Refresh local cache with merged result
  localStorage.setItem(`${CACHE_KEY}_${userId}`, JSON.stringify(result))

  return result
}

// ── Build prompt from patterns ───────────────────────────────────────────────

/**
 * Build a system prompt section from learned patterns.
 * Only includes patterns with confidence >= MIN_CONFIDENCE_FOR_PROMPT.
 */
export async function buildLearnedProfilePrompt(
  orgId: string,
  userId: string
): Promise<string> {
  const patterns = await loadLearnedPatterns(orgId, userId)
  const qualified = patterns.filter(p => p.confidence >= MIN_CONFIDENCE_FOR_PROMPT)

  if (qualified.length === 0) return ''

  const lines = qualified.slice(0, 8).map(p =>
    `- ${p.pattern_value} (observed ${p.confidence} times)`
  )

  return `## LEARNED PROFILE (from past sessions)\n${lines.join('\n')}\n`
}

// ── Save / upsert patterns ──────────────────────────────────────────────────

/**
 * Save or increment a learned pattern.
 * If the pattern_key already exists, increments confidence and updates last_observed.
 * If new, creates with confidence=1.
 */
export async function upsertPattern(
  orgId: string,
  userId: string,
  pattern: DetectedPattern
): Promise<void> {
  // Always write to localStorage first — this is the guaranteed write path
  upsertLocalCache(orgId, userId, pattern)

  // Attempt Supabase write — verify table exists first with a test query
  try {
    const { error: testError } = await supabase
      .from('nexus_learned_profile' as never)
      .select('id')
      .limit(1)

    if (testError) {
      console.warn('[LearnedProfile] Supabase table not available, using localStorage fallback:', testError.message)
      return
    }

    // Check if pattern already exists in Supabase
    const { data: existing, error: selectError } = await supabase
      .from('nexus_learned_profile' as never)
      .select('id, confidence')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('pattern_key', pattern.pattern_key)
      .eq('active', true)
      .single()

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 = no rows found (expected for new patterns)
      console.warn('[LearnedProfile] Supabase select failed:', selectError.message)
      return
    }

    if (existing) {
      // Increment confidence
      const ex = existing as any
      const { error: updateError } = await supabase
        .from('nexus_learned_profile' as never)
        .update({
          confidence: (ex.confidence || 1) + 1,
          last_observed: new Date().toISOString(),
          pattern_value: pattern.pattern_value,
        })
        .eq('id', ex.id)

      if (updateError) {
        console.warn('[LearnedProfile] Supabase update failed:', updateError.message)
      } else {
        console.log(`[LearnedProfile] Supabase: incremented "${pattern.pattern_key}" → confidence ${(ex.confidence || 1) + 1}`)
      }
    } else {
      // Insert new pattern
      const { error: insertError } = await supabase
        .from('nexus_learned_profile' as never)
        .insert({
          org_id: orgId,
          user_id: userId,
          pattern_type: pattern.pattern_type,
          pattern_key: pattern.pattern_key,
          pattern_value: pattern.pattern_value,
          confidence: 1,
          last_observed: new Date().toISOString(),
          active: true,
        })

      if (insertError) {
        console.warn('[LearnedProfile] Supabase insert failed:', insertError.message)
      } else {
        console.log(`[LearnedProfile] Supabase: new pattern "${pattern.pattern_key}" [${pattern.pattern_type}]`)
      }
    }
  } catch (err) {
    console.warn('[LearnedProfile] Supabase write failed, localStorage fallback active:', err)
  }
}

// ── Pattern analysis (runs after session exchange) ──────────────────────────

const PATTERN_ANALYSIS_PROMPT = `Analyze this conversation exchange and identify any behavioral patterns about how this user prefers to communicate or what they prioritize.

Return a JSON array of objects with these fields:
- pattern_type: one of "communication_style", "priority_preference", "response_format", "focus_area"
- pattern_key: a short snake_case identifier (e.g. "prefers_cash_flow_first", "dislikes_long_preamble")
- pattern_value: a human-readable description of the pattern (e.g. "You prefer cash flow exposure before phase status")

Return an empty array [] if no clear patterns are detected. Be conservative — only flag clear, repeated patterns, not one-off behaviors. Max 3 patterns per analysis.

Exchange:`

/**
 * Analyze recent conversation turns for implicit behavioral patterns.
 * Uses Claude to detect patterns, then upserts them.
 * Fires after 2+ meaningful turns to catch patterns early.
 */
export async function analyzeSessionPatterns(
  orgId: string,
  userId: string,
  recentTurns: Array<{ role: string; content: string }>
): Promise<void> {
  if (recentTurns.length < 2) return // Need at least 2 turns for pattern detection

  console.log(`[LearnedProfile] Analyzing conversation for patterns... (${recentTurns.length} turns)`)

  // Take the last 6 turns max
  const exchange = recentTurns.slice(-6)
    .map(t => `${t.role === 'user' ? 'User' : 'NEXUS'}: ${t.content.slice(0, 200)}`)
    .join('\n')

  try {
    const response = await callClaude({
      system: 'You are a behavioral pattern analyzer. You output only valid JSON arrays. No explanation, no markdown, just the JSON array.',
      messages: [{ role: 'user', content: `${PATTERN_ANALYSIS_PROMPT}\n${exchange}` }],
      max_tokens: 512,
    })

    const text = extractText(response) || '[]'
    console.log(`[LearnedProfile] Claude analysis raw response: ${text.slice(0, 200)}`)

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.log('[LearnedProfile] No valid JSON array found in response')
      return
    }

    let patterns: DetectedPattern[]
    try {
      patterns = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      console.warn('[LearnedProfile] JSON parse failed:', parseErr)
      return
    }

    if (!Array.isArray(patterns) || patterns.length === 0) {
      console.log('[LearnedProfile] No patterns detected in this exchange')
      return
    }

    console.log(`[LearnedProfile] Patterns detected: ${JSON.stringify(patterns)}`)

    // Validate and upsert each pattern
    for (const p of patterns.slice(0, 3)) {
      if (p.pattern_type && p.pattern_key && p.pattern_value) {
        await upsertPattern(orgId, userId, p)
      }
    }

    console.log(`[LearnedProfile] Analyzed exchange → ${patterns.length} pattern(s) written`)
  } catch (err) {
    console.warn('[LearnedProfile] Pattern analysis failed (non-critical):', err)
  }
}

// ── Conversation thread persistence (Layer 1) ──────────────────────────────

const THREAD_KEY = 'nexus_conversation_thread'
const MAX_THREAD_TURNS = 20 // Store up to 20 turns, pass last 6 to API

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
  agentUsed?: string
  timestamp: number
}

/**
 * Get the stored conversation thread from localStorage.
 */
export function getConversationThread(): ConversationTurn[] {
  try {
    const raw = localStorage.getItem(THREAD_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * Add a turn to the conversation thread.
 */
export function addConversationTurn(turn: ConversationTurn): void {
  try {
    const thread = getConversationThread()
    thread.push(turn)
    // Keep max turns
    const trimmed = thread.slice(-MAX_THREAD_TURNS)
    localStorage.setItem(THREAD_KEY, JSON.stringify(trimmed))
  } catch { /* ignore */ }
}

/**
 * Clear the conversation thread (called on "New Session" press).
 */
export function clearConversationThread(): void {
  try {
    localStorage.removeItem(THREAD_KEY)
  } catch { /* ignore */ }
}

/**
 * Get the last N turns for API injection as messages array entries.
 */
export function getRecentTurns(count: number = 6): ConversationTurn[] {
  return getConversationThread().slice(-count)
}

// ── Local cache helpers ─────────────────────────────────────────────────────

function getCachedPatterns(userId: string): LearnedPattern[] {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}_${userId}`)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function upsertLocalCache(
  orgId: string,
  userId: string,
  pattern: DetectedPattern
): void {
  try {
    const existing = getCachedPatterns(userId)
    const idx = existing.findIndex(p => p.pattern_key === pattern.pattern_key)

    if (idx >= 0) {
      existing[idx].confidence = (existing[idx].confidence || 1) + 1
      existing[idx].last_observed = new Date().toISOString()
      existing[idx].pattern_value = pattern.pattern_value
    } else {
      existing.push({
        id: `local_${Date.now()}`,
        org_id: orgId,
        user_id: userId,
        pattern_type: pattern.pattern_type,
        pattern_key: pattern.pattern_key,
        pattern_value: pattern.pattern_value,
        confidence: 1,
        last_observed: new Date().toISOString(),
        active: true,
        created_at: new Date().toISOString(),
      })
    }

    localStorage.setItem(`${CACHE_KEY}_${userId}`, JSON.stringify(existing.slice(0, 50)))
  } catch { /* ignore */ }
}
