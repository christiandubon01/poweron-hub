import { describe, expect, it } from 'vitest'
import { mergeLocalRecordsIntoRemoteSnapshot } from '../backupDataService'
import {
  mergeRemoteSettingsIntoOutgoing,
  mergeSettingsByField,
  stampSettingsFields,
} from '../settingsScopeMerge'

const OLD = '2026-08-01T10:00:00.000Z'
const NEW = '2026-08-02T10:00:00.000Z'
const NEWER = '2026-08-03T10:00:00.000Z'

function settings(values: Record<string, any>, updatedAt: Record<string, string> = {}): Record<string, any> {
  return { ...values, fieldUpdatedAt: updatedAt, fieldDeletedAt: {} }
}

describe('SYNC-02 settings field/group conflict protection', () => {
  it('keeps a newer remote mile rate while accepting a newer local day target', () => {
    const remote = settings({ mileRate: 0.7, dayTarget: 361 }, { mileRate: NEW, dayTarget: OLD })
    const local = settings({ mileRate: 0.6, dayTarget: 5000 }, { mileRate: OLD, dayTarget: NEWER })

    const merged = mergeSettingsByField(remote, local)

    expect(merged.mileRate).toBe(0.7)
    expect(merged.dayTarget).toBe(5000)
    expect(merged.fieldUpdatedAt).toMatchObject({ mileRate: NEW, dayTarget: NEWER })
  })

  it('keeps a newer remote day target while accepting a newer local mile rate', () => {
    const remote = settings({ mileRate: 0.65, dayTarget: 4500 }, { mileRate: OLD, dayTarget: NEWER })
    const local = settings({ mileRate: 0.72, dayTarget: 361 }, { mileRate: NEW, dayTarget: OLD })

    const merged = mergeSettingsByField(remote, local)

    expect(merged.mileRate).toBe(0.72)
    expect(merged.dayTarget).toBe(4500)
  })

  it('uses the newest scalar edit and lets remote win an exact timestamp tie', () => {
    expect(mergeSettingsByField(
      settings({ tax: 8.75 }, { tax: OLD }),
      settings({ tax: 9.25 }, { tax: NEW }),
    ).tax).toBe(9.25)

    expect(mergeSettingsByField(
      settings({ tax: 8.75 }, { tax: NEW }),
      settings({ tax: 9.25 }, { tax: NEW }),
    ).tax).toBe(8.75)
  })

  it('resolves phase weights as one group without discarding newer local branding', () => {
    const remote = settings(
      { phaseWeights: { rough: 60, trim: 40 }, company: 'Remote Electric' },
      { phaseWeights: NEWER, company: OLD },
    )
    const local = settings(
      { phaseWeights: { rough: 50, trim: 50 }, company: 'Local Electric' },
      { phaseWeights: OLD, company: NEW },
    )

    const merged = mergeSettingsByField(remote, local)

    expect(merged.phaseWeights).toEqual({ rough: 60, trim: 40 })
    expect(merged.company).toBe('Local Electric')
  })

  it('preserves the newest ordered MTO phase group and its order', () => {
    const merged = mergeSettingsByField(
      settings({ mtoPhases: ['Rough', 'Trim', 'Final'], license: 'REMOTE' }, { mtoPhases: NEW, license: OLD }),
      settings({ mtoPhases: ['Trim', 'Rough'], license: 'LOCAL' }, { mtoPhases: OLD, license: NEWER }),
    )

    expect(merged.mtoPhases).toEqual(['Rough', 'Trim', 'Final'])
    expect(merged.license).toBe('LOCAL')
  })

  it('preserves the newest overhead collection while accepting an unrelated edit', () => {
    const remoteOverhead = { essential: [{ id: 'rent', monthly: 2000 }], extra: [], loans: [], vehicle: [] }
    const merged = mergeSettingsByField(
      settings({ overhead: remoteOverhead, gcalUrl: 'remote' }, { overhead: NEWER, gcalUrl: OLD }),
      settings({ overhead: { essential: [] }, gcalUrl: 'local' }, { overhead: OLD, gcalUrl: NEW }),
    )

    expect(merged.overhead).toEqual(remoteOverhead)
    expect(merged.gcalUrl).toBe('local')
  })

  it('does not let legacy unstamped settings erase explicitly protected fields', () => {
    const merged = mergeSettingsByField(
      settings({ mileRate: 0.73, company: 'Protected' }, { mileRate: NEW, company: NEW }),
      { mileRate: 0.5, company: 'Stale', legacyOnly: 'kept' },
    )

    expect(merged.mileRate).toBe(0.73)
    expect(merged.company).toBe('Protected')
    expect(merged.legacyOnly).toBe('kept')
  })

  it('preserves explicit null resets and intentional deletion tombstones', () => {
    const explicitReset = settings({ mileRate: null }, { mileRate: NEWER })
    const mergedReset = mergeSettingsByField(settings({ mileRate: 0.7 }, { mileRate: NEW }), explicitReset)
    expect(mergedReset.mileRate).toBeNull()

    const deleted: Record<string, any> = { company: 'removed locally' }
    delete deleted.company
    stampSettingsFields(deleted, ['company'], NEWER)
    const mergedDelete = mergeSettingsByField(settings({ company: 'Remote Electric' }, { company: NEW }), deleted)

    expect(mergedDelete).not.toHaveProperty('company')
    expect(mergedDelete.fieldDeletedAt).toEqual({ company: NEWER })
  })

  it('protects newer remote settings during a broad unrelated outgoing save', () => {
    const remote: any = {
      settings: settings({ mileRate: 0.76, dayTarget: 361 }, { mileRate: NEWER, dayTarget: OLD }),
      projects: [{ id: 'project-1', name: 'Remote name' }],
    }
    const outgoing: any = {
      settings: settings({ mileRate: 0.6, dayTarget: 4800 }, { mileRate: OLD, dayTarget: NEW }),
      projects: [{ id: 'project-1', name: 'Local unrelated edit' }],
    }

    const merged = mergeRemoteSettingsIntoOutgoing(outgoing, remote)

    expect(merged.settings.mileRate).toBe(0.76)
    expect(merged.settings.dayTarget).toBe(4800)
    expect(merged.projects).toEqual(outgoing.projects)
  })

  it('combines remote refresh with pending local edits field by field', () => {
    const remote: any = {
      settings: settings({ mileRate: 0.8, dayTarget: 361 }, { mileRate: NEWER, dayTarget: OLD }),
      projects: [],
      serviceCalls: [],
    }
    const local: any = {
      settings: settings({ mileRate: 0.6, dayTarget: 5200 }, { mileRate: OLD, dayTarget: NEW }),
      projects: [],
      serviceCalls: [],
    }

    const refreshed = mergeLocalRecordsIntoRemoteSnapshot(remote, local)

    expect(refreshed.settings.mileRate).toBe(0.8)
    expect(refreshed.settings.dayTarget).toBe(5200)
  })
})
