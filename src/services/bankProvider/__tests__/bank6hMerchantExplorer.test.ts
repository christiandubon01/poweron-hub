import { describe,it,expect,vi } from 'vitest'
import { relatedTransactions,previewCategoryBatch,confirmCategoryBatch } from '../spending/merchantExplorer'
import { defaultHierarchy } from '../spending/hierarchy'
import type { SpendingContext,SpendingDeps } from '../spending/spendingService'
import { BankConnectionError } from '../bankConnectionService'
const id=(n:number)=>`a0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor={organizationId:id(10),userId:id(20),role:'owner' as const}
function fixture(){
 const h={...defaultHierarchy(),available:true,writesEnabled:true};h.categories.push({key:'custom_debt_fees',name:'Debt-related fees',parentKey:'overhead',builtin:false,archived:false})
 const ctx:SpendingContext={hierarchy:h,reportCoverage:{complete:true,reason:null},txs:[
  {id:id(1),providerAccountRef:id(30),date:'2026-10-09',name:'ACME #001',merchantName:'Acme',amountMinor:1500,pending:false,removed:false,category:null},
  {id:id(2),providerAccountRef:id(30),date:'2026-10-08',name:'ACME #002',merchantName:'Acme',amountMinor:2500,pending:false,removed:false,category:null},
  {id:id(3),providerAccountRef:id(30),date:'2024-01-01',name:'OLD ACME',merchantName:'Acme',amountMinor:5000,pending:false,removed:false,category:null},
  {id:id(4),providerAccountRef:id(30),date:'2026-10-09',name:'OTHER',merchantName:'Other Merchant',amountMinor:1000,pending:false,removed:false,category:null},
  {id:id(5),providerAccountRef:id(30),date:'2026-10-09',name:'OVERDRAFT FEE #001',merchantName:null,amountMinor:3500,pending:false,removed:false,category:null},
  {id:id(6),providerAccountRef:id(30),date:'2026-10-08',name:'OVERDRAFT ITEM FEE #002',merchantName:null,amountMinor:3500,pending:false,removed:false,category:null},
 ],accounts:[{providerAccountRef:id(30),label:'Synthetic checking',mask:'0000',ownership:'business',financialAccountId:id(31),financialAccountName:'Business checking',environment:'production'}],decisions:[],obligations:[],occurrences:[],commitments:[],debts:[],projects:[]}
 const repo={loadReportContext:vi.fn(async(org:string)=>org===actor.organizationId?ctx:{...ctx,txs:[]}),checkedCategoryAvailable:vi.fn(async()=>true),replaceCategoryChecked:vi.fn(async()=>({outcome:'changed' as const}))}
 const deps={repo,environment:'production',now:()=>Date.parse('2026-10-09')} as unknown as SpendingDeps
 const query={related:id(1),from:'2026-09-10',to:'2026-10-09',accounts:'mapped',population:'all_money'}
 return {ctx,repo,deps,query}
}
describe('BANK-6H exact merchant exploration and explicit category-only batches',()=>{
 it('matches actual provider merchant names, not shared account or arbitrary description; history widening is explicit',async()=>{
  const {deps,query}=fixture();const r=await relatedTransactions(deps,actor,query)
  expect(r.rows.map(r=>r.id)).toEqual([id(1),id(2)]);expect(r.total).toBe(2)
  expect((await relatedTransactions(deps,actor,{...query,historical:'1'})).rows.map(r=>r.id)).toContain(id(3))
 })
 it('requires explicit fee-description grouping when merchant identity is absent',async()=>{
  const {deps,query}=fixture();const merchant=await relatedTransactions(deps,actor,{...query,related:id(5)})
  expect(merchant.complete).toBe(false);expect(merchant.rows).toEqual([])
  const description=await relatedTransactions(deps,actor,{...query,related:id(5),match:'description'})
  expect(description.rows.map(r=>r.id)).toEqual([id(5),id(6)])
 })
 it('preserves date, account, search, category and direction scopes; historical mode lifts only disclosed filters',async()=>{
  const {deps,query}=fixture()
  expect((await relatedTransactions(deps,actor,{...query,search:'#002'})).total).toBe(1)
  expect((await relatedTransactions(deps,actor,{...query,direction:'in'})).total).toBe(0)
  await expect(relatedTransactions(deps,actor,{...query,account:id(99)})).rejects.toMatchObject({code:'not_found'})
 })
 it('rejects foreign organization, member and invalid date/account requests',async()=>{
  const {deps,query}=fixture()
  await expect(relatedTransactions(deps,{...actor,role:'member'} as any,query)).rejects.toMatchObject({code:'forbidden'})
  await expect(relatedTransactions(deps,{...actor,organizationId:id(99)},query)).rejects.toMatchObject({code:'not_found'})
  await expect(relatedTransactions(deps,actor,{...query,from:'2026-02-30'})).rejects.toMatchObject({code:'invalid_request'})
  await expect(relatedTransactions(deps,actor,{...query,account:'wrong'})).rejects.toMatchObject({code:'invalid_request'})
 })
 it('withholds complete counts and changes on caps, duplicates and incomplete coverage',async()=>{
  const {deps,query,ctx}=fixture();ctx.reportCoverage={complete:false,reason:'Source cap'}
  const r=await relatedTransactions(deps,actor,query);expect(r.total).toBeNull();expect(r.rows).toEqual([])
  ctx.reportCoverage={complete:true,reason:null};ctx.txs.push(ctx.txs[0]);expect((await relatedTransactions(deps,actor,query)).complete).toBe(false)
 })
 it('previews exact records without writes, excludes pending/ignored/removed and detects changed revisions',async()=>{
  const {deps,query,ctx,repo}=fixture(),r=await relatedTransactions(deps,actor,query),selection=r.rows.map(r=>({id:r.id,expected:r.revision}))
  ctx.txs[1].pending=true
  const p=await previewCategoryBatch(deps,actor,{query,selection,category:'custom_debt_fees'})
  expect(p.preview[0].eligible).toBe(true);expect(p.preview[1].reason).toBe('Pending');expect(repo.replaceCategoryChecked).not.toHaveBeenCalled()
  ctx.txs[0].amountMinor=9999;expect((await previewCategoryBatch(deps,actor,{query,selection,category:'custom_debt_fees'})).preview[0].eligible).toBe(false)
 })
 it('rejects duplicate/foreign selections, archived categories and missing explicit confirmation',async()=>{
  const {deps,query,ctx}=fixture(),r=await relatedTransactions(deps,actor,query),s={id:r.rows[0].id,expected:r.rows[0].revision}
  await expect(previewCategoryBatch(deps,actor,{query,selection:[s,s],category:'materials'})).rejects.toMatchObject({code:'invalid_request'})
  expect((await previewCategoryBatch(deps,actor,{query,selection:[{...s,id:id(99)}],category:'materials'})).preview[0].eligible).toBe(false)
  ctx.hierarchy!.categories.find(c=>c.key==='custom_debt_fees')!.archived=true
  await expect(previewCategoryBatch(deps,actor,{query,selection:[s],category:'custom_debt_fees'})).rejects.toMatchObject({code:'invalid_request'})
  await expect(confirmCategoryBatch(deps,actor,{query,selection:[s],category:'materials'})).rejects.toMatchObject({code:'invalid_request'})
 })
 it('gates missing atomic protection and reports per-record partial failures; never invokes a relationship or rule write',async()=>{
  const {deps,repo,query}=fixture(),r=await relatedTransactions(deps,actor,query),selection=r.rows.map(r=>({id:r.id,expected:r.revision})),raw={query,selection,category:'custom_debt_fees',confirmed:true}
  repo.checkedCategoryAvailable.mockResolvedValueOnce(false);await expect(confirmCategoryBatch(deps,actor,raw)).rejects.toMatchObject({code:'conflict'})
  repo.replaceCategoryChecked.mockRejectedValueOnce(new BankConnectionError('conflict',409,'stale'))
  const out=await confirmCategoryBatch(deps,actor,raw);expect(out.results.map(r=>r.outcome)).toEqual(['conflict','changed'])
  expect(repo.replaceCategoryChecked.mock.calls[0]).toEqual([actor.organizationId,actor.userId,id(1),'custom_debt_fees',selection[0].expected])
 })
})
