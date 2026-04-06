/**
 * BLUEPRINT Orchestrator — Routes and processes project management requests.
 *
 * Actions:
 * - project: Create, update, or closeout projects
 * - rfi: Create, submit, respond, close RFIs
 * - change_order: Draft, submit, approve change orders
 * - coordination: Create and update coordination items
 * - mto: Query material takeoff status (future implementation)
 * - query: Natural language project queries using Claude API
 *
 * Uses Claude API for NL project queries and analysis.
 */

import { BLUEPRINT_SYSTEM_PROMPT } from './systemPrompt'
export { BLUEPRINT_SYSTEM_PROMPT }

// ── BlueprintAI view helper (sync) ──────────────────────────────────────────
// processBlueprint() is called by views/BlueprintAI.tsx to extract structured
// data from blueprint text. This is a synchronous V3-prototype extraction stub.
// Replace with a real async Claude call during full integration.
export interface BlueprintOutput {
  materials: Array<{ item: string; quantity: string; notes: string }>
  laborItems: Array<{ task: string; hours: number; crew: number }>
  phases: Array<{ name: string; duration: string; sequence: number }>
  flags: string[]
  complianceNotes: string[]
  estimatedDays: number
}

export function processBlueprint(text: string): BlueprintOutput {
  // Stub implementation — parse plain text into structured output.
  // Future: replace with runNexusEngine({ query: text, agentTarget: 'BLUEPRINT' })
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  return {
    materials: lines
      .filter(l => /material|wire|conduit|panel|breaker|receptacle/i.test(l))
      .map(l => ({ item: l.slice(0, 80), quantity: 'TBD', notes: '' })),
    laborItems: lines
      .filter(l => /install|pull|mount|run|connect/i.test(l))
      .map((l, i) => ({ task: l.slice(0, 80), hours: 4, crew: 1 })),
    phases: [
      { name: 'Underground / Rough-in', duration: 'Day 1–7', sequence: 1 },
      { name: 'Inspection', duration: 'Day 8', sequence: 2 },
      { name: 'Trim-out', duration: 'Day 9–11', sequence: 3 },
    ],
    flags: lines
      .filter(l => /nec|code|required|permit|compliance|title 24/i.test(l))
      .map(l => l.slice(0, 120)),
    complianceNotes: lines
      .filter(l => /nec|title 24|permit|occupancy/i.test(l))
      .map(l => l.slice(0, 120)),
    estimatedDays: 11,
  }
}
import * as projectManager from './projectManager'
import * as rfiManager from './rfiManager'
import * as changeOrderManager from './changeOrderManager'
import * as coordinationTracker from './coordinationTracker'
import { requiresMiroFish, submitProposal, runAutomatedReview } from '@/services/miroFish'
import { getLocalProjectContext } from '@/agents/nexus/router'
import { publish as busPublish } from '@/services/agentBus'
import { autoSnapshot } from '@/services/snapshotService'
import { storeEmbedding } from '@/services/embeddingService'
import { analyzeAfterWrite } from '@/services/patternService'
import { logActivity } from '@/services/activityLog'

// ── Phase F: fire-and-forget embedding + pattern learning helper ─────────────
function fireAndForgetMemory(orgId: string, entityType: string, entityId: string, content: string, metadata?: Record<string, unknown>) {
  storeEmbedding(entityType as any, entityId, content, metadata, orgId).catch(() => { /* non-critical */ })
  analyzeAfterWrite(entityType, { ...metadata, id: entityId }, orgId).catch(() => { /* non-critical */ })
}

// ── Types ───────────────────────────────────────────────────────────────────

export type BlueprintAction =
  | 'project_create'
  | 'project_update_phase'
  | 'project_complete_item'
  | 'project_closeout'
  | 'project_summary'
  | 'rfi_create'
  | 'rfi_submit'
  | 'rfi_respond'
  | 'rfi_close'
  | 'change_order_draft'
  | 'change_order_submit'
  | 'change_order_approve'
  | 'change_order_reject'
  | 'coordination_create'
  | 'coordination_update'
  | 'query'

export interface BlueprintRequest {
  action: BlueprintAction
  orgId: string
  userId: string
  payload?: Record<string, unknown>
  userMessage?: string
}

export interface BlueprintResponse {
  success: boolean
  action: BlueprintAction
  data?: unknown
  error?: string
  metadata?: Record<string, unknown>
}

// ── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Process a BLUEPRINT request.
 * Routes to appropriate handler based on action.
 */
export async function processBlueprintRequest(request: BlueprintRequest): Promise<BlueprintResponse> {
  try {
    switch (request.action) {
      // Project actions
      case 'project_create':
        return await handleProjectCreate(request)
      case 'project_update_phase':
        return await handleProjectUpdatePhase(request)
      case 'project_complete_item':
        return await handleProjectCompleteItem(request)
      case 'project_closeout':
        return await handleProjectCloseout(request)
      case 'project_summary':
        return await handleProjectSummary(request)

      // RFI actions
      case 'rfi_create':
        return await handleRFICreate(request)
      case 'rfi_submit':
        return await handleRFISubmit(request)
      case 'rfi_respond':
        return await handleRFIRespond(request)
      case 'rfi_close':
        return await handleRFIClose(request)

      // Change order actions
      case 'change_order_draft':
        return await handleCODraft(request)
      case 'change_order_submit':
        return await handleCOSubmit(request)
      case 'change_order_approve':
        return await miroFishGateBlueprint(request, 'approve_change_order', handleCOApprove)
      case 'change_order_reject':
        return await handleCOReject(request)

      // Coordination actions
      case 'coordination_create':
        return await handleCoordinationCreate(request)
      case 'coordination_update':
        return await handleCoordinationUpdate(request)

      // NL query
      case 'query':
        return await handleQuery(request)

      default:
        return {
          success: false,
          action: request.action,
          error: `Unknown action: ${request.action}`,
        }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[BLUEPRINT] ${request.action} failed:`, err)
    return {
      success: false,
      action: request.action,
      error: errorMessage,
    }
  }
}

// ── Project Handlers ────────────────────────────────────────────────────────

async function handleProjectCreate(req: BlueprintRequest): Promise<BlueprintResponse> {
  const {
    clientId,
    templateId,
    name,
    type,
    address,
  } = (req.payload || {}) as Record<string, any>

  if (!clientId || !templateId || !name || !type || !address) {
    return {
      success: false,
      action: 'project_create',
      error: 'Missing required fields: clientId, templateId, name, type, address',
    }
  }

  try {
    const projectId = await projectManager.createProjectFromTemplate(
      req.orgId,
      clientId,
      templateId,
      name,
      type,
      address,
      req.userId
    )

    // Phase F: store embedding + trigger pattern learning (fire-and-forget)
    fireAndForgetMemory(req.orgId, 'project', String(projectId), `Project: ${name}. Type: ${type}. Address: ${address}.`, {
      project_type: type,
      client_id: clientId,
      template_id: templateId,
    })

    // Auto-snapshot: background save, no UI interrupt
    autoSnapshot('BLUEPRINT', 'project updated', {
      projectId,
      name,
      type,
      address,
      orgId: req.orgId,
    })

    // Activity log (fire-and-forget)
    logActivity({
      agentName:   'BLUEPRINT',
      actionType:  'project_updated',
      entityType:  'project',
      entityId:    String(projectId),
      entityLabel: name,
      summary:     `BLUEPRINT updated project "${name}"`,
      details:     { projectId, name, type, address },
    })

    return {
      success: true,
      action: 'project_create',
      data: { projectId },
      metadata: { name, type },
    }
  } catch (err) {
    return {
      success: false,
      action: 'project_create',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleProjectUpdatePhase(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { projectId, phaseIndex, status } = (req.payload || {}) as Record<string, any>

  if (!projectId || phaseIndex === undefined) {
    return {
      success: false,
      action: 'project_update_phase',
      error: 'Missing required fields: projectId, phaseIndex',
    }
  }

  try {
    await projectManager.updateProjectPhase(
      projectId,
      phaseIndex,
      { status },
      req.userId
    )

    // Route through NEXUS → notify PULSE (dashboard refresh) and CHRONO (schedule impact)
    const phasePayload = { projectId, phaseIndex, status, event: 'project_status_changed' }
    busPublish('BLUEPRINT', 'PULSE',  'data_updated', phasePayload)
    busPublish('BLUEPRINT', 'CHRONO', 'data_updated', phasePayload)

    return {
      success: true,
      action: 'project_update_phase',
      metadata: { projectId, phaseIndex, status },
    }
  } catch (err) {
    return {
      success: false,
      action: 'project_update_phase',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleProjectCompleteItem(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { projectId, phaseIndex, checklistIndex } = (req.payload || {}) as Record<string, any>

  if (!projectId || phaseIndex === undefined || checklistIndex === undefined) {
    return {
      success: false,
      action: 'project_complete_item',
      error: 'Missing required fields: projectId, phaseIndex, checklistIndex',
    }
  }

  try {
    await projectManager.completeChecklistItem(
      projectId,
      phaseIndex,
      checklistIndex,
      req.userId
    )

    return {
      success: true,
      action: 'project_complete_item',
      metadata: { projectId, phaseIndex, checklistIndex },
    }
  } catch (err) {
    return {
      success: false,
      action: 'project_complete_item',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleProjectCloseout(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { projectId, notes, satisfactionScore } = (req.payload || {}) as Record<string, any>

  if (!projectId) {
    return {
      success: false,
      action: 'project_closeout',
      error: 'Missing required field: projectId',
    }
  }

  try {
    await projectManager.closeoutProject(
      projectId,
      notes || '',
      satisfactionScore || 4,
      req.userId
    )

    return {
      success: true,
      action: 'project_closeout',
      metadata: { projectId, satisfactionScore },
    }
  } catch (err) {
    return {
      success: false,
      action: 'project_closeout',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleProjectSummary(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { projectId } = (req.payload || {}) as Record<string, any>

  if (!projectId) {
    return {
      success: false,
      action: 'project_summary',
      error: 'Missing required field: projectId',
    }
  }

  try {
    const summary = await projectManager.getProjectSummary(projectId)

    return {
      success: true,
      action: 'project_summary',
      data: summary,
    }
  } catch (err) {
    return {
      success: false,
      action: 'project_summary',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── RFI Handlers ────────────────────────────────────────────────────────────

async function handleRFICreate(req: BlueprintRequest): Promise<BlueprintResponse> {
  const {
    projectId,
    question,
    requestedFrom,
    category,
    dueDate,
    costImpact,
    daysImpact,
  } = (req.payload || {}) as Record<string, any>

  if (!projectId || !question || !requestedFrom || !category) {
    return {
      success: false,
      action: 'rfi_create',
      error: 'Missing required fields: projectId, question, requestedFrom, category',
    }
  }

  try {
    const rfiId = await rfiManager.createRFI(
      req.orgId,
      projectId,
      question,
      requestedFrom,
      category,
      dueDate || null,
      costImpact,
      daysImpact,
      req.userId
    )

    return {
      success: true,
      action: 'rfi_create',
      data: { rfiId },
      metadata: { projectId, category },
    }
  } catch (err) {
    return {
      success: false,
      action: 'rfi_create',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleRFISubmit(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { rfiId } = (req.payload || {}) as Record<string, any>

  if (!rfiId) {
    return {
      success: false,
      action: 'rfi_submit',
      error: 'Missing required field: rfiId',
    }
  }

  try {
    await rfiManager.submitRFI(rfiId, req.userId)

    return {
      success: true,
      action: 'rfi_submit',
      metadata: { rfiId },
    }
  } catch (err) {
    return {
      success: false,
      action: 'rfi_submit',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleRFIRespond(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { rfiId, response, linkToCO } = (req.payload || {}) as Record<string, any>

  if (!rfiId || !response) {
    return {
      success: false,
      action: 'rfi_respond',
      error: 'Missing required fields: rfiId, response',
    }
  }

  try {
    await rfiManager.respondToRFI(rfiId, response, linkToCO || false, req.userId)

    return {
      success: true,
      action: 'rfi_respond',
      metadata: { rfiId, linkedToCO: linkToCO },
    }
  } catch (err) {
    return {
      success: false,
      action: 'rfi_respond',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleRFIClose(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { rfiId } = (req.payload || {}) as Record<string, any>

  if (!rfiId) {
    return {
      success: false,
      action: 'rfi_close',
      error: 'Missing required field: rfiId',
    }
  }

  try {
    await rfiManager.closeRFI(rfiId, req.userId)

    return {
      success: true,
      action: 'rfi_close',
      metadata: { rfiId },
    }
  } catch (err) {
    return {
      success: false,
      action: 'rfi_close',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Change Order Handlers ───────────────────────────────────────────────────

async function handleCODraft(req: BlueprintRequest): Promise<BlueprintResponse> {
  const {
    projectId,
    description,
    amount,
    reason,
    rfiId,
    laborHours,
    materialCost,
  } = (req.payload || {}) as Record<string, any>

  if (!projectId || !description || !amount || !reason) {
    return {
      success: false,
      action: 'change_order_draft',
      error: 'Missing required fields: projectId, description, amount, reason',
    }
  }

  try {
    const coId = await changeOrderManager.draftChangeOrder(
      req.orgId,
      projectId,
      description,
      amount,
      reason,
      rfiId,
      laborHours,
      materialCost,
      req.userId
    )

    return {
      success: true,
      action: 'change_order_draft',
      data: { coId },
      metadata: { projectId, amount },
    }
  } catch (err) {
    return {
      success: false,
      action: 'change_order_draft',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleCOSubmit(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { coId } = (req.payload || {}) as Record<string, any>

  if (!coId) {
    return {
      success: false,
      action: 'change_order_submit',
      error: 'Missing required field: coId',
    }
  }

  try {
    await changeOrderManager.submitChangeOrder(coId, req.userId)

    return {
      success: true,
      action: 'change_order_submit',
      metadata: { coId },
    }
  } catch (err) {
    return {
      success: false,
      action: 'change_order_submit',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleCOApprove(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { coId } = (req.payload || {}) as Record<string, any>

  if (!coId) {
    return {
      success: false,
      action: 'change_order_approve',
      error: 'Missing required field: coId',
    }
  }

  try {
    await changeOrderManager.approveChangeOrder(coId, req.userId)

    return {
      success: true,
      action: 'change_order_approve',
      metadata: { coId },
    }
  } catch (err) {
    return {
      success: false,
      action: 'change_order_approve',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleCOReject(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { coId, reason } = (req.payload || {}) as Record<string, any>

  if (!coId || !reason) {
    return {
      success: false,
      action: 'change_order_reject',
      error: 'Missing required fields: coId, reason',
    }
  }

  try {
    await changeOrderManager.rejectChangeOrder(coId, reason, req.userId)

    return {
      success: true,
      action: 'change_order_reject',
      metadata: { coId },
    }
  } catch (err) {
    return {
      success: false,
      action: 'change_order_reject',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Coordination Handlers ───────────────────────────────────────────────────

async function handleCoordinationCreate(req: BlueprintRequest): Promise<BlueprintResponse> {
  const {
    projectId,
    category,
    description,
    dueDate,
    blocksPhase,
    assignedTo,
  } = (req.payload || {}) as Record<string, any>

  if (!projectId || !category || !description) {
    return {
      success: false,
      action: 'coordination_create',
      error: 'Missing required fields: projectId, category, description',
    }
  }

  try {
    const itemId = await coordinationTracker.createCoordinationItem(
      req.orgId,
      projectId,
      category,
      description,
      dueDate || null,
      blocksPhase,
      assignedTo,
      req.userId
    )

    return {
      success: true,
      action: 'coordination_create',
      data: { itemId },
      metadata: { projectId, category },
    }
  } catch (err) {
    return {
      success: false,
      action: 'coordination_create',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function handleCoordinationUpdate(req: BlueprintRequest): Promise<BlueprintResponse> {
  const { itemId, status, findings, notes } = (req.payload || {}) as Record<string, any>

  if (!itemId || !status) {
    return {
      success: false,
      action: 'coordination_update',
      error: 'Missing required fields: itemId, status',
    }
  }

  try {
    await coordinationTracker.updateCoordinationStatus(
      itemId,
      status,
      findings,
      notes,
      req.userId
    )

    return {
      success: true,
      action: 'coordination_update',
      metadata: { itemId, status },
    }
  } catch (err) {
    return {
      success: false,
      action: 'coordination_update',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Natural Language Query Handler ──────────────────────────────────────────

// ── MiroFish Gate ───────────────────────────────────────────────────────────

/**
 * MiroFish gate for high-impact BLUEPRINT actions.
 * Submits a proposal for approval before executing change order approvals, etc.
 */
async function miroFishGateBlueprint(
  request: BlueprintRequest,
  actionType: string,
  handler: (req: BlueprintRequest) => Promise<BlueprintResponse>
): Promise<BlueprintResponse> {
  // Allow bypass for post-approval execution
  if (request.payload?.skipMiroFish) {
    return handler(request)
  }

  if (!requiresMiroFish('blueprint', actionType)) {
    return handler(request)
  }

  try {
    const coId = request.payload?.coId as string | undefined
    const projectId = request.payload?.projectId as string | undefined

    const proposal = await submitProposal({
      orgId:          request.orgId,
      proposingAgent: 'blueprint',
      title:          `Approve Change Order ${coId ?? ''}`,
      description:    `BLUEPRINT requests to approve change order ${coId ?? 'unknown'}${projectId ? ` for project ${projectId}` : ''}. This will update the project budget and scope.`,
      category:       'operations',
      impactLevel:    'high',
      actionType,
      actionPayload:  { coId, projectId, ...request.payload },
      sourceData:     { coId, projectId },
    })

    // Run automated steps 2+3
    await runAutomatedReview(proposal.id!)

    return {
      success: true,
      action: request.action,
      data: { proposalId: proposal.id, requiresApproval: true },
      metadata: { mirofish: true },
    }
  } catch (err) {
    console.error('[BLUEPRINT] MiroFish gate error:', err)
    return handler(request)
  }
}

// ── Natural Language Query Handler ──────────────────────────────────────────

async function handleQuery(req: BlueprintRequest): Promise<BlueprintResponse> {
  if (!req.userMessage) {
    return {
      success: false,
      action: 'query',
      error: 'No query provided',
    }
  }

  try {
    // Get Anthropic key from environment

    // Inject local project context (status buckets + financials from device state)
    const localProjectCtx = getLocalProjectContext()
    const systemWithContext = localProjectCtx
      ? `${BLUEPRINT_SYSTEM_PROMPT}\n\n---\n\n## Live Project Context (from device state)\n${localProjectCtx}`
      : BLUEPRINT_SYSTEM_PROMPT

    const response = await fetch('/.netlify/functions/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemWithContext,
        messages: [
          {
            role: 'user',
            content: `${req.userMessage}\n\nRespond with actionable insights about the project status, risks, and recommendations.`,
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.statusText}`)
    }

    const data = await response.json()
    const content = (data.content?.[0]?.text ?? '') as string

    return {
      success: true,
      action: 'query',
      data: { analysis: content },
    }
  } catch (err) {
    return {
      success: false,
      action: 'query',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
