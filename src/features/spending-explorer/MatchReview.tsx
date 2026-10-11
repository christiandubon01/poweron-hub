/**
 * src/features/spending-explorer/MatchReview.tsx
 *
 * The Matches review (PLAID-3B): the owner sees which pairs of bank movements the app believes are ONE event (a move between their own accounts, or a payment
 * to their own credit card), why, and decides: confirm, "not a match", or reverse. A match is an interpretation of bank evidence only: it changes no balance,
 * ledger entry or account. Everything shown is a state the database really holds or a proposal the server just recomputed; nothing is invented here.
 *
 * Layout: one compact card per match. The two movements are compared side by side on a wide screen and stacked on a phone. The details (why, what
 * changed, history) stay one tap away. Buttons are 44px and carry the amount and accounts in their accessible names.
 */
import { useState } from 'react'
import { btn, btnPrimary, btnQuiet, eyebrow, panel } from './ui'
import { Chip, SegmentedControl, StatusBadge, type ChipTone } from './controls'
import { shortDate, usd2, withMask } from './format'
import { useMatchReview, type AmbiguousGroup, type MatchItem, type MatchTab, type RefundMatch } from './useMatchReview'
import type { MatchLeg } from '@/finance/bankMatchReview'

const KIND_LABEL: Record<MatchItem['kind'], string> = { internal_transfer: 'Move between your accounts', card_payment: 'Credit card payment' }
const STATE_LABEL: Record<MatchItem['state'], { text: string; tone: ChipTone }> = {
  suggested: { text: 'Suggested', tone: 'neutral' },
  waiting: { text: 'Waiting to post', tone: 'muted' },
  ambiguous: { text: 'Ambiguous', tone: 'warn' },
  confirmed: { text: '✓ Confirmed', tone: 'done' },
  rejected: { text: 'Not a match', tone: 'muted' },
  reversed: { text: 'Reversed', tone: 'neutral' },
  evidence_changed: { text: 'Evidence changed', tone: 'warn' },
}
const CLASS_LABEL: Record<string, string> = { bank_cash: 'Bank account', credit_card: 'Credit card', loan: 'Loan', investment: 'Investment', other: 'Account' }
const OWNERSHIP_LABEL = { business: 'Business', personal: 'Personal' } as const
const EVENT_LABEL: Record<string, string> = { confirmed: 'Confirmed', rejected: 'Marked not a match', reversed: 'Reversed', reconfirmed: 'Confirmed again', completed: 'Completed', superseded: 'Replaced' }
const TABS: Array<{ value: MatchTab; label: string }> = [{ value: 'review', label: 'To review' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'rejected', label: 'Not a match' }, { value: 'all', label: 'All' }]
const EMPTY: Record<MatchTab, string> = {
  review: 'Nothing to review. When two bank movements look like one event (a transfer between your accounts, a card payment), they appear here for you to confirm.',
  confirmed: 'No confirmed matches yet.',
  rejected: 'You have not marked any match as wrong.',
  all: 'No matches in this period.',
}
const days = (n: number | null) => (n === null ? '' : n === 0 ? 'same day' : `${n} day${n === 1 ? '' : 's'} apart`)
const longDate = (iso: string | null) => (iso ? shortDate(iso) : 'unknown date')

function Leg({ leg, role, kind }: { leg: MatchLeg; role: 'out' | 'in'; kind: MatchItem['kind'] }) {
  const a = leg.account
  const heading = role === 'out' ? 'Money out' : kind === 'card_payment' ? 'Payment on the card' : 'Money in'
  const amount = leg.amountMinor === null ? '—' : `${role === 'out' ? '−' : '+'}${usd2(leg.amountMinor)}`
  return <div className="min-w-0 rounded-xl bg-[var(--surface-1)] p-3 ring-1 ring-[var(--surface-line)]" data-testid="match-leg" data-role={role}>
    <p className={eyebrow}>{heading}</p>
    <p className="mt-1 truncate text-sm font-semibold" title={a?.label}>{a ? withMask(a.label, a.mask) : 'Account not available'}</p>
    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-[var(--text-secondary)]">
      {a?.institution && <span>{a.institution}</span>}
      {a?.ownership && <Chip tone="neutral">{OWNERSHIP_LABEL[a.ownership]}</Chip>}
      {a?.accountClass && <Chip tone="muted">{CLASS_LABEL[a.accountClass] ?? 'Account'}</Chip>}
      {!a?.ownership && a && <Chip tone="muted">Not linked to Cash OS</Chip>}
    </p>
    <p className="mt-2 flex items-baseline justify-between gap-3"><span className="text-xs text-[var(--text-secondary)]">{longDate(leg.date)}{leg.pending ? ' · pending' : ''}</span><span className="text-sm font-semibold tabular-nums" data-testid="match-leg-amount">{amount}</span></p>
    {(leg.name || leg.merchant) && <p className="mt-1 truncate text-xs text-[var(--text-secondary)]" title={leg.name ?? leg.merchant ?? undefined}>{leg.name ?? leg.merchant}</p>}
    {leg.missing && <p className="mt-1 text-xs" style={{ color: 'var(--fin-warning)' }}>No longer in your bank data.</p>}
  </div>
}

function Reasons({ reasons, open, onToggle, label }: { reasons: string[]; open: boolean; onToggle: () => void; label: string }) {
  if (!reasons.length) return null
  return <div className="mt-2">
    <button type="button" className={`${btnQuiet} -ml-3`} aria-expanded={open} onClick={onToggle} data-testid="match-why-toggle" aria-label={`${open ? 'Hide' : 'Show'} why: ${label}`}>{open ? '▾' : '▸'} Why this match?</button>
    {open && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--text-secondary)]" data-testid="match-why">{reasons.map(r => <li key={r}>{r}</li>)}</ul>}
  </div>
}

function MatchCard({ item, busy, canDecide, onDecide }: { item: MatchItem; busy: string | null; canDecide: boolean; onDecide: (item: MatchItem, decision: 'confirm' | 'reject' | 'reverse') => void }) {
  const [why, setWhy] = useState(false)
  const [reversing, setReversing] = useState(false)
  const st = STATE_LABEL[item.state]
  const mine = busy === item.key, off = busy !== null || !canDecide
  const label = `${usd2(item.amountMinor)} from ${item.outflow.account?.label ?? 'an account'} to ${item.inflow.account?.label ?? 'an account'}`
  const act = (decision: 'confirm' | 'reject' | 'reverse') => { setReversing(false); onDecide(item, decision) }
  return <li className={`${panel} space-y-2`} data-testid="match-card" data-state={item.state} data-kind={item.kind} data-needs-review={item.needsReview ? 'true' : 'false'} aria-label={`${KIND_LABEL[item.kind]}: ${label}`} aria-busy={mine}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">{KIND_LABEL[item.kind]}</p>
      <span className="flex flex-wrap items-center gap-1.5">
        <Chip tone={st.tone} testId="match-state">{st.text}</Chip>
        {item.confidence && item.state !== 'confirmed' && <Chip tone={item.confidence === 'high' ? 'neutral' : 'warn'} testId="match-confidence">{item.confidence === 'high' ? 'High confidence' : 'Possible'}</Chip>}
        {item.crossScope && <Chip tone="warn" testId="match-cross-scope">Business ↔ Personal</Chip>}
        {item.needsReview && item.state !== 'evidence_changed' && <StatusBadge state="needs_review" testId="match-needs-review" />}
      </span>
    </div>
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm"><span className="text-lg font-bold tabular-nums" data-testid="match-amount">{usd2(item.amountMinor)}</span><span className="text-xs text-[var(--text-secondary)]">{days(item.daysApart)}</span></p>
    <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch" data-testid="match-legs">
      <Leg leg={item.outflow} role="out" kind={item.kind} />
      <span aria-hidden="true" className="self-center text-center text-[var(--text-secondary)]"><span className="sm:hidden">↓</span><span className="hidden sm:inline">→</span></span>
      <Leg leg={item.inflow} role="in" kind={item.kind} />
    </div>
    {item.crossScope && <p className="text-xs" style={{ color: 'var(--fin-warning)' }} data-testid="match-cross-note">One account is business and the other is personal. Confirming records an owner contribution or draw, not an ordinary transfer. Check it before you confirm.</p>}
    {item.changes.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs" style={{ color: 'var(--fin-warning)' }} data-testid="match-changes" aria-label="What changed">{item.changes.map(c => <li key={c}>{c}</li>)}</ul>}
    <Reasons reasons={item.reasons} open={why} onToggle={() => setWhy(w => !w)} label={label} />
    {item.history.length > 0 && <p className="text-xs text-[var(--text-secondary)]" data-testid="match-history">{item.history.map(h => `${EVENT_LABEL[h.event] ?? h.event}${h.at ? ` ${shortDate(h.at.slice(0, 10))}` : ''}`).join(' · ')}</p>}
    {item.state === 'waiting' && <p className="text-xs text-[var(--text-secondary)]" data-testid="match-waiting">Both movements are still pending. You can decide once they post, so the amounts and dates you confirm are final.</p>}
    {item.actions.length > 0 && <div className="flex flex-wrap gap-2 pt-1" data-testid="match-actions">
      {item.actions.includes('confirm') && <button type="button" className={btnPrimary} disabled={off} onClick={() => act('confirm')} data-testid="match-confirm" aria-label={`Confirm match: ${label}`}>{mine ? 'Saving…' : 'Confirm match'}</button>}
      {item.actions.includes('reconfirm') && <button type="button" className={btnPrimary} disabled={off} onClick={() => act('confirm')} data-testid="match-reconfirm" aria-label={`Confirm again on the current evidence: ${label}`}>{mine ? 'Saving…' : 'Confirm again'}</button>}
      {item.actions.includes('reject') && <button type="button" className={btn} disabled={off} onClick={() => act('reject')} data-testid="match-reject" aria-label={`This is not a match: ${label}`}>Not a match</button>}
      {item.actions.includes('reverse') && !reversing && <button type="button" className={btn} disabled={off} onClick={() => setReversing(true)} data-testid="match-reverse" aria-label={`Reverse this confirmed match: ${label}`}>Reverse…</button>}
    </div>}
    {reversing && <div className="rounded-xl p-3 ring-1 ring-[var(--fin-warning-border)]" style={{ background: 'var(--fin-warning-tint)' }} role="group" aria-label="Confirm reversal" data-testid="match-reverse-panel">
      <p className="text-sm">Reverse this match? The two transactions go back to being undecided. Nothing is deleted and the bank data is not touched.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={off} onClick={() => act('reverse')} data-testid="match-reverse-confirm">Yes, reverse it</button>
        <button type="button" className={btnQuiet} onClick={() => setReversing(false)} data-testid="match-reverse-cancel">Keep it</button>
      </div>
    </div>}
  </li>
}

function GroupCard({ group, busy, canDecide, onPick }: { group: AmbiguousGroup; busy: string | null; canDecide: boolean; onPick: (g: AmbiguousGroup, c: AmbiguousGroup['candidates'][number]) => void }) {
  const [all, setAll] = useState(false)
  const sorted = [...group.candidates].sort((a, b) => a.daysApart - b.daysApart || a.outflowId.localeCompare(b.outflowId) || a.inflowId.localeCompare(b.inflowId))
  const shown = all ? sorted : sorted.slice(0, 6)
  const byId = new Map([...group.outflows, ...group.inflows].map(l => [l.id, l]))
  const off = busy !== null || !canDecide
  return <li className={`${panel} space-y-2`} data-testid="match-group" aria-label="Several movements could match each other">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Several movements could match</p><Chip tone="warn" testId="match-state">Ambiguous</Chip></div>
    <p className="text-xs text-[var(--text-secondary)]">{group.reasons[0] ?? 'More than one movement fits.'} Nothing is matched automatically. Pick the pair that is right, or leave them as they are.</p>
    <ul className="space-y-2">{shown.map(c => {
      const o = byId.get(c.outflowId), i = byId.get(c.inflowId)
      if (!o || !i) return null
      const label = `${o.account?.label ?? 'account'} ${longDate(o.date)} to ${i.account?.label ?? 'account'} ${longDate(i.date)}`
      return <li key={`${c.outflowId}:${c.inflowId}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface-1)] p-2.5 ring-1 ring-[var(--surface-line)]" data-testid="match-candidate">
        <span className="min-w-0 text-xs"><span className="font-semibold">{usd2(o.amountMinor ?? 0)}</span> · out of {o.account ? withMask(o.account.label, o.account.mask) : 'an account'} {longDate(o.date)} → into {i.account ? withMask(i.account.label, i.account.mask) : 'an account'} {longDate(i.date)} · {days(c.daysApart)}{c.crossScope ? ' · business ↔ personal' : ''}</span>
        <button type="button" className={btn} disabled={off} onClick={() => onPick(group, c)} data-testid="match-candidate-confirm" aria-label={`Match ${label}`}>Match these</button>
      </li>
    })}</ul>
    {sorted.length > shown.length && <button type="button" className={btnQuiet} onClick={() => setAll(true)} data-testid="match-candidates-more">Show all {sorted.length} possible pairs</button>}
  </li>
}

function RefundCard({ refund, busy, canDecide, onAct }: { refund: RefundMatch; busy: string | null; canDecide: boolean; onAct: (r: RefundMatch, act: 'accept' | 'reject' | 'undo') => void }) {
  const [why, setWhy] = useState(false)
  const off = busy !== null || !canDecide
  const amount = refund.refund.amountMinor === null ? '—' : usd2(refund.refund.amountMinor)
  const label = `refund of ${amount} on ${longDate(refund.refund.date)}`
  const stateTone: ChipTone = refund.state === 'confirmed' ? 'done' : refund.state === 'rejected' ? 'muted' : 'neutral'
  const stateText = refund.state === 'confirmed' ? '✓ Confirmed refund' : refund.state === 'rejected' ? 'Not a refund' : 'Suggested refund'
  return <li className={`${panel} space-y-2`} data-testid="match-refund" data-state={refund.state} aria-label={label}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-semibold">Possible refund</p>
      <span className="flex flex-wrap items-center gap-1.5"><Chip tone={stateTone} testId="match-state">{stateText}</Chip>{refund.confidence && <Chip tone={refund.confidence === 'high' ? 'neutral' : 'warn'}>{refund.confidence === 'ambiguous' ? 'Several purchases fit' : refund.confidence === 'high' ? 'High confidence' : 'Possible'}</Chip>}</span>
    </div>
    <div className="grid gap-2 sm:grid-cols-2">
      <Leg leg={refund.refund} role="in" kind="internal_transfer" />
      {refund.original ? <Leg leg={refund.original} role="out" kind="internal_transfer" />
        : refund.candidates.length > 0 ? <div className="rounded-xl bg-[var(--surface-1)] p-3 text-xs ring-1 ring-[var(--surface-line)]"><p className={eyebrow}>Could reverse one of</p><ul className="mt-1 space-y-0.5">{refund.candidates.slice(0, 5).map(c => <li key={c.id}>{longDate(c.date)} · {c.merchant ?? c.name ?? 'purchase'} · {c.amountMinor === null ? '—' : usd2(c.amountMinor)}</li>)}</ul></div> : null}
    </div>
    <p className="text-xs text-[var(--text-secondary)]">Confirming records that this money is a refund, so it is never counted as income. It does not link to one purchase yet.</p>
    <Reasons reasons={refund.reasons} open={why} onToggle={() => setWhy(w => !w)} label={label} />
    <div className="flex flex-wrap gap-2 pt-1">
      {refund.state === 'suggested' && <><button type="button" className={btnPrimary} disabled={off} onClick={() => onAct(refund, 'accept')} data-testid="match-refund-confirm" aria-label={`Confirm ${label}`}>Confirm refund</button>
        <button type="button" className={btn} disabled={off} onClick={() => onAct(refund, 'reject')} data-testid="match-refund-reject" aria-label={`This is not a refund: ${label}`}>Not a refund</button></>}
      {refund.state !== 'suggested' && <button type="button" className={btn} disabled={off} onClick={() => onAct(refund, 'undo')} data-testid="match-refund-undo" aria-label={`Undo the decision on this ${label}`}>Undo</button>}
    </div>
  </li>
}

/** The Matches review. Renders nothing at all unless the server says it is enabled for this caller. */
export default function MatchReview({ onChanged }: { onChanged?: () => void }) {
  const m = useMatchReview(true)
  const { data, items, load, tab, busy, message } = m
  if (load === 'disabled') return <p className="mt-3 text-sm text-[var(--text-secondary)]" data-testid="match-disabled">Match review is not turned on for this workspace.</p>
  if (load === 'loading' && !data) return <p className="mt-3 text-sm text-[var(--text-secondary)]" data-testid="match-loading" role="status">Looking for matches…</p>
  if (load === 'error' && !data) return <div className="mt-3" data-testid="match-error"><p role="alert" className="text-sm">{message?.text ?? 'Matches could not be loaded.'}</p><button type="button" className={`${btn} mt-2`} onClick={() => void m.refresh()}>Try again</button></div>
  const counts = data?.counts
  const canDecide = data?.decisionsAvailable === true
  const groups = data?.groups ?? [], refunds = data?.refunds ?? []
  const tabCounts: Record<MatchTab, number | null> = counts
    ? { review: counts.suggested + counts.reversed + counts.waiting + counts.evidence_changed + counts.ambiguous, confirmed: counts.confirmed, rejected: counts.rejected, all: null }
    : { review: null, confirmed: null, rejected: null, all: null }
  const done = async (p: Promise<void>) => { await p; onChanged?.() }
  const decide = (item: MatchItem, decision: 'confirm' | 'reject' | 'reverse') => void done(m.decide(item.key, decision, { outflowId: item.outflow.id, inflowId: item.inflow.id, fingerprint: item.fingerprint }))
  const pick = (g: AmbiguousGroup, c: AmbiguousGroup['candidates'][number]) => void done(m.decide(g.key, 'confirm', { outflowId: c.outflowId, inflowId: c.inflowId, fingerprint: c.fingerprint }))
  const refundAct = (r: RefundMatch, a: 'accept' | 'reject' | 'undo') => void done(a === 'undo'
    ? m.decideRefund(r.key, { action: 'undo', transactionId: r.refund.id, dimension: 'bucket' }, 'Decision undone. The refund is undecided again.')
    : m.decideRefund(r.key, { action: a === 'accept' ? 'accept_suggestion' : 'reject_suggestion', transactionId: r.refund.id, dimension: 'bucket' }, a === 'accept' ? 'Confirmed as a refund. It is not counted as income.' : 'Marked as not a refund.'))
  const showRefunds = tab === 'review' || tab === 'all' ? refunds : refunds.filter(r => (tab === 'confirmed' && r.state === 'confirmed') || (tab === 'rejected' && r.state === 'rejected'))
  const empty = items.length === 0 && groups.length === 0 && showRefunds.length === 0
  return <div className="mt-3 space-y-3" data-testid="match-review">
    <p className="text-xs text-[var(--text-secondary)]" data-testid="match-contract">{data?.contract ?? 'A match is your statement that two bank movements are the same event. It labels bank evidence only.'}</p>
    {data?.decisionsAvailable === false && <p className="rounded-xl p-3 text-sm ring-1 ring-[var(--fin-warning-border)]" style={{ background: 'var(--fin-warning-tint)' }} role="status" data-testid="match-readonly">You can look at proposed matches, but deciding needs a database update that has not been installed yet. Nothing here can be saved until then.</p>}
    {data?.coverage?.complete === false && <p className="rounded-xl p-3 text-xs ring-1 ring-[var(--surface-line)]" role="status" data-testid="match-coverage">Incomplete history · {data.coverage.reason} Matches near the edge of the loaded history may be missing.</p>}
    <SegmentedControl role="tablist" label="Match status" value={tab} onChange={m.setTab} options={TABS.map(t => ({ value: t.value, label: t.label, count: tabCounts[t.value], testId: `match-tab-${t.value}` }))} />
    {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className="rounded-xl bg-[var(--surface-1)] p-3 text-sm ring-1 ring-[var(--surface-line)]" style={message.kind === 'error' ? { color: 'var(--fin-negative)' } : undefined} data-testid="match-message" data-kind={message.kind}>{message.text}</p>}
    {empty && <p className="text-sm text-[var(--text-secondary)]" data-testid="match-empty">{EMPTY[tab]}</p>}
    {groups.length > 0 && <ul className="space-y-2" aria-label="Movements that could match several ways">{groups.map(g => <GroupCard key={g.key} group={g} busy={busy} canDecide={canDecide} onPick={pick} />)}</ul>}
    {items.length > 0 && <ul className="space-y-2" aria-label="Matches" data-testid="match-list">{items.map(i => <MatchCard key={i.key} item={i} busy={busy} canDecide={canDecide} onDecide={decide} />)}</ul>}
    {(data?.total ?? 0) > items.length && <button type="button" className={btn} disabled={busy !== null} onClick={() => void m.loadMore()} data-testid="match-more">Show more ({(data?.total ?? 0) - items.length} left)</button>}
    {showRefunds.length > 0 && <section aria-label="Refunds"><p className={eyebrow}>Refunds</p><ul className="mt-2 space-y-2" data-testid="match-refunds">{showRefunds.map(r => <RefundCard key={r.key} refund={r} busy={busy} canDecide={canDecide} onAct={refundAct} />)}</ul></section>}
  </div>
}
