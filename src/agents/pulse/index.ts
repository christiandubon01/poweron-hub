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
import { getBackupData } from '@/services/backupDataService'
import { subscribe, type AgentMessage } from '@/services/agentBus'

// ── Local Backup Weekly Context ──────────────────────────────────────────────

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

/**
 * Read backup.logs + backup.serviceLogs grouped by ISO week.
 * Returns a context string: "This week: $X | Last week: $Y | 4-week avg: $Z"
 */
function getLocalWeeklyContext(): string {
  const backup = getBackupData()
  if (!backup) return ''

  const allLogs = [
    ...(Array.isArray(backup.logs) ? backup.logs : []),
    ...(Array.isArray(backup.serviceLogs) ? backup.serviceLogs : []),
  ]
  if (allLogs.length === 0) return ''

  function isoWeek(dateStr: string): string {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    const jan1 = new Date(d.getFullYear(), 0, 1)
    const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
    return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
  }

  const weekBuckets = new Map<string, number>()
  for (const log of allLogs) {
    const dateStr: string = (log as any).date || ''
    if (!dateStr) continue
    const wk = isoWeek(dateStr)
    if (!wk) continue
    const collected = num((log as any).collected)
    weekBuckets.set(wk, (weekBuckets.get(wk) || 0) + collected)
  }

  const sortedWeeks = Array.from(weekBuckets.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  const thisWeek = sortedWeeks[0]?.[1] ?? 0
  const lastWeek = sortedWeeks[1]?.[1] ?? 0
  const last4 = sortedWeeks.slice(0, 4).map(([, v]) => v)
  const avg4 = last4.length ? last4.reduce((s, v) => s + v, 0) / last4.length : 0

  return `This week: $${thisWeek.toLocaleString()} | Last week: $${lastWeek.toLocaleString()} | 4-week avg: $${Math.round(avg4).toLocaleString()}`
}

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
    const ANTHROPIC_API_KEY = (import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : '') as string

    // Enrich with real local device data (source of truth)
    const localWeeklyCtx = getLocalWeeklyContext()

    const userPrompt = `Here are this week's financial KPIs:

${JSON.stringify(data, null, 2)}

${localWeeklyCtx ? `## Weekly Revenue (from device state)\n${localWeeklyCtx}\n` : ''}
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
    const ANTHROPIC_API_KEY = (import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : '') as string

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
    const ANTHROPIC_API_KEY = (import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : '') as string

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
    const ANTHROPIC_API_KEY = (import.meta.env.DEV ? import.meta.env.VITE_ANTHROPIC_API_KEY : '') as string

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

// ── SPARK → PULSE Integration ──────────────────────────────────────────────

/**
 * Subscribe to SPARK campaign results and add to financial dashboard.
 * Called once at app startup.
 */
export function initPulseSparkSubscription(): void {
  try {
    const { subscribe } = require('@/services/agentEventBus')

    subscribe('CAMPAIGN_RESULT' as any, (event: any) => {
      console.log('[PULSE] Received CAMPAIGN_RESULT from SPARK:', event.summary)

      // Store campaign metrics for dashboard access
      try {
        const raw = localStorage.getItem('pulse_campaign_metrics') || '[]'
        const metrics = JSON.parse(raw)
        metrics.push({
          timestamp: event.timestamp,
          channel: event.payload?.channel || 'unknown',
          leadsGenerated: event.payload?.leadsGenerated || 0,
          revenueAttributed: event.payload?.revenueAttributed || 0,
          recipients: event.payload?.recipients || 0,
        })
        // Keep last 100 entries
        if (metrics.length > 100) metrics.splice(0, metrics.length - 100)
        localStorage.setItem('pulse_campaign_metrics', JSON.stringify(metrics))
      } catch { /* ignore */ }
    })

    console.log('[PULSE] Subscribed to SPARK CAMPAIGN_RESULT events')
  } catch (err) {
    console.warn('[PULSE] Failed to subscribe to SPARK events:', err)
  }
}

/**
 * Get campaign metrics for dashboard display.
 */
export function getCampaignMetrics(): Array<{
  timestamp: number
  channel: string
  leadsGenerated: number
  revenueAttributed: number
  recipients: number
}> {
  try {
    const raw = localStorage.getItem('pulse_campaign_metrics') || '[]'
    return JSON.parse(raw)
  } catch { return [] }
}

// ── AgentBus Subscriptions ───────────────────────────────────────────────────

/**
 * _pulseRefreshCallbacks — External components register here to be notified
 * when PULSE receives a bus update (e.g. NexusChatPanel refreshes KPI cards).
 */
const _pulseRefreshCallbacks = new Set<(event: string, payload: Record<string, unknown>) => void>()

/**
 * onPulseRefresh — Register a callback for when PULSE receives an agentBus update.
 * Returns an unsubscribe function.
 */
export function onPulseRefresh(
  cb: (event: string, payload: Record<string, unknown>) => void
): () => void {
  _pulseRefreshCallbacks.add(cb)
  return () => _pulseRefreshCallbacks.delete(cb)
}

function _notifyPulseRefresh(event: string, payload: Record<string, unknown>): void {
  for (const cb of _pulseRefreshCallbacks) {
    try { cb(event, payload) } catch { /* ignore */ }
  }
}

/**
 * initPulseBusSubscriptions — Subscribe PULSE to agentBus messages from
 * VAULT, BLUEPRINT, and LEDGER. Call once on app startup.
 *
 * On receiving data_updated messages, PULSE fires refresh callbacks so
 * dashboard components can re-query KPIs without a full page reload.
 */
export function initPulseBusSubscriptions(): () => void {
  const unsub = subscribe('PULSE', (msg: AgentMessage) => {
    if (msg.type !== 'data_updated') return

    const event = (msg.payload?.event as string) || msg.type

    console.log(`[PULSE] AgentBus update from ${msg.from}: ${event}`)

    // Notify registered dashboard components to refresh
    _notifyPulseRefresh(event, msg.payload)
  })

  console.log('[PULSE] AgentBus subscriptions initialized')
  return unsub
}
