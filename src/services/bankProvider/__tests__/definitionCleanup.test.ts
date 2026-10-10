import {describe,it,expect,vi} from 'vitest'
import {previewDefinitionCleanup} from '../spending/definitionCleanup'
const actor={organizationId:'org',userId:'owner',role:'owner' as const}
function fixture(count=1,error:any=null){
 const reads:any[]=[],writes=vi.fn()
 const svc={rpc:vi.fn(async()=>({data:{writes_enabled:true,parents:[{key:'overhead',name:'Business Overhead'}],categories:[{key:'custom_fees',name:'Fees',parent_key:'overhead',archived:false}]},error:null})),from:(table:string)=>{
  const read:any={table};reads.push(read)
  const chain:any={select:(columns:string,options:any)=>{read.columns=columns;read.options=options;return chain},eq:(key:string,value:string)=>{read[key]=value;return chain},in:(key:string,value:any)=>{read[key]=value;return chain},order:()=>chain,range:async()=>({data:[{id:'ref',category:'custom_fees',status:table.includes('interpretations')?'undone':'archived',provider_transaction_ref:'tx'}],count,error}),insert:writes,update:writes,delete:writes};return chain
 }};return {svc,reads,writes}
}
describe('read-only cleanup inventory',()=>{
 it('scopes every read to actor organization and includes historical decisions/rules without mutation',async()=>{
  const f=fixture();const p=await previewDefinitionCleanup(f.svc,actor,'category','custom_fees')
  expect(p.executionAllowed).toBe(false);expect(p.complete).toBe(true);expect(p.references.map(r=>r.status)).toEqual(['undone','archived'])
  expect(f.reads.every(r=>r.organization_id==='org'&&r.category[0]==='custom_fees'&&!r.status)).toBe(true);expect(f.writes).not.toHaveBeenCalled()
 })
 it('discloses incomplete lists, parent children and exact table counts; never authorizes unused deletion',async()=>{
  const f=fixture(201);const p=await previewDefinitionCleanup(f.svc,actor,'parent','overhead')
  expect(p.complete).toBe(false);expect(p.children).toEqual(expect.arrayContaining([{key:'custom_fees',name:'Fees'}]));expect(Object.values(p.counts)).toEqual([201,201]);expect(p.executionAllowed).toBe(false)
 })
 it('rejects unauthorized/foreign/malformed definitions and failed reference reads',async()=>{
  const f=fixture();await expect(previewDefinitionCleanup(f.svc,{...actor,role:'member' as any},'category','custom_fees')).rejects.toMatchObject({code:'forbidden'});expect(f.reads).toHaveLength(0)
  await expect(previewDefinitionCleanup(f.svc,actor,'category','foreign_category')).rejects.toMatchObject({code:'not_found'})
  await expect(previewDefinitionCleanup(f.svc,actor,'category','bad key')).rejects.toMatchObject({code:'invalid_request'})
  await expect(previewDefinitionCleanup(fixture(1,{code:'42501'}).svc,actor,'category','custom_fees')).rejects.toThrow('could not be verified')
 })
})
