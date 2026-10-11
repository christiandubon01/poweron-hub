// @ts-nocheck -- real repositories over a PostgREST shim on PGlite
/**
 * PLAID-3C end to end on REAL SQL: the consolidated position through the REAL repositories, REAL services and the REAL Netlify handler, against a multi-account,
 * two-institution organization (Wells Fargo business checking / savings / personal checking / business card, a Chase card, an unmapped savings account) plus a second
 * organization and a Sandbox test Item that must never show up as real money.
 *
 * Proves: the position is built from the application's own data paths; it is off by default and reads NOTHING while off; organization, role and environment
 * isolation; nothing is fabricated (no reading = null; Sandbox balances never appear); owner decisions place activity (and survive the reconciliation switch being
 * turned off); a section that fails is reported, never zeroed; and the endpoint writes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { applyDecision } from '../spending/spendingService'
import { createSpendingRepo } from '../spending/spendingRepo'
import { decideMatch, getMatchReview } from '../spending/matchReviewService'
import { getConsolidatedPosition } from '../spending/positionService'
import { createBankAccountRepo } from '../bankAccountRepo'
import { createBankBalanceRepo } from '../bankBalanceRepo'
import { createBankConnectionRepo } from '../bankConnectionRepo'
import { getBalances } from '../bankBalanceService'
import { buildHandler } from '../../../../netlify/functions/bank/plaid-position'
import { NOW, ORG, ORG_B, OWNER_B_ID, OWNER_ID, buildWorld } from './helpers/spendingWorld'
import { EMPLOYEE_ID } from './helpers/pgliteHarness'

let PGlite: any = null, types: any = null
try { const m = await import('@electric-sql/pglite'); PGlite = m.PGlite; types = m.types } catch { PGlite = null }

const owner = { organizationId: ORG, userId: OWNER_ID, role: 'owner' }
const ownerB = { organizationId: ORG_B, userId: OWNER_B_ID, role: 'owner' }
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()

describe.runIf(!!PGlite)('PLAID-3C consolidated position end to end (real SQL)', () => {
  let w: Awaited<ReturnType<typeof buildWorld>>
  const T: Record<string, string> = {}
  let sandbox: { item: string; chk: string }
  /** a spy around the service client: how many reads / writes did the code under test make? */
  const spy = (inner = () => w.svc) => { const log = { from: [] as string[], rpc: [] as string[] }; const s = inner(); return { log, svc: { from: (t: string) => { log.from.push(t); return s.from(t) }, rpc: (fn: string, a: any) => { log.rpc.push(fn); return s.rpc(fn, a) } } } }
  const snapshot = (account: string, o: { current?: number | null; available?: number | null; limit?: number | null; hours?: number; org?: string }) =>
    w.q(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, available_balance, available_balance_minor, source, raw_evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'plaid_accounts_get',$8)`, [o.org ?? ORG, w.accounts[account].ref, hoursAgo(o.hours ?? 1), o.current ?? null, o.current == null ? null : Math.round(o.current * 100), o.available ?? null, o.available == null ? null : Math.round(o.available * 100),
      JSON.stringify({ retrieved_at: new Date(NOW).toISOString(), observed_is_provider: true, credit_limit_minor: o.limit == null ? null : Math.round(o.limit * 100) })])
  const deps = (svc = w.svc, over = {}) => ({
    repo: createSpendingRepo(svc), accounts: createBankAccountRepo(svc), balances: createBankBalanceRepo(svc), connections: createBankConnectionRepo(svc),
    now: () => NOW, environment: 'production', positionEnabled: true, balancesEnabled: true, reconciliationEnabled: true, ...over,
  })
  const position = (actor = owner, over = {}, raw = {}, svc = w.svc) => getConsolidatedPosition(deps(svc, over), actor, raw)
  const lines = async (over = {}, raw = {}) => (await position(owner, over, raw)).activity.lines
  const spendDeps = (over = {}) => ({ repo: createSpendingRepo(w.svc), environment: 'production', now: () => NOW, reconciliationEnabled: true, ...over })
  let pristine = ''

  beforeAll(async () => {
    w = await buildWorld(PGlite, types)
    // a Sandbox test Item with an account, a (fabricated) balance and a transaction: it must never count
    const envelope = `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`
    const sbItem = (await w.q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid',$2,$3,$4,$5,$6,'sandbox')`, [ORG, 'sb1', 'ins_sb1', 'First Platypus Bank', envelope, OWNER_ID]))[0].item_id
    const sbAcct = (await w.q(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, mask, provider_account_type, provider_account_subtype) VALUES ($1,$2,'sb-chk','Plaid Checking','0000','depository','checking') RETURNING id`, [ORG, sbItem]))[0].id
    w.accounts.sandboxChk = { ref: sbAcct, fin: null, item: sbItem }
    await w.q(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, available_balance, available_balance_minor, source) VALUES ($1,$2,$3,110,11000,100,10000,'plaid_accounts_get')`, [ORG, sbAcct, hoursAgo(1)])
    T.sbTx = await w.tx('sandboxChk', 5000, '2026-10-01', 'SANDBOX COFFEE')

    // balances (hours old at the time of the read), Wells Fargo + Chase
    await snapshot('chk', { current: 10_000, available: 9_000 }); await snapshot('sav', { current: 40_000, available: 40_000 }); await snapshot('pchk', { current: 2_500 })       // no available reported
    await snapshot('card', { current: 2_300, available: 7_700, limit: 10_000 }); await snapshot('chase', { current: 800, limit: 5_000 })                                              // Chase: no available (derived)
    // 'unmapped' (Old Savings): no balance at all
    await snapshot('chk', { current: 1, org: ORG_B, hours: 1 }).catch(() => {})
    // org B: its own account with a balance (the isolation probe)
    await w.q(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, source) VALUES ($1,$2,$3,777,77700,'plaid_accounts_get')`, [ORG_B, w.accounts['chk:B'].ref, hoursAgo(1)])
    await w.q(`UPDATE public.financial_provider_items SET last_successful_sync_at = $1 WHERE organization_id = $2`, [hoursAgo(3), ORG]).catch(() => {})

    // activity: a customer deposit, ordinary spending, a card purchase, a card payment pair, a transfer pair, a refund, a Sandbox row, org B noise
    T.dep = await w.tx('chk', -3000, '2026-10-02', 'DEPOSIT CUSTOMER'); T.dep2 = await w.tx('chk', -450, '2026-10-03', 'ZELLE FROM JOHN')
    T.fuel = await w.tx('chk', 61.4, '2026-10-04', 'CHEVRON 123'); T.buy = await w.tx('card', 120, '2026-10-01', 'HOME DEPOT #12')
    T.payO = await w.tx('chk', 500, '2026-10-05', 'WELLS FARGO CARD AUTOPAY'); T.payI = await w.tx('card', -500, '2026-10-06', 'PAYMENT THANK YOU')
    T.xO = await w.tx('chk', 1000, '2026-10-07', 'ONLINE TRANSFER TO SAV'); T.xI = await w.tx('sav', -1000, '2026-10-07', 'ONLINE TRANSFER FROM CHK')
    T.ret = await w.tx('card', -89.99, '2026-10-08', 'HOME DEPOT RETURN'); T.pers = await w.tx('pchk', 33, '2026-10-09', 'RESTAURANT')
    T.old = await w.tx('chk', 999, '2026-08-01', 'OLD EXPENSE'); T.pend = await w.tx('chk', 15, '2026-10-10', 'PENDING COFFEE', { pending: true })
    T.b1 = await w.tx('chk:B', 4242, '2026-10-02', 'ORG B EXPENSE'); T.b2 = await w.tx('chk:B', -9999, '2026-10-03', 'ORG B DEPOSIT')
    pristine = await w.untouched()
  }, 240_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('is OFF by default and reads NOTHING while off: no query, no balance, no evidence', async () => {
    for (const over of [{ positionEnabled: undefined }, { positionEnabled: false }]) {
      const s = spy()
      expect(await getConsolidatedPosition(deps(s.svc, over), owner, {})).toEqual({ enabled: false })
      expect(s.log).toEqual({ from: [], rpc: [] })
    }
  })

  it('bank cash and card debt come from the newest provider snapshots of THIS organization and environment: Sandbox balances and the other organization never appear', async () => {
    const p = await position()
    expect(p).toMatchObject({ enabled: true, environment: 'production', balancesEnabled: true, reconciliation: 'on' })
    expect(p.cash.liquid.business.balance).toEqual({ minor: 5_000_000, provenance: 'provider_reported' })        // $10,000 checking + $40,000 savings (the $110 Sandbox account is NOT here)
    expect(p.cash.liquid.business.census).toMatchObject({ accounts: 2, withReading: 2, fresh: 2, missing: 0 })
    expect(p.cash.liquid.business.available).toMatchObject({ minor: 4_900_000, reportedBy: 2, of: 2 })
    expect(p.cash.liquid.personal.balance.minor).toBe(250_000); expect(p.cash.liquid.personal.available).toMatchObject({ minor: null, reportedBy: 0, of: 1 })
    expect(p.cash.liquid.unmapped).toMatchObject({ balance: { minor: null, provenance: 'unavailable' }, completeness: 'unavailable', census: { accounts: 1, withReading: 0, missing: 1 } }) // Old Savings: no reading is NOT zero
    expect(p.cash.liquid.all).toMatchObject({ balance: { minor: 5_250_000 }, completeness: 'incomplete', census: { accounts: 4, withReading: 3, missing: 1 } })
    expect(p.liabilities.cards.owed.minor).toBe(230_000 + 80_000)                                                 // WF Visa $2,300 + Chase $800
    expect(p.liabilities.cards.unusedCredit).toMatchObject({ minor: 770_000 + 420_000, isCash: false, provenance: 'derived', reportedBy: 2 }) // WF: bank-reported $7,700; Chase: derived limit - owed = $4,200 → derived overall
    expect(p.liabilities.cards.creditLimit).toMatchObject({ minor: 1_500_000, reportedBy: 2 })
    expect(JSON.stringify(p)).not.toMatch(/Plaid Checking|First Platypus|SANDBOX COFFEE|777|ORG B/)
    expect(p.accounts.map(a => a.name).sort()).toEqual(['Business Checking', 'Business Savings', 'Business Visa', 'Chase Ink', 'Old Savings', 'Personal Checking'].sort())
    // the issues say what is incomplete (one account has no balance)
    expect(p.issues.find(i => i.id === 'cash-missing')).toMatchObject({ severity: 'warning' })
  })

  it('the same Items read in a Sandbox deployment show only Sandbox accounts (and the production accounts are the ones left out)', async () => {
    const p = await position(owner, { environment: 'sandbox' })
    expect(p.environment).toBe('sandbox'); expect(p.cash.liquid.all.balance.minor).toBe(11_000)
    expect(p.accounts.map(a => a.name)).toEqual(['Plaid Checking'])
    const b = await getBalances({ accounts: createBankAccountRepo(w.svc), balances: createBankBalanceRepo(w.svc), balancesEnabled: true, environment: 'production', now: () => NOW }, owner)
    expect(b.accounts.some(a => a.name === 'Plaid Checking')).toBe(false)
  })

  it('activity is placed by what the owner decided: nothing is income until confirmed; Sandbox, other-organization and out-of-window rows are not counted; pending is apart', async () => {
    const a = (await position()).activity
    expect(a.window).toEqual({ from: '2026-09-12', to: '2026-10-11', days: 30 }); expect(a.coverage.complete).toBe(true)
    expect(a.lines.income.inMinor).toBe(0)                                                              // $3,000 + $450 arrived, but the owner has confirmed nothing
    expect(a.lines.unclassifiedIn.inMinor).toBe(300_000 + 45_000 + 50_000 + 100_000 + 8_999)            // deposits, the card payment's and transfer's inflow legs, the refund-looking return
    expect(a.lines.unclassifiedIn.hints).toMatchObject({ likelyRefund: { inMinor: 8_999, count: 1 } })
    expect(a.lines.businessSpending.outMinor).toBe(6_140 + 12_000)                                      // fuel + card purchase; the $500 card payment and $1,000 transfer are NOT spending
    expect(a.lines.personalSpending.outMinor).toBe(3_300)
    expect(a.lines.unresolvedOut.outMinor).toBe(50_000 + 100_000)                                       // proposed card payment and transfer, held back
    expect(a.pending).toEqual({ inMinor: 0, outMinor: 1_500, count: 1 })
    expect(a.postedCount).toBe(10)                                                                      // dep, dep2, fuel, buy, payO, payI, xO, xI, ret, pers (not: the Sandbox row, org B's rows, the August expense, the pending coffee)
    expect(a.postedCount).toBe(Object.values(a.lines).reduce((n, l) => n + l.count, 0))
    expect(JSON.stringify(a)).not.toMatch(/SANDBOX|ORG B/)
  })

  it('confirming through the real services moves money into the right lines; the card purchase is the only expense and the pair is one internal movement', async () => {
    await applyDecision(spendDeps(), owner, { action: 'set_bucket', transactionId: T.dep, bucket: 'customer_payment' })
    await applyDecision(spendDeps(), owner, { action: 'set_bucket', transactionId: T.ret, bucket: 'refund' })
    await applyDecision(spendDeps(), owner, { action: 'set_bucket', transactionId: T.buy, bucket: 'materials' })
    const review = await getMatchReview(spendDeps(), owner, { tab: 'all', from: '2026-09-01', to: '2026-10-11' })
    for (const [o, i] of [[T.payO, T.payI], [T.xO, T.xI]]) {
      const it = review.items.find(x => x.outflow.id === o)
      expect(it, 'proposed pair').toBeTruthy()
      await decideMatch(spendDeps(), owner, { decision: 'confirm', outflowId: o, inflowId: i, fingerprint: it.fingerprint })
    }
    const l = await lines()
    expect(l.income).toMatchObject({ inMinor: 300_000, ownerClassified: { inMinor: 300_000 }, byScope: { business: 300_000, personal: 0, unmapped: 0 } })
    expect(l.refunds).toMatchObject({ inMinor: 8_999, ownerClassified: { inMinor: 8_999 } })
    expect(l.internalMovement).toMatchObject({ outMinor: 150_000, inMinor: 150_000, count: 4, paidTowardCards: { inMinor: 50_000, count: 1 } })
    expect(l.businessSpending).toMatchObject({ outMinor: 18_140, ownerClassified: { outMinor: 12_000 }, derived: { outMinor: 6_140 } })
    expect(l.unresolvedOut.outMinor).toBe(0)
    expect(l.unclassifiedIn.inMinor).toBe(45_000)                                                       // only the $450 Zelle is still unclassified
  })

  it('a confirmed pair stays ONE internal movement after the reconciliation switch is turned off (rollback safety), and the position says which path it used', async () => {
    const off = await position(owner, { reconciliationEnabled: false })
    expect(off.reconciliation).toBe('off')
    expect(off.activity.lines.internalMovement).toMatchObject({ outMinor: 150_000, inMinor: 150_000, count: 4 })
    expect(off.activity.lines.income.inMinor).toBe(300_000)
  })

  it('the window is the owner\'s choice of 30 / 60 / 90 days; anything else is 30; older rows enter only with a longer window', async () => {
    const days = async raw => (await position(owner, {}, raw)).activity.window.days
    expect([await days({ days: '60' }), await days({ days: 90 }), await days({ days: '7' }), await days({ days: 'x' }), await days({})]).toEqual([60, 90, 30, 30, 30])
    expect((await lines({}, { days: 60 })).businessSpending.outMinor).toBe(18_140)                      // the August 1 expense is 71 days old: not in 60
    expect((await lines({}, { days: 90 })).businessSpending.outMinor).toBe(18_140 + 99_900)             // ... and enters at 90
  })

  it('switching balances off makes every balance unavailable (never zero) while activity still works', async () => {
    const p = await position(owner, { balancesEnabled: false })
    expect(p.balancesEnabled).toBe(false); expect(p.cash.liquid.all).toMatchObject({ balance: { minor: null, provenance: 'unavailable' }, completeness: 'none' })
    expect(p.issues.map(i => i.id)).toContain('balances-off'); expect(p.activity.postedCount).toBeGreaterThan(0); expect(p.accounts).toEqual([])
  })

  it('an old balance is "as of" its date, never current; the newest reading always wins (append-only history), and an older one cannot replace it', async () => {
    await snapshot('chk', { current: 11_000, available: 9_500, hours: 0.2 })                              // a newer reading supersedes the 1-hour-old one
    await snapshot('pchk', { current: 2_600, hours: 100 })                                                // an OLDER reading arriving later is ignored
    let p = await position()
    expect(p.accounts.find(a => a.name === 'Business Checking')).toMatchObject({ balanceMinor: 1_100_000, freshness: 'fresh' })
    expect(p.cash.liquid.personal.balance.minor).toBe(250_000)
    expect(p.cash.liquid.business.balance.minor).toBe(5_100_000)
    // the previously unread account now has only a 100-hour-old reading: its figure appears, labelled not current, and the total says so
    await snapshot('unmapped', { current: 500, hours: 100 })
    p = await position()
    expect(p.cash.liquid.unmapped).toMatchObject({ balance: { minor: 50_000, provenance: 'provider_reported' }, completeness: 'not_current', census: { accounts: 1, withReading: 1, stale: 1, missing: 0 }, observed: { oldest: hoursAgo(100), newest: hoursAgo(100) } })
    expect(p.accounts.find(a => a.name === 'Old Savings')).toMatchObject({ freshness: 'stale', observedAt: hoursAgo(100), balanceMinor: 50_000 })
    expect(p.issues.find(i => i.id === 'cash-old')!.message).toMatch(/older than 24 hours/); expect(p.issues.some(i => i.id === 'cash-missing')).toBe(false)
  })

  it('a section that fails is REPORTED, not zeroed: balances down → "could not be read" and unavailable; the activity is still returned', async () => {
    const real = w.svc
    const broken = { from: (t: string) => { if (t === 'financial_provider_balance_snapshots') throw new Error('boom'); return real.from(t) }, rpc: real.rpc }
    const logs: any[] = []
    const p = await getConsolidatedPosition({ ...deps(broken), log: (e: any) => logs.push(e) }, owner, {})
    expect(p.cash.liquid.all).toMatchObject({ completeness: 'unavailable', balance: { minor: null } })
    expect(p.issues.find(i => i.id === 'balances-error')).toMatchObject({ severity: 'warning' }); expect(p.activity.postedCount).toBeGreaterThan(0)
    expect(logs).toEqual([{ event: 'bank.position.balances_failed', organizationId: ORG, code: 'persistence_failed' }])   // sanitized: no message, no stack
    const brokenEvidence = { from: (t: string) => { if (t === 'financial_provider_transactions') throw new Error('boom'); return real.from(t) }, rpc: () => { throw new Error('boom') } }
    const q = await getConsolidatedPosition(deps(brokenEvidence), owner, {})
    expect(q.activity).toBeNull(); expect(q.issues.map(i => i.id)).toContain('activity-unavailable'); expect(q.cash.liquid.business.balance.minor).toBe(5_100_000)
  })

  it('organization isolation: the other organization sees only its own accounts, balances and rows', async () => {
    const p = await position(ownerB)
    expect(p.accounts.map(a => a.name).sort()).toEqual(['B Checking', 'B Savings'])
    expect(p.cash.liquid.business.balance.minor).toBe(77_700); expect(p.cash.liquid.business.census).toMatchObject({ accounts: 2, withReading: 1, missing: 1 })
    expect(p.activity.lines.businessSpending.outMinor).toBe(424_200); expect(p.activity.lines.unclassifiedIn.inMinor).toBe(999_900)
    expect(JSON.stringify(p)).not.toMatch(/Business Checking|HOME DEPOT|CHEVRON/)
  })

  it('the response carries no provider account id, token, organization id or user id', async () => {
    const json = JSON.stringify(await position())
    expect(json).not.toContain(ORG); expect(json).not.toContain(OWNER_ID); expect(json).not.toMatch(/access-|provider_account_id|chk-a|sav-a|organization/i)
  })

  it('the endpoint writes nothing: the ledger, accounts, mappings and evidence are exactly as they were', async () => {
    const s = spy()
    await getConsolidatedPosition(deps(s.svc), owner, { days: 90 })
    expect(s.log.rpc.filter(r => r !== 'bank_spending_report_source')).toEqual([])                      // the one RPC it may call is the read-only report source
    expect(await w.untouched()).toBe(pristine)                                                          // (decisions made above are interpretations; this guards the rest)
  })

  it('the position code has no write path: no insert / update / upsert / delete / ledger table / Plaid call anywhere in it', () => {
    for (const f of ['../spending/positionService.ts', '../spending/consolidatedPosition.ts', '../../../finance/bankPosition.ts', '../../../../netlify/functions/bank/plaid-position.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\(|\.rpc\(|financial_transactions|plaidPort|createPlaidSdkPort|access_token|decryptFor/)
    }
  })

  describe('the Netlify handler', () => {
    const profile = (role: string | null, org = ORG, active = true) => ({ org_id: org, role, is_active: active })
    const mk = (prof: any, over: any = {}, user: any = { id: OWNER_ID }) => buildHandler({ verifyUser: async () => user, userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: prof }) }) }) }) }), serviceClient: () => over.svc ?? w.svc, now: () => NOW, positionEnabled: () => true, balancesEnabled: () => true, reconciliationEnabled: () => true, ...over })
    const get = (h: any, qs: any = {}) => h({ httpMethod: 'GET', headers: { authorization: 'Bearer t' }, queryStringParameters: qs })
    const env = process.env.PLAID_ENV
    beforeAll(() => { process.env.PLAID_ENV = 'production' }); afterAll(() => { if (env === undefined) delete process.env.PLAID_ENV; else process.env.PLAID_ENV = env })

    it('an owner gets the position; the organization comes from the profile and a spoofed query organization is ignored', async () => {
      const res = await get(mk(profile('owner')), { organizationId: ORG_B, org_id: ORG_B, days: '30' })
      expect(res.statusCode).toBe(200); expect(res.headers['Cache-Control']).toBe('no-store')
      const body = JSON.parse(res.body)
      expect(body.accounts.map(a => a.name)).toContain('Business Checking'); expect(JSON.stringify(body)).not.toContain('B Checking')
      expect(body.cash.liquid.business.balance.minor).toBe(5_100_000)
    })
    it('admins are allowed; employees, other roles, inactive users, missing profiles and unauthenticated callers are refused before anything is read', async () => {
      expect((await get(mk(profile('admin')))).statusCode).toBe(200)
      for (const p of [profile('employee'), profile('viewer'), profile(''), profile(null), profile('owner', ORG, false), { org_id: null, role: 'owner', is_active: true }, null]) {
        const s = spy()
        const res = await get(mk(p, { svc: s.svc })); expect(res.statusCode, JSON.stringify(p)).toBe(403); expect(s.log).toEqual({ from: [], rpc: [] })
      }
      const s = spy()
      const none = await buildHandler({ verifyUser: async () => null, serviceClient: () => s.svc })({ httpMethod: 'GET', headers: {} })
      expect(none.statusCode).toBe(401); expect(s.log).toEqual({ from: [], rpc: [] })
    })
    it('answers { enabled: false } to an owner while the switch is off, reading nothing; only GET and CORS preflight are served', async () => {
      const s = spy()
      const res = await get(mk(profile('owner'), { svc: s.svc, positionEnabled: () => false }))
      expect(res.statusCode).toBe(200); expect(JSON.parse(res.body)).toEqual({ enabled: false }); expect(s.log).toEqual({ from: [], rpc: [] })
      expect((await mk(profile('owner'))({ httpMethod: 'OPTIONS', headers: {} })).statusCode).toBe(200)
      for (const m of ['POST', 'PUT', 'DELETE']) expect((await mk(profile('owner'))({ httpMethod: m, headers: { authorization: 'Bearer t' }, body: '{}' })).statusCode).toBe(405)
    })
    it('the environment is server configuration: the request cannot choose it', async () => {
      const res = await get(mk(profile('owner')), { environment: 'sandbox', env: 'sandbox' })
      expect(JSON.parse(res.body).environment).toBe('production'); expect(JSON.parse(res.body).accounts.map(a => a.name)).not.toContain('Plaid Checking')
    })
    it('an unexpected failure is a generic error that exposes nothing', async () => {
      const res = await get(mk(profile('owner'), { svc: { from: () => { throw new Error(`secret ${ORG} access-token`) }, rpc: () => { throw new Error('secret') } } }))
      expect(res.statusCode).toBe(200)                                            // sections fail soft: the position says what could not be read
      expect(res.body).not.toMatch(/secret|access-token/); expect(JSON.parse(res.body).issues.map(i => i.id)).toEqual(expect.arrayContaining(['balances-error', 'activity-unavailable']))
    })
  })
})
