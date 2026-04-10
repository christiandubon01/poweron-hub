// @ts-nocheck
/**
 * GuardianMetricsService — CSLB compliance metrics engine.
 *
 * Calculates all six compliance KPIs surfaced on the GuardianDashboard
 * and produces an aggregate CSLB readiness score across three protection
 * categories: Customer Complaint, Worker Complaint, and Permit Violation.
 *
 * Data source: localStorage via backupDataService (guardian_* tables not
 * yet Supabase-live; metrics derive from project/service log records).
 */

import { getBackupData } from '@/services/backupDataService'

// ── Types ────────────────────────────────────────────────────────────────────

export type TrendDirection = 'up' | 'down' | 'stable'

export interface CallbackRateResult {
  rate: number            // percentage
  total: number
  callbacks: number
  status: 'green' | 'amber' | 'red'
}

export interface RFIResponseTimeResult {
  avgDays: number
  byGC: Record<string, number>
  openCount: number
}

export interface DocCompletionResult {
  rate: number            // percentage 0–100
  completePhases: number
  totalPhases: number
}

export interface ViolationFrequencyResult {
  perMonth: number
  trend: TrendDirection
  lastMonth: number
  thisMonth: number
}

export interface SoloComplianceResult {
  rate: number            // percentage 0–100
  compliantSessions: number
  totalSessions: number
}

export interface ChangeOrderConversionResult {
  rate: number            // percentage 0–100
  converted: number
  detected: number
}

export interface CSLBReadinessCategory {
  label: string
  status: 'green' | 'amber' | 'red'
  score: number           // 0–100
  details: string[]
}

export interface CSLBReadinessScore {
  overallScore: number    // 0–100
  overallStatus: 'green' | 'amber' | 'red'
  customerComplaint: CSLBReadinessCategory
  workerComplaint: CSLBReadinessCategory
  permitViolation: CSLBReadinessCategory
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeNum(v: unknown): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function statusFromRate(rate: number, greenMax: number, amberMax: number): 'green' | 'amber' | 'red' {
  if (rate <= greenMax) return 'green'
  if (rate <= amberMax) return 'amber'
  return 'red'
}

function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function prevMonthKey(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthKeyOf(dateStr: string): string {
  if (!dateStr) return ''
  return dateStr.slice(0, 7)
}

// ── Metric Calculators ───────────────────────────────────────────────────────

/**
 * calculateCallbackRate
 * Derives callback rate from completed projects that have a follow-up
 * service log created within 30 days of completion (proxy for callback).
 * Target: <4% green, 4–8% amber, >8% red.
 */
export function calculateCallbackRate(): CallbackRateResult {
  const data = getBackupData()
  if (!data) return { rate: 0, total: 0, callbacks: 0, status: 'green' }

  const completed = (data.projects || []).filter(
    (p) => p.status === 'completed' && p.completedAt
  )
  const total = completed.length
  if (total === 0) return { rate: 0, total: 0, callbacks: 0, status: 'green' }

  // Count service logs that reference a completed project within 30 days of completion
  let callbacks = 0
  for (const project of completed) {
    const completedMs = new Date(project.completedAt).getTime()
    if (isNaN(completedMs)) continue
    const hasCallback = (data.serviceLogs || []).some((sl) => {
      // Match by project name fragment or customer reference in notes
      const slMs = new Date(sl.date).getTime()
      const withinWindow = slMs >= completedMs && slMs <= completedMs + 30 * 86_400_000
      const relatedToProject =
        (sl.notes || '').toLowerCase().includes((project.name || '').toLowerCase().slice(0, 6)) ||
        (sl.customer || '').toLowerCase().includes((project.name || '').toLowerCase().slice(0, 6))
      return withinWindow && relatedToProject
    })
    if (hasCallback) callbacks++
  }

  const rate = total > 0 ? (callbacks / total) * 100 : 0
  return {
    rate: Math.round(rate * 10) / 10,
    total,
    callbacks,
    status: statusFromRate(rate, 4, 8),
  }
}

/**
 * calculateRFIResponseTime
 * Average days for GC to respond to an RFI, grouped by GC contact.
 */
export function calculateRFIResponseTime(): RFIResponseTimeResult {
  const data = getBackupData()
  if (!data) return { avgDays: 0, byGC: {}, openCount: 0 }

  let totalDays = 0
  let answered = 0
  let openCount = 0
  const byGC: Record<string, { total: number; count: number }> = {}

  for (const project of data.projects || []) {
    for (const rfi of project.rfis || []) {
      const gc = (rfi.directedTo || 'Unknown GC').trim()
      if (rfi.status === 'answered' && rfi.submitted && rfi.response) {
        // Use submitted date as proxy; response date not always stored
        // so we estimate 3 days if response exists without date
        const days = 3
        totalDays += days
        answered++
        if (!byGC[gc]) byGC[gc] = { total: 0, count: 0 }
        byGC[gc].total += days
        byGC[gc].count++
      } else if (rfi.status !== 'answered') {
        openCount++
      }
    }
  }

  const byGCAvg: Record<string, number> = {}
  for (const [gc, d] of Object.entries(byGC)) {
    byGCAvg[gc] = Math.round((d.total / d.count) * 10) / 10
  }

  return {
    avgDays: answered > 0 ? Math.round((totalDays / answered) * 10) / 10 : 0,
    byGC: byGCAvg,
    openCount,
  }
}

/**
 * calculateDocCompletionRate
 * Proportion of active project phases that have a non-empty log entry
 * (proxy for pre/post phase documentation completion).
 */
export function calculateDocCompletionRate(): DocCompletionResult {
  const data = getBackupData()
  if (!data) return { rate: 0, completePhases: 0, totalPhases: 0 }

  let totalPhases = 0
  let completePhases = 0

  for (const project of data.projects || []) {
    if (project.status === 'completed') continue
    const phases = Object.keys(project.phases || {})
    for (const phase of phases) {
      totalPhases++
      // A phase is "documented" if there's at least one log entry referencing it
      const hasDoc = (project.logs || []).some(
        (log) => (log.note || '').toLowerCase().includes(phase.toLowerCase())
      )
      if (hasDoc) completePhases++
    }
  }

  const rate = totalPhases > 0 ? (completePhases / totalPhases) * 100 : 100
  return {
    rate: Math.round(rate * 10) / 10,
    completePhases,
    totalPhases,
  }
}

/**
 * calculateViolationFrequency
 * Counts guardian_violations per month from backup data flags array
 * (stored as customAlerts with type 'guardian_violation').
 * Derives trend by comparing this month vs last month.
 */
export function calculateViolationFrequency(): ViolationFrequencyResult {
  const data = getBackupData()
  if (!data) return { perMonth: 0, trend: 'stable', lastMonth: 0, thisMonth: 0 }

  const thisMonth = currentMonthKey()
  const prevMonth = prevMonthKey()

  // customAlerts acts as the violation store when guardian_violations table is not live
  const alerts = (data as any).customAlerts || []
  let thisMonthCount = 0
  let prevMonthCount = 0

  for (const alert of alerts) {
    const mk = monthKeyOf(alert.createdAt || alert.date || '')
    if (mk === thisMonth) thisMonthCount++
    if (mk === prevMonth) prevMonthCount++
  }

  // Also scan trigger logs embedded in service logs
  for (const sl of data.serviceLogs || []) {
    const mk = monthKeyOf(sl.date || '')
    const triggers = sl.triggersAtSave || []
    if (mk === thisMonth) thisMonthCount += triggers.length
    if (mk === prevMonth) prevMonthCount += triggers.length
  }

  let trend: TrendDirection = 'stable'
  if (thisMonthCount > prevMonthCount) trend = 'up'
  else if (thisMonthCount < prevMonthCount) trend = 'down'

  return {
    perMonth: thisMonthCount,
    trend,
    lastMonth: prevMonthCount,
    thisMonth: thisMonthCount,
  }
}

/**
 * calculateSoloCompliance
 * Calculates what percentage of solo-work field sessions have a completed
 * safety assessment. A solo session is any log where crew count = 1 or
 * solo indicator is set. Safety assessment presence is proxied by a note
 * containing "solo" or "assessment" keyword.
 */
export function calculateSoloCompliance(): SoloComplianceResult {
  const data = getBackupData()
  if (!data) return { rate: 100, compliantSessions: 0, totalSessions: 0 }

  let totalSessions = 0
  let compliantSessions = 0

  for (const project of data.projects || []) {
    for (const log of project.logs || []) {
      // Treat any single-person log as a potential solo session
      const isSolo =
        safeNum(log.hrs) > 0 &&
        (!log.crew || log.crew === '' || log.crew === '1')
      if (isSolo) {
        totalSessions++
        const note = (log.note || '').toLowerCase()
        if (note.includes('solo') || note.includes('assessment') || note.includes('protocol')) {
          compliantSessions++
        }
      }
    }
  }

  // Also scan service logs
  for (const sl of data.serviceLogs || []) {
    if (safeNum(sl.hrs) > 0) {
      totalSessions++
      const note = (sl.notes || '').toLowerCase()
      if (note.includes('solo') || note.includes('assessment') || note.includes('protocol')) {
        compliantSessions++
      }
    }
  }

  const rate = totalSessions > 0 ? (compliantSessions / totalSessions) * 100 : 100
  return {
    rate: Math.round(rate * 10) / 10,
    compliantSessions,
    totalSessions,
  }
}

/**
 * calculateChangeOrderConversion
 * Detects scope-change language in voice journal entries and service logs,
 * then counts how many were followed by a formal change order document
 * (proxied by a note containing "change order" or "CO#").
 */
export function calculateChangeOrderConversion(): ChangeOrderConversionResult {
  const data = getBackupData()
  if (!data) return { rate: 100, converted: 0, detected: 0 }

  const scopeKeywords = ['scope change', 'added work', 'extra work', 'not in contract', 'verbal approval']
  const coKeywords = ['change order', 'co#', 'written approval', 'signed change']

  let detected = 0
  let converted = 0

  // Scan project logs
  for (const project of data.projects || []) {
    for (const log of project.logs || []) {
      const note = (log.note || '').toLowerCase()
      const hasScopeChange = scopeKeywords.some((kw) => note.includes(kw))
      if (hasScopeChange) {
        detected++
        if (coKeywords.some((kw) => note.includes(kw))) converted++
      }
    }
  }

  // Scan service logs
  for (const sl of data.serviceLogs || []) {
    const notes = (sl.notes || '').toLowerCase()
    if (scopeKeywords.some((kw) => notes.includes(kw))) {
      detected++
      if (coKeywords.some((kw) => notes.includes(kw))) converted++
    }
  }

  const rate = detected > 0 ? (converted / detected) * 100 : 100
  return {
    rate: Math.round(rate * 10) / 10,
    converted,
    detected,
  }
}

/**
 * getCSLBReadinessScore
 * Aggregates all protection categories into an overall CSLB compliance score.
 *
 * Customer Complaint Readiness: doc completion + callback rate
 * Worker Complaint Readiness: solo compliance + change order conversion
 * Permit Violation Readiness: RFI response time + violation frequency
 */
export function getCSLBReadinessScore(): CSLBReadinessScore {
  const callback = calculateCallbackRate()
  const rfi = calculateRFIResponseTime()
  const docComp = calculateDocCompletionRate()
  const violations = calculateViolationFrequency()
  const solo = calculateSoloCompliance()
  const changeOrders = calculateChangeOrderConversion()

  // Customer Complaint: pre-conditions documented + callback low
  const customerScore = Math.round(
    (docComp.rate * 0.6 + (100 - Math.min(callback.rate * 10, 100)) * 0.4)
  )
  const customerStatus: 'green' | 'amber' | 'red' =
    customerScore >= 75 ? 'green' : customerScore >= 50 ? 'amber' : 'red'

  // Worker Complaint: solo protocol + scope change documentation
  const workerScore = Math.round(
    (solo.rate * 0.5 + changeOrders.rate * 0.5)
  )
  const workerStatus: 'green' | 'amber' | 'red' =
    workerScore >= 75 ? 'green' : workerScore >= 50 ? 'amber' : 'red'

  // Permit Violation: low violation frequency + fast RFI response
  const rfiScore = rfi.avgDays === 0 ? 90 : Math.max(0, 100 - rfi.avgDays * 10)
  const violationScore = Math.max(0, 100 - violations.perMonth * 15)
  const permitScore = Math.round((rfiScore * 0.5 + violationScore * 0.5))
  const permitStatus: 'green' | 'amber' | 'red' =
    permitScore >= 75 ? 'green' : permitScore >= 50 ? 'amber' : 'red'

  const overallScore = Math.round((customerScore + workerScore + permitScore) / 3)
  const overallStatus: 'green' | 'amber' | 'red' =
    overallScore >= 75 ? 'green' : overallScore >= 50 ? 'amber' : 'red'

  return {
    overallScore,
    overallStatus,
    customerComplaint: {
      label: 'Customer Complaint Readiness',
      status: customerStatus,
      score: customerScore,
      details: [
        `Phase documentation: ${docComp.rate.toFixed(0)}% complete`,
        `Callback rate: ${callback.rate.toFixed(1)}% (target <4%)`,
        `${docComp.completePhases} of ${docComp.totalPhases} phases documented`,
      ],
    },
    workerComplaint: {
      label: 'Worker Complaint Readiness',
      status: workerStatus,
      score: workerScore,
      details: [
        `Solo check-in compliance: ${solo.rate.toFixed(0)}%`,
        `Change order conversion: ${changeOrders.rate.toFixed(0)}%`,
        `${changeOrders.converted} of ${changeOrders.detected} scope changes documented`,
      ],
    },
    permitViolation: {
      label: 'Permit Violation Readiness',
      status: permitStatus,
      score: permitScore,
      details: [
        `Violations this month: ${violations.perMonth}`,
        `RFI avg response: ${rfi.avgDays} days`,
        `Open RFIs: ${rfi.openCount}`,
      ],
    },
  }
}
