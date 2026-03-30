// @ts-nocheck
/**
 * Interview Definitions — Per-agent interview triggers, questions, and output specs.
 *
 * Each agent defines:
 * - triggers: conditions under which the interview should start
 * - questions: ordered list of structured questions (max 3 rounds)
 * - outputGenerator: produces the final output from answers for approval
 *
 * All outputs are DRAFTS — nothing is saved without explicit approval.
 */

import type { TargetAgent } from './classifier'

// ── Types ───────────────────────────────────────────────────────────────────

export interface InterviewQuestion {
  id: string
  text: string
  /** Short label for progress display */
  label: string
  /** Input type hint for the UI */
  inputType: 'text' | 'select' | 'multiline'
  /** For 'select' type — available choices */
  options?: string[]
  /** If true, this question can be skipped */
  skippable: boolean
  /** Memory key — if a previous answer exists for this key+project, pre-fill */
  memoryKey?: string
}

export interface InterviewTrigger {
  /** Human-readable description of when this interview fires */
  description: string
  /** Keywords in user message that activate this interview */
  keywords: string[]
  /** Optional: additional context check function name */
  contextCheck?: string
}

export interface InterviewOutput {
  /** What the output represents */
  type: 'field_log' | 'code_checklist' | 'estimate_draft' | 'follow_up_message' |
        'cash_flow_projection' | 'calendar_entry' | 'action_plan' | 'general'
  /** Where approved output gets saved */
  targetStore: string
  /** Display label for the output */
  label: string
}

export interface AgentInterviewDefinition {
  agent: TargetAgent
  agentName: string
  agentColor: string
  icon: string
  triggers: InterviewTrigger[]
  questions: InterviewQuestion[]
  output: InterviewOutput
  /** System prompt fragment for generating the final output */
  outputPrompt: string
}

// ── Per-Agent Definitions ───────────────────────────────────────────────────

const BLUEPRINT_INTERVIEW: AgentInterviewDefinition = {
  agent: 'blueprint',
  agentName: 'BLUEPRINT',
  agentColor: '#3b82f6',
  icon: '🏗️',
  triggers: [
    {
      description: 'Project with no field logs in 7+ days',
      keywords: ['project update', 'field log', 'what happened', 'stagnant', 'no activity', 'catch up'],
    },
  ],
  questions: [
    {
      id: 'bp_phase',
      text: 'What phase is this project currently in?',
      label: 'Current Phase',
      inputType: 'select',
      options: ['Rough-in', 'Trim-out', 'Service upgrade', 'Panel swap', 'Underground', 'Top-out', 'Final', 'Punch list', 'Waiting on inspection', 'Other'],
      skippable: false,
      memoryKey: 'project_phase',
    },
    {
      id: 'bp_blockers',
      text: 'Any blockers or open issues? (materials, inspections, GC delays, etc.)',
      label: 'Blockers',
      inputType: 'multiline',
      skippable: true,
      memoryKey: 'project_blockers',
    },
    {
      id: 'bp_completed',
      text: 'What work was completed since the last log?',
      label: 'Work Completed',
      inputType: 'multiline',
      skippable: false,
    },
  ],
  output: {
    type: 'field_log',
    targetStore: 'logs',
    label: 'Field Log Entry + Phase Update',
  },
  outputPrompt: `Based on the interview answers, generate a structured field log entry in JSON format with these fields:
- date: today's date (ISO format)
- phase: the current phase
- notes: summary of work completed and any blockers
- hoursEstimate: estimated hours based on work described
- phaseUpdate: recommended phase status update (if any)
- actionItems: array of follow-up items

Also include a brief natural-language summary for Christian to review before approving.`,
}

const OHM_INTERVIEW: AgentInterviewDefinition = {
  agent: 'ohm',
  agentName: 'OHM',
  agentColor: '#f59e0b',
  icon: '⚡',
  triggers: [
    {
      description: 'User mentions specific job type or location for code compliance',
      keywords: ['code', 'requirement', 'nec', 'what do i need', 'is this up to code', 'title 24', 'permit'],
    },
  ],
  questions: [
    {
      id: 'ohm_jurisdiction',
      text: 'What jurisdiction? (city/county)',
      label: 'Jurisdiction',
      inputType: 'text',
      skippable: false,
      memoryKey: 'project_jurisdiction',
    },
    {
      id: 'ohm_building_type',
      text: 'Residential, commercial, or mixed-use?',
      label: 'Building Type',
      inputType: 'select',
      options: ['Residential', 'Commercial', 'Mixed-use', 'Industrial'],
      skippable: false,
      memoryKey: 'project_building_type',
    },
    {
      id: 'ohm_work_type',
      text: 'What specific work? Any unusual conditions? (solar, EV charger, pool/spa, service upgrade, etc.)',
      label: 'Work Type',
      inputType: 'multiline',
      skippable: false,
      memoryKey: 'project_work_type',
    },
  ],
  output: {
    type: 'code_checklist',
    targetStore: 'projectContext',
    label: 'Code Checklist + Title 24 Requirements',
  },
  outputPrompt: `Based on the interview answers, generate a jurisdiction-specific electrical code compliance checklist. Include:
- Applicable NEC articles with section numbers
- California-specific CEC amendments if any
- Title 24 energy requirements if applicable
- Permit requirements for the jurisdiction
- Special inspection requirements
- Common code violations to watch for with this work type

Format as a structured checklist Christian can use on-site. Be specific to the jurisdiction and work type.`,
}

const VAULT_INTERVIEW: AgentInterviewDefinition = {
  agent: 'vault',
  agentName: 'VAULT',
  agentColor: '#10b981',
  icon: '💰',
  triggers: [
    {
      description: 'User asks to price a job or create estimate',
      keywords: ['price this', 'estimate', 'how much', 'quote', 'bid', 'what should i charge', 'material list'],
    },
  ],
  questions: [
    {
      id: 'vault_job_type',
      text: 'What type of job? (service upgrade, panel swap, new construction, remodel, solar, EV, etc.)',
      label: 'Job Type',
      inputType: 'select',
      options: ['Service upgrade', 'Panel swap', 'New construction', 'Remodel', 'Solar installation', 'EV charger', 'Lighting retrofit', 'Pool/spa', 'Other'],
      skippable: false,
      memoryKey: 'estimate_job_type',
    },
    {
      id: 'vault_scope',
      text: 'Scope details? (square footage, panel size, number of circuits, etc.)',
      label: 'Scope',
      inputType: 'multiline',
      skippable: false,
    },
    {
      id: 'vault_conditions',
      text: 'New construction or remodel? Any specialty items or target margin for this job type?',
      label: 'Conditions & Margin',
      inputType: 'multiline',
      skippable: true,
      memoryKey: 'estimate_target_margin',
    },
  ],
  output: {
    type: 'estimate_draft',
    targetStore: 'projects',
    label: 'Draft Estimate with Price Book Items',
  },
  outputPrompt: `Based on the interview answers, generate a draft electrical estimate. Include:
- Line items with quantities, unit costs from the price book
- Labor hours estimate with breakdown by task
- Material cost total
- Overhead allocation
- Recommended markup based on job type
- Total bid price
- Notes on any assumptions or exclusions

Format as a structured estimate Christian can review and adjust before sending to the customer.`,
}

const LEDGER_INTERVIEW: AgentInterviewDefinition = {
  agent: 'ledger',
  agentName: 'LEDGER',
  agentColor: '#ef4444',
  icon: '📒',
  triggers: [
    {
      description: 'Outstanding balance older than 3 days or collections follow-up',
      keywords: ['who owes', 'collections', 'follow up', 'unpaid', 'overdue', 'outstanding', 'send invoice'],
    },
  ],
  questions: [
    {
      id: 'ledger_contacted',
      text: 'Have you already contacted the customer about this balance?',
      label: 'Customer Contacted?',
      inputType: 'select',
      options: ['Not yet', 'Yes — no response', 'Yes — they said they\'d pay', 'Yes — dispute or issue'],
      skippable: false,
    },
    {
      id: 'ledger_issue',
      text: 'Is there a dispute or quality issue holding up payment?',
      label: 'Dispute/Issue',
      inputType: 'multiline',
      skippable: true,
    },
    {
      id: 'ledger_method',
      text: 'Preferred contact method for follow-up?',
      label: 'Contact Method',
      inputType: 'select',
      options: ['Text message', 'Phone call', 'Email', 'In-person'],
      skippable: false,
      memoryKey: 'customer_contact_method',
    },
  ],
  output: {
    type: 'follow_up_message',
    targetStore: 'serviceLogs',
    label: 'Follow-up Message Draft',
  },
  outputPrompt: `Based on the interview answers, draft a professional but firm collections follow-up message. Include:
- Appropriate tone based on whether customer was contacted before
- Reference to the specific invoice/amount
- Clear payment request with deadline
- If dispute: acknowledge the issue and propose resolution
- Formatted for the preferred contact method (text = short, email = professional)

Christian will review and approve before sending.`,
}

const PULSE_INTERVIEW: AgentInterviewDefinition = {
  agent: 'pulse',
  agentName: 'PULSE',
  agentColor: '#8b5cf6',
  icon: '📊',
  triggers: [
    {
      description: 'Monday briefing or user asks for financial overview',
      keywords: ['weekly overview', 'financial overview', 'how\'s business', 'cash flow', 'this week', 'monday briefing'],
    },
  ],
  questions: [
    {
      id: 'pulse_revenue_target',
      text: 'What\'s your revenue target this week?',
      label: 'Revenue Target',
      inputType: 'text',
      skippable: true,
      memoryKey: 'weekly_revenue_target',
    },
    {
      id: 'pulse_collecting',
      text: 'Any projects expecting payment this week?',
      label: 'Expected Payments',
      inputType: 'multiline',
      skippable: true,
    },
    {
      id: 'pulse_purchases',
      text: 'Any large material purchases planned this week?',
      label: 'Planned Purchases',
      inputType: 'multiline',
      skippable: true,
    },
  ],
  output: {
    type: 'cash_flow_projection',
    targetStore: 'weeklyData',
    label: 'Weekly Cash Flow Projection',
  },
  outputPrompt: `Based on the interview answers and the business data context, generate a weekly cash flow projection. Include:
- Expected income (collections + new revenue)
- Expected expenses (materials + labor + overhead)
- Net cash flow projection
- Cash position forecast
- Action items (collections to pursue, payments to make)
- Risk flags (tight weeks, large outflows)

Format as a clear, scannable briefing Christian can review in 30 seconds.`,
}

const CHRONO_INTERVIEW: AgentInterviewDefinition = {
  agent: 'chrono',
  agentName: 'CHRONO',
  agentColor: '#06b6d4',
  icon: '📅',
  triggers: [
    {
      description: 'User mentions scheduling a job or appointment',
      keywords: ['schedule', 'book', 'when can', 'set up', 'appointment', 'dispatch', 'assign crew'],
    },
  ],
  questions: [
    {
      id: 'chrono_address',
      text: 'Job address or location?',
      label: 'Address',
      inputType: 'text',
      skippable: false,
      memoryKey: 'project_address',
    },
    {
      id: 'chrono_duration',
      text: 'Estimated duration? (hours or days)',
      label: 'Duration',
      inputType: 'text',
      skippable: false,
    },
    {
      id: 'chrono_constraints',
      text: 'Any constraints? (crew needed, permit/delivery timing, preferred time, etc.)',
      label: 'Constraints',
      inputType: 'multiline',
      skippable: true,
    },
  ],
  output: {
    type: 'calendar_entry',
    targetStore: 'taskSchedule',
    label: 'Calendar Entry Draft',
  },
  outputPrompt: `Based on the interview answers, generate a calendar entry draft. Include:
- Event title (job type + customer/location)
- Proposed date and time
- Duration
- Location/address
- Crew assignment (if specified)
- Notes (constraints, permit status, material delivery)

Format as a structured calendar event Christian can approve and add to the schedule.`,
}

const SPARK_INTERVIEW: AgentInterviewDefinition = {
  agent: 'spark',
  agentName: 'SPARK',
  agentColor: '#ec4899',
  icon: '✨',
  triggers: [
    {
      description: 'New lead or GC contact inactive 14+ days',
      keywords: ['new lead', 'got a call', 'new customer', 'gc contact', 'follow up', 'outreach', 'referral'],
    },
  ],
  questions: [
    {
      id: 'spark_source',
      text: 'How did this lead come in? (referral, Google, Yelp, GC, door knock, etc.)',
      label: 'Lead Source',
      inputType: 'select',
      options: ['Referral', 'Google/SEO', 'Yelp', 'GC relationship', 'Door knock', 'Repeat customer', 'Social media', 'Other'],
      skippable: false,
    },
    {
      id: 'spark_work_type',
      text: 'What type of work are they looking for?',
      label: 'Work Type',
      inputType: 'text',
      skippable: false,
    },
    {
      id: 'spark_details',
      text: 'Met in person? Estimated job value? Any notes?',
      label: 'Details',
      inputType: 'multiline',
      skippable: true,
    },
  ],
  output: {
    type: 'action_plan',
    targetStore: 'gcContacts',
    label: 'Follow-up Action Plan + Outreach Draft',
  },
  outputPrompt: `Based on the interview answers, generate a lead follow-up action plan. Include:
- Lead qualification score (1-10) based on job type, source, and value
- Recommended next steps (call, site visit, send estimate, etc.)
- Timeline for follow-up actions
- Draft outreach message (text or email) customized to the lead source
- If GC relationship: relationship health assessment and nurturing suggestions

Format as an actionable plan Christian can approve and execute.`,
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const AGENT_INTERVIEWS: Record<string, AgentInterviewDefinition> = {
  blueprint: BLUEPRINT_INTERVIEW,
  ohm: OHM_INTERVIEW,
  vault: VAULT_INTERVIEW,
  ledger: LEDGER_INTERVIEW,
  pulse: PULSE_INTERVIEW,
  chrono: CHRONO_INTERVIEW,
  spark: SPARK_INTERVIEW,
}

/**
 * Check if a user message should trigger an agent interview.
 * Returns the matching interview definition or null.
 */
export function checkInterviewTrigger(
  message: string,
  targetAgent: TargetAgent
): AgentInterviewDefinition | null {
  const interview = AGENT_INTERVIEWS[targetAgent]
  if (!interview) return null

  const lower = message.toLowerCase()

  for (const trigger of interview.triggers) {
    for (const keyword of trigger.keywords) {
      if (lower.includes(keyword)) {
        return interview
      }
    }
  }

  return null
}

/**
 * Get all available interview definitions.
 */
export function getAllInterviews(): AgentInterviewDefinition[] {
  return Object.values(AGENT_INTERVIEWS)
}
