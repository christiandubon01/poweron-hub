/**
 * src/services/hunter/HunterDebriefEngine.ts
 * HUNTER Debrief and Learning System — HT7
 *
 * After each lead outcome (won/lost), initiates a debrief session that:
 * 1. Extracts lessons using Claude AI structured prompt
 * 2. Parses response into rule candidates
 * 3. Presents each candidate for owner approval
 * 4. Writes approved rules to permanent hunter_rules table
 *
 * PUBLIC API:
 *   startDebrief(leadId, outcome)           → Promise<HunterDebrief>
 *   extractLessons(debriefResponse)         → RuleCandidate[]
 *   approveRule(ruleId)                     → Promise<void>
 *   rejectRule(ruleId)                      → Promise<void>
 *   deferStudySession(ruleId)               → Promise<void>
 *   getStudyQueue()                         → StudyItem[]
 *   reviewStudyItem(studyItemId)            → Promise<void>
 *
 * Supabase tables:
 *   hunter_leads            — lead record
 *   hunter_debriefs         — debrief session record
 *   hunter_rule_candidates  — pending approval rules (temporary)
 *   hunter_rules            — approved permanent rules
 *   hunter_study_queue      — deferred learning items
 */

import { callClaude } from '@/services/claudeProxy';
import { supabase } from '@/lib/supabase';
import { HunterLead, HunterRule, RuleType, RuleStatus, DebriefsOutcome } from './HunterTypes';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RuleCandidate {
  id: string;
  type: RuleType;
  text: string;
  confidence: number; // 0-1
  source_lead_id: string;
  created_at: string;
  approved: boolean;
  rejected: boolean;
  rejection_reason?: string;
}

export interface StudyItem {
  id: string;
  rule_candidate_id: string;
  rule_type: RuleType;
  rule_text: string;
  source_lead_id: string;
  deferred_at: string;
  reviewed: boolean;
}

export interface HunterDebrief {
  id: string;
  lead_id: string;
  outcome: DebriefsOutcome;
  pitch_script_used?: string;
  outcome_details?: string;
  claude_response?: string;
  rule_candidates: RuleCandidate[];
  debriefed_at: string;
  created_at: string;
}

export interface ClaudeDebriefResponse {
  pitch_rules: Array<{ text: string; confidence: number }>;
  scoring_adjustments: Array<{ text: string; confidence: number }>;
  suppression_rules: Array<{ text: string; confidence: number }>;
  objection_rules: Array<{ text: string; confidence: number }>;
  timing_rules: Array<{ text: string; confidence: number }>;
}

// ─── Service ───────────────────────────────────────────────────────────────────

/**
 * Initiates a debrief session for a lead outcome
 * Calls Claude API with structured prompt to extract lessons
 */
export async function startDebrief(
  leadId: string,
  outcome: DebriefsOutcome,
  pitchScriptUsed?: string,
  outcomeDetails?: string
): Promise<HunterDebrief> {
  // Fetch lead data
  const { data: leadData, error: leadError } = await supabase
    .from('hunter_leads')
    .select('*')
    .eq('id', leadId)
    .single();

  if (leadError || !leadData) {
    throw new Error(`Failed to fetch lead ${leadId}: ${leadError?.message}`);
  }

  const lead = leadData as HunterLead;

  // Build Claude prompt with structured instruction
  const claudePrompt = buildDebriefPrompt(lead, outcome, pitchScriptUsed, outcomeDetails);

  // Call Claude API via claudeProxy
  let claudeResponse: string;
  try {
    const message = await callClaude({
      messages: [
        {
          role: 'user',
          content: claudePrompt,
        },
      ],
      max_tokens: 2048,
    });

    claudeResponse =
      message.content[0]?.text || JSON.stringify(message.content);
  } catch (error) {
    console.error('Claude API error:', error);
    throw new Error(`Claude API call failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Extract lessons (parse Claude response)
  const ruleCandidates = extractLessons(claudeResponse, leadId);

  // Create debrief record in Supabase
  const debriefId = `debrief-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const debriefRecord: any = {
    id: debriefId,
    lead_id: leadId,
    outcome,
    pitch_script_used: pitchScriptUsed,
    outcome_details: outcomeDetails,
    claude_response: claudeResponse,
    rule_candidates: ruleCandidates,
    debriefed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };

  const { error: debriefError } = await (supabase.from('hunter_debriefs') as any).insert([debriefRecord]);

  if (debriefError) {
    console.error('Failed to insert debrief:', debriefError);
  }

  // Store rule candidates as temporary records for approval UI
  for (const candidate of ruleCandidates) {
    const candidateRecord: any = {
      id: candidate.id,
      debrief_id: debriefId,
      rule_type: candidate.type,
      rule_text: candidate.text,
      confidence: candidate.confidence,
      source_lead_id: leadId,
      created_at: candidate.created_at,
      approved: false,
      rejected: false,
    };

    const { error: candidateError } = await (supabase.from('hunter_rule_candidates') as any).insert([candidateRecord]);

    if (candidateError) {
      console.error(`Failed to insert rule candidate ${candidate.id}:`, candidateError);
    }
  }

  return debriefRecord;
}

/**
 * Builds the structured prompt for Claude debrief analysis
 */
function buildDebriefPrompt(
  lead: HunterLead,
  outcome: DebriefsOutcome,
  pitchScriptUsed?: string,
  outcomeDetails?: string
): string {
  const outcomeStr = outcome === DebriefsOutcome.WON ? 'WON' : 'LOST';
  return `You are HUNTER's learning engine. A lead was marked as ${outcomeStr}.

Analyze the lead data and outcome to extract actionable lessons that improve future scoring and pitching.

=== ORIGINAL LEAD ===
Contact: ${lead.contact_name || 'Unknown'}
Company: ${lead.company_name || 'N/A'}
Type: ${lead.lead_type}
Source: ${lead.source}
Address: ${lead.address || 'N/A'}
Description: ${lead.description || 'N/A'}
Estimated Value: $${lead.estimated_value || 0}
Estimated Margin: ${lead.estimated_margin || 0}%
Score: ${lead.score}
Score Tier: ${lead.score_tier}
Urgency Level: ${lead.urgency_level || 0}/5
Pitch Angle Used: ${lead.pitch_angle || 'N/A'}

=== PITCH SCRIPT USED ===
${pitchScriptUsed || 'None recorded'}

=== OUTCOME ===
Result: ${outcome}
Details: ${outcomeDetails || 'No additional details'}

=== ANALYSIS TASK ===
Extract lessons in these 5 categories:

1. PITCH LESSONS: What opening angle worked/failed? What specific language or approach should be replicated/avoided?
2. SCORING LESSONS: Were the score factors accurate? Should any factor weights be adjusted? Is the tier placement still correct?
3. SUPPRESSION RULES: Should leads matching this profile be filtered out in future prospecting?
4. OBJECTION INSIGHTS: What new objections were encountered? What responses worked or failed?
5. TIMING INSIGHTS: What day/time patterns affected the outcome? Best times to follow up?

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no code fences) with this structure:
{
  "pitch_rules": [
    {"text": "specific, actionable pitch lesson", "confidence": 0.85},
    ...
  ],
  "scoring_adjustments": [
    {"text": "specific weight or factor adjustment", "confidence": 0.75},
    ...
  ],
  "suppression_rules": [
    {"text": "profile to filter out in future", "confidence": 0.80},
    ...
  ],
  "objection_rules": [
    {"text": "new objection + response pattern", "confidence": 0.90},
    ...
  ],
  "timing_rules": [
    {"text": "time/day pattern insight", "confidence": 0.70},
    ...
  ]
}

Confidence should reflect how certain you are (0-1 scale).
Only include rules where confidence >= 0.65.
Be specific and actionable. Avoid generic advice.`;
}

/**
 * Parses Claude response into rule candidates
 * Handles both valid JSON and fallback parsing
 */
export function extractLessons(
  claudeResponse: string,
  sourceLeadId: string
): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];
  let parsed: ClaudeDebriefResponse;

  try {
    // Try to parse as JSON
    parsed = JSON.parse(claudeResponse) as ClaudeDebriefResponse;
  } catch (error) {
    // Fallback: try to extract JSON from response text
    const jsonMatch = claudeResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]) as ClaudeDebriefResponse;
      } catch {
        console.warn('Could not parse Claude response as JSON, returning empty candidates');
        return [];
      }
    } else {
      console.warn('No JSON found in Claude response');
      return [];
    }
  }

  // Map each rule type to RuleCandidate
  const ruleTypeMap: Record<string, RuleType> = {
    pitch_rules: RuleType.PITCH,
    scoring_adjustments: RuleType.URGENCY,
    suppression_rules: RuleType.SUPPRESSION,
    objection_rules: RuleType.OBJECTION,
    timing_rules: RuleType.TIMING,
  };

  for (const [key, rules] of Object.entries(parsed)) {
    const ruleType = ruleTypeMap[key] as RuleType | undefined;
    if (!ruleType || !Array.isArray(rules)) continue;

    for (const rule of rules) {
      if (typeof rule.text === 'string' && typeof rule.confidence === 'number') {
        const candidate: RuleCandidate = {
          id: `candidate-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: ruleType,
          text: rule.text,
          confidence: rule.confidence,
          source_lead_id: sourceLeadId,
          created_at: new Date().toISOString(),
          approved: false,
          rejected: false,
        };
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

/**
 * Approves a rule candidate and writes it to permanent hunter_rules table
 */
export async function approveRule(
  ruleCandidateId: string,
  userId: string
): Promise<HunterRule> {
  // Fetch candidate
  const { data: candidateData, error: candidateError } = await (supabase.from('hunter_rule_candidates') as any)
    .select('*')
    .eq('id', ruleCandidateId)
    .single();

  if (candidateError || !candidateData) {
    throw new Error(`Failed to fetch candidate ${ruleCandidateId}: ${candidateError?.message}`);
  }

  // Create permanent rule
  const ruleId = `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const newRule: any = {
    id: ruleId,
    user_id: userId,
    rule_type: candidateData.rule_type as RuleType,
    rule_text: candidateData.rule_text,
    source_lead_id: candidateData.source_lead_id,
    version: 1,
    status: RuleStatus.ACTIVE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: ruleError } = await (supabase.from('hunter_rules') as any).insert([newRule]);

  if (ruleError) {
    throw new Error(`Failed to insert rule: ${ruleError.message}`);
  }

  // Mark candidate as approved
  const { error: updateError } = await (supabase.from('hunter_rule_candidates') as any)
    .update({ approved: true })
    .eq('id', ruleCandidateId);

  if (updateError) {
    console.error(`Failed to mark candidate ${ruleCandidateId} as approved:`, updateError);
  }

  return newRule;
}

/**
 * Rejects a rule candidate with optional reason
 */
export async function rejectRule(
  ruleCandidateId: string,
  rejectionReason?: string
): Promise<void> {
  const { error } = await (supabase.from('hunter_rule_candidates') as any)
    .update({
      rejected: true,
      rejection_reason: rejectionReason || 'Owner declined',
    })
    .eq('id', ruleCandidateId);

  if (error) {
    throw new Error(`Failed to reject rule: ${error.message}`);
  }
}

/**
 * Defers a rule candidate to the study queue for later review
 */
export async function deferStudySession(
  ruleCandidateId: string,
  scheduledFor?: string
): Promise<StudyItem> {
  // Fetch candidate
  const { data: candidateData, error: candidateError } = await (supabase.from('hunter_rule_candidates') as any)
    .select('*')
    .eq('id', ruleCandidateId)
    .single();

  if (candidateError || !candidateData) {
    throw new Error(`Failed to fetch candidate ${ruleCandidateId}: ${candidateError?.message}`);
  }

  // Create study queue item
  const studyItemId = `study-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const studyItem: StudyItem = {
    id: studyItemId,
    rule_candidate_id: ruleCandidateId,
    rule_type: candidateData.rule_type as RuleType,
    rule_text: candidateData.rule_text,
    source_lead_id: candidateData.source_lead_id,
    deferred_at: new Date().toISOString(),
    reviewed: false,
  };

  const queueRecord: any = {
    id: studyItemId,
    rule_candidate_id: ruleCandidateId,
    rule_type: candidateData.rule_type,
    rule_text: candidateData.rule_text,
    source_lead_id: candidateData.source_lead_id,
    deferred_at: studyItem.deferred_at,
    scheduled_for: scheduledFor,
    reviewed: false,
  };

  const { error: insertError } = await (supabase.from('hunter_study_queue') as any).insert([queueRecord]);

  if (insertError) {
    throw new Error(`Failed to create study queue item: ${insertError.message}`);
  }

  return studyItem;
}

/**
 * Retrieves all items in the study queue
 */
export async function getStudyQueue(): Promise<StudyItem[]> {
  const { data, error } = await (supabase.from('hunter_study_queue') as any)
    .select('*')
    .eq('reviewed', false)
    .order('deferred_at', { ascending: true });

  if (error) {
    console.error('Failed to fetch study queue:', error);
    return [];
  }

  return (data || []).map((item: any) => ({
    id: item.id,
    rule_candidate_id: item.rule_candidate_id,
    rule_type: item.rule_type as RuleType,
    rule_text: item.rule_text,
    source_lead_id: item.source_lead_id,
    deferred_at: item.deferred_at,
    reviewed: item.reviewed,
  }));
}

/**
 * Marks a study queue item as reviewed
 * Optionally approves or rejects the associated rule candidate
 */
export async function reviewStudyItem(
  studyItemId: string,
  action: 'approve' | 'reject' | 'defer',
  userId?: string,
  rejectionReason?: string
): Promise<void> {
  // Fetch study item
  const { data: studyData, error: studyError } = await (supabase.from('hunter_study_queue') as any)
    .select('*')
    .eq('id', studyItemId)
    .single();

  if (studyError || !studyData) {
    throw new Error(`Failed to fetch study item: ${studyError?.message}`);
  }

  // Mark as reviewed
  const { error: updateError } = await (supabase.from('hunter_study_queue') as any)
    .update({ reviewed: true })
    .eq('id', studyItemId);

  if (updateError) {
    console.error(`Failed to mark study item ${studyItemId} as reviewed:`, updateError);
  }

  // Handle action
  if (action === 'approve' && userId) {
    await approveRule(studyData.rule_candidate_id, userId);
  } else if (action === 'reject') {
    await rejectRule(studyData.rule_candidate_id, rejectionReason);
  }
  // action === 'defer' does nothing additional
}

export default {
  startDebrief,
  extractLessons,
  approveRule,
  rejectRule,
  deferStudySession,
  getStudyQueue,
  reviewStudyItem,
};
