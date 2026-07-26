import type { WireProfileQuantityTotal, WireQuantityContribution } from './types'

export function formatWireLength(value: number | null, unit: string | null | undefined): string {
  if (value == null || !Number.isFinite(value) || !unit) return 'Not configured'
  return `${value.toFixed(2)} ${unit}`
}

export function formatWastePercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'Not configured'
  return `${value.toFixed(2).replace(/\.00$/, '')}%`
}

export function formatTotalRow(total: WireProfileQuantityTotal) {
  return {
    name: total.displayName,
    measured: formatWireLength(total.measuredLength, total.unit),
    wastePercent: formatWastePercent(total.wastePercent),
    wasteLength: formatWireLength(total.wasteLength, total.unit),
    purchaseLength: formatWireLength(total.purchaseLength, total.unit),
  }
}

export function describeContributionKind(contribution: WireQuantityContribution): string {
  return contribution.shapeKind === 'circuit-arc' ? 'Circuit Arc' : 'Circuit Path'
}
