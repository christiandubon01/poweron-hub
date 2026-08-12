export type PilotTelemetryEventName =
  | 'onboarding_started'
  | 'onboarding_completed'
  | 'login_success'
  | 'blueprint_opened'
  | 'blueprint_measurement_created'
  | 'circuit_path_created'
  | 'circuit_arc_created'
  | 'work_package_created'
  | 'feature_error'
  | 'founder_support_incident'

export const PILOT_TELEMETRY_EVENT_NAMES: readonly PilotTelemetryEventName[] = [
  'onboarding_started',
  'onboarding_completed',
  'login_success',
  'blueprint_opened',
  'blueprint_measurement_created',
  'circuit_path_created',
  'circuit_arc_created',
  'work_package_created',
  'feature_error',
  'founder_support_incident',
] as const

export type PilotOrganizationClassification =
  | 'customer_zero'
  | 'design_partner'
  | 'normal'
  | 'internal'
  | 'demo'
  | 'unknown'

export interface PilotActivationSnapshot {
  activated: boolean
  firstValueAt: string | null
  onboardingCompletedAt: string | null
  activationAt: string | null
  minutesToFirstValue: number | null
}

export interface WeeklyActivityEvent {
  organizationId: string
  userId: string | null
  occurredAt: string
  eventName: string
}

const BLOCKED_METADATA_KEYS = [
  'address',
  'amount',
  'businessname',
  'content',
  'customer',
  'customername',
  'description',
  'document',
  'email',
  'estimate',
  'invoice',
  'name',
  'note',
  'notes',
  'payload',
  'phone',
  'projectdescription',
  'secret',
  'signedurl',
  'stack',
  'street',
  'token',
  'url',
  'wage',
]

const ALL_PILOT_EVENT_NAMES = new Set<PilotTelemetryEventName>(PILOT_TELEMETRY_EVENT_NAMES)

const MEANINGFUL_EVENT_NAMES = new Set<PilotTelemetryEventName>([
  'onboarding_completed',
  'blueprint_opened',
  'blueprint_measurement_created',
  'circuit_path_created',
  'circuit_arc_created',
  'work_package_created',
])

export function getPilotOrganizationClassification(
  settings: unknown,
): PilotOrganizationClassification {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return 'unknown'
  }

  const root = settings as Record<string, unknown>
  const pilot = root.pilot && typeof root.pilot === 'object' && !Array.isArray(root.pilot)
    ? root.pilot as Record<string, unknown>
    : null
  const raw =
    String(
      pilot?.classification
      ?? pilot?.segment
      ?? root.pilot_classification
      ?? root.customer_segment
      ?? '',
    )
      .trim()
      .toLowerCase()

  if (raw === 'customer_zero' || raw === 'design_partner' || raw === 'normal' || raw === 'internal' || raw === 'demo') {
    return raw
  }
  if (raw === 'customer0' || raw === 'customer-0') return 'customer_zero'
  if (raw === 'pilot' || raw === 'design-partner') return 'design_partner'
  return 'unknown'
}

export function isMeaningfulPilotEventName(eventName: string): boolean {
  return MEANINGFUL_EVENT_NAMES.has(eventName as PilotTelemetryEventName)
}

export function isPilotTelemetryEventName(eventName: string): eventName is PilotTelemetryEventName {
  return ALL_PILOT_EVENT_NAMES.has(eventName as PilotTelemetryEventName)
}

export function sanitizeTelemetryMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (!normalizedKey || BLOCKED_METADATA_KEYS.some((blocked) => normalizedKey.includes(blocked))) {
      continue
    }
    if (value == null) continue

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) continue
      sanitized[key] = trimmed.slice(0, 160)
      continue
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
      continue
    }

    if (Array.isArray(value)) {
      const items = value
        .filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry))
        .slice(0, 12)
        .map((entry) => typeof entry === 'string' ? entry.slice(0, 80) : entry)
      if (items.length > 0) sanitized[key] = items
      continue
    }

    if (typeof value === 'object') {
      const nested = sanitizeTelemetryMetadata(value as Record<string, unknown>)
      if (Object.keys(nested).length > 0) sanitized[key] = nested
    }
  }

  return sanitized
}

export function derivePilotActivationSnapshot(input: {
  organizationCreatedAt: string | null
  onboardingCompletedAt?: string | null
  firstProjectAt?: string | null
  firstEstimateAt?: string | null
  firstBlueprintUploadAt?: string | null
  firstEmployeeInviteAt?: string | null
}): PilotActivationSnapshot {
  const candidates = [
    input.firstProjectAt,
    input.firstEstimateAt,
    input.firstBlueprintUploadAt,
    input.firstEmployeeInviteAt,
  ].filter(Boolean) as string[]

  const firstValueAt = candidates.sort()[0] ?? null
  const activationAt = firstValueAt
  const createdAt = input.organizationCreatedAt ? Date.parse(input.organizationCreatedAt) : Number.NaN
  const firstValueMs = firstValueAt ? Date.parse(firstValueAt) : Number.NaN

  return {
    activated: Boolean(firstValueAt),
    firstValueAt,
    onboardingCompletedAt: input.onboardingCompletedAt ?? null,
    activationAt,
    minutesToFirstValue:
      Number.isFinite(createdAt) && Number.isFinite(firstValueMs)
        ? Math.max(0, Math.round((firstValueMs - createdAt) / 60000))
        : null,
  }
}

export function deriveWeeklyActivitySummary(
  events: WeeklyActivityEvent[],
  weekStartIso: string,
  weekEndIso: string,
): { weeklyActiveOrganizations: number; weeklyActiveUsers: number } {
  const weekStart = Date.parse(weekStartIso)
  const weekEnd = Date.parse(weekEndIso)
  const orgIds = new Set<string>()
  const userIds = new Set<string>()

  for (const event of events) {
    const at = Date.parse(event.occurredAt)
    if (!Number.isFinite(at) || at < weekStart || at >= weekEnd) continue
    if (!isMeaningfulPilotEventName(event.eventName)) continue
    if (event.organizationId) orgIds.add(event.organizationId)
    if (event.userId) userIds.add(event.userId)
  }

  return {
    weeklyActiveOrganizations: orgIds.size,
    weeklyActiveUsers: userIds.size,
  }
}

export function isBlueprintActiveOrganization(input: {
  hasBlueprintOpen: boolean
  measurementCount: number
  circuitPathCount: number
  circuitArcCount: number
  workPackageCount: number
}): boolean {
  return input.hasBlueprintOpen && (
    input.measurementCount > 0
    || input.circuitPathCount > 0
    || input.circuitArcCount > 0
    || input.workPackageCount > 0
  )
}

export function isEmployeePortalActiveOrganization(input: {
  acceptedEmployees: number
  timePunchCount: number
}): boolean {
  return input.acceptedEmployees > 0 && input.timePunchCount > 0
}
