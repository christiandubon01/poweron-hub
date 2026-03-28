// @ts-nocheck
/**
 * V15rTeamPanel.tsx — Team member management with owner override & interactive org pyramid
 *
 * Features:
 * - Employee cards with: name, role, bill rate, cost rate, isOwner flag
 * - Owner labor burden override: 1.20x payroll multiplier defaults OFF, togglable per employee
 * - Labor Burden box: bill rate, cost rate, payroll multiplier, workers comp, effective loaded cost, margin
 * - Projected Monthly Cost: sum of (hours logged × loaded cost) per employee
 * - Interactive Org Pyramid: owner at top, employees below, add hypothetical positions
 * - Hypothetical positions: state-stored (not saved), show monthly cost/revenue/margin/utilization
 * - AI Hire Suggestion (NEXUS): placeholder analysis card
 * - Hours by Employee table: from backup.logs grouped by empId
 * - Full CRUD on employees
 */

import React, { useMemo, useState, useEffect, useRef } from 'react'
import { Users, Sparkles, AlertCircle, Plus, Trash2, Edit2, TrendingUp, Zap } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  num,
  fmt,
  fmtK,
  type BackupEmployee,
  type BackupLog,
  type BackupData,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'

interface EnhancedEmployee extends BackupEmployee {
  isOwner?: boolean
  applyMultiplier?: boolean
}

interface HypotheticalPosition {
  id: string
  title: string
  roleType: string
  billRate: number
  costRate: number
  projectedHoursMonth: number
}

interface CostAnalysisState {
  [hypId: string]: boolean
}

// ── ERROR BOUNDARY ──
class ChartErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: string}> {
  state = { hasError: false, error: '' }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ChartErrorBoundary caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-64 bg-[var(--bg-card)] rounded-lg p-6 text-red-400">
          <div className="text-center">
            <p className="font-semibold mb-2">Chart Error</p>
            <p className="text-sm">{this.state.error}</p>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// ── HELPER: Dynamically load Chart.js from CDN ──
function useChartJS() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if ((window as any).Chart) {
      setReady(true)
      return
    }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'
    s.onload = () => setReady(true)
    s.onerror = () => console.error('Failed to load Chart.js')
    document.head.appendChild(s)
  }, [])
  return ready
}

// ── COST VS PIPELINE CHART COMPONENT ──
function CostVsPipelineChart({ backup }: { backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  useEffect(() => {
    if (!chartReady || !canvasRef.current) return

    const Chart = (window as any).Chart
    if (!Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    // Build 6-month data: last 3 months + next 3 months
    const today = new Date()
    const months: { date: Date; label: string }[] = []

    // Last 3 months
    for (let i = 3; i >= 1; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      months.push({
        date: d,
        label: d.toLocaleDateString('en-US', { month: 'short' })
      })
    }

    // Current month
    months.push({
      date: new Date(today.getFullYear(), today.getMonth(), 1),
      label: today.toLocaleDateString('en-US', { month: 'short' })
    })

    // Next 2 months
    for (let i = 1; i <= 2; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
      months.push({
        date: d,
        label: d.toLocaleDateString('en-US', { month: 'short' })
      })
    }

    const labels = months.map(m => m.label)
    const employeeCosts: number[] = []
    const pipelineRevenues: number[] = []

    const employees = backup.employees || []
    const logs = backup.logs || []
    const projects = backup.projects || []

    // Calculate for each month
    months.forEach((month) => {
      const monthStart = month.date
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)

      // Employee costs: sum of team member costs for logs in this month
      let monthCost = 0
      logs.forEach(log => {
        if (log.date) {
          const logDate = new Date(log.date)
          if (logDate >= monthStart && logDate <= monthEnd) {
            const emp = employees.find(e => e.id === log.empId)
            const costRate = num(emp?.costRate || 0)
            monthCost += num(log.hrs || 0) * costRate
          }
        }
      })
      employeeCosts.push(monthCost)

      // Pipeline revenue: sum of active project contracts active in this month
      let monthPipeline = 0
      projects.forEach(proj => {
        if (proj.status === 'active' || proj.status === 'coming') {
          monthPipeline += num(proj.contract || 0)
        }
      })
      pipelineRevenues.push(monthPipeline)
    })

    // Set Chart.js defaults
    Chart.defaults.color = '#9ca3af'
    Chart.defaults.borderColor = 'rgba(255,255,255,0.05)'

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Employee Cost',
            data: employeeCosts,
            backgroundColor: '#3b82f6',
            borderColor: 'rgba(59, 130, 246, 0.5)',
            borderWidth: 1
          },
          {
            label: 'Pipeline Revenue',
            data: pipelineRevenues,
            backgroundColor: '#10b981',
            borderColor: 'rgba(16, 185, 129, 0.5)',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 8,
            titleFont: { size: 12 },
            bodyFont: { size: 11 },
            callbacks: {
              label: (ctx: any) => {
                const label = ctx.dataset.label || ''
                const value = ctx.parsed.y || 0
                return `${label}: $${Number(value).toLocaleString()}`
              }
            }
          },
          legend: {
            labels: { color: '#9ca3af', font: { size: 12 } }
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            stacked: true,
            ticks: {
              color: '#9ca3af',
              callback: (v: any) => '$' + (Number(v) / 1000).toFixed(0) + 'k'
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, backup])

  return <canvas ref={canvasRef} />
}

// ── EMPLOYEE COST STRUCTURE COMPONENT ──
function EmployeeCostStructure({ backup }: { backup: BackupData }) {
  const settings = backup?.settings || {}
  const [costs, setCosts] = useState(settings.employeeCosts || [
    { id: 'wc', label: 'Workers Comp', amount: 0 },
    { id: 'pp', label: 'Payroll Processing', amount: 0 },
    { id: 'hi', label: 'Health Insurance', amount: 0 },
    { id: 'ben', label: 'Benefits', amount: 0 },
    { id: 'li', label: 'Liability Insurance', amount: 0 },
    { id: 'oth', label: 'Other', amount: 0 },
  ])
  const [payrollMult, setPayrollMult] = useState(settings.payrollMult || 1.20)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResponse, setAiResponse] = useState('')

  const monthlyTotal = costs.reduce((s, c) => s + (c.amount || 0), 0)
  const annualTotal = monthlyTotal * 12

  const persist = () => {
    pushState()
    backup.settings.employeeCosts = costs
    backup.settings.payrollMult = payrollMult
    saveBackupData(backup)
  }

  const analyzeRates = async () => {
    setAiLoading(true)
    setAiResponse('')

    try {
      const fullBackup = getBackupData()

      // Calculate pipeline total
      const pipelineTotal = (fullBackup.projects || []).reduce((sum, p) => {
        return sum + (num(p.contract) || 0)
      }, 0)

      // Calculate monthly service pace
      const serviceLogs = fullBackup.serviceLogs || []
      const totalServiceQuoted = serviceLogs.reduce((sum, log) => {
        return sum + (num(log.quoted) || 0)
      }, 0)
      const monthlyServicePace = totalServiceQuoted / 12

      const systemPrompt = "You are a business cost advisor for a small California electrical contractor. Analyze these employee costs and revenue numbers and provide: (1) whether the payroll multiplier is appropriate for California C-10 contractors, (2) at what monthly revenue this employee structure becomes profitable, (3) specific rate suggestions if costs seem high or low relative to industry norms, (4) one actionable recommendation. Be concise and specific with dollar amounts."

      const userMessage = `Cost Structure Analysis Request:

Cost Items (Monthly):
${JSON.stringify(costs, null, 2)}

Payroll Multiplier: ${payrollMult}x
Personal Income Goal: ${fmt((fullBackup.settings?.personalIncomeGoal || 0))}
Pipeline Total: ${fmt(pipelineTotal)}
Monthly Service Pace (Avg): ${fmt(monthlyServicePace)}`

      const data = await callClaude({
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      })

      setAiResponse(extractText(data))
    } catch (error) {
      setAiResponse(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`)
    } finally {
      setAiLoading(false)
    }
  }

  const addCostItem = () => {
    const newId = 'other-' + Date.now()
    setCosts([...costs, { id: newId, label: 'Other', amount: 0 }])
  }

  const deleteCostItem = (id: string) => {
    setCosts(costs.filter(c => c.id !== id))
  }

  const updateCostItem = (id: string, field: 'label' | 'amount', value: any) => {
    setCosts(costs.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
      <h2 className="text-lg font-bold text-gray-100 mb-6">Employee Cost Structure</h2>

      {/* Cost Line Items */}
      <div className="space-y-3 mb-6">
        {costs.map((cost) => (
          <div key={cost.id} className="flex gap-3 items-center">
            <input
              type="text"
              value={cost.label}
              onChange={(e) => updateCostItem(cost.id, 'label', e.target.value)}
              className="flex-1 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-blue-600"
              placeholder="Item name"
            />
            <div className="flex items-center">
              <span className="text-gray-500 mr-2">$</span>
              <input
                type="number"
                value={cost.amount || ''}
                onChange={(e) => updateCostItem(cost.id, 'amount', parseFloat(e.target.value) || 0)}
                className="w-32 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-blue-600"
                placeholder="0"
                step="0.01"
              />
              <span className="text-gray-500 ml-2">/mo</span>
            </div>
            <button
              onClick={() => deleteCostItem(cost.id)}
              className="px-2 py-2 bg-red-600/30 text-red-400 rounded hover:bg-red-600/50 transition"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Add Cost Item Button */}
      <button
        onClick={addCostItem}
        className="mb-6 w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600/30 text-blue-300 rounded-lg hover:bg-blue-600/50 transition text-sm font-semibold"
      >
        <Plus className="w-4 h-4" />
        Add Cost Item
      </button>

      {/* Payroll Multiplier */}
      <div className="mb-6 pb-6 border-b border-gray-700">
        <div className="flex justify-between items-center">
          <label className="text-sm font-semibold text-gray-300">Payroll Multiplier</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={payrollMult}
              onChange={(e) => setPayrollMult(parseFloat(e.target.value) || 1.20)}
              step="0.01"
              min="1.0"
              className="w-20 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-blue-600"
            />
            <span className="text-gray-500">x</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">Applied to employee base cost to calculate loaded cost</p>
      </div>

      {/* Totals */}
      <div className="space-y-3">
        <div className="flex justify-between items-baseline">
          <span className="text-gray-400">Monthly Total</span>
          <span className="text-xl font-bold text-emerald-400">{formatCurrency(monthlyTotal)}</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-gray-400">Annual Total</span>
          <span className="text-xl font-bold text-blue-400">{formatCurrency(annualTotal)}</span>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={persist}
        className="mt-6 w-full px-4 py-2 bg-emerald-600/50 text-emerald-300 rounded-lg hover:bg-emerald-600/70 transition font-semibold text-sm"
      >
        Save Cost Structure
      </button>

      {/* AI Rate Analysis */}
      <button
        onClick={analyzeRates}
        disabled={aiLoading}
        className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600/30 text-yellow-300 rounded-lg hover:bg-yellow-600/50 transition text-sm font-semibold disabled:opacity-50"
      >
        {aiLoading ? (
          <>
            <span className="animate-spin">⏳</span> Analyzing costs...
          </>
        ) : (
          <>
            <Zap className="w-4 h-4" /> AI Rate Analysis ⚡
          </>
        )}
      </button>

      {aiResponse && (
        <div className="mt-4 bg-[var(--bg-secondary)] rounded-lg border-2 border-yellow-500/50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-xs font-bold uppercase text-yellow-400">AI Rate Analysis</span>
          </div>
          <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{aiResponse}</div>
        </div>
      )}
    </div>
  )
}

// ── OWNER CARD ENHANCEMENT ──
function OwnerCard({ owner, backup }: { owner: EnhancedEmployee; backup: BackupData }) {
  const settings = backup?.settings || {}
  const personalIncomeGoal = num(settings.personalIncomeGoal || 0)
  const monthlyGoal = personalIncomeGoal / 12

  // Calculate YTD pace
  const projects = backup?.projects || []
  const logs = backup?.logs || []
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()
  const monthsElapsed = currentMonth + 1

  const ytdPaid = projects.reduce((sum, p) => {
    const paidAmount = num(p.paid || 0)
    const lastCollectedAt = p.lastCollectedAt
    if (lastCollectedAt) {
      const collectedDate = new Date(lastCollectedAt)
      if (collectedDate.getFullYear() === currentYear) {
        return sum + paidAmount
      }
    }
    return sum
  }, 0)

  const ytdPacePerMonth = monthsElapsed > 0 ? ytdPaid / monthsElapsed : 0
  const isOnPace = ytdPacePerMonth >= monthlyGoal

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-2xl font-bold text-blue-300">👑 {owner.name}</h3>
          <p className="text-sm text-gray-500 mt-1">{owner.role || 'Business Owner'}</p>
        </div>
        <span className="px-3 py-1 bg-blue-600/40 text-blue-300 rounded-full text-xs font-semibold">Owner</span>
      </div>

      {personalIncomeGoal > 0 && (
        <div className="space-y-4 mt-4">
          <div className="bg-[var(--bg-secondary)] rounded-lg p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">Personal Income Goal</div>
            <div className="flex justify-between items-baseline">
              <div className="text-2xl font-bold text-emerald-400">{formatCurrency(personalIncomeGoal)}</div>
              <div className="text-sm text-gray-400">({formatCurrency(monthlyGoal)}/mo)</div>
            </div>
          </div>

          <div className={`bg-[var(--bg-secondary)] rounded-lg p-4 border-l-4 ${isOnPace ? 'border-l-emerald-500' : 'border-l-red-500'}`}>
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1">YTD Pace</div>
            <div className="flex justify-between items-baseline">
              <div className={`text-2xl font-bold ${isOnPace ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatCurrency(ytdPacePerMonth)}
              </div>
              <div className={`text-xs font-semibold ${isOnPace ? 'text-emerald-400' : 'text-red-400'}`}>
                {isOnPace ? '✓ On pace' : '✗ Below goal'}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">{monthsElapsed} month{monthsElapsed !== 1 ? 's' : ''} elapsed</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── ENHANCED COST VS PIPELINE CHART ──
function EnhancedCostVsPipelineChart({ backup }: { backup: BackupData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<any>(null)
  const chartReady = useChartJS()

  useEffect(() => {
    if (!chartReady || !canvasRef.current) return

    const Chart = (window as any).Chart
    if (!Chart) return

    if (chartRef.current) {
      chartRef.current.destroy()
      chartRef.current = null
    }

    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const today = new Date()
    const months: { date: Date; label: string }[] = []

    // Next 6 months
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
      months.push({
        date: d,
        label: d.toLocaleDateString('en-US', { month: 'short' })
      })
    }

    const labels = months.map(m => m.label)
    const employeeCostData: number[] = []
    const ownerDrawData: number[] = []
    const overheadData: number[] = []
    const revenueData: number[] = []

    const employees = backup.employees || []
    const logs = backup.logs || []
    const projects = backup.projects || []
    const settings = backup.settings || {}
    const employeeCosts = settings.employeeCosts || []
    const personalIncomeGoal = num(settings.personalIncomeGoal || 0)
    const overheadPct = num(settings.overheadPct || 0)

    const monthlyEmployeeCosts = employeeCosts.reduce((s, c) => s + num(c.amount || 0), 0)
    const monthlyOwnerDraw = personalIncomeGoal / 12

    months.forEach((month) => {
      const monthStart = month.date
      const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0)

      // Employee costs (base + logged hours × cost rate)
      let monthLabor = monthlyEmployeeCosts
      logs.forEach(log => {
        if (log.date) {
          const logDate = new Date(log.date)
          if (logDate >= monthStart && logDate <= monthEnd) {
            const emp = employees.find(e => e.id === log.empId)
            const costRate = num(emp?.costRate || 0)
            monthLabor += num(log.hrs || 0) * costRate
          }
        }
      })
      employeeCostData.push(monthLabor)

      // Owner draw
      ownerDrawData.push(monthlyOwnerDraw)

      // Overhead (% of revenue)
      let monthRevenue = 0
      projects.forEach(proj => {
        if (proj.status === 'active' || proj.status === 'coming') {
          monthRevenue += num(proj.contract || 0)
        }
      })
      const monthOverhead = monthRevenue * (overheadPct / 100)
      overheadData.push(monthOverhead)
      revenueData.push(monthRevenue)
    })

    // Calculate totals for break-even line
    const totalMonthCost = months.map((_, i) => employeeCostData[i] + ownerDrawData[i] + overheadData[i])

    Chart.defaults.color = '#9ca3af'
    Chart.defaults.borderColor = 'rgba(255,255,255,0.05)'

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Employee Costs',
            data: employeeCostData,
            backgroundColor: '#ef4444',
            borderColor: 'rgba(239, 68, 68, 0.5)',
            borderWidth: 1
          },
          {
            label: 'Owner Draw',
            data: ownerDrawData,
            backgroundColor: '#f97316',
            borderColor: 'rgba(249, 115, 22, 0.5)',
            borderWidth: 1
          },
          {
            label: 'Overhead',
            data: overheadData,
            backgroundColor: '#eab308',
            borderColor: 'rgba(234, 179, 8, 0.5)',
            borderWidth: 1
          },
          {
            label: 'Projected Revenue',
            data: revenueData,
            type: 'line',
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 5,
            yAxisID: 'y'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#ccc',
            padding: 8,
            titleFont: { size: 12 },
            bodyFont: { size: 11 },
            callbacks: {
              label: (ctx: any) => {
                const label = ctx.dataset.label || ''
                const value = ctx.parsed.y || 0
                return `${label}: $${Number(value).toLocaleString()}`
              }
            }
          },
          legend: {
            labels: { color: '#9ca3af', font: { size: 12 } }
          }
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#9ca3af', font: { size: 10 } },
            grid: { display: false }
          },
          y: {
            stacked: true,
            ticks: {
              color: '#9ca3af',
              callback: (v: any) => '$' + (Number(v) / 1000).toFixed(0) + 'k'
            },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        }
      }
    })

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy()
        chartRef.current = null
      }
    }
  }, [chartReady, backup])

  return <canvas ref={canvasRef} />
}

// ── AI INSIGHT CARD ──
function AIInsightCard({ backup }: { backup: BackupData }) {
  const settings = backup?.settings || {}
  const projects = backup?.projects || []
  const employeeCosts = settings.employeeCosts || []
  const personalIncomeGoal = num(settings.personalIncomeGoal || 0)
  const overheadPct = num(settings.overheadPct || 0)

  const monthlyEmployeeCosts = employeeCosts.reduce((s, c) => s + num(c.amount || 0), 0)
  const monthlyOwnerDraw = personalIncomeGoal / 12
  const activeRevenue = projects
    .filter(p => p.status === 'active' || p.status === 'coming')
    .reduce((s, p) => s + num(p.contract || 0), 0)
  const monthlyRevenue = activeRevenue / 12
  const monthlyOverhead = monthlyRevenue * (overheadPct / 100)
  const totalMonthCost = monthlyEmployeeCosts + monthlyOwnerDraw + monthlyOverhead
  const monthlyDifference = monthlyRevenue - totalMonthCost

  let insight = ''
  if (monthlyDifference < 0) {
    insight = `At current pace, costs exceed revenue by ${formatCurrency(Math.abs(monthlyDifference))}/mo. Secure additional work to maintain profitability.`
  } else if (monthlyDifference === 0) {
    insight = `Revenue and costs are balanced. Current trajectory is break-even.`
  } else {
    insight = `Revenue exceeds costs by ${formatCurrency(monthlyDifference)}/mo. Current trajectory is profitable.`
  }

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border-2 border-yellow-500/50 p-6">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-5 h-5 text-yellow-400" />
        <span className="text-xs font-bold uppercase text-yellow-400 bg-yellow-600/30 px-2 py-1 rounded">AI Insight</span>
      </div>
      <p className="text-gray-200 text-sm leading-relaxed">{insight}</p>
      <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
        <div className="bg-[var(--bg-card)] rounded p-2">
          <div className="text-gray-500 mb-1">Monthly Costs</div>
          <div className="font-bold text-red-400">{formatCurrency(totalMonthCost)}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded p-2">
          <div className="text-gray-500 mb-1">Monthly Revenue</div>
          <div className="font-bold text-emerald-400">{formatCurrency(monthlyRevenue)}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded p-2">
          <div className="text-gray-500 mb-1">Monthly Gap</div>
          <div className={`font-bold ${monthlyDifference >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {monthlyDifference >= 0 ? '+' : ''}{formatCurrency(monthlyDifference)}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatCurrency(value: number | undefined): string {
  if (value === undefined || value === null) return '$0'
  return `$${Math.round(value).toLocaleString()}`
}

function NoData() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg-secondary)]">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-gray-500 mx-auto mb-4" />
        <p className="text-gray-400">No backup data available</p>
      </div>
    </div>
  )
}

function EmployeeCard({
  employee,
  totalHours,
  jobCount,
  monthlyHours,
  onToggleMultiplier,
}: {
  employee: EnhancedEmployee
  totalHours: number
  jobCount: number
  monthlyHours: number
  onToggleMultiplier: (empId: string) => void
}) {
  const billRate = num(employee.billRate)
  const costRate = num(employee.costRate)
  const isOwner = employee.isOwner || false
  const applyMultiplier = employee.applyMultiplier !== false ? true : isOwner ? false : true
  const payrollMultiplier = applyMultiplier ? 1.20 : 1.0
  const workersCompEst = applyMultiplier ? costRate * 0.08 : 0
  const loadedCost = costRate * payrollMultiplier + workersCompEst
  const marginPerHour = billRate - loadedCost
  const monthlyLoadedCost = monthlyHours * loadedCost

  const billAmount = totalHours * billRate
  const costAmount = totalHours * costRate
  const margin = billAmount - costAmount

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-bold text-gray-100 text-base">{employee.name}</h3>
          <p className="text-sm text-gray-500">{employee.role || 'Team Member'}</p>
        </div>
        {isOwner && <span className="text-xs px-2 py-1 bg-blue-600/40 text-blue-300 rounded">Owner 👑</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
        <div className="bg-[var(--bg-secondary)] rounded px-3 py-2">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">All Time Hrs</div>
          <div className="text-blue-400 font-semibold">{Math.round(totalHours)}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded px-3 py-2">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-1">All Jobs</div>
          <div className="text-emerald-400 font-semibold">{jobCount}</div>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Hour Rates</div>
        <div className="flex justify-between items-baseline text-sm mb-2">
          <span className="text-gray-400">Bill Rate</span>
          <span className="text-base font-bold text-emerald-400">{formatCurrency(billRate)}/hr</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-gray-400">Cost Rate</span>
          <span className="text-base font-bold text-orange-400">{formatCurrency(costRate)}/hr</span>
        </div>
      </div>

      {/* Labor Burden Calculator */}
      <div className="mb-4 pb-4 border-b border-gray-700">
        <div className="text-xs font-semibold text-gray-500 uppercase mb-3">Labor Burden</div>

        {/* Multiplier Toggle */}
        <div className="flex justify-between items-center text-sm mb-3 pb-3 border-b border-gray-700/50">
          <span className="text-gray-400">Apply payroll multiplier</span>
          <button
            onClick={() => onToggleMultiplier(employee.id)}
            className={`w-10 h-6 rounded-full transition ${
              applyMultiplier
                ? 'bg-emerald-600/60'
                : 'bg-gray-600/40'
            } flex items-center ${applyMultiplier ? 'justify-end' : 'justify-start'} px-1`}
          >
            <div className="w-4 h-4 bg-gray-100 rounded-full" />
          </button>
        </div>

        <div className="flex justify-between items-baseline text-sm mb-1">
          <span className="text-gray-400">Payroll Multiplier</span>
          <span className="text-gray-300">{payrollMultiplier.toFixed(2)}x</span>
        </div>
        {applyMultiplier && (
          <div className="flex justify-between items-baseline text-sm mb-1">
            <span className="text-gray-400">Workers Comp Est</span>
            <span className="text-gray-300">{workersCompEst.toFixed(2)}/hr</span>
          </div>
        )}
        <div className="flex justify-between items-baseline text-sm mb-1">
          <span className="text-gray-400">Effective Loaded Cost</span>
          <span className="text-amber-400 font-semibold">{formatCurrency(loadedCost)}/hr</span>
        </div>
        <div className="flex justify-between items-baseline text-sm">
          <span className="text-gray-400">Margin/Hour</span>
          <span className={marginPerHour > 0 ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>{formatCurrency(marginPerHour)}</span>
        </div>
      </div>

      <div className="pt-4 border-t border-gray-700">
        <div className="flex justify-between items-baseline mb-2 text-sm">
          <span className="text-gray-400">Total Billable</span>
          <span className="text-lg font-bold text-blue-400">{formatCurrency(billAmount)}</span>
        </div>
        <div className="flex justify-between items-baseline mb-2 text-sm">
          <span className="text-gray-400">Total Cost</span>
          <span className="text-lg font-bold text-orange-400">{formatCurrency(costAmount)}</span>
        </div>
        <div className="flex justify-between items-baseline pt-2 border-t border-gray-700 text-sm">
          <span className="font-semibold text-gray-300">Profit Margin</span>
          <span className={margin > 0 ? 'text-base font-bold text-emerald-400' : 'text-base font-bold text-red-400'}>{formatCurrency(margin)}</span>
        </div>
      </div>
    </div>
  )
}

export default function V15rTeamPanel() {
  const backup = getBackupData()
  if (!backup) return <NoData />

  const employees = (backup?.employees || []) as EnhancedEmployee[]
  const logs = (backup?.logs || [])
  const projects = (backup?.projects || [])
  const [, forceUpdate] = useState({})
  const [hypotheticals, setHypotheticals] = useState<HypotheticalPosition[]>([])
  const [showHypForm, setShowHypForm] = useState(false)
  const [hypForm, setHypForm] = useState({ title: '', roleType: '', billRate: 0, costRate: 0, projectedHoursMonth: 0 })
  const [expandedHypId, setExpandedHypId] = useState<string | null>(null)
  const [costAnalysisVisible, setCostAnalysisVisible] = useState<CostAnalysisState>({})

  // Get current month for monthly calculations
  const today = new Date()
  const currentMonth = today.getMonth()
  const currentYear = today.getFullYear()

  // Owner employee (first marked as owner or create virtual one)
  const owner = employees.find(e => e.isOwner) || { id: 'owner-virtual', name: 'Owner', role: 'Business Manager', billRate: 0, costRate: 0, isOwner: true }

  // Calculate employee stats
  const employeeStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        employee: EnhancedEmployee
        totalHours: number
        monthlyHours: number
        jobCount: number
      }
    >()

    ;(employees || []).forEach((emp) => {
      const empLogs = (logs || []).filter((l) => l.empId === emp.id)
      const totalHours = (empLogs || []).reduce((s, l) => s + (l.hrs || 0), 0)
      const monthlyHours = (empLogs || []).reduce((s, l) => {
        if (l.date) {
          const logDate = new Date(l.date)
          if (logDate.getMonth() === currentMonth && logDate.getFullYear() === currentYear) {
            return s + (l.hrs || 0)
          }
        }
        return s
      }, 0)
      const jobCount = empLogs.length

      stats.set(emp.id, {
        employee: emp,
        totalHours,
        monthlyHours,
        jobCount,
      })
    })

    return stats
  }, [employees, logs, currentMonth, currentYear])

  // Logs table data with computed cost
  const logsWithCost = useMemo(() => {
    return (logs || []).map((log) => {
      const employee = (employees || []).find((e) => e.id === log.empId)
      const project = (projects || []).find((p) => p.id === log.projId)
      const cost = (log.hrs || 0) * (employee?.costRate || 0)

      return {
        ...log,
        employeeName: employee?.name || 'Unknown',
        projectName: project?.name || log.projName || 'Unknown',
        cost,
      }
    })
  }, [logs, employees, projects])

  // Calculate projected monthly cost (real employees)
  const projectedMonthlyCost = useMemo(() => {
    let total = 0
    employeeStats.forEach((stats) => {
      const applyMult = stats.employee.applyMultiplier !== false ? true : stats.employee.isOwner ? false : true
      const mult = applyMult ? 1.20 : 1.0
      const workersComp = applyMult ? (stats.employee.costRate || 0) * 0.08 : 0
      const loadedCost = (stats.employee.costRate || 0) * mult + workersComp
      total += stats.monthlyHours * loadedCost
    })
    // Add hypothetical costs
    hypotheticals.forEach((hyp) => {
      const mult = 1.20
      const workersComp = (hyp.costRate || 0) * 0.08
      const loadedCost = (hyp.costRate || 0) * mult + workersComp
      total += hyp.projectedHoursMonth * loadedCost
    })
    return total
  }, [employeeStats, hypotheticals])

  const toggleMultiplier = (empId: string) => {
    pushState()
    const emp = backup.employees.find(e => e.id === empId) as EnhancedEmployee
    if (emp) {
      emp.applyMultiplier = emp.applyMultiplier === false ? true : false
      saveBackupData(backup)
      forceUpdate({})
    }
  }

  const deleteEmployee = (id: string) => {
    if (!confirm('Delete this employee?')) return
    pushState()
    backup.employees = backup.employees.filter(e => e.id !== id)
    saveBackupData(backup)
    forceUpdate({})
  }

  const addHypotheticalPosition = () => {
    if (!hypForm.title || !hypForm.roleType) {
      alert('Title and role type required')
      return
    }
    const newHyp: HypotheticalPosition = {
      id: 'hyp-' + Date.now(),
      title: hypForm.title,
      roleType: hypForm.roleType,
      billRate: num(hypForm.billRate),
      costRate: num(hypForm.costRate),
      projectedHoursMonth: num(hypForm.projectedHoursMonth),
    }
    setHypotheticals([...hypotheticals, newHyp])
    setHypForm({ title: '', roleType: '', billRate: 0, costRate: 0, projectedHoursMonth: 0 })
    setShowHypForm(false)
  }

  const deleteHypothetical = (id: string) => {
    setHypotheticals(hypotheticals.filter(h => h.id !== id))
  }

  const toggleCostAnalysis = (hypId: string) => {
    setCostAnalysisVisible({
      ...costAnalysisVisible,
      [hypId]: !costAnalysisVisible[hypId]
    })
  }

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-5 space-y-6">
      {/* HEADER */}
      <div className="flex items-center gap-3 mb-8">
        <Users className="w-8 h-8 text-blue-400" />
        <div>
          <h1 className="text-3xl font-bold text-gray-100">Team 💼</h1>
          <p className="text-sm text-gray-400">Employee hours, costs, and performance tracking with owner override</p>
        </div>
      </div>

      {/* INTERACTIVE ORG PYRAMID */}
      <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
        <h2 className="text-lg font-bold text-gray-100 mb-6">Interactive Org Pyramid</h2>
        <div className="flex flex-col items-center gap-8">
          {/* Owner (always at top, larger) */}
          <div className="text-center">
            <div className="bg-blue-600/30 border border-blue-500/50 rounded-lg px-6 py-3 inline-block">
              <div className="text-base font-bold text-blue-300">👑 {owner.name}</div>
              <div className="text-xs text-gray-400">{owner.role || 'Business Manager'}</div>
            </div>
          </div>

          {/* Vertical line */}
          <div className="h-8 w-0.5 bg-gray-700"></div>

          {/* Real Employees + Hypotheticals Grid */}
          {employees.length > 0 || hypotheticals.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full">
              {/* Real employees (non-owner) */}
              {employees
                .filter(e => !e.isOwner)
                .map((emp) => (
                  <div key={emp.id} className="text-center">
                    <div className="bg-gray-700/30 border border-gray-700 rounded-lg px-3 py-2 hover:border-blue-600/50 transition">
                      <div className="text-sm font-semibold text-gray-100">{emp.name}</div>
                      <div className="text-xs text-gray-500">{emp.role || 'Team Member'}</div>
                    </div>
                  </div>
                ))}

              {/* Hypothetical positions */}
              {hypotheticals.map((hyp) => (
                <div key={hyp.id} className="text-center">
                  <div className="bg-purple-700/20 border-2 border-dashed border-purple-600/60 rounded-lg px-3 py-2 relative">
                    <div className="absolute -top-2 right-2 text-xs px-1.5 py-0.5 bg-purple-600/70 text-purple-100 rounded">Hypothetical ✨</div>
                    <div className="text-sm font-semibold text-purple-300 mt-1">{hyp.title}</div>
                    <div className="text-xs text-purple-400">{hyp.roleType}</div>
                    <button
                      onClick={() => deleteHypothetical(hyp.id)}
                      className="mt-2 text-xs px-1 py-0.5 bg-red-600/30 text-red-300 rounded hover:bg-red-600/50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No employees or hypothetical positions yet</div>
          )}

          {/* Add Hypothetical Button */}
          <div className="mt-4 w-full max-w-md">
            {!showHypForm ? (
              <button
                onClick={() => setShowHypForm(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600/30 text-purple-300 rounded-lg hover:bg-purple-600/50 transition text-sm font-semibold"
              >
                <Plus className="w-4 h-4" />
                Add Hypothetical Position
              </button>
            ) : (
              <div className="bg-[var(--bg-input)] rounded-lg border border-purple-600/50 p-4 space-y-3">
                <input
                  type="text"
                  placeholder="Position title"
                  value={hypForm.title}
                  onChange={(e) => setHypForm({ ...hypForm, title: e.target.value })}
                  className="w-full bg-[var(--bg-card)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-purple-600"
                />
                <input
                  type="text"
                  placeholder="Role type (e.g., Helper, Technician)"
                  value={hypForm.roleType}
                  onChange={(e) => setHypForm({ ...hypForm, roleType: e.target.value })}
                  className="w-full bg-[var(--bg-card)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-purple-600"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Bill rate/hr"
                    value={hypForm.billRate || ''}
                    onChange={(e) => setHypForm({ ...hypForm, billRate: parseFloat(e.target.value) || 0 })}
                    className="bg-[var(--bg-card)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-purple-600"
                  />
                  <input
                    type="number"
                    placeholder="Cost rate/hr"
                    value={hypForm.costRate || ''}
                    onChange={(e) => setHypForm({ ...hypForm, costRate: parseFloat(e.target.value) || 0 })}
                    className="bg-[var(--bg-card)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-purple-600"
                  />
                </div>
                <input
                  type="number"
                  placeholder="Projected hours/month"
                  value={hypForm.projectedHoursMonth || ''}
                  onChange={(e) => setHypForm({ ...hypForm, projectedHoursMonth: parseFloat(e.target.value) || 0 })}
                  className="w-full bg-[var(--bg-card)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-purple-600"
                />
                <div className="flex gap-2">
                  <button
                    onClick={addHypotheticalPosition}
                    className="flex-1 px-3 py-2 bg-emerald-600/50 text-emerald-300 rounded text-sm font-semibold hover:bg-emerald-600/70"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowHypForm(false)}
                    className="flex-1 px-3 py-2 bg-gray-700/50 text-gray-300 rounded text-sm font-semibold hover:bg-gray-700/70"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* EMPLOYEE COST STRUCTURE BOX */}
      <EmployeeCostStructure backup={backup} />

      {/* ENHANCED EMPLOYEE COST VS PIPELINE CHART */}
      <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
        <h2 className="text-lg font-bold text-gray-100 mb-4">6-Month Cost vs Pipeline Forecast</h2>
        <p className="text-sm text-gray-500 mb-4">Next 6 months: stacked costs (red/orange/yellow) vs projected revenue (green line)</p>
        <div className="relative w-full h-80">
          <ChartErrorBoundary>
            <EnhancedCostVsPipelineChart backup={backup} />
          </ChartErrorBoundary>
        </div>
      </div>

      {/* AI INSIGHT CARD */}
      <AIInsightCard backup={backup} />

      {/* KPI CARDS: Owner Card + Projected Monthly Cost + NEXUS AI Hire */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <OwnerCard owner={owner} backup={backup} />

        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Projected Monthly Cost</div>
          <div className="text-3xl font-bold text-orange-400">{formatCurrency(projectedMonthlyCost)}</div>
          <p className="text-xs text-gray-500 mt-2">Real + hypothetical employees (loaded cost × hours)</p>
        </div>

        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-4">
          <button
            onClick={() => alert('NEXUS Analysis: At current pace, a helper becomes break-even at 3-4 projects/month with estimated 80+ hours logged.')}
            className="w-full text-left"
          >
            <div className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              NEXUS AI Hire Suggestion
            </div>
            <div className="text-cyan-400 font-semibold text-sm">Analyze staffing needs</div>
            <p className="text-xs text-gray-500 mt-2 cursor-pointer hover:text-gray-400">Click to analyze current project capacity →</p>
          </button>
        </div>
      </div>

      {/* HYPOTHETICAL DETAILS SECTION */}
      {hypotheticals.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
          <h2 className="text-lg font-bold text-gray-100 mb-4">Hypothetical Position Analysis ✨</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hypotheticals.map((hyp) => {
              const monthlyLabor = hyp.projectedHoursMonth * hyp.costRate
              const mult = 1.20
              const workersComp = hyp.costRate * 0.08
              const loadedCost = hyp.costRate * mult + workersComp
              const monthlyLoadedCost = hyp.projectedHoursMonth * loadedCost
              const monthlyBilled = hyp.projectedHoursMonth * hyp.billRate
              const monthlyContribution = monthlyBilled - monthlyLoadedCost
              const breakEvenUtilization = hyp.billRate > 0 ? Math.round((loadedCost / hyp.billRate) * 100) : 0

              return (
                <div key={hyp.id} className="bg-[var(--bg-input)] rounded-lg border border-purple-600/40 p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-bold text-purple-300">{hyp.title}</h3>
                      <p className="text-xs text-gray-500">{hyp.roleType}</p>
                    </div>
                    <span className="text-xs px-2 py-1 bg-purple-600/30 text-purple-300 rounded">Hypothetical</span>
                  </div>

                  <div className="space-y-2 text-sm mb-4 pb-4 border-b border-purple-600/30">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Bill Rate</span>
                      <span className="text-emerald-400">{formatCurrency(hyp.billRate)}/hr</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Cost Rate</span>
                      <span className="text-orange-400">{formatCurrency(hyp.costRate)}/hr</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Projected Hours/month</span>
                      <span className="text-gray-300">{hyp.projectedHoursMonth} hrs</span>
                    </div>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Monthly Revenue (at bill rate)</span>
                      <span className="text-blue-400 font-semibold">{formatCurrency(monthlyBilled)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Monthly Loaded Cost</span>
                      <span className="text-orange-400 font-semibold">{formatCurrency(monthlyLoadedCost)}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-purple-600/30">
                      <span className="text-gray-300 font-semibold">Net Contribution/month</span>
                      <span className={monthlyContribution > 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{formatCurrency(monthlyContribution)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400 text-xs">Break-even utilization</span>
                      <span className="text-cyan-400 text-xs font-semibold">{breakEvenUtilization}%</span>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setExpandedHypId(expandedHypId === hyp.id ? null : hyp.id)}
                      className="text-xs text-purple-400 hover:text-purple-300 font-semibold"
                    >
                      {expandedHypId === hyp.id ? 'Hide' : 'More'} Details →
                    </button>
                    <button
                      onClick={() => toggleCostAnalysis(hyp.id)}
                      className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                    >
                      {costAnalysisVisible[hyp.id] ? 'Hide' : 'Show'} Cost Analysis
                    </button>
                  </div>

                  {expandedHypId === hyp.id && (
                    <div className="mt-3 pt-3 border-t border-purple-600/30 space-y-2 text-xs text-gray-400">
                      <div className="flex justify-between">
                        <span>Monthly Overhead Impact</span>
                        <span className="text-gray-300">~{formatCurrency(monthlyLoadedCost * 0.15)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Effective Margin Change</span>
                        <span className={monthlyContribution > 0 ? 'text-emerald-400' : 'text-red-400'}>{monthlyContribution > 0 ? '+' : ''}{((monthlyContribution / monthlyBilled) * 100).toFixed(1)}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Revenue Capacity Increase</span>
                        <span className="text-cyan-400">{formatCurrency(monthlyBilled)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Payback Period (startup cost $5k)</span>
                        <span className="text-gray-300">{monthlyContribution > 0 ? (5000 / monthlyContribution).toFixed(1) : '∞'} months</span>
                      </div>
                    </div>
                  )}

                  {costAnalysisVisible[hyp.id] && (
                    <div className="bg-[var(--bg-secondary)] border border-gray-700/30 rounded-lg p-4 mt-3 space-y-4">
                      {/* Chart 1: Cost Breakdown */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-3">Cost Breakdown</h4>
                        <div className="space-y-2">
                          {(() => {
                            const hoursPerWeek = 40
                            const weeklyCost = hyp.costRate * hoursPerWeek
                            const monthlyCost = weeklyCost * 4.33
                            const annualCost = monthlyCost * 12
                            const maxValue = annualCost

                            return [
                              { label: 'Weekly', value: weeklyCost, color: '#3b82f6' },
                              { label: 'Monthly', value: monthlyCost, color: '#10b981' },
                              { label: 'Annual', value: annualCost, color: '#f59e0b' },
                            ].map(bar => (
                              <div key={bar.label} className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-16">{bar.label}</span>
                                <div className="flex-1 h-4 bg-[var(--bg-input)] rounded overflow-hidden">
                                  <div
                                    className="h-full rounded"
                                    style={{
                                      width: `${(bar.value / maxValue) * 100}%`,
                                      backgroundColor: bar.color
                                    }}
                                  />
                                </div>
                                <span className="text-xs text-gray-300 w-20 text-right">${bar.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                              </div>
                            ))
                          })()}
                        </div>
                      </div>

                      {/* Chart 2: Break-even Analysis */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-3">Break-even Revenue Analysis</h4>
                        <div className="space-y-2">
                          {(() => {
                            const annualCost = (hyp.costRate * 40 * 4.33) * 12
                            const overheadPct = 30
                            const breakEvenRevenue = annualCost / (1 - overheadPct / 100)
                            const activeProjects = projects.filter((p: any) => p.status === 'active' || p.status === 'Active')
                            const totalActiveRevenue = activeProjects.reduce((sum: number, p: any) => sum + (p.totalBudget || p.budget || 0), 0)
                            const employeeCount = Math.max(1, employees.length)
                            const revenuePerEmployee = totalActiveRevenue / employeeCount
                            const maxValue = Math.max(breakEvenRevenue, revenuePerEmployee, annualCost)

                            return [
                              { label: 'Position Cost', value: annualCost, color: '#f87171' },
                              { label: 'Break-even (30% OH)', value: breakEvenRevenue, color: '#fbbf24' },
                              { label: 'Revenue/Employee', value: revenuePerEmployee, color: '#34d399' },
                            ].map(bar => (
                              <div key={bar.label} className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-24">{bar.label}</span>
                                <div className="flex-1 h-4 bg-[var(--bg-input)] rounded overflow-hidden">
                                  <div
                                    className="h-full rounded"
                                    style={{
                                      width: `${(bar.value / maxValue) * 100}%`,
                                      backgroundColor: bar.color
                                    }}
                                  />
                                </div>
                                <span className="text-xs text-gray-300 w-20 text-right">${bar.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                              </div>
                            ))
                          })()}
                        </div>
                        <div className="mt-3 pt-2 border-t border-gray-700/50 text-xs text-gray-400">
                          <p>Revenue per employee to cover: <span className="text-cyan-400 font-semibold">${(() => {
                            const annualCost = (hyp.costRate * 40 * 4.33) * 12
                            const overheadPct = 30
                            return (annualCost / (1 - overheadPct / 100)).toLocaleString('en-US', { maximumFractionDigits: 0 })
                          })()}</span></p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* EMPLOYEE CARDS */}
      {employees.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] rounded-lg border border-gray-700">
          <p className="text-gray-400 text-lg">No employees yet</p>
          <p className="text-gray-600 text-sm mt-2">Add team members to get started</p>
        </div>
      ) : (
        <div>
          <h2 className="text-2xl font-bold text-gray-100 mb-4">Employee Cards</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employees.map((emp) => {
              const stats = employeeStats.get(emp.id)
              if (!stats) return null
              return (
                <div key={emp.id}>
                  <EmployeeCard
                    employee={emp}
                    totalHours={stats.totalHours}
                    monthlyHours={stats.monthlyHours}
                    jobCount={stats.jobCount}
                    onToggleMultiplier={toggleMultiplier}
                  />
                  <div className="mt-2 flex gap-2 justify-end">
                    <button className="text-xs px-2 py-1 bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/40 flex items-center gap-1">
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={() => deleteEmployee(emp.id)}
                      className="text-xs px-2 py-1 bg-red-600/30 text-red-300 rounded hover:bg-red-600/40 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* HOURS BY EMPLOYEE TABLE */}
      <div className="mt-10">
        <h2 className="text-2xl font-bold text-gray-100 mb-4">Hours by Employee 📋</h2>

        {logsWithCost.length === 0 ? (
          <div className="text-center py-12 bg-[var(--bg-card)] rounded-lg border border-gray-700">
            <p className="text-gray-400">No logged hours yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto bg-[var(--bg-card)] rounded-lg border border-gray-700">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-700 bg-[var(--bg-secondary)]">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">Employee</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">Project</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-300">Hours</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-300">Cost</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-300">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-300">Phase</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {logsWithCost.map((log) => {
                  const isNegativeHours = (log.hrs || 0) < 0
                  const isNegativeCost = log.cost < 0

                  return (
                    <tr key={log.id} className="hover:bg-[#282f3f] transition">
                      <td className="px-4 py-3 text-gray-100 font-semibold">{log.employeeName}</td>
                      <td className="px-4 py-3 text-gray-400">{log.projectName}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${isNegativeHours ? 'text-orange-400' : 'text-gray-300'}`}>
                        {log.hrs}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold ${isNegativeCost ? 'text-red-400' : 'text-emerald-400'}`}>
                        {formatCurrency(log.cost)}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-500">
                        {log.date ? new Date(log.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-400">{log.phase || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
