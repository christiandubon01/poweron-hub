/**
 * Agent short-term context — Layer 1 of the memory bus.
 *
 * Each agent gets its own context slot in Redis (TTL 4h).
 * Agents read their context at the start of every invocation to resume
 * from where they left off (current tasks, recent decisions, active flags).
 *
 * This module is primarily called from Phase 02+ agent code.
 * In Phase 01 it's wired up and ready to use.
 */

import { rGet, rSet, rDel, redisKeys, TTL } from '@/lib/redis'

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentId =
  | 'nexus' | 'vault' | 'pulse' | 'ledger' | 'spark'
  | 'blueprint' | 'ohm' | 'chrono' | 'scout'

export interface AgentContext {
  agentId:          AgentId
  orgId:            string
  currentTasks:     Task[]
  recentDecisions:  Decision[]
  activeFlags:      Flag[]
  lastQuery:        string | null
  lastUpdatedAt:    number   // unix ms
}

export interface Task {
  id:          string
  description: string
  status:      'pending' | 'in_progress' | 'completed'
  priority:    'low' | 'normal' | 'high'
  createdAt:   number
}

export interface Decision {
  at:          number     // unix ms
  description: string
  reasoning?:  string
  entityRef?:  string     // 'invoice:uuid', 'project:uuid', etc.
}

export interface Flag {
  type:      string    // 'overdue_invoice', 'rfi_expiring', 'anomaly', etc.
  entityRef: string
  message:   string
  severity:  'info' | 'warning' | 'critical'
  raisedAt:  number
}


// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load an agent's current short-term context.
 * Returns a fresh empty context if none exists.
 */
export async function getAgentContext(
  orgId: string,
  agentId: AgentId
): Promise<AgentContext> {
  const cached = await rGet<AgentContext>(redisKeys.agentContext(orgId, agentId))

  if (cached) return cached

  return {
    agentId,
    orgId,
    currentTasks:    [],
    recentDecisions: [],
    activeFlags:     [],
    lastQuery:       null,
    lastUpdatedAt:   Date.now(),
  }
}

/**
 * Persist an agent's updated context back to Redis.
 * Call this at the end of every agent invocation.
 */
export async function setAgentContext(context: AgentContext): Promise<void> {
  const updated = { ...context, lastUpdatedAt: Date.now() }
  await rSet(
    redisKeys.agentContext(context.orgId, context.agentId),
    updated,
    TTL.AGENT_CONTEXT
  )
}

/**
 * Add a task to an agent's context.
 */
export async function addAgentTask(
  orgId:   string,
  agentId: AgentId,
  task:    Omit<Task, 'id' | 'createdAt'>
): Promise<void> {
  const ctx = await getAgentContext(orgId, agentId)
  ctx.currentTasks.push({
    ...task,
    id:        crypto.randomUUID(),
    createdAt: Date.now(),
  })
  // Keep max 20 tasks in context
  if (ctx.currentTasks.length > 20) {
    ctx.currentTasks = ctx.currentTasks.slice(-20)
  }
  await setAgentContext(ctx)
}

/**
 * Record a decision the agent made (for transparency and debugging).
 */
export async function recordAgentDecision(
  orgId:    string,
  agentId:  AgentId,
  decision: Omit<Decision, 'at'>
): Promise<void> {
  const ctx = await getAgentContext(orgId, agentId)
  ctx.recentDecisions.unshift({ ...decision, at: Date.now() })
  // Keep max 10 recent decisions
  if (ctx.recentDecisions.length > 10) {
    ctx.recentDecisions = ctx.recentDecisions.slice(0, 10)
  }
  await setAgentContext(ctx)
}

/**
 * Set a real-time flag (overdue invoice, RFI expiring, anomaly, etc.).
 */
export async function raiseFlag(
  orgId:   string,
  agentId: AgentId,
  flag:    Omit<Flag, 'raisedAt'>
): Promise<void> {
  const ctx = await getAgentContext(orgId, agentId)
  // Remove any existing flag of the same type + entity
  ctx.activeFlags = ctx.activeFlags.filter(
    f => !(f.type === flag.type && f.entityRef === flag.entityRef)
  )
  ctx.activeFlags.push({ ...flag, raisedAt: Date.now() })
  await setAgentContext(ctx)
}

/**
 * Clear a flag (once the issue is resolved).
 */
export async function clearFlag(
  orgId:     string,
  agentId:   AgentId,
  flagType:  string,
  entityRef: string
): Promise<void> {
  const ctx = await getAgentContext(orgId, agentId)
  ctx.activeFlags = ctx.activeFlags.filter(
    f => !(f.type === flagType && f.entityRef === entityRef)
  )
  await setAgentContext(ctx)
}

/**
 * Clear all context for an agent (e.g., on error recovery).
 */
export async function resetAgentContext(orgId: string, agentId: AgentId): Promise<void> {
  await rDel(redisKeys.agentContext(orgId, agentId))
}
