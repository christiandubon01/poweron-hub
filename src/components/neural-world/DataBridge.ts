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
 * NW13 scope: clientTerritories — customer intelligence layer
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
  /** NW13: project type from DB */
  type: string | null
  /** NW13: client_id for territory grouping */
  client_id: string | null
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

// ── NW13: Client territory types ─────────────────────────────────────────────

/** Terrain archetype for a customer territory */
export type NWTerritoryTerrain = 'green_rolling' | 'rocky_unstable' | 'flat_barren'

/** Structure archetype placed at territory center */
export type NWTerritoryStructure =
  | 'residential'   // small house geometry
  | 'commercial'    // office tower geometry
  | 'solar'         // house with panel array
  | 'service_only'  // small shed geometry
  | 'prospect'      // wireframe ghost structure

/** Weather sentiment over territory */
export type NWTerritoryWeather = 'clear' | 'overcast' | 'storm'

/** NW13: Derived client territory record — one per unique client */
export interface NWClientTerritory {
  /** Unique client key: client_id if available, else normalized client name */
  clientKey: string
  /** Display name */
  clientName: string
  /** Client type from DB or inferred from project types */
  clientType: 'residential' | 'commercial' | 'industrial' | 'solar' | 'service' | 'prospect'
  /** Total contract value across all projects (territory size) */
  lifetimeValue: number
  /** Number of projects */
  projectCount: number
  /** Number of active / in_progress projects */
  activeProjectCount: number
  /** Most recent project created_at or last_move date */
  lastContactAt: string | null
  /** Days since last contact (derived) */
  daysSinceContact: number
  /** Sum of open RFIs across projects */
  openRfiCount: number
  /** Ratio of paid to billed (0–1, 1 = fully paid) */
  paidRatio: number
  /** Seeded world-space position on west continent */
  worldX: number
  worldZ: number
  /** Territory half-size in world units (derived from lifetimeValue) */
  territoryRadius: number
  /** Terrain type based on relationship quality */
  terrain: NWTerritoryTerrain
  /** Structure archetype */
  structure: NWTerritoryStructure
  /** Weather sentiment */
  weather: NWTerritoryWeather
  /** Contact frequency 0–1 (drives path opacity) */
  contactFrequency: number
  /** Array of project IDs for this client */
  projectIds: string[]
  /** Project types associated with this client */
  projectTypes: string[]
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
  /** NW13: derived client territory records */
  clientTerritories: NWClientTerritory[]
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
  clientTerritories: [],
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
        .select('id, name, status, contract_value, health_score, org_id, material_cost, phase_completion, created_at, type, client_id')
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
      type: p.type ?? null,
      client_id: p.client_id ?? null,
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

    // ── NW13: Compute client territories ─────────────────────────────────────

    const clientTerritories = _buildClientTerritories(projects, invoices, rfis)

    _currentData = {
      projects,
      invoices,
      fieldLogs,
      rfis,
      solarIncome,
      crewMembers,
      hubEvents,
      accountingSignals,
      clientTerritories,
      lastFetched: Date.now(),
    }

    _notify()
  } catch (err) {
    console.warn('[DataBridge] fetch error (non-blocking):', err)
  } finally {
    _fetchInProgress = false
  }
}

// ── NW13: Client territory builder ────────────────────────────────────────────

/** Deterministic seeded position for a client territory on west continent.
 *  Uses a distinct zone (x=-170 to -30) to coexist with project mountains. */
function _clientTerritoryPosition(key: string): { x: number; z: number } {
  let h1 = 0xbeefdead
  let h2 = 0x57ce6c14
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2246822507)
    h2 = Math.imul(h2 ^ c, 3266489909)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2654435761) ^ Math.imul(h2 ^ (h2 >>> 13), 1597334677)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2654435761) ^ Math.imul(h1 ^ (h1 >>> 13), 1597334677)
  const n1 = (h1 >>> 0) / 0xffffffff
  const n2 = (h2 >>> 0) / 0xffffffff
  // West continent customer zone — spread across full width, z spread wide
  const x = -30 - n1 * 145  // -30 to -175
  const z = (n2 - 0.5) * 340  // -170 to 170
  return { x, z }
}

/** Derive territory radius from lifetime value (world units). */
function _territoryRadius(lifetimeValue: number): number {
  if (lifetimeValue <= 0) return 3
  if (lifetimeValue >= 100000) return 18
  if (lifetimeValue >= 50000)  return 14 + (lifetimeValue - 50000) / 50000 * 4
  if (lifetimeValue >= 10000)  return 8  + (lifetimeValue - 10000) / 40000 * 6
  if (lifetimeValue >= 1000)   return 4  + (lifetimeValue - 1000)  / 9000  * 4
  return 3 + lifetimeValue / 1000
}

/** Build client territory records from raw data. */
function _buildClientTerritories(
  projects: NWProject[],
  invoices: NWInvoice[],
  rfis: NWRFI[],
): NWClientTerritory[] {
  const now = Date.now()
  const MS_12_MONTHS = 365 * 24 * 60 * 60 * 1000

  // Group projects by client_id (may be null) or project name as fallback
  const clientMap = new Map<string, {
    name: string
    projects: NWProject[]
    clientType: NWClientTerritory['clientType']
  }>()

  for (const p of projects) {
    // Derive a client key: use client_id if present, else slugify project name
    // Since NWProject doesn't carry client_id, we group by first word of name
    // (best-effort without a clients join — the real join happens via client_id in Supabase)
    const clientKey = _deriveClientKey(p)
    const existing  = clientMap.get(clientKey)
    if (existing) {
      existing.projects.push(p)
    } else {
      clientMap.set(clientKey, {
        name: _deriveClientName(p),
        projects: [p],
        clientType: _deriveClientType(p),
      })
    }
  }

  // Build territory per client
  const territories: NWClientTerritory[] = []

  for (const [clientKey, data] of clientMap) {
    const { name, projects: cProjects, clientType } = data

    // Financial aggregates
    const lifetimeValue  = cProjects.reduce((s, p) => s + p.contract_value, 0)
    const totalBilled    = cProjects.reduce((s, p) => s + (p as any).billed_amount || 0, 0)
    const totalPaid      = invoices
      .filter(inv => cProjects.some(p => p.id === inv.project_id) && inv.status === 'paid')
      .reduce((s, inv) => s + inv.amount, 0)
    const totalInvoiced  = invoices
      .filter(inv => cProjects.some(p => p.id === inv.project_id))
      .reduce((s, inv) => s + inv.amount, 0)
    const paidRatio = totalInvoiced > 0 ? Math.min(1, totalPaid / totalInvoiced) : 0.5

    // Activity
    const activeProjectCount = cProjects.filter(p =>
      p.status === 'in_progress' || p.status === 'approved' || p.status === 'pending'
    ).length

    // Last contact: most recent created_at across this client's projects
    let lastContactAt: string | null = null
    let lastContactMs = 0
    for (const p of cProjects) {
      if (p.created_at) {
        const t = new Date(p.created_at).getTime()
        if (t > lastContactMs) {
          lastContactMs = t
          lastContactAt = p.created_at
        }
      }
    }
    const daysSinceContact = lastContactAt
      ? Math.floor((now - lastContactMs) / (24 * 60 * 60 * 1000))
      : 999

    // RFI count for this client's projects
    const projectIds    = cProjects.map(p => p.id)
    const openRfiCount  = rfis.filter(r =>
      r.project_id && projectIds.includes(r.project_id) && r.status === 'open'
    ).length

    // Contact frequency: inverse of daysSinceContact, clamped 0–1
    const contactFrequency = daysSinceContact < 7   ? 1.0
                           : daysSinceContact < 30  ? 0.7
                           : daysSinceContact < 90  ? 0.4
                           : daysSinceContact < 180 ? 0.2
                           : 0.05

    // Terrain archetype
    let terrain: NWTerritoryTerrain
    if (daysSinceContact > 365) {
      terrain = 'flat_barren'      // dormant 12+ months
    } else if (paidRatio < 0.6 || openRfiCount >= 3) {
      terrain = 'rocky_unstable'   // difficult payment / lots of open RFIs
    } else {
      terrain = 'green_rolling'    // loyal long-term
    }

    // Structure archetype
    let structure: NWTerritoryStructure
    if (cProjects.length === 0 || cProjects.every(p => p.status === 'lead')) {
      structure = 'prospect'
    } else if (cProjects.every(p => p.name.toLowerCase().includes('solar') || p.name.toLowerCase().includes('pv'))) {
      structure = 'solar'
    } else if (clientType === 'commercial' || clientType === 'industrial') {
      structure = 'commercial'
    } else if (cProjects.every(p => p.status === 'completed' || p.status === 'cancelled') &&
               !cProjects.some(p =>
                 p.contract_value > 5000 ||
                 p.name.toLowerCase().includes('remodel') ||
                 p.name.toLowerCase().includes('new')
               )) {
      structure = 'service_only'
    } else {
      structure = 'residential'
    }

    // Weather sentiment
    let weather: NWTerritoryWeather
    if (openRfiCount >= 3 || paidRatio < 0.5) {
      weather = 'storm'
    } else if (openRfiCount >= 1 || paidRatio < 0.75) {
      weather = 'overcast'
    } else {
      weather = 'clear'
    }

    const { x: worldX, z: worldZ } = _clientTerritoryPosition(clientKey)
    const territoryRadius           = _territoryRadius(lifetimeValue)
    const projectTypes              = [...new Set(cProjects.map(p => p.status))]

    territories.push({
      clientKey,
      clientName: name,
      clientType,
      lifetimeValue,
      projectCount: cProjects.length,
      activeProjectCount,
      lastContactAt,
      daysSinceContact,
      openRfiCount,
      paidRatio,
      worldX,
      worldZ,
      territoryRadius,
      terrain,
      structure,
      weather,
      contactFrequency,
      projectIds,
      projectTypes,
    })
  }

  // Sort by lifetimeValue descending (largest territory first for z-ordering)
  territories.sort((a, b) => b.lifetimeValue - a.lifetimeValue)

  return territories
}

/** Derive a stable client key from a project record. */
function _deriveClientKey(p: NWProject): string {
  // Prefer client_id for grouping; fall back to first 2 words of project name
  if (p.client_id) return `client_${p.client_id}`
  const words = p.name.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0] + ' ' + words[1]).toLowerCase().replace(/[^a-z0-9 ]/g, '')
  }
  return words[0].toLowerCase().replace(/[^a-z0-9]/g, '') || p.id
}

/** Derive a display name for the client from the project record. */
function _deriveClientName(p: NWProject): string {
  const words = p.name.trim().split(/\s+/)
  return words.slice(0, 2).join(' ')
}

/** Derive client type from project type field. */
function _deriveClientType(p: NWProject): NWClientTerritory['clientType'] {
  const t = p.type ?? ''
  if (t.includes('commercial') || t.includes('industrial')) return 'commercial'
  if (t.includes('solar') || t.includes('pv'))              return 'solar'
  if (t.includes('service'))                                 return 'service'
  if (p.status === 'lead')                                   return 'prospect'
  return 'residential'
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

/**
 * Trigger an immediate data refresh outside the normal 60-second loop.
 * Safe to call at any time — ignored if a fetch is already in progress.
 * Called by SonarPulseLayer (NW64) on each sonar scan to ensure fresh data
 * arrives as the ring expands across the world.
 */
export function triggerDataBridgeRefresh(): void {
  _fetchAll()
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
