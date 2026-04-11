/**
 * realtimeSyncService.ts
 *
 * BUG 1 FIX — Data sync across devices.
 *
 * Problem: iPad showed 12 alerts / $104K pipeline while Windows showed 4 / $64.8K.
 * Root cause: Different devices cached data locally and diverged from Supabase.
 *
 * This service provides:
 *   1. Stale-data detection — if local data > 30s old on app load, force-pull from Supabase.
 *   2. Supabase Realtime subscription — subscribe to `app_state` row changes and
 *      to individual domain tables (projects, invoices, field_logs, leads) for
 *      instant cross-device refresh.
 *   3. On any remote change: reload from Supabase and dispatch `poweron-data-saved`
 *      so all components (V15rLayout, V15rHome, V15rDashboard, etc.) refresh.
 *
 * Usage (from V15rLayout.tsx):
 *   const cleanup = initRealtimeSync()
 *   return () => cleanup()
 */

import { isSupabaseConfigured, loadFromSupabase, getBackupData } from './backupDataService'

// ── Constants ─────────────────────────────────────────────────────────────────

/** If local data is older than this on app load, force a Supabase pull. */
const STALE_THRESHOLD_MS = 30_000  // 30 seconds

/** Tables to watch via Supabase Realtime (domain-level tables + full-state key). */
const REALTIME_TABLES = ['app_state', 'projects', 'invoices', 'field_logs', 'leads']

// ── Internal state ────────────────────────────────────────────────────────────

let _realtimeInitialized = false
let _activeChannels: any[] = []

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the locally stored backup data is stale.
 * "Stale" means _lastSavedAt is older than STALE_THRESHOLD_MS from now.
 */
export function isLocalDataStale(): boolean {
  try {
    const data = getBackupData()
    if (!data || !data._lastSavedAt) return true
    const lastSaved = new Date(data._lastSavedAt).getTime()
    if (isNaN(lastSaved)) return true
    return Date.now() - lastSaved > STALE_THRESHOLD_MS
  } catch {
    return true
  }
}

/**
 * Dispatch the `poweron-data-saved` custom event so all components
 * that listen on this event (V15rLayout, etc.) refresh their state.
 */
function notifyDataRefreshed(source: string): void {
  try {
    console.log(`[RealtimeSync] Data refreshed from ${source} — notifying components`)
    window.dispatchEvent(new CustomEvent('poweron-data-saved'))
  } catch {
    // ignore if window not available (SSR)
  }
}

/**
 * Pull latest data from Supabase and notify components if something changed.
 */
async function pullAndRefresh(source: string): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    const result = await loadFromSupabase()
    if (result.success) {
      notifyDataRefreshed(source)
    }
  } catch (err) {
    console.warn(`[RealtimeSync] Pull failed (${source}):`, err)
  }
}

// ── Stale check on load ───────────────────────────────────────────────────────

/**
 * Check if local data is stale on app startup.
 * If stale (> 30s since last save), force-pull from Supabase.
 * Call this once from V15rLayout on mount, AFTER the initial loadFromSupabase.
 */
export async function checkAndRefreshIfStale(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  if (!isLocalDataStale()) {
    console.log('[RealtimeSync] Local data is fresh — no stale pull needed')
    return false
  }
  console.log('[RealtimeSync] Local data is stale (>30s) — forcing Supabase refresh')
  await pullAndRefresh('stale-check')
  return true
}

// ── Realtime subscriptions ─────────────────────────────────────────────────────

/**
 * Subscribe to Supabase Realtime channels for instant cross-device sync.
 *
 * Subscribes to:
 *   - `app_state` table — main state blob (our full snapshot)
 *   - `projects`, `invoices`, `field_logs`, `leads` — domain tables
 *
 * On any INSERT/UPDATE/DELETE event: pulls latest from Supabase and
 * dispatches `poweron-data-saved` to refresh all UI components.
 *
 * Returns a cleanup function that unsubscribes all channels.
 */
export function subscribeToRealtimeChanges(
  onRefresh?: (table: string) => void
): () => void {
  if (!isSupabaseConfigured()) {
    return () => {}
  }

  // Prevent duplicate subscriptions
  if (_realtimeInitialized) {
    console.log('[RealtimeSync] Already subscribed — skipping')
    return () => unsubscribeAll()
  }

  let supabaseClient: any = null

  const setupSubscriptions = async () => {
    try {
      const { supabase } = await import('@/lib/supabase')
      supabaseClient = supabase

      for (const table of REALTIME_TABLES) {
        try {
          const channel = supabase
            .channel(`poweron-realtime-${table}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table },
              async (payload: any) => {
                console.log(`[RealtimeSync] Change detected on table "${table}":`, payload.eventType)
                await pullAndRefresh(`realtime:${table}`)
                onRefresh?.(table)
              }
            )
            .subscribe((status: string) => {
              if (status === 'SUBSCRIBED') {
                console.log(`[RealtimeSync] Subscribed to table "${table}"`)
              } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn(`[RealtimeSync] Subscription issue on "${table}": ${status}`)
              }
            })

          _activeChannels.push({ channel, supabase, table })
        } catch (tableErr) {
          // Table may not exist yet — log and continue; won't break the app
          console.warn(`[RealtimeSync] Could not subscribe to "${table}":`, tableErr)
        }
      }

      _realtimeInitialized = true
      console.log(`[RealtimeSync] Subscribed to ${_activeChannels.length} realtime channel(s)`)
    } catch (err) {
      console.warn('[RealtimeSync] Failed to set up realtime subscriptions:', err)
    }
  }

  setupSubscriptions()

  return () => unsubscribeAll()
}

/** Remove all active Realtime subscriptions. */
function unsubscribeAll(): void {
  for (const { channel, supabase } of _activeChannels) {
    try {
      supabase.removeChannel(channel)
    } catch {
      // ignore
    }
  }
  _activeChannels = []
  _realtimeInitialized = false
  console.log('[RealtimeSync] All realtime channels removed')
}

// ── Combined init ─────────────────────────────────────────────────────────────

/**
 * initRealtimeSync — call this once from V15rLayout on mount (after initial load).
 *
 * Steps:
 *   1. Check if local data is stale; if so, force a Supabase pull.
 *   2. Subscribe to all Supabase Realtime channels.
 *
 * Returns a cleanup function for the `useEffect` return.
 */
export function initRealtimeSync(onRefresh?: (table: string) => void): () => void {
  // Stale check (async, fire-and-forget)
  checkAndRefreshIfStale().catch(err =>
    console.warn('[RealtimeSync] Stale check failed:', err)
  )

  // Set up realtime subscriptions
  const cleanup = subscribeToRealtimeChanges(onRefresh)

  return () => {
    cleanup()
  }
}
