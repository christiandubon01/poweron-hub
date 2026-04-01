// @ts-nocheck
/**
 * V15rDashboard — Graph Dashboard with Recharts
 * Replaced Chart.js (TDZ incompatible with Vite 5) with Recharts (React-native SVG)
 */

import React, { useState, useEffect, useRef, useMemo } from 'react'
import { BarChart3, Brain } from 'lucide-react'
import { getBackupData, getProjectFinancials, health, num, fmtK, type BackupData } from '@/services/backupDataService'
import { callClaude, extractText } from '@/services/claudeProxy'
import CFOTChart from './charts/CFOTChart'
import OPPChart from './charts/OPPChart'
import PCDChart from './charts/PCDChart'
import EVRChart from './charts/EVRChart'
import SCPChart from './charts/SCPChart'
import RevenueCostChart from './charts/RCAChart'
import PlannedVsActualChart from './charts/PvAChart'


// ── ERROR BOUNDARY ──
class ChartErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: string}> {
  state = { hasError: false, error: '' }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message } }
  componentDidCatch(error: Error) { console.error('Chart error:', error) }
  render() {
    if (this.state.hasError) return (
      <div className="flex items-center justify-center h-full bg-[var(--bg-card)] rounded-lg p-6 text-gray-400">
        <p className="text-sm">{this.state.error}</p>
      </div>
    )
    return this.props.children
  }
}

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
        const pipelineProjects = projects.filter(p => p.status !== 'active')
        const activeContractTotal = activeProjects.reduce((s: number, p: any) => s + num(p.contract), 0)
        const totalARExposure = activeProjects.reduce((s: number, p: any) => s + Math.max(0, num(p.contract) - num(p.paid)), 0)
        const totalCollected = activeProjects.reduce((s: number, p: any) => s + num(p.paid), 0)
        const totalBilled = activeProjects.reduce((s: number, p: any) => s + num(p.billed), 0)
        const totalUnbilledInvoiced = activeProjects.reduce((s: number, p: any) => s + Math.max(0, num(p.billed) - num(p.paid)), 0)
        const pipelineTotal = pipelineProjects.reduce((s: number, p: any) => s + num(p.contract), 0)

        // Per-project detail for active projects
        const activeProjectDetails = activeProjects.map(p => ({
          name: p.name,
          contract: num(p.contract),
          paid: num(p.paid),
          billed: num(p.billed),
          arExposure: Math.max(0, num(p.contract) - num(p.paid)),
        }))

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
          definitions: 'Active projects = status === active only. AR Exposure = contract minus paid (uncollected contract value). Unbilled/invoiced = billed minus paid (invoiced but not yet collected). Pipeline = non-active projects (estimates, pending, etc). These values are pre-calculated — do not recalculate them.',
          activeProjectCount: activeProjects.length,
          activeContractTotal,
          totalARExposure,
          totalCollected,
          totalBilled,
          totalUnbilledInvoiced,
          pipelineCount: pipelineProjects.length,
          pipelineTotal,
          serviceLogRevenue: svcTotalCollected,
          activeProjectDetails,
          recentServiceLogs: recentSvcLogs,
          weeklyData: (backup.weeklyData || []).slice(-4),
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
          <Brain size={24} className="text-purple-400" />
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
          <Brain size={24} className="text-purple-400" />
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
          <Brain size={24} className="text-purple-400" />
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
const PULSE_CACHE_KEY = 'pulse_trend_analysis_cache'
const PULSE_CACHE_TTL = 60 * 60 * 1000 // 1 hour

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

// ── INNER DASHBOARD COMPONENT ──
function V15rDashboardInner() {
  const backup = getBackupData()

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
  const cfotData = weeklyData.slice(-52).map(w => ({
    wk: w.wk,
    svc: w.svc || 0,
    proj: w.proj || 0,
    accum: w.accum || 0,
    start: w.start
  }))

  // ── CFOT Summary Boxes — computed directly from backup data ──
  const serviceLogs = backup.serviceLogs || []
  const projectLogs = backup.logs || []
  const cfotSummary = (() => {
    const activeProjects = projects.filter(p => p.status === 'active')
    // Exposure: active project contract value not yet collected
    const exposure = activeProjects.reduce((s, p) => s + Math.max(0, num(p.contract) - num(p.paid)), 0)
    // Unbilled: completed work not yet invoiced (contract - billed for active projects)
    const unbilled = activeProjects.reduce((s, p) => s + Math.max(0, num(p.contract) - num(p.billed)), 0)
    // Pending: service calls quoted but not yet collected
    const pending = serviceLogs
      .filter((l: any) => num(l.quoted) > 0 && num(l.collected) < num(l.quoted))
      .reduce((s: number, l: any) => s + Math.max(0, num(l.quoted) - num(l.collected)), 0)
    // Service: total collected from serviceLogs all time
    const svcTotal = serviceLogs.reduce((s: number, l: any) => s + num(l.collected), 0)
    // Project: total collected (paid) from projects all time
    const projTotal = projects.reduce((s: number, p: any) => s + num(p.paid), 0)
    // Accumulative: combined
    const accumTotal = svcTotal + projTotal
    return { exposure, unbilled, pending, svcTotal, projTotal, accumTotal }
  })()

  // ── OPP: Active projects by contract value ──
  const oppProjects = projects
    .filter(p => p.status === 'active' || p.status === 'coming')
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 8)

  // ── PCD: Project Completion Distribution by Phase ──
  const pcdProjects = projects
    .filter(p => p.status === 'active' || p.status === 'coming')
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 10)

  // ── EVR: Exposure vs Revenue (Top 6 by contract) ──
  const [evrDateStart, setEvrDateStart] = useState<string>(rcaDefaultStart)
  const [evrDateEnd, setEvrDateEnd] = useState<string>(rcaDefaultEnd)
  const evrProjects = projects
    .filter(p => p.contract > 0)
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

  // ── RCA: Revenue vs Cost Analysis (Active Projects) ──
  const [rcaSelectedProject, setRcaSelectedProject] = useState<string>('all')
  // G2: date range filter state (default: 90 days back → today)
  const rcaDefaultEnd = new Date().toISOString().split('T')[0]
  const rcaDefaultStart = (() => {
    const d = new Date(); d.setDate(d.getDate() - 90)
    return d.toISOString().split('T')[0]
  })()
  const [rcaDateStart, setRcaDateStart] = useState<string>(rcaDefaultStart)
  const [rcaDateEnd, setRcaDateEnd] = useState<string>(rcaDefaultEnd)
  const allRcaProjects = projects
    .filter(p => p.status === 'active' && (p.contract || 0) > 0)
    .sort((a, b) => (b.contract || 0) - (a.contract || 0))
    .slice(0, 10)
  const rcaDropdownProjects = backup.projects || []
  // Filter projects to only those with log activity in date range
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

  // ── PvA: Planned vs Actual project selector ──
  const [pvaSelectedProject, setPvaSelectedProject] = useState<string>('all')
  const pvaActiveProjects = projects.filter(p => p.status === 'active' && (p.contract || 0) > 0)
  const pvaProjects = pvaSelectedProject === 'all'
    ? pvaActiveProjects
    : pvaActiveProjects.filter(p => p.id === pvaSelectedProject)

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6">
      {/* HEADER */}
      <div className="flex items-center gap-3 mb-8">
        <BarChart3 size={32} className="text-blue-400" />
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Graph Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Cash flow, pipeline, completion, and revenue analysis</p>
        </div>
      </div>

      {/* 2x2 GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* CFOT: Cash Flow Over Time */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-[30px] font-bold text-gray-100 leading-tight">Projects Cash Flow Over Time</h2>
            <p className="text-sm text-gray-400 italic mt-1">Accumulative vs Total Exposure — Detailed with Unbilled, Invoiced and Received</p>
          </div>
          <div
            className="relative w-full"
            style={{ height: Math.max(250, Math.round(window.innerHeight * 0.4)) + 'px' }}
          >
            <ChartErrorBoundary>
              <CFOTChart data={cfotData} backup={backup} />
            </ChartErrorBoundary>
          </div>
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

        {/* OPP: Open Projects Pipeline */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-100 mb-4">OPP: Open Projects Pipeline</h2>
          <div className="relative w-full" style={{ height: '300px' }}>
            <ChartErrorBoundary>
              <OPPChart projects={oppProjects} backup={backup} />
            </ChartErrorBoundary>
          </div>
        </div>

        {/* PCD: Project Completion Distribution */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-100 mb-4">PCD: Project Completion Distribution</h2>
          <div className="relative w-full" style={{ height: '300px' }}>
            <ChartErrorBoundary>
              <PCDChart projects={pcdProjects} backup={backup} />
            </ChartErrorBoundary>
          </div>
        </div>

        {/* EVR: Exposure vs Revenue */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-bold text-gray-100">EVR: Exposure vs Revenue</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>From:</span>
                <input type="date" value={evrDateStart} onChange={e => setEvrDateStart(e.target.value)} className="bg-[#232738] border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 outline-none" />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>To:</span>
                <input type="date" value={evrDateEnd} onChange={e => setEvrDateEnd(e.target.value)} className="bg-[#232738] border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 outline-none" />
              </div>
            </div>
          </div>
          <div className="relative w-full" style={{ height: '300px' }}>
            <ChartErrorBoundary>
              <EVRChart projects={evrProjects} backup={backup} dateStart={evrDateStart} dateEnd={evrDateEnd} />
            </ChartErrorBoundary>
          </div>
        </div>

        {/* SCP: Service Calls Performance */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-bold text-gray-100">SCP: Service Calls Performance</h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>From:</span>
                <input type="date" value={scpDateStart} onChange={e => setScpDateStart(e.target.value)} className="bg-[#232738] border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 outline-none" />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>To:</span>
                <input type="date" value={scpDateEnd} onChange={e => setScpDateEnd(e.target.value)} className="bg-[#232738] border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 outline-none" />
              </div>
            </div>
          </div>
          {scpLogs.length > 0 ? (
            <div className="relative w-full" style={{ height: '300px' }}>
              <ChartErrorBoundary>
                <SCPChart serviceLogs={scpLogs} backup={backup} />
              </ChartErrorBoundary>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
              No service call data yet
            </div>
          )}
        </div>

        {/* RCA: Revenue vs Cost Analysis — Active Projects */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-[26px] font-bold text-gray-100 leading-tight">Revenue vs Cost Analysis — Active Projects</h2>
              <p className="text-sm text-gray-400 italic mt-1">Collected Revenue, Labor/Material/Mileage Costs, AR Exposure &amp; Break-even — with shaded profit zones</p>
            </div>
            {/* G2: date range + project filter controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>From:</span>
                <input
                  type="date"
                  value={rcaDateStart}
                  onChange={e => setRcaDateStart(e.target.value)}
                  className="bg-[#232738] border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span>To:</span>
                <input
                  type="date"
                  value={rcaDateEnd}
                  onChange={e => setRcaDateEnd(e.target.value)}
                  className="bg-[#232738] border border-gray-600 rounded px-2 py-1 text-xs text-gray-200 focus:border-blue-500 outline-none"
                />
              </div>
              <select
                value={rcaSelectedProject}
                onChange={e => setRcaSelectedProject(e.target.value)}
                className="bg-[#232738] border border-gray-600 rounded px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 outline-none min-w-[180px]"
              >
                <option value="all">All Projects</option>
                {rcaDropdownProjects.map(p => (
                  <option key={p.id} value={p.id}>{(p.name || 'Unknown').substring(0, 30)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="relative w-full" style={{ height: '420px' }}>
            <ChartErrorBoundary>
              <RevenueCostChart projects={rcaProjects} backup={backup} dateStart={rcaDateStart} dateEnd={rcaDateEnd} />
            </ChartErrorBoundary>
          </div>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-gray-500">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(239,68,68,0.15)'}}></span> Danger zone</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(245,158,11,0.15)'}}></span> Warning zone</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{background:'rgba(16,185,129,0.15)'}}></span> Profit zone</span>
          </div>
        </div>

        {/* PvA: Planned vs Actual Timeline */}
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6 lg:col-span-2">
          <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-lg font-bold text-gray-100">Planned vs Actual Timeline</h2>
              <p className="text-sm text-gray-400 italic mt-1">Dashed = planned schedule at contract value, solid = actual accumulated collected revenue</p>
            </div>
            <select
              value={pvaSelectedProject}
              onChange={e => setPvaSelectedProject(e.target.value)}
              className="bg-[#232738] border border-gray-600 rounded px-3 py-1.5 text-xs text-gray-200 focus:border-blue-500 outline-none min-w-[180px]"
            >
              <option value="all">All Projects</option>
              {pvaActiveProjects.map(p => (
                <option key={p.id} value={p.id}>{(p.name || 'Unknown').substring(0, 30)}</option>
              ))}
            </select>
          </div>
          <div className="relative w-full" style={{ height: '380px' }}>
            <ChartErrorBoundary>
              <PlannedVsActualChart projects={pvaProjects} backup={backup} />
            </ChartErrorBoundary>
          </div>
        </div>

        {/* G6: PULSE Trend Analyzer — "Analyze trends" button + 1hr cache */}
        <div className="lg:col-span-2">
          <PulseTrendAnalyzer backup={backup} cfotSummary={cfotSummary} projects={projects} />
        </div>

        {/* NEXUS: AI Dashboard Analyzer */}
        <div className="lg:col-span-2">
          <NEXUSDashboardAnalyzer backup={backup} cfotSummary={cfotSummary} projects={projects} />
        </div>

      </div>
    </div>
  )
}

// ── PLANNED VS ACTUAL CHART COMPONENT ──

// ── EXPORT WITH ERROR BOUNDARY ──
export default function V15rDashboard() {
  return (
    <ChartErrorBoundary>
      <V15rDashboardInner />
    </ChartErrorBoundary>
  )
}
