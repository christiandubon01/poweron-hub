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
  | 'REVIEW_RECEIVED'
  | 'HIGH_VALUE_LEAD'
  | 'LOW_VALUE_LEAD'
  | 'LEAD_SCORED'
  | 'CAMPAIGN_RESULT'
  | 'SOCIAL_POST_PUBLISHED'
  | 'PATTERN_LEARNED'
  | 'PROPOSAL_APPROVED'
  | 'PROPOSAL_REJECTED'

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

/**
 * Wire cross-entity embeddings — auto-embed event payloads into vector memory.
 * Call once on app startup after initEventBus().
 * Returns an unsubscribe function.
 */
export function initCrossEntityEmbeddings(orgId: string): () => void {
  // Event types that should auto-embed their content
  const EMBED_EVENTS: AgentEventType[] = [
    'PROJECT_UPDATED',
    'SERVICE_LOG_ADDED',
    'FIELD_LOG_ADDED',
    'ESTIMATE_APPROVED',
    'COMPLIANCE_FLAG',
    'PATTERN_LEARNED',
  ]

  return subscribe('*', (event: AgentEvent) => {
    if (!EMBED_EVENTS.includes(event.type)) return

    // Fire-and-forget embedding — use setTimeout to avoid blocking event loop
    setTimeout(async () => {
      try {
        const { embedAndStore } = await import('@/services/vectorMemory')

        // Map event type to entity type
        const entityTypeMap: Record<string, string> = {
          'PROJECT_UPDATED': 'project',
          'SERVICE_LOG_ADDED': 'service_call',
          'FIELD_LOG_ADDED': 'field_log',
          'ESTIMATE_APPROVED': 'estimate',
          'COMPLIANCE_FLAG': 'compliance',
          'PATTERN_LEARNED': 'pattern',
        }

        const entityType = entityTypeMap[event.type] || 'general'
        const entityId = (event.payload?.projectId || event.payload?.entityId || event.payload?.patternId || event.id) as string

        // Build rich content from event summary + payload
        const contentParts = [event.summary]
        if (event.payload?.description) contentParts.push(String(event.payload.description))
        if (event.payload?.notes) contentParts.push(String(event.payload.notes))
        if (event.payload?.pattern) contentParts.push(String(event.payload.pattern))
        if (event.payload?.actionable) contentParts.push(String(event.payload.actionable))

        const content = contentParts.join('. ')

        await embedAndStore(
          orgId,
          entityType as any,
          content,
          entityId,
          event.source,
          {
            eventType: event.type,
            eventId: event.id,
            timestamp: event.timestamp,
          }
        )

        console.log(`[EventBus] Auto-embedded ${event.type} event: ${event.id}`)
      } catch (err) {
        console.warn(`[EventBus] Auto-embed failed for ${event.type}:`, err)
      }
    }, 100) // Small delay to not block event processing
  })
}

// ── Post-Approval Execution Hook ────────────────────────────────────────────

/**
 * Initialize the post-approval execution hook.
 * When a MiroFish proposal is approved:
 *   1. Log the approval to agent_messages table (via audit)
 *   2. Create auto-snapshot: "MiroFish — proposal approved — [title] — [timestamp]"
 *   3. Emit to the target agent for execution
 *
 * Call once on app startup after initEventBus().
 */
export function initPostApprovalHook(): () => void {
  return subscribe('PROPOSAL_APPROVED' as AgentEventType, (event: AgentEvent) => {
    const { proposalId, title, proposingAgent, actionType, actionPayload, confirmedBy } = event.payload as any

    console.log(`[PostApproval] Proposal approved: "${title}" from ${proposingAgent}`)

    // 1. Log via audit (fire-and-forget)
    setTimeout(async () => {
      try {
        const { logAudit } = await import('@/lib/memory/audit')
        await logAudit({
          action: 'approve',
          entity_type: 'agent_proposals',
          entity_id: proposalId,
          description: `MiroFish — proposal approved — ${title} — ${new Date().toISOString()}`,
          metadata: {
            proposing_agent: proposingAgent,
            action_type: actionType,
            confirmed_by: confirmedBy,
          },
        })
      } catch (err) {
        console.warn('[PostApproval] Audit log failed:', err)
      }
    }, 50)

    // 2. Create auto-snapshot
    setTimeout(async () => {
      try {
        const { createSnapshot } = await import('@/lib/storage')
        if (typeof createSnapshot === 'function') {
          await createSnapshot(`MiroFish — proposal approved — ${title} — ${new Date().toISOString()}`)
        }
      } catch (err) {
        console.warn('[PostApproval] Snapshot failed:', err)
      }
    }, 200)

    // 3. Notify the proposing agent via a targeted event
    // The target agent MUST check for a valid approved proposal before executing
    setTimeout(() => {
      publish(
        'DATA_GAP_DETECTED', // Reuse as generic "agent action needed" event
        'mirofish',
        {
          type:           'execute_approved_proposal',
          proposalId,
          title,
          targetAgent:    proposingAgent,
          actionType,
          actionPayload,
          approvedAt:     new Date().toISOString(),
        },
        `Execute approved proposal: ${title} → ${proposingAgent}`
      )
    }, 300)
  })
}
