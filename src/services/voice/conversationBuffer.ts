/**
 * B59 — NEXUS Voice Conversation Buffer
 *
 * Module-level rolling buffer for voice conversation history.
 * Keeps the last 3 full turns (user + assistant × 3 = 6 messages max).
 * In-memory only — resets on page reload (intentional).
 */

export interface ConversationEntry {
  role: 'user' | 'assistant'
  content: string
}

const MAX_ENTRIES = 6 // 3 user + 3 assistant

let buffer: ConversationEntry[] = []

/**
 * Append a user turn and auto-trim to MAX_ENTRIES.
 */
export function addUserTurn(text: string): void {
  buffer.push({ role: 'user', content: text })
  if (buffer.length > MAX_ENTRIES) {
    buffer = buffer.slice(buffer.length - MAX_ENTRIES)
  }
}

/**
 * Append an assistant turn and auto-trim to MAX_ENTRIES.
 */
export function addAssistantTurn(text: string): void {
  buffer.push({ role: 'assistant', content: text })
  if (buffer.length > MAX_ENTRIES) {
    buffer = buffer.slice(buffer.length - MAX_ENTRIES)
  }
}

/**
 * Return a copy of the current conversation buffer.
 */
export function getHistory(): ConversationEntry[] {
  return [...buffer]
}

/**
 * Clear all entries (e.g. on explicit session reset).
 */
export function clearBuffer(): void {
  buffer = []
}
