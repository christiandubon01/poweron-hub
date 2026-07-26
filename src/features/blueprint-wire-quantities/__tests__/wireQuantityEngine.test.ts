import { describe, expect, it } from 'vitest'
import { buildManualKnownDistanceCalibration, measureCircuitRoute, resolveEffectiveCalibration } from '@/features/blueprint-measurements'
import type { BlueprintAnnotation, BlueprintScopeLayer } from '@/services/blueprintLibraryService'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import { buildEffectiveWorkPackagesForPreview, buildWireQuantityResult } from '..'

const pageSize = { pageWidthInches: 10, pageHeightInches: 10 }
const nonSquarePageSize = { pageWidthInches: 20, pageHeightInches: 10 }
const calibration = buildManualKnownDistanceCalibration(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 100, 'ft', pageSize)
const nonSquareCalibration = buildManualKnownDistanceCalibration(1, { x: 0, y: 0 }, { x: 1, y: 0 }, 200, 'ft', nonSquarePageSize)
const metricCalibration = buildManualKnownDistanceCalibration(2, { x: 0, y: 0 }, { x: 1, y: 0 }, 30, 'm', pageSize)

function profile(patch: Partial<WireProfile> = {}): WireProfile {
  return {
    id: 'wire_profile_a',
    projectId: 'project-1',
    name: 'Profile A',
    installationFamily: 'cable',
    displayColor: '#38bdf8',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 10,
    allowedTools: ['circuit-path', 'circuit-arc'],
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function ann(id: string, patch: Partial<BlueprintAnnotation> = {}): BlueprintAnnotation {
  return {
    id,
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    type: 'shape',
    color: '#38bdf8',
    meta: {
      shapeKind: 'circuit-path',
      points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }],
      segmentIds: [`${id}-s1`, `${id}-s2`],
      wireProfileId: 'wire_profile_a',
      totalDistance: 9999,
      distanceLabel: 'Total: 9999 ft',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

function pkg(id: string, selectedAnnotationIds: string[], patch: Partial<BlueprintScopeLayer> = {}): BlueprintScopeLayer {
  return {
    id,
    name: id,
    description: '',
    color: '#38bdf8',
    selectedAnnotationIds,
    itemRefs: selectedAnnotationIds.map((annotationId) => ({ annotationId, pageNumber: 1, label: 'Circuit Path' })),
    roughInHours: 0,
    trimHours: 0,
    testingHours: 0,
    cleanupHours: 0,
    crewNotes: '',
    proposalSummary: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    visible: true,
    isolated: false,
    ...patch,
  }
}

function run(params: {
  annotations?: BlueprintAnnotation[]
  workPackages?: BlueprintScopeLayer[]
  wireProfiles?: WireProfile[]
  savedCalibrations?: Record<number, typeof calibration | undefined>
  getPageSizeInches?: (pageNumber: number) => typeof pageSize | null
  blueprintSetId?: string
} = {}) {
  return buildWireQuantityResult({
    projectId: 'project-1',
    blueprintSetId: params.blueprintSetId || 'set-1',
    annotations: params.annotations || [ann('a1')],
    workPackages: params.workPackages || [],
    wireProfiles: params.wireProfiles || [profile()],
    savedCalibrations: params.savedCalibrations || { 1: calibration },
    detectedScales: {},
    getPageSizeInches: params.getPageSizeInches || (() => pageSize),
  })
}

describe('blueprint-wire-quantities engine', () => {
  it('creates deterministic contributions from Path and Arc geometry and ignores stored totalDistance', () => {
    const arc = ann('arc', { meta: { shapeKind: 'circuit-arc', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], arcCtrls: [{ x: 0.5, y: 0.25 }], segmentIds: ['arc-s1'], wireProfileId: 'wire_profile_a', totalDistance: 1 } })
    const result = run({ annotations: [arc, ann('path')] })
    expect(result.contributions.map((item) => item.segmentId)).toEqual(['arc-s1', 'path-s1', 'path-s2'])
    expect(result.projectTotals[0].measuredLength).toBeGreaterThan(200)
    expect(JSON.stringify(result)).not.toContain('9999')
  })

  it('resolves annotation defaults, segment overrides, null inheritance, missing overrides, unassigned, archived, missing, and cross-project profiles by ID', () => {
    const annotations = [
      ann('default'),
      ann('override', { meta: { ...ann('override').meta, segmentWireProfileIds: ['wire_profile_b', null] } }),
      ann('missing-override', { meta: { ...ann('missing-override').meta, segmentWireProfileIds: ['wire_profile_missing'] } }),
      ann('unassigned', { meta: { ...ann('unassigned').meta, wireProfileId: null } }),
      ann('cross', { meta: { ...ann('cross').meta, wireProfileId: 'wire_profile_cross' } }),
    ]
    const result = run({ annotations, wireProfiles: [profile(), profile({ id: 'wire_profile_b', name: 'Renamed B', displayColor: '#ef4444', isArchived: true }), profile({ id: 'wire_profile_cross', projectId: 'project-2' })] })
    expect(result.projectTotals.map((total) => [total.displayName, total.profileStatus, total.groupKind])).toContainEqual(['Renamed B', 'archived', 'profile'])
    expect(result.projectTotals.some((total) => total.groupKind === 'unassigned')).toBe(true)
    expect(result.projectTotals.some((total) => total.groupKind === 'missing-profile' && total.wireProfileId === 'wire_profile_missing')).toBe(true)
    expect(result.projectTotals.some((total) => total.groupKind === 'cross-project-profile')).toBe(true)
    expect(result.diagnostics.map((diagnostic) => diagnostic.type)).toEqual(expect.arrayContaining(['unassigned-profile', 'missing-profile', 'cross-project-profile']))
  })

  it('counts hidden and isolated packages, excludes deleted packages, dedupes project totals, and reports duplicate membership and stale refs', () => {
    const a1 = ann('a1')
    const a2 = ann('a2')
    const result = run({
      annotations: [a1, a2],
      workPackages: [
        pkg('p2', ['a1'], { visible: false, isolated: true, sortOrder: 2 }),
        pkg('p1', ['a1', 'missing'], { sortOrder: 1 }),
        pkg('deleted', ['a2'], { deletedAt: '2026-01-02T00:00:00.000Z' }),
      ],
    })
    expect(result.packageRollups.map((rollup) => rollup.packageId)).toEqual(['p1', 'p2'])
    expect(result.projectTotals[0].measuredLength).toBe(200)
    expect(result.packageRollups.map((rollup) => rollup.totals[0].measuredLength)).toEqual([100, 100])
    expect(result.diagnostics.map((diagnostic) => diagnostic.type)).toEqual(expect.arrayContaining(['duplicate-package-membership', 'stale-package-reference', 'unpackaged-contribution']))
  })

  it('uses selectedAnnotationIds as the only authoritative package membership source', () => {
    const itemOnly = pkg('item-only', [], { itemRefs: [{ annotationId: 'a1', pageNumber: 1, label: 'Circuit Path' }] })
    const selected = pkg('selected', ['a1'], { itemRefs: [] })
    const both = pkg('both', ['a1'], { itemRefs: [{ annotationId: 'a1', pageNumber: 1, label: 'Circuit Path' }] })
    const duplicated = pkg('duplicated', ['a1', 'a1'], { itemRefs: [{ annotationId: 'a1', pageNumber: 1, label: 'Circuit Path' }] })
    const staleSelected = pkg('stale-selected', ['missing'], { itemRefs: [] })
    const staleItemRef = pkg('stale-itemref', [], { itemRefs: [{ annotationId: 'missing-itemref', pageNumber: 1, label: 'Legacy' }] })
    const result = run({ workPackages: [itemOnly, selected, both, duplicated, staleSelected, staleItemRef] })
    const byId = new Map(result.packageRollups.map((rollup) => [rollup.packageId, rollup]))
    expect(byId.get('item-only')?.contributionIds).toEqual([])
    expect(byId.get('selected')?.contributionIds).toHaveLength(2)
    expect(byId.get('both')?.contributionIds).toHaveLength(2)
    expect(byId.get('duplicated')?.contributionIds).toHaveLength(2)
    expect(result.projectTotals[0].measuredLength).toBe(100)
    expect(result.diagnostics.filter((diagnostic) => diagnostic.type === 'stale-package-reference').map((diagnostic) => diagnostic.annotationId)).toEqual(['missing'])
  })

  it('applies waste after grouped summation and leaves unresolved groups unconfigured', () => {
    const result = run({
      annotations: [ann('a1'), ann('missing', { meta: { ...ann('missing').meta, wireProfileId: 'wire_profile_missing' } }), ann('unassigned', { meta: { ...ann('unassigned').meta, wireProfileId: null } })],
      wireProfiles: [profile({ wastePercent: 12.5 })],
    })
    const configured = result.projectTotals.find((total) => total.wireProfileId === 'wire_profile_a')
    expect(configured?.measuredLength).toBe(100)
    expect(configured?.wasteLength).toBe(12.5)
    expect(configured?.purchaseLength).toBe(112.5)
    expect(result.projectTotals.filter((total) => total.groupKind !== 'profile').every((total) => total.wastePercent === null && total.purchaseLength === null)).toBe(true)
  })

  it('keeps mixed units separate and reports a mixed-unit diagnostic without converting', () => {
    const result = run({
      annotations: [ann('ft'), ann('m', { pageNumber: 2, meta: { ...ann('m').meta, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], segmentIds: ['m-s1'] } })],
      savedCalibrations: { 1: calibration, 2: metricCalibration },
    })
    const profileTotals = result.projectTotals.filter((total) => total.wireProfileId === 'wire_profile_a')
    expect(profileTotals.map((total) => total.unit).sort()).toEqual(['ft', 'm'])
    expect(result.diagnostics.some((diagnostic) => diagnostic.type === 'mixed-units-for-profile')).toBe(true)
  })

  it('requires valid page dimensions and never falls back to cached totals or isotropic normalized distance for quantities', () => {
    const horizontal = ann('horizontal', { meta: { ...ann('horizontal').meta, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], segmentIds: ['horizontal-s1'], totalDistance: 9999 } })
    const vertical = ann('vertical', { meta: { ...ann('vertical').meta, points: [{ x: 0, y: 0 }, { x: 0, y: 0.5 }], segmentIds: ['vertical-s1'] } })
    const valid = run({
      annotations: [horizontal, vertical],
      savedCalibrations: { 1: nonSquareCalibration },
      getPageSizeInches: () => nonSquarePageSize,
    })
    expect(valid.contributions.map((contribution) => contribution.measuredLength)).toEqual([100, 50])

    for (const invalidSize of [null, { pageWidthInches: 0, pageHeightInches: 10 }, { pageWidthInches: 10, pageHeightInches: 0 }, { pageWidthInches: Number.POSITIVE_INFINITY, pageHeightInches: 10 }, { pageWidthInches: 10, pageHeightInches: Number.NaN }]) {
      const invalid = run({
        annotations: [horizontal],
        savedCalibrations: { 1: nonSquareCalibration },
        getPageSizeInches: () => invalidSize as any,
      })
      expect(invalid.contributions[0].measuredLength).toBeNull()
      expect(invalid.projectTotals[0].measuredLength).toBe(0)
      expect(invalid.projectTotals[0].wasteLength).toBeNull()
      expect(invalid.projectTotals[0].purchaseLength).toBeNull()
      expect(invalid.diagnostics.some((diagnostic) => diagnostic.type === 'missing-page-dimensions')).toBe(true)
      expect(JSON.stringify(invalid)).not.toContain('9999')
    }

    const mixed = run({
      annotations: [horizontal, ann('valid-page', { pageNumber: 2, meta: { ...ann('valid-page').meta, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], segmentIds: ['valid-page-s1'] } })],
      savedCalibrations: { 1: nonSquareCalibration, 2: calibration },
      getPageSizeInches: (page) => page === 1 ? null : pageSize,
    })
    expect(mixed.projectTotals.find((total) => total.groupKind === 'profile')?.measuredLength).toBe(100)
  })

  it('keeps calibration and quantity helpers numerically consistent for Path and Arc while ignoring stored labels', () => {
    const auto = { pageNumber: 1, candidates: [{ parsedScale: 'scale', realWidthFeet: 80, confidence: 1, sourceText: 'scale' }], ambiguous: false, detectedAt: '2026-01-01T00:00:00.000Z' }
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: { 1: calibration }, detectedScales: { 1: auto }, pageSize })).toMatchObject({ status: 'calibrated', source: 'manual' })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: { 1: { ...calibration, realWorldValue: 0 } }, detectedScales: { 1: auto }, pageSize })).toMatchObject({ status: 'calibrated', source: 'auto' })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: {}, detectedScales: { 1: { ...auto, hasNts: true } }, pageSize })).toEqual({ status: 'uncalibrated', reason: 'not-to-scale' })
    expect(resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: {}, detectedScales: { 1: { ...auto, ambiguous: true } }, pageSize })).toEqual({ status: 'uncalibrated', reason: 'ambiguous' })

    const effective = resolveEffectiveCalibration({ pageNumber: 1, savedCalibrations: { 1: calibration }, detectedScales: {}, pageSize })
    const pathPoints = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }]
    const viewerPath = measureCircuitRoute({ points: pathPoints, shapeKind: 'circuit-path', calibration: effective, pageSize })[0]
    const quantityPath = run({ annotations: [ann('path-consistency', { meta: { ...ann('path-consistency').meta, points: pathPoints, segmentIds: ['path-consistency-s1'], totalDistance: 9999, distanceLabel: 'Total: 9999 ft' } })] }).contributions[0]
    expect(viewerPath.status === 'measured' ? viewerPath.length.value : null).toBe(quantityPath.measuredLength)

    const arcPoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }]
    const arcCtrls = [{ x: 0.5, y: 0.25 }]
    const viewerArc = measureCircuitRoute({ points: arcPoints, arcCtrls, shapeKind: 'circuit-arc', calibration: effective, pageSize })[0]
    const quantityArc = run({ annotations: [ann('arc-consistency', { meta: { shapeKind: 'circuit-arc', points: arcPoints, arcCtrls, segmentIds: ['arc-consistency-s1'], wireProfileId: 'wire_profile_a', totalDistance: 9999, distanceLabel: 'Total: 9999 ft' } })] })
    expect(quantityArc.contributions).toHaveLength(1)
    expect(viewerArc.status === 'measured' ? viewerArc.length.value : null).toBe(quantityArc.contributions[0].measuredLength)
  })

  it('evaluates Work Package draft preview with other live packages for duplicate membership context without mutating sources', () => {
    const sourcePackages = Object.freeze([
      Object.freeze(pkg('package-a', ['old'])),
      Object.freeze(pkg('package-b', ['a1'])),
      Object.freeze(pkg('deleted', ['a1'], { deletedAt: '2026-01-02T00:00:00.000Z' })),
    ]) as unknown as BlueprintScopeLayer[]
    const draft = pkg('package-a', ['a1'])
    const previewPackages = buildEffectiveWorkPackagesForPreview({ workPackages: sourcePackages, draftPackage: draft })
    expect(previewPackages.map((item) => item.id)).toEqual(['package-a', 'package-b'])
    expect(previewPackages[0].selectedAnnotationIds).toEqual(['a1'])
    const result = run({ workPackages: previewPackages })
    expect(result.packageRollups.find((rollup) => rollup.packageId === 'package-a')?.totals[0].measuredLength).toBe(100)
    expect(result.diagnostics.find((diagnostic) => diagnostic.type === 'duplicate-package-membership')?.packageIds).toEqual(['package-a', 'package-b'])
    expect(result.projectTotals[0].measuredLength).toBe(100)
    expect(sourcePackages[0].selectedAnnotationIds).toEqual(['old'])
  })

  it('isolates blueprint sets in annotations, packages, and quantity line identity', () => {
    const sameMeta = { ...ann('same-id').meta, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], segmentIds: ['same-segment'] }
    const setA = ann('same-id', { blueprintSetId: 'set-a', meta: sameMeta })
    const setB = ann('same-id', { blueprintSetId: 'set-b', meta: sameMeta })
    const result = run({
      blueprintSetId: 'set-b',
      annotations: [setA, setB],
      workPackages: [pkg('pkg-a', ['same-id'], { selectedAnnotationIds: ['same-id'] })],
    })
    expect(result.contributions).toHaveLength(1)
    expect(result.contributions[0].blueprintSetId).toBe('set-b')
    expect(result.contributions[0].quantityLineId).toContain('set-b')
    expect(result.contributions[0].quantityLineId).not.toContain('set-a')
    expect(result.projectTotals[0].wireProfileId).toBe('wire_profile_a')
  })

  it('is deterministic across annotation/package/profile ordering, handles copied annotations and legacy segment IDs, and does not mutate frozen inputs', () => {
    const legacy = Object.freeze(ann('legacy', { meta: Object.freeze({ shapeKind: 'circuit-path', points: Object.freeze([{ x: 0, y: 0 }, { x: 1, y: 0 }]), wireProfileId: 'wire_profile_a' }) as any }))
    const copy = ann('legacy-copy', { meta: { shapeKind: 'circuit-path', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], wireProfileId: 'wire_profile_a' } })
    const one = run({ annotations: [copy, legacy as BlueprintAnnotation], workPackages: [pkg('p2', ['legacy-copy']), pkg('p1', ['legacy'])], wireProfiles: [profile({ id: 'wire_profile_z', name: 'Z' }), profile()] })
    const two = run({ annotations: [legacy as BlueprintAnnotation, copy], workPackages: [pkg('p1', ['legacy']), pkg('p2', ['legacy-copy'])], wireProfiles: [profile(), profile({ id: 'wire_profile_z', name: 'Z' })] })
    expect(one.projectTotals).toEqual(two.projectTotals)
    expect(one.projectTotals[0].measuredLength).toBe(200)
    expect(one.diagnostics.some((diagnostic) => diagnostic.type === 'legacy-segment-identity')).toBe(true)
    expect(JSON.stringify(one)).not.toMatch(/generatedAt|random/i)
  })
})
