/**
 * src/services/guardian/GuardianBoundaryDetector.ts
 * GRD4 — GUARDIAN Boundary Violation Detection
 *
 * Monitors: field logs, NEXUS voice entries, CHRONO clock-in data.
 * Detects when a Tier 1 or Tier 2 worker performs an action above their authority.
 * On detection: fires the 5-step intelligence loop (GuardianIntelligenceLoop).
 * Alert delivered to owner within 60 seconds.
 * Violation record stored permanently in guardian_violations (never deleted).
 *
 * Supabase tables used:
 *   guardian_violations    — permanent violation records
 *   crew_members           — worker identity + tier lookup
 */

import { supabase } from '@/lib/supabase';
import { callClaude } from '@/services/claudeService';
import {
  getWorkerTier,
  ACTION_TIER_REQUIREMENTS,
  type WorkerTier,
} from './GuardianPermissionTiers';

// ─── Violation Record ─────────────────────────────────────────────────────────

export interface GuardianViolationRecord {
  id: string;
  created_at: string;

  // Worker info
  worker_id: string;
  worker_name: string;
  worker_tier: WorkerTier;

  // What happened
  action_type: string;
  tier_required: WorkerTier;
  description: string;

  // Source of detection
  source: ViolationSource;
  source_entry_id?: string;    // field_log.id / voice_entry.id / clock_entry.id

  // Impact assessment
  impact_level: ImpactLevel;
  impact_description: string;

  // Resolution
  corrective_template?: string;  // Claude-generated conversation template
  corrective_action_taken?: string;
  reviewed_by_owner: boolean;
  reviewed_at?: string;

  // Prevention
  prevention_rule: string;
}

export type ViolationSource =
  | 'field_log'
  | 'nexus_voice'
  | 'chrono_clock'
  | 'manual';

export type ImpactLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ─── Detection Input Types ────────────────────────────────────────────────────

export interface FieldLogEntry {
  id: string;
  worker_id: string;
  worker_name: string;
  project_id: string;
  date: string;
  note: string;
  hours: number;
  materials?: string;
}

export interface NexusVoiceEntry {
  id: string;
  worker_id: string;
  worker_name: string;
  transcript: string;
  timestamp: string;
  project_id?: string;
}

export interface ChronoClockEntry {
  id: string;
  worker_id: string;
  worker_name: string;
  event_type: 'clock_in' | 'clock_out' | 'break_start' | 'break_end';
  timestamp: string;
  location?: string;
  project_id?: string;
  notes?: string;
}

// ─── Boundary Violation Signal ────────────────────────────────────────────────

export interface BoundaryViolationSignal {
  worker_id: string;
  worker_name: string;
  action_type: string;
  source: ViolationSource;
  source_entry_id: string;
  raw_content: string;
  detected_at: string;
}

// ─── Violation Detection Payload ──────────────────────────────────────────────

export interface ViolationDetectionPayload {
  worker_id: string;
  worker_name: string;
  action_type: string;
  source: ViolationSource;
  source_entry_id?: string;
  description: string;
  impact_level?: ImpactLevel;
  impact_description?: string;
}

// ─── Keyword Pattern → Action Type Map ───────────────────────────────────────

/**
 * Language patterns that indicate a worker may be acting above their authority.
 * Each entry maps a regex pattern to the inferred action_type.
 */
const LANGUAGE_PATTERNS: Array<{ pattern: RegExp; action_type: string; description: string }> = [
  // Scope change indicators
  {
    pattern: /\b(told|said|told them|agreed|we('ll| will)|going to add|adding|we can add|added scope)\b/i,
    action_type: 'approve_scope_change',
    description: 'Possible verbal scope agreement with customer or GC.',
  },
  {
    pattern: /\b(scope change|change order|extra work|additional work|out of scope|beyond scope)\b/i,
    action_type: 'approve_scope_change',
    description: 'Scope change or change order language detected.',
  },
  // Material substitution
  {
    pattern: /\b(swapped|substituted|changed the (wire|conduit|panel|breaker|material)|used .* instead|different (brand|size|gauge))\b/i,
    action_type: 'approve_material_substitution',
    description: 'Material substitution language detected in log.',
  },
  // GC / customer communication about scope
  {
    pattern: /\b(told the GC|GC asked|customer asked|told the customer|explained to (the )?GC|informed (the )?GC|discussed with GC|GC wants|customer wants|promised|committed to)\b/i,
    action_type: 'communicate_scope_to_gc',
    description: 'Direct scope communication with GC or customer detected.',
  },
  // Schedule changes
  {
    pattern: /\b(moved the schedule|rescheduled|pushed back|delayed|changed the date|told .* (we('d| would)|we're) (be there|coming|starting|finishing))\b/i,
    action_type: 'approve_schedule_change',
    description: 'Schedule change language detected.',
  },
  // RFI responses
  {
    pattern: /\b(answered|responded to|told them (the answer|how to|where to|what to)|explained to (the )?inspector|inspector asked)\b/i,
    action_type: 'respond_to_rfi',
    description: 'Possible RFI response or direct technical answer to inspector/GC.',
  },
  // Work outside task assignment
  {
    pattern: /\b(wasn't on my list|not (on|in) (my|the) (scope|plan|task)|started .* on my own|did (some|extra|additional) work on)\b/i,
    action_type: 'execute_defined_scope',
    description: 'Work performed outside assigned task scope.',
  },
];

// ─── analyzeFieldLog ──────────────────────────────────────────────────────────

/**
 * Scans a field log entry for language indicating a boundary violation.
 * Returns a BoundaryViolationSignal if a violation pattern is detected, else null.
 */
export function analyzeFieldLog(entry: FieldLogEntry): BoundaryViolationSignal | null {
  const text = [entry.note, entry.materials ?? ''].join(' ');

  for (const { pattern, action_type, description } of LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        worker_id:      entry.worker_id,
        worker_name:    entry.worker_name,
        action_type,
        source:         'field_log',
        source_entry_id: entry.id,
        raw_content:    text,
        detected_at:    new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── analyzeVoiceEntry ────────────────────────────────────────────────────────

/**
 * Scans a NEXUS voice transcript for boundary violation language.
 */
export function analyzeVoiceEntry(entry: NexusVoiceEntry): BoundaryViolationSignal | null {
  for (const { pattern, action_type } of LANGUAGE_PATTERNS) {
    if (pattern.test(entry.transcript)) {
      return {
        worker_id:       entry.worker_id,
        worker_name:     entry.worker_name,
        action_type,
        source:          'nexus_voice',
        source_entry_id: entry.id,
        raw_content:     entry.transcript,
        detected_at:     new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── analyzeClockEntry ────────────────────────────────────────────────────────

/**
 * Checks CHRONO clock-in data for schedule anomalies or notes that indicate
 * a worker is operating outside their assigned project or schedule.
 */
export function analyzeClockEntry(entry: ChronoClockEntry): BoundaryViolationSignal | null {
  if (!entry.notes) return null;

  for (const { pattern, action_type } of LANGUAGE_PATTERNS) {
    if (pattern.test(entry.notes)) {
      return {
        worker_id:       entry.worker_id,
        worker_name:     entry.worker_name,
        action_type,
        source:          'chrono_clock',
        source_entry_id: entry.id,
        raw_content:     entry.notes,
        detected_at:     new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── determineImpactLevel ─────────────────────────────────────────────────────

function determineImpactLevel(actionType: string, workerTier: WorkerTier): ImpactLevel {
  const tierRequired: WorkerTier = ACTION_TIER_REQUIREMENTS[actionType] ?? 1;
  const tierGap = tierRequired - workerTier;

  if (actionType === 'approve_scope_change' || actionType === 'approve_change_order') return 'CRITICAL';
  if (actionType === 'communicate_scope_to_gc' || actionType === 'respond_to_rfi') return 'HIGH';
  if (actionType === 'approve_material_substitution') return tierGap >= 2 ? 'HIGH' : 'MEDIUM';
  if (actionType === 'approve_schedule_change') return 'HIGH';
  if (tierGap >= 2) return 'HIGH';
  if (tierGap === 1) return 'MEDIUM';
  return 'LOW';
}

function buildImpactDescription(actionType: string, workerName: string): string {
  const impacts: Record<string, string> = {
    approve_scope_change:    `Unauthorized scope agreement may create a contractual obligation PowerOn has not priced or approved. This exposes the company to unpaid work or legal disputes.`,
    approve_change_order:    `Unauthorized change order agreement may create binding contractual changes. Owner signature required for all scope and value changes.`,
    communicate_scope_to_gc: `Direct scope communication with GC without owner approval may create unintended commitments or misrepresent PowerOn's position.`,
    respond_to_rfi:          `RFI responses are contractual documents. Unauthorized responses may bind PowerOn to technical or schedule positions not reviewed by the owner.`,
    approve_schedule_change: `Schedule changes affecting other trades require owner review. Unauthorized changes can impact subcontractor coordination and project billing.`,
    approve_material_substitution: `Material substitutions outside spec may affect inspections, warranty, and contract compliance. Minor substitutions require foreman approval with documentation; major substitutions require owner approval.`,
  };

  return impacts[actionType] ??
    `${workerName} performed an action that requires a higher authority tier. This may create unintended commitments or expose PowerOn to risk.`;
}

function buildPreventionRule(actionType: string): string {
  const rules: Record<string, string> = {
    approve_scope_change:    `All scope changes — verbal or written — must be escalated to the owner immediately. Worker should say: "I'll need to check with Christian before we commit to that."`,
    approve_change_order:    `Change orders require owner review and signature. Worker should not agree to additional work items under any circumstances without owner approval.`,
    communicate_scope_to_gc: `All GC scope questions must be directed to the owner. Worker should say: "I'll have Christian get in touch with you on that."`,
    respond_to_rfi:          `RFI responses are owner-only. Worker should forward RFIs to owner via GUARDIAN immediately. Do not answer technical or schedule questions from inspectors or GC directly.`,
    approve_schedule_change: `Any request to change schedule must be forwarded to owner. Worker should say: "I can't commit to that — Christian handles scheduling."`,
    approve_material_substitution: `Tier 1 crew may not approve any substitutions. Foreman may approve minor in-spec substitutions with documented reason. Anything outside spec requires owner approval before proceeding.`,
  };

  return rules[actionType] ??
    `When in doubt, stop and contact the owner through GUARDIAN before proceeding. Never make commitments on behalf of PowerOn without explicit authorization.`;
}

// ─── generateViolationRecord ──────────────────────────────────────────────────

/**
 * Creates a formal GuardianViolationRecord from detection payload.
 * Persists it to guardian_violations in Supabase.
 * Records are permanent — never deleted.
 *
 * @param data  ViolationDetectionPayload
 * @returns     The created GuardianViolationRecord
 */
export async function generateViolationRecord(
  data: ViolationDetectionPayload,
): Promise<GuardianViolationRecord> {
  const workerTier = await getWorkerTier(data.worker_id);
  const tierRequired: WorkerTier = ACTION_TIER_REQUIREMENTS[data.action_type] ?? 1;
  const impactLevel   = data.impact_level ?? determineImpactLevel(data.action_type, workerTier);
  const impactDesc    = data.impact_description ?? buildImpactDescription(data.action_type, data.worker_name);
  const preventionRule = buildPreventionRule(data.action_type);

  const record: GuardianViolationRecord = {
    id:           `gviol_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at:   new Date().toISOString(),
    worker_id:    data.worker_id,
    worker_name:  data.worker_name,
    worker_tier:  workerTier,
    action_type:  data.action_type,
    tier_required: tierRequired,
    description:  data.description,
    source:       data.source,
    source_entry_id: data.source_entry_id,
    impact_level:  impactLevel,
    impact_description: impactDesc,
    reviewed_by_owner: false,
    prevention_rule:   preventionRule,
  };

  // Persist to Supabase — permanent, never deleted
  // Cast as any: guardian_violations is not yet in db/types.ts (migration pending)
  try {
    const { error } = await (supabase as any)
      .from('guardian_violations')
      .insert({
        id:               record.id,
        created_at:       record.created_at,
        worker_id:        record.worker_id,
        worker_name:      record.worker_name,
        worker_tier:      record.worker_tier,
        action_type:      record.action_type,
        tier_required:    record.tier_required,
        description:      record.description,
        source:           record.source,
        source_entry_id:  record.source_entry_id ?? null,
        impact_level:     record.impact_level,
        impact_description: record.impact_description,
        reviewed_by_owner: false,
        prevention_rule:  record.prevention_rule,
      });

    if (error) {
      console.error('[GuardianBoundaryDetector] Failed to persist violation record:', error);
    }
  } catch (err) {
    console.error('[GuardianBoundaryDetector] Supabase insert error:', err);
  }

  return record;
}

// ─── generateCorrectiveConversationTemplate ───────────────────────────────────

/**
 * Uses Claude to generate a professional but firm conversation template
 * for addressing the boundary violation with the worker.
 *
 * Tone: direct, not punitive. Focus on the rule, not the person.
 * Structure: what happened → why it matters → what the boundary is → what happens next time.
 *
 * @param violation  The GuardianViolationRecord to generate a template for
 * @returns          The corrective conversation template string
 */
export async function generateCorrectiveConversationTemplate(
  violation: GuardianViolationRecord,
): Promise<string> {
  const tierLabels: Record<WorkerTier, string> = { 1: 'Field Crew', 2: 'Foreman', 3: 'Owner' };

  const prompt = `
Generate a professional but firm conversation template for addressing this boundary violation with a field worker.

WORKER: ${violation.worker_name}
ROLE: Tier ${violation.worker_tier} — ${tierLabels[violation.worker_tier]}
VIOLATION: ${violation.description}
ACTION PERFORMED: ${violation.action_type.replace(/_/g, ' ')}
AUTHORITY REQUIRED: Tier ${violation.tier_required} — ${tierLabels[violation.tier_required]}
IMPACT: ${violation.impact_description}
DATE: ${new Date(violation.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

RULES FOR THIS TEMPLATE:
- Tone: direct, not punitive. Focus on the rule, not the person.
- Acknowledge the worker's intent may have been good.
- Clearly state what happened and why it matters to the business.
- State the boundary clearly: what they can and cannot do.
- State what happens next time this boundary is crossed.
- Keep it under 300 words.
- Format: paragraph style, not bullet points.
- Start with: "Hey [worker name], I want to talk with you about something that came up on [date]."

Generate the conversation template now:
`.trim();

  try {
    const response = await callClaude({
      prompt,
      system: `You are Christian, the owner of Power On Solutions LLC, a California electrical contractor. 
You are addressing a field worker or foreman about a boundary violation — a situation where they made 
a decision or took an action that was above their authority tier. Your goal is to protect the business, 
maintain clear authority lines, and coach the worker constructively. Be direct, fair, and professional.`,
      maxTokens: 600,
    });

    return response.text.trim();
  } catch (err) {
    console.error('[GuardianBoundaryDetector] Claude template generation failed:', err);
    return buildFallbackTemplate(violation);
  }
}

function buildFallbackTemplate(violation: GuardianViolationRecord): string {
  const tierLabels: Record<WorkerTier, string> = { 1: 'Field Crew', 2: 'Foreman', 3: 'Owner' };
  const date = new Date(violation.created_at).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return `Hey ${violation.worker_name}, I want to talk with you about something that came up on ${date}.

It looks like you made a decision involving ${violation.action_type.replace(/_/g, ' ')}. I understand you were probably trying to keep things moving, and I appreciate that. But this is a decision that has to come through me.

Here's why it matters: ${violation.impact_description}

Your role as a ${tierLabels[violation.worker_tier]} is clear — you handle execution and documentation, and anything that involves commitments, scope, or communication with the GC or customer comes to me first. When in doubt, the right move is always to stop and flag it through GUARDIAN. That's what it's there for.

Going forward, if this comes up again, it becomes a formal performance issue that goes in your record. I'm not trying to be difficult — I just need to protect the business and keep everyone on the right side of our contracts.

Prevention: ${violation.prevention_rule}

Let me know if you have any questions. I want us to stay on the same page.`;
}

// ─── 5-Step Intelligence Loop ─────────────────────────────────────────────────

/**
 * GuardianIntelligenceLoop — Fires when a boundary violation is detected.
 *
 * Step 1: Confirm worker tier and action tier mismatch
 * Step 2: Generate violation record and persist to guardian_violations
 * Step 3: Generate corrective conversation template via Claude
 * Step 4: Attach template to violation record (update Supabase)
 * Step 5: Dispatch alert to owner (60-second SLA)
 *
 * @param signal  BoundaryViolationSignal from field/voice/clock analysis
 */
export async function GuardianIntelligenceLoop(
  signal: BoundaryViolationSignal,
): Promise<GuardianViolationRecord> {
  const loopStart = Date.now();

  console.info(`[GUARDIAN] Intelligence loop triggered for worker ${signal.worker_name} — action: ${signal.action_type}`);

  // ── Step 1: Confirm tier mismatch ────────────────────────────────────────
  const workerTier = await getWorkerTier(signal.worker_id);
  const tierRequired: WorkerTier = ACTION_TIER_REQUIREMENTS[signal.action_type] ?? 1;

  if (workerTier >= tierRequired) {
    // No actual violation — worker has the authority
    console.info(`[GUARDIAN] No violation — worker tier ${workerTier} meets required tier ${tierRequired}`);
    // Return a minimal non-persisted record for logging purposes
    return {
      id:               `gviol_noop_${Date.now()}`,
      created_at:       new Date().toISOString(),
      worker_id:        signal.worker_id,
      worker_name:      signal.worker_name,
      worker_tier:      workerTier,
      action_type:      signal.action_type,
      tier_required:    tierRequired,
      description:      'No violation — worker tier sufficient.',
      source:           signal.source,
      source_entry_id:  signal.source_entry_id,
      impact_level:     'LOW',
      impact_description: 'No impact — worker was authorized.',
      reviewed_by_owner: true,
      prevention_rule:  'No action required.',
    };
  }

  // ── Step 2: Generate and persist violation record ────────────────────────
  const violation = await generateViolationRecord({
    worker_id:    signal.worker_id,
    worker_name:  signal.worker_name,
    action_type:  signal.action_type,
    source:       signal.source,
    source_entry_id: signal.source_entry_id,
    description:  `${signal.worker_name} (Tier ${workerTier}) performed action "${signal.action_type}" which requires Tier ${tierRequired}. Detected via ${signal.source}. Content: "${signal.raw_content.slice(0, 200)}"`,
  });

  // ── Step 3: Generate corrective conversation template ────────────────────
  const template = await generateCorrectiveConversationTemplate(violation);

  // ── Step 4: Attach template to violation record in Supabase ─────────────
  violation.corrective_template = template;

  try {
    await (supabase as any)
      .from('guardian_violations')
      .update({ corrective_template: template })
      .eq('id', violation.id);
  } catch (err) {
    console.error('[GUARDIAN] Failed to attach corrective template to violation:', err);
  }

  // ── Step 5: Dispatch owner alert (60-second SLA) ─────────────────────────
  const elapsed = Date.now() - loopStart;
  const remaining = Math.max(0, 60_000 - elapsed);

  // Dispatch via alert mechanism — fire within the 60s window
  setTimeout(() => {
    dispatchOwnerAlert(violation);
  }, remaining);

  console.info(`[GUARDIAN] Loop complete — violation ${violation.id} — alert dispatched in ${elapsed + remaining}ms`);

  return violation;
}

// ─── dispatchOwnerAlert ───────────────────────────────────────────────────────

/**
 * Fires an alert to the owner.
 * Currently logs to console and Supabase guardian_audit_log.
 * In production: integrate with push notification / SMS service.
 */
async function dispatchOwnerAlert(violation: GuardianViolationRecord): Promise<void> {
  const tierLabels: Record<WorkerTier, string> = { 1: 'Field Crew', 2: 'Foreman', 3: 'Owner' };

  const alertMessage = `⚠️ GUARDIAN ALERT: ${violation.worker_name} (${tierLabels[violation.worker_tier]}) performed "${violation.action_type.replace(/_/g, ' ')}" — ${violation.impact_level} impact. Violation ID: ${violation.id}`;

  console.warn('[GUARDIAN OWNER ALERT]', alertMessage);

  // Log to guardian_audit_log — cast as any: table not yet in db/types.ts
  try {
    await (supabase as any)
      .from('guardian_audit_log')
      .insert({
        id:           `gal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        created_at:   new Date().toISOString(),
        action:       'BOUNDARY_VIOLATION_ALERT',
        result:       alertMessage,
        violation_id: violation.id,
        worker_id:    violation.worker_id,
        impact_level: violation.impact_level,
      });
  } catch (err) {
    console.error('[GUARDIAN] Failed to write audit log entry:', err);
  }
}

// ─── monitorFieldLog ──────────────────────────────────────────────────────────

/**
 * Entry point: analyze a new field log entry for boundary violations.
 * Call this whenever a field log is submitted.
 */
export async function monitorFieldLog(entry: FieldLogEntry): Promise<GuardianViolationRecord | null> {
  const signal = analyzeFieldLog(entry);
  if (!signal) return null;
  return GuardianIntelligenceLoop(signal);
}

// ─── monitorVoiceEntry ────────────────────────────────────────────────────────

/**
 * Entry point: analyze a NEXUS voice transcript for boundary violations.
 * Call this whenever a voice entry is transcribed.
 */
export async function monitorVoiceEntry(entry: NexusVoiceEntry): Promise<GuardianViolationRecord | null> {
  const signal = analyzeVoiceEntry(entry);
  if (!signal) return null;
  return GuardianIntelligenceLoop(signal);
}

// ─── monitorClockEntry ────────────────────────────────────────────────────────

/**
 * Entry point: analyze a CHRONO clock-in note for boundary violations.
 * Call this whenever a clock event with notes is recorded.
 */
export async function monitorClockEntry(entry: ChronoClockEntry): Promise<GuardianViolationRecord | null> {
  const signal = analyzeClockEntry(entry);
  if (!signal) return null;
  return GuardianIntelligenceLoop(signal);
}

// ─── getViolationsByWorker ────────────────────────────────────────────────────

/**
 * Fetches all violation records for a given worker from guardian_violations.
 * Records are permanent — this always returns the full history.
 */
export async function getViolationsByWorker(
  workerId: string,
): Promise<GuardianViolationRecord[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('guardian_violations')
      .select('*')
      .eq('worker_id', workerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GuardianBoundaryDetector] getViolationsByWorker error:', error);
      return [];
    }

    return (data ?? []) as unknown as GuardianViolationRecord[];
  } catch (err) {
    console.error('[GuardianBoundaryDetector] getViolationsByWorker exception:', err);
    return [];
  }
}

// ─── getAllViolations ─────────────────────────────────────────────────────────

/**
 * Fetches all violation records across all workers.
 * Sorted by most recent first.
 */
export async function getAllViolations(): Promise<GuardianViolationRecord[]> {
  try {
    const { data, error } = await (supabase as any)
      .from('guardian_violations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GuardianBoundaryDetector] getAllViolations error:', error);
      return [];
    }

    return (data ?? []) as unknown as GuardianViolationRecord[];
  } catch (err) {
    console.error('[GuardianBoundaryDetector] getAllViolations exception:', err);
    return [];
  }
}

// ─── markViolationReviewed ────────────────────────────────────────────────────

/**
 * Marks a violation as reviewed by the owner.
 * Updates reviewed_by_owner and reviewed_at in Supabase.
 */
export async function markViolationReviewed(
  violationId: string,
  correctiveActionTaken?: string,
): Promise<void> {
  try {
    await (supabase as any)
      .from('guardian_violations')
      .update({
        reviewed_by_owner:       true,
        reviewed_at:             new Date().toISOString(),
        corrective_action_taken: correctiveActionTaken ?? null,
      })
      .eq('id', violationId);
  } catch (err) {
    console.error('[GuardianBoundaryDetector] markViolationReviewed error:', err);
  }
}

// ─── createManualViolation ────────────────────────────────────────────────────

/**
 * Creates a manual violation record for incidents not auto-detected.
 * Owner or foreman can log this directly from the GuardianViolationPanel.
 */
export async function createManualViolation(
  payload: ViolationDetectionPayload & { generate_template?: boolean },
): Promise<GuardianViolationRecord> {
  const record = await generateViolationRecord({
    ...payload,
    source: 'manual',
  });

  if (payload.generate_template) {
    const template = await generateCorrectiveConversationTemplate(record);
    record.corrective_template = template;

    await (supabase as any)
      .from('guardian_violations')
      .update({ corrective_template: template })
      .eq('id', record.id);
  }

  return record;
}
