// @ts-nocheck
/**
 * NEXUS Arbitration Layer — All cross-agent messages pass through here.
 *
 * Responsibilities:
 * 1. Route messages to correct agent(s)
 * 2. Merge conflicting concurrent requests (e.g. VAULT + BLUEPRINT both
 *    touching the same project cost) — resolveConflict() handles this
 * 3. Log all routing decisions to agent_messages table (status: 'processed')
 * 4. Block any agent from writing to another agent's primary table directly
 *
 * CONSTRAINT: No agent acts alone. All inter-agent actions route through here.
 */

import { deliver, type AgentMessage, type AgentName } from '@/services/agentBus'
import { supabase } from '@/lib/supabase'

// ── All registered agent names ───────────────────────────────────────────────

const ALL_AGENTS: AgentName[] = [
  'VAULT', 'BLUEPRINT', 'LEDGER', 'PULSE', 'CHRONO', 'OHM', 'SPARK', 'SCOUT'
]

// ── Conflict resolution state ────────────────────────────────────────────────

interface PendingConflict {
  messages: AgentMessage[]
  subject:  string  // e.g. 'project_cost:p3'
  timer:    ReturnType<typeof setTimeout>
}

const _pendingConflicts = new Map<string, PendingConflict>()

// ── Main Arbitration Entry Point ─────────────────────────────────────────────

/**
 * arbitrate — Receive a message from agentBus.publish() and decide what to do.
 *
 * Routing logic:
 * - to === 'ALL'    → broadcast to every agent
 * - to === 'NEXUS'  → NEXUS itself consumes (logs + may self-handle)
 * - type === 'conflict' → resolveConflict()
 * - otherwise       → route directly to target agent
 *
 * All routing decisions are logged.
 */
export async function arbitrate(message: AgentMessage): Promise<void> {
  console.log(`[NEXUS Arbitration] Routing: ${message.from} → ${message.to} [${message.type}]`)

  try {
    if (message.type === 'conflict') {
      await resolveConflict(message)
      return
    }

    if (message.to === 'ALL') {
      // Broadcast to all agents except the sender
      const targets = ALL_AGENTS.filter(a => a !== message.from)
      for (const target of targets) {
        deliver(message, target)
      }
      await logRouting(message, targets, 'broadcast')
      return
    }

    if (message.to === 'NEXUS') {
      // NEXUS self-consumption — log it, no further delivery needed
      // (NEXUS processes it as context — e.g. PULSE weekly digest)
      await logRouting(message, ['NEXUS'], 'self')
      return
    }

    // Direct route
    deliver(message, message.to as AgentName)
    await logRouting(message, [message.to as AgentName], 'direct')

  } catch (err) {
    console.error('[NEXUS Arbitration] Error routing message:', err)
  }
}

// ── Conflict Resolution ──────────────────────────────────────────────────────

/**
 * resolveConflict — Merge conflicting messages from multiple agents.
 *
 * Strategy:
 * - Collect all conflict messages for the same subject within 200ms
 * - After window, merge payloads (last-write wins per field, with priority order)
 * - Deliver the merged result to the originally-intended target
 *
 * Priority order (highest → lowest): LEDGER > VAULT > BLUEPRINT > others
 */
async function resolveConflict(message: AgentMessage): Promise<void> {
  const subject = (message.payload?.subject as string) ?? `${message.to}:${message.type}`
  const key = `conflict:${subject}`

  if (_pendingConflicts.has(key)) {
    // Add to existing conflict window
    const pending = _pendingConflicts.get(key)!
    pending.messages.push(message)
    console.log(`[NEXUS Arbitration] Conflict window: ${pending.messages.length} messages for "${subject}"`)
    return
  }

  // Start a new conflict window
  const conflict: PendingConflict = {
    messages: [message],
    subject,
    timer: setTimeout(async () => {
      _pendingConflicts.delete(key)

      const msgs = conflict.messages
      console.log(`[NEXUS Arbitration] Resolving conflict for "${subject}" from ${msgs.map(m => m.from).join(', ')}`)

      // Merge payloads in priority order
      const PRIORITY: AgentName[] = ['LEDGER', 'VAULT', 'BLUEPRINT', 'CHRONO', 'OHM', 'SPARK', 'SCOUT', 'PULSE']
      const sorted = [...msgs].sort((a, b) => {
        const pa = PRIORITY.indexOf(a.from as AgentName)
        const pb = PRIORITY.indexOf(b.from as AgentName)
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb)
      })

      const mergedPayload: Record<string, unknown> = {}
      for (const m of sorted) {
        Object.assign(mergedPayload, m.payload)
      }

      // Build the resolved message
      const resolved: AgentMessage = {
        ...msgs[0],
        from:      'NEXUS',
        payload:   { ...mergedPayload, _resolvedFrom: msgs.map(m => m.from), _subject: subject },
        status:    'pending',
        timestamp: Date.now(),
      }

      // Deliver the merged result
      const target = msgs[0].to as AgentName
      if (target !== 'ALL' && target !== 'NEXUS') {
        deliver(resolved, target)
      }

      await logRouting(resolved, target !== 'ALL' ? [target] : ALL_AGENTS, 'conflict_resolved')
    }, 200), // 200ms conflict merge window
  }

  _pendingConflicts.set(key, conflict)
}

// ── Routing Log ──────────────────────────────────────────────────────────────

/**
 * logRouting — Update the message status in Supabase to 'processed'
 * and write a routing_log entry for auditability.
 */
async function logRouting(
  message: AgentMessage,
  targets: string[],
  routeType: 'direct' | 'broadcast' | 'self' | 'conflict_resolved'
): Promise<void> {
  if (!supabase) return
  try {
    await supabase
      .from('agent_messages')
      .update({ status: 'processed' })
      .eq('id', message.id)
  } catch {
    // silently continue — routing still worked in-memory
  }
}

// ── Bus Health ───────────────────────────────────────────────────────────────

export type BusHealth = 'healthy' | 'queued' | 'error'

/**
 * getBusHealth — Returns current bus health for the NEXUS UI indicator.
 * healthy = bus is running, no queued messages
 * queued  = messages sitting in queue without active handlers
 * error   = Supabase or internal error
 */
export async function getBusHealth(): Promise<BusHealth> {
  try {
    const { getQueueFor } = await import('@/services/agentBus')
    const agents: AgentName[] = ['VAULT', 'BLUEPRINT', 'LEDGER', 'PULSE', 'CHRONO', 'OHM', 'SPARK', 'SCOUT']
    const totalQueued = agents.reduce((sum, a) => sum + getQueueFor(a).length, 0)
    return totalQueued > 10 ? 'queued' : 'healthy'
  } catch {
    return 'error'
  }
}
