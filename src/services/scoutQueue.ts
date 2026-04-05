// @ts-nocheck
/**
 * SCOUT Silent Improvement Queue
 *
 * Manages the local improvement queue that SCOUT populates silently
 * when it detects improvement suggestions during user conversations.
 *
 * Queue is stored in localStorage under 'poweron_scout_queue'.
 * It is NEVER surfaced mid-conversation — only shown when the user
 * explicitly opens the Scout panel or asks "what improvements have you flagged?"
 *
 * FIX 1 — V3 SCOUT background mode
 */

const QUEUE_KEY = 'poweron_scout_queue'
const MAX_QUEUE_SIZE = 50

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScoutQueueEntry {
  id:         string
  timestamp:  string   // ISO 8601
  suggestion: string   // The improvement text / SCOUT analysis output
  context:    string   // The original user message that triggered it
  status:     'pending' | 'reviewed' | 'dismissed'
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read the full queue from localStorage.
 * Returns newest-first order.
 */
export function getScoutQueue(): ScoutQueueEntry[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Count pending (unreviewed) items in the queue.
 */
export function getScoutQueuePendingCount(): number {
  return getScoutQueue().filter(e => e.status === 'pending').length
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Add a new item to the silent improvement queue.
 * Capped at MAX_QUEUE_SIZE entries — oldest are dropped when full.
 * Returns the created entry.
 */
export function addToScoutQueue(
  suggestion: string,
  context:    string
): ScoutQueueEntry {
  const entry: ScoutQueueEntry = {
    id:         crypto.randomUUID(),
    timestamp:  new Date().toISOString(),
    suggestion: suggestion.trim(),
    context:    context.trim(),
    status:     'pending',
  }

  const queue   = getScoutQueue()
  const updated = [entry, ...queue].slice(0, MAX_QUEUE_SIZE) // newest-first, capped

  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(updated))
  } catch {
    // Non-critical — storage may be full
    console.warn('[ScoutQueue] Failed to persist to localStorage')
  }

  console.log('[ScoutQueue] Added improvement silently:', entry.id, suggestion.slice(0, 80))
  return entry
}

/**
 * Update the status of a queue entry (pending → reviewed or dismissed).
 */
export function updateQueueEntryStatus(
  id:     string,
  status: ScoutQueueEntry['status']
): void {
  const queue   = getScoutQueue()
  const updated = queue.map(e => e.id === id ? { ...e, status } : e)
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(updated))
  } catch {
    // Non-critical
  }
}

/**
 * Permanently remove a dismissed entry from the queue.
 */
export function removeFromScoutQueue(id: string): void {
  const queue   = getScoutQueue()
  const updated = queue.filter(e => e.id !== id)
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(updated))
  } catch {
    // Non-critical
  }
}

/**
 * Clear all dismissed entries from the queue (housekeeping).
 */
export function clearDismissedFromScoutQueue(): void {
  const queue   = getScoutQueue()
  const updated = queue.filter(e => e.status !== 'dismissed')
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(updated))
  } catch {
    // Non-critical
  }
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a queue entry as a ready-to-use Cowork prompt string.
 * Used by "Convert to Session" button — copies to clipboard.
 */
export function formatAsCoworkPrompt(entry: ScoutQueueEntry): string {
  const date = new Date(entry.timestamp).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  return [
    `SCOUT flagged an improvement idea on ${date}:`,
    ``,
    `"${entry.suggestion}"`,
    ``,
    `Original context: "${entry.context}"`,
    ``,
    `Please analyze this improvement, check if it aligns with the current roadmap, and create a formal proposal if it passes MiroFish review.`,
  ].join('\n')
}
