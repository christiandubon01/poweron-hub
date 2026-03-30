/**
 * Change Order Manager — Change order lifecycle operations.
 *
 * Handles:
 * - Change order creation from draft
 * - Submission and approval workflows
 * - Cost impact on project contract value
 * - Change order queries
 */

import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'

// ── Types ───────────────────────────────────────────────────────────────────

export type COStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'voided'

export interface ChangeOrderData {
  id: string
  co_number: string
  project_id: string
  status: COStatus
  description: string
  reason: string
  amount: number
  labor_hours: number | null
  material_cost: number | null
  rfi_id: string | null
  submitted_at: string | null
  approved_at: string | null
  approved_by: string | null
  notes: string | null
  created_by: string
  created_at: string
}

// ── Change Order Number Generation ──────────────────────────────────────────

/**
 * Generate the next CO number in the format CO-YYYY-NNNNN.
 */
async function generateCONumber(): Promise<string> {
  const now = new Date()
  const year = now.getFullYear()

  // Query the count of COs created this year
  const { data: cos, error } = await supabase
    .from('change_orders')
    .select('co_number', { count: 'exact' })
    .gte('created_at', `${year}-01-01T00:00:00Z`)
    .lt('created_at', `${year + 1}-01-01T00:00:00Z`)

  if (error) {
    console.warn('[CO] generateCONumber count query failed:', error)
  }

  const count = cos?.length || 0
  const sequence = String(count + 1).padStart(5, '0')
  return `CO-${year}-${sequence}`
}

// ── Change Order Creation ───────────────────────────────────────────────────

/**
 * Create a draft change order.
 */
export async function draftChangeOrder(
  orgId: string,
  projectId: string,
  description: string,
  amount: number,
  reason: string,
  rfiId?: string,
  laborHours?: number,
  materialCost?: number,
  userId?: string
): Promise<string> {
  try {
    if (!description || !reason) {
      throw new Error('Description and reason are required')
    }

    // Generate CO number
    const coNumber = await generateCONumber()

    // Create change order
    const { data: co, error } = await supabase
      .from('change_orders')
      .insert({
        org_id: orgId,
        project_id: projectId,
        co_number: coNumber,
        status: 'draft',
        description,
        reason,
        amount,
        labor_hours: laborHours || null,
        material_cost: materialCost || amount,
        rfi_id: rfiId || null,
        created_by: userId || '',
      } as never)
      .select('id')
      .single()

    if (error || !co) {
      throw new Error(`Change order creation failed: ${error?.message}`)
    }

    const coData = co as any

    await logAudit({
      action: 'insert',
      entity_type: 'change_orders',
      entity_id: coData.id,
      description: `Created draft CO ${coNumber}: ${description}`,
      metadata: { projectId, amount, rfiId },
    })

    return coData.id
  } catch (err) {
    console.error('[COManager] draftChangeOrder failed:', err)
    throw err
  }
}

// ── Change Order Status Transitions ─────────────────────────────────────────

/**
 * Submit a change order (draft → submitted).
 */
export async function submitChangeOrder(coId: string, userId: string): Promise<void> {
  try {
    // Fetch change order
    const { data: co, error: fetchError } = await supabase
      .from('change_orders')
      .select('*')
      .eq('id', coId)
      .single()

    if (fetchError || !co) {
      throw new Error(`Change order not found: ${coId}`)
    }

    const coData = co as any

    if (coData.status !== 'draft') {
      throw new Error(`Cannot submit CO with status: ${coData.status}`)
    }

    // Update status
    const { error: updateError } = await supabase
      .from('change_orders')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', coId)

    if (updateError) {
      throw new Error(`CO submit failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'change_orders',
      entity_id: coId,
      description: `Submitted CO ${coData.co_number}: ${coData.description}`,
      metadata: { userId },
    })
  } catch (err) {
    console.error('[COManager] submitChangeOrder failed:', err)
    throw err
  }
}

/**
 * Approve a change order (submitted → approved).
 * Updates project contract_value by the CO amount.
 */
export async function approveChangeOrder(coId: string, userId: string): Promise<void> {
  try {
    // Fetch change order
    const { data: co, error: fetchError } = await supabase
      .from('change_orders')
      .select('*')
      .eq('id', coId)
      .single()

    if (fetchError || !co) {
      throw new Error(`Change order not found: ${coId}`)
    }

    const coData = co as any

    if (coData.status !== 'submitted') {
      throw new Error(`Cannot approve CO with status: ${coData.status}`)
    }

    // Fetch project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('contract_value')
      .eq('id', coData.project_id)
      .single()

    if (projectError || !project) {
      throw new Error(`Project not found: ${coData.project_id}`)
    }

    const projectData = project as any

    // Update CO status
    const { error: updateError } = await supabase
      .from('change_orders')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: userId,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', coId)

    if (updateError) {
      throw new Error(`CO approval failed: ${updateError.message}`)
    }

    // Update project contract value
    const newContractValue = (projectData.contract_value || 0) + coData.amount
    const { error: projectUpdateError } = await supabase
      .from('projects')
      .update({
        contract_value: newContractValue,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', coData.project_id)

    if (projectUpdateError) {
      throw new Error(`Project update failed: ${projectUpdateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'change_orders',
      entity_id: coId,
      description: `Approved CO ${coData.co_number}: ${coData.description}`,
      metadata: { userId, amount: coData.amount, newContractValue },
    })
  } catch (err) {
    console.error('[COManager] approveChangeOrder failed:', err)
    throw err
  }
}

/**
 * Reject a change order (submitted → rejected).
 */
export async function rejectChangeOrder(coId: string, reason: string, userId: string): Promise<void> {
  try {
    // Fetch change order
    const { data: co, error: fetchError } = await supabase
      .from('change_orders')
      .select('*')
      .eq('id', coId)
      .single()

    if (fetchError || !co) {
      throw new Error(`Change order not found: ${coId}`)
    }

    const coData = co as any

    if (coData.status !== 'submitted') {
      throw new Error(`Cannot reject CO with status: ${coData.status}`)
    }

    // Update status
    const { error: updateError } = await supabase
      .from('change_orders')
      .update({
        status: 'rejected',
        notes: reason,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', coId)

    if (updateError) {
      throw new Error(`CO rejection failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'change_orders',
      entity_id: coId,
      description: `Rejected CO ${coData.co_number}: ${reason}`,
      metadata: { userId },
    })
  } catch (err) {
    console.error('[COManager] rejectChangeOrder failed:', err)
    throw err
  }
}

// ── Change Order Queries ────────────────────────────────────────────────────

/**
 * Get all change orders for a project.
 */
export async function getProjectChangeOrders(projectId: string): Promise<ChangeOrderData[]> {
  try {
    const { data: cos = [], error } = await supabase
      .from('change_orders')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Query failed: ${error.message}`)
    }

    return cos as ChangeOrderData[]
  } catch (err) {
    console.error('[COManager] getProjectChangeOrders failed:', err)
    throw err
  }
}

/**
 * Get pending change orders (draft or submitted).
 */
export async function getPendingChangeOrders(projectId: string): Promise<ChangeOrderData[]> {
  try {
    const { data: cos = [], error } = await supabase
      .from('change_orders')
      .select('*')
      .eq('project_id', projectId)
      .in('status', ['draft', 'submitted'])
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(`Query failed: ${error.message}`)
    }

    return cos as ChangeOrderData[]
  } catch (err) {
    console.error('[COManager] getPendingChangeOrders failed:', err)
    throw err
  }
}
