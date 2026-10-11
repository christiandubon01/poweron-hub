// @ts-nocheck -- direct SQL against PGlite
/**
 * PLAID-2C / Track C: provider-fact revision history (docs/plaid2/provider-revision-history-proposal.sql) on PostgreSQL (PGlite) with every bank
 * migration production carries, plus the PLAID-1C resumable-sync draft (for sync-run provenance). Pins: capture on real change only (idempotent),
 * prior/new/changed fields, hash chain and tamper detection, no forging by the server role, append-only, separation from owner decisions, isolation.
 */
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMIN_ID, EMPLOYEE_ID, ORG, ORG_B, OWNER_B_ID, OWNER_ID, addTx, asUser, createDb, loadPglite, makeItem, rows } from './helpers/pgliteHarness'

const PGlite = await loadPglite()

describe.runIf(!!PGlite)('PLAID-2C provider revision history (PGlite)', () => {
  let db
  beforeAll(async () => { db = await createDb(PGlite, ['docs/plaid1c/resumable-sync-proposal.sql', 'docs/plaid2/provider-revision-history-proposal.sql']) }, 120_000)
  afterAll(async () => { await db?.close?.() })

  const hist = tx => rows(db, `SELECT revision_no, change_kind, changed_fields, prior_values, new_values, sync_run_id, prev_hash, row_hash FROM public.financial_provider_transaction_history WHERE provider_transaction_ref = $1 ORDER BY revision_no`, [tx])
  const upd = (tx, set, params = []) => rows(db, `UPDATE public.financial_provider_transactions SET ${set} WHERE id = $1`, [tx, ...params])
  const verify = (org = ORG, tx = null) => rows(db, `SELECT * FROM public.financial_provider_verify_history($1,$2)`, [org, tx])
  const asOwnerSql = async (fn) => { await db.exec('RESET ROLE'); try { return await fn() } finally { await db.exec('SET ROLE service_role') } }

  it('records prior and new provider facts when Plaid changes a transaction, and nothing for a no-op update', async () => {
    const item = await makeItem(db)
    const tx = await addTx(db, item, 'card', { pending: true, pid: 'H1', amount: 40, name: 'AMZN PENDING' })
    await upd(tx, `provider_amount = 42.5, provider_amount_minor = 4250, name = 'AMZN MKTP', pending = false`)
    const [h] = await hist(tx)
    expect(h).toMatchObject({ revision_no: 1, change_kind: 'modified', prev_hash: null })
    expect(h.changed_fields).toEqual(['name', 'pending', 'provider_amount', 'provider_amount_minor'])
    expect(h.prior_values).toMatchObject({ pending: true, name: 'AMZN PENDING', provider_amount_minor: 4000 })
    expect(h.new_values).toMatchObject({ pending: false, name: 'AMZN MKTP', provider_amount_minor: 4250 })
    // a no-op re-apply (same values), an updated_at-only change and a last_seen_at touch record nothing
    await upd(tx, `name = 'AMZN MKTP', provider_amount = 42.5`)
    await upd(tx, `last_seen_at = now()`)
    expect(await hist(tx)).toHaveLength(1)
  })

  it('chains revisions, tracks removal and restoration, and the chain verifies', async () => {
    const item = await makeItem(db)
    const tx = await addTx(db, item, 'chk', { pid: 'H2', amount: 10 })
    await upd(tx, `provider_amount = 11, provider_amount_minor = 1100`)
    await upd(tx, `removed_at = now()`)
    await upd(tx, `removed_at = NULL`)
    const h = await hist(tx)
    expect(h.map(r => r.change_kind)).toEqual(['modified', 'removed', 'restored'])
    expect(h.map(r => r.revision_no)).toEqual([1, 2, 3])
    expect(h[1].prev_hash).toBe(h[0].row_hash); expect(h[2].prev_hash).toBe(h[1].row_hash)
    expect(await verify(ORG, tx)).toHaveLength(0)
    expect(h[1].changed_fields).toEqual(['removed_at'])
  })

  it('captures the raw payload and original description (immutable provider evidence), and refuses credentials in it', async () => {
    const item = await makeItem(db)
    const tx = await addTx(db, item, 'chk', { pid: 'H3' })
    await upd(tx, `raw_payload = '{"merchant_entity_id":"m1"}'::jsonb, original_description = 'ORIGINAL TEXT'`)
    const [h] = await hist(tx)
    expect(h.changed_fields).toEqual(['original_description', 'raw_payload'])
    expect(h.new_values.raw_payload).toEqual({ merchant_entity_id: 'm1' })
    await expect(upd(tx, `raw_payload = '{"access_token":"x"}'::jsonb`)).rejects.toThrow()
  })

  it('the server role cannot forge, edit, delete or truncate history', async () => {
    const item = await makeItem(db)
    const tx = await addTx(db, item, 'chk', { pid: 'H4' })
    await upd(tx, `provider_amount = 5, provider_amount_minor = 500`)
    await expect(rows(db, `INSERT INTO public.financial_provider_transaction_history (organization_id, provider_transaction_ref, revision_no, change_kind, changed_fields, prior_values, new_values, row_hash)
      VALUES ($1,$2,9,'modified',ARRAY['name'],'{}','{}',repeat('a',64))`, [ORG, tx])).rejects.toThrow(/permission denied/)
    await expect(rows(db, `UPDATE public.financial_provider_transaction_history SET change_kind = 'removed' WHERE provider_transaction_ref = $1`, [tx])).rejects.toThrow(/permission denied/)
    await expect(rows(db, `DELETE FROM public.financial_provider_transaction_history WHERE provider_transaction_ref = $1`, [tx])).rejects.toThrow(/permission denied/)
    await expect(rows(db, `TRUNCATE public.financial_provider_transaction_history`)).rejects.toThrow(/permission denied/)
    // even the table owner is stopped by the triggers (they must be dropped deliberately)
    await asOwnerSql(async () => {
      await expect(rows(db, `UPDATE public.financial_provider_transaction_history SET change_kind = 'removed' WHERE provider_transaction_ref = $1`, [tx])).rejects.toThrow(/append-only/)
      await expect(rows(db, `DELETE FROM public.financial_provider_transaction_history WHERE provider_transaction_ref = $1`, [tx])).rejects.toThrow(/append-only/)
      await expect(rows(db, `TRUNCATE public.financial_provider_transaction_history`)).rejects.toThrow(/append-only/)
    })
    expect(await hist(tx)).toHaveLength(1)
  })

  it('detects tampering made by someone who disabled the triggers: altered rows, deleted rows, reordered chain', async () => {
    const item = await makeItem(db, ORG_B)
    const a = await addTx(db, item, 'chk', { pid: 'H5a' }), b = await addTx(db, item, 'chk', { pid: 'H5b' })
    for (const tx of [a, b]) { await upd(tx, `provider_amount = 6, provider_amount_minor = 600`); await upd(tx, `provider_amount = 7, provider_amount_minor = 700`); await upd(tx, `provider_amount = 8, provider_amount_minor = 800`) }
    expect(await verify(ORG_B)).toEqual(expect.not.arrayContaining([expect.objectContaining({ provider_transaction_ref: a })]))
    await asOwnerSql(async () => {
      await db.exec('ALTER TABLE public.financial_provider_transaction_history DISABLE TRIGGER USER')
      await rows(db, `UPDATE public.financial_provider_transaction_history SET new_values = jsonb_set(new_values, '{provider_amount_minor}', '1') WHERE provider_transaction_ref = $1 AND revision_no = 2`, [a])
      await rows(db, `DELETE FROM public.financial_provider_transaction_history WHERE provider_transaction_ref = $1 AND revision_no = 2`, [b])
      await db.exec('ALTER TABLE public.financial_provider_transaction_history ENABLE TRIGGER USER')
    })
    const bad = Object.fromEntries((await verify(ORG_B)).map(r => [r.provider_transaction_ref, r]))
    expect(bad[a]).toMatchObject({ first_bad_revision: 2, problem: 'ROW_ALTERED' })
    expect(bad[b]).toMatchObject({ first_bad_revision: 3, problem: 'REVISION_GAP' })
  })

  it('keeps owner decisions out of provider history and leaves them untouched by provider changes', async () => {
    const item = await makeItem(db)
    const tx = await addTx(db, item, 'card', { pid: 'H6', amount: 30 })
    await rows(db, `SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'bucket','category','owner','high','{}'::jsonb,'materials')`, [ORG, OWNER_ID, tx])
    expect(await hist(tx)).toHaveLength(0) // a classification is not a provider fact
    await upd(tx, `provider_amount = 31, provider_amount_minor = 3100`)
    const [h] = await hist(tx)
    expect(Object.keys(h.new_values)).not.toContain('category')
    expect((await rows(db, `SELECT status, category FROM public.financial_provider_interpretations WHERE provider_transaction_ref = $1`, [tx]))[0]).toMatchObject({ status: 'confirmed', category: 'materials' })
  })

  it('organization isolation and permissions: owner/admin read their own history only; employees and anon read nothing', async () => {
    const itemA = await makeItem(db), itemB = await makeItem(db, ORG_B)
    const a = await addTx(db, itemA, 'chk', { pid: 'H7a' }), b = await addTx(db, itemB, 'chk', { pid: 'H7b' })
    await upd(a, `provider_amount = 2, provider_amount_minor = 200`); await upd(b, `provider_amount = 3, provider_amount_minor = 300`)
    const count = (user) => asUser(db, user, () => rows(db, `SELECT count(*)::int AS n, count(*) FILTER (WHERE provider_transaction_ref = $1)::int AS other FROM public.financial_provider_transaction_history`, [b])).then(r => r[0])
    expect((await count(ADMIN_ID)).other).toBe(0)
    expect((await count(ADMIN_ID)).n).toBeGreaterThan(0)
    expect((await count(EMPLOYEE_ID)).n).toBe(0)
    expect((await count(OWNER_B_ID)).other).toBe(1)
    await expect(asUser(db, ADMIN_ID, () => rows(db, `SELECT * FROM public.financial_provider_verify_history($1)`, [ORG]))).rejects.toThrow(/permission denied/)
    expect(await verify(ORG_B, a)).toHaveLength(0) // another organization sees no rows for this transaction
  })

  it('PLAID-1C apply: changes made by a sync run carry that run id; a re-applied update and unchanged rows record nothing; removals are history too', async () => {
    const item = await makeItem(db)
    const t1 = await addTx(db, item, 'chk', { pid: 'S1', amount: 10 }), t2 = await addTx(db, item, 'chk', { pid: 'S2', amount: 20 }), t3 = await addTx(db, item, 'chk', { pid: 'S3', amount: 30 })
    await rows(db, `UPDATE public.financial_provider_items SET sync_cursor = 'prev', sync_status = 'syncing', last_sync_started_at = '2026-10-11T12:00:00Z' WHERE id = $1`, [item.id])
    const run = (await rows(db, `SELECT run_id FROM public.financial_provider_sync_open_run($1,$2)`, [ORG, item.id]))[0].run_id
    const accts = Object.values(item.accounts)
    const changes = [
      { change_kind: 'modified', provider_transaction_id: 'S1', provider_account_ref: item.accounts.chk, pending: false, provider_amount: 10.5, provider_amount_minor: 1050, currency: 'USD', transaction_date: '2026-09-10', name: 'HOME DEPOT' },
      { change_kind: 'modified', provider_transaction_id: 'S2', provider_account_ref: item.accounts.chk, pending: false, provider_amount: 20, provider_amount_minor: 2000, currency: 'USD', transaction_date: '2026-09-10', name: 'HOME DEPOT' }, // identical to stored
      { change_kind: 'removed', provider_transaction_id: 'S3' }]
    expect((await rows(db, `SELECT public.financial_provider_sync_stage_page($1,$2,1,0,'final',false,'HISTORICAL_UPDATE_COMPLETE',$3::jsonb) AS r`, [ORG, run, JSON.stringify(changes)]))[0].r).toBe('staged')
    expect((await rows(db, `SELECT * FROM public.financial_provider_sync_apply_run($1,$2,$3,1,'2026-10-11T12:00:00Z','synced')`, [ORG, item.id, run]))[0]).toMatchObject({ outcome: 'applied' })
    expect((await hist(t1)).map(r => [r.change_kind, r.sync_run_id])).toEqual([['modified', run]])
    expect(await hist(t2)).toHaveLength(0)
    expect((await hist(t3)).map(r => [r.change_kind, r.sync_run_id])).toEqual([['removed', run]])
    // the setting is transaction-local: a later change outside any sync has no run id
    await upd(t1, `provider_amount = 11, provider_amount_minor = 1100`)
    expect((await hist(t1)).at(-1).sync_run_id).toBeNull()
    expect(await verify(ORG)).toHaveLength(0)
  })

  it('stays cheap at volume: updating 5,000 transactions writes 5,000 chained history rows, and the chain verifies', async () => {
    const item = await makeItem(db)
    await rows(db, `INSERT INTO public.financial_provider_transactions (organization_id, provider_item_ref, provider_account_ref, provider_transaction_id, pending, provider_amount, provider_amount_minor, currency, transaction_date, name)
      SELECT $1,$2,$3,'V' || g, false, 10, 1000, 'USD', DATE '2026-09-01', 'N' FROM generate_series(1,5000) g`, [ORG, item.id, item.accounts.chk])
    const t0 = performance.now()
    await rows(db, `UPDATE public.financial_provider_transactions SET provider_amount = 12, provider_amount_minor = 1200 WHERE provider_item_ref = $1`, [item.id])
    const ms = performance.now() - t0
    expect((await rows(db, `SELECT count(*)::int AS n FROM public.financial_provider_transaction_history h JOIN public.financial_provider_transactions t ON t.id = h.provider_transaction_ref WHERE t.provider_item_ref = $1`, [item.id]))[0].n).toBe(5000)
    await db.exec('ANALYZE')
    const v0 = performance.now(); expect(await verify(ORG)).toHaveLength(0); const vms = performance.now() - v0
    console.log('PLAID-2C history timings (ms): 5000-row update', Math.round(ms), 'verify (all org history)', Math.round(vms))
    expect(ms).toBeLessThan(30_000)
  }, 120_000)
})
