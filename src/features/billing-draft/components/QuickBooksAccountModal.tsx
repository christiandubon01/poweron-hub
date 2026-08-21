/**
 * src/features/billing-draft/components/QuickBooksAccountModal.tsx
 *
 * QBO-3A — QuickBooks Account modal. Centered PowerOn-style portal modal opened
 * from QuickBooks ▾ → QuickBooks Account (connected only).
 *
 * Displays ONLY the owner-approved initial information:
 *   - Connected status
 *   - Company name (or sanitized fallback)
 *   - Active connection
 *   - Connected timestamp
 *   - Disconnect QuickBooks button (with explicit confirmation)
 *
 * No realmId, no tokens, no client ids, no technical/debug info, no sync history,
 * no invoice/reconciliation/customer-mapping details. Those come in later phases.
 *
 * Disconnect requires an explicit confirmation before the destructive server
 * operation (compact, consistent with existing PowerOn destructive-action
 * patterns). The confirm step is rendered inline within the modal card.
 *
 * Presentational + host-driven: the host owns status + the disconnect call
 * (useQuickBooksConnection). No QBO API, no payment/KPI mutation.
 */
import { ShieldCheck, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export interface QuickBooksAccountModalProps {
  open: boolean
  onClose: () => void
  connected: boolean
  companyName: string | null
  connectedAt: string | null
  onDisconnect: () => void
  disconnecting: boolean
  disconnectError: string | null
}

export function formatConnectedAt(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return '—'
  }
}

export function QuickBooksAccountModal({
  open,
  onClose,
  connected,
  companyName,
  connectedAt,
  onDisconnect,
  disconnecting,
  disconnectError,
}: QuickBooksAccountModalProps) {
  const [confirming, setConfirming] = useState(false)

  // Close on Escape (unless a disconnect is in flight).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !disconnecting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, disconnecting])

  // Reset the confirm step whenever the modal closes.
  useEffect(() => {
    if (!open) setConfirming(false)
  }, [open])

  if (!open) return null

  function cancelConfirm(): void {
    if (!disconnecting) setConfirming(false)
  }

  function confirmDisconnect(): void {
    onDisconnect()
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="QuickBooks Account"
      className="fixed inset-0 z-[8800] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !disconnecting) onClose()
      }}
    >
      <div className="relative flex max-h-[94dvh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] text-gray-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-sky-400" />
            <h2 className="text-sm font-bold">QUICKBOOKS ACCOUNT</h2>
          </div>
          <button
            type="button"
            onClick={() => { if (!disconnecting) onClose() }}
            aria-label="Close"
            disabled={disconnecting}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {confirming ? (
            <div className="space-y-4">
              <div>
                <div className="text-sm font-semibold text-gray-100">Disconnect QuickBooks?</div>
                <p className="mt-2 text-xs leading-5 text-gray-400">
                  This revokes the QuickBooks connection and clears the stored credentials. You can
                  reconnect later. This cannot be undone.
                </p>
              </div>
              {disconnectError && (
                <div className="rounded border border-red-800/60 bg-red-900/20 px-3 py-2 text-[11px] text-red-300">
                  {disconnectError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelConfirm}
                  disabled={disconnecting}
                  className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmDisconnect}
                  disabled={disconnecting}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                >
                  {disconnecting ? 'Working...' : 'Disconnect'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-gray-600'}`}
                  aria-hidden="true"
                />
                <span className="font-semibold">{connected ? 'Connected' : 'Not connected'}</span>
              </div>

              <dl className="space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Company</dt>
                  <dd className="text-right text-gray-200">
                    {connected ? (companyName || 'QuickBooks company connected') : '—'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Connection</dt>
                  <dd className="text-right text-gray-200">{connected ? 'Active' : 'Inactive'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Connected</dt>
                  <dd className="text-right text-gray-200">{formatConnectedAt(connectedAt)}</dd>
                </div>
              </dl>

              {connected && (
                <div className="border-t border-gray-800 pt-3">
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    className="w-full rounded-md border border-red-800/60 bg-red-900/20 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-900/40"
                  >
                    Disconnect QuickBooks
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}