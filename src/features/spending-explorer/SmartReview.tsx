import { useEffect, useMemo, useRef, useState } from 'react'
import { clearDraft, loadDraft, saveDraft } from './reviewDraft'
import { CategoryPill, StripeBar, useDisplayColors } from '@/features/display-colors/DisplayColors'
import { categoryStripe } from '@/features/display-colors/stripes'
import { useSmartReview, type SmartBatchResult, type SmartException, type SmartGroup, type SmartRow } from './useSmartReview'

const NS = 'smart'
import { btn, btnPrimary, btnSel, focusRing } from './ui'
import { Chip, SegmentedControl } from './controls'
import { Check } from 'lucide-react'
import { entryType, toneColor } from './entryType'
import { CONF, shortDate, usd2 } from './format'
import { BucketPicker } from './BucketPicker'
import { HierarchyProvider, type DefinitionSave } from './HierarchyProvider'
import { isBucketKey } from '@/finance/bankSpendingTaxonomy'
import { ApprovalConfirm, SelectionBar } from './SelectionBar'
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

function ExceptionRow({ row, buckets, busy, onSave }: { row: SmartException; buckets: Array<{ key: string; label: string; hint?: string; flow?: 'in' | 'out' }>; busy: boolean; onSave: (id: string, bucket: string) => void }) {
  const [picking, setPicking] = useState(false)
  const { categoryColor } = useDisplayColors()
  // Display only: the suggestion (if any) is the only interpretation an exception row has, so its kind reads "Likely …" or plain Money in / out.
  const type = entryType({ direction: row.direction, bucket: { key: row.suggested.key, state: row.suggested.key ? 'suggested' : 'none' }, relationship: { kind: 'unknown', state: 'none' } })
  const choices = buckets.filter(b => (row.direction === 'money_in' ? (b.flow === 'in' || ['transfers', 'personal_owner', 'other_needs_review'].includes(b.key)) : b.flow !== 'in'))
  return <li className="relative py-2 pl-3" data-testid="smart-exception-row">
    <StripeBar stripe={categoryStripe({ key: row.suggested.key, state: row.suggested.key ? 'suggested' : 'none' }, categoryColor)} />
    <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 truncate text-sm font-semibold">{row.merchant}</span>
      <span className="shrink-0 text-right"><span className="block text-sm font-semibold tabular-nums" style={{ color: toneColor(type.tone) }}>{row.direction === 'money_in' ? '+' : '−'}{usd2(row.amountMinor)}</span>
        <span className="block text-[11px] font-semibold" style={{ color: toneColor(type.tone) ?? 'var(--text-secondary)' }} data-testid="entry-type" data-kind={type.kind}><span aria-hidden="true">{type.glyph} </span>{type.label}</span></span></div>
    <p className="text-xs text-[var(--text-secondary)]">{shortDate(row.date)} · {row.why}{row.suggested.label ? ` Suggested: ${row.suggested.label}${row.suggested.confidence ? ` (${CONF[row.suggested.confidence]})` : ''}.` : ''}</p>
    {/* BANK-6F: chosen in the shared category sheet; "Save category" sends the same individual set_bucket the old Save did. */}
    {row.direction !== 'zero' && <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <button type="button" className={btn} disabled={busy || row.reason === 'pending'} onClick={() => setPicking(true)} data-testid="smart-exception-category" aria-label={`Choose a category for ${row.merchant}`}>Choose category…</button>
      {row.reason === 'pending' && <span className="text-xs text-[var(--text-secondary)]">Can be categorized once it posts.</span>}
    </div>}
    <BucketPicker open={picking} busy={busy} allowCustom={row.direction !== 'money_in'} options={choices} currentKey={null} suggestedKey={row.suggested.key} applyLabel="Save category" eyebrow="Individual decision"
      title={`Category for ${row.merchant}`} context={`${row.direction === 'money_in' ? '+' : '−'}${usd2(row.amountMinor)} · ${shortDate(row.date)}`}
      idleNote="Pick a category, then Save category. This labels this one bank record only."
      changeNote={to => <>Save <span className="font-semibold text-[var(--text-primary)]">{to}</span> for this transaction. This labels this one bank record only.</>}
      onClose={() => setPicking(false)} onApply={key => { setPicking(false); onSave(row.id, key) }} />
  </li>
}

/**
 * Smart Review: the owner's unreviewed spending grouped by merchant and suggested category, with the unusual cases set apart. Everything is a SUGGESTION
 * until the owner approves it; remembered categories only improve suggestions; the server re-decides every row when the owner confirms; and approving labels
 * bank evidence only (no ledger, balance, bill, project or payroll is touched).
 */
export default function SmartReview({ onChanged, definitionSave }: { onChanged?: () => void; definitionSave?: DefinitionSave }) {
  const { data, state, busy, message, approve, forget, setBucket, refresh } = useSmartReview()
  const { categoryColor } = useDisplayColors()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [choices, setChoices] = useState<Map<string, string>>(new Map()) // group id -> category the owner picked for the group
  const [remember, setRemember] = useState<Set<string>>(new Set()) // group ids whose merchant the owner asked to remember
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [picking, setPicking] = useState<SmartGroup | null>(null) // the group whose category sheet is open
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
    const m = new Map<string, { key: string; label: string; count: number; totalMinor: number }>()
    for (const id of chosen) { const g = groupOfRow.get(id)!; const key = effective(g) ?? g.bucket.key; const e = m.get(key) ?? { key, label: labelOf(key), count: 0, totalMinor: 0 }; e.count += 1; e.totalMinor += rowById.get(id)!.amountMinor; m.set(key, e) }
    return [...m.values()].sort((a, b) => b.totalMinor - a.totalMinor)
  })()
  const rememberedGroups = groups.filter(g => remember.has(g.id) && chosen.some(id => groupOfRow.get(id) === g) && data.rulesAvailable && isBucketKey(effective(g)))

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
    if (!isBucketKey(key)) setRemember(prev => { const n = new Set(prev); n.delete(g.id); return n })
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

  return <HierarchyProvider value={data.hierarchy} saveDefinition={definitionSave} onChanged={() => void refresh()}><div className="mt-3" data-testid="smart-review">
    {data.coverage?.complete === false && <p role="alert" className="mb-3 text-sm">Incomplete review coverage · {data.coverage.reason} Group totals and counts describe loaded evidence only.</p>}
    <p className="text-xs text-[var(--text-secondary)]">Your unreviewed spending, grouped by merchant. Open a group to see every transaction.</p>
    <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="smart-steps" aria-label="How Smart Review works">
      {['Select transactions', 'Check the category', 'Approve selected'].map((t, i) => {
        const now = (chosen.length === 0 ? 1 : confirming ? 3 : 2) === i + 1
        return <li key={t} aria-current={now ? 'step' : undefined} className={`inline-flex items-center gap-1.5 ${now ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
          <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] tabular-nums ${now ? 'bg-[var(--text-primary)] text-[var(--bg-card)]' : 'ring-1 ring-inset ring-[var(--surface-line)]'}`}>{i + 1}</span>{t}</li>
      })}
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
      // D13: the owner's own pick reads "Your choice · X" on the pill itself (still dashed: not approved). A remembered rule and a plain suggestion say so in a chip.
      const origin = g.basis === 'owner_rule' ? <Chip tone="done">Your remembered rule</Chip> : choice ? null : <Chip>Suggestion</Chip>
      const type = entryType({ direction: 'money_out', bucket: { key: choice ?? g.bucket.key, state: 'suggested' }, relationship: { kind: 'unknown', state: 'none' } })
      const selTotal = sel.reduce((s, r) => s + r.amountMinor, 0)
      const rememberOn = sel.length > 0 && remember.has(g.id)
      return <li key={g.id} className="relative rounded-xl border border-[var(--surface-line)] bg-[var(--surface-1)] p-3 pl-5 shadow-[0_1px_2px_rgba(0,0,0,0.18)]" data-testid="smart-group" data-merchant={g.merchantKey} data-selected={sel.length}>
        <StripeBar stripe={categoryStripe({ key: choice ?? g.bucket.key, state: 'suggested' }, categoryColor)} shape="card" />
        <button type="button" className={`flex min-h-[44px] w-full items-start justify-between gap-3 rounded-lg text-left ${focusRing}`} aria-expanded={isOpen} onClick={() => toggleOpen(g.id)} data-testid="smart-group-header">
          <span className="min-w-0"><span className="block truncate text-[15px] font-semibold leading-6">{g.merchant}</span>
            <span className="text-xs text-[var(--text-secondary)]">{g.count} transaction{g.count === 1 ? '' : 's'} · {isOpen ? 'Hide' : 'Show'}</span></span>
          <span className="shrink-0 text-right"><span className="block text-[15px] font-semibold leading-6 tabular-nums">−{usd2(g.totalMinor)}</span>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-secondary)]" data-testid="entry-type" data-kind={type.kind}><span aria-hidden="true">{type.glyph}</span>{type.label}</span></span>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <CategoryPill categoryKey={choice ?? g.bucket.key} label={choice ? labelOf(choice) : g.bucket.label} state={choice ? 'draft' : 'suggested'} /><Chip tone={g.confidence === 'high' ? 'neutral' : 'muted'}>{CONF[g.confidence]}</Chip>{origin}
          {g.mixed && <Chip tone="warn">Mixed purpose</Chip>}{g.flaggedCount > 0 && <Chip tone="warn">{g.flaggedCount} to check</Chip>}
        </div>
        {g.needsChoice && <p className="mt-1 text-xs text-[var(--text-secondary)]">{g.mixed ? `${g.merchant} is used for different purposes, so you pick the category.` : 'This is not a confident match, so you pick the category.'}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className={`${btn} ${allOn ? btnSel : ''}`} role="checkbox" aria-checked={allOn} disabled={busy || ids.length === 0} onClick={() => toggleGroup(g)} data-testid="smart-group-select">
            {allOn ? 'Selected' : g.needsChoice ? `Use ${g.bucket.label} for ${ids.length}` : `Select ${ids.length}`}</button>
          <button type="button" className={btn} disabled={busy} onClick={() => setPicking(g)} data-testid="smart-group-category" data-value={effective(g) ?? ''}
            aria-label={`Category for ${g.merchant}: ${effective(g) ? labelOf(effective(g)!) : 'not chosen'}. Change`}>{g.needsChoice && !choice ? 'Choose a category…' : 'Change category…'}</button>
        </div>
        {g.flaggedCount > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]">{g.flaggedCount} flagged transaction{g.flaggedCount === 1 ? ' is' : 's are'} not included when you select the group. Open the group to choose them yourself.</p>}
        {sel.length > 0 && <p className="mt-2 text-xs font-semibold" aria-live="polite" data-testid="smart-group-selected">{sel.length} selected · {usd2(selTotal)} <span className="font-normal text-[var(--text-secondary)]">· not approved yet</span></p>}
        {data.rulesAvailable
          ? <fieldset className="mt-2" data-testid="smart-remember">
              <legend className="text-xs text-[var(--text-secondary)]">For future {g.merchant} transactions</legend>
              <SegmentedControl className="mt-1" label={`For future ${g.merchant} transactions`} value={rememberOn ? 'on' : 'off'} onChange={v => toggleRemember(g, v === 'on')} options={[
                { value: 'off', label: "Don't remember", testId: 'smart-this-only', disabled: busy },
                { value: 'on', label: 'Remember this category', testId: 'smart-remember-on', disabled: busy || sel.length === 0 || !isBucketKey(effective(g)) }]} />
              <p className="mt-1 text-xs text-[var(--text-secondary)]" data-testid="smart-remember-hint">{sel.length === 0
                ? 'Select a transaction first to remember its category.'
                : rememberOn
                  ? `Future ${g.merchant} transactions will be suggested as ${labelOf(effective(g) ?? g.bucket.key)}. They still need your approval. Saved only when you confirm.`
                  : 'Default: nothing is remembered. Remembering only suggests a category next time; it never approves anything.'}</p>
            </fieldset>
          : <p className="mt-2 text-xs text-[var(--text-secondary)]" data-testid="smart-remember-unavailable">Remembering categories for future transactions is not available right now. Approving still works for the transactions you select.</p>}
        {isOpen && <ul className="mt-2 divide-y divide-[var(--surface-line)]" data-testid="smart-group-rows">{g.rows.map(r => {
          const on = selected.has(r.id)
          return <li key={r.id}>
            <button type="button" role="checkbox" aria-checked={on} disabled={busy} onClick={() => toggleRow(g, r)} className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg px-1 py-2 text-left ${on ? 'bg-[var(--fin-protected-tint)]' : ''} ${focusRing}`} data-testid="smart-row" data-selected={on ? 'true' : 'false'}>
              <span aria-hidden="true" className={`inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] ${on ? 'bg-[var(--fin-protected)] text-[var(--bg-card)]' : 'bg-[var(--surface-1)] ring-[1.5px] ring-inset ring-[var(--surface-line)]'}`}>{on && <Check size={15} strokeWidth={3} />}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{shortDate(r.date)} · {r.name}</span>
                {r.flags.length > 0 && <span className="block text-xs font-semibold" style={{ color: 'var(--fin-warning)' }}>{r.flags.map(f => FLAG_TEXT[f] ?? f).join(' · ')}</span>}</span>
              <span className="shrink-0 text-sm tabular-nums">−{usd2(r.amountMinor)}</span>
            </button></li>
        })}</ul>}
      </li>
    })}</ul>

    {data.exceptions.length > 0 && <div className="mt-4" data-testid="smart-exceptions">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Needs your individual decision</h4>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">These are never approved together: money in, owner draws and personal, payroll, transfers, bills and projects, pending items, and anything unclear.</p>
      <ul className="mt-2 space-y-2">{data.exceptions.map(e => {
        const isOpen = open.has(`ex:${e.reason}`)
        return <li key={e.reason} className="rounded-xl border border-[var(--surface-line)] bg-[var(--surface-1)] p-3" data-testid="smart-exception-group" data-reason={e.reason}>
          <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left" aria-expanded={isOpen} onClick={() => toggleOpen(`ex:${e.reason}`)}>
            <span className="text-sm font-semibold">{e.label}</span><span className="shrink-0 text-xs text-[var(--text-secondary)]">{e.count} · {usd2(e.totalMinor)}</span></button>
          {isOpen && <ul className="mt-1 divide-y divide-[var(--surface-line)]">{e.rows.map(r => <ExceptionRow key={r.id} row={r} buckets={data.options.buckets} busy={busy} onSave={(id, bucket) => { void setBucket(id, bucket).then(() => onChanged?.()) }} />)}
            {e.count > e.rows.length && <li className="py-2 text-xs text-[var(--text-secondary)]">Showing {e.rows.length} of {e.count}. The rest are in the Explorer list.</li>}</ul>}
        </li>
      })}</ul>
    </div>}

    {picking && <BucketPicker open busy={busy} options={data.options.buckets.filter(b => data.options.batchBuckets.includes(b.key))}
      currentKey={choices.get(picking.id) ?? (picking.needsChoice ? null : picking.bucket.key)} suggestedKey={picking.bucket.key} eyebrow="Smart Review"
      title={`Category for ${picking.merchant}`} context={`${picking.count} transaction${picking.count === 1 ? '' : 's'} · −${usd2(picking.totalMinor)}`} applyLabel="Use"
      idleNote="Only categories that can be approved together are listed. Nothing is saved until you confirm approval."
      changeNote={(to, from) => <>Use <span className="font-semibold text-[var(--text-primary)]">{to}</span>{from ? <> instead of {from}</> : null} for {picking.merchant}. Nothing is saved until you confirm approval.</>}
      onClear={choices.has(picking.id) ? () => { chooseCategory(picking, ''); setPicking(null) } : undefined}
      onClose={() => setPicking(null)} onApply={key => { chooseCategory(picking, key); setPicking(null) }} />}

    {chosen.length > 0 && <SelectionBar prefix="smart" count={chosen.length} totalMinor={totalOut} note="not approved yet" confirming={confirming}
      confirm={<ApprovalConfirm prefix="smart" label="Confirm approval" count={chosen.length} breakdown={breakdown} totalMinor={totalOut} busy={busy} onConfirm={() => void approveSelected()} onCancel={() => setConfirming(false)}
        extra={rememberedGroups.length > 0
          ? <p className="text-sm" data-testid="smart-confirm-remember">Also remember: {rememberedGroups.map(g => `${g.merchant} → ${labelOf(effective(g) ?? g.bucket.key)}`).join(', ')}. Future matching transactions will be suggested this way; you still approve each one.</p>
          : <p className="text-xs text-[var(--text-secondary)]" data-testid="smart-confirm-no-remember">No category will be remembered for future transactions.</p>} />}>
      <button type="button" className={btnPrimary} disabled={busy} onClick={() => setConfirming(true)} data-testid="smart-approve">Approve selected…</button>
      <button type="button" className={btn} disabled={busy} onClick={clearAll} data-testid="smart-clear">Clear selection</button>
    </SelectionBar>}
    <button type="button" className={`${btn} mt-3`} disabled={busy} onClick={() => void refresh()}>Refresh</button>
  </div></HierarchyProvider>
}
