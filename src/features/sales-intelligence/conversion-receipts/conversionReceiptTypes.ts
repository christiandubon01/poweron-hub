/**
 * SALES-CONVERSION-1 — Conversion receipt data model.
 *
 * A conversion receipt is a durable, append-only ticket proving that a
 * Sales Intelligence lead produced a real destination record (a Project or a
 * Service Call). It is a historical snapshot: it must stay readable after the
 * originating hunter_lead is edited, archived, or deleted.
 *
 * Backing table: public.hunter_conversion_receipts (migration 116).
 */

/** The two destinations a Pipeline lead can convert into. */
export type ConversionDestinationType = 'project' | 'service_call'

/**
 * Normalized acquisition source. Channel (family) and location/feed (detail)
 * are deliberately kept apart so "TLMA / Indio" never collapses into one
 * ambiguous string.
 */
export interface ConversionSource {
  /** Channel the lead was acquired through, e.g. 'TLMA', 'Customer Portal'. */
  family: string
  /** Feed / city / form within the family, e.g. 'Indio'. Null when unknown. */
  detail: string | null
  /** The untouched source value(s) the derivation read. Never displayed raw. */
  raw: string | null
}

/** A persisted receipt row, camelCased for the UI layer. */
export interface ConversionReceipt {
  id: string
  receiptNumber: string | null
  tenantId: string
  /** Null once the originating lead row is deleted — the snapshot survives. */
  leadId: string | null
  leadName: string
  leadCompany: string | null
  leadContactName: string | null
  sourceFamily: string
  sourceDetail: string | null
  sourceRaw: string | null
  destinationType: ConversionDestinationType
  destinationId: string
  destinationLabel: string | null
  leadEstimatedValue: number | null
  /** Only set when the destination exposes a canonical converted value. */
  convertedValue: number | null
  leadScoreAtConversion: number | null
  leadStatusBefore: string | null
  convertedAt: string
  convertedBy: string | null
  convertedByName: string | null
  createdAt: string
}

/** Everything the caller must supply to mint a receipt. */
export interface ConversionReceiptDraft {
  tenantId: string
  leadId: string
  leadName: string
  leadCompany?: string | null
  leadContactName?: string | null
  source: ConversionSource
  destinationType: ConversionDestinationType
  destinationId: string
  destinationLabel?: string | null
  leadEstimatedValue?: number | null
  convertedValue?: number | null
  leadScoreAtConversion?: number | null
  leadStatusBefore?: string | null
  convertedBy?: string | null
  convertedByName?: string | null
}

/**
 * Result of a persistence attempt. `created: false` with an `receipt` means the
 * idempotency key already had a row — a retry, double-click, or rerender.
 */
export interface ConversionReceiptResult {
  ok: boolean
  created: boolean
  receipt: ConversionReceipt | null
  error: string | null
}

/** UI filter state for the Conversion Receipts ledger. */
export interface ConversionReceiptFilters {
  search: string
  sourceFamily: string | null
  sourceDetail: string | null
  destinationType: ConversionDestinationType | 'all'
}

/** One row of the compact per-source summary. */
export interface ConversionSourceSummaryRow {
  key: string
  family: string
  detail: string | null
  label: string
  /** Count of receipts — never mixed with dollars. */
  conversions: number
  projectConversions: number
  serviceCallConversions: number
  /** Sum of convertedValue over receipts that actually have one. */
  convertedValueTotal: number
  /** How many receipts contributed to convertedValueTotal. */
  convertedValueCount: number
}

export const DEFAULT_RECEIPT_FILTERS: ConversionReceiptFilters = {
  search: '',
  sourceFamily: null,
  sourceDetail: null,
  destinationType: 'all',
}

/** The table these receipts live in. Single source of truth for the name. */
export const CONVERSION_RECEIPTS_TABLE = 'hunter_conversion_receipts'
