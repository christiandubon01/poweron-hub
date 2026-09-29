import type { BackupData } from '@/services/backupDataService'
import {
  getServicePaymentEvents,
  hasServicePaymentLedger,
  isLiveServicePaymentEvent,
  resolveServiceCollected,
} from '@/features/service-quote/servicePaymentLedger'
import {
  dollarsToMinor,
  usd,
  type ActualCashEvent,
  type FinanceAdapterScope,
} from '../domain'

function serviceRows(backup: BackupData): any[] {
  return Array.isArray((backup as any).serviceLogs) ? (backup as any).serviceLogs : []
}

export function readServiceCollectionEvents(
  scope: FinanceAdapterScope,
  backup: BackupData,
): ActualCashEvent[] {
  const events: ActualCashEvent[] = []

  for (const row of serviceRows(backup)) {
    const rowId = String(row?.id || row?.serviceLogId || '').trim()
    if (!rowId || row?.deletedAt) continue

    if (hasServicePaymentLedger(row)) {
      for (const payment of getServicePaymentEvents(row)) {
        if (!isLiveServicePaymentEvent(payment) || payment.amount <= 0 || !payment.receivedAt) continue
        events.push({
          id: `service-payment:${rowId}:${payment.id}`,
          organizationId: scope.organizationId,
          date: payment.receivedAt.slice(0, 10),
          direction: 'inflow',
          amount: usd(dollarsToMinor(payment.amount)),
          meaning: 'actual_cash_inflow',
          attribution: { category: 'service_collection' },
          provenance: {
            source: {
              organizationId: scope.organizationId,
              kind: 'service_collection',
              recordId: `${rowId}:${payment.id}`,
              effectiveDate: payment.receivedAt.slice(0, 10),
              timestamp: payment.recordedAt,
            },
            freshness: 'current',
            confidence: 'confirmed',
            reconciliationState: 'unreconciled',
          },
        })
      }
      continue
    }

    const legacy = resolveServiceCollected(row)
    if (legacy <= 0) continue
    events.push({
      id: `service-legacy:${rowId}`,
      organizationId: scope.organizationId,
      date: String(row?.date || row?.completedAt || '').slice(0, 10) || 'unknown',
      direction: 'inflow',
      amount: usd(dollarsToMinor(legacy)),
      meaning: 'actual_cash_inflow',
      attribution: { category: 'service_collection' },
      provenance: {
        source: {
          organizationId: scope.organizationId,
          kind: 'service_collection',
          recordId: rowId,
          effectiveDate: null,
        },
        freshness: 'unknown',
        confidence: 'confirmed',
        reconciliationState: 'unreconciled',
        note: 'Legacy scalar collected fallback. Received date is not treated as known truth.',
      },
    })
  }

  return events
}
