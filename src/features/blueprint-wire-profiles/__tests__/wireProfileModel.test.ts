import { describe, expect, it, vi } from 'vitest'
import {
  archiveWireProfile,
  createWireProfile,
  createWireProfileId,
  duplicateWireProfile,
  resolveWireProfileStatus,
  sanitizeWireProfile,
} from '../wireProfileModel'

const NOW = '2026-07-24T12:00:00.000Z'

function rawProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wire_profile_existing',
    projectId: 'project-1',
    name: '  Branch MC  ',
    installationFamily: 'mc',
    materialDescription: '  12/2 MC cable  ',
    conductorDescription: '  2#12 + ground  ',
    displayColor: '#facc15',
    displayWidth: 3,
    displayStyle: 'solid',
    wastePercent: 8,
    unitCost: 1.25,
    costReference: '  internal  ',
    allowedTools: ['circuit-path', 'circuit-path', 'circuit-arc'],
    isArchived: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('wire profile model', () => {
  it('sanitizes a valid profile, trims text, deduplicates allowed tools, and adds no labor fields', () => {
    const profile = sanitizeWireProfile(rawProfile())
    expect(profile).toMatchObject({
      id: 'wire_profile_existing',
      projectId: 'project-1',
      name: 'Branch MC',
      materialDescription: '12/2 MC cable',
      conductorDescription: '2#12 + ground',
      costReference: 'internal',
      wastePercent: 8,
      allowedTools: ['circuit-path', 'circuit-arc'],
    })
    expect(Object.keys(profile || {}).some((key) => key.toLowerCase().includes('labor'))).toBe(false)
  })

  it('rejects invalid required fields and supported enums', () => {
    expect(sanitizeWireProfile(rawProfile({ id: '' }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ projectId: '' }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ name: '   ' }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ installationFamily: 'romex' }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ displayStyle: 'dashdot' }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ allowedTools: ['circuit-path', 'measure-distance'] }))).toBeNull()
  })

  it('validates color, width, waste, and unit cost boundaries', () => {
    expect(sanitizeWireProfile(rawProfile({ displayColor: 'yellow' }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ displayWidth: 0 }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ wastePercent: -1 }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ wastePercent: 101 }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ unitCost: -0.01 }))).toBeNull()
    expect(sanitizeWireProfile(rawProfile({ wastePercent: undefined, unitCost: undefined }))?.wastePercent).toBe(0)
  })

  it('creates stable unique ids and duplicates with a new id without merging matching names', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
    expect(createWireProfileId()).toBe('wire_profile_00000000-0000-4000-8000-000000000001')
    expect(createWireProfileId()).toBe('wire_profile_00000000-0000-4000-8000-000000000002')

    const created = createWireProfile({
      projectId: 'project-1',
      name: 'Branch MC',
      installationFamily: 'mc',
      displayColor: '#facc15',
      displayWidth: 3,
      displayStyle: 'solid',
      allowedTools: ['circuit-path'],
    }, NOW)
    const duplicated = duplicateWireProfile(created, NOW)
    expect(duplicated.id).not.toBe(created.id)
    expect(duplicated.name).toBe('Branch MC Copy')
  })

  it('resolves active, archived, unassigned, and missing profile references', () => {
    const active = sanitizeWireProfile(rawProfile())!
    const archived = archiveWireProfile(active)
    expect(resolveWireProfileStatus(active.id, [active])).toMatchObject({ status: 'ASSIGNED_ACTIVE', profileId: active.id })
    expect(resolveWireProfileStatus(active.id, [archived])).toMatchObject({ status: 'ASSIGNED_ARCHIVED', profileId: active.id })
    expect(resolveWireProfileStatus(null, [active])).toEqual({ status: 'UNASSIGNED', profileId: null })
    expect(resolveWireProfileStatus('wire_profile_missing', [active])).toEqual({ status: 'MISSING', profileId: 'wire_profile_missing' })
  })
})
