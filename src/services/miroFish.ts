// @ts-nocheck
/**
 * MiroFish General Verification Chain — 5-step human-in-the-loop approval pipeline.
 *
 * Every high-impact agent action flows through this chain before execution:
 *   Step 1: PROPOSE   — Agent submits action proposal with context
 *   Step 2: NEXUS REVIEW — Automated sanity check (business logic, risk)
 *   Step 3: DOMAIN VERIFY — Domain-specific validation (data freshness, constraints)
 *   Step 4: CHRISTIAN CONFIRMS — Human approval via Proposal Queue UI
 *   Step 5: EXECUTE + LOG — Execute action and log to audit trail
 *
 * Proposals are stored in Supabase `agent_proposals` table with mirofish_step tracking.
 * localStorage mirror under 'mirofish_queue' for offline access.
 *
 * This is the GENERAL service used by all agents. The scout-specific mirofish
 * (src/agents/scout/mirofish.ts) handles scout data-quality verification separately.
 */

import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/memory/audit'
import { publish } from './agentEventBus'
import { autoSnapshot } from './snapshotService'
import { logActivity } from './activityLog'

// ── Types ───────────────────────────────────────────────────────────────────

export type ProposalStatus =
  | 'proposed'      // Step 1 complete — awaiting review
  | 'reviewing'     // Step 2/3 in progress
  | 'confirmed'     // Step 4 complete — human approved
  | 'integrating'   // Step 5 in progress — executing
  | 'completed'     // Step 5 done — action executed
  | 'rejected'      // Failed at any step
  | 'expired'       // 24h timeout reached
  | 'skipped'       // User dismissed
  | 'deferred'      // User postponed — stays in queue

export type ProposalCategory =
  | 'nec_compliance'
  | 'operations'
  | 'safety'
  | 'feature'
  | 'optimization'
  | 'cost_savings'
  | 'financial'
  | 'scheduling'

export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical'

export interface MiroFishProposal {
  id?:              string
  orgId:            string
  proposingAgent:   string           // 'vault' | 'ledger' | 'blueprint' | 'scout' | etc.
  title:            string
  description:      string
  category:         ProposalCategory
  impactLevel:      ImpactLevel
  actionType:       string           // e.g. 'send_invoice', 'approve_estimate', 'modify_template'
  actionPayload:    Record<string, unknown>  // Data needed to execute the action
  sourceData?:      Record<string, unknown>  // Context that triggered the proposal
  status:           ProposalStatus
  mirofishStep:     number           // 0-5 tracking current step
  mirofishLog:      MiroFishStepLog[]
  createdAt:        string
  expiresAt:        string           // 24h from creation
  confirmedBy?:     string
  confirmedAt?:     string
  rejectedReason?:  string
  executedAt?:      string
}

export interface MiroFishStepLog {
  step:      number
  name:      string
  agent:     string
  action:    string
  result:    'pass' | 'fail' | 'skip'
  detail:    string
  timestamp: string
}

export interface MiroFishSubmitInput {
  orgId:           string
  proposingAgent:  string
  title:           string
  description:     string
  category:        ProposalCategory
  impactLevel:     ImpactLevel
  actionType:      string
  actionPayload:   Record<string, unknown>
  sourceData?:     Record<string, unknown>
}

// ── High-impact action registry ─────────────────────────────────────────────

/**
 * Actions that REQUIRE MiroFish approval before execution.
 * Keyed by agent name → set of action types.
 */
export const HIGH_IMPACT_ACTIONS: Record<string, Set<string>> = {
  vault:     new Set(['approve_estimate', 'send_estimate']),
  ledger:    new Set(['send_invoice', 'send_reminder', 'void_invoice']),
  blueprint: new Set(['modify_template', 'compliance_flag', 'approve_change_order']),
  chrono:    new Set(['book_job', 'send_crew_briefing', 'send_client_reminder', 'create_gcal_event']),
  // Phase E: SPARK — review responses and campaign sends require human approval
  spark:     new Set(['post_review_response', 'send_email_campaign']),
}

/**
 * Check if an action requires MiroFish approval.
 */
export function requiresMiroFish(agent: string, actionType: string): boolean {
  return HIGH_IMPACT_ACTIONS[agent]?.has(actionType) ?? false
}

// ── localStorage Mirror ─────────────────────────────────────────────────────

const QUEUE_KEY = 'mirofish_queue'

function getLocalQueue(): MiroFishProposal[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveLocalQueue(queue: MiroFishProposal[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch (err) {
    console.warn('[MiroFish] Failed to save local queue:', err)
  }
}

function upsertLocal(proposal: MiroFishProposal): void {
  const queue = getLocalQueue()
  const idx = queue.findIndex(p => p.id === proposal.id)
  if (idx >= 0) {
    queue[idx] = proposal
  } else {
    queue.push(proposal)
  }
  saveLocalQueue(queue)
}

function removeLocal(proposalId: string): void {
  const queue = getLocalQueue().filter(p => p.id !== proposalId)
  saveLocalQueue(queue)
}

// ── Step 1: PROPOSE ─────────────────────────────────────────────────────────

/**
 * Submit a new proposal into the MiroFish pipeline.
 * Creates the record in Supabase and localStorage, advances to step 1.
 * Returns the proposal with its generated ID.
 */
export async function submitProposal(input: MiroFishSubmitInput): Promise<MiroFishProposal> {
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const stepLog: MiroFishStepLog = {
    step: 1,
    name: 'propose',
    agent: input.proposingAgent,
    action: `Submitted ${input.actionType} proposal`,
    result: 'pass',
    detail: `${input.title} — Impact: ${input.impactLevel}`,
    timestamp: now,
  }

  // Insert into Supabase
  const { data: inserted, error } = await supabase
    .from('agent_proposals')
    .insert({
      org_id:          input.orgId,
      proposing_agent: input.proposingAgent,
      title:           input.title,
      description:     input.description,
      category:        input.category,
      impact_score:    impactToScore(input.impactLevel),
      risk_score:      impactToScore(input.impactLevel),
      source_data:     { ...input.sourceData, actionType: input.actionType, actionPayload: input.actionPayload },
      status:          'proposed',
      mirofish_step:   1,
      mirofish_log:    [stepLog],
    })
    .select('id')
    .single()

  if (error || !inserted) {
    console.error('[MiroFish] Insert failed:', error)
    throw new Error(`MiroFish proposal insert failed: ${error?.message}`)
  }

  const proposal: MiroFishProposal = {
    id:              inserted.id,
    orgId:           input.orgId,
    proposingAgent:  input.proposingAgent,
    title:           input.title,
    description:     input.description,
    category:        input.category,
    impactLevel:     input.impactLevel,
    actionType:      input.actionType,
    actionPayload:   input.actionPayload,
    sourceData:      input.sourceData,
    status:          'proposed',
    mirofishStep:    1,
    mirofishLog:     [stepLog],
    createdAt:       now,
    expiresAt,
  }

  // Mirror to localStorage
  upsertLocal(proposal)

  // Audit log
  await logAudit({
    action: 'insert',
    entity_type: 'agent_proposals',
    entity_id: inserted.id,
    description: `MiroFish proposal submitted: ${input.title} (${input.proposingAgent}/${input.actionType})`,
    metadata: { proposing_agent: input.proposingAgent, action_type: input.actionType, impact: input.impactLevel },
  })

  // Publish event
  publish(
    'DATA_GAP_DETECTED', // Reuse existing event type for proposal notifications
    'mirofish',
    { proposalId: inserted.id, title: input.title, agent: input.proposingAgent, actionType: input.actionType },
    `MiroFish proposal: ${input.title} from ${input.proposingAgent}`
  )

  return proposal
}

// ── Step 2: NEXUS REVIEW ────────────────────────────────────────────────────

/**
 * Automated NEXUS review — sanity check on business logic and risk.
 * Called automatically after submitProposal or manually by NEXUS.
 */
export async function nexusReview(proposalId: string): Promise<{ passed: boolean; detail: string }> {
  const proposal = await getProposal(proposalId)
  if (!proposal) return { passed: false, detail: 'Proposal not found' }

  const now = new Date().toISOString()
  let passed = true
  let detail = ''

  // Check: title and description are substantive
  if (proposal.title.length < 5 || proposal.description.length < 10) {
    passed = false
    detail = 'Proposal too vague — title or description insufficient'
  }

  // Check: action payload has required data
  if (!proposal.actionPayload || Object.keys(proposal.actionPayload).length === 0) {
    passed = false
    detail = 'No action payload — cannot execute without data'
  }

  // Check: not expired
  if (new Date(proposal.expiresAt) < new Date()) {
    passed = false
    detail = 'Proposal expired before NEXUS review'
  }

  if (passed) {
    detail = 'NEXUS review passed — proposal is well-formed and actionable'
  }

  const stepLog: MiroFishStepLog = {
    step: 2,
    name: 'nexus_review',
    agent: 'nexus',
    action: 'Automated sanity check',
    result: passed ? 'pass' : 'fail',
    detail,
    timestamp: now,
  }

  if (passed) {
    await advanceStep(proposalId, 2, 'reviewing', stepLog)
  } else {
    await rejectProposal(proposalId, detail, stepLog)
  }

  return { passed, detail }
}

// ── Step 3: DOMAIN VERIFY ───────────────────────────────────────────────────

/**
 * Domain-specific verification. Checks data freshness and constraints
 * relevant to the proposing agent's domain.
 */
export async function domainVerify(proposalId: string): Promise<{ passed: boolean; detail: string }> {
  const proposal = await getProposal(proposalId)
  if (!proposal) return { passed: false, detail: 'Proposal not found' }

  const now = new Date().toISOString()
  let passed = true
  let detail = ''

  try {
    // Domain-specific checks based on proposing agent
    switch (proposal.proposingAgent) {
      case 'vault': {
        // Verify estimate still exists and is in valid state
        const estimateId = proposal.actionPayload?.estimateId as string
        if (estimateId) {
          const { data: estimate } = await supabase
            .from('estimates')
            .select('id, status')
            .eq('id', estimateId)
            .single()

          if (!estimate) {
            passed = false
            detail = `Referenced estimate ${estimateId} not found`
          } else if (['approved', 'expired'].includes(estimate.status)) {
            passed = false
            detail = `Estimate is already ${estimate.status} — cannot proceed`
          }
        }
        break
      }

      case 'ledger': {
        // Verify invoice exists and is in valid state for the action
        const invoiceId = proposal.actionPayload?.invoiceId as string
        if (invoiceId) {
          const { data: invoice } = await supabase
            .from('invoices')
            .select('id, status, balance_due')
            .eq('id', invoiceId)
            .single()

          if (!invoice) {
            passed = false
            detail = `Referenced invoice ${invoiceId} not found`
          } else if (proposal.actionType === 'send_invoice' && invoice.status !== 'draft') {
            passed = false
            detail = `Invoice is ${invoice.status} — can only send drafts`
          } else if (proposal.actionType === 'void_invoice' && invoice.status === 'paid') {
            passed = false
            detail = 'Cannot void a paid invoice'
          }
        }
        break
      }

      case 'blueprint': {
        // Verify template or project exists
        const templateId = proposal.actionPayload?.templateId as string
        const projectId = proposal.actionPayload?.projectId as string

        if (templateId) {
          const { data: template } = await supabase
            .from('project_templates')
            .select('id')
            .eq('id', templateId)
            .single()

          if (!template) {
            passed = false
            detail = `Referenced template ${templateId} not found`
          }
        }

        if (projectId) {
          const { data: project } = await supabase
            .from('projects')
            .select('id, status')
            .eq('id', projectId)
            .single()

          if (!project) {
            passed = false
            detail = `Referenced project ${projectId} not found`
          }
        }
        break
      }

      default:
        // Generic: pass if payload is non-empty
        detail = 'Domain verification passed (generic check)'
    }

    if (passed && !detail) {
      detail = `Domain verification passed for ${proposal.proposingAgent}/${proposal.actionType}`
    }
  } catch (err) {
    // On DB error, pass with warning rather than blocking
    console.warn('[MiroFish:step3] Domain verify error:', err)
    passed = true
    detail = 'Domain verification passed with warnings (DB query error, passed by default)'
  }

  const stepLog: MiroFishStepLog = {
    step: 3,
    name: 'domain_verify',
    agent: proposal.proposingAgent,
    action: `Domain-specific validation for ${proposal.actionType}`,
    result: passed ? 'pass' : 'fail',
    detail,
    timestamp: now,
  }

  if (passed) {
    await advanceStep(proposalId, 3, 'reviewing', stepLog)
  } else {
    await rejectProposal(proposalId, detail, stepLog)
  }

  return { passed, detail }
}

// ── Step 4: CHRISTIAN CONFIRMS ──────────────────────────────────────────────

/**
 * Record human approval. Called from the Proposal Queue UI.
 */
export async function confirmProposal(
  proposalId: string,
  userId: string
): Promise<{ success: boolean; detail: string }> {
  const proposal = await getProposal(proposalId)
  if (!proposal) return { success: false, detail: 'Proposal not found' }

  if (proposal.status === 'rejected' || proposal.status === 'expired') {
    return { success: false, detail: `Proposal is ${proposal.status} — cannot confirm` }
  }

  const now = new Date().toISOString()

  const stepLog: MiroFishStepLog = {
    step: 4,
    name: 'human_confirm',
    agent: 'human',
    action: 'Owner approved proposal',
    result: 'pass',
    detail: `Confirmed by user ${userId}`,
    timestamp: now,
  }

  // Update in Supabase
  const { error } = await supabase
    .from('agent_proposals')
    .update({
      status:       'confirmed',
      mirofish_step: 4,
      mirofish_log: [...(proposal.mirofishLog || []), stepLog],
      confirmed_by: userId,
      confirmed_at: now,
      updated_at:   now,
    })
    .eq('id', proposalId)

  if (error) {
    console.error('[MiroFish] Confirm update failed:', error)
    return { success: false, detail: `DB update failed: ${error.message}` }
  }

  // Update local mirror
  const updated = { ...proposal, status: 'confirmed' as ProposalStatus, mirofishStep: 4, confirmedBy: userId, confirmedAt: now }
  updated.mirofishLog = [...(updated.mirofishLog || []), stepLog]
  upsertLocal(updated)

  // Audit log
  await logAudit({
    action: 'update',
    entity_type: 'agent_proposals',
    entity_id: proposalId,
    description: `MiroFish proposal confirmed: ${proposal.title}`,
    metadata: { confirmed_by: userId, proposing_agent: proposal.proposingAgent, action_type: proposal.actionType },
  })

  // Pre-approval snapshot (fire-and-forget)
  autoSnapshot('MiroFish', `pre-approval backup — ${proposal.title}`, {})

  // Emit PROPOSAL_APPROVED event for post-approval execution hook
  publish(
    'PROPOSAL_APPROVED' as any,
    'mirofish',
    {
      proposalId,
      title: proposal.title,
      proposingAgent: proposal.proposingAgent,
      actionType: proposal.actionType,
      actionPayload: proposal.actionPayload,
      confirmedBy: userId,
    },
    `MiroFish — proposal approved — ${proposal.title} — ${now}`
  )

  // Activity log (fire-and-forget)
  logActivity({
    agentName:   'MIROFISH',
    actionType:  'proposal_approved',
    entityType:  'proposal',
    entityId:    proposalId,
    entityLabel: proposal.title,
    summary:     `MiroFish approved: "${proposal.title}"`,
    details:     { proposalId, proposingAgent: proposal.proposingAgent, actionType: proposal.actionType },
  })

  return { success: true, detail: 'Proposal confirmed — ready for execution' }
}

/**
 * Record human rejection. Called from the Proposal Queue UI.
 */
export async function rejectByUser(
  proposalId: string,
  userId: string,
  reason: string
): Promise<{ success: boolean }> {
  const proposal = await getProposal(proposalId)
  if (!proposal) return { success: false }

  const stepLog: MiroFishStepLog = {
    step: 4,
    name: 'human_confirm',
    agent: 'human',
    action: 'Owner rejected proposal',
    result: 'fail',
    detail: reason || 'Rejected by owner',
    timestamp: new Date().toISOString(),
  }

  await rejectProposal(proposalId, reason || 'Rejected by owner', stepLog)

  // Audit log
  await logAudit({
    action: 'update',
    entity_type: 'agent_proposals',
    entity_id: proposalId,
    description: `MiroFish proposal rejected by user: ${proposal.title}`,
    metadata: { rejected_by: userId, reason, proposing_agent: proposal.proposingAgent },
  })

  return { success: true }
}

// ── Step 5: EXECUTE + LOG ───────────────────────────────────────────────────

/**
 * Mark proposal as executing (integrating), then completed.
 * The actual execution is done by the caller — this just manages the state.
 * Returns the action payload so the caller can execute.
 */
export async function beginExecution(proposalId: string): Promise<{
  success: boolean
  actionType?: string
  actionPayload?: Record<string, unknown>
  detail: string
}> {
  const proposal = await getProposal(proposalId)
  if (!proposal) return { success: false, detail: 'Proposal not found' }

  if (proposal.status !== 'confirmed') {
    return { success: false, detail: `Proposal is ${proposal.status} — must be confirmed before execution` }
  }

  const now = new Date().toISOString()

  // Mark as integrating
  const stepLog: MiroFishStepLog = {
    step: 5,
    name: 'execute',
    agent: proposal.proposingAgent,
    action: `Executing ${proposal.actionType}`,
    result: 'pass',
    detail: 'Execution started',
    timestamp: now,
  }

  await advanceStep(proposalId, 5, 'integrating', stepLog)

  return {
    success: true,
    actionType: proposal.actionType,
    actionPayload: proposal.actionPayload,
    detail: 'Execution started — call completeExecution when done',
  }
}

/**
 * Mark proposal as completed after successful execution.
 */
export async function completeExecution(proposalId: string, resultSummary?: string): Promise<void> {
  const now = new Date().toISOString()

  const { error } = await supabase
    .from('agent_proposals')
    .update({
      status:       'completed',
      integrated_at: now,
      updated_at:    now,
    })
    .eq('id', proposalId)

  if (error) {
    console.error('[MiroFish] Complete update failed:', error)
  }

  // Update local mirror
  const queue = getLocalQueue()
  const idx = queue.findIndex(p => p.id === proposalId)
  if (idx >= 0) {
    queue[idx].status = 'completed'
    queue[idx].executedAt = now
    saveLocalQueue(queue)
  }

  // Audit log
  await logAudit({
    action: 'update',
    entity_type: 'agent_proposals',
    entity_id: proposalId,
    description: `MiroFish proposal executed: ${resultSummary || 'completed'}`,
    metadata: { executed_at: now, result: resultSummary },
  })
}

// ── Queue Queries ───────────────────────────────────────────────────────────

/**
 * Get all pending proposals (awaiting human confirmation).
 * Returns proposals at step 2+ that are not yet confirmed/rejected/expired.
 */
export async function getPendingProposals(orgId: string): Promise<MiroFishProposal[]> {
  const { data, error } = await supabase
    .from('agent_proposals')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['proposed', 'reviewing', 'deferred'])
    .order('impact_score', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(50)

  if (error || !data) {
    console.warn('[MiroFish] Pending query failed:', error)
    // Fall back to localStorage
    return getLocalQueue().filter(p =>
      p.orgId === orgId && ['proposed', 'reviewing', 'deferred'].includes(p.status)
    )
  }

  return data.map(mapDbToProposal)
}

/**
 * Get confirmed proposals ready for execution.
 */
export async function getConfirmedProposals(orgId: string): Promise<MiroFishProposal[]> {
  const { data, error } = await supabase
    .from('agent_proposals')
    .select('*')
    .eq('org_id', orgId)
    .eq('status', 'confirmed')
    .order('confirmed_at', { ascending: true })
    .limit(20)

  if (error || !data) {
    return getLocalQueue().filter(p => p.orgId === orgId && p.status === 'confirmed')
  }

  return data.map(mapDbToProposal)
}

/**
 * Get count of pending proposals (for topbar badge).
 */
export async function getPendingCount(orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from('agent_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('status', ['proposed', 'reviewing'])

  if (error) {
    return getLocalQueue().filter(p =>
      p.orgId === orgId && ['proposed', 'reviewing'].includes(p.status)
    ).length
  }

  return count ?? 0
}

/**
 * Get recent proposals (all statuses) for audit/history.
 */
export async function getRecentProposals(orgId: string, limit = 20): Promise<MiroFishProposal[]> {
  const { data, error } = await supabase
    .from('agent_proposals')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    return getLocalQueue().filter(p => p.orgId === orgId).slice(0, limit)
  }

  return data.map(mapDbToProposal)
}

// ── Defer ───────────────────────────────────────────────────────────────

/**
 * Defer a proposal — stays in queue but moved to 'deferred' status.
 * Can be re-reviewed later.
 */
export async function deferProposal(
  proposalId: string,
  userId?: string
): Promise<{ success: boolean }> {
  const now = new Date().toISOString()

  const { error } = await supabase
    .from('agent_proposals')
    .update({
      status:      'deferred',
      reviewed_at: now,
      reviewed_by: userId || null,
      updated_at:  now,
    })
    .eq('id', proposalId)

  if (error) {
    console.error('[MiroFish] Defer update failed:', error)
    return { success: false }
  }

  // Update local mirror
  const queue = getLocalQueue()
  const idx = queue.findIndex(p => p.id === proposalId)
  if (idx >= 0) {
    queue[idx].status = 'deferred'
    saveLocalQueue(queue)
  }

  await logAudit({
    action: 'update',
    entity_type: 'agent_proposals',
    entity_id: proposalId,
    description: `MiroFish proposal deferred`,
    metadata: { deferred_by: userId },
  })

  return { success: true }
}

// ── Proposal History ────────────────────────────────────────────────────

/**
 * Get approved + rejected proposals, sorted by most recent.
 * For the collapsible history section in ProposalQueue.
 */
export async function getProposalHistory(orgId: string, limit = 30): Promise<MiroFishProposal[]> {
  const { data, error } = await supabase
    .from('agent_proposals')
    .select('*')
    .eq('org_id', orgId)
    .in('status', ['confirmed', 'completed', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error || !data) {
    console.warn('[MiroFish] History query failed:', error)
    return getLocalQueue()
      .filter(p => p.orgId === orgId && ['confirmed', 'completed', 'rejected'].includes(p.status))
      .slice(0, limit)
  }

  return data.map(mapDbToProposal)
}

// ── Expiry Check ────────────────────────────────────────────────────────────

/**
 * Expire proposals older than 24h that are still pending.
 * Call periodically (e.g., on app mount or every 30 minutes).
 */
export async function expireStaleProposals(orgId: string): Promise<number> {
  const now = new Date().toISOString()

  const { data: stale, error: fetchError } = await supabase
    .from('agent_proposals')
    .select('id, title')
    .eq('org_id', orgId)
    .in('status', ['proposed', 'reviewing'])
    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  if (fetchError || !stale || stale.length === 0) return 0

  const ids = stale.map(s => s.id)

  const { error: updateError } = await supabase
    .from('agent_proposals')
    .update({ status: 'expired', updated_at: now })
    .in('id', ids)

  if (updateError) {
    console.error('[MiroFish] Expiry update failed:', updateError)
    return 0
  }

  // Clean local mirror
  const queue = getLocalQueue()
  for (const id of ids) {
    const idx = queue.findIndex(p => p.id === id)
    if (idx >= 0) queue[idx].status = 'expired'
  }
  saveLocalQueue(queue)

  console.log(`[MiroFish] Expired ${ids.length} stale proposals`)
  return ids.length
}

// ── Run Steps 2+3 Automatically ─────────────────────────────────────────────

/**
 * Run the automated review pipeline (steps 2 + 3) on a proposal.
 * Call after submitProposal to advance through NEXUS review and domain verify.
 * If both pass, the proposal is ready for human confirmation (step 4).
 */
export async function runAutomatedReview(proposalId: string): Promise<{
  passed: boolean
  step: number
  detail: string
}> {
  // Step 2: NEXUS review
  const step2 = await nexusReview(proposalId)
  if (!step2.passed) {
    return { passed: false, step: 2, detail: step2.detail }
  }

  // Step 3: Domain verify
  const step3 = await domainVerify(proposalId)
  if (!step3.passed) {
    return { passed: false, step: 3, detail: step3.detail }
  }

  return { passed: true, step: 3, detail: 'Automated review passed — awaiting human confirmation' }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getProposal(proposalId: string): Promise<MiroFishProposal | null> {
  const { data, error } = await supabase
    .from('agent_proposals')
    .select('*')
    .eq('id', proposalId)
    .single()

  if (error || !data) {
    // Fallback to localStorage
    const local = getLocalQueue().find(p => p.id === proposalId)
    return local ?? null
  }

  return mapDbToProposal(data)
}

async function advanceStep(
  proposalId: string,
  step: number,
  status: ProposalStatus,
  stepLog: MiroFishStepLog
): Promise<void> {
  // Get current log
  const { data: current } = await supabase
    .from('agent_proposals')
    .select('mirofish_log')
    .eq('id', proposalId)
    .single()

  const existingLog = Array.isArray(current?.mirofish_log) ? current.mirofish_log : []

  const { error } = await supabase
    .from('agent_proposals')
    .update({
      mirofish_step: step,
      status,
      mirofish_log: [...existingLog, stepLog],
      updated_at: new Date().toISOString(),
    })
    .eq('id', proposalId)

  if (error) {
    console.error(`[MiroFish] Advance step ${step} failed:`, error)
  }

  // Update local mirror
  const queue = getLocalQueue()
  const idx = queue.findIndex(p => p.id === proposalId)
  if (idx >= 0) {
    queue[idx].mirofishStep = step
    queue[idx].status = status
    queue[idx].mirofishLog = [...(queue[idx].mirofishLog || []), stepLog]
    saveLocalQueue(queue)
  }
}

async function rejectProposal(
  proposalId: string,
  reason: string,
  stepLog: MiroFishStepLog
): Promise<void> {
  const { data: current } = await supabase
    .from('agent_proposals')
    .select('mirofish_log')
    .eq('id', proposalId)
    .single()

  const existingLog = Array.isArray(current?.mirofish_log) ? current.mirofish_log : []

  const { error } = await supabase
    .from('agent_proposals')
    .update({
      status:       'rejected',
      mirofish_step: stepLog.step,
      mirofish_log:  [...existingLog, stepLog],
      updated_at:    new Date().toISOString(),
    })
    .eq('id', proposalId)

  if (error) {
    console.error('[MiroFish] Reject update failed:', error)
  }

  // Update local mirror
  const queue = getLocalQueue()
  const idx = queue.findIndex(p => p.id === proposalId)
  if (idx >= 0) {
    queue[idx].status = 'rejected'
    queue[idx].rejectedReason = reason
    queue[idx].mirofishLog = [...(queue[idx].mirofishLog || []), stepLog]
    saveLocalQueue(queue)
  }
}

function impactToScore(level: ImpactLevel): number {
  switch (level) {
    case 'low':      return 0.25
    case 'medium':   return 0.50
    case 'high':     return 0.75
    case 'critical': return 1.00
    default:         return 0.50
  }
}

function mapDbToProposal(row: any): MiroFishProposal {
  const sourceData = row.source_data ?? {}
  return {
    id:              row.id,
    orgId:           row.org_id,
    proposingAgent:  row.proposing_agent,
    title:           row.title ?? '',
    description:     row.description ?? '',
    category:        row.category ?? 'operations',
    impactLevel:     scoreToImpact(row.impact_score),
    actionType:      sourceData.actionType ?? 'unknown',
    actionPayload:   sourceData.actionPayload ?? {},
    sourceData:      sourceData,
    status:          row.status ?? 'proposed',
    mirofishStep:    row.mirofish_step ?? 0,
    mirofishLog:     Array.isArray(row.mirofish_log) ? row.mirofish_log : [],
    createdAt:       row.created_at ?? '',
    expiresAt:       row.expires_at ?? new Date(new Date(row.created_at).getTime() + 24 * 60 * 60 * 1000).toISOString(),
    confirmedBy:     row.confirmed_by,
    confirmedAt:     row.confirmed_at,
    rejectedReason:  row.rejection_reason,
    executedAt:      row.integrated_at,
  }
}

function scoreToImpact(score: number | null): ImpactLevel {
  if (score === null || score === undefined) return 'medium'
  if (score >= 0.9) return 'critical'
  if (score >= 0.6) return 'high'
  if (score >= 0.35) return 'medium'
  return 'low'
}
