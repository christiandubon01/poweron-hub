import { authedJsonHeaders } from '@/services/authedFetch'

export interface FounderContractorAccount {
  organizationId: string
  organizationName: string
  ownerFullName: string | null
  ownerEmail: string
  createdAt: string
  onboardingStatus: 'complete' | 'pending'
  agreementStatus: 'signed' | 'grandfathered' | 'missing' | 'revoked'
  ndaState: 'SIGNED_CURRENT' | 'SIGNED_LEGACY' | 'GRANDFATHERED_LEGACY_ACCESS' | 'UNSIGNED' | 'REVOKED'
  agreementVersion: string | null
  signedAt: string | null
  signer: string | null
  artifactAvailable: boolean
  classification: string
  accountStatus: 'active' | 'inactive'
  employeeCount: number
  memberCount: number
  lastActivityAt: string | null
  lastLoginAt: string | null
  /** Qualifying session activity (started_at / last_interaction_at) — not heartbeat alone. */
  lastActiveAt: string | null
  /** Distinct UTC calendar days with qualifying activity in trailing 30d. */
  activeDays30: number
  /** Distinct normalized module_entered modules in trailing 30d. */
  modulesUsed30: string[]
  /** Canonical profiles with is_active !== false. */
  accessActiveCount: number
  /** Canonical profiles with is_active === false. */
  accessRevokedCount: number
}

export interface FounderBetaInvite {
  id: string
  email: string
  industry: string | null
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  invitedAt: string
  acceptedAt: string | null
  expiresAt: string
  organizationId: string | null
  organizationName: string | null
}

export interface FounderSignedAgreement {
  id: string
  signer: string
  email: string
  organizationId: string | null
  organizationName: string | null
  version: string | null
  signedAt: string | null
  ndaState: 'SIGNED_CURRENT' | 'SIGNED_LEGACY' | 'GRANDFATHERED_LEGACY_ACCESS' | 'UNSIGNED' | 'REVOKED'
  status: 'current' | 'legacy' | 'grandfathered' | 'unsigned' | 'revoked'
  pinVerified: boolean
  hasPdf: boolean
  artifactStatus: 'signed_document_on_file' | 'no_signed_pdf_captured' | 'access_grandfathered_no_signed_document' | 'no_document'
}

export interface FounderAgreementArtifactAccess {
  url: string
  filename: string
}

export type FounderContractorPresenceStatus = 'active' | 'idle' | 'locked' | 'offline' | 'no_history'

export interface FounderContractorPresenceSummary {
  organizationId: string
  status: FounderContractorPresenceStatus
  hasHistory: boolean
  liveDeviceCount: number
  liveSessionCount: number
  lastInteractionAt: string | null
  lastHeartbeatAt: string | null
  sessionCount: number
}

export interface FounderSecurityAlert {
  organizationId: string
  organizationName: string
  sessionId: string | null
  userId: string
  userLabel: string
  deviceId: string | null
  deviceLabel: string
  eventType: 'session_started' | 'ip_changed'
  occurredAt: string
  publicIp: string | null
  previousPublicIp: string | null
  isNewDevice: boolean
  alertKind: 'new_device' | 'ip_changed'
}

export interface FounderContractorPresenceReport {
  serverNow: string
  summaries: FounderContractorPresenceSummary[]
  alerts: FounderSecurityAlert[]
  securityHistory: FounderGlobalSecurityHistoryEntry[]
}

export interface FounderPresenceDeviceGroup {
  deviceKey: string
  deviceId: string | null
  deviceLabel: string
  deviceType: string
  status: FounderContractorPresenceStatus
  liveSessionCount: number
  startedAt: string | null
  lastInteractionAt: string | null
  lastHeartbeatAt: string | null
  recentModule: string | null
  recentModuleLabel: string
}

export interface FounderPresenceSessionRecord {
  sessionId: string
  userId: string
  userLabel: string
  userRole: string | null
  deviceId: string | null
  deviceLabel: string
  deviceType: string
  module: string | null
  moduleLabel: string
  visibilityState: 'visible' | 'hidden'
  status: FounderContractorPresenceStatus
  startedAt: string | null
  lastInteractionAt: string | null
  lastHeartbeatAt: string | null
  endedAt: string | null
  endedReason: string | null
}

export interface FounderSecurityHistoryEntry {
  sessionId: string | null
  userId: string
  userLabel: string
  deviceId: string | null
  deviceLabel: string
  eventType: 'session_started' | 'ip_changed'
  occurredAt: string
  publicIp: string | null
  previousPublicIp: string | null
  isNewDevice: boolean
  isAlert: boolean
}

export interface FounderGlobalSecurityHistoryEntry extends FounderSecurityHistoryEntry {
  organizationId: string
  organizationName: string
}

export interface FounderContractorUserAccess {
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

export interface FounderUserAccessMutationResult {
  ok: true
  targetUserId: string
  targetOrgId: string
  revokedAt?: string
  restoredAt?: string
  invalidatedSessionCount?: number
  cleanupWarning?: string | null
}

export interface FounderContractorPresenceDetail {
  organizationId: string
  organizationName: string
  serverNow: string
  summary: FounderContractorPresenceSummary
  deviceGroups: FounderPresenceDeviceGroup[]
  sessions: FounderPresenceSessionRecord[]
  securityHistory: FounderSecurityHistoryEntry[]
  userAccess: FounderContractorUserAccess[]
  employeeOnlyIdentityCount: number
  employeeOnlyIdentityNotice: string | null
}

export interface FounderContractorAdminReport {
  generatedAt: string
  contractorAccounts: FounderContractorAccount[]
  contractorBetaInvites: FounderBetaInvite[]
  signedAgreements: FounderSignedAgreement[]
  kpis?: {
    adoption: {
      activeOrgs7d: number
      activeOrgs30d: number
      newContractorAccountsThisMonth: number
      dormantAccounts: number
    }
    onboarding: {
      pendingSetup: number
      completedOnboarding: number
      pendingInvites: number
      inviteConversionRate: number | null
      inviteConversionAccepted: number
      inviteConversionEligible: number
    }
    security: {
      newDevices30d: number
      ipChanges30d: number
      revokedUsers: number
    }
  }
}

export interface FounderContractorPresenceReport {
  serverNow: string
  summaries: FounderContractorPresenceSummary[]
  alerts: FounderSecurityAlert[]
  securityHistory: FounderGlobalSecurityHistoryEntry[]
  kpis?: {
    liveNow: {
      organizationsActiveNow: number
      usersActiveNow: number
      liveDevices: number
      liveSessions: number
    }
    security: {
      newDevices30d: number
      ipChanges30d: number
      revokedUsers: number
    }
  }
}

export async function fetchFounderContractorAdminReport(): Promise<FounderContractorAdminReport> {
  const response = await fetch('/.netlify/functions/pilot-telemetry?action=founder_contractor_admin', {
    method: 'GET',
    headers: await authedJsonHeaders(),
  })
  if (!response.ok) throw new Error(await response.text() || `Founder contractor report failed (${response.status})`)
  return response.json()
}

export async function fetchFounderAgreementArtifactAccess(
  agreementId: string,
): Promise<FounderAgreementArtifactAccess> {
  const response = await fetch('/.netlify/functions/pilot-telemetry', {
    method: 'POST',
    headers: await authedJsonHeaders(),
    body: JSON.stringify({
      action: 'founder_agreement_artifact',
      agreementId,
    }),
  })
  if (!response.ok) {
    throw new Error(await response.text() || `Founder agreement artifact request failed (${response.status})`)
  }
  return response.json()
}

export async function fetchFounderContractorPresenceReport(): Promise<FounderContractorPresenceReport> {
  const response = await fetch('/.netlify/functions/pilot-telemetry?action=founder_contractor_presence', {
    method: 'GET',
    headers: await authedJsonHeaders(),
  })
  if (!response.ok) throw new Error(await response.text() || `Founder contractor presence failed (${response.status})`)
  return response.json()
}

export async function fetchFounderContractorPresenceDetail(
  organizationId: string,
): Promise<FounderContractorPresenceDetail> {
  const response = await fetch('/.netlify/functions/pilot-telemetry', {
    method: 'POST',
    headers: await authedJsonHeaders(),
    body: JSON.stringify({
      action: 'founder_contractor_presence_detail',
      organizationId,
    }),
  })
  if (!response.ok) {
    throw new Error(await response.text() || `Founder contractor presence detail failed (${response.status})`)
  }
  return response.json()
}

export async function revokeFounderUserAccess(
  targetUserId: string,
  targetOrgId: string,
): Promise<FounderUserAccessMutationResult> {
  const response = await fetch('/.netlify/functions/pilot-telemetry', {
    method: 'POST',
    headers: await authedJsonHeaders(),
    body: JSON.stringify({
      action: 'founder_revoke_user_access',
      targetUserId,
      targetOrgId,
    }),
  })
  if (!response.ok) {
    throw new Error(await response.text() || `Founder revoke user access failed (${response.status})`)
  }
  return response.json()
}

export async function restoreFounderUserAccess(
  targetUserId: string,
  targetOrgId: string,
): Promise<FounderUserAccessMutationResult> {
  const response = await fetch('/.netlify/functions/pilot-telemetry', {
    method: 'POST',
    headers: await authedJsonHeaders(),
    body: JSON.stringify({
      action: 'founder_restore_user_access',
      targetUserId,
      targetOrgId,
    }),
  })
  if (!response.ok) {
    throw new Error(await response.text() || `Founder restore user access failed (${response.status})`)
  }
  return response.json()
}
