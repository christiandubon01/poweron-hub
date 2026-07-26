import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AssignWireProfileDialog } from '../components'
import {
  applyWireProfileAssignmentPlanToAnnotations,
  buildWireProfileAssignmentPlan,
  groupUnassignedWireQuantityContributions,
  listAssignableActiveWireProfiles,
  normalizeWireProfileAssignmentSelection,
  type WireProfileAssignmentSelection,
} from '../wireQuantityAssignment'
import type { WireQuantityContribution } from '../types'
import type { WireProfile } from '@/features/blueprint-wire-profiles'

function profile(extra: Partial<WireProfile> = {}): WireProfile {
  return {
    id: 'wire_profile_a',
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
    quantityLineId: 'q1',
    projectId: 'project-1',
    blueprintSetId: 'set-1',
    pageNumber: 1,
    annotationId: 'ann-1',
    segmentId: 'seg-1',
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

const annotations: any[] = [{
  id: 'ann-1',
  projectId: 'project-1',
  blueprintSetId: 'set-1',
  pageNumber: 1,
  meta: { shapeKind: 'circuit-path', segmentIds: ['seg-1', 'seg-2'], segmentWireProfileIds: [null, 'wire_profile_existing'] },
}]

describe('wire quantity assignment helpers', () => {
  it('lists only active project profiles in deterministic name/id order', () => {
    expect(listAssignableActiveWireProfiles('project-1', [
      profile({ id: 'z', name: 'Zulu' }),
      profile({ id: 'archived', name: 'Archived', isArchived: true }),
      profile({ id: 'deleted', name: 'Deleted', deletedAt: '2026-01-02T00:00:00.000Z' }),
      profile({ id: 'cross', projectId: 'project-2', name: 'Alpha' }),
      profile({ id: 'a2', name: 'alpha' }),
      profile({ id: 'a1', name: 'Alpha' }),
    ]).map((item) => item.id)).toEqual(['a1', 'a2', 'z'])
  })

  it('normalizes route and segment selections as mutually exclusive per annotation', () => {
    const segment: WireProfileAssignmentSelection = { mode: 'segment-override', annotationId: 'ann-1', quantityLineId: 'q1', segmentId: 'seg-1', segmentIndex: 0 }
    const route: WireProfileAssignmentSelection = { mode: 'annotation-default', annotationId: 'ann-1' }
    const selected = normalizeWireProfileAssignmentSelection([], segment, true)
    expect(selected).toHaveLength(1)
    expect(normalizeWireProfileAssignmentSelection(selected, route, true)).toEqual([route])
    expect(normalizeWireProfileAssignmentSelection([route], segment, true)).toEqual([segment])
    expect(normalizeWireProfileAssignmentSelection([segment], segment, false)).toEqual([])
  })

  it('groups Unassigned contributions by physical route with package and length summaries', () => {
    const groups = groupUnassignedWireQuantityContributions([
      contribution({ quantityLineId: 'q2', segmentId: 'seg-2', segmentIndex: 1, measuredLength: 5, packageIds: ['pkg-2'] }),
      contribution(),
      contribution({ quantityLineId: 'assigned', annotationId: 'ann-2', profileResolution: { status: 'active', source: 'annotation-default', wireProfileId: 'wire_profile_a', profile: profile() } }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].contributionIds).toEqual(['q1', 'q2'])
    expect(groups[0].packageIds).toEqual(['pkg-1', 'pkg-2'])
    expect(groups[0].measuredLengthByUnit).toEqual([{ unit: 'ft', measuredLength: 15 }])
  })

  it('plans whole-route default assignment for currently Unassigned contributions and warns about preserved overrides and packages', () => {
    const plan = buildWireProfileAssignmentPlan({
      selections: [{ mode: 'annotation-default', annotationId: 'ann-1' }],
      contributions: [
        contribution(),
        contribution({ quantityLineId: 'q2', segmentId: 'seg-2', segmentIndex: 1, profileResolution: { status: 'active', source: 'segment-override', wireProfileId: 'wire_profile_existing', profile: profile({ id: 'wire_profile_existing' }) } }),
      ],
      annotations,
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      wireProfiles: [profile()],
      targetProfileId: 'wire_profile_a',
    })
    expect(plan.ok).toBe(true)
    expect(plan.routeCount).toBe(1)
    expect(plan.segmentCount).toBe(1)
    expect(plan.affectedPackageIds).toEqual(['pkg-1'])
    expect(plan.warnings).toContain('Whole-route assignment preserves existing segment overrides.')
    expect(plan.warnings).toContain('This updates the physical route and all Work Packages that reference it.')
  })

  it('rejects stale, assigned, cross-set, legacy, missing-target, and empty assignment plans', () => {
    const base = {
      annotations,
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      wireProfiles: [profile()],
      targetProfileId: 'wire_profile_a',
    }
    const empty = buildWireProfileAssignmentPlan({ ...base, selections: [], contributions: [contribution()] })
    const missingLine = buildWireProfileAssignmentPlan({ ...base, selections: [{ mode: 'segment-override', annotationId: 'ann-1', quantityLineId: 'missing', segmentId: 'seg-1', segmentIndex: 0 }], contributions: [contribution()] })
    const assignedLine = buildWireProfileAssignmentPlan({ ...base, selections: [{ mode: 'segment-override', annotationId: 'ann-1', quantityLineId: 'q1', segmentId: 'seg-1', segmentIndex: 0 }], contributions: [contribution({ profileResolution: { status: 'active', source: 'annotation-default', wireProfileId: 'wire_profile_a', profile: profile() } })] })
    const legacyLine = buildWireProfileAssignmentPlan({ ...base, selections: [{ mode: 'segment-override', annotationId: 'ann-1', quantityLineId: 'q1', segmentId: 'legacy:0', segmentIndex: 0 }], contributions: [contribution({ segmentId: 'legacy:0' })] })
    const missingTarget = buildWireProfileAssignmentPlan({ ...base, targetProfileId: 'missing', selections: [{ mode: 'annotation-default', annotationId: 'ann-1' }], contributions: [contribution()] })
    const crossSet = buildWireProfileAssignmentPlan({ ...base, selections: [{ mode: 'annotation-default', annotationId: 'ann-1' }], contributions: [contribution({ blueprintSetId: 'set-2' })] })
    expect({ empty: empty.ok, missingLine: missingLine.ok, assignedLine: assignedLine.ok, legacyLine: legacyLine.ok, missingTarget: missingTarget.ok, crossSet: crossSet.ok }).toEqual({
      empty: false,
      missingLine: false,
      assignedLine: false,
      legacyLine: false,
      missingTarget: false,
      crossSet: false,
    })
  })

  it('applies default and segment override assignments immutably without clearing unrelated overrides', () => {
    const routePlan = buildWireProfileAssignmentPlan({
      selections: [{ mode: 'annotation-default', annotationId: 'ann-1' }],
      contributions: [contribution()],
      annotations,
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      wireProfiles: [profile()],
      targetProfileId: 'wire_profile_a',
    })
    const routed = applyWireProfileAssignmentPlanToAnnotations(annotations, routePlan)
    expect(routed[0]).not.toBe(annotations[0])
    expect((routed[0]!.meta as any).wireProfileId).toBe('wire_profile_a')
    expect((routed[0]!.meta as any).segmentWireProfileIds).toEqual([null, 'wire_profile_existing'])

    const segmentPlan = buildWireProfileAssignmentPlan({
      selections: [{ mode: 'segment-override', annotationId: 'ann-1', quantityLineId: 'q1', segmentId: 'seg-1', segmentIndex: 0 }],
      contributions: [contribution()],
      annotations,
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      wireProfiles: [profile()],
      targetProfileId: 'wire_profile_a',
    })
    expect((applyWireProfileAssignmentPlanToAnnotations(annotations, segmentPlan)[0]!.meta as any).segmentWireProfileIds).toEqual(['wire_profile_a', 'wire_profile_existing'])
  })

  it('renders assignment dialog controls, warnings, affected packages, and no labor or pricing preview', () => {
    const plan = buildWireProfileAssignmentPlan({
      selections: [{ mode: 'annotation-default', annotationId: 'ann-1' }],
      contributions: [contribution()],
      annotations,
      projectId: 'project-1',
      blueprintSetId: 'set-1',
      wireProfiles: [profile()],
      targetProfileId: 'wire_profile_a',
    })
    const html = renderToStaticMarkup(createElement(AssignWireProfileDialog, {
      open: true,
      profiles: [profile()],
      selectedProfileId: 'wire_profile_a',
      plan,
      packageNamesById: { 'pkg-1': 'Rough Lighting' },
      onProfileChange: () => {},
      onCancel: () => {},
      onApply: () => {},
    }))
    expect(html).toContain('Assign Wire Profile')
    expect(html).toContain('Romex')
    expect(html).toContain('10.00 ft')
    expect(html).toContain('Rough Lighting')
    expect(html).not.toMatch(/labor|pricing|price/i)
  })
})
