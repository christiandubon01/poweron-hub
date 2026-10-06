import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { PLOT_INSET } from './CashFlowTimelineLayer'
import { fracFromClientX, rangeFromIndices, snapIndex, type DateRange } from './cashRangeModel'
import { shortDate } from './commandCenterModel'

type Gesture = { kind: 'new' | 'start' | 'end'; anchor: number; startX: number; moved: boolean }
const DRAG_THRESHOLD_PX = 4
const SKY = 'rgba(125,211,252,'

/**
 * The plot wrapper that adds date-range selection on top of the (unchanged) chart and event overlay.
 *
 * - Mouse/pen: drag anywhere on the plot. Touch: only while "Select range" mode is on, so page scrolling is never hijacked.
 * - The pointer is converted to the nearest graph DATE; no fractional timestamps exist.
 * - Live drag state is local to this component. `children` is the same element tree on every drag tick, so React skips
 *   re-rendering the chart/overlay: dragging does not re-render the chart or the Cash OS page.
 * - A click without movement is left alone (the chart's normal date selection still works); a drag swallows its click.
 */
export function CashRangePlot({ dates, range, rangeMode, onCommit, children }: {
  dates: readonly string[]
  range: DateRange | null
  rangeMode: boolean
  /** `drag` ends range mode (so touch taps work again); `key` is a keyboard nudge of a handle. */
  onCommit: (range: DateRange, source: 'drag' | 'key') => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const suppressClick = useRef(false)
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null)
  const count = dates.length

  const indexAt = (clientX: number): number => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return 0
    return snapIndex(fracFromClientX(clientX, rect, PLOT_INSET), count)
  }
  const committed = range ? { a: dates.indexOf(range.start), b: dates.indexOf(range.end) } : null
  const shown = draft ?? (committed && committed.a >= 0 && committed.b >= 0 ? committed : null)
  const lo = shown ? Math.min(shown.a, shown.b) : 0
  const hi = shown ? Math.max(shown.a, shown.b) : 0
  const frac = (i: number) => (count > 1 ? i / (count - 1) : 0)

  const finish = (commit: boolean) => {
    const g = gesture.current
    gesture.current = null
    if (g && g.moved && commit && draft) { suppressClick.current = true; onCommit(rangeFromIndices(dates, draft.a, draft.b), 'drag') }
    setDraft(null)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    suppressClick.current = false
    if (gesture.current) return
    if ((e.target as HTMLElement).closest?.('button, a, input, select, [role="slider"]')) return // markers, handles, controls
    const type = (e as unknown as { pointerType?: string }).pointerType || 'mouse'
    if (type === 'touch' && !rangeMode) return // deliberate entry only; never steal normal touch scrolling
    if (e.button !== undefined && e.button !== 0) return
    gesture.current = { kind: 'new', anchor: indexAt(e.clientX), startX: e.clientX, moved: false }
  }
  const startHandleDrag = (kind: 'start' | 'end') => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation()
    suppressClick.current = false
    if (!committed) return
    gesture.current = { kind, anchor: kind === 'start' ? Math.max(committed.a, committed.b) : Math.min(committed.a, committed.b), startX: e.clientX, moved: false }
    try { e.currentTarget.setPointerCapture?.((e as unknown as { pointerId: number }).pointerId) } catch { /* not supported */ }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    if (!g.moved) {
      if (g.kind === 'new' && Math.abs(e.clientX - g.startX) < DRAG_THRESHOLD_PX) return
      g.moved = true
      if (g.kind === 'new') { try { ref.current?.setPointerCapture?.((e as unknown as { pointerId: number }).pointerId) } catch { /* not supported */ } }
    }
    setDraft({ a: g.anchor, b: indexAt(e.clientX) })
  }
  const nudge = (which: 'start' | 'end') => (e: KeyboardEvent<HTMLElement>) => {
    if (!committed) return
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    e.preventDefault()
    const a = which === 'start' ? lo + step : lo
    const b = which === 'end' ? hi + step : hi
    onCommit(rangeFromIndices(dates, a, Math.max(a, b)), 'key')
  }

  const labelCls = 'pointer-events-none absolute -top-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--bg-secondary)] px-1 text-[10px] font-semibold text-[var(--text-primary)] ring-1 ring-[var(--border-primary)]'
  // A one-day range puts both handles on the same date: nudge them apart so each stays reachable.
  const handle = (which: 'start' | 'end', index: number) => <button key={which} type="button" role="slider" data-testid={`range-handle-${which}`} data-range-handle={which}
    aria-label={`Range ${which} date. Use the left and right arrow keys to move it.`} aria-orientation="horizontal"
    aria-valuemin={0} aria-valuemax={Math.max(count - 1, 0)} aria-valuenow={index} aria-valuetext={dates[index]}
    onPointerDown={startHandleDrag(which)} onKeyDown={nudge(which)}
    className="pointer-events-auto absolute top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
    style={{ left: `${frac(index) * 100}%`, touchAction: 'none', marginLeft: lo === hi ? (which === 'start' ? -14 : 14) : 0 }}>
    <span aria-hidden="true" className="block h-7 w-2 rounded-full" style={{ background: `${SKY}0.9)`, boxShadow: '0 0 0 1px rgba(15,17,23,0.6)' }} />
  </button>

  return <div ref={ref} data-testid="graph-plot" data-range-mode={rangeMode || undefined} data-dragging={draft ? 'true' : undefined}
    className={`relative h-[310px] min-w-[500px] ${rangeMode ? 'rounded-lg outline outline-1 outline-dashed outline-sky-300/60' : ''}`}
    style={{ touchAction: rangeMode ? 'none' : undefined }}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)}
    onClickCapture={e => {
      // The click that trails a drag must not also select a date. Only chart-area clicks are swallowed (never a marker,
      // handle or control), and the flag clears on ANY click, so a stale flag can never eat a genuine later tap.
      const swallow = suppressClick.current && !(e.target as HTMLElement).closest?.('button, a, input, select, [role="slider"]')
      suppressClick.current = false
      if (swallow) e.stopPropagation()
    }}>
    {shown && <div aria-hidden="true" className="pointer-events-none absolute" style={{ left: PLOT_INSET.left, right: PLOT_INSET.right, top: PLOT_INSET.top, bottom: PLOT_INSET.bottom }}>
      <div data-testid="range-band" data-start={dates[lo]} data-end={dates[hi]} className="absolute inset-y-0"
        style={{ left: `${frac(lo) * 100}%`, width: `${(frac(hi) - frac(lo)) * 100}%`, minWidth: 4, background: `${SKY}0.10)`,
          borderLeft: `1px dashed ${SKY}0.8)`, borderRight: `1px dashed ${SKY}0.8)` }} />
      <span className={labelCls} data-testid="range-label-start" style={{ left: `${frac(lo) * 100}%` }}>{shortDate(dates[lo])}</span>
      {hi !== lo && <span className={labelCls} data-testid="range-label-end" style={{ left: `${frac(hi) * 100}%` }}>{shortDate(dates[hi])}</span>}
    </div>}
    {children}
    {range && committed && committed.a >= 0 && committed.b >= 0 && <div className="pointer-events-none absolute" style={{ left: PLOT_INSET.left, right: PLOT_INSET.right, top: PLOT_INSET.top, bottom: PLOT_INSET.bottom }}>
      {handle('start', lo)}{handle('end', hi)}
    </div>}
  </div>
}
