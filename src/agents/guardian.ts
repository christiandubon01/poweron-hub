// @ts-nocheck
/**
 * src/agents/guardian.ts — GUARDIAN Rules Engine
 *
 * Pure rule evaluation logic for the GUARDIAN agent.
 * No API calls, no side effects.
 *
 * Exports:
 *   evaluateRules(rules, data): GuardianViolation[]
 *   generateAuditEntry(action, result): GuardianAuditEntry
 *   DEFAULT_RULES: GuardianRule[]
 */

// ── Severity ───────────────────────────────────────────────────────────────────

export type ViolationSeverity = 'HIGH' | 'MEDIUM' | 'LOW'

// ── Trigger Types ──────────────────────────────────────────────────────────────

export type GuardianTriggerType =
  | 'INVOICE_OVERDUE'
  | 'LEAD_NO_FOLLOWUP'
  | 'FIELD_LOG_MISSING'
  | 'CREW_NO_HOURS'
  | 'PROJECT_HEALTH_LOW'

// ── Rule Definition ────────────────────────────────────────────────────────────

export interface GuardianRule {
  id: string
  name: string
  description: string
  triggerType: GuardianTriggerType
  severity: ViolationSeverity
  active: boolean
  /** Days threshold for time-based triggers */
  thresholdDays?: number
  /** Percentage threshold for health-based triggers */
  thresholdPercent?: number
}

// ── Violation ──────────────────────────────────────────────────────────────────

export interface GuardianViolation {
  id: string
  ruleId: string
  ruleName: string
  triggerType: GuardianTriggerType
  severity: ViolationSeverity
  subject: string
  detail: string
  detectedAt: string
}

// ── Audit Entry ────────────────────────────────────────────────────────────────

export interface GuardianAuditEntry {
  id: string
  action: string
  result: string
  violationCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  timestamp: string
}

// ── Business Data Types ────────────────────────────────────────────────────────

export interface GuardianInvoice {
  id: string
  client: string
  amount: number
  /** ISO date string (YYYY-MM-DD) */
  dueDate: string
  status: 'paid' | 'pending' | 'overdue'
}

export interface GuardianLead {
  id: string
  company: string
  /** ISO date string or null if never followed up */
  lastFollowUpDate: string | null
}

export interface GuardianFieldLog {
  id: string
  projectId: string
  projectName: string
  /** ISO date string of the most recent log entry */
  lastLogDate: string
  projectStatus: 'active' | 'inactive' | 'completed'
}

export interface GuardianCrewMember {
  id: string
  name: string
  /** Total hours logged in the current ISO week */
  hoursThisWeek: number
}

export interface GuardianProject {
  id: string
  name: string
  /** 0–100 integer */
  health: number
  status: 'active' | 'coming' | 'completed'
}

export interface GuardianData {
  invoices: GuardianInvoice[]
  leads: GuardianLead[]
  fieldLogs: GuardianFieldLog[]
  crewMembers: GuardianCrewMember[]
  projects: GuardianProject[]
}

// ── Default Rule Set ───────────────────────────────────────────────────────────

export const DEFAULT_RULES: GuardianRule[] = [
  {
    id: 'rule_invoice_overdue',
    name: 'Invoice Overdue > 30 Days',
    description: 'Flags any unpaid invoice where the due date is more than 30 days in the past.',
    triggerType: 'INVOICE_OVERDUE',
    severity: 'HIGH',
    active: true,
    thresholdDays: 30,
  },
  {
    id: 'rule_lead_no_followup',
    name: 'Lead — No Follow-Up > 7 Days',
    description: 'Flags any lead that has not received a follow-up contact in more than 7 days.',
    triggerType: 'LEAD_NO_FOLLOWUP',
    severity: 'MEDIUM',
    active: true,
    thresholdDays: 7,
  },
  {
    id: 'rule_field_log_missing',
    name: 'Field Log Missing > 3 Days',
    description: 'Flags any active project that has no field log entry submitted in more than 3 days.',
    triggerType: 'FIELD_LOG_MISSING',
    severity: 'MEDIUM',
    active: true,
    thresholdDays: 3,
  },
  {
    id: 'rule_crew_no_hours',
    name: 'Crew — No Hours This Week',
    description: 'Flags any crew member who has logged zero hours in the current work week.',
    triggerType: 'CREW_NO_HOURS',
    severity: 'LOW',
    active: true,
  },
  {
    id: 'rule_project_health_low',
    name: 'Project Health Below 40%',
    description: 'Flags any active project whose health score has fallen below 40%.',
    triggerType: 'PROJECT_HEALTH_LOW',
    severity: 'HIGH',
    active: true,
    thresholdPercent: 40,
  },
]

// ── Internal helpers ───────────────────────────────────────────────────────────

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24))
}

function makeViolationId(): string {
  return `viol_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

// ── Per-rule evaluators (pure) ─────────────────────────────────────────────────

function evalInvoiceOverdue(
  rule: GuardianRule,
  data: GuardianData,
  now: Date,
): GuardianViolation[] {
  const threshold = rule.thresholdDays ?? 30
  const violations: GuardianViolation[] = []

  for (const inv of data.invoices) {
    if (inv.status === 'paid') continue
    const due = new Date(inv.dueDate)
    const overdueDays = daysBetween(due, now)
    if (overdueDays > threshold) {
      violations.push({
        id: makeViolationId(),
        ruleId: rule.id,
        ruleName: rule.name,
        triggerType: rule.triggerType,
        severity: rule.severity,
        subject: `Invoice — ${inv.client}`,
        detail: `$${inv.amount.toLocaleString()} overdue by ${overdueDays} days (due ${inv.dueDate}).`,
        detectedAt: now.toISOString(),
      })
    }
  }

  return violations
}

function evalLeadNoFollowup(
  rule: GuardianRule,
  data: GuardianData,
  now: Date,
): GuardianViolation[] {
  const threshold = rule.thresholdDays ?? 7
  const violations: GuardianViolation[] = []

  for (const lead of data.leads) {
    if (!lead.lastFollowUpDate) {
      violations.push({
        id: makeViolationId(),
        ruleId: rule.id,
        ruleName: rule.name,
        triggerType: rule.triggerType,
        severity: rule.severity,
        subject: `Lead — ${lead.company}`,
        detail: 'No follow-up date recorded for this lead.',
        detectedAt: now.toISOString(),
      })
      continue
    }
    const last = new Date(lead.lastFollowUpDate)
    const days = daysBetween(last, now)
    if (days > threshold) {
      violations.push({
        id: makeViolationId(),
        ruleId: rule.id,
        ruleName: rule.name,
        triggerType: rule.triggerType,
        severity: rule.severity,
        subject: `Lead — ${lead.company}`,
        detail: `No follow-up in ${days} days (last contact ${lead.lastFollowUpDate}).`,
        detectedAt: now.toISOString(),
      })
    }
  }

  return violations
}

function evalFieldLogMissing(
  rule: GuardianRule,
  data: GuardianData,
  now: Date,
): GuardianViolation[] {
  const threshold = rule.thresholdDays ?? 3
  const violations: GuardianViolation[] = []

  for (const fl of data.fieldLogs) {
    if (fl.projectStatus !== 'active') continue
    const last = new Date(fl.lastLogDate)
    const days = daysBetween(last, now)
    if (days > threshold) {
      violations.push({
        id: makeViolationId(),
        ruleId: rule.id,
        ruleName: rule.name,
        triggerType: rule.triggerType,
        severity: rule.severity,
        subject: `Project — ${fl.projectName}`,
        detail: `No field log submitted in ${days} days (last entry ${fl.lastLogDate}).`,
        detectedAt: now.toISOString(),
      })
    }
  }

  return violations
}

function evalCrewNoHours(
  rule: GuardianRule,
  data: GuardianData,
  now: Date,
): GuardianViolation[] {
  const violations: GuardianViolation[] = []

  for (const cm of data.crewMembers) {
    if (cm.hoursThisWeek === 0) {
      violations.push({
        id: makeViolationId(),
        ruleId: rule.id,
        ruleName: rule.name,
        triggerType: rule.triggerType,
        severity: rule.severity,
        subject: `Crew — ${cm.name}`,
        detail: 'No hours logged this week.',
        detectedAt: now.toISOString(),
      })
    }
  }

  return violations
}

function evalProjectHealthLow(
  rule: GuardianRule,
  data: GuardianData,
  now: Date,
): GuardianViolation[] {
  const threshold = rule.thresholdPercent ?? 40
  const violations: GuardianViolation[] = []

  for (const p of data.projects) {
    if (p.status !== 'active') continue
    if (p.health < threshold) {
      violations.push({
        id: makeViolationId(),
        ruleId: rule.id,
        ruleName: rule.name,
        triggerType: rule.triggerType,
        severity: rule.severity,
        subject: `Project — ${p.name}`,
        detail: `Project health at ${p.health}% — below ${threshold}% threshold.`,
        detectedAt: now.toISOString(),
      })
    }
  }

  return violations
}

// ── evaluateRules ──────────────────────────────────────────────────────────────

/**
 * Runs each active rule against the provided business data.
 * Returns an array of GuardianViolation objects.
 *
 * Pure function — no side effects, no API calls.
 */
export function evaluateRules(
  rules: GuardianRule[],
  data: GuardianData,
): GuardianViolation[] {
  const now = new Date()
  const violations: GuardianViolation[] = []

  for (const rule of rules) {
    if (!rule.active) continue

    switch (rule.triggerType) {
      case 'INVOICE_OVERDUE':
        violations.push(...evalInvoiceOverdue(rule, data, now))
        break
      case 'LEAD_NO_FOLLOWUP':
        violations.push(...evalLeadNoFollowup(rule, data, now))
        break
      case 'FIELD_LOG_MISSING':
        violations.push(...evalFieldLogMissing(rule, data, now))
        break
      case 'CREW_NO_HOURS':
        violations.push(...evalCrewNoHours(rule, data, now))
        break
      case 'PROJECT_HEALTH_LOW':
        violations.push(...evalProjectHealthLow(rule, data, now))
        break
      default:
        break
    }
  }

  return violations
}

// ── generateAuditEntry ─────────────────────────────────────────────────────────

/**
 * Creates a GuardianAuditEntry describing the result of an audit run.
 *
 * Pure function — no side effects.
 *
 * @param action - Human-readable label for what triggered this audit (e.g. "Manual Run Audit")
 * @param result - The violations array returned by evaluateRules()
 */
export function generateAuditEntry(
  action: string,
  result: GuardianViolation[],
): GuardianAuditEntry {
  const highCount   = result.filter(v => v.severity === 'HIGH').length
  const mediumCount = result.filter(v => v.severity === 'MEDIUM').length
  const lowCount    = result.filter(v => v.severity === 'LOW').length

  const resultText = result.length === 0
    ? 'No violations found.'
    : `${result.length} violation${result.length !== 1 ? 's' : ''} found — ` +
      `${highCount} HIGH, ${mediumCount} MEDIUM, ${lowCount} LOW.`

  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    action,
    result: resultText,
    violationCount: result.length,
    highCount,
    mediumCount,
    lowCount,
    timestamp: new Date().toISOString(),
  }
}
