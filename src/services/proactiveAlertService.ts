// @ts-nocheck
/**
 * proactiveAlertService.ts — B12 Proactive NEXUS Alerts Pipeline
 *
 * Runs 5 alert rules against backupDataService on app load and every 30 minutes.
 * Dismissed alerts are stored in localStorage with a 24-hour TTL.
 *
 * Alert delivery:
 * 1. ConclusionCards row (dashboard top) — ProactiveAlertCards component
 * 2. NEXUS morning briefing — prepended on first open of the day
 */

import { getBackupData, health, daysSince } from './backupDataService'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface ProactiveAlert {
  id: string
  ruleId: string
  severity: AlertSeverity
  message: string
  triggeredAt: number
  /** Optional project/entity name for badge display */
  entityLabel?: string
}

// ── localStorage keys ─────────────────────────────────────────────────────────

const DISMISSED_KEY = 'poweron_alert_dismissed'
const ALERTS_CACHE_KEY = 'poweron_alerts_cache'
const ALERT_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ── Dismiss helpers ───────────────────────────────────────────────────────────

function getDismissed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function pruneDismissed(map: Record<string, number>): Record<string, number> {
  const now = Date.now()
  const pruned: Record<string, number> = {}
  for (const [id, ts] of Object.entries(map)) {
    if (now - ts < ALERT_TTL_MS) pruned[id] = ts
  }
  return pruned
}

export function dismissAlert(alertId: string): void {
  try {
    const map = pruneDismissed(getDismissed())
    map[alertId] = Date.now()
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(map))
  } catch { /* ignore */ }
}

export function isAlertDismissed(alertId: string): boolean {
  try {
    const map = getDismissed()
    const ts = map[alertId]
    if (!ts) return false
    return Date.now() - ts < ALERT_TTL_MS
  } catch { return false }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function daysBetween(dateStr: string | undefined | null, now: Date): number {
  if (!dateStr) return 0
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 0
  return Math.floor((now.getTime() - d.getTime()) / 86400000)
}

function fmtMoney(amount: number): string {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ── Alert Rules ───────────────────────────────────────────────────────────────

function runRule1_ARaging(now: Date): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = []
  const backup = getBackupData()
  if (!backup) return alerts

  // Check service logs with outstanding balance
  const unpaid = (backup.serviceLogs || []).filter(s => {
    const balance = num(s.balanceDue)
    if (balance <= 0) return false
    // Also check quoted > collected pattern if balanceDue isn't set
    const effectiveBalance = balance > 0 ? balance : Math.max(0, num(s.quoted) - num(s.collected))
    return effectiveBalance > 0 && s.date
  })

  for (const log of unpaid) {
    const balance = Math.max(num(log.balanceDue), Math.max(0, num(log.quoted) - num(log.collected)))
    if (balance <= 0) continue

    const daysOld = daysBetween(log.date, now)
    if (daysOld < 30) continue

    const severity: AlertSeverity = daysOld >= 60 ? 'critical' : 'warning'
    const client = log.customer || 'Unknown Client'
    const id = `ar-${log.id || log.date}-${daysOld}`

    alerts.push({
      id,
      ruleId: 'rule1_ar_aging',
      severity,
      message: `${client} — invoice is ${daysOld} days overdue. ${fmtMoney(balance)} outstanding.`,
      triggeredAt: Date.now(),
      entityLabel: client,
    })
  }

  return alerts
}

function runRule2_ProjectHealth(now: Date): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = []
  const backup = getBackupData()
  if (!backup) return alerts

  const activeProjects = (backup.projects || []).filter(
    p => p.status === 'active' || p.status === 'coming'
  )

  for (const project of activeProjects) {
    const { sc, reasons } = health(project, backup)
    if (sc >= 60) continue

    const severity: AlertSeverity = sc < 40 ? 'critical' : 'warning'
    const topRisk = reasons[0] || 'low activity'
    const id = `ph-${project.id}-${sc}`

    alerts.push({
      id,
      ruleId: 'rule2_project_health',
      severity,
      message: `${project.name} health score is ${sc}/100. ${topRisk}.`,
      triggeredAt: Date.now(),
      entityLabel: project.name,
    })
  }

  return alerts
}

function runRule3_RFINoResponse(now: Date): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = []
  const backup = getBackupData()
  if (!backup) return alerts

  for (const project of backup.projects || []) {
    const rfis: any[] = project.rfis || []
    for (const rfi of rfis) {
      // Open = not answered / not closed
      const status = (rfi.status || '').toLowerCase()
      if (status === 'answered' || status === 'closed') continue

      const createdAt = rfi.createdAt || rfi.created_at || rfi.date || ''
      const daysOpen = daysBetween(createdAt, now)
      if (daysOpen < 5) continue

      const rfiNum = rfi.number || rfi.id || '?'
      const id = `rfi-${project.id}-${rfiNum}-${daysOpen}`

      alerts.push({
        id,
        ruleId: 'rule3_rfi_no_response',
        severity: 'warning',
        message: `RFI #${rfiNum} on ${project.name} has been open ${daysOpen} days with no response.`,
        triggeredAt: Date.now(),
        entityLabel: project.name,
      })
    }
  }

  return alerts
}

function runRule4_FieldLogGap(now: Date): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = []
  const backup = getBackupData()
  if (!backup) return alerts

  const activeProjects = (backup.projects || []).filter(
    p => p.status === 'active'
  )

  for (const project of activeProjects) {
    // Get all logs for this project from backup.logs
    const projectLogs = (backup.logs || []).filter(l => l.projId === project.id)

    if (projectLogs.length === 0) {
      // No logs at all — only alert if project has been active for 3+ days
      const projectCreatedDays = daysBetween(project.lastMove || '', now)
      if (projectCreatedDays < 3) continue

      const id = `flg-${project.id}-nologs`
      alerts.push({
        id,
        ruleId: 'rule4_field_log_gap',
        severity: 'info',
        message: `${project.name} — no field log entry in ${projectCreatedDays} days. No entries on record.`,
        triggeredAt: Date.now(),
        entityLabel: project.name,
      })
      continue
    }

    // Find most recent log date
    const sortedLogs = projectLogs
      .filter(l => l.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))

    const lastLog = sortedLogs[0]
    if (!lastLog?.date) continue

    const daysSinceLast = daysBetween(lastLog.date, now)
    if (daysSinceLast < 3) continue

    const lastDateStr = new Date(lastLog.date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric'
    })
    const id = `flg-${project.id}-${lastLog.date}`

    alerts.push({
      id,
      ruleId: 'rule4_field_log_gap',
      severity: 'info',
      message: `${project.name} — no field log entry in ${daysSinceLast} days. Last entry: ${lastDateStr}.`,
      triggeredAt: Date.now(),
      entityLabel: project.name,
    })
  }

  return alerts
}

function runRule5_UnbilledExposure(now: Date): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = []
  const backup = getBackupData()
  if (!backup) return alerts

  // Unbilled SVC exposure = service logs where collected < quoted (pending invoicing)
  const pendingJobs = (backup.serviceLogs || []).filter(s => {
    const quoted = num(s.quoted)
    const collected = num(s.collected)
    return quoted > 0 && collected < quoted
  })

  const totalExposure = pendingJobs.reduce((sum, s) => {
    return sum + Math.max(0, num(s.quoted) - num(s.collected))
  }, 0)

  if (totalExposure < 5000) return alerts

  const id = `ube-${Math.round(totalExposure)}`
  alerts.push({
    id,
    ruleId: 'rule5_unbilled_exposure',
    severity: 'warning',
    message: `${fmtMoney(totalExposure)} in unbilled service exposure. ${pendingJobs.length} job${pendingJobs.length !== 1 ? 's' : ''} pending invoicing.`,
    triggeredAt: Date.now(),
  })

  return alerts
}

// ── Main engine ───────────────────────────────────────────────────────────────

let _alertCache: ProactiveAlert[] = []
let _lastRun = 0
const CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

export function runAlertChecks(): ProactiveAlert[] {
  _lastRun = Date.now()
  const now = new Date()

  const raw: ProactiveAlert[] = [
    ...runRule1_ARaging(now),
    ...runRule2_ProjectHealth(now),
    ...runRule3_RFINoResponse(now),
    ...runRule4_FieldLogGap(now),
    ...runRule5_UnbilledExposure(now),
  ]

  // Deduplicate by id
  const seen = new Set<string>()
  const deduped: ProactiveAlert[] = []
  for (const alert of raw) {
    if (!seen.has(alert.id)) {
      seen.add(alert.id)
      deduped.push(alert)
    }
  }

  // Sort: critical first, then warning, then info
  const order: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }
  deduped.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))

  _alertCache = deduped

  // Persist to localStorage for cross-component reads
  try {
    localStorage.setItem(ALERTS_CACHE_KEY, JSON.stringify({ ts: _lastRun, alerts: deduped }))
  } catch { /* ignore */ }

  return deduped
}

/** Returns active (non-dismissed) alerts from the cache */
export function getActiveAlerts(): ProactiveAlert[] {
  // Try memory cache first; fall back to localStorage
  if (_alertCache.length === 0 || Date.now() - _lastRun > CHECK_INTERVAL_MS) {
    try {
      const raw = localStorage.getItem(ALERTS_CACHE_KEY)
      if (raw) {
        const { ts, alerts } = JSON.parse(raw) as { ts: number; alerts: ProactiveAlert[] }
        if (Date.now() - ts < CHECK_INTERVAL_MS) {
          _alertCache = alerts || []
          _lastRun = ts
        } else {
          // Cache stale — rerun
          return runAlertChecks().filter(a => !isAlertDismissed(a.id))
        }
      } else {
        return runAlertChecks().filter(a => !isAlertDismissed(a.id))
      }
    } catch { /* ignore */ }
  }

  return _alertCache.filter(a => !isAlertDismissed(a.id))
}

/** Refreshes alerts immediately and returns active alerts */
export function refreshAlerts(): ProactiveAlert[] {
  return runAlertChecks().filter(a => !isAlertDismissed(a.id))
}

// ── Periodic engine init ──────────────────────────────────────────────────────

let _intervalId: ReturnType<typeof setInterval> | null = null

/**
 * initAlertEngine — Call once at app startup.
 * Runs an immediate check and schedules 30-minute rechecks.
 * Returns cleanup function.
 */
export function initAlertEngine(): () => void {
  // Run immediately on startup
  try {
    runAlertChecks()
  } catch (err) {
    console.warn('[ProactiveAlerts] Initial check failed:', err)
  }

  // Schedule 30-minute checks
  if (_intervalId !== null) clearInterval(_intervalId)
  _intervalId = setInterval(() => {
    try {
      runAlertChecks()
    } catch (err) {
      console.warn('[ProactiveAlerts] Periodic check failed:', err)
    }
  }, CHECK_INTERVAL_MS)

  return () => {
    if (_intervalId !== null) {
      clearInterval(_intervalId)
      _intervalId = null
    }
  }
}

// ── Morning briefing helpers ─────────────────────────────────────────────────

const FIRST_OPEN_KEY = 'poweron_nexus_first_open_date'

/** Returns true if this is the first NEXUS open of the current calendar day */
export function isFirstNexusOpenToday(): boolean {
  try {
    const stored = localStorage.getItem(FIRST_OPEN_KEY)
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    if (stored === today) return false
    localStorage.setItem(FIRST_OPEN_KEY, today)
    return true
  } catch { return false }
}

/** Returns formatted alert lines for NEXUS morning briefing prepend */
export function getAlertSummaryForBriefing(): string {
  const alerts = getActiveAlerts()
  if (alerts.length === 0) return ''

  const lines = alerts
    .slice(0, 5) // cap at 5 for briefing
    .map(a => {
      const prefix = a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟡' : '🔵'
      return `${prefix} ${a.message}`
    })

  return `⚠️ PROACTIVE ALERTS (${alerts.length}):\n${lines.join('\n')}\n\n`
}
