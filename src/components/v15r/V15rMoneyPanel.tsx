// @ts-nocheck
/**
 * V15rMoneyPanel — Comprehensive money, cash flow, AR, and exposure tracking.
 * Faithfully ported from HTML renderMoney().
 *
 * Sections:
 * 1. 4 KPIs (Gross Revenue, Cash Received, Net Revenue, Total Exposure)
 * 2. Service Job Performance (11 metrics)
 * 3. Business Roll-Up (11 metrics with active vs forecasted AR)
 * 4. Exposure Framework table (per project + signals)
 * 5. Cash Waterfall bars
 * 6. Payment Tracker (progress bars per project)
 * 7. 52-Week visualization table
 */

import React, { useState, useRef, useEffect } from 'react'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  getProjectFinancials,
  resolveProjectBucket,
  num,
  fmt,
  fmtK,
  daysSince,
  syncAllProjectFinanceBuckets,
  type BackupData,
  type BackupProject,
  type BackupServiceLog,
} from '@/services/backupDataService'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'

// ── Error Boundary Component ─────────────────────────────────────────────────
class ChartErrorBoundary extends React.Component {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(err: any) { console.error('Chart error:', err) }
  render() {
    if (this.state.hasError) return <div className="p-4 text-red-400 text-sm">Chart failed to render</div>
    return this.props.children
  }
}

// ── Business Health Chart Component ──────────────────────────────────────────
function BusinessHealthChart({ backup }: { backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)

  const projects = backup.projects || []
  const settings = backup.settings || {} as any

  // Calculate revenue breakdown
  const pipeline = projects.reduce((s, p) => s + num(p.contract), 0)
  const paid = projects.reduce((s, p) => s + getProjectFinancials(p, backup).paid, 0)
  const unbilled = Math.max(0, pipeline - paid)

  // Calculate expense ratio
  const overheadPct = num(settings.overheadPct || 30) / 100
  const overheadAmount = paid * overheadPct
  const profitMargin = Math.max(0, paid - overheadAmount)

  useEffect(() => {
    if (!canvasRef.current || !backup) return

    // Load Chart.js from CDN
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js'
    script.onload = () => {
      const Chart = (window as any).Chart

      const ctx = canvasRef.current?.getContext('2d')
      if (!ctx) return

      // Destroy existing chart if any
      if (chartRef.current) {
        chartRef.current.destroy()
      }

      // G5 fix: use separate labels per dataset to prevent color index misalignment
      // The doughnut uses two datasets (outer ring + inner ring) — labels must align per dataset
      chartRef.current = new Chart(ctx, {
        type: 'doughnut',
        data: {
          // Labels array matches outer ring dataset order: Pipeline, Paid, Unbilled
          labels: ['Pipeline', 'Paid', 'Unbilled'],
          datasets: [
            {
              label: 'Revenue Breakdown',
              data: [pipeline, paid, unbilled],
              // G5 fix: colors indexed to match labels order exactly
              backgroundColor: ['#22c55e', '#3b82f6', '#eab308'],
              borderColor: '#1a1d27',
              borderWidth: 2,
              borderRadius: 2,
              offset: [0, 0, 0],
            },
            {
              label: 'Expense Ratio',
              // G5 fix: inner ring labels embedded via dataset label for tooltip clarity
              data: [overheadAmount, profitMargin],
              // colors: Overhead=red, Profit Margin=teal (changed from duplicate green)
              backgroundColor: ['#ef4444', '#14b8a6'],
              borderColor: '#1a1d27',
              borderWidth: 2,
              borderRadius: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '35%',
          plugins: {
            // G5 fix: hide built-in legend — custom HTML legend below is the source of truth
            // This prevents color mismatches between Chart.js auto-legend and actual segment colors
            legend: {
              display: false,
            },
            tooltip: {
              backgroundColor: '#374151',
              titleColor: '#f0f0ff',
              bodyColor: '#e5e7eb',
              borderColor: '#4b5563',
              borderWidth: 1,
              padding: 10,
              titleFont: { weight: 'bold' },
              callbacks: {
                label: (context) => {
                  const value = fmtK(context.parsed)
                  return `${context.label}: ${value}`
                },
              },
            },
          },
        },
      })
    }

    document.head.appendChild(script)

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }
  }, [backup])

  // Segment breakdown for visible labels
  const segments = [
    { name: 'Pipeline', value: pipeline, color: '#22c55e', ring: 'outer' },
    { name: 'Paid', value: paid, color: '#3b82f6', ring: 'outer' },
    { name: 'Unbilled', value: unbilled, color: '#eab308', ring: 'outer' },
    { name: 'Overhead', value: overheadAmount, color: '#ef4444', ring: 'inner' },
    // G5 fix: Profit Margin color changed to teal (#14b8a6) to match inner ring dataset color
    { name: 'Profit Margin', value: profitMargin, color: '#14b8a6', ring: 'inner' }
  ]

  const outerSegments = segments.filter(s => s.ring === 'outer')
  const innerSegments = segments.filter(s => s.ring === 'inner')

  return (
    <div className="space-y-4">
      <div className="h-80 flex items-center justify-center">
        <canvas ref={canvasRef} />
      </div>

      {/* Segment Breakdown Legend */}
      <div className="space-y-4 border-t border-gray-600 pt-4">
        {/* Outer Ring */}
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2 uppercase">Revenue Breakdown (Outer Ring)</p>
          <div className="space-y-1">
            {outerSegments.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
                  <span className="text-gray-300">{seg.name}</span>
                </div>
                <span className="text-gray-300">{fmtK(seg.value)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Inner Ring */}
        <div>
          <p className="text-xs font-semibold text-gray-400 mb-2 uppercase">Expense Ratio (Inner Ring)</p>
          <div className="space-y-1">
            {innerSegments.map((seg) => (
              <div key={seg.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
                  <span className="text-gray-300">{seg.name}</span>
                </div>
                <span className="text-gray-300">{fmtK(seg.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function V15rMoneyPanel() {
  const backup = getBackupData()
  const [weeklyEdit, setWeeklyEdit] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [showWeeklyGaps, setShowWeeklyGaps] = useState(true)
  const [recalculating, setRecalculating] = useState(false)

  // ISSUE 3: Recalculate weekly data from actual project/service log data
  function recalcWeeklyFromData() {
    if (!backup) return
    const wdArr = backup.weeklyData || []
    if (wdArr.length === 0) return
    setRecalculating(true)

    const allLogs = backup.logs || []
    const allSvcLogs = backup.serviceLogs || []
    const allProjects = backup.projects || []

    // Validation cap: total of ALL serviceLogs.collected
    const totalServiceCollected = allSvcLogs.reduce((s, l) => s + num(l.collected), 0)
    const today = new Date()

    let accum = 0
    for (const w of wdArr) {
      // Skip manually overridden weeks
      if (w.manualOverride) continue

      const weekStart = w.start ? new Date(w.start) : null
      if (!weekStart) continue
      const weekEnd = new Date(weekStart.getTime() + 7 * 86400000)

      // proj: SUM of payments from project field logs ONLY (backup.logs)
      // Project logs may use 'collected' or 'paymentsCollected' field
      // These are multi-day jobs with phases, RFIs, blueprints — never from serviceLogs
      const projCollected = allLogs.reduce((s, l) => {
        const ld = l.date ? new Date(l.date) : null
        if (ld && ld >= weekStart && ld < weekEnd) {
          return s + num(l.paymentsCollected || l.collected || 0)
        }
        return s
      }, 0)

      // svc: SUM of collected from serviceLogs ONLY (backup.serviceLogs)
      // These are same-day/2-day service calls — never from project logs
      let svcCollected = allSvcLogs.reduce((s, l) => {
        const ld = l.date ? new Date(l.date) : null
        if (ld && ld >= weekStart && ld < weekEnd) return s + num(l.collected)
        return s
      }, 0)

      // Validation 1: Skip future dates (dates after today)
      if (weekStart > today) {
        svcCollected = 0
      }

      // Validation 2: Cap individual week to total service collected (no phantom entries)
      if (svcCollected > totalServiceCollected) {
        svcCollected = 0
      }

      // Validation 3: Verify against actual logs in week (clear phantom entries)
      const logsInWeek = allSvcLogs.filter(l => {
        const d = l.date ? new Date(l.date) : null
        return d && d >= weekStart && d < weekEnd
      })
      if (logsInWeek.length === 0 && svcCollected > 0) {
        svcCollected = 0
      }

      w.proj = projCollected
      w.svc = svcCollected
      accum += projCollected + svcCollected
      w.accum = accum

      // unbilled: SUM of ACTIVE projects only (not completed, not cancelled)
      const activeProjects = allProjects.filter(p =>
        p.status === 'active' || p.status === 'in_progress'
      )
      const activeUnbilled = activeProjects.reduce((s, p) =>
        s + Math.max(0, num(p.contract) - num(p.billed)), 0
      )
      w.unbilled = activeUnbilled

      // pendingInv: SUM of serviceLogs where collected=0 and quoted>0
      const pending = allSvcLogs
        .filter(l => num(l.collected) === 0 && num(l.quoted) > 0)
        .reduce((s, l) => s + num(l.quoted), 0)
      w.pendingInv = pending
    }

    saveBackupDataAndSync(backup, 'weeklyData')
    setRecalculating(false)
    // Force re-render
    window.location.reload()
  }

  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-64 bg-[var(--bg-secondary)]">
        <div className="text-gray-500 text-sm">No backup data. Import to view financials.</div>
      </div>
    )
  }

  const projects = backup.projects || []
  const logs = backup.logs || []
  const serviceLogs = backup.serviceLogs || []
  const weeklyData = backup.weeklyData || []
  const settings = backup.settings || {} as any
  const mileRate = num(settings.mileRate || 0.66)
  const opCostRate = num(settings.opCost || 42.45)

  // Sync finance buckets
  syncAllProjectFinanceBuckets(backup)

  // ── Per-project financials ─────────────────────────────────────────────
  const projectMoney = projects.map(p => {
    const m = getProjectFinancials(p, backup)
    return { p, ...m }
  })

  // ── Service calculations ───────────────────────────────────────────────
  const svcCount = serviceLogs.length
  const svcPaidCount = serviceLogs.filter(l => num(l.collected) > 0).length
  const svcQuoted = serviceLogs.reduce((s, l) => s + num(l.quoted), 0)
  const svcCollected = serviceLogs.reduce((s, l) => s + num(l.collected), 0)
  const svcMatTotal = serviceLogs.reduce((s, l) => s + num(l.mat), 0)
  const svcMilesTotal = serviceLogs.reduce((s, l) => s + num(l.mileCost != null ? l.mileCost : (num(l.miles) * mileRate)), 0)
  const svcOpTotal = serviceLogs.reduce((s, l) => s + num(l.opCost != null ? l.opCost : (num(l.hrs) * opCostRate)), 0)
  const svcDirectCosts = svcMatTotal + svcMilesTotal + svcOpTotal
  const svcProfit = serviceLogs.reduce((s, l) => s + num(l.profit != null ? l.profit : (num(l.quoted) - num(l.mat) - num(l.miles) * mileRate - num(l.hrs) * opCostRate)), 0)
  const svcOutstanding = svcQuoted - svcCollected
  const svcAvgTicket = svcCount ? svcQuoted / svcCount : 0
  const svcMargin = svcQuoted > 0 ? (svcProfit / svcQuoted) * 100 : 0

  // ── Project aggregates ─────────────────────────────────────────────────
  const projectContract = projectMoney.reduce((s, m) => s + m.contract, 0)
  const projectPaid = projectMoney.reduce((s, m) => s + m.paid, 0)
  const projectBilled = projectMoney.reduce((s, m) => s + m.billed, 0)
  const projectAR = projectMoney.reduce((s, m) => s + m.ar, 0)
  const projectUnbilled = projectMoney.reduce((s, m) => s + m.unbilled, 0)
  const projectRisk = projectMoney.reduce((s, m) => s + m.risk, 0)

  // Logged direct costs for projects
  const projectLoggedDirectCosts = logs.reduce((s, l) => {
    const matC = num(l.mat)
    const mileC = num(l.miles) * mileRate
    const labC = num(l.hrs) * opCostRate
    return s + matC + mileC + labC
  }, 0)

  // Active vs open project money
  const activeProjectMoney = projectMoney.filter(m => resolveProjectBucket(m.p) === 'active')
  const openProjectMoney = projectMoney.filter(m => resolveProjectBucket(m.p) !== 'completed')

  // Active AR with fallback logic
  const receivableFallback = (m: any) => {
    const b = num(m.billed), p = num(m.paid), r = num(m.risk), a = num(m.ar)
    return b > 0 ? Math.max(0, b - p) : Math.max(0, a || r)
  }
  const activeProjectAR = activeProjectMoney.reduce((s, m) => s + receivableFallback(m), 0)
  const forecastedProjectAR = openProjectMoney.reduce((s, m) => s + Math.max(0, num(m.risk)), 0)

  // ── 4 KPIs ─────────────────────────────────────────────────────────────
  const grossRevenue = projectContract + svcQuoted
  const cashReceived = projectPaid + svcCollected
  const netRevenue = (projectContract - projectLoggedDirectCosts) + svcProfit
  const totalExposure = projectAR + projectUnbilled + Math.max(0, svcOutstanding)

  // 52-week accum
  const ytdAccum = weeklyData.length > 0 ? num(weeklyData[weeklyData.length - 1]?.accum) : 0

  // ── 8 HEADER KPIs (Per-Business Summary) ────────────────────────────────────
  // 1. Total Pipeline = sum of all active project contracts + service unbilled
  const totalPipeline = projectContract + Math.max(0, svcQuoted - svcCollected)

  // 2. Total Collected = sum of project paid + service collected
  const totalCollected = projectPaid + svcCollected

  // 3. Total Material Cost = sum of mat field across all logs + service logs
  const projectMatCost = projectMoney.reduce((s, m) => s + logs.filter(l => l.projectId === m.p.id).reduce((ls, l) => ls + num(l.mat), 0), 0)
  const totalMatCost = projectMatCost + svcMatTotal

  // 4. Total Labor Cost = sum of hours × costRate across all logs
  const totalLaborCost = projectMoney.reduce((s, m) => s + logs.filter(l => l.projectId === m.p.id).reduce((ls, l) => ls + (num(l.hrs) * opCostRate), 0), 0) + svcOpTotal

  // 5. Total Mileage Cost = sum of miles × mileRate across all logs + service logs
  const totalMileageCost = projectMoney.reduce((s, m) => s + logs.filter(l => l.projectId === m.p.id).reduce((ls, l) => ls + (num(l.miles) * mileRate), 0), 0) + svcMilesTotal

  // 6. Combined Total Cost = mat + labor + mileage
  const combinedTotalCost = totalMatCost + totalLaborCost + totalMileageCost

  // 7. Gross Margin % = ((collected - totalCost) / collected × 100)
  const grossMarginPct = totalCollected > 0 ? ((totalCollected - combinedTotalCost) / totalCollected) * 100 : 0

  // 8. Balance Left = total pipeline - total collected
  const balanceLeft = totalPipeline - totalCollected

  // Generate AI insights for collections
  const generateMoneyInsights = (): Insight[] => {
    const insights: Insight[] = []

    // AR aging: flag projects with high exposure (> 50% of contract)
    const highExposure = projectMoney.filter(m => {
      const exposure = m.p.contract ? (m.unbilled / m.p.contract) * 100 : 0
      return exposure > 50
    })
    if (highExposure.length > 0) {
      insights.push({
        icon: '⚠️',
        text: `${highExposure.length} project(s) have >50% exposure. Prioritize collections.`,
        severity: 'warning',
      })
    }

    // Collection priorities: highest balance + oldest date
    const overdue = projectMoney
      .filter(m => m.unbilled > 1000)
      .sort((a, b) => {
        const aDays = daysSince(a.p.lastCollectDate || '1970-01-01')
        const bDays = daysSince(b.p.lastCollectDate || '1970-01-01')
        return bDays - aDays
      })
      .slice(0, 3)

    if (overdue.length > 0) {
      const topName = overdue[0].p.name
      const topAR = fmtK(overdue[0].unbilled)
      insights.push({
        icon: 'ℹ️',
        text: `Top follow-up: ${topName} (${topAR} AR, ${daysSince(overdue[0].p.lastCollectDate || '1970-01-01')} days).`,
        severity: 'info',
      })
    }

    // Margin check
    if (grossMarginPct < 30) {
      insights.push({
        icon: '⚠️',
        text: `Gross margin is ${grossMarginPct.toFixed(1)}%. Below 30% threshold — review pricing.`,
        severity: 'warning',
      })
    } else if (grossMarginPct >= 45) {
      insights.push({
        icon: '✓',
        text: `Gross margin is healthy at ${grossMarginPct.toFixed(1)}%.`,
        severity: 'success',
      })
    }

    // Overall exposure
    const totalExposure = projectMoney.reduce((s, m) => s + m.unbilled, 0)
    if (totalExposure > totalCollected) {
      insights.push({
        icon: 'ℹ️',
        text: `Total exposure (${fmtK(totalExposure)}) exceeds collected. Cash flow risk.`,
        severity: 'warning',
      })
    }

    if (insights.length === 0) {
      insights.push({
        icon: '✓',
        text: 'Collections and margins look solid.',
        severity: 'success',
      })
    }

    return insights
  }

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-6 space-y-6">

      {/* Header with AI button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Financial Overview</h2>
        <AskAIButton onClick={() => setAiOpen(true)} />
      </div>

      {/* ── 8 HEADER KPI CARDS (Per-Business Summary) ──────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { lbl: 'Total Pipeline', val: fmtK(totalPipeline), sub: 'Contracts + Unbilled' },
          { lbl: 'Total Collected', val: fmtK(totalCollected), sub: 'Projects + Service', clr: '#10b981' },
          { lbl: 'Total Material Cost', val: fmtK(totalMatCost), sub: 'All materials', isMaterialCard: true },
          { lbl: 'Total Labor Cost', val: fmtK(totalLaborCost), sub: 'All hours × rate' },
          { lbl: 'Total Mileage Cost', val: fmtK(totalMileageCost), sub: 'All miles × rate' },
          { lbl: 'Combined Total Cost', val: fmtK(combinedTotalCost), sub: 'Mat + Labor + Mile' },
          { lbl: 'Gross Margin %', val: grossMarginPct.toFixed(1) + '%', sub: '(Collected - Cost) / Collected', clr: grossMarginPct >= 50 ? '#10b981' : grossMarginPct >= 30 ? '#f59e0b' : '#ef4444' },
          { lbl: 'Balance Left', val: fmtK(balanceLeft), sub: 'Pipeline - Collected', clr: balanceLeft >= 0 ? '#10b981' : '#ef4444' },
        ].map((k: any, i) => (
          <div key={i} className="bg-[var(--bg-card)] border border-gray-700/50 rounded-lg p-3">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">{k.lbl}</div>
            <div className="text-lg font-bold font-mono mt-1" style={{ color: k.clr || '#f0f0ff' }}>{k.val}</div>
            {k.isMaterialCard ? (
              <div className="mt-1 space-y-0.5">
                <div className="text-[10px] text-gray-500">Projects: <span className="text-gray-400 font-mono">{fmtK(projectMatCost)}</span></div>
                <div className="text-[10px] text-gray-500">Service Calls: <span className="text-gray-400 font-mono">{fmtK(svcMatTotal)}</span></div>
              </div>
            ) : (
              <div className="text-[10px] text-gray-600 mt-0.5">{k.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* ── BUSINESS HEALTH OVERVIEW (Dual-Ring Doughnut Chart) ──────────── */}
      <ChartErrorBoundary>
        <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Business Health Overview</h3>
          <BusinessHealthChart backup={backup} />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 text-[10px]">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full" />
              <span className="text-gray-300">Pipeline: <span className="font-mono font-bold">{fmtK(projectContract)}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full" />
              <span className="text-gray-300">Paid: <span className="font-mono font-bold">{fmtK(projectPaid)}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full" />
              <span className="text-gray-300">Unbilled: <span className="font-mono font-bold">{fmtK(projectUnbilled)}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-red-500 rounded-full" />
              <span className="text-gray-300">Overhead: <span className="font-mono font-bold">{fmtK(projectPaid * (num(settings.overheadPct || 30) / 100))}</span></span>
            </div>
          </div>
        </div>
      </ChartErrorBoundary>

      {/* ── 4 KPI PILLS ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { cls: 'border-l-emerald-500', lbl: 'Gross Revenue', val: fmtK(grossRevenue), sub: 'Contract + Quoted' },
          { cls: 'border-l-blue-500', lbl: 'Cash Received', val: fmtK(cashReceived), sub: 'Projects + Service' },
          { cls: 'border-l-cyan-500', lbl: 'Net Revenue', val: fmtK(netRevenue), sub: 'After direct costs', color: netRevenue >= 0 ? '#10b981' : '#ef4444' },
          { cls: 'border-l-red-500', lbl: 'Total Exposure', val: fmtK(totalExposure), sub: 'AR + Unbilled + Svc' },
        ].map((k, i) => (
          <div key={i} className={`rounded-lg border border-gray-800 border-l-4 ${k.cls} bg-[var(--bg-card)] p-3`}>
            <div className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">{k.lbl}</div>
            <div className="text-lg font-bold font-mono mt-1" style={{ color: k.color || '#f0f0ff' }}>{k.val}</div>
            <div className="text-[9px] text-gray-500 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── SERVICE JOB PERFORMANCE ──────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Service Job Performance</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { lbl: 'Jobs Logged', val: String(svcCount) },
            { lbl: 'Jobs Paid', val: String(svcPaidCount) },
            { lbl: 'Quoted Revenue', val: fmtK(svcQuoted) },
            { lbl: 'Collected Cash', val: fmtK(svcCollected), clr: '#10b981' },
            { lbl: 'Material Cost', val: fmtK(svcMatTotal), clr: '#f59e0b' },
            { lbl: 'Mileage Cost', val: fmtK(svcMilesTotal) },
            { lbl: 'Operating Cost', val: fmtK(svcOpTotal) },
            { lbl: 'Avg Ticket', val: fmtK(svcAvgTicket) },
            { lbl: 'Outstanding', val: fmtK(svcOutstanding), clr: svcOutstanding > 0 ? '#ef4444' : '#10b981' },
            { lbl: 'Margin', val: svcMargin.toFixed(1) + '%', clr: svcMargin >= 50 ? '#10b981' : svcMargin >= 30 ? '#f59e0b' : '#ef4444' },
            { lbl: 'Net Profit', val: fmtK(svcProfit), clr: svcProfit >= 0 ? '#10b981' : '#ef4444' },
          ].map((m, i) => (
            <div key={i} className="bg-[var(--bg-input)] rounded-lg p-2.5">
              <div className="text-[8px] uppercase text-gray-500 font-bold tracking-wider">{m.lbl}</div>
              <div className="text-sm font-bold font-mono mt-1" style={{ color: m.clr || '#e5e7eb' }}>{m.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── BUSINESS ROLL-UP ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Business Roll-Up</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { lbl: 'Project Contract', val: fmtK(projectContract) },
            { lbl: 'Service Quoted', val: fmtK(svcQuoted) },
            { lbl: 'Project Paid', val: fmtK(projectPaid), clr: '#10b981' },
            { lbl: 'Service Collected', val: fmtK(svcCollected), clr: '#10b981' },
            { lbl: 'Active Project AR', val: fmtK(activeProjectAR), clr: '#f59e0b' },
            { lbl: 'Forecasted AR', val: fmtK(forecastedProjectAR), clr: '#f97316' },
            { lbl: 'Service Outstanding', val: fmtK(svcOutstanding), clr: svcOutstanding > 0 ? '#ef4444' : '#10b981' },
            { lbl: 'Project Unbilled', val: fmtK(projectUnbilled), clr: '#ef4444' },
            { lbl: 'Logged Direct Costs', val: fmtK(projectLoggedDirectCosts) },
            { lbl: '52-Week Accum', val: fmtK(ytdAccum), clr: '#3b82f6' },
            { lbl: 'Total Direct Costs', val: fmtK(projectLoggedDirectCosts + svcDirectCosts) },
          ].map((m, i) => (
            <div key={i} className="bg-[var(--bg-input)] rounded-lg p-2.5">
              <div className="text-[8px] uppercase text-gray-500 font-bold tracking-wider">{m.lbl}</div>
              <div className="text-sm font-bold font-mono mt-1" style={{ color: m.clr || '#e5e7eb' }}>{m.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── EXPOSURE FRAMEWORK ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Exposure Framework</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-gray-500 uppercase border-b border-gray-700">
                <th className="text-left py-2 px-2 font-bold">Project</th>
                <th className="text-right py-2 px-2 font-bold">Contract</th>
                <th className="text-right py-2 px-2 font-bold">Billed</th>
                <th className="text-right py-2 px-2 font-bold">Paid</th>
                <th className="text-right py-2 px-2 font-bold">Retention</th>
                <th className="text-right py-2 px-2 font-bold">Unbilled</th>
                <th className="text-right py-2 px-2 font-bold">AR</th>
                <th className="text-right py-2 px-2 font-bold">Risk</th>
                <th className="text-left py-2 px-2 font-bold">Signal</th>
              </tr>
            </thead>
            <tbody>
              {projectMoney.map(m => {
                const retP = m.contract > 0 ? (1 - (m.paid / m.contract)) * 100 : 100
                const d = daysSince(m.p.lastMove)
                const pp = m.paid / Math.max(m.contract, 1)

                // Signal logic
                let sig = '', sigClr = ''
                if (m.paid > 0 && pp < 0.3) { sig = 'First pay in'; sigClr = '#10b981' }
                else if (pp >= 0.8) { sig = 'Near complete'; sigClr = '#10b981' }
                else if (m.ar > 0 && m.ar < m.contract * 0.15) { sig = 'Small AR risk'; sigClr = '#f59e0b' }
                else if (m.ar >= m.contract * 0.15) { sig = 'Big AR risk'; sigClr = '#f59e0b' }
                else if (m.unbilled < m.contract * 0.2 && m.unbilled > 0) { sig = 'Unbilled low'; sigClr = '#ef4444' }
                else if (d > 14 && !m.paid) { sig = 'Money stalled'; sigClr = '#ef4444' }

                return (
                  <tr key={m.p.id} className="border-b border-gray-800/50 hover:bg-gray-700/20">
                    <td className="py-2 px-2 text-gray-200 font-semibold">{m.p.name}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{fmtK(m.contract)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-300">{fmtK(m.billed)}</td>
                    <td className="py-2 px-2 text-right font-mono text-emerald-400">{fmtK(m.paid)}</td>
                    <td className="py-2 px-2 text-right font-mono text-gray-400">{retP.toFixed(0)}%</td>
                    <td className="py-2 px-2 text-right font-mono text-red-400">{fmtK(m.unbilled)}</td>
                    <td className="py-2 px-2 text-right font-mono text-yellow-400">{fmtK(m.ar)}</td>
                    <td className="py-2 px-2 text-right font-mono text-orange-400">{fmtK(m.risk)}</td>
                    <td className="py-2 px-2" style={{ color: sigClr }}>{sig || '\u2014'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CASH WATERFALL (Premium Quality) ────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Cash Waterfall</h3>
        <div className="space-y-4">
          {projectMoney.map(m => {
            const tot = Math.max(m.contract, 1)
            const paidPct = (m.paid / tot) * 100
            const arPct = (m.ar / tot) * 100
            const unbilledPct = (m.unbilled / tot) * 100

            return (
              <div key={m.p.id} className="bg-[var(--bg-input)] rounded-lg p-3.5 border border-gray-700/30 hover:border-gray-600/50 transition-colors">
                {/* Header with project name and total contract */}
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[11px] font-semibold text-gray-200">{m.p.name}</span>
                  <span className="text-[10px] font-mono text-gray-400">Contract: {fmtK(m.contract)}</span>
                </div>

                {/* Premium horizontal stacked bar */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-6 bg-gray-700/30 rounded overflow-hidden flex" title={`Contract: $${m.contract} | Billed: $${m.billed} | Paid: $${m.paid} | AR: $${m.ar} | Unbilled: $${m.unbilled}`}>
                    {/* Green segment = Paid (collected) */}
                    {paidPct > 0 && (
                      <div
                        style={{ width: `${paidPct}%` }}
                        className="bg-emerald-500 h-full flex items-center justify-center text-[9px] font-bold text-white transition-all hover:bg-emerald-600"
                        title={`Paid: $${m.paid}`}
                      >
                        {paidPct > 12 && <span className="drop-shadow-md">${fmtK(m.paid)}</span>}
                      </div>
                    )}

                    {/* Yellow segment = AR (billed but not paid) */}
                    {arPct > 0 && (
                      <div
                        style={{ width: `${arPct}%` }}
                        className="bg-yellow-500 h-full flex items-center justify-center text-[9px] font-bold text-gray-900 transition-all hover:bg-yellow-600"
                        title={`AR (Billed): $${m.ar}`}
                      >
                        {arPct > 12 && <span className="drop-shadow-md">${fmtK(m.ar)}</span>}
                      </div>
                    )}

                    {/* Red segment = Unbilled (contract - billed) */}
                    {unbilledPct > 0 && (
                      <div
                        style={{ width: `${unbilledPct}%` }}
                        className="bg-red-500 h-full flex items-center justify-center text-[9px] font-bold text-white transition-all hover:bg-red-600"
                        title={`Unbilled: $${m.unbilled}`}
                      >
                        {unbilledPct > 12 && <span className="drop-shadow-md">${fmtK(m.unbilled)}</span>}
                      </div>
                    )}
                  </div>

                  {/* Right-side total label */}
                  <span className="text-[10px] font-mono text-gray-500 w-16 text-right">${fmtK(m.contract)}</span>
                </div>

                {/* Detailed breakdown footer */}
                <div className="grid grid-cols-4 gap-2 mt-2.5 text-[9px]">
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full" />
                    <span className="text-gray-400">Paid: <span className="font-mono font-semibold text-gray-200">${fmtK(m.paid)}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 bg-yellow-500 rounded-full" />
                    <span className="text-gray-400">AR: <span className="font-mono font-semibold text-gray-200">${fmtK(m.ar)}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 bg-red-500 rounded-full" />
                    <span className="text-gray-400">Unbilled: <span className="font-mono font-semibold text-gray-200">${fmtK(m.unbilled)}</span></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 bg-blue-500 rounded-full" />
                    <span className="text-gray-400">Billed: <span className="font-mono font-semibold text-gray-200">${fmtK(m.billed)}</span></span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── PAYMENT TRACKER ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
        <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Payment Tracker</h3>
        <div className="space-y-3">
          {[...projectMoney].sort((a, b) => b.contract - a.contract).map(m => {
            const tot = Math.max(m.contract, 1)
            const paidPct = Math.min(100, (m.paid / tot) * 100)
            const arPct = Math.min(100 - paidPct, (m.ar / tot) * 100)
            const pp = m.paid / Math.max(m.contract, 1)

            let chip = '', chipClr = ''
            if (m.contract === 0) { chip = 'No quote'; chipClr = '#6b7280' }
            else if (m.paid >= m.contract) { chip = 'Paid in full'; chipClr = '#10b981' }
            else if (m.paid === 0 && m.billed === 0) { chip = 'Not started'; chipClr = '#6b7280' }
            else if (pp < 0.3) { chip = 'Deposit in'; chipClr = '#3b82f6' }
            else if (pp < 0.8) { chip = 'In progress'; chipClr = '#f59e0b' }
            else { chip = 'Near done'; chipClr = '#10b981' }

            return (
              <div key={m.p.id} className="bg-[var(--bg-input)] rounded-lg p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <span className="text-xs font-semibold text-gray-200">{m.p.name}</span>
                    <span className="text-[9px] text-gray-500 ml-2">{m.p.type}</span>
                  </div>
                  <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ background: chipClr + '22', color: chipClr }}>{chip}</span>
                </div>
                <div className="flex h-2 rounded overflow-hidden bg-gray-700/50">
                  {paidPct > 0 && <div style={{ width: `${paidPct}%`, background: '#10b981' }} />}
                  {arPct > 0 && <div style={{ width: `${arPct}%`, background: '#f59e0b' }} />}
                </div>
                <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                  <span>Paid {fmtK(m.paid)} ({paidPct.toFixed(0)}%)</span>
                  <span>Contract {fmtK(m.contract)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 52-WEEK VISUALIZATION ────────────────────────────────────────── */}
      {weeklyData.length > 0 && (
  <div className="rounded-xl border border-gray-800 bg-[var(--bg-card)] p-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">52-Week Cash Flow</h3>
      <div className="flex gap-2">
        <button
          onClick={recalcWeeklyFromData}
          disabled={recalculating}
          className="px-2 py-1 rounded text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-600/30 hover:bg-blue-600/30 transition-all disabled:opacity-50"
        >
          {recalculating ? 'Recalculating...' : 'Recalculate from Data'}
        </button>
        <button
          onClick={() => setShowWeeklyGaps(!showWeeklyGaps)}
          className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
            showWeeklyGaps
              ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30'
              : 'bg-gray-700/30 text-gray-400 border border-gray-600/30'
          }`}
        >
          {showWeeklyGaps ? 'Hide Gaps' : 'Show Gaps'}
        </button>
      </div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-gray-500 uppercase border-b border-gray-700">
            <th className="text-left py-2 px-1 font-bold">Wk</th>
            <th className="text-left py-2 px-1 font-bold">Start</th>
            <th className="text-right py-2 px-1 font-bold">Income</th>
            <th className="text-right py-2 px-1 font-bold">Project</th>
            <th className="text-right py-2 px-1 font-bold">Service</th>
            <th className="text-right py-2 px-1 font-bold">Unbilled</th>
            <th className="text-right py-2 px-1 font-bold">Pending</th>
            <th className="text-right py-2 px-1 font-bold">Exposure</th>
            <th className="text-right py-2 px-1 font-bold">Accum</th>
          </tr>
        </thead>
        <tbody>
          {weeklyData.map((w: any) => {
            const inc = num(w.proj) + num(w.svc)
            const exposure = num(w.unbilled) + num(w.pendingInv)

            // Determine week status
            const today = new Date()
            const weekStart = w.start ? new Date(w.start) : null
            const isCurrentWeek = weekStart && weekStart <= today && new Date(weekStart.getTime() + 7 * 86400000) > today
            const isPast = weekStart && weekStart < today && !isCurrentWeek
            const hasNoActivity = num(w.proj) === 0 && num(w.svc) === 0
            const isGapWeek = isPast && hasNoActivity && showWeeklyGaps

            // Row styling
            let rowBorderClass = ''
            let rowBgClass = ''
            if (isCurrentWeek) {
              rowBorderClass = 'border-l-2 border-l-blue-500'
              rowBgClass = 'bg-blue-500/5'
            } else if (isGapWeek) {
              rowBorderClass = 'border-l-2 border-l-amber-500/60'
              rowBgClass = 'bg-amber-500/5'
            }

            return (
              <tr key={w.wk} className={`border-b border-gray-800/30 ${rowBorderClass} ${rowBgClass}`}>
                <td className="py-1.5 px-1 font-mono text-gray-300">{w.wk}</td>
                <td className="py-1.5 px-1 font-mono text-gray-300">{w.start}</td>
                <td className="py-1.5 px-1 text-right font-mono text-gray-300">{inc || '\u2014'}</td>
                <td className="py-1.5 px-1 text-right font-mono text-gray-300">
                  {isGapWeek && !w.proj ? (
                    <span className="text-amber-500/70 text-[9px]">📅 No activity</span>
                  ) : (w.proj || '\u2014')}
                </td>
                <td className="py-1.5 px-1 text-right font-mono text-gray-300">
                  {isGapWeek && !w.svc ? (
                    <span className="text-amber-500/70 text-[9px]">📅 No activity</span>
                  ) : (w.svc || '\u2014')}
                </td>
                <td className="py-1.5 px-1 text-right font-mono text-gray-300">{w.unbilled || '\u2014'}</td>
                <td className="py-1.5 px-1 text-right font-mono text-gray-300">{w.pendingInv || '\u2014'}</td>
                <td className="py-1.5 px-1 text-right font-mono" style={{ color: exposure > 0 ? '#ef4444' : undefined }}>{exposure || '\u2014'}</td>
                <td className="py-1.5 px-1 text-right font-mono font-bold" style={{ color: '#3b82f6' }}>
                  {w.accum || '\u2014'}
                  {isCurrentWeek && <span className="ml-1 text-blue-400 text-[9px]">← Current</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  </div>
      )}

      <AskAIPanel
        panelName="Money"
        insights={generateMoneyInsights()}
        dataContext={{
          totalPipeline,
          totalCollected,
          grossMarginPct,
          balanceLeft,
          totalMatCost,
          totalLaborCost,
          totalMileageCost,
          combinedTotalCost,
          activeProjects: projectMoney.length,
          highExposureProjects: projectMoney.filter(m => {
            const exposure = m.p.contract ? (m.unbilled / m.p.contract) * 100 : 0
            return exposure > 50
          }).map(m => ({ name: m.p.name, unbilled: m.unbilled, contract: m.p.contract })),
          serviceTotals: { quoted: svcQuoted, collected: svcCollected, outstanding: svcOutstanding },
        }}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}
