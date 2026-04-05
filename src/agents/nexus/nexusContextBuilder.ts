// @ts-nocheck
/**
 * nexusContextBuilder.ts — Deep context builder for NEXUS
 *
 * Builds rich, prose-formatted operational context from the local app state
 * (getBackupData). This context is injected into every NEXUS prompt so Claude
 * can produce specific, named, data-driven responses rather than generic
 * KPI summaries.
 *
 * FORMAT GOAL (per spec):
 * "Beauty Salon is a Commercial TI at 52% health. Rough-in phase is active but
 *  no field log has been added in 8 days. 3 of 42 labor tasks have hours logged
 *  (24hrs total of 52hrs quoted). The RTU disconnect RFI has been open 30 days
 *  directed to GC/Engineer. 28 of 38 MTO items have no unit cost. Contract is
 *  $18,000, $0 collected, full balance outstanding."
 *
 * SESSION SCOPE: NEXUS context files only. Do not import from routing, auth,
 * classifier, or any file on the out-of-scope list.
 */

import { getBackupData } from '@/services/backupDataService'

// ── Small helpers ─────────────────────────────────────────────────────────────

function num(v: any): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function fmt(v: number): string {
  if (v === 0) return '$0'
  return '$' + Math.round(v).toLocaleString('en-US')
}

function fmtHrs(v: number): string {
  return v % 1 === 0 ? `${v}h` : `${v.toFixed(1)}h`
}

/**
 * Days since a date string (YYYY-MM-DD or ISO). Returns 999 if missing/invalid.
 */
function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 999
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return 999
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
  } catch {
    return 999
  }
}

/** Normalize priceBook to array regardless of whether it's stored as array or object */
function getPBArray(data: any): any[] {
  const pb = data?.priceBook
  if (!pb) return []
  return Array.isArray(pb) ? pb : Object.values(pb)
}

// ── Phase completion helpers ──────────────────────────────────────────────────

const PHASE_ORDER = ['Planning', 'Estimating', 'Site Prep', 'Rough-in', 'Trim', 'Finish']

const DEFAULT_PHASE_WEIGHTS: Record<string, number> = {
  Planning: 5,
  Estimating: 5,
  'Site Prep': 10,
  'Rough-in': 30,
  Trim: 25,
  Finish: 25,
}

/**
 * Weighted overall completion % following the spec's ov(p) logic.
 */
function overallCompletion(phases: Record<string, number>, phaseWeights: Record<string, number>): number {
  const weights = (phaseWeights && Object.keys(phaseWeights).length) ? phaseWeights : DEFAULT_PHASE_WEIGHTS
  let numerator = 0
  let denominator = 0
  for (const [phase, pct] of Object.entries(phases || {})) {
    const w = num(weights[phase] ?? DEFAULT_PHASE_WEIGHTS[phase] ?? 0)
    numerator   += num(pct) * w
    denominator += w
  }
  return denominator > 0 ? Math.round(numerator / denominator) : 0
}

/**
 * Resolve the "active" phase — highest-progress phase that has started but
 * is not fully complete. Falls back to highest % phase.
 */
function resolveActivePhase(phases: Record<string, number>): { name: string; pct: number } {
  if (!phases) return { name: 'Unknown', pct: 0 }

  // Prefer the last phase in order that has started but not finished
  let best: { name: string; pct: number } | null = null
  for (const phase of PHASE_ORDER) {
    const pct = num(phases[phase])
    if (pct > 0 && pct < 100) best = { name: phase, pct }
  }
  if (best) return best

  // Fall back: highest % among all phases
  let max = { name: 'Unknown', pct: 0 }
  for (const [name, pct] of Object.entries(phases)) {
    if (num(pct) > max.pct) max = { name, pct: num(pct) }
  }
  return max
}

// ── Health score (spec formula) ───────────────────────────────────────────────

/**
 * Compute health score per poweron_app_handoff_spec.md Section 9:
 * starts at 100, deductions for staleness, open RFIs, exposure, low completion.
 */
function computeHealthScore(
  p: any,
  completionPct: number,
  daysSinceMove: number
): number {
  let score = 100
  if (daysSinceMove > 14) score -= 20
  const openRFIs = (p.rfis || []).filter((r: any) => r.status !== 'answered')
  if (openRFIs.length > 0) score -= 15
  const contract = num(p.finance?.contractOverride || p.contract)
  // Exposure approximated from logged labor cost — may be 0 if not tracked
  const exposure = num(p.actual_cost || 0)
  if (contract > 0 && exposure > contract * 0.5) score -= 10
  if (completionPct < 10 && p.status === 'active') score -= 10
  return Math.max(0, score)
}

// ── Finance bucket (spec formula) ────────────────────────────────────────────

function getFinancials(p: any): {
  contract: number; billed: number; paid: number; outstanding: number
} {
  const contract    = num(p.finance?.contractOverride) || num(p.contract)
  const billed      = num(p.finance?.billedOverride)   || num(p.billed)
  const paid        = num(p.paid) + num(p.finance?.manualPaidAdjustment)
  const outstanding = contract - paid
  return { contract, billed, paid, outstanding }
}

// ── Main exported builder ─────────────────────────────────────────────────────

/**
 * Build a deep, prose-formatted operational context block from local app state.
 *
 * Returns an empty string if no local backup data is available so the caller
 * can fall back to Supabase queries.
 *
 * Output is NOT a JSON dump — it is a readable prose block that Claude can use
 * to produce specific, named, data-driven responses using actual project names,
 * actual numbers, and actual task names embedded naturally.
 */
export function buildDeepProjectContext(): string {
  const data = getBackupData()
  if (!data) return ''

  const timestamp = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  const phaseWeights = data.settings?.phaseWeights || {}
  const billRate     = num(data.settings?.billRate) || 95
  const wasteDefault = num(data.settings?.wasteDefault) || 0
  const pbItems      = getPBArray(data)

  // ── Filter to active projects only (resolveProjectBucket spec) ─────────────
  const activeProjects = (data.projects || []).filter((p: any) => p.status === 'active')

  const sections: string[] = [
    `## Power On Hub — Live Operational Context (as of ${timestamp})`,
  ]

  // ── PER-PROJECT DEEP CONTEXT ───────────────────────────────────────────────
  if (!activeProjects.length) {
    sections.push('\nNo active projects found in local state.')
  }

  for (const p of activeProjects.slice(0, 8)) {
    const fin         = getFinancials(p)
    const completion  = overallCompletion(p.phases, phaseWeights)
    const activePhase = resolveActivePhase(p.phases)

    // ── Staleness ───────────────────────────────────────────────────────────
    const daysStale = daysSince(p.lastMove)
    const staleLabel = daysStale >= 999 ? 'no progress date recorded'
      : daysStale === 0 ? 'updated today'
      : `no movement in ${daysStale} days`

    // ── Field log recency ───────────────────────────────────────────────────
    const projectLogs = (data.logs || []).filter((l: any) => l.projId === p.id)
    const sortedLogs  = [...projectLogs].sort((a: any, b: any) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    const lastLogDate = sortedLogs[0]?.date ?? null
    const daysNoLog   = daysSince(lastLogDate)
    const logLabel    = lastLogDate
      ? (daysNoLog === 0 ? 'field log updated today' : `no field log in ${daysNoLog} days`)
      : 'no field log entries ever'

    // ── Labor: quoted vs logged ─────────────────────────────────────────────
    const laborRows   = p.laborRows || []
    const quotedHrs   = laborRows.reduce((s: number, r: any) => s + num(r.hrs), 0)
    const loggedHrs   = projectLogs.reduce((s: number, l: any) => s + num(l.hrs), 0)

    // ── Open RFIs with age ──────────────────────────────────────────────────
    const openRFIs    = (p.rfis || []).filter((r: any) => r.status !== 'answered')
    const oldestRFI   = openRFIs.reduce((max: number, r: any) => {
      const age = daysSince(r.submitted)
      return age < 999 ? Math.max(max, age) : max
    }, 0)

    // ── MTO analysis ────────────────────────────────────────────────────────
    const mtoRows     = p.mtoRows || []
    const mtoTotal    = mtoRows.length

    let matCostKnown  = 0
    let mtoWithCost   = 0
    const mtoNoCostItems: string[] = []
    const mtoFlaggedItems: string[] = []

    for (const r of mtoRows) {
      const pbItem = r.matId ? pbItems.find((x: any) => x.id === r.matId) : null
      const hasCost = pbItem && num(pbItem.cost) > 0
      if (hasCost) {
        mtoWithCost++
        matCostKnown += num(r.qty) * num(pbItem.cost) * (1 + wasteDefault / 100)
      } else {
        mtoNoCostItems.push(r.name || 'Unnamed item')
      }
      const note = (r.note || r.detailNote || r.supplierNote || '').toLowerCase()
      if (note.includes('verify') || note.includes('research') || note.includes('check') || note.includes('tbd') || note.includes('confirm')) {
        mtoFlaggedItems.push(r.name || 'Unnamed item')
      }
    }
    const mtoNoCost = mtoTotal - mtoWithCost

    // ── Health score ────────────────────────────────────────────────────────
    const healthScore = computeHealthScore(p, completion, daysStale)
    const healthLabel = healthScore >= 80 ? 'healthy' : healthScore >= 60 ? 'at-risk' : 'critical'

    // ── Finance summary ─────────────────────────────────────────────────────
    let financeStr: string
    if (fin.contract > 0) {
      if (fin.paid === 0) {
        financeStr = `Contract is ${fmt(fin.contract)}, ${fmt(fin.outstanding)} outstanding (no payment collected).`
      } else if (fin.outstanding <= 0) {
        financeStr = `Contract is ${fmt(fin.contract)}, paid in full.`
      } else {
        financeStr = `Contract is ${fmt(fin.contract)}, ${fmt(fin.paid)} collected, ${fmt(fin.outstanding)} outstanding.`
      }
    } else {
      financeStr = 'No contract amount on file.'
    }

    // ── PROJECT SUMMARY PARAGRAPH ───────────────────────────────────────────
    let para = `\n${p.name} is a ${p.type || 'project'} at ${healthScore}% health (${healthLabel}). `
    para += `${activePhase.name} phase is active at ${activePhase.pct}% complete (${completion}% overall). `
    para += `${staleLabel.charAt(0).toUpperCase() + staleLabel.slice(1)}; ${logLabel}. `

    if (quotedHrs > 0) {
      para += `Labor: ${fmtHrs(loggedHrs)} logged of ${fmtHrs(quotedHrs)} quoted. `
    } else if (loggedHrs > 0) {
      para += `Labor: ${fmtHrs(loggedHrs)} logged (no estimate on file). `
    } else {
      para += 'No labor hours quoted or logged. '
    }

    if (mtoTotal > 0) {
      para += `${mtoTotal} MTO item${mtoTotal !== 1 ? 's' : ''}, ${mtoWithCost} with unit cost (${mtoNoCost} gap${mtoNoCost !== 1 ? 's' : ''})`
      para += matCostKnown > 0 ? `, ${fmt(matCostKnown)} in known material cost. ` : '. '
    } else {
      para += 'No MTO entries. '
    }

    if (openRFIs.length === 0) {
      para += 'No open RFIs. '
    } else if (openRFIs.length === 1) {
      para += `1 open RFI${oldestRFI > 0 ? ` (${oldestRFI} days open)` : ''}. `
    } else {
      para += `${openRFIs.length} open RFIs (oldest: ${oldestRFI} days). `
    }

    para += financeStr
    sections.push(para)

    // ── LABOR DETAIL ────────────────────────────────────────────────────────
    if (laborRows.length > 0) {
      const notStartedRows = laborRows.filter((r: any) => num(r.hrs) === 0)
      const activeRows     = laborRows.filter((r: any) => num(r.hrs) > 0)

      const laborDetail: string[] = []
      if (notStartedRows.length) {
        const names = notStartedRows.map((r: any) => r.desc || 'Unnamed').slice(0, 4)
        laborDetail.push(`${notStartedRows.length} line${notStartedRows.length !== 1 ? 's' : ''} not yet scoped (0hrs): ${names.join(', ')}${notStartedRows.length > 4 ? '...' : ''}`)
      }
      if (activeRows.length) {
        const named = activeRows.slice(0, 5).map((r: any) =>
          `${r.desc || 'Unnamed'} (${fmtHrs(num(r.hrs))} @ $${num(r.rate)}/h)`
        )
        laborDetail.push(`Quoted labor lines: ${named.join('; ')}${activeRows.length > 5 ? '...' : ''}`)
      }
      if (laborDetail.length) {
        sections.push(`  Labor breakdown — ${laborDetail.join('. ')}.`)
      }
    }

    // ── RFI DETAIL ──────────────────────────────────────────────────────────
    if (openRFIs.length > 0) {
      for (const rfi of openRFIs) {
        const age      = daysSince(rfi.submitted)
        const ageLabel = age >= 999 ? 'age unknown' : age === 0 ? 'opened today' : `open ${age} days`
        const aged     = age >= 14 ? ` ⚠ ${ageLabel}` : ` (${ageLabel})`
        const to       = rfi.directedTo ? ` → directed to ${rfi.directedTo}` : ''
        const stage    = rfi.stageApplies ? ` [affects ${rfi.stageApplies}]` : ''
        const q        = (rfi.question || 'No question recorded').slice(0, 120)
        sections.push(`  ${rfi.id || 'RFI'}${aged}${to}${stage}: "${q}"`)
      }
    }

    // ── MATERIAL DETAIL ─────────────────────────────────────────────────────
    if (mtoNoCost > 0) {
      const sample = mtoNoCostItems.slice(0, 5)
      sections.push(
        `  MTO data gaps (${mtoNoCost} item${mtoNoCost !== 1 ? 's' : ''} without unit cost): ${sample.join(', ')}${mtoNoCostItems.length > 5 ? '...' : ''}.`
      )
    }
    if (mtoFlaggedItems.length > 0) {
      const sample = mtoFlaggedItems.slice(0, 5)
      sections.push(`  MTO flagged for review: ${sample.join(', ')}${mtoFlaggedItems.length > 5 ? '...' : ''}.`)
    }
  }

  // ── FINANCIAL SUMMARY ACROSS ACTIVE PROJECTS ───────────────────────────────
  if (activeProjects.length > 0) {
    sections.push('\n### Financial Summary')
    const finLines: string[] = []
    let totalContract    = 0
    let totalPaid        = 0
    let totalOutstanding = 0

    for (const p of activeProjects.slice(0, 8)) {
      const fin      = getFinancials(p)
      const loggedHrs = (data.logs || [])
        .filter((l: any) => l.projId === p.id)
        .reduce((s: number, l: any) => s + num(l.hrs), 0)
      const laborCostLogged = loggedHrs * billRate
      const laborQuoted     = (p.laborRows || []).reduce((s: number, r: any) =>
        s + num(r.hrs) * num(r.rate || billRate), 0)

      totalContract    += fin.contract
      totalPaid        += fin.paid
      totalOutstanding += Math.max(0, fin.outstanding)

      let line = `${p.name}: contract ${fmt(fin.contract)}, paid ${fmt(fin.paid)}, outstanding ${fmt(Math.max(0, fin.outstanding))}`
      if (laborQuoted > 0) {
        line += `, labor budget ${fmt(laborQuoted)} vs ${fmt(laborCostLogged)} cost logged`
      }
      finLines.push(line)
    }

    sections.push(finLines.join('\n'))
    if (activeProjects.length > 1) {
      sections.push(
        `\nTotal across ${activeProjects.length} active projects: ${fmt(totalContract)} contracted, ` +
        `${fmt(totalPaid)} collected, ${fmt(totalOutstanding)} outstanding.`
      )
    }
  }

  // ── SERVICE LOG SUMMARY ────────────────────────────────────────────────────
  const recentSvc = (data.serviceLogs || []).filter((s: any) => daysSince(s.date) <= 30)
  if (recentSvc.length > 0) {
    sections.push('\n### Service Calls (Last 30 Days)')
    const totalQuoted    = recentSvc.reduce((s: number, l: any) => s + num(l.quoted), 0)
    const totalCollected = recentSvc.reduce((s: number, l: any) => s + num(l.collected), 0)
    const unpaid         = recentSvc.filter((l: any) => num(l.quoted) - num(l.collected) > 0)
    const unpaidBalance  = unpaid.reduce((s: number, l: any) => s + (num(l.quoted) - num(l.collected)), 0)

    let svcLine = `${recentSvc.length} service call${recentSvc.length !== 1 ? 's' : ''} in the last 30 days — quoted ${fmt(totalQuoted)}, collected ${fmt(totalCollected)}.`
    if (unpaid.length > 0) {
      svcLine += ` ${unpaid.length} unpaid or partial (${fmt(unpaidBalance)} outstanding).`
    }
    sections.push(svcLine)
  }

  // ── CALENDAR ANALYSIS ──────────────────────────────────────────────────────
  const calSection = buildCalendarContext(data)
  if (calSection) {
    sections.push(calSection)
  }

  sections.push(
    '\nUse this data to produce specific, named, data-driven responses. ' +
    'Reference actual project names, actual dollar amounts, actual task names, ' +
    'and actual days of stall rather than generic summaries.'
  )

  return sections.join('\n')
}

// ── Calendar Analysis ─────────────────────────────────────────────────────────

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Format a duration in milliseconds to a readable string like "5h", "2.5h", "45m".
 */
function fmtDuration(ms: number): string {
  if (ms <= 0) return ''
  const hrs = ms / 3600000
  if (hrs >= 1) return `${Math.round(hrs * 10) / 10}h`
  return `${Math.round(ms / 60000)}m`
}

/**
 * Parse a dateTime or date string from a Google Calendar event start/end field.
 */
function parseEventDate(ev: any, field: 'start' | 'end'): Date | null {
  const f = ev[field]
  if (!f) return null
  const str = f.dateTime || f.date
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Analyze calendar data from gcalCache and agendaSections.
 *
 * Data sources (from getBackupData()):
 *   gcalCache    — array of GoogleCalendarEvent objects cached from the GCal API.
 *                  Each event: { id, summary, description?, location?,
 *                    start: { dateTime, timeZone? }, end: { dateTime, timeZone? },
 *                    status? }
 *                  Typically [] until CHRONO Google Calendar sync is established.
 *   agendaSections — home agenda sections with tasks; used as fallback when
 *                    gcalCache is empty.
 *   projects     — active project array for capacity comparison.
 *   serviceLogs  — used to detect service-heavy days in recent history.
 *
 * Returns a formatted prose block for NEXUS context injection.
 * Returns empty string if no calendar data is available.
 */
function buildCalendarContext(data: any): string {
  const gcalCache: any[]    = Array.isArray(data.gcalCache) ? data.gcalCache : []
  const agendaSections: any[] = Array.isArray(data.agendaSections) ? data.agendaSections : []
  const activeProjects      = (data.projects || []).filter((p: any) => p.status === 'active')
  const activeCount         = activeProjects.length
  const lines: string[]     = []

  // ── Path A: gcalCache has events (Google Calendar synced) ─────────────────
  if (gcalCache.length > 0) {
    // Determine current week bounds (Sun → Sat)
    const weekStart = new Date()
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000)

    const thisWeekEvents = gcalCache.filter((ev: any) => {
      if (ev.status === 'cancelled') return false
      const startD = parseEventDate(ev, 'start')
      if (!startD) return false
      return startD.getTime() >= weekStart.getTime() && startD.getTime() < weekEnd.getTime()
    })

    lines.push(`\n### Calendar — Current Week`)

    if (thisWeekEvents.length === 0) {
      lines.push('No events this week in calendar cache.')
    } else {
      // Sort by start time
      const sorted = [...thisWeekEvents].sort((a, b) => {
        const aD = parseEventDate(a, 'start')
        const bD = parseEventDate(b, 'start')
        return (aD?.getTime() || 0) - (bD?.getTime() || 0)
      })

      // ── Event list ─────────────────────────────────────────────────────────
      const eventLines: string[] = []
      const summaryCount = new Map<string, number>()
      let totalScheduledMs = 0
      let projectBlockMs   = 0
      let serviceBlockMs   = 0
      const coveredWorkDays = new Set<number>()

      for (const ev of sorted) {
        const startD = parseEventDate(ev, 'start')
        const endD   = parseEventDate(ev, 'end')
        if (!startD) continue

        const summary  = ev.summary || 'Unnamed event'
        const day      = WEEK_DAYS[startD.getDay()]
        const startFmt = startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        const endFmt   = endD ? endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''
        const durMs    = endD ? endD.getTime() - startD.getTime() : 0
        const durStr   = fmtDuration(durMs)

        const timeRange = endFmt ? `${startFmt}–${endFmt}` : startFmt
        eventLines.push(`${day} ${timeRange} — ${summary}${durStr ? ` (${durStr})` : ''}`)

        // Aggregate for analysis
        totalScheduledMs += durMs
        if (startD.getDay() >= 1 && startD.getDay() <= 5) coveredWorkDays.add(startD.getDay())

        const sumLow = summary.toLowerCase()
        if (sumLow.includes('project') || sumLow.includes('construction') || sumLow.includes('install') || sumLow.includes('rough') || sumLow.includes('trim') || sumLow.includes('finish')) {
          projectBlockMs += durMs
        }
        if (sumLow.includes('service') || sumLow.includes('call') || sumLow.includes('repair') || sumLow.includes('troubleshoot')) {
          serviceBlockMs += durMs
        }

        // Recurring detection
        const key = sumLow.trim()
        summaryCount.set(key, (summaryCount.get(key) || 0) + 1)
      }

      lines.push(eventLines.join('\n'))

      // ── Recurring blocks ────────────────────────────────────────────────────
      const recurring = [...summaryCount.entries()].filter(([, c]) => c >= 2)
      if (recurring.length > 0) {
        const labels = recurring.map(([name, c]) => `"${name}" (${c}x)`)
        lines.push(`Recurring time blocks: ${labels.join(', ')}.`)
      }

      // ── Scheduled hours summary ─────────────────────────────────────────────
      const totalHrs   = Math.round(totalScheduledMs / 360000) / 10
      const projectHrs = Math.round(projectBlockMs / 360000) / 10
      const serviceHrs = Math.round(serviceBlockMs / 360000) / 10
      let summaryLine = `Total scheduled this week: ${totalHrs}h`
      if (projectHrs > 0) summaryLine += ` | project blocks: ${projectHrs}h`
      if (serviceHrs > 0) summaryLine += ` | service blocks: ${serviceHrs}h`
      lines.push(summaryLine + '.')

      // ── Capacity vs active project demand ───────────────────────────────────
      // Rule: each active project needs at minimum ~2h/day of dedicated time
      // across the work week to maintain momentum.
      if (activeCount > 0) {
        const recommendedProjectHrs = activeCount * 2 * 5 // 2h/day × 5 days
        if (projectHrs > 0 && projectHrs < recommendedProjectHrs) {
          lines.push(
            `⚠ Capacity gap: ${projectHrs}h project time scheduled for ${activeCount} active project${activeCount !== 1 ? 's' : ''}. ` +
            `At current pipeline size, aim for at least ${recommendedProjectHrs}h/week of project time to maintain delivery velocity.`
          )
        } else if (projectHrs === 0 && activeCount > 0) {
          lines.push(
            `⚠ No project time blocks found this week despite ${activeCount} active project${activeCount !== 1 ? 's' : ''} in pipeline.`
          )
        }
      }

      // ── Schedule gaps (Mon–Fri workdays with no events) ─────────────────────
      const gapDays = [1, 2, 3, 4, 5].filter(d => !coveredWorkDays.has(d)).map(d => WEEK_DAYS[d])
      if (gapDays.length > 0) {
        lines.push(`Open days (no scheduled events): ${gapDays.join(', ')}.`)
      }
    }

  // ── Path B: gcalCache empty — fall back to agenda + project count ─────────
  } else {
    const allTasks     = agendaSections.flatMap((s: any) => Array.isArray(s.tasks) ? s.tasks : [])
    const pendingTasks = allTasks.filter((t: any) => !t.done && t.text)
    const timeHintTasks = pendingTasks.filter((t: any) =>
      /\d+(:\d+)?\s*(am|pm)/i.test(t.text || '') ||
      /block|schedule|appointment/i.test(t.text || '')
    )

    if (timeHintTasks.length > 0 || activeCount > 0) {
      lines.push('\n### Calendar — Schedule Context')

      if (timeHintTasks.length > 0) {
        const hints = timeHintTasks.slice(0, 5).map((t: any) => t.text).join('; ')
        lines.push(`Agenda time-related tasks: ${hints}.`)
      }

      if (activeCount > 0) {
        lines.push(
          `${activeCount} active project${activeCount !== 1 ? 's' : ''} in pipeline. ` +
          `Google Calendar not yet synced — connect in CHRONO panel to enable full schedule vs capacity analysis.`
        )
      }
    }
    // Return empty if nothing useful to report
    if (lines.length === 0) return ''
  }

  return lines.join('\n')
}
