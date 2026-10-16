// @ts-nocheck -- the Netlify scheduled function under test is untyped
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runScheduledSweep } from '../autoSync'
import { createBankConnectionRepo } from '../bankConnectionRepo'
import { buildSweep, config } from '../../../../netlify/functions/plaid-auto-sync-schedule'

const ORG_A = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const items = (n: number, org = ORG_A) => Array.from({ length: n }, (_, i) => ({ id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, organizationId: org }))
const env = (over = {}) => ({ PLAID_AUTO_SYNC_ENABLED: 'true', PLAID_RESUMABLE_SYNC_ENABLED: 'true', PLAID_ENV: 'production', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', SUPABASE_SERVICE_ROLE_KEY: 'k', URL: 'https://site.example.com', ...over })

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}) })

describe('PLAID-2A scheduled safety net', () => {
  it('runs every 6 hours', () => { expect(config).toEqual({ schedule: '0 */6 * * *' }) })

  it('does nothing while the kill switch is off or resumable sync is off, and takes no input', async () => {
    const listItems = vi.fn(async () => items(1))
    expect(await buildSweep({ env: env({ PLAID_AUTO_SYNC_ENABLED: undefined }), listItems })()).toEqual({ status: 'disabled' })
    expect(await buildSweep({ env: env({ PLAID_RESUMABLE_SYNC_ENABLED: undefined }), listItems })()).toEqual({ status: 'resumable_sync_off' })
    expect(listItems).not.toHaveBeenCalled()
  })
  it('SANDBOX configuration: nothing is listed and nothing is kicked', async () => {
    const listItems = vi.fn(async () => items(2)), kick = vi.fn()
    expect(await buildSweep({ env: env({ PLAID_ENV: 'sandbox' }), listItems, kick, serviceClient: () => ({}) })()).toEqual({ status: 'not_production' })
    expect(listItems).not.toHaveBeenCalled(); expect(kick).not.toHaveBeenCalled()
  })
  it('kicks every healthy production Item across organizations, one background run each', async () => {
    const list = [...items(2, ORG_A), ...items(1, ORG_B).map(i => ({ ...i, id: '30000000-0000-4000-8000-0000000000b1' }))]
    const kick = vi.fn(async () => 'accepted'), run = vi.fn()
    const out = await buildSweep({ env: env(), listItems: async () => list, kick, run, serviceClient: () => ({}) })()
    expect(out).toEqual({ status: 'completed', considered: 3, kicked: 3, inline: 0, skipped: 0 })
    expect(kick.mock.calls.map(c => c[0].itemId)).toEqual(list.map(i => i.id))
    expect(kick.mock.calls[0][0]).toMatchObject({ baseUrl: 'https://site.example.com', serviceRoleKey: 'k' })
    expect(run).not.toHaveBeenCalled()
  })
  it('falls back to bounded inline steps only when the platform will not accept the kick', async () => {
    const kick = vi.fn(async (a: any) => (a.itemId.endsWith('1') ? 'unavailable' : 'accepted')), run = vi.fn(async () => ({ outcome: 'complete', steps: 1 })), buildDeps = vi.fn(() => ({ d: 1 }))
    const out = await buildSweep({ env: env(), listItems: async () => items(2), kick, run, buildDeps, serviceClient: () => ({}) })()
    expect(out).toMatchObject({ kicked: 1, inline: 1 }); expect(run).toHaveBeenCalledTimes(1); expect(buildDeps).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][2].budgetMs).toBeLessThanOrEqual(22_000)
  })
  it('caps the pass so a scheduled function never runs past its short limit', async () => {
    const kick = vi.fn(async () => 'accepted')
    const out = await runScheduledSweep({ items: items(40), kick, runInline: vi.fn(), maxItems: 25 })
    expect(out).toMatchObject({ considered: 25, kicked: 25, skipped: 15 }); expect(kick).toHaveBeenCalledTimes(25)
    let t = 0
    const slow = vi.fn(async () => { t += 10_000; return 'accepted' as const })
    const timed = await runScheduledSweep({ items: items(5), kick: slow, runInline: vi.fn(), now: () => t, budgetMs: 22_000 })
    expect(timed.kicked).toBeLessThan(5); expect(timed.skipped).toBeGreaterThan(0)
  })
  it('lists ONLY healthy production Plaid Items of every organization (no organization filter, service role)', async () => {
    const calls: Array<[string, unknown[]]> = []
    const q: any = { select: (...a) => (calls.push(['select', a]), q), eq: (...a) => (calls.push(['eq', a]), q), order: (...a) => (calls.push(['order', a]), q), limit: (...a) => (calls.push(['limit', a]), Promise.resolve({ data: [{ id: 'i1', organization_id: ORG_A }, { id: 'i2', organization_id: ORG_B }], error: null })) }
    const out = await createBankConnectionRepo({ from: () => q, rpc: async () => ({}) } as any).listSyncableItems('production')
    expect(out).toEqual([{ id: 'i1', organizationId: ORG_A }, { id: 'i2', organizationId: ORG_B }])
    expect(calls.filter(c => c[0] === 'eq').map(c => c[1])).toEqual([['provider', 'plaid'], ['status', 'healthy'], ['environment', 'production']])
  })
})
