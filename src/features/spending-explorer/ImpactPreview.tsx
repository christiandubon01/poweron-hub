/**
 * src/features/spending-explorer/ImpactPreview.tsx
 *
 * GREENLIGHT-1 Stage 1: the owner's READ-ONLY reconciliation impact preview, for devices without a developer console (iPad).
 * It only calls the existing GET plaid-spending?impact=1 (owner/admin enforced by the server, classification computed by the existing service) and
 * only when the owner taps the button: opening Cash OS makes no extra request. It never saves anything and never changes a switch.
 * Shown: the preview's status flags, counts, and classification moves grouped by (before -> after, reason). Never shown: transaction or provider ids,
 * descriptions, account names or numbers, tokens. Dollar totals stay hidden unless the owner reveals them on their own screen.
 */
import { useState } from 'react'
import { authedJsonHeaders } from '@/services/authedFetch'
import { btn, btnQuiet, eyebrow, panel } from './ui'
import { usd2 } from './format'

interface Shape { activity: string; relationship: string; bucket: string }
interface ImpactResponse {
  available: boolean; switch: 'on' | 'off'; complete: boolean; reason: string | null; window: { from: string; to: string }
  summary: { rows: number; changed: number; totalOutMinor: number; totalInMinor: number; conserved: boolean } | null
  lines: Array<{ activity: string; label: string; offCount: number; onCount: number; deltaOutMinor: number; deltaInMinor: number }>
  changes: Array<{ amountMinor: number; off: Shape; on: Shape }>
  changesTruncated: boolean
}
type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready'; data: ImpactResponse }

const LABEL: Record<string, string> = { ignored: 'Ignored', business: 'Business spending', personal: 'Personal & owner outflows', debt: 'Debt repayments', transfer: 'Transfers', refund: 'Refunds', income: 'Money in', unresolved: 'Unresolved' }
const label = (a: string) => LABEL[a] ?? a

/** Why a row would move, from the proposed relationship/category only (the target id is never read beyond "is there one"). */
export function reasonOf(off: Shape, on: Shape): string {
  if (on.bucket.startsWith('refund/') && !off.bucket.startsWith('refund/')) return 'Proposed refund'
  if (on.relationship === 'none') return off.relationship === 'none' ? 'Category suggestion changed' : 'No longer proposed as a transfer or payment'
  const [kind, state] = on.relationship.split('/')
  const paired = on.relationship.includes('->')
  if (kind === 'transfer' && state === 'suggested') return paired ? 'Proposed matched pair (transfer or card payment)' : 'Looks like a transfer or payment, no match proposed'
  if (kind === 'transfer' && state === 'confirmed') return 'Transfer you confirmed'
  if (kind === 'debt') return state === 'confirmed' ? 'Debt payment you confirmed' : 'Proposed debt payment'
  return `${kind} (${state})`
}

export interface ImpactGroup { from: string; to: string; reason: string; count: number; amountMinor: number }
export function groupChanges(changes: ImpactResponse['changes']): ImpactGroup[] {
  const m = new Map<string, ImpactGroup>()
  for (const c of changes) {
    const g = { from: label(c.off.activity), to: label(c.on.activity), reason: reasonOf(c.off, c.on) }
    const k = `${g.from}|${g.to}|${g.reason}`
    const cur = m.get(k) ?? { ...g, count: 0, amountMinor: 0 }
    cur.count += 1; cur.amountMinor += Math.abs(c.amountMinor)
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
}

const yesNo = (v: boolean | null | undefined) => (v === true ? 'Yes' : v === false ? 'No' : '—')

export default function ImpactPreview() {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [open, setOpen] = useState(false)
  const [showDollars, setShowDollars] = useState(false)
  const run = async () => {
    setOpen(true); setState({ kind: 'loading' })
    try {
      const res = await fetch('/.netlify/functions/plaid-spending?impact=1', { method: 'GET', headers: await authedJsonHeaders() })
      const body = await res.json().catch(() => ({}))
      if (res.status === 401 || res.status === 403) { setState({ kind: 'error', text: 'Only the owner or an admin can run this preview. Sign in again if you are the owner.' }); return }
      if (!res.ok) { setState({ kind: 'error', text: typeof body?.error === 'string' ? body.error : 'The preview could not be loaded. Nothing was changed; try again.' }); return }
      setState({ kind: 'ready', data: body as ImpactResponse })
    } catch {
      setState({ kind: 'error', text: 'The preview could not be loaded. Nothing was changed; try again.' })
    }
  }

  return <div className={`${panel} mt-3`} data-testid="impact-preview">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <p className={eyebrow}>Preview classification changes</p>
        <p className="text-xs text-[var(--text-secondary)]">Read-only. Shows what would change if reconciliation were turned on. Nothing is saved or changed.</p>
      </div>
      <div className="flex gap-2">
        {open && state.kind !== 'loading' && <button type="button" className={btnQuiet} onClick={() => setOpen(false)} data-testid="impact-close">Close</button>}
        <button type="button" className={btn} onClick={() => void run()} disabled={state.kind === 'loading'} data-testid="impact-run">{state.kind === 'ready' ? 'Run again' : 'Run preview'}</button>
      </div>
    </div>
    {open && state.kind === 'loading' && <p className="mt-3 text-sm" role="status" data-testid="impact-loading">Comparing classifications… (read-only)</p>}
    {open && state.kind === 'error' && <p className="mt-3 text-sm" role="alert" data-testid="impact-error">{state.text}</p>}
    {open && state.kind === 'ready' && <ImpactResult data={state.data} showDollars={showDollars} onToggleDollars={() => setShowDollars(v => !v)} />}
  </div>
}

function ImpactResult({ data, showDollars, onToggleDollars }: { data: ImpactResponse; showDollars: boolean; onToggleDollars: () => void }) {
  const s = data.summary
  const groups = groupChanges(data.changes ?? [])
  const facts: Array<[string, string, string]> = [
    ['Preview available', yesNo(data.available), 'available'], ['Complete', yesNo(data.complete), 'complete'], ['Money conserved', yesNo(s?.conserved), 'conserved'],
    ['Reconciliation switch', data.switch === 'on' ? 'On' : 'Off', 'switch'], ['Transactions compared', s ? String(s.rows) : '—', 'rows'],
    ['Would change', s ? String(s.changed) : '—', 'changed'], ['List truncated', yesNo(data.changesTruncated), 'truncated'],
  ]
  return <div className="mt-3 space-y-3" data-testid="impact-result">
    <p className="rounded-xl bg-[var(--surface-2)] p-2 text-xs" role="status">Read-only preview{data.window ? ` · ${data.window.from} to ${data.window.to}` : ''} · not a saved change.</p>
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
      {facts.map(([k, v, id]) => <div key={id} className="min-w-0" data-testid={`impact-${id}`}><dt className="text-xs text-[var(--text-secondary)]">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
    </dl>
    {(!data.available || !data.complete) && <p className="text-sm" role="alert" data-testid="impact-incomplete">{data.reason ?? 'The comparison is not complete, so no changes are listed.'} Do not turn anything on based on this preview.</p>}
    {data.available && data.complete && s && <>
      {s.conserved === false && <p className="text-sm" role="alert" data-testid="impact-not-conserved">Money in and out do not match between the two classifications. Stop and report this.</p>}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={eyebrow}>What would move ({s.changed})</p>
          <button type="button" className={btnQuiet} onClick={onToggleDollars} aria-pressed={showDollars} data-testid="impact-dollars">{showDollars ? 'Hide dollar amounts' : 'Show dollar amounts'}</button>
        </div>
        {groups.length === 0 ? <p className="text-sm" data-testid="impact-none">No transaction would change classification.</p>
          : <ul className="mt-1 divide-y divide-[var(--surface-line)]" data-testid="impact-groups">{groups.map(g => <li key={`${g.from}|${g.to}|${g.reason}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm" data-testid="impact-group">
              <span className="min-w-0"><span className="font-semibold">{g.from} → {g.to}</span><br /><span className="text-xs text-[var(--text-secondary)]">{g.reason}</span></span>
              <span className="tabular-nums">{g.count}{showDollars ? ` · ${usd2(g.amountMinor)}` : ''}</span>
            </li>)}</ul>}
        {data.changesTruncated && <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="impact-truncated-note">Groups cover the largest changes only; the “Would change” total above is complete.</p>}
      </div>
      <div>
        <p className={eyebrow}>Lines before → after (counts)</p>
        <ul className="mt-1 text-sm" data-testid="impact-lines">{data.lines.map(l => <li key={l.activity} className="flex justify-between gap-3 py-0.5" data-testid="impact-line"><span>{label(l.activity)}</span><span className="tabular-nums">{l.offCount} → {l.onCount}{showDollars && (l.deltaOutMinor || l.deltaInMinor) ? ` · out ${l.deltaOutMinor < 0 ? '−' : '+'}${usd2(Math.abs(l.deltaOutMinor))}, in ${l.deltaInMinor < 0 ? '−' : '+'}${usd2(Math.abs(l.deltaInMinor))}` : ''}</span></li>)}</ul>
      </div>
    </>}
  </div>
}
