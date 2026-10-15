// @ts-nocheck -- in-memory fakes mirror the repository contracts; the Netlify handlers under test are untyped
/**
 * PLAID-1A: adding accounts to the EXISTING Plaid Item (same bank login) without ever creating a second Item, and without any automatic import,
 * mapping, classification or reporting of the newly shared accounts. Everything runs on fakes: no network, no database, no Plaid call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { BankConnectionError, createLinkToken, exchangePublicToken, getConnectionStatus, contextFor } from '../bankConnectionService'
import { previewAccounts, previewAccountsForOwner, saveNewAccounts } from '../bankAccountService'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { createPlaidSdkPort, PlaidApiFailure } from '../plaidPort'
import { loadPlaidConfig } from '../plaidConfig'
import { buildRows } from '../spending/explorer'
import { buildSpendingReport, APPROVED_REPORTING_POLICY } from '../spending/reporting'
import { buildHandler as statusHandler } from '../../../../netlify/functions/bank/plaid-connection-status'
import { buildHandler as linkTokenHandler } from '../../../../netlify/functions/bank/plaid-link-token'

const ORG = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const OWNER = { organizationId: ORG, userId: '20000000-0000-4000-8000-000000000001', role: 'owner' }
const OWNER_B = { organizationId: ORG_B, userId: '20000000-0000-4000-8000-000000000002', role: 'owner' }
const WF_ITEM = '30000000-0000-4000-8000-000000000001'
const SANDBOX_ITEM = '30000000-0000-4000-8000-000000000002'
const WF = 'ins_127991'
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const ACCESS = 'access-production-EXISTINGWELLSFARGOTOKEN'
const PUBLIC = 'public-production-11111111-2222-3333-4444-555555555555'

const acct = (accountId: string, name: string, mask: string, type = 'depository', subtype = 'checking') => ({ accountId, name, officialName: null, mask, type, subtype, currency: 'USD' })

function world(opts: { environment?: 'sandbox' | 'production'; additions?: boolean } = {}) {
  const environment = opts.environment ?? 'production'
  const items = new Map([
    [WF_ITEM, { id: WF_ITEM, org: ORG, providerItemId: 'item-wf', institutionId: WF, status: 'healthy', environment: 'production' }],
    [SANDBOX_ITEM, { id: SANDBOX_ITEM, org: ORG, providerItemId: 'item-sb', institutionId: 'ins_109508', status: 'healthy', environment: 'sandbox' }],
  ])
  const credentials = new Map([[WF_ITEM, encryptProviderToken(ACCESS, KEY, contextFor(OWNER, 'plaid', 'item-wf'))], [SANDBOX_ITEM, encryptProviderToken('access-sandbox-xxxxxxxxxxxx', KEY, contextFor(OWNER, 'plaid', 'item-sb'))]])
  const writes: string[] = []
  const repo = {
    async findItemOwner(_p, pid) { const it = [...items.values()].find(i => i.providerItemId === pid); return it ? { id: it.id, organizationId: it.org } : null },
    async connectItem(input) { writes.push(`connect:${input.providerItemId}`); return { itemId: '30000000-0000-4000-8000-000000000099', outcome: 'created' } },
    async getItem(org, id) { const it = items.get(id); return it && it.org === org ? { id: it.id, provider: 'plaid', providerItemId: it.providerItemId, status: it.status, environment: it.environment } : null },
    async listItems(org) { return [...items.values()].filter(i => i.org === org).map(i => ({ id: i.id, provider: 'plaid', status: i.status, environment: i.environment, institutionName: 'Bank', connectedAt: null, disconnectedAt: null, lastSuccessfulSyncAt: null })) },
    async listLiveInstitutions(org) { return [...items.values()].filter(i => i.org === org && i.status !== 'disconnected').map(i => ({ id: i.id, institutionId: i.institutionId, environment: i.environment, status: i.status })) },
    async getActiveCredential(org, id) { const it = items.get(id); return it && it.org === org && it.status !== 'disconnected' ? credentials.get(id) ?? null : null },
    async disconnectItem() { writes.push('disconnect'); return 'disconnected' },
    async markHealthy() { writes.push('markHealthy'); return true },
  }
  // Stored provider accounts of the existing Item: checking (mapped) and a savings account.
  const stored = [
    { id: '40000000-0000-4000-8000-000000000001', org: ORG, providerItemRef: WF_ITEM, providerAccountId: 'wf-chk', name: 'Business Checking', officialName: null, mask: '6960', providerAccountType: 'depository', providerAccountSubtype: 'checking', status: 'active' },
    { id: '40000000-0000-4000-8000-000000000002', org: ORG, providerItemRef: WF_ITEM, providerAccountId: 'wf-sav', name: 'Business Savings', officialName: null, mask: '1111', providerAccountType: 'depository', providerAccountSubtype: 'savings', status: 'active' },
  ]
  const mappings = [{ id: 'm1', providerAccountRef: stored[0].id, financialAccountId: 'fa-1' }]
  const accounts = {
    async listProviderAccounts(org, itemId) { return stored.filter(a => a.org === org && a.providerItemRef === itemId).map(({ org: _o, ...a }) => ({ ...a })) },
    async upsertProviderAccounts(org, itemId, records) { writes.push(`upsert:${records.map(r => r.providerAccountId).join(',')}`); for (const r of records) stored.push({ id: `40000000-0000-4000-8000-0000000001${String(stored.length).padStart(2, '0')}`, org, providerItemRef: itemId, ...r, status: 'active' }) },
    async deactivateProviderAccounts() { writes.push('deactivate') },
    async markItemLoginRequired(org, id) { writes.push('loginRequired'); items.get(id).status = 'login_required' },
    async listActiveMappings() { return mappings },
    async insertMapping() { writes.push('insertMapping') },
    async deactivateMapping() { writes.push('deactivateMapping') },
  }
  const plaid = {
    createLinkToken: vi.fn(async () => ({ linkToken: 'link-production-abc', expiration: 'x' })),
    exchangePublicToken: vi.fn(async () => ({ accessToken: 'access-production-NEWDUPLICATE', itemId: 'item-new' })),
    getItem: vi.fn(async (token) => ({ itemId: token === ACCESS ? 'item-wf' : 'item-new', institutionId: WF, hasError: false })),
    getInstitutionName: vi.fn(async () => 'Wells Fargo'),
    getAccounts: vi.fn(async () => [acct('wf-chk', 'Business Checking', '6960'), acct('wf-sav', 'Business Savings', '1111'), acct('wf-card', 'Business Card', '4242', 'credit', 'credit card')]),
    syncTransactions: vi.fn(async () => { throw new Error('PLAID-1A never syncs') }),
    getWebhookVerificationKey: vi.fn(),
    removeItem: vi.fn(async () => {}),
  }
  const logs = []
  const deps = { plaid, repo, accounts, key: KEY, environment, accountAdditionsEnabled: opts.additions === true, log: e => logs.push(e) }
  return { deps, plaid, items, stored, writes, logs, mappings, credentials }
}

describe('PLAID-1A Plaid request shape', () => {
  const cfg = loadPlaidConfig({ PLAID_ENV: 'production', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', PLAID_WEBHOOK_URL: 'https://example.test/hook' })
  it('add_accounts is update mode with Account Select on the existing access token: no products, no history request, no webhook', async () => {
    const linkTokenCreate = vi.fn(async () => ({ data: { link_token: 'l', expiration: 'e' } }))
    await createPlaidSdkPort(cfg, { linkTokenCreate }).createLinkToken({ clientUserId: 'o.u', accessToken: ACCESS, accountSelection: true })
    const req = linkTokenCreate.mock.calls[0][0]
    expect(req.access_token).toBe(ACCESS)
    expect(req.update).toEqual({ account_selection_enabled: true })
    expect(req).not.toHaveProperty('products'); expect(req).not.toHaveProperty('transactions'); expect(req).not.toHaveProperty('webhook')
  })
  it('re-authentication and new connections are unchanged', async () => {
    const linkTokenCreate = vi.fn(async () => ({ data: { link_token: 'l', expiration: 'e' } }))
    const port = createPlaidSdkPort(cfg, { linkTokenCreate })
    await port.createLinkToken({ clientUserId: 'o.u', accessToken: ACCESS })
    expect(linkTokenCreate.mock.calls[0][0]).not.toHaveProperty('update')
    await port.createLinkToken({ clientUserId: 'o.u' })
    expect(linkTokenCreate.mock.calls[1][0]).toMatchObject({ products: ['transactions'], transactions: { days_requested: 730 } })
    expect(linkTokenCreate.mock.calls[1][0]).not.toHaveProperty('update')
  })
})

describe('PLAID-1A same-login account additions through the existing Item', () => {
  it('is refused while the server switch is off, before any credential is read or Plaid is called', async () => {
    const w = world()
    await expect(createLinkToken(w.deps, OWNER, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'feature_disabled', httpStatus: 403 })
    expect(w.plaid.createLinkToken).not.toHaveBeenCalled()
    expect((await getConnectionStatus(w.deps, OWNER)).accountAdditionsEnabled).toBe(false)
  })
  it('when enabled, opens update mode with Account Select for the SAME Item using its stored access token', async () => {
    const w = world({ additions: true })
    const out = await createLinkToken(w.deps, OWNER, { mode: 'add_accounts', itemId: WF_ITEM })
    expect(out.mode).toBe('add_accounts')
    expect(w.plaid.createLinkToken).toHaveBeenCalledWith({ clientUserId: `${ORG}.${OWNER.userId}`, accessToken: ACCESS, accountSelection: true })
    expect(w.writes).toEqual([]) // no Item, credential, account or mapping write
    expect(JSON.stringify(out)).not.toContain(ACCESS)
  })
  it('another organization cannot open it for this Item (not found, nothing called)', async () => {
    const w = world({ additions: true })
    await expect(createLinkToken(w.deps, OWNER_B, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'not_found' })
    await expect(previewAccounts(w.deps, OWNER_B, { itemId: WF_ITEM })).rejects.toMatchObject({ code: 'not_found' })
    expect(w.plaid.createLinkToken).not.toHaveBeenCalled(); expect(w.plaid.getAccounts).not.toHaveBeenCalled()
  })
  it('non-owners are refused', async () => {
    const w = world({ additions: true })
    await expect(createLinkToken(w.deps, { ...OWNER, role: 'employee' }, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('an Item of the other environment is refused', async () => {
    const w = world({ additions: true })
    await expect(createLinkToken(w.deps, OWNER, { mode: 'add_accounts', itemId: SANDBOX_ITEM })).rejects.toMatchObject({ code: 'conflict' })
    expect(w.plaid.createLinkToken).not.toHaveBeenCalled()
  })
  it('missing, revoked or unreadable credentials and sign-in-needed Items are refused without a provider call', async () => {
    const w = world({ additions: true })
    w.credentials.delete(WF_ITEM)
    await expect(createLinkToken(w.deps, OWNER, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'conflict' })
    const w2 = world({ additions: true }); w2.credentials.set(WF_ITEM, encryptProviderToken(ACCESS, KEY, contextFor(OWNER, 'plaid', 'some-other-item')))
    await expect(createLinkToken(w2.deps, OWNER, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'credential_unreadable' })
    const w3 = world({ additions: true }); w3.items.get(WF_ITEM).status = 'login_required'
    await expect(createLinkToken(w3.deps, OWNER, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'login_required' })
    for (const x of [w, w2, w3]) expect(x.plaid.createLinkToken).not.toHaveBeenCalled()
  })
  it('unsupported update mode stops for owner review and NEVER falls back to a new Item', async () => {
    const w = world({ additions: true })
    w.plaid.createLinkToken.mockRejectedValueOnce(new PlaidApiFailure('INVALID_FIELD', 'INVALID_REQUEST', 400))
    await expect(createLinkToken(w.deps, OWNER, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'update_mode_unsupported', httpStatus: 409 })
    expect(w.plaid.createLinkToken).toHaveBeenCalledTimes(1)
    expect(w.plaid.exchangePublicToken).not.toHaveBeenCalled()
    w.plaid.createLinkToken.mockRejectedValueOnce(new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500))
    await expect(createLinkToken(w.deps, OWNER, { mode: 'add_accounts', itemId: WF_ITEM })).rejects.toMatchObject({ code: 'plaid_unavailable' })
  })
})

describe('PLAID-1A duplicate Item prevention', () => {
  it('a new connection is refused while a bank is connected, unless the owner states it is a different bank', async () => {
    const w = world()
    await expect(createLinkToken(w.deps, OWNER, {})).rejects.toMatchObject({ code: 'duplicate_institution' })
    expect(w.plaid.createLinkToken).not.toHaveBeenCalled()
    await expect(createLinkToken(w.deps, OWNER, { differentInstitution: true })).resolves.toMatchObject({ mode: 'new' })
  })
  it('only Items of THIS environment count (a Sandbox test Item does not block, and is not blocked by, Production)', async () => {
    const w = world({ environment: 'sandbox' }); w.items.delete(SANDBOX_ITEM)
    await expect(createLinkToken(w.deps, OWNER, {})).resolves.toMatchObject({ mode: 'new' })
  })
  it('stage 1: Link reports the already-connected institution -> refused BEFORE any access token exists', async () => {
    const w = world()
    await expect(exchangePublicToken(w.deps, OWNER, { publicToken: PUBLIC, institutionId: WF })).rejects.toMatchObject({ code: 'duplicate_institution', httpStatus: 409 })
    expect(w.plaid.exchangePublicToken).not.toHaveBeenCalled(); expect(w.plaid.removeItem).not.toHaveBeenCalled(); expect(w.writes).toEqual([])
  })
  it('stage 2 (authoritative, from Plaid): same institution without a hint -> the extra Item is removed, nothing is saved, the existing Item is untouched', async () => {
    const w = world()
    await expect(exchangePublicToken(w.deps, OWNER, { publicToken: PUBLIC })).rejects.toMatchObject({ code: 'duplicate_institution' })
    expect(w.plaid.removeItem).toHaveBeenCalledWith('access-production-NEWDUPLICATE')
    expect(w.plaid.removeItem).not.toHaveBeenCalledWith(ACCESS)
    expect(w.writes).toEqual([])
    expect(w.items.get(WF_ITEM)).toMatchObject({ status: 'healthy', providerItemId: 'item-wf' })
    // a spoofed, wrong hint does not bypass stage 2
    await expect(exchangePublicToken(world().deps, OWNER, { publicToken: PUBLIC, institutionId: 'ins_1' })).rejects.toMatchObject({ code: 'duplicate_institution' })
  })
  it('if the extra Item cannot be removed it is still refused and flagged for owner review', async () => {
    const w = world(); w.plaid.removeItem.mockRejectedValueOnce(new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500))
    const err = await exchangePublicToken(w.deps, OWNER, { publicToken: PUBLIC }).catch(e => e)
    expect(err).toBeInstanceOf(BankConnectionError); expect(err.code).toBe('duplicate_institution'); expect(err.message).toMatch(/owner review/)
    expect(w.writes).toEqual([])
  })
  it('a different institution connects normally; names are never compared', async () => {
    const w = world(); w.plaid.getItem.mockImplementation(async () => ({ itemId: 'item-new', institutionId: 'ins_3', hasError: false }))
    w.plaid.getInstitutionName.mockResolvedValue('Wells Fargo') // same NAME, different institution id: not a duplicate by name alone
    await expect(exchangePublicToken(w.deps, OWNER, { publicToken: PUBLIC, institutionId: 'ins_3' })).resolves.toMatchObject({ outcome: 'created' })
    expect(w.writes).toEqual(['connect:item-new']); expect(w.plaid.removeItem).not.toHaveBeenCalled()
  })
  it('an existing connection without an institution id cannot be compared -> refused for owner review', async () => {
    const w = world(); w.items.get(WF_ITEM).institutionId = null
    w.plaid.getItem.mockImplementation(async () => ({ itemId: 'item-new', institutionId: 'ins_3', hasError: false }))
    await expect(exchangePublicToken(w.deps, OWNER, { publicToken: PUBLIC })).rejects.toMatchObject({ code: 'duplicate_unverifiable' })
    expect(w.writes).toEqual([]); expect(w.plaid.removeItem).toHaveBeenCalledTimes(1)
  })
  it('re-exchanging the SAME Item (credential rotation) is not treated as a duplicate', async () => {
    const w = world(); w.plaid.exchangePublicToken.mockResolvedValueOnce({ accessToken: ACCESS, itemId: 'item-wf' })
    await expect(exchangePublicToken(w.deps, OWNER, { publicToken: PUBLIC })).resolves.toMatchObject({ outcome: 'created' })
    expect(w.plaid.removeItem).not.toHaveBeenCalled()
  })
})

describe('PLAID-1A account discovery preview and explicit save', () => {
  it('preview is read-only, confirms the same Item and separates connected / newly shared / no longer shared', async () => {
    const w = world({ additions: true })
    w.plaid.getAccounts.mockResolvedValueOnce([acct('wf-chk', 'Business Checking', '6960'), acct('wf-card', 'Business Card', '4242', 'credit', 'credit card')])
    const p = await previewAccountsForOwner(w.deps, OWNER, { itemId: WF_ITEM })
    expect(p.itemPreserved).toBe(true)
    expect(p.connected).toEqual([expect.objectContaining({ name: 'Business Checking', mask: '6960', mapped: true })])
    expect(p.available).toEqual([expect.objectContaining({ name: 'Business Card', mask: '4242', type: 'credit', previouslyConnected: false })])
    expect(p.noLongerShared).toEqual([expect.objectContaining({ name: 'Business Savings', mapped: false })])
    expect(p).not.toHaveProperty('availableRecords')
    expect(JSON.stringify(p)).not.toMatch(/wf-chk|wf-card|wf-sav|access-/) // no provider ids or tokens leave the server
    expect(w.writes).toEqual([]) // nothing saved, retired or mapped
  })
  it('a connection that is no longer the same Item at Plaid is refused for owner review', async () => {
    const w = world({ additions: true }); w.plaid.getItem.mockResolvedValueOnce({ itemId: 'item-someone-else', institutionId: WF, hasError: false })
    await expect(previewAccounts(w.deps, OWNER, { itemId: WF_ITEM })).rejects.toMatchObject({ code: 'conflict' })
    expect(w.plaid.getAccounts).not.toHaveBeenCalled(); expect(w.writes).toEqual([])
  })
  it('expired sign-in during preview marks the Item and asks for Reconnect', async () => {
    const w = world({ additions: true }); w.plaid.getAccounts.mockRejectedValueOnce(new PlaidApiFailure('ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', 400))
    await expect(previewAccounts(w.deps, OWNER, { itemId: WF_ITEM })).rejects.toMatchObject({ code: 'login_required' })
    expect(w.writes).toEqual(['loginRequired'])
  })
  it('save stores ONLY the previewed new accounts, unmapped, and never changes or retires existing account identities', async () => {
    const w = world({ additions: true })
    const before = JSON.stringify(w.stored)
    const { previewToken } = await previewAccountsForOwner(w.deps, OWNER, { itemId: WF_ITEM })
    const out = await saveNewAccounts(w.deps, OWNER, { itemId: WF_ITEM, previewToken })
    expect(out).toEqual({ saved: 1, mapped: 0 })
    expect(w.writes).toEqual(['upsert:wf-card'])
    expect(w.stored.slice(0, 2)).toEqual(JSON.parse(before)) // existing rows: same ids, provider ids, status and metadata
    expect(w.mappings).toHaveLength(1)
  })
  it('save is refused while switched off, without a preview, or when the bank answer changed since the preview', async () => {
    const off = world()
    await expect(saveNewAccounts(off.deps, OWNER, { itemId: WF_ITEM, previewToken: 'a'.repeat(32) })).rejects.toMatchObject({ code: 'feature_disabled' })
    const w = world({ additions: true })
    await expect(saveNewAccounts(w.deps, OWNER, { itemId: WF_ITEM })).rejects.toMatchObject({ code: 'invalid_request' })
    const { previewToken } = await previewAccountsForOwner(w.deps, OWNER, { itemId: WF_ITEM })
    w.plaid.getAccounts.mockResolvedValueOnce([acct('wf-chk', 'Business Checking', '6960'), acct('wf-card', 'Business Card', '4242', 'credit', 'credit card'), acct('wf-loan', 'Line', '9', 'loan', 'line of credit')])
    await expect(saveNewAccounts(w.deps, OWNER, { itemId: WF_ITEM, previewToken })).rejects.toMatchObject({ code: 'conflict' })
    expect(w.writes).toEqual([])
    await expect(saveNewAccounts(w.deps, OWNER_B, { itemId: WF_ITEM, previewToken })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('PLAID-1A no automatic reporting inclusion', () => {
  it('a newly saved, unmapped account is outside every default (mapped) report and explorer total', () => {
    const accounts = [
      { providerAccountRef: 'chk', label: 'Checking', mask: '6960', ownership: 'business', financialAccountId: 'fa-1', financialAccountName: 'Checking', environment: 'production' },
      { providerAccountRef: 'card', label: 'Business Card', mask: '4242', ownership: null, financialAccountId: null, financialAccountName: null, environment: 'production' },
    ]
    const tx = (id, ref, amountMinor) => ({ id, providerAccountRef: ref, date: '2026-10-05', name: 'HOME DEPOT', merchantName: 'Home Depot', amountMinor, pending: false, removed: false, category: null })
    const input = { asOf: '2026-10-11', accountScope: 'mapped', activeEnvironment: 'production', txs: [tx('a', 'chk', 1000), tx('b', 'card', 50000)], accounts, decisions: [], bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [] }
    const { rows, outOfScopeDates } = buildRows(input)
    expect(rows.map(r => r.id)).toEqual(['a']); expect(outOfScopeDates).toHaveLength(1)
    const all = buildRows({ ...input, accountScope: 'all', includeRemoved: true }).rows
    const report = buildSpendingReport(all, 'all_money', { from: '2026-10-01', to: '2026-10-31', accounts: 'mapped', environment: 'production' }, APPROVED_REPORTING_POLICY, { complete: true, reason: null })
    expect(report.rows.map(r => r.id)).toEqual(['a']); expect(report.summary.outMinor).toBe(1000)
  })
})

describe('PLAID-1A endpoints', () => {
  const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'POWERON_BANK_TOKEN_ENCRYPTION_KEY', 'PLAID_ACCOUNT_ADDITIONS_ENABLED']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    Object.assign(process.env, { PLAID_ENV: 'production', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
    delete process.env.PLAID_ACCOUNT_ADDITIONS_ENABLED
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } vi.restoreAllMocks() })
  const overrides = (plaid = { createLinkToken: vi.fn() }) => ({
    verifyUser: async () => ({ id: 'u1' }), plaidPort: () => plaid,
    userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: ORG, role: 'owner', is_active: true } }) }) }) }) }),
    serviceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }), rpc: async () => ({ data: null, error: { message: 'x' } }) }),
  })
  const ev = (method, body) => ({ httpMethod: method, headers: { authorization: 'Bearer t' }, body: body === undefined ? undefined : JSON.stringify(body) })
  it('the switch is server configuration only: off by default, on only for exactly "true", and never taken from a request', async () => {
    let res = await statusHandler(overrides())(ev('GET'))
    expect(JSON.parse(res.body).accountAdditionsEnabled).toBe(false)
    process.env.PLAID_ACCOUNT_ADDITIONS_ENABLED = 'TRUE'
    res = await statusHandler(overrides())(ev('GET')); expect(JSON.parse(res.body).accountAdditionsEnabled).toBe(false)
    process.env.PLAID_ACCOUNT_ADDITIONS_ENABLED = 'true'
    res = await statusHandler(overrides())(ev('GET')); expect(JSON.parse(res.body).accountAdditionsEnabled).toBe(true)
  })
  it('the link-token endpoint refuses add_accounts while off, even if the body asks for it', async () => {
    const plaid = { createLinkToken: vi.fn() }
    const res = await linkTokenHandler(overrides(plaid))(ev('POST', { mode: 'add_accounts', itemId: WF_ITEM, accountAdditionsEnabled: true }))
    expect(res.statusCode).toBe(403); expect(JSON.parse(res.body).code).toBe('feature_disabled')
    expect(plaid.createLinkToken).not.toHaveBeenCalled()
  })
})
