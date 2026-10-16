// @ts-nocheck -- the Netlify handler under test is untyped
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBankSyncRepo } from '../bankSyncRepo'
import { getSyncStatus, handleVerifiedWebhook } from '../bankSyncService'
import { buildHandler } from '../../../../netlify/functions/bank/plaid-webhook'

const ORG = '10000000-0000-4000-8000-00000000000a'
const PROD = '30000000-0000-4000-8000-000000000001'
const SAND = '30000000-0000-4000-8000-000000000002'

function world() {
  const state = {
    items: new Map([[PROD, { providerItemId: 'plaid-prod', status: 'healthy', environment: 'production' }], [SAND, { providerItemId: 'plaid-sand', status: 'healthy', environment: 'sandbox' }]]),
    events: [] as any[],
  }
  const repo = {
    async findItemOwner(_p, pid) { const e = [...state.items].find(([, i]) => i.providerItemId === pid); return e ? { id: e[0], organizationId: ORG } : null },
    async getItem(_o, id) { const i = state.items.get(id); return i ? { id, provider: 'plaid', providerItemId: i.providerItemId, status: i.status, environment: i.environment } : null },
    async markHealthy(_o, id) { const i = state.items.get(id); if (['login_required', 'error', 'connecting'].includes(i.status)) i.status = 'healthy'; return true },
    async listItems() { return [...state.items].map(([id, i]) => ({ id, status: i.status, environment: i.environment, institutionName: 'Wells Fargo' })) },
  }
  const sync = {
    async markLoginRequired(_o, id) { state.items.get(id).status = 'login_required' },
    async recordWebhook({ itemId, eventKey, webhookType, webhookCode, processed }) {
      const e = state.events.find(x => x.key === eventKey)
      if (e) { e.count += 1; if (!processed) e.status = 'received'; return 'duplicate' }
      state.events.push({ item: itemId, key: eventKey, type: webhookType, code: webhookCode, count: 1, status: processed ? 'processed' : 'received' }); return 'recorded'
    },
    async hasPendingNudge(_o, id) { return state.events.some(e => e.item === id && e.type === 'TRANSACTIONS' && e.status === 'received') },
    async openItemNotice(_o, id) { const e = state.events.find(x => x.item === id && x.type === 'ITEM' && x.status === 'received' && ['PENDING_EXPIRATION', 'PENDING_DISCONNECT'].includes(x.code)); return e ? { code: e.code, receivedAt: 'now' } : null },
    async markItemNoticesProcessed(_o, id) { for (const e of state.events) if (e.item === id && e.type === 'ITEM' && e.status === 'received') e.status = 'processed' },
    async lastWebhookAt(_o, id) { return state.events.some(e => e.item === id) ? '2026-10-16T10:00:00Z' : null },
    async getSyncState() { return null }, async countEvidence() { return { posted: 0, pending: 0, removed: 0 } },
  }
  return { state, repo, sync, deps: { repo, sync, log: vi.fn() } }
}
const input = (over = {}) => ({ webhookType: 'TRANSACTIONS', webhookCode: 'SYNC_UPDATES_AVAILABLE', plaidItemId: 'plaid-prod', bodyHash: 'h1', serverEnvironment: 'production', ...over })

describe('PLAID-2A webhook handling (verified bodies only)', () => {
  it('SYNC_UPDATES_AVAILABLE on a production Item records ONE nudge and asks for a background sync; a duplicate delivery is not a second event', async () => {
    const w = world()
    expect(await handleVerifiedWebhook(w.deps, input())).toEqual({ action: 'sync', organizationId: ORG, itemId: PROD })
    expect(await handleVerifiedWebhook(w.deps, input())).toMatchObject({ action: 'sync' })
    expect(w.state.events).toHaveLength(1); expect(w.state.events[0].count).toBe(2)
  })
  it('a SANDBOX Item (or a non-production server) never asks for a sync; unknown Items and other types are ignored', async () => {
    const w = world()
    expect(await handleVerifiedWebhook(w.deps, input({ plaidItemId: 'plaid-sand' }))).toMatchObject({ action: 'ignored' })
    expect(await handleVerifiedWebhook(w.deps, input({ serverEnvironment: 'sandbox', bodyHash: 'h2' }))).toMatchObject({ action: 'ignored' })
    expect(await handleVerifiedWebhook(w.deps, input({ plaidItemId: 'nope', bodyHash: 'h3' }))).toEqual({ action: 'ignored' })
    expect(await handleVerifiedWebhook(w.deps, input({ webhookType: 'HOLDINGS', bodyHash: 'h4' }))).toEqual({ action: 'ignored' })
  })
  it('ITEM_LOGIN_REQUIRED and revoked permission put the Item in sign-in-needed and are stored as handled (never as an "updates available" nudge)', async () => {
    const w = world()
    expect(await handleVerifiedWebhook(w.deps, input({ webhookType: 'ITEM', webhookCode: 'ERROR', errorCode: 'ITEM_LOGIN_REQUIRED', bodyHash: 'e1' }))).toMatchObject({ action: 'login_required' })
    expect(w.state.items.get(PROD).status).toBe('login_required')
    expect(await w.sync.hasPendingNudge(ORG, PROD)).toBe(false)
    w.state.items.get(PROD).status = 'healthy'
    expect(await handleVerifiedWebhook(w.deps, input({ webhookType: 'ITEM', webhookCode: 'USER_PERMISSION_REVOKED', bodyHash: 'e2' }))).toMatchObject({ action: 'login_required' })
    expect(w.state.items.get(PROD).status).toBe('login_required')
    expect(w.state.events.every(e => e.status === 'processed')).toBe(true)
  })
  it('an ITEM error that is not a sign-in problem changes nothing', async () => {
    const w = world()
    expect(await handleVerifiedWebhook(w.deps, input({ webhookType: 'ITEM', webhookCode: 'ERROR', errorCode: 'INTERNAL_SERVER_ERROR', bodyHash: 'e3' }))).toEqual({ action: 'ignored' })
    expect(w.state.items.get(PROD).status).toBe('healthy'); expect(w.state.events).toHaveLength(0)
  })
  it('PENDING_EXPIRATION / PENDING_DISCONNECT keep the Item working but surface a sign-in-soon notice; LOGIN_REPAIRED clears it and the warning', async () => {
    const w = world()
    expect(await handleVerifiedWebhook(w.deps, input({ webhookType: 'ITEM', webhookCode: 'PENDING_EXPIRATION', bodyHash: 'p1' }))).toMatchObject({ action: 'notice' })
    expect(w.state.items.get(PROD).status).toBe('healthy')
    expect((await getSyncStatus({ ...w.deps, accounts: {}, sync: w.sync, repo: w.repo }, { organizationId: ORG, userId: 'u', role: 'owner' })).syncs.find(s => s.connectionId === PROD).itemNotice).toEqual({ code: 'PENDING_EXPIRATION', receivedAt: 'now' })
    expect(await w.sync.hasPendingNudge(ORG, PROD)).toBe(false)
    w.state.items.get(PROD).status = 'login_required'
    expect(await handleVerifiedWebhook(w.deps, input({ webhookType: 'ITEM', webhookCode: 'LOGIN_REPAIRED', bodyHash: 'r1' }))).toMatchObject({ action: 'repaired' })
    expect(w.state.items.get(PROD).status).toBe('healthy')
    expect(await w.sync.openItemNotice(ORG, PROD)).toBeNull()
  })
  it('ITEM events for a Sandbox Item change nothing', async () => {
    const w = world()
    expect(await handleVerifiedWebhook(w.deps, input({ plaidItemId: 'plaid-sand', webhookType: 'ITEM', webhookCode: 'ERROR', errorCode: 'ITEM_LOGIN_REQUIRED', bodyHash: 's1' }))).toEqual({ action: 'ignored' })
    expect(w.state.items.get(SAND).status).toBe('healthy'); expect(w.state.events).toHaveLength(0)
  })
})

describe('PLAID-2A plaid-webhook endpoint kicks off the sync without ever failing the webhook', () => {
  const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_AUTO_SYNC_ENABLED', 'PLAID_RESUMABLE_SYNC_ENABLED']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    Object.assign(process.env, { PLAID_ENV: 'production', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', PLAID_AUTO_SYNC_ENABLED: 'true', PLAID_RESUMABLE_SYNC_ENABLED: 'true' })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }; vi.restoreAllMocks() })
  const body = (extra = {}) => JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'plaid-prod', ...extra })
  const call = (w, kick, b = body()) => buildHandler({ plaidPort: () => ({}), verify: async () => true, serviceClient: () => ({}), connectionRepo: () => w.repo, syncRepo: () => w.sync, kick })({ httpMethod: 'POST', headers: { 'plaid-verification': 'x' }, body: b })

  it('starts the background sync for THAT Item only, and answers 200', async () => {
    const w = world(), kick = vi.fn(async () => 'accepted')
    const res = await call(w, kick)
    expect(res.statusCode).toBe(200); expect(kick).toHaveBeenCalledTimes(1); expect(kick.mock.calls[0][0].itemId).toBe(PROD)
  })
  it('a failed or refused kick still answers 200 (the stored nudge and the 6-hour sweep cover it)', async () => {
    const w = world()
    expect((await call(w, vi.fn(async () => 'unavailable'))).statusCode).toBe(200)
    expect(w.state.events).toHaveLength(1)
  })
  it('no kick when the kill switch or resumable sync is off, or for a sandbox Item', async () => {
    const w = world(), kick = vi.fn()
    process.env.PLAID_AUTO_SYNC_ENABLED = 'false'; await call(w, kick)
    process.env.PLAID_AUTO_SYNC_ENABLED = 'true'; process.env.PLAID_RESUMABLE_SYNC_ENABLED = 'false'; await call(w, kick, body({ n: 2 }))
    process.env.PLAID_RESUMABLE_SYNC_ENABLED = 'true'; await call(w, kick, body({ item_id: 'plaid-sand' }))
    expect(kick).not.toHaveBeenCalled()
  })
})

describe('PLAID-2A webhook event storage', () => {
  it('a handled ITEM event is only counted on a repeat delivery, never re-armed as unread; a TRANSACTIONS nudge still is', async () => {
    const updates: any[] = []
    const existing = { id: 'e1', delivery_count: 1 }
    const events: any = { select: () => events, eq: () => events, maybeSingle: async () => ({ data: existing, error: null }), update: (p) => (updates.push(p), events) }
    events.then = (res) => res({ error: null })
    const repo = createBankSyncRepo({ from: () => events })
    await repo.recordWebhook({ organizationId: ORG, itemId: PROD, eventKey: 'k', webhookType: 'ITEM', webhookCode: 'ERROR', processed: true })
    await repo.recordWebhook({ organizationId: ORG, itemId: PROD, eventKey: 'k', webhookType: 'TRANSACTIONS', webhookCode: 'SYNC_UPDATES_AVAILABLE' })
    expect(updates[0]).not.toHaveProperty('processing_status')
    expect(updates[1]).toMatchObject({ processing_status: 'received', processed_at: null })
  })
})
