import { describe, expect, it, vi } from 'vitest'
import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import { buildManualKnownDistanceCalibration } from '@/features/blueprint-measurements'
import {
  buildSourceFingerprint,
  buildWorkOrderPayloadV1Draft,
  finalizeWorkOrderPayloadV1,
  getWorkOrderPayloadByteLength,
} from '../buildWorkOrderPayloadV1'

vi.mock('@/features/blueprint-animation/routeBuilderModel', () => ({
  loadPackageAnimationRouteDraft: vi.fn((options) => options.scene === 'mock-scene'
    ? { source: { annotationId: 'source' }, transitions: [], branches: [] }
    : { readOnlyReason: 'unsupported' }),
  getPackageAnimationRouteList: vi.fn(() => [
    { id: 'source', number: 1, label: ' Main Panel ', typeLabel: 'Source device', isSource: true },
    { id: 'step-2', number: 2, label: ' Kitchen homerun ', typeLabel: 'Circuit Path segment' },
  ]),
  getPackageAnimationBranchSummaries: vi.fn(() => [
    { id: 'branch-1', originSelectionId: 'step-2', originLabel: 'Kitchen homerun', originNumber: 2, stepCount: 1, endpointLabel: 'Island receptacle', editing: false },
  ]),
}))

const pageSize = { pageWidthInches: 10, pageHeightInches: 10 }
const calibration = buildManualKnownDistanceCalibration(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 100, 'ft', pageSize)

function ann(id: string, shapeKind: string, patch: Partial<BlueprintAnnotation> = {}): BlueprintAnnotation {
  return {
    id,
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    type: 'shape',
    color: '#38bdf8',
    meta: {
      shapeKind,
      points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      segmentIds: [`${id}-s1`],
      wireProfileId: 'wire_profile_a',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  } as BlueprintAnnotation
}

function pkg(patch: Partial<BlueprintScopeLayer> = {}): BlueprintScopeLayer {
  return {
    id: 'package-1',
    name: '  Kitchen Rough-In  ',
    description: '  Install devices  ',
    color: '#38bdf8',
    selectedAnnotationIds: ['a2', 'a1'],
    itemRefs: [
      { annotationId: 'item-2', pageNumber: 2, label: '  Switch  ', countValue: 2 },
      { annotationId: 'item-1', pageNumber: 1, label: ' Receptacle ', countValue: -5 },
    ],
    roughInHours: 1.234,
    trimHours: 2.345,
    testingHours: Number.NaN,
    cleanupHours: -4,
    crewNotes: '  Pull before drywall  ',
    proposalSummary: 'Should never freeze',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    visible: true,
    isolated: false,
    ...patch,
  }
}

function profile(patch: Partial<WireProfile> = {}): WireProfile {
  return {
    id: 'wire_profile_a',
    projectId: 'project-1',
    name: '12/2 MC',
    materialDescription: '  MC cable copper conductors  ',
    installationFamily: 'mc',
    displayColor: '#38bdf8',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 10,
    unitCost: 999,
    allowedTools: ['circuit-path', 'circuit-arc'],
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function build(patch: Partial<BlueprintScopeLayer> = {}) {
  return buildWorkOrderPayloadV1Draft({
    projectId: 'project-1',
    projectName: ' Project One ',
    blueprintSetId: 'set-1',
    blueprintTitle: ' Sheet E1 ',
    workPackage: pkg(patch),
    annotations: [
      ann('a1', 'electrical-receptacle'),
      ann('a2', 'circuit-path'),
    ],
    wireProfiles: [profile()],
    savedCalibrations: { 1: calibration },
    detectedScales: {},
    getPageSizeInches: () => pageSize,
  })
}

describe('buildWorkOrderPayloadV1Draft', () => {
  it('normalizes schema v1 payloads and recomputes labor totals', () => {
    const final = finalizeWorkOrderPayloadV1(build(), {
      assignmentId: 'assignment-1',
      orgId: 'org-1',
      createdAt: '2026-01-03T00:00:00.000Z',
      createdBy: 'user-1',
    })
    expect(final.schemaVersion).toBe(1)
    expect(final.workOrderVersion).toBe(1)
    expect(final.identity).toMatchObject({ assignmentId: 'assignment-1', orgId: 'org-1', createdBy: 'user-1' })
    expect(final.scope).toEqual({ title: 'Kitchen Rough-In', description: 'Install devices', crewNotes: 'Pull before drywall' })
    expect(final.labor).toEqual({ roughInHours: 1.23, trimHours: 2.35, testingHours: 0, cleanupHours: 0, totalHours: 3.58 })
  })

  it('preserves meaningful Crew Notes line breaks and omits blank notes', () => {
    const notes = build({ crewNotes: '  Pull home runs first.\n\nLeave two loops at the panel.  ' })
    expect(notes.scope.crewNotes).toBe('Pull home runs first.\n\nLeave two loops at the panel.')
    const blank = build({ crewNotes: ' \n\t ' })
    expect(blank.scope).not.toHaveProperty('crewNotes')
  })

  it('captures assignment-specific Work Order Instructions independently from Crew Notes', () => {
    const withInstructions = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      blueprintTitle: 'E1',
      dueDate: '2026-07-31',
      workOrderInstructions: '  Coordinate shutdown.\n\nCall the foreman before energizing.  ',
      workPackage: pkg({ crewNotes: 'Package-level note' }),
      annotations: [],
    })
    expect(withInstructions.identity.dueDate).toBe('2026-07-31')
    expect(withInstructions.scope.crewNotes).toBe('Package-level note')
    expect(withInstructions.workOrderInstructions).toBe('Coordinate shutdown.\n\nCall the foreman before energizing.')

    const blank = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      workOrderInstructions: ' \n\t ',
      workPackage: pkg(),
      annotations: [],
    })
    expect(blank).not.toHaveProperty('workOrderInstructions')
  })

  it('captures Crew Notes by value so later owner edits cannot change the issued draft', () => {
    const sourcePackage = pkg({ crewNotes: 'First line\nSecond line' })
    const draft = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      workPackage: sourcePackage,
      annotations: [],
    })
    sourcePackage.crewNotes = 'Changed after issuance'
    expect(draft.scope.crewNotes).toBe('First line\nSecond line')
  })

  it('freezes sorted items, package symbol counts, and package wire rollups only', () => {
    const draft = build()
    expect(draft.items).toEqual([
      { sourceId: 'item-1', name: 'Receptacle', quantity: 0, pageNumber: 1 },
      { sourceId: 'item-2', name: 'Switch', quantity: 2, pageNumber: 2 },
    ])
    expect(draft.electricalSymbols).toEqual([
      { shapeKind: 'electrical-receptacle', name: 'Duplex Receptacle', category: 'power', quantity: 1 },
    ])
    expect(draft.wireQuantities[0]).toMatchObject({
      wireProfileId: 'wire_profile_a',
      profileName: '12/2 MC',
      materialDescription: 'MC cable copper conductors',
      unit: 'ft',
    })
    expect(draft.wireQuantities[0].length).toBeGreaterThan(0)
  })

  it('freezes measured wire length without purchase waste or pricing fields', () => {
    const draft = build()
    expect(draft.wireQuantities).toHaveLength(1)
    expect(draft.wireQuantities[0]).toMatchObject({
      wireProfileId: 'wire_profile_a',
      profileName: '12/2 MC',
      length: 100,
      unit: 'ft',
    })
    expect(draft.wireQuantities[0].length).not.toBe(110)
    expect(JSON.stringify(draft.wireQuantities)).not.toMatch(/purchaseLength|wasteLength|wastePercent|unitCost|diagnostics/i)
  })

  it('does not fall back to purchase length when measured inputs are missing or invalid', () => {
    const missingCalibration = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      workPackage: pkg(),
      annotations: [ann('a2', 'circuit-path')],
      wireProfiles: [profile()],
      savedCalibrations: {},
      detectedScales: {},
      getPageSizeInches: () => pageSize,
    })
    const invalidPageSize = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      workPackage: pkg(),
      annotations: [ann('a2', 'circuit-path')],
      wireProfiles: [profile()],
      savedCalibrations: { 1: calibration },
      detectedScales: {},
      getPageSizeInches: () => ({ pageWidthInches: Number.NaN, pageHeightInches: 10 }),
    })
    expect(missingCalibration.wireQuantities).toEqual([])
    expect(invalidPageSize.wireQuantities).toEqual([])
  })

  it('keeps wire quantity ordering deterministic across profile and annotation order', () => {
    const profileB = profile({ id: 'wire_profile_b', name: '10/2 MC' })
    const annB = ann('a3', 'circuit-path', { meta: { shapeKind: 'circuit-path', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], segmentIds: ['a3-s1'], wireProfileId: 'wire_profile_b' } })
    const first = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      workPackage: pkg({ selectedAnnotationIds: ['a3', 'a2'] }),
      annotations: [annB, ann('a2', 'circuit-path')],
      wireProfiles: [profile(), profileB],
      savedCalibrations: { 1: calibration },
      detectedScales: {},
      getPageSizeInches: () => pageSize,
    })
    const second = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      workPackage: pkg({ selectedAnnotationIds: ['a2', 'a3'] }),
      annotations: [ann('a2', 'circuit-path'), annB],
      wireProfiles: [profileB, profile()],
      savedCalibrations: { 1: calibration },
      detectedScales: {},
      getPageSizeInches: () => pageSize,
    })
    expect(first.wireQuantities).toEqual(second.wireQuantities)
    expect(first.wireQuantities.map((row) => row.profileName)).toEqual(['10/2 MC', '12/2 MC'])
  })

  it('returns best-effort empty wire quantities when page inputs are unavailable', () => {
    const draft = buildWorkOrderPayloadV1Draft({
      projectId: 'project-1',
      projectName: 'Project One',
      blueprintSetId: 'set-1',
      workPackage: pkg(),
      annotations: [ann('a2', 'circuit-path')],
      wireProfiles: [profile()],
    })
    expect(draft.wireQuantities).toEqual([])
  })

  it('freezes an ordered employee-readable animation summary and uses null for missing routes', () => {
    const withRoute = build({ animationScene: 'mock-scene' as any, animationSceneRevision: 3 })
    expect(withRoute.animationRoute).toEqual({
      name: 'Kitchen Rough-In',
      sourceLabel: 'Main Panel',
      steps: [
        { order: 1, label: 'Main Panel', deviceType: 'Source device' },
        { order: 2, label: 'Kitchen homerun', deviceType: 'Circuit Path segment', branch: 'Island receptacle' },
      ],
      terminalLabels: ['Island receptacle'],
    })
    expect(build({ animationScene: undefined }).animationRoute).toBeNull()
    expect(build({ animationScene: { bad: true } as any }).animationRoute).toBeNull()
  })

  it('is deterministic, bounds text, and produces a deterministic source fingerprint', () => {
    const long = 'x'.repeat(250)
    const first = build({ name: long, description: ` ${'d'.repeat(4100)} ` })
    const second = build({ name: long, description: ` ${'d'.repeat(4100)} ` })
    expect(first).toEqual(second)
    expect(first.scope.title).toHaveLength(200)
    expect(first.scope.description).toHaveLength(4000)
    expect(first.source.sourceFingerprint).toBe(buildSourceFingerprint({
      workPackageId: 'package-1',
      workPackageUpdatedAt: '2026-01-02T00:00:00.000Z',
      animationSceneRevision: 0,
      blueprintSetId: 'set-1',
    }))
  })

  it('excludes pricing, proposal, employee, raw data, diagnostics, animation graph, and snapshot URL fields', () => {
    const text = JSON.stringify(build())
    expect(text).not.toMatch(/proposalSummary|pricing|unitCost|lead_employee_id|assigned_employee_ids|employeeId/i)
    expect(text).not.toMatch(/backupData|rawAnnotations|annotations|diagnostics|animationScene|sceneGraph|signedUrl|storagePath|publicUrl/i)
    expect(getWorkOrderPayloadByteLength(build())).toBeLessThan(512000)
  })
})
