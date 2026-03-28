// @ts-nocheck
/**
 * NEXUS Orchestrator — the main entry point for all user interactions.
 *
 * Pipeline: classify → route → respond → audit
 *
 * Every user message flows through this orchestrator. It:
 * 1. Loads memory context from Redis + vector search
 * 2. Classifies the intent
 * 3. Routes to the correct agent
 * 4. Returns the response
 * 5. Logs everything to audit_trail
 */

import { classifyIntent, type ClassifiedIntent, type ConversationMessage } from './classifier'
import { routeToAgent, type AgentResponse } from './router'
import { getAgentContext, recordAgentDecision, type AgentId } from '@/lib/memory/redis-context'
import { searchMemory } from '@/lib/memory/embeddings'
import { logAudit } from '@/lib/memory/audit'
import { supabase } from '@/lib/supabase'

// ── Types ───────────────────────────────────────────────────────────────────

export interface NexusRequest {
  message:     string
  orgId:       string
  userId:      string
  userName:    string
  conversationHistory: ConversationMessage[]
}

export interface NexusResponse {
  intent:     ClassifiedIntent
  agent:      AgentResponse
  /** If true, the UI should show a confirmation card before executing */
  needsConfirmation: boolean
  conversationMessage: ConversationMessage
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Main NEXUS pipeline. Call this for every user message.
 */
export async function processMessage(request: NexusRequest): Promise<NexusResponse> {
  const startTime = Date.now()

  // ── Step 1: Load memory context ─────────────────────────────────────────
  let memoryContext = ''

  try {
    // Load NEXUS short-term context from Redis
    const nexusCtx = await getAgentContext(request.orgId, 'nexus')
    const ctxParts: string[] = []

    if (nexusCtx.activeFlags.length > 0) {
      ctxParts.push(
        `Active Flags:\n${nexusCtx.activeFlags.map(f => `  - [${f.severity}] ${f.type}: ${f.message}`).join('\n')}`
      )
    }

    if (nexusCtx.recentDecisions.length > 0) {
      ctxParts.push(
        `Recent Decisions:\n${nexusCtx.recentDecisions.slice(0, 3).map(d => `  - ${d.description}`).join('\n')}`
      )
    }

    // Semantic search for relevant memories
    try {
      const memories = await searchMemory({
        orgId:     request.orgId,
        query:     request.message,
        limit:     5,
        threshold: 0.72,
      })

      if (memories.length > 0) {
        ctxParts.push(
          `Relevant Memories:\n${memories.map(m => `  - [${m.entity_type}] ${m.content.slice(0, 200)}`).join('\n')}`
        )
      }
    } catch {
      // Vector search may fail if OpenAI key isn't set — that's ok
      console.warn('[NEXUS] Semantic search unavailable, continuing without it.')
    }

    memoryContext = ctxParts.join('\n\n')
  } catch (err) {
    console.warn('[NEXUS] Memory context loading failed, continuing:', err)
  }

  // ── Step 2: Classify intent ─────────────────────────────────────────────
  const intent = await classifyIntent(
    request.message,
    memoryContext,
    request.conversationHistory
  )

  // ── Step 3: Route to target agent ───────────────────────────────────────
  const agentResponse = await routeToAgent(
    intent,
    request.message,
    request.orgId,
    request.conversationHistory
  )

  // ── Step 4: Determine if confirmation is needed ─────────────────────────
  const needsConfirmation =
    intent.requiresConfirmation ||
    intent.impactLevel === 'HIGH' ||
    intent.impactLevel === 'CRITICAL'

  // ── Step 5: Log to audit trail ──────────────────────────────────────────
  const duration = Date.now() - startTime

  try {
    await logAudit({
      action:      'send',
      entity_type: 'agent_messages',
      description: `NEXUS processed message → ${agentResponse.agentName} (${intent.category}, ${intent.impactLevel}, ${intent.confidence.toFixed(2)} confidence, ${duration}ms)`,
      metadata: {
        user_message:   request.message.slice(0, 500),
        category:       intent.category,
        target_agent:   intent.targetAgent,
        confidence:     intent.confidence,
        impact_level:   intent.impactLevel,
        entities:       intent.entities,
        duration_ms:    duration,
        needs_confirm:  needsConfirmation,
      },
    })
  } catch (err) {
    console.warn('[NEXUS] Audit log failed:', err)
  }

  // ── Step 6: Record decision in Redis context ────────────────────────────
  try {
    await recordAgentDecision(request.orgId, 'nexus', {
      description: `Routed "${request.message.slice(0, 100)}" → ${agentResponse.agentName} (${intent.impactLevel})`,
      reasoning:   intent.reasoning,
    })
  } catch {
    // Non-critical — continue
  }

  // ── Step 7: Log inter-agent message to Supabase ─────────────────────────
  try {
    await supabase.from('agent_messages').insert({
      org_id:     request.orgId,
      from_agent: 'nexus',
      to_agent:   intent.targetAgent,
      type:       'delegation',
      priority:   intent.impactLevel === 'CRITICAL' || intent.impactLevel === 'HIGH' ? 'high' : 'normal',
      subject:    request.message.slice(0, 200),
      payload: {
        user_message:  request.message,
        intent,
        response_preview: agentResponse.content.slice(0, 500),
      },
      status: 'processed',
      processed_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[NEXUS] Agent message log failed:', err)
  }

  // ── Return ──────────────────────────────────────────────────────────────

  const conversationMessage: ConversationMessage = {
    role:      'assistant',
    content:   agentResponse.content,
    agentId:   agentResponse.agentId,
    timestamp: Date.now(),
  }

  return {
    intent,
    agent: agentResponse,
    needsConfirmation,
    conversationMessage,
  }
}

// ── Re-exports for convenience ──────────────────────────────────────────────
export type { ClassifiedIntent, ConversationMessage } from './classifier'
export type { AgentResponse } from './router'
export { INTENT_CATEGORIES, IMPACT_LEVELS, TARGET_AGENTS } from './classifier'
