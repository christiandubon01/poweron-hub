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
 * - Three employee types: Permanent (W-2), Per-Project (1099), Hypothetical (planning)
 * - OHM compliance cards for W-2 and 1099 employees (non-blocking, shown after save)
 * - AI Hire Suggestion (NEXUS): placeholder analysis card
 * - Hours by Employee table: from backup.logs grouped by empId
 * - Full CRUD on employees
 * - Per-Project labor cost flows into project budget automatically
 */

import React, { useMemo, useState, useEffect, useRef } from 'react'
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart } from 'recharts'
import { Users, Sparkles, AlertCircle, Plus, Trash2, Edit2, TrendingUp, Zap, X, UserPlus } from 'lucide-react'
import AddTeamMemberModal from './AddTeamMemberModal'
import DemoInvite from '@/components/admin/DemoInvite'
import EmployeeInviteModal from '@/components/admin/EmployeeInviteModal'
import AdminTimecardsPanel from '@/components/admin/AdminTimecardsPanel'
import OhmComplianceCard from './OhmComplianceCard'
import { normalizeEmployee } from './employeeTypes'
import { getWorkerCostProfile, calcMonthlyBreakdown, workerTypeLabel, getLoadedHourlyRate, resolveWorkerType, buildSavePayload } from './employeeCostUtils'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  saveBackupWithRemoteBaselineSync,
  fetchLatestRemoteBackup,
  num,
  fmt,
  fmtK,
  type BackupEmployee,
  type BackupLog,
  type BackupData,
} from '@/services/backupDataService'
import {
  mergeEmployeesIntoRemote,
  ensureEmployeeIdentity,
  createEmployeeTombstone,
  getLiveEmployees,
} from '@/services/teamScopeMerge'
import { calcPipeline } from '@/utils/pipelineCalc'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import { useAuth } from '@/hooks/useAuth'

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


// ── COST VS PIPELINE CHART COMPONENT ──
function CostVsPipelineChart({ backup }) {
  // recharts imported at top of file
  const employees = backup.employees || []
  const projects = backup.projects || []
  const logs = backup.logs || []
  const settings = backup.settings || {}
  const now = new Date()
  const months = []
  for (let i = -3; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    months.push({ label: d.toLocaleString('en-US', { month: 'short' }), year: d.getFullYear(), month: d.getMonth() })
  }
  const chartData = months.map(m => {
    const mLogs = logs.filter(l => { const d = new Date(l.date || ''); return d.getMonth() === m.month && d.getFullYear() === m.year })
    const cost = mLogs.reduce((s, l) => { const empId = l.empId || l.employeeId; const emp = employees.find(e => e.id === empId); return s + (parseFloat(l.hrs || 0) * getLoadedHourlyRate(emp, settings)) }, 0)
    const rev = projects.filter(p => p.status === 'active' || p.status === 'coming').reduce((s, p) => s + (parseFloat(p.contract || 0) / 12), 0)
    return { name: m.label, cost, revenue: rev }
  })
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }} formatter={(v) => ['$' + Number(v).toLocaleString()]} />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 11 }} />
        <Bar dataKey="revenue" name="Pipeline Revenue" fill="rgba(16,185,129,0.25)" stroke="#10b981" radius={[3, 3, 0, 0]} />
        <Line type="monotone" dataKey="cost" name="Employee Cost" stroke="#ef4444" strokeWidth={3} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}


// ── LABOR COST VS REVENUE 12-WEEK CHART ──
function LaborCostVsRevenueChart({ backup }) {
  // recharts imported at top of file
  const employees = backup.employees || []
  const logs = backup.logs || []
  const serviceLogs = backup.serviceLogs || []
  const projects = backup.projects || []
  const now = new Date()
  const chartData = []
  let accumCost = 0, accumRev = 0
  for (let w = 11; w >= 0; w--) {
    const weekEnd = new Date(now.getTime() - w * 7 * 86400000)
    const weekStart = new Date(weekEnd.getTime() - 7 * 86400000)
    const wLogs = logs.filter(l => { const d = new Date(l.date || ''); return d >= weekStart && d < weekEnd })
    const cost = wLogs.reduce((s, l) => { const empId = l.empId || l.employeeId; const emp = employees.find(e => e.id === empId); return s + (parseFloat(l.hrs || 0) * getLoadedHourlyRate(emp, backup.settings)) }, 0)
    const projRev = wLogs.reduce((s, l) => s + parseFloat(l.collected || 0), 0)
    const svcRev = serviceLogs.filter(l => { const d = new Date(l.date || ''); return d >= weekStart && d < weekEnd }).reduce((s, l) => s + parseFloat(l.collected || 0), 0)
    accumCost += cost
    accumRev += projRev + svcRev
    const pct = accumRev > 0 ? (accumCost / accumRev) * 100 : 0
    chartData.push({ name: 'W' + (12 - w), cost: accumCost, revenue: accumRev, laborPct: Math.min(pct, 100) })
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis yAxisId="left" tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => v + '%'} tick={{ fill: '#eab308', fontSize: 10 }} domain={[0, 100]} />
        <Tooltip contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }} />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 11 }} />
        <Line yAxisId="left" type="monotone" dataKey="cost" name="Accum. Labor Cost" stroke="#ef4444" strokeWidth={2} dot={false} />
        <Line yAxisId="left" type="monotone" dataKey="revenue" name="Accum. Revenue" stroke="#10b981" strokeWidth={2} dot={false} />
        <Line yAxisId="right" type="monotone" dataKey="laborPct" name="Labor % of Revenue" stroke="#eab308" strokeWidth={2} strokeDasharray="6 3" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
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
    // Dispatch storage event to trigger chart re-render in parent
    window.dispatchEvent(new Event('storage'))
  }

  const analyzeRates = async () => {
    setAiLoading(true)
    setAiResponse('')

    try {
      const fullBackup = getBackupData()

      // Calculate pipeline total — active + coming-up projects only (canonical formula)
      const pipelineTotal = calcPipeline(fullBackup.projects || [])

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
function EnhancedCostVsPipelineChart({ backup }) {
  // recharts imported at top of file
  const employees = backup.employees || []
  const projects = backup.projects || []
  const logs = backup.logs || []
  const settings = backup.settings || {}
  const personalIncomeGoal = parseFloat(settings.personalIncomeGoal || 0)
  const overheadPct = parseFloat(settings.overheadPct || 30) / 100
  const now = new Date()
  const chartData = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const label = d.toLocaleString('en-US', { month: 'short' })
    const mLogs = logs.filter(l => { const ld = new Date(l.date || ''); return ld.getMonth() === d.getMonth() && ld.getFullYear() === d.getFullYear() })
    const empCost = mLogs.reduce((s, l) => { const empId = l.empId || l.employeeId; const emp = employees.find(e => e.id === empId); return s + (parseFloat(l.hrs || 0) * getLoadedHourlyRate(emp, settings)) }, 0)
    const revenue = projects.filter(p => p.status === 'active' || p.status === 'coming').reduce((s, p) => s + (parseFloat(p.contract || 0) / 12), 0)
    const ownerDraw = personalIncomeGoal / 12
    const overhead = revenue * overheadPct
    chartData.push({ name: label, employees: empCost, ownerDraw, overhead, revenue })
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="name" tick={{ fill: '#9ca3af', fontSize: 10 }} />
        <YAxis tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'k'} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip contentStyle={{ backgroundColor: '#0f1117', border: '1px solid #374151', borderRadius: 8 }} formatter={(v) => ['$' + Number(v).toLocaleString()]} />
        <Legend wrapperStyle={{ color: '#d1d5db', fontSize: 11 }} />
        <Bar dataKey="employees" name="Employee Costs" stackId="costs" fill="#ef4444" />
        <Bar dataKey="ownerDraw" name="Owner Draw" stackId="costs" fill="#f97316" />
        <Bar dataKey="overhead" name="Overhead" stackId="costs" fill="#eab308" />
        <Line type="monotone" dataKey="revenue" name="Projected Revenue" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
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

function calcEmployeeCost(emp: any, backup: any) {
  // Uses shared helper — single source of truth for worker cost rules.
  const mb = calcMonthlyBreakdown(emp, backup?.settings)
  return {
    baseMonthlyCost: mb.baseMonthly,
    taxesAndInsurance: mb.payrollBurdenMonthly,
    loadedMonthlyCost: mb.loadedMonthly,
    sixMonthCost: mb.sixMonthCost,
    targetRevenue: mb.targetRevenue,
    hourlyRate: mb.baseHourly,
    hrsPerWeek: 40,
  }
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
  backup,
}: {
  employee: EnhancedEmployee
  totalHours: number
  jobCount: number
  backup?: any
  // legacy props — kept for call-site compat, unused in compact view
  monthlyHours?: number
  onToggleMultiplier?: (empId: string) => void
}) {
  const profile = getWorkerCostProfile(employee, backup?.settings)
  const baseWage = profile.baseHourly
  const loadedCostRate = profile.loadedHourly
  const billRate = num(employee.billRate)
  const marginPerHour = parseFloat((billRate - loadedCostRate).toFixed(2))
  const isOwner = employee.isOwner || false
  const typeLabel = isOwner ? 'Owner 👑' : profile.workerType === '1099' ? '1099' : 'W-2'
  const typeCls = isOwner ? 'bg-blue-600/40 text-blue-300' : 'bg-gray-700/60 text-gray-400'

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-4 cursor-pointer hover:border-gray-500 transition-colors">
      {/* Name + worker-type badge */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold text-gray-100 text-sm leading-tight truncate">{employee.name}</h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{employee.role || 'Team Member'}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${typeCls}`}>{typeLabel}</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-[var(--bg-secondary)] rounded px-2 py-1.5 text-center">
          <div className="text-[10px] text-gray-500 uppercase mb-0.5">All Time Hrs</div>
          <div className="text-xs font-bold text-blue-400">{Math.round(totalHours)}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded px-2 py-1.5 text-center">
          <div className="text-[10px] text-gray-500 uppercase mb-0.5">All Jobs</div>
          <div className="text-xs font-bold text-emerald-400">{jobCount}</div>
        </div>
      </div>

      {/* Rates */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between items-baseline">
          <span className="text-gray-400">Base Wage</span>
          <span className="text-gray-200 font-semibold">${baseWage.toFixed(2)}/hr</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-gray-400">Loaded Cost</span>
          <span className="text-amber-400 font-semibold">${loadedCostRate.toFixed(2)}/hr</span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-gray-400">Bill Rate</span>
          <span className="text-emerald-400 font-semibold">${billRate.toFixed(2)}/hr</span>
        </div>
        <div className="flex justify-between items-center pt-1.5 border-t border-gray-700/40">
          <span className="text-gray-400 flex items-center gap-1">
            {marginPerHour < 0 && <AlertCircle className="w-3 h-3 text-red-400" />}
            Margin/hr
          </span>
          <span className={`font-bold ${marginPerHour >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {marginPerHour >= 0 ? '+' : ''}${marginPerHour.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-gray-700/30 text-[10px] text-gray-600 text-center">
        Click for full details
      </div>
    </div>
  )
}

// ── EMPLOYEE EDIT MODAL ──────────────────────────────────────────────────────
function EmployeeEditModal({
  employee,
  payrollMult,
  onSave,
  onCancel,
}: {
  employee: EnhancedEmployee
  payrollMult: number
  onSave: (id: string, updates: Partial<EnhancedEmployee>) => void
  onCancel: () => void
}) {
  // Use shared helper to derive base wage and burden status from stored fields.
  // This corrects stale records (missing hourly_rate) at display time before save.
  const editSettings = { payrollMult }
  const initProfile = getWorkerCostProfile(employee, editSettings)
  const initBase = initProfile.baseHourly
  const initBill = num(employee.billRate)

  // Determine whether this employee carries W-2 payroll burden (via shared helper)
  const noMultiplier = !initProfile.applyMultiplier

  const [baseWage, setBaseWage] = useState<number | ''>(initBase || '')
  const [billRate, setBillRate] = useState<number | ''>(initBill || '')
  const [billOverridden, setBillOverridden] = useState(initBill > 0 && initBill !== initBase * (noMultiplier ? 1 : payrollMult) * 2)

  // Auto-update bill rate default when base changes (unless user overrode)
  useEffect(() => {
    if (!billOverridden) {
      const base = Number(baseWage) || 0
      const loaded = noMultiplier ? base : base * payrollMult
      setBillRate(loaded > 0 ? parseFloat((loaded * 2.0).toFixed(2)) : '')
    }
  }, [baseWage, payrollMult, billOverridden, noMultiplier])

  const baseNum = Number(baseWage) || 0
  const loadedCost = noMultiplier ? baseNum : parseFloat((baseNum * payrollMult).toFixed(2))
  const billNum = Number(billRate) || 0
  const margin = parseFloat((billNum - loadedCost).toFixed(2))

  const inputCls = 'w-full bg-[var(--bg-input)] border border-gray-700 text-[var(--text-primary)] text-sm px-3 py-2.5 rounded focus:outline-none focus:border-blue-600 placeholder-gray-600'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.65)' }}>
      <div className="w-full max-w-md bg-[var(--bg-primary)] border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-gray-100">Edit — {employee.name}</h2>
          <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Base Wage */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Base Wage ($/hr)</label>
            <input
              type="number"
              className={inputCls}
              value={baseWage}
              onChange={e => {
                setBaseWage(parseFloat(e.target.value) || '')
                setBillOverridden(false)
              }}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          {/* Loaded Cost — read-only */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Loaded Cost ($/hr) — auto-calculated</label>
            <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--bg-input)] border border-amber-700/40 rounded text-sm">
              <span className="text-amber-400 font-bold">${loadedCost.toFixed(2)}</span>
              <span className="text-gray-500 text-xs">
                {noMultiplier ? 'base rate (no W-2 burden)' : `= base × ${payrollMult.toFixed(2)}x mult`}
              </span>
            </div>
          </div>

          {/* Bill Rate */}
          <div>
            <label className="block text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">Bill Rate ($/hr) — what you charge customers</label>
            <input
              type="number"
              className={`${inputCls} border-green-700/50 focus:border-green-500`}
              value={billRate}
              onChange={e => {
                setBillRate(parseFloat(e.target.value) || '')
                setBillOverridden(true)
              }}
              placeholder="0.00"
              step="0.01"
              min="0"
            />
          </div>

          {/* Margin/hr preview — read-only */}
          {billNum > 0 && (
            <div className={`flex items-center justify-between px-3 py-2.5 rounded text-sm ${margin >= 0 ? 'bg-emerald-900/20 border border-emerald-700/30' : 'bg-red-900/20 border border-red-700/30'}`}>
              <span className="text-gray-400 flex items-center gap-1">
                {margin < 0 && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                Margin/hr
              </span>
              <span className={`font-bold ${margin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {margin >= 0 ? '+' : ''}${margin.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 bg-gray-700/50 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-700 transition"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              // Build corrected save payload via shared helper — normalises stale records on save.
              const workerType = resolveWorkerType(employee)
              const payload = buildSavePayload(baseNum, billNum, workerType, editSettings)
              onSave(employee.id, payload as any)
            }}
            className="flex-1 px-4 py-2.5 bg-blue-600/70 text-blue-100 rounded-lg text-sm font-bold hover:bg-blue-600 transition"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}

// ── TEAM COST SETTINGS MODAL ─────────────────────────────────────────────────
function TeamCostSettingsModal({ backup, onClose }: { backup: BackupData; onClose: () => void }) {
  const settings = (backup?.settings || {}) as any
  const [costs, setCosts] = useState<any[]>(settings.employeeCosts || [
    { id: 'wc', label: 'Workers Comp', amount: 0 },
    { id: 'pp', label: 'Payroll Processing', amount: 0 },
    { id: 'hi', label: 'Health Insurance', amount: 0 },
    { id: 'ben', label: 'Benefits', amount: 0 },
    { id: 'li', label: 'Liability Insurance', amount: 0 },
    { id: 'oth', label: 'Other', amount: 0 },
  ])
  const [payrollMult, setPayrollMult] = useState<number>(settings.payrollMult || 1.20)
  const [ptoDaysYear, setPtoDaysYear] = useState<number>(settings.ptoDefaults?.ptoDaysYear ?? 10)
  const [sickDaysYear, setSickDaysYear] = useState<number>(settings.ptoDefaults?.sickDaysYear ?? 5)
  const [ptoHoursPerDay, setPtoHoursPerDay] = useState<number>(settings.ptoDefaults?.hoursPerDay ?? 8)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResponse, setAiResponse] = useState('')
  const [saved, setSaved] = useState(false)

  const monthlyTotal = costs.reduce((s: number, c: any) => s + num(c.amount || 0), 0)
  const annualTotal = monthlyTotal * 12

  const persist = () => {
    pushState()
    backup.settings.employeeCosts = costs
    backup.settings.payrollMult = payrollMult
    ;(backup.settings as any).ptoDefaults = { ptoDaysYear, sickDaysYear, hoursPerDay: ptoHoursPerDay }
    saveBackupData(backup)
    window.dispatchEvent(new Event('storage'))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const analyzeRates = async () => {
    setAiLoading(true)
    setAiResponse('')
    try {
      const fullBackup = getBackupData()
      const pipelineTotal = calcPipeline(fullBackup.projects || [])
      const serviceLogs = fullBackup.serviceLogs || []
      const totalServiceQuoted = serviceLogs.reduce((sum: number, log: any) => sum + (num(log.quoted) || 0), 0)
      const monthlyServicePace = totalServiceQuoted / 12
      const systemPrompt = 'You are a business cost advisor for a small California electrical contractor. Analyze these employee costs and provide: (1) whether the payroll multiplier is appropriate for California C-10 contractors, (2) at what monthly revenue this structure becomes profitable, (3) specific rate suggestions, (4) one actionable recommendation. Be concise and specific.'
      const userMessage = `Cost Structure Analysis:\n\nCost Items (Monthly):\n${JSON.stringify(costs, null, 2)}\n\nPayroll Multiplier: ${payrollMult}x\nPersonal Income Goal: ${fmt((fullBackup.settings?.personalIncomeGoal || 0))}\nPipeline Total: ${fmt(pipelineTotal)}\nMonthly Service Pace: ${fmt(monthlyServicePace)}`
      const data = await callClaude({ max_tokens: 1024, system: systemPrompt, messages: [{ role: 'user', content: userMessage }] })
      setAiResponse(extractText(data))
    } catch (error) {
      setAiResponse(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setAiLoading(false)
    }
  }

  const addCostItem = () => setCosts([...costs, { id: 'other-' + Date.now(), label: 'Other', amount: 0 }])
  const deleteCostItem = (id: string) => setCosts(costs.filter((c: any) => c.id !== id))
  const updateCostItem = (id: string, field: 'label' | 'amount', value: any) =>
    setCosts(costs.map((c: any) => c.id === id ? { ...c, [field]: value } : c))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-lg bg-[var(--bg-primary)] border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 shrink-0">
          <h2 className="text-lg font-bold text-gray-100">⚙️ Team Cost Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition"><X className="w-5 h-5" /></button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1">

          {/* Employee Cost Structure */}
          <div>
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-4">Employee Cost Structure</h3>
            <div className="space-y-3 mb-4">
              {costs.map((cost: any) => (
                <div key={cost.id} className="flex gap-3 items-center">
                  <input
                    type="text"
                    value={cost.label}
                    onChange={(e) => updateCostItem(cost.id, 'label', e.target.value)}
                    className="flex-1 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-blue-600"
                    placeholder="Item name"
                  />
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500 text-sm">$</span>
                    <input
                      type="number"
                      value={cost.amount || ''}
                      onChange={(e) => updateCostItem(cost.id, 'amount', parseFloat(e.target.value) || 0)}
                      className="w-28 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-3 py-2 rounded focus:outline-none focus:border-blue-600"
                      placeholder="0"
                      step="0.01"
                    />
                    <span className="text-gray-500 text-xs">/mo</span>
                  </div>
                  <button onClick={() => deleteCostItem(cost.id)} className="p-1.5 bg-red-600/30 text-red-400 rounded hover:bg-red-600/50 transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <button onClick={addCostItem} className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600/30 text-blue-300 rounded-lg hover:bg-blue-600/50 transition text-sm font-semibold mb-4">
              <Plus className="w-4 h-4" /> Add Cost Item
            </button>

            {/* Totals */}
            <div className="space-y-2 text-sm border-t border-gray-700 pt-4">
              <div className="flex justify-between items-baseline">
                <span className="text-gray-400">Monthly Total</span>
                <span className="font-bold text-emerald-400">{formatCurrency(monthlyTotal)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-gray-400">Annual Total</span>
                <span className="font-bold text-blue-400">{formatCurrency(annualTotal)}</span>
              </div>
            </div>
          </div>

          {/* Payroll Multiplier */}
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">Payroll Multiplier</h3>
            <div className="flex justify-between items-center">
              <label className="text-sm text-gray-300">W-2 multiplier</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={payrollMult}
                  onChange={(e) => setPayrollMult(parseFloat(e.target.value) || 1.20)}
                  step="0.01" min="1.0"
                  className="w-20 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-2 py-1.5 rounded focus:outline-none focus:border-blue-600"
                />
                <span className="text-gray-500 text-sm">x</span>
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">Applied to W-2 employee base cost. Owner and 1099 are not affected.</p>
          </div>

          {/* PTO / Sick Defaults */}
          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wide mb-3">PTO / Sick Time Defaults</h3>
            <p className="text-xs text-gray-500 mb-3">Used in Employee Detail cards to project W-2 PTO and sick accrual. Planning only.</p>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-300">PTO days/year</label>
                <input
                  type="number" min="0" step="1"
                  value={ptoDaysYear}
                  onChange={(e) => setPtoDaysYear(parseInt(e.target.value) || 0)}
                  className="w-20 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-2 py-1.5 rounded focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-300">Sick days/year</label>
                <input
                  type="number" min="0" step="1"
                  value={sickDaysYear}
                  onChange={(e) => setSickDaysYear(parseInt(e.target.value) || 0)}
                  className="w-20 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-2 py-1.5 rounded focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="flex justify-between items-center">
                <label className="text-sm text-gray-300">Hours/day basis</label>
                <input
                  type="number" min="1" max="24" step="0.5"
                  value={ptoHoursPerDay}
                  onChange={(e) => setPtoHoursPerDay(parseFloat(e.target.value) || 8)}
                  className="w-20 bg-[var(--bg-input)] border border-gray-700 text-gray-100 text-sm px-2 py-1.5 rounded focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="text-xs text-gray-600 bg-[var(--bg-secondary)] rounded p-2">
                Projected PTO: {(ptoDaysYear * ptoHoursPerDay).toFixed(0)} hrs/yr · Sick: {(sickDaysYear * ptoHoursPerDay).toFixed(0)} hrs/yr
              </div>
            </div>
          </div>

          {/* AI Rate Analysis */}
          <div className="border-t border-gray-700 pt-4">
            <button
              onClick={analyzeRates}
              disabled={aiLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600/30 text-yellow-300 rounded-lg hover:bg-yellow-600/50 transition text-sm font-semibold disabled:opacity-50"
            >
              {aiLoading ? <><span className="animate-spin">⏳</span> Analyzing...</> : <><Zap className="w-4 h-4" /> AI Rate Analysis ⚡</>}
            </button>
            {aiResponse && (
              <div className="mt-3 bg-[var(--bg-secondary)] rounded-lg border border-yellow-500/50 p-3">
                <div className="flex items-center gap-2 mb-2"><Zap className="w-4 h-4 text-yellow-400" /><span className="text-xs font-bold text-yellow-400 uppercase">AI Rate Analysis</span></div>
                <div className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{aiResponse}</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — Save */}
        <div className="px-6 py-4 border-t border-gray-700 shrink-0 flex gap-3">
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-700/50 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-700 transition">Cancel</button>
          <button
            onClick={persist}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-bold transition ${saved ? 'bg-emerald-600 text-white' : 'bg-emerald-600/50 text-emerald-300 hover:bg-emerald-600/70'}`}
          >
            {saved ? '✓ Saved' : 'Save Cost Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── EMPLOYEE DETAIL MODAL ──────────────────────────────────────────────────────
function EmployeeDetailModal({
  employee,
  backup,
  totalHours,
  jobCount,
  activeScenarioId,
  onClose,
}: {
  employee: EnhancedEmployee
  backup: BackupData
  totalHours: number
  jobCount: number
  activeScenarioId?: string
  onClose: () => void
}) {
  const settings = (backup?.settings || {}) as any
  const profile = getWorkerCostProfile(employee, settings)
  const { baseHourly, loadedHourly, payrollBurdenHourly, payrollMult, workerType } = profile
  const billRate = num(employee.billRate)
  const marginPerHour = parseFloat((billRate - loadedHourly).toFixed(2))
  const isW2 = workerType === 'w2'
  const isOwner = workerType === 'owner'

  // W-2 added cost portion
  const addedCostPerHour = payrollBurdenHourly
  const addedCostPct = baseHourly > 0 ? (addedCostPerHour / baseHourly) * 100 : 0

  // Scenario hours — find this employee in the active scenario (or fall back to first)
  const scenarios: any[] = settings?.projectionScenarios || []
  const activeScen = scenarios.find((s: any) => s.id === activeScenarioId) || scenarios[0]
  const workerEntry = (activeScen?.workers || []).find((w: any) =>
    w.empId === employee.id ||
    (employee.id === 'me' && w.empId === 'me') ||
    (employee.isOwner && (w.empId === 'me' || w.empId === employee.id))
  )
  const hrsPerWeek = num(workerEntry?.hoursPerWeek || 0)
  const weeksPerYear = num(workerEntry?.weeksPerYear || 52)
  const hrsPerDay = hrsPerWeek > 0 ? hrsPerWeek / 5 : 0
  const hrsPerMonth = hrsPerWeek * 4.33
  const plannedYearlyHrs = hrsPerWeek * weeksPerYear
  const remainingHrs = Math.max(0, plannedYearlyHrs - totalHours)
  const progressPct = plannedYearlyHrs > 0 ? Math.min((totalHours / plannedYearlyHrs) * 100, 100) : 0

  // Monthly cost — use scenario projected monthly hours, NOT the default 40-hr/wk basis
  // hrsPerMonth is already = hrsPerWeek × 4.33 (from scenario above)
  const baseMonthly = hrsPerMonth * baseHourly
  const loadedMonthly = hrsPerMonth * loadedHourly
  const payrollBurdenMonthly = loadedMonthly - baseMonthly
  const sixMonthCost = loadedMonthly * 6
  const revenueToCover = hrsPerMonth * billRate
  const hasProjHours = hrsPerMonth > 0

  // Totals from logged hours (all-time — uses actual logged data)
  const totalBillable = totalHours * billRate
  const totalLoadedCost = totalHours * loadedHourly
  const profitMargin = totalBillable - totalLoadedCost

  // Sick accrual — California rule: 4 sick hrs per 104 worked hrs (W-2 only)
  // ~3.85% of each worked hour
  const SICK_ACCRUAL_HOURS = 4
  const SICK_ACCRUAL_WORK_HOURS = 104
  const sickAccrualRate = SICK_ACCRUAL_HOURS / SICK_ACCRUAL_WORK_HOURS
  const actualSickAccrued = totalHours * sickAccrualRate
  const projectedSickAccrued = plannedYearlyHrs * sickAccrualRate
  const remainingSickAccrual = remainingHrs * sickAccrualRate

  const typeLabel = isOwner ? 'Owner' : isW2 ? 'W-2 Employee' : '1099 Contractor'
  const workerTypeBadgeCls = isOwner ? 'bg-blue-600/40 text-blue-300' : isW2 ? 'bg-emerald-700/40 text-emerald-300' : 'bg-amber-700/40 text-amber-300'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-lg bg-[var(--bg-primary)] border border-gray-700 rounded-xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-700 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-100">{employee.name}</h2>
            <p className="text-sm text-gray-400">{employee.role || 'Team Member'}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs px-2 py-1 rounded font-semibold ${workerTypeBadgeCls}`}>{typeLabel}</span>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-6 space-y-5 flex-1">

          {/* All-time stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[var(--bg-secondary)] rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500 uppercase mb-1">All Time Hours</div>
              <div className="text-xl font-bold text-blue-400">{Math.round(totalHours)}</div>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-lg p-3 text-center">
              <div className="text-xs text-gray-500 uppercase mb-1">All Jobs</div>
              <div className="text-xl font-bold text-emerald-400">{jobCount}</div>
            </div>
          </div>

          {/* Hourly rates */}
          <div className="bg-[var(--bg-secondary)] rounded-lg p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">Hourly Rates</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Base Wage</span>
                <span className="text-gray-200 font-semibold">${baseHourly.toFixed(2)}/hr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Loaded Cost</span>
                <span className="text-amber-400 font-semibold">${loadedHourly.toFixed(2)}/hr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Bill Rate</span>
                <span className="text-emerald-400 font-semibold">${billRate.toFixed(2)}/hr</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-700/50">
                <span className="text-gray-400 flex items-center gap-1">
                  {marginPerHour < 0 && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                  Margin/hr
                </span>
                <span className={`font-bold ${marginPerHour >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {marginPerHour >= 0 ? '+' : ''}${marginPerHour.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {/* W-2 added cost portion */}
          {isW2 ? (
            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-4">
              <div className="text-xs font-bold text-amber-400 uppercase mb-3">Employee Cost Portion Over Base Wage</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Base wage</span>
                  <span className="text-gray-200">${baseHourly.toFixed(2)}/hr</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Loaded cost</span>
                  <span className="text-amber-400">${loadedHourly.toFixed(2)}/hr</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Added portion</span>
                  <span className="text-orange-400 font-semibold">+${addedCostPerHour.toFixed(2)}/hr</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-amber-700/30">
                  <span className="text-gray-400">Added percentage</span>
                  <span className="text-orange-400 font-bold">+{addedCostPct.toFixed(2)}%</span>
                </div>
                <p className="text-xs text-amber-600/80 mt-1">Payroll multiplier: {payrollMult.toFixed(2)}x · Loaded = base × {payrollMult.toFixed(2)}</p>
              </div>
            </div>
          ) : (
            <div className="bg-[var(--bg-secondary)] border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-400">
              <span className="font-semibold text-gray-300">No W-2 burden applied</span>
              {' — '}{isOwner ? 'Owner' : '1099 contractor'}: loaded cost = base cost.
            </div>
          )}

          {/* Projection vs logged */}
          <div className="bg-[var(--bg-secondary)] rounded-lg p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">
              Projection vs Logged
              {!workerEntry && <span className="ml-2 text-gray-600 font-normal normal-case">(no scenario hours set)</span>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs mb-3">
              <div>
                <div className="text-gray-500 mb-0.5">Hrs/Day</div>
                <div className="font-semibold text-gray-200">{hrsPerDay.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Hrs/Week</div>
                <div className="font-semibold text-gray-200">{hrsPerWeek.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Hrs/Month</div>
                <div className="font-semibold text-gray-200">{hrsPerMonth.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-gray-500 mb-0.5">Hrs/Year (plan)</div>
                <div className="font-semibold text-gray-200">{plannedYearlyHrs.toFixed(0)}</div>
              </div>
            </div>
            {plannedYearlyHrs > 0 && (
              <>
                <div className="space-y-1 text-xs mb-2">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Logged / Used</span>
                    <span className="text-blue-400 font-semibold">{Math.round(totalHours)} hrs</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Remaining</span>
                    <span className="text-gray-300 font-semibold">{Math.round(remainingHrs)} hrs</span>
                  </div>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="text-[10px] text-gray-600 mt-1 text-right">{progressPct.toFixed(0)}% of planned year logged</div>
              </>
            )}
          </div>

          {/* Monthly cost breakdown — based on scenario projected hours */}
          <div className="bg-[var(--bg-secondary)] rounded-lg p-4">
            <div className="flex items-baseline justify-between mb-3">
              <div className="text-xs font-bold text-gray-400 uppercase">Monthly Cost Breakdown</div>
              {hasProjHours && (
                <div className="text-[10px] text-gray-600">{hrsPerMonth.toFixed(0)} hrs/mo basis</div>
              )}
            </div>
            {hasProjHours ? (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Base monthly</span>
                  <span className="text-blue-400">{formatCurrency(baseMonthly)}</span>
                </div>
                {isW2 && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Payroll burden</span>
                    <span className="text-orange-400">{formatCurrency(payrollBurdenMonthly)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold border-t border-gray-700/50 pt-2">
                  <span className="text-gray-300">Loaded monthly</span>
                  <span className="text-white">{formatCurrency(loadedMonthly)}/mo</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">6-Month Cost</span>
                  <span className="text-yellow-400">{formatCurrency(sixMonthCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Revenue to cover (mo)</span>
                  <span className="text-cyan-400">{formatCurrency(revenueToCover)}/mo</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Set projected hours in Projection Scenarios to see monthly cost breakdown.</p>
            )}
          </div>

          {/* All-time billable totals */}
          <div className="bg-[var(--bg-secondary)] rounded-lg p-4">
            <div className="text-xs font-bold text-gray-400 uppercase mb-3">All-Time Billable (Logged Hours)</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Billable</span>
                <span className="text-blue-400 font-semibold">{formatCurrency(totalBillable)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Loaded Cost</span>
                <span className="text-orange-400 font-semibold">{formatCurrency(totalLoadedCost)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-700/50">
                <span className="text-gray-300 font-semibold">Profit Margin</span>
                <span className={`font-bold ${profitMargin >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(profitMargin)}</span>
              </div>
            </div>
          </div>

          {/* Sick Accrual — W-2 only, California rule */}
          {isW2 ? (
            <div className="bg-blue-900/15 border border-blue-700/40 rounded-lg p-4">
              <div className="text-xs font-bold text-blue-400 uppercase mb-1">Sick Accrual (W-2)</div>
              <div className="text-[10px] text-gray-500 mb-3">
                CA rule: {SICK_ACCRUAL_HOURS} sick hrs / {SICK_ACCRUAL_WORK_HOURS} worked hrs · rate {(sickAccrualRate * 100).toFixed(2)}%
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-[var(--bg-secondary)] rounded p-2">
                  <div className="text-gray-500 mb-0.5">Accrued (logged)</div>
                  <div className="font-bold text-blue-300">{actualSickAccrued.toFixed(2)} hrs</div>
                  <div className="text-gray-600">{Math.round(totalHours)} hrs worked</div>
                </div>
                <div className="bg-[var(--bg-secondary)] rounded p-2">
                  <div className="text-gray-500 mb-0.5">Projected (plan)</div>
                  <div className="font-bold text-blue-400">{projectedSickAccrued.toFixed(2)} hrs</div>
                  <div className="text-gray-600">{Math.round(plannedYearlyHrs)} hrs/yr plan</div>
                </div>
                <div className="bg-[var(--bg-secondary)] rounded p-2">
                  <div className="text-gray-500 mb-0.5">Remaining</div>
                  <div className="font-bold text-gray-300">{remainingSickAccrual.toFixed(2)} hrs</div>
                  <div className="text-gray-600">{Math.round(remainingHrs)} hrs left</div>
                </div>
              </div>
              <p className="text-[10px] text-blue-900/80 mt-2">Planning only · not a payroll record</p>
            </div>
          ) : (
            <div className="bg-[var(--bg-secondary)] border border-gray-700 rounded-lg px-4 py-3 text-xs text-gray-500">
              No W-2 sick accrual tracked — {isOwner ? 'Owner' : '1099 contractor'} classification.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 shrink-0">
          <button onClick={onClose} className="w-full px-4 py-2.5 bg-gray-700/50 text-gray-300 rounded-lg text-sm font-semibold hover:bg-gray-700 transition">Close</button>
        </div>
      </div>
    </div>
  )
}

export default function V15rTeamPanel() {
  const { isDemoMode, hasHydrated } = useDemoMode()
  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()
  if (!backup) return <NoData />

  const { isOwner, isAdmin, user } = useAuth()
  const [showDemoInviteModal, setShowDemoInviteModal] = useState(false)
  const [showEmployeeInviteModal, setShowEmployeeInviteModal] = useState(false)

  const employees = (backup?.employees || []) as EnhancedEmployee[]
  // Phase 6S-C: the full `employees` array is kept for historical resolution (log
  // rows / cost tables must still resolve tombstoned employees by empId). The
  // ACTIVE roster, cost projections, and cards use liveEmployees so deleted /
  // inactive / closed employees drop out of active views but never from history.
  const liveEmployees = getLiveEmployees(employees) as EnhancedEmployee[]
  const logs = (backup?.logs || [])
  const projects = (backup?.projects || [])
  const [, forceUpdate] = useState({})
  const [hypotheticals, setHypotheticals] = useState<HypotheticalPosition[]>([])
  const [showHypForm, setShowHypForm] = useState(false)
  const [hypForm, setHypForm] = useState({ title: '', roleType: '', billRate: 0, costRate: 0, projectedHoursMonth: 0 })
  const [expandedHypId, setExpandedHypId] = useState<string | null>(null)
  const [costAnalysisVisible, setCostAnalysisVisible] = useState<CostAnalysisState>({})

  // ── Projection Scenarios / Overhead UI state ──────────────────────────────
  const [scenariosCollapsed, setScenariosCollapsed] = useState(false)
  const [overheadCollapsed, setOverheadCollapsed] = useState(false)
  const [overheadViewMode, setOverheadViewMode] = useState<'employee' | 'project'>('employee')
  const [recoveryModel, setRecoveryModel] = useState<'fixed' | 'margin'>('fixed')
  const [activeScenarioId, setActiveScenarioId] = useState<string>(() => {
    const scens: any[] = backup.settings?.projectionScenarios || []
    return (backup.settings as any)?.activeScenarioId || scens[0]?.id || 'scen-default'
  })
  const [editingScenName, setEditingScenName] = useState<{id: string; val: string} | null>(null)

  // ── Edit employee modal ────────────────────────────────────────────────────
  const [editingEmployee, setEditingEmployee] = useState<EnhancedEmployee | null>(null)

  // ── Team Cost Settings modal ───────────────────────────────────────────────
  const [showCostSettingsModal, setShowCostSettingsModal] = useState(false)

  // ── Employee Detail modal ─────────────────────────────────────────────────
  const [selectedEmployee, setSelectedEmployee] = useState<EnhancedEmployee | null>(null)

  // ── Three-type employee system (Migration 048) ──────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false)
  const [ohmCard, setOhmCard] = useState<{
    show: boolean
    employeeType: string
    classification: string
    name: string
    empId: string
  }>({ show: false, employeeType: '', classification: '', name: '', empId: '' })

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

    ;(liveEmployees || []).forEach((emp) => {
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
      // Support both empId and employeeId keys for log compatibility
      const empId = log.empId || log.employeeId
      const employee = (employees || []).find((e) => e.id === empId)
      const project = (projects || []).find((p) => p.id === log.projId)
      // Use helper loadedHourly — respects worker type, no double-multiply
      const loadedRate = getLoadedHourlyRate(employee, backup?.settings)
      const cost = (log.hrs || 0) * loadedRate

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
      // Use shared helper — loadedHourly respects worker type with no double-multiply.
      const loaded = getLoadedHourlyRate(stats.employee, backup?.settings)
      total += stats.monthlyHours * loaded
    })
    // Add hypothetical costs (no W-2 burden — planning only)
    hypotheticals.forEach((hyp) => {
      total += hyp.projectedHoursMonth * (hyp.costRate || 0)
    })
    return total
  }, [employeeStats, hypotheticals])

  // ── Phase 6S-C: team.members remote-baseline scoped save ───────────────────
  // Saves local first for instant UI, then fetches latest remote, merges ONLY
  // employees[] onto it (delete-safe, tombstone/updatedAt LWW), and pushes through
  // the existing remote-baseline path so a stale local roster can never overwrite
  // newer remote employees and a hard delete cannot resurrect. Falls back to a
  // plain scoped save if there is no remote row or the fetch/merge fails.
  const saveEmployeesScoped = (incomingBackup: BackupData) => {
    saveBackupData(incomingBackup) // optimistic local save for instant UI
    ;(async () => {
      try {
        const remote = await fetchLatestRemoteBackup()
        if (remote?.remoteData) {
          const merged = mergeEmployeesIntoRemote(remote.remoteData, incomingBackup)
          await saveBackupWithRemoteBaselineSync(
            merged,
            {
              remoteUpdatedAt: remote.remoteUpdatedAt,
              remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
            },
            {
              source: 'team-members-remote-merge',
              changedKey: 'employees',
              _scopes: ['team.members'],
            },
          )
        } else {
          saveBackupDataAndSync(incomingBackup, 'employees', {
            source: 'team.members',
            _scopes: ['team.members'],
          })
        }
      } catch (err) {
        if ((err as Error)?.name === 'BackupStorageWriteError') return
        console.warn('[TeamPanel] employees remote-baseline save failed — falling back to local scoped save', err)
        try {
          saveBackupDataAndSync(incomingBackup, 'employees', {
            source: 'team.members',
            _scopes: ['team.members'],
          })
        } catch (fallbackErr) {
          if ((fallbackErr as Error)?.name === 'BackupStorageWriteError') return
          throw fallbackErr
        }
      }
    })()
  }

  const toggleMultiplier = (empId: string) => {
    pushState()
    const emp = backup.employees.find(e => e.id === empId) as EnhancedEmployee
    if (emp) {
      emp.applyMultiplier = emp.applyMultiplier === false ? true : false
      // Phase 6S-C: stamp identity/updatedAt then route through scoped save.
      Object.assign(emp, ensureEmployeeIdentity(emp, new Date().toISOString()))
      saveEmployeesScoped(backup)
      forceUpdate({})
    }
  }

  const deleteEmployee = (id: string) => {
    // Phase 6S-C: never hard-filter — convert to a tombstone so historical logs /
    // estimate rows keep resolving and a stale device cannot resurrect the row.
    const emp = backup.employees?.find((e: any) => e.id === id)
    if (!emp) return
    // Block deleting owner/me records.
    const rawId = String(id || '').toLowerCase().trim()
    const rawName = String(emp.name || '').toLowerCase().trim()
    if (emp.isOwner === true || rawId === 'me' || rawId === 'owner' || rawId === 'owner-virtual' || rawName === 'owner / me') {
      alert('The owner record cannot be deleted.')
      return
    }
    if (!confirm('Delete this employee?')) return
    pushState()
    const deletedBy = (user as any)?.email || (user as any)?.id || 'user'
    const tombstone = createEmployeeTombstone(emp, deletedBy)
    backup.employees = backup.employees.map((e: any) => e.id === id ? tombstone : e)
    saveEmployeesScoped(backup)
    forceUpdate({})
  }

  const handleEditSave = (id: string, updates: Partial<EnhancedEmployee>) => {
    pushState()
    const emp = backup.employees?.find((e: any) => e.id === id)
    if (emp) {
      Object.assign(emp, updates)
      // Phase 6S-C: preserve id/createdAt, stamp updatedAt, route through scoped save.
      Object.assign(emp, ensureEmployeeIdentity(emp, new Date().toISOString()))
      saveEmployeesScoped(backup)
    }
    setEditingEmployee(null)
    forceUpdate({})
  }

  // ── Add Team Member (three-type system) ────────────────────────────────────
  const handleAddTeamMember = (record: any) => {
    pushState()
    if (!backup.employees) backup.employees = []

    if (record.employee_type === 'hypothetical') {
      // Hypotheticals stay in component state (not persisted) — same as before
      const newHyp: HypotheticalPosition = {
        id: record.id,
        title: record.role || record.name || 'Planned Position',
        roleType: record.role || '',
        billRate: record.billRate || record.hourly_rate || 0,
        costRate: record.costRate || record.hourly_rate || 0,
        projectedHoursMonth: 160, // default 160 hrs/month
      }
      setHypotheticals(prev => [...prev, newHyp])
    } else {
      // Permanent and per_project are saved to backup.
      // Phase 6S-C: stamp id/createdAt/updatedAt then route through scoped save.
      const stamped = ensureEmployeeIdentity(record, new Date().toISOString())
      backup.employees = [...backup.employees, stamped]
      saveEmployeesScoped(backup)
      forceUpdate({})

      // Fire OHM compliance card (non-blocking — save already happened)
      setOhmCard({
        show: true,
        employeeType: record.employee_type,
        classification: record.classification || (record.employee_type === 'permanent' ? 'W-2' : '1099'),
        name: record.name || record.role || 'New Employee',
        empId: stamped.id,
      })
    }

    setShowAddModal(false)
  }

  const markComplianceAcknowledged = (empId: string) => {
    const emp = backup.employees?.find((e: any) => e.id === empId)
    if (emp) {
      emp.compliance_acknowledged = true
      // Phase 6S-C: stamp updatedAt then route through scoped save.
      Object.assign(emp, ensureEmployeeIdentity(emp, new Date().toISOString()))
      saveEmployeesScoped(backup)
    }
    setOhmCard(prev => ({ ...prev, show: false }))
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

  // ── Projection Scenarios helpers ──────────────────────────────────────────
  const getScenarios = (): any[] => {
    const saved: any[] = (backup.settings as any)?.projectionScenarios || []
    if (saved.length > 0) return saved
    // Default: current active employees at 40 hrs/week (Phase 6S-C: exclude
    // tombstoned/inactive employees from the default roster).
    const activeEmps = getLiveEmployees(employees).filter((e: any) => !e.status || e.status === 'Active')
    if (activeEmps.length === 0) return []
    return [{
      id: 'scen-default',
      name: 'Current Team',
      workers: activeEmps.map((e: any) => ({ empId: e.id, hoursPerWeek: 40, weeksPerYear: 52 })),
    }]
  }

  const persistScenarios = (scens: any[]) => {
    if (!backup.settings) (backup as any).settings = {}
    ;(backup.settings as any).projectionScenarios = scens.length > 0 ? scens : undefined
    ;(backup.settings as any).activeScenarioId = activeScenarioId
    saveBackupData(backup)
    forceUpdate({})
  }

  const addScenario = () => {
    const scens = getScenarios()
    const newId = 'scen-' + Date.now()
    const activeEmps = getLiveEmployees(employees).filter((e: any) => !e.status || e.status === 'Active')
    const newScen = {
      id: newId,
      name: 'New Scenario',
      workers: activeEmps.map((e: any) => ({ empId: e.id, hoursPerWeek: 40, weeksPerYear: 52 })),
    }
    if (!backup.settings) (backup as any).settings = {}
    ;(backup.settings as any).projectionScenarios = [...scens, newScen]
    ;(backup.settings as any).activeScenarioId = newId
    saveBackupData(backup)
    setActiveScenarioId(newId)
    forceUpdate({})
  }

  const deleteScenario = (id: string) => {
    const scens = getScenarios().filter((s: any) => s.id !== id)
    const nextId = scens[0]?.id || 'scen-default'
    if (!backup.settings) (backup as any).settings = {}
    ;(backup.settings as any).projectionScenarios = scens.length > 0 ? scens : undefined
    ;(backup.settings as any).activeScenarioId = nextId
    saveBackupData(backup)
    setActiveScenarioId(nextId)
    forceUpdate({})
  }

  const updateScenWorker = (scenId: string, empId: string, field: 'hoursPerWeek' | 'weeksPerYear', value: number) => {
    const scens = getScenarios().map((s: any) =>
      s.id !== scenId ? s : {
        ...s,
        workers: s.workers.map((w: any) => w.empId === empId ? { ...w, [field]: value } : w),
      }
    )
    persistScenarios(scens)
  }

  const renameScenario = (id: string, name: string) => {
    const scens = getScenarios().map((s: any) => s.id === id ? { ...s, name } : s)
    persistScenarios(scens)
    setEditingScenName(null)
  }

  // ── Return scenario workers merged with ALL active employees ──────────────
  // Employees already in the scenario keep their existing hrs/wks.
  // Active employees missing from the scenario appear with 0 hrs/wk defaults.
  const getMergedScenarioWorkers = (scen: any): any[] => {
    if (!scen) return []
    const existing: any[] = scen.workers || []
    const ownerInMap = employees.find((e: any) => e.isOwner || String(e.name || '').toLowerCase().trim() === 'owner / me')
    const existingIds = new Set(existing.map((w: any) => {
      if (w.empId === 'me') return ownerInMap?.id || 'me'
      return w.empId
    }))
    const activeEmps = employees.filter((e: any) => !e.status || e.status === 'Active')
    const missing = activeEmps
      .filter((e: any) => !existingIds.has(e.id))
      .map((e: any) => ({ empId: e.id, hoursPerWeek: 0, weeksPerYear: 52 }))
    return [...existing, ...missing]
  }

  // ── Add employee to scenario if not already present, then update field ────
  const ensureAndUpdateScenWorker = (scenId: string, empId: string, field: 'hoursPerWeek' | 'weeksPerYear', value: number) => {
    const scens = getScenarios()
    const scen = scens.find((s: any) => s.id === scenId)
    if (!scen) return
    const exists = (scen.workers || []).some((w: any) => w.empId === empId)
    const updated = scens.map((s: any) => {
      if (s.id !== scenId) return s
      const workers = exists
        ? s.workers.map((w: any) => w.empId === empId ? { ...w, [field]: value } : w)
        : [...(s.workers || []), { empId, hoursPerWeek: field === 'hoursPerWeek' ? value : 0, weeksPerYear: field === 'weeksPerYear' ? value : 52 }]
      return { ...s, workers }
    })
    persistScenarios(updated)
  }

  const getScenarioEmp = (empId: string) => {
    if (!empId || empId === 'me') {
      const ownerEmp = employees.find((e: any) => e.isOwner || String(e.name || '').toLowerCase().trim() === 'owner / me')
      return normalizeEmployee(ownerEmp || { id: 'me', name: 'Owner / Me', isOwner: true, billRate: 0, costRate: 0 })
    }
    const found = employees.find((e: any) => e.id === empId)
    return found ? normalizeEmployee(found) : null
  }

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-3 md:p-5 space-y-6 overflow-x-hidden">
      {/* HEADER */}
      <div className="flex items-center justify-between gap-3 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <Users className="w-8 h-8 text-blue-400" />
          <div>
            <h1 className="text-3xl font-bold text-gray-100">Team 💼</h1>
            <p className="text-sm text-gray-400">Employee hours, costs, and performance tracking with owner override</p>
          </div>
        </div>
        {/* Header action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowCostSettingsModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold transition shadow"
            style={{ minHeight: '44px' }}
          >
            <TrendingUp className="w-4 h-4" />
            Team Cost Settings
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowEmployeeInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold transition shadow"
              style={{ minHeight: '44px' }}
            >
              <UserPlus className="w-4 h-4" />
              Invite Employee
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => setShowDemoInviteModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-semibold transition shadow"
              style={{ minHeight: '44px' }}
            >
              <UserPlus className="w-4 h-4" />
              Invite Beta User
            </button>
          )}
        </div>
      </div>

      {/* ADMIN TIMECARDS OVERVIEW (read-only) */}
      {isAdmin && <AdminTimecardsPanel />}

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
          {/* Phase 6S-C hotfix: Org Pyramid uses liveEmployees so deleted/inactive
              employees are hidden here too (they remain in backup for history). */}
          {liveEmployees.filter(e => !e.isOwner).length > 0 || hypotheticals.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full">
              {/* Real employees (non-owner) — style by employee_type */}
              {liveEmployees
                .filter(e => !e.isOwner)
                .map((rawEmp) => {
                  const emp = normalizeEmployee(rawEmp)
                  const project = projects.find(p => p.id === emp.project_id)

                  // Per-project: dashed border, amber project color tag
                  if (emp.employee_type === 'per_project') {
                    return (
                      <div key={emp.id} className="text-center">
                        <div className="bg-amber-700/15 border-2 border-dashed border-amber-500/60 rounded-lg px-3 py-2 relative hover:border-amber-500 transition">
                          <div className="text-sm font-semibold text-amber-200">{emp.name}</div>
                          <div className="text-xs text-amber-400/80">{emp.role || 'Per-Project'}</div>
                          {project && (
                            <div className="mt-1 text-xs px-1.5 py-0.5 bg-amber-600/30 text-amber-300 rounded inline-block">
                              {project.name}
                            </div>
                          )}
                          <div className="text-xs text-gray-600 mt-0.5">{emp.classification}</div>
                        </div>
                      </div>
                    )
                  }

                  // Permanent: solid border, role color (blue)
                  return (
                    <div key={emp.id} className="text-center">
                      <div className="bg-blue-700/15 border border-blue-600/50 rounded-lg px-3 py-2 hover:border-blue-500 transition">
                        <div className="text-sm font-semibold text-blue-200">{emp.name}</div>
                        <div className="text-xs text-blue-400/80">{emp.role || 'Team Member'}</div>
                        <div className="text-xs text-gray-600 mt-0.5">W-2 · {emp.status}</div>
                      </div>
                    </div>
                  )
                })}

              {/* Hypothetical positions — ghost/transparent, labeled PLANNED */}
              {hypotheticals.map((hyp) => (
                <div key={hyp.id} className="text-center">
                  <div className="bg-transparent border-2 border-dashed border-purple-600/50 rounded-lg px-3 py-2 relative opacity-75">
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs px-2 py-0.5 bg-[var(--bg-primary)] border border-purple-600/50 text-purple-400 rounded font-bold tracking-widest">
                      PLANNED
                    </div>
                    <div className="text-sm font-semibold text-purple-300 mt-1">{hyp.title}</div>
                    <div className="text-xs text-purple-400/70">{hyp.roleType}</div>
                    <button
                      onClick={() => deleteHypothetical(hyp.id)}
                      className="mt-2 text-xs px-1.5 py-0.5 bg-red-600/20 text-red-400 rounded hover:bg-red-600/40 transition"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500 text-sm">No team members yet — add your first position below</div>
          )}

          {/* ── Add Team Member button (replaces "Add Hypothetical Position") ── */}
          <div className="mt-4 w-full max-w-md">
            <button
              onClick={() => setShowAddModal(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600/30 text-blue-300 rounded-lg hover:bg-blue-600/50 transition text-sm font-semibold border border-blue-600/30"
            >
              <Plus className="w-4 h-4" />
              + Add Team Member
            </button>
          </div>
        </div>
      </div>

      {/* EMPLOYEE COST STRUCTURE — moved to Team Cost Settings modal */}

      {/* ENHANCED EMPLOYEE COST VS PIPELINE CHART */}
      <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-6">
        <h2 className="text-lg font-bold text-gray-100 mb-4">6-Month Cost vs Pipeline Forecast</h2>
        <p className="text-sm text-gray-500 mb-4">Next 6 months: stacked costs (red/orange/yellow) vs projected revenue (green line)</p>
        <div className="relative w-full" style={{ height: '320px' }}>
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
              // New formula: monthly cost = hourly rate × hours per week × 4.33 weeks
              // Add payroll taxes (15.3%), workers comp (4%), GL (1.5%)
              // Total loaded cost = base × 1.208
              const baseMonthlyCost = hyp.costRate * hyp.projectedHoursMonth
              const payrollTax = baseMonthlyCost * 0.153
              const workersComp = baseMonthlyCost * 0.04
              const glInsurance = baseMonthlyCost * 0.015
              const monthlyLoadedCost = baseMonthlyCost + payrollTax + workersComp + glInsurance
              const monthlyBilled = hyp.projectedHoursMonth * hyp.billRate
              const monthlyContribution = monthlyBilled - monthlyLoadedCost
              const targetMargin = num(backup.settings?.markup || 35) / 100
              const targetRevenue = targetMargin > 0 ? monthlyLoadedCost / targetMargin : 0
              const sixMonthCost = monthlyLoadedCost * 6
              const loadedCostPerHour = monthlyLoadedCost / hyp.projectedHoursMonth
              const breakEvenUtilization = hyp.billRate > 0 ? Math.round((loadedCostPerHour / hyp.billRate) * 100) : 0

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
                    <div className="flex justify-between">
                      <span className="text-gray-400">6-Month Cost</span>
                      <span className="text-yellow-400 font-semibold">{formatCurrency(sixMonthCost)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Revenue needed to cover</span>
                      <span className="text-cyan-400 font-semibold">{formatCurrency(targetRevenue)}/mo</span>
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
                      {/* Chart 1: Cost Breakdown (Loaded Costs) */}
                      <div>
                        <h4 className="text-xs font-semibold text-gray-400 uppercase mb-3">Loaded Cost Breakdown</h4>
                        <div className="space-y-2">
                          {(() => {
                            const baseMonthlyCost = hyp.costRate * hyp.projectedHoursMonth
                            const payrollTax = baseMonthlyCost * 0.153
                            const workersComp = baseMonthlyCost * 0.04
                            const glInsurance = baseMonthlyCost * 0.015
                            const totalMonthly = baseMonthlyCost + payrollTax + workersComp + glInsurance
                            const totalAnnual = totalMonthly * 12

                            return [
                              { label: 'Base Cost', value: baseMonthlyCost, color: '#f87171' },
                              { label: 'Payroll Tax (15.3%)', value: payrollTax, color: '#fbbf24' },
                              { label: 'Workers Comp (4%)', value: workersComp, color: '#34d399' },
                              { label: 'GL Insurance (1.5%)', value: glInsurance, color: '#60a5fa' },
                            ].map(bar => (
                              <div key={bar.label} className="flex items-center gap-2">
                                <span className="text-xs text-gray-400 w-24">{bar.label}</span>
                                <div className="flex-1 h-4 bg-[var(--bg-input)] rounded overflow-hidden">
                                  <div
                                    className="h-full rounded"
                                    style={{
                                      width: `${(bar.value / totalMonthly) * 100}%`,
                                      backgroundColor: bar.color
                                    }}
                                  />
                                </div>
                                <span className="text-xs text-gray-300 w-20 text-right">${bar.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                              </div>
                            ))
                          })()}
                          <div className="pt-2 border-t border-gray-700 text-xs">
                            <div className="flex justify-between font-semibold">
                              <span className="text-gray-300">Total Monthly (Loaded)</span>
                              <span className="text-white">{formatCurrency(monthlyLoadedCost)}</span>
                            </div>
                            <div className="flex justify-between font-semibold text-yellow-400">
                              <span className="text-gray-300">Total Annual (Loaded)</span>
                              <span>{formatCurrency(monthlyLoadedCost * 12)}</span>
                            </div>
                          </div>
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

      {/* ── TEAM PROJECTION SCENARIOS ───────────────────────────────────────── */}
      {(() => {
        const scenarios = getScenarios()
        const activeScen = scenarios.find((s: any) => s.id === activeScenarioId) || scenarios[0]
        const payrollMult = num(backup.settings?.payrollMult || 1.20)

        // Per-worker calculations — all active employees merged with scenario data
        const workerRows = getMergedScenarioWorkers(activeScen).map((w: any) => {
          const emp = getScenarioEmp(w.empId)
          if (!emp) return null
          const profile = getWorkerCostProfile(emp, backup.settings)
          const hrs = num(w.hoursPerWeek) || 0
          const weeks = num(w.weeksPerYear) || 52
          const monthlyHrs = hrs * 4.33
          const yearlyHrs = hrs * weeks
          const monthlyCost = monthlyHrs * profile.loadedHourly
          const yearlyCost = yearlyHrs * profile.loadedHourly
          const billRate = num(emp.billRate) || 0
          const monthlyRev = monthlyHrs * billRate
          const yearlyRev = yearlyHrs * billRate
          return { emp, profile, hrs, weeks, monthlyHrs, yearlyHrs, monthlyCost, yearlyCost, billRate, monthlyRev, yearlyRev, w }
        }).filter(Boolean)

        const totals = workerRows.reduce((acc: any, r: any) => ({
          monthlyCost: acc.monthlyCost + r.monthlyCost,
          yearlyCost: acc.yearlyCost + r.yearlyCost,
          monthlyRev: acc.monthlyRev + r.monthlyRev,
          yearlyRev: acc.yearlyRev + r.yearlyRev,
        }), { monthlyCost: 0, yearlyCost: 0, monthlyRev: 0, yearlyRev: 0 })
        const yearlyProfit = totals.yearlyRev - totals.yearlyCost

        return (
          <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-5">
            {/* Section header */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-100">📊 Team Projection Scenarios</h2>
                <p className="text-xs text-gray-500 mt-0.5">Model staffing scenarios — project cost, revenue, and profit by worker</p>
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={addScenario}
                  className="text-xs px-3 py-1.5 bg-blue-600/30 text-blue-300 rounded-lg hover:bg-blue-600/50 transition font-semibold border border-blue-600/30"
                >
                  + New Scenario
                </button>
                <button
                  onClick={() => setScenariosCollapsed(v => !v)}
                  className="text-xs px-2 py-1.5 bg-gray-700/50 text-gray-400 rounded hover:bg-gray-700 transition"
                >
                  {scenariosCollapsed ? '▼ Show' : '▲ Hide'}
                </button>
              </div>
            </div>

            {!scenariosCollapsed && (
              <>
                {/* Scenario tabs */}
                {scenarios.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">No employees yet — add team members to build scenarios.</div>
                ) : (
                  <>
                    <div className="flex gap-2 mb-4 flex-wrap">
                      {scenarios.map((scen: any) => (
                        <div key={scen.id} className="flex items-center gap-1">
                          {editingScenName?.id === scen.id ? (
                            <form onSubmit={e => { e.preventDefault(); renameScenario(scen.id, editingScenName.val) }} className="flex gap-1">
                              <input
                                autoFocus
                                value={editingScenName.val}
                                onChange={e => setEditingScenName({ id: scen.id, val: e.target.value })}
                                onBlur={() => renameScenario(scen.id, editingScenName.val)}
                                className="text-xs px-2 py-1 bg-[var(--bg-input)] border border-blue-500 text-gray-100 rounded w-36 focus:outline-none"
                              />
                            </form>
                          ) : (
                            <button
                              onClick={() => setActiveScenarioId(scen.id)}
                              onDoubleClick={() => setEditingScenName({ id: scen.id, val: scen.name })}
                              className={`text-xs px-3 py-1.5 rounded-lg transition font-medium ${
                                activeScenarioId === scen.id
                                  ? 'bg-blue-600/40 text-blue-200 border border-blue-500/60'
                                  : 'bg-gray-700/40 text-gray-400 border border-gray-700 hover:bg-gray-700'
                              }`}
                            >
                              {scen.name}
                            </button>
                          )}
                          {scenarios.length > 1 && (
                            <button
                              onClick={() => deleteScenario(scen.id)}
                              className="text-xs text-red-400/60 hover:text-red-400 transition px-1"
                              title="Delete scenario"
                            >×</button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Worker rows table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-700 text-gray-500">
                            <th className="text-left py-2 pr-3">Worker</th>
                            <th className="text-left py-2 pr-2">Type</th>
                            <th className="text-right py-2 pr-2">Base/hr</th>
                            <th className="text-right py-2 pr-2">Loaded/hr</th>
                            <th className="text-right py-2 pr-2">Bill/hr</th>
                            <th className="text-right py-2 pr-2 w-20">Hrs/wk</th>
                            <th className="text-right py-2 pr-2 w-16">Wks/yr</th>
                            <th className="text-right py-2 pr-2">Mo Cost</th>
                            <th className="text-right py-2 pr-2">Mo Rev</th>
                            <th className="text-right py-2">Yr Profit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                          {workerRows.map((r: any) => {
                            const profit = r.yearlyRev - r.yearlyCost
                            return (
                              <tr key={r.w.empId} className="hover:bg-gray-700/20 transition">
                                <td className="py-2 pr-3 font-medium text-gray-200 whitespace-nowrap">{r.emp.name}</td>
                                <td className="py-2 pr-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    r.profile.workerType === 'owner' ? 'bg-blue-600/30 text-blue-300' :
                                    r.profile.workerType === 'w2'    ? 'bg-orange-600/30 text-orange-300' :
                                                                       'bg-amber-600/30 text-amber-300'
                                  }`}>
                                    {r.profile.workerType === 'owner' ? 'Owner' : r.profile.workerType === 'w2' ? 'W-2' : '1099'}
                                  </span>
                                </td>
                                <td className="py-2 pr-2 text-right text-gray-300">${r.profile.baseHourly.toFixed(0)}</td>
                                <td className="py-2 pr-2 text-right text-amber-400">${r.profile.loadedHourly.toFixed(0)}</td>
                                <td className="py-2 pr-2 text-right text-emerald-400">${r.billRate.toFixed(0)}</td>
                                <td className="py-2 pr-2 text-right">
                                  <input
                                    type="number"
                                    min="0"
                                    max="80"
                                    value={r.w.hoursPerWeek}
                                    onChange={e => ensureAndUpdateScenWorker(activeScen.id, r.w.empId, 'hoursPerWeek', num(e.target.value))}
                                    className="w-16 bg-[var(--bg-input)] border border-gray-600 text-gray-100 text-xs px-2 py-1 rounded text-right focus:outline-none focus:border-blue-500"
                                  />
                                </td>
                                <td className="py-2 pr-2 text-right">
                                  <input
                                    type="number"
                                    min="1"
                                    max="52"
                                    value={r.w.weeksPerYear}
                                    onChange={e => ensureAndUpdateScenWorker(activeScen.id, r.w.empId, 'weeksPerYear', num(e.target.value))}
                                    className="w-14 bg-[var(--bg-input)] border border-gray-600 text-gray-100 text-xs px-2 py-1 rounded text-right focus:outline-none focus:border-blue-500"
                                  />
                                </td>
                                <td className="py-2 pr-2 text-right text-red-400 font-medium">{formatCurrency(r.monthlyCost)}</td>
                                <td className="py-2 pr-2 text-right text-blue-300 font-medium">{formatCurrency(r.monthlyRev)}</td>
                                <td className={`py-2 text-right font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(profit)}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Scenario totals strip */}
                    {workerRows.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-gray-700 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-[var(--bg-secondary)] rounded p-2 text-center">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">Monthly Cost</div>
                          <div className="text-sm font-bold text-red-400">{formatCurrency(totals.monthlyCost)}</div>
                        </div>
                        <div className="bg-[var(--bg-secondary)] rounded p-2 text-center">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">Monthly Revenue</div>
                          <div className="text-sm font-bold text-blue-300">{formatCurrency(totals.monthlyRev)}</div>
                        </div>
                        <div className="bg-[var(--bg-secondary)] rounded p-2 text-center">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">Yearly Cost</div>
                          <div className="text-sm font-bold text-orange-400">{formatCurrency(totals.yearlyCost)}</div>
                        </div>
                        <div className="bg-[var(--bg-secondary)] rounded p-2 text-center">
                          <div className="text-[10px] text-gray-500 uppercase mb-1">Yearly Profit</div>
                          <div className={`text-sm font-bold ${yearlyProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(yearlyProfit)}</div>
                        </div>
                      </div>
                    )}

                    <p className="text-[10px] text-gray-600 mt-3">
                      Cost: Owner = base, 1099 = base, W-2 = base × {payrollMult.toFixed(2)}x. Revenue = bill rate × hours. Double-click tab to rename.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* ── OVERHEAD RECOVERY TRACKER ─────────────────────────────────────────── */}
      {(() => {
        // ── Source of truth: Settings → Overhead Manager ──────────────────────
        const ohSettings = (backup.settings as any)?.overhead || { essential: [], extra: [], loans: [], vehicle: [] }
        let monthlyOH = 0
        Object.values(ohSettings).forEach((section: any) => {
          monthlyOH += (section || []).reduce((s: number, item: any) => s + num(item.monthly || 0), 0)
        })
        const annualOH = monthlyOH * 12
        const billableHoursYear = num((backup.settings as any)?.billableHrsYear || 1800)
        const overheadPerHour = billableHoursYear > 0 ? annualOH / billableHoursYear : 0

        // ── Active scenario ────────────────────────────────────────────────────
        const scenarios = getScenarios()
        const activeScen = scenarios.find((s: any) => s.id === activeScenarioId) || scenarios[0]

        // ── Per-employee logged hours map (normalize 'me' → owner id) ──────────
        const empLogMap: Record<string, number> = {}
        ;(backup.logs || []).forEach((log: any) => {
          const hrs = num(log.hrs || log.hours || 0)
          if (hrs <= 0) return
          const eid = log.empId || log.employeeId || ''
          empLogMap[eid] = (empLogMap[eid] || 0) + hrs
        })
        // Translate 'me' key to owner's actual emp.id so per-worker lookups work.
        // Guard: only rename when owner's real id is NOT already 'me' — otherwise
        // we'd self-assign empLogMap['me'] += empLogMap['me'] then delete it, wiping 240 hrs.
        const ownerEmpForLog = employees.find((e: any) => e.isOwner || String(e.name || '').toLowerCase().trim() === 'owner / me')
        if (ownerEmpForLog && ownerEmpForLog.id !== 'me' && empLogMap['me'] !== undefined) {
          empLogMap[ownerEmpForLog.id] = (empLogMap[ownerEmpForLog.id] || 0) + empLogMap['me']
          delete empLogMap['me']
        }

        // ── Actual recovered: from all logged hours × bill/cost rates ──────────
        let actualLoggedHrs = 0
        let actualRevenue = 0
        let actualDirectCost = 0
        ;(backup.logs || []).forEach((log: any) => {
          const hrs = num(log.hrs || log.hours || 0)
          if (hrs <= 0) return
          const emp = employees.find((e: any) => e.id === (log.empId || log.employeeId))
          if (!emp) return
          const bill = num(emp.billRate || emp.bill_rate || 0)
          const loaded = getLoadedHourlyRate(emp, backup.settings)
          actualLoggedHrs += hrs
          actualRevenue += hrs * bill
          actualDirectCost += hrs * loaded
        })
        const actualGrossContrib = actualRevenue - actualDirectCost
        const actualOverheadRecovered = actualLoggedHrs * overheadPerHour
        const actualTrueProfit = actualGrossContrib - actualOverheadRecovered

        // ── Scenario planned hours (TOTAL) — use merged workers (all active emps)
        const mergedScenWorkers = getMergedScenarioWorkers(activeScen)
        const scenarioPlannedHours = mergedScenWorkers.reduce((s: number, w: any) => s + num(w.hoursPerWeek) * num(w.weeksPerYear), 0)
        const scenarioMonthlyHours = mergedScenWorkers.reduce((s: number, w: any) => s + num(w.hoursPerWeek) * 4.33, 0)

        // ── Scenario REMAINING hours — subtract actual logged to avoid double-count
        const scenarioRemainingHours = Math.max(0, scenarioPlannedHours - actualLoggedHrs)
        const scenarioRemainingRecovery = scenarioRemainingHours * overheadPerHour

        // ── Forecast revenue/cost based on REMAINING scenario hours only ───────
        let forecastRevenue = 0
        let forecastDirectCost = 0
        ;mergedScenWorkers.forEach((w: any) => {
          const emp = employees.find((e: any) => e.id === w.empId) ||
            (w.empId === 'me' ? employees.find((e: any) => e.isOwner || String(e.name || '').toLowerCase().trim() === 'owner / me') : null)
          if (!emp) return
          const plannedYrHrs = num(w.hoursPerWeek) * num(w.weeksPerYear)
          const empLogged = empLogMap[emp.id] || 0
          const remainHrs = Math.max(0, plannedYrHrs - empLogged)
          const bill = num(emp.billRate || emp.bill_rate || 0)
          const loaded = getLoadedHourlyRate(emp, backup.settings)
          forecastRevenue += remainHrs * bill
          forecastDirectCost += remainHrs * loaded
        })
        const forecastGrossContrib = forecastRevenue - forecastDirectCost

        // ── Actual-only math (donut shows this) ───────────────────────────────
        const actualRemaining = Math.max(0, annualOH - actualOverheadRecovered)
        const actualCoveredPct = annualOH > 0 ? Math.min(actualOverheadRecovered / annualOH, 1) : 0
        const actualRemainingPct = Math.max(0, 1 - actualCoveredPct)

        // ── Projected math: actual + scenario REMAINING (no double-count) ─────
        const projectedTotal = actualOverheadRecovered + scenarioRemainingRecovery
        const projectedRemaining = Math.max(0, annualOH - projectedTotal)
        const projectedSurplus = Math.max(0, projectedTotal - annualOH)
        const projectedCoveredPct = annualOH > 0 ? Math.min(projectedTotal / annualOH, 1) : 0

        const monthsToRecover = annualOH > 0 && scenarioMonthlyHours > 0 && overheadPerHour > 0
          ? annualOH / (scenarioMonthlyHours * overheadPerHour)
          : null

        // ── Owner-only comparison ──────────────────────────────────────────────
        const ownerEmp = employees.find((e: any) => e.isOwner || String(e.name || '').toLowerCase().trim() === 'owner / me')
        const ownerWorker = activeScen?.workers?.find((w: any) => {
          if (!ownerEmp) return w.empId === 'me'
          return w.empId === ownerEmp.id || w.empId === 'me'
        })
        const ownerMonthlyHrs = ownerWorker ? num(ownerWorker.hoursPerWeek) * 4.33 : 0
        const ownerMonthsToRecover = annualOH > 0 && ownerMonthlyHrs > 0 && overheadPerHour > 0
          ? annualOH / (ownerMonthlyHrs * overheadPerHour)
          : null

        // ── Donut chart geometry (actual-only: 2 arcs) ────────────────────────
        const cx = 70; const cy = 70; const r = 54; const stroke = 18
        const circ = 2 * Math.PI * r
        const gap = (2 / 360) * circ
        const arcActual = actualCoveredPct * circ - (actualCoveredPct > 0 && actualRemainingPct > 0 ? gap : 0)
        const arcActualRemaining = actualRemainingPct * circ - (actualCoveredPct > 0 && actualRemainingPct > 0 ? gap : 0)

        // ── Remaining-pace date anchors (shared across all workers) ─────────────
        const _today = new Date()
        const _yearEnd = new Date(_today.getFullYear(), 11, 31)
        const _msPerDay = 86400000
        const _daysRemaining = Math.max(0, Math.ceil((_yearEnd.getTime() - _today.getTime()) / _msPerDay))
        const _weeksRemaining = _daysRemaining / 7
        const _monthsRemaining = _daysRemaining / 30.4375
        const _startOfYear = new Date(_today.getFullYear(), 0, 1)
        const _totalDaysInYear = (_yearEnd.getTime() - _startOfYear.getTime()) / _msPerDay + 1
        const _daysElapsed = Math.max(0, (_today.getTime() - _startOfYear.getTime()) / _msPerDay)
        const _yearProgressPct = _daysElapsed / _totalDaysInYear

        // ── By-employee planning rows — all active employees via merged workers ──
        const empRows = mergedScenWorkers.map((w: any) => {
          const emp = employees.find((e: any) => e.id === w.empId) ||
            (w.empId === 'me' ? employees.find((e: any) => e.isOwner || String(e.name || '').toLowerCase().trim() === 'owner / me') : null)
          if (!emp) return null
          const hrsPerWeek = num(w.hoursPerWeek)
          const weeksPerYear = num(w.weeksPerYear || 52)
          const hrsPerDay = hrsPerWeek / 5
          const hrsPerMonth = hrsPerWeek * 4.33
          const plannedYearlyHrs = hrsPerWeek * weeksPerYear
          const empLogged = empLogMap[emp.id] || 0
          const remainingHrs = Math.max(0, plannedYearlyHrs - empLogged)
          const bill = num(emp.billRate || emp.bill_rate || 0)
          const loaded = getLoadedHourlyRate(emp, backup.settings)
          // Actual (logged)
          const actualEmpRevenue = empLogged * bill
          const actualEmpCost = empLogged * loaded
          const actualEmpGross = actualEmpRevenue - actualEmpCost
          const actualEmpOH = empLogged * overheadPerHour
          const actualEmpProfit = actualEmpGross - actualEmpOH
          // Forecast (remaining)
          const fcastRevenue = remainingHrs * bill
          const fcastCost = remainingHrs * loaded
          const fcastGross = fcastRevenue - fcastCost
          const fcastOH = remainingHrs * overheadPerHour
          const fcastProfit = fcastGross - fcastOH
          // Planned totals
          const totalRevenue = plannedYearlyHrs * bill
          const totalDirectCost = plannedYearlyHrs * loaded
          const totalGrossContrib = totalRevenue - totalDirectCost
          const totalOHAllocated = plannedYearlyHrs * overheadPerHour
          const totalTrueProfit = totalGrossContrib - totalOHAllocated
          const ohPct = annualOH > 0 ? Math.min(totalOHAllocated / annualOH * 100, 100) : 0
          const grossPct = totalRevenue > 0 ? (totalGrossContrib / totalRevenue) * 100 : 0
          const grossContribPerHr = bill - loaded
          const trueProfitPerHr = grossContribPerHr - overheadPerHour
          const profile = getWorkerCostProfile(emp, backup.settings)
          // Required remaining pace — display only, does not affect saved scenario values
          const remainingWorkdays = _weeksRemaining * 5
          const reqHrsPerDay = remainingWorkdays > 0 ? remainingHrs / remainingWorkdays : 0
          const reqHrsPerWeek = _weeksRemaining > 0 ? remainingHrs / _weeksRemaining : 0
          const reqHrsPerMonth = _monthsRemaining > 0 ? remainingHrs / _monthsRemaining : 0
          const expectedHrsByToday = plannedYearlyHrs * _yearProgressPct
          const paceDelta = empLogged - expectedHrsByToday
          return {
            emp, hrsPerDay, hrsPerWeek, hrsPerMonth, weeksPerYear, plannedYearlyHrs,
            empLogged, remainingHrs, bill, loaded, grossContribPerHr, trueProfitPerHr,
            actualEmpRevenue, actualEmpCost, actualEmpGross, actualEmpOH, actualEmpProfit,
            fcastRevenue, fcastCost, fcastGross, fcastOH, fcastProfit,
            totalRevenue, totalDirectCost, totalGrossContrib, totalOHAllocated, totalTrueProfit,
            ohPct, grossPct, type: profile.workerType,
            reqHrsPerDay, reqHrsPerWeek, reqHrsPerMonth, paceDelta,
            daysRemaining: _daysRemaining, weeksRemaining: _weeksRemaining,
          }
        }).filter(Boolean)

        // ── By-project rows (actual logged hours only) ─────────────────────────
        const projMap: Record<string, { id: string; name: string; hrs: number; revenue: number; directCost: number }> = {}
        ;(backup.logs || []).forEach((log: any) => {
          const hrs = num(log.hrs || log.hours || 0)
          if (hrs <= 0) return
          const proj = projects.find((p: any) => p.id === log.projId)
          const pName = proj?.name || log.projId || 'Unassigned'
          const pId = log.projId || 'unassigned'
          if (!projMap[pId]) projMap[pId] = { id: pId, name: pName, hrs: 0, revenue: 0, directCost: 0 }
          const emp = employees.find((e: any) => e.id === (log.empId || log.employeeId))
          if (!emp) return
          projMap[pId].hrs += hrs
          projMap[pId].revenue += hrs * num(emp.billRate || emp.bill_rate || 0)
          projMap[pId].directCost += hrs * getLoadedHourlyRate(emp, backup.settings)
        })
        const projRows = Object.values(projMap).map((p: any) => {
          const grossContrib = p.revenue - p.directCost
          const ohAllocated = p.hrs * overheadPerHour
          const trueProfit = grossContrib - ohAllocated
          const ohPct = annualOH > 0 ? Math.min(ohAllocated / annualOH * 100, 100) : 0
          return { ...p, grossContrib, ohAllocated, trueProfit, ohPct }
        })

        return (
          <div className="bg-[var(--bg-card)] rounded-lg border border-indigo-700/40 p-5">
            {/* Header */}
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-100">📊 Overhead Recovery Tracker</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  Actual uses logged hours only. Scenario remaining subtracts logged hours — no double-counting.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('poweron:nav', { detail: { view: 'settings' } }))}
                  className="text-xs px-2.5 py-1.5 bg-indigo-700/30 text-indigo-300 border border-indigo-600/40 rounded hover:bg-indigo-700/50 transition"
                >
                  ⚙ Edit in Overhead Manager
                </button>
                <button
                  onClick={() => setOverheadCollapsed(v => !v)}
                  className="text-xs px-2 py-1.5 bg-gray-700/50 text-gray-400 rounded hover:bg-gray-700 transition"
                >
                  {overheadCollapsed ? '▼ Show' : '▲ Hide'}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Overhead totals from Settings → Overhead Manager. Payroll burden is employee cost — separate from overhead recovery.
            </p>

            {!overheadCollapsed && (
              <>
                {/* Donut chart + KPI row */}
                <div className="flex flex-col sm:flex-row gap-6 mb-6 items-start">
                  {/* Donut — actual recovery only */}
                  <div className="flex-shrink-0">
                    <svg width="140" height="140" viewBox="0 0 140 140">
                      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={stroke} />
                      {arcActualRemaining > 0 && (
                        <circle
                          cx={cx} cy={cy} r={r} fill="none"
                          stroke="#374151" strokeWidth={stroke}
                          strokeDasharray={`${arcActualRemaining} ${circ - arcActualRemaining}`}
                          strokeDashoffset={circ / 4 - arcActual - (actualCoveredPct > 0 && actualRemainingPct > 0 ? gap : 0)}
                          strokeLinecap="butt"
                        />
                      )}
                      {arcActual > 0 && (
                        <circle
                          cx={cx} cy={cy} r={r} fill="none"
                          stroke="#10b981" strokeWidth={stroke}
                          strokeDasharray={`${arcActual} ${circ - arcActual}`}
                          strokeDashoffset={circ / 4}
                          strokeLinecap="butt"
                        />
                      )}
                      <text x={cx} y={cy - 10} textAnchor="middle" fill="#e2e8f0" fontSize="14" fontWeight="bold">
                        {(actualCoveredPct * 100).toFixed(0)}%
                      </text>
                      <text x={cx} y={cy + 4} textAnchor="middle" fill="#10b981" fontSize="9">actual</text>
                      <text x={cx} y={cy + 16} textAnchor="middle" fill="#94a3b8" fontSize="8">recovered</text>
                    </svg>
                    <div className="flex gap-3 mt-1 text-xs justify-center text-gray-300">
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />Actual</span>
                      <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-gray-600" />Remaining</span>
                    </div>
                  </div>

                  {/* KPI cards */}
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <div className="bg-[var(--bg-secondary)] rounded p-3 text-center">
                      <div className="text-xs text-gray-400 uppercase mb-1">Annual Overhead</div>
                      <div className="text-base font-bold text-indigo-300">{formatCurrency(annualOH)}</div>
                      <div className="text-xs text-gray-400">{formatCurrency(monthlyOH)}/mo</div>
                    </div>
                    <div className="bg-[var(--bg-secondary)] rounded p-3 text-center">
                      <div className="text-xs text-gray-400 uppercase mb-1">OH / Billable Hr</div>
                      <div className="text-base font-bold text-yellow-400">{overheadPerHour > 0 ? '$' + overheadPerHour.toFixed(2) : '—'}</div>
                      <div className="text-xs text-gray-400">{billableHoursYear.toFixed(0)} hr target/yr</div>
                    </div>
                    <div className="bg-[var(--bg-secondary)] rounded p-3 text-center">
                      <div className="text-xs text-gray-400 uppercase mb-1">Actual Recovered</div>
                      <div className="text-base font-bold text-emerald-400">{formatCurrency(actualOverheadRecovered)}</div>
                      <div className="text-xs text-gray-300">{actualLoggedHrs.toFixed(0)} total hrs (all workers) · {(actualCoveredPct * 100).toFixed(0)}%</div>
                    </div>
                    <div className="bg-[var(--bg-secondary)] rounded p-3 text-center">
                      <div className="text-xs text-gray-400 uppercase mb-1">Actual Remaining</div>
                      <div className={`text-base font-bold ${actualRemaining <= 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
                        {actualRemaining <= 0 ? '✓ Cleared' : formatCurrency(actualRemaining)}
                      </div>
                      <div className="text-xs text-gray-300">{(actualRemainingPct * 100).toFixed(0)}% still needed</div>
                    </div>
                    <div className="bg-[var(--bg-secondary)] rounded p-3 text-center">
                      <div className="text-xs text-blue-300 uppercase mb-1">Scenario Remaining Recovery</div>
                      <div className="text-base font-bold text-blue-400">{formatCurrency(scenarioRemainingRecovery)}</div>
                      <div className="text-xs text-gray-300">{scenarioRemainingHours.toFixed(0)} hrs left in plan</div>
                    </div>
                    <div className="bg-[var(--bg-secondary)] rounded p-3 text-center">
                      <div className="text-xs text-blue-300 uppercase mb-1">Projected Status</div>
                      {projectedSurplus > 0 ? (
                        <>
                          <div className="text-base font-bold text-emerald-400">+{formatCurrency(projectedSurplus)}</div>
                          <div className="text-xs text-gray-300">surplus if plan completes</div>
                        </>
                      ) : projectedRemaining <= 0 ? (
                        <>
                          <div className="text-base font-bold text-emerald-400">✓ Fully covered</div>
                          <div className="text-xs text-gray-300">if plan completes</div>
                        </>
                      ) : (
                        <>
                          <div className="text-base font-bold text-blue-300">{formatCurrency(projectedRemaining)}</div>
                          <div className="text-xs text-gray-300">projected remaining · {(projectedCoveredPct * 100).toFixed(0)}% projected</div>
                        </>
                      )}
                    </div>
                    <div className="bg-[var(--bg-secondary)] rounded p-3 text-center col-span-2 sm:col-span-3">
                      <div className="text-xs text-gray-400 uppercase mb-1">Months to Recover (at scenario pace)</div>
                      {monthsToRecover !== null ? (
                        <div className={`text-sm font-bold ${monthsToRecover <= 12 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {monthsToRecover.toFixed(1)} mo
                          {ownerMonthsToRecover !== null && ownerMonthsToRecover > monthsToRecover && (
                            <span className="text-xs text-gray-400 font-normal ml-2">Owner-only: {ownerMonthsToRecover.toFixed(1)} mo</span>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm font-bold text-gray-500">—</div>
                      )}
                    </div>
                  </div>
                </div>

                {annualOH === 0 && (
                  <div className="text-sm text-amber-400 bg-amber-900/15 border border-amber-700/30 rounded p-3 mb-4">
                    ⚠ No overhead expenses in Settings → Overhead Manager. Add business expenses there to populate this tracker.
                  </div>
                )}

                {/* Scenario hours summary */}
                <div className="flex flex-wrap gap-4 mb-4 bg-[var(--bg-secondary)] rounded p-3">
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Scenario Planned Hours/yr</div>
                    <div className="text-sm font-bold text-gray-100">{scenarioPlannedHours.toLocaleString()} hrs</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Total Logged Billable Hours</div>
                    <div className="text-sm font-bold text-emerald-400">{actualLoggedHrs.toFixed(0)} hrs</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-0.5">Scenario Remaining Hours</div>
                    <div className="text-sm font-bold text-blue-300">{scenarioRemainingHours.toFixed(0)} hrs</div>
                  </div>
                  <div className="flex-1 flex items-end justify-end gap-3">
                    <span className="text-xs text-gray-400 flex-1 text-right">Target billable hrs/yr</span>
                    <input
                      type="number" min="100" max="5000"
                      value={billableHoursYear}
                      onChange={e => {
                        if (!backup.settings) (backup as any).settings = {}
                        ;(backup.settings as any).billableHrsYear = num(e.target.value)
                        saveBackupData(backup)
                        forceUpdate({})
                      }}
                      className="w-20 bg-[var(--bg-input)] border border-gray-600 text-gray-100 text-xs px-2 py-1 rounded text-right focus:outline-none focus:border-indigo-500"
                    />
                    <span className="text-xs text-gray-400">hrs/yr</span>
                  </div>
                </div>

                {/* Model + View toggles */}
                <div className="flex flex-wrap gap-3 mb-3">
                  <div className="flex rounded overflow-hidden border border-gray-600 text-sm">
                    <button
                      onClick={() => setRecoveryModel('fixed')}
                      className={`px-3 py-1.5 transition ${recoveryModel === 'fixed' ? 'bg-indigo-600 text-white' : 'bg-[var(--bg-secondary)] text-gray-300 hover:bg-gray-700'}`}
                    >
                      Fixed Recovery
                    </button>
                    <button
                      onClick={() => setRecoveryModel('margin')}
                      className={`px-3 py-1.5 transition ${recoveryModel === 'margin' ? 'bg-indigo-600 text-white' : 'bg-[var(--bg-secondary)] text-gray-300 hover:bg-gray-700'}`}
                    >
                      True Margin
                    </button>
                  </div>
                  <div className="flex rounded overflow-hidden border border-gray-600 text-sm">
                    <button
                      onClick={() => setOverheadViewMode('employee')}
                      className={`px-3 py-1.5 transition ${overheadViewMode === 'employee' ? 'bg-blue-700 text-white' : 'bg-[var(--bg-secondary)] text-gray-300 hover:bg-gray-700'}`}
                    >
                      By Employee
                    </button>
                    <button
                      onClick={() => setOverheadViewMode('project')}
                      className={`px-3 py-1.5 transition ${overheadViewMode === 'project' ? 'bg-blue-700 text-white' : 'bg-[var(--bg-secondary)] text-gray-300 hover:bg-gray-700'}`}
                    >
                      By Project
                    </button>
                  </div>
                </div>

                {/* Model description */}
                <div className="text-xs text-gray-400 mb-4 bg-[var(--bg-secondary)] rounded px-3 py-2">
                  {recoveryModel === 'fixed'
                    ? 'Fixed Recovery: overhead allocation = hours × overhead/hr. Tracks business fixed-cost recovery across all billable time.'
                    : 'True Margin: gross contribution = bill revenue − direct labor cost. True profit = gross contribution − overhead allocation. Negative = margin cannot cover overhead target.'}
                </div>

                {/* By Employee view */}
                {overheadViewMode === 'employee' && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-gray-300 mb-1">
                      Labor Planning — {activeScen?.name || 'Active Scenario'}
                    </div>
                    {empRows.length === 0 && (
                      <div className="text-sm text-gray-400 text-center py-6">No scenario workers. Add employees to a projection scenario above.</div>
                    )}
                    {empRows.map((row: any) => {
                      const ohPctWidth = Math.min(row.ohPct, 100)
                      const planExceeded = row.empLogged > row.plannedYearlyHrs
                      const lowMargin = row.trueProfitPerHr < 0
                      return (
                        <div key={row.emp.id} className="bg-[var(--bg-secondary)] rounded-lg border border-gray-700/60 p-4">
                          {/* Worker header */}
                          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-gray-100">{row.emp.name}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300 uppercase font-medium">{row.type}</span>
                            </div>
                            <div className="text-sm font-bold text-gray-200">
                              {row.plannedYearlyHrs.toLocaleString()} planned hrs/yr
                            </div>
                          </div>

                          {/* Original Plan */}
                          <div className="text-xs text-gray-500 font-semibold uppercase mb-1 tracking-wide">Original Plan</div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                            <div className="text-center bg-[var(--bg-card)] rounded p-2">
                              <div className="text-xs text-gray-400 mb-0.5">Hrs / Day</div>
                              <div className="text-sm font-bold text-gray-100">{row.hrsPerDay.toFixed(1)}</div>
                              <div className="text-xs text-gray-500">@ 5 days/wk</div>
                            </div>
                            <div className="text-center bg-[var(--bg-card)] rounded p-2">
                              <div className="text-xs text-gray-400 mb-0.5">Hrs / Week</div>
                              <div className="text-sm font-bold text-gray-100">{row.hrsPerWeek.toFixed(0)}</div>
                            </div>
                            <div className="text-center bg-[var(--bg-card)] rounded p-2">
                              <div className="text-xs text-gray-400 mb-0.5">Hrs / Month</div>
                              <div className="text-sm font-bold text-gray-100">{row.hrsPerMonth.toFixed(0)}</div>
                            </div>
                            <div className="text-center bg-[var(--bg-card)] rounded p-2">
                              <div className="text-xs text-gray-400 mb-0.5">Weeks / Year</div>
                              <div className="text-sm font-bold text-gray-100">{row.weeksPerYear}</div>
                            </div>
                          </div>

                          {/* Logged vs remaining */}
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div className="bg-[var(--bg-card)] rounded p-2">
                              <div className="text-xs text-gray-400 mb-0.5">Worker Logged Hours</div>
                              <div className="text-base font-bold text-emerald-400">{row.empLogged.toFixed(0)} hrs</div>
                              <div className="text-xs text-gray-400">this worker only</div>
                            </div>
                            <div className="bg-[var(--bg-card)] rounded p-2">
                              <div className="text-xs text-gray-400 mb-0.5">{planExceeded ? 'Plan Exceeded' : 'Remaining in Current Plan'}</div>
                              <div className={`text-base font-bold ${planExceeded ? 'text-amber-400' : 'text-blue-300'}`}>
                                {planExceeded ? `+${(row.empLogged - row.plannedYearlyHrs).toFixed(0)}` : row.remainingHrs.toFixed(0)} hrs
                              </div>
                              <div className="text-xs text-gray-400">{planExceeded ? 'above plan' : 'to hit plan'}</div>
                            </div>
                          </div>

                          {/* Ahead / Behind status */}
                          {(() => {
                            const delta = row.paceDelta
                            const absD = Math.abs(delta).toFixed(0)
                            if (Math.abs(delta) < 1) {
                              return <div className="mb-3 text-xs text-emerald-400 bg-emerald-900/15 border border-emerald-700/30 rounded px-2 py-1">On pace with original plan</div>
                            }
                            if (delta > 0) {
                              return <div className="mb-3 text-xs text-emerald-400 bg-emerald-900/15 border border-emerald-700/30 rounded px-2 py-1">Ahead of plan by {absD} hrs</div>
                            }
                            return <div className="mb-3 text-xs text-amber-400 bg-amber-900/15 border border-amber-700/30 rounded px-2 py-1">Behind plan by {absD} hrs</div>
                          })()}

                          {/* Required remaining pace */}
                          {!planExceeded && row.remainingHrs > 0 && row.daysRemaining > 0 && (
                            <div className="border border-indigo-700/40 rounded-lg p-3 mb-3 bg-indigo-950/20">
                              <div className="text-xs text-indigo-300 font-semibold uppercase mb-2 tracking-wide">
                                Required Remaining Pace
                              </div>
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <div className="text-center bg-[var(--bg-card)] rounded p-2">
                                  <div className="text-xs text-gray-400 mb-0.5">Req. Hrs / Day</div>
                                  <div className="text-sm font-bold text-indigo-300">{row.reqHrsPerDay.toFixed(1)}</div>
                                </div>
                                <div className="text-center bg-[var(--bg-card)] rounded p-2">
                                  <div className="text-xs text-gray-400 mb-0.5">Req. Hrs / Week</div>
                                  <div className="text-sm font-bold text-indigo-300">{row.reqHrsPerWeek.toFixed(1)}</div>
                                </div>
                                <div className="text-center bg-[var(--bg-card)] rounded p-2">
                                  <div className="text-xs text-gray-400 mb-0.5">Req. Hrs / Month</div>
                                  <div className="text-sm font-bold text-indigo-300">{row.reqHrsPerMonth.toFixed(1)}</div>
                                </div>
                                <div className="text-center bg-[var(--bg-card)] rounded p-2">
                                  <div className="text-xs text-gray-400 mb-0.5">Weeks Left</div>
                                  <div className="text-sm font-bold text-indigo-300">{row.weeksRemaining.toFixed(1)}</div>
                                  <div className="text-xs text-gray-500">{row.daysRemaining}d</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Progress bar: logged vs planned */}
                          <div className="mb-3">
                            <div className="flex justify-between text-xs text-gray-400 mb-1">
                              <span>Hours progress</span>
                              <span>{Math.min((row.empLogged / Math.max(row.plannedYearlyHrs, 1)) * 100, 100).toFixed(0)}% of plan logged</span>
                            </div>
                            <div className="h-2 bg-[var(--bg-input)] rounded overflow-hidden">
                              <div
                                className={`h-full rounded ${planExceeded ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min((row.empLogged / Math.max(row.plannedYearlyHrs, 1)) * 100, 100)}%` }}
                              />
                            </div>
                          </div>

                          {/* Rate strip */}
                          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                            <div>
                              <div className="text-xs text-gray-400 mb-0.5">Bill Rate</div>
                              <div className="text-sm font-bold text-blue-300">${row.bill.toFixed(0)}/hr</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-400 mb-0.5">Loaded Cost</div>
                              <div className="text-sm font-bold text-red-400">${row.loaded.toFixed(0)}/hr</div>
                              <div className="text-xs text-gray-500">
                                {row.type === 'w2' ? `base × ${(backup.settings?.payrollMult || 1.20).toFixed(2)}x` : 'base rate'}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-400 mb-0.5">After Labor Cost/hr</div>
                              <div className={`text-sm font-bold ${row.grossContribPerHr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>${row.grossContribPerHr.toFixed(0)}/hr</div>
                            </div>
                          </div>

                          {/* OH + profit per-hr strip */}
                          <div className="grid grid-cols-2 gap-2 mb-3 text-center">
                            <div>
                              <div className="text-xs text-gray-400 mb-0.5">OH Recovery/hr</div>
                              <div className="text-sm font-bold text-yellow-400">${overheadPerHour.toFixed(2)}/hr</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-400 mb-0.5">True Profit/hr after OH</div>
                              <div className={`text-sm font-bold ${row.trueProfitPerHr >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>
                                ${row.trueProfitPerHr.toFixed(0)}/hr
                              </div>
                            </div>
                          </div>

                          {/* Actual (logged) money */}
                          <div className="border-t border-gray-700/50 pt-3 mb-3">
                            <div className="text-xs text-gray-400 font-semibold uppercase mb-2">Actual — This Worker's Logged Hours</div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                              <div>
                                <div className="text-gray-400 mb-0.5">OH Recovered</div>
                                <div className="font-bold text-emerald-400">{formatCurrency(row.actualEmpOH)}</div>
                              </div>
                              <div>
                                <div className="text-gray-400 mb-0.5">Produced After Direct Labor Cost</div>
                                <div className={`font-bold ${row.actualEmpGross >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(row.actualEmpGross)}</div>
                              </div>
                              {recoveryModel === 'margin' && (
                                <div>
                                  <div className="text-gray-400 mb-0.5">True Profit After OH</div>
                                  <div className={`font-bold ${row.actualEmpProfit >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{formatCurrency(row.actualEmpProfit)}</div>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Scenario remaining money */}
                          {row.remainingHrs > 0 && (
                            <div className="border-t border-blue-900/40 pt-3 mb-3">
                              <div className="text-xs text-blue-300 font-semibold uppercase mb-2">Remaining in Current Plan ({row.remainingHrs.toFixed(0)} hrs)</div>
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                                <div>
                                  <div className="text-gray-400 mb-0.5">Overhead Recovery From Remaining Planned Hours</div>
                                  <div className="font-bold text-blue-400">{formatCurrency(row.fcastOH)}</div>
                                </div>
                                <div>
                                  <div className="text-gray-400 mb-0.5">Remaining After Direct Labor Cost</div>
                                  <div className={`font-bold ${row.fcastGross >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(row.fcastGross)}</div>
                                </div>
                                {recoveryModel === 'margin' && (
                                  <div>
                                    <div className="text-gray-400 mb-0.5">True Profit After OH</div>
                                    <div className={`font-bold ${row.fcastProfit >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{formatCurrency(row.fcastProfit)}</div>
                                    {row.fcastGross < row.fcastOH && (
                                      <div className="text-xs text-amber-400 mt-0.5">⚠ Margin below OH</div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* OH contribution bar */}
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-400 w-20">OH share</span>
                            <div className="flex-1 h-2.5 bg-[var(--bg-input)] rounded overflow-hidden">
                              <div className="h-full rounded bg-indigo-500/70" style={{ width: `${ohPctWidth}%` }} />
                            </div>
                            <span className="text-xs text-indigo-300 w-8 text-right">{row.ohPct.toFixed(0)}%</span>
                          </div>

                          {/* Scheduling insight */}
                          {planExceeded && (
                            <div className="mt-2 text-xs text-amber-300 bg-amber-900/15 rounded px-2 py-1">
                              Plan exceeded by {(row.empLogged - row.plannedYearlyHrs).toFixed(0)} hrs — consider updating scenario
                            </div>
                          )}
                          {!planExceeded && row.remainingHrs > 0 && (
                            <div className="mt-2 text-xs text-blue-300">
                              Schedule focus: {row.remainingHrs.toFixed(0)} hrs remaining to hit plan
                            </div>
                          )}
                          {lowMargin && (
                            <div className="mt-1 text-xs text-red-400">
                              ⚠ True profit/hr after OH is negative — price future estimates higher
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {/* Scenario totals footer */}
                    {empRows.length > 0 && overheadPerHour > 0 && (
                      <div className="pt-3 border-t border-gray-700/50 flex flex-col sm:flex-row justify-between gap-2 text-sm">
                        <span className="text-gray-400">
                          Actual: {formatCurrency(actualOverheadRecovered)} + Scenario remaining: {formatCurrency(scenarioRemainingRecovery)} = {formatCurrency(projectedTotal)}
                        </span>
                        <span className={`font-bold ${projectedTotal >= annualOH ? 'text-emerald-400' : 'text-yellow-400'}`}>
                          {projectedTotal >= annualOH
                            ? '✓ Projected fully covered'
                            : `${(projectedCoveredPct * 100).toFixed(0)}% projected`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* By Project view */}
                {overheadViewMode === 'project' && (
                  <div className="space-y-3">
                    <div className="text-sm font-semibold text-gray-300 mb-1">
                      Project Contribution — Actual Logged Hours Only
                    </div>
                    {projRows.length === 0 && (
                      <div className="text-sm text-gray-400 text-center py-6">No logged hours with project assignments found.</div>
                    )}
                    {projRows.map((row: any) => (
                      <div key={row.id} className="bg-[var(--bg-secondary)] rounded-lg border border-gray-700/60 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-bold text-gray-100 truncate max-w-[60%]">{row.name}</span>
                          <span className="text-sm font-bold text-gray-300">{row.hrs.toFixed(1)} hrs logged</span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs mb-3">
                          <div>
                            <div className="text-gray-400 mb-0.5">Bill Revenue</div>
                            <div className="font-bold text-blue-300">{formatCurrency(row.revenue)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 mb-0.5">Direct Labor Cost</div>
                            <div className="font-bold text-red-400">{formatCurrency(row.directCost)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 mb-0.5">After Direct Labor Cost</div>
                            <div className={`font-bold ${row.grossContrib >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatCurrency(row.grossContrib)}</div>
                          </div>
                          <div>
                            <div className="text-gray-400 mb-0.5">OH Allocated</div>
                            <div className="font-bold text-yellow-400">{formatCurrency(row.ohAllocated)}</div>
                          </div>
                          {recoveryModel === 'margin' && (
                            <div>
                              <div className="text-gray-400 mb-0.5">True Profit After OH</div>
                              <div className={`font-bold ${row.trueProfit >= 0 ? 'text-emerald-300' : 'text-red-400'}`}>{formatCurrency(row.trueProfit)}</div>
                              {row.grossContrib < row.ohAllocated && (
                                <div className="text-xs text-amber-400 mt-0.5">⚠ Margin below OH</div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-20">OH share</span>
                          <div className="flex-1 h-2.5 bg-[var(--bg-input)] rounded overflow-hidden">
                            <div className="h-full rounded bg-indigo-500/70" style={{ width: `${Math.min(row.ohPct, 100)}%` }} />
                          </div>
                          <span className="text-xs text-indigo-300 w-8 text-right">{row.ohPct.toFixed(0)}%</span>
                        </div>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400 mt-2">
                      By Project shows actual logged hours only. Scenario remaining hours appear in By Employee view.
                    </p>
                  </div>
                )}

                {/* Owner vs team comparison */}
                {ownerMonthsToRecover !== null && monthsToRecover !== null && ownerMonthsToRecover > monthsToRecover && (
                  <div className="mt-4 bg-emerald-900/15 border border-emerald-700/30 rounded p-3 text-sm">
                    <div className="font-semibold text-emerald-300 mb-1">Team Advantage</div>
                    <p className="text-gray-300">
                      Owner-only would recover overhead in{' '}
                      <span className="text-yellow-400 font-semibold">{ownerMonthsToRecover.toFixed(1)} months</span>.{' '}
                      With the full team scenario ({activeScen?.name}), overhead is recovered in{' '}
                      <span className="text-emerald-400 font-semibold">{monthsToRecover.toFixed(1)} months</span>{' '}
                      — <span className="text-emerald-400 font-semibold">{(ownerMonthsToRecover - monthsToRecover).toFixed(1)} months faster</span>.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        )
      })()}

      {/* EMPLOYEE CARDS */}
      {liveEmployees.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] rounded-lg border border-gray-700">
          <p className="text-gray-400 text-lg">No employees yet</p>
          <p className="text-gray-600 text-sm mt-2">Add team members to get started</p>
        </div>
      ) : (
        <div>
          <h2 className="text-2xl font-bold text-gray-100 mb-4">Employee Cards</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {liveEmployees.map((rawEmp) => {
              const emp = normalizeEmployee(rawEmp) as EnhancedEmployee
              const stats = employeeStats.get(emp.id)
              if (!stats) return null
              return (
                <div
                  key={emp.id}
                  onClick={() => setSelectedEmployee(emp)}
                  className="cursor-pointer"
                >
                  <EmployeeCard
                    employee={emp}
                    totalHours={stats.totalHours}
                    monthlyHours={stats.monthlyHours}
                    jobCount={stats.jobCount}
                    onToggleMultiplier={toggleMultiplier}
                    backup={backup}
                  />
                  <div className="mt-2 flex gap-2 justify-end">
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingEmployee(normalizeEmployee(rawEmp) as any) }}
                      className="text-xs px-2 py-1 bg-blue-600/30 text-blue-300 rounded hover:bg-blue-600/40 flex items-center gap-1"
                    >
                      <Edit2 className="w-3 h-3" /> Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteEmployee(emp.id) }}
                      className="text-xs px-2 py-1 bg-red-600/30 text-red-300 rounded hover:bg-red-600/40 flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* TEAM TOTALS SUMMARY */}
          {liveEmployees.length > 0 && (
            <div className="mt-6 bg-gradient-to-r from-blue-900/20 to-cyan-900/20 rounded-lg border border-blue-600/30 p-4">
              <h3 className="text-sm font-bold text-gray-200 mb-4">Team Cost Summary</h3>
              {(() => {
                const teamTotals = (liveEmployees || []).reduce((acc: any, rawEmp: any) => {
                  const emp = normalizeEmployee(rawEmp)
                  const c = calcEmployeeCost(emp, backup)
                  acc.monthly += c.loadedMonthlyCost
                  acc.sixMonth += c.sixMonthCost
                  acc.revenue += c.targetRevenue
                  return acc
                }, { monthly: 0, sixMonth: 0, revenue: 0 })
                return (
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <div className="text-gray-400 mb-1">Total Monthly (Loaded)</div>
                      <div className="text-lg font-bold text-white">{formatCurrency(teamTotals.monthly)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 mb-1">6-Month Cost</div>
                      <div className="text-lg font-bold text-yellow-400">{formatCurrency(teamTotals.sixMonth)}</div>
                    </div>
                    <div>
                      <div className="text-gray-400 mb-1">Revenue to Cover (monthly)</div>
                      <div className="text-lg font-bold text-cyan-400">{formatCurrency(teamTotals.revenue)}</div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
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
                    <tr key={log.id} className="hover:bg-[var(--bg-card)] transition">
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

      {/* LABOR COST VS REVENUE — 12 WEEK TREND */}
      <div className="mt-10">
        <h2 className="text-2xl font-bold text-gray-100 mb-4">Labor Cost vs Revenue — 12 Week Trend</h2>
        <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-4">
          <div style={{ height: '350px' }}>
            <ChartErrorBoundary>
              <LaborCostVsRevenueChart backup={backup} />
            </ChartErrorBoundary>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="bg-[var(--bg-card)] rounded p-2 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Labor Cost</p>
              <div className="w-3 h-0.5 bg-red-500 mx-auto mt-1 mb-1 rounded" />
              <p className="text-xs text-gray-300">Accumulative</p>
            </div>
            <div className="bg-[var(--bg-card)] rounded p-2 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Revenue</p>
              <div className="w-3 h-0.5 bg-emerald-500 mx-auto mt-1 mb-1 rounded" />
              <p className="text-xs text-gray-300">Accumulative</p>
            </div>
            <div className="bg-[var(--bg-card)] rounded p-2 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Labor %</p>
              <div className="w-3 h-0.5 bg-yellow-500 mx-auto mt-1 mb-1 rounded border-dashed" />
              <p className="text-xs text-gray-300">of Revenue</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── PER-PROJECT LABOR FLOW ─────────────────────────────────────────────
          Shows per-project employees with their linked project and computed
          labor cost. Serves as the "labor breakdown" view for project budgets.
      */}
      {(() => {
        const perProjectEmps = getLiveEmployees(backup.employees || [])
          .map(normalizeEmployee)
          .filter((e: any) => e.employee_type === 'per_project' && e.status !== 'Closed')
        if (perProjectEmps.length === 0) return null
        const payrollMult = backup.settings?.payrollMult || 1.20
        return (
          <div className="bg-[var(--bg-card)] rounded-lg border border-amber-700/40 p-6 mt-6">
            <h2 className="text-lg font-bold text-amber-300 mb-1">Per-Project Labor Flow</h2>
            <p className="text-xs text-gray-500 mb-4">
              Per-project employee hours × cost rate → flows into linked project labor cost (1099 uses base rate, W-2 uses loaded rate)
            </p>
            <div className="space-y-3">
              {perProjectEmps.map((emp: any) => {
                const project = projects.find((p: any) => p.id === emp.project_id)
                const empLogs = (backup.logs || []).filter((l: any) => l.empId === emp.id)
                const totalHrs = empLogs.reduce((s: number, l: any) => s + (l.hrs || 0), 0)
                // 1099 contractors: base rate only (no payroll multiplier)
                const empIsContractor = emp.applyMultiplier === false ||
                                        emp.classification === '1099'
                const empRate = empIsContractor
                  ? (emp.hourly_rate || emp.costRate || 0)
                  : (emp.hourly_rate || emp.costRate || 0) * payrollMult
                const laborCost = totalHrs * empRate
                return (
                  <div key={emp.id} className="flex items-center justify-between bg-amber-900/10 border border-amber-700/30 rounded-lg px-4 py-3 gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-amber-200 truncate">{emp.name}</div>
                      <div className="text-xs text-amber-400/70">{emp.role} · {emp.classification}</div>
                    </div>
                    <div className="text-xs text-gray-500 text-right whitespace-nowrap">
                      {project
                        ? <span className="text-amber-300 font-medium">{(project as any).name}</span>
                        : <span className="text-gray-600">No project assigned</span>
                      }
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <div className="text-sm font-bold text-amber-300">
                        ${laborCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-xs text-gray-500">{totalHrs.toFixed(1)} hrs logged</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-600 mt-3">
              Labor cost = hours logged × rate (1099: base rate, W-2: base × {payrollMult}x). Flows into project labor breakdown and Quote vs Actual chart.
            </p>
          </div>
        )
      })()}

      {/* ── DEMO INVITE MODAL (owner only) ─────────────────────────────────── */}
      {showDemoInviteModal && isOwner && user?.id && (
        <DemoInvite
          onClose={() => setShowDemoInviteModal(false)}
          inviterUserId={user.id}
        />
      )}

      {/* ── EMPLOYEE INVITE MODAL (admin only) ─────────────────────────────── */}
      {showEmployeeInviteModal && isAdmin && (
        <EmployeeInviteModal
          onClose={() => setShowEmployeeInviteModal(false)}
        />
      )}

      {/* ── TEAM COST SETTINGS MODAL ──────────────────────────────────────── */}
      {showCostSettingsModal && (
        <TeamCostSettingsModal
          backup={backup}
          onClose={() => setShowCostSettingsModal(false)}
        />
      )}

      {/* ── EMPLOYEE DETAIL MODAL ─────────────────────────────────────────── */}
      {selectedEmployee && (() => {
        const stats = employeeStats.get(selectedEmployee.id)
        return (
          <EmployeeDetailModal
            employee={selectedEmployee}
            backup={backup}
            totalHours={stats?.totalHours || 0}
            jobCount={stats?.jobCount || 0}
            activeScenarioId={activeScenarioId}
            onClose={() => setSelectedEmployee(null)}
          />
        )
      })()}

      {/* ── ADD TEAM MEMBER MODAL ──────────────────────────────────────────── */}
      {showAddModal && (
        <AddTeamMemberModal
          projects={projects}
          onSave={handleAddTeamMember}
          onCancel={() => setShowAddModal(false)}
          payrollMult={backup.settings?.payrollMult || 1.20}
        />
      )}

      {/* ── EDIT EMPLOYEE MODAL ───────────────────────────────────────────── */}
      {editingEmployee && (
        <EmployeeEditModal
          employee={editingEmployee}
          payrollMult={backup.settings?.payrollMult || 1.20}
          onSave={handleEditSave}
          onCancel={() => setEditingEmployee(null)}
        />
      )}

      {/* ── OHM COMPLIANCE CARD (non-blocking, shown after save) ──────────── */}
      {ohmCard.show && (
        <OhmComplianceCard
          employeeType={ohmCard.employeeType as any}
          employeeName={ohmCard.name}
          classification={ohmCard.classification as any}
          onDismiss={() => setOhmCard((prev: any) => ({ ...prev, show: false }))}
          onAcknowledge={() => markComplianceAcknowledged(ohmCard.empId)}
        />
      )}
    </div>
  )
}
