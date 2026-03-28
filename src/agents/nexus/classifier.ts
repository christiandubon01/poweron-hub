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

export type IntentCategory   = typeof INTENT_CATEGORIES[number]
export type TargetAgent      = typeof TARGET_AGENTS[number]
export type ImpactLevel      = typeof IMPACT_LEVELS[number]

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
    }
  }
}

// ── Classifier ──────────────────────────────────────────────────────────────

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

/**
 * Classify a user message into an intent with agent routing.
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
  const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

  if (!ANTHROPIC_API_KEY) {
    throw new Error('VITE_ANTHROPIC_API_KEY is not set. Add it to .env.local.')
  }

  // Build conversation context for the classifier
  const historyText = conversationHistory
    .slice(-6)  // Last 6 messages for context
    .map(m => `${m.role === 'user' ? 'User' : `Assistant (${m.agentId ?? 'nexus'})`}: ${m.content}`)
    .join('\n')

  const userPrompt = [
    memoryContext ? `## Active Context\n${memoryContext}\n` : '',
    historyText ? `## Recent Conversation\n${historyText}\n` : '',
    `## New Message\n${message}`,
  ].filter(Boolean).join('\n')

  const response = await fetch('/api/anthropic/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 512,
      system:     CLASSIFIER_PROMPT,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Classifier API call failed: ${response.status} ${errText}`)
  }

  const data = await response.json() as {
    content: Array<{ type: string; text: string }>
  }

  const rawText = data.content[0]?.text ?? ''

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
    // Return a safe fallback — route to NEXUS with low confidence
    return {
      category:             'general',
      targetAgent:          'nexus',
      confidence:           0.3,
      entities:             [],
      requiresConfirmation: false,
      impactLevel:          'LOW',
      reasoning:            `Classification validation failed: ${result.error}. Falling back to NEXUS.`,
    }
  }

  return result.data
}
