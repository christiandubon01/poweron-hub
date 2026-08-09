/**
 * serviceQuoteMath.ts — SERVICE-LOG-1 canonical Service Log quote math.
 *
 * One formula path for New Service Estimate, New Service Call, Edit Service Call
 * and every read-only profit display. Nothing here touches storage or React.
 *
 * Two distinct numbers, deliberately separated:
 *
 *   Suggested Quote — the app's calculated profitable price. Always DERIVED from
 *     the current pricing inputs (hours × bill rate + materials + mileage + tax).
 *     Informational only; it is not what the customer agreed to.
 *
 *   Total Quoted — the actual final amount quoted to the customer. Owner-editable
 *     and persisted on the record. This is the canonical customer-facing number
 *     and it keeps using the EXISTING stored fields (serviceLogs[].quoted /
 *     serviceEstimates[].totalQuote) so historical records are unchanged and
 *     collections / balances / revenue keep reading the same field they always
 *     have. No renamed or duplicated money column was introduced.
 *
 * The internal cost stack (materials + mileage + tax + operating cost) is counted
 * exactly once. Labor is represented by operating cost — the billable labor line
 * is revenue, not cost, so it is never subtracted a second time.
 */

/** Round to cents so variance readouts land on exact money values. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Coerce anything the forms hand us (string inputs, null, NaN) into a number. */
export function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : 0
}

export interface ServiceQuoteInputs {
  /** Quoted/estimated hours used for both the labor line and operating cost. */
  hours: number
  /** Customer-facing billable rate per hour. */
  billRate: number
  /** Material cost in dollars. */
  materials: number
  /** Round-trip miles. */
  miles: number
  /** Settings.mileRate — dollars per mile. */
  mileRate: number
  /** Settings.tax — percentage (e.g. 8.25 means 8.25%). */
  taxRatePct: number
  /** Settings.opCost — internal operating cost per hour. */
  opCostRate: number
}

export interface ServiceQuoteBreakdown {
  /** Billable labor line inside Suggested Quote (hours × bill rate). */
  laborBillable: number
  materialCost: number
  mileage: number
  tax: number
  operatingCost: number
  /** materials + mileage + tax + operating cost — counted once. */
  internalCost: number

  suggestedQuote: number
  suggestedProfit: number

  totalQuoted: number
  quoteVariance: number
  actualEstimatedProfit: number
  /** Fraction, not percent. 0.25 === 25%. */
  actualProfitMargin: number
}

/**
 * Compute the full breakdown.
 *
 * `totalQuotedOverride` is the owner's actual price. When it is null/undefined
 * (a brand-new record the owner has not priced yet) Total Quoted initialises
 * from Suggested Quote, so a record that is never manually priced behaves
 * exactly like the old single-number model.
 */
export function computeServiceQuote(
  inputs: Partial<ServiceQuoteInputs>,
  totalQuotedOverride?: number | null,
): ServiceQuoteBreakdown {
  const hours = num(inputs.hours)
  const billRate = num(inputs.billRate)
  const materials = num(inputs.materials)
  const miles = num(inputs.miles)
  const mileRate = num(inputs.mileRate)
  const taxRatePct = num(inputs.taxRatePct)
  const opCostRate = num(inputs.opCostRate)

  const laborBillable = round2(hours * billRate)
  const materialCost = round2(materials)
  const mileage = round2(miles * mileRate)
  const tax = round2((materialCost + mileage) * (taxRatePct / 100))
  const operatingCost = round2(hours * opCostRate)

  const internalCost = round2(materialCost + mileage + tax + operatingCost)
  const suggestedQuote = round2(laborBillable + materialCost + mileage + tax)
  const suggestedProfit = round2(suggestedQuote - internalCost)

  const totalQuoted = totalQuotedOverride == null
    ? suggestedQuote
    : round2(num(totalQuotedOverride))

  const quoteVariance = round2(totalQuoted - suggestedQuote)
  const actualEstimatedProfit = round2(totalQuoted - internalCost)
  const actualProfitMargin = totalQuoted > 0 ? actualEstimatedProfit / totalQuoted : 0

  return {
    laborBillable,
    materialCost,
    mileage,
    tax,
    operatingCost,
    internalCost,
    suggestedQuote,
    suggestedProfit,
    totalQuoted,
    quoteVariance,
    actualEstimatedProfit,
    actualProfitMargin,
  }
}

export type QuoteVarianceTone = 'above' | 'below' | 'neutral'

/** Display tone for Quote Variance: above suggestion / below suggestion / equal. */
export function quoteVarianceTone(variance: number): QuoteVarianceTone {
  if (variance > 0.005) return 'above'
  if (variance < -0.005) return 'below'
  return 'neutral'
}

/** "+$247.56" / "-$50.00" / "$0.00" — sign is explicit for positive variance. */
export function formatQuoteVariance(variance: number, fmt: (n: number) => string): string {
  const tone = quoteVarianceTone(variance)
  if (tone === 'above') return `+${fmt(variance)}`
  if (tone === 'below') return `-${fmt(Math.abs(variance))}`
  return fmt(0)
}

// ── Persistence bridge (backward compatibility) ──────────────────────────────

/**
 * Fields SERVICE-LOG-1 adds alongside the existing quote field. Both are
 * optional so every pre-existing record keeps loading unchanged.
 */
export interface StoredQuoteFields {
  /** Informational snapshot of the derived Suggested Quote at save time. */
  suggestedQuote?: number
  /** True once the owner typed a Total Quoted that differs from the suggestion. */
  quotedManual?: boolean
}

/**
 * Read the actual customer quote off any service record.
 *
 * serviceLogs use `quoted`; serviceEstimates / activeServiceCalls use
 * `totalQuote`. Historical rows have only one of those and no manual flag —
 * whatever they stored IS the customer quote, so it loads straight into
 * Total Quoted and is never recalculated over.
 */
export function resolveTotalQuoted(record: unknown): number {
  const r = (record ?? {}) as Record<string, unknown>
  if (r.totalQuote != null) return round2(num(r.totalQuote))
  if (r.quoted != null) return round2(num(r.quoted))
  return 0
}

/** Read the stored Suggested Quote snapshot, if a record has one. */
export function resolveStoredSuggestedQuote(record: unknown): number | null {
  const r = (record ?? {}) as Record<string, unknown>
  if (r.suggestedQuote == null) return null
  return round2(num(r.suggestedQuote))
}

/**
 * Did the owner price this record by hand?
 *
 * Explicit `quotedManual` wins. For legacy rows saved before this phase we infer
 * it: a stored quote that differs from what the current inputs suggest is an
 * owner price and must not be silently overwritten.
 */
export function isManuallyQuoted(record: unknown, suggestedQuote: number): boolean {
  const r = (record ?? {}) as Record<string, unknown>
  if (typeof r.quotedManual === 'boolean') return r.quotedManual
  const stored = resolveTotalQuoted(r)
  if (stored <= 0) return false
  return Math.abs(stored - round2(suggestedQuote)) > 0.005
}

/**
 * Decide the Total Quoted value to show after a cost input changed.
 *
 * Manual quotes are sticky: editing hours / materials / mileage / rate moves
 * Suggested Quote but leaves the owner's number alone. Only an untouched quote
 * tracks the suggestion.
 */
export function nextTotalQuotedAfterInputChange(args: {
  currentTotalQuoted: number
  suggestedQuote: number
  quotedManual: boolean
}): number {
  return args.quotedManual ? round2(args.currentTotalQuoted) : round2(args.suggestedQuote)
}

export type EstimateBillRateSource = 'default' | 'manual'

/**
 * Resolve persisted Bill Rate provenance. Explicit metadata is authoritative.
 * Legacy rows are inferred once: a positive record-specific value is preserved
 * as manual unless it exactly matches the current Settings default.
 */
export function resolveEstimateBillRateSource(
  record: unknown,
  settingsDefault: unknown,
): EstimateBillRateSource {
  const r = (record ?? {}) as Record<string, unknown>
  if (r.billRateSource === 'default' || r.billRateSource === 'manual') {
    return r.billRateSource
  }
  const stored = num(r.billRate)
  const fallback = num(settingsDefault)
  return stored > 0 && fallback > 0 && Math.abs(stored - fallback) <= 0.005
    ? 'default'
    : 'manual'
}

export function resolveEffectiveEstimateBillRate(
  record: unknown,
  settingsDefault: unknown,
): number {
  const r = (record ?? {}) as Record<string, unknown>
  return resolveEstimateBillRateSource(r, settingsDefault) === 'default'
    ? round2(num(settingsDefault))
    : round2(num(r.billRate))
}
