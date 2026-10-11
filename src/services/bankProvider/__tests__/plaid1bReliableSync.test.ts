// @ts-nocheck -- in-memory fakes mirror the repository contracts; the Netlify handlers under test are untyped
/**
 * PLAID-1B: reliable multi-account historical sync. Fakes mirror bankSyncRepo's compare-and-set and lease-token fencing exactly; the audit SQL draft
 * runs on real PostgreSQL (PGlite). No network, no Plaid, no production database.
 */
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import {
  BACKGROUND_SYNC_BUDGET_MS, BACKGROUND_SYNC_LEASE_MS, SYNC_LEASE_MS, SYNC_TIME_BUDGET_MS, getSyncStatus, recoveryFor, syncTransactions, cursorFingerprint,
} from '../bankSyncService'
import { contextFor } from '../bankConnectionService'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { PlaidApiFailure } from '../plaidPort'
import { buildHandler as backgroundHandler } from '../../../../netlify/functions/bank/plaid-sync-background'
import { buildHandler as syncHandler } from '../../../../netlify/functions/bank/plaid-sync'

const ORG = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const OWNER = { organizationId: ORG, userId: 'u-owner', role: 'owner' }
const ITEM = '30000000-0000-4000-8000-000000000001'
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const BG = { budgetMs: BACKGROUND_SYNC_BUDGET_MS, leaseMs: BACKGROUND_SYNC_LEASE_MS, trigger: 'owner_background' }

const tx = (id, accountId, over = {}) => ({ transactionId: id, accountId, amount: 12.5, currency: 'USD', date: '2026-08-01', authorizedDate: null, name: 'HOME DEPOT', merchantName: 'Home Depot', pending: false, pendingTransactionId: null, categoryPrimary: null, categoryDetailed: null, categoryConfidence: null, ...over })
const page = (over) => ({ added: [], modified: [], removed: [], nextCursor: 'c-next', hasMore: false, updateStatus: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], ...over })

/** Three accounts under ONE Item. `pagesFor(cursor)` returns the provider's answer for a cursor; the clock advances per provider call. */
function world({ pageMs = 1500 } = {}) {
  const clock = { t: Date.parse('2026-10-11T12:00:00Z') }
  const item = { org: ORG, providerItemId: 'item-wf', status: 'healthy', sync: { status: 'idle', cursor: null, startedAt: null, completedAt: null, lastSuccessfulAt: null, lastErrorCode: null } }
  const evidence = new Map(), events = [], cursorWrites = []
  const hooks = { onUpsert: null, onPage: null }
  const accountsList = ['wf-chk', 'wf-sav', 'wf-card'].map((a, i) => ({ id: `pa-${i}`, providerItemRef: ITEM, providerAccountId: a, status: 'active' }))
  const repo = {
    async getItem(org, id) { return id === ITEM && org === item.org ? { id, provider: 'plaid', providerItemId: item.providerItemId, status: item.status, environment: 'production' } : null },
    async getActiveCredential(org, id) { return id === ITEM && org === item.org ? encryptProviderToken('access-production-x', KEY, contextFor(OWNER, 'plaid', 'item-wf')) : null },
    async listItems(org) { return org === item.org ? [{ id: ITEM, provider: 'plaid', status: item.status, environment: 'production', institutionName: 'Wells Fargo', connectedAt: null, disconnectedAt: null, lastSuccessfulSyncAt: item.sync.lastSuccessfulAt }] : [] },
  }
  const accounts = { async listProviderAccounts(org, id) { return org === ORG && id === ITEM ? accountsList.map(a => ({ ...a })) : [] }, async markItemLoginRequired() { item.status = 'login_required' } }
  const iso = () => new Date(clock.t).toISOString()
  const sync = {
    async getSyncState(org, id) { return org === item.org && id === ITEM ? { ...item.sync } : null },
    // Mirrors bankSyncRepo.claimSync: compare-and-set unless a FRESH lease is held; stamps the run's token.
    async claimSync(org, id, staleIso, startedAt) {
      if (org !== item.org || id !== ITEM || item.status === 'disconnected') return false
      if (item.sync.status === 'syncing' && item.sync.startedAt >= staleIso) return false
      item.sync = { ...item.sync, status: 'syncing', startedAt: startedAt ?? iso() }; return true
    },
    // Mirrors the fenced update: applies only while this run's token is still on the Item.
    async finishSync(org, id, { cursor, state, startedAt }) {
      if (startedAt && !(item.sync.status === 'syncing' && item.sync.startedAt === startedAt)) return 0
      cursorWrites.push(cursor)
      item.sync = { ...item.sync, status: 'idle', cursor, completedAt: iso(), lastErrorCode: null, lastSuccessfulAt: state === 'synced' ? iso() : item.sync.lastSuccessfulAt }; return 1
    },
    async failSync(org, id, code, startedAt) {
      if (startedAt && !(item.sync.status === 'syncing' && item.sync.startedAt === startedAt)) return 0
      item.sync = { ...item.sync, status: 'failed', lastErrorCode: code }; return 1
    },
    async markLoginRequired() { item.status = 'login_required' },
    async upsertEvidence(org, id, rows) {
      hooks.onUpsert?.()
      for (const { evidence: e, providerAccountRef } of rows) evidence.set(e.providerTransactionId, { accountRef: providerAccountRef, ...e, removedAt: null })
    },
    async markRemoved(org, id, ids) { let n = 0; for (const t of ids) { const r = evidence.get(t); if (r && !r.removedAt) { r.removedAt = iso(); n++ } } return n },
    async countEvidence() { return { posted: 0, pending: 0, removed: 0 } },
    async recordWebhook() { return 'recorded' }, async hasPendingNudge() { return false }, async markNudgesProcessed() {},
    async recordRunEvent(e) { events.push(e) },
  }
  const script = new Map()
  const plaid = {
    syncTransactions: vi.fn(async ({ cursor }) => { clock.t += pageMs; await hooks.onPage?.(cursor); const p = script.get(cursor ?? 'START'); if (!p) throw new Error(`no page for ${cursor}`); if (p instanceof Error) throw p; return p }),
  }
  const deps = { plaid, repo, accounts, sync, key: KEY, environment: 'production', now: () => clock.t, log: () => {} }
  return { deps, item, evidence, events, cursorWrites, script, clock, hooks, plaid }
}

/** N pages of 500 transactions spread over the three accounts. Cursors: START -> p1 -> ... -> final. */
function backfill(w, pages, prefix = 't') {
  let cursor = 'START'
  for (let i = 1; i <= pages; i++) {
    const added = Array.from({ length: 500 }, (_, j) => tx(`${prefix}${i}-${j}`, ['wf-chk', 'wf-sav', 'wf-card'][j % 3]))
    const next = i === pages ? 'final' : `p${i}`
    w.script.set(cursor, page({ added, nextCursor: next, hasMore: i < pages }))
    cursor = next
  }
}

describe('PLAID-1B large multi-account backfill', () => {
  it('40 pages (20,000 transactions, 3 accounts, one Item) cannot finish in the 8 s synchronous budget, and nothing moves', async () => {
    const w = world(); backfill(w, 40)
    await expect(syncTransactions(w.deps, OWNER, { itemId: ITEM })).rejects.toMatchObject({ code: 'sync_failed' })
    expect(w.item.sync).toMatchObject({ status: 'failed', cursor: null, lastErrorCode: 'SYNC_TIME_BUDGET' })
    expect(w.evidence.size).toBe(0); expect(w.cursorWrites).toEqual([])
    expect(recoveryFor('SYNC_TIME_BUDGET')).toBe('retry')
  })
  it('the background budget completes it in one run; the committed cursor moves exactly once, at the end', async () => {
    const w = world(); backfill(w, 40)
    const out = await syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    expect(out).toMatchObject({ state: 'synced', added: 20000, pages: 40 })
    expect(w.evidence.size).toBe(20000)
    expect(new Set([...w.evidence.values()].map(e => e.accountRef))).toEqual(new Set(['pa-0', 'pa-1', 'pa-2']))
    expect(w.cursorWrites).toEqual(['final']); expect(w.item.sync).toMatchObject({ status: 'idle', cursor: 'final' })
    const done = w.events.find(e => e.event === 'completed')
    expect(done).toMatchObject({ trigger: 'owner_background', added: 20000, pages: 40, cursorAdvanced: true, startCursorFingerprint: null, endCursorFingerprint: cursorFingerprint('final') })
    expect(JSON.stringify(w.events)).not.toContain('"final"') // cursor progress is a fingerprint, never the cursor
    expect(w.events.map(e => e.event)).toEqual(['started', 'completed'])
  })
  it('a lease shorter than the run budget is refused before anything happens', async () => {
    const w = world(); backfill(w, 1)
    await expect(syncTransactions(w.deps, OWNER, { itemId: ITEM }, { budgetMs: 60_000, leaseMs: 30_000 })).rejects.toMatchObject({ code: 'sync_failed' })
    expect(w.item.sync.status).toBe('idle'); expect(w.plaid.syncTransactions).not.toHaveBeenCalled()
  })
})

describe('PLAID-1B interruption, retries and duplicates', () => {
  it('a run interrupted while writing keeps the old cursor; the retry converges to the same evidence with no duplicates', async () => {
    const w = world({ pageMs: 10 }); backfill(w, 6)
    let calls = 0
    w.hooks.onUpsert = () => { if (++calls === 3) w.clock.t += BACKGROUND_SYNC_BUDGET_MS } // the platform clock runs out mid-write
    await expect(syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)).rejects.toMatchObject({ code: 'sync_failed' })
    expect(w.item.sync).toMatchObject({ status: 'failed', cursor: null })
    const partial = w.evidence.size
    expect(partial).toBeGreaterThan(0); expect(partial).toBeLessThan(3000)
    w.hooks.onUpsert = null
    await syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    expect(w.evidence.size).toBe(3000); expect(w.item.sync.cursor).toBe('final')
    await syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG).catch(() => {}) // replaying the same update again is harmless
    expect(w.evidence.size).toBe(3000)
    expect(w.events.filter(e => e.event === 'failed')[0]).toMatchObject({ errorCode: 'SYNC_TIME_BUDGET', errorStage: 'evidence_persistence', recovery: 'retry', cursorAdvanced: false })
  })
  it('an overlapping invocation for the same Item is refused while the first run holds its lease', async () => {
    const w = world({ pageMs: 10 }); backfill(w, 2)
    let release
    w.hooks.onPage = cursor => cursor === null ? new Promise(r => { release = r }) : undefined
    const first = syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)).rejects.toMatchObject({ code: 'conflict' })
    release()
    await expect(first).resolves.toMatchObject({ state: 'synced' })
    expect(w.cursorWrites).toEqual(['final'])
  })
  it('a run frozen after writing, whose lease expired, cannot move the cursor over the run that re-claimed the Item (superseded)', async () => {
    const w = world({ pageMs: 10 }); backfill(w, 1, 'stale')
    let release, paused = false
    w.hooks.onUpsert = () => { if (!paused) { paused = true; return new Promise(r => { release = r }) } }
    const origUpsert = w.deps.sync.upsertEvidence
    w.deps.sync.upsertEvidence = async (...a) => { await w.hooks.onUpsert?.(); w.hooks.onUpsert = null; return origUpsert(...a) }
    const stale = syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    w.clock.t += BACKGROUND_SYNC_LEASE_MS + 1000 // its lease expires while it is frozen
    w.script.set('START', page({ added: [tx('fresh-1', 'wf-chk')], nextCursor: 'fresh-cursor' }))
    await expect(syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)).resolves.toMatchObject({ state: 'synced' })
    release()
    await expect(stale).rejects.toMatchObject({ code: 'conflict' })
    expect(w.item.sync).toMatchObject({ cursor: 'fresh-cursor', status: 'idle' })
    expect(w.cursorWrites).toEqual(['fresh-cursor'])
    expect(w.events.find(e => e.event === 'superseded')).toMatchObject({ errorCode: 'SUPERSEDED', recovery: 'retry', cursorAdvanced: false })
  })
  it('a stale run that then fails cannot overwrite the newer run\'s state either', async () => {
    const w = world({ pageMs: 10 }); backfill(w, 2)
    let release
    w.hooks.onPage = cursor => cursor === null && !release ? new Promise(r => { release = r }) : undefined
    const stale = syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    w.clock.t += BACKGROUND_SYNC_LEASE_MS + 1000
    w.script.set('START', page({ added: [tx('fresh-1', 'wf-chk')], nextCursor: 'fresh-cursor' }))
    await syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    release()
    await expect(stale).rejects.toBeTruthy() // it runs out of budget
    expect(w.item.sync).toMatchObject({ cursor: 'fresh-cursor', status: 'idle', lastErrorCode: null })
  })
  it('provider failures leave the cursor unchanged and are retryable', async () => {
    const w = world(); w.script.set('START', new PlaidApiFailure('INTERNAL_SERVER_ERROR', 'API_ERROR', 500))
    await expect(syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)).rejects.toMatchObject({ code: 'plaid_unavailable' })
    expect(w.item.sync).toMatchObject({ status: 'failed', cursor: null })
    backfill(w, 1)
    await expect(syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)).resolves.toMatchObject({ state: 'synced' })
  })
})

describe('PLAID-1B modified, removed and pending-to-posted evidence', () => {
  it('modified rows update in place, removed rows are kept and marked, pending-to-posted keeps both rows and the provider link', async () => {
    const w = world({ pageMs: 10 })
    w.script.set('START', page({ added: [tx('a', 'wf-chk'), tx('b', 'wf-chk'), tx('pend-1', 'wf-card', { pending: true, amount: 40 })], nextCursor: 'c1' }))
    await syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    w.script.set('c1', page({
      modified: [tx('a', 'wf-chk', { amount: 13.75 })], removed: [{ transactionId: 'b', accountId: 'wf-chk' }, { transactionId: 'pend-1', accountId: 'wf-card' }],
      added: [tx('post-1', 'wf-card', { amount: 42.1, pendingTransactionId: 'pend-1' })], nextCursor: 'c2',
    }))
    const out = await syncTransactions(w.deps, OWNER, { itemId: ITEM }, BG)
    expect(out).toMatchObject({ added: 1, modified: 1, removed: 2, pendingLinked: 1 })
    expect(w.evidence.get('a').providerAmountMinor).toBe(1375)
    expect(w.evidence.get('b').removedAt).not.toBeNull()
    expect(w.evidence.get('pend-1')).toMatchObject({ pending: true }); expect(w.evidence.get('pend-1').removedAt).not.toBeNull()
    expect(w.evidence.get('post-1')).toMatchObject({ pending: false, pendingProviderTransactionId: 'pend-1' })
    expect(w.evidence.size).toBe(4) // nothing deleted
  })
})

describe('PLAID-1B status and recovery', () => {
  it('reports the sanitized error, recovery and last success; the long lease is used only when background sync is on', async () => {
    const w = world(); backfill(w, 40)
    await syncTransactions(w.deps, OWNER, { itemId: ITEM }).catch(() => {})
    const s = (await getSyncStatus(w.deps, OWNER)).syncs[0]
    expect(s).toMatchObject({ state: 'error', lastErrorCode: 'SYNC_TIME_BUDGET', recovery: 'retry' })
    expect(s.recoveryText).toMatch(/previous position is kept/)
    expect((await getSyncStatus(w.deps, OWNER)).backgroundSyncEnabled).toBe(false)
    expect(recoveryFor('ITEM_LOGIN_REQUIRED')).toBe('reconnect'); expect(recoveryFor('ACCOUNT_UNKNOWN')).toBe('refresh_accounts'); expect(recoveryFor('CREDENTIAL_UNREADABLE')).toBe('owner_review')
    expect(SYNC_LEASE_MS).toBeGreaterThan(SYNC_TIME_BUDGET_MS); expect(BACKGROUND_SYNC_LEASE_MS).toBeGreaterThan(15 * 60 * 1000)
  })
  it('another organization or a non-owner cannot run or read a sync for this Item', async () => {
    const w = world(); backfill(w, 1)
    await expect(syncTransactions(w.deps, { ...OWNER, organizationId: ORG_B }, { itemId: ITEM }, BG)).rejects.toMatchObject({ code: 'not_found' })
    await expect(syncTransactions(w.deps, { ...OWNER, role: 'employee' }, { itemId: ITEM }, BG)).rejects.toMatchObject({ code: 'forbidden' })
    expect((await getSyncStatus(w.deps, { ...OWNER, organizationId: ORG_B })).syncs).toEqual([])
    expect(w.plaid.syncTransactions).not.toHaveBeenCalled()
  })
})

describe('PLAID-1B endpoints', () => {
  const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'POWERON_BANK_TOKEN_ENCRYPTION_KEY', 'PLAID_BACKGROUND_SYNC_ENABLED']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    Object.assign(process.env, { PLAID_ENV: 'production', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
    delete process.env.PLAID_BACKGROUND_SYNC_ENABLED
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } vi.restoreAllMocks() })
  const profile = (role = 'owner') => ({ verifyUser: async () => ({ id: 'u1' }), plaidPort: () => ({}), syncRepo: () => ({}),
    userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: ORG, role, is_active: true } }) }) }) }) }),
    serviceClient: () => ({ from: () => ({}), rpc: async () => ({}) }) })
  const ev = (body, headers = { authorization: 'Bearer t' }) => ({ httpMethod: 'POST', headers, body: JSON.stringify(body) })

  it('the background handler is refused while switched off, before authentication or any sync', async () => {
    const sync = vi.fn()
    const res = await backgroundHandler({ ...profile(), sync })(ev({ itemId: ITEM }))
    expect(res.statusCode).toBe(403); expect(sync).not.toHaveBeenCalled()
  })
  it('when on, it keeps the owner/admin boundary: no session -> 401, non-owner -> 403, owner -> one background-budget sync', async () => {
    process.env.PLAID_BACKGROUND_SYNC_ENABLED = 'true'
    const sync = vi.fn(async () => ({ state: 'synced' }))
    expect((await backgroundHandler({ ...profile(), verifyUser: async () => null, sync })(ev({ itemId: ITEM }, {}))).statusCode).toBe(401)
    expect((await backgroundHandler({ ...profile('employee'), sync })(ev({ itemId: ITEM }))).statusCode).toBe(403)
    expect(sync).not.toHaveBeenCalled()
    const res = await backgroundHandler({ ...profile(), sync })(ev({ itemId: ITEM, organizationId: ORG_B }))
    expect(res.statusCode).toBe(200)
    expect(sync).toHaveBeenCalledTimes(1)
    const [deps, actor, input, opts] = sync.mock.calls[0]
    expect(actor.organizationId).toBe(ORG); expect(input).toEqual({ itemId: ITEM }) // a body organization is ignored
    expect(opts).toEqual({ budgetMs: BACKGROUND_SYNC_BUDGET_MS, leaseMs: BACKGROUND_SYNC_LEASE_MS, trigger: 'owner_background' })
    expect(deps.syncLeaseMs).toBe(BACKGROUND_SYNC_LEASE_MS)
  })
  it('handled failures answer 200 (no hidden platform retries) and expose no message or stack', async () => {
    process.env.PLAID_BACKGROUND_SYNC_ENABLED = 'true'
    const res = await backgroundHandler({ ...profile(), sync: vi.fn(async () => { throw new Error('secret detail') }) })(ev({ itemId: ITEM }))
    expect(res.statusCode).toBe(200); expect(res.body).not.toContain('secret'); expect(JSON.parse(res.body)).toEqual({ outcome: 'not_completed', code: 'internal' })
  })
  it('the short synchronous sync is refused while background sync is on (it would hold the long lease)', async () => {
    process.env.PLAID_BACKGROUND_SYNC_ENABLED = 'true'
    const res = await syncHandler(profile())(ev({ action: 'sync', itemId: ITEM }))
    expect(res.statusCode).toBe(409)
  })
  it('the background function is not routed: no top-level entry file exists until activation', () => {
    expect(() => readFileSync('netlify/functions/plaid-sync-background.ts')).toThrow()
  })
})

// ── The SQL draft on real PostgreSQL ────────────────────────────────────────────────────────────────────────────────────────────
let PGliteCtor = null
try { PGliteCtor = (await import('@electric-sql/pglite')).PGlite } catch { PGliteCtor = null }
const OWNER_ID = 'b0000000-0000-4000-8000-000000000001', OWNER_B_ID = 'b0000000-0000-4000-8000-000000000002'
const BOOTSTRAP = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text);
CREATE TABLE public.test_profiles(id uuid PRIMARY KEY, org uuid, role text);
CREATE FUNCTION public.user_org_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT org FROM public.test_profiles WHERE id = auth.uid() $$;
CREATE FUNCTION public.is_org_admin_for(p uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.test_profiles WHERE id = auth.uid() AND org = p AND role IN ('owner','admin')) $$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), public.user_org_id(), public.is_org_admin_for(uuid) TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
INSERT INTO public.organizations VALUES ('${ORG}','A'),('${ORG_B}','B');
INSERT INTO auth.users VALUES ('${OWNER_ID}'),('${OWNER_B_ID}');
INSERT INTO public.test_profiles VALUES ('${OWNER_ID}','${ORG}','owner'),('${OWNER_B_ID}','${ORG_B}','owner');`
const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix', '142_cash_pair_void_link_lock_fix',
  '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials']
const DRAFT = readFileSync('docs/plaid1b/sync-audit-proposal.sql', 'utf8')

describe.runIf(!!PGliteCtor)('PLAID-1B audit SQL draft (PGlite, local only)', () => {
  let db, itemRef, accountRef, txRef
  const asOwner = async (id, sql, params = []) => { await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${id}',false)`); try { return await db.query(sql, params) } finally { await db.exec(`RESET ROLE; SET ROLE service_role`) } }
  beforeAll(async () => {
    db = new PGliteCtor(); await db.exec(BOOTSTRAP)
    for (const m of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'))
    await db.exec('SET ROLE service_role')
    itemRef = (await db.query(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid','item-1','ins_127991','Wells Fargo',$2,$3)`, [ORG, `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`, OWNER_ID])).rows[0].item_id
    accountRef = (await db.query(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name) VALUES ($1,$2,'acc-1','Checking') RETURNING id`, [ORG, itemRef])).rows[0].id
    txRef = (await db.query(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date, name)
      VALUES ($1,$2,$3,'t-1',false,12.50,1250,'2026-08-01','HOME DEPOT') RETURNING id`, [ORG, itemRef, accountRef])).rows[0].id
    await db.exec('RESET ROLE'); await db.exec(DRAFT); await db.exec(DRAFT) /* re-runnable */; await db.exec('SET ROLE service_role')
  }, 120_000)
  afterAll(async () => { await db?.close?.() })
  const runRow = (event, extra = '') => db.query(`INSERT INTO public.financial_provider_sync_runs (organization_id, provider_item_ref, run_id, event, run_trigger, outcome, error_code, cursor_advanced${extra ? ', ' + extra.split('=')[0] : ''})
    VALUES ($1,$2,'c0000000-0000-4000-8000-000000000001',$3,'owner_background',$4,$5,$6${extra ? ', ' + extra.split('=')[1] : ''})`, [ORG, itemRef, event, event === 'completed' ? 'synced' : null, event === 'failed' ? 'SYNC_TIME_BUDGET' : null, event === 'completed'])

  it('existing evidence is untouched by installing the draft', async () => {
    expect((await db.query(`SELECT provider_amount_minor, name, removed_at FROM public.financial_provider_transactions WHERE id = $1`, [txRef])).rows[0]).toEqual({ provider_amount_minor: 1250, name: 'HOME DEPOT', removed_at: null })
    expect((await db.query(`SELECT count(*)::int AS n FROM public.financial_provider_transaction_revisions`)).rows[0].n).toBe(0)
  })
  it('run events are append-only and shaped: one row per event, no updates or deletes for any role, cursors only as fingerprints', async () => {
    await runRow('started'); await runRow('completed')
    await expect(runRow('completed')).rejects.toThrow() // one event of each kind per run
    await expect(db.query(`UPDATE public.financial_provider_sync_runs SET outcome = 'waiting'`)).rejects.toThrow(/append-only/)
    await expect(db.query(`DELETE FROM public.financial_provider_sync_runs`)).rejects.toThrow(/append-only/)
    await expect(db.query(`INSERT INTO public.financial_provider_sync_runs (organization_id, provider_item_ref, run_id, event, run_trigger, start_cursor_fingerprint) VALUES ($1,$2,gen_random_uuid(),'started','owner','not-a-fingerprint')`, [ORG, itemRef])).rejects.toThrow()
    await expect(db.query(`INSERT INTO public.financial_provider_sync_runs (organization_id, provider_item_ref, run_id, event, run_trigger, error_code, cursor_advanced) VALUES ($1,$2,gen_random_uuid(),'failed','owner','X',true)`, [ORG, itemRef])).rejects.toThrow()
    await expect(db.query(`INSERT INTO public.financial_provider_sync_runs (organization_id, provider_item_ref, run_id, event, run_trigger) VALUES ($1,$2,gen_random_uuid(),'started','owner')`, [ORG_B, itemRef])).rejects.toThrow() // item of another organization
  })
  it('owners read only their organization; other organizations and anon read nothing; browsers cannot write', async () => {
    expect((await asOwner(OWNER_ID, `SELECT count(*)::int AS n FROM public.financial_provider_sync_runs`)).rows[0].n).toBe(2)
    expect((await asOwner(OWNER_B_ID, `SELECT count(*)::int AS n FROM public.financial_provider_sync_runs`)).rows[0].n).toBe(0)
    await expect(asOwner(OWNER_ID, `INSERT INTO public.financial_provider_sync_runs (organization_id, provider_item_ref, run_id, event, run_trigger) VALUES ('${ORG}','${itemRef}',gen_random_uuid(),'started','owner')`)).rejects.toThrow()
    await db.exec('RESET ROLE; SET ROLE anon')
    await expect(db.query(`SELECT * FROM public.financial_provider_sync_runs`)).rejects.toThrow()
    await db.exec('RESET ROLE; SET ROLE service_role')
  })
  it('a Plaid modification, removal and restore keep the prior values; an identical re-sight records nothing', async () => {
    const upsert = (amount, minor, removed) => db.query(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, transaction_date, name, removed_at)
      VALUES ($1,$2,$3,'t-1',false,$4,$5,'2026-08-01','HOME DEPOT',${removed ? 'now()' : 'NULL'})
      ON CONFLICT (provider_item_ref, provider_transaction_id) DO UPDATE SET provider_amount = EXCLUDED.provider_amount, provider_amount_minor = EXCLUDED.provider_amount_minor, removed_at = EXCLUDED.removed_at`, [ORG, itemRef, accountRef, amount, minor])
    await upsert(12.5, 1250, false) // re-sight, unchanged
    await upsert(13.75, 1375, false) // modified
    await db.query(`UPDATE public.financial_provider_transactions SET removed_at = now() WHERE id = $1`, [txRef]) // removed
    await upsert(13.75, 1375, false) // re-sighted: restored
    const rows = (await db.query(`SELECT change_kind, prior_values FROM public.financial_provider_transaction_revisions ORDER BY changed_at, change_kind`)).rows
    expect(rows.map(r => r.change_kind).sort()).toEqual(['modified', 'removed', 'restored'])
    expect(rows.find(r => r.change_kind === 'modified').prior_values).toMatchObject({ provider_amount_minor: 1250, name: 'HOME DEPOT', removed_at: null })
    await expect(db.query(`DELETE FROM public.financial_provider_transaction_revisions`)).rejects.toThrow(/append-only/)
    expect((await asOwner(OWNER_B_ID, `SELECT count(*)::int AS n FROM public.financial_provider_transaction_revisions`)).rows[0].n).toBe(0)
    expect((await asOwner(OWNER_ID, `SELECT count(*)::int AS n FROM public.financial_provider_transaction_revisions`)).rows[0].n).toBe(3)
  })
})
