/**
 * SALES-CONVERSION-1 — Service Call conversion bridge.
 *
 * Why this exists
 * ---------------
 * The Project path can call `recordConversion` inline, because
 * V15rProjectsPanel.saveNewProject is the one place a project id first exists.
 * The Service Call path cannot: the equivalent point is
 * V15rFieldLogPanel.saveEstimate, and that file is currently being rewritten by
 * a parallel Service Log agent, so it must not be edited here.
 *
 * Instead this bridge completes the conversion from the Sales Intelligence
 * side, using lineage the Service Log save path *already* writes:
 * `serviceEstimate.hunterLeadId`. When the operator returns to the Pipeline,
 * reconciliation finds the proven destination, persists the receipt, and only
 * then lets the lead leave the active Pipeline. The ordering guarantee is
 * preserved — the lead is still sitting in Pipeline until the receipt is
 * durable.
 *
 * Preferred future integration (documented contract, not yet wired):
 * once the Service Log rewrite lands, `saveEstimate` should dispatch
 *
 *   window.dispatchEvent(new CustomEvent('poweron:service-call-created', {
 *     detail: { serviceCallId: estimate.id,
 *               leadId: estimate.hunterLeadId,
 *               label: estimate.customer }
 *   }))
 *
 * immediately AFTER `persistServiceCalls()` resolves true. `SERVICE_CALL_CREATED_EVENT`
 * below is that contract; reconciliation stays as the durable safety net either way.
 */

import { LeadStatus } from '@/services/hunter/HunterTypes'
import { recordConversion, getCurrentTenantId } from './conversionReceiptService'
import { lineageForLead } from './conversionReceiptLineage'
import type { ConversionDestinationType } from './conversionReceiptTypes'

/** Event the Service Log save path may dispatch once a service call exists. */
export const SERVICE_CALL_CREATED_EVENT = 'poweron:service-call-created'

/** Lead statuses that still occupy the active Pipeline list. */
export const ACTIVE_PIPELINE_STATUSES: string[] = [LeadStatus.WON]

/** The status a lead moves to once its receipt is durable. */
export const CONVERTED_LEAD_STATUS = 'estimated'

export interface ReconcileOutcome {
  leadId: string
  destinationType: ConversionDestinationType
  destinationId: string
  /** True when a new receipt row was written this pass. */
  created: boolean
  /** True when the lead may now leave the active Pipeline. */
  receiptDurable: boolean
  error: string | null
}

export interface ReconcileResult {
  outcomes: ReconcileOutcome[]
  /** Leads whose receipt is durable and which should now be status-flipped. */
  leadsReadyToExit: string[]
  /** Human-readable errors to surface as retryable, not silent. */
  errors: string[]
}

/**
 * For every lead still in the active Pipeline, mint the receipt for any
 * destination record it provably created, then report which leads may exit.
 *
 * Idempotent: reruns hit the DB unique constraint and return created:false.
 * Never flips a lead on its own — the caller owns the status write so the
 * ordering stays visible at the call site.
 */
export async function reconcilePipelineConversions(params: {
  leads: Array<Record<string, any>>
  backup: any
  tenantId?: string | null
}): Promise<ReconcileResult> {
  const outcomes: ReconcileOutcome[] = []
  const errors: string[] = []
  const leadsReadyToExit: string[] = []

  const activeLeads = (params.leads ?? []).filter((lead) =>
    ACTIVE_PIPELINE_STATUSES.includes(String(lead?.status))
  )
  if (activeLeads.length === 0) return { outcomes, leadsReadyToExit, errors }

  const tenantId = params.tenantId ?? (await getCurrentTenantId())
  if (!tenantId) {
    return {
      outcomes,
      leadsReadyToExit,
      errors: ['No tenant membership for the current user; conversion receipts not reconciled.'],
    }
  }

  for (const lead of activeLeads) {
    const lineage = lineageForLead(params.backup, String(lead.id))
    if (lineage.length === 0) continue

    let allDurable = true
    for (const entry of lineage) {
      const result = await recordConversion({
        lead,
        destinationType: entry.destinationType,
        destinationId: entry.destinationId,
        destinationLabel: entry.destinationLabel,
        convertedValue: entry.convertedValue,
        tenantId,
      })
      outcomes.push({
        leadId: String(lead.id),
        destinationType: entry.destinationType,
        destinationId: entry.destinationId,
        created: result.created,
        receiptDurable: result.ok,
        error: result.error,
      })
      if (!result.ok) {
        allDurable = false
        if (result.error) errors.push(result.error)
      }
    }

    // Only a lead whose every proven destination has a durable receipt is
    // allowed out of the active Pipeline.
    if (allDurable) leadsReadyToExit.push(String(lead.id))
  }

  return { outcomes, leadsReadyToExit, errors }
}
