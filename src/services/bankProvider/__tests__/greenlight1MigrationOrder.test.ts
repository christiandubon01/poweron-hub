// @ts-nocheck -- shells out to a scratch PostgreSQL server
/**
 * GREENLIGHT-1: the install ORDER of every prepared (uninstalled) SQL proposal, proven on a real PostgreSQL 16 server.
 *
 * Opt-in (CASHOS_PG_PSQL, see plaid3bNativePgConcurrency.test.ts). It creates and drops its own scratch databases and never connects anywhere else.
 * Starting point = what production has today: migrations 139-147 and 153-158 (157/158 objects present; their missing history entries are a known, accepted
 * discrepancy that this test does not model or touch) plus the BANK-6G hierarchy SQL (owner-confirmed installed). Then, in the runbook order:
 *   plaid1c (resumable sync) -> plaid2c (provider history) -> plaid2a (pending/posted continuity) -> plaid3b (match decisions)
 * After EVERY step: the runbook's post-install checks pass, and the evidence fingerprint (runbook section 1) is unchanged - installing SQL changes no data.
 * The preflight, fingerprint and post-install checks are read out of docs/plaid2/PRODUCTION_RUNBOOK.md and run VERBATIM, so a check that is wrong in the
 * document (two were: to_regproc with an ambiguous or argument-carrying name always answers NULL) fails here instead of in front of the owner.
 * Also proves plaid3b depends only on 153-156 (it installs alone).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { BOOTSTRAP, MIGRATIONS } from './helpers/pgliteHarness'

const PSQL = (process.env.CASHOS_PG_PSQL ?? '').trim()
const run = promisify(execFile)
const ORG = '10000000-0000-4000-8000-00000000000a', OWNER = 'b0000000-0000-4000-8000-000000000001'
async function psql(db: string, sql: string, input?: string) {
  const [cmd, ...pre] = PSQL.split(/\s+/)
  const args = [...pre, '-X', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-d', db, ...(input !== undefined ? ['-f', '-'] : ['-c', sql])]
  return await new Promise<string>((resolve, reject) => { const c = execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve(out.trim()))); if (input !== undefined) c.stdin!.end(input) })
}
const file = (p: string) => readFileSync(p, 'utf8')
const PROPOSALS = { plaid1c: 'docs/plaid1c/resumable-sync-proposal.sql', plaid2c: 'docs/plaid2/provider-revision-history-proposal.sql', plaid2a: 'docs/plaid2/pending-posted-continuity-proposal.sql', plaid3b: 'docs/plaid2/match-decisions-proposal.sql', lockdown: 'docs/plaid2/interpretation-write-lockdown-proposal.sql' }
const RUNBOOK = file('docs/plaid2/PRODUCTION_RUNBOOK.md')
/** The n-th sql block after a runbook heading, VERBATIM: exactly what the owner will paste. */
const runbook = (heading: string, n = 0) => {
  const at = RUNBOOK.indexOf(heading)
  const block = at < 0 ? undefined : RUNBOOK.slice(at).split('```sql')[n + 1]
  if (block === undefined) throw new Error(`runbook: no sql block ${n} after "${heading}"`)
  return block.split('```')[0]
}
/** One statement of a runbook block (with the comments above it), chosen by text it contains. */
const statement = (sql: string, marker: string) => {
  const s = sql.split(/;[^\S\n]*(?:--[^\n]*)?\n/).find(x => x.includes(marker))
  if (!s) throw new Error(`runbook: no statement containing "${marker}"`)
  return `${s};`
}
const sorted = (out: string) => out.split('\n').filter(Boolean).sort().join('\n')

describe.runIf(!!PSQL)('GREENLIGHT-1 SQL install order on PostgreSQL 16 (scratch)', () => {
  const dbs: string[] = []
  const fresh = async (name: string) => {
    const base = PSQL.split(/\s+/)
    const db = `g1_${name}_${Date.now().toString(36)}`
    await run(base[0], [...base.slice(1), '-X', '-q', '-d', 'postgres', '-c', `CREATE DATABASE ${db}`]); dbs.push(db)
    await psql(db, '', BOOTSTRAP.replace(/CREATE ROLE (\w+) ([^;]+);/g, (_m, n, rest) => `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${n}') THEN CREATE ROLE ${n} ${rest}; END IF; END $$;`))
    for (const m of MIGRATIONS) await psql(db, '', file(`supabase/migrations/${m}.sql`))
    return db
  }
  /** a little real-looking data, so "nothing changed" is a meaningful statement */
  const seed = async (db: string) => {
    const item = (await psql(db, `SELECT item_id FROM public.financial_provider_connect_item('${ORG}','plaid','g1-item','ins_wf','Wells Fargo','v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}','${OWNER}','production')`)).split('\n')[0]
    const acct = (await psql(db, `INSERT INTO public.financial_provider_accounts (organization_id, provider_item_ref, provider_account_id, name, provider_account_type, provider_account_subtype) VALUES ('${ORG}','${item}','g1-a','Checking','depository','checking') RETURNING id`)).split('\n')[0]
    await psql(db, `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
      SELECT '${ORG}','${item}','${acct}','g1-' || g, g % 9 = 0, (g % 97 + 1) / 100.0, g % 97 + 1, 'USD', DATE '2026-10-01' - g, 'MERCHANT ' || g FROM generate_series(1, 200) g`)
    await psql(db, `INSERT INTO public.financial_provider_interpretations (organization_id, provider_transaction_ref, kind, status, source, confidence, category, decided_by, decided_at, created_by)
      SELECT organization_id, id, 'category', 'confirmed', 'owner', 'high', 'materials', '${OWNER}', now(), '${OWNER}' FROM public.financial_provider_transactions WHERE NOT pending ORDER BY id LIMIT 50`)
  }
  /** runbook section 1 (evidence fingerprint), verbatim */
  const state = async (db: string) => await psql(db, '', runbook('## 1. Evidence fingerprint'))
  afterAll(async () => { const base = PSQL.split(/\s+/); for (const db of dbs) { try { await run(base[0], [...base.slice(1), '-X', '-q', '-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${db}`]) } catch { /* scratch */ } } })

  it('production today + BANK-6G, then plaid1c -> plaid2c -> plaid2a -> plaid3b -> B-1 lockdown: every install applies cleanly, passes its runbook checks, and changes no data', async () => {
    const db = await fresh('order')
    // the legacy projects table exists in production (the BANK-6G SQL references it); the same stub the PGlite world uses
    await psql(db, `CREATE TABLE IF NOT EXISTS public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'in_progress')`)
    await psql(db, '', file('docs/bank6g/hierarchy-proposal.sql'))                                               // owner-confirmed installed in production
    await seed(db)
    const before = await state(db)
    expect(before.split('\n')).toHaveLength(2)                                                                   // both fingerprint lines
    expect(before).toMatch(/^200\|0\|[0-9a-f]{32}\n50\|50\|0\|1\|/)

    // runbook 2 (preflight), verbatim. 2.3 reads Supabase's own migration-history table, which exists only in production.
    const pre = runbook('## 2. Preflight')
    expect(await psql(db, '', statement(pre, '-- 2.1'))).toBe('t|t|t|t|t|t|t')
    expect(await psql(db, `SELECT to_regproc('public.financial_provider_connect_item') IS NULL`)).toBe('t')            // why the old bare-name 2.1 line was wrong
    expect(await psql(db, '', statement(pre, '-- 2.2'))).toBe('f|f|f|f')
    expect(await psql(db, '', statement(pre, '-- 2.4'))).toBe('')
    expect(sorted(await psql(db, '', statement(pre, '-- 2.5')))).toBe('anon\nauthenticated\nservice_role')

    await psql(db, '', file(PROPOSALS.plaid1c))
    // runbook 3 post-install validation, verbatim
    const v3 = runbook('## 3. INSTALL')
    expect(sorted(await psql(db, '', statement(v3, 'relrowsecurity')))).toBe('financial_provider_sync_staged_changes|t\nfinancial_provider_sync_staging_runs|t')
    expect(await psql(db, '', statement(v3, 'count(*)'))).toBe('0')
    const grants3 = sorted(await psql(db, '', statement(v3, 'role_table_grants'))).split('\n')
    expect(grants3.filter(l => /^(anon|authenticated)\|/.test(l))).toEqual([])                                     // no browser role may hold any table privilege
    expect(grants3.filter(l => l.startsWith('service_role|')).map(l => l.split('|')[1])).toEqual(['financial_provider_sync_staged_changes', 'financial_provider_sync_staging_runs'])
    // corrected: the old filter (LIKE '%run%' OR stage_page) saw only five of the six functions
    expect(sorted(await psql(db, '', statement(v3, 'has_function_privilege')))).toBe(['abandon_run', 'apply_run', 'open_run', 'record_apply_failure', 'restart_run', 'stage_page'].map(n => `financial_provider_sync_${n}|f|f|t`).join('\n'))
    expect(await psql(db, `SELECT count(*) FROM pg_proc WHERE proname LIKE 'financial_provider_sync_%run%' OR proname = 'financial_provider_sync_stage_page'`)).toBe('5')
    expect(await psql(db, `SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND has_function_privilege('service_role', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname LIKE 'financial_provider_sync_%'`)).toBe('t')
    expect(await state(db)).toBe(before)

    await psql(db, '', file(PROPOSALS.plaid2c))
    // runbook 5 post-install validation, verbatim
    const v5 = runbook('## 5. INSTALL')
    expect(sorted(await psql(db, '', statement(v5, 'tgname')))).toBe('trg_fpt_81_history|O\ntrg_fpth_00_append_only|O\ntrg_fpth_01_no_truncate|O')
    expect(await psql(db, '', statement(v5, 'can_insert'))).toBe('f|t')
    expect(await psql(db, '', statement(v5, 'count(*)'))).toBe('0')
    expect(await state(db)).toBe(before)

    await psql(db, '', file(PROPOSALS.plaid2a))
    // runbook 4 post-install validation, verbatim
    const v4 = runbook('## 4. INSTALL')
    expect(await psql(db, '', statement(v4, 'relrowsecurity'))).toBe('t')
    expect(await psql(db, '', statement(v4, 'auth_can'))).toBe('f|t')
    expect(await psql(db, '', statement(v4, 'count(*)'))).toBe('0')
    expect(await state(db)).toBe(before)

    // runbook 9.2 preflight, verbatim (corrected: to_regproc with an argument list always answered NULL)
    const p92 = runbook('### 9.2')
    expect(await psql(db, '', p92)).toBe('f\nt')
    expect(await psql(db, `SELECT to_regproc('public.financial_provider_json_is_safe(jsonb)') IS NULL`)).toBe('t')   // why the old 9.2 lines were wrong
    await psql(db, '', file(PROPOSALS.plaid3b))
    expect(await psql(db, '', p92)).toBe('t\nt')                                                                    // the "already there" check now sees it
    // runbook 9.2 post-install validation, verbatim
    expect(await psql(db, '', runbook('### 9.2', 1))).toBe('f|f|f|t|{search_path=public}')
    expect(await psql(db, `SELECT outcome FROM public.financial_provider_decide_match('${ORG}','${OWNER}','probe')`)).toBe('available')       // the capability probe touches nothing
    expect(await state(db)).toBe(before)
    // GREENLIGHT-1 B-1 lockdown (independent; recommended before plaid3b is used): browser roles keep SELECT only, nothing else changes
    await psql(db, '', file(PROPOSALS.lockdown))
    expect(await psql(db, `SELECT has_table_privilege('authenticated','public.financial_provider_interpretations','SELECT') || ',' || has_table_privilege('authenticated','public.financial_provider_interpretations','INSERT') || ',' || has_table_privilege('authenticated','public.financial_provider_interpretations','UPDATE') || ',' || has_table_privilege('service_role','public.financial_provider_interpretations','INSERT')`)).toBe('true,false,false,true')
    expect(await psql(db, `SELECT count(*) FROM pg_policies WHERE tablename = 'financial_provider_interpretations' AND cmd IN ('INSERT','UPDATE')`)).toBe('0')
    expect(await state(db)).toBe(before)
    // the history trigger (2c) records evidence revisions made AFTER install, and none were made by the installs themselves
    expect(await psql(db, `SELECT count(*) FROM public.financial_provider_transaction_history`)).toBe('0')
  }, 300_000)

  it('plaid3b depends only on 153-156: it installs alone (no 1c/2a/2c, no BANK-6G) and works', async () => {
    const db = await fresh('p3b_alone')
    await seed(db)
    const before = await state(db)
    await psql(db, '', file(PROPOSALS.plaid3b))
    expect(await psql(db, `SELECT outcome FROM public.financial_provider_decide_match('${ORG}','${OWNER}','probe')`)).toBe('available')
    expect(await state(db)).toBe(before)
  }, 300_000)

  it('every proposal is ONE transaction: a failure inside it leaves nothing behind (re-running after a failed attempt is safe)', async () => {
    const db = await fresh('atomic')
    for (const [name, p] of Object.entries(PROPOSALS)) {
      const text = file(p)
      expect(text, name).toMatch(/^\s*BEGIN;/m); expect(text, name).toMatch(/^\s*COMMIT;\s*$/m)
      // inject a failure just before COMMIT: nothing of the proposal may survive
      await expect(psql(db, '', text.replace(/^\s*COMMIT;\s*$/m, `SELECT 1/0;\nCOMMIT;`))).rejects.toThrow()
    }
    expect(await psql(db, `SELECT (to_regclass('public.financial_provider_sync_staging_runs') IS NULL)::int + (to_regclass('public.financial_provider_pending_posted_links') IS NULL)::int + (to_regclass('public.financial_provider_transaction_history') IS NULL)::int + (to_regproc('public.financial_provider_decide_match') IS NULL)::int`)).toBe('4')
  }, 300_000)
})
