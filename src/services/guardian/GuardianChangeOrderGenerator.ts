/**
 * GuardianChangeOrderGenerator.ts
 *
 * Detects verbal / logged scope changes and auto-generates professional
 * change order documents.  Enforces the HARD RULE: no scope change proceeds
 * without a written, customer/GC-signed change order.
 *
 * Public API
 * ----------
 *  detectScopeChange(text)                           → ScopeChangeDetectionResult
 *  generateChangeOrder(projectId, changeData)        → Promise<GuardianChangeOrder>
 *  approveChangeOrder(changeOrderId, approvedBy)     → Promise<void>
 *  rejectChangeOrder(changeOrderId, reason)          → Promise<void>
 *  recordSignature(changeOrderId, signerName, date)  → Promise<void>
 *  getPendingChangeOrders(projectId)                 → Promise<GuardianChangeOrder[]>
 */

import { supabase } from '@/lib/supabase'
import { callClaude, extractText } from '@/services/claudeProxy'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ChangeOrderStatus = 'pending_approval' | 'approved' | 'rejected'

export interface GuardianChangeOrder {
  id: string
  project_id: string
  original_scope: string
  change_description: string
  reason: string
  cost_impact: number
  timeline_impact_days: number
  requested_by: string
  document_body: string
  status: ChangeOrderStatus
  /** Name typed by customer/GC when signing electronically */
  signer_name: string | null
  signed_at: string | null
  approved_by: string | null
  approved_at: string | null
  rejected_reason: string | null
  /** True when GUARDIAN detected a verbal scope change that triggered this CO */
  auto_detected: boolean
  created_at: string
}

export interface ChangeOrderInputData {
  /** Original project scope description (from estimate or brief) */
  originalScope: string
  /** Description of the change being requested */
  changeDescription: string
  /** Why the change is needed */
  reason: string
  /** Dollar cost impact (positive = cost increase) */
  costImpact: number
  /** Timeline impact in calendar days */
  timelineImpactDays: number
  /** Name of person who requested the change */
  requestedBy: string
  /** Whether this was auto-detected (true) or manually entered (false) */
  autoDetected?: boolean
}

export interface ScopeChangeDetectionResult {
  /** Whether scope change language was detected */
  detected: boolean
  /** Confidence 0.0–1.0 */
  confidence: number
  /** Which trigger phrase(s) matched */
  triggers: string[]
  /** Extracted description of the proposed change */
  extractedChange: string
  /** Raw input text */
  sourceText: string
}

// ── Scope Change Trigger Phrases ──────────────────────────────────────────────

/**
 * Phrases that indicate a verbal scope change is being made.
 * These are intentionally conservative — false negatives are safer than
 * false positives that block legitimate work.
 */
const SCOPE_CHANGE_TRIGGERS: Array<{ phrase: string; weight: number }> = [
  // "While we're here" additions
  { phrase: "while we're here", weight: 1.0 },
  { phrase: 'while we are here', weight: 1.0 },
  { phrase: 'since you are here', weight: 0.9 },
  { phrase: "since you're here", weight: 0.9 },
  { phrase: 'as long as you are here', weight: 0.9 },
  // Verbal additions
  { phrase: 'can you also', weight: 0.8 },
  { phrase: 'can you add', weight: 0.8 },
  { phrase: 'would you also', weight: 0.8 },
  { phrase: 'add this to the job', weight: 1.0 },
  { phrase: 'add to the scope', weight: 1.0 },
  { phrase: 'throw in', weight: 0.7 },
  { phrase: 'do this too', weight: 0.7 },
  // Plan changes
  { phrase: 'change the plan', weight: 1.0 },
  { phrase: 'changed the plan', weight: 1.0 },
  { phrase: 'different from the estimate', weight: 0.9 },
  { phrase: 'not what was quoted', weight: 0.9 },
  { phrase: 'originally we said', weight: 0.8 },
  { phrase: 'outside of scope', weight: 0.9 },
  { phrase: 'out of scope', weight: 0.9 },
  { phrase: 'extra work', weight: 0.8 },
  { phrase: 'additional work', weight: 0.8 },
  { phrase: 'additional scope', weight: 0.9 },
  // Material substitutions
  { phrase: 'use this instead', weight: 0.8 },
  { phrase: 'swap out', weight: 0.7 },
  { phrase: 'substitute', weight: 0.7 },
  { phrase: 'upgrade the material', weight: 0.8 },
  { phrase: 'different material', weight: 0.7 },
  // Owner/GC direct verbal requests
  { phrase: 'the owner wants', weight: 0.8 },
  { phrase: 'gc wants', weight: 0.8 },
  { phrase: 'customer asked', weight: 0.8 },
  { phrase: 'they want', weight: 0.6 },
  { phrase: 'they asked', weight: 0.6 },
]

const DETECTION_THRESHOLD = 0.65

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return `co_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function isoNow(): string {
  return new Date().toISOString()
}

// ── Core: Detect Scope Change ─────────────────────────────────────────────────

/**
 * detectScopeChange
 *
 * Analyzes field log text or a NEXUS voice entry for scope-change signals.
 * Returns a detection result with confidence score and matched triggers.
 * This is synchronous — no API call needed.
 */
export function detectScopeChange(text: string): ScopeChangeDetectionResult {
  const lower = text.toLowerCase()
  const matched: string[] = []
  let maxWeight = 0
  let totalWeight = 0

  for (const { phrase, weight } of SCOPE_CHANGE_TRIGGERS) {
    if (lower.includes(phrase)) {
      matched.push(phrase)
      totalWeight += weight
      if (weight > maxWeight) maxWeight = weight
    }
  }

  // Confidence: blend max single-trigger weight with quantity bonus
  const quantityBonus = Math.min((matched.length - 1) * 0.05, 0.2)
  const confidence = matched.length > 0
    ? Math.min(maxWeight + quantityBonus, 1.0)
    : 0

  const detected = confidence >= DETECTION_THRESHOLD

  // Extract a brief description of the proposed change (simple heuristic)
  let extractedChange = ''
  if (detected) {
    // Take the sentence(s) containing a trigger phrase
    const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean)
    const relevant = sentences.filter(s => {
      const sl = s.toLowerCase()
      return matched.some(p => sl.includes(p))
    })
    extractedChange = relevant.join('. ')
  }

  return {
    detected,
    confidence,
    triggers: matched,
    extractedChange: extractedChange || text.slice(0, 200),
    sourceText: text,
  }
}

// ── Core: Generate Change Order ───────────────────────────────────────────────

/**
 * generateChangeOrder
 *
 * Calls Claude to compose a professional change order document, then persists
 * it in the `guardian_change_orders` Supabase table with status 'pending_approval'.
 *
 * HARD RULE: No scope change proceeds without written change order signed by
 * customer or GC.  If a crew member logs scope change language, GUARDIAN fires
 * the 5-step loop immediately.
 */
export async function generateChangeOrder(
  projectId: string,
  changeData: ChangeOrderInputData
): Promise<GuardianChangeOrder> {
  const {
    originalScope,
    changeDescription,
    reason,
    costImpact,
    timelineImpactDays,
    requestedBy,
    autoDetected = false,
  } = changeData

  const systemPrompt = `Generate a change order document for Power On Solutions LLC.
Original scope: ${originalScope}. Change: ${changeDescription}. Reason: ${reason}.
Cost impact: ${costImpact >= 0 ? '+' : ''}$${costImpact.toFixed(2)} (from VAULT rates). Timeline impact: ${timelineImpactDays} additional calendar day(s).
Requested by: ${requestedBy}. Format: professional document requiring signature before work proceeds.
Include: change order number placeholder, project reference, date, original scope summary, detailed description of change, cost breakdown, timeline impact, customer/GC signature line, contractor signature line (Christian Dubon, C-10 #1151468, Power On Solutions LLC).
State clearly: NO WORK SHALL PROCEED ON THIS CHANGE UNTIL THIS DOCUMENT IS SIGNED.`

  let documentBody: string
  try {
    const response = await callClaude({
      messages: [{ role: 'user', content: 'Generate the change order document now.' }],
      system: systemPrompt,
      max_tokens: 1200,
    })
    documentBody = extractText(response)
  } catch {
    // Fallback template
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
    documentBody = [
      `CHANGE ORDER`,
      `Date: ${today}`,
      `Contractor: Christian Dubon | C-10 License #1151468 | Power On Solutions LLC`,
      '',
      `ORIGINAL SCOPE:`,
      originalScope,
      '',
      `CHANGE DESCRIPTION:`,
      changeDescription,
      '',
      `REASON FOR CHANGE:`,
      reason,
      '',
      `COST IMPACT: ${costImpact >= 0 ? '+' : ''}$${costImpact.toFixed(2)}`,
      `TIMELINE IMPACT: ${timelineImpactDays} additional calendar day(s)`,
      '',
      `REQUESTED BY: ${requestedBy}`,
      '',
      `⚠ NO WORK SHALL PROCEED ON THIS CHANGE UNTIL THIS DOCUMENT IS SIGNED BY CUSTOMER/GC AND CONTRACTOR.`,
      '',
      `Customer / GC Signature: _________________________  Date: ___________`,
      '',
      `Contractor Signature: _________________________    Date: ___________`,
      `Christian Dubon — Power On Solutions LLC`,
    ].join('\n')
  }

  const now = isoNow()
  const changeOrder: GuardianChangeOrder = {
    id: uid(),
    project_id: projectId,
    original_scope: originalScope,
    change_description: changeDescription,
    reason,
    cost_impact: costImpact,
    timeline_impact_days: timelineImpactDays,
    requested_by: requestedBy,
    document_body: documentBody,
    status: 'pending_approval',
    signer_name: null,
    signed_at: null,
    approved_by: null,
    approved_at: null,
    rejected_reason: null,
    auto_detected: autoDetected,
    created_at: now,
  }

  // Persist to Supabase
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('guardian_change_orders') as any).insert(changeOrder)
    if (error) {
      console.warn('[GuardianChangeOrderGenerator] Supabase insert error:', error.message)
    }
  } catch {
    console.warn('[GuardianChangeOrderGenerator] Supabase unavailable, continuing in local mode')
  }

  // Emit GUARDIAN alert so the app surfaces the warning immediately
  console.warn(
    `[GUARDIAN] Verbal scope change detected on project ${projectId}. No change order exists. Corrective action required.`
  )

  return changeOrder
}

// ── Core: Approve / Reject ────────────────────────────────────────────────────

/**
 * approveChangeOrder
 *
 * Requires Christian's confirmation (approvedBy = owner user ID or name).
 * Sets status to 'approved'.
 */
export async function approveChangeOrder(
  changeOrderId: string,
  approvedBy: string
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('guardian_change_orders') as any)
      .update({
        status: 'approved' as ChangeOrderStatus,
        approved_by: approvedBy,
        approved_at: isoNow(),
      })
      .eq('id', changeOrderId)
    if (error) throw error
  } catch (err) {
    throw new Error(`[GuardianChangeOrderGenerator] approveChangeOrder failed: ${String(err)}`)
  }
}

/**
 * rejectChangeOrder
 *
 * Sets status to 'rejected' with an optional reason.
 */
export async function rejectChangeOrder(
  changeOrderId: string,
  reason: string
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('guardian_change_orders') as any)
      .update({
        status: 'rejected' as ChangeOrderStatus,
        rejected_reason: reason,
      })
      .eq('id', changeOrderId)
    if (error) throw error
  } catch (err) {
    throw new Error(`[GuardianChangeOrderGenerator] rejectChangeOrder failed: ${String(err)}`)
  }
}

// ── Core: Electronic Signature ────────────────────────────────────────────────

/**
 * recordSignature
 *
 * Customer / GC "signs" by typing their name and today's date.
 * Records on the change order.  Work may only proceed after this step
 * AND after approveChangeOrder() is called.
 */
export async function recordSignature(
  changeOrderId: string,
  signerName: string,
  date: string
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('guardian_change_orders') as any)
      .update({
        signer_name: signerName,
        signed_at: date,
      })
      .eq('id', changeOrderId)
    if (error) throw error
  } catch (err) {
    throw new Error(`[GuardianChangeOrderGenerator] recordSignature failed: ${String(err)}`)
  }
}

// ── Core: Query ───────────────────────────────────────────────────────────────

/**
 * getPendingChangeOrders
 *
 * Returns all change orders for a project that are pending approval (unsigned).
 */
export async function getPendingChangeOrders(
  projectId: string
): Promise<GuardianChangeOrder[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('guardian_change_orders') as any)
      .select('*')
      .eq('project_id', projectId)
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []) as GuardianChangeOrder[]
  } catch (err) {
    console.warn('[GuardianChangeOrderGenerator] getPendingChangeOrders error:', String(err))
    return []
  }
}
