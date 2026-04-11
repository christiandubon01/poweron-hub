/**
 * TestDataSeeder.ts
 *
 * Creates 5 realistic fictitious projects + 6 multi-day service calls with
 * full financial breakdowns, stored directly into the PowerOn Hub local
 * backup data layer (localStorage via backupDataService).
 *
 * ── ALL RECORDS tagged with `TD_` ID prefix AND project.finance.is_test_data
 * ── MATERIAL DETAIL stored as _materials: [{item, qty, unit_cost}] arrays
 * ── MULTI-DAY service calls use BackupServiceLog adjustments[] per app model
 *
 * VERIFIED FINANCIAL TOTALS:
 *   SUM(contract)  active projects  → $64,500.00
 *   Total costs    active projects  → $12,267.90
 *   Total collected active projects → $22,000.00
 *   Service call total revenue      → $1,975.00
 *   Service call total cost         → $1,017.60
 *
 * NOTE: The spec cites $12,268.90 and $1,037.50 for the last two figures.
 * Arithmetic from the individual line items yields $12,267.90 and $1,017.60.
 * These derived values are used for verification.
 */

import { getBackupData, saveBackupData } from '@/services/backupDataService'
import type { BackupProject, BackupLog, BackupServiceLog } from '@/services/backupDataService'

// ─── ID prefix ────────────────────────────────────────────────────────────────
export const TEST_DATA_ID_PREFIX = 'TD_'

// ─── Extended types (test metadata piggybacks on optional/any fields) ─────────

type MaterialLine = { item: string; qty: number; unit_cost: number }

/** TestLog extends BackupLog — assignable to BackupLog[] via structural subtyping */
type TestLog = BackupLog & {
  /** Detailed material breakdown stored as JSONB-style array */
  _materials?: MaterialLine[]
}

/** TestServiceLog extends BackupServiceLog — same structural subtyping */
type TestServiceLog = BackupServiceLog & {
  _materials?: MaterialLine[]
  _dayEntries?: Array<{
    day: number
    date: string
    hrs: number
    mat: number
    miles: number
    notes: string
    materials: MaterialLine[]
  }>
}

// ─── Public result types ──────────────────────────────────────────────────────

export interface SeedResult {
  success: boolean
  message: string
  counts: { projects: number; logs: number; serviceLogs: number }
}

export interface ClearResult {
  success: boolean
  message: string
  removed: { projects: number; logs: number; serviceLogs: number }
}

export interface VerificationCheck {
  label: string
  expected: string
  actual: string
  pass: boolean
  note?: string
}

export interface VerificationResult {
  allPass: boolean
  checks: VerificationCheck[]
  summary: string
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function isTestId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(TEST_DATA_ID_PREFIX)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmt$(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── Project Logs — Project A (Martinez Kitchen Remodel) ──────────────────────
// 8 days | 30 hrs | $912 materials | 100 miles
function buildLogsProjectA(): TestLog[] {
  const pid = 'TD_proj_a'
  const pname = 'Martinez Kitchen Remodel'
  const pquote = 25000

  return [
    {
      id: 'TD_log_a_01', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-14', hrs: 3, miles: 15, mat: 500, collected: 5000,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed main panel breakers (10-pc kit) and ran 12/2 romex home runs to kitchen circuits.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Main panel breakers (10-pc assorted)', qty: 1, unit_cost: 180 },
        { item: '12/2 Romex NM cable (4 rolls × 250ft)', qty: 4, unit_cost: 80 },
      ],
    },
    {
      id: 'TD_log_a_02', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-17', hrs: 4, miles: 15, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: continued wiring home runs, installed box rough-in for 12 device locations.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_a_03', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-19', hrs: 4, miles: 10, mat: 95, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed 15 outlets and 8 switches — kitchen, dining, and hallway.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Outlets and switches (assorted)', qty: 1, unit_cost: 95 },
      ],
    },
    {
      id: 'TD_log_a_04', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-21', hrs: 4, miles: 15, mat: 72, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed GFCI receptacles at all kitchen countertop and wet-area locations per NEC 210.8.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'GFCI receptacles (6-pk)', qty: 1, unit_cost: 72 },
      ],
    },
    {
      id: 'TD_log_a_05', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-24', hrs: 4, miles: 15, mat: 35, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: completed all terminations — installed wire nuts, push connectors, and ground pigtails.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Wire nuts and push connectors (assorted)', qty: 1, unit_cost: 35 },
      ],
    },
    {
      id: 'TD_log_a_06', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-26', hrs: 4, miles: 10, mat: 210, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Finish', store: 'Home Depot',
      notes: 'Finish: installed under-cabinet lighting kit — low-voltage transformer, LED strips, and dimmer.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Under-cabinet LED lighting kit (complete)', qty: 1, unit_cost: 210 },
      ],
    },
    {
      id: 'TD_log_a_07', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-28', hrs: 4, miles: 10, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Finish', store: '',
      notes: 'Finish: device trim-out — installed all faceplates, tested each circuit, labeled breaker panel.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_a_08', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-02', hrs: 3, miles: 10, mat: 0, collected: 3000,
      emp: 'Owner', empId: 'emp_owner', phase: 'Trim', store: '',
      notes: 'Progress inspection with client — punch list review, collected progress payment. Remaining scope ~35% complete.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
  ]
}

// ─── Project Logs — Project B (Sunrise Dental Office TI) ─────────────────────
// 4 days | 15 hrs | $1,250 materials | 50 miles
function buildLogsProjectB(): TestLog[] {
  const pid = 'TD_proj_b'
  const pname = 'Sunrise Dental Office TI'
  const pquote = 12000

  return [
    {
      id: 'TD_log_b_01', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-31', hrs: 4, miles: 15, mat: 470, collected: 2000,
      emp: 'Owner', empId: 'emp_owner', phase: 'Site Prep', store: 'Graybar',
      notes: 'Site Prep: installed EMT conduit system and MC cable raceways — operatory circuits rough-in start.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'EMT conduit 1/2" and 3/4" with fittings', qty: 1, unit_cost: 280 },
        { item: 'MC cable (250ft spool)', qty: 1, unit_cost: 190 },
      ],
    },
    {
      id: 'TD_log_b_02', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-02', hrs: 4, miles: 15, mat: 540, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Graybar',
      notes: 'Rough-in: installed 6 commercial LED fixtures in operatory rooms — 4000K, 2×4 troffer style.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Commercial 2×4 LED troffer fixtures', qty: 6, unit_cost: 90 },
      ],
    },
    {
      id: 'TD_log_b_03', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-04', hrs: 4, miles: 10, mat: 65, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed junction boxes, pulled splices for lighting homerun circuits.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '4" square junction boxes (assorted covers)', qty: 1, unit_cost: 65 },
      ],
    },
    {
      id: 'TD_log_b_04', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-07', hrs: 3, miles: 10, mat: 175, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Graybar',
      notes: 'Rough-in: pulled wire for all receptacle circuits — dedicated 20A circuits for dental equipment.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '12/2 and 10/2 THHN wire (circuits)', qty: 1, unit_cost: 175 },
      ],
    },
  ]
}

// ─── Project Logs — Project C (Johnson ADU Electrical) ───────────────────────
// 12 days | 45 hrs | $1,675 materials | 85 miles
function buildLogsProjectC(): TestLog[] {
  const pid = 'TD_proj_c'
  const pname = 'Johnson ADU Electrical'
  const pquote = 9500

  return [
    {
      id: 'TD_log_c_01', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-12', hrs: 4, miles: 8, mat: 485, collected: 4000,
      emp: 'Owner', empId: 'emp_owner', phase: 'Site Prep', store: 'Home Depot',
      notes: 'Site Prep: received deposit. Installed 200A main service panel — Square D QO200L200PG.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '200A main service panel (Square D QO200L200PG)', qty: 1, unit_cost: 485 },
      ],
    },
    {
      id: 'TD_log_c_02', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-14', hrs: 4, miles: 8, mat: 220, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Site Prep', store: 'Home Depot',
      notes: 'Site Prep: installed circuit breakers — 15A, 20A, and 40A for kitchen and laundry.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Circuit breakers assorted (15A×8, 20A×6, 40A×2)', qty: 1, unit_cost: 220 },
      ],
    },
    {
      id: 'TD_log_c_03', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-17', hrs: 4, miles: 8, mat: 450, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: ran all NM cable home runs — 14/2, 12/2, and 10/2 throughout ADU.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Romex NM cable assorted (14/2, 12/2, 10/2 rolls)', qty: 1, unit_cost: 450 },
      ],
    },
    {
      id: 'TD_log_c_04', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-19', hrs: 4, miles: 8, mat: 180, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed all standard outlets and switches — living area and bedrooms.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Outlets (15A) and switches (assorted, 20-pc)', qty: 1, unit_cost: 180 },
      ],
    },
    {
      id: 'TD_log_c_05', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-21', hrs: 4, miles: 7, mat: 195, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed GFCI and AFCI protection — all kitchens, baths, and bedroom circuits per NEC.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'GFCI receptacles and AFCI breakers (combo package)', qty: 1, unit_cost: 195 },
      ],
    },
    {
      id: 'TD_log_c_06', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-24', hrs: 4, miles: 7, mat: 85, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed weatherproof boxes at exterior outlets and entry locations.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Weatherproof boxes and covers (exterior locations)', qty: 1, unit_cost: 85 },
      ],
    },
    {
      id: 'TD_log_c_07', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-26', hrs: 4, miles: 7, mat: 60, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: drove ground rods, installed grounding electrode conductor and bonding.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Ground rods (2×8ft) and #6 bare copper grounding wire', qty: 1, unit_cost: 60 },
      ],
    },
    {
      id: 'TD_log_c_08', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-28', hrs: 4, miles: 7, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: completed all rough wiring — pre-inspection walk-through.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_c_09', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-31', hrs: 4, miles: 7, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in inspection passed. Started finish work — panel trim and device installation.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_c_10', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-02', hrs: 3, miles: 7, mat: 0, collected: 3000,
      emp: 'Owner', empId: 'emp_owner', phase: 'Finish', store: '',
      notes: 'Finish: trim-out devices in living areas. Collected progress payment from client.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_c_11', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-05', hrs: 3, miles: 7, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Finish', store: '',
      notes: 'Finish: completed kitchen and bathroom device trim-out. Final panel labeling.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_c_12', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-07', hrs: 3, miles: 4, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Finish', store: '',
      notes: 'Finish: final walk-through with inspector — minor corrections. Trim punch list 90% complete.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
  ]
}

// ─── Project Logs — Project D (El Paseo Beauty Salon) ────────────────────────
// 14 days | 52 hrs | $2,026 materials | 120 miles
function buildLogsProjectD(): TestLog[] {
  const pid = 'TD_proj_d'
  const pname = 'El Paseo Beauty Salon'
  const pquote = 18000

  return [
    {
      id: 'TD_log_d_01', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-12', hrs: 4, miles: 9, mat: 285, collected: 5000,
      emp: 'Owner', empId: 'emp_owner', phase: 'Site Prep', store: 'Graybar',
      notes: 'Site Prep: received deposit from GC (Valley Construction). Set 100A subpanel — Square D QO130L200PC.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '100A subpanel (Square D QO130L200PC)', qty: 1, unit_cost: 285 },
      ],
    },
    {
      id: 'TD_log_d_02', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-14', hrs: 4, miles: 9, mat: 420, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Site Prep', store: 'Graybar',
      notes: 'Site Prep: installed 1" and 3/4" EMT conduit system and all fittings throughout salon.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'EMT conduit 1" and 3/4" with couplings and fittings', qty: 1, unit_cost: 420 },
      ],
    },
    {
      id: 'TD_log_d_03', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-17', hrs: 4, miles: 9, mat: 310, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Graybar',
      notes: 'Rough-in: ran MC cable homerun circuits — lighting, receptacles, and HVAC.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'MC cable 12/2 and 10/2 (500ft spool)', qty: 1, unit_cost: 310 },
      ],
    },
    {
      id: 'TD_log_d_04', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-19', hrs: 4, miles: 9, mat: 280, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Graybar',
      notes: 'Rough-in: pulled wire for 6 dedicated 20A salon station circuits.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '12/2 THHN in conduit for dedicated station circuits', qty: 1, unit_cost: 280 },
      ],
    },
    {
      id: 'TD_log_d_05', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-21', hrs: 4, miles: 9, mat: 160, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed 20A salon station outlets — spec required tamper-resistant duplex.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '20A tamper-resistant duplex outlets for salon stations', qty: 1, unit_cost: 160 },
      ],
    },
    {
      id: 'TD_log_d_06', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-24', hrs: 4, miles: 9, mat: 390, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Graybar',
      notes: 'Rough-in: installed LED track lighting system — 3-circuit, dimmable, throughout salon floor.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'LED track lighting system (3-circuit, dimmable)', qty: 1, unit_cost: 390 },
      ],
    },
    {
      id: 'TD_log_d_07', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-26', hrs: 4, miles: 9, mat: 85, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: wired 4 exhaust fan connections — shampoo bowl area and back-bar stations.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Exhaust fan wiring — flex whips and J-boxes', qty: 1, unit_cost: 85 },
      ],
    },
    {
      id: 'TD_log_d_08', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-28', hrs: 4, miles: 9, mat: 96, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed GFCI protection at shampoo stations and wet-area receptacles per NEC 210.8(B).',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'GFCI receptacles 20A (4-pk) for wet areas', qty: 1, unit_cost: 96 },
      ],
    },
    {
      id: 'TD_log_d_09', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-31', hrs: 3, miles: 8, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: pre-inspection walk-through with GC. NEC 110.26 conflict identified — plumber trench blocking panel clearance. RFI submitted.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_d_10', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-02', hrs: 4, miles: 8, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: held pending RFI resolution. Completed accessible wiring tasks while GC resolves clearance conflict.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_d_11', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-04', hrs: 3, miles: 8, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: GC confirmed reroute decision pending. Completed secondary feeder rough-in while waiting.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_d_12', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-07', hrs: 4, miles: 8, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: GC resolved trench conflict. Finalized subpanel location and completed conduit stubs.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_d_13', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-09', hrs: 3, miles: 8, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: connected feeders to subpanel. Ready for rough-in inspection scheduling.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
    {
      id: 'TD_log_d_14', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-04-10', hrs: 3, miles: 8, mat: 0, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: '',
      notes: 'Rough-in: inspection scheduled for next week. Site cleanup and prep for inspector.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
  ]
}

// ─── Project Logs — Project E (Coachella Valley Apartments — COMPLETED) ──────
// 6 days | 28 hrs | $1,795 materials | 65 miles
function buildLogsProjectE(): TestLog[] {
  const pid = 'TD_proj_e'
  const pname = 'Coachella Valley Apartments Panel Upgrades'
  const pquote = 8500

  return [
    {
      id: 'TD_log_e_01', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-13', hrs: 5, miles: 12, mat: 970, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed two 200A main service panels (Units A and B) — Square D QO200L200PG.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '200A main service panel (Square D QO200L200PG)', qty: 2, unit_cost: 485 },
      ],
    },
    {
      id: 'TD_log_e_02', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-15', hrs: 5, miles: 12, mat: 340, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: installed circuit breakers in both panels — full complement for all apartment circuits.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Circuit breakers (full panel load, assorted)', qty: 1, unit_cost: 340 },
      ],
    },
    {
      id: 'TD_log_e_03', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-18', hrs: 5, miles: 12, mat: 280, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Graybar',
      notes: 'Rough-in: ran new SER service entrance cable from utility meter to both panels.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'SER service entrance cable 4/0-4/0-2/0 (100ft)', qty: 1, unit_cost: 280 },
      ],
    },
    {
      id: 'TD_log_e_04', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-20', hrs: 5, miles: 10, mat: 165, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Graybar',
      notes: 'Rough-in: installed new meter socket — ringless 200A socket with pull-out disconnect.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: 'Meter socket 200A ringless with pull-out disconnect', qty: 1, unit_cost: 165 },
      ],
    },
    {
      id: 'TD_log_e_05', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-22', hrs: 4, miles: 10, mat: 40, collected: 0,
      emp: 'Owner', empId: 'emp_owner', phase: 'Rough-in', store: 'Home Depot',
      notes: 'Rough-in: drove ground rods and installed grounding electrode system for both units.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
      _materials: [
        { item: '8ft copper ground rods (2) with clamps', qty: 1, unit_cost: 40 },
      ],
    },
    {
      id: 'TD_log_e_06', projId: pid, projName: pname, projectQuote: pquote,
      date: '2026-03-25', hrs: 4, miles: 9, mat: 0, collected: 8500,
      emp: 'Owner', empId: 'emp_owner', phase: 'Finish', store: '',
      notes: 'Final: passed inspection, energized both panels, client final walk-through. Final payment collected. PROJECT COMPLETE.',
      profit: 0, quoted: pquote, detailLink: '', emergencyMatInfo: '',
    },
  ]
}

// ─── Service Calls ────────────────────────────────────────────────────────────

function buildServiceLogs(): TestServiceLog[] {
  return [

    // SC-1 — Garcia Outlet Replacement (single day, fully paid)
    // Labor $86 + Mat $13 + Miles $13.20 = $112.20 cost | Revenue $450
    {
      id: 'TD_sc_01',
      date: '2026-04-08',
      customer: 'Luis Garcia',
      address: '12847 Calle Amigos, Desert Hot Springs, CA 92240',
      jtype: 'GFCI / Receptacles',
      hrs: 2,
      mat: 13,
      miles: 20,
      mileCost: 13.20,
      opCost: 86,
      quoted: 450,
      collected: 450,
      payStatus: 'Y',
      balanceDue: 0,
      profit: round2(450 - (13 + 13.20 + 86)),
      notes: 'Replaced 4 standard outlets with 20A spec-grade duplex. Customer had tripped breaker — found overloaded circuit, advised on load distribution.',
      store: 'Home Depot',
      adjustments: [],
      triggersAtSave: [],
      _materials: [
        { item: 'Spec-grade 20A duplex outlet', qty: 1, unit_cost: 8 },
        { item: 'Supplies (wire nuts, tape, connectors)', qty: 1, unit_cost: 5 },
      ],
      _dayEntries: [
        {
          day: 1, date: '2026-04-08', hrs: 2, mat: 13, miles: 20,
          notes: 'Replaced outlets, inspected circuit, advised client.',
          materials: [
            { item: '20A outlet', qty: 1, unit_cost: 8 },
            { item: 'Supplies', qty: 1, unit_cost: 5 },
          ],
        },
      ],
    },

    // SC-2 — Peterson GFCI + Light Fix (2 days, fully paid)
    // Day 1: $64.50 + $27 + $9.90 = $101.40 | Day 2: $43 + $45 + $9.90 = $97.90
    // Total cost: $199.30 | Revenue: $375 | Margin: $175.70 (47%)
    {
      id: 'TD_sc_02',
      date: '2026-04-05',
      customer: 'Stephanie Peterson',
      address: '74210 Desert Willow Ct, Palm Desert, CA 92260',
      jtype: 'Lighting',
      hrs: 1.5,
      mat: 27,
      miles: 15,
      mileCost: 9.90,
      opCost: 64.50,
      quoted: 375,
      collected: 375,
      payStatus: 'Y',
      balanceDue: 0,
      profit: round2(375 - (27 + 9.90 + 64.50 + 43 + 45 + 9.90)),
      notes: 'Day 1: Replaced 2 GFCI receptacles in master bath (tripped and would not reset). Day 2: Diagnosed and replaced kitchen LED fixture that was flickering — scope expanded.',
      store: 'Home Depot',
      adjustments: [
        {
          id: 'TD_adj_sc02_01',
          kind: 'expense',
          category: 'expense',
          amount: 43,
          note: 'Day 2 labor — 1hr fixture diagnosis and replacement',
          date: '2026-04-06',
        },
        {
          id: 'TD_adj_sc02_02',
          kind: 'expense',
          category: 'expense',
          amount: 45,
          note: 'Day 2 materials — LED fixture replacement',
          date: '2026-04-06',
        },
        {
          id: 'TD_adj_sc02_03',
          kind: 'expense',
          category: 'mileage',
          amount: 9.90,
          note: 'Day 2 travel — 15 miles, van ($0.66/mi)',
          date: '2026-04-06',
        },
      ],
      triggersAtSave: [],
      _materials: [
        { item: 'GFCI receptacle 15A (2-pk)', qty: 2, unit_cost: 12 },
        { item: 'Wire nuts assorted', qty: 1, unit_cost: 3 },
        { item: 'LED kitchen flush fixture', qty: 1, unit_cost: 45 },
      ],
      _dayEntries: [
        {
          day: 1, date: '2026-04-05', hrs: 1.5, mat: 27, miles: 15,
          notes: 'Replaced 2 GFCI receptacles in master bath.',
          materials: [
            { item: 'GFCI receptacle 15A', qty: 2, unit_cost: 12 },
            { item: 'Wire nuts', qty: 1, unit_cost: 3 },
          ],
        },
        {
          day: 2, date: '2026-04-06', hrs: 1, mat: 45, miles: 15,
          notes: 'Replaced kitchen LED fixture — scope expanded per client approval.',
          materials: [{ item: 'LED kitchen flush fixture', qty: 1, unit_cost: 45 }],
        },
      ],
    },

    // SC-3 — Thompson Ceiling Fan Install (single day, fully paid)
    // Labor $129 + Mat $17 + Miles $16.50 = $162.50 cost | Revenue $300 | Margin $137.50 (46%)
    {
      id: 'TD_sc_03',
      date: '2026-04-09',
      customer: 'Mike Thompson',
      address: '68350 Calle Las Tiendas, Cathedral City, CA 92234',
      jtype: 'Ceiling Fan',
      hrs: 3,
      mat: 17,
      miles: 25,
      mileCost: 16.50,
      opCost: 129,
      quoted: 300,
      collected: 300,
      payStatus: 'Y',
      balanceDue: 0,
      profit: round2(300 - (17 + 16.50 + 129)),
      notes: 'Installed ceiling fan in master bedroom — replaced old light kit, installed fan-rated brace box, and connected on existing switch loop.',
      store: 'Home Depot',
      adjustments: [],
      triggersAtSave: [],
      _materials: [
        { item: 'Fan-rated ceiling brace kit', qty: 1, unit_cost: 12 },
        { item: 'Wire connectors and supplies', qty: 1, unit_cost: 5 },
      ],
      _dayEntries: [
        {
          day: 1, date: '2026-04-09', hrs: 3, mat: 17, miles: 25,
          notes: 'Installed ceiling fan, replaced brace box, connected switch.',
          materials: [
            { item: 'Fan brace kit', qty: 1, unit_cost: 12 },
            { item: 'Wire connectors', qty: 1, unit_cost: 5 },
          ],
        },
      ],
    },

    // SC-4 — Ramirez Panel Inspection + Quote (2 days, FREE inspection — lead for $4,200 upgrade)
    // Day 1: $43 + $0 + $31.20 = $74.20 | Day 2: $21.50 + $5 + $31.20 = $57.70
    // Total cost: $131.90 | Revenue: $0 | Margin: -$131.90 (lead gen — $4,200 proposal pending)
    {
      id: 'TD_sc_04',
      date: '2026-04-03',
      customer: 'Carmen Ramirez',
      address: '83510 Avenue 44, Indio, CA 92201',
      jtype: 'Panel Inspection',
      hrs: 1,
      mat: 0,
      miles: 30,
      mileCost: 31.20,
      opCost: 43,
      quoted: 0,
      collected: 0,
      payStatus: 'N',
      balanceDue: 0,
      profit: round2(0 - (0 + 31.20 + 43 + 21.50 + 5 + 31.20)),
      notes: 'Day 1: Free panel safety inspection — 1960s Federal Pacific Stab-Lok panel, recommended full replacement. Day 2: Provided written inspection report with upgrade proposal ($4,200 for 200A upgrade).',
      store: 'Office',
      adjustments: [
        {
          id: 'TD_adj_sc04_01',
          kind: 'expense',
          category: 'expense',
          amount: 21.50,
          note: 'Day 2 labor — 0.5hr inspection report write-up',
          date: '2026-04-04',
        },
        {
          id: 'TD_adj_sc04_02',
          kind: 'expense',
          category: 'expense',
          amount: 5,
          note: 'Day 2 materials — report printing and folder',
          date: '2026-04-04',
        },
        {
          id: 'TD_adj_sc04_03',
          kind: 'expense',
          category: 'mileage',
          amount: 31.20,
          note: 'Day 2 travel — 30 miles, truck ($1.04/mi)',
          date: '2026-04-04',
        },
      ],
      triggersAtSave: [],
      _materials: [
        { item: 'Inspection report printing and folder', qty: 1, unit_cost: 5 },
      ],
      _dayEntries: [
        {
          day: 1, date: '2026-04-03', hrs: 1, mat: 0, miles: 30,
          notes: 'Free panel inspection — Federal Pacific Stab-Lok identified.',
          materials: [],
        },
        {
          day: 2, date: '2026-04-04', hrs: 0.5, mat: 5, miles: 30,
          notes: 'Delivered written report and upgrade proposal ($4,200).',
          materials: [{ item: 'Report printing and folder', qty: 1, unit_cost: 5 }],
        },
      ],
    },

    // SC-5 — Williams Emergency Breaker Trip (single day, emergency rate)
    // Labor $43 + Mat $18 + Miles $6.60 = $67.60 cost | Revenue $250 | Margin $182.40 (73%)
    {
      id: 'TD_sc_05',
      date: '2026-04-10',
      customer: 'David Williams',
      address: '14320 Palm Ave, Desert Hot Springs, CA 92240',
      jtype: 'Troubleshoot',
      hrs: 1,
      mat: 18,
      miles: 10,
      mileCost: 6.60,
      opCost: 43,
      quoted: 250,
      collected: 250,
      payStatus: 'Y',
      balanceDue: 0,
      profit: round2(250 - (18 + 6.60 + 43)),
      notes: 'EMERGENCY call — master bedroom circuit tripped and would not reset. Bad AFCI breaker identified. Replaced breaker on-site. Emergency call rate applied.',
      store: 'Home Depot',
      adjustments: [],
      triggersAtSave: [],
      _materials: [
        { item: '15A AFCI single-pole breaker', qty: 1, unit_cost: 18 },
      ],
      _dayEntries: [
        {
          day: 1, date: '2026-04-10', hrs: 1, mat: 18, miles: 10,
          notes: 'Emergency — bad AFCI breaker, replaced on-site.',
          materials: [{ item: '15A AFCI breaker', qty: 1, unit_cost: 18 }],
        },
      ],
    },

    // SC-6 — Chen Office Outlet Add (3 days, scope creep, fully paid)
    // Day 1: $86 + $35 + $13.20 = $134.20
    // Day 2: $64.50 + $67 + $13.20 = $144.70 (scope creep: discovered dedicated circuit needed)
    // Day 3: $43 + $9 + $13.20 = $65.20
    // Total cost: $344.10 | Revenue: $600 | Margin: $255.90 (43%)
    {
      id: 'TD_sc_06',
      date: '2026-04-06',
      customer: 'Dr. Sarah Chen',
      address: '65800 Two Bunch Palms Trail, Desert Hot Springs, CA 92240',
      jtype: 'GFCI / Receptacles',
      hrs: 2,
      mat: 35,
      miles: 20,
      mileCost: 13.20,
      opCost: 86,
      quoted: 600,
      collected: 600,
      payStatus: 'Y',
      balanceDue: 0,
      profit: round2(600 - (35 + 13.20 + 86 + 64.50 + 67 + 13.20 + 43 + 9 + 13.20)),
      notes: 'Day 1: Added 2 outlets in office (same client as Sunrise Dental — office suite). Day 2: Scope creep — discovered existing circuit was already at 80% capacity, installed dedicated circuit per NEC 210.23. Day 3: Completed covers, labels, and final test.',
      store: 'Home Depot',
      adjustments: [
        {
          id: 'TD_adj_sc06_01',
          kind: 'expense',
          category: 'expense',
          amount: 64.50,
          note: 'Day 2 labor — 1.5hr dedicated circuit installation',
          date: '2026-04-07',
        },
        {
          id: 'TD_adj_sc06_02',
          kind: 'expense',
          category: 'expense',
          amount: 67,
          note: 'Day 2 materials — wire $45, breaker $22 (scope creep: dedicated circuit)',
          date: '2026-04-07',
        },
        {
          id: 'TD_adj_sc06_03',
          kind: 'expense',
          category: 'mileage',
          amount: 13.20,
          note: 'Day 2 travel — 20 miles, van ($0.66/mi)',
          date: '2026-04-07',
        },
        {
          id: 'TD_adj_sc06_04',
          kind: 'expense',
          category: 'expense',
          amount: 43,
          note: 'Day 3 labor — 1hr final trim and test',
          date: '2026-04-08',
        },
        {
          id: 'TD_adj_sc06_05',
          kind: 'expense',
          category: 'expense',
          amount: 9,
          note: 'Day 3 materials — cover plates $6, circuit labels $3',
          date: '2026-04-08',
        },
        {
          id: 'TD_adj_sc06_06',
          kind: 'expense',
          category: 'mileage',
          amount: 13.20,
          note: 'Day 3 travel — 20 miles, van ($0.66/mi)',
          date: '2026-04-08',
        },
      ],
      triggersAtSave: [],
      _materials: [
        { item: '15A outlets (2-pk)', qty: 2, unit_cost: 8 },
        { item: 'Single-gang box', qty: 1, unit_cost: 4 },
        { item: '12/2 Romex (15ft)', qty: 1, unit_cost: 15 },
        { item: '12/2 wire for dedicated circuit (25ft)', qty: 1, unit_cost: 45 },
        { item: '20A single-pole breaker', qty: 1, unit_cost: 22 },
        { item: 'Cover plates', qty: 1, unit_cost: 6 },
        { item: 'Circuit labels', qty: 1, unit_cost: 3 },
      ],
      _dayEntries: [
        {
          day: 1, date: '2026-04-06', hrs: 2, mat: 35, miles: 20,
          notes: 'Added 2 outlets in office — existing circuit, standard installation.',
          materials: [
            { item: '15A outlets', qty: 2, unit_cost: 8 },
            { item: 'Single-gang box', qty: 1, unit_cost: 4 },
            { item: '12/2 Romex 15ft', qty: 1, unit_cost: 15 },
          ],
        },
        {
          day: 2, date: '2026-04-07', hrs: 1.5, mat: 67, miles: 20,
          notes: 'Scope creep — installed dedicated 20A circuit per NEC 210.23.',
          materials: [
            { item: '12/2 wire 25ft', qty: 1, unit_cost: 45 },
            { item: '20A single-pole breaker', qty: 1, unit_cost: 22 },
          ],
        },
        {
          day: 3, date: '2026-04-08', hrs: 1, mat: 9, miles: 20,
          notes: 'Installed cover plates and labels. Final test — all circuits pass.',
          materials: [
            { item: 'Cover plates', qty: 1, unit_cost: 6 },
            { item: 'Circuit labels', qty: 1, unit_cost: 3 },
          ],
        },
      ],
    },
  ]
}

// ─── Build full project list ──────────────────────────────────────────────────

function buildProjects(allLogs: TestLog[]): BackupProject[] {
  // Group logs by projId for embedding into project.logs
  const logsByProject: Record<string, TestLog[]> = {}
  for (const log of allLogs) {
    if (!logsByProject[log.projId]) logsByProject[log.projId] = []
    logsByProject[log.projId].push(log)
  }

  const projects: BackupProject[] = [

    // Project A — Martinez Kitchen Remodel (active, ~37% complete)
    {
      id: 'TD_proj_a',
      name: 'Martinez Kitchen Remodel',
      type: 'Residential Remodel',
      status: 'active',
      contract: 25000,
      billed: 8000,
      paid: 8000,
      mileRT: 100,
      miDays: 8,
      laborHrs: 30,
      phases: { Estimating: 100, Planning: 100, 'Site Prep': 100, 'Rough-in': 20, Finish: 0, Trim: 0 },
      logs: logsByProject['TD_proj_a'] ?? [],
      rfis: [],
      finance: {
        is_test_data: true,
        client: 'Robert Martinez',
        address: 'Palm Desert, CA 92211',
        projectType: 'Residential Kitchen Remodel',
        deposit: 5000,
        progressPayment: 3000,
      },
      lastMove: '2026-04-02',
      plannedStart: '2026-03-14',
      plannedEnd: '2026-04-25',
    },

    // Project B — Sunrise Dental Office TI (active, ~20% complete)
    {
      id: 'TD_proj_b',
      name: 'Sunrise Dental Office TI',
      type: 'Commercial TI',
      status: 'active',
      contract: 12000,
      billed: 2000,
      paid: 2000,
      mileRT: 50,
      miDays: 4,
      laborHrs: 15,
      phases: { Estimating: 100, Planning: 100, 'Site Prep': 33, 'Rough-in': 0, Finish: 0, Trim: 0 },
      logs: logsByProject['TD_proj_b'] ?? [],
      rfis: [],
      finance: {
        is_test_data: true,
        client: 'Dr. Sarah Chen',
        address: 'Desert Hot Springs, CA 92240',
        projectType: 'Commercial Tenant Improvement',
        deposit: 2000,
      },
      lastMove: '2026-04-07',
      plannedStart: '2026-03-31',
      plannedEnd: '2026-05-15',
    },

    // Project C — Johnson ADU Electrical (active, ~82% complete)
    {
      id: 'TD_proj_c',
      name: 'Johnson ADU Electrical',
      type: 'Residential New Construction',
      status: 'active',
      contract: 9500,
      billed: 7000,
      paid: 7000,
      mileRT: 85,
      miDays: 12,
      laborHrs: 45,
      phases: { Estimating: 100, Planning: 100, 'Site Prep': 100, 'Rough-in': 100, Finish: 70, Trim: 0 },
      logs: logsByProject['TD_proj_c'] ?? [],
      rfis: [],
      finance: {
        is_test_data: true,
        client: 'Angela Johnson',
        address: 'Cathedral City, CA 92234',
        projectType: 'Residential ADU New Construction',
        deposit: 4000,
        progressPayment: 3000,
      },
      lastMove: '2026-04-07',
      plannedStart: '2026-03-12',
      plannedEnd: '2026-04-20',
    },

    // Project D — El Paseo Beauty Salon (active, ~40% complete, open RFI)
    {
      id: 'TD_proj_d',
      name: 'El Paseo Beauty Salon',
      type: 'Commercial Salon Build-Out',
      status: 'active',
      contract: 18000,
      billed: 5000,
      paid: 5000,
      mileRT: 120,
      miDays: 14,
      laborHrs: 52,
      phases: { Estimating: 100, Planning: 100, 'Site Prep': 100, 'Rough-in': 30, Finish: 0, Trim: 0 },
      logs: logsByProject['TD_proj_d'] ?? [],
      rfis: [
        {
          id: 'TD_rfi_d_01',
          status: 'open',
          question: 'NEC 110.26 panel clearance conflict — plumber trench located within 3ft working space of new 100A subpanel location. Coordination required before energizing panel or scheduling inspection.',
          directedTo: 'Valley Construction (GC)',
          submitted: '2026-03-31',
          response: '',
          costImpact: 'Potential schedule delay. Reroute plumber trench or relocate panel — estimated change order $400–$800.',
        },
      ],
      finance: {
        is_test_data: true,
        client: 'Elegance Spa LLC',
        address: 'El Paseo, Palm Desert, CA 92260',
        gc: 'Valley Construction',
        projectType: 'Commercial Salon Build-Out',
        deposit: 5000,
        depositSource: 'GC (Valley Construction)',
      },
      lastMove: '2026-04-10',
      plannedStart: '2026-03-12',
      plannedEnd: '2026-05-30',
    },

    // Project E — Coachella Valley Apartments Panel Upgrades (COMPLETED)
    {
      id: 'TD_proj_e',
      name: 'Coachella Valley Apartments Panel Upgrades',
      type: 'Multi-Unit Residential',
      status: 'completed',
      contract: 8500,
      billed: 8500,
      paid: 8500,
      mileRT: 65,
      miDays: 6,
      laborHrs: 28,
      phases: { Estimating: 100, Planning: 100, 'Site Prep': 100, 'Rough-in': 100, Finish: 100, Trim: 100 },
      logs: logsByProject['TD_proj_e'] ?? [],
      rfis: [],
      finance: {
        is_test_data: true,
        client: 'Desert Property Management',
        address: 'Indio, CA 92201',
        projectType: 'Multi-Unit Residential Panel Upgrade',
        paidInFull: true,
        completedAt: '2026-03-25',
        finalMargin: round2(8500 - (28 * 43 + 1795 + 65 * 0.66)),
      },
      completionPromptSig: 'completed_2026-03-25',
      lastMove: '2026-03-25',
      plannedStart: '2026-03-13',
      plannedEnd: '2026-03-25',
    },
  ]

  return projects
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Returns true if any test data exists in the backup store.
 */
export function hasTestData(): boolean {
  const data = getBackupData()
  if (!data) return false
  const hasProjects = (data.projects || []).some(p => isTestId(p.id))
  const hasLogs = (data.logs || []).some((l: BackupLog) => isTestId(l.id))
  const hasSvc = (data.serviceLogs || []).some((s: BackupServiceLog) => isTestId(s.id))
  return hasProjects || hasLogs || hasSvc
}

/**
 * Seeds all test projects, field logs, and service calls into the backup store.
 * Skips records already present (idempotent on re-run).
 */
export function seedTestData(): SeedResult {
  try {
    const data = getBackupData()
    if (!data) {
      return { success: false, message: 'No backup data store found. Import or initialize data first.', counts: { projects: 0, logs: 0, serviceLogs: 0 } }
    }

    // Build all logs first (needed for project.logs embedding)
    const allLogs: TestLog[] = [
      ...buildLogsProjectA(),
      ...buildLogsProjectB(),
      ...buildLogsProjectC(),
      ...buildLogsProjectD(),
      ...buildLogsProjectE(),
    ]

    const allProjects = buildProjects(allLogs)
    const allServiceLogs = buildServiceLogs()

    // Existing IDs (to avoid duplicates)
    const existingProjectIds = new Set((data.projects || []).map(p => p.id))
    const existingLogIds = new Set((data.logs || []).map((l: BackupLog) => l.id))
    const existingSvcIds = new Set((data.serviceLogs || []).map((s: BackupServiceLog) => s.id))

    let newProjects = 0
    let newLogs = 0
    let newSvcs = 0

    for (const project of allProjects) {
      if (!existingProjectIds.has(project.id)) {
        data.projects.push(project)
        newProjects++
      }
    }

    for (const log of allLogs) {
      if (!existingLogIds.has(log.id)) {
        data.logs.push(log as BackupLog)
        newLogs++
      }
    }

    for (const svc of allServiceLogs) {
      if (!existingSvcIds.has(svc.id)) {
        data.serviceLogs.push(svc as BackupServiceLog)
        newSvcs++
      }
    }

    data._lastSavedAt = new Date().toISOString()
    saveBackupData(data)

    return {
      success: true,
      message: `Test data loaded — ${newProjects} projects, ${newLogs} field logs, ${newSvcs} service calls inserted.`,
      counts: { projects: newProjects, logs: newLogs, serviceLogs: newSvcs },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: `Seed failed: ${msg}`, counts: { projects: 0, logs: 0, serviceLogs: 0 } }
  }
}

/**
 * Removes all test data records (identified by TD_ prefix).
 */
export function clearTestData(): ClearResult {
  try {
    const data = getBackupData()
    if (!data) {
      return { success: false, message: 'No backup data store found.', removed: { projects: 0, logs: 0, serviceLogs: 0 } }
    }

    const beforeProjects = (data.projects || []).length
    const beforeLogs = (data.logs || []).length
    const beforeSvc = (data.serviceLogs || []).length

    data.projects = (data.projects || []).filter(p => !isTestId(p.id))
    data.logs = (data.logs || []).filter((l: BackupLog) => !isTestId(l.id))
    data.serviceLogs = (data.serviceLogs || []).filter((s: BackupServiceLog) => !isTestId(s.id))

    const removedProjects = beforeProjects - data.projects.length
    const removedLogs = beforeLogs - data.logs.length
    const removedSvc = beforeSvc - data.serviceLogs.length

    data._lastSavedAt = new Date().toISOString()
    saveBackupData(data)

    return {
      success: true,
      message: `Test data cleared — removed ${removedProjects} projects, ${removedLogs} field logs, ${removedSvc} service calls.`,
      removed: { projects: removedProjects, logs: removedLogs, serviceLogs: removedSvc },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: `Clear failed: ${msg}`, removed: { projects: 0, logs: 0, serviceLogs: 0 } }
  }
}

/**
 * Runs verification queries against the seeded test data and returns pass/fail per check.
 *
 * EXPECTED VALUES (derived from spec line items):
 *   1. SUM(contract) active test projects         → $64,500.00
 *   2. Total costs   active test projects          → $12,267.90
 *   3. Total collected from active test projects   → $22,000.00
 *   4. Service call total revenue                  → $1,975.00
 *   5. Service call total cost                     → $1,017.60
 */
export function verifyTestData(): VerificationResult {
  const data = getBackupData()

  if (!data) {
    return {
      allPass: false,
      checks: [{ label: 'Data store available', expected: 'true', actual: 'false', pass: false }],
      summary: 'FAIL — No data store found.',
    }
  }

  const testProjects = (data.projects || []).filter(p => isTestId(p.id))
  const testLogs = (data.logs || []).filter((l: BackupLog) => isTestId(l.id))
  const testSvcLogs = (data.serviceLogs || []).filter((s: BackupServiceLog) => isTestId(s.id))
  const activeTestProjects = testProjects.filter(p => p.status === 'active')
  const activeTestProjectIds = new Set(activeTestProjects.map(p => p.id))

  // ── CHECK 1: SUM(contract) for active test projects ───────────────────────
  const sumContract = activeTestProjects.reduce((acc, p) => acc + (p.contract || 0), 0)

  // ── CHECK 2: Total costs for active test projects ─────────────────────────
  // Cost = labor (hrs × $43) + materials (sum of log.mat) + transportation (miles × rate)
  // Van logs: Projects A ($0.66/mi), C ($0.66/mi), E ($0.66/mi)
  // Truck logs: Projects B ($1.04/mi), D ($1.04/mi)
  const activeLogsA = testLogs.filter(l => l.projId === 'TD_proj_a')
  const activeLogsB = testLogs.filter(l => l.projId === 'TD_proj_b')
  const activeLogsC = testLogs.filter(l => l.projId === 'TD_proj_c')
  const activeLogsD = testLogs.filter(l => l.projId === 'TD_proj_d')

  const laborCostA = activeLogsA.reduce((s, l) => s + l.hrs * 43, 0)
  const matCostA = activeLogsA.reduce((s, l) => s + l.mat, 0)
  const mileCostA = activeLogsA.reduce((s, l) => s + l.miles * 0.66, 0)

  const laborCostB = activeLogsB.reduce((s, l) => s + l.hrs * 43, 0)
  const matCostB = activeLogsB.reduce((s, l) => s + l.mat, 0)
  const mileCostB = activeLogsB.reduce((s, l) => s + l.miles * 1.04, 0)

  const laborCostC = activeLogsC.reduce((s, l) => s + l.hrs * 43, 0)
  const matCostC = activeLogsC.reduce((s, l) => s + l.mat, 0)
  const mileCostC = activeLogsC.reduce((s, l) => s + l.miles * 0.66, 0)

  const laborCostD = activeLogsD.reduce((s, l) => s + l.hrs * 43, 0)
  const matCostD = activeLogsD.reduce((s, l) => s + l.mat, 0)
  const mileCostD = activeLogsD.reduce((s, l) => s + l.miles * 1.04, 0)

  const totalCostActive = round2(
    laborCostA + matCostA + mileCostA +
    laborCostB + matCostB + mileCostB +
    laborCostC + matCostC + mileCostC +
    laborCostD + matCostD + mileCostD
  )

  // ── CHECK 3: Total collected from active test projects ────────────────────
  const totalCollectedActive = activeTestProjects.reduce((acc, p) => acc + (p.paid || 0), 0)

  // ── CHECK 4: Service call total revenue ──────────────────────────────────
  const svcRevenue = testSvcLogs.reduce((acc, s) => acc + (s.collected || 0), 0)

  // ── CHECK 5: Service call total cost ─────────────────────────────────────
  // Cost = base(mat + mileCost + opCost) + sum(adjustments.expense + adjustments.mileage)
  const svcCost = round2(testSvcLogs.reduce((acc, s) => {
    const base = (s.mat || 0) + (s.mileCost || 0) + (s.opCost || 0)
    const adjCost = (s.adjustments || []).reduce((a: number, adj: any) => {
      if (adj.kind === 'expense') return a + (adj.amount || 0)
      if (adj.category === 'mileage') return a + (adj.amount || 0)
      return a
    }, 0)
    return acc + base + adjCost
  }, 0))

  // ── Checks ────────────────────────────────────────────────────────────────
  const checks: VerificationCheck[] = [
    {
      label: 'Test records present (5 projects + 44 field logs + 6 service calls)',
      expected: '5 | 44 | 6',
      actual: `${testProjects.length} | ${testLogs.length} | ${testSvcLogs.length}`,
      pass: testProjects.length === 5 && testLogs.length === 44 && testSvcLogs.length === 6,
    },
    {
      label: 'Active projects: 4 (A, B, C, D)',
      expected: '4',
      actual: String(activeTestProjects.length),
      pass: activeTestProjects.length === 4,
    },
    {
      label: 'SUM(contract) active test projects',
      expected: fmt$(64500),
      actual: fmt$(sumContract),
      pass: sumContract === 64500,
    },
    {
      label: 'Total costs across active test projects',
      expected: fmt$(12267.90),
      actual: fmt$(totalCostActive),
      pass: totalCostActive === 12267.90,
      note: 'Labor($6,106) + Materials($5,863) + Transport($298.90)',
    },
    {
      label: 'Total collected (active test projects)',
      expected: fmt$(22000),
      actual: fmt$(totalCollectedActive),
      pass: totalCollectedActive === 22000,
    },
    {
      label: 'Service call total revenue',
      expected: fmt$(1975),
      actual: fmt$(svcRevenue),
      pass: svcRevenue === 1975,
    },
    {
      label: 'Service call total cost',
      expected: fmt$(1017.60),
      actual: fmt$(svcCost),
      pass: svcCost === 1017.60,
      note: 'Sum of base costs + all adjustment amounts',
    },
    {
      label: 'Project E status: completed, paid in full',
      expected: 'status=completed, paid=$8,500',
      actual: (() => {
        const e = testProjects.find(p => p.id === 'TD_proj_e')
        return e ? `status=${e.status}, paid=${fmt$(e.paid)}` : 'NOT FOUND'
      })(),
      pass: (() => {
        const e = testProjects.find(p => p.id === 'TD_proj_e')
        return !!e && e.status === 'completed' && e.paid === 8500
      })(),
    },
    {
      label: 'Project D has open RFI (NEC 110.26 conflict)',
      expected: '1 open RFI',
      actual: (() => {
        const d = testProjects.find(p => p.id === 'TD_proj_d')
        const openRfis = (d?.rfis || []).filter((r: any) => r.status === 'open').length
        return `${openRfis} open RFI`
      })(),
      pass: (() => {
        const d = testProjects.find(p => p.id === 'TD_proj_d')
        return (d?.rfis || []).filter((r: any) => r.status === 'open').length === 1
      })(),
    },
    {
      label: 'SC-4 Ramirez: free inspection (quoted=$0, cost=-$131.90)',
      expected: `quoted=$0, cost=-${fmt$(131.90)}`,
      actual: (() => {
        const sc4 = testSvcLogs.find(s => s.id === 'TD_sc_04')
        if (!sc4) return 'NOT FOUND'
        const baseCost = (sc4.mat || 0) + (sc4.mileCost || 0) + (sc4.opCost || 0)
        const adjCost = (sc4.adjustments || []).reduce((a: number, adj: any) => a + (adj.amount || 0), 0)
        return `quoted=$${sc4.quoted}, cost=-${fmt$(round2(baseCost + adjCost))}`
      })(),
      pass: (() => {
        const sc4 = testSvcLogs.find(s => s.id === 'TD_sc_04')
        if (!sc4) return false
        const baseCost = (sc4.mat || 0) + (sc4.mileCost || 0) + (sc4.opCost || 0)
        const adjCost = (sc4.adjustments || []).reduce((a: number, adj: any) => a + (adj.amount || 0), 0)
        return sc4.quoted === 0 && round2(baseCost + adjCost) === 131.90
      })(),
    },
    {
      label: 'All 44 field log entries present (A:8 B:4 C:12 D:14 E:6)',
      expected: '44 total test field logs',
      actual: `${testLogs.length} total test logs`,
      pass: testLogs.length === 44,
    },
  ]

  const allPass = checks.every(c => c.pass)
  const passCount = checks.filter(c => c.pass).length

  return {
    allPass,
    checks,
    summary: allPass
      ? `✅ ALL ${checks.length} CHECKS PASSED — test data is financially consistent.`
      : `⚠ ${passCount}/${checks.length} checks passed — review failed checks above.`,
  }
}
