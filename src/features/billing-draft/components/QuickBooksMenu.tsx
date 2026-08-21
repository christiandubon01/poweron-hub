/**
 * src/features/billing-draft/components/QuickBooksMenu.tsx
 *
 * QBO-2F/2F1 — one reusable QuickBooks action menu ("QuickBooks ▾") consolidating
 * QuickBooks functionality behind a single button. The available actions are
 * context-specific and passed in by the host (no business logic hardcoded here):
 *
 *     Prepare Invoice        → opens Prepare Invoice for the current context
 *                              (omitted when showPrepareInvoice is false — e.g. the
 *                              global Service header when there is no unpaid work.
 *                              Never rendered as a disabled/fake placeholder.)
 *     Invoice Drafts         → opens the shared organization-wide Draft Manager
 *     Import QuickBooks PDF  → opens the existing PDF importer (global Service
 *                              header only; omitted when onImportQbPdf is absent)
 *
 * Contextual Project/Service menus pass only onPrepareInvoice + onOpenDrafts.
 * The global Service header additionally passes onImportQbPdf and gates
 * Prepare Invoice on whether unpaid service work exists (showPrepareInvoice).
 *
 * No fake/disabled placeholders for future functionality.
 *
 * Behavior: dropdown closes on selection, outside click, or Escape. Keyboard
 * accessible (button + menuitem roles, Escape to dismiss). No network, no
 * persistence, no QBO API — it only calls the host callbacks.
 */
import { ChevronDown, FileStack, FileText, Link2, Plug, Settings, Upload, UserCheck } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * Sanitized connection status for the menu header block. Carries no realmId,
 * no tokens, no encrypted blobs — only what the qbo-connection-status endpoint
 * returns. When omitted, no connection block is rendered (contextual menus).
 */
export interface QuickBooksConnectionStatus {
  connected: boolean
  companyName?: string | null
  /** Sanitized ISO timestamp the connection was established (from
   *  qbo-connection-status). null/undefined when not connected or not yet
   *  reported. Never fabricated from browser time. */
  connectedAt?: string | null
}

export interface QuickBooksMenuProps {
  /** Open Prepare Invoice for the current Project / Service Log / Service Call.
   *  Required when showPrepareInvoice is not false. */
  onPrepareInvoice: () => void
  /** Open the shared organization-wide Invoice Draft Manager. */
  onOpenDrafts: () => void
  /** Open the existing QuickBooks PDF importer (global Service header only).
   *  When omitted, the "Import QuickBooks PDF" item is not rendered. */
  onImportQbPdf?: () => void
  /** Whether to show the Prepare Invoice item. Defaults to true. Set false when
   *  there is no eligible unpaid work (global header) — the item is omitted
   *  entirely rather than shown disabled. */
  showPrepareInvoice?: boolean
  /** Sanitized QuickBooks connection status. When provided, the menu renders the
   *  connection header block (Not connected + Connect, or Connected + company
   *  name + QuickBooks Account) above the action items. Omit on contextual
   *  Project/Service menus that should not show connection state. */
  connectionStatus?: QuickBooksConnectionStatus
  /** Begin the same-tab OAuth connect flow (global header only). */
  onConnect?: () => void
  /** Open the QuickBooks Account modal (connected only, global header only). */
  onOpenAccount?: () => void
  /**
   * QBO-4A.4 Task 11 — contextual customer-mapping action. Provided ONLY by
   * Project/Service hosts whose customer identity is a reconciled UUID. When
   * omitted (global header / unknown identity), no customer item is rendered —
   * per the locked rule, customer actions are NOT added to the permanent global
   * menu. The host derives `customerLinkLabel` from the live mapping state.
   */
  onLinkCustomer?: () => void
  /** Label for the contextual customer item (e.g. "Link QuickBooks Customer" or
   *  "QuickBooks Customer: Joe Smith"). Defaults to "Link QuickBooks Customer". */
  customerLinkLabel?: string
  /**
   * QBO-4A.5 — contextual "Resolve Customer for QuickBooks" action for a source
   * whose PowerOn customer is an unresolved name snapshot (no reconciled UUID).
   * Provided ONLY by hosts whose source has a safe canonical persistence path
   * (Service Call / Project). The host passes EITHER onResolveCustomer (STATE 1,
   * unresolved) OR onLinkCustomer (STATE 2/3, resolved) — never both.
   */
  onResolveCustomer?: () => void
  /** Label for the Resolve item. Defaults to "Resolve Customer for QuickBooks". */
  resolveCustomerLabel?: string
  /** Dropdown alignment. Defaults to 'right'. */
  align?: 'left' | 'right'
  /** Optional compact label override (default "QuickBooks"). */
  label?: string
  /** Optional extra CSS class on the trigger button. */
  className?: string
}

export function QuickBooksMenu({
  onPrepareInvoice,
  onOpenDrafts,
  onImportQbPdf,
  showPrepareInvoice = true,
  connectionStatus,
  onConnect,
  onOpenAccount,
  onLinkCustomer,
  customerLinkLabel = 'Link QuickBooks Customer',
  onResolveCustomer,
  resolveCustomerLabel = 'Resolve Customer for QuickBooks',
  align = 'right',
  label = 'QuickBooks',
  className,
}: QuickBooksMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent): void {
      const root = rootRef.current
      if (root && !root.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function run(action: () => void): void {
    setOpen(false)
    action()
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        className={
          className ??
          'inline-flex items-center gap-1 rounded px-2.5 py-1 text-[9px] font-semibold bg-sky-600/20 text-sky-300 border border-sky-500/30 hover:bg-sky-600/30 transition-colors'
        }
      >
        {label} <ChevronDown size={11} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="QuickBooks actions"
          className={`absolute z-50 mt-1 min-w-[190px] rounded-md border border-gray-700 bg-[#111827] py-1 shadow-2xl ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          {connectionStatus && (
            <div className="px-1 pb-1">
              {connectionStatus.connected ? (
                <div className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-200">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="font-semibold">Connected</span>
                  </div>
                  <div className="mt-0.5 truncate pl-3.5 text-[10px] text-gray-400">
                    {connectionStatus.companyName || 'QuickBooks company connected'}
                  </div>
                  {onOpenAccount && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => run(onOpenAccount)}
                      className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-gray-200 hover:bg-gray-800"
                    >
                      <Settings size={12} className="shrink-0 text-gray-400" /> QuickBooks Account
                    </button>
                  )}
                </div>
              ) : (
                <div className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <span className="inline-block h-2 w-2 rounded-full bg-gray-600" aria-hidden="true" />
                    <span className="font-semibold">Not connected</span>
                  </div>
                  {onConnect && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => run(onConnect)}
                      className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-gray-200 hover:bg-gray-800"
                    >
                      <Plug size={12} className="shrink-0 text-gray-400" /> Connect QuickBooks
                    </button>
                  )}
                </div>
              )}
              <div className="my-1 border-t border-gray-700/70" />
            </div>
          )}
          {onResolveCustomer && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onResolveCustomer)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-gray-200 hover:bg-gray-800"
            >
              <UserCheck size={12} className="shrink-0 text-amber-400" /> {resolveCustomerLabel}
            </button>
          )}
          {onLinkCustomer && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onLinkCustomer)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-gray-200 hover:bg-gray-800"
            >
              <Link2 size={12} className="shrink-0 text-gray-400" /> {customerLinkLabel}
            </button>
          )}
          {showPrepareInvoice && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onPrepareInvoice)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-gray-200 hover:bg-gray-800"
            >
              <FileText size={12} className="shrink-0 text-gray-400" /> Prepare Invoice
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => run(onOpenDrafts)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-gray-200 hover:bg-gray-800"
          >
            <FileStack size={12} className="shrink-0 text-gray-400" /> Invoice Drafts
          </button>
          {onImportQbPdf && (
            <button
              type="button"
              role="menuitem"
              onClick={() => run(onImportQbPdf)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-gray-200 hover:bg-gray-800"
            >
              <Upload size={12} className="shrink-0 text-gray-400" /> Import QuickBooks PDF
            </button>
          )}
        </div>
      )}
    </div>
  )
}