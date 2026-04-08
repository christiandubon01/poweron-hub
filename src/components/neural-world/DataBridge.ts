/**
 * DataBridge.ts — Supabase data layer for Neural World.
 *
 * Fetches project, invoice, and field_log data from Supabase on world load.
 * Refreshes every 60 seconds.
 * Exposes typed data to all world components via a simple observer pattern.
 *
 * NW2 scope: projects, invoices, field_logs
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
}

export interface NWInvoice {
  id: string
  project_id: string | null
  amount: number
  status: string
  due_date: string | null
  org_id: string
}

export interface NWFieldLog {
  id: string
  project_id: string | null
  hours: number
  org_id: string
}

export interface NWWorldData {
  projects: NWProject[]
  invoices: NWInvoice[]
  fieldLogs: NWFieldLog[]
  lastFetched: number
}

// ── Observer pattern ──────────────────────────────────────────────────────────

type DataListener = (data: NWWorldData) => void

let _currentData: NWWorldData = {
  projects: [],
  invoices: [],
  fieldLogs: [],
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
    const [projectsResult, invoicesResult, fieldLogsResult] = await Promise.all([
      (supabase as any)
        .from('projects')
        .select('id, name, status, contract_value, org_id')
        .order('created_at', { ascending: false }),

      (supabase as any)
        .from('invoices')
        .select('id, project_id, amount, status, due_date, org_id')
        .order('created_at', { ascending: false }),

      (supabase as any)
        .from('field_logs')
        .select('id, project_id, hours, org_id')
        .order('log_date', { ascending: false }),
    ])

    const rawProjects: any[] = projectsResult.data ?? []
    const rawInvoices: any[] = invoicesResult.data ?? []
    const rawFieldLogs: any[] = fieldLogsResult.data ?? []

    const projects: NWProject[] = rawProjects.map((p: any) => ({
      id: p.id ?? '',
      name: p.name ?? 'Unnamed',
      status: p.status ?? 'pending',
      contract_value: typeof p.contract_value === 'number' ? p.contract_value : 0,
      health_score: typeof p.health_score === 'number' ? p.health_score : 100,
      org_id: p.org_id ?? '',
    }))

    const invoices: NWInvoice[] = rawInvoices.map((inv: any) => ({
      id: inv.id ?? '',
      project_id: inv.project_id ?? null,
      amount: typeof inv.amount === 'number' ? inv.amount : 0,
      status: inv.status ?? 'draft',
      due_date: inv.due_date ?? null,
      org_id: inv.org_id ?? '',
    }))

    const fieldLogs: NWFieldLog[] = rawFieldLogs.map((fl: any) => ({
      id: fl.id ?? '',
      project_id: fl.project_id ?? null,
      hours: typeof fl.hours === 'number' ? fl.hours : 0,
      org_id: fl.org_id ?? '',
    }))

    _currentData = {
      projects,
      invoices,
      fieldLogs,
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
 * Spreads mountains across a 160×160 area centered at origin.
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
  // Map to -80..80 range, keeping a 20-unit border from grid edges
  const x = (n1 - 0.5) * 160
  const z = (n2 - 0.5) * 160
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
