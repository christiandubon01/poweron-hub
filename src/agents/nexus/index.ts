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
import { detectPreference, savePreference, buildPreferencePrompt, getPreferenceConfirmation } from '@/services/nexusPreferences'
import { buildLearnedProfilePrompt, analyzeSessionPatterns, addConversationTurn, getRecentTurns, type ConversationTurn } from '@/services/nexusLearnedProfile'

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
  /** Conversational plain-text summary for TTS (max ~150 words). Only set for voice commands. */
  voiceSummary?: string
}

// ── Orchestrator ────────────────────────────────────────────────────────────

// ── Voice Summary ───────────────────────────────────────────────────────────

const MAX_VOICE_WORDS = 150

/**
 * Strip markdown formatting and truncate to a conversational plain-text
 * summary suitable for TTS playback (max ~150 words).
 */
function stripToVoiceSummary(markdown: string): string {
  let text = markdown
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    // Remove emoji bullets (🔴 🟡 🟢 📋 ⚡ etc.)
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]\s*/gu, '')
    // Remove markdown links — keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove horizontal rules
    .replace(/^---+$/gm, '')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove operational briefing section headers (PROJECTS BUCKET:, etc.)
    .replace(/^[A-Z][A-Z\s/]+(?:\([^)]*\))?:\s*$/gm, '')
    // Remove inline label prefixes like "Current phase status:" → keep the value
    .replace(/^[-*]\s*[A-Za-z ]+:\s*/gm, '')
    // Collapse bullet points into sentences
    .replace(/^\s*[-*]\s+/gm, '')
    // Collapse numbered lists
    .replace(/^\s*\d+\.\s+/gm, '')
    // Collapse multiple newlines
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, '. ')
    // Clean up double periods
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Truncate to MAX_VOICE_WORDS
  const words = text.split(/\s+/)
  if (words.length > MAX_VOICE_WORDS) {
    text = words.slice(0, MAX_VOICE_WORDS).join(' ') + '.'
  }

  return text
}

// ── Deep Dive Detection ─────────────────────────────────────────────────────

const DEEP_DIVE_TRIGGERS = ['go deeper', 'deep dive', 'deepdive', 'full report', 'full breakdown', 'more detail', 'expand']

const OPERATIONAL_BRIEFING_TRIGGERS = [
  'how are my jobs', 'how is the business', 'give me an overview', 'how are things',
  'operations', 'status update', 'how\'s business', 'what\'s going on',
  'morning briefing', 'daily summary', 'weekly overview', 'how we doing',
  'how are we doing', 'what needs my attention', 'operational',
]

/**
 * Detect if a message is requesting a broad operational overview.
 */
function isOperationalQuery(message: string): boolean {
  const lower = message.toLowerCase()
  return OPERATIONAL_BRIEFING_TRIGGERS.some(t => lower.includes(t))
}

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

// ── List Query Detection ────────────────────────────────────────────────────

const LIST_QUERY_RE = /tell me (all|about|the)|what agents|list (all|the)|who are|what are your|how many agents|your capabilities|what can you do/i

const LIST_FORMAT_INSTRUCTION = `
## Response Format — LIST / CAPABILITIES QUERY
CRITICAL: You must list ALL 11 agents completely. Do not stop early. Do not summarize.
The agents are: NEXUS, VAULT, PULSE, LEDGER, BLUEPRINT, OHM, SCOUT, SPARK, CHRONO, ECHO, ATLAS.
Format: one agent per line, name then role then one sentence description.
Do not use markdown headers or bold. Write in plain conversational sentences.
End with: "That's all 11. What would you like to know about any of them?"
`

const OPERATIONAL_BRIEFING_FORMAT_INSTRUCTION = `
## Response Format — OPERATIONAL BRIEFING
You are generating a full operational briefing. Pull data from ALL agent domains and respond in this EXACT structure:

OPENING (1 sentence):
Start with: "I've pulled from [list agent names used] — here's your full operational picture across projects and service calls."

PROJECTS BUCKET:
- Current phase status: [X projects active, Y stuck in estimating, Z completed]
- Cash flow exposure: [top 2-3 projects by outstanding AR with dollar amounts]
- Ghost time eaters: [coordination gaps, RFI items, phase mismatches — be specific]
- Critical insight: [one specific pattern you detected in the data]
- Action: [one specific thing to do this week]

SERVICE CALLS BUCKET (default: last 30 days):
- Collection rate: [X% collected, $Y outstanding]
- Top overdue: [customer name, dollar amount, days overdue]
- Overhead flag: [any pattern in gas/material/labor costs]
- Action: [one specific follow-up]

MILESTONE:
"At your current trajectory, closing [gap 1], [gap 2], and [gap 3] puts you at 30% operational improvement by approximately [calculated month based on data]. Keep close eye on: follow-up cadence, audit logging, entry consistency."

HANDOFF:
"Tell me what you want to dive deeper into — projects, collections, overhead breakdown, or milestone plan."

CRITICAL RULES:
- Use real project names, real customer names, real dollar amounts from the data provided.
- Never use placeholder text — if data is missing, say "no data available for this section."
- Keep each section tight — 2-4 lines max per section.
- Format with clean section headers for chat display.
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

  // ── Step 1e: Detect and save user preferences ───────────────────────────
  const detectedPref = detectPreference(request.message)
  if (detectedPref) {
    try {
      const savedPref = await savePreference(request.orgId, request.userId, detectedPref)
      if (savedPref) {
        console.log(`[NEXUS] Preference saved: "${detectedPref.slice(0, 60)}..."`)
        // Return early with confirmation if this is ONLY a preference instruction
        // (no substantial question embedded)
        const wordCount = request.message.trim().split(/\s+/).length
        if (wordCount < 20) {
          const confirmation = getPreferenceConfirmation(savedPref)
          const confirmMsg: ConversationMessage = {
            role: 'assistant',
            content: confirmation,
            agentId: 'nexus',
            timestamp: Date.now(),
          }
          try { addTurn('user', request.message) } catch { /* non-critical */ }
          try { addTurn('assistant', confirmation, 'nexus') } catch { /* non-critical */ }
          return {
            intent: {
              category: 'general',
              targetAgent: 'nexus',
              confidence: 1.0,
              entities: [],
              requiresConfirmation: false,
              impactLevel: 'LOW',
              reasoning: 'User preference instruction detected and saved',
            },
            agent: {
              content: confirmation,
              agentId: 'nexus',
              agentName: 'NEXUS',
              confidence: 1.0,
            },
            needsConfirmation: false,
            conversationMessage: confirmMsg,
            mode,
            voiceSummary: request.isVoiceCommand ? confirmation : undefined,
          }
        }
      }
    } catch (err) {
      console.warn('[NEXUS] Preference detection error:', err)
    }
  }

  // ── Step 1f: Load stored preferences into memory context ───────────────
  try {
    const prefPrompt = await buildPreferencePrompt(request.orgId, request.userId)
    if (prefPrompt) {
      memoryContext = prefPrompt + '\n' + memoryContext
    }
  } catch {
    // Non-critical
  }

  // ── Step 1g: Load learned profile (Layer 3 — implicit behavioral patterns) ─
  try {
    const learnedPrompt = await buildLearnedProfilePrompt(request.orgId, request.userId)
    if (learnedPrompt) {
      memoryContext = learnedPrompt + '\n' + memoryContext
    }
  } catch {
    // Non-critical
  }

  // ── Step 1h: Persist conversation turn (Layer 1) ──────────────────────
  addConversationTurn({
    role: 'user',
    content: request.message,
    timestamp: Date.now(),
  })

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
  // Inject mode-specific formatting instruction + user preferences into the message
  const isOpBriefing = isOperationalQuery(request.message)
  const isListQuery = LIST_QUERY_RE.test(request.message)
  const modeInstruction = isListQuery
    ? LIST_FORMAT_INSTRUCTION
    : isOpBriefing
      ? OPERATIONAL_BRIEFING_FORMAT_INSTRUCTION
      : mode === 'deepdive'
        ? DEEP_DIVE_FORMAT_INSTRUCTION
        : BRIEFING_FORMAT_INSTRUCTION
  let enrichedMessage = `${request.message}\n\n${modeInstruction}`

  // Prepend user preferences so the agent respects them
  try {
    const agentPrefPrompt = await buildPreferencePrompt(request.orgId, request.userId, intent.targetAgent)
    if (agentPrefPrompt) {
      enrichedMessage = `${agentPrefPrompt}\n${enrichedMessage}`
    }
  } catch {
    // Non-critical
  }

  let agentResponse = await routeToAgent(
    intent,
    enrichedMessage,
    request.orgId,
    request.conversationHistory,
    { isListQuery }
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

  // ── Step 6c: Persist assistant turn to conversation thread (Layer 1) ────
  addConversationTurn({
    role: 'assistant',
    content: agentResponse.content,
    agentUsed: agentResponse.agentId,
    timestamp: Date.now(),
  })

  // ── Step 6d: Trigger background pattern analysis (Layer 3) ────────────
  // Analyze after 2+ meaningful turns to catch patterns early
  const recentTurns = getRecentTurns(6)
  if (recentTurns.length >= 2) {
    // Fire-and-forget — don't block response delivery
    analyzeSessionPatterns(request.orgId, request.userId, recentTurns).catch(() => {
      // Non-critical — pattern analysis failure doesn't affect user experience
    })
  }

  // ── Return ──────────────────────────────────────────────────────────────

  // CRITICAL: displayResponse is the full, never-truncated content for chat display.
  // voiceSummary is a separate, shortened version for TTS only. They must never share a variable.
  const displayResponse = agentResponse.content

  const conversationMessage: ConversationMessage = {
    role:      'assistant',
    content:   displayResponse,
    agentId:   agentResponse.agentId,
    timestamp: Date.now(),
  }

  // ── Generate voice summary for TTS when this is a voice command ──────────
  // For operational briefings via voice, strip section headers and convert to
  // natural conversational sentences under 60 seconds (~150 words).
  const voiceSummary = request.isVoiceCommand
    ? stripToVoiceSummary(displayResponse).slice(0, 300)
    : undefined

  return {
    intent,
    agent: agentResponse,
    needsConfirmation,
    conversationMessage,
    interviewTrigger: (interviewDef && !request.isVoiceCommand) ? interviewDef : undefined,
    pendingProposals,
    mode,
    voiceSummary,
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
