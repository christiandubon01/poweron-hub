import { resolveWireProfileStatus } from './wireProfileModel'
import type { WireProfile, WireProfileResolution, WireProfileResolutionStatus } from './types'
import { assignAnnotationWireProfileDefault, normalizeWireProfileId } from './wireProfileAssignment'

/** Canonical Quick Access slot count — must match the viewer localStorage model. */
export const QUICK_ACCESS_SLOT_COUNT = 10

/** Stable BackupData keys for the ten visual slots (position-based, tool-independent). */
export const QUICK_ACCESS_SLOT_KEYS = Array.from(
  { length: QUICK_ACCESS_SLOT_COUNT },
  (_, index) => `slot-${index + 1}`,
) as readonly string[]

const SLOT_KEY_SET = new Set(QUICK_ACCESS_SLOT_KEYS)

export type QuickAccessWireProfileBinding = {
  wireProfileId: string | null
  updatedAt: string
}

/** projectId → slotKey → binding entry (timestamped for per-slot LWW merge). */
export type BlueprintQuickAccessWireProfileBindings = Record<
  string,
  Record<string, QuickAccessWireProfileBinding>
>

export type QuickAccessWireProfileSupportInput = {
  toolType?: string | null
  toolVariant?: string | null
}

export type QuickAccessActivationDecision =
  | { ok: true; wireProfileId: string | null; status: WireProfileResolutionStatus; profile?: WireProfile }
  | { ok: false; status: 'ASSIGNED_ARCHIVED' | 'MISSING'; message: string; wireProfileId: string | null; profile?: WireProfile }

export type QuickAccessWireProfileReferenceSummary = {
  annotationReferenceCount: number
  quickAccessReferenceCount: number
  totalReferenceCount: number
  quickAccessSlotKeys: string[]
  defaultAssignmentCount: number
  segmentOverrideCount: number
  blueprintSetCount: number
  pageCount: number
}

export const ARCHIVED_QUICK_ACCESS_WIRE_PROFILE_MESSAGE =
  'This Quick Access slot uses an archived Wire Profile. Choose an active profile before drawing.'

export const MISSING_QUICK_ACCESS_WIRE_PROFILE_MESSAGE =
  'This Wire Profile is unavailable in the current project. Update the Quick Access slot before drawing.'

export const QUICK_ACCESS_BINDING_SAVE_FAILURE_MESSAGE =
  'The Quick Access appearance was saved on this device, but the Wire Profile binding could not be saved.'

const EPOCH_FALLBACK_ISO = '1970-01-01T00:00:00.000Z'

export function supportsWireProfileAssignment(input: QuickAccessWireProfileSupportInput | null | undefined): boolean {
  if (!input) return false
  const toolType = String(input.toolType || '').trim()
  const toolVariant = String(input.toolVariant || '').trim()
  return toolType === 'shape' && (toolVariant === 'circuit-path' || toolVariant === 'circuit-arc')
}

export function getQuickAccessSlotKey(slotIndex: number): string | null {
  const index = Math.floor(Number(slotIndex))
  if (!Number.isFinite(index) || index < 0 || index >= QUICK_ACCESS_SLOT_COUNT) return null
  return QUICK_ACCESS_SLOT_KEYS[index]
}

export function isQuickAccessSlotKey(value: unknown): value is string {
  return typeof value === 'string' && SLOT_KEY_SET.has(value)
}

function normalizedTimestamp(value: unknown, fallback = EPOCH_FALLBACK_ISO): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return fallback
  return new Date(ms).toISOString()
}

export function sanitizeQuickAccessWireProfileBinding(
  raw: unknown,
  fallbackUpdatedAt = EPOCH_FALLBACK_ISO,
): QuickAccessWireProfileBinding | null {
  if (raw == null) {
    return { wireProfileId: null, updatedAt: normalizedTimestamp(fallbackUpdatedAt) }
  }
  if (typeof raw === 'string') {
    const id = normalizeWireProfileId(raw)
    return { wireProfileId: id, updatedAt: normalizedTimestamp(fallbackUpdatedAt) }
  }
  if (typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (!('wireProfileId' in entry) && entry.updatedAt == null) return null
  const id = entry.wireProfileId == null ? null : normalizeWireProfileId(entry.wireProfileId)
  // Blank strings sanitize to null (explicit Unassigned); keep missing IDs as stored strings when non-blank.
  if (entry.wireProfileId != null && typeof entry.wireProfileId !== 'string' && typeof entry.wireProfileId !== 'number') {
    return null
  }
  return {
    wireProfileId: id,
    updatedAt: normalizedTimestamp(entry.updatedAt, fallbackUpdatedAt),
  }
}

export function sanitizeQuickAccessWireProfileBindings(raw: unknown): BlueprintQuickAccessWireProfileBindings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: BlueprintQuickAccessWireProfileBindings = {}
  for (const [projectIdRaw, projectVal] of Object.entries(raw as Record<string, unknown>)) {
    const projectId = String(projectIdRaw || '').trim()
    if (!projectId) continue
    if (!projectVal || typeof projectVal !== 'object' || Array.isArray(projectVal)) continue
    const slotMap: Record<string, QuickAccessWireProfileBinding> = {}
    for (const [slotKeyRaw, slotVal] of Object.entries(projectVal as Record<string, unknown>)) {
      const slotKey = String(slotKeyRaw || '').trim()
      if (!isQuickAccessSlotKey(slotKey)) continue
      const binding = sanitizeQuickAccessWireProfileBinding(slotVal)
      if (!binding) continue
      slotMap[slotKey] = binding
    }
    if (Object.keys(slotMap).length > 0) out[projectId] = slotMap
  }
  return out
}

export function canonicalQuickAccessWireProfileBindingSignature(
  entry: QuickAccessWireProfileBinding,
): string {
  return JSON.stringify({
    wireProfileId: entry.wireProfileId ?? null,
    updatedAt: entry.updatedAt,
  })
}

export function resolveQuickAccessWireProfileBinding(
  bindings: BlueprintQuickAccessWireProfileBindings | null | undefined,
  projectId: string | null | undefined,
  slotKey: string | null | undefined,
): string | null {
  const cleanProjectId = String(projectId || '').trim()
  const cleanSlotKey = String(slotKey || '').trim()
  if (!cleanProjectId || !isQuickAccessSlotKey(cleanSlotKey)) return null
  const entry = bindings?.[cleanProjectId]?.[cleanSlotKey]
  if (!entry) return null
  return normalizeWireProfileId(entry.wireProfileId)
}

export function setQuickAccessWireProfileBinding(
  bindings: BlueprintQuickAccessWireProfileBindings | null | undefined,
  projectId: string,
  slotKey: string,
  wireProfileId: string | null | undefined,
  updatedAt = new Date().toISOString(),
): BlueprintQuickAccessWireProfileBindings {
  const cleanProjectId = String(projectId || '').trim()
  const cleanSlotKey = String(slotKey || '').trim()
  if (!cleanProjectId || !isQuickAccessSlotKey(cleanSlotKey)) {
    return sanitizeQuickAccessWireProfileBindings(bindings)
  }
  const next = sanitizeQuickAccessWireProfileBindings(bindings)
  const projectMap = { ...(next[cleanProjectId] || {}) }
  projectMap[cleanSlotKey] = {
    wireProfileId: normalizeWireProfileId(wireProfileId),
    updatedAt: normalizedTimestamp(updatedAt, new Date().toISOString()),
  }
  next[cleanProjectId] = projectMap
  return next
}

export function clearQuickAccessWireProfileBinding(
  bindings: BlueprintQuickAccessWireProfileBindings | null | undefined,
  projectId: string,
  slotKey: string,
  updatedAt = new Date().toISOString(),
): BlueprintQuickAccessWireProfileBindings {
  // Explicit Unassigned — retain the slot entry so merge/sync can propagate the clear.
  return setQuickAccessWireProfileBinding(bindings, projectId, slotKey, null, updatedAt)
}

export function clearAllQuickAccessWireProfileBindingsForProject(
  bindings: BlueprintQuickAccessWireProfileBindings | null | undefined,
  projectId: string,
  updatedAt = new Date().toISOString(),
): BlueprintQuickAccessWireProfileBindings {
  const cleanProjectId = String(projectId || '').trim()
  const next = sanitizeQuickAccessWireProfileBindings(bindings)
  if (!cleanProjectId) return next
  const projectMap: Record<string, QuickAccessWireProfileBinding> = {}
  for (const slotKey of QUICK_ACCESS_SLOT_KEYS) {
    projectMap[slotKey] = { wireProfileId: null, updatedAt: normalizedTimestamp(updatedAt) }
  }
  next[cleanProjectId] = projectMap
  return next
}

export function listSelectableQuickAccessWireProfiles(
  profiles: WireProfile[],
  currentBoundId?: string | null,
): Array<{ profileId: string | null; label: string; status: WireProfileResolutionStatus; profile?: WireProfile }> {
  const live = (Array.isArray(profiles) ? profiles : []).filter((profile) => !profile.deletedAt)
  const options: Array<{ profileId: string | null; label: string; status: WireProfileResolutionStatus; profile?: WireProfile }> = [
    { profileId: null, label: 'Unassigned', status: 'UNASSIGNED' },
  ]
  const active = live.filter((profile) => !profile.isArchived).sort((a, b) => a.name.localeCompare(b.name))
  for (const profile of active) {
    options.push({
      profileId: profile.id,
      label: profile.name,
      status: 'ASSIGNED_ACTIVE',
      profile,
    })
  }
  const boundId = normalizeWireProfileId(currentBoundId)
  if (!boundId) return options
  if (options.some((option) => option.profileId === boundId)) return options
  const resolution = resolveWireProfileStatus(boundId, live)
  if (resolution.status === 'ASSIGNED_ARCHIVED' && resolution.profile) {
    options.push({
      profileId: boundId,
      label: `Archived: ${resolution.profile.name}`,
      status: 'ASSIGNED_ARCHIVED',
      profile: resolution.profile,
    })
  } else if (resolution.status === 'MISSING') {
    options.push({
      profileId: boundId,
      label: `Missing Profile (${boundId})`,
      status: 'MISSING',
    })
  }
  return options
}

export function decideQuickAccessWireProfileActivation(
  wireProfileId: string | null | undefined,
  profiles: WireProfile[],
): QuickAccessActivationDecision {
  const resolution = resolveWireProfileStatus(wireProfileId, profiles)
  if (resolution.status === 'ASSIGNED_ACTIVE') {
    return {
      ok: true,
      wireProfileId: resolution.profileId,
      status: resolution.status,
      profile: resolution.profile,
    }
  }
  if (resolution.status === 'UNASSIGNED') {
    return { ok: true, wireProfileId: null, status: 'UNASSIGNED' }
  }
  if (resolution.status === 'ASSIGNED_ARCHIVED') {
    return {
      ok: false,
      status: 'ASSIGNED_ARCHIVED',
      message: ARCHIVED_QUICK_ACCESS_WIRE_PROFILE_MESSAGE,
      wireProfileId: resolution.profileId,
      profile: resolution.profile,
    }
  }
  return {
    ok: false,
    status: 'MISSING',
    message: MISSING_QUICK_ACCESS_WIRE_PROFILE_MESSAGE,
    wireProfileId: resolution.profileId,
  }
}

export function applyQuickAccessWireProfileToAnnotationMeta<T extends Record<string, any>>(
  meta: T,
  wireProfileId: string | null | undefined,
): T {
  const next = assignAnnotationWireProfileDefault(meta, wireProfileId)
  // EST-1C: annotation default only — do not invent segment overrides.
  if ('segmentWireProfileIds' in next && !Array.isArray(meta.segmentWireProfileIds)) {
    delete (next as any).segmentWireProfileIds
  }
  return next
}

export function validateQuickAccessActivationIdentity(input: {
  activationProjectId?: string | null
  activationBlueprintSetId?: string | null
  currentProjectId?: string | null
  currentBlueprintSetId?: string | null
}): { ok: true } | { ok: false; reason: 'project-mismatch' | 'blueprint-mismatch' } {
  const activationProjectId = String(input.activationProjectId || '').trim()
  const currentProjectId = String(input.currentProjectId || '').trim()
  if (!activationProjectId || !currentProjectId || activationProjectId !== currentProjectId) {
    return { ok: false, reason: 'project-mismatch' }
  }
  const activationBlueprintSetId = String(input.activationBlueprintSetId || '').trim()
  const currentBlueprintSetId = String(input.currentBlueprintSetId || '').trim()
  if (activationBlueprintSetId && currentBlueprintSetId && activationBlueprintSetId !== currentBlueprintSetId) {
    return { ok: false, reason: 'blueprint-mismatch' }
  }
  return { ok: true }
}

export function findQuickAccessWireProfileReferences(
  bindings: BlueprintQuickAccessWireProfileBindings | null | undefined,
  projectId: string | null | undefined,
  profileId: string | null | undefined,
): string[] {
  const cleanProjectId = String(projectId || '').trim()
  const id = normalizeWireProfileId(profileId)
  if (!cleanProjectId || !id) return []
  const projectMap = sanitizeQuickAccessWireProfileBindings(bindings)[cleanProjectId] || {}
  return QUICK_ACCESS_SLOT_KEYS.filter((slotKey) => projectMap[slotKey]?.wireProfileId === id)
}

export function mergeQuickAccessWireProfileBindingsBySlot(
  remoteRaw: unknown,
  incomingRaw: unknown,
): BlueprintQuickAccessWireProfileBindings {
  const remote = sanitizeQuickAccessWireProfileBindings(remoteRaw)
  const incoming = sanitizeQuickAccessWireProfileBindings(incomingRaw)
  const projectIds = new Set([...Object.keys(remote), ...Object.keys(incoming)])
  const out: BlueprintQuickAccessWireProfileBindings = {}

  for (const projectId of projectIds) {
    const remoteMap = remote[projectId] || {}
    const incomingMap = incoming[projectId] || {}
    const slotKeys = new Set([...Object.keys(remoteMap), ...Object.keys(incomingMap)])
    const nextMap: Record<string, QuickAccessWireProfileBinding> = {}
    for (const slotKey of slotKeys) {
      if (!isQuickAccessSlotKey(slotKey)) continue
      const remoteEntry = remoteMap[slotKey]
      const incomingEntry = incomingMap[slotKey]
      if (!remoteEntry && incomingEntry) {
        nextMap[slotKey] = incomingEntry
        continue
      }
      if (remoteEntry && !incomingEntry) {
        nextMap[slotKey] = remoteEntry
        continue
      }
      if (!remoteEntry || !incomingEntry) continue
      const remoteMs = Date.parse(remoteEntry.updatedAt)
      const incomingMs = Date.parse(incomingEntry.updatedAt)
      if (incomingMs > remoteMs) nextMap[slotKey] = incomingEntry
      else if (remoteMs > incomingMs) nextMap[slotKey] = remoteEntry
      else {
        const remoteSignature = canonicalQuickAccessWireProfileBindingSignature(remoteEntry)
        const incomingSignature = canonicalQuickAccessWireProfileBindingSignature(incomingEntry)
        // Equal timestamps need a content-based tie-break so device argument order cannot decide sync state.
        nextMap[slotKey] = incomingSignature > remoteSignature ? incomingEntry : remoteEntry
      }
    }
    if (Object.keys(nextMap).length > 0) out[projectId] = nextMap
  }
  return out
}

export function resolveQuickAccessWireProfileDisplay(
  wireProfileId: string | null | undefined,
  profiles: WireProfile[],
): { label: string; status: WireProfileResolutionStatus; profile?: WireProfile } {
  const resolution: WireProfileResolution = resolveWireProfileStatus(wireProfileId, profiles)
  if (resolution.status === 'UNASSIGNED') return { label: 'Unassigned', status: 'UNASSIGNED' }
  if (resolution.status === 'ASSIGNED_ACTIVE' && resolution.profile) {
    return { label: resolution.profile.name, status: 'ASSIGNED_ACTIVE', profile: resolution.profile }
  }
  if (resolution.status === 'ASSIGNED_ARCHIVED' && resolution.profile) {
    return { label: `Archived: ${resolution.profile.name}`, status: 'ASSIGNED_ARCHIVED', profile: resolution.profile }
  }
  return { label: 'Missing Profile', status: 'MISSING' }
}

export function buildCombinedWireProfileReferenceSummary(input: {
  annotationReferenceCount: number
  defaultAssignmentCount?: number
  segmentOverrideCount?: number
  blueprintSetCount?: number
  pageCount?: number
  quickAccessSlotKeys: string[]
}): QuickAccessWireProfileReferenceSummary {
  const quickAccessSlotKeys = Array.from(new Set((input.quickAccessSlotKeys || []).filter(isQuickAccessSlotKey))).sort()
  const annotationReferenceCount = Math.max(0, Math.floor(Number(input.annotationReferenceCount) || 0))
  const quickAccessReferenceCount = quickAccessSlotKeys.length
  return {
    annotationReferenceCount,
    quickAccessReferenceCount,
    totalReferenceCount: annotationReferenceCount + quickAccessReferenceCount,
    quickAccessSlotKeys,
    defaultAssignmentCount: Math.max(0, Math.floor(Number(input.defaultAssignmentCount) || 0)),
    segmentOverrideCount: Math.max(0, Math.floor(Number(input.segmentOverrideCount) || 0)),
    blueprintSetCount: Math.max(0, Math.floor(Number(input.blueprintSetCount) || 0)),
    pageCount: Math.max(0, Math.floor(Number(input.pageCount) || 0)),
  }
}
