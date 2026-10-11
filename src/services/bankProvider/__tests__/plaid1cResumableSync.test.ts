// @ts-nocheck -- the PGlite adapter mimics supabase-js; the Netlify handler under test is untyped
/**
 * PLAID-1C: resumable (Netlify Free compatible) sync, validated against the REAL SQL draft (docs/plaid1c/resumable-sync-proposal.sql) and the REAL
 * staging repository on PostgreSQL (PGlite). Plaid is scripted; nothing touches the network or production.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resumableSyncStep, MAX_RUN_RESTARTS, STEP_BUDGET_MS } from '../resumableSync'
import { createSyncStagingRepo } from '../syncStagingRepo'
import { getSyncStatus } from '../bankSyncService'
import { contextFor } from '../bankConnectionService'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'
import { PlaidApiFailure } from '../plaidPort'
import { buildHandler as syncHandler } from '../../../../netlify/functions/bank/plaid-sync'

let PGliteCtor = null
try { PGliteCtor = (await import('@electric-sql/pglite')).PGlite } catch { PGliteCtor = null }

const ORG = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const OWNER_ID = 'b0000000-0000-4000-8000-000000000001'
const OWNER = { organizationId: ORG, userId: OWNER_ID, role: 'owner' }
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const ENVELOPE = `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`
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
INSERT INTO auth.users VALUES ('${OWNER_ID}');
INSERT INTO public.test_profiles VALUES ('${OWNER_ID}','${ORG}','owner');`
const MIGRATIONS = ['139_cash_accounts_manual_ledger', '140_cash_linked_pair_lifecycle_hardening', '141_cash_transfer_conflict_target_fix', '142_cash_pair_void_link_lock_fix',
  '143_cash_dated_obligations', '146_balance_reconciliation_kind', '153_bank_provider_evidence_foundation', '154_bank_provider_credentials']

const tx = (id, accountId, over = {}) => ({ transactionId: id, accountId, amount: 12.5, currency: 'USD', date: '2026-08-01', authorizedDate: null, name: 'HOME DEPOT', merchantName: 'Home Depot', pending: false, pendingTransactionId: null, categoryPrimary: null, categoryDetailed: null, categoryConfidence: null, ...over })
const page = over => ({ added: [], modified: [], removed: [], nextCursor: 'final', hasMore: false, updateStatus: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], ...over })

describe.runIf(!!PGliteCtor)('PLAID-1C resumable sync on PostgreSQL (PGlite)', () => {
  let db
  const items = {} // org -> item id
  beforeAll(async () => {
    db = new PGliteCtor(); await db.exec(BOOTSTRAP)
    for (const m of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'))
    await db.exec(readFileSync('docs/plaid1c/resumable-sync-proposal.sql', 'utf8'))
    await db.exec(readFileSync('docs/plaid1c/resumable-sync-proposal.sql', 'utf8')) // re-runnable
    await db.exec('SET ROLE service_role')
  }, 120_000)
  afterAll(async () => { await db?.close?.() })

  /** supabase-js shaped adapter: rpc -> SELECT * FROM fn(named args); the one plain read used by getProgress. */
  const svc = {
    async rpc(fn, args) {
      const keys = Object.keys(args)
      const params = keys.map(k => (k === 'p_changes' ? JSON.stringify(args[k]) : args[k]))
      const sql = `SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}${k === 'p_changes' ? '::jsonb' : ''}`).join(', ')})`
      try { return { data: (await db.query(sql, params)).rows, error: null } } catch (e) { return { data: null, error: { code: e.code, message: e.message } } }
    },
    from(table) {
      const f = []; let cols = '*'
      const q = { select(c) { cols = c; return q }, eq(k, v) { f.push([`${k} = $${f.length + 1}`, v]); return q }, in(k, vs) { f.push([`${k} = ANY($${f.length + 1})`, vs]); return q },
        async maybeSingle() { try { const r = await db.query(`SELECT ${cols} FROM public.${table} WHERE ${f.map(x => x[0]).join(' AND ')}`, f.map(x => x[1])); return { data: r.rows[0] ?? null, error: null } } catch (e) { return { data: null, error: { code: e.code, message: e.message } } } } }
      return q
    },
  }

  /** A fresh Item (organization `org`) with three provider accounts, the real staging repo, a lease repo mirroring bankSyncRepo, scripted Plaid. */
  async function world(org = ORG, { pageMs = 1500 } = {}) {
    const providerItemId = `item-${randomBytes(4).toString('hex')}`
    const itemId = (await db.query(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid',$2,'ins_127991','Wells Fargo',$3,$4)`, [org, providerItemId, ENVELOPE, OWNER_ID])).rows[0].item_id
    items[org] = itemId
    const accountIds = {}
    for (const a of ['wf-chk', 'wf-sav', 'wf-card']) accountIds[a] = (await db.query(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name) VALUES ($1,$2,$3,$3) RETURNING id`, [org, itemId, a])).rows[0].id
    const clock = { t: Date.parse('2026-10-11T12:00:00Z') }
    const iso = () => new Date(clock.t).toISOString()
    const repo = {
      async getItem(o, id) { return o === org && id === itemId ? { id, provider: 'plaid', providerItemId, status: 'healthy', environment: 'production' } : null },
      async getActiveCredential(o, id) { return o === org && id === itemId ? encryptProviderToken('access-production-x', KEY, contextFor({ organizationId: org }, 'plaid', providerItemId)) : null },
      async listItems(o) { return o === org ? [{ id: itemId, provider: 'plaid', status: 'healthy', environment: 'production', institutionName: 'Wells Fargo', connectedAt: null, disconnectedAt: null, lastSuccessfulSyncAt: null }] : [] },
    }
    const row = async () => (await db.query(`SELECT sync_status, sync_cursor, last_sync_started_at, last_successful_sync_at, last_error_code, status FROM public.financial_provider_items WHERE id = $1`, [itemId])).rows[0]
    const sync = { // the same compare-and-set and fencing as bankSyncRepo, as SQL
      async getSyncState(o, id) { const r = await row(); return { status: r.sync_status, cursor: r.sync_cursor, startedAt: r.last_sync_started_at?.toISOString?.() ?? null, completedAt: null, lastSuccessfulAt: r.last_successful_sync_at, lastErrorCode: r.last_error_code } },
      async claimSync(o, id, staleIso, startedAt) { return (await db.query(`UPDATE public.financial_provider_items SET sync_status='syncing', last_sync_started_at=$3 WHERE id=$1 AND organization_id=$2 AND status<>'disconnected' AND (sync_status<>'syncing' OR last_sync_started_at < $4) RETURNING id`, [id, o, startedAt, staleIso])).rows.length === 1 },
      async finishSync(o, id, { cursor, state, startedAt }) { return (await db.query(`UPDATE public.financial_provider_items SET sync_status='idle', sync_cursor=$3, last_successful_sync_at=CASE WHEN $4='synced' THEN now() ELSE last_successful_sync_at END WHERE id=$1 AND organization_id=$2 AND sync_status='syncing' AND last_sync_started_at=$5 RETURNING id`, [id, o, cursor, state, startedAt])).rows.length },
      async failSync(o, id, code, startedAt) { return (await db.query(`UPDATE public.financial_provider_items SET sync_status='failed', last_error_code=$3 WHERE id=$1 AND organization_id=$2 AND sync_status='syncing' AND last_sync_started_at=$4 RETURNING id`, [id, o, code, startedAt])).rows.length },
      async releaseSync(o, id, startedAt) { return (await db.query(`UPDATE public.financial_provider_items SET sync_status='idle' WHERE id=$1 AND organization_id=$2 AND sync_status='syncing' AND last_sync_started_at=$3 RETURNING id`, [id, o, startedAt])).rows.length },
      async markLoginRequired() {}, async markNudgesProcessed() {}, async countEvidence() { return { posted: 0, pending: 0, removed: 0 } }, async hasPendingNudge() { return false },
    }
    const accounts = { async listProviderAccounts(o, id) { return (await db.query(`SELECT id, provider_account_id FROM public.financial_provider_accounts WHERE organization_id=$1 AND provider_item_ref=$2`, [o, id])).rows.map(r => ({ id: r.id, providerAccountId: r.provider_account_id })) } }
    const script = new Map(), calls = []
    const faults = [] // { cursor, error } consumed in order
    const plaid = { syncTransactions: vi.fn(async ({ cursor }) => {
      clock.t += pageMs; calls.push(cursor ?? 'START')
      const fi = faults.findIndex(f => f.cursor === (cursor ?? 'START'))
      if (fi >= 0) throw faults.splice(fi, 1)[0].error
      const p = script.get(cursor ?? 'START'); if (!p) throw new Error(`no page for ${cursor}`); return p
    }) }
    const deps = { plaid, repo, accounts, sync, staging: createSyncStagingRepo(svc), key: KEY, environment: 'production', now: () => clock.t, log: () => {}, resumableSyncEnabled: true }
    const evidence = async () => (await db.query(`SELECT provider_transaction_id AS id, provider_amount_minor::int AS minor, pending, pending_provider_transaction_id AS link, removed_at FROM public.financial_provider_transactions WHERE provider_item_ref = $1 ORDER BY 1`, [itemId])).rows
    const runs = async () => (await db.query(`SELECT status, generation, pages_staged, restarts, abandon_reason, (SELECT count(*)::int FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = r.id) AS staged FROM public.financial_provider_sync_staging_runs r WHERE provider_item_ref = $1 ORDER BY created_at`, [itemId])).rows
    const owner = { ...OWNER, organizationId: org }
    const step = () => resumableSyncStep(deps, owner, { itemId })
    const drive = async (max = 100) => { const out = []; for (let i = 0; i < max; i++) { const r = await step(); out.push(r); if (!r.more) break; clock.t += 1000 } return out }
    return { itemId, accountIds, deps, clock, script, faults, calls, plaid, row, evidence, runs, step, drive, owner }
  }
  /** `pages` pages of `per` added rows spread over three accounts. Cursors START -> p1 -> ... -> final. */
  const backfill = (w, pages, per = 500, prefix = 't') => {
    let cursor = 'START'
    for (let i = 1; i <= pages; i++) {
      const next = i === pages ? 'final' : `p${i}`
      w.script.set(cursor, page({ added: Array.from({ length: per }, (_, j) => tx(`${prefix}${i}-${j}`, ['wf-chk', 'wf-sav', 'wf-card'][j % 3])), nextCursor: next, hasMore: i < pages }))
      cursor = next
    }
  }

  it('a 24-page, 12,000-transaction, three-account backfill completes across many short requests; nothing is visible until the single final apply', async () => {
    const w = await world(); backfill(w, 24)
    const results = []
    for (let i = 0; i < 100; i++) {
      const r = await w.step(); results.push(r)
      if (r.more) { // between requests: no partial visibility, committed cursor untouched
        expect(await w.evidence()).toHaveLength(0)
        expect((await w.row()).sync_cursor).toBeNull()
        w.clock.t += 1000
      } else break
    }
    expect(results.length).toBeGreaterThan(5)
    expect(results.every(r => r.more ? ['fetching', 'ready_to_apply'].includes(r.phase) : r.phase === 'complete')).toBe(true)
    const last = results.at(-1)
    expect(last).toMatchObject({ phase: 'complete', state: 'synced', added: 12000, pagesStaged: 24 })
    expect(await w.evidence()).toHaveLength(12000)
    expect(new Set((await db.query(`SELECT provider_account_ref FROM public.financial_provider_transactions WHERE provider_item_ref=$1`, [w.itemId])).rows.map(r => r.provider_account_ref)).size).toBe(3)
    expect(await w.row()).toMatchObject({ sync_cursor: 'final', sync_status: 'idle' })
    expect(await w.runs()).toEqual([expect.objectContaining({ status: 'applied', staged: 0 })]) // staging cleared after apply
  }, 120_000)

  it('an interrupted request (crash, timeout, closed browser) resumes from the staged page cursor, not from the start', async () => {
    const w = await world(undefined, { pageMs: 100 }); backfill(w, 6, 50)
    w.faults.push({ cursor: 'p3', error: new Error('socket hang up') })
    await expect(w.step()).rejects.toBeTruthy()
    expect(await w.runs()).toEqual([expect.objectContaining({ status: 'fetching', pages_staged: 3, generation: 1 })])
    expect(await w.evidence()).toHaveLength(0)
    w.calls.length = 0
    const out = await w.drive()
    expect(w.calls[0]).toBe('p3') // resumed at the checkpoint
    expect(out.at(-1)).toMatchObject({ phase: 'complete', added: 300 })
    expect(await w.evidence()).toHaveLength(300)
  })

  it('a mutation during pagination in a LATER request restarts the whole update from its START cursor; nothing from the earlier generation is applied', async () => {
    const w = await world(); backfill(w, 8, 10, 'old') // ~3 pages per request at 1.5 s each, so the run spans several requests
    const first = await w.step() // stages pages in this request
    expect(first.more || first.phase === 'complete').toBe(true)
    if (first.phase === 'complete') throw new Error('test needs more pages per request')
    // Plaid data changes; the next page fetch reports a mutation. Plaid's consistent answer from START is now different:
    w.faults.push({ cursor: (await db.query(`SELECT page_cursor FROM public.financial_provider_sync_staging_runs WHERE provider_item_ref=$1 AND status='fetching'`, [w.itemId])).rows[0]?.page_cursor ?? 'START', error: new PlaidApiFailure('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', 'TRANSACTIONS_ERROR', 400) })
    w.script.set('START', page({ added: [tx('new-1', 'wf-chk', { amount: 99 }), tx('new-2', 'wf-sav')], nextCursor: 'g2-final', hasMore: false }))
    w.calls.length = 0
    const out = await w.drive()
    expect(w.calls).toContain('START') // restarted from the update's start cursor
    expect(out.at(-1)).toMatchObject({ phase: 'complete', restarts: 1, added: 2 })
    expect((await w.evidence()).map(e => e.id)).toEqual(['new-1', 'new-2']) // generation-1 rows (old*) never applied
    expect(await w.row()).toMatchObject({ sync_cursor: 'g2-final' })
  })

  it('repeated mutations abandon the run safely: no evidence, cursor unchanged, and the next press starts over cleanly', async () => {
    const w = await world(undefined, { pageMs: 100 }); backfill(w, 2, 5)
    for (let i = 0; i <= MAX_RUN_RESTARTS; i++) w.faults.push({ cursor: 'START', error: new PlaidApiFailure('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION', 'TRANSACTIONS_ERROR', 400) })
    await expect(w.drive()).rejects.toMatchObject({ code: 'conflict' })
    expect(await w.evidence()).toHaveLength(0)
    expect(await w.row()).toMatchObject({ sync_cursor: null, last_error_code: 'SYNC_CONFLICT' })
    expect((await w.runs())[0]).toMatchObject({ status: 'abandoned', abandon_reason: 'SYNC_CONFLICT', staged: 0 })
    expect((await w.drive()).at(-1)).toMatchObject({ phase: 'complete', added: 10 })
  })

  it('duplicate and overlapping requests: a second request is refused while one holds the lease; a stale page write changes nothing', async () => {
    const w = await world(undefined, { pageMs: 100 }); backfill(w, 3, 5)
    let release
    w.plaid.syncTransactions.mockImplementationOnce(() => new Promise(r => { release = () => r(w.script.get('START')) }))
    const a = w.step()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await expect(w.step()).rejects.toMatchObject({ code: 'conflict' })
    release(); await a
    const run = (await db.query(`SELECT id, generation, pages_staged FROM public.financial_provider_sync_staging_runs WHERE provider_item_ref=$1 AND status IN ('fetching','fetched')`, [w.itemId])).rows[0]
    if (run) {
      const stale = await w.deps.staging.stagePage(ORG, { runId: run.id, generation: run.generation, pageNo: 0, nextCursor: 'evil', hasMore: false, updateStatus: null, changes: [] })
      expect(stale).toBe('stale')
      expect(await w.deps.staging.stagePage(ORG, { runId: run.id, generation: run.generation + 7, pageNo: run.pages_staged, nextCursor: 'evil', hasMore: false, updateStatus: null, changes: [] })).toBe('stale')
    }
    w.script.set('final', page({ added: [], nextCursor: 'final', hasMore: false })) // a repeated press: Plaid has nothing new
    const out = await w.drive()
    expect(out.at(-1)).toMatchObject({ phase: 'complete' })
    expect(await w.evidence()).toHaveLength(15) // no duplicates
    expect(await w.row()).toMatchObject({ sync_cursor: 'final' })
  })

  it('lease fencing: an apply without the current lease, or after the committed cursor moved elsewhere, changes nothing', async () => {
    const w = await world(undefined, { pageMs: 100 }); backfill(w, 1, 5)
    const r = await w.deps.staging.openRun(ORG, w.itemId)
    expect(await w.deps.staging.stagePage(ORG, { runId: r.runId, generation: 1, pageNo: 0, nextCursor: 'final', hasMore: false, updateStatus: 'HISTORICAL_UPDATE_COMPLETE',
      changes: [{ change_kind: 'added', provider_transaction_id: 'x1', provider_account_ref: w.accountIds['wf-chk'], pending: false, provider_amount: 1.25, provider_amount_minor: 125, currency: 'USD', transaction_date: '2026-08-01' }] })).toBe('staged')
    // nobody holds the lease
    expect((await w.deps.staging.applyRun(ORG, { itemId: w.itemId, runId: r.runId, generation: 1, leaseStartedAt: new Date().toISOString(), outcome: 'synced' })).outcome).toBe('lease_lost')
    await db.query(`UPDATE public.financial_provider_items SET sync_status='syncing', last_sync_started_at='2026-10-11T12:00:00Z' WHERE id=$1`, [w.itemId])
    expect((await w.deps.staging.applyRun(ORG, { itemId: w.itemId, runId: r.runId, generation: 1, leaseStartedAt: '2026-10-11T11:59:00Z', outcome: 'synced' })).outcome).toBe('lease_lost')
    // the committed cursor moved by another path (e.g. the older single-request sync): the staged update can never be applied
    await db.query(`UPDATE public.financial_provider_items SET sync_cursor='moved-elsewhere' WHERE id=$1`, [w.itemId])
    expect((await w.deps.staging.applyRun(ORG, { itemId: w.itemId, runId: r.runId, generation: 1, leaseStartedAt: '2026-10-11T12:00:00Z', outcome: 'synced' })).outcome).toBe('stale')
    expect(await w.evidence()).toHaveLength(0)
    expect((await w.runs())[0]).toMatchObject({ status: 'abandoned', abandon_reason: 'CURSOR_MOVED', staged: 0 })
    expect((await w.row()).sync_cursor).toBe('moved-elsewhere')
  })

  it('modified, removed and pending-to-posted changes spread over several pages apply in provider order; rows and decisions are preserved', async () => {
    const w = await world(undefined, { pageMs: 100 })
    w.script.set('START', page({ added: [tx('a', 'wf-chk'), tx('b', 'wf-chk')], nextCursor: 'c1' }))
    await w.drive()
    const aId = (await db.query(`SELECT id FROM public.financial_provider_transactions WHERE provider_transaction_id='a' AND provider_item_ref=$1`, [w.itemId])).rows[0].id
    await db.query(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, category, decided_by, decided_at) VALUES ($1,$2,'category','confirmed','owner','materials',$3,now())`, [ORG, aId, OWNER_ID])
    w.script.set('c1', page({ added: [tx('pend', 'wf-card', { pending: true, amount: 40 }), tx('tmp', 'wf-sav')], nextCursor: 'c2', hasMore: true }))
    w.script.set('c2', page({ modified: [tx('a', 'wf-chk', { amount: 13.75 })], removed: [{ transactionId: 'pend', accountId: 'wf-card' }, { transactionId: 'tmp', accountId: 'wf-sav' }],
      added: [tx('post', 'wf-card', { amount: 42.1, pendingTransactionId: 'pend' })], nextCursor: 'c3', hasMore: true }))
    w.script.set('c3', page({ removed: [{ transactionId: 'b', accountId: 'wf-chk' }], nextCursor: 'c4' }))
    const out = (await w.drive()).at(-1)
    expect(out).toMatchObject({ phase: 'complete', added: 3, modified: 1, removed: 3, pendingLinked: 1 })
    const ev = Object.fromEntries((await w.evidence()).map(e => [e.id, e]))
    expect(ev.a).toMatchObject({ minor: 1375, removed_at: null })
    expect(ev.b.removed_at).not.toBeNull(); expect(ev.tmp.removed_at).not.toBeNull() // added then removed in the same update: kept, marked
    expect(ev.pend).toMatchObject({ pending: true }); expect(ev.pend.removed_at).not.toBeNull()
    expect(ev.post).toMatchObject({ pending: false, link: 'pend', removed_at: null })
    expect(Object.keys(ev)).toHaveLength(5) // nothing deleted
    expect((await db.query(`SELECT id FROM public.financial_provider_transactions WHERE provider_transaction_id='a' AND provider_item_ref=$1`, [w.itemId])).rows[0].id).toBe(aId)
    expect((await db.query(`SELECT count(*)::int AS n FROM public.financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='confirmed'`, [aId])).rows[0].n).toBe(1)
  })

  it('unknown accounts fail closed without staging that page; status reports an unfinished run without any cursor', async () => {
    const w = await world(undefined, { pageMs: 100 })
    w.script.set('START', page({ added: [tx('ok', 'wf-chk')], nextCursor: 'c1', hasMore: true }))
    w.script.set('c1', page({ added: [tx('mystery', 'wf-new-card')], nextCursor: 'c2' }))
    await expect(w.drive()).rejects.toMatchObject({ code: 'sync_failed' })
    expect(await w.runs()).toEqual([expect.objectContaining({ status: 'fetching', pages_staged: 1 })])
    expect(await w.evidence()).toHaveLength(0)
    expect((await w.row()).last_error_code).toBe('ACCOUNT_UNKNOWN')
    await db.query(`UPDATE public.financial_provider_items SET sync_status='idle', last_error_code=NULL WHERE id=$1`, [w.itemId])
    const status = await getSyncStatus(w.deps, OWNER)
    const s = status.syncs.find(x => x.connectionId === w.itemId)
    expect(s).toMatchObject({ state: 'partial', progress: expect.objectContaining({ phase: 'fetching', pagesStaged: 1 }) })
    expect(JSON.stringify(status)).not.toMatch(/"c1"|START|cursor":"/)
  })

  it('organization isolation: another organization cannot open, stage or apply runs of this Item, nor reference its accounts', async () => {
    const w = await world()
    await expect(w.deps.staging.openRun(ORG_B, w.itemId)).rejects.toThrow()
    const r = await w.deps.staging.openRun(ORG, w.itemId)
    await expect(w.deps.staging.stagePage(ORG_B, { runId: r.runId, generation: 1, pageNo: 0, nextCursor: 'x', hasMore: false, updateStatus: null, changes: [] })).rejects.toThrow()
    await expect(w.deps.staging.applyRun(ORG_B, { itemId: w.itemId, runId: r.runId, generation: 1, leaseStartedAt: new Date().toISOString(), outcome: 'synced' })).rejects.toThrow()
    const other = await world(ORG_B)
    await expect(w.deps.staging.stagePage(ORG, { runId: r.runId, generation: 1, pageNo: 0, nextCursor: 'x', hasMore: false, updateStatus: null,
      changes: [{ change_kind: 'added', provider_transaction_id: 'z', provider_account_ref: other.accountIds['wf-chk'], pending: false, provider_amount: 1, provider_amount_minor: 100, currency: 'USD', transaction_date: '2026-08-01' }] })).rejects.toThrow()
    await expect(resumableSyncStep(w.deps, { ...OWNER, organizationId: ORG_B }, { itemId: w.itemId })).rejects.toMatchObject({ code: 'not_found' })
    await expect(resumableSyncStep(w.deps, { ...OWNER, role: 'employee' }, { itemId: w.itemId })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(resumableSyncStep({ ...w.deps, resumableSyncEnabled: false }, OWNER, { itemId: w.itemId })).rejects.toMatchObject({ code: 'feature_disabled' })
  })

  it('PLAID-1E run-size limit: an update larger than the limit blocks the run for owner review; staged rows are kept and nothing is retried', async () => {
    const w = await world(undefined, { pageMs: 100 }); backfill(w, 4, 5)
    w.deps.maxStagedRows = 12 // lowers the 50,000-row ceiling for the test; the SQL never lets a caller raise it
    await expect(w.step()).rejects.toMatchObject({ code: 'sync_failed' })
    const run = async () => (await db.query(`SELECT status, blocked_reason, pages_staged, staged_rows, (SELECT count(*)::int FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = r.id) AS staged FROM public.financial_provider_sync_staging_runs r WHERE provider_item_ref = $1`, [w.itemId])).rows
    expect(await run()).toEqual([{ status: 'blocked', blocked_reason: 'RUN_TOO_LARGE', pages_staged: 2, staged_rows: 10, staged: 10 }])
    expect(await w.evidence()).toHaveLength(0)
    expect(await w.row()).toMatchObject({ sync_cursor: null, last_error_code: 'RUN_TOO_LARGE' })
    const calls = w.plaid.syncTransactions.mock.calls.length
    await expect(w.step()).rejects.toMatchObject({ code: 'sync_failed' }) // the next press asks for owner review without calling Plaid
    expect(w.plaid.syncTransactions.mock.calls.length).toBe(calls)
    const s = (await getSyncStatus(w.deps, OWNER)).syncs.find(x => x.connectionId === w.itemId)
    expect(s).toMatchObject({ state: 'error', recovery: 'owner_review' })
  })

  it('PLAID-1E repeated final-apply failures stop after three attempts with an owner-review status; staged rows, evidence and cursor are preserved', async () => {
    const w = await world(undefined, { pageMs: 100 })
    w.script.set('START', page({ added: [tx('ok-1', 'wf-chk'), tx('poison-1e', 'wf-sav')], nextCursor: 'final' }))
    await db.exec(`RESET ROLE;
      CREATE FUNCTION public.test_poison() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.provider_transaction_id = 'poison-1e' THEN RAISE EXCEPTION 'deterministic failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_poison BEFORE INSERT ON public.financial_provider_transactions FOR EACH ROW EXECUTE FUNCTION public.test_poison();
      SET ROLE service_role`)
    try {
      for (const n of [1, 2]) {
        await expect(w.step()).rejects.toMatchObject({ code: 'persistence_failed' }) // retryable: counted, run still applicable
        expect((await w.row()).last_error_code).toBe('APPLY_RUN_FAILED')
        expect((await db.query(`SELECT status, apply_failures FROM public.financial_provider_sync_staging_runs WHERE provider_item_ref=$1`, [w.itemId])).rows[0]).toEqual({ status: 'fetched', apply_failures: n })
      }
      await expect(w.step()).rejects.toMatchObject({ code: 'sync_failed' }) // third failure: blocked
      const calls = w.plaid.syncTransactions.mock.calls.length
      await expect(w.step()).rejects.toMatchObject({ code: 'sync_failed' }) // no automatic retry
      expect(w.plaid.syncTransactions.mock.calls.length).toBe(calls)
      expect((await db.query(`SELECT status, blocked_reason, apply_failures, (SELECT count(*)::int FROM public.financial_provider_sync_staged_changes s WHERE s.run_id = r.id) AS staged FROM public.financial_provider_sync_staging_runs r WHERE provider_item_ref=$1`, [w.itemId])).rows)
        .toEqual([{ status: 'blocked', blocked_reason: 'APPLY_FAILED_REPEATEDLY', apply_failures: 3, staged: 2 }])
      expect(await w.evidence()).toHaveLength(0)
      expect(await w.row()).toMatchObject({ sync_cursor: null, last_error_code: 'APPLY_BLOCKED' })
      expect((await getSyncStatus(w.deps, OWNER)).syncs.find(x => x.connectionId === w.itemId)).toMatchObject({ state: 'error', recovery: 'owner_review' })
    } finally { await db.exec('RESET ROLE; DROP TRIGGER test_poison ON public.financial_provider_transactions; DROP FUNCTION public.test_poison(); SET ROLE service_role') }
    // Owner review resolved it: only an explicit abandon releases the run; the next press starts cleanly.
    const runId = (await db.query(`SELECT id FROM public.financial_provider_sync_staging_runs WHERE provider_item_ref=$1`, [w.itemId])).rows[0].id
    await w.deps.staging.abandonRun(ORG, runId, 'OWNER_REVIEWED')
    expect((await w.drive()).at(-1)).toMatchObject({ phase: 'complete', added: 2 })
  })

  it('browsers have no access to staging data or functions', async () => {
    await db.exec(`RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${OWNER_ID}',false)`)
    try {
      await expect(db.query(`SELECT * FROM public.financial_provider_sync_staging_runs`)).rejects.toThrow()
      await expect(db.query(`SELECT * FROM public.financial_provider_sync_staged_changes`)).rejects.toThrow()
      await expect(db.query(`SELECT * FROM public.financial_provider_sync_open_run('${ORG}', '${items[ORG]}')`)).rejects.toThrow()
    } finally { await db.exec('RESET ROLE; SET ROLE service_role') }
  })

  it('staged rows must satisfy the evidence rules, so the final apply can never fail on a bad row', async () => {
    const w = await world()
    const r = await w.deps.staging.openRun(ORG, w.itemId)
    const bad = { change_kind: 'added', provider_transaction_id: 'bad', provider_account_ref: w.accountIds['wf-chk'], pending: false, provider_amount: 1.255, provider_amount_minor: 126, currency: 'USD', transaction_date: '2026-08-01' }
    await expect(w.deps.staging.stagePage(ORG, { runId: r.runId, generation: 1, pageNo: 0, nextCursor: 'x', hasMore: false, updateStatus: null, changes: [bad] })).rejects.toThrow()
    expect((await w.runs())[0]).toMatchObject({ pages_staged: 0, staged: 0 }) // atomic: nothing staged, page not advanced
    expect(STEP_BUDGET_MS).toBeLessThan(10_000)
  })
})

describe('PLAID-1C endpoint switch', () => {
  const ENV = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'POWERON_BANK_TOKEN_ENCRYPTION_KEY', 'PLAID_RESUMABLE_SYNC_ENABLED', 'PLAID_BACKGROUND_SYNC_ENABLED']
  let saved
  beforeEach(() => {
    saved = Object.fromEntries(ENV.map(k => [k, process.env[k]]))
    Object.assign(process.env, { PLAID_ENV: 'production', PLAID_CLIENT_ID: 'c', PLAID_SECRET: 's', POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
    delete process.env.PLAID_RESUMABLE_SYNC_ENABLED; delete process.env.PLAID_BACKGROUND_SYNC_ENABLED
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } vi.restoreAllMocks() })
  const profile = (role = 'owner') => ({ verifyUser: async () => ({ id: 'u1' }), plaidPort: () => ({}), syncRepo: () => ({}), stagingRepo: () => ({}),
    connectionRepo: () => ({ getItem: async () => null }),
    userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { org_id: ORG, role, is_active: true } }) }) }) }) }),
    serviceClient: () => ({ from: () => ({}), rpc: async () => ({}) }) })
  const ev = body => ({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) })
  it('sync_step is refused while switched off; non-owners are refused first', async () => {
    let res = await syncHandler(profile())(ev({ action: 'sync_step', itemId: '30000000-0000-4000-8000-000000000001' }))
    expect(res.statusCode).toBe(403); expect(JSON.parse(res.body).code).toBe('feature_disabled')
    res = await syncHandler(profile('employee'))(ev({ action: 'sync_step', itemId: '30000000-0000-4000-8000-000000000001' }))
    expect(res.statusCode).toBe(403)
  })
  it('when on, the single-request sync is retired so only one sync path can move the cursor', async () => {
    process.env.PLAID_RESUMABLE_SYNC_ENABLED = 'true'
    const res = await syncHandler(profile())(ev({ action: 'sync', itemId: '30000000-0000-4000-8000-000000000001' }))
    expect(res.statusCode).toBe(409)
  })
})
