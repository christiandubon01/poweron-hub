import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)) }
}

// ── Supabase mock (mirrors backupDataRegression harness) ──────────────────────
const supabaseState = vi.hoisted(() => ({
  capturedPayload: null as any,
  remoteData: null as any,
  remoteWriteError: null as string | null,
  userId: 'user-quota-1',
  remoteReadCalls: 0,
  pauseRemoteReadAt: 0,
  releaseRemoteRead: null as null | (() => void),
  remoteWriteCalls: 0,
  pauseRemoteWriteAt: 0,
  releaseRemoteWrite: null as null | (() => void),
  pendingWrite: null as any,
}))

vi.mock('@/lib/supabase', () => {
  const builder: any = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.upsert = vi.fn((row: any) => {
    supabaseState.capturedPayload = row.data
    supabaseState.pendingWrite = row.data
    return builder
  })
  builder.maybeSingle = vi.fn(async () => {
    supabaseState.remoteReadCalls++
    if (supabaseState.remoteReadCalls === supabaseState.pauseRemoteReadAt) {
      await new Promise<void>((resolve) => { supabaseState.releaseRemoteRead = resolve })
    }
    return {
      data: supabaseState.remoteData
        ? { data: supabaseState.remoteData, updated_at: '2026-07-17T10:00:00.000Z', user_id: supabaseState.userId }
        : null,
      error: null,
    }
  })
  builder.single = vi.fn(async () => {
    supabaseState.remoteWriteCalls++
    if (supabaseState.remoteWriteCalls === supabaseState.pauseRemoteWriteAt) {
      await new Promise<void>((resolve) => { supabaseState.releaseRemoteWrite = resolve })
    }
    if (supabaseState.remoteWriteError) return { data: null, error: { message: supabaseState.remoteWriteError } }
    supabaseState.remoteData = supabaseState.pendingWrite
    return { data: { updated_at: '2026-07-17T10:00:01.000Z' }, error: null }
  })
  return {
    supabase: {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: supabaseState.userId } } })),
        getSession: vi.fn(async () => ({ data: { session: { user: { id: supabaseState.userId } } } })),
      },
      from: vi.fn(() => builder),
    },
    isSupabaseConfigured: () => true,
  }
})

// ── IndexedDB mock (in-memory) ────────────────────────────────────────────────
const idbStore = vi.hoisted(() => new Map<string, unknown>())
const idbControl = vi.hoisted(() => ({ calls: 0, pauseAt: 0, release: null as null | (() => void) }))
vi.mock('@/services/idbStorage', () => ({
  idbGet: vi.fn(async (k: string) => idbStore.get(k)),
  idbSet: vi.fn(async (k: string, v: unknown) => { idbStore.set(k, v) }),
  idbDelete: vi.fn(async (k: string) => { idbStore.delete(k) }),
  idbAtomicUpdate: vi.fn(async (k: string, update: (current: unknown) => any) => {
    idbControl.calls++
    if (idbControl.calls === idbControl.pauseAt) {
      await new Promise<void>((resolve) => { idbControl.release = resolve })
    }
    const decision = update(idbStore.get(k))
    if (decision.action === 'put') {
      idbStore.set(k, decision.value)
      return { action: 'put', value: decision.value }
    }
    if (decision.action === 'delete') {
      idbStore.delete(k)
      return { action: 'deleted', value: undefined }
    }
    return { action: 'kept', value: idbStore.get(k) }
  }),
}))

import {
  BackupStorageWriteError,
  __resetStorageOverflowStateForTests,
  createEmptyBackup,
  getBackupData,
  hasPendingLocalSave,
  isStorageQuotaError,
  loadFromSupabase,
  markTenantDataReady,
  recoverLocalOverflowBackup,
  saveBackupData,
  setActiveTenantUser,
  syncToSupabase,
} from '@/services/backupDataService'

const USER = 'user-quota-1'
const STORAGE_KEY = `poweron_backup_data_${USER}`
const OVERFLOW_KEY = `poweron_backup_overflow:${STORAGE_KEY}`

function makeBackup(marker: string) {
  return { ...createEmptyBackup(), projects: [{ id: marker, name: marker }] as any, _lastSavedAt: marker }
}

function quotaError() {
  const e = new Error('The quota has been exceeded.')
  e.name = 'QuotaExceededError'
  return e
}

describe('storage quota overflow resilience', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
    const testWindow = new EventTarget() as any
    testWindow.location = { hostname: 'localhost' }
    Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 },
    })
    idbStore.clear()
    idbControl.calls = 0
    idbControl.pauseAt = 0
    idbControl.release = null
    __resetStorageOverflowStateForTests()
    supabaseState.capturedPayload = null
    supabaseState.remoteData = null
    supabaseState.remoteWriteError = null
    supabaseState.remoteReadCalls = 0
    supabaseState.pauseRemoteReadAt = 0
    supabaseState.releaseRemoteRead = null
    supabaseState.remoteWriteCalls = 0
    supabaseState.pauseRemoteWriteAt = 0
    supabaseState.releaseRemoteWrite = null
    supabaseState.pendingWrite = null
    vi.restoreAllMocks()
    setActiveTenantUser(USER)
    markTenantDataReady(USER)
  })

  it('detects Safari/Chrome/Firefox quota errors', () => {
    expect(isStorageQuotaError(quotaError())).toBe(true)
    const numeric = Object.assign(new Error('x'), { code: 22 })
    expect(isStorageQuotaError(numeric)).toBe(true)
    const ff = Object.assign(new Error('x'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' })
    expect(isStorageQuotaError(ff)).toBe(true)
    expect(isStorageQuotaError(new Error('network down'))).toBe(false)
    expect(isStorageQuotaError(new BackupStorageWriteError(quotaError()))).toBe(true)
  })

  it('quota failure throws, preserves the edit in memory, and makes NO durable claim up front', () => {
    let failedDetail: any = null
    window.addEventListener('poweron:storage-write-failed', (e) => { failedDetail = (e as CustomEvent).detail }, { once: true })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })

    const edit = makeBackup('edit-1')
    expect(() => saveBackupData(edit, USER)).toThrow(BackupStorageWriteError)

    // The edit is NOT lost: getBackupData returns the in-memory latest, not stale localStorage.
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('edit-1')
    // Honest contract: the failure event flags quota + an exact snapshot generation, but does NOT
    // claim the work was preserved/durable — that is only confirmed later (persist/sync events).
    expect(failedDetail?.quota).toBe(true)
    expect(typeof failedDetail?.at).toBe('string')
    expect(typeof failedDetail?.generation).toBe('string')
    expect(failedDetail?.preserved).toBeUndefined()
  })

  it('emits poweron:storage-overflow-persisted ONLY after the IndexedDB write actually resolves', async () => {
    const persisted: any[] = []
    window.addEventListener('poweron:storage-overflow-persisted', (e) => { persisted.push((e as CustomEvent).detail) })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })

    let failedGeneration = ''
    window.addEventListener('poweron:storage-write-failed', (e) => { failedGeneration = (e as CustomEvent).detail?.generation }, { once: true })
    try { saveBackupData(makeBackup('edit-1'), USER) } catch { /* expected */ }

    // Not claimed synchronously — the durable-confirmation event is deferred to the IDB resolve.
    expect(persisted).toHaveLength(0)
    await vi.waitFor(() => expect(persisted.length).toBe(1))
    expect(persisted[0]).toMatchObject({ key: STORAGE_KEY, generation: failedGeneration })
    expect(idbStore.has(OVERFLOW_KEY)).toBe(true)
  })

  it('does not claim durable recovery when IndexedDB ALSO fails (no persisted event)', async () => {
    const persisted: any[] = []
    window.addEventListener('poweron:storage-overflow-persisted', (e) => { persisted.push((e as CustomEvent).detail) })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    const idb = await import('@/services/idbStorage')
    vi.spyOn(idb, 'idbAtomicUpdate').mockRejectedValueOnce(new Error('idb quota too'))

    try { saveBackupData(makeBackup('edit-1'), USER) } catch { /* expected */ }
    await Promise.resolve(); await Promise.resolve()
    // IDB rejected -> no durability confirmation is ever emitted.
    expect(persisted).toHaveLength(0)
  })

  it('does not claim a plain success: a non-quota write error is not quota and carries no timestamp', () => {
    let failedDetail: any = null
    window.addEventListener('poweron:storage-write-failed', (e) => { failedDetail = (e as CustomEvent).detail }, { once: true })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      const e = new Error('SecurityError: localStorage blocked'); e.name = 'SecurityError'; throw e
    })
    expect(() => saveBackupData(makeBackup('edit-x'), USER)).toThrow(BackupStorageWriteError)
    expect(failedDetail?.quota).toBe(false)
    expect(failedDetail?.at).toBeUndefined()
  })

  it('repeated saves under quota do not grow localStorage without bound', () => {
    // Seed a small good value first.
    saveBackupData(makeBackup('seed'), USER)
    const seededLen = (localStorage.getItem(STORAGE_KEY) || '').length
    expect(seededLen).toBeGreaterThan(0)

    // Now every write throws quota. localStorage must not accumulate the growing blob.
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    for (let i = 0; i < 20; i++) {
      try { saveBackupData(makeBackup(`big-${i}-${'x'.repeat(100)}`), USER) } catch { /* expected */ }
    }
    // localStorage still holds only the seed (never grew); the IDB overflow is a single key.
    expect((localStorage.getItem(STORAGE_KEY) || '').length).toBe(seededLen)
    const overflowKeys = [...idbStore.keys()].filter((k) => k.startsWith('poweron_backup_overflow:'))
    expect(overflowKeys).toEqual([OVERFLOW_KEY])
  })

  it('never deletes existing business data on a quota failure', () => {
    saveBackupData(makeBackup('business-records'), USER)
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('business-records')
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('new-edit'), USER) } catch { /* expected */ }
    // Prior localStorage business data is untouched (we never removeItem/clear).
    expect(localStorage.getItem(STORAGE_KEY)).toContain('business-records')
    // And the read surface shows the newest edit (preserved in memory).
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('new-edit')
  })

  it('keeps the Supabase save path intact: the overflowed edit reaches the cloud payload', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('cloud-edit'), USER) } catch { /* expected */ }

    const result = await syncToSupabase(USER)
    expect(result.success).toBe(true)
    // The cloud upsert carried the latest edit, not a stale/empty blob.
    expect(supabaseState.capturedPayload?.projects?.[0]?.id).toBe('cloud-edit')
  })

  it('overlapping sync A cannot replace or acknowledge newer edit B', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('sync-a'), USER) } catch { /* expected */ }
    await vi.waitFor(() => expect(idbStore.has(OVERFLOW_KEY)).toBe(true))

    // Pause sync A after it captured A but before it prepares the cloud payload.
    supabaseState.pauseRemoteReadAt = 2
    const syncA = syncToSupabase(USER)
    await vi.waitFor(() => expect(supabaseState.releaseRemoteRead).toBeTypeOf('function'))

    try { saveBackupData(makeBackup('edit-b'), USER) } catch { /* expected */ }
    await vi.waitFor(() => expect((idbStore.get(OVERFLOW_KEY) as any)?.data?.projects?.[0]?.id).toBe('edit-b'))
    supabaseState.releaseRemoteRead?.()

    const staleResult = await syncA
    expect(staleResult.success).toBe(false)
    expect(staleResult.skipped).toBe(true)
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('edit-b')
    expect((idbStore.get(OVERFLOW_KEY) as any)?.data?.projects?.[0]?.id).toBe('edit-b')

    supabaseState.pauseRemoteReadAt = 0
    const latestResult = await syncToSupabase(USER)
    expect(latestResult.success).toBe(true)
    expect(supabaseState.capturedPayload?.projects?.[0]?.id).toBe('edit-b')
  })

  it('an already in-flight cloud write for A cannot confirm over newer edit B', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('sync-a'), USER) } catch { /* expected */ }
    await vi.waitFor(() => expect(idbStore.has(OVERFLOW_KEY)).toBe(true))

    const confirmations: any[] = []
    window.addEventListener('poweron:sync-success', (event) => confirmations.push((event as CustomEvent).detail))
    supabaseState.pauseRemoteWriteAt = 1
    const syncA = syncToSupabase(USER)
    await vi.waitFor(() => expect(supabaseState.releaseRemoteWrite).toBeTypeOf('function'))

    try { saveBackupData(makeBackup('edit-b'), USER) } catch { /* expected */ }
    await vi.waitFor(() => expect((idbStore.get(OVERFLOW_KEY) as any)?.data?.projects?.[0]?.id).toBe('edit-b'))
    supabaseState.releaseRemoteWrite?.()

    const staleResult = await syncA
    expect(staleResult.success).toBe(true) // The network write landed, but it is not current.
    expect(confirmations).toHaveLength(0)
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('edit-b')
    expect((idbStore.get(OVERFLOW_KEY) as any)?.data?.projects?.[0]?.id).toBe('edit-b')

    supabaseState.pauseRemoteWriteAt = 0
    expect((await syncToSupabase(USER)).success).toBe(true)
    expect(confirmations).toHaveLength(1)
    expect(supabaseState.remoteData?.projects).toContainEqual(expect.objectContaining({ id: 'edit-b' }))
  })

  it('recovers an overflowed edit from IndexedDB after a reload (memory cleared)', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('survive-reload'), USER) } catch { /* expected */ }
    expect(idbStore.has(OVERFLOW_KEY)).toBe(true)

    // Simulate a fresh page load: in-memory state is gone, localStorage is stale/empty.
    __resetStorageOverflowStateForTests()
    vi.restoreAllMocks()
    setActiveTenantUser(USER)
    expect(getBackupData(USER)?.projects?.[0]?.id).not.toBe('survive-reload') // stale before recovery

    const recovered = await recoverLocalOverflowBackup(USER)
    expect(recovered).toBe(true)
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('survive-reload')
  })

  it('reload while offline restores the overflow generation as durably pending', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('offline-reload'), USER) } catch { /* expected */ }
    await vi.waitFor(() => expect(idbStore.has(OVERFLOW_KEY)).toBe(true))

    __resetStorageOverflowStateForTests()
    setActiveTenantUser(USER)
    markTenantDataReady(USER)
    expect(await recoverLocalOverflowBackup(USER)).toBe(true)
    expect(hasPendingLocalSave()).toBe(true)

    supabaseState.remoteWriteError = 'offline'
    const result = await syncToSupabase(USER)
    expect(result.success).toBe(false)
    expect(hasPendingLocalSave()).toBe(true)
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('offline-reload')
  })

  it('remote hydration defers while a recovered overflow generation is pending', async () => {
    supabaseState.remoteData = { ...makeBackup('remote-older'), _tenantUserId: USER }
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('pending-local'), USER) } catch { /* expected */ }
    await vi.waitFor(() => expect(idbStore.has(OVERFLOW_KEY)).toBe(true))

    __resetStorageOverflowStateForTests()
    setActiveTenantUser(USER)
    const result = await loadFromSupabase(USER, false)
    expect(result.status).toBe('deferred_pending_local')
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('pending-local')
    expect(hasPendingLocalSave()).toBe(true)
  })

  it('happy path is unchanged and clears a prior overflow when space returns', () => {
    // Force an overflow.
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    try { saveBackupData(makeBackup('overflowed'), USER) } catch { /* expected */ }
    expect(idbStore.has(OVERFLOW_KEY)).toBe(true)

    // Space freed: localStorage writes succeed again.
    spy.mockRestore()
    saveBackupData(makeBackup('after-space-freed'), USER)
    // Normal read comes from localStorage, and the stale overflow mirror is cleaned up.
    expect(localStorage.getItem(STORAGE_KEY)).toContain('after-space-freed')
    expect(idbStore.has(OVERFLOW_KEY)).toBe(false)
  })

  it('rejects a STALE IndexedDB overflow when localStorage is newer (ISO timestamps)', async () => {
    const newerLocal = { ...makeBackup('local-newer'), _tenantUserId: USER, _lastSavedAt: '2026-10-14T12:00:00.000Z' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newerLocal))
    const staleOverflow = { ...makeBackup('idb-older'), _tenantUserId: USER, _lastSavedAt: '2026-10-14T06:00:00.000Z' }
    idbStore.set(OVERFLOW_KEY, JSON.stringify(staleOverflow))

    const adopted = await recoverLocalOverflowBackup(USER)
    expect(adopted).toBe(false) // never resurrect stale data over a newer local copy
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('local-newer')
  })

  it('adopts a NEWER IndexedDB overflow over older localStorage (ISO timestamps)', async () => {
    const olderLocal = { ...makeBackup('local-older'), _tenantUserId: USER, _lastSavedAt: '2026-10-14T06:00:00.000Z' }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(olderLocal))
    const newerOverflow = { ...makeBackup('idb-newer'), _tenantUserId: USER, _lastSavedAt: '2026-10-14T12:00:00.000Z' }
    idbStore.set(OVERFLOW_KEY, JSON.stringify(newerOverflow))

    const adopted = await recoverLocalOverflowBackup(USER)
    expect(adopted).toBe(true)
    expect(getBackupData(USER)?.projects?.[0]?.id).toBe('idb-newer')
  })

  it('two tabs cannot let a delayed stale IndexedDB write replace the newer generation', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw quotaError() })
    idbControl.pauseAt = 1
    try { saveBackupData(makeBackup('tab-a-stale'), USER) } catch { /* expected */ }
    await vi.waitFor(() => expect(idbControl.release).toBeTypeOf('function'))

    // A fresh module instance models a second tab while sharing the same origin IDB mock.
    vi.resetModules()
    const tabB = await import('@/services/backupDataService')
    tabB.setActiveTenantUser(USER)
    tabB.markTenantDataReady(USER)
    try { tabB.saveBackupData({ ...tabB.createEmptyBackup(), projects: [{ id: 'tab-b-newer', name: 'tab-b-newer' }] as any, _lastSavedAt: 'tab-b-newer' }, USER) } catch { /* expected */ }
    await vi.waitFor(() => expect((idbStore.get(OVERFLOW_KEY) as any)?.data?.projects?.[0]?.id).toBe('tab-b-newer'))

    idbControl.release?.()
    await vi.waitFor(() => expect(idbControl.calls).toBeGreaterThanOrEqual(2))
    expect((idbStore.get(OVERFLOW_KEY) as any)?.data?.projects?.[0]?.id).toBe('tab-b-newer')
  })
})
