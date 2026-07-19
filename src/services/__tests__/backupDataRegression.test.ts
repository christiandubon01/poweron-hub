import { beforeEach, describe, expect, it, vi } from 'vitest'

const supabaseState = vi.hoisted(() => ({
  capturedPayload: null as any,
  remoteData: null as any,
  remoteReadSequence: [] as Array<{ data: any; updatedAt: string }>,
  remoteReadIndex: 0,
  remoteReadCount: 0,
  remoteWriteError: null as string | null,
  userId: 'user-1',
}))

vi.mock('@/lib/supabase', () => {
  const builder: any = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.upsert = vi.fn((row: any) => {
    supabaseState.capturedPayload = row.data
    if (!supabaseState.remoteWriteError) supabaseState.remoteData = row.data
    return builder
  })
  builder.maybeSingle = vi.fn(async () => {
    supabaseState.remoteReadCount += 1
    const sequenced = supabaseState.remoteReadSequence.length > 0
      ? supabaseState.remoteReadSequence[Math.min(supabaseState.remoteReadIndex++, supabaseState.remoteReadSequence.length - 1)]
      : null
    const remoteData = sequenced?.data ?? supabaseState.remoteData
    return ({
    data: remoteData
      ? { data: remoteData, updated_at: sequenced?.updatedAt ?? '2026-07-17T10:00:00.000Z', user_id: supabaseState.userId }
      : null,
    error: null,
  })})
  builder.single = vi.fn(async () => supabaseState.remoteWriteError
    ? { data: null, error: { message: supabaseState.remoteWriteError } }
    : { data: { updated_at: '2026-07-17T10:00:01.000Z' }, error: null })

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
  compareVerificationSummary,
  computeVerificationSummary,
  getBackupData,
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
  getOperationsBlueprintScopeLayers,
  getLiveBlueprintSetRecords,
  mergeBlueprintScopeLayersById,
  mergeBlueprintSetRecordsById,
  saveOperationsBlueprintScopeLayerAnimationScene,
} from '@/services/blueprintLibraryService'
import { createDefaultBlueprintAnimationScene } from '@/features/blueprint-animation/sceneSchema'

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

function scopeLayer(id = 'package-1', updatedAt = NEW, extra: Record<string, unknown> = {}): any {
  return record(id, updatedAt, {
    name: 'Lighting Package',
    description: 'Keep me',
    color: '#38bdf8',
    selectedAnnotationIds: ['annotation-1'],
    itemRefs: [{ annotationId: 'annotation-1', pageNumber: 1, label: 'Fixture' }],
    roughInHours: 2,
    trimHours: 1,
    testingHours: 0.5,
    cleanupHours: 0.25,
    crewNotes: 'Preserve notes',
    proposalSummary: 'Preserve summary',
    visible: true,
    isolated: false,
    ...extra,
  })
}

function animationScene(revision = 1, extra: Record<string, unknown> = {}): any {
  return {
    ...createDefaultBlueprintAnimationScene({ id: 'scene-1', now: OLD }),
    revision,
    updatedAt: revision > 1 ? NEWER : NEW,
    ...extra,
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  setNavigator('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
  vi.spyOn(Math, 'random').mockReturnValue(0.25)
  supabaseState.capturedPayload = null
  supabaseState.remoteData = null
  supabaseState.remoteReadSequence = []
  supabaseState.remoteReadIndex = 0
  supabaseState.remoteReadCount = 0
  supabaseState.remoteWriteError = null
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

describe('blueprint animation scene preservation', () => {
  it('preserves supported and unsupported scenes through package sanitization and merge', () => {
    const supported = scopeLayer('package-supported', NEW, { animationScene: animationScene(1) })
    const futureScene = { schemaVersion: 7, id: 'future-scene', futureField: { keep: true } }
    const future = scopeLayer('package-future', NEW, { animationScene: futureScene })
    const merged = mergeBlueprintScopeLayersById([], [supported, future])
    expect((merged[0].animationScene as any).revision).toBe(1)
    expect(merged[1].animationScene).toEqual(futureScene)

    const backup = { blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': merged } } }
    expect(getOperationsBlueprintScopeLayers(backup, 'set-1').map((layer) => layer.animationScene)).toEqual([
      supported.animationScene,
      futureScene,
    ])

    const metadataOnlyEdit = scopeLayer('package-supported', NEWER, { crewNotes: 'New metadata, old scene omitted' })
    const sceneSafeMerge = mergeBlueprintScopeLayersById([supported], [metadataOnlyEdit])
    expect(sceneSafeMerge[0].crewNotes).toBe('New metadata, old scene omitted')
    expect((sceneSafeMerge[0].animationScene as any).revision).toBe(1)
  })

  it('preserves scenes through apply-push-apply package merges', () => {
    const local = { blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [scopeLayer('package-1', NEW, { animationScene: animationScene(1) })] } } } as any
    const remote = { blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [scopeLayer('package-1', OLD)] } } } as any
    const applied = mergeLocalRecordsIntoRemoteSnapshot(remote, local)
    const outgoing = mergeRemoteBlueprintSummariesIntoOutgoing(applied, remote)
    const reapplied = mergeLocalRecordsIntoRemoteSnapshot(remote, outgoing)
    expect((reapplied as any).blueprintSummaries.operationsBlueprintScopeLayers['set-1'][0].animationScene.revision).toBe(1)
  })

  it('verified-save fingerprint detects a scene dropped from an existing package', () => {
    const withScene = { blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [scopeLayer('package-1', NEW, { animationScene: animationScene(1) })] } }, _lastSavedAt: NEW } as any
    const withoutScene = { blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [scopeLayer('package-1', NEW)] } }, _lastSavedAt: NEW } as any
    const expected = computeVerificationSummary(withScene)
    const actual = computeVerificationSummary(withoutScene)
    expect(expected.blueprintWorkPackageSetCount).toBe(actual.blueprintWorkPackageSetCount)
    expect(expected.blueprintAnimationSceneCount).toBe(1)
    expect(compareVerificationSummary(expected, actual)).toMatchObject({ verified: false })

    const removedWithMarker = { blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [scopeLayer('package-1', NEW, { animationSceneRevision: 2 })] } }, _lastSavedAt: NEW } as any
    const removedWithoutMarker = { blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [scopeLayer('package-1', NEW)] } }, _lastSavedAt: NEW } as any
    expect(computeVerificationSummary(removedWithMarker).blueprintAnimationSceneCount).toBe(0)
    expect(compareVerificationSummary(
      computeVerificationSummary(removedWithMarker),
      computeVerificationSummary(removedWithoutMarker),
    )).toMatchObject({ verified: false })
  })
})

describe('revision-aware animation scene save', () => {
  async function captureSyncSuccessEvents<T>(run: () => Promise<T>): Promise<{
    result: T
    events: Array<{ detail: any; remoteReadCount: number }>
    finalRemoteReadCount: number
  }> {
    const events: Array<{ detail: any; remoteReadCount: number }> = []
    const listener = (event: Event) => {
      events.push({
        detail: (event as CustomEvent).detail,
        remoteReadCount: supabaseState.remoteReadCount,
      })
    }
    window.addEventListener('poweron:sync-success', listener)
    try {
      const result = await run()
      return { result, events, finalRemoteReadCount: supabaseState.remoteReadCount }
    } finally {
      window.removeEventListener('poweron:sync-success', listener)
    }
  }

  function seedSceneSave(localLayer: any, remoteLayer = localLayer): void {
    const local = { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [localLayer] } } } as any
    const remote = { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [remoteLayer] } } } as any
    setActiveTenantUser(supabaseState.userId)
    markTenantDataReady(supabaseState.userId)
    saveBackupData(local, supabaseState.userId)
    supabaseState.remoteData = remote
  }

  it('emits one verified success event only after first-sync read-back succeeds', async () => {
    seedSceneSave(scopeLayer())
    supabaseState.remoteData = null
    const captured = await captureSyncSuccessEvents(() => saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 0,
      nextScene: animationScene(1), now: NEWER,
    }))
    expect(captured.result).toMatchObject({ success: true, cloudSynced: true, scene: { revision: 1 } })
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0]).toMatchObject({
      detail: { verified: true },
      remoteReadCount: captured.finalRemoteReadCount,
    })
    expect(captured.events[0].remoteReadCount).toBeGreaterThanOrEqual(2)
  })

  it('emits one verified success event for an existing scene update', async () => {
    const revisionOne = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    seedSceneSave(revisionOne)
    const captured = await captureSyncSuccessEvents(() => saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: animationScene(1, { id: 'updated-scene' }), now: NEWER,
    }))
    expect(captured.result).toMatchObject({ success: true, scene: { revision: 2, id: 'updated-scene' } })
    expect(captured.events).toHaveLength(1)
    expect(captured.events[0]).toMatchObject({ detail: { verified: true }, remoteReadCount: captured.finalRemoteReadCount })
  })

  it('performs an initial save at revision 1 and preserves membership and unrelated fields', async () => {
    seedSceneSave(scopeLayer())
    const result = await saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 0,
      nextScene: animationScene(1), now: NEWER,
    })
    expect(result).toMatchObject({ success: true, scene: { revision: 1, updatedAt: NEWER } })
    const savedLayer = (supabaseState.capturedPayload as any).blueprintSummaries.operationsBlueprintScopeLayers['set-1'][0]
    expect(savedLayer.selectedAnnotationIds).toEqual(['annotation-1'])
    expect(savedLayer.crewNotes).toBe('Preserve notes')
    expect(savedLayer.updatedAt).toBe(NEWER)
  })

  it('increments exactly once and rejects a stale local revision', async () => {
    seedSceneSave(scopeLayer('package-1', NEW, { animationScene: animationScene(1) }))
    const success = await saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: animationScene(99), now: NEWER,
    })
    expect(success).toMatchObject({ success: true, scene: { revision: 2 } })
    supabaseState.remoteData = supabaseState.capturedPayload
    supabaseState.capturedPayload = null
    const stale = await saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: animationScene(1), now: NEWER,
    })
    expect(stale).toMatchObject({ success: false, conflict: true, reason: 'stale-local-revision' })
    expect(supabaseState.capturedPayload).toBeNull()
  })

  it('does not overwrite a newer remote scene and returns both saved scene and caller draft', async () => {
    const localLayer = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    const remoteLayer = scopeLayer('package-1', NEWER, { animationScene: animationScene(2) })
    seedSceneSave(localLayer, remoteLayer)
    const draft = animationScene(1, { id: 'caller-draft' })
    const result = await saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: draft, now: NEWER,
    })
    expect(result).toMatchObject({
      success: false, conflict: true, reason: 'stale-remote-revision',
      currentScene: { revision: 2 }, callerDraft: { id: 'caller-draft' },
    })
    expect(supabaseState.capturedPayload).toBeNull()
  })

  it('rejects a malformed function-updater draft instead of treating it as scene removal', async () => {
    const revisionOne = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    seedSceneSave(revisionOne)
    const result = await saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: (() => ({ schemaVersion: 99, id: 'future-draft' } as any)), now: NEWER,
    })
    expect(result).toMatchObject({ success: false, conflict: true, reason: 'invalid-next-scene' })
    expect(supabaseState.capturedPayload).toBeNull()
    expect((getBackupData() as any).blueprintSummaries.operationsBlueprintScopeLayers['set-1'][0].animationScene.revision).toBe(1)
  })

  it('rejects a remote scene that advances during the second preflight', async () => {
    const revisionOne = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    const revisionTwo = scopeLayer('package-1', NEWER, { animationScene: animationScene(2) })
    seedSceneSave(revisionOne, revisionOne)
    supabaseState.remoteReadSequence = [
      { data: { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [revisionOne] } } }, updatedAt: NEW },
      { data: { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [revisionTwo] } } }, updatedAt: NEWER },
    ]
    const result = await saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: animationScene(1, { id: 'caller-draft' }), now: NEWER,
    })
    expect(result).toMatchObject({ success: false, conflict: true, reason: 'stale-remote-revision', currentScene: { revision: 2 } })
    expect(supabaseState.capturedPayload).toBeNull()
  })

  it('does not report success when an equal-revision concurrent scene wins after preflight', async () => {
    const revisionOne = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    const competingRevisionTwo = scopeLayer('package-1', NEWER, {
      animationScene: animationScene(2, { id: 'competing-scene' }),
      animationSceneRevision: 2,
    })
    seedSceneSave(revisionOne, revisionOne)
    const snapshotOne = { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [revisionOne] } } }
    const competingSnapshot = { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { 'set-1': [competingRevisionTwo] } } }
    supabaseState.remoteReadSequence = [
      { data: snapshotOne, updatedAt: NEW },
      { data: snapshotOne, updatedAt: NEW },
      { data: competingSnapshot, updatedAt: NEWER },
    ]
    const captured = await captureSyncSuccessEvents(() => saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: animationScene(1, { id: 'caller-scene' }), now: NEWER,
    }))
    expect(captured.result).toMatchObject({ success: false, conflict: true, reason: 'remote-conflict-unresolved' })
    expect(captured.events).toHaveLength(0)
    expect((supabaseState.capturedPayload as any).blueprintSummaries.operationsBlueprintScopeLayers['set-1'][0].animationScene.id).toBe('competing-scene')
  })

  it('emits no success event when the remote write fails', async () => {
    const revisionOne = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    seedSceneSave(revisionOne)
    supabaseState.remoteWriteError = 'write rejected'
    const captured = await captureSyncSuccessEvents(() => saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: animationScene(1, { id: 'unsaved-scene' }), now: NEWER,
    }))
    expect(captured.result).toMatchObject({ success: false, conflict: true, reason: 'remote-conflict-unresolved' })
    expect(captured.events).toHaveLength(0)
  })

  it('rejects a stale save after the remote scene was explicitly removed', async () => {
    const localRevisionOne = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    const remoteRemoval = scopeLayer('package-1', NEWER, { animationSceneRevision: 2 })
    seedSceneSave(localRevisionOne, remoteRemoval)
    const result = await saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: animationScene(1, { id: 'stale-draft' }), now: NEWER,
    })
    expect(result).toMatchObject({ success: false, conflict: true, reason: 'stale-remote-revision' })
    expect(supabaseState.capturedPayload).toBeNull()
  })

  it('removes a scene with a matching revision and rejects stale removal', async () => {
    const revisionOne = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    seedSceneSave(revisionOne)
    const verifiedRemoval = await captureSyncSuccessEvents(() => saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: null, now: NEWER,
    }))
    expect(verifiedRemoval.result).toMatchObject({ success: true, scene: undefined })
    expect(verifiedRemoval.events).toHaveLength(1)
    expect(verifiedRemoval.events[0]).toMatchObject({ detail: { verified: true } })
    const removedLayer = (supabaseState.capturedPayload as any).blueprintSummaries.operationsBlueprintScopeLayers['set-1'][0]
    expect(removedLayer.animationScene).toBeUndefined()
    expect(removedLayer.animationSceneRevision).toBe(2)

    const localLayer = scopeLayer('package-1', NEW, { animationScene: animationScene(1) })
    const remoteLayer = scopeLayer('package-1', NEWER, { animationScene: animationScene(2) })
    seedSceneSave(localLayer, remoteLayer)
    supabaseState.capturedPayload = null
    const staleRemoval = await captureSyncSuccessEvents(() => saveOperationsBlueprintScopeLayerAnimationScene({
      blueprintSetId: 'set-1', scopeLayerId: 'package-1', expectedBaseRevision: 1,
      nextScene: null, now: NEWER,
    }))
    expect(staleRemoval.result).toMatchObject({ success: false, conflict: true, reason: 'stale-remote-revision' })
    expect(staleRemoval.events).toHaveLength(0)
    expect(supabaseState.capturedPayload).toBeNull()
  })
})
