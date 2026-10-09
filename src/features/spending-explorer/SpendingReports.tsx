/** Complete evidence reader and Snapshot content for the EXISTING Explorer. No separate Reports application. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import type { ReportMode, ReportRow, ReportScope, SpendingReport } from '@/finance/bankSpendingReports'
import { useDisplayColors } from '@/features/display-colors/DisplayColors'
import { parentDisplayColor } from '@/features/display-colors/hierarchyColors'
import { SpendingBreakdown } from './snapshot/SpendingSnapshot'
import { projectReport } from './reportProjection'
import { usd2 } from './format'
import { btn, btnPrimary, btnQuiet, eyebrow } from './ui'

export const REPORT_SCOPES: Array<{ key:ReportMode; label:string }> = [{key:'all_money',label:'All Activity'},{key:'business',label:'Business Spending'},{key:'unassigned',label:'Unassigned Spending'}]
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
export function ReportView({report,renderRow,onMode,accountLabel}: {accountLabel?:string;report:SpendingReport;renderRow:(row:ReportRow)=>ReactNode;onMode?:(mode:ReportMode)=>void}) {
  const [parent,setParent]=useState<string | null>(null),[leaf,setLeaf]=useState<string | null>(null),[metric,setMetric]=useState<'outMinor'|'inMinor'>('outMinor')
  const [status,setStatus]=useState('all'),[limit,setLimit]=useState(100)
  const {categoryColor}=useDisplayColors()
  useEffect(()=>{setParent(null);setLeaf(null);setStatus('all');setLimit(100);setMetric('outMinor')},[report])
  const statusReport=useMemo(()=>projectReport(report,r=>status==='all' || status==='ignored' && r.review==='ignored' || status==='pending' && r.pending || status==='removed' && r.removed || status==='posted' && !r.pending && !r.removed),[report,status])
  const visible=useMemo(()=>projectReport(statusReport,r=>report.mode!=='all_money' || (metric==='inMinor'?r.amountMinor<0:r.amountMinor>=0)),[statusReport,metric,report.mode])
  const selected=visible.groups.find(g=>g.key===parent),child=selected?.children.find(c=>c.key===leaf)
  const groups=parent ? selected?.children ?? [] : visible.groups
  const total=selected?.[metric] ?? visible.summary?.[metric] ?? 0
  const rows=visible.rows.filter(r=>(!parent || r.reportParent===parent) && (!leaf || r.reportLeaf===leaf))
  const summary=visible.summary
  const title=REPORT_SCOPES.find(m=>m.key===report.mode)!.label
  const neutral='var(--text-muted)'
  return <div className="mt-3 space-y-3" data-testid="explorer-population">
    {onMode && <nav className="flex flex-wrap gap-2" aria-label="Reporting perspective">{REPORT_SCOPES.map(m=><button key={m.key} className={btn} aria-pressed={report.mode===m.key} onClick={()=>onMode(m.key)}>{m.label}</button>)}</nav>}
    <p className="rounded-xl bg-[var(--surface-1)] px-3 py-2 text-sm font-semibold" data-testid="report-date-account-scope">{report.scope.from} — {report.scope.to} · {report.scope.accounts==='all'?'All connected accounts':'Mapped accounts'}{report.scope.account?` · ${accountLabel ?? 'Selected account'}`:''} · {report.scope.environment} · USD</p>
    {!visible.coverage.complete || !summary ? <p role="alert" className="rounded-xl border border-[var(--surface-line)] p-3">Incomplete coverage · {visible.coverage.reason ?? 'Totals could not be verified.'} No complete totals or composition are shown.</p> : <>
      <div data-testid="spending-snapshot" className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="col-span-2 min-w-0 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] px-3 py-2.5" data-testid="spending-headline"><p className={eyebrow}>{title} · {metric==='inMinor'?'Money In':'Money Out'}</p><p className="text-[28px] font-semibold leading-9 tracking-[-0.01em] tabular-nums" data-testid="spending-total">{usd2(summary[metric])} <span className="text-sm font-normal text-[var(--text-secondary)]">· {summary.count} records · {summary.postedCount} posted</span></p></div>
          {report.mode==='all_money' && <div className="min-w-0 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] px-3 py-2.5"><p className={eyebrow}>{metric==='inMinor'?'Money Out':'Money In'} · whole scope</p><p className="text-lg font-semibold tabular-nums">{usd2(statusReport.summary?.[metric==='inMinor'?'outMinor':'inMinor'] ?? 0)}</p><p className="text-xs text-[var(--text-secondary)]">Refunds and transfers remain separate</p></div>}
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{report.mode==='all_money'?'Account cash movement, not consolidated economic spending. Transfers and debt are distinct; category names never verify relationships.':report.mode==='business'?'Gross business outflows from bank evidence, not canonical accounting or tax reporting. Refunds are separate in All Money Activity.':'Unassigned Spending is money out without a qualifying financial link. It is not the category-review queue; reviewed categories can still be unassigned.'}</p>
        {report.mode==='all_money' && <p className="text-xs text-[var(--text-secondary)]" data-testid="ignored-subtotal">Ignored Activity · {summary.ignoredCount} records · {summary.ignoredPostedCount} posted · Out {usd2(summary.ignoredOutMinor)} · In {usd2(summary.ignoredInMinor)}. Included above; do not add again.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <nav aria-label="Bucket breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1"><button className={btnQuiet} onClick={()=>{setParent(null);setLeaf(null);setLimit(100)}}>{report.mode==='all_money'?'All movement':'Parent buckets'}</button>{parent && <><span aria-hidden="true">›</span><button className={btnQuiet} onClick={()=>{setLeaf(null);setLimit(100)}}>{selected?.label ?? 'No matching parent'}</button></>}{child && <><span aria-hidden="true">›</span><span className="text-sm font-semibold">{child.label}</span></>}</nav>
          {report.mode==='all_money' && <div className="flex gap-1"><button className={metric==='outMinor'?btnPrimary:btn} aria-pressed={metric==='outMinor'} data-testid="report-direction-out" onClick={()=>{setMetric('outMinor');setParent(null);setLeaf(null);setLimit(100)}}>Money Out</button><button className={metric==='inMinor'?btnPrimary:btn} aria-pressed={metric==='inMinor'} data-testid="report-direction-in" onClick={()=>{setMetric('inMinor');setParent(null);setLeaf(null);setLimit(100)}}>Money In</button></div>}
        </div>
        {(parent || leaf) && <div className="flex flex-wrap gap-2"><button className={btn} data-testid="report-back" onClick={()=>{if(leaf)setLeaf(null);else setParent(null);setLimit(100)}}>Back</button><button className={btn} data-testid="report-clear-selection" onClick={()=>{setParent(null);setLeaf(null);setLimit(100)}}>Clear selection</button></div>}
        <details className="text-xs text-[var(--text-secondary)]"><summary className="min-h-[44px] cursor-pointer py-3">What do these totals include?</summary><p>Posted bank records only contribute amounts. Pending and removed records contribute no posted amount. Transfers are account movement, not extra expense; debt principal is not operating expense. Ignored activity is included once in All Activity only. A category does not verify a financial relationship. Unassigned Spending excludes qualifying bill, debt, payroll, project, transfer, overhead and personal links, plus pending and ignored activity. Business Spending includes eligible posted business outflows; suggested categories are not counted as confirmed classifications.</p></details>
        <SpendingBreakdown buckets={groups.map(g=>({key:g.key,label:g.label,totalMinor:g[metric],count:g.count,color:parent ? g.key==='__ignored'||g.key==='__unclassified'?null:categoryColor(g.key) : g.key==='ignored'||g.key==='__unclassified'||g.key==='__no_parent'?neutral:parentDisplayColor(g.key,report.hierarchy,categoryColor)}))} total={total} selected={leaf ?? ''} denominator={selected?.label ?? title} label={parent?'Subcategories':'Parent-bucket composition'} testId="report-breakdown-group" onPick={key=>{if(parent)setLeaf(key || null);else setParent(key || null);setLimit(100)}} />
      </div>
      <div className="space-y-2" data-testid="report-drilldown">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">{child?.label ?? selected?.label ?? title} · transactions</h4><label className="text-xs text-[var(--text-secondary)]">Transaction status <select value={status} onChange={e=>{setStatus(e.target.value);setLimit(100)}} className="min-h-[44px] rounded-xl bg-[var(--surface-1)] px-2 ring-1 ring-[var(--border-primary)]"><option value="all">All records</option><option value="posted">Posted</option><option value="ignored">Ignored</option><option value="pending">Pending</option><option value="removed">Removed</option></select></label></div>
        <p className="text-xs text-[var(--text-secondary)]">{title} · {metric==='inMinor'?'Money In':'Money Out'} · {rows.length} matching records · showing {Math.min(limit,rows.length)} · Posted out {usd2(rows.filter(r=>!r.pending && !r.removed).reduce((n,r)=>n+Math.max(0,r.amountMinor),0))} · In {usd2(rows.filter(r=>!r.pending && !r.removed).reduce((n,r)=>n+Math.max(0,-r.amountMinor),0))}</p>
        <p className="text-xs text-[var(--text-secondary)]">Pending {rows.filter(r=>r.pending).length} · Removed {rows.filter(r=>r.removed).length} · Category review pending {rows.filter(r=>r.bucket.state!=='confirmed' && r.review!=='ignored').length} · Financial links unresolved {rows.filter(r=>r.unresolved).length}. These counts can overlap. Pending and removed records contribute no posted amount.</p>
        {rows.length ? <ul className="space-y-1.5" data-testid="spending-list">{rows.slice(0,limit).map(renderRow)}</ul> : <p className="text-sm text-[var(--text-secondary)]">No transactions match this scope.</p>}
        {limit<rows.length && <button className={btn} onClick={()=>setLimit(n=>n+100)}>Show next 100 records</button>}
      </div>
    </>}
  </div>
}
