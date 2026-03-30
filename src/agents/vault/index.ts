// @ts-nocheck
/**
 * VAULT Orchestrator — Main entry point for the Estimating Agent.
 *
 * Pipeline: classify action → execute (create, analyze_margin, find_similar, send, expire_check)
 *
 * Actions:
 * - create: Parse description → buildEstimateLineItems → calculateTotals → insert → audit
 * - analyze_margin: analyzeEstimateMargin → generateInsights
 * - find_similar: findSimilarEstimates
 * - send: update status to 'sent', record sent_at
 * - expire_check: find estimates expiring within 24h
 */

import { VAULT_SYSTEM_PROMPT } from './systemPrompt'
import {
  buildEstimateLineItems,
  calculateEstimateTotals,
  findSimilarEstimates,
  generateEstimateNumber,
  type EstimateLineItem,
} from './estimateBuilder'
import { analyzeEstimateMargin as analyzeMarginInsights } from './marginAnalyzer'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'
import { publish } from '@/services/agentEventBus'
import { requiresMiroFish, submitProposal, runAutomatedReview } from '@/services/miroFish'
import { publish as busPublish } from '@/services/agentBus'
import { autoSnapshot } from '@/services/snapshotService'
import { storeEmbedding } from '@/services/embeddingService'
import { analyzeAfterWrite } from '@/services/patternService'

// ── Phase F: fire-and-forget embedding + pattern learning helper ─────────────
function fireAndForgetMemory(orgId: string, entityType: string, entityId: string, content: string, metadata?: Record<string, unknown>) {
  storeEmbedding(entityType as any, entityId, content, metadata, orgId).catch(() => { /* non-critical */ })
  analyzeAfterWrite(entityType, { ...metadata, id: entityId }, orgId).catch(() => { /* non-critical */ })
}

// ── Types ───────────────────────────────────────────────────────────────────

export type VaultAction = 'create' | 'analyze_margin' | 'find_similar' | 'send' | 'expire_check' | 'approve'

export interface VaultRequest {
  action: VaultAction
  orgId: string
  userId?: string
  estimateId?: string
  projectDescription?: string
  projectId?: string
  clientId?: string
  lineItems?: any[]
  wasteFactorOverride?: number
}

export interface VaultResponse {
  success: boolean
  message: string
  data?: any
  estimateId?: string
  requiresConfirmation?: boolean
}

// ── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Process a VAULT request.
 * Handles estimate creation, analysis, and management.
 */
export async function processVaultRequest(request: VaultRequest): Promise<VaultResponse> {
  try {
    switch (request.action) {
      case 'create':
        return await handleCreateEstimate(request)

      case 'analyze_margin':
        return await handleAnalyzeMargin(request)

      case 'find_similar':
        return await handleFindSimilar(request)

      case 'send':
        return await miroFishGateVault(request, 'send_estimate', handleSendEstimate)

      case 'expire_check':
        return await handleExpireCheck(request)

      case 'approve':
        return await miroFishGateVault(request, 'approve_estimate', handleApproveEstimate)

      default:
        return {
          success: false,
          message: `Unknown action: ${request.action}`,
        }
    }
  } catch (err) {
    console.error('[VAULT] Request processing error:', err)
    return {
      success: false,
      message: `Error processing request: ${String(err).slice(0, 200)}`,
    }
  }
}

// ── Action Handlers ─────────────────────────────────────────────────────────

/**
 * Create a new estimate from project description and line items.
 */
async function handleCreateEstimate(request: VaultRequest): Promise<VaultResponse> {
  if (!request.projectDescription || !request.lineItems?.length) {
    return {
      success: false,
      message: 'Project description and line items required',
    }
  }

  try {
    // Build line items (lookup in price book, apply waste factors)
    const lineItems = await buildEstimateLineItems(
      request.lineItems,
      request.orgId,
      request.wasteFactorOverride
    )

    // Calculate totals
    const totals = calculateEstimateTotals(lineItems)

    // Generate estimate number
    const estimateNumber = generateEstimateNumber()

    // Verify client if provided
    if (request.clientId) {
      const { data: client } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', request.clientId)
        .eq('org_id', request.orgId)
        .single()

      if (!client) {
        return {
          success: false,
          message: `Client ${request.clientId} not found`,
        }
      }
    }

    // Insert estimate
    const estimateData: any = {
      org_id: request.orgId,
      estimate_number: estimateNumber,
      status: 'draft',
      client_id: request.clientId || null,
      project_id: request.projectId || null,
      line_items: lineItems,
      subtotal: totals.subtotal,
      tax_rate: 0.0825,
      tax_amount: totals.tax,
      total: totals.total,
      balance_due: totals.total,
      margin_pct: totals.marginPct,
      valid_until: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      notes: request.projectDescription.slice(0, 500),
      created_by: request.userId || null,
    }

    const { data: inserted, error } = await supabase
      .from('estimates')
      .insert(estimateData)
      .select('id, estimate_number, total, margin_pct')
      .single()

    if (error) {
      console.error('[VAULT] Insert error:', error)
      return {
        success: false,
        message: `Failed to create estimate: ${error.message}`,
      }
    }

    // Audit log
    await logAudit({
      action: 'insert',
      entity_type: 'estimates',
      entity_id: inserted.id,
      description: `VAULT created estimate ${estimateNumber}: ${lineItems.length} line items, $${totals.total.toFixed(2)}, ${totals.marginPct.toFixed(1)}% margin`,
      metadata: {
        estimate_number: estimateNumber,
        line_items_count: lineItems.length,
        total: totals.total,
        margin_pct: totals.marginPct,
      },
    })

    // Publish event
    publish(
      'ESTIMATE_CREATED',
      'vault',
      { estimateId: inserted.id, estimateNumber, total: totals.total, marginPct: totals.marginPct, lineItems: lineItems.length },
      `Estimate ${estimateNumber} created: $${totals.total.toFixed(2)}, ${totals.marginPct.toFixed(1)}% margin, ${lineItems.length} items`
    )

    // Phase F: store embedding + trigger pattern learning (fire-and-forget)
    const estimateContent = `Estimate ${estimateNumber}: ${request.projectDescription?.slice(0, 400) || ''}. ${lineItems.length} line items. Total: $${totals.total.toFixed(2)}. Margin: ${totals.marginPct.toFixed(1)}%. Items: ${lineItems.slice(0, 5).map((li: any) => li.description || li.name || '').filter(Boolean).join(', ')}`
    fireAndForgetMemory(request.orgId, 'estimate', inserted.id, estimateContent, {
      estimate_number: estimateNumber,
      total: totals.total,
      margin_pct: totals.marginPct,
      line_items_count: lineItems.length,
      project_id: request.projectId,
    })

    // Auto-snapshot: background save, no UI interrupt
    autoSnapshot('VAULT', 'estimate saved', {
      estimateId: inserted.id,
      estimateNumber,
      total: totals.total,
      marginPct: totals.marginPct,
      lineItemsCount: lineItems.length,
      orgId: request.orgId,
    })

    return {
      success: true,
      message: `Estimate ${estimateNumber} created successfully`,
      estimateId: inserted.id,
      data: {
        estimateNumber: inserted.estimate_number,
        total: inserted.total,
        marginPct: inserted.margin_pct,
        lineItems: lineItems.length,
      },
      requiresConfirmation: false,
    }
  } catch (err) {
    console.error('[VAULT] Create estimate error:', err)
    return {
      success: false,
      message: `Error creating estimate: ${String(err).slice(0, 200)}`,
    }
  }
}

/**
 * Analyze margin performance for an estimate.
 */
async function handleAnalyzeMargin(request: VaultRequest): Promise<VaultResponse> {
  if (!request.estimateId) {
    return {
      success: false,
      message: 'Estimate ID required for margin analysis',
    }
  }

  try {
    const analysis = await analyzeMarginInsights(request.estimateId, request.orgId)

    // Audit log
    await logAudit({
      action: 'view',
      entity_type: 'estimates',
      entity_id: request.estimateId,
      description: `VAULT analyzed margin for estimate ${request.estimateId}`,
      metadata: {
        analysis_summary: analysis.summary,
        insights_count: analysis.insights.length,
      },
    })

    return {
      success: true,
      message: 'Margin analysis complete',
      estimateId: request.estimateId,
      data: {
        ...analysis,
      },
    }
  } catch (err) {
    console.error('[VAULT] Margin analysis error:', err)
    return {
      success: false,
      message: `Error analyzing margin: ${String(err).slice(0, 200)}`,
    }
  }
}

/**
 * Find similar past estimates by description.
 */
async function handleFindSimilar(request: VaultRequest): Promise<VaultResponse> {
  if (!request.projectDescription) {
    return {
      success: false,
      message: 'Project description required for similarity search',
    }
  }

  try {
    const similar = await findSimilarEstimates(
      request.projectDescription,
      request.orgId,
      5
    )

    // Audit log
    await logAudit({
      action: 'view',
      entity_type: 'estimates',
      description: `VAULT searched for similar estimates: "${request.projectDescription.slice(0, 100)}"`,
      metadata: {
        search_query: request.projectDescription.slice(0, 200),
        results_count: similar.length,
      },
    })

    return {
      success: true,
      message: `Found ${similar.length} similar estimates`,
      data: {
        similar,
      },
    }
  } catch (err) {
    console.error('[VAULT] Find similar error:', err)
    return {
      success: false,
      message: `Error searching similar estimates: ${String(err).slice(0, 200)}`,
    }
  }
}

/**
 * Send an estimate to the client.
 */
async function handleSendEstimate(request: VaultRequest): Promise<VaultResponse> {
  if (!request.estimateId) {
    return {
      success: false,
      message: 'Estimate ID required',
    }
  }

  try {
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('estimates')
      .update({
        status: 'sent',
        sent_at: now,
        updated_at: now,
      })
      .eq('id', request.estimateId)
      .eq('org_id', request.orgId)

    if (error) {
      return {
        success: false,
        message: `Failed to send estimate: ${error.message}`,
      }
    }

    // Audit log
    await logAudit({
      action: 'send',
      entity_type: 'estimates',
      entity_id: request.estimateId,
      description: `VAULT sent estimate to client`,
      metadata: {
        sent_at: now,
      },
    })

    return {
      success: true,
      message: 'Estimate sent to client',
      estimateId: request.estimateId,
    }
  } catch (err) {
    console.error('[VAULT] Send estimate error:', err)
    return {
      success: false,
      message: `Error sending estimate: ${String(err).slice(0, 200)}`,
    }
  }
}

/**
 * Check for estimates expiring within 24 hours.
 */
async function handleExpireCheck(request: VaultRequest): Promise<VaultResponse> {
  try {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]

    const { data: expiring, error } = await supabase
      .from('estimates')
      .select('id, estimate_number, client_id, total, valid_until')
      .eq('org_id', request.orgId)
      .in('status', ['draft', 'sent'])
      .gte('valid_until', today)
      .lte('valid_until', tomorrow)
      .order('valid_until', { ascending: true })

    if (error) {
      console.error('[VAULT] Expire check error:', error)
      return {
        success: false,
        message: `Error checking expiring estimates: ${error.message}`,
      }
    }

    // Audit log if any found
    if (expiring && expiring.length > 0) {
      await logAudit({
        action: 'view',
        entity_type: 'estimates',
        description: `VAULT found ${expiring.length} estimates expiring within 24 hours`,
        metadata: {
          expiring_count: expiring.length,
          estimate_numbers: expiring.map((e: any) => e.estimate_number),
        },
      })
    }

    return {
      success: true,
      message: `${expiring?.length ?? 0} estimates expiring within 24 hours`,
      data: {
        expiringCount: expiring?.length ?? 0,
        expiring: expiring ?? [],
      },
    }
  } catch (err) {
    console.error('[VAULT] Expire check error:', err)
    return {
      success: false,
      message: `Error checking expirations: ${String(err).slice(0, 200)}`,
    }
  }
}

// ── Approve Estimate Handler ──────────────────────────────────────────────

/**
 * Approve an estimate. Transitions status to 'approved' and publishes
 * ESTIMATE_APPROVED event, which LEDGER subscribes to for invoice creation.
 */
async function handleApproveEstimate(request: VaultRequest): Promise<VaultResponse> {
  if (!request.estimateId) {
    return { success: false, message: 'Estimate ID required' }
  }

  try {
    const now = new Date().toISOString()

    // Get estimate details before update
    const { data: estimate, error: fetchError } = await supabase
      .from('estimates')
      .select('id, estimate_number, total, client_id, project_id, org_id')
      .eq('id', request.estimateId)
      .single()

    if (fetchError || !estimate) {
      return { success: false, message: `Estimate not found: ${request.estimateId}` }
    }

    // Update status to approved
    const { error } = await supabase
      .from('estimates')
      .update({
        status: 'approved',
        approved_at: now,
        updated_at: now,
      })
      .eq('id', request.estimateId)
      .eq('org_id', request.orgId)

    if (error) {
      return { success: false, message: `Failed to approve estimate: ${error.message}` }
    }

    // Audit log
    await logAudit({
      action: 'update',
      entity_type: 'estimates',
      entity_id: request.estimateId,
      description: `VAULT approved estimate ${estimate.estimate_number}: $${estimate.total}`,
      metadata: { estimate_number: estimate.estimate_number, total: estimate.total },
    })

    // Publish ESTIMATE_APPROVED event — LEDGER subscribes to this for auto-invoice
    publish(
      'ESTIMATE_APPROVED',
      'vault',
      {
        estimateId: estimate.id,
        estimateNumber: estimate.estimate_number,
        total: estimate.total,
        clientId: estimate.client_id,
        projectId: estimate.project_id,
        orgId: estimate.org_id,
      },
      `Estimate ${estimate.estimate_number} approved: $${(estimate.total || 0).toLocaleString()}`
    )

    // Route through NEXUS → notify BLUEPRINT (project cost updated) and LEDGER (create invoice)
    const estimatePayload = {
      estimateId: estimate.id,
      estimateNumber: estimate.estimate_number,
      total: estimate.total,
      clientId: estimate.client_id,
      projectId: estimate.project_id,
      orgId: estimate.org_id,
    }
    busPublish('VAULT', 'BLUEPRINT', 'data_updated', { ...estimatePayload, event: 'estimate_finalized' })
    busPublish('VAULT', 'LEDGER',    'data_updated', { ...estimatePayload, event: 'estimate_finalized' })

    return {
      success: true,
      message: `Estimate ${estimate.estimate_number} approved. LEDGER will create an invoice automatically.`,
      estimateId: request.estimateId,
      data: {
        estimateNumber: estimate.estimate_number,
        total: estimate.total,
        invoicePending: true,
      },
    }
  } catch (err) {
    console.error('[VAULT] Approve estimate error:', err)
    return { success: false, message: `Error approving estimate: ${String(err).slice(0, 200)}` }
  }
}

// ── MiroFish Gate ───────────────────────────────────────────────────────────

/**
 * MiroFish gate for high-impact VAULT actions.
 * If the action requires approval, submits a proposal instead of executing.
 * If skipMiroFish is set in payload, executes directly (for post-approval execution).
 */
async function miroFishGateVault(
  request: VaultRequest,
  actionType: string,
  handler: (req: VaultRequest) => Promise<VaultResponse>
): Promise<VaultResponse> {
  // Allow bypass for post-approval execution
  if (request.payload?.skipMiroFish) {
    return handler(request)
  }

  // Check if this action requires MiroFish
  if (!requiresMiroFish('vault', actionType)) {
    return handler(request)
  }

  try {
    const proposal = await submitProposal({
      orgId:          request.orgId,
      proposingAgent: 'vault',
      title:          `${actionType === 'approve_estimate' ? 'Approve' : 'Send'} Estimate ${request.estimateId ?? ''}`,
      description:    `VAULT requests to ${actionType.replace('_', ' ')} for estimate ${request.estimateId ?? 'unknown'}`,
      category:       'financial',
      impactLevel:    'high',
      actionType,
      actionPayload:  { estimateId: request.estimateId, ...request.payload },
      sourceData:     { estimateId: request.estimateId },
    })

    // Run automated steps 2+3
    await runAutomatedReview(proposal.id!)

    return {
      success: true,
      message: `Proposal submitted for approval: ${proposal.title}. Awaiting confirmation in Proposal Queue.`,
      data: { proposalId: proposal.id, requiresApproval: true },
      requiresConfirmation: true,
    }
  } catch (err) {
    console.error('[VAULT] MiroFish gate error:', err)
    // On MiroFish failure, fall through to direct execution
    return handler(request)
  }
}

// ── Re-exports ──────────────────────────────────────────────────────────────

export { VAULT_SYSTEM_PROMPT }
export type { EstimateLineItem } from './estimateBuilder'
