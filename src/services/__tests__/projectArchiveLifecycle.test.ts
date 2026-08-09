import { describe, expect, it } from 'vitest'
import { isActiveProject } from '../backupDataService'
import {
  mergeAllProjectFinanceIntoRemote,
  mergeAllProjectLifecycleIntoRemote,
  mergeProjectLifecycleIntoRemote,
  stampProjectArchiveLifecycle,
} from '../projectScopeMerge'

const OLD = '2026-08-01T10:00:00.000Z'
const NEW = '2026-08-02T10:00:00.000Z'
const NEWER = '2026-08-03T10:00:00.000Z'

function backup(project: Record<string, any>, extra: Record<string, any> = {}): any {
  return {
    projects: [project],
    logs: [{ id: 'log-1', projId: project.id, notes: 'remote project log' }],
    serviceLogs: [{ id: 'service-1', notes: 'remote service log' }],
    blueprintSummaries: { operationsBlueprintLibrary: [{ id: 'blueprint-1' }] },
    ...extra,
  }
}

function project(extra: Record<string, any> = {}): any {
  return {
    id: 'project-1',
    name: 'Project X',
    status: 'active',
    updatedAt: OLD,
    changeOrders: [{ id: 'co-1', title: 'Remote CO' }],
    rfis: [{ id: 'rfi-1', question: 'Remote RFI' }],
    materials: [{ id: 'material-1', name: 'Remote material' }],
    finance: { manualPaidAdjustment: 25 },
    ...extra,
  }
}

describe('SYNC-01 project archive lifecycle', () => {
  it('keeps a newer remote archive during an unrelated stale local project edit', () => {
    const remote = backup(project({ archived: true, archivedAt: NEW, archivedReason: 'History', updatedAt: NEW }))
    const local = backup(project({ name: 'Project X renamed locally', archived: false, archivedAt: null, updatedAt: OLD }))

    const merged = mergeAllProjectLifecycleIntoRemote(remote, local)
    const result = merged.projects[0] as any

    expect(result.name).toBe('Project X renamed locally')
    expect(result.archived).toBe(true)
    expect(result.archivedAt).toBe(NEW)
    expect(result.archivedReason).toBe('History')
    expect(result.updatedAt).toBe(NEW)
  })

  it('keeps a newer remote restore when the unrelated local save carries a stale archive', () => {
    const remote = backup(project({ archived: false, isArchived: false, archivedAt: null, updatedAt: NEWER }))
    const stale = backup(project({ name: 'Unrelated local edit', archived: true, archivedAt: NEW, updatedAt: NEW }))

    const result = mergeAllProjectLifecycleIntoRemote(remote, stale).projects[0] as any

    expect(result.name).toBe('Unrelated local edit')
    expect(result.archived).toBe(false)
    expect(result.isArchived).toBe(false)
    expect(result.archivedAt).toBeNull()
    expect(result.updatedAt).toBe(NEWER)
  })

  it('stamps archive freshness and preserves archive metadata through the remote merge', () => {
    const remoteProject = project({ changeOrders: [{ id: 'co-remote' }], archivedReason: 'Remote reason' })
    const incomingProject = project({ changeOrders: [{ id: 'co-local' }], archivedReason: 'Requested by owner' })
    stampProjectArchiveLifecycle(incomingProject, true, NEW)

    const resultBackup = mergeProjectLifecycleIntoRemote(backup(remoteProject), backup(incomingProject), 'project-1')
    const result = resultBackup.projects[0] as any

    expect(result).toMatchObject({ archived: true, archivedAt: NEW, archivedReason: 'Requested by owner', updatedAt: NEW })
    expect(result.changeOrders).toEqual([{ id: 'co-remote' }])
  })

  it('stamps restore freshness and keeps the project restored through the remote merge', () => {
    const archived = project({ archived: true, isArchived: true, archivedAt: OLD, archivedReason: 'History', updatedAt: OLD })
    const restored = structuredClone(archived)
    stampProjectArchiveLifecycle(restored, false, NEW)

    const result = mergeProjectLifecycleIntoRemote(backup(archived), backup(restored), 'project-1').projects[0] as any

    expect(result.archived).toBe(false)
    expect(result.isArchived).toBe(false)
    expect(result.archivedAt).toBeNull()
    expect(result.archivedReason).toBe('History')
    expect(result.updatedAt).toBe(NEW)
  })

  it('does not interpret missing legacy archive fields as a newer restore', () => {
    const explicitArchive = backup(project({ archived: true, archivedAt: OLD, updatedAt: OLD }))
    const legacyLocal = backup(project({ name: 'Legacy edit', updatedAt: NEWER }))

    const result = mergeAllProjectLifecycleIntoRemote(explicitArchive, legacyLocal).projects[0] as any

    expect(result.name).toBe('Legacy edit')
    expect(result.archived).toBe(true)
    expect(result.archivedAt).toBe(OLD)
    expect(result.updatedAt).toBe(NEWER)
  })

  it('keeps existing delete and restore-deleted lifecycle ordering unchanged', () => {
    const live = backup(project({ updatedAt: OLD }))
    const deleted = backup(project({ status: 'deleted', deletedAt: NEW, deletedBy: 'owner-1', updatedAt: NEW }))
    const deletedResult = mergeProjectLifecycleIntoRemote(live, deleted, 'project-1').projects[0] as any

    expect(deletedResult).toMatchObject({ status: 'deleted', deletedAt: NEW, deletedBy: 'owner-1', updatedAt: NEW })

    const staleRestore = backup(project({ status: 'active', updatedAt: OLD }))
    const stillDeleted = mergeProjectLifecycleIntoRemote(deleted, staleRestore, 'project-1').projects[0] as any
    expect(stillDeleted).toMatchObject({ status: 'deleted', deletedAt: NEW, deletedBy: 'owner-1', updatedAt: NEW })
  })

  it('leaves the existing project finance field-LWW merge unchanged', () => {
    const remote = backup(project({
      finance: { manualPaidAdjustment: 100 },
      financeUpdatedAt: { manualPaidAdjustment: NEW },
    }))
    const local = backup(project({
      name: 'Local non-finance edit',
      finance: { manualPaidAdjustment: 25 },
      financeUpdatedAt: { manualPaidAdjustment: OLD },
    }))

    const result = mergeAllProjectFinanceIntoRemote(remote, local).projects[0] as any

    expect(result.name).toBe('Local non-finance edit')
    expect(result.finance.manualPaidAdjustment).toBe(100)
    expect(result.financeUpdatedAt.manualPaidAdjustment).toBe(NEW)
  })

  it('does not modify project children, project logs, service logs, or blueprint data', () => {
    const remote = backup(project({ archived: false, archivedAt: null, updatedAt: OLD }))
    const incoming = backup(project({
      archived: true,
      archivedAt: NEW,
      updatedAt: NEW,
      changeOrders: [{ id: 'co-local' }],
      rfis: [{ id: 'rfi-local' }],
      materials: [{ id: 'material-local' }],
      finance: { manualPaidAdjustment: 999 },
    }), {
      logs: [{ id: 'log-local' }],
      serviceLogs: [{ id: 'service-local' }],
      blueprintSummaries: { operationsBlueprintLibrary: [{ id: 'blueprint-local' }] },
    })

    const result = mergeProjectLifecycleIntoRemote(remote, incoming, 'project-1') as any

    expect(result.projects[0].changeOrders).toEqual(remote.projects[0].changeOrders)
    expect(result.projects[0].rfis).toEqual(remote.projects[0].rfis)
    expect(result.projects[0].materials).toEqual(remote.projects[0].materials)
    expect(result.projects[0].finance).toEqual(remote.projects[0].finance)
    expect(result.logs).toEqual(remote.logs)
    expect(result.serviceLogs).toEqual(remote.serviceLogs)
    expect(result.blueprintSummaries).toEqual(remote.blueprintSummaries)
  })

  it('excludes an archived project from the existing active-project predicate', () => {
    const archived = stampProjectArchiveLifecycle(project(), true, NEW)
    expect(isActiveProject(archived)).toBe(false)
  })

  it('returns a restored otherwise-active project to the existing active-project predicate', () => {
    const archived = stampProjectArchiveLifecycle(project(), true, NEW)
    const restored = stampProjectArchiveLifecycle(archived, false, NEWER)
    expect(isActiveProject(restored)).toBe(true)
  })
})
