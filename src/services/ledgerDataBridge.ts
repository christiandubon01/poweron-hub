// @ts-nocheck
/**
 * LEDGER Data Bridge — Reads real financial data from the backup state.
 *
 * The backup state (localStorage 'poweron_backup_data') holds the ground truth
 * for serviceLogs, projects, and weeklyData. This bridge exposes aggregated
 * financial metrics that the LEDGER agent can use for Claude-powered analysis.
 *
 * Publishes events to the agentEventBus when significant financial conditions
 * are detected (AR overdue, payments received, etc.).
 *
 * ── Data sources ─────────────────────────────────────────────────────────────
 * - serviceLogs[].collected / .quoted / .balanceDue / .payStatus
 * - projects[].contract / .billed / .paid / .status
 * - weeklyData[].proj / .svc / .unbilled / .pendingInv
 * - serviceLogs[].adjustments[] for income/expense line items
 */

import { getBackupData, type BackupData, type BackupServiceLog, type BackupProject } from './backupDataService'
import { publish } from './agentEventBus'

// ── Types ────────────────────────────────────────────────────────────────────

export interface MonthlyCollection {
  month:     string   // 'YYYY-MM'
  collected: number
  quoted:    number
  balance:   number
  count:     number
}

export interface OutstandingAR {
  totalAR:         number
  overdueAmount:   number
  currentAmount:   number
  projectAR:       number
  serviceAR:       number
  items:           ARLineItem[]
}

export interface ARLineItem {
  id:         string
  type:       'project' | 'service'
  name:       string
  quoted:     number
  collected:  number
  balance:    number
  date?:      string
  daysOut:    number
}

export interface CollectionRate {
  overall:   number   // 0-1, percentage of quoted that was collected
  last30:    number
  last60:    number
  last90:    number
  trend:     'improving' | 'stable' | 'declining'
}

export interface LedgerSummary {
  monthlyCollections: MonthlyCollection[]
  outstandingAR:      OutstandingAR
  collectionRate:     CollectionRate
  totalRevenue:       number
  totalCollected:     number
  generatedAt:        number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function daysSince(dateStr: string | undefined): number {
  if (!dateStr) return 0
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)))
}

function monthKey(dateStr: string | undefined): string {
  if (!dateStr) return 'unknown'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'unknown'
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Monthly Collections ──────────────────────────────────────────────────────

/**
 * Get monthly collection totals from service logs.
 * Groups by month, sums collected/quoted/balance.
 */
export function getMonthlyCollections(months = 12): MonthlyCollection[] {
  const backup = getBackupData()
  if (!backup) return []

  const logs = Array.isArray(backup.serviceLogs) ? backup.serviceLogs : []
  const buckets = new Map<string, MonthlyCollection>()

  for (const log of logs) {
    const mk = monthKey(log.date)
    if (mk === 'unknown') continue

    if (!buckets.has(mk)) {
      buckets.set(mk, { month: mk, collected: 0, quoted: 0, balance: 0, count: 0 })
    }

    const b = buckets.get(mk)!
    const quoted = num(log.quoted)
    const collected = num(log.collected)
    b.quoted += quoted
    b.collected += collected
    b.balance += Math.max(0, quoted - collected)
    b.count++
  }

  // Sort descending by month, take latest N
  return Array.from(buckets.values())
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, months)
}

// ── Outstanding AR ───────────────────────────────────────────────────────────

/**
 * Calculate outstanding AR from both service logs and projects.
 * Service AR: quoted - collected where balance > 0
 * Project AR: billed - paid where balance > 0
 */
export function getOutstandingAR(): OutstandingAR {
  const backup = getBackupData()
  if (!backup) {
    return { totalAR: 0, overdueAmount: 0, currentAmount: 0, projectAR: 0, serviceAR: 0, items: [] }
  }

  const items: ARLineItem[] = []
  let serviceAR = 0
  let projectAR = 0
  let overdueAmount = 0
  let currentAmount = 0

  // Service log AR
  const logs = Array.isArray(backup.serviceLogs) ? backup.serviceLogs : []
  for (const log of logs) {
    const quoted = num(log.quoted)
    const collected = num(log.collected)
    const balance = Math.max(0, quoted - collected)

    if (balance > 0) {
      const days = daysSince(log.date)
      serviceAR += balance

      if (days > 30) {
        overdueAmount += balance
      } else {
        currentAmount += balance
      }

      items.push({
        id:        log.id || `svc_${log.date}_${log.customer}`,
        type:      'service',
        name:      log.customer || 'Service Call',
        quoted,
        collected,
        balance,
        date:      log.date,
        daysOut:   days,
      })
    }
  }

  // Project AR
  const projects = Array.isArray(backup.projects) ? backup.projects : []
  for (const proj of projects) {
    const billed = num(proj.billed)
    const paid = num(proj.paid)
    const balance = Math.max(0, billed - paid)

    if (balance > 0 && billed > 0) {
      const days = daysSince(proj.lastMove)
      projectAR += balance

      if (days > 30) {
        overdueAmount += balance
      } else {
        currentAmount += balance
      }

      items.push({
        id:        proj.id || `proj_${proj.name}`,
        type:      'project',
        name:      proj.name || 'Unnamed Project',
        quoted:    billed,
        collected: paid,
        balance,
        date:      proj.lastMove,
        daysOut:   days,
      })
    }
  }

  // Sort by balance descending
  items.sort((a, b) => b.balance - a.balance)

  const totalAR = serviceAR + projectAR

  return { totalAR, overdueAmount, currentAmount, projectAR, serviceAR, items }
}

// ── Collection Rate ──────────────────────────────────────────────────────────

/**
 * Calculate collection rate (collected / quoted) over different periods.
 */
export function getCollectionRate(): CollectionRate {
  const backup = getBackupData()
  if (!backup) {
    return { overall: 0, last30: 0, last60: 0, last90: 0, trend: 'stable' }
  }

  const logs = Array.isArray(backup.serviceLogs) ? backup.serviceLogs : []
  const now = Date.now()

  let totalQuoted = 0, totalCollected = 0
  let q30 = 0, c30 = 0
  let q60 = 0, c60 = 0
  let q90 = 0, c90 = 0

  for (const log of logs) {
    const quoted = num(log.quoted)
    const collected = num(log.collected)
    if (quoted <= 0) continue

    totalQuoted += quoted
    totalCollected += collected

    const days = daysSince(log.date)
    if (days <= 30) { q30 += quoted; c30 += collected }
    if (days <= 60) { q60 += quoted; c60 += collected }
    if (days <= 90) { q90 += quoted; c90 += collected }
  }

  const overall = totalQuoted > 0 ? totalCollected / totalQuoted : 0
  const last30 = q30 > 0 ? c30 / q30 : 0
  const last60 = q60 > 0 ? c60 / q60 : 0
  const last90 = q90 > 0 ? c90 / q90 : 0

  // Determine trend
  let trend: 'improving' | 'stable' | 'declining' = 'stable'
  if (last30 > last90 + 0.05) trend = 'improving'
  else if (last30 < last90 - 0.05) trend = 'declining'

  return { overall, last30, last60, last90, trend }
}

// ── Full Summary ─────────────────────────────────────────────────────────────

/**
 * Get a complete LEDGER summary from local state.
 * This is the primary data source for the LEDGER agent's Claude context.
 */
export function getLedgerSummary(): LedgerSummary {
  const monthlyCollections = getMonthlyCollections(6)
  const outstandingAR = getOutstandingAR()
  const collectionRate = getCollectionRate()

  // Total revenue from all service logs
  const backup = getBackupData()
  const logs = Array.isArray(backup?.serviceLogs) ? backup!.serviceLogs : []
  const totalRevenue = logs.reduce((sum, l) => sum + num(l.quoted), 0)
  const totalCollected = logs.reduce((sum, l) => sum + num(l.collected), 0)

  return {
    monthlyCollections,
    outstandingAR,
    collectionRate,
    totalRevenue,
    totalCollected,
    generatedAt: Date.now(),
  }
}

// ── Event Publishers ─────────────────────────────────────────────────────────

/**
 * Scan for overdue AR and publish AR_OVERDUE events.
 * Call periodically (e.g., on app mount or every 30 minutes).
 */
export function checkAndPublishOverdueAR(): void {
  const ar = getOutstandingAR()

  if (ar.overdueAmount > 0) {
    const topItems = ar.items
      .filter(i => i.daysOut > 30)
      .slice(0, 3)
      .map(i => `${i.name} ($${i.balance.toLocaleString()}, ${i.daysOut}d)`)
      .join(', ')

    publish(
      'AR_OVERDUE',
      'ledger',
      {
        totalOverdue: ar.overdueAmount,
        overdueCount: ar.items.filter(i => i.daysOut > 30).length,
        topItems: ar.items.filter(i => i.daysOut > 30).slice(0, 5),
      },
      `$${ar.overdueAmount.toLocaleString()} overdue across ${ar.items.filter(i => i.daysOut > 30).length} items. Top: ${topItems}`
    )
  }
}

/**
 * Publish a PAYMENT_RECEIVED event when a payment is recorded.
 * Call this from UI or service code after recording a payment.
 */
export function publishPaymentReceived(
  customerName: string,
  amount: number,
  projectOrServiceId: string,
  type: 'project' | 'service'
): void {
  publish(
    'PAYMENT_RECEIVED',
    'ledger',
    {
      customerName,
      amount,
      entityId: projectOrServiceId,
      entityType: type,
    },
    `Payment received: $${amount.toLocaleString()} from ${customerName} (${type})`
  )
}

/**
 * Get a formatted context string of LEDGER data for injection into agent prompts.
 * Used by the NEXUS router when routing to LEDGER.
 */
export function getLedgerContext(): string {
  const summary = getLedgerSummary()
  const lines: string[] = []

  lines.push('## LEDGER — Live Financial Data (from local state)')
  lines.push('')

  // AR overview
  const ar = summary.outstandingAR
  lines.push(`**Outstanding AR:** $${ar.totalAR.toLocaleString()} (Service: $${ar.serviceAR.toLocaleString()}, Project: $${ar.projectAR.toLocaleString()})`)
  lines.push(`**Overdue:** $${ar.overdueAmount.toLocaleString()} | **Current:** $${ar.currentAmount.toLocaleString()}`)
  lines.push('')

  // Collection rate
  const cr = summary.collectionRate
  lines.push(`**Collection Rate:** Overall ${(cr.overall * 100).toFixed(1)}% | 30d ${(cr.last30 * 100).toFixed(1)}% | 60d ${(cr.last60 * 100).toFixed(1)}% | 90d ${(cr.last90 * 100).toFixed(1)}% | Trend: ${cr.trend}`)
  lines.push('')

  // Monthly collections (last 3)
  if (summary.monthlyCollections.length > 0) {
    lines.push('**Monthly Collections:**')
    for (const mc of summary.monthlyCollections.slice(0, 3)) {
      lines.push(`- ${mc.month}: $${mc.collected.toLocaleString()} collected / $${mc.quoted.toLocaleString()} quoted (${mc.count} jobs)`)
    }
    lines.push('')
  }

  // Top AR items
  if (ar.items.length > 0) {
    lines.push('**Top Outstanding:**')
    for (const item of ar.items.slice(0, 5)) {
      lines.push(`- ${item.name} (${item.type}): $${item.balance.toLocaleString()} — ${item.daysOut}d outstanding`)
    }
  }

  // Revenue summary
  lines.push('')
  lines.push(`**Total Revenue:** $${summary.totalRevenue.toLocaleString()} | **Collected:** $${summary.totalCollected.toLocaleString()}`)

  return lines.join('\n')
}
