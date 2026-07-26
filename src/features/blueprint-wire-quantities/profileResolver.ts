import type { WireProfile } from '@/features/blueprint-wire-profiles'
import type { WireProfileResolution } from './types'

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export function resolveSegmentWireProfile(params: {
  projectId: string
  annotationMeta: Record<string, unknown>
  stableSegmentId: string
  wireProfiles: readonly WireProfile[]
}): WireProfileResolution {
  const segmentIds = Array.isArray(params.annotationMeta.segmentIds)
    ? params.annotationMeta.segmentIds.map((value) => String(value || '').trim())
    : []
  const overrideIndex = segmentIds.indexOf(params.stableSegmentId)
  const rawOverride = Array.isArray(params.annotationMeta.segmentWireProfileIds) && overrideIndex >= 0
    ? cleanId(params.annotationMeta.segmentWireProfileIds[overrideIndex])
    : null
  const annotationDefault = cleanId(params.annotationMeta.wireProfileId)
  const wireProfileId = rawOverride || annotationDefault
  const source: 'segment-override' | 'annotation-default' | 'unassigned' = rawOverride ? 'segment-override' : annotationDefault ? 'annotation-default' : 'unassigned'
  if (!wireProfileId) return { status: 'unassigned', source: 'unassigned', wireProfileId: null }
  const assignedSource = source === 'unassigned' ? 'annotation-default' : source

  const profile = params.wireProfiles.find((item) => item.id === wireProfileId && !item.deletedAt)
  if (!profile) return { status: 'missing-profile', source: assignedSource, wireProfileId }
  if (profile.projectId !== params.projectId) return { status: 'cross-project-profile', source: assignedSource, wireProfileId }
  return {
    status: profile.isArchived ? 'archived' : 'active',
    source: assignedSource,
    wireProfileId,
    profile,
  }
}
