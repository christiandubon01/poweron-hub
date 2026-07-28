import { describe, expect, it } from 'vitest'
import {
  ARCHIVED_QUICK_ACCESS_WIRE_PROFILE_MESSAGE,
  MISSING_QUICK_ACCESS_WIRE_PROFILE_MESSAGE,
  QUICK_ACCESS_SLOT_COUNT,
  QUICK_ACCESS_SLOT_KEYS,
  applyQuickAccessWireProfileToAnnotationMeta,
  canonicalQuickAccessWireProfileBindingSignature,
  clearAllQuickAccessWireProfileBindingsForProject,
  clearQuickAccessWireProfileBinding,
  decideQuickAccessWireProfileActivation,
  findQuickAccessWireProfileReferences,
  getQuickAccessSlotKey,
  isQuickAccessSlotKey,
  listSelectableQuickAccessWireProfiles,
  mergeQuickAccessWireProfileBindingsBySlot,
  resolveQuickAccessWireProfileBinding,
  resolveQuickAccessWireProfileDisplay,
  sanitizeQuickAccessWireProfileBindings,
  setQuickAccessWireProfileBinding,
  supportsWireProfileAssignment,
  validateQuickAccessActivationIdentity,
} from '../profileAwareQuickAccess'
import type { WireProfile } from '../types'

const NOW = '2026-07-25T10:00:00.000Z'
const OLDER = '2026-07-25T09:00:00.000Z'
const NEWER = '2026-07-25T11:00:00.000Z'
const EPOCH = '1970-01-01T00:00:00.000Z'

function profile(id: string, patch: Partial<WireProfile> = {}): WireProfile {
  return {
    id,
    projectId: 'project-1',
    name: patch.name || id,
    installationFamily: 'cable',
    displayColor: '#facc15',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 0,
    allowedTools: ['circuit-path', 'circuit-arc'],
    isArchived: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  }
}

describe('supportsWireProfileAssignment', () => {
  it('supports Circuit Path and Circuit Arc shape variants only', () => {
    expect(supportsWireProfileAssignment({ toolType: 'shape', toolVariant: 'circuit-path' })).toBe(true)
    expect(supportsWireProfileAssignment({ toolType: 'shape', toolVariant: 'circuit-arc' })).toBe(true)
    expect(supportsWireProfileAssignment({ toolType: 'shape', toolVariant: 'square' })).toBe(false)
    expect(supportsWireProfileAssignment({ toolType: 'shape', toolVariant: 'electrical-led-strip' })).toBe(false)
    expect(supportsWireProfileAssignment({ toolType: 'shape', toolVariant: 'electrical-receptacle' })).toBe(false)
    expect(supportsWireProfileAssignment({ toolType: 'pen', toolVariant: 'circuit-path' })).toBe(false)
    expect(supportsWireProfileAssignment({ toolType: 'note' })).toBe(false)
  })
})

describe('Quick Access slot keys', () => {
  it('exposes ten stable canonical keys independent of tool', () => {
    expect(QUICK_ACCESS_SLOT_COUNT).toBe(10)
    expect(QUICK_ACCESS_SLOT_KEYS).toEqual([
      'slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5',
      'slot-6', 'slot-7', 'slot-8', 'slot-9', 'slot-10',
    ])
    expect(getQuickAccessSlotKey(0)).toBe('slot-1')
    expect(getQuickAccessSlotKey(9)).toBe('slot-10')
    expect(getQuickAccessSlotKey(-1)).toBeNull()
    expect(getQuickAccessSlotKey(10)).toBeNull()
    expect(isQuickAccessSlotKey('slot-3')).toBe(true)
    expect(isQuickAccessSlotKey('quick-access-1')).toBe(false)
  })
})

describe('binding sanitize and resolve', () => {
  it('treats missing project/slot as Unassigned and keeps missing IDs diagnosable', () => {
    expect(resolveQuickAccessWireProfileBinding({}, 'project-1', 'slot-1')).toBeNull()
    expect(resolveQuickAccessWireProfileBinding({
      'project-1': { 'slot-1': { wireProfileId: null, updatedAt: NOW } },
    }, 'project-1', 'slot-1')).toBeNull()

    const sanitized = sanitizeQuickAccessWireProfileBindings({
      '': { 'slot-1': { wireProfileId: 'wire_profile_x', updatedAt: NOW } },
      'project-1': {
        'slot-1': { wireProfileId: ' wire_profile_a ', updatedAt: NOW },
        'slot-2': 'wire_profile_b',
        'slot-99': { wireProfileId: 'wire_profile_bad', updatedAt: NOW },
        'bad': { wireProfileId: 'wire_profile_c', updatedAt: NOW },
        'slot-3': { wireProfileId: '', updatedAt: NOW },
        'slot-4': { wireProfileId: 'wire_profile_missing_elsewhere', updatedAt: NOW },
      },
    })
    expect(sanitized).toEqual({
      'project-1': {
        'slot-1': { wireProfileId: 'wire_profile_a', updatedAt: NOW },
        'slot-2': { wireProfileId: 'wire_profile_b', updatedAt: '1970-01-01T00:00:00.000Z' },
        'slot-3': { wireProfileId: null, updatedAt: NOW },
        'slot-4': { wireProfileId: 'wire_profile_missing_elsewhere', updatedAt: NOW },
      },
    })
    expect(resolveQuickAccessWireProfileBinding(sanitized, 'project-1', 'slot-4')).toBe('wire_profile_missing_elsewhere')
  })

  it('isolates Project A and Project B slot bindings', () => {
    let bindings = setQuickAccessWireProfileBinding({}, 'project-a', 'slot-1', 'wire_profile_a', NOW)
    bindings = setQuickAccessWireProfileBinding(bindings, 'project-b', 'slot-1', 'wire_profile_b', NOW)
    expect(resolveQuickAccessWireProfileBinding(bindings, 'project-a', 'slot-1')).toBe('wire_profile_a')
    expect(resolveQuickAccessWireProfileBinding(bindings, 'project-b', 'slot-1')).toBe('wire_profile_b')
    bindings = clearQuickAccessWireProfileBinding(bindings, 'project-a', 'slot-1', NEWER)
    expect(resolveQuickAccessWireProfileBinding(bindings, 'project-a', 'slot-1')).toBeNull()
    expect(resolveQuickAccessWireProfileBinding(bindings, 'project-b', 'slot-1')).toBe('wire_profile_b')
  })
})

describe('activation decisions', () => {
  const profiles = [
    profile('wire_profile_active', { name: 'Romex 12-2' }),
    profile('wire_profile_archived', { name: 'MC 12-2', isArchived: true }),
  ]

  it('allows active and unassigned; blocks archived and missing without name/color fallback', () => {
    expect(decideQuickAccessWireProfileActivation('wire_profile_active', profiles)).toMatchObject({
      ok: true,
      wireProfileId: 'wire_profile_active',
      status: 'ASSIGNED_ACTIVE',
    })
    expect(decideQuickAccessWireProfileActivation(null, profiles)).toEqual({
      ok: true,
      wireProfileId: null,
      status: 'UNASSIGNED',
    })
    expect(decideQuickAccessWireProfileActivation('wire_profile_archived', profiles)).toMatchObject({
      ok: false,
      status: 'ASSIGNED_ARCHIVED',
      message: ARCHIVED_QUICK_ACCESS_WIRE_PROFILE_MESSAGE,
    })
    expect(decideQuickAccessWireProfileActivation('wire_profile_gone', profiles)).toMatchObject({
      ok: false,
      status: 'MISSING',
      message: MISSING_QUICK_ACCESS_WIRE_PROFILE_MESSAGE,
    })
    expect(decideQuickAccessWireProfileActivation('Romex 12-2', profiles).ok).toBe(false)
  })

  it('lists active profiles plus current archived/missing binding only', () => {
    const labels = listSelectableQuickAccessWireProfiles(profiles, 'wire_profile_archived').map((entry) => entry.label)
    expect(labels[0]).toBe('Unassigned')
    expect(labels).toContain('Romex 12-2')
    expect(labels).toContain('Archived: MC 12-2')
    expect(labels).not.toContain('MC 12-2')
    expect(listSelectableQuickAccessWireProfiles(profiles, 'wire_profile_gone').some((entry) => entry.status === 'MISSING')).toBe(true)
  })
})

describe('annotation meta application', () => {
  it('sets annotation-level wireProfileId without inventing segment overrides', () => {
    const withProfile = applyQuickAccessWireProfileToAnnotationMeta(
      { shapeKind: 'circuit-path', borderColor: '#facc15', borderThickness: 3, borderStyle: 'dashed' },
      'wire_profile_active',
    )
    expect(withProfile).toEqual({
      shapeKind: 'circuit-path',
      borderColor: '#facc15',
      borderThickness: 3,
      borderStyle: 'dashed',
      wireProfileId: 'wire_profile_active',
    })
    expect('segmentWireProfileIds' in withProfile).toBe(false)

    const unassigned = applyQuickAccessWireProfileToAnnotationMeta(
      { shapeKind: 'circuit-arc', wireProfileId: 'wire_profile_stale' as string | null },
      null,
    )
    expect(unassigned.wireProfileId).toBeNull()
    expect(unassigned.shapeKind).toBe('circuit-arc')
  })
})

describe('identity validation and references', () => {
  it('blocks stale project/blueprint commits', () => {
    expect(validateQuickAccessActivationIdentity({
      activationProjectId: 'project-a',
      activationBlueprintSetId: 'set-a',
      currentProjectId: 'project-b',
      currentBlueprintSetId: 'set-a',
    })).toEqual({ ok: false, reason: 'project-mismatch' })
    expect(validateQuickAccessActivationIdentity({
      activationProjectId: 'project-a',
      activationBlueprintSetId: 'set-a',
      currentProjectId: 'project-a',
      currentBlueprintSetId: 'set-b',
    })).toEqual({ ok: false, reason: 'blueprint-mismatch' })
    expect(validateQuickAccessActivationIdentity({
      activationProjectId: 'project-a',
      activationBlueprintSetId: 'set-a',
      currentProjectId: 'project-a',
      currentBlueprintSetId: 'set-a',
    })).toEqual({ ok: true })
  })

  it('finds Quick Access slot references for delete safety', () => {
    const bindings = setQuickAccessWireProfileBinding(
      setQuickAccessWireProfileBinding({}, 'project-1', 'slot-1', 'wire_profile_a', NOW),
      'project-1',
      'slot-4',
      'wire_profile_a',
      NOW,
    )
    expect(findQuickAccessWireProfileReferences(bindings, 'project-1', 'wire_profile_a')).toEqual(['slot-1', 'slot-4'])
    expect(findQuickAccessWireProfileReferences(bindings, 'project-1', 'wire_profile_b')).toEqual([])
  })
})

describe('per-slot merge', () => {
  it('uses a canonical binding signature that preserves explicit null', () => {
    expect(canonicalQuickAccessWireProfileBindingSignature({
      wireProfileId: null,
      updatedAt: NOW,
    })).toBe(JSON.stringify({ wireProfileId: null, updatedAt: NOW }))
    expect(canonicalQuickAccessWireProfileBindingSignature({
      wireProfileId: 'wire_profile_a',
      updatedAt: NOW,
    })).toBe(JSON.stringify({ wireProfileId: 'wire_profile_a', updatedAt: NOW }))
  })

  it('lets newer incoming and newer remote timestamps win', () => {
    const older = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_old', updatedAt: OLDER } } }
    const newer = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_new', updatedAt: NEWER } } }

    expect(mergeQuickAccessWireProfileBindingsBySlot(older, newer)['project-1']['slot-1']).toEqual({
      wireProfileId: 'wire_profile_new',
      updatedAt: NEWER,
    })
    expect(mergeQuickAccessWireProfileBindingsBySlot(newer, older)['project-1']['slot-1']).toEqual({
      wireProfileId: 'wire_profile_new',
      updatedAt: NEWER,
    })
  })

  it('retains independent slot edits and resolves same-slot conflicts by updatedAt', () => {
    const remote = {
      'project-1': {
        'slot-1': { wireProfileId: 'wire_profile_remote_1', updatedAt: OLDER },
        'slot-2': { wireProfileId: 'wire_profile_remote_2', updatedAt: NOW },
      },
    }
    const local = {
      'project-1': {
        'slot-1': { wireProfileId: 'wire_profile_local_1', updatedAt: NEWER },
        'slot-3': { wireProfileId: 'wire_profile_local_3', updatedAt: NOW },
      },
    }
    expect(mergeQuickAccessWireProfileBindingsBySlot(remote, local)).toEqual({
      'project-1': {
        'slot-1': { wireProfileId: 'wire_profile_local_1', updatedAt: NEWER },
        'slot-2': { wireProfileId: 'wire_profile_remote_2', updatedAt: NOW },
        'slot-3': { wireProfileId: 'wire_profile_local_3', updatedAt: NOW },
      },
    })
  })

  it('keeps project isolation across merge and project-wide clear', () => {
    const merged = mergeQuickAccessWireProfileBindingsBySlot(
      { 'project-a': { 'slot-1': { wireProfileId: 'wire_profile_a', updatedAt: NOW } } },
      { 'project-b': { 'slot-1': { wireProfileId: 'wire_profile_b', updatedAt: NOW } } },
    )
    expect(resolveQuickAccessWireProfileBinding(merged, 'project-a', 'slot-1')).toBe('wire_profile_a')
    expect(resolveQuickAccessWireProfileBinding(merged, 'project-b', 'slot-1')).toBe('wire_profile_b')
    const cleared = clearAllQuickAccessWireProfileBindingsForProject(merged, 'project-a', NEWER)
    expect(resolveQuickAccessWireProfileBinding(cleared, 'project-a', 'slot-1')).toBeNull()
    expect(resolveQuickAccessWireProfileBinding(cleared, 'project-b', 'slot-1')).toBe('wire_profile_b')
  })

  it('uses a commutative content tie-break for equal timestamp profile conflicts', () => {
    const a = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_romex_12_2', updatedAt: NOW } } }
    const b = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_mc_12_2', updatedAt: NOW } } }

    expect(mergeQuickAccessWireProfileBindingsBySlot(a, b)).toEqual(mergeQuickAccessWireProfileBindingsBySlot(b, a))
    expect(mergeQuickAccessWireProfileBindingsBySlot(a, b)['project-1']['slot-1']).toEqual({
      wireProfileId: 'wire_profile_romex_12_2',
      updatedAt: NOW,
    })
  })

  it('keeps equal timestamp explicit null conflicts commutative', () => {
    const nullBinding = { 'project-1': { 'slot-1': { wireProfileId: null, updatedAt: NOW } } }
    const profileBinding = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_a', updatedAt: NOW } } }

    const merged = mergeQuickAccessWireProfileBindingsBySlot(nullBinding, profileBinding)
    expect(merged).toEqual(mergeQuickAccessWireProfileBindingsBySlot(profileBinding, nullBinding))
    expect(merged['project-1']['slot-1']).toEqual({ wireProfileId: null, updatedAt: NOW })
  })

  it('keeps identical equal timestamp entries stable', () => {
    const a = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_a', updatedAt: NOW } } }
    const b = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_a', updatedAt: NOW } } }

    expect(mergeQuickAccessWireProfileBindingsBySlot(a, b)).toEqual(a)
    expect(mergeQuickAccessWireProfileBindingsBySlot(a, b)).toEqual(mergeQuickAccessWireProfileBindingsBySlot(b, a))
  })

  it('resolves legacy epoch string conflicts commutatively', () => {
    const a = { 'project-1': { 'slot-1': 'wire_profile_a' } }
    const b = { 'project-1': { 'slot-1': 'wire_profile_b' } }

    const merged = mergeQuickAccessWireProfileBindingsBySlot(a, b)
    expect(merged).toEqual(mergeQuickAccessWireProfileBindingsBySlot(b, a))
    expect(merged['project-1']['slot-1']).toEqual({ wireProfileId: 'wire_profile_b', updatedAt: EPOCH })
  })

  it('lets modern timestamped entries beat legacy epoch entries', () => {
    const legacy = { 'project-1': { 'slot-1': 'wire_profile_legacy' } }
    const modern = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_modern', updatedAt: NOW } } }

    expect(mergeQuickAccessWireProfileBindingsBySlot(legacy, modern)['project-1']['slot-1']).toEqual({
      wireProfileId: 'wire_profile_modern',
      updatedAt: NOW,
    })
    expect(mergeQuickAccessWireProfileBindingsBySlot(modern, legacy)['project-1']['slot-1']).toEqual({
      wireProfileId: 'wire_profile_modern',
      updatedAt: NOW,
    })
  })

  it('does not erase existing bindings when one side omits the map', () => {
    const existing = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_existing', updatedAt: NOW } } }

    expect(mergeQuickAccessWireProfileBindingsBySlot(existing, {})).toEqual(existing)
    expect(mergeQuickAccessWireProfileBindingsBySlot({}, existing)).toEqual(existing)
  })

  it('persists explicit newer null clears over older profile assignments', () => {
    const assigned = { 'project-1': { 'slot-1': { wireProfileId: 'wire_profile_old', updatedAt: OLDER } } }
    const cleared = { 'project-1': { 'slot-1': { wireProfileId: null, updatedAt: NEWER } } }

    expect(mergeQuickAccessWireProfileBindingsBySlot(assigned, cleared)['project-1']['slot-1']).toEqual({
      wireProfileId: null,
      updatedAt: NEWER,
    })
    expect(mergeQuickAccessWireProfileBindingsBySlot(cleared, assigned)['project-1']['slot-1']).toEqual({
      wireProfileId: null,
      updatedAt: NEWER,
    })
  })
})

describe('display helpers', () => {
  it('does not resolve by profile name or color', () => {
    const profiles = [profile('wire_profile_1', { name: 'Yellow Romex', displayColor: '#facc15' })]
    expect(resolveQuickAccessWireProfileDisplay('#facc15', profiles).status).toBe('MISSING')
    expect(resolveQuickAccessWireProfileDisplay('Yellow Romex', profiles).status).toBe('MISSING')
    expect(resolveQuickAccessWireProfileDisplay('wire_profile_1', profiles).label).toBe('Yellow Romex')
  })
})
