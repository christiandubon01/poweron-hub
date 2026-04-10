/**
 * GuardianIntelligenceLoop.ts
 * THE 5-STEP INTELLIGENCE LOOP — runs on every flagged event.
 *
 * Power On Solutions LLC (C-10 #1151468)
 *
 * Step 1 — FLAG:                  What happened and when.
 * Step 2 — IMPACT ANALYSIS:       Legal, financial, operational exposure.
 * Step 3 — CORRECTIVE ACTION:     Exact opposite action needed.
 * Step 4 — EMPLOYEE DOCUMENTATION: Record entry + required conversation.
 * Step 5 — PREVENTION RULE:       Permanent system rule.
 */

import { callClaude } from '@/services/claudeProxy';
import {
  GuardianAlert,
  GuardianAlertInsert,
  GuardianEvent,
  GuardianLoopOutput,
  AlertStatus,
  Severity,
} from './GuardianTypes';

// ─── Supabase client (lazy import to avoid import cycles) ─────
// Imported dynamically so this service works even before Supabase
// environment variables are confirmed at build time.
async function getSupabase() {
  const { supabase } = await import('@/lib/supabase');
  return supabase;
}

// ─── System Prompt ────────────────────────────────────────────

const GUARDIAN_SYSTEM_PROMPT = `You are GUARDIAN, the compliance and protection agent for Power On Solutions LLC (C-10 #1151468).
An event has been flagged. Execute the 5-step intelligence loop:

Step 1 — FLAG: What happened and when. Specific, timestamped, tied to project and worker.
Step 2 — IMPACT ANALYSIS: How this creates legal, financial, or operational exposure. Plain language.
Step 3 — CORRECTIVE ACTION: The exact opposite action needed. Specific steps.
Step 4 — EMPLOYEE DOCUMENTATION: What gets added to their record, what conversation is needed.
Step 5 — PREVENTION RULE: What system change prevents recurrence. Written as a permanent rule.

Output ONLY valid JSON with this exact shape — no markdown, no explanation outside the JSON:
{
  "flag": "string",
  "impact_analysis": "string",
  "corrective_action": "string",
  "employee_documentation": "string",
  "prevention_rule": "string",
  "severity": "critical" | "warning" | "info"
}`;

// ─── processAlert ─────────────────────────────────────────────

/**
 * Orchestrates the full 5-step GUARDIAN intelligence loop for a flagged event.
 * Calls Claude, parses the structured output, persists the alert, and
 * escalates if severity is critical.
 *
 * @param event - The raw flagged event from any trigger source
 * @returns The persisted GuardianAlert record
 */
export async function processAlert(event: GuardianEvent): Promise<GuardianAlert> {
  const timestamp = event.timestamp ?? new Date().toISOString();

  const userPrompt = `Event: ${JSON.stringify({
    alert_type: event.alert_type,
    project_id: event.project_id ?? null,
    worker_id:  event.worker_id  ?? null,
    description: event.description,
    timestamp,
    context: event.context ?? {},
  }, null, 2)}`;

  // --- Call Claude ---
  let loopOutput: GuardianLoopOutput;

  try {
    const response = await callClaude({
      system: GUARDIAN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 1024,
    });

    const raw = response.content?.[0]?.text ?? '';

    // Strip potential markdown code fences before parsing
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    loopOutput = JSON.parse(jsonText) as GuardianLoopOutput;
  } catch (err) {
    console.error('[GUARDIAN] Intelligence loop Claude call failed:', err);
    // Fallback — create a minimal output so the alert is still persisted
    loopOutput = {
      flag:                   `Event flagged at ${timestamp}: ${event.description}`,
      impact_analysis:        'Unable to compute — manual review required.',
      corrective_action:      'Review event manually and take appropriate action.',
      employee_documentation: 'Document event in personnel record pending review.',
      prevention_rule:        'Review process for ' + event.alert_type + ' events.',
      severity:               Severity.WARNING,
    };
  }

  // --- Build alert insert payload ---
  // user_id is populated at the Supabase layer via auth.uid() RLS;
  // we pass the value from the authenticated session.
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const alertInsert: GuardianAlertInsert = {
    user_id:                user?.id ?? '',
    project_id:             event.project_id ?? null,
    worker_id:              event.worker_id  ?? null,
    alert_type:             event.alert_type,
    severity:               loopOutput.severity,
    flag:                   loopOutput.flag,
    impact_analysis:        loopOutput.impact_analysis,
    corrective_action:      loopOutput.corrective_action,
    employee_documentation: loopOutput.employee_documentation,
    prevention_rule:        loopOutput.prevention_rule,
    status:                 AlertStatus.OPEN,
    acknowledged_by:        null,
    resolved_at:            null,
  };

  // --- Persist ---
  const savedAlert = await saveAlert(alertInsert);

  // --- Escalate critical alerts ---
  if (loopOutput.severity === Severity.CRITICAL) {
    await escalateAlert(savedAlert.id);
  }

  return savedAlert;
}

// ─── saveAlert ────────────────────────────────────────────────

/**
 * Writes a fully assembled alert to the guardian_alerts table.
 */
export async function saveAlert(alertData: GuardianAlertInsert): Promise<GuardianAlert> {
  const supabase = await getSupabase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('guardian_alerts')
    .insert(alertData)
    .select()
    .single();

  if (error) {
    console.error('[GUARDIAN] saveAlert failed:', error);
    throw new Error(`GUARDIAN saveAlert: ${error.message}`);
  }

  return data as GuardianAlert;
}

// ─── escalateAlert ───────────────────────────────────────────

/**
 * Sends a push / in-app notification for a critical alert.
 * Wires to the notifications service; gracefully no-ops if unavailable.
 */
export async function escalateAlert(alertId: string): Promise<void> {
  try {
    // Dynamic import so the build stays clean if notifications service
    // has not been integrated yet.
    const { sendNotification } = await import('@/services/notifications');

    await sendNotification({
      notification: {
        // 'guardian_alert' will be added to NotificationType on integration;
        // cast as any to avoid blocking the build.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type:  'guardian_alert' as any,
        title: '🚨 GUARDIAN — Critical Alert',
        body:  `A critical compliance event requires immediate attention. Alert ID: ${alertId}`,
        data:  { alertId, source: 'guardian' },
      },
    });
  } catch (err) {
    // Notifications service not yet wired — log and continue
    console.warn('[GUARDIAN] escalateAlert: push notification unavailable', err);
  }
}

// ─── resolveAlert ────────────────────────────────────────────

/**
 * Marks an alert as resolved and records resolution notes.
 */
export async function resolveAlert(
  alertId:    string,
  resolution: string,
): Promise<void> {
  const supabase = await getSupabase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('guardian_alerts')
    .update({
      status:      AlertStatus.RESOLVED,
      resolved_at: new Date().toISOString(),
      corrective_action: resolution,
    })
    .eq('id', alertId);

  if (error) {
    console.error('[GUARDIAN] resolveAlert failed:', error);
    throw new Error(`GUARDIAN resolveAlert: ${error.message}`);
  }
}

// ─── getOpenAlerts ───────────────────────────────────────────

/**
 * Returns all unresolved alerts for the current user, sorted by severity
 * (critical first) then by created_at descending.
 */
export async function getOpenAlerts(): Promise<GuardianAlert[]> {
  const supabase = await getSupabase();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('guardian_alerts')
    .select('*')
    .neq('status', AlertStatus.RESOLVED)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GUARDIAN] getOpenAlerts failed:', error);
    throw new Error(`GUARDIAN getOpenAlerts: ${error.message}`);
  }

  // Sort: critical → warning → info
  const severityOrder: Record<string, number> = {
    critical: 0,
    warning:  1,
    info:     2,
  };

  return (data as GuardianAlert[]).sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
  );
}
