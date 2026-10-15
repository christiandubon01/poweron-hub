// @ts-nocheck -- direct SQL against PGlite validates the reviewed proposal without touching production.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ORG, OWNER_ID, createDb, loadPglite, makeItem, rows } from './helpers/pgliteHarness'

const PGlite = await loadPglite()
const DRAFT = 'docs/plaid730/history-recovery-proposal.sql'
const FOUR_ACCOUNTS = ['business', 'personal-a', 'personal-b', 'card']
let recoverySequence = 0

describe.runIf(!!PGlite)('PLAID-730 recovery database contract (PGlite)', () => {
  let db: any
  beforeAll(async () => { db = await createDb(PGlite, [DRAFT]) }, 120_000)
  afterAll(async () => { await db?.close?.() })

  async function setupRecovery(accountNames = FOUR_ACCOUNTS, oldestDate = '2026-01-01') {
    const sequence = ++recoverySequence
    const source = await makeItem(db, ORG, accountNames)
    const financialAccountIds: string[] = []
    for (const name of accountNames) {
      const financialAccountId = (await rows(db, `INSERT INTO public.financial_accounts(organization_id,display_name,account_type,account_class,ownership_context,include_in_cash)
        VALUES($1,$2,'checking','asset','business',true) RETURNING id`, [ORG, `Recovery ${sequence} ${name}`]))[0].id
      financialAccountIds.push(financialAccountId)
      await db.query(`INSERT INTO public.financial_provider_account_mappings(organization_id,provider_account_ref,financial_account_id,mapped_by)
        VALUES($1,$2,$3,$4)`, [ORG, source.accounts[name], financialAccountId, OWNER_ID])
    }
    await db.query(`UPDATE public.financial_provider_items SET sync_cursor=$2,last_successful_sync_at=now() WHERE id=$1`, [source.id, `source-cursor-${sequence}`])
    const recovery = (await rows(db, `SELECT public.financial_provider_history_recovery_start($1,$2,$3,'production',730) j`, [ORG, source.id, OWNER_ID]))[0].j
    const replacement = (await rows(db, `SELECT item_id FROM public.financial_provider_history_recovery_connect_item(
      $1,$2,$3,'ins_127991','Wells Fargo','v1:AAAAAAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCCCCCC',$4,'production')`,
      [ORG, recovery.id, `item-replacement-${sequence}`, OWNER_ID]))[0].item_id
    const replacementAccounts: Record<string, string> = {}
    for (const name of accountNames) {
      const oldAccount = (await rows(db, `SELECT provider_account_id,name,official_name,mask,provider_account_type,provider_account_subtype
        FROM public.financial_provider_accounts WHERE id=$1`, [source.accounts[name]]))[0]
      replacementAccounts[name] = (await rows(db, `INSERT INTO public.financial_provider_accounts(
        organization_id,provider_item_ref,provider_account_id,name,official_name,mask,provider_account_type,provider_account_subtype)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [ORG, replacement, oldAccount.provider_account_id, oldAccount.name, oldAccount.official_name, oldAccount.mask, oldAccount.provider_account_type, oldAccount.provider_account_subtype]))[0].id
    }
    await db.query(`SELECT public.financial_provider_history_recovery_prepare_accounts($1,$2)`, [ORG, recovery.id])
    const oldTransactions: string[] = []
    const newTransactions: string[] = []
    for (const [index, name] of accountNames.entries()) {
      const date = Array.isArray(oldestDate) ? oldestDate[index] : oldestDate
      oldTransactions.push((await rows(db, `INSERT INTO public.financial_provider_transactions(
        organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,authorized_date,name,merchant_name)
        VALUES($1,$2,$3,$4,false,$5,$6,'USD',$7,$7,$8,$8) RETURNING id`,
        [ORG, source.id, source.accounts[name], `old-${sequence}-${index}`, 10 + index, (10 + index) * 100, date, `RECOVERY ${index}`]))[0].id)
      newTransactions.push((await rows(db, `INSERT INTO public.financial_provider_transactions(
        organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,authorized_date,name,merchant_name)
        VALUES($1,$2,$3,$4,false,$5,$6,'USD',$7,$7,$8,$8) RETURNING id`,
        [ORG, replacement, replacementAccounts[name], `new-${sequence}-${index}`, 10 + index, (10 + index) * 100, date, `RECOVERY ${index}`]))[0].id)
    }
    await db.query(`UPDATE public.financial_provider_items SET sync_cursor=$2,last_successful_sync_at=now() WHERE id=$1`, [replacement, `replacement-cursor-${sequence}`])
    return { sequence, source, replacement, replacementAccounts, financialAccountIds, recovery, oldTransactions, newTransactions }
  }

  it('requires four January-1-covered accounts and activates without removing either Item or losing owner classifications', async () => {
    const world = await setupRecovery()
    await db.query(`SELECT * FROM public.financial_provider_replace_interpretation($1,$2,$3,'bucket','category','owner','high','{}'::jsonb,'utilities')`,
      [ORG, OWNER_ID, world.oldTransactions[0]])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    const ready = (await rows(db, `SELECT public.financial_provider_history_recovery_get($1,$2) j`, [ORG, world.recovery.id]))[0].j
    expect(ready).toMatchObject({ state: 'ready', requiredCoverageStart: '2026-01-01', expectedAccountCount: 4 })
    expect(ready.accounts).toHaveLength(4)
    expect(ready.accounts.every(account => account.oldestDate === '2026-01-01' && account.coverageSatisfied)).toBe(true)
    await db.query(`SELECT public.financial_provider_history_recovery_activate($1,$2,$3)`, [ORG, world.recovery.id, OWNER_ID])
    await db.query(`SELECT public.financial_provider_history_recovery_activate($1,$2,$3)`, [ORG, world.recovery.id, OWNER_ID])
    const items = await rows(db, `SELECT id,status,sync_cursor FROM public.financial_provider_items WHERE id IN ($1,$2)`, [world.source.id, world.replacement])
    expect(items).toHaveLength(2)
    expect(items.every(item => item.status === 'healthy')).toBe(true)
    expect(new Set(items.map(item => item.sync_cursor))).toEqual(new Set([`source-cursor-${world.sequence}`, `replacement-cursor-${world.sequence}`]))
    const activeMappings = await rows(db, `SELECT provider_account_ref FROM public.financial_provider_account_mappings
      WHERE financial_account_id=ANY($1::uuid[]) AND status='active'`, [world.financialAccountIds])
    expect(new Set(activeMappings.map(mapping => mapping.provider_account_ref))).toEqual(new Set(Object.values(world.replacementAccounts)))
    const copied = await rows(db, `SELECT provider_transaction_ref,status,category,suggestion_basis FROM public.financial_provider_interpretations
      WHERE provider_transaction_ref IN ($1,$2) ORDER BY created_at`, [world.oldTransactions[0], world.newTransactions[0]])
    expect(copied).toHaveLength(2)
    expect(copied.every(decision => decision.status === 'confirmed' && decision.category === 'utilities')).toBe(true)
  }, 60_000)

  it('blocks post-January-1 coverage until the owner explicitly accepts a documented partial result', async () => {
    const world = await setupRecovery(FOUR_ACCOUNTS, ['2026-01-01', '2026-01-03', '2026-01-01', '2026-02-01'])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    let status = (await rows(db, `SELECT public.financial_provider_history_recovery_get($1,$2) j`, [ORG, world.recovery.id]))[0].j
    expect(status.state).toBe('transaction_review')
    expect(status.accounts.filter(account => !account.coverageSatisfied)).toHaveLength(2)
    await db.query(`SELECT public.financial_provider_history_recovery_accept_partial_coverage($1,$2,$3,$4)`,
      [ORG, world.recovery.id, OWNER_ID, 'Wells Fargo returned less than the requested history for two accounts; owner accepts the displayed dates.'])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    status = (await rows(db, `SELECT public.financial_provider_history_recovery_get($1,$2) j`, [ORG, world.recovery.id]))[0].j
    expect(status.state).toBe('ready')
    expect(status.partialCoverageReason).toContain('owner accepts')
    expect(status.partialCoverageDetails.accounts).toHaveLength(4)
    expect(status.partialCoverageDetails.coverageBasis).toBe('oldest_observed_transaction_not_complete_history')
    const acceptedFingerprint = status.partialCoverageDetails.fingerprint
    await db.query(`INSERT INTO public.financial_provider_transactions(
      organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,name)
      VALUES($1,$2,$3,$4,false,77,7700,'USD','2026-10-15','NEW COVERAGE EVIDENCE')`,
      [ORG, world.replacement, world.replacementAccounts['personal-a'], `new-coverage-${world.sequence}`])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    status = (await rows(db, `SELECT public.financial_provider_history_recovery_get($1,$2) j`, [ORG, world.recovery.id]))[0].j
    expect(status.state).toBe('transaction_review')
    expect(status.partialCoverageDetails.fingerprint).toBe(acceptedFingerprint)
    expect((await rows(db, `SELECT public.financial_provider_history_recovery_coverage_fingerprint($1,$2) fingerprint`, [ORG, world.recovery.id]))[0].fingerprint).not.toBe(acceptedFingerprint)
    await db.query(`SELECT public.financial_provider_history_recovery_accept_partial_coverage($1,$2,$3,$4)`,
      [ORG, world.recovery.id, OWNER_ID, 'Owner renews approval after reviewing the newly observed transaction evidence.'])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    status = (await rows(db, `SELECT public.financial_provider_history_recovery_get($1,$2) j`, [ORG, world.recovery.id]))[0].j
    expect(status.state).toBe('ready')
    expect(status.partialCoverageDetails.previousAcceptance.details.fingerprint).toBe(acceptedFingerprint)
  })

  it('rejects incomplete account pairing at reconciliation and again at activation', async () => {
    const world = await setupRecovery(FOUR_ACCOUNTS.slice(0, 3))
    expect((await rows(db, `SELECT state FROM public.financial_provider_history_recoveries WHERE id=$1`, [world.recovery.id]))[0].state).toBe('account_review')
    await expect(db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id]))
      .rejects.toThrow(/HISTORY_RECOVERY_ACCOUNT_PAIRING_INCOMPLETE/)
    await db.query(`UPDATE public.financial_provider_history_recoveries SET state='ready' WHERE id=$1`, [world.recovery.id])
    await expect(db.query(`SELECT public.financial_provider_history_recovery_activate($1,$2,$3)`, [ORG, world.recovery.id, OWNER_ID]))
      .rejects.toThrow(/HISTORY_RECOVERY_ACCOUNT_PAIRING_INCOMPLETE/)
    expect((await rows(db, `SELECT count(*)::int n FROM public.financial_provider_account_mappings WHERE provider_account_ref=ANY($1::uuid[]) AND status='active'`,
      [Object.values(world.replacementAccounts)]))[0].n).toBe(0)
  })

  it('invalidates stale confirmed overlap and rebuilds it only when current provider facts agree again', async () => {
    const world = await setupRecovery()
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    expect((await rows(db, `SELECT count(*)::int n FROM public.financial_provider_history_recovery_transactions WHERE recovery_ref=$1 AND status='confirmed'`, [world.recovery.id]))[0].n).toBe(4)
    await db.query(`UPDATE public.financial_provider_transactions SET provider_amount=99,provider_amount_minor=9900 WHERE id=$1`, [world.newTransactions[0]])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    expect((await rows(db, `SELECT count(*)::int n FROM public.financial_provider_history_recovery_transactions
      WHERE recovery_ref=$1 AND status='rejected' AND invalidation_reason='candidate_rebuilt'`, [world.recovery.id]))[0].n).toBe(1)
    expect((await rows(db, `SELECT state FROM public.financial_provider_history_recoveries WHERE id=$1`, [world.recovery.id]))[0].state).toBe('transaction_review')
    await db.query(`UPDATE public.financial_provider_transactions SET provider_amount=10,provider_amount_minor=1000 WHERE id=$1`, [world.newTransactions[0]])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    expect((await rows(db, `SELECT count(*)::int n FROM public.financial_provider_history_recovery_transactions WHERE recovery_ref=$1 AND status='confirmed'`, [world.recovery.id]))[0].n).toBe(4)
    expect((await rows(db, `SELECT state FROM public.financial_provider_history_recoveries WHERE id=$1`, [world.recovery.id]))[0].state).toBe('ready')
  })

  it('rebuilds automatic and owner-confirmed matches into deterministic review when new evidence changes ambiguity', async () => {
    const world = await setupRecovery()
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    await db.query(`INSERT INTO public.financial_provider_transactions(
      organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,authorized_date,name,merchant_name)
      VALUES($1,$2,$3,$4,false,10,1000,'USD','2026-01-01','2026-01-01','RECOVERY 0','RECOVERY 0')`,
      [ORG, world.replacement, world.replacementAccounts.business, `ambiguous-new-${world.sequence}`])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    let matches = await rows(db, `SELECT id,replacement_transaction_ref,status,match_basis FROM public.financial_provider_history_recovery_transactions
      WHERE recovery_ref=$1 AND source_transaction_ref=$2 AND status IN ('confirmed','review') ORDER BY replacement_transaction_ref`,
      [world.recovery.id, world.oldTransactions[0]])
    expect(matches).toHaveLength(2)
    expect(matches.every(match => match.status === 'review' && match.match_basis === 'ambiguous_full_provider_facts')).toBe(true)
    expect((await rows(db, `SELECT state FROM public.financial_provider_history_recoveries WHERE id=$1`, [world.recovery.id]))[0].state).toBe('transaction_review')
    const competing = matches.find(match => match.replacement_transaction_ref !== world.newTransactions[0]).replacement_transaction_ref
    const chosen = matches.find(match => match.replacement_transaction_ref === world.newTransactions[0])
    await db.query(`SELECT public.financial_provider_history_recovery_confirm_transaction($1,$2,$3,$4)`, [ORG, world.recovery.id, chosen.id, OWNER_ID])
    const laterCompetitor = (await rows(db, `INSERT INTO public.financial_provider_transactions(
      organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,authorized_date,name,merchant_name)
      VALUES($1,$2,$3,$4,false,10,1000,'USD','2026-01-01','2026-01-01','RECOVERY 0','RECOVERY 0') RETURNING id`,
      [ORG, world.replacement, world.replacementAccounts.business, `later-ambiguous-${world.sequence}`]))[0].id
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    matches = await rows(db, `SELECT id,replacement_transaction_ref,status,match_basis FROM public.financial_provider_history_recovery_transactions
      WHERE recovery_ref=$1 AND source_transaction_ref=$2 AND status IN ('confirmed','review') ORDER BY replacement_transaction_ref`,
      [world.recovery.id, world.oldTransactions[0]])
    expect(matches).toHaveLength(2)
    expect(matches.every(match => match.status === 'review' && match.match_basis === 'ambiguous_full_provider_facts')).toBe(true)
    await db.query(`UPDATE public.financial_provider_transactions SET removed_at=now() WHERE id=ANY($1::uuid[])`, [[competing, laterCompetitor]])
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    matches = await rows(db, `SELECT replacement_transaction_ref,status,match_basis FROM public.financial_provider_history_recovery_transactions
      WHERE recovery_ref=$1 AND source_transaction_ref=$2 AND status IN ('confirmed','review')`, [world.recovery.id, world.oldTransactions[0]])
    expect(matches).toEqual([{ replacement_transaction_ref: world.newTransactions[0], status: 'confirmed', match_basis: 'unique_full_provider_facts' }])
  })

  it('blocks conflicting replacement decisions and remaps valid counterpart links without touching mappings early', async () => {
    const world = await setupRecovery()
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    const conflict = (await rows(db, `SELECT interpretation_id FROM public.financial_provider_replace_interpretation($1,$2,$3,'bucket','category','owner','high','{}'::jsonb,'conflict')`,
      [ORG, OWNER_ID, world.newTransactions[0]]))[0].interpretation_id
    await expect(db.query(`SELECT public.financial_provider_history_recovery_activate($1,$2,$3)`, [ORG, world.recovery.id, OWNER_ID]))
      .rejects.toThrow(/HISTORY_RECOVERY_INTERPRETATION_CONFLICT/)
    expect((await rows(db, `SELECT count(*)::int n FROM public.financial_provider_account_mappings WHERE provider_account_ref=ANY($1::uuid[]) AND status='active'`,
      [Object.values(world.replacementAccounts)]))[0].n).toBe(0)
    await db.query(`UPDATE public.financial_provider_interpretations SET status='undone',undone_by=$2,undone_at=now(),undo_reason='test conflict cleared' WHERE id=$1`, [conflict, OWNER_ID])
    for (const [from, counterpart] of [[world.oldTransactions[0], world.oldTransactions[1]], [world.oldTransactions[1], world.oldTransactions[0]]]) {
      await db.query(`SELECT * FROM public.financial_provider_replace_interpretation(
        p_organization_id=>$1,p_actor=>$2,p_provider_transaction_ref=>$3,p_dimension=>'relationship',p_kind=>'transfer',p_source=>'owner',
        p_confidence=>'high',p_suggestion_basis=>'{}'::jsonb,p_counterpart_provider_transaction_ref=>$4)`, [ORG, OWNER_ID, from, counterpart])
    }
    await db.query(`SELECT public.financial_provider_history_recovery_activate($1,$2,$3)`, [ORG, world.recovery.id, OWNER_ID])
    const pair = await rows(db, `SELECT provider_transaction_ref,counterpart_provider_transaction_ref FROM public.financial_provider_interpretations
      WHERE provider_transaction_ref=ANY($1::uuid[]) AND kind='transfer' AND status='confirmed'`, [[world.newTransactions[0], world.newTransactions[1]]])
    expect(pair).toHaveLength(2)
    expect(new Set(pair.map(row => row.counterpart_provider_transaction_ref))).toEqual(new Set([world.newTransactions[0], world.newTransactions[1]]))
  }, 60_000)

  it('preserves an existing ledger association and blocks activation instead of duplicating it', async () => {
    const world = await setupRecovery()
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    const ledgerId = (await rows(db, `INSERT INTO public.financial_transactions(organization_id,account_id,amount_minor,transaction_date,transaction_kind,economic_effect,economic_amount_minor,description,idempotency_key,created_by)
      VALUES($1,$2,-1200,'2026-01-01','expense','outflow',1200,'Existing ledger association',$3,$4) RETURNING id`,
      [ORG, world.financialAccountIds[2], `existing-ledger-${world.sequence}`, OWNER_ID]))[0].id
    await db.exec(`RESET ROLE; ALTER TABLE public.financial_provider_interpretations DISABLE TRIGGER trg_fpx_05_environment_guard; SET ROLE service_role`)
    await db.query(`INSERT INTO public.financial_provider_interpretations(organization_id,provider_transaction_ref,kind,status,source,confidence,suggestion_basis,
      ledger_transaction_id,match_mode,decided_by,decided_at,created_by) VALUES($1,$2,'ledger_match','confirmed','owner','high','{}'::jsonb,$3,'linked',$4,now(),$4)`,
      [ORG, world.oldTransactions[2], ledgerId, OWNER_ID])
    await db.exec(`RESET ROLE; ALTER TABLE public.financial_provider_interpretations ENABLE TRIGGER trg_fpx_05_environment_guard; SET ROLE service_role`)
    await expect(db.query(`SELECT public.financial_provider_history_recovery_activate($1,$2,$3)`, [ORG, world.recovery.id, OWNER_ID]))
      .rejects.toThrow(/HISTORY_RECOVERY_LEDGER_ASSOCIATION_REVIEW_REQUIRED/)
    expect((await rows(db, `SELECT provider_transaction_ref,status FROM public.financial_provider_interpretations WHERE ledger_transaction_id=$1`, [ledgerId]))[0])
      .toMatchObject({ provider_transaction_ref: world.oldTransactions[2], status: 'confirmed' })
    expect((await rows(db, `SELECT count(*)::int n FROM public.financial_provider_account_mappings WHERE provider_account_ref=ANY($1::uuid[]) AND status='active'`,
      [Object.values(world.replacementAccounts)]))[0].n).toBe(0)
  })

  it('refuses an invalid removed counterpart before changing mappings', async () => {
    const world = await setupRecovery()
    await db.query(`SELECT public.financial_provider_history_recovery_reconcile($1,$2)`, [ORG, world.recovery.id])
    const external = await makeItem(db, ORG, ['external'])
    const externalTx = (await rows(db, `INSERT INTO public.financial_provider_transactions(
      organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,name)
      VALUES($1,$2,$3,$4,false,10,1000,'USD','2026-01-01','EXTERNAL') RETURNING id`,
      [ORG, external.id, external.accounts.external, `external-${world.sequence}`]))[0].id
    await db.query(`SELECT * FROM public.financial_provider_replace_interpretation(
      p_organization_id=>$1,p_actor=>$2,p_provider_transaction_ref=>$3,p_dimension=>'relationship',p_kind=>'transfer',p_source=>'owner',
      p_confidence=>'high',p_suggestion_basis=>'{}'::jsonb,p_counterpart_provider_transaction_ref=>$4)`,
      [ORG, OWNER_ID, world.oldTransactions[0], externalTx])
    await db.query(`UPDATE public.financial_provider_transactions SET removed_at=now() WHERE id=$1`, [externalTx])
    await expect(db.query(`SELECT public.financial_provider_history_recovery_activate($1,$2,$3)`, [ORG, world.recovery.id, OWNER_ID]))
      .rejects.toThrow(/HISTORY_RECOVERY_COUNTERPART_INVALID/)
    expect((await rows(db, `SELECT count(*)::int n FROM public.financial_provider_account_mappings WHERE provider_account_ref=ANY($1::uuid[]) AND status='active'`,
      [Object.values(world.replacementAccounts)]))[0].n).toBe(0)
  })
})
