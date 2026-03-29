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
import { addTurn, getContext, getCompactContext, updateProjectContext, getMemory, trackInteractionPatterns, applyProfileToPrompt } from '@/services/nexusMemory'
import { checkInterviewTrigger, type AgentInterviewDefinition } from './interviewDefinitions'
import { getEventContext, subscribe, type AgentEvent } from '@/services/agentEventBus'
import { getPendingProposals, type MiroFishProposal } from '@/services/miroFish'

// ── Types ───────────────────────────────────────────────────────────────────

export type NexusMode = 'briefing' | 'deepdive'

export interface NexusRequest {
  message:     string
  orgId:       string
  userId:      string
  userName?:   string
  conversationHistory: ConversationMessage[]
  isVoiceCommand?: boolean
  mode?: NexusMode
}

export interface NexusResponse {
  intent:     ClassifiedIntent
  agent:      AgentResponse
  /** If true, the UI should show a confirmation card before executing */
  needsConfirmation: boolean
  conversationMessage: ConversationMessage
  /** If set, the UI should show an interview card instead of a chat response */
  interviewTrigger?: AgentInterviewDefinition
  /** Pending MiroFish proposals awaiting human confirmation */
  pendingProposals?: MiroFishProposal[]
  /** Current response mode */
  mode: NexusMode
}

// ── Orchestrator ────────────────────────────────────────────────────────────

// ── Deep Dive Detection ─────────────────────────────────────────────────────

const DEEP_DIVE_TRIGGERS = ['go deeper', 'deep dive', 'deepdive', 'full report', 'full breakdown', 'more detail', 'expand']

export function detectMode(message: string, requestedMode?: NexusMode): NexusMode {
  if (requestedMode === 'deepdive') return 'deepdive'
  const lower = message.toLowerCase()
  if (DEEP_DIVE_TRIGGERS.some(t => lower.includes(t))) return 'deepdive'
  return requestedMode ?? 'briefing'
}

const BRIEFING_FORMAT_INSTRUCTION = `
## Response Format — BRIEFING MODE
Format your response as a concise briefing:
- Max 5 bullet points using 🔴 (critical/urgent), 🟡 (needs attention), 🟢 (on track)
- Each bullet: [Emoji] [Agent domain] — [one line max]
- Priority score: HIGH / MEDIUM / LOW
- Top 3 action items numbered (1. 2. 3.)
- Be direct, specific with dollar amounts and names.
`

const DEEP_DIVE_FORMAT_INSTRUCTION = `
## Response Format — DEEP DIVE MODE
Provide a full per-agent breakdown:
- Organize by agent domain (LEDGER, PULSE, BLUEPRINT, etc.) with clear headers
- Each section: status, key numbers, risks, and recommended actions
- Use concrete data — dollar amounts, project names, percentages
- End with a consolidated priority action list
`

/**
 * Main NEXUS pipeline. Call this for every user message.
 */
export async function processMessage(request: NexusRequest): Promise<NexusResponse> {
  const startTime = Date.now()
  const mode = detectMode(request.message, request.mode)

  // ── Step 1: Load memory context + event bus context ─────────────────────
  let memoryContext = ''

  try {
    memoryContext = getCompactContext(10)
  } catch (err) {
    console.warn('[NEXUS] Memory context loading failed, continuing:', err)
  }

  // Append recent cross-agent events for context awareness
  try {
    const eventContext = getEventContext(8)
    if (eventContext) {
      memoryContext = memoryContext
        ? `${memoryContext}\n\n${eventContext}`
        : eventContext
    }
  } catch {
    // Non-critical
  }

  // ── Step 1b: Enrich with vector memory (semantic search) ─────────────
  try {
    const { getRelatedMemories } = await import('@/services/vectorMemory')
    const relatedMemories = await getRelatedMemories(request.orgId, request.message, {
      limit: 3,
      threshold: 0.65,
    })
    if (relatedMemories.length > 0) {
      const memoryLines = relatedMemories.map(m =>
        `- [${m.entity_type}] ${m.content.substring(0, 150)} (${Math.round(m.similarity * 100)}% match)`
      )
      memoryContext += `\n\n## Related Memories (vector search)\n${memoryLines.join('\n')}`
    }
  } catch {
    // Vector memory not available — non-critical
  }

  // ── Step 1c: Add learned patterns context ────────────────────────────
  try {
    const { getPatternContext } = await import('@/services/patternLearning')
    const patternCtx = getPatternContext(3)
    if (patternCtx) {
      memoryContext += `\n\n${patternCtx}`
    }
  } catch {
    // Non-critical
  }

  // ── Step 1d: Add user profile context ────────────────────────────────
  try {
    const profileCtx = applyProfileToPrompt()
    if (profileCtx) {
      memoryContext += `\n\n${profileCtx}`
    }
  } catch {
    // Non-critical
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
  // Inject mode-specific formatting instruction into the message
  const modeInstruction = mode === 'deepdive' ? DEEP_DIVE_FORMAT_INSTRUCTION : BRIEFING_FORMAT_INSTRUCTION
  const enrichedMessage = `${request.message}\n\n${modeInstruction}`

  let agentResponse = await routeToAgent(
    intent,
    enrichedMessage,
    request.orgId,
    request.conversationHistory
  )

  // ── Step 5: Determine if confirmation is needed ─────────────────────────
  const needsConfirmation =
    intent.requiresConfirmation ||
    intent.impactLevel === 'HIGH' ||
    intent.impactLevel === 'CRITICAL'

  const duration = Date.now() - startTime
  console.log(`[NEXUS] Routed to ${agentResponse.agentName} in ${duration}ms — response:`, agentResponse.content?.substring(0, 120))

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

  // ── Step 6b: Track interaction patterns ──────────────────────────────
  try {
    trackInteractionPatterns(agentResponse.agentId, intent.category)
  } catch {
    // Non-critical
  }

  // ── Step 7: Check for pending MiroFish proposals ───────────────────────
  let pendingProposals: MiroFishProposal[] | undefined
  try {
    const proposals = await getPendingProposals(request.orgId)
    if (proposals.length > 0) {
      pendingProposals = proposals.slice(0, 5) // Cap at 5 for the response

      // Append a note to the agent response if there are pending proposals
      const proposalNote = `\n\n📋 **${proposals.length} pending proposal${proposals.length !== 1 ? 's' : ''}** awaiting your approval in the Proposal Queue.`
      agentResponse = { ...agentResponse, content: agentResponse.content + proposalNote }
    }
  } catch {
    // Non-critical — don't block response for proposal fetch failure
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
    pendingProposals,
    mode,
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

// ── Event Bus Integration ───────────────────────────────────────────────────

/**
 * Subscribe NEXUS to ALL agent events as a context seed.
 * Call once on app startup after initEventBus().
 * Returns an unsubscribe function.
 */
export function subscribeNexusToEvents(): () => void {
  return subscribe('*', (event: AgentEvent) => {
    // Log all cross-agent events for NEXUS awareness
    console.log(`[NEXUS] Event received: ${event.type} from ${event.source} — ${event.summary}`)

    // Record significant events in memory for long-term context
    try {
      if (['PAYMENT_RECEIVED', 'INVOICE_CREATED', 'ESTIMATE_APPROVED', 'AR_OVERDUE', 'COMPLIANCE_FLAG'].includes(event.type)) {
        addTurn('system', `[Event] ${event.source.toUpperCase()}: ${event.summary}`)
      }
    } catch {
      // Non-critical
    }
  })
}

// ── Re-exports for convenience ──────────────────────────────────────────────
export type { ClassifiedIntent, ConversationMessage } from './classifier'
export type { AgentResponse } from './router'
export type { AgentInterviewDefinition } from './interviewDefinitions'
export { INTENT_CATEGORIES, IMPACT_LEVELS, TARGET_AGENTS } from './classifier'
export { AGENT_INTERVIEWS, checkInterviewTrigger } from './interviewDefinitions'
