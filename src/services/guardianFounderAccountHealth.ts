/**
 * GUARDIAN-3B7 — Transparent Account Health.
 *
 * Pure, deterministic derivation from canonical founder fleet / KPI / security
 * facts. No score, no AI, no persisted label — reproducible from visible inputs.
 *
 * Authorities reused (do not fork semantics):
 * - Dormant: same as guardianFounderKpis / guardianFounderFleet (3B5/3B6)
 * - Unread security: caller supplies count from filterUnreadGuardianSecurityAlerts
 * - Access: same summarizeOrgAccess counts (canonical profiles is_active)
 * - Onboarding / active-day / module metrics: same per-org fleet fields
 */

import {
  formatFleetLastActiveLabel,
  summarizeOrgAccess,
  type FounderFleetAccessSummary,
} from '@/services/guardianFounderFleet'

export const ACCOUNT_HEALTH_LABELS = ['Healthy', 'Watching', 'Needs Attention'] as const
export type AccountHealthLabel = (typeof ACCOUNT_HEALTH_LABELS)[number]

/**
 * Brand-new accounts (created within this window) are not penalized for sparse
 * module telemetry or pending setup alone. Session dormancy still uses the
 * shared 3B5/3B6 definition when onboarding is complete and access is active.
 */
export const ACCOUNT_HEALTH_YOUNG_ACCOUNT_DAYS = 14

export type AccountHealthReasonCode =
  | 'all_access_revoked'
  | 'unread_security_alert'
  | 'dormant'
  | 'mixed_access'
  | 'onboarding_pending'
  | 'healthy'

export interface AccountHealthInput {
  createdAt?: string | null
  onboardingStatus: 'complete' | 'pending'
  accountStatus: 'active' | 'inactive'
  lastActiveAt?: string | null
  activeDays30?: number
  modulesUsed30?: string[] | null
  accessActiveCount?: number
  accessRevokedCount?: number
  unreadSecurityAlertCount?: number
}

export interface AccountHealthFacts {
  access: FounderFleetAccessSummary
  onboardingStatus: 'complete' | 'pending'
  lastActiveAt: string | null
  lastActiveLabel: string
  activeDays30: number
  modulesUsed30: string[]
  modulesUsedCount: number
  unreadSecurityAlertCount: number
  isDormant: boolean
  isYoungAccount: boolean
  accountAgeDays: number | null
}

export interface AccountHealthResult {
  label: AccountHealthLabel
  reasonCode: AccountHealthReasonCode
  explanation: string
  facts: AccountHealthFacts
}

function toMillis(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY
  const millis = Date.parse(value)
  return Number.isNaN(millis) ? Number.NEGATIVE_INFINITY : millis
}

function resolveNowMs(now?: string | Date): number {
  if (now instanceof Date) return now.getTime()
  if (now) {
    const parsed = Date.parse(now)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function daysBetween(earlierMs: number, laterMs: number): number {
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs)) return 0
  return Math.max(0, Math.floor((laterMs - earlierMs) / (24 * 60 * 60 * 1000)))
}

/**
 * Exact 3B5/3B6 dormant definition (client account-metrics form):
 * onboarding complete + account active + zero qualifying active days in 30d.
 */
export function isAccountHealthDormant(input: {
  onboardingStatus: 'complete' | 'pending'
  accountStatus: 'active' | 'inactive'
  activeDays30: number
}): boolean {
  return input.onboardingStatus === 'complete'
    && input.accountStatus === 'active'
    && input.activeDays30 === 0
}

export function isYoungContractorAccount(
  createdAt: string | null | undefined,
  now?: string | Date,
  youngAccountDays = ACCOUNT_HEALTH_YOUNG_ACCOUNT_DAYS,
): boolean {
  const createdMs = toMillis(createdAt)
  if (!Number.isFinite(createdMs)) return false
  const ageDays = daysBetween(createdMs, resolveNowMs(now))
  return ageDays < youngAccountDays
}

function unreadAlertExplanation(count: number): string {
  if (count === 1) return '1 unread security alert'
  return `${count} unread security alerts`
}

function dormantExplanation(lastActiveAt: string | null, nowMs: number): string {
  const lastMs = toMillis(lastActiveAt)
  if (Number.isFinite(lastMs)) {
    const days = daysBetween(lastMs, nowMs)
    if (days <= 0) return 'No qualifying activity in 30 days'
    return `No activity in ${days} days`
  }
  return 'No qualifying activity in 30 days'
}

function healthyExplanation(activeDays30: number, modulesUsedCount: number): string {
  const dayPart = activeDays30 === 1
    ? 'Active 1 day in last 30 days'
    : `Active ${activeDays30} days in last 30 days`
  const modulePart = modulesUsedCount === 1
    ? '1 module'
    : `${modulesUsedCount} modules`
  return `${dayPart} · ${modulePart} · No security alerts`
}

function mixedAccessExplanation(access: FounderFleetAccessSummary): string {
  return `Mixed access · ${access.activeCount} Active · ${access.revokedCount} Revoked`
}

/**
 * Derive Account Health from already-returned per-org founder metrics.
 *
 * Priority (first match wins):
 * 1. Needs Attention — all canonical access revoked
 * 2. Needs Attention — unread security alert(s) (Security Center authority)
 * 3. Watching — dormant (exact 3B5/3B6 definition)
 * 4. Watching — mixed access (some active + some revoked)
 * 5. Watching — onboarding pending (not punitive Needs Attention; young accounts
 *    with pending setup alone stay here, never Needs Attention for sparse telemetry)
 * 6. Healthy — active access, onboarded, recent activity, no unread alerts
 *
 * Missing module telemetry never alone forces Watching or Needs Attention.
 * Historical/read security events never affect health (caller must pass unread only).
 * Prior revocation history never sticks after restore (current access counts only).
 */
export function deriveContractorAccountHealth(
  input: AccountHealthInput,
  now?: string | Date,
): AccountHealthResult {
  const nowMs = resolveNowMs(now)
  const activeDays30 = Math.max(0, Math.floor(input.activeDays30 ?? 0) || 0)
  const modulesUsed30 = (input.modulesUsed30 ?? []).filter(Boolean)
  const unreadSecurityAlertCount = Math.max(0, Math.floor(input.unreadSecurityAlertCount ?? 0) || 0)
  const access = summarizeOrgAccess(
    input.accessActiveCount ?? (input.accountStatus === 'active' ? 1 : 0),
    input.accessRevokedCount ?? (input.accountStatus === 'inactive' ? 1 : 0),
  )
  const lastActiveAt = input.lastActiveAt ?? null
  const createdMs = toMillis(input.createdAt)
  const accountAgeDays = Number.isFinite(createdMs) ? daysBetween(createdMs, nowMs) : null
  const young = isYoungContractorAccount(input.createdAt, now)
  const dormant = isAccountHealthDormant({
    onboardingStatus: input.onboardingStatus,
    accountStatus: input.accountStatus,
    activeDays30,
  })

  const facts: AccountHealthFacts = {
    access,
    onboardingStatus: input.onboardingStatus,
    lastActiveAt,
    lastActiveLabel: formatFleetLastActiveLabel(lastActiveAt, now),
    activeDays30,
    modulesUsed30,
    modulesUsedCount: modulesUsed30.length,
    unreadSecurityAlertCount,
    isDormant: dormant,
    isYoungAccount: young,
    accountAgeDays,
  }

  // 1. All canonical access revoked
  if (access.kind === 'revoked') {
    return {
      label: 'Needs Attention',
      reasonCode: 'all_access_revoked',
      explanation: 'All canonical user access revoked',
      facts,
    }
  }

  // 2. Unread security alerts (same authority as Security Center)
  if (unreadSecurityAlertCount >= 1) {
    return {
      label: 'Needs Attention',
      reasonCode: 'unread_security_alert',
      explanation: unreadAlertExplanation(unreadSecurityAlertCount),
      facts,
    }
  }

  // 3. Dormant — exact 3B5/3B6 definition → Watching
  if (dormant) {
    return {
      label: 'Watching',
      reasonCode: 'dormant',
      explanation: dormantExplanation(lastActiveAt, nowMs),
      facts,
    }
  }

  // 4. Mixed access — still usable, but founder should notice
  if (access.kind === 'mixed') {
    return {
      label: 'Watching',
      reasonCode: 'mixed_access',
      explanation: mixedAccessExplanation(access),
      facts,
    }
  }

  // 5. Onboarding pending — factual Watching; never Needs Attention from pending alone.
  // Young accounts with sparse telemetry also land here when pending (not Healthy yet).
  if (input.onboardingStatus === 'pending') {
    return {
      label: 'Watching',
      reasonCode: 'onboarding_pending',
      explanation: young ? 'Onboarding pending · New account' : 'Onboarding pending',
      facts,
    }
  }

  // 6. Healthy — active access, complete onboarding, recent usage, clear security
  return {
    label: 'Healthy',
    reasonCode: 'healthy',
    explanation: healthyExplanation(activeDays30, modulesUsed30.length),
    facts,
  }
}

export function accountHealthBadgeClass(label: AccountHealthLabel): string {
  switch (label) {
    case 'Healthy':
      return 'border-green-800/60 bg-green-950/50 text-green-400'
    case 'Watching':
      return 'border-amber-800/60 bg-amber-950/40 text-amber-300'
    case 'Needs Attention':
      return 'border-red-800/60 bg-red-950/40 text-red-300'
    default:
      return 'border-gray-700 bg-gray-900 text-gray-400'
  }
}
