// @ts-nocheck -- real repositories over a PostgREST shim on PGlite, instrumented
/**
 * PLAID-5: security and database review, as executable checks.
 *
 *   1. QUERY-LAYER ORGANIZATION SCOPE (dynamic): every database call made by the new and changed code paths (position, Matches review and decisions, balances,
 *      connections, Explorer reads, reports, impact preview) is recorded, and EVERY one carries the caller's organization id: as an `organization_id` filter on a
 *      tenant table, a row payload that names it, or the `p_organization_id` argument of an RPC. Run for two organizations.
 *   2. ADVERSARIAL CROSS-ORGANIZATION: another organization's ids, a spoofed organization in the body or query, a forged actor, and replays.
 *   3. ROLES: owners and admins only, on every new endpoint, refused before any data is read.
 *   4. STATIC: nothing in the new code can write outside interpretation rows, read secrets, render raw HTML or reach the Plaid API; the uninstalled SQL has no
 *      destructive statement, no SECURITY DEFINER, a fixed search_path and service_role-only execution.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { applyDecision, getExplorer, getSmartReview, getSpendingReport } from '../spending/spendingService'
import { createSpendingRepo } from '../spending/spendingRepo'
import { decideMatch, getMatchReview } from '../spending/matchReviewService'
import { getConsolidatedPosition } from '../spending/positionService'
import { reconciliationImpact } from '../spending/reconciliationImpact'
import { createBankAccountRepo } from '../bankAccountRepo'
import { createBankBalanceRepo } from '../bankBalanceRepo'
import { createBankConnectionRepo } from '../bankConnectionRepo'
import { buildHandler as spendingHandler } from '../../../../netlify/functions/bank/plaid-spending'
import { buildHandler as positionHandler } from '../../../../netlify/functions/bank/plaid-position'
import { NOW, ORG, ORG_B, OWNER_B_ID, OWNER_ID, buildWorld } from './helpers/spendingWorld'

let PGlite: any = null, types: any = null
try { const m = await import('@electric-sql/pglite'); PGlite = m.PGlite; types = m.types } catch { PGlite = null }

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const ownerA = { organizationId: ORG, userId: OWNER_ID, role: 'owner' }
const ownerB = { organizationId: ORG_B, userId: OWNER_B_ID, role: 'owner' }
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
/** tables that hold one organization's data; every access to them must be scoped to that organization */
const TENANT = /^(financial_|cash_commitments)/
const ORG_COLUMNS = new Set(['organization_id', 'org_id'])

describe.runIf(!!PGlite)('PLAID-5 security review (real SQL)', () => {
  let w: Awaited<ReturnType<typeof buildWorld>>
  const T: Record<string, string> = {}
  type Rec = { kind: 'from' | 'rpc'; table?: string; fn?: string; conds: Array<[string, string, any]>; payload: any; args?: any }
  const log: Rec[] = []
  /** the service client, instrumented: every table access and every RPC is recorded with its filters / payload / arguments */
  const recorded = () => {
    const real = w.svc
    return {
      from: (table: string) => {
        const q = real.from(table)
        const rec: Rec = { kind: 'from', table, conds: [], payload: null }
        const proxy: any = new Proxy(q, {
          get(target, prop) {
            const v = target[prop]
            if (typeof v !== 'function') return v
            return (...a: any[]) => {
              const out = v.apply(target, a)
              if (prop === 'insert' || prop === 'update' || prop === 'upsert') rec.payload = a[0]
              if (['then', 'maybeSingle', 'single', 'run'].includes(String(prop))) { rec.conds = [...target.where]; log.push({ ...rec, conds: [...target.where] }) }
              return out === target ? proxy : out
            }
          },
        })
        return proxy
      },
      rpc: (fn: string, args: any) => { log.push({ kind: 'rpc', fn, conds: [], payload: null, args }); return real.rpc(fn, args) },
    }
  }
  const depsFor = (svc, over = {}) => ({
    repo: createSpendingRepo(svc), accounts: createBankAccountRepo(svc), balances: createBankBalanceRepo(svc), connections: createBankConnectionRepo(svc),
    now: () => NOW, environment: 'production', positionEnabled: true, balancesEnabled: true, reconciliationEnabled: true, ...over,
  })
  const scopedTo = (rec: Rec, org: string): boolean => {
    if (rec.kind === 'rpc') return rec.args?.p_organization_id === org
    if (rec.table === 'projects') return rec.conds.some(([c, , v]) => ORG_COLUMNS.has(c) && v === org)                       // the legacy projects table names its organization org_id
    if (!TENANT.test(rec.table!)) return true
    const filtered = rec.conds.some(([c, op, v]) => ORG_COLUMNS.has(c) && op === '=' && v === org)
    const rows = Array.isArray(rec.payload) ? rec.payload : rec.payload ? [rec.payload] : []
    return filtered || (rows.length > 0 && rows.every(r => r.organization_id === org))
  }

  beforeAll(async () => {
    w = await buildWorld(PGlite, types)
    T.aO = await w.tx('chk', 1000, '2026-10-05', 'ONLINE TRANSFER TO SAV'); T.aI = await w.tx('sav', -1000, '2026-10-05', 'ONLINE TRANSFER FROM CHK')
    T.dep = await w.tx('chk', -3000, '2026-10-06', 'DEPOSIT CUSTOMER'); T.fuel = await w.tx('chk', 61.4, '2026-10-07', 'CHEVRON 123')
    T.bO = await w.tx('chk:B', 500, '2026-10-05', 'ONLINE TRANSFER TO SAV'); T.bI = await w.tx('sav:B', -500, '2026-10-05', 'ONLINE TRANSFER FROM CHK')
    for (const [k, org] of [['chk', ORG], ['chk:B', ORG_B]]) await w.q(`INSERT INTO public.financial_provider_balance_snapshots (organization_id, provider_account_ref, observed_at, current_balance, current_balance_minor, source) VALUES ($1,$2,$3,100,10000,'plaid_accounts_get')`, [org, w.accounts[k].ref, hoursAgo(1)])
  }, 240_000)
  afterAll(async () => { await w?.db?.close?.() })

  it('1. EVERY database call of the new and changed code paths is scoped to the caller\'s organization (two organizations, every read and every decision)', async () => {
    for (const [actor, org] of [[ownerA, ORG], [ownerB, ORG_B]] as const) {
      log.length = 0
      const svc = recorded()
      const d = depsFor(svc)
      const sd = { repo: d.repo, now: d.now, environment: 'production', reconciliationEnabled: true }
      await getConsolidatedPosition(d, actor, { days: 90 })
      await getExplorer(sd, actor, { accounts: 'all', from: '2026-07-01' })
      await getSmartReview(sd, actor, { accounts: 'all', from: '2026-07-01' })
      await getSpendingReport(sd, actor, { report: 'all_money', from: '2026-07-01', to: '2026-10-11', accounts: 'all' })
      await reconciliationImpact({ ...sd, reconciliationEnabled: false }, actor, { from: '2026-07-01', to: '2026-10-11' })
      const review = await getMatchReview(sd, actor, { tab: 'all', from: '2026-07-01', to: '2026-10-11' })
      const mine = review.items.find(i => (org === ORG ? [T.aO] : [T.bO]).includes(i.outflow.id))
      expect(mine, 'a proposal exists to decide').toBeTruthy()
      const body = { outflowId: mine.outflow.id, inflowId: mine.inflow.id, fingerprint: mine.fingerprint }
      expect((await decideMatch(sd, actor, { decision: 'reject', ...body })).outcome).toBe('rejected')
      expect((await decideMatch(sd, actor, { decision: 'confirm', ...body })).outcome).toBe('confirmed')
      expect((await decideMatch(sd, actor, { decision: 'reverse', ...body })).outcome).toBe('reversed')
      await applyDecision(sd, actor, { action: 'set_bucket', transactionId: org === ORG ? T.fuel : T.bO, bucket: 'materials' }).catch(() => {})
      expect(log.length).toBeGreaterThan(30)
      const unscoped = log.filter(r => !scopedTo(r, org))
      expect(unscoped.map(r => `${r.kind}:${r.table ?? r.fn} ${JSON.stringify(r.conds.map(c => c[0]))}`), `org ${org}`).toEqual([])
      // and what they touched is only this organization's data
      for (const r of log.filter(r => r.kind === 'rpc')) expect(r.args.p_organization_id).toBe(org)
    }
  })

  it('1b. the instrument itself is not blind: a deliberately unscoped query is caught by the same predicate', async () => {
    log.length = 0
    const svc = recorded()
    await svc.from('financial_provider_transactions').select('id').limit(1)                                // no organization filter
    await svc.from('financial_provider_items').select('id').eq('provider', 'plaid').eq('organization_id', ORG_B)
    const verdicts = log.map(r => scopedTo(r, ORG))
    expect(verdicts).toEqual([false, false])                                                                 // the second is scoped to ANOTHER organization: also caught
  })

  it('2. adversarial: another organization\'s transaction ids resolve to nothing, in every direction, and change nothing', async () => {
    const sdA = { repo: createSpendingRepo(w.svc), now: () => NOW, environment: 'production', reconciliationEnabled: true }
    const before = JSON.stringify(await w.q(`SELECT organization_id, provider_transaction_ref, kind, status FROM public.financial_provider_interpretations ORDER BY id`))
    const aProposal = (await getMatchReview(sdA, ownerA, { tab: 'all', from: '2026-07-01', to: '2026-10-11' })).items.find(i => i.outflow.id === T.aO)
    // org B tries to decide / reverse org A's pair, with a perfectly valid fingerprint
    await expect(decideMatch(sdA, ownerB, { decision: 'confirm', outflowId: T.aO, inflowId: T.aI, fingerprint: aProposal.fingerprint })).rejects.toMatchObject({ httpStatus: 404 })
    await expect(decideMatch(sdA, ownerB, { decision: 'reject', outflowId: T.aO, inflowId: T.aI, fingerprint: aProposal.fingerprint })).rejects.toMatchObject({ httpStatus: 404 })
    await expect(decideMatch(sdA, ownerB, { decision: 'reverse', outflowId: T.aO, inflowId: T.aI })).rejects.toMatchObject({ httpStatus: 404 })   // GREENLIGHT-1 B-2
    // a mixed pair (one id from each organization) is refused, not half-applied
    await expect(decideMatch(sdA, ownerA, { decision: 'confirm', outflowId: T.aO, inflowId: T.bI, fingerprint: aProposal.fingerprint })).rejects.toBeTruthy()
    // org B reading org A's proposals sees only its own
    const bView = await getMatchReview(sdA, ownerB, { tab: 'all', from: '2026-07-01', to: '2026-10-11' })
    expect(bView.items.map(i => i.outflow.id)).toEqual([T.bO]); expect(JSON.stringify(bView)).not.toContain(T.aO)
    expect(JSON.stringify(await w.q(`SELECT organization_id, provider_transaction_ref, kind, status FROM public.financial_provider_interpretations ORDER BY id`))).toBe(before)
  })

  it('2b. the organization and the actor come from the authenticated profile only: a spoofed body or query is ignored by every new endpoint', async () => {
    const prof = (org: string, role = 'owner') => ({ org_id: org, role, is_active: true })
    const mk = (build, profile, over = {}) => build({ verifyUser: async () => ({ id: OWNER_ID }), userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) }), serviceClient: () => w.svc, now: () => NOW, reconciliationEnabled: () => true, positionEnabled: () => true, balancesEnabled: () => true, ...over })
    const env = process.env.PLAID_ENV; process.env.PLAID_ENV = 'production'
    try {
      // GET with a spoofed organization: the position is still the profile's organization's
      const pos = await mk(positionHandler, prof(ORG_B))({ httpMethod: 'GET', headers: { authorization: 'Bearer t' }, queryStringParameters: { organizationId: ORG, org_id: ORG, userId: OWNER_ID } })
      expect(pos.statusCode).toBe(200); expect(JSON.parse(pos.body).accounts.map(a => a.name).sort()).toEqual(['B Checking', 'B Savings']); expect(pos.body).not.toContain('Business Checking')
      // POST a decision with a spoofed organization/actor in the body: org B's profile cannot touch org A's transactions
      const post = await mk(spendingHandler, prof(ORG_B))({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ action: 'match_reverse', outflowId: T.aO, inflowId: T.aI, organizationId: ORG, organization_id: ORG, actorUserId: OWNER_ID, userId: OWNER_ID }) })
      expect(post.statusCode).toBe(404); expect(post.body).not.toContain(T.aO)   // GREENLIGHT-1 B-2: refused like confirm/reject, before the database function runs
      const get = await mk(spendingHandler, prof(ORG_B))({ httpMethod: 'GET', headers: { authorization: 'Bearer t' }, queryStringParameters: { matches: '1', tab: 'all', from: '2026-07-01', to: '2026-10-11', organizationId: ORG } })
      expect(JSON.parse(get.body).items.map(i => i.outflow.id)).toEqual([T.bO])
    } finally { if (env === undefined) delete process.env.PLAID_ENV; else process.env.PLAID_ENV = env }
  })

  it('3. roles: employees, viewers and inactive users are refused by every new endpoint before ANY data is read', async () => {
    const reads: string[] = []
    const probe = { from: (t: string) => { reads.push(t); return w.svc.from(t) }, rpc: (f: string, a: any) => { reads.push(f); return w.svc.rpc(f, a) } }
    const mk = (build, profile) => build({ verifyUser: async () => ({ id: OWNER_ID }), userClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) }), serviceClient: () => probe, now: () => NOW, reconciliationEnabled: () => true, positionEnabled: () => true, balancesEnabled: () => true })
    const calls = [
      [positionHandler, { httpMethod: 'GET', queryStringParameters: {} }],
      [spendingHandler, { httpMethod: 'GET', queryStringParameters: { matches: '1' } }],
      [spendingHandler, { httpMethod: 'GET', queryStringParameters: { impact: '1' } }],
      [spendingHandler, { httpMethod: 'POST', body: JSON.stringify({ action: 'match_confirm', outflowId: T.aO, inflowId: T.aI, fingerprint: 'v1|' + 'x'.repeat(30) }) }],
      [spendingHandler, { httpMethod: 'POST', body: JSON.stringify({ action: 'match_reverse', outflowId: T.aO, inflowId: T.aI }) }],
    ]
    for (const profile of [{ org_id: ORG, role: 'employee', is_active: true }, { org_id: ORG, role: 'viewer', is_active: true }, { org_id: ORG, role: 'owner', is_active: false }, { org_id: null, role: 'owner', is_active: true }, null]) {
      for (const [build, ev] of calls) {
        const res = await mk(build, profile)({ headers: { authorization: 'Bearer t' }, ...ev })
        expect(res.statusCode, JSON.stringify(profile) + JSON.stringify(ev).slice(0, 60)).toBe(403)
      }
    }
    expect(reads).toEqual([])
    for (const [build, ev] of calls) { const res = await build({ verifyUser: async () => null, serviceClient: () => probe })({ headers: {}, ...ev }); expect(res.statusCode).toBe(401) }
    expect(reads).toEqual([])
  })

  it('4. static: the new code writes nothing but interpretation rows (via the one reviewed function), reads no secret, calls no bank and renders no raw HTML', () => {
    const server = ['../spending/positionService.ts', '../spending/consolidatedPosition.ts', '../spending/matchReview.ts', '../spending/matchReviewService.ts', '../spending/reconciliation.ts', '../spending/reconciliationImpact.ts', ]
    for (const f of server) {
      const src = code(f)
      expect(src, f).not.toMatch(/process\.env|SUPABASE_SERVICE|service_role|access_token|decryptFor|createPlaidSdkPort|plaidPort|\.delete\(|\.upsert\(|\.insert\(|\.update\(/)
      expect(src, f).not.toMatch(/financial_transactions|include_in_cash|from\('financial_accounts'\)\.(insert|update)|payroll_runs|outlook_|materializeObligation/i)
    }
    // the endpoint reads exactly one environment variable (the Plaid environment, the same way the spending endpoint does) and no secret
    const handler = code('../../../../netlify/functions/bank/plaid-position.ts')
    expect([...handler.matchAll(/process\.env\.?\[?['"]?([A-Z_]+)/g)].map(m => m[1])).toEqual(['PLAID_ENV'])
    expect(handler).not.toMatch(/SUPABASE_SERVICE|access_token|decryptFor|createPlaidSdkPort|plaidPort|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
    // the repository's only write path for a pair is the one reviewed function
    const repo = code('../spending/spendingRepo.ts')
    expect([...repo.matchAll(/\.rpc\('([a-z_]+)'/g)].map(m => m[1]).filter(n => n.includes('match'))).toEqual(['financial_provider_decide_match'])
    // browser code: no raw HTML, no eval, no dynamic code, no storage of position figures
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
    for (const f of [...walk('src/features/cash-position'), ...walk('src/features/spending-explorer')].filter(f => /\.tsx?$/.test(f) && !/\.test\./.test(f))) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|\beval\(|new Function\(|document\.write/)
    }
    for (const f of ['src/features/cash-position/usePosition.ts', 'src/features/cash-position/CashPositionPanel.tsx', 'src/features/spending-explorer/useMatchReview.ts', 'src/features/spending-explorer/MatchReview.tsx', 'src/finance/bankPosition.ts', 'src/finance/bankMatchReview.ts']) {
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(src, f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|organization_id|organizationId|SUPABASE|supabase/)
    }
  })

  it('4b. static: no secret-looking literal in anything added by this work', () => {
    const files = ['src/finance/bankPosition.ts', 'src/finance/bankMatchReview.ts', 'src/features/cash-position/CashPositionPanel.tsx', 'src/features/cash-position/usePosition.ts', 'src/features/spending-explorer/MatchReview.tsx', 'src/features/spending-explorer/useMatchReview.ts',
      'src/services/bankProvider/spending/positionService.ts', 'src/services/bankProvider/spending/consolidatedPosition.ts', 'src/services/bankProvider/spending/matchReviewService.ts', 'src/services/bankProvider/spending/matchReview.ts', 'src/services/bankProvider/spending/reconciliation.ts',
      'netlify/functions/bank/plaid-position.ts', 'docs/plaid2/match-decisions-proposal.sql', 'docs/plaid2/ARCHITECTURE_DECISION_RECORD.md']
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/(access|public|link)-(sandbox|production|development)-[0-9a-f-]{8,}/i)                              // Plaid tokens
      expect(src, f).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/)                                                       // JWTs
      expect(src, f).not.toMatch(/(sk|pk|rk)_(live|test)_[A-Za-z0-9]{12,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/)       // vendor keys
      expect(src, f).not.toMatch(/(secret|token|password|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/=_-]{20,}['"]/i)                       // assigned literals
    }
  })

  it('5. the reviewed SQL: no destructive statement, not SECURITY DEFINER, fixed search_path, service_role-only, no new table or column', () => {
    const sql = read('../../../../docs/plaid2/match-decisions-proposal.sql').replace(/--.*$/gm, '')
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|INDEX|SCHEMA|TRIGGER|POLICY)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\b|\bCREATE\s+TABLE\b|\bCREATE\s+INDEX\b|\bGRANT\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(TABLE|public\.financial)/i)
    expect(sql).not.toMatch(/SECURITY\s+DEFINER/i); expect(sql).toMatch(/SECURITY\s+INVOKER/i); expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i)
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION[^;]+FROM\s+PUBLIC,\s*anon,\s*authenticated/i); expect(sql).toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION[^;]+TO\s+service_role/i)
    expect(sql.match(/GRANT\s+EXECUTE/gi)).toHaveLength(1)                                                                                  // one grant, to one role
    // it only writes interpretation rows and only locks evidence
    expect([...sql.matchAll(/\b(INSERT\s+INTO|UPDATE)\s+(public\.[a-z_]+)/gi)].map(m => m[2]).filter((v, i, a) => a.indexOf(v) === i)).toEqual(['public.financial_provider_interpretations'])
    expect([...sql.matchAll(/FROM\s+(public\.[a-z_]+)/gi)].map(m => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(['public.financial_provider_accounts', 'public.financial_provider_interpretations', 'public.financial_provider_transactions'])
    // every table read in it is filtered by the organization argument
    for (const m of sql.matchAll(/FROM\s+public\.[a-z_]+\s+([a-z]+)[\s\S]*?(?:;|LOOP)/gi)) expect(m[0], m[0].slice(0, 80)).toMatch(/organization_id\s*=\s*p_organization_id/)
  })

  it('6. replays are harmless: repeating any decision (or its reverse) after the fact changes nothing more, and a stale fingerprint is refused with nothing written', async () => {
    const sd = { repo: createSpendingRepo(w.svc), now: () => NOW, environment: 'production', reconciliationEnabled: true }
    const it = (await getMatchReview(sd, ownerA, { tab: 'all', from: '2026-07-01', to: '2026-10-11' })).items.find(i => i.outflow.id === T.aO)
    const body = { outflowId: T.aO, inflowId: T.aI, fingerprint: it.fingerprint }
    expect((await decideMatch(sd, ownerA, { decision: 'confirm', ...body })).outcome).toBe('confirmed')
    const rows = async () => (await w.q(`SELECT count(*)::int n FROM public.financial_provider_interpretations WHERE provider_transaction_ref = ANY($1)`, [[T.aO, T.aI]]))[0].n
    const n = await rows()
    for (let k = 0; k < 3; k++) expect((await decideMatch(sd, ownerA, { decision: 'confirm', ...body })).outcome).toBe('unchanged')
    expect(await rows()).toBe(n)
    expect((await decideMatch(sd, ownerA, { decision: 'reverse', ...body })).outcome).toBe('reversed')
    for (let k = 0; k < 3; k++) expect((await decideMatch(sd, ownerA, { decision: 'reverse', ...body })).outcome).toBe('nothing_to_reverse')
    await expect(decideMatch(sd, ownerA, { decision: 'confirm', ...body, fingerprint: body.fingerprint.replace(':0|i:', ':1|i:') })).rejects.toMatchObject({ httpStatus: 409 })
    expect(await rows()).toBe(n)
  })
})
