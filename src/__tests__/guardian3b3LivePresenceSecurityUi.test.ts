import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  hasGuardianPresenceSnapshot,
  type GuardianPresenceRefreshReason,
} from '@/components/guardian/FounderContractorAdminSurface'
import { FOUNDER_GUARDIAN_POLL_INTERVAL_MS } from '@/services/guardianFounderPresence'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const FUNCTION_SOURCE = read('netlify/functions/pilot-telemetry.ts')
const SURFACE_SOURCE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const SERVICE_SOURCE = read('src/services/founderContractorAdminService.ts')
const HELPER_SOURCE = read('src/services/guardianFounderPresence.ts')
const NO_HISTORY_SUMMARY = {
  organizationId: 'org-empty',
  status: 'no_history' as const,
  hasHistory: false,
  liveDeviceCount: 0,
  liveSessionCount: 0,
  lastInteractionAt: null,
  lastHeartbeatAt: null,
  sessionCount: 0,
}

describe('GUARDIAN-3B3 live presence + founder security UI (SOURCE-CONTRACT)', () => {
  it('adds founder-only presence summary and detail server actions to the canonical pilot telemetry route', () => {
    expect(FUNCTION_SOURCE).toContain("action === 'founder_contractor_presence'")
    expect(FUNCTION_SOURCE).toContain("action === 'founder_contractor_presence_detail'")
    expect(FUNCTION_SOURCE).toContain("action === 'founder_revoke_user_access'")
    expect(FUNCTION_SOURCE).toContain("action === 'founder_restore_user_access'")
    expect(FUNCTION_SOURCE).toContain('async function handleFounderContractorPresence(user: any)')
    expect(FUNCTION_SOURCE).toContain('async function handleFounderContractorPresenceDetail(event: NetlifyEvent, user: any)')
    expect(FUNCTION_SOURCE).toContain('async function handleFounderRevokeUserAccess(event: NetlifyEvent, user: any)')
    expect(FUNCTION_SOURCE).toContain('async function handleFounderRestoreUserAccess(event: NetlifyEvent, user: any)')
  })

  it('guards both new founder-only actions before privileged reads begin', () => {
    const summaryStart = FUNCTION_SOURCE.indexOf('async function handleFounderContractorPresence')
    const detailStart = FUNCTION_SOURCE.indexOf('async function handleFounderContractorPresenceDetail')
    const artifactStart = FUNCTION_SOURCE.indexOf('async function handleFounderAgreementArtifact')
    const summaryHandler = FUNCTION_SOURCE.slice(summaryStart, detailStart)
    const detailHandler = FUNCTION_SOURCE.slice(detailStart, artifactStart)

    expect(summaryHandler.indexOf('requireFounder(user)')).toBeLessThan(summaryHandler.indexOf('getServiceClient()'))
    expect(detailHandler.indexOf('requireFounder(user)')).toBeLessThan(detailHandler.indexOf('getServiceClient()'))
  })

  it('requires session_id IS NOT NULL for founder presence queries and never introduces client reads against account_security_events', () => {
    expect(FUNCTION_SOURCE).toContain(".not('session_id', 'is', null)")
    expect(SERVICE_SOURCE).not.toContain('account_security_events')
    expect(SERVICE_SOURCE).not.toMatch(/\.from\(['"]account_security_events['"]\)/)
  })

  it('keeps unread state browser-local using the explicit Guardian key instead of a new migration or table', () => {
    expect(HELPER_SOURCE).toContain("poweron_guardian_security_last_seen_at")
    expect(FUNCTION_SOURCE).not.toContain('migration 123')
    expect(FUNCTION_SOURCE).not.toContain('guardian_security_last_seen')
  })

  it('extends the contractor accounts surface with live presence, security alerts, and founder-only polling hooks', () => {
    expect(SURFACE_SOURCE).toContain('Security Alerts')
    expect(SURFACE_SOURCE).toContain('Security Center')
    expect(SURFACE_SOURCE).toContain('Live Presence / Sessions')
    expect(SURFACE_SOURCE).toContain('Security History')
    expect(SURFACE_SOURCE).toContain('Users / Access')
    expect(SURFACE_SOURCE).toContain('createGuardianPollingLoop')
    expect(SURFACE_SOURCE).toContain('fetchFounderContractorPresenceReport')
    expect(SURFACE_SOURCE).toContain('fetchFounderContractorPresenceDetail')
    expect(SURFACE_SOURCE).toContain('setPresenceSecurityHistory')
  })

  it('returns compact founder-only canonical user access fields on the contractor detail payload', () => {
    expect(FUNCTION_SOURCE).toContain('loadFounderContractorUserAccess')
    expect(FUNCTION_SOURCE).toContain('userAccess: accessData.userAccess')
    expect(FUNCTION_SOURCE).toContain('employeeOnlyIdentityNotice')
    expect(SERVICE_SOURCE).toContain('export interface FounderContractorUserAccess')
    expect(SERVICE_SOURCE).toContain('revokeFounderUserAccess')
    expect(SERVICE_SOURCE).toContain('restoreFounderUserAccess')
  })

  it('resolves initial loading into stable empty states after a successful empty response', () => {
    expect(hasGuardianPresenceSnapshot({
      summaries: [],
      alerts: [],
      serverNow: null,
    })).toBe(false)
    expect(hasGuardianPresenceSnapshot({
      summaries: [NO_HISTORY_SUMMARY],
      alerts: [],
      serverNow: '2026-08-15T12:00:00.000Z',
    })).toBe(true)
    expect(SURFACE_SOURCE).toContain('Loading live presence...')
    expect(SURFACE_SOURCE).toContain('No session history')
    expect(SURFACE_SOURCE).toContain('No device grouping is available yet for this contractor.')
    expect(SURFACE_SOURCE).toContain('No recent new-runtime sessions found for this contractor.')
  })

  it('uses a silent 90-second background observer cadence and keeps refresh progress button-scoped', () => {
    const refreshModes: GuardianPresenceRefreshReason[] = ['initial', 'background', 'manual']
    expect(refreshModes).toEqual(['initial', 'background', 'manual'])
    expect(FOUNDER_GUARDIAN_POLL_INTERVAL_MS).toBe(90_000)
    expect(SURFACE_SOURCE).toContain("refreshAccounts(firstRun ? 'initial' : 'background')")
    expect(SURFACE_SOURCE).toContain('setPresenceManualRefreshing(true)')
    expect(SURFACE_SOURCE).toContain("const refreshing = section === 'accounts' ? presenceManualRefreshing : loading")
    expect(SURFACE_SOURCE).not.toContain('Refreshing live presence...')
  })

  it('preserves prior presence data during background refreshes and failures instead of blanking the panel', () => {
    expect(SURFACE_SOURCE).toContain('presenceDetailsByOrganizationId')
    expect(SURFACE_SOURCE).toContain('presenceShowingStaleData')
    expect(SURFACE_SOURCE).toContain('presenceDetailShowingStaleData')
    expect(SURFACE_SOURCE).toContain('Showing the last successful live presence snapshot while Guardian refresh is temporarily unavailable.')
    expect(SURFACE_SOURCE).toContain('Showing the last successful session history while Guardian refresh is temporarily unavailable.')
    expect(SURFACE_SOURCE).not.toContain('setPresenceDetail(null)')
  })
})
