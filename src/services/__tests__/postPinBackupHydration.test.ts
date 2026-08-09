import { beforeEach, describe, expect, it, vi } from 'vitest'

const remoteState = vi.hoisted(() => ({
  data: null as any,
  readCount: 0,
  userId: 'owner-1',
  readGate: null as Promise<void> | null,
}))

vi.mock('@/lib/supabase', () => {
  const builder: any = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => {
    remoteState.readCount += 1
    if (remoteState.readGate) await remoteState.readGate
    return {
      data: remoteState.data
        ? { user_id: remoteState.userId, data: remoteState.data, updated_at: '2026-08-08T12:00:00.000Z' }
        : null,
      error: null,
    }
  })
  return {
    supabase: {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: remoteState.userId } } })) },
      from: vi.fn(() => builder),
    },
  }
})

vi.mock('@/services/relationshipAccountService', () => ({
  getRelationshipAccountsNormalized: vi.fn(async () => []),
}))

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)) }
}

function backup(extra: Record<string, any> = {}): any {
  return {
    logs: [], projects: [], priceBook: [], weeklyData: [], serviceLogs: [],
    triggerRules: [], calcRefs: {}, customers: [], settings: {}, employees: [],
    templates: [], gcContacts: [], serviceLeads: [], agendaSections: [],
    completedArchive: [], projectDashboards: {}, blueprintSummaries: {},
    activeServiceCalls: [], serviceEstimates: [], taskSchedule: [], dailyJobs: [],
    weeklyReviews: [], imports: [], _lastSavedAt: '2026-08-01T00:00:00.000Z',
    _schemaVersion: 1, ...extra,
  }
}

beforeEach(() => {
  vi.resetModules()
  remoteState.data = null
  remoteState.readCount = 0
  remoteState.readGate = null
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  const testWindow = new EventTarget() as any
  testWindow.location = { hostname: 'app.poweronsolutionsllc.com' }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', maxTouchPoints: 0, onLine: true },
  })
})

describe('SYNC-08 BackupData hydration outcomes', () => {
  it('applies newer protected remote state once while preserving a newer unrelated local record', async () => {
    const service = await import('../backupDataService')
    const local = backup({
      settings: {
        theme: 'light',
        fieldUpdatedAt: { theme: '2026-08-01T00:00:00.000Z' },
      },
      projects: [{ id: 'project-1', name: 'Project', archived: false, archivedAt: null, updatedAt: '2026-08-01T00:00:00.000Z' }],
      serviceLogs: [{ id: 'local-log', notes: 'unsynced but newer', updatedAt: '2026-08-09T00:00:00.000Z' }],
    })
    remoteState.data = backup({
      _lastSavedAt: '2026-08-08T12:00:00.000Z',
      settings: {
        theme: 'dark',
        fieldUpdatedAt: { theme: '2026-08-08T12:00:00.000Z' },
      },
      projects: [{ id: 'project-1', name: 'Project', archived: true, archivedAt: '2026-08-08T12:00:00.000Z', updatedAt: '2026-08-08T12:00:00.000Z' }],
    })

    service.setActiveTenantUser(remoteState.userId)
    service.saveBackupData(local, remoteState.userId)

    const result = await service.loadFromSupabase(remoteState.userId)
    const hydrated = service.getBackupData(remoteState.userId)!

    expect(result).toMatchObject({ success: true, merged: true, status: 'applied' })
    expect(remoteState.readCount).toBe(1)
    expect(hydrated.settings.theme).toBe('dark')
    expect(hydrated.projects[0]).toMatchObject({ archived: true, archivedAt: '2026-08-08T12:00:00.000Z' })
    expect(hydrated.serviceLogs).toContainEqual(expect.objectContaining({ id: 'local-log', notes: 'unsynced but newer' }))
  })

  it('reports deferred_pending_local and leaves the tenant cache untouched while a save is pending', async () => {
    const service = await import('../backupDataService')
    const local = backup({ settings: { theme: 'light' } })
    remoteState.data = backup({ settings: { theme: 'dark' }, _lastSavedAt: '2026-08-08T12:00:00.000Z' })

    service.setActiveTenantUser(remoteState.userId)
    service.markTenantDataReady(remoteState.userId)
    service.saveBackupData(local, remoteState.userId)
    expect(service.hasPendingLocalSave()).toBe(true)

    const result = await service.loadFromSupabase(remoteState.userId)

    expect(result).toMatchObject({
      success: true,
      merged: false,
      status: 'deferred_pending_local',
    })
    expect(service.getBackupData(remoteState.userId)?.settings.theme).toBe('light')
  })

  it('does not apply or mark tenant data ready after bootstrap ownership is revoked', async () => {
    const service = await import('../backupDataService')
    remoteState.data = backup({ settings: { theme: 'dark' }, _lastSavedAt: '2026-08-08T12:00:00.000Z' })
    let releaseRead!: () => void
    remoteState.readGate = new Promise<void>(resolve => { releaseRead = resolve })
    let current = true

    service.setActiveTenantUser(remoteState.userId)
    const hydration = service.loadFromSupabase(remoteState.userId, false, () => current)
    await vi.waitFor(() => expect(remoteState.readCount).toBe(1))

    current = false
    releaseRead()
    const result = await hydration

    expect(result).toMatchObject({ success: false, status: 'failed', error: 'Hydration superseded' })
    expect(service.isTenantDataReady()).toBe(false)
    expect(service.getBackupData(remoteState.userId)).toBeNull()
  })
})
