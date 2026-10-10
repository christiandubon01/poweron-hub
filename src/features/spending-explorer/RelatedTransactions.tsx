import { useEffect, useRef, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import type { CategoryBatchResult, CategoryPreview, RelatedResult, RelatedRow } from '@/finance/relatedTransactions'
import { categoryOptions } from '@/finance/bankSpendingHierarchy'
import { HierarchyProvider } from './HierarchyProvider'
import { BucketPicker } from './BucketPicker'
import { TransactionRow } from './TransactionRow'
import { CategoryPill } from '@/features/display-colors/DisplayColors'
import type { ExplorerRow, Options } from './useSpendingExplorer'
import { useSpendingExplorer } from './useSpendingExplorer'
import { usd2, withMask } from './format'
import { btn, btnPrimary } from './ui'
export async function relatedRequest(query:Record<string,string>,body?:object) {
  const headers=await authedJsonHeaders()
  const response=await fetch(`/.netlify/functions/plaid-spending${body?'':`?${new URLSearchParams(Object.fromEntries(Object.entries(query).filter(([,value])=>typeof value==='string' && value!=='')))}`}`,{headers, ...(body?{method:'POST',body:JSON.stringify(body)}:{})})
  const result=await response.json()
  if(!response.ok)throw new Error(result.error??'Could not load or save. Refresh and preview again.')
  return result
}
const ineligible=(r:RelatedRow)=>r.removed?'Removed':r.pending?'Pending':r.review==='ignored'?'Ignored':null
export function RelatedTransactions({seed,scope,options,onClose,onDecide,loadHistory,onChanged,onBusyChange}:{onBusyChange?:(busy:boolean)=>void;seed:ExplorerRow;scope:Record<string,string>;options:Options;onClose:()=>void;onDecide:ReturnType<typeof useSpendingExplorer>['decide'];loadHistory:ReturnType<typeof useSpendingExplorer>['loadHistory'];onChanged:()=>void}) {
  const [grouping,setGrouping]=useState<'merchant'|'description'>('merchant'),[historical,setHistorical]=useState(false),[revision,setRevision]=useState(0)
  const [data,setData]=useState<RelatedResult|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState<Map<string,RelatedRow>>(new Map()),[limit,setLimit]=useState(50)
  const [picking,setPicking]=useState(false),[category,setCategory]=useState(''),[preview,setPreview]=useState<CategoryPreview[]|null>(null),[busy,setBusy]=useState(false),[results,setResults]=useState<CategoryBatchResult[]|null>(null)
  const query={...scope,related:seed.id,match:grouping,historical:historical?'1':'0'},key=JSON.stringify(query),sequence=useRef(0),panel=useRef<HTMLElement>(null)
  useEffect(()=>{const seq=++sequence.current;setData(null);setSelected(new Map());setPreview(null);setCategory('');setLimit(50);setError('')
    relatedRequest(query).then(r=>{if(!r?.hierarchy||!Array.isArray(r.rows)||typeof r.complete!=='boolean')throw new Error('Matching coverage could not be verified.');if(seq===sequence.current)setData(r)}).catch(e=>{if(seq===sequence.current)setError(e.message)})
    return()=>{sequence.current++}
    // All scope fields are represented in key; old responses never enter a new selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,revision])
  useEffect(()=>{panel.current?.focus()},[])
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false)},[busy,onBusyChange])
  const choices=data?categoryOptions(data.hierarchy):options.buckets,chosen=Array.from(selected.values()),visible=data?.rows.slice(0,limit)??[]
  const selection=chosen.map(r=>({id:r.id,expected:r.revision})),excluded=data?.rows.filter(ineligible)??[]
  const toggle=(r:RelatedRow)=>{if(busy)return;setPreview(null);setSelected(old=>{const next=new Map(old);if(next.has(r.id))next.delete(r.id);else if(next.size<100)next.set(r.id,r);return next})}
  const review=async()=>{setBusy(true);setError('');try{const p=await relatedRequest(query,{action:'preview_categories',query,selection,category});setPreview(p.preview);if(data)setData({...data,batchAvailable:p.batchAvailable})}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  const save=async()=>{if(!preview||!data?.batchAvailable)return;setBusy(true);setError('');try{const out=await relatedRequest(query,{action:'confirm_categories',query,selection,category,confirmed:true});setResults(out.results);setPreview(null);setSelected(new Map());setRevision(n=>n+1)}catch(e){setError(`${(e as Error).message} The response may be uncertain. Refresh and preview again; do not assume all records saved.`)}finally{setBusy(false)}}
  return <section ref={panel} tabIndex={-1} className="mt-3 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] p-3 sm:p-4" data-testid="related-transactions" aria-label="Related transactions">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Related transactions · {seed.merchant}</h3><button className={btn} disabled={busy} onClick={onClose}>Close related transactions</button></div>
    <div className="mt-2 flex flex-wrap gap-2"><button className={grouping==='merchant'?btnPrimary:btn} disabled={busy} aria-pressed={grouping==='merchant'} onClick={()=>setGrouping('merchant')}>Bank merchant name</button><button className={grouping==='description'?btnPrimary:btn} disabled={busy} aria-pressed={grouping==='description'} onClick={()=>setGrouping('description')}>Bank description pattern</button></div>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">Merchant grouping uses the bank-provided merchant name, not the account or a Smart Review rule. Description grouping is explicit: a fee family or the exact description. Different merchants can share a name; verify the records before selecting.</p>
    <div className="mt-2 flex flex-wrap gap-2"><button className={!historical?btnPrimary:btn} disabled={busy} onClick={()=>setHistorical(false)}>Current Explorer scope</button><button className={historical?btnPrimary:btn} disabled={busy} onClick={()=>setHistorical(true)}>All matching history in these accounts</button></div>
    <p className="mt-1 text-xs text-[var(--text-secondary)]">{historical?'Broader scope: all dates and both directions; spending population, search, category and parent/leaf filters are lifted. Selected account scope and server environment remain unchanged.':'Uses current dates, accounts, spending population, search, filters and parent/leaf selection.'}</p>
    {error&&<p role="alert" className="mt-2 text-sm">{error}</p>}
    {!data&&!error&&<p className="mt-2">Loading matching bank records…</p>}
    {data&&<HierarchyProvider value={data.hierarchy} onChanged={()=>setRevision(n=>n+1)}>
      <p className="mt-2 text-sm font-semibold">{data.identity} · {data.from} — {data.to} · {data.accounts==='all'?'All connected accounts':'Mapped accounts'}{data.account?' · Selected account':''}</p>
      {!data.complete?<p role="alert" className="mt-2">Incomplete coverage · {data.reason} No complete matching count, total or batch changes are available.</p>:<>
        <p className="mt-2 text-sm" data-testid="related-selection-summary">{data.total} matching · {visible.length} visible · {selected.size} selected · Selected gross movement {usd2(chosen.reduce((n,r)=>n+Math.abs(r.amountMinor),0))} (out {usd2(chosen.reduce((n,r)=>n+Math.max(0,r.amountMinor),0))}, in {usd2(chosen.reduce((n,r)=>n+Math.max(0,-r.amountMinor),0))})</p>
        <div className="mt-2 flex flex-wrap gap-2"><button className={btn} disabled={busy||new Set([...selected.keys(),...visible.filter(r=>!ineligible(r)).map(r=>r.id)]).size>100} data-testid="related-select-all" onClick={()=>{setPreview(null);setSelected(old=>{const next=new Map(old);for(const r of visible)if(!ineligible(r)&&next.size<100)next.set(r.id,r);return next})}}>Select all visible eligible</button><button className={btn} disabled={busy} onClick={()=>{setSelected(new Map());setPreview(null)}}>Clear selection</button><button className={btn} disabled={busy||!selected.size} onClick={()=>setPicking(true)}>Choose category</button></div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">At most 100 selected per explicit save. Pending, removed and ignored records are ineligible. No future transactions or merchant rules are changed.</p>
        {!data.batchAvailable&&<p className="mt-2 text-sm" data-testid="related-write-gate">Related browsing and preview are available. Batch saving awaits installation of the reviewed concurrent-edit protection function.</p>}
        {category&&<div className="mt-2 flex flex-wrap items-center gap-2"><CategoryPill categoryKey={category} label={choices.find(c=>c.key===category)?.label??category} state="draft"/><span className="text-xs">Proposed only · nothing saved</span><button className={btn} disabled={busy||!selected.size} onClick={()=>void review()}>Preview exact changes</button></div>}
        {preview&&<div className="mt-3 rounded-xl border border-[var(--surface-line)] p-3" data-testid="related-preview"><h4 className="font-semibold">Review category changes · {preview.filter(p=>p.eligible).length} eligible · {preview.filter(p=>!p.eligible).length} excluded</h4><p className="mt-1 text-xs">Expected: {preview.filter(p=>p.eligible && (p.row?.bucket.state!=='confirmed' || p.row?.bucket.key!==p.proposed)).length} categories changed or confirmed · {preview.filter(p=>p.eligible && p.row?.bucket.state==='confirmed' && p.row?.bucket.key===p.proposed).length} already match.</p>
          <ul className="mt-2 space-y-2">{preview.map(p=>{const r=p.row??selected.get(p.id);return <li key={p.id} className="rounded-xl bg-[var(--surface-2)] p-2 text-sm">{r?.date} · {r?.merchant??p.id} · {r&&`${r.amountMinor<0?'Money In':'Money Out'} ${usd2(r.amountMinor)}`} · {r&&withMask(r.account.mappedTo??r.account.label,r.account.mask)}<br/>Current: {r?.bucket.label??'No category'} ({r?.bucket.state??'unavailable'}) → Proposed: {choices.find(c=>c.key===p.proposed)?.label??p.proposed}<br/>Financial link: {r?.relationship.label??'Unavailable'} · {r?.relationship.state??'unavailable'}{r?.relationship.target?.label?` · ${r.relationship.target.label}`:''} · unchanged{p.reason&&<p>Excluded: {p.reason}</p>}</li>})}</ul>
          {!!excluded.length&&<details className="mt-2 text-xs"><summary className="min-h-[44px] cursor-pointer py-3">{excluded.length} matching records excluded from selection</summary><ul>{excluded.map(r=><li key={r.id}>{r.date} · {r.merchant} · {usd2(r.amountMinor)} · {ineligible(r)}</li>)}</ul></details>}
          <p className="mt-2 text-xs">Only the listed eligible categories change. Unresolved financial links remain unresolved. Each record saves atomically; the batch may partially succeed.</p>
          <div className="mt-2 flex flex-wrap gap-2"><button className={btn} disabled={busy} onClick={()=>setPreview(null)}>Back to selection</button><button className={btnPrimary} disabled={busy||!data.batchAvailable||!preview.some(p=>p.eligible)} onClick={()=>void save()}>Confirm category changes</button></div>
        </div>}
        <ul className="mt-3 space-y-2">{visible.map(r=><TransactionRow key={r.id} row={r} options={{...options,buckets:choices}} busy={busy||!!r.removed} environment={r.account.environment??undefined} onDecide={async body=>{await onDecide(body);setRevision(n=>n+1)}} loadHistory={loadHistory} selectionLabel={`Select ${r.merchant} for category change`} selectable={!ineligible(r)} selected={selected.has(r.id)} onToggle={()=>toggle(r)} reviewedView/>)}</ul>
        {visible.length<data.rows.length&&<button className={`${btn} mt-2`} disabled={busy} onClick={()=>setLimit(n=>n+50)}>Show next 50 matching records</button>}
        <BucketPicker open={picking} options={choices} currentKey={category||null} onApply={key=>{setCategory(key);setPreview(null);setPicking(false)}} onClose={()=>setPicking(false)} busy={busy} title="Category for selected transactions" idleNote="This is only a proposed category. Preview, then explicitly confirm to save."/>
      </>}
    </HierarchyProvider>}
    {results&&<div role="status" className="mt-3" data-testid="related-results"><p>Save results · {results.filter(r=>['created','changed','unchanged'].includes(r.outcome)).length} saved or already matching · {results.filter(r=>['failed','conflict','excluded'].includes(r.outcome)).length} not saved. Refresh, select remaining records and preview again to retry. Close this panel to refresh Explorer totals.</p><ul className="text-xs">{results.map(r=><li key={r.id}>{r.id} · {r.outcome}{r.reason?` · ${r.reason}`:''}</li>)}</ul></div>}
  </section>
}
