/**
 * Intent Classifier — Analyzes user messages and determines routing.
 *
 * Uses Claude Sonnet to classify intent, identify target agent,
 * assess confidence, extract entities, and determine impact level.
 * Validated with runtime type-checking for safety.
 */

// ── Type definitions ────────────────────────────────────────────────────────

export const INTENT_CATEGORIES = [
  'estimating', 'dashboard', 'finance', 'marketing', 'projects',
  'compliance', 'calendar', 'analysis', 'general', 'multi_agent',
] as const

export const TARGET_AGENTS = [
  'nexus', 'vault', 'pulse', 'ledger', 'spark',
  'blueprint', 'ohm', 'chrono', 'scout',
] as const

export const IMPACT_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

export const INTENT_TYPES = ['command', 'insight', 'action', 'ambiguous'] as const

export type IntentCategory   = typeof INTENT_CATEGORIES[number]
export type TargetAgent      = typeof TARGET_AGENTS[number]
export type ImpactLevel      = typeof IMPACT_LEVELS[number]
export type IntentType       = typeof INTENT_TYPES[number]

export interface Entity {
  type:   string
  value:  string
  id?:    string
}

export interface ClassifiedIntent {
  category:             IntentCategory
  targetAgent:          TargetAgent
  confidence:           number
  entities:             Entity[]
  requiresConfirmation: boolean
  impactLevel:          ImpactLevel
  reasoning:            string
  /** Whether the user issued a persistent command, a one-time insight query, an immediate action, or something ambiguous. */
  intentType:           IntentType
}

// ── Conversation message type ───────────────────────────────────────────────

export interface ConversationMessage {
  role:      'user' | 'assistant'
  content:   string
  agentId?:  string
  timestamp: number
}

// ── Runtime validation ──────────────────────────────────────────────────────

function isValidCategory(v: unknown): v is IntentCategory {
  return typeof v === 'string' && (INTENT_CATEGORIES as readonly string[]).includes(v)
}

function isValidAgent(v: unknown): v is TargetAgent {
  return typeof v === 'string' && (TARGET_AGENTS as readonly string[]).includes(v)
}

function isValidImpact(v: unknown): v is ImpactLevel {
  return typeof v === 'string' && (IMPACT_LEVELS as readonly string[]).includes(v)
}

function validateEntity(e: unknown): Entity | null {
  if (!e || typeof e !== 'object') return null
  const obj = e as Record<string, unknown>
  if (typeof obj.type !== 'string' || typeof obj.value !== 'string') return null
  return {
    type:  obj.type,
    value: obj.value,
    id:    typeof obj.id === 'string' ? obj.id : undefined,
  }
}

/**
 * Validate a parsed object as a ClassifiedIntent.
 * Returns the validated intent or null with error details.
 */
function validateIntent(raw: unknown): { data: ClassifiedIntent } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Not an object' }

  const obj = raw as Record<string, unknown>

  if (!isValidCategory(obj.category))   return { error: `Invalid category: ${obj.category}` }
  if (!isValidAgent(obj.targetAgent))    return { error: `Invalid targetAgent: ${obj.targetAgent}` }
  if (!isValidImpact(obj.impactLevel))   return { error: `Invalid impactLevel: ${obj.impactLevel}` }
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    return { error: `Invalid confidence: ${obj.confidence}` }
  }
  if (typeof obj.requiresConfirmation !== 'boolean') {
    return { error: `Invalid requiresConfirmation: ${obj.requiresConfirmation}` }
  }
  if (typeof obj.reasoning !== 'string') {
    return { error: `Invalid reasoning: ${obj.reasoning}` }
  }

  const entities: Entity[] = []
  if (Array.isArray(obj.entities)) {
    for (const e of obj.entities) {
      const valid = validateEntity(e)
      if (valid) entities.push(valid)
    }
  }

  return {
    data: {
      category:             obj.category,
      targetAgent:          obj.targetAgent,
      confidence:           obj.confidence,
      entities,
      requiresConfirmation: obj.requiresConfirmation,
      impactLevel:          obj.impactLevel,
      reasoning:            obj.reasoning,
      intentType:           'ambiguous' as IntentType, // Default — classifyIntent overrides with detectIntentType
    }
  }
}

// ── Keyword maps for fast local classification ──────────────────────────────

interface AgentKeywords {
  multi: string[]    // 3-word+ phrases
  single: string[]   // single/2-word keywords
}

const AGENT_KEYWORDS: Record<TargetAgent, AgentKeywords> = {
  blueprint: {
    multi: [
      'check my projects', 'status of', 'project overview', 'operations flow',
      'what needs attention', 'stagnant jobs', 'project this week', 'active jobs',
      'phase progress', 'field log', 'punch list', 'change order',
    ],
    single: [
      'project', 'permit', 'rfi', 'phase', 'coordination',
    ],
  },
  pulse: {
    multi: [
      'cash flow', 'how much have i collected', 'pipeline', 'what\'s my exposure',
      'revenue this week', 'profit margin', 'financial overview', 'money situation',
      'what do i have coming in', 'weekly tracker', 'performance', 'margin analysis',
      'visual representation', 'data visualization', 'show me numbers',
    ],
    single: [
      'dashboard', 'kpi', 'metric', 'trend', 'revenue', 'margin',
      'visual', 'visualization', 'chart', 'graph', 'numbers',
      'analytics', 'metrics', 'data',
    ],
  },
  ohm: {
    multi: [
      'code requirement', 'load calc', 'breaker size', 'wire gauge', 'panel schedule',
      'what are the requirements for', 'is this up to code', 'on site', 'working on',
      'installing', 'rough in', 'trim out', 'compliance',
    ],
    single: [
      'nec', 'cec', 'cbc', 'title 24', 'afci', 'gfci', 'safety',
      'article', 'conductor', 'ampacity', 'ground fault', 'arc fault',
    ],
  },
  vault: {
    multi: [
      'material takeoff', 'how much should i charge', 'materials needed',
      'bill of materials', 'compare against', 'takeoff list', 'margin analysis',
      'price book',
    ],
    single: [
      'estimate', 'quote', 'mto', 'price this job', 'blueprints',
      'bid', 'pricing', 'cost', 'markup',
    ],
  },
  ledger: {
    multi: [
      'who owes me', 'accounts receivable', 'ar aging', 'outstanding balance',
      'send invoice', 'follow up on payment', 'accounts receivable',
    ],
    single: [
      'invoice', 'collections', 'payment', 'billing', 'receivable',
      'overdue', 'balance due',
    ],
  },
  spark: {
    multi: [
      'gc contacts', 'follow up', 'google review', 'win rate', 'fit score',
      'new customer',
    ],
    single: [
      'leads', 'prospects', 'referral', 'marketing', 'outreach', 'who should i call',
      'campaign', 'review', 'yelp', 'reputation',
    ],
  },
  chrono: {
    multi: [
      'who\'s working', 'job assignment', 'crew today', 'who\'s free',
    ],
    single: [
      'schedule', 'crew', 'dispatch', 'calendar', 'availability',
      'appointment', 'agenda', 'reminder', 'tomorrow', 'next week',
    ],
  },
  scout: {
    multi: [
      'market rate', 'competitor pricing', 'look up', 'find information',
      'what does this cost', 'supplier pricing', 'improvement idea',
      'analyze this code', 'code analysis', 'migrate this',
    ],
    single: [
      'research', 'analyze', 'pattern', 'optimization', 'improvement',
    ],
  },
  nexus: {
    multi: [
      'weekly overview', 'operations flow', 'what needs my attention',
      'morning briefing', 'daily summary', 'status update', 'how\'s business',
      'what\'s going on', 'moving forward', 'from now on', 'remember that',
      'i prefer', 'i want you to', 'going forward', 'keep in mind',
      // Project status / "how is the job going" type questions — NEXUS owns these
      'how is the job', 'how are the jobs', 'how are my jobs', 'how are we doing',
      'how is business', 'how are things', 'project health', 'job health',
      'how is the project', 'how are the projects', 'project overview',
      'business overview', 'overall status', 'give me an overview',
    ],
    single: [
      'hi', 'hello', 'help', 'general', 'preference',
      // Project status is NEXUS territory — broad overview words score here
      'overview', 'summary', 'briefing', 'overall',
    ],
  },
}

// ── Intent type detection ────────────────────────────────────────────────────
// Determines whether the user's message is a persistent command (should be
// stored and always applied), a one-time insight query (answer only, no storage),
// an immediate action request, or ambiguous (answer first, then offer to persist).

const COMMAND_SIGNALS = /\b(always|from now on|remember that|make sure you|going forward|set it so that|every time|i want you to always|keep doing|permanently|by default)\b/i
const INSIGHT_SIGNALS = /^(how is|how are|what is|what are|what was|what were|what's|tell me|analyze|give me|what do you think|can you check|show me|explain|summarize|who is|who are|when is|when are|where is|where are|how much|how many|why is|why are|do you know|is there|are there)/i
const ACTION_SIGNALS  = /^(send|create|add|schedule|log|update|mark|delete|remove|set|book|assign|save|record|post|submit|complete|close|open|generate|make|run|start|stop|cancel|draft|invite|move|copy|archive|export|import|sync|approve|reject|apply|call|email|text|notify)\b/i

/**
 * Detect whether the user's message is a persistent command, a one-time
 * insight request, an immediate action, or ambiguous.
 *
 * Priority: command > action > insight > ambiguous
 * - command:   Contains persistent-instruction signals ("always", "from now on", etc.)
 * - action:    Starts with an imperative action verb ("send", "create", "add", etc.)
 * - insight:   Starts with a question phrase or ends with "?" ("how is", "what is", etc.)
 * - ambiguous: Does not clearly match any of the above
 */
function detectIntentType(message: string): IntentType {
  const trimmed = message.trim()

  // Command signals take priority — these indicate a persistent instruction to store
  if (COMMAND_SIGNALS.test(trimmed)) return 'command'

  // Action signals — imperative verbs requesting an immediate one-off task
  if (ACTION_SIGNALS.test(trimmed)) return 'action'

  // Insight signals — questions or information requests (one-time, no storage)
  if (INSIGHT_SIGNALS.test(trimmed) || trimmed.endsWith('?')) return 'insight'

  return 'ambiguous'
}

// ── Classifier prompt for fallback ──────────────────────────────────────────

const CLASSIFIER_PROMPT = `You are the intent classifier for NEXUS, the manager agent of PowerOn Hub — an AI platform for an electrical contracting business.

Analyze the user's message and return a JSON object with these fields:
- category: One of: estimating, dashboard, finance, marketing, projects, compliance, calendar, analysis, general, multi_agent
- targetAgent: One of: nexus, vault, pulse, ledger, spark, blueprint, ohm, chrono, scout
- confidence: 0.0 to 1.0 — how confident you are in the classification
- entities: Array of {type, value, id?} — extracted entities (project names, dates, amounts, etc.)
- requiresConfirmation: boolean — true if this action modifies data or has side effects
- impactLevel: One of: LOW, MEDIUM, HIGH, CRITICAL
- reasoning: Brief explanation of why you chose this classification

Agent routing guide:
- VAULT: estimating, bids, cost history, margins, pricing, material costs, price book
- PULSE: dashboard, KPIs, charts, reports, metrics, weekly tracker, performance
- LEDGER: invoices, payments, AR, cash flow, billing, collections, overdue
- SPARK: marketing, leads, campaigns, reviews, social media, GC contacts, outreach
- BLUEPRINT: projects, phases, permits, RFIs, change orders, coordination, field logs, MTOs
- OHM: NEC code, safety, electrical questions, code compliance, training
- CHRONO: calendar, scheduling, crew dispatch, reminders, agenda tasks
- SCOUT: system analysis, patterns, anomalies, optimization proposals, user improvement ideas, code analysis, migration analysis. Route here when: message starts with "Scout," OR contains "improvement idea" OR "I want to add" OR "suggest an improvement" OR "analyze this code" OR "code analysis" OR "migrate this"
- NEXUS: greetings, meta questions about the system, general conversation

Impact level guide:
- LOW: "Show me...", "What is...", "How many...", "List all..." — read-only
- MEDIUM: "Create a...", "Update the...", "Send a reminder...", "Add to..."
- HIGH: "Send invoice...", "Delete...", "Mark as paid...", "Change contract..."
- CRITICAL: "Delete all...", "Bulk update...", "Migration...", "Change permissions..."

Return ONLY valid JSON. No markdown, no explanation outside the JSON.`

// ── Guaranteed routing rules ─────────────────────────────────────────────────
// These run BEFORE keyword scoring to ensure common contractor terms always route.

interface GuaranteedRoute {
  keywords: string[]
  agent: TargetAgent
  minScore: number
}

// ── NEXUS-FIRST ROUTING DESIGN ───────────────────────────────────────────────
// Guaranteed routes cover SPECIALIST-ONLY terms — terms that unambiguously
// require a specific domain agent's data.
//
// General terms ('project', 'job', 'status', 'how is', 'money', 'cash', 'revenue')
// are intentionally excluded here. Those reach NEXUS directly and NEXUS synthesizes
// a conversational response before any specialist detail is appended.
//
// LEDGER is only triggered by EXPLICIT billing/collection vocabulary:
//   invoice, overdue, balance due, who owes, accounts receivable, billing, collections
// NOT by: 'money', 'cash', 'revenue', 'paid', 'job going', 'project status'
//
// BLUEPRINT is only triggered by document/workflow-specific terms:
//   rfi, punch list, change order, coordination item, submittal
// NOT by: 'project', 'job', 'status', 'operations', 'phase', 'active jobs'
// ─────────────────────────────────────────────────────────────────────────────

const GUARANTEED_ROUTES: GuaranteedRoute[] = [
  // Blueprint: only document/workflow-specific keywords — NOT general project status terms
  { keywords: ['rfi', 'punch list', 'change order', 'coordination item', 'submittal'], agent: 'blueprint', minScore: 0.5 },
  // OHM: electrical code — unchanged
  { keywords: ['nec', 'code requirement', 'title 24', 'cec', 'install', 'wire', 'breaker', 'panel', 'site', 'afci', 'gfci', 'conductor', 'ampacity'], agent: 'ohm', minScore: 0.5 },
  // LEDGER: ONLY explicit billing/collection terms — NOT general financial terms like money/cash/revenue/paid
  { keywords: ['invoice', 'overdue', 'balance due', 'who owes', 'accounts receivable', 'billing', 'collections', 'ar aging'], agent: 'ledger', minScore: 0.5 },
  // VAULT: estimating-specific terms — unchanged
  { keywords: ['estimate', 'quote', 'mto', 'material', 'takeoff', 'price', 'bid', 'pricing', 'cost', 'markup', 'price book'], agent: 'vault', minScore: 0.5 },
  // CHRONO: scheduling-specific terms — unchanged
  { keywords: ['schedule', 'crew', 'calendar', 'book', 'dispatch', 'appointment', 'agenda', 'reminder', 'tomorrow', 'next week'], agent: 'chrono', minScore: 0.5 },
  // SPARK: marketing/lead-specific terms — unchanged
  { keywords: ['lead', 'gc', 'contact', 'marketing', 'outreach', 'prospect', 'referral', 'campaign', 'review', 'yelp'], agent: 'spark', minScore: 0.5 },
  // PULSE: analytics/dashboard-specific terms — unchanged
  { keywords: ['dashboard', 'kpi', 'metric', 'trend', 'margin', 'performance', 'weekly tracker', 'visual', 'visualization', 'chart', 'graph', 'analytics', 'metrics'], agent: 'pulse', minScore: 0.5 },
  // SCOUT: research/analysis terms — unchanged
  { keywords: ['research', 'analyze', 'pattern', 'optimization', 'improvement', 'scout'], agent: 'scout', minScore: 0.5 },
]

/**
 * Check guaranteed routing rules. Returns the first matching agent with its floor score.
 */
function checkGuaranteedRoutes(message: string): { agent: TargetAgent; score: number; reasoning: string } | null {
  const lower = message.toLowerCase()
  for (const route of GUARANTEED_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) {
        console.log(`[Classifier] Guaranteed route: "${kw}" → ${route.agent}`)
        return {
          agent: route.agent,
          score: route.minScore,
          reasoning: `Guaranteed route: matched "${kw}" → ${route.agent}`,
        }
      }
    }
  }
  return null
}

// ── Keyword scoring (Tier 1) ────────────────────────────────────────────────

/**
 * Score a message against an agent's keyword map.
 * Multi-word phrases score 3, single words score 1.
 * Returns normalized score 0-1.
 */
function scoreAgentKeywords(message: string, keywords: AgentKeywords): number {
  const lowerMessage = message.toLowerCase()
  let score = 0

  // Multi-word phrases (weight 3)
  for (const phrase of keywords.multi) {
    if (lowerMessage.includes(phrase)) {
      score += 3
    }
  }

  // Single words (weight 1)
  for (const word of keywords.single) {
    if (lowerMessage.includes(word)) {
      score += 1
    }
  }

  // Normalize by a fixed threshold (score of 4 = 1.0)
  // One multi-word match (3) + one single-word match (1) = 4 → confident
  // Just one multi-word match (3) → 0.75 → high confidence
  // Just one single word (1) → 0.25 → low, needs Claude fallback
  return Math.min(score / 4, 1.0)
}

/**
 * Perform Tier 1: Fast keyword scoring across all agents.
 * Returns winning agent and score if above 0.5 threshold, else null.
 */
function tier1KeywordScoring(message: string): { agent: TargetAgent; score: number; reasoning: string } | null {
  const scores: Record<TargetAgent, number> = {} as Record<TargetAgent, number>

  for (const agent of TARGET_AGENTS) {
    scores[agent] = scoreAgentKeywords(message, AGENT_KEYWORDS[agent])
  }

  console.log('[Classifier] Tier 1 scores:', Object.entries(scores).filter(([, s]) => s > 0).map(([a, s]) => `${a}=${s.toFixed(2)}`).join(', ') || '(all zero)')

  // Find top agent
  let topAgent: TargetAgent | null = null
  let topScore = 0
  for (const agent of TARGET_AGENTS) {
    if (scores[agent] > topScore) {
      topScore = scores[agent]
      topAgent = agent
    }
  }

  if (!topAgent || topScore < 0.5) {
    return null
  }

  return {
    agent: topAgent,
    score: topScore,
    reasoning: `Matched on keywords for ${topAgent} (score: ${topScore.toFixed(2)})`,
  }
}

/**
 * Perform Tier 2: Detect if top 2 agents are close.
 * If both above 0.4 and within 0.15, return multi_agent routing to nexus.
 */
function tier2MultiAgentDetection(message: string): { category: 'multi_agent'; targetAgent: 'nexus'; confidence: number; reasoning: string } | null {
  const scores: Record<TargetAgent, number> = {} as Record<TargetAgent, number>

  for (const agent of TARGET_AGENTS) {
    scores[agent] = scoreAgentKeywords(message, AGENT_KEYWORDS[agent])
  }

  // Sort by score descending
  const sorted = (TARGET_AGENTS as readonly TargetAgent[])
    .map(agent => ({ agent, score: scores[agent] }))
    .sort((a, b) => b.score - a.score)

  const top1 = sorted[0]
  const top2 = sorted[1]

  if (!top1 || !top2) return null

  const withinRange = top1.score - top2.score <= 0.15
  const bothAboveThreshold = top1.score >= 0.4 && top2.score >= 0.4

  if (withinRange && bothAboveThreshold) {
    return {
      category: 'multi_agent',
      targetAgent: 'nexus',
      confidence: top1.score,
      reasoning: `Split between ${top1.agent} and ${top2.agent} (scores: ${top1.score.toFixed(2)} vs ${top2.score.toFixed(2)})`,
    }
  }

  return null
}

/**
 * Get recent agent context boost.
 * If last user or assistant message has an agentId, boost that agent +0.15.
 */
function getContextBoost(conversationHistory: ConversationMessage[]): { agent: TargetAgent; boost: number } | null {
  const recent = conversationHistory.slice(-3)
  for (const msg of recent) {
    if (msg.agentId) {
      const agent = msg.agentId as TargetAgent
      if (isValidAgent(agent)) {
        return { agent, boost: 0.15 }
      }
    }
  }
  return null
}

/**
 * Import callClaude from proxy service for fallback.
 */
import { callClaude, extractText } from '@/services/claudeProxy'

/**
 * Perform Tier 3: Claude fallback.
 * Only called if no keyword scores above 0.4.
 */
async function tier3ClaudeFallback(
  message: string,
  memoryContext: string,
  conversationHistory: ConversationMessage[]
): Promise<ClassifiedIntent> {
  const historyText = conversationHistory
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'User' : `Assistant (${m.agentId ?? 'nexus'})`}: ${m.content}`)
    .join('\n')

  const userPrompt = [
    memoryContext ? `## Active Context\n${memoryContext}\n` : '',
    historyText ? `## Recent Conversation\n${historyText}\n` : '',
    `## New Message\n${message}`,
  ]
    .filter(Boolean)
    .join('\n')

  const response = await callClaude({
    messages: [{ role: 'user', content: userPrompt }],
    system: CLASSIFIER_PROMPT,
    max_tokens: 512,
  })

  const rawText = extractText(response)

  // Parse JSON from response
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Try to extract JSON from potential markdown wrapping
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error(`Classifier returned non-JSON: ${rawText.slice(0, 200)}`)
    }
    parsed = JSON.parse(jsonMatch[0])
  }

  // Validate
  const result = validateIntent(parsed)

  if ('error' in result) {
    console.error('[Classifier] Validation failed:', result.error)
    // Return safe fallback
    return {
      category: 'general',
      targetAgent: 'nexus',
      confidence: 0.3,
      entities: [],
      requiresConfirmation: false,
      impactLevel: 'LOW',
      reasoning: `Classification validation failed: ${result.error}. Falling back to NEXUS.`,
    }
  }

  return result.data
}

/**
 * Classify a user message into an intent with agent routing.
 * Uses three-tier classification: keyword scoring (fast), multi-agent detection,
 * then Claude fallback only if needed.
 *
 * @param message - The user's message text
 * @param memoryContext - Relevant memory/context from Redis and vector search
 * @param conversationHistory - Recent conversation messages for context
 * @returns Validated ClassifiedIntent
 */
export async function classifyIntent(
  message: string,
  memoryContext: string,
  conversationHistory: ConversationMessage[]
): Promise<ClassifiedIntent> {
  console.log('[Classifier] Running classification for:', message)

  // Detect intent type once — applied to every classification path below
  const intentType = detectIntentType(message)
  console.log(`[Classifier] Intent type → ${intentType}`)

  const categoryMap: Record<TargetAgent, IntentCategory> = {
    vault: 'estimating',
    pulse: 'dashboard',
    ledger: 'finance',
    spark: 'marketing',
    blueprint: 'projects',
    ohm: 'compliance',
    chrono: 'calendar',
    scout: 'analysis',
    nexus: 'general',
  }

  const impactMap: Record<TargetAgent, ImpactLevel> = {
    vault: 'MEDIUM',
    pulse: 'LOW',
    ledger: 'MEDIUM',
    spark: 'MEDIUM',
    blueprint: 'MEDIUM',
    ohm: 'LOW',
    chrono: 'MEDIUM',
    scout: 'LOW',
    nexus: 'LOW',
  }

  // Tier 0: Guaranteed routing rules — always checked first
  const guaranteed = checkGuaranteedRoutes(message)
  if (guaranteed) {
    console.log(`[Classifier] Tier 0 guaranteed → ${guaranteed.agent} (${guaranteed.score.toFixed(2)})`)
    return {
      category: categoryMap[guaranteed.agent],
      targetAgent: guaranteed.agent,
      confidence: guaranteed.score,
      entities: [],
      requiresConfirmation: guaranteed.agent === 'ledger' || guaranteed.agent === 'vault',
      impactLevel: impactMap[guaranteed.agent],
      reasoning: guaranteed.reasoning,
      intentType,
    }
  }

  // Tier 1: Fast keyword scoring
  const tier1 = tier1KeywordScoring(message)
  if (tier1 && tier1.score >= 0.5) {
    const contextBoost = getContextBoost(conversationHistory)
    let finalScore = tier1.score
    let finalAgent = tier1.agent

    // Apply context boost if applicable
    if (contextBoost && contextBoost.agent === tier1.agent) {
      finalScore = Math.min(finalScore + contextBoost.boost, 1.0)
    }

    console.log(`[Classifier] Tier 1 winner → ${finalAgent} (${finalScore.toFixed(2)})`)

    return {
      category: categoryMap[finalAgent],
      targetAgent: finalAgent,
      confidence: finalScore,
      entities: [],
      requiresConfirmation: finalAgent === 'ledger' || finalAgent === 'vault',
      impactLevel: impactMap[finalAgent],
      reasoning: tier1.reasoning,
      intentType,
    }
  }

  // Tier 2: Multi-agent detection
  const tier2 = tier2MultiAgentDetection(message)
  if (tier2) {
    console.log(`[Classifier] Tier 2 multi-agent → nexus`)
    return {
      category: tier2.category,
      targetAgent: tier2.targetAgent,
      confidence: tier2.confidence,
      entities: [],
      requiresConfirmation: false,
      impactLevel: 'LOW',
      reasoning: tier2.reasoning,
      intentType,
    }
  }

  // Tier 3: Claude fallback for low-scoring or unrecognized input
  const scores: Record<TargetAgent, number> = {} as Record<TargetAgent, number>
  for (const agent of TARGET_AGENTS) {
    scores[agent] = scoreAgentKeywords(message, AGENT_KEYWORDS[agent])
  }
  const maxScore = Math.max(...Object.values(scores))

  if (maxScore >= 0.1) {
    // Some keyword signal exists — try Claude for nuanced classification
    try {
      console.log(`[Classifier] Tier 3 Claude fallback (maxScore: ${maxScore.toFixed(2)})`)
      const tier3Result = await tier3ClaudeFallback(message, memoryContext, conversationHistory)
      return { ...tier3Result, intentType }
    } catch (error) {
      console.error('[Classifier] Claude fallback failed:', error)
    }
  }

  // Final fallback: for 3+ word inputs, route to NEXUS general (never show error)
  const wordCount = message.trim().split(/\s+/).length
  if (wordCount >= 3) {
    console.log(`[Classifier] Final fallback → nexus general (${wordCount} words)`)
    return {
      category: 'general',
      targetAgent: 'nexus',
      confidence: 0.4,
      entities: [],
      requiresConfirmation: false,
      impactLevel: 'LOW',
      reasoning: `Routed to NEXUS general handler (${wordCount}-word input, no strong keyword match)`,
      intentType,
    }
  }

  // Very short input with no matches — still try Claude
  try {
    console.log('[Classifier] Short input Claude fallback')
    const shortResult = await tier3ClaudeFallback(message, memoryContext, conversationHistory)
    return { ...shortResult, intentType }
  } catch (error) {
    console.error('[Classifier] All classification failed:', error)
    return {
      category: 'general',
      targetAgent: 'nexus',
      confidence: 0.3,
      entities: [],
      requiresConfirmation: false,
      impactLevel: 'LOW',
      reasoning: 'Routed to NEXUS for general assistance.',
      intentType,
    }
  }
}
