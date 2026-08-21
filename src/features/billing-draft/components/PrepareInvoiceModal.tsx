/**
 * src/features/billing-draft/components/PrepareInvoiceModal.tsx
 *
 * QBO-2E — Prepare Invoice owner-workflow UI (LUMP-SUM FIRST + AI WORDING).
 *
 * RUNTIME-DRIVEN UX SIMPLIFICATION (correction to QBO-2D). QBO-2D fixed the
 * data source and layout but the workflow still created more friction than it
 * removed. This modal simplifies to the REAL owner workflow:
 *
 *   Project Logs / Service Log
 *     → select relevant work (context only, NOT one charge per log)
 *     → AI helps clean customer-facing wording (WORDING ONLY — never an amount)
 *     → owner chooses ONE invoice amount
 *     → owner reviews → APPROVE → clear "DRAFT READY" confirmation
 *     → later send through QuickBooks (NOT in this phase)
 *
 * DEFAULT = ONE LUMP-SUM INVOICE LINE (QBO-2E §2):
 *   - Project: Product/Service = "Electrical Project - Progress Billing"
 *   - Service: Product/Service = "Electrical Work - Service Work"
 *   - Selected Project Logs supply DESCRIPTION context, never separate lines.
 *
 * ONE PRIMARY AMOUNT (§3): "Invoice Amount" is owner-entered for projects; for
 * service the structured Total Billable is a SUGGESTION with an explicit
 * "USE $X" button the owner may override. Itemization is OPTIONAL (§4): a
 * de-emphasized "+ Add Separate Charge" control, not a primary button. An
 * untouched blank extra line is INACTIVE and never blocks approval (§5) —
 * handled by activeLines() in billingDraftModalState.
 *
 * AI WORDING (§8–§13): a "POLISH WITH AI" button on the description reuses the
 * EXISTING server-side Claude proxy (invoiceWordingAi.ts → claudeProxy.ts). The
 * AI receives ONLY selected work-description context and may rewrite the
 * description text. It can NEVER alter the amount, the Product/Service, the
 * customer, payment/KPI state, or add a financial line. After polish: USE THIS
 * WORDING / REGENERATE / RESTORE ORIGINAL. The owner can always edit manually.
 *
 * APPROVAL (§16): a valid approve shows a visible "INVOICE DRAFT READY" state
 * stating nothing has been sent to QuickBooks, with Edit Draft / Close. No fake
 * QBO invoice id, no persistence.
 *
 * ARCHITECTURE: React components must NOT recalculate canonical billing truth.
 * This modal holds only owner SELECTION + TEXT + local AI/confirmation state.
 * All financial truth (invoice total, payment balance, review flags) comes from
 * prepareBillingDraft() in billingDraftModel.ts. There is no second set of
 * billing formulas in JSX. No QBO API call, no persistence, no migration.
 */
import { AlertTriangle, FileText, Loader2, Plus, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { fmt, getBackupData } from '@/services/backupDataService'
import type { BackupData, BackupProject, BackupServiceLog } from '@/services/backupDataService'
import type { ServiceCallRecord } from '@/services/serviceCallService'

import {
  buildSaveInputFromDraft,
  mapHydratedToUiLines,
} from '@/features/invoice-drafts/invoiceDraftMapping'
import { rehydrateSource } from '@/features/invoice-drafts/rehydrateSource'
import type {
  HydratedDraft,
  InvoiceDraftSaveInput,
  InvoiceDraftSaveResult,
  InvoiceSourceKind,
} from '@/features/invoice-drafts/invoiceDraftTypes'

import {
  PROJECT_DEFAULT_TITLE,
  SERVICE_DEFAULT_TITLE,
  buildSelection,
  composeWorkDescription,
  parseAmount,
  reviewWarnings,
  type BillingRead,
  type PrepareInvoiceUiState,
} from '../billingDraftModalState'
import { makeBillingLine, prepareBillingDraft } from '../billingDraftModel'
import { polishInvoiceDescription, type WordingWorkFact } from '../invoiceWordingAi'
import { readProjectBilling } from '../projectBillingAdapter'
import { readServiceBilling, readServiceCallBilling } from '../serviceBillingAdapter'
import type { BillingCandidate, BillingLine, PreparedBillingDraft } from '../billingDraftTypes'

// QBO-4A.4 Task 10 — non-gating QuickBooks Customer mapping status. This is a
// presentational, network-owning component from the quickbooks-customer-mapping
// feature (outside billing-draft). It is INFORMATIONAL ONLY: the presence or
// absence of a mapping never blocks Prepare Invoice / Save Draft / Approve. The
// network call lives in that feature's hook, NOT in this file (QBO-LOG-22
// firewall: this modal source makes no network call and names no provider).
import { QuickBooksCustomerStatus } from '@/features/quickbooks-customer-mapping/components/QuickBooksCustomerStatus'
import { useCanonicalCustomerDirectory } from '@/features/quickbooks-customer-mapping/useCanonicalCustomerDirectory'
import type { CustomerDirectoryEntry } from '@/features/quickbooks-customer-mapping/qboCustomerMappingTypes'

/** What the modal is preparing an invoice from. */
export type PrepareInvoiceSource =
  | { kind: 'project'; project: BackupProject; backup: BackupData }
  | { kind: 'service'; serviceLog: BackupServiceLog }
  | { kind: 'serviceCall'; call: ServiceCallRecord }

export interface PrepareInvoiceModalProps {
  open: boolean
  /** New-draft target. Ignored when `initialDraft` is set (rehydrate mode). */
  source: PrepareInvoiceSource | null
  /** Reopen a persisted draft in EDIT mode. When set, the modal rehydrates from it. */
  initialDraft?: HydratedDraft | null
  onClose: () => void
  /**
   * Persist the current draft (create or update by persisted id). Returns the
   * saved {id,status} so the modal can track continuing identity, or null on
   * failure. When omitted, Save Draft keeps the draft in memory only.
   */
  onSaveDraft?: (input: InvoiceDraftSaveInput) => Promise<InvoiceDraftSaveResult | null>
  /**
   * Persist + approve the current draft (persist-first if new, then approved).
   * Returns {id,status,approvedAt} or null on failure. When omitted, approval is
   * in-memory only (QBO-2E behavior).
   */
  onApprove?: (input: InvoiceDraftSaveInput) => Promise<InvoiceDraftSaveResult | null>
  /**
   * Optional: open the EXISTING canonical payment-record workflow so the owner
   * can correct payment truth at its source (no local override). Provided for
   * projects (opens the Project Logs workflow). When omitted, hidden.
   */
  onReviewPayments?: () => void
  /**
   * QBO-4A.5 — persist a reconciled relationship_accounts UUID onto the CURRENT
   * source's canonical accountId field (the host owns the exact persistence path).
   * Lets the owner resolve a name-only/legacy customer identity WITHOUT leaving
   * Prepare Invoice. NON-GATING: Save Draft / Approve remain usable while the
   * identity is unresolved; this only makes the QBO mapping workflow reachable.
   */
  onResolveCustomer?: (accountUuid: string) => void
}

/** Per-line AI wording assistant state (local UI only — never financial truth). */
interface LineAiState {
  readonly status: 'idle' | 'loading' | 'ready'
  readonly original: string
  readonly generated: string | null
  readonly error: string | null
}
type AiStateMap = Record<string, LineAiState>

function readSource(source: PrepareInvoiceSource, canonicalIds: ReadonlySet<string>): BillingRead {
  if (source.kind === 'project') return readProjectBilling({ project: source.project, backup: source.backup, canonicalIds })
  if (source.kind === 'service') return readServiceBilling({ serviceLog: source.serviceLog, canonicalIds })
  return readServiceCallBilling({ call: source.call, canonicalIds })
}

const EMPTY_UI: PrepareInvoiceUiState = {
  selectedCandidateIds: [],
  lines: [],
  descriptionDirty: {},
}

export function PrepareInvoiceModal({ open, source, initialDraft, onClose, onApprove, onSaveDraft, onReviewPayments, onResolveCustomer }: PrepareInvoiceModalProps) {
  const [ui, setUi] = useState<PrepareInvoiceUiState>(EMPTY_UI)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const [ai, setAi] = useState<AiStateMap>({})
  const [itemizeOpen, setItemizeOpen] = useState(false)
  const [approved, setApproved] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [status, setStatus] = useState<'draft' | 'approved'>('draft')
  const [sourceLive, setSourceLive] = useState(true)
  const [saving, setSaving] = useState(false)
  // QBO-4A.5 — owner-resolved PowerOn customer UUID for the CURRENT source. Set
  // only by an explicit Confirm Customer action inside the Resolve modal; reset
  // whenever the source changes so a stale resolution never leaks across sources.
  // NON-GATING: read/save/approve never wait on this value.
  const [resolvedCustomerId, setResolvedCustomerId] = useState<string | null>(null)
  const lineSeq = useRef(1)
  // QBO-4A.6 — the authoritative canonical PowerOn customer id set for the org
  // (relationship_accounts.id values, a TEXT PK). Threaded into the pure billing
  // adapters so read.customerId is a CANONICAL id (never validated by UUID format).
  // Module-cached: one shared fetch across every surface that mounts the hook.
  const canonicalDirectory = useCanonicalCustomerDirectory()
  const canonicalIds = canonicalDirectory.canonicalIds

  // Rehydrate mode: resolve the Prepare Invoice source from a persisted draft
  // (live source when available, otherwise a synthetic fallback so the saved
  // invoice content can still be rendered and edited). Pure read; no mutation.
  const rehydrated = useMemo(() => (initialDraft ? rehydrateSource(initialDraft) : null), [initialDraft])

  // Effective source: rehydrated (reopen) takes precedence over the new-draft source.
  const activeSource: PrepareInvoiceSource | null = rehydrated?.source ?? source

  // The exact source discriminator used for persistence. The modal's source union
  // uses 'service' for service logs; persistence stores 'serviceLog' (InvoiceSourceKind).
  const activeKind = activeSource?.kind
  const persistSourceKind: InvoiceSourceKind = initialDraft
    ? initialDraft.sourceKind
    : activeKind === 'project'
      ? 'project'
      : activeKind === 'serviceCall'
        ? 'serviceCall'
        : 'serviceLog'

  // Reset UI when the source changes (opening a different project/service) or
  // when rehydrating a persisted draft into EDIT mode.
  useEffect(() => {
    if (!open) return
    setSavedNote(null)
    setAi({})
    setItemizeOpen(false)
    setApproved(false)
    setResolvedCustomerId(null)
    if (initialDraft) {
      // Rehydrate: seed UI from the persisted record; keep saved wording (dirty).
      setDraftId(initialDraft.id)
      setStatus(initialDraft.status)
      setSourceLive(rehydrated?.live ?? false)
      const seeded = mapHydratedToUiLines(initialDraft)
      setUi({
        selectedCandidateIds: seeded.selectedCandidateIds,
        lines: seeded.lines,
        descriptionDirty: seeded.descriptionDirty,
      })
      return
    }
    if (!activeSource) return
    // New draft: one lump-sum line; service seeds description from the Service Log.
    setDraftId(null)
    setStatus('draft')
    setSourceLive(true)
    const id = `line-${lineSeq.current++}`
    const defaultTitle = activeSource.kind === 'project' ? PROJECT_DEFAULT_TITLE : SERVICE_DEFAULT_TITLE
    const seededDesc = activeSource.kind === 'project' ? '' : (readSource(activeSource, canonicalIds).workDescription ?? '')
    setUi({
      selectedCandidateIds: [],
      lines: [makeBillingLine({ id, title: defaultTitle, description: seededDesc, amount: 0 })],
      descriptionDirty: {},
    })
  }, [open, activeSource, initialDraft, rehydrated])

  // Read structured PowerOn truth once per source (pure adapters — no mutation).
  const read = useMemo<BillingRead | null>(() => {
    if (!open || !activeSource) return null
    return readSource(activeSource, canonicalIds)
  }, [open, activeSource, canonicalIds])

  // QBO-4A.4 Task 6/10 — the in-memory customer directory (backup.gcContacts, the
  // projection of relationship_accounts) is the Create-form prefill source. It is
  // resolved by the reconciled customer UUID (read.customerId) — NEVER by name.
  // Snapshotted once while the modal is open (no re-fetch; pure local read).
  const customerDirectory = useMemo<readonly CustomerDirectoryEntry[]>(() => {
    if (!open) return []
    const backup = getBackupData()
    const gc = backup?.gcContacts ?? []
    return gc.map((c) => ({
      id: c.id,
      company: c.company || null,
      contact: c.contact || null,
      email: c.email || null,
      phone: c.phone || null,
    }))
  }, [open])

  // Assemble the model selection from UI state (active lines only; no financial math here).
  const draft = useMemo<PreparedBillingDraft | null>(() => {
    if (!read) return null
    return prepareBillingDraft(buildSelection(read, ui))
  }, [read, ui])

  if (!open || !activeSource || !read || !draft) return null

  // Capture the narrowed read for nested handlers (control-flow narrowing does
  // not cross function boundaries in TS).
  const rd: BillingRead = read
  const isService = rd.sourceKind === 'service'
  const defaultTitle = isService ? SERVICE_DEFAULT_TITLE : PROJECT_DEFAULT_TITLE
  const candidatesById = new Map<string, BillingCandidate>()
  for (const c of rd.candidates) candidatesById.set(c.id, c)

  const serviceTotal = rd.candidates.find((c) => c.representationMode === 'total') ?? null
  const suggestedAmount = serviceTotal?.structuredAmount ?? null

  // ── Selection / line handlers (UI state only). ───────────────────────────────
  function setLineAmount(lineId: string, text: string): void {
    setUi((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.id === lineId ? { ...l, amount: parseAmount(text) } : l)),
    }))
  }
  function setLineTitle(lineId: string, text: string): void {
    setUi((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.id === lineId ? { ...l, title: text } : l)),
    }))
  }
  function setLineDescription(lineId: string, text: string): void {
    setUi((prev) => ({
      ...prev,
      lines: prev.lines.map((l) => (l.id === lineId ? { ...l, description: text } : l)),
      descriptionDirty: { ...prev.descriptionDirty, [lineId]: true },
    }))
  }

  function addSeparateCharge(): void {
    setItemizeOpen(true)
    const id = `line-${lineSeq.current++}`
    setUi((prev) => ({ ...prev, lines: [...prev.lines, makeBillingLine({ id, title: defaultTitle, description: '', amount: 0 })] }))
  }
  function removeLine(lineId: string): void {
    setUi((prev) => {
      // Never remove the primary (lump-sum) line — only optional extra lines.
      if (prev.lines.length <= 1) return prev
      return { ...prev, lines: prev.lines.filter((l) => l.id !== lineId) }
    })
  }

  function toggleProjectLog(candidateId: string): void {
    const candidates = rd.candidates
    setUi((prev) => {
      const selected = new Set(prev.selectedCandidateIds)
      if (selected.has(candidateId)) selected.delete(candidateId)
      else selected.add(candidateId)
      const selectedIds = [...selected]
      // Reseed the PRIMARY line's description + provenance unless the owner edited it.
      // Title is never derived from logs (QBO-2E §6).
      const lines = prev.lines.map((l, idx) => {
        if (idx !== 0) return l
        const dirty = prev.descriptionDirty[l.id]
        const seeded = dirty
          ? l.description
          : composeWorkDescription({ candidates, selectedIds, sourceKind: 'project' })
        return { ...l, description: seeded, candidateIds: selectedIds }
      })
      return { ...prev, selectedCandidateIds: selectedIds, lines }
    })
  }

  function useServiceSuggestion(): void {
    if (!serviceTotal || suggestedAmount == null) return
    setUi((prev) => {
      const selected = new Set(prev.selectedCandidateIds)
      selected.add(serviceTotal.id)
      const lines = prev.lines.map((l, idx) =>
        idx === 0
          ? { ...l, amount: suggestedAmount, candidateIds: [serviceTotal.id] }
          : l,
      )
      return { ...prev, selectedCandidateIds: [...selected], lines }
    })
  }

  // ── AI wording (WORDING ONLY — never amount / line / mutation). ───────────────
  function buildWorkFacts(): WordingWorkFact[] {
    if (isService) {
      const wd = rd.workDescription
      return wd && wd.trim() ? [{ label: 'Service Log', description: wd, date: null }] : []
    }
    const selected = new Set(ui.selectedCandidateIds)
    return rd.candidates
      .filter((c) => selected.has(c.id))
      .map((c) => ({ label: c.label, description: c.description, date: c.date }))
  }

  async function runPolish(lineId: string, baseDescription: string): Promise<void> {
    const line = ui.lines.find((l) => l.id === lineId)
    if (!line) return
    setAi((prev) => ({ ...prev, [lineId]: { status: 'loading', original: baseDescription, generated: null, error: null } }))
    try {
      const { wording } = await polishInvoiceDescription({
        sourceKind: rd.sourceKind,
        productOrService: line.title,
        currentDescription: baseDescription,
        workFacts: buildWorkFacts(),
      })
      if (!wording) {
        setAi((prev) => ({ ...prev, [lineId]: { status: 'idle', original: baseDescription, generated: null, error: 'AI returned no wording. Try again or edit manually.' } }))
        return
      }
      // Apply the generated wording to the description so the owner sees it.
      setLineDescription(lineId, wording)
      setAi((prev) => ({ ...prev, [lineId]: { status: 'ready', original: baseDescription, generated: wording, error: null } }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI service unavailable.'
      setAi((prev) => ({ ...prev, [lineId]: { status: 'idle', original: baseDescription, generated: null, error: message } }))
    }
  }

  function polishWithAi(lineId: string): void {
    const line = ui.lines.find((l) => l.id === lineId)
    if (!line) return
    void runPolish(lineId, line.description)
  }
  function regenerateAi(lineId: string): void {
    const st = ai[lineId]
    const original = st?.original ?? ui.lines.find((l) => l.id === lineId)?.description ?? ''
    void runPolish(lineId, original)
  }
  function useThisWording(lineId: string): void {
    // Keep the current (generated) description; clear the AI assistant state.
    setAi((prev) => {
      const next = { ...prev }
      delete next[lineId]
      return next
    })
  }
  function restoreOriginal(lineId: string): void {
    const st = ai[lineId]
    if (st?.original != null) setLineDescription(lineId, st.original)
    setAi((prev) => {
      const next = { ...prev }
      delete next[lineId]
      return next
    })
  }

  // ── Final owner actions ─────────────────────────────────────────────────────
  // Save Draft persists (create or update by persisted id); repeated Save
  // updates the same record rather than duplicating. When no persistence
  // callback is wired, the draft is kept in memory only (QBO-2E behavior).
  function buildSaveInput(): InvoiceDraftSaveInput | null {
    if (!draft || !read) return null
    const synthetic = initialDraft && !sourceLive
    const preserveSnapshot = synthetic ? initialDraft.sourceSnapshot : undefined
    // QBO-4A.2 Task 7: on a synthetic (source no longer live) reopen, preserve the
    // ORIGINAL persisted customer_id — the empty synthetic read would otherwise
    // null it. On the live path the id refreshes from the fresh source read.
    const preserveCustomerId = synthetic ? initialDraft.customerId : undefined
    // QBO-4A.5: thread an owner-resolved PowerOn customer UUID into the saved
    // draft when the source read had none (name-only/legacy). A synthetic reopen
    // keeps its original id; otherwise a live in-modal resolution wins; otherwise
    // the override is absent and the fresh read's id is used as before.
    const resolvedOverride = resolvedCustomerId ?? undefined
    return buildSaveInputFromDraft({
      draft,
      read,
      sourceKind: persistSourceKind,
      id: draftId ?? undefined,
      snapshotOverride: preserveSnapshot,
      customerIdOverride: preserveCustomerId ?? resolvedOverride,
    })
  }
  async function handleSaveDraft(): Promise<void> {
    if (!draft) return
    const input = buildSaveInput()
    if (!input) return
    if (!onSaveDraft) {
      setSavedNote('Draft kept locally (not persisted).')
      return
    }
    setSaving(true)
    try {
      const res = await onSaveDraft(input)
      if (res) {
        setDraftId(res.id)
        setStatus(res.status)
        setSavedNote('Draft saved.')
      } else {
        setSavedNote('Could not save draft. Try again.')
      }
    } finally {
      setSaving(false)
    }
  }
  async function handleApprove(): Promise<void> {
    if (!draft || !draft.ready) return
    const input = buildSaveInput()
    if (!input) return
    if (!onApprove) {
      setApproved(true)
      return
    }
    setSaving(true)
    try {
      const res = await onApprove(input)
      if (res) {
        setDraftId(res.id)
        setStatus(res.status)
        setApproved(true)
      } else {
        setSavedNote('Could not approve draft. Try again.')
      }
    } finally {
      setSaving(false)
    }
  }
  function handleEditDraft(): void {
    setApproved(false)
  }

  const warnings = reviewWarnings(draft)
  const blockingWarnings = warnings.filter((w) => w.severity === 'invalid')
  const selectedCount = ui.selectedCandidateIds.length

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Prepare Invoice"
      className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] text-gray-100 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-700 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-100">PREPARE INVOICE</h2>
            <p className="mt-0.5 truncate text-xs text-gray-400">
              {read.customerReference ?? '—'} • {isService ? 'Service Call' : 'Project'}
            </p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              Prepare an invoice draft for owner review. Nothing has been sent to QuickBooks. After QuickBooks is connected, approved drafts feed invoice creation.
            </p>
            {initialDraft && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                    status === 'approved' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {status === 'approved' ? 'APPROVED' : 'DRAFT'}
                </span>
                {!sourceLive && (
                  <span className="text-[10px] text-amber-300/80">
                    Source no longer in current data — saved details preserved.
                  </span>
                )}
              </div>
            )}
            {/* QBO-4A.4 Task 10 — NON-GATING QuickBooks Customer mapping status.
                Informational only: linking is never required to prepare/save/approve.
                The host does NOT condition any footer action on this state.
                QBO-4A.5 — when the source customer is an unresolved name snapshot,
                `onResolveCustomer` makes the inline status actionable (STATE 1) so
                the owner can bind an existing PowerOn account without leaving the
                modal. The resolved UUID is applied locally first (immediate state
                transition) AND forwarded to the host for canonical persistence. */}
            <div className="mt-1.5">
              <QuickBooksCustomerStatus
                poweronCustomerId={resolvedCustomerId ?? read.customerId ?? null}
                customerName={read.customerReference ?? null}
                customerDirectory={customerDirectory}
                resolveDirectory={canonicalDirectory.directory.length ? canonicalDirectory.directory : customerDirectory}
                canonicalIds={canonicalIds}
                resolveLoading={canonicalDirectory.loading}
                onResolveCustomer={onResolveCustomer ? (uuid) => {
                  setResolvedCustomerId(uuid)
                  onResolveCustomer(uuid)
                } : undefined}
              />
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Prepare Invoice"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {approved && draft ? (
          <DraftReadyConfirmation draft={draft} onEditDraft={handleEditDraft} onClose={onClose} />
        ) : (
          <>
            {/* Body: two-pane on desktop, stacked on narrow (no horizontal overflow). */}
            <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(300px,420px)_minmax(0,1fr)]">
              {/* LEFT: 1 WORK + 2 INVOICE */}
              <div className="min-h-0 overflow-y-auto border-b border-gray-700 p-4 md:border-b-0 md:border-r">
                {/* 1 — WORK */}
                <StepHeader n={1} title="WORK" />
                {isService ? (
                  <ServiceWorkPanel
                    read={read}
                    suggestedAmount={suggestedAmount}
                    onUseSuggestion={useServiceSuggestion}
                  />
                ) : (
                  <WorkToBillSelector
                    read={read}
                    selectedIds={ui.selectedCandidateIds}
                    onToggle={toggleProjectLog}
                    selectedCount={selectedCount}
                  />
                )}

                {/* 2 — INVOICE */}
                <StepHeader n={2} title="INVOICE" />
                <BillingLineEditor
                  lines={ui.lines}
                  draft={draft}
                  ai={ai}
                  isService={isService}
                  onSetAmount={setLineAmount}
                  onSetTitle={setLineTitle}
                  onSetDescription={setLineDescription}
                  onPolish={polishWithAi}
                  onRegenerate={regenerateAi}
                  onUseWording={useThisWording}
                  onRestoreOriginal={restoreOriginal}
                  onAddSeparateCharge={addSeparateCharge}
                  onRemove={removeLine}
                  itemizeOpen={itemizeOpen}
                />
                {!isService && onReviewPayments && (
                  <button
                    onClick={onReviewPayments}
                    className="mt-2 w-full rounded border border-gray-700 px-3 py-1.5 text-[11px] text-gray-400 hover:bg-gray-800"
                  >
                    Review / Correct Payments
                  </button>
                )}
              </div>

              {/* RIGHT: 3 PREVIEW */}
              <div className="min-h-0 overflow-y-auto p-4">
                <StepHeader n={3} title="PREVIEW" />
                <InvoicePreview draft={draft} warnings={warnings} />
                <CompactPaymentContext read={read} draft={draft} />
                <p className="mt-2 text-[10px] text-gray-500">
                  Nothing has been sent to QuickBooks.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-700 px-4 py-3">
              <div className="text-xs text-gray-400">
                {savedNote ?? 'Preview updates live — nothing is saved or sent yet.'}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={onClose}
                  className="rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-300 hover:bg-gray-800"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800 disabled:opacity-40"
                >
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={!draft.ready || saving}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white enabled:hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? 'Approving…' : 'APPROVE INVOICE DRAFT'}
                </button>
              </div>
              {blockingWarnings.length > 0 && (
                <p className="w-full text-[10px] text-amber-300/80">
                  Resolve the blocking issue{blockingWarnings.length > 1 ? 's' : ''} above before approving.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── Sub-components (inline, same file — matches repo dialog convention) ───────

function StepHeader(props: { n: number; title: string }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2 first:mt-0">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">{props.n}</span>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-200">{props.title}</h3>
    </div>
  )
}

function WorkToBillSelector(props: {
  read: BillingRead
  selectedIds: readonly string[]
  onToggle: (id: string) => void
  selectedCount: number
}) {
  const { read, selectedIds } = props
  const selected = new Set(selectedIds)
  const countHeader = selectedIds.length > 0 ? `${selectedIds.length} WORK LOG${selectedIds.length === 1 ? '' : 'S'} SELECTED` : 'NO WORK SELECTED YET'
  return (
    <section className="mb-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">{countHeader}</span>
      </div>
      {read.candidates.length === 0 ? (
        <p className="rounded border border-dashed border-gray-700 p-3 text-center text-xs text-gray-500">
          No project logs on record. You can still enter a manual invoice amount below.
        </p>
      ) : (
        <ul className="space-y-2">
          {read.candidates.map((c) => {
            const checked = selected.has(c.id)
            return (
              <li
                key={c.id}
                className={`rounded border p-2 transition-colors ${
                  checked
                    ? 'border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/40'
                    : 'border-gray-700 bg-gray-800/30'
                }`}
              >
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="checkbox" checked={checked} onChange={() => props.onToggle(c.id)} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="block text-xs font-semibold text-gray-100">{c.label}</span>
                      {checked && (
                        <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-300">SELECTED</span>
                      )}
                    </span>
                    {c.description && <span className="mt-0.5 block text-[10px] text-gray-400">{c.description}</span>}
                    {c.date && <span className="mt-0.5 block text-[10px] text-gray-500">{c.date}</span>}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] text-gray-500">
        These are the work records behind this invoice. They describe what is being billed — you decide the single invoice amount under INVOICE.
      </p>
    </section>
  )
}

function ServiceWorkPanel(props: {
  read: BillingRead
  suggestedAmount: number | null
  onUseSuggestion: () => void
}) {
  const { read, suggestedAmount } = props
  return (
    <section className="mb-2">
      {read.workDescription ? (
        <div className="mb-2 rounded border border-gray-700 bg-gray-800/30 p-2">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Current Service Log</span>
          <p className="mt-1 whitespace-pre-wrap text-[11px] text-gray-200">{read.workDescription}</p>
        </div>
      ) : (
        <p className="mb-2 rounded border border-dashed border-gray-700 p-2 text-[10px] text-gray-500">
          No service log notes on record. You can still enter a manual invoice amount below.
        </p>
      )}
      {suggestedAmount != null ? (
        <div className="rounded border border-emerald-600/40 bg-emerald-500/10 p-2">
          <span className="block text-[11px] text-emerald-200">Suggested amount: {fmt(suggestedAmount)}</span>
          <button
            onClick={props.onUseSuggestion}
            className="mt-1.5 rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500"
          >
            USE {fmt(suggestedAmount)}
          </button>
          <p className="mt-1 text-[10px] text-emerald-200/70">
            Suggestion only — you may type a different Invoice Amount.
          </p>
        </div>
      ) : null}
    </section>
  )
}

function BillingLineEditor(props: {
  lines: readonly BillingLine[]
  draft: PreparedBillingDraft
  ai: AiStateMap
  isService: boolean
  onSetAmount: (id: string, text: string) => void
  onSetTitle: (id: string, text: string) => void
  onSetDescription: (id: string, text: string) => void
  onPolish: (id: string) => void
  onRegenerate: (id: string) => void
  onUseWording: (id: string) => void
  onRestoreOriginal: (id: string) => void
  onAddSeparateCharge: () => void
  onRemove: (id: string) => void
  itemizeOpen: boolean
}) {
  const { lines, draft } = props
  // Per-line incomplete helpers (subtle) keyed by lineId from the model flags.
  const incompleteByLine = new Map<string, string>()
  for (const f of draft.reviewRequired) {
    if (f.severity === 'incomplete' && f.lineId) incompleteByLine.set(f.lineId, f.detail)
  }
  return (
    <section className="mb-2">
      <ul className="space-y-3">
        {lines.map((line, idx) => {
          const incomplete = incompleteByLine.get(line.id)
          const st = props.ai[line.id]
          const isPrimary = idx === 0
          return (
            <li key={line.id} className={`rounded border p-2 ${isPrimary ? 'border-blue-600/40 bg-blue-600/5' : 'border-gray-700 bg-gray-800/30'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {isPrimary ? 'Product / Service' : 'Separate Charge'}
                </span>
                {!isPrimary && (
                  <button onClick={() => props.onRemove(line.id)} className="text-gray-500 hover:text-gray-200" aria-label="Remove separate charge">
                    <X size={12} />
                  </button>
                )}
              </div>
              <input
                type="text"
                aria-label={`Product or Service for ${line.id}`}
                value={line.title}
                onChange={(e) => props.onSetTitle(line.id, e.target.value)}
                className="mt-0.5 w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100"
              />
              <label className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">Description</label>
              <textarea
                aria-label={`Description for ${line.id}`}
                placeholder="Customer-facing description of the work billed"
                value={line.description}
                onChange={(e) => props.onSetDescription(line.id, e.target.value)}
                rows={3}
                className="mt-0.5 w-full resize-y rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100"
              />
              <AiWordingControls
                lineId={line.id}
                state={st}
                onPolish={props.onPolish}
                onRegenerate={props.onRegenerate}
                onUseWording={props.onUseWording}
                onRestoreOriginal={props.onRestoreOriginal}
              />
              <label className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                {isPrimary ? 'Invoice Amount' : 'Amount'}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                aria-label={`Invoice amount for ${line.id}`}
                value={line.amount === 0 ? '' : String(line.amount)}
                onChange={(e) => props.onSetAmount(line.id, e.target.value)}
                className="mt-0.5 w-full rounded border border-gray-600 bg-gray-900 px-2 py-1 text-xs text-gray-100"
              />
              {incomplete && (
                <p className="mt-1 text-[10px] text-gray-400">{incomplete}</p>
              )}
            </li>
          )
        })}
      </ul>
      {/* OPTIONAL itemization — de-emphasized, owner-explicit (QBO-2E §4). */}
      <button
        onClick={props.onAddSeparateCharge}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded border border-dashed border-gray-700 px-2 py-1.5 text-[11px] text-gray-400 hover:bg-gray-800 hover:text-gray-200"
      >
        <Plus size={12} /> {props.itemizeOpen ? 'Add Another Separate Charge' : 'Add Separate Charge (optional)'}
      </button>
    </section>
  )
}

function AiWordingControls(props: {
  lineId: string
  state: LineAiState | undefined
  onPolish: (id: string) => void
  onRegenerate: (id: string) => void
  onUseWording: (id: string) => void
  onRestoreOriginal: (id: string) => void
}) {
  const { state, lineId } = props
  if (!state || state.status === 'idle') {
    const err = state?.error
    return (
      <div className="mt-1.5">
        <button
          onClick={() => props.onPolish(lineId)}
          className="flex items-center gap-1 rounded border border-violet-500/40 bg-violet-600/15 px-2 py-1 text-[10px] font-semibold text-violet-300 hover:bg-violet-600/25"
        >
          <Sparkles size={11} /> POLISH WITH AI
        </button>
        {err && <p className="mt-1 text-[10px] text-amber-300/80">{err}</p>}
      </div>
    )
  }
  if (state.status === 'loading') {
    return (
      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-violet-300">
        <Loader2 size={11} className="animate-spin" /> Polishing wording…
      </div>
    )
  }
  // status === 'ready'
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <button
        onClick={() => props.onUseWording(lineId)}
        className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500"
      >
        USE THIS WORDING
      </button>
      <button
        onClick={() => props.onRegenerate(lineId)}
        className="rounded border border-violet-500/40 bg-violet-600/15 px-2 py-1 text-[10px] font-semibold text-violet-300 hover:bg-violet-600/25"
      >
        REGENERATE
      </button>
      <button
        onClick={() => props.onRestoreOriginal(lineId)}
        className="rounded border border-gray-600 px-2 py-1 text-[10px] font-semibold text-gray-300 hover:bg-gray-800"
      >
        RESTORE ORIGINAL
      </button>
    </div>
  )
}

function InvoicePreview(props: { draft: PreparedBillingDraft; warnings: { title: string; body: string; severity: 'incomplete' | 'invalid' }[] }) {
  const { draft, warnings } = props
  const blocking = warnings.filter((w) => w.severity === 'invalid')
  return (
    <div className="space-y-3">
      {blocking.length > 0 && (
        <section className="space-y-2">
          {blocking.map((w, i) => (
            <div key={i} className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-950/25 p-2 text-xs text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold">{w.title}</div>
                <div className="text-[11px] text-amber-200/80">{w.body}</div>
              </div>
            </div>
          ))}
        </section>
      )}
      <section>
        <div className="rounded border border-gray-700 bg-gray-800/20 p-2">
          <div className="text-[11px] text-gray-400">
            <span className="font-semibold text-gray-300">Customer:</span> {draft.customerReference ?? '—'}
          </div>
          <ul className="mt-2 space-y-1.5">
            {draft.lines.map((line) => (
              <li key={line.id} className="rounded border border-gray-700 bg-gray-800/30 p-2">
                <div className="flex items-center gap-2">
                  <FileText size={12} className="shrink-0 text-gray-500" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-gray-100">{line.title || '(no product / service)'}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-100">{fmt(line.amount)}</span>
                </div>
                {line.description && (
                  <p className="mt-1 whitespace-pre-wrap pl-5 text-[10px] text-gray-400">{line.description}</p>
                )}
              </li>
            ))}
            {draft.lines.length === 0 && (
              <li className="rounded border border-dashed border-gray-700 p-3 text-center text-xs text-gray-500">
                No billing lines yet — enter an Invoice Amount.
              </li>
            )}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-gray-700 pt-2">
            <span className="text-xs font-semibold text-gray-300">INVOICE TOTAL</span>
            <span className="text-sm font-bold tabular-nums text-blue-300">{fmt(draft.currentInvoiceAmount)}</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function CompactPaymentContext(props: { read: BillingRead; draft: PreparedBillingDraft }) {
  const { read, draft } = props
  const valueLabel = read.sourceKind === 'service' ? 'Service Value' : 'Project Value'
  const contractDisplay = read.contractValue == null ? '—' : fmt(read.contractValue)
  const balanceDisplay = draft.paymentBalance == null ? '—' : fmt(draft.paymentBalance)
  return (
    <section className="mt-3 rounded border border-gray-800 bg-gray-800/20 p-2">
      <h3 className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">Reference</h3>
      <dl className="space-y-0.5 text-[11px]">
        <ContextRow label={valueLabel} value={contractDisplay} />
        <ContextRow label="Collected" value={fmt(read.collectedSoFar)} muted />
        <ContextRow label="Payment Balance" value={balanceDisplay} muted />
        <div className="my-1 border-t border-gray-800" />
        <ContextRow label="Invoice History" value="Not tracked yet" muted />
      </dl>
      <p className="mt-1 text-[9px] text-gray-600">
        Reference only — does not determine the Invoice Amount. Payment Balance does not limit what you may invoice.
      </p>
    </section>
  )
}

function ContextRow(props: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500">{props.label}</dt>
      <dd className={`tabular-nums ${props.muted ? 'text-gray-500' : 'text-gray-300'}`}>{props.value}</dd>
    </div>
  )
}

function DraftReadyConfirmation(props: { draft: PreparedBillingDraft; onEditDraft: () => void; onClose: () => void }) {
  const { draft } = props
  const primary = draft.lines[0]
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600/20 text-emerald-400">
        <FileText size={26} />
      </div>
      <h3 className="text-base font-bold text-emerald-300">INVOICE DRAFT READY</h3>
      <p className="max-w-md text-xs text-gray-300">
        Nothing has been sent to QuickBooks yet. This approved draft is kept in memory for the later QuickBooks handoff.
      </p>
      <div className="mt-2 w-full max-w-md rounded border border-gray-700 bg-gray-800/30 p-3 text-left text-xs">
        <div className="text-gray-400"><span className="font-semibold text-gray-300">Customer:</span> {draft.customerReference ?? '—'}</div>
        {primary && (
          <>
            <div className="mt-1 text-gray-400"><span className="font-semibold text-gray-300">Product / Service:</span> {primary.title || '—'}</div>
            {primary.description && <p className="mt-1 whitespace-pre-wrap text-[11px] text-gray-300">{primary.description}</p>}
          </>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-gray-700 pt-2">
          <span className="font-semibold text-gray-300">INVOICE TOTAL</span>
          <span className="text-sm font-bold tabular-nums text-blue-300">{fmt(draft.currentInvoiceAmount)}</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={props.onEditDraft}
          className="rounded border border-gray-600 px-3 py-1.5 text-xs font-semibold text-gray-200 hover:bg-gray-800"
        >
          Edit Draft
        </button>
        <button
          onClick={props.onClose}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
        >
          Close
        </button>
      </div>
    </div>
  )
}

// ── Local helpers ─────────────────────────────────────────────────────────────

/**
 * Convenience host helper: open the modal for a project id from the live backup.
 */
export function resolveProjectSource(projectId: string): PrepareInvoiceSource | null {
  const backup = getBackupData()
  if (!backup) return null
  const project = backup.projects.find((p) => p.id === projectId)
  if (!project) return null
  return { kind: 'project', project, backup }
}

/** Convenience host helper: open the modal for a service log id from the live backup. */
export function resolveServiceSource(serviceLogId: string): PrepareInvoiceSource | null {
  const backup = getBackupData()
  if (!backup) return null
  const serviceLog = backup.serviceLogs?.find((l) => l.id === serviceLogId)
  if (!serviceLog) return null
  return { kind: 'service', serviceLog }
}