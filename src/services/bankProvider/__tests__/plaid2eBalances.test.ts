// @ts-nocheck -- fakes mimic supabase-js; PGlite runs the real snapshot table from migration 153
/**
 * PLAID-2E / Track E: actual bank balances. Pure interpretation rules, then the service + repository against the REAL append-only snapshot table
 * (migration 153, already installed in production: no new SQL). Pins: bank cash vs card debt vs unused credit never mix, current vs available,
 * unknown stays unknown, freshness, exact cents, idempotency, organization isolation, owner/admin only, flag-off, and no ledger/manual-balance writes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { AGING_HOURS, FRESH_HOURS, classifyAccount, freshnessOf, interpretBalance, toExactMinor } from '../balanceModel'
import { createBankBalanceRepo } from '../bankBalanceRepo'
import { getBalances, refreshBalances, trustedProviderTime } from '../bankBalanceService'
import { contextFor } from '../bankConnectionService'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { PlaidApiFailure } from '../plaidPort'
import { buildHandler as balancesHandler } from '../../../../netlify/functions/bank/plaid-balances'
import { ORG, ORG_B, OWNER_ID, createDb, loadPglite, makeItem, rows } from './helpers/pgliteHarness'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const H = 3_600_000
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()

describe('balance interpretation (pure)', () => {
  it('classifies accounts; certificates and HSAs are restricted, not spendable cash', () => {
    expect(classifyAccount('depository', 'checking')).toEqual({ accountClass: 'bank_cash', restricted: false })
    expect(classifyAccount('depository', 'savings')).toEqual({ accountClass: 'bank_cash', restricted: false })
    expect(classifyAccount('depository', 'cd')).toEqual({ accountClass: 'bank_cash', restricted: true })
    expect(classifyAccount('credit', 'credit card').accountClass).toBe('credit_card')
    expect(classifyAccount('loan', 'auto').accountClass).toBe('loan')
    expect(classifyAccount(null, null).accountClass).toBe('other')
  })
  const snap = (o) => ({ currentMinor: null, availableMinor: null, limitMinor: null, observedAt: iso(H), retrievedAt: iso(H), observedIsProvider: true, ...o })
  it('bank account: current and available are separate facts; a missing available is UNKNOWN, never copied from current', () => {
    const b = interpretBalance({ type: 'depository', subtype: 'checking' }, snap({ currentMinor: 120_000, availableMinor: 95_000 }), NOW)
    expect(b).toMatchObject({ accountClass: 'bank_cash', bankBalanceMinor: 120_000, availableMinor: 95_000, owedMinor: null, unusedCreditMinor: null })
    const unknown = interpretBalance({ type: 'depository', subtype: 'savings' }, snap({ currentMinor: 50_000 }), NOW)
    expect(unknown.availableMinor).toBeNull(); expect(unknown.bankBalanceMinor).toBe(50_000)
  })
  it('credit card: owed is a liability, unused credit is credit, and neither is bank cash', () => {
    const c = interpretBalance({ type: 'credit', subtype: 'credit card' }, snap({ currentMinor: 230_000, availableMinor: 770_000, limitMinor: 1_000_000 }), NOW)
    expect(c).toMatchObject({ accountClass: 'credit_card', owedMinor: 230_000, unusedCreditMinor: 770_000, creditLimitMinor: 1_000_000, bankBalanceMinor: null, availableMinor: null, unusedCreditIsCash: false })
    expect(interpretBalance({ type: 'credit', subtype: 'credit card' }, snap({ currentMinor: 230_000, limitMinor: 1_000_000 }), NOW).unusedCreditMinor).toBe(770_000) // limit - owed when the bank gives no available
    expect(interpretBalance({ type: 'credit', subtype: 'credit card' }, snap({ currentMinor: 230_000 }), NOW).unusedCreditMinor).toBeNull() // unknown stays unknown
    const over = interpretBalance({ type: 'credit', subtype: 'credit card' }, snap({ currentMinor: -4_500, limitMinor: 500_000 }), NOW)
    expect(over).toMatchObject({ owedMinor: 0, creditInFavourMinor: 4_500 }) // an overpaid card is not "negative debt shown as cash"
    const over2 = interpretBalance({ type: 'credit', subtype: 'credit card' }, snap({ currentMinor: 600_000, limitMinor: 500_000 }), NOW)
    expect(over2.unusedCreditMinor).toBe(0) // never negative
  })
  it('loans report what is owed and have no unused credit', () => {
    expect(interpretBalance({ type: 'loan', subtype: 'auto' }, snap({ currentMinor: 1_800_000, availableMinor: 5, limitMinor: 9 }), NOW)).toMatchObject({ accountClass: 'loan', owedMinor: 1_800_000, unusedCreditMinor: null, creditLimitMinor: null })
  })
  it('freshness: fresh / aging / stale / unknown; a connection needing sign-in is never fresh', () => {
    expect(freshnessOf(iso(1 * H), NOW).freshness).toBe('fresh')
    expect(freshnessOf(iso(FRESH_HOURS * H), NOW).freshness).toBe('fresh')
    expect(freshnessOf(iso((FRESH_HOURS + 1) * H), NOW).freshness).toBe('aging')
    expect(freshnessOf(iso((AGING_HOURS + 1) * H), NOW).freshness).toBe('stale')
    expect(freshnessOf(null, NOW).freshness).toBe('unknown')
    expect(freshnessOf('garbage', NOW).freshness).toBe('unknown')
    expect(freshnessOf(iso(1 * H), NOW, false).freshness).toBe('aging')
    expect(freshnessOf(iso((AGING_HOURS + 5) * H), NOW, false).freshness).toBe('stale')
    expect(interpretBalance({ type: 'depository', subtype: 'checking' }, null, NOW)).toMatchObject({ freshness: 'unknown', bankBalanceMinor: null, availableMinor: null })
  })
  it('exact cents only', () => {
    expect(toExactMinor(1234.56)).toBe(123_456); expect(toExactMinor(-0.07)).toBe(-7); expect(toExactMinor(0)).toBe(0)
    expect(toExactMinor(10.005)).toBeNull(); expect(toExactMinor(NaN)).toBeNull(); expect(toExactMinor('5')).toBeNull(); expect(toExactMinor(null)).toBeNull()
  })
  it('trusts a bank timestamp only when sane', () => {
    expect(trustedProviderTime('2026-10-11T11:00:00Z', NOW)).toBe('2026-10-11T11:00:00.000Z')
    expect(trustedProviderTime('2026-10-12T12:00:00Z', NOW)).toBeNull() // the future
    expect(trustedProviderTime('2020-01-01T00:00:00Z', NOW)).toBeNull() // years old
    expect(trustedProviderTime('nonsense', NOW)).toBeNull(); expect(trustedProviderTime(null, NOW)).toBeNull()
  })
})

const PGlite = await loadPglite()
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })

describe.runIf(!!PGlite)('balance service on the real snapshot table (PGlite)', () => {
  let db
  beforeAll(async () => { db = await createDb(PGlite) }, 120_000)
  afterAll(async () => { await db?.close?.() })

  /** supabase-js shaped adapter for exactly the calls bankBalanceRepo makes. */
  const svc = {
    from(table) {
      const f = []; let cols = '*', order = null, lim = null, up = null
      const q = {
        select(c) { cols = c; return q }, eq(k, v) { f.push([k, v]); return q }, order(k, o) { order = [k, o.ascending]; return q }, limit(n) { lim = n; return q },
        upsert(payload, opts) { up = { payload, opts }; return q },
        then(res, rej) { return run().then(res, rej) },
      }
      async function run() {
        try {
          if (up) {
            const ids = []
            for (const r of up.payload) {
              const keys = Object.keys(r)
              const out = await db.query(`INSERT INTO public.${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}${typeof r[keys[i]] === 'object' && r[keys[i]] !== null ? '::jsonb' : ''}`).join(',')}) ON CONFLICT (${up.opts.onConflict}) DO NOTHING RETURNING id`,
                keys.map(k => (typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k])))
              ids.push(...out.rows)
            }
            return { data: ids, error: null }
          }
          const r = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f.map((x, i) => `${x[0]} = $${i + 1}`).join(' AND ')}${order ? ` ORDER BY ${order[0]} ${order[1] ? 'ASC' : 'DESC'}` : ''}${lim ? ` LIMIT ${lim}` : ''}`, f.map(x => x[1]))
          return { data: r.rows, error: null }
        } catch (e) { return { data: null, error: { code: e.code, message: e.message } } }
      }
      return q
    },
  }

  /** A connected Item (three accounts) plus fakes for the repositories that are not under test. */
  async function world(org = ORG, readings = []) {
    const item = await makeItem(db, org, ['chk', 'sav', 'card'])
    const providerIds = Object.fromEntries((await rows(db, `SELECT id, provider_account_id FROM public.financial_provider_accounts WHERE provider_item_ref = $1`, [item.id])).map(r => [r.id, r.provider_account_id]))
    const provRow = (key) => ({ id: item.accounts[key], providerItemRef: item.id, providerAccountId: providerIds[item.accounts[key]], name: key, officialName: null, mask: '1234', status: 'active',
      providerAccountType: key === 'card' ? 'credit' : 'depository', providerAccountSubtype: key === 'card' ? 'credit card' : key === 'sav' ? 'savings' : 'checking', institutionName: 'Wells Fargo', itemStatus: 'healthy' })
    const envelope = encryptProviderToken('access-production-x', KEY, contextFor({ organizationId: org }, 'plaid', 'p'))
    const state = { now: NOW, readings }
    const plaid = { getAccountBalances: vi.fn(async () => state.readings) }
    const deps = {
      plaid, key: KEY, environment: 'production', log: () => {}, balancesEnabled: true, now: () => state.now,
      repo: { getItem: async (o, id) => (o === org && id === item.id ? { id, provider: 'plaid', providerItemId: 'p', status: 'healthy', environment: 'production' } : null), getActiveCredential: async (o) => (o === org ? envelope : null) },
      accounts: { listProviderAccounts: async () => ['chk', 'sav', 'card'].map(provRow), listAllProviderAccounts: async () => ['chk', 'sav', 'card'].map(provRow), listActiveMappings: async () => [], listCashAccounts: async () => [], markItemLoginRequired: vi.fn(async () => {}) },
      balances: createBankBalanceRepo(svc),
    }
    const reading = (key, o = {}) => ({ accountId: providerIds[item.accounts[key]], type: key === 'card' ? 'credit' : 'depository', subtype: key === 'card' ? 'credit card' : 'checking', current: 100, available: 90, limit: null, currency: 'USD', lastUpdatedAt: null, ...o })
    return { item, deps, state, plaid, reading, providerIds, owner: { organizationId: org, userId: OWNER_ID, role: 'owner' } }
  }
  const snaps = (item) => rows(db, `SELECT s.current_balance_minor::int AS c, s.available_balance_minor::int AS a, s.observed_at, s.raw_evidence FROM public.financial_provider_balance_snapshots s JOIN public.financial_provider_accounts a ON a.id = s.provider_account_ref WHERE a.provider_item_ref = $1 ORDER BY s.created_at`, [item.id])

  it('stores one append-only snapshot per account and reads them back interpreted: bank cash, card debt and unused credit stay apart, with freshness', async () => {
    const w = await world()
    w.state.readings = [w.reading('chk', { current: 1500.25, available: 1400.1, lastUpdatedAt: iso(2 * H) }), w.reading('sav', { current: 8000, available: 8000, lastUpdatedAt: iso(30 * H) }),
      w.reading('card', { current: 2300, available: 7700, limit: 10000, lastUpdatedAt: null })]
    expect(await refreshBalances(w.deps, w.owner, { itemId: w.item.id })).toEqual({ stored: 3, unchanged: 0, unknownAccounts: 0, rejected: 0, unsupportedCurrency: 0 })
    const { accounts, enabled } = await getBalances(w.deps, w.owner)
    expect(enabled).toBe(true)
    const by = Object.fromEntries(accounts.map(a => [a.name, a]))
    expect(by.chk).toMatchObject({ accountClass: 'bank_cash', bankBalanceMinor: 150_025, availableMinor: 140_010, freshness: 'fresh', observedIsProvider: true })
    expect(by.sav).toMatchObject({ bankBalanceMinor: 800_000, freshness: 'aging' })
    expect(by.card).toMatchObject({ accountClass: 'credit_card', owedMinor: 230_000, unusedCreditMinor: 770_000, creditLimitMinor: 1_000_000, bankBalanceMinor: null, availableMinor: null, observedIsProvider: false, freshness: 'fresh' })
    expect(JSON.stringify(accounts)).not.toMatch(/access-production|providerAccountId|chk-\d|sav-\d|card-\d/) // no token, no bank account id
  })

  it('is idempotent: the same bank timestamp stores once; a changed balance with a new timestamp appends; identical untimestamped readings within 15 minutes are skipped', async () => {
    const w = await world()
    w.state.readings = [w.reading('chk', { current: 10, available: 10, lastUpdatedAt: iso(1 * H) })]
    expect((await refreshBalances(w.deps, w.owner, { itemId: w.item.id })).stored).toBe(1)
    expect(await refreshBalances(w.deps, w.owner, { itemId: w.item.id })).toMatchObject({ stored: 0, unchanged: 1 })
    w.state.readings = [w.reading('chk', { current: 12, available: 12, lastUpdatedAt: iso(0) })]
    expect((await refreshBalances(w.deps, w.owner, { itemId: w.item.id })).stored).toBe(1)
    w.state.readings = [w.reading('sav', { current: 5, available: 5 })]
    expect((await refreshBalances(w.deps, w.owner, { itemId: w.item.id })).stored).toBe(1)
    w.state.now += 5 * 60_000
    expect(await refreshBalances(w.deps, w.owner, { itemId: w.item.id })).toMatchObject({ stored: 0, unchanged: 1 })
    w.state.now += 20 * 60_000
    expect((await refreshBalances(w.deps, w.owner, { itemId: w.item.id })).stored).toBe(1)
    expect(await snaps(w.item)).toHaveLength(4)
    // history is append-only
    await expect(rows(db, `UPDATE public.financial_provider_balance_snapshots SET current_balance = 1, current_balance_minor = 100`)).rejects.toThrow(/append-only/)
  })

  it('rejects what it cannot store faithfully, per account, without failing the others', async () => {
    const w = await world()
    w.state.readings = [
      w.reading('chk', { current: 10.005 }),                                  // not exact cents
      w.reading('sav', { current: null, available: null }),                   // nothing to record
      w.reading('card', { current: 5, available: 5, limit: 1.234 }),          // bad limit rejects the whole reading
      { ...w.reading('chk'), accountId: 'not-saved-yet', current: 1 },         // a shared-but-unsaved account is never created here
      { ...w.reading('sav'), currency: 'CAD' },                               // USD only
      { ...w.reading('chk', { current: 7, available: 7 }), accountId: w.reading('chk').accountId }, // duplicate id in one answer
    ]
    const r = await refreshBalances(w.deps, w.owner, { itemId: w.item.id })
    expect(r).toMatchObject({ unknownAccounts: 1, unsupportedCurrency: 0 })
    expect(r.rejected + r.stored + r.unchanged + r.unknownAccounts + r.unsupportedCurrency).toBeGreaterThanOrEqual(5)
    expect((await snaps(w.item)).every(s => [10.005, 1.234].every(bad => s.c !== Math.round(bad * 100)))).toBe(true)
  })

  it('a sane bank timestamp decides freshness; an absurd one falls back to the retrieval time', async () => {
    const w = await world()
    w.state.readings = [w.reading('chk', { current: 1, available: 1, lastUpdatedAt: iso(80 * H) }), w.reading('sav', { current: 2, available: 2, lastUpdatedAt: '2031-01-01T00:00:00Z' })]
    await refreshBalances(w.deps, w.owner, { itemId: w.item.id })
    const by = Object.fromEntries((await getBalances(w.deps, w.owner)).accounts.map(a => [a.name, a]))
    expect(by.chk).toMatchObject({ freshness: 'stale', observedIsProvider: true })
    expect(by.sav).toMatchObject({ freshness: 'fresh', observedIsProvider: false })
  })

  it('an unreadable provider answer or a sign-in demand is reported safely; a stale connection is never fresh', async () => {
    const w = await world()
    w.plaid.getAccountBalances.mockRejectedValueOnce(new PlaidApiFailure('ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', 400))
    await expect(refreshBalances(w.deps, w.owner, { itemId: w.item.id })).rejects.toMatchObject({ code: 'login_required' })
    expect(w.deps.accounts.markItemLoginRequired).toHaveBeenCalled()
    w.plaid.getAccountBalances.mockRejectedValueOnce(new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500))
    await expect(refreshBalances(w.deps, w.owner, { itemId: w.item.id })).rejects.toMatchObject({ code: 'plaid_unavailable' })
    w.state.readings = [w.reading('chk', { current: 1, available: 1, lastUpdatedAt: iso(1 * H) })]
    await refreshBalances(w.deps, w.owner, { itemId: w.item.id })
    const sign = { ...w.deps, accounts: { ...w.deps.accounts, listAllProviderAccounts: async () => (await w.deps.accounts.listAllProviderAccounts()).map(a => ({ ...a, itemStatus: 'login_required' })) } }
    expect((await getBalances(sign, w.owner)).accounts.find(a => a.name === 'chk').freshness).toBe('aging')
  })

  it('authority and isolation: off by default, owner/admin only, another organization is "not found", and nothing but snapshots is written', async () => {
    const w = await world()
    await expect(refreshBalances({ ...w.deps, balancesEnabled: false }, w.owner, { itemId: w.item.id })).rejects.toMatchObject({ code: 'feature_disabled' })
    expect(await getBalances({ ...w.deps, balancesEnabled: false }, w.owner)).toEqual({ accounts: [], enabled: false })
    await expect(refreshBalances(w.deps, { ...w.owner, role: 'employee' }, { itemId: w.item.id })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(getBalances(w.deps, { ...w.owner, role: 'employee' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(refreshBalances(w.deps, { ...w.owner, organizationId: ORG_B }, { itemId: w.item.id })).rejects.toMatchObject({ code: 'not_found' })
    await expect(refreshBalances(w.deps, w.owner, { itemId: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' })
    const before = await rows(db, `SELECT (SELECT count(*) FROM public.financial_accounts)::int AS accounts, (SELECT count(*) FROM public.financial_transactions)::int AS ledger, (SELECT count(*) FROM public.financial_provider_account_mappings)::int AS maps, (SELECT count(*) FROM public.financial_provider_transactions)::int AS evidence`)
    w.state.readings = [w.reading('chk')]
    await refreshBalances(w.deps, w.owner, { itemId: w.item.id })
    expect(await rows(db, `SELECT (SELECT count(*) FROM public.financial_accounts)::int AS accounts, (SELECT count(*) FROM public.financial_transactions)::int AS ledger, (SELECT count(*) FROM public.financial_provider_account_mappings)::int AS maps, (SELECT count(*) FROM public.financial_provider_transactions)::int AS evidence`)).toEqual(before)
  })

  it('the Netlify handler is closed by default: GET reports disabled, refresh is refused, before any bank or database call', async () => {
    const calls = []
    const overrides = { verifyUser: async () => ({ id: 'u1' }), userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: ORG, role: 'owner', is_active: true } }) }) }) }) }),
      serviceClient: () => ({ from: (t) => { calls.push(t); throw new Error('no database access expected') } }), plaidPort: () => ({ getAccountBalances: async () => { calls.push('plaid'); return [] } }) }
    const env = { PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') }
    const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]])); Object.assign(process.env, env); delete process.env.PLAID_BALANCES_ENABLED
    try {
      const ev = (method, body) => ({ httpMethod: method, headers: { authorization: 'Bearer t' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const get = await balancesHandler(overrides)(ev('GET'))
      expect(get.statusCode).toBe(200); expect(JSON.parse(get.body)).toEqual({ accounts: [], enabled: false })
      const post = await balancesHandler(overrides)(ev('POST', { action: 'refresh', itemId: '30000000-0000-4000-8000-000000000001' }))
      expect(post.statusCode).toBe(403)
      expect((await balancesHandler(overrides)(ev('POST', { action: 'nope' }))).statusCode).toBe(400)
      expect(calls).toEqual([])
    } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v } }
  })
})
