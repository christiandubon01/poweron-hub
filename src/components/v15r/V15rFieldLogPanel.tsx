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

import { useState, useCallback, useMemo, lazy, Suspense, useEffect } from 'react'
import { Plus, Edit3, Trash2, Zap, Filter, Sparkles, TrendingUp, AlertCircle, FileText, Archive, Timer, Boxes, Route, CircleDollarSign, X, ClipboardList } from 'lucide-react'
import {
  getBackupData,
  saveBackupData,
  saveBackupDataAndSync,
  fetchLatestRemoteBackup,
  saveBackupWithRemoteBaselineSync,
  getLiveProjectLogs,
  loadFromSupabase,
  num,
  fmt,
  fmtK,
  resolveCanonicalCustomerName,
  pct,
  daysSince,
  buildProjectLogRollup,
  getKPIs,
  projectLogsFor,
  getProjectFinancials,
  isActiveProject,
  isActiveServiceCall,
  type BackupData,
  type BackupLog,
  type BackupServiceLog,
  type BackupProject,
  type BackupTriggerRule,
} from '@/services/backupDataService'
import { mergeProjectLogsIntoRemote, createLogTombstone, isDeadProjectLog } from '@/services/projectScopeMerge'
import { getLiveEmployees } from '@/services/teamScopeMerge'
import {
  mergeServiceLogsIntoRemote,
  ensureServiceLogIdentity,
  createServiceLogTombstone,
  isDeletedOrArchivedServiceLog,
  mergeServiceCallsScopeIntoRemote,
  ensureServiceEstimateIdentity,
  createServiceEstimateTombstone,
  ensureActiveServiceCallIdentity,
  createActiveServiceCallTombstone,
} from '@/services/serviceScopeMerge'
import { pushState } from '@/services/undoRedoService'
import { callClaude, extractText } from '@/services/claudeProxy'
import { processSkillSignals } from '@/services/skillSignalExtractor'
import QuickBooksImportModal from './QuickBooksImportModal'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import VoiceMaterialCapture from './VoiceMaterialCapture'
import { useAuth } from '@/hooks/useAuth'
import { linkEntityToAccount, upsertRelationshipEvent } from '@/services/relationshipAccountService'
// BUG 3 FIX — Canonical project financials (remaining_balance = quote − costs)
import { calculateProjectFinancials, calculatePortfolioFinancials, INTERNAL_LABOR_RATE, VAN_MILE_RATE } from '@/utils/calculateProjectFinancials'
import { PortalStatusControls } from '@/components/portal/PortalStatusControls'
// SERVICE-LOG-1 — one canonical quote/profit formula path for New, Edit and View.
import {
  computeServiceQuote,
  formatQuoteVariance,
  quoteVarianceTone,
  resolveTotalQuoted,
  isManuallyQuoted,
  round2,
} from '@/features/service-quote/serviceQuoteMath'
// COST-1.5A — pricing-rate settings resolver. A missing required rate produces a
// visible block, never a silently invented number.
import {
  resolveRequiredServiceRates,
  resolveRateField,
  RATE_FIELD_POLICY,
  type MissingRate,
} from '@/features/service-quote/serviceRateSettings'
import {
  addAssignment,
  assignedProfileIds,
  assignmentKey,
  buildAssignableEmployeeOptions,
  hydrateAssignmentIdentities,
  normalizeAssignments,
  removeAssignment,
  summarizeAssignments,
  type AssignedEmployee,
} from '@/features/service-quote/serviceAssignments'
import {
  TOTAL_QUOTED_STEP,
  reconcileServicePayment,
  roundUpToQuoteStep,
  snapToQuoteStep,
} from '@/features/service-quote/servicePaymentStatus'
import {
  syncServiceCallAssignments,
} from '@/services/serviceCallAssignmentService'
// SERVICE-COST-3B — crew-aware labor and overhead recovery.
import {
  buildCostSnapshot,
  computeCrewQuote,
  quoteFromCostSnapshot,
  resolveCostedCrew,
  validateCrewForCosting,
  type CrewCostSnapshot,
  type CrewQuoteBreakdown,
} from '@/features/service-quote/crewCosting'
import { calculateOverheadMetrics } from '@/utils/costSourceHelper'
import { getActiveEmployeeProfiles } from '@/services/adminTimecardService'

// ── Constants ────────────────────────────────────────────────────────────────

const PHASES = ['Rough-in', 'Trim', 'Demo', 'Underground', 'Finish', 'Material Run', 'Planning', 'Inspection']
const JOB_TYPES = ['GFCI / Receptacles', 'Panel / Service', 'Troubleshoot', 'Lighting', 'EV Charger', 'Low Voltage', 'Circuit Add/Replace', 'Switches / Dimmers', 'Warranty', 'Other']
const REL_ACCOUNT_TYPES = ['General Contractor', 'Subcontractor', 'Homeowner', 'Property Manager', 'Commercial Client', 'Service Customer', 'Other']
const FIELD_LOG_HIDE_GAPS_KEY = 'poweron:v15r:fieldLogHideGaps'

function today() {
  return new Date().toISOString().slice(0, 10)
}

function isArchivedRecord(record: any): boolean {
  return !!(record && (record.archived === true || record.isArchived === true || record.archivedAt))
}

/** Resolve a saved adjustment description for display (render-only). */
function getAdjustmentDescription(adj: any): string {
  for (const field of ['description', 'desc', 'note', 'notes', 'memo', 'label', 'title']) {
    const text = String(adj?.[field] ?? '').trim()
    if (text) return text
  }
  return ''
}

function getAdjustmentTypeLabel(adj: any): 'Income' | 'Mileage' | 'Expense' {
  if (adj?.type === 'income') return 'Income'
  if (adj?.type === 'mileage' || adj?.category === 'mileage') return 'Mileage'
  return 'Expense'
}

// ── Service balance & rollup ─────────────────────────────────────────────────

/**
 * SERVICE-LOG-1 polish — settings read cache (UI performance only).
 *
 * getServiceRollup() runs for every service row on every render, and each call
 * used to do a full localStorage read + JSON.parse of the ENTIRE backup blob
 * just to read two numbers. serviceBalanceDue() and getServicePaymentMeta()
 * each call it again, so one render of N rows meant ~3N whole-backup parses.
 * That is what made typing inside the Service Log modals feel laggy.
 *
 * Identical values, read once per data change instead of once per row. The
 * cache is cleared by the same 'storage' / 'poweron-data-saved' events every
 * save path in this file already dispatches, plus a short TTL so a missed
 * invalidation can never leave stale rates on screen. No math changes.
 */
const SERVICE_RATE_CACHE_TTL_MS = 250
let _serviceRateCache: { opCost: number; mileRate: number; ratesMissing: MissingRate[] } | null = null
let _serviceRateCacheAt = 0

export function __resetServiceRateCache() {
  _serviceRateCache = null
  _serviceRateCacheAt = 0
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', __resetServiceRateCache)
  window.addEventListener('poweron-data-saved', __resetServiceRateCache)
}

function readServiceRateSettings(): { opCost: number; mileRate: number; ratesMissing: MissingRate[] } {
  const now = Date.now()
  if (_serviceRateCache && now - _serviceRateCacheAt < SERVICE_RATE_CACHE_TTL_MS) {
    return _serviceRateCache
  }
  let settings: any = {}
  try {
    const bd = getBackupData() || {}
    settings = bd.settings || {}
  } catch { /* fall through — missing values are surfaced, never invented */ }
  // COST-1.5A: no silent default. A missing opCost (or a degenerate $0/hr) and an
  // unset mileRate are reported so the ledger can show "Profit unavailable"
  // instead of a number computed from an invented rate.
  const opCostField = resolveRateField('opCost', settings.opCost)
  const mileRateField = resolveRateField('mileRate', settings.mileRate)
  const ratesMissing: MissingRate[] = []
  if (!opCostField.present) {
    const p = RATE_FIELD_POLICY.opCost
    ratesMissing.push({ key: p.key, label: p.label, remedy: p.remedy })
  }
  if (!mileRateField.present) {
    const p = RATE_FIELD_POLICY.mileRate
    ratesMissing.push({ key: p.key, label: p.label, remedy: p.remedy })
  }
  _serviceRateCache = {
    opCost: opCostField.value,
    mileRate: mileRateField.value,
    ratesMissing,
  }
  _serviceRateCacheAt = now
  return _serviceRateCache
}

function getServiceRollup(l: any): any {
  const adjustments = (Array.isArray(l.adjustments) ? l.adjustments : [])
  const addIncome = adjustments.filter((a: any) => a && a.type === 'income').reduce((s: number, a: any) => s + num(a.amount), 0)
  const addExpense = adjustments.filter((a: any) => a && a.type === 'expense' && (a.category || 'expense') !== 'mileage').reduce((s: number, a: any) => s + num(a.amount), 0)
  const addMileage = adjustments.filter((a: any) => a && ((a.type === 'mileage') || (a.type === 'expense' && (a.category || '') === 'mileage'))).reduce((s: number, a: any) => s + num(a.amount), 0)
  const totalAddedCost = addExpense + addMileage
  const baseQuoted = num(l?.quoted)
  const totalBillable = baseQuoted + addIncome

  // Read current Settings from the tenant-aware backup — stored l.opCost / l.mileCost are unreliable
  // (persist() bug corrupted those values historically; compute from raw hrs/miles instead).
  // Cached per data change rather than per row — see readServiceRateSettings().
  const { opCost, mileRate, ratesMissing } = readServiceRateSettings()

  const hrs = num(l?.hrs)
  const miles = num(l?.miles)
  const matCost = num(l?.mat)
  const laborCost = hrs * opCost
  const mileCost = miles * mileRate
  const baseActual = matCost + mileCost + laborCost

  const totalActual = baseActual + totalAddedCost
  const collected = num(l?.collected)
  const remaining = Math.max(0, totalBillable - collected)
  const projectedProfit = totalBillable - totalActual  // kept name for back-compat — this is ACTUAL profit

  // Estimated profit: cost using quoted hrs (mat + miles treated as actual — they are what they are)
  const estHrs = num(l?.estHrs) || hrs
  const estLaborCost = estHrs * opCost
  const estBaseCost = matCost + mileCost + estLaborCost
  const estimatedTotalCost = estBaseCost + totalAddedCost
  const estimatedProfit = totalBillable - estimatedTotalCost
  const hasEstimate = num(l?.estHrs) > 0 && num(l?.estHrs) !== hrs  // delta exists

  return {
    baseQuoted, addIncome, addExpense, addMileage, totalAddedCost, totalBillable,
    baseActual, totalActual, collected, remaining, projectedProfit, adjustments,
    hrs, miles, matCost, laborCost, mileCost, opCost, mileRate, ratesMissing,
    estHrs, estLaborCost, estBaseCost, estimatedTotalCost, estimatedProfit, hasEstimate
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

/** Spec: Balance color coding based on % of contract remaining */
function getBalanceColor(balance: number, contract: number): string {
  if (balance < 0) return '#ef4444' // red: negative
  if (contract <= 0) return '#10b981' // green fallback when no contract set
  const pctLeft = balance / contract
  if (pctLeft > 0.20) return '#10b981'  // green: > 20% remaining
  if (pctLeft > 0.10) return '#f59e0b'  // yellow: 10–20% remaining
  return '#f97316'                       // orange: < 10% remaining
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

function getTriggerRuleDetail(backup: BackupData, rule: BackupTriggerRule, data: any): any {
  const dailyTarget = num((backup.settings && backup.settings.dayTarget) || 361)
  const thresholdRatio = num(rule.threshold)
  const quoted = num(data.quoted)
  const type = String(rule.type || '').trim()
  let currentValue = 0
  let thresholdValue = 0
  let comparison = ''
  let factorLabel = 'Value'
  let thresholdLabel = rule.thresholdLabel || 'Threshold'
  let unit: 'money' | 'percent' | 'number' = 'number'
  let hit = false
  let why = 'Rule type is not mapped to a measurable trigger factor yet.'

  if (type === 'bad_day') {
    currentValue = num(data.profit)
    thresholdValue = dailyTarget * thresholdRatio
    comparison = '<'
    factorLabel = 'Profit'
    thresholdLabel = 'Maximum profit before flag'
    unit = 'money'
    hit = currentValue < thresholdValue
    why = hit
      ? `Profit is below the configured bad-day threshold.`
      : `Profit is at or above the bad-day threshold.`
  } else if (type === 'good_day') {
    currentValue = num(data.profit)
    thresholdValue = dailyTarget * thresholdRatio
    comparison = '>='
    factorLabel = 'Profit'
    thresholdLabel = 'Minimum profit target'
    unit = 'money'
    hit = currentValue >= thresholdValue
    why = hit
      ? `Profit meets or beats the configured good-day target.`
      : `Profit is below the configured good-day target.`
  } else if (type === 'travel') {
    currentValue = quoted > 0 ? num(data.mileCost) / quoted : 0
    thresholdValue = thresholdRatio
    comparison = '>'
    factorLabel = 'Mileage cost %'
    thresholdLabel = 'Maximum mileage share'
    unit = 'percent'
    hit = quoted > 0 && currentValue > thresholdValue
    why = quoted <= 0
      ? `No billable/contract value is available, so mileage share cannot be evaluated.`
      : hit
        ? `Mileage cost share is above the configured maximum.`
        : `Mileage cost share is within the configured maximum.`
  } else if (type === 'material') {
    currentValue = quoted > 0 ? num(data.mat) / quoted : 0
    thresholdValue = thresholdRatio
    comparison = '>'
    factorLabel = 'Materials %'
    thresholdLabel = 'Maximum material share'
    unit = 'percent'
    hit = quoted > 0 && currentValue > thresholdValue
    why = quoted <= 0
      ? `No billable/contract value is available, so material share cannot be evaluated.`
      : hit
        ? `Material cost share is above the configured maximum.`
        : `Material cost share is within the configured maximum.`
  }

  return {
    rule,
    active: rule.active !== false,
    hit: rule.active !== false && hit,
    needsAttention: rule.active !== false && hit && type !== 'good_day',
    rawHit: hit,
    currentValue,
    thresholdValue,
    thresholdRatio,
    comparison,
    factorLabel,
    thresholdLabel,
    unit,
    why,
  }
}

function formatTriggerFactorValue(detail: any): string {
  if (detail.unit === 'money') return fmt(detail.currentValue)
  if (detail.unit === 'percent') return pct(Math.round(num(detail.currentValue) * 100))
  return String(detail.currentValue)
}

function formatTriggerThresholdValue(detail: any): string {
  if (detail.unit === 'money') return fmt(detail.thresholdValue)
  if (detail.unit === 'percent') return pct(Math.round(num(detail.thresholdValue) * 100))
  return String(detail.thresholdValue)
}

function triggerThresholdInputMeta(ruleType: string, threshold: any, dayTarget: number): any {
  const type = String(ruleType || '').trim()
  const ratio = num(threshold)
  if (type === 'bad_day') {
    return {
      mode: 'money',
      label: 'Maximum profit before flag',
      helper: 'Flags when Profit is below this amount. Saved as a ratio of the daily target.',
      value: Math.round(dayTarget * ratio),
      min: -1000,
      max: Math.max(1000, Math.round(dayTarget * 3)),
      step: 25,
    }
  }
  if (type === 'good_day') {
    return {
      mode: 'money',
      label: 'Minimum profit target',
      helper: 'Fires when Profit is at or above this amount. Saved as a ratio of the daily target.',
      value: Math.round(dayTarget * ratio),
      min: 0,
      max: Math.max(1000, Math.round(dayTarget * 4)),
      step: 25,
    }
  }
  if (type === 'travel') {
    return {
      mode: 'percent',
      label: 'Maximum mileage share',
      helper: 'Flags when Mileage Cost is above this percent of Total Billable / Contract.',
      value: Math.round(ratio * 100),
      min: 0,
      max: 100,
      step: 1,
    }
  }
  if (type === 'material') {
    return {
      mode: 'percent',
      label: 'Maximum material share',
      helper: 'Flags when Materials are above this percent of Total Billable / Contract.',
      value: Math.round(ratio * 100),
      min: 0,
      max: 100,
      step: 1,
    }
  }
  return {
    mode: 'number',
    label: 'Threshold',
    helper: 'Raw threshold value stored on this rule.',
    value: ratio,
    min: 0,
    max: 1,
    step: 0.01,
  }
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

export default function V15rFieldLogPanel({ serviceCallPrefill, onPrefillUsed }: { serviceCallPrefill?: { customer: string; address: string; notes: string; leadId?: string } | null; onPrefillUsed?: () => void } = {}) {
  const { isDemoMode, hasHydrated } = useDemoMode()
  let authProfile: any = null
  try { authProfile = useAuth().profile } catch { /* auth not available */ }
  const [, setTick] = useState(0)
  const forceUpdate = useCallback(() => setTick(t => t + 1), [])
  const [activeTab, setActiveTab] = useState<'proj' | 'svc' | 'triggers'>(() => {
    try {
      if (localStorage.getItem('poweron_svc_prefill')) return 'svc'
    } catch {}
    return 'proj'
  })
  const [projFilter, setProjFilter] = useState('all')
  const [svcFilter, setSvcFilter] = useState('all')
  const [showGaps, setShowGaps] = useState(() => {
    try {
      return localStorage.getItem(FIELD_LOG_HIDE_GAPS_KEY) !== 'true'
    } catch {
      return true
    }
  })
  const [showProjForm, setShowProjForm] = useState(false)
  const [showSvcForm, setShowSvcForm] = useState(false)
  const [editLogId, setEditLogId] = useState<string | null>(null)
  const [editSvcId, setEditSvcId] = useState<string | null>(null)
  const [showQBImport, setShowQBImport] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiProfitAnalysis, setAiProfitAnalysis] = useState<string | null>(null)
  const [aiProfitLoading, setAiProfitLoading] = useState(false)
  function toggleShowGaps() {
    const next = !showGaps
    setShowGaps(next)
    try {
      localStorage.setItem(FIELD_LOG_HIDE_GAPS_KEY, String(!next))
    } catch {}
  }

  // Trigger bucket selector state
  const [triggerBucket, setTriggerBucket] = useState<'all' | 'projects' | 'service'>('all')
  const [triggerJobId, setTriggerJobId] = useState<string>('all')
  const [triggerAiResponse, setTriggerAiResponse] = useState<string>('')
  const [triggerAiLoading, setTriggerAiLoading] = useState(false)
  const [editingTriggerRuleId, setEditingTriggerRuleId] = useState<string | null>(null)
  const [triggerRuleForm, setTriggerRuleForm] = useState<Partial<BackupTriggerRule> | null>(null)

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
  const [slAccountId, setSlAccountId] = useState('')
  const [slAddr, setSlAddr] = useState('')
  const [slDate, setSlDate] = useState(today())
  const [slHrs, setSlHrs] = useState('')
  const [slEstHrs, setSlEstHrs] = useState('')
  const [slMi, setSlMi] = useState('')
  // slQuoted IS Total Quoted — the actual amount quoted to the customer. It keeps
  // writing the existing serviceLogs[].quoted field, so collections, balances and
  // revenue are unchanged. Suggested Quote is derived, never stored as the total.
  const [slQuoted, setSlQuoted] = useState('')
  const [slBillRate, setSlBillRate] = useState('')
  const [slQuotedManual, setSlQuotedManual] = useState(false)
  const [slAssignments, setSlAssignments] = useState<AssignedEmployee[]>([])
  const [slCostingSource, setSlCostingSource] = useState<'assigned' | 'pricing'>('assigned')
  const [slPricingCrewIds, setSlPricingCrewIds] = useState<string[]>([])
  // SERVICE-COST-3B: legacy/crew/frozen mode gates snapshot creation and recalculation.
  const [slCostingMode, setSlCostingMode] = useState<'legacy' | 'crew' | 'frozen'>('crew')
  const [slFrozenSnapshot, setSlFrozenSnapshot] = useState<CrewCostSnapshot | null>(null)
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
  const [portalLeadId, setPortalLeadId] = useState<string | null>(null)
  const [estCust, setEstCust] = useState('')
  const [estAccountId, setEstAccountId] = useState('')
  const [estCustEdited, setEstCustEdited] = useState(false)
  const [estAddr, setEstAddr] = useState('')
  const [estDate, setEstDate] = useState(today())
  const [estJobType, setEstJobType] = useState(JOB_TYPES[0])
  const [estHours, setEstHours] = useState('')
  const [estBillRate, setEstBillRate] = useState('')
  const [estMaterials, setEstMaterials] = useState('')
  const [estMiles, setEstMiles] = useState('')
  const [estNotes, setEstNotes] = useState('')
  // Total Quoted for estimates keeps writing serviceEstimates[].totalQuote.
  const [estTotalQuoted, setEstTotalQuoted] = useState('')
  const [estQuotedManual, setEstQuotedManual] = useState(false)
  const [estAssignments, setEstAssignments] = useState<AssignedEmployee[]>([])
  const [estCostingSource, setEstCostingSource] = useState<'assigned' | 'pricing'>('assigned')
  const [estPricingCrewIds, setEstPricingCrewIds] = useState<string[]>([])
  // SERVICE-COST-3B: legacy/crew/frozen mode gates snapshot creation and recalculation.
  const [estCostingMode, setEstCostingMode] = useState<'legacy' | 'crew' | 'frozen'>('crew')
  const [estFrozenSnapshot, setEstFrozenSnapshot] = useState<CrewCostSnapshot | null>(null)
  // Portal identities (employee_profiles) for the Assigned Employees picker.
  const [portalProfiles, setPortalProfiles] = useState<any[]>([])
  const [estMatNotes, setEstMatNotes] = useState('')
  const [estReceiptUrl, setEstReceiptUrl] = useState('')
  const [showEstimateNewCustomerModal, setShowEstimateNewCustomerModal] = useState(false)
  const [sourceHighlightId, setSourceHighlightId] = useState<string | null>(null)
  const [newCustomerForm, setNewCustomerForm] = useState({
    company: '',
    contact: '',
    role: 'General Contractor',
    phone: '',
    email: '',
    address: '',
    city: '',
    notes: '',
    tags: '',
  })

  useEffect(() => {
    if (serviceCallPrefill) {
      setActiveTab('svc')
      setEstCust(serviceCallPrefill.customer || '')
      setEstAccountId('')
      setEstCustEdited(false)
      setEstAddr(serviceCallPrefill.address || '')
      setEstNotes(serviceCallPrefill.notes || '')
      setPortalLeadId(serviceCallPrefill.leadId || null)
      setShowEstimateForm(true)
      onPrefillUsed?.()
    }
  }, [serviceCallPrefill])

  useEffect(() => {
    function handleOpenSourceRecord(e: Event) {
      const ev = e as CustomEvent<{ tab?: string; entityType?: string; entityId?: string }>
      const detail = ev.detail || {}
      if (!detail.entityId) return
      const entityType = String(detail.entityType || '')
      if (entityType === 'project') return
      setActiveTab('svc')
      const targetId = String(detail.entityId)
      setSourceHighlightId(targetId)
      setTimeout(() => {
        const selector = entityType === 'service_log'
          ? `[data-service-log-id="${targetId}"]`
          : `[data-service-estimate-id="${targetId}"]`
        const el = document.querySelector(selector) as HTMLElement | null
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 160)
      setTimeout(() => setSourceHighlightId((prev) => (prev === targetId ? null : prev)), 3000)
    }
    window.addEventListener('poweron-open-source-record', handleOpenSourceRecord)
    return () => window.removeEventListener('poweron-open-source-record', handleOpenSourceRecord)
  }, [])

  // ─────────────────────────────────────────────────────────────────────────
  // Mount-load freshness: refetch from Supabase on panel open, window focus,
  // and tab-visibility change. Mirrors the pattern from V15rLeadsPanel.
  // Ensures the Field Log always reflects the latest saved state across
  // devices/tabs instead of stale localStorage.
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (hasHydrated && isDemoMode) return
    let cancelled = false
    let refreshing = false
    const refreshFromLatestSavedState = async (source: string) => {
      if (refreshing) return
      refreshing = true
      try {
        const result = await loadFromSupabase(false)
        if (!cancelled && result.success) {
          console.log(`[FieldLog] Refreshed latest saved state on ${source}`)
          window.dispatchEvent(new Event('storage'))
          window.dispatchEvent(new Event('poweron-data-saved'))
          forceUpdate()
        }
      } catch (err) {
        console.warn(`[FieldLog] latest saved state refresh failed on ${source}`, err)
      } finally {
        refreshing = false
      }
    }
    void refreshFromLatestSavedState('panel-open')
    const handleFocus = () => {
      void refreshFromLatestSavedState('window-focus')
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshFromLatestSavedState('visibility')
      }
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      cancelled = true
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [forceUpdate, hasHydrated, isDemoMode])

  // SERVICE-LOG-1: Escape closes the Service Call modal without saving.
  useEffect(() => {
    if (!showSvcForm) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') resetSvcForm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showSvcForm])

  // SERVICE-LOG-1: canonical portal identities for Assigned Employees. Read-only
  // load; this never creates, invites or links an employee account.
  useEffect(() => {
    if (hasHydrated && isDemoMode) return
    let cancelled = false
    getActiveEmployeeProfiles()
      .then((res) => {
        if (cancelled) return
        setPortalProfiles(res.success && Array.isArray(res.data) ? res.data : [])
      })
      .catch(() => { if (!cancelled) setPortalProfiles([]) })
    return () => { cancelled = true }
  }, [hasHydrated, isDemoMode])

  const [completingEstimateId, setCompletingEstimateId] = useState<string | null>(null)
  const [actualHours, setActualHours] = useState('')
  const [actualMaterials, setActualMaterials] = useState('')
  const [actualMiles, setActualMiles] = useState('')
  const [paymentCollected, setPaymentCollected] = useState('')
  const [paymentStatus, setPaymentStatus] = useState('Unpaid')
  const [completionVariance, setCompletionVariance] = useState<any>(null)
  const [showArchivedServiceReview, setShowArchivedServiceReview] = useState(false)

  const backup = (hasHydrated && isDemoMode) ? getDemoBackupData() : getBackupData()
  if (!backup) {
    return (
      <div className="flex items-center justify-center w-full h-64 bg-[var(--bg-secondary)]">
        <div className="text-gray-500 text-sm">No backup data. Import to view field logs.</div>
      </div>
    )
  }

  const projects = (backup.projects || []).filter(isActiveProject)
  const logs = backup.logs || []
  const serviceLogs = backup.serviceLogs || []
  const gcContacts = backup.gcContacts || []
  const accountOptions = gcContacts.map((gc: any) => ({
    id: String(gc.id || ''),
    label: [gc.company || 'Unnamed', gc.contact ? `(${gc.contact})` : ''].filter(Boolean).join(' ').trim(),
  }))
  const canonicalCustomerName = (record: any): string => {
    return resolveCanonicalCustomerName(record, gcContacts)
  }
  // Full array kept for historical name resolution; liveEmployees drives the
  // employee pickers for new/edited logs (Phase 6S-C: hide deleted/inactive).
  const employees = backup.employees || []
  const liveEmployees = getLiveEmployees(employees)
  const triggerRules = backup.triggerRules || []
  const settings = backup.settings || {} as any
  // COST-1.5A: read the raw setting, never invent a fallback rate. When a value is
  // missing the modal blocks the quote (see estMissingRates / slMissingRates) — a
  // wrong number is never shown. dayTarget is out of this phase's scope.
  const mileRate = num(settings.mileRate)
  const opCost = num(settings.opCost)
  const dayTarget = num(settings.dayTarget || 361)

  function persist() {
    backup._lastSavedAt = new Date().toISOString()
    // Use auto-sync variant — writes localStorage + fire-and-forget Supabase sync
    // The 30s periodic sync handles debouncing so rapid keystrokes don't flood the network
    saveBackupDataAndSync(backup, 'logs')
    // Dispatch event to trigger KPI refresh in Layout
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('poweron-data-saved'))
    forceUpdate()
  }

  /**
   * Phase 6R-A: scoped, delete-safe save for the top-level serviceLogs[] array
   * (and the service payments embedded on those rows). The caller has already
   * mutated backup.serviceLogs (create/edit/payment/adjustment/archive/restore/
   * tombstone) optimistically. We persist locally for instant UI, then fetch the
   * latest remote and patch ONLY serviceLogs[] — logs[], projects[],
   * activeServiceCalls[], serviceEstimates[] and everything else are preserved
   * from remote. Save/stale/baseline internals are untouched (reuses the existing
   * remote-baseline save path, same as project logs / estimate rows).
   */
  async function saveServiceLogsScoped(incomingBackup: BackupData = backup): Promise<boolean> {
    backup._lastSavedAt = new Date().toISOString()
    try {
      saveBackupData(backup)
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') return false
      throw err
    }
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('poweron-data-saved'))
    forceUpdate()
    try {
      const remote = await fetchLatestRemoteBackup()
      if (remote.hasRemoteRow && remote.remoteData) {
        const incoming = getBackupData() || incomingBackup
        const merged = mergeServiceLogsIntoRemote(remote.remoteData, incoming)
        await saveBackupWithRemoteBaselineSync(
          merged,
          { remoteUpdatedAt: remote.remoteUpdatedAt, remoteDataLastSavedAt: remote.remoteDataLastSavedAt },
          { source: 'service-logs-remote-merge', changedKey: 'serviceLogs', _scopes: ['service.calls'] },
        )
        return true
      }
      saveBackupDataAndSync(getBackupData() || incomingBackup, 'serviceLogs', {
        source: 'service.calls', _scopes: ['service.calls'],
      })
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') return false
      console.warn('[ServiceLogs] Scoped serviceLogs sync failed; local changes preserved', err)
      try {
        saveBackupDataAndSync(getBackupData() || incomingBackup, 'serviceLogs', {
          source: 'service.calls', _scopes: ['service.calls'],
        })
      } catch (fallbackErr) {
        if ((fallbackErr as Error)?.name === 'BackupStorageWriteError') return false
        throw fallbackErr
      }
    }
    return true
  }

  function persistServiceLogs(): Promise<boolean> {
    return saveServiceLogsScoped()
  }

  /**
   * Phase 6R-B: scoped, delete-safe save for the whole service.calls scope —
   * serviceLogs[] + serviceEstimates[] + activeServiceCalls[]. The caller has
   * already mutated one or more of those arrays optimistically (create / edit /
   * tombstone / status transition / cross-array move). We persist locally for
   * instant UI, then fetch latest remote and patch ONLY those three arrays via
   * mergeServiceCallsScopeIntoRemote (serviceLogs keeps its 6R-A tombstone+ledger
   * merge). Everything else in BackupData is preserved from remote. Save/stale/
   * baseline internals are untouched (reuses the existing remote-baseline path).
   * Use this for estimate/active-call writers and the mixed move workflows so a
   * single save carries every side atomically.
   */
  async function saveServiceCallsScoped(incomingBackup: BackupData = backup): Promise<boolean> {
    backup._lastSavedAt = new Date().toISOString()
    try {
      saveBackupData(backup)
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') return false
      throw err
    }
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('poweron-data-saved'))
    forceUpdate()
    try {
      const remote = await fetchLatestRemoteBackup()
      if (remote.hasRemoteRow && remote.remoteData) {
        const incoming = getBackupData() || incomingBackup
        const merged = mergeServiceCallsScopeIntoRemote(remote.remoteData, incoming)
        await saveBackupWithRemoteBaselineSync(
          merged,
          { remoteUpdatedAt: remote.remoteUpdatedAt, remoteDataLastSavedAt: remote.remoteDataLastSavedAt },
          { source: 'service-calls-remote-merge', changedKey: 'service.calls', _scopes: ['service.calls'] },
        )
        return true
      }
      saveBackupDataAndSync(getBackupData() || incomingBackup, 'service.calls', {
        source: 'service.calls', _scopes: ['service.calls'],
      })
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') return false
      console.warn('[ServiceCalls] Scoped service.calls sync failed; local changes preserved', err)
      try {
        saveBackupDataAndSync(getBackupData() || incomingBackup, 'service.calls', {
          source: 'service.calls', _scopes: ['service.calls'],
        })
      } catch (fallbackErr) {
        if ((fallbackErr as Error)?.name === 'BackupStorageWriteError') return false
        throw fallbackErr
      }
    }
    return true
  }

  function persistServiceCalls(): Promise<boolean> {
    return saveServiceCallsScoped()
  }

  function makeLogInternalId() {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `log_${crypto.randomUUID()}`
    return `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Phase 6N: scoped, delete-safe save for PROJECT logs only (the top-level
   * logs[] rows, scoped by projId). Service-log CRUD still uses persist().
   * The caller has already mutated backup.logs optimistically. We persist locally
   * for instant UI, then fetch latest remote and patch ONLY the affected project's
   * slice — other projects' logs are preserved from remote. Demo mode keeps the
   * exact prior local-sync behavior (no remote merge). Save/stale/baseline internals
   * are untouched (uses the existing remote-baseline save path).
   */
  async function saveProjectLogsScoped(affectedProjectId: string): Promise<boolean> {
    backup._lastSavedAt = new Date().toISOString()
    if (hasHydrated && isDemoMode) {
      try {
        saveBackupDataAndSync(backup, 'logs')
      } catch (err) {
        if ((err as Error)?.name === 'BackupStorageWriteError') return false
        throw err
      }
      window.dispatchEvent(new Event('storage'))
      window.dispatchEvent(new Event('poweron-data-saved'))
      forceUpdate()
      return true
    }
    try {
      saveBackupData(backup)
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') return false
      throw err
    }
    window.dispatchEvent(new Event('storage'))
    window.dispatchEvent(new Event('poweron-data-saved'))
    forceUpdate()
    try {
      const remote = await fetchLatestRemoteBackup()
      if (remote.hasRemoteRow && remote.remoteData) {
        const incoming = getBackupData() || backup
        const merged = mergeProjectLogsIntoRemote(remote.remoteData, incoming, affectedProjectId)
        await saveBackupWithRemoteBaselineSync(
          merged,
          { remoteUpdatedAt: remote.remoteUpdatedAt, remoteDataLastSavedAt: remote.remoteDataLastSavedAt },
          { source: 'project-logs-remote-merge', changedKey: 'logs', _scopes: ['project.logs', 'project.payments'] },
        )
        return true
      }
      saveBackupDataAndSync(getBackupData() || backup, 'logs', {
        source: 'project.logs', _scopes: ['project.logs', 'project.payments'],
      })
    } catch (err) {
      if ((err as Error)?.name === 'BackupStorageWriteError') return false
      console.warn('[FieldLog] Scoped project-logs sync failed; local changes preserved', err)
      try {
        saveBackupDataAndSync(getBackupData() || backup, 'logs', {
          source: 'project.logs', _scopes: ['project.logs', 'project.payments'],
        })
      } catch (fallbackErr) {
        if ((fallbackErr as Error)?.name === 'BackupStorageWriteError') return false
        throw fallbackErr
      }
    }
    return true
  }

  // ── Service Estimate CRUD (3-step workflow) ──────────────────────────────────

  const serviceEstimates = backup.serviceEstimates || []
  const activeServiceEstimates = serviceEstimates.filter(isActiveServiceCall)
  const rawActiveServiceCalls = backup.activeServiceCalls || []
  // COST-1.5A: no invented fallback. Missing billRate blocks legacy-mode quotes;
  // a real 0% tax is kept (num → 0) and only an UNSET tax blocks (handled by the
  // resolver's per-field zero policy, not here).
  const billRate = num(settings.billRate)
  const taxRate = num(settings.tax)

  // ── SERVICE-LOG-1 shared quote + assignment plumbing ───────────────────────
  // Every quote/profit number in this panel comes from this one helper so New,
  // Edit and the read-only cards can never drift apart.
  const quoteFor = (inputs: any, totalQuotedOverride?: number | null) => computeServiceQuote(
    { mileRate, taxRatePct: taxRate, opCostRate: opCost, ...inputs },
    totalQuotedOverride,
  )

  // SERVICE-COST-3B: canonical overhead recovery rate from Overhead Manager.
  const overheadRecoveryRate = useMemo(() => {
    const metrics = calculateOverheadMetrics(settings.overhead, num(settings.billableHrsYear))
    return metrics.overheadRecoveryRate
  }, [settings.overhead, settings.billableHrsYear])

  /**
   * SERVICE-COST-3B: compute a crew-aware quote breakdown.
   *
   * Uses either the Assigned Field Crew (employees with laborCategory === 'field')
   * or an explicit Pricing Crew. Falls back to the legacy single-rate formula when
   * crew costing cannot be resolved.
   */
  function crewQuoteFor(args: {
    siteHours: number
    materials: number
    miles: number
    totalQuotedOverride?: number | null
    costingSource: 'assigned' | 'pricing'
    assignedEmployees: AssignedEmployee[]
    pricingCrewIds: string[]
    costSnapshot?: CrewCostSnapshot | null
  }): {
    breakdown: CrewQuoteBreakdown | null
    snapshot: CrewCostSnapshot | null
    legacy: boolean
    errors: string[]
  } {
    const totalQuoted = resolveTotalQuotedOverride(args.totalQuotedOverride)
    const costed = resolveCostedCrew(
      args.costingSource,
      args.siteHours,
      liveEmployees,
      args.assignedEmployees,
      args.pricingCrewIds,
    )

    const validation = validateCrewForCosting(costed.crew, overheadRecoveryRate, args.siteHours, costed)
    if (!validation.valid) {
      return { breakdown: null, snapshot: null, legacy: true, errors: validation.errors }
    }

    const breakdown = computeCrewQuote({
      siteHours: args.siteHours,
      crew: costed.crew,
      materialCost: args.materials,
      miles: args.miles,
      mileRate,
      taxRatePct: taxRate,
      overheadRecoveryRate,
      totalQuoted,
      crewSource: args.costingSource,
    })

    return {
      breakdown,
      snapshot: buildCostSnapshot(breakdown),
      legacy: false,
      errors: [],
    }

    function resolveTotalQuotedOverride(override?: number | null): number {
      if (override == null) return 0
      return round2(num(override))
    }
  }

  const assignableEmployeeOptions = buildAssignableEmployeeOptions(
    liveEmployees.map((e: any) => ({ id: String(e.id), name: e.name, email: e.email ?? null })),
    (portalProfiles || []).map((p: any) => ({
      id: String(p.id),
      display_name: p.display_name,
      email: p.email ?? null,
      active: p.active !== false,
      user_id: p.user_id ?? null,
      backup_employee_id: p.backup_employee_id ?? null,
    })),
    { includeOwner: true },
  )

  /** Push the current assignment set for one service record to the Employee Portal. */
  function syncAssignmentsToPortal(record: any, kind: 'service_estimate' | 'service_call', assignments: AssignedEmployee[]) {
    void syncServiceCallAssignments({
      orgId: authProfile?.org_id || null,
      serviceCallId: String(record?.id || ''),
      kind,
      profileIds: assignedProfileIds(assignments),
      record,
    }).then((res) => {
      if (!res.success) console.warn('[V15rFieldLogPanel] service call assignment sync failed', res.error)
    }).catch((err) => console.warn('[V15rFieldLogPanel] service call assignment sync failed', err))
  }
  const serviceWorkflowStatus = (record: any) => String(record?.serviceStatus || record?.estimateStatus || record?.status || '').toLowerCase().trim()
  const archivedServiceReviewEntries = (() => {
    const seen = new Set<string>()
    const rows: any[] = []
    const keyFor = (record: any, source: string) => {
      if (source !== 'service_log') return `estimate:${String(record?.fromEstimateId || record?.id || '')}`
      return `service_log:${String(record?.id || '')}`
    }
    const addRows = (items: any[], source: string, label: string) => {
      items.filter(record => isArchivedRecord(record) && !record?.deletedAt).forEach((record) => {
        const key = keyFor(record, source)
        if (seen.has(key)) return
        seen.add(key)
        rows.push({ source, label, record })
      })
    }
    addRows(serviceEstimates, 'service_estimate', 'Estimate / Call')
    addRows(rawActiveServiceCalls, 'active_call', 'Active Call')
    addRows(serviceLogs, 'service_log', 'Service Log')
    return rows.sort((a, b) => String(b.record.archivedAt || b.record.date || '').localeCompare(String(a.record.archivedAt || a.record.date || '')))
  })()

  function resetEstimateForm() {
    setEstCust('')
    setEstAccountId('')
    setEstCustEdited(false)
    setEstAddr('')
    setEstDate(today())
    setEstJobType(JOB_TYPES[0])
    setEstHours('')
    // COST-1.5A: only pre-fill a real Default Bill Rate; leave blank when unset
    // rather than seeding a degenerate 0.
    setEstBillRate(billRate > 0 ? String(billRate) : '')
    setEstMaterials('')
    setEstMiles('')
    setEstNotes('')
    setEditEstimateId(null)
    setEstTotalQuoted('')
    setEstQuotedManual(false)
    setEstAssignments([])
    setEstCostingSource('assigned')
    setEstPricingCrewIds([])
    setEstCostingMode('crew')
    setEstFrozenSnapshot(null)
    setEstMatNotes('')
    setEstReceiptUrl('')
    setShowEstimateNewCustomerModal(false)
    setNewCustomerForm({
      company: '',
      contact: '',
      role: 'General Contractor',
      phone: '',
      email: '',
      address: '',
      city: '',
      notes: '',
      tags: '',
    })
    setShowEstimateForm(false)
  }

  function handleSelectEstimateAccount(accountId: string, forceFill: boolean = false) {
    setEstAccountId(accountId)
    const selected = accountOptions.find((a: any) => a.id === accountId)
    if (!selected) return
    if (forceFill || !estCustEdited || !String(estCust || '').trim()) {
      setEstCust(selected.label)
      setEstCustEdited(false)
    }
  }

  function saveNewCustomerForEstimate() {
    const company = String(newCustomerForm.company || '').trim()
    if (!company) {
      alert('Account / company name is required.')
      return
    }
    pushState(backup)
    const newGC: any = {
      id: 'gc' + Date.now(),
      company,
      contact: String(newCustomerForm.contact || '').trim(),
      role: newCustomerForm.role || 'General Contractor',
      phone: String(newCustomerForm.phone || '').trim(),
      email: String(newCustomerForm.email || '').trim(),
      address: String(newCustomerForm.address || '').trim(),
      city: String(newCustomerForm.city || '').trim(),
      intro: '',
      sent: 0,
      awarded: 0,
      avg: 0,
      pay: '',
      phase: 'First Contact',
      fit: 0,
      action: '',
      due: '',
      notes: String(newCustomerForm.notes || '').trim(),
      tags: String(newCustomerForm.tags || '').trim(),
      created: new Date().toISOString().slice(0, 10),
      contactLog: [],
      nextFollowup: '',
      lastContact: '',
    }
    backup.gcContacts = [...gcContacts, newGC]
    persist()
    setShowEstimateNewCustomerModal(false)
    setNewCustomerForm({
      company: '',
      contact: '',
      role: 'General Contractor',
      phone: '',
      email: '',
      address: '',
      city: '',
      notes: '',
      tags: '',
    })
    const label = [newGC.company || 'Unnamed', newGC.contact ? `(${newGC.contact})` : ''].filter(Boolean).join(' ').trim()
    setEstAccountId(newGC.id)
    setEstCust(label)
    setEstCustEdited(false)
  }

  async function saveServiceEstimate() {
    const estHrs = parseFloat(estHours) || 0
    const estMat = parseFloat(estMaterials) || 0
    const estMi = parseFloat(estMiles) || 0
    const estRate = parseFloat(estBillRate) || billRate

    // SERVICE-COST-3B: quote path depends on costing mode.
    //   legacy  -> settings.opCost single-rate compatibility, no snapshot written.
    //   frozen  -> keep existing snapshot, no recomputation.
    //   crew    -> crew-aware math, writes snapshot when valid.
    let quote: import('@/features/service-quote/serviceQuoteMath').ServiceQuoteBreakdown
    let estimateSnapshot: CrewCostSnapshot | undefined = undefined
    if (estCostingMode === 'legacy') {
      quote = quoteFor(
        { hours: estHrs, billRate: estRate, materials: estMat, miles: estMi },
        estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0,
      )
    } else if (estCostingMode === 'frozen' && estFrozenSnapshot) {
      quote = quoteFromCostSnapshot(
        estFrozenSnapshot,
        estTotalQuoted === '' ? estFrozenSnapshot.suggestedQuote : parseFloat(estTotalQuoted) || estFrozenSnapshot.suggestedQuote,
      )
      estimateSnapshot = estFrozenSnapshot
    } else {
      const crewResult = estimateCrewQuote()
      quote = crewResult.breakdown
        ? crewBreakdownToLegacyQuote(crewResult.breakdown, estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0)
        : quoteFor(
            { hours: estHrs, billRate: estRate, materials: estMat, miles: estMi },
            estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0,
          )
      estimateSnapshot = crewResult.snapshot ?? undefined
    }
    const totalQuote = quote.totalQuoted

    pushState(backup)
    const estimate = {
      id: editEstimateId || ('est' + Date.now()),
      customer: estCust || 'Unknown',
      accountId: estAccountId || undefined,
      address: estAddr,
      date: estDate || today(),
      jobType: estJobType,
      estHours: estHrs,
      billRate: estRate,
      estMaterials: estMat,
      milesRT: estMi,
      notes: estNotes,
      assignedEmployees: estAssignments,
      // SERVICE-COST-3B: owner-only cost snapshot. Never sent to Employee Portal.
      costSnapshot: estimateSnapshot,
      materialNotes: estMatNotes,
      receiptUrl: estReceiptUrl,
      totalQuote,
      suggestedQuote: quote.suggestedQuote,
      quotedManual: estQuotedManual,
      status: 'open',
      createdAt: new Date().toISOString(),
      // Preserve the hunter_lead id for portal-originated service calls so
      // the Customer Tracker controls can be rendered in the Open Estimates card.
      hunterLeadId: (!editEstimateId && portalLeadId) ? portalLeadId : undefined,
    }

    if (editEstimateId) {
      const idx = serviceEstimates.findIndex(e => e.id === editEstimateId)
      if (idx >= 0) {
        // Phase 6R-B: preserve prior identity/createdAt, bump updatedAt.
        const prior: any = backup.serviceEstimates[idx]
        backup.serviceEstimates[idx] = ensureServiceEstimateIdentity({
          ...prior,
          ...estimate,
          serviceEstimateId: prior?.serviceEstimateId,
          createdAt: prior?.createdAt || estimate.createdAt,
          updatedAt: new Date().toISOString(),
        })
      }
    } else {
      if (!Array.isArray(backup.serviceEstimates)) backup.serviceEstimates = []
      backup.serviceEstimates = [...serviceEstimates, ensureServiceEstimateIdentity({ ...estimate, updatedAt: new Date().toISOString() })]
    }
    // Phase 6R-B: route through the service.calls scoped save (was broad persist()).
    const saved = await persistServiceCalls()
    if (!saved) return
    // SERVICE-LOG-1: mirror the assignment set to the Employee Portal (job facts
    // only — no quote, profit or collections data leaves the owner app).
    syncAssignmentsToPortal(estimate, 'service_estimate', estAssignments)
    // SALES-CONVERSION-1: notify PipelineTab that a new service call was saved so
    // it can reconcile conversion receipts immediately. Only for new estimates that
    // originated from a Sales Intelligence lead (hunterLeadId is only set then).
    if (estimate.hunterLeadId) {
      window.dispatchEvent(new CustomEvent('poweron:service-call-created', {
        detail: {
          serviceCallId: estimate.id,
          leadId: estimate.hunterLeadId,
          label: estimate.customer,
        },
      }))
    }
    if (estimate.accountId) {
      void linkEntityToAccount({
        orgId: authProfile?.org_id || null,
        accountId: String(estimate.accountId),
        entityType: 'service_estimate',
        entityId: String(estimate.id),
        entityLabel: estimate.jobType || estimate.customer || 'Service Estimate',
        legacyCustomerText: estimate.customer || '',
        metadata: { legacy_payload: estimate },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] relationship link upsert failed', err))
      void upsertRelationshipEvent({
        orgId: authProfile?.org_id || null,
        accountId: String(estimate.accountId),
        entityType: 'service_estimate',
        entityId: String(estimate.id),
        title: estimate.jobType || estimate.customer || 'Service Estimate',
        description: estimate.notes || '',
        quotedAmount: num(estimate.totalQuote || 0),
        collectedAmount: 0,
        outstandingAmount: Math.max(0, num(estimate.totalQuote || 0)),
        metadata: { status: estimate.status || 'open', legacy_payload: estimate },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] relationship event upsert failed', err))
    }
    // If this estimate came from a portal lead, update confirmed milestone with estimate date
    if (portalLeadId && !editEstimateId) {
      Promise.all([
        import('@/lib/supabase'),
        import('@/services/portal/portalService'),
      ]).then(([{ supabase: sb }, portal]) => {
        (sb as any).from('portal_requests').select('id').eq('hunter_lead_id', portalLeadId).maybeSingle()
          .then(({ data: pr }: any) => {
            if (!pr?.id) return
            const confirmedTime = estDate ? new Date(estDate + 'T12:00:00').toISOString() : new Date().toISOString()
            portal.writePortalTimelineEvent({
              portalRequestId: pr.id,
              eventType: 'confirmed',
              description: 'Your appointment has been scheduled. We will be there as planned.',
              eventTime: confirmedTime,
            }).catch((err: any) => {
              console.error('[V15rFieldLogPanel] confirmed milestone write failed:', err)
            })
          })
      })
    }
    resetEstimateForm()
  }
  function beginEstimateEdit(estimateId: string) {
    const est = serviceEstimates.find(e => e.id === estimateId)
    if (!est) return
    setEditEstimateId(est.id)
    setEstCust(canonicalCustomerName(est))
    setEstAccountId((est as any).accountId || '')
    setEstCustEdited(false)
    setEstAddr(est.address || '')
    setEstDate(est.date || today())
    setEstJobType(est.jobType || JOB_TYPES[0])
    setEstHours(String(est.estHours || 0))
    setEstBillRate(String(est.billRate || billRate))
    setEstMaterials(String(est.estMaterials || 0))
    setEstMiles(String(est.milesRT || 0))
    setEstNotes(est.notes || '')
    // SERVICE-LOG-1: the stored quote IS the customer's Total Quoted. Suggested
    // Quote is recalculated live from the current cost inputs and never
    // overwrites the historical customer number.
    const loadedQuote = resolveTotalQuoted(est)
    const suggested = quoteFor({
      hours: num(est.estHours),
      billRate: num(est.billRate) || billRate,
      materials: num(est.estMaterials),
      miles: num(est.milesRT),
    }).suggestedQuote
    setEstTotalQuoted(String(loadedQuote))
    setEstQuotedManual(isManuallyQuoted(est, suggested))
    setEstAssignments(hydrateAssignmentIdentities(normalizeAssignments(est), assignableEmployeeOptions))
    // SERVICE-COST-3B: restore costing source and pricing crew from snapshot or record.
    // Old records without a snapshot start in explicit legacy mode and require an
    // explicit Upgrade to Crew Costing before a snapshot may be written.
    const savedSnapshot = (est as any).costSnapshot as CrewCostSnapshot | undefined
    if (savedSnapshot) {
      setEstCostingMode('frozen')
      setEstFrozenSnapshot(savedSnapshot)
    } else {
      setEstCostingMode('legacy')
      setEstFrozenSnapshot(null)
    }
    const savedCrewSource = savedSnapshot?.crewSource || 'assigned'
    setEstCostingSource(savedCrewSource)
    setEstPricingCrewIds(
      (est as any).pricingCrewIds
      || (savedCrewSource === 'pricing' ? (savedSnapshot?.crew.map((c) => c.costModelEmployeeId) ?? []) : []),
    )
    setEstMatNotes((est as any).materialNotes || '')
    setEstReceiptUrl((est as any).receiptUrl || '')
    setShowEstimateForm(true)
  }

  function deleteEstimate(estimateId: string) {
    if (!confirm('Delete this estimate?')) return
    pushState(backup)
    // Phase 6R-B: soft-delete via tombstone instead of hard-filter, so a stale
    // second device cannot resurrect the deleted estimate.
    backup.serviceEstimates = serviceEstimates.map(e =>
      e.id === estimateId ? createServiceEstimateTombstone(e) : e
    )
    persistServiceCalls()
  }

  function archiveEstimate(estimateId: string) {
    if (!confirm('Archive this record? It will be hidden from active views but kept for history.')) return
    pushState(backup)
    const now = new Date().toISOString()
    backup.serviceEstimates = serviceEstimates.map(e => e.id === estimateId ? ensureServiceEstimateIdentity({
      ...e,
      archived: true,
      archivedAt: now,
      archivedReason: e.archivedReason ?? null,
      updatedAt: now,
    }) : e)
    backup.activeServiceCalls = rawActiveServiceCalls.map(c => (c.id === estimateId || c.fromEstimateId === estimateId) ? ensureActiveServiceCallIdentity({
      ...c,
      archived: true,
      archivedAt: now,
      archivedReason: c.archivedReason ?? null,
      updatedAt: now,
    }) : c)
    persistServiceCalls()
  }

  function markEstimateLost(estimateId: string) {
    if (!confirm('Mark this estimate as lost? It will leave active estimate queues but stay in data.')) return
    pushState(backup)
    const now = new Date().toISOString()
    backup.serviceEstimates = serviceEstimates.map(e => e.id === estimateId ? ensureServiceEstimateIdentity({
      ...e,
      status: 'lost',
      serviceStatus: 'lost',
      outcome: 'lost',
      lostAt: now,
      updatedAt: now,
    }) : e)
    backup.activeServiceCalls = rawActiveServiceCalls.map(c => (c.id === estimateId || c.fromEstimateId === estimateId) ? ensureActiveServiceCallIdentity({
      ...c,
      status: 'lost',
      serviceStatus: 'lost',
      outcome: 'lost',
      lostAt: now,
      updatedAt: now,
    }) : c)
    persistServiceCalls()
  }

  async function confirmEstimateToActiveCall(estimateId: string) {
    const est = serviceEstimates.find(e => e.id === estimateId)
    if (!est) return
    pushState(backup)
    const now = new Date().toISOString()
    // Phase 6R-B: mark the source estimate active (stamp identity/updatedAt) and
    // create the active call with a DISTINCT activeServiceCallId + fromEstimateId
    // link (avoids the old same-id ambiguity across the two arrays). Display still
    // reads the estimate's status, so UI behavior is unchanged.
    est.status = 'active'
    ;(est as any).updatedAt = now
    backup.serviceEstimates = serviceEstimates.map(e => e.id === estimateId ? ensureServiceEstimateIdentity(est) : e)
    const activeEntry: any = ensureActiveServiceCallIdentity({
      ...est,
      status: 'active',
      accountId: (est as any).accountId || undefined,
      activeServiceCallId: 'asc' + Date.now() + Math.random().toString(36).slice(2, 6),
      fromEstimateId: (est as any).serviceEstimateId || est.id,
      createdAt: now,
      updatedAt: now,
    })
    if (!Array.isArray(backup.activeServiceCalls)) backup.activeServiceCalls = []
    backup.activeServiceCalls = [...rawActiveServiceCalls, activeEntry]
    // Note: per spec, Confirm Job does NOT mark as invoiced — that happens when work is performed
    // and service log is created. This is just a lead-confirmation milestone.
    const saved = await persistServiceCalls()
    if (!saved) return
    // SERVICE-LOG-1: assignments (and Total Quoted) ride along on the spread
    // above; re-sync so the portal rows reflect the now-active service call.
    syncAssignmentsToPortal(activeEntry, 'service_call', normalizeAssignments(activeEntry))
    if (activeEntry.accountId) {
      void linkEntityToAccount({
        orgId: authProfile?.org_id || null,
        accountId: String(activeEntry.accountId),
        entityType: 'active_service_call',
        entityId: String(activeEntry.id),
        entityLabel: activeEntry.jobType || activeEntry.customer || 'Active Service Call',
        legacyCustomerText: activeEntry.customer || '',
        metadata: { legacy_payload: activeEntry },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] active service link upsert failed', err))
      void upsertRelationshipEvent({
        orgId: authProfile?.org_id || null,
        accountId: String(activeEntry.accountId),
        entityType: 'active_service_call',
        entityId: String(activeEntry.id),
        title: activeEntry.jobType || activeEntry.customer || 'Active Service Call',
        description: activeEntry.notes || '',
        quotedAmount: num(activeEntry.totalQuote || activeEntry.quoted || 0),
        collectedAmount: num(activeEntry.collected || 0),
        outstandingAmount: Math.max(0, num(activeEntry.totalQuote || activeEntry.quoted || 0) - num(activeEntry.collected || 0)),
        metadata: { status: activeEntry.status || 'active', legacy_payload: activeEntry },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] active service event upsert failed', err))
    }
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

  async function completeAndLogService() {
    const est = serviceEstimates.find(e => e.id === completingEstimateId)
    if (!est) return

    const actHrs = parseFloat(actualHours) || 0
    const actMat = parseFloat(actualMaterials) || 0
    const actMi = parseFloat(actualMiles) || 0
    const collected = parseFloat(paymentCollected) || 0

    const mileageCost = actMi * mileRate
    const labCost = actHrs * opCost

    pushState(backup)

    // SERVICE-LOG-1: the estimate's Total Quoted is the customer agreement and
    // carries through the conversion untouched; assignments come with it.
    const carriedTotalQuoted = resolveTotalQuoted(est)
    const carriedAssignments = normalizeAssignments(est)

    // Create service log entry
    const logEntry: BackupServiceLog = {
      id: 'svc' + Date.now(),
      date: today(),
      customer: est.customer,
      accountId: (est as any).accountId || undefined,
      address: est.address,
      jtype: est.jobType,
      hrs: actHrs,
      miles: actMi,
      quoted: carriedTotalQuoted,
      suggestedQuote: (est as any).suggestedQuote,
      quotedManual: (est as any).quotedManual,
      assignedEmployees: carriedAssignments,
      mat: actMat,
      collected,
      payStatus: collected >= carriedTotalQuoted ? 'Y' : (collected > 0 ? 'P' : 'N'),
      balanceDue: Math.max(0, carriedTotalQuoted - collected),
      store: '',
      notes: est.notes,
      mileCost: mileageCost,
      opCost: labCost,
      profit: collected - actMat - mileageCost - labCost,
    } as any

    // Phase 6R-B: identity-stamp the new service log AND mark the source estimate
    // completed, then save BOTH through the service.calls scoped merge below. This
    // fixes the old changedKey/silo mismatch (it used to broad-save under 'logs'
    // while mutating serviceLogs + serviceEstimates, risking loss of the new log
    // and the estimate completion when remote had advanced).
    const now6rb = new Date().toISOString()
    backup.serviceLogs = [...serviceLogs, ensureServiceLogIdentity({ ...logEntry, updatedAt: now6rb })]
    est.status = 'completed'
    ;(est as any).updatedAt = now6rb
    backup.serviceEstimates = serviceEstimates.map(e => e.id === est.id ? ensureServiceEstimateIdentity(est) : e)

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
      quoted: carriedTotalQuoted,
      actualCost: actMat + mileageCost + labCost,
    })

    // Phase 6R-B: one scoped save carries the new serviceLog + estimate completion.
    const saved = await persistServiceCalls()
    if (!saved) return
    // The completed work now lives on the service log id — move the portal rows
    // there and clear the estimate's, so an employee sees the job once.
    syncAssignmentsToPortal(logEntry, 'service_call', carriedAssignments)
    syncAssignmentsToPortal(est, 'service_estimate', [])
    if ((logEntry as any).accountId) {
      void linkEntityToAccount({
        orgId: authProfile?.org_id || null,
        accountId: String((logEntry as any).accountId),
        entityType: 'service_log',
        entityId: String(logEntry.id),
        entityLabel: logEntry.jtype || logEntry.customer || 'Service Call',
        legacyCustomerText: logEntry.customer || '',
        metadata: { legacy_payload: logEntry },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] relationship link upsert failed', err))
      void upsertRelationshipEvent({
        orgId: authProfile?.org_id || null,
        accountId: String((logEntry as any).accountId),
        entityType: 'service_log',
        entityId: String(logEntry.id),
        title: logEntry.jtype || logEntry.customer || 'Service Call',
        description: logEntry.notes || '',
        quotedAmount: num(logEntry.quoted || 0),
        collectedAmount: num(logEntry.collected || 0),
        outstandingAmount: Math.max(0, num(logEntry.quoted || 0) - num(logEntry.collected || 0)),
        metadata: { status: logEntry.payStatus || '', legacy_payload: logEntry },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] relationship event upsert failed', err))
    }
    setCompletingEstimateId(null)
  }

  // ── Project log CRUD ───────────────────────────────────────────────────

  function resetProjForm() {
    setFlProj(''); setFlPhase(PHASES[0]); setFlDate(today()); setFlEmp('')
    setFlHrs(''); setFlMiles(''); setFlMat(''); setFlCollected('')
    setFlStore(''); setFlEmatInfo(''); setFlDetailLink(''); setFlNotes('')
    setEditLogId(null); setShowProjForm(false)
  }

  async function saveProjEntry() {
    const proj = projects.find(p => p.id === flProj)
    pushState(backup)
    const now = new Date().toISOString()
    const existing = editLogId ? logs.find(l => l.id === editLogId) : null
    const fields = {
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
    if (editLogId && existing) {
      // Edit: preserve logId/id/createdAt (+ legacy fields), bump updatedAt.
      const entry: BackupLog = {
        ...existing,
        ...fields,
        logId: (existing as any).logId || makeLogInternalId(),
        createdAt: (existing as any).createdAt || existing.date || now,
        updatedAt: now,
      }
      const idx = logs.findIndex(l => l.id === editLogId)
      if (idx >= 0) backup.logs[idx] = entry
    } else {
      const entry: BackupLog = {
        id: 'log' + Date.now(),
        logId: makeLogInternalId(),
        createdAt: now,
        updatedAt: now,
        ...fields,
      }
      backup.logs = [...logs, entry]
    }
    // Phase 6N: scoped save for the affected project's log slice.
    const saved = await saveProjectLogsScoped(flProj)
    if (!saved) return
    // Session 10: Passive skill signal extraction (fire-and-forget)
    if (flNotes && flNotes.trim().length > 10) {
      const signalText = `Phase: ${flPhase}. Notes: ${flNotes}`
      processSkillSignals(signalText, 'field_log')
    }
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
    // Phase 6N: tombstone instead of hard-delete; scoped save by the row's projId.
    const idx = logs.findIndex(l => l.id === logId)
    if (idx < 0) return
    const affectedProjectId = String(logs[idx].projId || '')
    backup.logs = logs.map((l, i) => (i === idx ? createLogTombstone(l, affectedProjectId) : l))
    void saveProjectLogsScoped(affectedProjectId)
  }

  // ── Service log CRUD ───────────────────────────────────────────────────

  function resetSvcForm() {
    setSlCust(''); setSlAddr(''); setSlDate(today()); setSlHrs(''); setSlEstHrs(''); setSlMi('')
    setSlQuoted(''); setSlMat(''); setSlCollected(''); setSlStore(''); setSlJtype(JOB_TYPES[0])
    setSlPayStatus('Y'); setSlEmatInfo(''); setSlDetailLink(''); setSlNotes('')
    setSlAccountId('')
    // COST-1.5A: only pre-fill a real Default Bill Rate; leave blank when unset.
    setSlBillRate(billRate > 0 ? String(billRate) : '')
    setSlQuotedManual(false)
    setSlAssignments([])
    setSlCostingSource('assigned')
    setSlPricingCrewIds([])
    setSlCostingMode('crew')
    setSlFrozenSnapshot(null)
    setEditSvcId(null); setShowSvcForm(false)
  }

  /**
   * SERVICE-LOG-1: Relationship Account picker inside the Service Call modal.
   * Mirrors handleSelectEstimateAccount — the link is written by saveSvcEntry,
   * so Cancel never persists anything.
   */
  function handleSelectServiceCallAccount(accountId: string) {
    setSlAccountId(accountId)
    const selected = accountOptions.find((a: any) => String(a.id) === String(accountId))
    if (!selected) return
    if (!String(slCust || '').trim()) setSlCust(selected.label)
  }

  /** Recompute Suggested Quote from the Service Call modal's current inputs. */
  function serviceCallQuote(totalQuotedOverride?: number | null) {
    const hrs = parseFloat(slEstHrs) || parseFloat(slHrs) || 0
    return quoteFor(
      {
        hours: hrs,
        billRate: parseFloat(slBillRate) || billRate,
        materials: parseFloat(slMat) || 0,
        miles: parseFloat(slMi) || 0,
      },
      totalQuotedOverride === undefined
        ? (slQuoted === '' ? null : parseFloat(slQuoted) || 0)
        : totalQuotedOverride,
    )
  }

  /**
   * SERVICE-COST-3B: crew-aware breakdown for the Service Estimate modal.
   */
  function estimateCrewQuote(totalQuotedOverride?: number | null): {
    breakdown: CrewQuoteBreakdown | null
    snapshot: CrewCostSnapshot | null
    legacy: boolean
    errors: string[]
  } {
    const hrs = parseFloat(estHours) || 0
    const totalQuoted =
      totalQuotedOverride === undefined
        ? (estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0)
        : totalQuotedOverride
    return crewQuoteFor({
      siteHours: hrs,
      materials: parseFloat(estMaterials) || 0,
      miles: parseFloat(estMiles) || 0,
      totalQuotedOverride: totalQuoted,
      costingSource: estCostingSource,
      assignedEmployees: estAssignments,
      pricingCrewIds: estPricingCrewIds,
    })
  }

  /**
   * SERVICE-COST-3B: crew-aware breakdown for the Service Call modal.
   *
   * Returns the legacy ServiceQuoteBreakdown shape so existing UI consumers do not
   * break. The full crew snapshot is available separately for save/display.
   */
  function serviceCallCrewQuote(totalQuotedOverride?: number | null): {
    breakdown: CrewQuoteBreakdown | null
    snapshot: CrewCostSnapshot | null
    legacy: boolean
    errors: string[]
  } {
    const hrs = parseFloat(slEstHrs) || parseFloat(slHrs) || 0
    const totalQuoted =
      totalQuotedOverride === undefined
        ? (slQuoted === '' ? null : parseFloat(slQuoted) || 0)
        : totalQuotedOverride
    return crewQuoteFor({
      siteHours: hrs,
      materials: parseFloat(slMat) || 0,
      miles: parseFloat(slMi) || 0,
      totalQuotedOverride: totalQuoted,
      costingSource: slCostingSource,
      assignedEmployees: slAssignments,
      pricingCrewIds: slPricingCrewIds,
    })
  }

  /**
   * SERVICE-COST-3B: displayed quote for the Service Estimate modal.
   *
   * Returns frozen snapshot values for saved records, live crew values in crew
   * mode, and legacy single-rate values in legacy mode.
   */
  function estimateDisplayQuote(): import('@/features/service-quote/serviceQuoteMath').ServiceQuoteBreakdown {
    if (estCostingMode === 'legacy') {
      return quoteFor(
        {
          hours: parseFloat(estHours) || 0,
          billRate: parseFloat(estBillRate) || billRate,
          materials: parseFloat(estMaterials) || 0,
          miles: parseFloat(estMiles) || 0,
        },
        estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0,
      )
    }
    if (estCostingMode === 'frozen' && estFrozenSnapshot) {
      return quoteFromCostSnapshot(
        estFrozenSnapshot,
        estTotalQuoted === '' ? estFrozenSnapshot.suggestedQuote : parseFloat(estTotalQuoted) || estFrozenSnapshot.suggestedQuote,
      )
    }
    const crewResult = estimateCrewQuote()
    return crewResult.breakdown
      ? crewBreakdownToLegacyQuote(crewResult.breakdown, estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0)
      : quoteFor(
          {
            hours: parseFloat(estHours) || 0,
            billRate: parseFloat(estBillRate) || billRate,
            materials: parseFloat(estMaterials) || 0,
            miles: parseFloat(estMiles) || 0,
          },
          estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0,
        )
  }

  /**
   * SERVICE-COST-3B: displayed quote for the Service Call modal.
   *
   * Returns frozen snapshot values for saved records, live crew values in crew
   * mode, and legacy single-rate values in legacy mode.
   */
  function serviceCallDisplayQuote(): import('@/features/service-quote/serviceQuoteMath').ServiceQuoteBreakdown {
    if (slCostingMode === 'legacy') return serviceCallQuote()
    if (slCostingMode === 'frozen' && slFrozenSnapshot) {
      return quoteFromCostSnapshot(
        slFrozenSnapshot,
        slQuoted === '' ? slFrozenSnapshot.suggestedQuote : parseFloat(slQuoted) || slFrozenSnapshot.suggestedQuote,
      )
    }
    const crewResult = serviceCallCrewQuote()
    return crewResult.breakdown
      ? crewBreakdownToLegacyQuote(crewResult.breakdown, slQuoted === '' ? null : parseFloat(slQuoted) || 0)
      : serviceCallQuote()
  }

  // ── COST-1.5A: mode-aware missing-rate gate ─────────────────────────────────
  // The displayed quote falls back to the legacy single-rate path whenever crew
  // costing cannot resolve, so the required-settings set is computed against the
  // SAME effective mode the quote will actually use. A frozen record prices from
  // its snapshot and needs no settings check. When `missing` is non-empty the
  // modal shows a blocking panel instead of a number and disables Save.
  const estEffectiveMode: 'legacy' | 'crew' | 'frozen' =
    estCostingMode === 'frozen' && estFrozenSnapshot ? 'frozen'
      : estCostingMode === 'legacy' ? 'legacy'
        : estimateCrewQuote().breakdown ? 'crew' : 'legacy'
  const estMissingRates: MissingRate[] =
    estEffectiveMode === 'frozen'
      ? []
      : resolveRequiredServiceRates(settings, { mode: estEffectiveMode }).missing

  const slEffectiveMode: 'legacy' | 'crew' | 'frozen' =
    slCostingMode === 'frozen' && slFrozenSnapshot ? 'frozen'
      : slCostingMode === 'legacy' ? 'legacy'
        : serviceCallCrewQuote().breakdown ? 'crew' : 'legacy'
  const slMissingRates: MissingRate[] =
    slEffectiveMode === 'frozen'
      ? []
      : resolveRequiredServiceRates(settings, { mode: slEffectiveMode }).missing

  /**
   * SERVICE-COST-3B: adapt a crew breakdown to the legacy ServiceQuoteBreakdown
   * shape so ServiceQuotePanel and downstream rollup fields keep working.
   */
  function crewBreakdownToLegacyQuote(
    crew: CrewQuoteBreakdown,
    totalQuotedOverride?: number | null,
  ): import('@/features/service-quote/serviceQuoteMath').ServiceQuoteBreakdown {
    const totalQuoted =
      totalQuotedOverride == null ? crew.suggestedQuote : round2(num(totalQuotedOverride))
    const quoteVariance = round2(totalQuoted - crew.suggestedQuote)
    const actualEstimatedProfit = round2(totalQuoted - crew.totalInternalCost)
    const actualProfitMargin = totalQuoted > 0 ? actualEstimatedProfit / totalQuoted : 0

    return {
      laborBillable: crew.billableLabor,
      materialCost: crew.materialCost,
      mileage: crew.mileageCost,
      tax: crew.salesTax,
      // Legacy "operating cost" is represented by direct labor + overhead recovery.
      operatingCost: round2(crew.directLaborCost + crew.overheadRecovery),
      internalCost: crew.totalInternalCost,
      suggestedQuote: crew.suggestedQuote,
      suggestedProfit: crew.suggestedProfit,
      totalQuoted,
      quoteVariance,
      actualEstimatedProfit,
      actualProfitMargin,
    } as any
  }

  async function saveSvcEntry() {
    const hrs = parseFloat(slHrs) || 0
    const mi = parseInt(slMi) || 0
    const mat = parseFloat(slMat) || 0
    let collected = parseFloat(slCollected) || 0

    // SERVICE-COST-3B: quote path depends on costing mode.
    //   legacy  -> settings.opCost single-rate compatibility, no snapshot written.
    //   frozen  -> keep existing snapshot, no recomputation.
    //   crew    -> crew-aware math, writes snapshot when valid.
    let svcQuote: import('@/features/service-quote/serviceQuoteMath').ServiceQuoteBreakdown
    let serviceSnapshot: CrewCostSnapshot | undefined = undefined
    if (slCostingMode === 'legacy') {
      svcQuote = serviceCallQuote()
    } else if (slCostingMode === 'frozen' && slFrozenSnapshot) {
      svcQuote = quoteFromCostSnapshot(
        slFrozenSnapshot,
        slQuoted === '' ? slFrozenSnapshot.suggestedQuote : parseFloat(slQuoted) || slFrozenSnapshot.suggestedQuote,
      )
      serviceSnapshot = slFrozenSnapshot
    } else {
      const crewResult = serviceCallCrewQuote()
      svcQuote = crewResult.breakdown
        ? crewBreakdownToLegacyQuote(crewResult.breakdown, slQuoted === '' ? null : parseFloat(slQuoted) || 0)
        : serviceCallQuote()
      serviceSnapshot = crewResult.snapshot ?? undefined
    }
    const quoted = svcQuote.totalQuoted

    // Legacy cost components are still needed for trigger rules and fallback display.
    const mileCost = mi * mileRate
    const labCost = serviceSnapshot
      ? serviceSnapshot.directLaborCost + serviceSnapshot.overheadRecovery
      : hrs * opCost
    const profit = quoted - mat - mileCost - labCost

    pushState(backup)

    // SERVICE-LOG-1 polish: honour the Status the owner actually selected. This
    // used to recompute payStatus from Collected alone, silently discarding the
    // choice; reconciling Collected to the status keeps every downstream reader
    // (rollups, Collections Queue, balance colours) consistent with it.
    const payment = reconcileServicePayment(slPayStatus, collected, quoted)
    const payStatus = payment.payStatus
    collected = payment.collected
    const balanceDue = payment.balanceDue
    const triggersAtSave = getFiredTriggerNames(backup, { profit, quoted, mat, miles: mi, hrs, mileCost, opCost: labCost })

    const entry: BackupServiceLog = {
      id: editSvcId || ('svc' + Date.now()),
      date: slDate || today(),
      customer: slCust || 'Unknown',
      accountId: (slAccountId || (editSvcId ? (serviceLogs.find(l => l.id === editSvcId) as any)?.accountId : undefined)),
      address: slAddr,
      jtype: slJtype,
      hrs, miles: mi, quoted, mat,
      suggestedQuote: svcQuote.suggestedQuote,
      quotedManual: slQuotedManual,
      billRate: parseFloat(slBillRate) || billRate,
      assignedEmployees: slAssignments,
      // SERVICE-COST-3B: owner-only cost snapshot. Never sent to Employee Portal.
      costSnapshot: serviceSnapshot,
      estHrs: parseFloat(slEstHrs) || hrs,
      collected, payStatus, balanceDue,
      store: slStore,
      notes: slNotes,
      emergencyMatInfo: slEmatInfo,
      detailLink: slDetailLink,
      adjustments: (editSvcId ? (serviceLogs.find(l => l.id === editSvcId)?.adjustments || []) : []),
    } as any

    if (editSvcId) {
      const idx = serviceLogs.findIndex(l => l.id === editSvcId)
      if (idx >= 0) {
        // Preserve prior statusEvents on edit, append the new state
        const prior = backup.serviceLogs[idx] as any
        ;(entry as any).statusEvents = Array.isArray(prior?.statusEvents) ? [...prior.statusEvents] : []
        const wasInvoicedEdit = !!((entry as any).statusEvents.length && (entry as any).statusEvents[(entry as any).statusEvents.length - 1].invoiced)
        stampStatusEvent(entry as any, payStatus, collected, wasInvoicedEdit)
        // Phase 6R-A: preserve prior identity/createdAt; bump updatedAt.
        ;(entry as any).serviceLogId = prior?.serviceLogId
        ;(entry as any).createdAt = prior?.createdAt
        ;(entry as any).updatedAt = new Date().toISOString()
        backup.serviceLogs[idx] = ensureServiceLogIdentity(entry)
      }
    } else {
      // New entry — seed initial statusEvent (not invoiced yet, that requires Confirm Job)
      ;(entry as any).statusEvents = []
      stampStatusEvent(entry as any, payStatus, collected, false)
      ;(entry as any).updatedAt = new Date().toISOString()
      backup.serviceLogs = [...serviceLogs, ensureServiceLogIdentity(entry)]
    }
    const saved = await persistServiceLogs()
    if (!saved) return
    // SERVICE-LOG-1: employee-safe job facts only — no quote/profit/collections.
    syncAssignmentsToPortal(entry, 'service_call', slAssignments)
    if ((entry as any).accountId) {
      void linkEntityToAccount({
        orgId: authProfile?.org_id || null,
        accountId: String((entry as any).accountId),
        entityType: 'service_log',
        entityId: String(entry.id),
        entityLabel: entry.jtype || entry.customer || 'Service Call',
        legacyCustomerText: entry.customer || '',
        metadata: { legacy_payload: entry },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] relationship link upsert failed', err))
      void upsertRelationshipEvent({
        orgId: authProfile?.org_id || null,
        accountId: String((entry as any).accountId),
        entityType: 'service_log',
        entityId: String(entry.id),
        title: entry.jtype || entry.customer || 'Service Call',
        description: entry.notes || '',
        quotedAmount: num(entry.quoted || 0),
        collectedAmount: num(entry.collected || 0),
        outstandingAmount: Math.max(0, num(entry.quoted || 0) - num(entry.collected || 0)),
        metadata: { status: entry.payStatus || '', legacy_payload: entry },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] relationship event upsert failed', err))
    }
    // Session 10: Passive skill signal extraction (fire-and-forget)
    if (slNotes && slNotes.trim().length > 10) {
      const signalText = `Job type: ${slJtype}. Notes: ${slNotes}`
      processSkillSignals(signalText, 'field_log')
    }
    resetSvcForm()
  }

  /**
   * SERVICE-LOG-1: the canonical Edit Service Call path. New and Edit now open the
   * SAME Service Call modal with the same calculation helper — the old
   * detour that reopened a logged service call inside the blue Service Estimate
   * modal is gone.
   */
  function beginSvcEdit(logId: string) {
    const l = serviceLogs.find(x => x.id === logId)
    if (!l) return
    setEditSvcId(l.id)
    setSlCust(canonicalCustomerName(l)); setSlAddr(l.address || ''); setSlDate(l.date); setSlHrs(String(l.hrs))
    setSlAccountId(String((l as any).accountId || ''))
    setSlEstHrs(String((l as any).estHrs ?? l.hrs ?? ''))
    setSlMi(String(l.miles)); setSlMat(String(l.mat))
    setSlCollected(String(l.collected)); setSlStore(l.store || ''); setSlJtype(l.jtype || JOB_TYPES[0])
    setSlPayStatus(l.payStatus || 'N'); setSlEmatInfo(l.emergencyMatInfo || '')
    setSlDetailLink(l.detailLink || ''); setSlNotes(l.notes || '')

    // The stored quote loads into Total Quoted untouched; Suggested Quote is
    // recalculated from the current cost inputs for comparison only.
    const loadedRate = num((l as any).billRate) || billRate
    setSlBillRate(String(loadedRate))
    setSlQuoted(String(resolveTotalQuoted(l)))
    const suggested = quoteFor({
      hours: num((l as any).estHrs) || num(l.hrs),
      billRate: loadedRate,
      materials: num(l.mat),
      miles: num(l.miles),
    }).suggestedQuote
    setSlQuotedManual(isManuallyQuoted(l, suggested))
    setSlAssignments(hydrateAssignmentIdentities(normalizeAssignments(l), assignableEmployeeOptions))
    // SERVICE-COST-3B: restore costing source and pricing crew from snapshot or record.
    // Old records without a snapshot start in explicit legacy mode and require an
    // explicit Upgrade to Crew Costing before a snapshot may be written.
    const savedSnapshot = (l as any).costSnapshot as CrewCostSnapshot | undefined
    if (savedSnapshot) {
      setSlCostingMode('frozen')
      setSlFrozenSnapshot(savedSnapshot)
    } else {
      setSlCostingMode('legacy')
      setSlFrozenSnapshot(null)
    }
    const savedCrewSource = savedSnapshot?.crewSource || 'assigned'
    setSlCostingSource(savedCrewSource)
    setSlPricingCrewIds(
      (l as any).pricingCrewIds
      || (savedCrewSource === 'pricing' ? (savedSnapshot?.crew.map((c) => c.costModelEmployeeId) ?? []) : []),
    )
    setShowSvcForm(true)
  }

  function deleteSvcEntry(logId: string) {
    if (!confirm('Delete this service entry?')) return
    pushState(backup)
    // Phase 6R-A: soft-delete via tombstone instead of hard-filter, so a stale
    // second device cannot resurrect the row and payment history (collected /
    // payStatus / balanceDue / adjustments[] / statusEvents[]) is preserved.
    backup.serviceLogs = serviceLogs.map(l =>
      String(l.id) === String(logId) ? createServiceLogTombstone(l) : l
    )
    persistServiceLogs()
  }

  function archiveSvcEntry(logId: string) {
    if (!confirm('Archive this record? It will be hidden from active views but kept for history.')) return
    pushState(backup)
    backup.serviceLogs = serviceLogs.map(l => l.id === logId ? ensureServiceLogIdentity({
      ...l,
      archived: true,
      archivedAt: new Date().toISOString(),
      archivedReason: (l as any).archivedReason ?? null,
      updatedAt: new Date().toISOString(),
    }) : l)
    persistServiceLogs()
  }

  function restoreArchivedFields(record: any) {
    const next = {
      ...record,
      archived: false,
      isArchived: false,
    }
    if (record?.archivedAt && !record?.lastArchivedAt) next.lastArchivedAt = record.archivedAt
    delete next.archivedAt
    return next
  }

  function restoreArchivedServiceEntry(source: string, id: string) {
    pushState(backup)
    if (source === 'service_log') {
      // Phase 6R-A: serviceLogs restore goes through the scoped serviceLogs save.
      backup.serviceLogs = serviceLogs.map(l => String(l.id) === String(id)
        ? ensureServiceLogIdentity({ ...restoreArchivedFields(l), updatedAt: new Date().toISOString() })
        : l)
      persistServiceLogs()
      return
    }
    const now = new Date().toISOString()
    if (source === 'active_call') {
      backup.activeServiceCalls = rawActiveServiceCalls.map(c => String(c.id) === String(id)
        ? ensureActiveServiceCallIdentity({ ...restoreArchivedFields(c), updatedAt: now })
        : c)
    } else {
      backup.serviceEstimates = serviceEstimates.map(e => String(e.id) === String(id)
        ? ensureServiceEstimateIdentity({ ...restoreArchivedFields(e), updatedAt: now })
        : e)
      backup.activeServiceCalls = rawActiveServiceCalls.map(c => (String(c.id) === String(id) || String(c.fromEstimateId || '') === String(id))
        ? ensureActiveServiceCallIdentity({ ...restoreArchivedFields(c), updatedAt: now })
        : c)
    }
    // Phase 6R-B: active-call / estimate restore now routes through the scoped save.
    persistServiceCalls()
  }

  function deleteArchivedActiveServiceCall(id: string) {
    if (!confirm('Delete this archived active service call?')) return
    pushState(backup)
    // Phase 6R-B: soft-delete via tombstone instead of hard-filter.
    backup.activeServiceCalls = rawActiveServiceCalls.map(c =>
      String(c.id) === String(id) ? createActiveServiceCallTombstone(c) : c
    )
    persistServiceCalls()
  }

  /**
   * Append a statusEvent to a service log for historical exposure tracking.
   * Called from every write site that changes collected amount or invoice state.
   * Events are append-only; never mutated, never removed.
   */
  function stampStatusEvent(log: any, nextStatus: string, nextCollected: number, invoiced: boolean) {
    if (!Array.isArray(log.statusEvents)) log.statusEvents = []
    log.statusEvents.push({
      date: today(),
      status: nextStatus,
      collected: Math.max(0, num(nextCollected) || 0),
      invoiced: !!invoiced,
    })
  }

  function quickSetSvcPayment(logId: string, status: string) {
    const l = serviceLogs.find(x => x.id === logId)
    if (!l) return
    pushState(backup)
    const roll = getServiceRollup(l)
    // Preserve prior invoiced flag — quick-pay doesn't change invoicing, only collection
    const wasInvoiced = !!(Array.isArray(l.statusEvents) && l.statusEvents.length && l.statusEvents[l.statusEvents.length - 1].invoiced)
    if (status === 'Y') {
      l.collected = roll.totalBillable
      l.payStatus = 'Y'
      l.balanceDue = 0
      stampStatusEvent(l, 'Y', l.collected, wasInvoiced)
    } else if (status === 'P') {
      const amt = prompt('Partial amount collected:', String(num(l.collected) || 0))
      if (amt === null) return
      l.collected = parseFloat(amt) || 0
      const newMeta = getServicePaymentMeta(l)
      l.payStatus = newMeta.status
      l.balanceDue = newMeta.remaining
      stampStatusEvent(l, newMeta.status, l.collected, wasInvoiced)
    }
    // Phase 6R-A: stamp identity/updatedAt and route through scoped serviceLogs save.
    if (!(l as any).serviceLogId) (l as any).serviceLogId = l.id
    ;(l as any).updatedAt = new Date().toISOString()
    persistServiceLogs()
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
    const wasInvoicedAdj = !!(Array.isArray(l.statusEvents) && l.statusEvents.length && l.statusEvents[l.statusEvents.length - 1].invoiced)
    stampStatusEvent(l, l.payStatus, l.collected, wasInvoicedAdj)
    // Phase 6R-A: stamp identity/updatedAt and route through scoped serviceLogs save.
    if (!(l as any).serviceLogId) (l as any).serviceLogId = l.id
    ;(l as any).updatedAt = new Date().toISOString()
    persistServiceLogs()
  }

  function toggleTrigger(ruleId: string, active: boolean) {
    const rule = triggerRules.find(r => r.id === ruleId)
    if (rule) {
      pushState(backup)
      rule.active = active
      persist()
    }
  }

  function startAddTriggerRule() {
    setEditingTriggerRuleId('new')
    setTriggerRuleForm({
      id: `trigger_${Date.now().toString(36)}`,
      name: '',
      type: 'bad_day',
      color: '#3b82f6',
      active: true,
      condition: '',
      threshold: '0.5',
      thresholdLabel: 'Threshold',
      situation: '',
      review: '',
      solution: '',
      reflection: '',
    })
  }

  function startEditTriggerRule(rule: BackupTriggerRule) {
    setEditingTriggerRuleId(rule.id)
    setTriggerRuleForm({ ...rule })
  }

  function cancelTriggerRuleEdit() {
    setEditingTriggerRuleId(null)
    setTriggerRuleForm(null)
  }

  function saveTriggerRuleForm() {
    if (!triggerRuleForm) return
    const name = String(triggerRuleForm.name || '').trim()
    if (!name) return
    const nextRule = {
      id: String(triggerRuleForm.id || `trigger_${Date.now().toString(36)}`),
      name,
      type: String(triggerRuleForm.type || 'bad_day').trim() || 'bad_day',
      color: String(triggerRuleForm.color || '#3b82f6').trim() || '#3b82f6',
      active: triggerRuleForm.active !== false,
      condition: String(triggerRuleForm.condition || '').trim(),
      threshold: String(triggerRuleForm.threshold || '0').trim(),
      thresholdLabel: String(triggerRuleForm.thresholdLabel || 'Threshold').trim(),
      situation: String(triggerRuleForm.situation || '').trim(),
      review: String(triggerRuleForm.review || '').trim(),
      solution: String(triggerRuleForm.solution || '').trim(),
      reflection: String(triggerRuleForm.reflection || '').trim(),
    }
    pushState(backup)
    if (!Array.isArray(backup.triggerRules)) backup.triggerRules = []
    const existingIdx = backup.triggerRules.findIndex(r => r.id === nextRule.id)
    if (existingIdx >= 0) backup.triggerRules[existingIdx] = nextRule
    else backup.triggerRules = [...backup.triggerRules, nextRule]
    cancelTriggerRuleEdit()
    persist()
  }

  function removeTriggerRule(ruleId: string) {
    const rule = triggerRules.find(r => r.id === ruleId)
    if (!rule) return
    if (!confirm(`Remove trigger rule "${rule.name}"?`)) return
    pushState(backup)
    backup.triggerRules = triggerRules.filter(r => r.id !== ruleId)
    if (editingTriggerRuleId === ruleId) cancelTriggerRuleEdit()
    persist()
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
    const activeProjectIds = new Set(projects.map(p => p.id))
    // Phase 6N: exclude tombstoned/archived logs from the list (live rows only).
    const liveLogs = logs.filter(l => !isDeadProjectLog(l))
    const activeProjectLogs = liveLogs.filter(l => activeProjectIds.has(l.projId))
    const filtered = projFilter === 'all' ? activeProjectLogs : activeProjectLogs.filter(l => l.projId === projFilter)
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
              onClick={toggleShowGaps}
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
              onClick={async () => {
                setAiProfitLoading(true)
                try {
                  // Determine which tab is active
                  const isServiceTab = activeTab === 'svc'

                  let dataContext = ''
                  if (isServiceTab) {
                    const logs = (backup.serviceLogs || []).filter(isActiveServiceCall).slice(-20)
                    const totalCollected = logs.reduce((s, l) => s + num(l.collected || 0), 0)
                    const totalQuoted = logs.reduce((s, l) => s + num(l.quoted || 0), 0)
                    const totalMat = logs.reduce((s, l) => s + num(l.mat || 0), 0)
                    const totalHrs = logs.reduce((s, l) => s + num(l.hrs || 0), 0)
                    const avgTicket = logs.length > 0 ? totalQuoted / logs.length : 0
                    const collectionRate = totalQuoted > 0 ? (totalCollected / totalQuoted * 100) : 0
                    dataContext = `Service Log Analysis (${logs.length} recent calls):\nAvg Ticket: $${avgTicket.toFixed(0)}\nCollection Rate: ${collectionRate.toFixed(1)}%\nTotal Quoted: $${totalQuoted}\nTotal Collected: $${totalCollected}\nTotal Materials: $${totalMat}\nTotal Hours: ${totalHrs}\n\nAnalyze: avg ticket value, collection rate, job type profitability, material cost efficiency.`
                  } else {
                    const logs = (backup.logs || []).slice(-20)
                    const totalHrs = logs.reduce((s, l) => s + num(l.hours || l.hrs || 0), 0)
                    const totalMat = logs.reduce((s, l) => s + num(l.materialCost || l.mat || 0), 0)
                    dataContext = `Project Field Log Analysis (${logs.length} recent logs):\nTotal Hours: ${totalHrs}\nTotal Material Cost: $${totalMat}\n\nAnalyze: labor efficiency, cost vs budget trends, phase progress patterns.`
                  }

                  const response = await callClaude({
                    system: 'You are PULSE, the analytics agent for Power On Solutions, a C-10 electrical contractor in Coachella Valley, CA. Give concise, data-driven analysis.',
                    messages: [{ role: 'user', content: dataContext + ' Keep under 200 words.' }],
                    max_tokens: 512,
                  })
                  setAiProfitAnalysis(extractText(response))
                } catch { setAiProfitAnalysis('Analysis unavailable') }
                setAiProfitLoading(false)
              }}
              disabled={aiProfitLoading}
              className="px-3 py-1.5 bg-purple-600/20 text-purple-400 rounded-lg text-xs hover:bg-purple-600/30 flex items-center gap-1.5 disabled:opacity-50"
            >
              <Sparkles size={12} /> {aiProfitLoading ? 'Analyzing...' : activeTab === 'svc' ? 'Analyze Service Log' : 'Analyze Project Log'}
            </button>
            <button
              onClick={() => { resetProjForm(); setShowProjForm(true) }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
            >
              <Plus size={12} /> Log
            </button>
          </div>
        </div>

        {/* Project Log Modal */}
        {showProjForm && (() => {
          const projectLogInputClass = 'h-10 w-full rounded-lg border border-cyan-400/15 bg-slate-950/55 px-3 text-xs text-slate-100 shadow-inner shadow-black/20 outline-none transition-all placeholder:text-slate-500 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-400/20'
          const projectLogLabelClass = 'mb-1.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-100/55'
          const projectLogSectionClass = 'rounded-xl border border-white/8 bg-slate-950/35 p-4 shadow-inner shadow-white/[0.025]'

          return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          >
            <div
              className="relative mx-4 flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl shadow-2xl"
              style={{
                maxHeight: '90vh',
                background: 'linear-gradient(145deg, rgba(15,23,42,0.98) 0%, rgba(8,31,47,0.98) 48%, rgba(2,16,28,0.99) 100%)',
                border: '1px solid rgba(45,212,191,0.28)',
                boxShadow: '0 28px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 0 70px rgba(20,184,166,0.08)',
              }}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-50"
                style={{
                  background: 'linear-gradient(115deg, transparent 0%, rgba(45,212,191,0.07) 32%, transparent 58%)',
                  animation: 'projectLogModalGlare 9s ease-in-out infinite',
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-cyan-300/10 to-transparent" />

              <div className="relative flex flex-shrink-0 items-center justify-between border-b border-cyan-300/10 px-6 py-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-400/10 text-emerald-300 shadow-lg shadow-emerald-950/30">
                    <ClipboardList size={20} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-normal text-white">{editLogId ? 'Edit Project Log' : 'New Project Log'}</h2>
                    <p className="mt-1 text-sm text-cyan-100/58">Log labor, materials, mileage, collection, and work performed.</p>
                  </div>
                </div>
                <button
                  onClick={resetProjForm}
                  className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-400 transition-colors hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-white"
                  aria-label="Close project log modal"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="relative flex-1 space-y-4 overflow-y-auto px-5 py-5">
                <div className={projectLogSectionClass}>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-emerald-300/45 via-cyan-300/15 to-transparent" />
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-300/80">Job Context</div>
                    <div className="h-px flex-1 bg-gradient-to-l from-emerald-300/45 via-cyan-300/15 to-transparent" />
                  </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <label className={projectLogLabelClass}>Project</label>
                <select value={flProj} onChange={e => setFlProj(e.target.value)} className={projectLogInputClass}>
                  <option value="">Select...</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className={projectLogLabelClass}>Phase</label>
                <select value={flPhase} onChange={e => setFlPhase(e.target.value)} className={projectLogInputClass}>
                  {PHASES.map(ph => <option key={ph} value={ph}>{ph}</option>)}
                </select>
              </div>
              <div>
                <label className={projectLogLabelClass}>Date</label>
                <input type="date" value={flDate} onChange={e => setFlDate(e.target.value)} className={projectLogInputClass} />
              </div>
              <div>
                <label className={projectLogLabelClass}>Employee</label>
                <select value={flEmp} onChange={e => setFlEmp(e.target.value)} className={projectLogInputClass}>
                  <option value="">Me</option>
                  {(flEmp && !liveEmployees.some(e => e.id === flEmp)
                    ? [...liveEmployees, ...employees.filter(e => e.id === flEmp)]
                    : liveEmployees
                  ).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>
                </div>

                <div className={projectLogSectionClass}>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-cyan-300/40 via-emerald-300/15 to-transparent" />
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200/80">Time + Cost Inputs</div>
                    <div className="h-px flex-1 bg-gradient-to-l from-cyan-300/40 via-emerald-300/15 to-transparent" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className={projectLogLabelClass}>Hours</label>
                <input key={`flHrs-${editLogId || 'new'}`} type="number" step="0.5" defaultValue={flHrs} onBlur={e => setFlHrs(e.target.value)} className={projectLogInputClass} placeholder="0.0" />
              </div>
              <div>
                <label className={projectLogLabelClass}>Miles RT</label>
                <input key={`flMiles-${editLogId || 'new'}`} type="number" defaultValue={flMiles} onBlur={e => setFlMiles(e.target.value)} className={projectLogInputClass} placeholder="0" />
              </div>
              <div>
                <div className="w-full">
                  <VoiceMaterialCapture
                    className="[&>label]:mb-1.5 [&>label]:block [&>label]:text-[10px] [&>label]:font-bold [&>label]:uppercase [&>label]:tracking-[0.16em] [&>label]:text-cyan-100/55 [&_input]:!h-10 [&_input]:!rounded-lg [&_input]:!border-cyan-400/15 [&_input]:!bg-slate-950/55 [&_input]:!px-3 [&_input]:!text-slate-100 [&_input]:outline-none [&_input]:transition-all [&_input:focus]:!border-cyan-300/70 [&_input:focus]:!ring-2 [&_input:focus]:!ring-cyan-400/20 [&_button]:!h-10 [&_button]:!w-10 [&_button]:!rounded-lg"
                    value={flMat}
                    onChange={setFlMat}
                    priceBook={Array.isArray(backup.priceBook) ? backup.priceBook : (backup.priceBook && typeof backup.priceBook === 'object' ? Object.values(backup.priceBook) : [])}
                    onConfirm={(total, note) => {
                      setFlMat(total > 0 ? total.toFixed(2) : flMat)
                      setFlNotes(prev => prev ? `${prev}\n${note}` : note)
                    }}
                  />
                </div>
              </div>
              <div>
                <label className={projectLogLabelClass}>Collected $</label>
                <input key={`flCollected-${editLogId || 'new'}`} type="number" step="0.01" defaultValue={flCollected} onBlur={e => setFlCollected(e.target.value)} className={projectLogInputClass} placeholder="0.00" />
              </div>
              <div>
                <label className={projectLogLabelClass}>Store</label>
                <input key={`flStore-${editLogId || 'new'}`} defaultValue={flStore} onBlur={e => setFlStore(e.target.value)} placeholder="Home Depot..." className={projectLogInputClass} />
              </div>
                  </div>
                </div>

                <div className={projectLogSectionClass}>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-px flex-1 bg-gradient-to-r from-emerald-300/40 via-cyan-300/15 to-transparent" />
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-emerald-200/80">Notes + Proof</div>
                    <div className="h-px flex-1 bg-gradient-to-l from-emerald-300/40 via-cyan-300/15 to-transparent" />
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className={projectLogLabelClass}>Emergency Mat Info</label>
              <input key={`flEmatInfo-${editLogId || 'new'}`} defaultValue={flEmatInfo} onBlur={e => setFlEmatInfo(e.target.value)} className={projectLogInputClass} placeholder="PO, reason, approval..." />
            </div>
            <div>
              <label className={projectLogLabelClass}>Detail Link</label>
              <input key={`flDetailLink-${editLogId || 'new'}`} defaultValue={flDetailLink} onBlur={e => setFlDetailLink(e.target.value)} placeholder="Receipt, cart, item link" className={projectLogInputClass} />
            </div>
            <div className="md:col-span-2">
              <label className={projectLogLabelClass}>Work Performed</label>
              <textarea key={`flNotes-${editLogId || 'new'}`} defaultValue={flNotes} onBlur={e => setFlNotes(e.target.value)} rows={3} className={`${projectLogInputClass} h-auto min-h-[92px] resize-none py-3 leading-relaxed`} placeholder="Describe the work completed, blockers, and next steps..." />
            </div>
                  </div>
                </div>
            {/* Spec: Live entry form preview — updates as user types */}
            {flProj && (() => {
              const previewBillRate = num(settings.billRate) || 95
              const previewMileRate = num(settings.mileRate) || 0.67
              const proj = projects.find(p => p.id === flProj)
              const contract = proj ? num(proj.contract) : 0

              // Get cumulative state from existing entries (before this one)
              const projRollPreview = buildProjectLogRollup(backup, flProj)
              const existingLogs = projRollPreview.logs
              // If editing, exclude the current entry from baseline
              const baselineLogs = editLogId
                ? existingLogs.filter(l => l.id !== editLogId)
                : existingLogs
              const lastBaseline = baselineLogs[baselineLogs.length - 1]
              const lastRr = lastBaseline ? projRollPreview.byId[lastBaseline.id] : null
              const currentBalance = lastRr ? lastRr.remainingAfter : contract

              // New entry cost preview
              const previewHrs = parseFloat(flHrs) || 0
              const previewMat = parseFloat(flMat) || 0
              const previewMiles = parseFloat(flMiles) || 0
              const previewColl = parseFloat(flCollected) || 0
              const previewLaborCost = previewHrs * previewBillRate
              const previewMileageCost = previewMiles * previewMileRate
              const previewEntryCost = previewLaborCost + previewMat + previewMileageCost
              const remainingAfterSave = currentBalance - previewColl - previewEntryCost
              const quoteBurnPct = contract > 0
                ? Math.abs(((currentBalance - remainingAfterSave) / contract) * 100)
                : 0
              const previewColor = getBalanceColor(remainingAfterSave, contract)

              return (
                <div className="rounded-xl border border-cyan-300/12 bg-slate-950/45 p-3 shadow-inner shadow-white/[0.02]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-100/55">Live Summary</div>
                    <div className="text-[10px] font-mono text-slate-500">{quoteBurnPct.toFixed(1)}% burn against {fmt(contract)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    {[
                      { label: 'Labor', value: previewLaborCost, color: 'text-rose-300' },
                      { label: 'Material', value: previewMat, color: 'text-orange-300' },
                      { label: 'Mileage', value: previewMileageCost, color: 'text-sky-300' },
                      { label: 'Collected', value: previewColl, color: 'text-emerald-300' },
                    ].map(item => (
                      <div key={item.label} className="rounded-lg border border-white/8 bg-white/[0.035] px-3 py-2">
                        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                        <div className={`mt-1 font-mono text-sm font-bold ${item.color}`}>{fmt(item.value)}</div>
                      </div>
                    ))}
                    <div className="rounded-lg border border-emerald-300/18 bg-emerald-300/[0.06] px-3 py-2">
                      <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-100/55">Estimated Total</div>
                      <div className="mt-1 font-mono text-sm font-bold text-white">{fmt(previewEntryCost)}</div>
                      <div className="mt-0.5 text-[9px] font-mono" style={{ color: previewColor }}>Rem. {fmt(remainingAfterSave)}</div>
                    </div>
                  </div>
                  <div className="sr-only">
                  <span className="text-gray-500">Daily net preview: </span>
                  <span style={{ color: previewColor, fontWeight: 700 }}>{fmt(remainingAfterSave)}</span>
                  <span className="text-gray-600"> ({quoteBurnPct.toFixed(1)}% burn) | </span>
                  <span className="text-gray-500">Project quote: </span>
                  <span className="text-gray-300">{fmt(contract)}</span>
                  <span className="text-gray-600"> — </span>
                  <span className="text-gray-500">Today's logged cost: </span>
                  <span className="text-red-400">{fmt(previewEntryCost)}</span>
                  <span className="text-gray-600"> — </span>
                  <span className="text-gray-500">Collected today: </span>
                  <span className="text-emerald-400">{fmt(previewColl)}</span>
                  <span className="text-gray-600"> — </span>
                  <span className="text-gray-500">Remaining after save: </span>
                  <span style={{ color: previewColor, fontWeight: 700 }}>{fmt(remainingAfterSave)}</span>
                  </div>
                </div>
              )
            })()}
              </div>

              <div className="relative flex flex-shrink-0 items-center justify-between border-t border-cyan-300/10 bg-slate-950/70 px-8 py-5 shadow-[0_-18px_34px_rgba(2,6,23,0.35)]">
                <button
                  onClick={resetProjForm}
                  className="rounded-lg border border-white/12 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-slate-300 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={saveProjEntry}
                  className="flex items-center gap-2 rounded-lg border border-emerald-300/35 bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-950/35 transition-all hover:from-emerald-500 hover:to-teal-400"
                >
                  {editLogId ? 'Update Log' : 'Save Log'}
                </button>
              </div>
              <style>{`
                @keyframes projectLogModalGlare {
                  0%, 100% { transform: translateX(-22%); opacity: 0.28; }
                  50% { transform: translateX(18%); opacity: 0.48; }
                }
              `}</style>
            </div>
          </div>
          )
        })()}

        {/* AI Profit Analysis Results */}
        {aiProfitAnalysis && (
          <div className="mt-3 p-4 bg-purple-900/20 border border-purple-500/20 rounded-lg">
            <div className="flex justify-between items-start mb-2">
              <span className="text-purple-400 text-xs font-medium">PULSE Profit Analysis</span>
              <button onClick={() => setAiProfitAnalysis(null)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>
            <p className="text-gray-300 text-sm whitespace-pre-wrap">{aiProfitAnalysis}</p>
          </div>
        )}

        {/* Last 7 Days summary box */}
        {sorted.length > 0 && (() => {
          const now = new Date()
          // G4 fix: use new Date() minus 7 days (not hardcoded), normalize to local midnight
          const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)

          // G4 fix: safe date parser — appends T00:00:00 to date-only strings to force local time
          const parseLogDate = (dateStr: string | undefined | null): Date | null => {
            if (!dateStr) return null
            // If date-only string (YYYY-MM-DD), parse as local time to avoid UTC offset issues
            const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
              ? new Date(dateStr + 'T00:00:00')
              : new Date(dateStr)
            return isNaN(d.getTime()) ? null : d
          }

          // Filter project logs by date range AND active project filter
          const activeProjectIds = new Set(projects.map(p => p.id))
          const recentProjectLogs = (backup.logs || []).filter((log: any) => {
            if (!activeProjectIds.has(log.projId)) return false
            const logDate = parseLogDate(log.date || log.logDate)
            if (!logDate) return false
            if (logDate < sevenDaysAgo) return false
            if (projFilter !== 'all' && log.projId !== projFilter) return false
            return true
          })

          // Filter service logs — excluded entirely when a specific project is filtered (service logs aren't project-bound)
          const recentServiceLogs = projFilter !== 'all' ? [] : (backup.serviceLogs || []).filter((log: any) => {
            if (!isActiveServiceCall(log)) return false
            const logDate = parseLogDate(log.date)
            if (!logDate) return false
            return logDate >= sevenDaysAgo
          })

          // Compute totals from both log types
          const totalHours = recentProjectLogs.reduce((s, l) => s + num(l.hrs || l.hours), 0) +
                            recentServiceLogs.reduce((s, l) => s + num(l.hours || l.hrs), 0)
          const totalMaterialCost = recentProjectLogs.reduce((s, l) => s + num(l.mat || l.materialCost), 0) +
                                   recentServiceLogs.reduce((s, l) => s + num(l.mat || l.materialCost), 0)
          const totalMiles = recentProjectLogs.reduce((s, l) => s + num(l.miles || l.mileRT), 0) +
                            recentServiceLogs.reduce((s, l) => s + num(l.miles || l.mileRT), 0)
          const totalCollected7d = recentProjectLogs.reduce((s, l) => s + num(l.collected), 0) +
                                  recentServiceLogs.reduce((s, l) => s + num(l.collected), 0)
          const logCount = recentProjectLogs.length + recentServiceLogs.length

          // Derived cost totals using Settings
          const opCost7d = Number(backup.settings?.opCost) || 55
          const mileRate7d = num(backup.settings?.mileRate) || VAN_MILE_RATE
          const totalLaborCost7d = totalHours * opCost7d
          const totalMileageCost7d = totalMiles * mileRate7d
          const totalCost7d = totalLaborCost7d + totalMaterialCost + totalMileageCost7d

          // Project-level remaining balance (current state, not 7-day-sliced)
          let remainingBalNow = 0
          let projQuoteNow = 0
          if (projFilter === 'all') {
            const finAll = calculatePortfolioFinancials(projects, backup.logs || [], mileRate7d, opCost7d)
            remainingBalNow = finAll.remaining_balance
            projQuoteNow = finAll.quote
          } else {
            const proj = projects.find((p: any) => p.id === projFilter)
            if (proj) {
              const finProj = calculateProjectFinancials(proj, backup.logs || [], mileRate7d, opCost7d)
              remainingBalNow = finProj.remaining_balance
              projQuoteNow = finProj.quote
            }
          }
          const balColor7d = getBalanceColor(remainingBalNow, projQuoteNow)

          // Build per-day breakdown from both log types
          const perDayData: Record<string, number> = {}
          for (let i = 0; i < 7; i++) {
            const d = new Date(now)
            d.setDate(d.getDate() - i)
            // Use local date string (YYYY-MM-DD) — matches log.date format
            const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
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
                <div className="grid grid-cols-7 gap-3 text-center">
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Total Hours</div>
                    <div className="text-sm font-bold font-mono text-white">{totalHours.toFixed(1)}h</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Labor Cost</div>
                    <div className="text-[9px] text-gray-600">Hrs × ${opCost7d.toFixed(2)}/hr</div>
                    <div className="text-sm font-bold font-mono text-red-400">{fmt(totalLaborCost7d)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Material Cost</div>
                    <div className="text-sm font-bold font-mono" style={{ color: '#fcd34d' }}>{fmt(totalMaterialCost)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Mileage Cost</div>
                    <div className="text-[9px] text-gray-600">Miles × ${mileRate7d.toFixed(2)}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: '#60a5fa' }}>{fmt(totalMileageCost7d)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Total Costs</div>
                    <div className="text-[9px] text-gray-600">L+M+T</div>
                    <div className="text-sm font-bold font-mono text-red-400">{fmt(totalCost7d)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Remaining Balance</div>
                    <div className="text-[9px] text-gray-600">project, current</div>
                    <div className="text-sm font-bold font-mono" style={{ color: balColor7d }}>{fmt(remainingBalNow)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Collected</div>
                    <div className="text-sm font-bold font-mono text-emerald-400">{fmt(totalCollected7d)}</div>
                  </div>
                </div>
              </div>

              {/* Per-day breakdown bar chart */}
              <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700 p-3">
                <div className="text-[9px] font-bold text-gray-400 uppercase mb-3">Daily Hours — Last 7 Days</div>
                <div className="flex items-end gap-2 h-24">
                  {Object.entries(perDayData).reverse().map(([date, hours]) => {
                    const pct = maxDailyHoursLast7 > 0 ? (hours / maxDailyHoursLast7) * 100 : 0
                    const isToday = date === today()
                    const d = new Date(date + 'T00:00:00')
                    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()]
                    return (
                      <div key={date} className="flex-1 flex flex-col items-center gap-1 text-[10px]">
                        <div className="font-mono font-bold" style={{ color: isToday ? '#6ee7b7' : '#e5e7eb' }}>
                          {hours > 0 ? `${hours.toFixed(1)}h` : '—'}
                        </div>
                        <div
                          className={`w-full rounded-t transition-all ${isToday ? 'bg-emerald-300' : 'bg-emerald-600/50'}`}
                          style={{ height: `${Math.max(hours > 0 ? 4 : 1, pct)}%`, minHeight: hours > 0 ? '8px' : '2px' }}
                          title={`${date}: ${hours.toFixed(1)}h`}
                        />
                        <span className="text-gray-300 font-semibold">{dow}</span>
                        <span className="text-gray-500 text-[9px]">{date.slice(5).replace('-', '/')}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Running Totals Sticky Bar — BUG 3 FIX: uses canonical calculateProjectFinancials ($43/hr internal rate) */}
        {sorted.length > 0 && (() => {
          const totalHours = sorted.reduce((s, l) => s + num(l.hrs), 0)
          const totalMat = sorted.reduce((s, l) => s + num(l.mat), 0)

          // BUG 3 FIX — Canonical formula via calculateProjectFinancials:
          //   remaining_balance = quote − total_costs  (NOT quote − collected)
          //   total_costs = labor ($43/hr) + material + transportation (mileRate)
          //   total_collected tracked SEPARATELY
          const canonMileRate = num(backup.settings?.mileRate) || VAN_MILE_RATE
          let canonFin: ReturnType<typeof calculateProjectFinancials>
          if (projFilter === 'all') {
            canonFin = calculatePortfolioFinancials(projects, sorted, canonMileRate, Number(backup?.settings?.opCost) || 55)
          } else {
            const proj = projects.find((p: any) => p.id === projFilter)
            if (proj) {
              canonFin = calculateProjectFinancials(proj, sorted, canonMileRate, Number(backup?.settings?.opCost) || 55)
            } else {
              canonFin = { quote: 0, labor_cost: 0, material_cost: 0, transportation_cost: 0, total_costs: 0, remaining_balance: 0, total_collected: 0, total_hours: 0, total_miles: 0, mile_rate: canonMileRate }
            }
          }
          const canonBalColor = getBalanceColor(canonFin.remaining_balance, canonFin.quote)

          return (
            <div className="sticky top-0 z-10 bg-[var(--bg-input)] border border-gray-700 rounded-lg p-3 mb-3 shadow-lg">
              <div className="grid grid-cols-7 gap-2 text-center">
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Total Hours Used to Date</div>
                  <div className="text-sm font-bold font-mono text-white">{totalHours.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Labor Cost to Date</div>
                  <div className="text-[9px] text-gray-400">Hrs × ${(Number(backup?.settings?.opCost) || 55).toFixed(2)}/hr</div>
                  <div className="text-sm font-bold font-mono text-red-400">{fmt(canonFin.labor_cost)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Material Cost to Date</div>
                  <div className="text-sm font-bold font-mono" style={{ color: '#fcd34d' }}>{fmt(canonFin.material_cost)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Mileage Cost to Date</div>
                  <div className="text-[9px] text-gray-400">Miles × ${(Number(backup?.settings?.mileRate) || 0.66).toFixed(2)}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: '#60a5fa' }}>{fmt(canonFin.transportation_cost)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Total Costs to Date</div>
                  <div className="text-[9px] text-gray-400">Lbr+Mat+Mil</div>
                  <div className="text-sm font-bold font-mono text-red-400">{fmt(canonFin.total_costs)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Remaining Balance</div>
                  <div className="text-[9px] text-gray-400">Quote−Current Total Cost</div>
                  <div className="text-sm font-bold font-mono" style={{ color: canonBalColor }}>{fmt(canonFin.remaining_balance)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Total Collected to Date</div>
                  <div className="text-sm font-bold font-mono text-emerald-400">{fmt(canonFin.total_collected)}</div>
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
                // Per-entry cumulative data comes from the rollup (sorted oldest→newest internally)
                const projRoll = getRoll(l.projId)
                const rr = projRoll.byId[l.id] || {
                  cumHours: num(l.hrs), cumMiles: num(l.miles), cumCollected: num(l.collected),
                  cumLaborCost: 0, cumMaterialCost: num(l.mat), cumMileageCost: 0, cumTotalCost: 0,
                  entryLaborCost: 0, entryMaterialCost: num(l.mat), entryMileageCost: 0, entryTotalCost: 0,
                  dayCost: 0, actualCostToDate: 0, remainingAfter: projRoll.quote
                }
                const balanceColor = getBalanceColor(num(rr.remainingAfter), projRoll.quote)
                const hasPay = num(l.collected) > 0
                const entryTotalStats = [
                  { label: 'Labor', amount: fmt(num(rr.entryLaborCost)), Icon: Timer, color: '#e5e7eb', bg: 'rgba(229,231,235,0.06)', border: 'rgba(229,231,235,0.16)' },
                  { label: 'Material', amount: fmt(num(l.mat)), Icon: Boxes, color: '#fcd34d', bg: 'rgba(252,211,77,0.08)', border: 'rgba(252,211,77,0.22)' },
                  { label: 'Mileage', amount: fmt(num(rr.entryMileageCost)), Icon: Route, color: '#67e8f9', bg: 'rgba(103,232,249,0.08)', border: 'rgba(103,232,249,0.24)' },
                  { label: 'Total', amount: fmt(num(rr.entryTotalCost)), Icon: CircleDollarSign, color: '#f87171', bg: 'rgba(248,113,113,0.11)', border: 'rgba(248,113,113,0.34)', featured: true },
                ]

              // Daily target indicator
              const todayHours = sorted.filter(x => x.date === today()).reduce((s, x) => s + num(x.hrs), 0)
              const todayLaborCost = todayHours * (num(settings.billRate) || 95)
              const onTarget = todayLaborCost >= dayTarget

              return (
                <div key={l.id} className="space-y-1">
                  {/* Main entry row */}
                  <div
                    className="rounded-lg border border-gray-800 bg-[var(--bg-card)] p-3"
                    style={hasPay ? { background: 'linear-gradient(180deg, rgba(48,209,88,.10), rgba(48,209,88,.04))', borderLeft: '3px solid #10b981' } : { borderLeft: '3px solid #10b981' }}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 w-full space-y-2.5 lg:flex-[1_1_calc(100%-410px)]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="rounded-md border border-cyan-300/10 bg-cyan-400/[0.04] px-2 py-1 font-mono text-[10px] font-semibold text-cyan-100/70">
                            {l.date}
                          </span>
                          <span className="min-w-0 text-[15px] font-extrabold leading-tight text-white">
                            {l.projName}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-cyan-300/35" />
                          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300/80">{l.phase}</span>
                          <span className="text-[11px] font-semibold text-slate-400">{l.emp || 'Me'}</span>
                          {hasPay && <span className="rounded-full border border-emerald-400/20 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-emerald-300">Collected</span>}
                        </div>
                        {l.notes && <div className="w-full text-[12px] font-medium leading-relaxed text-white">{l.notes}</div>}
                        {l.store && (
                          <div className="text-[11px] font-medium text-slate-300">
                            <span className="text-slate-500">Store</span> <span className="text-slate-200">{l.store}</span>
                          </div>
                        )}
                        <div className="flex max-w-full flex-wrap gap-2">
                          <div className="w-[96px] rounded-md border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Hrs</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none text-slate-100">{num(l.hrs).toFixed(1)}</div>
                          </div>
                          <div className="w-[122px] rounded-md border border-amber-300/[0.12] bg-amber-400/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Mat</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#fcd34d' }}>{fmt(num(l.mat))}</div>
                          </div>
                          <div className="w-[98px] rounded-md border border-cyan-300/[0.10] bg-cyan-400/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Miles</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#60a5fa' }}>{num(l.miles)}</div>
                          </div>
                          <div className="w-[132px] rounded-md border border-emerald-300/[0.12] bg-emerald-400/[0.025] px-2.5 py-2">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-500">Coll</div>
                            <div className="mt-0.5 font-mono text-[12px] font-bold leading-none" style={{ color: '#6ee7b7' }}>{fmt(num(l.collected))}</div>
                          </div>
                          <div className="w-[154px] rounded-md border border-cyan-200/[0.14] bg-slate-950/20 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <div className="text-[8px] font-bold uppercase tracking-[0.12em] text-slate-400">Remaining</div>
                            <div className="mt-0.5 font-mono text-[13px] font-extrabold leading-none" style={{ color: balanceColor }}>{fmt(num(rr.remainingAfter))}</div>
                          </div>
                        </div>
                      </div>
                      <div className="ml-auto flex w-full flex-wrap justify-end gap-2 lg:w-auto lg:min-w-[390px] lg:flex-none">
                        {entryTotalStats.map(({ label, amount, Icon, color, bg, border, featured }) => (
                          <div
                            key={label}
                            className={`rounded-lg border text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${featured ? 'min-w-[118px] bg-red-950/10 px-3 py-2.5' : 'min-w-[78px] bg-slate-950/20 px-2.5 py-2'}`}
                            style={{ borderColor: border, boxShadow: featured ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 18px ${bg}` : undefined }}
                          >
                            <div
                              className={`mx-auto mb-1 flex items-center justify-center rounded-md border ${featured ? 'h-7 w-7' : 'h-6 w-6'}`}
                              style={{ color, background: bg, borderColor: border }}
                            >
                              <Icon size={featured ? 15 : 13} strokeWidth={2} />
                            </div>
                            <div className={`${featured ? 'text-[9px]' : 'text-[8px]'} font-bold uppercase tracking-[0.12em] text-gray-400`}>{label}</div>
                            <div className={`mt-0.5 font-mono font-extrabold leading-tight ${featured ? 'text-[15px]' : 'text-[12px]'}`} style={{ color }}>
                              {amount}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Running totals sub-row — cumulative data from rollup */}
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-md border border-white/[0.06] bg-slate-950/20 px-3 py-1.5 text-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Hours</span>
                        <span className="font-mono font-medium text-slate-300">{num(rr.cumHours).toFixed(1)}h</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Mat</span>
                        <span className="font-mono font-medium" style={{ color: '#fcd34d' }}>{fmt(num(rr.cumMaterialCost))}</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Collected</span>
                        <span className="font-mono font-medium text-emerald-400">{fmt(num(rr.cumCollected))}</span>
                      </span>
                      <span className="inline-flex items-baseline gap-1.5">
                        <span className="font-medium text-slate-500">Cum Cost</span>
                        <span className="font-mono font-medium text-red-400">{fmt(num(rr.cumTotalCost))}</span>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {false && todayHours > 0 && (
                        <span style={{ padding: '2px 6px', borderRadius: '3px', background: onTarget ? 'rgba(16,185,129,.2)' : 'rgba(239,68,68,.2)', color: onTarget ? '#10b981' : '#ef4444', fontSize: '9px', fontWeight: 700 }}>
                          {onTarget ? '✓ On Target' : '⚠ Below Target'} ({todayHours.toFixed(1)}h)
                        </span>
                      )}
                      <button onClick={() => beginLogEdit(l.id)} className="rounded-md border border-white/[0.06] bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-slate-300 hover:bg-white/[0.07] hover:text-white">Edit</button>
                      <button onClick={() => deleteLogEntry(l.id)} className="rounded-md border border-red-400/10 bg-red-500/[0.06] px-2.5 py-1 text-[10px] font-semibold text-red-300 hover:bg-red-500/[0.10] hover:text-red-200">Delete</button>
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
            // Spec: labor cost = hours × billing rate (not opCost)
            const summBillRate = num(settings.billRate) || 95
            const summMileRate = num(settings.mileRate) || 0.67
            const projTotalCosts = projTotalMat + (projTotalHrs * summBillRate) + (projTotalMiles * summMileRate)
            // Spec: balance = contract − collected(cumulative) − cumulative total cost
            const balanceLeft = fin.contract - projTotalCollected - projTotalCosts
            const summBalanceColor = getBalanceColor(balanceLeft, fin.contract)

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
                  <span style={{ color: summBalanceColor }}>
                    <span className="text-gray-500">Balance:</span> <span className="font-mono">{fmt(balanceLeft)}</span>
                  </span>
                </div>
              </div>
            )
          })
        })()}

        {/* Running Totals Bar at bottom - Project Log */}
        {sorted.length > 0 && (() => {
          // Single source of truth — same function and same inputs as top summary card
          const footMileRate = num(backup.settings?.mileRate) || VAN_MILE_RATE
          const footOpCost = Number(backup?.settings?.opCost) || 55
          let footFin: ReturnType<typeof calculateProjectFinancials>
          if (projFilter === 'all') {
            footFin = calculatePortfolioFinancials(projects, sorted, footMileRate, footOpCost)
          } else {
            const proj = projects.find((p: any) => p.id === projFilter)
            if (proj) {
              footFin = calculateProjectFinancials(proj, sorted, footMileRate, footOpCost)
            } else {
              footFin = { quote: 0, labor_cost: 0, material_cost: 0, transportation_cost: 0, total_costs: 0, remaining_balance: 0, total_collected: 0, total_hours: 0, total_miles: 0, mile_rate: footMileRate }
            }
          }
          const totalHours = footFin.total_hours
          const totalMat = footFin.material_cost
          const totalCollected = footFin.total_collected
          const totalCost = footFin.total_costs
          const projQuote = footFin.quote
          // Canonical formula: balance = quote − total_costs (collected tracked separately)
          const balanceLeft = footFin.remaining_balance
          const bottomBalanceColor = getBalanceColor(balanceLeft, projQuote)
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
                <span style={{ color: '#9ca3af' }}>
                  Total Labor: <span className="font-mono" style={{ color: '#e5e7eb' }}>{fmt(footFin.labor_cost)}</span>
                </span>
                <span style={{ color: '#f59e0b' }}>
                  Total Mat: <span className="font-mono" style={{ color: '#fcd34d' }}>{fmt(totalMat)}</span>
                </span>
                <span style={{ color: '#60a5fa' }}>
                  Total Mileage: <span className="font-mono" style={{ color: '#60a5fa' }}>{fmt(footFin.transportation_cost)}</span>
                </span>
                <span style={{ color: '#10b981' }}>
                  Total Collected: <span className="font-mono" style={{ color: '#6ee7b7' }}>{fmt(totalCollected)}</span>
                </span>
                <span style={{ color: '#ef4444' }}>
                  Total Cost: <span className="font-mono">{fmt(totalCost)}</span>
                </span>
                {projQuote > 0 && (
                  <span style={{ color: bottomBalanceColor }}>
                    Balance Left: <span className="font-mono">{fmt(balanceLeft)}</span>
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
    const activeServiceLogs = serviceLogs.filter(isActiveServiceCall)
    const filtered = svcFilter === 'all' ? activeServiceLogs : activeServiceLogs.filter(l => l.jtype === svcFilter)
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
              onClick={toggleShowGaps}
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
              onClick={() => setShowArchivedServiceReview(v => !v)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                showArchivedServiceReview
                  ? 'bg-slate-600/30 text-slate-100 border-slate-500/50'
                  : 'bg-slate-700/20 text-slate-300 border-slate-600/30'
              }`}
            >
              <Archive size={12} /> Archived Service Calls ({archivedServiceReviewEntries.length})
            </button>
            <button
              onClick={() => setShowQBImport(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }}
            >
              <FileText size={12} /> Import QB PDF
            </button>
            <button
              onClick={() => { resetSvcForm(); setShowSvcForm(true) }}
              data-testid="new-service-call-button"
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold"
            >
              <Plus size={12} /> New Service Call
            </button>
          </div>
        </div>

        {showArchivedServiceReview && (
          <div className="rounded-xl border border-slate-700/50 bg-slate-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-slate-300 uppercase">
                Archived Service Calls ({archivedServiceReviewEntries.length})
              </div>
              <div className="text-[10px] text-gray-500">Hidden from open/active service queues</div>
            </div>
            {archivedServiceReviewEntries.length === 0 ? (
              <div className="text-xs text-gray-500 py-3">No archived service calls.</div>
            ) : (
              <div className="space-y-2">
                {archivedServiceReviewEntries.map(({ source, label, record }) => {
                  const isLog = source === 'service_log'
                  const amount = isLog ? getServicePaymentMeta(record).quoted : num(record.totalQuote || record.quoted || 0)
                  const status = serviceWorkflowStatus(record) || record.payStatus || record.outcome || 'unknown'
                  const type = record.jobType || record.jtype || record.category || 'Service Call'
                  return (
                    <div key={`${source}-${record.id}`} className="bg-[var(--bg-input)] rounded p-3 border border-slate-700/40">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-gray-200">{canonicalCustomerName(record)}</span>
                            <span className="text-[10px] text-gray-500">{type}</span>
                            <span className="text-[10px] text-gray-500">{record.date || 'No date'}</span>
                            <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-slate-500/20 text-slate-300">
                              Archived {label}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] text-gray-500">
                            Status: {status}
                            {record.archivedAt ? ` · Archived: ${new Date(record.archivedAt).toLocaleString()}` : ''}
                          </div>
                          {record.archivedReason && (
                            <div className="mt-1 text-[10px] text-gray-500">Reason: {record.archivedReason}</div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm font-bold text-slate-200">{fmt(amount)}</div>
                          <div className="mt-2 flex gap-1 justify-end">
                            <button
                              onClick={() => restoreArchivedServiceEntry(source, record.id)}
                              className="text-[9px] px-2 py-1 rounded bg-emerald-700/40 text-emerald-300 hover:bg-emerald-700/60"
                            >
                              Restore
                            </button>
                            <button
                              onClick={() => source === 'service_log' ? deleteSvcEntry(record.id) : source === 'active_call' ? deleteArchivedActiveServiceCall(record.id) : deleteEstimate(record.id)}
                              className="text-[9px] px-2 py-1 rounded bg-gray-700/50 text-gray-400 hover:text-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* STEP 1: New Service Estimate — Modal Trigger */}
        <div className="border-t border-gray-700 pt-4">
          <button
            onClick={() => { resetEstimateForm(); setShowEstimateForm(true) }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold mb-3"
          >
            <Plus size={12} /> New Service Estimate
          </button>
        </div>

        {/* Service Estimate Modal */}
        {showEstimateForm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) resetEstimateForm() }}
          >
            <div
              className="relative w-full max-w-6xl mx-6 rounded-2xl shadow-2xl flex flex-col"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid rgba(59,130,246,0.3)',
                maxHeight: '90vh',
                overflow: 'hidden',
              }}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700/60 flex-shrink-0">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {editEstimateId ? '✏️ Edit Service Estimate' : '⚡ New Service Estimate'}
                  </h2>
                  <p className="text-sm text-gray-400 mt-1">Suggested Quote updates live — Total Quoted is what the customer agreed to</p>
                </div>
                <button
                  onClick={resetEstimateForm}
                  className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
                >✕</button>
              </div>

              {/* Modal Body — scrollable */}
              <div className="flex-1 overflow-y-auto px-4 py-7 space-y-3">

                {/* Row 1A — Relationship account selector */}
                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Relationship Account (Optional)</label>
                    <select
                      value={estAccountId}
                      onChange={e => handleSelectEstimateAccount(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    >
                      <option value="">No linked account</option>
                      {accountOptions.map((acc: any) => (
                        <option key={acc.id} value={acc.id}>{acc.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="self-end">
                    <button
                      type="button"
                      onClick={() => setShowEstimateNewCustomerModal(true)}
                      className="w-full md:w-auto px-3 py-2 rounded bg-cyan-700/40 border border-cyan-700/50 text-cyan-200 text-xs font-semibold hover:bg-cyan-700/60"
                    >
                      + New Customer
                    </button>
                  </div>
                </div>

                {/* Row 1B — Customer / Address / Date */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-1">
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Customer / Job Name</label>
                    <input
                      key={`estCust-${editEstimateId || 'new'}`}
                      defaultValue={estCust}
                      onBlur={e => { setEstCust(e.target.value); setEstCustEdited(true) }}
                      placeholder="e.g. Smith Residence"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div className="md:col-span-1">
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Address</label>
                    <input
                      key={`estAddr-${editEstimateId || 'new'}`}
                      defaultValue={estAddr}
                      onBlur={e => setEstAddr(e.target.value)}
                      placeholder="Job site address"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Date</label>
                    <input
                      type="date"
                      value={estDate}
                      onChange={e => setEstDate(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                {/* Row 2 — Job Type */}
                <div style={{ marginTop: '6px' }}>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Job Type</label>
                  <select
                    value={estJobType}
                    onChange={e => setEstJobType(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  >
                    {JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
                  </select>
                </div>

                {/* Row 3 — Numbers */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Est. Hours</label>
                    <input
                      type="number" step="0.5"
                    defaultValue={estHours}
                    onBlur={e => setEstHours(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-lg px-3 py-3 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Bill Rate $</label>
                    <input
                      type="number" step="0.01"
                      defaultValue={estBillRate}
                      onBlur={e => setEstBillRate(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Materials $</label>
                    <input
                      type="number" step="0.01"
                      defaultValue={estMaterials}
                      onBlur={e => setEstMaterials(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Miles RT</label>
                    <input
                      type="number" step="0.1"
                      defaultValue={estMiles}
                      onBlur={e => setEstMiles(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                {/* Assigned Employees — multi-select, canonical portal identities */}
                <AssignedEmployeesField
                  options={assignableEmployeeOptions}
                  value={estAssignments}
                  onChange={setEstAssignments}
                  accent="blue"
                />

                {/* SERVICE-COST-3B: Costing Crew selector */}
                <CostingCrewField
                  source={estCostingSource}
                  onSourceChange={setEstCostingSource}
                  pricingCrewIds={estPricingCrewIds}
                  onPricingCrewChange={setEstPricingCrewIds}
                  employees={liveEmployees}
                  errors={estimateCrewQuote().errors}
                  accent="blue"
                  mode={estCostingMode}
                  onUpgradeToCrew={() => setEstCostingMode('crew')}
                  onRecalculate={() => {
                    const result = estimateCrewQuote()
                    if (result.snapshot) {
                      setEstFrozenSnapshot(result.snapshot)
                      setEstCostingMode('crew')
                    }
                  }}
                  recalculateDisabled={estimateCrewQuote().errors.length > 0}
                />

                {/* Notes + Material Notes — paired for layout parity with the
                    Service Call modal instead of two stacked full-width blocks. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Notes</label>
                    <textarea
                      key={`estNotes-${editEstimateId || 'new'}`}
                      defaultValue={estNotes}
                      onBlur={e => setEstNotes(e.target.value)}
                      rows={3}
                      placeholder="Scope, special requirements, access notes..."
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors resize-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Material Notes</label>
                    <textarea
                      key={`estMatNotes-${editEstimateId || 'new'}`}
                      defaultValue={estMatNotes}
                      onBlur={e => setEstMatNotes(e.target.value)}
                      rows={3}
                      placeholder="Describe materials purchased or needed..."
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors resize-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                {/* Receipt URL */}
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Receipt URL</label>
                  <div className="flex gap-2">
                    <input
                      key={`estReceiptUrl-${editEstimateId || 'new'}`}
                      defaultValue={estReceiptUrl}
                      onBlur={e => setEstReceiptUrl(e.target.value)}
                      placeholder="Paste receipt or invoice URL..."
                      className="flex-1 rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-blue-500 outline-none transition-colors"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                    {estReceiptUrl && (<a href={estReceiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold transition-colors flex items-center gap-1"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </div>

                {/* Suggested Quote vs Total Quoted — respects legacy/frozen/crew mode */}
                {(() => {
                  const quote = estimateDisplayQuote()
                  const crewResult =
                    estCostingMode === 'frozen' && estFrozenSnapshot
                      ? { breakdown: estFrozenSnapshot, snapshot: estFrozenSnapshot, legacy: false, errors: [] }
                      : estCostingMode === 'legacy'
                        ? { breakdown: null, snapshot: null, legacy: true, errors: [] }
                        : estimateCrewQuote()
                  return (
                    <div className="space-y-3">
                      {/* COST-1.5A: block the quote entirely when a required rate
                          is missing — never show a number built on an invented rate. */}
                      {estMissingRates.length > 0 ? (
                        <ServiceQuoteMissingPanel missing={estMissingRates} accent="blue" />
                      ) : (
                        <ServiceQuotePanel
                          quote={quote}
                          totalQuotedInput={estTotalQuoted === '' ? String(quote.suggestedQuote) : estTotalQuoted}
                          onTotalQuotedChange={(raw) => { setEstTotalQuoted(raw); setEstQuotedManual(true) }}
                          onUseSuggested={() => { setEstTotalQuoted(String(quote.suggestedQuote)); setEstQuotedManual(false) }}
                          dayTarget={dayTarget}
                          mileRate={mileRate}
                          taxRate={taxRate}
                          opCost={opCost}
                          accent="blue"
                        />
                      )}

                      {/* SERVICE-COST-3B: crew cost breakdown detail */}
                      <CrewCostBreakdownPanel
                        result={crewResult}
                        accent="blue"
                      />
                    </div>
                  )
                })()}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between px-8 py-5 border-t border-gray-700/60 flex-shrink-0" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                <button
                  onClick={resetEstimateForm}
                  className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { saveServiceEstimate(); }}
                  disabled={estMissingRates.length > 0}
                  title={estMissingRates.length > 0 ? 'Set the missing pricing settings above before saving.' : undefined}
                  className={`flex items-center gap-2 px-5 py-2 rounded-lg text-white text-xs font-bold transition-colors shadow-lg ${estMissingRates.length > 0 ? 'bg-gray-600 opacity-50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'}`}
                >
                  {editEstimateId ? '✓ Update Estimate' : '⚡ Save as Open Estimate'}
                </button>
              </div>

              {showEstimateNewCustomerModal && (
                <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                  <div className="w-full max-w-2xl rounded-xl border border-cyan-500/30 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-cyan-300">Add Relationship Account</div>
                      <button onClick={() => setShowEstimateNewCustomerModal(false)} className="text-gray-400 hover:text-gray-200">✕</button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      <input value={newCustomerForm.company} onChange={(e) => setNewCustomerForm((f) => ({ ...f, company: e.target.value }))} placeholder="Account / company name" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                      <input value={newCustomerForm.contact} onChange={(e) => setNewCustomerForm((f) => ({ ...f, contact: e.target.value }))} placeholder="Contact name" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                      <select value={newCustomerForm.role} onChange={(e) => setNewCustomerForm((f) => ({ ...f, role: e.target.value }))} className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-cyan-300">
                        {REL_ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input value={newCustomerForm.phone} onChange={(e) => setNewCustomerForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                      <input value={newCustomerForm.email} onChange={(e) => setNewCustomerForm((f) => ({ ...f, email: e.target.value }))} placeholder="Email" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                      <input value={newCustomerForm.address} onChange={(e) => setNewCustomerForm((f) => ({ ...f, address: e.target.value }))} placeholder="Primary address" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                      <input value={newCustomerForm.city} onChange={(e) => setNewCustomerForm((f) => ({ ...f, city: e.target.value }))} placeholder="City" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                      <input value={newCustomerForm.tags} onChange={(e) => setNewCustomerForm((f) => ({ ...f, tags: e.target.value }))} placeholder="Tags / relationship notes" className="px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200" />
                      <textarea value={newCustomerForm.notes} onChange={(e) => setNewCustomerForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" className="md:col-span-2 px-3 py-2 rounded bg-gray-900 border border-gray-700 text-gray-200 h-24" />
                    </div>
                    <div className="flex justify-end gap-2 mt-3">
                      <button onClick={() => setShowEstimateNewCustomerModal(false)} className="px-3 py-2 rounded bg-gray-800 text-gray-300 text-xs">Cancel</button>
                      <button onClick={saveNewCustomerForEstimate} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold">Save Customer</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* STEP 2: Open Estimates Bucket */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}

        {activeServiceEstimates.filter(e => { const s = serviceWorkflowStatus(e); return s === '' || s === 'open' }).length > 0 && (
          <div className="bg-[var(--bg-card)] border border-blue-700/30 rounded-lg p-3 space-y-3">
            <div className="text-xs font-bold text-blue-400 uppercase">
              Open Estimates ({activeServiceEstimates.filter(e => { const s = serviceWorkflowStatus(e); return s === '' || s === 'open' }).length})
            </div>

            <div className="space-y-2">
              {activeServiceEstimates
                .filter(e => { const s = serviceWorkflowStatus(e); return s === '' || s === 'open' })
                .map(est => (
                  <div
                    key={est.id}
                    data-service-estimate-id={est.id}
                    className={`bg-[var(--bg-input)] rounded p-3 space-y-2 ${sourceHighlightId === String(est.id) ? 'ring-2 ring-cyan-400/70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-gray-200">{canonicalCustomerName(est)}</span>
                          <span className="text-[10px] text-gray-500">{est.jobType}</span>
                          <span className="text-[10px] text-gray-500">{est.date}</span>
                          <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-blue-500/20 text-blue-400">
                            Open
                          </span>
                        </div>
                        {est.address && <div className="text-[10px] text-gray-500 mt-1">{est.address}</div>}
                        {summarizeAssignments(normalizeAssignments(est)) && (
                          <div className="text-[10px] text-blue-300/80 mt-1">
                            Assigned: {summarizeAssignments(normalizeAssignments(est))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-[8px] uppercase tracking-wider text-gray-500">Total Quoted</div>
                          <div className="font-mono text-blue-400 font-bold text-sm">{fmt(resolveTotalQuoted(est))}</div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          <button
                            onClick={() => beginEstimateEdit(est.id)}
                            className="text-[10px] px-2.5 py-1 rounded-md font-semibold bg-slate-700/50 text-slate-300 hover:bg-slate-600/60 border border-slate-600/40 hover:border-slate-500 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => archiveEstimate(est.id)}
                            className="text-[10px] px-2.5 py-1 rounded-md font-semibold bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 border border-slate-700/40 hover:border-slate-600 transition-colors"
                          >
                            Archive
                          </button>
                          <button
                            onClick={() => deleteEstimate(est.id)}
                            className="text-[10px] px-2.5 py-1 rounded-md font-semibold text-slate-500 hover:text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/40 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => confirmEstimateToActiveCall(est.id)}
                        className="text-[10px] px-2.5 py-1 rounded-md font-semibold bg-emerald-800/50 text-emerald-200 hover:bg-emerald-700/60 border border-emerald-700/60 hover:border-emerald-500 transition-colors"
                      >
                        Confirm Job
                      </button>
                      <button
                        onClick={() => markEstimateLost(est.id)}
                        className="text-[10px] px-2.5 py-1 rounded-md font-semibold bg-amber-900/30 text-amber-300 hover:bg-amber-800/40 border border-amber-700/40 hover:border-amber-600 transition-colors"
                      >
                        Mark Lost
                      </button>
                    </div>

                    {/* Customer Tracker — only for estimates linked to a portal service call */}
                    {est.hunterLeadId && (
                      <PortalStatusControls hunterLeadId={est.hunterLeadId} />
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════ */}
        {/* STEP 3: Active Service Calls Bucket + Completion Modal */}
        {/* ═══════════════════════════════════════════════════════════════════════ */}

        {activeServiceEstimates.filter(e => serviceWorkflowStatus(e) === 'active').length > 0 && (
          <div className="bg-[var(--bg-card)] border border-emerald-700/30 rounded-lg p-3 space-y-3">
            <div className="text-xs font-bold text-emerald-400 uppercase">
              Active Service Calls ({activeServiceEstimates.filter(e => serviceWorkflowStatus(e) === 'active').length})
            </div>

            <div className="space-y-2">
              {activeServiceEstimates
                .filter(e => serviceWorkflowStatus(e) === 'active')
                .map(est => (
                  <div
                    key={est.id}
                    data-service-estimate-id={est.id}
                    className={`bg-[var(--bg-input)] rounded p-3 space-y-2 ${sourceHighlightId === String(est.id) ? 'ring-2 ring-cyan-400/70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-gray-200">{canonicalCustomerName(est)}</span>
                          <span className="text-[10px] text-gray-500">{est.jobType}</span>
                          <span className="text-[10px] text-gray-500">{est.date}</span>
                          <span className="text-[9px] px-2 py-0.5 rounded font-bold bg-emerald-500/20 text-emerald-400">
                            Active
                          </span>
                        </div>
                        {est.address && <div className="text-[10px] text-gray-500 mt-1">{est.address}</div>}
                        {summarizeAssignments(normalizeAssignments(est)) && (
                          <div className="text-[10px] text-blue-300/80 mt-1">
                            Assigned: {summarizeAssignments(normalizeAssignments(est))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <div className="text-right">
                          <div className="text-[8px] uppercase tracking-wider text-gray-500">Total Quoted</div>
                          <div className="font-mono text-emerald-400 font-bold text-sm">{fmt(resolveTotalQuoted(est))}</div>
                        </div>
                        {completingEstimateId !== est.id && (
                          <div className="flex flex-wrap gap-1.5 justify-end">
                            <button
                              onClick={() => archiveEstimate(est.id)}
                              className="px-3 py-1.5 rounded-md bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 text-xs font-semibold border border-slate-700/40 hover:border-slate-600 transition-colors"
                            >
                              Archive
                            </button>
                            <button
                              onClick={() => deleteEstimate(est.id)}
                              className="px-3 py-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-950/30 text-xs font-semibold border border-transparent hover:border-red-900/40 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        )}
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
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => startCompleteEstimate(est.id)}
                          className="flex-1 px-3 py-1.5 rounded-md bg-emerald-800/50 text-emerald-200 hover:bg-emerald-700/60 text-xs font-semibold border border-emerald-700/60 hover:border-emerald-500 transition-colors"
                        >
                          Log as Complete
                        </button>
                      </div>
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

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* Service Call Modal — New / Edit share this one canonical form.       */}
        {/* Related to the blue New Service Estimate modal but visually its own: */}
        {/* orange wrench identity for service calls.                            */}
        {showSvcForm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            data-testid="service-call-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editSvcId ? 'Edit Service Call' : 'New Service Call'}
            style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) resetSvcForm() }}
          >
            <div
              className="relative w-full max-w-5xl mx-4 sm:mx-6 rounded-2xl shadow-2xl flex flex-col"
              style={{
                backgroundColor: 'var(--bg-card)',
                border: '1px solid rgba(249,115,22,0.35)',
                maxHeight: '90vh',
                overflow: 'hidden',
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-orange-700/30 flex-shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
                    style={{ backgroundColor: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.35)' }}
                  >
                    <ClipboardList size={18} style={{ color: '#f97316' }} />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-lg sm:text-xl font-bold text-white truncate">
                      {editSvcId ? 'Edit Service Call' : 'New Service Call'}
                    </h2>
                    <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
                      Work performed and collected — Total Quoted is the customer amount
                    </p>
                  </div>
                </div>
                <button
                  onClick={resetSvcForm}
                  aria-label="Close"
                  className="text-gray-500 hover:text-white transition-colors text-lg leading-none px-2"
                >✕</button>
              </div>

              {/* Body — scrollable */}
              <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
                {/* Relationship account */}
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Relationship Account (Optional)</label>
                  <select
                    value={slAccountId}
                    onChange={e => handleSelectServiceCallAccount(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none transition-colors"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  >
                    <option value="">No linked account</option>
                    {accountOptions.map((acc: any) => (
                      <option key={acc.id} value={acc.id}>{acc.label}</option>
                    ))}
                  </select>
                </div>

                {/* Customer / Address / Date */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Customer / Job Name</label>
                    <input
                      key={`slCust-${editSvcId || 'new'}`}
                      defaultValue={slCust}
                      onBlur={e => setSlCust(e.target.value)}
                      placeholder="e.g. Smith Residence"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Address</label>
                    <input
                      key={`slAddr-${editSvcId || 'new'}`}
                      defaultValue={slAddr}
                      onBlur={e => setSlAddr(e.target.value)}
                      placeholder="Job site address"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Date</label>
                    <input
                      type="date"
                      value={slDate}
                      onChange={e => setSlDate(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                {/* Job type */}
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Job Type</label>
                  <select
                    value={slJtype}
                    onChange={e => setSlJtype(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  >
                    {JOB_TYPES.map(jt => <option key={jt} value={jt}>{jt}</option>)}
                  </select>
                </div>

                {/* Pricing inputs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Est. Hours</label>
                    <input
                      key={`slEstHrs-${editSvcId || 'new'}`}
                      type="number" step="0.25"
                      defaultValue={slEstHrs}
                      onBlur={e => setSlEstHrs(e.target.value)}
                      placeholder="quoted hrs"
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Actual Hours</label>
                    <input
                      key={`slHrs-${editSvcId || 'new'}`}
                      type="number" step="0.5"
                      defaultValue={slHrs}
                      onBlur={e => setSlHrs(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Bill Rate $</label>
                    <input
                      key={`slBillRate-${editSvcId || 'new'}`}
                      type="number" step="0.01"
                      defaultValue={slBillRate}
                      onBlur={e => setSlBillRate(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Miles RT</label>
                    <input
                      key={`slMi-${editSvcId || 'new'}`}
                      type="number"
                      defaultValue={slMi}
                      onBlur={e => setSlMi(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                {/* Assigned Employees */}
                <AssignedEmployeesField
                  options={assignableEmployeeOptions}
                  value={slAssignments}
                  onChange={setSlAssignments}
                  accent="orange"
                />

                {/* SERVICE-COST-3B: Costing Crew selector */}
                <CostingCrewField
                  source={slCostingSource}
                  onSourceChange={setSlCostingSource}
                  pricingCrewIds={slPricingCrewIds}
                  onPricingCrewChange={setSlPricingCrewIds}
                  employees={liveEmployees}
                  errors={serviceCallCrewQuote().errors}
                  accent="orange"
                  mode={slCostingMode}
                  onUpgradeToCrew={() => setSlCostingMode('crew')}
                  onRecalculate={() => {
                    const result = serviceCallCrewQuote()
                    if (result.snapshot) {
                      setSlFrozenSnapshot(result.snapshot)
                      setSlCostingMode('crew')
                    }
                  }}
                  recalculateDisabled={serviceCallCrewQuote().errors.length > 0}
                />

                {/* Collected + Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Collected $</label>
                    <input
                      key={`slCollected-${editSvcId || 'new'}-${slPayStatus}`}
                      type="number" step="0.01"
                      defaultValue={slCollected}
                      onBlur={e => setSlCollected(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Status</label>
                    <select
                      value={slPayStatus}
                      onChange={e => {
                        // Reflect the reconciliation the save will apply, so the
                        // owner sees the Collected amount their choice implies.
                        const next = e.target.value
                        setSlPayStatus(next)
                        const reconciled = reconcileServicePayment(next, slCollected, serviceCallDisplayQuote().totalQuoted)
                        setSlCollected(reconciled.collected ? String(reconciled.collected) : '')
                      }}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    >
                      <option value="Y">Paid in Full</option>
                      <option value="P">Partial</option>
                      <option value="N">Unpaid</option>
                    </select>
                  </div>
                </div>

                {/* Materials + Store */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                  <VoiceMaterialCapture
                    className="max-w-sm"
                    value={slMat}
                    onChange={setSlMat}
                    priceBook={Array.isArray(backup.priceBook) ? backup.priceBook : (backup.priceBook && typeof backup.priceBook === 'object' ? Object.values(backup.priceBook) : [])}
                    onConfirm={(total, note) => {
                      setSlMat(total > 0 ? total.toFixed(2) : slMat)
                      setSlNotes(prev => prev ? `${prev}
${note}` : note)
                    }}
                  />
                  <div className="max-w-sm">
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Store</label>
                    <input
                      key={`slStore-${editSvcId || 'new'}`}
                      defaultValue={slStore}
                      onBlur={e => setSlStore(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                {/* Emergency material info / Detail link */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Emergency Mat Info</label>
                    <input
                      key={`slEmatInfo-${editSvcId || 'new'}`}
                      defaultValue={slEmatInfo}
                      onBlur={e => setSlEmatInfo(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Detail Link</label>
                    <input
                      key={`slDetailLink-${editSvcId || 'new'}`}
                      defaultValue={slDetailLink}
                      onBlur={e => setSlDetailLink(e.target.value)}
                      className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Notes</label>
                  <textarea
                    key={`slNotes-${editSvcId || 'new'}`}
                    defaultValue={slNotes}
                    onBlur={e => setSlNotes(e.target.value)}
                    rows={3}
                    placeholder="Work performed, materials used, follow-up..."
                    className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none resize-none"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                </div>

                {/* Suggested Quote vs Total Quoted — respects legacy/frozen/crew mode */}
                {(() => {
                  const quote = serviceCallDisplayQuote()
                  const crewResult =
                    slCostingMode === 'frozen' && slFrozenSnapshot
                      ? { breakdown: slFrozenSnapshot, snapshot: slFrozenSnapshot, legacy: false, errors: [] }
                      : slCostingMode === 'legacy'
                        ? { breakdown: null, snapshot: null, legacy: true, errors: [] }
                        : serviceCallCrewQuote()
                  return (
                    <div className="space-y-3">
                      {/* COST-1.5A: block the quote entirely when a required rate
                          is missing — never show a number built on an invented rate. */}
                      {slMissingRates.length > 0 ? (
                        <ServiceQuoteMissingPanel missing={slMissingRates} accent="orange" />
                      ) : (
                        <ServiceQuotePanel
                          quote={quote}
                          totalQuotedInput={slQuoted === '' ? String(quote.suggestedQuote) : slQuoted}
                          onTotalQuotedChange={(raw) => { setSlQuoted(raw); setSlQuotedManual(true) }}
                          onUseSuggested={() => { setSlQuoted(String(quote.suggestedQuote)); setSlQuotedManual(false) }}
                          dayTarget={dayTarget}
                          mileRate={mileRate}
                          taxRate={taxRate}
                          opCost={opCost}
                          accent="orange"
                        />
                      )}

                      {/* SERVICE-COST-3B: crew cost breakdown detail */}
                      <CrewCostBreakdownPanel
                        result={crewResult}
                        accent="orange"
                      />
                    </div>
                  )
                })()}
              </div>

              {/* Footer */}
              <div
                className="flex items-center justify-between px-4 sm:px-8 py-4 border-t border-orange-700/30 flex-shrink-0"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <button
                  onClick={resetSvcForm}
                  className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSvcEntry}
                  disabled={slMissingRates.length > 0}
                  title={slMissingRates.length > 0 ? 'Set the missing pricing settings above before saving.' : undefined}
                  data-testid="save-service-call"
                  className={`flex items-center gap-2 px-5 py-2 rounded-lg text-white text-xs font-bold transition-colors shadow-lg ${slMissingRates.length > 0 ? 'bg-gray-600 opacity-50 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-500'}`}
                >
                  {editSvcId ? '✓ Update Service Call' : '✓ Save Service Call'}
                </button>
              </div>
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
                      <div className="font-semibold text-gray-200">{canonicalCustomerName(l)}</div>
                      <div className="text-gray-500">{l.address} · {l.date}</div>
                      <div className="font-mono text-orange-400 text-xs mt-0.5">
                        {fmt(meta.remaining)} balance due
                        <span className="text-gray-500 font-normal"> · {fmt(meta.quoted)} total quoted</span>
                      </div>
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
                <div
                  key={l.id}
                  data-service-log-id={l.id}
                  className={`rounded-lg border border-gray-800 bg-[var(--bg-card)] p-3 space-y-2 ${sourceHighlightId === String(l.id) ? 'ring-2 ring-cyan-400/70' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-gray-200">{canonicalCustomerName(l)}</span>
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
                      {summarizeAssignments(normalizeAssignments(l)) && (
                        <div className="text-[10px] text-orange-300/80 mt-1">
                          Assigned: {summarizeAssignments(normalizeAssignments(l))}
                        </div>
                      )}
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
                    <div className="text-right text-[10px]" style={{ minWidth: '160px' }}>
                      <div className="font-mono font-bold" style={{ color: '#f7f8ef', fontSize: '12px', marginBottom: '4px' }}>
                        {fmt(roll.totalBillable)} total quoted
                      </div>
                      <div className="font-mono" style={{ color: '#e5e7eb' }}>
                        {num(roll.hrs).toFixed(1)}h × ${num(roll.opCost).toFixed(2)} = <span style={{ fontWeight: 700, color: '#f87171' }}>{fmt(roll.laborCost)} lab</span>
                      </div>
                      <div className="font-mono" style={{ color: '#fcd34d' }}>
                        <span style={{ fontWeight: 700 }}>{fmt(roll.matCost)}</span> mat
                      </div>
                      <div className="font-mono" style={{ color: '#e5e7eb' }}>
                        {num(roll.miles)}mi × ${num(roll.mileRate).toFixed(2)} = <span style={{ fontWeight: 700, color: '#60a5fa' }}>{fmt(roll.mileCost)} mi</span>
                      </div>
                    </div>
                  </div>

                  {/* Ledger rollup */}
                  <div className="bg-[var(--bg-input)] rounded px-2 py-2 text-[10px] space-y-1.5" style={{ border: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Base Quote:</span>
                      <span className="font-mono text-gray-300 font-semibold">{fmt(roll.baseQuoted)}</span>
                    </div>
                    {roll.adjustments.length > 0 && roll.adjustments.map((adj: any, adjIdx: number) => {
                      const typeLabel = getAdjustmentTypeLabel(adj)
                      const desc = getAdjustmentDescription(adj)
                      const amountColor = typeLabel === 'Income' ? '#10b981' : typeLabel === 'Mileage' ? '#60a5fa' : '#f97316'
                      return (
                        <div key={adj.id || `adj-${adjIdx}`} className="flex justify-between gap-2">
                          <span className="text-gray-500 min-w-0">
                            + {typeLabel}
                            {desc && (
                              <span className="text-gray-400 block sm:inline sm:ml-1 truncate" title={desc}>
                                {desc}
                              </span>
                            )}
                          </span>
                          <span className="font-mono font-semibold shrink-0" style={{ color: amountColor }}>
                            {fmt(num(adj.amount))}
                          </span>
                        </div>
                      )
                    })}
                    <div className="flex justify-between font-bold border-t border-gray-700 pt-1.5" style={{ color: '#f7f8ef', fontSize: '11px' }}>
                      <span>Total Billable:</span>
                      <span className="font-mono">{fmt(roll.totalBillable)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-gray-700 pt-1.5" style={{ fontSize: '11px' }}>
                      <span className="text-gray-400">Total Cost:</span>
                      <span className="font-mono" style={{ color: '#f87171' }}>{fmt(roll.totalActual)}</span>
                    </div>
                    {roll.ratesMissing && roll.ratesMissing.length > 0 ? (
                      /* COST-1.5A: a required cost rate is unset — show a warning
                         instead of a profit computed from an invented rate. */
                      <div className="flex justify-between border-t border-gray-700 pt-1.5 gap-2" style={{ fontSize: '11px' }}>
                        <span className="text-amber-400">⚠ Profit unavailable</span>
                        <span className="font-mono text-amber-400 text-right">
                          Set {roll.ratesMissing.map((m: MissingRate) => m.label).join(' & ')} in Settings
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between border-t border-gray-700 pt-1.5" style={{ fontSize: '11px' }}>
                          <span className="text-gray-400">Projected Margin (Quoted {num(roll.estHrs).toFixed(1)} hr):</span>
                          <span className="font-mono font-bold" style={{ color: roll.estimatedProfit >= 0 ? '#378ADD' : '#E24B4A' }}>{fmt(roll.estimatedProfit)}</span>
                        </div>
                        <div className="flex justify-between" style={{ fontSize: '11px' }}>
                          <span className="text-gray-400">Cash Real Margin (Actual {num(l.hrs).toFixed(1)} hr):</span>
                          <span className="font-mono font-bold" style={{ color: roll.projectedProfit >= 0 ? '#1D9E75' : '#E24B4A' }}>{fmt(roll.projectedProfit)}</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Action buttons row */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1 flex-wrap">
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
                      {/* G8: Convert to Estimate — pre-fills the service estimate form */}
                      <button
                        onClick={() => {
                          // Pre-populate the service estimate form above from this service call
                          setEstCust(canonicalCustomerName(l))
                          setEstAccountId((l as any).accountId || '')
                          setEstCustEdited(false)
                          setEstAddr(l.address || l.addr || '')
                          setEstJobType(l.jtype || JOB_TYPES[0])
                          setEstNotes(l.notes || '')
                          setEstHours(String(num(l.hrs || 0) || ''))
                          setEstMaterials(String(num(l.mat || 0) || ''))
                          setEstMiles(String(num(l.miles || l.mileRT || 0) || ''))
                          setEditEstimateId(null)
                          setShowEstimateForm(true)
                          // Scroll form into view
                          setTimeout(() => {
                            const formEl = document.querySelector('[data-estimate-form]')
                            if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          }, 100)
                        }}
                        className="text-[9px] px-2 py-1 rounded bg-blue-600/30 text-blue-400 border border-blue-600/30 hover:bg-blue-600/40 min-h-[28px]"
                      >
                        📋 Convert to Estimate
                      </button>
                    </div>
                    <div className="flex items-center gap-1 justify-end flex-shrink-0">
                      <button onClick={() => beginSvcEdit(l.id)} className="text-[9px] px-2 py-1 rounded bg-gray-700/50 text-gray-300 hover:bg-gray-600/50">Edit</button>
                      <button onClick={() => archiveSvcEntry(l.id)} className="text-[9px] px-2 py-1 rounded bg-slate-700/60 text-slate-300 hover:bg-slate-600/60">Archive</button>
                      <button onClick={() => deleteSvcEntry(l.id)} className="text-[9px] px-2 py-1 rounded border bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25 hover:text-red-200">Delete</button>
                    </div>
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
          const totalQuoted = activeServiceLogs.reduce((s, l) => s + num(l.quoted), 0)
          const totalCollected = activeServiceLogs.reduce((s, l) => s + num(l.collected), 0)
          const totalProfit = activeServiceLogs.reduce((s, l) => s + getServiceRollup(l).projectedProfit, 0)
          const totalMat = activeServiceLogs.reduce((s, l) => s + num(l.mat), 0)
          const totalHrs = activeServiceLogs.reduce((s, l) => s + num(l.hrs), 0)
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
                <span style={{ color: 'var(--t3)' }}>{activeServiceLogs.length} entries</span>
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
    const allSvcLogs = (backup.serviceLogs || []).filter(isActiveServiceCall)
    const allSvcEstimates = (backup.serviceEstimates || []).filter(isActiveServiceCall)
    const allServiceTargets = [
      ...allSvcLogs.map((record: any) => ({ id: String(record.id), kind: 'service_log', record, name: `${canonicalCustomerName(record)} - ${record.date || 'Service log'}` })),
      ...allSvcEstimates.map((record: any) => ({ id: String(record.id), kind: 'service_estimate', record, name: `${canonicalCustomerName(record)} - ${record.date || record.serviceStatus || 'Service call'}` })),
    ].filter((item, idx, arr) => item.id && arr.findIndex(other => other.id === item.id) === idx)

    const buildTriggerStudy = () => {
      if (triggerBucket === 'projects' && triggerJobId !== 'all') {
        const project = allProjects.find(p => String(p.id) === String(triggerJobId))
        if (!project) return null
        const projectLogs = projectLogsFor(backup, project.id)
        const projectRollup = buildProjectLogRollup(backup, project.id)
        const lastRoll = projectRollup.logs.length ? projectRollup.byId[projectRollup.logs[projectRollup.logs.length - 1].id] : null
        const totalMat = projectLogs.reduce((s, l) => s + num(l.mat), 0)
        const totalMiles = projectLogs.reduce((s, l) => s + num(l.miles), 0)
        const totalHours = projectLogs.reduce((s, l) => s + num(l.hrs), 0)
        const totalCost = num(lastRoll?.cumTotalCost)
        const quoted = num(project.contract)
        const data = {
          profit: quoted - totalCost,
          quoted,
          mat: totalMat,
          mileCost: totalMiles * mileRate,
          hrs: totalHours,
          collected: projectLogs.reduce((s, l) => s + num(l.collected), 0),
        }
        return {
          label: project.name || 'Unnamed project',
          typeLabel: isArchivedRecord(project) ? 'Archived project' : 'Project',
          data,
          facts: [
            ['Contract', fmt(quoted)],
            ['Logged hours', totalHours.toFixed(1)],
            ['Material cost', fmt(totalMat)],
            ['Mileage cost', fmt(data.mileCost)],
            ['Rule profit', fmt(data.profit)],
          ],
        }
      }
      if (triggerBucket === 'service' && triggerJobId !== 'all') {
        const target = allServiceTargets.find(item => String(item.id) === String(triggerJobId))
        if (!target) return null
        const record: any = target.record
        const estimateTotal = num(record.quoted || record.total || record.estimateTotal)
        const estimateCost = num(record.actualCost || record.cost || record.materials)
        const roll = target.kind === 'service_log'
          ? getServiceRollup(record)
          : {
              totalBillable: estimateTotal,
              projectedProfit: estimateTotal - estimateCost,
              collected: num(record.collected || record.paymentsCollected),
            }
        const serviceMiles = num(record.miles)
        const data = {
          profit: num(roll.projectedProfit),
          quoted: num(roll.totalBillable),
          mat: num(record.mat || record.materials),
          mileCost: serviceMiles * mileRate,
          hrs: num(record.hrs || record.hours || record.estimatedHours),
          collected: num(roll.collected),
        }
        return {
          label: target.name,
          typeLabel: target.kind === 'service_log' ? 'Service log' : 'Service call',
          data,
          facts: [
            ['Total billable', fmt(data.quoted)],
            ['Hours', data.hrs.toFixed(1)],
            ['Material cost', fmt(data.mat)],
            ['Mileage cost', fmt(data.mileCost)],
            ['Rule profit', fmt(data.profit)],
          ],
        }
      }
      return null
    }

    const triggerStudy = buildTriggerStudy()

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
    const triggerDetails = triggerStudy
      ? filteredRules.map(rule => getTriggerRuleDetail(backup, rule, triggerStudy.data))
      : []
    const activeTriggerDetails = triggerDetails.filter(detail => detail.active)
    const firedTriggerDetails = activeTriggerDetails.filter(detail => detail.hit)
    const attentionTriggerDetails = firedTriggerDetails.filter(detail => detail.needsAttention)

    // Build job dropdown options based on bucket
    const jobOptions = triggerBucket === 'projects'
      ? allProjects.map(p => ({ id: p.id, name: `${p.name || 'Unknown'}${isArchivedRecord(p) ? ' (archived)' : ''}` }))
      : triggerBucket === 'service'
        ? allSvcLogs.slice(-20).map(l => ({ id: l.id, name: `${canonicalCustomerName(l)} — ${l.date || ''}` }))
        : []

    const triggerJobOptions = triggerBucket === 'projects'
      ? allProjects.map(p => ({ id: p.id, name: `${p.name || 'Unknown'}${isArchivedRecord(p) ? ' (archived)' : ''}` }))
      : triggerBucket === 'service'
        ? allServiceTargets.slice(-40).map(item => ({ id: item.id, name: item.name }))
        : []

    const handleAskAI = () => {
      setTriggerAiLoading(true)
      const rulesSummary = filteredRules.map(r => `${r.name} (${r.type}): ${r.situation || ''} → ${r.solution || ''}`).join('\n')
      const bucketLabel = triggerBucket === 'all' ? 'all jobs' : triggerBucket === 'projects' ? 'projects' : 'service calls'
      const studySummary = triggerStudy
        ? `\n\nSelected ${triggerStudy.typeLabel}: ${triggerStudy.label}\nMetrics:\n${triggerStudy.facts.map(([label, value]) => `${label}: ${value}`).join('\n')}\nTriggered rules: ${firedTriggerDetails.length ? firedTriggerDetails.map(detail => `${detail.rule.name}: ${detail.factorLabel} ${formatTriggerFactorValue(detail)} ${detail.comparison} ${formatTriggerThresholdValue(detail)}`).join('; ') : 'none'}`
        : ''
      callClaude({
        system: 'You are NEXUS, the AI operations manager for Power On Solutions, an electrical contractor. Analyze trigger patterns and provide actionable priority recommendations. Be concise.',
        messages: [{ role: 'user', content: `Analyze these ${filteredRules.length} trigger rules for ${bucketLabel}. What are the recurring issues and what should I address first?${studySummary}\n\nRules:\n${rulesSummary}` }],
        max_tokens: 1024,
      }).then(res => {
        setTriggerAiResponse(extractText(res))
      }).catch(() => {
        setTriggerAiResponse('Could not reach AI service. Review your trigger patterns manually — focus on the highest-frequency rules first.')
      }).finally(() => setTriggerAiLoading(false))
    }

    const thresholdEditorMeta = triggerRuleForm
      ? triggerThresholdInputMeta(triggerRuleForm.type || 'bad_day', triggerRuleForm.threshold, dayTarget)
      : null
    const updateTriggerThresholdFromEditor = (rawValue: number) => {
      if (!triggerRuleForm || !thresholdEditorMeta) return
      const nextThreshold = thresholdEditorMeta.mode === 'money'
        ? (dayTarget > 0 ? rawValue / dayTarget : 0)
        : thresholdEditorMeta.mode === 'percent'
          ? rawValue / 100
          : rawValue
      setTriggerRuleForm({
        ...triggerRuleForm,
        threshold: String(Number.isFinite(nextThreshold) ? +nextThreshold.toFixed(4) : 0),
        thresholdLabel: thresholdEditorMeta.label,
      })
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
                  : 'bg-[var(--bg-card)] text-gray-400 hover:text-gray-200 border border-gray-700'
              }`}
            >
              {bucket === 'all' ? 'All' : bucket === 'projects' ? 'Projects' : 'Service Calls'}
            </button>
          ))}
          {triggerBucket !== 'all' && (
            <select
              value={triggerJobId}
              onChange={e => setTriggerJobId(e.target.value)}
              className="bg-[var(--bg-input)] border border-gray-600 rounded px-2 py-1.5 text-xs text-[var(--text-primary)] focus:border-blue-500 outline-none"
            >
              <option value="all">All {triggerBucket === 'projects' ? 'Projects' : 'Service Calls'}</option>
              {triggerJobOptions.map(j => (
                <option key={j.id} value={j.id}>{j.name.substring(0, 40)}</option>
              ))}
            </select>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={startAddTriggerRule}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 transition-all flex items-center gap-1"
            >
              <Plus size={12} /> Add Rule
            </button>
            <button
              onClick={handleAskAI}
              disabled={triggerAiLoading}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-purple-600/20 text-purple-400 border border-purple-600/30 hover:bg-purple-600/30 transition-all disabled:opacity-50 flex items-center gap-1"
            >
              <Sparkles size={12} /> {triggerAiLoading ? 'Analyzing...' : 'Ask AI'}
            </button>
          </div>
        </div>

        {triggerBucket === 'projects' && (
          <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-[10px] text-blue-100/80">
            Archived projects are included here for trigger study only. Other Field Log tabs and dashboards keep their normal active-project filters.
          </div>
        )}

        {triggerStudy && (
          <div className="bg-[var(--bg-card)] border border-blue-500/30 rounded-lg p-4">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-[9px] uppercase font-bold text-blue-300">{triggerStudy.typeLabel} study</div>
                <div className="text-sm font-bold text-gray-100 mt-1">{triggerStudy.label}</div>
              </div>
              <div className={`text-[10px] px-2 py-1 rounded-full border ${firedTriggerDetails.length ? 'border-orange-500/40 bg-orange-500/15 text-orange-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
                {attentionTriggerDetails.length ? `${attentionTriggerDetails.length} rule${attentionTriggerDetails.length === 1 ? '' : 's'} need attention` : firedTriggerDetails.length ? `${firedTriggerDetails.length} positive trigger${firedTriggerDetails.length === 1 ? '' : 's'} active` : 'No active rule hits'}
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
              {triggerStudy.facts.map(([label, value]) => (
                <div key={label} className="rounded border border-gray-700/80 bg-slate-950/35 px-3 py-2">
                  <div className="text-[9px] uppercase font-bold text-gray-500">{label}</div>
                  <div className="text-xs font-mono font-bold text-gray-100 mt-1">{value}</div>
                </div>
              ))}
            </div>
            {attentionTriggerDetails.length > 0 && (
              <div className="mb-3 rounded-lg border border-orange-500/25 bg-orange-500/10 px-3 py-2">
                <div className="text-[9px] uppercase font-bold text-orange-300 mb-1">What needs work</div>
                <div className="space-y-1">
                  {attentionTriggerDetails.map(detail => (
                    <div key={detail.rule.id} className="text-[10px] text-orange-100/90">
                      <span className="font-bold">{detail.rule.name}:</span> {detail.factorLabel} is {formatTriggerFactorValue(detail)} and the threshold is {detail.comparison} {formatTriggerThresholdValue(detail)}.
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-gray-700/80">
              <div className="grid grid-cols-12 gap-2 bg-slate-950/60 px-3 py-2 text-[9px] font-bold uppercase tracking-[0.14em] text-gray-500">
                <div className="col-span-3">Trigger</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Factor</div>
                <div className="col-span-2">Current value</div>
                <div className="col-span-2">Threshold</div>
                <div className="col-span-1 text-right">Tune</div>
              </div>
              <div className="divide-y divide-gray-800/80">
                {triggerDetails.map(detail => (
                  <div key={detail.rule.id} className={`grid grid-cols-12 gap-2 px-3 py-3 text-[10px] ${detail.needsAttention ? 'bg-orange-500/10' : detail.hit ? 'bg-blue-500/10' : detail.active ? 'bg-slate-950/20' : 'bg-slate-950/10 opacity-60'}`}>
                    <div className="col-span-3">
                      <div className="text-xs font-bold text-gray-100">{detail.rule.name}</div>
                      <div className="mt-1 text-[9px] text-gray-500">{detail.rule.type}</div>
                    </div>
                    <div className="col-span-2">
                      <span className={`inline-flex rounded-full border px-2 py-1 ${!detail.active ? 'border-gray-600 bg-gray-700/20 text-gray-400' : detail.needsAttention ? 'border-orange-400/30 bg-orange-500/15 text-orange-200' : detail.hit ? 'border-blue-400/30 bg-blue-500/15 text-blue-200' : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200'}`}>
                        {!detail.active ? 'Inactive' : detail.needsAttention ? 'Needs work' : detail.hit ? 'Activated' : 'Clear'}
                      </span>
                    </div>
                    <div className="col-span-2 text-gray-300">{detail.factorLabel}</div>
                    <div className="col-span-2 font-mono font-bold text-gray-100">{formatTriggerFactorValue(detail)}</div>
                    <div className="col-span-2 text-gray-300">
                      <span className="font-mono">{detail.comparison || '-'}</span> {formatTriggerThresholdValue(detail)}
                    </div>
                    <div className="col-span-1 text-right">
                      <button onClick={() => startEditTriggerRule(detail.rule)} className="rounded p-1.5 text-blue-300 hover:bg-blue-500/10" title="Tune trigger">
                        <Edit3 size={13} />
                      </button>
                    </div>
                    <div className="col-span-12 text-[10px] text-gray-500">{detail.why}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

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
          {editingTriggerRuleId && triggerRuleForm && (
            <div className="bg-[var(--bg-card)] border border-blue-500/40 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold text-blue-200 uppercase">{editingTriggerRuleId === 'new' ? 'Add Trigger Rule' : 'Edit Trigger Rule'}</div>
                <div className="flex gap-2">
                  <button onClick={saveTriggerRuleForm} className="px-3 py-1.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30">Save</button>
                  <button onClick={cancelTriggerRuleEdit} className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-700/70 text-slate-300 border border-slate-600 hover:bg-slate-600/80">Cancel</button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="space-y-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Name</span>
                  <input value={triggerRuleForm.name || ''} onChange={e => setTriggerRuleForm({ ...triggerRuleForm, name: e.target.value })} className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Type</span>
                  <select value={triggerRuleForm.type || 'bad_day'} onChange={e => setTriggerRuleForm({ ...triggerRuleForm, type: e.target.value })} className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500">
                    <option value="bad_day">Bad day</option>
                    <option value="good_day">Good day</option>
                    <option value="travel">Travel</option>
                    <option value="material">Material</option>
                  </select>
                </label>
                <div className="space-y-1 md:col-span-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold">{thresholdEditorMeta?.label || 'Threshold'}</span>
                  <div className="flex items-center gap-2">
                    {thresholdEditorMeta?.mode === 'money' && <span className="text-xs font-bold text-emerald-300">$</span>}
                    <input
                      type="number"
                      value={thresholdEditorMeta?.value ?? triggerRuleForm.threshold ?? ''}
                      min={thresholdEditorMeta?.min}
                      max={thresholdEditorMeta?.max}
                      step={thresholdEditorMeta?.step || 0.01}
                      onChange={e => updateTriggerThresholdFromEditor(Number(e.target.value))}
                      className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500"
                    />
                    {thresholdEditorMeta?.mode === 'percent' && <span className="text-xs font-bold text-blue-300">%</span>}
                  </div>
                  {thresholdEditorMeta && thresholdEditorMeta.mode !== 'number' && (
                    <input
                      type="range"
                      value={thresholdEditorMeta.value}
                      min={thresholdEditorMeta.min}
                      max={thresholdEditorMeta.max}
                      step={thresholdEditorMeta.step}
                      onChange={e => updateTriggerThresholdFromEditor(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                  )}
                  <div className="text-[9px] leading-snug text-gray-500">{thresholdEditorMeta?.helper}</div>
                  <div className="text-[9px] text-gray-600">Stored threshold: {triggerRuleForm.threshold || '0'}</div>
                </div>
                <label className="space-y-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Color</span>
                  <input value={triggerRuleForm.color || ''} onChange={e => setTriggerRuleForm({ ...triggerRuleForm, color: e.target.value })} className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500" placeholder="#3b82f6" />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Situation</span>
                  <textarea value={triggerRuleForm.situation || ''} onChange={e => setTriggerRuleForm({ ...triggerRuleForm, situation: e.target.value })} rows={2} className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500" />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-gray-500 uppercase font-bold">Solution</span>
                  <textarea value={triggerRuleForm.solution || ''} onChange={e => setTriggerRuleForm({ ...triggerRuleForm, solution: e.target.value })} rows={2} className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500" />
                </label>
              </div>
            </div>
          )}
          {filteredRules.length > 0 ? (
            filteredRules.map(rule => (
              <div key={rule.id} className="bg-[var(--bg-card)] border border-gray-700 rounded-lg p-3" style={{ borderLeft: `3px solid ${rule.color || '#f97316'}` }}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div>
                    <div className="text-sm font-bold text-gray-200">{rule.name}</div>
                    <div className="text-[10px] text-gray-500 mt-1">{rule.type} · threshold {pct(Math.round(num(rule.threshold) * 100))}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rule.active || false}
                        onChange={e => toggleTrigger(rule.id, e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-[9px] text-gray-400">{rule.active ? 'Active' : 'Inactive'}</span>
                    </label>
                    <button onClick={() => startEditTriggerRule(rule)} className="p-1.5 rounded text-gray-400 hover:text-blue-300 hover:bg-blue-500/10" title="Edit trigger rule">
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => removeTriggerRule(rule.id)} className="p-1.5 rounded text-gray-400 hover:text-red-300 hover:bg-red-500/10" title="Remove trigger rule">
                      <Trash2 size={13} />
                    </button>
                  </div>
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
    const todaySvc = (backup.serviceLogs || []).filter(l => isActiveServiceCall(l) && l.date === today_str)
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
    .filter(l => isActiveServiceCall(l) && (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.collected), 0)

  // Mat Cost This Week — from both
  const matThisWeek = (backup.logs || [])
    .filter(l => (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.mat), 0)
    + (backup.serviceLogs || [])
    .filter(l => isActiveServiceCall(l) && (l.date || '') >= weekStart)
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
            <div className="text-[9px] text-gray-500 uppercase font-bold">Labor Hours This Week</div>
            <div className="text-sm font-bold text-emerald-400">{hoursThisWeek.toFixed(1)}h</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold">Revenue This Week</div>
            <div className="text-sm font-bold text-blue-400">{fmt(revenueThisWeek)}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold">Materials Cost This Week</div>
            <div className="text-sm font-bold text-orange-400">{fmt(matThisWeek)}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold">Net Revenue This Week</div>
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
            date: s.date, customer: canonicalCustomerName(s), jtype: s.jtype, quoted: s.quoted,
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

// ── SERVICE-LOG-1 shared controls ────────────────────────────────────────────

/**
 * Assigned Employees — multi-select with removable chips.
 *
 * Persists stable identities (employee_profiles.id and/or the BackupData
 * cost-model employee id), never display names or emails. The same employee
 * cannot be added twice, and removing one chip leaves the rest untouched.
 */
export function AssignedEmployeesField({
  options, value, onChange, accent = 'blue',
}: {
  options: any[]
  value: any[]
  onChange: (next: any[]) => void
  accent?: 'blue' | 'orange'
}) {
  const selectedKeys = new Set(value.map(assignmentKey))
  const available = options.filter((o: any) => !selectedKeys.has(o.key))
  const chipClass = accent === 'orange'
    ? 'bg-orange-500/15 border-orange-500/40 text-orange-200'
    : 'bg-blue-500/15 border-blue-500/40 text-blue-200'
  const focusClass = accent === 'orange' ? 'focus:border-orange-500' : 'focus:border-blue-500'

  return (
    <div data-testid="assigned-employees-field">
      <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Assigned Employees</label>
      <select
        value=""
        aria-label="Add assigned employee"
        onChange={(e) => {
          const option = options.find((o: any) => o.key === e.target.value)
          if (!option) return
          onChange(addAssignment(value, {
            employeeId: option.employeeId,
            profileId: option.profileId,
            name: option.name,
          }))
        }}
        className={`w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 ${focusClass} outline-none transition-colors`}
        style={{ backgroundColor: 'var(--bg-input)' }}
      >
        <option value="">{available.length ? 'Add employee…' : 'All employees assigned'}</option>
        {available.map((o: any) => (
          <option key={o.key} value={o.key}>
            {o.name}{o.portalLinked ? '' : ' (no portal account)'}
          </option>
        ))}
      </select>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {value.map((a: any) => {
            const key = assignmentKey(a)
            return (
              <span
                key={key}
                data-assigned-employee-key={key}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${chipClass}`}
              >
                {a.name || 'Unnamed'}
                <button
                  type="button"
                  aria-label={`Remove ${a.name || 'employee'}`}
                  onClick={() => onChange(removeAssignment(value, key))}
                  className="opacity-70 hover:opacity-100"
                >
                  ✕
                </button>
              </span>
            )
          })}
        </div>
      )}
      {value.length === 0 && (
        <p className="text-[10px] text-gray-500 mt-1.5">No one assigned yet.</p>
      )}
    </div>
  )
}

/**
 * SERVICE-COST-3B: Costing Crew selector.
 *
 * Separates the people assigned to the job (Assigned Team) from the crew used
 * for labor/overhead calculations (Costed Field Crew / Pricing Crew).
 */
export function CostingCrewField({
  source,
  onSourceChange,
  pricingCrewIds,
  onPricingCrewChange,
  employees,
  errors,
  accent = 'blue',
  mode,
  onUpgradeToCrew,
  onRecalculate,
  recalculateDisabled,
}: {
  source: 'assigned' | 'pricing'
  onSourceChange: (s: 'assigned' | 'pricing') => void
  pricingCrewIds: string[]
  onPricingCrewChange: (ids: string[]) => void
  employees: any[]
  errors?: string[]
  accent?: 'blue' | 'orange'
  mode?: 'legacy' | 'crew' | 'frozen'
  onUpgradeToCrew?: () => void
  onRecalculate?: () => void
  recalculateDisabled?: boolean
}) {
  const focusClass = accent === 'orange' ? 'focus:border-orange-500' : 'focus:border-blue-500'
  const isLegacy = mode === 'legacy'
  const isFrozen = mode === 'frozen'
  return (
    <div data-testid="costing-crew-field">
      <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Costing Crew</label>

      {isLegacy && (
        <div className="mb-2 rounded-lg border border-amber-700/30 bg-amber-900/20 px-3 py-2">
          <div className="text-[11px] text-amber-200 font-semibold">Legacy Cost Calculation</div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Using settings.opCost compatibility behavior. Upgrade to use crew-aware labor and overhead.
          </p>
          {onUpgradeToCrew && (
            <button
              type="button"
              onClick={onUpgradeToCrew}
              className="mt-1.5 text-[10px] font-semibold underline text-amber-300 hover:text-amber-200"
            >
              Upgrade to Crew Costing
            </button>
          )}
        </div>
      )}

      {isFrozen && (
        <div className="mb-2 rounded-lg border border-cyan-700/30 bg-cyan-900/20 px-3 py-2">
          <div className="text-[11px] text-cyan-200 font-semibold">Frozen Crew Pricing</div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Displayed values are from the saved snapshot. Recalculate to update with current Team rates and overhead.
          </p>
          {onRecalculate && (
            <button
              type="button"
              onClick={onRecalculate}
              disabled={recalculateDisabled}
              className={`mt-1.5 text-[10px] font-semibold underline ${recalculateDisabled ? 'text-gray-500 cursor-not-allowed' : 'text-cyan-300 hover:text-cyan-200'}`}
            >
              Recalculate Crew Pricing
            </button>
          )}
        </div>
      )}

      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={() => onSourceChange('assigned')}
          disabled={isLegacy}
          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition ${
            source === 'assigned'
              ? accent === 'orange'
                ? 'bg-orange-600/30 border-orange-500/50 text-orange-200'
                : 'bg-blue-600/30 border-blue-500/50 text-blue-200'
              : 'bg-[var(--bg-input)] border-gray-700 text-gray-400 hover:border-gray-500'
          } ${isLegacy ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Assigned Field Crew
        </button>
        <button
          type="button"
          onClick={() => onSourceChange('pricing')}
          disabled={isLegacy}
          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition ${
            source === 'pricing'
              ? accent === 'orange'
                ? 'bg-orange-600/30 border-orange-500/50 text-orange-200'
                : 'bg-blue-600/30 border-blue-500/50 text-blue-200'
              : 'bg-[var(--bg-input)] border-gray-700 text-gray-400 hover:border-gray-500'
          } ${isLegacy ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          Pricing Crew
        </button>
      </div>

      {source === 'pricing' && !isLegacy && (
        <select
          multiple
          value={pricingCrewIds}
          onChange={(e) => {
            onPricingCrewChange(Array.from(e.target.selectedOptions).map((o) => o.value))
          }}
          className={`w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 ${focusClass} outline-none transition-colors min-h-[72px]`}
          style={{ backgroundColor: 'var(--bg-input)' }}
        >
          {(employees || [])
            .filter((e: any) => e.status !== 'Inactive' && e.status !== 'Closed')
            .map((e: any) => (
              <option key={e.id} value={e.id}>
                {e.name || e.role || 'Unnamed'} {e.laborCategory ? `(${e.laborCategory})` : '(unclassified)'}
              </option>
            ))}
        </select>
      )}

      {errors && errors.length > 0 && !isLegacy && (
        <div className="mt-2 space-y-1">
          {errors.map((err, i) => (
            <p key={i} className="text-[11px] text-amber-300 bg-amber-900/20 border border-amber-700/30 rounded px-2 py-1">
              ⚠ {err}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * SERVICE-COST-3B: detailed crew cost breakdown panel.
 *
 * Shows per-member labor, overhead recovery, materials, mileage, tax and the
 * resulting total internal cost. Collapses to a compact legacy note when crew
 * costing is not available (errors or fallback to single-rate quote).
 */
export function CrewCostBreakdownPanel({
  result,
  accent = 'blue',
}: {
  result: {
    breakdown: CrewQuoteBreakdown | null
    snapshot: CrewCostSnapshot | null
    legacy: boolean
    errors: string[]
  }
  accent?: 'blue' | 'orange'
}) {
  const color = accent === 'orange' ? 'text-orange-400' : 'text-blue-400'
  const borderColor = accent === 'orange' ? 'border-orange-700/30' : 'border-gray-700/50'

  if (result.legacy || !result.breakdown) {
    return (
      <div className={`rounded-xl border ${borderColor} px-4 py-3`} style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="text-[10px] text-gray-400">
          {result.errors.length > 0 ? (
            <span className="text-amber-300">Crew costing inactive: {result.errors.join(' ')}</span>
          ) : (
            <span>Legacy single-rate quote (no crew cost data). Upgrade to Crew Costing to see crew-aware costs.</span>
          )}
        </div>
      </div>
    )
  }

  const b = result.breakdown
  const isFrozenSnapshot = result.snapshot === result.breakdown

  return (
    <div className={`rounded-xl border ${borderColor} overflow-hidden`} style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <div className="px-4 py-2 border-b border-gray-700/50 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400">
          Crew Cost Breakdown
          {isFrozenSnapshot && <span className="ml-2 text-cyan-400 font-normal normal-case">(frozen snapshot)</span>}
        </div>
        <div className={`text-[10px] ${color}`}>
          {b.crewSource === 'assigned' ? 'Assigned Field Crew' : 'Pricing Crew'} · {b.crewLaborHours.toFixed(1)} crew-hrs
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y divide-gray-700/50">
        <div className="px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Direct Labor</div>
          <div className="font-mono text-xs font-bold text-gray-200">{fmt(b.directLaborCost)}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Overhead Recovery</div>
          <div className="font-mono text-xs font-bold text-red-400">{fmt(b.overheadRecovery)}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Materials</div>
          <div className="font-mono text-xs font-bold text-orange-400">{fmt(b.materialCost)}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Mileage</div>
          <div className="font-mono text-xs font-bold text-blue-400">{fmt(b.mileageCost)}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Sales Tax</div>
          <div className="font-mono text-xs font-bold text-yellow-400">{fmt(b.salesTax)}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Billable Labor</div>
          <div className="font-mono text-xs font-bold text-emerald-300/80">{fmt(b.billableLabor)}</div>
        </div>
        <div className="px-3 py-2 col-span-2 md:col-span-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-0.5">Total Internal Cost</div>
          <div className="font-mono text-sm font-bold text-gray-200">{fmt(b.totalInternalCost)}</div>
        </div>
      </div>

      {b.crew.length > 0 && (
        <div className="border-t border-gray-700/50">
          {b.crew.map((member) => (
            <div key={member.costModelEmployeeId} className="px-4 py-2 flex items-center justify-between text-[11px] border-b border-gray-700/30 last:border-b-0">
              <div className="text-gray-300">
                {member.displayName}
                <span className="text-gray-500 ml-1">· {member.laborHours.toFixed(1)} hrs</span>
              </div>
              <div className="font-mono text-gray-400">
                cost {fmt(member.loadedLaborRate)}/hr · bill {fmt(member.billRate)}/hr
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * COST-1.5A — blocking panel shown in place of the quote when a required pricing
 * setting is missing. It names each missing field and where to set it, and the
 * modal's Save button is disabled alongside it. The app never invents a rate, so
 * the owner sees a clear "not set" message rather than a wrong number that looks
 * right.
 */
export function ServiceQuoteMissingPanel({
  missing,
  accent = 'blue',
}: {
  missing: MissingRate[]
  accent?: 'blue' | 'orange'
}) {
  return (
    <div
      className="rounded-xl border border-amber-500/40 px-4 py-4 space-y-2"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
      data-testid="service-quote-missing-panel"
    >
      <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
        <AlertCircle size={16} /> Quote unavailable — pricing settings not set
      </div>
      <p className="text-xs text-gray-400">
        This quote can’t be calculated because required pricing settings are missing.
        The app won’t guess these values. Set them, then reopen this quote:
      </p>
      <ul className="space-y-1.5">
        {missing.map((m) => (
          <li key={m.key} className="text-xs text-gray-300">
            <span className="font-semibold text-amber-300">{m.label}</span>
            <span className="text-gray-500"> — not set.</span>{' '}
            <span className="text-gray-400">{m.remedy}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Suggested Quote vs Total Quoted breakdown.
 *
 * Suggested Quote / Suggested Profit are informational. Total Quoted is the
 * owner's actual customer price and drives Quote Variance, Actual Estimated
 * Profit, Actual Profit Margin, the cost bar and the daily-target signal.
 */
export function ServiceQuotePanel({
  quote, totalQuotedInput, onTotalQuotedChange, onUseSuggested, dayTarget, mileRate, taxRate, opCost, accent = 'blue',
}: {
  quote: any
  totalQuotedInput: string
  onTotalQuotedChange: (raw: string) => void
  onUseSuggested: () => void
  dayTarget: number
  mileRate: number
  taxRate: number
  opCost: number
  accent?: 'blue' | 'orange'
}) {
  const tone = quoteVarianceTone(quote.quoteVariance)
  const varianceColor = tone === 'above' ? '#34d399' : tone === 'below' ? '#fbbf24' : '#9ca3af'
  const marginPct = quote.actualProfitMargin * 100
  const profit = quote.actualEstimatedProfit
  const total = quote.totalQuoted

  // $5 grid, wide enough to reach well past the suggestion without the max
  // shifting under the thumb mid-drag.
  const sliderMax = Math.max(
    roundUpToQuoteStep(quote.suggestedQuote * 2),
    roundUpToQuoteStep(total),
    1000,
  )
  const sliderValue = Math.min(sliderMax, Math.max(0, snapToQuoteStep(total)))

  const segments = [
    { label: 'Materials', value: quote.materialCost,  color: '#f97316' },
    { label: 'Mileage',   value: quote.mileage,       color: '#60a5fa' },
    { label: 'Tax',       value: quote.tax,           color: '#facc15' },
    { label: 'Op Cost',   value: quote.operatingCost, color: '#f87171' },
    { label: 'Profit',    value: Math.max(0, profit), color: '#34d399' },
  ].filter(s => s.value > 0)
  const barTotal = segments.reduce((s, x) => s + x.value, 0)

  return (
    <div className="space-y-3" data-testid="service-quote-panel">
      <div className="rounded-xl overflow-hidden border border-gray-700/50" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="grid grid-cols-3 divide-x divide-gray-700/50">
          <div className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Material Cost</div>
            <div className="font-mono text-sm font-bold text-orange-400">{fmt(quote.materialCost)}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Mileage <span className="opacity-50">@${mileRate.toFixed(2)}/mi</span></div>
            <div className="font-mono text-sm font-bold text-blue-400">{fmt(quote.mileage)}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Tax <span className="opacity-50">@{taxRate.toFixed(2)}%</span></div>
            <div className="font-mono text-sm font-bold text-yellow-400">{fmt(quote.tax)}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-gray-700/50 border-t border-gray-700/50">
          <div className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Operating Cost <span className="opacity-50">@${opCost.toFixed(2)}/hr</span></div>
            <div className="font-mono text-sm font-bold text-red-400">{fmt(quote.operatingCost)}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Suggested Quote</div>
            <div className="font-mono text-sm font-bold text-gray-200" data-testid="suggested-quote">{fmt(quote.suggestedQuote)}</div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Suggested Profit</div>
            <div className="font-mono text-sm font-bold text-emerald-300/80">{fmt(quote.suggestedProfit)}</div>
          </div>
        </div>
      </div>

      {/* Owner's actual price */}
      <div className="rounded-xl border border-gray-700/50 px-4 py-3 space-y-3" style={{ backgroundColor: 'var(--bg-secondary)' }}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-[9px] uppercase tracking-wider text-gray-400 font-bold mb-1">Total Quoted</label>
            {/* Slider is the primary control — $5 steps, no arrow-spinner fiddling.
                The paired input stays for exact amounts and commits on blur/Enter
                so typing does not re-render the whole Field Log per keystroke. */}
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={sliderMax}
                step={TOTAL_QUOTED_STEP}
                aria-label="Total Quoted slider"
                data-testid="total-quoted-slider"
                value={sliderValue}
                onChange={(e) => onTotalQuotedChange(e.target.value)}
                className="flex-1 min-w-0 accent-orange-500 cursor-pointer"
                style={{ accentColor: accent === 'orange' ? '#f97316' : '#3b82f6' }}
              />
              <input
                key={`total-quoted-${totalQuotedInput}`}
                type="number"
                step={TOTAL_QUOTED_STEP}
                aria-label="Total Quoted"
                data-testid="total-quoted-input"
                defaultValue={totalQuotedInput}
                onBlur={(e) => onTotalQuotedChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                placeholder="0.00"
                className="w-28 flex-shrink-0 rounded-lg px-2 py-2 text-sm font-mono font-bold text-white border border-gray-600 outline-none"
                style={{ backgroundColor: 'var(--bg-input)' }}
              />
            </div>
            <button
              type="button"
              onClick={onUseSuggested}
              className={`mt-1.5 text-[10px] font-semibold underline ${accent === 'orange' ? 'text-orange-300' : 'text-blue-300'}`}
            >
              Use Suggested Quote
            </button>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Quote Variance</div>
            <div className="font-mono text-sm font-bold" style={{ color: varianceColor }} data-testid="quote-variance">
              {formatQuoteVariance(quote.quoteVariance, fmt)}
            </div>
            <div className="text-[9px] text-gray-500 mt-0.5">
              {tone === 'above' && 'Above suggestion'}
              {tone === 'below' && 'Below suggestion'}
              {tone === 'neutral' && 'Matches suggestion'}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">Actual Estimated Profit</div>
            <div className="font-mono text-sm font-bold" style={{ color: profit >= 0 ? '#34d399' : '#ef4444' }} data-testid="actual-estimated-profit">
              {fmt(profit)} <span className="text-[10px] opacity-60">({marginPct.toFixed(1)}%)</span>
            </div>
            <div className="text-[9px] text-gray-500 mt-0.5">Actual Profit Margin</div>
          </div>
        </div>
      </div>

      {/* Cost bar — proportional to the actual customer quote */}
      {barTotal > 0 && (
        <div className="space-y-2">
          <div className="flex rounded-lg overflow-hidden h-6 w-full">
            {segments.map((s, i) => (
              <div
                key={i}
                style={{ width: `${(s.value / barTotal) * 100}%`, backgroundColor: s.color, minWidth: 2 }}
                title={`${s.label}: ${fmt(s.value)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            {segments.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[10px] text-gray-400">{s.label}</span>
                <span className="text-[10px] font-mono font-bold" style={{ color: s.color }}>{fmt(s.value)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily-target signal — uses the ACTUAL customer quote, not the suggestion */}
      {total > 0 && (
        <div className={`rounded-xl px-4 py-3 text-xs border ${
          profit >= dayTarget
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : profit > 0
            ? 'bg-yellow-500/10 border-yellow-500/25 text-yellow-400'
            : 'bg-red-500/10 border-red-500/25 text-red-400'
        }`}>
          {profit >= dayTarget && <span>✅ <strong>Above daily target</strong> — {fmt(profit)} profit ({marginPct.toFixed(1)}% margin) on {fmt(total)} quoted.</span>}
          {profit > 0 && profit < dayTarget && <span>⚠️ <strong>Below daily target</strong> — {fmt(profit)} profit ({marginPct.toFixed(1)}% margin). {fmt(dayTarget - profit)} short.</span>}
          {profit <= 0 && <span>🔴 <strong>Unprofitable</strong> — costs exceed the quoted amount by {fmt(Math.abs(profit))}. Reprice or reduce scope.</span>}
        </div>
      )}
    </div>
  )
}
