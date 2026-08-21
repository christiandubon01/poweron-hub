/**
 * src/features/quickbooks-customer-mapping/components/ResolvePowerOnCustomerModal.tsx
 *
 * QBO-4A.5 — the explicit "Resolve PowerOn Customer" flow for a billing source
 * whose customer is a legacy NAME snapshot with NO reconciled relationship_accounts
 * UUID (the dead-end reported at runtime: "Customer identity needs to be resolved"
 * with no action).
 *
 * This modal lets the owner explicitly bind the source to an EXISTING PowerOn
 * relationship account so the normal QBO Customer mapping workflow (search /
 * link / create) becomes available. It is the FIRST of two explicit owner actions;
 * it does NOT touch QuickBooks (no QBO customer create/link, no Send, no fetch).
 *
 * LOCKED behavior:
 *  - Selects from the PowerOn customer directory (the canonical relationship_accounts
 *    rows — see useCanonicalCustomerDirectory), FILTERED to CANONICAL ids only
 *    (present in canonicalIds). Identity is NEVER validated by UUID format — real
 *    PowerOn customer ids are TEXT ('gc...', 'import_gc_...'). Local-only /
 *    unpersisted ids and bare names can never be selected/persisted.
 *  - The current record's name snapshot is shown as CONTEXT ONLY ("Current record
 *    customer: \"test\""). It is NEVER used to auto-select, auto-confirm, or match.
 *  - Even if exactly one entry obviously matches the snapshot name: NO auto-select.
 *    The owner clicks a row AND clicks "Confirm Customer".
 *  - "Confirm Customer" is disabled until a row is explicitly selected.
 *  - No matching PowerOn customer → "No existing PowerOn customer found." Customer
 *    creation is NOT added here (reported for a follow-up; do not widen).
 *  - While the canonical directory is loading → a loading state (NOT a false empty).
 *  - No network, no QBO write, no persistence authority. The host owns persistence
 *    via `onConfirm(accountId)` (the canonical TEXT relationship_accounts.id).
 *
 * Presentational + host-driven: matches the repo dialog portal convention (fixed
 * overlay, z-[8800], Escape to close, document.body portal). No hooks beyond local
 * UI state (search term + selected id).
 */
import { Loader2, Search, UserCheck, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import type { CustomerDirectoryEntry } from '../qboCustomerMappingTypes'
import {
  filterResolveEntries,
  formatResolveEntryLabel,
  selectableResolveEntries,
} from '../resolvePowerOnCustomerDirectory'

export interface ResolvePowerOnCustomerModalProps {
  open: boolean
  onClose: () => void
  /** The source's current name snapshot — context only, never used to match. */
  currentName: string | null
  /** PowerOn customer directory (canonical relationship_accounts rows). No QBO network. */
  directory: readonly CustomerDirectoryEntry[]
  /** The authoritative canonical id set (relationship_accounts.id). Selectable = directory ∩ canonicalIds. */
  canonicalIds: ReadonlySet<string>
  /** True while the host loads the canonical directory (shows a loading state, not a false empty). */
  loading?: boolean
  /** Host persistence callback. Receives the explicitly selected canonical TEXT id. */
  onConfirm: (accountId: string) => void
  /** Host persistence in flight (disables Confirm + close). */
  busy?: boolean
}

export function ResolvePowerOnCustomerModal({
  open,
  onClose,
  currentName,
  directory,
  canonicalIds,
  loading = false,
  onConfirm,
  busy = false,
}: ResolvePowerOnCustomerModalProps) {
  const [term, setTerm] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Reset transient state whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setTerm('')
    setSelectedId(null)
  }, [open])

  // Close on Escape (unless persistence is in flight).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, busy])

  const selectable = useMemo(() => selectableResolveEntries(directory, canonicalIds), [directory, canonicalIds])
  const results = useMemo(() => filterResolveEntries(selectable, term), [selectable, term])

  if (!open) return null

  function handleConfirm(): void {
    if (!selectedId || busy) return
    onConfirm(selectedId)
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resolve PowerOn Customer"
      className="fixed inset-0 z-[8800] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="relative flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] text-gray-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <UserCheck size={16} className="text-amber-400" />
            <h2 className="text-sm font-bold">RESOLVE CUSTOMER</h2>
          </div>
          <button
            type="button"
            onClick={() => { if (!busy) onClose() }}
            aria-label="Close"
            disabled={busy}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Current record customer — CONTEXT ONLY. Never used to match. */}
          <div className="mb-3 rounded border border-gray-700 bg-gray-800/30 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Current record customer</div>
            <div className="text-sm font-semibold text-gray-100">"{currentName || '—'}"</div>
            <p className="mt-1 text-[10px] text-gray-500">
              Shown for context only. The PowerOn customer below is never auto-selected by matching this name.
            </p>
          </div>

          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            Select the PowerOn customer this work belongs to
          </label>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-gray-500" />
            <input
              type="text"
              aria-label="Search PowerOn customers"
              placeholder="Search PowerOn customers…"
              value={term}
              onChange={(e) => { setTerm(e.target.value); setSelectedId(null) }}
              className="w-full rounded border border-gray-600 bg-gray-900 py-1.5 pl-8 pr-2 text-xs text-gray-100"
            />
          </div>

          {loading ? (
            <div className="mt-2.5 flex items-center justify-center gap-2 rounded border border-gray-700 p-3 text-[11px] text-gray-400">
              <Loader2 size={13} className="animate-spin" /> Loading PowerOn customers…
            </div>
          ) : results.length > 0 ? (
            <ul className="mt-2.5 space-y-1.5">
              {results.map((r) => {
                const checked = selectedId === r.id
                return (
                  <li key={r.id}>
                    <label
                      className={`flex cursor-pointer items-start gap-2 rounded border p-2 transition-colors ${
                        checked ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/40' : 'border-gray-700 bg-gray-800/30 hover:bg-gray-800/60'
                      }`}
                    >
                      <input type="radio" name="poweron-customer" checked={checked} onChange={() => setSelectedId(r.id)} className="mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-gray-100">{formatResolveEntryLabel(r)}</span>
                        {r.company && r.contact && <span className="block text-[10px] text-gray-400">{r.contact}</span>}
                        {r.email && <span className="block text-[10px] text-gray-500">{r.email}</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="mt-2.5 rounded border border-dashed border-gray-700 p-3 text-center text-[11px] text-gray-500">
              No existing PowerOn customer found.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-700 px-4 py-3">
          <button
            type="button"
            onClick={() => { if (!busy) onClose() }}
            disabled={busy}
            className="rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedId || busy}
            className="rounded bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white enabled:hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Confirming…</span> : 'Confirm Customer'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}