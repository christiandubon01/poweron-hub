/**
 * feedbackLoopService.ts — B29 Feedback Loops
 *
 * T1 — Passive feedback: silent logging of user dismissals and ignored NEXUS recommendations.
 * T2 — Micro feedback: thumbs up/down on NEXUS AI responses.
 *
 * All entries are logged to Supabase `audit_decisions` table (fire-and-forget).
 * No UI feedback to the user from T1 logs.
 * T2 data is reserved for future NEXUS prompt tuning — do not use for anything else yet.
 */

import { syncToSupabase } from './supabaseService';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FeedbackDecisionType =
  | 'dismissed_alert'
  | 'ignored_recommendation'
  | 'thumbs_up'
  | 'thumbs_down';

export interface AuditDecisionEntry {
  id: string;
  agent: string;
  decision_type: FeedbackDecisionType;
  alert_content?: string;
  recommendation_preview?: string;
  response_preview?: string;
  feedback?: 'up' | 'down';
  dismissed_at?: string;
  timestamp: string;
  org_id?: string;
}

export interface AgentFeedbackRatio {
  agent: string;
  up: number;
  down: number;
  total: number;
  /** 0.0–1.0 proportion of thumbs up */
  ratio: number;
}

// ── In-memory store ───────────────────────────────────────────────────────────

const _feedbackStore: AuditDecisionEntry[] = [];

function generateId(): string {
  return `fd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Fire-and-forget Supabase write — never throws to caller */
function silentSync(entry: AuditDecisionEntry): void {
  syncToSupabase({
    table: 'audit_decisions',
    data: entry as unknown as Record<string, unknown>,
    operation: 'insert',
  }).catch((err) => {
    console.warn('[feedbackLoopService] Supabase sync failed:', err);
  });
}

// ── T1: Dismissed Alert ───────────────────────────────────────────────────────

/**
 * logDismissedAlert
 *
 * Called silently when user dismisses a ProactiveAlertCards alert.
 * Logs to audit_decisions with decision_type: 'dismissed_alert'.
 */
export function logDismissedAlert(params: {
  agent: string;
  alert_content: string;
  org_id?: string;
}): void {
  const entry: AuditDecisionEntry = {
    id: generateId(),
    agent: params.agent,
    decision_type: 'dismissed_alert',
    alert_content: params.alert_content,
    dismissed_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    org_id: params.org_id,
  };
  _feedbackStore.unshift(entry);
  silentSync(entry);
}

// ── T1: Ignored Recommendation ────────────────────────────────────────────────

/**
 * logIgnoredRecommendation
 *
 * Called silently when user closes the NEXUS chat panel without acting on
 * the last AI recommendation (i.e. no follow-up message or thumbs vote sent).
 * Logs to audit_decisions with decision_type: 'ignored_recommendation'.
 */
export function logIgnoredRecommendation(params: {
  recommendation_preview: string;
  org_id?: string;
}): void {
  const entry: AuditDecisionEntry = {
    id: generateId(),
    agent: 'NEXUS',
    decision_type: 'ignored_recommendation',
    recommendation_preview: params.recommendation_preview.slice(0, 100),
    timestamp: new Date().toISOString(),
    org_id: params.org_id,
  };
  _feedbackStore.unshift(entry);
  silentSync(entry);
}

// ── T2: Micro Feedback ────────────────────────────────────────────────────────

/**
 * logMicroFeedback
 *
 * Called when user taps thumbs up or thumbs down on a NEXUS response message.
 * Logs to audit_decisions with decision_type: 'thumbs_up' | 'thumbs_down'.
 * This data feeds future NEXUS prompt tuning — do not use for anything else yet.
 */
export function logMicroFeedback(params: {
  agent: string;
  response_preview: string;
  feedback: 'up' | 'down';
  org_id?: string;
}): void {
  const entry: AuditDecisionEntry = {
    id: generateId(),
    agent: params.agent,
    decision_type: params.feedback === 'up' ? 'thumbs_up' : 'thumbs_down',
    response_preview: params.response_preview.slice(0, 100),
    feedback: params.feedback,
    timestamp: new Date().toISOString(),
    org_id: params.org_id,
  };
  _feedbackStore.unshift(entry);
  silentSync(entry);
}

// ── Data access for GUARDIAN view ─────────────────────────────────────────────

/** All in-memory feedback entries (newest first) */
export function getFeedbackEntries(): AuditDecisionEntry[] {
  return [..._feedbackStore];
}

/** T1 entries only: dismissed alerts + ignored recommendations */
export function getPassiveFeedbackEntries(): AuditDecisionEntry[] {
  return _feedbackStore.filter(
    (e) =>
      e.decision_type === 'dismissed_alert' ||
      e.decision_type === 'ignored_recommendation',
  );
}

/**
 * T2 aggregate: thumbs up/down ratio per agent over the last 30 days.
 * Returns agents sorted by total feedback descending.
 */
export function getAgentFeedbackRatios(): AgentFeedbackRatio[] {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const thumbEntries = _feedbackStore.filter(
    (e) =>
      (e.decision_type === 'thumbs_up' || e.decision_type === 'thumbs_down') &&
      new Date(e.timestamp).getTime() >= cutoff,
  );

  const byAgent: Record<string, { up: number; down: number }> = {};
  for (const e of thumbEntries) {
    if (!byAgent[e.agent]) byAgent[e.agent] = { up: 0, down: 0 };
    if (e.decision_type === 'thumbs_up') byAgent[e.agent].up += 1;
    else byAgent[e.agent].down += 1;
  }

  return Object.entries(byAgent)
    .map(([agent, counts]) => {
      const total = counts.up + counts.down;
      return {
        agent,
        up: counts.up,
        down: counts.down,
        total,
        ratio: total > 0 ? counts.up / total : 0,
      };
    })
    .sort((a, b) => b.total - a.total);
}
