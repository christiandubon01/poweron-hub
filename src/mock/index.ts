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
 */

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
