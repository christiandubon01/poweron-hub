/**
 * GUARDIAN-3B6 — Contractor fleet view helpers.
 *
 * Pure, deterministic builders shared by the founder admin report shaping
 * and the Contractor Accounts fleet table. KPI strip definitions live in
 * guardianFounderKpis; this module reuses those authorities for row metrics
 * and filters so fleet counts stay consistent with the strip.
 */

import {
  collectActiveOrganizationIds,
  isExcludedFromAdoptionKpis,
  sessionHasQualifyingActivity,
  type FounderKpiOrganizationInput,
  type FounderKpiSessionActivityRow,
} from '@/services/guardianFounderKpis'
import {
  filterUnreadGuardianSecurityAlerts,
  getFounderModuleLabel,
  type FounderPresenceStatus,
  type FounderSecurityAlert,
} from '@/services/guardianFounderPresence'
import {
  CANONICAL_PRODUCT_MODULES,
  type CanonicalProductModule,
} from '@/services/pilotTelemetryShared'

export const FOUNDER_FLEET_FILTERS = [
  'all',
  'active_now',
  'active_7d',
  'dormant',
  'pending_setup',
  'security_alert',
  'revoked',
] as const

export type FounderFleetFilter = (typeof FOUNDER_FLEET_FILTERS)[number]

export const FOUNDER_FLEET_COLUMN_LABELS = [
  'COMPANY',
  'OWNER',
  'PRESENCE',
  'LAST ACTIVE',
  '30D ACTIVE DAYS',
  'MODULES USED',
  'ONBOARDING',
  'CLASSIFICATION',
  'SECURITY',
  'ACCESS',
] as const

/** Fleet presence display — never invents Revoked / Dormant / Pending. */
export type FounderFleetPresenceStatus = 'active' | 'idle' | 'locked' | 'offline'

export type FounderFleetAccessSummary =
  | { kind: 'active'; label: 'Active'; activeCount: number; revokedCount: number }
  | { kind: 'revoked'; label: 'Revoked'; activeCount: number; revokedCount: number }
  | { kind: 'mixed'; label: string; activeCount: number; revokedCount: number }
  | { kind: 'none'; label: 'No profiles'; activeCount: 0; revokedCount: 0 }

export interface FounderFleetModuleEventRow {
  organization_id: string
  event_name: string
  module: string | null
  occurred_at?: string | null
}

export interface FounderFleetAccessCounts {
  activeCount: number
  revokedCount: number
}

export interface FounderFleetOrgMetrics {
  lastActiveAt: string | null
  activeDays30: number
  modulesUsed30: string[]
  accessActiveCount: number
  accessRevokedCount: number
}

export interface FounderFleetAccountLike {
  organizationId: string
  organizationName: string
  ownerFullName: string | null
  ownerEmail: string
  createdAt: string
  onboardingStatus: 'complete' | 'pending'
  classification: string
  accountStatus: 'active' | 'inactive'
  lastActiveAt?: string | null
  activeDays30?: number
  modulesUsed30?: string[]
  accessActiveCount?: number
  accessRevokedCount?: number
}

export interface FounderFleetPresenceLike {
  organizationId: string
  status: FounderPresenceStatus
  hasHistory?: boolean
  liveDeviceCount?: number
  liveSessionCount?: number
}

export interface FounderFleetRow {
  organizationId: string
  organizationName: string
  ownerFullName: string | null
  ownerEmail: string
  presence: FounderFleetPresenceStatus
  lastActiveAt: string | null
  lastActiveLabel: string
  activeDays30: number
  modulesUsed30: string[]
  modulesUsedLabel: string
  onboardingStatus: 'complete' | 'pending'
  classification: string
  unreadSecurityAlertCount: number
  securityLabel: string
  access: FounderFleetAccessSummary
  classificationExcludedFromAdoption: boolean
}

const FLEET_PRESENCE_PRIORITY: Record<FounderFleetPresenceStatus, number> = {
  active: 4,
  idle: 3,
  locked: 2,
  offline: 1,
}

const CANONICAL_MODULE_SET = new Set<string>(CANONICAL_PRODUCT_MODULES)

function toMillis(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const millis = Date.parse(value)
  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis
}

function utcDayKey(iso: string): string | null {
  const millis = Date.parse(iso)
  if (Number.isNaN(millis)) return null
  return new Date(millis).toISOString().slice(0, 10)
}

/**
 * Organization presence priority for multi-session orgs.
 * Preferred: Active > Idle > Locked > Offline
 */
export function pickOrganizationPresenceStatus(
  statuses: FounderPresenceStatus[],
): FounderFleetPresenceStatus {
  let best: FounderFleetPresenceStatus = 'offline'
  for (const status of statuses) {
    const normalized = normalizeFleetPresenceStatus(status)
    if (FLEET_PRESENCE_PRIORITY[normalized] > FLEET_PRESENCE_PRIORITY[best]) {
      best = normalized
    }
  }
  return best
}

export function normalizeFleetPresenceStatus(
  status: FounderPresenceStatus | null | undefined,
): FounderFleetPresenceStatus {
  if (status === 'active' || status === 'idle' || status === 'locked') return status
  return 'offline'
}

export function formatFleetPresenceLabel(status: FounderFleetPresenceStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * Last meaningful activity authority — same qualifying activity as 3B5 KPIs.
 * Uses started_at / last_interaction_at only. Heartbeat (last_active_at) alone
 * cannot fabricate recent activity.
 */
export function resolveOrgLastActiveAt(
  sessions: FounderKpiSessionActivityRow[],
  organizationId: string,
): string | null {
  let best: string | null = null
  let bestMs = Number.NEGATIVE_INFINITY
  for (const session of sessions) {
    if (String(session.org_id || '').trim() !== organizationId) continue
    if (!session.session_id) continue
    for (const candidate of [session.started_at, session.last_interaction_at]) {
      const ms = toMillis(candidate)
      if (!Number.isFinite(ms) || ms <= bestMs) continue
      best = candidate ?? null
      bestMs = ms
    }
  }
  return best
}

export function formatFleetLastActiveLabel(
  lastActiveAt: string | null | undefined,
  now: string | Date = new Date(),
): string {
  if (!lastActiveAt) return 'No activity'
  const thenMs = toMillis(lastActiveAt)
  if (!Number.isFinite(thenMs)) return 'No activity'

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now)
  if (!Number.isFinite(nowMs)) return 'No activity'

  const deltaMs = Math.max(0, nowMs - thenMs)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (deltaMs < minuteMs) return 'Now'
  if (deltaMs < hourMs) return `${Math.floor(deltaMs / minuteMs)}m ago`
  if (deltaMs < dayMs) return `${Math.floor(deltaMs / hourMs)}h ago`

  const thenDay = utcDayKey(lastActiveAt)
  const yesterdayDay = utcDayKey(new Date(nowMs - dayMs).toISOString())
  if (thenDay && yesterdayDay && thenDay === yesterdayDay) return 'Yesterday'

  const date = new Date(thenMs)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * Distinct UTC calendar days in the trailing window with qualifying activity.
 * A day counts at most once per organization.
 */
export function collectActiveDaysByOrganization(
  sessions: FounderKpiSessionActivityRow[],
  windowStartIso: string,
  eligibleOrganizationIds?: Set<string> | string[],
): Map<string, number> {
  const eligible = eligibleOrganizationIds == null
    ? null
    : eligibleOrganizationIds instanceof Set
      ? eligibleOrganizationIds
      : new Set(eligibleOrganizationIds)
  const windowStartMs = toMillis(windowStartIso)
  const daysByOrg = new Map<string, Set<string>>()

  for (const session of sessions) {
    const orgId = String(session.org_id || '').trim()
    if (!orgId) continue
    if (eligible && !eligible.has(orgId)) continue
    if (!session.session_id) continue

    const daySet = daysByOrg.get(orgId) ?? new Set<string>()
    for (const candidate of [session.started_at, session.last_interaction_at]) {
      const ms = toMillis(candidate)
      if (!Number.isFinite(ms) || ms < windowStartMs) continue
      const day = utcDayKey(candidate!)
      if (day) daySet.add(day)
    }
    if (daySet.size > 0) daysByOrg.set(orgId, daySet)
  }

  const counts = new Map<string, number>()
  for (const [orgId, days] of daysByOrg.entries()) {
    counts.set(orgId, days.size)
  }
  return counts
}

export function countOrgActiveDays30(
  sessions: FounderKpiSessionActivityRow[],
  organizationId: string,
  windowStartIso: string,
): number {
  return collectActiveDaysByOrganization(sessions, windowStartIso, [organizationId])
    .get(organizationId) ?? 0
}

/**
 * Distinct normalized module_entered modules in the trailing window.
 * engagement_window and unknown modules do not count.
 */
export function collectModulesUsedByOrganization(
  events: FounderFleetModuleEventRow[],
): Map<string, string[]> {
  const byOrg = new Map<string, Set<string>>()
  for (const event of events) {
    if (String(event.event_name || '').trim() !== 'module_entered') continue
    const orgId = String(event.organization_id || '').trim()
    const module = String(event.module || '').trim().toLowerCase()
    if (!orgId || !module || !CANONICAL_MODULE_SET.has(module)) continue
    const set = byOrg.get(orgId) ?? new Set<string>()
    set.add(module)
    byOrg.set(orgId, set)
  }

  const ordered = new Map<string, string[]>()
  for (const [orgId, modules] of byOrg.entries()) {
    ordered.set(
      orgId,
      CANONICAL_PRODUCT_MODULES.filter((module) => modules.has(module)),
    )
  }
  return ordered
}

export function formatModulesUsedLabel(modules: string[] | null | undefined): string {
  const list = (modules ?? []).filter(Boolean)
  if (list.length === 0) return 'No module data'
  if (list.length <= 3) {
    return list.map((module) => getFounderModuleLabel(module as CanonicalProductModule)).join(' · ')
  }
  const head = list
    .slice(0, 3)
    .map((module) => getFounderModuleLabel(module as CanonicalProductModule))
    .join(' · ')
  return `${head} +${list.length - 3}`
}

export function summarizeOrgAccess(
  activeCount: number,
  revokedCount: number,
): FounderFleetAccessSummary {
  const active = Math.max(0, Math.floor(activeCount) || 0)
  const revoked = Math.max(0, Math.floor(revokedCount) || 0)

  if (active === 0 && revoked === 0) {
    return { kind: 'none', label: 'No profiles', activeCount: 0, revokedCount: 0 }
  }
  if (revoked === 0) {
    return { kind: 'active', label: 'Active', activeCount: active, revokedCount: 0 }
  }
  if (active === 0) {
    return { kind: 'revoked', label: 'Revoked', activeCount: 0, revokedCount: revoked }
  }
  return {
    kind: 'mixed',
    label: `${active} Active · ${revoked} Revoked`,
    activeCount: active,
    revokedCount: revoked,
  }
}

export function formatSecurityAlertLabel(unreadCount: number): string {
  const count = Math.max(0, Math.floor(unreadCount) || 0)
  if (count === 0) return 'Clear'
  if (count === 1) return '1 Alert'
  return `${count} Alerts`
}

export function countUnreadAlertsByOrganization(
  alerts: FounderSecurityAlert[],
  lastSeenAt: string | null,
): Map<string, number> {
  const unread = filterUnreadGuardianSecurityAlerts(alerts, lastSeenAt)
  const counts = new Map<string, number>()
  for (const alert of unread) {
    const orgId = String(alert.organizationId || '').trim()
    if (!orgId) continue
    counts.set(orgId, (counts.get(orgId) ?? 0) + 1)
  }
  return counts
}

export function buildFounderFleetOrgMetrics(input: {
  organizationIds: string[]
  activitySessions: FounderKpiSessionActivityRow[]
  moduleEvents: FounderFleetModuleEventRow[]
  accessByOrg: Map<string, FounderFleetAccessCounts> | Record<string, FounderFleetAccessCounts>
  now?: string | Date
}): Map<string, FounderFleetOrgMetrics> {
  const nowDate = input.now instanceof Date
    ? input.now
    : input.now
      ? new Date(input.now)
      : new Date()
  const window30 = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const activeDays = collectActiveDaysByOrganization(input.activitySessions, window30)
  const modulesByOrg = collectModulesUsedByOrganization(input.moduleEvents)
  const accessMap = input.accessByOrg instanceof Map
    ? input.accessByOrg
    : new Map(Object.entries(input.accessByOrg))

  const metrics = new Map<string, FounderFleetOrgMetrics>()
  for (const organizationId of input.organizationIds) {
    const access = accessMap.get(organizationId) ?? { activeCount: 0, revokedCount: 0 }
    metrics.set(organizationId, {
      lastActiveAt: resolveOrgLastActiveAt(input.activitySessions, organizationId),
      activeDays30: activeDays.get(organizationId) ?? 0,
      modulesUsed30: modulesByOrg.get(organizationId) ?? [],
      accessActiveCount: access.activeCount,
      accessRevokedCount: access.revokedCount,
    })
  }
  return metrics
}

export function buildFleetAccessCountsFromProfiles(
  profiles: Array<{ org_id?: string | null; is_active?: boolean | null }>,
  organizationIds: string[],
): Map<string, FounderFleetAccessCounts> {
  const counts = new Map<string, FounderFleetAccessCounts>()
  for (const organizationId of organizationIds) {
    counts.set(organizationId, { activeCount: 0, revokedCount: 0 })
  }
  for (const profile of profiles) {
    const orgId = String(profile.org_id || '').trim()
    if (!orgId || !counts.has(orgId)) continue
    const entry = counts.get(orgId)!
    if (profile.is_active === false) entry.revokedCount += 1
    else entry.activeCount += 1
  }
  return counts
}

export function buildFounderFleetRows(input: {
  accounts: FounderFleetAccountLike[]
  presenceByOrg: Map<string, FounderFleetPresenceLike> | Record<string, FounderFleetPresenceLike>
  unreadAlertsByOrg: Map<string, number> | Record<string, number>
  now?: string | Date
}): FounderFleetRow[] {
  const presenceMap = input.presenceByOrg instanceof Map
    ? input.presenceByOrg
    : new Map(Object.entries(input.presenceByOrg))
  const alertMap = input.unreadAlertsByOrg instanceof Map
    ? input.unreadAlertsByOrg
    : new Map(Object.entries(input.unreadAlertsByOrg).map(([key, value]) => [key, Number(value)]))

  return input.accounts.map((account) => {
    const presence = normalizeFleetPresenceStatus(presenceMap.get(account.organizationId)?.status)
    const unreadSecurityAlertCount = alertMap.get(account.organizationId) ?? 0
    const modulesUsed30 = account.modulesUsed30 ?? []
    const access = summarizeOrgAccess(
      account.accessActiveCount ?? (account.accountStatus === 'active' ? 1 : 0),
      account.accessRevokedCount ?? (account.accountStatus === 'inactive' ? 1 : 0),
    )
    return {
      organizationId: account.organizationId,
      organizationName: account.organizationName,
      ownerFullName: account.ownerFullName,
      ownerEmail: account.ownerEmail,
      presence,
      lastActiveAt: account.lastActiveAt ?? null,
      lastActiveLabel: formatFleetLastActiveLabel(account.lastActiveAt ?? null, input.now),
      activeDays30: Math.max(0, Math.floor(account.activeDays30 ?? 0) || 0),
      modulesUsed30,
      modulesUsedLabel: formatModulesUsedLabel(modulesUsed30),
      onboardingStatus: account.onboardingStatus,
      classification: account.classification,
      unreadSecurityAlertCount,
      securityLabel: formatSecurityAlertLabel(unreadSecurityAlertCount),
      access,
      classificationExcludedFromAdoption: isExcludedFromAdoptionKpis(account.classification),
    }
  })
}

function toKpiOrgInput(row: FounderFleetRow | FounderFleetAccountLike): FounderKpiOrganizationInput {
  return {
    organizationId: row.organizationId,
    createdAt: 'createdAt' in row ? (row.createdAt ?? null) : null,
    classification: row.classification,
    onboardingStatus: row.onboardingStatus,
    accountStatus: 'access' in row
      ? (row.access.revokedCount > 0 && row.access.activeCount === 0 ? 'inactive' : 'active')
      : (row.accountStatus ?? 'active'),
  }
}

/**
 * Fleet filters — definitions must match 3B5 KPI authorities where noted.
 */
export function organizationMatchesFleetFilter(
  row: FounderFleetRow,
  filter: FounderFleetFilter,
  context: {
    activeOrgIds7d: Set<string>
    dormantOrgIds: Set<string>
  },
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active_now':
      return row.presence === 'active' || row.presence === 'idle'
    case 'active_7d':
      return context.activeOrgIds7d.has(row.organizationId)
    case 'dormant':
      return context.dormantOrgIds.has(row.organizationId)
    case 'pending_setup':
      return !row.classificationExcludedFromAdoption && row.onboardingStatus === 'pending'
    case 'security_alert':
      return row.unreadSecurityAlertCount >= 1
    case 'revoked':
      return row.access.revokedCount >= 1
    default:
      return true
  }
}

export function buildFleetFilterContext(input: {
  accounts: FounderFleetAccountLike[]
  activitySessions: FounderKpiSessionActivityRow[]
  now?: string | Date
}): {
  activeOrgIds7d: Set<string>
  dormantOrgIds: Set<string>
} {
  const nowDate = input.now instanceof Date
    ? input.now
    : input.now
      ? new Date(input.now)
      : new Date()
  const window7 = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const window30 = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const kpiOrgs = input.accounts.map((account) => ({
    organizationId: account.organizationId,
    createdAt: account.createdAt ?? null,
    classification: account.classification,
    onboardingStatus: account.onboardingStatus,
    accountStatus: account.accountStatus,
  }))
  const eligible = kpiOrgs.filter((org) => !isExcludedFromAdoptionKpis(org.classification))
  const eligibleIds = new Set(eligible.map((org) => org.organizationId))
  const active7 = collectActiveOrganizationIds(input.activitySessions, window7, eligibleIds)
  const active30 = collectActiveOrganizationIds(input.activitySessions, window30, eligibleIds)

  const dormantOrgIds = new Set<string>()
  for (const org of eligible) {
    if (
      org.onboardingStatus === 'complete'
      && org.accountStatus === 'active'
      && !active30.has(org.organizationId)
    ) {
      dormantOrgIds.add(org.organizationId)
    }
  }

  return { activeOrgIds7d: active7, dormantOrgIds }
}

/**
 * Client-side filter context from server-enriched account metrics.
 * Equivalent to session-based context when lastActiveAt / activeDays30 share 3B5 authority.
 */
export function buildFleetFilterContextFromAccounts(input: {
  accounts: FounderFleetAccountLike[]
  now?: string | Date
}): {
  activeOrgIds7d: Set<string>
  dormantOrgIds: Set<string>
} {
  const nowDate = input.now instanceof Date
    ? input.now
    : input.now
      ? new Date(input.now)
      : new Date()
  const window7Ms = nowDate.getTime() - 7 * 24 * 60 * 60 * 1000

  const activeOrgIds7d = new Set<string>()
  const dormantOrgIds = new Set<string>()

  for (const account of input.accounts) {
    if (isExcludedFromAdoptionKpis(account.classification)) continue
    const lastActiveMs = toMillis(account.lastActiveAt)
    if (Number.isFinite(lastActiveMs) && lastActiveMs >= window7Ms) {
      activeOrgIds7d.add(account.organizationId)
    }
    if (
      account.onboardingStatus === 'complete'
      && account.accountStatus === 'active'
      && (account.activeDays30 ?? 0) === 0
    ) {
      dormantOrgIds.add(account.organizationId)
    }
  }

  return { activeOrgIds7d, dormantOrgIds }
}

export function filterFounderFleetRows(
  rows: FounderFleetRow[],
  filter: FounderFleetFilter,
  context: {
    activeOrgIds7d: Set<string>
    dormantOrgIds: Set<string>
  },
): FounderFleetRow[] {
  return rows.filter((row) => organizationMatchesFleetFilter(row, filter, context))
}

/**
 * Attention-first deterministic ordering:
 * Active → Idle → Locked → security alerts → recently active → remaining
 */
export function sortFounderFleetRows(rows: FounderFleetRow[]): FounderFleetRow[] {
  return [...rows].sort((left, right) => {
    const presenceDiff = FLEET_PRESENCE_PRIORITY[right.presence] - FLEET_PRESENCE_PRIORITY[left.presence]
    if (presenceDiff !== 0) return presenceDiff

    const leftAlert = left.unreadSecurityAlertCount > 0 ? 1 : 0
    const rightAlert = right.unreadSecurityAlertCount > 0 ? 1 : 0
    if (rightAlert !== leftAlert) return rightAlert - leftAlert

    const lastActiveDiff = toMillis(right.lastActiveAt) - toMillis(left.lastActiveAt)
    if (lastActiveDiff !== 0) return lastActiveDiff

    return String(left.organizationName || '').localeCompare(String(right.organizationName || ''))
  })
}

export function countOrganizationsMatchingFleetFilter(
  rows: FounderFleetRow[],
  filter: FounderFleetFilter,
  context: {
    activeOrgIds7d: Set<string>
    dormantOrgIds: Set<string>
  },
): number {
  return filterFounderFleetRows(rows, filter, context).length
}

export function fleetFilterLabel(filter: FounderFleetFilter): string {
  switch (filter) {
    case 'all': return 'ALL'
    case 'active_now': return 'ACTIVE NOW'
    case 'active_7d': return 'ACTIVE 7D'
    case 'dormant': return 'DORMANT'
    case 'pending_setup': return 'PENDING SETUP'
    case 'security_alert': return 'SECURITY ALERT'
    case 'revoked': return 'REVOKED'
    default: return String(filter).toUpperCase()
  }
}

/** Compact live presence second-line for Company cell — only when live. */
export function companyPresenceContext(
  presence: FounderFleetPresenceStatus,
  liveDeviceCount?: number,
  liveSessionCount?: number,
): string | null {
  if (presence !== 'active' && presence !== 'idle') return null
  const devices = liveDeviceCount ?? 0
  const sessions = liveSessionCount ?? 0
  return `${formatFleetPresenceLabel(presence)} · ${devices} live device${devices === 1 ? '' : 's'} · ${sessions} live session${sessions === 1 ? '' : 's'}`
}

export function sessionQualifiesForFleetActivity(
  session: Pick<FounderKpiSessionActivityRow, 'session_id' | 'started_at' | 'last_interaction_at'>,
  windowStartMs: number,
): boolean {
  return sessionHasQualifyingActivity(session, windowStartMs)
}

export function toFleetKpiOrganizationInputs(
  accounts: FounderFleetAccountLike[],
): FounderKpiOrganizationInput[] {
  return accounts.map(toKpiOrgInput)
}
