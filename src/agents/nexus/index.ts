// @ts-nocheck
/**
 * NEXUS Orchestrator — the main entry point for all user interactions.
 *
 * Pipeline: load memory → classify → route → respond → log → update memory
 *
 * Every user message flows through this orchestrator. It:
 * 1. Loads memory context from nexusMemory (localStorage + Supabase)
 * 2. Classifies the intent using fast keyword scoring + Claude fallback
 * 3. Routes to the correct agent via claudeProxy
 * 4. Returns the response
 * 5. Updates persistent memory with conversation turn
 */

import { classifyIntent, type ClassifiedIntent, type ConversationMessage } from './classifier'
import { routeToAgent, type AgentResponse } from './router'
import { addTurn, getContext, updateProjectContext, getMemory } from '@/services/nexusMemory'
import { checkInterviewTrigger, type AgentInterviewDefinition } from './interviewDefinitions'

// ── Types ───────────────────────────────────────────────────────────────────

export interface NexusRequest {
  message:     string
  orgId:       string
  userId:      string
  userName?:   string
  conversationHistory: ConversationMessage[]
  isVoiceCommand?: boolean
}

export interface NexusResponse {
  intent:     ClassifiedIntent
  agent:      AgentResponse
  /** If true, the UI should show a confirmation card before executing */
  needsConfirmation: boolean
  conversationMessage: ConversationMessage
  /** If set, the UI should show an interview card instead of a chat response */
  interviewTrigger?: AgentInterviewDefinition
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
    memoryContext = getContext(10)
  } catch (err) {
    console.warn('[NEXUS] Memory context loading failed, continuing:', err)
  }

  // ── Step 2: Record user turn to persistent memory ───────────────────────
  try {
    addTurn('user', request.message)
  } catch {
    // Non-critical
  }

  // ── Step 3: Classify intent ─────────────────────────────────────────────
  const intent = await classifyIntent(
    request.message,
    memoryContext,
    request.conversationHistory
  )

  console.log(`[NEXUS] Classified → ${intent.targetAgent} (${intent.category}, ${intent.confidence.toFixed(2)})`)

  // ── Step 3b: Check for interview triggers ─────────────────────────────
  const interviewDef = checkInterviewTrigger(request.message, intent.targetAgent)
  if (interviewDef && !request.isVoiceCommand) {
    console.log(`[NEXUS] Interview triggered for ${interviewDef.agentName}`)
  }

  // ── Step 4: Route to target agent ───────────────────────────────────────
  const agentResponse = await routeToAgent(
    intent,
    request.message,
    request.orgId,
    request.conversationHistory
  )

  // ── Step 5: Determine if confirmation is needed ─────────────────────────
  const needsConfirmation =
    intent.requiresConfirmation ||
    intent.impactLevel === 'HIGH' ||
    intent.impactLevel === 'CRITICAL'

  const duration = Date.now() - startTime
  console.log(`[NEXUS] Routed to ${agentResponse.agentName} in ${duration}ms`)

  // ── Step 6: Record assistant turn to persistent memory ──────────────────
  try {
    addTurn('assistant', agentResponse.content, agentResponse.agentId)

    // Update project context if entities mention a project
    const projectEntity = intent.entities.find(e => e.type === 'project')
    if (projectEntity) {
      updateProjectContext({ lastDiscussedProject: projectEntity.value })
    }

    // Track code questions for OHM
    if (intent.targetAgent === 'ohm') {
      const memory = getMemory()
      const codeQuestions = memory.projectContext.activeCodeQuestions || []
      if (codeQuestions.length < 10) {
        updateProjectContext({
          activeCodeQuestions: [...codeQuestions, request.message.slice(0, 100)]
        })
      }
    }
  } catch {
    // Non-critical
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
    interviewTrigger: (interviewDef && !request.isVoiceCommand) ? interviewDef : undefined,
  }
}

/**
 * Check if a message + agent combination should trigger an interview.
 * Exposed for UI components to call directly.
 */
export function checkForInterview(
  message: string,
  targetAgent: string
): AgentInterviewDefinition | null {
  return checkInterviewTrigger(message, targetAgent as any)
}

/**
 * Merge interview questions when two agents need the same project info.
 * Returns a combined interview definition scoped to the primary agent,
 * with questions from both agents deduplicated by memoryKey.
 */
export function mergeInterviewQuestions(
  primary: AgentInterviewDefinition,
  secondary: AgentInterviewDefinition
): AgentInterviewDefinition {
  const seenKeys = new Set(primary.questions.map(q => q.memoryKey).filter(Boolean))
  const extraQuestions = secondary.questions.filter(q => {
    if (!q.memoryKey || seenKeys.has(q.memoryKey)) return false
    seenKeys.add(q.memoryKey)
    return true
  })

  // Limit to max 3 total questions
  const merged = [...primary.questions, ...extraQuestions].slice(0, 3)

  return {
    ...primary,
    questions: merged,
  }
}

// ── Re-exports for convenience ──────────────────────────────────────────────
export type { ClassifiedIntent, ConversationMessage } from './classifier'
export type { AgentResponse } from './router'
export type { AgentInterviewDefinition } from './interviewDefinitions'
export { INTENT_CATEGORIES, IMPACT_LEVELS, TARGET_AGENTS } from './classifier'
export { AGENT_INTERVIEWS, checkInterviewTrigger } from './interviewDefinitions'
