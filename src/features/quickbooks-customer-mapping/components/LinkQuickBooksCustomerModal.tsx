/**
 * src/features/quickbooks-customer-mapping/components/LinkQuickBooksCustomerModal.tsx
 *
 * QBO-4A.4 Tasks 3-8,12 — the SINGLE reusable owner workflow for mapping a PowerOn
 * customer to a QuickBooks customer. This one modal serves BOTH approved entry points:
 *
 *   1. Proactive: QuickBooks ▾ → Link QuickBooks Customer (now).
 *   2. Required later at Send time: the future Send to QuickBooks action will open this
 *      same modal when the customer is unmapped. (Send is NOT built in this phase.)
 *
 * PRESENTATIONAL + api-driven: the host owns the network via the headless
 * useQuickBooksCustomerMapping hook and passes `api` in. The modal never calls a hook
 * of its own (Rules of Hooks + avoids a second mapping fetcher). It owns only local UI
 * state: search term + debounce, selected result, search/create/view mode, confirm
 * flags, and form fields.
 *
 * LOCKED behavior:
 *  - NEVER auto-links, even on a single obvious search result. The owner selects a
 *    result AND clicks "Link Customer".
 *  - NEVER auto-creates. Create opens ONLY from an explicit "Create customer in
 *    QuickBooks" action.
 *  - 6240 duplicate-name is NEVER auto-suffixed/merged/retried. The owner is offered
 *    Search Existing or may edit the name.
 *  - Split failure (QBO created, mapping not saved) NEVER retries Create blindly — it
 *    steers the owner to Search Existing Customers.
 *  - Unlink NEVER deletes the QBO customer or mapping history; it requires explicit
 *    confirmation. Change Mapping is an explicit, confirmed, two-step operation.
 *  - No realmId / fingerprint / tokens / SyncToken are ever displayed. The modal only
 *    sees the sanitized api state + search results.
 *  - A future remapping dependency guard can block Change once linked QBO documents
 *    exist; today `remappingGuard` defaults to allowed (no such documents exist yet).
 *
 * Styling mirrors the existing QuickBooksAccountModal / PrepareInvoiceModal portal
 * pattern (fixed overlay, z-[8800], Escape to close, document.body portal). No new
 * visual system.
 */
import { ArrowLeft, Link2, Loader2, Plug, Search, Unlink, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { resolveCreatePrefill } from '../resolveCreatePrefill'
import type {
  CreateCustomerInput,
  CustomerDirectoryEntry,
  QboCustomerSearchResult,
} from '../qboCustomerMappingTypes'
import { QboCustomerMappingApiError } from '../qboCustomerMappingTypes'
import type { QuickBooksCustomerMappingApi } from '../useQuickBooksCustomerMapping'

export interface LinkQuickBooksCustomerModalProps {
  open: boolean
  onClose: () => void
  /** The headless mapping API from the host's useQuickBooksCustomerMapping hook. */
  api: QuickBooksCustomerMappingApi
  /** Reconciled PowerOn customer UUID (null for name-only/legacy sources). */
  poweronCustomerId: string | null
  /** PowerOn customer display name (for the header; name-only context). */
  customerName: string | null
  /** In-memory customer directory for Create-form prefill (no network). */
  customerDirectory?: readonly CustomerDirectoryEntry[]
  /** Host-known QBO connection flag; false => show the disconnected state. */
  connected?: boolean | null
  /** Open the EXISTING OAuth connect flow (provided only where the host has it). */
  onConnect?: () => void
  /**
   * Future remapping guard: when { canChange: false }, Change Mapping is disabled with a
   * reason. Defaults to allowed — no QBO Estimate/Invoice linkage exists yet today.
   */
  remappingGuard?: { canChange: boolean; reason?: string }
}

/** Minimum search term length before a query is sent (matches the bounded server input). */
const MIN_SEARCH_TERM = 1
/** Debounce window for search-as-you-type (do not hammer QBO per keystroke). */
const SEARCH_DEBOUNCE_MS = 350

export function LinkQuickBooksCustomerModal({
  open,
  onClose,
  api,
  poweronCustomerId,
  customerName,
  customerDirectory,
  connected,
  onConnect,
  remappingGuard,
}: LinkQuickBooksCustomerModalProps) {
  const s = api.state
  const [mode, setMode] = useState<'search' | 'create'>('search')

  // Search state.
  const [term, setTerm] = useState('')
  const [debouncedTerm, setDebouncedTerm] = useState('')
  const [results, setResults] = useState<QboCustomerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchToken = useRef(0)

  // Mutation error (link/create) shown inline.
  const [actionError, setActionError] = useState<QboCustomerMappingApiError | null>(null)

  // Confirm flags.
  const [unlinkConfirm, setUnlinkConfirm] = useState(false)
  const [changeConfirm, setChangeConfirm] = useState(false)

  // Create-form fields.
  const prefill = useMemo(
    () => resolveCreatePrefill(poweronCustomerId, customerDirectory ?? []),
    [poweronCustomerId, customerDirectory],
  )
  const [createFields, setCreateFields] = useState<CreateFormFields>(() => emptyCreateFields(prefill))

  // Reset transient state whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setMode('search')
    setTerm('')
    setDebouncedTerm('')
    setResults([])
    setSelectedId(null)
    setSearchError(null)
    setActionError(null)
    setUnlinkConfirm(false)
    setChangeConfirm(false)
    setCreateFields(emptyCreateFields(prefill))
  }, [open, prefill])

  // Close on Escape (unless a mutation is in flight).
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !api.busy) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, api.busy])

  // Debounce the search term; clear stale results when it meaningfully changes.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setDebouncedTerm(term.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [term, open])

  // Run a search when the debounced term is long enough (only in search mode).
  useEffect(() => {
    if (!open || mode !== 'search') return
    if (debouncedTerm.length < MIN_SEARCH_TERM) {
      setResults([])
      setSearchError(null)
      return
    }
    const token = ++searchToken.current
    setSearching(true)
    setSearchError(null)
    api
      .search(debouncedTerm)
      .then((r) => {
        if (token !== searchToken.current) return // stale
        setResults(r)
        setSelectedId(null)
      })
      .catch((err) => {
        if (token !== searchToken.current) return
        setSearchError(err instanceof Error ? err.message : 'QuickBooks search failed.')
      })
      .finally(() => {
        if (token === searchToken.current) setSearching(false)
      })
  }, [debouncedTerm, open, mode, api])

  if (!open) return null

  const poweronDisplay = customerName || 'PowerOn customer'

  async function handleLink(): Promise<void> {
    if (!selectedId) return
    setActionError(null)
    try {
      await api.link(selectedId)
      // api.state flips to linked => the modal re-renders into the View branch.
    } catch (err) {
      setActionError(err instanceof QboCustomerMappingApiError ? err : new QboCustomerMappingApiError('unknown', 'Link failed.'))
    }
  }

  function buildCreateInput(): CreateCustomerInput | null {
    const displayName = createFields.displayName.trim()
    if (!displayName) return null
    const companyName = createFields.companyName.trim() || null
    const email = createFields.email.trim() || null
    const phone = createFields.phone.trim() || null
    const hasAddr = ['line1', 'city', 'state', 'postalCode', 'country'].some((k) => (createFields as any)[k].trim())
    const billAddr = hasAddr
      ? {
          line1: createFields.line1.trim() || null,
          city: createFields.city.trim() || null,
          state: createFields.state.trim() || null,
          postalCode: createFields.postalCode.trim() || null,
          country: createFields.country.trim() || null,
        }
      : null
    return {
      displayName,
      companyName,
      email,
      phone,
      billAddr,
    }
  }

  async function handleCreate(): Promise<void> {
    const input = buildCreateInput()
    if (!input) {
      setActionError(new QboCustomerMappingApiError('bad_request', 'A Display Name is required.'))
      return
    }
    setActionError(null)
    try {
      await api.create(input)
      // api.state flips to linked (linkOrigin 'created') => View branch.
    } catch (err) {
      setActionError(err instanceof QboCustomerMappingApiError ? err : new QboCustomerMappingApiError('unknown', 'Create failed.'))
    }
  }

  async function handleUnlink(): Promise<void> {
    setActionError(null)
    try {
      await api.unlink()
      setUnlinkConfirm(false)
      onClose()
    } catch (err) {
      setActionError(err instanceof QboCustomerMappingApiError ? err : new QboCustomerMappingApiError('unknown', 'Unlink failed.'))
    }
  }

  async function handleChangeMapping(): Promise<void> {
    setActionError(null)
    try {
      await api.unlink()
      setChangeConfirm(false)
      setMode('search')
      setResults([])
      setSelectedId(null)
      // api.state is now 'unlinked' => Search branch renders for the replacement.
    } catch (err) {
      setActionError(err instanceof QboCustomerMappingApiError ? err : new QboCustomerMappingApiError('unknown', 'Could not start changing the mapping.'))
    }
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Link QuickBooks Customer"
      className="fixed inset-0 z-[8800] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !api.busy) onClose()
      }}
    >
      <div className="relative flex max-h-[94dvh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] text-gray-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-sky-400" />
            <h2 className="text-sm font-bold">LINK QUICKBOOKS CUSTOMER</h2>
          </div>
          <button
            type="button"
            onClick={() => { if (!api.busy) onClose() }}
            aria-label="Close"
            disabled={api.busy}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* PowerOn customer header (always shown) */}
          <div className="mb-3 rounded border border-gray-700 bg-gray-800/30 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">PowerOn Customer</div>
            <div className="text-sm font-semibold text-gray-100">{poweronDisplay}</div>
          </div>

          {s.kind === 'disconnected' && (
            <DisconnectedBody connected={connected} onConnect={onConnect} />
          )}

          {s.kind === 'unresolved' && (
            <div className="rounded border border-amber-500/40 bg-amber-950/25 p-3 text-xs text-amber-200">
              PowerOn customer identity must be resolved before linking. No name-based matching is performed.
            </div>
          )}

          {s.kind === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading QuickBooks customer mapping…
            </div>
          )}

          {s.kind === 'error' && (
            <div className="space-y-3">
              <div className="rounded border border-red-800/60 bg-red-900/20 px-3 py-2 text-[11px] text-red-300">{s.message}</div>
              <button
                type="button"
                onClick={() => void api.refresh()}
                className="rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
              >
                Try again
              </button>
            </div>
          )}

          {s.kind === 'linked' && (
            <LinkedBody
              customer={s.customer}
              linkOrigin={s.linkOrigin}
              busy={api.busy}
              actionError={actionError}
              unlinkConfirm={unlinkConfirm}
              changeConfirm={changeConfirm}
              remappingGuard={remappingGuard}
              onUnlinkClick={() => setUnlinkConfirm(true)}
              onChangeClick={() => setChangeConfirm(true)}
              onConfirmUnlink={handleUnlink}
              onCancelUnlink={() => setUnlinkConfirm(false)}
              onConfirmChange={handleChangeMapping}
              onCancelChange={() => setChangeConfirm(false)}
            />
          )}

          {s.kind === 'unlinked' && mode === 'create' && (
            <CreateBody
              fields={createFields}
              setFields={setCreateFields}
              prefill={prefill}
              busy={api.busy}
              actionError={actionError}
              onCreate={handleCreate}
              onBack={() => setMode('search')}
            />
          )}

          {s.kind === 'unlinked' && mode === 'search' && (
            <SearchBody
              term={term}
              setTerm={setTerm}
              results={results}
              searching={searching}
              selectedId={selectedId}
              onSelect={setSelectedId}
              searchError={searchError}
              actionError={actionError}
              busy={api.busy}
              onLink={handleLink}
              onCreate={() => { setActionError(null); setMode('create') }}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Sub-views (inline, same file — matches repo dialog convention) ─────────────

function DisconnectedBody({ connected, onConnect }: { connected?: boolean | null; onConnect?: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-600" aria-hidden="true" />
        <span className="font-semibold">QuickBooks not connected</span>
      </div>
      <p className="text-xs text-gray-400">
        Connect QuickBooks first, then link this customer. {connected === false ? 'QuickBooks is currently not connected.' : ''}
      </p>
      {onConnect ? (
        <button
          type="button"
          onClick={onConnect}
          className="flex items-center gap-1.5 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
        >
          <Plug size={12} /> Connect QuickBooks
        </button>
      ) : (
        <p className="text-[11px] text-gray-500">Use the QuickBooks ▾ menu to connect QuickBooks.</p>
      )}
    </div>
  )
}

function SearchBody(props: {
  term: string
  setTerm: (t: string) => void
  results: readonly QboCustomerSearchResult[]
  searching: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  searchError: string | null
  actionError: QboCustomerMappingApiError | null
  busy: boolean
  onLink: () => void
  onCreate: () => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Search QuickBooks for an existing customer or create a new one. Even a single obvious match is never linked automatically — you choose.
      </p>
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-gray-500" />
        <input
          type="text"
          aria-label="Search QuickBooks customers"
          placeholder="Search QuickBooks customers…"
          value={props.term}
          onChange={(e) => props.setTerm(e.target.value)}
          className="w-full rounded border border-gray-600 bg-gray-900 py-1.5 pl-8 pr-2 text-xs text-gray-100"
        />
        {props.searching && <Loader2 size={12} className="absolute right-2.5 top-2.5 animate-spin text-gray-500" />}
      </div>

      {props.searchError && (
        <div className="rounded border border-red-800/60 bg-red-900/20 px-3 py-2 text-[11px] text-red-300">{props.searchError}</div>
      )}

      {props.results.length > 0 ? (
        <ul className="space-y-1.5">
          {props.results.map((r) => {
            const checked = props.selectedId === r.id
            return (
              <li key={r.id}>
                <label
                  className={`flex cursor-pointer items-start gap-2 rounded border p-2 transition-colors ${
                    checked ? 'border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40' : 'border-gray-700 bg-gray-800/30 hover:bg-gray-800/60'
                  }`}
                >
                  <input type="radio" name="qbo-customer" checked={checked} onChange={() => props.onSelect(r.id)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-gray-100">{r.displayName || '(no display name)'}</span>
                    {r.companyName && <span className="block text-[10px] text-gray-400">{r.companyName}</span>}
                    {r.email && <span className="block text-[10px] text-gray-500">{r.email}</span>}
                    {!r.active && <span className="mt-0.5 inline-block rounded bg-gray-700 px-1 text-[9px] font-bold text-gray-300">INACTIVE</span>}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      ) : (
        !props.searching && props.term.trim().length >= MIN_SEARCH_TERM && !props.searchError && (
          <p className="rounded border border-dashed border-gray-700 p-3 text-center text-[11px] text-gray-500">
            No QuickBooks customers matched. You can create a new one below.
          </p>
        )
      )}

      {props.actionError && <ActionErrorBlock err={props.actionError} onSearchExisting={undefined} />}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-700 pt-3">
        <button
          type="button"
          onClick={props.onCreate}
          className="flex items-center gap-1.5 rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
        >
          <UserPlus size={12} /> Create customer in QuickBooks
        </button>
        <button
          type="button"
          onClick={props.onLink}
          disabled={!props.selectedId || props.busy}
          className="rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white enabled:hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.busy ? 'Linking…' : 'Link Customer'}
        </button>
      </div>
    </div>
  )
}

interface CreateFormFields {
  displayName: string
  companyName: string
  email: string
  phone: string
  line1: string
  city: string
  state: string
  postalCode: string
  country: string
}

function CreateBody(props: {
  fields: CreateFormFields
  setFields: (f: CreateFormFields) => void
  prefill: { displayName: string; companyName: string | null; email: string | null; phone: string | null } | null
  busy: boolean
  actionError: QboCustomerMappingApiError | null
  onCreate: () => void
  onBack: () => void
}) {
  const f = props.fields
  const set = (k: string, v: string) => props.setFields({ ...props.fields, [k]: v })
  const isDuplicate = props.actionError?.category === 'duplicate_name'
  const isSplit = props.actionError?.category === 'split_failure'
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={props.onBack}
        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200"
      >
        <ArrowLeft size={11} /> Back to search
      </button>
      <p className="text-xs text-gray-400">
        Create a new QuickBooks customer. Fields are prefilled from the PowerOn relationship account where available — edit anything before creating.
      </p>
      <Field label="Display Name" required>
        <input type="text" value={f.displayName} onChange={(e) => set('displayName', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" />
      </Field>
      <Field label="Company Name">
        <input type="text" value={f.companyName} onChange={(e) => set('companyName', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Email">
          <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" />
        </Field>
        <Field label="Phone">
          <input type="text" value={f.phone} onChange={(e) => set('phone', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" />
        </Field>
      </div>
      <Field label="Billing Address Line 1">
        <input type="text" value={f.line1} onChange={(e) => set('line1', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="City"><input type="text" value={f.city} onChange={(e) => set('city', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" /></Field>
        <Field label="State"><input type="text" value={f.state} onChange={(e) => set('state', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Postal Code"><input type="text" value={f.postalCode} onChange={(e) => set('postalCode', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" /></Field>
        <Field label="Country"><input type="text" value={f.country} onChange={(e) => set('country', e.target.value)} className="w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100" /></Field>
      </div>

      {isDuplicate && (
        <div className="rounded border border-amber-500/40 bg-amber-950/25 p-2 text-[11px] text-amber-200">
          QuickBooks already has a customer, vendor, or employee using this name.
          <div className="mt-1.5 flex gap-2">
            <button type="button" onClick={props.onBack} className="flex items-center gap-1 rounded bg-amber-600/30 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-600/50"><Users size={10} /> Search Existing Customers</button>
            <span className="self-center text-[10px] text-amber-200/70">or edit the Display Name and try again.</span>
          </div>
        </div>
      )}
      {isSplit && (
        <div className="rounded border border-amber-500/40 bg-amber-950/25 p-2 text-[11px] text-amber-200">
          The QuickBooks customer may already have been created, but the mapping could not be saved. Use Search Existing Customers to find and link it instead of creating again.
          <div className="mt-1.5">
            <button type="button" onClick={props.onBack} className="flex items-center gap-1 rounded bg-amber-600/30 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-600/50"><Users size={10} /> Search Existing Customers</button>
          </div>
        </div>
      )}
      {props.actionError && !isDuplicate && !isSplit && <ActionErrorBlock err={props.actionError} />}

      <div className="flex items-center justify-end gap-2 border-t border-gray-700 pt-3">
        <button type="button" onClick={props.onBack} className="rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800">Cancel</button>
        <button type="button" onClick={props.onCreate} disabled={!f.displayName.trim() || props.busy} className="rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white enabled:hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40">
          {props.busy ? 'Creating…' : 'Create customer'}
        </button>
      </div>
    </div>
  )
}

function LinkedBody(props: {
  customer: { id: string; displayName: string | null; active: boolean }
  linkOrigin: 'linked' | 'created'
  busy: boolean
  actionError: QboCustomerMappingApiError | null
  unlinkConfirm: boolean
  changeConfirm: boolean
  remappingGuard?: { canChange: boolean; reason?: string }
  onUnlinkClick: () => void
  onChangeClick: () => void
  onConfirmUnlink: () => void
  onCancelUnlink: () => void
  onConfirmChange: () => void
  onCancelChange: () => void
}) {
  const guard = props.remappingGuard ?? { canChange: true }
  return (
    <div className="space-y-3">
      <div className="rounded border border-emerald-600/40 bg-emerald-500/10 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="font-semibold text-emerald-200">✓ Linked</span>
        </div>
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex justify-between gap-3"><dt className="text-gray-500">PowerOn</dt><dd className="text-right text-gray-200">→ QuickBooks</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-gray-500">QuickBooks</dt><dd className="text-right text-gray-200">{props.customer.displayName || '—'}</dd></div>
        </dl>
        {props.linkOrigin === 'created' && <p className="mt-1 text-[10px] text-emerald-200/70">Created in QuickBooks</p>}
        {!props.customer.active && <p className="mt-1 text-[10px] text-amber-300/80">This QuickBooks customer is inactive.</p>}
      </div>

      {props.actionError && <ActionErrorBlock err={props.actionError} />}

      {props.unlinkConfirm ? (
        <ConfirmBlock
          title="Unlink QuickBooks customer?"
          body="Unlinking will not delete the customer from QuickBooks. Future QuickBooks actions for this PowerOn customer will require a new link."
          confirmLabel="Unlink"
          busy={props.busy}
          onConfirm={props.onConfirmUnlink}
          onCancel={props.onCancelUnlink}
        />
      ) : props.changeConfirm ? (
        <ConfirmBlock
          title="Change QuickBooks customer mapping?"
          body="The current link will be removed (history retained), then you can search for or create a replacement QuickBooks customer."
          confirmLabel="Change mapping"
          busy={props.busy}
          onConfirm={props.onConfirmChange}
          onCancel={props.onCancelChange}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={props.onUnlinkClick}
            disabled={props.busy}
            className="flex items-center gap-1 rounded border border-red-800/60 bg-red-900/20 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-900/40 disabled:opacity-50"
          >
            <Unlink size={12} /> Unlink
          </button>
          <button
            type="button"
            onClick={props.onChangeClick}
            disabled={props.busy || !guard.canChange}
            title={!guard.canChange ? guard.reason : undefined}
            className="rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Change Mapping
          </button>
        </div>
      )}
    </div>
  )
}

function ConfirmBlock(props: { title: string; body: string; confirmLabel: string; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-3 rounded border border-gray-700 bg-gray-800/30 p-3">
      <div>
        <div className="text-sm font-semibold text-gray-100">{props.title}</div>
        <p className="mt-1.5 text-xs leading-5 text-gray-400">{props.body}</p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={props.onCancel} disabled={props.busy} className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-500 hover:text-white disabled:opacity-50">Cancel</button>
        <button type="button" onClick={props.onConfirm} disabled={props.busy} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50">{props.busy ? 'Working…' : props.confirmLabel}</button>
      </div>
    </div>
  )
}

function ActionErrorBlock({ err, onSearchExisting }: { err: QboCustomerMappingApiError; onSearchExisting?: () => void }) {
  return (
    <div className="rounded border border-red-800/60 bg-red-900/20 px-3 py-2 text-[11px] text-red-300">
      {err.message}
      {onSearchExisting && (
        <button type="button" onClick={onSearchExisting} className="mt-1 block text-[10px] text-red-200 underline">Search Existing Customers</button>
      )}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}{required ? ' *' : ''}</span>
      {children}
    </label>
  )
}

function emptyCreateFields(prefill: { displayName: string; companyName: string | null; email: string | null; phone: string | null } | null) {
  return {
    displayName: prefill?.displayName ?? '',
    companyName: prefill?.companyName ?? '',
    email: prefill?.email ?? '',
    phone: prefill?.phone ?? '',
    line1: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  }
}