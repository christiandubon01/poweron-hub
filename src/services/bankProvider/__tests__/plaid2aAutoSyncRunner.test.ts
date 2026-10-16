// @ts-nocheck -- the Netlify handler under test is untyped; the resumable engine is scripted
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const step = vi.fn()
vi.mock('../resumableSync', () => ({ resumableSyncStep: (...args: unknown[]) => step(...args) }))

import { BankConnectionError } from '../bankConnectionService'
import { AUTO_SYNC_ACTOR_USER_ID, runAutoSyncForItem, signAutoSyncRequest } from '../autoSync'
import { buildHandler } from '../../../../netlify/functions/bank/plaid-auto-sync-background'

const ORG_A = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const ITEM = '30000000-0000-4000-8000-000000000001'
const KEY = 'service-role-key-for-tests-only'
const more = (n = 1) => ({ phase: 'fetching', more: true, pagesStaged: n, restarts: 0 })
const done = { phase: 'complete', more: false, pagesStaged: 1, restarts: 0, state: 'synced' }

beforeEach(() => { step.mockReset(); vi.spyOn(console, 'log').mockImplementation(() => {}) })

describe('PLAID-2A auto sync runner (reuses the resumable engine)', () => {
  it('loops bounded steps until the update is applied, acting as the system actor of the Item\'s own organization', async () => {
    step.mockResolvedValueOnce(more(1)).mockResolvedValueOnce(more(2)).mockResolvedValueOnce(done)
    const out = await runAutoSyncForItem({} as any, { id: ITEM, organizationId: ORG_B })
    expect(out).toEqual({ outcome: 'complete', steps: 3 })
    expect(step).toHaveBeenCalledTimes(3)
    expect(step.mock.calls[0][1]).toEqual({ organizationId: ORG_B, userId: AUTO_SYNC_ACTOR_USER_ID, role: 'owner' })
    expect(step.mock.calls[0][2]).toEqual({ itemId: ITEM })
  })
  it('stops quietly when someone else holds the Item\'s lease (a manual press, a webhook run): no retry storm', async () => {
    step.mockResolvedValueOnce(more()).mockRejectedValueOnce(new BankConnectionError('conflict', 409, 'Another sync request for this connection is running.'))
    expect(await runAutoSyncForItem({} as any, { id: ITEM, organizationId: ORG_A })).toEqual({ outcome: 'busy', steps: 1 })
    expect(step).toHaveBeenCalledTimes(2)
  })
  it('reports login_required and other errors without throwing, and never loops on them', async () => {
    step.mockRejectedValueOnce(new BankConnectionError('login_required', 409, 'sign in'))
    expect(await runAutoSyncForItem({} as any, { id: ITEM, organizationId: ORG_A })).toMatchObject({ outcome: 'login_required' })
    step.mockRejectedValueOnce(new BankConnectionError('plaid_unavailable', 502, 'down'))
    expect(await runAutoSyncForItem({} as any, { id: ITEM, organizationId: ORG_A })).toMatchObject({ outcome: 'error', code: 'plaid_unavailable' })
    step.mockRejectedValueOnce(new Error('unexpected'))
    expect(await runAutoSyncForItem({} as any, { id: ITEM, organizationId: ORG_A })).toMatchObject({ outcome: 'error', code: 'unexpected' })
    expect(step).toHaveBeenCalledTimes(3)
  })
  it('stops at its time budget; the staged run stays durable for the next run', async () => {
    let t = 0
    step.mockImplementation(async () => { t += 5_000; return more() })
    const out = await runAutoSyncForItem({} as any, { id: ITEM, organizationId: ORG_A }, { budgetMs: 12_000, now: () => t })
    expect(out.outcome).toBe('budget'); expect(out.steps).toBe(3)
  })
  it('never calls /transactions/refresh or /accounts/balance/get: neither exists anywhere in the server source', () => {
    const roots = ['src/services/bankProvider', 'netlify/functions']
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) { if (name !== '__tests__') walk(path); continue }
        if (!/\.(ts|cjs|js)$/.test(name) || /\.test\./.test(name)) continue
        const text = readFileSync(path, 'utf8')
          .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n') // comments may name them to say they are NOT used
        if (/transactions\/refresh|transactionsRefresh|accounts\/balance\/get|accountsBalanceGet/.test(text)) hits.push(path)
      }
    }
    roots.forEach(walk)
    expect(hits).toEqual([])
  })
})

describe('PLAID-2A background function (no user session)', () => {
  const env = (over = {}) => ({ PLAID_AUTO_SYNC_ENABLED: 'true', PLAID_RESUMABLE_SYNC_ENABLED: 'true', SUPABASE_SERVICE_ROLE_KEY: KEY, ...over })
  const NOW = Date.parse('2026-10-16T12:00:00Z')
  const itemRow = (over = {}) => ({ id: ITEM, organization_id: ORG_B, status: 'healthy', environment: 'production', provider: 'plaid', ...over })
  const svcFor = (row: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) })
  const ev = (itemId = ITEM, headers?: Record<string, string>, method = 'POST') => {
    const s = signAutoSyncRequest(KEY, itemId, NOW)
    return { httpMethod: method, headers: headers ?? { 'x-poweron-ts': s.timestamp, 'x-poweron-sig': s.signature }, body: JSON.stringify({ itemId }) }
  }
  const mk = (row: unknown, extra = {}, e = env()) => buildHandler({ env: e, now: () => NOW, serviceClient: () => svcFor(row), buildDeps: () => ({ marker: 'deps' }), run: vi.fn(async () => ({ outcome: 'complete', steps: 2 })), ...extra })

  it('refuses while the kill switch is off (403), without a valid signature (401), and while resumable sync is off (409)', async () => {
    expect((await mk(itemRow(), {}, env({ PLAID_AUTO_SYNC_ENABLED: undefined }))(ev())).statusCode).toBe(403)
    expect((await mk(itemRow())(ev(ITEM, { 'x-poweron-ts': '1', 'x-poweron-sig': 'f'.repeat(64) }))).statusCode).toBe(401)
    expect((await mk(itemRow())({ ...ev(), headers: {} })).statusCode).toBe(401)
    expect((await mk(itemRow(), {}, env({ PLAID_RESUMABLE_SYNC_ENABLED: undefined }))(ev())).statusCode).toBe(409)
    expect((await mk(itemRow())(ev(ITEM, undefined, 'GET'))).statusCode).toBe(405)
  })
  it('syncs a healthy PRODUCTION Item as that Item\'s own organization (multi-tenant, service role)', async () => {
    const run = vi.fn(async () => ({ outcome: 'complete', steps: 2 }))
    const res = await mk(itemRow(), { run })(ev())
    expect(res.statusCode).toBe(200); expect(JSON.parse(res.body)).toEqual({ outcome: 'complete' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][1]).toEqual({ id: ITEM, organizationId: ORG_B, status: 'healthy', environment: 'production', provider: 'plaid' })
  })
  it('SANDBOX Items, unhealthy Items and unknown Items are never synced automatically', async () => {
    for (const row of [itemRow({ environment: 'sandbox' }), itemRow({ status: 'login_required' }), itemRow({ status: 'disconnected' }), itemRow({ provider: 'other' }), null]) {
      const run = vi.fn()
      const res = await mk(row, { run })(ev())
      expect(JSON.parse(res.body)).toEqual({ outcome: 'skipped' }); expect(run).not.toHaveBeenCalled()
    }
  })
})
