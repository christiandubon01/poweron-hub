import { describe, expect, it } from 'vitest'
import {
  applyWireSegmentProfileAssignmentPlanToAnnotations,
  buildWireSegmentPickOverlayModel,
  buildWireSegmentProfileAssignmentPlan,
  resolveWireSegmentRange,
  type WireSegmentRangeSelection,
} from '../wireSegmentRangePicking'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import type { WireQuantityContribution } from '../types'

function annotation(extra: any = {}) {
  return {
    id: 'ann-1',
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    meta: {
      shapeKind: 'circuit-path',
      points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }],
      pointIds: ['p1', 'p2', 'p3'],
      segmentIds: ['s1', 's2'],
      segmentWireProfileIds: [null, 'wire_profile_old'],
    },
    ...extra,
  }
}

function profile(extra: Partial<WireProfile> = {}): WireProfile {
  return {
    id: 'wire_profile_new',
    projectId: 'project-1',
    name: 'Romex',
    installationFamily: 'cable',
    displayColor: '#00ffff',
    displayWidth: 2,
    displayStyle: 'solid',
    wastePercent: 10,
    allowedTools: ['circuit-path', 'circuit-arc'],
    isArchived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  }
}

function contribution(extra: Partial<WireQuantityContribution> = {}): WireQuantityContribution {
  return {
    quantityLineId: `q-${extra.segmentId || 's1'}`,
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    annotationId: 'ann-1',
    segmentId: 's1',
    segmentIndex: 0,
    shapeKind: 'circuit-path',
    packageIds: ['pkg-1'],
    isUnpackaged: false,
    profileResolution: { status: 'unassigned', source: 'unassigned', wireProfileId: null },
    measuredLength: 10,
    unit: 'ft',
    calibrationStatus: 'calibrated',
    diagnostics: [],
    ...extra,
  }
}

function range(extra: Partial<WireSegmentRangeSelection> = {}): WireSegmentRangeSelection {
  return {
    id: 'range-1',
    annotationId: 'ann-1',
    pageNumber: 1,
    shapeKind: 'circuit-path',
    startPointId: 'p1',
    endPointId: 'p3',
    segmentIds: ['s1', 's2'],
    ...extra,
  }
}

describe('wire segment range picking', () => {
  it('resolves adjacent, multi-segment, and reverse Path ranges to physical segment ids', () => {
    expect(resolveWireSegmentRange({ annotation: annotation(), startPointId: 'p1', endPointId: 'p2' })).toMatchObject({
      ok: true,
      range: { segmentIds: ['s1'] },
    })
    expect(resolveWireSegmentRange({ annotation: annotation(), startPointId: 'p1', endPointId: 'p3' })).toMatchObject({
      ok: true,
      range: { segmentIds: ['s1', 's2'] },
    })
    expect(resolveWireSegmentRange({ annotation: annotation(), startPointId: 'p3', endPointId: 'p1' })).toMatchObject({
      ok: true,
      range: { segmentIds: ['s1', 's2'] },
    })
  })

  it('uses Arc physical points and segments without exposing measurement samples', () => {
    const arc = annotation({
      meta: {
        shapeKind: 'circuit-arc',
        points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.2 }, { x: 1, y: 0 }],
        arcCtrls: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }],
        pointIds: ['a', 'b', 'c'],
        segmentIds: ['as1', 'as2'],
      },
    })
    const resolved = resolveWireSegmentRange({ annotation: arc, startPointId: 'a', endPointId: 'c' })
    expect(resolved).toMatchObject({ ok: true, range: { shapeKind: 'circuit-arc', segmentIds: ['as1', 'as2'] } })
    expect(resolved.ok && resolved.range.segmentIds).toHaveLength(2)
  })

  it('rejects same, missing, stale, empty, and legacy topology', () => {
    expect(resolveWireSegmentRange({ annotation: annotation(), startPointId: 'p1', endPointId: 'p1' }).ok).toBe(false)
    expect(resolveWireSegmentRange({ annotation: annotation(), startPointId: 'missing', endPointId: 'p2' }).ok).toBe(false)
    expect(resolveWireSegmentRange({ annotation: annotation({ meta: { ...annotation().meta, pointIds: ['p1'] } }), startPointId: 'p1', endPointId: 'p2' }).ok).toBe(false)
    expect(resolveWireSegmentRange({ annotation: annotation({ meta: { ...annotation().meta, segmentIds: [''] } }), startPointId: 'p1', endPointId: 'p2' }).ok).toBe(false)
    expect(resolveWireSegmentRange({ annotation: annotation({ meta: { ...annotation().meta, segmentIds: ['legacy:ann-1:0', 's2'] } }), startPointId: 'p1', endPointId: 'p2' }).ok).toBe(false)
  })

  it('deduplicates overlapping ranges deterministically while preserving range records', () => {
    const ann2 = annotation({
      id: 'ann-2',
      meta: {
        shapeKind: 'circuit-arc',
        points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        pointIds: ['a1', 'a2'],
        segmentIds: ['a-seg'],
      },
    })
    const plan = buildWireSegmentProfileAssignmentPlan({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      targetWireProfileId: 'wire_profile_new',
      selectedRanges: [
        range({ id: 'r2', startPointId: 'p2', endPointId: 'p3', segmentIds: ['s2'] }),
        range({ id: 'r1' }),
        range({ id: 'r3', annotationId: 'ann-2', shapeKind: 'circuit-arc', startPointId: 'a1', endPointId: 'a2', segmentIds: ['a-seg'] }),
      ],
      annotations: [annotation(), ann2],
      contributions: [
        contribution({ segmentId: 's1', measuredLength: 10 }),
        contribution({ segmentId: 's2', segmentIndex: 1, measuredLength: 5 }),
        contribution({ annotationId: 'ann-2', segmentId: 'a-seg', shapeKind: 'circuit-arc', measuredLength: 3, packageIds: ['pkg-2'] }),
      ],
      wireProfiles: [profile()],
      eligibleAnnotationIds: new Set(['ann-1', 'ann-2']),
    })
    expect(plan.ok).toBe(true)
    expect(plan.rangeCount).toBe(3)
    expect(plan.segmentCount).toBe(3)
    expect(plan.changes).toEqual([
      { annotationId: 'ann-1', pageNumber: 1, segmentIds: ['s1', 's2'] },
      { annotationId: 'ann-2', pageNumber: 1, segmentIds: ['a-seg'] },
    ])
    expect(plan.selectedLengthByUnit).toEqual([{ unit: 'ft', measuredLength: 18 }])
    expect(plan.affectedPackageIds).toEqual(['pkg-1', 'pkg-2'])
  })

  it('writes only selected segment overrides and preserves defaults, geometry, style, and unselected overrides', () => {
    const plan = buildWireSegmentProfileAssignmentPlan({
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      targetWireProfileId: 'wire_profile_new',
      selectedRanges: [range({ startPointId: 'p1', endPointId: 'p2', segmentIds: ['s1'] })],
      annotations: [annotation({ meta: { ...annotation().meta, wireProfileId: 'wire_profile_default', color: '#abc123', arcCtrls: [{ x: 0.3, y: 0.4 }] } })],
      contributions: [contribution({ segmentId: 's1' })],
      wireProfiles: [profile()],
      eligibleAnnotationIds: new Set(['ann-1']),
    })
    const updated = applyWireSegmentProfileAssignmentPlanToAnnotations([annotation({ meta: { ...annotation().meta, wireProfileId: 'wire_profile_default', color: '#abc123' } })], plan)
    expect((updated[0].meta as any).wireProfileId).toBe('wire_profile_default')
    expect((updated[0].meta as any).segmentWireProfileIds).toEqual(['wire_profile_new', 'wire_profile_old'])
    expect((updated[0].meta as any).points).toEqual(annotation().meta.points)
    expect((updated[0].meta as any).pointIds).toEqual(['p1', 'p2', 'p3'])
    expect((updated[0].meta as any).segmentIds).toEqual(['s1', 's2'])
    expect((updated[0].meta as any).color).toBe('#abc123')
  })

  it('blocks itemRefs-only, stale segment, and inactive profile plans', () => {
    const base = {
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      selectedRanges: [range()],
      annotations: [annotation()],
      contributions: [contribution({ segmentId: 's1' }), contribution({ segmentId: 's2', segmentIndex: 1 })],
      wireProfiles: [profile()],
    }
    expect(buildWireSegmentProfileAssignmentPlan({ ...base, targetWireProfileId: 'wire_profile_new', eligibleAnnotationIds: new Set() }).ok).toBe(false)
    expect(buildWireSegmentProfileAssignmentPlan({ ...base, targetWireProfileId: 'wire_profile_new', selectedRanges: [range({ segmentIds: ['missing'] })], eligibleAnnotationIds: new Set(['ann-1']) }).ok).toBe(false)
    expect(buildWireSegmentProfileAssignmentPlan({ ...base, targetWireProfileId: 'wire_profile_new', wireProfiles: [profile({ isArchived: true })], eligibleAnnotationIds: new Set(['ann-1']) }).ok).toBe(false)
  })

  it('builds visible Path overlay geometry from stable segment ids', () => {
    const overlay = buildWireSegmentPickOverlayModel({
      annotations: [annotation()],
      currentPage: 1,
      eligibleAnnotationIds: new Set(['ann-1']),
      pendingRanges: [range({ startPointId: 'p1', endPointId: 'p2', segmentIds: ['s1'] })],
    })
    expect(overlay.diagnostics).toEqual([])
    expect(overlay.pendingSegmentCount).toBe(1)
    expect(overlay.segments).toEqual([expect.objectContaining({
      annotationId: 'ann-1',
      segmentId: 's1',
      tone: 'pending',
      shapeKind: 'circuit-path',
      start: { x: 0, y: 0 },
      end: { x: 0.5, y: 0 },
    })])
  })

  it('builds curved Arc overlay geometry with the authored segment control point', () => {
    const arc = annotation({
      meta: {
        shapeKind: 'circuit-arc',
        points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        pointIds: ['a', 'b'],
        segmentIds: ['arc-seg'],
        arcCtrls: [{ x: 0.5, y: 0.35 }],
      },
    })
    const overlay = buildWireSegmentPickOverlayModel({
      annotations: [arc],
      currentPage: 1,
      eligibleAnnotationIds: new Set(['ann-1']),
      pendingRanges: [range({ shapeKind: 'circuit-arc', startPointId: 'a', endPointId: 'b', segmentIds: ['arc-seg'] })],
    })
    expect(overlay.segments).toEqual([expect.objectContaining({
      segmentId: 'arc-seg',
      tone: 'pending',
      shapeKind: 'circuit-arc',
      control: { x: 0.5, y: 0.35 },
    })])
  })

  it('keeps preview and pending ranges distinct while deduping unique physical segment counts', () => {
    const overlay = buildWireSegmentPickOverlayModel({
      annotations: [annotation()],
      currentPage: 1,
      eligibleAnnotationIds: new Set(['ann-1']),
      activeAnnotationId: 'ann-1',
      startPointId: 'p1',
      hover: { annotationId: 'ann-1', pointId: 'p3', segmentIds: ['s1', 's2'] },
      pendingRanges: [
        range({ id: 'r1', startPointId: 'p1', endPointId: 'p2', segmentIds: ['s1'] }),
        range({ id: 'r2', startPointId: 'p1', endPointId: 'p3', segmentIds: ['s1', 's2'] }),
      ],
    })
    expect(overlay.previewSegmentCount).toBe(2)
    expect(overlay.pendingSegmentCount).toBe(2)
    expect(overlay.segments.filter((segment) => segment.tone === 'preview').map((segment) => segment.segmentId)).toEqual(['s1', 's2'])
    expect(overlay.segments.filter((segment) => segment.tone === 'pending').map((segment) => segment.segmentId)).toEqual(['s1', 's2'])
    expect(overlay.points).toEqual([
      expect.objectContaining({ pointId: 'p1', tone: 'start' }),
      expect.objectContaining({ pointId: 'p2', tone: 'point' }),
      expect.objectContaining({ pointId: 'p3', tone: 'hover' }),
    ])
  })

  it('reports unsafe overlay lookups without emitting missing, deleted, other-page, or ineligible segments', () => {
    const deleted = annotation({ id: 'deleted-ann', deletedAt: '2026-07-26T00:00:00.000Z' })
    const otherPage = annotation({ id: 'page-2-ann', pageNumber: 2 })
    const overlay = buildWireSegmentPickOverlayModel({
      annotations: [annotation(), deleted, otherPage],
      currentPage: 1,
      eligibleAnnotationIds: new Set(['ann-1', 'deleted-ann', 'page-2-ann']),
      pendingRanges: [
        range({ id: 'missing-segment', segmentIds: ['missing'] }),
        range({ id: 'deleted', annotationId: 'deleted-ann', segmentIds: ['s1'] }),
        range({ id: 'other-page', annotationId: 'page-2-ann', segmentIds: ['s1'] }),
        range({ id: 'item-ref-only', annotationId: 'item-ref-only-ann', segmentIds: ['s1'] }),
      ],
    })
    expect(overlay.segments).toEqual([])
    expect(overlay.diagnostics).toEqual(expect.arrayContaining([
      { code: 'segment-missing', annotationId: 'ann-1', segmentId: 'missing' },
      { code: 'annotation-deleted', annotationId: 'deleted-ann' },
      { code: 'annotation-other-page', annotationId: 'page-2-ann' },
      { code: 'annotation-missing', annotationId: 'item-ref-only-ann' },
    ]))
  })
})
