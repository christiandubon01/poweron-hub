import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const ORG='a0000000-0000-4000-8000-000000000001',OTHER='a0000000-0000-4000-8000-000000000002',OWNER='b0000000-0000-4000-8000-000000000001',OWNER_B='b0000000-0000-4000-8000-000000000002'
let pg:PGlite,tx:string
beforeAll(async()=>{
 pg=new PGlite();const source=readFileSync('src/services/bankProvider/__tests__/bank6bSmartReview.test.ts','utf8')
 const bootstrap=/const BOOTSTRAP = `([\s\S]*?)`\nconst MIGRATIONS/.exec(source)![1].replace(/\$\{(ORG_B|ORG|OWNER_B|OWNER)\}/g,(_,k)=>({ORG_B:OTHER,ORG,OWNER_B,OWNER})[k as 'ORG'])
 await pg.exec(bootstrap)
 await pg.exec(`CREATE TABLE profiles(id uuid PRIMARY KEY,org_id uuid,role text,is_active boolean); INSERT INTO profiles VALUES('${OWNER}','${ORG}','owner',true),('${OWNER_B}','${OTHER}','owner',true); GRANT SELECT ON profiles TO service_role;`)
 for(const n of ['139_cash_accounts_manual_ledger','140_cash_linked_pair_lifecycle_hardening','141_cash_transfer_conflict_target_fix','142_cash_pair_void_link_lock_fix','143_cash_dated_obligations','146_balance_reconciliation_kind','153_bank_provider_evidence_foundation','154_bank_provider_credentials','155_bank_interpretation_model','156_bank_provider_environment','157_bank_merchant_rules','158_cash_os_display_colors'])await pg.exec(readFileSync(`supabase/migrations/${n}.sql`,'utf8'))
 await pg.exec(readFileSync('docs/bank6g/hierarchy-proposal.sql','utf8'))
 await pg.exec(readFileSync('docs/bank6h/checked-category-proposal.sql','utf8'))
 await pg.exec(`SET ROLE service_role; SET request.jwt.claim.sub='${OWNER}';`)
 const item=(await pg.query<{item_id:string}>(`SELECT item_id FROM financial_provider_connect_item($1,'plaid','merchant-local','ins_local','Synthetic bank',$2,$3)`,[ORG,`v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`,OWNER])).rows[0].item_id
 const account=(await pg.query<{id:string}>(`INSERT INTO financial_provider_accounts(organization_id,provider_item_ref,provider_account_id,name,currency,status) VALUES($1,$2,'merchant-account','Checking','USD','active') RETURNING id`,[ORG,item])).rows[0].id
 tx=(await pg.query<{id:string}>(`INSERT INTO financial_provider_transactions(organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,name,merchant_name) VALUES($1,$2,$3,'merchant-tx',false,15,1500,'USD','2026-10-09','ACME #001','Acme') RETURNING id`,[ORG,item,account])).rows[0].id
 await pg.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled=true WHERE organization_id=$1',[ORG])
 await pg.query(`INSERT INTO bank_spending_category_definitions(organization_id,key,name,parent_key,builtin) VALUES($1,'custom_debt_fees','Debt-related fees','overhead',false)`,[ORG])
 await legacy('category','bank_finance_fees');await legacy('overhead',null)
 await pg.exec('RESET ROLE')
},30000)
beforeEach(async()=>{await pg.exec(`BEGIN; SET ROLE service_role; SET request.jwt.claim.sub='${OWNER}';`)})
afterEach(async()=>{await pg.exec('ROLLBACK; RESET ROLE')})
afterAll(async()=>{await pg?.close()})
const legacy=(kind:string,category:string|null)=>pg.query(`SELECT * FROM financial_provider_replace_interpretation(p_organization_id=>$1,p_actor=>$2,p_provider_transaction_ref=>$3,p_dimension=>$4,p_kind=>$5,p_source=>'owner',p_confidence=>'high',p_category=>$6)`,[ORG,OWNER,tx,kind==='category'?'bucket':kind==='ignored'?'ignore':'relationship',kind,category])
async function revision(){return (await pg.query<{value:any}>(`SELECT jsonb_build_object('category',(SELECT id FROM financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='confirmed' AND kind='category'),'relationship',(SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='confirmed' AND kind NOT IN ('category','ignored')),'ignored',(SELECT id FROM financial_provider_interpretations WHERE provider_transaction_ref=$1 AND status='confirmed' AND kind='ignored'),'amountMinor',provider_amount_minor,'pending',pending,'removed',removed_at IS NOT NULL,'date',transaction_date,'accountRef',provider_account_ref,'name',name,'merchantName',merchant_name) value FROM financial_provider_transactions WHERE id=$1`,[tx])).rows[0].value}
const checked=(expected:any,key='custom_debt_fees',org=ORG,actor=OWNER)=>pg.query<{outcome:string}>(`SELECT * FROM bank_spending_replace_category_checked($1,$2,$3,$4,$5)`,[org,actor,tx,key,expected])
async function denied(fn:()=>Promise<unknown>,code:string){await pg.exec('SAVEPOINT attempt');await expect(fn()).rejects.toMatchObject({code});await pg.exec('ROLLBACK TO SAVEPOINT attempt; RELEASE SAVEPOINT attempt')}
describe('BANK-6H atomic category compare-and-replace on actual PostgreSQL',()=>{
 it('advertises capability only to an authorized service actor; no metadata or decision writes',async()=>{
  const n=(await pg.query('SELECT count(*) FROM financial_provider_interpretations')).rows
  expect((await pg.query(`SELECT * FROM bank_spending_replace_category_checked($1,$2,NULL,NULL,NULL)`,[ORG,OWNER])).rows[0]).toMatchObject({outcome:'available'})
  expect((await pg.query('SELECT count(*) FROM financial_provider_interpretations')).rows).toEqual(n)
  await denied(()=>checked({},'materials',ORG,OWNER_B),'42501')
  await pg.exec('SET ROLE authenticated');await denied(async()=>checked(await revision()),'42501')
 })
 it('replaces an already-reviewed category atomically, preserves the independent overhead relationship, evidence and ledger; undo remains available',async()=>{
  const before=JSON.stringify((await pg.query('SELECT * FROM financial_provider_transactions')).rows),r=await revision(),rel=r.relationship
  expect((await checked(r)).rows[0].outcome).toBe('changed')
  const next=await revision();expect(next.relationship).toEqual(rel);expect(next.category).not.toBe(r.category)
  expect((await pg.query('SELECT status FROM financial_provider_interpretations WHERE id=$1',[r.category])).rows[0]).toMatchObject({status:'undone'})
  expect(JSON.stringify((await pg.query('SELECT * FROM financial_provider_transactions')).rows)).toBe(before)
  expect((await pg.query('SELECT id FROM financial_transactions')).rows).toEqual([])
  await pg.query(`UPDATE financial_provider_interpretations SET status='undone',undone_by=$1,undone_at=now(),undo_reason='owner_undo' WHERE id=$2`,[OWNER,next.category])
  expect((await revision()).category).toBeNull();expect((await revision()).relationship).toEqual(rel)
 })
 it('rejects concurrent category or relationship changes without overwriting the new decision',async()=>{
  const r=await revision();await legacy('category','materials');await denied(()=>checked(r),'40001')
  const n=await revision();await legacy('personal',null);await denied(()=>checked(n),'40001')
  expect((await pg.query(`SELECT category FROM financial_provider_interpretations WHERE status='confirmed' AND kind='category'`)).rows[0]).toMatchObject({category:'materials'})
 })
 it('retries an uncertain successful response idempotently without extra history and rejects later competing edits',async()=>{
  const r=await revision();await checked(r);const n=(await pg.query('SELECT count(*) FROM financial_provider_interpretations')).rows
  expect((await checked(r)).rows[0].outcome).toBe('unchanged');expect((await pg.query('SELECT count(*) FROM financial_provider_interpretations')).rows).toEqual(n)
  await legacy('category','materials');await denied(()=>checked(r),'40001')
 })
 it('rejects pending, ignored and changed evidence under the lock',async()=>{
  const r=await revision();await pg.query('UPDATE financial_provider_transactions SET pending=true WHERE id=$1',[tx]);await denied(()=>checked(r),'40001')
  await pg.query('UPDATE financial_provider_transactions SET pending=false,provider_amount_minor=1600,provider_amount=16 WHERE id=$1',[tx]);await denied(()=>checked(r),'40001')
  await legacy('ignored',null);await denied(async()=>checked(await revision()),'40001')
 })
 it('fails closed for archived/unregistered/disabled custom categories and keeps the prior reviewed interpretation active',async()=>{
  const r=await revision();await denied(()=>checked(r,'custom_missing'),'23514')
  await pg.query(`UPDATE bank_spending_category_definitions SET archived=true WHERE organization_id=$1 AND key='custom_debt_fees'`,[ORG]);await denied(()=>checked(r),'23514')
  await pg.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled=false WHERE organization_id=$1',[ORG]);await denied(()=>checked(r),'42501')
  expect((await revision()).category).toBe(r.category)
 })
 it('refuses member/inactive actors, foreign organization records and browser/anonymous execution',async()=>{
  const r=await revision();await pg.exec('RESET ROLE');await pg.query(`UPDATE profiles SET role='member' WHERE id=$1`,[OWNER]);await pg.exec('SET ROLE service_role');await denied(()=>checked(r),'42501')
  await pg.exec('RESET ROLE');await pg.query(`UPDATE profiles SET role='admin',is_active=false WHERE id=$1`,[OWNER]);await pg.exec('SET ROLE service_role');await denied(()=>checked(r),'42501')
  await denied(()=>checked(r,'materials',OTHER,OWNER_B),'40001')
  expect((await pg.query(`SELECT has_function_privilege('anon','bank_spending_replace_category_checked(uuid,uuid,uuid,text,jsonb)','EXECUTE') a,has_function_privilege('authenticated','bank_spending_replace_category_checked(uuid,uuid,uuid,text,jsonb)','EXECUTE') b`)).rows[0]).toEqual({a:false,b:false})
 })
})
