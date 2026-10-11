// @ts-nocheck -- shells out to a real PostgreSQL server
/**
 * PLAID-3B on a REAL PostgreSQL server with REAL concurrent connections (PGlite is single-connection and cannot race).
 *
 * Opt-in: runs only when CASHOS_PG_PSQL names a psql command that can reach a scratch server, e.g.
 *   CASHOS_PG_PSQL="psql -h /tmp/pgsock -p 54329 -U postgres"        (a throwaway cluster; the test creates and drops its own database)
 *   CASHOS_PG_PSQL="runuser -u postgres -- /usr/lib/postgresql/16/bin/psql -h /tmp/pgsock -p 54329"
 * It never connects anywhere else and never to production. Without the variable the suite is skipped (CI keeps using PGlite).
 *
 * Proves: the pair function serializes concurrent decisions on overlapping legs (row locks, id order), never leaves a half pair, never deadlocks,
 * never double-pairs a leg, and stays idempotent under parallel duplicates.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { BOOTSTRAP, MIGRATIONS } from './helpers/pgliteHarness'
import { pairFingerprint } from '../spending/reconciliation'

const run = promisify(execFile)
const PSQL = (process.env.CASHOS_PG_PSQL ?? '').trim()
const DB = `cashos_race_${Date.now().toString(36)}`
const ORG = '10000000-0000-4000-8000-00000000000a'
const OWNER = 'b0000000-0000-4000-8000-000000000001'

async function psql(db: string, sql: string, opts: { input?: string } = {}) {
  const [cmd, ...pre] = PSQL.split(/\s+/)
  const args = [...pre, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', db, ...(opts.input !== undefined ? ['-f', '-'] : ['-c', sql])]
  return await new Promise<string>((resolve, reject) => {
    const child = execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(Object.assign(new Error(String(stderr || err.message).trim()), { stderr })) : resolve(stdout.trim())))
    if (opts.input !== undefined) child.stdin!.end(opts.input)
  })
}
const call = async (action: string, o: string, i: string, fp: string | null, kind = 'internal_transfer'): Promise<string> => {
  try { return await psql(DB, `SELECT outcome || '/' || coalesce(detail, '') FROM public.financial_provider_decide_match('${ORG}','${OWNER}','${action}','${o}','${i}','${kind}',${fp ? `'${fp}'` : 'NULL'},'{}')`) }
  catch (e) { return `ERROR:${String(e.message).slice(0, 160)}` }
}
const scalar = (sql: string) => psql(DB, sql)

describe.runIf(!!PSQL)('PLAID-3B concurrency on real PostgreSQL', () => {
  let item = ''
  const accts: Record<string, string> = {}
  let seq = 0
  const mkTx = async (account: string, minor: number, date = '2026-09-10') => scalar(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
    VALUES ('${ORG}','${item}','${accts[account]}','race-${++seq}',false,${minor / 100},${minor},'USD','${date}','ONLINE TRANSFER') RETURNING id`).then(s => s.split('\n')[0])
  const fingerprint = async (o: string, i: string) => {
    const rows = (await scalar(`SELECT id, provider_account_ref, provider_amount_minor, to_char(transaction_date,'YYYY-MM-DD'), pending FROM public.financial_provider_transactions WHERE id IN ('${o}','${i}')`)).split('\n').map(l => l.split('|'))
    const by = Object.fromEntries(rows.map(r => [r[0], { id: r[0], providerAccountRef: r[1], amountMinor: Number(r[2]), date: r[3], pending: r[4] === 't' }]))
    return pairFingerprint(by[o], by[i])
  }
  const confirmedRows = (...ids: string[]) => scalar(`SELECT count(*) FROM public.financial_provider_interpretations WHERE kind = 'transfer' AND status = 'confirmed' AND provider_transaction_ref IN (${ids.map(i => `'${i}'`).join(',')})`).then(Number)
  const tally = (xs: string[]) => xs.reduce((m, x) => ({ ...m, [x.split('/')[0]]: (m[x.split('/')[0]] ?? 0) + 1 }), {} as Record<string, number>)

  beforeAll(async () => {
    const base = PSQL.split(/\s+/)
    await run(base[0], [...base.slice(1), '-X', '-q', '-d', 'postgres', '-c', `CREATE DATABASE ${DB}`])
    const consts = { ORG, ORG_B: '10000000-0000-4000-8000-00000000000b', OWNER_ID: OWNER, ADMIN_ID: 'b0000000-0000-4000-8000-000000000002', EMPLOYEE_ID: 'b0000000-0000-4000-8000-000000000003', OWNER_B_ID: 'b0000000-0000-4000-8000-000000000004' }
    // roles are cluster-wide: create them only if a previous run left them behind
    const boot = BOOTSTRAP.replace(/CREATE ROLE (\w+) ([^;]+);/g, (_m, n, rest) => `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${n}') THEN CREATE ROLE ${n} ${rest}; END IF; END $$;`)
    await psql(DB, '', { input: boot })
    for (const m of MIGRATIONS) await psql(DB, '', { input: readFileSync(`supabase/migrations/${m}.sql`, 'utf8') })
    await psql(DB, '', { input: readFileSync(process.env.CASHOS_MATCH_DRAFT ?? 'docs/plaid2/match-decisions-proposal.sql', 'utf8') }) // CASHOS_MATCH_DRAFT: mutation testing of the test itself
    void consts
    item = (await scalar(`SELECT item_id FROM public.financial_provider_connect_item('${ORG}','plaid','race-item','ins_1','Race Bank','v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}','${OWNER}','production')`)).split('\n')[0]
    for (const [name, type, sub] of [['chk', 'depository', 'checking'], ['chk2', 'depository', 'checking'], ['sav', 'depository', 'savings'], ['sav2', 'depository', 'savings'], ['sav3', 'depository', 'savings'], ['sav4', 'depository', 'savings'], ['card', 'credit', 'credit card']]) {
      accts[name] = (await scalar(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, provider_account_type, provider_account_subtype) VALUES ('${ORG}','${item}','race-${name}','${name}','${type}','${sub}') RETURNING id`)).split('\n')[0]
    }
  }, 120_000)
  afterAll(async () => {
    const base = PSQL.split(/\s+/)
    try { await run(base[0], [...base.slice(1), '-X', '-q', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB}`]) } catch { /* scratch */ }
  })

  it('eight parallel confirmations of the same pair: exactly one writes, seven see "unchanged", never more than two rows', async () => {
    const o = await mkTx('chk', 51000), i = await mkTx('sav', -51000), fp = await fingerprint(o, i)
    const out = await Promise.all(Array.from({ length: 8 }, () => call('confirm', o, i, fp)))
    expect(tally(out)).toEqual({ confirmed: 1, unchanged: 7 })
    expect(await confirmedRows(o, i)).toBe(2)
  }, 60_000)

  it('five parallel confirmations that all want the same outflow: one wins, four are told to reverse the existing pairing; the outflow is used once', async () => {
    const o = await mkTx('chk', 62000)
    const ins = []
    for (const a of ['sav', 'sav2', 'sav3', 'sav4', 'chk2']) ins.push(await mkTx(a, -62000))
    const out = await Promise.all(ins.map(async i => call('confirm', o, i, await fingerprint(o, i))))
    expect(tally(out)).toEqual({ confirmed: 1, conflict: 4 })
    expect(out.filter(x => x.startsWith('conflict')).every(x => x.endsWith('LEG_ALREADY_PAIRED'))).toBe(true)
    expect(await confirmedRows(o, ...ins)).toBe(2)
  }, 60_000)

  it('five parallel confirmations that all want the same inflow behave the same way', async () => {
    const i = await mkTx('sav', -73000)
    const outs = []
    for (const a of ['chk', 'chk2', 'sav2', 'sav3', 'sav4']) outs.push(await mkTx(a, 73000))
    const out = await Promise.all(outs.map(async o => call('confirm', o, i, await fingerprint(o, i))))
    expect(tally(out)).toEqual({ confirmed: 1, conflict: 4 })
    expect(await confirmedRows(i, ...outs)).toBe(2)
  }, 60_000)

  it('crossing pairs in opposite lock order never deadlock and never double-use a leg', async () => {
    for (let round = 0; round < 6; round++) {
      const o1 = await mkTx('chk', 84000 + round), o2 = await mkTx('chk2', 84000 + round), i1 = await mkTx('sav', -(84000 + round)), i2 = await mkTx('sav2', -(84000 + round))
      const pairs = [[o1, i1], [o1, i2], [o2, i1], [o2, i2]]
      const out = await Promise.all(pairs.map(async ([o, i]) => call('confirm', o, i, await fingerprint(o, i))))
      expect(out.some(x => x.startsWith('ERROR'))).toBe(false)           // no deadlock (40P01), no lock timeout, no stray unique violation
      const confirmed = out.filter(x => x.startsWith('confirmed')).length
      expect([1, 2]).toContain(confirmed)                                  // (o1,i1)+(o2,i2) or (o1,i2)+(o2,i1), or one of them if the other side lost the race
      expect(await confirmedRows(o1, o2, i1, i2)).toBe(confirmed * 2)      // every confirmed pair has both legs, no leg appears twice
      const dup = await scalar(`SELECT count(*) FROM (SELECT provider_transaction_ref FROM public.financial_provider_interpretations WHERE kind='transfer' AND status='confirmed' AND provider_transaction_ref IN ('${o1}','${o2}','${i1}','${i2}') GROUP BY 1 HAVING count(*) > 1) d`)
      expect(Number(dup)).toBe(0)
    }
  }, 120_000)

  it('confirm, reject and reverse storms on one pair always end in a coherent state (0 or 2 confirmed rows, never 1)', async () => {
    for (let round = 0; round < 10; round++) {
      const o = await mkTx('chk', 95000 + round), i = await mkTx('sav', -(95000 + round)), fp = await fingerprint(o, i)
      const out = await Promise.all([call('confirm', o, i, fp), call('reverse', o, i, null), call('reject', o, i, fp), call('confirm', o, i, fp), call('reverse', o, i, null), call('reject', o, i, fp)])
      expect(out.some(x => x.startsWith('ERROR')), out.join(',')).toBe(false)
      expect([0, 2]).toContain(await confirmedRows(o, i))
      const undone = Number(await scalar(`SELECT count(*) FROM public.financial_provider_interpretations WHERE status = 'undone' AND provider_transaction_ref IN ('${o}','${i}')`))
      expect(undone % 2).toBe(0) // reversals always undo both legs
      // a final confirm on a settled pair is always possible and idempotent
      const final = await call('confirm', o, i, fp)
      expect(['confirmed', 'unchanged']).toContain(final.split('/')[0])
      expect(await confirmedRows(o, i)).toBe(2)
    }
  }, 180_000)

  it('a confirmation racing the existing single-transaction decision function serializes cleanly: either the pair is refused or the later decision is recorded as history', async () => {
    for (let round = 0; round < 8; round++) {
      const o = await mkTx('chk', 106000 + round), i = await mkTx('sav', -(106000 + round)), fp = await fingerprint(o, i)
      const personal = async () => { try { await psql(DB, `SELECT * FROM public.financial_provider_replace_interpretation('${ORG}','${OWNER}','${o}','relationship','personal','owner','high','{}'::jsonb)`); return 'ok' } catch (e) { return `ERROR:${String(e.message).slice(0, 120)}` } }
      const [c, p] = await Promise.all([call('confirm', o, i, fp), personal()])
      expect(p).toBe('ok'); expect(c.startsWith('ERROR')).toBe(false)
      const active = Number(await scalar(`SELECT count(*) FROM public.financial_provider_interpretations WHERE provider_transaction_ref = '${o}' AND kind IN ('personal','transfer') AND status IN ('suggested','confirmed')`))
      expect(active).toBe(1) // one active relationship decision on the leg, whichever side won
    }
  }, 120_000)

  it('latency on a loaded table: 200 sequential confirmations next to 20,000 existing interpretation rows', async () => {
    await scalar(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
      SELECT '${ORG}','${item}','${accts.chk}','bulk-' || g,false,1,100,'USD',DATE '2026-08-01','BULK' FROM generate_series(1,20000) g`)
    await scalar(`INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category, decided_by, decided_at)
      SELECT '${ORG}', id, 'category', 'confirmed', 'owner', 'high', 'materials', '${OWNER}', now() FROM public.financial_provider_transactions WHERE provider_transaction_id LIKE 'bulk-%'`)
    await scalar('ANALYZE')
    const pairs: Array<[string, string]> = []
    for (let k = 0; k < 200; k++) pairs.push([await mkTx('chk', 117000 + k), await mkTx('sav', -(117000 + k))])
    const times: number[] = []
    for (const [o, i] of pairs) { const fp = await fingerprint(o, i); const t = performance.now(); const r = await call('confirm', o, i, fp); times.push(performance.now() - t); expect(r.startsWith('confirmed')).toBe(true) }
    times.sort((a, b) => a - b)
    const p50 = times[100], p95 = times[190]
    console.log(`PLAID-3B native PostgreSQL 16: confirm round-trip (psql process spawn included) p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, with 20,000 existing interpretation rows`)
    expect(p95).toBeLessThan(2000)
    // the in-database cost, measured server-side, excluding process start-up
    const sample = pairs[0]
    const server = await scalar(`EXPLAIN (ANALYZE, TIMING OFF, COSTS OFF) SELECT * FROM public.financial_provider_decide_match('${ORG}','${OWNER}','reverse','${sample[0]}','${sample[1]}')`)
    expect(server).toMatch(/Execution Time/)
  }, 300_000)
})
