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
import { Users, Sparkles, AlertCircle, Plus, Trash2, Edit2, TrendingUp, Zap } from 'lucide-react'
import AddTeamMemberModal from './AddTeamMemberModal'
import OhmComplianceCard from './OhmComplianceCard'
import { normalizeEmployee } from './employeeTypes'
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
    const cost = mLogs.reduce((s, l) => { const emp = employees.find(e => e.id === l.employeeId); return s + (parseFloat(l.hrs || 0) * (emp?.costRate || 35)) }, 0)
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
    const cost = wLogs.reduce((s, l) => { const emp = employees.find(e => e.id === l.employeeId); return s + (parseFloat(l.hrs || 0) * (emp?.costRate || 35)) }, 0)
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
    const empCost = mLogs.reduce((s, l) => { const emp = employees.find(e => e.id === l.employeeId); return s + (parseFloat(l.hrs || 0) * (emp?.costRate || 35)) }, 0)
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
  const hourlyRate = num(emp.costRate || emp.rate || 0)
  const hrsPerWeek = num(emp.hoursPerWeek || 40)
  // Formula: base = hourlyRate × hoursPerWeek × 4.33 × 1.208 (employer burden)
  const baseMonthlyCost = hourlyRate * hrsPerWeek * 4.33
  const payrollTax = baseMonthlyCost * 0.153  // FICA + FUTA
  const workersComp = baseMonthlyCost * 0.04  // CA Workers Comp ~4%
  const glInsurance = baseMonthlyCost * 0.015 // GL Insurance ~1.5%
  const taxesAndInsurance = payrollTax + workersComp + glInsurance  // = base × 0.208
  const loadedMonthlyCost = baseMonthlyCost + taxesAndInsurance     // = base × 1.208
  const sixMonthCost = loadedMonthlyCost * 6
  const targetMargin = num(backup?.settings?.markup || 35) / 100
  const targetRevenue = targetMargin > 0 ? loadedMonthlyCost / targetMargin : 0
  return { baseMonthlyCost, taxesAndInsurance, loadedMonthlyCost, sixMonthCost, targetRevenue, hourlyRate, hrsPerWeek }
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
  backup,
}: {
  employee: EnhancedEmployee
  totalHours: number
  jobCount: number
  monthlyHours: number
  onToggleMultiplier: (empId: string) => void
  backup?: any
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

  const cost = backup ? calcEmployeeCost(employee, backup) : null

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

      {cost && (
        <div className="mt-4 pt-4 border-t border-gray-700 space-y-1 text-xs">
          {/* Breakdown: Base | Taxes/Insurance | Total */}
          <div className="bg-[var(--bg-secondary)] rounded p-2 mb-2">
            <div className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Monthly Cost Breakdown</div>
            <div className="text-gray-300 text-[11px]">
              Base: <span className="text-blue-400 font-semibold">{formatCurrency(cost.baseMonthlyCost)}</span>
              {' | '}Taxes/Insurance: <span className="text-orange-400 font-semibold">{formatCurrency(cost.taxesAndInsurance)}</span>
              {' | '}Total: <span className="text-white font-bold">{formatCurrency(cost.loadedMonthlyCost)}/mo</span>
            </div>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">6-Month Cost</span>
            <span className="text-yellow-400">{formatCurrency(cost.sixMonthCost)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Revenue needed to cover</span>
            <span className="text-cyan-400 font-medium">{formatCurrency(cost.targetRevenue)}/mo</span>
          </div>
        </div>
      )}

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
      // Permanent and per_project are saved to backup
      backup.employees = [...backup.employees, record]
      saveBackupData(backup)
      forceUpdate({})

      // Fire OHM compliance card (non-blocking — save already happened)
      setOhmCard({
        show: true,
        employeeType: record.employee_type,
        classification: record.classification || (record.employee_type === 'permanent' ? 'W-2' : '1099'),
        name: record.name || record.role || 'New Employee',
        empId: record.id,
      })
    }

    setShowAddModal(false)
  }

  const markComplianceAcknowledged = (empId: string) => {
    const emp = backup.employees?.find((e: any) => e.id === empId)
    if (emp) {
      emp.compliance_acknowledged = true
      saveBackupData(backup)
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

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)] p-3 md:p-5 space-y-6 overflow-x-hidden">
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
          {employees.filter(e => !e.isOwner).length > 0 || hypotheticals.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 w-full">
              {/* Real employees (non-owner) — style by employee_type */}
              {employees
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
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-xs px-2 py-0.5 bg-[#0f1117] border border-purple-600/50 text-purple-400 rounded font-bold tracking-widest">
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

      {/* EMPLOYEE COST STRUCTURE BOX */}
      <EmployeeCostStructure backup={backup} />

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
                    backup={backup}
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

          {/* TEAM TOTALS SUMMARY */}
          {employees.length > 0 && (
            <div className="mt-6 bg-gradient-to-r from-blue-900/20 to-cyan-900/20 rounded-lg border border-blue-600/30 p-4">
              <h3 className="text-sm font-bold text-gray-200 mb-4">Team Cost Summary</h3>
              {(() => {
                const teamTotals = (backup.employees || []).reduce((acc: any, emp: any) => {
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
            <div className="bg-[#1e2130] rounded p-2 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Labor Cost</p>
              <div className="w-3 h-0.5 bg-red-500 mx-auto mt-1 mb-1 rounded" />
              <p className="text-xs text-gray-300">Accumulative</p>
            </div>
            <div className="bg-[#1e2130] rounded p-2 text-center">
              <p className="text-[10px] text-gray-400 uppercase">Revenue</p>
              <div className="w-3 h-0.5 bg-emerald-500 mx-auto mt-1 mb-1 rounded" />
              <p className="text-xs text-gray-300">Accumulative</p>
            </div>
            <div className="bg-[#1e2130] rounded p-2 text-center">
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
        const perProjectEmps = (backup.employees || [])
          .map(normalizeEmployee)
          .filter((e: any) => e.employee_type === 'per_project' && e.status !== 'Closed')
        if (perProjectEmps.length === 0) return null
        const payrollMult = backup.settings?.payrollMult || 1.20
        return (
          <div className="bg-[var(--bg-card)] rounded-lg border border-amber-700/40 p-6 mt-6">
            <h2 className="text-lg font-bold text-amber-300 mb-1">Per-Project Labor Flow</h2>
            <p className="text-xs text-gray-500 mb-4">
              Per-project employee hours × hourly rate × {payrollMult}x payroll multiplier → flows into linked project labor cost
            </p>
            <div className="space-y-3">
              {perProjectEmps.map((emp: any) => {
                const project = projects.find((p: any) => p.id === emp.project_id)
                const empLogs = (backup.logs || []).filter((l: any) => l.empId === emp.id)
                const totalHrs = empLogs.reduce((s: number, l: any) => s + (l.hrs || 0), 0)
                const laborCost = totalHrs * (emp.hourly_rate || emp.costRate || 0) * payrollMult
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
              Labor cost = hours logged × rate × {payrollMult}x. Flows into project labor breakdown and Quote vs Actual chart.
            </p>
          </div>
        )
      })()}

      {/* ── ADD TEAM MEMBER MODAL ──────────────────────────────────────────── */}
      {showAddModal && (
        <AddTeamMemberModal
          projects={projects}
          onSave={handleAddTeamMember}
          onCancel={() => setShowAddModal(false)}
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
