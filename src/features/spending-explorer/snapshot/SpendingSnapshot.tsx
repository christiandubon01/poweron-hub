/**
 * src/features/spending-explorer/snapshot/SpendingSnapshot.tsx
 *
 * BANK-6F Spending Snapshot. DISPLAY ONLY: every figure is the server's own `analytics` value, shown as is. The one number formed here is each
 * category's share of the headline total (D3), rounded for display and always labelled with its denominator ("of unassigned spending"). Nothing
 * here is stored, sent or used by any calculation.
 *
 * What the headline counts (the server spending rules, verified for BANK-6F): posted, non-ignored money going out in
 * the last N days that is not linked to a bill, debt, payroll, project, transfer, general overhead or personal use, and not confidently matched to
 * one. Not-classified spending is part of it. Pending money is not.
 */
import { useEffect, useState } from 'react'
import { CategoryDot, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { useHierarchy } from '../HierarchyProvider'
import { parentDisplayColor } from '@/features/display-colors/hierarchyColors'
import type { Analytics } from '../useSpendingExplorer'
import { btnQuiet, eyebrow, focusRing } from '../ui'
import { usd0, usd2 } from '../format'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** Display-only share of the headline total. Never 0% for a real amount, so a small category is not shown as nothing. */
export const sharePct = (part: number, whole: number): string => {
  if (whole <= 0 || part <= 0) return '0%'
  const p = (part / whole) * 100
  return p < 1 ? '<1%' : `${Math.round(p)}%`
}
/** An uncolored category: a neutral gray from the theme, never the cash green. */
const NEUTRAL = 'var(--text-muted)'
const SHOWN = 5
/** The headline spans two columns; the supporting tiles fill the rest of the row exactly (no tile left alone on a wide screen). */
const GRID = ['sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4', 'sm:grid-cols-5']

function Tile({ label, value, note, testId }: { label: string; value: string; note: React.ReactNode; testId?: string }) {
  return <div className="min-w-0 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] px-3 py-2.5" data-testid={testId}>
    <p className={eyebrow}>{label}</p>
    <p className="text-lg font-semibold leading-7 tabular-nums tracking-[-0.01em]">{value}</p>
    <p className="text-xs text-[var(--text-secondary)]">{note}</p>
  </div>
}

export interface BreakdownBucket { key: string; label: string; totalMinor: number; count: number; color?: string | null }
/** Shared BANK-6F presentation for leaf categories, parent buckets and activity lanes. */
export function SpendingBreakdown({ buckets, total, selected, onPick, denominator = 'unassigned', label = 'Unassigned spending by category', testId = 'spending-bucket' }: {
  buckets: BreakdownBucket[]; total: number; selected: string; onPick: (key: string) => void; denominator?: string; label?: string; testId?: string
}) {
  const { categoryColor } = useDisplayColors()
  const [showAll, setShowAll] = useState(false)
  const max = Math.max(1, ...buckets.map(b => b.totalMinor))
  const colorOf = (b: BreakdownBucket) => b.color === undefined ? categoryColor(b.key) : b.color
  return <div className="space-y-2">
    <div role="img" aria-label={`Share of ${denominator==='unassigned'?'unassigned spending by category':denominator}: ${buckets.map(b => `${b.label} ${sharePct(b.totalMinor,total)}`).join(', ')}`} data-testid="spending-composition" className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--surface-2)]">
      {buckets.filter(b => b.totalMinor > 0).map(b => <span key={b.key} data-key={b.key} className="block h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${total > 0 ? b.totalMinor / total * 100 : 0}%`, background: colorOf(b) ?? NEUTRAL }} />)}
    </div>
    <ul className="space-y-0.5" aria-label={label}>{(showAll ? buckets : buckets.slice(0,SHOWN)).map(b => {
      const on = selected === b.key, color = colorOf(b)
      return <li key={b.key}><button type="button" onClick={() => onPick(on ? '' : b.key)} aria-pressed={on} data-testid={testId} data-bucket={b.key}
        className={`grid min-h-[52px] w-full grid-cols-[minmax(0,10rem)_minmax(2.5rem,1fr)_5.5rem] items-center gap-2 rounded-xl px-2 py-1 text-left sm:grid-cols-[minmax(0,15rem)_minmax(3rem,1fr)_6rem] ${on ? 'bg-[var(--fin-protected-tint)] ring-2 ring-[var(--fin-protected-border)]' : '[@media(hover:hover)]:hover:bg-[var(--surface-2)]'} ${focusRing}`}>
        <span className="min-w-0"><span className="flex min-w-0 items-center gap-2 text-sm font-semibold">{b.color===undefined?<CategoryDot categoryKey={b.key}/>:color && <span aria-hidden="true" data-testid="category-dot" data-color={color} className="h-2.5 w-2.5 shrink-0 rounded-full" style={{background:color}} />}<span className="truncate">{b.label}</span></span>
          <span className="block text-[11px] leading-4 tabular-nums text-[var(--text-secondary)]" data-testid="spending-bucket-share">{sharePct(b.totalMinor,total)} of {denominator} · {plural(b.count,'transaction')}</span></span>
        <span className="h-2 rounded-full bg-[var(--surface-2)]" aria-hidden="true"><span className="block h-2 rounded-full" data-testid="spending-bucket-bar" style={{width:`${b.totalMinor > 0 ? Math.max(4,Math.round(b.totalMinor/max*100)) : 0}%`,background:color ?? NEUTRAL}} /></span>
        <span className="text-right text-sm font-semibold tabular-nums">{usd2(b.totalMinor)}</span>
      </button></li>
    })}</ul>
    {buckets.length > SHOWN && <button type="button" className={btnQuiet} aria-expanded={showAll} onClick={() => setShowAll(v=>!v)} data-testid="spending-buckets-all">{showAll ? 'Show fewer categories' : `Show all ${buckets.length} categories`}</button>}
  </div>
}

/** Glance state: where the unassigned money went. Selecting a category drills the list into it (same filter as before); a second tap clears it. */
export function SpendingSnapshot({ a, selected, onPick }: { a: Analytics; selected: string; onPick: (bucket: string) => void }) {
  const {hierarchy}=useHierarchy(),{categoryColor}=useDisplayColors()
  const [parent,setParent]=useState('')
  useEffect(()=>{if(hierarchy.available && selected)setParent(hierarchy.categories.find(c=>c.key===selected)?.parentKey ?? '__no_parent')},[selected,hierarchy])
  const total = a.unassigned.totalMinor
  const buckets = a.unassigned.byBucket.filter(b => b.totalMinor > 0)
  const d = a.unassigned.deltaMinor
  const days = a.windowDays
  const parentOf=(key:string)=>key==='other_needs_review'?'__unclassified':hierarchy.categories.find(c=>c.key===key)?.parentKey ?? '__no_parent'
  const parentLabel=(key:string)=>hierarchy.parents.find(p=>p.key===key)?.name ?? (key==='__unclassified'?'Not classified':'No parent assigned')
  const parents=[...buckets.reduce((m,b)=>{
    const key=parentOf(b.key),p=m.get(key) ?? {key,label:parentLabel(key),totalMinor:0,count:0,color:key.startsWith('__')?null:parentDisplayColor(key,hierarchy,categoryColor)}
    p.totalMinor+=b.totalMinor;p.count+=b.count;return m.set(key,p)
  },new Map<string,BreakdownBucket>()).values()].sort((a,b)=>b.totalMinor-a.totalMinor)
  const leafBuckets=buckets.filter(b=>parentOf(b.key)===parent)
  const tiles = [a.knownBills.count, a.pending.count, a.unclassified.count].filter(n => n > 0).length
  return <div data-testid="spending-snapshot" className="space-y-3">
    <div className={`grid grid-cols-2 gap-2 ${GRID[tiles]}`}>
      <div className="col-span-2 min-w-0 rounded-2xl border border-[var(--surface-line)] bg-[var(--surface-1)] px-3 py-2.5" data-testid="spending-headline">
        <p className={eyebrow}>Unassigned spending · last {days} days</p>
        <p className="text-[28px] font-semibold leading-9 tracking-[-0.01em] tabular-nums" data-testid="spending-total">{usd0(total)} <span className="text-sm font-normal tracking-normal text-[var(--text-secondary)]">· {plural(a.unassigned.count, 'transaction')}</span></p>
        {(a.unassigned.previousMinor > 0 || d !== 0) && <p className="text-xs text-[var(--text-secondary)]" data-testid="spending-delta">
          {d > 0 ? `${usd0(d)} more than the previous ${days} days` : d < 0 ? `${usd0(d)} less than the previous ${days} days` : `The same as the previous ${days} days`}</p>}
      </div>
      {a.knownBills.count > 0 && <Tile label="Known bills" value={usd0(a.knownBills.totalMinor)} testId="spending-tile-bills"
        note={<>{plural(a.knownBills.count, 'bill')}, debt or payroll payment{a.knownBills.count === 1 ? '' : 's'} · confirmed or suggested</>} />}
      {a.pending.count > 0 && <Tile label="Pending" value={usd0(a.pending.totalMinor)} testId="spending-tile-pending" note={<>{plural(a.pending.count, 'transaction')} · not counted until posted</>} />}
      {a.unclassified.count > 0 && <Tile label="Not classified yet" value={usd0(a.unclassified.totalMinor)} testId="spending-tile-unclassified" note={<>{plural(a.unclassified.count, 'transaction')} · included in unassigned · stays in review</>} />}
    </div>
    <p className="text-xs text-[var(--text-secondary)]" data-testid="spending-definition">Unassigned: posted money going out that is not linked to a bill, debt, payroll, project, transfer, overhead or personal use, and not confidently matched to one. Ignored transactions are left out.</p>

    {buckets.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">Nothing unassigned in this period.</p> : hierarchy.available ? <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1"><button className={btnQuiet} onClick={()=>{setParent('');onPick('')}}>Parent buckets</button>{parent && <><span aria-hidden="true">›</span><span className="text-sm font-semibold">{parentLabel(parent)}</span></>}</div>
      <SpendingBreakdown buckets={parent?leafBuckets:parents} total={parent?parents.find(p=>p.key===parent)?.totalMinor ?? 0:total} selected={parent?selected:''} denominator={parent?parentLabel(parent):'unassigned'} label={parent?'Subcategories':'Parent-bucket composition'} onPick={key=>{if(parent)onPick(key);else setParent(key)}} />
      {!parent && <p className="text-xs text-[var(--text-secondary)]">Choose a parent bucket, then a category to inspect its transactions.</p>}
    </div> : <SpendingBreakdown buckets={buckets} total={total} selected={selected} onPick={onPick} />}

  </div>
}
