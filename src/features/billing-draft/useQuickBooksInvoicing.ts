/**
 * src/features/billing-draft/useQuickBooksInvoicing.ts
 *
 * QBO-2F — shared hook wiring the QuickBooks menu + Invoice Drafts manager +
 * Prepare Invoice rehydration to the persistence service. Drop one instance
 * into each billing surface (Project / Service Log / Service Call) so they all
 * open the SAME organization-wide Draft Manager and reopen drafts in the
 * existing Prepare Invoice modal (EDIT mode).
 *
 * The host owns its own surface-specific `prepareSource` (new-draft target).
 * This hook owns: the shared Draft Manager open/close + list refresh, the
 * rehydrate target (prepareDraft), and the save/approve persistence callbacks
 * handed to PrepareInvoiceModal.
 *
 * Financial-authority firewall: the hook only calls invoiceDraftService
 * (invoice_drafts table). It imports no PowerOn payment/KPI mutation authority.
 */
import { useCallback, useState } from 'react'

import { approveInvoiceDraft, saveInvoiceDraft } from '@/features/invoice-drafts/invoiceDraftService'
import type {
  HydratedDraft,
  InvoiceDraftSaveInput,
  InvoiceDraftSaveResult,
} from '@/features/invoice-drafts/invoiceDraftTypes'

// Re-export the types the host needs to thread through.
export type { HydratedDraft, InvoiceDraftSaveInput, InvoiceDraftSaveResult }

export interface QuickBooksInvoicing {
  /** Shared Draft Manager open state. */
  readonly draftsOpen: boolean
  readonly openDrafts: () => void
  readonly closeDrafts: () => void
  /** Bump after external changes to force the Draft Manager list to reload. */
  readonly refreshDraftsKey: number

  /** Rehydrate target — when set, PrepareInvoiceModal reopens this draft in EDIT mode. */
  readonly prepareDraft: HydratedDraft | null
  readonly openDraftForEdit: (draft: HydratedDraft) => void
  readonly clearPrepareDraft: () => void

  /** Persistence callbacks for PrepareInvoiceModal (save / approve). */
  readonly handleSaveDraft: (input: InvoiceDraftSaveInput) => Promise<InvoiceDraftSaveResult | null>
  readonly handleApprove: (input: InvoiceDraftSaveInput) => Promise<InvoiceDraftSaveResult | null>
}

export function useQuickBooksInvoicing(): QuickBooksInvoicing {
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [prepareDraft, setPrepareDraft] = useState<HydratedDraft | null>(null)
  const [refreshDraftsKey, setRefreshDraftsKey] = useState(0)

  const openDrafts = useCallback(() => setDraftsOpen(true), [])
  const closeDrafts = useCallback(() => setDraftsOpen(false), [])
  const clearPrepareDraft = useCallback(() => setPrepareDraft(null), [])
  const openDraftForEdit = useCallback((draft: HydratedDraft) => {
    setPrepareDraft(draft)
    setDraftsOpen(false)
  }, [])
  const bumpRefresh = useCallback(() => setRefreshDraftsKey((k) => k + 1), [])

  const handleSaveDraft = useCallback(
    async (input: InvoiceDraftSaveInput): Promise<InvoiceDraftSaveResult | null> => {
      try {
        const res = await saveInvoiceDraft(input)
        bumpRefresh()
        return res
      } catch (err) {
        console.error('[invoice-draft] save failed', err)
        return null
      }
    },
    [bumpRefresh],
  )

  const handleApprove = useCallback(
    async (input: InvoiceDraftSaveInput): Promise<InvoiceDraftSaveResult | null> => {
      try {
        const res = await approveInvoiceDraft(input)
        bumpRefresh()
        return res
      } catch (err) {
        console.error('[invoice-draft] approve failed', err)
        return null
      }
    },
    [bumpRefresh],
  )

  return {
    draftsOpen,
    openDrafts,
    closeDrafts,
    refreshDraftsKey,
    prepareDraft,
    openDraftForEdit,
    clearPrepareDraft,
    handleSaveDraft,
    handleApprove,
  }
}