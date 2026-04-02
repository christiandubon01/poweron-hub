// @ts-nocheck
/**
 * revenueTimelineService.ts — Revenue Timeline Intelligence Engine
 *
 * PURE FUNCTIONS ONLY — zero React hooks, no side effects, no Supabase calls.
 * All functions accept data as arguments and return computed results.
 * Data fetching lives in revenueTimelineQueries.ts.
 *
 * Implements the Revenue Timeline Dashboard spec:
 *  - Phase payment schedule engine
 *  - 8-week projected vs actual cash flow
 *  - 6-month revenue comparison
 *  - Project overlap window detection
 *  - Quote vs actual variance per project
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PhaseTimelineEntry {
  phase_name: string
  confirmed_start_date: string | null        // 'YYYY-MM-DD' or null
  estimated_duration_days: number | null
  actual_start_date: string | null
  actual_end_date: string | null
  quoted_labor_hours: number | null
  quoted_material_cost: number | null
  payment_trigger_pct: number               // % of contract due at phase completion
}

export interface PaymentEvent {
  phase: string
  date: Date | null
  estimated: boolean
  amount: number
  type: 'deposit' | 'phase_payment' | 'final'
}

export interface WeekBucket {
  weekLabel: string
  weekStart: Date
  projected: number
  actual: number
}

export interface MonthBucket {
  month: string
  projected: number
  actual: number
}

export interface OverlapWindow {
  closingProject: string
  openingProject: string
  overlapStart: Date
  overlapEnd: Date
  finalPaymentAmount: number
  depositAmount: number
}

export interface PhaseVariance {
  phase: string
  quotedHours: number
  actualHours: number
  laborVariance: number      // actual - quoted (positive = over)
  quotedMaterials: number
  actualMaterials: number
  materialVariance: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function n(v: any): number {
  const x = parseFloat(v)
  return isNaN(x) ? 0 : x
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000)
}

function startOfWeek(d: Date): Date {
  const day = d.getDay()               // 0=Sun
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Mon
  const m = new Date(d)
  m.setDate(diff)
  m.setHours(0, 0, 0, 0)
  return m
}

function weekLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function monthKey(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function datesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

/**
 * Get historical average phase duration from completed projects.
 * Returns a map of phase_name → average days, or empty map if not enough data.
 */
function getHistoricalAverageDurations(allProjects: any[]): Record<string, number> {
  const byPhase: Record<string, number[]> = {}
  for (const p of allProjects) {
    const timeline: PhaseTimelineEntry[] = p.phase_timeline || []
    for (const entry of timeline) {
      if (!entry.actual_start_date || !entry.actual_end_date) continue
      const s = parseDate(entry.actual_start_date)
      const e = parseDate(entry.actual_end_date)
      if (!s || !e || e <= s) continue
      const days = Math.round((e.getTime() - s.getTime()) / 86400000)
      if (days < 1 || days > 365) continue
      if (!byPhase[entry.phase_name]) byPhase[entry.phase_name] = []
      byPhase[entry.phase_name].push(days)
    }
  }
  const averages: Record<string, number> = {}
  for (const [phase, vals] of Object.entries(byPhase)) {
    averages[phase] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
  }
  return averages
}

/**
 * Estimate the end date of a phase given its start date and duration.
 * Falls back to historical averages, then to a 14-day default.
 */
function estimatePhaseEnd(
  startDate: Date,
  entry: PhaseTimelineEntry,
  historicalAvgs: Record<string, number>
): Date {
  const days =
    entry.estimated_duration_days ||
    historicalAvgs[entry.phase_name] ||
    14
  return addDays(startDate, days)
}

// ── Core: getPhasePaymentSchedule ────────────────────────────────────────────

/**
 * Returns all payment events for a single project in chronological order.
 * Logic:
 *  - Deposit: contract × deposit_pct%, on confirmed start of Phase 1 (or today)
 *  - Each phase: contract × phase payment_trigger_pct%, date = confirmed start
 *    of NEXT phase (payment on phase complete = start of next phase)
 *  - Final: remaining balance, on actual_end_date of last phase or estimated end
 *  - estimated: true if any date in the chain was estimated
 */
export function getPhasePaymentSchedule(
  project: any,
  allProjects: any[]
): PaymentEvent[] {
  const contract = n(project.contract)
  if (contract === 0) return []

  const depositPct = n(project.deposit_pct ?? 10) / 100
  const timeline: PhaseTimelineEntry[] = project.phase_timeline || []
  const historicalAvgs = getHistoricalAverageDurations(allProjects)

  const events: PaymentEvent[] = []

  // Build estimated start/end dates per phase in order
  const phaseWindows: Array<{
    entry: PhaseTimelineEntry
    startDate: Date | null
    endDate: Date | null
    estimated: boolean
  }> = []

  let prevEnd: Date | null = null
  let anyEstimated = false

  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i]
    let startDate: Date | null = null
    let estimated = false

    if (entry.confirmed_start_date) {
      startDate = parseDate(entry.confirmed_start_date)
    } else if (entry.actual_start_date) {
      startDate = parseDate(entry.actual_start_date)
    } else if (prevEnd) {
      startDate = prevEnd
      estimated = true
      anyEstimated = true
    } else if (i === 0) {
      // First phase with no date: use today
      startDate = new Date()
      startDate.setHours(0, 0, 0, 0)
      estimated = true
      anyEstimated = true
    }

    let endDate: Date | null = null
    if (entry.actual_end_date) {
      endDate = parseDate(entry.actual_end_date)
    } else if (startDate) {
      endDate = estimatePhaseEnd(startDate, entry, historicalAvgs)
      estimated = true
      anyEstimated = true
    }

    phaseWindows.push({ entry, startDate, endDate, estimated })
    prevEnd = endDate
  }

  // ── Deposit event ──
  const phase1Start = phaseWindows[0]?.startDate || null
  events.push({
    phase: 'Deposit',
    date: phase1Start,
    estimated: phaseWindows[0]?.estimated || false,
    amount: Math.round(contract * depositPct),
    type: 'deposit',
  })

  // ── Phase payment events ──
  // Payment triggers at phase COMPLETION = start of NEXT phase
  let totalTriggerPct = 0
  for (let i = 0; i < phaseWindows.length; i++) {
    const pw = phaseWindows[i]
    const trigPct = n(pw.entry.payment_trigger_pct) / 100
    if (trigPct === 0) continue

    // Date = start of NEXT phase (or end of this phase if last)
    let payDate: Date | null = null
    let payEstimated = pw.estimated

    if (i + 1 < phaseWindows.length && phaseWindows[i + 1].startDate) {
      payDate = phaseWindows[i + 1].startDate
      payEstimated = pw.estimated || phaseWindows[i + 1].estimated
    } else {
      // Last phase or no next phase: use endDate
      payDate = pw.endDate
      payEstimated = true
    }

    totalTriggerPct += trigPct
    events.push({
      phase: pw.entry.phase_name,
      date: payDate,
      estimated: payEstimated,
      amount: Math.round(contract * trigPct),
      type: 'phase_payment',
    })
  }

  // ── Final payment event ──
  const lastPhase = phaseWindows[phaseWindows.length - 1]
  const finalPaid = events.reduce((s, e) => s + e.amount, 0)
  const finalBalance = Math.max(0, contract - finalPaid)

  if (finalBalance > 0) {
    let finalDate: Date | null = null
    let finalEstimated = true

    if (lastPhase) {
      if (lastPhase.entry.actual_end_date) {
        finalDate = parseDate(lastPhase.entry.actual_end_date)
        finalEstimated = false
      } else if (lastPhase.endDate) {
        finalDate = lastPhase.endDate
        finalEstimated = true
      }
    }

    events.push({
      phase: 'Final Payment',
      date: finalDate,
      estimated: finalEstimated,
      amount: finalBalance,
      type: 'final',
    })
  }

  // Sort by date (nulls last)
  events.sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return a.date.getTime() - b.date.getTime()
  })

  return events
}

// ── get8WeekCashFlow ─────────────────────────────────────────────────────────

/**
 * Returns 8 weekly buckets starting from the current week (Monday).
 * Projected: sum of payment events in each week across all active projects.
 * Actual: sum of payments already received (from project paid logs) in each week.
 */
export function get8WeekCashFlow(
  allProjects: any[],
  logs: any[]                // backup.logs — field log entries with paymentsCollected
): WeekBucket[] {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const weekStart = startOfWeek(now)

  const buckets: WeekBucket[] = []
  for (let w = 0; w < 8; w++) {
    const ws = addDays(weekStart, w * 7)
    const we = addDays(ws, 6)
    buckets.push({
      weekLabel: weekLabel(ws),
      weekStart: ws,
      projected: 0,
      actual: 0,
    })
  }

  const activeProjects = allProjects.filter(p => p.status === 'active')

  // Projected: from payment schedule
  for (const project of activeProjects) {
    const schedule = getPhasePaymentSchedule(project, allProjects)
    for (const event of schedule) {
      if (!event.date) continue
      for (const bucket of buckets) {
        const we = addDays(bucket.weekStart, 6)
        if (event.date >= bucket.weekStart && event.date <= we) {
          bucket.projected += event.amount
          break
        }
      }
    }
  }

  // Actual: from field log paymentsCollected entries in each week
  for (const log of logs) {
    const logDate = parseDate(log.date || log.logDate)
    if (!logDate) continue
    const collected = n(log.paymentsCollected || log.collected)
    if (collected === 0) continue
    for (const bucket of buckets) {
      const we = addDays(bucket.weekStart, 6)
      if (logDate >= bucket.weekStart && logDate <= we) {
        bucket.actual += collected
        break
      }
    }
  }

  return buckets
}

// ── getMonthlyRevenueComparison ───────────────────────────────────────────────

/**
 * Returns N months of projected vs actual revenue.
 * Projected: payment events falling in each month.
 * Actual: payments collected (from project.paid increments via logs).
 */
export function getMonthlyRevenueComparison(
  allProjects: any[],
  logs: any[],
  months: number = 6
): MonthBucket[] {
  const now = new Date()
  const buckets: MonthBucket[] = []

  for (let m = 0; m < months; m++) {
    const d = new Date(now.getFullYear(), now.getMonth() + m, 1)
    buckets.push({
      month: monthKey(d),
      projected: 0,
      actual: 0,
    })
  }

  const activeProjects = allProjects.filter(p => p.status === 'active')

  // Projected
  for (const project of activeProjects) {
    const schedule = getPhasePaymentSchedule(project, allProjects)
    for (const event of schedule) {
      if (!event.date) continue
      for (let i = 0; i < months; i++) {
        const bucketYear = now.getFullYear()
        const bucketMonth = now.getMonth() + i
        if (
          event.date.getFullYear() === new Date(bucketYear, bucketMonth, 1).getFullYear() &&
          event.date.getMonth() === new Date(bucketYear, bucketMonth, 1).getMonth()
        ) {
          buckets[i].projected += event.amount
          break
        }
      }
    }
  }

  // Actual: from logs
  for (const log of logs) {
    const logDate = parseDate(log.date || log.logDate)
    if (!logDate) continue
    const collected = n(log.paymentsCollected || log.collected)
    if (collected === 0) continue
    for (let i = 0; i < months; i++) {
      const bucketYear = now.getFullYear()
      const bucketMonth = now.getMonth() + i
      if (
        logDate.getFullYear() === new Date(bucketYear, bucketMonth, 1).getFullYear() &&
        logDate.getMonth() === new Date(bucketYear, bucketMonth, 1).getMonth()
      ) {
        buckets[i].actual += collected
        break
      }
    }
  }

  return buckets
}

// ── getOverlapWindows ────────────────────────────────────────────────────────

/**
 * Returns overlap windows where a project's final 2 weeks overlap with
 * another project's first 2 weeks.
 * These are key cash-concentration periods: closing payment + opening deposit.
 */
export function getOverlapWindows(allProjects: any[]): OverlapWindow[] {
  const activeProjects = allProjects.filter(p => p.status === 'active' || p.status === 'coming')
  const windows: OverlapWindow[] = []

  // Build project window boundaries
  const projectWindows = activeProjects.map(p => {
    const schedule = getPhasePaymentSchedule(p, allProjects)
    const deposit = schedule.find(e => e.type === 'deposit')
    const finalPay = schedule.find(e => e.type === 'final')

    const startDate = deposit?.date || null
    const endDate = finalPay?.date || null

    return {
      project: p,
      name: p.name || 'Unknown',
      startDate,
      endDate,
      depositAmount: deposit?.amount || 0,
      finalPayAmount: finalPay?.amount || 0,
    }
  })

  for (let i = 0; i < projectWindows.length; i++) {
    for (let j = 0; j < projectWindows.length; j++) {
      if (i === j) continue
      const closing = projectWindows[i]
      const opening = projectWindows[j]

      if (!closing.endDate || !opening.startDate) continue

      // Closing project's final 2 weeks
      const closingFinalStart = addDays(closing.endDate, -14)
      const closingFinalEnd = closing.endDate

      // Opening project's first 2 weeks
      const openingFirstStart = opening.startDate
      const openingFirstEnd = addDays(opening.startDate, 14)

      if (datesOverlap(closingFinalStart, closingFinalEnd, openingFirstStart, openingFirstEnd)) {
        // Calculate the actual overlap span
        const overlapStart = closingFinalStart > openingFirstStart ? closingFinalStart : openingFirstStart
        const overlapEnd = closingFinalEnd < openingFirstEnd ? closingFinalEnd : openingFirstEnd

        windows.push({
          closingProject: closing.name,
          openingProject: opening.name,
          overlapStart,
          overlapEnd,
          finalPaymentAmount: closing.finalPayAmount,
          depositAmount: opening.depositAmount,
        })
      }
    }
  }

  return windows
}

// ── getQuoteVsActual ─────────────────────────────────────────────────────────

/**
 * Returns per-phase variance for a project: quoted vs actual hours & materials.
 * Actual hours pulled from field_log_entries grouped by project + phase label.
 */
export function getQuoteVsActual(
  project: any,
  logs: any[]                  // backup.logs
): PhaseVariance[] {
  const timeline: PhaseTimelineEntry[] = project.phase_timeline || []
  if (!timeline.length) return []

  // Group log entries by phase for this project
  const projectLogs = logs.filter(l =>
    (l.projId === project.id || l.projectId === project.id) &&
    (l.hrs > 0 || l.mat > 0 || l.materials > 0)
  )

  const variances: PhaseVariance[] = []

  for (const entry of timeline) {
    // Match logs to this phase by phase label (log.phase field)
    const phaseLogs = projectLogs.filter(l => {
      const logPhase = (l.phase || l.phaseLabel || '').toLowerCase().trim()
      const entryPhase = entry.phase_name.toLowerCase().trim()
      return logPhase === entryPhase || logPhase.includes(entryPhase) || entryPhase.includes(logPhase)
    })

    const actualHours = phaseLogs.reduce((s, l) => s + n(l.hrs || 0), 0)
    const actualMaterials = phaseLogs.reduce((s, l) => s + n(l.mat || l.materials || 0), 0)

    const quotedHours = n(entry.quoted_labor_hours)
    const quotedMaterials = n(entry.quoted_material_cost)

    // Only include phases with at least some quoted or actual data
    if (quotedHours === 0 && quotedMaterials === 0 && actualHours === 0 && actualMaterials === 0) {
      continue
    }

    variances.push({
      phase: entry.phase_name,
      quotedHours,
      actualHours,
      laborVariance: actualHours - quotedHours,
      quotedMaterials,
      actualMaterials,
      materialVariance: actualMaterials - quotedMaterials,
    })
  }

  return variances
}

// ── getProjectGanttData ──────────────────────────────────────────────────────

export interface GanttPhaseSegment {
  phaseName: string
  startDate: Date | null
  endDate: Date | null
  estimated: boolean
  paymentAmount: number
  paymentDate: Date | null
  color: string
}

export interface GanttProjectRow {
  projectId: string
  projectName: string
  segments: GanttPhaseSegment[]
  overlapZones: Array<{ start: Date; end: Date }>
}

const PHASE_COLORS: Record<string, string> = {
  Planning: '#06b6d4',
  Estimating: '#3b82f6',
  'Site Prep': '#f59e0b',
  'Rough-in': '#10b981',
  Finish: '#a855f7',
  Trim: '#ef4444',
}

function phaseColor(name: string): string {
  return PHASE_COLORS[name] || '#6b7280'
}

/**
 * Builds Gantt data for all active/coming projects.
 * Returns one row per project with phase segments and payment markers.
 */
export function getProjectGanttData(
  allProjects: any[],
  overlapWindows: OverlapWindow[]
): GanttProjectRow[] {
  const projects = allProjects.filter(p => p.status === 'active' || p.status === 'coming')

  return projects.map(p => {
    const timeline: PhaseTimelineEntry[] = p.phase_timeline || []
    const schedule = getPhasePaymentSchedule(p, allProjects)
    const historicalAvgs = getHistoricalAverageDurations(allProjects)

    let prevEnd: Date | null = null
    const segments: GanttPhaseSegment[] = timeline.map(entry => {
      let startDate: Date | null = parseDate(entry.confirmed_start_date) || parseDate(entry.actual_start_date)
      let estimated = !entry.confirmed_start_date && !entry.actual_start_date

      if (!startDate && prevEnd) {
        startDate = prevEnd
        estimated = true
      }

      let endDate: Date | null = parseDate(entry.actual_end_date)
      if (!endDate && startDate) {
        endDate = estimatePhaseEnd(startDate, entry, historicalAvgs)
        estimated = true
      }

      prevEnd = endDate

      // Find matching payment for this phase
      const payEvent = schedule.find(e => e.phase === entry.phase_name)

      return {
        phaseName: entry.phase_name,
        startDate,
        endDate,
        estimated,
        paymentAmount: payEvent?.amount || 0,
        paymentDate: payEvent?.date || null,
        color: phaseColor(entry.phase_name),
      }
    })

    // Overlap zones affecting this project
    const overlapZones = overlapWindows
      .filter(o => o.closingProject === p.name || o.openingProject === p.name)
      .map(o => ({ start: o.overlapStart, end: o.overlapEnd }))

    return {
      projectId: p.id,
      projectName: p.name || 'Unknown',
      segments,
      overlapZones,
    }
  })
}
