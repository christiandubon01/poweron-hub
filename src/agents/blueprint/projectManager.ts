/**
 * Project Manager — Core project lifecycle operations.
 *
 * Handles:
 * - Project creation from templates
 * - Phase status transitions with checklist tracking
 * - Checklist item completion
 * - Project closeout with satisfaction scoring
 * - Project summary retrieval with full context
 */

import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'

// ── Types ───────────────────────────────────────────────────────────────────

export type ProjectStatus = 'estimate' | 'approved' | 'in_progress' | 'punch_list' | 'completed' | 'canceled'
export type PhaseStatus = 'pending' | 'in_progress' | 'completed'

export interface ProjectPhase {
  name: string
  status: PhaseStatus
  checklist: Array<{
    item: string
    completed: boolean
    completedBy?: string | null
    completedAt?: string | null
  }>
  started_at?: string | null
  completed_at?: string | null
}

export interface ProjectSummary {
  projectId: string
  name: string
  status: ProjectStatus
  phases: ProjectPhase[]
  rfis: Array<{ rfiNumber: string; status: string; daysUntilDue: number; costImpact?: number }>
  changeOrders: Array<{ coNumber: string; status: string; amount: number }>
  coordinationItems: Array<{ title: string; status: string; category: string }>
  estimatedValue: number
  contractValue: number
  daysElapsed: number
  nextMilestone: string | null
  risks: string[]
}

// ── Project Creation from Template ──────────────────────────────────────────

/**
 * Create a project from a template.
 * Initializes phases and checklist from template defaults.
 */
export async function createProjectFromTemplate(
  orgId: string,
  clientId: string,
  templateId: string,
  name: string,
  type: string,
  address: string,
  userId: string
): Promise<string> {
  try {
    // Fetch template
    const { data: template, error: templateError } = await supabase
      .from('project_templates')
      .select('*')
      .eq('id', templateId)
      .eq('org_id', orgId)
      .single()

    if (templateError || !template) {
      throw new Error(`Template not found: ${templateId}`)
    }

    const templateData = template as any

    // Build phases array from template
    const phases = (templateData.phases as any[] || []).map((phase: any) => ({
      name: phase.name,
      status: 'pending' as PhaseStatus,
      checklist: (phase.default_tasks || []).map((task: string) => ({
        item: task,
        completed: false,
        completedBy: null,
        completedAt: null,
      })),
      started_at: null,
      completed_at: null,
    }))

    // Create project
    const { data: project, error: createError } = await supabase
      .from('projects')
      .insert({
        org_id: orgId,
        client_id: clientId,
        name,
        type,
        status: 'estimate',
        address,
        phases: phases as any,
        estimated_value: 0,
        contract_value: 0,
        permit_status: 'not_required',
        template_id: templateId,
        priority: 'medium',
        created_by: userId,
      } as never)
      .select('id')
      .single()

    if (createError || !project) {
      throw new Error(`Project creation failed: ${createError?.message}`)
    }

    const projectData = project as any

    await logAudit({
      action: 'insert',
      entity_type: 'projects',
      entity_id: projectData.id,
      description: `Created project ${name} from template ${templateData.name}`,
      metadata: { templateId, clientId, type },
    })

    return projectData.id
  } catch (err) {
    console.error('[ProjectManager] createProjectFromTemplate failed:', err)
    throw err
  }
}

// ── Phase Updates ───────────────────────────────────────────────────────────

export interface PhaseUpdate {
  status?: PhaseStatus
  checklistItemIndex?: number
  checklist?: ProjectPhase['checklist']
}

/**
 * Update a project phase by index.
 * Can update status, update checklist items, or set started_at/completed_at.
 */
export async function updateProjectPhase(
  projectId: string,
  phaseIndex: number,
  updates: PhaseUpdate,
  userId: string
): Promise<void> {
  try {
    // Fetch project
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (fetchError || !project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    const projectData = project as any
    const phases = (projectData.phases as ProjectPhase[]) || []

    // Validate phase index
    if (phaseIndex < 0 || phaseIndex >= phases.length) {
      throw new Error(`Invalid phase index: ${phaseIndex}`)
    }

    const phase = phases[phaseIndex]

    // Apply updates
    if (updates.status) {
      phase.status = updates.status

      // Set timestamps
      if (updates.status === 'in_progress' && !phase.started_at) {
        phase.started_at = new Date().toISOString()
      }

      if (updates.status === 'completed' && !phase.completed_at) {
        // Verify all checklist items are complete
        const allComplete = phase.checklist.every(item => item.completed)
        if (!allComplete) {
          throw new Error(`Cannot complete phase: unchecked items remain`)
        }
        phase.completed_at = new Date().toISOString()
      }
    }

    if (updates.checklist) {
      phase.checklist = updates.checklist
    }

    // Update project
    const { error: updateError } = await supabase
      .from('projects')
      .update({
        phases: phases as any,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', projectId)

    if (updateError) {
      throw new Error(`Phase update failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'projects',
      entity_id: projectId,
      description: `Updated phase ${phase.name}: ${updates.status || 'checklist modified'}`,
      metadata: { phaseIndex, updatedBy: userId },
    })
  } catch (err) {
    console.error('[ProjectManager] updateProjectPhase failed:', err)
    throw err
  }
}

// ── Checklist Item Completion ───────────────────────────────────────────────

/**
 * Mark a checklist item as complete.
 * Validates that item exists, sets completedBy and completedAt.
 */
export async function completeChecklistItem(
  projectId: string,
  phaseIndex: number,
  checklistIndex: number,
  userId: string
): Promise<void> {
  try {
    // Fetch project
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (fetchError || !project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    const projectData = project as any
    const phases = (projectData.phases as ProjectPhase[]) || []

    // Validate indices
    if (phaseIndex < 0 || phaseIndex >= phases.length) {
      throw new Error(`Invalid phase index: ${phaseIndex}`)
    }

    const phase = phases[phaseIndex]

    if (checklistIndex < 0 || checklistIndex >= phase.checklist.length) {
      throw new Error(`Invalid checklist index: ${checklistIndex}`)
    }

    // Mark item complete
    const item = phase.checklist[checklistIndex]
    item.completed = true
    item.completedBy = userId
    item.completedAt = new Date().toISOString()

    // Update project
    const { error: updateError } = await supabase
      .from('projects')
      .update({
        phases: phases as any,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', projectId)

    if (updateError) {
      throw new Error(`Checklist update failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'projects',
      entity_id: projectId,
      description: `Completed checklist item: ${item.item}`,
      metadata: { phaseIndex, checklistIndex, completedBy: userId },
    })
  } catch (err) {
    console.error('[ProjectManager] completeChecklistItem failed:', err)
    throw err
  }
}

// ── Project Closeout ────────────────────────────────────────────────────────

/**
 * Close out a project and set satisfaction score.
 * Transitions status to 'completed'.
 */
export async function closeoutProject(
  projectId: string,
  notes: string,
  satisfactionScore: number,
  userId: string
): Promise<void> {
  try {
    if (satisfactionScore < 1 || satisfactionScore > 5) {
      throw new Error('Satisfaction score must be between 1 and 5')
    }

    // Fetch project
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (fetchError || !project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    // Update status to completed
    const { error: updateError } = await supabase
      .from('projects')
      .update({
        status: 'completed' as const,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', projectId)

    if (updateError) {
      throw new Error(`Closeout failed: ${updateError.message}`)
    }

    await logAudit({
      action: 'update',
      entity_type: 'projects',
      entity_id: projectId,
      description: `Project closeout: ${notes}`,
      metadata: { satisfactionScore, closedBy: userId },
    })
  } catch (err) {
    console.error('[ProjectManager] closeoutProject failed:', err)
    throw err
  }
}

// ── Project Summary ─────────────────────────────────────────────────────────

/**
 * Get comprehensive project summary with phases, RFIs, change orders, and coordination items.
 */
export async function getProjectSummary(projectId: string): Promise<ProjectSummary> {
  try {
    // Fetch project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()

    if (projectError || !project) {
      throw new Error(`Project not found: ${projectId}`)
    }

    // Fetch RFIs
    const { data: rfis = [] } = await supabase
      .from('rfis')
      .select('*')
      .eq('project_id', projectId)

    // Fetch change orders
    const { data: changeOrders = [] } = await supabase
      .from('change_orders')
      .select('*')
      .eq('project_id', projectId)

    // Fetch coordination items
    const { data: coordItems = [] } = await supabase
      .from('coordination_items')
      .select('*')
      .eq('project_id', projectId)

    // Calculate derived fields
    const projectData = project as any
    const phases = (projectData.phases as ProjectPhase[]) || []
    const createdDate = new Date(projectData.created_at)
    const now = new Date()
    const daysElapsed = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24))

    // Find next milestone (first incomplete phase)
    const nextPhase = phases.find(p => p.status !== 'completed')
    const nextMilestone = nextPhase?.name || null

    // Identify risks
    const risks: string[] = []
    if ((rfis || []).some((r: any) => r.status === 'open' || r.status === 'submitted')) {
      risks.push('Open RFIs pending response')
    }
    if ((changeOrders || []).some((c: any) => c.status === 'draft')) {
      risks.push('Draft change orders not yet submitted')
    }
    if ((coordItems || []).some((c: any) => c.status === 'blocked')) {
      risks.push('Coordination items blocking progress')
    }

    return {
      projectId: projectData.id,
      name: projectData.name,
      status: projectData.status as ProjectStatus,
      phases,
      rfis: (rfis || []).map((r: any) => ({
        rfiNumber: r.rfi_number,
        status: r.status,
        daysUntilDue: r.due_date ? Math.ceil((new Date(r.due_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0,
        costImpact: r.estimated_cost_impact,
      })),
      changeOrders: (changeOrders || []).map((c: any) => ({
        coNumber: c.co_number,
        status: c.status,
        amount: c.amount,
      })),
      coordinationItems: (coordItems || []).map((c: any) => ({
        title: c.title,
        status: c.status,
        category: c.category,
      })),
      estimatedValue: projectData.estimated_value || 0,
      contractValue: projectData.contract_value || 0,
      daysElapsed,
      nextMilestone,
      risks,
    }
  } catch (err) {
    console.error('[ProjectManager] getProjectSummary failed:', err)
    throw err
  }
}
