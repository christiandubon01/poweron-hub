/** Local Vite preview only. No production route or live data. Uses the actual BANK-6G components. */
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import { TransactionRow } from '../../src/features/spending-explorer/TransactionRow'
import SpendingExplorer from '../../src/features/spending-explorer/SpendingExplorer'
import { HierarchyManager } from '../../src/features/spending-explorer/HierarchyManager'
import { HierarchyProvider, type DefinitionSave } from '../../src/features/spending-explorer/HierarchyProvider'
import { BucketPicker } from '../../src/features/spending-explorer/BucketPicker'
import SmartReview from '../../src/features/spending-explorer/SmartReview'
import { DisplayColorsProvider } from '../../src/features/display-colors/DisplayColors'
import { categoryOptions, defaultHierarchy } from '../../src/services/bankProvider/spending/hierarchy'
import { APPROVED_REPORTING_POLICY, buildSpendingReport, type ReportMode } from '../../src/services/bankProvider/spending/reporting'
import type { ExplorerRow } from '../../src/services/bankProvider/spending/types'

const h = { ...defaultHierarchy(), available:true,writesEnabled:true }
h.parents = h.parents.filter(p=>['vehicle','overhead','materials'].includes(p.key)).map((p,i)=>({...p,color:['#2f8fcf','#7f68d6','#c0652f'][i]}))
h.categories.push({key:'custom_maintenance',name:'Maintenance',parentKey:'vehicle',builtin:false,archived:false},{key:'custom_shop_supplies',name:'Shop Supplies',parentKey:'materials',builtin:false,archived:false})
const rows:ExplorerRow[] = [
  ['WELLS FARGO MONTHLY SERVICE FEE',1500,'bank_finance_fees'],['ADOBE SOFTWARE',5999,'software_subscriptions'],['OFFICE DEPOT',18400,'office_admin'],
  ['CHEVRON',6210,'fuel_vehicle'],['AUTO MAINTENANCE',24500,'custom_maintenance'],['HOME DEPOT',68500,'materials'],['SHOP SUPPLIES',19400,'custom_shop_supplies'],
  ['IGNORED BANK FEE',800,'bank_finance_fees'],['PURCHASE REFUND',-4200,'refund'],['CUSTOMER DEPOSIT',-150000,'customer_payment'],['INTERNAL TRANSFER',30000,'transfers'],['TRANSFER RECEIVED',-30000,'transfers'],['PENDING PURCHASE',4300,'materials'],['PERSONAL PURCHASE',8500,'owner_draw'],['DEBT REPAYMENT',50000,'other_needs_review'],
].map(([merchant,amount,key],i)=>({ id:`sample_${i}`,date:'2026-10-09',name:String(merchant),merchant:String(merchant),merchantKey:String(merchant),amountMinor:Number(amount),direction:Number(amount)>0?'money_out':'money_in',pending:i===12,
  account:{ref:'sample-account',label:'Wells Fargo Business Checking',mask:'6960',ownership:'business',mappedTo:'Business Checking',mapped:true,environment:'sandbox',financialAccountId:null},
  bucket:{key:String(key),label:String(key),state:'confirmed',confidence:'high',reasons:[]},relationship:i===14?{kind:'debt',label:'Debt repayment',target:{type:'debt_account',id:'synthetic-debt',label:'Synthetic debt'},state:'confirmed',confidence:'high',reasons:[]}:i===10||i===11?{kind:'transfer',label:'Transfer',target:{type:'counterpart_tx',id:`sample_${i===10?11:10}`,label:null},state:'confirmed',confidence:'high',reasons:[]}:{kind:'unknown',label:'Unknown',target:null,state:'none',confidence:null,reasons:[]},
  review:i===7?'ignored':'confirmed',scope:{value:i===13?'personal':'business',source:'account'},unassigned:i<7,repeatedPattern:false,pattern:null }))
const smartPayload=()=>({ asOf:'2026-10-09',accounts:'mapped',environment:'sandbox',hierarchy:h,rulesAvailable:true,maxBatch:100,merchantRules:[],draftScope:'bank6g-local-preview',
  groups:[{id:'CHEVRON|fuel_vehicle',merchantKey:'CHEVRON',merchant:'CHEVRON',bucket:{key:'fuel_vehicle',label:'Fuel / Vehicle'},confidence:'high',basis:'merchant_rule',needsChoice:false,mixed:false,count:3,totalMinor:18710,flaggedCount:0,reasons:['The merchant looks like a fuel / vehicle merchant.'],rows:[{id:'fuel_one',date:'2026-10-09',name:'CHEVRON 0098',amountMinor:6210,flags:[]},{id:'fuel_two',date:'2026-10-08',name:'CHEVRON 0098',amountMinor:7400,flags:[]},{id:'fuel_three',date:'2026-10-07',name:'CHEVRON 0098',amountMinor:5100,flags:[]}]}],exceptions:[],totals:{groupedCount:3,groupedMinor:18710,groups:1,exceptionCount:0},options:{buckets:categoryOptions(h),batchBuckets:categoryOptions(h).filter(c=>c.flow!=='in').map(c=>c.key)} })
const previewHierarchy=()=>({...h,writesEnabled:false})
const scopeFor=(q:URLSearchParams)=>({from:q.get('from')??'2026-07-12',to:q.get('to')??'2026-10-09',accounts:(q.get('accounts')??'mapped') as 'mapped'|'all',environment:'sandbox' as const,account:q.get('account')??undefined})
const explorerPayload=(q:URLSearchParams)=>{
  const scoped=rows.filter(r=>!r.removed && r.date>=scopeFor(q).from)
  const view=q.get('view')??'review_queue'
  const matches=(r:ExplorerRow)=>view==='review_queue'?r.review!=='confirmed' && r.review!=='ignored':view==='reviewed'?r.review==='confirmed':view==='unassigned'?r.unassigned:view==='known_bills'?r.relationship.kind==='debt':true
  const population=buildSpendingReport(scoped,'unassigned',scopeFor(q),APPROVED_REPORTING_POLICY,{complete:true,reason:null},previewHierarchy())
  const byBucket=population.groups.flatMap(p=>p.children).map(c=>({key:c.key,label:c.label,totalMinor:c.outMinor,count:c.count,previousMinor:0,deltaMinor:0,merchants:c.count,repeatedMerchants:0}))
  const filtered=scoped.filter(r=>matches(r) && (!q.get('bucket') || r.bucket.key===q.get('bucket')) && (!q.get('search') || r.merchant.toLowerCase().includes(q.get('search')!.toLowerCase())))
  return {asOf:'2026-10-09',accounts:scopeFor(q).accounts,environment:'sandbox',hierarchy:previewHierarchy(),coverage:{complete:true,reason:null},draftScope:'synthetic-only',rows:filtered,total:filtered.length,viewCounts:{all:scoped.length,reviewed:scoped.filter(r=>r.review==='confirmed').length,review_queue:scoped.filter(r=>r.review==='suggested'||r.review==='needs_review').length,unassigned:population.summary!.count,known_bills:1,repeated_spending:0,needs_review:0},reviewCounts:{reviewed:11,unreviewed:1,excluded:1},meta:{hiddenUnmapped:0,olderThanPeriod:0},options:{buckets:categoryOptions(h),batchBuckets:[],accounts:[{ref:'sample-account',label:'Synthetic checking',mask:'6960'}],obligations:[],commitments:[],debts:[],projects:[]},analytics:{asOf:'2026-10-09',windowDays:30,unassigned:{totalMinor:population.summary!.outMinor,count:population.summary!.count,previousMinor:0,deltaMinor:0,byBucket},knownBills:{totalMinor:0,count:0},pending:{totalMinor:4300,count:1},unclassified:{totalMinor:0,count:0},observations:[{id:'synthetic',text:'Synthetic evidence only. No live financial records.'}],suggestions:[]}}
}
window.fetch=async(input,init)=>{
  const url=String(input)
  if(!url.startsWith('/.netlify/functions/plaid-spending') || init?.method==='POST')throw new Error('Synthetic preview blocks external requests and transaction writes.')
  const q=new URL(url,window.location.origin).searchParams
  const payload=q.get('smart')==='1'?{...smartPayload(),hierarchy:previewHierarchy()}:q.has('history')?{history:[]}:q.has('report')?buildSpendingReport(rows,q.get('report') as ReportMode,scopeFor(q),APPROVED_REPORTING_POLICY,{complete:true,reason:null},previewHierarchy()):explorerPayload(q)
  return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}})
}
const save:DefinitionSave=async edit=>{
  const key=edit.key??`custom_preview_${String.fromCharCode(97+h.categories.length%26)}`
  if(edit.type==='category') { const old=h.categories.find(c=>c.key===key),value={key,name:edit.name,parentKey:edit.parentKey??null,builtin:old?.builtin??false,archived:edit.archived??false};if(old)Object.assign(old,value);else h.categories.push(value) }
  else { const old=h.parents.find(p=>p.key===key),value={key,name:edit.name,color:edit.color??null,archived:edit.archived??false};if(old)Object.assign(old,value);else h.parents.push(value) }
  return key
}
const store={load:async()=>({storage:'shared' as const,colors:{categories:{fuel_vehicle:'#2f8fcf',custom_maintenance:'#14998f',bank_finance_fees:'#7f68d6',materials:'#c0652f'},accounts:{}}}),set:async()=>({storage:'shared' as const})}
function Preview(){
  const [page,setPage]=useState('explorer'),[mode,setMode]=useState<ReportMode>('business'),[theme,setTheme]=useState('dark'),[picker,setPicker]=useState(false),[assigned,setAssigned]=useState<string | null>(null),[revision,setRevision]=useState(0)
  const report=buildSpendingReport(rows,mode,{from:'2026-10-01',to:'2026-10-09',accounts:'mapped',environment:'sandbox'},APPROVED_REPORTING_POLICY,{complete:true,reason:null},h)
  return <DisplayColorsProvider store={store}><main data-theme={theme} style={{minHeight:'100vh',background:'var(--bg-primary)',color:'var(--text-primary)',padding:32}}><div style={{maxWidth:1000,margin:'auto'}}>
    <p className="text-xs text-[var(--text-secondary)]">BANK-6G · Synthetic nonproduction preview · No live data or writes</p><h1 className="mt-2 text-2xl font-bold">Cash OS · Spending classifications</h1>
    <div className="my-4 flex flex-wrap gap-2">{['explorer','management','smart','transaction'].map(p=><button key={p} className="min-h-[44px] rounded-lg border border-[var(--border-primary)] px-4" onClick={()=>setPage(p)}>{p}</button>)}<button className="min-h-[44px] rounded-lg border border-[var(--border-primary)] px-4" onClick={()=>setTheme(t=>t==='dark'?'light':'dark')}>Switch theme</button></div>
    <HierarchyProvider key={`${page}:${revision}`} value={h} saveDefinition={save} onChanged={()=>setRevision(n=>n+1)}>
      {page==='explorer'?<SpendingExplorer/>:page==='management'?<HierarchyManager/>:page==='smart'?<SmartReview definitionSave={save}/>:<div className="rounded-xl border border-[var(--border-primary)] p-4"><h2 className="font-semibold">WELLS FARGO MONTHLY SERVICE FEE · −$15.00</h2><p className="mt-2 text-sm">Confirmed category: Bank / Finance Fees</p><button className="mt-4 min-h-[44px] rounded-lg border border-[var(--border-primary)] px-4" onClick={()=>setPicker(true)}>Change category</button>{assigned&&<p>Preview assignment: {assigned}</p>}<BucketPicker open={picker} options={categoryOptions(h)} currentKey="bank_finance_fees" onClose={()=>setPicker(false)} onApply={key=>{setAssigned(key);setPicker(false)}}/></div>}
    </HierarchyProvider>
  </div></main></DisplayColorsProvider>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
