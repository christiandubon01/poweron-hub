/**
 * src/features/billing-draft/components/InvoiceDraftsModal.tsx
 *
 * QBO-2F — Invoice Drafts: ONE shared organization-wide Draft Manager for both
 * Project and Service invoice drafts (no separate Project/Service managers).
 *
 * Large centered modal with two top-level tabs:
 *   Drafts     — status = draft
 *   Approved   — status = approved
 *
 * Each entry shows: customer name, Project/Service source, invoice amount (or
 * a clean "Amount not set" state), last updated date/time, status chip, and
 * Open/Edit + Delete actions. Sorted newest-updated first.
 *
 * Approved drafts may still be reopened and edited because nothing has been
 * sent to QuickBooks yet (QBO-2F). Deletion (draft OR approved) is allowed this
 * phase and requires explicit confirmation. No "Sent" status is built here.
 *
 * No QBO API, no payment/KPI mutation — the manager only reads/deletes
 * invoice_drafts via the persistence service.
 */
import { AlertTriangle, FileText, Loader2, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { fmt } from '@/services/backupDataService'
import { deleteInvoiceDraft, listInvoiceDrafts } from '@/features/invoice-drafts/invoiceDraftService'
import type { HydratedDraft, InvoiceDraftStatus } from '@/features/invoice-drafts/invoiceDraftTypes'

export interface InvoiceDraftsModalProps {
  open: boolean
  onClose: () => void
  /** Reopen a draft in the Prepare Invoice modal (EDIT mode). */
  onOpenDraft: (draft: HydratedDraft) => void
  /** Bump to force a list refresh (e.g. after a save/approve/delete elsewhere). */
  refreshKey: number
}

type Tab = 'drafts' | 'approved'

export function InvoiceDraftsModal({ open, onClose, onOpenDraft, refreshKey }: InvoiceDraftsModalProps) {
  const [tab, setTab] = useState<Tab>('drafts')
  const [drafts, setDrafts] = useState<HydratedDraft[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listInvoiceDrafts(tab === 'approved' ? 'approved' : 'draft')
      .then((rows) => {
        if (!cancelled) setDrafts(rows)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load drafts')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, tab, refreshKey])

  if (!open) return null

  async function handleDelete(id: string): Promise<void> {
    setBusyId(id)
    try {
      await deleteInvoiceDraft(id)
      setDrafts((prev) => prev.filter((d) => d.id !== id))
      setConfirmId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete draft')
    } finally {
      setBusyId(null)
    }
  }

  function handleOpen(d: HydratedDraft): void {
    onOpenDraft(d)
    onClose()
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Invoice Drafts"
      className="fixed inset-0 z-[8800] flex items-center justify-center bg-black/70 p-2 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-[#111827] text-gray-100 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-700 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-100">INVOICE DRAFTS</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Organization-wide invoice drafts. Approved drafts can be reopened and edited — nothing has been sent to QuickBooks.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Invoice Drafts"
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-700 px-4 pt-2">
          <TabButton active={tab === 'drafts'} onClick={() => setTab('drafts')} label="Drafts" />
          <TabButton active={tab === 'approved'} onClick={() => setTab('approved')} label="Approved" />
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-gray-400">
              <Loader2 size={14} className="animate-spin" /> Loading drafts…
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-950/25 p-3 text-xs text-amber-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
            </div>
          ) : drafts.length === 0 ? (
            <div className="rounded border border-dashed border-gray-700 p-8 text-center text-xs text-gray-500">
              {tab === 'approved'
                ? 'No approved invoice drafts. Approved drafts stay here until they are sent to QuickBooks (a later phase).'
                : 'No invoice drafts yet. Open Prepare Invoice from a Project or Service Log to create one.'}
            </div>
          ) : (
            <ul className="space-y-2">
              {drafts.map((d) => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  confirmOpen={confirmId === d.id}
                  busy={busyId === d.id}
                  onOpen={() => handleOpen(d)}
                  onAskDelete={() => setConfirmId(d.id)}
                  onCancelDelete={() => setConfirmId(null)}
                  onConfirmDelete={() => handleDelete(d.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function TabButton(props: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={props.onClick}
      className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-semibold transition-colors ${
        props.active ? 'border-blue-500 text-gray-100' : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {props.label}
    </button>
  )
}

function DraftRow(props: {
  draft: HydratedDraft
  confirmOpen: boolean
  busy: boolean
  onOpen: () => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}) {
  const { draft } = props
  const sourceLabel = draft.sourceKind === 'project' ? 'Project' : draft.sourceKind === 'serviceCall' ? 'Service Call' : 'Service Log'
  const hasAmount = draft.totalAmount > 0
  return (
    <li className="rounded border border-gray-700 bg-gray-800/30 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-gray-100">
              {draft.customerReference || '—'}
            </span>
            <StatusChip status={draft.status} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
            <span className="inline-flex items-center gap-1">
              <FileText size={11} className="text-gray-500" /> {sourceLabel}
            </span>
            <span className="tabular-nums">
              {hasAmount ? <span className="font-semibold text-gray-200">{fmt(draft.totalAmount)}</span> : <span className="italic text-gray-500">Amount not set</span>}
            </span>
            <span className="text-gray-500">Updated {formatUpdated(draft.updatedAt)}</span>
          </div>
          {draft.productOrService && (
            <div className="mt-1 truncate text-[11px] text-gray-500">{draft.productOrService}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {props.confirmOpen ? (
            <div className="flex items-center gap-1.5 rounded border border-red-500/40 bg-red-950/30 px-2 py-1">
              <span className="text-[10px] text-red-200">Delete?</span>
              <button
                onClick={props.onCancelDelete}
                disabled={props.busy}
                className="rounded border border-gray-600 px-1.5 py-0.5 text-[10px] text-gray-300 hover:bg-gray-800"
              >
                No
              </button>
              <button
                onClick={props.onConfirmDelete}
                disabled={props.busy}
                className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {props.busy ? '…' : 'Delete'}
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={props.onOpen}
                className="rounded border border-gray-600 px-2.5 py-1 text-[10px] font-semibold text-gray-200 hover:bg-gray-800"
              >
                {draft.status === 'approved' ? 'Open' : 'Edit'}
              </button>
              <button
                onClick={props.onAskDelete}
                aria-label="Delete draft"
                className="rounded border border-red-500/30 bg-red-500/10 px-1.5 py-1 text-red-300 hover:bg-red-500/20"
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  )
}

function StatusChip(props: { status: InvoiceDraftStatus }) {
  const approved = props.status === 'approved'
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
        approved ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-700 text-gray-300'
      }`}
    >
      {approved ? 'APPROVED' : 'DRAFT'}
    </span>
  )
}

function formatUpdated(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}