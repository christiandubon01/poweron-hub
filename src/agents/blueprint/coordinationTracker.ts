/**
 * Coordination Tracker — Coordination item lifecycle and blocking logic.
 *
 * Handles:
 * - Coordination item creation (light, main, urgent, research, permit, inspect)
 * - Status transitions and blocking detection
 * - Unblocking dependent items when blockers complete
 * - Findings and issue documentation
 */

import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'

// ── Types ───────────────────────────────────────────────────────────────────

export type CoordinationCategory = 'light' | 'main' | 'urgent' | 'research' | 'permit' | 'inspect'
export type CoordinationStatus = 'open' | 'in_progress' | 'blocked' | 'completed' | 'canceled'

export interface CoordinationItem {
  id: string
  project_id: string
  category: CoordinationCategory
  title: string
  description: string
  status: CoordinationStatus
  due_date: string | null
  completed_at: string | null
  assigned_to: string | null
  responsible_party: string | null
  blocks_phase: string | null
  depends_on_item_id: string | null
  findings: Record<string, any> | null
  notes: string | null
  created_at: string
}

// ── Coordination Item Creation ──────────────────────────────────────────────

/**
 * Create a coordination item.
 */
export async function createCoordinationItem(
  orgId: string,
  projectId: string,
  category: CoordinationCategory,
  description: string,
  dueDate: string | null,
  blocksPhase?: string,
  assignedTo?: string,
  userId?: string
): Promise<string> {
  try {
    // Create item
    const { data: item, error } = await supabase
      .from('coordination_items')
      .insert({
        org_id: orgId,
        project_id: projectId,
        category,
        title: description.substring(0, 100), // Use first 100 chars as title
        description,
        status: 'open',
        due_date: dueDate,
        blocks_phase: blocksPhase || null,
        assigned_to: assignedTo || null,
        created_by: userId || '',
      } as never)
      .select('id')
      .single()

    if (error || !item) {
      throw new Error(`Coordination item creation failed: ${error?.message}`)
    }

    const itemData = item as any

    await logAudit({
      action: 'insert',
      entity_type: 'coordination_items',
      entity_id: itemData.id,
      description: `Created coordination item (${category}): ${description}`,
      metadata: { projectId, blocksPhase, assignedTo },
    })

    return itemData.id
  } catch (err) {
    console.error('[CoordTracker] createCoordinationItem failed:', err)
    throw err
  }
}

// ── Status Updates ──────────────────────────────────────────────────────────

/**
 * Update a coordination item's status.
 * Can record findings and notes.
 */
export async function updateCoordinationStatus(
  itemId: string,
  status: CoordinationStatus,
  findings?: Record<string, any>,
  notes?: string,
  userId?: string
): Promise<void> {
  try {
    // Fetch item
    const { data: item, error: fetchError } = await supabase
      .from('coordination_items')
      .select('*')
      .eq('id', itemId)
      .single()

    if (fetchError || !item) {
      throw new Error(`Coordination item not found: ${itemId}`)
    }

    const itemData = item as any

    // Prepare update
    const updates: any = {
      status,
      updated_at: new Date().toISOString(),
    }

    if (status === 'completed' && !itemData.completed_at) {
      updates.completed_at = new Date().toISOString()
    }

    if (findings) {
      updates.findings = findings
    }

    if (notes) {
      updates.notes = notes
    }

    // Update item
    const { error: updateError } = await supabase
      .from('coordination_items')
      .update(updates as never)
      .eq('id', itemId)

    if (updateError) {
      throw new Error(`Status update failed: ${updateError.message}`)
    }

    // If completed, unblock dependent items
    if (status === 'completed' && itemData.blocks_phase) {
      await checkUnblockedItems(itemData.project_id, itemData.blocks_phase)
    }

    await logAudit({
      action: 'update',
      entity_type: 'coordination_items',
      entity_id: itemId,
      description: `Updated coordination item status to ${status}`,
      metadata: { userId, hasFindings: !!findings },
    })
  } catch (err) {
    console.error('[CoordTracker] updateCoordinationStatus failed:', err)
    throw err
  }
}

// ── Blocking & Unblocking Logic ─────────────────────────────────────────────

/**
 * Check if any items can be unblocked now that a phase has completed.
 * Unblocks items that depended on the completed phase.
 */
export async function checkUnblockedItems(projectId: string, completedPhase: string): Promise<void> {
  try {
    // Find items blocked by this phase and still in blocked status
    const { data: blockedItems = [], error: fetchError } = await supabase
      .from('coordination_items')
      .select('*')
      .eq('project_id', projectId)
      .eq('blocks_phase', completedPhase)
      .eq('status', 'blocked')

    if (fetchError) {
      console.warn('[CoordTracker] checkUnblockedItems query failed:', fetchError)
      return
    }

    // For each blocked item, transition it back to open
    for (const item of blockedItems || []) {
      const itemData = item as any
      const { error: updateError } = await supabase
        .from('coordination_items')
        .update({
          status: 'open',
          updated_at: new Date().toISOString(),
        } as never)
        .eq('id', itemData.id)

      if (updateError) {
        console.warn('[CoordTracker] Failed to unblock item:', updateError)
      }
    }

    if ((blockedItems || []).length > 0) {
      await logAudit({
        action: 'update',
        entity_type: 'coordination_items',
        description: `Unblocked ${(blockedItems || []).length} items after phase ${completedPhase} completion`,
        metadata: { projectId, completedPhase, unblockedCount: (blockedItems || []).length },
      })
    }
  } catch (err) {
    console.error('[CoordTracker] checkUnblockedItems failed:', err)
  }
}

/**
 * Manually block an item (set status to blocked).
 * Used when an external dependency blocks progress.
 */
export async function blockCoordinationItem(itemId: string, reason: string, userId?: string): Promise<void> {
  try {
    const { error: updateError } = await supabase
      .from('coordination_items')
      .update({
        status: 'blocked',
        notes: reason,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', itemId)

    if (updateError) {
      throw new Error(`Block failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'coordination_items',
      entity_id: itemId,
      description: `Blocked coordination item: ${reason}`,
      metadata: { userId },
    })
  } catch (err) {
    console.error('[CoordTracker] blockCoordinationItem failed:', err)
    throw err
  }
}

// ── Queries ────────────────────────────────────────────────────────────────

/**
 * Get all coordination items for a project.
 */
export async function getProjectCoordination(projectId: string): Promise<CoordinationItem[]> {
  try {
    const { data: items = [], error } = await supabase
      .from('coordination_items')
      .select('*')
      .eq('project_id', projectId)
      .order('due_date', { ascending: true, nullsFirst: true })

    if (error) {
      throw new Error(`Query failed: ${error.message}`)
    }

    return items as CoordinationItem[]
  } catch (err) {
    console.error('[CoordTracker] getProjectCoordination failed:', err)
    throw err
  }
}

/**
 * Get coordination items blocking a specific phase.
 */
export async function getItemsBlockingPhase(projectId: string, phaseName: string): Promise<CoordinationItem[]> {
  try {
    const { data: items = [], error } = await supabase
      .from('coordination_items')
      .select('*')
      .eq('project_id', projectId)
      .eq('blocks_phase', phaseName)
      .in('status', ['open', 'in_progress', 'blocked'])
      .order('due_date', { ascending: true })

    if (error) {
      throw new Error(`Query failed: ${error.message}`)
    }

    return items as CoordinationItem[]
  } catch (err) {
    console.error('[CoordTracker] getItemsBlockingPhase failed:', err)
    throw err
  }
}

/**
 * Get items by category and status.
 */
export async function getCoordinationByCategory(
  projectId: string,
  category: CoordinationCategory,
  status?: CoordinationStatus
): Promise<CoordinationItem[]> {
  try {
    let query = supabase
      .from('coordination_items')
      .select('*')
      .eq('project_id', projectId)
      .eq('category', category)

    if (status) {
      query = query.eq('status', status)
    }

    const { data: items = [], error } = await query.order('due_date', { ascending: true })

    if (error) {
      throw new Error(`Query failed: ${error.message}`)
    }

    return items as CoordinationItem[]
  } catch (err) {
    console.error('[CoordTracker] getCoordinationByCategory failed:', err)
    throw err
  }
}
