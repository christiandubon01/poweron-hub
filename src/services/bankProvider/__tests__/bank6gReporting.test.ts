import { describe, expect, it } from 'vitest'
import { activityOf, buildSpendingReport, type ReportMode, type ReportScope } from '../spending/reporting'
import { defaultHierarchy } from '../spending/hierarchy'
import type { ExplorerRow } from '../spending/types'

const scope: ReportScope = { from: '2026-10-01', to: '2026-10-09', accounts: 'mapped', environment: 'production' }
const complete = { complete: true, reason: null }
const policy = { ignoredCashMovement: 'include' as const }
function row(id: string, amountMinor: number, changes: Partial<ExplorerRow> & { removed?: boolean } = {}): ExplorerRow & { removed?: boolean } {
  return { id, date: '2026-10-09', name: id, merchant: id, merchantKey: id, amountMinor,
    direction: amountMinor > 0 ? 'money_out' : amountMinor < 0 ? 'money_in' : 'zero', pending: false,
    account: { ref: 'account', label: 'Business checking', mask: null, ownership: 'business', mappedTo: 'Business checking', mapped: true, environment: 'production', financialAccountId: 'financial-account' },
    bucket: { key: 'bank_finance_fees', label: 'Bank / Finance Fees', state: 'confirmed', confidence: 'high', reasons: [] },
    relationship: { kind: 'unknown', label: 'Unknown', target: null, state: 'none', confidence: null, reasons: [] },
    review: 'confirmed', scope: { value: 'business', source: 'account' }, unassigned: true, repeatedPattern: false, pattern: null, ...changes }
}
const relationship = (kind: 'overhead' | 'debt' | 'transfer', id?: string): ExplorerRow['relationship'] => ({ kind, label: kind, state: 'confirmed', confidence: 'high', reasons: [], target: id ? { type: kind === 'debt' ? 'debt_account' : 'counterpart_tx', id, label: null } : null })
const fixture = [
  row('fee', 1500, { relationship: relationship('overhead'), unassigned: false }),
  row('unknown', 2000),
  row('transfer-out', 10000, { relationship: relationship('transfer', 'transfer-in'), unassigned: false }),
  row('transfer-in', -10000, { relationship: relationship('transfer', 'transfer-out'), unassigned: false }),
  row('debt', 5000, { relationship: relationship('debt', 'debt-account'), unassigned: false }),
  row('personal', 3000, { scope: { value: 'personal', source: 'owner' }, unassigned: false }),
  row('refund', -300, { bucket: { key: 'refund', label: 'Refund', state: 'confirmed', confidence: 'high', reasons: [] }, unassigned: false }),
  row('income', -20000, { bucket: { key: 'customer_payment', label: 'Customer payment', state: 'confirmed', confidence: 'high', reasons: [] }, unassigned: false }),
  row('pending', 900, { pending: true, unassigned: false }),
  row('ignored', 800, { review: 'ignored', unassigned: false }),
  row('removed', 700, { removed: true, unassigned: false }),
  row('sandbox', 600, { account: { ...row('base', 1).account, environment: 'sandbox' } }),
  row('unmapped', 500, { account: { ...row('base', 1).account, mapped: false } }),
  row('suggested', 400, { bucket: { key: 'materials', label: 'Materials', state: 'suggested', confidence: 'high', reasons: [] }, review: 'suggested' }),
]
const report = (mode: ReportMode, inputs = fixture, s = scope) => buildSpendingReport(inputs, mode, s, policy, complete)
describe('BANK-6G reporting populations (pure, not enabled in any production reader)', () => {
  it.each([
    { amount: 800, pending: false, removed: false, out: 800, incoming: 0 },
    { amount: -600, pending: false, removed: false, out: 0, incoming: 600 },
    { amount: 800, pending: true, removed: false, out: 0, incoming: 0 },
    { amount: -600, pending: false, removed: true, out: 0, incoming: 0 },
  ])('ignored evidence stays separate regardless of transfer/refund/category assignments: $amount / pending $pending / removed $removed', f => {
    for (const key of ['bank_finance_fees','refund','transfers','custom_supplies']) {
      const ignored = row('ignored-evidence',f.amount,{ review:'ignored',pending:f.pending,removed:f.removed,unassigned:true,
        bucket:{ ...row('base',1).bucket,key },relationship:relationship('transfer','counterpart') })
      const r = report('all_money',[ignored])
      expect(r.summary).toMatchObject({ count:1,outMinor:f.out,inMinor:f.incoming,ignoredOutMinor:f.out,ignoredInMinor:f.incoming,ignoredCount:1,unresolvedCount:0 })
      expect(r.rows[0]).toMatchObject({ activity:'ignored',reportParent:'ignored',reportLeaf:'__ignored',unresolved:false })
      expect(r.groups).toHaveLength(1); expect(r.groups[0].children).toHaveLength(1)
      expect(r.groups[0].outMinor).toBe(f.out); expect(r.groups[0].inMinor).toBe(f.incoming)
      expect(report('business',[ignored]).summary!.count).toBe(0)
      expect(report('unassigned',[ignored]).summary!.count).toBe(0)
    }
  })
  it('preserves every in-scope evidence record while distinguishing cash movement from economic spending', () => {
    const r = report('all_money')
    expect(r.summary).toMatchObject({ count: 12, postedCount: 10, outMinor: 22700, inMinor: 30300, pendingCount: 1, ignoredCount: 1, removedCount: 1 })
    expect(r.rows.filter(x => x.activity === 'transfer')).toHaveLength(2)
    expect(report('business').rows.some(x => x.activity === 'transfer' || x.activity === 'debt')).toBe(false)
  })
  it('makes the unanswered ignored cash-movement policy explicit; neither option loses evidence', () => {
    const included = report('all_money'), excluded = buildSpendingReport(fixture, 'all_money', scope, { ignoredCashMovement: 'exclude' }, complete)
    expect(included.summary!.outMinor - excluded.summary!.outMinor).toBe(800)
    expect(included.rows.map(r => r.id)).toEqual(excluded.rows.map(r => r.id))
    expect(excluded.summary!.ignoredCount).toBe(1)
  })
  it('includes qualifying business overhead, not only Unassigned Spending', () => {
    expect(report('business').summary).toMatchObject({ count: 3, outMinor: 3900, inMinor: 0 })
    expect(report('business').rows.map(r => r.id)).toContain('fee')
    expect(report('unassigned').rows.map(r => r.id)).not.toContain('fee')
  })
  it('uses the established unassigned flag and exclusions, preserving its specialized population', () => {
    expect(report('unassigned').summary).toMatchObject({ count: 2, outMinor: 2400, inMinor: 0 })
    expect(report('unassigned').rows.map(r => r.id)).toEqual(['unknown', 'suggested'])
  })
  it('does not count suggestions as confirmed parent classifications in broader reports', () => {
    expect(report('business').rows.find(r => r.id === 'suggested')!.reportParent).toBe('__unclassified')
    expect(report('unassigned').rows.find(r => r.id === 'suggested')!.reportParent).toBe('materials')
  })
  it('does not infer internal transfers from category keys, custom names or unpaired decisions', () => {
    expect(activityOf(row('category-only', 500, { bucket: { ...row('base', 1).bucket, key: 'transfers' } }))).toBe('unresolved')
    expect(activityOf(row('unpaired', 500, { relationship: relationship('transfer') }))).toBe('unresolved')
    expect(activityOf(row('name-only', 500, { name: 'Debt Expenses', bucket: { ...row('base', 1).bucket, key: 'custom_debt_expenses' } }))).toBe('business')
  })
  it.each(['all_money', 'business', 'unassigned'] as const)('%s parent/leaf totals, counts and drill-down reconcile exactly', mode => {
    const r = report(mode)
    expect(r.groups.reduce((n, g) => n + g.count, 0)).toBe(r.summary!.count)
    for (const g of r.groups) {
      expect(g.children.reduce((n, c) => n + c.count, 0)).toBe(g.count)
      expect(g.children.reduce((n, c) => n + c.outMinor, 0)).toBe(g.outMinor)
      expect(g.children.reduce((n, c) => n + c.inMinor, 0)).toBe(g.inMinor)
      for (const c of g.children) expect(r.rows.filter(x => x.reportParent === g.key && x.reportLeaf === c.key)).toHaveLength(c.count)
    }
  })
  it('applies environment/account/date scopes consistently to all three modes', () => {
    for (const mode of ['all_money', 'business', 'unassigned'] as const) {
      expect(report(mode, fixture, { ...scope, account: 'other' }).summary!.count).toBe(0)
      expect(report(mode, fixture, { ...scope, to: '2026-10-08' }).summary!.count).toBe(0)
      expect(report(mode).rows.some(r => r.id === 'sandbox' || r.id === 'unmapped')).toBe(false)
    }
  })
  it('withholds totals and drill-down claims when coverage is truncated, unstable or amounts lose precision', () => {
    const cases = [buildSpendingReport(fixture, 'all_money', scope, policy, { complete: false, reason: 'Evidence cap reached.' }),
      report('all_money', [fixture[0], fixture[0]]), report('all_money', [row('unsafe', Number.MAX_SAFE_INTEGER + 1)])]
    for (const r of cases) { expect(r.coverage.complete).toBe(false); expect(r.summary).toBeNull(); expect(r.groups).toEqual([]); expect(r.rows).toEqual([]) }
  })
  it('moves historical reports using current metadata without touching evidence or decisions', () => {
    const before = JSON.stringify(fixture), h = defaultHierarchy()
    h.categories.find(c => c.key === 'bank_finance_fees')!.parentKey = 'vehicle'
    h.categories.find(c => c.key === 'bank_finance_fees')!.name = 'Banking Fees'
    const r = buildSpendingReport(fixture, 'business', scope, policy, complete, h)
    expect(r.groups.find(g => g.key === 'vehicle')!.children[0].label).toBe('Banking Fees')
    expect(JSON.stringify(fixture)).toBe(before)
  })
})
