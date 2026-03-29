// @ts-nocheck
/**
 * V15rFieldLogPanel — Field Log with 3 tabs:
 *   1. Project Log (GREEN) — cumulative running totals, daily target indicator, daily hours bar chart
 *   2. Service Log (ORANGE) — live profit preview, adjustments ledger, collections queue
 *   3. Triggers (BLUE) — trigger rules with stats, live trigger evaluation
 *
 * Faithfully ported from HTML renderLogs(), renderServiceLogs(), renderTriggerAnalysis().
 * STEP 1: Read HTML source for full implementation ✓
 * STEP 2: Read current file and data service ✓
 * STEP 3: Rewrite with exact features
 */

import { useState, useCallback, useMemo, lazy, Suspense } from 'react'
import { Plus, Edit3, Trash2, Zap, Filter, Sparkles, TrendingUp, AlertCircle, FileText } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  num,
  fmt,
  fmtK,
  pct,
  daysSince,
  buildProjectLogRollup,
  getKPIs,
  projectLogsFor,
  getProjectFinancials,
  type BackupData,
  type BackupLog,
  type BackupServiceLog,
  type BackupProject,
  type BackupTriggerRule,
} from '@/services/backupDataService'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'
import QuickBooksImportModal from './QuickBooksImportModal'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'

// ── Constants ────────────────────────────────────────────────────────────────

const PHASES = ['Rough-in', 'Trim', 'Demo', 'Underground', 'Finish', 'Material Run', 'Planning', 'Inspection']
const JOB_TYPES = ['GFCI / Receptacles', 'Panel / Service', 'Troubleshoot', 'Lighting', 'EV Charger', 'Low Voltage', 'Circuit Add/Replace', 'Switches / Dimmers', 'Warranty', 'Other']

function today() {
  return new Date().toISOString().slice(0, 10)
}

// ── Service balance & rollup ─────────────────────────────────────────────────

function getServiceRollup(l: any): any {
  const adjustments = (Array.isArray(l.adjustments) ? l.adjustments : [])
  const addIncome = adjustments.filter((a: any) => a && a.type === 'income').reduce((s: number, a: any) => s + num(a.amount), 0)
  const addExpense = adjustments.filter((a: any) => a && a.type === 'expense' && (a.category || 'expense') !== 'mileage').reduce((s: number, a: any) => s + num(a.amount), 0)
  const addMileage = adjustments.filter((a: any) => a && ((a.type === 'mileage') || (a.type === 'expense' && (a.category || '') === 'mileage'))).reduce((s: number, a: any) => s + num(a.amount), 0)
  const totalAddedCost = addExpense + addMileage
  const baseQuoted = num(l?.quoted)
  const totalBillable = baseQuoted + addIncome
  const baseActual = num(l?.mat) + (num(l?.mileCost) || 0) + (num(l?.opCost) || 0)
  const totalActual = baseActual + totalAddedCost
  const collected = num(l?.collected)
  const remaining = Math.max(0, totalBillable - collected)
  const projectedProfit = totalBillable - totalActual
  return {
    baseQuoted, addIncome, addExpense, addMileage, totalAddedCost, totalBillable,
    baseActual, totalActual, collected, remaining, projectedProfit, adjustments
  }
}

function serviceBalanceDue(l: any): number {
  const roll = getServiceRollup(l)
  const explicit = Math.max(0, num(l?.balanceDue) || num(l?.remainingDue) || num(l?.remainingBalance) || num(l?.balance) || 0)
  if (explicit > 0.009 && explicit > roll.remaining + 0.009) return explicit
  if (roll.remaining > 0.009) return roll.remaining
  if ((l?.payStatus || 'N') === 'N' && roll.totalBillable > 0) return roll.totalBillable
  return 0
}

function getServicePaymentMeta(l: any): any {
  const roll = getServiceRollup(l)
  const remaining = serviceBalanceDue(l)
  const fullyPaid = remaining <= 0.009 && roll.totalBillable > 0
  const partialPaid = !fullyPaid && roll.collected > 0.009
  return {
    quoted: roll.totalBillable,
    baseQuoted: roll.baseQuoted,
    addIncome: roll.addIncome,
    addExpense: roll.addExpense,
    addMileage: roll.addMileage,
    totalAddedCost: roll.totalAddedCost,
    actualCost: roll.totalActual,
    projectedProfit: roll.projectedProfit,
    collected: roll.collected,
    remaining,
    status: fullyPaid ? 'Y' : (partialPaid ? 'P' : 'N'),
    balanceLabel: fullyPaid ? 'Paid in full' : (partialPaid ? 'Partial balance left' : 'Full balance left'),
  }
}

function getFiredTriggerNames(backup: BackupData, data: any): string[] {
  const target = num((backup.settings && backup.settings.dayTarget) || 361)
  const names: string[] = []
  for (const r of (backup.triggerRules || [])) {
    if (!r.active) continue
    let hit = false
    if (r.type === 'bad_day' && num(data.profit) < target * num(r.threshold)) hit = true
    if (r.type === 'good_day' && num(data.profit) >= target * num(r.threshold)) hit = true
    if (r.type === 'travel' && num(data.quoted) > 0 && num(data.mileCost) > num(data.quoted) * num(r.threshold)) hit = true
    if (r.type === 'material' && num(data.quoted) > 0 && num(data.mat) > num(data.quoted) * num(r.threshold)) hit = true
    if (hit) names.push(r.name)
  }
  return names
}

// ── Daily hours chart (last 7 days) ──────────────────────────────────────────

function getDailyHoursChart(logs: BackupLog[]): Record<string, number> {
  const chart: Record<string, number> = {}
  const today_str = today()
  for (let i = 0; i < 7; i++) {
    const d = new Date(today_str)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    chart[key] = 0
  }
  logs.forEach(l => {
    if (chart.hasOwnProperty(l.date || '')) {
      chart[l.date] += num(l.hrs)
    }
  })
  return chart
}

// ── Gap detection helper ─────────────────────────────────────────────────────

function interleaveWithGaps(entries: any[], dateField: string = 'date'): Array<{type: 'entry', data: any} | {type: 'gap', label: string, startDate: string, endDate: string, count: number}> {
  if (!entries.length) return []

  // Build set of dates with entries
  const datesWithEntries = new Set(entries.map(e => e[dateField]).filter(Boolean))

  // Find date range (earliest entry to today)
  const dates = entries.map(e => e[dateField]).filter(Boolean).sort()
  const startDate = dates[0]
  const endDate = today()

  // Generate all missing weekdays
  const missingDays: string[] = []
  const current = new Date(startDate)
  const end = new Date(endDate)

  while (current <= end) {
    const dayOfWeek = current.getDay()
    const dateStr = current.toISOString().slice(0, 10)
    // Mon-Fri only (1-5)
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && !datesWithEntries.has(dateStr)) {
      missingDays.push(dateStr)
    }
    current.setDate(current.getDate() + 1)
  }

  // Group consecutive missing days
  const gaps: Array<{type: 'gap', label: string, startDate: string, endDate: string, count: number}> = []
  let i = 0
  while (i < missingDays.length) {
    const startIdx = i
    const startGapDate = missingDays[i]

    // Find consecutive sequence
    while (i + 1 < missingDays.length) {
      const curr = new Date(missingDays[i])
      const next = new Date(missingDays[i + 1])
      const daysDiff = Math.floor((next.getTime() - curr.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff === 1) {
        i++
      } else {
        break
      }
    }

    const endGapDate = missingDays[i]
    const count = i - startIdx + 1

    if (count >= 3) {
      // Collapse 3+ consecutive days
      const [y, m, d] = startGapDate.split('-')
      const [y2, m2, d2] = endGapDate.split('-')
      const label = `📅 No entries — ${m}/${d} to ${m2}/${d2} (${count} weekdays)`
      gaps.push({type: 'gap', label, startDate: startGapDate, endDate: endGapDate, count})
    } else {
      // Single days
      for (let j = startIdx; j <= i; j++) {
        const dateStr = missingDays[j]
        const [y, m, d] = dateStr.split('-')
        const dateObj = new Date(dateStr)
        const dayName = dateObj.toLocaleDateString('en-US', {weekday: 'short'})
        const label = `📅 No entry — ${dayName}, ${m}/${d}`
        gaps.push({type: 'gap', label, startDate: dateStr, endDate: dateStr, count: 1})
      }
    }
    i++
  }

  // Merge entries and gaps in chronological order
  const result: any[] = []
  const allItems = [
    ...entries.map(e => ({type: 'entry', data: e, sortDate: e[dateField]})),
    ...gaps.map(g => ({type: 'gap', ...g, sortDate: g.startDate}))
  ].sort((a, b) => String(b.sortDate).localeCompare(String(a.sortDate))) // desc order

  return allItems
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function V15rFieldLogPanel() {
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [activeTab, setActiveTab] = useState<'proj' | 'svc' | 'triggers'>('proj')
  const [projFilter, setProjFilter] = useState('all')
  const [svcFilter, setSvcFilter] = useState('all')
  const [showGaps, setShowGaps] = useState(true)
  const [showProjForm, setShowProjForm] = useState(false)
  const [showSvcForm, setShowSvcForm] = useState(false)
  const [editLogId, setEditLogId] = useState<string | null>(null)
  const [editSvcId, setEditSvcId] = useState<string | null>(null)
  const [showQBImport, setShowQBImport] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  // Trigger bucket selector state
  const [triggerBucket, setTriggerBucket] = useState<'all' | 'projects' | 'service'>('all')
  const [triggerJobId, setTriggerJobId] = useState<string>('all')
  const [triggerAiResponse, setTriggerAiResponse] = useState<string>('')
  const [triggerAiLoading, setTriggerAiLoading] = useState(false)

  // Project log form state
  const [flProj, setFlProj] = useState('')
  const [flPhase, setFlPhase] = useState(PHASES[0])
  const [flDate, setFlDate] = useState(today())
  const [flEmp, setFlEmp] = useState('')
  const [flHrs, setFlHrs] = useState('')
  const [flMiles, setFlMiles] = useState('')
  const [flMat, setFlMat] = useState('')
  const [flCollected, setFlCollected] = useState('')
  const [flStore, setFlStore] = useState('')
  const [flEmatInfo, setFlEmatInfo] = useState('')
  const [flDetailLink, setFlDetailLink] = useState('')
  const [flNotes, setFlNotes] = useState('')

  // Service log form state
  const [slCust, setSlCust] = useState('')
  const [slAddr, setSlAddr] = useState('')
  const [slDate, setSlDate] = useState(today())
  const [slHrs, setSlHrs] = useState('')
  const [slMi, setSlMi] = useState('')
  const [slQuoted, setSlQuoted] = useState('')
  const [slMat, setSlMat] = useState('')
  const [slCollected, setSlCollected] = useState('')
  const [slStore, setSlStore] = useState('')
  const [slJtype, setSlJtype] = useState(JOB_TYPES[0])
  const [slPayStatus, setSlPayStatus] = useState('Y')
  const [slEmatInfo, setSlEmatInfo] = useState('')
  const [slDetailLink, setSlDetailLink] = useState('')
  const [slNotes, setSlNotes] = useState('')

  // Service Estimate workflow state (Step 1-3)
  const [showEstimateForm, setShowEstimateForm] = useState(false)
  const [editEstimateId, setEditEstimateId] = useState<string | null>(null)
  const [estCust, setEstCust] = useState('')
  const [estAddr, setEstAddr] = useState('')
  const [estDate, setEstDate] = useState(today())
  const [estJobType, setEstJobType] = useState(JOB_TYPES[0])
  const [estHours, setEstHours] = useState('')
  const [estBillRate, setEstBillRate] = useState('')
  const [estMaterials, setEstMaterials] = useState('')
  const [estMiles, setEstMiles] = useState('')
  const [estNotes, setEstNotes] = useState('')
  const [completingEstimateId, setCompletingEstimateId] = useState<string | null>(null)
  const [actualHours, setActualHours] = useState('')
  const [actualMaterials, setActualMaterials] = useState('')
  const [actualMiles, setActualMiles] = useState('')
  const [paymentCollected, setPaymentCollected] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('Unpaid')
  const [completionVariance, setCompletionVariance] = useState<any>(null)

  const backup = getBackupData()
  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-64 bg-[var(--bg-secondary)]">
        <div className="text-gray-500 text-sm">No backup data. Import to view field logs.</div>
      </div>
    )
  }

  const projects = backup.projects || []
  const logs = backup.logs || []
  const serviceLogs = backup.serviceLogs || []
  const employees = backup.employees || []
  const triggerRules = backup.triggerRules || []
  const settings = backup.settings || {} as any
  const mileRate = num(settings.mileRate || 0.66)
  const opCost = num(settings.opCost || 42.45)
  const dayTarget = num(settings.dayTarget || 361)

  function persist() {
    backup._lastSavedAt = new Date().toISOString()
    saveBackupData(backup)
    // Dispatch event to trigger KPI refresh in Layout
    window.dispatchEvent(new Event('storage'))
    forceUpdate()
  }

  // ── Service Estimate CRUD (3-step workflow) ──────────────────────────────────

  const serviceEstimates = backup.serviceEstimates || []
  const activeServiceCalls = backup.activeServiceCalls || []
  const billRate = num(settings.billRate || 75)
  const taxRate = num(settings.tax || 0)

  function resetEstimateForm() {
    setEstCust('')
    setEstAddr('')
    setEstDate(today())
    setEstJobType(JOB_TYPES[0])
    setEstHours('')
    setEstBillRate(String(billRate))
    setEstMaterials('')
    setEstMiles('')
    setEstNotes('')
    setEditEstimateId(null)
    setShowEstimateForm(false)
  }

  function saveServiceEstimate() {
    const estHrs = parseFloat(estHours) || 0
    const estMat = parseFloat(estMaterials) || 0
    const estMi = parseFloat(estMiles) || 0
    const estRate = parseFloat(estBillRate) || billRate

    const labor = estHrs * estRate
    const mileageCost = estMi * mileRate
    const subtotal = labor + estMat + mileageCost
    const taxAmount = subtotal * (taxRate / 100)
    const totalQuote = subtotal + taxAmount
    const marginPct = totalQuote > 0 ? ((taxAmount) / totalQuote * 100) : 0

    pushState(backup)
    const estimate = {
      id: editEstimateId || ('est' + Date.now()),
      customer: estCust || 'Unknown',
      address: estAddr,
      date: estDate || today(),
      jobType: estJobType,
      estHours: estHrs,
      billRate: estRate,
      estMaterials: estMat,
      milesRT: estMi,
      notes: estNotes,
      totalQuote,
      status: 'open',
      createdAt: new Date().toISOString(),
    }

    if (editEstimateId) {
      const idx = serviceEstimates.findIndex(e => e.id === editEstimateId)
      if (idx >= 0) backup.serviceEstimates[idx] = estimate
    } else {
      if (!Array.isArray(backup.serviceEstimates)) backup.serviceEstimates = []
      backup.serviceEstimates = [...serviceEstimates, estimate]
    }
    persist()
    resetEstimateForm()
  }

  function beginEstimateEdit(estimateId: string) {
    const est = serviceEstimates.find(e => e.id === estimateId)
    if (!est) return
    setEditEstimateId(est.id)
    setEstCust(est.customer || '')
    setEstAddr(est.address || '')
    setEstDate(est.date || today())
    setEstJobType(est.jobType || JOB_TYPES[0])
    setEstHours(String(est.estHours || 0))
    setEstBillRate(String(est.billRate || billRate))
    setEstMaterials(String(est.estMaterials || 0))
    setEstMiles(String(est.milesRT || 0))
    setEstNotes(est.notes || '')
    setShowEstimateForm(true)
  }

  function deleteEstimate(estimateId: string) {
    if (!confirm('Delete this estimate?')) return
    pushState(backup)
    backup.serviceEstimates = serviceEstimates.filter(e => e.id !== estimateId)
    persist()
  }

  function confirmEstimateToActiveCall(estimateId: string) {
    const est = serviceEstimates.find(e => e.id === estimateId)
    if (!est) return
    pushState(backup)
    est.status = 'active'
    if (!Array.isArray(backup.activeServiceCalls)) backup.activeServiceCalls = []
    backup.activeServiceCalls = [...activeServiceCalls, { ...est, status: 'active' }]
    persist()
  }

  function startCompleteEstimate(estimateId: string) {
    const est = serviceEstimates.find(e => e.id === estimateId)
    if (!est) return
    setCompletingEstimateId(estimateId)
    setActualHours(String(est.estHours || 0))
    setActualMaterials(String(est.estMaterials || 0))
    setActualMiles(String(est.milesRT || 0))
    setPaymentCollected('')
    setPaymentStatus('Unpaid')
    setCompletionVariance(null)
  }

  function completeAndLogService() {
    const est = serviceEstimates.find(e => e.id === completingEstimateId)
    if (!est) return

    const actHrs = parseFloat(actualHours) || 0
    const actMat = parseFloat(actualMaterials) || 0
    const actMi = parseFloat(actualMiles) || 0
    const collected = parseFloat(paymentCollected) || 0

    const mileageCost = actMi * mileRate
    const labCost = actHrs * opCost

    pushState(backup)

    // Create service log entry
    const logEntry: BackupServiceLog = {
      id: 'svc' + Date.now(),
      date: today(),
      customer: est.customer,
      address: est.address,
      jtype: est.jobType,
      hrs: actHrs,
      miles: actMi,
      quoted: est.totalQuote,
      mat: actMat,
      collected,
      payStatus: collected >= est.totalQuote ? 'Y' : (collected > 0 ? 'P' : 'N'),
      balanceDue: Math.max(0, est.totalQuote - collected),
      store: '',
      notes: est.notes,
      mileCost: mileageCost,
      opCost: labCost,
      profit: collected - actMat - mileageCost - labCost,
    } as any

    backup.serviceLogs = [...serviceLogs, logEntry]
    est.status = 'completed'

    // Calculate variance
    const estMat = est.estMaterials || 0
    const estMi = est.milesRT || 0
    const estHrs = est.estHours || 0

    const matVariancePct = estMat > 0 ? ((actMat - estMat) / estMat * 100) : 0
    const hrsVariancePct = estHrs > 0 ? ((actHrs - estHrs) / estHrs * 100) : 0

    setCompletionVariance({
      estHours: estHrs,
      actualHours: actHrs,
      hrsVariance: actHrs - estHrs,
      hrsVariancePct,
      estMat,
      actualMat: actMat,
      matVariance: actMat - estMat,
      matVariancePct,
      estMiles: estMi,
      actualMiles: actMi,
      milesVariance: actMi - estMi,
      quoted: est.totalQuote,
      actualCost: actMat + mileageCost + labCost,
    })

    persist()
    setCompletingEstimateId(null)
  }

  // ── Project log CRUD ───────────────────────────────────────────────────

  function resetProjForm() {
    setFlProj(''); setFlPhase(PHASES[0]); setFlDate(today()); setFlEmp('')
    setFlHrs(''); setFlMiles(''); setFlMat(''); setFlCollected('')
    setFlStore(''); setFlEmatInfo(''); setFlDetailLink(''); setFlNotes('')
    setEditLogId(null); setShowProjForm(false)
  }

  function saveProjEntry() {
    const proj = projects.find(p => p.id === flProj)
    pushState(backup)
    const entry: BackupLog = {
      id: editLogId || ('log' + Date.now()),
      projId: flProj,
      projName: proj ? proj.name : 'Unknown',
      phase: flPhase,
      date: flDate || today(),
      emp: employees.find(e => e.id === flEmp)?.name || 'Me',
      empId: flEmp,
      hrs: parseFloat(flHrs) || 0,
      miles: parseInt(flMiles) || 0,
      mat: parseFloat(flMat) || 0,
      collected: parseFloat(flCollected) || 0,
      store: flStore,
      emergencyMatInfo: flEmatInfo,
      detailLink: flDetailLink,
      notes: flNotes,
    }
    if (editLogId) {
      const idx = logs.findIndex(l => l.id === editLogId)
      if (idx >= 0) backup.logs[idx] = entry
    } else {
      backup.logs = [...logs, entry]
    }
    persist()
    resetProjForm()
  }

  function beginLogEdit(logId: string) {
    const l = logs.find(x => x.id === logId)
    if (!l) return
    setEditLogId(l.id)
    setFlProj(l.projId); setFlPhase(l.phase); setFlDate(l.date); setFlEmp(l.empId || '')
    setFlHrs(String(l.hrs)); setFlMiles(String(l.miles)); setFlMat(String(l.mat))
    setFlCollected(String(l.collected)); setFlStore(l.store || ''); setFlEmatInfo(l.emergencyMatInfo || '')
    setFlDetailLink(l.detailLink || ''); setFlNotes(l.notes || '')
    setShowProjForm(true)
  }

  function deleteLogEntry(logId: string) {
    if (!confirm('Delete this log entry?')) return
    pushState(backup)
    backup.logs = logs.filter(l => l.id !== logId)
    persist()
  }

  // ── Service log CRUD ───────────────────────────────────────────────────

  function resetSvcForm() {
    setSlCust(''); setSlAddr(''); setSlDate(today()); setSlHrs(''); setSlMi('')
    setSlQuoted(''); setSlMat(''); setSlCollected(''); setSlStore(''); setSlJtype(JOB_TYPES[0])
    setSlPayStatus('Y'); setSlEmatInfo(''); setSlDetailLink(''); setSlNotes('')
    setEditSvcId(null); setShowSvcForm(false)
  }

  function saveSvcEntry() {
    const hrs = parseFloat(slHrs) || 0
    const mi = parseInt(slMi) || 0
    const quoted = parseFloat(slQuoted) || 0
    const mat = parseFloat(slMat) || 0
    let collected = parseFloat(slCollected) || 0
    const mileCost = mi * mileRate
    const labCost = hrs * opCost
    const profit = quoted - mat - mileCost - labCost

    pushState(backup)
    let payStatus = slPayStatus
    if (collected <= 0.009) payStatus = 'N'
    else if (quoted > 0 && collected + 0.009 < quoted) payStatus = 'P'
    else payStatus = 'Y'

    const balanceDue = payStatus === 'Y' ? 0 : Math.max(0, quoted - collected)
    const triggersAtSave = getFiredTriggerNames(backup, { profit, quoted, mat, miles: mi, hrs, mileCost, opCost: labCost })

    const entry: BackupServiceLog = {
      id: editSvcId || ('svc' + Date.now()),
      date: slDate || today(),
      customer: slCust || 'Unknown',
      address: slAddr,
      jtype: slJtype,
      hrs, miles: mi, quoted, mat,
      collected, payStatus, balanceDue,
      store: slStore,
      notes: slNotes,
      emergencyMatInfo: slEmatInfo,
      detailLink: slDetailLink,
      adjustments: (editSvcId ? (serviceLogs.find(l => l.id === editSvcId)?.adjustments || []) : []),
    } as any

    if (editSvcId) {
      const idx = serviceLogs.findIndex(l => l.id === editSvcId)
      if (idx >= 0) backup.serviceLogs[idx] = entry
    } else {
      backup.serviceLogs = [...serviceLogs, entry]
    }
    persist()
    resetSvcForm()
  }

  function beginSvcEdit(logId: string) {
    const l = serviceLogs.find(x => x.id === logId)
    if (!l) return
    setEditSvcId(l.id)
    setSlCust(l.customer); setSlAddr(l.address || ''); setSlDate(l.date); setSlHrs(String(l.hrs))
    setSlMi(String(l.miles)); setSlQuoted(String(l.quoted)); setSlMat(String(l.mat))
    setSlCollected(String(l.collected)); setSlStore(l.store || ''); setSlJtype(l.jtype || JOB_TYPES[0])
    setSlPayStatus(l.payStatus || 'N'); setSlEmatInfo(l.emergencyMatInfo || '')
    setSlDetailLink(l.detailLink || ''); setSlNotes(l.notes || '')
    setShowSvcForm(true)
  }

  function deleteSvcEntry(logId: string) {
    if (!confirm('Delete this service entry?')) return
    pushState(backup)
    backup.serviceLogs = serviceLogs.filter(l => l.id !== logId)
    persist()
  }

  function quickSetSvcPayment(logId: string, status: string) {
    const l = serviceLogs.find(x => x.id === logId)
    if (!l) return
    pushState(backup)
    const roll = getServiceRollup(l)
    if (status === 'Y') {
      l.collected = roll.totalBillable
      l.payStatus = 'Y'
      l.balanceDue = 0
    } else if (status === 'P') {
      const amt = prompt('Partial amount collected:', String(num(l.collected) || 0))
      if (amt === null) return
      l.collected = parseFloat(amt) || 0
      const newMeta = getServicePaymentMeta(l)
      l.payStatus = newMeta.status
      l.balanceDue = newMeta.remaining
    }
    persist()
  }

  function addServiceAdjustment(logId: string, type: 'income' | 'expense' | 'mileage') {
    const l = serviceLogs.find(x => x.id === logId)
    if (!l) return
    const label = type === 'income' ? 'approved adder / extra charge' : (type === 'mileage' ? 'extra mileage cost' : 'extra expense')
    const amtRaw = window.prompt(`Enter ${label} amount:`, '0')
    if (amtRaw === null) return
    const amount = parseFloat(amtRaw)
    if (!Number.isFinite(amount) || amount <= 0) return alert('Invalid amount')
    const noteDefault = type === 'income' ? 'Added scope' : (type === 'mileage' ? 'Return trip / extra mileage' : 'Return trip / material / extra labor')
    const note = window.prompt(`Optional note for this ${type}:`, noteDefault) || ''
    pushState(backup)
    if (!Array.isArray(l.adjustments)) l.adjustments = []
    l.adjustments.push({
      id: 'adj' + Date.now() + Math.random().toString(36).slice(2, 7),
      type: type === 'mileage' ? 'expense' : type,
      category: type === 'mileage' ? 'mileage' : type,
      amount: +amount.toFixed(2),
      desc: note.trim(),
      date: today()
    })
    const payMeta = getServicePaymentMeta(l)
    l.payStatus = payMeta.status
    l.balanceDue = payMeta.remaining
    // If was paid but new adjustment changes balance, auto-revert to partial
    if (l.payStatus === 'Y' && payMeta.remaining > 0.009) {
      l.payStatus = 'P'
    }
    persist()
  }

  function toggleTrigger(ruleId: string, active: boolean) {
    const rule = triggerRules.find(r => r.id === ruleId)
    if (rule) {
      pushState(backup)
      rule.active = active
      persist()
    }
  }

  // ── Tab colors ─────────────────────────────────────────────────────────

  const tabStyle = (tab: string) => {
    const isActive = activeTab === tab
    const colors: Record<string, string> = { proj: '#10b981', svc: '#f97316', triggers: '#3b82f6' }
    return {
      background: isActive ? colors[tab] : '#1e2130',
      color: isActive ? (tab === 'triggers' ? '#fff' : '#000') : '#9ca3af',
      border: isActive ? '1px solid transparent' : '1px solid #2e2e3a',
      boxShadow: isActive ? `0 2px 8px ${colors[tab]}55` : 'none',
    }
  }

  // ── Render: Project Logs (GREEN TAB) ───────────────────────────────────────

  function renderProjectLogs() {
    const filtered = projFilter === 'all' ? logs : logs.filter(l => l.projId === projFilter)
    const sorted = [...filtered].sort((a, b) => {
      const da = String(b.date || ''), db = String(a.date || '')
      if (da !== db) return da.localeCompare(db)
      return String(b.id || '').localeCompare(String(a.id || ''))
    })

    const rollCache: Record<string, any> = {}
    const getRoll = (projId: string) => {
      if (!rollCache[projId]) rollCache[projId] = buildProjectLogRollup(backup, projId)
      return rollCache[projId]
    }

    return (
      <div className="space-y-4">
        {/* Filter + Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter size={12} className="text-gray-500" />
            <select
              value={projFilter}
              onChange={e => setProjFilter(e.target.value)}
              className="bg-[var(--bg-input)] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
            >
              <option value="all">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              onClick={() => setShowGaps(!showGaps)}
              className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
                showGaps
                  ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30'
                  : 'bg-gray-700/30 text-gray-400 border border-gray-600/30'
              }`}
            >
              {showGaps ? 'Hide Gaps' : 'Show Gaps'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => alert('AI Profit Analysis coming soon.')}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700"
            >
              <Sparkles size={12} /> AI Analysis
            </button>
            <button
              onClick={() => { resetProjForm(); setShowProjForm(true) }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
            >
              <Plus size={12} /> Log
            </button>
          </div>
        </div>

        {/* Entry form */}
        {showProjForm && (
          <div className="rounded-xl border border-gray-700 bg-[var(--bg-input)] p-4 space-y-3">
            <div className="text-xs font-bold text-gray-300 uppercase">{editLogId ? 'Edit Entry' : 'New Log'}</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Project</label>
                <select value={flProj} onChange={e => setFlProj(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200">
                  <option value="">Select...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Phase</label>
                <select value={flPhase} onChange={e => setFlPhase(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200">
                  {PHASES.map(ph => <option key={ph} value={ph}>{ph}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Date</label>
                <input type="date" value={flDate} onChange={e => setFlDate(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Employee</label>
                <select value={flEmp} onChange={e => setFlEmp(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200">
                  <option value="">Me</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Hours</label>
                <input type="number" step="0.5" value={flHrs} onChange={e => setFlHrs(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Miles RT</label>
                <input type="number" value={flMiles} onChange={e => setFlMiles(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Materials $</label>
                <input type="number" step="0.01" value={flMat} onChange={e => setFlMat(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Collected $</label>
                <input type="number" step="0.01" value={flCollected} onChange={e => setFlCollected(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Store</label>
                <input value={flStore} onChange={e => setFlStore(e.target.value)} placeholder="Home Depot..." className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-bold">Emergency Mat Info</label>
              <input value={flEmatInfo} onChange={e => setFlEmatInfo(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-bold">Detail Link</label>
              <input value={flDetailLink} onChange={e => setFlDetailLink(e.target.value)} placeholder="Receipt, cart, item link" className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-bold">Work Performed</label>
              <textarea value={flNotes} onChange={e => setFlNotes(e.target.value)} rows={2} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 resize-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={saveProjEntry} className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-semibold">{editLogId ? 'Update' : 'Save'}</button>
              <button onClick={resetProjForm} className="px-3 py-1.5 rounded bg-gray-700 text-gray-300 text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Last 7 Days summary box */}
        {sorted.length > 0 && (() => {
          const now = new Date()
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

          // Filter project logs by date range
          const recentProjectLogs = (backup.logs || []).filter((log: any) => {
            const logDate = new Date(log.date || log.logDate)
            return logDate >= sevenDaysAgo
          })

          // Filter service logs by date range
          const recentServiceLogs = (backup.serviceLogs || []).filter((log: any) => {
            const logDate = new Date(log.date)
            return logDate >= sevenDaysAgo
          })

          // Compute totals from both log types
          const totalHours = recentProjectLogs.reduce((s, l) => s + num(l.hrs || l.hours), 0) +
                            recentServiceLogs.reduce((s, l) => s + num(l.hours || l.hrs), 0)
          const totalMaterialCost = recentProjectLogs.reduce((s, l) => s + num(l.mat || l.materialCost), 0) +
                                   recentServiceLogs.reduce((s, l) => s + num(l.mat || l.materialCost), 0)
          const totalMiles = recentProjectLogs.reduce((s, l) => s + num(l.miles || l.mileRT), 0) +
                            recentServiceLogs.reduce((s, l) => s + num(l.miles || l.mileRT), 0)
          const logCount = recentProjectLogs.length + recentServiceLogs.length

          // Build per-day breakdown from both log types
          const perDayData: Record<string, number> = {}
          for (let i = 0; i < 7; i++) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            const key = d.toISOString().slice(0, 10)
            perDayData[key] = 0
          }

          recentProjectLogs.forEach(l => {
            const key = l.date || l.logDate
            if (perDayData.hasOwnProperty(key)) {
              perDayData[key] += num(l.hrs || l.hours)
            }
          })

          recentServiceLogs.forEach(l => {
            const key = l.date
            if (perDayData.hasOwnProperty(key)) {
              perDayData[key] += num(l.hours || l.hrs)
            }
          })

          const maxDailyHoursLast7 = Math.max(1, ...Object.values(perDayData))

          return (
            <div className="space-y-3">
              {/* Summary metrics */}
              <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-3">
                <div className="text-[9px] font-bold text-gray-400 uppercase mb-3">Last 7 Days Summary</div>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Total Hours</div>
                    <div className="text-sm font-bold font-mono text-white">{totalHours.toFixed(1)}h</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Material Cost</div>
                    <div className="text-sm font-bold font-mono text-orange-400">{fmt(totalMaterialCost)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Total Miles</div>
                    <div className="text-sm font-bold font-mono text-blue-400">{totalMiles.toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Log Count</div>
                    <div className="text-sm font-bold font-mono text-gray-300">{logCount}</div>
                  </div>
                </div>
              </div>

              {/* Per-day breakdown bar chart */}
              <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-3">
                <div className="text-[9px] font-bold text-gray-400 uppercase mb-2">Daily Hours</div>
                <div className="flex items-end gap-1 h-12">
                  {Object.entries(perDayData).reverse().map(([date, hours]) => {
                    const pct = maxDailyHoursLast7 > 0 ? (hours / maxDailyHoursLast7) * 100 : 0
                    const isToday = date === today()
                    return (
                      <div key={date} className="flex-1 flex flex-col items-center gap-1 text-[9px]">
                        <div
                          className={`w-full rounded-t transition-all ${isToday ? 'bg-emerald-500' : 'bg-emerald-600/60'}`}
                          style={{ height: `${Math.max(2, pct)}%` }}
                          title={`${date}: ${hours.toFixed(1)}h`}
                        />
                        <span className="text-gray-500">{date.slice(5).replace('-', '/')}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Running Totals Sticky Bar */}
        {sorted.length > 0 && (() => {
          const totalHours = sorted.reduce((s, l) => s + num(l.hrs), 0)
          const totalMat = sorted.reduce((s, l) => s + num(l.mat), 0)
          const totalCollected = sorted.reduce((s, l) => s + num(l.collected || 0), 0)
          const totalCostRate = num(backup.settings?.opCost || 42.45)
          const totalMileRate = num(backup.settings?.mileRate || 0.66)
          const totalLaborCost = sorted.reduce((s, l) => s + (num(l.hrs) * totalCostRate), 0)
          const totalMileCost = sorted.reduce((s, l) => s + (num(l.miles || 0) * totalMileRate), 0)
          const runningProfit = totalCollected - totalMat - totalLaborCost - totalMileCost

          // Balance left: contract sum minus collected for filtered projects
          let contractSum = 0
          if (projFilter === 'all') {
            contractSum = projects.reduce((s, p) => s + num(p.contract || 0), 0)
          } else {
            const proj = projects.find(p => p.id === projFilter)
            if (proj) {
              const fin = getProjectFinancials(proj, backup)
              contractSum = fin.contract
            }
          }
          const balanceLeft = contractSum - totalCollected

          return (
            <div className="sticky top-0 z-10 bg-[var(--bg-input)] border border-gray-700 rounded-lg p-3 mb-3 shadow-lg">
              <div className="grid grid-cols-5 gap-2 text-center">
                <div>
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Total Hours</div>
                  <div className="text-sm font-bold font-mono text-white">{totalHours.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Material Cost</div>
                  <div className="text-sm font-bold font-mono text-orange-400">{fmt(totalMat)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Collected</div>
                  <div className="text-sm font-bold font-mono text-emerald-400">{fmt(totalCollected)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Running Profit</div>
                  <div className={`text-sm font-bold font-mono ${runningProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(runningProfit)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-500 uppercase font-bold">Balance Left</div>
                  <div className="text-sm font-bold font-mono text-yellow-400">{fmt(balanceLeft)}</div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Log entries with running totals */}
        {sorted.length > 0 ? (
          <div className="space-y-2">
            {(() => {
              const interleaved = showGaps ? interleaveWithGaps(sorted, 'date') : sorted.map(e => ({type: 'entry', data: e}))
              const realEntries = interleaved.filter((item: any) => item.type === 'entry').map((item: any) => item.data)

              return interleaved.map((item: any, mapIdx: number) => {
                if (item.type === 'gap') {
                  // Render gap row
                  return (
                    <div
                      key={`gap-${item.startDate}-${item.endDate}`}
                      className="rounded-lg border p-3"
                      style={{
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderStyle: 'dashed',
                        background: 'rgba(31,41,55,0.4)',
                        color: '#d97706'
                      }}
                    >
                      <div className="text-[11px] font-semibold text-center">{item.label}</div>
                    </div>
                  )
                }

                // Render entry row
                const l = item.data
                const idx = realEntries.indexOf(l)
                const projRoll = getRoll(l.projId)
                const rr = projRoll.byId[l.id] || { cumHours: 0, cumMiles: 0, dayCost: 0, actualCostToDate: 0, remainingAfter: projRoll.quote }
                const pcol = num(rr.remainingAfter) >= 0 ? '#10b981' : '#ef4444'
                const collected = num(l.collected)
                const hasPay = collected > 0

                // Running totals up to this entry
                const logsUpToThis = realEntries.slice(0, idx + 1)
                const cumHours = logsUpToThis.reduce((s: any, x: any) => s + num(x.hrs), 0)
                const cumMat = logsUpToThis.reduce((s: any, x: any) => s + num(x.mat), 0)
                const cumCollected = logsUpToThis.reduce((s: any, x: any) => s + num(x.collected), 0)

              // Daily target indicator
              const todayHours = sorted.filter(x => x.date === today()).reduce((s, x) => s + num(x.hrs), 0)
              const todayProjectedMargin = todayHours * opCost // simplified
              const onTarget = todayProjectedMargin >= dayTarget

              return (
                <div key={l.id} className="space-y-1">
                  {/* Main entry row */}
                  <div
                    className="rounded-lg border border-gray-800 bg-[var(--bg-card)] p-3"
                    style={hasPay ? { background: 'linear-gradient(180deg, rgba(48,209,88,.10), rgba(48,209,88,.04))', borderLeft: '3px solid #10b981' } : {}}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-gray-500 font-mono">{l.date}</span>
                          <span className="text-xs font-semibold text-gray-200">{l.projName}</span>
                          <span className="text-[10px] text-gray-500">{l.phase}</span>
                          <span className="text-[10px] text-gray-500">{l.emp || 'Me'}</span>
                          {hasPay && <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-bold">💵 Collected</span>}
                        </div>
                        {l.notes && <div className="text-[10px] text-gray-500 mt-1">{l.notes}</div>}
                        {l.store && <div className="text-[10px] text-gray-500 mt-0.5">🏪 {l.store}</div>}
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => beginLogEdit(l.id)} className="text-[10px] px-2 py-1 rounded bg-gray-700/50 text-gray-300">Edit</button>
                          <button onClick={() => deleteLogEntry(l.id)} className="text-[10px] px-2 py-1 rounded bg-gray-700/50 text-gray-400 hover:text-red-400">Delete</button>
                        </div>
                      </div>
                      <div className="text-right text-[11px]">
                        <div className="font-mono font-bold" style={{ color: '#fff' }}>{num(l.hrs).toFixed(1)}h</div>
                        <div style={{ color: '#f97316', fontFamily: 'monospace', fontSize: '11px', fontWeight: 700 }}>{fmt(num(l.mat))}</div>
                        <div style={{ color: '#10b981', fontFamily: 'monospace', fontSize: '12px', fontWeight: 700 }}>{fmt(num(l.collected))}</div>
                        {(() => {
                          const entryProfit = num(l.collected) - num(l.mat) - (num(l.hrs) * opCost) - (num(l.miles || 0) * mileRate);
                          const profitColor = entryProfit >= 0 ? '#10b981' : '#ef4444';
                          return <div style={{ color: profitColor, fontFamily: 'monospace', fontSize: '12px', fontWeight: 700 }}>{fmt(entryProfit)}</div>;
                        })()}
                      </div>
                    </div>
                  </div>

                  {/* Mini breakdown strip - shows hours, mat, collected, profit, receipt */}
                  <div className="bg-[var(--bg-input)] border border-gray-800 rounded px-2 py-1.5 text-[10px] font-mono flex gap-4" style={{ alignItems: 'center' }}>
                    <span style={{ color: '#9ca3af' }}>
                      <span className="text-gray-500">H</span> <span className="text-gray-300">{num(l.hrs).toFixed(1)}</span>
                    </span>
                    <span style={{ color: '#f59e0b' }}>
                      <span className="text-orange-600">Mat</span> <span className="text-orange-300">{fmt(num(l.mat))}</span>
                    </span>
                    <span style={{ color: '#10b981' }}>
                      <span className="text-emerald-600">Coll</span> <span className="text-emerald-300">{fmt(num(l.collected))}</span>
                    </span>
                    {(() => {
                      const profit = num(l.collected) - num(l.mat) - (num(l.hrs) * opCost) - (num(l.miles || 0) * mileRate);
                      const profitColor = profit >= 0 ? '#10b981' : '#ef4444';
                      return (
                        <span style={{ color: profitColor }}>
                          <span style={{ color: profit >= 0 ? '#10b981' : '#ef4444' }}>P</span> <span>{fmt(profit)}</span>
                        </span>
                      );
                    })()}
                    {l.detailLink && l.detailLink.trim() && (
                      <span style={{ color: '#9ca3af', marginLeft: 'auto' }}>📎</span>
                    )}
                  </div>

                  {/* Running totals sub-row */}
                  <div className="bg-[var(--bg-input)] border border-gray-800 rounded px-3 py-2 text-[10px] flex justify-between gap-3">
                    <div className="flex gap-4">
                      <span><span className="text-gray-500">Cum Hours:</span> <span className="font-mono text-gray-300">{cumHours.toFixed(1)}h</span></span>
                      <span><span className="text-gray-500">Cum Mat:</span> <span className="font-mono text-gray-300">{fmt(cumMat)}</span></span>
                      <span><span className="text-gray-500">Cum Collected:</span> <span className="font-mono text-emerald-400">{fmt(cumCollected)}</span></span>
                    </div>
                    <div className="flex gap-3">
                      <span style={{ color: num(rr.remainingAfter) >= 0 ? '#10b981' : '#ef4444', fontFamily: 'monospace', fontWeight: 700 }}>Margin {pct(Math.round((num(rr.remainingAfter) / (dayTarget || 1)) * 100))}</span>
                      {todayHours > 0 && (
                        <span style={{ padding: '2px 6px', borderRadius: '3px', background: onTarget ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)', color: onTarget ? '#10b981' : '#ef4444', fontSize: '9px', fontWeight: 700 }}>
                          {onTarget ? '✓ On Target' : '⚠ Below Target'} ({todayHours.toFixed(1)}h)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
              })
            })()}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 text-sm">No entries yet. Create your first log entry.</div>
        )}

        {/* Project Summary bars - one per project */}
        {sorted.length > 0 && projFilter === 'all' && (() => {
          const projectMap: Record<string, BackupLog[]> = {}
          sorted.forEach(l => {
            if (!projectMap[l.projId]) projectMap[l.projId] = []
            projectMap[l.projId].push(l)
          })

          return Object.entries(projectMap).map(([projId, projLogs]) => {
            const proj = projects.find(p => p.id === projId)
            if (!proj) return null

            const fin = getProjectFinancials(proj, backup)
            const projTotalCollected = projLogs.reduce((s, l) => s + num(l.collected), 0)
            const projTotalMat = projLogs.reduce((s, l) => s + num(l.mat), 0)
            const projTotalHrs = projLogs.reduce((s, l) => s + num(l.hrs), 0)
            const projTotalMiles = projLogs.reduce((s, l) => s + num(l.miles || 0), 0)
            const projTotalCosts = projTotalMat + (projTotalHrs * opCost) + (projTotalMiles * mileRate)
            const balanceLeft = Math.max(0, fin.contract - projTotalCollected)

            return (
              <div key={projId} className="bg-[var(--bg-input)] border border-gray-800 rounded px-3 py-2 text-[10px] flex justify-between gap-3 mb-2">
                <div className="font-semibold text-gray-200">{proj.name}</div>
                <div className="flex gap-4">
                  <span style={{ color: '#e5e7eb' }}>
                    <span className="text-gray-500">Quote:</span> <span className="font-mono">{fmt(fin.contract)}</span>
                  </span>
                  <span style={{ color: '#10b981' }}>
                    <span className="text-gray-500">Collected:</span> <span className="font-mono">{fmt(projTotalCollected)}</span>
                  </span>
                  <span style={{ color: '#ef4444' }}>
                    <span className="text-gray-500">Costs:</span> <span className="font-mono">{fmt(projTotalCosts)}</span>
                  </span>
                  <span style={{ color: '#fbbf24' }}>
                    <span className="text-gray-500">Balance:</span> <span className="font-mono">{fmt(balanceLeft)}</span>
                  </span>
                </div>
              </div>
            )
          })
        })()}

        {/* Running Totals Bar at bottom - Project Log */}
        {sorted.length > 0 && (() => {
          const projId = projFilter === 'all' ? null : projFilter;
          const roll = projId ? buildProjectLogRollup(backup, projId) : null;
          const logsForTotal = projId ? sorted : sorted;
          const totalHours = logsForTotal.reduce((s, l) => s + num(l.hrs), 0);
          const totalMat = logsForTotal.reduce((s, l) => s + num(l.mat), 0);
          const totalCollected = logsForTotal.reduce((s, l) => s + num(l.collected), 0);
          const totalProfit = totalCollected - totalMat - (totalHours * opCost);
          const projQuote = roll ? num(roll.quote) : 0;
          const balanceLeft = projQuote > 0 ? Math.max(0, projQuote - totalCollected) : 0;
          return (
            <div style={{
              position: 'sticky',
              bottom: 0,
              backgroundColor: '#1e2130',
              borderTop: '1px solid #4b5563',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '16px',
              fontSize: '12px',
              fontWeight: '600',
              marginTop: '12px',
              borderRadius: '0 0 8px 8px'
            }}>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <span style={{ color: '#9ca3af' }}>
                  Total Hours: <span className="font-mono" style={{ color: '#e5e7eb' }}>{totalHours.toFixed(1)}h</span>
                </span>
                <span style={{ color: '#f59e0b' }}>
                  Total Mat: <span className="font-mono" style={{ color: '#fcd34d' }}>{fmt(totalMat)}</span>
                </span>
                <span style={{ color: '#10b981' }}>
                  Total Collected: <span className="font-mono" style={{ color: '#6ee7b7' }}>{fmt(totalCollected)}</span>
                </span>
                <span style={{ color: totalProfit >= 0 ? '#10b981' : '#ef4444' }}>
                  Running Profit: <span className="font-mono">{fmt(totalProfit)}</span>
                </span>
                {balanceLeft > 0 && (
                  <span style={{ color: '#f97316' }}>
                    Balance Left: <span className="font-mono" style={{ color: '#fed7aa' }}>{fmt(balanceLeft)}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    )
  }

  // ── Render: Service Logs (ORANGE TAB) ────────────────────────────────────────

  function renderServiceLogs() {
    const filtered = svcFilter === 'all' ? serviceLogs : serviceLogs.filter(l => l.jtype === svcFilter)
    const sorted = [...filtered].sort((a, b) => {
      const da = String(b.date || ''), db = String(a.date || '')
      if (da !== db) return da.localeCompare(db)
      return String(b.id || '').localeCompare(String(a.id || ''))
    })

    // Collections queue: sorted by remaining balance descending (biggest balance first)
    const collections = sorted
      .filter(l => serviceBalanceDue(l) > 0.009)
      .sort((a, b) => serviceBalanceDue(b) - serviceBalanceDue(a))

    return (
      <div className="space-y-4">
        {/* Filter + Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter size={12} className="text-gray-500" />
            <select
              value={svcFilter}
              onChange={e => setSvcFilter(e.target.value)}
              className="bg-[var(--bg-input)] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
            >
              <option value="all">All Types</option>
              {JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
            </select>
            <button
              onClick={() => setShowGaps(!showGaps)}
              className={`px-2 py-1 rounded text-xs font-semibold transition-all ${
                showGaps
                  ? 'bg-amber-600/20 text-amber-400 border border-amber-600/30'
                  : 'bg-gray-700/30 text-gray-400 border border-gray-600/30'
              }`}
            >
              {showGaps ? 'Hide Gaps' : 'Show Gaps'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowQBImport(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
            >
              <FileText size={12} /> Import QB PDF
            </button>
            <button
              onClick={() => { resetSvcForm(); setShowSvcForm(true) }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold"
            >
              <Plus size={12} /> Service Call
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* STEP 1: New Service Estimate Form */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}

        <div className="border-t border-gray-700 pt-4">
          <button
            onClick={() => { resetEstimateForm(); setShowEstimateForm(!showEstimateForm) }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold mb-3"
          >
            <Plus size={12} /> New Service Estimate
          </button>

          {showEstimateForm && (
            <div className="rounded-xl border border-blue-700/50 bg-[var(--bg-input)] p-4 space-y-3 mb-4">
              <div className="text-xs font-bold text-gray-300 uppercase">
                {editEstimateId ? 'Edit Service Estimate' : 'New Service Estimate'}
              </div>

              {/* Form grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Customer / Job Name</label>
                  <input
                    value={estCust}
                    onChange={e => setEstCust(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Address</label>
                  <input
                    value={estAddr}
                    onChange={e => setEstAddr(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Date</label>
                  <input
                    type="date"
                    value={estDate}
                    onChange={e => setEstDate(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Job Type</label>
                  <select
                    value={estJobType}
                    onChange={e => setEstJobType(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  >
                    {JOB_TYPES.map(jt => (
                      <option key={jt} value={jt}>
                        {jt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Estimated Hours</label>
                  <input
                    type="number"
                    step="0.5"
                    value={estHours}
                    onChange={e => setEstHours(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Bill Rate $</label>
                  <input
                    type="number"
                    step="0.01"
                    value={estBillRate}
                    onChange={e => setEstBillRate(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Estimated Materials $</label>
                  <input
                    type="number"
                    step="0.01"
                    value={estMaterials}
                    onChange={e => setEstMaterials(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
                <div>
                  <label className="text-[9px] text-gray-500 uppercase font-bold">Miles RT</label>
                  <input
                    type="number"
                    step="0.1"
                    value={estMiles}
                    onChange={e => setEstMiles(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Notes</label>
                <textarea
                  value={estNotes}
                  onChange={e => setEstNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 resize-none"
                />
              </div>

              {/* Live calculation + profit signal (matches source HTML calcServiceCall) */}
              {(() => {
                const estHrs = parseFloat(estHours) || 0
                const estMat = parseFloat(estMaterials) || 0
                const estMi = parseFloat(estMiles) || 0
                const estRate = parseFloat(estBillRate) || billRate

                const labor = estHrs * estRate
                const mileageCost = estMi * mileRate
                const opCostTotal = estHrs * opCost
                const totalQuote = labor + estMat + mileageCost
                const profit = totalQuote - estMat - mileageCost - opCostTotal
                const marginPct = totalQuote > 0 ? ((profit / totalQuote) * 100) : 0

                return (
                  <>
                    {/* 5-cell summary bar matching source HTML */}
                    <div className="grid grid-cols-5 gap-0 rounded-lg overflow-hidden border border-blue-700/30">
                      <div className="bg-[var(--bg-primary)] px-2 py-2 border-r border-gray-700">
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 mb-1">Material Cost</div>
                        <div className="font-mono text-xs font-bold text-orange-400">{fmt(estMat)}</div>
                      </div>
                      <div className="bg-[var(--bg-primary)] px-2 py-2 border-r border-gray-700">
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 mb-1">Mileage <span className="opacity-60">@${mileRate.toFixed(2)}/mi</span></div>
                        <div className="font-mono text-xs font-bold text-red-400">{fmt(mileageCost)}</div>
                      </div>
                      <div className="bg-[var(--bg-primary)] px-2 py-2 border-r border-gray-700">
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 mb-1">Op Cost <span className="opacity-60">@${opCost.toFixed(2)}/hr</span></div>
                        <div className="font-mono text-xs font-bold text-red-500">{fmt(opCostTotal)}</div>
                      </div>
                      <div className="bg-[var(--bg-primary)] px-2 py-2 border-r border-gray-700">
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 mb-1">Quoted Total</div>
                        <div className="font-mono text-xs font-bold text-gray-200">{fmt(totalQuote)}</div>
                      </div>
                      <div className="bg-[var(--bg-primary)] px-2 py-2">
                        <div className="text-[8px] uppercase tracking-wider text-gray-500 mb-1">Est. Profit</div>
                        <div className={`font-mono text-xs font-bold ${profit >= dayTarget ? 'text-emerald-400' : profit > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {fmt(profit)} <span className="text-[9px] opacity-70">({marginPct.toFixed(1)}%)</span>
                        </div>
                      </div>
                    </div>

                    {/* Profit signal indicator */}
                    {totalQuote > 0 && (
                      <div className={`rounded-lg px-3 py-2 text-xs border ${
                        profit >= dayTarget
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : profit > 0
                          ? 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400'
                          : 'bg-red-500/10 border-red-500/25 text-red-400'
                      }`}>
                        {profit >= dayTarget && <span>&#9989; <strong>Above daily target</strong> — {fmt(profit)} profit ({marginPct.toFixed(1)}% margin). Strong job.</span>}
                        {profit > 0 && profit < dayTarget && <span>&#9888;&#65039; <strong>Below daily target</strong> — {fmt(profit)} profit ({marginPct.toFixed(1)}% margin). {fmt(dayTarget - profit)} short.</span>}
                        {profit <= 0 && <span>&#128308; <strong>Unprofitable</strong> — costs exceed quote by {fmt(Math.abs(profit))}. Reprice or reduce scope.</span>}
                      </div>
                    )}
                  </>
                )
              })()}

              <div className="flex gap-2">
                <button
                  onClick={saveServiceEstimate}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold"
                >
                  {editEstimateId ? 'Update Estimate' : 'Save as Open Estimate'}
                </button>
                <button onClick={resetEstimateForm} className="px-3 py-1.5 rounded bg-gray-700 text-gray-300 text-xs">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* STEP 2: Open Estimates Bucket */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}

        {serviceEstimates.filter(e => e.status === 'open').length > 0 && (
          <div className="bg-[var(--bg-card)] border border-blue-700/30 rounded-lg p-3 space-y-3">
            <div className="text-xs font-bold text-blue-400 uppercase">
              Open Estimates ({serviceEstimates.filter(e => e.status === 'open').length})
            </div>

            <div className="space-y-2">
              {serviceEstimates
                .filter(e => e.status === 'open')
                .map(est => (
                  <div key={est.id} className="bg-[var(--bg-input)] rounded p-3 flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-200">{est.customer}</span>
                        <span className="text-[10px] text-gray-500">{est.jobType}</span>
                        <span className="text-[10px] text-gray-500">{est.date}</span>
                        <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-blue-500/20 text-blue-400">
                          Open
                        </span>
                      </div>
                      {est.address && <div className="text-[10px] text-gray-500 mt-1">{est.address}</div>}
                    </div>
                    <div className="text-right mr-3">
                      <div className="font-mono text-blue-400 font-bold text-sm">{fmt(est.totalQuote)}</div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => confirmEstimateToActiveCall(est.id)}
                        className="text-[9px] px-2 py-1 rounded bg-emerald-700/50 text-emerald-300 hover:bg-emerald-600/50"
                      >
                        Confirm Job
                      </button>
                      <button
                        onClick={() => beginEstimateEdit(est.id)}
                        className="text-[9px] px-2 py-1 rounded bg-gray-700/50 text-gray-300"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteEstimate(est.id)}
                        className="text-[9px] px-2 py-1 rounded bg-gray-700/50 text-gray-400 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* STEP 3: Active Service Calls Bucket + Completion Modal */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}

        {serviceEstimates.filter(e => e.status === 'active').length > 0 && (
          <div className="bg-[var(--bg-card)] border border-emerald-700/30 rounded-lg p-3 space-y-3">
            <div className="text-xs font-bold text-emerald-400 uppercase">
              Active Service Calls ({serviceEstimates.filter(e => e.status === 'active').length})
            </div>

            <div className="space-y-2">
              {serviceEstimates
                .filter(e => e.status === 'active')
                .map(est => (
                  <div key={est.id} className="bg-[var(--bg-input)] rounded p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-gray-200">{est.customer}</span>
                          <span className="text-[10px] text-gray-500">{est.jobType}</span>
                          <span className="text-[10px] text-gray-500">{est.date}</span>
                          <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400">
                            Active
                          </span>
                        </div>
                        {est.address && <div className="text-[10px] text-gray-500 mt-1">{est.address}</div>}
                      </div>
                      <div className="text-right mr-3">
                        <div className="font-mono text-emerald-400 font-bold text-sm">{fmt(est.totalQuote)}</div>
                      </div>
                    </div>

                    {/* Completion modal */}
                    {completingEstimateId === est.id && (
                      <div className="bg-[var(--bg-primary)] border border-emerald-600/50 rounded p-3 space-y-2">
                        <div className="text-xs font-bold text-emerald-400">Log as Complete</div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-gray-500 uppercase font-bold">Actual Hours</label>
                            <input
                              type="number"
                              step="0.5"
                              value={actualHours}
                              onChange={e => setActualHours(e.target.value)}
                              className="w-full bg-[var(--bg-input)] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-gray-500 uppercase font-bold">Actual Materials $</label>
                            <input
                              type="number"
                              step="0.01"
                              value={actualMaterials}
                              onChange={e => setActualMaterials(e.target.value)}
                              className="w-full bg-[var(--bg-input)] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-gray-500 uppercase font-bold">Actual Miles RT</label>
                            <input
                              type="number"
                              step="0.1"
                              value={actualMiles}
                              onChange={e => setActualMiles(e.target.value)}
                              className="w-full bg-[var(--bg-input)] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-gray-500 uppercase font-bold">Payment Collected $</label>
                            <input
                              type="number"
                              step="0.01"
                              value={paymentCollected}
                              onChange={e => setPaymentCollected(e.target.value)}
                              className="w-full bg-[var(--bg-input)] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-gray-500 uppercase font-bold">Payment Status</label>
                            <select
                              value={paymentStatus}
                              onChange={e => setPaymentStatus(e.target.value)}
                              className="w-full bg-[var(--bg-input)] border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
                            >
                              <option value="Paid">Paid</option>
                              <option value="Partial">Partial</option>
                              <option value="Unpaid">Unpaid</option>
                            </select>
                          </div>
                        </div>

                        {/* Variance comparison */}
                        {(() => {
                          const estHrs = est.estHours || 0
                          const actHrs = parseFloat(actualHours) || 0
                          const estMat = est.estMaterials || 0
                          const actMat = parseFloat(actualMaterials) || 0
                          const estMi = est.milesRT || 0
                          const actMi = parseFloat(actualMiles) || 0

                          const hrsVariance = actHrs - estHrs
                          const matVariance = actMat - estMat
                          const miVariance = actMi - estMi

                          return (
                            <div className="bg-[var(--bg-input)] rounded p-2 text-[9px] space-y-1 border border-gray-700">
                              <div className="font-bold text-gray-300 mb-1">Estimated vs Actual:</div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">Hours: {estHrs}h → {actHrs}h</span>
                                <span style={{ color: hrsVariance <= 0 ? '#10b981' : '#ef4444' }} className="font-mono">
                                  {hrsVariance > 0 ? '+' : ''}{hrsVariance.toFixed(1)}h
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">Materials: {fmt(estMat)} → {fmt(actMat)}</span>
                                <span style={{ color: matVariance <= 0 ? '#10b981' : '#ef4444' }} className="font-mono">
                                  {matVariance > 0 ? '+' : ''}{fmt(matVariance)}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-500">Miles: {estMi}mi → {actMi}mi</span>
                                <span style={{ color: miVariance <= 0 ? '#10b981' : '#ef4444' }} className="font-mono">
                                  {miVariance > 0 ? '+' : ''}{miVariance.toFixed(1)}mi
                                </span>
                              </div>
                            </div>
                          )
                        })()}

                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              completeAndLogService()
                            }}
                            className="flex-1 px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-semibold"
                          >
                            Complete & Log
                          </button>
                          <button
                            onClick={() => setCompletingEstimateId(null)}
                            className="px-3 py-1.5 rounded bg-gray-700 text-gray-300 text-xs"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {completingEstimateId !== est.id && (
                      <button
                        onClick={() => startCompleteEstimate(est.id)}
                        className="w-full px-3 py-1.5 rounded bg-emerald-700/50 text-emerald-300 hover:bg-emerald-600/50 text-xs font-semibold"
                      >
                        Log as Complete
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Completion variance summary card (shown after completion) */}
        {completionVariance && (
          <div className="bg-emerald-900/20 border border-emerald-600/50 rounded-lg p-3">
            <div className="text-xs font-bold text-emerald-400 mb-2">Completion Summary</div>
            <div className="text-sm text-gray-300 font-mono space-y-1">
              <div>
                Quoted: <span className="text-emerald-400">{fmt(completionVariance.quoted)}</span> → Actual Cost:{' '}
                <span style={{ color: completionVariance.actualCost <= completionVariance.quoted ? '#10b981' : '#ef4444' }}>
                  {fmt(completionVariance.actualCost)}
                </span>
              </div>
              {completionVariance.matVariancePct > 20 && (
                <div className="text-yellow-400">⚠ Material overrun ({completionVariance.matVariancePct.toFixed(1)}%)</div>
              )}
              {completionVariance.hrsVariancePct > 25 && (
                <div className="text-yellow-400">⚠ Labor overrun ({completionVariance.hrsVariancePct.toFixed(1)}%)</div>
              )}
            </div>
          </div>
        )}

        {/* Entry form with LIVE PROFIT PREVIEW */}
        {showSvcForm && (
          <div className="rounded-xl border border-orange-700/50 bg-[var(--bg-input)] p-4 space-y-3">
            <div className="text-xs font-bold text-gray-300 uppercase">{editSvcId ? 'Edit Service Entry' : 'New Service Call'}</div>

            {/* LIVE PROFIT PREVIEW */}
            {(slQuoted || slHrs) && (
              <div
                className="p-3 rounded-lg border-l-2"
                style={{
                  background: 'rgba(249, 115, 22, 0.1)',
                  borderColor: '#f97316'
                }}
              >
                <ProfitPreview
                  quoted={parseFloat(slQuoted) || 0}
                  mat={parseFloat(slMat) || 0}
                  hrs={parseFloat(slHrs) || 0}
                  miles={parseInt(slMi) || 0}
                  dayTarget={dayTarget}
                  mileRate={mileRate}
                  opCost={opCost}
                />
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Customer</label>
                <input value={slCust} onChange={e => setSlCust(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Address</label>
                <input value={slAddr} onChange={e => setSlAddr(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Date</label>
                <input type="date" value={slDate} onChange={e => setSlDate(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Hours</label>
                <input type="number" step="0.5" value={slHrs} onChange={e => setSlHrs(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Miles RT</label>
                <input type="number" value={slMi} onChange={e => setSlMi(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Quoted $</label>
                <input type="number" step="0.01" value={slQuoted} onChange={e => setSlQuoted(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Materials $</label>
                <input type="number" step="0.01" value={slMat} onChange={e => setSlMat(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Collected $</label>
                <input type="number" step="0.01" value={slCollected} onChange={e => setSlCollected(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Job Type</label>
                <select value={slJtype} onChange={e => setSlJtype(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200">
                  {JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Store</label>
                <input value={slStore} onChange={e => setSlStore(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase font-bold">Status</label>
                <select value={slPayStatus} onChange={e => setSlPayStatus(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200">
                  <option value="Y">Paid in Full</option>
                  <option value="P">Partial</option>
                  <option value="N">Unpaid</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-bold">Emergency Mat Info</label>
              <input value={slEmatInfo} onChange={e => setSlEmatInfo(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-bold">Detail Link</label>
              <input value={slDetailLink} onChange={e => setSlDetailLink(e.target.value)} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200" />
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase font-bold">Notes</label>
              <textarea value={slNotes} onChange={e => setSlNotes(e.target.value)} rows={2} className="w-full bg-[var(--bg-primary)] border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 resize-none" />
            </div>
            <div className="flex gap-2">
              <button onClick={saveSvcEntry} className="px-3 py-1.5 rounded bg-orange-600 text-white text-xs font-semibold">{editSvcId ? 'Update' : 'Save'}</button>
              <button onClick={resetSvcForm} className="px-3 py-1.5 rounded bg-gray-700 text-gray-300 text-xs">Cancel</button>
            </div>
          </div>
        )}

        {/* Collections Queue */}
        {collections.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-orange-700/30 rounded-lg p-3">
            <div className="text-xs font-bold text-orange-400 uppercase mb-3">Collections Queue ({collections.length})</div>
            <div className="space-y-2">
              {collections.slice(0, 8).map(l => {
                const meta = getServicePaymentMeta(l)
                return (
                  <div key={l.id} className="bg-[var(--bg-input)] rounded p-2 flex items-center justify-between text-[10px]">
                    <div className="flex-1">
                      <div className="font-semibold text-gray-200">{l.customer}</div>
                      <div className="text-gray-500">{l.address} · {l.date}</div>
                      <div className="font-mono text-orange-400 text-xs mt-0.5">{fmt(meta.remaining)} balance due</div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => quickSetSvcPayment(l.id, 'Y')} className="px-2 py-1 rounded bg-emerald-600 text-white text-[9px]">Mark Paid</button>
                      <button onClick={() => quickSetSvcPayment(l.id, 'P')} className="px-2 py-1 rounded bg-orange-600 text-white text-[9px]">Partial</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Service entries */}
        {sorted.length > 0 ? (
          <div className="space-y-2">
            {(() => {
              const interleaved = showGaps ? interleaveWithGaps(sorted, 'date') : sorted.map(e => ({type: 'entry', data: e}))

              return interleaved.map((item: any) => {
                if (item.type === 'gap') {
                  // Render gap row
                  return (
                    <div
                      key={`gap-${item.startDate}-${item.endDate}`}
                      className="rounded-lg border p-3"
                      style={{
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderStyle: 'dashed',
                        background: 'rgba(31,41,55,0.4)',
                        color: '#d97706'
                      }}
                    >
                      <div className="text-[11px] font-semibold text-center">{item.label}</div>
                    </div>
                  )
                }

                // Render service entry row
                const l = item.data
                const meta = getServicePaymentMeta(l)
                const roll = getServiceRollup(l)

              return (
                <div key={l.id} className="rounded-lg border border-gray-800 bg-[var(--bg-card)] p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-200">{l.customer}</span>
                        <span className="text-[10px] text-gray-500">{l.jtype}</span>
                        <span className="text-[10px] text-gray-500">{l.date}</span>
                        <span
                          className={`text-[9px] px-2 py-0.5 rounded font-bold ${
                            meta.status === 'Y' ? 'bg-emerald-500/20 text-emerald-400' :
                            meta.status === 'P' ? 'bg-orange-500/20 text-orange-400' :
                            'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {meta.status === 'Y' ? 'Paid' : meta.status === 'P' ? 'Partial' : 'Unpaid'}
                        </span>
                      </div>
                      {l.address && <div className="text-[10px] text-gray-500 mt-1">{l.address}</div>}
                      {l.notes && <div className="text-[10px] text-gray-500 mt-1">{l.notes}</div>}
                      {/* Mini breakdown strip */}
                      {roll.totalBillable > 0 && (
                        <div style={{ marginTop: '6px' }}>
                          <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', gap: '1px', maxWidth: '200px' }}>
                            {roll.baseActual > 0 && <div style={{ flex: roll.baseActual / roll.totalBillable, backgroundColor: '#f97316', minWidth: '2px' }} title={`Base cost: ${fmt(roll.baseActual)}`} />}
                            {roll.totalAddedCost > 0 && <div style={{ flex: roll.totalAddedCost / roll.totalBillable, backgroundColor: '#ef4444', minWidth: '2px' }} title={`Added cost: ${fmt(roll.totalAddedCost)}`} />}
                            {roll.projectedProfit > 0 && <div style={{ flex: roll.projectedProfit / roll.totalBillable, backgroundColor: '#10b981', minWidth: '2px' }} title={`Profit: ${fmt(roll.projectedProfit)}`} />}
                          </div>
                          <div style={{ fontSize: '8px', color: 'var(--t3)', marginTop: '2px', display: 'flex', gap: '6px' }}>
                            <span style={{ color: '#f97316' }}>Cost</span>
                            {roll.totalAddedCost > 0 && <span style={{ color: '#ef4444' }}>Adders</span>}
                            <span style={{ color: '#10b981' }}>Profit</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="text-right text-[10px]" style={{ minWidth: '100px' }}>
                      <div className="font-mono text-gray-300">{num(l.hrs)}h · {num(l.miles)}mi</div>
                      <div className="font-mono text-orange-400">{fmt(num(l.mat))} mat</div>
                      {/* Large profit number */}
                      <div style={{ color: roll.projectedProfit >= 0 ? '#10b981' : '#ef4444', fontFamily: 'monospace', fontWeight: 800, fontSize: '16px', lineHeight: '1.2', marginTop: '4px' }}>
                        {fmt(roll.projectedProfit)}
                      </div>
                      <div style={{ fontSize: '8px', color: 'var(--t3)' }}>projected</div>
                    </div>
                  </div>

                  {/* Ledger rollup */}
                  <div className="bg-[var(--bg-input)] rounded px-2 py-1.5 text-[9px] space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Base Quote:</span>
                      <span className="font-mono text-gray-300">{fmt(roll.baseQuoted)}</span>
                    </div>
                    {roll.addIncome > 0.009 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">+ Added Income:</span>
                        <span className="font-mono text-emerald-400">{fmt(roll.addIncome)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-gray-200 border-t border-gray-700 pt-1">
                      <span>Total Billable:</span>
                      <span className="font-mono">{fmt(roll.totalBillable)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Base Cost (mat + labor + miles):</span>
                      <span className="font-mono text-orange-400">{fmt(roll.baseActual)}</span>
                    </div>
                    {roll.addExpense > 0.009 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">+ Added Expense:</span>
                        <span className="font-mono text-orange-400">{fmt(roll.addExpense)}</span>
                      </div>
                    )}
                    {roll.addMileage > 0.009 && (
                      <div className="flex justify-between">
                        <span className="text-gray-500">+ Added Mileage:</span>
                        <span className="font-mono text-orange-400">{fmt(roll.addMileage)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-gray-200 border-t border-gray-700 pt-1">
                      <span>Total Cost:</span>
                      <span className="font-mono">{fmt(roll.totalActual)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Collected:</span>
                      <span className="font-mono text-emerald-400">{fmt(roll.collected)}</span>
                    </div>
                    <div className="flex justify-between font-bold" style={{ color: roll.remaining > 0 ? '#f97316' : '#10b981' }}>
                      <span>Remaining Balance:</span>
                      <span className="font-mono">{fmt(roll.remaining)}</span>
                    </div>
                    <div className="flex justify-between" style={{ color: roll.projectedProfit >= 0 ? '#10b981' : '#ef4444' }}>
                      <span>Projected Margin:</span>
                      <span className="font-mono font-bold">{fmt(roll.projectedProfit)}</span>
                    </div>
                    <div className="flex justify-between" style={{ color: (roll.collected - roll.totalActual) >= 0 ? '#10b981' : '#ef4444' }}>
                      <span>Cash-Real Margin:</span>
                      <span className="font-mono font-bold">{fmt(roll.collected - roll.totalActual)}</span>
                    </div>
                  </div>

                  {/* Action buttons row */}
                  <div className="flex gap-1 flex-wrap">
                    {/* Mark Paid in Full - always visible */}
                    {meta.status !== 'Y' ? (
                      <button onClick={() => quickSetSvcPayment(l.id, 'Y')} className="text-[9px] px-2 py-1 rounded bg-emerald-600 text-white font-bold">✓ Mark Paid in Full</button>
                    ) : (
                      <span className="text-[9px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 font-bold">Paid ✓</span>
                    )}
                    {/* Ledger adjustment buttons - ALWAYS functional */}
                    <button onClick={() => addServiceAdjustment(l.id, 'expense')} className="text-[9px] px-2 py-1 rounded bg-orange-700/50 text-orange-300 hover:bg-orange-600/50">+ Expense</button>
                    <button onClick={() => addServiceAdjustment(l.id, 'mileage')} className="text-[9px] px-2 py-1 rounded bg-orange-700/50 text-orange-300 hover:bg-orange-600/50">+ Mileage</button>
                    <button onClick={() => addServiceAdjustment(l.id, 'income')} className="text-[9px] px-2 py-1 rounded bg-emerald-700/50 text-emerald-300 hover:bg-emerald-600/50">+ Income</button>
                    <button onClick={() => beginSvcEdit(l.id)} className="text-[9px] px-2 py-1 rounded bg-gray-700/50 text-gray-300">Edit</button>
                    <button onClick={() => deleteSvcEntry(l.id)} className="text-[9px] px-2 py-1 rounded bg-gray-700/50 text-gray-400 hover:text-red-400">Delete</button>
                  </div>
                </div>
              )
              })
            })()}
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500 text-sm">No service entries yet.</div>
        )}

        {/* Running totals bar at bottom */}
        {sorted.length > 0 && (() => {
          const totalQuoted = serviceLogs.reduce((s, l) => s + num(l.quoted), 0)
          const totalCollected = serviceLogs.reduce((s, l) => s + num(l.collected), 0)
          const totalProfit = serviceLogs.reduce((s, l) => s + getServiceRollup(l).projectedProfit, 0)
          const totalMat = serviceLogs.reduce((s, l) => s + num(l.mat), 0)
          const totalHrs = serviceLogs.reduce((s, l) => s + num(l.hrs), 0)
          const profitColor = totalProfit >= 0 ? '#10b981' : '#ef4444'
          return (
            <div style={{
              position: 'sticky',
              bottom: 0,
              backgroundColor: '#0f1117',
              borderTop: '2px solid #f97316',
              borderRadius: '0 0 8px 8px',
              padding: '10px 12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginTop: '8px',
            }}>
              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '11px' }}>
                <span style={{ color: 'var(--t3)' }}>{serviceLogs.length} entries</span>
                <span style={{ color: 'var(--t3)' }}>{totalHrs.toFixed(1)}h total</span>
                <span style={{ fontFamily: 'monospace', color: '#f59e0b' }}>{fmt(totalMat)} mat</span>
                <span style={{ fontFamily: 'monospace', color: '#f97316' }}>{fmt(totalQuoted)} quoted</span>
                <span style={{ fontFamily: 'monospace', color: '#10b981' }}>{fmt(totalCollected)} collected</span>
              </div>
              <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '16px', color: profitColor }}>
                {fmt(totalProfit)} profit
              </div>
            </div>
          )
        })()}
      </div>
    )
  }

  // ── Render: Triggers (BLUE TAB) ──────────────────────────────────────────────

  function renderTriggers() {
    const kpis = getKPIs(backup)
    const allProjects = backup.projects || []
    const allSvcLogs = backup.serviceLogs || []

    // Filter trigger rules by selected bucket/job
    const filteredRules = triggerRules.filter(rule => {
      if (triggerBucket === 'all' && triggerJobId === 'all') return true
      // If a specific job is selected, filter by triggersAtSave containing the job
      if (triggerJobId !== 'all') {
        // Rules are global, show all rules but this filter is for context
        return true
      }
      return true
    })

    // Build job dropdown options based on bucket
    const jobOptions = triggerBucket === 'projects'
      ? allProjects.filter(p => p.status === 'active').map(p => ({ id: p.id, name: p.name || 'Unknown' }))
      : triggerBucket === 'service'
        ? allSvcLogs.slice(-20).map(l => ({ id: l.id, name: `${l.customer || 'Unknown'} — ${l.date || ''}` }))
        : []

    const handleAskAI = () => {
      setTriggerAiLoading(true)
      const rulesSummary = filteredRules.map(r => `${r.name} (${r.type}): ${r.situation || ''} → ${r.solution || ''}`).join('\n')
      const bucketLabel = triggerBucket === 'all' ? 'all jobs' : triggerBucket === 'projects' ? 'projects' : 'service calls'
      callClaude({
        system: 'You are NEXUS, the AI operations manager for Power On Solutions, an electrical contractor. Analyze trigger patterns and provide actionable priority recommendations. Be concise.',
        messages: [{ role: 'user', content: `Analyze these ${filteredRules.length} trigger rules for ${bucketLabel}. What are the recurring issues and what should I address first?\n\nRules:\n${rulesSummary}` }],
        max_tokens: 1024,
      }).then(res => {
        setTriggerAiResponse(extractText(res))
      }).catch(() => {
        setTriggerAiResponse('Could not reach AI service. Review your trigger patterns manually — focus on the highest-frequency rules first.')
      }).finally(() => setTriggerAiLoading(false))
    }

    return (
      <div className="space-y-4">
        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-lg p-3 text-center">
            <div className="text-[9px] text-gray-500 uppercase font-bold">Total Bucket</div>
            <div className="text-lg font-bold text-blue-400 font-mono mt-1">{fmtK(kpis.pipeline)}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-lg p-3 text-center">
            <div className="text-[9px] text-gray-500 uppercase font-bold">Active Projects</div>
            <div className="text-lg font-bold text-blue-400 font-mono mt-1">{kpis.activeProjects}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-lg p-3 text-center">
            <div className="text-[9px] text-gray-500 uppercase font-bold">Exposure</div>
            <div className="text-lg font-bold text-red-400 font-mono mt-1">{fmtK(kpis.exposure)}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-lg p-3 text-center">
            <div className="text-[9px] text-gray-500 uppercase font-bold">Open Balance (Svc)</div>
            <div className="text-lg font-bold text-orange-400 font-mono mt-1">{fmt(kpis.svcUnbilled)}</div>
          </div>
          <div className="bg-[var(--bg-card)] border border-gray-700 rounded-lg p-3 text-center">
            <div className="text-[9px] text-gray-500 uppercase font-bold">Total Hours</div>
            <div className="text-lg font-bold text-blue-400 font-mono mt-1">{kpis.totalHours.toFixed(0)}</div>
          </div>
        </div>

        {/* Bucket selector tabs + job dropdown + AI buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {(['all', 'projects', 'service'] as const).map(bucket => (
            <button
              key={bucket}
              onClick={() => { setTriggerBucket(bucket); setTriggerJobId('all'); setTriggerAiResponse('') }}
              className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                triggerBucket === bucket
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#232738] text-gray-400 hover:text-gray-200 border border-gray-700'
              }`}
            >
              {bucket === 'all' ? 'All' : bucket === 'projects' ? 'Projects' : 'Service Calls'}
            </button>
          ))}
          {jobOptions.length > 0 && (
            <select
              value={triggerJobId}
              onChange={e => setTriggerJobId(e.target.value)}
              className="bg-[#232738] border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 focus:border-blue-500 outline-none"
            >
              <option value="all">All {triggerBucket === 'projects' ? 'Projects' : 'Service Calls'}</option>
              {jobOptions.map(j => (
                <option key={j.id} value={j.id}>{j.name.substring(0, 40)}</option>
              ))}
            </select>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={handleAskAI}
              disabled={triggerAiLoading}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-purple-600/20 text-purple-400 border border-purple-600/30 hover:bg-purple-600/30 transition-all disabled:opacity-50 flex items-center gap-1"
            >
              <Sparkles size={12} /> {triggerAiLoading ? 'Analyzing...' : 'Ask AI'}
            </button>
          </div>
        </div>

        {/* AI Response */}
        {triggerAiResponse && (
          <div className="bg-purple-900/20 border border-purple-700/40 rounded-lg p-4 text-xs text-purple-200 leading-relaxed whitespace-pre-wrap">
            <div className="text-[9px] uppercase font-bold text-purple-400 mb-2">NEXUS Analysis</div>
            {triggerAiResponse}
          </div>
        )}

        {/* Trigger rules */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-gray-400 uppercase">Trigger Rules ({filteredRules.length})</div>
          {filteredRules.length > 0 ? (
            filteredRules.map(rule => (
              <div key={rule.id} className="bg-[var(--bg-card)] border border-gray-700 rounded-lg p-3" style={{ borderLeft: `3px solid ${rule.color || '#f97316'}` }}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-bold text-gray-200">{rule.name}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{rule.type} · threshold {pct(Math.round(num(rule.threshold) * 100))}</div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rule.active || false}
                      onChange={e => toggleTrigger(rule.id, e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-[9px] text-gray-400">{rule.active ? 'Active' : 'Inactive'}</span>
                  </label>
                </div>
                {rule.situation && (
                  <div className="text-[9px] text-gray-400 mb-1">
                    <span className="font-bold">Situation:</span> {rule.situation}
                  </div>
                )}
                {rule.solution && (
                  <div className="text-[9px] text-gray-400 mb-1">
                    <span className="font-bold">Solution:</span> {rule.solution}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">No trigger rules configured.</div>
          )}
        </div>
      </div>
    )
  }

  // ── Generate AI insights ────────────────────────────────────────────────────

  const generateFieldLogInsights = (): Insight[] => {
    const insights: Insight[] = []
    const today_str = today()
    const backup = getBackupData()
    if (!backup) return insights

    const todayLogs = (backup.logs || []).filter(l => l.date === today_str)
    const todayHours = todayLogs.reduce((s, l) => s + num(l.hrs), 0)
    const dailyTarget = num(backup.settings?.dailyTarget || 8)

    // Check if daily target is met
    if (todayHours > 0 && todayHours < dailyTarget) {
      const remaining = (dailyTarget - todayHours).toFixed(1)
      insights.push({
        icon: '📊',
        text: `${remaining} hours needed to hit daily target of ${dailyTarget}h.`,
        severity: 'info',
      })
    } else if (todayHours >= dailyTarget) {
      insights.push({
        icon: '✓',
        text: `Daily target met: ${todayHours.toFixed(1)}h logged.`,
        severity: 'success',
      })
    }

    // Check service calls for negative profit
    const todaySvc = (backup.serviceLogs || []).filter(l => l.date === today_str)
    const negativeProfit = todaySvc.filter(l => {
      const quoted = num(l.quoted || 0)
      const mat = num(l.mat || 0)
      const hrs = num(l.hrs || 0)
      const miles = num(l.miles || 0)
      const costRate = num(backup.settings?.opCost || 42.45)
      const mileRate = num(backup.settings?.mileRate || 0.66)
      const totalCost = mat + (miles * mileRate) + (hrs * costRate)
      return quoted - totalCost < 0
    })
    if (negativeProfit.length > 0) {
      insights.push({
        icon: '⚠️',
        text: `${negativeProfit.length} service call(s) have negative projected profit. Review pricing.`,
        severity: 'warning',
      })
    }

    // Hours vs typical day
    if (todayHours > 0 && todayHours > dailyTarget * 1.2) {
      insights.push({
        icon: 'ℹ️',
        text: `Heavy day: ${todayHours.toFixed(1)}h logged. Ensure crew fatigue is managed.`,
        severity: 'info',
      })
    }

    if (insights.length === 0) {
      insights.push({
        icon: '✓',
        text: 'No issues detected. Logs looking good.',
        severity: 'success',
      })
    }

    return insights
  }

  // ── Main layout ────────────────────────────────────────────────────────────

  // Calculate week stats (from both project logs and service logs)
  const getISOWeekStart = () => {
    const d = new Date()
    const day = d.getDay() || 7
    d.setDate(d.getDate() - day + 1)
    return d.toISOString().slice(0, 10)
  }
  const weekStart = getISOWeekStart()

  // Hours This Week — from project logs only (service logs have different hrs meaning)
  const hoursThisWeek = (backup.logs || [])
    .filter(l => (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.hrs), 0)

  // Revenue This Week — collected from both project logs and service logs
  const revenueThisWeek = (backup.logs || [])
    .filter(l => (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.collected), 0)
    + (backup.serviceLogs || [])
    .filter(l => (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.collected), 0)

  // Mat Cost This Week — from both
  const matThisWeek = (backup.logs || [])
    .filter(l => (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.mat), 0)
    + (backup.serviceLogs || [])
    .filter(l => (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.mat), 0)

  // Net This Week
  const costRate = num(backup.settings?.opCost || 42.45)
  const laborCostThisWeek = hoursThisWeek * costRate
  const mileCostThisWeek = (backup.logs || [])
    .filter(l => (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.miles) * mileRate, 0)
  const netThisWeek = revenueThisWeek - matThisWeek - laborCostThisWeek - mileCostThisWeek

  return (
    <div className="w-full bg-[var(--bg-secondary)] rounded-xl border border-gray-800 overflow-hidden">
      {/* Stats bar — always visible */}
      <div className="bg-[var(--bg-card)] border-b border-gray-700 p-3">
        <div className="grid grid-cols-4 gap-4 text-center">
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold">Hours This Week</div>
            <div className="text-sm font-bold text-emerald-400">{hoursThisWeek.toFixed(1)}h</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold">Revenue This Week</div>
            <div className="text-sm font-bold text-blue-400">{fmt(revenueThisWeek)}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold">Mat Cost This Week</div>
            <div className="text-sm font-bold text-orange-400">{fmt(matThisWeek)}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold">Net This Week</div>
            <div className={`text-sm font-bold ${netThisWeek >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt(netThisWeek)}</div>
          </div>
        </div>
      </div>

      {/* Tab headers */}
      <div className="flex border-b border-gray-800 bg-[var(--bg-primary)] items-center">
        {[
          { key: 'proj', label: 'Project Log', icon: '📊' },
          { key: 'svc', label: 'Service Log', icon: '🔧' },
          { key: 'triggers', label: 'Triggers', icon: '⚡' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className="flex-1 px-4 py-3 text-sm font-semibold transition-all uppercase tracking-wide border-b-2"
            style={{
              ...tabStyle(tab.key),
              borderBottomColor: activeTab === tab.key ? tabStyle(tab.key).background : 'transparent'
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
        <div className="ml-auto pr-4">
          <AskAIButton onClick={() => setAiOpen(true)} />
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'proj' && renderProjectLogs()}
        {activeTab === 'svc' && renderServiceLogs()}
        {activeTab === 'triggers' && renderTriggers()}
      </div>

      {/* QuickBooks PDF Import Modal */}
      {showQBImport && (
        <QuickBooksImportModal
          mode="service"
          onClose={() => setShowQBImport(false)}
          onImported={() => { forceUpdate() }}
        />
      )}

      <AskAIPanel
        panelName="Field Log"
        insights={generateFieldLogInsights()}
        dataContext={{
          projectCount: projects.length,
          totalFieldLogs: logs.length,
          totalServiceLogs: serviceLogs.length,
          recentLogs: logs.slice(-10).map(l => ({
            date: l.date, projectId: l.projectId, hrs: l.hrs, miles: l.miles, mat: l.mat, notes: l.notes,
          })),
          recentServiceLogs: serviceLogs.slice(-10).map(s => ({
            date: s.date, customer: s.customer, jtype: s.jtype, quoted: s.quoted,
            collected: s.collected, payStatus: s.payStatus, balanceDue: s.balanceDue,
          })),
          triggerRuleCount: triggerRules.length,
          dayTarget,
          employeeCount: employees.length,
        }}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}

// ── Profit Preview Component ─────────────────────────────────────────────────

function ProfitPreview({
  quoted, mat, hrs, miles, dayTarget, mileRate, opCost
}: {
  quoted: number; mat: number; hrs: number; miles: number
  dayTarget: number; mileRate: number; opCost: number
}) {
  const costRate = opCost || 42.45
  const mileCostRate = mileRate || 0.66
  const mileCost = miles * mileCostRate
  const laborCost = hrs * costRate
  const totalCost = mat + mileCost + laborCost
  const projectedProfit = quoted - totalCost

  // Color code: green if profit > 0, yellow if profit > 0 but margin < 20%, red if profit < 0
  let color = '#ef4444' // red for negative
  if (projectedProfit > 0) {
    const margin = dayTarget > 0 ? (projectedProfit / dayTarget) : 0
    color = margin >= 0.2 ? '#10b981' : '#f59e0b' // green if margin >= 20%, yellow otherwise
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      {/* Large profit number */}
      <div style={{ textAlign: 'center', minWidth: '120px' }}>
        <div style={{ fontSize: '28px', fontWeight: '800', fontFamily: 'monospace', color, lineHeight: '1.1' }}>
          {fmt(projectedProfit)}
        </div>
        <div style={{ fontSize: '9px', color: 'var(--t3)', fontWeight: '600', textTransform: 'uppercase', marginTop: '2px' }}>
          Projected Profit
        </div>
      </div>
      {/* Breakdown strip */}
      <div style={{ flex: 1 }}>
        {quoted > 0 && (
          <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', marginBottom: '6px', gap: '1px' }}>
            {laborCost > 0 && <div style={{ flex: laborCost / quoted, backgroundColor: '#3b82f6', minWidth: '2px' }} title={`Labor: ${fmt(laborCost)}`} />}
            {mat > 0 && <div style={{ flex: mat / quoted, backgroundColor: '#f59e0b', minWidth: '2px' }} title={`Material: ${fmt(mat)}`} />}
            {mileCost > 0 && <div style={{ flex: mileCost / quoted, backgroundColor: '#06b6d4', minWidth: '2px' }} title={`Mileage: ${fmt(mileCost)}`} />}
            {projectedProfit > 0 && <div style={{ flex: projectedProfit / quoted, backgroundColor: '#10b981', minWidth: '2px' }} title={`Profit: ${fmt(projectedProfit)}`} />}
          </div>
        )}
        <div style={{ fontSize: '9px', color: 'var(--t3)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span>Labor {fmt(laborCost)}</span>
          <span>Mat {fmt(mat)}</span>
          <span>Miles {fmt(mileCost)}</span>
          <span style={{ color }}>
            {dayTarget > 0 ? pct(Math.round((projectedProfit / dayTarget) * 100)) : '0%'} of target
          </span>
        </div>
      </div>
    </div>
  )
}
