import { assignSegmentWireProfileOverride, normalizeWireProfileId, type CircuitWireProfileMetadata } from '@/features/blueprint-wire-profiles'
import { getCircuitArcControl } from '@/features/blueprint-measurements'
import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'
import type { WireProfile } from '@/features/blueprint-wire-profiles'
import type { WireQuantityContribution } from './types'
import { listAssignableActiveWireProfiles } from './wireQuantityAssignment'

export type WireSegmentPickShapeKind = 'circuit-path' | 'circuit-arc'

export interface WireSegmentRangeSelection {
  id: string
  annotationId: string
  pageNumber: number
  shapeKind: WireSegmentPickShapeKind
  startPointId: string
  endPointId: string
  segmentIds: string[]
}

export interface WireSegmentRangeResolution {
  annotationId: string
  pageNumber: number
  shapeKind: WireSegmentPickShapeKind
  startPointId: string
  endPointId: string
  segmentIds: string[]
}

export interface WireSegmentProfileAssignmentChange {
  annotationId: string
  pageNumber: number
  segmentIds: string[]
}

export interface WireSegmentProfileAssignmentPlan {
  ok: boolean
  projectId: string
  blueprintSetId: string
  targetWireProfileId: string | null
  selectedRanges: WireSegmentRangeSelection[]
  changes: WireSegmentProfileAssignmentChange[]
  selectedLengthByUnit: Array<{ unit: string | null; measuredLength: number | null }>
  affectedPackageIds: string[]
  affectedAnnotations: string[]
  replacedOverrides: Array<{ annotationId: string; segmentId: string; previousWireProfileId: string }>
  segmentCount: number
  rangeCount: number
  errors: string[]
  warnings: string[]
}

export interface WireSegmentPickHoverState {
  annotationId: string
  pointId?: string
  segmentIds?: string[]
}

export interface WireSegmentPickOverlaySegment {
  key: string
  annotationId: string
  segmentId: string
  tone: 'eligible' | 'hover' | 'active' | 'pending' | 'preview'
  shapeKind: WireSegmentPickShapeKind
  start: { x: number; y: number }
  end: { x: number; y: number }
  control?: { x: number; y: number }
}

export interface WireSegmentPickOverlayPoint {
  key: string
  annotationId: string
  pointId: string
  tone: 'point' | 'start' | 'hover'
  point: { x: number; y: number }
}

export interface WireSegmentPickOverlayDiagnostic {
  code: 'annotation-missing' | 'annotation-deleted' | 'annotation-other-page' | 'annotation-ineligible' | 'topology-invalid' | 'segment-missing'
  annotationId: string
  segmentId?: string
}

export interface WireSegmentPickOverlayModel {
  segments: WireSegmentPickOverlaySegment[]
  points: WireSegmentPickOverlayPoint[]
  diagnostics: WireSegmentPickOverlayDiagnostic[]
  previewSegmentCount: number
  pendingSegmentCount: number
}

export interface BuildWireSegmentPickOverlayModelInput {
  annotations: readonly BlueprintAnnotation[]
  currentPage: number
  eligibleAnnotationIds: ReadonlySet<string>
  activeAnnotationId?: string | null
  startPointId?: string | null
  hover?: WireSegmentPickHoverState | null
  pendingRanges: readonly WireSegmentRangeSelection[]
  includeEligible?: boolean
}

export interface BuildWireSegmentProfileAssignmentPlanInput {
  projectId: string
  blueprintSetId: string
  targetWireProfileId: string | null | undefined
  selectedRanges: readonly WireSegmentRangeSelection[]
  annotations: readonly BlueprintAnnotation[]
  contributions: readonly WireQuantityContribution[]
  wireProfiles: readonly WireProfile[]
  eligibleAnnotationIds: ReadonlySet<string>
}

function cleanId(value: unknown): string {
  return String(value || '').trim()
}

function readMeta(annotation: BlueprintAnnotation): CircuitWireProfileMetadata & Record<string, unknown> {
  return ((annotation.meta || annotation.metadata || {}) as CircuitWireProfileMetadata & Record<string, unknown>)
}

function writeMeta(annotation: BlueprintAnnotation, meta: CircuitWireProfileMetadata): BlueprintAnnotation {
  const next = { ...annotation, meta: { ...(annotation.meta || {}), ...meta } } as BlueprintAnnotation
  if (annotation.metadata && annotation.metadata !== annotation.meta) {
    next.metadata = { ...(annotation.metadata || {}), ...meta } as any
  }
  return next
}

function shapeKindFromMeta(meta: Record<string, unknown>): WireSegmentPickShapeKind | null {
  return meta.shapeKind === 'circuit-path' || meta.shapeKind === 'circuit-arc' ? meta.shapeKind : null
}

function readPointArray(value: unknown): Array<{ x: number; y: number }> {
  return Array.isArray(value)
    ? value
      .map((point) => ({ x: Number((point as any)?.x), y: Number((point as any)?.y) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : []
}

function getOverlayRoute(
  annotation: BlueprintAnnotation | undefined,
  input: Pick<BuildWireSegmentPickOverlayModelInput, 'currentPage' | 'eligibleAnnotationIds'>,
  diagnostics: WireSegmentPickOverlayDiagnostic[],
) {
  const annotationId = cleanId(annotation?.id)
  if (!annotation) {
    return null
  }
  if (annotation.deletedAt) {
    diagnostics.push({ code: 'annotation-deleted', annotationId })
    return null
  }
  if (Math.max(1, Math.floor(Number(annotation.pageNumber) || 1)) !== input.currentPage) {
    diagnostics.push({ code: 'annotation-other-page', annotationId })
    return null
  }
  if (!input.eligibleAnnotationIds.has(annotationId)) {
    diagnostics.push({ code: 'annotation-ineligible', annotationId })
    return null
  }
  const meta = readMeta(annotation)
  const shapeKind = shapeKindFromMeta(meta)
  const points = readPointArray(meta.points)
  const pointIds = Array.isArray(meta.pointIds) ? meta.pointIds.map(cleanId) : []
  const segmentIds = Array.isArray(meta.segmentIds) ? meta.segmentIds.map(cleanId) : []
  if (!shapeKind || points.length < 2 || pointIds.length !== points.length || segmentIds.length !== points.length - 1) {
    diagnostics.push({ code: 'topology-invalid', annotationId })
    return null
  }
  return {
    annotation,
    annotationId,
    shapeKind,
    points,
    pointIds,
    segmentIds,
    arcCtrls: meta.arcCtrls,
  }
}

function sortedLengths(map: Map<string, { unit: string | null; measuredLength: number | null }>) {
  return Array.from(map.values()).sort((a, b) => String(a.unit || '').localeCompare(String(b.unit || '')))
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

export function buildWireSegmentPickOverlayModel(input: BuildWireSegmentPickOverlayModelInput): WireSegmentPickOverlayModel {
  const currentPage = Math.max(1, Math.floor(Number(input.currentPage) || 1))
  const annotationsById = new Map(input.annotations.map((annotation) => [cleanId(annotation.id), annotation]))
  const diagnostics: WireSegmentPickOverlayDiagnostic[] = []
  const segments: WireSegmentPickOverlaySegment[] = []
  const points: WireSegmentPickOverlayPoint[] = []
  const emittedByTone = new Set<string>()
  const previewUnique = new Set<string>()
  const pendingUnique = new Set<string>()

  const resolveRoute = (annotationId: string) => {
    const cleanAnnotationId = cleanId(annotationId)
    const annotation = annotationsById.get(cleanAnnotationId)
    if (!annotation) {
      diagnostics.push({ code: 'annotation-missing', annotationId: cleanAnnotationId })
      return null
    }
    return getOverlayRoute(annotation, { currentPage, eligibleAnnotationIds: input.eligibleAnnotationIds }, diagnostics)
  }

  const addSegment = (annotationId: string, segmentId: string, tone: WireSegmentPickOverlaySegment['tone']) => {
    const route = resolveRoute(annotationId)
    const cleanSegmentId = cleanId(segmentId)
    if (!route || !cleanSegmentId) return
    const index = route.segmentIds.indexOf(cleanSegmentId)
    if (index < 0) {
      diagnostics.push({ code: 'segment-missing', annotationId: route.annotationId, segmentId: cleanSegmentId })
      return
    }
    const physicalKey = `${route.annotationId}:${cleanSegmentId}`
    if (tone === 'preview') previewUnique.add(physicalKey)
    if (tone === 'pending') pendingUnique.add(physicalKey)
    const renderKey = `${tone}:${physicalKey}`
    if (emittedByTone.has(renderKey)) return
    emittedByTone.add(renderKey)
    const start = route.points[index]
    const end = route.points[index + 1]
    const control = route.shapeKind === 'circuit-arc'
      ? getCircuitArcControl(route.arcCtrls, start, end, index)
      : undefined
    segments.push({
      key: renderKey,
      annotationId: route.annotationId,
      segmentId: cleanSegmentId,
      tone,
      shapeKind: route.shapeKind,
      start,
      end,
      ...(control ? { control } : {}),
    })
  }

  if (input.includeEligible) {
    input.eligibleAnnotationIds.forEach((annotationId) => {
      const route = resolveRoute(annotationId)
      if (!route) return
      route.segmentIds.forEach((segmentId) => addSegment(route.annotationId, segmentId, route.annotationId === input.activeAnnotationId ? 'active' : 'eligible'))
    })
  }

  if (input.hover?.annotationId && !input.hover.segmentIds) {
    const route = resolveRoute(input.hover.annotationId)
    route?.segmentIds.forEach((segmentId) => addSegment(route.annotationId, segmentId, 'hover'))
  }

  input.pendingRanges.forEach((range) => {
    range.segmentIds.forEach((segmentId) => addSegment(range.annotationId, segmentId, 'pending'))
  })

  if (input.hover?.annotationId && input.hover.segmentIds) {
    input.hover.segmentIds.forEach((segmentId) => addSegment(input.hover!.annotationId, segmentId, 'preview'))
  }

  if (input.activeAnnotationId) {
    const route = resolveRoute(input.activeAnnotationId)
    route?.points.forEach((point, index) => {
      const pointId = route.pointIds[index]
      if (!pointId) return
      points.push({
        key: `point:${route.annotationId}:${pointId}`,
        annotationId: route.annotationId,
        pointId,
        tone: pointId === input.startPointId ? 'start' : pointId === input.hover?.pointId ? 'hover' : 'point',
        point,
      })
    })
  }

  return {
    segments,
    points,
    diagnostics,
    previewSegmentCount: previewUnique.size,
    pendingSegmentCount: pendingUnique.size,
  }
}

export function resolveWireSegmentRange(params: {
  annotation: Pick<BlueprintAnnotation, 'id' | 'pageNumber' | 'meta' | 'metadata'>
  startPointId: string
  endPointId: string
}): { ok: true; range: WireSegmentRangeResolution } | { ok: false; error: string } {
  const meta = readMeta(params.annotation as BlueprintAnnotation)
  const shapeKind = shapeKindFromMeta(meta)
  if (!shapeKind) return { ok: false, error: 'Select a Circuit Path or Circuit Arc.' }
  const points = Array.isArray(meta.points) ? meta.points : []
  const pointIds = Array.isArray(meta.pointIds) ? meta.pointIds.map(cleanId) : []
  const segmentIds = Array.isArray(meta.segmentIds) ? meta.segmentIds.map(cleanId) : []
  if (points.length < 2 || pointIds.length !== points.length) return { ok: false, error: 'Route point identity is stale. Recreate or edit the route before assigning segments.' }
  if (segmentIds.length !== points.length - 1) return { ok: false, error: 'Route segment identity is stale. Recreate or edit the route before assigning segments.' }
  const startPointId = cleanId(params.startPointId)
  const endPointId = cleanId(params.endPointId)
  const startIndex = pointIds.indexOf(startPointId)
  const endIndex = pointIds.indexOf(endPointId)
  if (startIndex < 0) return { ok: false, error: 'Starting point is no longer available.' }
  if (endIndex < 0) return { ok: false, error: 'Ending point is no longer available.' }
  if (startIndex === endIndex) return { ok: false, error: 'Choose a different ending point.' }
  const low = Math.min(startIndex, endIndex)
  const high = Math.max(startIndex, endIndex)
  const selectedSegmentIds = segmentIds.slice(low, high)
  if (selectedSegmentIds.length === 0) return { ok: false, error: 'No physical segments exist between those points.' }
  if (selectedSegmentIds.some((id) => !id)) return { ok: false, error: 'Selected range contains a missing segment ID.' }
  if (selectedSegmentIds.some((id) => id.startsWith('legacy:'))) return { ok: false, error: 'Selected range needs stable segment identity before assignment.' }
  return {
    ok: true,
    range: {
      annotationId: params.annotation.id,
      pageNumber: Math.max(1, Math.floor(Number(params.annotation.pageNumber) || 1)),
      shapeKind,
      startPointId,
      endPointId,
      segmentIds: selectedSegmentIds,
    },
  }
}

export function buildWireSegmentProfileAssignmentPlan(input: BuildWireSegmentProfileAssignmentPlanInput): WireSegmentProfileAssignmentPlan {
  const errors: string[] = []
  const warnings = new Set<string>()
  const projectId = cleanId(input.projectId)
  const blueprintSetId = cleanId(input.blueprintSetId)
  const targetWireProfileId = normalizeWireProfileId(input.targetWireProfileId)
  const activeProfiles = listAssignableActiveWireProfiles(projectId, input.wireProfiles)
  if (!targetWireProfileId || !activeProfiles.some((profile) => profile.id === targetWireProfileId)) {
    errors.push('Choose an active Wire Profile for this project.')
  }

  const annotationsById = new Map(input.annotations.map((annotation) => [annotation.id, annotation]))
  const contributionsBySegment = new Map(input.contributions.map((contribution) => [`${contribution.annotationId}:${contribution.segmentId}`, contribution]))
  const segmentIdsByAnnotation = new Map<string, Set<string>>()
  const affectedPackageIds = new Set<string>()
  const affectedAnnotations = new Set<string>()
  const lengthMap = new Map<string, { unit: string | null; measuredLength: number | null }>()
  const replacedOverrides: Array<{ annotationId: string; segmentId: string; previousWireProfileId: string }> = []

  for (const range of input.selectedRanges) {
    const annotationId = cleanId(range.annotationId)
    const annotation = annotationsById.get(annotationId)
    if (!annotation) {
      errors.push(`Annotation ${annotationId} is no longer available.`)
      continue
    }
    if (!input.eligibleAnnotationIds.has(annotationId)) {
      errors.push(`Annotation ${annotationId} is no longer in this Work Package draft.`)
      continue
    }
    if (annotation.projectId !== projectId || annotation.blueprintSetId !== blueprintSetId || annotation.deletedAt) {
      errors.push(`Annotation ${annotationId} is no longer assignable in this blueprint set.`)
      continue
    }
    const resolved = resolveWireSegmentRange({
      annotation,
      startPointId: range.startPointId,
      endPointId: range.endPointId,
    })
    if (!resolved.ok) {
      errors.push(`${annotationId}: ${resolved.error}`)
      continue
    }
    const expected = [...range.segmentIds].map(cleanId).sort()
    const actual = [...resolved.range.segmentIds].sort()
    if (expected.join('\n') !== actual.join('\n')) {
      errors.push(`Selected range on ${annotationId} is stale. Remove and reselect it.`)
      continue
    }
    const ids = segmentIdsByAnnotation.get(annotationId) || new Set<string>()
    resolved.range.segmentIds.forEach((segmentId) => ids.add(segmentId))
    segmentIdsByAnnotation.set(annotationId, ids)
    affectedAnnotations.add(annotationId)
  }

  const changes: WireSegmentProfileAssignmentChange[] = []
  for (const [annotationId, segmentSet] of segmentIdsByAnnotation) {
    const annotation = annotationsById.get(annotationId)
    if (!annotation) continue
    const meta = readMeta(annotation)
    const liveSegmentIds = Array.isArray(meta.segmentIds) ? meta.segmentIds.map(cleanId) : []
    const overrideIds = Array.isArray(meta.segmentWireProfileIds) ? meta.segmentWireProfileIds.map(normalizeWireProfileId) : []
    const segmentIds = Array.from(segmentSet).sort()
    for (const segmentId of segmentIds) {
      if (!segmentId || segmentId.startsWith('legacy:')) {
        errors.push(`Segment ${segmentId || '(missing)'} needs stable segment identity before assignment.`)
        continue
      }
      const index = liveSegmentIds.indexOf(segmentId)
      if (index < 0) {
        errors.push(`Segment ${segmentId} is no longer available.`)
        continue
      }
      const contribution = contributionsBySegment.get(`${annotationId}:${segmentId}`)
      if (contribution) {
        contribution.packageIds.forEach((id) => affectedPackageIds.add(id))
        addLength(lengthMap, contribution)
      }
      const previous = overrideIds[index]
      if (previous && previous !== targetWireProfileId) {
        replacedOverrides.push({ annotationId, segmentId, previousWireProfileId: previous })
      }
    }
    changes.push({
      annotationId,
      pageNumber: Math.max(1, Math.floor(Number(annotation.pageNumber) || 1)),
      segmentIds,
    })
  }

  if (input.selectedRanges.length === 0 || changes.reduce((sum, change) => sum + change.segmentIds.length, 0) === 0) {
    errors.push('Select at least one wire segment range.')
  }
  if (affectedPackageIds.size > 0) warnings.add('This updates the selected physical wire segments everywhere they are referenced.')
  const pages = new Set(changes.map((change) => change.pageNumber))
  if (pages.size > 1) warnings.add('Undo restores one page at a time.')

  return {
    ok: errors.length === 0,
    projectId,
    blueprintSetId,
    targetWireProfileId,
    selectedRanges: input.selectedRanges.slice(),
    changes: changes.sort((a, b) => a.pageNumber - b.pageNumber || a.annotationId.localeCompare(b.annotationId)),
    selectedLengthByUnit: sortedLengths(lengthMap),
    affectedPackageIds: Array.from(affectedPackageIds).sort(),
    affectedAnnotations: Array.from(affectedAnnotations).sort(),
    replacedOverrides: replacedOverrides.sort((a, b) => a.annotationId.localeCompare(b.annotationId) || a.segmentId.localeCompare(b.segmentId)),
    segmentCount: changes.reduce((sum, change) => sum + change.segmentIds.length, 0),
    rangeCount: input.selectedRanges.length,
    errors,
    warnings: Array.from(warnings),
  }
}

export function applyWireSegmentProfileAssignmentPlanToAnnotations(
  annotations: readonly BlueprintAnnotation[],
  plan: WireSegmentProfileAssignmentPlan,
): BlueprintAnnotation[] {
  if (!plan.ok || !plan.targetWireProfileId) return annotations.slice()
  const changesByAnnotation = new Map(plan.changes.map((change) => [change.annotationId, change]))
  return annotations.map((annotation) => {
    const change = changesByAnnotation.get(annotation.id)
    if (!change) return annotation
    const meta = readMeta(annotation)
    const segmentIds = Array.isArray(meta.segmentIds) ? meta.segmentIds.map(cleanId) : []
    let nextMeta: CircuitWireProfileMetadata = meta
    for (const segmentId of change.segmentIds) {
      const index = segmentIds.indexOf(segmentId)
      if (index >= 0) nextMeta = assignSegmentWireProfileOverride(nextMeta, index, plan.targetWireProfileId)
    }
    return nextMeta === meta ? annotation : writeMeta(annotation, nextMeta)
  })
}
