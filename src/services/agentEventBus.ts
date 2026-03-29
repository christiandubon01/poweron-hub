// @ts-nocheck
/**
 * Agent Event Bus — Centralized pub/sub for cross-agent communication.
 *
 * All agents publish domain events here. NEXUS subscribes to ALL events
 * as context seeds for proactive insights. Individual agents can subscribe
 * to events from other agents to trigger cross-domain workflows.
 *
 * Events are stored in a rolling buffer (max 200) and persisted to
 * localStorage under 'nexus_event_bus' for cross-session continuity.
 *
 * ── Design rules ─────────────────────────────────────────────────────
 * - Fire-and-forget: publishers never wait for subscribers
 * - No circular triggers: subscriber callbacks MUST NOT publish events
 *   in the same synchronous tick (use setTimeout if needed)
 * - All events are immutable after creation
 * - Event buffer auto-prunes to MAX_EVENTS on every publish
 */

// ── Event Types ──────────────────────────────────────────────────────────────

export type AgentEventType =
  | 'PROJECT_UPDATED'
  | 'PROJECT_CREATED'
  | 'SERVICE_LOG_ADDED'
  | 'FIELD_LOG_ADDED'
  | 'INVOICE_CREATED'
  | 'INVOICE_SENT'
  | 'PAYMENT_RECEIVED'
  | 'LEAD_CONVERTED'
  | 'RFI_OPENED'
  | 'RFI_ANSWERED'
  | 'ESTIMATE_APPROVED'
  | 'ESTIMATE_CREATED'
  | 'COMPLIANCE_FLAG'
  | 'SCHEDULE_CONFLICT'
  | 'AR_OVERDUE'
  | 'DATA_GAP_DETECTED'
  | 'CREW_DISPATCHED'
  | 'JOB_SCHEDULED'
  | 'IDLE_SLOTS_DETECTED'
  | 'CLIENT_REMINDER_DRAFTED'
  | 'GCAL_SYNCED'

export interface AgentEvent {
  id:        string
  type:      AgentEventType
  source:    string            // Agent ID that published (e.g. 'ledger', 'vault')
  timestamp: number
  payload:   Record<string, unknown>
  /** Human-readable summary for NEXUS context injection */
  summary:   string
}

export type EventSubscriber = (event: AgentEvent) => void

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'nexus_event_bus'
const MAX_EVENTS = 200

// ── Internal State ───────────────────────────────────────────────────────────

let _events: AgentEvent[] = []
const _subscribers = new Map<AgentEventType | '*', Set<EventSubscriber>>()

// ── ID Generator ─────────────────────────────────────────────────────────────

function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ── Persistence ──────────────────────────────────────────────────────────────

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      _events = Array.isArray(parsed) ? parsed : []
    }
  } catch {
    _events = []
  }
}

function saveToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_events))
  } catch {
    // localStorage full or unavailable — silently continue
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the event bus. Call once on app startup.
 * Loads persisted events from localStorage.
 */
export function initEventBus(): void {
  loadFromStorage()
  console.log(`[EventBus] Initialized with ${_events.length} persisted events`)
}

/**
 * Publish an event to all subscribers.
 * Returns the created event for reference.
 */
export function publish(
  type:    AgentEventType,
  source:  string,
  payload: Record<string, unknown>,
  summary: string
): AgentEvent {
  const event: AgentEvent = {
    id:        generateEventId(),
    type,
    source,
    timestamp: Date.now(),
    payload,
    summary,
  }

  // Add to buffer
  _events.push(event)

  // Prune if over limit
  if (_events.length > MAX_EVENTS) {
    _events = _events.slice(-MAX_EVENTS)
  }

  // Persist
  saveToStorage()

  console.log(`[EventBus] ${source} → ${type}: ${summary}`)

  // Notify type-specific subscribers
  const typeSubscribers = _subscribers.get(type)
  if (typeSubscribers) {
    for (const cb of typeSubscribers) {
      try { cb(event) } catch (err) {
        console.error(`[EventBus] Subscriber error on ${type}:`, err)
      }
    }
  }

  // Notify wildcard subscribers
  const wildcardSubscribers = _subscribers.get('*')
  if (wildcardSubscribers) {
    for (const cb of wildcardSubscribers) {
      try { cb(event) } catch (err) {
        console.error(`[EventBus] Wildcard subscriber error:`, err)
      }
    }
  }

  return event
}

/**
 * Subscribe to a specific event type or '*' for all events.
 * Returns an unsubscribe function.
 */
export function subscribe(
  type: AgentEventType | '*',
  callback: EventSubscriber
): () => void {
  if (!_subscribers.has(type)) {
    _subscribers.set(type, new Set())
  }
  _subscribers.get(type)!.add(callback)

  return () => {
    _subscribers.get(type)?.delete(callback)
  }
}

/**
 * Get recent events, optionally filtered by type or source.
 * Returns newest first.
 */
export function getRecentEvents(options?: {
  type?:   AgentEventType
  source?: string
  limit?:  number
  since?:  number
}): AgentEvent[] {
  let filtered = [..._events]

  if (options?.type) {
    filtered = filtered.filter(e => e.type === options.type)
  }
  if (options?.source) {
    filtered = filtered.filter(e => e.source === options.source)
  }
  if (options?.since) {
    filtered = filtered.filter(e => e.timestamp >= options.since!)
  }

  // Newest first
  filtered.reverse()

  const limit = options?.limit ?? 50
  return filtered.slice(0, limit)
}

/**
 * Get a formatted context string of recent events for NEXUS prompt injection.
 * Returns the last N event summaries as a readable list.
 */
export function getEventContext(limit = 10): string {
  const recent = getRecentEvents({ limit })
  if (recent.length === 0) return ''

  const lines = recent.map(e => {
    const ago = Math.round((Date.now() - e.timestamp) / 60000)
    const timeStr = ago < 1 ? 'just now' : ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`
    return `- [${e.source.toUpperCase()}] ${e.summary} (${timeStr})`
  })

  return `## Recent System Events\n${lines.join('\n')}`
}

/**
 * Get count of events by type since a timestamp.
 * Useful for agents checking if something happened recently.
 */
export function getEventCount(type: AgentEventType, since?: number): number {
  const cutoff = since ?? (Date.now() - 24 * 60 * 60 * 1000) // Default: last 24h
  return _events.filter(e => e.type === type && e.timestamp >= cutoff).length
}

/**
 * Clear all events. Use sparingly — mainly for testing.
 */
export function clearEvents(): void {
  _events = []
  saveToStorage()
}
