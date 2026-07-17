import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseState = vi.hoisted(() => ({
  capturedPayload: null as any,
  remoteData: null as any,
  userId: 'user-1',
}))

vi.mock('@/lib/supabase', () => {
  const builder: any = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.upsert = vi.fn((row: any) => {
    supabaseState.capturedPayload = row.data
    return builder
  })
  builder.maybeSingle = vi.fn(async () => ({
    data: supabaseState.remoteData
      ? { data: supabaseState.remoteData, updated_at: '2026-07-17T10:00:00.000Z', user_id: supabaseState.userId }
      : null,
    error: null,
  }))
  builder.single = vi.fn(async () => ({ data: { updated_at: '2026-07-17T10:00:01.000Z' }, error: null }))

  return {
    supabase: {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: supabaseState.userId } } })) },
      from: vi.fn(() => builder),
    },
  }
})

import {
  BackupStorageWriteError,
  clearActiveTenantUser,
  getDeviceId,
  markTenantDataReady,
  mergeLocalRecordsIntoRemoteSnapshot,
  mergeRemoteBlueprintSummariesIntoOutgoing,
  mergeRemoteProjectBlueprintListsIntoOutgoing,
  saveBackupData,
  setActiveTenantUser,
  syncToSupabase,
} from '@/services/backupDataService'
import {
  getLiveBlueprintSetRecords,
  mergeBlueprintSetRecordsById,
} from '@/services/blueprintLibraryService'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(String(key), String(value)) }
}

const OLD = '2026-07-15T10:00:00.000Z'
const NEW = '2026-07-17T10:00:00.000Z'
const NEWER = '2026-07-17T11:00:00.000Z'

function setNavigator(userAgent: string, maxTouchPoints = 0): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent, maxTouchPoints, onLine: true },
  })
}

function record(id: string, updatedAt = NEW, extra: Record<string, unknown> = {}): any {
  return { id, createdAt: OLD, updatedAt, ...extra }
}

function annotation(id: string, blueprintSetId: string, updatedAt = NEW): any {
  return record(id, updatedAt, {
    blueprintSetId,
    projectId: 'project-1',
    pageNumber: 1,
    type: 'note',
    color: '#facc15',
    text: id,
  })
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  setNavigator('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
  vi.spyOn(Math, 'random').mockReturnValue(0.25)
  supabaseState.capturedPayload = null
  supabaseState.remoteData = null
  supabaseState.userId = 'user-1'
  clearActiveTenantUser()
})

describe('merge preservation', () => {
  it('keeps local records during apply and remote-only records in the outgoing build', () => {
    const local = {
      projects: [record('project-1', NEW, { blueprints: [record('legacy-local')] })],
      serviceEstimates: [record('estimate-local', NEW, { notes: 'local estimate note' })],
      blueprintSummaries: {
        operationsBlueprintLibrary: [record('library-local')],
        operationsBlueprintAnnotations: { 'library-local': [annotation('annotation-local', 'library-local')] },
      },
    } as any
    const staleRemote = {
      projects: [record('project-1', OLD, { blueprints: [] })],
      serviceEstimates: [],
      blueprintSummaries: { operationsBlueprintLibrary: [], operationsBlueprintAnnotations: {} },
    } as any

    const applied = mergeLocalRecordsIntoRemoteSnapshot(staleRemote, local)
    expect(applied.serviceEstimates.map((item: any) => item.id)).toContain('estimate-local')
    expect((applied as any).blueprintSummaries.operationsBlueprintLibrary.map((item: any) => item.id)).toContain('library-local')
    expect((applied as any).blueprintSummaries.operationsBlueprintAnnotations['library-local'].map((item: any) => item.id)).toContain('annotation-local')
    expect((applied.projects[0] as any).blueprints.map((item: any) => item.id)).toContain('legacy-local')

    const newerRemote = {
      projects: [record('project-1', NEWER, { blueprints: [record('legacy-remote', NEWER)] })],
      serviceEstimates: [record('estimate-remote', NEWER, { notes: 'remote estimate note' })],
      blueprintSummaries: {
        operationsBlueprintLibrary: [record('library-remote', NEWER)],
        operationsBlueprintAnnotations: { 'library-remote': [annotation('annotation-remote', 'library-remote', NEWER)] },
      },
    } as any
    let outgoing = mergeLocalRecordsIntoRemoteSnapshot(newerRemote, applied)
    outgoing = mergeRemoteProjectBlueprintListsIntoOutgoing(outgoing, newerRemote)
    outgoing = mergeRemoteBlueprintSummariesIntoOutgoing(outgoing, newerRemote)

    expect(outgoing.serviceEstimates.map((item: any) => item.id)).toEqual(expect.arrayContaining(['estimate-local', 'estimate-remote']))
    expect((outgoing.projects[0] as any).blueprints.map((item: any) => item.id)).toEqual(expect.arrayContaining(['legacy-local', 'legacy-remote']))
    expect((outgoing as any).blueprintSummaries.operationsBlueprintLibrary.map((item: any) => item.id)).toEqual(expect.arrayContaining(['library-local', 'library-remote']))
    expect((outgoing as any).blueprintSummaries.operationsBlueprintAnnotations['library-remote'].map((item: any) => item.id)).toContain('annotation-remote')
  })
})

describe('tombstones', () => {
  it('uses delete-safe timestamp precedence', () => {
    const live = record('set-1', NEW)
    const equalTombstone = record('set-1', NEW, { deletedAt: NEW })
    expect(mergeBlueprintSetRecordsById([live], [equalTombstone])[0].deletedAt).toBe(NEW)

    const olderLive = record('set-2', OLD)
    const newerTombstone = record('set-2', NEW, { deletedAt: NEW })
    expect(mergeBlueprintSetRecordsById([olderLive], [newerTombstone])[0].deletedAt).toBe(NEW)

    const olderTombstone = record('set-1', NEW, { deletedAt: NEW })
    const strictlyNewerLive = record('set-1', NEWER)
    expect(mergeBlueprintSetRecordsById([olderTombstone], [strictlyNewerLive])[0].deletedAt).toBeUndefined()
  })

  it('keeps tombstones through apply-push-apply and unions 12 with 13 live records', () => {
    const liveBackup = { blueprintSummaries: { operationsBlueprintLibrary: [record('set-1', OLD)] } } as any
    const deletedBackup = { blueprintSummaries: { operationsBlueprintLibrary: [record('set-1', NEW, { deletedAt: NEW })] } } as any
    const firstApply = mergeLocalRecordsIntoRemoteSnapshot(liveBackup, deletedBackup)
    const pushed = mergeRemoteBlueprintSummariesIntoOutgoing(firstApply, liveBackup)
    const secondApply = mergeLocalRecordsIntoRemoteSnapshot(liveBackup, pushed)
    const raw = (secondApply as any).blueprintSummaries.operationsBlueprintLibrary
    expect(raw[0].deletedAt).toBe(NEW)
    expect(getLiveBlueprintSetRecords(raw)).toHaveLength(0)

    const twelve = Array.from({ length: 12 }, (_, index) => record(`set-${index + 1}`))
    const thirteen = [...twelve, record('set-13')]
    expect(getLiveBlueprintSetRecords(mergeBlueprintSetRecordsById(twelve, thirteen))).toHaveLength(13)
  })
})

describe('storage failure', () => {
  it('throws BackupStorageWriteError and dispatches no save-success event', () => {
    let savedEvents = 0
    let failedEvents = 0
    window.addEventListener('poweron-data-saved', () => { savedEvents++ })
    window.addEventListener('poweron:storage-write-failed', () => { failedEvents++ })
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      const error = new Error('quota exceeded')
      error.name = 'QuotaExceededError'
      throw error
    })

    expect(() => saveBackupData({ projects: [] } as any)).toThrow(BackupStorageWriteError)
    expect(savedEvents).toBe(0)
    expect(failedEvents).toBe(1)
  })
})

describe('device identity', () => {
  it('heals a mismatched platform prefix', () => {
    localStorage.setItem('poweron_device_id', 'Android_xxxxxxxx')
    expect(getDeviceId()).toMatch(/^Windows_/)
    expect(localStorage.getItem('poweron_device_id')).toMatch(/^Windows_/)
  })

  it('detects touch Macintosh as iPad and retains a matching stored id', () => {
    setNavigator('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)
    expect(getDeviceId()).toMatch(/^iPad_/)
    localStorage.setItem('poweron_device_id', 'iPad_abcdefgh')
    expect(getDeviceId()).toBe('iPad_abcdefgh')
  })
})

describe('outgoing device stamp', () => {
  it('always replaces carried remote metadata with the current device id', async () => {
    const userId = supabaseState.userId
    setActiveTenantUser(userId)
    markTenantDataReady(userId)
    const local = {
      projects: [],
      settings: {},
      _syncMeta: { savedBy: 'Android_remote', savedAt: OLD },
    } as any
    saveBackupData(local, userId)
    supabaseState.remoteData = local

    const result = await syncToSupabase(userId, {
      allowOverwriteNewerRemote: true,
      requireFreshRemote: false,
      _suppressSuccessEvent: true,
    })

    expect(result.success).toBe(true)
    expect(supabaseState.capturedPayload._syncMeta.savedBy).toBe(getDeviceId())
    expect(supabaseState.capturedPayload._syncMeta.savedBy).not.toBe('Android_remote')
  })
})
