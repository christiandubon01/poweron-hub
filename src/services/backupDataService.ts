// @ts-nocheck
/**
 * backupDataService.ts — Full v15r backup data layer
 *
 * Captures ALL keys from the PowerOn v15r backup JSON.
 * localStorage persistence under 'poweron_backup_data'.
 *
 * ── Multi-device Sync Flow ──────────────────────────────────────────────
 * 1. On mount: loadFromSupabase() fetches remote state from `app_state` table (key: poweron_v2)
 * 2. Richness guard: remote only overwrites local if it has MORE data
 *    (checks serviceLogs.length, projects.length, logs.length)
 * 3. On every save: saveBackupDataAndSync() writes localStorage + fire-and-forget upsert to Supabase
 * 4. Periodic sync: V15rLayout runs syncToSupabase() every 60s
 * 5. Build: `npm run build` on Netlify with NODE_VERSION=20 (set in netlify.toml)
 * 6. SPA routing: public/_redirects `/* /index.html 200` + netlify.toml [[redirects]]
 * 7. CSP: connect-src allows *.supabase.co, api.anthropic.com, *.upstash.io
 *
 * ── PowerShell rebuild command ──────────────────────────────────────────
 * cd "path\to\Power On Solutions APP - CoWork" && npm run build
 * Then push to git → Netlify auto-deploys from the connected branch.
 */

const STORAGE_KEY = 'poweron_backup_data'

// ── Device ID System ─────────────────────────────────────────────────────────
const DEVICE_ID_KEY = 'poweron_device_id'

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (id) return id
    // Auto-detect device name from user agent
    const ua = navigator.userAgent || ''
    let label = 'Unknown'
    if (/iPhone/.test(ua)) label = 'iPhone'
    else if (/iPad/.test(ua)) label = 'iPad'
    else if (/Android/.test(ua)) label = 'Android'
    else if (/Windows/.test(ua)) label = 'Windows'
    else if (/Mac/.test(ua)) label = 'Mac'
    else if (/Linux/.test(ua)) label = 'Linux'
    id = `${label}_${Date.now().toString(36)}`
    localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    return 'unknown'
  }
}

/** Last sync metadata from Supabase (set during loadFromSupabase) */
let _lastSyncMeta: { savedBy: string; savedAt: string } | null = null
export function getLastSyncMeta(): { savedBy: string; savedAt: string } | null {
  return _lastSyncMeta
}

// ── Sync infrastructure ──────────────────────────────────────────────────────

let _saveDebounceTimer: any = null
let _dataChanged = false
let _lastSyncedAt = 0
const SYNC_INTERVAL_MS = 13_000 // 13 seconds
const SAVE_DEBOUNCE_MS = 100

/** Track which top-level keys changed since last sync */
const _changedKeys = new Set<string>()

/** Per-key last modified timestamps (stored in localStorage) */
const PER_KEY_TS_KEY = 'poweron_key_timestamps'

function getKeyTimestamps(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PER_KEY_TS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function setKeyTimestamp(key: string) {
  try {
    const ts = getKeyTimestamps()
    ts[key] = Date.now()
    localStorage.setItem(PER_KEY_TS_KEY, JSON.stringify(ts))
  } catch { /* ignore */ }
}

/** Mark a data key as changed (called before saving) */
export function markChanged(...keys: string[]) {
  keys.forEach(k => {
    _changedKeys.add(k)
    setKeyTimestamp(k)
  })
  _dataChanged = true
}

/** Start periodic sync timer — call from V15rLayout on mount */
export function startPeriodicSync(): () => void {
  if (typeof window === 'undefined') return () => {}
  const id = setInterval(() => {
    if (_dataChanged && Date.now() - _lastSyncedAt >= SYNC_INTERVAL_MS) {
      _dataChanged = false
      _lastSyncedAt = Date.now()
      _changedKeys.clear()
      syncToSupabase().catch(err => console.warn('[sync] Periodic sync failed:', err))
    }
  }, SYNC_INTERVAL_MS)
  return () => clearInterval(id)
}

/** Debounced save — waits 100ms before writing to prevent rapid overwrites during typing */
export function debouncedSave(data: BackupData, changedKey?: string) {
  if (changedKey) markChanged(changedKey)
  if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer)
  _saveDebounceTimer = setTimeout(() => {
    data._lastSavedAt = new Date().toISOString()
    saveBackupData(data)
  }, SAVE_DEBOUNCE_MS)
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface BackupLog {
  id: string; emp: string; hrs: number; mat: number; date: string; empId: string
  miles: number; notes: string; phase: string; store: string; profit: number
  projId: string; quoted: number; projName: string; collected: number
  detailLink: string; projectQuote: number; emergencyMatInfo: string
}

export interface BackupProjectPhases { [phaseName: string]: number }

export interface BackupEstimateRef {
  tax: number; labor: number; total: number; profit: number; mileage: number
  overhead: number; subtotal: number; marginPct: number; materials: number
  directCost: number; operatingCost: number
  materialPhases: Array<{ raw: number; tax: number; count: number; phase: string; total: number }>
}

export interface BackupProject {
  id: string; name: string; type: string; status: string; contract: number
  billed: number; paid: number; mileRT: number; miDays?: number
  phases: BackupProjectPhases; logs: any[]; finance?: any; laborHrs?: number
  rfis?: any[]; coord?: any; tasks?: Record<string, string[]>
  ohRows?: any[]; matRows?: any[]; mtoRows?: any[]; laborRows?: any[]
  templateId?: string; projectCode?: string; templateName?: string
  lastMove?: string; lastCollectedAt?: string; lastCollectedAmount?: number
  estimateReference?: BackupEstimateRef; phaseEstimateRows?: any[]
  lastEstimateSyncAt?: string; completionPromptSig?: string; completionDeclinedSig?: string
  plannedStart?: string; plannedEnd?: string
}

export interface BackupPriceBookItem {
  id: string; cat: string; src: string; cost: number; link: string
  name: string; pack: number; unit: string; waste: number; legacyId: string
  notes?: string; pidBlock?: string; pidBand?: string
}

export interface BackupWeeklyData {
  wk: number; svc: number; proj: number; accum: number; start: string
  _empty: boolean; unbilled: number; pendingInv: number; totalExposure: number
}

export interface BackupServiceLog {
  id: string; hrs: number; mat: number; date: string; jtype: string
  miles: number; notes: string; store: string; opCost: number; profit: number
  quoted: number; address?: string; customer: string; mileCost?: number
  collected: number; payStatus: string; balanceDue: number; detailLink?: string
  adjustments?: any[]; triggersAtSave?: string[]; compareWarnings?: string[]
  emergencyMatInfo?: string; estimateComparison?: any
}

export interface BackupTriggerRule {
  id: string; name: string; type: string; color: string; active: boolean
  condition: string; threshold: string; thresholdLabel: string
  situation: string; review: string; solution: string; reflection: string
}

export interface BackupEmployee {
  id: string; name: string; role: string; billRate: number; costRate: number
}

export interface BackupTemplate {
  id: string; name: string; type?: string
  tasks: Record<string, string[]>
  riskNotes?: string[]; travelDefault?: number; laborDefault?: number
  activatedPhases?: string[]
}

export interface BackupGCContact {
  id: string; avg: number; due: string; fit: number; pay: string; role: string
  sent: number; email: string; intro: string; notes: string; phase: string
  phone: string; action: string; awarded: number; company: string; contact: string
  created: string
}

export interface BackupOverhead {
  essential: Array<{ id: string; name: string; monthly: number }>
  extra: Array<{ id: string; name: string; monthly: number }>
  loans: Array<{ id: string; name: string; monthly: number }>
  vehicle: Array<{ id: string; name: string; monthly: number }>
}

export interface BackupSettings {
  tax: number; markup: number; opCost: number; amBlock: number
  company: string; gcalUrl: string; license: string; pmBlock: number
  billRate: number; mileRate: number; overhead: BackupOverhead
  dayTarget: number; mtoPhases: string[]; phaseWeights: Record<string, number>
  salaryTarget: number; wasteDefault: number; defaultOHRate: number
  billableHrsYear: number; defaultTemplateId: string; annualTarget: number
  theme?: 'dark' | 'light'; logoDark?: string; logoLight?: string
  personalIncomeGoal?: number; overheadPct?: number
  employeeCosts?: Array<{id: string, label: string, amount: number}>
  payrollMult?: number
}

export interface BackupAgendaSection {
  id: string; title: string; projectId: string
  tasks: Array<{ id: string; text: string; status: string }>
}

export interface BackupCustomAlert {
  id: string; title: string; description: string; action: string; isAI: boolean; manuallyEdited?: boolean
}

export interface FieldObservationCard {
  id: string
  project_id: string
  project_name?: string
  zone?: string
  source?: string
  original_sequence?: string
  observed_condition?: string
  blocking_dependency?: string
  revised_sequence?: string
  urgency?: string
  affects?: string[]
  ai_summary?: string
  next_action?: string
  next_action_due?: string
  status?: string
  photo_ids?: string[]
  transcript?: string
  created_at?: string
  updated_at?: string
  /** Quick Capture routing metadata */
  routing?: 'ai' | 'manual' | 'direct'
  ai_confidence?: 'high' | 'medium' | 'low' | null
  ai_reasoning?: string | null
}

export interface BackupData {
  logs: BackupLog[]
  projects: BackupProject[]
  priceBook: Record<string, BackupPriceBookItem>
  weeklyData: BackupWeeklyData[]
  serviceLogs: BackupServiceLog[]
  triggerRules: BackupTriggerRule[]
  calcRefs: Record<string, any>
  customers: any[]
  settings: BackupSettings
  employees: BackupEmployee[]
  templates: BackupTemplate[]
  gcContacts: BackupGCContact[]
  serviceLeads: any[]
  agendaSections: BackupAgendaSection[]
  customAlerts?: BackupCustomAlert[]
  fieldObservationCards?: FieldObservationCard[]
  completedArchive: any[]
  projectDashboards: Record<string, any>
  blueprintSummaries: Record<string, any>
  activeServiceCalls: any[]
  serviceEstimates: any[]
  taskSchedule: any[]
  dailyJobs: any[]
  weeklyReviews: any[]
  imports: any[]
  gcalUrl?: string
  _lastSavedAt: string
  _schemaVersion: number
  /** Cross-device sync metadata — embedded by syncToSupabase() */
  _syncMeta?: { savedBy: string; savedAt: string }
}

// ── Supabase check ───────────────────────────────────────────────────────────

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return !!(url && key && url !== '' && key !== '' && url.startsWith('http'))
}

// ── LocalStorage CRUD ────────────────────────────────────────────────────────

export function hasBackupData(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) !== null } catch { return false }
}

export function getBackupData(): BackupData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const data = JSON.parse(raw) as BackupData
      // ISSUE 4: Price book dual-storage reconciliation
      // Step 1: If local priceBook empty, hydrate from poweron_v2
      const localPBArr = Array.isArray(data.priceBook) ? data.priceBook : (data.priceBook ? Object.values(data.priceBook) : [])
      try {
        const v2Raw = localStorage.getItem('poweron_v2')
        if (v2Raw) {
          const v2Data = JSON.parse(v2Raw)
          const v2PB = Array.isArray(v2Data?.priceBook) ? v2Data.priceBook : (v2Data?.priceBook ? Object.values(v2Data.priceBook) : [])
          if (localPBArr.length === 0 && v2PB.length > 0) {
            // Hydrate from poweron_v2
            console.log('[backupDataService] Hydrated priceBook from poweron_v2 key —', v2PB.length, 'items')
            data.priceBook = v2Data.priceBook
          } else if (localPBArr.length > v2PB.length && v2PB.length >= 0) {
            // Step 2: One-time migration — local has MORE items, merge into poweron_v2
            const v2Ids = new Set(v2PB.map((i: any) => i.id).filter(Boolean))
            const diff = localPBArr.filter((i: any) => i.id && !v2Ids.has(i.id))
            if (diff.length > 0) {
              const merged = [...v2PB, ...diff]
              v2Data.priceBook = merged
              localStorage.setItem('poweron_v2', JSON.stringify(v2Data))
              console.log('[backupDataService] One-time migration: merged', diff.length, 'extra items into poweron_v2')
            }
          }
        }
      } catch { /* ignore poweron_v2 parse errors */ }
      return data
    }
    // If no data under STORAGE_KEY, try poweron_v2 as fallback
    const v2Raw = localStorage.getItem('poweron_v2')
    if (v2Raw) {
      console.log('[backupDataService] No data in', STORAGE_KEY, '— loading from poweron_v2')
      return JSON.parse(v2Raw) as BackupData
    }
    return null
  } catch (err) {
    console.error('[backupDataService] Failed to parse backup data:', err)
    return null
  }
}

export function saveBackupData(data: BackupData): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) }
  catch (err) { console.error('[backupDataService] Failed to save:', err) }
  // Notify same-tab listeners (e.g. V15rLayout KPI bar) that data has changed.
  // window.storage only fires for cross-tab writes, so we dispatch a custom event here.
  try { window.dispatchEvent(new CustomEvent('poweron-data-saved')) } catch { /* ignore */ }
  // ISSUE 4: Keep poweron_v2 price book in sync to prevent dual-storage divergence
  try {
    const v2Raw = localStorage.getItem('poweron_v2')
    if (v2Raw && data.priceBook) {
      const v2Data = JSON.parse(v2Raw)
      const pbArr = Array.isArray(data.priceBook) ? data.priceBook : Object.values(data.priceBook)
      if (pbArr.length > 0) {
        v2Data.priceBook = pbArr
        v2Data._lastSavedAt = data._lastSavedAt
        localStorage.setItem('poweron_v2', JSON.stringify(v2Data))
      }
    }
  } catch { /* ignore poweron_v2 sync errors */ }
}

/**
 * Write data to localStorage silently.
 * No poweron-data-saved dispatch. Does not set _dataChanged.
 * Use ONLY for internal sync operations (embedding metadata, saving remote pulls)
 * to prevent re-triggering the sync loop.
 */
function saveBackupDataSilent(data: BackupData): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
}

export function clearBackupData(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

// ── Import merge summary type ────────────────────────────────────────────────

export interface ImportMergeSummary {
  merged: Record<string, number>
  total: number
}

// ── Import helper ─────────────────────────────────────────────────────────────

function createEmptyBackup(): BackupData {
  return {
    logs: [], projects: [], priceBook: {}, weeklyData: [], serviceLogs: [],
    triggerRules: [], calcRefs: {}, customers: [], settings: {} as any,
    employees: [], templates: [], gcContacts: [], serviceLeads: [],
    agendaSections: [], customAlerts: [], completedArchive: [], projectDashboards: {},
    blueprintSummaries: {}, activeServiceCalls: [], serviceEstimates: [],
    taskSchedule: [], dailyJobs: [], weeklyReviews: [], imports: [],
    _lastSavedAt: new Date().toISOString(), _schemaVersion: 0,
  }
}

// ── Import ───────────────────────────────────────────────────────────────────

export async function importBackupFromFile(file: File): Promise<{ data: BackupData; summary: ImportMergeSummary }> {
  const text = await file.text()
  const raw = JSON.parse(text)
  const existing = getBackupData() || createEmptyBackup()

  // Merge arrays by ID — append new, skip duplicates
  const arrayKeys = ['serviceLogs', 'serviceLeads', 'logs', 'projects', 'gcContacts', 'employees', 'templates', 'triggerRules', 'agendaSections', 'completedArchive', 'activeServiceCalls', 'serviceEstimates', 'taskSchedule', 'dailyJobs', 'weeklyReviews', 'imports', 'customers']

  const summary: ImportMergeSummary = { merged: {}, total: 0 }

  for (const key of arrayKeys) {
    const incoming = raw[key]
    if (!Array.isArray(incoming) || incoming.length === 0) continue
    if (!Array.isArray(existing[key])) existing[key] = []

    const existingIds = new Set(existing[key].map((item: any) => item.id).filter(Boolean))
    let added = 0
    for (const item of incoming) {
      if (item.id && existingIds.has(item.id)) continue // skip duplicate
      existing[key].push(item)
      added++
    }
    if (added > 0) {
      summary.merged[key] = added
      summary.total += added
    }
  }

  // Merge object keys (settings, calcRefs, projectDashboards, blueprintSummaries) — key-level merge, don't overwrite
  const objectKeys = ['settings', 'calcRefs', 'projectDashboards', 'blueprintSummaries']
  for (const key of objectKeys) {
    if (raw[key] && typeof raw[key] === 'object' && !Array.isArray(raw[key])) {
      if (!existing[key] || typeof existing[key] !== 'object') existing[key] = {}
      // Only add keys that don't exist in current data
      for (const [k, v] of Object.entries(raw[key])) {
        if (!(k in existing[key])) {
          existing[key][k] = v
        }
      }
    }
  }

  // Special handling for priceBook — accepts both array and Record formats from HTML app
  if (raw.priceBook) {
    const incomingItems: BackupPriceBookItem[] = Array.isArray(raw.priceBook)
      ? raw.priceBook
      : Object.values(raw.priceBook)
    if (incomingItems.length > 0) {
      // Normalize existing to Record if it's an array
      if (Array.isArray(existing.priceBook)) {
        const asRecord: Record<string, any> = {}
        for (const item of existing.priceBook as any[]) {
          if (item.id) asRecord[item.id] = item
        }
        existing.priceBook = asRecord
      }
      if (!existing.priceBook || typeof existing.priceBook !== 'object') existing.priceBook = {}
      const existingIds = new Set(Object.keys(existing.priceBook))
      let added = 0
      for (const item of incomingItems) {
        if (item.id && !existingIds.has(item.id)) {
          existing.priceBook[item.id] = item
          added++
        }
      }
      if (added > 0) {
        summary.merged['priceBook'] = added
        summary.total += added
      }
    }
  }

  // Merge weeklyData by 'wk' key instead of id
  if (Array.isArray(raw.weeklyData) && raw.weeklyData.length > 0) {
    if (!Array.isArray(existing.weeklyData)) existing.weeklyData = []
    const existingWks = new Set(existing.weeklyData.map((w: any) => w.wk))
    let added = 0
    for (const w of raw.weeklyData) {
      if (w.wk && existingWks.has(w.wk)) continue
      existing.weeklyData.push(w)
      added++
    }
    if (added > 0) {
      summary.merged['weeklyData'] = added
      summary.total += added
    }
    // Sort weeklyData by week number
    existing.weeklyData.sort((a: any, b: any) => (a.wk || 0) - (b.wk || 0))
  }

  // Keep gcalUrl if incoming has one and existing doesn't
  if (raw.gcalUrl && !existing.gcalUrl) existing.gcalUrl = raw.gcalUrl

  existing._lastSavedAt = new Date().toISOString()
  saveBackupData(existing)

  console.log(`[backupDataService] Merged import: ${JSON.stringify(summary.merged)}`)
  return { data: existing, summary }
}

// ── Utility helpers (ported from HTML v15r) ──────────────────────────────────

/** Safe number parser */
export function num(v: any): number {
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

/** Days since a date string, 999 if missing */
export function daysSince(d: string | undefined | null): number {
  if (!d) return 999
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

/** Dollar format: $1,234.56 */
export function fmt(v: number | undefined | null): string {
  return '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Compact dollar format: $1.2k / $1.2M */
export function fmtK(v: number | undefined | null): string {
  const n = num(v || 0)
  const abs = Math.abs(n)
  if (abs >= 1000000) {
    const s = (n / 1000000).toFixed(abs >= 10000000 ? 0 : 1).replace(/\.0$/, '')
    return '$' + s + 'M'
  }
  if (abs >= 1000) {
    const s = (n / 1000).toFixed(abs >= 100000 ? 0 : 1).replace(/\.0$/, '')
    return '$' + s + 'k'
  }
  return '$' + Math.round(n)
}

/** Percentage format */
export function pct(v: number): string {
  return v + '%'
}

/** Phase weights from settings or defaults */
export function getPhaseWeights(d: BackupData): Record<string, number> {
  const defaults: Record<string, number> = {
    Estimating: 5, Planning: 10, 'Site Prep': 15, 'Rough-in': 35, Finish: 25, Trim: 10,
  }
  return (d.settings && d.settings.phaseWeights) || defaults
}

/** Overall completion — weighted phase average (matches HTML ov(p)) */
export function getOverallCompletion(p: BackupProject, d: BackupData): number {
  const w = getPhaseWeights(d)
  const tot = Object.values(w).reduce((s, v) => s + v, 0) || 100
  const phases = p.phases || {}
  return Object.entries(w).reduce((s, [ph, wt]) => s + (num(phases[ph]) * wt / tot), 0)
}

/** Get logs for a specific project */
export function projectLogsFor(d: BackupData, projId: string): BackupLog[] {
  return (d.logs || []).filter(l => l.projId === projId)
}

/** Ensure a project has a finance bucket */
function ensureProjectFinanceBucket(p: BackupProject): any {
  if (!p.finance) p.finance = {}
  return p.finance
}

/** Get project financials — exact port from HTML getProjectFinancials(p) */
export function getProjectFinancials(p: BackupProject, d: BackupData): {
  contract: number; billed: number; paid: number; loggedPaid: number
  manualPaidAdjustment: number; ar: number; unbilled: number; risk: number
  matCost: number; lastCollectedAt: string; lastCollectedAmount: number
} {
  if (!p) return { contract: 0, billed: 0, paid: 0, loggedPaid: 0, manualPaidAdjustment: 0, ar: 0, unbilled: 0, risk: 0, matCost: 0, lastCollectedAt: '', lastCollectedAmount: 0 }
  const fin = ensureProjectFinanceBucket(p)
  const contract = num(fin.contractOverride != null ? fin.contractOverride : p.contract)
  const billed = num(fin.billedOverride != null ? fin.billedOverride : p.billed)
  const logs = projectLogsFor(d, p.id)
  const loggedPaid = logs.reduce((s, l) => s + num(l.collected), 0)
  const manualPaidAdjustment = num(fin.manualPaidAdjustment || 0)
  const paid = Math.max(0, loggedPaid + manualPaidAdjustment)
  const ar = Math.max(0, billed - paid)
  const unbilled = Math.max(0, contract - billed)
  const risk = Math.max(0, contract - paid)
  const estMat = Array.isArray(p.matRows) ? p.matRows.reduce((s: number, r: any) => s + (num(r.cost) * num(r.qty || 1)), 0) : 0
  const matCost = fin.matCostOverride != null ? num(fin.matCostOverride) : estMat
  const paidLogs = logs.filter(l => num(l.collected) > 0).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const lastCollectedAt = fin.lastCollectedAt || (paidLogs[0] ? paidLogs[0].date : '') || p.lastCollectedAt || ''
  const lastCollectedAmount = paidLogs[0] ? num(paidLogs[0].collected) : num(p.lastCollectedAmount || 0)
  return { contract, billed, paid, loggedPaid, manualPaidAdjustment, ar, unbilled, risk, matCost, lastCollectedAt, lastCollectedAmount }
}

/** Health scoring — exact port from HTML health(p): score 0-100 */
export function health(p: BackupProject, d: BackupData): {
  sc: number; reasons: string[]; cls: string; clr: string
} {
  const o = getOverallCompletion(p, d)
  const ds = daysSince(p.lastMove)
  const openR = (p.rfis || []).filter((r: any) => r.status !== 'answered').length
  let sc = 50 + o * 0.28 + (ds < 7 ? 15 : ds < 14 ? 5 : -20) - openR * 5
    + ((p.logs || []).length ? 10 : 0)
    + (num(p.paid) / Math.max(num(p.contract), 1)) * 8

  // Schedule variance component (only applies if plannedEnd is set)
  const reasons: string[] = []
  if (p.plannedEnd) {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const endDate = new Date(p.plannedEnd + 'T00:00:00')
      if (!isNaN(endDate.getTime())) {
        const daysLate = Math.round((today.getTime() - endDate.getTime()) / 86400000)
        if (daysLate > 0 && p.status !== 'completed') {
          // Behind schedule
          if (daysLate >= 15) { sc -= 20; reasons.push(daysLate + 'd past planned end') }
          else if (daysLate >= 8) { sc -= 10; reasons.push(daysLate + 'd past planned end') }
          else { sc -= 5; reasons.push(daysLate + 'd past planned end') }
        }
        // Ahead of schedule → no penalty, no reason added
      }
    } catch { /* ignore date parse errors */ }
  }

  sc = Math.max(0, Math.min(100, Math.round(sc)))
  if (openR > 0) reasons.push(openR + ' RFI' + (openR > 1 ? 's' : '') + ' open')
  if (ds >= 14) reasons.push(ds + 'd no movement')
  if (!(p.logs || []).length) reasons.push('no logs yet')
  if (o >= 50) reasons.push(pct(Math.round(o)) + ' complete')
  const cls = sc >= 70 ? 'hg' : sc >= 50 ? 'hy' : 'hr'
  const clr = sc >= 70 ? '#10b981' : sc >= 50 ? '#f59e0b' : '#ef4444'
  return { sc, reasons, cls, clr }
}

/** Stale class helper */
export function staleCls(days: number): string {
  if (days >= 14) return 'cr'
  if (days >= 7) return 'cy'
  return 'cg'
}

/** Resolve project bucket: active/coming/completed */
export function resolveProjectBucket(p: BackupProject): 'active' | 'coming' | 'completed' {
  const status = (p.status || '').toLowerCase().trim()
  if (status === 'completed') return 'completed'
  if (status === 'coming') return 'coming'
  return 'active'
}

/** Ensure agenda sections are properly shaped */
export function ensureAgendaState(d: BackupData): void {
  if (!Array.isArray(d.agendaSections)) {
    d.agendaSections = [{ id: 'ag1', title: 'Today', projectId: '', tasks: [] }]
  }
  d.agendaSections = d.agendaSections.map((s: any, i: number) => ({
    id: s.id || ('ag' + Date.now() + i),
    title: String(s.title || 'Category'),
    projectId: String(s.projectId || ''),
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
  }))
  d.agendaSections.forEach((sec: any, si: number) => {
    sec.tasks = (sec.tasks || []).map((t: any, ti: number) => ({
      id: t.id || ('agt' + Date.now() + si + ti),
      text: String(t.text || ''),
      status: String(t.status || 'pending'),
    }))
  })
}

/** Get agenda project name helper */
export function getAgendaProjectName(d: BackupData, projectId: string): string {
  if (!projectId) return 'General'
  const p = (d.projects || []).find(x => x.id === projectId)
  return p ? p.name : 'General'
}

/** Build cumulative log rollup for a project.
 *  Sorted oldest-to-newest so cumulative fields accumulate correctly.
 *  Spec:
 *    Labor cost = hours × billing rate (settings.billRate, default $95/hr)
 *    Material cost = mat as entered
 *    Mileage cost = miles × mileRate (settings.mileRate, default $0.67/mi)
 *    Running balance = contract − cumulative collected − cumulative total cost
 */
export function buildProjectLogRollup(d: BackupData, projId: string): {
  quote: number; logs: BackupLog[]; byId: Record<string, any>
} {
  const p = (d.projects || []).find(x => x.id === projId)
  const quote = num(p && p.contract)
  const logs = projectLogsFor(d, projId).slice().sort((a, b) => {
    const da = String(a.date || ''), db = String(b.date || '')
    if (da !== db) return da.localeCompare(db)
    return String(a.id || '').localeCompare(String(b.id || ''))
  })
  // Spec: billing rate for labor (not opCost/overhead rate)
  const billRate = num((d.settings && d.settings.billRate) || 95)
  const mileRate = num((d.settings && d.settings.mileRate) || 0.67)
  let cumHours = 0, cumMiles = 0
  let cumLaborCost = 0, cumMaterialCost = 0, cumMileageCost = 0, cumCollected = 0
  const byId: Record<string, any> = {}
  logs.forEach(l => {
    cumHours += num(l.hrs)
    cumMiles += num(l.miles)
    cumCollected += num(l.collected)

    // Per-entry cost (spec: Labor=hrs×billRate, Material=mat, Mileage=milesRT×mileRate)
    const entryLaborCost = num(l.hrs) * billRate
    const entryMaterialCost = num(l.mat)
    const entryMileageCost = num(l.miles) * mileRate
    const entryTotalCost = entryLaborCost + entryMaterialCost + entryMileageCost

    // Cumulative totals across all entries up to and including this one
    cumLaborCost += entryLaborCost
    cumMaterialCost += entryMaterialCost
    cumMileageCost += entryMileageCost
    const cumTotalCost = cumLaborCost + cumMaterialCost + cumMileageCost

    // Spec: Running balance = Contract Amount − Collected (cumulative) − Cumulative Total Cost
    const remainingAfter = quote - cumCollected - cumTotalCost

    byId[l.id] = {
      cumHours,
      cumMiles,
      cumCollected,
      cumLaborCost,
      cumMaterialCost,
      cumMileageCost,
      cumTotalCost,
      entryLaborCost,
      entryMaterialCost,
      entryMileageCost,
      entryTotalCost,
      // Legacy field names preserved for any other consumers
      dayCost: entryTotalCost,
      actualCostToDate: cumTotalCost,
      remainingAfter,
    }
  })
  return { quote, logs, byId }
}

/** Sync all project finance buckets */
export function syncAllProjectFinanceBuckets(d: BackupData): void {
  ;(d.projects || []).forEach(p => ensureProjectFinanceBucket(p))
}

// ── KPIs (matches HTML renderHome exactly) ───────────────────────────────────

export function getKPIs(d: BackupData) {
  const projects = d.projects || []
  const logs = d.logs || []
  const serviceLogs = d.serviceLogs || []
  syncAllProjectFinanceBuckets(d)
  // Pipeline = active/coming project contracts + open service calls quoted
  // Excludes: completed+collected projects, deleted projects, lost/rejected estimates
  const projectContract = projects
    .filter(p => {
      const s = (p.status || '').toLowerCase()
      // Exclude explicitly completed, deleted, lost, or rejected projects
      if (s === 'deleted' || s === 'lost' || s === 'rejected') return false
      // Exclude completed bucket (status=completed OR 100% overall completion)
      return resolveProjectBucket(p) === 'active'
    })
    .reduce((s, p) => s + num(p.contract), 0)
  // Service calls total: all calls (open + partial); fully-collected ones still part of pipeline history
  const svcQuoted = serviceLogs.reduce((s, l) => s + num(l.quoted), 0)
  // Paid / Cash Received = project paid + service collected (matches HTML cashReceived)
  const projectPaid = projects.reduce((s, p) => s + getProjectFinancials(p, d).paid, 0)
  const svcCollected = serviceLogs.reduce((s, l) => s + num(l.collected), 0)
  const paid = projectPaid + svcCollected
  const billed = projects.reduce((s, p) => s + num(p.billed), 0)
  // Exposure = active project bucket balance remaining (matches HTML activeProjectExposure)
  const activeProjectMoney = projects
    .filter(p => resolveProjectBucket(p) === 'active')
    .map(p => getProjectFinancials(p, d))
  const exposure = activeProjectMoney.reduce((s, m) => s + Math.max(0, m.contract - m.paid), 0)
  // SVC Unbilled = sum of remaining balance across all service log entriesssS
  // (totalBillable - collected), zeroed for overpaid entries; money math only, never stale payStatus
  const svcUnbilled = serviceLogs.reduce((s, l) => {
    const quoted = num(l.quoted)
    const collected = num(l.collected)
    const adjustments = Array.isArray(l.adjustments) ? l.adjustments : []
    const addIncome = adjustments
      .filter((a: any) => a && a.type === 'income')
      .reduce((ac: number, a: any) => ac + num(a.amount), 0)
    const totalBillable = quoted + addIncome
    return s + Math.max(0, totalBillable - collected)
  }, 0)
  
  const svcWithBalanceDue = serviceLogs.reduce((s, l) => {
    const quoted = num(l.quoted)
    const collected = num(l.collected)
    const adjustments = Array.isArray(l.adjustments) ? l.adjustments : []
    const addIncome = adjustments
      .filter((a: any) => a && a.type === 'income')
      .reduce((ac: number, a: any) => ac + num(a.amount), 0)
    const totalBillable = quoted + addIncome
    return s + (totalBillable - collected > 0 ? totalBillable : 0)
  }, 0)
  const pipeline = projectContract + svcWithBalanceDue
  const openRfis = projects.reduce((s, p) => s + (p.rfis || []).filter((r: any) => r.status !== 'answered').length, 0)
  const totalHours = logs.reduce((s, l) => s + num(l.hrs), 0)
  const activeProjects = projects.filter(p => p.status === 'active' || p.status === 'coming').length
  return { pipeline, paid, billed, exposure, svcUnbilled, openRfis, totalHours, activeProjects }
}
/** Old getProjectHealth kept for backward compat — wraps new health() */
export function getProjectHealth(p: BackupProject, d?: BackupData): { score: number; label: string; color: string } {
  if (!d) {
    // fallback: try to get backup data
    const backup = getBackupData()
    if (backup) d = backup
    else d = { projects: [], logs: [], serviceLogs: [], priceBook: {}, weeklyData: [], triggerRules: [], calcRefs: {}, customers: [], settings: {} as any, employees: [], templates: [], gcContacts: [], serviceLeads: [], agendaSections: [], completedArchive: [], projectDashboards: {}, blueprintSummaries: {}, activeServiceCalls: [], serviceEstimates: [], taskSchedule: [], dailyJobs: [], weeklyReviews: [], _lastSavedAt: '', _schemaVersion: 0 }
  }
  const h = health(p, d)
  const label = h.sc >= 70 ? 'Healthy' : h.sc >= 50 ? 'Watch' : h.sc >= 30 ? 'At Risk' : 'Critical'
  return { score: h.sc, label, color: h.clr }
}

// ── Export backup ────────────────────────────────────────────────────────────

/**
 * Export backup — ISSUE 2 Fix 6: Always reads fresh from getBackupData()
 * at export time, not from a potentially stale reference.
 */
export function exportBackup(d?: BackupData): void {
  // Always read fresh current state, not stale reference
  const freshData = getBackupData() || d
  if (!freshData) {
    console.warn('[export] No data available to export')
    return
  }

  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `PowerOn_Backup_${ts}.json`
  const blob = new Blob([JSON.stringify(freshData, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Supabase Sync ────────────────────────────────────────────────────────────

const SUPABASE_STATE_KEY = 'poweron_v2'

/** Sync current localStorage data to Supabase app_state table.
 *  Includes device ID metadata so we know which device last saved. */
export async function syncToSupabase(): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { success: false, error: 'Supabase not configured' }

  try {
    const { supabase } = await import('@/lib/supabase')
    const data = getBackupData()
    if (!data) return { success: false, error: 'No local data to sync' }

    const now = new Date().toISOString()
    const deviceId = getDeviceId()

    // Embed device metadata + update timestamp
    data._lastSavedAt = now
    data._syncMeta = { savedBy: deviceId, savedAt: now }
    saveBackupDataSilent(data) // persist locally with metadata — silent to avoid re-sync loop

    // Single upsert to Supabase with all metadata embedded
    const { error } = await supabase
      .from('app_state')
      .upsert({
        state_key: SUPABASE_STATE_KEY,
        data: data,
        updated_at: now,
      }, { onConflict: 'state_key' })

    if (error) {
      console.error('[Sync] Supabase write failed:', error.message)
      return { success: false, error: error.message }
    }

    _lastSyncMeta = { savedBy: deviceId, savedAt: now }
    console.log(`[Sync] Synced to Supabase at ${now} by ${deviceId}`)
    return { success: true }
  } catch (err: any) {
    console.error('[Sync] Supabase sync error:', err)
    return { success: false, error: err?.message || 'Unknown error' }
  }
}

/**
 * Load backup from Supabase — TIMESTAMP-ONLY resolution.
 * Remote newer = remote wins. No "richness guard".
 * This ensures cross-device sync always uses the latest save.
 *
 * Returns { merged: true, fromDevice } when remote data was loaded.
 */
export async function loadFromSupabase(forceRemote = false): Promise<{ success: boolean; merged: boolean; fromDevice?: string; error?: string }> {
  if (!isSupabaseConfigured()) return { success: false, merged: false, error: 'Supabase not configured' }

  try {
    const { supabase } = await import('@/lib/supabase')
    const thisDevice = getDeviceId()

    const { data: row, error } = await supabase
      .from('app_state')
      .select('data, updated_at')
      .eq('state_key', SUPABASE_STATE_KEY)
      .single()

    if (error) {
      console.warn('[Sync] Supabase read failed:', error.message)
      return { success: false, merged: false, error: error.message }
    }

    if (!row || !row.data) {
      console.log('[Sync] No remote data found — using local')
      // If we have local data, push it to seed Supabase
      const local = getBackupData()
      if (local) {
        console.log('[Sync] Seeding Supabase with local data')
        await syncToSupabase()
      }
      return { success: true, merged: false }
    }

    const remote = row.data as BackupData
    const local = getBackupData()

    // Extract device metadata from remote
    const remoteMeta = (remote as any)._syncMeta as { savedBy?: string; savedAt?: string } | undefined
    const remoteDevice = remoteMeta?.savedBy || 'unknown'

    // Diagnostic logging
    const remoteTime = new Date(remote._lastSavedAt || 0).getTime()
    const localTime = local ? new Date(local._lastSavedAt || 0).getTime() : 0

    console.log(`[Sync] This device: ${thisDevice}`)
    console.log(`[Sync] Local timestamp: ${local?._lastSavedAt || 'none'} (${localTime})`)
    console.log(`[Sync] Remote timestamp: ${remote._lastSavedAt || 'none'} (${remoteTime}), saved by: ${remoteDevice}`)

    // Store sync metadata for UI display
    _lastSyncMeta = { savedBy: remoteDevice, savedAt: remote._lastSavedAt || '' }

    // ── Case 1: No local data — use remote ──────────────────────────
    if (!local) {
      saveBackupDataSilent(remote)
      console.log('[Sync] No local data — Loading: remote')
      return { success: true, merged: true, fromDevice: remoteDevice }
    }

    // ── Case 2: Remote is newer — ALWAYS use remote (no richness guard) ──
    if (remoteTime > localTime) {
      saveBackupDataSilent(remote)
      console.log(`[Sync] Remote is newer — Loading: remote (saved by ${remoteDevice})`)
      return { success: true, merged: true, fromDevice: remoteDevice }
    }

    // ── Case 3: Local is newer ──────────────────────────────────────
    if (localTime > remoteTime) {
      if (forceRemote) {
        // Realtime event triggered this pull — always accept remote regardless of timestamp.
        // The Realtime event itself proves remote changed; pushing local would overwrite it.
        saveBackupDataSilent(remote)
        console.log(`[Sync] forceRemote=true — accepting remote data (saved by ${remoteDevice})`)
        return { success: true, merged: true, fromDevice: remoteDevice }
      }
      console.log('[Sync] Local is newer — pushing to Supabase, Loading: local')
      await syncToSupabase()
      return { success: true, merged: false }
    }

    // ── Case 4: Same timestamp — no action needed ───────────────────
    console.log('[Sync] Timestamps match — no sync needed')
    return { success: true, merged: false }
  } catch (err: any) {
    console.error('[Sync] Supabase load error:', err)
    return { success: false, merged: false, error: err?.message || 'Unknown error' }
  }
}

/** Enhanced saveBackupData that also syncs to Supabase */
export function saveBackupDataAndSync(data: BackupData, changedKey?: string): void {
  data._lastSavedAt = new Date().toISOString()
  if (changedKey) markChanged(changedKey)
  _dataChanged = true
  saveBackupData(data)
  // Fire and forget — sync to Supabase in background
  syncToSupabase().catch(err => console.warn('[sync] Background sync failed:', err))
  // Create snapshot if interval elapsed
  maybeAutoSnapshot('Data saved')
}

// ── ISSUE 2 Fix: Critical change keys that bypass debounce ──────────────────
const CRITICAL_KEYS = new Set(['serviceLogs', 'projects', 'logs', 'weeklyData'])

/**
 * Save and immediately sync to Supabase for critical data changes
 * (payment status, project updates, service logs) — bypasses the 30s debounce.
 */
export function saveAndImmediateSync(data: BackupData, changedKey?: string): void {
  data._lastSavedAt = new Date().toISOString()
  if (changedKey) markChanged(changedKey)
  _dataChanged = true
  saveBackupData(data)
  // Immediate sync — no debounce for critical data
  console.log(`[sync] Immediate sync triggered for key: ${changedKey || 'unknown'}`)
  syncToSupabase().catch(err => console.warn('[sync] Immediate sync failed:', err))
  // Create snapshot if interval elapsed
  maybeAutoSnapshot(`Critical update: ${changedKey || 'data'}`)
}

/**
 * Force full sync to cloud NOW. Bypasses all debounce/timers.
 * Use for the "Save to Cloud" button in Settings.
 * Returns result so UI can show success/failure.
 */
export async function forceSyncToCloud(): Promise<{ success: boolean; error?: string }> {
  const data = getBackupData()
  if (!data) return { success: false, error: 'No local data to sync' }

  // Always update timestamp before force sync
  data._lastSavedAt = new Date().toISOString()
  saveBackupData(data)

  console.log('[sync] Force sync to cloud initiated')
  const result = await syncToSupabase()

  if (result.success) {
    _dataChanged = false
    _lastSyncedAt = Date.now()
    _changedKeys.clear()
    console.log('[sync] Force sync successful at', data._lastSavedAt)
  }

  return result
}

// Legacy mappers (kept for backward compat)
export function mapBackupProjects(backup: BackupData) { return backup.projects || [] }
export function mapBackupLogs(backup: BackupData) { return backup.logs || [] }
export function mapBackupPriceBook(backup: BackupData): BackupPriceBookItem[] {
  const raw = backup.priceBook
  if (!raw) return []
  // Handle both formats: array (from HTML app backup) and Record (from React app)
  if (Array.isArray(raw)) return raw as BackupPriceBookItem[]
  return Object.values(raw)
}
export function getBackupKPIs(backup: BackupData) { return getKPIs(backup) }
export function mapBackupWeeklyData(backup: BackupData) { return backup.weeklyData || [] }
export function mapBackupInvoices(backup: BackupData) {
  return (backup.projects || []).filter(p => p.billed > 0 || p.paid > 0).map((p, i) => ({
    id: `inv-${p.id}`, invoice_number: `INV-${String(i + 1).padStart(4, '0')}`,
    client_id: null, total: p.billed || p.contract || 0,
    balance_due: (p.billed || 0) - (p.paid || 0),
    status: p.paid >= p.billed && p.billed > 0 ? 'paid' : p.paid > 0 ? 'partial' : 'sent',
    days_overdue: 0, due_date: null, created_at: backup._lastSavedAt || new Date().toISOString(),
    project_name: p.name,
  }))
}

// ── Snapshot System ──────────────────────────────────────────────────────────

export interface DataSnapshot {
  id: string
  timestamp: number
  device: string
  changeSummary: string
  data: Record<string, unknown>
}

const SNAPSHOT_KEY = 'poweron_snapshots'
const MAX_SNAPSHOTS = 30

// ── Snapshot rate limiter for auto-snapshots ────────────────────────────────
let _lastSnapshotTime = 0
const SNAPSHOT_INTERVAL = 5 * 60 * 1000 // 5 minutes minimum between auto-snapshots

function maybeAutoSnapshot(changeSummary: string): void {
  const now = Date.now()
  if (now - _lastSnapshotTime < SNAPSHOT_INTERVAL) {
    console.log('[Snapshot] maybeAutoSnapshot skipped (too soon):', changeSummary)
    return
  }
  _lastSnapshotTime = now
  console.log('[Snapshot] maybeAutoSnapshot triggered:', changeSummary)
  try {
    createSnapshot(`Auto: ${changeSummary}`)
  } catch {
    // Non-critical
  }
}

function getDeviceIdForSnapshot(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'iOS'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac/.test(ua)) return 'Mac'
  return 'Unknown'
}

export function getSnapshots(): DataSnapshot[] {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function createSnapshot(changeSummary: string): DataSnapshot | null {
  try {
    const backup = getBackupData()
    if (!backup) return null

    const snapshot: DataSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      device: getDeviceIdForSnapshot(),
      changeSummary,
      data: JSON.parse(JSON.stringify(backup)),
    }

    const snapshots = getSnapshots()
    snapshots.unshift(snapshot)

    // Trim to max
    const trimmed = snapshots.slice(0, MAX_SNAPSHOTS)
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(trimmed))

    // Also save to Supabase (fire and forget)
    saveSnapshotToSupabase(snapshot)

    return snapshot
  } catch (err) {
    console.error('[Snapshot] Failed to create:', err)
    return null
  }
}

async function saveSnapshotToSupabase(snapshot: DataSnapshot): Promise<void> {
  try {
    const { supabase } = await import('@/lib/supabase')
    // Store full snapshot list under 'poweron_snapshots' key so all devices sync
    const allSnapshots = getSnapshots()
    await supabase
      .from('app_state')
      .upsert({
        state_key: 'poweron_snapshots',
        state_value: allSnapshots,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'state_key' })
      .select()
    console.log('[Snapshot] Saved', allSnapshots.length, 'snapshots to Supabase under poweron_snapshots')
  } catch (err) {
    console.warn('[Snapshot] Supabase save failed (non-critical):', err)
  }
}

export function restoreSnapshot(snapshotId: string): boolean {
  try {
    const snapshots = getSnapshots()
    const snapshot = snapshots.find(s => s.id === snapshotId)
    if (!snapshot) return false

    // Create a pre-restore snapshot first
    createSnapshot('Auto-backup before restore')

    // Restore the data
    saveBackupData(snapshot.data as any)
    return true
  } catch (err) {
    console.error('[Snapshot] Restore failed:', err)
    return false
  }
}

export function deleteSnapshot(snapshotId: string): void {
  const snapshots = getSnapshots().filter(s => s.id !== snapshotId)
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots))
}
