import type { CashProjectionResult, DailyCashProjection, ProjectionCashEvent, ProjectionMarker } from '@/finance/cashProjectionTypes'

/**
 * Presentation model for the cash-flow Event Timeline Layer.
 *
 * This is NOT an event engine. Every event, amount, date, direction and daily total below is read
 * straight from the canonical projection (`projection.anchor` / `projection.days`). This module only
 * decides how those facts are positioned, grouped and labelled.
 */

/** Presentation state of one cash movement. `pending` is architectural only: nothing produces it yet. */
export type TimelineState = 'posted' | 'projected' | 'possible' | 'pending'

export const TIMELINE_STATE_LABEL: Record<TimelineState, string> = {
  posted: 'Posted', projected: 'Projected', possible: 'Possible', pending: 'Pending',
}

export interface TimelineEvent {
  key: string
  date: string
  direction: 'inflow' | 'outflow'
  amountMinor: number
  label: string
  state: TimelineState
  confidence: string
  category: string | null
  sourceType: string
  projectId?: string
  debtAccountId?: string
  employeeId?: string
}

export interface TimelineMarker {
  key: string
  date: string
  reason: string
  /** Owner-facing explanation. Markers are NOT cash movement and carry no cash impact. */
  text: string
  label: string
  amountMinor: number | null
  projectId?: string
}

export interface TimelineDay {
  date: string
  /** 0 = Today (the projection anchor). */
  index: number
  /** Horizontal position as a 0..1 fraction of the plot width (same spacing the chart's date axis uses). */
  frac: number
  events: TimelineEvent[]
  markers: TimelineMarker[]
  /** Canonical daily totals from the projection, never re-derived here. */
  inflowMinor: number
  outflowMinor: number
  netMinor: number
}

export interface TimelineCluster {
  id: string
  days: TimelineDay[]
  frac: number
  eventCount: number
  markerCount: number
  inflowMinor: number
  outflowMinor: number
  netMinor: number
  /** Resting label shown (false when it would collide with the previous one). Access is never removed. */
  showLabel: boolean
}

export interface Timeline {
  asOfDate: string
  horizonDays: number
  clusters: TimelineCluster[]
  days: TimelineDay[]
  eventCount: number
}

export function movementState(event: Pick<ProjectionCashEvent, 'movementBasis' | 'confidence'>): TimelineState {
  if (event.confidence === 'possible') return 'possible'
  if (event.movementBasis === 'future_posted_ledger') return 'posted'
  return 'projected'
}

const MARKER_TEXT: Record<string, string> = {
  overdue_unsettled: 'Planned for this date and not marked paid or received. Cash OS cannot tell whether it happened outside the app.',
  collection_linkage_unknown: 'A collection was expected but Cash OS cannot link it to a payment, so no amount is counted.',
  unknown_amount: 'The amount is not known, so nothing is counted in projected cash.',
  unknown_payment_date: 'Payment timing is not known, so it is not placed on the calendar.',
  confidence_excluded: 'Expected money that is not counted in this view because it is not confirmed enough.',
  unknown_date: 'The date is not known.',
}

/** Owner-facing explanation for a projection marker's reason (shared by the graph and the day inspector). */
export function markerExplanation(reason: string, semanticCode?: string): string {
  const key = semanticCode === 'payment_timing_unknown' ? 'unknown_payment_date' : reason
  return MARKER_TEXT[key] ?? key.replace(/_/g, ' ')
}

/** Plain-language kind for a canonical source type. Only maps the existing enum; never parses keys. */
const SOURCE_KIND_LABEL: Record<string, string> = {
  obligation_occurrence: 'Recurring bill', cash_commitment: 'One-time payment', financial_transaction: 'Recorded transaction',
  project_schedule: 'Project collection', derived_liability: 'Payroll', scenario: 'What-if',
}
export function eventKindLabel(sourceType: string): string | null { return SOURCE_KIND_LABEL[sourceType] ?? null }

/**
 * What the graph emphasizes for a selected (or walkthrough-active) date. DAY-LEVEL only: the move from the
 * previous day's close to this day's close. Identical for every event, whatever its amount, category or label.
 * Start/end are fractions of the plot width (same spacing as the date axis) so the emphasis can follow the real
 * cash curve instead of a straight chord.
 */
export interface SelectionEmphasis {
  date: string
  index: number
  prevDate: string | null
  closingCashMinor: number
  netMinor: number
  direction: 'in' | 'out' | 'none'
  startFrac: number
  endFrac: number
}
export function selectionEmphasis(rows: ReadonlyArray<{ date: string; closingCashMinor: number; inflowMinor: number; outflowMinor: number }>, date: string): SelectionEmphasis | null {
  const index = rows.findIndex(row => row.date === date)
  if (index < 0) return null
  const row = rows[index]
  const netMinor = row.inflowMinor - row.outflowMinor
  const last = Math.max(rows.length - 1, 1)
  return { date, index, prevDate: index > 0 ? rows[index - 1].date : null, closingCashMinor: row.closingCashMinor, netMinor,
    direction: netMinor > 0 ? 'in' : netMinor < 0 ? 'out' : 'none', startFrac: Math.max(index - 1, 0) / last, endFrac: index / last }
}

/** `source_overlap` is bookkeeping about an already-linked payment, not something for the owner to resolve. */
const HIDDEN_MARKER_REASONS = new Set(['source_overlap'])

function toEvent(event: ProjectionCashEvent): TimelineEvent {
  return {
    key: event.sourceKey, date: event.date, direction: event.direction, amountMinor: event.amountMinor, label: event.label,
    state: movementState(event), confidence: event.confidence, category: event.category, sourceType: event.sourceType,
    projectId: event.attribution?.projectId ?? undefined, debtAccountId: event.attribution?.debtAccountId ?? undefined,
    employeeId: event.attribution?.employeeId ?? undefined,
  }
}

function toMarker(marker: ProjectionMarker): TimelineMarker {
  const reason = marker.semanticCode === 'payment_timing_unknown' ? 'unknown_payment_date' : marker.reason
  return { key: marker.sourceKey, date: marker.date as string, reason, text: MARKER_TEXT[reason] ?? reason.replace(/_/g, ' '), label: marker.label,
    amountMinor: marker.amountMinor, projectId: marker.attribution?.projectId ?? undefined }
}

/**
 * Density constants. They are fractions of the plot width and assume a plot of roughly 560px (the chart's
 * floor is ~400px). Deterministic: the same projection always yields the same grouping and labels.
 */
export const MARKER_MIN_GAP = 0.032
export const LABEL_MIN_GAP = 0.115

function dayFrom(row: DailyCashProjection, index: number, count: number, includeMarkers: boolean): TimelineDay {
  const events = row.events.map(toEvent).sort((a, b) => a.direction.localeCompare(b.direction) || b.amountMinor - a.amountMinor || a.key.localeCompare(b.key))
  const markers = includeMarkers
    ? row.markers.filter(m => m.date === row.date && !HIDDEN_MARKER_REASONS.has(m.reason)).map(toMarker) : []
  return { date: row.date, index, frac: count > 1 ? index / (count - 1) : 0, events, markers,
    inflowMinor: row.inflowMinor, outflowMinor: row.outflowMinor, netMinor: row.inflowMinor - row.outflowMinor }
}

export function buildTimeline(projection: CashProjectionResult): Timeline {
  const rows = [projection.anchor, ...projection.days]
  const days = rows.map((row, index) => dayFrom(row, index, rows.length, true)).filter(day => day.events.length > 0 || day.markers.length > 0)

  // Group days that would sit closer together than a marker can be drawn. Bounded width, anchored at the first day.
  const clusters: TimelineCluster[] = []
  for (const day of days) {
    const current = clusters[clusters.length - 1]
    if (current && day.frac - current.days[0].frac < MARKER_MIN_GAP) { current.days.push(day) } else {
      clusters.push({ id: '', days: [day], frac: day.frac, eventCount: 0, markerCount: 0, inflowMinor: 0, outflowMinor: 0, netMinor: 0, showLabel: false })
    }
  }
  let lastLabel = -1
  for (const cluster of clusters) {
    cluster.id = `cluster:${cluster.days[0].date}`
    cluster.frac = cluster.days.reduce((sum, d) => sum + d.frac, 0) / cluster.days.length
    for (const day of cluster.days) {
      cluster.eventCount += day.events.length
      cluster.markerCount += day.markers.length
      cluster.inflowMinor += day.inflowMinor
      cluster.outflowMinor += day.outflowMinor
    }
    cluster.netMinor = cluster.inflowMinor - cluster.outflowMinor
    if (cluster.frac - lastLabel >= LABEL_MIN_GAP || lastLabel < 0) { cluster.showLabel = true; lastLabel = cluster.frac }
  }
  return { asOfDate: projection.asOfDate, horizonDays: projection.horizonDays, clusters, days, eventCount: days.reduce((n, d) => n + d.events.length, 0) }
}

export function clusterForDate(timeline: Timeline, date: string): TimelineCluster | undefined {
  return timeline.clusters.find(c => c.days.some(d => d.date === date))
}

// ── Identity-based lookups (used for graph ↔ command-center linking). No text or amount matching. ──

export interface GraphTarget { date: string; key: string }

/** Finds the one graph event/marker with this exact canonical source key. */
export function findByKey(timeline: Timeline, key: string): GraphTarget | null {
  for (const day of timeline.days) {
    if (day.events.some(e => e.key === key) || day.markers.some(m => m.key === key)) return { date: day.date, key }
  }
  return null
}

/**
 * Resolves a command-center row to a graph target ONLY when identity is unambiguous:
 *  1) an exact canonical source key, else
 *  2) a project id that owns exactly one event in the visible window.
 * More than one candidate, or none, returns null (never guessed).
 */
export function resolveGraphTarget(timeline: Timeline, refs: { sourceKey?: string; projectId?: string }): GraphTarget | null {
  if (refs.sourceKey) {
    const exact = findByKey(timeline, refs.sourceKey)
    if (exact) return exact
  }
  if (refs.projectId) {
    const owned: GraphTarget[] = []
    for (const day of timeline.days) for (const e of day.events) if (e.projectId === refs.projectId) owned.push({ date: day.date, key: e.key })
    if (owned.length === 1) return owned[0]
  }
  return null
}

/** The canonical identity a selected graph item exposes to the command center. */
export function linkFor(timeline: Timeline, selection: { date: string; key: string | null }): { sourceKey?: string; projectId?: string } | null {
  if (!selection.key) return null
  const day = timeline.days.find(d => d.date === selection.date)
  const event = day?.events.find(e => e.key === selection.key)
  if (event) return { sourceKey: event.key, projectId: event.projectId }
  const marker = day?.markers.find(m => m.key === selection.key)
  return marker ? { sourceKey: marker.key, projectId: marker.projectId } : null
}

// ── Value axis ──

/**
 * Value-axis domain that reserves the lower part of the plot for the event timeline. Presentation only:
 * it never changes a series value, it only leaves open room below the lowest value.
 */
export function eventBandDomain(values: readonly number[]): { min: number; max: number; dataMin: number; dataMax: number } {
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const span = dataMax - dataMin > 0 ? dataMax - dataMin : Math.max(Math.abs(dataMax), 10000)
  return { min: Math.floor(dataMin - span * 0.9), max: Math.ceil(dataMax + span * 0.1), dataMin, dataMax }
}

/** Evenly spaced axis ticks inside the real data range only (none inside the reserved band). */
export function dataTicks(dataMin: number, dataMax: number, count = 4): number[] {
  if (dataMax === dataMin) return [dataMin]
  return Array.from({ length: count }, (_, i) => Math.round(dataMin + ((dataMax - dataMin) * i) / (count - 1)))
}

/** What the graph hands the command center, and what the command center hands back. Identity only. */
export interface GraphLink {
  /** Canonical identity of the selected graph event/marker (null when only a date is selected). */
  highlight: { sourceKey?: string; projectId?: string } | null
  /** A command-center row asked to be shown on the graph; resolved only through stable identity. */
  onRowSelect: (refs: { sourceKey?: string; projectId?: string }) => void
}
