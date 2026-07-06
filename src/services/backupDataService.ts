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

// Phase 5A: scope registry scaffolding. Pure module (no React/Supabase/localStorage).
// Used here only to resolve scopes for logging/metadata + a dev-only unscoped-save
// warning. NO scoped-merge behavior is enabled in this phase.
import {
  resolveScopesForSyncInput,
  type DataScope,
} from './scopeRegistry'
import { getLiveChangeOrders, getLiveMaterialRows, getLiveRFIs, isDeadProjectLog, mergeRemoteProjectCoordinationIntoOutgoing, mergeRemoteProjectProgressIntoOutgoing, mergeRemoteProjectScheduleIntoOutgoing, mergeRemoteProjectTimelineIntoOutgoing } from './projectScopeMerge'
import { mergeRemoteWeeklyDataIntoOutgoing } from './weeklyDataScopeMerge'
import { mergeRemoteEmployeesIntoOutgoing } from './teamScopeMerge'

const LEGACY_STORAGE_KEY = 'poweron_backup_data'
const STORAGE_KEY = LEGACY_STORAGE_KEY

// ── Tenant-scoped local cache ────────────────────────────────────────────────
// Live authenticated app data must never be read from a browser-global key.
// The generic legacy key is only kept as a compatibility mirror/migration source.
let _activeTenantUserId: string | null = null
let _tenantDataReady = false

function getTenantStorageKey(userId: string): string {
  return `poweron_backup_data_${userId}`
}

export function setActiveTenantUser(userId: string): void {
  _activeTenantUserId = userId
  _tenantDataReady = false
  _lastKnownRemoteSavedAt = null
}

export function markTenantDataReady(userId: string): void {
  if (_activeTenantUserId === userId) _tenantDataReady = true
}

export function clearActiveTenantUser(): void {
  _activeTenantUserId = null
  _tenantDataReady = false
  _lastKnownRemoteSavedAt = null
}

export function getActiveTenantUserId(): string | null {
  return _activeTenantUserId
}

export function isTenantDataReady(): boolean {
  return !!_activeTenantUserId && _tenantDataReady
}

function attachTenantOwner(data: BackupData, userId: string): BackupData {
  return { ...(data as any), _tenantUserId: userId } as BackupData
}

function tenantOwnerMatches(data: any, userId: string): boolean {
  return !data?._tenantUserId || data._tenantUserId === userId
}

function getEffectiveStorageKey(userId = _activeTenantUserId): string {
  return userId ? getTenantStorageKey(userId) : LEGACY_STORAGE_KEY
}

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
      syncToSupabase(_activeTenantUserId, { source: 'periodic-sync' })
        .then((result) => {
          if (result.success) {
            _dataChanged = false
            _lastSyncedAt = Date.now()
            _changedKeys.clear()
          } else if (result.blocked || result.conflict) {
            console.warn('[sync] Periodic sync blocked — local changes preserved', result.error)
          }
        })
        .catch(err => console.warn('[sync] Periodic sync failed:', err))
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
  /** Phase 6N: scoped-merge identity/tombstone metadata (all optional/back-compat). */
  logId?: string; createdAt?: string; updatedAt?: string
  deletedAt?: string; deletedBy?: string; archivedAt?: string; status?: string
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
  /** Phase 6L: per-field LWW timestamps for scoped estimate scalar merge (contract/mileRT/miDays). */
  estimateScalarUpdatedAt?: { contract?: string; mileRT?: string; miDays?: string; laborPhaseColors?: string }
  /** Phase 6S-A: per-field LWW timestamps for scoped project.finance merge (manualPaidAdjustment/lastCollectedAt/billedOverride/contractOverride/matCostOverride). */
  financeUpdatedAt?: Partial<Record<string, string>>
  /** Phase 6S-D1: per-field LWW timestamps for scoped project.timeline merge (deposit_pct/phase_deposit_pct). phase_timeline rows carry their own optional updatedAt. */
  timelineUpdatedAt?: Partial<Record<string, string>>
  /** Phase 6S-D3: per-field LWW timestamps for scoped project.schedule merge (plannedStart/plannedEnd/lastMove). */
  scheduleUpdatedAt?: Partial<Record<'plannedStart' | 'plannedEnd' | 'lastMove', string>>
  /** Phase 6S-D4: optional scoped project.coordination metadata. Coord rows carry createdAt/updatedAt/deletedAt/deletedBy. */
  coordUpdatedAt?: Record<string, string> | Record<string, Record<string, string>>
  coordDeletedAt?: Record<string, Record<string, string>>
  /** Phase 6S-D2: per-phase/task timestamps for scoped project.progress merge. */
  progressUpdatedAt?: {
    phases?: Record<string, string>
    tasks?: Record<string, string>
    customPhases?: Record<string, string>
    progressPhaseColors?: Record<string, string>
    progressPhaseOverrideEnabled?: Record<string, string>
  }
  /** Phase 6S-D2: delete metadata for scoped project.progress map/phase removals. Task rows carry their own deletedAt. */
  progressDeletedAt?: {
    phases?: Record<string, string>
    tasks?: Record<string, string>
    customPhases?: Record<string, string>
  }
  /** Phase 6S-D1: projected cash flow / payment schedule / quote-vs-actual timeline rows (project.timeline scope), keyed by phase_name. */
  phase_timeline?: any[]
  deposit_pct?: number
  phase_deposit_pct?: number
  plannedStart?: string; plannedEnd?: string
  /** Progress tab header accent colors per phase name (project-local, optional) */
  progressPhaseColors?: Record<string, string>
  /** Job site / project address (synced backup; Estimate mileage + Edit Project) */
  address?: string
  addressLat?: number
  addressLng?: number
  /** Google Places place_id when address was picked from autocomplete */
  placeId?: string
  archived?: boolean
  archivedAt?: string | null
  archivedReason?: string | null
  /** Phase 6Q: project soft-delete lifecycle tombstone (project.lifecycle scope). */
  deletedAt?: string
  deletedBy?: string
  updatedAt?: string
  outcome?: 'active' | 'won' | 'lost' | 'completed' | 'cancelled' | null
  lostReason?: string
  lostNotes?: string
  completedAt?: string
  changeOrders?: ChangeOrder[]
}

export type ChangeOrderStatus =
  | 'Draft' | 'Sent' | 'Pending Approval' | 'Approved'
  | 'Rejected' | 'Completed' | 'Invoiced' | 'Paid'

export interface ChangeOrder {
  id: string; title: string; description: string; stage: string
  requestedBy: string; approvedBy: string; createdAt: string
  approvalAt: string; laborCost: number; materialCost: number
  totalCost: number; permitRelated: boolean; status: ChangeOrderStatus
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
}

export interface BackupPriceBookItem {
  id: string; cat: string; src: string; cost: number; link: string
  name: string; pack: number; unit: string; waste: number; legacyId: string
  notes?: string; pidBlock?: string; pidBand?: string
}

export interface BackupWeeklyData {
  wk: number; svc: number; proj: number; accum: number; start: string
  _empty: boolean; unbilled: number; pendingInv: number; totalExposure: number
  // Phase 6S-B: finance.weeklyData scoped-merge metadata (all optional).
  // manualOverride rows win over derived recalculation rows for the same wk.
  manualOverride?: boolean
  derivedAt?: string
  weeklyUpdatedAt?: string
  // Optional exposure projection fields used dynamically by the CFOT/pulse charts.
  serviceExposure?: number | null
  activeExposure?: number | null
  projectedTotalExposure?: number | null
  isProjection?: boolean
}

export interface BackupServiceLog {
  id: string; hrs: number; mat: number; date: string; jtype: string
  miles: number; notes: string; store: string; opCost: number; profit: number
  quoted: number; address?: string; customer: string; mileCost?: number
  collected: number; payStatus: string; balanceDue: number; detailLink?: string
  adjustments?: any[]; triggersAtSave?: string[]; compareWarnings?: string[]
  emergencyMatInfo?: string; estimateComparison?: any
  archived?: boolean
  archivedAt?: string | null
  archivedReason?: string | null
  serviceStatus?: 'open' | 'active' | 'completed' | 'paid' | 'lost' | 'cancelled' | null
  lostReason?: string
  lostNotes?: string
  completedAt?: string
  paidAt?: string
  statusEvents?: any[]
  // Phase 6R-A: scoped-merge identity, timestamps, and soft-delete tombstone.
  serviceLogId?: string
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
}

export interface BackupTriggerRule {
  id: string; name: string; type: string; color: string; active: boolean
  condition: string; threshold: string; thresholdLabel: string
  situation: string; review: string; solution: string; reflection: string
}

export interface BackupEmployee {
  id: string; name: string; role: string; billRate: number; costRate: number
  // Phase 6S-C: team.members scoped-merge identity, timestamps, and soft-delete
  // tombstone (all optional; historical logs keep resolving tombstoned employees).
  createdAt?: string
  updatedAt?: string
  deletedAt?: string
  deletedBy?: string
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
  priceBook: BackupPriceBookItem[]
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

  /** Deleted relationship/customer accounts that must not be revived from stale local gcContacts */
  _deletedRelationshipAccounts?: Array<{
    id?: string
    company?: string
    contact?: string
    deletedAt?: string
    source?: string
  }>
}

const LEGACY_GC_ONLY_FIELDS = [
  'phase', 'fit', 'action', 'due', 'awarded', 'sent', 'avg', 'pay',
  'intro', 'contactLog', 'nextFollowup', 'lastContact', 'created',
] as const

function isBlankValue(v: any): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
}

function pickNormalized(existingValue: any, incomingValue: any): any {
  return isBlankValue(incomingValue) ? existingValue : incomingValue
}

function normalizeRelationshipDeleteValue(v: any): string {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function matchesDeletedRelationshipAccount(record: any, deletedRelationshipAccounts: any[] = []): boolean {
  const id = normalizeRelationshipDeleteValue(record?.id || record?.legacy_gc_id || record?.legacyGcId)
  const company = normalizeRelationshipDeleteValue(record?.company || record?.name)
  const contact = normalizeRelationshipDeleteValue(record?.contact)

  const recordUpdatedAt = record?.updated_at ? new Date(record.updated_at).getTime() : 0

  return (deletedRelationshipAccounts || []).some((d: any) => {
    const deletedId = normalizeRelationshipDeleteValue(d?.id)
    const deletedCompany = normalizeRelationshipDeleteValue(d?.company)
    const deletedContact = normalizeRelationshipDeleteValue(d?.contact)
    const deletedAt = d?.deletedAt ? new Date(d.deletedAt).getTime() : 0

    // If a relationship_account row was recreated/updated after the tombstone,
    // allow it to return.
    if (recordUpdatedAt && deletedAt && recordUpdatedAt > deletedAt) return false

    const sameId = !!id && !!deletedId && id === deletedId
    const sameCompany = !!company && !!deletedCompany && company === deletedCompany
    const sameContact = !!contact && !!deletedContact && contact === deletedContact

    return sameId || sameCompany || sameContact
  })
}

export function relationshipAccountsToGcContacts(
  relationshipAccounts: any[],
  existingGcContacts: any[] = [],
  deletedRelationshipAccounts: any[] = []
): any[] {
  const existingById = new Map<string, any>()
  const existingByLegacyId = new Map<string, any>()
  ;(existingGcContacts || []).forEach((gc: any) => {
    const id = String(gc?.id || '').trim()
    if (id) existingById.set(id, gc)
  })

  const merged: any[] = []
  ;(relationshipAccounts || []).forEach((row: any) => {
    if (matchesDeletedRelationshipAccount(row, deletedRelationshipAccounts)) return

    const id = String(row?.id || '').trim()
    if (!id) return
    const legacyId = String(row?.legacy_gc_id || row?.legacyGcId || '').trim()
    const existing = existingById.get(id) || (legacyId ? existingById.get(legacyId) : null) || null
    if (legacyId && existing) existingByLegacyId.set(legacyId, existing)

    const payload = (row?.legacy_payload && typeof row.legacy_payload === 'object') ? row.legacy_payload : {}
    const base = { ...(existing || {}) }
    const safePayload = { ...payload }
    const out: any = { ...base, ...safePayload }

    // Canonical identity from relationship_accounts, but do not wipe with blank/null.
    out.id = id
    out.company = pickNormalized(out.company, row?.company)
    out.contact = pickNormalized(out.contact, row?.contact)
    out.role = pickNormalized(out.role, row?.role || row?.account_type)
    out.phone = pickNormalized(out.phone, row?.phone)
    out.email = pickNormalized(out.email, row?.email)
    out.address = pickNormalized(out.address, row?.address)
    out.city = pickNormalized(out.city, row?.city)
    out.notes = pickNormalized(out.notes, row?.notes)
    out.tags = pickNormalized(out.tags, row?.tags)

    // Preserve gcContacts-only lifecycle/activity fields.
    LEGACY_GC_ONLY_FIELDS.forEach((field: string) => {
      if (out[field] === undefined && existing && existing[field] !== undefined) out[field] = existing[field]
    })

    // Safe defaults for compatibility.
    if (out.phase === undefined) out.phase = 'First Contact'
    if (out.fit === undefined) out.fit = 0
    if (out.action === undefined) out.action = ''
    if (out.due === undefined) out.due = ''
    if (out.awarded === undefined) out.awarded = 0
    if (out.sent === undefined) out.sent = 0
    if (out.avg === undefined) out.avg = 0
    if (out.pay === undefined) out.pay = ''
    if (out.intro === undefined) out.intro = ''
    if (!Array.isArray(out.contactLog)) out.contactLog = []
    if (out.nextFollowup === undefined) out.nextFollowup = ''
    if (out.lastContact === undefined) out.lastContact = ''
    if (out.created === undefined) out.created = new Date().toISOString().slice(0, 10)

    merged.push(out)
  })

  // Keep local-only contacts not yet represented in relationship_accounts,
  // unless they were explicitly deleted.
  ;(existingGcContacts || []).forEach((gc: any) => {
    if (matchesDeletedRelationshipAccount(gc, deletedRelationshipAccounts)) return

    const id = String(gc?.id || '').trim()
    if (!id) return
    if (!merged.some((m: any) => String(m?.id || '') === id)) merged.push(gc)
  })

  return merged
}

// ── Supabase check ───────────────────────────────────────────────────────────

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  return !!(url && key && url !== '' && key !== '' && url.startsWith('http'))
}

// ── LocalStorage CRUD ────────────────────────────────────────────────────────

export function hasBackupData(userId = _activeTenantUserId): boolean {
  try { return localStorage.getItem(getEffectiveStorageKey(userId)) !== null } catch { return false }
}

export function getBackupData(userId = _activeTenantUserId): BackupData | null {
  try {
    const key = getEffectiveStorageKey(userId)
    const raw = localStorage.getItem(key)
    if (raw) {
      const data = JSON.parse(raw) as BackupData & { _tenantUserId?: string }
      if (userId && !tenantOwnerMatches(data, userId)) {
        console.warn('[backupDataService] Ignoring cache owned by another tenant')
        return null
      }
      // ISSUE 4: Price book dual-storage reconciliation. Only run legacy poweron_v2
      // reconciliation when no active tenant exists; authenticated sessions must not
      // hydrate from browser-global poweron_v2.
      const localPBArr = Array.isArray(data.priceBook) ? data.priceBook : (data.priceBook ? Object.values(data.priceBook) : [])
      if (!userId) {
        try {
          const v2Raw = localStorage.getItem('poweron_v2')
          if (v2Raw) {
            const v2Data = JSON.parse(v2Raw)
            const v2PB = Array.isArray(v2Data?.priceBook) ? v2Data.priceBook : (v2Data?.priceBook ? Object.values(v2Data.priceBook) : [])
            if (localPBArr.length === 0 && v2PB.length > 0) {
              console.log('[backupDataService] Hydrated priceBook from poweron_v2 key —', v2PB.length, 'items')
              data.priceBook = Array.isArray(v2Data.priceBook) ? v2Data.priceBook : Object.values(v2Data.priceBook || {})
            } else if (localPBArr.length > v2PB.length && v2PB.length >= 0) {
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
      }
      if (data && data.priceBook && !Array.isArray(data.priceBook) && typeof data.priceBook === 'object') {
        console.warn('[backupDataService] Migrating legacy object-shape priceBook to array — one-time conversion')
        data.priceBook = Object.values(data.priceBook as Record<string, BackupPriceBookItem>)
        try { localStorage.setItem(key, JSON.stringify(data)) } catch (e) { console.error('[backupDataService] Failed to persist migrated priceBook:', e) }
      }
      if (data && Array.isArray(data.serviceLogs)) {
        let backfilled = 0
        for (const sl of data.serviceLogs as any[]) {
          if (!sl) continue
          if (Array.isArray(sl.statusEvents) && sl.statusEvents.length > 0) continue
          sl.statusEvents = [{
            date: sl.date || new Date().toISOString().slice(0, 10),
            status: sl.payStatus || 'N',
            collected: Math.max(0, Number(sl.collected) || 0),
            invoiced: false,
          }]
          backfilled++
        }
        if (backfilled > 0) {
          console.log(`[backupDataService] Backfilled statusEvents on ${backfilled} service log(s) — one-time migration`)
          try { localStorage.setItem(key, JSON.stringify(data)) } catch (e) { console.error('[backupDataService] Failed to persist backfilled statusEvents:', e) }
        }
      }
      if (data && Array.isArray(data.projects) && Array.isArray(data.logs)) {
        let paidBackfilled = 0
        for (const p of data.projects as any[]) {
          if (!p) continue
          if (p._paidScalarBackfilledAt) continue
          const scalarPaid = Number(p.paid) || 0
          if (scalarPaid <= 0) {
            p._paidScalarBackfilledAt = new Date().toISOString()
            continue
          }
          const loggedSum = (data.logs as any[])
            .filter(l => l && l.projId === p.id)
            .reduce((sum, l) => sum + (Number(l.collected) || 0), 0)
          const manualAdj = Number((p.finance && p.finance.manualPaidAdjustment) || 0)
          const gap = scalarPaid - (loggedSum + manualAdj)
          if (gap > 0.005) {
            const gapDate = (p.lastCollectedAt && String(p.lastCollectedAt).slice(0, 10))
              || (data._lastSavedAt && String(data._lastSavedAt).slice(0, 10))
              || new Date().toISOString().slice(0, 10)
            ;(data.logs as any[]).push({
              id: 'log-paidbackfill-' + p.id + '-' + Date.now(),
              projId: p.id,
              projName: p.name || '',
              phase: 'Payment',
              date: gapDate,
              emp: 'Me',
              empId: '',
              hrs: 0,
              miles: 0,
              mat: 0,
              collected: gap,
              store: '',
              emergencyMatInfo: '',
              detailLink: '',
              notes: 'Backfilled from p.paid scalar (CFOT-COLLECTION-PATH-PARITY migration)',
            })
            paidBackfilled++
          }
          p._paidScalarBackfilledAt = new Date().toISOString()
        }
        if (paidBackfilled > 0) {
          console.log(`[backupDataService] Backfilled paid-scalar gap on ${paidBackfilled} project(s) — one-time migration`)
          try { localStorage.setItem(key, JSON.stringify(data)) } catch (e) { console.error('[backupDataService] Failed to persist paid-scalar backfill:', e) }
        }
      }
      return data as BackupData
    }

    // Only unauthenticated/legacy flows may fall back to poweron_v2. Authenticated
    // tenant sessions must not read browser-global fallback state.
    if (!userId) {
      const v2Raw = localStorage.getItem('poweron_v2')
      if (v2Raw) {
        console.log('[backupDataService] No data in', LEGACY_STORAGE_KEY, '— loading from poweron_v2')
        const v2Parsed = JSON.parse(v2Raw) as BackupData
        if (v2Parsed && v2Parsed.priceBook && !Array.isArray(v2Parsed.priceBook) && typeof v2Parsed.priceBook === 'object') {
          console.warn('[backupDataService] Migrating legacy object-shape priceBook (from poweron_v2) to array — one-time conversion')
          v2Parsed.priceBook = Object.values(v2Parsed.priceBook as Record<string, BackupPriceBookItem>)
          try { localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(v2Parsed)) } catch (e) { console.error('[backupDataService] Failed to persist migrated priceBook:', e) }
        }
        return v2Parsed
      }
    }
    return null
  } catch (err) {
    console.error('[backupDataService] Failed to parse backup data:', err)
    return null
  }
}

export function saveBackupData(data: BackupData, userId = _activeTenantUserId): void {
  try {
    const owned = userId ? attachTenantOwner(data, userId) : data
    const key = getEffectiveStorageKey(userId)
    localStorage.setItem(key, JSON.stringify(owned))

    // Keep legacy key as display compatibility only for the active tenant. Reads
    // during authenticated sessions still use the tenant key, not this key.
    if (userId) localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(owned))

    // Global save trigger:
    // Any normal user-facing save inside a fully hydrated tenant marks data dirty
    // so startPeriodicSync() can push it to Supabase.
    // Bootstrap/remote-load saves must not mark dirty before tenantDataReady.
    if (userId && _activeTenantUserId === userId && _tenantDataReady) {
      _dataChanged = true
    }
  } catch (err) {
    console.error('[backupDataService] Failed to save:', err)
  }

  try {
    window.dispatchEvent(new CustomEvent('poweron-data-saved'))
  } catch {
    /* ignore */
  }

  // Do not mirror tenant data into poweron_v2; that key is browser-global and
  // was a source of cross-account bleed.
  if (!userId) {
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
    } catch {
      /* ignore poweron_v2 sync errors */
    }
  }
}

/**
 * Write data to localStorage silently.
 * No poweron-data-saved dispatch. Does not set _dataChanged.
 * Use ONLY for internal sync operations (embedding metadata, saving remote pulls)
 * to prevent re-triggering the sync loop.
 */
function saveBackupDataSilent(data: BackupData, userId = _activeTenantUserId): void {
  try {
    const owned = userId ? attachTenantOwner(data, userId) : data
    const key = getEffectiveStorageKey(userId)
    localStorage.setItem(key, JSON.stringify(owned))
    if (userId) localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(owned))
  } catch { /* ignore */ }
}

export function clearBackupData(userId = _activeTenantUserId): void {
  try { localStorage.removeItem(getEffectiveStorageKey(userId)) } catch { /* ignore */ }
  if (userId) {
    try { localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { /* ignore */ }
  }
}

// ── Import merge summary type ────────────────────────────────────────────────

export interface ImportMergeSummary {
  merged: Record<string, number>
  total: number
}

// ── Import helper ─────────────────────────────────────────────────────────────

export function createEmptyBackup(): BackupData {
  return {
    logs: [], projects: [], priceBook: [], weeklyData: [], serviceLogs: [],
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

  // PriceBook merge — array shape canonical. Accepts legacy object-shape on import only (one-way).
  if (raw.priceBook) {
    const incomingItems: BackupPriceBookItem[] = Array.isArray(raw.priceBook)
      ? raw.priceBook
      : Object.values(raw.priceBook as Record<string, BackupPriceBookItem>)
    if (incomingItems.length > 0) {
      // Normalize existing to array (tolerate legacy object-shape in existing localStorage)
      if (!Array.isArray(existing.priceBook)) {
        existing.priceBook = existing.priceBook && typeof existing.priceBook === 'object'
          ? Object.values(existing.priceBook as Record<string, BackupPriceBookItem>)
          : []
      }
      const existingIds = new Set((existing.priceBook as BackupPriceBookItem[]).map(it => it.id))
      let added = 0
      for (const item of incomingItems) {
        if (item.id && !existingIds.has(item.id)) {
          (existing.priceBook as BackupPriceBookItem[]).push(item)
          existingIds.add(item.id)
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

export function resolveCanonicalCustomerName(record: any, accounts: any[] = []): string {
  const accountId = String(record?.accountId || record?.customerId || '').trim()
  if (accountId) {
    const acc = (accounts || []).find((a: any) => String(a?.id || '') === accountId)
    const canonical = String(acc?.company || acc?.contact || '').trim()
    if (canonical) return canonical
  }
  return String(
    record?.customer ||
    record?.client ||
    record?.company ||
    record?.contact ||
    record?.name ||
    record?.title ||
    'Unknown'
  ).trim()
}

/** Days since a date string, 999 if missing */
export function daysSince(d: string | undefined | null): number {
  if (!d) return 999
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

export function isArchivedRecord(record: any): boolean {
  return !!(record && (record.archived === true || record.isArchived === true || record.archivedAt))
}

export function isActiveProject(record: any): boolean {
  if (!record || isArchivedRecord(record)) return false
  // Phase 6Q: soft-deleted projects are never active (deletedAt tombstone or status).
  if (record.deletedAt) return false
  const status = String(record.status || record.projectStatus || '').toLowerCase().trim()
  const outcome = String(record.outcome || '').toLowerCase().trim()
  if (['deleted', 'lost', 'rejected', 'cancelled', 'canceled', 'archived'].includes(status)) return false
  if (['lost', 'cancelled', 'canceled'].includes(outcome)) return false
  return true
}

export function isActiveServiceCall(record: any): boolean {
  if (!record || isArchivedRecord(record)) return false
  // Phase 6R-A: soft-deleted service logs are never active (deletedAt tombstone).
  if (record.deletedAt) return false
  const status = String(record.serviceStatus || record.estimateStatus || record.status || '').toLowerCase().trim()
  const outcome = String(record.outcome || '').toLowerCase().trim()
  if (['deleted', 'lost', 'rejected', 'cancelled', 'canceled', 'archived'].includes(status)) return false
  if (['lost', 'cancelled', 'canceled'].includes(outcome)) return false
  return true
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

/** Equal whole-number weights that sum to 100 (remainder distributed to first phases). */
export function buildEqualPhaseWeights(phaseNames: string[]): Record<string, number> {
  const phases = (phaseNames || []).map(p => String(p || '').trim()).filter(Boolean)
  const n = phases.length
  if (n === 0) return {}
  const base = Math.floor(100 / n)
  const remainder = 100 - base * n
  const out: Record<string, number> = {}
  phases.forEach((ph, idx) => {
    out[ph] = base + (idx < remainder ? 1 : 0)
  })
  return out
}

/** Phase weights: non-empty saved map, else derive from mtoPhases, else built-in defaults */
export function getPhaseWeights(d: BackupData): Record<string, number> {
  const defaults: Record<string, number> = {
    Estimating: 5, Planning: 10, 'Site Prep': 15, 'Rough-in': 35, Finish: 25, Trim: 10,
  }
  const raw = d.settings?.phaseWeights
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length > 0) {
    return raw
  }
  const mto = d.settings?.mtoPhases
  if (Array.isArray(mto) && mto.length > 0) {
    return buildEqualPhaseWeights(mto)
  }
  return defaults
}

export function getProjectCOTotal(p: BackupProject): number {
  return getLiveChangeOrders(p.changeOrders || []).reduce((sum, co) => {
    if (co.status === 'Approved' || co.status === 'Completed' || co.status === 'Paid') {
      return sum + (Number(co.totalCost) || 0)
    }
    return sum
  }, 0)
}

export function getProjectCOExposure(p: BackupProject): number {
  return getLiveChangeOrders(p.changeOrders || []).reduce((sum, co) => {
    if (co.status === 'Sent' || co.status === 'Pending Approval' || co.status === 'Invoiced') {
      return sum + (Number(co.totalCost) || 0)
    }
    return sum
  }, 0)
}

/**
 * Confirmed change-order value for a project — counts toward Projects Total Exposure.
 * Statuses: {Approved, Completed, Invoiced, Paid}. Excludes Draft/Sent/Pending Approval
 * (speculative) and Rejected (void/cancelled). Does NOT subtract collections — this is
 * total scope added, not remaining. (DASHBOARD-CFOT-MATH-FIX-JUN19-2026-1)
 * Note: distinct from getProjectCOTotal (which omits Invoiced) — kept separate so the
 * project-card helpers are not affected.
 */
export function getProjectCOConfirmedTotal(p: BackupProject): number {
  return getLiveChangeOrders(p.changeOrders || []).reduce((sum, co) => {
    if (co.status === 'Approved' || co.status === 'Completed' || co.status === 'Invoiced' || co.status === 'Paid') {
      return sum + (Number(co.totalCost) || 0)
    }
    return sum
  }, 0)
}

/**
 * Approved-but-not-collected change-order value — counts toward Active Exposure.
 * Statuses: {Approved, Invoiced, Completed}. Paid is excluded (already collected) and
 * Sent/Pending Approval/Draft/Rejected are excluded (not yet owed).
 * (DASHBOARD-CFOT-MATH-FIX-JUN19-2026-1)
 */
export function getProjectCOApprovedUnpaid(p: BackupProject): number {
  return getLiveChangeOrders(p.changeOrders || []).reduce((sum, co) => {
    if (co.status === 'Approved' || co.status === 'Invoiced' || co.status === 'Completed') {
      return sum + (Number(co.totalCost) || 0)
    }
    return sum
  }, 0)
}

/** Overall completion — weighted phase average (matches HTML ov(p)) */
export function getOverallCompletion(p: BackupProject, d: BackupData): number {
  const w = getPhaseWeights(d)
  const tot = Object.values(w).reduce((s, v) => s + v, 0) || 100
  const phases = p.phases || {}
  return Object.entries(w).reduce((s, [ph, wt]) => s + (num(phases[ph]) * wt / tot), 0)
}

/** Get logs for a specific project */
/**
 * Phase 6N: a project log is "dead" (excluded from UI + financial totals) when it
 * carries a deletedAt/archivedAt tombstone or a deleted/archived/void status.
 * Delegates to the pure scoped-merge predicate so UI and financials agree.
 */
export function isDeletedOrArchivedProjectLog(log: any): boolean {
  return isDeadProjectLog(log)
}

/**
 * Live (non-tombstoned, non-archived) logs for a project. This is the source of
 * truth for financial aggregation after Phase 6N — tombstoned logs (and their
 * embedded `collected` payments) must never count toward paid/collected/ar/risk.
 */
export function getLiveProjectLogs(d: BackupData, projId: string): BackupLog[] {
  return (d.logs || []).filter(l => l.projId === projId && !isDeletedOrArchivedProjectLog(l))
}

export function projectLogsFor(d: BackupData, projId: string): BackupLog[] {
  // Phase 6N: filter tombstoned/archived logs so all downstream financial readers
  // (getProjectFinancials, buildProjectLogRollup, pricing analytics) exclude them.
  return (d.logs || []).filter(l => l.projId === projId && !isDeletedOrArchivedProjectLog(l))
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
  const contract = num(p.contract)
  const billed = num(p.billed)
  const logs = projectLogsFor(d, p.id)
  const loggedPaid = logs.reduce((s, l) => s + num(l.collected), 0)
  const manualPaidAdjustment = num(fin.manualPaidAdjustment || 0)
  const paid = Math.max(0, loggedPaid + manualPaidAdjustment)
  const ar = Math.max(0, billed - paid)
  const unbilled = Math.max(0, contract - billed)
  const risk = Math.max(0, contract - paid)
  const estMat = getLiveMaterialRows(p.matRows || [], p.id, 'matRows').reduce((s: number, r: any) => s + (num(r.cost) * num(r.qty || 1)), 0)
  const matCost = estMat
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
  const openR = getLiveRFIs(p.rfis || [], p.id).filter((r: any) => r.status !== 'answered').length
  // DASHBOARD-CFOT-COLLECTION-PATH-PARITY-APR22-2026-1 — read derived paid from logs,
  // not the p.paid scalar (scalar is no longer written to; logs are the source of truth).
  const paidDerived = getProjectFinancials(p, d).paid
  let sc = 50 + o * 0.28 + (ds < 7 ? 15 : ds < 14 ? 5 : -20) - openR * 5
    + ((p.logs || []).length ? 10 : 0)
    + (paidDerived / Math.max(num(p.contract), 1)) * 8

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
 *    Labor cost = hours × internal overhead rate (settings.opCost, NaN if missing)
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
  // Spec: internal overhead rate for labor cost (opCost/OH_RATE, NOT billRate)
  const opCost = num(d.settings && d.settings.opCost)
  const mileRate = num(d.settings && d.settings.mileRate)
  if (!opCost) {
    console.error('[buildProjectLogRollup] Settings opCost missing — returning NaN costs')
  }
  if (!mileRate) {
    console.error('[buildProjectLogRollup] Settings mileRate missing — returning NaN costs')
  }
  let cumHours = 0, cumMiles = 0
  let cumLaborCost = 0, cumMaterialCost = 0, cumMileageCost = 0, cumCollected = 0
  const byId: Record<string, any> = {}
  logs.forEach(l => {
    cumHours += num(l.hrs)
    cumMiles += num(l.miles)
    cumCollected += num(l.collected)

    // Per-entry cost (spec: Labor=hrs×opCost, Material=mat, Mileage=milesRT×mileRate)
    const entryLaborCost = num(l.hrs) * opCost
    const entryMaterialCost = num(l.mat)
    const entryMileageCost = num(l.miles) * mileRate
    const entryTotalCost = entryLaborCost + entryMaterialCost + entryMileageCost

    // Cumulative totals across all entries up to and including this one
    cumLaborCost += entryLaborCost
    cumMaterialCost += entryMaterialCost
    cumMileageCost += entryMileageCost
    const cumTotalCost = cumLaborCost + cumMaterialCost + cumMileageCost

    // Spec: Running balance = Contract − Cumulative Total Cost (collected is tracked separately, not subtracted)
    const remainingAfter = quote - cumTotalCost

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

/**
 * buildServiceLogRollup — service log cost rollup.
 * Mirrors buildProjectLogRollup for service logs.
 * Precedence: per-log opCost override wins over settings opCost
 * (handles subcontractor/helper calls with different internal rates).
 * Formula: hours × effectiveOpCost + materials + miles × mileRate
 */
export function buildServiceLogRollup(d: BackupData) {
  const settingsOpCost = num(d.settings && d.settings.opCost)
  const mileRate = num(d.settings && d.settings.mileRate)
  if (!settingsOpCost) {
    console.error('[buildServiceLogRollup] Settings opCost missing — returning NaN costs')
  }
  if (!mileRate) {
    console.error('[buildServiceLogRollup] Settings mileRate missing — returning NaN costs')
  }

  const serviceLogs = d.serviceLogs || []
  const byId: Record<string, any> = {}
  let cumLaborCost = 0
  let cumMaterialCost = 0
  let cumMileageCost = 0
  let cumTotalCost = 0

  for (const l of serviceLogs) {
    const logOpCost = num(l.opCost)
    const effectiveOpCost = logOpCost > 0 ? logOpCost : settingsOpCost
    const entryLaborCost = num(l.hrs) * effectiveOpCost
    const entryMaterialCost = num(l.mat)
    const entryMileageCost = num(l.miles) * mileRate
    const entryTotalCost = entryLaborCost + entryMaterialCost + entryMileageCost

    cumLaborCost += entryLaborCost
    cumMaterialCost += entryMaterialCost
    cumMileageCost += entryMileageCost
    cumTotalCost += entryTotalCost

    byId[l.id] = {
      entryLaborCost,
      entryMaterialCost,
      entryMileageCost,
      entryTotalCost,
      cumLaborCost,
      cumMaterialCost,
      cumMileageCost,
      cumTotalCost,
      effectiveOpCost
    }
  }

  return {
    logs: serviceLogs,
    byId,
    totals: {
      cumLaborCost,
      cumMaterialCost,
      cumMileageCost,
      cumTotalCost
    }
  }
}
/** Sync all project finance buckets */
export function syncAllProjectFinanceBuckets(d: BackupData): void {
  ;(d.projects || []).forEach(p => ensureProjectFinanceBucket(p))
}

// ── KPIs (matches HTML renderHome exactly) ───────────────────────────────────

export function getKPIs(d: BackupData) {
  const projects = (d.projects || []).filter(isActiveProject)
  const logs = d.logs || []
  const serviceLogs = (d.serviceLogs || []).filter(isActiveServiceCall)
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
  const openRfis = projects.reduce((s, p) => s + getLiveRFIs(p.rfis || [], p.id).filter((r: any) => r.status !== 'answered').length, 0)
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
    else d = { projects: [], logs: [], serviceLogs: [], priceBook: [], weeklyData: [], triggerRules: [], calcRefs: {}, customers: [], settings: {} as any, employees: [], templates: [], gcContacts: [], serviceLeads: [], agendaSections: [], completedArchive: [], projectDashboards: {}, blueprintSummaries: {}, activeServiceCalls: [], serviceEstimates: [], taskSchedule: [], dailyJobs: [], weeklyReviews: [], _lastSavedAt: '', _schemaVersion: 0 }
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
const CACHE_OWNER_KEY = 'poweron_cache_owner'

/** Timestamp of the last remote app_state row loaded or checked (ISO string). */
let _lastKnownRemoteSavedAt: string | null = null

export const REMOTE_FRESHER_THAN_LOCAL_MSG =
  'Remote data is newer than this local session. Reload before saving, or create a backup before overwriting.'

export const REMOTE_FRESHNESS_UNKNOWN_MSG =
  'Could not verify remote data freshness. Save was blocked to prevent overwriting newer data. Reload and try again.'

export const HEADER_SAVE_SNAPSHOT_FAILED_MSG =
  'Could not create a safety snapshot. Save was blocked to protect existing data.'

export const SYNC_BLOCKED_REMOTE_NEWER_MSG =
  'Cloud sync was blocked because remote data is newer than this local session. Reload before syncing to avoid overwriting newer data.'

export const SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG =
  'Cloud sync was blocked because this session could not prove it loaded the latest remote data. Reload before syncing.'

/** Shown only on localhost/dev when a stale full snapshot would overwrite newer cloud data. */
export const LOCALHOST_STALE_SNAPSHOT_BLOCKED_MSG =
  'Localhost session is older than production cloud data. Full snapshot save blocked to prevent overwriting newer cloud data.'

const REMOTE_FRESHNESS_FETCH_TIMEOUT_MS = 15000
const FRESHNESS_TOLERANCE_MS = 1000

export type SyncToSupabaseOptions = {
  /** Caller label for logging (e.g. periodic-sync, snapshot-restore). */
  source?: string
  /** When true, fetch remote and block if remote is newer than local. Default: true unless allowOverwriteNewerRemote. */
  requireFreshRemote?: boolean
  /** When true, block sync if remote freshness cannot be verified. Default: true for guarded syncs. */
  failClosed?: boolean
  /** Explicit restore/intentional overwrite — bypasses stale-overwrite guard. */
  allowOverwriteNewerRemote?: boolean
  /** Internal: prevents production merge retry recursion. */
  _skipProductionMerge?: boolean
  /**
   * Internal (Phase 4 verified save): suppress the optimistic `poweron:sync-success`
   * event on write-ACK so the verified-save orchestrator can fire it ONLY after a
   * cloud read-back confirms the write. Prevents a premature green "synced" state.
   */
  _suppressSuccessEvent?: boolean
  /**
   * Internal (Phase 5A scaffolding): scopes resolved from the caller's changedKey/source.
   * Metadata only — NOT used to alter sync behavior and NOT written to BackupData or
   * the Supabase payload. Reserved for future scoped-merge phases.
   */
  _scopes?: DataScope[]
}

export type SyncToSupabaseResult = {
  success: boolean
  error?: string
  skipped?: boolean
  blocked?: boolean
  conflict?: boolean
}

export type ForceSyncToCloudOptions = {
  /** When true, fetch remote app_state and block if remote is newer than local. */
  requireFreshRemote?: boolean
  /** Caller label for logging (e.g. header-save). */
  source?: string
  /** When true, create a safety snapshot before writing (header Save only in S2). */
  createSafetySnapshot?: boolean
  /** Explicit restore/intentional overwrite — bypasses stale-overwrite guard on final sync. */
  allowOverwriteNewerRemote?: boolean
}

export type ForceSyncToCloudResult = {
  success: boolean
  error?: string
  skipped?: boolean
  /** Save was blocked because remote data is newer than local. */
  blocked?: boolean
}

function parseBackupTimestampMs(value?: string | null): number {
  if (!value) return 0
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

export function getLastKnownRemoteSavedAt(): string | null {
  return _lastKnownRemoteSavedAt
}

function getKnownRemoteBaselineMs(): number {
  return parseBackupTimestampMs(_lastKnownRemoteSavedAt)
}

function computeRemoteFreshnessMs(
  remoteUpdatedAt?: string | null,
  remoteDataLastSavedAt?: string | null,
): number {
  return Math.max(
    parseBackupTimestampMs(remoteUpdatedAt),
    parseBackupTimestampMs(remoteDataLastSavedAt),
  )
}

/**
 * Record remote freshness this session safely loaded from or successfully synced to.
 *
 * Phase 4H: the session baseline is MONOTONIC. It may be initialized from zero and may
 * move forward, but an OLDER candidate (an out-of-order realtime row, a lagging load,
 * or a slower sync ACK) must never move it backward during a live tenant session. An
 * explicit tenant reset (setActiveTenantUser / clearActiveTenantUser) still clears it to
 * null — that is the only way it goes back to zero.
 *
 * The return value is always the CANDIDATE remote freshness (not the retained baseline),
 * so callers such as loadFromSupabase keep their remote-vs-local selection logic intact.
 */
function setKnownRemoteBaseline(
  remoteUpdatedAt?: string | null,
  remoteDataLastSavedAt?: string | null,
): number {
  const candidateBaselineMs = computeRemoteFreshnessMs(remoteUpdatedAt, remoteDataLastSavedAt)
  const currentBaselineMs = getKnownRemoteBaselineMs()

  // Only advance (or initialize from zero); never lower.
  const applied = candidateBaselineMs > 0 && candidateBaselineMs >= currentBaselineMs
  if (applied) {
    _lastKnownRemoteSavedAt = new Date(candidateBaselineMs).toISOString()
  }

  return candidateBaselineMs
}

async function fetchRemoteAppStateFreshness(userId: string): Promise<{
  hasRemoteRow: boolean
  remoteUpdatedAt: string | null
  remoteDataLastSavedAt: string | null
  remoteFreshnessMs: number
  /** Phase 4H: device id (_syncMeta.savedBy) that last wrote the remote row, if known. */
  remoteSavedBy?: string | null
  error?: string
}> {
  const fetchFreshness = async (): Promise<{
    hasRemoteRow: boolean
    remoteUpdatedAt: string | null
    remoteDataLastSavedAt: string | null
    remoteFreshnessMs: number
    remoteSavedBy?: string | null
    error?: string
  }> => {
    if (!isSupabaseConfigured()) {
      return { hasRemoteRow: false, remoteUpdatedAt: null, remoteDataLastSavedAt: null, remoteFreshnessMs: 0, error: 'Supabase not configured' }
    }
    try {
      const { supabase } = await import('@/lib/supabase')
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        return { hasRemoteRow: false, remoteUpdatedAt: null, remoteDataLastSavedAt: null, remoteFreshnessMs: 0, error: 'Not authenticated' }
      }
      if (user.id !== userId) {
        return { hasRemoteRow: false, remoteUpdatedAt: null, remoteDataLastSavedAt: null, remoteFreshnessMs: 0, error: 'Authenticated user mismatch' }
      }

      const { data: row, error } = await supabase
        .from('app_state')
        .select('user_id,data,updated_at')
        .eq('user_id', userId)
        .eq('state_key', SUPABASE_STATE_KEY)
        .maybeSingle()

      if (error) {
        return { hasRemoteRow: false, remoteUpdatedAt: null, remoteDataLastSavedAt: null, remoteFreshnessMs: 0, error: error.message }
      }

      if (!row) {
        return { hasRemoteRow: false, remoteUpdatedAt: null, remoteDataLastSavedAt: null, remoteFreshnessMs: 0 }
      }

      if (!row.data) {
        return {
          hasRemoteRow: true,
          remoteUpdatedAt: row.updated_at ? String(row.updated_at) : null,
          remoteDataLastSavedAt: null,
          remoteFreshnessMs: 0,
          error: 'Remote row exists but data is missing',
        }
      }

      const remoteDataLastSavedAt = String((row.data as BackupData)?._lastSavedAt || '') || null
      const remoteUpdatedAt = row.updated_at ? String(row.updated_at) : null
      const remoteFreshnessMs = computeRemoteFreshnessMs(remoteUpdatedAt, remoteDataLastSavedAt)
      // Phase 4H: same source the load path uses to print "saved by <device>".
      const remoteSavedBy = ((row.data as any)?._syncMeta?.savedBy as string | undefined) ?? null

      return {
        hasRemoteRow: true,
        remoteUpdatedAt,
        remoteDataLastSavedAt,
        remoteFreshnessMs,
        remoteSavedBy,
      }
    } catch (err: any) {
      return {
        hasRemoteRow: false,
        remoteUpdatedAt: null,
        remoteDataLastSavedAt: null,
        remoteFreshnessMs: 0,
        error: err?.message || 'Failed to read remote freshness',
      }
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<{
    hasRemoteRow: boolean
    remoteUpdatedAt: string | null
    remoteDataLastSavedAt: string | null
    remoteFreshnessMs: number
    remoteSavedBy?: string | null
    error?: string
  }>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        hasRemoteRow: false,
        remoteUpdatedAt: null,
        remoteDataLastSavedAt: null,
        remoteFreshnessMs: 0,
        error: 'Remote freshness check timed out',
      })
    }, REMOTE_FRESHNESS_FETCH_TIMEOUT_MS)
  })

  try {
    return await Promise.race([fetchFreshness(), timeoutPromise])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

/**
 * Compare live remote app_state against this session's known remote baseline.
 * Does not mutate local _lastSavedAt or advance baseline on fetch.
 * When failClosed is true, fetch failures block the save/sync.
 */
export async function checkManualSaveFreshness(
  userId = _activeTenantUserId,
  options?: { failClosed?: boolean },
): Promise<{
  allowed: boolean
  blocked?: boolean
  error?: string
  localFreshnessMs: number
  remoteFreshnessMs: number
  knownRemoteBaselineMs: number
  hasRemoteRow: boolean
}> {
  const local = userId ? getBackupData(userId) : getBackupData()
  const localFreshnessMs = parseBackupTimestampMs(local?._lastSavedAt)
  const knownRemoteBaselineMs = getKnownRemoteBaselineMs()
  const failClosed = options?.failClosed === true

  const blockUnverified = (reason: string) => {
    console.warn('[Sync] Save/sync blocked — could not verify remote freshness:', reason)
    return {
      allowed: false,
      blocked: true,
      error: REMOTE_FRESHNESS_UNKNOWN_MSG,
      localFreshnessMs,
      remoteFreshnessMs: 0,
      knownRemoteBaselineMs,
      hasRemoteRow: false,
    }
  }

  if (!userId) {
    if (failClosed) return blockUnverified('No active tenant user')
    return { allowed: true, localFreshnessMs, remoteFreshnessMs: 0, knownRemoteBaselineMs, hasRemoteRow: false }
  }

  const remote = await fetchRemoteAppStateFreshness(userId)
  if (remote.error) {
    if (failClosed) return blockUnverified(remote.error)
    console.warn('[Sync] Remote freshness check failed — allowing save:', remote.error)
    return {
      allowed: true,
      localFreshnessMs,
      remoteFreshnessMs: remote.remoteFreshnessMs,
      knownRemoteBaselineMs,
      hasRemoteRow: remote.hasRemoteRow,
    }
  }

  if (!remote.hasRemoteRow) {
    return { allowed: true, localFreshnessMs, remoteFreshnessMs: 0, knownRemoteBaselineMs, hasRemoteRow: false }
  }

  if (knownRemoteBaselineMs <= 0) {
    console.warn('[Sync] Save/sync blocked — remote row exists but session has no known remote baseline', {
      remoteFreshnessMs: remote.remoteFreshnessMs,
      remoteUpdatedAt: remote.remoteUpdatedAt,
      remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
    })
    return {
      allowed: false,
      blocked: true,
      error: SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG,
      localFreshnessMs,
      remoteFreshnessMs: remote.remoteFreshnessMs,
      knownRemoteBaselineMs: 0,
      hasRemoteRow: true,
    }
  }

  if (remote.remoteFreshnessMs > knownRemoteBaselineMs + FRESHNESS_TOLERANCE_MS) {
    // Phase 4H: same-device local-newer allowance. Before blocking, check whether the
    // remote row was written by THIS device and our local pending state is at least as
    // new as that remote row. That is NOT a stale other-device overwrite — it is this
    // device pushing its own newer local edits over an older/equal cloud copy of its own
    // work (e.g. the server updated_at ticked forward, or a load re-read our own row).
    // This does NOT relax protection: a stale device (local older than remote) or a row
    // written by a DIFFERENT device still falls through and blocks.
    const currentDeviceId = getDeviceId()
    const remoteSavedBy = remote.remoteSavedBy ?? null
    const localAtLeastAsNewAsRemote = localFreshnessMs >= remote.remoteFreshnessMs - FRESHNESS_TOLERANCE_MS
    if (remoteSavedBy && remoteSavedBy === currentDeviceId && localAtLeastAsNewAsRemote) {
      return {
        allowed: true,
        localFreshnessMs,
        remoteFreshnessMs: remote.remoteFreshnessMs,
        knownRemoteBaselineMs,
        hasRemoteRow: true,
      }
    }

    console.warn('[Sync] Save/sync blocked — remote advanced since session baseline', {
      localFreshnessMs,
      knownRemoteBaselineMs,
      remoteFreshnessMs: remote.remoteFreshnessMs,
      knownRemoteBaselineAt: _lastKnownRemoteSavedAt,
      localLastSavedAt: local?._lastSavedAt,
      remoteUpdatedAt: remote.remoteUpdatedAt,
      remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
    })
    return {
      allowed: false,
      blocked: true,
      error: REMOTE_FRESHER_THAN_LOCAL_MSG,
      localFreshnessMs,
      remoteFreshnessMs: remote.remoteFreshnessMs,
      knownRemoteBaselineMs,
      hasRemoteRow: true,
    }
  }

  return {
    allowed: true,
    localFreshnessMs,
    remoteFreshnessMs: remote.remoteFreshnessMs,
    knownRemoteBaselineMs,
    hasRemoteRow: true,
  }
}

function getSaveEnvironment(): 'localhost' | 'production' {
  if (typeof window === 'undefined') return 'production'
  const host = window.location.hostname
  return host === 'localhost' || host === '127.0.0.1' ? 'localhost' : 'production'
}

export function isLocalDevOrigin(): boolean {
  return getSaveEnvironment() === 'localhost'
}

type MergeableRecord = { id?: string; updatedAt?: string }

function mergeArrayByIdPreferNewer<T extends MergeableRecord>(remoteList: T[], localList: T[]): T[] {
  const byId = new Map<string, T>()
  const noId: T[] = []
  for (const item of remoteList) {
    const id = String(item?.id || '').trim()
    if (id) byId.set(id, item)
    else noId.push(item)
  }
  for (const item of localList) {
    const id = String(item?.id || '').trim()
    if (!id) {
      noId.push(item)
      continue
    }
    const existing = byId.get(id)
    if (!existing) {
      byId.set(id, item)
      continue
    }
    const localMs = parseBackupTimestampMs(item.updatedAt)
    const remoteMs = parseBackupTimestampMs(existing.updatedAt)
    byId.set(id, localMs >= remoteMs ? item : existing)
  }
  return [...byId.values(), ...noId]
}

function mergeBlueprintSummariesObject(remoteRaw: any, localRaw: any): Record<string, unknown> {
  const remote = remoteRaw && typeof remoteRaw === 'object' ? remoteRaw : {}
  const local = localRaw && typeof localRaw === 'object' ? localRaw : {}
  const merged: Record<string, unknown> = { ...remote }

  for (const [key, localVal] of Object.entries(local)) {
    if (key === 'operationsBlueprintAnnotations') {
      const remoteAnn = (merged[key] && typeof merged[key] === 'object') ? merged[key] as Record<string, unknown[]> : {}
      const localAnn = (localVal && typeof localVal === 'object') ? localVal as Record<string, unknown[]> : {}
      const setIds = new Set([...Object.keys(remoteAnn), ...Object.keys(localAnn)])
      const nextAnn: Record<string, unknown[]> = { ...remoteAnn }
      for (const setId of setIds) {
        nextAnn[setId] = mergeArrayByIdPreferNewer(
          Array.isArray(remoteAnn[setId]) ? remoteAnn[setId] as MergeableRecord[] : [],
          Array.isArray(localAnn[setId]) ? localAnn[setId] as MergeableRecord[] : [],
        )
      }
      merged[key] = nextAnn
    } else if (key === 'operationsBlueprintScopeLayers') {
      const remoteLayers = (merged[key] && typeof merged[key] === 'object') ? merged[key] as Record<string, unknown> : {}
      const localLayers = (localVal && typeof localVal === 'object') ? localVal as Record<string, unknown> : {}
      merged[key] = { ...remoteLayers, ...localLayers }
    } else {
      merged[key] = localVal
    }
  }
  return merged
}

function mergeLocalChangesIntoRemote(
  remote: BackupData,
  local: BackupData,
  changedKeys: Set<string>,
): BackupData {
  const merged = JSON.parse(JSON.stringify(remote)) as BackupData
  const arrayKeys = new Set([
    'serviceLogs', 'serviceLeads', 'logs', 'projects', 'gcContacts', 'employees',
    'templates', 'triggerRules', 'agendaSections', 'completedArchive',
    'activeServiceCalls', 'serviceEstimates', 'taskSchedule', 'dailyJobs',
    'weeklyReviews', 'imports', 'customers', 'priceBook',
  ])
  const objectKeys = new Set(['settings', 'calcRefs', 'projectDashboards'])

  for (const key of changedKeys) {
    if (!(key in local)) continue
    const localVal = (local as any)[key]
    if (key === 'blueprintSummaries') {
      ;(merged as any)[key] = mergeBlueprintSummariesObject((remote as any)[key], localVal)
    } else if (arrayKeys.has(key) && Array.isArray(localVal)) {
      const remoteArr = Array.isArray((remote as any)[key]) ? (remote as any)[key] : []
      ;(merged as any)[key] = mergeArrayByIdPreferNewer(remoteArr, localVal)
    } else if (objectKeys.has(key) && localVal && typeof localVal === 'object' && !Array.isArray(localVal)) {
      ;(merged as any)[key] = { ...((remote as any)[key] || {}), ...localVal }
    } else {
      ;(merged as any)[key] = localVal
    }
  }
  return merged
}

/**
 * Production multi-device path: when remote advanced since session baseline,
 * merge local changed keys into latest remote, advance baseline, then sync.
 * Returns null to fall through to the localhost-style guard block.
 */
async function attemptProductionMergeAndSync(
  userId: string,
  options: SyncToSupabaseOptions,
): Promise<SyncToSupabaseResult | null> {
  if (getSaveEnvironment() === 'localhost') return null

  const local = getBackupData(userId)
  if (!local) return null

  const remote = await fetchRemoteAppStateRow(userId)
  if (remote.error || !remote.hasRemoteRow || !remote.remoteData) return null

  const changedKeys = _changedKeys.size > 0
    ? new Set(_changedKeys)
    : (options.source === 'blueprintSummaries' || String(options.source || '').includes('annotation')
      ? new Set(['blueprintSummaries'])
      : new Set<string>())

  if (changedKeys.size === 0) {
    setKnownRemoteBaseline(remote.remoteUpdatedAt, remote.remoteDataLastSavedAt)
    saveBackupDataSilent(remote.remoteData, userId)
    _dataChanged = false
    _lastSyncedAt = Date.now()
    _lastConflictDispatch = null
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('poweron:sync-success', {
        detail: {
          savedBy: ((remote.remoteData as any)?._syncMeta as any)?.savedBy,
          savedAt: remote.remoteDataLastSavedAt || remote.remoteUpdatedAt,
          merged: true,
        },
      }))
    }
    return { success: true, skipped: true }
  }

  const merged = mergeLocalChangesIntoRemote(remote.remoteData, local, changedKeys)
  setKnownRemoteBaseline(remote.remoteUpdatedAt, remote.remoteDataLastSavedAt)
  merged._lastSavedAt = new Date().toISOString()
  saveBackupData(merged)

  console.log('[Sync] Production merge-before-save', {
    source: options.source || 'sync',
    changedKeys: [...changedKeys],
  })

  return syncToSupabase(userId, {
    ...options,
    _skipProductionMerge: true,
    source: options.source ? `${options.source}-production-merge` : 'production-merge',
  })
}

function resolveSyncGuardError(freshness: {
  error?: string
  localFreshnessMs: number
  remoteFreshnessMs: number
  knownRemoteBaselineMs: number
  hasRemoteRow: boolean
}): string {
  if (freshness.error === SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG) {
    return SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG
  }
  if (freshness.hasRemoteRow && freshness.knownRemoteBaselineMs <= 0) {
    return SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG
  }
  if (
    freshness.hasRemoteRow &&
    freshness.remoteFreshnessMs > freshness.knownRemoteBaselineMs + FRESHNESS_TOLERANCE_MS
  ) {
    return getSaveEnvironment() === 'localhost'
      ? LOCALHOST_STALE_SNAPSHOT_BLOCKED_MSG
      : SYNC_BLOCKED_REMOTE_NEWER_MSG
  }
  return freshness.error || REMOTE_FRESHNESS_UNKNOWN_MSG
}

/** Reliable machine-readable classification of a stale-overwrite guard block, mirroring
 *  resolveSyncGuardError's branches. Step 13B-QA5-R4 Part 1 -- lets UI listeners tell a
 *  "remote is newer / can't prove freshness" safety pause apart from a real sync failure
 *  without parsing message text. dispatchSyncConflict is only ever called from this guard,
 *  never from a network/auth/unknown error, so every event it fires is one of these three. */
export type SyncConflictCode = 'remote-newer' | 'no-baseline' | 'unknown'
function resolveSyncGuardCode(freshness: {
  error?: string
  knownRemoteBaselineMs: number
  remoteFreshnessMs: number
  hasRemoteRow: boolean
}): SyncConflictCode {
  if (freshness.error === SYNC_BLOCKED_NO_REMOTE_BASELINE_MSG) return 'no-baseline'
  if (freshness.hasRemoteRow && freshness.knownRemoteBaselineMs <= 0) return 'no-baseline'
  if (
    freshness.hasRemoteRow &&
    freshness.remoteFreshnessMs > freshness.knownRemoteBaselineMs + FRESHNESS_TOLERANCE_MS
  ) return 'remote-newer'
  return 'unknown'
}

// Step 13B-QA5-R4 Part 5: source-level dedupe for identical unresolved stale-overwrite
// conflicts. Without this, an active periodic-sync loop (every SYNC_INTERVAL_MS while
// local edits keep coming in and remote stays newer) re-dispatches the exact same guard
// block every ~13s. Suppress repeats of the identical message for 20 minutes (matching
// the UI-side toast throttle window) -- a genuinely different conflict message is never
// suppressed, since the dedupe key is the exact message string. Cleared on the next
// successful sync (see syncToSupabase's poweron:sync-success dispatch below) so a real
// resolution is picked up immediately rather than waiting out the window.
const CONFLICT_DISPATCH_DEDUPE_MS = 20 * 60 * 1000 // 20 minutes
let _lastConflictDispatch: { message: string; at: number } | null = null

function dispatchSyncConflict(error: string, source?: string, code?: SyncConflictCode): void {
  if (typeof window === 'undefined') return
  const prev = _lastConflictDispatch
  if (prev && prev.message === error && Date.now() - prev.at < CONFLICT_DISPATCH_DEDUPE_MS) return
  _lastConflictDispatch = { message: error, at: Date.now() }
  window.dispatchEvent(new CustomEvent('poweron:sync-conflict', {
    detail: { error, source: source || 'sync', conflictCode: code || 'unknown' },
  }))
}

/**
 * Phase 5A: dev-only warning when a sync save carries no resolvable scope. Never
 * throws, never blocks, never mutates data, and is stripped/no-op in production
 * (guarded by import.meta.env.DEV). Future phases will require a DataScope here.
 */
function warnIfUnscopedSyncSave(
  changedKey?: string | null,
  scopes?: DataScope[],
  callerHint?: string,
): void {
  try {
    if (!import.meta.env.DEV) return
    if (scopes && scopes.length > 0) return
    if (changedKey) return // legacy key present but unmapped — still informative, but not "unscoped"
    console.warn(
      '[ScopeRegistry] Unscoped sync save detected. Future phases will require a DataScope.',
      { changedKey: changedKey ?? null, source: callerHint ?? null },
    )
  } catch { /* dev-only diagnostics must never affect runtime */ }
}

function resolveSyncOptionsForChangedKey(
  changedKey?: string,
  syncOptions?: SyncToSupabaseOptions,
): SyncToSupabaseOptions {
  const inferred: SyncToSupabaseOptions =
    changedKey === 'snapshotRestore'
      ? { allowOverwriteNewerRemote: true, source: 'snapshot-restore' }
      : { source: changedKey }
  const merged = { ...inferred, ...syncOptions }

  // Phase 5A metadata only — resolve scopes for logging. Does NOT change source,
  // allowOverwriteNewerRemote, requireFreshRemote, or any sync behavior. `_scopes`
  // is internal option metadata only; it is never written into BackupData nor sent
  // to Supabase (syncToSupabase reads only guard-related option fields).
  const resolvedScopes = resolveScopesForSyncInput(merged.source ?? changedKey ?? null)
  merged._scopes = resolvedScopes
  warnIfUnscopedSyncSave(changedKey ?? null, resolvedScopes, merged.source)
  return merged
}

export function setCacheOwner(userId: string): void {
  try { localStorage.setItem(CACHE_OWNER_KEY, userId) } catch {}
}
export function getCacheOwner(): string | null {
  try { return localStorage.getItem(CACHE_OWNER_KEY) } catch { return null }
}
export function clearCacheOwner(): void {
  try { localStorage.removeItem(CACHE_OWNER_KEY) } catch {}
}

// ── Hydration guard ───────────────────────────────────────────────────────────
// When true, all Supabase writes are blocked. Set to true during login bootstrap
// and false once tenant data is fully hydrated. Prevents empty seed or stale
// local state from overwriting real Supabase data during account switching.
// Legacy hydration flag kept for backward compatibility/debugging only.
// Tenant readiness below is the actual sync guard.
let _isHydrating = false
export function setHydrating(val: boolean): void { 
  _isHydrating = val 
  console.log('[Hydration] flag set to:', val)
}
export function isHydrating(): boolean { return _isHydrating }

/**
 * Phase 6S-B: true when a sync save is a weeklyData save (the MoneyPanel recalc /
 * finance.weeklyData scope). Used to SKIP the weeklyData preservation guard for
 * those saves so a legitimate weekly recalc is not merged against itself.
 */
function isWeeklyDataSyncSource(source?: string | null): boolean {
  if (!source) return false
  if (String(source).toLowerCase().includes('weeklydata')) return true
  try {
    return resolveScopesForSyncInput(source).includes('finance.weeklyData')
  } catch {
    return false
  }
}

/**
 * Phase 6S-C: true when a sync save is an employees/team.members save (Team CRUD).
 * Used to SKIP the employees preservation guard for those saves so a legitimate
 * roster edit is not merged against itself.
 */
function isEmployeesSyncSource(source?: string | null): boolean {
  if (!source) return false
  const s = String(source).toLowerCase()
  if (s.includes('employee') || s.includes('team.members') || s.includes('team-members')) return true
  try {
    return resolveScopesForSyncInput(source).includes('team.members')
  } catch {
    return false
  }
}

/**
 * Phase 6S-D1: true when a sync save is a project.timeline save (Phase Timeline
 * tab / deposit edits). Checks `source` substring, `options._scopes`, and the
 * legacy changedKey→scope resolution of `source`. Used to SKIP the
 * project.timeline preservation guard for those saves so a legitimate
 * timeline/deposit edit is not merged against itself.
 */
function isProjectTimelineSyncSource(options?: { source?: string | null; _scopes?: DataScope[] } | null): boolean {
  if (!options) return false
  const source = options.source
  if (source && String(source).toLowerCase().includes('project.timeline')) return true
  if (Array.isArray(options._scopes) && options._scopes.includes('project.timeline')) return true
  try {
    return resolveScopesForSyncInput(source ?? null).includes('project.timeline')
  } catch {
    return false
  }
}

function isProjectProgressSyncSource(options?: { source?: string | null; _scopes?: DataScope[] } | null): boolean {
  if (!options) return false
  const source = options.source
  if (source && String(source).toLowerCase().includes('project.progress')) return true
  if (Array.isArray(options._scopes) && options._scopes.includes('project.progress')) return true
  try {
    return resolveScopesForSyncInput(source ?? null).includes('project.progress')
  } catch {
    return false
  }
}

function isProjectScheduleSyncSource(options?: { source?: string | null; _scopes?: DataScope[] } | null): boolean {
  if (!options) return false
  const source = options.source
  if (source && String(source).toLowerCase().includes('project.schedule')) return true
  if (Array.isArray(options._scopes) && options._scopes.includes('project.schedule')) return true
  try {
    return resolveScopesForSyncInput(source ?? null).includes('project.schedule')
  } catch {
    return false
  }
}

function isProjectCoordinationSyncSource(options?: { source?: string | null; _scopes?: DataScope[] } | null): boolean {
  if (!options) return false
  const source = options.source
  if (source && String(source).toLowerCase().includes('project.coordination')) return true
  if (Array.isArray(options._scopes) && options._scopes.includes('project.coordination')) return true
  try {
    return resolveScopesForSyncInput(source ?? null).includes('project.coordination')
  } catch {
    return false
  }
}

/** Sync current tenant-scoped localStorage data to Supabase app_state table.
 *  Refuses to run until the authenticated tenant has completed bootstrap. */
export async function syncToSupabase(
  userIdOrOptions?: string | SyncToSupabaseOptions,
  maybeOptions?: SyncToSupabaseOptions,
): Promise<SyncToSupabaseResult> {
  let userId = _activeTenantUserId
  let options: SyncToSupabaseOptions = {}

  if (typeof userIdOrOptions === 'string') {
    userId = userIdOrOptions
    options = maybeOptions ?? {}
  } else if (userIdOrOptions && typeof userIdOrOptions === 'object') {
    options = userIdOrOptions
  }

  if (!isSupabaseConfigured()) return { success: false, skipped: true, error: 'Supabase not configured' }
  if (!userId) return { success: false, skipped: true, error: 'No active tenant user' }
  if (!_tenantDataReady || _activeTenantUserId !== userId) {
  const localTenantData = getBackupData(userId)
  if (localTenantData && tenantOwnerMatches(localTenantData as any, userId)) {
    _activeTenantUserId = userId
    _tenantDataReady = true
    console.warn('[Sync] Recovered tenant readiness from local tenant cache', { userId })
  } else {
    console.warn('[Sync] BLOCKED: tenant data not ready', { active: _activeTenantUserId, userId, ready: _tenantDataReady })
    return { success: false, skipped: true, error: 'Tenant data not ready' }
  }
}
  if (_isHydrating) {
    console.warn('[Sync] BLOCKED by hydration flag — this should clear after login')
    return { success: false, skipped: true, error: 'Hydration in progress' }
  }

  // Phase 2 (stop-bleeding): the stale-overwrite freshness guard runs in
  // production AND localhost. A stale session (remote advanced past this
  // session's known baseline) is BLOCKED before it can overwrite newer cloud
  // data. No automatic merge — attemptProductionMergeAndSync is intentionally
  // NOT called (its whole-object merge could clobber nested project data such
  // as RFIs). Block-only; user must reload latest before syncing.
  const guardEnabled = !options.allowOverwriteNewerRemote && options.requireFreshRemote !== false
  if (guardEnabled) {
    const failClosed = options.failClosed !== false
    const freshness = await checkManualSaveFreshness(userId, { failClosed })
    if (!freshness.allowed) {
      const error = resolveSyncGuardError(freshness)
      const code = resolveSyncGuardCode(freshness)
      console.warn('[Sync] Cloud write blocked by stale-overwrite guard', {
        source: options.source || 'sync',
        localFreshnessMs: freshness.localFreshnessMs,
        knownRemoteBaselineMs: freshness.knownRemoteBaselineMs,
        remoteFreshnessMs: freshness.remoteFreshnessMs,
        error,
        code,
        environment: getSaveEnvironment(),
      })
      dispatchSyncConflict(error, options.source, code)
      return {
        success: false,
        blocked: true,
        conflict: true,
        error,
      }
    }
  }

  try {
    const { supabase } = await import('@/lib/supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, skipped: true, error: 'Not authenticated' }
    if (user.id !== userId) {
      console.error('[Sync] BLOCKED: Supabase user mismatch', { sessionUser: user.id, activeTenant: userId })
      return { success: false, skipped: true, error: 'Authenticated user mismatch' }
    }

    const data = getBackupData(userId)
    if (!data) return { success: false, skipped: true, error: 'No local tenant data to sync' }

    // Phase 6S-B / 6S-C / 6S-D1 / 6S-D2 / 6S-D3 / 6S-D4: narrow scoped-cache preservation guards. For a save
    // that is NOT a weeklyData save, fold newer remote weeklyData[] into the
    // outgoing blob; for a save that is NOT an employees save, fold newer remote
    // employees[] in; for a save that is NOT a project.timeline save, fold newer
    // remote phase_timeline/deposit data in; for a save that is NOT a
    // project.schedule save, fold newer remote plannedStart/plannedEnd/lastMove
    // in; for a save that is NOT a project.coordination save, fold newer remote
    // coordination rows in. This stops a stale local weeklyData/employees/timeline/schedule/coord cache
    // from overwriting newer remote data on an unrelated broad save. Only
    // weeklyData[]/employees[]/projects[].phase_timeline + deposit_pct +
    // phase_deposit_pct + timelineUpdatedAt + schedule fields + coord fields are affected (the merge
    // helpers touch nothing else); manualOverride / tombstone precedence still
    // applies. A single remote fetch serves all folds; on failure we warn and
    // continue with the un-merged blob — the guard never blocks a save.
    let outgoing: BackupData = data
    const skipWeeklyGuard = isWeeklyDataSyncSource(options.source)
    const skipEmployeesGuard = isEmployeesSyncSource(options.source)
    const skipTimelineGuard = isProjectTimelineSyncSource(options)
    const skipProgressGuard = isProjectProgressSyncSource(options)
    const skipScheduleGuard = isProjectScheduleSyncSource(options)
    const skipCoordinationGuard = isProjectCoordinationSyncSource(options)
    if (!skipWeeklyGuard || !skipEmployeesGuard || !skipTimelineGuard || !skipProgressGuard || !skipScheduleGuard || !skipCoordinationGuard) {
      try {
        const remoteSnapshot = await fetchLatestRemoteBackup(userId)
        if (remoteSnapshot?.remoteData) {
          if (!skipWeeklyGuard) {
            outgoing = mergeRemoteWeeklyDataIntoOutgoing(outgoing, remoteSnapshot.remoteData)
          }
          if (!skipEmployeesGuard) {
            outgoing = mergeRemoteEmployeesIntoOutgoing(outgoing, remoteSnapshot.remoteData)
          }
          if (!skipTimelineGuard) {
            outgoing = mergeRemoteProjectTimelineIntoOutgoing(outgoing, remoteSnapshot.remoteData)
          }
          if (!skipProgressGuard) {
            outgoing = mergeRemoteProjectProgressIntoOutgoing(outgoing, remoteSnapshot.remoteData)
          }
          if (!skipScheduleGuard) {
            outgoing = mergeRemoteProjectScheduleIntoOutgoing(outgoing, remoteSnapshot.remoteData)
          }
          if (!skipCoordinationGuard) {
            outgoing = mergeRemoteProjectCoordinationIntoOutgoing(outgoing, remoteSnapshot.remoteData)
          }
        }
      } catch (preserveGuardErr) {
        console.warn('[Sync] scoped preservation guard skipped (remote fetch failed)', preserveGuardErr)
      }
    }

    const now = new Date().toISOString()
    const deviceId = getDeviceId()

    const payload = attachTenantOwner({
      ...(outgoing as any),
      _lastSavedAt: now,
      _syncMeta: { savedBy: deviceId, savedAt: now },
    } as BackupData, userId)
    saveBackupDataSilent(payload, userId)

    const { data: writtenRow, error } = await supabase
      .from('app_state')
      .upsert({
        user_id: userId,
        state_key: SUPABASE_STATE_KEY,
        data: payload,
        updated_at: now,
      }, { onConflict: 'user_id,state_key' })
      .select('updated_at')
      .single()

    if (error) {
      console.error('[Sync] Supabase write failed:', error.message)
      return { success: false, error: error.message }
    }

    // Phase 4B: baseline from the SERVER-authoritative updated_at returned by the
    // upsert, not the client `now`. The app_state.updated_at column is set
    // server-side (moddatetime trigger), so it can be slightly newer than the
    // client `now` we sent. Baselining from client `now` made the next freshness
    // check read a newer server updated_at and false-block ("remote is newer")
    // right after this same session's successful write. Fall back to `now` if the
    // upsert did not return a row. Only the baseline uses serverUpdatedAt; the
    // payload's _lastSavedAt and _syncMeta.savedAt stay client `now`.
    const serverUpdatedAt = writtenRow?.updated_at ? String(writtenRow.updated_at) : now
    _lastSyncMeta = { savedBy: deviceId, savedAt: now }
    setKnownRemoteBaseline(serverUpdatedAt, now)
    // A real success resolves any prior stale-overwrite conflict -- let the next
    // one (if any) dispatch immediately rather than staying throttled.
    _lastConflictDispatch = null
    console.log(`[Sync] Synced tenant ${userId} to Supabase at ${now} by ${deviceId}`, options.source ? `(${options.source})` : '')
    if (typeof window !== 'undefined' && !options._suppressSuccessEvent) {
      // Lets UI listeners (e.g. header sync-conflict toast dedupe) know a real
      // cloud sync succeeded, so any suppressed stale-overwrite warning can clear.
      // Phase 4: the verified-save path suppresses this and re-dispatches only
      // after a successful cloud read-back, so success is never shown on write-ACK.
      window.dispatchEvent(new CustomEvent('poweron:sync-success', { detail: { savedBy: deviceId, savedAt: now } }))
    }
    return { success: true }
  } catch (err: any) {
    console.error('[Sync] Supabase sync error:', err)
    return { success: false, error: err?.message || 'Unknown error' }
  }
}

async function hydrateRelationshipAccountsIntoLocalProjection(userId: string): Promise<void> {
  try {
    const { getRelationshipAccountsNormalized } = await import('@/services/relationshipAccountService')
    const relationshipAccounts = await getRelationshipAccountsNormalized()
    if (!Array.isArray(relationshipAccounts) || relationshipAccounts.length === 0) return
    const local = getBackupData(userId) || createEmptyBackup()
    const existingGc = Array.isArray((local as any).gcContacts) ? (local as any).gcContacts : []
    const deletedRelationshipAccounts = Array.isArray((local as any)._deletedRelationshipAccounts)
     ? (local as any)._deletedRelationshipAccounts
     : []
    const mergedGcContacts = relationshipAccountsToGcContacts(relationshipAccounts, existingGc, deletedRelationshipAccounts)
    ;(local as any).gcContacts = mergedGcContacts
      saveBackupDataSilent(local as BackupData, userId)

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('storage'))
        window.dispatchEvent(new Event('poweron-data-saved'))
        window.dispatchEvent(new CustomEvent('poweron-relationship-accounts-hydrated', {
        detail: {
        userId,
        count: mergedGcContacts.length,
        source: 'relationship_accounts',
    },
  }))
}

console.log(`[Sync] Hydrated relationship_accounts into gcContacts projection (${mergedGcContacts.length} accounts)`)
  } catch (err) {
    console.warn('[Sync] relationship_accounts projection hydration failed', err)
  }
}

/**
 * Load backup from Supabase for one explicit tenant.
 * During login/bootstrap this function is read-only against Supabase:
 * remote row wins if present; no row creates a local-only empty cache.
 */
export async function loadFromSupabase(userIdOrForceRemote?: string | boolean, maybeForceRemote = false): Promise<{ success: boolean; merged: boolean; fromDevice?: string; error?: string; status?: 'loaded_remote' | 'seeded_empty' | 'failed' }> {
  const explicitUserId = typeof userIdOrForceRemote === 'string' ? userIdOrForceRemote : null
  const forceRemote = typeof userIdOrForceRemote === 'boolean' ? userIdOrForceRemote : maybeForceRemote
  if (!isSupabaseConfigured()) return { success: false, merged: false, status: 'failed', error: 'Supabase not configured' }
  if (_isHydrating && forceRemote) {
    console.log('[Sync] Realtime load blocked — hydration in progress')
    return { success: false, merged: false, status: 'failed', error: 'Hydration in progress' }
  }

  try {
    const { supabase } = await import('@/lib/supabase')
    const thisDevice = getDeviceId()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, merged: false, status: 'failed', error: 'Not authenticated' }

    const userId = explicitUserId || _activeTenantUserId || user.id
    if (user.id !== userId) {
      console.error('[Sync] loadFromSupabase blocked: user mismatch', { requested: userId, sessionUser: user.id })
      return { success: false, merged: false, status: 'failed', error: 'Authenticated user mismatch' }
    }

    setActiveTenantUser(userId)

    const { data: row, error } = await supabase
      .from('app_state')
      .select('user_id,data,updated_at')
      .eq('user_id', userId)
      .eq('state_key', SUPABASE_STATE_KEY)
      .maybeSingle()

    if (error) {
      console.warn('[Sync] Supabase read failed:', error.message)
      return { success: false, merged: false, status: 'failed', error: error.message }
    }

    if (row?.user_id && row.user_id !== userId) {
      return { success: false, merged: false, status: 'failed', error: 'Supabase returned wrong tenant row' }
    }

    if (!row || !row.data) {
      console.log('[Sync] No remote data found — seeding tenant-local empty cache only')
      const empty = attachTenantOwner(createEmptyBackup(), userId)
      saveBackupDataSilent(empty, userId)
      markTenantDataReady(userId)
      await hydrateRelationshipAccountsIntoLocalProjection(userId)
      return { success: true, merged: false, status: 'seeded_empty' }
    }

    const remote = attachTenantOwner(row.data as BackupData, userId)

    const remoteMeta = (remote as any)._syncMeta as { savedBy?: string; savedAt?: string } | undefined
    const remoteDevice = remoteMeta?.savedBy || 'unknown'
    _lastSyncMeta = { savedBy: remoteDevice, savedAt: remote._lastSavedAt || row.updated_at || '' }

    const remoteTime = setKnownRemoteBaseline(row.updated_at, remote._lastSavedAt)
    const local = getBackupData(userId)
    const localTime = local ? parseBackupTimestampMs(local._lastSavedAt) : 0

    // Login/bootstrap path (explicit user id): prefer remote, but if this browser already
    // has a newer tenant cache than Supabase (e.g. settings saved locally before periodic
    // sync ran), keep local — same rule as the non-bootstrap merge below.
    if (explicitUserId) {
      if (local && localTime > remoteTime) {
        console.log(`[Sync] Bootstrap: local tenant cache newer than remote — keeping local (${localTime} > ${remoteTime})`)
        markTenantDataReady(userId)
        await hydrateRelationshipAccountsIntoLocalProjection(userId)
        return { success: true, merged: false, fromDevice: remoteDevice, status: 'loaded_remote' }
      }
      saveBackupDataSilent(remote, userId)
      markTenantDataReady(userId)
      await hydrateRelationshipAccountsIntoLocalProjection(userId)
      console.log(`[Sync] Bootstrap loaded tenant ${userId} from Supabase (saved by ${remoteDevice})`)
      return { success: true, merged: true, fromDevice: remoteDevice, status: 'loaded_remote' }
    }

    console.log(`[Sync] This device: ${thisDevice}`)
    console.log(`[Sync] Local timestamp: ${local?._lastSavedAt || 'none'} (${localTime})`)
    console.log(`[Sync] Remote timestamp: ${remote._lastSavedAt || 'none'} (${remoteTime}), saved by: ${remoteDevice}`)

    if (!local) {
      saveBackupDataSilent(remote, userId)
      markTenantDataReady(userId)
      await hydrateRelationshipAccountsIntoLocalProjection(userId)
      console.log('[Sync] No local tenant data – Loading: remote')
      return { success: true, merged: true, fromDevice: remoteDevice, status: 'loaded_remote' }
    }

    if (forceRemote || remoteTime > localTime) {
      if (forceRemote && remoteDevice === thisDevice && localTime > remoteTime) {
        console.log(`[Sync] forceRemote skipped — remote is from this device (${thisDevice})`)
        return { success: true, merged: false }
      }
      saveBackupDataSilent(remote, userId)
      markTenantDataReady(userId)
      await hydrateRelationshipAccountsIntoLocalProjection(userId)
      console.log(`[Sync] Loading remote tenant data (saved by ${remoteDevice})`)
      return { success: true, merged: true, fromDevice: remoteDevice, status: 'loaded_remote' }
    }

    // Local-newer auto-push was the contamination path. Keep local in memory/cache;
    // do not push from load. User actions or explicit Save to Cloud will sync.
    if (localTime > remoteTime) {
      console.log('[Sync] Local tenant cache is newer — keeping local, not pushing during load')
      markTenantDataReady(userId)
      await hydrateRelationshipAccountsIntoLocalProjection(userId)
      return { success: true, merged: false }
    }

    markTenantDataReady(userId)
    await hydrateRelationshipAccountsIntoLocalProjection(userId)
    console.log('[Sync] Timestamps match — no sync needed')
    return { success: true, merged: false }
  } catch (err: any) {
    console.error('[Sync] Supabase load error:', err)
    return { success: false, merged: false, status: 'failed', error: err?.message || 'Unknown error' }
  }
}

/** Enhanced saveBackupData that also syncs to Supabase */
export function saveBackupDataAndSync(
  data: BackupData,
  changedKey?: string,
  syncOptions?: SyncToSupabaseOptions,
): void {
  data._lastSavedAt = new Date().toISOString()
  if (changedKey) markChanged(changedKey)
  _dataChanged = true
  saveBackupData(data)
  const resolvedOptions = resolveSyncOptionsForChangedKey(changedKey, syncOptions)
  syncToSupabase(_activeTenantUserId, resolvedOptions).catch(err => console.warn('[sync] Background sync failed:', err))
  maybeAutoSnapshot('Data saved')
}

export async function saveBackupDataAndSyncNow(
  data: BackupData,
  changedKey?: string,
  syncOptions?: SyncToSupabaseOptions,
): Promise<SyncToSupabaseResult> {
  data._lastSavedAt = new Date().toISOString()
  if (changedKey) markChanged(changedKey)
  _dataChanged = true
  saveBackupData(data)

  const resolvedOptions = resolveSyncOptionsForChangedKey(changedKey, syncOptions)
  const result = await syncToSupabase(_activeTenantUserId, resolvedOptions)

  if (result.success) {
    _dataChanged = false
    _lastSyncedAt = Date.now()
    _changedKeys.clear()
  } else if (result.blocked || result.conflict) {
    console.warn('[sync] Immediate sync blocked — local changes preserved', result.error)
  }

  try {
    maybeAutoSnapshot('Data saved')
  } catch {
    /* snapshot is non-critical */
  }

  return result
}

export type SaveBackupWithRemoteBaselineResult = SyncToSupabaseResult & {
  localSaved: boolean
}

/**
 * Save a backup built from a freshly fetched remote snapshot + scoped patch.
 * Updates the session remote baseline to the fetched row before guarded sync so
 * the write is treated as continuing from latest remote, not stale local.
 */
export async function saveBackupWithRemoteBaselineSync(
  mergedBackup: BackupData,
  remoteBaseline: { remoteUpdatedAt?: string | null; remoteDataLastSavedAt?: string | null },
  syncOptions?: SyncToSupabaseOptions & { changedKey?: string },
): Promise<SaveBackupWithRemoteBaselineResult> {
  setKnownRemoteBaseline(remoteBaseline.remoteUpdatedAt, remoteBaseline.remoteDataLastSavedAt)

  mergedBackup._lastSavedAt = new Date().toISOString()
  const { changedKey, ...syncOnlyOptions } = syncOptions || {}
  markChanged(changedKey || 'blueprintSummaries')
  _dataChanged = true
  saveBackupData(mergedBackup)

  const result = await syncToSupabase(_activeTenantUserId, {
    ...syncOnlyOptions,
    source: syncOnlyOptions?.source || 'remote-baseline-merge',
  })

  if (result.success) {
    _dataChanged = false
    _lastSyncedAt = Date.now()
    _changedKeys.clear()
  } else if (result.blocked || result.conflict) {
    console.warn('[sync] Remote-baseline merge sync blocked — local merged backup preserved', result.error)
  }

  return { ...result, localSaved: true }
}

export async function fetchLatestRemoteBackup(userId = _activeTenantUserId): Promise<{
  hasRemoteRow: boolean
  remoteUpdatedAt: string | null
  remoteDataLastSavedAt: string | null
  remoteData: BackupData | null
  error?: string
}> {
  if (!userId) {
    return {
      hasRemoteRow: false,
      remoteUpdatedAt: null,
      remoteDataLastSavedAt: null,
      remoteData: null,
      error: 'No active tenant user',
    }
  }
  return fetchRemoteAppStateRow(userId)
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
  // Phase 5A: dev-only unscoped-save warning (this path bypasses resolveSyncOptionsForChangedKey).
  warnIfUnscopedSyncSave(changedKey ?? null, resolveScopesForSyncInput(changedKey ?? null), 'immediate-sync')
  console.log(`[sync] Immediate sync triggered for key: ${changedKey || 'unknown'}`)
  syncToSupabase(_activeTenantUserId, { source: changedKey || 'immediate-sync' })
    .then((result) => {
      if (result.success) {
        _dataChanged = false
        _lastSyncedAt = Date.now()
        _changedKeys.clear()
      } else if (result.blocked || result.conflict) {
        console.warn('[sync] Immediate sync blocked — local changes preserved', result.error)
      }
    })
    .catch(err => console.warn('[sync] Immediate sync failed:', err))
  maybeAutoSnapshot(`Critical update: ${changedKey || 'data'}`)
}

function formatHeaderSaveSnapshotLabel(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `Before Header Save - ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function fetchRemoteAppStateRow(userId: string): Promise<{
  hasRemoteRow: boolean
  remoteUpdatedAt: string | null
  remoteDataLastSavedAt: string | null
  remoteData: BackupData | null
  error?: string
}> {
  if (!isSupabaseConfigured()) {
    return {
      hasRemoteRow: false,
      remoteUpdatedAt: null,
      remoteDataLastSavedAt: null,
      remoteData: null,
      error: 'Supabase not configured',
    }
  }

  try {
    const { supabase } = await import('@/lib/supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return {
        hasRemoteRow: false,
        remoteUpdatedAt: null,
        remoteDataLastSavedAt: null,
        remoteData: null,
        error: 'Not authenticated',
      }
    }
    if (user.id !== userId) {
      return {
        hasRemoteRow: false,
        remoteUpdatedAt: null,
        remoteDataLastSavedAt: null,
        remoteData: null,
        error: 'Authenticated user mismatch',
      }
    }

    const { data: row, error } = await supabase
      .from('app_state')
      .select('user_id,data,updated_at')
      .eq('user_id', userId)
      .eq('state_key', SUPABASE_STATE_KEY)
      .maybeSingle()

    if (error) {
      return {
        hasRemoteRow: false,
        remoteUpdatedAt: null,
        remoteDataLastSavedAt: null,
        remoteData: null,
        error: error.message,
      }
    }

    if (!row) {
      return {
        hasRemoteRow: false,
        remoteUpdatedAt: null,
        remoteDataLastSavedAt: null,
        remoteData: null,
      }
    }

    if (!row.data) {
      return {
        hasRemoteRow: true,
        remoteUpdatedAt: row.updated_at ? String(row.updated_at) : null,
        remoteDataLastSavedAt: null,
        remoteData: null,
        error: 'Remote row exists but data is missing',
      }
    }

    const remoteData = row.data as BackupData
    const remoteDataLastSavedAt = String(remoteData?._lastSavedAt || '') || null
    const remoteUpdatedAt = row.updated_at ? String(row.updated_at) : null
    computeRemoteFreshnessMs(remoteUpdatedAt, remoteDataLastSavedAt)

    return {
      hasRemoteRow: true,
      remoteUpdatedAt,
      remoteDataLastSavedAt,
      remoteData,
    }
  } catch (err: any) {
    return {
      hasRemoteRow: false,
      remoteUpdatedAt: null,
      remoteDataLastSavedAt: null,
      remoteData: null,
      error: err?.message || 'Failed to read remote app_state',
    }
  }
}

/**
 * Create a recoverable safety snapshot before manual header Save overwrites remote data.
 * Captures local session + remote cloud backup (if present). Does not mutate local backup.
 */
export async function createHeaderSaveSafetySnapshot(): Promise<{
  success: boolean
  error?: string
  snapshotId?: string
}> {
  const userId = _activeTenantUserId
  if (!userId) {
    console.warn('[Snapshot] Header save safety snapshot blocked — no active tenant user')
    return { success: false, error: HEADER_SAVE_SNAPSHOT_FAILED_MSG }
  }

  const local = getBackupData(userId)
  if (!local) {
    console.warn('[Snapshot] Header save safety snapshot blocked — no local backup data')
    return { success: false, error: HEADER_SAVE_SNAPSHOT_FAILED_MSG }
  }

  const localClone = JSON.parse(JSON.stringify(local)) as BackupData
  const localLastSavedAt = local._lastSavedAt || null
  const environment = getSaveEnvironment()

  const remote = await fetchRemoteAppStateRow(userId)
  if (remote.error) {
    console.warn('[Snapshot] Header save safety snapshot blocked — remote read failed:', remote.error)
    return { success: false, error: HEADER_SAVE_SNAPSHOT_FAILED_MSG }
  }

  let remoteClone: BackupData | null = null
  if (remote.hasRemoteRow && remote.remoteData) {
    remoteClone = JSON.parse(JSON.stringify(remote.remoteData)) as BackupData
  }

  const now = new Date()
  const snapshotPayload: Record<string, unknown> = {
    snapshotType: 'header-save-safety',
    source: 'header-save',
    environment,
    timestamp: now.toISOString(),
    userId,
    localLastSavedAt,
    remoteUpdatedAt: remote.remoteUpdatedAt,
    remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
    localBeforeSave: localClone,
    remoteBeforeOverwrite: remoteClone,
    restoreData: remoteClone ?? localClone,
  }

  const label = formatHeaderSaveSnapshotLabel(now)
  const description = remoteClone
    ? `Safety snapshot before header Save (${environment}). Includes local session and remote cloud backup.`
    : `Safety snapshot before header Save (${environment}). Local session only — no remote row yet.`

  try {
    const { createSnapshot } = await import('@/services/snapshotService')
    const inserted = await createSnapshot(label, snapshotPayload, description)
    if (!inserted) {
      console.warn('[Snapshot] Header save safety snapshot insert failed')
      return { success: false, error: HEADER_SAVE_SNAPSHOT_FAILED_MSG }
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('poweron:snapshots-refresh'))
    }

    console.log('[Snapshot] Header save safety snapshot created:', inserted.id, label)
    return { success: true, snapshotId: inserted.id }
  } catch (err: any) {
    console.warn('[Snapshot] Header save safety snapshot exception:', err?.message || err)
    return { success: false, error: HEADER_SAVE_SNAPSHOT_FAILED_MSG }
  }
}

/**
 * Force full sync to cloud NOW. Bypasses all debounce/timers.
 * Use for the header "Save" button (with requireFreshRemote) or Settings restore flows.
 * Returns result so UI can show success/failure.
 */
export async function forceSyncToCloud(options?: ForceSyncToCloudOptions): Promise<ForceSyncToCloudResult> {
  const data = getBackupData()
  if (!data) return { success: false, error: 'No local data to sync' }

  // Phase 2 (stop-bleeding): requireFreshRemote guard runs in production AND
  // localhost. A stale header save is blocked before it can overwrite newer
  // cloud data. No merge fallback (attemptProductionMergeAndSync NOT called).
  if (options?.requireFreshRemote) {
    const freshness = await checkManualSaveFreshness(_activeTenantUserId, { failClosed: true })
    if (!freshness.allowed) {
      console.warn('[sync] Force sync blocked by freshness guard', {
        source: options.source || 'manual',
        localFreshnessMs: freshness.localFreshnessMs,
        knownRemoteBaselineMs: freshness.knownRemoteBaselineMs,
        remoteFreshnessMs: freshness.remoteFreshnessMs,
        error: freshness.error,
      })
      return {
        success: false,
        blocked: true,
        error: resolveSyncGuardError(freshness),
      }
    }
  }

  if (options?.createSafetySnapshot) {
    const snapshotResult = await createHeaderSaveSafetySnapshot()
    if (!snapshotResult.success) {
      console.warn('[sync] Force sync blocked — safety snapshot failed', {
        source: options.source || 'manual',
        error: snapshotResult.error,
      })
      return {
        success: false,
        blocked: true,
        error: snapshotResult.error || HEADER_SAVE_SNAPSHOT_FAILED_MSG,
      }
    }
  }

  // Phase 2 (stop-bleeding): the pre-stamp stale-overwrite guard runs in
  // production AND localhost. Production no longer bypasses it. It is only
  // skipped when the caller explicitly opts out of freshness (header Save's
  // requireFreshRemote already ran its own check above; snapshot/restore flows
  // set allowOverwriteNewerRemote). No merge fallback.
  const skipPreStampGuard =
    options?.allowOverwriteNewerRemote === true ||
    options?.requireFreshRemote === true

  if (!skipPreStampGuard) {
    const freshness = await checkManualSaveFreshness(_activeTenantUserId, { failClosed: true })
    if (!freshness.allowed) {
      const error = resolveSyncGuardError(freshness)
      const code = resolveSyncGuardCode(freshness)
      console.warn('[sync] Force sync blocked by stale-overwrite guard', {
        source: options?.source || 'manual',
        localFreshnessMs: freshness.localFreshnessMs,
        knownRemoteBaselineMs: freshness.knownRemoteBaselineMs,
        remoteFreshnessMs: freshness.remoteFreshnessMs,
        error,
        code,
      })
      dispatchSyncConflict(error, options?.source, code)
      return {
        success: false,
        blocked: true,
        error,
      }
    }
  }

  // Update timestamp only after freshness guard and safety snapshot pass (or when not required).
  data._lastSavedAt = new Date().toISOString()
  saveBackupData(data)

  console.log('[sync] Force sync to cloud initiated', options?.source ? `(${options.source})` : '')
  const syncOptions: SyncToSupabaseOptions = {
    source: options?.source,
    allowOverwriteNewerRemote:
      options?.allowOverwriteNewerRemote === true ||
      options?.requireFreshRemote === true ||
      options?.createSafetySnapshot === true,
  }
  const result = await syncToSupabase(_activeTenantUserId, syncOptions)

  if (result.success) {
    _dataChanged = false
    _lastSyncedAt = Date.now()
    _changedKeys.clear()
    // Phase 4D: do NOT re-baseline here. syncToSupabase already set the session
    // baseline from the SERVER-authoritative updated_at returned by the upsert
    // (Phase 4B). The old `setKnownRemoteBaseline(data._lastSavedAt, ...)` call
    // overwrote that correct server baseline with the CLIENT _lastSavedAt, which
    // is older than the server updated_at (moddatetime trigger) — so the next
    // freshness check false-blocked with "remote data is newer than this local
    // session" after a successful forceSyncToCloud (tap-to-retry / settings /
    // snapshot restore). Leaving the syncToSupabase baseline in place fixes it.
    console.log('[sync] Force sync successful at', data._lastSavedAt)
  } else if (result.blocked || result.conflict) {
    return {
      success: false,
      blocked: true,
      error: result.error,
    }
  }

  return result
}

// ── Phase 4: Verified Save (cloud read-back) ─────────────────────────────────
// The header Save button must mean "cloud was read back and verified", not just
// "write request finished". These helpers + saveLiveDataVerified() implement that
// truth contract. No merge logic is used — Phase 2 stale-save blocking is preserved
// and attemptProductionMergeAndSync is NOT called.

/**
 * Cheap, count-based fingerprint of the critical data in a BackupData blob.
 * Deliberately does NOT deep-hash or stringify the whole blob — counts + the
 * save timestamp are enough to catch the real failure modes (dropped/truncated
 * arrays, wrong row, stale write) at negligible cost.
 *
 * RFIs are nested under projects[i].rfis[]. Blueprint annotation sets live under
 * blueprintSummaries.operationsBlueprintAnnotations, and work packages / scope
 * layers under blueprintSummaries.operationsBlueprintScopeLayers.
 */
export interface VerificationSummary {
  projectsCount: number
  logsCount: number
  serviceLogsCount: number
  rfiTotalCount: number
  blueprintAnnotationSetCount: number
  blueprintWorkPackageSetCount: number
  lastSavedAt: string | null
  tenantUserId: string | null
}

export function computeVerificationSummary(
  data: BackupData | null | undefined,
  userId?: string | null,
): VerificationSummary {
  const projects = Array.isArray(data?.projects) ? (data!.projects as any[]) : []
  const logs = Array.isArray(data?.logs) ? (data!.logs as any[]) : []
  const serviceLogs = Array.isArray(data?.serviceLogs) ? (data!.serviceLogs as any[]) : []

  let rfiTotalCount = 0
  for (const p of projects) {
    const rfis = (p as any)?.rfis
    if (Array.isArray(rfis)) rfiTotalCount += getLiveRFIs(rfis, (p as any)?.id).length
  }

  const bp = (data as any)?.blueprintSummaries
  const bpObj = bp && typeof bp === 'object' ? (bp as Record<string, any>) : {}
  const ann = bpObj.operationsBlueprintAnnotations
  const annObj = ann && typeof ann === 'object' ? ann : {}
  const wp = bpObj.operationsBlueprintScopeLayers
  const wpObj = wp && typeof wp === 'object' ? wp : {}

  return {
    projectsCount: projects.length,
    logsCount: logs.length,
    serviceLogsCount: serviceLogs.length,
    rfiTotalCount,
    blueprintAnnotationSetCount: Object.keys(annObj).length,
    blueprintWorkPackageSetCount: Object.keys(wpObj).length,
    lastSavedAt: (data as any)?._lastSavedAt ?? null,
    tenantUserId: userId ?? (data as any)?._tenantUserId ?? null,
  }
}

export interface VerificationComparison {
  verified: boolean
  mismatches: string[]
  expected: VerificationSummary
  actual: VerificationSummary
}

/**
 * Compare an expected (locally-sent) summary against the actual (cloud read-back)
 * summary. All critical counts must match exactly. The cloud lastSavedAt must be
 * at or after the timestamp we stamped/sent — the cloud write path re-stamps its
 * own _lastSavedAt a few ms later, so an exact string match is not required, but a
 * cloud timestamp OLDER than what we sent means our write did not land.
 */
export function compareVerificationSummary(
  expected: VerificationSummary,
  actual: VerificationSummary,
): VerificationComparison {
  const mismatches: string[] = []

  const countKeys: (keyof VerificationSummary)[] = [
    'projectsCount',
    'logsCount',
    'serviceLogsCount',
    'rfiTotalCount',
    'blueprintAnnotationSetCount',
    'blueprintWorkPackageSetCount',
  ]
  for (const key of countKeys) {
    if (expected[key] !== actual[key]) {
      mismatches.push(`${key}: expected ${expected[key]}, cloud has ${actual[key]}`)
    }
  }

  const expectedMs = parseBackupTimestampMs(expected.lastSavedAt)
  const actualMs = parseBackupTimestampMs(actual.lastSavedAt)
  // Allow a small tolerance below the sent timestamp for clock skew; the cloud
  // value should normally be >= what we sent (it re-stamps slightly later).
  if (expectedMs > 0 && actualMs > 0 && actualMs < expectedMs - FRESHNESS_TOLERANCE_MS) {
    mismatches.push(
      `lastSavedAt: cloud (${actual.lastSavedAt}) is older than saved value (${expected.lastSavedAt})`,
    )
  } else if (expectedMs > 0 && actualMs <= 0) {
    mismatches.push('lastSavedAt: cloud row has no _lastSavedAt after save')
  }

  if (
    expected.tenantUserId &&
    actual.tenantUserId &&
    expected.tenantUserId !== actual.tenantUserId
  ) {
    mismatches.push(
      `tenantUserId: expected ${expected.tenantUserId}, cloud has ${actual.tenantUserId}`,
    )
  }

  return { verified: mismatches.length === 0, mismatches, expected, actual }
}

/** Tiny sleep helper for bounded read-back retry (Phase 4F). */
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Phase 4F: classify a NON-verified read-back comparison as either read-back lag
 * (`stale`) or a genuine data mismatch (`mismatch`).
 *
 * The failure we must not mistake for data loss is read-your-write lag: an immediate
 * cloud read can briefly return the PRE-write row, which carries an OLDER _lastSavedAt
 * than the payload we just persisted. Since `expected` is now computed from the actual
 * post-sync payload (its _lastSavedAt equals the value written to the cloud), a read-back
 * whose timestamp is older than expected is proof the read lagged — not proof the cloud
 * lost content. Those are retried and, if they persist, reported as readback-failed.
 *
 * Only when the cloud row carries a CURRENT timestamp (>= what we wrote, within skew
 * tolerance) yet a critical count still differs do we treat it as a true mismatch — the
 * write landed but dropped content. A timestamp-only difference with matching counts is
 * likewise treated as lag, never a mismatch.
 */
function classifyUnverifiedReadback(
  comparison: VerificationComparison,
): 'stale' | 'mismatch' {
  const expectedMs = parseBackupTimestampMs(comparison.expected.lastSavedAt)
  const actualMs = parseBackupTimestampMs(comparison.actual.lastSavedAt)

  // Cloud timestamp older than (or missing relative to) what we just persisted =>
  // the read returned a pre-write / lagged row. Do not call this a data mismatch.
  if (expectedMs > 0 && (actualMs <= 0 || actualMs < expectedMs - FRESHNESS_TOLERANCE_MS)) {
    return 'stale'
  }

  // Cloud timestamp is current — a stable critical-count or tenant difference here
  // means the write actually dropped content.
  const countKeys: (keyof VerificationSummary)[] = [
    'projectsCount',
    'logsCount',
    'serviceLogsCount',
    'rfiTotalCount',
    'blueprintAnnotationSetCount',
    'blueprintWorkPackageSetCount',
  ]
  const countDiffers = countKeys.some(
    k => comparison.expected[k] !== comparison.actual[k],
  )
  const tenantDiffers =
    !!comparison.expected.tenantUserId &&
    !!comparison.actual.tenantUserId &&
    comparison.expected.tenantUserId !== comparison.actual.tenantUserId

  if (countDiffers || tenantDiffers) return 'mismatch'

  // Only a timestamp difference remains with matching counts — treat as lag.
  return 'stale'
}

export type VerifiedSaveStatus =
  | 'saved-verified'
  | 'stale-blocked'
  | 'snapshot-failed'
  | 'cloud-write-failed'
  | 'readback-failed'
  | 'verify-mismatch'
  | 'error'

export interface VerifiedSaveResult {
  status: VerifiedSaveStatus
  error?: string
  comparison?: VerificationComparison
  expected?: VerificationSummary
  actual?: VerificationSummary
}

export type VerifiedSavePhase =
  | 'checking-cloud'
  | 'creating-snapshot'
  | 'saving'
  | 'verifying'

export interface SaveLiveDataVerifiedOptions {
  source?: string
  /** Optional progress callback so the UI can show the current phase truthfully. */
  onPhase?: (phase: VerifiedSavePhase) => void
}

/**
 * Header Save truth contract (Phase 4):
 * 1. read current local backup + compute expected summary
 * 2. freshness/stale check (Phase 2 guard) — stale => blocked, no write
 * 3. before-save safety snapshot — failure => blocked, no write
 * 4. write to cloud (existing guarded upsert; success event suppressed)
 * 5. read the cloud row back
 * 6. recompute summary from read-back and compare
 * 7. advance baseline ONLY from the verified read-back row
 * 8. success ONLY after verification
 *
 * Never calls attemptProductionMergeAndSync. Never merges. On any non-verified
 * outcome the session baseline is restored to its pre-write value so a later save
 * cannot slip through the stale guard on an unproven write.
 */
export async function saveLiveDataVerified(
  options?: SaveLiveDataVerifiedOptions,
): Promise<VerifiedSaveResult> {
  const source = options?.source || 'header-save-verified'
  const onPhase = options?.onPhase
  const userId = _activeTenantUserId

  if (!isSupabaseConfigured()) return { status: 'error', error: 'Supabase not configured' }
  if (!userId) return { status: 'error', error: 'No active tenant user' }

  // a. Read current local backup for this tenant.
  const local = getBackupData(userId)
  if (!local) return { status: 'error', error: 'No local data to save' }

  // c. Freshness / stale-overwrite guard (same check Phase 2 enforces). Runs in
  //    production AND localhost. Stale => block before any write, no merge.
  onPhase?.('checking-cloud')
  const freshness = await checkManualSaveFreshness(userId, { failClosed: true })
  if (!freshness.allowed) {
    return { status: 'stale-blocked', error: resolveSyncGuardError(freshness) }
  }

  // e. Before-save safety snapshot. Failure blocks the write.
  onPhase?.('creating-snapshot')
  const snapshotResult = await createHeaderSaveSafetySnapshot()
  if (!snapshotResult.success) {
    return {
      status: 'snapshot-failed',
      error: snapshotResult.error || HEADER_SAVE_SNAPSHOT_FAILED_MSG,
    }
  }

  // Capture the pre-write baseline so we can restore it if the save is not verified.
  const preBaseline = _lastKnownRemoteSavedAt

  // g. Stamp save timestamp and h. persist local copy via the existing safe helper.
  //    This is only write preparation — the authoritative _lastSavedAt is re-stamped
  //    inside syncToSupabase() (see below), so the expected summary is NOT taken here.
  const saveTimestamp = new Date().toISOString()
  local._lastSavedAt = saveTimestamp
  saveBackupData(local)

  // i. Write to Supabase. We already gated freshness above, so allow the overwrite
  //    on the final upsert (matches the header force-sync semantics). Suppress the
  //    optimistic success event — we only claim success after read-back verifies.
  onPhase?.('saving')
  const writeResult = await syncToSupabase(userId, {
    source,
    allowOverwriteNewerRemote: true,
    _suppressSuccessEvent: true,
  })
  if (!writeResult.success) {
    // The write never landed — nothing was persisted to the cloud, so roll the
    // session baseline back to its pre-write value.
    _lastKnownRemoteSavedAt = preBaseline
    return {
      status: 'cloud-write-failed',
      error: writeResult.error || 'Cloud write failed',
    }
  }

  // b. Phase 4F: compute the expected summary from the payload syncToSupabase actually
  //    persisted. syncToSupabase re-stamps _lastSavedAt to its own `now` (T1, a few ms
  //    after the T0 stamp above) and writes that payload back to localStorage via
  //    saveBackupDataSilent(). Re-reading it here means expected._lastSavedAt equals the
  //    exact value written to the cloud, so an immediate read-back should match — no
  //    false timestamp mismatch from comparing against the stale pre-sync T0 value.
  const postSyncLocal = getBackupData(userId)
  const expected = computeVerificationSummary(postSyncLocal ?? local, userId)

  // j. Read the cloud row back and verify. A single immediate read can briefly return
  //    the PRE-write row (read-your-write lag), so retry a few times before deciding.
  onPhase?.('verifying')
  const MAX_READBACK_ATTEMPTS = 3
  const READBACK_RETRY_DELAY_MS = 300
  let lastComparison: VerificationComparison | null = null
  let lastReadbackError: string | undefined
  let verifiedRemote: Awaited<ReturnType<typeof fetchRemoteAppStateRow>> | null = null

  for (let attempt = 1; attempt <= MAX_READBACK_ATTEMPTS; attempt++) {
    const remote = await fetchRemoteAppStateRow(userId)

    if (remote.error || !remote.hasRemoteRow || !remote.remoteData) {
      // Read-back could not return usable data this attempt.
      lastReadbackError = remote.error || 'Could not read cloud data back to verify the save'
      lastComparison = null
      if (attempt < MAX_READBACK_ATTEMPTS) { await wait(READBACK_RETRY_DELAY_MS); continue }
      break
    }

    // k. Actual summary from the read-back cloud data. l. Compare.
    const actual = computeVerificationSummary(remote.remoteData, userId)
    const comparison = compareVerificationSummary(expected, actual)
    lastComparison = comparison
    lastReadbackError = undefined

    if (comparison.verified) { verifiedRemote = remote; break }

    // Not verified yet. If it is only read-back lag (older/stale row), retry; a stable
    // critical-count difference is a real mismatch and needs no further retries.
    if (attempt < MAX_READBACK_ATTEMPTS && classifyUnverifiedReadback(comparison) === 'stale') {
      await wait(READBACK_RETRY_DELAY_MS)
      continue
    }
    break
  }

  // Read-back never returned usable cloud data after retries. The write ACK succeeded,
  // so this is unproven-but-likely-saved read-back lag, NOT proof of lost data. Do not
  // claim success, but do NOT roll the baseline back — syncToSupabase already advanced
  // it from the server-authoritative updated_at, and rolling back here would falsely
  // stale-block the very next save (the Phase 4E false-block loop).
  if (!lastComparison) {
    return {
      status: 'readback-failed',
      error: lastReadbackError || 'Could not read cloud data back to verify the save',
    }
  }

  if (!verifiedRemote) {
    const kind = classifyUnverifiedReadback(lastComparison)
    if (kind === 'mismatch') {
      // True, stable critical-count/tenant difference against a CURRENT cloud row —
      // the write landed but dropped content. Protect the baseline (roll back so the
      // next save re-checks freshness) and report a real mismatch.
      _lastKnownRemoteSavedAt = preBaseline
      console.warn('[VerifiedSave] Cloud read-back shows a stable data mismatch', lastComparison.mismatches)
      return {
        status: 'verify-mismatch',
        comparison: lastComparison,
        expected,
        actual: lastComparison.actual,
      }
    }
    // Stale/lagged read-back only (timestamp older, counts effectively matching). The
    // write ACK succeeded, so treat as unverified readback-failed rather than a data
    // mismatch, and keep the write-ACK baseline to avoid the next-save false-block loop.
    console.warn('[VerifiedSave] Cloud read-back lagged; write ACKed but not yet verified', lastComparison.mismatches)
    return {
      status: 'readback-failed',
      error: 'Cloud save was written but could not be confirmed yet (read-back lagged). Your data was sent to the cloud.',
      comparison: lastComparison,
      expected,
      actual: lastComparison.actual,
    }
  }

  const remote = verifiedRemote
  const actual = lastComparison.actual

  // m. Verified: advance baseline from the READ-BACK row (authoritative), clear
  //    dirty state, and dispatch the success event now (not on write-ACK).
  setKnownRemoteBaseline(remote.remoteUpdatedAt, remote.remoteDataLastSavedAt)
  _dataChanged = false
  _lastSyncedAt = Date.now()
  _changedKeys.clear()
  _lastConflictDispatch = null
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('poweron:sync-success', {
        detail: {
          savedBy: (remote.remoteData as any)?._syncMeta?.savedBy,
          savedAt: remote.remoteDataLastSavedAt || remote.remoteUpdatedAt,
          verified: true,
        },
      }),
    )
  }
  console.log('[VerifiedSave] Save verified against cloud read-back', {
    source,
    remoteUpdatedAt: remote.remoteUpdatedAt,
    projectsCount: actual.projectsCount,
    rfiTotalCount: actual.rfiTotalCount,
  })
  return { status: 'saved-verified', comparison: lastComparison, expected, actual }
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
  // DASHBOARD-CFOT-COLLECTION-PATH-PARITY-APR22-2026-1 — read paid from logs via
  // getProjectFinancials, not the p.paid scalar. Scalar is no longer written to.
  return (backup.projects || []).filter(p => {
    const paidDerived = getProjectFinancials(p, backup).paid
    return p.billed > 0 || paidDerived > 0
  }).map((p, i) => {
    const paidDerived = getProjectFinancials(p, backup).paid
    return {
      id: `inv-${p.id}`, invoice_number: `INV-${String(i + 1).padStart(4, '0')}`,
      client_id: null, total: p.billed || p.contract || 0,
      balance_due: (p.billed || 0) - paidDerived,
      status: paidDerived >= p.billed && p.billed > 0 ? 'paid' : paidDerived > 0 ? 'partial' : 'sent',
      days_overdue: 0, due_date: null, created_at: backup._lastSavedAt || new Date().toISOString(),
      project_name: p.name,
    }
  })
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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase
      .from('app_state')
      .upsert({
        user_id: user.id,
        state_key: 'poweron_snapshots',
        data: allSnapshots,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,state_key' })
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
