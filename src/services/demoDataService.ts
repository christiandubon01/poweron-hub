// @ts-nocheck
/**
 * demoDataService.ts — Demo Mode placeholder data layer.
 *
 * Pure functions, no side effects.
 * Never reads from or writes to Supabase.
 * Never modifies the real localStorage data keys.
 *
 * Exports:
 *   getDemoBackupData()  → Full BackupData-shaped object with generic contractor placeholders
 *   getDemoKPIs()        → Header KPI overrides matching spec: Pipeline $105k, Paid $36k, etc.
 */

import type {
  BackupData,
  BackupProject,
  BackupServiceLog,
  BackupGCContact,
  BackupEmployee,
  BackupSettings,
  BackupWeeklyData,
} from './backupDataService'

// ── Placeholder identity ─────────────────────────────────────────────────────

export const DEMO_COMPANY  = 'Pacific Coast Electric LLC'
export const DEMO_OWNER    = 'Mike Thompson'
export const DEMO_LICENSE  = 'C-10 #9876543'

// ── Demo KPI overrides (used directly in header bar) ────────────────────────
// These match the spec target: Pipeline $105k, Paid $36k, Exposure $27k,
// Open Projects 9. Service net and svcUnbilled derived from service data.

export interface DemoKPIs {
  pipeline:       number
  paid:           number
  billed:         number
  exposure:       number
  svcUnbilled:    number
  openRfis:       number
  totalHours:     number
  activeProjects: number
}

export function getDemoKPIs(): DemoKPIs {
  return {
    pipeline:       105000,
    paid:            36000,
    billed:          52000,
    exposure:        27000,
    svcUnbilled:      2400,
    openRfis:            2,
    totalHours:        245,
    activeProjects:      9,
  }
}

// ── Demo service net (shown separately in header) ────────────────────────────
// 4 service calls totalling $2,400 quoted, minimal material/mileage
export const DEMO_SERVICE_NET = 2100  // $2,400 quoted − ~$300 material/mileage

// ── Demo projects ────────────────────────────────────────────────────────────

function makeDemoProjects(): BackupProject[] {
  return [
    {
      id: 'demo_proj_1',
      name: 'Oceanview Medical Center',
      type: 'Commercial',
      status: 'active',
      contract: 45000,
      billed: 22500,
      paid: 18000,
      mileRT: 24,
      miDays: 6,
      laborHrs: 88,
      phases: {
        Planning: 100,
        Estimating: 100,
        'Site Prep': 100,
        'Rough-in': 85,
        Trim: 30,
        Finish: 0,
      },
      logs: [
        {
          id: 'demo_log_1a',
          emp: DEMO_OWNER,
          empId: 'demo_emp_1',
          hrs: 8,
          mat: 420,
          miles: 24,
          date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
          notes: 'Rough-in panel wiring — 2nd floor east wing.',
          phase: 'Rough-in',
          store: 'Pacific Coast Supply',
          profit: 0,
          projId: 'demo_proj_1',
          quoted: 0,
          projName: 'Oceanview Medical Center',
          collected: 0,
          detailLink: '',
          projectQuote: 0,
          emergencyMatInfo: '',
        },
      ],
      rfis: [],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 2 * 86400000).toISOString(),
      finance: { contract: 45000, paid: 18000, billed: 22500, exposure: 27000 },
    },
    {
      id: 'demo_proj_2',
      name: 'Sunset Retail Remodel',
      type: 'Commercial TI',
      status: 'active',
      contract: 18500,
      billed: 14000,
      paid: 12000,
      mileRT: 18,
      miDays: 4,
      laborHrs: 52,
      phases: {
        Planning: 100,
        Estimating: 100,
        'Site Prep': 100,
        'Rough-in': 100,
        Trim: 80,
        Finish: 45,
      },
      logs: [
        {
          id: 'demo_log_2a',
          emp: DEMO_OWNER,
          empId: 'demo_emp_1',
          hrs: 6,
          mat: 180,
          miles: 18,
          date: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10),
          notes: 'Trim phase — fixtures and panel finish.',
          phase: 'Trim',
          store: 'Pacific Coast Supply',
          profit: 0,
          projId: 'demo_proj_2',
          quoted: 0,
          projName: 'Sunset Retail Remodel',
          collected: 0,
          detailLink: '',
          projectQuote: 0,
          emergencyMatInfo: '',
        },
      ],
      rfis: [
        {
          id: 'demo_rfi_2a',
          question: 'Confirm fixture spec for restroom circuits.',
          status: 'open',
          created: new Date(Date.now() - 3 * 86400000).toISOString(),
        },
      ],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 4 * 86400000).toISOString(),
      finance: { contract: 18500, paid: 12000, billed: 14000, exposure: 6500 },
    },
    {
      id: 'demo_proj_3',
      name: 'Harbor ADU + Service',
      type: 'Residential',
      status: 'active',
      contract: 12000,
      billed: 8000,
      paid: 6000,
      mileRT: 14,
      miDays: 3,
      laborHrs: 34,
      phases: {
        Planning: 100,
        Estimating: 100,
        'Site Prep': 100,
        'Rough-in': 60,
        Trim: 0,
        Finish: 0,
      },
      logs: [
        {
          id: 'demo_log_3a',
          emp: DEMO_OWNER,
          empId: 'demo_emp_1',
          hrs: 7,
          mat: 290,
          miles: 14,
          date: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
          notes: 'Rough-in for ADU sub-panel.',
          phase: 'Rough-in',
          store: 'Home Depot',
          profit: 0,
          projId: 'demo_proj_3',
          quoted: 0,
          projName: 'Harbor ADU + Service',
          collected: 0,
          detailLink: '',
          projectQuote: 0,
          emergencyMatInfo: '',
        },
      ],
      rfis: [],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 6 * 86400000).toISOString(),
      finance: { contract: 12000, paid: 6000, billed: 8000, exposure: 6000 },
    },
    {
      id: 'demo_proj_4',
      name: 'Marina Commercial TI',
      type: 'Commercial TI',
      status: 'coming',
      contract: 22000,
      billed: 0,
      paid: 0,
      mileRT: 20,
      miDays: 0,
      laborHrs: 0,
      phases: {
        Planning: 100,
        Estimating: 90,
        'Site Prep': 0,
        'Rough-in': 0,
        Trim: 0,
        Finish: 0,
      },
      logs: [],
      rfis: [
        {
          id: 'demo_rfi_4a',
          question: 'Verify electrical load schedule from GC.',
          status: 'open',
          created: new Date(Date.now() - 1 * 86400000).toISOString(),
        },
      ],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 1 * 86400000).toISOString(),
      finance: { contract: 22000, paid: 0, billed: 0, exposure: 22000 },
    },
    // 5 more generic active projects to reach "Open Projects: 9"
    {
      id: 'demo_proj_5',
      name: 'Bayside Apartment Complex',
      type: 'Residential',
      status: 'active',
      contract: 8800,
      billed: 5200,
      paid: 5200,
      mileRT: 22,
      miDays: 3,
      laborHrs: 28,
      phases: { Planning: 100, Estimating: 100, 'Site Prep': 100, 'Rough-in': 95, Trim: 70, Finish: 30 },
      logs: [],
      rfis: [],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 5 * 86400000).toISOString(),
      finance: { contract: 8800, paid: 5200, billed: 5200, exposure: 3600 },
    },
    {
      id: 'demo_proj_6',
      name: 'Cliffside Restaurant Buildout',
      type: 'Commercial',
      status: 'active',
      contract: 14200,
      billed: 7000,
      paid: 7000,
      mileRT: 30,
      miDays: 4,
      laborHrs: 44,
      phases: { Planning: 100, Estimating: 100, 'Site Prep': 100, 'Rough-in': 70, Trim: 20, Finish: 0 },
      logs: [],
      rfis: [],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 3 * 86400000).toISOString(),
      finance: { contract: 14200, paid: 7000, billed: 7000, exposure: 7200 },
    },
    {
      id: 'demo_proj_7',
      name: 'Riverside Industrial Panel',
      type: 'Commercial',
      status: 'active',
      contract: 9500,
      billed: 4700,
      paid: 4700,
      mileRT: 28,
      miDays: 2,
      laborHrs: 22,
      phases: { Planning: 100, Estimating: 100, 'Site Prep': 100, 'Rough-in': 80, Trim: 40, Finish: 0 },
      logs: [],
      rfis: [],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 7 * 86400000).toISOString(),
      finance: { contract: 9500, paid: 4700, billed: 4700, exposure: 4800 },
    },
    {
      id: 'demo_proj_8',
      name: 'Crestview Home Service Upgrade',
      type: 'Residential',
      status: 'active',
      contract: 4200,
      billed: 4200,
      paid: 4200,
      mileRT: 16,
      miDays: 1,
      laborHrs: 12,
      phases: { Planning: 100, Estimating: 100, 'Site Prep': 100, 'Rough-in': 100, Trim: 100, Finish: 100 },
      logs: [],
      rfis: [],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 10 * 86400000).toISOString(),
      finance: { contract: 4200, paid: 4200, billed: 4200, exposure: 0 },
    },
    {
      id: 'demo_proj_9',
      name: 'Shoreline Office Park',
      type: 'Commercial',
      status: 'coming',
      contract: 31500,
      billed: 0,
      paid: 0,
      mileRT: 34,
      miDays: 0,
      laborHrs: 0,
      phases: { Planning: 100, Estimating: 100, 'Site Prep': 0, 'Rough-in': 0, Trim: 0, Finish: 0 },
      logs: [],
      rfis: [],
      coord: {},
      tasks: {},
      lastMove: new Date(Date.now() - 1 * 86400000).toISOString(),
      finance: { contract: 31500, paid: 0, billed: 0, exposure: 31500 },
    },
  ]
}

// ── Demo service logs ────────────────────────────────────────────────────────
// 4 entries, $2,400 total quoted

function makeDemoServiceLogs(): BackupServiceLog[] {
  return [
    {
      id: 'demo_svc_1',
      hrs: 3,
      mat: 45,
      date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      jtype: 'Service Call',
      miles: 12,
      notes: 'Outlet circuit trip — traced to GFCI fault in kitchen.',
      store: 'Home Depot',
      opCost: 95,
      profit: 460,
      quoted: 650,
      address: '4211 Pacific Ave',
      customer: 'J. Richardson',
      mileCost: 8,
      collected: 650,
      payStatus: 'Paid',
      balanceDue: 0,
    },
    {
      id: 'demo_svc_2',
      hrs: 4,
      mat: 120,
      date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
      jtype: 'Panel Upgrade',
      miles: 18,
      notes: 'Main panel 100A → 200A upgrade, permit pulled.',
      store: 'Pacific Coast Supply',
      opCost: 140,
      profit: 480,
      quoted: 800,
      address: '882 Harbor Blvd',
      customer: 'K. Nguyen',
      mileCost: 12,
      collected: 0,
      payStatus: 'Unpaid',
      balanceDue: 800,
    },
    {
      id: 'demo_svc_3',
      hrs: 2,
      mat: 30,
      date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
      jtype: 'Service Call',
      miles: 10,
      notes: 'Troubleshoot outdoor lighting — replaced corroded junction box.',
      store: 'Home Depot',
      opCost: 70,
      profit: 350,
      quoted: 480,
      address: '715 Cliffside Dr',
      customer: 'A. Torres',
      mileCost: 7,
      collected: 480,
      payStatus: 'Paid',
      balanceDue: 0,
    },
    {
      id: 'demo_svc_4',
      hrs: 3,
      mat: 75,
      date: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      jtype: 'EV Charger',
      miles: 20,
      notes: 'Level 2 EV charger installation in garage.',
      store: 'Pacific Coast Supply',
      opCost: 105,
      profit: 295,
      quoted: 470,
      address: '301 Marina View Ct',
      customer: 'R. Castillo',
      mileCost: 14,
      collected: 0,
      payStatus: 'Unpaid',
      balanceDue: 470,
    },
  ]
}

// ── Demo GC contacts (Leads) ─────────────────────────────────────────────────
// 8 generic contacts

function makeDemoGCContacts(): BackupGCContact[] {
  return [
    {
      id: 'demo_gc_1',
      contact: 'Robert Chen',
      company: 'Pacific Builders Inc.',
      role: 'Project Manager',
      phone: '(619) 555-0142',
      email: 'rchen@pacificbuilders.example',
      phase: 'Active Bidding',
      action: 'Follow up on bid submission',
      intro: 'Met at SoCal Contractors Expo — commercial TI projects.',
      notes: 'Interested in long-term relationship for retail tenant improvements.',
      avg: 65000,
      due: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
      fit: 8,
      pay: 'Net 30',
      sent: 2,
      awarded: 0,
      created: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      id: 'demo_gc_2',
      contact: 'Sandra Patel',
      company: 'Coastal Development Group',
      role: 'Owner',
      phone: '(760) 555-0287',
      email: 'spatel@coastaldev.example',
      phase: 'Awarded',
      action: 'Schedule pre-construction meeting',
      intro: 'Referral from Harbor ADU client.',
      notes: 'Has 3 upcoming residential ADU projects this quarter.',
      avg: 28000,
      due: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      fit: 9,
      pay: 'Net 15',
      sent: 1,
      awarded: 1,
      created: new Date(Date.now() - 45 * 86400000).toISOString(),
    },
    {
      id: 'demo_gc_3',
      contact: 'James Whitfield',
      company: 'Tri-County Construction',
      role: 'Superintendent',
      phone: '(858) 555-0381',
      email: 'jwhitfield@tricounty.example',
      phase: 'Qualified',
      action: 'Send capability package',
      intro: 'LinkedIn outreach — healthcare construction focus.',
      notes: 'Builds 4-6 medical office projects per year — good fit for C-10.',
      avg: 95000,
      due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      fit: 7,
      pay: 'Net 30',
      sent: 0,
      awarded: 0,
      created: new Date(Date.now() - 20 * 86400000).toISOString(),
    },
    {
      id: 'demo_gc_4',
      contact: 'Maria Alvarez',
      company: 'Shoreline Realty Partners',
      role: 'Construction Coordinator',
      phone: '(619) 555-0419',
      email: 'malvarez@shoreline.example',
      phase: 'First Contact',
      action: 'Intro call next week',
      intro: 'Referral from electrician network group.',
      notes: 'Manages commercial renovation projects — retail/restaurant.',
      avg: 35000,
      due: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
      fit: 6,
      pay: 'Net 30',
      sent: 0,
      awarded: 0,
      created: new Date(Date.now() - 10 * 86400000).toISOString(),
    },
    {
      id: 'demo_gc_5',
      contact: 'Tom Bradley',
      company: 'BrightBuild Construction',
      role: 'Estimator',
      phone: '(760) 555-0523',
      email: 'tbradley@brightbuild.example',
      phase: 'Prospecting',
      action: 'Review bid history before reaching out',
      intro: 'Industry directory — active in desert region.',
      notes: 'Primarily residential tract homes but branching into commercial.',
      avg: 22000,
      due: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      fit: 5,
      pay: 'Net 45',
      sent: 0,
      awarded: 0,
      created: new Date(Date.now() - 5 * 86400000).toISOString(),
    },
    {
      id: 'demo_gc_6',
      contact: 'Lisa Kim',
      company: 'Pacific Coast Development',
      role: 'Vice President',
      phone: '(619) 555-0614',
      email: 'lkim@paccdv.example',
      phase: 'Active Bidding',
      action: 'Submit electrical scope for marina project',
      intro: 'Trade show contact — large mixed-use development pipeline.',
      notes: 'Has 3 projects in permitting stage that need sub bids.',
      avg: 125000,
      due: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      fit: 8,
      pay: 'Net 30',
      sent: 1,
      awarded: 0,
      created: new Date(Date.now() - 60 * 86400000).toISOString(),
    },
    {
      id: 'demo_gc_7',
      contact: 'Carlos Mendez',
      company: 'Desert Sun Builders',
      role: 'Project Engineer',
      phone: '(760) 555-0715',
      email: 'cmendez@desertsun.example',
      phase: 'Dormant',
      action: 'Re-engage after Q3 schedule opens',
      intro: 'Previous bid relationship — slow payer but high volume.',
      notes: 'Paused outreach until cash flow stabilizes on our end.',
      avg: 48000,
      due: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      fit: 4,
      pay: 'Net 60',
      sent: 3,
      awarded: 1,
      created: new Date(Date.now() - 120 * 86400000).toISOString(),
    },
    {
      id: 'demo_gc_8',
      contact: 'Heather Nguyen',
      company: 'Bayfront Hospitality Group',
      role: 'Director of Construction',
      phone: '(858) 555-0827',
      email: 'hnguyen@bayfront.example',
      phase: 'Converted',
      action: 'Begin Oceanview Medical punch-list coordination',
      intro: 'Converted lead — now active project client.',
      notes: 'Strong referral source — very happy with current project pace.',
      avg: 45000,
      due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      fit: 10,
      pay: 'Net 15',
      sent: 2,
      awarded: 2,
      created: new Date(Date.now() - 90 * 86400000).toISOString(),
    },
  ]
}

// ── Demo employees ────────────────────────────────────────────────────────────

function makeDemoEmployees(): BackupEmployee[] {
  return [
    {
      id: 'demo_emp_1',
      name: DEMO_OWNER,
      role: 'Owner / Journeyman',
      billRate: 125,
      costRate: 55,
    },
    {
      id: 'demo_emp_2',
      name: 'Danny R.',
      role: 'Apprentice',
      billRate: 75,
      costRate: 28,
    },
  ]
}

// ── Demo settings ─────────────────────────────────────────────────────────────

function makeDemoSettings(): BackupSettings {
  return {
    company: DEMO_COMPANY,
    license: DEMO_LICENSE,
    billRate: 125,
    defaultOHRate: 15,
    markup: 35,
    tax: 8.5,
    wasteDefault: 5,
    mileRate: 0.67,
    dayTarget: 1800,
    amBlock: 900,
    pmBlock: 900,
    gcalUrl: '',
    salaryTarget: 120000,
    billableHrsYear: 1800,
    annualTarget: 480000,
    opCost: 68,
    mtoPhases: ['Rough-in', 'Trim', 'Finish', 'Site Prep'],
    defaultTemplateId: '',
    phaseWeights: {
      Planning: 5,
      Estimating: 10,
      'Site Prep': 10,
      'Rough-in': 35,
      Trim: 25,
      Finish: 15,
    },
    overhead: {
      essential: [
        { id: 'oh_e1', name: 'Truck Payment', monthly: 680 },
        { id: 'oh_e2', name: 'Insurance', monthly: 390 },
        { id: 'oh_e3', name: 'Tools & Consumables', monthly: 220 },
      ],
      extra: [
        { id: 'oh_x1', name: 'Software / Apps', monthly: 85 },
        { id: 'oh_x2', name: 'Marketing', monthly: 150 },
      ],
      loans: [
        { id: 'oh_l1', name: 'Equipment Loan', monthly: 310 },
      ],
      vehicle: [
        { id: 'oh_v1', name: 'Fuel', monthly: 420 },
        { id: 'oh_v2', name: 'Maintenance', monthly: 120 },
      ],
    },
  }
}

// ── Demo weekly data ─────────────────────────────────────────────────────────
// 12 weeks of realistic cash flow data for graph dashboard

function makeDemoWeeklyData(): BackupWeeklyData[] {
  const weeks: BackupWeeklyData[] = []
  const base = Date.now() - 84 * 86400000  // 12 weeks ago
  let accum = 0
  const projValues = [12000, 8500, 15000, 6000, 22000, 11000, 9500, 18000, 14500, 7000, 19000, 13500]
  const svcValues  = [1200, 800, 1800, 600, 2200, 900, 1400, 2000, 1100, 700, 1600, 1300]
  for (let i = 0; i < 12; i++) {
    accum += projValues[i] + svcValues[i]
    weeks.push({
      wk: i + 1,
      start: new Date(base + i * 7 * 86400000).toISOString().slice(0, 10),
      proj: projValues[i],
      svc: svcValues[i],
      accum,
      unbilled: Math.round(projValues[i] * 0.3),
      pendingInv: Math.round(projValues[i] * 0.2),
      totalExposure: Math.round(projValues[i] * 0.6),
      _empty: false,
    })
  }
  return weeks
}

// ── Demo service leads ────────────────────────────────────────────────────────

function makeDemoServiceLeads(): any[] {
  return [
    {
      id: 'demo_sl_1',
      name: 'Panel Upgrade — Hilltop Rd',
      customer: 'B. Flores',
      phone: '(619) 555-0911',
      address: '1109 Hilltop Rd',
      status: 'Advance',
      quoted: 850,
      notes: 'Wants 200A upgrade before selling home.',
      created: new Date(Date.now() - 3 * 86400000).toISOString(),
    },
    {
      id: 'demo_sl_2',
      name: 'EV Charger — Ocean View',
      customer: 'P. Ramirez',
      phone: '(760) 555-0774',
      address: '42 Ocean View Dr',
      status: 'Quoted',
      quoted: 620,
      notes: 'Tesla Model Y, dual-circuit request.',
      created: new Date(Date.now() - 5 * 86400000).toISOString(),
    },
    {
      id: 'demo_sl_3',
      name: 'Generator Hook-up — Laguna St',
      customer: 'D. Wong',
      phone: '(858) 555-0348',
      address: '7801 Laguna St',
      status: 'Booked',
      quoted: 1100,
      notes: 'Whole-home 22kW generator installation.',
      created: new Date(Date.now() - 8 * 86400000).toISOString(),
    },
  ]
}

// ── Demo field logs (project-level) ─────────────────────────────────────────

function makeDemoLogs(): any[] {
  return [
    {
      id: 'demo_flog_1',
      emp: DEMO_OWNER,
      empId: 'demo_emp_1',
      hrs: 8,
      mat: 420,
      miles: 24,
      date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      notes: 'Oceanview Medical — rough-in 2nd floor, panel wiring.',
      phase: 'Rough-in',
      store: 'Pacific Coast Supply',
      profit: 0,
      projId: 'demo_proj_1',
      quoted: 0,
      projName: 'Oceanview Medical Center',
      collected: 0,
      detailLink: '',
      projectQuote: 0,
      emergencyMatInfo: '',
    },
    {
      id: 'demo_flog_2',
      emp: 'Danny R.',
      empId: 'demo_emp_2',
      hrs: 6,
      mat: 180,
      miles: 18,
      date: new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10),
      notes: 'Sunset Retail — trim fixtures installed east wing.',
      phase: 'Trim',
      store: 'Pacific Coast Supply',
      profit: 0,
      projId: 'demo_proj_2',
      quoted: 0,
      projName: 'Sunset Retail Remodel',
      collected: 0,
      detailLink: '',
      projectQuote: 0,
      emergencyMatInfo: '',
    },
    {
      id: 'demo_flog_3',
      emp: DEMO_OWNER,
      empId: 'demo_emp_1',
      hrs: 7,
      mat: 290,
      miles: 14,
      date: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
      notes: 'Harbor ADU — sub-panel rough-in and trench conduit.',
      phase: 'Rough-in',
      store: 'Home Depot',
      profit: 0,
      projId: 'demo_proj_3',
      quoted: 0,
      projName: 'Harbor ADU + Service',
      collected: 0,
      detailLink: '',
      projectQuote: 0,
      emergencyMatInfo: '',
    },
    {
      id: 'demo_flog_4',
      emp: DEMO_OWNER,
      empId: 'demo_emp_1',
      hrs: 3,
      mat: 45,
      miles: 12,
      date: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      notes: 'Service: GFCI outlet circuit — Pacific Ave.',
      phase: 'Service',
      store: 'Home Depot',
      profit: 460,
      projId: '',
      quoted: 650,
      projName: 'Service Call',
      collected: 650,
      detailLink: '',
      projectQuote: 0,
      emergencyMatInfo: '',
    },
  ]
}

// ── Main export: getDemoBackupData() ─────────────────────────────────────────

let _cachedDemoData: BackupData | null = null

/**
 * Returns a fully-shaped BackupData object with generic contractor placeholders.
 * Result is memoized (same reference every call) — safe for display-layer reads.
 * Never writes to localStorage or Supabase.
 */
export function getDemoBackupData(): BackupData {
  if (_cachedDemoData) return _cachedDemoData

  const demoSettings = makeDemoSettings()

  _cachedDemoData = {
    // Core data
    projects:           makeDemoProjects(),
    serviceLogs:        makeDemoServiceLogs(),
    logs:               makeDemoLogs(),
    gcContacts:         makeDemoGCContacts(),
    serviceLeads:       makeDemoServiceLeads(),
    employees:          makeDemoEmployees(),
    weeklyData:         makeDemoWeeklyData(),
    settings:           demoSettings,

    // Non-sensitive / pass-through as empty (unchanged by spec)
    priceBook:          {},
    triggerRules:       [],
    calcRefs:           {},
    customers:          [],
    templates:          [],
    agendaSections:     [],
    completedArchive:   [],
    projectDashboards:  {},
    blueprintSummaries: {},
    activeServiceCalls: [],
    serviceEstimates:   [],
    taskSchedule:       [],
    dailyJobs:          [],
    weeklyReviews:      [],
    imports:            [],
    customAlerts:       [],
    fieldObservationCards: [],

    // Metadata
    _lastSavedAt:    new Date().toISOString(),
    _schemaVersion:  27,
  } as unknown as BackupData

  return _cachedDemoData
}

/**
 * Invalidate the cached demo data (call if demo data needs to be fresh).
 * In practice not needed since demo data is static.
 */
export function invalidateDemoCache(): void {
  _cachedDemoData = null
}
