/**
 * servicePaymentLedger.ts — FORENSIC-KPI-2B1: the additive Service payment-event
 * primitive.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module a Service "payment" was three scalar fields on the
 * serviceLogs[] row (collected / payStatus / balanceDue), and the workflow status
 * OWNED the money: picking "Paid in Full" rewrote collected up to the quote, and
 * picking "Unpaid" rewrote it to 0. Real dollars were manufactured and erased by a
 * status control.
 *
 * The two existing append-only ledgers on the row are not payment truth:
 *   • statusEvents[] is a STATUS log — cumulative snapshot, no event id, its date is
 *     the write date, and it is already load-bearing for CFOT exposure replay.
 *   • adjustments[] changes what is BILLABLE and what a job COST, never cash.
 * multiDayServiceCalls[].days[] proves the right shape (dated, id'd, additive) but
 * lives in a separate silo that feeds no financial reader.
 *
 * So payments[] is a new sibling ledger on the same row, merged by the same union
 * machinery as adjustments[] / statusEvents[] (see serviceScopeMerge.ts).
 *
 * PHASE BOUNDARY (2B1)
 * --------------------
 * `collected` REMAINS the compatibility cache every existing financial reader
 * consumes. This module keeps that cache truthful; it does not migrate any reader.
 * Date-aware readers are FORENSIC-KPI-2B2.
 *
 * Pure module: no I/O, no React, no clock unless supplied.
 */

import { num, round2 } from './serviceQuoteMath'

/** Money comparison tolerance — matches the existing service rollup convention. */
export const MONEY_EPSILON = 0.009

export type ServicePayStatusCode = 'Y' | 'P' | 'N'

/**
 * `payment`         — real cash received, with an owner-asserted received date.
 * `refund`          — signed-negative reversal. The primitive is structurally ready;
 *                     the owner-facing refund workflow is deliberately NOT in 2B1.
 * `legacy_baseline` — the pre-ledger scalar `collected` preserved exactly once, with
 *                     receivedAt = null because that date was never recorded and must
 *                     not be invented.
 */
export type ServicePaymentKind = 'payment' | 'refund' | 'legacy_baseline'

/** Logical home for a future external accounting id. No QuickBooks code in 2B1. */
export interface ServicePaymentExternalRef {
  system?: string
  invoiceId?: string
  paymentId?: string
  syncedAt?: string
}

export interface ServicePaymentEvent {
  /** Stable unique id. NEVER a content fingerprint — that is what makes merge safe. */
  id: string
  /** Signed: positive = received, negative = refund/reversal. */
  amount: number
  /** Owner-asserted date the money actually moved. null = genuinely unknown. */
  receivedAt: string | null
  /** ISO timestamp of when the event was written. Distinct from receivedAt. */
  recordedAt: string
  kind: ServicePaymentKind
  note?: string
  /** Links a reversal back to the event it reverses (future refund workflow). */
  reversalOfId?: string
  /** Soft-void. Payment truth is never hard-deleted. */
  voidedAt?: string | null
  external?: ServicePaymentExternalRef
}

/** Minimal row shape this module reads. Kept structural so it stays pure. */
export interface ServicePaymentRowLike {
  quoted?: unknown
  collected?: unknown
  adjustments?: any[]
  payments?: ServicePaymentEvent[]
  [key: string]: any
}

// ── Identity ──────────────────────────────────────────────────────────────────

let _paymentIdCounter = 0

/** Stable unique payment-event id. Content plays no part in it, by design. */
export function newServicePaymentEventId(): string {
  _paymentIdCounter = (_paymentIdCounter + 1) % 1_000_000
  const seq = _paymentIdCounter.toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `pay_${Date.now().toString(36)}_${seq}_${rand}`
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export function getServicePaymentEvents(row: ServicePaymentRowLike | null | undefined): ServicePaymentEvent[] {
  return Array.isArray(row?.payments) ? (row!.payments as ServicePaymentEvent[]) : []
}

export function isLiveServicePaymentEvent(event: ServicePaymentEvent | null | undefined): boolean {
  if (!event || typeof event !== 'object') return false
  const voided = event.voidedAt
  return !(typeof voided === 'string' && voided.trim().length > 0)
}

/** True once a row has been converted to ledger truth. */
export function hasServicePaymentLedger(row: ServicePaymentRowLike | null | undefined): boolean {
  return getServicePaymentEvents(row).length > 0
}

/** Cumulative cash from the ledger. Voided events contribute nothing. */
export function sumServicePayments(events: ServicePaymentEvent[] | null | undefined): number {
  const list = Array.isArray(events) ? events : []
  const total = list.reduce(
    (sum, event) => (isLiveServicePaymentEvent(event) ? sum + num(event.amount) : sum),
    0,
  )
  return round2(total)
}

/**
 * The truthful collected amount for a row.
 *  - Ledger rows  → the ledger sum (authoritative).
 *  - Legacy rows  → the scalar `collected`, which remains valid legacy amount truth.
 */
export function resolveServiceCollected(row: ServicePaymentRowLike | null | undefined): number {
  if (hasServicePaymentLedger(row)) return sumServicePayments(getServicePaymentEvents(row))
  return round2(Math.max(0, num(row?.collected)))
}

/**
 * The single definition of "the full amount due" (locked owner rule 6):
 * protected Total Quoted plus valid income/billable adjustments.
 *
 * Total Quoted itself is never rewritten to make a payment status fit.
 */
export function resolveServiceTotalBillable(row: ServicePaymentRowLike | null | undefined): number {
  const adjustments = Array.isArray(row?.adjustments) ? row!.adjustments! : []
  const addIncome = adjustments
    .filter((adjustment: any) => adjustment && adjustment.type === 'income')
    .reduce((sum: number, adjustment: any) => sum + num(adjustment.amount), 0)
  return round2(num(row?.quoted) + addIncome)
}

/**
 * Workflow status implied by real money. This is the ONLY direction the two are
 * allowed to travel in: money decides status, status never decides money.
 */
export function deriveServicePayStatus(collected: unknown, totalBillable: unknown): ServicePayStatusCode {
  const cash = num(collected)
  const due = num(totalBillable)
  if (cash <= MONEY_EPSILON) return 'N'
  if (due <= MONEY_EPSILON) return 'Y'
  return cash + MONEY_EPSILON >= due ? 'Y' : 'P'
}

export function resolveServiceBalanceDue(collected: unknown, totalBillable: unknown): number {
  return round2(Math.max(0, num(totalBillable) - num(collected)))
}

// ── Legacy baseline ───────────────────────────────────────────────────────────

export const LEGACY_BASELINE_NOTE =
  'Legacy collected amount carried forward. Received date was never recorded.'

/**
 * Stable id for a legacy baseline event tied to a specific service log row.
 *
 * The baseline represents scalar `collected` that predates the ledger. It must never
 * change and never duplicate. Anchoring it to the row's own stable identity means a row
 * that already has a ledger keeps its existing baseline, and a re-imported row with the
 * same service-log identity resurrects the same baseline instead of minting a new one.
 */
export function legacyBaselineEventIdFor(row: ServicePaymentRowLike | null | undefined): string {
  const rowId = row && typeof row === 'object'
    ? String(row.serviceLogId || row.id || row.serviceLogId || '').trim()
    : ''
  if (rowId) return `${rowId}:baseline`
  return `legacy:baseline:${newServicePaymentEventId()}`
}

/**
 * Preserve a pre-ledger scalar `collected` as the ledger's first event — exactly once.
 *
 * receivedAt is deliberately null. A null/unknown received date is preferable to the
 * false precision of back-dating the money to the service date.
 *
 * Returns the events array unchanged when a ledger already exists, so re-saving a row
 * can never mint a second baseline.
 */
export function ensureServicePaymentLedger(
  row: ServicePaymentRowLike | null | undefined,
  options?: { now?: string; makeId?: () => string },
): { events: ServicePaymentEvent[]; baseline: ServicePaymentEvent | null } {
  const existing = getServicePaymentEvents(row)
  if (existing.length > 0) return { events: [...existing], baseline: null }

  const legacyCollected = round2(Math.max(0, num(row?.collected)))
  if (legacyCollected <= MONEY_EPSILON) return { events: [], baseline: null }

  const makeId = options?.makeId || newServicePaymentEventId
  const baseline: ServicePaymentEvent = {
    id: legacyBaselineEventIdFor(row),
    amount: legacyCollected,
    receivedAt: null,
    recordedAt: options?.now || new Date().toISOString(),
    kind: 'legacy_baseline',
    note: LEGACY_BASELINE_NOTE,
    voidedAt: null,
  }
  return { events: [baseline], baseline }
}

/**
 * Create a legacy-baseline payment event for a row that is being ledgerized at creation
 * time (e.g. QuickBooks import with collected > 0 and no actual payment date).
 *
 * The returned event has receivedAt = null because the source only knows the collected
 * amount, not when the money moved. The event id is anchored to the row's stable id.
 */
export function createServicePaymentLegacyBaseline(
  row: ServicePaymentRowLike | null | undefined,
  options?: { now?: string; makeId?: () => string },
): ServicePaymentEvent | null {
  const legacyCollected = round2(Math.max(0, num(row?.collected)))
  if (legacyCollected <= MONEY_EPSILON) return null

  return {
    id: legacyBaselineEventIdFor(row),
    amount: legacyCollected,
    receivedAt: null,
    recordedAt: options?.now || new Date().toISOString(),
    kind: 'legacy_baseline',
    note: LEGACY_BASELINE_NOTE,
    voidedAt: null,
  }
}

// ── Writer ────────────────────────────────────────────────────────────────────

export interface RecordServicePaymentInput {
  /** Signed. Positive = received. Negative is structurally supported (future refunds). */
  amount: number
  /** Owner-asserted received date (YYYY-MM-DD). null only for genuinely unknown truth. */
  receivedAt: string | null
  note?: string
  kind?: ServicePaymentKind
  /** Injectable for deterministic tests. */
  now?: string
  makeId?: () => string
}

export type RecordServicePaymentFailure =
  | 'invalid-row'
  | 'invalid-amount'

export interface RecordServicePaymentSuccess<T> {
  ok: true
  row: T
  event: ServicePaymentEvent
  /** Non-null only on the one save that converts a legacy row to ledger truth. */
  baseline: ServicePaymentEvent | null
  collected: number
  balanceDue: number
  payStatus: ServicePayStatusCode
}

export interface RecordServicePaymentRejected {
  ok: false
  reason: RecordServicePaymentFailure
  message: string
}

export type RecordServicePaymentResult<T> = RecordServicePaymentSuccess<T> | RecordServicePaymentRejected

/**
 * THE payment writer. Every Service payment action routes through here so there is
 * one authority over cash.
 *
 * It appends (never mutates, never removes), preserves a legacy baseline exactly
 * once, recomputes the `collected` compatibility cache from the ledger, and lets the
 * resulting money decide the workflow status.
 */
export function recordServicePayment<T extends ServicePaymentRowLike>(
  row: T,
  input: RecordServicePaymentInput,
): RecordServicePaymentResult<T> {
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'invalid-row', message: 'No service record to record a payment against.' }
  }

  const amount = round2(num(input?.amount))
  if (!Number.isFinite(amount) || Math.abs(amount) <= MONEY_EPSILON) {
    return { ok: false, reason: 'invalid-amount', message: 'Enter a payment amount greater than zero.' }
  }

  const now = input?.now || new Date().toISOString()
  const makeId = input?.makeId || newServicePaymentEventId

  // Legacy amount truth is preserved before the new payment is appended, so the two
  // can never be conflated and the legacy amount can never be double-counted.
  const { events, baseline } = ensureServicePaymentLedger(row, { now, makeId })

  const receivedAt = typeof input?.receivedAt === 'string' && input.receivedAt.trim()
    ? input.receivedAt.trim()
    : null

  const event: ServicePaymentEvent = {
    id: makeId(),
    amount,
    receivedAt,
    recordedAt: now,
    kind: input?.kind || (amount < 0 ? 'refund' : 'payment'),
    voidedAt: null,
  }
  const note = typeof input?.note === 'string' ? input.note.trim() : ''
  if (note) event.note = note

  const nextEvents = [...events, event]
  const collected = sumServicePayments(nextEvents)
  const totalBillable = resolveServiceTotalBillable(row)
  const balanceDue = resolveServiceBalanceDue(collected, totalBillable)
  const payStatus = deriveServicePayStatus(collected, totalBillable)

  const nextRow = {
    ...row,
    payments: nextEvents,
    collected,
    balanceDue,
    payStatus,
  } as T

  return { ok: true, row: nextRow, event, baseline, collected, balanceDue, payStatus }
}

/**
 * Build a service-log row that already owns a real payment ledger from the moment it is
 * created. Used when owner-entered cash on a brand-new service call must not bypass
 * payments[] (FORENSIC-KPI-2B1). The new row is created with the first payment event
 * and the collected cache derived from it.
 */
export function buildServiceLogWithPayment<T extends ServicePaymentRowLike>(
  baseRow: T,
  input: RecordServicePaymentInput,
): RecordServicePaymentResult<T> {
  if (!baseRow || typeof baseRow !== 'object') {
    return { ok: false, reason: 'invalid-row', message: 'No service record to record a payment against.' }
  }

  const amount = round2(num(input?.amount))
  if (!Number.isFinite(amount) || Math.abs(amount) <= MONEY_EPSILON) {
    return { ok: false, reason: 'invalid-amount', message: 'Enter a payment amount greater than zero.' }
  }

  if (typeof input?.receivedAt !== 'string' || !input.receivedAt.trim()) {
    return { ok: false, reason: 'invalid-amount', message: 'Select the date the payment was received.' }
  }

  const now = input?.now || new Date().toISOString()
  const makeId = input?.makeId || newServicePaymentEventId

  const event: ServicePaymentEvent = {
    id: makeId(),
    amount,
    receivedAt: input.receivedAt.trim(),
    recordedAt: now,
    kind: input?.kind || (amount < 0 ? 'refund' : 'payment'),
    voidedAt: null,
  }
  const note = typeof input?.note === 'string' ? input.note.trim() : ''
  if (note) event.note = note

  const nextEvents = [event]
  const collected = sumServicePayments(nextEvents)
  const totalBillable = resolveServiceTotalBillable(baseRow)
  const balanceDue = resolveServiceBalanceDue(collected, totalBillable)
  const payStatus = deriveServicePayStatus(collected, totalBillable)

  const nextRow = {
    ...baseRow,
    payments: nextEvents,
    collected,
    balanceDue,
    payStatus,
  } as T

  return { ok: true, row: nextRow, event, baseline: null, collected, balanceDue, payStatus }
}

/**
 * Re-derive the `collected` / `balanceDue` / `payStatus` compatibility fields from the
 * ledger without appending anything. Used after a sync merge folds two devices'
 * payment events together, so the cache reflects the union rather than whichever row
 * happened to win on updatedAt.
 */
export function reconcileServiceCacheFromLedger<T extends ServicePaymentRowLike>(row: T): T {
  if (!row || typeof row !== 'object') return row
  if (!hasServicePaymentLedger(row)) return row
  const collected = sumServicePayments(getServicePaymentEvents(row))
  const totalBillable = resolveServiceTotalBillable(row)
  return {
    ...row,
    collected,
    balanceDue: resolveServiceBalanceDue(collected, totalBillable),
    payStatus: deriveServicePayStatus(collected, totalBillable),
  } as T
}

// ── Legacy date resolution (FORENSIC-KPI-2B2-2D) ──────────────────────────────

/**
 * FORENSIC-KPI-2B2-2D: detect the pre-ledger / undated historical cash on a Service
 * row that the owner can later assign a REAL received date to — without changing the
 * amount.
 *
 * CASE 1 — no payments[] ledger: the scalar `collected` (clamped >= 0) is the
 *   unknown legacy amount. source = 'scalar'.
 * CASE 2 — a payments[] ledger exists: the unknown amount is the sum of LIVE
 *   legacy_baseline events (receivedAt = null by construction). source = 'baseline'.
 *   Any OTHER live event whose receivedAt is null (a 'payment' or 'refund' recorded
 *   without a date) is NOT something this helper knows how to resolve safely;
 *   hasUnexpectedNullDateEvent is set so the caller can refuse instead of inventing
 *   semantics for it (see resolveServiceLegacyPayments 'unexpected-null-date').
 *
 * Rows with no unknown cash return { amount: 0, source: 'none', ... } — already fully
 * dated, or nothing collected.
 */
export interface ServiceLegacyUnknownCash {
  amount: number
  source: 'scalar' | 'baseline' | 'none'
  hasUnexpectedNullDateEvent: boolean
}

export function getServiceLegacyUnknownCash(
  row: ServicePaymentRowLike | null | undefined,
): ServiceLegacyUnknownCash {
  if (!row || typeof row !== 'object') {
    return { amount: 0, source: 'none', hasUnexpectedNullDateEvent: false }
  }

  const events = getServicePaymentEvents(row)
  if (events.length === 0) {
    const scalar = round2(Math.max(0, num(row.collected)))
    return {
      amount: scalar,
      source: scalar > MONEY_EPSILON ? 'scalar' : 'none',
      hasUnexpectedNullDateEvent: false,
    }
  }

  let unknown = 0
  let hasUnexpectedNullDateEvent = false
  for (const event of events) {
    if (!isLiveServicePaymentEvent(event)) continue
    const hasDate = typeof event.receivedAt === 'string' && event.receivedAt.trim().length > 0
    if (hasDate) continue
    if (event.kind === 'legacy_baseline') {
      unknown += num(event.amount)
    } else {
      hasUnexpectedNullDateEvent = true
    }
  }
  unknown = round2(unknown)
  return {
    amount: unknown,
    source: unknown > MONEY_EPSILON ? 'baseline' : 'none',
    hasUnexpectedNullDateEvent,
  }
}

export interface LegacyPaymentEntryInput {
  amount: number
  receivedAt: string
  note?: string
}

export type ResolveServiceLegacyPaymentsFailure =
  | 'unexpected-null-date'
  | 'no-unknown-cash'
  | 'invalid-entries'
  | 'amount-mismatch'

export interface ResolveServiceLegacyPaymentsSuccess<T> {
  ok: true
  row: T
  /** The new dated events appended (one per input entry). */
  events: ServicePaymentEvent[]
  collected: number
  balanceDue: number
  payStatus: ServicePayStatusCode
  /** The unknown amount that was resolved. */
  resolvedAmount: number
}

export interface ResolveServiceLegacyPaymentsRejected {
  ok: false
  reason: ResolveServiceLegacyPaymentsFailure
  message: string
  /** entriesSum - unknownAmount, when reason is 'amount-mismatch'. */
  difference?: number
}

export type ResolveServiceLegacyPaymentsResult<T> =
  | ResolveServiceLegacyPaymentsSuccess<T>
  | ResolveServiceLegacyPaymentsRejected

/**
 * FORENSIC-KPI-2B2-2D: assign real received dates to a Service row's pre-ledger /
 * undated historical cash WITHOUT changing the collected amount.
 *
 * The owner opens an old Service Call whose collected cash has no recorded payment
 * date. They enter one or more { amount, receivedAt } rows that together sum to the
 * unknown amount. This helper:
 *   • VOIDs the live legacy_baseline event(s) — same stable id on both devices, so
 *     the production serviceLogs merge's void-wins semantics retire them instead of
 *     resurrecting a live baseline from the remote side. (Scalar-only rows have no
 *     baseline event to void; their entries simply start the ledger.)
 *   • keeps every OTHER event EXACTLY as-is (ids, dates, amounts, voided state),
 *   • appends one dated 'payment' event per entry (negative entry → 'refund'),
 *   • recomputes collected / balanceDue / payStatus from the new ledger.
 *
 * MONEY INVARIANT: the entries sum equals the unknown amount, so the new collected
 * equals the old collected. totalBillable is untouched, so balanceDue and payStatus
 * are unchanged too. The ONLY thing that changes is the cash DATE — which moves the
 * money out of unknown-date and into the correct calendar period for every FLOW
 * reader (Header Paid YTD, Monthly / Weekly / 8-Week, Annual Target numerator).
 *
 * It REFUSES (never invents) when:
 *   • hasUnexpectedNullDateEvent — a non-baseline event has no date (report, don't guess),
 *   • there is no unknown cash to resolve,
 *   • entries are empty, non-positive, or missing a date,
 *   • entries do not sum to the unknown amount (within MONEY_EPSILON).
 */
export function resolveServiceLegacyPayments<T extends ServicePaymentRowLike>(
  row: T,
  entries: LegacyPaymentEntryInput[],
  options?: { now?: string; makeId?: () => string },
): ResolveServiceLegacyPaymentsResult<T> {
  if (!row || typeof row !== 'object') {
    return { ok: false, reason: 'invalid-entries', message: 'No service record to resolve.' }
  }

  const unknown = getServiceLegacyUnknownCash(row)

  if (unknown.hasUnexpectedNullDateEvent) {
    return {
      ok: false,
      reason: 'unexpected-null-date',
      message:
        'This service call has a payment recorded without a received date that is not a legacy baseline. Its date must be entered directly, not resolved here.',
    }
  }

  if (unknown.amount <= MONEY_EPSILON) {
    return {
      ok: false,
      reason: 'no-unknown-cash',
      message: 'This service call has no undated collected cash to resolve.',
    }
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: false, reason: 'invalid-entries', message: 'Enter at least one payment row.' }
  }

  const now = options?.now || new Date().toISOString()
  const makeId = options?.makeId || newServicePaymentEventId

  const cleanEntries: { amount: number; receivedAt: string; note: string }[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, reason: 'invalid-entries', message: 'Each payment row needs an amount and a date.' }
    }
    const amount = round2(num(entry.amount))
    if (!Number.isFinite(amount) || Math.abs(amount) <= MONEY_EPSILON) {
      return { ok: false, reason: 'invalid-entries', message: 'Each payment amount must be greater than zero.' }
    }
    const receivedAt = typeof entry.receivedAt === 'string' ? entry.receivedAt.trim() : ''
    if (!receivedAt) {
      return { ok: false, reason: 'invalid-entries', message: 'Select the date each payment was received.' }
    }
    const note = typeof entry.note === 'string' ? entry.note.trim() : ''
    cleanEntries.push({ amount, receivedAt, note })
  }

  const entriesSum = round2(cleanEntries.reduce((sum, e) => sum + e.amount, 0))
  const difference = round2(entriesSum - unknown.amount)
  if (Math.abs(difference) > MONEY_EPSILON) {
    return {
      ok: false,
      reason: 'amount-mismatch',
      message: `The payment rows total ${entriesSum.toFixed(2)} but the undated collected cash is ${unknown.amount.toFixed(2)}. Adjust the rows so they match exactly.`,
      difference,
    }
  }

  // Build the new ledger: VOID each live undated legacy_baseline (same stable id on
  // both devices, so the production merge's void-wins semantics retire it instead of
  // resurrecting a live remote baseline that would double the collected cash), keep
  // every other event EXACTLY as-is, then append one dated event per entry. Scalar-
  // only rows have no baseline to void — the entries simply become the ledger.
  const keep: ServicePaymentEvent[] = []
  for (const event of getServicePaymentEvents(row)) {
    if (!isLiveServicePaymentEvent(event)) {
      keep.push(event) // preserve already-voided events untouched
      continue
    }
    const hasDate = typeof event.receivedAt === 'string' && event.receivedAt.trim().length > 0
    if (!hasDate && event.kind === 'legacy_baseline') {
      keep.push({
        ...event,
        voidedAt: now,
        note: `${typeof event.note === 'string' && event.note ? event.note + ' ' : ''}[Resolved to dated payment event(s) on ${now.slice(0, 10)}]`,
      })
      continue
    }
    keep.push(event)
  }

  const newEvents: ServicePaymentEvent[] = cleanEntries.map(entry => {
    const event: ServicePaymentEvent = {
      id: makeId(),
      amount: entry.amount,
      receivedAt: entry.receivedAt,
      recordedAt: now,
      kind: entry.amount < 0 ? 'refund' : 'payment',
      voidedAt: null,
    }
    if (entry.note) event.note = entry.note
    return event
  })

  const nextEvents = [...keep, ...newEvents]
  const collected = sumServicePayments(nextEvents)
  const totalBillable = resolveServiceTotalBillable(row)
  const balanceDue = resolveServiceBalanceDue(collected, totalBillable)
  const payStatus = deriveServicePayStatus(collected, totalBillable)

  const nextRow = {
    ...row,
    payments: nextEvents,
    collected,
    balanceDue,
    payStatus,
  } as T

  return {
    ok: true,
    row: nextRow,
    events: newEvents,
    collected,
    balanceDue,
    payStatus,
    resolvedAmount: unknown.amount,
  }
}
