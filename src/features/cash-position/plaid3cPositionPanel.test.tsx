// @vitest-environment happy-dom
// @ts-nocheck -- fixtures are shaped by the real builder at run time
/**
 * PLAID-3C: the cash position panel. Fixtures come from the REAL builder, so the screen is tested against the actual contract. Pins what the OWNER sees: kinds of
 * money kept apart, where each figure came from, "not available" instead of $0, no income until confirmed, the manual ledger compared but never merged, and
 * nothing at all when the server does not offer the feature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('@/services/authedFetch', () => ({ authedJsonHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer t' }) }))
import CashPositionPanel from './CashPositionPanel'
import { buildPosition } from '@/services/bankProvider/spending/consolidatedPosition'
import { buildRows } from '@/services/bankProvider/spending/explorer'
import { interpretBalance } from '@/services/bankProvider/balanceModel'
import type { ManualLedgerAccount } from '@/finance/bankPosition'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 5)) }) }
const NOW = Date.parse('2026-10-11T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const snap = (o: object = {}) => ({ currentMinor: null, availableMinor: null, limitMinor: null, observedAt: hoursAgo(1), retrievedAt: new Date(NOW).toISOString(), observedIsProvider: true, ...o })
const view = (name: string, type: string, subtype: string, s: object | null, over: object = {}) => ({
  ...interpretBalance({ type, subtype }, s ? snap(s) : null, NOW), accountRef: `ref-${name}`, connectionId: 'item', institutionName: 'Wells Fargo', name, mask: '6960', type, subtype, live: true,
  mappedFinancialAccountId: `fa-${name}`, ownership: 'business', ...over })
const acct = (ref: string, ownership: 'business' | 'personal' | null = 'business', type = 'depository', subtype = 'checking') => ({ providerAccountRef: ref, label: ref, mask: null, ownership, financialAccountId: ownership ? `fa-${ref}` : null, financialAccountName: ownership ? ref : null, environment: 'production' as const, providerType: type, providerSubtype: subtype })
const tx = (id: string, account: string, amountMinor: number, date: string, name: string) => ({ id, providerAccountRef: account, date, name, merchantName: null, amountMinor, pending: false, removed: false, category: null })
const decision = (id: string, txId: string, kind: string, over = {}) => ({ id, txId, kind, status: 'confirmed', category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null, confidence: 'high', source: 'owner', decidedAt: '2026-10-01T00:00:00Z', ...over })
const ROWS = buildRows({ asOf: '2026-10-11', accounts: [acct('chk'), acct('card', 'business', 'credit', 'credit card'), acct('sav')], bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [], reconciliation: true,
  txs: [tx('dep', 'chk', -300_000, '2026-10-02', 'DEPOSIT CUSTOMER'), tx('dep2', 'chk', -45_000, '2026-10-03', 'ZELLE FROM JOHN'), tx('fuel', 'chk', 6_140, '2026-10-04', 'CHEVRON 123'), tx('buy', 'card', 12_000, '2026-10-01', 'HOME DEPOT #12'),
    tx('po', 'chk', 50_000, '2026-10-05', 'WELLS FARGO CARD AUTOPAY'), tx('pi', 'card', -50_000, '2026-10-06', 'PAYMENT THANK YOU'), tx('xo', 'chk', 100_000, '2026-10-07', 'ONLINE TRANSFER TO SAV'), tx('xi', 'sav', -100_000, '2026-10-07', 'ONLINE TRANSFER FROM CHK')],
  decisions: [decision('d1', 'dep', 'category', { category: 'customer_payment' }), decision('d2', 'po', 'transfer', { counterpartTxId: 'pi' }), decision('d2b', 'pi', 'transfer', { counterpartTxId: 'po' }), decision('d3', 'buy', 'category', { category: 'materials' })] }).rows
const BALANCES = [
  view('Business Checking', 'depository', 'checking', { currentMinor: 1_100_000, availableMinor: 900_000 }),
  view('Business Savings', 'depository', 'savings', { currentMinor: 4_000_000, availableMinor: 4_000_000 }),
  view('Personal Checking', 'depository', 'checking', { currentMinor: 250_000 }, { ownership: 'personal', mappedFinancialAccountId: 'fa-pchk' }),
  view('Old Savings', 'depository', 'savings', null, { ownership: null, mappedFinancialAccountId: null }),
  view('Business Visa', 'credit', 'credit card', { currentMinor: 230_000, availableMinor: 770_000, limitMinor: 1_000_000 }),
  view('Truck Loan', 'loan', 'auto', { currentMinor: 1_800_000 }, { ownership: null, mappedFinancialAccountId: null }),
]
const input = (over = {}) => ({ nowMs: NOW, environment: 'production', balancesEnabled: true, balances: BALANCES, rows: ROWS, accountClassOf: new Map([['card', 'credit_card']]), window: { from: '2026-09-12', to: '2026-10-11', days: 30 }, coverage: { complete: true, reason: null },
  syncs: [{ label: 'Wells Fargo', status: 'healthy', lastSyncedAt: hoursAgo(3) }], reconciliation: true, ...over })
const POSITION = buildPosition(input() as any)
const LEDGER: ManualLedgerAccount[] = [
  { id: 'fa-Business Checking', name: 'Operating', accountClass: 'asset', ownership: 'business', includeInCash: true, status: 'active', balanceMinor: 1_150_000 },
  { id: 'fa-Business Visa', name: 'Visa (manual)', accountClass: 'liability', ownership: 'business', includeInCash: false, status: 'active', balanceMinor: 200_000 },
  { id: 'fa-petty', name: 'Petty cash', accountClass: 'asset', ownership: 'business', includeInCash: true, status: 'active', balanceMinor: 20_000 },
]

describe('Cash position panel (PLAID-3C)', () => {
  let host: HTMLDivElement, root: Root, fetchMock: ReturnType<typeof vi.fn>
  let respond: (url: string) => { status?: number; body: unknown }
  const mount = async (body: unknown | ((url: string) => unknown), ledger: ManualLedgerAccount[] = LEDGER) => {
    respond = url => ({ body: typeof body === 'function' ? (body as any)(url) : body })
    fetchMock = vi.fn(async (url: string) => { const r = respond(url); const status = r.status ?? 200; return { ok: status < 400, status, json: async () => r.body } })
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<CashPositionPanel ledger={ledger} />) }); await flush()
  }
  const q = (s: string) => host.querySelector(s) as HTMLElement | null
  const qa = (s: string) => [...host.querySelectorAll(s)] as HTMLElement[]
  const click = async (el: Element | null) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }); await flush() }
  const text = (s: string) => q(s)!.textContent!
  beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

  it('renders NOTHING when the server does not offer it: switched off, not an owner/admin, or still loading; and it only ever reads', async () => {
    await mount({ enabled: false }); expect(host.innerHTML).toBe('')
    await act(async () => { root.unmount() }); root = createRoot(host)
    await mount(() => ({ error: 'Only owners and admins can view the cash position.' })); respond = () => ({ status: 403, body: { error: 'x' } })
    await act(async () => { root.unmount() }); root = createRoot(host)
    fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'nope' }) })); vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.render(<CashPositionPanel />) }); await flush()
    expect(host.innerHTML).toBe('')
    expect(fetchMock.mock.calls.every(([, i]) => (i?.method ?? 'GET') === 'GET')).toBe(true)
  })

  it('asks for the 30-day window first, sends no organization, and shows when the figures were computed', async () => {
    await mount(POSITION)
    expect(String(fetchMock.mock.calls[0][0])).toBe('/.netlify/functions/plaid-position?days=30')
    expect(JSON.stringify(fetchMock.mock.calls[0][1])).not.toMatch(/organization|org_id|environment/i)
    expect(text('[data-testid="position-asof"]')).toMatch(/^As of Oct 11/)
  })

  it('bank cash is shown by ownership with its provenance; an unreported available balance and an unread account are "not reported" / "no balance yet", never $0', async () => {
    await mount(POSITION)
    const biz = q('[data-testid="position-cash-business"]')!
    expect(biz.dataset.completeness).toBe('current'); expect(text('[data-testid="position-cash-business-balance"]')).toBe('$51,000.00')
    expect(biz.textContent).toContain('Bank-reported'); expect(biz.textContent).toContain('2 accounts, all updated in the last 24 hours'); expect(text('[data-testid="position-cash-business-available"]')).toBe('Available $49,000.00')
    const per = q('[data-testid="position-cash-personal"]')!
    expect(per.querySelector('[data-testid="position-cash-personal-balance"]')!.textContent).toBe('$2,500.00'); expect(per.textContent).toContain('Available balance: not reported by the bank')
    const un = q('[data-testid="position-cash-unmapped"]')!
    expect(un.dataset.completeness).toBe('unavailable'); expect(un.querySelector('[data-testid="position-cash-unmapped-balance"]')!.textContent).toBe('—'); expect(un.textContent).toContain('No balance yet'); expect(un.textContent).not.toContain('$0.00')
    const all = q('[data-testid="position-cash-all"]')!
    expect(all.dataset.completeness).toBe('incomplete'); expect(all.textContent).toContain('1 of 4 accounts has no balance yet and is left out of this total')
  })

  it('what you owe is separate from cash: owed is a liability, unused credit says it is NOT cash, and no profit or net figure exists anywhere', async () => {
    await mount(POSITION)
    expect(text('[data-testid="position-cards-owed"]')).toBe('$2,300.00'); expect(text('[data-testid="position-cards-unused"]')).toMatch(/\$7,700\.00 unused credit · not cash.*Bank-reported/)
    expect(text('[data-testid="position-cards"]')).toContain('limit $10,000.00'); expect(text('[data-testid="position-loans-owed"]')).toBe('$18,000.00')
    expect(text('[data-testid="position-cash"]')).not.toContain('$2,300.00')                                       // card debt is not in the cash block
    expect(host.textContent).toContain('This is not profit'); expect(host.textContent).not.toMatch(/\b(net cash|profit:|net worth|cash after debt)\b/i)
  })

  it('income is only what you confirmed; unclassified money in says so, with what it looks like; a confirmed card payment and transfer are one movement', async () => {
    await mount(POSITION)
    const inc = q('[data-testid="position-line-income"]')!
    expect(inc.querySelector('[data-testid="position-line-income-value"]')!.textContent).toBe('$3,000.00'); expect(inc.textContent).toContain('You classified'); expect(inc.textContent).toContain('into business')
    const un = q('[data-testid="position-line-unclassifiedIn"]')!
    expect(un.textContent).toContain('not income until you confirm it'); expect(un.textContent).toContain('Derived')
    expect(un.querySelector('[data-testid="position-line-unclassifiedIn-value"]')!.textContent).toBe('$1,450.00')       // the $450 Zelle + the $1,000 inflow leg of a transfer nobody has confirmed (the confirmed card payment and the confirmed customer payment are not in it)
    expect(text('[data-testid="position-hints-in"]')).toMatch(/\$1,000\.00 transfers or card payments.*Counted nowhere until you decide/)
    const internal = q('[data-testid="position-line-internalMovement"]')!
    expect(internal.querySelector('[data-testid="position-line-internalMovement-value"]')!.textContent).toBe('$500.00'); expect(internal.textContent).toContain('in neither income nor spending'); expect(internal.textContent).toContain('$500.00 paid toward cards')
    const biz = q('[data-testid="position-line-businessSpending"]')!
    expect(biz.textContent).toContain('you classified'); expect(biz.textContent).toContain('assumed from the business account')
    expect(text('[data-testid="position-line-unresolvedOut"]')).toContain('not an expense until you decide')
    expect(text('[data-testid="position-basis"]')).toMatch(/posted transactions, each counted once.*transfer and card-payment matching/)
  })

  it('a longer window asks the server again; the owner can come back to 30', async () => {
    await mount(POSITION)
    await click(q('[data-testid="position-window-60"]'))
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe('/.netlify/functions/plaid-position?days=60')
    await click(q('[data-testid="position-window-90"]')); expect(String(fetchMock.mock.calls.at(-1)![0])).toContain('days=90')
    expect(q('[data-testid="position-window-90"]')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('every account is one tap away with its freshness and as-of time; a stale balance is labelled, not hidden', async () => {
    const p = buildPosition(input({ balances: [...BALANCES, view('Aged', 'depository', 'checking', { currentMinor: 100, observedAt: hoursAgo(100) })] }) as any)
    await mount(p)
    expect(q('[data-testid="position-accounts"]')).toBeNull()
    await click(q('[data-testid="position-accounts-toggle"]'))
    const rows = qa('[data-testid="position-account-row"]')
    expect(rows.length).toBe(7); expect(rows.find(r => r.textContent!.includes('Aged'))!.dataset.freshness).toBe('stale'); expect(rows.find(r => r.textContent!.includes('Aged'))!.textContent).toContain('Stale')
    expect(rows.find(r => r.textContent!.includes('Old Savings'))!.textContent).toContain('No balance')
    expect(rows.find(r => r.textContent!.includes('Business Visa'))!.textContent).toContain('unused credit $7,700.00 (not cash)')
    expect(q('[data-testid="position-cash-business"]')!.dataset.completeness).toBe('not_current')               // the old account is a business account: its total says it is not current
    expect(text('[data-testid="position-cash-business"]')).toContain('1 of 3 balances is older than 24 hours')
    expect(q('[data-testid="position-cash-unmapped"]')!.dataset.completeness).toBe('unavailable')
  })

  it('the manual ledger sits beside the bank: each ledger account with the difference to its bank account; ledger cash is labelled "not bank money"; nothing is merged', async () => {
    await mount(POSITION)
    const ledger = q('[data-testid="position-ledger"]')!
    expect(ledger.textContent).toContain('neither is changed'); expect(text('[data-testid="position-ledger-cash"]')).toMatch(/\$11,700\.00.*Manual ledger.*not bank money/)
    const rows = qa('[data-testid="position-ledger-row"]')
    expect(rows[0].textContent).toContain('Operating'); expect(rows[0].textContent).toContain('$11,500.00'); expect(rows[0].textContent).toContain('Bank: $11,000.00'); expect(rows[0].textContent).toContain('Bank is $500.00 lower than the ledger')
    expect(rows[1].textContent).toContain('Bank is $300.00 higher than the ledger')                                        // card: bank owes more than the manual record
    expect(rows[2].textContent).toContain('No bank account linked'); expect(rows[2].querySelector('[data-testid="position-ledger-diff"]')).toBeNull()
    expect(text('[data-testid="position-bank-only"]')).toContain('no active Cash OS ledger account to compare with')
    expect(text('[data-testid="position-cash-business-balance"]')).toBe('$51,000.00')                                        // the ledger did not leak into bank cash
  })

  it('no ledger accounts → no ledger section; balances switched off → "not available", not zero, and no card or cash figures', async () => {
    await mount(POSITION, [])
    expect(q('[data-testid="position-ledger"]')!.textContent).toContain('no active Cash OS ledger account to compare with') // bank accounts exist that no ledger account covers
    await act(async () => { root.unmount() }); root = createRoot(host)
    await mount(buildPosition(input({ balancesEnabled: false, balances: [] }) as any), [])
    expect(text('[data-testid="position-balances-off"]')).toMatch(/not switched on.*They are not zero/); expect(q('[data-testid="position-owed"]')).toBeNull(); expect(host.textContent).not.toContain('$0.00')
    expect(q('[data-testid="position-line-income"]')).toBeTruthy()                                                          // activity still works
  })

  it('what could not be read is said plainly: incomplete coverage and unreadable activity; a failed first load shows nothing', async () => {
    await mount(buildPosition(input({ coverage: { complete: false, reason: 'Legacy review evidence may be capped.' } }) as any))
    expect(text('[data-testid="position-coverage"]')).toContain('Legacy review evidence may be capped.')
    await act(async () => { root.unmount() }); root = createRoot(host)
    await mount(buildPosition(input({ rows: null }) as any))
    expect(text('[data-testid="position-activity-unavailable"]')).toContain('no income or spending is shown')
    await act(async () => { root.unmount() }); root = createRoot(host)
    // a failed FIRST load shows nothing at all (an error never stands in for a figure, and with the feature off the screen is unchanged)
    fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Something went wrong.' }) })); vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.unmount() }); root = createRoot(host)
    await act(async () => { root.render(<CashPositionPanel />) }); await flush()
    expect(host.innerHTML).toBe('')
    fetchMock = vi.fn(async () => { throw new Error('network down') }); vi.stubGlobal('fetch', fetchMock)
    await act(async () => { root.unmount() }); root = createRoot(host)
    await act(async () => { root.render(<CashPositionPanel />) }); await flush()
    expect(host.innerHTML).toBe('')
  })

  it('a failed refresh keeps the last good figures and says so; it never replaces them with zeros', async () => {
    await mount(POSITION)
    respond = () => ({ status: 500, body: { error: 'Temporarily unavailable.' } })
    await click(q('[data-testid="position-refresh"]'))
    expect(text('[data-testid="position-refresh-error"]')).toContain('Showing the last figures above'); expect(text('[data-testid="position-cash-business-balance"]')).toBe('$51,000.00')
  })

  it('issues are listed warnings first, three at a time, with the rest one tap away', async () => {
    const many = buildPosition(input({ balances: [view('A', 'depository', 'checking', { currentMinor: 1, observedAt: hoursAgo(100) }), view('B', 'depository', 'savings', null), view('C', 'credit', 'credit card', null), view('D', 'loan', 'auto', null)],
      coverage: { complete: false, reason: 'Capped.' }, syncs: [{ label: 'Chase', status: 'login_required', lastSyncedAt: null }, { label: 'Old Bank', status: 'healthy', lastSyncedAt: hoursAgo(80) }] }) as any)
    expect(many.issues.length).toBeGreaterThan(3)
    await mount(many)
    expect(qa('[data-testid="position-issues"] li').length).toBe(3); expect(qa('[data-testid="position-issues"] li')[0].dataset.severity).toBe('warning')
    await click(q('[data-testid="position-issues-toggle"]')); expect(qa('[data-testid="position-issues"] li').length).toBe(many.issues.length)
  })

  it('sandbox data is labelled as test data; nothing identifying leaks into the page (no ids, tokens or organization)', async () => {
    await mount(buildPosition(input({ environment: 'sandbox' }) as any))
    expect(text('[data-testid="position-asof"]')).toContain('sandbox test data')
    expect(host.innerHTML).not.toMatch(/access-|provider_account|organization|org_id|v1\||[0-9a-f]{8}-[0-9a-f]{4}-4/i)
  })

  it('touch contract: every control is a real button of at least 44px; figures wrap on a phone instead of overflowing', async () => {
    await mount(POSITION)
    for (const b of qa('button')) { expect(b.tagName).toBe('BUTTON'); expect(b.className).toMatch(/min-h-\[44px\]/) }
    expect(q('[data-testid="cash-position"]')!.className).toContain('p-4'); expect(q('[data-testid="position-refresh"]')!.getAttribute('aria-label')).toBe('Refresh the cash position')
    for (const r of qa('[data-testid="position-cash-business"] > div')) expect(r.className).toContain('flex-wrap')
  })
})
