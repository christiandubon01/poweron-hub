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
import { getActiveMode, setActiveMode, getModeConfig, MODE_CONFIGS, type NexusAgentMode } from '@/services/nexusMode'
import { addTurn, getContext, getCompactContext, updateProjectContext, getMemory, trackInteractionPatterns, applyProfileToPrompt } from '@/services/nexusMemory'
import { checkInterviewTrigger, type AgentInterviewDefinition } from './interviewDefinitions'
import { getEventContext, subscribe, type AgentEvent } from '@/services/agentEventBus'
import { getPendingProposals, type MiroFishProposal } from '@/services/miroFish'
import { detectPreference, savePreference, buildPreferencePrompt, getPreferenceConfirmation, hasCompletedInterview, isInterviewInProgress, getCurrentInterviewQuestion, startInterview, processInterviewAnswer, resetInterview, getSessionCount, incrementSessionCount } from '@/services/nexusPreferences'
import { buildLearnedProfilePrompt, analyzeSessionPatterns, addConversationTurn, getRecentTurns, type ConversationTurn } from '@/services/nexusLearnedProfile'
import { createBucket, addEntry, addPassiveCapture, getBucket, listBuckets, autoTag } from '@/services/memoryBuckets'
import { getCapabilityAnswer } from '@/services/appCapabilityMap'
import { getRecentActivity, getActivitySummary } from '@/services/activityLog'
// ── V3 Session 2: Conversational Memory ─────────────────────────────────────
import { analyzeCompleteness, generateClarifyingQuestion, mergeContext, type ContextFragment } from '@/services/conversationContext'
import { saveJournalEntry, getRecentJournal, getJournalSummary, semanticSearch as semanticSearchJournal, type JournalEntry } from '@/services/voiceJournalService'
import { getRelatedMemories } from '@/services/vectorMemory'
import { setVoiceContext, getVoiceContext, type VoiceContext } from '@/services/voice'

// ── Types ───────────────────────────────────────────────────────────────────

export type NexusMode = 'briefing' | 'deepdive'

// ── V3 Session 2: Conversation State for clarification flow ─────────────────
// Resets each session (stored in module memory, not localStorage) — by design.

interface ConversationState {
  /** Active context fragment awaiting clarification */
  activeFragment: ContextFragment | null
  /** True when NEXUS is waiting for a clarifying answer */
  awaitingClarification: boolean
  /** Topic label of the fragment being clarified */
  clarificationTopic: string | null
  /** Original user message that triggered the clarification flow */
  originalMessage: string | null
}

/** Module-level state — resets on every page load / session. */
let _conversationState: ConversationState = {
  activeFragment:       null,
  awaitingClarification: false,
  clarificationTopic:   null,
  originalMessage:      null,
}

function _resetConversationState(): void {
  _conversationState = {
    activeFragment:       null,
    awaitingClarification: false,
    clarificationTopic:   null,
    originalMessage:      null,
  }
}

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

// ── Activity Log Query Detection ────────────────────────────────────────────

const ACTIVITY_TRIGGERS = [
  'what changed', 'recent activity', 'what happened', 'activity log',
  'last changes', 'what did you do', 'show me what happened', 'changelog',
  'audit trail',
]

function isActivityQuery(message: string): boolean {
  const lower = message.toLowerCase()
  return ACTIVITY_TRIGGERS.some(t => lower.includes(t))
}

// ── V3 Session 2: Journal Trigger Detection ──────────────────────────────────

/**
 * Detect messages that should trigger the voice journal save flow.
 * Intentionally distinct from the passive capture "remember/note" pattern
 * to allow both to coexist without conflict.
 *
 * Triggers: "remember this — [job context]", "journal this", "save to journal",
 * "log this", "capture this", "add to journal", "journal entry", etc.
 */
const JOURNAL_SAVE_TRIGGERS = [
  /^(?:journal|journal\s+this|log\s+this|log\s+entry|add\s+to\s+journal|save\s+to\s+journal|journal\s+entry|capture\s+this)\b/i,
  /^remember\s+this\s*[-—:]/i,    // "Remember this — we need conduit..."
  /^log\s+this\b/i,
  /^capture\s+for\s+(?:later|the\s+job|the\s+record)\b/i,
]

function isJournalSaveTrigger(message: string): boolean {
  return JOURNAL_SAVE_TRIGGERS.some(re => re.test(message.trim()))
}

/**
 * Strip the journal trigger prefix from the message to get the content.
 */
function stripJournalPrefix(message: string): string {
  return message
    .replace(/^(?:journal(?:\s+this)?|log(?:\s+this)?|log\s+entry|add\s+to\s+journal|save\s+to\s+journal|journal\s+entry|capture\s+this|capture\s+for\s+(?:later|the\s+job|the\s+record))[,:\s]*/i, '')
    .replace(/^remember\s+this\s*[-—:]\s*/i, '')
    .trim()
}

// ── V3 Session 2: Memory Query Detection ─────────────────────────────────────

const JOURNAL_MEMORY_TRIGGERS = [
  'what materials did we use',
  'what were we short on',
  'what did i say about',
  'remind me what i captured',
  'what did i save about',
  'what did i log about',
  'what did i capture about',
  'pull up my notes on',
  'show me what i saved',
  'what did i journal about',
  'find my notes on',
  'what did i record about',
]

function isJournalMemoryQuery(message: string): boolean {
  const lower = message.toLowerCase()
  return JOURNAL_MEMORY_TRIGGERS.some(t => lower.includes(t))
}

/**
 * Extract the key search terms from a journal memory query.
 * Strips the trigger phrase to get the subject being searched.
 */
function extractJournalSearchTerms(message: string): string {
  return message
    .replace(/^(?:what (?:materials (?:did we use(?: on)?|were we short on)|did (?:I|we) (?:say|log|save|capture|record|journal) about)|remind me what (?:I|we) captured(?: about)?|pull up (?:my )?notes on|show me what (?:I|we) saved|find (?:my )?notes on)\s*/i, '')
    .trim() || message
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

const BRANCH_FORMAT_INSTRUCTION = `
## Response Format — BRANCH CARDS (Business Strategy Mode)
The user is asking about business growth, opportunities, or strategic direction.
You MUST respond with a brief snapshot paragraph followed by BRANCH_CARDS in this EXACT format:

[1-2 sentence snapshot of the current situation based on available data]

BRANCH_CARDS: [{"title":"<short action title>","summary":"<2-3 sentence explanation of the opportunity or strategy>","relevance":"HIGH","relevance_reason":"<why this matters right now for their business>"},{"title":"...","summary":"...","relevance":"MEDIUM","relevance_reason":"..."},{"title":"...","summary":"...","relevance":"LOW","relevance_reason":"..."}]

CRITICAL RULES:
- ALWAYS include the BRANCH_CARDS: marker followed by a valid JSON array on a single line.
- Provide 3-5 branch cards — one HIGH, one or two MEDIUM, one LOW relevance minimum.
- relevance must be exactly "HIGH", "MEDIUM", or "LOW" (all caps).
- Base branches on real data from the app — use actual project names, cash flow gaps, crew capacity, etc.
- Title should be short (3-6 words). Summary should be actionable and specific.
- Never use placeholder text — if a section has no data, skip that branch card.
`

/**
 * Main NEXUS pipeline. Call this for every user message.
 */
export async function processMessage(request: NexusRequest): Promise<NexusResponse> {
  const startTime = Date.now()
  const mode = detectMode(request.message, request.mode)
  const query = request.message

  // ── V3 SESSION 2: CONVERSATIONAL MEMORY LAYER ────────────────────────────
  // Runs BEFORE passive capture to handle:
  //   1. Clarification answers (when awaitingClarification = true)
  //   2. Journal save triggers with completeness check
  //   3. Journal memory queries (semantic + vector search)
  // Additive only — no existing logic below is modified.

  // ── Step V3-1: Handle clarification answers ───────────────────────────────
  if (_conversationState.awaitingClarification && _conversationState.activeFragment) {
    const updatedFragment = mergeContext(_conversationState.activeFragment, query)

    if (updatedFragment.complete) {
      // Fragment is complete — build full-context content and save
      const orig = _conversationState.originalMessage || ''
      const knownParts = Object.entries(updatedFragment.known)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
      const fullContent = orig ? `${orig} — ${knownParts}` : knownParts

      await saveJournalEntry({
        transcript:   fullContent,
        contextTag:   updatedFragment.topic,
        jobReference: updatedFragment.known.client,
      })

      _resetConversationState()

      const summaryParts: string[] = []
      if (updatedFragment.known.size)     summaryParts.push(`size: ${updatedFragment.known.size}`)
      if (updatedFragment.known.quantity) summaryParts.push(`quantity: ${updatedFragment.known.quantity}`)
      if (updatedFragment.known.location) summaryParts.push(`location: ${updatedFragment.known.location}`)
      if (updatedFragment.known.client)   summaryParts.push(`job: ${updatedFragment.known.client}`)
      if (updatedFragment.known.date)     summaryParts.push(`date: ${updatedFragment.known.date}`)
      const summaryStr = summaryParts.length > 0 ? ` (${summaryParts.join(', ')})` : ''

      const chatContent = `Got it — saved the full picture.${summaryStr}`
      const voiceContent = `Saved. Full context captured.`
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Journal clarification complete — saved' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
      }
    } else {
      // Still incomplete — ask next clarifying question, keep state
      _conversationState.activeFragment = updatedFragment
      const nextQuestion = generateClarifyingQuestion(updatedFragment)
      const msg: ConversationMessage = { role: 'assistant', content: nextQuestion, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', nextQuestion, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: nextQuestion, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Journal clarification in progress' },
        agent: { content: nextQuestion, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? nextQuestion : undefined,
      }
    }
  }

  // ── Step V3-2: Handle journal save triggers ───────────────────────────────
  if (isJournalSaveTrigger(query)) {
    const content = stripJournalPrefix(query)
    if (content.length > 2) {
      const fragment = analyzeCompleteness(content)

      if (fragment.complete) {
        // Context is complete — save immediately
        await saveJournalEntry({
          transcript:   content,
          contextTag:   fragment.topic,
          jobReference: fragment.known.client,
        })
        const summaryParts: string[] = []
        if (fragment.known.size)     summaryParts.push(`size: ${fragment.known.size}`)
        if (fragment.known.quantity) summaryParts.push(`quantity: ${fragment.known.quantity}`)
        if (fragment.known.location) summaryParts.push(`location: ${fragment.known.location}`)
        if (fragment.known.client)   summaryParts.push(`job: ${fragment.known.client}`)
        const summaryStr = summaryParts.length > 0 ? ` (${summaryParts.join(', ')})` : ''
        const chatContent = `Got it — saved the full picture.${summaryStr}`
        const voiceContent = `Saved to journal.`
        const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
        addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Journal save — complete context' },
          agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false, conversationMessage: msg, mode,
          voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
        }
      } else {
        // Fragment is incomplete — store state and ask first clarifying question
        _conversationState.activeFragment       = fragment
        _conversationState.awaitingClarification = true
        _conversationState.clarificationTopic   = fragment.topic
        _conversationState.originalMessage      = content

        const question = generateClarifyingQuestion(fragment)
        const msg: ConversationMessage = { role: 'assistant', content: question, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', question, 'nexus') } catch { /* non-critical */ }
        addConversationTurn({ role: 'assistant', content: question, agentUsed: 'nexus', timestamp: Date.now() })
        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Journal save — awaiting clarification' },
          agent: { content: question, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false, conversationMessage: msg, mode,
          voiceSummary: request.isVoiceCommand ? question : undefined,
        }
      }
    }
  }

  // ── Step V3-3: Handle journal memory queries ──────────────────────────────
  if (isJournalMemoryQuery(query)) {
    const searchTerms = extractJournalSearchTerms(query)
    try {
      // Run semantic journal search + vector memory search in parallel
      const [journalResults, memoryResults] = await Promise.all([
        semanticSearchJournal(searchTerms, 5).catch(() => [] as JournalEntry[]),
        getRelatedMemories(request.userId || request.orgId, searchTerms, { limit: 5 }).catch(() => []),
      ])

      if (journalResults.length === 0 && memoryResults.length === 0) {
        const chatContent = `I don't have anything saved about that. Want me to capture something now?`
        const voiceContent = `Nothing saved about that yet. Want me to capture something?`
        const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
        addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Journal memory query — no results' },
          agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false, conversationMessage: msg, mode,
          voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
        }
      }

      // Deduplicate and format as conversational response
      const seen = new Set<string>()
      const lines: string[] = []

      for (const entry of journalResults.slice(0, 5)) {
        const key = (entry.raw_transcript || '').slice(0, 80)
        if (seen.has(key)) continue
        seen.add(key)
        const date = new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const snippet = (entry.raw_transcript || '').slice(0, 200)
        const actionNote = Array.isArray(entry.action_items) && entry.action_items.length > 0
          ? ` You also flagged: ${entry.action_items[0]}.`
          : ''
        lines.push(`Based on your notes from ${date}: ${snippet}.${actionNote}`)
      }

      const chatContent = lines.join('\n\n')
      const voiceContent = `Found ${lines.length} note${lines.length !== 1 ? 's' : ''} about that. Check the chat for details.`
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Journal memory query — results found' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
      }
    } catch (memErr) {
      console.warn('[NEXUS] Journal memory query error — routing to standard flow:', memErr)
      // Fall through to standard classifier pipeline on error
    }
  }

  // ── PASSIVE CAPTURE — MUST be the absolute first check ───────────────────
  // Voice transcription may produce curly apostrophes, so match both ' and \u2019
  const passiveCaptureIntent = /^(?:remember|don['\u2019]t forget|make(?:\s+a)?\s+note|save this|note that|also remember|make sure you|keep in mind|jot down)/i.test(query)

  if (passiveCaptureIntent) {
    const noteContent = query
      .replace(/^(?:remember|don['\u2019]t forget|make(?:\s+a)?\s+note(?:\s+that)?|save this|note that|also remember|make sure you(?:['\u2019]re aware| remember| know)?|keep in mind|jot down)[,:\s]*/i, '')
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
    /(?:pull up|show me|get|read back|what(?:['\u2019]s| is) in|retrieve|open)\s+(?:my\s+)?["']?(.+?)["']?\s*(?:bucket|memory|notes?|list|entries)?$/i
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

  // ── SEMANTIC SEARCH — intercept before classifier ─────────────────────────
  // Handles: "find jobs where AFCI was flagged", "show estimates similar to Starbucks job"
  const isSemanticSearchQuery = /(?:find|search|show me|look for|retrieve)\s+(?:jobs?|projects?|estimates?|service calls?|field logs?|compliance|payments?)\s+(?:where|with|that|similar to|related to|about|involving)/i.test(query) ||
    /similar to (?:the\s+)?["']?[\w\s]+["']?\s+(?:job|project|estimate)/i.test(query) ||
    /find (?:anything|records?|entries?) (?:about|related to|involving|where)/i.test(query)

  if (isSemanticSearchQuery) {
    try {
      const { searchSimilar } = await import('@/services/embeddingService')

      // Extract entity type hint from query
      let entityTypeFilter: string | undefined
      if (/estimate/i.test(query)) entityTypeFilter = 'estimate'
      else if (/compliance|NEC|flag|AFCI|GFCI|code/i.test(query)) entityTypeFilter = 'compliance_flag'
      else if (/service call/i.test(query)) entityTypeFilter = 'service_call'
      else if (/payment|paid|invoice/i.test(query)) entityTypeFilter = 'payment'
      else if (/project/i.test(query)) entityTypeFilter = 'project'
      else if (/field log|log entry/i.test(query)) entityTypeFilter = 'field_log'

      // Use the full query as the search phrase
      const searchResults = await searchSimilar(query, entityTypeFilter as any, 5, request.orgId)

      if (searchResults.length > 0) {
        const branchCards = searchResults.map(r => ({
          title: `[${r.entity_type.replace(/_/g, ' ')}] ${r.content.split('.')[0].slice(0, 60)}`,
          summary: r.content.slice(0, 200),
          relevance: r.similarity >= 0.80 ? 'HIGH' : r.similarity >= 0.70 ? 'MEDIUM' : 'LOW',
          relevance_reason: `${Math.round(r.similarity * 100)}% semantic match to your query`,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          similarity: Math.round(r.similarity * 100),
        }))

        // Natural language summary: "Based on your data from [date]: [content]. Related: [second]."
        const top = searchResults[0]
        const topDate = (top.metadata as any)?.date
          ? new Date((top.metadata as any).date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'your records'
        const topSummary = top.content.slice(0, 200)
        let naturalSummary = `Based on your data from ${topDate}: ${topSummary}.`
        if (searchResults.length > 1) {
          const second = searchResults[1]
          naturalSummary += ` Related: ${second.content.slice(0, 120)}.`
        }

        const chatContent = `${naturalSummary}\n\nFound **${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}** matching "${query.slice(0, 80)}":\n\nBRANCH_CARDS:${JSON.stringify(branchCards)}\n\nTap a card to dive deeper. These results are ranked by semantic similarity to your search.`
        const voiceContent = `Found ${searchResults.length} matching records. Check the chat to review them.`

        const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
        addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })

        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Semantic search — vector memory query' },
          agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false,
          conversationMessage: msg,
          mode,
          voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
        }
      } else {
        const chatContent = `I don't have anything stored about that yet. As you use the app, I'll learn more.`
        const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
        try { addTurn('user', query) } catch { /* non-critical */ }
        try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
        return {
          intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Semantic search — no results' },
          agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
          needsConfirmation: false,
          conversationMessage: msg,
          mode,
          voiceSummary: request.isVoiceCommand ? 'No matching records found for that search.' : undefined,
        }
      }
    } catch (searchErr) {
      console.warn('[NEXUS] Semantic search failed, falling through to classifier:', searchErr)
      // Fall through — don't block if vector search fails
    }
  }

  // ── PROPOSAL QUERY — intercept before classifier ──────────────────────────
  const isProposalQuery = /(?:what needs attention|show proposals?|any suggestions?|scout.*(?:proposals?|suggestions?|ideas?)|pending.*proposals?|what(?:['\u2019]s| is) scout|mirofish|approval queue)/i.test(query)

  if (isProposalQuery) {
    const proposals = await getPendingProposals(request.orgId)
    if (proposals.length > 0) {
      const branchCards = proposals.slice(0, 5).map(p => ({
        label: p.title,
        detail: p.description.slice(0, 80) + (p.description.length > 80 ? '...' : ''),
        query: `Tell me more about proposal: ${p.title}`,
        relevance: p.impactLevel === 'high' || p.impactLevel === 'critical' ? 'high' : p.impactLevel === 'medium' ? 'medium' : 'low',
      }))
      const chatContent = `SCOUT has **${proposals.length} pending proposal${proposals.length > 1 ? 's' : ''}** for your review:\n\nBRANCH_CARDS:${JSON.stringify(branchCards)}\n\nOpen the **Proposal Queue** to approve, reject, or defer each one. Tap a card above for details.`
      const voiceContent = `SCOUT has ${proposals.length} pending proposals. Check the chat to review them, or open the proposal queue.`
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Proposal query — showing pending proposals as branch cards' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
      }
    } else {
      const chatContent = 'SCOUT has no pending proposals at this time.'
      const voiceContent = 'No pending proposals from SCOUT right now.'
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Proposal query — no pending' },
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
    const featureSummary = query.replace(/(?:can you|do you|does the app|is there|do I have|can I|able to|feature|capability|currently|support)\s*/gi, '').trim()
    const suggestion = isMissingFeature
      ? `\n\n**Want me to track this?** I'll save it to your App Improvements bucket right now so it doesn't get lost. Just say "yes" or "save that" and I'll log: "${featureSummary || 'feature request'}".`
      : ''
    const chatContent = baseAnswer + suggestion
    const voiceContent = capabilityAnswer
      ? `Here's what I found about that capability. Check the chat for full details.`
      : `That feature isn't built yet. Want me to save it to your improvement bucket? Just say yes.`
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

  // ── ACTIVITY LOG QUERY — intercept before classifier ─────────────────────
  if (isActivityQuery(query)) {
    try {
      const lowerQuery = query.toLowerCase()
      let activityContent = ''

      if (lowerQuery.includes('today') || lowerQuery.includes('last 24')) {
        // Plain English summary for today
        activityContent = await getActivitySummary(24)
      } else if (lowerQuery.includes('week') || lowerQuery.includes('last 7')) {
        // Plain English summary for the week
        activityContent = await getActivitySummary(168)
      } else {
        // Recent activity as bullet list with timestamps
        const entries = await getRecentActivity(10)
        if (entries.length === 0) {
          activityContent = 'No activity recorded yet. Start using the app and I\'ll track every action here.'
        } else {
          const lines = entries.map(e => {
            const date = new Date(e.created_at)
            const now = Date.now()
            const diffMs = now - date.getTime()
            const diffMins = Math.floor(diffMs / 60000)
            const diffHours = Math.floor(diffMins / 60)
            const diffDays = Math.floor(diffHours / 24)
            const ts = diffMins < 60
              ? `${diffMins}m ago`
              : diffHours < 24
                ? `${diffHours}h ago`
                : diffDays === 1
                  ? 'yesterday'
                  : date.toLocaleDateString()
            return `• ${e.summary} — ${ts}`
          })
          activityContent = `**Recent Activity**\n\n${lines.join('\n')}`
        }
      }

      const activityMsg: ConversationMessage = { role: 'assistant', content: activityContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', activityContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: activityContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Activity log query' },
        agent: { content: activityContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false,
        conversationMessage: activityMsg,
        mode,
        voiceSummary: request.isVoiceCommand ? activityContent.replace(/\*\*/g, '').replace(/^• /gm, '').replace(/\n/g, '. ').slice(0, 300) : undefined,
      }
    } catch {
      // Fall through to normal routing if activity query fails
    }
  }

  // ── GUARDIAN QUERY — intercept before classifier ──────────────────────────
  const GUARDIAN_TRIGGERS = [
    'crew activity', 'what did the crew do', 'any flags', 'crew review',
    'team logs', 'what happened on site', 'crew logs', 'crew summary',
    'field team', 'crew flagged', 'guardian',
  ]

  const isGuardianQuery = GUARDIAN_TRIGGERS.some(t => query.toLowerCase().includes(t))

  if (isGuardianQuery) {
    try {
      const { getDailyCrewSummary, reviewPendingLogs } = await import('@/agents/guardian')
      const [summary, review] = await Promise.all([
        getDailyCrewSummary(),
        reviewPendingLogs(),
      ])

      let chatContent = `**GUARDIAN — Crew Activity**\n\n${summary}`

      if (review.flagged.length > 0) {
        chatContent += `\n\nYou have **${review.flagged.length} item${review.flagged.length !== 1 ? 's' : ''}** needing review. Want me to walk you through them?`
      } else if (review.clean.length > 0) {
        chatContent += `\n\n✓ All reviewed logs are clean.`
      }

      const voiceContent = summary.replace(/\n/g, ' ').slice(0, 300)
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'GUARDIAN crew activity query' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
      }
    } catch (guardianErr) {
      console.warn('[NEXUS] GUARDIAN query failed, falling through to classifier:', guardianErr)
      // Fall through — don't block if GUARDIAN fails
    }
  }

  // ── MODE SWITCH DETECTION — intercept before classifier ──────────────────
  // Detects voice/text phrases that should switch NEXUS to a different response mode.
  // Confirms the switch inline and returns early without hitting Claude.

  const modeSwitchDetected = ((): NexusAgentMode | null => {
    const q = query.toLowerCase()
    if (/switch to proactive mode|be proactive/.test(q)) return 'proactive'
    if (/switch to analytical mode|show me the numbers|break it down/.test(q)) return 'analytical'
    if (/coaching mode|help me prepare|give me advice/.test(q)) return 'coaching'
    if (/let'?s just talk|conversational mode|open conversation/.test(q)) return 'conversational'
    if (/i'?m driving|carplay mode|i'?m in the car/.test(q)) return 'carplay'
    return null
  })()

  if (modeSwitchDetected) {
    setActiveMode(modeSwitchDetected)
    const cfg = MODE_CONFIGS[modeSwitchDetected]
    const modeDescriptions: Record<NexusAgentMode, string> = {
      proactive:      "I'll now anticipate what you need next and flag risks proactively.",
      analytical:     "I'll lead every answer with data, calculations, and scenario breakdowns.",
      coaching:       "I'll present options and consequences, then ask what you want to do.",
      conversational: "I'll keep it direct and natural — ask me anything.",
      carplay:        "Responses will be short and voice-friendly. Stay safe out there.",
    }
    const confirmContent = `Switching to ${cfg.name} mode. ${modeDescriptions[modeSwitchDetected]}`
    const confirmMsg: ConversationMessage = { role: 'assistant', content: confirmContent, agentId: 'nexus', timestamp: Date.now() }
    try { addTurn('user', query) } catch { /* non-critical */ }
    try { addTurn('assistant', confirmContent, 'nexus') } catch { /* non-critical */ }
    addConversationTurn({ role: 'assistant', content: confirmContent, agentUsed: 'nexus', timestamp: Date.now() })
    return {
      intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: `Mode switch to ${modeSwitchDetected}` },
      agent: { content: confirmContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
      needsConfirmation: false,
      conversationMessage: confirmMsg,
      mode,
      voiceSummary: request.isVoiceCommand ? confirmContent : undefined,
    }
  }

  // ── VOICE JOURNAL — CONTEXT SWITCH ───────────────────────────────────────
  // Intercept context-switch phrases before classifier.
  const contextSwitchMatch = (() => {
    const lower = query.toLowerCase()
    if (/i['\u2019]?m on a job site|i['\u2019]?m at (?:the job|work site|a job)/i.test(lower)) return 'job_site' as VoiceContext
    if (/i['\u2019]?m driving|i['\u2019]?m in the car/i.test(lower)) return 'driving' as VoiceContext
    if (/i['\u2019]?m in the office|i['\u2019]?m at the office|i['\u2019]?m home/i.test(lower)) return 'office' as VoiceContext
    return null
  })()

  if (contextSwitchMatch) {
    try { setVoiceContext(contextSwitchMatch) } catch { /* non-critical */ }
    const ctxLabels: Record<string, string> = { job_site: 'job site', driving: 'driving', office: 'office', general: 'general' }
    const ctxLabel = ctxLabels[contextSwitchMatch] ?? contextSwitchMatch
    const ctxThresholds: Record<string, number> = { office: 1500, job_site: 3500, driving: 2500, general: 2000 }
    const ctxMs = ctxThresholds[contextSwitchMatch] ?? 2000
    const chatContent = `Got it — switching to **${ctxLabel} mode**. I'll give you more time between responses (${ctxMs}ms pause threshold).`
    const voiceContent = `Got it — switching to ${ctxLabel} mode. I'll give you more time between responses.`
    const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
    try { addTurn('user', query) } catch { /* non-critical */ }
    try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
    addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
    return {
      intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Voice context switch' },
      agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
      needsConfirmation: false, conversationMessage: msg, mode,
      voiceSummary: request.isVoiceCommand ? voiceContent : undefined,
    }
  }

  // ── VOICE JOURNAL — SAVE ──────────────────────────────────────────────────
  // Trigger phrases: 'remember this', 'save this', 'note that', 'log this',
  // 'capture this', "don't forget", 'remind me', 'journal', 'voice note',
  // 'save for later', 'keep this'
  const isJournalSaveIntent = /\b(?:journal(?:ize)?|voice note|log this|capture this|save for later|keep this)\b/i.test(query) ||
    /\b(?:remember this|save this|note that|don['\u2019]t forget|remind me)\b/i.test(query)

  if (isJournalSaveIntent) {
    try {
      const activeCtx = (() => { try { return getVoiceContext() } catch { return 'general' as VoiceContext } })()
      const savedEntry = await saveJournalEntry({
        transcript: query,
        contextTag: activeCtx,
      })
      const actionCount = savedEntry?.action_items?.length ?? 0
      const actionLabel = actionCount === 1 ? '1 action item' : `${actionCount} action items`
      const chatContent = `Saved. I captured ${actionLabel} from that. You can ask me "what did I save today" anytime.`
      const msg: ConversationMessage = { role: 'assistant', content: chatContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', chatContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: chatContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Voice journal save' },
        agent: { content: chatContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: msg, mode,
        voiceSummary: request.isVoiceCommand ? chatContent : undefined,
      }
    } catch (journalErr) {
      console.warn('[NEXUS] Voice journal save failed, falling through:', journalErr)
    }
  }

  // ── VOICE JOURNAL — RETRIEVE ──────────────────────────────────────────────
  // Trigger phrases: 'what did I save', 'what did I capture', 'show my notes',
  // 'what did I log', 'what was I thinking about', 'my journal', 'what did I say',
  // 'saved notes'
  const isJournalRetrieveIntent = /(?:what did I (?:save|capture|log|say)|show my notes|saved notes|my journal|what was I thinking)/i.test(query)

  if (isJournalRetrieveIntent) {
    try {
      const lowerQ = query.toLowerCase()
      let journalContent = ''

      if (lowerQ.includes('today') || lowerQ.includes('24')) {
        journalContent = await getJournalSummary(24)
      } else if (lowerQ.includes('week')) {
        journalContent = await getJournalSummary(168)
      } else {
        const entries = await getRecentJournal(5)
        if (entries.length === 0) {
          journalContent = 'No voice notes yet. Say "remember this" or "save this" to NEXUS to capture thoughts on the go.'
        } else {
          const lines = entries.map((e: JournalEntry, i: number) => {
            const date = new Date(e.created_at)
            const now = Date.now()
            const diffMs = now - date.getTime()
            const diffMins = Math.floor(diffMs / 60000)
            const diffHours = Math.floor(diffMins / 60)
            const diffDays = Math.floor(diffHours / 24)
            const ts = diffMins < 60
              ? `${diffMins}m ago`
              : diffHours < 24 ? `${diffHours}h ago`
              : diffDays === 1 ? 'yesterday'
              : date.toLocaleDateString()
            const actions = e.action_items.length > 0
              ? `\n   _Actions: ${e.action_items.slice(0, 2).join('; ')}_`
              : ''
            return `${i + 1}. [${ts}] ${e.raw_transcript.slice(0, 100)}${e.raw_transcript.length > 100 ? '…' : ''}${actions}`
          })
          journalContent = `**Recent Voice Notes (${entries.length})**\n\n${lines.join('\n\n')}`
        }
      }

      const journalMsg: ConversationMessage = { role: 'assistant', content: journalContent, agentId: 'nexus', timestamp: Date.now() }
      try { addTurn('user', query) } catch { /* non-critical */ }
      try { addTurn('assistant', journalContent, 'nexus') } catch { /* non-critical */ }
      addConversationTurn({ role: 'assistant', content: journalContent, agentUsed: 'nexus', timestamp: Date.now() })
      return {
        intent: { category: 'general', targetAgent: 'nexus', confidence: 1.0, entities: [], requiresConfirmation: false, impactLevel: 'LOW', reasoning: 'Voice journal retrieve' },
        agent: { content: journalContent, agentId: 'nexus', agentName: 'NEXUS', confidence: 1.0 },
        needsConfirmation: false, conversationMessage: journalMsg, mode,
        voiceSummary: request.isVoiceCommand ? journalContent.replace(/\*\*/g, '').replace(/\n/g, '. ').slice(0, 300) : undefined,
      }
    } catch (journalRetrieveErr) {
      console.warn('[NEXUS] Voice journal retrieve failed, falling through:', journalRetrieveErr)
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
    : isBranchQuery
      ? BRANCH_FORMAT_INSTRUCTION
      : isOpBriefing
        ? OPERATIONAL_BRIEFING_FORMAT_INSTRUCTION
        : mode === 'deepdive'
          ? DEEP_DIVE_FORMAT_INSTRUCTION
          : BRIEFING_FORMAT_INSTRUCTION
  let enrichedMessage = `${request.message}\n\n${modeInstruction}`

  // ── COACHING MODE CONSEQUENCES — inject structured option/consequence format ─
  // When in coaching mode and the user asks for advice/recommendation, force
  // NEXUS to present: situation → Option A → Option B → consequences → "What do you want to do?"
  const activeAgentMode = getActiveMode()
  const isAdviceQuery = /should i|what should|advise|recommend|my best option|help me decide|which is better|worth it|take.*job|hire.*person|raise my rate|lower.*price/i.test(query)

  if (activeAgentMode === 'coaching' && isAdviceQuery) {
    enrichedMessage = enrichedMessage + `

## COACHING MODE — MANDATORY RESPONSE STRUCTURE
You MUST follow this exact structure. Do NOT skip steps.

1. State the current situation factually in one sentence.
2. Present Option A and what action it involves.
3. State the consequences of Option A with any available data (costs, risk, timeline).
4. Present Option B and what action it involves.
5. State the consequences of Option B with any available data.
6. End with EXACTLY: "What do you want to do?"

RULES:
- Never say "you should" or "I recommend".
- Always say "Option A means..." / "Option B leads to..."
- Use real numbers from the data where available.
- Keep the structure tight — no preamble, no conclusions.

Example format:
"Here's the situation: [fact].
Option A — [action]: leads to [consequence with data].
Option B — [action]: leads to [consequence with data].
Based on your numbers, Option A has [X] risk and Option B has [Y] cost.
What do you want to do?"
`
  }

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
