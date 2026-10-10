import { assertAuthority, BankConnectionError, type BankActor } from '../bankConnectionService'
import { DEFINITION_KEY } from '../../../finance/bankSpendingHierarchy'
import { loadSpendingHierarchy } from './hierarchy'

export interface CleanupPreview {
  definition: { key: string; name: string; builtin: boolean }; children: Array<{ key:string; name:string }>
  references: Array<{ table:string; id:string; category:string; status:string; provider_transaction_ref?:string }>
  counts: Record<string,number>; complete: boolean; executionAllowed: false; reason: string
}
/** Read-only inventory, never a deletion authorization. Includes historical/undone decisions and inactive rules. */
export async function previewDefinitionCleanup(svc: any, actor: BankActor, type: unknown, key: unknown): Promise<CleanupPreview> {
  assertAuthority(actor)
  if (!['parent','category'].includes(String(type)) || typeof key !== 'string' || !DEFINITION_KEY.test(key)) throw new BankConnectionError('invalid_request',400,'Choose a valid classification.')
  const h=await loadSpendingHierarchy(svc,actor.organizationId)
  const definition=(type==='parent'?h.parents:h.categories).find(d=>d.key===key)
  if(!definition || !h.available)throw new BankConnectionError('not_found',404,'Classification not found.')
  const children=type==='parent'?h.categories.filter(c=>c.parentKey===key):[]
  const keys=type==='parent'?children.map(c=>c.key):[key]
  const references:CleanupPreview['references']=[],counts:Record<string,number>={}
  let complete=true
  if(keys.length)for(const [table,columns] of [
    ['financial_provider_interpretations','id,category,status,provider_transaction_ref'],
    ['financial_provider_merchant_rules','id,category,status'],
  ]) {
    const {data,error,count}=await svc.from(table).select(columns,{count:'exact'}).eq('organization_id',actor.organizationId).in('category',keys).order('id',{ascending:true}).range(0,199)
    if(error || !Number.isSafeInteger(count))throw new Error('Reference inventory could not be verified. No cleanup is permitted.')
    counts[table]=count
    if(count>(data?.length??0))complete=false
    references.push(...(data??[]).map((r:any)=>({...r,table})))
  }
  return {definition:{key:definition.key,name:definition.name,builtin:'builtin' in definition&&definition.builtin},children:children.map(c=>({key:c.key,name:c.name})),references,counts,complete,executionAllowed:false,
    reason:'Read-only inventory of bank decisions and merchant rules across all dates and environments. Up to 200 records per table. Separate reads may change concurrently; eligibility is not established. Audit history and other references must be rechecked atomically by a reviewed cleanup SQL service. Execution awaits SQL and explicit owner approval.'}
}
