import { describe, expect, it } from 'vitest'
import { buildAttention } from '../attention'

const NOW = Date.parse('2026-10-11T12:00:00Z')
const conns = [{ id: 'a', institutionName: 'Wells Fargo', status: 'healthy' }, { id: 'b', institutionName: 'Chase', status: 'login_required' }, { id: 'c', institutionName: 'Old Bank', status: 'disconnected' }]
const sync = (over: object) => ({ connectionId: 'a', state: 'synced', lastSyncedAt: '2026-10-11T10:00:00Z', ...over })

describe('PLAID-2H what needs attention', () => {
  it('says nothing when everything given is fine', () => {
    expect(buildAttention({ connections: [conns[0]], syncs: [sync({})], balances: [{ accountRef: 'x', connectionId: 'a', name: 'Chk', accountClass: 'bank_cash', freshness: 'fresh' }], nowMs: NOW })).toEqual([])
  })
  it('puts actions first: sign-in, failed sync with its code and recovery, blocked update; disconnected connections are ignored', () => {
    const out = buildAttention({ connections: conns, syncs: [sync({ state: 'error', lastErrorCode: 'ACCOUNT_UNKNOWN', recoveryText: 'Review or refresh the accounts.' }), { connectionId: 'c', state: 'error', lastSyncedAt: null }], nowMs: NOW })
    expect(out.slice(0, 2).map(i => [i.severity, i.id])).toEqual([['action', 'login:b'], ['action', 'sync-error:a']])
    expect(out[1].message).toMatch(/ACCOUNT_UNKNOWN/); expect(out.some(i => i.connectionId === 'c')).toBe(false)
    const blocked = buildAttention({ connections: [conns[0]], syncs: [sync({ state: 'error', blocked: { reason: 'RUN_TOO_LARGE' } })], nowMs: NOW })
    expect(blocked[0]).toMatchObject({ severity: 'action', id: 'blocked:a' }); expect(blocked[0].message).toMatch(/Nothing from it was saved/)
  })
  it('warns about old syncs and stale balances, lists unknown balances and review counts, and never says unconfirmed means empty', () => {
    const out = buildAttention({
      connections: [conns[0]], syncs: [sync({ lastSyncedAt: '2026-10-08T00:00:00Z', updatesAvailable: true })],
      balances: [{ accountRef: '1', connectionId: 'a', name: 'Chk', accountClass: 'bank_cash', freshness: 'stale' }, { accountRef: '2', connectionId: 'a', name: 'Sav', accountClass: 'bank_cash', freshness: 'unknown' }, { accountRef: '3', connectionId: 'zz', name: 'Gone', accountClass: 'bank_cash', freshness: 'stale' }],
      review: { needsReview: 3, ambiguousMatches: 2, pendingLinksNeedingReview: 1 }, nowMs: NOW })
    const ids = out.map(i => i.id)
    expect(ids).toEqual(expect.arrayContaining(['old-sync:a', 'balances-stale', 'balances-unknown', 'updates:a', 'ambiguous', 'pending-links', 'needs-review']))
    expect(out.find(i => i.id === 'balances-stale')!.message).toMatch(/1 account balance is stale: Chk/) // the balance of a connection that is not live is not reported
    expect(out.map(i => i.severity)).toEqual([...out.map(i => i.severity)].sort((a, b) => ['action', 'warning', 'info'].indexOf(a) - ['action', 'warning', 'info'].indexOf(b)))
    const waiting = buildAttention({ connections: [conns[0]], syncs: [sync({ state: 'unconfirmed' })], nowMs: NOW })
    expect(waiting[0].message).toMatch(/does not mean there are none/)
  })
})
