/**
 * servicePaymentTruth.test.ts — FORENSIC-KPI-2B1 controlled-dollar contract.
 *
 * These are exact-dollar tests, not label tests. They pin the one rule the Service
 * payment model previously broke: workflow status may never manufacture or erase real
 * cash, and a payment's received date is never invented.
 */
import { describe, expect, it } from 'vitest'
import {
  buildServiceLogWithPayment,
  createServicePaymentLegacyBaseline,
  ensureServicePaymentLedger,
  deriveServicePayStatus,
  hasServicePaymentLedger,
  recordServicePayment,
  resolveServiceCollected,
  resolveServiceTotalBillable,
  sumServicePayments,
  type ServicePaymentEvent,
  type ServicePaymentRowLike,
} from '@/features/service-quote/servicePaymentLedger'
import { reconcileServicePayment } from '@/features/service-quote/servicePaymentStatus'
import { mapQBORowsToServiceLogs, mapToServiceLog, type QBExtractedData, type QBOParsedRow } from '@/services/quickbooksImportService'
import { mergeServiceLogsById } from '@/services/serviceScopeMerge'
import { getCanonicalKpiInputs, getKPIs, type BackupData } from '@/services/backupDataService'

/** Deterministic id/clock so assertions are exact. */
function seededWriter(prefix: string) {
  let n = 0
  return {
    makeId: () => `${prefix}-${++n}`,
    now: '2026-08-12T15:04:05.000Z',
  }
}

function serviceRow(overrides: Record<string, any> = {}): ServicePaymentRowLike {
  return {
    id: 'svc1',
    serviceLogId: 'svc1',
    customer: 'Test Customer',
    date: '2026-06-05',
    quoted: 500,
    collected: 0,
    payStatus: 'N',
    balanceDue: 500,
    hrs: 0, mat: 0, miles: 0, notes: '', store: '', jtype: 'Service',
    opCost: 0, profit: 0,
    ...overrides,
  }
}

describe('TEST 1 — Paid does not manufacture money', () => {
  it('leaves collected at 0 and refuses Paid while the full balance is outstanding', () => {
    const result = reconcileServicePayment('Y', 0, 500)

    expect(result.collected).toBe(0)
    expect(result.balanceDue).toBe(500)
    expect(result.blocked).toBe(true)
    expect(result.blockedReason).toBe('outstanding-balance')
    expect(result.requestedStatus).toBe('Y')
    // The stored status stays truthful rather than silently claiming settlement.
    expect(result.payStatus).toBe('N')
    expect(result.message).toContain('outstanding')
  })

  it('allows Paid once the money genuinely covers the amount due', () => {
    const result = reconcileServicePayment('Y', 500, 500)
    expect(result.blocked).toBe(false)
    expect(result.payStatus).toBe('Y')
    expect(result.collected).toBe(500)
    expect(result.balanceDue).toBe(0)
  })
})

describe('TEST 2 — Partial → Unpaid does not erase', () => {
  it('keeps the 200 and refuses the downgrade', () => {
    const result = reconcileServicePayment('N', 200, 500)

    expect(result.collected).toBe(200)
    expect(result.balanceDue).toBe(300)
    expect(result.blocked).toBe(true)
    expect(result.blockedReason).toBe('collected-would-be-erased')
    expect(result.payStatus).toBe('P')
  })

  it('leaves an existing payment ledger completely intact', () => {
    const seed = seededWriter('e')
    const paid = recordServicePayment(serviceRow(), {
      amount: 200, receivedAt: '2026-06-05', ...seed,
    })
    if (!paid.ok) throw new Error('setup failed')

    const result = reconcileServicePayment('N', paid.collected, resolveServiceTotalBillable(paid.row))
    expect(result.blocked).toBe(true)
    // The reconciler is money-blind by design: it never touches payments[].
    expect(paid.row.payments).toHaveLength(1)
    expect(sumServicePayments(paid.row.payments)).toBe(200)
  })

  it('still allows Unpaid when there is genuinely no money to protect', () => {
    const result = reconcileServicePayment('N', 0, 500)
    expect(result.blocked).toBe(false)
    expect(result.payStatus).toBe('N')
    expect(result.collected).toBe(0)
  })
})

describe('TEST 3 — real partial payment', () => {
  it('records one +200 event dated 2026-06-05 and derives Partial', () => {
    const seed = seededWriter('p')
    const result = recordServicePayment(serviceRow(), {
      amount: 200, receivedAt: '2026-06-05', ...seed,
    })
    if (!result.ok) throw new Error(result.message)

    expect(result.row.payments).toHaveLength(1)
    const event = result.row.payments![0]
    expect(event.amount).toBe(200)
    expect(event.receivedAt).toBe('2026-06-05')
    expect(event.kind).toBe('payment')
    // recordedAt is the write timestamp and is deliberately distinct from receivedAt.
    expect(event.recordedAt).toBe('2026-08-12T15:04:05.000Z')
    expect(event.recordedAt).not.toBe(event.receivedAt)

    expect(result.collected).toBe(200)
    expect(result.balanceDue).toBe(300)
    expect(result.payStatus).toBe('P')
    expect(result.baseline).toBeNull()
  })
})

describe('TEST 4 — second payment', () => {
  it('appends a distinct event and settles the balance', () => {
    const seed = seededWriter('q')
    const first = recordServicePayment(serviceRow(), {
      amount: 200, receivedAt: '2026-06-05', ...seed,
    })
    if (!first.ok) throw new Error(first.message)

    const second = recordServicePayment(first.row, {
      amount: 300, receivedAt: '2026-08-12', ...seed,
    })
    if (!second.ok) throw new Error(second.message)

    const events = second.row.payments!
    expect(events).toHaveLength(2)
    expect(new Set(events.map(e => e.id)).size).toBe(2)
    expect(events.map(e => e.amount)).toEqual([200, 300])
    expect(events.map(e => e.receivedAt)).toEqual(['2026-06-05', '2026-08-12'])

    expect(second.collected).toBe(500)
    expect(second.balanceDue).toBe(0)
    expect(second.payStatus).toBe('Y')
  })
})

describe('TEST 5 — legacy baseline', () => {
  const legacy = () => serviceRow({ collected: 200, payStatus: 'P', balanceDue: 300 })

  it('preserves the legacy amount exactly once and never invents its date', () => {
    const seed = seededWriter('l')
    const result = recordServicePayment(legacy(), {
      amount: 300, receivedAt: '2026-08-12', ...seed,
    })
    if (!result.ok) throw new Error(result.message)

    const events = result.row.payments!
    expect(events).toHaveLength(2)

    const baseline = events[0]
    expect(baseline.kind).toBe('legacy_baseline')
    expect(baseline.amount).toBe(200)
    // The critical assertion: the unknown date stays unknown. No service-date backfill.
    expect(baseline.receivedAt).toBeNull()
    expect(baseline.receivedAt).not.toBe('2026-06-05')

    expect(events[1].kind).toBe('payment')
    expect(events[1].amount).toBe(300)
    expect(events[1].receivedAt).toBe('2026-08-12')

    expect(result.collected).toBe(500)
    expect(result.baseline).not.toBeNull()
  })

  it('never mints a second baseline on a later payment', () => {
    const seed = seededWriter('l2')
    const first = recordServicePayment(legacy(), { amount: 300, receivedAt: '2026-08-12', ...seed })
    if (!first.ok) throw new Error(first.message)

    const second = recordServicePayment(first.row, { amount: 100, receivedAt: '2026-09-01', ...seed })
    if (!second.ok) throw new Error(second.message)

    const baselines = second.row.payments!.filter(e => e.kind === 'legacy_baseline')
    expect(baselines).toHaveLength(1)
    expect(second.row.payments).toHaveLength(3)
    expect(second.collected).toBe(600)
    expect(second.baseline).toBeNull()
  })

  it('is idempotent when the ledger is re-ensured (no double-count)', () => {
    const seed = seededWriter('l3')
    const first = ensureServicePaymentLedger(legacy(), seed)
    expect(first.events).toHaveLength(1)
    expect(sumServicePayments(first.events)).toBe(200)

    const again = ensureServicePaymentLedger({ ...legacy(), payments: first.events }, seed)
    expect(again.events).toHaveLength(1)
    expect(again.baseline).toBeNull()
    expect(sumServicePayments(again.events)).toBe(200)
  })

  it('creates no baseline for a legacy row that never collected anything', () => {
    const result = ensureServicePaymentLedger(serviceRow({ collected: 0 }), seededWriter('l4'))
    expect(result.events).toHaveLength(0)
    expect(result.baseline).toBeNull()
  })
})

describe('TEST 6 — status resave does not mutate cash', () => {
  it('leaves 480 alone through a Paid resave and through a Partial resave', () => {
    const asPaid = reconcileServicePayment('Y', 480, 500)
    expect(asPaid.collected).toBe(480)
    expect(asPaid.blocked).toBe(true)
    expect(asPaid.balanceDue).toBe(20)

    const asPartial = reconcileServicePayment('P', 480, 500)
    expect(asPartial.collected).toBe(480)
    expect(asPartial.blocked).toBe(false)
    expect(asPartial.payStatus).toBe('P')
  })

  it('does not top the ledger up to the amount due', () => {
    const seed = seededWriter('r')
    const paid = recordServicePayment(serviceRow(), { amount: 480, receivedAt: '2026-06-05', ...seed })
    if (!paid.ok) throw new Error(paid.message)
    expect(paid.collected).toBe(480)
    expect(paid.payStatus).toBe('P')
    expect(resolveServiceCollected(paid.row)).toBe(480)
  })
})

describe('TEST 7 — Total Billable authority', () => {
  const row = serviceRow({
    quoted: 500,
    adjustments: [{ id: 'adj1', type: 'income', category: 'income', amount: 100, desc: 'Added scope', date: '2026-06-05' }],
  })

  it('treats quoted + income adjustments as the amount due', () => {
    expect(resolveServiceTotalBillable(row)).toBe(600)
    // Total Quoted itself is never rewritten to make a status fit.
    expect(row.quoted).toBe(500)
  })

  it('does not consider 580 fully settled against 600', () => {
    expect(deriveServicePayStatus(580, 600)).toBe('P')
    const result = reconcileServicePayment('Y', 580, resolveServiceTotalBillable(row))
    expect(result.blocked).toBe(true)
    expect(result.balanceDue).toBe(20)
    expect(result.payStatus).toBe('P')
  })

  it('considers 600 Paid and leaves Total Quoted at 500', () => {
    const result = reconcileServicePayment('Y', 600, resolveServiceTotalBillable(row))
    expect(result.blocked).toBe(false)
    expect(result.payStatus).toBe('Y')
    expect(result.balanceDue).toBe(0)
    expect(row.quoted).toBe(500)
  })
})

describe('TEST 8 — event merge', () => {
  const baseEvent = (id: string, amount: number, receivedAt: string): ServicePaymentEvent => ({
    id, amount, receivedAt, recordedAt: `2026-08-12T0${amount === 200 ? 1 : 2}:00:00.000Z`,
    kind: 'payment', voidedAt: null,
  })

  const deviceA = () => serviceRow({
    collected: 200, payStatus: 'P', balanceDue: 300,
    updatedAt: '2026-08-12T01:00:00.000Z',
    payments: [baseEvent('pay-a', 200, '2026-06-05')],
  })
  const deviceB = () => serviceRow({
    collected: 300, payStatus: 'P', balanceDue: 200,
    updatedAt: '2026-08-12T02:00:00.000Z',
    payments: [baseEvent('pay-b', 300, '2026-08-12')],
  })

  it('keeps both independently-created events exactly once', () => {
    const merged = mergeServiceLogsById([deviceA()], [deviceB()])
    expect(merged).toHaveLength(1)
    const events = merged[0].payments as ServicePaymentEvent[]
    expect(events).toHaveLength(2)
    expect(events.map(e => e.id).sort()).toEqual(['pay-a', 'pay-b'])
  })

  it('re-derives the collected cache from the union so neither device is lost', () => {
    const merged = mergeServiceLogsById([deviceA()], [deviceB()])
    expect(merged[0].collected).toBe(500)
    expect(merged[0].balanceDue).toBe(0)
    expect(merged[0].payStatus).toBe('Y')
  })

  it('is idempotent under re-merge', () => {
    const once = mergeServiceLogsById([deviceA()], [deviceB()])
    const twice = mergeServiceLogsById(once, [deviceB()])
    const thrice = mergeServiceLogsById(twice, once)
    expect((thrice[0].payments as ServicePaymentEvent[])).toHaveLength(2)
    expect(thrice[0].collected).toBe(500)
  })

  it('never loses a void through merge order', () => {
    const voided = serviceRow({
      updatedAt: '2026-08-12T00:00:00.000Z',
      payments: [{ ...baseEvent('pay-a', 200, '2026-06-05'), voidedAt: '2026-08-13T00:00:00.000Z' }],
    })
    // The un-voided copy is the LWW winner; the void must still survive.
    const merged = mergeServiceLogsById([voided], [deviceA()])
    const events = merged[0].payments as ServicePaymentEvent[]
    expect(events).toHaveLength(1)
    expect(events[0].voidedAt).toBe('2026-08-13T00:00:00.000Z')
    expect(merged[0].collected).toBe(0)
  })

  it('does not collapse two genuine same-day, same-amount payments', () => {
    const twoIdenticalAmounts = serviceRow({
      payments: [
        baseEvent('pay-1', 300, '2026-08-12'),
        { ...baseEvent('pay-2', 300, '2026-08-12'), recordedAt: '2026-08-12T03:00:00.000Z' },
      ],
    })
    const merged = mergeServiceLogsById([twoIdenticalAmounts], [twoIdenticalAmounts])
    expect((merged[0].payments as ServicePaymentEvent[])).toHaveLength(2)
    expect(merged[0].collected).toBe(600)
  })
})

describe('TEST 9 — money readers remain compatible', () => {
  function backupWith(row: any): BackupData {
    return {
      projects: [], logs: [], serviceLogs: [row], priceBook: [], weeklyData: [],
      triggerRules: [], calcRefs: {}, customers: [], settings: {} as any, employees: [],
      templates: [], gcContacts: [], serviceLeads: [], agendaSections: [],
      completedArchive: [], projectDashboards: {}, blueprintSummaries: {},
      activeServiceCalls: [], serviceEstimates: [], taskSchedule: [], dailyJobs: [],
      weeklyReviews: [], _lastSavedAt: '', _schemaVersion: 0,
    } as unknown as BackupData
  }

  it('keeps getKPIs / canonical collected reading the same cumulative amount', () => {
    const seed = seededWriter('k')
    const first = recordServicePayment(serviceRow(), { amount: 200, receivedAt: '2026-06-05', ...seed })
    if (!first.ok) throw new Error(first.message)
    const second = recordServicePayment(first.row, { amount: 300, receivedAt: '2026-08-12', ...seed })
    if (!second.ok) throw new Error(second.message)

    const backup = backupWith(second.row)
    expect(getCanonicalKpiInputs(backup).serviceCollected).toBe(500)
    expect(getKPIs(backup).paid).toBe(500)
    // The scalar cache is what those readers consume — it must equal the ledger.
    expect((backup.serviceLogs[0] as any).collected).toBe(500)
    expect(sumServicePayments(second.row.payments)).toBe(500)
  })

  it('leaves an untouched legacy row reading exactly as before', () => {
    const backup = backupWith(serviceRow({ collected: 200, payStatus: 'P', balanceDue: 300 }))
    expect(hasServicePaymentLedger(backup.serviceLogs[0])).toBe(false)
    expect(getCanonicalKpiInputs(backup).serviceCollected).toBe(200)
    expect(resolveServiceCollected(backup.serviceLogs[0])).toBe(200)
  })
})

describe('writer guards', () => {
  it('rejects a zero amount rather than writing an empty event', () => {
    const result = recordServicePayment(serviceRow(), { amount: 0, receivedAt: '2026-08-12' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.reason).toBe('invalid-amount')
  })

  it('is structurally capable of a signed refund event (no owner workflow in 2B1)', () => {
    const seed = seededWriter('rf')
    const paid = recordServicePayment(serviceRow(), { amount: 500, receivedAt: '2026-06-05', ...seed })
    if (!paid.ok) throw new Error(paid.message)

    const refunded = recordServicePayment(paid.row, { amount: -100, receivedAt: '2026-09-01', ...seed })
    if (!refunded.ok) throw new Error(refunded.message)

    expect(refunded.row.payments![1].kind).toBe('refund')
    expect(refunded.collected).toBe(400)
    expect(refunded.payStatus).toBe('P')
    expect(refunded.balanceDue).toBe(100)
  })
})

// ── FORENSIC-KPI-2B1B controlled tests A–H: close Service payment writer bypasses ──

describe('TEST A — new service call payment creates a real event', () => {
  it('builds a row whose first cash is a payment event with an owner date', () => {
    const seed = seededWriter('a')
    const result = buildServiceLogWithPayment(serviceRow(), {
      amount: 300,
      receivedAt: '2026-06-10',
      ...seed,
    })
    if (!result.ok) throw new Error(result.message)

    const events = result.row.payments!
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('payment')
    expect(events[0].amount).toBe(300)
    expect(events[0].receivedAt).toBe('2026-06-10')
    expect(events[0].recordedAt).toBe(seed.now)

    expect(result.collected).toBe(300)
    expect(result.balanceDue).toBe(200)
    expect(result.payStatus).toBe('P')
    expect((result.row as any).collected).toBe(300)
  })
})

describe('TEST B — no received date is ever fabricated', () => {
  it('rejects a new-service-call payment without a received date', () => {
    const result = buildServiceLogWithPayment(serviceRow(), {
      amount: 300,
      receivedAt: '',
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected rejection')
    expect(result.reason).toBe('invalid-amount')
  })

  it('keeps legacy baseline receivedAt null, never back-filled', () => {
    const row = serviceRow({ collected: 200, payStatus: 'P', balanceDue: 300 })
    const baseline = createServicePaymentLegacyBaseline(row, seededWriter('b'))
    expect(baseline).not.toBeNull()
    expect(baseline!.receivedAt).toBeNull()
    expect(baseline!.receivedAt).not.toBe(row.date)
  })
})

describe('TEST C — legacy edit keeps scalar collected read-only', () => {
  it('resolves the legacy amount without a ledger and never mints an event on edit', () => {
    const row = serviceRow({ collected: 200, payStatus: 'P', balanceDue: 300 })
    expect(hasServicePaymentLedger(row)).toBe(false)
    expect(resolveServiceCollected(row)).toBe(200)
    // Re-saving the row as-is (no new money entered) leaves it legacy: no payments.
    const rebuilt = { ...row }
    expect(hasServicePaymentLedger(rebuilt)).toBe(false)
    expect(resolveServiceCollected(rebuilt)).toBe(200)
    expect(rebuilt.payments).toBeUndefined()
  })
})

describe('TEST D — legacy row + new payment = baseline + payment', () => {
  it('preserves the legacy scalar as a baseline before appending the new payment', () => {
    const seed = seededWriter('d')
    const legacy = serviceRow({ collected: 200, payStatus: 'P', balanceDue: 300 })
    const result = recordServicePayment(legacy, {
      amount: 300,
      receivedAt: '2026-08-12',
      ...seed,
    })
    if (!result.ok) throw new Error(result.message)

    const events = result.row.payments!
    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe('legacy_baseline')
    expect(events[0].amount).toBe(200)
    expect(events[0].receivedAt).toBeNull()
    expect(events[1].kind).toBe('payment')
    expect(events[1].amount).toBe(300)
    expect(events[1].receivedAt).toBe('2026-08-12')

    expect(result.collected).toBe(500)
    expect(result.payStatus).toBe('Y')
  })
})

describe('TEST E — completion payments are ledgerized', () => {
  it('treats owner-entered cash at completion as a payment event with a received date', () => {
    const seed = seededWriter('e')
    const result = buildServiceLogWithPayment(serviceRow({ quoted: 600 }), {
      amount: 600,
      receivedAt: '2026-07-15',
      ...seed,
    })
    if (!result.ok) throw new Error(result.message)

    expect(result.row.payments).toHaveLength(1)
    expect(result.row.payments![0].kind).toBe('payment')
    expect(result.row.payments![0].receivedAt).toBe('2026-07-15')
    expect(result.collected).toBe(600)
    expect(result.payStatus).toBe('Y')
  })

  it('keeps the Payment Status selector workflow-only: a contradictory choice is refused', () => {
    // 200 collected against 500 total billable. Owner selects Paid.
    const reconcile = reconcileServicePayment('Y', 200, 500)
    expect(reconcile.blocked).toBe(true)
    expect(reconcile.blockedReason).toBe('outstanding-balance')
    expect(reconcile.collected).toBe(200)
    expect(reconcile.payStatus).toBe('P')

    // Same 200 collected. Owner selects Unpaid.
    const unpaid = reconcileServicePayment('N', 200, 500)
    expect(unpaid.blocked).toBe(true)
    expect(unpaid.blockedReason).toBe('collected-would-be-erased')
    expect(unpaid.collected).toBe(200)
    expect(unpaid.payStatus).toBe('P')
  })
})

describe('TEST F — QuickBooks import never invents a payment date', () => {
  const qboRow = (): QBOParsedRow => ({
    customer: 'Acme Inc',
    invoiceNumber: 'INV-1234',
    invoiceDate: '2026-05-20',
    dueDate: '2026-06-20',
    amount: 1000,
    balance: 0,
    status: 'Paid',
    transactionType: 'Invoice',
    memo: 'Panel upgrade',
  })

  it('creates a legacy_baseline event with receivedAt = null', () => {
    const logs = mapQBORowsToServiceLogs([qboRow()])
    expect(logs).toHaveLength(1)
    const log = logs[0] as any
    expect(log.payments).toHaveLength(1)
    expect(log.payments[0].kind).toBe('legacy_baseline')
    expect(log.payments[0].amount).toBe(1000)
    expect(log.payments[0].receivedAt).toBeNull()
    expect(log.payments[0].receivedAt).not.toBe(qboRow().invoiceDate)
    expect(log.collected).toBe(1000)
    expect(log.payStatus).toBe('Y')
  })

  it('anchors the baseline event id to the created service row only', () => {
    // FORENSIC-KPI-2B1C: cross-import deduplication is an existing limitation of the
    // QuickBooks importer. The payment event id must only be stable within the row
    // that is created from a single import.
    const log = mapQBORowsToServiceLogs([qboRow()])[0] as any
    expect(log.payments[0].id).toBe(`${log.id}:baseline`)
  })

  it('ledgerizes PDF import the same way', () => {
    const data: QBExtractedData = {
      documentType: 'invoice',
      entityName: 'Power On Solutions LLC',
      customerName: 'Acme Inc',
      customerAddress: '123 Main St',
      date: '2026-05-20',
      dueDate: '2026-06-20',
      totalAmount: 500,
      balanceDue: 100,
      paymentStatus: 'partial',
      lineItems: [{ description: 'Service call', amount: 500 }],
      jobType: 'Panel/Service',
      notes: 'Thanks!',
      isMultiBuilding: false,
    }
    const log = mapToServiceLog(data) as any
    expect(log.payments).toHaveLength(1)
    expect(log.payments[0].kind).toBe('legacy_baseline')
    expect(log.payments[0].amount).toBe(400)
    expect(log.payments[0].receivedAt).toBeNull()
    expect(log.collected).toBe(400)
    expect(log.balanceDue).toBe(100)
    expect(log.payStatus).toBe('P')
  })
})

describe('TEST G — collected cache invariant', () => {
  it('keeps the scalar collected equal to the ledger sum after every write', () => {
    const seed = seededWriter('g')
    const first = recordServicePayment(serviceRow(), { amount: 100, receivedAt: '2026-06-01', ...seed })
    if (!first.ok) throw new Error(first.message)
    expect(first.row.collected).toBe(sumServicePayments(first.row.payments))

    const second = recordServicePayment(first.row, { amount: 150, receivedAt: '2026-06-15', ...seed })
    if (!second.ok) throw new Error(second.message)
    expect(second.row.collected).toBe(sumServicePayments(second.row.payments))
    expect(second.row.collected).toBe(250)

    const built = buildServiceLogWithPayment(serviceRow(), {
      amount: 500,
      receivedAt: '2026-08-01',
      ...seed,
    })
    if (!built.ok) throw new Error(built.message)
    expect(built.row.collected).toBe(sumServicePayments(built.row.payments))
  })
})

describe('TEST H — workflow status is independent of cash', () => {
  it('does not let the status select manufacture or erase money', () => {
    const asPaid = reconcileServicePayment('Y', 0, 500)
    expect(asPaid.collected).toBe(0)
    expect(asPaid.blocked).toBe(true)

    const asUnpaid = reconcileServicePayment('N', 300, 500)
    expect(asUnpaid.collected).toBe(300)
    expect(asUnpaid.blocked).toBe(true)
  })

  it('derives status strictly from money', () => {
    expect(deriveServicePayStatus(0, 500)).toBe('N')
    expect(deriveServicePayStatus(250, 500)).toBe('P')
    expect(deriveServicePayStatus(500, 500)).toBe('Y')
    // Overpayment is real money and stays recorded as Paid.
    expect(deriveServicePayStatus(600, 500)).toBe('Y')
  })
})
