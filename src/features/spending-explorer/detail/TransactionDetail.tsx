/**
 * src/features/spending-explorer/detail/TransactionDetail.tsx
 *
 * BANK-6F expanded transaction detail, inline beneath its transaction (D9). Four sections, current decision first:
 *   1. Bank evidence        what the bank sent (read-only)
 *   2. Category             the current state, then its actions; the reasons behind a suggestion are collapsible
 *   3. What it belongs to   the current relationship, then its actions; changing it is behind one tap when one is already confirmed
 *   4. History              read-only, loaded only on request; plus Ignore / Stop ignoring
 * Every button sends exactly the decision it sent before BANK-6F (accept_suggestion, reject_suggestion, set_bucket, undo, set_relationship, ignore,
 * unignore). No new confirmation step and no new action.
 */
import { useState } from 'react'
import { Link2 } from 'lucide-react'
import { AccountColorDot, CategoryPill } from '@/features/display-colors/DisplayColors'
import { BucketPicker } from '../BucketPicker'
import { ChoiceSheet } from '../ChoiceSheet'
import { Chip, SelectField } from '../controls'
import { entryType, toneColor } from '../entryType'
import { CONF, shortDate, usd2, withMask } from '../format'
import type { DecisionBody, ExplorerRow, HistoryEntry, Options } from '../useSpendingExplorer'
import { btn, btnPrimary, btnQuiet, eyebrow, focusRing } from '../ui'

export const REL_KINDS: Array<{ key: string; label: string }> = [
  { key: 'obligation', label: 'Known bill' }, { key: 'project', label: 'Project' }, { key: 'debt', label: 'Debt payment' }, { key: 'payroll', label: 'Payroll' },
  { key: 'transfer', label: 'Transfer' }, { key: 'overhead', label: 'General overhead (business)' }, { key: 'personal', label: 'Personal' },
]
/** The categories that fit the direction of the money (unchanged rule: money in gets money-in categories, transfers, personal and "unknown"). */
export const bucketChoicesFor = (row: ExplorerRow, options: Options) => options.buckets.filter(b => (row.direction === 'money_in' ? (b.flow === 'in' || ['transfers', 'personal_owner', 'other_needs_review'].includes(b.key)) : b.flow !== 'in'))
/** A target list longer than this opens a searchable sheet instead of a menu. */
const SHEET_AFTER = 8
const TARGET_NOUN: Record<string, string> = { obligation: 'bill', project: 'project', debt: 'debt' }

type Decide = (body: DecisionBody) => Promise<void>

function Meter({ level }: { level: string | null }) {
  const n = level === 'high' ? 3 : level === 'possible' ? 2 : 1
  return <span aria-hidden="true" className="inline-flex gap-[3px] align-middle">{[0, 1, 2].map(i => <span key={i} className={`h-1.5 w-3.5 rounded-sm ${i < n ? 'bg-[var(--text-secondary)]' : 'bg-[var(--surface-2)]'}`} />)}</span>
}

/** "Why" for a suggestion: collapsed by default (D9), still in the document for screen readers and search. */
function Reasons({ reasons }: { reasons: string[] }) {
  if (!reasons.length) return null
  return <details className="group text-xs text-[var(--text-secondary)]">
    <summary className={`inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 rounded-lg font-semibold [&::-webkit-details-marker]:hidden ${focusRing}`}>
      <span aria-hidden="true" className="inline-block group-open:rotate-90">›</span> Why this suggestion
    </summary>
    <ul className="list-disc space-y-0.5 pb-1 pl-5">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
  </details>
}

function Band({ label, title, aside, children }: { label: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return <section aria-label={label} className="space-y-2 border-t border-[var(--surface-line)] px-3 py-3 first:border-t-0 sm:px-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className={eyebrow}>{title}</p>{aside}</div>
    {children}
  </section>
}

function History({ id, load }: { id: string; load: (id: string) => Promise<HistoryEntry[]> }) {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const show = async () => { setOpen(true); if (items) return; try { setItems(await load(id)); setFailed(false) } catch { setFailed(true) } }
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
  return <div data-testid="spending-history">
    {!open ? <button type="button" className={btn} onClick={() => void show()}>Show history</button>
      : <div className="space-y-2">
        {items === null && !failed && <p className="text-xs text-[var(--text-secondary)]">Loading…</p>}
        {items?.length === 0 && <p className="text-xs text-[var(--text-secondary)]">No decisions yet.</p>}
        {!!items?.length && <ol className="ml-1.5 space-y-2 border-l-2 border-[var(--surface-line)] pl-4" aria-label="Decisions, newest last">{items.map((h, i) => {
          const active = h.status === 'confirmed'
          return <li key={i} className="relative text-xs" data-status={h.status}>
            <span aria-hidden="true" className={`absolute -left-[23px] top-1 h-2.5 w-2.5 rounded-full ${active ? 'bg-[var(--text-primary)]' : 'bg-[var(--bg-card)] ring-2 ring-inset ring-[var(--text-muted)]'}`} />
            <span className={active ? 'font-semibold' : 'text-[var(--text-secondary)]'}>{h.label} · {active ? 'active' : h.status}{h.status === 'undone' && h.undoReason === 'changed_by_owner' ? ' (replaced)' : ''} · {h.source === 'owner' ? 'by you' : 'from a suggestion'} · {when(h.decidedAt ?? h.createdAt)}{h.undoneAt ? ` → undone ${when(h.undoneAt)}` : ''}</span>
          </li>
        })}</ol>}
        <button type="button" className={btnQuiet} onClick={() => setOpen(false)}>Hide history</button>
      </div>}
    {failed && <p className="text-xs" style={{ color: 'var(--fin-negative)' }}>History could not be loaded.</p>}
  </div>
}

function Relationship({ row, options, busy, onDecide }: { row: ExplorerRow; options: Options; busy: boolean; onDecide: Decide }) {
  const confirmedKind = row.relationship.state === 'confirmed' && row.relationship.kind !== 'unknown' ? row.relationship.kind : ''
  const [kind, setKind] = useState(confirmedKind)
  const [target, setTarget] = useState('')
  const [editing, setEditing] = useState(row.relationship.state === 'none')
  const [picking, setPicking] = useState(false)
  const needsTarget = kind === 'obligation' || kind === 'project' || kind === 'debt'
  const targets = kind === 'obligation' ? [...options.obligations.map(o => ({ value: `obligation:${o.id}`, label: `${o.label} · ${usd2(o.amountMinor)}` })), ...options.commitments.map(c => ({ value: `commitment:${c.id}`, label: `${c.label} · ${usd2(c.amountMinor)} · ${shortDate(c.expectedDate)}` }))]
    : kind === 'project' ? options.projects.map(p => ({ value: `project:${p.id}`, label: p.name })) : kind === 'debt' ? options.debts.map(d => ({ value: `debt:${d.id}`, label: d.label })) : []
  const sendRel = () => {
    if (!kind || (needsTarget && !target)) return
    const [type, ...rest] = target.split(':'); const id = rest.join(':')
    void onDecide({ action: 'set_relationship', transactionId: row.id, kind, ...(needsTarget ? { targetType: kind === 'obligation' ? type : undefined, targetId: id } : {}) })
  }
  const r = row.relationship
  const current = r.state === 'none' ? null : `${r.label}${r.target?.label ? ` · ${r.target.label}` : ''}`
  const targetLabel = targets.find(t => t.value === target)?.label

  return <>
    {r.state === 'confirmed' && <div className="flex flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1"><Chip tone="done">✓ {current}</Chip></span>
      {!row.pending && !editing && <button type="button" className={btn} disabled={busy} onClick={() => setEditing(true)} data-testid="detail-rel-change">Change…</button>}
      <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'undo', transactionId: row.id, dimension: 'relationship' })}>Undo</button>
    </div>}
    {r.state === 'suggested' && <div className="space-y-1.5 rounded-xl border border-dashed border-[var(--surface-line)] p-3" data-testid="detail-rel-suggestion">
      <p className="flex flex-wrap items-center gap-2 text-sm"><span>Suggested: <strong>{current}</strong></span>
        <span className="text-xs text-[var(--text-secondary)]">{CONF[r.confidence ?? 'low']} confidence <Meter level={r.confidence} /></span></p>
      <Reasons reasons={r.reasons} />
      {!row.pending && <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void onDecide({ action: 'accept_suggestion', transactionId: row.id, dimension: 'relationship' })}>Confirm</button>
        {!editing && <button type="button" className={btn} disabled={busy} onClick={() => setEditing(true)}>Choose something else…</button>}
        <button type="button" className={btnQuiet} disabled={busy} onClick={() => void onDecide({ action: 'reject_suggestion', transactionId: row.id, dimension: 'relationship' })}>Not this</button>
      </div>}
    </div>}
    {!row.pending && editing && <div className="space-y-2" data-testid="detail-rel-editor">
      <div role="group" aria-label="Relationship" className="flex flex-wrap gap-1.5">
        {REL_KINDS.map(k => <button key={k.key} type="button" aria-pressed={kind === k.key} disabled={busy} data-testid="detail-rel-kind" data-kind={k.key}
          onClick={() => { if (kind !== k.key) { setKind(k.key); setTarget('') } }}
          className={`${btn} text-[13px] ${kind === k.key ? 'bg-[var(--surface-selected)] ring-2 ring-[var(--text-primary)]' : ''}`}>{k.label}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {needsTarget && (targets.length > SHEET_AFTER
          ? <button type="button" className={`${btn} min-w-0 flex-1 text-left`} onClick={() => setPicking(true)} data-testid="detail-rel-target" data-value={target}>{targetLabel ?? `Which ${TARGET_NOUN[kind]}…`}</button>
          : <><label className="sr-only" htmlFor={`t-${row.id}`}>Which {TARGET_NOUN[kind]}</label>
            <SelectField id={`t-${row.id}`} className="min-w-0 flex-1" value={target} onChange={e => setTarget(e.target.value)}><option value="">Which {TARGET_NOUN[kind]}…</option>{targets.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</SelectField></>)}
        <button type="button" className={kind && (!needsTarget || target) ? btnPrimary : btn} disabled={busy || !kind || (needsTarget && !target)} onClick={sendRel}>Save</button>
        {r.state !== 'none' && <button type="button" className={btnQuiet} disabled={busy} onClick={() => { setEditing(false); setKind(confirmedKind); setTarget('') }}>Cancel</button>}
      </div>
      {needsTarget && <ChoiceSheet open={picking} testId="target-picker" eyebrow="Belongs to" title={`Choose a ${TARGET_NOUN[kind]}`} icon={<Link2 size={18} />}
        context={`${row.merchant} · ${row.direction === 'money_out' ? '−' : '+'}${usd2(row.amountMinor)} · ${shortDate(row.date)}`}
        options={targets.map(t => ({ key: t.value, label: t.label }))} currentKey={target || null} searchLabel={`Search ${TARGET_NOUN[kind]}s`}
        idleNote="Pick one, then Use. Nothing is saved until you tap Save." applyLabel="Use" changeNote={to => <>Use <span className="font-semibold text-[var(--text-primary)]">{to}</span>. Nothing is saved until you tap Save.</>}
        onClose={() => setPicking(false)} onApply={key => { setTarget(key); setPicking(false) }} />}
    </div>}
  </>
}

export function TransactionDetail({ row, options, busy, onDecide, loadHistory }: { row: ExplorerRow; options: Options; busy: boolean; onDecide: Decide; loadHistory: (id: string) => Promise<HistoryEntry[]> }) {
  const [picking, setPicking] = useState(false)
  const type = entryType(row)
  const b = row.bucket
  const account = row.account.mappedTo ?? row.account.label
  return <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--surface-line)] bg-[var(--bg-card)]" data-testid="spending-detail">
    <Band label="Bank evidence" title="Bank evidence">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2" data-testid="detail-evidence">
        <div className="min-w-0"><dt className="text-[11px] text-[var(--text-secondary)]">Bank description</dt><dd className="break-words font-mono text-[13px]">{row.name}</dd></div>
        <div className="min-w-0"><dt className="text-[11px] text-[var(--text-secondary)]">Account</dt>
          <dd className="break-words"><AccountColorDot accountId={row.account.financialAccountId} />{withMask(account, row.account.mask)}{account !== row.account.label ? <span className="text-[var(--text-secondary)]"> · bank: {row.account.label}</span> : null}</dd></div>
        <div><dt className="text-[11px] text-[var(--text-secondary)]">Date</dt><dd>{shortDate(row.date)} · {row.pending ? 'Pending' : 'Posted'}</dd></div>
        <div><dt className="text-[11px] text-[var(--text-secondary)]">Amount</dt><dd className="tabular-nums"><span className="font-semibold" style={{ color: toneColor(type.tone) }}>{row.direction === 'money_out' ? '−' : '+'}{usd2(row.amountMinor)}</span> <span className="text-[var(--text-secondary)]">· {type.glyph} {type.label}</span></dd></div>
      </dl>
      {row.pending && <p className="text-xs" style={{ color: 'var(--fin-warning)' }}>Pending: it can be categorized or ignored, but not given a relationship until it posts.</p>}
    </Band>

    <Band label="What was this money for?" title="Category · what was it for?">
      {b.state === 'suggested' && <div className="space-y-1.5 rounded-xl border border-dashed border-[var(--surface-line)] p-3" data-testid="detail-suggestion">
        <p className="flex flex-wrap items-center gap-2 text-sm">{b.label && <CategoryPill categoryKey={b.key} label={b.label} state="suggested" />}
          <span className="text-xs text-[var(--text-secondary)]">{CONF[b.confidence ?? 'low']} confidence <Meter level={b.confidence} /></span></p>
        <Reasons reasons={b.reasons} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void onDecide({ action: 'accept_suggestion', transactionId: row.id, dimension: 'bucket' })}>Confirm {b.label}</button>
          <button type="button" className={btn} disabled={busy} onClick={() => setPicking(true)} data-testid="detail-change-category">Choose another…</button>
          <button type="button" className={btnQuiet} disabled={busy} onClick={() => void onDecide({ action: 'reject_suggestion', transactionId: row.id, dimension: 'bucket' })}>Not this</button>
        </div>
      </div>}
      {b.state !== 'suggested' && <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 text-sm" data-testid="detail-category">{b.state === 'confirmed' && b.label
          ? <CategoryPill categoryKey={b.key} label={b.label} state="confirmed" />
          : <span className="text-[var(--text-secondary)]">No category confirmed yet</span>}</span>
        <button type="button" className={b.state === 'confirmed' ? btn : btnPrimary} disabled={busy} onClick={() => setPicking(true)} data-testid="detail-change-category">{b.state === 'confirmed' ? 'Change category…' : 'Choose category…'}</button>
        {b.state === 'confirmed' && <button type="button" className={btn} disabled={busy} onClick={() => void onDecide({ action: 'undo', transactionId: row.id, dimension: 'bucket' })}>Undo</button>}
      </div>}
      <BucketPicker open={picking} busy={busy} options={bucketChoicesFor(row, options)}
        currentKey={b.state === 'confirmed' ? b.key : null} suggestedKey={b.state === 'suggested' ? b.key : null}
        context={`${row.merchant} · ${row.direction === 'money_out' ? '−' : '+'}${usd2(row.amountMinor)} · ${shortDate(row.date)}`}
        onClose={() => setPicking(false)} onApply={key => { setPicking(false); void onDecide({ action: 'set_bucket', transactionId: row.id, bucket: key }) }} />
    </Band>

    <Band label="What does it belong to?" title="What does it belong to?"
      aside={<span className="text-xs text-[var(--text-secondary)]" data-testid="detail-scope">{row.scope.value === 'business' ? 'Business' : row.scope.value === 'personal' ? 'Personal' : 'Business or personal: unclear'}{row.scope.source === 'account' ? ' · from the account' : row.scope.source === 'owner' ? ' · you set this' : ''}</span>}>
      {!row.pending && <Relationship row={row} options={options} busy={busy} onDecide={onDecide} />}
      {row.pending && row.relationship.state !== 'none' && <p className="text-sm">{row.relationship.state === 'suggested' ? 'Suggested: ' : '✓ '}{row.relationship.label}{row.relationship.target?.label ? ` · ${row.relationship.target.label}` : ''}</p>}
      {!row.pending && <p className="text-xs text-[var(--text-secondary)]">To correct business or personal, choose “Personal” or “General overhead”.</p>}
    </Band>

    <Band label="History" title="Decision history"
      aside={row.review === 'ignored'
        ? <button type="button" className={btnQuiet} disabled={busy} onClick={() => void onDecide({ action: 'unignore', transactionId: row.id })}>Stop ignoring</button>
        : <button type="button" className={btnQuiet} disabled={busy} onClick={() => void onDecide({ action: 'ignore', transactionId: row.id })}>Ignore this transaction</button>}>
      <History id={row.id} load={loadHistory} />
      <p className="text-xs text-[var(--text-secondary)]">These choices label bank evidence only. They do not change your balances, ledger, bills, projects or reports.</p>
    </Band>
  </div>
}
