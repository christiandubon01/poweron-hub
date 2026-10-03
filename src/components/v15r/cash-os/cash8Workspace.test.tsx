import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import CashOsOutlook, { CashCollectionClock, CashDayDetail, CashUpcomingEvents } from './CashOsOutlook'
import { CashCalendarView, CashPayrollView, CashTransactionsView, CashObligationsView } from './CashOsViews'

const day = { date: '2026-09-29', openingCashMinor: 10000, inflowMinor: 200,
  outflowMinor: 100, closingCashMinor: 10100, totalProtectedRequirementMinor: 2000,
  protectedCashMinor: 2000, trulyFreeCashMinor: 8100, protectionDeficitMinor: 0,
  operatingFloorMinor: 1000, events: [], markers: [],
  uncertainty: { highestIncludedConfidence: null, includedExpectedEventCount: 0,
    includedPossibleEventCount: 0, unresolvedMarkerCount: 0, unresolvedSourceKeys: [] } }
const event = { id: 'event1', sourceKey: 'org:cash_commitment:c1', organizationId: 'org',
  date: '2026-09-30', direction: 'outflow', amountMinor: 300, confidence: 'confirmed',
  requirement: 'required', sourceType: 'cash_commitment', category: 'materials',
  attribution: { projectId: 'p1' }, label: 'Materials', movementBasis: 'cash_commitment' }
const marker = { sourceKey: 'org:payroll:1', organizationId: 'org', date: null,
  amountMinor: 500, reason: 'unknown_payment_date', semanticCode: 'payment_timing_unknown',
  label: 'Payroll', category: 'payroll', attribution: {} }
const project = { projectId: 'p1', projectName: 'First project', group: 'active_funding',
  riskState: 'coverage_unknown', coverageStatus: 'indeterminate', nextCollection: null,
  requiredCosts: [], requiredBeforeCollectionMinor: null, reservedForRequiredCostsMinor: null,
  fundingGapMinor: null, unattributedRequiredMinor: 0, diagnostics: [], sortReasons: [] }

function snapshot(): CashOsSnapshot {
  return { organizationId: 'org', asOfDate: '2026-09-29', asOfTimestamp: '2026-09-29T20:00:00Z',
    setup: { version: 1, organizationId: 'org', payrollPaidThroughDate: '2026-09-28',
      protectionHorizonDays: 7, operatingFloorMinor: 1000, taxReserve: { kind: 'disabled' },
      includeOptionalObligations: false, includeOpenShiftEstimates: false,
      timezoneConfirmed: true, confirmedAt: '2026-09-29T20:00:00Z' },
    allocation: {} as any, payroll: { liabilities: [], diagnostics: [] }, payrollDiagnostics: [],
    payrollAllocations: [], payrollExposureMinor: 0, accountBalancesMinor: { bank: 10100 },
    collectionClock: { activeFunding: [project as any], collectionFollowUp: [],
      unattributedPayrollMinor: 0, diagnostics: [] },
    projection: { organizationId: 'org', asOfDate: '2026-09-29', horizonDays: 7,
      confidenceMode: 'conservative', anchor: day, days: [{ ...day, date: '2026-09-30' }],
      summary: { lowestTotalCashMinor: 10100, lowestTotalCashDate: '2026-09-29',
        lowestTrulyFreeCashMinor: 8100, lowestTrulyFreeCashDate: '2026-09-29',
        firstProtectionDeficitDate: null, fourteenDayLowestTotalCashMinor: 9500,
        fourteenDayLowestTotalCashDate: '2026-10-01', daysCovered: { days: 7, bounded: true } },
      datedEvents: [event as any], datedMarkers: [], undatedMarkers: [marker as any], diagnostics: [] },
    accounts: [{ id: 'bank', display_name: 'Bank', status: 'active', include_in_cash: true, account_type: 'checking' } as any],
    transactions: [{ id: 't1', transaction_date: '2026-09-29', description: 'Opening', amount_minor: 10100,
      category: 'income', project_id: null } as any],
    obligations: [{ id: 'o1', name: 'Rent', amount: { minor: 400 }, recurrence: { kind: 'monthly', startDate: '2026-10-01' },
      requirement: 'required', confidence: 'confirmed', status: 'active' } as any],
    occurrences: [], commitments: [{ id: 'c1', title: 'Materials', amount: { minor: 300 },
      expectedDate: '2026-09-30', requirement: 'required', confidence: 'confirmed', status: 'scheduled' } as any],
    timeEntries: [], sessions: [], bridges: [], employees: [],
    backup: {} as any, readinessDiagnostics: [], liabilityTerms: [],
  }
}

function outlook(s = snapshot()) {
  return renderToStaticMarkup(<CashOsOutlook snapshot={s} horizonDays={7} confidenceMode="conservative"
    onHorizon={vi.fn()} onConfidence={vi.fn()} />)
}

describe('CASH-8 workspace presentations', () => {
  it('uses projection anchor cash for Total Cash', () => {
    expect(outlook()).toContain('$101.00')
  })
  it('uses projection anchor protected cash', () => {
    expect(outlook()).toContain('$20.00')
  })
  it('uses projection anchor Truly Free', () => {
    expect(outlook()).toContain('$81.00')
  })
  it('uses the distinct 14-day summary low', () => {
    expect(outlook()).toContain('$95.00')
  })
  it('shows bounded Days Covered with plus semantics', () => {
    expect(outlook()).toContain('7+ days')
    expect(outlook()).toContain('No breach inside selected horizon')
  })
  it('shows exact days without plus on an earlier breach', () => {
    const s = snapshot(); s.projection.summary.daysCovered = { days: 2, bounded: false }
    expect(outlook(s)).toContain('2 days')
    expect(outlook(s)).not.toContain('2+ days')
  })
  it('shows indeterminate project funding gap as Unknown', () => {
    const html = renderToStaticMarkup(<CashCollectionClock snapshot={snapshot()} />)
    expect(html).toContain('Unknown')
    expect(html).not.toContain('Funding gap</span><strong>$0')
  })
  it('shows a proven zero funding gap as zero', () => {
    const s = snapshot(); s.collectionClock.activeFunding[0].fundingGapMinor = 0
    expect(renderToStaticMarkup(<CashCollectionClock snapshot={s} />)).toContain('$0.00')
  })
  it('keeps active projects in engine order and follow-ups separate', () => {
    const s = snapshot()
    s.collectionClock.activeFunding.push({ ...project, projectId: 'p2', projectName: 'Second project' } as any)
    s.collectionClock.collectionFollowUp.push({ ...project, projectId: 'p3', projectName: 'Follow-up project' } as any)
    const html = renderToStaticMarkup(<CashCollectionClock snapshot={s} />)
    expect(html.indexOf('First project')).toBeLessThan(html.indexOf('Second project'))
    expect(html.indexOf('Collection follow-up')).toBeLessThan(html.indexOf('Follow-up project'))
  })
  it('shows unresolved payment timing explicitly', () => {
    expect(renderToStaticMarkup(<CashUpcomingEvents snapshot={snapshot()} />)).toContain('Payment timing unknown')
  })
  it('Calendar consumes projection dated and undated events', () => {
    const html = renderToStaticMarkup(<CashCalendarView snapshot={snapshot()} />)
    expect(html).toContain('Materials')
    expect(html).toContain('Undated / unresolved')
    expect(html).toContain('Payroll')
  })
  it('Payroll displays partial state instead of a misleading total', () => {
    const html = renderToStaticMarkup(<CashPayrollView snapshot={snapshot()} partial />)
    expect(html).toContain('Partial / Needs attention')
  })
  it('Transactions consumes precomputed CASH-2 account balance and ledger rows', () => {
    const html = renderToStaticMarkup(<CashTransactionsView snapshot={snapshot()} />)
    expect(html).toContain('$101.00')
    expect(html).toContain('Opening')
  })
  it('Obligations uses loaded recurring and commitment rows', () => {
    const html = renderToStaticMarkup(<CashObligationsView snapshot={snapshot()} />)
    expect(html).toContain('Rent')
    expect(html).toContain('Materials')
  })
  it('Day detail uses provided numbers directly', () => {
    const html = renderToStaticMarkup(<CashDayDetail day={day as any} />)
    expect(html).toContain('Opening')
    expect(html).toContain('$100.00')
    expect(html).toContain('$81.00')
  })
})
