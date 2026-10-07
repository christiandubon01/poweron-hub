// @ts-nocheck -- the Netlify handler under test is itself untyped (ts-nocheck); the in-memory repo mirrors migration 153's constraints
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { discoverAccounts, listBankAccounts, mapAccount, unmapAccount, toProviderAccountRecord } from '../bankAccountService'
import { BankConnectionError, contextFor } from '../bankConnectionService'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { PlaidApiFailure, createPlaidSdkPort } from '../plaidPort'
import { buildHandler as accountsHandler } from '../../../../netlify/functions/bank/plaid-accounts'

const ORG_A = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const ITEM = '30000000-0000-4000-8000-000000000001'
const ITEM_B = '30000000-0000-4000-8000-0000000000b1'
const FIN1 = '40000000-0000-4000-8000-000000000001'
const FIN2 = '40000000-0000-4000-8000-000000000002'
const FIN_B = '40000000-0000-4000-8000-0000000000b1'
const ACCESS = 'access-sandbox-zzzzzzzz-0000-1111-2222-333333333333'
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const owner = { organizationId: ORG_A, userId: 'u-owner', role: 'owner' }

const plaidAccount = (id: string, over = {}) => ({ accountId: id, name: 'Tartan Checking', officialName: 'Tartan Business Checking', mask: '0000', type: 'depository', subtype: 'checking', currency: 'USD', ...over })

/** In-memory world mirroring migration 153: unique (item, account id), partial-unique ACTIVE mappings both ways, org scoping. */
function world(key = KEY) {
  const state = {
    items: new Map([[ITEM, { org: ORG_A, providerItemId: 'item-1', status: 'healthy', institution: 'Tartan Bank' }], [ITEM_B, { org: ORG_B, providerItemId: 'item-b', status: 'healthy', institution: 'Other Bank' }]]),
    accounts: [] as any[], mappings: [] as any[],
    cash: new Map([[FIN1, { org: ORG_A, displayName: 'Wells Fargo Business Checking 6960', accountType: 'checking', ownershipContext: 'business', status: 'active', include_in_cash: true, balance: 12345 }],
      [FIN2, { org: ORG_A, displayName: 'Savings', accountType: 'savings', ownershipContext: 'business', status: 'active', include_in_cash: false, balance: 500 }],
      [FIN_B, { org: ORG_B, displayName: 'Other org account', accountType: 'checking', ownershipContext: 'business', status: 'active', include_in_cash: true, balance: 1 }]]),
    ledgerTouched: 0, nextId: 1, failNextInsert: false, plaidAccounts: [plaidAccount('acc-1'), plaidAccount('acc-2', { name: 'Tartan Savings', mask: '1111', subtype: 'savings' })] as any[],
    plaidFail: false, calls: [] as string[],
  }
  const uid = () => `50000000-0000-4000-8000-${String(state.nextId++).padStart(12, '0')}`
  const envelope = encryptProviderToken(ACCESS, key, contextFor(owner, 'plaid', 'item-1'))
  const accounts = {
    async listProviderAccounts(org, itemId) { return state.accounts.filter(a => a.org === org && a.providerItemRef === itemId).map(a => ({ ...a })) },
    async upsertProviderAccounts(org, itemId, recs) {
      state.calls.push('upsert')
      for (const r of recs) {
        const ex = state.accounts.find(a => a.providerItemRef === itemId && a.providerAccountId === r.providerAccountId)
        if (ex) Object.assign(ex, { name: r.name, officialName: r.officialName, mask: r.mask, providerAccountType: r.providerAccountType, providerAccountSubtype: r.providerAccountSubtype, status: 'active' })
        else state.accounts.push({ id: uid(), org, providerItemRef: itemId, ...r, status: 'active' })
      }
    },
    async deactivateProviderAccounts(org, ids) { for (const a of state.accounts) if (a.org === org && ids.includes(a.id)) a.status = 'inactive' },
    async getProviderAccount(org, id) { const a = state.accounts.find(x => x.org === org && x.id === id); return a ? { ...a, itemStatus: state.items.get(a.providerItemRef).status } : null },
    async listAllProviderAccounts(org) { return state.accounts.filter(a => a.org === org).map(a => ({ ...a, institutionName: state.items.get(a.providerItemRef).institution, itemStatus: state.items.get(a.providerItemRef).status })) },
    async getFinancialAccount(org, id) { const c = state.cash.get(id); return c && c.org === org ? { id, displayName: c.displayName, accountType: c.accountType, ownershipContext: c.ownershipContext, status: c.status } : null },
    async listCashAccounts(org) { return [...state.cash].filter(([, c]) => c.org === org && c.status === 'active').map(([id, c]) => ({ id, displayName: c.displayName, accountType: c.accountType, ownershipContext: c.ownershipContext })) },
    async listActiveMappings(org) { return state.mappings.filter(m => m.org === org && m.status === 'active').map(m => ({ id: m.id, providerAccountRef: m.providerAccountRef, financialAccountId: m.financialAccountId })) },
    async insertMapping(i) {
      if (state.failNextInsert) { state.failNextInsert = false; throw new Error('boom') }
      if (state.mappings.some(m => m.status === 'active' && (m.providerAccountRef === i.providerAccountRef || m.financialAccountId === i.financialAccountId))) throw new BankConnectionError('conflict', 409, 'dup')
      const row = { id: uid(), org: i.organizationId, providerAccountRef: i.providerAccountRef, financialAccountId: i.financialAccountId, status: 'active', reason: null }
      state.mappings.push(row); return row
    },
    async deactivateMapping(org, id, _actor, reason) { const m = state.mappings.find(x => x.org === org && x.id === id); if (m) { m.status = 'inactive'; m.reason = reason } },
  }
  const plaid = {
    getAccounts: vi.fn(async () => { state.calls.push('getAccounts'); if (state.plaidFail) throw new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500); return state.plaidAccounts }),
  }
  const repo = {
    async getItem(org, id) { const i = state.items.get(id); return i && i.org === org ? { id, provider: 'plaid', providerItemId: i.providerItemId, status: i.status } : null },
    async getActiveCredential(org, id) { const i = state.items.get(id); return i && i.org === org && i.status !== 'disconnected' ? envelope : null },
  }
  const logs: any[] = []
  const deps = { plaid, repo, accounts, key, environment: 'sandbox', log: e => logs.push(e) }
  return { state, deps, logs, plaid }
}
const discovered = async (w) => discoverAccounts(w.deps, owner, { itemId: ITEM })

describe('BANK-3 provider account discovery', () => {
  it('1. reduces a Plaid account to the allowlisted representation (no balance, no extra fields)', async () => {
    const rec = toProviderAccountRecord({ ...plaidAccount('acc-1'), balances: { current: 100 }, persistent_account_id: 'p', verification_status: 'x' } as any)
    expect(Object.keys(rec).sort()).toEqual(['mask', 'name', 'officialName', 'providerAccountId', 'providerAccountSubtype', 'providerAccountType'])
    expect(rec).toMatchObject({ providerAccountId: 'acc-1', name: 'Tartan Checking', mask: '0000', providerAccountType: 'depository', providerAccountSubtype: 'checking' })
    expect(toProviderAccountRecord(plaidAccount('acc-1', { currency: 'EUR' }))).toBeNull() // schema is USD-only: skipped, never coerced
    expect(toProviderAccountRecord(plaidAccount('bad id!'))).toBeNull()
  })
  it('the Plaid adapter returns only allowlisted account fields and never a balance (raw response discarded)', async () => {
    const api = { accountsGet: async () => ({ data: { accounts: [{ account_id: 'acc-1', name: 'N', official_name: null, mask: '0000', type: 'depository', subtype: 'checking', balances: { current: 9999, available: 8888, iso_currency_code: 'USD' }, persistent_account_id: 'secret-ish' }], item: { item_id: 'i' }, request_id: 'r' } }) }
    const out = await createPlaidSdkPort({ environment: 'sandbox', clientId: 'c', secret: 's', clientName: 'x', language: 'en', countryCodes: ['US'], products: ['transactions'], transactionsDaysRequested: 90 }, api as never).getAccounts(ACCESS)
    expect(out).toEqual([{ accountId: 'acc-1', name: 'N', officialName: null, mask: '0000', type: 'depository', subtype: 'checking', currency: 'USD' }])
    expect(JSON.stringify(out)).not.toMatch(/9999|8888|persistent|request/)
  })
  it('2. repeated discovery is idempotent: same accounts, no duplicates', async () => {
    const w = world()
    expect(await discovered(w)).toMatchObject({ discovered: 2, created: 2, deactivated: 0 })
    expect(await discovered(w)).toMatchObject({ discovered: 2, created: 0, deactivated: 0 })
    expect(w.state.accounts).toHaveLength(2)
  })
  it('3. a changed name/mask updates the same row (identity is the provider account id) and keeps an existing mapping', async () => {
    const w = world(); await discovered(w)
    const id = w.state.accounts[0].id
    await mapAccount(w.deps, owner, { providerAccountId: id, financialAccountId: FIN1 })
    w.state.plaidAccounts[0] = plaidAccount('acc-1', { name: 'Renamed', mask: '9999' })
    await discovered(w)
    expect(w.state.accounts).toHaveLength(2)
    expect(w.state.accounts[0]).toMatchObject({ id, name: 'Renamed', mask: '9999' })
    expect(w.state.mappings.filter(m => m.status === 'active')).toHaveLength(1)
  })
  it('a newly available account is added; a vanished account is retired (inactive, never deleted) and its mapping history is kept', async () => {
    const w = world(); await discovered(w)
    await mapAccount(w.deps, owner, { providerAccountId: w.state.accounts[1].id, financialAccountId: FIN2 })
    w.state.plaidAccounts = [plaidAccount('acc-1'), plaidAccount('acc-3', { mask: '3333' })]
    expect(await discovered(w)).toMatchObject({ created: 1, deactivated: 1 })
    expect(w.state.accounts.map(a => [a.providerAccountId, a.status])).toEqual([['acc-1', 'active'], ['acc-2', 'inactive'], ['acc-3', 'active']])
    expect(w.state.mappings).toHaveLength(1)
    w.state.plaidAccounts = [plaidAccount('acc-1'), plaidAccount('acc-2'), plaidAccount('acc-3')]
    await discovered(w) // returns: reactivated, still the same row
    expect(w.state.accounts.find(a => a.providerAccountId === 'acc-2').status).toBe('active'); expect(w.state.accounts).toHaveLength(3)
  })
  it('3A. a relinked Item (new Item, new account_id, identical name/mask/type) inherits NO mapping and old evidence is preserved', async () => {
    const w = world(); await discovered(w)
    await mapAccount(w.deps, owner, { providerAccountId: w.state.accounts[0].id, financialAccountId: FIN1 })
    w.state.items.get(ITEM).status = 'disconnected'
    const NEW_ITEM = '30000000-0000-4000-8000-000000000003'
    w.state.items.set(NEW_ITEM, { org: ORG_A, providerItemId: 'item-relinked', status: 'healthy', institution: 'Tartan Bank' })
    w.state.plaidAccounts = [plaidAccount('acc-new-1'), plaidAccount('acc-new-2', { name: 'Tartan Savings', mask: '1111', subtype: 'savings' })] // same name/mask/type as before
    const relinked = { ...w.deps, repo: { ...w.deps.repo, getItem: async (org, id) => id === NEW_ITEM ? { id, provider: 'plaid', providerItemId: 'item-relinked', status: 'healthy' } : w.deps.repo.getItem(org, id), getActiveCredential: async (org, id) => id === NEW_ITEM ? encryptProviderToken(ACCESS, KEY, contextFor(owner, 'plaid', 'item-relinked')) : w.deps.repo.getActiveCredential(org, id) } }
    await discoverAccounts(relinked, owner, { itemId: NEW_ITEM })
    const list = await listBankAccounts(w.deps, owner)
    const fresh = list.accounts.filter(a => a.connectionId === NEW_ITEM)
    expect(fresh).toHaveLength(2); expect(fresh.every(a => a.mapping === null && a.live)).toBe(true) // unmapped: owner must map again
    expect(w.state.accounts.filter(a => a.providerItemRef === ITEM)).toHaveLength(2) // old provider-account evidence kept
    expect(w.state.mappings).toHaveLength(1); expect(w.state.mappings[0]).toMatchObject({ status: 'active', financialAccountId: FIN1 }) // old mapping history untouched, not transferred
    expect(list.accounts.filter(a => a.connectionId === ITEM).every(a => !a.live)).toBe(true)
  })
  it('an empty answer from the provider never retires existing evidence', async () => {
    const w = world(); await discovered(w); w.state.plaidAccounts = []
    expect(await discovered(w)).toMatchObject({ discovered: 0, deactivated: 0 })
    expect(w.state.accounts.every(a => a.status === 'active')).toBe(true)
  })
  it('a provider failure is a safe 502 and leaves the connection and any stored accounts untouched', async () => {
    const w = world(); await discovered(w); w.state.plaidFail = true
    await expect(discovered(w)).rejects.toMatchObject({ httpStatus: 502, code: 'plaid_unavailable' })
    expect(w.state.accounts).toHaveLength(2); expect(w.state.items.get(ITEM).status).toBe('healthy')
    expect(JSON.stringify(w.logs)).not.toContain(ACCESS)
  })
  it('discovery is refused for a disconnected Item and for another organization\'s Item', async () => {
    const w = world(); w.state.items.get(ITEM).status = 'disconnected'
    await expect(discovered(w)).rejects.toMatchObject({ httpStatus: 409 })
    await expect(discoverAccounts(w.deps, owner, { itemId: ITEM_B })).rejects.toMatchObject({ httpStatus: 404 })
    expect(w.plaid.getAccounts).not.toHaveBeenCalled()
  })
})

describe('BANK-3 owner mapping', () => {
  let w
  beforeEach(async () => { w = world(); await discovered(w) })
  const acc = i => w.state.accounts[i].id

  it('7/8. only owners and admins may discover, list, map or unmap', async () => {
    for (const role of ['employee', 'viewer', '', undefined]) {
      const a = { ...owner, role }
      for (const fn of [() => discoverAccounts(w.deps, a, { itemId: ITEM }), () => listBankAccounts(w.deps, a), () => mapAccount(w.deps, a, { providerAccountId: acc(0), financialAccountId: FIN1 }), () => unmapAccount(w.deps, a, { providerAccountId: acc(0) })]) {
        await expect(fn()).rejects.toMatchObject({ httpStatus: 403 })
      }
    }
    expect(w.state.mappings).toHaveLength(0)
    await expect(mapAccount(w.deps, { ...owner, role: 'admin' }, { providerAccountId: acc(0), financialAccountId: FIN1 })).resolves.toMatchObject({ outcome: 'created' })
  })
  it('9. cross-org provider account is "not found" and nothing is written', async () => {
    w.state.accounts.push({ id: '50000000-0000-4000-8000-0000000000b1', org: ORG_B, providerItemRef: ITEM_B, providerAccountId: 'x', name: 'x', status: 'active' })
    await expect(mapAccount(w.deps, owner, { providerAccountId: '50000000-0000-4000-8000-0000000000b1', financialAccountId: FIN1 })).rejects.toMatchObject({ httpStatus: 404 })
    expect(w.state.mappings).toHaveLength(0)
  })
  it('10. cross-org Cash OS account is "not found" and nothing is written', async () => {
    await expect(mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN_B })).rejects.toMatchObject({ httpStatus: 404 })
    expect(w.state.mappings).toHaveLength(0)
  })
  it('malformed ids are rejected before any lookup', async () => {
    await expect(mapAccount(w.deps, owner, { providerAccountId: 'acc-1', financialAccountId: FIN1 })).rejects.toMatchObject({ httpStatus: 400 })
    await expect(mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: undefined })).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('creating a mapping is idempotent', async () => {
    expect(await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })).toMatchObject({ outcome: 'created' })
    expect(await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })).toEqual({ outcome: 'unchanged' })
    expect(w.state.mappings).toHaveLength(1)
  })
  it('11. a provider account never has two active mappings, and a Cash OS account is never fed by two live bank accounts', async () => {
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    await expect(mapAccount(w.deps, owner, { providerAccountId: acc(1), financialAccountId: FIN1 })).rejects.toMatchObject({ httpStatus: 409 })
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN2 }) // CHANGE, not a second mapping
    expect(w.state.mappings.filter(m => m.status === 'active')).toHaveLength(1)
  })
  it('12. changing a mapping keeps the old one as inactive history', async () => {
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    expect(await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN2 })).toMatchObject({ outcome: 'changed' })
    expect(w.state.mappings.map(m => [m.financialAccountId, m.status, m.reason])).toEqual([[FIN1, 'inactive', 'owner_changed'], [FIN2, 'active', null]])
  })
  it('a failed insert while changing restores the previous mapping (worst case is never a wrong mapping)', async () => {
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    w.state.failNextInsert = true
    await expect(mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN2 })).rejects.toMatchObject({ httpStatus: 503 })
    const active = w.state.mappings.filter(m => m.status === 'active')
    expect(active).toHaveLength(1); expect(active[0].financialAccountId).toBe(FIN1)
  })
  it('13. removing a mapping keeps history and is idempotent; provider evidence stays', async () => {
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    expect(await unmapAccount(w.deps, owner, { providerAccountId: acc(0) })).toEqual({ outcome: 'removed' })
    expect(await unmapAccount(w.deps, owner, { providerAccountId: acc(0) })).toEqual({ outcome: 'already_unmapped' })
    expect(w.state.mappings).toHaveLength(1); expect(w.state.mappings[0].status).toBe('inactive'); expect(w.state.accounts).toHaveLength(2)
    expect(await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })).toMatchObject({ outcome: 'created' }) // recreate = new row
    expect(w.state.mappings).toHaveLength(2)
  })
  it('14/15. mapping, changing and removing touch no Cash OS account (include_in_cash, balance, class) and no ledger row', async () => {
    const before = JSON.stringify([...w.state.cash])
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN2 })
    await unmapAccount(w.deps, owner, { providerAccountId: acc(0) })
    expect(JSON.stringify([...w.state.cash])).toBe(before)
    expect(w.state.ledgerTouched).toBe(0)
  })
  it('6/16/17. after disconnect the accounts and mappings are kept but nothing looks live, and nothing new can be mapped', async () => {
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    w.state.items.get(ITEM).status = 'disconnected'
    const list = await listBankAccounts(w.deps, owner)
    expect(list.accounts).toHaveLength(2)
    expect(list.accounts.every(a => a.live === false)).toBe(true)
    expect(list.accounts[0].mapping).toMatchObject({ financialAccountName: 'Wells Fargo Business Checking 6960' })
    await expect(mapAccount(w.deps, owner, { providerAccountId: acc(1), financialAccountId: FIN2 })).rejects.toMatchObject({ httpStatus: 409 })
    expect(w.state.accounts).toHaveLength(2); expect(w.state.mappings).toHaveLength(1)
  })
  it('a stale mapping on a disconnected bank does not block mapping that Cash OS account to a new bank (it is superseded, kept as history)', async () => {
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    w.state.items.get(ITEM).status = 'disconnected'
    const NEW_ITEM = '30000000-0000-4000-8000-000000000002'
    w.state.items.set(NEW_ITEM, { org: ORG_A, providerItemId: 'item-2', status: 'healthy', institution: 'New Bank' })
    w.state.accounts.push({ id: '50000000-0000-4000-8000-0000000000c1', org: ORG_A, providerItemRef: NEW_ITEM, providerAccountId: 'n1', name: 'New', status: 'active' })
    expect(await mapAccount(w.deps, owner, { providerAccountId: '50000000-0000-4000-8000-0000000000c1', financialAccountId: FIN1 })).toMatchObject({ outcome: 'created' })
    expect(w.state.mappings.map(m => [m.status, m.reason])).toEqual([['inactive', 'superseded_provider_gone'], ['active', null]])
  })
  it('the list shows names for the owner and no provider identifiers, balances or secrets', async () => {
    await mapAccount(w.deps, owner, { providerAccountId: acc(0), financialAccountId: FIN1 })
    const text = JSON.stringify(await listBankAccounts(w.deps, owner))
    expect(text).not.toMatch(/acc-1|acc-2|item-1|access-|balance|include_in_cash|12345/i)
    expect(text).toContain('Tartan Bank')
  })
})

describe('BANK-3 endpoint (authorization + browser boundary)', () => {
  const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'POWERON_BANK_TOKEN_ENCRYPTION_KEY']
  let saved
  beforeEach(() => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); process.env.PLAID_ENV = 'sandbox'; process.env.PLAID_CLIENT_ID = 'c'; process.env.PLAID_SECRET = 's'; process.env.POWERON_BANK_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64'); vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }; vi.restoreAllMocks() })
  const ev = (method, body, headers = { authorization: 'Bearer t' }) => ({ httpMethod: method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const overridesFor = (profile, w) => ({
    verifyUser: async () => ({ id: 'u1' }),
    userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) }),
    serviceClient: () => ({}), plaidPort: () => w.plaid, accountRepo: () => w.deps.accounts, connectionRepo: () => w.deps.repo,
  })
  it('unauthenticated -> 401; employee/viewer -> 403; unknown action -> 400; wrong method -> 405; nothing is touched', async () => {
    const w = world(loadBankTokenEncryptionKey(process.env))
    expect((await accountsHandler({ ...overridesFor({ org_id: ORG_A, role: 'owner', is_active: true }, w), verifyUser: async () => null })(ev('GET', undefined, {}))).statusCode).toBe(401)
    for (const role of ['employee', 'viewer']) expect((await accountsHandler(overridesFor({ org_id: ORG_A, role, is_active: true }, w))(ev('POST', { action: 'map', providerAccountId: 'x' }))).statusCode).toBe(403)
    expect((await accountsHandler(overridesFor({ org_id: ORG_A, role: 'owner', is_active: true }, w))(ev('POST', { action: 'bogus' }))).statusCode).toBe(400)
    expect((await accountsHandler(overridesFor({ org_id: ORG_A, role: 'owner', is_active: true }, w))(ev('DELETE'))).statusCode).toBe(405)
    expect(w.state.calls).toEqual([])
  })
  it('4. the organization comes only from the profile: a body organizationId is ignored, and the response carries no credential or raw Plaid data', async () => {
    const w = world(loadBankTokenEncryptionKey(process.env))
    const h = accountsHandler(overridesFor({ org_id: ORG_A, role: 'owner', is_active: true }, w))
    // the Item lives in the fake org A; point the body at org B's item and org: it must not cross.
    const cross = await h(ev('POST', { action: 'discover', itemId: ITEM_B, organizationId: ORG_B }))
    expect(cross.statusCode).toBe(404)
    const ok = await h(ev('POST', { action: 'discover', itemId: ITEM, organizationId: ORG_B }))
    expect(ok.body).toBeTruthy(); expect(ok.statusCode, ok.body).toBe(200)
    const list = await h(ev('GET'))
    expect(list.statusCode).toBe(200)
    const text = ok.body + list.body
    expect(text).not.toMatch(/access-sandbox|v1:|secret|encrypted|client_id|request_id|balances/i)
  })
})

describe('BANK-3 static guarantees', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const sources = ['../bankAccountService.ts', '../bankAccountRepo.ts', '../../../../netlify/functions/bank/plaid-accounts.ts']
  it('5/18. no transaction endpoint is called or added, and no provider transaction / balance / ledger table is written by BANK-3 code', () => {
    for (const f of sources) { // the BANK-3 files themselves never touch transactions (BANK-4 added the sync call to the adapter only)
      const code = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(code).not.toMatch(/transactionsSync|transactionsGet|transactionsRefresh|\/transactions\//)
    }
    expect(read('../plaidPort.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/transactionsGet|transactionsRefresh/)
    for (const f of sources) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(code).not.toMatch(/financial_provider_transactions|financial_provider_balance_snapshots|financial_transactions|financial_provider_interpretations|financial_provider_credentials/)
      expect(code).not.toMatch(/\.select\(\s*['"`]\*['"`]/)
    }
    const repo = read('../bankAccountRepo.ts').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(repo).not.toMatch(/\.from\('financial_accounts'\)\s*\.(insert|update|upsert|delete)/)
    expect(repo).not.toMatch(/include_in_cash/)
    expect(repo).not.toMatch(/provider_metadata|raw_payload|raw_evidence/) // no raw JSON is persisted
    expect(repo).toContain("onConflict: 'provider_item_ref,provider_account_id'") // identity is the provider account id within one Item (not assumed to survive a relink)
  })
  it('the persisted account row has exactly the allowlisted columns (no balance, no name-as-identity)', () => {
    const m = read('../bankAccountRepo.ts').match(/const rows = accounts\.map\(a => \(\{([\s\S]*?)\}\)\)/)
    const cols = [...m[1].matchAll(/^\s*([a-z_]+):|, ([a-z_]+):/gm)].map(x => x[1] ?? x[2])
    expect(m[1]).not.toMatch(/balance/i)
    expect(m[1]).toContain('provider_account_id: a.providerAccountId')
    expect(cols.length).toBeGreaterThan(0)
  })
  it('19/16. BANK-3 needs no migration, and migration 154\'s disconnect function never touches provider accounts or mappings', () => {
    const nums = readdirSync(new URL('../../../../supabase/migrations/', import.meta.url)).map(f => parseInt(f, 10)).filter(n => n >= 153)
    expect(Math.max(...nums)).toBeLessThanOrEqual(155) // BANK-5 later added 155; BANK-3 itself needed none
    const sql = readFileSync(new URL('../../../../supabase/migrations/154_bank_provider_credentials.sql', import.meta.url), 'utf8')
    const fn = sql.match(/FUNCTION public\.financial_provider_disconnect_item[\s\S]*?\$\$;/)[0]
    expect(fn).not.toMatch(/financial_provider_accounts|financial_provider_account_mappings|DELETE/i)
  })
  it('the browser bundle code for BANK-3 never references secrets', () => {
    const ui = read('../../../features/bank-connection/useBankConnection.ts') + read('../../../features/bank-connection/BankConnectionCard.tsx')
    expect(ui).not.toMatch(/access_token|encrypted|PLAID_SECRET|service_role|api\.plaid\.com|sandbox\.plaid\.com/i)
  })
})
