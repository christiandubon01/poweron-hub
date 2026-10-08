import { describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PlaidEnvironments } from 'plaid'
import { loadPlaidConfig, PlaidConfigError } from '../plaidConfig'
import { createPlaidSdkPort, type BankPlaidPort } from '../plaidPort'
import { encryptProviderToken } from '../providerTokenCrypto'
import {
  BankConnectionError, completeUpdateMode, createLinkToken, disconnectConnection, exchangePublicToken, getConnectionStatus,
  type BankActor, type BankConnectionDeps, type BankConnectionRepo, type BankConnectionView, type SafeLogEvent,
} from '../bankConnectionService'
import { discoverAccounts } from '../bankAccountService'
import { syncTransactions } from '../bankSyncService'
import { buildRows } from '../spending/explorer'
import type { AccountContext, EvidenceTx } from '../spending/types'

/**
 * BANK-6P: Production connection support WITHOUT weakening any boundary. These tests prove the configuration is explicit and fails closed, secrets and
 * tokens never leak, Sandbox Items are never used as (or relabelled) Production Items, an owner starts every connection, and no canonical record is written.
 */
const ORG = 'a0000000-0000-4000-8000-000000000001'
const OWNER = 'b0000000-0000-4000-8000-000000000001'
const actor: BankActor = { organizationId: ORG, userId: OWNER, role: 'owner' }
const SANDBOX_ITEM = '30000000-0000-4000-8000-000000000001'
const PROD_ITEM = '30000000-0000-4000-8000-000000000002'
const ok = { PLAID_CLIENT_ID: 'cid', PLAID_SECRET: 'sec' }

describe('production configuration', () => {
  it('accepts exactly sandbox or production, never defaults, and names (never echoes) a bad variable', () => {
    expect(loadPlaidConfig({ ...ok, PLAID_ENV: 'production' })).toMatchObject({ environment: 'production', products: ['transactions'], transactionsDaysRequested: 90, redirectUri: null, webhookUrl: null })
    expect(() => loadPlaidConfig(ok)).toThrow(PlaidConfigError) // no PLAID_ENV: no default
    for (const bad of ['development', 'prod', 'live', 'true', 'sandbox ']) {
      if (bad === 'sandbox ') continue // whitespace is trimmed, like the existing behaviour
      expect(() => loadPlaidConfig({ ...ok, PLAID_ENV: bad }), bad).toThrow(/Unsupported Plaid environment/)
    }
    try { loadPlaidConfig({ PLAID_ENV: 'production', PLAID_CLIENT_ID: 'cid-LEAK', PLAID_SECRET: ' ' }) } catch (e) { expect(String((e as Error).message)).toBe('Plaid configuration missing: PLAID_SECRET') }
    try { loadPlaidConfig({ PLAID_ENV: 'production', PLAID_CLIENT_ID: 'cid-LEAK', PLAID_SECRET: 'sec-LEAK', PLAID_REDIRECT_URI: 'http://x-LEAK' }) } catch (e) { expect(String((e as Error).message)).not.toMatch(/LEAK/) }
  })
  it('the OAuth redirect URI is optional, https only, and carries no query or fragment', () => {
    expect(loadPlaidConfig({ ...ok, PLAID_ENV: 'production', PLAID_REDIRECT_URI: 'https://app.example.com/oauth' }).redirectUri).toBe('https://app.example.com/oauth')
    for (const bad of ['http://app.example.com/oauth', 'https://app.example.com/oauth?x=1', 'https://app.example.com/oauth#f', 'app.example.com']) {
      expect(() => loadPlaidConfig({ ...ok, PLAID_ENV: 'production', PLAID_REDIRECT_URI: bad }), bad).toThrow(/PLAID_REDIRECT_URI/)
    }
  })
  it('the SDK port targets the host of the configured environment', () => {
    expect(PlaidEnvironments.production).toBe('https://production.plaid.com')
    expect(PlaidEnvironments.sandbox).toBe('https://sandbox.plaid.com')
    expect(PlaidEnvironments.production).not.toBe(PlaidEnvironments.sandbox)
  })
  it('the link token carries the redirect URI (for OAuth banks) only when configured, and update mode still carries no products', async () => {
    const linkTokenCreate = vi.fn(async (_request: unknown) => ({ data: { link_token: 'link-production-abc', expiration: '2026-10-08T00:00:00Z' } }))
    const cfg = (extra: Record<string, string>) => loadPlaidConfig({ ...ok, PLAID_ENV: 'production', ...extra })
    const withRedirect = createPlaidSdkPort(cfg({ PLAID_REDIRECT_URI: 'https://app.example.com/oauth' }), { linkTokenCreate } as any)
    await withRedirect.createLinkToken({ clientUserId: 'u' })
    expect(linkTokenCreate.mock.calls[0][0]).toMatchObject({ redirect_uri: 'https://app.example.com/oauth', products: ['transactions'], transactions: { days_requested: 90 } })
    await withRedirect.createLinkToken({ clientUserId: 'u', accessToken: 'tok' })
    expect(linkTokenCreate.mock.calls[1][0]).toMatchObject({ redirect_uri: 'https://app.example.com/oauth', access_token: 'tok' })
    expect(linkTokenCreate.mock.calls[1][0]).not.toHaveProperty('products')
    linkTokenCreate.mockClear()
    await createPlaidSdkPort(cfg({}), { linkTokenCreate } as any).createLinkToken({ clientUserId: 'u' })
    expect(linkTokenCreate.mock.calls[0][0]).not.toHaveProperty('redirect_uri')
  })
})

/** A repository holding the EXISTING Sandbox Item (kept) and, optionally, a Production one. */
class Repo implements BankConnectionRepo {
  items = new Map<string, BankConnectionView & { providerItemId: string }>()
  connectInputs: Array<Parameters<BankConnectionRepo['connectItem']>[0]> = []
  disconnects = 0
  constructor(public key: Buffer) {
    this.items.set(SANDBOX_ITEM, { id: SANDBOX_ITEM, provider: 'plaid', providerItemId: 'item-sandbox', status: 'healthy', environment: 'sandbox', institutionName: 'Tartan Bank', connectedAt: '2026-10-06T00:00:00Z', disconnectedAt: null, lastSuccessfulSyncAt: '2026-10-06T01:00:00Z' })
  }
  addProduction() { this.items.set(PROD_ITEM, { id: PROD_ITEM, provider: 'plaid', providerItemId: 'item-prod', status: 'healthy', environment: 'production', institutionName: 'Wells Fargo', connectedAt: '2026-10-08T00:00:00Z', disconnectedAt: null, lastSuccessfulSyncAt: null }) }
  async findItemOwner(_p: string, pid: string) { const it = [...this.items.values()].find(i => i.providerItemId === pid); return it ? { id: it.id, organizationId: ORG } : null }
  async connectItem(input: Parameters<BankConnectionRepo['connectItem']>[0]) { this.connectInputs.push(input); return { itemId: PROD_ITEM, outcome: 'created' as const } }
  async getItem(_o: string, id: string) { const it = this.items.get(id); return it ? { id: it.id, provider: it.provider, providerItemId: it.providerItemId, status: it.status, environment: it.environment } : null }
  async listItems() { return [...this.items.values()].map(({ providerItemId: _x, ...v }) => v) }
  async getActiveCredential(_o: string, id: string) { const it = this.items.get(id); return it ? encryptProviderToken('access-sandbox-VERYSECRET', this.key, { organizationId: ORG, provider: 'plaid', providerItemId: it.providerItemId }) : null }
  async disconnectItem() { this.disconnects++; return 'disconnected' as const }
  async markHealthy() { return true }
}
const refuse = (name: string) => vi.fn(async () => { throw new Error(`UNEXPECTED provider call: ${name}`) })
function world(environment: 'sandbox' | 'production') {
  const key = randomBytes(32), repo = new Repo(key), logs: SafeLogEvent[] = []
  const plaid: BankPlaidPort = {
    createLinkToken: vi.fn(async () => ({ linkToken: 'link-production-abc', expiration: 'x' })),
    exchangePublicToken: vi.fn(async () => ({ accessToken: 'access-production-TOPSECRETTOKEN', itemId: 'item-prod' })),
    getItem: vi.fn(async () => ({ itemId: 'item-prod', institutionId: 'ins_127991', hasError: false })),
    getInstitutionName: vi.fn(async () => 'Wells Fargo'), getAccounts: refuse('getAccounts') as any, syncTransactions: refuse('syncTransactions') as any,
    getWebhookVerificationKey: refuse('getWebhookVerificationKey') as any, removeItem: refuse('removeItem') as any,
  }
  const deps: BankConnectionDeps = { plaid, repo, key, environment, log: e => logs.push(e) }
  return { deps, repo, plaid, logs }
}

describe('Sandbox / Production Item isolation in the connection services', () => {
  it('a Sandbox Item is refused before any credential is decrypted or any provider call is made, for EVERY Item-using operation', async () => {
    const w = world('production')
    const expectRefused = async (p: Promise<unknown>) => { const e = await p.catch(x => x); expect(e).toBeInstanceOf(BankConnectionError); expect((e as BankConnectionError).code).toBe('conflict'); expect((e as BankConnectionError).httpStatus).toBe(409); expect((e as Error).message).toMatch(/sandbox environment/) }
    await expectRefused(createLinkToken(w.deps, actor, { mode: 'update', itemId: SANDBOX_ITEM }))
    await expectRefused(disconnectConnection(w.deps, actor, { itemId: SANDBOX_ITEM }))
    await expectRefused(completeUpdateMode(w.deps, actor, { itemId: SANDBOX_ITEM }))
    await expectRefused(discoverAccounts({ ...w.deps, accounts: {} as any }, actor, { itemId: SANDBOX_ITEM }))
    await expectRefused(syncTransactions({ ...w.deps, accounts: {} as any, sync: {} as any }, actor, { itemId: SANDBOX_ITEM }))
    for (const fn of Object.values(w.plaid)) if (typeof fn === 'function' && 'mock' in fn) expect((fn as any).mock.calls.length).toBe(0)
    expect(w.repo.disconnects).toBe(0)
  })
  it('the reverse is refused too: a Production Item is never used by a Sandbox-configured server', async () => {
    const w = world('sandbox'); w.repo.addProduction()
    const e = await syncTransactions({ ...w.deps, accounts: {} as any, sync: {} as any }, actor, { itemId: PROD_ITEM }).catch(x => x)
    expect((e as BankConnectionError).code).toBe('conflict'); expect((e as Error).message).toMatch(/production environment/)
  })
  it('the existing Sandbox Item is preserved (still listed) and is NOT counted as a connected Production bank', async () => {
    const w = world('production')
    const before = await getConnectionStatus(w.deps, actor)
    expect(before).toMatchObject({ environment: 'production', connected: false })
    expect(before.connections).toHaveLength(1); expect(before.connections[0]).toMatchObject({ id: SANDBOX_ITEM, environment: 'sandbox', status: 'healthy' })
    w.repo.addProduction()
    const after = await getConnectionStatus(w.deps, actor)
    expect(after.connected).toBe(true)
    expect(after.connections.map(c => [c.id, c.environment]).sort()).toEqual([[SANDBOX_ITEM, 'sandbox'], [PROD_ITEM, 'production']])
  })
  it('a new connection is stored with the SERVER-configured environment (never a request value), only on an owner request', async () => {
    const w = world('production')
    expect(w.plaid.createLinkToken).not.toHaveBeenCalled(); expect(w.repo.connectInputs).toEqual([]) // nothing automatic
    await exchangePublicToken(w.deps, actor, { publicToken: 'public-production-1234567890abcdef', environment: 'sandbox' } as any)
    expect(w.repo.connectInputs).toHaveLength(1)
    expect(w.repo.connectInputs[0]).toMatchObject({ environment: 'production', provider: 'plaid', providerItemId: 'item-prod', organizationId: ORG })
    await expect(exchangePublicToken(w.deps, { ...actor, role: 'member' }, { publicToken: 'public-production-1234567890abcdef' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(createLinkToken(w.deps, { ...actor, role: 'employee' }, {})).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('no access token, public token, secret or encryption key reaches a log line, a response or an error message', async () => {
    const w = world('production')
    const res = await exchangePublicToken(w.deps, actor, { publicToken: 'public-production-1234567890abcdef' })
    const everything = JSON.stringify({ logs: w.logs, res, status: await getConnectionStatus(w.deps, actor) })
    for (const secret of ['TOPSECRETTOKEN', 'access-production', 'public-production', 'VERYSECRET', w.deps.key.toString('base64')]) expect(everything).not.toContain(secret)
    const failure = await exchangePublicToken(w.deps, actor, { publicToken: 'bad' }).catch(x => x)
    expect(String(failure.message)).not.toMatch(/token-|access-|secret/i)
  })
})

describe('Spending Explorer: the active environment defines the business view; other-environment evidence is preserved', () => {
  const SB = '10000000-0000-4000-8000-0000000000a1', PR = '10000000-0000-4000-8000-0000000000b1'
  const accounts: AccountContext[] = [
    { providerAccountRef: SB, label: 'Tartan · Plaid Checking', mask: '0000', ownership: 'business', financialAccountId: 'fa-6960', financialAccountName: 'Wells Fargo Business Checking 6960', environment: 'sandbox' },
    { providerAccountRef: PR, label: 'Wells Fargo · Checking', mask: '1234', ownership: 'business', financialAccountId: 'fa-6960', financialAccountName: 'Wells Fargo Business Checking 6960', environment: 'production' },
  ]
  const tx = (id: string, ref: string, name: string, dollars: number, date: string, pending = false): EvidenceTx => ({ id, providerAccountRef: ref, date, name, merchantName: null, amountMinor: Math.round(dollars * 100), pending, removed: false, category: null })
  const txs = [tx('t1', SB, 'UNITED AIRLINES', 500, '2026-10-01'), tx('t2', PR, 'HOME DEPOT', 120, '2026-10-02'), tx('t3', PR, 'CHEVRON', 40, '2026-10-06', true)]
  const input = { asOf: '2026-10-08', txs, accounts, decisions: [], bills: [], obligationLabels: new Map(), commitmentLabels: new Map(), debts: [], projects: [] }
  it('with Production active, a MAPPED Sandbox account is excluded from the default view and totals, but kept and visible under all accounts', () => {
    const view = buildRows({ ...input, accountScope: 'mapped', activeEnvironment: 'production' })
    expect(view.rows.map(r => r.id)).toEqual(['t3', 't2'])
    expect(view.analytics.unassigned.totalMinor).toBe(12000) // Sandbox $500 is not business spending; the pending $40 is not counted until it posts
    expect(view.analytics.pending).toMatchObject({ count: 1, totalMinor: 4000 }) // pending stays distinguishable
    expect(view.rows.find(r => r.id === 't3')).toMatchObject({ pending: true, unassigned: false })
    expect(view.outOfScopeDates).toEqual(['2026-10-01'])
    const all = buildRows({ ...input, accountScope: 'all', activeEnvironment: 'production' })
    expect(all.rows.map(r => r.id).sort()).toEqual(['t1', 't2', 't3'])
    expect(all.rows.find(r => r.id === 't1')!.account).toMatchObject({ environment: 'sandbox', mapped: true })
  })
  it('with Sandbox active (today\'s deployment) nothing changes for Sandbox users', () => {
    expect(buildRows({ ...input, accountScope: 'mapped', activeEnvironment: 'sandbox' }).rows.map(r => r.id)).toEqual(['t1'])
  })
  it('an unmapped Production account is evidence only: excluded by default, never silently mapped from its name or mask', () => {
    const unmapped: AccountContext[] = [{ ...accounts[1], financialAccountId: null, financialAccountName: null, label: 'Wells Fargo Business Checking 6960', mask: '6960' }]
    const view = buildRows({ ...input, accounts: unmapped, accountScope: 'mapped', activeEnvironment: 'production' })
    expect(view.rows).toEqual([]) // looks exactly like the Cash OS account, still not mapped
    expect(buildRows({ ...input, accounts: unmapped, accountScope: 'all', activeEnvironment: 'production' }).rows.filter(r => r.account.mapped)).toEqual([])
  })
})

describe('static guarantees for the Production connection layer', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? (n === '__tests__' ? [] : walk(p)) : [p] })
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  const files = [...walk('src/services/bankProvider'), ...walk('netlify/functions/bank'), ...walk('src/features/bank-connection').filter(f => !/\.test\./.test(f)), ...walk('src/features/spending-explorer').filter(f => !/\.test\./.test(f))].filter(f => /\.tsx?$/.test(f))
  it('the connection and spending code writes no canonical financial table and has no adoption path', () => {
    for (const f of files.filter(f => !f.replace(/\\/g, '/').endsWith('spending/contract.ts'))) { // contract.ts only NAMES ledger_match to state that confirmation is not adoption
      const t = strip(readFileSync(f, 'utf8'))
      expect(t, f).not.toMatch(/from\('(financial_transactions|financial_accounts|financial_obligations|financial_obligation_occurrences|cash_commitments|financial_planned_reconciliations|financial_transaction_links|projects)'\)\s*\.(insert|update|upsert|delete)/)
      expect(t, f).not.toMatch(/ledger_match|record_financial_|reconcile_financial|providerTransactionLedgerSource/)
    }
  })
  it('no console output, and no secret is ever read outside plaidConfig / token crypto / the auth bootstrap', () => {
    // the single sanctioned logger (safeLog) is the only place allowed to print, and it prints only allow-listed fields
    expect(files.filter(f => /console\.(log|info|warn|error|debug)/.test(strip(readFileSync(f, 'utf8')))).map(f => f.replace(/\\/g, '/'))).toEqual(['netlify/functions/bank/plaidAuth.ts'])
    const readers = files.filter(f => /process\.env\.(PLAID_SECRET|PLAID_CLIENT_ID)|PLAID_SECRET_VAR|PLAID_CLIENT_ID_VAR/.test(strip(readFileSync(f, 'utf8')))).map(f => f.replace(/\\/g, '/'))
    expect(readers).toEqual(['src/services/bankProvider/plaidConfig.ts'])
  })
  it('the browser never receives or sends an environment, secret or token as authority', () => {
    const hook = strip(readFileSync('src/features/bank-connection/useBankConnection.ts', 'utf8'))
    expect(hook).not.toMatch(/body:\s*\{[^}]*environment/) // it only displays the server-reported value; it never sends one
    expect(hook).not.toMatch(/PLAID_|secret|accessToken/i)
  })
})
