import type {
  WireDisplayStyle,
  WireInstallationFamily,
  WireProfile,
  WireProfileAllowedTool,
  WireProfileResolution,
} from './types'

export const WIRE_INSTALLATION_FAMILIES: WireInstallationFamily[] = ['cable', 'mc', 'raceway', 'feeder', 'custom']
export const WIRE_DISPLAY_STYLES: WireDisplayStyle[] = ['solid', 'dashed', 'dotted']
export const WIRE_PROFILE_ALLOWED_TOOLS: WireProfileAllowedTool[] = ['circuit-path', 'circuit-arc']

const INSTALLATION_FAMILY_SET = new Set<string>(WIRE_INSTALLATION_FAMILIES)
const DISPLAY_STYLE_SET = new Set<string>(WIRE_DISPLAY_STYLES)
const ALLOWED_TOOL_SET = new Set<string>(WIRE_PROFILE_ALLOWED_TOOLS)
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const EPOCH_FALLBACK_ISO = '1970-01-01T00:00:00.000Z'

export function createWireProfileId(): string {
  if (globalThis.crypto?.randomUUID) return `wire_profile_${globalThis.crypto.randomUUID()}`
  return `wire_profile_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function trimOptional(value: unknown): string | undefined {
  if (value == null) return undefined
  const trimmed = String(value).trim()
  return trimmed || undefined
}

function normalizedTimestamp(value: unknown, fallback = EPOCH_FALLBACK_ISO): string {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return fallback
  return new Date(ms).toISOString()
}

export function sanitizeWireProfile(raw: unknown): WireProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const profile = raw as Record<string, unknown>
  const id = String(profile.id || '').trim()
  const projectId = String(profile.projectId || '').trim()
  const name = String(profile.name || '').trim()
  const installationFamily = String(profile.installationFamily || '').trim()
  const displayColor = String(profile.displayColor || '').trim()
  const displayWidth = Number(profile.displayWidth)
  const displayStyle = String(profile.displayStyle || '').trim()
  const wastePercent = profile.wastePercent == null ? 0 : Number(profile.wastePercent)
  const unitCost = profile.unitCost == null ? undefined : Number(profile.unitCost)
  const allowedTools = Array.isArray(profile.allowedTools)
    ? [...new Set(profile.allowedTools.map((tool) => String(tool || '').trim()).filter(Boolean))]
    : []

  if (!id || !projectId || !name) return null
  if (!INSTALLATION_FAMILY_SET.has(installationFamily)) return null
  if (!HEX_COLOR_RE.test(displayColor)) return null
  if (!Number.isFinite(displayWidth) || displayWidth <= 0) return null
  if (!DISPLAY_STYLE_SET.has(displayStyle)) return null
  if (!Number.isFinite(wastePercent) || wastePercent < 0 || wastePercent > 100) return null
  if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) return null
  if (allowedTools.some((tool) => !ALLOWED_TOOL_SET.has(tool))) return null

  const createdAt = normalizedTimestamp(profile.createdAt)
  const deletedAt = normalizedTimestamp(profile.deletedAt, '')
  let updatedAt = normalizedTimestamp(profile.updatedAt, createdAt)
  if (deletedAt && Date.parse(deletedAt) > Date.parse(updatedAt)) updatedAt = deletedAt

  return {
    id,
    projectId,
    name,
    installationFamily: installationFamily as WireInstallationFamily,
    materialDescription: trimOptional(profile.materialDescription),
    conductorDescription: trimOptional(profile.conductorDescription),
    displayColor,
    displayWidth,
    displayStyle: displayStyle as WireDisplayStyle,
    wastePercent,
    ...(unitCost != null ? { unitCost } : {}),
    costReference: trimOptional(profile.costReference),
    allowedTools: allowedTools as WireProfileAllowedTool[],
    isArchived: profile.isArchived === true,
    createdAt,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {}),
    ...(deletedAt && profile.deletedBy != null ? { deletedBy: String(profile.deletedBy) } : {}),
  }
}

export function createWireProfile(input: Omit<Partial<WireProfile>, 'id' | 'createdAt' | 'updatedAt'> & {
  projectId: string
  name: string
  installationFamily: WireInstallationFamily
  displayColor: string
  displayWidth: number
  displayStyle: WireDisplayStyle
  allowedTools: WireProfileAllowedTool[]
}, now = new Date().toISOString()): WireProfile {
  const clean = sanitizeWireProfile({
    ...input,
    id: createWireProfileId(),
    wastePercent: input.wastePercent ?? 0,
    isArchived: input.isArchived ?? false,
    createdAt: now,
    updatedAt: now,
  })
  if (!clean) throw new Error('Invalid wire profile.')
  return clean
}

export function updateWireProfile(profile: WireProfile, patch: Partial<WireProfile>, now = new Date().toISOString()): WireProfile {
  const clean = sanitizeWireProfile({
    ...profile,
    ...patch,
    id: profile.id,
    projectId: profile.projectId,
    createdAt: profile.createdAt,
    updatedAt: now,
  })
  if (!clean) throw new Error('Invalid wire profile update.')
  return clean
}

export function duplicateWireProfile(profile: WireProfile, now = new Date().toISOString()): WireProfile {
  const clean = sanitizeWireProfile({
    ...profile,
    id: createWireProfileId(),
    name: `${profile.name} Copy`,
    isArchived: false,
    deletedAt: undefined,
    deletedBy: undefined,
    createdAt: now,
    updatedAt: now,
  })
  if (!clean) throw new Error('Invalid duplicated wire profile.')
  return clean
}

export function archiveWireProfile(profile: WireProfile, now = new Date().toISOString()): WireProfile {
  return updateWireProfile(profile, { isArchived: true }, now)
}

export function restoreWireProfile(profile: WireProfile, now = new Date().toISOString()): WireProfile {
  return updateWireProfile(profile, { isArchived: false, deletedAt: undefined, deletedBy: undefined }, now)
}

export function createWireProfileTombstone(profile: WireProfile, deletedBy?: string | null, now = new Date().toISOString()): WireProfile {
  return {
    ...profile,
    deletedAt: now,
    updatedAt: now,
    ...(deletedBy ? { deletedBy } : {}),
  }
}

export function resolveWireProfileStatus(profileId: string | null | undefined, profiles: WireProfile[]): WireProfileResolution {
  const id = String(profileId || '').trim()
  if (!id) return { status: 'UNASSIGNED', profileId: null }
  const profile = profiles.find((item) => item.id === id && !item.deletedAt)
  if (!profile) return { status: 'MISSING', profileId: id }
  return { status: profile.isArchived ? 'ASSIGNED_ARCHIVED' : 'ASSIGNED_ACTIVE', profileId: id, profile }
}
