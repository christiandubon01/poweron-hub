/**
 * SALES-CONVERSION-1 — Step 4 of the conversion sequence.
 *
 * Everything here runs ONLY after the destination record exists and its
 * conversion receipt is durable. It is the single place that moves a lead out
 * of the active Pipeline.
 *
 * The portal milestone writes below used to fire in AppShell the instant the
 * operator clicked "Open as Service Call" — i.e. before any service call
 * existed, and even if the operator then cancelled. They were moved here so
 * "A service call has been created for your request" is only ever sent when
 * one actually was.
 */

import { supabase } from '@/lib/supabase'
import { CONVERTED_LEAD_STATUS } from './conversionReceiptBridge'
import type { ConversionDestinationType } from './conversionReceiptTypes'

const DESTINATION_LABEL: Record<ConversionDestinationType, string> = {
  project: 'project',
  service_call: 'service call',
}

/**
 * Writes the archive disposition that Lead History reads. Best-effort: the
 * receipt is the system of record, so a disposition failure must not block the
 * lead from leaving Pipeline.
 */
export async function writeConversionDisposition(params: {
  leadId: string
  destinationType: ConversionDestinationType
  destinationLabel: string | null
}): Promise<void> {
  try {
    await (supabase as any)
      .from('hunter_leads')
      .update({
        disposition: 'won_archived',
        disposition_detail: `Converted to ${DESTINATION_LABEL[params.destinationType]}: ${
          params.destinationLabel || 'Unknown'
        }`,
        disposition_at: new Date().toISOString(),
      })
      .eq('id', params.leadId)
  } catch (err) {
    console.error('[conversionCompletion] disposition write failed:', err)
  }
}

/**
 * Fires the customer-facing scheduling/confirmed milestones for a portal lead
 * whose service call now exists. No-op for non-portal leads.
 */
export async function writeServiceCallPortalMilestones(lead: Record<string, any>): Promise<void> {
  const isPortalLead = lead?.source === 'customer_portal' || lead?.source_tag === 'customer_portal'
  if (!isPortalLead) return
  try {
    const { writePortalTimelineEvent } = await import('@/services/portal/portalService')
    const { data: portalReq } = await (supabase as any)
      .from('portal_requests')
      .select('id, preferred_date')
      .eq('hunter_lead_id', lead.id)
      .maybeSingle()
    if (!portalReq?.id) return

    const preferred = portalReq.preferred_date
    const confirmedTime = preferred
      ? new Date(`${preferred}T12:00:00`).toISOString()
      : new Date(Date.now() + 1000).toISOString()

    await Promise.all([
      writePortalTimelineEvent({
        portalRequestId: portalReq.id,
        eventType: 'scheduling',
        description: 'A service call has been created for your request.',
        eventTime: new Date().toISOString(),
      }),
      writePortalTimelineEvent({
        portalRequestId: portalReq.id,
        eventType: 'confirmed',
        description: 'Your service call has been scheduled.',
        eventTime: confirmedTime,
      }),
    ])
  } catch (err) {
    console.error('[conversionCompletion] service_call milestone write failed:', err)
  }
}

/**
 * Moves one lead out of the active Pipeline. Callers must have a durable
 * receipt in hand; this function never checks for one itself, so it should
 * only ever be reached from `reconcilePipelineConversions`'s
 * `leadsReadyToExit` or an equivalent post-receipt path.
 */
export async function completeLeadExit(params: {
  lead: Record<string, any>
  destinationType: ConversionDestinationType
  destinationLabel: string | null
  updateLeadStatus: (leadId: string, status: any) => Promise<void>
}): Promise<void> {
  const leadId = String(params.lead.id)
  await params.updateLeadStatus(leadId, CONVERTED_LEAD_STATUS as any)
  await writeConversionDisposition({
    leadId,
    destinationType: params.destinationType,
    destinationLabel: params.destinationLabel,
  })
  if (params.destinationType === 'service_call') {
    await writeServiceCallPortalMilestones(params.lead)
  }
}
