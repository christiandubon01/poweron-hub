import { createClient } from '@supabase/supabase-js'
import { Redis } from '@upstash/redis'
import {
  derivePilotActivationSnapshot,
  deriveWeeklyActivitySummary,
  getPilotOrganizationClassification,
  isBlueprintActiveOrganization,
  isEmployeePortalActiveOrganization,
  isPilotTelemetryEventName,
  isProductUsageTelemetryEventName,
  buildProductUsageTelemetryRecord,
  sanitizeTelemetryMetadata,
} from '../../src/services/pilotTelemetryShared'
import {
  allowsNDAAccess,
  hasRealNDAArtifact,
  resolveNDAStatus,
  type NDAAccessOverrideRecordLike,
  type NDASignedAgreementRecordLike,
} from '../../src/services/ndaAuthority'
import {
  buildFounderPresenceDetail,
  buildFounderPresenceSummary,
  buildFounderSecurityAlerts,
  buildFounderSecurityHistory,
  buildFounderGlobalSecurityHistory,
  type FounderPresenceSessionRow,
  type FounderSecurityEventRow,
} from '../../src/services/guardianFounderPresence'
import {
  buildFounderAdoptionKpis,
  buildFounderLiveNowKpis,
  buildFounderOnboardingKpis,
  buildFounderSecurityKpiCounts,
  isExcludedFromAdoptionKpis,
} from '../../src/services/guardianFounderKpis'
import {
  buildFleetAccessCountsFromProfiles,
  buildFounderFleetOrgMetrics,
} from '../../src/services/guardianFounderFleet'

type NetlifyEvent = {
  httpMethod?: string
  headers?: Record<string, string | undefined>
  queryStringParameters?: Record<string, string | undefined>
  body?: string | null
}

type FounderPilotOrganizationIndexEntry = {
  organizationId: string
  organizationName: string
  classification: string
}

type FounderPilotRecentActivityEntry = {
  organizationId: string
  organizationName: string
  classification: string
  eventName: string
  module: string | null
  feature: string | null
  occurredAt: string
  metadata: Record<string, unknown>
}

type FounderContractorUserAccessRow = {
  userId: string
  name: string | null
  email: string | null
  role: string | null
  isActive: boolean
  revokedAt: string | null
  revokedBy: string | null
  restoredAt: string | null
  restoredBy: string | null
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  }
}

function readBearerToken(event: NetlifyEvent): string | null {
  const value = event.headers?.authorization ?? event.headers?.Authorization ?? ''
  const match = String(value).match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

async function verifyAuthenticatedUser(event: NetlifyEvent) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
  const token = readBearerToken(event)

  if (!supabaseUrl || !anonKey || !token) return null

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

let _redis: Redis | null = null

function getRedisClient() {
  if (_redis) return _redis
  const url = process.env.UPSTASH_REDIS_URL || ''
  const token = process.env.UPSTASH_REDIS_TOKEN || ''
  if (!url || !token) return null
  _redis = new Redis({ url, token })
  return _redis
}

function sessionRedisKey(sessionId: string) {
  return `session:${sessionId}`
}

function founderEmail(): string {
  return String(
    process.env.PILOT_TELEMETRY_FOUNDER_EMAIL
    || process.env.ADMIN_EMAIL
    || process.env.VITE_ADMIN_EMAIL
    || '',
  ).trim().toLowerCase()
}

const FOUNDER_ACTIVITY_BLOCKED_KEYS = [
  'attachment',
  'blueprint',
  'content',
  'customer',
  'estimate',
  'fieldlog',
  'id',
  'note',
  'project',
  'summary',
]

function sanitizeFounderActivityMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const sanitized = sanitizeTelemetryMetadata(metadata || {})
  const filtered: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(sanitized)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (!normalizedKey || FOUNDER_ACTIVITY_BLOCKED_KEYS.some((blocked) => normalizedKey.includes(blocked))) {
      continue
    }

    if (Array.isArray(value)) {
      const items = value
        .filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry))
        .slice(0, 8)
      if (items.length > 0) filtered[key] = items
      continue
    }

    if (value && typeof value === 'object') {
      const nested = sanitizeFounderActivityMetadata(value as Record<string, unknown>)
      if (Object.keys(nested).length > 0) filtered[key] = nested
      continue
    }

    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) filtered[key] = trimmed.slice(0, 120)
      continue
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      filtered[key] = value
    }
  }

  return filtered
}

export function buildFounderPilotRecentActivity(input: {
  telemetry: any[]
  organizations: FounderPilotOrganizationIndexEntry[]
  limit?: number
}): FounderPilotRecentActivityEntry[] {
  const organizationsById = new Map(
    input.organizations.map((organization) => [organization.organizationId, organization]),
  )

  return (input.telemetry ?? [])
    .map((event: any) => {
      const organizationId = String(event?.organization_id || '').trim()
      const organization = organizationsById.get(organizationId)
      if (!organization) return null

      return {
        organizationId,
        organizationName: organization.organizationName,
        classification: organization.classification,
        eventName: String(event?.event_name || '').trim(),
        module: event?.module ? String(event.module) : null,
        feature: event?.feature ? String(event.feature) : null,
        occurredAt: String(event?.occurred_at || '').trim(),
        metadata: sanitizeFounderActivityMetadata(
          event?.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
            ? event.metadata
            : {},
        ),
      }
    })
    .filter((entry): entry is FounderPilotRecentActivityEntry => Boolean(entry?.organizationId && entry.occurredAt && entry.eventName))
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, input.limit ?? 40)
}

function deriveAgreementArtifactFilename(record: {
  pdf_url?: string | null
  typed_name?: string | null
  full_name?: string | null
  agreement_type?: string | null
  signed_at?: string | null
  created_at?: string | null
}): string {
  const storagePath = String(record.pdf_url || '').trim()
  const pathTail = storagePath.split('/').filter(Boolean).pop() || ''
  if (pathTail.toLowerCase().endsWith('.pdf')) return pathTail

  const signer = String(record.typed_name || record.full_name || 'signed-agreement')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const version = String(record.agreement_type || 'nda').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const signedAt = String(record.signed_at || record.created_at || '').slice(0, 10) || 'agreement'
  return `${signer || 'signed-agreement'}-${version || 'nda'}-${signedAt}.pdf`
}

export function isFounderUser(user: { email?: string | null } | null | undefined, configuredEmail = founderEmail()): boolean {
  const expected = String(configuredEmail || '').trim().toLowerCase()
  return Boolean(expected && String(user?.email || '').trim().toLowerCase() === expected)
}

export function requireFounder(user: any, configuredEmail = founderEmail()) {
  return isFounderUser(user, configuredEmail)
    ? null
    : json(403, { error: 'Founder access required.' })
}

async function resolveActorContext(supabase: any, userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, org_id, role, is_active')
    .eq('id', userId)
    .maybeSingle()

  const { data: employeeProfiles } = await supabase
    .from('employee_profiles')
    .select('id, org_id, active, accepted_at, portal_access')
    .eq('user_id', userId)
    .eq('active', true)

  const employeeProfile = (employeeProfiles ?? []).find((entry: any) => {
    const access = entry?.portal_access
    return access?.time_tracking === true || access?.time_tracking === 'true' || Boolean(entry?.accepted_at)
  }) ?? employeeProfiles?.[0]

  if (employeeProfile?.org_id) {
    return {
      organizationId: String(employeeProfile.org_id),
      actorUserId: userId,
      actorEmployeeProfileId: String(employeeProfile.id),
      actorKind: 'employee',
      role: 'employee',
      isActive: true,
    }
  }

  return {
    organizationId: String(profile?.org_id || ''),
    actorUserId: userId,
    actorEmployeeProfileId: null,
    actorKind: 'owner_admin',
    role: String(profile?.role || ''),
    isActive: profile?.is_active !== false,
  }
}

async function handleTrackEvent(event: NetlifyEvent, user: any) {
  const payload = event.body ? JSON.parse(event.body) : {}
  const eventName = String(payload?.eventName || '').trim()
  if (!isPilotTelemetryEventName(eventName)) {
    return json(400, { error: 'Invalid pilot telemetry event name.' })
  }
  if (eventName === 'founder_support_incident') {
    return json(400, { error: 'Use log_support_incident for founder support incidents.' })
  }
  if (payload?.isDemo === true) {
    return json(200, { ok: true, skipped: true, reason: 'demo_mode' })
  }

  const supabase = getServiceClient()
  const actor = await resolveActorContext(supabase, user.id)
  if (!actor.organizationId) {
    return json(400, { error: 'Could not resolve organization for telemetry event.' })
  }
  if (actor.isActive === false) {
    return json(403, { error: 'Access unavailable.' })
  }

  let record: Record<string, unknown>
  if (isProductUsageTelemetryEventName(eventName)) {
    const product = buildProductUsageTelemetryRecord({
      eventName,
      module: payload?.module,
      metadata: payload?.metadata,
      occurredAt: payload?.occurredAt ?? null,
    })
    if (!product) {
      return json(400, { error: 'Invalid product usage telemetry payload.' })
    }
    record = {
      organization_id: actor.organizationId,
      actor_user_id: actor.actorUserId,
      actor_employee_profile_id: actor.actorEmployeeProfileId,
      actor_kind: actor.actorKind,
      event_name: product.eventName,
      module: product.module,
      feature: product.feature,
      object_id: product.objectId,
      metadata: product.metadata,
      is_demo: false,
      occurred_at: product.occurredAt || new Date().toISOString(),
    }
  } else {
    record = {
      organization_id: actor.organizationId,
      actor_user_id: actor.actorUserId,
      actor_employee_profile_id: actor.actorEmployeeProfileId,
      actor_kind: actor.actorKind,
      event_name: eventName,
      module: String(payload?.module || '').trim() || null,
      feature: String(payload?.feature || '').trim() || null,
      object_id: String(payload?.objectId || '').trim() || null,
      metadata: sanitizeTelemetryMetadata(payload?.metadata || {}),
      is_demo: false,
      occurred_at: payload?.occurredAt || new Date().toISOString(),
    }
  }

  const { error } = await supabase.from('pilot_telemetry_events').insert(record)
  if (error) {
    return json(500, { error: error.message || 'Failed to record telemetry event.' })
  }
  return json(200, { ok: true })
}

async function handleSupportIncident(event: NetlifyEvent, user: any) {
  if (String(user?.email || '').trim().toLowerCase() !== founderEmail()) {
    return json(403, { error: 'Founder access required.' })
  }

  const payload = event.body ? JSON.parse(event.body) : {}
  const organizationId = String(payload?.organizationId || '').trim()
  const category = String(payload?.category || '').trim().toLowerCase()
  if (!organizationId || !category) {
    return json(400, { error: 'organizationId and category are required.' })
  }

  const supabase = getServiceClient()
  const { error } = await supabase.from('pilot_telemetry_events').insert({
    organization_id: organizationId,
    actor_user_id: user.id,
    actor_employee_profile_id: null,
    actor_kind: 'founder',
    event_name: 'founder_support_incident',
    module: 'support',
    feature: category,
    object_id: organizationId,
    metadata: sanitizeTelemetryMetadata({
      category,
      summary: payload?.note ?? undefined,
      minutesSpent:
        typeof payload?.minutesSpent === 'number' && Number.isFinite(payload.minutesSpent)
          ? Math.max(0, Math.round(payload.minutesSpent))
          : undefined,
    }),
    is_demo: false,
    occurred_at: new Date().toISOString(),
  })

  if (error) {
    return json(500, { error: error.message || 'Failed to log support incident.' })
  }
  return json(200, { ok: true })
}

async function handleSetOrgClassification(event: NetlifyEvent, user: any) {
  if (String(user?.email || '').trim().toLowerCase() !== founderEmail()) {
    return json(403, { error: 'Founder access required.' })
  }

  const payload = event.body ? JSON.parse(event.body) : {}
  const organizationId = String(payload?.organizationId || '').trim()
  const classification = String(payload?.classification || '').trim().toLowerCase()
  if (!organizationId || !['customer_zero', 'design_partner', 'normal'].includes(classification)) {
    return json(400, { error: 'Valid organizationId and classification are required.' })
  }

  const supabase = getServiceClient()
  const { data: current, error: currentError } = await supabase
    .from('organizations')
    .select('settings')
    .eq('id', organizationId)
    .maybeSingle()

  if (currentError) {
    return json(500, { error: currentError.message || 'Failed to load organization settings.' })
  }

  const settings = current?.settings && typeof current.settings === 'object' && !Array.isArray(current.settings)
    ? current.settings
    : {}
  const nextSettings = {
    ...settings,
    pilot: {
      ...((settings as any).pilot && typeof (settings as any).pilot === 'object' ? (settings as any).pilot : {}),
      classification,
    },
  }

  const { error } = await supabase
    .from('organizations')
    .update({ settings: nextSettings })
    .eq('id', organizationId)

  if (error) {
    return json(500, { error: error.message || 'Failed to update organization classification.' })
  }
  return json(200, { ok: true })
}

function weekRange(now = new Date()) {
  const start = new Date(now)
  const day = start.getUTCDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  start.setUTCDate(start.getUTCDate() + diffToMonday)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 7)
  return { start, end }
}

const FOUNDER_PRESENCE_LOOKBACK_DAYS = 30
const FOUNDER_PRESENCE_SUMMARY_SESSION_LIMIT = 500
const FOUNDER_SECURITY_ALERT_LIMIT = 30
const FOUNDER_SECURITY_HISTORY_LIMIT = 60
const FOUNDER_PRESENCE_DETAIL_SESSION_LIMIT = 30
const FOUNDER_PRESENCE_DETAIL_EVENT_LIMIT = 30

function isoDaysAgo(days: number, now = new Date()): string {
  return new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)).toISOString()
}

async function loadFounderContractorOrganizations(supabase: any) {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, owner_id, settings, created_at')
    .not('owner_id', 'is', null)

  if (error) throw error
  return (data ?? []).map((organization: any) => ({
    organizationId: String(organization.id),
    organizationName: String(organization.name || ''),
    ownerId: organization.owner_id ? String(organization.owner_id) : null,
  }))
}

async function loadPresenceSessions(supabase: any, options: {
  organizationIds: string[]
  limit: number
  startedAfterIso: string
}) {
  if (options.organizationIds.length === 0) return []
  const { data, error } = await supabase
    .from('user_sessions')
    .select('session_id, user_id, org_id, device_id, device_type, device_info, module, started_at, last_active_at, last_interaction_at, visibility_state, ended_reason, ended_at')
    .in('org_id', options.organizationIds)
    .not('session_id', 'is', null)
    .or(`started_at.gte.${options.startedAfterIso},last_active_at.gte.${options.startedAfterIso},ended_at.gte.${options.startedAfterIso}`)
    .order('last_active_at', { ascending: false })
    .limit(options.limit)

  if (error) throw error
  return (data ?? []) as FounderPresenceSessionRow[]
}

async function loadSecurityEvents(supabase: any, options: {
  organizationIds: string[]
  limit: number
  occurredAfterIso?: string
}) {
  if (options.organizationIds.length === 0) return []
  let query = supabase
    .from('account_security_events')
    .select('session_id, user_id, org_id, device_id, event_type, public_ip, previous_public_ip, is_new_device, occurred_at')
    .in('org_id', options.organizationIds)
    .order('occurred_at', { ascending: false })
    .limit(options.limit)

  if (options.occurredAfterIso) {
    query = query.gte('occurred_at', options.occurredAfterIso)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as FounderSecurityEventRow[]
}

/** Bounded activity rows for Active Orgs / Dormant — no full telemetry download. */
async function loadFounderActivitySessions(supabase: any, options: {
  organizationIds: string[]
  startedAfterIso: string
  limit?: number
}) {
  if (options.organizationIds.length === 0) return []
  const { data, error } = await supabase
    .from('user_sessions')
    .select('org_id, session_id, started_at, last_interaction_at')
    .in('org_id', options.organizationIds)
    .not('session_id', 'is', null)
    .or(`started_at.gte.${options.startedAfterIso},last_interaction_at.gte.${options.startedAfterIso}`)
    .order('last_interaction_at', { ascending: false })
    .limit(options.limit ?? 2000)

  if (error) throw error
  return (data ?? []) as Array<{
    org_id: string
    session_id: string | null
    started_at: string | null
    last_interaction_at: string | null
  }>
}

/** Bounded module_entered rows for Modules Used fleet column — no metadata payload. */
async function loadFounderModuleEnteredEvents(supabase: any, options: {
  organizationIds: string[]
  occurredAfterIso: string
  limit?: number
}) {
  if (options.organizationIds.length === 0) return []
  const { data, error } = await supabase
    .from('pilot_telemetry_events')
    .select('organization_id, event_name, module, occurred_at')
    .in('organization_id', options.organizationIds)
    .eq('event_name', 'module_entered')
    .gte('occurred_at', options.occurredAfterIso)
    .order('occurred_at', { ascending: false })
    .limit(options.limit ?? 3000)

  if (error) throw error
  return (data ?? []) as Array<{
    organization_id: string
    event_name: string
    module: string | null
    occurred_at: string
  }>
}

async function countSecurityEvents(supabase: any, options: {
  organizationIds: string[]
  eventType: 'session_started' | 'ip_changed'
  occurredAfterIso: string
  isNewDevice?: boolean
}) {
  if (options.organizationIds.length === 0) return 0
  let query = supabase
    .from('account_security_events')
    .select('id', { count: 'exact', head: true })
    .in('org_id', options.organizationIds)
    .eq('event_type', options.eventType)
    .gte('occurred_at', options.occurredAfterIso)

  if (options.isNewDevice === true) {
    query = query.eq('is_new_device', true)
  }

  const { count, error } = await query
  if (error) throw error
  return Number(count || 0)
}

async function countRevokedCanonicalProfiles(supabase: any, organizationIds: string[]) {
  if (organizationIds.length === 0) return 0
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .in('org_id', organizationIds)
    .eq('is_active', false)

  if (error) throw error
  return Number(count || 0)
}

async function attachUserIdentityToPresenceData(
  supabase: any,
  sessions: FounderPresenceSessionRow[],
  events: FounderSecurityEventRow[],
) {
  const userIds = [...new Set([
    ...sessions.map((session) => String(session.user_id || '')),
    ...events.map((event) => String(event.user_id || '')),
  ].filter(Boolean))]

  if (userIds.length === 0) {
    return { sessions, events }
  }

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .in('id', userIds)

  if (profileError) throw profileError

  const authUsers = await listAllAuthUsers(supabase)
  const authById = new Map(authUsers.map((user: any) => [String(user.id), user]))
  const profileById = new Map<string, { full_name: string | null; role: string | null }>(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null; role: string | null }>)
      .map((profile) => [String(profile.id), profile]),
  )

  const hydrateSession = (session: FounderPresenceSessionRow): FounderPresenceSessionRow => {
    const profile = profileById.get(String(session.user_id))
    const authUser = authById.get(String(session.user_id))
    return {
      ...session,
      user_full_name: profile?.full_name ? String(profile.full_name) : null,
      user_email: authUser?.email ? String(authUser.email) : null,
      user_role: profile?.role ? String(profile.role) : null,
    }
  }

  const hydrateEvent = (event: FounderSecurityEventRow): FounderSecurityEventRow => {
    const profile = profileById.get(String(event.user_id))
    const authUser = authById.get(String(event.user_id))
    return {
      ...event,
      user_full_name: profile?.full_name ? String(profile.full_name) : null,
      user_email: authUser?.email ? String(authUser.email) : null,
    }
  }

  return {
    sessions: sessions.map(hydrateSession),
    events: events.map(hydrateEvent),
  }
}

async function readOptionalTable(
  supabase: any,
  table: string,
  select: string,
) {
  const { data, error } = await supabase.from(table as any).select(select as any)
  if (error) return { data: null, available: false }
  return { data: data ?? [], available: true }
}

async function handleFounderReport(user: any) {
  if (String(user?.email || '').trim().toLowerCase() !== founderEmail()) {
    return json(403, { error: 'Founder access required.' })
  }

  const supabase = getServiceClient()
  const { data: organizations, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, settings, created_at')

  if (orgError) {
    return json(500, { error: orgError.message || 'Failed to load organizations.' })
  }

  const pilotOrganizations = (organizations ?? []).map((org: any) => ({
    id: String(org.id),
    name: String(org.name || ''),
    createdAt: org.created_at,
    classification: getPilotOrganizationClassification(org.settings),
  }))
  const includedOrganizations = pilotOrganizations.filter((org) => ['customer_zero', 'design_partner'].includes(org.classification))

  const pilotOrgIds = includedOrganizations.map((org) => org.id)

  const [
    projectsRes,
    estimatesRes,
    employeesRes,
    timePunchesRes,
    paymentsRes,
    portalRequestsRes,
    telemetryRes,
    blueprintUploadsRes,
  ] = await Promise.all([
    readOptionalTable(supabase, 'projects', 'id, org_id, created_at'),
    readOptionalTable(supabase, 'estimates', 'id, org_id, status, sent_at, created_at'),
    readOptionalTable(supabase, 'employee_profiles', 'id, org_id, invited_at, accepted_at'),
    readOptionalTable(supabase, 'time_punch_events', 'id, org_id, employee_user_id, punched_at, is_void'),
    readOptionalTable(supabase, 'payments', 'id, org_id, created_at'),
    readOptionalTable(supabase, 'portal_requests', 'id, organization_id, created_at'),
    readOptionalTable(supabase, 'pilot_telemetry_events', 'id, organization_id, actor_user_id, event_name, module, feature, object_id, metadata, occurred_at'),
    readOptionalTable(supabase, 'blueprint_uploads', 'id, org_id, created_at'),
  ])

  const projects = (projectsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const estimates = (estimatesRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const employees = (employeesRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const timePunches = (timePunchesRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)) && row.is_void !== true)
  const payments = (paymentsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))
  const portalRequests = (portalRequestsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.organization_id)))
  const telemetry = (telemetryRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.organization_id)))
  const blueprintUploads = (blueprintUploadsRes.data ?? []).filter((row: any) => pilotOrgIds.includes(String(row.org_id)))

  const { start, end } = weekRange()
  const weekly = deriveWeeklyActivitySummary(
    telemetry.map((row: any) => ({
      organizationId: String(row.organization_id),
      userId: row.actor_user_id ? String(row.actor_user_id) : null,
      occurredAt: String(row.occurred_at),
      eventName: String(row.event_name),
    })),
    start.toISOString(),
    end.toISOString(),
  )

  const organizationsReport = includedOrganizations.map((org) => {
    const orgProjects = projects.filter((row: any) => String(row.org_id) === org.id)
    const orgEstimates = estimates.filter((row: any) => String(row.org_id) === org.id)
    const orgEmployees = employees.filter((row: any) => String(row.org_id) === org.id)
    const orgTimePunches = timePunches.filter((row: any) => String(row.org_id) === org.id)
    const orgTelemetry = telemetry.filter((row: any) => String(row.organization_id) === org.id)
    const orgBlueprintUploads = blueprintUploads.filter((row: any) => String(row.org_id) === org.id)
    const orgSupportIncidents = orgTelemetry.filter((row: any) => row.event_name === 'founder_support_incident')

    const activation = derivePilotActivationSnapshot({
      organizationCreatedAt: org.createdAt,
      firstProjectAt: orgProjects.map((row: any) => row.created_at).sort()[0] ?? null,
      firstEstimateAt: orgEstimates.map((row: any) => row.created_at).sort()[0] ?? null,
      firstBlueprintUploadAt: blueprintUploadsRes.available ? orgBlueprintUploads.map((row: any) => row.created_at).sort()[0] ?? null : null,
      firstEmployeeInviteAt: orgEmployees.map((row: any) => row.invited_at).filter(Boolean).sort()[0] ?? null,
      onboardingCompletedAt: orgTelemetry
        .filter((row: any) => row.event_name === 'onboarding_completed')
        .map((row: any) => row.occurred_at)
        .sort()[0] ?? null,
    })

    const blueprintOpenCount = orgTelemetry.filter((row: any) => row.event_name === 'blueprint_opened').length
    const measurementCount = orgTelemetry.filter((row: any) => row.event_name === 'blueprint_measurement_created').length
    const circuitPathCount = orgTelemetry.filter((row: any) => row.event_name === 'circuit_path_created').length
    const circuitArcCount = orgTelemetry.filter((row: any) => row.event_name === 'circuit_arc_created').length
    const workPackageCount = orgTelemetry.filter((row: any) => row.event_name === 'work_package_created').length
    const featureErrorCount = orgTelemetry.filter((row: any) => row.event_name === 'feature_error').length

    return {
      organizationId: org.id,
      organizationName: org.name,
      classification: org.classification,
      createdAt: org.createdAt,
      activated: activation.activated,
      activationAt: activation.activationAt,
      firstValueAt: activation.firstValueAt,
      minutesToFirstValue: activation.minutesToFirstValue,
      projectsCreated: orgProjects.length,
      estimatesCreated: orgEstimates.length,
      estimatesSent: orgEstimates.filter((row: any) => row.status === 'sent' || Boolean(row.sent_at)).length,
      employeesInvited: orgEmployees.filter((row: any) => row.invited_at).length,
      employeesActivated: orgEmployees.filter((row: any) => row.accepted_at).length,
      employeeActivationRate:
        orgEmployees.filter((row: any) => row.invited_at).length > 0
          ? Number((orgEmployees.filter((row: any) => row.accepted_at).length / orgEmployees.filter((row: any) => row.invited_at).length).toFixed(4))
          : null,
      employeePortalActive: isEmployeePortalActiveOrganization({
        acceptedEmployees: orgEmployees.filter((row: any) => row.accepted_at).length,
        timePunchCount: orgTimePunches.length,
      }),
      employeePortalActivityCount: orgTimePunches.length,
      blueprintUploads: blueprintUploadsRes.available ? orgBlueprintUploads.length : null,
      blueprintUploadsAvailable: blueprintUploadsRes.available,
      blueprintOpenCount,
      blueprintMeasurementCount: measurementCount,
      circuitPathCount,
      circuitArcCount,
      workPackageCount,
      blueprintActive: isBlueprintActiveOrganization({
        hasBlueprintOpen: blueprintOpenCount > 0 || (blueprintUploadsRes.available && orgBlueprintUploads.length > 0),
        measurementCount,
        circuitPathCount,
        circuitArcCount,
        workPackageCount,
      }),
      paymentsRecorded: payments.filter((row: any) => String(row.org_id) === org.id).length,
      portalRequests: portalRequests.filter((row: any) => String(row.organization_id) === org.id).length,
      featureErrorCount,
      founderSupportIncidentCount: orgSupportIncidents.length,
      founderSupportMinutes: orgSupportIncidents.reduce((sum: number, row: any) => sum + Number(row.metadata?.minutesSpent || 0), 0),
    }
  })

  const recentActivity = buildFounderPilotRecentActivity({
    telemetry,
    organizations: includedOrganizations.map((org) => ({
      organizationId: org.id,
      organizationName: org.name,
      classification: org.classification,
    })),
  })

  return json(200, {
    generatedAt: new Date().toISOString(),
    weekStart: start.toISOString(),
    weekEnd: end.toISOString(),
    summary: {
      totalPilotOrganizations: organizationsReport.length,
      activatedOrganizations: organizationsReport.filter((row) => row.activated).length,
      weeklyActiveOrganizations: weekly.weeklyActiveOrganizations,
      weeklyActiveUsers: weekly.weeklyActiveUsers,
      blueprintUploadsAvailable: blueprintUploadsRes.available,
    },
    allOrganizations: pilotOrganizations,
    organizations: organizationsReport,
    recentActivity,
  })
}

async function listAllAuthUsers(supabase: any): Promise<any[]> {
  const users: any[] = []
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < 1000) break
  }
  return users
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
}

function authDisplayName(user: any): string | null {
  const metadata = record(user?.user_metadata ?? user?.raw_user_meta_data)
  const fullName = String(metadata.full_name || metadata.name || '').trim()
  return fullName || null
}

async function listAuthUsersById(supabase: any, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, any>()
  const authUsers = await listAllAuthUsers(supabase)
  return new Map(
    authUsers
      .filter((user: any) => userIds.includes(String(user.id)))
      .map((user: any) => [String(user.id), user]),
  )
}

async function loadFounderContractorUserAccess(supabase: any, organizationId: string) {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, org_id, full_name, role, is_active, revoked_at, revoked_by, restored_at, restored_by')
    .eq('org_id', organizationId)

  if (error) throw error

  const profileRows = (profiles ?? []).filter((row: any) => String(row?.org_id || '').trim() === organizationId)
  const authById = await listAuthUsersById(
    supabase,
    uniqueNonEmptyStrings(profileRows.map((row: any) => row.id)),
  )

  const rolePriority: Record<string, number> = {
    owner: 0,
    admin: 1,
    manager: 2,
    field: 3,
    employee: 4,
    client: 5,
  }

  const userAccess: FounderContractorUserAccessRow[] = profileRows
    .map((profile: any) => {
      const authUser = authById.get(String(profile.id))
      const profileName = String(profile?.full_name || '').trim() || null
      return {
        userId: String(profile.id),
        name: profileName || authDisplayName(authUser),
        email: authUser?.email ? String(authUser.email) : null,
        role: profile?.role ? String(profile.role) : null,
        isActive: profile?.is_active !== false,
        revokedAt: profile?.revoked_at ? String(profile.revoked_at) : null,
        revokedBy: profile?.revoked_by ? String(profile.revoked_by) : null,
        restoredAt: profile?.restored_at ? String(profile.restored_at) : null,
        restoredBy: profile?.restored_by ? String(profile.restored_by) : null,
      }
    })
    .sort((left: FounderContractorUserAccessRow, right: FounderContractorUserAccessRow) => {
      if (left.isActive !== right.isActive) return left.isActive ? -1 : 1
      const leftRank = rolePriority[String(left.role || '').toLowerCase()] ?? 99
      const rightRank = rolePriority[String(right.role || '').toLowerCase()] ?? 99
      if (leftRank !== rightRank) return leftRank - rightRank
      return String(left.email || left.name || left.userId).localeCompare(String(right.email || right.name || right.userId))
    })

  let employeeOnlyIdentityCount = 0
  try {
    const { data: employeeProfiles, error: employeeProfilesError } = await supabase
      .from('employee_profiles')
      .select('user_id')
      .eq('org_id', organizationId)
      .not('user_id', 'is', null)

    if (!employeeProfilesError) {
      const canonicalIds = new Set(userAccess.map((row) => row.userId))
      employeeOnlyIdentityCount = uniqueNonEmptyStrings(
        (employeeProfiles ?? []).map((row: any) => row?.user_id ? String(row.user_id) : null),
      ).filter((userId) => !canonicalIds.has(userId)).length
    }
  } catch {
    employeeOnlyIdentityCount = 0
  }

  return {
    userAccess,
    employeeOnlyIdentityCount,
    employeeOnlyIdentityNotice: employeeOnlyIdentityCount > 0
      ? 'Employee-only identities without a canonical profile row are not governed by this access control.'
      : null,
  }
}

async function invalidateRevokedUserSessions(supabase: any, targetUserId: string) {
  const { data: activeSessions, error: activeSessionsError } = await supabase
    .from('user_sessions')
    .select('session_id')
    .eq('user_id', targetUserId)
    .not('session_id', 'is', null)
    .is('ended_at', null)

  if (activeSessionsError) throw activeSessionsError

  const sessionIds = uniqueNonEmptyStrings((activeSessions ?? []).map((row: any) => row?.session_id ? String(row.session_id) : null))
  if (sessionIds.length === 0) {
    return {
      activeSessionIds: [] as string[],
      redisFailedSessionIds: [] as string[],
      warning: null as string | null,
    }
  }

  const endedAt = new Date().toISOString()
  const { error: updateError } = await supabase
    .from('user_sessions')
    .update({ ended_at: endedAt, ended_reason: 'access_revoked' })
    .eq('user_id', targetUserId)
    .in('session_id', sessionIds)
    .is('ended_at', null)
    .not('session_id', 'is', null)

  const redis = getRedisClient()
  const redisFailedSessionIds: string[] = []
  if (redis) {
    for (const sessionId of sessionIds) {
      try {
        await redis.del(sessionRedisKey(sessionId))
      } catch {
        redisFailedSessionIds.push(sessionId)
      }
    }
  } else {
    redisFailedSessionIds.push(...sessionIds)
  }

  const warningParts: string[] = []
  if (updateError) {
    warningParts.push('Persistent session closeout could not update every matching row.')
  }
  if (redisFailedSessionIds.length > 0) {
    warningParts.push(`Redis cleanup missed ${redisFailedSessionIds.length} matching session${redisFailedSessionIds.length === 1 ? '' : 's'}.`)
  }

  return {
    activeSessionIds: sessionIds,
    redisFailedSessionIds,
    warning: warningParts.length > 0 ? warningParts.join(' ') : null,
  }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

export function buildFounderContractorAdminReport(input: {
  organizations: any[]
  profiles: any[]
  invites: any[]
  agreements: any[]
  authUsers: any[]
  overrides?: any[]
  employeeProfiles?: any[]
  activityEvents?: any[]
}, now = Date.now()) {
  const {
    organizations,
    profiles,
    invites,
    agreements,
    authUsers,
    overrides = [],
    employeeProfiles = [],
    activityEvents = [],
  } = input
  const authById = new Map(authUsers.map((entry: any) => [String(entry.id), entry]))
  const authByEmail = new Map(authUsers
    .filter((entry: any) => entry.email)
    .map((entry: any) => [String(entry.email).trim().toLowerCase(), entry]))
  const profileByUserId = new Map(profiles.map((entry: any) => [String(entry.id), entry]))
  const organizationById = new Map(organizations.map((entry: any) => [String(entry.id), entry]))
  const organizationByOwnerId = new Map(organizations
    .filter((entry: any) => entry.owner_id)
    .map((entry: any) => [String(entry.owner_id), entry]))
  const agreementsByUserId = new Map<string, NDASignedAgreementRecordLike[]>()
  for (const agreement of agreements) {
    const key = String(agreement.user_id || '')
    if (!agreementsByUserId.has(key)) agreementsByUserId.set(key, [])
    agreementsByUserId.get(key)!.push(agreement)
  }
  const overrideByUserId = new Map<string, NDAAccessOverrideRecordLike>(
    overrides
      .filter((entry: any) => entry?.user_id)
      .map((entry: any) => [String(entry.user_id), entry]),
  )
  const memberCountByOrg = new Map<string, number>()
  for (const profile of profiles) {
    const orgId = String(profile?.org_id || '').trim()
    if (!orgId) continue
    memberCountByOrg.set(orgId, (memberCountByOrg.get(orgId) ?? 0) + 1)
  }
  const employeeCountByOrg = new Map<string, number>()
  for (const employeeProfile of employeeProfiles) {
    const orgId = String(employeeProfile?.org_id || '').trim()
    if (!orgId) continue
    employeeCountByOrg.set(orgId, (employeeCountByOrg.get(orgId) ?? 0) + 1)
  }
  const lastActivityByOrg = new Map<string, string>()
  for (const event of activityEvents) {
    const orgId = String(event?.organization_id || '').trim()
    const occurredAt = String(event?.occurred_at || '').trim()
    if (!orgId || !occurredAt) continue
    const existing = lastActivityByOrg.get(orgId)
    if (!existing || new Date(occurredAt).getTime() > new Date(existing).getTime()) {
      lastActivityByOrg.set(orgId, occurredAt)
    }
  }

  function latestTimestamp(...values: Array<string | null | undefined>): string | null {
    let best: string | null = null
    let bestMillis = Number.NEGATIVE_INFINITY
    for (const value of values) {
      if (!value) continue
      const millis = new Date(value).getTime()
      if (Number.isNaN(millis) || millis <= bestMillis) continue
      best = value
      bestMillis = millis
    }
    return best
  }

  function getOwnerFullName(ownerProfile: any, owner: any): string | null {
    const profileName = String(ownerProfile?.full_name || '').trim()
    if (profileName) return profileName

    const metadata = record(owner?.user_metadata ?? owner?.raw_user_meta_data)
    const authName = String(metadata.full_name || metadata.name || '').trim()
    return authName || null
  }

  function describeNDAStatus(state: string): 'signed' | 'grandfathered' | 'missing' | 'revoked' {
    if (state === 'SIGNED_CURRENT' || state === 'SIGNED_LEGACY') return 'signed'
    if (state === 'GRANDFATHERED_LEGACY_ACCESS') return 'grandfathered'
    if (state === 'REVOKED') return 'revoked'
    return 'missing'
  }

  const contractorAccounts = organizations
    .filter((org: any) => org.owner_id)
    .map((org: any) => {
    const ownerId = String(org.owner_id || '')
    const orgId = String(org.id)
    const owner = authById.get(ownerId) as any
    const ownerProfile = profileByUserId.get(ownerId) as any
    const settings = record(org.settings)
    const onboarding = record(settings.onboarding)
    const resolved = resolveNDAStatus({
      agreements: agreementsByUserId.get(ownerId) ?? [],
      override: overrideByUserId.get(ownerId) ?? null,
      user: {
        userId: ownerId,
        role: ownerProfile?.role ?? 'owner',
        organizationId: String(org.id),
        organizationOwnerId: ownerId,
        authCreatedAt: owner?.created_at ?? null,
        lastSignInAt: owner?.last_sign_in_at ?? null,
        profileCreatedAt: ownerProfile?.created_at ?? null,
        organizationCreatedAt: org.created_at ?? null,
      },
    })
    return {
      organizationId: orgId,
      organizationName: String(org.name || ''),
      ownerFullName: getOwnerFullName(ownerProfile, owner),
      ownerEmail: String(owner?.email || ''),
      createdAt: org.created_at,
      onboardingStatus: onboarding.complete === true ? 'complete' : 'pending',
      agreementStatus: describeNDAStatus(resolved.state),
      ndaState: resolved.state,
      agreementVersion: resolved.agreement?.agreement_type || null,
      signedAt: resolved.signedAt,
      signer: resolved.signer || ownerProfile?.full_name || null,
      artifactAvailable: resolved.hasArtifact,
      classification: getPilotOrganizationClassification(settings),
      accountStatus: ownerProfile?.is_active === false ? 'inactive' : 'active',
      employeeCount: employeeCountByOrg.get(orgId) ?? 0,
      memberCount: memberCountByOrg.get(orgId) ?? 0,
      lastActivityAt: latestTimestamp(lastActivityByOrg.get(orgId), owner?.last_sign_in_at ?? null),
      lastLoginAt: owner?.last_sign_in_at ?? null,
      // Fleet metrics enriched by handleFounderContractorAdmin (session + module queries).
      lastActiveAt: null as string | null,
      activeDays30: 0,
      modulesUsed30: [] as string[],
      accessActiveCount: 0,
      accessRevokedCount: 0,
    }
  })

  const fleetOrgIds = contractorAccounts.map((account: { organizationId: string }) => account.organizationId)
  const accessByOrg = buildFleetAccessCountsFromProfiles(profiles, fleetOrgIds)
  for (const account of contractorAccounts) {
    const access = accessByOrg.get(account.organizationId) ?? { activeCount: 0, revokedCount: 0 }
    account.accessActiveCount = access.activeCount
    account.accessRevokedCount = access.revokedCount
  }

  const contractorBetaInvites = invites.map((invite: any) => {
    const acceptedUser = (invite.accepted_user_id
      ? authById.get(String(invite.accepted_user_id))
      : authByEmail.get(String(invite.email || '').trim().toLowerCase())) as any
    const linkedOrg = (invite.organization_id
      ? organizationById.get(String(invite.organization_id))
      : acceptedUser
        ? organizationByOwnerId.get(String(acceptedUser.id))
        : null) as any
    const status = invite.status === 'pending' && new Date(invite.expires_at).getTime() <= now
      ? 'expired'
      : invite.status
    return {
      id: String(invite.id),
      email: String(invite.email || ''),
      industry: invite.industry ? String(invite.industry) : null,
      status,
      invitedAt: invite.invited_at,
      acceptedAt: invite.accepted_at,
      expiresAt: invite.expires_at,
      organizationId: linkedOrg?.id ? String(linkedOrg.id) : null,
      organizationName: linkedOrg?.name ? String(linkedOrg.name) : null,
    }
  })

  const signedAgreements = contractorAccounts.map((account: any) => {
    const ownerId = String(account.organizationId ? (organizationById.get(account.organizationId)?.owner_id || '') : '')
    const owner = authById.get(ownerId) as any
    const profile = profileByUserId.get(ownerId) as any
    const org = organizationById.get(String(account.organizationId)) as any
    const resolved = resolveNDAStatus({
      agreements: agreementsByUserId.get(ownerId) ?? [],
      override: overrideByUserId.get(ownerId) ?? null,
      user: {
        userId: ownerId,
        role: profile?.role ?? 'owner',
        organizationId: org?.id ? String(org.id) : null,
        organizationOwnerId: ownerId,
        authCreatedAt: owner?.created_at ?? null,
        lastSignInAt: owner?.last_sign_in_at ?? null,
        profileCreatedAt: profile?.created_at ?? null,
        organizationCreatedAt: org?.created_at ?? null,
      },
    })
    const agreement = resolved.agreement as NDASignedAgreementRecordLike | null
    const status = resolved.state === 'SIGNED_CURRENT'
      ? 'current'
      : resolved.state === 'SIGNED_LEGACY'
        ? 'legacy'
        : resolved.state === 'GRANDFATHERED_LEGACY_ACCESS'
          ? 'grandfathered'
          : resolved.state === 'REVOKED'
            ? 'revoked'
            : 'unsigned'
    return {
      id: String(agreement?.id || `nda-access-${ownerId}`),
      signer: String(agreement?.typed_name || profile?.full_name || ''),
      email: String(agreement?.email || owner?.email || ''),
      organizationId: org?.id ? String(org.id) : null,
      organizationName: org?.name ? String(org.name) : null,
      version: agreement?.agreement_type ? String(agreement.agreement_type) : null,
      signedAt: resolved.signedAt,
      ndaState: resolved.state,
      status,
      pinVerified: agreement?.pin_verified === true,
      hasPdf: resolved.hasArtifact,
      artifactStatus: resolved.state === 'GRANDFATHERED_LEGACY_ACCESS'
        ? 'access_grandfathered_no_signed_document'
        : resolved.hasArtifact
          ? 'signed_document_on_file'
          : allowsNDAAccess(resolved.state)
            ? 'no_signed_pdf_captured'
            : 'no_document',
    }
  })

  return {
    contractorAccounts: contractorAccounts.sort((a: any, b: any) => String(b.createdAt).localeCompare(String(a.createdAt))),
    contractorBetaInvites: contractorBetaInvites.sort((a: any, b: any) => String(b.invitedAt).localeCompare(String(a.invitedAt))),
    signedAgreements: signedAgreements.sort((a: any, b: any) => String(b.signedAt).localeCompare(String(a.signedAt))),
  }
}

/** Founder-only cross-org contractor account, beta invite, and agreement report. */
async function handleFounderContractorAdmin(user: any) {
  const denied = requireFounder(user)
  if (denied) return denied

  const supabase = getServiceClient()
  const serverNow = new Date()
  const [
    organizationsResult,
    profilesResult,
    invitesResult,
    agreementsResult,
    overridesResult,
    employeeProfilesResult,
    activityEventsResult,
    authUsers,
  ] = await Promise.all([
    supabase.from('organizations').select('id, name, owner_id, settings, created_at'),
    supabase.from('profiles').select('id, org_id, full_name, role, is_active, created_at'),
    supabase.from('beta_invites').select('id, email, industry, status, invited_at, accepted_at, expires_at, accepted_user_id, organization_id'),
    supabase.from('signed_agreements').select('id, user_id, agreement_type, typed_name, full_name, email, signed_at, created_at, pdf_url, signature_image, signature_data, ip_address, version, org_id'),
    readOptionalTable(supabase, 'nda_access_authority', 'user_id, access_state, source_classification, reason, effective_at, created_at'),
    readOptionalTable(supabase, 'employee_profiles', 'id, org_id, user_id, active, accepted_at, created_at'),
    readOptionalTable(supabase, 'pilot_telemetry_events', 'organization_id, occurred_at'),
    listAllAuthUsers(supabase),
  ])

  for (const result of [organizationsResult, profilesResult, invitesResult, agreementsResult]) {
    if (result.error) return json(500, { error: result.error.message || 'Founder contractor report query failed.' })
  }

  const report = buildFounderContractorAdminReport({
    organizations: organizationsResult.data ?? [],
    profiles: profilesResult.data ?? [],
    invites: invitesResult.data ?? [],
    agreements: agreementsResult.data ?? [],
    overrides: overridesResult.available ? (overridesResult.data ?? []) : [],
    employeeProfiles: employeeProfilesResult.available ? (employeeProfilesResult.data ?? []) : [],
    activityEvents: activityEventsResult.available ? (activityEventsResult.data ?? []) : [],
    authUsers,
  })

  const kpiOrganizations = report.contractorAccounts.map((account: any) => ({
    organizationId: String(account.organizationId),
    createdAt: account.createdAt ? String(account.createdAt) : null,
    classification: String(account.classification || 'unknown'),
    onboardingStatus: account.onboardingStatus === 'complete' ? 'complete' as const : 'pending' as const,
    accountStatus: account.accountStatus === 'inactive' ? 'inactive' as const : 'active' as const,
  }))

  const fleetOrgIds = kpiOrganizations.map((org: { organizationId: string }) => org.organizationId)
  const adoptionEligibleOrgIds = kpiOrganizations
    .filter((org: { classification: string }) => !isExcludedFromAdoptionKpis(org.classification))
    .map((org: { organizationId: string }) => org.organizationId)

  const lookbackIso = isoDaysAgo(30, serverNow)
  const activityLookbackIso = isoDaysAgo(90, serverNow)
  const [activitySessions, moduleEvents, revokedUsers] = await Promise.all([
    loadFounderActivitySessions(supabase, {
      organizationIds: fleetOrgIds,
      startedAfterIso: activityLookbackIso,
      limit: 3000,
    }),
    loadFounderModuleEnteredEvents(supabase, {
      organizationIds: fleetOrgIds,
      occurredAfterIso: lookbackIso,
      limit: 3000,
    }),
    countRevokedCanonicalProfiles(supabase, adoptionEligibleOrgIds),
  ])

  const accessByOrg = buildFleetAccessCountsFromProfiles(
    profilesResult.data ?? [],
    fleetOrgIds,
  )
  const fleetMetrics = buildFounderFleetOrgMetrics({
    organizationIds: fleetOrgIds,
    activitySessions,
    moduleEvents,
    accessByOrg,
    now: serverNow,
  })

  const contractorAccounts = report.contractorAccounts.map((account: any) => {
    const metrics = fleetMetrics.get(String(account.organizationId))
    return {
      ...account,
      lastActiveAt: metrics?.lastActiveAt ?? null,
      activeDays30: metrics?.activeDays30 ?? 0,
      modulesUsed30: metrics?.modulesUsed30 ?? [],
      accessActiveCount: metrics?.accessActiveCount ?? account.accessActiveCount ?? 0,
      accessRevokedCount: metrics?.accessRevokedCount ?? account.accessRevokedCount ?? 0,
    }
  })

  const adoption = buildFounderAdoptionKpis({
    organizations: kpiOrganizations,
    activitySessions,
    now: serverNow,
  })
  const onboarding = buildFounderOnboardingKpis({
    organizations: kpiOrganizations,
    invites: report.contractorBetaInvites.map((invite: any) => ({
      id: String(invite.id),
      email: String(invite.email || ''),
      status: String(invite.status || ''),
      invitedAt: invite.invitedAt ? String(invite.invitedAt) : null,
    })),
  })

  return json(200, {
    generatedAt: serverNow.toISOString(),
    ...report,
    contractorAccounts,
    kpis: {
      adoption,
      onboarding,
      security: buildFounderSecurityKpiCounts({
        newDevices30d: 0,
        ipChanges30d: 0,
        revokedUsers,
      }),
    },
  })
}

async function handleFounderContractorPresence(user: any) {
  const denied = requireFounder(user)
  if (denied) return denied

  const supabase = getServiceClient()
  const organizations = await loadFounderContractorOrganizations(supabase)
  const organizationIds = organizations.map((organization: { organizationId: string }) => organization.organizationId)
  const organizationNames = Object.fromEntries(
    organizations.map((organization: { organizationId: string; organizationName: string }) => [organization.organizationId, organization.organizationName]),
  ) as Record<string, string>
  const serverNow = new Date().toISOString()
  const lookbackIso = isoDaysAgo(FOUNDER_PRESENCE_LOOKBACK_DAYS, new Date(serverNow))

  const [sessionsRaw, eventsRaw, newDevices30d, ipChanges30d] = await Promise.all([
    loadPresenceSessions(supabase, {
      organizationIds,
      limit: FOUNDER_PRESENCE_SUMMARY_SESSION_LIMIT,
      startedAfterIso: lookbackIso,
    }),
    loadSecurityEvents(supabase, {
      organizationIds,
      limit: FOUNDER_SECURITY_HISTORY_LIMIT,
      occurredAfterIso: lookbackIso,
    }),
    countSecurityEvents(supabase, {
      organizationIds,
      eventType: 'session_started',
      occurredAfterIso: lookbackIso,
      isNewDevice: true,
    }),
    countSecurityEvents(supabase, {
      organizationIds,
      eventType: 'ip_changed',
      occurredAfterIso: lookbackIso,
    }),
  ])

  const hydrated = await attachUserIdentityToPresenceData(supabase, sessionsRaw, eventsRaw)
  const sessions = hydrated.sessions
  const events = hydrated.events

  const summaries = Object.values(
    buildFounderPresenceSummary(sessions, organizationIds, serverNow),
  )
    .sort((left, right) => organizationNames[left.organizationId].localeCompare(organizationNames[right.organizationId]))

  const alerts = buildFounderSecurityAlerts(events, organizationNames).slice(0, FOUNDER_SECURITY_ALERT_LIMIT)
  const securityHistory = buildFounderGlobalSecurityHistory(events, organizationNames)
    .slice(0, FOUNDER_SECURITY_HISTORY_LIMIT)

  return json(200, {
    serverNow,
    summaries,
    alerts,
    securityHistory,
    kpis: {
      liveNow: buildFounderLiveNowKpis(sessions, serverNow),
      security: buildFounderSecurityKpiCounts({
        newDevices30d,
        ipChanges30d,
        revokedUsers: 0,
      }),
    },
  })
}

async function handleFounderContractorPresenceDetail(event: NetlifyEvent, user: any) {
  const denied = requireFounder(user)
  if (denied) return denied

  const payload = event.body ? JSON.parse(event.body) : {}
  const organizationId = String(payload?.organizationId || '').trim()
  if (!organizationId) return json(400, { error: 'organizationId is required.' })

  const supabase = getServiceClient()
  const organizations = await loadFounderContractorOrganizations(supabase)
  const organization = organizations.find((entry: { organizationId: string }) => entry.organizationId === organizationId)
  if (!organization) return json(404, { error: 'Contractor organization not found.' })

  const serverNow = new Date().toISOString()
  const lookbackIso = isoDaysAgo(FOUNDER_PRESENCE_LOOKBACK_DAYS, new Date(serverNow))

  const [sessionsRaw, eventsRaw] = await Promise.all([
    loadPresenceSessions(supabase, {
      organizationIds: [organizationId],
      limit: FOUNDER_PRESENCE_DETAIL_SESSION_LIMIT,
      startedAfterIso: lookbackIso,
    }),
    loadSecurityEvents(supabase, {
      organizationIds: [organizationId],
      limit: FOUNDER_PRESENCE_DETAIL_EVENT_LIMIT,
    }),
  ])

  const hydrated = await attachUserIdentityToPresenceData(supabase, sessionsRaw, eventsRaw)
  const detail = buildFounderPresenceDetail({
    sessions: hydrated.sessions,
    serverNow,
  })
  const securityHistory = buildFounderSecurityHistory(hydrated.events)
  const accessData = await loadFounderContractorUserAccess(supabase, organizationId)

  return json(200, {
    organizationId,
    organizationName: organization.organizationName,
    serverNow,
    summary: detail.summary,
    deviceGroups: detail.deviceGroups,
    sessions: detail.sessions,
    securityHistory,
    userAccess: accessData.userAccess,
    employeeOnlyIdentityCount: accessData.employeeOnlyIdentityCount,
    employeeOnlyIdentityNotice: accessData.employeeOnlyIdentityNotice,
  })
}

async function handleFounderRevokeUserAccess(event: NetlifyEvent, user: any) {
  const denied = requireFounder(user)
  if (denied) return denied

  const payload = event.body ? JSON.parse(event.body) : {}
  const targetUserId = String(payload?.targetUserId || '').trim()
  const targetOrgId = String(payload?.targetOrgId || '').trim()
  if (!targetUserId || !targetOrgId) {
    return json(400, { error: 'targetUserId and targetOrgId are required.' })
  }

  const supabase = getServiceClient()
  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, owner_id')
    .eq('id', targetOrgId)
    .maybeSingle()
  if (organizationError) return json(500, { error: organizationError.message || 'Could not verify contractor organization.' })
  if (!organization?.id || !organization?.owner_id) {
    return json(404, { error: 'Contractor organization not found.' })
  }

  const { data: targetProfile, error: targetProfileError } = await supabase
    .from('profiles')
    .select('id, org_id')
    .eq('id', targetUserId)
    .maybeSingle()
  if (targetProfileError) return json(500, { error: targetProfileError.message || 'Could not verify target user.' })
  if (!targetProfile?.id) {
    return json(404, { error: 'Canonical profile-backed user not found.' })
  }
  if (String(targetProfile.org_id || '').trim() !== targetOrgId) {
    return json(403, { error: 'Target user does not belong to the selected contractor organization.' })
  }

  const revokedAt = new Date().toISOString()
  const { data: revokedProfile, error: revokeError } = await supabase
    .from('profiles')
    .update({
      is_active: false,
      revoked_by: user.id,
      revoked_at: revokedAt,
    })
    .eq('id', targetUserId)
    .eq('org_id', targetOrgId)
    .select('id')
    .maybeSingle()
  if (revokeError) return json(500, { error: revokeError.message || 'Could not revoke user access.' })
  if (!revokedProfile?.id) {
    return json(404, { error: 'Target user does not belong to the selected contractor organization.' })
  }

  const cleanup = await invalidateRevokedUserSessions(supabase, targetUserId)

  return json(200, {
    ok: true,
    targetUserId,
    targetOrgId,
    revokedAt,
    invalidatedSessionCount: cleanup.activeSessionIds.length,
    cleanupWarning: cleanup.warning,
  })
}

async function handleFounderRestoreUserAccess(event: NetlifyEvent, user: any) {
  const denied = requireFounder(user)
  if (denied) return denied

  const payload = event.body ? JSON.parse(event.body) : {}
  const targetUserId = String(payload?.targetUserId || '').trim()
  const targetOrgId = String(payload?.targetOrgId || '').trim()
  if (!targetUserId || !targetOrgId) {
    return json(400, { error: 'targetUserId and targetOrgId are required.' })
  }

  const supabase = getServiceClient()
  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, owner_id')
    .eq('id', targetOrgId)
    .maybeSingle()
  if (organizationError) return json(500, { error: organizationError.message || 'Could not verify contractor organization.' })
  if (!organization?.id || !organization?.owner_id) {
    return json(404, { error: 'Contractor organization not found.' })
  }

  const { data: targetProfile, error: targetProfileError } = await supabase
    .from('profiles')
    .select('id, org_id')
    .eq('id', targetUserId)
    .maybeSingle()
  if (targetProfileError) return json(500, { error: targetProfileError.message || 'Could not verify target user.' })
  if (!targetProfile?.id) {
    return json(404, { error: 'Canonical profile-backed user not found.' })
  }
  if (String(targetProfile.org_id || '').trim() !== targetOrgId) {
    return json(403, { error: 'Target user does not belong to the selected contractor organization.' })
  }

  const restoredAt = new Date().toISOString()
  const { data: restoredProfile, error: restoreError } = await supabase
    .from('profiles')
    .update({
      is_active: true,
      restored_by: user.id,
      restored_at: restoredAt,
    })
    .eq('id', targetUserId)
    .eq('org_id', targetOrgId)
    .select('id')
    .maybeSingle()
  if (restoreError) return json(500, { error: restoreError.message || 'Could not restore user access.' })
  if (!restoredProfile?.id) {
    return json(404, { error: 'Target user does not belong to the selected contractor organization.' })
  }

  return json(200, {
    ok: true,
    targetUserId,
    targetOrgId,
    restoredAt,
  })
}

async function handleFounderAgreementArtifact(event: NetlifyEvent, user: any) {
  const denied = requireFounder(user)
  if (denied) return denied

  const payload = event.body ? JSON.parse(event.body) : {}
  const agreementId = String(payload?.agreementId || '').trim()
  if (!agreementId) return json(400, { error: 'agreementId is required.' })

  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('signed_agreements')
    .select('id, agreement_type, typed_name, full_name, signed_at, created_at, pdf_url')
    .eq('id', agreementId)
    .maybeSingle()

  if (error) return json(500, { error: error.message || 'Agreement artifact lookup failed.' })
  if (!data?.id) return json(404, { error: 'Agreement artifact not found.' })
  if (!hasRealNDAArtifact(data.pdf_url)) {
    return json(404, { error: 'No signed artifact is available for this agreement.' })
  }

  const { data: signedArtifact, error: signedArtifactError } = await supabase.storage
    .from('nda-documents')
    .createSignedUrl(String(data.pdf_url).trim(), 300)

  if (signedArtifactError || !signedArtifact?.signedUrl) {
    return json(500, { error: signedArtifactError?.message || 'Agreement artifact URL could not be generated.' })
  }

  return json(200, {
    url: signedArtifact.signedUrl,
    filename: deriveAgreementArtifactFilename(data),
  })
}

async function handleFounderRevokeBetaInvite(event: NetlifyEvent, user: any) {
  const denied = requireFounder(user)
  if (denied) return denied
  const payload = event.body ? JSON.parse(event.body) : {}
  const inviteId = String(payload?.inviteId || '').trim()
  if (!inviteId) return json(400, { error: 'inviteId is required.' })

  const supabase = getServiceClient()
  // Atomic conditional update — only succeeds when the row is still effectively pending:
  // status = 'pending' AND expires_at is in the future.
  // Expired, accepted, and revoked rows are all excluded server-side.
  const { data, error } = await supabase
    .from('beta_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle()
  if (error) return json(500, { error: error.message || 'Could not revoke beta invite.' })
  if (!data?.id) return json(400, { error: 'invite_not_revokable' })
  return json(200, { ok: true, inviteId })
}

async function handleFounderDeleteBetaInvite(event: NetlifyEvent, user: any) {
  const denied = requireFounder(user)
  if (denied) return denied
  const payload = event.body ? JSON.parse(event.body) : {}
  const inviteId = String(payload?.inviteId || '').trim()
  if (!inviteId) return json(400, { error: 'inviteId is required.' })

  const supabase = getServiceClient()
  const { data: invite, error: loadError } = await supabase
    .from('beta_invites')
    .select('id, status')
    .eq('id', inviteId)
    .maybeSingle()
  if (loadError) return json(500, { error: loadError.message || 'Could not load beta invite.' })
  if (!invite?.id) return json(404, { error: 'Beta invite not found.' })
  if (invite.status === 'accepted') return json(400, { error: 'invite_not_deletable' })

  const { data: deleted, error: deleteError } = await supabase
    .from('beta_invites')
    .delete()
    .eq('id', inviteId)
    .neq('status', 'accepted')
    .select('id')
    .maybeSingle()
  if (deleteError) return json(500, { error: deleteError.message || 'Could not delete beta invite.' })
  if (!deleted?.id) return json(400, { error: 'invite_not_deletable' })
  return json(200, { ok: true, inviteId })
}

export async function handler(event: NetlifyEvent) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: '' }
  }

  const user = await verifyAuthenticatedUser(event)
  if (!user) return json(401, { error: 'Authentication required.' })

  const action = event.httpMethod === 'GET'
    ? String(event.queryStringParameters?.action || '').trim()
    : String((event.body ? JSON.parse(event.body).action : '') || '').trim()

  try {
    if (action === 'track_event') return await handleTrackEvent(event, user)
    if (action === 'log_support_incident') return await handleSupportIncident(event, user)
    if (action === 'founder_report') return await handleFounderReport(user)
    if (action === 'founder_contractor_admin') return await handleFounderContractorAdmin(user)
    if (action === 'founder_contractor_presence') return await handleFounderContractorPresence(user)
    if (action === 'founder_contractor_presence_detail') return await handleFounderContractorPresenceDetail(event, user)
    if (action === 'founder_revoke_user_access') return await handleFounderRevokeUserAccess(event, user)
    if (action === 'founder_restore_user_access') return await handleFounderRestoreUserAccess(event, user)
    if (action === 'founder_agreement_artifact') return await handleFounderAgreementArtifact(event, user)
    if (action === 'founder_revoke_beta_invite') return await handleFounderRevokeBetaInvite(event, user)
    if (action === 'founder_delete_beta_invite') return await handleFounderDeleteBetaInvite(event, user)
    if (action === 'set_org_classification') return await handleSetOrgClassification(event, user)
    return json(400, { error: 'Unknown action.' })
  } catch (error: any) {
    return json(500, { error: error?.message || 'Pilot telemetry request failed.' })
  }
}
