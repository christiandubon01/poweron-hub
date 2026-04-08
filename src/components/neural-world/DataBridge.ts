/**
 * DataBridge.ts — Supabase data layer for Neural World.
 *
 * Fetches project, invoice, field_log, RFI, crew, and hub event data.
 * Refreshes every 60 seconds.
 * Exposes typed data to all world components via a simple observer pattern.
 *
 * NW2 scope: projects, invoices, field_logs
 * NW9 scope: rfis, solarIncome
 * NW11 scope: crewMembers, hubEvents, accountingSignals
 */

import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NWProject {
  id: string
  name: string
  status: 'lead' | 'estimate' | 'pending' | 'approved' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled'
  contract_value: number
  health_score: number          // 0–100; defaults to 100 if not in DB
  org_id: string
  /** NW9: material cost for canyon depth calculation */
  material_cost: number
  /** NW9: phase completion 0–100 */
  phase_completion: number
  /** NW11: when project was created */
  created_at: string | null
}

export interface NWInvoice {
  id: string
  project_id: string | null
  amount: number
  status: string
  due_date: string | null
  org_id: string
  /** NW9: when invoice was created (for stalactite age) */
  created_at: string | null
  /** NW9: when invoice was paid (for dissolve effect) */
  paid_at: string | null
}

export interface NWFieldLog {
  id: string
  project_id: string | null
  hours: number
  org_id: string
  /** NW9: crew / employee id for labor ridge lines */
  crew_id: string | null
  log_date: string | null
}

/** NW9: Open RFI record for fault lines */
export interface NWRFI {
  id: string
  project_id: string | null
  status: string       // 'open' | 'closed' | 'pending'
  created_at: string | null
  resolved_at: string | null
  org_id: string
}

/** NW11: Crew member record for labor ridge / growth factor */
export interface NWCrewMember {
  id: string
  name: string
  role: string | null
  org_id: string
  created_at: string | null
  /** NW11: active flag — if false this crew left (churn signal) */
  active: boolean
}

/** NW11: Hub platform event record — subscriber joins, feature launches, etc. */
export interface NWHubEvent {
  id: string
  event_type: string   // 'subscriber_joined' | 'subscriber_cancelled' | 'feature_launched' | 'service_area_added'
  payload: Record<string, unknown>
  created_at: string | null
  org_id: string
}

/** NW11: Derived accounting signals — computed from raw data each refresh */
export interface NWAccountingSignals {
  /** Total monthly overhead (sum of all overhead category items) */
  overheadMonthly: number
  /** Fraction of total contract value concentrated in single top client (0–1) */
  singleClientDependencyRatio: number
  /** Project ID of the dominant client (most contract value) */
  dominantProjectId: string | null
  /** Invoice amounts that are past 30 days unpaid */
  arOver30Days: NWInvoice[]
  /** Distinct service area codes derived from project names/types */
  serviceAreaCount: number
  /** Crew count as of last fetch */
  activeCrewCount: number
  /** Total paid invoice amount in last 30 days (revenue momentum) */
  recentPaidAmount: number
  /** Payroll signal: total hours logged in last 7 days (used for west-dim intensity) */
  recentPayrollHours: number
  /** Subscription cost estimate: count of active hub subscribers × avg fee */
  hubSubscriberCount: number
  /** Recent hub feature launches (last 30 days) */
  recentFeatureLaunches: number
}

export interface NWWorldData {
  projects: NWProject[]
  invoices: NWInvoice[]
  fieldLogs: NWFieldLog[]
  /** NW9: open and recently resolved RFIs */
  rfis: NWRFI[]
  /** NW9: solar income value (from org settings or aggregated solar project revenue) */
  solarIncome: number
  /** NW11: crew members for labor ridge / growth signals */
  crewMembers: NWCrewMember[]
  /** NW11: hub platform events for subscriber / feature signals */
  hubEvents: NWHubEvent[]
  /** NW11: computed accounting signals */
  accountingSignals: NWAccountingSignals
  lastFetched: number
}

// ── Observer pattern ──────────────────────────────────────────────────────────

type DataListener = (data: NWWorldData) => void

const _emptySignals: NWAccountingSignals = {
  overheadMonthly: 0,
  singleClientDependencyRatio: 0,
  dominantProjectId: null,
  arOver30Days: [],
  serviceAreaCount: 0,
  activeCrewCount: 0,
  recentPaidAmount: 0,
  recentPayrollHours: 0,
  hubSubscriberCount: 0,
  recentFeatureLaunches: 0,
}

let _currentData: NWWorldData = {
  projects: [],
  invoices: [],
  fieldLogs: [],
  rfis: [],
  solarIncome: 0,
  crewMembers: [],
  hubEvents: [],
  accountingSignals: { ..._emptySignals },
  lastFetched: 0,
}

const _listeners: Set<DataListener> = new Set()
let _refreshTimer: ReturnType<typeof setInterval> | null = null
let _fetchInProgress = false

function _notify() {
  for (const fn of _listeners) {
    try { fn(_currentData) } catch { /* ignore listener errors */ }
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function _fetchAll(): Promise<void> {
  if (_fetchInProgress) return
  _fetchInProgress = true

  try {
    const [
      projectsResult,
      invoicesResult,
      fieldLogsResult,
      rfisResult,
      crewResult,
      hubEventsResult,
    ] = await Promise.all([
      (supabase as any)
        .from('projects')
        .select('id, name, status, contract_value, health_score, org_id, material_cost, phase_completion, created_at')
        .order('created_at', { ascending: false }),

      (supabase as any)
        .from('invoices')
        .select('id, project_id, amount, status, due_date, org_id, created_at, paid_at')
        .order('created_at', { ascending: false }),

      (supabase as any)
        .from('field_logs')
        .select('id, project_id, hours, org_id, crew_id, log_date')
        .order('log_date', { ascending: false }),

      // NW9: RFIs for fault lines — non-fatal if table doesn't exist
      (supabase as any)
        .from('rfis')
        .select('id, project_id, status, created_at, resolved_at, org_id')
        .order('created_at', { ascending: false })
        .limit(200),

      // NW11: crew members — non-fatal if table doesn't exist
      (supabase as any)
        .from('crew_members')
        .select('id, name, role, org_id, created_at, active')
        .order('created_at', { ascending: false })
        .limit(100),

      // NW11: hub platform events — non-fatal if table doesn't exist
      (supabase as any)
        .from('hub_platform_events')
        .select('id, event_type, payload, created_at, org_id')
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    const rawProjects: any[]   = projectsResult.data   ?? []
    const rawInvoices: any[]   = invoicesResult.data   ?? []
    const rawFieldLogs: any[]  = fieldLogsResult.data  ?? []
    const rawRFIs: any[]       = rfisResult.data       ?? []
    const rawCrew: any[]       = crewResult.data       ?? []
    const rawHubEvents: any[]  = hubEventsResult.data  ?? []

    const projects: NWProject[] = rawProjects.map((p: any) => ({
      id: p.id ?? '',
      name: p.name ?? 'Unnamed',
      status: p.status ?? 'pending',
      contract_value: typeof p.contract_value === 'number' ? p.contract_value : 0,
      health_score: typeof p.health_score === 'number' ? p.health_score : 100,
      org_id: p.org_id ?? '',
      material_cost: typeof p.material_cost === 'number' ? p.material_cost : 0,
      phase_completion: typeof p.phase_completion === 'number' ? p.phase_completion : 0,
      created_at: p.created_at ?? null,
    }))

    const invoices: NWInvoice[] = rawInvoices.map((inv: any) => ({
      id: inv.id ?? '',
      project_id: inv.project_id ?? null,
      amount: typeof inv.amount === 'number' ? inv.amount : 0,
      status: inv.status ?? 'draft',
      due_date: inv.due_date ?? null,
      org_id: inv.org_id ?? '',
      created_at: inv.created_at ?? null,
      paid_at: inv.paid_at ?? null,
    }))

    const fieldLogs: NWFieldLog[] = rawFieldLogs.map((fl: any) => ({
      id: fl.id ?? '',
      project_id: fl.project_id ?? null,
      hours: typeof fl.hours === 'number' ? fl.hours : 0,
      org_id: fl.org_id ?? '',
      crew_id: fl.crew_id ?? null,
      log_date: fl.log_date ?? null,
    }))

    const rfis: NWRFI[] = rawRFIs.map((r: any) => ({
      id: r.id ?? '',
      project_id: r.project_id ?? null,
      status: r.status ?? 'open',
      created_at: r.created_at ?? null,
      resolved_at: r.resolved_at ?? null,
      org_id: r.org_id ?? '',
    }))

    const crewMembers: NWCrewMember[] = rawCrew.map((c: any) => ({
      id: c.id ?? '',
      name: c.name ?? 'Unknown',
      role: c.role ?? null,
      org_id: c.org_id ?? '',
      created_at: c.created_at ?? null,
      active: c.active !== false,
    }))

    const hubEvents: NWHubEvent[] = rawHubEvents.map((e: any) => ({
      id: e.id ?? '',
      event_type: e.event_type ?? '',
      payload: (e.payload && typeof e.payload === 'object') ? e.payload as Record<string, unknown> : {},
      created_at: e.created_at ?? null,
      org_id: e.org_id ?? '',
    }))

    // NW9: solar income — sum contract_value of projects tagged solar/MTZ
    const solarProjects = projects.filter(p =>
      p.name.toLowerCase().includes('solar') ||
      p.name.toLowerCase().includes('mtz') ||
      p.name.toLowerCase().includes('pv')
    )
    const solarIncome = solarProjects.reduce((sum, p) => sum + p.contract_value, 0)

    // ── NW11: Compute accounting signals ──────────────────────────────────────

    const now = Date.now()
    const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000
    const MS_7_DAYS  =  7 * 24 * 60 * 60 * 1000

    // AR over 30 days: unpaid invoices created more than 30 days ago
    const arOver30Days = invoices.filter(inv => {
      if (inv.status === 'paid' || inv.status === 'cancelled') return false
      if (!inv.created_at) return false
      return (now - new Date(inv.created_at).getTime()) > MS_30_DAYS
    })

    // Single client dependency: which project holds the most contract value?
    const totalContractValue = projects.reduce((s, p) => s + p.contract_value, 0)
    let maxProjectValue = 0
    let dominantProjectId: string | null = null
    for (const p of projects) {
      if (p.contract_value > maxProjectValue) {
        maxProjectValue = p.contract_value
        dominantProjectId = p.id
      }
    }
    const singleClientDependencyRatio =
      totalContractValue > 0 ? maxProjectValue / totalContractValue : 0

    // Recent paid amount (last 30 days)
    const recentPaidAmount = invoices
      .filter(inv => {
        if (inv.status !== 'paid' || !inv.paid_at) return false
        return (now - new Date(inv.paid_at).getTime()) < MS_30_DAYS
      })
      .reduce((s, inv) => s + inv.amount, 0)

    // Recent payroll hours (last 7 days)
    const recentPayrollHours = fieldLogs
      .filter(fl => {
        if (!fl.log_date) return false
        return (now - new Date(fl.log_date).getTime()) < MS_7_DAYS
      })
      .reduce((s, fl) => s + fl.hours, 0)

    // Service areas: distinct keywords in project names/types
    const serviceKeywords = new Set<string>()
    for (const p of projects) {
      const words = p.name.toLowerCase().split(/[\s,/-]+/)
      for (const w of words) {
        if (w.length > 4) serviceKeywords.add(w)
      }
    }
    const serviceAreaCount = Math.max(1, Math.min(serviceKeywords.size, 20))

    // Active crew count
    const activeCrewCount = crewMembers.filter(c => c.active).length

    // Hub subscriber count from events
    const subscriberJoined = hubEvents.filter(e => e.event_type === 'subscriber_joined').length
    const subscriberCancelled = hubEvents.filter(e => e.event_type === 'subscriber_cancelled').length
    const hubSubscriberCount = Math.max(0, subscriberJoined - subscriberCancelled)

    // Recent feature launches (last 30 days)
    const recentFeatureLaunches = hubEvents.filter(e => {
      if (e.event_type !== 'feature_launched') return false
      if (!e.created_at) return false
      return (now - new Date(e.created_at).getTime()) < MS_30_DAYS
    }).length

    // Overhead: not directly in Supabase at DataBridge level,
    // derive a proxy from recent non-payroll expenses if available.
    // We use a conservative fixed estimate: $5k/month as fallback.
    const overheadMonthly = 5000

    const accountingSignals: NWAccountingSignals = {
      overheadMonthly,
      singleClientDependencyRatio,
      dominantProjectId,
      arOver30Days,
      serviceAreaCount,
      activeCrewCount,
      recentPaidAmount,
      recentPayrollHours,
      hubSubscriberCount,
      recentFeatureLaunches,
    }

    _currentData = {
      projects,
      invoices,
      fieldLogs,
      rfis,
      solarIncome,
      crewMembers,
      hubEvents,
      accountingSignals,
      lastFetched: Date.now(),
    }

    _notify()
  } catch (err) {
    console.warn('[DataBridge] fetch error (non-blocking):', err)
  } finally {
    _fetchInProgress = false
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Subscribe to world data updates. Returns an unsubscribe function. */
export function subscribeWorldData(listener: DataListener): () => void {
  _listeners.add(listener)
  // Immediately fire with current data if already loaded
  if (_currentData.lastFetched > 0) {
    try { listener(_currentData) } catch { /* ignore */ }
  }
  return () => _listeners.delete(listener)
}

/** Get the most recently fetched data synchronously. */
export function getWorldData(): NWWorldData {
  return _currentData
}

/**
 * Initialize DataBridge: fetch immediately and start 60s refresh loop.
 * Safe to call multiple times — subsequent calls are no-ops if already running.
 */
export function initDataBridge(): void {
  // Kick off initial fetch
  _fetchAll()

  // Start refresh loop (60 seconds) — only once
  if (!_refreshTimer) {
    _refreshTimer = setInterval(() => {
      _fetchAll()
    }, 60_000)
  }
}

/** Dispose the refresh loop (call on world unmount). */
export function disposeDataBridge(): void {
  if (_refreshTimer) {
    clearInterval(_refreshTimer)
    _refreshTimer = null
  }
  _listeners.clear()
  _fetchInProgress = false
}

// ── Position seeding ──────────────────────────────────────────────────────────

/**
 * Derives a deterministic (x, z) position on the ground plane from a project ID.
 * Uses a simple string hash so the same ID always maps to the same location.
 *
 * NW8: Projects (Power On Solutions LLC) placed on WEST continent only.
 * West continent spans x=-200 to x=-20. Mountains placed in x=-185 to -35
 * (15-unit margin from river edge, 15-unit margin from west border).
 * Z range: -180 to 180 (within 400-unit depth, 20-unit margins).
 */
export function seededPosition(projectId: string): { x: number; z: number } {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < projectId.length; i++) {
    const c = projectId.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n1 = (h1 >>> 0) / 0xffffffff  // 0–1
  const n2 = (h2 >>> 0) / 0xffffffff  // 0–1
  // NW8: West continent — x from -35 to -185 (span 150, centered at -110)
  const x = -35 - n1 * 150
  // Z: full continent depth with margins — -180 to 180 (span 360)
  const z = (n2 - 0.5) * 360
  return { x, z }
}

/** Convert contract_value to world height units per the NW2 scale formula. */
export function contractValueToHeight(value: number): number {
  if (value <= 0) return 0
  if (value >= 25000) return 5 + (value - 25000) / 5000
  if (value >= 10000) return 2 + ((value - 10000) / 15000) * 2
  if (value >= 1000)  return 0.5 + ((value - 1000) / 9000) * 1.5
  return 0.1 + (value / 1000) * 0.4
}
