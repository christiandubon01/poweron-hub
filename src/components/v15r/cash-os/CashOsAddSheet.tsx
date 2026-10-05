import { useState } from 'react'
import type { CashOsSourceBundle } from '@/services/cashOsReadService'
import type { FinancialAccountType, FinancialAccountClass, FinancialOwnershipContext } from '@/finance/ledgerTypes'
import {
  createFinancialAccount,
  recordOpeningBalance,
  recordManualTransaction,
  recordFinancialTransfer,
  recordFinancialCardPayment,
  recordBalanceReconciliation,
} from '@/services/manualLedgerService'
import { accountBalanceMinor } from '@/finance/ledgerCalculations'
import {
  resolveReconciliationEntry, reconciliationEntryHelp, reconciliationEntryError,
} from '@/finance/balanceReconciliation'
import { CashCard, money } from './cashOsUi'

/** Mutation-success callback: may return the authoritative refresh so the form can await it. */
type Done = () => void | Promise<void>

type AddMode = 'account' | 'income' | 'expense' | 'transfer' | 'card-payment' | 'reconcile'

const MODE_LABELS: Record<AddMode, string> = {
  account: 'Account',
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  'card-payment': 'Card / Loan Payment',
  reconcile: 'Opening Balance / Reconcile',
}

const ACCOUNT_TYPE_OPTIONS: { value: FinancialAccountType; label: string; cls: FinancialAccountClass }[] = [
  { value: 'checking',        label: 'Checking',        cls: 'asset'     },
  { value: 'savings',         label: 'Savings',         cls: 'asset'     },
  { value: 'cash',            label: 'Cash on Hand',    cls: 'asset'     },
  { value: 'other_asset',     label: 'Other Asset',     cls: 'asset'     },
  { value: 'credit_card',     label: 'Credit Card',     cls: 'liability' },
  { value: 'loan',            label: 'Loan',            cls: 'liability' },
  { value: 'other_liability', label: 'Other Liability', cls: 'liability' },
]

function accountClassFor(type: FinancialAccountType): FinancialAccountClass {
  return ['checking', 'savings', 'cash', 'other_asset'].includes(type) ? 'asset' : 'liability'
}

function defaultInclude(type: FinancialAccountType): boolean {
  return accountClassFor(type) === 'asset'
}

function todayInLA(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const p = (t: string) => parts.find(v => v.type === t)?.value ?? ''
  return `${p('year')}-${p('month')}-${p('day')}`
}

function parseDollars(raw: string): number {
  const val = parseFloat(raw.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(val) || val <= 0) throw new Error('Enter a valid positive amount')
  return Math.round(val * 100)
}

const inputCls = 'mt-1 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm'
const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]'
const submitCls = 'mt-4 rounded-lg bg-orange-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50'

// ─── Account form ──────────────────────────────────────────────────────────────

function AccountForm({ onSuccess, onMutated }: { onSuccess: Done; onMutated?: Done }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FinancialAccountType>('checking')
  const [ownership, setOwnership] = useState<FinancialOwnershipContext>('business')
  const [include, setInclude] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ id: string; display_name: string; account_class: FinancialAccountClass } | null>(null)

  // Opening balance sub-step
  const [obAmount, setObAmount] = useState('')
  const [obDate, setObDate] = useState(todayInLA())
  const [obPending, setObPending] = useState(false)
  const [obError, setObError] = useState<string | null>(null)

  const cls = accountClassFor(type)
  const isLiability = cls === 'liability'

  function onTypeChange(v: FinancialAccountType) {
    setType(v)
    setInclude(defaultInclude(v))
  }

  function resetAccountForm() {
    setCreated(null)
    setName('')
    setType('checking')
    setOwnership('business')
    setInclude(true)
    setObAmount('')
    setObDate(todayInLA())
    setObError(null)
  }

  async function submitAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setPending(true)
    setError(null)
    try {
      const row = await createFinancialAccount({
        displayName: name.trim(),
        accountType: type,
        accountClass: cls,
        ownershipContext: ownership,
        includeInCash: isLiability ? false : include,
      })
      setCreated({ id: row.id, display_name: row.display_name, account_class: row.account_class })
      await onMutated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  async function submitOpeningBalance(e: React.FormEvent) {
    e.preventDefault()
    if (!created) return
    setObPending(true)
    setObError(null)
    try {
      const amountMinor = parseDollars(obAmount)
      await recordOpeningBalance({
        accountId: created.id,
        amountMinor,
        asOfDate: obDate,
        idempotencyKey: crypto.randomUUID(),
      })
      resetAccountForm()
      await onSuccess()
    } catch (err) {
      setObError(err instanceof Error ? err.message : String(err))
    } finally {
      setObPending(false)
    }
  }

  if (created) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4">
          <p className="text-sm font-semibold text-green-300">✓ Account created: {created.display_name}</p>
        </div>
        <CashCard title="Opening balance (optional)">
          <p className="mb-4 text-sm text-[var(--text-secondary)]">
            Enter the current balance to initialize this account. Skip to add the opening balance later.
          </p>
          <form onSubmit={submitOpeningBalance} className="space-y-4">
            <label className="block">
              <span className={labelCls}>Amount</span>
              <input type="text" inputMode="decimal" placeholder="0.00"
                value={obAmount} onChange={e => setObAmount(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>As of date</span>
              <input type="date" value={obDate} onChange={e => setObDate(e.target.value)} className={inputCls} />
            </label>
            {obError && <p className="text-xs text-red-300">{obError}</p>}
            <div className="flex gap-3">
              <button type="submit" disabled={obPending || !obAmount} className={submitCls}>
                {obPending ? 'Saving…' : 'Set opening balance'}
              </button>
              <button type="button" onClick={onSuccess}
                className="rounded-lg border border-[var(--border-primary)] px-4 py-2 text-sm hover:bg-white/5">
                Skip
              </button>
            </div>
          </form>
        </CashCard>
      </div>
    )
  }

  return (
    <form onSubmit={submitAccount} className="space-y-4">
      <CashCard>
        <p className="mb-4 text-sm text-[var(--text-secondary)]">
          Add the places where your money actually lives. Start with checking, cash, or savings.
          Credit cards and loans can be added as liabilities — they won't count as cash.
        </p>
        <div className="space-y-4">
          <label className="block">
            <span className={labelCls}>Account name</span>
            <input type="text" placeholder="e.g. Wells Fargo Business Checking" required
              value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Account type</span>
            <select value={type} onChange={e => onTypeChange(e.target.value as FinancialAccountType)} className={inputCls}>
              {ACCOUNT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {isLiability ? 'Liability — will not count as Total Cash' : 'Asset — counts as Total Cash when included'}
            </span>
          </label>
          <label className="block">
            <span className={labelCls}>Ownership</span>
            <select value={ownership} onChange={e => setOwnership(e.target.value as FinancialOwnershipContext)} className={inputCls}>
              <option value="business">Business</option>
              <option value="personal">Personal</option>
            </select>
          </label>
          {!isLiability && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={include} onChange={e => setInclude(e.target.checked)} />
              Include in Cash OS Total Cash
            </label>
          )}
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <button type="submit" disabled={pending || !name.trim()} className={submitCls}>
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </CashCard>
    </form>
  )
}

// ─── Income / Expense form ─────────────────────────────────────────────────────

function TransactionForm({ mode, sources, onSuccess }: {
  mode: 'income' | 'expense'
  sources: CashOsSourceBundle | null
  onSuccess: Done
}) {
  const assetAccounts = (sources?.accounts ?? []).filter(a => a.status === 'active' && a.account_class === 'asset')
  const [accountId, setAccountId] = useState(() => assetAccounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayInLA())
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!assetAccounts.length) {
    return <CashCard><p className="text-sm text-[var(--text-secondary)]">No accounts found. Create an account first.</p></CashCard>
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const amountMinor = parseDollars(amount)
      // Schema: amount_minor is signed — positive for asset inflows, negative for outflows
      const signedAmountMinor = mode === 'income' ? amountMinor : -amountMinor
      await recordManualTransaction({
        accountId,
        amountMinor: signedAmountMinor,
        transactionDate: date,
        kind: mode,
        economicEffect: mode === 'income' ? 'inflow' : 'outflow',
        economicAmountMinor: amountMinor,
        description: description || undefined,
        category: category || null,
        idempotencyKey: crypto.randomUUID(),
      })
      setAmount('')
      setDescription('')
      setCategory('')
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <CashCard>
        <div className="space-y-4">
          <label className="block">
            <span className={labelCls}>Account</span>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputCls}>
              {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Amount</span>
            <input type="text" inputMode="decimal" placeholder="0.00" required
              value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Description</span>
            <input type="text"
              placeholder={mode === 'income' ? 'e.g. Client payment' : 'e.g. Office supplies'}
              value={description} onChange={e => setDescription(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Category (optional)</span>
            <input type="text" placeholder="e.g. Sales, Operations"
              value={category} onChange={e => setCategory(e.target.value)} className={inputCls} />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <button type="submit" disabled={pending || !amount || !accountId} className={submitCls}>
          {pending ? 'Saving…' : `Record ${mode}`}
        </button>
      </CashCard>
    </form>
  )
}

// ─── Transfer form ─────────────────────────────────────────────────────────────

function TransferForm({ sources, onSuccess }: { sources: CashOsSourceBundle | null; onSuccess: Done }) {
  const assetAccounts = (sources?.accounts ?? []).filter(a => a.status === 'active' && a.account_class === 'asset')
  const [sourceId, setSourceId] = useState(() => assetAccounts[0]?.id ?? '')
  const [targetId, setTargetId] = useState(() => assetAccounts[1]?.id ?? assetAccounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayInLA())
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sameAccount = !!sourceId && sourceId === targetId

  if (assetAccounts.length < 2) {
    return <CashCard><p className="text-sm text-[var(--text-secondary)]">At least two accounts are needed to record a transfer.</p></CashCard>
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (sameAccount) { setError('Source and destination must be different accounts'); return }
    setPending(true)
    setError(null)
    try {
      const amountMinor = parseDollars(amount)
      await recordFinancialTransfer({
        sourceAccountId: sourceId,
        targetAccountId: targetId,
        amountMinor,
        transactionDate: date,
        description: description || undefined,
        idempotencyKey: crypto.randomUUID(),
      })
      setAmount('')
      setDescription('')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <CashCard>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          Transfers move money between your accounts. They are not income or expense for Cash OS.
        </p>
        <div className="space-y-4">
          <label className="block">
            <span className={labelCls}>From account</span>
            <select value={sourceId} onChange={e => setSourceId(e.target.value)} className={inputCls}>
              {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>To account</span>
            <select value={targetId} onChange={e => setTargetId(e.target.value)} className={inputCls}>
              {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
          </label>
          {sameAccount && <p className="text-xs text-amber-300">Source and destination must be different accounts</p>}
          <label className="block">
            <span className={labelCls}>Amount</span>
            <input type="text" inputMode="decimal" placeholder="0.00" required
              value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Description (optional)</span>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputCls} />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <button type="submit" disabled={pending || !amount || sameAccount} className={submitCls}>
          {pending ? 'Saving…' : 'Record transfer'}
        </button>
      </CashCard>
    </form>
  )
}

// ─── Card / Loan Payment form ──────────────────────────────────────────────────

function CardPaymentForm({ sources, onSuccess }: { sources: CashOsSourceBundle | null; onSuccess: Done }) {
  const assetAccounts = (sources?.accounts ?? []).filter(a => a.status === 'active' && a.account_class === 'asset')
  const liabilityAccounts = (sources?.accounts ?? []).filter(a => a.status === 'active' && a.account_class === 'liability')
  const [cashAccountId, setCashAccountId] = useState(() => assetAccounts[0]?.id ?? '')
  const [liabilityAccountId, setLiabilityAccountId] = useState(() => liabilityAccounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayInLA())
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!assetAccounts.length || !liabilityAccounts.length) {
    return (
      <CashCard>
        <p className="text-sm text-[var(--text-secondary)]">
          {!assetAccounts.length
            ? 'No cash accounts found. Add a checking, savings, or cash account first.'
            : 'No credit card or loan accounts found. Add a liability account first.'}
        </p>
      </CashCard>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const amountMinor = parseDollars(amount)
      await recordFinancialCardPayment({
        cashAccountId,
        liabilityAccountId,
        amountMinor,
        transactionDate: date,
        description: description || undefined,
        idempotencyKey: crypto.randomUUID(),
      })
      setAmount('')
      setDescription('')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <CashCard>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          Paying a card or loan reduces your cash and the liability balance. It is not a new operating expense.
        </p>
        <div className="space-y-4">
          <label className="block">
            <span className={labelCls}>Pay from (cash account)</span>
            <select value={cashAccountId} onChange={e => setCashAccountId(e.target.value)} className={inputCls}>
              {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Pay to (credit card / loan)</span>
            <select value={liabilityAccountId} onChange={e => setLiabilityAccountId(e.target.value)} className={inputCls}>
              {liabilityAccounts.map(a => <option key={a.id} value={a.id}>{a.display_name} ({a.account_type.replace(/_/g, ' ')})</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Amount</span>
            <input type="text" inputMode="decimal" placeholder="0.00" required
              value={amount} onChange={e => setAmount(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className={labelCls}>Description (optional)</span>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputCls} />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <button type="submit" disabled={pending || !amount} className={submitCls}>
          {pending ? 'Saving…' : 'Record payment'}
        </button>
      </CashCard>
    </form>
  )
}

// ─── Opening Balance / Reconcile form ─────────────────────────────────────────

function ReconcileForm({ sources, onSuccess }: { sources: CashOsSourceBundle | null; onSuccess: Done }) {
  const allAccounts = (sources?.accounts ?? []).filter(a => a.status === 'active')
  const [accountId, setAccountId] = useState(() => allAccounts[0]?.id ?? '')
  const [targetAmount, setTargetAmount] = useState('')
  const [date, setDate] = useState(todayInLA())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!allAccounts.length) {
    return <CashCard><p className="text-sm text-[var(--text-secondary)]">No accounts found. Create an account first.</p></CashCard>
  }

  const selectedAccount = allAccounts.find(a => a.id === accountId)
  const isLiability = selectedAccount?.account_class === 'liability'
  const currentCanonicalMinor = accountId && sources && date
    ? accountBalanceMinor(accountId, sources.transactions, date)
    : 0

  // Asset targets are signed ledger balances (an overdrawn checking account is negative);
  // liability targets are the positive amount owed. No blanket absolute-value conversion.
  const entry = resolveReconciliationEntry({
    accountClass: selectedAccount?.account_class,
    rawAmount: targetAmount,
    currentCanonicalMinor,
  })
  const targetMinor = entry.ok ? entry.targetMinor : null
  const deltaMinor = entry.ok ? entry.deltaMinor : null
  const isPartialSign = /^[-−(]?\$?\.?$/.test(targetAmount.trim())
  const entryError = !entry.ok && entry.reason !== 'empty' && !isPartialSign
    ? reconciliationEntryError(entry.reason) : null

  const isNoop = deltaMinor === 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (targetMinor === null) return
    if (isNoop) { await onSuccess(); return }
    setPending(true)
    setError(null)
    try {
      await recordBalanceReconciliation({
        accountId,
        targetOwnerMinor: targetMinor,
        currentCanonicalMinor,
        asOfDate: date,
        idempotencyKey: crypto.randomUUID(),
      })
      setTargetAmount('')
      await onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <CashCard>
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          Updates the account's ledger balance without recording income or expense.
        </p>
        <div className="space-y-4">
          <label className="block">
            <span className={labelCls}>Account</span>
            <select value={accountId} onChange={e => setAccountId(e.target.value)} className={inputCls}>
              {allAccounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.display_name} ({a.account_class === 'liability' ? 'Liability' : 'Asset'})
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm">
            <span className="text-xs text-[var(--text-muted)]">Current canonical balance</span>
            <p className="font-mono font-semibold">
              {money(currentCanonicalMinor)}
              {isLiability ? ' owed' : ''}
            </p>
          </div>
          <label className="block">
            <span className={labelCls}>
              {isLiability ? 'Real-world balance owed' : 'Real-world balance'}
            </span>
            {/* Numeric soft keyboards have no minus key, so asset accounts use a text keypad. */}
            <input type="text" inputMode={isLiability ? 'decimal' : 'text'} placeholder="0.00" required
              value={targetAmount} onChange={e => setTargetAmount(e.target.value)} className={inputCls} />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              {reconciliationEntryHelp(selectedAccount?.account_class)}
            </span>
            {entryError && <span className="mt-1 block text-xs text-red-300">{entryError}</span>}
          </label>
          {deltaMinor !== null && (
            <div className={`rounded-lg border px-3 py-2 text-sm ${
              isNoop
                ? 'border-green-500/40 bg-green-500/10'
                : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]'
            }`}>
              <span className="text-xs text-[var(--text-muted)]">Adjustment to record</span>
              <p className="font-mono font-semibold">
                {isNoop
                  ? 'None — canonical balance already matches'
                  : `${deltaMinor > 0 ? '+' : ''}${money(deltaMinor)}`}
              </p>
            </div>
          )}
          <label className="block">
            <span className={labelCls}>As of date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={pending || targetMinor === null}
          className={submitCls}
        >
          {pending ? 'Saving…' : isNoop ? 'Already reconciled' : 'Reconcile balance'}
        </button>
      </CashCard>
    </form>
  )
}

// ─── Sheet shell ───────────────────────────────────────────────────────────────

export interface CashOsAddSheetProps {
  organizationId: string
  sources: CashOsSourceBundle | null
  onClose: () => void
  /** Called after a mutation succeeds; awaited so the sheet only closes on refreshed data. */
  onSuccess: Done
  /** Refresh without closing the sheet (e.g. a newly created account before its opening balance). */
  onMutated?: Done
}

export default function CashOsAddSheet({ sources, onClose, onSuccess, onMutated }: CashOsAddSheetProps) {
  const [mode, setMode] = useState<AddMode>('account')

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add money"
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-[var(--bg-secondary)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--border-primary)] p-4 sm:p-6">
          <h2 className="font-bold text-[var(--text-primary)]">Add</h2>
          <button onClick={onClose}
            className="rounded-lg border border-[var(--border-primary)] px-3 py-2 text-sm hover:bg-white/5">
            ✕ Close
          </button>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--border-primary)] px-4 sm:px-6">
          {(Object.keys(MODE_LABELS) as AddMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
              className={`whitespace-nowrap border-b-2 px-3 py-3 text-sm font-semibold ${
                mode === m ? 'border-orange-400 text-orange-300' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}>
              {MODE_LABELS[m]}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {mode === 'account'       && <AccountForm onSuccess={onSuccess} onMutated={onMutated} />}
          {mode === 'income'        && <TransactionForm mode="income"  sources={sources} onSuccess={onSuccess} />}
          {mode === 'expense'       && <TransactionForm mode="expense" sources={sources} onSuccess={onSuccess} />}
          {mode === 'transfer'      && <TransferForm sources={sources} onSuccess={onSuccess} />}
          {mode === 'card-payment'  && <CardPaymentForm sources={sources} onSuccess={onSuccess} />}
          {mode === 'reconcile'     && <ReconcileForm sources={sources} onSuccess={onSuccess} />}
        </div>
      </div>
    </div>
  )
}
