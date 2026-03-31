// @ts-nocheck
/**
 * ECHO Memory — Phase F long-term memory agent.
 *
 * ECHO stores conversation patterns, operational history, and permanent
 * owner identity anchors across sessions. It provides the persistent
 * memory layer that NEXUS uses to maintain context over time.
 *
 * Memory entry types:
 *   - owner_identity   : permanent owner profile anchor (priority 1, never deleted)
 *   - nexus_conversation: extracted signals from completed NEXUS conversations
 *   - skill_signal     : detected skill/knowledge signals from conversations
 *   - decision         : decisions made or confirmed by the owner
 *
 * Persistence: localStorage (ECHO_MEMORY_KEY) + Supabase app_state (echo_memory)
 */

import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export type EchoEntryType =
  | 'owner_identity'
  | 'nexus_conversation'
  | 'skill_signal'
  | 'decision'

export interface EchoMemoryEntry {
  id: string
  type: EchoEntryType
  content: string
  permanent: boolean
  priority: number
  source?: string
  tags?: string[]
  created_at: number
  updated_at: number
}

export interface ConversationQualitySignals {
  topics: string[]
  questionsAsked: string[]
  decisions: string[]
  skillSignals: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ECHO_MEMORY_KEY = 'echo_memory'
const MAX_CONVERSATION_ENTRIES = 100

// ── Owner Identity Anchor (permanent, priority 1) ─────────────────────────────
// This is the base identity anchor seeded on first initialization.
// It is never overwritten or deleted — permanent: true, priority: 1.

const OWNER_IDENTITY_ANCHOR: Omit<EchoMemoryEntry, 'id'> = {
  type: 'owner_identity',
  content:
    'Christian Dubon, 24, C-10 electrician, Desert Hot Springs CA. ' +
    'Power On Solutions LLC. 7 years field experience. Born El Salvador, bilingual. ' +
    'Building PowerOn Hub as internal tool and future SaaS. ' +
    'Values depth, practicality, systems thinking. ' +
    'Learning domain: permitting, crew management, business development.',
  permanent: true,
  priority: 1,
  tags: ['owner', 'identity', 'permanent'],
  created_at: 0, // set at seed time
  updated_at: 0,
}

// ── In-memory state ───────────────────────────────────────────────────────────

let _entries: EchoMemoryEntry[] = []
let _initialized = false

// ── ID helper ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `echo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// ── Persistence ───────────────────────────────────────────────────────────────

function saveToLocalStorage(): void {
  try {
    localStorage.setItem(ECHO_MEMORY_KEY, JSON.stringify(_entries))
  } catch (err) {
    console.error('[ECHO] Failed to save to localStorage:', err)
  }
}

function loadFromLocalStorage(): EchoMemoryEntry[] {
  try {
    const raw = localStorage.getItem(ECHO_MEMORY_KEY)
    if (!raw) return []
    return JSON.parse(raw) as EchoMemoryEntry[]
  } catch {
    return []
  }
}

async function syncToSupabase(): Promise<void> {
  try {
    const { error } = await supabase
      .from('app_state')
      .upsert(
        {
          state_key: 'echo_memory',
          state_value: { entries: _entries, updated_at: Date.now() },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'state_key' }
      )
    if (error) {
      console.warn('[ECHO] Supabase sync failed (non-critical):', error)
    }
  } catch (err) {
    console.warn('[ECHO] Supabase sync error (non-critical):', err)
  }
}

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Initialize ECHO memory.
 * Loads from localStorage, seeds owner identity anchor if missing,
 * then optionally syncs with Supabase.
 */
export function initEchoMemory(): void {
  if (_initialized) return

  const stored = loadFromLocalStorage()
  _entries = stored

  // Ensure owner identity anchor is always present as first entry
  const hasOwnerAnchor = _entries.some((e) => e.type === 'owner_identity' && e.permanent)
  if (!hasOwnerAnchor) {
    const now = Date.now()
    const anchor: EchoMemoryEntry = {
      ...OWNER_IDENTITY_ANCHOR,
      id: generateId(),
      created_at: now,
      updated_at: now,
    }
    // Insert at beginning — owner identity is always first
    _entries.unshift(anchor)
    saveToLocalStorage()
    console.log('[ECHO] Owner identity anchor seeded.')
  }

  _initialized = true
}

// ── Add entry ─────────────────────────────────────────────────────────────────

/**
 * Add a new ECHO memory entry.
 * Permanent entries (owner_identity) are never duplicated.
 * Trims conversation entries beyond MAX_CONVERSATION_ENTRIES.
 */
export function addEchoEntry(
  entry: Omit<EchoMemoryEntry, 'id' | 'created_at' | 'updated_at'>
): EchoMemoryEntry {
  if (!_initialized) initEchoMemory()

  const now = Date.now()
  const newEntry: EchoMemoryEntry = {
    ...entry,
    id: generateId(),
    created_at: now,
    updated_at: now,
  }

  // For non-permanent entries, insert after any permanent anchors
  if (!newEntry.permanent) {
    const lastPermanentIdx = _entries.reduce(
      (lastIdx, e, i) => (e.permanent ? i : lastIdx),
      -1
    )
    _entries.splice(lastPermanentIdx + 1, 0, newEntry)
  } else {
    _entries.unshift(newEntry)
  }

  // Trim non-permanent conversation entries if over limit
  const convEntries = _entries.filter((e) => !e.permanent)
  if (convEntries.length > MAX_CONVERSATION_ENTRIES) {
    const excess = convEntries.length - MAX_CONVERSATION_ENTRIES
    // Remove oldest non-permanent entries
    let removed = 0
    _entries = _entries.filter((e) => {
      if (e.permanent) return true
      if (removed < excess) {
        removed++
        return false
      }
      return true
    })
  }

  saveToLocalStorage()
  return newEntry
}

// ── Read entries ──────────────────────────────────────────────────────────────

export function getEchoEntries(
  type?: EchoEntryType,
  limit = 20
): EchoMemoryEntry[] {
  if (!_initialized) initEchoMemory()
  const filtered = type ? _entries.filter((e) => e.type === type) : _entries
  return filtered.slice(0, limit)
}

export function getOwnerIdentity(): EchoMemoryEntry | null {
  if (!_initialized) initEchoMemory()
  return _entries.find((e) => e.type === 'owner_identity' && e.permanent) ?? null
}

export function getAllEchoEntries(): EchoMemoryEntry[] {
  if (!_initialized) initEchoMemory()
  return [..._entries]
}

// ── Conversation quality signal extraction ────────────────────────────────────

/**
 * Extract quality signals from a completed NEXUS conversation.
 *
 * Called when user closes NEXUS panel or starts a new session.
 * Silently stores extracted signals into ECHO memory with source: 'nexus_conversation'.
 *
 * Extracts:
 *   - Topics discussed (from keywords in messages)
 *   - Questions asked by the user (messages ending in ?)
 *   - Decisions made or confirmed (user messages containing decision patterns)
 *   - Skill signals detected (domain knowledge indicators)
 */
export function extractAndStoreConversationSignals(
  messages: Array<{ role: 'user' | 'assistant'; content: string; agent?: string }>
): void {
  if (!_initialized) initEchoMemory()
  if (!messages || messages.length < 2) return

  const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content)
  if (userMessages.length === 0) return

  const signals = _extractSignals(userMessages, messages)

  // Only store if we have meaningful signals
  if (
    signals.topics.length === 0 &&
    signals.questionsAsked.length === 0 &&
    signals.decisions.length === 0 &&
    signals.skillSignals.length === 0
  ) {
    return
  }

  const contentParts: string[] = []

  if (signals.topics.length > 0) {
    contentParts.push(`Topics: ${signals.topics.slice(0, 5).join(', ')}`)
  }
  if (signals.questionsAsked.length > 0) {
    contentParts.push(
      `Questions asked: ${signals.questionsAsked.slice(0, 3).join(' | ')}`
    )
  }
  if (signals.decisions.length > 0) {
    contentParts.push(
      `Decisions: ${signals.decisions.slice(0, 3).join(' | ')}`
    )
  }
  if (signals.skillSignals.length > 0) {
    contentParts.push(`Skill signals: ${signals.skillSignals.slice(0, 3).join(', ')}`)
  }

  const sessionDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  addEchoEntry({
    type: 'nexus_conversation',
    content: `[${sessionDate}] ${contentParts.join('. ')}`,
    permanent: false,
    priority: 2,
    source: 'nexus_conversation',
    tags: [...signals.topics.slice(0, 3), ...signals.skillSignals.slice(0, 2)],
  })

  // Separately store individual skill signals for the passive skill extractor
  signals.skillSignals.forEach((signal) => {
    addEchoEntry({
      type: 'skill_signal',
      content: signal,
      permanent: false,
      priority: 3,
      source: 'nexus_conversation',
      tags: ['skill', 'passive'],
    })
  })

  // Fire-and-forget Supabase sync
  syncToSupabase()

  console.log(
    `[ECHO] Stored conversation signals: ${signals.topics.length} topics, ` +
    `${signals.questionsAsked.length} questions, ${signals.decisions.length} decisions, ` +
    `${signals.skillSignals.length} skill signals`
  )
}

// ── Signal extraction helpers ─────────────────────────────────────────────────

function _extractSignals(
  userMessages: string[],
  allMessages: Array<{ role: string; content: string; agent?: string }>
): ConversationQualitySignals {
  const fullText = userMessages.join(' ')

  return {
    topics: _extractTopics(fullText),
    questionsAsked: _extractQuestions(userMessages),
    decisions: _extractDecisions(userMessages),
    skillSignals: _extractSkillSignals(userMessages, allMessages),
  }
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  estimating: ['estimate', 'bid', 'quote', 'pricing', 'margin', 'markup'],
  collections: ['collect', 'invoice', 'payment', 'owed', 'AR', 'overdue'],
  scheduling: ['schedule', 'calendar', 'crew', 'dispatch', 'availability'],
  permitting: ['permit', 'inspection', 'plan check', 'AHJ', 'pull', 'approval'],
  solar: ['solar', 'PV', 'RMO', 'MTZ', 'interconnect', 'NEM'],
  pipeline: ['pipeline', 'lead', 'prospect', 'GC', 'contract', 'negotiat'],
  crew: ['crew', 'hire', 'employee', 'sub', 'apprentice', 'helper'],
  cashflow: ['cash', 'revenue', 'profit', 'income', 'expense', 'payroll'],
  compliance: ['NEC', 'CEC', 'code', 'compliance', 'title 24', 'CBC'],
}

function _extractTopics(text: string): string[] {
  const lower = text.toLowerCase()
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => lower.includes(kw.toLowerCase())))
    .map(([topic]) => topic)
}

function _extractQuestions(userMessages: string[]): string[] {
  return userMessages
    .filter((msg) => msg.trim().endsWith('?'))
    .map((msg) => msg.trim().slice(0, 100))
    .slice(0, 5)
}

const DECISION_PATTERNS = [
  /\b(i('ll| will)|going to|decided|confirmed|approved|let's|let me)\b/i,
  /\b(yes|agreed|ok|alright|sounds good|do it|proceed)\b/i,
  /\b(i need to|i should|i want to|i'm going to|planning to)\b/i,
]

function _extractDecisions(userMessages: string[]): string[] {
  return userMessages
    .filter((msg) => DECISION_PATTERNS.some((re) => re.test(msg)))
    .map((msg) => msg.trim().slice(0, 120))
    .slice(0, 5)
}

const SKILL_SIGNAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /NEC\s*\d{3,}|article\s*\d+/i, label: 'NEC code reference' },
  { pattern: /CEC|title 24|CBC|AHJ|plan check/i, label: 'CA compliance knowledge' },
  { pattern: /load calc|demand factor|VA|kVA|ampacity/i, label: 'electrical calculations' },
  { pattern: /\bRMO\b|\bQME\b|responsible managing|solar contractor/i, label: 'RMO/solar licensing' },
  { pattern: /change order|RFI|submittal|closeout/i, label: 'commercial project management' },
  { pattern: /prevailing wage|DIR|certified payroll/i, label: 'public works compliance' },
  { pattern: /markup|margin|overhead rate|burden rate/i, label: 'financial/estimating acumen' },
  { pattern: /crew management|apprentice|journeyman|foreman/i, label: 'crew development' },
]

function _extractSkillSignals(
  userMessages: string[],
  allMessages: Array<{ role: string; content: string }>
): string[] {
  const combined = [...userMessages, ...allMessages.map((m) => m.content)].join(' ')
  return SKILL_SIGNAL_PATTERNS
    .filter(({ pattern }) => pattern.test(combined))
    .map(({ label }) => label)
}

// ── ECHO context prompt fragment ──────────────────────────────────────────────

/**
 * Build a prompt fragment from ECHO memory for injection into NEXUS system prompt.
 * Returns the owner identity + recent conversation insights.
 */
export function buildEchoContextFragment(maxEntries = 5): string {
  if (!_initialized) initEchoMemory()

  const lines: string[] = ['## ECHO Memory (Long-term Context)']

  const ownerAnchor = getOwnerIdentity()
  if (ownerAnchor) {
    lines.push(`Owner: ${ownerAnchor.content}`)
  }

  const recentConversations = _entries
    .filter((e) => e.type === 'nexus_conversation')
    .slice(0, maxEntries)

  if (recentConversations.length > 0) {
    lines.push('\nRecent session patterns:')
    recentConversations.forEach((e) => {
      lines.push(`  - ${e.content}`)
    })
  }

  const topSkillSignals = _entries
    .filter((e) => e.type === 'skill_signal')
    .slice(0, 5)

  if (topSkillSignals.length > 0) {
    lines.push(`\nDetected skill signals: ${topSkillSignals.map((e) => e.content).join(', ')}`)
  }

  return lines.join('\n')
}
