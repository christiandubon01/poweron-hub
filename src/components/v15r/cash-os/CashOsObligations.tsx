import { useState } from 'react'
import type { RecurringObligation, CashCommitment, ObligationOccurrence } from '@/finance/obligationsTypes'
import type { FinancialTransactionRow, FinancialAccountRow } from '@/finance/ledgerTypes'
import { generateRecurrenceDates } from '@/finance/recurrence'
import {
  createFinancialObligation,
  updateFinancialObligation,
  archiveFinancialObligation,
  createCashCommitment,
  updateCashCommitment,
  cancelCashCommitment,
  reconcilePlannedOutflow,
  materializeObligation,
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

// ─── Reconciliation helpers ───────────────────────────────────────────────────

function offsetIsoDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function candidateTxs(
  transactions: FinancialTransactionRow[],
  plannedMinor: number,
): FinancialTransactionRow[] {
  return transactions
    .filter(tx =>
      tx.status === 'posted' &&
      tx.transaction_kind !== 'opening_balance' &&
      tx.transaction_kind !== 'transfer' &&
      tx.transaction_kind !== 'balance_reconciliation' &&
      tx.amount_minor < 0 &&
      Math.abs(tx.amount_minor) === plannedMinor,
    )
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
}

function reconcilableDates(
  obligation: RecurringObligation,
  occurrences: ObligationOccurrence[],
  today: string,
): Array<{ date: string; occurrenceId: string | null }> {
  const start = offsetIsoDate(today, -90)
  const end = offsetIsoDate(today, 7)
  const dates = generateRecurrenceDates(obligation.recurrence, start, end)
  const occByDate = new Map(
    occurrences.filter(o => o.obligationId === obligation.id).map(o => [o.scheduledDate, o]),
  )
  return dates
    .filter(d => {
      const occ = occByDate.get(d)
      if (!occ) return true
      return occ.reconciliationState !== 'reconciled' && occ.status === 'scheduled'
    })
    .map(d => ({ date: d, occurrenceId: occByDate.get(d)?.id ?? null }))
    .reverse()
}

// ─── Transaction picker panel ─────────────────────────────────────────────────

function ReconcilePanel({
  label, amountMinor, dateLabel, transactions, accounts, pending, error, onSelect, onBack,
}: {
  label: string; amountMinor: number; dateLabel: string
  transactions: FinancialTransactionRow[]; accounts: FinancialAccountRow[]
  pending: boolean; error: string | null
  onSelect: (txId: string) => void; onBack: () => void
}) {
  const candidates = candidateTxs(transactions, amountMinor)
  const accountName = (id: string) => accounts.find(a => a.id === id)?.display_name ?? 'Unknown account'
  return (
    <CashCard title="Mark as paid">
      <p className="mb-1 text-sm font-semibold">{label}</p>
      <p className="mb-4 text-xs text-[var(--text-secondary)]">{dateLabel} · {money(amountMinor)}</p>
      <h4 className="mb-2 text-sm font-semibold">Select the actual transaction</h4>
      <p className="mb-3 text-xs text-[var(--text-secondary)]">
        Only posted expenses with exactly {money(amountMinor)} are shown. Partial matches are not supported in this version.
        If the transaction is not listed, record it first (Add Money → Expense), then return here.
      </p>
      {candidates.length ? (
        <div className="space-y-2">
          {candidates.map(tx => (
            <button key={tx.id} type="button" disabled={pending}
              onClick={() => onSelect(tx.id)}
              className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-left text-sm hover:border-orange-500/50 hover:bg-orange-500/5 disabled:opacity-40">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{tx.description || tx.transaction_kind.replace(/_/g, ' ')}</span>
                <span className="whitespace-nowrap font-mono text-red-300">{money(tx.amount_minor)}</span>
              </div>
              <span className="block text-xs text-[var(--text-secondary)]">
                {cashDate(tx.transaction_date)} · {accountName(tx.account_id)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border-primary)] p-4 text-sm text-[var(--text-secondary)]">
          No posted expense for exactly {money(amountMinor)} found. Enter the exact amount when recording the transaction, then return here to reconcile.
        </div>
      )}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
      <button type="button" onClick={onBack} className={`mt-4 ${btnGhost}`}>Back</button>
    </CashCard>
  )
}

// ─── Reconciliation success ───────────────────────────────────────────────────

type ReconcileSuccess = {
  kind: 'occurrence' | 'commitment'
  name: string
  dateLabel: string
  txDescription: string
  txDate: string
  txAmountMinor: number
  isRecurring: boolean
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
  | 'reconcile-commitment'
  | 'reconcile-occurrence'

// ─── Obligation form ──────────────────────────────────────────────────────────

function ObligationForm({
  initial,
  pending,
  error,
  accounts,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: RecurringObligation | null
  pending: boolean
  error: string | null
  accounts?: FinancialAccountRow[]
  onSubmit: (fields: { name: string; amountRaw: string; schedule: ObligationRecurrenceSchedule; anchorDate: string; category: string; isRequired: boolean; confidence: 'confirmed' | 'expected' | 'possible'; debtAccountId: string | null }) => void
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
  const [debtAccountId, setDebtAccountId] = useState<string | null>(initial?.debtAccountId ?? null)

  const liabilityAccounts = (accounts ?? []).filter(a => a.account_class === 'liability' && a.status === 'active')

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ name, amountRaw, schedule, anchorDate, category, isRequired, confidence, debtAccountId }) }} className="space-y-4">
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
      {liabilityAccounts.length > 0 && (
        <label className="block">
          <span className={labelCls}>Linked debt account (optional)</span>
          <select
            value={debtAccountId ?? ''}
            onChange={e => setDebtAccountId(e.target.value || null)}
            className={inputCls}
          >
            <option value="">— None —</option>
            {liabilityAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.display_name}</option>
            ))}
          </select>
        </label>
      )}
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
  accounts,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: CashCommitment | null
  pending: boolean
  error: string | null
  accounts?: FinancialAccountRow[]
  onSubmit: (fields: { title: string; amountRaw: string; expectedDate: string; category: string; isRequired: boolean; confidence: 'confirmed' | 'expected' | 'possible'; debtAccountId: string | null }) => void
  onCancel: () => void
  submitLabel: string
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [amountRaw, setAmountRaw] = useState(initial ? String((initial.amount.minor / 100).toFixed(2)) : '')
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? todayInLA())
  const [category, setCategory] = useState(initial?.category ?? '')
  const [isRequired, setIsRequired] = useState(initial ? initial.requirement === 'required' : true)
  const [confidence, setConfidence] = useState<'confirmed' | 'expected' | 'possible'>(initial?.confidence ?? 'expected')
  const [debtAccountId, setDebtAccountId] = useState<string | null>(initial?.debtAccountId ?? null)

  const liabilityAccounts = (accounts ?? []).filter(a => a.account_class === 'liability' && a.status === 'active')

  return (
    <form onSubmit={e => { e.preventDefault(); onSubmit({ title, amountRaw, expectedDate, category, isRequired, confidence, debtAccountId }) }} className="space-y-4">
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
      {liabilityAccounts.length > 0 && (
        <label className="block">
          <span className={labelCls}>Linked debt account (optional)</span>
          <select
            value={debtAccountId ?? ''}
            onChange={e => setDebtAccountId(e.target.value || null)}
            className={inputCls}
          >
            <option value="">— None —</option>
            {liabilityAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.display_name}</option>
            ))}
          </select>
        </label>
      )}
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
  occurrences = [],
  transactions = [],
  accounts = [],
  onRefresh,
}: {
  obligations: RecurringObligation[]
  commitments: CashCommitment[]
  occurrences?: ObligationOccurrence[]
  transactions?: FinancialTransactionRow[]
  accounts?: FinancialAccountRow[]
  onRefresh: () => void
}) {
  const [mode, setMode] = useState<Mode>('list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reconcileDate, setReconcileDate] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successResult, setSuccessResult] = useState<ReconcileSuccess | null>(null)

  function reset() { setMode('list'); setSelectedId(null); setReconcileDate(null); setPending(false); setError(null) }

  const selectedObligation = obligations.find(o => o.id === selectedId) ?? null
  const selectedCommitment = commitments.find(c => c.id === selectedId) ?? null

  // ─── Obligation handlers ────────────────────────────────────────────────────

  async function handleObligationSubmit(fields: {
    name: string; amountRaw: string; schedule: ObligationRecurrenceSchedule
    anchorDate: string; category: string; isRequired: boolean
    confidence: 'confirmed' | 'expected' | 'possible'; debtAccountId: string | null
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
          debtAccountId: fields.debtAccountId,
        }
        await createFinancialObligation(payload)
      } else if (mode === 'edit-obligation' && selectedId) {
        const patch: UpdateObligationInput = {
          name: fields.name, category: fields.category || null,
          amountMinor, schedule: fields.schedule, anchorDate: fields.anchorDate,
          isRequired: fields.isRequired, confidence: fields.confidence,
          debtAccountId: fields.debtAccountId,
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
    isRequired: boolean; confidence: 'confirmed' | 'expected' | 'possible'; debtAccountId: string | null
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
          debtAccountId: fields.debtAccountId,
        }
        await createCashCommitment(payload)
      } else if (mode === 'edit-commitment' && selectedId) {
        await updateCashCommitment(selectedId, {
          title: fields.title, category: fields.category || null,
          amountMinor, expectedDate: fields.expectedDate,
          isRequired: fields.isRequired, confidence: fields.confidence,
          debtAccountId: fields.debtAccountId,
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

  // ─── Reconciliation handlers ────────────────────────────────────────────────

  async function handleReconcileCommitment(transactionId: string) {
    if (!selectedId) return
    const tx = transactions.find(t => t.id === transactionId)
    const commitment = selectedCommitment
    setPending(true); setError(null)
    try {
      await reconcilePlannedOutflow({ commitmentId: selectedId, transactionId })
      setSuccessResult({
        kind: 'commitment',
        name: commitment?.title ?? selectedId,
        dateLabel: commitment ? cashDate(commitment.expectedDate) : '',
        txDescription: tx?.description || (tx?.transaction_kind ?? 'expense').replace(/_/g, ' '),
        txDate: tx ? cashDate(tx.transaction_date) : '',
        txAmountMinor: tx ? Math.abs(tx.amount_minor) : (commitment?.amount.minor ?? 0),
        isRecurring: false,
      })
      setMode('list'); setSelectedId(null); setReconcileDate(null); setPending(false); setError(null)
      onRefresh()
    } catch (err) {
      setPending(false); setError(err instanceof Error ? err.message : 'Reconciliation failed')
    }
  }

  async function handleReconcileOccurrence(transactionId: string) {
    if (!selectedId || !reconcileDate) return
    const tx = transactions.find(t => t.id === transactionId)
    const obligation = selectedObligation
    setPending(true); setError(null)
    try {
      const { id: occurrenceId } = await materializeObligation({ obligationId: selectedId, scheduledDate: reconcileDate })
      await reconcilePlannedOutflow({ occurrenceId, transactionId })
      setSuccessResult({
        kind: 'occurrence',
        name: obligation?.name ?? selectedId,
        dateLabel: cashDate(reconcileDate),
        txDescription: tx?.description || (tx?.transaction_kind ?? 'expense').replace(/_/g, ' '),
        txDate: tx ? cashDate(tx.transaction_date) : '',
        txAmountMinor: tx ? Math.abs(tx.amount_minor) : (obligation?.amount.minor ?? 0),
        isRecurring: true,
      })
      setMode('list'); setSelectedId(null); setReconcileDate(null); setPending(false); setError(null)
      onRefresh()
    } catch (err) {
      setPending(false); setError(err instanceof Error ? err.message : 'Reconciliation failed')
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (mode === 'add-obligation' || mode === 'edit-obligation') {
    return (
      <CashCard title={mode === 'add-obligation' ? 'New recurring obligation' : 'Edit obligation'}>
        <ObligationForm
          initial={mode === 'edit-obligation' ? selectedObligation : null}
          pending={pending} error={error} accounts={accounts}
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
          pending={pending} error={error} accounts={accounts}
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

  if (mode === 'reconcile-commitment' && selectedCommitment) {
    return (
      <ReconcilePanel
        label={selectedCommitment.title}
        amountMinor={selectedCommitment.amount.minor}
        dateLabel={cashDate(selectedCommitment.expectedDate)}
        transactions={transactions}
        accounts={accounts}
        pending={pending}
        error={error}
        onSelect={handleReconcileCommitment}
        onBack={reset}
      />
    )
  }

  if (mode === 'reconcile-occurrence' && selectedObligation) {
    const obligation = selectedObligation
    const dates = reconcilableDates(obligation, occurrences, todayInLA())
    if (!reconcileDate) {
      return (
        <CashCard title="Mark occurrence as paid">
          <p className="mb-1 text-sm font-semibold">{obligation.name}</p>
          <p className="mb-4 text-xs text-[var(--text-secondary)]">
            {money(obligation.amount.minor)} · {OBLIGATION_SCHEDULE_LABELS[scheduleFromObligation(obligation)] ?? obligation.recurrence.kind.replace(/_/g, ' ')}
          </p>
          <h4 className="mb-2 text-sm font-semibold">Which payment are you recording?</h4>
          {dates.length ? (
            <div className="space-y-2">
              {dates.map(d => (
                <button key={d.date} type="button"
                  onClick={() => setReconcileDate(d.date)}
                  className="w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-left text-sm hover:border-orange-500/50 hover:bg-orange-500/5">
                  <span className="font-medium">{cashDate(d.date)}</span>
                  <span className="ml-2 text-xs text-[var(--text-secondary)]">{d.occurrenceId ? 'unreconciled' : 'virtual'}</span>
                </button>
              ))}
            </div>
          ) : <CashEmpty>No unreconciled scheduled dates in the past 90 days.</CashEmpty>}
          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
          <button type="button" onClick={reset} className={`mt-4 ${btnGhost}`}>Cancel</button>
        </CashCard>
      )
    }
    return (
      <ReconcilePanel
        label={obligation.name}
        amountMinor={obligation.amount.minor}
        dateLabel={cashDate(reconcileDate)}
        transactions={transactions}
        accounts={accounts}
        pending={pending}
        error={error}
        onSelect={handleReconcileOccurrence}
        onBack={() => setReconcileDate(null)}
      />
    )
  }

  const addBtn = (onClick: () => void, label: string) => (
    <button onClick={onClick} className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600">{label}</button>
  )

  return (
    <div className="space-y-5">
      {successResult && (
        <div className="rounded-xl border border-green-600/40 bg-green-500/[0.08] p-4 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-green-300">✓ Payment recorded</p>
              <p className="mt-1">
                <span className="font-medium">{successResult.name}</span>
                {' · '}{successResult.dateLabel}
              </p>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Transaction: {successResult.txDescription}
                {successResult.txDate ? ` · ${successResult.txDate}` : ''}
                {' · '}{money(successResult.txAmountMinor)}
              </p>
              {successResult.isRecurring && (
                <p className="mt-2 text-xs text-green-400">
                  This obligation continues — next scheduled payment will appear automatically.
                </p>
              )}
            </div>
            <button type="button" onClick={() => setSuccessResult(null)} className={btnGhost}>Dismiss</button>
          </div>
        </div>
      )}
    <div className="grid gap-5 xl:grid-cols-2">
      <CashCard title="Recurring obligations" action={addBtn(() => setMode('add-obligation'), '+ Obligation')}>
        {obligations.length ? (
          <div className="space-y-3">
            {obligations.map(row => {
              const reconciledOccs = occurrences
                .filter(o => o.obligationId === row.id && o.reconciliationState === 'reconciled')
                .sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))
                .slice(0, 3)
              return (
              <div key={row.id} className="rounded-xl border border-[var(--border-primary)] p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <strong>{row.name}</strong>
                    <span className="ml-2 font-mono">{money(row.amount.minor)}</span>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">
                      {OBLIGATION_SCHEDULE_LABELS[scheduleFromObligation(row)] ?? row.recurrence.kind.replace(/_/g, ' ')} from {cashDate(row.recurrence.startDate)} · {row.requirement} · {row.confidence} · {row.status}{row.category ? ` · ${row.category}` : ''}
                    </p>
                    {reconciledOccs.length > 0 && (
                      <div className="mt-2 space-y-0.5 border-t border-[var(--border-primary)] pt-2">
                        {reconciledOccs.map(occ => (
                          <p key={occ.id} className="text-xs text-green-400/80">✓ {cashDate(occ.scheduledDate)} — paid</p>
                        ))}
                      </div>
                    )}
                  </div>
                  {row.status === 'active' && (
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" className={btnMicro}
                        onClick={() => { setSelectedId(row.id); setMode('edit-obligation') }}>Edit</button>
                      <button type="button" className={btnMicro}
                        onClick={() => { setSelectedId(row.id); setMode('confirm-archive') }}>Archive</button>
                      <button type="button" className={btnMicro}
                        onClick={() => { setSuccessResult(null); setSelectedId(row.id); setReconcileDate(null); setMode('reconcile-occurrence') }}>Mark Paid</button>
                    </div>
                  )}
                </div>
              </div>
              )
            })}
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
                        <button type="button" className={btnMicro}
                          onClick={() => { setSuccessResult(null); setSelectedId(row.id); setMode('reconcile-commitment') }}>Mark Paid</button>
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
    </div>
  )
}
