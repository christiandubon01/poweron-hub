import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { getSpendingReport, applyDecision, type SpendingContext, type SpendingRepo } from '../spending/spendingService'
import { defaultHierarchy } from '../spending/hierarchy'

const ORG='a0000000-0000-4000-8000-000000000001',OTHER='a0000000-0000-4000-8000-000000000002',OWNER='b0000000-0000-4000-8000-000000000001',OWNER_B='b0000000-0000-4000-8000-000000000002'
describe('BANK-6G full local schema and service authority',()=>{
  it('installs the review draft over real application migrations without changing reviewed evidence; custom assignments retain existing authority and history',async()=>{
    const pg=new PGlite()
    try{
      const source=readFileSync('src/services/bankProvider/__tests__/bank6bSmartReview.test.ts','utf8')
      const bootstrap=/const BOOTSTRAP = `([\s\S]*?)`\nconst MIGRATIONS/.exec(source)![1].replace(/\$\{(ORG_B|ORG|OWNER_B|OWNER)\}/g,(_,key)=>({ORG_B:OTHER,ORG,OWNER_B,OWNER})[key as 'ORG'])
      await pg.exec(bootstrap)
      for(const name of ['139_cash_accounts_manual_ledger','140_cash_linked_pair_lifecycle_hardening','141_cash_transfer_conflict_target_fix','142_cash_pair_void_link_lock_fix','143_cash_dated_obligations','146_balance_reconciliation_kind','153_bank_provider_evidence_foundation','154_bank_provider_credentials','155_bank_interpretation_model','156_bank_provider_environment','157_bank_merchant_rules','158_cash_os_display_colors']) await pg.exec(readFileSync(`supabase/migrations/${name}.sql`,'utf8'))
      await pg.exec(`SET ROLE service_role; SET request.jwt.claim.sub = '${OWNER}';`)
      const item=(await pg.query<{item_id:string}>(`SELECT item_id FROM financial_provider_connect_item($1,'plaid','local-item','ins_local','Synthetic bank',$2,$3)`,[ORG,`v1:${'A'.repeat(20)}:${'B'.repeat(20)}:${'C'.repeat(20)}`,OWNER])).rows[0].item_id
      const account=(await pg.query<{id:string}>(`INSERT INTO financial_provider_accounts(organization_id,provider_item_ref,provider_account_id,name,mask,currency,status) VALUES($1,$2,'local-account','Checking','0000','USD','active') RETURNING id`,[ORG,item])).rows[0].id
      const tx=(await pg.query<{id:string}>(`INSERT INTO financial_provider_transactions(organization_id,provider_item_ref,provider_account_ref,provider_transaction_id,pending,provider_amount,provider_amount_minor,currency,transaction_date,name) VALUES($1,$2,$3,'local-tx',false,15,1500,'USD','2026-10-09','SERVICE FEE') RETURNING id`,[ORG,item,account])).rows[0].id
      const confirm=async(key:string)=>pg.query(`SELECT * FROM financial_provider_replace_interpretation(p_organization_id=>$1::uuid,p_actor=>$2::uuid,p_provider_transaction_ref=>$3::uuid,p_dimension=>'bucket',p_kind=>'category',p_source=>'owner',p_confidence=>'high',p_suggestion_basis=>'{}'::jsonb,p_category=>$4::text)`,[ORG,OWNER,tx,key])
      await confirm('bank_finance_fees')
      const evidenceBefore=JSON.stringify((await pg.query('SELECT * FROM financial_provider_transactions')).rows)
      const interpretationsBefore=JSON.stringify((await pg.query('SELECT * FROM financial_provider_interpretations ORDER BY id')).rows)
      await pg.exec('RESET ROLE')
      await pg.exec(readFileSync('docs/bank6g/hierarchy-proposal.sql','utf8'))
      expect(JSON.stringify((await pg.query('SELECT * FROM financial_provider_transactions')).rows)).toBe(evidenceBefore)
      expect(JSON.stringify((await pg.query('SELECT * FROM financial_provider_interpretations ORDER BY id')).rows)).toBe(interpretationsBefore)
      await pg.exec('SET ROLE service_role')
      const payload=(await pg.query<{value:any}>('SELECT bank_spending_report_source($1,$2) AS value',[ORG,'2026-10-01'])).rows[0].value
      expect(payload.complete).toBe(true);expect(payload.txs).toHaveLength(1);expect(payload.decisions[0].category).toBe('bank_finance_fees')
      await expect(confirm('custom_supplies')).rejects.toMatchObject({code:'42501'})
      await pg.query('UPDATE bank_spending_hierarchy_controls SET writes_enabled=true WHERE organization_id=$1',[ORG])
      await pg.exec('SET ROLE authenticated')
      const category=(await pg.query<{key:string}>(`SELECT bank_spending_manage_definition('category',NULL,'Shop Supplies','materials','#5a72d9',false) AS key`)).rows[0].key
      await pg.exec('SET ROLE service_role')
      await confirm(category)
      expect((await pg.query(`SELECT category,status FROM financial_provider_interpretations ORDER BY created_at,id`)).rows).toEqual(expect.arrayContaining([{category:'bank_finance_fees',status:'undone'},{category,status:'confirmed'}]))
      await pg.exec('SET ROLE authenticated')
      await pg.query(`SELECT bank_spending_manage_definition('category',$1,'Shop Supplies','materials','#5a72d9',true)`,[category])
      await pg.exec('SET ROLE service_role')
      expect((await confirm(category)).rows[0]).toMatchObject({outcome:'unchanged'})
      await confirm('bank_finance_fees')
      await expect(confirm(category)).rejects.toMatchObject({code:'23514'})
      expect(JSON.stringify((await pg.query('SELECT * FROM financial_provider_transactions')).rows)).toBe(evidenceBefore)
      expect((await pg.query('SELECT id FROM financial_transactions')).rows).toEqual([])
    }finally{await pg.close()}
  },30000)
  it('uses authenticated organization and configured environment, and refuses unverified coverage or invalid dates',async()=>{
    const ctx:SpendingContext={txs:[],accounts:[],decisions:[],obligations:[],occurrences:[],commitments:[],debts:[],projects:[],reportCoverage:{complete:false,reason:'Source cap'},hierarchy:defaultHierarchy()}
    const calls:any[]=[]
    const repo={loadReportContext:async(org:string,date:string)=>{calls.push({org,date});return ctx}} as SpendingRepo
    const actor={organizationId:ORG,userId:OWNER,role:'owner' as const}
    const r=await getSpendingReport({repo,environment:'production'},actor,{report:'all_money',from:'2026-10-01',to:'2026-10-09',organizationId:OTHER,environment:'sandbox'})
    expect(calls[0].org).toBe(ORG);expect(r.scope.environment).toBe('production');expect(r.summary).toBeNull()
    await expect(getSpendingReport({repo},actor,{report:'all_money',from:'2026-02-30',to:'2026-10-09'})).rejects.toMatchObject({code:'invalid_request'})
    await expect(getSpendingReport({repo},{...actor,role:'member'} as any,{report:'business'})).rejects.toMatchObject({code:'forbidden'})
  })
})
