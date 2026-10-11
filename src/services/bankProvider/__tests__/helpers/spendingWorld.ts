// @ts-nocheck -- test helper: a tiny PostgREST over PGlite
/**
 * A realistic Cash OS organization on REAL SQL (PGlite) for service-level tests: every bank migration production carries (139-158), the BANK-6G report source,
 * the PLAID-3B pair function, a PostgREST-shaped shim (so the REAL spending repository and services run unchanged), and a multi-account fixture:
 *
 *   Wells Fargo (production Item): Business Checking, Business Savings, Personal Checking, Business Credit Card
 *   Chase       (production Item): Chase Ink Card (a second institution)
 *   all mapped to Cash OS accounts with business/personal ownership, like the owner's real setup would be.
 */
import { readFileSync } from 'node:fs'
import { BOOTSTRAP, MIGRATIONS, ORG, ORG_B, OWNER_ID, OWNER_B_ID } from './pgliteHarness'

export { ORG, ORG_B, OWNER_ID, OWNER_B_ID }
export const NOW = Date.parse('2026-10-11T12:00:00Z')
const STUB = `CREATE TABLE IF NOT EXISTS public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'in_progress');`

export function shim(db: any) {
  class Q {
    table: string; op = 'select'; cols = '*'; ret = '*'; where: Array<[string, string, any]> = []; ord: string[] = []; from = 0; to = -1; lim = 0; payload: any = null; one: '' | 'maybe' | 'single' = ''
    constructor(table: string) { this.table = table }
    select(cols = '*') { if (this.op === 'insert' || this.op === 'update') this.ret = cols; else this.cols = cols; return this }
    insert(p: any) { this.op = 'insert'; this.payload = p; return this }
    update(p: any) { this.op = 'update'; this.payload = p; return this }
    upsert(p: any) { this.op = 'insert'; this.payload = Array.isArray(p) ? p[0] : p; return this }
    eq(c: string, v: any) { this.where.push([c, '=', v]); return this }
    neq(c: string, v: any) { this.where.push([c, '<>', v]); return this }
    in(c: string, v: any[]) { this.where.push([c, 'in', v]); return this }
    gte(c: string, v: any) { this.where.push([c, '>=', v]); return this }
    lte(c: string, v: any) { this.where.push([c, '<=', v]); return this }
    order(c: string, o: any = {}) { this.ord.push(`${c} ${o.ascending === false ? 'DESC' : 'ASC'}`); return this }
    range(a: number, b: number) { this.from = a; this.to = b; return this }
    limit(n: number) { this.lim = n; return this }
    maybeSingle() { this.one = 'maybe'; return this.run() }
    single() { this.one = 'single'; return this.run() }
    then(res: any, rej: any) { return this.run().then(res, rej) }
    async run() {
      const params: any[] = []
      const ph = (v: any) => { params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v); return `$${params.length}` }
      const w = this.where.length ? ' WHERE ' + this.where.map(([c, o, v]) => o === 'in' ? `${c} = ANY(${ph(v)})` : `${c} ${o} ${ph(v)}`).join(' AND ') : ''
      let sql = ''
      if (this.op === 'insert') {
        const keys = Object.keys(this.payload)
        sql = `INSERT INTO public.${this.table} (${keys.join(',')}) VALUES (${keys.map(k => ph(this.payload[k])).join(',')}) RETURNING ${this.ret}`
      } else if (this.op === 'update') {
        const keys = Object.keys(this.payload)
        sql = `UPDATE public.${this.table} SET ${keys.map(k => `${k} = ${ph(this.payload[k])}`).join(',')}${w}${this.ret !== '*' ? ` RETURNING ${this.ret}` : ''}`
      } else {
        sql = `SELECT ${this.cols} FROM public.${this.table}${w}${this.ord.length ? ' ORDER BY ' + this.ord.join(',') : ''}${this.to >= this.from && this.to >= 0 ? ` LIMIT ${this.to - this.from + 1} OFFSET ${this.from}` : this.lim ? ` LIMIT ${this.lim}` : ''}`
      }
      try {
        const rows = (await db.query(sql, params)).rows
        if (this.op === 'update') return { data: this.ret === '*' ? null : rows, error: null }
        if (this.one) return { data: rows[0] ?? null, error: null }
        return { data: rows, error: null }
      } catch (e: any) { return { data: null, error: { code: e.code, message: String(e.message) } } }
    }
  }
  const rpc = async (fn: string, args: Record<string, any>) => {
    const keys = Object.keys(args)
    try {
      const rows = (await db.query(`SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, keys.map(k => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v }))).rows
      return { data: rows, error: null }
    } catch (e: any) { return { data: null, error: { code: e.code, message: String(e.message) } } }
  }
  return { from: (t: string) => new Q(t), rpc }
}

export interface WorldOptions { matchSql?: boolean; reportSql?: boolean }

export async function buildWorld(PGlite: any, pgTypes: any, opts: WorldOptions = {}) {
  const db = new PGlite({ parsers: { [pgTypes.DATE]: (v: string) => v, [pgTypes.TIMESTAMPTZ]: (v: string) => v, [pgTypes.INT8]: (v: string) => Number(v), [pgTypes.NUMERIC]: (v: string) => Number(v) } })
  await db.exec(BOOTSTRAP); await db.exec(STUB)
  for (const m of MIGRATIONS) await db.exec(readFileSync(`supabase/migrations/${m}.sql`, 'utf8'))
  if (opts.reportSql !== false) await db.exec(readFileSync('docs/bank6g/hierarchy-proposal.sql', 'utf8'))
  if (opts.matchSql !== false) await db.exec(readFileSync('docs/plaid2/match-decisions-proposal.sql', 'utf8'))
  await db.exec('SET ROLE service_role')
  const q = async (sql: string, p: any[] = []) => (await db.query(sql, p)).rows as any[]
  const envelope = `v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`
  const mkItem = async (org: string, providerId: string, inst: string) => (await q(`SELECT item_id FROM public.financial_provider_connect_item($1,'plaid',$2,$3,$4,$5,$6,'production')`, [org, providerId, `ins_${providerId}`, inst, envelope, org === ORG ? OWNER_ID : OWNER_B_ID]))[0].item_id
  const accounts: Record<string, { ref: string; fin: string | null; item: string }> = {}
  const mkAccount = async (org: string, item: string, key: string, name: string, type: string, subtype: string, finName: string | null, finType: string | null, ownership: 'business' | 'personal', cls: 'asset' | 'liability' = 'asset') => {
    const ref = (await q(`INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, mask, provider_account_type, provider_account_subtype) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [org, item, `${key}-${org.slice(-1)}`, name, key.slice(-4).padStart(4, '0'), type, subtype]))[0].id
    let fin: string | null = null
    if (finName && finType) {
      fin = (await q(`INSERT INTO public.financial_accounts (organization_id, display_name, account_type, account_class, ownership_context, include_in_cash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [org, finName, finType, cls, ownership, cls === 'asset']))[0].id
      await q(`INSERT INTO public.financial_provider_account_mappings (organization_id, provider_account_ref, financial_account_id, status, mapped_by) VALUES ($1,$2,$3,'active',$4)`, [org, ref, fin, org === ORG ? OWNER_ID : OWNER_B_ID])
    }
    accounts[key + (org === ORG ? '' : ':B')] = { ref, fin, item }
    return ref
  }
  const wf = await mkItem(ORG, 'wf', 'Wells Fargo'), ch = await mkItem(ORG, 'chase', 'Chase')
  await mkAccount(ORG, wf, 'chk', 'Business Checking', 'depository', 'checking', 'WF Business Checking', 'checking', 'business')
  await mkAccount(ORG, wf, 'sav', 'Business Savings', 'depository', 'savings', 'WF Business Savings', 'savings', 'business')
  await mkAccount(ORG, wf, 'pchk', 'Personal Checking', 'depository', 'checking', 'WF Personal Checking', 'checking', 'personal')
  await mkAccount(ORG, wf, 'card', 'Business Visa', 'credit', 'credit card', 'WF Business Visa', 'credit_card', 'business', 'liability')
  await mkAccount(ORG, ch, 'chase', 'Chase Ink', 'credit', 'credit card', 'Chase Ink', 'credit_card', 'business', 'liability')
  await mkAccount(ORG, wf, 'unmapped', 'Old Savings', 'depository', 'savings', null, null, 'business')
  const wfB = await mkItem(ORG_B, 'wfB', 'Wells Fargo')
  await mkAccount(ORG_B, wfB, 'chk', 'B Checking', 'depository', 'checking', 'B Checking', 'checking', 'business')
  await mkAccount(ORG_B, wfB, 'sav', 'B Savings', 'depository', 'savings', 'B Savings', 'savings', 'business')

  let n = 0
  /** one provider transaction; amounts in dollars with the provider's sign (positive = money out of a bank account / a charge on a card) */
  const tx = async (account: string, dollars: number, date: string, name: string, o: { pending?: boolean; merchant?: string | null; org?: string; pendingPid?: string | null; pid?: string } = {}) => {
    const a = accounts[account]
    return (await q(`INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, pending_provider_transaction_id, provider_amount, provider_amount_minor, currency, transaction_date, name, merchant_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11) RETURNING id`, [o.org ?? (account.endsWith(':B') ? ORG_B : ORG), a.item, a.ref, o.pid ?? `ptx-${++n}`, !!o.pending, o.pendingPid ?? null, dollars, Math.round(dollars * 100), date, name, o.merchant ?? null]))[0].id as string
  }
  const svc = shim(db)
  const evidenceHash = async () => (await q(`SELECT md5(string_agg(concat_ws('|', id, provider_account_ref, provider_amount_minor, transaction_date, pending, removed_at, name), ',' ORDER BY id)) AS h FROM public.financial_provider_transactions`))[0].h
  const untouched = async () => JSON.stringify({
    ledger: (await q(`SELECT count(*)::int n FROM public.financial_transactions`))[0].n,
    accounts: await q(`SELECT id, display_name, include_in_cash, account_type, account_class, ownership_context, status FROM public.financial_accounts ORDER BY id`),
    maps: await q(`SELECT provider_account_ref, financial_account_id, status FROM public.financial_provider_account_mappings ORDER BY id`),
    evidence: await evidenceHash(),
  })
  return { db, q, svc, tx, accounts, ids: { wf, ch, wfB }, evidenceHash, untouched }
}
