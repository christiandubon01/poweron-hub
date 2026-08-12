import { getCollectedRevenueForRange, type CollectedRevenueProvenance } from './collectedRevenueRange'
import { type BackupData } from './backupDataService'

/**
 * KPI-TIMELINE-1 — ONE canonical collected-cash timeline/range system exposed
 * through the top header "Collected" KPI.
 *
 * The owner selects a preset (Current Year, Previous Year, Last 6 Months, Last
 * 3 Months, Last 90 Days, This Month, All Time, Custom Range) and every preset
 * resolves to ONE normalized half-open date range `[startInclusive, endExclusive)`
 * at UTC midnight — the SAME convention `collectedRevenueRange` already uses for
 * Service `receivedAt` and Project log dates. There is exactly one canonical
 * collected calculation (`getCollectedRevenueForRange`); this module only adds
 * the preset → normalized-range layer and a convenience wrapper.
 *
 * Unknown-date historical cash (legacy undated service scalar, synthetic
 * `log-paidbackfill-` backfill, `manualPaidAdjustment`) is NEVER fabricated into
 * a precise period. For precise presets the displayed value is `knownTotal`
 * (known-dated cash only); the undated amount is surfaced separately as
 * provenance. For ALL_TIME the displayed value is `lifetimeTotal`
 * (known + unknown), with the known/undated split available as provenance.
 */

export type TimelinePreset =
  | 'CURRENT_YEAR'
  | 'PREVIOUS_YEAR'
  | 'LAST_6_MONTHS'
  | 'LAST_3_MONTHS'
  | 'LAST_90_DAYS'
  | 'THIS_MONTH'
  | 'ALL_TIME'
  | 'CUSTOM'

export interface TimelineRangeOptions {
  /** Reference "now". Production passes `new Date()`; the local calendar day is used. */
  now?: Date
  /** Inclusive start day (YYYY-MM-DD) for CUSTOM. */
  customStart?: string
  /** Inclusive end day (YYYY-MM-DD) for CUSTOM. */
  customEnd?: string
  /**
   * Override the "today" day key (YYYY-MM-DD). Tests pass this to keep boundary
   * math deterministic across host timezones; production omits it and derives
   * the local calendar day from `now`.
   */
  todayKey?: string
}

export interface ResolvedTimelineRange {
  preset: TimelinePreset
  /** Inclusive start, UTC midnight (half-open lower bound). */
  startInclusive: Date
  /** Exclusive end, UTC midnight (half-open upper bound). */
  endExclusive: Date
  /** True for ALL_TIME. Display uses lifetime semantics. */
  isAllTime: boolean
  /**
   * True ONLY for CUSTOM with a missing or invalid start/end date. This is an
   * explicit incomplete-range state: the consumer must NOT calculate lifetime,
   * must NOT calculate zero and present it as a valid result, and must NOT
   * silently substitute another preset. The UI surfaces a "select dates"
   * prompt instead of a number. ALL_TIME occurs only when the owner explicitly
   * selects ALL_TIME.
   */
  isInvalid: boolean
  /** Human-readable period label, e.g. "Current Year", "Last 90 Days", "Custom". */
  label: string
}

export interface TimelineCollectedResult {
  provenance: CollectedRevenueProvenance
  range: ResolvedTimelineRange
  /**
   * knownTotal for precise presets; lifetimeTotal for ALL_TIME; null for an
   * invalid/incomplete CUSTOM range (no financial result is computed — the UI
   * shows a "select dates" prompt, never a fabricated number).
   */
  displayValue: number | null
  isAllTime: boolean
  isInvalid: boolean
}

/** Dropdown order for the header selector. `short` fits the compact header slot. */
export const TIMELINE_PRESETS: { value: TimelinePreset; short: string; label: string }[] = [
  { value: 'CURRENT_YEAR', short: 'Paid YTD', label: 'Current Year' },
  { value: 'PREVIOUS_YEAR', short: 'Prev Year', label: 'Previous Year' },
  { value: 'LAST_6_MONTHS', short: '6 Months', label: 'Last 6 Months' },
  { value: 'LAST_3_MONTHS', short: '3 Months', label: 'Last 3 Months' },
  { value: 'LAST_90_DAYS', short: '90 Days', label: 'Last 90 Days' },
  { value: 'THIS_MONTH', short: 'This Month', label: 'This Month' },
  { value: 'ALL_TIME', short: 'All Time', label: 'All Time' },
  { value: 'CUSTOM', short: 'Custom', label: 'Custom' },
]

// ── Day-key helpers (YYYY-MM-DD ↔ UTC midnight) ───────────────────────────────

function utcMidnight(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`)
}

function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDayKey(dayKey: string, days: number): string {
  const ms = utcMidnight(dayKey).getTime() + days * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** First-of-month day key for a (year, monthIndex) pair, with full carry. */
function monthFirstKey(year: number, monthIndex: number): string {
  const y = year + Math.floor(monthIndex / 12)
  const m = ((monthIndex % 12) + 12) % 12
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function dayKeyOrder(dayKey: string): number {
  return utcMidnight(dayKey).getTime()
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDayKey(dayKey: unknown): dayKey is string {
  if (typeof dayKey !== 'string' || !DAY_KEY_RE.test(dayKey)) return false
  return !Number.isNaN(dayKeyOrder(dayKey))
}

function preciseRange(
  preset: TimelinePreset,
  startKey: string,
  endKey: string,
  label: string,
): ResolvedTimelineRange {
  return {
    preset,
    startInclusive: utcMidnight(startKey),
    endExclusive: utcMidnight(endKey),
    isAllTime: false,
    isInvalid: false,
    label,
  }
}

function allTimeRange(preset: TimelinePreset, label: string): ResolvedTimelineRange {
  return {
    preset,
    startInclusive: utcMidnight('1970-01-01'),
    endExclusive: utcMidnight('2100-01-01'),
    isAllTime: true,
    isInvalid: false,
    label,
  }
}

/**
 * KPI-TIMELINE-1A: an explicit incomplete-CUSTOM range. The dates are an inert
 * zero-width sentinel; `getTimelineCollected` never invokes the canonical range
 * authority for an invalid range, so no lifetime / zero value is ever computed
 * or presented as a valid financial result.
 */
function customInvalidRange(): ResolvedTimelineRange {
  return {
    preset: 'CUSTOM',
    startInclusive: utcMidnight('1970-01-01'),
    endExclusive: utcMidnight('1970-01-01'),
    isAllTime: false,
    isInvalid: true,
    label: 'Custom',
  }
}

function emptyProvenance(): CollectedRevenueProvenance {
  return {
    serviceKnownDatedCash: 0,
    projectKnownDatedCash: 0,
    serviceUnknownDateCash: 0,
    projectUnknownDateCash: 0,
    knownTotal: 0,
    unknownDateTotal: 0,
    lifetimeTotal: 0,
  }
}

/**
 * Resolve a preset to a normalized half-open UTC-midnight date range.
 *
 * Preset semantics (verbatim from KPI-TIMELINE-1 Part B):
 * - CURRENT_YEAR: Jan 1 current year → Jan 1 next year.
 * - PREVIOUS_YEAR: Jan 1 previous year → Jan 1 current year.
 * - THIS_MONTH: start of current month → start of next month.
 * - LAST_90_DAYS: rolling 90 calendar-day window including today (day-based).
 * - LAST_3_MONTHS / LAST_6_MONTHS: calendar-month-based period including the
 *   current month (current + N-1 prior months).
 * - CUSTOM: owner-selected inclusive start/end → half-open
 *   [start of selected start day, start of day after selected end day).
 * - ALL_TIME: not a precise window; consumer uses lifetime semantics.
 */
export function resolveTimelineRange(
  preset: TimelinePreset,
  options: TimelineRangeOptions = {},
): ResolvedTimelineRange {
  const todayKey = options.todayKey ?? localDayKey(options.now ?? new Date())
  const parts = todayKey.split('-')
  const year = Number(parts[0])
  const month = Number(parts[1]) - 1 // 0-11

  switch (preset) {
    case 'CURRENT_YEAR':
      return preciseRange(preset, `${year}-01-01`, `${year + 1}-01-01`, 'Current Year')
    case 'PREVIOUS_YEAR':
      return preciseRange(preset, `${year - 1}-01-01`, `${year}-01-01`, 'Previous Year')
    case 'THIS_MONTH':
      return preciseRange(preset, monthFirstKey(year, month), monthFirstKey(year, month + 1), 'This Month')
    case 'LAST_3_MONTHS':
      return preciseRange(preset, monthFirstKey(year, month - 2), monthFirstKey(year, month + 1), 'Last 3 Months')
    case 'LAST_6_MONTHS':
      return preciseRange(preset, monthFirstKey(year, month - 5), monthFirstKey(year, month + 1), 'Last 6 Months')
    case 'LAST_90_DAYS':
      return preciseRange(preset, addDayKey(todayKey, -89), addDayKey(todayKey, 1), 'Last 90 Days')
    case 'ALL_TIME':
      return allTimeRange(preset, 'All Time')
    case 'CUSTOM': {
      // KPI-TIMELINE-1A: missing or invalid start/end is an explicit incomplete
      // range — NOT a fallback to ALL_TIME and NOT a zero presented as a valid
      // result. The UI prompts for dates; no financial value is computed.
      if (!isValidDayKey(options.customStart) || !isValidDayKey(options.customEnd)) {
        return customInvalidRange()
      }
      const s = dayKeyOrder(options.customStart)
      const e = dayKeyOrder(options.customEnd)
      const lo = s <= e ? options.customStart : options.customEnd
      const hi = s <= e ? options.customEnd : options.customStart
      // Inclusive owner dates → half-open [start of lo day, start of day after hi day).
      return preciseRange(preset, lo, addDayKey(hi, 1), 'Custom')
    }
    default:
      return allTimeRange(preset, 'All Time')
  }
}

/**
 * Resolve a preset AND compute canonical collected-cash provenance for it in one
 * call. Reuses the single canonical range authority (`getCollectedRevenueForRange`).
 */
export function getTimelineCollected(
  backup: BackupData,
  preset: TimelinePreset,
  options: TimelineRangeOptions = {},
): TimelineCollectedResult {
  const range = resolveTimelineRange(preset, options)
  // KPI-TIMELINE-1A: an incomplete CUSTOM range yields no financial result. Do
  // NOT calculate lifetime, do NOT present zero as a valid number, and do NOT
  // substitute another preset — return an explicit invalid state.
  if (range.isInvalid) {
    return {
      provenance: emptyProvenance(),
      range,
      displayValue: null,
      isAllTime: false,
      isInvalid: true,
    }
  }
  const provenance = getCollectedRevenueForRange(backup, range.startInclusive, range.endExclusive)
  const displayValue = range.isAllTime ? provenance.lifetimeTotal : provenance.knownTotal
  return { provenance, range, displayValue, isAllTime: range.isAllTime, isInvalid: false }
}