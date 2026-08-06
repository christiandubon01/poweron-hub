/**
 * SALES-CONVERSION-1 — Receipt filtering, ordering, and source summary.
 *
 * Pure functions only. Filter option lists are built from the actual receipt
 * rows, never from a hard-coded source enum, so a new feed shows up the moment
 * its first conversion lands.
 */

import type {
  ConversionReceipt,
  ConversionReceiptFilters,
  ConversionSourceSummaryRow,
} from './conversionReceiptTypes'
import { formatSourceLabel, sourceSummaryKey } from './conversionReceiptSource'

/** Newest conversion first. Falls back to createdAt when converted_at ties. */
export function sortReceiptsNewestFirst(receipts: ConversionReceipt[]): ConversionReceipt[] {
  return [...receipts].sort((a, b) => {
    const at = Date.parse(a.convertedAt) || Date.parse(a.createdAt) || 0
    const bt = Date.parse(b.convertedAt) || Date.parse(b.createdAt) || 0
    return bt - at
  })
}

function matchesSearch(receipt: ConversionReceipt, search: string): boolean {
  const term = search.trim().toLowerCase()
  if (!term) return true
  const haystack = [
    receipt.leadName,
    receipt.leadCompany,
    receipt.leadContactName,
    receipt.destinationLabel,
    receipt.receiptNumber,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.includes(term)
}

export function filterReceipts(
  receipts: ConversionReceipt[],
  filters: ConversionReceiptFilters
): ConversionReceipt[] {
  return receipts.filter((receipt) => {
    if (!matchesSearch(receipt, filters.search)) return false
    if (filters.sourceFamily && receipt.sourceFamily !== filters.sourceFamily) return false
    if (filters.sourceDetail && (receipt.sourceDetail ?? '') !== filters.sourceDetail) return false
    if (filters.destinationType !== 'all' && receipt.destinationType !== filters.destinationType) {
      return false
    }
    return true
  })
}

/** Distinct source families present in the data, alphabetically. */
export function availableSourceFamilies(receipts: ConversionReceipt[]): string[] {
  return [...new Set(receipts.map((r) => r.sourceFamily))].sort((a, b) => a.localeCompare(b))
}

/**
 * Distinct source details present in the data. When a family is selected the
 * list narrows to that family's details, so the two filters stay coherent.
 */
export function availableSourceDetails(
  receipts: ConversionReceipt[],
  family: string | null
): string[] {
  const scoped = family ? receipts.filter((r) => r.sourceFamily === family) : receipts
  return [...new Set(scoped.map((r) => r.sourceDetail).filter((d): d is string => Boolean(d)))].sort(
    (a, b) => a.localeCompare(b)
  )
}

/**
 * Per-source rollup. Conversion counts and dollar totals are kept in separate
 * fields and are never added together; `convertedValueCount` tells the UI how
 * many receipts actually carried a canonical amount.
 */
export function summarizeBySource(receipts: ConversionReceipt[]): ConversionSourceSummaryRow[] {
  const rows = new Map<string, ConversionSourceSummaryRow>()

  for (const receipt of receipts) {
    const key = sourceSummaryKey(receipt.sourceFamily, receipt.sourceDetail)
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        family: receipt.sourceFamily,
        detail: receipt.sourceDetail,
        label: formatSourceLabel(receipt.sourceFamily, receipt.sourceDetail),
        conversions: 0,
        projectConversions: 0,
        serviceCallConversions: 0,
        convertedValueTotal: 0,
        convertedValueCount: 0,
      }
      rows.set(key, row)
    }
    row.conversions += 1
    if (receipt.destinationType === 'project') row.projectConversions += 1
    else row.serviceCallConversions += 1
    if (typeof receipt.convertedValue === 'number' && Number.isFinite(receipt.convertedValue)) {
      row.convertedValueTotal += receipt.convertedValue
      row.convertedValueCount += 1
    }
  }

  return [...rows.values()].sort(
    (a, b) => b.conversions - a.conversions || a.label.localeCompare(b.label)
  )
}
