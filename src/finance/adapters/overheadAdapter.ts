import { dollarsToMinor, usd, type FinanceAdapterScope, type FinancialProvenance } from '../domain'

export interface OverheadAssumptionRow {
  bucket: 'essential' | 'extra' | 'loans' | 'vehicle'
  id: string
  name: string
  monthly: number
}

export interface OverheadAssumptionEvent {
  id: string
  organizationId: string
  name: string
  bucket: OverheadAssumptionRow['bucket']
  monthlyAmount: ReturnType<typeof usd>
  provenance: FinancialProvenance
}

export function previewOverheadAssumptions(
  scope: FinanceAdapterScope,
  overhead: Record<string, Array<{ id?: unknown; name?: unknown; monthly?: unknown }>> | null | undefined,
): OverheadAssumptionEvent[] {
  const events: OverheadAssumptionEvent[] = []
  for (const bucket of ['essential', 'extra', 'loans', 'vehicle'] as const) {
    const rows = Array.isArray(overhead?.[bucket]) ? overhead![bucket] : []
    rows.forEach((row, index) => {
      const monthly = Number(row?.monthly)
      if (!Number.isFinite(monthly) || monthly <= 0) return
      const recordId = String(row?.id || `${bucket}-${index}`)
      events.push({
        id: `overhead-assumption:${recordId}`,
        organizationId: scope.organizationId,
        name: String(row?.name || 'Overhead'),
        bucket,
        monthlyAmount: usd(dollarsToMinor(monthly)),
        provenance: {
          source: {
            organizationId: scope.organizationId,
            kind: 'overhead_assumption',
            recordId,
          },
          freshness: 'current',
          confidence: 'expected',
          reconciliationState: 'unreconciled',
          note: 'Planning assumption only. Never auto-materialize as a bank transaction or obligation.',
        },
      })
    })
  }
  return events
}
