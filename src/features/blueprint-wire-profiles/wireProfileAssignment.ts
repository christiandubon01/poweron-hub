import { resolveWireProfileStatus } from './wireProfileModel'
import type { WireProfile, WireProfileResolution } from './types'

export interface CircuitWireProfileMetadata {
  wireProfileId?: string | null
  segmentWireProfileIds?: Array<string | null>
  segmentIds?: unknown
}

export function normalizeWireProfileId(value: unknown): string | null {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export function readAnnotationWireProfileId(meta: CircuitWireProfileMetadata | null | undefined): string | null {
  return normalizeWireProfileId(meta?.wireProfileId)
}

export function readSegmentWireProfileIds(meta: CircuitWireProfileMetadata | null | undefined): Array<string | null> | undefined {
  return Array.isArray(meta?.segmentWireProfileIds)
    ? meta.segmentWireProfileIds.map(normalizeWireProfileId)
    : undefined
}

export function normalizeCircuitWireProfileMetadata<T extends CircuitWireProfileMetadata>(
  meta: T,
  segmentIds: unknown = meta.segmentIds,
): T {
  const next: CircuitWireProfileMetadata = { ...meta }
  const defaultId = readAnnotationWireProfileId(meta)
  if (defaultId) next.wireProfileId = defaultId
  else if ('wireProfileId' in next) next.wireProfileId = null

  const segments = Array.isArray(segmentIds) ? segmentIds : []
  if (Array.isArray(meta.segmentWireProfileIds)) {
    next.segmentWireProfileIds = Array.from({ length: segments.length }, (_, index) => normalizeWireProfileId(meta.segmentWireProfileIds?.[index]))
  } else {
    delete next.segmentWireProfileIds
  }
  return next as T
}

export function resolveWireProfileIdForSegmentIndex(meta: CircuitWireProfileMetadata | null | undefined, segmentIndex: number): string | null {
  const index = Math.floor(Number(segmentIndex))
  if (!Number.isFinite(index) || index < 0) return readAnnotationWireProfileId(meta)
  const overrides = readSegmentWireProfileIds(meta)
  const override = overrides && index < overrides.length ? overrides[index] : null
  return override || readAnnotationWireProfileId(meta)
}

export function resolveWireProfileIdForSegmentId(meta: CircuitWireProfileMetadata | null | undefined, segmentId: string): string | null {
  const id = String(segmentId || '').trim()
  const segmentIds = Array.isArray(meta?.segmentIds) ? meta.segmentIds.map((entry) => String(entry || '').trim()) : []
  const index = id ? segmentIds.indexOf(id) : -1
  return index >= 0 ? resolveWireProfileIdForSegmentIndex(meta, index) : readAnnotationWireProfileId(meta)
}

export function assignAnnotationWireProfileDefault<T extends CircuitWireProfileMetadata>(meta: T, profileId: string | null | undefined): T {
  return { ...meta, wireProfileId: normalizeWireProfileId(profileId) } as T
}

export function assignSegmentWireProfileOverride<T extends CircuitWireProfileMetadata>(meta: T, segmentIndex: number, profileId: string | null | undefined): T {
  const segmentIds = Array.isArray(meta.segmentIds) ? meta.segmentIds : []
  const count = segmentIds.length
  const index = Math.floor(Number(segmentIndex))
  if (!Number.isFinite(index) || index < 0 || index >= count) return meta
  const current = readSegmentWireProfileIds(meta)
  const overrides = Array.from({ length: count }, (_, i) => current?.[i] ?? null)
  overrides[index] = normalizeWireProfileId(profileId)
  return { ...meta, segmentWireProfileIds: overrides } as T
}

export function clearSegmentWireProfileOverride<T extends CircuitWireProfileMetadata>(meta: T, segmentIndex: number): T {
  return assignSegmentWireProfileOverride(meta, segmentIndex, null)
}

export function clearAllWireProfileAssignments<T extends CircuitWireProfileMetadata>(meta: T): T {
  const next: CircuitWireProfileMetadata = { ...meta, wireProfileId: null }
  delete next.segmentWireProfileIds
  return next as T
}

export function resolveWireProfileAssignmentStatus(profileId: string | null | undefined, profiles: WireProfile[]): WireProfileResolution {
  return resolveWireProfileStatus(profileId, profiles)
}

export function remapSegmentWireProfileIds(input: {
  previousSegmentIds: string[]
  nextSegmentIds: string[]
  previousSegmentWireProfileIds?: Array<string | null>
}): Array<string | null> | undefined {
  const previousOverrides = Array.isArray(input.previousSegmentWireProfileIds)
    ? input.previousSegmentWireProfileIds.map(normalizeWireProfileId)
    : undefined
  if (!previousOverrides) return undefined
  const previousIds = Array.isArray(input.previousSegmentIds)
    ? input.previousSegmentIds.map((id) => String(id || '').trim())
    : []
  const nextIds = Array.isArray(input.nextSegmentIds)
    ? input.nextSegmentIds.map((id) => String(id || '').trim())
    : []
  const byId = new Map<string, string | null>()
  previousIds.forEach((id, index) => {
    if (id && !byId.has(id)) byId.set(id, index < previousIds.length ? previousOverrides[index] ?? null : null)
  })
  const hasStableOverlap = nextIds.some((id) => !!id && byId.has(id))

  return nextIds.map((id, index) => {
    if (id && byId.has(id)) return byId.get(id) ?? null
    return hasStableOverlap || index >= previousIds.length ? null : previousOverrides[index] ?? null
  })
}

export function handleSegmentTopologyChange<T extends CircuitWireProfileMetadata>(
  meta: T,
  previousSegmentIds: string[],
  nextSegmentIds: string[],
): T {
  const remapped = remapSegmentWireProfileIds({
    previousSegmentIds,
    nextSegmentIds,
    previousSegmentWireProfileIds: readSegmentWireProfileIds(meta),
  })
  if (!remapped) return { ...meta, segmentIds: nextSegmentIds } as T
  return { ...meta, segmentIds: nextSegmentIds, segmentWireProfileIds: remapped } as T
}
