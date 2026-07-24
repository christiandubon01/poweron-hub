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
  deleteOperationsBlueprintScopeLayer,
  deleteUnreferencedOperationsBlueprintWireProfile,
  getOperationsBlueprintAnnotations,
  getOperationsBlueprintAnnotationsRaw,
  getOperationsBlueprintScopeLayers,
  getOperationsBlueprintWireProfiles,
  getLiveBlueprintSetRecords,
  identifyOperationsBlueprintWireProfileReferences,
  mergeBlueprintScopeLayersById,
  mergeBlueprintSetRecordsById,
  mergeBlueprintWireProfilesById,
  resolveOperationsBlueprintWireProfile,
  saveOperationsBlueprintWireProfiles,
  saveOperationsBlueprintScopeLayerAnimationScene,
  saveOperationsBlueprintScopeLayers,
  upsertOperationsBlueprintWireProfile,
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

function wireProfile(id = 'wire_profile_1', projectId = 'project-1', updatedAt = NEW, extra: Record<string, unknown> = {}): any {
  return record(id, updatedAt, {
    projectId,
    name: 'Branch MC',
    installationFamily: 'mc',
    displayColor: '#facc15',
    displayWidth: 3,
    displayStyle: 'solid',
    wastePercent: 5,
    allowedTools: ['circuit-path', 'circuit-arc'],
    isArchived: false,
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
  const testWindow = new EventTarget() as any
  testWindow.location = { hostname: 'localhost' }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow })
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

describe('wire profile library persistence', () => {
  it('saves, loads, and isolates project-scoped profile libraries', async () => {
    const backup = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [wireProfile('wire_profile_project_1', 'project-1')],
          'project-2': [wireProfile('wire_profile_project_2', 'project-2')],
        },
      },
    } as any
    saveBackupData(backup as any)

    await upsertOperationsBlueprintWireProfile(backup, wireProfile('wire_profile_new', 'project-1', NEWER))
    const saved = getBackupData() as any
    expect(getOperationsBlueprintWireProfiles(saved, 'project-1').map((profile) => profile.id)).toEqual(expect.arrayContaining(['wire_profile_project_1', 'wire_profile_new']))
    expect(getOperationsBlueprintWireProfiles(saved, 'project-2').map((profile) => profile.id)).toEqual(['wire_profile_project_2'])
  })

  it('merges profiles by stable id while preserving local-only, remote-only, and same-name records', () => {
    const localOnly = wireProfile('wire_profile_local')
    const remoteOnly = wireProfile('wire_profile_remote', 'project-1', NEWER)
    const staleSameId = wireProfile('wire_profile_same', 'project-1', OLD, { name: 'Stale' })
    const newerSameId = wireProfile('wire_profile_same', 'project-1', NEWER, { name: 'Newer' })
    const sameNameA = wireProfile('wire_profile_name_a', 'project-1', NEW, { name: 'Duplicate Name' })
    const sameNameB = wireProfile('wire_profile_name_b', 'project-1', NEW, { name: 'Duplicate Name' })

    const merged = mergeBlueprintWireProfilesById(
      [remoteOnly, newerSameId, sameNameA],
      [localOnly, staleSameId, sameNameB],
    )
    expect(merged.map((profile) => profile.id)).toEqual(expect.arrayContaining([
      'wire_profile_local',
      'wire_profile_remote',
      'wire_profile_same',
      'wire_profile_name_a',
      'wire_profile_name_b',
    ]))
    expect(merged.find((profile) => profile.id === 'wire_profile_same')?.name).toBe('Newer')
  })

  it('does not delete profiles by omission and preserves remote-only profiles in backup folds', () => {
    const local = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [wireProfile('wire_profile_local')],
        },
      },
    } as any
    const remote = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [wireProfile('wire_profile_remote', 'project-1', NEWER)],
        },
      },
    } as any

    const applied = mergeLocalRecordsIntoRemoteSnapshot(remote, local)
    expect((applied as any).blueprintSummaries.operationsBlueprintWireProfiles['project-1'].map((profile: any) => profile.id)).toEqual(expect.arrayContaining(['wire_profile_local', 'wire_profile_remote']))

    const outgoing = mergeRemoteBlueprintSummariesIntoOutgoing(local, remote)
    expect((outgoing as any).blueprintSummaries.operationsBlueprintWireProfiles['project-1'].map((profile: any) => profile.id)).toEqual(expect.arrayContaining(['wire_profile_local', 'wire_profile_remote']))
  })

  it('keeps Profile B and C live when a stale client saves only updated Profile A', async () => {
    const profileA = wireProfile('wire_profile_A', 'project-1', OLD, { name: 'Profile A' })
    const profileB = wireProfile('wire_profile_B', 'project-1', OLD, { name: 'Profile B' })
    const profileC = wireProfile('wire_profile_C', 'project-1', OLD, { name: 'Profile C' })
    const backup = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [profileA, profileB, profileC],
        },
      },
    } as any
    saveBackupData(backup as any)

    await saveOperationsBlueprintWireProfiles(backup, 'project-1', [
      { ...profileA, name: 'Profile A Updated', updatedAt: NEWER },
    ])

    const savedProfiles = getOperationsBlueprintWireProfiles(getBackupData(), 'project-1')
    const byId = new Map(savedProfiles.map((profile) => [profile.id, profile]))
    expect(savedProfiles).toHaveLength(3)
    expect(byId.get('wire_profile_A')?.name).toBe('Profile A Updated')
    expect(byId.get('wire_profile_B')?.deletedAt).toBeUndefined()
    expect(byId.get('wire_profile_C')?.deletedAt).toBeUndefined()
    expect([...byId.keys()]).toEqual(expect.arrayContaining(['wire_profile_A', 'wire_profile_B', 'wire_profile_C']))
  })

  it('keeps omitted profiles live when stored order differs from stale save payload order', async () => {
    const profileA = wireProfile('wire_profile_A', 'project-1', OLD, { name: 'Profile A' })
    const profileB = wireProfile('wire_profile_B', 'project-1', OLD, { name: 'Profile B' })
    const profileC = wireProfile('wire_profile_C', 'project-1', OLD, { name: 'Profile C' })
    const backup = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [profileC, profileB, profileA],
        },
      },
    } as any
    saveBackupData(backup as any)

    await saveOperationsBlueprintWireProfiles(backup, 'project-1', [
      { ...profileA, name: 'Profile A Updated Again', updatedAt: NEWER },
    ])

    const savedProfiles = getOperationsBlueprintWireProfiles(getBackupData(), 'project-1')
    const byId = new Map(savedProfiles.map((profile) => [profile.id, profile]))
    expect(savedProfiles).toHaveLength(3)
    expect(byId.get('wire_profile_A')?.name).toBe('Profile A Updated Again')
    expect(byId.get('wire_profile_B')?.deletedAt).toBeUndefined()
    expect(byId.get('wire_profile_C')?.deletedAt).toBeUndefined()
  })

  it('merges profile content equivalently when local and remote array order is reversed', () => {
    const remote = [
      wireProfile('wire_profile_remote_only', 'project-1', NEW, { name: 'Remote Only' }),
      wireProfile('wire_profile_conflict', 'project-1', NEWER, { name: 'Remote Newer' }),
      wireProfile('wire_profile_archived', 'project-1', NEW, { name: 'Archived', isArchived: true }),
      wireProfile('wire_profile_same_name_a', 'project-1', NEW, { name: 'Same Name' }),
    ]
    const local = [
      wireProfile('wire_profile_local_only', 'project-1', NEW, { name: 'Local Only' }),
      wireProfile('wire_profile_conflict', 'project-1', OLD, { name: 'Local Older' }),
      wireProfile('wire_profile_tombstoned', 'project-1', NEWER, { name: 'Deleted', deletedAt: NEWER }),
      wireProfile('wire_profile_same_name_b', 'project-1', NEW, { name: 'Same Name' }),
    ]

    const summarize = (profiles: any[]) => Object.fromEntries(
      profiles.map((profile) => [profile.id, {
        name: profile.name,
        isArchived: profile.isArchived,
        deletedAt: profile.deletedAt,
      }]),
    )
    expect(summarize(mergeBlueprintWireProfilesById(remote, local))).toEqual(
      summarize(mergeBlueprintWireProfilesById([...remote].reverse(), [...local].reverse())),
    )
  })

  it('archives exactly one profile and distinguishes active archived and missing references', async () => {
    const backup = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [
            wireProfile('wire_profile_active'),
            wireProfile('wire_profile_archived', 'project-1', NEW, { isArchived: true }),
          ],
        },
      },
    } as any
    saveBackupData(backup as any)

    await upsertOperationsBlueprintWireProfile(backup, wireProfile('wire_profile_active', 'project-1', NEWER, { isArchived: true }))
    const saved = getBackupData() as any
    expect(resolveOperationsBlueprintWireProfile(saved, 'project-1', 'wire_profile_active')).toMatchObject({ status: 'ASSIGNED_ARCHIVED' })
    expect(resolveOperationsBlueprintWireProfile(saved, 'project-1', 'wire_profile_archived')).toMatchObject({ status: 'ASSIGNED_ARCHIVED' })
    expect(resolveOperationsBlueprintWireProfile(saved, 'project-1', 'wire_profile_missing')).toEqual({ status: 'MISSING', profileId: 'wire_profile_missing' })
  })

  it('tombstones exactly one unreferenced profile and refuses referenced profile deletion', async () => {
    const backup = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [
            wireProfile('wire_profile_referenced'),
            wireProfile('wire_profile_unreferenced'),
          ],
        },
        operationsBlueprintAnnotations: {
          'set-1': [
            annotation('ann-profiled', 'set-1', NEW),
            annotation('ann-override', 'set-1', NEW),
          ],
        },
      },
    } as any
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].meta = { shapeKind: 'circuit-path', wireProfileId: 'wire_profile_referenced' }
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][1].meta = { shapeKind: 'circuit-arc', segmentWireProfileIds: ['wire_profile_referenced'] }
    saveBackupData(backup as any)

    expect(identifyOperationsBlueprintWireProfileReferences(backup, 'project-1', 'wire_profile_referenced')).toHaveLength(2)
    await expect(deleteUnreferencedOperationsBlueprintWireProfile(backup, 'project-1', 'wire_profile_referenced')).resolves.toMatchObject({
      localSaved: false,
      error: 'Referenced wire profiles cannot be hard-deleted.',
    })

    const deleteResult = await deleteUnreferencedOperationsBlueprintWireProfile(backup, 'project-1', 'wire_profile_unreferenced')
    expect(deleteResult.localSaved).toBe(true)
    const raw = (getBackupData() as any).blueprintSummaries.operationsBlueprintWireProfiles['project-1']
    expect(raw.find((profile: any) => profile.id === 'wire_profile_unreferenced')?.deletedAt).toBeTruthy()
    expect(raw.find((profile: any) => profile.id === 'wire_profile_referenced')?.deletedAt).toBeUndefined()
  })

  it.each([
    ['meta default', { meta: { shapeKind: 'circuit-path', wireProfileId: 'wire_profile_referenced' } }],
    ['metadata default', { metadata: { shapeKind: 'circuit-path', wireProfileId: 'wire_profile_referenced' } }],
    ['meta segment override', { meta: { shapeKind: 'circuit-path', wireProfileId: 'wire_profile_other', segmentWireProfileIds: ['wire_profile_referenced'] } }],
    ['metadata segment override', { metadata: { shapeKind: 'circuit-path', wireProfileId: 'wire_profile_other', segmentWireProfileIds: ['wire_profile_referenced'] } }],
  ])('refuses deletion for a live circuit reference through %s', async (_label, annotationPatch) => {
    const ann = {
      ...annotation('ann-reference', 'set-1', NEW),
      type: 'shape',
      ...annotationPatch,
    }
    const backup = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [wireProfile('wire_profile_referenced')],
        },
        operationsBlueprintAnnotations: { 'set-1': [ann] },
      },
    } as any

    expect(identifyOperationsBlueprintWireProfileReferences(backup, 'project-1', 'wire_profile_referenced')).toHaveLength(1)
    await expect(deleteUnreferencedOperationsBlueprintWireProfile(backup, 'project-1', 'wire_profile_referenced')).resolves.toMatchObject({
      localSaved: false,
      error: 'Referenced wire profiles cannot be hard-deleted.',
    })
  })

  it('ignores tombstoned annotations and references from other projects during profile deletion', async () => {
    const tombstoned = {
      ...annotation('ann-deleted-reference', 'set-1', NEW),
      type: 'shape',
      meta: { shapeKind: 'circuit-path', wireProfileId: 'wire_profile_referenced' },
      deletedAt: NEWER,
      updatedAt: NEWER,
    }
    const otherProject = {
      ...annotation('ann-other-project-reference', 'set-2', NEW),
      projectId: 'project-2',
      type: 'shape',
      meta: { shapeKind: 'circuit-path', wireProfileId: 'wire_profile_referenced' },
    }
    const backup = {
      blueprintSummaries: {
        operationsBlueprintWireProfiles: {
          'project-1': [wireProfile('wire_profile_referenced')],
        },
        operationsBlueprintAnnotations: {
          'set-1': [tombstoned],
          'set-2': [otherProject],
        },
      },
    } as any
    saveBackupData(backup as any)

    expect(identifyOperationsBlueprintWireProfileReferences(backup, 'project-1', 'wire_profile_referenced')).toHaveLength(0)
    const result = await deleteUnreferencedOperationsBlueprintWireProfile(backup, 'project-1', 'wire_profile_referenced')
    expect(result.localSaved).toBe(true)
    const raw = (getBackupData() as any).blueprintSummaries.operationsBlueprintWireProfiles['project-1']
    expect(raw.find((profile: any) => profile.id === 'wire_profile_referenced')?.deletedAt).toBeTruthy()
  })

  it('loads legacy BackupData without a profile collection safely', () => {
    const legacy = { blueprintSummaries: {} } as any
    expect(getOperationsBlueprintWireProfiles(legacy, 'project-1')).toEqual([])
    expect(legacy.blueprintSummaries.operationsBlueprintWireProfiles).toEqual({})
  })

  it('preserves circuit profile metadata through annotation sanitization and save reload', () => {
    const backup = {
      blueprintSummaries: {
        operationsBlueprintAnnotations: {
          'set-1': [
            annotation('path-profiled', 'set-1', NEW),
            annotation('arc-profiled', 'set-1', NEW),
          ],
        },
      },
    } as any
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].type = 'shape'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].color = '#facc15'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].meta = {
      shapeKind: 'circuit-path',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      pointIds: ['p1', 'p2'],
      segmentIds: ['s1'],
      wireProfileId: 'wire_profile_path',
      segmentWireProfileIds: [null],
      borderColor: '#facc15',
      borderThickness: 3,
      totalDistance: 12,
    }
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][1].type = 'shape'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][1].meta = {
      shapeKind: 'circuit-arc',
      points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
      pointIds: ['p1', 'p2'],
      segmentIds: ['s1'],
      arcCtrls: [{ x: 0.15, y: 0.05 }],
      wireProfileId: 'wire_profile_arc',
      segmentWireProfileIds: ['wire_profile_segment'],
    }

    const raw = getOperationsBlueprintAnnotationsRaw(backup, 'set-1')
    expect(raw[0].meta?.wireProfileId).toBe('wire_profile_path')
    expect(raw[0].meta?.segmentWireProfileIds).toEqual([null])
    expect(raw[0].meta?.points).toHaveLength(2)
    expect(raw[1].meta?.arcCtrls).toEqual([{ x: 0.15, y: 0.05 }])
  })

  it('keeps legacy circuit annotations unassigned without color mapping or load rewrite', () => {
    const backup = {
      blueprintSummaries: {
        operationsBlueprintAnnotations: {
          'set-1': [
            annotation('legacy-yellow-path', 'set-1', NEW),
            annotation('legacy-purple-arc', 'set-1', NEW),
          ],
        },
      },
    } as any
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].type = 'shape'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].color = '#facc15'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].meta = { shapeKind: 'circuit-path', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], segmentIds: ['s1'] }
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][1].type = 'shape'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][1].color = '#a855f7'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][1].meta = { shapeKind: 'circuit-arc', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], segmentIds: ['s1'] }

    const before = JSON.stringify(backup)
    const loaded = getOperationsBlueprintAnnotations(backup, 'set-1')
    expect(loaded.map((ann) => ann.meta?.wireProfileId ?? null)).toEqual([null, null])
    expect(JSON.stringify(backup)).toBe(before)
  })

  it('keeps work-package membership and labor unchanged when profiled circuits exist', () => {
    const backup = {
      blueprintSummaries: {
        operationsBlueprintAnnotations: {
          'set-1': [annotation('profiled-circuit', 'set-1', NEW)],
        },
        operationsBlueprintScopeLayers: {
          'set-1': [scopeLayer('package-1', NEW, {
            selectedAnnotationIds: ['profiled-circuit'],
            itemRefs: [{ annotationId: 'profiled-circuit', pageNumber: 1, label: 'Circuit Path' }],
            roughInHours: 4,
            trimHours: 2,
            testingHours: 1,
            cleanupHours: 0.5,
          })],
        },
      },
    } as any
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].type = 'shape'
    backup.blueprintSummaries.operationsBlueprintAnnotations['set-1'][0].meta = {
      shapeKind: 'circuit-path',
      wireProfileId: 'wire_profile_1',
      segmentIds: ['s1'],
    }

    const layer = getOperationsBlueprintScopeLayers(backup, 'set-1')[0]
    expect(layer.selectedAnnotationIds).toEqual(['profiled-circuit'])
    expect(layer.itemRefs).toEqual([{ annotationId: 'profiled-circuit', pageNumber: 1, label: 'Circuit Path' }])
    expect(layer.roughInHours).toBe(4)
    expect(layer.trimHours).toBe(2)
    expect(layer.testingHours).toBe(1)
    expect(layer.cleanupHours).toBe(0.5)
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

describe('BP-SYNC-FIX-1 Part B: remote apply unions work packages by id', () => {
  const setId = 'ops_bp_set_1'
  const bp = (layers: any[]): any => ({ blueprintSummaries: { operationsBlueprintScopeLayers: { [setId]: layers } } })
  const liveIds = (backup: any): string[] => getOperationsBlueprintScopeLayers(backup, setId).map((l) => l.id)
  const rawIds = (backup: any): string[] => ((backup.blueprintSummaries.operationsBlueprintScopeLayers[setId]) as any[]).map((l) => l.id)

  it('incident shape: remote {A,B,C,D} + local {A,B} apply → all four survive, deterministic order, no dupes', () => {
    const remote = bp([scopeLayer('A'), scopeLayer('B'), scopeLayer('C'), scopeLayer('D')])
    const local = bp([scopeLayer('A'), scopeLayer('B')])
    const applied = mergeLocalRecordsIntoRemoteSnapshot(remote, local)
    expect(liveIds(applied)).toEqual(['A', 'B', 'C', 'D'])
    // Local (winning/visible) order first, remote-only appended in remote order; no id duplicated.
    expect(rawIds(applied)).toEqual(['A', 'B', 'C', 'D'])
    expect(new Set(rawIds(applied)).size).toBe(4)
  })

  it('preserves a local-only package and a remote-only package together', () => {
    const remote = bp([scopeLayer('shared'), scopeLayer('remote-only')])
    const local = bp([scopeLayer('shared'), scopeLayer('local-only')])
    const applied = mergeLocalRecordsIntoRemoteSnapshot(remote, local)
    expect(liveIds(applied).sort()).toEqual(['local-only', 'remote-only', 'shared'])
  })

  it('same-id conflict: newer remote wins, and newer local wins', () => {
    const newerRemote = mergeLocalRecordsIntoRemoteSnapshot(
      bp([scopeLayer('A', NEWER, { crewNotes: 'remote-wins' })]),
      bp([scopeLayer('A', OLD, { crewNotes: 'local-loses' })]),
    )
    expect(getOperationsBlueprintScopeLayers(newerRemote, setId)[0].crewNotes).toBe('remote-wins')

    const newerLocal = mergeLocalRecordsIntoRemoteSnapshot(
      bp([scopeLayer('A', OLD, { crewNotes: 'remote-loses' })]),
      bp([scopeLayer('A', NEWER, { crewNotes: 'local-wins' })]),
    )
    expect(getOperationsBlueprintScopeLayers(newerLocal, setId)[0].crewNotes).toBe('local-wins')
  })

  it('explicit newer tombstone beats an older live package on apply (retained in raw, hidden from live)', () => {
    const remote = bp([scopeLayer('A', NEW, { deletedAt: NEW })])
    const local = bp([scopeLayer('A', OLD)])
    const applied = mergeLocalRecordsIntoRemoteSnapshot(remote, local)
    expect(liveIds(applied)).toEqual([])
    expect(rawIds(applied)).toEqual(['A'])
    expect((applied.blueprintSummaries.operationsBlueprintScopeLayers[setId][0] as any).deletedAt).toBe(NEW)
  })

  it('preserves remote-only itemRefs, animationScene and animationSceneRevision', () => {
    const remoteOnly = scopeLayer('C', NEW, {
      itemRefs: [
        { annotationId: 'a1', pageNumber: 1, label: 'One' },
        { annotationId: 'a2', pageNumber: 1, label: 'Two' },
        { annotationId: 'a3', pageNumber: 2, label: 'Three' },
      ],
      animationScene: animationScene(3),
      animationSceneRevision: 3,
    })
    const applied = mergeLocalRecordsIntoRemoteSnapshot(bp([scopeLayer('A'), remoteOnly]), bp([scopeLayer('A')]))
    const survived = getOperationsBlueprintScopeLayers(applied, setId).find((l) => l.id === 'C')!
    expect(survived.itemRefs).toHaveLength(3)
    expect((survived.animationScene as any).revision).toBe(3)
    expect(survived.animationSceneRevision).toBe(3)
  })

  it('keeps multiple blueprint sets isolated', () => {
    const remote = { blueprintSummaries: { operationsBlueprintScopeLayers: {
      'set-1': [scopeLayer('A'), scopeLayer('C')],
      'set-2': [scopeLayer('X')],
    } } } as any
    const local = { blueprintSummaries: { operationsBlueprintScopeLayers: {
      'set-1': [scopeLayer('A'), scopeLayer('B')],
    } } } as any
    const applied = mergeLocalRecordsIntoRemoteSnapshot(remote, local)
    expect(getOperationsBlueprintScopeLayers(applied, 'set-1').map((l) => l.id).sort()).toEqual(['A', 'B', 'C'])
    expect(getOperationsBlueprintScopeLayers(applied, 'set-2').map((l) => l.id)).toEqual(['X'])
  })

  it('regression: a stale local set-array can no longer drop a more complete remote set', () => {
    // Pre-fix `{ ...remote, ...local }` let local win wholesale, dropping C & D. Union keeps them.
    const remote = bp([scopeLayer('A'), scopeLayer('B'), scopeLayer('C'), scopeLayer('D')])
    const staleLocal = bp([scopeLayer('A', NEWER)])
    const applied = mergeLocalRecordsIntoRemoteSnapshot(remote, staleLocal)
    expect(liveIds(applied).sort()).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('BP-SYNC-FIX-1 Part A: work-package save never deletes by omission; explicit delete', () => {
  const setId = 'set-1'
  const seed = (localLayers: any[], remoteLayers: any[] = localLayers): void => {
    const local = { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { [setId]: localLayers } } } as any
    const remote = { projects: [], settings: {}, blueprintSummaries: { operationsBlueprintScopeLayers: { [setId]: remoteLayers } } } as any
    setActiveTenantUser(supabaseState.userId)
    markTenantDataReady(supabaseState.userId)
    saveBackupData(local, supabaseState.userId)
    supabaseState.remoteData = remote
  }
  // Packages actually persisted to the cloud row after a save (raw incl. tombstones / live / ids).
  const pushedRaw = (): any[] => (supabaseState.capturedPayload?.blueprintSummaries?.operationsBlueprintScopeLayers?.[setId] ?? [])
  const pushedLive = (): any[] => pushedRaw().filter((l: any) => !l.deletedAt)
  const pushedIds = (): string[] => pushedLive().map((l: any) => l.id)
  const tombstonedIds = (): string[] => pushedRaw().filter((l: any) => l.deletedAt).map((l: any) => l.id).sort()

  // ── Group 1: normal save must never delete by omission ──
  it('normal save of only a modified A keeps B, C, D live and tombstones nothing (1.1)', async () => {
    seed([scopeLayer('A'), scopeLayer('B'), scopeLayer('C'), scopeLayer('D')])
    const result = await saveOperationsBlueprintScopeLayers(getBackupData(), setId, [scopeLayer('A', NEWER, { crewNotes: 'edited A' })])
    expect(result).toMatchObject({ success: true })
    expect(pushedIds().sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(tombstonedIds()).toEqual([])
    expect(pushedLive().find((l) => l.id === 'A').crewNotes).toBe('edited A')
  })

  it('normal save adding E keeps A–D and adds E (1.2)', async () => {
    seed([scopeLayer('A'), scopeLayer('B'), scopeLayer('C'), scopeLayer('D')])
    await saveOperationsBlueprintScopeLayers(getBackupData(), setId,
      ['A', 'B', 'C', 'D', 'E'].map((id) => scopeLayer(id)))
    expect(pushedIds().sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(tombstonedIds()).toEqual([])
  })

  it('a stale incoming array cannot drop a remote-only package (1.3)', async () => {
    seed([scopeLayer('A')], [scopeLayer('A'), scopeLayer('D')]) // local knows only A; remote has A + D
    await saveOperationsBlueprintScopeLayers(getBackupData(), setId, [scopeLayer('A', NEWER)])
    expect(pushedIds().sort()).toEqual(['A', 'D'])
    expect(tombstonedIds()).toEqual([])
  })

  it('an empty save payload does not tombstone existing packages (1.4)', async () => {
    seed([scopeLayer('A'), scopeLayer('B'), scopeLayer('C')])
    await saveOperationsBlueprintScopeLayers(getBackupData(), setId, [])
    expect(pushedIds().sort()).toEqual(['A', 'B', 'C'])
    expect(tombstonedIds()).toEqual([])
  })

  it('an existing tombstone stays a tombstone and is not revived by omission (1.5)', async () => {
    const tomb = scopeLayer('B', NEW, { deletedAt: NEW })
    seed([scopeLayer('A'), tomb])
    await saveOperationsBlueprintScopeLayers(getBackupData(), setId, [scopeLayer('A', NEWER)])
    expect(pushedIds()).toEqual(['A'])
    expect(tombstonedIds()).toEqual(['B'])
  })

  // ── Group 2: explicit delete ──
  it('explicit delete of B tombstones only B; A and C stay live and unchanged (test 6)', async () => {
    const b = scopeLayer('B', NEW, { itemRefs: [
      { annotationId: 'b1', pageNumber: 1, label: 'One' },
      { annotationId: 'b2', pageNumber: 2, label: 'Two' },
    ] })
    seed([scopeLayer('A', NEW, { crewNotes: 'A notes' }), b, scopeLayer('C', NEW, { crewNotes: 'C notes' })])
    const result = await deleteOperationsBlueprintScopeLayer(getBackupData(), setId, 'B')
    expect(result).toMatchObject({ success: true })
    expect(pushedIds().sort()).toEqual(['A', 'C'])
    expect(tombstonedIds()).toEqual(['B'])
    const bTomb = pushedRaw().find((l) => l.id === 'B')
    expect(bTomb.deletedAt).toBeTruthy()
    expect(bTomb.itemRefs).toHaveLength(2) // full package content retained inside the tombstone
    // Unrelated packages' timestamps are untouched.
    expect(pushedRaw().find((l) => l.id === 'A').updatedAt).toBe(NEW)
    expect(pushedRaw().find((l) => l.id === 'C').updatedAt).toBe(NEW)
  })

  it('explicit delete of a remote-only package tombstones the exact remote id (test 7)', async () => {
    // local knows only A; R was created on another device and only exists remotely.
    seed([scopeLayer('A')], [scopeLayer('A'), scopeLayer('R', NEW, { itemRefs: [{ annotationId: 'r1', pageNumber: 3, label: 'Ref' }] })])
    const result = await deleteOperationsBlueprintScopeLayer(getBackupData(), setId, 'R')
    expect(result).toMatchObject({ success: true })
    expect(pushedIds().sort()).toEqual(['A'])
    expect(tombstonedIds()).toEqual(['R'])
    expect(pushedRaw().find((l) => l.id === 'R').itemRefs).toHaveLength(1)
  })

  it('a failed cloud write on delete reports cloudSynced:false and never loses other packages (test 8)', async () => {
    seed([scopeLayer('A'), scopeLayer('B')])
    supabaseState.remoteWriteError = 'write rejected'
    const result = await deleteOperationsBlueprintScopeLayer(getBackupData(), setId, 'B')
    expect(result.cloudSynced).toBe(false)
    expect(result.success).toBe(false)
    // A is never lost; the delete is committed locally and retryable (sync paused), not corrupt.
    // The viewer keeps the local delete on a paused save and restores via loadScopeLayers() only
    // when nothing persisted — the package is never permanently hidden by a failed write.
    const localRaw = (getBackupData()!.blueprintSummaries.operationsBlueprintScopeLayers[setId]) as any[]
    expect(localRaw.some((l) => l.id === 'A' && !l.deletedAt)).toBe(true)
  })

  // ── Incident-shaped (Group 4): Circuit 1–16 + Labels ──
  const incidentSet = (): any[] =>
    [...Array.from({ length: 16 }, (_, i) => `Circuit ${i + 1}`), 'Labels'].map((name, i) => scopeLayer(`scope_${i}`, NEW, { name }))

  it('editing Circuit 1 with a stale payload omitting Circuit 14/15/16 + Labels keeps all 17 live (Group 4)', async () => {
    seed(incidentSet())
    // Stale payload carries only the edited Circuit 1 (scope_0), omitting scope_13..scope_16.
    await saveOperationsBlueprintScopeLayers(getBackupData(), setId,
      [scopeLayer('scope_0', NEWER, { name: 'Circuit 1', crewNotes: 'edited' })])
    expect(pushedLive()).toHaveLength(17)
    expect(tombstonedIds()).toEqual([])
    for (const id of ['scope_13', 'scope_14', 'scope_15', 'scope_16']) { // Circuit 14/15/16 + Labels
      const layer = pushedRaw().find((l) => l.id === id)
      expect(layer).toBeTruthy()
      expect(layer.deletedAt).toBeUndefined()
    }
  })

  it('after the incident-shaped edit, an explicit delete tombstones exactly one package (Group 4 cont.)', async () => {
    seed(incidentSet())
    await deleteOperationsBlueprintScopeLayer(getBackupData(), setId, 'scope_16') // "Labels"
    expect(pushedLive()).toHaveLength(16)
    expect(tombstonedIds()).toEqual(['scope_16'])
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
