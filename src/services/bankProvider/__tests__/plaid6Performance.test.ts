// @ts-nocheck -- generated fixtures; opt-in native PostgreSQL measurements shell out to psql
/**
 * PLAID-6: performance on Netlify Free. The constraints are real: a synchronous function gets 10 seconds, Supabase statements 8 seconds, the Explorer evidence
 * window is capped at 5,000 rows and the complete report source at 50,000. These measurements use a realistic organization (12 accounts, 3 institutions, cards
 * and loans, ~8% paired movements, refunds, pending and removed rows, thousands of owner decisions) and assert BUDGETS with a wide margin for noisy CI hardware.
 * The numbers are printed so they can be reported. Nothing here needs paid infrastructure, a background function or an index.
 *
 *   part 1  pure computation (always runs)        explorer rows, reconciliation, Matches review model, impact preview, position
 *   part 2  end to end on PGlite (always runs)    the real repositories and services over real SQL (PGlite is WebAssembly: slower than PostgreSQL, so an upper bound)
 *   part 3  native PostgreSQL (opt-in)            query plans and timings of the new reads, and the pair function, at 50,000 evidence rows
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { explorerFromContext, getSpendingReport, loadExplorerContext } from '../spending/spendingService'
import { reconciliationFor } from '../spending/classifier'
import { buildMatchReview } from '../spending/matchReview'
import { buildImpact } from '../spending/reconciliationImpact'
import { buildActivity, buildPosition } from '../spending/consolidatedPosition'
import { defaultHierarchy } from '../spending/hierarchy'
import { createSpendingRepo } from '../spending/spendingRepo'
import { getMatchReview } from '../spending/matchReviewService'
import { getConsolidatedPosition } from '../spending/positionService'
import { reconciliationImpact } from '../spending/reconciliationImpact'
import { createBankAccountRepo } from '../bankAccountRepo'
import { createBankBalanceRepo } from '../bankBalanceRepo'
import { createBankConnectionRepo } from '../bankConnectionRepo'
import { interpretBalance } from '../balanceModel'
import { BOOTSTRAP, MIGRATIONS } from './helpers/pgliteHarness'
import { NOW, ORG, OWNER_ID, buildWorld } from './helpers/spendingWorld'

const owner = { organizationId: ORG, userId: OWNER_ID, role: 'owner' }
const ASOF = '2026-10-11'

// ── a realistic organization, deterministic ───────────────────────────────────────────────────────────────────────────
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const ACCOUNTS = [
  ['chk', 'depository', 'checking', 'business'], ['sav', 'depository', 'savings', 'business'], ['pchk', 'depository', 'checking', 'personal'], ['psav', 'depository', 'savings', 'personal'],
  ['oldsav', 'depository', 'savings', null], ['visa', 'credit', 'credit card', 'business'], ['chase', 'credit', 'credit card', 'business'], ['amex', 'credit', 'credit card', 'business'],
  ['pcard', 'credit', 'credit card', 'personal'], ['truck', 'loan', 'auto', null], ['cd', 'depository', 'cd', 'business'], ['mm', 'depository', 'money market', 'business'],
]
const MERCHANTS = ['HOME DEPOT #12', 'CHEVRON 123', 'GRAINGER', 'LOWES #44', 'STAPLES', 'NETFLIX', 'ADOBE', 'QUICKBOOKS ONLINE', 'STATE FARM INSURANCE', 'IRS EFTPS', 'GUSTO PAYROLL', 'SHELL OIL', 'COSTCO', 'AMAZON MKTPLACE', 'UBER EATS',
  'SOUTHWEST AIR', 'FERGUSON SUPPLY', 'CED ELECTRIC', 'PLATT ELECTRIC', 'ARCO', 'IN-N-OUT', 'STARBUCKS', 'VONS', 'WALMART', 'TARGET', 'HARBOR FREIGHT', 'SNAP ON', 'MILWAUKEE TOOL', 'DEWALT', 'FASTENAL']
export function organization(n: number, seed = 7) {
  const r = rng(seed), pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]
  const accounts = ACCOUNTS.map(([ref, type, subtype, ownership]) => ({ providerAccountRef: ref, label: `Bank · ${ref}`, mask: ref.slice(0, 4), ownership, financialAccountId: ownership ? `fa-${ref}` : null, financialAccountName: ownership ? ref : null, environment: 'production', providerType: type, providerSubtype: subtype, institution: ref.startsWith('chase') ? 'Chase' : ref.startsWith('amex') ? 'American Express' : 'Wells Fargo' }))
  const cashRefs = ['chk', 'sav', 'pchk', 'psav', 'oldsav', 'mm'], cards = ['visa', 'chase', 'amex', 'pcard']
  const txs: any[] = [], decisions: any[] = [], pairRows: any[] = []
  let k = 0, d = 0
  const date = () => { const t = Date.parse(`${ASOF}T00:00:00Z`) - Math.floor(r() * 120) * 86_400_000; return new Date(t).toISOString().slice(0, 10) }
  const plus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
  const add = (account: string, amountMinor: number, day: string, name: string, extra: any = {}) => { const t = { id: `t-${++k}`, providerAccountRef: account, date: day, name, merchantName: null, amountMinor, pending: r() < 0.03, removed: r() < 0.01, category: null, ...extra }; txs.push(t); return t }
  while (txs.length < n) {
    const x = r(), day = date(), cents = (Math.floor(r() * 400) + 5) * 100 + Math.floor(r() * 100)
    if (x < 0.06) { // transfer pair between own accounts
      const a = pick(cashRefs), b = pick(cashRefs.filter(c => c !== a)); const o = add(a, cents * 4, day, 'ONLINE TRANSFER TO SAV', { pending: false, removed: false }), i = add(b, -cents * 4, plus(day, Math.floor(r() * 3)), 'ONLINE TRANSFER FROM CHK', { pending: false, removed: false })
      if (r() < 0.3) { for (const [t, other] of [[o, i], [i, o]]) decisions.push({ id: `d-${++d}`, txId: t.id, kind: 'transfer', status: 'confirmed', category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: other.id, confidence: 'high', source: 'owner', decidedAt: '2026-09-20T00:00:00Z' })
        pairRows.push({ id: `p-${d}a`, txId: o.id, counterpartTxId: i.id, status: 'confirmed', source: 'owner', fingerprint: null, pairId: null, pairKind: null, decidedAt: '2026-09-20T00:00:00Z', undoneAt: null, undoReason: null, createdAt: '2026-09-20T00:00:00Z' }) }
    } else if (x < 0.11) { // card payment pair
      const c = pick(cards), o = add('chk', cents * 6, day, 'WELLS FARGO CARD AUTOPAY', { pending: false, removed: false }), i = add(c, -cents * 6, plus(day, Math.floor(r() * 4)), 'PAYMENT THANK YOU', { pending: false, removed: false })
      if (r() < 0.3) for (const [t, other] of [[o, i], [i, o]]) decisions.push({ id: `d-${++d}`, txId: t.id, kind: 'transfer', status: 'confirmed', category: null, projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: other.id, confidence: 'high', source: 'owner', decidedAt: '2026-09-20T00:00:00Z' })
    } else if (x < 0.20) add(pick(['chk', 'pchk']), -cents * 3, day, pick(['DEPOSIT CUSTOMER', 'ZELLE FROM JOHN', 'MOBILE DEPOSIT', 'ACH CREDIT ACME']))
    else if (x < 0.23) { const m = pick(MERCHANTS); add(pick(cards), cents, day, m); add(pick(cards), -cents, plus(day, 1 + Math.floor(r() * 20)), m.split(' ')[0] + ' RETURN') }
    else add(pick([...cashRefs.slice(0, 4), ...cards]), cents, day, pick(MERCHANTS))
  }
  for (const t of txs) if (!decisions.some(x => x.txId === t.id) && r() < 0.25) decisions.push({ id: `d-${++d}`, txId: t.id, kind: 'category', status: 'confirmed', category: pick(['materials', 'fuel_vehicle', 'tools_equipment', 'meals', 'office_admin', 'customer_payment', 'refund']), projectId: null, obligationId: null, commitmentId: null, debtAccountId: null, counterpartTxId: null, confidence: 'high', source: 'owner', decidedAt: '2026-09-21T00:00:00Z' })
  const ctx = { txs, accounts, decisions, obligations: [], occurrences: [], commitments: [], debts: [], projects: [], hierarchy: defaultHierarchy(), merchantRules: [], rulesAvailable: true, legacyCoverage: { complete: true, reason: null }, reportCoverage: { complete: true, reason: null }, reconciliation: true }
  return { ctx, pairRows, cashRefs, cards }
}
const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const time = (fn: () => unknown, reps = 3) => { const ts: number[] = []; let out: unknown; for (let k = 0; k < reps; k++) { const t = performance.now(); out = fn(); ts.push(performance.now() - t) } return { ms: Math.round(median(ts)), out } }
const RESULTS: Record<string, number | string> = {}

describe('PLAID-6 part 1: pure computation at the evidence caps', () => {
  // 50,000 is the complete report source's own cap: the largest evidence set any request here can ever hold
  for (const [n, budget] of [[5_000, 2500], [20_000, 4000], [50_000, 5000]] as const) {
    it(`${n.toLocaleString()} evidence rows, 12 accounts: explorer rows, reconciliation, Matches review, impact preview and position stay inside the budget`, () => {
      const { ctx, pairRows } = organization(n)
      const on = time(() => explorerFromContext({ ...ctx, reconciliation: true } as any, ASOF, 'all', 'production'))
      const off = time(() => explorerFromContext({ ...ctx, reconciliation: false } as any, ASOF, 'all', 'production'))
      const rows = on.out.rows.filter(r => r.account.environment === 'production')
      const accountMap = new Map(ctx.accounts.map(a => [a.providerAccountRef, a]))
      const recon = time(() => reconciliationFor(ctx.txs.filter(t => !t.removed), accountMap as any, ctx.decisions as any))
      const info = ctx.accounts.map(a => ({ ref: a.providerAccountRef, label: a.label, mask: a.mask, ownership: a.ownership, accountClass: a.providerType === 'credit' ? 'credit_card' : a.providerType === 'loan' ? 'loan' : 'bank_cash', institution: a.institution }))
      const review = time(() => buildMatchReview({ txs: ctx.txs, accounts: info, recon: recon.out, pairDecisions: pairRows, refundDecisions: [], window: { from: '2026-07-14', to: ASOF } }))
      const impact = time(() => buildImpact(off.out.rows, on.out.rows, { from: '2026-07-14', to: ASOF, environment: 'production', accounts: 'all' }), 1)
      const balances = ctx.accounts.map(a => ({ ...interpretBalance({ type: a.providerType, subtype: a.providerSubtype }, { currentMinor: 100_000, availableMinor: 90_000, limitMinor: 1_000_000, observedAt: new Date(NOW - 3_600_000).toISOString(), retrievedAt: new Date(NOW).toISOString(), observedIsProvider: true }, NOW), accountRef: a.providerAccountRef, connectionId: a.institution, institutionName: a.institution, name: a.label, mask: a.mask, type: a.providerType, subtype: a.providerSubtype, live: true, mappedFinancialAccountId: a.financialAccountId, ownership: a.ownership }))
      const position = time(() => buildPosition({ nowMs: NOW, environment: 'production', balancesEnabled: true, balances, rows, accountClassOf: new Map(), window: { from: '2026-09-12', to: ASOF, days: 30 }, coverage: { complete: true, reason: null }, syncs: [], reconciliation: true }))
      const total = on.ms + recon.ms + review.ms + position.ms
      RESULTS[`${n}: explorer rows OFF / ON`] = `${off.ms} / ${on.ms} ms`; RESULTS[`${n}: reconciliation`] = `${recon.ms} ms`; RESULTS[`${n}: matches model`] = `${review.ms} ms`; RESULTS[`${n}: impact preview`] = `${impact.ms} ms`; RESULTS[`${n}: position`] = `${position.ms} ms`
      expect(rows.length).toBeGreaterThan(n * 0.9)
      expect(position.out.activity.postedCount).toBeGreaterThan(0)
      expect(on.ms, 'explorer rows ON').toBeLessThan(budget); expect(recon.ms, 'reconciliation').toBeLessThan(budget); expect(review.ms, 'matches model').toBeLessThan(budget); expect(impact.ms, 'impact').toBeLessThan(budget * 2); expect(position.ms, 'position').toBeLessThan(budget)
      expect(total, 'position request compute').toBeLessThan(n >= 50_000 ? 7000 : budget * 1.5)
      expect(off.ms).toBeLessThan(budget)                                                                                            // the legacy path is no slower than before
    }, 120_000)
  }

  it('the engine is not quadratic: 4x the evidence costs well under 16x the time', () => {
    const small = organization(5_000, 11), big = organization(20_000, 11)
    const t = (c) => time(() => reconciliationFor(c.ctx.txs.filter(x => !x.removed), new Map(c.ctx.accounts.map(a => [a.providerAccountRef, a])) as any, c.ctx.decisions as any), 3).ms
    const a = Math.max(t(small), 5), b = t(big)
    RESULTS['scaling 5k -> 20k (reconciliation)'] = `${a} ms -> ${b} ms (x${(b / a).toFixed(1)})`
    expect(b / a).toBeLessThan(12)
  }, 120_000)

  it('a position over a window with thousands of rows allocates nothing proportional to the number of OTHER windows: 90-day vs 30-day compute is within 2x of linear', () => {
    const { ctx } = organization(10_000, 3)
    const rows = explorerFromContext({ ...ctx, reconciliation: true } as any, ASOF, 'all', 'production').rows
    const w30 = time(() => buildActivity(rows, { from: '2026-09-12', to: ASOF, days: 30 }, { complete: true, reason: null }, new Map()), 5).ms
    const w90 = time(() => buildActivity(rows, { from: '2026-07-14', to: ASOF, days: 90 }, { complete: true, reason: null }, new Map()), 5).ms
    RESULTS['activity 30d / 90d (10k rows)'] = `${w30} / ${w90} ms`
    expect(w90).toBeLessThan(Math.max(w30 * 6, 400))
  }, 60_000)
})

let PGlite: any = null, types: any = null
try { const m = await import('@electric-sql/pglite'); PGlite = m.PGlite; types = m.types } catch { PGlite = null }

describe.runIf(!!PGlite)('PLAID-6 part 2: end to end on real SQL (PGlite, an upper bound for PostgreSQL)', () => {
  let w: Awaited<ReturnType<typeof buildWorld>>
  const calls: Record<string, number> = {}
  beforeAll(async () => {
    w = await buildWorld(PGlite, types)
    // 5,000 evidence rows across the world's mapped accounts, in ONE statement (a bulk load), plus 1,500 owner decisions
    const refs = ['chk', 'sav', 'pchk', 'card', 'chase']
    const r = rng(5)
    const rows: string[] = []
    for (let k = 0; k < 5000; k++) {
      const a = w.accounts[refs[k % refs.length]], amt = (Math.floor(r() * 400) + 5) * 100 + Math.floor(r() * 100) * (r() < 0.5 ? 1 : 0), money = k % 7 === 0 ? -amt : amt
      const day = new Date(Date.parse('2026-10-10T00:00:00Z') - Math.floor(r() * 110) * 86_400_000).toISOString().slice(0, 10)
      rows.push(`('${ORG}','${a.item}','${a.ref}','bulk-${k}',false,${money / 100},${money},'USD','${day}','${MERCHANTS[k % MERCHANTS.length].replace(/'/g, '')}')`)
    }
    await w.q(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name) VALUES ${rows.join(',')}`)
    await w.q(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category, decided_by, decided_at, created_by)
      SELECT organization_id, id, 'category', 'confirmed', 'owner', 'high', (ARRAY['materials','fuel_vehicle','tools_equipment','meals','office_admin'])[1 + (row_number() OVER ())::int % 5], $1::uuid, now(), $1::uuid
        FROM public.financial_provider_transactions WHERE organization_id = $2 AND provider_amount_minor > 0 AND provider_transaction_id LIKE 'bulk-%' ORDER BY id LIMIT 1500`, [OWNER_ID, ORG])
    for (const k of ['chk', 'sav', 'pchk', 'card', 'chase']) await w.q(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, source) VALUES ($1,$2,$3,1000,100000,'plaid_accounts_get')`, [ORG, w.accounts[k].ref, new Date(NOW - 3_600_000).toISOString()])
  }, 300_000)
  afterAll(async () => { await w?.db?.close?.() })
  const sd = (over = {}) => ({ repo: createSpendingRepo(w.svc), environment: 'production', now: () => NOW, reconciliationEnabled: true, ...over })
  const measure = async (name: string, fn: () => Promise<unknown>) => { const t = performance.now(); const out = await fn(); calls[name] = Math.round(performance.now() - t); RESULTS[`pglite: ${name}`] = `${calls[name]} ms`; return out }

  it('loads the 5,000-row window and answers the position, the Matches review and the impact preview inside the 10-second function limit (even on WebAssembly PostgreSQL)', async () => {
    const posDeps = { ...sd(), accounts: createBankAccountRepo(w.svc), balances: createBankBalanceRepo(w.svc), connections: createBankConnectionRepo(w.svc), positionEnabled: true, balancesEnabled: true }
    const p = await measure('position (30d)', () => getConsolidatedPosition(posDeps, owner, { days: 30 }))
    expect(p.activity.postedCount).toBeGreaterThan(100)
    const p90 = await measure('position (90d)', () => getConsolidatedPosition(posDeps, owner, { days: 90 }))
    expect(p90.activity.postedCount).toBeGreaterThan(p.activity.postedCount)
    const m = await measure('matches review (first page)', () => getMatchReview(sd(), owner, { tab: 'review', from: '2026-07-14', to: '2026-10-11' }))
    expect(m.enabled).toBe(true); expect(m.items.length).toBeLessThanOrEqual(50)
    const im = await measure('impact preview', () => reconciliationImpact(sd({ reconciliationEnabled: false }), owner, { from: '2026-07-14', to: '2026-10-11' }))
    expect(im.summary).toBeTruthy()
    const rep = await measure('BANK-6G all-money report', () => getSpendingReport(sd(), owner, { report: 'all_money', from: '2026-07-14', to: '2026-10-11', accounts: 'all' }))
    expect(rep.coverage.complete).toBe(true)
    for (const [name, ms] of Object.entries(calls)) expect(ms, name).toBeLessThan(8_000)                                           // each well inside the 10 s limit, with the world's PGlite overhead
  }, 240_000)

  it('bounds hold: the Matches review never returns more than a page, and the explorer window never loads more than its cap', async () => {
    const page = await getMatchReview(sd(), owner, { tab: 'all', from: '2026-07-14', to: '2026-10-11', limit: 1000 })
    expect(page.items.length).toBeLessThanOrEqual(100)                                                                        // the server clamps the page size
    const ctx = await loadExplorerContext(sd(), ORG, '2026-01-01')
    expect(ctx.txs.length).toBeLessThanOrEqual(5_000)
  }, 120_000)
})

// ── part 3: native PostgreSQL, opt-in ─────────────────────────────────────────────────────────────────────────────────
const PSQL = (process.env.CASHOS_PG_PSQL ?? '').trim()
const DB = `cashos_perf_${Date.now().toString(36)}`
async function psql(db: string, sql: string, opts: { input?: string } = {}) {
  const run = promisify(execFile)
  const [cmd, ...pre] = PSQL.split(/\s+/)
  const args = [...pre, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', db, ...(opts.input !== undefined ? ['-f', '-'] : ['-c', sql])]
  return await new Promise<string>((resolve, reject) => { const child = execFile(cmd, args, { maxBuffer: 256 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(new Error(String(stderr || err.message).trim()), { stderr })) : resolve(stdout.trim()))); if (opts.input !== undefined) child.stdin!.end(opts.input) })
}
describe.runIf(!!PSQL)('PLAID-6 part 3: native PostgreSQL at 50,000 evidence rows and 20,000 decision rows', () => {
  const ORGN = '10000000-0000-4000-8000-00000000000a', OWN = 'b0000000-0000-4000-8000-000000000001'
  const plan = async (sql: string) => { const out = await psql(DB, `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`); const j = JSON.parse(out)[0]; return { ms: j['Execution Time'] as number, text: JSON.stringify(j.Plan) } }
  let accA = '', accB = ''
  beforeAll(async () => {
    const base = PSQL.split(/\s+/), run = promisify(execFile)
    await run(base[0], [...base.slice(1), '-X', '-q', '-d', 'postgres', '-c', `CREATE DATABASE ${DB}`])
    const boot = BOOTSTRAP.replace(/CREATE ROLE (\w+) ([^;]+);/g, (_m, n, rest) => `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${n}') THEN CREATE ROLE ${n} ${rest}; END IF; END $$;`)
    await psql(DB, '', { input: boot })
    for (const m of MIGRATIONS) await psql(DB, '', { input: readFileSync(`supabase/migrations/${m}.sql`, 'utf8') })
    await psql(DB, '', { input: readFileSync('docs/plaid2/match-decisions-proposal.sql', 'utf8') })
    const item = (await psql(DB, `SELECT item_id FROM public.financial_provider_connect_item('${ORGN}','plaid','perf-item','ins_1','Perf Bank','v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}','${OWN}','production')`)).split('\n')[0]
    const mk = async (id: string, name: string, sub: string) => (await psql(DB, `INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, provider_account_type, provider_account_subtype) VALUES ('${ORGN}','${item}','${id}','${name}','depository','${sub}') RETURNING id`)).split('\n')[0]
    accA = await mk('perf-a', 'Checking', 'checking'); accB = await mk('perf-b', 'Savings', 'savings')
    await psql(DB, `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
      SELECT '${ORGN}', '${item}', CASE WHEN g % 2 = 0 THEN '${accA}'::uuid ELSE '${accB}'::uuid END, 'perf-' || g, false, (g % 997 + 1) / 100.0, (g % 997 + 1), 'USD', DATE '2026-10-10' - (g % 365), 'MERCHANT ' || (g % 40) FROM generate_series(1, 50000) g`)
    await psql(DB, `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category, decided_by, decided_at, created_by)
      SELECT organization_id, id, 'category', 'confirmed', 'owner', 'high', 'materials', '${OWN}', now(), '${OWN}' FROM public.financial_provider_transactions WHERE organization_id = '${ORGN}' ORDER BY id LIMIT 20000`)
    await psql(DB, `INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, source) SELECT '${ORGN}', '${accA}', now() - (g || ' hours')::interval, 100, 10000, 'plaid_accounts_get' FROM generate_series(1, 2000) g`)
    await psql(DB, `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
      VALUES ('${ORGN}','${item}','${accA}','perf-pair-o',false,5000.00,500000,'USD',DATE '2026-10-01','ONLINE TRANSFER TO SAV'), ('${ORGN}','${item}','${accB}','perf-pair-i',false,-5000.00,-500000,'USD',DATE '2026-10-02','ONLINE TRANSFER FROM CHK')`)
    await psql(DB, 'ANALYZE')
  }, 600_000)
  afterAll(async () => { const base = PSQL.split(/\s+/); try { await promisify(execFile)(base[0], [...base.slice(1), '-X', '-q', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB}`]) } catch { /* scratch */ } })

  it('the new reads are milliseconds: the pair-decision read, the newest-balance read and the evidence window', async () => {
    const decisions = await plan(`SELECT id, provider_transaction_ref, counterpart_provider_transaction_ref, status, source, suggestion_basis, decided_at, undone_at, undo_reason, created_at FROM public.financial_provider_interpretations WHERE organization_id = '${ORGN}' AND kind = 'transfer' ORDER BY created_at, id LIMIT 1000`)
    const balance = await plan(`SELECT provider_account_ref, observed_at, current_balance FROM public.financial_provider_balance_snapshots WHERE organization_id = '${ORGN}' AND provider_account_ref = '${accA}' ORDER BY observed_at DESC LIMIT 1`)
    const window = await plan(`SELECT id, provider_account_ref, transaction_date, name, merchant_name, provider_amount_minor, pending, removed_at FROM public.financial_provider_transactions WHERE organization_id = '${ORGN}' AND transaction_date >= DATE '2026-07-14' ORDER BY transaction_date DESC, id LIMIT 1000`)
    RESULTS['pg16: pair-decision read (page of 1000)'] = `${decisions.ms.toFixed(1)} ms`; RESULTS['pg16: newest balance (2,000 snapshots)'] = `${balance.ms.toFixed(1)} ms`; RESULTS['pg16: evidence window page (50k rows)'] = `${window.ms.toFixed(1)} ms`
    for (const p of [decisions, balance, window]) expect(p.ms).toBeLessThan(250)                                                  // the statement timeout is 8,000 ms
    expect(balance.text).toMatch(/Index/)                                                                                      // the newest-snapshot read uses its index
  }, 120_000)

  it('the pair function stays fast with 20,000 decisions and 50,000 evidence rows: confirm, idempotent repeats, reverse (psql start-up included in every number)', async () => {
    const [o, i] = (await psql(DB, `SELECT (SELECT id FROM public.financial_provider_transactions WHERE provider_transaction_id = 'perf-pair-o'), (SELECT id FROM public.financial_provider_transactions WHERE provider_transaction_id = 'perf-pair-i')`)).split('|')
    const fp = await psql(DB, `SELECT 'v1|o:' || o.id || ':' || o.provider_account_ref || ':' || o.provider_amount_minor || ':' || to_char(o.transaction_date,'YYYY-MM-DD') || ':0|i:' || i.id || ':' || i.provider_account_ref || ':' || i.provider_amount_minor || ':' || to_char(i.transaction_date,'YYYY-MM-DD') || ':0' FROM public.financial_provider_transactions o, public.financial_provider_transactions i WHERE o.id = '${o}' AND i.id = '${i}'`)
    const call = async (action: string) => { const t = performance.now(); const out = await psql(DB, `SELECT outcome FROM public.financial_provider_decide_match('${ORGN}','${OWN}','${action}','${o}','${i}','internal_transfer','${fp}','{}')`); return { out, ms: performance.now() - t } }
    const times: number[] = []
    for (let k = 0; k < 6; k++) {
      const c = await call('confirm'); expect(c.out).toBe('confirmed'); times.push(c.ms)
      for (let r = 0; r < 2; r++) { const again = await call('confirm'); expect(again.out).toBe('unchanged'); times.push(again.ms) }
      const v = await call('reverse'); expect(v.out).toBe('reversed'); times.push(v.ms)
    }
    times.sort((a, b) => a - b)
    RESULTS['pg16: pair function p50 / p95 (confirm, repeat, reverse; 50k evidence, 20k decisions)'] = `${times[Math.floor(times.length * 0.5)].toFixed(0)} / ${times[Math.floor(times.length * 0.95)].toFixed(0)} ms`
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(1500)
  }, 180_000)
})

afterAll(() => { console.info('\nPLAID-6 measurements\n' + Object.entries(RESULTS).map(([k, v]) => `  ${k.padEnd(78)} ${v}`).join('\n')) })
