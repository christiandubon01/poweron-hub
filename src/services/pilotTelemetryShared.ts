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
  | 'module_entered'
  | 'engagement_window'

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
  'module_entered',
  'engagement_window',
] as const

/** Product-usage events that use strict metadata allowlists (no business content). */
export const PRODUCT_USAGE_TELEMETRY_EVENT_NAMES = [
  'module_entered',
  'engagement_window',
] as const satisfies readonly PilotTelemetryEventName[]

export type ProductUsageTelemetryEventName = (typeof PRODUCT_USAGE_TELEMETRY_EVENT_NAMES)[number]

export const CANONICAL_PRODUCT_MODULES = [
  'home',
  'projects',
  'blueprint',
  'material-takeoff',
  'estimates',
  'field-log',
  'team',
  'money',
  'guardian',
  'settings',
  'activity',
  'journal',
  'sales-intelligence',
  'crew-portal',
  'employee-portal',
] as const

export type CanonicalProductModule = (typeof CANONICAL_PRODUCT_MODULES)[number]

/** Max engagement window seconds — matches Guardian 30-minute inactivity boundary. */
export const ENGAGEMENT_WINDOW_MAX_SECONDS = 30 * 60

const MODULE_ENTERED_METADATA_KEYS = new Set(['previous_module', 'device_id', 'session_id'])
const ENGAGEMENT_WINDOW_METADATA_KEYS = new Set(['duration_seconds', 'device_id', 'session_id'])
const CANONICAL_PRODUCT_MODULE_SET = new Set<string>(CANONICAL_PRODUCT_MODULES)

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

export function isProductUsageTelemetryEventName(
  eventName: string,
): eventName is ProductUsageTelemetryEventName {
  return (PRODUCT_USAGE_TELEMETRY_EVENT_NAMES as readonly string[]).includes(eventName)
}

export function isCanonicalProductModule(moduleSlug: string | null | undefined): moduleSlug is CanonicalProductModule {
  return CANONICAL_PRODUCT_MODULE_SET.has(String(moduleSlug || '').trim().toLowerCase())
}

/**
 * Normalize a product module slug to the canonical Guardian presence set.
 * Unknown views fall back to `home` (same authority as presenceMonitor.normalizeModule).
 */
export function normalizeCanonicalProductModule(view: string | null | undefined): CanonicalProductModule {
  const raw = String(view || '').trim().toLowerCase()
  if (!raw) return 'home'
  if (isCanonicalProductModule(raw)) return raw

  // Keep these aliases aligned with presenceMonitor MODULE_MAP.
  if (raw === 'project-inner') return 'projects'
  if (raw === 'blueprint-ai') return 'blueprint'
  return 'home'
}

export function boundEngagementDurationSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  if (rounded < 1) return null
  return Math.min(rounded, ENGAGEMENT_WINDOW_MAX_SECONDS)
}

function sanitizeIdentityToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // UUID / opaque device tokens only — reject free-form content.
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(trimmed)) return null
  return trimmed.slice(0, 128)
}

/**
 * Strict allowlist sanitizer for product-usage telemetry.
 * Drops project/customer/estimate/file/route content and unknown keys.
 */
export function sanitizeProductUsageTelemetryMetadata(
  eventName: ProductUsageTelemetryEventName,
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}

  const allowedKeys = eventName === 'module_entered'
    ? MODULE_ENTERED_METADATA_KEYS
    : ENGAGEMENT_WINDOW_METADATA_KEYS

  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowedKeys.has(key)) continue

    if (key === 'previous_module') {
      if (typeof value !== 'string') continue
      const normalized = normalizeCanonicalProductModule(value)
      // Only persist when caller provided a real prior module string.
      if (String(value || '').trim()) sanitized.previous_module = normalized
      continue
    }

    if (key === 'duration_seconds') {
      const bounded = boundEngagementDurationSeconds(value)
      if (bounded != null) sanitized.duration_seconds = bounded
      continue
    }

    if (key === 'device_id' || key === 'session_id') {
      const token = sanitizeIdentityToken(value)
      if (token) sanitized[key] = token
    }
  }

  return sanitized
}

export function buildProductUsageTelemetryRecord(input: {
  eventName: ProductUsageTelemetryEventName
  module?: string | null
  metadata?: Record<string, unknown> | null
  occurredAt?: string | null
}): {
  eventName: ProductUsageTelemetryEventName
  module: CanonicalProductModule
  feature: null
  objectId: null
  metadata: Record<string, unknown>
  occurredAt: string | null
} | null {
  if (!isProductUsageTelemetryEventName(input.eventName)) return null

  const module = normalizeCanonicalProductModule(input.module)
  const metadata = sanitizeProductUsageTelemetryMetadata(input.eventName, input.metadata)

  if (input.eventName === 'engagement_window' && typeof metadata.duration_seconds !== 'number') {
    return null
  }

  return {
    eventName: input.eventName,
    module,
    feature: null,
    objectId: null,
    metadata,
    occurredAt: input.occurredAt ?? null,
  }
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
