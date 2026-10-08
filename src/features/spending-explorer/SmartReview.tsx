import { useEffect, useMemo, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from './reviewDraft'
import { useSmartReview, type SmartBatchResult, type SmartException, type SmartGroup, type SmartRow } from './useSmartReview'

const NS = 'smart'
const btn = 'min-h-[44px] rounded-lg px-3 text-sm font-semibold ring-1 ring-[var(--border-primary)] hover:bg-white/5 disabled:opacity-50'
const field = 'min-h-[44px] rounded-lg bg-transparent px-2 text-sm ring-1 ring-[var(--border-primary)]'
const usd2 = (minor: number) => `$${(Math.abs(minor) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const CONF: Record<string, string> = { high: 'High', possible: 'Possible', low: 'Low' }
const FLAG_TEXT: Record<string, string> = {
  unusual_amount: 'Unusually large for this merchant', possible_duplicate: 'Same amount on the same day', history_conflict: 'You categorized this merchant differently before',
  provider_disagrees: "The bank's own category disagrees",
}
const SKIP_TEXT: Record<string, string> = {
  pending: 'still pending', money_in: 'money coming in', no_suggestion: 'nothing recognised', not_high_confidence: 'not a confident match', needs_individual_review: 'needs your individual decision',
  mixed_purpose: 'needs you to pick the category', relationship_suggested: 'also suggests a bill, payroll, transfer or project', already_decided: 'already decided', not_found: 'not found', failed: 'could not be saved',
}
export const smartSummary = (r: SmartBatchResult): string => {
  const reasons = new Map<string, number>()
  for (const x of r.results) if (x.result === 'skipped' && x.reason) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1)
  const left = [...reasons].map(([k, n]) => `${n} ${SKIP_TEXT[k] ?? k}`).join(', ')
  const rules = r.rules?.saved.length ? ` Remembered: ${r.rules.saved.map(x => `${x.label} → ${x.category.replace(/_/g, ' ')}`).join(', ')}.` : ''
  const notSaved = r.rules?.skipped.length ? ` ${r.rules.skipped.length} merchant${r.rules.skipped.length === 1 ? '' : 's'} could not be remembered; the approvals were still saved.` : ''
  return `Approved ${r.confirmed}${r.unchanged ? ` (${r.unchanged} already approved)` : ''}.${r.skipped ? ` ${r.skipped} left for you: ${left}.` : ''}${rules}${notSaved}`
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'warn' | 'muted' }) {
  const color = tone === 'ok' ? 'var(--fin-positive)' : tone === 'warn' ? 'var(--fin-negative)' : 'var(--text-secondary)'
  return <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-[var(--border-primary)]" style={{ color }}>{children}</span>
}

function ExceptionRow({ row, buckets, busy, onSave }: { row: SmartException; buckets: Array<{ key: string; label: string; flow?: 'in' | 'out' }>; busy: boolean; onSave: (id: string, bucket: string) => void }) {
  const [pick, setPick] = useState('')
  const choices = buckets.filter(b => (row.direction === 'money_in' ? (b.flow === 'in' || ['transfers', 'personal_owner', 'other_needs_review'].includes(b.key)) : b.flow !== 'in'))
  return <li className="py-2" data-testid="smart-exception-row">
    <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-sm font-semibold">{row.merchant}</span><span className="shrink-0 text-sm">{row.direction === 'money_in' ? '+' : '−'}{usd2(row.amountMinor)}</span></div>
    <p className="text-xs text-[var(--text-secondary)]">{shortDate(row.date)} · {row.why}{row.suggested.label ? ` Suggested: ${row.suggested.label}${row.suggested.confidence ? ` (${CONF[row.suggested.confidence]})` : ''}.` : ''}</p>
    {row.direction !== 'zero' && <div className="mt-1 flex gap-2">
      <select aria-label={`Category for ${row.merchant}`} className={`${field} min-w-0 flex-1`} value={pick} onChange={e => setPick(e.target.value)}><option value="">Choose a category…</option>{choices.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}</select>
      <button type="button" className={btn} disabled={busy || !pick || row.reason === 'pending'} onClick={() => onSave(row.id, pick)}>Save</button>
    </div>}
  </li>
}

/**
 * Smart Review: the owner's unreviewed spending grouped by merchant and suggested category, with the unusual cases set apart. Everything is a SUGGESTION
 * until the owner approves it; remembered categories only improve suggestions; the server re-decides every row when the owner confirms; and approving labels
 * bank evidence only (no ledger, balance, bill, project or payroll is touched).
 */
export default function SmartReview({ onChanged }: { onChanged?: () => void }) {
  const { data, state, busy, message, approve, forget, setBucket, refresh } = useSmartReview()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [choices, setChoices] = useState<Map<string, string>>(new Map()) // group id -> category the owner picked for the group
  const [remember, setRemember] = useState<Set<string>>(new Set()) // group ids whose merchant the owner asked to remember
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [showRules, setShowRules] = useState(false)
  const restored = useRef(false)
  const scope = data?.draftScope ?? null
  const max = data?.maxBatch ?? 100

  const groups = data?.groups ?? []
  const groupOfRow = useMemo(() => { const m = new Map<string, SmartGroup>(); for (const g of groups) for (const r of g.rows) m.set(r.id, g); return m }, [groups])
  const rowById = useMemo(() => { const m = new Map<string, SmartRow>(); for (const g of groups) for (const r of g.rows) m.set(r.id, r); return m }, [groups])
  const labelOf = (key: string) => data?.options.buckets.find(b => b.key === key)?.label ?? key
  const effective = (g: SmartGroup) => choices.get(g.id) ?? (g.needsChoice ? null : g.bucket.key)

  // Restore the saved draft ONCE per page load. Only ids that Smart Review still lists are kept; a restored draft never carries an approval.
  useEffect(() => {
    if (state !== 'ready' || !data || !scope || restored.current) return
    restored.current = true
    const wanted = loadDraft(scope, Date.now(), NS)
    if (!wanted) return
    const sel = new Set<string>(), ch = new Map<string, string>()
    for (const id of wanted.ids) {
      const g = groupOfRow.get(id)
      if (!g || sel.size >= max) continue
      const o = wanted.overrides[id]
      if (g.needsChoice && !o) continue
      if (o && data.options.batchBuckets.includes(o)) ch.set(g.id, o)
      sel.add(id)
    }
    setSelected(sel); setChoices(ch)
    // The saved "Remember this category" choice returns as an UNCONFIRMED draft choice only. Restoring never saves a rule or approves anything.
    if (data.rulesAvailable) setRemember(new Set((wanted.remember ?? []).filter(id => sel.has(id)).map(id => groupOfRow.get(id)!.id)))
    const dropped = wanted.ids.length - sel.size
    if (sel.size) setNote(`Restored ${sel.size} selected transaction${sel.size === 1 ? '' : 's'} from earlier${dropped ? `; ${dropped} no longer need review` : ''}. Nothing was approved.`)
  }, [state, data, scope, groupOfRow, max])

  // After every refresh, drop selections and choices that no longer exist (approved elsewhere, or reclassified).
  useEffect(() => {
    if (!data) return
    setSelected(prev => { const next = new Set([...prev].filter(id => groupOfRow.has(id))); return next.size === prev.size ? prev : next })
    setChoices(prev => { const ids = new Set(groups.map(g => g.id)); const next = new Map([...prev].filter(([k]) => ids.has(k))); return next.size === prev.size ? prev : next })
  }, [data, groupOfRow, groups])

  const chosen = [...selected].filter(id => groupOfRow.has(id))
  useEffect(() => {
    if (!scope || !restored.current) return
    const overrides: Record<string, string> = {}
    for (const id of chosen) { const g = groupOfRow.get(id); const c = g && choices.get(g.id); if (c) overrides[id] = c }
    const rememberIds = [...remember].map(gid => chosen.find(id => groupOfRow.get(id)?.id === gid)).filter((x): x is string => !!x)
    saveDraft(scope, { ids: chosen, off: [], overrides, remember: rememberIds }, Date.now(), NS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, choices, remember, scope])

  if (state === 'loading') return <p className="mt-3 text-sm text-[var(--text-secondary)]" data-testid="smart-loading">Loading Smart Review…</p>
  if (state === 'error' || !data) return <p className="mt-3 text-sm" role="alert" data-testid="smart-error">Smart Review is not available right now. {message ?? ''}</p>

  const touch = () => { setConfirming(false); setNote(null) }
  const totalOut = chosen.reduce((s, id) => s + (rowById.get(id)?.amountMinor ?? 0), 0)
  const breakdown = (() => {
    const m = new Map<string, { label: string; count: number; totalMinor: number }>()
    for (const id of chosen) { const g = groupOfRow.get(id)!; const key = effective(g) ?? g.bucket.key; const e = m.get(key) ?? { label: labelOf(key), count: 0, totalMinor: 0 }; e.count += 1; e.totalMinor += rowById.get(id)!.amountMinor; m.set(key, e) }
    return [...m.values()].sort((a, b) => b.totalMinor - a.totalMinor)
  })()
  const rememberedGroups = groups.filter(g => remember.has(g.id) && chosen.some(id => groupOfRow.get(id) === g) && data.rulesAvailable)

  const addMany = (ids: string[]) => {
    setSelected(prev => {
      const next = new Set(prev)
      for (const id of ids) { if (next.size >= max) { setNote(`You can approve at most ${max} at a time.`); break }; next.add(id) }
      return next
    })
  }
  const dropMany = (ids: string[]) => {
    const next = new Set(selected); for (const id of ids) next.delete(id)
    setSelected(next)
    // A "Remember" choice belongs to a selection: a group with nothing selected any more falls back to the default (don't remember).
    setRemember(prev => { const keep = new Set([...prev].filter(gid => [...next].some(id => groupOfRow.get(id)?.id === gid))); return keep.size === prev.size ? prev : keep })
  }
  const unflagged = (g: SmartGroup) => g.rows.filter(r => r.flags.length === 0).map(r => r.id)
  const toggleRow = (g: SmartGroup, r: SmartRow) => {
    touch()
    if (selected.has(r.id)) { dropMany([r.id]); return }
    if (g.needsChoice && !choices.get(g.id)) { setNote(`Choose a category for ${g.merchant} first. This merchant is not approved on a suggestion alone.`); return }
    addMany([r.id])
  }
  const toggleGroup = (g: SmartGroup) => {
    touch()
    const ids = unflagged(g)
    const all = ids.length > 0 && ids.every(id => selected.has(id))
    if (all) { dropMany(g.rows.map(r => r.id)); return }
    if (g.needsChoice && !choices.get(g.id)) { setChoices(prev => new Map(prev).set(g.id, g.bucket.key)) } // the owner tapped "Use <category>": an explicit choice
    addMany(ids)
  }
  const chooseCategory = (g: SmartGroup, key: string) => {
    touch()
    if (!key) { setChoices(prev => { const n = new Map(prev); n.delete(g.id); return n }); dropMany(g.rows.map(r => r.id)); return }
    setChoices(prev => new Map(prev).set(g.id, key))
    addMany(unflagged(g))
  }
  const toggleOpen = (id: string) => setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleRemember = (g: SmartGroup, on: boolean) => { touch(); setRemember(prev => { const n = new Set(prev); if (on) n.add(g.id); else n.delete(g.id); return n }) }
  const clearAll = () => { setSelected(new Set()); setChoices(new Map()); setRemember(new Set()); setConfirming(false); setNote(null); if (scope) clearDraft(scope, NS) }

  const approveSelected = async () => {
    const overrides: Record<string, string> = {}
    for (const id of chosen) {
      const g = groupOfRow.get(id)!, key = effective(g)
      if (key && (g.needsChoice || key !== g.bucket.key)) overrides[id] = key // an explicit owner category; an unchanged confident suggestion needs none
    }
    const rememberIds = rememberedGroups.map(g => chosen.find(id => groupOfRow.get(id) === g)!).filter(Boolean)
    const out = await approve(chosen, overrides, rememberIds)
    setConfirming(false)
    if (out) { setNote(smartSummary(out)); setSelected(new Set()); setChoices(new Map()); setRemember(new Set()); if (scope) clearDraft(scope, NS); onChanged?.() }
  }

  return <div className="mt-3" data-testid="smart-review">
    <p className="text-xs text-[var(--text-secondary)]">Your unreviewed spending, grouped by merchant. Open a group to see every transaction.</p>
    <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs" data-testid="smart-steps" aria-label="How Smart Review works">
      <li><span className="font-semibold">1.</span> Select transactions</li><li><span className="font-semibold">2.</span> Check the category</li><li><span className="font-semibold">3.</span> Approve selected</li>
    </ol>
    <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Selecting and choosing categories saves nothing. Only <span className="font-semibold">Confirm approval</span> saves, and it only labels bank records.</p>
    <p className="mt-1 text-sm font-semibold" data-testid="smart-totals">{data.totals.groupedCount} in {data.totals.groups} group{data.totals.groups === 1 ? '' : 's'} · {usd2(data.totals.groupedMinor)} going out{data.totals.exceptionCount > 0 ? ` · ${data.totals.exceptionCount} set aside for you` : ''}</p>
    {note && <p className="mt-1 text-xs" role="status" data-testid="smart-note">{note}</p>}
    {message && <p role="alert" className="mt-1 text-sm" style={{ color: 'var(--fin-negative)' }}>{message}</p>}

    {data.merchantRules.length > 0 && <div className="mt-2">
      <button type="button" className={btn} aria-expanded={showRules} onClick={() => setShowRules(s => !s)} data-testid="smart-rules-toggle">Remembered categories · {data.merchantRules.length}</button>
      {showRules && <ul className="mt-2 space-y-1" data-testid="smart-rules">{data.merchantRules.map(r => <li key={r.merchantKey} className="flex items-center justify-between gap-2 text-sm">
        <span className="min-w-0 truncate">{r.label} → {r.categoryLabel}</span>
        <button type="button" className={btn} disabled={busy} onClick={() => void forget(r.merchantKey)} aria-label={`Forget ${r.label}`}>Forget</button></li>)}
        <li className="text-xs text-[var(--text-secondary)]">A remembered category only improves suggestions for that merchant. Earlier approvals are not changed, and every transaction still needs your approval.</li></ul>}
    </div>}

    {groups.length === 0 && <p className="mt-3 text-sm text-[var(--text-secondary)]" data-testid="smart-empty">Nothing is waiting in a group. {data.totals.exceptionCount > 0 ? 'The transactions below need your individual decision.' : 'You are caught up.'}</p>}
    <ul className="mt-2 space-y-2" data-testid="smart-groups">{groups.map(g => {
      const isOpen = open.has(g.id)
      const sel = g.rows.filter(r => selected.has(r.id))
      const ids = unflagged(g)
      const allOn = ids.length > 0 && ids.every(id => selected.has(id))
      const choice = choices.get(g.id)
      const origin = g.basis === 'owner_rule' ? <Chip tone="ok">Your remembered rule</Chip> : choice ? <Chip tone="ok">Your choice</Chip> : <Chip>Suggestion</Chip>
      const selTotal = sel.reduce((s, r) => s + r.amountMinor, 0)
      const rememberOn = sel.length > 0 && remember.has(g.id)
      return <li key={g.id} className="rounded-xl border border-[var(--border-primary)] p-3" data-testid="smart-group" data-merchant={g.merchantKey} data-selected={sel.length}>
        <button type="button" className="flex min-h-[44px] w-full items-start justify-between gap-3 text-left" aria-expanded={isOpen} onClick={() => toggleOpen(g.id)} data-testid="smart-group-header">
          <span className="min-w-0"><span className="block truncate text-sm font-semibold">{g.merchant}</span>
            <span className="text-xs text-[var(--text-secondary)]">{g.count} transaction{g.count === 1 ? '' : 's'} · {usd2(g.totalMinor)}</span></span>
          <span className="shrink-0 text-xs text-[var(--text-secondary)]">{isOpen ? 'Hide' : 'Show'}</span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Chip>{g.bucket.label}</Chip><Chip tone={g.confidence === 'high' ? 'ok' : 'muted'}>{CONF[g.confidence]}</Chip>{origin}
          {g.mixed && <Chip tone="warn">Mixed purpose</Chip>}{g.flaggedCount > 0 && <Chip tone="warn">{g.flaggedCount} to check</Chip>}
        </div>
        {g.needsChoice && <p className="mt-1 text-xs text-[var(--text-secondary)]">{g.mixed ? `${g.merchant} is used for different purposes, so you pick the category.` : 'This is not a confident match, so you pick the category.'}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={`${btn} ${allOn ? 'bg-white/10' : ''}`} role="checkbox" aria-checked={allOn} disabled={busy || ids.length === 0} onClick={() => toggleGroup(g)} data-testid="smart-group-select">
            {allOn ? 'Selected' : g.needsChoice ? `Use ${g.bucket.label} for ${ids.length}` : `Select ${ids.length}`}</button>
          <select aria-label={`Category for ${g.merchant}`} className={`${field} min-w-0`} value={choice ?? (g.needsChoice ? '' : g.bucket.key)} onChange={e => chooseCategory(g, e.target.value)} disabled={busy} data-testid="smart-group-category">
            {g.needsChoice && <option value="">Choose a category…</option>}
            {data.options.buckets.filter(b => data.options.batchBuckets.includes(b.key)).map(b => <option key={b.key} value={b.key}>{b.label}{b.key === g.bucket.key ? ' (suggested)' : ''}</option>)}
          </select>
        </div>
        {g.flaggedCount > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]">{g.flaggedCount} flagged transaction{g.flaggedCount === 1 ? ' is' : 's are'} not included when you select the group. Open the group to choose them yourself.</p>}
        {sel.length > 0 && <p className="mt-2 text-xs font-semibold" aria-live="polite" data-testid="smart-group-selected">{sel.length} selected · {usd2(selTotal)} <span className="font-normal text-[var(--text-secondary)]">· not approved yet</span></p>}
        {data.rulesAvailable
          ? <fieldset className="mt-2" data-testid="smart-remember">
              <legend className="text-xs text-[var(--text-secondary)]">For future {g.merchant} transactions</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                <button type="button" className={`${btn} ${!rememberOn ? 'bg-white/10' : ''}`} aria-pressed={!rememberOn} disabled={busy} onClick={() => toggleRemember(g, false)} data-testid="smart-this-only">Don't remember</button>
                <button type="button" className={`${btn} ${rememberOn ? 'bg-white/10' : ''}`} aria-pressed={rememberOn} disabled={busy || sel.length === 0} onClick={() => toggleRemember(g, true)} data-testid="smart-remember-on">Remember this category</button>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="smart-remember-hint">{sel.length === 0
                ? 'Select a transaction first to remember its category.'
                : rememberOn
                  ? `Future ${g.merchant} transactions will be suggested as ${labelOf(effective(g) ?? g.bucket.key)}. They still need your approval. Saved only when you confirm.`
                  : 'Default: nothing is remembered. Remembering only suggests a category next time; it never approves anything.'}</p>
            </fieldset>
          : <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="smart-remember-unavailable">Remembering categories for future transactions is not available right now. Approving still works for the transactions you select.</p>}
        {isOpen && <ul className="mt-2 divide-y divide-[var(--border-primary)]" data-testid="smart-group-rows">{g.rows.map(r => {
          const on = selected.has(r.id)
          return <li key={r.id}>
            <button type="button" role="checkbox" aria-checked={on} disabled={busy} onClick={() => toggleRow(g, r)} className={`flex min-h-[44px] w-full items-center gap-3 py-2 text-left ${on ? 'bg-white/5' : ''}`} data-testid="smart-row" data-selected={on ? 'true' : 'false'}>
              <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded ring-1 ring-[var(--border-primary)]">{on ? '✓' : ''}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{shortDate(r.date)} · {r.name}</span>
                {r.flags.length > 0 && <span className="block text-xs" style={{ color: 'var(--fin-negative)' }}>{r.flags.map(f => FLAG_TEXT[f] ?? f).join(' · ')}</span>}</span>
              <span className="shrink-0 text-sm">{usd2(r.amountMinor)}</span>
            </button></li>
        })}</ul>}
      </li>
    })}</ul>

    {data.exceptions.length > 0 && <div className="mt-4" data-testid="smart-exceptions">
      <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">Needs your individual decision</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">These are never approved together: money in, owner draws and personal, payroll, transfers, bills and projects, pending items, and anything unclear.</p>
      <ul className="mt-2 space-y-2">{data.exceptions.map(e => {
        const isOpen = open.has(`ex:${e.reason}`)
        return <li key={e.reason} className="rounded-xl border border-[var(--border-primary)] p-3" data-testid="smart-exception-group" data-reason={e.reason}>
          <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left" aria-expanded={isOpen} onClick={() => toggleOpen(`ex:${e.reason}`)}>
            <span className="text-sm font-semibold">{e.label}</span><span className="shrink-0 text-xs text-[var(--text-secondary)]">{e.count} · {usd2(e.totalMinor)}</span></button>
          {isOpen && <ul className="mt-1 divide-y divide-[var(--border-primary)]">{e.rows.map(r => <ExceptionRow key={r.id} row={r} buckets={data.options.buckets} busy={busy} onSave={(id, bucket) => { void setBucket(id, bucket).then(() => onChanged?.()) }} />)}
            {e.count > e.rows.length && <li className="py-2 text-xs text-[var(--text-secondary)]">Showing {e.rows.length} of {e.count}. The rest are in the Explorer list.</li>}</ul>}
        </li>
      })}</ul>
    </div>}

    {chosen.length > 0 && <div className="sticky bottom-2 z-10 mt-3 space-y-2 rounded-xl border-2 bg-[var(--bg-card)] p-3 shadow-lg" style={{ borderColor: 'var(--fin-cash)' }} data-testid="smart-selection-bar" role="region" aria-label="Selected transactions">
      <p className="text-sm font-semibold" aria-live="polite"><span data-testid="smart-selected-count">{chosen.length} selected</span> <span className="font-normal text-[var(--text-secondary)]">· {usd2(totalOut)} going out · not approved yet</span></p>
      {confirming
        ? <section role="alertdialog" aria-label="Confirm approval" data-testid="smart-confirm" className="space-y-2 rounded-lg border border-[var(--border-primary)] p-3">
            <p className="text-sm font-semibold">Approve {chosen.length} transaction{chosen.length === 1 ? '' : 's'}?</p>
            <ul className="text-sm" data-testid="smart-confirm-breakdown">{breakdown.map(b => <li key={b.label} className="flex justify-between gap-3"><span>{b.label} · {b.count}</span><span>{usd2(b.totalMinor)}</span></li>)}</ul>
            <p className="flex justify-between gap-3 border-t border-[var(--border-primary)] pt-2 text-sm font-semibold"><span>Total going out</span><span>{usd2(totalOut)}</span></p>
            {rememberedGroups.length > 0
              ? <p className="text-sm" data-testid="smart-confirm-remember">Also remember: {rememberedGroups.map(g => `${g.merchant} → ${labelOf(effective(g) ?? g.bucket.key)}`).join(', ')}. Future matching transactions will be suggested this way; you still approve each one.</p>
              : <p className="text-xs text-[var(--text-secondary)]" data-testid="smart-confirm-no-remember">No category will be remembered for future transactions.</p>}
            <p className="text-xs text-[var(--text-secondary)]">This labels these bank records with the categories shown. It does not change your balances, ledger, bills, payroll or reports, and each one can be undone.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`${btn} bg-white/10`} disabled={busy} onClick={() => void approveSelected()} data-testid="smart-confirm-approve">Confirm approval</button>
              <button type="button" className={btn} disabled={busy} onClick={() => setConfirming(false)} data-testid="smart-confirm-cancel">Cancel</button>
            </div>
          </section>
        : <div className="flex flex-wrap gap-2">
            <button type="button" className={`${btn} bg-white/10`} disabled={busy} onClick={() => setConfirming(true)} data-testid="smart-approve">Approve selected…</button>
            <button type="button" className={btn} disabled={busy} onClick={clearAll} data-testid="smart-clear">Clear selection</button>
          </div>}
    </div>}
    <button type="button" className={`${btn} mt-3`} disabled={busy} onClick={() => void refresh()}>Refresh</button>
  </div>
}
