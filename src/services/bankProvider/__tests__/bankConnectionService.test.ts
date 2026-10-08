import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import {
  BankConnectionError, completeUpdateMode, createLinkToken, disconnectConnection, exchangePublicToken, getConnectionStatus,
  type BankActor, type BankConnectionDeps, type BankConnectionRepo, type BankConnectionView, type SafeLogEvent,
} from '../bankConnectionService'
import { decryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { createPlaidSdkPort, PlaidApiFailure, type BankPlaidPort } from '../plaidPort'
import { loadPlaidConfig } from '../plaidConfig'

const ORG_A = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const OWNER_A: BankActor = { organizationId: ORG_A, userId: '20000000-0000-4000-8000-000000000001', role: 'owner' }
const ADMIN_A: BankActor = { ...OWNER_A, role: 'admin' }
const EMPLOYEE_A: BankActor = { ...OWNER_A, role: 'employee' }
const OWNER_B: BankActor = { organizationId: ORG_B, userId: '20000000-0000-4000-8000-000000000002', role: 'owner' }
const SECRET_ACCESS = 'access-sandbox-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const PUBLIC = 'public-sandbox-11111111-2222-3333-4444-555555555555'
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })

class FakePlaid implements BankPlaidPort {
  calls: string[] = []
  tokens = new Map<string, { itemId: string; accessToken: string }>([[PUBLIC, { itemId: 'item-1', accessToken: SECRET_ACCESS }]])
  used = new Set<string>()
  failLinkToken = false
  failGetItem = false
  failRemove: string | null = null
  itemHasError = false
  institution = { id: 'ins_109508', name: 'First Platypus Bank' }
  linkInputs: Array<{ clientUserId: string; accessToken?: string }> = []
  async createLinkToken(input: { clientUserId: string; accessToken?: string }) {
    this.calls.push('createLinkToken'); this.linkInputs.push(input)
    if (this.failLinkToken) throw new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500)
    return { linkToken: 'link-sandbox-token', expiration: '2026-10-06T12:00:00Z' }
  }
  async exchangePublicToken(publicToken: string) {
    this.calls.push('exchange')
    const t = this.tokens.get(publicToken)
    if (!t || this.used.has(publicToken)) throw new PlaidApiFailure('INVALID_PUBLIC_TOKEN', 'INVALID_INPUT', 400) // single use
    this.used.add(publicToken)
    return t
  }
  async getItem(accessToken: string) {
    this.calls.push('getItem')
    if (this.failGetItem) throw new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500)
    const itemId = [...this.tokens.values()].find(t => t.accessToken === accessToken)?.itemId ?? 'item-1'
    return { itemId, institutionId: this.institution.id, hasError: this.itemHasError }
  }
  async getInstitutionName() { this.calls.push('institution'); return this.institution.name }
  async getAccounts() { this.calls.push('getAccounts'); return [] }
  async syncTransactions(): Promise<never> { throw new Error('BANK-2 tests never sync') }
  async getWebhookVerificationKey(): Promise<never> { throw new Error('BANK-2 tests never verify webhooks') }
  async removeItem() { this.calls.push('removeItem'); if (this.failRemove) throw new PlaidApiFailure(this.failRemove, 'ITEM_ERROR', 400) }
}

/** Faithful in-memory repo: item + credential saved together, one active credential, cross-org refusal. */
class MemoryRepo implements BankConnectionRepo {
  items = new Map<string, { id: string; organizationId: string; provider: string; providerItemId: string; status: BankConnectionView['status']; environment: 'sandbox' | 'production'; institutionName: string | null; connectedAt: string | null; disconnectedAt: string | null }>()
  credentials: Array<{ organizationId: string; itemId: string; envelope: string; status: 'active' | 'revoked' }> = []
  failConnect = false
  failDisconnect = false
  private seq = 0
  async findItemOwner(provider: string, providerItemId: string) {
    const it = [...this.items.values()].find(i => i.provider === provider && i.providerItemId === providerItemId)
    return it ? { id: it.id, organizationId: it.organizationId } : null
  }
  async connectItem(input: Parameters<BankConnectionRepo['connectItem']>[0]) {
    if (this.failConnect) throw new Error('db down')
    const existing = [...this.items.values()].find(i => i.provider === input.provider && i.providerItemId === input.providerItemId)
    if (existing && existing.organizationId !== input.organizationId) throw new BankConnectionError('item_owned_elsewhere', 409, 'This bank connection cannot be completed.')
    let outcome: 'created' | 'credential_rotated' | 'reconnected' = 'created'
    let item = existing
    if (!item) {
      item = { id: `30000000-0000-4000-8000-${String(++this.seq).padStart(12, '0')}`, organizationId: input.organizationId, provider: input.provider, providerItemId: input.providerItemId, status: 'healthy', environment: input.environment, institutionName: input.institutionName, connectedAt: 'now', disconnectedAt: null }
      this.items.set(item.id, item)
    } else {
      outcome = item.status === 'disconnected' ? 'reconnected' : 'credential_rotated'
      this.credentials.filter(c => c.itemId === item!.id && c.status === 'active').forEach(c => { c.status = 'revoked' })
      item.status = 'healthy'; item.disconnectedAt = null
    }
    this.credentials.push({ organizationId: input.organizationId, itemId: item.id, envelope: input.encryptedAccessToken, status: 'active' })
    return { itemId: item.id, outcome }
  }
  async getItem(organizationId: string, itemId: string) {
    const it = this.items.get(itemId)
    return it && it.organizationId === organizationId ? { id: it.id, provider: it.provider, providerItemId: it.providerItemId, status: it.status, environment: it.environment } : null
  }
  async listItems(organizationId: string) {
    return [...this.items.values()].filter(i => i.organizationId === organizationId).map(i => ({ id: i.id, provider: i.provider, status: i.status, environment: i.environment, institutionName: i.institutionName, connectedAt: i.connectedAt, disconnectedAt: i.disconnectedAt, lastSuccessfulSyncAt: null }))
  }
  async getActiveCredential(organizationId: string, itemId: string) {
    return this.credentials.find(c => c.organizationId === organizationId && c.itemId === itemId && c.status === 'active')?.envelope ?? null
  }
  async disconnectItem(organizationId: string, itemId: string) {
    if (this.failDisconnect) throw new Error('db down')
    const it = this.items.get(itemId)
    if (!it || it.organizationId !== organizationId) throw new Error('not found')
    this.credentials.filter(c => c.itemId === itemId && c.status === 'active').forEach(c => { c.status = 'revoked' })
    if (it.status === 'disconnected') return 'already_disconnected' as const
    it.status = 'disconnected'; it.disconnectedAt = 'now'
    return 'disconnected' as const
  }
  async markHealthy(organizationId: string, itemId: string) {
    const it = this.items.get(itemId)
    if (!it || it.organizationId !== organizationId || !['login_required', 'error', 'connecting'].includes(it.status)) return false
    it.status = 'healthy'; return true
  }
}

describe('bank connection service (BANK-2)', () => {
  let plaid: FakePlaid, repo: MemoryRepo, logs: SafeLogEvent[], deps: BankConnectionDeps
  beforeEach(() => {
    plaid = new FakePlaid(); repo = new MemoryRepo(); logs = []
    deps = { plaid, repo, key: KEY, environment: 'sandbox', log: e => logs.push(e) }
  })
  const connect = (actor = OWNER_A, token = PUBLIC) => exchangePublicToken(deps, actor, { publicToken: token })
  const expectError = async (promise: Promise<unknown>, code: string, status: number) => {
    const err = await promise.then(() => null, (e: unknown) => e as BankConnectionError)
    expect(err).toBeInstanceOf(BankConnectionError)
    expect([err!.code, err!.httpStatus]).toEqual([code, status])
    return err!
  }

  describe('authorization and organization isolation', () => {
    it('only owners and admins may act; employees and malformed actors are refused before any Plaid call', async () => {
      for (const actor of [EMPLOYEE_A, { ...OWNER_A, role: '' }, { ...OWNER_A, organizationId: '' }, { ...OWNER_A, userId: '' }]) {
        await expectError(createLinkToken(deps, actor), 'forbidden', 403)
        await expectError(exchangePublicToken(deps, actor, { publicToken: PUBLIC }), 'forbidden', 403)
        await expectError(getConnectionStatus(deps, actor), 'forbidden', 403)
        await expectError(disconnectConnection(deps, actor, { itemId: 'x' }), 'forbidden', 403)
      }
      expect(plaid.calls).toEqual([])
      await createLinkToken(deps, OWNER_A); await createLinkToken(deps, ADMIN_A)
    })

    it('the Plaid client user id is an opaque organization/user id (no email, name or phone) and organization comes from the actor, not the input', async () => {
      await createLinkToken(deps, OWNER_A, { mode: 'new', organizationId: ORG_B } as never)
      expect(plaid.linkInputs[0].clientUserId).toBe(`${ORG_A}.${OWNER_A.userId}`)
      expect(plaid.linkInputs[0].clientUserId).not.toContain(ORG_B)
      expect(plaid.linkInputs[0].clientUserId).not.toMatch(/@|\s/)
    })

    it('status, update-mode token and disconnect only ever see the caller\'s own organization', async () => {
      const { connection } = await connect(OWNER_A)
      expect((await getConnectionStatus(deps, OWNER_B)).connections).toEqual([]) // org B sees nothing of org A
      expect((await getConnectionStatus(deps, OWNER_A)).connections.map(c => c.id)).toEqual([connection.id])
      await expectError(createLinkToken(deps, OWNER_B, { mode: 'update', itemId: connection.id }), 'not_found', 404)
      await expectError(disconnectConnection(deps, OWNER_B, { itemId: connection.id }), 'not_found', 404)
      await expectError(completeUpdateMode(deps, OWNER_B, { itemId: connection.id }), 'not_found', 404)
      expect(repo.items.get(connection.id)!.status).toBe('healthy') // untouched
      expect(plaid.calls.filter(c => c === 'removeItem')).toEqual([])
    })
  })

  describe('Link token', () => {
    it('creates a new-connection token and returns only the token and its expiry', async () => {
      const out = await createLinkToken(deps, OWNER_A)
      expect(out).toEqual({ linkToken: 'link-sandbox-token', expiration: '2026-10-06T12:00:00Z', mode: 'new' })
      expect(plaid.linkInputs[0].accessToken).toBeUndefined()
    })
    it('update mode decrypts the stored credential server-side and never returns it', async () => {
      const { connection } = await connect()
      const out = await createLinkToken(deps, OWNER_A, { mode: 'update', itemId: connection.id })
      expect(out.mode).toBe('update')
      expect(plaid.linkInputs[plaid.linkInputs.length - 1].accessToken).toBe(SECRET_ACCESS)
      expect(JSON.stringify(out)).not.toContain(SECRET_ACCESS)
    })
    it('update mode is refused for a disconnected item, a missing item or a malformed id; unknown modes are rejected', async () => {
      const { connection } = await connect()
      await disconnectConnection(deps, OWNER_A, { itemId: connection.id })
      await expectError(createLinkToken(deps, OWNER_A, { mode: 'update', itemId: connection.id }), 'conflict', 409)
      await expectError(createLinkToken(deps, OWNER_A, { mode: 'update', itemId: 'nope' }), 'invalid_request', 400)
      await expectError(createLinkToken(deps, OWNER_A, { mode: 'update', itemId: '30000000-0000-4000-8000-0000000000ff' }), 'not_found', 404)
      await expectError(createLinkToken(deps, OWNER_A, { mode: 'transfer' }), 'invalid_request', 400)
    })
    it('a Plaid outage becomes a sanitized 502', async () => {
      plaid.failLinkToken = true
      const err = await expectError(createLinkToken(deps, OWNER_A), 'plaid_unavailable', 502)
      expect(err.message).not.toMatch(/INTERNAL|API_ERROR|500/)
    })
  })

  describe('public token exchange', () => {
    it('stores the access token ONLY as an encrypted, context-bound envelope and never returns it', async () => {
      const out = await connect()
      expect(out.outcome).toBe('created')
      expect(JSON.stringify(out)).not.toContain(SECRET_ACCESS)
      expect(out.connection).toMatchObject({ provider: 'plaid', status: 'healthy', institutionName: 'First Platypus Bank' })
      const stored = repo.credentials[0].envelope
      expect(stored).not.toContain(SECRET_ACCESS)
      expect(stored.startsWith('v1:')).toBe(true)
      expect(decryptProviderToken(stored, KEY, { organizationId: ORG_A, provider: 'plaid', providerItemId: 'item-1' })).toBe(SECRET_ACCESS)
      expect(() => decryptProviderToken(stored, KEY, { organizationId: ORG_B, provider: 'plaid', providerItemId: 'item-1' })).toThrow()
      // nothing in the item row is a token
      expect(JSON.stringify([...repo.items.values()])).not.toContain('access-sandbox')
    })

    it('rejects a malformed or missing public token without calling Plaid', async () => {
      for (const bad of [undefined, '', 'not-a-public-token', `public-${'x'.repeat(300)}`, 'public-<script>', 12 as never]) {
        await expectError(exchangePublicToken(deps, OWNER_A, { publicToken: bad }), 'invalid_request', 400)
      }
      expect(plaid.calls).toEqual([])
    })

    it('replay and duplicate submission: Plaid single-use makes the second attempt a clean 400 and exactly one item/credential exists', async () => {
      await connect()
      await expectError(connect(), 'invalid_public_token', 400)
      expect(repo.items.size).toBe(1)
      expect(repo.credentials.filter(c => c.status === 'active')).toHaveLength(1)
      expect((await getConnectionStatus(deps, OWNER_A)).connected).toBe(true) // the owner can see it already succeeded
    })

    it('the same Plaid item for the same organization rotates the credential (one active), never duplicating the item', async () => {
      await connect()
      plaid.tokens.set('public-sandbox-second-link-0000', { itemId: 'item-1', accessToken: 'access-sandbox-rotated-0000' })
      const out = await connect(OWNER_A, 'public-sandbox-second-link-0000')
      expect(out.outcome).toBe('credential_rotated')
      expect(repo.items.size).toBe(1)
      expect(repo.credentials.map(c => c.status)).toEqual(['revoked', 'active'])
    })

    it('an item that belongs to another organization FAILS CLOSED: no transfer, no credential, and the other org\'s item is never removed', async () => {
      await connect(OWNER_A)
      plaid.tokens.set('public-sandbox-hijack-0000', { itemId: 'item-1', accessToken: 'access-sandbox-hijack-0000' })
      const before = JSON.stringify([...repo.items.values()])
      const err = await expectError(connect(OWNER_B, 'public-sandbox-hijack-0000'), 'item_owned_elsewhere', 409)
      expect(err.message).not.toMatch(/organization|item-1/i)
      expect(JSON.stringify([...repo.items.values()])).toBe(before)
      expect(repo.credentials).toHaveLength(1)
      expect(plaid.calls).not.toContain('removeItem')
      expect((await getConnectionStatus(deps, OWNER_B)).connections).toEqual([])
    })

    it('atomicity: if saving fails, nothing is stored and a newly created Plaid item is removed again (no orphan)', async () => {
      repo.failConnect = true
      await expectError(connect(), 'persistence_failed', 503)
      expect(repo.items.size).toBe(0); expect(repo.credentials).toHaveLength(0)
      expect(plaid.calls).toContain('removeItem')
      const text = JSON.stringify(logs)
      expect(text).not.toContain(SECRET_ACCESS)
    })

    it('atomicity: a pre-existing item is NOT removed when a retry fails to save (its old credential stays valid)', async () => {
      await connect()
      repo.failConnect = true
      plaid.tokens.set('public-sandbox-retry-00000', { itemId: 'item-1', accessToken: 'access-sandbox-retry-0000' })
      plaid.calls.length = 0
      await expectError(connect(OWNER_A, 'public-sandbox-retry-00000'), 'persistence_failed', 503)
      expect(plaid.calls).not.toContain('removeItem')
      expect(repo.credentials.filter(c => c.status === 'active')).toHaveLength(1)
    })

    it('if the provider item lookup fails after exchange, nothing is persisted and the item is cleaned up', async () => {
      plaid.failGetItem = true
      await expectError(connect(), 'persistence_failed', 503)
      expect(repo.items.size).toBe(0); expect(repo.credentials).toHaveLength(0)
      expect(plaid.calls).toContain('removeItem')
    })

    it('if encryption cannot run (invalid key), nothing is persisted', async () => {
      deps = { ...deps, key: Buffer.alloc(8) }
      await expectError(connect(), 'persistence_failed', 503)
      expect(repo.items.size).toBe(0); expect(repo.credentials).toHaveLength(0)
    })

    it('a Plaid exchange outage is a sanitized 502', async () => {
      plaid.exchangePublicToken = async () => { throw new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500) }
      await expectError(connect(), 'plaid_unavailable', 502)
      expect(repo.items.size).toBe(0)
    })
  })

  describe('disconnect, reconnect and update-mode completion', () => {
    it('disconnect removes at the provider, revokes the credential, marks the item disconnected and deletes nothing', async () => {
      const { connection } = await connect()
      const out = await disconnectConnection(deps, OWNER_A, { itemId: connection.id })
      expect(out).toMatchObject({ status: 'disconnected', outcome: 'disconnected' })
      expect(plaid.calls).toContain('removeItem')
      expect(repo.items.has(connection.id)).toBe(true) // the record (and its history) is kept
      expect(repo.credentials.every(c => c.status === 'revoked')).toBe(true)
      expect(repo.credentials).toHaveLength(1)
    })
    it('disconnect is idempotent and retry-safe at both ends', async () => {
      const { connection } = await connect()
      plaid.failRemove = 'INTERNAL_SERVER_ERROR'
      await expectError(disconnectConnection(deps, OWNER_A, { itemId: connection.id }), 'plaid_unavailable', 502)
      expect(repo.items.get(connection.id)!.status).toBe('healthy') // Plaid failed: nothing changed locally
      plaid.failRemove = null; repo.failDisconnect = true
      await expectError(disconnectConnection(deps, OWNER_A, { itemId: connection.id }), 'disconnect_incomplete', 503)
      repo.failDisconnect = false
      expect((await disconnectConnection(deps, OWNER_A, { itemId: connection.id })).status).toBe('disconnected')
      expect((await disconnectConnection(deps, OWNER_A, { itemId: connection.id })).outcome).toBe('already_disconnected')
    })
    it('a disconnected item can be connected again without a duplicate item', async () => {
      const { connection } = await connect()
      await disconnectConnection(deps, OWNER_A, { itemId: connection.id })
      plaid.tokens.set('public-sandbox-again-000000', { itemId: 'item-1', accessToken: 'access-sandbox-again-0000' })
      const out = await connect(OWNER_A, 'public-sandbox-again-000000')
      expect(out.outcome).toBe('reconnected')
      expect(repo.items.size).toBe(1)
      expect(repo.credentials.filter(c => c.status === 'active')).toHaveLength(1)
    })
    it('update-mode completion clears a warning state only when the provider confirms the item is healthy', async () => {
      const { connection } = await connect()
      repo.items.get(connection.id)!.status = 'login_required'
      plaid.itemHasError = true
      expect(await completeUpdateMode(deps, OWNER_A, { itemId: connection.id })).toEqual({ id: connection.id, healthy: false })
      expect(repo.items.get(connection.id)!.status).toBe('login_required')
      plaid.itemHasError = false
      expect(await completeUpdateMode(deps, OWNER_A, { itemId: connection.id })).toEqual({ id: connection.id, healthy: true })
      expect(repo.items.get(connection.id)!.status).toBe('healthy')
    })
  })

  describe('sanitized status and logging', () => {
    it('status exposes only the allow-listed fields: no token, ciphertext, cursor or provider ids', async () => {
      await connect()
      const status = await getConnectionStatus(deps, OWNER_A)
      expect(status.environment).toBe('sandbox')
      expect(status.connected).toBe(true)
      expect(Object.keys(status.connections[0]).sort()).toEqual(['connectedAt', 'disconnectedAt', 'environment', 'id', 'institutionName', 'lastSuccessfulSyncAt', 'provider', 'status'])
      const text = JSON.stringify(status)
      expect(text).not.toMatch(/access-sandbox|v1:|cursor|item-1|encrypted/i)
    })
    it('logs contain only safe fields and never a token, public token or ciphertext', async () => {
      await connect()
      const { connection } = { connection: [...repo.items.values()][0] }
      await createLinkToken(deps, OWNER_A, { mode: 'update', itemId: connection.id })
      await disconnectConnection(deps, OWNER_A, { itemId: connection.id })
      const text = JSON.stringify(logs)
      expect(logs.length).toBeGreaterThan(2)
      expect(text).not.toContain(SECRET_ACCESS); expect(text).not.toContain(PUBLIC); expect(text).not.toMatch(/v1:|access-sandbox|public-sandbox/)
      for (const entry of logs) expect(Object.keys(entry).every(k => ['event', 'organizationId', 'itemId', 'outcome', 'code'].includes(k))).toBe(true)
    })
    it('a throwing logger can never break a connection', async () => {
      deps = { ...deps, log: () => { throw new Error('log sink down') } }
      expect((await connect()).outcome).toBe('created')
    })
  })

  describe('no financial effect', () => {
    it('the connection modules never read or write ledger, account, project, obligation, debt or payroll data', () => {
      const files = ['bankConnectionService', 'bankConnectionRepo', 'plaidPort', 'plaidConfig', 'providerTokenCrypto'].map(n => readFileSync(`src/services/bankProvider/${n}.ts`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')).join('\n')
      expect(files).not.toMatch(/financial_transactions|financial_accounts|financial_obligation|cash_commitments|financial_liability|app_state|include_in_cash|financial_provider_transactions|financial_provider_accounts/)
      // BANK-3 added /accounts/get and BANK-4 added /transactions/sync (adapter only). /transactions/get, /refresh and sandbox shortcuts stay forbidden.
      expect(files).not.toMatch(/transactionsGet|transactionsRefresh|transactionsRecurring|\/transactions\/(get|refresh)|sandboxPublicTokenCreate|sandboxItem|sandboxTransactions/)
    })
  })
})

describe('Plaid SDK adapter (no network)', () => {
  const config = loadPlaidConfig({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'cid', PLAID_SECRET: 'sec' })
  const make = (over: Record<string, unknown> = {}) => {
    const seen: Record<string, unknown[]> = {}
    const rec = (name: string, result: unknown) => async (req: unknown) => { (seen[name] ??= []).push(req); if (result instanceof Error) throw result; return { data: result } }
    const api = {
      linkTokenCreate: rec('linkTokenCreate', { link_token: 'link-x', expiration: 'soon', request_id: 'r' }),
      itemPublicTokenExchange: rec('exchange', { access_token: SECRET_ACCESS, item_id: 'item-9', request_id: 'r' }),
      itemGet: rec('itemGet', { item: { item_id: 'item-9', institution_id: 'ins_1', error: null } }),
      institutionsGetById: rec('institution', { institution: { name: '  Test Bank  ' } }),
      itemRemove: rec('itemRemove', { request_id: 'r' }),
      ...over,
    }
    return { port: createPlaidSdkPort(config, api as never), seen }
  }
  const axiosError = (code: string, type: string, status = 400) => Object.assign(new Error('axios secret-detail ' + SECRET_ACCESS), { response: { status, data: { error_code: code, error_type: type, error_message: 'detail ' + SECRET_ACCESS } } })

  it('initializes Transactions at Link via products=[transactions] with days_requested=90; no consent-only field, no other product, no webhook', async () => {
    const { port, seen } = make()
    await port.createLinkToken({ clientUserId: 'org.user' })
    const req = seen.linkTokenCreate[0] as Record<string, any>
    expect(req).toMatchObject({ client_name: 'Power On Hub', country_codes: ['US'], language: 'en', products: ['transactions'], transactions: { days_requested: 90 }, user: { client_user_id: 'org.user' } })
    expect(req.products).toEqual(['transactions'])
    expect(req.additional_consented_products).toBeUndefined(); expect(req.required_if_supported_products).toBeUndefined(); expect(req.optional_products).toBeUndefined()
    expect(req.access_token).toBeUndefined(); expect(req.webhook).toBeUndefined(); expect(req.redirect_uri).toBeUndefined()
  })
  it('makes NO transaction-data call while creating a Link token or exchanging (no /transactions/sync, /get or /refresh)', async () => {
    const { port, seen } = make()
    await port.createLinkToken({ clientUserId: 'org.user' })
    await port.exchangePublicToken(PUBLIC)
    expect(Object.keys(seen).filter((k) => /transactions/i.test(k))).toEqual([])
  })
  it('update mode passes the access token and NO products (per Plaid docs)', async () => {
    const { port, seen } = make()
    await port.createLinkToken({ clientUserId: 'org.user', accessToken: SECRET_ACCESS })
    const req = seen.linkTokenCreate[0] as Record<string, any>
    expect(req.access_token).toBe(SECRET_ACCESS)
    expect(req.products).toBeUndefined(); expect(req.additional_consented_products).toBeUndefined(); expect(req.transactions).toBeUndefined(); expect(req.update_mode).toBeUndefined()
  })
  it('returns minimal allow-listed shapes (no request ids, no raw responses)', async () => {
    const { port } = make()
    expect(await port.createLinkToken({ clientUserId: 'x' })).toEqual({ linkToken: 'link-x', expiration: 'soon' })
    expect(await port.exchangePublicToken(PUBLIC)).toEqual({ accessToken: SECRET_ACCESS, itemId: 'item-9' })
    expect(await port.getItem(SECRET_ACCESS)).toEqual({ itemId: 'item-9', institutionId: 'ins_1', hasError: false })
    expect(await port.getInstitutionName('ins_1')).toBe('Test Bank')
  })
  it('reduces any Plaid failure to a sanitized code: no message, no credentials', async () => {
    const { port } = make({ itemPublicTokenExchange: async () => { throw axiosError('INVALID_PUBLIC_TOKEN', 'INVALID_INPUT') } })
    const err = await port.exchangePublicToken(PUBLIC).then(() => null, (e: unknown) => e as PlaidApiFailure)
    expect(err).toBeInstanceOf(PlaidApiFailure)
    expect([err!.code, err!.type, err!.httpStatus]).toEqual(['INVALID_PUBLIC_TOKEN', 'INVALID_INPUT', 400])
    expect(err!.message + JSON.stringify(err)).not.toContain(SECRET_ACCESS)
    expect(err!.message).not.toMatch(/detail|axios/)
  })
  it('removing an Item that is already gone is a successful no-op; other failures surface', async () => {
    expect(await make({ itemRemove: async () => { throw axiosError('ITEM_NOT_FOUND', 'ITEM_ERROR') } }).port.removeItem(SECRET_ACCESS)).toBeUndefined()
    expect(await make({ itemRemove: async () => { throw axiosError('INVALID_ACCESS_TOKEN', 'INVALID_INPUT') } }).port.removeItem(SECRET_ACCESS)).toBeUndefined()
    await expect(make({ itemRemove: async () => { throw axiosError('INTERNAL_SERVER_ERROR', 'API_ERROR', 500) } }).port.removeItem(SECRET_ACCESS)).rejects.toBeInstanceOf(PlaidApiFailure)
  })
  it('an institution lookup failure is non-fatal (display name only)', async () => {
    expect(await make({ institutionsGetById: async () => { throw axiosError('INSTITUTION_NOT_FOUND', 'INVALID_INPUT') } }).port.getInstitutionName('ins_x')).toBeNull()
  })
  it('exposes no /transactions/get, refresh or sandbox-shortcut method (BANK-3 added /accounts/get; BANK-4 added /transactions/sync and webhook-key lookup)', () => {
    expect(Object.keys(make().port).sort()).toEqual(['createLinkToken', 'exchangePublicToken', 'getAccounts', 'getInstitutionName', 'getItem', 'getWebhookVerificationKey', 'removeItem', 'syncTransactions'])
  })
})
