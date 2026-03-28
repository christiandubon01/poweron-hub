// @ts-nocheck
/**
 * PULSE Orchestrator — Main entry point for financial intelligence requests
 *
 * Actions:
 * - get_kpis: Current week financial metrics
 * - get_cash_flow: 12-week cash flow forecast
 * - get_trends: Financial trend analysis
 * - get_ar_aging: Accounts receivable breakdown
 *
 * Uses Claude API to generate natural language insights from structured data
 */

import { PULSE_SYSTEM_PROMPT } from './systemPrompt'
import { calculateWeeklyKPIs, calculateARaging, generateCashFlowForecast, getHistoricalRevenue } from './kpiCalculator'
import { analyzeTrends } from './trendAnalyzer'
import { logAudit } from '@/lib/memory/audit'

// ── Types ────────────────────────────────────────────────────────────────────

export type PulseAction = 'get_kpis' | 'get_cash_flow' | 'get_trends' | 'get_ar_aging'

export interface PulseRequest {
  action: PulseAction
  orgId: string
  userId: string
  context?: string
}

export interface PulseResponse {
  action: PulseAction
  data: unknown
  summary: string
  timestamp: string
}

// ── Pulse Orchestrator ──────────────────────────────────────────────────────

/**
 * Main PULSE request processor
 * Executes action, fetches data, and generates Claude-enhanced summary
 */
export async function processPulseRequest(request: PulseRequest): Promise<PulseResponse> {
  const startTime = Date.now()

  try {
    let data: unknown
    let summary: string

    switch (request.action) {
      case 'get_kpis':
        data = await calculateWeeklyKPIs(request.orgId)
        summary = await generateKPISummary(data, request.context)
        break

      case 'get_ar_aging':
        data = await calculateARaging(request.orgId)
        summary = await generateARAugingSummary(data, request.context)
        break

      case 'get_cash_flow':
        data = await generateCashFlowForecast(request.orgId, 12)
        summary = await generateCashFlowSummary(data, request.context)
        break

      case 'get_trends':
        data = await Promise.all([
          analyzeTrends(request.orgId, 'revenue', 12),
          analyzeTrends(request.orgId, 'margin', 12),
          analyzeTrends(request.orgId, 'active_projects', 12),
        ])
        summary = await generateTrendsSummary(data, request.context)
        break

      default:
        throw new Error(`Unknown PULSE action: ${request.action as never}`)
    }

    // Log audit trail
    await logAudit({
      orgId: request.orgId,
      actorType: 'agent',
      actorId: 'pulse',
      action: 'fetch',
      entityType: 'financial_metric',
      description: `PULSE executed ${request.action}`,
      metadata: { action: request.action, duration: Date.now() - startTime },
    })

    return {
      action: request.action,
      data,
      summary,
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[PULSE] processPulseRequest error:', error)

    // Log error
    await logAudit({
      orgId: request.orgId,
      actorType: 'agent',
      actorId: 'pulse',
      action: 'error',
      entityType: 'financial_metric',
      description: `PULSE error on ${request.action}`,
      metadata: { error: String(error) },
    })

    throw error
  }
}

// ── Claude Summary Generators ────────────────────────────────────────────────

/**
 * Generate KPI summary via Claude API
 */
async function generateKPISummary(data: unknown, context?: string): Promise<string> {
  try {
    const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

    const userPrompt = `Here are this week's financial KPIs:

${JSON.stringify(data, null, 2)}

${context ? `Additional context: ${context}` : ''}

Provide a concise 2-3 sentence executive summary highlighting:
1. Overall financial health
2. Key metrics (revenue, AR status, margin)
3. Any urgent action items or alerts

Be direct, data-driven, and actionable.`

    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: PULSE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
    const textContent = result.content?.find(c => c.type === 'text')
    return textContent?.text ?? 'Summary generation failed.'
  } catch (error) {
    console.error('[PULSE] generateKPISummary error:', error)
    return 'Unable to generate summary at this time.'
  }
}

/**
 * Generate AR Aging summary via Claude API
 */
async function generateARAugingSummary(data: unknown, context?: string): Promise<string> {
  try {
    const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

    const userPrompt = `Here is the AR aging breakdown:

${JSON.stringify(data, null, 2)}

${context ? `Additional context: ${context}` : ''}

Provide a concise 2-3 sentence summary of:
1. Overall AR health
2. Which bucket (if any) needs immediate attention
3. Recommended next step (follow-up call, escalation, etc.)

Be direct and actionable.`

    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: PULSE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
    const textContent = result.content?.find(c => c.type === 'text')
    return textContent?.text ?? 'Summary generation failed.'
  } catch (error) {
    console.error('[PULSE] generateARAugingSummary error:', error)
    return 'Unable to generate summary at this time.'
  }
}

/**
 * Generate Cash Flow summary via Claude API
 */
async function generateCashFlowSummary(data: unknown, context?: string): Promise<string> {
  try {
    const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

    const userPrompt = `Here is the 12-week cash flow forecast:

${JSON.stringify(data, null, 2)}

${context ? `Additional context: ${context}` : ''}

Provide a concise 2-3 sentence summary including:
1. Net cash position outlook (positive/negative)
2. Week(s) of concern (if any)
3. Recommendation (any actions needed to manage cash flow)

Be direct and specific about timing.`

    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: PULSE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
    const textContent = result.content?.find(c => c.type === 'text')
    return textContent?.text ?? 'Summary generation failed.'
  } catch (error) {
    console.error('[PULSE] generateCashFlowSummary error:', error)
    return 'Unable to generate summary at this time.'
  }
}

/**
 * Generate Trends summary via Claude API
 */
async function generateTrendsSummary(data: unknown, context?: string): Promise<string> {
  try {
    const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY as string

    const userPrompt = `Here are the financial trends over the past 12 weeks:

${JSON.stringify(data, null, 2)}

${context ? `Additional context: ${context}` : ''}

Provide a concise 2-3 sentence summary of:
1. Overall trend direction (positive/negative/mixed)
2. Most important trend to watch
3. One key action or strategy based on these trends

Be insightful and forward-looking.`

    const response = await fetch('/api/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: PULSE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const result = (await response.json()) as { content?: Array<{ type: string; text: string }> }
    const textContent = result.content?.find(c => c.type === 'text')
    return textContent?.text ?? 'Summary generation failed.'
  } catch (error) {
    console.error('[PULSE] generateTrendsSummary error:', error)
    return 'Unable to generate summary at this time.'
  }
}
