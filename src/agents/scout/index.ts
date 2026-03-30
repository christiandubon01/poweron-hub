// @ts-nocheck
/**
 * SCOUT Orchestrator — runs the full analysis pipeline.
 *
 * Pipeline: gatherData → analyze → MiroFish verify → insert proposals → audit
 *
 * SCOUT runs on demand (scheduled cron comes in a later phase).
 * Every proposal passes through the 5-step MiroFish verification chain.
 * Only proposals that pass all 5 steps get status='proposed'.
 */

import { gatherScoutData, type ScoutDataSnapshot } from './dataGatherer'
import { analyzeData, type RawProposal } from './analyzer'
import { verifyProposal, type MiroFishResult } from './mirofish'
import { analyzeIdea, type IdeaAnalysis, type IntegrationOption } from './ideaAnalyzer'
import { logAudit } from '@/lib/memory/audit'
import { supabase } from '@/lib/supabase'
import { storeEmbedding } from '@/services/embeddingService'
import { analyzeAfterWrite } from '@/services/patternService'
import { logActivity } from '@/services/activityLog'

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScoutRunResult {
  runId:            string
  startedAt:        string
  completedAt:      string
  durationMs:       number
  snapshot:         ScoutDataSnapshot
  rawProposals:     RawProposal[]
  verifiedCount:    number
  rejectedCount:    number
  proposalIds:      string[]
  rejections:       Array<{ title: string; reason: string }>
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Run a full SCOUT analysis cycle.
 * Call this on demand to trigger pattern detection and proposal generation.
 */
export async function runScoutAnalysis(orgId: string): Promise<ScoutRunResult> {
  const runId     = crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const startMs   = Date.now()

  // ── Step 1: Gather data ───────────────────────────────────────────────
  console.log('[SCOUT] Gathering data...')
  const snapshot = await gatherScoutData(orgId)

  // ── Step 2: Analyze with Claude ───────────────────────────────────────
  console.log('[SCOUT] Analyzing patterns...')
  const rawProposals = await analyzeData(snapshot)
  console.log(`[SCOUT] ${rawProposals.length} raw proposals generated`)

  // ── Step 3: MiroFish verification ─────────────────────────────────────
  console.log('[SCOUT] Running MiroFish verification...')
  const proposalIds:  string[] = []
  const rejections:   Array<{ title: string; reason: string }> = []

  for (const proposal of rawProposals) {
    const verification = await verifyProposal(proposal, orgId)

    if (verification.passed) {
      // Insert as 'proposed' — passed all 5 MiroFish steps
      const id = await insertProposal(orgId, proposal, verification)
      if (id) proposalIds.push(id)
    } else {
      // Insert as 'rejected' with reason
      await insertRejectedProposal(orgId, proposal, verification)
      rejections.push({
        title:  proposal.title,
        reason: verification.rejectionReason ?? 'Unknown',
      })
    }
  }

  const completedAt = new Date().toISOString()
  const durationMs  = Date.now() - startMs

  console.log(`[SCOUT] Complete: ${proposalIds.length} proposed, ${rejections.length} rejected (${durationMs}ms)`)

  // Phase F: embed verified proposals into vector memory (fire-and-forget)
  for (const proposal of rawProposals) {
    const content = `SCOUT finding: ${proposal.title}. ${proposal.description?.slice(0, 300) || ''}. Category: ${proposal.category || 'general'}. Impact: ${proposal.impact_score}/10.`
    const embeddingId = `scout_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    storeEmbedding('scout_finding' as any, embeddingId, content, {
      title: proposal.title,
      category: proposal.category,
      impact_score: proposal.impact_score,
    }, orgId).catch(() => { /* non-critical */ })
    analyzeAfterWrite('scout_finding', {
      finding: proposal.title,
      description: proposal.description,
      finding_type: proposal.category,
    }, orgId).catch(() => { /* non-critical */ })
  }

  // ── Step 4: Audit trail ───────────────────────────────────────────────
  try {
    await logAudit({
      action:      'insert',
      entity_type: 'agent_proposals',
      description: `SCOUT analysis run: ${rawProposals.length} proposals generated, ${proposalIds.length} passed MiroFish, ${rejections.length} rejected (${durationMs}ms)`,
      metadata: {
        run_id:         runId,
        raw_count:      rawProposals.length,
        proposed_count: proposalIds.length,
        rejected_count: rejections.length,
        duration_ms:    durationMs,
        proposal_ids:   proposalIds,
        rejections:     rejections.map(r => ({ title: r.title, reason: r.reason })),
      },
    })
  } catch (err) {
    console.warn('[SCOUT] Audit log failed:', err)
  }

  return {
    runId,
    startedAt,
    completedAt,
    durationMs,
    snapshot,
    rawProposals,
    verifiedCount:  proposalIds.length,
    rejectedCount:  rejections.length,
    proposalIds,
    rejections,
  }
}


// ── DB Helpers ──────────────────────────────────────────────────────────────

/**
 * Insert a verified proposal into agent_proposals with status='proposed'.
 */
async function insertProposal(
  orgId:        string,
  proposal:     RawProposal,
  verification: MiroFishResult
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('agent_proposals')
      .insert({
        org_id:          orgId,
        proposing_agent: 'scout',
        title:           proposal.title,
        description:     proposal.description,
        category:        proposal.category,
        source_data:     proposal.source_data,
        impact_score:    proposal.impact_score / 10,  // DB stores 0-1 NUMERIC(3,2)
        risk_score:      proposal.risk_score / 10,    // DB stores 0-1 NUMERIC(3,2)
        status:          'proposed',
        mirofish_step:   5,
        mirofish_log:    verification.log,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[SCOUT] Proposal insert failed:', error.message)
      return null
    }

    // Audit the individual proposal insert
    try {
      await logAudit({
        action:      'insert',
        entity_type: 'agent_proposals',
        entity_id:   data?.id as string,
        description: `SCOUT proposal created: "${proposal.title}" (impact: ${proposal.impact_score}, risk: ${proposal.risk_score}, confidence: ${verification.confidenceScore})`,
        metadata: {
          category:         proposal.category,
          impact_score:     proposal.impact_score,
          risk_score:       proposal.risk_score,
          confidence_score: verification.confidenceScore,
        },
      })
    } catch {
      // Non-critical
    }

    // Activity log (fire-and-forget)
    const impactLevel = proposal.impact_score >= 7 ? 'high' : proposal.impact_score >= 4 ? 'medium' : 'low'
    logActivity({
      agentName:   'SCOUT',
      actionType:  'gap_detected',
      entityType:  'proposal',
      entityId:    data?.id as string | undefined,
      entityLabel: proposal.title,
      summary:     `SCOUT flagged: ${proposal.title} — impact: ${impactLevel}`,
      details:     { title: proposal.title, category: proposal.category, impact_score: proposal.impact_score, risk_score: proposal.risk_score },
    })

    return data?.id as string ?? null
  } catch (err) {
    console.error('[SCOUT] Proposal insert error:', err)
    return null
  }
}

/**
 * Insert a rejected proposal for record-keeping.
 */
async function insertRejectedProposal(
  orgId:        string,
  proposal:     RawProposal,
  verification: MiroFishResult
): Promise<void> {
  try {
    await supabase
      .from('agent_proposals')
      .insert({
        org_id:          orgId,
        proposing_agent: 'scout',
        title:           proposal.title,
        description:     proposal.description,
        category:        proposal.category,
        source_data:     {
          ...proposal.source_data,
          rejection_reason: verification.rejectionReason,
        },
        impact_score:    proposal.impact_score / 10,
        risk_score:      proposal.risk_score / 10,
        status:          'rejected',
        mirofish_step:   verification.finalStep,
        mirofish_log:    verification.log,
      })

    // Audit the rejection
    try {
      await logAudit({
        action:      'reject',
        entity_type: 'agent_proposals',
        description: `SCOUT proposal rejected: "${proposal.title}" at MiroFish step ${verification.finalStep} — ${verification.rejectionReason}`,
        metadata: {
          category:          proposal.category,
          failed_step:       verification.finalStep,
          rejection_reason:  verification.rejectionReason,
        },
      })
    } catch {
      // Non-critical
    }
  } catch (err) {
    console.warn('[SCOUT] Rejected proposal insert failed:', err)
  }
}


// ── User Idea Analysis Pipeline ──────────────────────────────────────────────

export interface UserIdeaResult {
  analysis:     IdeaAnalysis
  proposalIds:  string[]
  rejections:   Array<{ option: IntegrationOption; reason: string }>
}

/**
 * Analyze a user-submitted improvement idea and convert it into proposals.
 *
 * Pipeline: analyze idea → convert to RawProposals → MiroFish verify → insert
 *
 * @param idea - Plain text idea description
 * @param submittedBy - User who submitted (email or username)
 * @param orgId - Organization ID
 * @param category - Optional proposal category (will auto-detect if not provided)
 * @returns Analysis plus proposal IDs and any rejections
 */
export async function analyzeUserIdea(
  idea: string,
  submittedBy: string,
  orgId: string,
  category?: string
): Promise<UserIdeaResult> {
  // ── Step 1: Analyze the idea ───────────────────────────────────────────
  console.log('[SCOUT] Analyzing user idea:', idea.slice(0, 80))

  const analysis = await analyzeIdea(idea, submittedBy, category || 'Other')
  if (!analysis) {
    throw new Error('Failed to analyze user idea')
  }

  console.log(`[SCOUT] Idea analyzed: ${analysis.options.length} integration options generated`)

  // ── Step 2: Convert options to RawProposals ────────────────────────────
  const proposalIds:  string[] = []
  const rejections:   Array<{ option: IntegrationOption; reason: string }> = []

  for (const option of analysis.options) {
    // Map integration option to RawProposal format
    const rawProposal: RawProposal = {
      title:        `User Idea: ${analysis.idea.slice(0, 50)}... — ${option.description.slice(0, 40)}`,
      description:  option.description,
      category:     (analysis.category.toLowerCase() as any),  // Use user's category
      impact_score: 6,  // Default moderate impact for user-submitted ideas
      risk_score:   mapRiskToScore(option.risk),
      source_data:  {
        source:             'user_submitted',
        submitted_by:       submittedBy,
        original_idea:      idea,
        affected_agents:    option.affected_agents,
        affected_files:     option.affected_files,
        effort:             option.effort,
        business_impact:    option.business_impact,
        feasibility_score:  analysis.feasibility_score,
      },
      reasoning: `User-submitted idea analyzed by SCOUT. Feasibility: ${analysis.feasibility_score}/10. ${option.business_impact}`,
    }

    // ── Step 3: Run MiroFish verification ────────────────────────────────
    const verification = await verifyProposal(rawProposal, orgId)

    if (verification.passed) {
      // Insert as 'proposed' — passed all 5 MiroFish steps
      const id = await insertProposal(orgId, rawProposal, verification)
      if (id) proposalIds.push(id)
    } else {
      // Track rejection
      rejections.push({
        option,
        reason: verification.rejectionReason ?? 'Unknown reason',
      })

      // Still insert as rejected for record-keeping
      await insertRejectedProposal(orgId, rawProposal, verification)
    }
  }

  const completedAt = new Date().toISOString()

  console.log(`[SCOUT] User idea processing complete: ${proposalIds.length} proposed, ${rejections.length} rejected`)

  // ── Step 4: Audit trail ────────────────────────────────────────────────
  try {
    await logAudit({
      action:      'insert',
      entity_type: 'agent_proposals',
      description: `User-submitted idea analyzed: "${analysis.idea.slice(0, 60)}..." by ${submittedBy}. ${analysis.options.length} options generated, ${proposalIds.length} passed MiroFish, ${rejections.length} rejected.`,
      metadata: {
        submitted_by:       submittedBy,
        original_idea:      idea,
        category:           analysis.category,
        feasibility_score:  analysis.feasibility_score,
        options_count:      analysis.options.length,
        proposed_count:     proposalIds.length,
        rejected_count:     rejections.length,
        proposal_ids:       proposalIds,
        rejections:         rejections.map(r => ({ description: r.option.description, reason: r.reason })),
      },
    })
  } catch (err) {
    console.warn('[SCOUT] User idea audit log failed:', err)
  }

  return {
    analysis,
    proposalIds,
    rejections,
  }
}


// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map risk level string to numeric score (1-10).
 */
function mapRiskToScore(risk: string): number {
  switch (risk.toLowerCase()) {
    case 'low':    return 3
    case 'medium': return 6
    case 'high':   return 8
    default:       return 5
  }
}


// ── Gap Detection ──────────────────────────────────────────────────────────

import { submitProposal as submitMiroFishProposal, runAutomatedReview } from '@/services/miroFish'
import { subscribe as busSubscribe } from '@/services/agentEventBus'

/**
 * Gap categories that SCOUT auto-detects from context strings.
 */
const GAP_PATTERNS: Array<{
  regex: RegExp
  category: 'operations' | 'financial' | 'nec_compliance' | 'safety' | 'feature' | 'optimization'
  impactLevel: 'low' | 'medium' | 'high'
}> = [
  { regex: /missing.*(?:price|cost|material|item)/i,              category: 'financial',       impactLevel: 'high' },
  { regex: /incomplete.*(?:field|log|entry|record)/i,             category: 'operations',      impactLevel: 'medium' },
  { regex: /(?:error|fail|crash|exception).*agent/i,              category: 'feature',         impactLevel: 'high' },
  { regex: /repeated.*(?:correction|fix|redo)/i,                  category: 'optimization',    impactLevel: 'medium' },
  { regex: /no.*(?:estimate|quote|bid)/i,                         category: 'financial',       impactLevel: 'high' },
  { regex: /(?:compliance|code|nec|permit).*(?:gap|missing|fail)/i, category: 'nec_compliance', impactLevel: 'high' },
  { regex: /(?:schedule|crew|dispatch).*(?:conflict|gap|missing)/i, category: 'operations',    impactLevel: 'medium' },
  { regex: /overdue.*(?:invoice|payment|collection)/i,            category: 'financial',       impactLevel: 'high' },
]

export interface GapDetectionResult {
  detected:   boolean
  proposalId?: string
  title?:     string
  category?:  string
  error?:     string
}

/**
 * Detect a data gap from a context string and submit a MiroFish proposal.
 * SCOUT does NOT fix anything — it only submits proposals.
 *
 * @param context - Description of the gap (e.g., "missing material cost in estimate POS-001")
 * @param orgId - Organization ID (defaults to localStorage-cached orgId)
 */
export async function detectGap(
  context: string,
  orgId?: string
): Promise<GapDetectionResult> {
  const resolvedOrgId = orgId || localStorage.getItem('poweron_org_id') || 'default'

  // Match against known gap patterns
  let matchedCategory: typeof GAP_PATTERNS[0] | undefined
  for (const pattern of GAP_PATTERNS) {
    if (pattern.regex.test(context)) {
      matchedCategory = pattern
      break
    }
  }

  // Default if no pattern matched
  const category = matchedCategory?.category ?? 'operations'
  const impactLevel = matchedCategory?.impactLevel ?? 'medium'

  // Build title from context (truncate)
  const title = `SCOUT Gap: ${context.slice(0, 80)}${context.length > 80 ? '...' : ''}`

  try {
    // Step 1: Submit to MiroFish pipeline
    const proposal = await submitMiroFishProposal({
      orgId:          resolvedOrgId,
      proposingAgent: 'scout',
      title,
      description:    context,
      category:       category as any,
      impactLevel,
      actionType:     'gap_resolution',
      actionPayload:  { gapContext: context, detectedAt: new Date().toISOString() },
      sourceData:     { source: 'scout_gap_detection', raw_context: context },
    })

    if (!proposal.id) {
      return { detected: true, error: 'Proposal created but no ID returned' }
    }

    // Steps 2+3: Run automated NEXUS review + domain verification
    const review = await runAutomatedReview(proposal.id)

    console.log(`[SCOUT:detectGap] Proposal ${proposal.id} — review ${review.passed ? 'PASSED' : 'FAILED'} at step ${review.step}`)

    return {
      detected:   true,
      proposalId: proposal.id,
      title,
      category,
    }
  } catch (err) {
    console.error('[SCOUT:detectGap] Failed:', err)
    return {
      detected: true,
      error:    err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

/**
 * Subscribe to agentBus events that indicate gaps SCOUT should auto-detect.
 * Call once at app startup.
 */
export function initScoutAutoDetection(): void {
  // Watch for DATA_GAP_DETECTED events from other agents
  busSubscribe('DATA_GAP_DETECTED', (event) => {
    // Don't react to our own proposals
    if (event.source === 'mirofish' || event.source === 'scout') return
    const summary = event.summary || JSON.stringify(event.payload)
    detectGap(summary).catch(err => console.warn('[SCOUT:autoDetect] Failed:', err))
  })

  // Watch for compliance flags
  busSubscribe('COMPLIANCE_FLAG', (event) => {
    const summary = `Compliance gap flagged: ${event.summary}`
    detectGap(summary).catch(err => console.warn('[SCOUT:autoDetect] Failed:', err))
  })

  console.log('[SCOUT] Auto-detection listeners initialized')
}

// ── Window global for manual testing ────────────────────────────────────────

if (typeof window !== 'undefined') {
  (window as any).__scout = {
    detectGap,
    runScoutAnalysis,
    analyzeUserIdea,
  }
}


// ── Re-exports ──────────────────────────────────────────────────────────────
export type { RawProposal } from './analyzer'
export type { MiroFishResult, MiroFishLogEntry } from './mirofish'
export type { ScoutDataSnapshot } from './dataGatherer'
export type { IdeaAnalysis, IntegrationOption } from './ideaAnalyzer'
export { PROPOSAL_CATEGORIES, type ProposalCategory } from './analyzer'
