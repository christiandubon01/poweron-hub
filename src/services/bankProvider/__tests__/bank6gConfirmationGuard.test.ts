import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Real interpretation constraints, RLS and triggers; synthetic local PostgreSQL only.
const ORG='a0000000-0000-4000-8000-000000000001', OTHER='a0000000-0000-4000-8000-000000000002'
const OWNER='b0000000-0000-4000-8000-000000000001', OWNER_B='b0000000-0000-4000-8000-000000000002'
let pg: PGlite, tx: string
beforeAll(async()=>{
  pg=new PGlite()
  const source=readFileSync('src/services/bankProvider/__tests__/bank6bSmartReview.test.ts','utf8')
  const bootstrap=/const BOOTSTRAP = `([\s\S]*?)`\nconst MIGRATIONS/.exec(source)![1].replace(/\$\{(ORG_B|ORG|OWNER_B|OWNER)\}/g,(_,key)=>({ORG_B:OTHER,ORG,OWNER_B,OWNER})[key as 'ORG'])
  await pg.exec(bootstrap)
  for(const name of ['139_cash_accounts_manual_ledger','140_cash_linked_pair_lifecycle_hardening','141_cash_transfer_conflict_target_fix','142_cash_pair_void_link_lock_fix','143_cash_dated_obligations','146_balance_reconciliation_kind','153_bank_provider_evidence_foundation','154_bank_provider_credentials','155_bank_interpretation_model','156_bank_provider_environment','157_bank_merchant_rules','158_cash_os_display_colors']) await pg.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'))
  await pg.exec(readFileSync('docs/bank6g/hierarchy-proposal.sql','utf8'))
  await pg.exec(`SET ROLE service_role; SET request.jwt.claim.sub='${OWNER}';`)
  const item=(await pg.query<{item_id:string}>(`SELECT item_id FROM financial_provider_connect_item($1,'plaid','guard-local','ins_local','Synthetic bank',$2,$3)`,[ORG,`v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`,OWNER])).rows[0].item_id
  const account=(await pg.query<{id:string}>(`INSERT INTO financial_provider_accounts(organization_id,provider_item_ref,provider_account_id,name,currency,status) VALUES($1,$2,'guard-account','Checking','USD','active') RETURNING id`,[ORG,item])).rows[0].id
  tx=(await pg.query<{id:string}>(`INSERT INTO financial_provider_transactions(organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,name) VALUES($1,$2,$3,'guard-tx',false,15,1500,'USD','2026-10-09','Synthetic fee') RETURNING id`,[ORG,item,account])).rows[0].id
  await pg.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled=true')
  await pg.query(`INSERT INTO bank_spending_category_definitions(organization_id,key,name,builtin,archived) VALUES ($1,'custom_valid','Valid',false,false),($1,'custom_archived','Archived',false,true),($2,'custom_foreign','Foreign',false,false)`,[ORG,OTHER])
  await pg.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled=false')
  await pg.exec('RESET ROLE')
},30000)
beforeEach(async()=>{await pg.exec(`BEGIN; SET ROLE authenticated; SET request.jwt.claim.sub='${OWNER}';`)})
afterEach(async()=>{await pg.exec('ROLLBACK; RESET ROLE;')})
afterAll(async()=>{await pg?.close()})
async function insert(key:string,status='suggested') {
  return (await pg.query<{id:string}>(`INSERT INTO financial_provider_interpretations(organization_id,provider_transaction_ref,kind,status,source,confidence,category,created_by) VALUES($1,$2,'category',$3,'owner','high',$4,$5) RETURNING id`,[ORG,tx,status,key,OWNER])).rows[0].id
}
async function enabled(value=true){await pg.exec('SET ROLE service_role');await pg.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled=$1 WHERE organization_id=$2',[value,ORG]);await pg.exec('SET ROLE authenticated')}
async function denied(sql:string,args:unknown[],code:string){
  await pg.exec('SAVEPOINT denied_attempt')
  await expect(pg.query(sql,args)).rejects.toMatchObject({code})
  await pg.exec('ROLLBACK TO SAVEPOINT denied_attempt; RELEASE SAVEPOINT denied_attempt')
}
const confirm=(id:string)=>pg.query<{status:string;decided_by:string;decided_at:Date}>("UPDATE financial_provider_interpretations SET status='confirmed' WHERE id=$1 RETURNING status,decided_by,decided_at",[id])
const replace=async(key:string)=>{await pg.exec('SET ROLE service_role');return pg.query(`SELECT * FROM financial_provider_replace_interpretation(p_organization_id=>$1::uuid,p_actor=>$2::uuid,p_provider_transaction_ref=>$3::uuid,p_dimension=>'bucket',p_kind=>'category',p_source=>'owner',p_confidence=>'high',p_category=>$4::text)`,[ORG,OWNER,tx,key])}

describe('BANK-6G confirmation gate on the actual interpretation model',()=>{
  it('denies a direct confirmed INSERT while custom writes are disabled',async()=>{
    await expect(insert('custom_valid','confirmed')).rejects.toMatchObject({code:'42501'})
  })
  it('denies suggested -> confirmed UPDATE while disabled, preserving the suggestion',async()=>{
    const id=await insert('custom_valid')
    await denied("UPDATE financial_provider_interpretations SET status='confirmed' WHERE id=$1",[id],'42501')
    expect((await pg.query('SELECT status,decided_at FROM financial_provider_interpretations WHERE id=$1',[id])).rows[0]).toEqual({status:'suggested',decided_at:null})
  })
  it.each(['custom_missing','custom_archived','custom_foreign'])('denies %s for both INSERT and UPDATE confirmation',async key=>{
    await enabled()
    await denied(`INSERT INTO financial_provider_interpretations(organization_id,provider_transaction_ref,kind,status,source,category,created_by) VALUES($1,$2,'category','confirmed','owner',$3,$4)`,[ORG,tx,key,OWNER],'23514')
    const id=await insert(key)
    await denied("UPDATE financial_provider_interpretations SET status='confirmed' WHERE id=$1",[id],'23514')
  })
  it.each([
    "category='materials',status='confirmed'",
    `organization_id='${OTHER}',status='confirmed'`,
    "kind='personal',category=NULL,status='confirmed'",
    `organization_id='${OTHER}',kind='personal',category=NULL,status='confirmed'`,
    "category='custom_missing',status='confirmed'",
  ])('rejects simultaneous immutable identity and status edits: %s',async changes=>{
    await enabled()
    const id=await insert('custom_valid')
    await denied(`UPDATE financial_provider_interpretations SET ${changes} WHERE id=$1`,[id],'23514')
    expect((await pg.query('SELECT organization_id,category,kind,status FROM financial_provider_interpretations WHERE id=$1',[id])).rows[0]).toEqual({organization_id:ORG,category:'custom_valid',kind:'category',status:'suggested'})
  })
  it('allows valid owner INSERT and UPDATE confirmation with audit stamps when enabled',async()=>{
    await enabled()
    const id=await insert('custom_valid')
    expect((await confirm(id)).rows[0]).toMatchObject({status:'confirmed',decided_by:OWNER})
    expect((await confirm(id)).rows[0].decided_at).not.toBeNull()
    await pg.query("UPDATE financial_provider_interpretations SET status='undone',undo_reason='test' WHERE id=$1",[id])
    await insert('custom_valid','confirmed')
  })
  it('keeps member and other-organization authority constrained by RLS',async()=>{
    const id=await insert('custom_valid')
    await enabled()
    await pg.exec(`SET request.jwt.claim.sub='${OWNER_B}'`)
    expect((await confirm(id)).rows).toEqual([])
    await denied(`INSERT INTO financial_provider_interpretations(organization_id,provider_transaction_ref,kind,status,source,category,created_by) VALUES($1,$2,'category','confirmed','owner','custom_valid',$3)`,[ORG,tx,OWNER_B],'42501')
    await pg.exec(`RESET ROLE; UPDATE test_profiles SET role='crew' WHERE id='${OWNER}'; SET ROLE authenticated; SET request.jwt.claim.sub='${OWNER}';`)
    expect((await confirm(id)).rows).toEqual([])
    await denied(`INSERT INTO financial_provider_interpretations(organization_id,provider_transaction_ref,kind,status,source,category,created_by) VALUES($1,$2,'category','confirmed','owner','custom_valid',$3)`,[ORG,tx,OWNER],'42501')
  })
  it('preserves built-in confirmation, permitted undo and unrelated updates with gate disabled',async()=>{
    const id=await insert('materials')
    await confirm(id)
    await pg.query("UPDATE financial_provider_interpretations SET confidence='possible' WHERE id=$1",[id])
    await pg.query("UPDATE financial_provider_interpretations SET status='undone',undo_reason='owner undo' WHERE id=$1",[id])
    expect((await pg.query('SELECT status,category,decided_by,undone_by,undo_reason FROM financial_provider_interpretations WHERE id=$1',[id])).rows[0]).toEqual({status:'undone',category:'materials',decided_by:OWNER,undone_by:OWNER,undo_reason:'owner undo'})
    expect((await replace('bank_finance_fees')).rows[0]).toMatchObject({outcome:'created'})
  })
  it('preserves existing custom history/undo when gate is later disabled; failed RPC replacement rolls back retirement',async()=>{
    await enabled()
    const id=await insert('custom_valid','confirmed')
    await enabled(false)
    await pg.query("UPDATE financial_provider_interpretations SET confidence='possible' WHERE id=$1",[id])
    expect((await replace('custom_valid')).rows[0]).toMatchObject({outcome:'unchanged'})
    await pg.exec('SET ROLE service_role')
    const before=(await pg.query('SELECT * FROM financial_provider_interpretations ORDER BY id')).rows
    await denied(`SELECT * FROM financial_provider_replace_interpretation(p_organization_id=>$1::uuid,p_actor=>$2::uuid,p_provider_transaction_ref=>$3::uuid,p_dimension=>'bucket',p_kind=>'category',p_source=>'owner',p_confidence=>'high',p_category=>'custom_missing')`,[ORG,OWNER,tx],'42501')
    expect((await pg.query('SELECT * FROM financial_provider_interpretations ORDER BY id')).rows).toEqual(before)
    expect((await replace('materials')).rows[0]).toMatchObject({outcome:'changed'})
    expect((await pg.query('SELECT status,category,undo_reason FROM financial_provider_interpretations WHERE id=$1',[id])).rows[0]).toEqual({status:'undone',category:'custom_valid',undo_reason:'changed_by_owner'})
  })
  it('does not expose trigger execution or control UPDATE privileges to browser roles',async()=>{
    const r=(await pg.query(`SELECT has_function_privilege('authenticated','bank_spending_guard_custom_assignment()','EXECUTE') AS auth_execute,has_function_privilege('anon','bank_spending_guard_custom_assignment()','EXECUTE') AS anon_execute,has_table_privilege('authenticated','bank_spending_hierarchy_controls','UPDATE') AS control_update`)).rows[0]
    expect(r).toEqual({auth_execute:false,anon_execute:false,control_update:false})
  })
  it('runs immutability before the new gate, then existing validation and audit stamping',async()=>{
    const names=(await pg.query<{tgname:string}>(`SELECT tgname FROM pg_trigger WHERE tgrelid='financial_provider_interpretations'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows.map(r=>r.tgname)
    expect(names).toEqual(['trg_fpx_00_immutable','trg_fpx_01_bank6g_custom_confirmation','trg_fpx_05_environment_guard','trg_fpx_10_validate','trg_fpx_90_updated_at'])
  })
})
