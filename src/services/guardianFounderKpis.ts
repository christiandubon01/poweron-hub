/**
 * GUARDIAN-3B5 — Founder KPI strip aggregation.
 *
 * Pure, deterministic builders. Server endpoints call these after bounded queries;
 * React only renders the resulting counts (plus unread alerts via the shared
 * Security Center last-seen helper).
 */

import {
  deriveFounderPresenceStatus,
  type FounderPresenceSessionRow,
  type FounderPresenceStatus,
} from '@/services/guardianFounderPresence'
import { getPilotOrganizationClassification } from '@/services/pilotTelemetryShared'

export const FOUNDER_KPI_ACTIVE_ORG_WINDOWS_DAYS = [7, 30] as const

export type FounderKpiValue = number | null

export interface FounderLiveNowKpis {
  organizationsActiveNow: number
  usersActiveNow: number
  liveDevices: number
  liveSessions: number
}

export interface FounderAdoptionKpis {
  activeOrgs7d: number
  activeOrgs30d: number
  newContractorAccountsThisMonth: number
  dormantAccounts: number
}

export interface FounderSecurityKpiCounts {
  /** Trailing 30d session_started + is_new_device=true */
  newDevices30d: number
  /** Trailing 30d ip_changed */
  ipChanges30d: number
  /** Canonical profiles.is_active = false in contractor orgs */
  revokedUsers: number
}

export interface FounderOnboardingKpis {
  pendingSetup: number
  completedOnboarding: number
  pendingInvites: number
  /** Accepted ÷ eligible sent; null when denominator is 0 */
  inviteConversionRate: number | null
  inviteConversionAccepted: number
  inviteConversionEligible: number
}

export interface FounderFleetKpis {
  liveNow: FounderLiveNowKpis
  adoption: FounderAdoptionKpis
  security: FounderSecurityKpiCounts
  onboarding: FounderOnboardingKpis
}

export interface FounderKpiOrganizationInput {
  organizationId: string
  createdAt: string | null
  classification: string
  onboardingStatus: 'complete' | 'pending'
  accountStatus: 'active' | 'inactive'
}

export interface FounderKpiInviteInput {
  id: string
  email: string
  status: 'pending' | 'accepted' | 'expired' | 'revoked' | string
  invitedAt: string | null
}

export interface FounderKpiSessionActivityRow {
  org_id: string
  session_id: string | null
  started_at: string | null
  last_interaction_at: string | null
}

function isLiveStatus(status: FounderPresenceStatus): boolean {
  return status === 'active' || status === 'idle'
}

function toMillis(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const millis = Date.parse(value)
  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis
}

/** Demo / internal orgs never contribute to adoption or new-account KPIs. */
export function isExcludedFromAdoptionKpis(classification: string | null | undefined): boolean {
  const normalized = String(classification || '').trim().toLowerCase()
  return normalized === 'demo' || normalized === 'internal'
}

/**
 * Genuine authenticated application activity for Active Orgs / Dormant.
 *
 * Authority: user_sessions (not product telemetry).
 * Counts a session when session_id is present AND either:
 *   - started_at is within the window (login / session begin), or
 *   - last_interaction_at is within the window (real user interaction)
 *
 * Excludes heartbeat-only freshness (last_active_at alone) so observer
 * heartbeats and idle tabs without interaction do not inflate adoption.
 */
export function sessionHasQualifyingActivity(
  session: Pick<FounderKpiSessionActivityRow, 'session_id' | 'started_at' | 'last_interaction_at'>,
  windowStartMs: number,
): boolean {
  if (!session.session_id) return false
  const started = toMillis(session.started_at)
  const interacted = toMillis(session.last_interaction_at)
  return (Number.isFinite(started) && started >= windowStartMs)
    || (Number.isFinite(interacted) && interacted >= windowStartMs)
}

export function buildFounderLiveNowKpis(
  sessions: FounderPresenceSessionRow[],
  serverNow: string,
): FounderLiveNowKpis {
  const liveSessions = sessions.filter((session) => {
    if (!session.session_id) return false
    return isLiveStatus(deriveFounderPresenceStatus(session, serverNow))
  })

  const organizations = new Set<string>()
  const users = new Set<string>()
  const devices = new Set<string>()
  let hasUnknownDevice = false

  for (const session of liveSessions) {
    if (session.org_id) organizations.add(String(session.org_id))
    if (session.user_id) users.add(String(session.user_id))
    if (session.device_id) devices.add(String(session.device_id))
    else hasUnknownDevice = true
  }

  return {
    organizationsActiveNow: organizations.size,
    usersActiveNow: users.size,
    liveDevices: devices.size + (hasUnknownDevice ? 1 : 0),
    liveSessions: liveSessions.length,
  }
}

export function collectActiveOrganizationIds(
  sessions: FounderKpiSessionActivityRow[],
  windowStartIso: string,
  eligibleOrganizationIds: Set<string> | string[],
): Set<string> {
  const eligible = eligibleOrganizationIds instanceof Set
    ? eligibleOrganizationIds
    : new Set(eligibleOrganizationIds)
  const windowStartMs = toMillis(windowStartIso)
  const active = new Set<string>()

  for (const session of sessions) {
    const orgId = String(session.org_id || '').trim()
    if (!orgId || !eligible.has(orgId)) continue
    if (!sessionHasQualifyingActivity(session, windowStartMs)) continue
    active.add(orgId)
  }

  return active
}

function calendarMonthStartIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString()
}

function calendarMonthEndExclusiveIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString()
}

export function buildFounderAdoptionKpis(input: {
  organizations: FounderKpiOrganizationInput[]
  activitySessions: FounderKpiSessionActivityRow[]
  now?: string | Date
}): FounderAdoptionKpis {
  const nowDate = input.now instanceof Date
    ? input.now
    : input.now
      ? new Date(input.now)
      : new Date()
  const nowMs = nowDate.getTime()
  const window7 = new Date(nowMs - 7 * 24 * 60 * 60 * 1000).toISOString()
  const window30 = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString()
  const monthStart = calendarMonthStartIso(nowDate)
  const monthEndExclusive = calendarMonthEndExclusiveIso(nowDate)

  const adoptionEligible = input.organizations.filter(
    (org) => !isExcludedFromAdoptionKpis(org.classification),
  )
  const eligibleIds = new Set(adoptionEligible.map((org) => org.organizationId))

  const active7 = collectActiveOrganizationIds(input.activitySessions, window7, eligibleIds)
  const active30 = collectActiveOrganizationIds(input.activitySessions, window30, eligibleIds)

  let newContractorAccountsThisMonth = 0
  let dormantAccounts = 0

  for (const org of adoptionEligible) {
    const createdMs = toMillis(org.createdAt)
    if (
      Number.isFinite(createdMs)
      && createdMs >= toMillis(monthStart)
      && createdMs < toMillis(monthEndExclusive)
    ) {
      newContractorAccountsThisMonth += 1
    }

    // Dormant: established (onboarding complete), still active account,
    // and no qualifying authenticated activity in the last 30 days.
    // Pending-setup accounts stay under Onboarding — never mislabeled dormant.
    if (
      org.onboardingStatus === 'complete'
      && org.accountStatus === 'active'
      && !active30.has(org.organizationId)
    ) {
      dormantAccounts += 1
    }
  }

  return {
    activeOrgs7d: active7.size,
    activeOrgs30d: active30.size,
    newContractorAccountsThisMonth,
    dormantAccounts,
  }
}

export function isEligibleInviteForConversion(invite: FounderKpiInviteInput): boolean {
  const email = String(invite.email || '').trim()
  const invitedAt = String(invite.invitedAt || '').trim()
  if (!email || !email.includes('@')) return false
  if (!invitedAt || !Number.isFinite(toMillis(invitedAt))) return false
  const status = String(invite.status || '').trim().toLowerCase()
  return status === 'pending' || status === 'accepted' || status === 'expired' || status === 'revoked'
}

export function buildFounderOnboardingKpis(input: {
  organizations: Array<Pick<FounderKpiOrganizationInput, 'onboardingStatus' | 'classification'>>
  invites: FounderKpiInviteInput[]
}): FounderOnboardingKpis {
  // Onboarding counts follow the contractor fleet table (owner-backed orgs),
  // including classified rows; demo/internal still appear in fleet but are rare.
  const fleet = input.organizations.filter(
    (org) => !isExcludedFromAdoptionKpis(org.classification),
  )

  let pendingSetup = 0
  let completedOnboarding = 0
  for (const org of fleet) {
    if (org.onboardingStatus === 'complete') completedOnboarding += 1
    else pendingSetup += 1
  }

  let pendingInvites = 0
  let accepted = 0
  let eligible = 0
  for (const invite of input.invites) {
    if (!isEligibleInviteForConversion(invite)) continue
    eligible += 1
    const status = String(invite.status || '').trim().toLowerCase()
    if (status === 'pending') pendingInvites += 1
    if (status === 'accepted') accepted += 1
  }

  return {
    pendingSetup,
    completedOnboarding,
    pendingInvites,
    inviteConversionAccepted: accepted,
    inviteConversionEligible: eligible,
    inviteConversionRate: eligible > 0 ? accepted / eligible : null,
  }
}

export function buildFounderSecurityKpiCounts(input: {
  newDevices30d: number
  ipChanges30d: number
  revokedUsers: number
}): FounderSecurityKpiCounts {
  return {
    newDevices30d: Math.max(0, Math.floor(input.newDevices30d) || 0),
    ipChanges30d: Math.max(0, Math.floor(input.ipChanges30d) || 0),
    revokedUsers: Math.max(0, Math.floor(input.revokedUsers) || 0),
  }
}

export function formatInviteConversionDisplay(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

export function classificationFromOrgSettings(settings: unknown): string {
  return getPilotOrganizationClassification(settings)
}

export function emptyFounderFleetKpis(): FounderFleetKpis {
  return {
    liveNow: {
      organizationsActiveNow: 0,
      usersActiveNow: 0,
      liveDevices: 0,
      liveSessions: 0,
    },
    adoption: {
      activeOrgs7d: 0,
      activeOrgs30d: 0,
      newContractorAccountsThisMonth: 0,
      dormantAccounts: 0,
    },
    security: {
      newDevices30d: 0,
      ipChanges30d: 0,
      revokedUsers: 0,
    },
    onboarding: {
      pendingSetup: 0,
      completedOnboarding: 0,
      pendingInvites: 0,
      inviteConversionRate: null,
      inviteConversionAccepted: 0,
      inviteConversionEligible: 0,
    },
  }
}
