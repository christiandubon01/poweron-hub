/**
 * realtimeSyncService.ts
 *
 * BUG 1 FIX — Data sync across devices.
 *
 * EMERGENCY CONTAINMENT (2026-07-12): mid-session stale checks and realtime
 * events must NOT apply remote backup into localStorage. They route through
 * liveCloudRefreshService.requestRemoteRefresh which only notifies that
 * remote data is available unless the user explicitly force-applies.
 *
 * Usage (from V15rLayout.tsx):
 *   const cleanup = initRealtimeSync()
 *   return () => cleanup()
 */

import { isSupabaseConfigured, getBackupData } from './backupDataService'

/** If local data is older than this on app load, check for newer remote (notify only). */
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
 * EMERGENCY CONTAINMENT: check remote freshness only — never apply into localStorage.
 * Routes through requestRemoteRefresh without forceApply.
 */
async function checkRemoteAvailableOnly(source: 'interval' | 'realtime'): Promise<void> {
  if (!isSupabaseConfigured()) return
  try {
    const { requestRemoteRefresh } = await import('./liveCloudRefreshService')
    await requestRemoteRefresh({ source })
  } catch (err) {
    console.warn(`[RealtimeSync] Remote availability check failed (${source}):`, err)
  }
}

/**
 * Check if local data is stale on app startup.
 * EMERGENCY CONTAINMENT: if stale, notify that remote may be available — do NOT
 * pull/apply remote into localStorage (that wiped Blueprint annotations / estimates).
 */
export async function checkAndRefreshIfStale(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false
  if (!isLocalDataStale()) {
    console.log('[RealtimeSync] Local data is fresh — no stale check needed')
    return false
  }
  console.warn('[RealtimeSync] Local data is stale (>30s) — checking remote availability only (auto-apply contained)')
  await checkRemoteAvailableOnly('interval')
  return true
}

/**
 * Subscribe to Supabase Realtime channels for cross-device change detection.
 *
 * EMERGENCY CONTAINMENT: on change, only run a contained refresh check (notify
 * available). Does not write remote backup into localStorage.
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
                await checkRemoteAvailableOnly('realtime')
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
      console.log(`[RealtimeSync] Subscribed to ${_activeChannels.length} realtime channel(s) (auto-apply contained)`)
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
 *   1. If local looks stale, check remote availability (no auto-apply).
 *   2. Subscribe to Supabase Realtime channels (notify-only on change).
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
