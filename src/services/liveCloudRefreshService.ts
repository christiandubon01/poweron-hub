/**
 * liveCloudRefreshService.ts — Phase 6T
 *
 * Dirty-safe live remote refresh: detect newer cloud app_state on focus,
 * visibility, online, and a light interval.
 *
 * EMERGENCY CONTAINMENT (2026-07-12): automatic sources (focus / visibility /
 * online / interval / realtime) MUST NOT apply remote backup into localStorage.
 * They may only detect that remote data is available and notify the UI.
 * Explicit manual forceApply (user confirmed "Refresh now") remains the only
 * path that may write remote into local state.
 */

import {
  applyRemoteBackupDataSilent,
  fetchLatestRemoteBackup,
  getActiveTenantUserId,
  getKnownRemoteBaselineMs,
  isSupabaseConfigured,
  isTenantDataReady,
  type BackupData,
} from './backupDataService'

export type LiveRefreshSource = 'focus' | 'visibility' | 'online' | 'interval' | 'manual' | 'realtime'

export interface RemoteRefreshEventDetail {
  source: LiveRefreshSource
  remoteUpdatedAt: string | null
  remoteDataLastSavedAt: string | null
  applied: boolean
  dirtyScopes: string[]
  reason?: string
}

const REFRESH_INTERVAL_MS = 60_000
const MIN_CHECK_INTERVAL_MS = 5_000

/** Sources that must never auto-write remote into localStorage. */
const AUTOMATIC_SOURCES = new Set<LiveRefreshSource>([
  'focus',
  'visibility',
  'online',
  'interval',
  'realtime',
])

const dirtyScopes = new Map<string, { label?: string }>()

let _started = false
let _intervalId: ReturnType<typeof setInterval> | null = null
let _refreshInFlight: Promise<RemoteRefreshEventDetail | null> | null = null
let _lastCheckAt = 0
let _lastNotifiedRemoteKey: string | null = null

function computeRemoteFreshnessMs(
  remoteUpdatedAt?: string | null,
  remoteDataLastSavedAt?: string | null,
): number {
  const parse = (value?: string | null): number => {
    if (!value) return 0
    const t = new Date(value).getTime()
    return Number.isFinite(t) ? t : 0
  }
  return Math.max(parse(remoteUpdatedAt), parse(remoteDataLastSavedAt))
}

function remoteFreshnessKey(remoteUpdatedAt: string | null, remoteDataLastSavedAt: string | null): string {
  return `${remoteUpdatedAt || ''}|${remoteDataLastSavedAt || ''}`
}

function dispatchRemoteEvent(name: string, detail: RemoteRefreshEventDetail): void {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  } catch {
    /* ignore SSR */
  }
}

function canRunRefreshCheck(): boolean {
  if (typeof window === 'undefined') return false
  if (!navigator.onLine) return false
  if (!isSupabaseConfigured()) return false
  if (!isTenantDataReady()) return false
  if (!getActiveTenantUserId()) return false
  return true
}

export function registerDirtyScope(scopeId: string, label?: string): void {
  dirtyScopes.set(scopeId, { label })
}

export function unregisterDirtyScope(scopeId: string): void {
  dirtyScopes.delete(scopeId)
}

export function setDirtyScope(scopeId: string, isDirty: boolean, label?: string): void {
  if (isDirty) registerDirtyScope(scopeId, label)
  else unregisterDirtyScope(scopeId)
}

export function getDirtyScopes(): string[] {
  return Array.from(dirtyScopes.keys())
}

export function hasDirtyScopes(): boolean {
  return dirtyScopes.size > 0
}

function notifyRemoteAvailable(
  detailBase: Omit<RemoteRefreshEventDetail, 'applied'>,
  remoteKey: string,
  reason: string,
): RemoteRefreshEventDetail {
  const detail: RemoteRefreshEventDetail = {
    ...detailBase,
    applied: false,
    reason,
  }
  if (_lastNotifiedRemoteKey !== remoteKey) {
    _lastNotifiedRemoteKey = remoteKey
    dispatchRemoteEvent('poweron-remote-data-available', detail)
  }
  return detail
}

export async function requestRemoteRefresh(options?: {
  forceApply?: boolean
  source?: LiveRefreshSource
}): Promise<RemoteRefreshEventDetail | null> {
  const source = options?.source || 'manual'
  const forceApply = options?.forceApply === true

  if (!canRunRefreshCheck()) return null

  const now = Date.now()
  if (!forceApply && now - _lastCheckAt < MIN_CHECK_INTERVAL_MS) return null

  if (_refreshInFlight) return _refreshInFlight

  _refreshInFlight = (async () => {
    _lastCheckAt = Date.now()
    try {
      const userId = getActiveTenantUserId()
      if (!userId) return null

      const remote = await fetchLatestRemoteBackup(userId)
      if (remote.error) {
        console.warn('[LiveCloudRefresh] Remote fetch failed:', remote.error)
        return null
      }
      if (!remote.hasRemoteRow || !remote.remoteData) return null

      const remoteFreshnessMs = computeRemoteFreshnessMs(remote.remoteUpdatedAt, remote.remoteDataLastSavedAt)
      const knownBaselineMs = getKnownRemoteBaselineMs()
      if (remoteFreshnessMs <= knownBaselineMs) return null

      const dirtyScopeIds = getDirtyScopes()
      const detailBase: Omit<RemoteRefreshEventDetail, 'applied'> = {
        source,
        remoteUpdatedAt: remote.remoteUpdatedAt,
        remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
        dirtyScopes: dirtyScopeIds,
      }

      const remoteKey = remoteFreshnessKey(remote.remoteUpdatedAt, remote.remoteDataLastSavedAt)

      // EMERGENCY CONTAINMENT: never auto-apply. Detect + notify only.
      // Manual forceApply (user confirmed Refresh now) is the sole write path.
      if (!forceApply || AUTOMATIC_SOURCES.has(source)) {
        console.warn(
          `[LiveCloudRefresh] Auto-apply contained (${source}) — remote available, local backup untouched`,
        )
        return notifyRemoteAvailable(detailBase, remoteKey, 'auto-apply-contained')
      }

      const applyResult = applyRemoteBackupDataSilent(remote.remoteData as BackupData, userId, {
        remoteUpdatedAt: remote.remoteUpdatedAt,
        remoteDataLastSavedAt: remote.remoteDataLastSavedAt,
      }, { snapshotReason: `Live refresh (${source})` })

      if (!applyResult.applied) {
        console.warn(`[LiveCloudRefresh] Manual remote apply merge failed (${source}) — local data kept`)
        return notifyRemoteAvailable(detailBase, remoteKey, 'merge-failed')
      }

      _lastNotifiedRemoteKey = remoteKey

      const detail: RemoteRefreshEventDetail = {
        ...detailBase,
        applied: true,
        dirtyScopes: dirtyScopeIds,
        reason: dirtyScopeIds.length > 0 ? 'force-applied' : undefined,
      }

      dispatchRemoteEvent('poweron-remote-data-refreshed', detail)
      // Do NOT dispatch poweron:sync-success — apply is "loaded", not "synced by this device".

      console.log(`[LiveCloudRefresh] Applied remote data (${source}) — manual forceApply only`)
      return detail
    } catch (err) {
      console.warn('[LiveCloudRefresh] Refresh check failed:', err)
      return null
    } finally {
      _refreshInFlight = null
    }
  })()

  return _refreshInFlight
}

function scheduleRefresh(source: LiveRefreshSource): void {
  void requestRemoteRefresh({ source })
}

const onFocus = (): void => scheduleRefresh('focus')
const onVisibilityChange = (): void => {
  if (document.visibilityState === 'visible') scheduleRefresh('visibility')
}
const onOnline = (): void => scheduleRefresh('online')

export function startLiveCloudRefresh(): () => void {
  if (_started || typeof window === 'undefined') return () => stopLiveCloudRefresh()
  _started = true

  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('online', onOnline)

  _intervalId = setInterval(() => {
    if (document.visibilityState !== 'visible') return
    if (!navigator.onLine) return
    scheduleRefresh('interval')
  }, REFRESH_INTERVAL_MS)

  console.log('[LiveCloudRefresh] Started (auto-apply contained)')
  return () => stopLiveCloudRefresh()
}

export function stopLiveCloudRefresh(): void {
  if (!_started) return
  _started = false
  window.removeEventListener('focus', onFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('online', onOnline)
  if (_intervalId) {
    clearInterval(_intervalId)
    _intervalId = null
  }
  console.log('[LiveCloudRefresh] Stopped')
}
