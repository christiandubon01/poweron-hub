// @ts-nocheck
import React, { useState, useCallback, useMemo } from 'react'
import { TrendingUp, AlertCircle, Sparkles } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  getProjectFinancials,
  num,
  fmt,
  fmtK,
  pct,
  daysSince,
  projectLogsFor,
  getOverallCompletion,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { useProactiveAI } from '@/hooks/useProactiveAI'
import { ProactiveInsightCard } from '@/components/shared/ProactiveInsightCard'
import { callClaude, extractText } from '@/services/claudeProxy'

interface BenchmarkRow {
  name: string
  count: number
  avgSold: number
  avgGP: number
  avgMargin: number
  avgDur: number
  laborVarPct: number
}

interface PricingStats {
  rows: BenchmarkRow[]
  top: BenchmarkRow | undefined
  allCount: number
  avgMargin: number
  avgSold: number
  avgDur: number
}

interface ArchiveCandidate {
  project: any
  progress: number
}

export default function V15rPricingIntelligencePanel() {
  const [tick, setTick] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [showAIInsight, setShowAIInsight] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [scoutAnalysis, setScoutAnalysis] = useState<string | null>(null)
  const [scoutLoading, setScoutLoading] = useState(false)

  const forceUpdate = useCallback(() => setTick(t => t + 1), [])

  const backup = getBackupData()
  if (!backup) return <div className="p-4 text-center text-gray-400">No data loaded</div>

  // ─────────────────────────────────────────────────────────────────────────
  // SCOUT Pricing Intelligence Context
  // ─────────────────────────────────────────────────────────────────────────
  const scoutBackup = getBackupData()
  const allProjects = scoutBackup?.projects || []
  const completedProjects = allProjects.filter(p => p.status === 'completed')
  const scoutActiveProjects = allProjects.filter(p => p.status !== 'completed')
  const jobTypes = [...new Set(allProjects.map(p => p.type).filter(Boolean))]

  // Calculate margin by job type
  const marginByType = jobTypes.map(type => {
    const projs = allProjects.filter(p => p.type === type && num(p.contract) > 0)
    const totalContract = projs.reduce((s, p) => s + num(p.contract), 0)
    const totalCost = projs.reduce((s, p) => {
      const lab = (p.laborRows || []).reduce((sum, r) => sum + num(r.hrs) * num(r.rate), 0)
      const mat = (p.matRows || []).reduce((sum, r) => sum + num(r.total), 0)
      return s + lab + mat
    }, 0)
    const margin = totalContract > 0 ? ((totalContract - totalCost) / totalContract * 100) : 0
    return { type, count: projs.length, margin: margin.toFixed(1) }
  })

  const scoutContext = `Pricing analysis: ${allProjects.length} total projects (${completedProjects.length} completed). Job types: ${marginByType.map(m => `${m.type}: ${m.count} jobs, ${m.margin}% margin`).join('; ')}. Analyze margin benchmarks by job type, identify underpriced jobs, and recommend rate adjustments.`
  const scoutSystem = 'You are SCOUT, the pricing intelligence and market research agent for Power On Solutions LLC, a C-10 electrical contractor in the Coachella Valley. Analyze margin benchmarks by job type, identify pricing patterns, flag underpriced work, and recommend adjustments. Reference typical contractor margins for comparison.'
  const scout = useProactiveAI('scout', scoutSystem, scoutContext, allProjects.length > 0)

  // ─────────────────────────────────────────────────────────────────────────
  // Pricing Stats (ported from pricingStats())
  // ─────────────────────────────────────────────────────────────────────────
  const pricingStats = useMemo((): PricingStats => {
    const rows = backup.completedArchive || []
    const grouped: Record<string, any[]> = {}

    rows.forEach((r: any) => {
      const key = r.templateName || r.jobType || 'Unclassified'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(r)
    })

    const groupRows = Object.entries(grouped)
      .map(([name, items]) => {
        const count = items.length
        const sold = items.reduce((s: number, r: any) => s + num(r.soldPrice), 0)
        const gp = items.reduce((s: number, r: any) => s + num(r.grossProfit), 0)
        const estH = items.reduce((s: number, r: any) => s + num(r.estimatedLaborHrs), 0)
        const actH = items.reduce((s: number, r: any) => s + num(r.actualLaborHrs), 0)
        const avgMargin = count ? items.reduce((s: number, r: any) => s + num(r.grossMarginPct), 0) / count : 0
        const avgDur = count ? items.reduce((s: number, r: any) => s + num(r.durationDays), 0) / count : 0
        const laborVarPct = estH ? ((actH - estH) / estH) * 100 : 0

        return {
          name,
          count,
          avgSold: count ? sold / count : 0,
          avgGP: count ? gp / count : 0,
          avgMargin,
          avgDur,
          laborVarPct,
        }
      })
      .sort((a, b) => b.count - a.count || b.avgSold - a.avgSold)

    const top = groupRows[0]
    const allCount = rows.length
    const avgMargin = allCount ? rows.reduce((s: number, r: any) => s + num(r.grossMarginPct), 0) / allCount : 0
    const avgSold = allCount ? rows.reduce((s: number, r: any) => s + num(r.soldPrice), 0) / allCount : 0
    const avgDur = allCount ? rows.reduce((s: number, r: any) => s + num(r.durationDays), 0) / allCount : 0

    return { rows: groupRows, top, allCount, avgMargin, avgSold, avgDur }
  }, [backup])

  // ─────────────────────────────────────────────────────────────────────────
  // Archive Candidates (ported from archiveCandidates())
  // ─────────────────────────────────────────────────────────────────────────
  const candidates = useMemo((): ArchiveCandidate[] => {
    return (backup.projects || [])
      .filter((p: any) => !backup.completedArchive.some((a: any) => a.sourceProjectId === p.id))
      .map((p: any) => ({
        project: p,
        progress: Math.round(getOverallCompletion(p, backup)),
      }))
      .sort((a, b) => b.progress - a.progress)
  }, [backup])

  // ─────────────────────────────────────────────────────────────────────────
  // Active projects for selector
  // ─────────────────────────────────────────────────────────────────────────
  const activeProjects = useMemo(() => {
    return (backup.projects || []).filter(
      (p: any) => (p.status === 'active' || p.status === 'coming')
    )
  }, [backup])

  // ─────────────────────────────────────────────────────────────────────────
  // Day-by-day revenue/expenses timeline for selected project
  // ─────────────────────────────────────────────────────────────────────────
  const dailyTimeline = useMemo(() => {
    if (!selectedProjectId) return []

    const project = backup.projects?.find((p: any) => p.id === selectedProjectId)
    if (!project) return []

    const logs = projectLogsFor(backup, selectedProjectId)
    const opRate = num(backup.settings?.opCost || 42.45)
    const mileRate = num(backup.settings?.mileRate || 0.66)

    const dailyMap: Record<string, any> = {}

    logs.forEach((log: any) => {
      const date = log.date || ''
      if (!dailyMap[date]) {
        dailyMap[date] = {
          date,
          revenue: 0,
          expenses: 0,
          margin: 0,
          hours: 0,
          materials: 0,
        }
      }

      const dayCost = num(log.hrs) * opRate + num(log.mat) + num(log.miles) * mileRate
      dailyMap[date].revenue += num(log.quoted)
      dailyMap[date].expenses += dayCost
      dailyMap[date].materials += num(log.mat)
      dailyMap[date].hours += num(log.hrs)
      dailyMap[date].margin = dailyMap[date].revenue - dailyMap[date].expenses
    })

    return Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date))
  }, [selectedProjectId, backup])

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────
  const handleArchiveReady = () => {
    const readyProjects = candidates.filter((c) => c.progress >= 90)
    if (!readyProjects.length) {
      alert('No projects ready to archive (need 90%+ completion)')
      return
    }

    if (!confirm(`Archive ${readyProjects.length} project(s)?`)) return

    pushState(backup)
    readyProjects.forEach((c) => {
      if (!backup.completedArchive) backup.completedArchive = []
      backup.completedArchive.push({
        sourceProjectId: c.project.id,
        projectName: c.project.name,
        jobType: c.project.type,
        templateName: c.project.templateName || '',
        soldPrice: num(c.project.contract),
        grossProfit: num(c.project.billed) - num(c.project.paid),
        grossMarginPct: c.project.contract ? ((num(c.project.billed) / num(c.project.contract)) * 100 - 100) : 0,
        estimatedLaborHrs: num(c.project.laborHrs || 0),
        actualLaborHrs: (projectLogsFor(backup, c.project.id) || []).reduce((s: number, l: any) => s + num(l.hrs), 0),
        durationDays: daysSince(c.project.lastMove),
        archivedAt: new Date().toISOString().split('T')[0],
      })
    })

    saveBackupData(backup)
    alert('Archived successfully 98')
    forceUpdate()
  }

  const handleExportArchive = () => {
    const data = {
      completedArchive: backup.completedArchive || [],
      exportedAt: new Date().toISOString(),
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pricing-archive-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleScoutAnalysis = () => {
    setScoutLoading(true)
    const executeAnalysis = async () => {
      try {
        const archived = backup.completedArchive || []
        const summary = archived.slice(0, 10).map((j: any) => `${j.projectName || j.name}: $${num(j.soldPrice || j.contract || 0)} (${j.jobType || j.type || 'General'})`).join('\n')
        const response = await callClaude({
          system: 'You are SCOUT, the pattern analysis agent for Power On Solutions, a C-10 electrical contractor. Analyze pricing patterns and suggest adjustments.',
          messages: [{ role: 'user', content: `Analyze these completed jobs:\n${summary}\n\nAnalyze pricing patterns, suggest adjustments, identify profitable vs unprofitable job types. Keep under 250 words.` }],
          max_tokens: 640,
        })
        setScoutAnalysis(extractText(response))
      } catch { setScoutAnalysis('Analysis unavailable') }
      setScoutLoading(false)
    }
    executeAnalysis()
  }

  const dismissAI = () => {
    setShowAIInsight(false)
    setAiPrompt('')
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-[#1a1d27] text-white p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold mb-1">Pricing Intelligence</h2>
            <p className="text-gray-400 text-sm">
              Historical pricing library built from completed jobs and live project snapshots.
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleArchiveReady}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium text-sm"
          >
            Archive Ready Projects
          </button>
          <button
            onClick={handleExportArchive}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium text-sm"
          >
            Export Archive JSON
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#232738] p-4 rounded-lg border border-green-900/30">
          <div className="text-gray-400 text-xs font-semibold mb-1">ARCHIVED JOBS</div>
          <div className="text-2xl font-bold">{pricingStats.allCount}</div>
          <div className="text-gray-500 text-xs mt-1">Reusable pricing memory</div>
        </div>
        <div className="bg-[#232738] p-4 rounded-lg border border-blue-900/30">
          <div className="text-gray-400 text-xs font-semibold mb-1">AVG SOLD</div>
          <div className="text-2xl font-bold">{fmtK(pricingStats.avgSold)}</div>
          <div className="text-gray-500 text-xs mt-1">Across archived work</div>
        </div>
        <div className="bg-[#232738] p-4 rounded-lg border border-orange-900/30">
          <div className="text-gray-400 text-xs font-semibold mb-1">AVG MARGIN</div>
          <div className="text-2xl font-bold">{pricingStats.avgMargin.toFixed(1)}%</div>
          <div className="text-gray-500 text-xs mt-1">Gross margin snapshot</div>
        </div>
        <div className="bg-[#232738] p-4 rounded-lg border border-purple-900/30">
          <div className="text-gray-400 text-xs font-semibold mb-1">TOP JOB FAMILY</div>
          <div className="text-xl font-bold truncate">{pricingStats.top?.name || '—'}</div>
          <div className="text-gray-500 text-xs mt-1">Most reusable dataset</div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left column: Benchmarks + Archived Jobs */}
        <div className="col-span-2 space-y-6">
          {/* Job-Type Benchmarks */}
          <div className="bg-[#232738] rounded-lg border border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 bg-[#1e2130]">
              <h3 className="font-semibold text-white mb-1">Job-Type Benchmarks</h3>
              <p className="text-xs text-gray-400">
                Use these ranges to pressure-test new estimates before you submit.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e2130] border-b border-gray-700">
                  <tr className="text-gray-300 text-xs font-semibold uppercase">
                    <th className="px-4 py-2 text-left">Job Family</th>
                    <th className="px-4 py-2 text-right">Count</th>
                    <th className="px-4 py-2 text-right">Avg Sold</th>
                    <th className="px-4 py-2 text-right">Avg Margin</th>
                    <th className="px-4 py-2 text-right">Labor Var</th>
                    <th className="px-4 py-2 text-right">Avg Dur</th>
                    <th className="px-4 py-2 text-left">Guidance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {pricingStats.rows.length ? (
                    pricingStats.rows.map((r) => {
                      const guidance =
                        r.avgMargin < 20
                          ? 'Tight margin — review scope & markup'
                          : r.laborVarPct > 15
                            ? 'Labor runs long — pad coordination'
                            : 'Healthy baseline — template ready'
                      return (
                        <tr key={r.name} className="hover:bg-[#1e2130] transition">
                          <td className="px-4 py-3">
                            <div className="font-medium">{r.name}</div>
                            <div className="text-xs text-gray-500">{r.count} jobs</div>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-300">{r.count}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{fmtK(r.avgSold)}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{r.avgMargin.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right text-gray-300">{r.laborVarPct.toFixed(1)}%</td>
                          <td className="px-4 py-3 text-right text-gray-300">{Math.round(r.avgDur)}d</td>
                          <td className="px-4 py-3 text-xs text-gray-400 max-w-xs">{guidance}</td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">
                        No archived jobs yet. Archive completed work to activate this table.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Archived Jobs Table */}
          <div className="bg-[#232738] rounded-lg border border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 bg-[#1e2130]">
              <h3 className="font-semibold text-white mb-1">Archived Jobs</h3>
              <p className="text-xs text-gray-400">
                Raw entries preserved for future quoting, analytics, and estimate assist.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#1e2130] border-b border-gray-700">
                  <tr className="text-gray-300 text-xs font-semibold uppercase">
                    <th className="px-4 py-2 text-left">Project</th>
                    <th className="px-4 py-2 text-left">Template</th>
                    <th className="px-4 py-2 text-right">Sold</th>
                    <th className="px-4 py-2 text-right">Gross Profit</th>
                    <th className="px-4 py-2 text-right">Margin</th>
                    <th className="px-4 py-2 text-left">Labor</th>
                    <th className="px-4 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {backup.completedArchive && backup.completedArchive.length ? (
                    [...backup.completedArchive]
                      .reverse()
                      .slice(0, 12)
                      .map((r: any, i: number) => (
                        <tr key={i} className="hover:bg-[#1e2130] transition">
                          <td className="px-4 py-3">
                            <div className="font-medium">{r.projectName}</div>
                            <div className="text-xs text-gray-500">{r.archivedAt}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-300">{r.templateName || r.jobType || '—'}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{fmt(r.soldPrice)}</td>
                          <td className="px-4 py-3 text-right text-gray-300">{fmt(r.grossProfit)}</td>
                          <td className="px-4 py-3 text-right text-gray-300">
                            {num(r.grossMarginPct).toFixed(1)}%
                          </td>
                          <td className="px-4 py-3 text-gray-300 text-xs">
                            {num(r.actualLaborHrs).toFixed(1)}h{' '}
                            <span className="text-gray-500">vs {num(r.estimatedLaborHrs).toFixed(1)}h</span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => {
                                pushState(backup)
                                const archive = backup.completedArchive || []
                                const job = archive[archive.length - 1 - i]
                                if (job) {
                                  const updatedArchive = archive.filter((_, idx) => idx !== archive.length - 1 - i)
                                  const updatedProjects = [...(backup.projects || []), { ...job, status: 'active', studied: true }]
                                  saveBackupData({ ...backup, completedArchive: updatedArchive, projects: updatedProjects })
                                  forceUpdate()
                                }
                              }}
                              className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                            >
                              ↩ Return to Queue
                            </button>
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-400 text-sm">
                        Archive is empty.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right column: Archive Queue + Buttons */}
        <div className="space-y-6">
          {/* Archive Queue */}
          <div className="bg-[#232738] rounded-lg border border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700 bg-[#1e2130]">
              <h3 className="font-semibold text-white mb-1">Archive Queue</h3>
              <p className="text-xs text-gray-400">Projects ready to become future pricing references.</p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {candidates.length ? (
                <div className="divide-y divide-gray-700">
                  {candidates.map((c) => (
                    <div key={c.project.id} className="p-3 hover:bg-[#1e2130] transition">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-sm">{c.project.name}</div>
                            {c.project.studied && <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">Studied</span>}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {c.project.type} · {c.progress}% complete
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={`inline-block px-2 py-1 text-xs rounded font-medium mb-1 ${
                              c.progress >= 90 ? 'bg-green-900 text-green-200' : 'bg-orange-900 text-orange-200'
                            }`}
                          >
                            {c.progress >= 90 ? 'Ready' : 'Snapshot'}
                          </div>
                          <button
                            onClick={() => {
                              const project = c.project
                              if (!backup.completedArchive) backup.completedArchive = []
                              backup.completedArchive.push({
                                sourceProjectId: project.id,
                                projectName: project.name,
                                jobType: project.type,
                                templateName: project.templateName || '',
                                soldPrice: num(project.contract),
                                grossProfit: num(project.billed) - num(project.paid),
                                grossMarginPct: project.contract
                                  ? (num(project.billed) / num(project.contract)) * 100 - 100
                                  : 0,
                                estimatedLaborHrs: num(project.laborHrs || 0),
                                actualLaborHrs: (projectLogsFor(backup, project.id) || []).reduce(
                                  (s: number, l: any) => s + num(l.hrs),
                                  0
                                ),
                                durationDays: daysSince(project.lastMove),
                                archivedAt: new Date().toISOString().split('T')[0],
                              })
                              saveBackupData(backup)
                              forceUpdate()
                              alert(project.name + ' archived ✓')
                            }}
                            className="block w-full px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium"
                          >
                            Archive
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-400 text-sm">Everything is already archived.</div>
              )}
            </div>
          </div>

          {/* Project Selector for Daily Timeline */}
          <div className="bg-[#232738] rounded-lg border border-gray-700 p-4">
            <label className="text-xs font-semibold text-gray-400 mb-2 block">SELECT PROJECT FOR TIMELINE</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-2 bg-[#1e2130] border border-gray-600 rounded text-sm text-white"
            >
              <option value="">— Choose a project —</option>
              {activeProjects.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Daily Timeline */}
          {selectedProjectId && (
            <div className="bg-[#232738] rounded-lg border border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700 bg-[#1e2130]">
                <h3 className="font-semibold text-white text-sm">Daily Timeline</h3>
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-700">
                {dailyTimeline.length ? (
                  dailyTimeline.map((day, i) => (
                    <div key={i} className="p-3 hover:bg-[#1e2130] transition">
                      <div className="text-xs text-gray-400 font-semibold mb-1">{day.date}</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          Revenue: <span className="text-green-400">{fmt(day.revenue)}</span>
                        </div>
                        <div>
                          Expenses: <span className="text-red-400">{fmt(day.expenses)}</span>
                        </div>
                        <div>
                          Margin: <span className="text-blue-400">{fmt(day.margin)}</span>
                        </div>
                        <div>
                          Hours: <span className="text-gray-300">{day.hours.toFixed(1)}h</span>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-center text-gray-400 text-xs">No logs for this project.</div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* SCOUT AI Analysis — absolute bottom, below archived jobs */}
      <div className="mt-8">
        <ProactiveInsightCard
          agentName="SCOUT"
          agentColor="#06b6d4"
          response={scout.response}
          loading={scout.loading}
          error={scout.error}
          onRefresh={scout.refresh}
          emptyMessage="Add completed jobs to analyze your pricing patterns and market positioning."
          systemPrompt={scoutSystem}
        />
      </div>

      {/* SCOUT AI Button + Analysis Display — moved to bottom */}
      <div className="space-y-4">
        <button
          onClick={handleScoutAnalysis}
          disabled={scoutLoading}
          className="w-full px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 rounded font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Sparkles size={16} />
          {scoutLoading ? 'Analyzing...' : 'Scout AI Analysis'}
        </button>

        {/* SCOUT Analysis Display */}
        {scoutAnalysis && (
          <div className="bg-[#232738] rounded-lg border border-gray-700 p-4">
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-purple-400" />
                <span className="text-purple-400 text-sm font-medium">SCOUT Analysis</span>
              </div>
              <button onClick={() => setScoutAnalysis(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>
            <p className="text-gray-300 text-sm whitespace-pre-wrap">{scoutAnalysis}</p>
          </div>
        )}
      </div>

      {/* AI Insight Modal */}
      {showAIInsight && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[#232738] rounded-lg border border-gray-700 max-w-md w-full">
            <div className="px-4 py-3 border-b border-gray-700 bg-[#1e2130] flex items-center gap-2">
              <TrendingUp size={16} className="text-indigo-400" />
              <h3 className="font-semibold text-white">SCOUT AI Analysis</h3>
            </div>
            <div className="p-4">
              <p className="text-sm text-gray-300 mb-4">
                AI analysis coming soon — this feature will suggest pricing improvements based on your archive
                history.
              </p>
              <div className="bg-[#1e2130] p-3 rounded mb-4 text-xs text-gray-400 max-h-32 overflow-y-auto">
                <div className="font-mono">{aiPrompt}</div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={dismissAI}
                  className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-medium"
                >
                  Dismiss
                </button>
                <button
                  onClick={dismissAI}
                  className="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
