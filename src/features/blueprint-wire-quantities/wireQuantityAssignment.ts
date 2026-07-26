import {
  assignAnnotationWireProfileDefault,
  assignSegmentWireProfileOverride,
  normalizeWireProfileId,
  type CircuitWireProfileMetadata,
} from '@/features/blueprint-wire-profiles'
import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import type { WireQuantityContribution } from './types'

export type WireProfileAssignmentSelection =
  | { mode: 'annotation-default'; annotationId: string }
  | { mode: 'segment-override'; annotationId: string; quantityLineId: string; segmentId: string; segmentIndex: number }

export interface WireProfileAssignmentChange {
  annotationId: string
  mode: WireProfileAssignmentSelection['mode']
  quantityLineIds: string[]
  segmentIds: string[]
}

export interface WireProfileAssignmentPlan {
  ok: boolean
  targetProfileId: string | null
  changes: WireProfileAssignmentChange[]
  affectedPages: number[]
  affectedPackageIds: string[]
  selectedLengthByUnit: Array<{ unit: string | null; measuredLength: number | null }>
  routeCount: number
  segmentCount: number
  warnings: string[]
  errors: string[]
}

export interface WireQuantityAssignmentGroup {
  annotationId: string
  pageNumber: number
  shapeKind: WireQuantityContribution['shapeKind']
  contributionIds: string[]
  contributions: WireQuantityContribution[]
  measuredLengthByUnit: Array<{ unit: string | null; measuredLength: number | null }>
  packageIds: string[]
}

export interface BuildWireProfileAssignmentPlanInput {
  selections: readonly WireProfileAssignmentSelection[]
  contributions: readonly WireQuantityContribution[]
  annotations: readonly BlueprintAnnotation[]
  projectId: string
  blueprintSetId: string
  wireProfiles: readonly WireProfile[]
  targetProfileId: string | null | undefined
}

function cleanId(value: unknown): string {
  return String(value || '').trim()
}

function segmentSelectionKey(selection: WireProfileAssignmentSelection): string {
  return selection.mode === 'annotation-default'
    ? `route:${selection.annotationId}`
    : `segment:${selection.annotationId}:${selection.quantityLineId}`
}

function readMeta(annotation: BlueprintAnnotation): CircuitWireProfileMetadata {
  return ((annotation.meta || annotation.metadata || {}) as CircuitWireProfileMetadata)
}

function writeMeta(annotation: BlueprintAnnotation, meta: CircuitWireProfileMetadata): BlueprintAnnotation {
  const next = { ...annotation, meta: { ...(annotation.meta || {}), ...meta } } as BlueprintAnnotation
  if (annotation.metadata && annotation.metadata !== annotation.meta) {
    next.metadata = { ...(annotation.metadata || {}), ...meta } as any
  }
  return next
}

function addLength(
  map: Map<string, { unit: string | null; measuredLength: number | null }>,
  contribution: WireQuantityContribution,
) {
  const key = contribution.unit || 'not-configured'
  const current = map.get(key) || { unit: contribution.unit, measuredLength: 0 }
  if (contribution.measuredLength == null || !Number.isFinite(contribution.measuredLength)) {
    map.set(key, { unit: contribution.unit, measuredLength: null })
    return
  }
  if (current.measuredLength == null) {
    map.set(key, current)
    return
  }
  current.measuredLength += contribution.measuredLength
  map.set(key, current)
}

function sortedLengths(map: Map<string, { unit: string | null; measuredLength: number | null }>) {
  return Array.from(map.values()).sort((a, b) => String(a.unit || '').localeCompare(String(b.unit || '')))
}

export function normalizeWireProfileAssignmentSelection(
  previous: readonly WireProfileAssignmentSelection[],
  nextSelection: WireProfileAssignmentSelection,
  selected: boolean,
): WireProfileAssignmentSelection[] {
  const normalized = previous.filter((selection) => segmentSelectionKey(selection) !== segmentSelectionKey(nextSelection))
  if (!selected) return normalized
  if (nextSelection.mode === 'annotation-default') {
    return [
      ...normalized.filter((selection) => selection.annotationId !== nextSelection.annotationId),
      { mode: 'annotation-default', annotationId: cleanId(nextSelection.annotationId) },
    ]
  }
  return [
    ...normalized.filter((selection) => !(selection.mode === 'annotation-default' && selection.annotationId === nextSelection.annotationId)),
    {
      mode: 'segment-override',
      annotationId: cleanId(nextSelection.annotationId),
      quantityLineId: cleanId(nextSelection.quantityLineId),
      segmentId: cleanId(nextSelection.segmentId),
      segmentIndex: Math.max(0, Math.floor(Number(nextSelection.segmentIndex) || 0)),
    },
  ]
}

export function listAssignableActiveWireProfiles(projectId: string, profiles: readonly WireProfile[]): WireProfile[] {
  const cleanProjectId = cleanId(projectId)
  return profiles
    .filter((profile) => cleanId(profile.id) && profile.projectId === cleanProjectId && !profile.isArchived && !profile.deletedAt)
    .slice()
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      return byName || a.id.localeCompare(b.id)
    })
}

export function groupUnassignedWireQuantityContributions(
  contributions: readonly WireQuantityContribution[],
): WireQuantityAssignmentGroup[] {
  const groups = new Map<string, WireQuantityAssignmentGroup & { lengthMap: Map<string, { unit: string | null; measuredLength: number | null }> }>()
  contributions
    .filter((contribution) => contribution.profileResolution.status === 'unassigned')
    .forEach((contribution) => {
      const key = contribution.annotationId
      const existing = groups.get(key)
      const group = existing || {
        annotationId: contribution.annotationId,
        pageNumber: contribution.pageNumber,
        shapeKind: contribution.shapeKind,
        contributionIds: [],
        contributions: [],
        measuredLengthByUnit: [],
        packageIds: [],
        lengthMap: new Map<string, { unit: string | null; measuredLength: number | null }>(),
      }
      group.contributionIds.push(contribution.quantityLineId)
      group.contributions.push(contribution)
      for (const packageId of contribution.packageIds) {
        if (!group.packageIds.includes(packageId)) group.packageIds.push(packageId)
      }
      addLength(group.lengthMap, contribution)
      groups.set(key, group)
    })
  return Array.from(groups.values())
    .map(({ lengthMap, ...group }) => ({
      ...group,
      contributionIds: group.contributionIds.sort(),
      packageIds: group.packageIds.sort(),
      contributions: group.contributions.slice().sort((a, b) => a.segmentIndex - b.segmentIndex || a.quantityLineId.localeCompare(b.quantityLineId)),
      measuredLengthByUnit: sortedLengths(lengthMap),
    }))
    .sort((a, b) => a.pageNumber - b.pageNumber || a.annotationId.localeCompare(b.annotationId))
}

export function buildWireProfileAssignmentPlan(input: BuildWireProfileAssignmentPlanInput): WireProfileAssignmentPlan {
  const errors: string[] = []
  const warnings = new Set<string>()
  const targetProfileId = normalizeWireProfileId(input.targetProfileId)
  const activeProfiles = listAssignableActiveWireProfiles(input.projectId, input.wireProfiles)
  if (!targetProfileId || !activeProfiles.some((profile) => profile.id === targetProfileId)) {
    errors.push('Choose an active Wire Profile for this project.')
  }

  const contributionById = new Map(input.contributions.map((contribution) => [contribution.quantityLineId, contribution]))
  const annotationsById = new Map(input.annotations.map((annotation) => [annotation.id, annotation]))
  const selectedByAnnotation = new Map<string, WireProfileAssignmentSelection[]>()
  for (const selection of input.selections) {
    const annotationId = cleanId(selection.annotationId)
    if (!annotationId) continue
    const list = selectedByAnnotation.get(annotationId) || []
    if (selection.mode === 'annotation-default') list.push({ mode: 'annotation-default', annotationId })
    else list.push({ ...selection, annotationId, quantityLineId: cleanId(selection.quantityLineId), segmentId: cleanId(selection.segmentId) })
    selectedByAnnotation.set(annotationId, list)
  }

  const changes: WireProfileAssignmentChange[] = []
  const pages = new Set<number>()
  const packageIds = new Set<string>()
  const lengthMap = new Map<string, { unit: string | null; measuredLength: number | null }>()
  let routeCount = 0
  let segmentCount = 0

  for (const [annotationId, selections] of selectedByAnnotation) {
    const annotation = annotationsById.get(annotationId)
    if (!annotation) {
      errors.push(`Annotation ${annotationId} is no longer available.`)
      continue
    }
    if (annotation.projectId !== input.projectId || annotation.blueprintSetId !== input.blueprintSetId || annotation.deletedAt) {
      errors.push(`Annotation ${annotationId} is no longer assignable in this blueprint set.`)
      continue
    }
    const routeSelected = selections.some((selection) => selection.mode === 'annotation-default')
    if (routeSelected) {
      const routeContributions = input.contributions.filter((contribution) => contribution.annotationId === annotationId)
      const unassigned = routeContributions.filter((contribution) => contribution.profileResolution.status === 'unassigned')
      if (routeContributions.some((contribution) => contribution.projectId !== input.projectId || contribution.blueprintSetId !== input.blueprintSetId)) {
        errors.push(`Route ${annotationId} is no longer in this blueprint set.`)
        continue
      }
      if (unassigned.length === 0) {
        errors.push(`Route ${annotationId} is no longer Unassigned.`)
        continue
      }
      if (readMeta(annotation).segmentWireProfileIds?.some((id) => normalizeWireProfileId(id))) {
        warnings.add('Whole-route assignment preserves existing segment overrides.')
      }
      routeCount += 1
      segmentCount += unassigned.length
      changes.push({ annotationId, mode: 'annotation-default', quantityLineIds: unassigned.map((item) => item.quantityLineId).sort(), segmentIds: unassigned.map((item) => item.segmentId).sort() })
      for (const contribution of unassigned) {
        pages.add(contribution.pageNumber)
        contribution.packageIds.forEach((id) => packageIds.add(id))
        addLength(lengthMap, contribution)
      }
      continue
    }

    const quantityIds = new Set(selections.filter((selection) => selection.mode === 'segment-override').map((selection) => selection.quantityLineId))
    const segmentContributions: WireQuantityContribution[] = []
    for (const quantityLineId of quantityIds) {
      const contribution = contributionById.get(quantityLineId)
      if (!contribution || contribution.annotationId !== annotationId) {
        errors.push(`Segment ${quantityLineId} is no longer available.`)
        continue
      }
      if (contribution.projectId !== input.projectId || contribution.blueprintSetId !== input.blueprintSetId) {
        errors.push(`Segment ${quantityLineId} is no longer in this blueprint set.`)
      } else if (contribution.profileResolution.status !== 'unassigned') {
        errors.push(`Segment ${quantityLineId} is no longer Unassigned.`)
      } else if (contribution.segmentId.startsWith('legacy:')) {
        errors.push(`Segment ${quantityLineId} needs stable segment identity before assignment.`)
      } else {
        segmentContributions.push(contribution)
      }
    }
    if (segmentContributions.length === 0) continue
    segmentCount += segmentContributions.length
    changes.push({
      annotationId,
      mode: 'segment-override',
      quantityLineIds: segmentContributions.map((item) => item.quantityLineId).sort(),
      segmentIds: segmentContributions.map((item) => item.segmentId).sort(),
    })
    for (const contribution of segmentContributions) {
      pages.add(contribution.pageNumber)
      contribution.packageIds.forEach((id) => packageIds.add(id))
      addLength(lengthMap, contribution)
    }
  }

  if (routeCount + segmentCount === 0) errors.push('Select at least one Unassigned route or segment.')
  if (pages.size > 1) warnings.add('Undo restores one page at a time.')
  if (packageIds.size > 0) warnings.add('This updates the physical route and all Work Packages that reference it.')

  return {
    ok: errors.length === 0,
    targetProfileId,
    changes,
    affectedPages: Array.from(pages).sort((a, b) => a - b),
    affectedPackageIds: Array.from(packageIds).sort(),
    selectedLengthByUnit: sortedLengths(lengthMap),
    routeCount,
    segmentCount,
    warnings: Array.from(warnings),
    errors,
  }
}

export function applyWireProfileAssignmentPlanToAnnotations(
  annotations: readonly BlueprintAnnotation[],
  plan: WireProfileAssignmentPlan,
): BlueprintAnnotation[] {
  if (!plan.ok || !plan.targetProfileId) return annotations.slice()
  const changesByAnnotation = new Map(plan.changes.map((change) => [change.annotationId, change]))
  return annotations.map((annotation) => {
    const change = changesByAnnotation.get(annotation.id)
    if (!change) return annotation
    const meta = readMeta(annotation)
    if (change.mode === 'annotation-default') {
      return writeMeta(annotation, assignAnnotationWireProfileDefault(meta, plan.targetProfileId))
    }
    let nextMeta = meta
    const segmentIds = Array.isArray(meta.segmentIds) ? meta.segmentIds.map((id) => cleanId(id)) : []
    for (const segmentId of change.segmentIds) {
      if (!segmentId || segmentId.startsWith('legacy:')) continue
      const index = segmentIds.indexOf(segmentId)
      if (index >= 0) nextMeta = assignSegmentWireProfileOverride(nextMeta, index, plan.targetProfileId)
    }
    return nextMeta === meta ? annotation : writeMeta(annotation, nextMeta)
  })
}
