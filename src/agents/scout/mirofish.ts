// @ts-nocheck
/**
 * MiroFish Verification Chain — 5-step verification pipeline for SCOUT proposals.
 *
 * Every proposal must pass all 5 steps before it surfaces to the user
 * as status='proposed'. Failed proposals get status='rejected' with reason logged.
 *
 * Steps:
 *   1. Data accuracy check — is the source data still current?
 *   2. Business logic check — does this make sense for an electrical contractor?
 *   3. Risk assessment — flag anything CRITICAL
 *   4. Duplicate check — is there already an open proposal for this?
 *   5. Confidence score — only surface proposals scoring 7+
 */

import { supabase } from '@/lib/supabase'
import type { RawProposal } from './analyzer'

// ── Types ───────────────────────────────────────────────────────────────────

export interface MiroFishResult {
  passed:           boolean
  finalStep:        number         // 1-5 (which step it reached)
  confidenceScore:  number         // 0-10 (calculated at step 5)
  log:              MiroFishLogEntry[]
  rejectionReason?: string
}

export interface MiroFishLogEntry {
  step:      number
  name:      string
  passed:    boolean
  detail:    string
  timestamp: string
}

// ── MiroFish Pipeline ───────────────────────────────────────────────────────

/**
 * Run a proposal through the 5-step MiroFish verification chain.
 */
export async function verifyProposal(
  proposal: RawProposal,
  orgId:    string
): Promise<MiroFishResult> {
  const log: MiroFishLogEntry[] = []
  const now = () => new Date().toISOString()

  // ── Step 1: Data Accuracy Check ───────────────────────────────────────
  const step1 = await checkDataAccuracy(proposal, orgId)
  log.push({ step: 1, name: 'data_accuracy', passed: step1.passed, detail: step1.detail, timestamp: now() })

  if (!step1.passed) {
    return {
      passed: false, finalStep: 1, confidenceScore: 0, log,
      rejectionReason: `Data accuracy: ${step1.detail}`,
    }
  }

  // ── Step 2: Business Logic Check ──────────────────────────────────────
  const step2 = checkBusinessLogic(proposal)
  log.push({ step: 2, name: 'business_logic', passed: step2.passed, detail: step2.detail, timestamp: now() })

  if (!step2.passed) {
    return {
      passed: false, finalStep: 2, confidenceScore: 0, log,
      rejectionReason: `Business logic: ${step2.detail}`,
    }
  }

  // ── Step 3: Risk Assessment ───────────────────────────────────────────
  const step3 = assessRisk(proposal)
  log.push({ step: 3, name: 'risk_assessment', passed: step3.passed, detail: step3.detail, timestamp: now() })

  if (!step3.passed) {
    return {
      passed: false, finalStep: 3, confidenceScore: 0, log,
      rejectionReason: `Risk assessment: ${step3.detail}`,
    }
  }

  // ── Step 4: Duplicate Check ───────────────────────────────────────────
  const step4 = await checkDuplicate(proposal, orgId)
  log.push({ step: 4, name: 'duplicate_check', passed: step4.passed, detail: step4.detail, timestamp: now() })

  if (!step4.passed) {
    return {
      passed: false, finalStep: 4, confidenceScore: 0, log,
      rejectionReason: `Duplicate: ${step4.detail}`,
    }
  }

  // ── Step 5: Confidence Score ──────────────────────────────────────────
  const confidenceScore = calculateConfidence(proposal, log)
  const step5Passed = confidenceScore >= 7
  log.push({
    step: 5, name: 'confidence_score', passed: step5Passed,
    detail: `Score: ${confidenceScore}/10 (threshold: 7)`, timestamp: now(),
  })

  if (!step5Passed) {
    return {
      passed: false, finalStep: 5, confidenceScore, log,
      rejectionReason: `Low confidence: ${confidenceScore}/10 (minimum 7 required)`,
    }
  }

  return { passed: true, finalStep: 5, confidenceScore, log }
}


// ── Step Implementations ────────────────────────────────────────────────────

/**
 * Step 1: Verify the source data referenced in the proposal is still current.
 */
async function checkDataAccuracy(
  proposal: RawProposal,
  orgId: string
): Promise<{ passed: boolean; detail: string }> {
  try {
    // If proposal references a specific project, verify it still exists and is active
    const sourceProjectId = proposal.source_data?.project_id as string | undefined

    if (sourceProjectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('id, status')
        .eq('id', sourceProjectId)
        .eq('org_id', orgId)
        .single()

      if (!project) {
        return { passed: false, detail: `Referenced project ${sourceProjectId} not found` }
      }

      if (['completed', 'canceled'].includes(project.status)) {
        return { passed: false, detail: `Referenced project is ${project.status} — no longer actionable` }
      }
    }

    // If proposal references invoices, verify they exist
    const sourceInvoiceId = proposal.source_data?.invoice_id as string | undefined
    if (sourceInvoiceId) {
      const { data: invoice } = await supabase
        .from('invoices')
        .select('id, status')
        .eq('id', sourceInvoiceId)
        .eq('org_id', orgId)
        .single()

      if (!invoice) {
        return { passed: false, detail: `Referenced invoice ${sourceInvoiceId} not found` }
      }
    }

    return { passed: true, detail: 'Source data verified — references are current' }
  } catch (err) {
    // On error, pass with a warning rather than blocking
    console.warn('[MiroFish:step1] Data check error:', err)
    return { passed: true, detail: 'Data check completed with warnings (DB query error, passed by default)' }
  }
}

/**
 * Step 2: Does the proposal make sense for an electrical contracting business?
 */
function checkBusinessLogic(proposal: RawProposal): { passed: boolean; detail: string } {
  const title = proposal.title.toLowerCase()
  const desc  = proposal.description.toLowerCase()
  const combined = `${title} ${desc}`

  // Reject proposals referencing irrelevant domains
  const irrelevantTerms = [
    'cryptocurrency', 'stock trading', 'real estate investment',
    'social media influencer', 'dropshipping', 'nft',
  ]
  const found = irrelevantTerms.find(term => combined.includes(term))
  if (found) {
    return { passed: false, detail: `Proposal references "${found}" — not relevant to electrical contracting` }
  }

  // Reject proposals with absurd scores
  if (proposal.impact_score >= 9 && proposal.risk_score <= 1) {
    return { passed: false, detail: 'Implausible score combination: very high impact with negligible risk' }
  }

  // Reject empty reasoning
  if (proposal.reasoning.length < 20) {
    return { passed: false, detail: 'Insufficient reasoning — must explain analytical basis' }
  }

  // Must have a substantive description
  if (proposal.description.length < 30) {
    return { passed: false, detail: 'Description too short — proposals need specific, actionable detail' }
  }

  return { passed: true, detail: 'Business logic validated — proposal is relevant and well-formed' }
}

/**
 * Step 3: Risk assessment — flag CRITICAL proposals for extra scrutiny.
 */
function assessRisk(proposal: RawProposal): { passed: boolean; detail: string } {
  // CRITICAL risk (score 9-10) requires impact >= 7 to justify surfacing
  if (proposal.risk_score >= 9 && proposal.impact_score < 7) {
    return {
      passed: false,
      detail: `CRITICAL risk (${proposal.risk_score}) with low impact (${proposal.impact_score}) — not worth the risk`,
    }
  }

  // Proposals about deleting data or permissions always flagged
  const dangerTerms = ['delete all', 'drop table', 'remove all', 'bulk delete']
  const hasDanger = dangerTerms.some(t =>
    proposal.title.toLowerCase().includes(t) || proposal.description.toLowerCase().includes(t)
  )
  if (hasDanger) {
    return { passed: false, detail: 'Proposal involves destructive operations — rejected by policy' }
  }

  if (proposal.risk_score >= 8) {
    return { passed: true, detail: `High risk (${proposal.risk_score}) — approved but flagged for owner review` }
  }

  return { passed: true, detail: `Risk level acceptable (${proposal.risk_score}/10)` }
}

/**
 * Step 4: Check for duplicate open proposals.
 */
async function checkDuplicate(
  proposal: RawProposal,
  orgId: string
): Promise<{ passed: boolean; detail: string }> {
  try {
    // Look for open proposals with similar title or category from scout
    const { data: existing } = await supabase
      .from('agent_proposals')
      .select('id, title, status')
      .eq('org_id', orgId)
      .eq('proposing_agent', 'scout')
      .eq('category', proposal.category)
      .in('status', ['proposed', 'reviewing', 'confirmed', 'integrating'])
      .limit(10)

    if (existing && existing.length > 0) {
      // Check for title similarity (simple substring match)
      const titleWords = proposal.title.toLowerCase().split(/\s+/).filter(w => w.length > 4)
      const isDuplicate = existing.some(e => {
        const existingTitle = (e.title as string).toLowerCase()
        const matchingWords = titleWords.filter(w => existingTitle.includes(w))
        return matchingWords.length >= Math.ceil(titleWords.length * 0.5)
      })

      if (isDuplicate) {
        return {
          passed: false,
          detail: `Similar open proposal already exists in category "${proposal.category}"`,
        }
      }
    }

    return { passed: true, detail: 'No duplicate proposals found' }
  } catch (err) {
    console.warn('[MiroFish:step4] Duplicate check error:', err)
    return { passed: true, detail: 'Duplicate check completed with warnings (passed by default)' }
  }
}

/**
 * Step 5: Calculate final confidence score.
 * Combines impact, risk, data quality, and verification signals.
 */
function calculateConfidence(
  proposal: RawProposal,
  log: MiroFishLogEntry[]
): number {
  let score = 0

  // Base: average of impact and risk scores (both important)
  score += (proposal.impact_score + proposal.risk_score) / 2  // 1-10

  // Bonus: specific source_data cited
  const sourceKeys = Object.keys(proposal.source_data)
  if (sourceKeys.length >= 3) score += 0.5
  if (sourceKeys.length >= 5) score += 0.5

  // Bonus: detailed reasoning
  if (proposal.reasoning.length > 100) score += 0.5
  if (proposal.reasoning.length > 200) score += 0.5

  // Penalty: any verification steps had warnings
  const warnings = log.filter(l => l.detail.includes('warning'))
  score -= warnings.length * 0.5

  // Clamp to 0-10
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10))
}
