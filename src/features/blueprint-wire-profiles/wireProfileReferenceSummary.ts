import type { BlueprintAnnotation } from '@/services/blueprintLibraryService'

export type WireProfileReferenceSummary = {
  totalLiveReferences: number
  defaultAssignmentCount: number
  segmentOverrideCount: number
  blueprintSetCount: number
  pageCount: number
}

const EMPTY_SUMMARY: WireProfileReferenceSummary = {
  totalLiveReferences: 0,
  defaultAssignmentCount: 0,
  segmentOverrideCount: 0,
  blueprintSetCount: 0,
  pageCount: 0,
}

function readMeta(annotation: BlueprintAnnotation | any): Record<string, unknown> {
  if (annotation?.meta && typeof annotation.meta === 'object') return annotation.meta
  if (annotation?.metadata && typeof annotation.metadata === 'object') return annotation.metadata
  return {}
}

export function summarizeWireProfileReferences(
  references: Array<BlueprintAnnotation | any>,
  profileId: string,
): WireProfileReferenceSummary {
  const id = String(profileId || '').trim()
  if (!id) return { ...EMPTY_SUMMARY }
  const liveAnnotationIds = new Set<string>()
  const blueprintSetIds = new Set<string>()
  const pages = new Set<string>()
  let defaultAssignmentCount = 0
  let segmentOverrideCount = 0

  for (const annotation of Array.isArray(references) ? references : []) {
    if (!annotation || annotation.deletedAt) continue
    const annotationId = String(annotation.id || '').trim()
    const blueprintSetId = String(annotation.blueprintSetId || '').trim()
    const pageNumber = Math.max(1, Math.floor(Number(annotation.pageNumber) || 1))
    const meta = readMeta(annotation)
    const defaultId = String(meta.wireProfileId || '').trim()
    const segmentIds = Array.isArray(meta.segmentWireProfileIds)
      ? meta.segmentWireProfileIds.map((entry: unknown) => String(entry || '').trim())
      : []
    const defaultMatches = defaultId === id
    const segmentMatches = segmentIds.filter((entry) => entry === id).length

    if (!defaultMatches && segmentMatches === 0) continue
    if (annotationId) liveAnnotationIds.add(annotationId)
    if (blueprintSetId) {
      blueprintSetIds.add(blueprintSetId)
      pages.add(`${blueprintSetId}:${pageNumber}`)
    }
    if (defaultMatches) defaultAssignmentCount += 1
    segmentOverrideCount += segmentMatches
  }

  return {
    totalLiveReferences: liveAnnotationIds.size,
    defaultAssignmentCount,
    segmentOverrideCount,
    blueprintSetCount: blueprintSetIds.size,
    pageCount: pages.size,
  }
}

export function collectMissingWireProfileReferenceIds(
  annotations: Array<BlueprintAnnotation | any>,
  liveProfileIds: Iterable<string>,
): string[] {
  const known = new Set(Array.from(liveProfileIds).map((id) => String(id || '').trim()).filter(Boolean))
  const missing = new Set<string>()
  for (const annotation of Array.isArray(annotations) ? annotations : []) {
    if (!annotation || annotation.deletedAt) continue
    const meta = readMeta(annotation)
    const ids = [
      String(meta.wireProfileId || '').trim(),
      ...(Array.isArray(meta.segmentWireProfileIds)
        ? meta.segmentWireProfileIds.map((entry: unknown) => String(entry || '').trim())
        : []),
    ].filter(Boolean)
    ids.forEach((id) => {
      if (!known.has(id)) missing.add(id)
    })
  }
  return Array.from(missing).sort()
}
