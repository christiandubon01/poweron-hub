/**
 * src/types/index.ts — Shared type definitions for the PowerOn app.
 */

/** The five agent modes that control which agents are active and what UI panels are visible. */
export type AgentMode = 'standard' | 'field' | 'office' | 'estimating' | 'executive'

// ── E13 | n8n Automation Layer ─────────────────────────────────────────────────

/** Identifies which background automation a rule is associated with. */
export type AutomationTrigger =
  | 'lead_intake'
  | 'invoice_followup'
  | 'daily_briefing'
  | 'receipt_processing'
  | 'review_monitor'

/** A single automation rule managed in the n8n Automation view. */
export interface AutomationRule {
  id: string
  name: string
  trigger: AutomationTrigger
  active: boolean
  lastRun?: string
  nextRun?: string
  runCount: number
}

/** A single log entry recording one execution of an automation rule. */
export interface AutomationLog {
  id: string
  ruleId: string
  ruleName: string
  triggeredAt: string
  status: 'success' | 'failed'
  message: string
}
