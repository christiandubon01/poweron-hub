/** Related evidence and explicit category-only edits. No rules, relationship decisions or ledger writes. */
import { BankConnectionError, UUID, assertAuthority, type BankActor } from '../bankConnectionService'
import { explorerFromContext, parseQuery, type SpendingDeps } from './spendingService'
import { filterRows } from './explorer'
import { APPROVED_REPORTING_POLICY, buildSpendingReport, REPORT_MODES, type ReportMode } from './reporting'
import { canAssign, defaultHierarchy } from './hierarchy'
import { bucketFitsDirection } from './taxonomy'
import { descriptionIdentity, merchantIdentity, type RelatedResult, type CategoryRevision, type CategorySelection, type CategoryPreview, type CategoryBatchResult } from '../../../finance/relatedTransactions'
const bad=(s:string)=>new BankConnectionError('invalid_request',400,s)
export async function relatedTransactions(deps:SpendingDeps,actor:BankActor,raw:Record<string,unknown>):Promise<RelatedResult> {
  assertAuthority(actor)
  if(typeof raw.related!=='string'||!UUID.test(raw.related))throw bad('Choose a transaction.')
  const historical=raw.historical==='1', grouping=raw.match==='description'?'description':'merchant'
  const asOf=new Date((deps.now??Date.now)()).toISOString().slice(0,10)
  if(raw.account && (typeof raw.account!=='string'||!UUID.test(raw.account)))throw bad('Choose a valid account.')
  for(const key of ['from','to'])if(raw[key] && (typeof raw[key]!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw[key] as string)||Number.isNaN(Date.parse(raw[key] as string))||new Date(raw[key] as string).toISOString().slice(0,10)!==raw[key]))throw bad('Choose valid dates.')
  const parsed={...raw,...Object.fromEntries(['minMinor','maxMinor'].filter(k=>raw[k]!==undefined&&raw[k]!=='').map(k=>[k,Number(raw[k])]))}
  const q=parseQuery(parsed), from=historical?'1900-01-01':q.from ?? asOf,to=historical?asOf:q.to ?? asOf
  if(from>to)throw bad('Choose a valid date range.')
  const scope={from,to,accounts:q.accounts ?? 'mapped',account:q.account,environment:deps.environment ?? 'sandbox'}
  const empty:RelatedResult={rows:[],complete:false,reason:'Complete history is unavailable.',total:null,identity:'',grouping,historical,from,to,accounts:scope.accounts,account:scope.account,hierarchy:defaultHierarchy(),batchAvailable:false}
  if(!deps.repo.loadReportContext)return empty
  const ctx=await deps.repo.loadReportContext(actor.organizationId,from)
  const h=ctx.hierarchy??defaultHierarchy(), seed=ctx.txs.find(t=>t.id===raw.related)
  if(!seed)throw new BankConnectionError('not_found',404,'Transaction not found in this date/account environment.')
  if(grouping==='description'&&!seed.name?.trim())return {...empty,hierarchy:h,reason:'The bank supplied no description to match.'}
  const identity=grouping==='description'?descriptionIdentity(seed.name??''):merchantIdentity(seed.merchantName)
  if(!identity) return {...empty,hierarchy:h,reason:'The bank supplied no merchant name. Choose the explicit description grouping instead.'}
  const all=explorerFromContext(ctx,asOf,'all',scope.environment,true).rows
  if(!all.some(r=>r.id===seed.id && (scope.accounts==='all'||r.account.mapped) && (!scope.account||r.account.ref===scope.account)))throw new BankConnectionError('not_found',404,'Transaction is outside the authorized account/environment scope.')
  const mode=REPORT_MODES.includes(raw.population as ReportMode)?raw.population as ReportMode:'all_money'
  const report=buildSpendingReport(all,historical?'all_money':mode,scope,APPROVED_REPORTING_POLICY,ctx.reportCoverage??{complete:false,reason:'Coverage was not verified.'},h)
  if(!report.coverage.complete)return {...empty,identity,hierarchy:h,reason:report.coverage.reason}
  const evidence=new Map(ctx.txs.map(t=>[t.id,t]))
  const reportIds=new Set(report.rows.map(r=>r.id))
  let rows=all.filter(r=>reportIds.has(r.id))
  if(!historical)rows=filterRows(rows,{...parseQuery(parsed,h),view:raw.population==='review'?q.view:'all'})
  const allowedIds=new Set(rows.map(r=>r.id))
  const matches=report.rows.filter(r=>allowedIds.has(r.id) && (grouping==='description'?descriptionIdentity(evidence.get(r.id)?.name??'')===identity:merchantIdentity(evidence.get(r.id)?.merchantName)===identity)
    && (historical || !raw.parent || r.reportParent===raw.parent) && (historical || !raw.leaf || r.reportLeaf===raw.leaf)
    && (historical || raw.direction!=='in' && raw.direction!=='out' || raw.direction==='in' && r.amountMinor<0 || raw.direction==='out' && r.amountMinor>=0))
  const decisionsById=new Map<string,typeof ctx.decisions>()
  for(const d of ctx.decisions)if(d.status==='confirmed')decisionsById.set(d.txId,[...(decisionsById.get(d.txId)??[]),d])
  const resultRows=matches.map(r=>{
    const e=evidence.get(r.id)!, decisions=decisionsById.get(r.id)??[]
    const revision:CategoryRevision={category:decisions.find(d=>d.kind==='category')?.id??null,relationship:decisions.filter(d=>!['category','ignored'].includes(d.kind)).map(d=>d.id).sort(),ignored:decisions.find(d=>d.kind==='ignored')?.id??null,amountMinor:e.amountMinor,pending:e.pending,removed:e.removed,date:e.date,accountRef:e.providerAccountRef,name:e.name,merchantName:e.merchantName}
    return {...r,revision}
  })
  const result={...empty,identity,hierarchy:h,rows:resultRows,total:resultRows.length,complete:true,reason:null,batchAvailable:await deps.repo.checkedCategoryAvailable?.(actor.organizationId,actor.userId)??false}
  if(Buffer.byteLength(JSON.stringify(result))>4_500_000)return {...result,rows:[],total:null,complete:false,reason:'History exceeds the response safety limit. Narrow dates/accounts; no complete total is shown.'}
  return result
}
export async function previewCategoryBatch(deps:SpendingDeps,actor:BankActor,raw:Record<string,unknown>) {
  assertAuthority(actor)
  const input=raw.selection as CategorySelection[]
  if(!Array.isArray(input)||!input.length||input.length>100||new Set(input.map(x=>x?.id)).size!==input.length||input.some(x=>!UUID.test(x?.id??'')||!x.expected||typeof x.expected!=='object'))throw bad('Select 1–100 distinct transactions.')
  if(typeof raw.category!=='string')throw bad('Choose a leaf category.')
  const result=await relatedTransactions(deps,actor,(raw.query??{}) as Record<string,unknown>)
  if(!result.complete)throw new BankConnectionError('conflict',409,'Complete coverage is required. Narrow the scope and refresh.')
  if(!canAssign(raw.category,result.hierarchy))throw bad('Choose an active, permitted category.')
  const byId=new Map(result.rows.map(r=>[r.id,r]))
  const preview:CategoryPreview[]=input.map(s=>{
    const row=byId.get(s.id), reason=!row?'Outside matching scope':row.pending?'Pending':row.removed?'Removed':row.review==='ignored'?'Ignored':!bucketFitsDirection(raw.category as string,row.direction)?'Category does not fit direction':!(Object.keys(row.revision) as (keyof CategoryRevision)[]).every(k=>JSON.stringify(row.revision[k])===JSON.stringify(s.expected[k]) || k==='category' && row.bucket.state==='confirmed' && row.bucket.key===raw.category)?'Changed since selection; refresh and select again':null
    return {id:s.id,row,proposed:raw.category as string,eligible:!reason,reason}
  })
  return {preview,batchAvailable:result.batchAvailable,query:raw.query}
}
export async function confirmCategoryBatch(deps:SpendingDeps,actor:BankActor,raw:Record<string,unknown>) {
  if(raw.confirmed!==true)throw bad('Explicit confirmation is required.')
  const plan=await previewCategoryBatch(deps,actor,raw)
  if(!plan.batchAvailable||!deps.repo.replaceCategoryChecked)throw new BankConnectionError('conflict',409,'Concurrent-edit protection is not installed; category batch saving is unavailable.')
  const input=new Map((raw.selection as CategorySelection[]).map(x=>[x.id,x.expected])), results:CategoryBatchResult[]=[]
  for(const item of plan.preview){
    if(!item.eligible){results.push({id:item.id,outcome:'excluded',reason:item.reason??'Ineligible'});continue}
    try{const saved=await deps.repo.replaceCategoryChecked(actor.organizationId,actor.userId,item.id,item.proposed,input.get(item.id)!);results.push({id:item.id,outcome:saved.outcome})}
    catch(e){results.push({id:item.id,outcome:e instanceof BankConnectionError&&e.code==='conflict'?'conflict':'failed',reason:'Not saved. Refresh and preview this record again.'})}
  }
  return {results,atomicity:'Each eligible transaction replaces only its category atomically. The batch can partially succeed; no relationships or rules are changed.'}
}
