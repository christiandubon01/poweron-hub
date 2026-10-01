import { useState } from 'react'
import type { RecurringObligation, CashCommitment } from '@/finance/obligationsTypes'
import {
  createFinancialObligation,
  updateFinancialObligation,
  archiveFinancialObligation,
  createCashCommitment,
  updateCashCommitment,
  cancelCashCommitment,
  validateObligationInput,
  validateCommitmentInput,
  OBLIGATION_SCHEDULES,
  OBLIGATION_SCHEDULE_LABELS,
  type ObligationRecurrenceSchedule,
  type CreateObligationInput,
  type UpdateObligationInput,
  type CreateCommitmentInput,
} from '@/services/cashObligationService'
import { CashCard, CashEmpty, cashDate, money } from './cashOsUi'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function todayInLA(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const p = (t: string) => parts.find(v => v.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

function parseDollarsMinor(raw: string): number {
  const val = parseFloat(raw.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(val) || val <= 0) throw new Error('Enter a valid positive amount')
  return Math.round(val * 100)
}

function scheduleFromObligation(ob: RecurringObligation): ObligationRecurrenceSchedule {
  const { kind, interval } = ob.recurrence
  if (kind === 'weekly') return 'weekly'
  if (kind === 'every_n_weeks' && interval === 2) return 'every_2_weeks'
  if (kind === 'every_n_weeks' && interval === 4) return 'every_4_weeks'
  if (kind === 'monthly' && interval === 1) return 'monthly'
  if (kind === 'monthly' && interval === 3) return 'quarterly'
  if (kind === 'yearly') return 'yearly'
  return 'monthly'
}

// ─── CSS constants ────────────────────────────────────────────────────────────

const inputCls = 'mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm'
const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]'
const btnPrimary = 'rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-orange-600'
const btnGhost = 'rounded-lg border border-[var(--border-primary)] px-4 py-2 text-sm hover:bg-white/5'
const btnDanger = 'rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-red-700'
const btnMicro = 'rounded px-2 py-1 text-xs font-medium border border-[var(--border-primary)] hover:bg-white/5 disabled:opacity-40'

// ─── Required toggle ─────────────────────────────────────────────────────────
// Native checkboxes are invisible on the app's near-black background because
// accent-color only tints the checkmark, not the unchecked box chrome. This
// component renders the visual state explicitly so both checked and unchecked
// are always visible regardless of OS theme.

function RequiredControl({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 py-1.5">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
      />
      <span
        aria-hidden="true"
        className={[
          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-orange-500 peer-focus-visible:ring-offset-1',
          checked ? 'border-orange-500 bg-orange-500' : 'border-[var(--border-primary)] bg-transparent',
        ].join(' ')}
      >
        {checked && (
          <svg aria-hidden="true" width="11" height="9" viewBox="0 0 11 9" fill="none">
            <path d="M1 4.5l3 3L10 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="text-sm">Required (included in protected cash)</span>
    </label>
  )
}

// ─── Mode types ───────────────────────────────────────────────────────────────

type Mode =
  | 'list'
  | 'add-obligation'
  | 'edit-obligation'
  | 'confirm-archive'
  | 'add-commitment'
  | 'edit-commitment'
  | 'confirm-cancel'

// ─── Obligation form ──────────────────────────────────────────────────────────

function ObligationForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: RecurringObligation | null
  pending: boolean
  error: string | null
  onSubmit: (fields: { name: string; amountRaw: string; schedule: ObligationRecurrenceSchedule; anchorDate: string; category: string; isRequired: boolean; confidence: 'confirmed' | 'expected' | 'possible' }) => void
  onCancel: () => void
  submitLabel: string
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [amountRaw, setAmountRaw] = useState(initial ? String((initial.amount.minor / 100).toFixed(2)) : '')
  const [schedule, setSchedule] = useState<ObligationRecurrenceSchedule>(initial ? scheduleFromObligation(initial) : 'monthly')
  const [anchorDate, setAnchorDate] = useState(initial?.recurrence.anchorDate ?? todayInLA())
  const [category, setCategory] = useState(initial?.category ?? '')
  const [isRequired, setIsRequired] = useState(initial ? initial.requirement === 'required' : true)
  const [confidence, setConfidence] = useState<'confirmed' | 'expected' | 'possible'>(initial?.confidence ?? 'expected')

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ name, amountRaw, schedule, anchorDate, category, isRequired, confidence }) }} className="space-y-4">
      <label className="block">
        <span className={labelCls}>Name</span>
        <input type="text" required placeholder="e.g. Vehicle loan" value={name}
          onChange={e => setName(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Amount</span>
        <input type="text" inputMode="decimal" required placeholder="0.00" value={amountRaw}
          onChange={e => setAmountRaw(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Schedule</span>
        <select value={schedule} onChange={e => setSchedule(e.target.value as ObligationRecurrenceSchedule)} className={inputCls}>
          {OBLIGATION_SCHEDULES.map(s => <option key={s} value={s}>{OBLIGATION_SCHEDULE_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className={labelCls}>Start / anchor date</span>
        <input type="date" required value={anchorDate}
          onChange={e => setAnchorDate(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Category (optional)</span>
        <input type="text" placeholder="e.g. Rent, Vehicle, Insurance" value={category}
          onChange={e => setCategory(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Confidence</span>
        <select value={confidence} onChange={e => setConfidence(e.target.value as typeof confidence)} className={inputCls}>
          <option value="confirmed">Confirmed</option>
          <option value="expected">Expected</option>
          <option value="possible">Possible</option>
        </select>
      </label>
      <RequiredControl checked={isRequired} onChange={setIsRequired} />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}

// ─── Commitment form ──────────────────────────────────────────────────────────

function CommitmentForm({
  initial,
  pending,
  error,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: CashCommitment | null
  pending: boolean
  error: string | null
  onSubmit: (fields: { title: string; amountRaw: string; expectedDate: string; category: string; isRequired: boolean; confidence: 'confirmed' | 'expected' | 'possible' }) => void
  onCancel: () => void
  submitLabel: string
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [amountRaw, setAmountRaw] = useState(initial ? String((initial.amount.minor / 100).toFixed(2)) : '')
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? todayInLA())
  const [category, setCategory] = useState(initial?.category ?? '')
  const [isRequired, setIsRequired] = useState(initial ? initial.requirement === 'required' : true)
  const [confidence, setConfidence] = useState<'confirmed' | 'expected' | 'possible'>(initial?.confidence ?? 'expected')

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ title, amountRaw, expectedDate, category, isRequired, confidence }) }} className="space-y-4">
      <label className="block">
        <span className={labelCls}>Title</span>
        <input type="text" required placeholder="e.g. Equipment purchase" value={title}
          onChange={e => setTitle(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Amount</span>
        <input type="text" inputMode="decimal" required placeholder="0.00" value={amountRaw}
          onChange={e => setAmountRaw(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Expected date</span>
        <input type="date" required value={expectedDate}
          onChange={e => setExpectedDate(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Category (optional)</span>
        <input type="text" placeholder="e.g. Equipment, Materials" value={category}
          onChange={e => setCategory(e.target.value)} className={inputCls} />
      </label>
      <label className="block">
        <span className={labelCls}>Confidence</span>
        <select value={confidence} onChange={e => setConfidence(e.target.value as typeof confidence)} className={inputCls}>
          <option value="confirmed">Confirmed</option>
          <option value="expected">Expected</option>
          <option value="possible">Possible</option>
        </select>
      </label>
      <RequiredControl checked={isRequired} onChange={setIsRequired} />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? 'Saving…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost}>Cancel</button>
      </div>
    </form>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CashOsObligations({
  obligations,
  commitments,
  onRefresh,
}: {
  obligations: RecurringObligation[]
  commitments: CashCommitment[]
  onRefresh: () => void
}) {
  const [mode, setMode] = useState<Mode>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() { setMode('list'); setSelectedId(null); setPending(false); setError(null) }

  const selectedObligation = obligations.find(o => o.id === selectedId) ?? null
  const selectedCommitment = commitments.find(c => c.id === selectedId) ?? null

  // ─── Obligation handlers ────────────────────────────────────────────────────

  async function handleObligationSubmit(fields: {
    name: string; amountRaw: string; schedule: ObligationRecurrenceSchedule
    anchorDate: string; category: string; isRequired: boolean
    confidence: 'confirmed' | 'expected' | 'possible'
  }) {
    let amountMinor: number
    try { amountMinor = parseDollarsMinor(fields.amountRaw) }
    catch (err) { setError(err instanceof Error ? err.message : 'Invalid amount'); return }

    const guard = validateObligationInput({ name: fields.name, amountMinor, schedule: fields.schedule, anchorDate: fields.anchorDate })
    if (guard) { setError(guard); return }

    setPending(true); setError(null)
    try {
      if (mode === 'add-obligation') {
        const payload: CreateObligationInput = {
          name: fields.name, category: fields.category || null,
          amountMinor, schedule: fields.schedule, anchorDate: fields.anchorDate,
          isRequired: fields.isRequired, confidence: fields.confidence,
        }
        await createFinancialObligation(payload)
      } else if (mode === 'edit-obligation' && selectedId) {
        const patch: UpdateObligationInput = {
          name: fields.name, category: fields.category || null,
          amountMinor, schedule: fields.schedule, anchorDate: fields.anchorDate,
          isRequired: fields.isRequired, confidence: fields.confidence,
        }
        await updateFinancialObligation(selectedId, patch)
      }
      onRefresh(); reset()
    } catch (err) {
      setPending(false); setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleArchiveConfirm() {
    if (!selectedId) return
    setPending(true); setError(null)
    try {
      await archiveFinancialObligation(selectedId)
      onRefresh(); reset()
    } catch (err) {
      setPending(false); setError(err instanceof Error ? err.message : 'Archive failed')
    }
  }

  // ─── Commitment handlers ────────────────────────────────────────────────────

  async function handleCommitmentSubmit(fields: {
    title: string; amountRaw: string; expectedDate: string; category: string
    isRequired: boolean; confidence: 'confirmed' | 'expected' | 'possible'
  }) {
    let amountMinor: number
    try { amountMinor = parseDollarsMinor(fields.amountRaw) }
    catch (err) { setError(err instanceof Error ? err.message : 'Invalid amount'); return }

    const guard = validateCommitmentInput({ title: fields.title, amountMinor, expectedDate: fields.expectedDate })
    if (guard) { setError(guard); return }

    setPending(true); setError(null)
    try {
      if (mode === 'add-commitment') {
        const payload: CreateCommitmentInput = {
          title: fields.title, category: fields.category || null,
          amountMinor, expectedDate: fields.expectedDate,
          isRequired: fields.isRequired, confidence: fields.confidence,
        }
        await createCashCommitment(payload)
      } else if (mode === 'edit-commitment' && selectedId) {
        await updateCashCommitment(selectedId, {
          title: fields.title, category: fields.category || null,
          amountMinor, expectedDate: fields.expectedDate,
          isRequired: fields.isRequired, confidence: fields.confidence,
        })
      }
      onRefresh(); reset()
    } catch (err) {
      setPending(false); setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  async function handleCancelConfirm() {
    if (!selectedId) return
    setPending(true); setError(null)
    try {
      await cancelCashCommitment(selectedId)
      onRefresh(); reset()
    } catch (err) {
      setPending(false); setError(err instanceof Error ? err.message : 'Cancel failed')
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (mode === 'add-obligation' || mode === 'edit-obligation') {
    return (
      <CashCard title={mode === 'add-obligation' ? 'New recurring obligation' : 'Edit obligation'}>
        <ObligationForm
          initial={mode === 'edit-obligation' ? selectedObligation : null}
          pending={pending} error={error}
          onSubmit={handleObligationSubmit} onCancel={reset}
          submitLabel={mode === 'add-obligation' ? 'Add obligation' : 'Save changes'}
        />
      </CashCard>
    )
  }

  if (mode === 'confirm-archive' && selectedObligation) {
    return (
      <CashCard title="Archive obligation">
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Archive <strong>{selectedObligation.name}</strong>? This obligation will immediately stop appearing in your cash plan.
          Existing reconciled occurrences are preserved.
        </p>
        {error && <p className="mb-3 text-xs text-red-300">{error}</p>}
        <div className="flex gap-3">
          <button type="button" disabled={pending} onClick={handleArchiveConfirm} className={btnDanger}>
            {pending ? 'Archiving…' : 'Archive obligation'}
          </button>
          <button type="button" onClick={reset} className={btnGhost}>Cancel</button>
        </div>
      </CashCard>
    )
  }

  if (mode === 'add-commitment' || mode === 'edit-commitment') {
    return (
      <CashCard title={mode === 'add-commitment' ? 'New one-time commitment' : 'Edit commitment'}>
        <CommitmentForm
          initial={mode === 'edit-commitment' ? selectedCommitment : null}
          pending={pending} error={error}
          onSubmit={handleCommitmentSubmit} onCancel={reset}
          submitLabel={mode === 'add-commitment' ? 'Add commitment' : 'Save changes'}
        />
      </CashCard>
    )
  }

  if (mode === 'confirm-cancel' && selectedCommitment) {
    return (
      <CashCard title="Cancel commitment">
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Cancel <strong>{selectedCommitment.title}</strong>? This planned outflow will be removed from your cash plan.
        </p>
        {error && <p className="mb-3 text-xs text-red-300">{error}</p>}
        <div className="flex gap-3">
          <button type="button" disabled={pending} onClick={handleCancelConfirm} className={btnDanger}>
            {pending ? 'Canceling…' : 'Cancel commitment'}
          </button>
          <button type="button" onClick={reset} className={btnGhost}>Keep it</button>
        </div>
      </CashCard>
    )
  }

  const addBtn = (onClick: () => void, label: string) => (
    <button onClick={onClick} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600">{label}</button>
  )

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <CashCard title="Recurring obligations" action={addBtn(() => setMode('add-obligation'), '+ Obligation')}>
        {obligations.length ? (
          <div className="space-y-3">
            {obligations.map(row => (
              <div key={row.id} className="rounded-xl border border-[var(--border-primary)] p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong>{row.name}</strong>
                    <span className="ml-2 font-mono">{money(row.amount.minor)}</span>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {OBLIGATION_SCHEDULE_LABELS[scheduleFromObligation(row)] ?? row.recurrence.kind.replace(/_/g, ' ')} from {cashDate(row.recurrence.startDate)} · {row.requirement} · {row.confidence} · {row.status}{row.category ? ` · ${row.category}` : ''}
                    </p>
                  </div>
                  {row.status === 'active' && (
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" className={btnMicro}
                        onClick={() => { setSelectedId(row.id); setMode('edit-obligation') }}>Edit</button>
                      <button type="button" className={btnMicro}
                        onClick={() => { setSelectedId(row.id); setMode('confirm-archive') }}>Archive</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : <CashEmpty>No recurring obligations. Add one to start tracking planned cash outflows.</CashEmpty>}
      </CashCard>

      <CashCard title="Cash commitments" action={addBtn(() => setMode('add-commitment'), '+ Commitment')}>
        {commitments.length ? (
          <div className="space-y-3">
            {commitments.map(row => {
              const canEdit = row.status === 'scheduled' && row.reconciliationState === 'unreconciled'
              return (
                <div key={row.id} className="rounded-xl border border-[var(--border-primary)] p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <strong>{row.title}</strong>
                      <span className="ml-2 font-mono">{money(row.amount.minor)}</span>
                      <p className="mt-1 text-xs text-[var(--text-secondary)]">
                        {cashDate(row.expectedDate)} · {row.requirement} · {row.confidence} · {row.status}{row.category ? ` · ${row.category}` : ''}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1.5">
                        <button type="button" className={btnMicro}
                          onClick={() => { setSelectedId(row.id); setMode('edit-commitment') }}>Edit</button>
                        <button type="button" className={btnMicro}
                          onClick={() => { setSelectedId(row.id); setMode('confirm-cancel') }}>Cancel</button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : <CashEmpty>No one-time commitments. Add one for upcoming planned expenses.</CashEmpty>}
      </CashCard>
    </div>
  )
}
