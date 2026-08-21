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
import { Plus, Edit3, Trash2, Zap, Filter, Sparkles, TrendingUp, AlertCircle, Archive, Timer, Boxes, Route, CircleDollarSign, X, ClipboardList } from 'lucide-react'
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
import { getCollectedRevenueForRange } from '@/services/collectedRevenueRange'
import { getLiveEmployees } from '@/services/teamScopeMerge'
import { internalLaborRate } from './employeeCostUtils'
import ProjectLogFinancialPanel from './ProjectLogFinancialPanel'
import ProjectLogModalLayout from './ProjectLogModalLayout'
import ServiceCallModalLayout, { ServiceCallSection } from './ServiceCallModalLayout'
import {
  mergeServiceLogsIntoRemote,
  applyResolvedAccountIdToServiceLogs,
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
import { InvoiceDraftsModal } from '@/features/billing-draft/components/InvoiceDraftsModal'
import { PrepareInvoiceModal } from '@/features/billing-draft/components/PrepareInvoiceModal'
import { QuickBooksMenu } from '@/features/billing-draft/components/QuickBooksMenu'
import { PrepareInvoiceSelectorModal } from '@/features/billing-draft/components/PrepareInvoiceSelectorModal'
import { QuickBooksAccountModal } from '@/features/billing-draft/components/QuickBooksAccountModal'
import { filterUnpaidByBalance } from '@/features/billing-draft/unpaidServiceEligibility'
import { useQuickBooksConnection } from '@/features/quickbooks-connection/useQuickBooksConnection'
import { useQuickBooksCustomerMapping } from '@/features/quickbooks-customer-mapping/useQuickBooksCustomerMapping'
import { useCanonicalCustomerDirectory } from '@/features/quickbooks-customer-mapping/useCanonicalCustomerDirectory'
import { isCanonicalCustomerId } from '@/features/quickbooks-customer-mapping/resolvePowerOnCustomerDirectory'
import { ResolvePowerOnCustomerModal } from '@/features/quickbooks-customer-mapping/components/ResolvePowerOnCustomerModal'
import { LinkQuickBooksCustomerModal } from '@/features/quickbooks-customer-mapping/components/LinkQuickBooksCustomerModal'
import type { CustomerDirectoryEntry } from '@/features/quickbooks-customer-mapping/qboCustomerMappingTypes'
import { useQuickBooksInvoicing } from '@/features/billing-draft/useQuickBooksInvoicing'
import { AskAIButton, AskAIPanel } from './AskAIPanel'
import type { Insight } from './AskAIPanel'
import { useDemoMode } from '@/store/demoStore'
import { getDemoBackupData } from '@/services/demoDataService'
import VoiceMaterialCapture from './VoiceMaterialCapture'
import { useAuth } from '@/hooks/useAuth'
import { linkEntityToAccount, upsertRelationshipEvent } from '@/services/relationshipAccountService'
// BUG 3 FIX — Canonical project financials (remaining_balance = quote − costs)
// INTERNAL_LABOR_RATE is deliberately NOT imported: COST-TRUTH-3 makes
// settings.opCost (via internalLaborRate) the only internal labor cost authority,
// and the $43 constant is a legacy default that must never re-enter a cost path.
import { calculateProjectFinancials, calculatePortfolioFinancials, VAN_MILE_RATE } from '@/utils/calculateProjectFinancials'
import { PortalStatusControls } from '@/components/portal/PortalStatusControls'
// SERVICE-LOG-1 — one canonical quote/profit formula path for New, Edit and View.
import {
  computeServiceQuote,
  formatQuoteVariance,
  quoteVarianceTone,
  resolveTotalQuoted,
  isManuallyQuoted,
  resolveEffectiveEstimateBillRate,
  resolveEstimateBillRateSource,
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
  buildServiceLogWithPayment,
  deriveServicePayStatus,
  getServiceLegacyUnknownCash,
  getServicePaymentEvents,
  hasServicePaymentLedger,
  isLiveServicePaymentEvent,
  MONEY_EPSILON,
  recordServicePayment,
  resolveServiceLegacyPayments,
  resolveServiceCollected,
  resolveServiceTotalBillable,
  type ServicePaymentRowLike,
} from '@/features/service-quote/servicePaymentLedger'
import { buildServiceLegacyReconciliationQueue } from '@/features/service-quote/serviceLegacyReconciliationQueue'
import RecordServicePaymentModal, {
  localTodayKey,
  type RecordServicePaymentRequest,
} from './RecordServicePaymentModal'
import {
  syncServiceCallAssignments,
} from '@/services/serviceCallAssignmentService'
// SERVICE-COST-3B — crew-aware labor and overhead recovery.
import {
  buildCostSnapshot,
  computeCrewQuote,
  freezeCostSnapshot,
  quoteFromCostSnapshot,
  resolveCostedCrew,
  validateCrewForCosting,
  type CrewCostSnapshot,
  type CrewQuoteBreakdown,
} from '@/features/service-quote/crewCosting'
import { calculateOverheadMetrics } from '@/utils/costSourceHelper'
import { resolveProjectLaborSource } from '@/utils/costSourceHelper'
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

  // Historical profitability resolves only record-owned snapshot/stored data.
  const hrs = num(l?.hrs)
  const miles = num(l?.miles)
  const matCost = num(l?.mat)
  const acceptedSnapshot = l?.costSnapshot as CrewCostSnapshot | undefined
  const snapshotHourlyCost = acceptedSnapshot
    ? acceptedSnapshot.crew.reduce((sum, member) => sum + num(member.loadedLaborRate), 0)
      + acceptedSnapshot.crew.length * num(acceptedSnapshot.overheadRecoveryRate)
    : 0
  // Historical rows never read today's settings.opCost. Frozen crew records use
  // their accepted rates; legacy rows use only their own stored cost components.
  const hasStoredLegacyLabor = !acceptedSnapshot && Number.isFinite(Number(l?.opCost)) && Number(l?.opCost) > 0
  const opCost = acceptedSnapshot
    ? snapshotHourlyCost
    : hasStoredLegacyLabor && hrs > 0 ? num(l?.opCost) / hrs : 0
  const mileRate = acceptedSnapshot
    ? num(acceptedSnapshot.mileRate)
    : (miles > 0 && Number.isFinite(Number(l?.mileCost)) ? num(l?.mileCost) / miles : 0)
  const ratesMissing: MissingRate[] = (!acceptedSnapshot && !hasStoredLegacyLabor)
    ? [{ key: 'opCost', label: 'Historical operating cost', remedy: 'Exact historical operating-rate metadata is unavailable; the stored legacy model is preserved.' }]
    : []
  const laborCost = acceptedSnapshot ? hrs * snapshotHourlyCost : num(l?.opCost)
  const mileCost = acceptedSnapshot ? miles * mileRate : num(l?.mileCost)
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

/**
 * UNPAID SERVICE AUTHORITY (QBO-2F1) — the single "eligible to invoice" filter
 * for service work. Wraps the existing `serviceBalanceDue()` balance authority
 * (no second definition of unpaid/outstanding/balance) with the shared
 * `filterUnpaidByBalance` threshold+sort (0.009, biggest balance first) — the
 * same rule the Collections queue used inline.
 *
 * Both the Collections queue and the global header Prepare Invoice selector
 * call THIS function, so the two surfaces derive from one rule, not two.
 * `activeLogs` must already be filtered to active service logs by the caller
 * (the Collections queue passes its jtype-filtered `sorted` list; the global
 * selector passes all active service logs). No financial values are mutated.
 */
function getUnpaidServiceCalls(activeLogs: BackupServiceLog[]): BackupServiceLog[] {
  return filterUnpaidByBalance(activeLogs, serviceBalanceDue)
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

function isRetiredDayTargetTriggerType(ruleType: string): boolean {
  return ruleType === 'bad_day' || ruleType === 'good_day'
}

function getFiredTriggerNames(backup: BackupData, data: any): string[] {
  const names: string[] = []
  for (const r of (backup.triggerRules || [])) {
    if (!r.active) continue
    if (isRetiredDayTargetTriggerType(String(r.type || '').trim())) continue
    let hit = false
    if (r.type === 'travel' && num(data.quoted) > 0 && num(data.mileCost) > num(data.quoted) * num(r.threshold)) hit = true
    if (r.type === 'material' && num(data.quoted) > 0 && num(data.mat) > num(data.quoted) * num(r.threshold)) hit = true
    if (hit) names.push(r.name)
  }
  return names
}

function getTriggerRuleDetail(backup: BackupData, rule: BackupTriggerRule, data: any): any {
  const thresholdRatio = num(rule.threshold)
  const quoted = num(data.quoted)
  const type = String(rule.type || '').trim()
  const retired = isRetiredDayTargetTriggerType(type)
  let currentValue = 0
  let thresholdValue = 0
  let comparison = ''
  let factorLabel = 'Value'
  let thresholdLabel = rule.thresholdLabel || 'Threshold'
  let unit: 'money' | 'percent' | 'number' = 'number'
  let hit = false
  let why = 'Rule type is not mapped to a measurable trigger factor yet.'

  if (retired) {
    factorLabel = 'Retired'
    thresholdLabel = 'Retired'
    why = 'This condition was disabled because Daily Target now measures whole-business collected revenue, not per-job service profit.'
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
    active: !retired && rule.active !== false,
    retired,
    hit: !retired && rule.active !== false && hit,
    needsAttention: !retired && rule.active !== false && hit,
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
  if (detail.retired) return 'Retired'
  if (detail.unit === 'money') return fmt(detail.currentValue)
  if (detail.unit === 'percent') return pct(Math.round(num(detail.currentValue) * 100))
  return String(detail.currentValue)
}

function formatTriggerThresholdValue(detail: any): string {
  if (detail.retired) return 'Retired'
  if (detail.unit === 'money') return fmt(detail.thresholdValue)
  if (detail.unit === 'percent') return pct(Math.round(num(detail.thresholdValue) * 100))
  return String(detail.thresholdValue)
}

function triggerThresholdInputMeta(ruleType: string, threshold: any): any {
  const type = String(ruleType || '').trim()
  const ratio = num(threshold)
  if (isRetiredDayTargetTriggerType(type)) {
    return {
      mode: 'disabled',
      label: 'Retired condition',
      helper: 'This legacy trigger depended on Daily Target as a per-job profit threshold and no longer runs.',
      value: 0,
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
  // FORENSIC-KPI-2B1: new service calls with collected > 0 need a real received date.
  const [slReceivedAt, setSlReceivedAt] = useState(localTodayKey())
  const [slStore, setSlStore] = useState('')
  const [slJtype, setSlJtype] = useState(JOB_TYPES[0])
  const [slPayStatus, setSlPayStatus] = useState('Y')
  // FORENSIC-KPI-2B1: pending real-payment capture (amount + actual received date).
  const [payRequest, setPayRequest] = useState<RecordServicePaymentRequest | null>(null)
  // FORENSIC-KPI-2B2-2D: legacy-date resolution form. Owner assigns real received
  // dates to undated historical collected cash WITHOUT changing the amount.
  const [legacyResolveOpen, setLegacyResolveOpen] = useState(false)
  const [legacyResolveRows, setLegacyResolveRows] = useState<{ amount: string; receivedAt: string; note: string }[]>([])
  const [slEmatInfo, setSlEmatInfo] = useState('')
  const [slDetailLink, setSlDetailLink] = useState('')
  const [slNotes, setSlNotes] = useState('')
  // Service Estimate workflow state (Step 1-3)
  const [showEstimateForm, setShowEstimateForm] = useState(false)
  // Prepare Invoice (owner-approved billing draft) — opened from a service log row.
  const [prepareSvcLog, setPrepareSvcLog] = useState<BackupServiceLog | null>(null)
  // QBO-2F1: global header "Prepare Invoice" selector — opened when the owner
  // picks QuickBooks ▾ → Prepare Invoice with no individual source selected.
  // Lists only eligible unpaid service work (shared unpaid authority) and opens
  // the existing PrepareInvoiceModal for the chosen service log.
  const [showPrepareInvoiceSelector, setShowPrepareInvoiceSelector] = useState(false)
  // QBO-2F: shared QuickBooks menu + organization-wide Invoice Drafts manager.
  const qb = useQuickBooksInvoicing()
  // QBO-3A: persistent QuickBooks connection state for the global menu (status,
  // connect, account modal, disconnect). Connection is NOT required for any
  // billing preparation below — Prepare Invoice / Drafts / Import PDF stay
  // available regardless of connection state.
  const conn = useQuickBooksConnection()
  // QBO-4A.5-RUN-3 — lazy, ACTIVE-ROW-ONLY customer resolution/link for the actual
  // Field Log service-log row. Only ONE row is ever active (the one the owner clicked
  // Resolve/Link on). The modals/controllers mount ONLY when an id is set, so there is
  // NO per-row useQuickBooksCustomerMapping fetch on initial page render — the QBO
  // mapping status loads once, lazily, for the single selected row (see
  // FieldLogQboLinkController + the Resolve modal render below).
  const [resolveTargetId, setResolveTargetId] = useState<string | null>(null)
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null)
  const openPrepareInvoice = useCallback((l: BackupServiceLog) => {
    qb.clearPrepareDraft()
    setPrepareSvcLog(l)
  }, [qb])
  const closePrepareInvoice = useCallback(() => {
    setPrepareSvcLog(null)
    qb.clearPrepareDraft()
  }, [qb])
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
  const [estBillRateSource, setEstBillRateSource] = useState<'default' | 'manual'>('default')
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
  const [estPreviousSnapshot, setEstPreviousSnapshot] = useState<CrewCostSnapshot | null>(null)
  const [estLegacyVersion, setEstLegacyVersion] = useState<any | null>(null)
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
  // FORENSIC-KPI-2B1: completion cash needs a real received date, not the service date.
  const [paymentReceivedAt, setPaymentReceivedAt] = useState(localTodayKey())
  const [paymentStatus, setPaymentStatus] = useState('Unpaid')
  const [completionVariance, setCompletionVariance] = useState<any>(null)
  const [showArchivedServiceReview, setShowArchivedServiceReview] = useState(false)
  // FORENSIC-KPI-2B2-2G: Historical Service Payment Reconciliation work queue.
  // A discovery layer over the existing resolveServiceLegacyPayments resolver —
  // finds undated historical collected cash so the owner does not have to open
  // every old Service Call. Membership is derived from getServiceLegacyUnknownCash
  // (the SAME authority the resolver uses), so the queue and resolver can never
  // disagree about what "undated" means. No mutation happens here; Resolve routes
  // into the existing Edit Service Call Payment History resolver + scoped save.
  const [showHistoricalPayments, setShowHistoricalPayments] = useState(false)
  const [historicalFilter, setHistoricalFilter] = useState('')

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
  // QBO-4A.5-RUN-3 — Clear a dangling Resolve/Link target if its log was
  // deleted/archived while the modal was open. Moved BELOW the `backup`/
  // `serviceLogs` declarations: the dependency array is evaluated at render
  // time, so referencing `backup.serviceLogs` here-before-`const backup` was a
  // temporal-dead-zone ReferenceError ("Cannot access 'backup' before
  // initialization"). Uses the already-initialized `serviceLogs` const.
  useEffect(() => {
    if (resolveTargetId && !serviceLogs.some((l) => l.id === resolveTargetId)) setResolveTargetId(null)
    if (linkTargetId && !serviceLogs.some((l) => l.id === linkTargetId)) setLinkTargetId(null)
  }, [serviceLogs, resolveTargetId, linkTargetId])
  // FORENSIC-KPI-2B2-2G: reconciliation queue derived read-only from the SAME
  // unknown-cash authority the resolver uses. Recomputed each render so it tracks
  // saves immediately; O(active service logs), same cost as the other service filters.
  const reconciliationQueue = buildServiceLegacyReconciliationQueue(serviceLogs, { isActive: isActiveServiceCall })
  const gcContacts = backup.gcContacts || []
  const accountOptions = gcContacts.map((gc: any) => ({
    id: String(gc.id || ''),
    label: [gc.company || 'Unnamed', gc.contact ? `(${gc.contact})` : ''].filter(Boolean).join(' ').trim(),
  }))
  const canonicalCustomerName = (record: any): string => {
    return resolveCanonicalCustomerName(record, gcContacts)
  }
  // QBO-4A.5-RUN-3 — PowerOn customer directory projected from backup.gcContacts
  // (the in-memory projection of relationship_accounts). Fed to the Resolve + Link
  // modals for the ACTIVE service-log row only. selectableResolveEntries filters
  // this to CANONICAL ids only (present in canonicalIds — relationship_accounts.id,
  // a TEXT id; NOT a UUID format check), so the owner can only ever confirm a real
  // PowerOn account. Built once per render from the same gcContacts already in scope
  // (no extra read, no network).
  const customerDirectory: readonly CustomerDirectoryEntry[] = useMemo(
    () => (gcContacts || []).map((c: any) => ({
      id: String(c.id ?? ''),
      company: c.company || null,
      contact: c.contact || null,
      email: c.email || null,
      phone: c.phone || null,
    })),
    [gcContacts],
  )
  // QBO-4A.6: the canonical PowerOn customer identity authority (relationship_accounts.id,
  // a TEXT PK — NOT a UUID). This single shared fetch (module-cached across surfaces)
  // provides canonicalIds (the identity predicate for STATE 1/2 derivation +
  // selectableResolveEntries) and the authoritative directory the Resolve modal renders.
  // During load canonicalIds is empty → rows stay STATE 1 (safe default); the modal shows
  // a loading state instead of a false "no customers".
  const canonicalDirectory = useCanonicalCustomerDirectory()
  const canonicalIds = canonicalDirectory.canonicalIds
  // Full array kept for historical name resolution; liveEmployees drives the
  // employee pickers for new/edited logs (Phase 6S-C: hide deleted/inactive).
  const employees = backup.employees || []
  const liveEmployees = getLiveEmployees(employees)
  const projectLaborRateForLog = useCallback((log: any) => {
    return resolveProjectLaborSource(backup?.settings, employees, log?.empId, log?.emp).internalLaborRate
  }, [backup?.settings, employees])
  const sumProjectLaborCost = useCallback((logsToSum: any[]) => {
    return (logsToSum || []).reduce((sum: number, log: any) => sum + (num(log?.hrs) * projectLaborRateForLog(log)), 0)
  }, [projectLaborRateForLog])
  const triggerRules = backup.triggerRules || []
  const settings = backup.settings || {} as any
  // COST-1.5A: read the raw setting, never invent a fallback rate. When a value is
  // missing the modal blocks the quote (see estMissingRates / slMissingRates) — a
  // wrong number is never shown.
  const mileRate = num(settings.mileRate)
  const opCost = num(settings.opCost)

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
  async function saveServiceLogsScoped(
    incomingBackup: BackupData = backup,
    postMerge?: (logs: BackupServiceLog[]) => BackupServiceLog[],
  ): Promise<boolean> {
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
        // QBO-4A.5-RUN-3 — optional post-merge force. Used by the Resolve handler to
        // layer accountId onto the LWW winner AFTER mergeServiceLogsIntoRemote has
        // chosen the winner by each row's REAL updatedAt. Because the local mutation
        // does NOT bump updatedAt (identity-only), a stale-local row never wins LWW
        // over a newer remote FINANCIAL edit; identity is layered onto whichever row
        // the merge already chose, so it persists without ever risking a financial
        // revert. See applyResolvedAccountIdToServiceLogs (pure, single source).
        if (postMerge) merged.serviceLogs = postMerge(merged.serviceLogs || [])
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
   * QBO-4A.5-RUN-3 — Resolve the canonical PowerOn customer for a Field Log
   * service-log row (STATE 1 → STATE 2 transition). The owner explicitly selects an
   * existing reconciled relationship_accounts UUID in ResolvePowerOnCustomerModal;
   * this persists it onto the row's canonical `accountId` field through the EXISTING
   * service.calls scoped-save path.
   *
   * FINANCIAL FIREWALL (identical to RUN-2): identity-only. applyResolvedAccountIdToServiceLogs
   * touches ONLY accountId — it does NOT bump updatedAt and writes NO financial field.
   * Bumping updatedAt would make a stale-local row win LWW (pickServiceLogWinner
   * compares updatedAt) over a NEWER remote financial edit on the same log, clobbering
   * collected/payments/status. Instead the local mutation keeps the row's real
   * updatedAt (remote's newer financials win LWW), and the postMerge force layers
   * accountId onto the LWW winner AFTER mergeServiceLogsIntoRemote has chosen it — so
   * identity persists without ever risking a financial revert.
   *
   * Predicate-scoped: only the row whose id === logId changes; every other row is
   * returned unchanged (same reference, no spread, no mutation). No Migrate reuse, no
   * QBO API write, no direct fetch — only the backup scoped sync.
   */
  const resolveFieldLogCustomer = useCallback(
    async (logId: string, accountUuid: string): Promise<void> => {
      // Optimistic local mutation (identity-only, no updatedAt bump).
      backup.serviceLogs = applyResolvedAccountIdToServiceLogs(
        backup.serviceLogs,
        logId,
        accountUuid,
      )
      // Scoped save + post-merge force onto the LWW winner. The SAME pure helper is
      // used for BOTH the optimistic mutation and the post-merge force, so the subtle
      // financial-neutral layering is defined in ONE place (serviceScopeMerge.ts).
      await saveServiceLogsScoped(backup, (logs) =>
        applyResolvedAccountIdToServiceLogs(logs, logId, accountUuid),
      )
      setResolveTargetId(null)
      // Immediate visible transition to STATE 2 (Link) without a full reload — the
      // row now has a UUID so its menu re-renders Link, and linkTargetId is primed
      // to open the Link modal straight away if the owner wants.
      setLinkTargetId(logId)
      forceUpdate()
    },
    [backup, forceUpdate],
  )

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

  useEffect(() => {
    if (showEstimateForm && estBillRateSource === 'default') {
      setEstBillRate(billRate > 0 ? String(billRate) : '')
    }
  }, [billRate, estBillRateSource, showEstimateForm])

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
    estimateBillRate: number
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
      {
        strictFinancialInputs: true,
        payrollMult: settings.payrollMult,
        estimateBillRate: args.estimateBillRate,
      },
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
      estimateBillRate: args.estimateBillRate,
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
    setEstBillRateSource('default')
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
    setEstPreviousSnapshot(null)
    setEstLegacyVersion(null)
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
    const estRate = parseFloat(estBillRate) || 0

    // OPEN pricing is always live. Ordinary Save stores comparison metadata only;
    // it never creates historical authority.
    const crewResult = estimateCrewQuote()
    if (!crewResult.breakdown || !crewResult.snapshot) {
      alert(crewResult.errors.join('\n') || 'Current live pricing inputs are incomplete.')
      return
    }
    const quote = crewBreakdownToLegacyQuote(
      crewResult.breakdown,
      estTotalQuoted === '' ? null : parseFloat(estTotalQuoted) || 0,
    )
    const estimateSnapshot: CrewCostSnapshot = crewResult.snapshot
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
      billRateSource: estBillRateSource,
      estMaterials: estMat,
      milesRT: estMi,
      notes: estNotes,
      assignedEmployees: estAssignments,
      // SERVICE-COST-3B: owner-only cost snapshot. Never sent to Employee Portal.
      costSnapshot: estimateSnapshot,
      pricingCrewIds: estPricingCrewIds,
      costingSource: estCostingSource,
      legacyPricing: estLegacyVersion || undefined,
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
    const loadedBillRateSource = resolveEstimateBillRateSource(est, settings.billRate)
    const loadedBillRate = resolveEffectiveEstimateBillRate(est, settings.billRate)
    setEstBillRate(String(loadedBillRate || ''))
    setEstBillRateSource(loadedBillRateSource)
    setEstMaterials(String(est.estMaterials || 0))
    setEstMiles(String(est.milesRT || 0))
    setEstNotes(est.notes || '')
    // SERVICE-LOG-1: the stored quote IS the customer's Total Quoted. Suggested
    // Quote is recalculated live from the current cost inputs and never
    // overwrites the historical customer number.
    const loadedQuote = resolveTotalQuoted(est)
    const suggested = quoteFor({
      hours: num(est.estHours),
      billRate: loadedBillRate,
      materials: num(est.estMaterials),
      miles: num(est.milesRT),
    }).suggestedQuote
    setEstTotalQuoted(String(loadedQuote))
    setEstQuotedManual(isManuallyQuoted(est, suggested))
    setEstAssignments(hydrateAssignmentIdentities(normalizeAssignments(est), assignableEmployeeOptions))
    // An OPEN snapshot is previous-reference metadata, never frozen authority.
    // Legacy rows keep an explicit original-version label while current live cost
    // is resolved from today's canonical Team + overhead inputs.
    const savedSnapshot = (est as any).costSnapshot as CrewCostSnapshot | undefined
    if (savedSnapshot) {
      setEstCostingMode('crew')
      setEstPreviousSnapshot(savedSnapshot)
      setEstFrozenSnapshot(null)
      setEstLegacyVersion((est as any).legacyPricing || null)
    } else {
      const storedOperatingRate = Number((est as any).operatingCostRate ?? (est as any).opCostRate)
      setEstCostingMode('crew')
      setEstFrozenSnapshot(null)
      setEstPreviousSnapshot(null)
      setEstLegacyVersion((est as any).legacyPricing || {
        pricingModel: 'solo-legacy',
        originalQuote: resolveTotalQuoted(est),
        ...(Number.isFinite(storedOperatingRate) && storedOperatingRate > 0
          ? { storedOperatingCostRate: storedOperatingRate }
          : {}),
      })
    }
    const savedCrewSource = savedSnapshot?.crewSource || (est as any).costingSource || 'assigned'
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
    const now = new Date().toISOString()
    const settingsGate = resolveRequiredServiceRates(settings, { mode: 'crew' }).missing
    const liveResult = estimateCrewQuoteForRecord(est)
    if (settingsGate.length || !liveResult.breakdown || !liveResult.snapshot) {
      const messages = [
        ...settingsGate.map((missing) => `${missing.label}: ${missing.remedy}`),
        ...liveResult.errors,
      ]
      alert(`Cannot Confirm Job until current live cost is valid:\n\n${messages.join('\n')}`)
      return
    }
    const frozenSnapshot = freezeCostSnapshot(liveResult.snapshot, now)
    const effectiveBillRate = resolveEffectiveEstimateBillRate(est, settings.billRate)
    const billRateSource = resolveEstimateBillRateSource(est, settings.billRate)
    const priorSnapshot = (est as any).costSnapshot as CrewCostSnapshot | undefined
    const legacyPricing = (est as any).legacyPricing || (!priorSnapshot ? {
      pricingModel: 'solo-legacy',
      originalQuote: resolveTotalQuoted(est),
      historicalCostModelPreserved: true,
    } : undefined)

    pushState(backup)
    // Phase 6R-B: mark the source estimate active (stamp identity/updatedAt) and
    // create the active call with a DISTINCT activeServiceCallId + fromEstimateId
    // link (avoids the old same-id ambiguity across the two arrays). Display still
    // reads the estimate's status, so UI behavior is unchanged.
    const acceptedEstimate: any = ensureServiceEstimateIdentity({
      ...est,
      status: 'active',
      updatedAt: now,
      billRate: effectiveBillRate,
      billRateSource,
      suggestedQuote: liveResult.breakdown.suggestedQuote,
      costSnapshot: frozenSnapshot,
      legacyPricing,
    })
    backup.serviceEstimates = serviceEstimates.map(e => e.id === estimateId ? acceptedEstimate : e)
    const activeEntry: any = ensureActiveServiceCallIdentity({
      ...acceptedEstimate,
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
    setPaymentReceivedAt(localTodayKey())
    setPaymentStatus('Unpaid')
    setCompletionVariance(null)
  }

  async function completeAndLogService() {
    const est = serviceEstimates.find(e => e.id === completingEstimateId)
    if (!est) return

    const actHrs = parseFloat(actualHours) || 0
    const actMat = parseFloat(actualMaterials) || 0
    const actMi = parseFloat(actualMiles) || 0
    const typedCollected = parseFloat(paymentCollected) || 0

    const acceptedSnapshot = (est as any).costSnapshot as CrewCostSnapshot | undefined
    const acceptedCrewHourlyCost = acceptedSnapshot
      ? acceptedSnapshot.crew.reduce((sum, member) => sum + num(member.loadedLaborRate), 0)
        + (acceptedSnapshot.crew.length * num(acceptedSnapshot.overheadRecoveryRate))
      : 0
    const mileageCost = acceptedSnapshot ? actMi * num(acceptedSnapshot.mileRate) : 0
    const labCost = acceptedSnapshot ? actHrs * acceptedCrewHourlyCost : 0

    pushState(backup)

    // SERVICE-LOG-1: the estimate's Total Quoted is the customer agreement and
    // carries through the conversion untouched; assignments come with it.
    const carriedTotalQuoted = resolveTotalQuoted(est)
    const carriedAssignments = normalizeAssignments(est)

    // Create service log entry
    let logEntry: any = {
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
      costSnapshot: acceptedSnapshot,
      legacyPricing: (est as any).legacyPricing,
      historicalCostUnavailable: !acceptedSnapshot,
      mat: actMat,
      collected: typedCollected,
      store: '',
      notes: est.notes,
      ...(acceptedSnapshot ? {
        mileCost: mileageCost,
        opCost: labCost,
        profit: typedCollected - actMat - mileageCost - labCost,
      } : {}),
    }

    // FORENSIC-KPI-2B1: owner-entered cash at completion must create a real payment
    // event with the captured received date. No date is ever fabricated.
    if (typedCollected > MONEY_EPSILON) {
      if (!paymentReceivedAt) {
        alert('Select the date the payment was received.')
        return
      }
      const paymentResult = buildServiceLogWithPayment(logEntry, {
        amount: typedCollected,
        receivedAt: paymentReceivedAt,
      })
      if (!paymentResult.ok) {
        alert(paymentResult.message)
        return
      }
      logEntry = paymentResult.row
    }

    // FORENSIC-KPI-2B1: the completion Payment Status selector is workflow UX only.
    // It cannot manufacture or erase cash. Reconcile the owner's choice against the
    // actual collected amount; a contradiction is refused and leaves the ledger alone.
    const requestedStatusCode: 'Y' | 'P' | 'N' = paymentStatus === 'Paid'
      ? 'Y'
      : paymentStatus === 'Partial'
        ? 'P'
        : 'N'
    const reconcile = reconcileServicePayment(requestedStatusCode, logEntry.collected, carriedTotalQuoted)
    if (reconcile.blocked) {
      alert(reconcile.message || 'Selected payment status does not match the recorded amount.')
      return
    }
    logEntry.payStatus = reconcile.payStatus
    logEntry.balanceDue = reconcile.balanceDue

    // Phase 6R-B: identity-stamp the new service log AND mark the source estimate
    // completed, then save BOTH through the service.calls scoped merge below. This
    // fixes the old changedKey/silo mismatch (it used to broad-save under 'logs'
    // while mutating serviceLogs + serviceEstimates, risking loss of the new log
    // and the estimate completion when remote had advanced).
    const now6rb = new Date().toISOString()
    logEntry.statusEvents = []
    stampStatusEvent(logEntry, logEntry.payStatus, logEntry.collected, false)
    if (!logEntry.serviceLogId) logEntry.serviceLogId = logEntry.id
    logEntry.createdAt = logEntry.createdAt || now6rb
    logEntry.updatedAt = now6rb
    backup.serviceLogs = [...serviceLogs, ensureServiceLogIdentity(logEntry)]
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
    setSlQuoted(''); setSlMat(''); setSlCollected(''); setSlReceivedAt(localTodayKey()); setSlStore(''); setSlJtype(JOB_TYPES[0])
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
    setLegacyResolveOpen(false); setLegacyResolveRows([])
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
      estimateBillRate: parseFloat(estBillRate) || 0,
    })
  }

  function estimateCrewQuoteForRecord(record: any) {
    const priorSnapshot = record?.costSnapshot as CrewCostSnapshot | undefined
    const costingSource = (priorSnapshot?.crewSource || record?.costingSource || 'assigned') as 'assigned' | 'pricing'
    const pricingCrewIds = record?.pricingCrewIds
      || (costingSource === 'pricing' ? (priorSnapshot?.crew || []).map((member) => member.costModelEmployeeId) : [])
    const effectiveBillRate = resolveEffectiveEstimateBillRate(record, settings.billRate)
    return crewQuoteFor({
      siteHours: num(record?.estHours),
      materials: num(record?.estMaterials),
      miles: num(record?.milesRT),
      totalQuotedOverride: resolveTotalQuoted(record),
      costingSource,
      assignedEmployees: hydrateAssignmentIdentities(normalizeAssignments(record), assignableEmployeeOptions),
      pricingCrewIds,
      estimateBillRate: effectiveBillRate,
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
      estimateBillRate: parseFloat(slBillRate) || 0,
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
      : computeServiceQuote({}, estTotalQuoted === '' ? 0 : parseFloat(estTotalQuoted) || 0)
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
        : 'crew'
  const estMissingRates: MissingRate[] =
    estEffectiveMode === 'frozen'
      ? []
      : resolveRequiredServiceRates(settings, { mode: estEffectiveMode }).missing
  const estCrewErrors = estEffectiveMode === 'crew' ? estimateCrewQuote().errors : []

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
    // FORENSIC-KPI-2B1: on a row that already has a real payment ledger, the ledger is
    // the money and the Collected box is a read-only mirror of it. Legacy rows (no
    // ledger yet) keep their scalar amount read-only; new money must use Record Payment.
    const priorSvcRow = editSvcId ? serviceLogs.find(l => l.id === editSvcId) : undefined
    const svcHasLedger = hasServicePaymentLedger(priorSvcRow)
    const isNewSvc = !editSvcId
    const typedCollected = parseFloat(slCollected) || 0
    const needsPaymentEvent = isNewSvc && typedCollected > MONEY_EPSILON
    let collected = svcHasLedger
      ? resolveServiceCollected(priorSvcRow)
      : (isNewSvc ? 0 : resolveServiceCollected(priorSvcRow))

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

    // FORENSIC-KPI-2B1: the Status select is workflow UX only — it can no longer
    // manufacture or erase cash. reconcileServicePayment leaves Collected alone and
    // returns the truthful status; a choice that contradicts the money is refused and
    // surfaced inline in the modal (see servicePaymentBlock below).
    //
    // "Fully settled" is judged against Total Billable (protected Total Quoted plus
    // valid income adjustments), never against Total Quoted alone.
    const carriedAdjustments = editSvcId ? (serviceLogs.find(l => l.id === editSvcId)?.adjustments || []) : []
    const totalBillableAtSave = resolveServiceTotalBillable({ quoted, adjustments: carriedAdjustments })
    const payment = reconcileServicePayment(slPayStatus, collected, totalBillableAtSave)
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
      adjustments: carriedAdjustments,
      // FORENSIC-KPI-2B1: the entry is rebuilt from scratch on every save, so the
      // append-only payment ledger MUST be carried across or an unrelated edit would
      // silently delete real payment history.
      ...(svcHasLedger ? { payments: getServicePaymentEvents(priorSvcRow) } : {}),
    } as any

    // FORENSIC-KPI-2B1: new service calls with owner-entered cash must be born with a
    // real payment ledger. Route the money through the shared payment writer so it has a
    // stable id, amount, and owner-asserted receivedAt — never a fabricated service date.
    if (needsPaymentEvent) {
      if (!slReceivedAt) {
        alert('Select the date the payment was received.')
        return
      }
      const paymentResult = buildServiceLogWithPayment(entry, {
        amount: typedCollected,
        receivedAt: slReceivedAt,
      })
      if (!paymentResult.ok) {
        alert(paymentResult.message)
        return
      }
      ;(paymentResult.row as any).statusEvents = []
      stampStatusEvent(paymentResult.row as any, paymentResult.payStatus, paymentResult.collected, false)
      ;(paymentResult.row as any).updatedAt = new Date().toISOString()
      backup.serviceLogs = [...serviceLogs, ensureServiceLogIdentity(paymentResult.row as any)]
      const saved = await persistServiceLogs()
      if (!saved) return
      const savedEntry = paymentResult.row as any
      await finalizeServiceLogSave(savedEntry, slAssignments)
      return
    } else if (editSvcId) {
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
    await finalizeServiceLogSave(entry, slAssignments)
  }

  /**
   * Shared post-save cleanup for service log creation/edit: portal sync, relationship
   * account link/event, skill signals, and form reset.
   */
  async function finalizeServiceLogSave(savedEntry: any, assignments: AssignedEmployee[]) {
    // SERVICE-LOG-1: employee-safe job facts only — no quote/profit/collections.
    syncAssignmentsToPortal(savedEntry, 'service_call', assignments)
    if (savedEntry?.accountId) {
      void linkEntityToAccount({
        orgId: authProfile?.org_id || null,
        accountId: String(savedEntry.accountId),
        entityType: 'service_log',
        entityId: String(savedEntry.id),
        entityLabel: savedEntry.jtype || savedEntry.customer || 'Service Call',
        legacyCustomerText: savedEntry.customer || '',
        metadata: { legacy_payload: savedEntry },
        createdBy: authProfile?.id || null,
      }).catch((err) => console.warn('[V15rFieldLogPanel] relationship link upsert failed', err))
      void upsertRelationshipEvent({
        orgId: authProfile?.org_id || null,
        accountId: String(savedEntry.accountId),
        entityType: 'service_log',
        entityId: String(savedEntry.id),
        title: savedEntry.jtype || savedEntry.customer || 'Service Call',
        description: savedEntry.notes || '',
        quotedAmount: num(savedEntry.quoted || 0),
        collectedAmount: num(savedEntry.collected || 0),
        outstandingAmount: Math.max(0, num(savedEntry.quoted || 0) - num(savedEntry.collected || 0)),
        metadata: { status: savedEntry.payStatus || '', legacy_payload: savedEntry },
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

  /**
   * FORENSIC-KPI-2B2-2G: route a queue row into the EXISTING Edit Service Call
   * Payment History resolver. This is NOT a second resolver — it reuses the
   * canonical beginSvcEdit open path, then auto-opens the same legacy-date
   * resolve form (and the same commitResolveLegacyPayments writer) already proven
   * in 2B2-2D. The only thing seeded here is the resolve rows; the service/work
   * date is intentionally NOT prefilled as Date Received (the service date is not
   * payment-date authority).
   *
   * The queue modal stays mounted underneath the edit modal, so once the owner
   * saves + closes the edit modal the queue re-renders with the row gone — no
   * page reload, no optimistic fake success (the existing scoped save owns truth).
   */
  function openResolveFromQueue(log: any) {
    // Q14: never mutate from the queue in Demo Mode — reconciliation is read-only there.
    if (hasHydrated && isDemoMode) return
    const unknown = getServiceLegacyUnknownCash(log)
    if (unknown.amount <= MONEY_EPSILON || unknown.hasUnexpectedNullDateEvent) return
    beginSvcEdit(String((log as any).id))
    setLegacyResolveRows([{ amount: unknown.amount.toFixed(2), receivedAt: '', note: '' }])
    setLegacyResolveOpen(true)
  }

  /**
   * FORENSIC-KPI-2B2-2G: open an unexpected-null-date warning row in the existing
   * Edit Service Call modal so the owner can fix the non-baseline undated event
   * directly in Payment History. The legacy resolver refuses these by design; the
   * date must be entered on the event itself, not resolved here.
   */
  function openWarningEditFromQueue(logId: string) {
    if (hasHydrated && isDemoMode) return
    beginSvcEdit(logId)
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

  /**
   * FORENSIC-KPI-2B1: "Mark Paid" and "Partial" no longer write money directly — they
   * open the compact Record Payment capture so a real amount AND a real received date
   * are collected. The buttons, their labels and their purpose are unchanged.
   *
   * "Mark Paid" prefills the outstanding balance; the owner can correct it. If the
   * actual cash is short of the balance, the shortfall is simply not recorded — it is
   * never manufactured to make the status fit.
   */
  function quickSetSvcPayment(logId: string, status: string) {
    const l = serviceLogs.find(x => x.id === logId)
    if (!l) return
    const totalBillable = resolveServiceTotalBillable(l)
    const alreadyCollected = resolveServiceCollected(l)
    const balanceDue = Math.max(0, totalBillable - alreadyCollected)
    setPayRequest({
      logId,
      customer: canonicalCustomerName(l),
      totalBillable,
      alreadyCollected,
      balanceDue,
      suggestedAmount: status === 'Y' ? balanceDue : 0,
      title: status === 'Y' ? 'Mark Paid — record payment' : 'Partial — record payment',
    })
  }

  /**
   * The single Service payment write path in this panel. Delegates all money and
   * status arithmetic to recordServicePayment() so cash is never manufactured or
   * erased, then persists through the Phase 6R-A scoped serviceLogs save.
   */
  function commitServicePayment(amount: number, receivedAt: string, note: string) {
    const request = payRequest
    if (!request) return
    const idx = serviceLogs.findIndex(x => x.id === request.logId)
    if (idx < 0) { setPayRequest(null); return }
    const target = serviceLogs[idx]

    const result = recordServicePayment(target, { amount, receivedAt, note })
    if (!result.ok) { alert(result.message); return }

    pushState(backup)
    // Preserve prior invoiced flag — recording cash doesn't change invoicing.
    const wasInvoiced = !!(Array.isArray(target.statusEvents) && target.statusEvents.length
      && target.statusEvents[target.statusEvents.length - 1].invoiced)
    const next: any = { ...result.row }
    next.statusEvents = Array.isArray(target.statusEvents) ? [...target.statusEvents] : []
    stampStatusEvent(next, result.payStatus, result.collected, wasInvoiced)
    if (!next.serviceLogId) next.serviceLogId = next.id
    next.updatedAt = new Date().toISOString()

    const source = backup.serviceLogs || []
    backup.serviceLogs = source.map(row => (String(row.id) === String(request.logId) ? next : row))
    setPayRequest(null)
    persistServiceLogs()
  }

  /** True when the row open in the modal already has real payment-event truth. */
  const editingSvcHasLedger = hasServicePaymentLedger(
    editSvcId ? serviceLogs.find(l => l.id === editSvcId) : undefined,
  )

  /**
   * Live preview of what the current modal inputs mean, so the owner can see the
   * balance and any refused status choice before saving. Read-only: writes nothing.
   */
  function serviceCallPaymentPreview() {
    const prior = editSvcId ? serviceLogs.find(l => l.id === editSvcId) : undefined
    const totalBillable = resolveServiceTotalBillable({
      quoted: serviceCallDisplayQuote().totalQuoted,
      adjustments: prior?.adjustments || [],
    })
    const collected = editingSvcHasLedger
      ? resolveServiceCollected(prior)
      : (parseFloat(slCollected) || 0)
    const reconciled = reconcileServicePayment(slPayStatus, collected, totalBillable)
    return {
      totalBillable,
      collected: reconciled.collected,
      balanceDue: reconciled.balanceDue,
      blocked: reconciled.blocked,
      message: reconciled.message,
      paymentCount: getServicePaymentEvents(prior).length,
    }
  }

  // ── FORENSIC-KPI-2B2-2D: Payment History + legacy date resolution ───────────
  // The row currently open in the Edit Service Call modal (null when creating new).
  const editingSvcRow = editSvcId ? serviceLogs.find(l => l.id === editSvcId) : undefined
  const editingSvcEvents = getServicePaymentEvents(editingSvcRow)
  const editingSvcLegacyUnknown = getServiceLegacyUnknownCash(editingSvcRow)

  /** Start the resolve form with one row seeded to the full unknown amount. */
  function beginLegacyResolve() {
    if (editingSvcLegacyUnknown.amount <= MONEY_EPSILON) return
    setLegacyResolveRows([{
      amount: editingSvcLegacyUnknown.amount.toFixed(2),
      receivedAt: '',
      note: '',
    }])
    setLegacyResolveOpen(true)
  }

  function addLegacyResolveRow() {
    setLegacyResolveRows(rows => [...rows, { amount: '', receivedAt: '', note: '' }])
  }

  function updateLegacyResolveRow(idx: number, patch: Partial<{ amount: string; receivedAt: string; note: string }>) {
    setLegacyResolveRows(rows => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  function removeLegacyResolveRow(idx: number) {
    setLegacyResolveRows(rows => rows.filter((_, i) => i !== idx))
  }

  /** Live validation of the resolve rows — mirrors the pure helper's rules. */
  const legacyResolveValidation = (() => {
    const unknown = editingSvcLegacyUnknown.amount
    if (unknown <= MONEY_EPSILON) {
      return { ok: false, message: 'This service call has no undated collected cash to resolve.' }
    }
    if (editingSvcLegacyUnknown.hasUnexpectedNullDateEvent) {
      return {
        ok: false,
        message: 'A payment on this call was recorded without a date and is not a legacy baseline. Enter its date directly — it cannot be resolved here.',
      }
    }
    if (legacyResolveRows.length === 0) {
      return { ok: false, message: 'Enter at least one payment row.' }
    }
    let sum = 0
    for (const r of legacyResolveRows) {
      const amt = parseFloat(r.amount)
      if (!Number.isFinite(amt) || Math.abs(amt) <= MONEY_EPSILON) {
        return { ok: false, message: 'Every row needs an amount greater than zero.' }
      }
      if (!r.receivedAt) {
        return { ok: false, message: 'Select the date each payment was received.' }
      }
      sum += amt
    }
    const diff = round2(sum - unknown)
    if (Math.abs(diff) > MONEY_EPSILON) {
      return {
        ok: false,
        message: `Rows total ${sum.toFixed(2)} but undated cash is ${unknown.toFixed(2)}. They must match exactly.`,
      }
    }
    return { ok: true, message: '' }
  })()

  /**
   * The single legacy-date write path. Delegates ALL money/date arithmetic to
   * resolveServiceLegacyPayments() so the collected amount can never change — only
   * the cash DATE moves — then persists through the same scoped serviceLogs save.
   */
  function commitResolveLegacyPayments() {
    if (!editSvcId) return
    const target = serviceLogs.find(x => x.id === editSvcId)
    if (!target) return
    if (!legacyResolveValidation.ok) { alert(legacyResolveValidation.message); return }

    const entries = legacyResolveRows.map(r => ({
      amount: parseFloat(r.amount),
      receivedAt: r.receivedAt,
      note: r.note || undefined,
    }))

    const result = resolveServiceLegacyPayments(target, entries)
    if (!result.ok) { alert(result.message); return }

    pushState(backup)
    const wasInvoiced = !!(Array.isArray(target.statusEvents) && target.statusEvents.length
      && target.statusEvents[target.statusEvents.length - 1].invoiced)
    const next: any = { ...result.row }
    next.statusEvents = Array.isArray(target.statusEvents) ? [...target.statusEvents] : []
    stampStatusEvent(next, result.payStatus, result.collected, wasInvoiced)
    if (!next.serviceLogId) next.serviceLogId = next.id
    next.updatedAt = new Date().toISOString()

    const source = backup.serviceLogs || []
    backup.serviceLogs = source.map(row => (String(row.id) === String(editSvcId) ? next : row))
    setLegacyResolveOpen(false); setLegacyResolveRows([])
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
      rule.active = isRetiredDayTargetTriggerType(String(rule.type || '').trim()) ? false : active
      persist()
    }
  }

  function startAddTriggerRule() {
    setEditingTriggerRuleId('new')
    setTriggerRuleForm({
      id: `trigger_${Date.now().toString(36)}`,
      name: '',
      type: 'travel',
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
    const nextType = String(triggerRuleForm.type || 'travel').trim() || 'travel'
    const nextRule = {
      id: String(triggerRuleForm.id || `trigger_${Date.now().toString(36)}`),
      name,
      type: nextType,
      color: String(triggerRuleForm.color || '#3b82f6').trim() || '#3b82f6',
      active: isRetiredDayTargetTriggerType(nextType) ? false : triggerRuleForm.active !== false,
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
          /* PROJECT-LOG-UI-2B — the SAME shared dual-compartment shell the Edit
             Project Log modal uses (V15rProjectLogsTab). This file supplies only
             the LEFT field-entry content and the RIGHT financial panel; the
             overlay, header, grid, scroll regions and footer live in
             ProjectLogModalLayout. */
          <ProjectLogModalLayout
            mode={editLogId ? 'edit' : 'new'}
            onClose={resetProjForm}
            onSave={saveProjEntry}
            right={
              <ProjectLogFinancialPanel
                backup={backup}
                projectId={flProj || null}
                editLogId={editLogId}
                projectName={projects.find(p => p.id === flProj)?.name}
                employeeId={flEmp || null}
                employeeName={(liveEmployees.find(e => e.id === flEmp) || employees.find(e => e.id === flEmp))?.name}
                inputs={{ hrs: flHrs, miles: flMiles, mat: flMat, collected: flCollected }}
              />
            }
            left={
              <>
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
              </>
            }
          />
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
          // FORENSIC-KPI-CANONICAL-READERS-1 Part E: 7-day collected via the canonical
          // ranged authority so synthetic paid-backfill is NOT mis-dated into the
          // window and Service cash uses receivedAt (not the work date). The display
          // scope is preserved exactly (active projects + projFilter; active service
          // logs, none when a project is filtered) — only the provenance rule changes.
          // Hours / material / miles / logCount below still use the raw log sums above.
          const _tomorrow7d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
          const _fmtKey7d = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          const _startUtc7d = new Date(_fmtKey7d(sevenDaysAgo) + 'T00:00:00.000Z')
          const _endUtc7d = new Date(_fmtKey7d(_tomorrow7d) + 'T00:00:00.000Z')
          const _scopedBackup7d = {
            ...backup,
            logs: (backup.logs || []).filter((l: any) =>
              activeProjectIds.has(l.projId) && (projFilter === 'all' || l.projId === projFilter)),
            serviceLogs: projFilter === 'all' ? (backup.serviceLogs || []).filter((l: any) => isActiveServiceCall(l)) : [],
          }
          const totalCollected7d = getCollectedRevenueForRange(_scopedBackup7d, _startUtc7d, _endUtc7d).knownTotal
          const logCount = recentProjectLogs.length + recentServiceLogs.length

          // Derived project labor totals use current Team loaded labor + current
          // overhead recovery by worker. Service math remains unchanged elsewhere.
          const mileRate7d = num(backup.settings?.mileRate) || VAN_MILE_RATE
          const totalLaborCost7d = sumProjectLaborCost(recentProjectLogs)
          const opCost7dMissing = totalLaborCost7d <= 0 && recentProjectLogs.some((log: any) => num(log?.hrs) > 0)
          const totalMileageCost7d = totalMiles * mileRate7d
          const totalCost7d = totalLaborCost7d + totalMaterialCost + totalMileageCost7d

          // Project-level remaining balance (current state, not 7-day-sliced)
          let remainingBalNow = 0
          let projQuoteNow = 0
          if (projFilter === 'all') {
            const finAll = calculatePortfolioFinancials(projects, backup.logs || [], mileRate7d, projectLaborRateForLog)
            remainingBalNow = finAll.remaining_balance
            projQuoteNow = finAll.quote
          } else {
            const proj = projects.find((p: any) => p.id === projFilter)
            if (proj) {
              const finProj = calculateProjectFinancials(proj, backup.logs || [], mileRate7d, projectLaborRateForLog)
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
                    <div className="text-[9px] text-gray-600">{opCost7dMissing ? 'rate not set' : 'current team labor + overhead'}</div>
                    <div className={`text-sm font-bold font-mono ${opCost7dMissing ? 'text-amber-400' : 'text-red-400'}`}>{opCost7dMissing ? 'Rate not set' : fmt(totalLaborCost7d)}</div>
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
                    <div className={`text-sm font-bold font-mono ${opCost7dMissing ? 'text-amber-400' : 'text-red-400'}`}>{opCost7dMissing ? 'Rate not set' : fmt(totalCost7d)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Remaining Balance</div>
                    <div className="text-[9px] text-gray-600">project, current</div>
                    <div className="text-sm font-bold font-mono" style={{ color: opCost7dMissing ? '#f59e0b' : balColor7d }}>{opCost7dMissing ? '—' : fmt(remainingBalNow)}</div>
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

          // Canonical formula via calculateProjectFinancials with project labor
          // resolved from current Team loaded labor + current overhead recovery.
          const canonMileRate = num(backup.settings?.mileRate) || VAN_MILE_RATE
          let canonFin: ReturnType<typeof calculateProjectFinancials>
          if (projFilter === 'all') {
            canonFin = calculatePortfolioFinancials(projects, sorted, canonMileRate, projectLaborRateForLog)
          } else {
            const proj = projects.find((p: any) => p.id === projFilter)
            if (proj) {
              canonFin = calculateProjectFinancials(proj, sorted, canonMileRate, projectLaborRateForLog)
            } else {
              canonFin = { quote: 0, labor_cost: 0, material_cost: 0, transportation_cost: 0, total_costs: 0, remaining_balance: 0, total_collected: 0, total_hours: 0, total_miles: 0, mile_rate: canonMileRate }
            }
          }
          const canonOpCostMissing = canonFin.labor_cost <= 0 && canonFin.total_hours > 0
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
                  <div className="text-[9px] text-gray-400">{canonOpCostMissing ? 'rate not set' : 'current team labor + overhead'}</div>
                  <div className={`text-sm font-bold font-mono ${canonOpCostMissing ? 'text-amber-400' : 'text-red-400'}`}>{canonOpCostMissing ? 'Rate not set' : fmt(canonFin.labor_cost)}</div>
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
                  <div className={`text-sm font-bold font-mono ${canonOpCostMissing ? 'text-amber-400' : 'text-red-400'}`}>{canonOpCostMissing ? 'Rate not set' : fmt(canonFin.total_costs)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-300 uppercase font-bold">Remaining Balance</div>
                  <div className="text-[9px] text-gray-400">Quote−Current Total Cost</div>
                  <div className="text-sm font-bold font-mono" style={{ color: canonOpCostMissing ? '#f59e0b' : canonBalColor }}>{canonOpCostMissing ? '—' : fmt(canonFin.remaining_balance)}</div>
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

            const fin = calculateProjectFinancials(proj, projLogs, num(settings.mileRate) || 0.67, projectLaborRateForLog)
            const projTotalCollected = projLogs.reduce((s, l) => s + num(l.paymentsCollected || l.collected || 0), 0)
            const summLaborMissing = fin.labor_cost <= 0 && fin.total_hours > 0
            const projTotalCosts = summLaborMissing ? null : fin.total_costs
            const balanceLeft = summLaborMissing ? null : fin.remaining_balance
            const summBalanceColor = summLaborMissing ? '#f59e0b' : getBalanceColor(balanceLeft, fin.quote)

            return (
              <div key={projId} className="bg-[var(--bg-input)] border border-gray-800 rounded px-3 py-2 text-[10px] flex justify-between gap-3 mb-2">
                <div className="font-semibold text-gray-200">{proj.name}</div>
                <div className="flex gap-4">
                  <span style={{ color: '#e5e7eb' }}>
                    <span className="text-gray-500">Quote:</span> <span className="font-mono">{fmt(fin.quote)}</span>
                  </span>
                  <span style={{ color: '#10b981' }}>
                    <span className="text-gray-500">Collected:</span> <span className="font-mono">{fmt(projTotalCollected)}</span>
                  </span>
                  <span style={{ color: '#ef4444' }}>
                    <span className="text-gray-500">Costs:</span> <span className="font-mono">{summLaborMissing ? <span className="text-amber-400">Rate not set</span> : fmt(projTotalCosts)}</span>
                  </span>
                  <span style={{ color: summBalanceColor }}>
                    <span className="text-gray-500">Balance:</span> <span className="font-mono">{summLaborMissing ? '—' : fmt(balanceLeft)}</span>
                  </span>
                </div>
              </div>
            )
          })
        })()}

        {/* Running Totals Bar at bottom - Project Log */}
        {sorted.length > 0 && (() => {
          // Single source of truth — same function and same project labor authority as top summary card
          const footMileRate = num(backup.settings?.mileRate) || VAN_MILE_RATE
          let footFin: ReturnType<typeof calculateProjectFinancials>
          if (projFilter === 'all') {
            footFin = calculatePortfolioFinancials(projects, sorted, footMileRate, projectLaborRateForLog)
          } else {
            const proj = projects.find((p: any) => p.id === projFilter)
            if (proj) {
              footFin = calculateProjectFinancials(proj, sorted, footMileRate, projectLaborRateForLog)
            } else {
              footFin = { quote: 0, labor_cost: 0, material_cost: 0, transportation_cost: 0, total_costs: 0, remaining_balance: 0, total_collected: 0, total_hours: 0, total_miles: 0, mile_rate: footMileRate }
            }
          }
          const footOpCostMissing = footFin.labor_cost <= 0 && footFin.total_hours > 0
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
                  Total Labor: <span className="font-mono" style={{ color: footOpCostMissing ? '#f59e0b' : '#e5e7eb' }}>{footOpCostMissing ? 'Rate not set' : fmt(footFin.labor_cost)}</span>
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
                <span style={{ color: footOpCostMissing ? '#f59e0b' : '#ef4444' }}>
                  Total Cost: <span className="font-mono">{footOpCostMissing ? 'Rate not set' : fmt(totalCost)}</span>
                </span>
                {projQuote > 0 && (
                  <span style={{ color: footOpCostMissing ? '#f59e0b' : bottomBalanceColor }}>
                    Balance Left: <span className="font-mono">{footOpCostMissing ? '—' : fmt(balanceLeft)}</span>
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

    // Collections queue: unpaid service work, biggest balance first.
    // QBO-2F1: derives from the shared getUnpaidServiceCalls authority (same
    // rule as the global header Prepare Invoice selector) — no inline duplicate.
    const collections = getUnpaidServiceCalls(sorted)

    // QBO-2F1: global header Prepare Invoice eligibility — ALL active unpaid
    // service work (independent of the tab's jtype filter), via the SAME
    // getUnpaidServiceCalls authority. When this is empty, the global QuickBooks
    // menu omits Prepare Invoice entirely (no disabled/fake placeholder).
    const unpaidServiceCalls = getUnpaidServiceCalls(activeServiceLogs)

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
              onClick={() => setShowHistoricalPayments(true)}
              data-testid="historical-payments-button"
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                reconciliationQueue.unresolvedCount > 0
                  ? 'bg-orange-600/20 text-orange-300 border-orange-700/40'
                  : 'bg-slate-700/20 text-slate-300 border-slate-600/30'
              }`}
            >
              <Timer size={12} /> Historical Payments
              {reconciliationQueue.unresolvedCount > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[16px] px-1 rounded-full bg-orange-600 text-white text-[10px] font-bold">
                  {reconciliationQueue.unresolvedCount}
                </span>
              )}
            </button>
            {/* QBO-2F1: global Service header QuickBooks menu, placed immediately
                to the RIGHT of Historical Payments. Consolidates the former
                standalone "Import QB PDF" button plus Prepare Invoice (only when
                unpaid service work exists) and Invoice Drafts behind one button.
                Prepare Invoice opens the unpaid-work selector (no blank invoice).
                Import QuickBooks PDF invokes the EXACT existing importer. */}
            <QuickBooksMenu
              showPrepareInvoice={unpaidServiceCalls.length > 0}
              onPrepareInvoice={() => setShowPrepareInvoiceSelector(true)}
              onOpenDrafts={qb.openDrafts}
              onImportQbPdf={() => setShowQBImport(true)}
              connectionStatus={conn.status ?? { connected: false }}
              onConnect={conn.connect}
              onOpenAccount={conn.openAccount}
              align="right"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-600/20 text-sky-300 border border-sky-500/30 hover:bg-sky-600/30 transition-colors"
            />
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
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="text-[10px] text-gray-400 uppercase font-bold">Bill Rate $</label>
                      <span
                        className={`text-[9px] px-2 py-0.5 rounded uppercase tracking-wide ${estBillRateSource === 'manual' ? 'bg-amber-500/15 text-amber-300' : 'bg-blue-500/15 text-blue-300'}`}
                        title={estBillRateSource === 'manual' ? 'This estimate keeps its own Bill Rate.' : 'Inherited from the Settings Default Bill Rate.'}
                      >
                        {estBillRateSource === 'manual' ? 'Manual Override' : 'From Settings'}
                      </span>
                    </div>
                    <input
                      type="number" step="0.01"
                      defaultValue={estBillRate}
                      onBlur={e => { setEstBillRate(e.target.value); setEstBillRateSource('manual') }}
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
                  onRecalculate={forceUpdate}
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
                      {estLegacyVersion && (
                        <div className="rounded-lg border border-amber-700/30 bg-amber-900/15 px-3 py-2 text-xs">
                          <div className="font-bold uppercase tracking-wide text-amber-300">Legacy Solo Version</div>
                          <div className="text-gray-300 mt-1">Original stored quote: {fmt(num(estLegacyVersion.originalQuote))}</div>
                          {num(estLegacyVersion.storedOperatingCostRate) > 0 ? (
                            <div className="text-gray-400">Stored operating cost: {fmt(num(estLegacyVersion.storedOperatingCostRate))}/hr</div>
                          ) : (
                            <div className="text-gray-500">Historical cost model preserved - exact historical operating-rate metadata unavailable</div>
                          )}
                        </div>
                      )}
                      <div className="rounded-lg border border-blue-700/30 bg-blue-900/10 px-3 py-2">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-blue-300">Current Live Pricing</div>
                        <div className="text-[10px] text-gray-500">Current Team labor + current Overhead Manager recovery</div>
                      </div>
                      {/* COST-1.5A: block the quote entirely when a required rate
                          is missing — never show a number built on an invented rate. */}
                      {estMissingRates.length > 0 ? (
                        <ServiceQuoteMissingPanel missing={estMissingRates} accent="blue" />
                      ) : estCrewErrors.length > 0 ? (
                        <ServiceCostingBlockedPanel errors={estCrewErrors} />
                      ) : (
                        <ServiceQuotePanel
                          quote={quote}
                          totalQuotedInput={estTotalQuoted === '' ? String(quote.suggestedQuote) : estTotalQuoted}
                          onTotalQuotedChange={(raw) => { setEstTotalQuoted(raw); setEstQuotedManual(true) }}
                          onUseSuggested={() => { setEstTotalQuoted(String(quote.suggestedQuote)); setEstQuotedManual(false) }}
                          mileRate={mileRate}
                          taxRate={taxRate}
                          opCost={opCost}
                          operatingCostLabel="Live Labor + Overhead"
                          accent="blue"
                        />
                      )}

                      {estPreviousSnapshot && crewResult.breakdown && (
                        <PricingSnapshotDeltaPanel previous={estPreviousSnapshot} current={crewResult.breakdown} />
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
                  disabled={estMissingRates.length > 0 || estCrewErrors.length > 0}
                  title={estMissingRates.length > 0 || estCrewErrors.length > 0 ? 'Configure the missing live cost inputs above before saving.' : undefined}
                  className={`flex items-center gap-2 px-5 py-2 rounded-lg text-white text-xs font-bold transition-colors shadow-lg ${estMissingRates.length > 0 || estCrewErrors.length > 0 ? 'bg-gray-600 opacity-50 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'}`}
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
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {((est as any).legacyPricing || !(est as any).costSnapshot) && <span className="text-[9px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">Legacy Solo Pricing</span>}
                          {(est as any).costSnapshot && <span className="text-[9px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300">Previous Saved Crew Cost</span>}
                          <span className="text-[9px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-300">Current Live Pricing</span>
                        </div>
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
                        {(() => {
                          const snapshot = (est as any).costSnapshot as CrewCostSnapshot | undefined
                          return snapshot?.frozenAt ? (
                            <div className="mt-1.5 text-[10px] text-cyan-300">
                              Frozen Pricing / {snapshot.frozenAt.slice(0, 10)} / {snapshot.pricingModel === 'crew' ? 'Crew' : 'Solo Legacy'}
                            </div>
                          ) : snapshot ? (
                            <div className="mt-1.5 text-[10px] text-cyan-300">Frozen Pricing / accepted before freeze metadata was recorded</div>
                          ) : (
                            <div className="mt-1.5 text-[10px] text-amber-300">Legacy Solo Pricing / historical cost model preserved</div>
                          )
                        })()}
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
                            <label className="text-[9px] text-gray-500 uppercase font-bold">Date Received</label>
                            <input
                              type="date"
                              value={paymentReceivedAt}
                              onChange={e => setPaymentReceivedAt(e.target.value)}
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
          <ServiceCallModalLayout
            mode={editSvcId ? 'edit' : 'new'}
            onClose={resetSvcForm}
            onSave={saveSvcEntry}
            saveDisabled={slMissingRates.length > 0}
            saveTitle={slMissingRates.length > 0 ? 'Set the missing pricing settings above before saving.' : undefined}
            left={
              <>
              {/* ── A. JOB / CUSTOMER ─────────────────────────────────────── */}
              <ServiceCallSection title="Job / Customer">
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
              </ServiceCallSection>

              {/* ── B. WORK INPUTS ────────────────────────────────────────── */}
              <ServiceCallSection title="Work Inputs">
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
              </ServiceCallSection>

              {/* ── C. ASSIGNMENT — who worked the job. Deliberately NOT the
                     Costing Crew, which determines pricing and lives in the
                     right-hand costing compartment. ────────────────────────── */}
              <ServiceCallSection title="Assignment" note="who worked the job">
                {/* Assigned Employees */}
                <AssignedEmployeesField
                  options={assignableEmployeeOptions}
                  value={slAssignments}
                  onChange={setSlAssignments}
                  accent="orange"
                />
              </ServiceCallSection>

              {/* ── D. PAYMENT ────────────────────────────────────────────── */}
              <ServiceCallSection title="Payment">
                {/* Collected + Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Collected $</label>
                    <input
                      key={`slCollected-${editSvcId || 'new'}`}
                      type="number" step="0.01"
                      defaultValue={slCollected}
                      readOnly={editingSvcHasLedger}
                      onBlur={e => setSlCollected(e.target.value)}
                      className={`w-full rounded-lg px-3 py-2 text-sm border border-gray-600 focus:border-orange-500 outline-none ${editingSvcHasLedger ? 'text-gray-400 cursor-not-allowed' : 'text-gray-200'}`}
                      style={{ backgroundColor: 'var(--bg-input)' }}
                    />
                    {/* FORENSIC-KPI-2B1: new service calls with owner-entered cash need
                        a real received date. Legacy rows and zero-cash rows don't. */}
                    {!editSvcId && (
                      <div className="mt-2">
                        <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Date Received</label>
                        <input
                          type="date"
                          value={slReceivedAt}
                          onChange={e => setSlReceivedAt(e.target.value)}
                          className="w-full rounded-lg px-3 py-2 text-sm text-gray-200 border border-gray-600 focus:border-orange-500 outline-none"
                          style={{ backgroundColor: 'var(--bg-input)' }}
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-400 uppercase font-bold mb-1">Status</label>
                    <select
                      value={slPayStatus}
                      onChange={e => {
                        // FORENSIC-KPI-2B1: changing workflow status must never rewrite
                        // the Collected amount. The implied balance and any refusal are
                        // shown in the hint line below instead.
                        setSlPayStatus(e.target.value)
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

                {/* FORENSIC-KPI-2B1: balance hint + refusal notice. Status never edits cash. */}
                {(() => {
                  const preview = serviceCallPaymentPreview()
                  return (
                    <div className="text-[10px] leading-relaxed -mt-1">
                      {preview.blocked ? (
                        <div className="text-amber-400">⚠ {preview.message} Saving keeps the recorded money and stores the truthful status.</div>
                      ) : (
                        <div className="text-gray-500">
                          Balance remaining: <span className="font-mono text-orange-400">{fmt(preview.balanceDue)}</span>
                          <span className="text-gray-600"> · {fmt(preview.totalBillable)} total billable</span>
                        </div>
                      )}
                      {editingSvcHasLedger && (
                        <div className="text-gray-500 mt-0.5">
                          Collected is the sum of {preview.paymentCount} recorded payment{preview.paymentCount === 1 ? '' : 's'} — use Mark Paid / Partial to record another.
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* FORENSIC-KPI-2B2-2D: Payment History + legacy date resolution.
                    Shows every recorded payment event read-only. Undated historical
                    cash ("Payment date unknown") can be given a real received date
                    WITHOUT changing the collected amount — only the cash DATE moves. */}
                {editSvcId && (
                  <div className="rounded-lg border border-gray-700/60 p-3" style={{ backgroundColor: 'var(--bg-input)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="block text-[10px] text-gray-400 uppercase font-bold">Payment History</span>
                      {editingSvcLegacyUnknown.amount > MONEY_EPSILON && !editingSvcLegacyUnknown.hasUnexpectedNullDateEvent && !legacyResolveOpen && (
                        <button
                          type="button"
                          onClick={beginLegacyResolve}
                          className="text-[10px] px-2 py-1 rounded bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 border border-orange-700/40"
                        >
                          Resolve Payment Date{editingSvcLegacyUnknown.amount > 0 ? '' : ''}s
                        </button>
                      )}
                    </div>

                    {editingSvcEvents.length === 0 ? (
                      <div className="text-[11px] text-gray-500">
                        No payment ledger. Collected <span className="font-mono text-gray-300">{fmt(resolveServiceCollected(editingSvcRow))}</span> is a legacy amount with no recorded payment date.
                      </div>
                    ) : (
                      <ul className="space-y-1">
                        {editingSvcEvents.map(ev => {
                          if (!isLiveServicePaymentEvent(ev)) {
                            // A voided legacy_baseline is a resolved historical amount —
                            // its cash now lives on the dated resolved event(s), so hide
                            // it to keep the history clean. Other voided events stay visible.
                            if (ev.kind === 'legacy_baseline') return null
                            return (
                              <li key={ev.id} className="text-[11px] text-gray-600 flex justify-between">
                                <span>Voided payment</span>
                                <span className="font-mono">{fmt(num(ev.amount))}</span>
                              </li>
                            )
                          }
                          const dated = typeof ev.receivedAt === 'string' && ev.receivedAt.trim().length > 0
                          const isBaseline = ev.kind === 'legacy_baseline'
                          return (
                            <li key={ev.id} className="text-[11px] flex justify-between gap-2">
                              <span className={dated ? 'text-gray-300' : 'text-amber-400'}>
                                {dated ? ev.receivedAt : 'Payment date unknown'}
                                {isBaseline && <span className="text-gray-600"> · legacy</span>}
                                {ev.kind === 'refund' && <span className="text-gray-600"> · refund</span>}
                              </span>
                              <span className={`font-mono ${num(ev.amount) < 0 ? 'text-red-400' : 'text-gray-300'}`}>{fmt(num(ev.amount))}</span>
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    {editingSvcLegacyUnknown.hasUnexpectedNullDateEvent && (
                      <div className="mt-2 text-[10px] text-red-400 leading-relaxed">
                        ⚠ A payment on this call was recorded without a date and is not a legacy baseline. Its date must be entered directly — it cannot be resolved here.
                      </div>
                    )}

                    {legacyResolveOpen && (
                      <div className="mt-3 rounded-lg border border-orange-700/40 p-2" style={{ backgroundColor: 'var(--bg-card)' }}>
                        <div className="text-[10px] text-orange-300 mb-2">
                          Assign real received date{editingSvcLegacyUnknown.amount > 0 ? '' : ''}s to the undated <span className="font-mono">{fmt(editingSvcLegacyUnknown.amount)}</span> — the collected total stays the same.
                        </div>
                        <div className="space-y-2">
                          {legacyResolveRows.map((row, idx) => (
                            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                              <input
                                type="number" step="0.01" placeholder="Amount"
                                value={row.amount}
                                onChange={e => updateLegacyResolveRow(idx, { amount: e.target.value })}
                                className="w-full rounded px-2 py-1 text-[11px] text-gray-200 border border-gray-600 outline-none focus:border-orange-500"
                                style={{ backgroundColor: 'var(--bg-input)' }}
                              />
                              <input
                                type="date"
                                value={row.receivedAt}
                                onChange={e => updateLegacyResolveRow(idx, { receivedAt: e.target.value })}
                                className="w-full rounded px-2 py-1 text-[11px] text-gray-200 border border-gray-600 outline-none focus:border-orange-500"
                                style={{ backgroundColor: 'var(--bg-input)' }}
                              />
                              <button
                                type="button"
                                onClick={() => removeLegacyResolveRow(idx)}
                                aria-label="Remove row"
                                className="text-gray-500 hover:text-red-400 px-1"
                              ><Trash2 size={13} /></button>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <button type="button" onClick={addLegacyResolveRow} className="text-[10px] px-2 py-1 rounded bg-gray-700/60 text-gray-300 hover:bg-gray-600/60 flex items-center gap-1">
                            <Plus size={11} /> Add row
                          </button>
                          <span className="text-[10px] text-gray-500">
                            Rows total <span className="font-mono text-gray-300">{fmt(legacyResolveRows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0))}</span> · must equal <span className="font-mono text-orange-300">{fmt(editingSvcLegacyUnknown.amount)}</span>
                          </span>
                        </div>
                        {!legacyResolveValidation.ok && legacyResolveRows.length > 0 && (
                          <div className="mt-2 text-[10px] text-amber-400">{legacyResolveValidation.message}</div>
                        )}
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={commitResolveLegacyPayments}
                            disabled={!legacyResolveValidation.ok}
                            className="text-[11px] px-3 py-1.5 rounded bg-orange-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-orange-500"
                          >
                            Save resolved dates
                          </button>
                          <button type="button" onClick={() => { setLegacyResolveOpen(false); setLegacyResolveRows([]) }} className="text-[11px] px-3 py-1.5 rounded bg-gray-700/60 text-gray-300 hover:bg-gray-600/60">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </ServiceCallSection>

              {/* ── E. MATERIALS + PROOF ──────────────────────────────────── */}
              <ServiceCallSection title="Materials + Proof">
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
              </ServiceCallSection>

              {/* ── F. NOTES ──────────────────────────────────────────────── */}
              <ServiceCallSection title="Notes">
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
              </ServiceCallSection>
              </>
            }
            right={
              <>
              {/* ── A. COSTING CREW — determines pricing. Stays out of the
                     left-hand Assignment section on purpose. The pane and its
                     warnings render whether or not costing is valid, so an
                     inactive breakdown always explains itself. ─────────────── */}
              <ServiceCallSection title="Costing Crew" note="drives pricing">
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
              </ServiceCallSection>

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
              </>
            }
          />
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
                // QBO-4A.5-RUN-3 — three-state PowerOn → QuickBooks customer identity for
                // THIS service-log row. STATE 1 (no reconciled UUID) → Resolve Customer;
                // STATE 2 (UUID present, QBO not yet linked) → Link QuickBooks Customer;
                // STATE 3 (linked) handled by the active-row controller's mapping status.
                // Only a reconciled relationship_accounts UUID counts — temporary gc… ids
                // and bare names are rejected by isUuid, so the row stays STATE 1.
                const customerUuid = isCanonicalCustomerId(l.accountId, canonicalIds) ? l.accountId : null

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
                      {(() => {
                        const snapshot = (l as any).costSnapshot as CrewCostSnapshot | undefined
                        if (snapshot?.frozenAt) {
                          return <div className="text-[10px] text-cyan-300 mt-1">Frozen Pricing / {snapshot.frozenAt.slice(0, 10)} / Crew</div>
                        }
                        if (snapshot) {
                          return <div className="text-[10px] text-cyan-300 mt-1">Frozen Pricing / accepted before freeze metadata was recorded</div>
                        }
                        return <div className="text-[10px] text-amber-300 mt-1">Legacy Solo Pricing / historical cost model preserved</div>
                      })()}
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
                          {roll.ratesMissing.map((m: MissingRate) => m.remedy).join(' ')}
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
                      {/* QBO-2F §16 + QBO-4A.5-RUN-3: QuickBooks menu sits next to Convert to
                          Estimate on the same visible service-log action row. Exposes Prepare
                          Invoice (this service log) + Invoice Drafts (shared org-wide manager)
                          AND, conditionally on this row's customer identity state, Resolve
                          Customer for QuickBooks (STATE 1, no UUID) OR Link QuickBooks Customer
                          (STATE 2, UUID present, QBO not yet linked). Never both at once — the
                          row is in exactly one identity state. No fake future actions, no
                          separate Prepare Invoice button. Global-only props (Import QB PDF /
                          Connect / connection-status) stay OFF this contextual menu. */}
                      <QuickBooksMenu
                        onPrepareInvoice={() => openPrepareInvoice(l)}
                        onOpenDrafts={qb.openDrafts}
                        onResolveCustomer={!customerUuid ? () => setResolveTargetId(l.id) : undefined}
                        onLinkCustomer={customerUuid ? () => setLinkTargetId(l.id) : undefined}
                        align="right"
                      />
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

        {/* QBO-2D/2F: Prepare Invoice modal — rendered once (portal handles placement).
            Rehydrates a persisted draft (EDIT mode) when one is selected from the Draft
            Manager; rehydrateSource() falls back to a synthetic source if the service log
            is gone. No QBO API, no payment/KPI mutation. */}
        <PrepareInvoiceModal
          open={prepareSvcLog !== null || qb.prepareDraft != null}
          source={qb.prepareDraft ? null : (prepareSvcLog ? { kind: 'service', serviceLog: prepareSvcLog } : null)}
          initialDraft={qb.prepareDraft}
          onClose={closePrepareInvoice}
          onSaveDraft={qb.handleSaveDraft}
          onApprove={qb.handleApprove}
        />

        {/* QBO-2F: shared organization-wide Invoice Drafts manager (Project + Service). */}
        <InvoiceDraftsModal
          open={qb.draftsOpen}
          onClose={qb.closeDrafts}
          onOpenDraft={(draft) => {
            // Reopen in the Prepare Invoice modal (EDIT mode) above.
            qb.openDraftForEdit(draft)
          }}
          refreshKey={qb.refreshDraftsKey}
        />

        {/* QBO-2F1: global header Prepare Invoice selector. Lists ONLY eligible
            unpaid service work from the shared getUnpaidServiceCalls authority
            (no second unpaid rule). Selecting one opens the EXISTING
            PrepareInvoiceModal above with that exact service log as the source —
            no second invoice editor. No financial values are mutated here. */}
        <PrepareInvoiceSelectorModal
          open={showPrepareInvoiceSelector}
          onClose={() => setShowPrepareInvoiceSelector(false)}
          items={unpaidServiceCalls.map((l) => ({
            id: String(l.id ?? ''),
            customer: canonicalCustomerName(l),
            jobLabel: String(l.jtype || l.jobType || l.category || 'Service Call'),
            date: String(l.date || ''),
            balanceDue: serviceBalanceDue(l),
          }))}
          onSelect={(id) => {
            const log = unpaidServiceCalls.find((l) => String(l.id) === id)
            if (log) {
              openPrepareInvoice(log)
              setShowPrepareInvoiceSelector(false)
            }
          }}
        />

        {/* QBO-3A: QuickBooks Account modal (connected only). Displays only
            approved sanitized info (company, active, connected timestamp) and a
            confirmed disconnect. No realmId/tokens/technical detail. */}
        <QuickBooksAccountModal
          open={conn.accountOpen}
          onClose={conn.closeAccount}
          connected={!!conn.status?.connected}
          companyName={conn.status?.companyName ?? null}
          connectedAt={conn.status && conn.status.connected ? conn.status.connectedAt : null}
          onDisconnect={conn.disconnect}
          disconnecting={conn.disconnecting}
          disconnectError={conn.disconnectError}
        />

        {/* QBO-4A.5-RUN-3: Resolve PowerOn Customer for the ACTIVE service-log row
            (STATE 1 → STATE 2). Presentational modal — no hook, no network. The
            owner explicitly selects a canonical PowerOn account (a real
            relationship_accounts.id TEXT id); onConfirm persists it via
            resolveFieldLogCustomer (identity-only scoped save, NO updatedAt bump,
            NO financial field write). Mounts ONLY when a row's Resolve action is
            active (resolveTargetId set) — zero cost otherwise. The directory +
            canonicalIds come from the shared useCanonicalCustomerDirectory fetch
            (falls back to the gcContacts-derived customerDirectory while loading). */}
        {resolveTargetId && (() => {
          const log = serviceLogs.find((l) => l.id === resolveTargetId)
          const dir = canonicalDirectory.directory.length ? canonicalDirectory.directory : customerDirectory
          return (
            <ResolvePowerOnCustomerModal
              open={!!log}
              onClose={() => setResolveTargetId(null)}
              currentName={log ? canonicalCustomerName(log) : null}
              directory={dir}
              canonicalIds={canonicalIds}
              loading={canonicalDirectory.loading}
              onConfirm={(uuid) => { if (log) resolveFieldLogCustomer(log.id, uuid) }}
            />
          )
        })()}

        {/* QBO-4A.5-RUN-3: Link QuickBooks Customer for the ACTIVE service-log row
            (STATE 2 → STATE 3). FieldLogQboLinkController mounts
            useQuickBooksCustomerMapping ONLY for this one row (lazy, active-row
            only) — NO per-row mapping fetch on page render. Host owns connection
            state, the directory, the customer name, and persistence; the controller
            owns only the mapping hook + the Link modal. NO auto QBO create/link/
            Send/Estimate/Invoice — every QBO write is an explicit owner click. */}
        {linkTargetId && (() => {
          const log = serviceLogs.find((l) => l.id === linkTargetId)
          const customerUuid = log && isCanonicalCustomerId(log.accountId, canonicalIds) ? log.accountId : null
          return (
            <FieldLogQboLinkController
              open={!!log && customerUuid !== null}
              onClose={() => setLinkTargetId(null)}
              poweronCustomerId={customerUuid}
              customerName={log ? canonicalCustomerName(log) : null}
              customerDirectory={customerDirectory}
              connected={!!conn.status?.connected}
              onConnect={conn.connect}
            />
          )
        })()}

        {/* QBO-3A: sanitized same-tab OAuth callback toast (?qbo=…). Carries no
            code/state/tokens — only a connected/cancelled/error signal. */}
        {conn.callbackSignal && (
          <div className="fixed bottom-4 left-1/2 z-[9000] -translate-x-1/2 rounded-lg border border-gray-700 bg-[#111827] px-4 py-2 text-xs text-gray-100 shadow-2xl">
            {conn.callbackSignal === 'connected' && 'QuickBooks connected.'}
            {conn.callbackSignal === 'cancelled' && 'QuickBooks connection was cancelled.'}
            {conn.callbackSignal === 'error' && 'QuickBooks could not be connected. Please try again.'}
          </div>
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
          collected: projectLogs.reduce((s, l) => s + num(l.paymentsCollected || l.collected || 0), 0),
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
      ? triggerThresholdInputMeta(triggerRuleForm.type || 'travel', triggerRuleForm.threshold)
      : null
    const updateTriggerThresholdFromEditor = (rawValue: number) => {
      if (!triggerRuleForm || !thresholdEditorMeta) return
      if (thresholdEditorMeta.mode === 'disabled') return
      const nextThreshold = thresholdEditorMeta.mode === 'money'
        ? rawValue
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
                  <select value={triggerRuleForm.type || 'travel'} onChange={e => setTriggerRuleForm({ ...triggerRuleForm, type: e.target.value })} className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500">
                    {isRetiredDayTargetTriggerType(String(triggerRuleForm.type || '').trim()) && (
                      <option value={String(triggerRuleForm.type)}>{String(triggerRuleForm.type) === 'bad_day' ? 'Bad day (retired)' : 'Good day (retired)'}</option>
                    )}
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
                      disabled={thresholdEditorMeta?.mode === 'disabled'}
                      className="w-full bg-[var(--bg-input)] border border-gray-600 rounded px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-blue-500"
                    />
                    {thresholdEditorMeta?.mode === 'percent' && <span className="text-xs font-bold text-blue-300">%</span>}
                  </div>
                  {thresholdEditorMeta && thresholdEditorMeta.mode !== 'number' && thresholdEditorMeta.mode !== 'disabled' && (
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
                    <div className="text-[10px] text-gray-500 mt-1">
                      {isRetiredDayTargetTriggerType(String(rule.type || '').trim())
                        ? 'Retired legacy condition'
                        : `${rule.type} · threshold ${pct(Math.round(num(rule.threshold) * 100))}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rule.active || false}
                        onChange={e => toggleTrigger(rule.id, e.target.checked)}
                        disabled={isRetiredDayTargetTriggerType(String(rule.type || '').trim())}
                        className="w-4 h-4"
                      />
                      <span className="text-[9px] text-gray-400">
                        {isRetiredDayTargetTriggerType(String(rule.type || '').trim()) ? 'Retired' : rule.active ? 'Active' : 'Inactive'}
                      </span>
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
      // COST-TRUTH-3: settings.opCost only — no invented internal-cost fallback.
      const costRate = internalLaborRate(backup.settings)
      if (costRate <= 0) return false // rate not configured → no profit claim made
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
  const liveWeekProjectLogs = (backup.logs || []).filter(l => !isDeadProjectLog(l) && (l.date || '') >= weekStart)

  // Hours This Week — from project logs only (service logs have different hrs meaning)
  const hoursThisWeek = liveWeekProjectLogs
    .reduce((s, l) => s + num(l.hrs), 0)

  // Revenue This Week — collected from both project logs and service logs
  // FORENSIC-KPI-CANONICAL-READERS-1 Part E: route through the canonical ranged
  // authority so Service cash uses receivedAt (not the work date) and synthetic
  // paid-backfill is not mis-dated into the current week. Service scope stays
  // active-only to match the prior raw-sum scope; project scope is canonical
  // (isCashHistoryProject keeps archived/lost/cancelled historical cash, !dead,
  // backfill excluded). hoursThisWeek / matThisWeek / mileCostThisWeek above/below
  // still use the raw liveWeekProjectLogs sums — only the collected-cash sum changes.
  const _weekStartUtc = new Date(weekStart + 'T00:00:00.000Z')
  const _weekEndUtc = new Date(_weekStartUtc.getTime() + 7 * 86400000)
  const _scopedBackupWeek = {
    ...backup,
    serviceLogs: (backup.serviceLogs || []).filter((l: any) => isActiveServiceCall(l)),
  }
  const revenueThisWeek = getCollectedRevenueForRange(_scopedBackupWeek, _weekStartUtc, _weekEndUtc).knownTotal

  // Mat Cost This Week — from both
  const matThisWeek = liveWeekProjectLogs
    .reduce((s, l) => s + num(l.mat), 0)
    + (backup.serviceLogs || [])
    .filter(l => isActiveServiceCall(l) && (l.date || '') >= weekStart)
    .reduce((s, l) => s + num(l.mat), 0)

  // Net This Week.
  // COST-TRUTH-3: settings.opCost is the internal labor cost authority; billRate is
  // never substituted and there is no invented fallback rate. Without a configured
  // rate no net figure is claimed — the tile reports the rate as unset instead.
  const costRate = internalLaborRate(backup.settings)
  const costRateMissing = costRate <= 0
  const laborCostThisWeek = hoursThisWeek * costRate
  const mileCostThisWeek = liveWeekProjectLogs
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
            <div className={`text-sm font-bold ${costRateMissing ? 'text-amber-400' : netThisWeek >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{costRateMissing ? 'Rate not set' : fmt(netThisWeek)}</div>
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

      {/* FORENSIC-KPI-2B2-2G: Historical Service Payment Reconciliation queue.
          Discovery layer over the existing resolveServiceLegacyPayments resolver.
          z-40 so the Edit Service Call modal (z-50) stacks above it when a queue
          row is resolved; the queue stays mounted and re-renders with the row gone
          once the owner saves + closes the edit modal. No financial mutation
          originates here — Resolve routes into the existing resolver + scoped save. */}
      {showHistoricalPayments && (() => {
        const demoReadOnly = hasHydrated && isDemoMode
        const filterText = historicalFilter.trim().toLowerCase()
        const filteredUnresolved = filterText
          ? reconciliationQueue.unresolved.filter(e => {
              const name = canonicalCustomerName(e.log).toLowerCase()
              const jtype = String((e as any).log?.jtype || '').toLowerCase()
              return name.includes(filterText) || jtype.includes(filterText)
            })
          : reconciliationQueue.unresolved
        return (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
            onClick={() => setShowHistoricalPayments(false)}
          >
            <div
              className="relative mx-4 w-full max-w-3xl flex flex-col overflow-hidden rounded-2xl shadow-2xl"
              style={{
                maxHeight: '88vh',
                background: 'linear-gradient(145deg, rgba(20,16,12,0.99) 0%, rgba(12,14,10,0.99) 60%, rgba(8,10,8,0.99) 100%)',
                border: '1px solid rgba(249,115,22,0.32)',
                boxShadow: '0 28px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-orange-900/40">
                <div className="flex items-center gap-2">
                  <Timer size={14} className="text-orange-400" />
                  <span className="text-sm font-bold text-orange-200">Historical Service Payments</span>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setShowHistoricalPayments(false)}
                  className="text-gray-400 hover:text-gray-200"
                ><X size={16} /></button>
              </div>

              {/* Summary */}
              <div className="px-4 py-3 border-b border-gray-800/60 space-y-2">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Calls needing dates</div>
                    <div className="text-base font-bold text-orange-300">{reconciliationQueue.unresolvedCount}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">Undated collected</div>
                    <div className="text-base font-bold font-mono text-orange-300">{fmt(reconciliationQueue.undatedTotal)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-gray-500 uppercase font-bold">With dated payments</div>
                    <div className="text-base font-bold text-emerald-400">{reconciliationQueue.resolvedCount}</div>
                  </div>
                </div>
                {/* Progress (Part G): DATED vs UNDATED dollars — not yearly reporting. */}
                <div className="flex items-center justify-between text-[10px] text-gray-400 px-1">
                  <span>Dated collected: <span className="font-mono text-emerald-400">{fmt(reconciliationQueue.datedCollected)}</span></span>
                  <span>Still undated: <span className="font-mono text-orange-300">{fmt(reconciliationQueue.undatedTotal)}</span></span>
                </div>
                <div className="text-[10px] text-gray-500 leading-relaxed">
                  Collected money with no recorded Date Received. Resolving assigns a real received date — the collected total stays the same; only the cash DATE moves.
                </div>
                <div className="text-[10px] text-gray-600 leading-relaxed">
                  52-week history updates after recalculation.
                </div>
                {demoReadOnly && (
                  <div className="text-[10px] text-amber-400 leading-relaxed">
                    Reconciliation is read-only in Demo Mode — Resolve is disabled.
                  </div>
                )}
              </div>

              {/* Filter */}
              {reconciliationQueue.unresolvedCount > 0 && (
                <div className="px-4 py-2 border-b border-gray-800/60">
                  <input
                    type="text"
                    value={historicalFilter}
                    onChange={e => setHistoricalFilter(e.target.value)}
                    placeholder="Filter by customer or job type"
                    className="w-full rounded px-2 py-1 text-[11px] text-gray-200 border border-gray-600 outline-none focus:border-orange-500"
                    style={{ backgroundColor: 'var(--bg-input)' }}
                  />
                </div>
              )}

              {/* List */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {reconciliationQueue.unresolvedCount === 0 && reconciliationQueue.warnings.length === 0 && (
                  <div className="text-center text-xs text-gray-500 py-8">
                    All collected cash has recorded payment dates.
                  </div>
                )}

                {filteredUnresolved.map(entry => {
                  const name = canonicalCustomerName(entry.log)
                  const jtype = (entry as any).log?.jtype || ''
                  const svcDate = entry.serviceDate
                  return (
                    <div key={entry.id} className="rounded-lg border border-gray-700/50 p-3 flex items-center justify-between gap-3" style={{ backgroundColor: 'var(--bg-input)' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-gray-200 truncate">{name}</span>
                          {jtype && <span className="text-[10px] text-gray-500">{jtype}</span>}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 flex-wrap text-[10px] text-gray-500">
                          <span>Service date: {svcDate || 'No date'}</span>
                          <span className="text-amber-400">Payment date: Unknown</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-bold font-mono text-orange-300">{fmt(entry.unknownAmount)}</span>
                        <button
                          type="button"
                          onClick={() => openResolveFromQueue(entry.log)}
                          disabled={demoReadOnly}
                          data-testid="historical-payments-resolve"
                          className="text-[11px] px-3 py-1.5 rounded bg-orange-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-orange-500"
                        >
                          Resolve
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* Warnings: unexpected null-date events the resolver refuses. */}
                {reconciliationQueue.warnings.length > 0 && (
                  <div className="pt-2 space-y-2">
                    <div className="text-[10px] text-red-400 uppercase font-bold">Needs attention — fix the date directly</div>
                    {reconciliationQueue.warnings.map(entry => {
                      const name = canonicalCustomerName(entry.log)
                      const jtype = (entry as any).log?.jtype || ''
                      return (
                        <div key={entry.id} className="rounded-lg border border-red-900/50 p-3 flex items-center justify-between gap-3" style={{ backgroundColor: 'var(--bg-input)' }}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold text-gray-200 truncate">{name}</span>
                              {jtype && <span className="text-[10px] text-gray-500">{jtype}</span>}
                            </div>
                            <div className="mt-0.5 text-[10px] text-red-400 leading-relaxed">
                              A payment on this call was recorded without a date and is not a legacy baseline. Its date must be entered directly in Payment History — it cannot be resolved here.
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openWarningEditFromQueue(entry.id)}
                            disabled={demoReadOnly}
                            className="text-[11px] px-3 py-1.5 rounded bg-gray-700/60 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-600/60 shrink-0"
                          >
                            Edit call
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
          employeeCount: employees.length,
        }}
        isOpen={aiOpen}
        onClose={() => setAiOpen(false)}
      />

      {/* FORENSIC-KPI-2B1: real payment capture — amount + actual received date. */}
      <RecordServicePaymentModal
        request={payRequest}
        today={localTodayKey()}
        onCancel={() => setPayRequest(null)}
        onConfirm={commitServicePayment}
      />
    </div>
  )
}

/**
 * QBO-4A.5-RUN-3 — lazy, ACTIVE-ROW-ONLY Link controller for the Field Log
 * service-log row. The host (V15rFieldLogPanel) mounts this ONLY when a row's
 * "Link QuickBooks Customer" action is active (linkTargetId set), so
 * useQuickBooksCustomerMapping — the single network boundary for QBO customer
 * mapping — loads for EXACTLY ONE row, lazily, on demand. There is NO per-row
 * mapping fetch on initial page render (the performance rule: one active row,
 * one hook, one fetch). STATE 2 (UUID present, QBO not yet linked) → STATE 3
 * (linked) transition lives inside the Link modal this renders.
 *
 * Division of ownership: the host owns the QBO connection state, the in-memory
 * customer directory, the customer display name, and ALL persistence (identity
 * resolve + any future Send). This controller owns ONLY the mapping hook + the
 * Link modal render — it performs NO persistence and NO auto QBO write. Every
 * QBO create/link/unlink is an explicit owner click inside LinkQuickBooksCustomerModal.
 */
function FieldLogQboLinkController({
  open,
  onClose,
  poweronCustomerId,
  customerName,
  customerDirectory,
  connected,
  onConnect,
}: {
  open: boolean
  onClose: () => void
  poweronCustomerId: string | null
  customerName: string | null
  customerDirectory: readonly CustomerDirectoryEntry[]
  connected: boolean | null
  onConnect: () => void
}) {
  // Single network boundary for this ONE active row. connected===false =>
  // disconnected (no fetch). The hook is created here, unconditionally, so React's
  // rules-of-hooks hold; the LAZY behavior comes from the host conditionally
  // MOUNTING this controller only when a row is active.
  const mapping = useQuickBooksCustomerMapping({ poweronCustomerId, connected })
  return (
    <LinkQuickBooksCustomerModal
      open={open}
      onClose={onClose}
      api={mapping}
      poweronCustomerId={poweronCustomerId}
      customerName={customerName}
      customerDirectory={customerDirectory}
      connected={connected}
      onConnect={onConnect}
    />
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

      {!isLegacy && !isFrozen && onRecalculate && (
        <div className="mb-2 rounded-lg border border-blue-700/20 bg-blue-900/10 px-3 py-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] text-blue-200 font-semibold">Current Live Pricing</div>
            <p className="text-[10px] text-gray-500">Uses current Team labor, overhead, mileage, tax, and this estimate's Bill Rate.</p>
          </div>
          <button type="button" onClick={onRecalculate} disabled={recalculateDisabled} className={`text-[10px] font-semibold underline shrink-0 ${recalculateDisabled ? 'text-gray-500 cursor-not-allowed' : 'text-blue-300 hover:text-blue-200'}`}>
            Refresh Cost Inputs
          </button>
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

export function ServiceCostingBlockedPanel({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-xl border border-amber-500/40 px-4 py-4" style={{ backgroundColor: 'var(--bg-secondary)' }} data-testid="service-costing-blocked-panel">
      <div className="flex items-center gap-2 text-sm font-bold text-amber-400">
        <AlertCircle size={16} /> Current live cost unavailable
      </div>
      <p className="text-xs text-gray-400 mt-1">Configure these inputs before saving or confirming. The app will not substitute settings.opCost or another fallback.</p>
      <ul className="mt-2 space-y-1 list-disc list-inside">
        {errors.map((error, index) => <li key={index} className="text-xs text-amber-200">{error}</li>)}
      </ul>
    </div>
  )
}

export function PricingSnapshotDeltaPanel({ previous, current }: { previous: CrewCostSnapshot; current: CrewQuoteBreakdown }) {
  const difference = round2(current.totalInternalCost - previous.totalInternalCost)
  return (
    <div className="rounded-xl border border-cyan-700/30 bg-cyan-900/10 px-4 py-3 text-xs" data-testid="pricing-snapshot-delta">
      <div className="font-bold uppercase tracking-wide text-cyan-300">Previous Saved Crew Cost</div>
      <div className="grid grid-cols-3 gap-2 mt-2 text-gray-400">
        <div>Previous<br /><span className="font-mono text-gray-200">{fmt(previous.totalInternalCost)}</span></div>
        <div>Current<br /><span className="font-mono text-gray-200">{fmt(current.totalInternalCost)}</span></div>
        <div>Difference<br /><span className={`font-mono ${difference > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{difference > 0 ? '+' : ''}{fmt(difference)}</span></div>
      </div>
      <p className="text-[10px] text-gray-500 mt-2">Reference only - OPEN pricing uses the current live calculation.</p>
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
 * Profit, Actual Profit Margin, and the cost bar.
 */
export function ServiceQuotePanel({
  quote, totalQuotedInput, onTotalQuotedChange, onUseSuggested, mileRate, taxRate, opCost, operatingCostLabel, accent = 'blue',
}: {
  quote: any
  totalQuotedInput: string
  onTotalQuotedChange: (raw: string) => void
  onUseSuggested: () => void
  mileRate: number
  taxRate: number
  opCost: number
  operatingCostLabel?: string
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
            <div className="text-[9px] uppercase tracking-wider text-gray-500 mb-1">
              {operatingCostLabel || 'Operating Cost'}
              {!operatingCostLabel && <span className="opacity-50"> @${opCost.toFixed(2)}/hr</span>}
            </div>
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

      {total > 0 && profit <= 0 && (
        <div className="rounded-xl px-4 py-3 text-xs border bg-red-500/10 border-red-500/25 text-red-400">
          <span>🔴 <strong>Unprofitable</strong> — costs exceed the quoted amount by {fmt(Math.abs(profit))}. Reprice or reduce scope.</span>
        </div>
      )}
    </div>
  )
}
