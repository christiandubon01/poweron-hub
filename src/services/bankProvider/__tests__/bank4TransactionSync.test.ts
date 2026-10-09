// @ts-nocheck -- handlers under test are untyped (ts-nocheck); the in-memory repos mirror migration 153/154 semantics
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto'
import { PersistenceFailure, getSyncStatus, syncTransactions, recordVerifiedWebhook, deriveSyncState, classifySyncOutcome, MAX_MUTATION_RESTARTS, MAX_PAGES, SYNC_LEASE_MS, SYNC_TIME_BUDGET_MS, WAITING_MARKER } from '../bankSyncService'
import { discoverAccounts } from '../bankAccountService'
import { BankConnectionError, contextFor } from '../bankConnectionService'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { PlaidApiFailure, ProviderResponseError, createPlaidSdkPort } from '../plaidPort'
import { loadPlaidConfig } from '../plaidConfig'
import { toTransactionEvidence, providerAmountDirection, EvidenceRejected } from '../transactionEvidence'
import { verifyPlaidWebhook, sha256Hex, createWebhookKeyCache } from '../plaidWebhookVerify'
import { buildHandler as syncHandler } from '../../../../netlify/functions/bank/plaid-sync'
import { buildHandler as webhookHandler } from '../../../../netlify/functions/bank/plaid-webhook'
import { safeLog } from '../../../../netlify/functions/bank/plaidAuth'

const ORG_A = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const ITEM = '30000000-0000-4000-8000-000000000001'
const ITEM_2 = '30000000-0000-4000-8000-000000000002'
const ITEM_B = '30000000-0000-4000-8000-0000000000b1'
const ACCESS = 'access-sandbox-zzzzzzzz-0000-1111-2222-333333333333'
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const owner = { organizationId: ORG_A, userId: 'u-owner', role: 'owner' }

const tx = (id: string, over = {}) => ({ transactionId: id, accountId: 'acc-1', amount: 12.34, currency: 'USD', date: '2026-09-30', authorizedDate: null, name: 'Coffee', merchantName: 'Cafe', pending: false, pendingTransactionId: null, categoryPrimary: 'FOOD_AND_DRINK', categoryDetailed: 'FOOD_AND_DRINK_COFFEE', categoryConfidence: 'HIGH', ...over })
const page = (over = {}) => ({ added: [], modified: [], removed: [], nextCursor: 'c1', hasMore: false, updateStatus: 'HISTORICAL_UPDATE_COMPLETE', accounts: [{ accountId: 'acc-1', currency: 'USD' }], ...over })

/** In-memory world. `canonical` stands in for Cash OS truth: nothing BANK-4 does may change it. */
function world(key = KEY) {
  const state = {
    items: new Map([
      [ITEM, { org: ORG_A, providerItemId: 'plaid-item-1', status: 'healthy', sync: { status: 'idle', cursor: null, startedAt: null, completedAt: null, lastSuccessfulAt: null, lastErrorCode: null } }],
      [ITEM_2, { org: ORG_A, providerItemId: 'plaid-item-2', status: 'healthy', sync: { status: 'idle', cursor: null, startedAt: null, completedAt: null, lastSuccessfulAt: null, lastErrorCode: null } }],
      [ITEM_B, { org: ORG_B, providerItemId: 'plaid-item-b', status: 'healthy', sync: { status: 'idle', cursor: null, startedAt: null, completedAt: null, lastSuccessfulAt: null, lastErrorCode: null } }],
    ]),
    accounts: [{ id: 'pa-1', org: ORG_A, providerItemRef: ITEM, providerAccountId: 'acc-1', status: 'active' }, { id: 'pa-2', org: ORG_A, providerItemRef: ITEM_2, providerAccountId: 'acc-1', status: 'active' }],
    evidence: new Map<string, any>(), events: [] as any[], writes: [] as string[], cursorAtWrite: [] as any[],
    failUpsertOnCall: 0, upsertCalls: 0, plaidRequests: [] as any[], script: [] as any[], accountsCalls: 0, clock: { t: null as number | null }, onUpsert: null as null | (() => void),
    canonical: { financial_transactions: [], cash: { balance: 12345, include_in_cash: true, account_type: 'checking' }, mappings: [{ providerAccountRef: 'pa-1', financialAccountId: 'fa-1' }] },
  }
  const envelope = (itemId, pid) => encryptProviderToken(ACCESS, key, contextFor(owner, 'plaid', pid))
  const repo = {
    async getItem(org, id) { const i = state.items.get(id); return i && i.org === org ? { id, provider: 'plaid', providerItemId: i.providerItemId, status: i.status } : null },
    async getActiveCredential(org, id) { const i = state.items.get(id); return i && i.org === org && i.status !== 'disconnected' ? envelope(id, i.providerItemId) : null },
    async listItems(org) { return [...state.items].filter(([, i]) => i.org === org).map(([id, i]) => ({ id, provider: 'plaid', status: i.status, institutionName: 'Tartan Bank', connectedAt: null, disconnectedAt: null, lastSuccessfulSyncAt: i.sync.lastSuccessfulAt })) },
    async findItemOwner(provider, pid) { const e = [...state.items].find(([, i]) => i.providerItemId === pid); return e ? { id: e[0], organizationId: e[1].org } : null },
  }
  const accounts = {
    async listProviderAccounts(org, itemId) { return state.accounts.filter(a => a.org === org && a.providerItemRef === itemId).map(a => ({ ...a })) },
    async upsertProviderAccounts() { state.writes.push('accounts-upsert') },
    async deactivateProviderAccounts() {},
    async markItemLoginRequired(org, id) { state.items.get(id).status = 'login_required' },
  }
  const sync = {
    async getSyncState(org, id) { const i = state.items.get(id); return i && i.org === org ? { ...i.sync } : null },
    async claimSync(org, id, staleIso) { const i = state.items.get(id); if (!i || i.org !== org || i.status === 'disconnected') return false; if (i.sync.status === 'syncing' && i.sync.startedAt && i.sync.startedAt >= staleIso) return false; i.sync.status = 'syncing'; i.sync.startedAt = new Date().toISOString(); return true },
    async finishSync(org, id, { cursor, state: outcome }) { const i = state.items.get(id); i.sync = { ...i.sync, status: 'idle', cursor, completedAt: new Date().toISOString(), lastErrorCode: outcome === 'waiting' ? WAITING_MARKER : null, lastSuccessfulAt: outcome === 'synced' ? new Date().toISOString() : i.sync.lastSuccessfulAt } },
    async failSync(org, id, code) { const i = state.items.get(id); i.sync = { ...i.sync, status: 'failed', lastErrorCode: code } },
    async markLoginRequired(org, id) { state.items.get(id).status = 'login_required' },
    async upsertEvidence(org, id, rows) {
      state.upsertCalls += 1
      state.onUpsert?.()
      if (state.failUpsertOnCall && state.upsertCalls === state.failUpsertOnCall) throw new Error('db down')
      state.cursorAtWrite.push(state.items.get(id).sync.cursor)
      for (const { evidence: e, providerAccountRef } of rows) {
        const key = `${id}|${e.providerTransactionId}`
        const prev = state.evidence.get(key)
        state.evidence.set(key, { org, item: id, accountRef: providerAccountRef, ...e, removedAt: null, firstSeen: prev?.firstSeen ?? state.evidence.size + 1 })
        state.writes.push(`upsert:${e.providerTransactionId}`)
      }
    },
    async markRemoved(org, id, ids) { let n = 0; for (const t of ids) { const r = state.evidence.get(`${id}|${t}`); if (r && r.org === org && !r.removedAt) { r.removedAt = 'now'; n += 1 } } state.writes.push(`remove:${ids.join(',')}`); return n },
    async countEvidence(org, id) { const rows = [...state.evidence.values()].filter(r => r.org === org && r.item === id); return { posted: rows.filter(r => !r.pending && !r.removedAt).length, pending: rows.filter(r => r.pending && !r.removedAt).length, removed: rows.filter(r => r.removedAt).length } },
    async recordWebhook({ organizationId, itemId, eventKey, webhookType, webhookCode }) { const e = state.events.find(x => x.org === organizationId && x.key === eventKey); if (e) { e.count += 1; e.status = 'received'; return 'duplicate' } state.events.push({ org: organizationId, item: itemId, key: eventKey, type: webhookType, code: webhookCode, count: 1, status: 'received' }); return 'recorded' },
    async hasPendingNudge(org, id) { return state.events.some(e => e.org === org && e.item === id && e.status === 'received') },
    async markNudgesProcessed(org, id) { for (const e of state.events) if (e.org === org && e.item === id) e.status = 'processed' },
  }
  const plaid = {
    getAccounts: vi.fn(async () => { state.accountsCalls += 1; return [] }),
    syncTransactions: vi.fn(async (req) => {
      state.plaidRequests.push({ cursor: req.cursor, count: req.count })
      const next = state.script.shift()
      if (!next) return page()
      if (next instanceof Error) throw next
      return typeof next === 'function' ? next(req) : next
    }),
  }
  const logs: any[] = []
  const deps = { plaid, repo, accounts, sync, key, environment: 'sandbox', log: e => logs.push(e), now: () => state.clock.t ?? Date.now() }
  return { state, deps, plaid, logs }
}
const canon = w => JSON.stringify(w.state.canonical)
const mutation = () => new PlaidApiFailure('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', 'TRANSACTIONS_ERROR', 400)
const run = (w, itemId = ITEM, actor = owner) => syncTransactions(w.deps, actor, { itemId })

describe('BANK-4 sync lifecycle and cursor', () => {
  it('1/2. the first sync starts with NO cursor, and an empty first answer is WAITING (not a failure, not "synced")', async () => {
    const w = world(); w.state.script = [page({ nextCursor: 'c0', updateStatus: 'NOT_READY' })]
    const out = await run(w)
    expect(w.state.plaidRequests[0].cursor).toBeNull()
    expect(out).toMatchObject({ state: 'waiting', added: 0 })
    const i = w.state.items.get(ITEM)
    expect(i.sync).toMatchObject({ status: 'idle', cursor: 'c0', lastSuccessfulAt: null }); expect(i.sync.completedAt).not.toBeNull()
    expect(deriveSyncState({ status: 'healthy' }, i.sync)).toBe('waiting')
  })
  it('an empty answer whose update status says the initial pull is complete IS a (empty) success', async () => {
    const w = world(); w.state.script = [page({ updateStatus: 'INITIAL_UPDATE_COMPLETE' })]
    expect(await run(w)).toMatchObject({ state: 'synced' })
  })
  it('PRODUCT_NOT_READY from Plaid is WAITING, leaves the cursor alone and records no error', async () => {
    const w = world(); w.state.script = [new PlaidApiFailure('PRODUCT_NOT_READY', 'ITEM_ERROR', 400)]
    expect(await run(w)).toMatchObject({ state: 'waiting' })
    expect(w.state.items.get(ITEM).sync).toMatchObject({ status: 'idle', cursor: null, lastErrorCode: WAITING_MARKER, lastSuccessfulAt: null })
    expect(deriveSyncState({ status: 'healthy' }, w.state.items.get(ITEM).sync)).toBe('waiting')
  })
  it('3. added transactions are persisted as evidence and counted by state', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1'), tx('t2', { amount: -500, pending: true })] })]
    const out = await run(w)
    expect(out).toMatchObject({ state: 'synced', added: 2, pending: 1 })
    expect(await w.deps.sync.countEvidence(ORG_A, ITEM)).toEqual({ posted: 1, pending: 1, removed: 0 })
    expect(w.state.evidence.get(`${ITEM}|t1`)).toMatchObject({ providerAmount: 12.34, providerAmountMinor: 1234, accountRef: 'pa-1', currency: 'USD' })
  })
  it('4. modified updates the same evidence row (no duplicate)', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1', { name: 'Coffee' })] }), page({ nextCursor: 'c2', modified: [tx('t1', { name: 'Coffee shop', amount: 13 })] })]
    await run(w); await run(w)
    expect(w.state.evidence.size).toBe(1)
    expect(w.state.evidence.get(`${ITEM}|t1`)).toMatchObject({ name: 'Coffee shop', providerAmountMinor: 1300 })
  })
  it('5. removed evidence is KEPT and marked removed (never deleted)', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1')] }), page({ nextCursor: 'c2', removed: [{ transactionId: 't1', accountId: 'acc-1' }] })]
    await run(w); const out = await run(w)
    expect(out.removed).toBe(1)
    expect(w.state.evidence.get(`${ITEM}|t1`)).toMatchObject({ removedAt: 'now', providerAmountMinor: 1234 })
    expect(await w.deps.sync.countEvidence(ORG_A, ITEM)).toEqual({ posted: 0, pending: 0, removed: 1 })
  })
  it('6/7/8/12. replaying the same added/modified/removed patch from the previous committed cursor is idempotent', async () => {
    const w = world()
    const patch = () => page({ nextCursor: 'c9', added: [tx('t1'), tx('t2')], modified: [tx('t2', { name: 'Edited' })], removed: [{ transactionId: 't1', accountId: 'acc-1' }] })
    w.state.script = [patch()]; await run(w)
    const first = JSON.stringify([...w.state.evidence])
    w.state.items.get(ITEM).sync.cursor = null // simulate: the cursor commit was lost, so the same update is delivered again
    w.state.script = [patch()]; await run(w)
    expect(w.state.evidence.size).toBe(2)
    expect(JSON.stringify([...w.state.evidence])).toBe(first)
  })
  it('9. multi-page updates follow has_more using each next_cursor', async () => {
    const w = world(); w.state.items.get(ITEM).sync.cursor = 'c0'
    w.state.script = [page({ nextCursor: 'c1', hasMore: true, added: [tx('t1')] }), page({ nextCursor: 'c2', hasMore: true, added: [tx('t2')] }), page({ nextCursor: 'c3', added: [tx('t3')] })]
    const out = await run(w)
    expect(w.state.plaidRequests.map(r => r.cursor)).toEqual(['c0', 'c1', 'c2'])
    expect(out).toMatchObject({ pages: 3, added: 3 }); expect(w.state.items.get(ITEM).sync.cursor).toBe('c3')
  })
  it('10. the durable cursor moves only AFTER all evidence is written (not midway through pagination)', async () => {
    const w = world(); w.state.items.get(ITEM).sync.cursor = 'c0'
    w.state.script = [page({ nextCursor: 'c1', hasMore: true, added: [tx('t1')] }), page({ nextCursor: 'c2', added: [tx('t2')] })]
    await run(w)
    expect(w.state.cursorAtWrite.every(c => c === 'c0')).toBe(true) // still the ORIGINAL cursor during every write
    expect(w.state.items.get(ITEM).sync.cursor).toBe('c2')
  })
  it('11. a persistence failure does NOT advance the cursor; the retry then succeeds with no duplicates', async () => {
    const w = world(); w.state.items.get(ITEM).sync.cursor = 'c0'; w.state.failUpsertOnCall = 2
    const patch = () => page({ nextCursor: 'c1', hasMore: true, added: [tx('t1')] })
    w.state.script = [patch(), page({ nextCursor: 'c2', added: [tx('t2')] })]
    await expect(run(w)).rejects.toMatchObject({ httpStatus: 503 })
    expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c0', status: 'failed' })
    w.state.script = [patch(), page({ nextCursor: 'c2', added: [tx('t2')] })]
    await run(w)
    expect(w.state.plaidRequests.slice(-2).map(r => r.cursor)).toEqual(['c0', 'c1'])
    expect(w.state.evidence.size).toBe(2); expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c2', status: 'idle' })
  })
  it('13. TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION restarts the ENTIRE loop from the ORIGINAL cursor and keeps nothing from the aborted attempt', async () => {
    const w = world(); w.state.items.get(ITEM).sync.cursor = 'c0'
    w.state.script = [page({ nextCursor: 'c1', hasMore: true, added: [tx('stale-from-aborted-attempt')] }), mutation(), page({ nextCursor: 'd1', hasMore: true, added: [tx('t1')] }), page({ nextCursor: 'd2', added: [tx('t2')] })]
    const out = await run(w)
    expect(w.state.plaidRequests.map(r => r.cursor)).toEqual(['c0', 'c1', 'c0', 'd1'])
    expect(out.restarts).toBe(1)
    expect([...w.state.evidence.values()].map(e => e.providerTransactionId).sort()).toEqual(['t1', 't2'])
    expect(w.state.items.get(ITEM).sync.cursor).toBe('d2')
  })
  it('14. mutation restarts are bounded; the cursor and evidence are left untouched', async () => {
    const w = world(); w.state.items.get(ITEM).sync.cursor = 'c0'
    w.state.script = Array.from({ length: 20 }, () => mutation())
    await expect(run(w)).rejects.toMatchObject({ httpStatus: 409, code: 'conflict' })
    expect(w.state.plaidRequests).toHaveLength(MAX_MUTATION_RESTARTS + 1)
    expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c0', status: 'failed', lastErrorCode: 'SYNC_CONFLICT' }); expect(w.state.evidence.size).toBe(0)
  })
  it('a second sync cannot start while one holds a fresh lease; an abandoned lease can be re-claimed', async () => {
    const w = world(); const i = w.state.items.get(ITEM)
    i.sync.status = 'syncing'; i.sync.startedAt = new Date().toISOString()
    await expect(run(w)).rejects.toMatchObject({ httpStatus: 409 }); expect(w.plaid.syncTransactions).not.toHaveBeenCalled()
    i.sync.startedAt = new Date(Date.now() - SYNC_LEASE_MS - 1000).toISOString()
    await expect(run(w)).resolves.toBeTruthy()
  })
  it('login-required marks the connection so Reconnect appears, with a safe message', async () => {
    const w = world(); w.state.script = [new PlaidApiFailure('ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', 400)]
    await expect(run(w)).rejects.toMatchObject({ code: 'login_required', httpStatus: 409 })
    expect(w.state.items.get(ITEM).status).toBe('login_required')
    expect(deriveSyncState({ status: 'login_required' }, w.state.items.get(ITEM).sync)).toBe('login_required')
  })
  it('an unexpected Plaid failure is a sanitized 502 and leaves cursor and evidence unchanged', async () => {
    const w = world(); w.state.script = [new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500)]
    await expect(run(w)).rejects.toMatchObject({ code: 'plaid_unavailable', httpStatus: 502 })
    expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: null, status: 'failed' })
    expect(JSON.stringify(w.logs)).not.toContain(ACCESS)
  })
})

describe('BANK-4 evidence semantics', () => {
  it('15. pending evidence is stored as pending and is counted separately from posted', async () => {
    const w = world(); w.state.script = [page({ added: [tx('p1', { pending: true }), tx('t1')] })]; await run(w)
    expect(await w.deps.sync.countEvidence(ORG_A, ITEM)).toEqual({ posted: 1, pending: 1, removed: 0 })
  })
  it('16. pending→posted: the pending row is marked removed (kept, id unchanged) and the posted row records the provider\'s own link', async () => {
    const w = world(); w.state.script = [page({ added: [tx('P', { pending: true })] }), page({ nextCursor: 'c2', added: [tx('B', { pendingTransactionId: 'P' })], removed: [{ transactionId: 'P', accountId: 'acc-1' }] })]
    await run(w); await run(w)
    expect(w.state.evidence.get(`${ITEM}|P`)).toMatchObject({ pending: true, removedAt: 'now', pendingProviderTransactionId: null, providerTransactionId: 'P' })
    expect(w.state.evidence.get(`${ITEM}|B`)).toMatchObject({ pending: false, pendingProviderTransactionId: 'P', removedAt: null })
  })
  it('17. an unmatched posted transaction gets NO invented pending link, and a pending row never carries one', async () => {
    const w = world(); w.state.script = [page({ added: [tx('B2', { pendingTransactionId: null }), tx('P2', { pending: true, pendingTransactionId: 'whatever' })] })]; await run(w)
    expect(w.state.evidence.get(`${ITEM}|B2`).pendingProviderTransactionId).toBeNull()
    expect(w.state.evidence.get(`${ITEM}|P2`).pendingProviderTransactionId).toBeNull()
  })
  it('18/19. the amount is stored exactly as the provider reports it: positive = money out, negative = money in, zero stays zero', () => {
    const ev = (amount) => toTransactionEvidence(tx('t', { amount })).evidence
    expect(ev(12.34)).toMatchObject({ providerAmount: 12.34, providerAmountMinor: 1234 })
    expect(ev(-2500)).toMatchObject({ providerAmount: -2500, providerAmountMinor: -250000 })
    expect(ev(0).providerAmountMinor).toBe(0)
    expect(providerAmountDirection(1234)).toBe('money_out'); expect(providerAmountDirection(-250000)).toBe('money_in'); expect(providerAmountDirection(0)).toBe('zero')
    expect(ev(0.1 + 0.2).providerAmountMinor).toBe(30) // no floating-point drift
    expect(() => toTransactionEvidence(tx('t', { amount: 1.005 }))).toThrow(EvidenceRejected) // sub-cent cannot be stored exactly: fail closed
    expect(() => toTransactionEvidence(tx('t', { amount: null }))).toThrow(EvidenceRejected)
    expect(toTransactionEvidence(tx('t', { currency: 'EUR' }))).toEqual({ kind: 'skipped', reason: 'unsupported_currency' })
  })
  it('a transaction that cannot be stored faithfully fails the whole sync and advances nothing', async () => {
    const w = world(); w.state.script = [page({ added: [tx('ok'), tx('bad', { amount: 1.005 })] })]
    await expect(run(w)).rejects.toMatchObject({ code: 'sync_failed' })
    expect(w.state.evidence.size).toBe(0); expect(w.state.items.get(ITEM).sync.cursor).toBeNull()
  })
  it('unsupported-currency accounts are skipped (counted), never coerced', async () => {
    const w = world(); w.state.script = [page({ added: [tx('e1', { currency: 'EUR' })] })]
    expect(await run(w)).toMatchObject({ added: 0, skipped: 1 }); expect(w.state.evidence.size).toBe(0)
  })
  it('27/28. only allowlisted fields exist on stored evidence: unknown nested provider data cannot cross, and credential-shaped text is dropped', () => {
    const hostile = { ...tx('t'), location: { lat: 1 }, payment_meta: { ppd_id: 'x' }, counterparties: [{ name: 'n' }], account_owner: 'Jane', access_token: ACCESS, raw: { nested: { access_token: ACCESS } },
      name: `Pay ${ACCESS}`, merchantName: 'Bearer abcdefghijklmnop' }
    const e = toTransactionEvidence(hostile).evidence
    expect(Object.keys(e).sort()).toEqual(['authorizedDate', 'currency', 'merchantName', 'name', 'pending', 'pendingProviderTransactionId', 'providerAccountId', 'providerAmount', 'providerAmountMinor', 'providerCategory', 'providerTransactionId', 'redactedFields', 'transactionDate'])
    expect(JSON.stringify(e)).not.toMatch(/access-sandbox|Bearer|Jane|ppd_id|lat|counterpart/)
    expect(e.name).toBeNull(); expect(e.merchantName).toBeNull(); expect(e.redactedFields).toBe(2)
    expect(Object.keys(e.providerCategory).sort()).toEqual(['confidence', 'detailed', 'primary'])
  })
  it('the Plaid adapter picks explicit transaction fields and drops everything else (location, payment meta, counterparties, owner, balances)', async () => {
    const raw = { account_id: 'acc-1', transaction_id: 't1', amount: 5, iso_currency_code: 'USD', date: '2026-09-30', name: 'N', merchant_name: 'M', pending: false, pending_transaction_id: null, authorized_date: null,
      location: { city: 'X' }, payment_meta: { reference_number: 'r' }, account_owner: 'Jane', counterparties: [{ name: 'c' }], logo_url: 'u', website: 'w', running_balance: 99, personal_finance_category: { primary: 'A', detailed: 'B', confidence_level: 'HIGH', extra: 'zz' } }
    const api = { transactionsSync: vi.fn(async () => ({ data: { added: [raw], modified: [], removed: [{ transaction_id: 'r1', account_id: 'acc-1' }], accounts: [{ account_id: 'acc-1', balances: { iso_currency_code: 'USD', current: 123456 } }], next_cursor: 'c', has_more: false, transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', request_id: 'rid' } })) }
    const port = createPlaidSdkPort(loadPlaidConfig({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's' }), api as never)
    const out = await port.syncTransactions({ accessToken: ACCESS, cursor: null, count: 500 })
    expect(Object.keys(out.added[0]).sort()).toEqual(['accountId', 'amount', 'authorizedDate', 'categoryConfidence', 'categoryDetailed', 'categoryPrimary', 'currency', 'date', 'merchantName', 'name', 'pending', 'pendingTransactionId', 'transactionId'])
    expect(JSON.stringify(out)).not.toMatch(/Jane|city|reference_number|logo|website|123456|99|rid|extra|zz/)
    expect(api.transactionsSync.mock.calls[0][0]).toMatchObject({ access_token: ACCESS, count: 500, options: { include_personal_finance_category: true } })
    expect(api.transactionsSync.mock.calls[0][0]).not.toHaveProperty('cursor') // first call: none
  })
})

describe('BANK-4 canonical isolation, authorization and boundaries', () => {
  it('20/21/33/34. syncing mapped OR unmapped provider-account evidence changes nothing canonical (ledger, Cash OS account, mappings)', async () => {
    const w = world(); const before = canon(w)
    w.state.script = [page({ added: [tx('m1'), tx('m2', { amount: -900 })] })]; await run(w) // acc-1 is mapped
    w.state.accounts.push({ id: 'pa-3', org: ORG_A, providerItemRef: ITEM, providerAccountId: 'acc-9', status: 'active' }) // unmapped
    w.state.script = [page({ nextCursor: 'c2', added: [tx('u1', { accountId: 'acc-9' })], accounts: [{ accountId: 'acc-1', currency: 'USD' }, { accountId: 'acc-9', currency: 'USD' }] })]; await run(w)
    expect(w.state.evidence.get(`${ITEM}|u1`).accountRef).toBe('pa-3')
    expect(canon(w)).toBe(before)
  })
  it('22. another organization\'s Item is "not found": no provider call, no state change', async () => {
    const w = world()
    await expect(run(w, ITEM_B)).rejects.toMatchObject({ httpStatus: 404 })
    expect(w.plaid.syncTransactions).not.toHaveBeenCalled(); expect(w.state.items.get(ITEM_B).sync.status).toBe('idle')
  })
  it('23. a transaction for an account that is not a provider account of THIS Item fails closed: nothing is saved, nothing is created, and the owner is told to refresh accounts', async () => {
    const w = world(); const canonBefore = canon(w); w.state.script = [page({ added: [tx('x1', { accountId: 'acc-from-nowhere' })], accounts: [{ accountId: 'acc-from-nowhere', currency: 'USD' }] })]
    await expect(run(w)).rejects.toMatchObject({ code: 'sync_failed', message: expect.stringMatching(/Refresh accounts/) })
    expect(w.state.evidence.size).toBe(0); expect(w.state.items.get(ITEM).sync.cursor).toBeNull()
    expect(w.state.accounts).toHaveLength(2) // no provider account was silently created
    expect(w.state.writes).not.toContain('accounts-upsert'); expect(w.plaid.getAccounts).not.toHaveBeenCalled(); expect(canon(w)).toBe(canonBefore)
    expect((await w.deps.accounts.listProviderAccounts(ORG_A, ITEM)).map(a => a.providerAccountId)).toEqual(['acc-1']) // and nothing was mapped
    // the same provider account id on ANOTHER Item (ITEM_2 has 'acc-1' too) is never reachable from this Item
    w.state.script = [page({ added: [tx('x2')] })]; await run(w)
    expect(w.state.evidence.get(`${ITEM}|x2`).accountRef).toBe('pa-1')
  })
  it('24/25. employees and viewers cannot sync or read status, and the provider is never called', async () => {
    const w = world()
    for (const role of ['employee', 'viewer', '', undefined]) {
      await expect(syncTransactions(w.deps, { ...owner, role }, { itemId: ITEM })).rejects.toMatchObject({ httpStatus: 403 })
      await expect(getSyncStatus(w.deps, { ...owner, role })).rejects.toMatchObject({ httpStatus: 403 })
    }
    expect(w.plaid.syncTransactions).not.toHaveBeenCalled()
  })
  it('26. neither the sync result nor the status ever contains a credential, cursor or transaction text', async () => {
    const w = world(); w.state.script = [page({ nextCursor: 'cursor-SECRET', added: [tx('t1', { name: 'Private Payee' })] })]
    const out = await run(w); const status = await getSyncStatus(w.deps, owner)
    const text = JSON.stringify([out, status, w.logs])
    expect(text).not.toMatch(/access-|v1:|cursor-SECRET|Private Payee|Cafe|1234|t1\b|acc-1/)
    expect(status.syncs[0]).toMatchObject({ connectionId: ITEM, state: 'synced', counts: { posted: 1, pending: 0, removed: 0 }, updatesAvailable: false })
  })
  it('31. after disconnect the historical evidence stays, syncing is refused, and the connection no longer appears in sync status', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1')] })]; await run(w)
    w.state.items.get(ITEM).status = 'disconnected'
    await expect(run(w)).rejects.toMatchObject({ httpStatus: 409 })
    expect(w.state.evidence.size).toBe(1); expect(w.state.items.get(ITEM).sync.cursor).toBe('c1')
    expect((await getSyncStatus(w.deps, owner)).syncs.map(s => s.connectionId)).not.toContain(ITEM)
  })
  it('32. a brand-new Item starts with NO cursor: it never inherits another Item\'s cursor', async () => {
    const w = world(); w.state.script = [page({ nextCursor: 'item1-cursor', added: [tx('t1')] })]; await run(w)
    w.state.script = [page({ nextCursor: 'item2-c1' })]; w.state.accounts.find(a => a.providerItemRef === ITEM_2)
    await run(w, ITEM_2)
    expect(w.state.plaidRequests.at(-1).cursor).toBeNull()
    expect(w.state.items.get(ITEM).sync.cursor).toBe('item1-cursor')
  })
  it('status shows the sync state, evidence counts and a webhook nudge without exposing anything else', async () => {
    const w = world()
    expect((await getSyncStatus(w.deps, owner)).syncs[0]).toMatchObject({ state: 'not_synced', counts: { posted: 0, pending: 0, removed: 0 } })
    await recordVerifiedWebhook(w.deps, { webhookType: 'TRANSACTIONS', webhookCode: 'SYNC_UPDATES_AVAILABLE', plaidItemId: 'plaid-item-1', bodyHash: 'h1' })
    expect((await getSyncStatus(w.deps, owner)).syncs[0].updatesAvailable).toBe(true)
    w.state.script = [page({ added: [tx('t1')] })]; await run(w)
    expect((await getSyncStatus(w.deps, owner)).syncs[0].updatesAvailable).toBe(false) // consumed by the sync
  })
})

describe('BANK-4 webhooks (nudge, not truth)', () => {
  const nudge = (w, hash = 'h1', pid = 'plaid-item-1') => recordVerifiedWebhook(w.deps, { webhookType: 'TRANSACTIONS', webhookCode: 'SYNC_UPDATES_AVAILABLE', plaidItemId: pid, bodyHash: hash })
  it('29. the same webhook delivered twice is ONE event (delivery counted) and creates no evidence', async () => {
    const w = world()
    expect(await nudge(w)).toEqual({ outcome: 'recorded' }); expect(await nudge(w)).toEqual({ outcome: 'duplicate' })
    expect(w.state.events).toHaveLength(1); expect(w.state.events[0].count).toBe(2); expect(w.state.evidence.size).toBe(0)
  })
  it('30. a webhook never syncs, never writes evidence or the cursor, and never touches canonical data', async () => {
    const w = world(); const before = canon(w)
    await nudge(w)
    expect(w.plaid.syncTransactions).not.toHaveBeenCalled(); expect(w.state.evidence.size).toBe(0); expect(w.state.items.get(ITEM).sync.cursor).toBeNull(); expect(canon(w)).toBe(before)
  })
  it('irrelevant webhook types and unknown Items are acknowledged and recorded as nothing', async () => {
    const w = world()
    expect(await recordVerifiedWebhook(w.deps, { webhookType: 'ITEM', webhookCode: 'ERROR', plaidItemId: 'plaid-item-1', bodyHash: 'x' })).toEqual({ outcome: 'ignored' })
    expect(await nudge(w, 'h2', 'unknown-item')).toEqual({ outcome: 'ignored' })
    expect(w.state.events).toHaveLength(0)
  })

  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const key = { kid: 'k1', alg: 'ES256', kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, expiredAt: null }
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
  const sign = (body, over = {}, header = { alg: 'ES256', kid: 'k1', typ: 'JWT' }) => {
    const payload = { iat: Math.floor(Date.now() / 1000), request_body_sha256: createHash('sha256').update(body).digest('hex'), ...over }
    const data = `${b64(header)}.${b64(payload)}`
    return `${data}.${createSign('SHA256').update(data).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  const verify = (body, header, k = key) => verifyPlaidWebhook({ rawBody: body, verificationHeader: header, getKey: async () => k })
  const BODY = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'plaid-item-1' }, null, 2)

  it('14b. a correctly signed, fresh webhook with the matching body hash verifies', async () => { expect(await verify(BODY, sign(BODY))).toBe(true) })
  it('rejects a tampered body, a stale iat, a wrong algorithm, an unknown or expired key, a forged signature and malformed input', async () => {
    expect(await verify(BODY + ' ', sign(BODY))).toBe(false)
    expect(await verify(BODY, sign(BODY, { iat: Math.floor(Date.now() / 1000) - 301 }))).toBe(false)
    expect(await verify(BODY, sign(BODY, {}, { alg: 'HS256', kid: 'k1' }))).toBe(false)
    expect(await verifyPlaidWebhook({ rawBody: BODY, verificationHeader: sign(BODY), getKey: async () => null })).toBe(false)
    expect(await verify(BODY, sign(BODY), { ...key, expiredAt: 1 })).toBe(false)
    const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' })
    expect(await verify(BODY, sign(BODY), { ...key, x: other.x, y: other.y })).toBe(false)
    for (const bad of [undefined, '', 'a.b', 'a.b.c', '...']) expect(await verify(BODY, bad)).toBe(false)
    expect(await verify('', sign(''))).toBe(false)
  })

  describe('plaid-webhook endpoint', () => {
    const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET']
    let saved
    beforeEach(() => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); process.env.PLAID_ENV = 'sandbox'; process.env.PLAID_CLIENT_ID = 'c'; process.env.PLAID_SECRET = 's'; vi.spyOn(console, 'log').mockImplementation(() => {}) })
    afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }; vi.restoreAllMocks() })
    const ev = (body, headers = {}) => ({ httpMethod: 'POST', headers, body })
    const mk = (w, extra = {}) => ({ plaidPort: () => ({ getWebhookVerificationKey: async () => key }), serviceClient: () => ({}), connectionRepo: () => w.deps.repo, syncRepo: () => w.deps.sync, ...extra })
    it('an unsigned or badly signed call is 401 and records nothing', async () => {
      const w = world()
      expect((await webhookHandler(mk(w))(ev(BODY))).statusCode).toBe(401)
      expect((await webhookHandler(mk(w))(ev(BODY, { 'plaid-verification': sign(BODY + 'x') }))).statusCode).toBe(401)
      expect(w.state.events).toHaveLength(0)
    })
    it('a verified SYNC_UPDATES_AVAILABLE is acknowledged (200) once per body, with no payload stored and no sync run', async () => {
      const w = world(); const h = webhookHandler(mk(w))
      const res = await h(ev(BODY, { 'plaid-verification': sign(BODY) })); await h(ev(BODY, { 'plaid-verification': sign(BODY) }))
      expect(res.statusCode).toBe(200)
      expect(w.state.events).toHaveLength(1); expect(w.state.events[0]).toMatchObject({ count: 2, key: sha256Hex(BODY), code: 'SYNC_UPDATES_AVAILABLE' })
      expect(JSON.stringify(w.state.events)).not.toMatch(/plaid-item-1/) // the body is not persisted
      expect(w.state.evidence.size).toBe(0)
    })
    it('an unknown Item or irrelevant type is acknowledged with 200 and records nothing', async () => {
      const w = world(); const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'nope' })
      expect((await webhookHandler(mk(w))(ev(body, { 'plaid-verification': sign(body) }))).statusCode).toBe(200)
      expect(w.state.events).toHaveLength(0)
    })
    it('fails closed when Plaid is not configured or the environment is not sandbox/production; only POST is accepted', async () => {
      const w = world(); delete process.env.PLAID_SECRET
      expect((await webhookHandler(mk(w))(ev(BODY, { 'plaid-verification': sign(BODY) }))).statusCode).toBe(500)
      process.env.PLAID_SECRET = 's'; process.env.PLAID_ENV = 'development'
      expect((await webhookHandler(mk(w))(ev(BODY, { 'plaid-verification': sign(BODY) }))).statusCode).toBe(500)
      process.env.PLAID_ENV = 'sandbox'
      expect((await webhookHandler(mk(w))({ httpMethod: 'GET', headers: {} })).statusCode).toBe(405)
    })
  })
})

describe('BANK-4 plaid-sync endpoint', () => {
  const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'POWERON_BANK_TOKEN_ENCRYPTION_KEY']
  let saved
  beforeEach(() => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); process.env.PLAID_ENV = 'sandbox'; process.env.PLAID_CLIENT_ID = 'c'; process.env.PLAID_SECRET = 's'; process.env.POWERON_BANK_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64'); vi.spyOn(console, 'log').mockImplementation(() => {}) })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }; vi.restoreAllMocks() })
  const ev = (method, body, headers = { authorization: 'Bearer t' }) => ({ httpMethod: method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const mk = (profile, w) => ({
    verifyUser: async () => ({ id: 'u1' }),
    userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) }),
    serviceClient: () => ({}), plaidPort: () => w.plaid, connectionRepo: () => w.deps.repo, accountRepo: () => w.deps.accounts, syncRepo: () => w.deps.sync,
  })
  it('unauthenticated 401, employee/viewer 403, unknown action 400, wrong method 405 - and the provider is never called', async () => {
    const w = world(loadBankTokenEncryptionKey(process.env)); const owner_ = { org_id: ORG_A, role: 'owner', is_active: true }
    expect((await syncHandler({ ...mk(owner_, w), verifyUser: async () => null })(ev('GET', undefined, {}))).statusCode).toBe(401)
    for (const role of ['employee', 'viewer']) expect((await syncHandler(mk({ org_id: ORG_A, role, is_active: true }, w))(ev('POST', { action: 'sync', itemId: ITEM }))).statusCode).toBe(403)
    expect((await syncHandler(mk(owner_, w))(ev('POST', { action: 'nope' }))).statusCode).toBe(400)
    expect((await syncHandler(mk(owner_, w))(ev('DELETE'))).statusCode).toBe(405)
    expect(w.plaid.syncTransactions).not.toHaveBeenCalled()
  })
  it('the organization comes from the profile only: a body organizationId is ignored and another org\'s Item is 404', async () => {
    const w = world(loadBankTokenEncryptionKey(process.env)); const h = syncHandler(mk({ org_id: ORG_A, role: 'owner', is_active: true }, w))
    expect((await h(ev('POST', { action: 'sync', itemId: ITEM_B, organizationId: ORG_B }))).statusCode).toBe(404)
    w.state.script = [page({ added: [tx('t1')] })]
    const ok = await h(ev('POST', { action: 'sync', itemId: ITEM, organizationId: ORG_B }))
    expect(ok.statusCode, ok.body).toBe(200)
    const status = await h(ev('GET'))
    expect(ok.body + status.body).not.toMatch(/access-sandbox|v1:|secret|cursor|Coffee|Cafe/i)
  })
})

describe('BANK-2 Link token and config (BANK-4 additions)', () => {
  it('the webhook URL is optional, https only, and added ONLY to new-connection Link tokens (never update mode)', async () => {
    const base = { PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's' }
    expect(loadPlaidConfig(base).webhookUrl).toBeNull()
    expect(() => loadPlaidConfig({ ...base, PLAID_WEBHOOK_URL: 'http://insecure.example/hook' })).toThrow()
    const cfg = loadPlaidConfig({ ...base, PLAID_WEBHOOK_URL: 'https://app.example.com/.netlify/functions/plaid-webhook' })
    const seen: any[] = []
    const api = { linkTokenCreate: async (r) => { seen.push(r); return { data: { link_token: 'l', expiration: 'e' } } } }
    const port = createPlaidSdkPort(cfg, api as never)
    await port.createLinkToken({ clientUserId: 'x' }); await port.createLinkToken({ clientUserId: 'x', accessToken: ACCESS })
    expect(seen[0]).toMatchObject({ webhook: 'https://app.example.com/.netlify/functions/plaid-webhook', products: ['transactions'] })
    expect(seen[1].webhook).toBeUndefined(); expect(seen[1].products).toBeUndefined()
    await createPlaidSdkPort(loadPlaidConfig(base), api as never).createLinkToken({ clientUserId: 'x' })
    expect(seen[2].webhook).toBeUndefined()
  })
})

describe('BANK-4 hardening: sync is decoupled from account discovery', () => {
  it('a normal sync never calls /accounts/get and never writes provider accounts', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1')] })]
    await run(w)
    expect(w.plaid.getAccounts).not.toHaveBeenCalled(); expect(w.state.writes).not.toContain('accounts-upsert')
    expect(w.state.evidence.get(`${ITEM}|t1`).accountRef).toBe('pa-1') // resolved from the accounts BANK-3 already stored
  })
  it('a known (even retired/inactive) provider account still resolves; an unknown one fails closed', async () => {
    const w = world(); w.state.accounts[0].status = 'inactive'
    w.state.script = [page({ added: [tx('t1')] })]; await expect(run(w)).resolves.toMatchObject({ added: 1 })
    w.state.script = [page({ nextCursor: 'c2', added: [tx('t2', { accountId: 'unknown-acc' })], accounts: [{ accountId: 'unknown-acc', currency: 'USD' }] })]
    await expect(run(w)).rejects.toMatchObject({ code: 'sync_failed', httpStatus: 409 })
    expect(w.state.evidence.has(`${ITEM}|t2`)).toBe(false); expect(w.state.items.get(ITEM).sync.cursor).toBe('c1')
  })
})

describe('BANK-4 hardening: ITEM_LOGIN_REQUIRED', () => {
  const loginRequired = () => new PlaidApiFailure('ITEM_LOGIN_REQUIRED', 'ITEM_ERROR', 400)
  it('during account discovery it becomes the sanitized login-required state (connection marked, no raw Plaid error)', async () => {
    const w = world(); w.plaid.getAccounts.mockImplementationOnce(async () => { throw loginRequired() })
    const err = await discoverAccounts(w.deps, owner, { itemId: ITEM }).catch(e => e)
    expect(err).toBeInstanceOf(BankConnectionError)
    expect(err).toMatchObject({ code: 'login_required', httpStatus: 409, message: 'The bank needs you to sign in again. Use Reconnect.' })
    expect(JSON.stringify(err.message)).not.toMatch(/ITEM_LOGIN_REQUIRED|ITEM_ERROR/)
    expect(w.state.items.get(ITEM).status).toBe('login_required')
    expect((await getSyncStatus(w.deps, owner)).syncs[0].state).toBe('login_required')
  })
  it('during a transaction sync it takes the same path', async () => {
    const w = world(); w.state.script = [loginRequired()]
    await expect(run(w)).rejects.toMatchObject({ code: 'login_required', httpStatus: 409 })
    expect(w.state.items.get(ITEM).status).toBe('login_required'); expect((await getSyncStatus(w.deps, owner)).syncs[0].state).toBe('login_required')
  })
})

describe('BANK-4 hardening: serverless bounds', () => {
  it('stops cleanly when the time budget is exceeded between pages: cursor kept, nothing written, never "synced"', async () => {
    const w = world(); w.state.clock.t = Date.now(); w.state.items.get(ITEM).sync.cursor = 'c0'
    w.state.script = [() => { w.state.clock.t += SYNC_TIME_BUDGET_MS + 1; return page({ nextCursor: 'c1', hasMore: true, added: [tx('t1')] }) }, page({ nextCursor: 'c2' })]
    await expect(run(w)).rejects.toMatchObject({ code: 'sync_failed', httpStatus: 503, message: expect.stringMatching(/took too long/) })
    expect(w.state.plaidRequests).toHaveLength(1); expect(w.state.evidence.size).toBe(0)
    expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c0', status: 'failed', lastErrorCode: 'SYNC_TIME_BUDGET', lastSuccessfulAt: null })
    expect(deriveSyncState({ status: 'healthy' }, w.state.items.get(ITEM).sync)).toBe('error')
  })
  it('if the budget runs out while WRITING, the cursor still does not move and no success is recorded; the retry is idempotent', async () => {
    const w = world(); w.state.clock.t = Date.now(); w.state.items.get(ITEM).sync.cursor = 'c0'
    const two = () => [page({ nextCursor: 'c1', hasMore: true, added: [tx('t1')] }), page({ nextCursor: 'c2', added: [tx('t2')] })]
    w.state.script = two(); w.state.onUpsert = () => { w.state.clock.t += SYNC_TIME_BUDGET_MS + 1 }
    await expect(run(w)).rejects.toMatchObject({ httpStatus: 503 })
    expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c0', status: 'failed', lastSuccessfulAt: null })
    expect(w.state.evidence.size).toBe(1) // valid, idempotent partial evidence is allowed to remain (evidence layer only)
    w.state.onUpsert = null; w.state.clock.t = null; w.state.script = two(); await run(w)
    expect(w.state.evidence.size).toBe(2); expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c2', status: 'idle' })
  })
  it('the page bound stops a runaway provider: bounded failure, nothing saved, cursor kept', async () => {
    const w = world(); w.state.items.get(ITEM).sync.cursor = 'c0'
    w.state.script = Array.from({ length: MAX_PAGES + 5 }, (_, i) => page({ nextCursor: `n${i}`, hasMore: true }))
    await expect(run(w)).rejects.toMatchObject({ code: 'sync_failed' })
    expect(w.state.plaidRequests).toHaveLength(MAX_PAGES); expect(w.state.evidence.size).toBe(0)
    expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c0', status: 'failed', lastErrorCode: 'SYNC_TOO_LARGE' })
  })
  it('a killed invocation cannot block retries for long: the abandoned lease is short and re-claimable', async () => {
    expect(SYNC_LEASE_MS).toBeLessThanOrEqual(2 * 60 * 1000)
    const w = world(); const i = w.state.items.get(ITEM); i.sync.status = 'syncing'; i.sync.startedAt = new Date(Date.now() - SYNC_LEASE_MS - 1000).toISOString()
    await expect(run(w)).resolves.toBeTruthy()
  })
})

describe('BANK-4 hardening: first-sync Waiting/Synced mapping (documented transactions_update_status only)', () => {
  it('maps the status exactly', () => {
    const t = (status, data, prior) => classifySyncOutcome(status, data, prior)
    expect(t('INITIAL_UPDATE_COMPLETE', false, false)).toBe('synced'); expect(t('HISTORICAL_UPDATE_COMPLETE', false, false)).toBe('synced')
    expect(t('NOT_READY', false, false)).toBe('waiting'); expect(t('NOT_READY', true, false)).toBe('waiting'); expect(t('NOT_READY', false, true)).toBe('synced')
    for (const unknown of [null, 'TRANSACTIONS_UPDATE_STATUS_UNKNOWN', 'SOMETHING_NEW']) {
      expect(t(unknown, false, false)).toBe('unconfirmed') // an empty answer is NOT assumed to mean "still preparing"
      expect(t(unknown, true, false)).toBe('synced'); expect(t(unknown, false, true)).toBe('synced')
    }
  })
  it('an empty first answer with an unknown status is "unconfirmed": persisted without a success stamp and without the waiting marker', async () => {
    const w = world(); w.state.script = [page({ updateStatus: 'TRANSACTIONS_UPDATE_STATUS_UNKNOWN', nextCursor: 'c0' })]
    expect(await run(w)).toMatchObject({ state: 'unconfirmed' })
    const sync = w.state.items.get(ITEM).sync
    expect(sync).toMatchObject({ lastSuccessfulAt: null, lastErrorCode: null, cursor: 'c0' })
    expect(deriveSyncState({ status: 'healthy' }, sync)).toBe('unconfirmed')
  })
  it('NOT_READY is remembered as waiting across reloads; a later complete sync clears it', async () => {
    const w = world(); w.state.script = [page({ updateStatus: 'NOT_READY' })]; await run(w)
    expect(deriveSyncState({ status: 'healthy' }, w.state.items.get(ITEM).sync)).toBe('waiting')
    w.state.script = [page({ nextCursor: 'c2', updateStatus: 'INITIAL_UPDATE_COMPLETE', added: [tx('t1')] })]; await run(w)
    expect(deriveSyncState({ status: 'healthy' }, w.state.items.get(ITEM).sync)).toBe('synced')
  })
})

describe('BANK-4 hardening: webhook verification (authoritative checks)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' })
  const key = { kid: 'kid-1', alg: 'ES256', kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, expiredAt: null }
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
  const sign = (body, over = {}, header = { alg: 'ES256', kid: 'kid-1', typ: 'JWT' }, now = Math.floor(Date.now() / 1000)) => {
    const payload = { iat: now, request_body_sha256: createHash('sha256').update(body).digest('hex'), ...over }
    const data = `${b64(header)}.${b64(payload)}`
    return `${data}.${createSign('SHA256').update(data).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
  }
  const ok = (body, header, k = key) => verifyPlaidWebhook({ rawBody: body, verificationHeader: header, getKey: async () => k })
  const PRETTY = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'i' }, null, 2)

  it('the hash covers the EXACT raw bytes: Plaid\'s 2-space formatting verifies, a compact re-serialisation does not, and Buffers match strings', async () => {
    expect(await ok(PRETTY, sign(PRETTY))).toBe(true)
    expect(await ok(Buffer.from(PRETTY, 'utf8'), sign(PRETTY))).toBe(true)
    expect(await ok(JSON.stringify(JSON.parse(PRETTY)), sign(PRETTY))).toBe(false) // re-serialised
    expect(await ok(PRETTY.replace(/\n/g, '\r\n'), sign(PRETTY))).toBe(false)
  })
  it('only ES256 is accepted: none, HS256 key-confusion, RS256 and look-alike spellings are refused', async () => {
    for (const alg of ['none', 'HS256', 'RS256', 'es256', 'ES384', 'ES256 ', undefined]) expect(await ok(PRETTY, sign(PRETTY, {}, { alg, kid: 'kid-1' }))).toBe(false)
    // classic confusion: HS256 token "signed" with the public key material as the HMAC secret
    const data = `${b64({ alg: 'HS256', kid: 'kid-1' })}.${b64({ iat: Math.floor(Date.now() / 1000), request_body_sha256: sha256Hex(PRETTY) })}`
    const { createHmac } = await import('node:crypto')
    expect(await ok(PRETTY, `${data}.${createHmac('sha256', JSON.stringify(jwk)).update(data).digest('base64url')}`)).toBe(false)
    // a token whose JWT header says ES256 but whose KEY is not an EC P-256 key is refused too
    expect(await ok(PRETTY, sign(PRETTY), { ...key, alg: 'RS256' })).toBe(false); expect(await ok(PRETTY, sign(PRETTY), { ...key, kty: 'RSA' })).toBe(false); expect(await ok(PRETTY, sign(PRETTY), { ...key, crv: 'P-384' })).toBe(false)
  })
  it('kid rules: must be well-formed, must match the returned key, unknown kid and lookup failures are refused', async () => {
    expect(await ok(PRETTY, sign(PRETTY, {}, { alg: 'ES256', kid: 'kid-1' }), { ...key, kid: 'other' })).toBe(false)
    for (const kid of ['', 'a b', 'x'.repeat(200), '../etc', 5, null]) expect(await ok(PRETTY, sign(PRETTY, {}, { alg: 'ES256', kid }))).toBe(false)
    expect(await verifyPlaidWebhook({ rawBody: PRETTY, verificationHeader: sign(PRETTY), getKey: async () => null })).toBe(false)
    expect(await verifyPlaidWebhook({ rawBody: PRETTY, verificationHeader: sign(PRETTY), getKey: async () => { throw new Error('plaid down') } })).toBe(false)
  })
  it('key expiry: ANY non-null expired_at means the key is not usable (SDK: "timestamp when the key expired")', async () => {
    const far = Math.floor(Date.now() / 1000) + 86400
    expect(await ok(PRETTY, sign(PRETTY), { ...key, expiredAt: 1 })).toBe(false); expect(await ok(PRETTY, sign(PRETTY), { ...key, expiredAt: far })).toBe(false)
  })
  it('iat/exp rules: stale (>5 min), far-future, missing, non-numeric and expired tokens are refused; fresh ones pass', async () => {
    const now = Math.floor(Date.now() / 1000)
    expect(await ok(PRETTY, sign(PRETTY, { iat: now - 299 }))).toBe(true)
    for (const iat of [now - 301, now + 3600, undefined, 'now', null, NaN]) expect(await ok(PRETTY, sign(PRETTY, { iat }))).toBe(false)
    expect(await ok(PRETTY, sign(PRETTY, { exp: now - 1 }))).toBe(false); expect(await ok(PRETTY, sign(PRETTY, { exp: now + 60 }))).toBe(true)
  })
  it('malformed JWTs, bad base64url, wrong signature length, oversized input and empty bodies are refused without throwing', async () => {
    for (const bad of ['', 'a', 'a.b', 'a.b.c.d', '..', 'a..c', 'e30.e30.', 'not base64!.e30.e30', `${'a'.repeat(5000)}.e30.e30`]) expect(await ok(PRETTY, bad)).toBe(false)
    const good = sign(PRETTY); const [h, p, sig] = good.split('.')
    expect(await ok(PRETTY, `${h}.${p}.${sig.slice(0, -4)}`)).toBe(false) // truncated signature
    expect(await ok(PRETTY, `${h}.${p}.${Buffer.alloc(64, 1).toString('base64url')}`)).toBe(false) // right length, wrong signature
    expect(await ok('', sign(''))).toBe(false); expect(await ok('x'.repeat(20000), sign('x'.repeat(20000)))).toBe(false)
    expect(await ok(PRETTY, sign(PRETTY, { request_body_sha256: undefined }))).toBe(false); expect(await ok(PRETTY, sign(PRETTY, { request_body_sha256: 5 }))).toBe(false)
  })

  describe('verification-key cache', () => {
    const k = (kid) => ({ ...key, kid })
    it('caches a good key (one Plaid lookup), re-fetches after the TTL, and bounds its size', async () => {
      let t = 0; const fetchKey = vi.fn(async (kid) => k(kid))
      const get = createWebhookKeyCache(fetchKey, { ttlMs: 1000, maxEntries: 2, nowMs: () => t })
      await get('a'); await get('a'); expect(fetchKey).toHaveBeenCalledTimes(1)
      t = 1001; await get('a'); expect(fetchKey).toHaveBeenCalledTimes(2) // a rotated-out key is picked up again
      await get('b'); await get('c'); await get('d'); await get('a') // 2-entry cap: oldest evicted, still correct
      expect(fetchKey.mock.calls.length).toBeGreaterThan(2); expect((await get('d'))?.kid).toBe('d')
    })
    it('remembers an unknown/failed kid briefly so a flood of garbage kids cannot become a flood of Plaid calls; malformed kids never reach Plaid', async () => {
      let t = 0; const fetchKey = vi.fn(async () => { throw new Error('unknown kid') })
      const get = createWebhookKeyCache(fetchKey, { negativeTtlMs: 5000, nowMs: () => t })
      expect(await get('bad-kid')).toBeNull(); expect(await get('bad-kid')).toBeNull(); expect(fetchKey).toHaveBeenCalledTimes(1)
      t = 5001; await get('bad-kid'); expect(fetchKey).toHaveBeenCalledTimes(2)
      for (const kid of ['', 'has space', 'x'.repeat(300), '../x']) expect(await get(kid)).toBeNull()
      expect(fetchKey).toHaveBeenCalledTimes(2)
    })
  })

  it('the endpoint hashes the raw bytes (including a base64-encoded body) and answers 401 for a re-serialised one', async () => {
    const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET']; const saved = Object.fromEntries(ENV.map(e => [e, process.env[e]]))
    process.env.PLAID_ENV = 'sandbox'; process.env.PLAID_CLIENT_ID = 'c'; process.env.PLAID_SECRET = 's'; vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const w = world(); const mk = () => ({ getKey: async () => key, plaidPort: () => ({}), serviceClient: () => ({}), connectionRepo: () => w.deps.repo, syncRepo: () => w.deps.sync })
      const body = JSON.stringify({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: 'plaid-item-1' }, null, 2)
      const h = webhookHandler(mk())
      expect((await h({ httpMethod: 'POST', headers: { 'plaid-verification': sign(body) }, body: Buffer.from(body).toString('base64'), isBase64Encoded: true })).statusCode).toBe(200)
      expect((await h({ httpMethod: 'POST', headers: { 'Plaid-Verification': sign(body) }, body })).statusCode).toBe(200)
      expect((await h({ httpMethod: 'POST', headers: { 'plaid-verification': sign(body) }, body: JSON.stringify(JSON.parse(body)) })).statusCode).toBe(401)
      expect(w.state.events).toHaveLength(1); expect(w.state.events[0].count).toBe(2)
    } finally { for (const e of ENV) { if (saved[e] === undefined) delete process.env[e]; else process.env[e] = saved[e] }; vi.restoreAllMocks() }
  })
})

describe('BANK-4 failure observability (stage + sanitized class, never data)', () => {
  const failedLog = (w) => w.logs.filter(l => l.event === 'bank.sync.failed').at(-1)
  const OWNER_MESSAGES = /^(The sync could not be saved|A bank transaction could not be stored|The bank connection service|The bank connection service returned|The stored bank credential|The bank returned)/
  const noLeak = (w, extra = []) => {
    const text = JSON.stringify(w.logs)
    for (const bad of [ACCESS, 'Coffee', 'Cafe', '12.34', 'acc-1', 't1', 'Private', ...extra]) expect(text).not.toContain(bad)
  }

  it('persistence: a database failure is logged with stage + SQLSTATE + constraint NAME only; the owner message stays generic and the cursor stays put', async () => {
    const w = world(); w.state.items.get(ITEM).sync.cursor = 'c0'; w.state.script = [page({ added: [tx('t1')] })]
    w.deps.sync.upsertEvidence = async () => { throw new PersistenceFailure('upsert_evidence', '23514', 'financial_provider_transactions_seen_order') }
    const err = await run(w).catch(e => e)
    expect(err).toMatchObject({ code: 'persistence_failed', httpStatus: 503 }); expect(err.message).toMatch(OWNER_MESSAGES)
    expect(failedLog(w)).toMatchObject({ code: 'EVIDENCE_PERSISTENCE_FAILED', stage: 'evidence_persistence', errorClass: 'PersistenceFailure', detail: 'op=upsert_evidence;sqlstate=23514;constraint=financial_provider_transactions_seen_order' })
    expect(w.state.items.get(ITEM).sync).toMatchObject({ cursor: 'c0', status: 'failed', lastErrorCode: 'EVIDENCE_PERSISTENCE_FAILED', lastSuccessfulAt: null })
    noLeak(w)
  })
  it('cursor_finalize: an unexpected exception is recorded by constructor name and stage only - never its message', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1')] })]
    w.deps.sync.finishSync = async () => { throw new TypeError(`boom ${ACCESS} Coffee 12.34 acc-1`) }
    await expect(run(w)).rejects.toMatchObject({ httpStatus: 503 })
    expect(failedLog(w)).toMatchObject({ code: 'CURSOR_FINALIZE_FAILED', stage: 'cursor_finalize', errorClass: 'TypeError' }); expect(failedLog(w).detail).toBeUndefined()
    noLeak(w, ['boom'])
  })
  it('account_resolution: failing to load the known accounts, and an unknown account, are both attributed to that stage', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1')] })]
    w.deps.accounts.listProviderAccounts = async () => { throw new Error('db said Coffee') }
    await expect(run(w)).rejects.toBeTruthy(); expect(failedLog(w)).toMatchObject({ stage: 'account_resolution', code: 'ACCOUNT_RESOLUTION_FAILED', errorClass: 'Error' }); noLeak(w)
    const w2 = world(); w2.state.script = [page({ added: [tx('t1', { accountId: 'nope' })], accounts: [{ accountId: 'nope', currency: 'USD' }] })]
    await expect(run(w2)).rejects.toBeTruthy(); expect(failedLog(w2)).toMatchObject({ stage: 'account_resolution', code: 'ACCOUNT_UNKNOWN' })
  })
  it('provider_request: a Plaid error keeps ONLY its type/code/HTTP status (sanitized) for the log; the owner sees the generic provider message', async () => {
    const w = world(); w.state.script = [new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500)]
    const err = await run(w).catch(e => e)
    expect(err).toMatchObject({ code: 'plaid_unavailable', httpStatus: 502 })
    expect(failedLog(w)).toMatchObject({ stage: 'provider_request', code: 'INTERNAL_SERVER_ERROR', errorClass: 'PlaidApiFailure', detail: 'plaid=API_ERROR/INTERNAL_SERVER_ERROR;http=500' }); noLeak(w)
  })
  it('provider_response: a response the adapter cannot read becomes a typed error with no response content, and a distinct code', async () => {
    const api = { transactionsSync: async () => ({ data: { added: 5, modified: [], removed: [], accounts: [], next_cursor: 'c', has_more: false, secretish: ACCESS } }) }
    const port = createPlaidSdkPort(loadPlaidConfig({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's' }), api as never)
    const e = await port.syncTransactions({ accessToken: ACCESS, cursor: null, count: 500 }).catch(x => x)
    expect(e).toBeInstanceOf(ProviderResponseError); expect(JSON.stringify([e.message, e.stack])).not.toContain(ACCESS)
    const w = world(); w.state.script = [new ProviderResponseError()]
    const err = await run(w).catch(x => x)
    expect(err).toMatchObject({ code: 'sync_failed', httpStatus: 502 })
    expect(failedLog(w)).toMatchObject({ stage: 'provider_response', code: 'PROVIDER_RESPONSE_UNREADABLE', errorClass: 'ProviderResponseError' }); noLeak(w)
  })
  it('transform: a transaction that cannot be stored faithfully is attributed to the transform stage', async () => {
    const w = world(); w.state.script = [page({ added: [tx('t1', { amount: 1.005 })] })]
    await expect(run(w)).rejects.toBeTruthy(); expect(failedLog(w)).toMatchObject({ stage: 'transform', code: 'EVIDENCE_INVALID_AMOUNT', errorClass: 'EvidenceRejected' }); noLeak(w)
  })
  it('credential: an unreadable stored credential is attributed to the credential stage', async () => {
    const w = world(); w.deps.key = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
    await expect(run(w)).rejects.toMatchObject({ code: 'credential_unreadable' })
    expect(failedLog(w)).toMatchObject({ stage: 'credential', code: 'CREDENTIAL_UNREADABLE' }); expect(w.plaid.syncTransactions).not.toHaveBeenCalled(); noLeak(w)
  })

  it('the logger emits only allowlisted fields, strips unsafe characters, and ignores any extra property (message, stack, response, token)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    safeLog({ event: 'bank.sync.failed', organizationId: ORG_A, itemId: ITEM, code: 'X', stage: 'evidence_persistence', errorClass: 'PersistenceFailure',
      detail: 'op=upsert;sqlstate=23514;constraint=a_b "quoted" {json} <tag>\nnext', message: 'Failing row contains (Coffee)', stack: 'at x', response: { token: ACCESS }, error: new Error(ACCESS) } as never)
    const line = String(spy.mock.calls.at(-1)![0]); spy.mockRestore()
    const parsed = JSON.parse(line)
    expect(Object.keys(parsed).sort()).toEqual(['code', 'detail', 'errorClass', 'event', 'itemId', 'organizationId', 'outcome', 'stage'].filter(k => k in parsed))
    expect(parsed.detail).toBe('op=upsert;sqlstate=23514;constraint=a_bquotedjsontagnext'.slice(0, 160))
    expect(line).not.toMatch(/Coffee|at x|access-|Failing row|<tag>|\\n/)
  })
  it('the repo reduces a database error to operation + SQLSTATE + constraint name and never reads the message body, details or hint', () => {
    const src = readFileSync(new URL('../bankSyncRepo.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(src).toMatch(/constraint "\(\[a-z\]\[a-z0-9_\]\{2,80\}\)"/)
    expect(src).not.toMatch(/\.details|\.hint|throw new Error\(error|new PersistenceFailure\([^)]*message/)
    expect(src).toContain('throw new PersistenceFailure(operation, sqlState, named ? named[1] : null)') // the message is only matched for a constraint NAME, never forwarded
  })
})

describe('BANK-4 static guarantees', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  const files = ['../bankSyncService.ts', '../bankSyncRepo.ts', '../transactionEvidence.ts', '../plaidWebhookVerify.ts', '../../../../netlify/functions/bank/plaid-sync.ts', '../../../../netlify/functions/bank/plaid-webhook.ts']
  it('33-36. BANK-4 code never references the ledger, Cash OS accounts, Outlook, projects, payroll, obligations, debt or reconciliation', () => {
    for (const f of files) {
      const code = read(f)
      expect(code, f).not.toMatch(/financial_transactions|financial_accounts|include_in_cash|financial_obligation|cash_commitments|financial_liability|financial_transaction_links|app_state|outlook|payroll|reconcil|financial_provider_interpretations|financial_provider_account_mappings/i)
    }
  })
  it('the repo writes only provider evidence, Item sync state and webhook idempotency rows, and never raw JSON columns', () => {
    const repo = read('../bankSyncRepo.ts')
    const tables = [...repo.matchAll(/from\('([a-z_]+)'\)/g)].map(m => m[1])
    expect(new Set(tables)).toEqual(new Set(['financial_provider_items', 'financial_provider_transactions', 'financial_provider_webhook_events']))
    expect(repo).not.toMatch(/raw_payload|original_description|provider_metadata|raw_evidence|payload:/)
    expect(repo).not.toMatch(/\.select\(\s*['"`]\*['"`]/)
    expect(repo).toContain("onConflict: 'provider_item_ref,provider_transaction_id'")
    expect(repo).not.toMatch(/\.delete\(/) // evidence is never hard-deleted
  })
  it('only /transactions/sync is used: no /transactions/get, no refresh, no sandbox shortcuts anywhere in src or functions', () => {
    for (const f of [...files, '../plaidPort.ts', '../bankAccountService.ts', '../bankConnectionService.ts']) {
      expect(read(f), f).not.toMatch(/transactionsGet|transactionsRefresh|transactionsRecurring|sandboxItemFireWebhook|sandboxTransactionsCreate|sandboxPublicTokenCreate/)
    }
    expect(read('../plaidPort.ts')).toContain('transactionsSync')
  })
  it('no transaction text, amounts, masks or provider ids are ever logged (counts and internal ids only)', () => {
    const svc = read('../bankSyncService.ts')
    const logCalls = [...svc.matchAll(/note\([^)]*\)/g)].map(m => m[0]).join('\n')
    expect(logCalls).not.toMatch(/name|merchant|amount|mask|providerTransactionId|transactionId|cursor|accessToken|token/i)
  })
  it('the sync service is decoupled from account discovery (no /accounts/get, no discoverAccounts, no provider-account writes)', () => {
    const svc = read('../bankSyncService.ts')
    expect(svc).not.toMatch(/discoverAccounts|getAccounts|accountsGet|upsertProviderAccounts|deactivateProviderAccounts|financial_provider_accounts/)
  })
  it('37. migrations are unchanged (BANK-4 needs none)', async () => {
    const { readdirSync } = await import('node:fs')
    const nums = readdirSync(new URL('../../../../supabase/migrations/', import.meta.url)).map(f => parseInt(f, 10)).filter(n => n >= 153)
    expect(Math.max(...nums)).toBeLessThanOrEqual(158) // BANK-5 added 155, BANK-6P added 156, BANK-6B added 157 and BANK-6D added 158; BANK-4 itself needed none
  })
  it('the browser code never references secrets and never auto-syncs on load', () => {
    const ui = readFileSync(new URL('../../../features/bank-connection/useBankConnection.ts', import.meta.url), 'utf8')
    expect(ui).not.toMatch(/access_token|encrypted|PLAID_SECRET|service_role|api\.plaid\.com/i)
    expect(ui).toMatch(/useEffect\(\(\) => \{ void refresh\(\); void refreshAccounts\(\); void refreshSyncs\(\) \}/) // load = reads only
  })
})
