import { describe, expect, it, vi } from 'vitest'
import {
  archiveWireProfile,
  createWireProfile,
  duplicateWireProfile,
  restoreWireProfile,
} from '../wireProfileModel'
import {
  STARTER_WIRE_PROFILES,
  buildStarterWireProfileCreateInput,
  getMissingStarterWireProfiles,
  starterDefinitionSanitizes,
  summarizeStarterWireProfileResult,
} from '../starterWireProfiles'
import {
  collectMissingWireProfileReferenceIds,
  summarizeWireProfileReferences,
} from '../wireProfileReferenceSummary'
import {
  canApplyWireProfileAsyncResult,
  canDismissWireProfileManager,
  canStartWireProfileAction,
  classifyWireProfileSaveResult,
  dirtyDraftRequiresConfirmation,
  draftFromWireProfile,
  filterWireProfiles,
  getAllowedToolOptionClassName,
  getPreviewStrokeDasharray,
  getUnitCostAffordance,
  getWireProfileCloseRequestResult,
  getWireProfileConfirmCancelResult,
  getWireProfileConfirmedDiscardResult,
  getWireProfileEscapeOutcome,
  getWireProfileLayoutMode,
  getWireProfileListState,
  getWireProfileModalOverlayClassName,
  getWireProfilePreviewLabel,
  getWireProfileProjectChangeResult,
  getWireProfileViewerEscapeResult,
  isWireProfileDraftDirty,
  reconcileWireProfileConfirmationForRefresh,
  reconcileWireProfileSelection,
  shouldCloseWireProfileManagerForProjectChange,
} from '../wireProfileManagerState'
import {
  defaultWireProfileDraft,
  validateWireProfileDraft,
  type WireProfileDraft,
} from '../wireProfileDraftValidation'

const NOW = '2026-07-24T12:00:00.000Z'

function validDraft(overrides: Partial<WireProfileDraft> = {}): WireProfileDraft {
  return { ...defaultWireProfileDraft(), name: ' Branch Circuit ', ...overrides }
}

function profile(id: string, overrides: Record<string, unknown> = {}) {
  return createWireProfile({
    projectId: 'project-1',
    name: id,
    installationFamily: 'cable',
    displayColor: '#facc15',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 0,
    allowedTools: ['circuit-path', 'circuit-arc'],
    ...overrides,
  } as any, NOW)
}

describe('wire profile draft validation', () => {
  it('passes valid drafts, trims free text, preserves explicit zero, and allows decimals', () => {
    const result = validateWireProfileDraft(validDraft({
      materialDescription: '  MC Cable  ',
      conductorDescription: '  12/2 Cu  ',
      costReference: '  NECA  ',
      wastePercent: '7.5',
      unitCost: '0',
    }))
    expect(result.valid).toBe(true)
    expect(result.value).toMatchObject({
      name: 'Branch Circuit',
      materialDescription: 'MC Cable',
      conductorDescription: '12/2 Cu',
      costReference: 'NECA',
      wastePercent: 7.5,
      unitCost: 0,
    })
  })

  it.each([
    ['name', { name: '   ' }],
    ['installationFamily', { installationFamily: 'romex' }],
    ['displayColor', { displayColor: 'yellow' }],
    ['displayWidth', { displayWidth: 0 }],
    ['wastePercent', { wastePercent: -1 }],
    ['wastePercent', { wastePercent: 101 }],
    ['unitCost', { unitCost: -0.01 }],
    ['allowedTools', { allowedTools: [] }],
  ] as Array<[keyof WireProfileDraft, Partial<WireProfileDraft>]>)('returns a field error for invalid %s', (field, patch) => {
    const result = validateWireProfileDraft(validDraft(patch))
    expect(result.valid).toBe(false)
    expect(result.errors[field]).toBeTruthy()
  })
})

describe('wire profile reference summary', () => {
  const annotations = [
    { id: 'a1', projectId: 'project-1', blueprintSetId: 'set-1', pageNumber: 1, meta: { wireProfileId: 'wire_profile_a' } },
    { id: 'a2', projectId: 'project-1', blueprintSetId: 'set-1', pageNumber: 1, meta: { segmentWireProfileIds: ['wire_profile_a', 'wire_profile_a'] } },
    { id: 'a3', projectId: 'project-1', blueprintSetId: 'set-2', pageNumber: 4, metadata: { wireProfileId: 'wire_profile_a', segmentWireProfileIds: ['wire_profile_a'] } },
    { id: 'a4', projectId: 'project-1', blueprintSetId: 'set-2', pageNumber: 4, meta: { wireProfileId: 'wire_profile_a' }, deletedAt: NOW },
    { id: 'a5', projectId: 'project-1', blueprintSetId: '', pageNumber: undefined, meta: { wireProfileId: 'wire_profile_a' } },
  ] as any[]

  it('counts unique live annotations, defaults, segment overrides, sets, and pages safely', () => {
    expect(summarizeWireProfileReferences(annotations, 'wire_profile_a')).toEqual({
      totalLiveReferences: 4,
      annotationReferenceCount: 4,
      quickAccessReferenceCount: 0,
      totalReferenceCount: 4,
      quickAccessSlotKeys: [],
      defaultAssignmentCount: 3,
      segmentOverrideCount: 3,
      blueprintSetCount: 2,
      pageCount: 2,
    })
    expect(summarizeWireProfileReferences(annotations, 'wire_profile_a', ['slot-1', 'slot-3'])).toEqual({
      totalLiveReferences: 6,
      annotationReferenceCount: 4,
      quickAccessReferenceCount: 2,
      totalReferenceCount: 6,
      quickAccessSlotKeys: ['slot-1', 'slot-3'],
      defaultAssignmentCount: 3,
      segmentOverrideCount: 3,
      blueprintSetCount: 2,
      pageCount: 2,
    })
  })

  it('reports missing profile ids without reassignment or placeholder creation', () => {
    expect(collectMissingWireProfileReferenceIds(annotations, ['wire_profile_known'])).toEqual(['wire_profile_a'])
  })
})

describe('starter wire profiles', () => {
  it('defines five valid starter profiles and creates no ids until service/model create', () => {
    expect(STARTER_WIRE_PROFILES.map((starter) => starter.name)).toEqual([
      'NM-B 12/2 Copper',
      'NM-B 12/3 Copper',
      'MC 12/2 Copper',
      'MC 10/2 Copper',
      'Custom Raceway',
    ])
    expect(STARTER_WIRE_PROFILES.some((starter) => 'id' in starter)).toBe(false)
    expect(STARTER_WIRE_PROFILES.every((starter) => starterDefinitionSanitizes('project-1', starter))).toBe(true)
  })

  it('skips existing matching names case-insensitively and assigns project ids to create inputs', () => {
    const missing = getMissingStarterWireProfiles([{ name: ' nm-b 12/2 copper ' }, { name: 'MC 12/2 COPPER' }])
    expect(missing.map((starter) => starter.name)).toEqual(['NM-B 12/3 Copper', 'MC 10/2 Copper', 'Custom Raceway'])
    expect(buildStarterWireProfileCreateInput('project-9', missing[0]).projectId).toBe('project-9')
  })

  it('does not create duplicates when a second starter pass refreshes existing names', () => {
    let existing: Array<{ name: string }> = []
    const first = getMissingStarterWireProfiles(existing)
    existing = [...existing, ...first.map((starter) => ({ name: starter.name }))]
    expect(getMissingStarterWireProfiles(existing)).toEqual([])
  })
})

describe('wire profile manager state model', () => {
  it('separates request-close gating from confirmed force-close actions', () => {
    expect(getWireProfileCloseRequestResult({ busy: false, confirmOpen: false, dirty: false })).toBe('force-close')
    expect(getWireProfileCloseRequestResult({ busy: false, confirmOpen: false, dirty: true })).toBe('open-discard-confirm')
    expect(getWireProfileCloseRequestResult({ busy: true, confirmOpen: false, dirty: false })).toBe('blocked-busy')
    expect(getWireProfileCloseRequestResult({ busy: false, confirmOpen: true, dirty: false })).toBe('blocked-confirm')
    expect(getWireProfileConfirmedDiscardResult({ kind: 'close-manager' })).toBe('force-close')
    expect(getWireProfileCloseRequestResult({ busy: true, confirmOpen: true, dirty: true })).toBe('blocked-busy')
    expect(getWireProfileConfirmedDiscardResult({ kind: 'close-manager' })).toBe('force-close')
    expect(getWireProfileConfirmedDiscardResult({ kind: 'reset-create' })).toBe('apply-local-discard')
    expect(getWireProfileConfirmCancelResult()).toBe('clear-confirm-keep-manager')
  })

  it('models project-change force close and viewer Escape delegation', () => {
    expect(getWireProfileProjectChangeResult({ open: true, previousProjectId: 'project-a', nextProjectId: 'project-b' })).toBe('force-close-reset')
    expect(getWireProfileProjectChangeResult({ open: true, previousProjectId: 'project-a', nextProjectId: 'project-b' })).toBe('force-close-reset')
    expect(getWireProfileProjectChangeResult({ open: false, previousProjectId: 'project-a', nextProjectId: 'project-b' })).toBe('no-op')
    expect(getWireProfileViewerEscapeResult(true)).toBe('delegate-to-manager')
    expect(getWireProfileViewerEscapeResult(false)).toBe('handle-viewer-escape')
  })

  it('closes the manager only for real project identity transitions', () => {
    expect(shouldCloseWireProfileManagerForProjectChange({
      isOpen: true,
      previousProjectId: 'project-a',
      nextProjectId: 'project-a',
    })).toBe(false)
    expect(shouldCloseWireProfileManagerForProjectChange({
      isOpen: true,
      previousProjectId: 'project-a',
      nextProjectId: 'project-b',
    })).toBe(true)
    expect(shouldCloseWireProfileManagerForProjectChange({
      isOpen: false,
      previousProjectId: 'project-a',
      nextProjectId: 'project-b',
    })).toBe(false)
    expect(shouldCloseWireProfileManagerForProjectChange({
      isOpen: true,
      previousProjectId: 'project-a',
      nextProjectId: null,
    })).toBe(true)
    expect(shouldCloseWireProfileManagerForProjectChange({
      isOpen: true,
      previousProjectId: null,
      nextProjectId: null,
    })).toBe(false)
  })

  it('keeps the manager open for same-project open toggles and blueprint-set changes', () => {
    const previousProjectId = 'project-a'
    const nextProjectId = 'project-a'
    expect(shouldCloseWireProfileManagerForProjectChange({
      isOpen: true,
      previousProjectId,
      nextProjectId,
    })).toBe(false)
    expect(shouldCloseWireProfileManagerForProjectChange({
      isOpen: false,
      previousProjectId,
      nextProjectId,
    })).toBe(false)
    expect(getWireProfileProjectChangeResult({
      open: true,
      previousProjectId,
      nextProjectId,
    })).toBe('no-op')
  })

  it('models the viewer project ref effect without an open-immediate-close loop', () => {
    let previousProjectId: string | null = 'project-a'
    const evaluate = (isOpen: boolean, nextProjectId: string | null) => {
      const close = shouldCloseWireProfileManagerForProjectChange({
        isOpen,
        previousProjectId,
        nextProjectId,
      })
      previousProjectId = nextProjectId
      return close
    }
    expect(evaluate(false, 'project-a')).toBe(false)
    expect(evaluate(true, 'project-a')).toBe(false)
    expect(evaluate(true, 'project-a')).toBe(false)
    expect(evaluate(true, 'project-b')).toBe(true)
  })

  it('uses one dismissal and Escape contract for idle, busy, and confirmation states', () => {
    expect(canDismissWireProfileManager({ busy: false, confirmOpen: false })).toBe(true)
    expect(canDismissWireProfileManager({ busy: true, confirmOpen: false })).toBe(false)
    expect(canDismissWireProfileManager({ busy: false, confirmOpen: true })).toBe(false)
    expect(getWireProfileEscapeOutcome({ busy: false, confirmOpen: true })).toBe('cancel-confirm')
    expect(getWireProfileEscapeOutcome({ busy: true, confirmOpen: false })).toBe('ignore')
    expect(getWireProfileEscapeOutcome({ busy: false, confirmOpen: false })).toBe('close')
  })

  it('detects dirty drafts with normalized strings, numbers, and allowed-tool ordering', () => {
    const cleanCreate = defaultWireProfileDraft()
    expect(isWireProfileDraftDirty({ draft: cleanCreate, baselineDraft: defaultWireProfileDraft() })).toBe(false)
    expect(isWireProfileDraftDirty({ draft: { ...cleanCreate, name: 'Branch' }, baselineDraft: cleanCreate })).toBe(true)
    expect(isWireProfileDraftDirty({
      draft: { ...cleanCreate, allowedTools: ['circuit-arc', 'circuit-path'] },
      baselineDraft: { ...cleanCreate, allowedTools: ['circuit-path', 'circuit-arc'] },
    })).toBe(false)
    const savedProfile = profile('edit-clean', { materialDescription: '  MC Cable  ', unitCost: 1.25 })
    expect(isWireProfileDraftDirty({ draft: draftFromWireProfile(savedProfile), baselineDraft: draftFromWireProfile(savedProfile) })).toBe(false)
    expect(isWireProfileDraftDirty({
      draft: { ...draftFromWireProfile(savedProfile), materialDescription: 'MC Cable' },
      baselineDraft: { ...draftFromWireProfile(savedProfile), materialDescription: '  MC Cable  ' },
    })).toBe(false)
    expect(dirtyDraftRequiresConfirmation({ draft: { ...cleanCreate, name: 'Changed' }, baselineDraft: cleanCreate })).toBe(true)
    expect(dirtyDraftRequiresConfirmation({ draft: cleanCreate, baselineDraft: defaultWireProfileDraft() })).toBe(false)
  })

  it('normalizes numeric dirty fields semantically but keeps blank unit cost distinct from zero', () => {
    const cleanCreate = defaultWireProfileDraft()
    expect(isWireProfileDraftDirty({
      draft: { ...cleanCreate, displayWidth: '2.0', wastePercent: '0.0', unitCost: '1.250' },
      baselineDraft: { ...cleanCreate, displayWidth: 2, wastePercent: 0, unitCost: 1.25 },
    })).toBe(false)
    expect(isWireProfileDraftDirty({
      draft: { ...cleanCreate, unitCost: '' },
      baselineDraft: { ...cleanCreate, unitCost: 0 },
    })).toBe(true)
  })

  it('classifies save outcomes conservatively', () => {
    expect(classifyWireProfileSaveResult({ localSaved: false, cloudSynced: false })).toBe('error')
    expect(classifyWireProfileSaveResult({ localSaved: false, cloudSynced: false, warning: 'pending' })).toBe('error')
    expect(classifyWireProfileSaveResult({ localSaved: true, cloudSynced: false })).toBe('warning')
    expect(classifyWireProfileSaveResult({ localSaved: true, cloudSynced: true, warning: 'slow sync' })).toBe('warning')
    expect(classifyWireProfileSaveResult({ localSaved: true, cloudSynced: true })).toBe('success')
    expect(classifyWireProfileSaveResult({ localSaved: true, cloudSynced: true, error: 'nope' })).toBe('error')
    expect(classifyWireProfileSaveResult(undefined)).toBe('error')
  })

  it('rejects stale async results by project, session, mount state, and action token', () => {
    const base = { mounted: true, projectId: 'p1', expectedProjectId: 'p1', sessionId: 2, currentSessionId: 2, actionToken: 7, currentActionToken: 7 }
    expect(canApplyWireProfileAsyncResult(base)).toBe(true)
    expect(canApplyWireProfileAsyncResult({ ...base, projectId: 'p2' })).toBe(false)
    expect(canApplyWireProfileAsyncResult({ ...base, sessionId: 1 })).toBe(false)
    expect(canApplyWireProfileAsyncResult({ ...base, mounted: false })).toBe(false)
    expect(canApplyWireProfileAsyncResult({ ...base, actionToken: 6 })).toBe(false)
    expect(canApplyWireProfileAsyncResult({ ...base, actionToken: 8, currentActionToken: 8 })).toBe(true)
  })

  it('models starter terminal updates with the same async applicability guard', () => {
    const context = { mounted: true, projectId: 'project-a', expectedProjectId: 'project-a', sessionId: 3, currentSessionId: 3, actionToken: 10, currentActionToken: 10 }
    expect(canApplyWireProfileAsyncResult(context)).toBe(true)
    expect(canApplyWireProfileAsyncResult({ ...context, projectId: 'project-b' })).toBe(false)
    expect(canApplyWireProfileAsyncResult({ ...context, sessionId: 2 })).toBe(false)
    expect(canApplyWireProfileAsyncResult({ ...context, currentSessionId: 4 })).toBe(false)
    expect(canApplyWireProfileAsyncResult({ ...context, currentActionToken: 11 })).toBe(false)
  })

  it('models remote refresh draft handling for clean, dirty, and missing selections', () => {
    const before = profile('remote', { materialDescription: 'Old' })
    const after = { ...before, materialDescription: 'New' }
    const oldBaseline = draftFromWireProfile(before)
    const newBaseline = draftFromWireProfile(after)
    const cleanDraft = isWireProfileDraftDirty({ draft: oldBaseline, baselineDraft: oldBaseline }) ? oldBaseline : newBaseline
    const dirtyDraft = { ...oldBaseline, name: 'Unsaved local edit' }
    expect(cleanDraft.materialDescription).toBe('New')
    expect(isWireProfileDraftDirty({ draft: dirtyDraft, baselineDraft: oldBaseline })).toBe(true)
    expect(reconcileWireProfileSelection(before.id, [])).toBeNull()
  })

  it('clears stale refresh confirmations without retargeting selected profiles', () => {
    const target = profile('target')
    const other = profile('other')
    expect(reconcileWireProfileConfirmationForRefresh({ type: 'archive', profileId: target.id }, [target, other])).toEqual({
      confirm: { type: 'archive', profileId: target.id },
      cleared: false,
    })
    expect(reconcileWireProfileConfirmationForRefresh({ type: 'delete', profileId: target.id }, [other])).toEqual({
      confirm: null,
      cleared: true,
    })
    expect(reconcileWireProfileConfirmationForRefresh({ type: 'discard-draft', action: { kind: 'select-profile', profileId: target.id } }, [other])).toEqual({
      confirm: null,
      cleared: true,
    })
    expect(reconcileWireProfileConfirmationForRefresh({ type: 'discard-draft', action: { kind: 'close-manager' } }, [])).toEqual({
      confirm: { type: 'discard-draft', action: { kind: 'close-manager' } },
      cleared: false,
    })
  })

  it('summarizes starter created/skipped/failed/warning outcomes independently', () => {
    expect(summarizeStarterWireProfileResult({
      createdNames: ['A', 'B', 'C'],
      skippedNames: ['D'],
      failed: [{ name: 'E', error: 'No local save' }],
      warnings: [],
    }).text).toBe('Created 3, skipped 1, failed 1.')
    expect(summarizeStarterWireProfileResult({
      createdNames: ['A'],
      skippedNames: ['B'],
      failed: [],
      warnings: ['Cloud pending'],
    }).text).toBe('Created 1, skipped 1, 1 sync warning.')
    expect(summarizeStarterWireProfileResult({
      createdNames: [],
      skippedNames: STARTER_WIRE_PROFILES.map((starter) => starter.name),
      failed: [],
      warnings: [],
    }).text).toBe('All starter profiles already exist.')
  })

  it('exposes form polish and preview accessibility contracts', () => {
    expect(getAllowedToolOptionClassName(true)).toContain('border-blue')
    expect(getAllowedToolOptionClassName(false)).toContain('border-gray')
    expect(getUnitCostAffordance()).toEqual({ prefix: '$', inputMode: 'decimal', hint: 'USD' })
    expect(getWireProfileModalOverlayClassName()).toContain('pointer-events-auto')
    expect(getWireProfilePreviewLabel({ color: '#facc15', width: 2, style: 'dashed' })).toContain('dashed 2px line')
  })

  it('filters active and archived profiles and reports empty states', () => {
    const active = profile('active')
    const archived = profile('archived', { isArchived: true })
    expect(filterWireProfiles([active, archived], 'active')).toEqual([active])
    expect(filterWireProfiles([active, archived], 'archived')).toEqual([archived])
    expect(getWireProfileListState([], 'active')).toBe('empty')
    expect(getWireProfileListState([archived], 'active')).toBe('archived-only')
  })

  it('preserves stable selection, clears missing selection, blocks double submit, and classifies save outcomes', () => {
    const active = profile('stable')
    expect(reconcileWireProfileSelection(active.id, [active])).toBe(active.id)
    expect(reconcileWireProfileSelection('missing', [active])).toBeNull()
    expect(canStartWireProfileAction('idle')).toBe(true)
    expect(canStartWireProfileAction('create')).toBe(false)
    expect(classifyWireProfileSaveResult({ localSaved: true, cloudSynced: true })).toBe('success')
    expect(classifyWireProfileSaveResult({ localSaved: true, cloudSynced: false, warning: 'pending' })).toBe('warning')
    expect(classifyWireProfileSaveResult({ localSaved: false, cloudSynced: false, error: 'nope' })).toBe('error')
  })

  it('resets on project changes and exposes noninteractive modal/preview/layout contracts', () => {
    expect(getWireProfileProjectChangeResult({ open: true, previousProjectId: 'project-1', nextProjectId: 'project-2' })).toBe('force-close-reset')
    expect(getWireProfileProjectChangeResult({ open: false, previousProjectId: 'project-1', nextProjectId: 'project-2' })).toBe('no-op')
    expect(getPreviewStrokeDasharray('solid', 2)).toBeUndefined()
    expect(getPreviewStrokeDasharray('dashed', 2)).toBe('8 4')
    expect(getPreviewStrokeDasharray('dotted', 2)).toBe('0 4.8')
    expect(getWireProfileModalOverlayClassName()).toContain('pointer-events-auto')
    expect(getWireProfileLayoutMode(900)).toBe('desktop')
    expect(getWireProfileLayoutMode(700)).toBe('compact')
  })

  it('uses service/model create, duplicate, archive, restore semantics without labor or annotation mutation fields', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    const created = profile('created')
    const duplicated = duplicateWireProfile(created, NOW)
    const archived = archiveWireProfile(created, NOW)
    const restored = restoreWireProfile(archived, NOW)
    expect(created.id).not.toBe(duplicated.id)
    expect(archived.id).toBe(created.id)
    expect(restored.id).toBe(created.id)
    expect(Object.keys(created).some((key) => key.toLowerCase().includes('labor'))).toBe(false)
    expect(['borderColor', 'borderThickness', 'borderStyle', 'color'].some((key) => key in created)).toBe(false)
  })
})
