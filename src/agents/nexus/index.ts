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
import { detectPreference, savePreference, buildPreferencePrompt, getPreferenceConfirmation, hasCompletedInterview, isInterviewInProgress, getCurrentInterviewQuestion, startInterview, processInterviewAnswer, resetInterview, getSessionCount, incrementSessionCount } from '@/services/nexusPreferences'
import { buildLearnedProfilePrompt, analyzeSessionPatterns, addConversationTurn, getRecentTurns, type ConversationTurn } from '@/services/nexusLearnedProfile'
import { createBucket, addEntry, addPassiveCapture, getBucket, listBuckets, autoTag } from '@/services/memoryBuckets'
import { getCapabilityAnswer } from '@/services/appCapabilityMap'

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

const LIST_QUERY_RE = /agent|who (do you|are you)|what (can you|do you)|tell me (all|about|what)|list|capabilities|work with|reference|what.*you.*do|how many.*agent/i

const LIST_FORMAT_INSTRUCTION = `
AGENT LIST INSTRUCTION — CRITICAL:
The user wants to know about all agents. You MUST list all 11 agents completely.
Do NOT stop early. Do NOT summarize. Complete the full list before stopping.

Respond in this exact format, one agent per line:
"I work with 11 agents total. Here's each one:

NEXUS — that's me. I'm your orchestrator and voice interface. I route every question to the right agent and deliver your operational briefings.

VAULT — handles all estimating. Price book with 240+ items, RMO calculations, material takeoffs, and quote generation.

PULSE — your dashboard and analytics. Tracks KPIs, cash flow charts, revenue trends, and weekly performance metrics.

LEDGER — money and collections. Tracks AR, flags overdue invoices, monitors collection rates, and surfaces cash flow gaps.

BLUEPRINT — project management. Tracks project phases, RFIs, compliance items, coordination tasks, and change orders.

OHM — NEC compliance coach. Answers electrical code questions, flags compliance gaps, and cross-references OSHA requirements.

SCOUT — system analyzer. Monitors the platform for gaps and proposes improvements through the verification chain.

SPARK — marketing agent. Manages Google Business, social media, lead pipeline, and campaign performance. (Phase E — building)

CHRONO — calendar and scheduling. Handles crew dispatch, job scheduling, idle slot detection, and conflict alerts. (Phase D — building)

ECHO — long-term memory. Stores conversation patterns and operational history across sessions. (Phase F — building)

ATLAS — geo-mapping. Handles crew location, job site routing, and travel optimization. (Phase H — building)

That's all 11. What would you like to know about any of them?"
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
  const query = request.message

  // ── MEMORY INTENT — intercept before classifier ──────────────────────────
  // These commands are handled locally and never reach Claude.

  const createBucketMatch = query.match(
    /create.*(?:memory|bucket|note|list).*(?:called|named?)\s+["']?(.+?)["']?\s*$/i
  ) || query.match(/(?:new|start).*(?:bucket|memory).*["']?(.+?)["']?\s*$/i)

  if (createBucketMatch) {
    const name = (createBucketMatch[1] || createBucketMatch[2] || '').replace(/["']/g, '').trim()
    const bucket = await createBucket(name, request.orgId, request.userId)
    const chatContent = `Memory bucket "${bucket.bucket_name}" is ready. Drop notes into it anytime — say "add to ${bucket.bucket_name}: [your note]" or "save this into ${bucket.bucket_name}".`
    const voiceContent = `"${bucket.bucket_name}" bucket created. Ready for notes.`
    const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
    try { addTurn('user', query) } catch { /* non-critical */ }
    try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
    addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
    return {
      intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Memory bucket create' },
      agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
      needsConfirmation: false, conversationMessage: msg, mode,
      voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
    }
  }

  const passiveCaptureIntent = /^(?:remember|don't forget|make(?:\s+a)?\s+note|save this|note that|also remember|make sure you)/i.test(query)

  if (passiveCaptureIntent) {
    const noteContent = query
      .replace(/^(?:remember|don't forget|make(?:\s+a)?\s+note(?:\s+that)?|save this|note that|also remember|make sure you(?:'re aware| remember| know)?)[,\s]*/i, '')
      .trim()
    if (noteContent.length > 2) {
      const tags = autoTag(noteContent)
      await addPassiveCapture(noteContent, { orgId: request.orgId, userId: request.userId })
      const tagStr = tags.length > 0 ? ` — tagged: ${tags.join(', ')}` : ''
      const chatContent = `Saved to Field Notes: "${noteContent}"${tagStr}. I've got it.`
      const voiceContent = `Got it. Saved.`
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Passive memory capture' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
      }
    }
  }

  const addToBucketMatch = query.match(
    /(?:save|add|put|store|log).*(?:into?|to|in)\s+["']?(.+?)["']?\s*(?:bucket|memory|list)?[,:]\s*(.+)/i
  )

  if (addToBucketMatch) {
    const bucketName = addToBucketMatch[1].replace(/["']/g, '').trim()
    const entryContent = addToBucketMatch[2].trim()
    const result = await addEntry(bucketName, entryContent, { orgId: request.orgId, userId: request.userId, source: 'voice' })
    const chatContent = `Added to "${result.bucket.bucket_name}": "${entryContent}". That bucket now has ${result.totalEntries} entries.`
    const voiceContent = `Saved to ${result.bucket.bucket_name}.`
    const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
    try { addTurn('user', query) } catch { /* non-critical */ }
    try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
    addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
    return {
      intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Memory bucket add entry' },
      agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
      needsConfirmation: false, conversationMessage: msg, mode,
      voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
    }
  }

  const getBucketMatch = query.match(
    /(?:pull up|show me|get|read back|what(?:'s| is) in|retrieve|open)\s+["']?(.+?)["']?\s*(?:bucket|memory|notes?|list)/i
  )
  const getGenericMatch = /what did I (?:save|note|capture|record|tell you)/i.test(query)

  if (getBucketMatch || getGenericMatch) {
    if (getBucketMatch) {
      const bucketName = (typeof getBucketMatch === 'object' && getBucketMatch !== null && getBucketMatch[1])
        ? getBucketMatch[1].replace(/["']/g, '').trim()
        : 'Field Notes'
      const bucketData = await getBucket(bucketName, request.orgId, request.userId)
      if (bucketData && bucketData.entries.length > 0) {
        const formatted = bucketData.entries.slice(0, 15).map((e, i) => {
          const date = new Date(e.created_at).toLocaleDateString()
          const tagStr = e.tags.length > 0 ? ` _(${e.tags.join(', ')})_` : ''
          return `${i + 1}. [${date}] ${e.content}${tagStr}`
        }).join('\n\n')
        const chatContent = `**${bucketData.bucket_name}** — ${bucketData.entries.length} entries:\n\n${formatted}`
        const voiceContent = `${bucketData.bucket_name} has ${bucketData.entries.length} entries. Check the chat for the full list.`
        const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
        addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Memory bucket retrieve' },
          agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false, conversationMessage: msg, mode,
          voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
        }
      } else {
        const chatContent = `"${bucketName}" is empty or doesn't exist yet. Create it by saying "create a memory bucket called ${bucketName}".`
        const voiceContent = `No entries found in ${bucketName}.`
        const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Memory bucket not found' },
          agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false, conversationMessage: msg, mode,
          voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
        }
      }
    }
    // Generic "what did I save" — show all recent entries
    if (getGenericMatch) {
      const { getAllEntries } = await import('@/services/memoryBuckets')
      const entries = await getAllEntries(request.userId, 15)
      if (entries.length > 0) {
        const allBuckets = await listBuckets(request.orgId, request.userId)
        const bucketMap = new Map(allBuckets.map(b => [b.id, b.bucket_name]))
        const formatted = entries.map((e, i) => {
          const date = new Date(e.created_at).toLocaleDateString()
          const bucket = bucketMap.get(e.bucket_id) || 'Unknown'
          const tagStr = e.tags.length > 0 ? ` _(${e.tags.join(', ')})_` : ''
          return `${i + 1}. [${bucket}] ${e.content}${tagStr} — ${date}`
        }).join('\n\n')
        const chatContent = `## Recent Memory Entries (${entries.length})\n\n${formatted}`
        const voiceContent = `You have ${entries.length} recent entries saved. Check the chat for the full list.`
        const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Memory entries retrieval' },
          agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false, conversationMessage: msg, mode,
          voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
        }
      }
    }
  }

  const listBucketsIntent = /(?:list|show|what are)(?: all)?(?: my)?\s+(?:buckets?|memories|memory lists?)/i.test(query)

  if (listBucketsIntent) {
    const allBuckets = await listBuckets(request.orgId, request.userId)
    if (allBuckets.length > 0) {
      const formatted = allBuckets.map(b => `- **${b.bucket_name}** — ${b.entry_count || 0} entries`).join('\n')
      const chatContent = `Your memory buckets:\n\n${formatted}`
      const voiceContent = `You have ${allBuckets.length} memory buckets. Check the chat for the list.`
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Memory bucket list' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
      }
    } else {
      const chatContent = `No memory buckets yet. Create one by saying "create a memory bucket called [name]".`
      const voiceContent = `No buckets yet. Say "create a memory bucket called" followed by the name.`
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'No buckets yet' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
      }
    }
  }

  // ── BRANCH QUERY — intercept before classifier ────────────────────────────
  const isBranchQuery = /how is my business|what should I focus|ways to (?:grow|improve|make more|increase)|opportunities|what can I do|how do I (?:scale|expand|grow)|revenue ideas|business strategy|overcome|struggling with/i.test(query)

  // ── CAPABILITY QUERY — intercept before classifier ────────────────────────
  const isCapabilityQuery = /(?:can you|do you|does the app|is there|do I have|can I|able to|feature|capability|currently|support|check if|look for|find.*feature|anywhere in the app)/i.test(query) &&
    /(?:schedule|calendar|auto|automatically|voice command.*(?:create|add|log|schedule)|feature|skill|task|do this|handle this|manage this)/i.test(query)

  if (isCapabilityQuery) {
    const capabilityAnswer = getCapabilityAnswer(query)
    const baseAnswer = capabilityAnswer ||
      "I don't have a specific record of that capability. It may not be built yet."
    const isMissingFeature = !capabilityAnswer ||
      (capabilityAnswer.includes('Manual only') ||
       capabilityAnswer.includes('not yet') ||
       capabilityAnswer.includes('Planned'))
    const suggestion = isMissingFeature
      ? `\n\nWant to track this? Say "save this into March Improvements: [describe the feature you want]" and I'll capture it for your next development session.`
      : ''
    const chatContent = baseAnswer + suggestion
    const voiceContent = capabilityAnswer
      ? `Here's what I found about that capability. Check the chat for the full details.`
      : `That feature isn't built yet. I can save it to your improvement bucket if you want.`
    const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
    try { addTurn('user', query) } catch { /* non-critical */ }
    try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
    addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
    return {
      intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Capability query answered from map' },
      agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
      needsConfirmation: false, conversationMessage: msg, mode,
      voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
    }
  }

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

  // ── Step 1e2: Profile interview system ──────────────────────────────────
  const isInterviewRequest = /interview|profile|calibrate|learn (how i|my style)|get to know|personalize|customize (how you|yourself)|recalibrate/i.test(request.message)

  // Handle "recalibrate my profile" — reset and start fresh
  if (/recalibrate/i.test(request.message)) {
    resetInterview()
  }

  // If currently in an active interview, treat the message as an answer
  if (isInterviewInProgress()) {
    const currentQ = getCurrentInterviewQuestion()
    if (currentQ) {
      const result = await processInterviewAnswer(request.orgId, request.userId, currentQ.id, request.message)

      const interviewMsg: ConversationMessage = {
        role: 'assistant',
        content: result.nextMessage,
        agentId: 'nexus',
        timestamp: Date.now(),
      }
      try { addTurn('user', request.message) } catch { /* non-critical */ }
      try { addTurn('assistant', result.nextMessage, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: result.nextMessage, agentUsed: 'nexus', timestamp: Date.now() })

      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Profile interview in progress' },
        agent: { content: result.nextMessage, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false,
        conversationMessage: interviewMsg,
        mode,
        voiceSummary: request.isVoiceCommand ? result.nextMessage.slice(0, 300) : undefined,
      }
    }
  }

  // Trigger interview explicitly OR on 3rd session if never completed
  if (isInterviewRequest || (!hasCompletedInterview() && getSessionCount() >= 3 && request.conversationHistory.length === 0)) {
    if (!isInterviewInProgress()) {
      const introMsg = startInterview()

      const interviewConvMsg: ConversationMessage = {
        role: 'assistant',
        content: introMsg,
        agentId: 'nexus',
        timestamp: Date.now(),
      }
      try { addTurn('user', request.message) } catch { /* non-critical */ }
      try { addTurn('assistant', introMsg, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: introMsg, agentUsed: 'nexus', timestamp: Date.now() })

      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Profile interview triggered' },
        agent: { content: introMsg, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false,
        conversationMessage: interviewConvMsg,
        mode,
        voiceSummary: request.isVoiceCommand ? introMsg.slice(0, 300) : undefined,
      }
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
  const isOpBriefing = isOperationalQuery(request.message) && !isBranchQuery
  const isListQuery = LIST_QUERY_RE.test(request.message)
  const isResearchQuery = /research|look up|find out|what does.*code|NEC|CEC|title 24|CBC|industry|benchmark|compare|best practice|how do.*install|installation method|market rate|pricing data|code requirement/i.test(request.message)
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

  // ── Step 4b: Detect short follow-up questions and inject last turn context ──
  const isFollowUp = query.split(' ').length <= 12 &&
    /\b(that|it|the list|was that|which|what about|those|them|more|continue|go on|keep going|all of them)\b/i.test(query)

  if (isFollowUp && request.conversationHistory.length > 0) {
    const lastAssistantTurn = [...request.conversationHistory]
      .reverse()
      .find(m => m.role === 'assistant')

    if (lastAssistantTurn) {
      // Check if last turn was an agent list — if so, return a canned response directly
      const lastAssistantContent = lastAssistantTurn.content || ''
      const lastTurnWasAgentList = ['NEXUS', 'VAULT', 'LEDGER', 'BLUEPRINT', 'PULSE'].every(n => lastAssistantContent.includes(n))

      if (lastTurnWasAgentList) {
        const cannedContent = `Yes, that was the complete list of all 11 agents. Each one has a specific role and they all report to me — NEXUS. If you want I can go deeper on any of them. Tell me which agent interests you and I'll break down exactly how it operates, what tasks it handles, what insights it generates for your business, how you control and customize its behavior, and what improvements it can surface for your operations. You can also say "dive deeper on all of them" and I'll give you a full operational profile of the entire team.`
        const cannedVoice = `Yes, all 11 were listed. Want me to go deeper on any specific agent? Just name one.`

        // Persist conversation turns
        addConversationTurn({ role: 'assistant', content: cannedContent, agentUsed: 'nexus', timestamp: Date.now() })
        try { addTurn('assistant', cannedContent, 'nexus') } catch { /* non-critical */ }

        const cannedConvMsg: ConversationMessage = {
          role: 'assistant',
          content: cannedContent,
          agentId: 'nexus',
          timestamp: Date.now(),
        }

        return {
          intent,
          agent: { content: cannedContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false,
          conversationMessage: cannedConvMsg,
          mode,
          voiceSummary: request.isVoiceCommand ? cannedVoice : undefined,
        }
      }

      const lastTurnPreview = lastAssistantTurn.content.slice(0, 500)
      const followUpInstruction = `\nFOLLOW-UP RULE: This is a follow-up question referencing the previous response.\nLook at the most recent assistant turn above — that is what the user is referring to.\nDO NOT ask for clarification. DO NOT ask "which list did you mean?"\nAnswer based on the most recent assistant turn directly.\nIf the previous turn was an agent list — confirm it was complete or continue it.\nIf the previous turn was a financial briefing — build on that context.\n\nMOST RECENT RESPONSE WAS: ${lastTurnPreview}\nThe user is asking a follow-up about this specific response.`
      enrichedMessage = enrichedMessage + followUpInstruction
    }
  }

  // ── Step 4c: Inject research instruction for research-intent queries ────
  if (isResearchQuery) {
    const researchInstruction = `\nRESEARCH INSTRUCTION: You have access to web search. Use it when:
- Comparing Christian's business metrics against electrical contractor industry benchmarks
- Researching NEC, CEC, Title 24, CBC code requirements for specific installation types
- Looking up best practices for electrical contractors at $100K-$500K annual revenue stage
- Finding market data on pricing, lead acquisition, customer acquisition costs for Southern California electrical contractors
- Researching specific electrical devices, appliances, or installation methods mentioned in the query
- Any time the user says "research", "look up", "find out", or "what does the code say about"

When you search, cite your sources briefly and integrate the findings naturally into your response alongside the operational data you already have. Format: "Based on your data [X] and industry research [Y], my recommendation is [Z]."

Always combine external research WITH the user's actual operational data — never give generic advice when specific data is available.`
    enrichedMessage = enrichedMessage + researchInstruction
  }

  let agentResponse = await routeToAgent(
    intent,
    enrichedMessage,
    request.orgId,
    request.conversationHistory,
    { isListQuery, isResearchQuery }
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
  // For list queries, use a fixed voice summary that names agents but points to chat.
  // For other queries, strip markdown and truncate to ~150 words.
  let voiceSummary: string | undefined
  if (request.isVoiceCommand) {
    if (isListQuery) {
      voiceSummary = "I work with 11 agents total — NEXUS, VAULT, PULSE, LEDGER, BLUEPRINT, OHM, SCOUT, SPARK, CHRONO, ECHO, and ATLAS. The full breakdown with what each one does is in the chat window below."
    } else {
      voiceSummary = stripToVoiceSummary(displayResponse).slice(0, 300)
    }
  }

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
