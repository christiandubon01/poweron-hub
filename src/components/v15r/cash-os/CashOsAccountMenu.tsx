import { useState, useEffect, useRef } from 'react'
import type { FinancialAccountRow } from '@/finance/ledgerTypes'
import {
  updateFinancialAccount,
  archiveFinancialAccount,
  restoreFinancialAccount,
} from '@/services/manualLedgerService'

/** Mutation-success callback; may return the authoritative refresh so the UI closes on fresh data. */
type Done = () => void | Promise<void>

// ── Styles ────────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-500'
const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]'
const btnPrimary = 'rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-50'
const btnGhost = 'rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]'

// ── Edit form ─────────────────────────────────────────────────────────────────

function EditForm({
  account,
  onSave,
  onCancel,
}: {
  account: FinancialAccountRow
  onSave: Done
  onCancel: () => void
}) {
  const [name, setName] = useState(account.display_name)
  const [ownership, setOwnership] = useState(account.ownership_context)
  const [includeInCash, setIncludeInCash] = useState(account.include_in_cash)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) { setErr('Account name cannot be blank'); return }
    setSaving(true)
    setErr(null)
    try {
      await updateFinancialAccount(account.id, {
        displayName: trimmed,
        ownershipContext: ownership as 'business' | 'personal',
        includeInCash: account.account_class === 'asset' ? includeInCash : false,
      })
    } catch (e: any) {
      setErr(e?.message ?? 'Save failed')
      setSaving(false)
      return
    }
    // The write is accepted; stay in "Saving…" until the refreshed data has been committed.
    await onSave()
  }

  return (
    <div className="space-y-3 pt-2">
      <div>
        <label className={labelCls}>Account name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className={`mt-1 ${inputCls}`}
          autoFocus
        />
      </div>
      <div>
        <label className={labelCls}>Ownership</label>
        <div className="mt-1 flex gap-2">
          {(['business', 'personal'] as const).map(o => (
            <button
              key={o}
              type="button"
              onClick={() => setOwnership(o)}
              className={ownership === o
                ? 'rounded-lg bg-orange-500/20 px-3 py-1.5 text-xs font-semibold text-orange-300 border border-orange-500/30'
                : 'rounded-lg border border-[var(--border-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}
            >
              {o === 'business' ? 'Business' : 'Personal'}
            </button>
          ))}
        </div>
      </div>
      {account.account_class === 'asset' && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInCash}
            onChange={e => setIncludeInCash(e.target.checked)}
            className="h-4 w-4 rounded accent-orange-500"
          />
          Include in Cash OS total cash
        </label>
      )}
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={handleSave} disabled={saving} className={btnPrimary}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className={btnGhost}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Archive confirm ───────────────────────────────────────────────────────────

function ArchiveConfirm({
  account,
  onConfirm,
  onCancel,
}: {
  account: FinancialAccountRow
  onConfirm: Done
  onCancel: () => void
}) {
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleConfirm() {
    setWorking(true)
    setErr(null)
    try {
      await archiveFinancialAccount(account.id)
    } catch (e: any) {
      setErr(e?.message ?? 'Archive failed')
      setWorking(false)
      return
    }
    await onConfirm()
  }

  return (
    <div className="space-y-3 pt-2">
      <p className="text-sm">
        Archive <strong>{account.display_name}</strong>? All ledger history is preserved and
        remains available for historical calculations. The account will be hidden from active
        selectors. You can restore it at any time.
      </p>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={handleConfirm} disabled={working}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50">
          {working ? 'Archiving…' : 'Archive'}
        </button>
        <button type="button" onClick={onCancel} disabled={working} className={btnGhost}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Mode = 'idle' | 'menu' | 'editing' | 'confirming_archive'

export function CashOsAccountMenu({
  account,
  onMutated,
}: {
  account: FinancialAccountRow
  onMutated: Done
}) {
  const [mode, setMode] = useState<Mode>('idle')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mode !== 'menu') return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMode('idle')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mode])

  if (mode === 'editing') {
    return (
      <EditForm
        account={account}
        onSave={async () => { await onMutated(); setMode('idle') }}
        onCancel={() => setMode('idle')}
      />
    )
  }

  if (mode === 'confirming_archive') {
    return (
      <ArchiveConfirm
        account={account}
        onConfirm={async () => { await onMutated(); setMode('idle') }}
        onCancel={() => setMode('idle')}
      />
    )
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMode(mode === 'menu' ? 'idle' : 'menu')}
        aria-label="Account options"
        className="rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:bg-white/10 hover:text-[var(--text-primary)] text-base leading-none"
      >
        ⋯
      </button>
      {mode === 'menu' && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-card)] py-1 shadow-lg">
          <button
            type="button"
            onClick={() => setMode('editing')}
            className="w-full px-4 py-2 text-left text-sm hover:bg-white/5"
          >
            Edit account
          </button>
          <button
            type="button"
            onClick={() => setMode('confirming_archive')}
            className="w-full px-4 py-2 text-left text-sm text-amber-300 hover:bg-white/5"
          >
            Archive account
          </button>
        </div>
      )}
    </div>
  )
}

// ── Restore button (used in archived accounts section) ────────────────────────

export function CashOsAccountRestore({
  account,
  onMutated,
}: {
  account: FinancialAccountRow
  onMutated: Done
}) {
  const [working, setWorking] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleRestore() {
    setWorking(true)
    setErr(null)
    try {
      await restoreFinancialAccount(account.id)
    } catch (e: any) {
      setErr(e?.message ?? 'Restore failed')
      setWorking(false)
      return
    }
    await onMutated()
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleRestore}
        disabled={working}
        className="rounded-lg border border-[var(--border-primary)] px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
      >
        {working ? 'Restoring…' : 'Restore'}
      </button>
      {err && <p className="mt-1 text-xs text-red-400">{err}</p>}
    </div>
  )
}
