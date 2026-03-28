// @ts-nocheck
/**
 * AskAIPanel — Shared "Ask AI" slide-in panel for contextual insights.
 * Real Claude API integration — calls NEXUS with panel-specific data context.
 * AI suggests, user confirms. No auto-save. No auto-apply.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Zap, X, Sparkles, Loader2, RefreshCw } from 'lucide-react'

export interface Insight {
  icon: string
  text: string
  severity: 'info' | 'warning' | 'success'
}

interface AskAIPanelProps {
  panelName: string
  /** Optional pre-computed rule-based insights (legacy fallback) */
  insights?: Insight[]
  /** Panel-specific data context — when provided, triggers Claude API call */
  dataContext?: Record<string, unknown>
  isOpen: boolean
  onClose: () => void
}

// ── Response cache (5 min TTL) ──────────────────────────────────────────────

interface CacheEntry {
  insights: Insight[]
  timestamp: number
}

const CACHE_TTL_MS = 5 * 60 * 1000
const responseCache = new Map<string, CacheEntry>()

function getCacheKey(panelName: string, dataContext: Record<string, unknown>): string {
  return panelName + '::' + JSON.stringify(dataContext)
}

function getCachedResponse(key: string): Insight[] | null {
  const entry = responseCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key)
    return null
  }
  return entry.insights
}

function setCachedResponse(key: string, insights: Insight[]): void {
  responseCache.set(key, { insights, timestamp: Date.now() })
}

// ── Claude API System Prompt ────────────────────────────────────────────────

const NEXUS_SYSTEM_PROMPT = `You are NEXUS, an AI assistant for Power On Solutions LLC, a C-10 electrical contractor in the Coachella Valley. You analyze operational data and provide specific, actionable insights. Be direct and concise. Focus on: cash flow risks, job profitability, scheduling conflicts, lead follow-up urgency, and compliance flags.

Respond with a JSON array of insight objects. Each object must have:
- "icon": a single emoji representing the insight type
- "text": a concise 1-2 sentence insight
- "severity": one of "info", "warning", or "success"

Return ONLY the JSON array, no other text. Return 3-6 insights.`

// ── Parse Claude response into Insight[] ────────────────────────────────────

function parseClaudeInsights(text: string): Insight[] {
  try {
    const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((i: any) => i && typeof i.text === 'string')
      .map((i: any) => ({
        icon: typeof i.icon === 'string' ? i.icon : 'ℹ️',
        text: i.text,
        severity: ['info', 'warning', 'success'].includes(i.severity) ? i.severity : 'info',
      }))
  } catch {
    return [{ icon: 'ℹ️', text: text.slice(0, 300), severity: 'info' as const }]
  }
}

// ── Component ───────────────────────────────────────────────────────────────

export function AskAIPanel({ panelName, insights, dataContext, isOpen, onClose }: AskAIPanelProps) {
  const [claudeInsights, setClaudeInsights] = useState<Insight[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const fetchClaudeInsights = useCallback(async (force = false) => {
    if (!dataContext) return

    const cacheKey = getCacheKey(panelName, dataContext)

    // Check cache first (unless forced)
    if (!force) {
      const cached = getCachedResponse(cacheKey)
      if (cached) {
        setClaudeInsights(cached)
        setError('')
        return
      }
    }

    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
    if (!apiKey) {
      setError('API key not configured (VITE_ANTHROPIC_API_KEY)')
      return
    }

    // Abort previous in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError('')

    try {
      const userMessage = `Panel: ${panelName}\n\nCurrent operational data:\n${JSON.stringify(dataContext, null, 2)}\n\nAnalyze this data and provide actionable insights.`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: NEXUS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`API error (${response.status}): ${errText.slice(0, 200)}`)
      }

      const result = await response.json()
      const text = result.content?.[0]?.text || ''
      const parsed = parseClaudeInsights(text)

      if (parsed.length === 0) {
        throw new Error('No insights returned')
      }

      setClaudeInsights(parsed)
      setCachedResponse(cacheKey, parsed)
      setError('')
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [panelName, dataContext])

  // Fetch when panel opens with data context
  useEffect(() => {
    if (isOpen && dataContext) {
      fetchClaudeInsights()
    }
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [isOpen, fetchClaudeInsights])

  if (!isOpen) return null

  // Determine which insights to display
  const displayInsights = claudeInsights || insights || []
  const isClaudeMode = !!dataContext

  return (
    <div className="fixed right-0 top-12 bottom-0 w-80 bg-[#0f1117] border-l border-purple-500/30 z-40 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-400" />
          <span className="text-sm font-semibold text-purple-300">NEXUS Analysis</span>
        </div>
        <div className="flex items-center gap-2">
          {isClaudeMode && !loading && (
            <button
              onClick={() => fetchClaudeInsights(true)}
              className="text-gray-500 hover:text-purple-400 transition-colors"
              title="Refresh analysis"
            >
              <RefreshCw size={14} />
            </button>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Context label */}
      <div className="px-4 py-2 bg-purple-500/5 border-b border-gray-800">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">
          {panelName} Analysis {isClaudeMode ? '· Claude AI' : '· Rule-based'}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 size={24} className="text-purple-400 animate-spin" />
            <p className="text-xs text-gray-500">Analyzing {panelName.toLowerCase()} data...</p>
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="rounded-lg p-3 text-xs border bg-red-500/5 border-red-500/20">
            <p className="text-red-400 mb-2">{error}</p>
            <button
              onClick={() => fetchClaudeInsights(true)}
              className="text-xs px-3 py-1 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Insights */}
        {!loading && !error && displayInsights.map((insight, i) => (
          <div key={i} className={`rounded-lg p-3 text-xs border ${
            insight.severity === 'warning' ? 'bg-yellow-500/5 border-yellow-500/20 text-yellow-300' :
            insight.severity === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300' :
            'bg-blue-500/5 border-blue-500/20 text-blue-300'
          }`}>
            <span className="mr-1">{insight.icon}</span> {insight.text}
          </div>
        ))}

        {/* Empty state */}
        {!loading && !error && displayInsights.length === 0 && (
          <p className="text-xs text-gray-600 text-center py-4">No insights available for this view.</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-800 text-[9px] text-gray-600">
        AI suggestions only — review before acting. No changes applied automatically.
      </div>
    </div>
  )
}

export function AskAIButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors"
    >
      <Zap size={12} />
      Ask AI
    </button>
  )
}
