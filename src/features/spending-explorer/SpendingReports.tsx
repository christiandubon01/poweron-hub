/** Complete evidence reader and Snapshot content for the EXISTING Explorer. No separate Reports application. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import type { ReportMode, ReportRow, ReportScope, SpendingReport } from '@/finance/bankSpendingReports'
import { useDisplayColors } from '@/features/display-colors/DisplayColors'
import { parentDisplayColor } from '@/features/display-colors/hierarchyColors'
import { SpendingBreakdown } from './snapshot/SpendingSnapshot'
import { projectReport } from './reportProjection'
import { usd2 } from './format'
import { btn, btnQuiet, eyebrow } from './ui'

export const REPORT_SCOPES: Array<{ key:ReportMode; label:string }> = [{key:'all_money',label:'All Money Activity'},{key:'business',label:'Business Spending'},{key:'unassigned',label:'Unassigned Spending'}]
export async function requestReport(mode: ReportMode, scope: ReportScope): Promise<SpendingReport> {
  const q = new URLSearchParams({ report: mode, from: scope.from, to: scope.to, accounts: scope.accounts })
  if (scope.account) q.set('account',scope.account)
  const res=await fetch(`/.netlify/functions/plaid-spending?${q}`,{headers:await authedJsonHeaders()})
  if (!res.ok) throw new Error('Complete evidence could not be loaded. Totals are unavailable.')
  const r=await res.json() as SpendingReport
  if (r.mode!==mode || r.scope.from!==scope.from || r.scope.to!==scope.to || r.scope.accounts!==scope.accounts || (r.scope.account ?? '')!==(scope.account ?? '')) throw new Error('Evidence scope could not be verified. Totals are unavailable.')
  return r
}
export function useSpendingReport(mode:ReportMode | null,scope:ReportScope,revision:number) {
  const key=JSON.stringify([mode,scope.from,scope.to,scope.accounts,scope.account,revision])
  const [result,setResult]=useState<{key:string;report?:SpendingReport;error?:string} | null>(null)
  const seq=useRef(0)
  useEffect(()=>{
    const mine=++seq.current
    if (!mode) return
    requestReport(mode,scope).then(report=>{if(mine===seq.current)setResult({key,report})}).catch(e=>{if(mine===seq.current)setResult({key,error:e.message})})
    return ()=>{seq.current++}
    // scope is represented by key; environment is server-owned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key])
  return result?.key===key ? {report:result.report ?? null,error:result.error ?? null} : {report:null,error:null}
}
export function ReportView({report,renderRow,onMode}: {report:SpendingReport;renderRow:(row:ReportRow)=>ReactNode;onMode?:(mode:ReportMode)=>void}) {
  const [parent,setParent]=useState<string | null>(null),[leaf,setLeaf]=useState<string | null>(null),[metric,setMetric]=useState<'outMinor'|'inMinor'>('outMinor')
  const [status,setStatus]=useState('all'),[limit,setLimit]=useState(100)
  const {categoryColor}=useDisplayColors()
  useEffect(()=>{setParent(null);setLeaf(null);setStatus('all');setLimit(100);setMetric('outMinor')},[report])
  const visible=useMemo(()=>projectReport(report,r=>status==='all' || status==='ignored' && r.review==='ignored' || status==='pending' && r.pending || status==='removed' && r.removed || status==='posted' && !r.pending && !r.removed),[report,status])
  const selected=visible.groups.find(g=>g.key===parent),child=selected?.children.find(c=>c.key===leaf)
  const groups=parent ? selected?.children ?? [] : visible.groups
  const total=selected?.[metric] ?? visible.summary?.[metric] ?? 0
  const rows=visible.rows.filter(r=>(!parent || r.reportParent===parent) && (!leaf || r.reportLeaf===leaf))
  const summary=visible.summary
  const title=REPORT_SCOPES.find(m=>m.key===report.mode)!.label
  const neutral='var(--text-muted)'
  return <div className="mt-3 space-y-3" data-testid="explorer-population">
    {onMode && <nav className="flex flex-wrap gap-2" aria-label="Reporting perspective">{REPORT_SCOPES.map(m=><button key={m.key} className={btn} aria-pressed={report.mode===m.key} onClick={()=>onMode(m.key)}>{m.label}</button>)}</nav>}
    <p className="text-xs text-[var(--text-secondary)]">{report.scope.from} — {report.scope.to} · {report.scope.accounts==='all'?'All connected accounts':'Mapped accounts'}{report.scope.account?' · Selected account':''} · {report.scope.environment} · USD</p>
    {!visible.coverage.complete || !summary ? <p role="alert" className="rounded-xl border border-[var(--surface-line)] p-3">Incomplete coverage · {visible.coverage.reason ?? 'Totals could not be verified.'} No complete totals or composition are shown.</p> : <>
      <div data-testid="spending-snapshot" className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="col-span-2 min-w-0 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] px-3 py-2.5" data-testid="spending-headline"><p className={eyebrow}>{title} · gross money out</p><p className="text-[28px] font-semibold leading-9 tracking-[-0.01em] tabular-nums" data-testid="spending-total">{usd2(summary.outMinor)} <span className="text-sm font-normal text-[var(--text-secondary)]">· {summary.count} records · {summary.postedCount} posted</span></p></div>
          {report.mode==='all_money' && <div className="min-w-0 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] px-3 py-2.5"><p className={eyebrow}>Gross money in</p><p className="text-lg font-semibold tabular-nums">{usd2(summary.inMinor)}</p><p className="text-xs text-[var(--text-secondary)]">Refunds and transfers remain separate</p></div>}
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{report.mode==='all_money'?'Account cash movement, not consolidated economic spending. Transfers and debt are distinct; category names never verify relationships.':report.mode==='business'?'Gross business outflows from bank evidence, not canonical accounting or tax reporting. Refunds are separate in All Money Activity.':'Specialized Unassigned Spending population; established financial exclusions remain unchanged and suggestions remain suggestions.'}</p>
        {report.mode==='all_money' && <p className="text-xs text-[var(--text-secondary)]" data-testid="ignored-subtotal">Ignored Activity · {summary.ignoredCount} records · {summary.ignoredPostedCount} posted · Out {usd2(summary.ignoredOutMinor)} · In {usd2(summary.ignoredInMinor)}. Included above; do not add again.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1"><button className={btnQuiet} onClick={()=>{setParent(null);setLeaf(null);setLimit(100)}}>{report.mode==='all_money'?'All movement':'Parent buckets'}</button>{parent && <><span aria-hidden="true">›</span><button className={btnQuiet} onClick={()=>{setLeaf(null);setLimit(100)}}>{selected?.label ?? 'No matching parent'}</button></>}{child && <><span aria-hidden="true">›</span><span className="text-sm font-semibold">{child.label}</span></>}</div>
          {report.mode==='all_money' && <div className="flex gap-1"><button className={btn} aria-pressed={metric==='outMinor'} onClick={()=>setMetric('outMinor')}>Money out</button><button className={btn} aria-pressed={metric==='inMinor'} onClick={()=>setMetric('inMinor')}>Money in</button></div>}
        </div>
        <SpendingBreakdown buckets={groups.map(g=>({key:g.key,label:g.label,totalMinor:g[metric],count:g.count,color:parent ? g.key==='__ignored'||g.key==='__unclassified'?null:categoryColor(g.key) : g.key==='ignored'||g.key==='__unclassified'||g.key==='__no_parent'?neutral:parentDisplayColor(g.key,report.hierarchy,categoryColor)}))} total={total} selected={leaf ?? ''} denominator={selected?.label ?? title} label={parent?'Subcategories':'Parent-bucket composition'} testId="report-breakdown-group" onPick={key=>{if(parent)setLeaf(key || null);else setParent(key || null);setLimit(100)}} />
      </div>
      <div className="space-y-2" data-testid="report-drilldown">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{child?.label ?? selected?.label ?? title} · transactions</h4><label className="text-xs text-[var(--text-secondary)]">Evidence status <select value={status} onChange={e=>{setStatus(e.target.value);setLimit(100)}} className="min-h-[44px] rounded-xl bg-[var(--surface-1)] px-2 ring-1 ring-[var(--border-primary)]"><option value="all">All evidence</option><option value="posted">Posted</option><option value="ignored">Ignored</option><option value="pending">Pending</option><option value="removed">Removed</option></select></label></div>
        <p className="text-xs text-[var(--text-secondary)]">{rows.length} matching records · showing {Math.min(limit,rows.length)} · Posted out {usd2(rows.filter(r=>!r.pending && !r.removed).reduce((n,r)=>n+Math.max(0,r.amountMinor),0))} · In {usd2(rows.filter(r=>!r.pending && !r.removed).reduce((n,r)=>n+Math.max(0,-r.amountMinor),0))}</p>
        <p className="text-xs text-[var(--text-secondary)]">Pending {summary.pendingCount} · Removed {summary.removedCount} · Relationships unresolved {summary.unresolvedCount}. Pending and removed records contribute no posted amount.</p>
        {rows.length ? <ul className="space-y-1.5" data-testid="spending-list">{rows.slice(0,limit).map(renderRow)}</ul> : <p className="text-sm text-[var(--text-secondary)]">No transactions match this scope.</p>}
        {limit<rows.length && <button className={btn} onClick={()=>setLimit(n=>n+100)}>Show next 100 records</button>}
      </div>
    </>}
  </div>
}
