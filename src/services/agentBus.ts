// @ts-nocheck
/**
 * agentBus — Shared Memory Bus for Cross-Agent Communication
 *
 * All inter-agent messages route through NEXUS (the arbitration layer).
 * No agent writes directly to another agent's data store.
 *
 * Design:
 * - In-memory queue for immediate delivery
 * - Supabase persistence for durable / cross-session messages
 * - NEXUS intercepts all messages before delivery
 * - Broadcast support via to: 'ALL'
 * - Local-first: bus works without Supabase connection
 */

import { supabase } from '@/lib/supabase'
import { autoSnapshot } from './snapshotService'

// ── Agent Names ──────────────────────────────────────────────────────────────

export type AgentName =
  | 'NEXUS'
  | 'VAULT'
  | 'BLUEPRINT'
  | 'LEDGER'
  | 'PULSE'
  | 'CHRONO'
  | 'OHM'
  | 'SPARK'
  | 'SCOUT'

// ── Message Types ────────────────────────────────────────────────────────────

export type AgentEvent =
  | 'data_updated'
  | 'alert'
  | 'request'
  | 'response'
  | 'broadcast'
  | 'conflict'
  | 'proposal_approved'
  | 'proposal_queued'

// ── Core Message Shape ───────────────────────────────────────────────────────

export interface AgentMessage {
  id:        string
  from:      AgentName
  to:        AgentName | 'ALL'
  type:      AgentEvent
  payload:   Record<string, unknown>
  timestamp: number
  status:    'pending' | 'delivered' | 'processed'
}

// ── Internal State ───────────────────────────────────────────────────────────

const _handlers = new Map<AgentName, Set<(msg: AgentMessage) => void>>()
const _queue    = new Map<AgentName, AgentMessage[]>()

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function ensureQueue(agent: AgentName): void {
  if (!_queue.has(agent)) _queue.set(agent, [])
}

// ── Supabase Persistence ─────────────────────────────────────────────────────

async function persistMessage(msg: AgentMessage): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('agent_messages').insert({
      id:         msg.id,
      from_agent: msg.from,
      to_agent:   msg.to,
      type:       msg.type,
      payload:    msg.payload,
      status:     msg.status,
      created_at: new Date(msg.timestamp).toISOString(),
    })
  } catch (err) {
    // Supabase unavailable — bus still works locally
    console.warn('[AgentBus] Supabase persist failed (bus continues locally):', err)
  }
}

async function updateMessageStatus(id: string, status: AgentMessage['status']): Promise<void> {
  if (!supabase) return
  try {
    await supabase.from('agent_messages').update({ status }).eq('id', id)
  } catch {
    // silently continue
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * publish — Send a message from one agent to another (or ALL), routed through NEXUS.
 *
 * Always goes to NEXUS first. NEXUS arbitration.ts will then decide delivery.
 */
export async function publish(
  from:    AgentName,
  to:      AgentName | 'ALL',
  type:    AgentEvent,
  payload: Record<string, unknown>
): Promise<AgentMessage> {
  const msg: AgentMessage = {
    id:        generateId(),
    from,
    to,
    type,
    payload,
    timestamp: Date.now(),
    status:    'pending',
  }

  console.log(`[AgentBus] ${from} → ${to} [${type}]`, payload)

  // Persist to Supabase (fire-and-forget)
  persistMessage(msg)

  // Route through NEXUS arbitration
  const { arbitrate } = await import('@/agents/nexus/arbitration')
  await arbitrate(msg)

  return msg
}

/**
 * subscribe — Register a handler for messages delivered to an agent.
 * Returns an unsubscribe function.
 */
export function subscribe(
  agent:   AgentName,
  handler: (msg: AgentMessage) => void
): () => void {
  if (!_handlers.has(agent)) _handlers.set(agent, new Set())
  _handlers.get(agent)!.add(handler)
  ensureQueue(agent)

  console.log(`[AgentBus] ${agent} subscribed`)

  return () => {
    _handlers.get(agent)?.delete(handler)
  }
}

/**
 * deliver — Internal delivery function called by NEXUS arbitration.
 * Calls all handlers registered for the target agent.
 */
export function deliver(msg: AgentMessage, target: AgentName): void {
  ensureQueue(target)

  const updatedMsg = { ...msg, status: 'delivered' as const }

  // Add to agent's queue
  _queue.get(target)!.push(updatedMsg)

  // Trim queue to last 100 messages per agent
  const q = _queue.get(target)!
  if (q.length > 100) q.splice(0, q.length - 100)

  // ── proposal_approved hook ────────────────────────────────────────────────
  // When a proposal is approved, auto-snapshot before the target agent executes.
  if (msg.type === 'proposal_approved' && msg.payload) {
    const title = (msg.payload.title as string) || 'approved proposal'
    const data  = (msg.payload.data as Record<string, unknown>) || msg.payload
    autoSnapshot('MiroFish', `proposal approved — ${title}`, data)
    console.log(`[AgentBus] proposal_approved auto-snapshot fired for: ${title}`)
  }

  // Fire handlers
  const handlers = _handlers.get(target)
  if (handlers && handlers.size > 0) {
    for (const handler of handlers) {
      try {
        handler(updatedMsg)
      } catch (err) {
        console.error(`[AgentBus] Handler error for ${target}:`, err)
      }
    }
    // Mark processed once delivered to live handler
    updateMessageStatus(msg.id, 'processed')
  } else {
    // No live handler — stays in queue, update status to delivered
    updateMessageStatus(msg.id, 'delivered')
  }
}

/**
 * getQueueFor — Return pending messages for an agent (not yet consumed).
 */
export function getQueueFor(agent: AgentName): AgentMessage[] {
  return [...(_queue.get(agent) ?? [])]
}

/**
 * getRecentRouted — Get last N messages from Supabase for NEXUS activity log.
 */
export async function getRecentRouted(limit = 5): Promise<AgentMessage[]> {
  if (!supabase) return []
  try {
    const { data, error } = await supabase
      .from('agent_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return data.map((row: any) => ({
      id:        row.id,
      from:      row.from_agent,
      to:        row.to_agent,
      type:      row.type,
      payload:   row.payload ?? {},
      timestamp: new Date(row.created_at).getTime(),
      status:    row.status,
    }))
  } catch {
    return []
  }
}
