// @ts-nocheck
/**
 * milestoneBackupService.ts — PowerOn Hub B21
 *
 * THREE CAPABILITIES:
 * 1. Change-triggered auto-snapshots (via agentBus or direct call)
 * 2. Manual milestone creation + CSV/JSON export
 * 3. Restore interface data layer (list, filter, restore from snapshot)
 *
 * Does NOT touch backupDataService.ts.
 * Writes to existing Supabase `snapshots` table.
 * trigger_event and size_bytes are stored as JSON inside the `description` field
 * so no schema migration is required.
 */

import { supabase } from '@/lib/supabase'

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_AUTO_SNAPSHOTS = 50
const LAST_MILESTONE_KEY = 'poweron_last_milestone_date'
const WEEKLY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

// ── Types ────────────────────────────────────────────────────────────────────

export type TriggerEvent =
  | 'project_created'
  | 'project_updated'
  | 'project_deleted'
  | 'field_log_added'
  | 'service_log_added'
  | 'service_status_changed'
  | 'invoice_created'
  | 'invoice_paid'
  | 'phase_changed'
  | 'lead_status_changed'
  | 'manual'
  | 'weekly_auto'

export type SnapshotFilter = 'all' | 'manual' | 'auto' | 'weekly'

export interface MilestoneSnapshot {
  id: string
  label: string
  trigger_event: TriggerEvent | string
  snapshot_data: Record<string, unknown>
  created_at: string
  size_bytes: number
  is_pinned?: boolean
}

export interface MilestoneSnapshotMeta extends Omit<MilestoneSnapshot, 'snapshot_data'> {}

// ── Internal Helpers ─────────────────────────────────────────────────────────

async function getCurrentUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    return user?.id ?? null
  } catch {
    return null
  }
}

/**
 * Collect all localStorage keys into a single JSON object.
 * This is the "full snapshot" of all app state.
 */
function collectAllLocalStorage(): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      try {
        const raw = localStorage.getItem(key)
        if (raw === null) continue
        // Try to parse JSON; fall back to raw string
        try {
          snapshot[key] = JSON.parse(raw)
        } catch {
          snapshot[key] = raw
        }
      } catch {
        // skip unreadable keys
      }
    }
  } catch {
    // localStorage unavailable
  }
  return snapshot
}

/**
 * Estimate byte size of a JSON-serializable object.
 */
function estimateSizeBytes(obj: Record<string, unknown>): number {
  try {
    return new Blob([JSON.stringify(obj)]).size
  } catch {
    return 0
  }
}

/**
 * Format timestamp as YYYY-MM-DD HH:MM for labels.
 */
function fmtTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}`
}

/**
 * Format for file name: YYYY-MM-DD_HH-MM
 */
function fmtFileTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d}_${h}-${mi}`
}

/**
 * Encode trigger_event and size_bytes into the `description` field.
 * This avoids requiring a schema migration.
 */
function encodeDescription(triggerEvent: TriggerEvent | string, sizeBytes: number): string {
  return JSON.stringify({ trigger_event: triggerEvent, size_bytes: sizeBytes })
}

/**
 * Decode trigger_event and size_bytes from the `description` field.
 */
function decodeDescription(description: string | null): { trigger_event: string; size_bytes: number } {
  if (!description) return { trigger_event: 'manual', size_bytes: 0 }
  try {
    const parsed = JSON.parse(description)
    return {
      trigger_event: parsed.trigger_event ?? 'manual',
      size_bytes: parsed.size_bytes ?? 0,
    }
  } catch {
    return { trigger_event: 'manual', size_bytes: 0 }
  }
}

/**
 * Trigger classification for filtering.
 */
function classifyTrigger(triggerEvent: string): SnapshotFilter {
  if (triggerEvent === 'weekly_auto') return 'weekly'
  if (triggerEvent === 'manual') return 'manual'
  return 'auto'
}

// ── Core: Save Snapshot to Supabase ─────────────────────────────────────────

async function saveSnapshotToSupabase(
  label: string,
  triggerEvent: TriggerEvent | string,
  snapshotData: Record<string, unknown>
): Promise<MilestoneSnapshot | null> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      console.warn('[milestoneBackupService] No authenticated user — snapshot skipped')
      return null
    }

    const sizeBytes = estimateSizeBytes(snapshotData)
    const description = encodeDescription(triggerEvent, sizeBytes)

    const { data: inserted, error } = await supabase
      .from('snapshots')
      .insert({
        user_id: userId,
        label: label.slice(0, 255),
        description,
        snapshot_data: snapshotData,
        is_pinned: false,
      })
      .select('id, user_id, label, description, created_at, is_pinned')
      .single()

    if (error) {
      console.error('[milestoneBackupService] saveSnapshotToSupabase error:', error.message)
      return null
    }

    const { trigger_event, size_bytes } = decodeDescription(inserted.description)

    return {
      id: inserted.id,
      label: inserted.label,
      trigger_event,
      snapshot_data: snapshotData,
      created_at: inserted.created_at,
      size_bytes,
      is_pinned: inserted.is_pinned,
    }
  } catch (err) {
    console.error('[milestoneBackupService] saveSnapshotToSupabase exception:', err)
    return null
  }
}

/**
 * Prune auto-snapshots to keep only the last MAX_AUTO_SNAPSHOTS per user.
 * Runs fire-and-forget after each auto-snapshot write.
 */
async function pruneAutoSnapshots(): Promise<void> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return

    // Fetch all auto snapshots (non-manual, non-weekly), ordered oldest first
    const { data, error } = await supabase
      .from('snapshots')
      .select('id, description, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })

    if (error || !data) return

    // Filter to auto-snapshots only (trigger_event is not 'manual' and not 'weekly_auto')
    const autoSnaps = data.filter((row: any) => {
      const { trigger_event } = decodeDescription(row.description)
      return trigger_event !== 'manual' && trigger_event !== 'weekly_auto'
    })

    if (autoSnaps.length <= MAX_AUTO_SNAPSHOTS) return

    // Delete the oldest ones over the limit
    const toDelete = autoSnaps.slice(0, autoSnaps.length - MAX_AUTO_SNAPSHOTS)
    const ids = toDelete.map((s: any) => s.id)

    await supabase.from('snapshots').delete().in('id', ids).eq('user_id', userId)
    console.log(`[milestoneBackupService] Pruned ${ids.length} old auto-snapshot(s)`)
  } catch (err) {
    console.warn('[milestoneBackupService] pruneAutoSnapshots error (non-fatal):', err)
  }
}

// ── CAPABILITY 1: Change-Triggered Snapshots ─────────────────────────────────

/**
 * triggerAutoSnapshot — call this directly from any component/service
 * when a change event occurs.
 *
 * Fire-and-forget — never throws, never blocks UI.
 *
 * @param triggerEvent  The event type that triggered this snapshot
 * @param context       Optional short context string (e.g. project name, log id)
 */
export function triggerAutoSnapshot(
  triggerEvent: TriggerEvent,
  context?: string
): void {
  const timestamp = fmtTimestamp()
  const contextSuffix = context ? ` — ${context}` : ''
  const label = `Auto - ${triggerEvent}${contextSuffix} - ${timestamp}`
  const snapshotData = collectAllLocalStorage()

  // Fire and forget
  saveSnapshotToSupabase(label, triggerEvent, snapshotData)
    .then(() => {
      pruneAutoSnapshots().catch(() => {})
    })
    .catch(() => {})

  console.log(`[milestoneBackupService] Auto-snapshot queued: ${label}`)
}

/**
 * initAgentBusListeners — subscribe to agentBus events and auto-snapshot on relevant events.
 * Call once on app init.
 */
export async function initAgentBusListeners(): Promise<void> {
  try {
    const { subscribe } = await import('@/services/agentBus')

    // Map agent bus event payloads to trigger events
    const eventMap: Record<string, TriggerEvent> = {
      data_updated: 'project_updated',
      alert: 'service_status_changed',
    }

    // Subscribe VAULT agent events (project changes)
    subscribe('VAULT', (msg: any) => {
      const payload = msg.payload || {}
      const triggerEvent: TriggerEvent = (() => {
        if (payload.action === 'project_created') return 'project_created'
        if (payload.action === 'project_deleted') return 'project_deleted'
        if (payload.action === 'phase_changed') return 'phase_changed'
        if (payload.action === 'invoice_created') return 'invoice_created'
        if (payload.action === 'invoice_paid') return 'invoice_paid'
        return 'project_updated'
      })()
      triggerAutoSnapshot(triggerEvent, payload.projectName as string | undefined)
    })

    // Subscribe LEDGER agent events (financial changes)
    subscribe('LEDGER', (msg: any) => {
      const payload = msg.payload || {}
      if (msg.type === 'data_updated') {
        triggerAutoSnapshot('invoice_created', payload.label as string | undefined)
      }
    })

    // Subscribe PULSE agent events (service log changes)
    subscribe('PULSE', (msg: any) => {
      const payload = msg.payload || {}
      const trigger: TriggerEvent = payload.status ? 'service_status_changed' : 'service_log_added'
      triggerAutoSnapshot(trigger, payload.logId as string | undefined)
    })

    // Subscribe SPARK agent events (lead changes)
    subscribe('SPARK', (msg: any) => {
      if (msg.type === 'data_updated') {
        triggerAutoSnapshot('lead_status_changed', (msg.payload?.leadId as string | undefined))
      }
    })

    console.log('[milestoneBackupService] Agent bus listeners registered')
  } catch (err) {
    console.warn('[milestoneBackupService] initAgentBusListeners failed (non-fatal):', err)
  }
}

// ── CAPABILITY 2: Manual Milestone + Export ───────────────────────────────────

/**
 * createMilestone — packages all localStorage, saves to Supabase, AND downloads JSON.
 *
 * @param label  Human-readable milestone label (e.g. "Pre-launch freeze")
 * @returns The saved MilestoneSnapshot, or null if Supabase write failed
 */
export async function createMilestone(label: string): Promise<MilestoneSnapshot | null> {
  const snapshotData = collectAllLocalStorage()
  const timestamp = fmtFileTimestamp()
  const safeLabel = label.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_')
  const filename = `poweron_milestone_${timestamp}_${safeLabel}.json`

  // Save to Supabase
  const saved = await saveSnapshotToSupabase(
    `Manual Milestone — ${label} — ${fmtTimestamp()}`,
    'manual',
    snapshotData
  )

  // Update last_milestone_date regardless of Supabase success
  try {
    localStorage.setItem(LAST_MILESTONE_KEY, new Date().toISOString())
  } catch { /* ignore */ }

  // Trigger browser download
  triggerDownload(snapshotData, filename)

  console.log(`[milestoneBackupService] Milestone created: ${label}`)
  return saved
}

/**
 * exportCurrentData — downloads current localStorage state as JSON.
 * No Supabase write.
 */
export function exportCurrentData(): void {
  const snapshotData = collectAllLocalStorage()
  const timestamp = fmtFileTimestamp()
  const filename = `poweron_export_${timestamp}.json`
  triggerDownload(snapshotData, filename)
  console.log(`[milestoneBackupService] Export downloaded: ${filename}`)
}

/**
 * checkAndCreateWeeklyMilestone — call on app load.
 * If last_milestone_date > 7 days ago, silently creates a Weekly Auto milestone.
 * No download triggered.
 */
export function checkAndCreateWeeklyMilestone(): void {
  try {
    const raw = localStorage.getItem(LAST_MILESTONE_KEY)
    const lastDate = raw ? new Date(raw).getTime() : 0
    const now = Date.now()

    if (now - lastDate < WEEKLY_INTERVAL_MS) return

    // Over 7 days — create silent weekly auto milestone
    const snapshotData = collectAllLocalStorage()
    const label = `Weekly Auto — ${fmtTimestamp()}`

    saveSnapshotToSupabase(label, 'weekly_auto', snapshotData)
      .then(() => {
        try {
          localStorage.setItem(LAST_MILESTONE_KEY, new Date().toISOString())
        } catch { /* ignore */ }
        console.log('[milestoneBackupService] Weekly auto milestone created')
      })
      .catch(() => {})
  } catch (err) {
    console.warn('[milestoneBackupService] checkAndCreateWeeklyMilestone error (non-fatal):', err)
  }
}

// ── CAPABILITY 3: Restore Interface Data Layer ───────────────────────────────

/**
 * listMilestoneSnapshots — returns up to 50 snapshots sorted newest first.
 * Excludes snapshot_data for performance.
 */
export async function listMilestoneSnapshots(
  filter: SnapshotFilter = 'all'
): Promise<MilestoneSnapshotMeta[]> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return []

    const { data, error } = await supabase
      .from('snapshots')
      .select('id, label, description, created_at, is_pinned')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error || !data) return []

    const rows: MilestoneSnapshotMeta[] = data.map((row: any) => {
      const { trigger_event, size_bytes } = decodeDescription(row.description)
      return {
        id: row.id,
        label: row.label,
        trigger_event,
        created_at: row.created_at,
        size_bytes,
        is_pinned: row.is_pinned,
      }
    })

    if (filter === 'all') return rows

    return rows.filter((row) => classifyTrigger(row.trigger_event) === filter)
  } catch (err) {
    console.error('[milestoneBackupService] listMilestoneSnapshots exception:', err)
    return []
  }
}

/**
 * getMilestoneSnapshot — fetch full snapshot data for restore.
 */
export async function getMilestoneSnapshot(id: string): Promise<MilestoneSnapshot | null> {
  try {
    const userId = await getCurrentUserId()
    if (!userId) return null

    const { data, error } = await supabase
      .from('snapshots')
      .select('id, label, description, snapshot_data, created_at, is_pinned')
      .eq('id', id)
      .eq('user_id', userId)
      .single()

    if (error || !data) return null

    const { trigger_event, size_bytes } = decodeDescription(data.description)
    return {
      id: data.id,
      label: data.label,
      trigger_event,
      snapshot_data: data.snapshot_data ?? {},
      created_at: data.created_at,
      size_bytes,
      is_pinned: data.is_pinned,
    }
  } catch (err) {
    console.error('[milestoneBackupService] getMilestoneSnapshot exception:', err)
    return null
  }
}

/**
 * restoreMilestone — writes all snapshot JSON keys back to localStorage, then reloads.
 * DESTRUCTIVE — requires the UI to have the user type "RESTORE" to confirm.
 */
export function restoreMilestone(snapshot: MilestoneSnapshot): void {
  try {
    const data = snapshot.snapshot_data
    if (!data || typeof data !== 'object') {
      console.error('[milestoneBackupService] restoreMilestone: invalid snapshot_data')
      return
    }

    // Write every key back to localStorage
    for (const [key, value] of Object.entries(data)) {
      try {
        if (typeof value === 'string') {
          localStorage.setItem(key, value)
        } else {
          localStorage.setItem(key, JSON.stringify(value))
        }
      } catch (err) {
        console.warn(`[milestoneBackupService] Could not restore key "${key}":`, err)
      }
    }

    console.log(`[milestoneBackupService] Restored snapshot: ${snapshot.label}`)

    // Reload app to apply restored state
    window.location.reload()
  } catch (err) {
    console.error('[milestoneBackupService] restoreMilestone exception:', err)
  }
}

/**
 * formatSizeBytes — human-readable file size string.
 */
export function formatSizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Internal: Browser Download ───────────────────────────────────────────────

function triggerDownload(data: Record<string, unknown>, filename: string): void {
  try {
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('[milestoneBackupService] triggerDownload error:', err)
  }
}
