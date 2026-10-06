import type { DailyCashProjection } from '@/finance/cashProjectionTypes'
import { movementState, type Timeline, type TimelineEvent, type TimelineMarker, type TimelineState } from './cashTimelineModel'

/**
 * Date-range lens over the canonical projection. A range is always a pair of graph dates (it snaps to the
 * projection's day rows, never an arbitrary timestamp). Nothing here computes a new trajectory: opening and closing
 * are read from existing day rows, and money in / out come from the engine's own daily totals.
 */
export interface DateRange { start: string; end: string }

/** Pointer x -> 0..1 position inside the plot area (the part of the plot between the axis labels and the right margin). */
export function fracFromClientX(clientX: number, rect: { left: number; width: number }, inset: { left: number; right: number }): number {
  const plotWidth = rect.width - inset.left - inset.right
  if (!(plotWidth > 0)) return 0
  return Math.min(1, Math.max(0, (clientX - rect.left - inset.left) / plotWidth))
}

/** Nearest graph date index for a 0..1 position. */
export function snapIndex(frac: number, count: number): number {
  if (count <= 1) return 0
  return Math.min(count - 1, Math.max(0, Math.round(frac * (count - 1))))
}

/** Order-independent: dragging right-to-left yields the same range as left-to-right. */
export function rangeFromIndices(dates: readonly string[], a: number, b: number): DateRange {
  const lo = Math.max(0, Math.min(a, b))
  const hi = Math.min(dates.length - 1, Math.max(a, b))
  return { start: dates[lo], end: dates[hi] }
}

export function normalizeRange(dates: readonly string[], a: string, b: string): DateRange | null {
  const i = dates.indexOf(a), j = dates.indexOf(b)
  if (i < 0 || j < 0) return null
  return rangeFromIndices(dates, i, j)
}

export const inRange = (date: string, range: DateRange | null): boolean => !!range && date >= range.start && date <= range.end

export interface RangeDay { date: string; events: TimelineEvent[]; markers: TimelineMarker[] }

export interface RangeSummary {
  range: DateRange
  dayCount: number
  openingCashMinor: number
  closingCashMinor: number
  moneyInMinor: number
  moneyOutMinor: number
  /** Display arithmetic only: money in minus money out (equals closing minus opening). */
  netMinor: number
  eventCount: number
  /** Event counts by presentation state. Possible events are in the projection (and totals) only when the mode admits them. */
  byState: Record<TimelineState, number>
  /** Unresolved items inside the range. They are markers, NOT cash movement, and are not in any total. */
  unresolvedCount: number
  lowestCashMinor: number
  lowestCashDate: string
  days: RangeDay[]
}

export function summarizeRange(rows: readonly DailyCashProjection[], timeline: Timeline, range: DateRange): RangeSummary | null {
  const startIndex = rows.findIndex(row => row.date === range.start)
  const endIndex = rows.findIndex(row => row.date === range.end)
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) return null
  const inside = rows.slice(startIndex, endIndex + 1)
  const byState: Record<TimelineState, number> = { posted: 0, projected: 0, possible: 0, pending: 0 }
  let eventCount = 0
  let moneyIn = 0, moneyOut = 0
  let lowest = inside[0]
  for (const row of inside) {
    moneyIn += row.inflowMinor
    moneyOut += row.outflowMinor
    for (const event of row.events) { eventCount += 1; byState[movementState(event)] += 1 }
    if (row.closingCashMinor < lowest.closingCashMinor) lowest = row
  }
  const days: RangeDay[] = timeline.days.filter(d => inRange(d.date, range)).map(d => ({ date: d.date, events: d.events, markers: d.markers }))
  return {
    range, dayCount: inside.length, openingCashMinor: inside[0].openingCashMinor, closingCashMinor: inside[inside.length - 1].closingCashMinor,
    moneyInMinor: moneyIn, moneyOutMinor: moneyOut, netMinor: moneyIn - moneyOut, eventCount, byState,
    unresolvedCount: days.reduce((n, d) => n + d.markers.length, 0), lowestCashMinor: lowest.closingCashMinor, lowestCashDate: lowest.date, days,
  }
}
