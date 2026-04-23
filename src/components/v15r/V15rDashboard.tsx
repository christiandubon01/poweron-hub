// PowerOn Hub V3 — build cache bust April 2026
// @ts-nocheck
/**
 * V15rDashboard — Graph Dashboard with pure SVG React charts
 * Zero external chart dependencies — eliminates all TDZ/bundler conflicts
 * Session 7: Chart Families Reorganization — 5 collapsible family sections
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
// Inline SVG icons — avoids lucide-react import which causes TDZ in Vite 5 production
function BarChart3Icon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M3 3v18h18"/><path d="M13 17V9"/><path d="M18 17V5"/><path d="M8 17v-3"/></svg>
}
function BrainIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M12 18v-5"/></svg>
}
import { getBackupData, getProjectFinancials, health, num, fmtK, type BackupData } from '@/services/backupDataService'
// BUG 2 FIX — Active-only pipeline formula (replaces calcPipeline which included 'coming')
import { calcActivePipeline } from '@/utils/pipelineCalc'
// BUG 3 FIX — Canonical project financials
import { calculateProjectFinancials, calculatePortfolioFinancials } from '@/utils/calculateProjectFinancials'
import { BarChart, Bar, XAxis as RXAxis, YAxis as RYAxis, CartesianGrid as RCGrid, Tooltip as RTooltip, Legend as RLegend, ResponsiveContainer as RRC } from 'recharts'
import { callClaude, extractText } from '@/services/claudeProxy'
// SVGCharts kept as reference only — use individual Recharts chart files below
import Charts from './charts/SVGCharts'
// Individual Recharts-based chart components (fixed projId bug, scroll-to-zoom, full-width)
import CFOTChartR from './charts/CFOTChart'
import EVRChartR from './charts/EVRChart'
import RCAChartR from './charts/RCAChart'
import PvAChartR from './charts/PvAChart'
import OPPChartR from './charts/OPPChart'
import PCDChartR from './charts/PCDChart'
import SCPChartR from './charts/SCPChart'
import LaborTrendChart from './charts/LaborTrendChart'
import SixMonthForecastChart from './charts/SixMonthForecastChart'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
// Keep SVG chart destructures for charts that have no Recharts alternative (Gantt, Monthly Revenue, QuoteVsActual)
var { MonthlyRevenueChart, ProjectTimelineChart, QuoteVsActualChart, CashFlowProjectionChart } = Charts
import {
  query8WeekCashFlow,
  queryMonthlyRevenue,
  queryOverlapWindows,
  queryGanttData,
  queryAllQuoteVsActual,
  getDailyTarget,
} from '@/services/revenueTimelineQueries'

// ── NEXUS AI DASHBOARD ANALYZER ──
interface NEXUSAnalysis {
  loading: boolean
  error?: string
  analysis?: string
  bullets?: Array<{ icon: string; text: string; priority: 'high' | 'medium' | 'low' }>
}

interface NEXUSChatEntry {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// Parse **bold** markdown and color-code by keyword
function NEXUSRichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  const keywordBorder = (t: string): string => {
    const upper = t.toUpperCase()
    if (upper.includes('CRITICAL')) return '#ef4444'
    if (upper.includes('HIGH RISK')) return '#f97316'
    if (upper.includes('ATTENTION')) return '#eab308'
    if (upper.includes('HEALTHY')) return '#10b981'
    return ''
  }
  const border = keywordBorder(text)
  return (
    <span style={{ borderLeft: border ? `3px solid ${border}` : 'none', paddingLeft: border ? '6px' : '0' }}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**')
          ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <span key={i}>{p}</span>
      )}
    </span>
  )
}

function NEXUSDashboardAnalyzer({ backup, cfotSummary, projects }: {
  backup: BackupData
  cfotSummary: { exposure: number; unbilled: number; pending: number; svcTotal: number; projTotal: number; accumTotal: number }
  projects: any[]
}) {
  const [state, setState] = useState<NEXUSAnalysis>({ loading: true })
  const [chatOpen, setChatOpen] = useState(false)
  const [chatHistory, setChatHistory] = useState<NEXUSChatEntry[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatScrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [chatHistory])

  const handleChatSend = async () => {
    const trimmed = chatInput.trim()
    if (!trimmed || chatLoading) return
    setChatInput('')
    setChatLoading(true)
    const userEntry: NEXUSChatEntry = { role: 'user', content: trimmed, timestamp: Date.now() }
    const updated = [...chatHistory, userEntry]
    setChatHistory(updated)
    try {
      const result = await callClaude({
        system: 'You are NEXUS, the AI dashboard analyzer for Power On Solutions. Continue the analysis conversation. Be concise and actionable.',
        messages: [
          { role: 'assistant' as const, content: state.analysis || 'Dashboard analysis unavailable.' },
          ...updated.map(e => ({ role: e.role as 'user' | 'assistant', content: e.content })),
        ],
        max_tokens: 1024,
      })
      const responseText = extractText(result)
      setChatHistory(prev => [...prev, { role: 'assistant', content: responseText, timestamp: Date.now() }])
    } catch (err) {
      setChatHistory(prev => [...prev, { role: 'assistant', content: 'Error: ' + String(err), timestamp: Date.now() }])
    } finally {
      setChatLoading(false)
    }
  }

  useEffect(() => {
    const analyze = async () => {
      try {
        setState({ loading: true })

        // Pre-calculate accurate values — active = status === 'active' ONLY
        const activeProjects = projects.filter(p => p.status === 'active')
        // BUG 2 FIX — Pipeline = active projects ONLY + uncollected service balances
        // (removed 'coming' from pipeline per owner spec)
        const activeContractTotal = activeProjects.reduce((s: number, p: any) => s + num(p.contract), 0)
        const totalARExposure = activeProjects.reduce((s: number, p: any) => s + Math.max(0, num(p.contract) - num(p.paid)), 0)
        const totalCollected = activeProjects.reduce((s: number, p: any) => s + num(p.paid), 0)
        const totalBilled = activeProjects.reduce((s: number, p: any) => s + num(p.billed), 0)
        const totalUnbilledInvoiced = activeProjects.reduce((s: number, p: any) => s + Math.max(0, num(p.billed) - num(p.paid)), 0)
        // BUG 2 FIX — use calcActivePipeline (active ONLY + open service balances)
        const pipelineTotal = calcActivePipeline(projects, backup.serviceLogs || [])

        // BUG 3 FIX — Canonical project financials using calculatePortfolioFinancials
        const mileRate = num(backup?.settings?.mileRate) || 0.66
        const portfolioFin = calculatePortfolioFinancials(activeProjects, backup.logs || [], mileRate)

        // Per-project detail for active projects (include canonical balance)
        const activeProjectDetails = activeProjects.map(p => {
          const fin = calculateProjectFinancials(p, backup.logs || [], mileRate, Number(backup?.settings?.opCost) || 55)
          return {
            name: p.name,
            contract: num(p.contract),
            paid: num(p.paid),
            billed: num(p.billed),
            arExposure: Math.max(0, num(p.contract) - num(p.paid)),
            // BUG 3 — canonical fields
            remaining_balance: fin.remaining_balance,
            total_costs: fin.total_costs,
            total_collected: fin.total_collected,
          }
        })

        // Service logs — use collected (actual revenue), not quoted
        const recentSvcLogs = (backup.serviceLogs || []).slice(-5).map((l: any) => ({
          date: l.date,
          customer: l.customer,
          collected: num(l.collected),
          quoted: num(l.quoted),
          type: l.jtype,
        }))
        const svcTotalCollected = (backup.serviceLogs || []).reduce((s: number, l: any) => s + num(l.collected), 0)

        const dashboardContext = {
          definitions: 'Active projects = status === active ONLY (not coming/pending). Pipeline = active project contracts + open service call balances. Remaining balance = quote minus total costs (labor+material+transport), NOT quote minus collected. Collected is tracked separately. These values are pre-calculated — do not recalculate them.',
          activeProjectCount: activeProjects.length,
          activeContractTotal,
          totalARExposure,
          totalCollected,
          totalBilled,
          totalUnbilledInvoiced,
          pipelineTotal,
          serviceLogRevenue: svcTotalCollected,
          activeProjectDetails,
          recentServiceLogs: recentSvcLogs,
          weeklyData: (backup.weeklyData || []).slice(-4),
          // BUG 3 — portfolio-level canonical financials
          portfolioRemainingBalance: portfolioFin.remaining_balance,
          portfolioTotalCosts: portfolioFin.total_costs,
          portfolioTotalCollected: portfolioFin.total_collected,
        }

        const response = await callClaude({
          system: 'You are NEXUS, the AI dashboard analyzer for Power On Solutions. Analyze financial dashboard data and provide 3-5 priority-scored bullet points (🔴 high risk, 🟡 medium attention, 🟢 healthy). Be concise and actionable. Use the pre-calculated values provided — do not recalculate them.',
          messages: [{
            role: 'user',
            content: `Analyze this dashboard data and identify key risk items, projects needing attention, and healthy indicators:\n${JSON.stringify(dashboardContext, null, 2)}`
          }],
          max_tokens: 1024,
        })

        const text = extractText(response)
        // Parse bullet points with icons
        const bullets = text
          .split('\n')
          .filter((line: string) => line.match(/^[🔴🟡🟢]/))
          .map((line: string) => {
            const match = line.match(/^([🔴🟡🟢])\s*(.+)/)
            if (!match) return null
            const iconMap = { '🔴': 'high', '🟡': 'medium', '🟢': 'low' }
            return {
              icon: match[1],
              text: match[2].trim(),
              priority: iconMap[match[1] as keyof typeof iconMap] || 'medium'
            }
          })
          .filter(Boolean)

        setState({ loading: false, analysis: text, bullets: bullets.length > 0 ? bullets : undefined })
      } catch (err) {
        setState({ loading: false, error: (err as any)?.message || 'Analysis failed' })
      }
    }

    analyze()
  }, [backup, cfotSummary, projects])

  if (state.loading) {
    return (
      <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 animate-pulse">
        <div className="flex items-center gap-2 mb-4">
          <BrainIcon size={24} className="text-purple-400" />
          <h2 className="text-[26px] font-bold text-gray-100">NEXUS Dashboard Analysis</h2>
        </div>
        <div className="h-20 bg-gray-700 rounded"></div>
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BrainIcon size={24} className="text-purple-400" />
          <h2 className="text-[26px] font-bold text-gray-100">NEXUS Dashboard Analysis</h2>
        </div>
        <p className="text-red-400 text-sm">{state.error}</p>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BrainIcon size={24} className="text-purple-400" />
          <h2 className="text-[26px] font-bold text-gray-100">NEXUS Dashboard Analysis</h2>
        </div>
        <button
          onClick={() => setChatOpen(!chatOpen)}
          className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded transition-colors"
        >
          {chatOpen ? 'Close Chat' : 'Open Analysis Chat'}
        </button>
      </div>

      <div className="space-y-2">
        {state.bullets ? (
          state.bullets.map((b, i) => {
            const borderClr = b.priority === 'high' ? '#ef4444' : b.priority === 'medium' ? '#f97316' : '#10b981'
            return (
              <div key={i} className="flex gap-3 text-sm text-gray-300 rounded px-2 py-1.5" style={{ borderLeft: `3px solid ${borderClr}` }}>
                <span className="text-lg flex-shrink-0">{b.icon}</span>
                <NEXUSRichText text={b.text} />
              </div>
            )
          })
        ) : (
          <div className="text-gray-400 text-sm">
            {state.analysis ? <NEXUSRichText text={state.analysis} /> : null}
          </div>
        )}
      </div>

      {/* Persistent Analysis Chat */}
      {chatOpen && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div ref={chatScrollRef} className="max-h-72 overflow-y-auto space-y-2 mb-3 pr-1">
            {chatHistory.length === 0 && (
              <p className="text-gray-500 text-xs italic">Ask a follow-up question about your dashboard data...</p>
            )}
            {chatHistory.map((entry, i) => (
              <div key={i} style={{ marginBottom: '6px' }}>
                <div className="text-[10px] text-gray-600 mb-0.5">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                <div className="text-xs leading-relaxed" style={{ color: entry.role === 'user' ? '#e5e7eb' : '#d1d5db' }}>
                  <span style={{ fontWeight: 700, color: entry.role === 'user' ? '#fff' : '#a855f7' }}>
                    {entry.role === 'user' ? 'You: ' : 'NEXUS: '}
                  </span>
                  {entry.role === 'assistant' ? <NEXUSRichText text={entry.content} /> : entry.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="text-purple-400 text-xs animate-pulse">NEXUS is thinking...</div>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleChatSend()}
              placeholder="Ask NEXUS about your dashboard..."
              className="flex-1 px-3 py-2 bg-[var(--bg-secondary)] border border-gray-600 rounded text-xs text-gray-200 outline-none"
            />
            <button
              onClick={handleChatSend}
              disabled={chatLoading || !chatInput.trim()}
              className="px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── G6: PULSE "Analyze Trends" — 1-hour cached AI trend analysis ──
var PULSE_CACHE_KEY = 'pulse_trend_analysis_cache'
var PULSE_CACHE_TTL = 60 * 60 * 1000 // 1 hour

function PulseTrendAnalyzer({ backup, cfotSummary, projects }: {
  backup: BackupData
  cfotSummary: { exposure: number; unbilled: number; pending: number; svcTotal: number; projTotal: number; accumTotal: number }
  projects: any[]
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cached, setCached] = useState(false)

  // Load cached result on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PULSE_CACHE_KEY)
      if (raw) {
        const { text, ts } = JSON.parse(raw)
        if (Date.now() - ts < PULSE_CACHE_TTL) {
          setResult(text)
          setCached(true)
        }
      }
    } catch {}
  }, [])

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      // Collect last 30 days of CFOT + revenue data
      const now = new Date()
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      const recentWeekly = (backup.weeklyData || []).filter((w: any) => {
        if (!w.start) return false
        return new Date(w.start + 'T00:00:00') >= thirtyDaysAgo
      })
      const recentSvcLogs = (backup.serviceLogs || []).filter((l: any) => {
        if (!l.date) return false
        return new Date(l.date + 'T00:00:00') >= thirtyDaysAgo
      })

      const summary = [
        `Date: ${now.toLocaleDateString()}`,
        `Active Projects: ${projects.filter(p => p.status === 'active').length}`,
        `Total Exposure: $${cfotSummary.exposure.toLocaleString()}`,
        `Unbilled AR: $${cfotSummary.unbilled.toLocaleString()}`,
        `Pending Collections: $${cfotSummary.pending.toLocaleString()}`,
        `Service Revenue (all time): $${cfotSummary.svcTotal.toLocaleString()}`,
        `Project Revenue (all time): $${cfotSummary.projTotal.toLocaleString()}`,
        `Accumulative Income: $${cfotSummary.accumTotal.toLocaleString()}`,
        '',
        `Last 30 days — ${recentWeekly.length} weekly rows:`,
        ...recentWeekly.map((w: any) => `  Wk${w.wk || '?'} (${w.start || 'N/A'}): proj=$${num(w.proj)}, svc=$${num(w.svc)}, accum=$${num(w.accum)}`),
        '',
        `Last 30 days — ${recentSvcLogs.length} service calls:`,
        ...recentSvcLogs.slice(0, 10).map((l: any) => `  ${l.date}: ${l.customer || 'Unknown'} quoted=$${num(l.quoted)} collected=$${num(l.collected)}`),
      ].join('\n')

      const response = await callClaude({
        system: 'You are PULSE, a financial analyst for Power On Solutions LLC. Analyze these metrics and give Christian a 3-bullet plain-English summary of the trend, one risk, and one opportunity. Use emojis for bullets: 📈 trend, ⚠️ risk, 💡 opportunity. Be specific and concise.',
        messages: [{ role: 'user' as const, content: `Analyze my last 30 days of business metrics:\n\n${summary}` }],
        max_tokens: 800,
      })
      const text = extractText(response)
      setResult(text)
      setCached(false)
      // Cache result for 1 hour
      try {
        localStorage.setItem(PULSE_CACHE_KEY, JSON.stringify({ text, ts: Date.now() }))
      } catch {}
    } catch (err) {
      setError((err as any)?.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-blue-900/40 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📊</span>
          <div>
            <h2 className="text-xl font-bold text-blue-300">PULSE — Trend Analyzer</h2>
            <p className="text-xs text-gray-500">Last 30 days · CFOT + Revenue · 1-hour cache</p>
          </div>
        </div>
        <button
          onClick={runAnalysis}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors min-h-[44px] px-4"
        >
          {loading ? '⏳ Analyzing...' : '🔍 Analyze trends'}
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded p-3">{error}</div>
      )}

      {result && (
        <div className="space-y-2">
          {cached && <p className="text-[10px] text-gray-600 italic">Cached result · click "Analyze trends" to refresh</p>}
          {result.split('\n').filter(l => l.trim()).map((line, i) => (
            <div key={i} className="text-sm text-gray-300 py-1.5 px-2 rounded bg-[var(--bg-input)]">
              {line}
            </div>
          ))}
        </div>
      )}

      {!result && !loading && !error && (
        <p className="text-gray-500 text-sm">Click "Analyze trends" to get a PULSE analysis of your last 30 days.</p>
      )}
    </div>
  )
}

// ── CHART FAMILY — collapsible section with accent border ──
// Collapse state persisted to localStorage per family id
function ChartFamily({
  id,
  name,
  accent,
  chartCount,
  summaryLabel,
  summaryValue,
  children,
}: {
  id: string
  name: string
  accent: string
  chartCount: number
  summaryLabel: string
  summaryValue: string
  children: React.ReactNode
}) {
  const lsKey = 'chart_family_open_' + id
  const [open, setOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(lsKey)
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    try { localStorage.setItem(lsKey, String(next)) } catch {}
  }

  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Family Header — sticky on mobile */}
      <div
        onClick={toggle}
        className="flex items-center justify-between cursor-pointer px-5 py-4 rounded-t-lg"
        style={{
          borderLeft: '3px solid ' + accent,
          background: 'var(--bg-card)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div>
          {open ? (
            <>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>{name}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>{chartCount} chart{chartCount !== 1 ? 's' : ''}</div>
            </>
          ) : (
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>
              {name} <span style={{ color: accent, fontWeight: 400 }}>— {summaryLabel}: {summaryValue}</span>
            </div>
          )}
        </div>
        <span style={{ color: '#6b7280', fontSize: '13px', flexShrink: 0 }}>{open ? '▲ Collapse' : '▼ Expand'}</span>
      </div>

      {/* Charts container */}
      {open && (
        <div
          className="rounded-b-lg"
          style={{ border: '1px solid ' + accent + '33', borderTop: 'none', padding: '24px', background: 'var(--bg-secondary)' }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ── TEAM HOURS PERFORMANCE CHART ──
// Recharts bar chart showing hours logged per team member
// this week, this month, and rolling 12 weeks. Uses backup.logs[].emp + .hrs.
function TeamHoursChart({ backup }: { backup: BackupData }) {
  const logs = backup.logs || []
  const now = new Date(); now.setHours(0,0,0,0)
  const todayStr = now.toISOString().split('T')[0]

  // Week boundaries (Mon–Sun)
  const weekDay = now.getDay(); const diffToMon = weekDay === 0 ? -6 : 1 - weekDay
  const weekStart = new Date(now); weekStart.setDate(now.getDate() + diffToMon)
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6)
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // Month boundaries
  const monthStartStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const monthEndStr = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

  // 12-week boundary
  const twelveWeeksAgo = new Date(now); twelveWeeksAgo.setDate(now.getDate() - 83)
  const twelveWeeksStr = twelveWeeksAgo.toISOString().split('T')[0]

  // Accumulate hours per member
  const memberMap: Record<string, { thisWeek: number; thisMonth: number; rolling12: number }> = {}
  for (const log of logs) {
    const d = log.date || log.logDate || ''
    const hrs = (log.hrs || 0) as number
    if (!d || hrs <= 0) continue
    const member = (log.emp || log.empName || 'Owner').trim() || 'Owner'
    if (!memberMap[member]) memberMap[member] = { thisWeek: 0, thisMonth: 0, rolling12: 0 }
    if (d >= weekStartStr && d <= weekEndStr) memberMap[member].thisWeek += hrs
    if (d >= monthStartStr && d <= monthEndStr) memberMap[member].thisMonth += hrs
    if (d >= twelveWeeksStr && d <= todayStr) memberMap[member].rolling12 += hrs
  }

  const chartData = Object.entries(memberMap)
    .map(([name, v]) => ({ name, thisWeek: +v.thisWeek.toFixed(1), thisMonth: +v.thisMonth.toFixed(1), rolling12: +v.rolling12.toFixed(1) }))
    .sort((a, b) => b.rolling12 - a.rolling12)

  const MEMBER_COLORS = ['#3b82f6','#10b981','#f59e0b','#a855f7','#ef4444','#06b6d4','#84cc16']

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2" style={{ width: '100%', minWidth: 0 }}>
      <div className="mb-4">
        <h3 className="text-lg font-bold text-gray-100">Team Hours Performance</h3>
        <p className="text-xs text-gray-400 italic mt-0.5">
          Hours logged per team member — this week · this month · rolling 12 weeks · Logs without a name attributed to "Owner"
        </p>
      </div>
      {chartData.length > 0 ? (
        <div style={{ position: 'relative', width: '100%', minWidth: 0, height: '320px' }}>
          <RRC width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <RCGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <RXAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} />
              <RYAxis tickFormatter={(v) => `${v}h`} tick={{ fill: '#9ca3af', fontSize: 11 }} width={44} />
              <RTooltip
                contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }}
                formatter={(v: number, name: string) => [`${v}h`, name === 'thisWeek' ? 'This Week' : name === 'thisMonth' ? 'This Month' : 'Rolling 12wk']}
              />
              <RLegend wrapperStyle={{ color: '#d1d5db', fontSize: 12 }} />
              <Bar dataKey="thisWeek" name="This Week" fill="#3b82f6" opacity={0.85} radius={[3,3,0,0]} />
              <Bar dataKey="thisMonth" name="This Month" fill="#10b981" opacity={0.75} radius={[3,3,0,0]} />
              <Bar dataKey="rolling12" name="Rolling 12wk" fill="#f59e0b" opacity={0.65} radius={[3,3,0,0]} />
            </BarChart>
          </RRC>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-36 gap-2 text-center">
          <span className="text-gray-500 text-sm">No hours logged yet.</span>
          <span className="text-gray-600 text-xs">Log labor hours in Field Log to activate team tracking.</span>
        </div>
      )}
    </div>
  )
}

// ── StartDateWarningPill — DASHBOARD-START-DATE-GATE-APR22-2026-1 ──
// Flags projects that are active/coming but have no Start Date.
// Those projects are excluded from the historical CFOT chart entirely
// (see isProjectActiveAsOf). Pill is deterministic — no AI, no tokens.
// Logic must stay in sync with the gate's status filter and date fallback.
function StartDateWarningPill({ projects }: { projects: any[] }) {
  const [open, setOpen] = useState(false)
  const missing = (projects || []).filter(p => {
    // DASHBOARD-START-DATE-GATE-AND-PERSIST-APR22-2026-1 — must stay in sync with isProjectActiveAsOf
    const status = (p.status || '').toLowerCase()
    if (status === 'completed' || status === 'cancelled' || status === 'archived' || status === 'canceled') return false
    if (!p.plannedStart) return true
    const d = new Date(p.plannedStart)
    return isNaN(d.getTime())
  })
  if (missing.length === 0) return null
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-yellow-600/50 bg-yellow-900/20 text-yellow-300 text-xs font-medium hover:bg-yellow-900/30 transition-colors"
      >
        <span>⚠</span>
        <span>{missing.length} project{missing.length === 1 ? '' : 's'} missing Start Date — not shown on chart</span>
        <span className="text-yellow-500/70">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-2 px-3 py-2 rounded-md border border-yellow-600/30 bg-yellow-900/10 text-yellow-200/90 text-xs">
          <div className="mb-1 text-yellow-400/70 uppercase tracking-wide text-[10px] font-semibold">Set Start Date in Projects tab:</div>
          <ul className="space-y-0.5">
            {missing.map((p: any) => (
              <li key={p.id} className="flex justify-between gap-4">
                <span>{p.name || '(unnamed)'}</span>
                <span className="text-yellow-500/60">${(Number(p.contract) || 0).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── INNER DASHBOARD COMPONENT ──
function V15rDashboardInner() {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()

  if (!backup) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--bg-secondary)]">
        <p className="text-gray-400">No backup data available</p>
      </div>
    )
  }

  const projects = backup.projects || []
  const weeklyData = backup.weeklyData || []

  // ── CFOT: Cash Flow Over Time ──
  // Historical event-sourced exposure (DASHBOARD-EXPOSURE-EVENTS-APR21-2026-1).
  //
  //   Projects:
  //     collected(W)  = sum of log.collected (or log.paymentsCollected) dated ≤ W end for this project
  //     uncollected(W,p) = max(0, p.contract - collected(W,p)) for every project whose start is ≤ W end
  //                         and status != 'completed'/'cancelled' at W (or, if no completion date, still active)
  //
  //   Service logs (event-driven via statusEvents):
  //     Replay each log's events in chronological order, take the last event with date ≤ W end.
  //     uncollected(W,sl) = max(0, sl.quoted - event.collected)
  //     invoiced(W,sl) = event.invoiced
  //
  //   Total Exposure(W) = sum of project uncollected + sum of service uncollected
  //   Unbilled(W)       = Total Exposure minus (service uncollected where invoiced = true)
  //                       = everything not yet invoiced through the service log flow. Projects
  //                         stay fully in Unbilled until we add a per-project invoicing event;
  //                         for now project exposure is treated as entirely Unbilled.
  //   Gap (rendered) = Total Exposure − Unbilled = service logs that have been invoiced but not yet collected.
  //
  //   Income bars:
  //     proj (weekly) = sum of log.collected dated in week
  //     svc (weekly)  = sum of serviceLog.collected dated in week  (kept for backward compat with chart)
  //     accum         = running total of proj+svc
  //
  //   Window: 40 past/current weeks + 12 future projection weeks = 52 total.
  //   Current week at index 39 = ~77% from left. Future 12 weeks are null.
  const cfotData = (() => {
    const getWeekStart = (raw: any): Date | null => {
      if (!raw) return null
      const d = new Date(raw)
      if (isNaN(d.getTime())) return null
      const start = new Date(d)
      start.setDate(d.getDate() - d.getDay())
      start.setHours(0, 0, 0, 0)
      return start
    }
    const fmtIso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    const allLogs = (backup.logs || []) as any[]
    const allSvcLogs = (backup.serviceLogs || []) as any[]
    const allProjects = (backup.projects || []) as any[]

    // Weekly income (unchanged from prior fix)
    const svcByWeek: Record<number, number> = {}
    const projByWeek: Record<number, number> = {}
    for (const l of allLogs) {
      const ws = getWeekStart(l.date || l.logDate)
      if (!ws) continue
      const k = ws.getTime()
      projByWeek[k] = (projByWeek[k] || 0) + num(l.paymentsCollected || l.collected || 0)
    }
    for (const sl of allSvcLogs) {
      const ws = getWeekStart(sl.date)
      if (!ws) continue
      const k = ws.getTime()
      svcByWeek[k] = (svcByWeek[k] || 0) + num(sl.collected)
    }

    // Precompute per-project log payments sorted by date (for historical collected sums)
    const projectPayments = new Map<string, Array<{ date: Date; amount: number }>>()
    for (const l of allLogs) {
      const pid = l.projId || l.projectId
      if (!pid) continue
      const d = l.date ? new Date(l.date) : null
      if (!d || isNaN(d.getTime())) continue
      const amt = num(l.paymentsCollected || l.collected || 0)
      if (amt <= 0) continue
      if (!projectPayments.has(pid)) projectPayments.set(pid, [])
      projectPayments.get(pid)!.push({ date: d, amount: amt })
    }
    for (const arr of projectPayments.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime())

    // Precompute per-service-log statusEvents sorted by date
    const svcEvents = new Map<string, Array<{ date: Date; collected: number; invoiced: boolean; status: string }>>()
    for (const sl of allSvcLogs) {
      if (!sl.id) continue
      const ev = Array.isArray(sl.statusEvents) ? sl.statusEvents : []
      const parsed: Array<{ date: Date; collected: number; invoiced: boolean; status: string }> = []
      for (const e of ev) {
        const d = e?.date ? new Date(e.date) : null
        if (!d || isNaN(d.getTime())) continue
        parsed.push({
          date: d,
          collected: num(e.collected),
          invoiced: !!e.invoiced,
          status: e.status || 'N',
        })
      }
      parsed.sort((a, b) => a.date.getTime() - b.date.getTime())
      svcEvents.set(sl.id, parsed)
    }

    const isProjectActiveAsOf = (p: any, asOf: Date): boolean => {
      // DASHBOARD-START-DATE-GATE-APR22-2026-1
      // Start Date is required. Projects without a valid start date are excluded
      // from historical exposure entirely (shown as a warning pill above the chart).
      // Drop out of exposure once marked completed/cancelled.
      const status = (p.status || '').toLowerCase()
      if (status === 'completed' || status === 'cancelled' || status === 'archived' || status === 'canceled') return false
      const startRaw = p.startDate || p.plannedStart || p.createdAt || p.start
      if (!startRaw) return false
      const startD = new Date(startRaw)
      if (isNaN(startD.getTime())) return false
      if (startD > asOf) return false
      return true
    }

    const collectedAsOf = (pid: string, asOf: Date): number => {
      const arr = projectPayments.get(pid)
      if (!arr) return 0
      let s = 0
      for (const p of arr) {
        if (p.date <= asOf) s += p.amount
        else break
      }
      return s
    }

    const svcStateAsOf = (slId: string, asOf: Date): { collected: number; invoiced: boolean } => {
      const arr = svcEvents.get(slId)
      if (!arr || arr.length === 0) return { collected: 0, invoiced: false }
      let latest = arr[0]
      for (const e of arr) {
        if (e.date <= asOf) latest = e
        else break
      }
      // If even the first event is after asOf, the service log didn't exist yet
      if (arr[0].date > asOf) return { collected: 0, invoiced: false }
      return { collected: latest.collected, invoiced: latest.invoiced }
    }

    const todayWs = getWeekStart(new Date())
    if (!todayWs) return []
    const weeks: any[] = []
    // DASHBOARD-CFOT-COLLECTION-PATH-PARITY-APR22-2026-1
    // Pre-seed accum with all collections dated BEFORE the 40-week window.
    // Without this the green Accumulative Income line starts at $0 and under-reports
    // total lifetime collected by the sum of any pre-window logs. With this, the line
    // starts at the correct baseline and its right-edge value matches the PAID header.
    const windowStart = new Date(todayWs)
    windowStart.setDate(todayWs.getDate() - 39 * 7)
    let accum = 0
    for (const l of allLogs) {
      const ld = (l.date || l.logDate) ? new Date((l.date || l.logDate) + 'T00:00:00') : null
      if (!ld || isNaN(ld.getTime())) continue
      if (ld < windowStart) accum += num(l.paymentsCollected || l.collected || 0)
    }
    for (const sl of allSvcLogs) {
      const ld = sl.date ? new Date(sl.date + 'T00:00:00') : null
      if (!ld || isNaN(ld.getTime())) continue
      if (ld < windowStart) accum += num(sl.collected)
    }
    for (let i = 39; i >= 0; i--) {
      const wStart = new Date(todayWs)
      wStart.setDate(todayWs.getDate() - i * 7)
      const wEnd = new Date(wStart)
      wEnd.setDate(wStart.getDate() + 6)
      wEnd.setHours(23, 59, 59, 999)
      const k = wStart.getTime()

      // Project uncollected as of week end
      let projExposure = 0
      for (const p of allProjects) {
        if (!isProjectActiveAsOf(p, wEnd)) continue
        const contract = num(p.contract)
        if (contract <= 0) continue
        const collected = collectedAsOf(p.id, wEnd)
        projExposure += Math.max(0, contract - collected)
      }

      // Service uncollected, split by invoiced flag
      let svcUncollectedUninvoiced = 0
      let svcUncollectedInvoiced = 0
      for (const sl of allSvcLogs) {
        const quoted = num(sl.quoted)
        if (quoted <= 0) continue
        const state = svcStateAsOf(sl.id, wEnd)
        // If log hasn't happened yet as of wEnd, skip
        const slDate = sl.date ? new Date(sl.date) : null
        if (slDate && !isNaN(slDate.getTime()) && slDate > wEnd) continue
        const remaining = Math.max(0, quoted - state.collected)
        if (remaining <= 0) continue
        if (state.invoiced) svcUncollectedInvoiced += remaining
        else svcUncollectedUninvoiced += remaining
      }

      const totalExposure = projExposure + svcUncollectedInvoiced + svcUncollectedUninvoiced
      const unbilled = projExposure + svcUncollectedUninvoiced
      const pendingInv = svcUncollectedInvoiced

      const svc = svcByWeek[k] || 0
      const proj = projByWeek[k] || 0
      accum += svc + proj
      weeks.push({
        wk: 40 - i,
        svc,
        proj,
        accum,
        start: fmtIso(wStart),
        unbilled,
        pendingInv,
        totalExposure,
        isProjection: false,
      })
    }
    for (let i = 1; i <= 12; i++) {
      const wStart = new Date(todayWs)
      wStart.setDate(todayWs.getDate() + i * 7)
      weeks.push({
        wk: 40 + i,
        svc: null,
        proj: null,
        accum: null,
        start: fmtIso(wStart),
        unbilled: null,
        pendingInv: null,
        totalExposure: null,
        isProjection: true,
      })
    }
    return weeks
  })()

  // ── CFOT Summary Boxes — computed directly from backup data ──
  const serviceLogs = backup.serviceLogs || []
  const projectLogs = backup.logs || []
  const cfotSummary = (() => {
    const activeProjects = projects.filter(p => p.status === 'active')
    const exposure = activeProjects.reduce((s, p) => s + Math.max(0, num(p.contract) - num(p.paid)), 0)
    const unbilled = activeProjects.reduce((s, p) => s + Math.max(0, num(p.contract) - num(p.billed)), 0)
    const pending = serviceLogs
      .filter((l: any) => num(l.quoted) > 0 && num(l.collected) < num(l.quoted))
      .reduce((s: number, l: any) => s + Math.max(0, num(l.quoted) - num(l.collected)), 0)
    const svcTotal = serviceLogs.reduce((s: number, l: any) => s + num(l.collected), 0)
    const projTotal = projects.reduce((s: number, p: any) => s + num(p.paid), 0)
    const accumTotal = svcTotal + projTotal
    return { exposure, unbilled, pending, svcTotal, projTotal, accumTotal }
  })()

  // ── OPP: Active projects by contract value — skip unnamed/ghost projects ──
  const oppProjects = projects
    .filter(p => (p.status === 'active' || p.status === 'coming') && p.name && p.name.trim())
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 8)

  // ── PCD: Project Completion Distribution by Phase — skip unnamed/ghost projects ──
  const pcdProjects = projects
    .filter(p => (p.status === 'active' || p.status === 'coming') && p.name && p.name.trim())
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 10)

  // ── Date defaults ──
  var rcaDefaultEnd = new Date().toISOString().split('T')[0]
  var rcaDefaultStart = (() => {
    var d = new Date(); d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  })()

  // ── EVR: Exposure vs Revenue — skip unnamed/ghost projects ──
  const [evrDateStart, setEvrDateStart] = useState<string>(rcaDefaultStart)
  const [evrDateEnd, setEvrDateEnd] = useState<string>(rcaDefaultEnd)
  const evrProjects = projects
    .filter(p => p.contract > 0 && p.name && p.name.trim())
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 6)

  // ── SCP: Service Calls Performance ──
  const [scpDateStart, setScpDateStart] = useState<string>(rcaDefaultStart)
  const [scpDateEnd, setScpDateEnd] = useState<string>(rcaDefaultEnd)
  const scpLogs = serviceLogs.filter((l: any) => {
    const d = l.date || ''
    if (!d) return true
    if (scpDateStart && d < scpDateStart) return false
    if (scpDateEnd && d > scpDateEnd) return false
    return true
  }).slice(-8)

  // ── RCA: Revenue vs Cost Analysis ──
  const [rcaSelectedProject, setRcaSelectedProject] = useState<string>('all')
  const [rcaDateStart, setRcaDateStart] = useState<string>(rcaDefaultStart)
  const [rcaDateEnd, setRcaDateEnd] = useState<string>(rcaDefaultEnd)
  const allRcaProjects = projects
    .filter(p => p.status === 'active' && (p.contract || 0) > 0 && p.name && p.name.trim())
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 10)
  const rcaDropdownProjects = (backup.projects || []).filter((p: any) => p.name && p.name.trim())
  const rcaFilteredProjects = (() => {
    const allLogs = backup.logs || []
    const inRange = (d: string) => {
      if (!d) return false
      if (rcaDateStart && d < rcaDateStart) return false
      if (rcaDateEnd && d > rcaDateEnd) return false
      return true
    }
    if (rcaSelectedProject === 'all') {
      return allRcaProjects.filter(p => {
        const pLogs = allLogs.filter((l: any) => (l.projId || l.projectId || '') === p.id)
        return pLogs.length === 0 || pLogs.some((l: any) => inRange(l.date || l.logDate || ''))
      })
    }
    return allRcaProjects.filter(p => p.id === rcaSelectedProject)
  })()
  const rcaProjects = rcaFilteredProjects

  // ── PvA: Planned vs Actual — skip unnamed/ghost projects ──
  const [pvaSelectedProject, setPvaSelectedProject] = useState<string>('all')
  const pvaActiveProjects = projects.filter(p => p.status === 'active' && (p.contract || 0) > 0 && p.name && p.name.trim())
  const pvaProjects = pvaSelectedProject === 'all'
    ? pvaActiveProjects
    : pvaActiveProjects.filter(p => p.id === pvaSelectedProject)

  // ── Monthly Revenue offset state (for scrolling history) ──
  const [monthlyOffset, setMonthlyOffset] = useState<number>(0)
  // ── Revenue Timeline data (inlined from RevenuTimelineDashboard) ──
  const weekBuckets = useMemo(() => query8WeekCashFlow(), [backup])
  const monthBuckets = useMemo(() => queryMonthlyRevenue(6, monthlyOffset), [backup, monthlyOffset])
  const overlapWindows = useMemo(() => queryOverlapWindows(), [backup])
  const ganttRows = useMemo(() => queryGanttData(), [backup])
  const allVariances = useMemo(() => queryAllQuoteVsActual(), [backup])
  const dailyTarget = useMemo(() => getDailyTarget(), [backup])

  // ── Family summary stats ──
  const activeCount = projects.filter(p => p.status === 'active').length
  const accumFmt = cfotSummary.accumTotal >= 1000
    ? '$' + (cfotSummary.accumTotal / 1000).toFixed(0) + 'k'
    : '$' + cfotSummary.accumTotal.toFixed(0)
  const exposureFmt = cfotSummary.exposure >= 1000
    ? '$' + (cfotSummary.exposure / 1000).toFixed(0) + 'k'
    : '$' + cfotSummary.exposure.toFixed(0)
  // Monthly revenue from last monthBucket
  const lastMonthRevenue = monthBuckets && monthBuckets.length > 0
    ? monthBuckets[monthBuckets.length - 1]?.actual || 0
    : 0
  const monthRevFmt = lastMonthRevenue >= 1000
    ? '$' + (lastMonthRevenue / 1000).toFixed(0) + 'k'
    : '$' + lastMonthRevenue.toFixed(0)

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6">
      {/* HEADER */}
      <div className="flex items-center gap-3 mb-8">
        <BarChart3Icon size={32} className="text-blue-400" />
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Graph Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Cash flow, pipeline, completion, and revenue analysis</p>
        </div>
      </div>

      {/* AI ANALYSIS TOOLS — outside families */}
      <div className="space-y-4 mb-10">
        <PulseTrendAnalyzer backup={backup} cfotSummary={cfotSummary} projects={projects} />
        <NEXUSDashboardAnalyzer backup={backup} cfotSummary={cfotSummary} projects={projects} />
      </div>

      {/* ══ FAMILY 1 — CASH FLOW ══ */}
      <ChartFamily
        id="cash-flow"
        name="CASH FLOW"
        accent="#1D9E75"
        chartCount={3}
        summaryLabel="Total Income"
        summaryValue={accumFmt}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* CFOT: Cash Flow Over Time — full width */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2" style={{ width: '100%', minWidth: 0 }}>
            <div className="mb-4">
              <h2 className="text-[30px] font-bold text-gray-100 leading-tight">Projects Cash Flow Over Time</h2>
              <p className="text-sm text-gray-400 italic mt-1">Accumulative vs Total Exposure — Detailed with Unbilled, Invoiced and Received</p>
              {/* DASHBOARD-START-DATE-GATE-APR22-2026-1 — warning pill for projects missing Start Date */}
              <StartDateWarningPill projects={projects} />
            </div>
            {cfotData.length > 0 ? (
              <div
                style={{ position: 'relative', width: '100%', minWidth: 0, height: Math.max(300, Math.round(window.innerHeight * 0.42)) + 'px' }}
              >
                <CFOTChartR data={cfotData} backup={backup} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                Log a payment on any project to activate
              </div>
            )}
            <div className="mt-4 grid grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
              <div className="bg-[var(--bg-input)] p-2 rounded">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#ef4444'}}></div><span className="text-gray-500">Exposure</span></div>
                <p className="font-bold font-mono text-red-400 mt-1">${cfotSummary.exposure.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#f87171'}}></div><span className="text-gray-500">Unbilled</span></div>
                <p className="font-bold font-mono text-red-300 mt-1">${cfotSummary.unbilled.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#f59e0b'}}></div><span className="text-gray-500">Pending</span></div>
                <p className="font-bold font-mono text-amber-400 mt-1">${cfotSummary.pending.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#86efac'}}></div><span className="text-gray-500">Service $</span></div>
                <p className="font-bold font-mono text-green-300 mt-1">${cfotSummary.svcTotal.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#16a34a'}}></div><span className="text-gray-500">Project $</span></div>
                <p className="font-bold font-mono text-green-500 mt-1">${cfotSummary.projTotal.toLocaleString()}</p>
              </div>
              <div className="bg-[var(--bg-input)] p-2 rounded">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{background:'#14532d'}}></div><span className="text-gray-500">Accum</span></div>
                <p className="font-bold font-mono text-green-900 mt-1">${cfotSummary.accumTotal.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* EVR: Exposure vs Revenue */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-lg font-bold text-gray-100">EVR: Exposure vs Revenue</h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>From:</span>
                  <input type="date" value={evrDateStart} onChange={e => setEvrDateStart(e.target.value)} className="bg-[var(--bg-input)] border border-gray-600 rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none" />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>To:</span>
                  <input type="date" value={evrDateEnd} onChange={e => setEvrDateEnd(e.target.value)} className="bg-[var(--bg-input)] border border-gray-600 rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none" />
                </div>
              </div>
            </div>
            {evrProjects.length > 0 ? (
              <div className="relative w-full" style={{ height: '320px' }}>
                <EVRChartR projects={evrProjects} backup={backup} dateStart={evrDateStart} dateEnd={evrDateEnd} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
                Add projects with contract values to activate
              </div>
            )}
          </div>

          {/* 8-Week Cash Flow Projection */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-100">8-Week Cash Flow Projection</h3>
              <p className="text-xs text-gray-400 italic mt-0.5">Projected payments (outline) vs collected (filled) · Coral dot = overlap window</p>
            </div>
            {(() => {
              // FIX 3: Always show 8-week chart — if projected is all-zero, inject baseline from avg weekly collection
              const now = new Date(); now.setHours(0,0,0,0)
              const allLogs = backup.logs || []
              // Last 4 weeks of actual collection
              const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000)
              const recentCollected = allLogs.reduce((s: number, l: any) => {
                const d = l.date ? new Date(l.date + 'T00:00:00') : null
                return d && d >= fourWeeksAgo && d <= now ? s + num(l.collected) : s
              }, 0)
              const avgWeeklyRate = recentCollected / 4

              // Augment weekBuckets: if projected=0 on future weeks, use avgWeeklyRate as baseline
              const augmented = (weekBuckets || []).map((b: any) => {
                const ws = b.weekStart instanceof Date ? b.weekStart : new Date(b.weekStart)
                const isFuture = ws > now
                const hasProjected = (b.projected || 0) > 0
                return {
                  ...b,
                  projected: hasProjected ? b.projected : (isFuture && avgWeeklyRate > 0 ? avgWeeklyRate : b.projected || 0),
                  _isBaseline: !hasProjected && isFuture && avgWeeklyRate > 0,
                }
              })

              const hasAnyData = augmented.some((b: any) => (b.projected || 0) > 0 || (b.actual || 0) > 0)
              if (!hasAnyData) {
                return (
                  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                    Log payments or set phase dates on active projects to activate
                  </div>
                )
              }
              return (
                <div className="relative w-full" style={{ height: '300px' }}>
                  <CashFlowProjectionChart weekBuckets={augmented} overlapWindows={overlapWindows} />
                  {avgWeeklyRate > 0 && !weekBuckets.some((b: any) => (b.projected || 0) > 0) && (
                    <div className="absolute bottom-6 left-0 right-0 text-center text-[10px] text-blue-400">
                      Dashed bars = baseline projection from avg ${Math.round(avgWeeklyRate).toLocaleString()}/week (last 4 weeks)
                    </div>
                  )}
                </div>
              )
            })()}
          </div>

        </div>
      </ChartFamily>

      {/* ══ FAMILY 2 — PROJECT INTELLIGENCE ══ */}
      <ChartFamily
        id="project-intelligence"
        name="PROJECT INTELLIGENCE"
        accent="#378ADD"
        chartCount={3}
        summaryLabel="Active Projects"
        summaryValue={String(activeCount)}
      >
        {/* FIX 4: Each chart in its own clearly defined container, min-height, no overlap */}
        <div className="flex flex-col gap-6">

          {/* Project Timeline — Gantt View (isolated card, no height bleed into PvA) */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6" style={{ minHeight: '280px', overflow: 'hidden' }}>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-100">Project Timeline — Gantt View</h3>
              <p className="text-xs text-gray-400 italic mt-0.5">
                Solid = confirmed phases · Dashed = estimated · Coral zone = overlap · Green dot = payment milestone
              </p>
            </div>
            {ganttRows.length > 0 ? (
              <div style={{ width: '100%', maxHeight: '400px', overflowY: 'auto', overflowX: 'auto' }}>
                <div style={{ width: '100%', minHeight: '200px', height: Math.max(200, ganttRows.length * 48 + 80) + 'px' }}>
                  <ProjectTimelineChart ganttRows={ganttRows} overlapWindows={overlapWindows} />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center text-gray-500 text-sm" style={{ minHeight: '120px' }}>
                Enter a phase start date in any project
              </div>
            )}
          </div>

          {/* Planned vs Actual Timeline */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6" style={{ minHeight: '460px' }}>
            <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-lg font-bold text-gray-100">Planned vs Actual Timeline</h2>
                <p className="text-sm text-gray-400 italic mt-1">Dashed = planned schedule at contract value, solid = actual accumulated collected revenue</p>
              </div>
              <select
                value={pvaSelectedProject}
                onChange={e => setPvaSelectedProject(e.target.value)}
                className="bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none min-w-[180px]"
              >
                <option value="all">All Projects</option>
                {pvaActiveProjects.map(p => (
                  <option key={p.id} value={p.id}>{(p.name || 'Unknown').substring(0, 30)}</option>
                ))}
              </select>
            </div>
            {pvaProjects.length > 0 ? (
              <div style={{ width: '100%', height: '380px' }}>
                <PvAChartR projects={pvaProjects} backup={backup} />
              </div>
            ) : (
              <div className="flex items-center justify-center text-gray-500 text-sm" style={{ minHeight: '200px' }}>
                Confirm a phase date in Project → Phase Timeline tab
              </div>
            )}
          </div>

          {/* OPP: Open Projects Pipeline */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6" style={{ minHeight: '340px' }}>
            <h2 className="text-lg font-bold text-gray-100 mb-4">OPP: Open Projects Pipeline</h2>
            {oppProjects.length > 0 ? (
              <div style={{ width: '100%', height: '300px' }}>
                <OPPChartR projects={oppProjects} backup={backup} />
              </div>
            ) : (
              <div className="flex items-center justify-center text-gray-500 text-sm" style={{ minHeight: '200px' }}>
                Add active or upcoming projects to see your pipeline
              </div>
            )}
          </div>

        </div>
      </ChartFamily>

      {/* ══ FAMILY 3 — COST & LABOR ══ */}
      <ChartFamily
        id="cost-labor"
        name="COST & LABOR"
        accent="#EF9F27"
        chartCount={3}
        summaryLabel="AR Exposure"
        summaryValue={exposureFmt}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Row 1a: Labor Cost vs Revenue 12-Week Trend (50% width) */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-100">Labor Cost vs Revenue 12-Week Trend</h2>
              <p className="text-xs text-gray-400 italic mt-0.5">Weekly labor cost vs revenue collected over rolling 12 weeks</p>
            </div>
            <div className="relative w-full" style={{ height: '280px' }}>
              <LaborTrendChart backup={backup} />
            </div>
          </div>

          {/* Row 1b: 6-Month Cost vs Pipeline Forecast (50% width) */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-gray-100">6-Month Cost vs Pipeline Forecast</h2>
              <p className="text-xs text-gray-400 italic mt-0.5">Monthly burn rate vs pipeline value — active &amp; coming projects · Dashed = baseline projection</p>
            </div>
            <div className="relative w-full" style={{ height: '280px' }}>
              <SixMonthForecastChart backup={backup} />
            </div>
          </div>

          {/* Row 2: RCA Revenue vs Cost Analysis — full width */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2" style={{ width: '100%', minWidth: 0 }}>
            <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-[26px] font-bold text-gray-100 leading-tight">Revenue vs Cost Analysis — Active Projects</h2>
                <p className="text-sm text-gray-400 italic mt-1">Collected Revenue, Labor/Material/Mileage Costs, AR Exposure &amp; Break-even — with shaded profit zones</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>From:</span>
                  <input
                    type="date"
                    value={rcaDateStart}
                    onChange={e => setRcaDateStart(e.target.value)}
                    className="bg-[var(--bg-input)] border border-gray-600 rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none"
                  />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>To:</span>
                  <input
                    type="date"
                    value={rcaDateEnd}
                    onChange={e => setRcaDateEnd(e.target.value)}
                    className="bg-[var(--bg-input)] border border-gray-600 rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none"
                  />
                </div>
                <select
                  value={rcaSelectedProject}
                  onChange={e => setRcaSelectedProject(e.target.value)}
                  className="bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none min-w-[180px]"
                >
                  <option value="all">All Projects</option>
                  {rcaDropdownProjects.filter((p: any) => p.name && p.name.trim()).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name.substring(0, 30)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ position: 'relative', width: '100%', minWidth: 0, height: '420px' }}>
              <RCAChartR projects={rcaProjects} backup={backup} dateStart={rcaDateStart} dateEnd={rcaDateEnd} />
            </div>
            <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(239,68,68,0.15)'}}></span> Danger zone</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(245,158,11,0.15)'}}></span> Warning zone</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(16,185,129,0.15)'}}></span> Profit zone</span>
            </div>
          </div>

        </div>
      </ChartFamily>

      {/* ══ FAMILY 4 — PERFORMANCE ══ */}
      <ChartFamily
        id="performance"
        name="PERFORMANCE"
        accent="#7F77DD"
        chartCount={3}
        summaryLabel="Service Calls"
        summaryValue={String(scpLogs.length)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* SCP: Service Calls Performance */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-lg font-bold text-gray-100">SCP: Service Calls Performance</h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>From:</span>
                  <input type="date" value={scpDateStart} onChange={e => setScpDateStart(e.target.value)} className="bg-[var(--bg-input)] border border-gray-600 rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none" />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span>To:</span>
                  <input type="date" value={scpDateEnd} onChange={e => setScpDateEnd(e.target.value)} className="bg-[var(--bg-input)] border border-gray-600 rounded px-2 py-1 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none" />
                </div>
              </div>
            </div>
            {scpLogs.length > 0 ? (
              <div className="relative w-full" style={{ height: '300px' }}>
                <SCPChartR serviceLogs={scpLogs} backup={backup} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
                No service call data yet
              </div>
            )}
          </div>

          {/* PCD: Project Completion Distribution */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
            <h2 className="text-lg font-bold text-gray-100 mb-4">PCD: Project Completion Distribution</h2>
            {pcdProjects.length > 0 ? (
              <div className="relative w-full" style={{ height: '300px' }}>
                <PCDChartR projects={pcdProjects} backup={backup} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                Add active or upcoming projects to see completion distribution
              </div>
            )}
          </div>

          {/* Quote vs Actual — Estimating Accuracy — full width */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2" style={{ width: '100%', minWidth: 0 }}>
            <div className="mb-4">
              <h3 className="text-lg font-bold text-gray-100">Quote vs Actual — Estimating Accuracy</h3>
              <p className="text-xs text-gray-400 italic mt-0.5">
                Gray = quoted hours · Colored = actual · Red = over budget · Green = under · Amber = within 5%
              </p>
            </div>
            {allVariances && allVariances.length > 0 && allVariances.some(p => p.variances && p.variances.length > 0) ? (
              <div style={{ position: 'relative', width: '100%', minWidth: 0, minHeight: '200px', height: Math.max(200, allVariances.reduce((s, p) => s + (p.variances ? p.variances.length : 0), 0) * 58 + 60) + 'px' }}>
                <QuoteVsActualChart projectsVariance={allVariances} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                Log field hours against a phase to see estimating accuracy
              </div>
            )}
          </div>

          {/* Team Hours Performance — full width */}
          <TeamHoursChart backup={backup} />

        </div>
      </ChartFamily>

      {/* ══ FAMILY 5 — REVENUE INTELLIGENCE ══ */}
      <ChartFamily
        id="revenue-intelligence"
        name="REVENUE INTELLIGENCE"
        accent="#D85A30"
        chartCount={2}
        summaryLabel="This Month"
        summaryValue={monthRevFmt}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Monthly Revenue — Projected vs Actual */}
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2" style={{ width: '100%', minWidth: 0 }}>
            <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-lg font-bold text-gray-100">Monthly Revenue — Projected vs Actual</h3>
                <p className="text-xs text-gray-400 italic mt-0.5">6-month rolling · Dashed amber = monthly target (dayTarget × 20 work days)</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMonthlyOffset(o => o - 6)}
                  className="px-3 py-1.5 text-xs bg-[var(--bg-input)] border border-gray-600 rounded hover:border-gray-400 text-gray-300 transition-colors"
                  title="Scroll back 6 months"
                >← Back</button>
                <span className="text-xs text-gray-500 min-w-[90px] text-center">
                  {monthlyOffset === 0 ? 'Current period' : monthlyOffset < 0 ? `${Math.abs(monthlyOffset)}mo ago` : `+${monthlyOffset}mo`}
                </span>
                <button
                  onClick={() => setMonthlyOffset(o => Math.min(0, o + 6))}
                  disabled={monthlyOffset >= 0}
                  className="px-3 py-1.5 text-xs bg-[var(--bg-input)] border border-gray-600 rounded hover:border-gray-400 text-gray-300 transition-colors disabled:opacity-40"
                  title="Scroll forward to current period"
                >Next →</button>
                {monthlyOffset !== 0 && (
                  <button
                    onClick={() => setMonthlyOffset(0)}
                    className="px-3 py-1.5 text-xs bg-blue-800 border border-blue-600 rounded hover:bg-blue-700 text-blue-200 transition-colors"
                  >Reset</button>
                )}
              </div>
            </div>
            {(activeCount > 0 || monthlyOffset < 0) ? (
              <div style={{ position: 'relative', width: '100%', minWidth: 0, height: '300px' }}>
                <MonthlyRevenueChart monthlyBuckets={monthBuckets} dailyTarget={dailyTarget} />
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                No payments recorded this month yet
              </div>
            )}
          </div>

        </div>
      </ChartFamily>

    </div>
  )
}

// ── DASHBOARD EXPORT ──
export default function V15rDashboard() {
  return (
    <V15rDashboardInner />
  )
}
