/**
 * serviceCashDate.ts — FORENSIC-KPI-2B2-1: canonical Service cash-by-date authority.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before 2B2-1 every FLOW report (Daily Target, weekly rollups, 52-Week, CFOT actual
 * Service income) bucketed Service cash by `serviceLog.date` — the scheduled/work date.
 * A payment received on 2026-08-12 for work performed on 2026-06-05 was credited to
 * June, not August. That is materially wrong for cash-flow reporting.
 *
 * 2B2-1 makes `payments[].receivedAt` the authoritative cash date for all Service FLOW
 * metrics, while keeping the `collected` compatibility cache as the single LIFETIME
 * figure that Header Paid / Money totals continue to consume.
 *
 * RULES
 * -----
 * 1. payments[] with a non-null receivedAt are dated cash. The date belongs to the
 *    receivedAt calendar day, not the service/work date.
 * 2. Signed amounts are preserved — future refunds naturally subtract from their own
 *    received period.
 * 3. Voided events contribute nothing.
 * 4. legacy_baseline events with receivedAt = null, and rows with no payments[] but a
 *    positive scalar `collected`, are genuinely unknown-date cash. They remain valid
 *    LIFETIME cash but are NOT assigned to any day/week/month.
 * 5. No double-counting: when payments[] exist, the scalar `collected` is ignored for
 *    period sums because it is only the compatibility cache.
 * 6. Malformed receivedAt strings do not silently fall back to the service date.
 *
 * Pure module: no React, no storage, no clock, no UI.
 */

import {
  getServicePaymentEvents,
  isLiveServicePaymentEvent,
  sumServicePayments,
  type ServicePaymentEvent,
} from './servicePaymentLedger'
import { num, round2 } from './serviceQuoteMath'

export interface ServiceCashEntry {
  serviceLogId: string
  paymentEventId: string
  amount: number
  receivedAt: string | null
}

export interface ServiceCashForRangeResult {
  /** Dated cash whose receivedAt falls inside [startInclusive, endExclusive). */
  knownDatedCash: number
  /** Cash whose actual received date is unknown (legacy baseline or scalar legacy rows). */
  unknownDateCash: number
  /** All legitimate cash on these rows, reconciled to the compatibility collected cache. */
  lifetimeCash: number
  /** Normalized dated entries for consumers that need to build their own buckets. */
  entries: ServiceCashEntry[]
}

function utcDateAtMidnight(dayKey: string): Date | null {
  if (!dayKey || typeof dayKey !== 'string' || dayKey.length < 8) return null
  const parsed = new Date(`${dayKey}T00:00:00.000Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseReceivedDate(receivedAt: unknown): Date | null {
  if (receivedAt === null || receivedAt === undefined) return null
  // receivedAt is stored as an owner-asserted calendar day (YYYY-MM-DD). Preserve
  // that local-day meaning by normalizing to UTC midnight.
  const dayKey =
    typeof receivedAt === 'string' ? receivedAt.trim().slice(0, 10) : String(receivedAt).slice(0, 10)
  return utcDateAtMidnight(dayKey)
}

function rowIdentity(row: any): string {
  if (!row || typeof row !== 'object') return ''
  return String(row.serviceLogId || row.id || row.service_call_id || '').trim()
}

/**
 * Canonical Service cash-by-date for a half-open date range.
 *
 * The caller owns the range policy (local-day vs UTC, inclusive/exclusive). This
 * function only decides whether a payment's receivedAt falls inside the supplied
 * boundaries.
 */
export function getServiceCashForRange(
  serviceLogs: any[] | null | undefined,
  startInclusive: Date,
  endExclusive: Date,
): ServiceCashForRangeResult {
  let knownDatedCash = 0
  let unknownDateCash = 0
  let lifetimeCash = 0
  const entries: ServiceCashEntry[] = []

  for (const log of serviceLogs ?? []) {
    if (!log || typeof log !== 'object') continue
    const rowId = rowIdentity(log)
    const events = getServicePaymentEvents(log)
    const hasLedger = events.length > 0

    if (hasLedger) {
      lifetimeCash += sumServicePayments(events)
      for (const event of events) {
        if (!isLiveServicePaymentEvent(event)) continue
        const amount = round2(num(event.amount))
        if (Math.abs(amount) <= 0.0001) continue

        const receivedAt = parseReceivedDate(event.receivedAt)
        if (receivedAt === null) {
          unknownDateCash += amount
          entries.push({
            serviceLogId: rowId,
            paymentEventId: event.id,
            amount,
            receivedAt: null,
          })
          continue
        }

        if (receivedAt >= startInclusive && receivedAt < endExclusive) {
          knownDatedCash += amount
          entries.push({
            serviceLogId: rowId,
            paymentEventId: event.id,
            amount,
            receivedAt: event.receivedAt as string,
          })
        }
      }
    } else {
      const scalarCollected = round2(Math.max(0, num(log.collected)))
      lifetimeCash += scalarCollected
      if (scalarCollected > 0.0001) {
        unknownDateCash += scalarCollected
        entries.push({
          serviceLogId: rowId,
          paymentEventId: `${rowId || 'unknown'}:legacy-scalar`,
          amount: scalarCollected,
          receivedAt: null,
        })
      }
    }
  }

  return {
    knownDatedCash: round2(knownDatedCash),
    unknownDateCash: round2(unknownDateCash),
    lifetimeCash: round2(lifetimeCash),
    entries,
  }
}

/**
 * Convenience rollup that exposes the three provenance buckets for an entire
 * BackupData snapshot. Useful for lifetime/unknown-date disclosures.
 */
export function getServiceCashSummary(serviceLogs: any[] | null | undefined): {
  knownDatedCash: number
  unknownDateCash: number
  lifetimeCash: number
} {
  // Use a maximally wide range so every dated event is counted as known.
  const start = new Date('1970-01-01T00:00:00.000Z')
  const end = new Date('2100-01-01T00:00:00.000Z')
  const result = getServiceCashForRange(serviceLogs, start, end)
  return {
    knownDatedCash: result.knownDatedCash,
    unknownDateCash: result.unknownDateCash,
    lifetimeCash: result.lifetimeCash,
  }
}
