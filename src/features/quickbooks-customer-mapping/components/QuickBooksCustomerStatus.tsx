/**
 * src/features/quickbooks-customer-mapping/components/QuickBooksCustomerStatus.tsx
 *
 * QBO-4A.4 Task 9 — compact, reusable inline status + the single entry point that
 * opens the LinkQuickBooksCustomerModal. This is the drop-in for Prepare Invoice,
 * project headers, and service cards. It OWNS the headless useQuickBooksCustomerMapping
 * hook + the modal open state (so the host does not have to), and it renders the modal
 * via a portal.
 *
 * NON-GATING BY DESIGN: the status is purely informational. The absence of a mapping
 * never blocks Prepare Invoice / Save Draft / Approve / Save Approved / Save Estimate /
 * Approve Estimate. Hosts MUST NOT condition those actions on this component's state.
 *
 * Compact states (all ≤ one line + one action):
 *  - unresolved : "Customer needs to be confirmed before QuickBooks can be linked."
 *                 + [Resolve Customer] when the host provides onResolveCustomer
 *                 (STATE 1, actionable); otherwise the safe passive message.
 *  - disconnected: "QuickBooks not connected" + Connect (uses the EXISTING OAuth flow)
 *  - unlinked   : "Not linked" + "Link Customer"
 *  - linked     : "Joe Smith ✓ Linked" + "View / Change"
 *  - loading    : "Checking QuickBooks…" (no action)
 *  - error      : "Couldn't load QuickBooks status" + Retry
 *
 * No realmId / fingerprint / token / SyncToken is ever shown. The component only sees
 * the sanitized mapping state.
 */
import { Link2, Loader2, Plug, UserCheck } from 'lucide-react'
import { useState } from 'react'

import type { CustomerDirectoryEntry } from '../qboCustomerMappingTypes'
import { useQuickBooksCustomerMapping } from '../useQuickBooksCustomerMapping'
import { LinkQuickBooksCustomerModal } from './LinkQuickBooksCustomerModal'
import { ResolvePowerOnCustomerModal } from './ResolvePowerOnCustomerModal'

// Stable empty set so the embedded Resolve modal never crashes when a host does
// not wire the canonical directory (selectable is then empty — safe fallback).
const EMPTY_CANONICAL_IDS: ReadonlySet<string> = new Set<string>()

export interface QuickBooksCustomerStatusProps {
  /** Canonical PowerOn customer identity (relationship_accounts.id, a TEXT PK); null for name-only/legacy sources. */
  poweronCustomerId: string | null
  /** PowerOn customer display name (header). */
  customerName: string | null
  /** In-memory customer directory for Create-form prefill (no network). */
  customerDirectory?: readonly CustomerDirectoryEntry[]
  /**
   * QBO-4A.6 — the canonical relationship_accounts directory for the embedded
   * Resolve flow (the REAL PowerOn customers the owner may bind to). Falls back to
   * `customerDirectory` when the host has no separate canonical fetch. Selectable
   * entries are FILTERED to canonicalIds (present in relationship_accounts).
   */
  resolveDirectory?: readonly CustomerDirectoryEntry[]
  /** QBO-4A.6 — authoritative canonical id set; the Resolve modal selects only entries present here. */
  canonicalIds?: ReadonlySet<string>
  /** QBO-4A.6 — true while the canonical directory loads (Resolve shows a loading state, not a false empty). */
  resolveLoading?: boolean
  /** Host-known QBO connection flag; false => show disconnected state. */
  connected?: boolean | null
  /** Open the EXISTING OAuth connect flow. */
  onConnect?: () => void
  /**
   * QBO-4A.5 — resolve the PowerOn customer identity for a name-only/legacy
   * source. Provided ONLY by hosts whose source has a safe canonical persistence
   * path for a reconciled relationship_accounts UUID (Service Call / Project).
   * When provided, the unresolved state renders an actionable [Resolve Customer]
   * button (STATE 1) instead of the passive dead-end text. When omitted (e.g. an
   * unmigrated legacy BackupServiceLog with no accountId field), the unresolved
   * state stays the safe passive message — no persistence is invented.
   */
  onResolveCustomer?: (accountUuid: string) => void
  /** Optional compact label override (defaults to "QuickBooks Customer"). */
  label?: string
  /** Visually denser (for inline placement in tight rows). */
  dense?: boolean
}

export function QuickBooksCustomerStatus({
  poweronCustomerId,
  customerName,
  customerDirectory,
  resolveDirectory,
  canonicalIds,
  resolveLoading,
  connected,
  onConnect,
  onResolveCustomer,
  label = 'QuickBooks Customer',
  dense = false,
}: QuickBooksCustomerStatusProps) {
  const api = useQuickBooksCustomerMapping({ poweronCustomerId, connected })
  const [open, setOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const s = api.state

  const base = dense ? 'text-[11px]' : 'text-xs'
  const row = 'flex items-center gap-1.5'

  let body: React.ReactNode
  if (s.kind === 'loading') {
    body = (
      <span className={`${row} ${base} text-gray-400`}>
        <Loader2 size={11} className="animate-spin" /> Checking QuickBooks…
      </span>
    )
  } else if (s.kind === 'unresolved') {
    body = onResolveCustomer ? (
      <span className={`${row} ${base}`}>
        <span className="text-amber-300">Customer needs to be confirmed before QuickBooks can be linked.</span>
        <button type="button" onClick={() => setResolveOpen(true)} className="flex items-center gap-1 text-amber-300 hover:underline">
          <UserCheck size={11} /> Resolve Customer
        </button>
      </span>
    ) : (
      <span className={`${base} text-amber-300`}>Customer needs to be confirmed before QuickBooks can be linked.</span>
    )
  } else if (s.kind === 'disconnected') {
    body = (
      <span className={`${row} ${base}`}>
        <span className="text-gray-400">QuickBooks not connected</span>
        {onConnect && (
          <button type="button" onClick={onConnect} className="flex items-center gap-1 text-sky-400 hover:underline">
            <Plug size={11} /> Connect
          </button>
        )}
      </span>
    )
  } else if (s.kind === 'error') {
    body = (
      <span className={`${row} ${base}`}>
        <span className="text-gray-400">Couldn't load QuickBooks status</span>
        <button type="button" onClick={() => void api.refresh()} className="text-sky-400 hover:underline">Retry</button>
      </span>
    )
  } else if (s.kind === 'unlinked') {
    body = (
      <span className={`${row} ${base}`}>
        <span className="text-gray-400">Not linked</span>
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 text-sky-400 hover:underline">
          <Link2 size={11} /> Link Customer
        </button>
      </span>
    )
  } else {
    // linked
    body = (
      <span className={`${row} ${base}`}>
        <span className="text-gray-200">{s.customer.displayName || 'Linked customer'}</span>
        <span className="text-emerald-400">✓ Linked</span>
        <button type="button" onClick={() => setOpen(true)} className="text-sky-400 hover:underline">View / Change</button>
      </span>
    )
  }

  return (
    <>
      <div className={`${row} ${base}`}>
        <span className="font-semibold text-gray-500">{label}:</span>
        {body}
      </div>
      <LinkQuickBooksCustomerModal
        open={open}
        onClose={() => setOpen(false)}
        api={api}
        poweronCustomerId={poweronCustomerId}
        customerName={customerName}
        customerDirectory={customerDirectory}
        connected={connected}
        onConnect={onConnect}
      />
      {onResolveCustomer && (
        <ResolvePowerOnCustomerModal
          open={resolveOpen}
          onClose={() => setResolveOpen(false)}
          currentName={customerName}
          directory={resolveDirectory ?? customerDirectory ?? []}
          canonicalIds={canonicalIds ?? EMPTY_CANONICAL_IDS}
          loading={resolveLoading}
          onConfirm={(uuid) => {
            onResolveCustomer(uuid)
            setResolveOpen(false)
          }}
        />
      )}
    </>
  )
}