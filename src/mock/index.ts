/**
 * src/mock/index.ts — Shared mock / demo data fixtures.
 *
 * E3 | Demo Mode additions:
 *   - demoProject    : single generic project for Demo Mode preview
 *   - demoTeam       : owner + 2 crew members
 *   - demoLeads      : 10 GC leads with companies named "Client A" → "Client J"
 *   - demoInvoices   : 5 invoices, round numbers, generic client names
 *
 * All values are intentionally generic — no real company or personal data.
 * This file may receive additive exports in future sessions; never delete exports.
 *
 * E13 | n8n Automation Layer additions:
 *   - mockAutomationRules : 5 rules, one per trigger type, mix of active/inactive
 *   - mockAutomationLog   : 10 log entries, mix of success and failed
 */

// ── E13 type imports ──────────────────────────────────────────────────────────
import type { AutomationRule, AutomationLog } from '../types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MockPhases {
  [phaseName: string]: number
}

export interface MockProject {
  id: string
  name: string
  type: string
  status: 'active' | 'coming' | 'completed'
  health: number
  contract: number
  billed: number
  paid: number
  laborHrs: number
  phases: MockPhases
}

export interface MockTeamMember {
  id: string
  name: string
  role: string
  billRate: number
}

export interface MockLead {
  id: string
  company: string
  contact: string
  phase: string
  value: number
  fit: number
  notes: string
}

export interface MockInvoice {
  id: string
  client: string
  amount: number
  status: 'paid' | 'pending' | 'overdue'
  dueDate: string
  issuedDate: string
}

// ── demoProject ───────────────────────────────────────────────────────────────
// A single generic project representing a "Sample Project — Commercial TI"

export const demoProject: MockProject = {
  id: 'mock_proj_demo',
  name: 'Sample Project — Commercial TI',
  type: 'Commercial',
  status: 'active',
  health: 72,
  contract: 48000,
  billed: 24000,
  paid: 18000,
  laborHrs: 96,
  phases: {
    Planning: 100,
    Estimating: 100,
    'Site Prep': 100,
    'Rough-in': 80,
    Trim: 35,
    Finish: 0,
  },
}

// ── demoTeam ─────────────────────────────────────────────────────────────────
// 3 members: owner + 2 crew

export const demoTeam: MockTeamMember[] = [
  {
    id: 'mock_team_1',
    name: 'Owner',
    role: 'Owner / Journeyman',
    billRate: 125,
  },
  {
    id: 'mock_team_2',
    name: 'Crew Member 1',
    role: 'Journeyman',
    billRate: 95,
  },
  {
    id: 'mock_team_3',
    name: 'Crew Member 2',
    role: 'Apprentice',
    billRate: 65,
  },
]

// ── demoLeads ─────────────────────────────────────────────────────────────────
// 10 leads, companies "Client A" through "Client J"

const LEAD_PHASES = [
  'First Contact',
  'Qualified',
  'Active Bidding',
  'Active Bidding',
  'Awarded',
  'First Contact',
  'Qualified',
  'Active Bidding',
  'Converted',
  'Prospecting',
]

export const demoLeads: MockLead[] = Array.from({ length: 10 }, (_, i) => {
  const letter = String.fromCharCode(65 + i) // A → J
  return {
    id: `mock_lead_${i + 1}`,
    company: `Client ${letter}`,
    contact: `Contact ${letter}`,
    phase: LEAD_PHASES[i],
    value: (i + 1) * 12000,
    fit: 5 + (i % 5),
    notes: `Sample GC contact — generic placeholder for demo purposes.`,
  }
})

// ── demoInvoices ──────────────────────────────────────────────────────────────
// 5 invoices, round numbers, generic client names

const _now = Date.now()
const _day = 86400000

export const demoInvoices: MockInvoice[] = [
  {
    id: 'mock_inv_1',
    client: 'Sample Client 1',
    amount: 12000,
    status: 'paid',
    issuedDate: new Date(_now - 30 * _day).toISOString().slice(0, 10),
    dueDate: new Date(_now - 15 * _day).toISOString().slice(0, 10),
  },
  {
    id: 'mock_inv_2',
    client: 'Sample Client 2',
    amount: 8500,
    status: 'paid',
    issuedDate: new Date(_now - 20 * _day).toISOString().slice(0, 10),
    dueDate: new Date(_now - 5 * _day).toISOString().slice(0, 10),
  },
  {
    id: 'mock_inv_3',
    client: 'Sample Client 3',
    amount: 15000,
    status: 'pending',
    issuedDate: new Date(_now - 10 * _day).toISOString().slice(0, 10),
    dueDate: new Date(_now + 20 * _day).toISOString().slice(0, 10),
  },
  {
    id: 'mock_inv_4',
    client: 'Sample Client 4',
    amount: 6000,
    status: 'pending',
    issuedDate: new Date(_now - 5 * _day).toISOString().slice(0, 10),
    dueDate: new Date(_now + 25 * _day).toISOString().slice(0, 10),
  },
  {
    id: 'mock_inv_5',
    client: 'Sample Client 5',
    amount: 20000,
    status: 'overdue',
    issuedDate: new Date(_now - 45 * _day).toISOString().slice(0, 10),
    dueDate: new Date(_now - 15 * _day).toISOString().slice(0, 10),
  },
]

// ── mockAutomationRules ───────────────────────────────────────────────────────
// 5 rules, one per trigger type, mix of active / inactive

export const mockAutomationRules: AutomationRule[] = [
  {
    id: 'rule_1',
    name: 'Lead Intake Processor',
    trigger: 'lead_intake',
    active: true,
    lastRun: new Date(_now - 2 * _day).toISOString(),
    nextRun: new Date(_now + 1 * _day).toISOString(),
    runCount: 42,
  },
  {
    id: 'rule_2',
    name: 'Invoice Follow-Up Reminder',
    trigger: 'invoice_followup',
    active: true,
    lastRun: new Date(_now - 1 * _day).toISOString(),
    nextRun: new Date(_now + 6 * _day).toISOString(),
    runCount: 18,
  },
  {
    id: 'rule_3',
    name: 'Daily Briefing Summary',
    trigger: 'daily_briefing',
    active: true,
    lastRun: new Date(_now - 0.5 * _day).toISOString(),
    nextRun: new Date(_now + 0.5 * _day).toISOString(),
    runCount: 61,
  },
  {
    id: 'rule_4',
    name: 'Receipt OCR & Categorizer',
    trigger: 'receipt_processing',
    active: false,
    lastRun: new Date(_now - 7 * _day).toISOString(),
    nextRun: undefined,
    runCount: 9,
  },
  {
    id: 'rule_5',
    name: 'Google Business Review Monitor',
    trigger: 'review_monitor',
    active: false,
    lastRun: new Date(_now - 14 * _day).toISOString(),
    nextRun: undefined,
    runCount: 3,
  },
]

// ── mockAutomationLog ─────────────────────────────────────────────────────────
// 10 entries, mix of success and failed, most-recent first

export const mockAutomationLog: AutomationLog[] = [
  {
    id: 'log_1',
    ruleId: 'rule_3',
    ruleName: 'Daily Briefing Summary',
    triggeredAt: new Date(_now - 0.5 * _day).toISOString(),
    status: 'success',
    message: 'Briefing email dispatched to owner inbox.',
  },
  {
    id: 'log_2',
    ruleId: 'rule_1',
    ruleName: 'Lead Intake Processor',
    triggeredAt: new Date(_now - 1 * _day).toISOString(),
    status: 'success',
    message: '3 new leads imported from web form.',
  },
  {
    id: 'log_3',
    ruleId: 'rule_2',
    ruleName: 'Invoice Follow-Up Reminder',
    triggeredAt: new Date(_now - 1 * _day).toISOString(),
    status: 'failed',
    message: 'SMTP connection timed out. Retry scheduled.',
  },
  {
    id: 'log_4',
    ruleId: 'rule_3',
    ruleName: 'Daily Briefing Summary',
    triggeredAt: new Date(_now - 1.5 * _day).toISOString(),
    status: 'success',
    message: 'Briefing email dispatched to owner inbox.',
  },
  {
    id: 'log_5',
    ruleId: 'rule_4',
    ruleName: 'Receipt OCR & Categorizer',
    triggeredAt: new Date(_now - 2 * _day).toISOString(),
    status: 'failed',
    message: 'OCR service unavailable — quota exceeded.',
  },
  {
    id: 'log_6',
    ruleId: 'rule_1',
    ruleName: 'Lead Intake Processor',
    triggeredAt: new Date(_now - 2 * _day).toISOString(),
    status: 'success',
    message: '1 new lead imported from web form.',
  },
  {
    id: 'log_7',
    ruleId: 'rule_5',
    ruleName: 'Google Business Review Monitor',
    triggeredAt: new Date(_now - 3 * _day).toISOString(),
    status: 'success',
    message: 'No new reviews detected.',
  },
  {
    id: 'log_8',
    ruleId: 'rule_2',
    ruleName: 'Invoice Follow-Up Reminder',
    triggeredAt: new Date(_now - 7 * _day).toISOString(),
    status: 'success',
    message: 'Follow-up sent for 2 overdue invoices.',
  },
  {
    id: 'log_9',
    ruleId: 'rule_3',
    ruleName: 'Daily Briefing Summary',
    triggeredAt: new Date(_now - 8 * _day).toISOString(),
    status: 'failed',
    message: 'Supabase webhook returned 503.',
  },
  {
    id: 'log_10',
    ruleId: 'rule_4',
    ruleName: 'Receipt OCR & Categorizer',
    triggeredAt: new Date(_now - 10 * _day).toISOString(),
    status: 'success',
    message: '5 receipts processed and categorized.',
  },
]

// ── V3 Mock Data Additions ─────────────────────────────────────────────────────
// These exports are used by the V3 views copied from the external prototype.
// All values are intentionally generic — no real company or personal data.

// ── DebtKiller mocks ──────────────────────────────────────────────────────────

export interface MockExpense {
  id: string; category: string; description: string; amount: number; date: string; vendor: string
}
export interface MockDebt {
  id: string; name: string; balance: number; interestRate: number; minimumPayment: number; type: string
}

export const mockExpenses: MockExpense[] = [
  { id: 'exp_1', category: 'materials', description: 'Conduit & fittings', amount: 1240, date: '2026-03-15', vendor: 'Home Depot' },
  { id: 'exp_2', category: 'tools', description: 'Drill bits set', amount: 189, date: '2026-03-18', vendor: 'Acme Tools' },
  { id: 'exp_3', category: 'vehicle', description: 'Fuel', amount: 95, date: '2026-03-20', vendor: 'Shell' },
  { id: 'exp_4', category: 'materials', description: 'Wire (12/2 romex 250ft)', amount: 480, date: '2026-03-22', vendor: 'Graybar' },
  { id: 'exp_5', category: 'insurance', description: 'General liability premium', amount: 620, date: '2026-03-25', vendor: 'State Farm' },
]

export const mockDebts: MockDebt[] = [
  { id: 'debt_1', name: 'Truck Loan', balance: 18500, interestRate: 5.9, minimumPayment: 420, type: 'vehicle' },
  { id: 'debt_2', name: 'Business Credit Card', balance: 4200, interestRate: 19.99, minimumPayment: 120, type: 'credit_card' },
  { id: 'debt_3', name: 'Equipment Lease', balance: 7800, interestRate: 8.5, minimumPayment: 280, type: 'equipment' },
]

export const mockMonthlyIncome: number = 18500

// ── CrewPortal mocks ──────────────────────────────────────────────────────────

export interface MockCrewMember {
  id: string; name: string; role: string; phone: string; assignedProject?: string; status: 'active' | 'off'
}

export const mockCrewMembers: MockCrewMember[] = [
  { id: 'crew_1', name: 'Miguel Reyes', role: 'Journeyman', phone: '555-0101', assignedProject: 'proj_1', status: 'active' },
  { id: 'crew_2', name: 'David Kim', role: 'Apprentice', phone: '555-0102', assignedProject: 'proj_1', status: 'active' },
  { id: 'crew_3', name: 'James Torres', role: 'Foreman', phone: '555-0103', assignedProject: 'proj_2', status: 'active' },
]

// ── GuardianView mocks ────────────────────────────────────────────────────────

export const mockGuardianRules = [
  { id: 'rule_g1', name: 'Invoice Overdue > 30 Days', triggerType: 'INVOICE_OVERDUE', severity: 'HIGH', active: true, thresholdDays: 30 },
  { id: 'rule_g2', name: 'Lead No Follow-Up > 7 Days', triggerType: 'LEAD_NO_FOLLOWUP', severity: 'MEDIUM', active: true, thresholdDays: 7 },
  { id: 'rule_g3', name: 'Field Log Missing > 2 Days', triggerType: 'FIELD_LOG_MISSING', severity: 'MEDIUM', active: true, thresholdDays: 2 },
]

export const mockViolations = [
  { id: 'vio_1', ruleId: 'rule_g1', ruleName: 'Invoice Overdue > 30 Days', triggerType: 'INVOICE_OVERDUE', severity: 'HIGH', subject: 'INV-0042 — Client A', detail: '45 days overdue, $3,200 outstanding', detectedAt: new Date(_now - 2 * _day).toISOString() },
  { id: 'vio_2', ruleId: 'rule_g2', ruleName: 'Lead No Follow-Up > 7 Days', triggerType: 'LEAD_NO_FOLLOWUP', severity: 'MEDIUM', subject: 'Client F — Residential rewire', detail: '9 days since last contact', detectedAt: new Date(_now - _day).toISOString() },
]

export const mockAuditLog = [
  { id: 'audit_1', action: 'Rules evaluated', result: '2 violations found', violationCount: 2, highCount: 1, mediumCount: 1, lowCount: 0, timestamp: new Date(_now - _day).toISOString() },
  { id: 'audit_2', action: 'Rules evaluated', result: '0 violations', violationCount: 0, highCount: 0, mediumCount: 0, lowCount: 0, timestamp: new Date(_now - 2 * _day).toISOString() },
]

// ── LeadRollingTrend mocks ────────────────────────────────────────────────────

export const mockWeeklySnapshots = Array.from({ length: 12 }, (_, i) => ({
  id: `wk_${i + 1}`,
  weekLabel: `Wk ${i + 1}`,
  weekStartDate: new Date(_now - (11 - i) * 7 * _day).toISOString(),
  newLeads: Math.floor(Math.random() * 8) + 2,
  convertedLeads: Math.floor(Math.random() * 4),
  revenueBooked: Math.floor(Math.random() * 12000) + 3000,
  avgDealSize: Math.floor(Math.random() * 4000) + 2000,
}))

// ── VoiceJournalingV2 mocks ───────────────────────────────────────────────────

export const mockJournalEntries = [
  { id: 'jrn_1', category: 'site', title: 'Beauty Salon – end of day note', transcript: 'Finished rough-in on suites B and C. Sub-panel scheduled for Thursday.', tags: ['rough-in', 'panel'], createdAt: new Date(_now - _day).toISOString(), duration: 62 },
  { id: 'jrn_2', category: 'lead', title: 'New inquiry – Valley Office Park', transcript: 'Caller wants a 400A service upgrade. Asked for ballpark. Said $18k range.', tags: ['estimate', 'service-upgrade'], createdAt: new Date(_now - 3 * _day).toISOString(), duration: 48 },
  { id: 'jrn_3', category: 'decision', title: 'Vendor switch decision', transcript: 'Going with Graybar for next project — better pricing on wire.', tags: ['vendor', 'materials'], createdAt: new Date(_now - 5 * _day).toISOString(), duration: 25 },
]

