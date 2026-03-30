/**
 * RFI Manager — Request for Information lifecycle operations.
 *
 * Handles:
 * - RFI creation with auto-generated numbers
 * - Status transitions (open → submitted → responded → closed)
 * - Response recording and optional change order linkage
 * - RFI closure
 * - Project RFI queries
 */

import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'

// ── Types ───────────────────────────────────────────────────────────────────

export type RFIStatus = 'open' | 'submitted' | 'responded' | 'closed' | 'rejected'
export type RFICategory = 'design' | 'coordination' | 'supplier' | 'permit' | 'ahj' | 'inspection'

export interface RFIData {
  id: string
  rfi_number: string
  project_id: string
  status: RFIStatus
  question: string
  requested_from: string
  category: RFICategory
  due_date: string | null
  response: string | null
  responded_at: string | null
  linked_change_order_id: string | null
  impact_type: string | null
  estimated_cost_impact: number | null
  estimated_days_impact: number | null
  created_by: string
  created_at: string
}

// ── RFI Number Generation ───────────────────────────────────────────────────

/**
 * Generate the next RFI number in the format RFI-YYYY-NNNNN.
 */
async function generateRFINumber(): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()

  // Query the count of RFIs created this year
  const { data: rfis, error } = await supabase
    .from('rfis')
    .select('rfi_number', { count: 'exact' })
    .gte('created_at', `${year}-01-01T00:00:00Z`)
    .lt('created_at', `${year + 1}-01-01T00:00:00Z`)

  if (error) {
    console.warn('[RFI] generateRFINumber count query failed:', error)
  }

  const count = rfis?.length || 0
  const sequence = String(count + 1).padStart(5, '0')
  return `RFI-${year}-${sequence}`
}

// ── RFI Creation ────────────────────────────────────────────────────────────

/**
 * Create a new RFI.
 */
export async function createRFI(
  orgId: string,
  projectId: string,
  question: string,
  requestedFrom: string,
  category: RFICategory,
  dueDate: string | null,
  costImpact?: number,
  daysImpact?: number,
  userId?: string
): Promise<string> {
  try {
    // Generate RFI number
    const rfiNumber = await generateRFINumber()

    // Create RFI
    const { data: rfi, error } = await supabase
      .from('rfis')
      .insert({
        org_id: orgId,
        project_id: projectId,
        rfi_number: rfiNumber,
        status: 'open',
        question,
        requested_from: requestedFrom,
        category,
        due_date: dueDate,
        estimated_cost_impact: costImpact || null,
        estimated_days_impact: daysImpact || null,
        created_by: userId || '',
      } as never)
      .select('id')
      .single()

    if (error || !rfi) {
      throw new Error(`RFI creation failed: ${error?.message}`)
    }

    const rfiData = rfi as any

    await logAudit({
      action: 'insert',
      entity_type: 'rfis',
      entity_id: rfiData.id,
      description: `Created RFI ${rfiNumber}: ${question}`,
      metadata: { projectId, category, requestedFrom },
    })

    return rfiData.id
  } catch (err) {
    console.error('[RFIManager] createRFI failed:', err)
    throw err
  }
}

// ── RFI Status Transitions ──────────────────────────────────────────────────

/**
 * Submit an RFI (transition open → submitted).
 */
export async function submitRFI(rfiId: string, userId?: string): Promise<void> {
  try {
    // Fetch RFI
    const { data: rfi, error: fetchError } = await supabase
      .from('rfis')
      .select('*')
      .eq('id', rfiId)
      .single()

    if (fetchError || !rfi) {
      throw new Error(`RFI not found: ${rfiId}`)
    }

    const rfiData = rfi as any

    if (rfiData.status !== 'open') {
      throw new Error(`Cannot submit RFI with status: ${rfiData.status}`)
    }

    // Update status
    const { error: updateError } = await supabase
      .from('rfis')
      .update({
        status: 'submitted',
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', rfiId)

    if (updateError) {
      throw new Error(`RFI submit failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'rfis',
      entity_id: rfiId,
      description: `Submitted RFI ${rfiData.rfi_number}`,
      metadata: { userId },
    })
  } catch (err) {
    console.error('[RFIManager] submitRFI failed:', err)
    throw err
  }
}

/**
 * Respond to an RFI and optionally create linked change order.
 */
export async function respondToRFI(
  rfiId: string,
  response: string,
  shouldLinkToCO: boolean = false,
  userId?: string
): Promise<void> {
  try {
    // Fetch RFI
    const { data: rfi, error: fetchError } = await supabase
      .from('rfis')
      .select('*')
      .eq('id', rfiId)
      .single()

    if (fetchError || !rfi) {
      throw new Error(`RFI not found: ${rfiId}`)
    }

    const rfiData = rfi as any

    if (rfiData.status !== 'submitted' && rfiData.status !== 'open') {
      throw new Error(`Cannot respond to RFI with status: ${rfiData.status}`)
    }

    // Update RFI with response
    const { error: updateError } = await supabase
      .from('rfis')
      .update({
        response,
        responded_at: new Date().toISOString(),
        status: 'responded',
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', rfiId)

    if (updateError) {
      throw new Error(`RFI response update failed: ${updateError.message}`)
    }

    // Optionally create linked change order
    if (shouldLinkToCO && rfiData.estimated_cost_impact) {
      // Generate CO number
      const now = new Date()
      const year = now.getFullYear()
      const { data: cos = [] } = await supabase
        .from('change_orders')
        .select('co_number', { count: 'exact' })
        .gte('created_at', `${year}-01-01T00:00:00Z`)

      const coSequence = String((cos?.length || 0) + 1).padStart(5, '0')
      const coNumber = `CO-${year}-${coSequence}`

      // Create change order
      const { data: co, error: coError } = await supabase
        .from('change_orders')
        .insert({
          org_id: rfiData.org_id,
          project_id: rfiData.project_id,
          co_number: coNumber,
          status: 'draft',
          description: `Related to RFI ${rfiData.rfi_number}: ${rfiData.question}`,
          reason: 'RFI response',
          amount: rfiData.estimated_cost_impact || 0,
          labor_hours: 0,
          material_cost: rfiData.estimated_cost_impact || 0,
          rfi_id: rfiId,
          created_by: userId || '',
        } as never)
        .select('id')
        .single()

      if (coError || !co) {
        console.warn('[RFIManager] Change order creation failed:', coError)
      } else {
        const coData = co as any
        // Link CO back to RFI
        await supabase
          .from('rfis')
          .update({ linked_change_order_id: coData.id } as never)
          .eq('id', rfiId)
      }
    }

    await logAudit({
      action: 'update',
      entity_type: 'rfis',
      entity_id: rfiId,
      description: `Responded to RFI ${rfiData.rfi_number}`,
      metadata: { linkedToCO: shouldLinkToCO, userId },
    })
  } catch (err) {
    console.error('[RFIManager] respondToRFI failed:', err)
    throw err
  }
}

/**
 * Close an RFI (transition to closed).
 */
export async function closeRFI(rfiId: string, userId?: string): Promise<void> {
  try {
    // Fetch RFI
    const { data: rfi, error: fetchError } = await supabase
      .from('rfis')
      .select('*')
      .eq('id', rfiId)
      .single()

    if (fetchError || !rfi) {
      throw new Error(`RFI not found: ${rfiId}`)
    }

    const rfiData = rfi as any

    // Can close from responded or open/submitted (rejected)
    if (rfiData.status === 'closed') {
      throw new Error('RFI is already closed')
    }

    // Update status
    const { error: updateError } = await supabase
      .from('rfis')
      .update({
        status: 'closed',
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', rfiId)

    if (updateError) {
      throw new Error(`RFI close failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'rfis',
      entity_id: rfiId,
      description: `Closed RFI ${rfiData.rfi_number}`,
      metadata: { userId },
    })
  } catch (err) {
    console.error('[RFIManager] closeRFI failed:', err)
    throw err
  }
}

// ── RFI Queries ─────────────────────────────────────────────────────────────

/**
 * Get all RFIs for a project.
 */
export async function getProjectRFIs(projectId: string): Promise<RFIData[]> {
  try {
    const { data: rfis = [], error } = await supabase
      .from('rfis')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Query failed: ${error.message}`)
    }

    return rfis as RFIData[]
  } catch (err) {
    console.error('[RFIManager] getProjectRFIs failed:', err)
    throw err
  }
}
