// @ts-nocheck
/**
 * Voice Intent Routing — Classifies voice transcripts to target agents
 *
 * Uses Claude to classify voice commands, then routes to the appropriate
 * PowerOn Hub agent (SPARK, CHRONO, VAULT, etc.) via the NEXUS classifier.
 */

import { processMessage } from '@/agents/nexus'

// ── Types ────────────────────────────────────────────────────────────────────

export type TargetAgent =
  | 'nexus'
  | 'spark'
  | 'chrono'
  | 'vault'
  | 'blueprint'
  | 'ohm'
  | 'ledger'
  | 'scout'
  | 'pulse'

export interface IntentClassification {
  agent: TargetAgent
  intent: string              // e.g., 'list_leads', 'schedule_event', 'get_estimate'
  confidence: number          // 0-1
  parameters: Record<string, unknown>  // Extracted entities (date, time, person, etc.)
}

export interface VoiceRouteResult {
  classification: IntentClassification
  agentResponse: string       // Text response from the agent
  responseTime: number        // ms
}

// ── Quick-Match Patterns ─────────────────────────────────────────────────────
// Fast keyword-based classification before falling back to Claude

const QUICK_PATTERNS: Array<{ pattern: RegExp; agent: TargetAgent; intent: string }> = [
  // SPARK — leads, marketing, campaigns
  { pattern: /\b(lead|leads|pipeline|prospect|new\s+customer)\b/i, agent: 'spark', intent: 'list_leads' },
  { pattern: /\b(campaign|marketing|social\s+media|outreach)\b/i, agent: 'spark', intent: 'list_campaigns' },
  { pattern: /\b(review|reviews|google\s+review|yelp)\b/i, agent: 'spark', intent: 'list_reviews' },
  { pattern: /\b(gc\s+contact|general\s+contractor|gc\s+relationship)\b/i, agent: 'spark', intent: 'list_gc_contacts' },

  // CHRONO — scheduling, calendar, crew
  { pattern: /\b(schedule|calendar|appointment|book)\b/i, agent: 'chrono', intent: 'list_events' },
  { pattern: /\b(crew|dispatch|available|who'?s\s+free)\b/i, agent: 'chrono', intent: 'crew_availability' },
  { pattern: /\b(agenda|task|reminder|to\s*do)\b/i, agent: 'chrono', intent: 'list_tasks' },
  { pattern: /\b(today'?s?\s+job|this\s+week|next\s+week)\b/i, agent: 'chrono', intent: 'list_today_jobs' },

  // VAULT — estimates, pricing
  { pattern: /\b(estimate|quote|bid|pricing|cost)\b/i, agent: 'vault', intent: 'list_estimates' },

  // BLUEPRINT — projects, permits
  { pattern: /\b(project|permit|rfi|phase|blueprint)\b/i, agent: 'blueprint', intent: 'list_projects' },

  // OHM — code compliance
  { pattern: /\b(nec|code|compliance|safety|violation|article)\b/i, agent: 'ohm', intent: 'code_lookup' },

  // LEDGER — invoices, payments
  { pattern: /\b(invoice|payment|receivable|billing|expense)\b/i, agent: 'ledger', intent: 'list_invoices' },

  // PULSE — dashboard, KPIs
  { pattern: /\b(dashboard|kpi|metric|revenue|margin|ar\s+aging)\b/i, agent: 'pulse', intent: 'get_dashboard' },
]

// ── Implementation ───────────────────────────────────────────────────────────

/**
 * Classify a voice transcript and route to the appropriate agent.
 * Uses fast keyword matching first, then falls back to NEXUS classifier.
 */
export async function classifyVoiceIntent(transcript: string): Promise<IntentClassification> {
  if (!transcript || transcript.trim().length === 0) {
    return { agent: 'nexus', intent: 'unknown', confidence: 0, parameters: {} }
  }

  const cleaned = transcript.trim().toLowerCase()

  // Strip wake word prefix if present
  const withoutWakeWord = cleaned
    .replace(/^(hey\s+nexus|ok\s+nexus|nexus)\s*[,.]?\s*/i, '')
    .trim()

  // Try quick pattern matching first
  for (const { pattern, agent, intent } of QUICK_PATTERNS) {
    if (pattern.test(withoutWakeWord)) {
      console.log(`[VoiceRoute] Quick match: "${withoutWakeWord}" → ${agent}/${intent}`)
      return {
        agent,
        intent,
        confidence: 0.85,
        parameters: extractParameters(withoutWakeWord),
      }
    }
  }

  // Fall back to NEXUS classifier for complex intents
  console.log(`[VoiceRoute] No quick match, using NEXUS classifier for: "${withoutWakeWord}"`)
  return classifyWithNexus(withoutWakeWord)
}

/**
 * Route a classified voice command to the appropriate agent and get a response.
 */
export async function routeVoiceCommand(
  transcript: string,
  context: { orgId: string; userId: string }
): Promise<VoiceRouteResult> {
  const startTime = Date.now()

  // Classify intent
  const classification = await classifyVoiceIntent(transcript)

  // Route through NEXUS to get agent response
  const nexusResponse = await processMessage({
    message: transcript,
    orgId: context.orgId,
    userId: context.userId,
    conversationHistory: [],
  })

  const responseTime = Date.now() - startTime

  console.log(`[VoiceRoute] Routed to ${classification.agent} in ${responseTime}ms`)

  return {
    classification,
    agentResponse: nexusResponse?.agent?.content || 'I could not process that command.',
    responseTime,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Use NEXUS classifier for complex intent classification.
 */
async function classifyWithNexus(text: string): Promise<IntentClassification> {
  try {
    // The NEXUS classifier already handles routing — we just need the classification
    // For voice, we add context that this is a spoken command
    const response = await processMessage({
      message: text,
      orgId: '',
      userId: '',
      conversationHistory: [],
      isVoiceCommand: true,
    })

    // NexusResponse has .intent (ClassifiedIntent) and .agent (AgentResponse)
    if (response?.intent?.targetAgent) {
      return {
        agent: response.intent.targetAgent as TargetAgent,
        intent: response.intent.category || 'general',
        confidence: response.intent.confidence || 0.7,
        parameters: {},
      }
    }
  } catch (err) {
    console.error('[VoiceRoute] NEXUS classification error:', err)
  }

  // Default fallback
  return {
    agent: 'nexus',
    intent: 'general',
    confidence: 0.5,
    parameters: {},
  }
}

/**
 * Extract named entities from a voice transcript.
 * Handles common patterns like dates, times, names, statuses.
 */
function extractParameters(text: string): Record<string, unknown> {
  const params: Record<string, unknown> = {}

  // Extract time references
  const timeMatch = text.match(/\b(\d{1,2})\s*(am|pm|:\d{2})\b/i)
  if (timeMatch) params.time = timeMatch[0]

  // Extract date references
  if (/\btoday\b/i.test(text)) params.date = 'today'
  if (/\btomorrow\b/i.test(text)) params.date = 'tomorrow'
  if (/\bthis\s+week\b/i.test(text)) params.dateRange = 'this_week'
  if (/\bnext\s+week\b/i.test(text)) params.dateRange = 'next_week'

  // Extract status references
  const statusMatch = text.match(/\b(new|contacted|scheduled|delivered|negotiating|won|lost|pending|active|completed)\b/i)
  if (statusMatch) params.status = statusMatch[1].toLowerCase()

  // Extract person names (simple heuristic: capitalized words after "with")
  const withMatch = text.match(/\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)
  if (withMatch) params.person = withMatch[1]

  return params
}
