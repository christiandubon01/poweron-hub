import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refreshDeps = vi.hoisted(() => ({
  fetchLatestRemoteBackup: vi.fn(),
}))

vi.mock('@/services/backupDataService', () => ({
  applyRemoteBackupDataSilent: vi.fn(() => ({ applied: true, mergeFailed: false })),
  fetchLatestRemoteBackup: (...args: any[]) => refreshDeps.fetchLatestRemoteBackup(...args),
  getActiveTenantUserId: vi.fn(() => 'owner-1'),
  getKnownRemoteBaselineMs: vi.fn(() => 0),
  hasPendingLocalSave: vi.fn(() => false),
  isSupabaseConfigured: vi.fn(() => true),
  isTenantDataReady: vi.fn(() => true),
}))

async function flushAsyncRefresh(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.resetModules()
  refreshDeps.fetchLatestRemoteBackup.mockReset().mockResolvedValue({
    hasRemoteRow: false,
    remoteUpdatedAt: null,
    remoteDataLastSavedAt: null,
    remoteData: null,
  })
  const testWindow = new EventTarget() as any
  const testDocument = new EventTarget() as any
  testDocument.visibilityState = 'visible'
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: testDocument })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('existing live refresh triggers', () => {
  it('keeps focus refresh behavior', async () => {
    const service = await import('../liveCloudRefreshService')
    const stop = service.startLiveCloudRefresh()
    window.dispatchEvent(new Event('focus'))
    await flushAsyncRefresh()
    expect(refreshDeps.fetchLatestRemoteBackup).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps visible visibilitychange refresh behavior', async () => {
    const service = await import('../liveCloudRefreshService')
    const stop = service.startLiveCloudRefresh()
    document.dispatchEvent(new Event('visibilitychange'))
    await flushAsyncRefresh()
    expect(refreshDeps.fetchLatestRemoteBackup).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps online refresh behavior', async () => {
    const service = await import('../liveCloudRefreshService')
    const stop = service.startLiveCloudRefresh()
    window.dispatchEvent(new Event('online'))
    await flushAsyncRefresh()
    expect(refreshDeps.fetchLatestRemoteBackup).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps the visible online interval refresh behavior', async () => {
    vi.useFakeTimers()
    const service = await import('../liveCloudRefreshService')
    const stop = service.startLiveCloudRefresh()
    await vi.advanceTimersByTimeAsync(60_000)
    await flushAsyncRefresh()
    expect(refreshDeps.fetchLatestRemoteBackup).toHaveBeenCalledTimes(1)
    stop()
  })

  it('keeps the guarded realtime source available', async () => {
    const service = await import('../liveCloudRefreshService')
    await service.requestRemoteRefresh({ source: 'realtime' })
    expect(refreshDeps.fetchLatestRemoteBackup).toHaveBeenCalledTimes(1)
  })
})
