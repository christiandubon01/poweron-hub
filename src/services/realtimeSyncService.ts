/**
 * realtimeSyncService.ts
 *
 * BUG 1 FIX — Data sync across devices.
 *
 * Mid-session stale checks and realtime events route through
 * liveCloudRefreshService.requestRemoteRefresh, which applies newer remote data
 * through the shared record-preserving merge when local work is not pending.
 *
 * Usage (from V15rLayout.tsx):
 *   const cleanup = initRealtimeSync()
 *   return () => cleanup()
 */

import { isSupabaseConfigured, getBackupData } from './backupDataService'

/** If local data is older than this on app load, check for and apply newer remote data. */
const STALE_THRESHOLD_MS = 30_000

/** Tables to watch via Supabase Realtime (domain-level tables + full-state key). */
const REALTIME_TABLES = ['app_state', 'projects', 'invoices', 'field_logs', 'leads']

let _realtimeInitialized = false
let _activeChannels: any[] = []

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
 * Check for and safely apply a newer remote snapshot through the shared refresh path.
 */
async function refreshFromRemote(source: 'interval' | 'realtime'): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    const { requestRemoteRefresh } = await import('./liveCloudRefreshService')
    await requestRemoteRefresh({ source })
  } catch (err) {
    console.warn(`[RealtimeSync] Remote refresh failed (${source}):`, err)
  }
}

/**
 * Check if local data is stale on app startup.
 * If stale, apply a newer remote snapshot through the record-preserving path.
 */
export async function checkAndRefreshIfStale(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  if (!isLocalDataStale()) {
    console.log('[RealtimeSync] Local data is fresh — no stale check needed')
    return false
  }
  console.log('[RealtimeSync] Local data is stale (>30s) — checking for newer remote data')
  await refreshFromRemote('interval')
  return true
}

/**
 * Subscribe to Supabase Realtime channels for cross-device change detection.
 *
 * On change, run the shared record-preserving remote refresh path.
 */
export function subscribeToRealtimeChanges(
  onRefresh?: (table: string) => void
): () => void {
  if (!isSupabaseConfigured()) {
    return () => {}
  }

  if (_realtimeInitialized) {
    console.log('[RealtimeSync] Already subscribed — skipping')
    return () => unsubscribeAll()
  }

  const setupSubscriptions = async () => {
    try {
      const { supabase } = await import('@/lib/supabase')

      for (const table of REALTIME_TABLES) {
        try {
          const channel = supabase
            .channel(`poweron-realtime-${table}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table },
              async (payload: any) => {
                console.log(`[RealtimeSync] Change detected on table "${table}":`, payload.eventType)
                await refreshFromRemote('realtime')
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

/**
 * initRealtimeSync — call this once from V15rLayout on mount (after initial load).
 *
 * Steps:
 *   1. If local looks stale, apply newer remote data through the shared merge path.
 *   2. Subscribe to Supabase Realtime channels and refresh on change.
 */
export function initRealtimeSync(onRefresh?: (table: string) => void): () => void {
  checkAndRefreshIfStale().catch(err =>
    console.warn('[RealtimeSync] Stale check failed:', err)
  )

  const cleanup = subscribeToRealtimeChanges(onRefresh)

  return () => {
    cleanup()
  }
}
