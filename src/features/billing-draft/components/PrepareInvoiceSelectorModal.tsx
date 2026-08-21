/**
 * src/features/billing-draft/components/PrepareInvoiceSelectorModal.tsx
 *
 * QBO-2F1 — global "Prepare Invoice" selector. When the owner picks
 *   QuickBooks ▾ → Prepare Invoice
 * from the global Service header (where no individual source is selected),
 * this modal lists ONLY the eligible unpaid service work and lets the owner
 * pick one to open in the EXISTING PrepareInvoiceModal.
 *
 * Presentational + host-driven (no business logic here):
 *   - The host (V15rFieldLogPanel) computes the eligible list from the SINGLE
 *     unpaid authority (`getUnpaidServiceCalls` → `serviceBalanceDue`) and
 *     passes it in as `items`. This component never recomputes "unpaid",
 *     "outstanding", or any balance — it only displays what it is given.
 *   - Selecting an item calls `onSelect(id)`; the host opens the existing
 *     PrepareInvoiceModal with that exact Service Log as the source. No second
 *     invoice editor is created here.
 *
 * No QBO API, no Supabase, no payment/KPI mutation. Pure UI.
 */
import { FileText, X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { fmt } from '@/services/backupDataService'

export interface UnpaidServiceItem {
  id: string
  customer: string
  jobLabel: string
  date: string
  /** Outstanding balance for display only (already truthful — computed by the
   *  host from the existing balance authority, not recalculated here). */
  balanceDue: number
}

export interface PrepareInvoiceSelectorModalProps {
  open: boolean
  onClose: () => void
  /** Eligible unpaid service work, as computed by the host from the shared
   *  unpaid authority. Empty list → empty state (the menu item is also hidden
   *  by the host when there is nothing eligible, so this is defensive). */
  items: UnpaidServiceItem[]
  /** Open the existing PrepareInvoiceModal for the selected service log id. */
  onSelect: (id: string) => void
}

export function PrepareInvoiceSelectorModal({
  open,
  onClose,
  items,
  onSelect,
}: PrepareInvoiceSelectorModalProps) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Prepare Invoice — Unpaid Service Work"
      className="fixed inset-0 z-[8800] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] text-gray-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-sky-400" />
            <h2 className="text-sm font-bold">Prepare Invoice — Unpaid Service Work</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3">
          {items.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-500">
              No unpaid service work to invoice.
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-slate-700/50 bg-slate-950/30 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-semibold text-gray-200">
                        {item.customer || 'Unknown customer'}
                      </span>
                      {item.jobLabel && (
                        <span className="text-[10px] text-gray-500">{item.jobLabel}</span>
                      )}
                      {item.date && (
                        <span className="text-[10px] text-gray-500">{item.date}</span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] text-gray-400">
                      Balance remaining:{' '}
                      <span className="font-mono text-orange-400">{fmt(item.balanceDue)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    className="flex-shrink-0 rounded px-3 py-1.5 text-[11px] font-semibold bg-sky-600/20 text-sky-300 border border-sky-500/30 hover:bg-sky-600/30"
                  >
                    Prepare Invoice
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}