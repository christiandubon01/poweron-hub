import { useEffect, useRef, useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import type { ReportMode, ReportScope, SpendingReport } from '@/finance/bankSpendingReports'
import { categoryName } from '@/finance/bankSpendingHierarchy'
import { ColorsPanel, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { HierarchyProvider } from './HierarchyProvider'
import { HierarchyManager } from './HierarchyManager'
import { btn } from './ui'

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100)
const MODES: Array<{ key: ReportMode; label: string }> = [{ key: 'all_money', label: 'All Money Activity' }, { key: 'business', label: 'Business Spending' }, { key: 'unassigned', label: 'Unassigned Spending' }]
export async function requestReport(mode: ReportMode, scope: ReportScope): Promise<SpendingReport> {
  const q = new URLSearchParams({ report: mode, from: scope.from, to: scope.to, accounts: scope.accounts })
  if (scope.account) q.set('account', scope.account)
  const res = await fetch(`/.netlify/functions/plaid-spending?${q}`, { headers: await authedJsonHeaders() })
  if (!res.ok) throw new Error('Report could not be loaded. No complete totals are available.')
  return res.json()
}
export function ReportView({ report, onMode }: { report: SpendingReport; onMode?: (mode: ReportMode) => void }) {
  const [parent, setParent] = useState<string | null>(null), [leaf, setLeaf] = useState<string | null>(null), [metric, setMetric] = useState<'outMinor' | 'inMinor'>('outMinor')
  const [status, setStatus] = useState('all'), [limit, setLimit] = useState(100)
  const colors = useDisplayColors()
  useEffect(() => { setParent(null); setLeaf(null); setStatus('all'); setLimit(100) }, [report])
  const selected = report.groups.find(g => g.key === parent), child = selected?.children.find(c => c.key === leaf)
  const groups = selected ? selected.children : report.groups
  const total = selected?.[metric] ?? report.summary?.[metric] ?? 0
  const rows = report.rows.filter(r => (!parent || r.reportParent === parent) && (!leaf || r.reportLeaf === leaf) &&
    (status === 'all' || status === 'ignored' && r.review === 'ignored' || status === 'pending' && r.pending || status === 'removed' && r.removed || status === 'posted' && !r.pending && !r.removed))
  const summary = report.summary
  return <section className="mt-4 space-y-4" aria-label="Bank spending reports" data-testid="spending-reports">
    <nav className="flex flex-wrap gap-2" aria-label="Reporting perspective">{MODES.map(m => <button key={m.key} type="button" className={btn} aria-pressed={report.mode === m.key} onClick={() => onMode?.(m.key)}>{m.label}</button>)}</nav>
    <p className="text-xs text-[var(--text-secondary)]">{report.scope.from} — {report.scope.to} · {report.scope.accounts === 'all' ? 'All connected accounts' : 'Mapped accounts'}{report.scope.account ? ' · Selected account' : ''} · {report.scope.environment} · USD</p>
    <p className="text-sm text-[var(--text-secondary)]">{report.mode === 'all_money' ? 'Account cash movement includes transfers and ignored activity. It is not consolidated economic spending.' : report.mode === 'business' ? 'Gross business outflows from bank evidence, not canonical accounting or tax reporting. Account ownership provides context; financial relationships require their own owner decision. Refunds are shown separately in All Money Activity.' : 'Specialized Unassigned Spending population with its established exclusions. Its suggested categories remain suggestions.'}</p>
    {!report.coverage.complete || !summary ? <p role="alert" className="rounded-xl border border-[var(--border-primary)] p-4">Incomplete coverage · {report.coverage.reason ?? 'Totals could not be verified.'} No complete totals or composition are shown.</p> : <>
      <div className="grid gap-3 sm:grid-cols-3">{[['Gross outflows', money(summary.outMinor)], ['Gross inflows', money(summary.inMinor)], ['Evidence', `${summary.count} records · ${summary.postedCount} posted`]].map(([label,value]) => <div key={label} className="rounded-xl border border-[var(--border-primary)] bg-[var(--surface-1)] p-4"><p className="text-xs text-[var(--text-secondary)]">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}</div>
      {report.mode === 'all_money' && <div className="rounded-xl border border-[var(--border-primary)] p-3" data-testid="ignored-subtotal"><p className="font-semibold">Ignored Activity · {summary.ignoredCount} records · {summary.ignoredPostedCount} posted</p><p className="text-sm">Out {money(summary.ignoredOutMinor)} · In {money(summary.ignoredInMinor)}. Included in gross totals above; do not add again.</p></div>}
      <p className="text-xs text-[var(--text-secondary)]">Pending: {summary.pendingCount} · Removed: {summary.removedCount} · Relationships unresolved: {summary.unresolvedCount}. Pending and removed records contribute no posted amount.</p>
      <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-1)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{selected ? selected.label : report.mode === 'all_money' ? 'Cash movement composition' : 'Parent-bucket composition'}</h3><div className="flex gap-2"><button className={btn} aria-pressed={metric === 'outMinor'} onClick={() => setMetric('outMinor')}>Money out</button><button className={btn} aria-pressed={metric === 'inMinor'} onClick={() => setMetric('inMinor')}>Money in</button></div></div>
        {selected && <button className={`${btn} mt-2`} onClick={() => { setParent(null); setLeaf(null); setLimit(100) }}>← All groups</button>}
        <p className="mt-2 text-xs text-[var(--text-secondary)]">{money(total)} · {selected?.count ?? summary.count} evidence records · percentages use this {metric === 'outMinor' ? 'outflow' : 'inflow'} total</p>
        <div className="mt-3 space-y-2">{groups.map(g => {
          const pct = total ? g[metric] / total * 100 : 0
          const color = selected ? colors.categoryColor(g.key) : g.color
          return <button key={g.key} className="block min-h-[64px] w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] p-3 text-left" onClick={() => { if (selected) setLeaf(g.key); else { setParent(g.key); setLeaf(null) } setLimit(100) }} aria-pressed={leaf === g.key} data-testid="report-breakdown-group">
            <span className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{g.label}</span><span className="tabular-nums">{money(g[metric])} · {pct.toFixed(1)}% · {g.count} records</span></span>
            <span className="mt-2 block h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"><span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color ?? 'var(--text-secondary)' }} /></span>
          </button>
        })}{groups.length === 0 && <p>No eligible activity in this scope.</p>}</div>
      </div>
      <div className="space-y-2" data-testid="report-drilldown"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{child?.label ?? selected?.label ?? 'All scoped evidence'} · transactions</h3><label className="text-sm">Evidence status <select value={status} onChange={e => { setStatus(e.target.value); setLimit(100) }} className="min-h-[44px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2"><option value="all">All evidence</option><option value="posted">Posted</option><option value="ignored">Ignored</option><option value="pending">Pending</option><option value="removed">Removed</option></select></label></div>
        <p className="text-xs text-[var(--text-secondary)]">{rows.length} matching records · showing {Math.min(limit, rows.length)}. This drill-down uses the same complete evidence snapshot as the composition.</p>
        <ul className="space-y-2">{rows.slice(0,limit).map(r => <li key={r.id} className="rounded-xl border border-[var(--border-primary)] p-3"><div className="flex justify-between gap-3"><span className="font-semibold">{r.merchant}</span><span className="tabular-nums">{r.amountMinor > 0 ? '−' : '+'}{money(Math.abs(r.amountMinor))}</span></div><p className="text-xs text-[var(--text-secondary)]">{r.date} · {r.account.label}{r.account.mask ? ` · ${r.account.mask}` : ''}</p><p className="mt-1 text-xs">{r.review === 'ignored' ? 'Ignored · cash movement only, no expense allocation' : r.bucket.state === 'confirmed' ? categoryName(r.bucket.key, report.hierarchy) : 'Not classified · category not confirmed'}{r.pending ? ' · Pending' : ''}{r.removed ? ' · Removed' : ''}{r.unresolved ? ' · Relationship unresolved' : ''}{r.review !== 'ignored' && r.relationship.state === 'confirmed' ? ` · ${r.relationship.label}` : ''}</p></li>)}</ul>
        {limit < rows.length && <button className={btn} onClick={() => setLimit(n => n + 100)}>Show next 100 records</button>}
      </div>
    </>}
  </section>
}
export function SpendingReports({ initialScope, accountOptions = [] }: { initialScope: ReportScope; accountOptions?: Array<{ ref:string; label:string }> }) {
  const [mode, setMode] = useState<ReportMode>('business'), [scope,setScope] = useState(initialScope), [report,setReport] = useState<SpendingReport | null>(null)
  const [error,setError] = useState<string | null>(null), [revision,setRevision] = useState(0), [manage,setManage] = useState(false), [colors,setColors] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    const mine = ++seq.current; setReport(null); setError(null)
    requestReport(mode,scope).then(r => { if (mine === seq.current) setReport(r) }).catch(e => { if (mine === seq.current) setError(e.message) })
    return () => { seq.current++ }
  }, [mode,scope,revision])
  return <div className="mt-4"><div className="flex flex-wrap items-end gap-3">
    <label className="text-sm">Account scope<select value={scope.accounts} onChange={e => setScope({ ...scope,accounts:e.target.value as 'mapped' | 'all' })} className="block min-h-[44px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2"><option value="mapped">Mapped accounts</option><option value="all">All connected accounts</option></select></label>
    <label className="text-sm">Account<select value={scope.account ?? ''} onChange={e => setScope({ ...scope,account:e.target.value || undefined })} className="block min-h-[44px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2"><option value="">Every account in scope</option>{accountOptions.map(a => <option key={a.ref} value={a.ref}>{a.label}</option>)}</select></label>
    <label className="text-sm">From<input type="date" value={scope.from} onChange={e => setScope({ ...scope,from:e.target.value })} className="block min-h-[44px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2" /></label>
    <label className="text-sm">To<input type="date" value={scope.to} onChange={e => setScope({ ...scope,to:e.target.value })} className="block min-h-[44px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-card)] px-2" /></label>
    <button className={btn} onClick={() => setRevision(n => n+1)}>Refresh report</button><button className={btn} onClick={() => setManage(v => !v)}>Classification settings</button><button className={btn} onClick={() => setColors(v => !v)}>Colors</button>
  </div>{error ? <p role="alert" className="mt-3">{error}</p> : !report ? <p className="mt-3">Loading complete evidence…</p> : <HierarchyProvider value={report.hierarchy} onChanged={() => setRevision(n => n+1)}>
    <ReportView report={report} onMode={setMode} />{manage && <HierarchyManager />}{colors && <ColorsPanel categories={report.hierarchy.categories.map(c => ({ key:c.key,label:c.name }))} />}
  </HierarchyProvider>}</div>
}
