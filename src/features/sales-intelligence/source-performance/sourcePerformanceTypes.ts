/**
 * LEAD-SRC-6 — Per-source Sales Intelligence performance reporting.
 *
 * Converted Value authority: hunter_conversion_receipts.converted_value only.
 * Lead / conversion eligibility: hunter_leads + conversion receipts only
 * (never general Projects / Service Calls without Pipeline lineage).
 */

export interface SourcePerformanceRow {
  key: string
  family: string
  detail: string | null
  label: string
  /** Distinct hunter lead IDs currently attributed to this source. */
  leads: number
  /** Distinct lead IDs with at least one durable conversion receipt for this source snapshot. */
  converted: number
  /** converted / leads, or 0 when leads === 0. Never NaN. */
  conversionRate: number
  /** Sum of non-null receipt converted_value for this source. NULL receipts add $0. */
  convertedValue: number
  /** How many receipt rows contributed a non-null converted_value. */
  receiptsWithValue: number
  /** Total receipt rows attributed to this source (may exceed converted when one lead has multiple destinations). */
  receiptCount: number
}

export interface SourcePerformanceTotals {
  leads: number
  converted: number
  conversionRate: number
  convertedValue: number
  receiptsWithValue: number
  receiptCount: number
}

export interface SourcePerformanceReport {
  /** All-time horizon — SI Coach has no separate date-filter authority. */
  timeHorizon: 'all_time'
  rows: SourcePerformanceRow[]
  totals: SourcePerformanceTotals
}
