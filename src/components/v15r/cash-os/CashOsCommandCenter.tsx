import { useMemo, useState } from 'react'
import type { CashOsSnapshot } from '@/finance/cashOsSnapshot'
import type { OwnerDecisionView } from '@/finance/decisionLayer'
import { DetailsToggle, type DecisionEditor } from './CashOsDecisionEditor'
import { CommandRow, CommandSection, Quiet, ShowMore, StateTag } from './CommandCenterParts'
import { MONEY_STATE_EXPLAIN, MONEY_STATE_LABEL, MONEY_STATE_PHRASE, buildAttentionRows, buildMoneyRows, buildNextRows,
  buildTodayModel, type AttentionRow, type DetailTab, type MoneyRow, type MoneyRowState, type NextRow } from './commandCenterModel'
import { cashDate, money } from './cashOsUi'
import type { GraphLink } from './cashTimelineModel'
import type { RowRefs } from './commandCenterModel'

/** Compact default sizes. Everything past these stays reachable behind "Show N more". */
const ATTENTION_DEFAULT = 3
const MONEY_DEFAULT = 4
const TODAY_DEFAULT = 3

type SectionKey = 'today' | 'attention' | 'money' | 'next'
const SEGMENTS: Array<{ key: SectionKey; label: string }> = [
  { key: 'today', label: 'Today' }, { key: 'attention', label: 'Attention' }, { key: 'money', label: 'Money' }, { key: 'next', label: 'Next' },
]

const SEVERITY_STYLE = {
  high: { glyph: '▲', color: 'var(--fin-negative)', tint: 'var(--fin-negative-tint)' },
  medium: { glyph: '◆', color: 'var(--fin-warning)', tint: 'var(--fin-warning-tint)' },
  low: { glyph: '●', color: 'var(--text-secondary)', tint: 'transparent' },
} as const

const MONEY_STYLE: Record<MoneyRowState, { glyph: string; color: string }> = {
  collectible: { glyph: '＋', color: 'var(--fin-cash)' },
  unlockable: { glyph: '◐', color: 'var(--fin-free)' },
  potential: { glyph: '○', color: 'var(--fin-protected)' },
  blocked: { glyph: '■', color: 'var(--fin-warning)' },
  not_counted: { glyph: '–', color: 'var(--text-secondary)' },
}

const NEXT_STYLE: Record<NextRow['group'], string> = {
  no_cash: 'var(--fin-cash)', work: 'var(--fin-free)', protect: 'var(--fin-protected)', waiting: 'var(--fin-warning)', watch: 'var(--text-secondary)',
}

function Missing({ items, label = 'Check first' }: { items: string[]; label?: string }) {
  if (!items.length) return null
  return <p className="mt-1 text-xs" style={{ color: 'var(--fin-warning)' }}><strong>{label}:</strong> {items.join('; ')}</p>
}

function TabLink({ tab, onNavigate }: { tab?: DetailTab; onNavigate?: (tab: DetailTab) => void }) {
  if (!tab || !onNavigate) return null
  return <button type="button" onClick={() => onNavigate(tab)} className="mt-2 min-h-[44px] text-sm font-semibold text-orange-300 hover:text-orange-200">Open {tab} →</button>
}

export default function CashOsCommandCenter({ view, snapshot, editor, onNavigate, graphLink }: {
  view: OwnerDecisionView
  snapshot: CashOsSnapshot | null
  editor?: DecisionEditor
  onNavigate?: (tab: DetailTab) => void
  /** Optional graph link: highlights rows that share canonical identity with the selected graph item, and reports row selections. */
  graphLink?: GraphLink
}) {
  const [active, setActive] = useState<SectionKey>('today')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [more, setMore] = useState<Record<SectionKey, boolean>>({ today: false, attention: false, money: false, next: false })
  const [openProject, setOpenProject] = useState<string | null>(null)
  const toggle = (id: string, refs?: RowRefs) => {
    const opening = !expanded.has(id)
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
    // Opening a row may show its graph date/event, but only through unambiguous canonical identity.
    if (opening && refs && graphLink) graphLink.onRowSelect({ sourceKey: refs.sourceKey, projectId: refs.projectId })
  }
  const linked = (refs?: RowRefs): boolean => {
    const h = graphLink?.highlight
    if (!h || !refs) return false
    return (!!h.sourceKey && refs.sourceKey === h.sourceKey) || (!!h.projectId && refs.projectId === h.projectId)
  }
  const flip = (key: SectionKey) => setMore(prev => ({ ...prev, [key]: !prev[key] }))

  const withheld = view.status !== 'ready'
  const today = useMemo(() => (snapshot && !withheld ? buildTodayModel(snapshot) : null), [snapshot, withheld])
  const attention = useMemo(() => buildAttentionRows(view), [view])
  const moneyRows = useMemo(() => buildMoneyRows(view), [view])
  const next = useMemo(() => buildNextRows(view), [view])

  const todayCount = today ? today.due.length + today.received.length : 0
  const visible = (key: SectionKey) => `${active === key ? 'block' : 'hidden'} lg:block`

  // ── TODAY ──
  const todayItems = today ? [
    ...today.due.map(item => ({ kind: 'due' as const, item })),
    ...(today.received.length ? [{ kind: 'received' as const, item: null }] : []),
  ] : []
  const todayShown = more.today ? todayItems : todayItems.slice(0, TODAY_DEFAULT)
  const todayBody = withheld ? <Quiet>Held back with the cash totals.</Quiet>
    : todayItems.length === 0 ? <Quiet>No scheduled cash movement today.</Quiet>
    : <>{todayShown.map(entry => {
      if (entry.kind === 'received') {
        const id = 'today:received'
        return <CommandRow key={id} id={id} expanded={expanded.has(id)} onToggle={() => toggle(id)}
          lead={<StateTag label="IN" glyph="▲" color="var(--fin-cash)" tint="var(--fin-cash-tint)" />}
          title="Received today" sub={`${today!.received.length} deposit${today!.received.length === 1 ? '' : 's'} recorded`}
          trailing={<strong className="font-mono" style={{ color: 'var(--fin-cash)' }}>+{money(today!.receivedTotalMinor)}</strong>}>
          <ul className="space-y-1">{today!.received.map(row => <li key={row.id} className="flex justify-between gap-3"><span>{row.label}</span><span className="font-mono">+{money(row.amountMinor)}</span></li>)}</ul>
        </CommandRow>
      }
      const it = entry.item
      return <CommandRow key={it.id} id={it.id} expanded={expanded.has(it.id)} onToggle={() => toggle(it.id, it.refs)} refs={it.refs} linked={linked(it.refs)}
        lead={<StateTag label={it.kind === 'collection' ? 'EXPECTED' : 'DUE'} glyph={it.kind === 'collection' ? '▲' : '▼'}
          color={it.kind === 'collection' ? 'var(--fin-cash)' : 'var(--fin-negative)'} />}
        title={it.label} sub={it.state}
        trailing={it.amountMinor == null ? <span className="text-xs">Amount unknown</span>
          : <strong className="font-mono" style={{ color: it.kind === 'collection' ? 'var(--fin-cash)' : 'var(--fin-negative)' }}>{it.kind === 'collection' ? '+' : '−'}{money(it.amountMinor)}</strong>}>
        <p>{it.detail}</p>
      </CommandRow>
    })}<ShowMore count={todayItems.length - TODAY_DEFAULT} open={more.today} onToggle={() => flip('today')} /></>

  // ── ATTENTION ──
  const attentionShown = more.attention ? attention : attention.slice(0, ATTENTION_DEFAULT)
  const attentionRow = (row: AttentionRow) => {
    const style = SEVERITY_STYLE[row.severity]
    return <CommandRow key={row.id} id={`attention:${row.id}`} testId="attention-row" expanded={expanded.has(`attention:${row.id}`)}
      onToggle={() => toggle(`attention:${row.id}`, row.refs)} refs={row.refs} linked={linked(row.refs)}
      lead={<span data-severity={row.severity}><StateTag label={row.label} glyph={style.glyph} color={style.color} tint={style.tint} /></span>}
      title={row.title}
      trailing={(row.amountMinor != null || row.dateLabel) ? <span className="flex flex-col items-end">
        {row.amountMinor != null && <strong className="font-mono">{money(row.amountMinor)}</strong>}
        {row.dateLabel && <span className="text-xs text-[var(--text-secondary)]">{row.dateLabel}</span>}
      </span> : undefined}>
      <p>{row.risk.detail}</p>
      <Missing items={row.risk.missing} />
      {row.risk.date && <p className="mt-1 text-xs">Date: {cashDate(row.risk.date)}</p>}
      <TabLink tab={row.detailsTab} onNavigate={onNavigate} />
    </CommandRow>
  }
  const attentionBody = attention.length === 0 ? <Quiet>Nothing urgent found in the data Cash OS has.</Quiet>
    : <>{attentionShown.map(attentionRow)}<ShowMore count={attention.length - ATTENTION_DEFAULT} open={more.attention} onToggle={() => flip('attention')} /></>

  // ── MONEY ──
  const moneyShown = more.money ? moneyRows : moneyRows.slice(0, MONEY_DEFAULT)
  const moneyRow = (row: MoneyRow) => {
    const style = MONEY_STYLE[row.state]
    const id = row.id
    const projectId = row.refs.projectId
    return <CommandRow key={id} id={id} testId="money-row" expanded={expanded.has(id)} onToggle={() => toggle(id, row.refs)} refs={row.refs} linked={linked(row.refs)}
      lead={<span data-money-state={row.state}><StateTag label={MONEY_STATE_LABEL[row.state]} glyph={style.glyph} color={style.color} /></span>}
      title={row.label}
      sub={<>{MONEY_STATE_PHRASE[row.state]}{row.requiresMinor != null ? <> · <strong className="text-[var(--text-primary)]">Requires {money(row.requiresMinor)}</strong></> : null}</>}
      trailing={row.state === 'not_counted' ? undefined : <strong className="font-mono">{row.amountMinor == null ? 'Amount unknown' : money(row.amountMinor)}</strong>}>
      <p>{MONEY_STATE_EXPLAIN[row.state]}</p>
      <p className="mt-1">{row.basis}</p>
      {row.requiresMinor != null && <p className="mt-1">Cash needed first: {money(row.requiresMinor)}. This is a requirement, not profit and not part of your cash.</p>}
      <Missing items={row.unknowns} label="Not known yet" />
      {projectId && <DetailsToggle projectId={projectId} name={row.label} editor={editor} open={openProject}
        onOpen={setOpenProject} onClose={() => setOpenProject(null)} hasFacts={!!editor?.factsFor(projectId)} />}
    </CommandRow>
  }
  const moneyCounts = (['collectible', 'unlockable', 'potential', 'blocked'] as const).map(state => ({ state, n: moneyRows.filter(r => r.state === state).length })).filter(x => x.n > 0)
  const moneyBody = moneyRows.length === 0 ? <Quiet>No open project money was found.</Quiet> : <>
    <p className="mb-1 text-xs text-[var(--text-secondary)]" data-testid="money-not-cash-note">None of this is in your cash total.
      {moneyCounts.length > 0 && <> {moneyCounts.map(c => `${c.n} ${MONEY_STATE_LABEL[c.state].toLowerCase()}`).join(' · ')}</>}</p>
    {moneyShown.map(moneyRow)}
    <ShowMore count={moneyRows.length - MONEY_DEFAULT} open={more.money} onToggle={() => flip('money')} />
    {view.moneyStates.settledProjectCount > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]">{view.moneyStates.settledProjectCount} fully paid project{view.moneyStates.settledProjectCount === 1 ? '' : 's'} hidden — nothing to do.</p>}
  </>

  // ── NEXT ──
  const nextShown = more.next ? [...next.top, ...next.rest] : next.top
  const nextRow = (row: NextRow) => {
    const a = row.action
    return <CommandRow key={row.id} id={row.id} testId="next-row" expanded={expanded.has(row.id)} onToggle={() => toggle(row.id, row.refs)} refs={row.refs} linked={linked(row.refs)}
      lead={<span data-next-group={row.group} data-category={a.category}><StateTag label={row.label} glyph="›" color={NEXT_STYLE[row.group]} /></span>}
      title={row.title}
      sub={<>{row.amountPhrase}{row.amountPhrase && row.requiresMinor != null ? ' · ' : ''}{row.requiresMinor != null ? <strong className="text-[var(--text-primary)]">Requires {money(row.requiresMinor)}</strong> : null}
        {row.checkFirst ? <>{row.amountPhrase || row.requiresMinor != null ? ' · ' : ''}<span style={{ color: 'var(--fin-warning)' }}>Check first</span></> : null}</>}>
      <ul className="list-disc space-y-1 pl-5">{a.why.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
      <p className="mt-2 text-xs">
        Cash needed: {a.resource.cashMinor == null ? 'unknown' : money(a.resource.cashMinor)}
        {' · '}Your work: {a.resource.ownerWork === 'required' ? 'required' : a.resource.ownerWork === 'none' ? 'none' : 'unknown'}
        {a.timing.date ? ` · Timing: ${cashDate(a.timing.date)}` : ' · Timing: not known'}
      </p>
      <Missing items={a.missing} label="Not known yet" />
    </CommandRow>
  }
  const nextBody = nextShown.length === 0 ? <Quiet>No actions to suggest from the data Cash OS has.</Quiet>
    : <>{nextShown.map(nextRow)}<ShowMore count={next.rest.length} open={more.next} onToggle={() => flip('next')} />
      <p className="mt-2 text-xs text-[var(--text-secondary)]">Suggestions only. Cash OS never moves money or changes a project for you.</p></>

  return <section data-testid="command-center" aria-label="Command center" className="space-y-3">
    <div role="group" aria-label="Command center section" className="grid grid-cols-4 gap-1 rounded-xl bg-[var(--bg-secondary)] p-1 lg:hidden" data-testid="command-segments">
      {SEGMENTS.map(seg => <button key={seg.key} type="button" aria-pressed={active === seg.key} onClick={() => setActive(seg.key)}
        className={`min-h-[44px] rounded-lg px-2 text-sm font-semibold ${active === seg.key ? 'bg-white/10 text-[var(--text-primary)] ring-1 ring-[var(--border-primary)]' : 'text-[var(--text-secondary)]'}`}>{seg.label}</button>)}
    </div>
    <div className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-4">
      <div className={visible('today')}><CommandSection testId="command-today" title="Today" count={withheld ? undefined : todayCount}>{todayBody}</CommandSection></div>
      <div className={visible('attention')}><CommandSection testId="command-attention" title="Needs attention" count={attention.length}>{attentionBody}</CommandSection></div>
      <div className={visible('money')}><CommandSection testId="command-money" title="Money" count={moneyRows.length}>{moneyBody}</CommandSection></div>
      <div className={visible('next')}><CommandSection testId="command-next" title="Next" count={next.top.length + next.rest.length}>{nextBody}</CommandSection></div>
    </div>
  </section>
}
