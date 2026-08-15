import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildFounderLiveNowKpis,
  buildFounderAdoptionKpis,
  buildFounderOnboardingKpis,
  buildFounderSecurityKpiCounts,
  collectActiveOrganizationIds,
  formatInviteConversionDisplay,
  isEligibleInviteForConversion,
  isExcludedFromAdoptionKpis,
  sessionHasQualifyingActivity,
} from '@/services/guardianFounderKpis'
import {
  countUnreadGuardianSecurityAlerts,
  buildFounderSecurityAlerts,
} from '@/services/guardianFounderPresence'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const FUNCTION = read('netlify/functions/pilot-telemetry.ts')
const KPI_SOURCE = read('src/services/guardianFounderKpis.ts')
const SERVICE = read('src/services/founderContractorAdminService.ts')

const SERVER_NOW = '2026-08-15T12:00:00.000Z'

function session(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    org_id: 'org-1',
    device_id: 'device-1',
    device_type: 'web',
    device_info: { platform: 'web' },
    module: 'home',
    started_at: '2026-08-15T11:00:00.000Z',
    last_active_at: '2026-08-15T11:58:00.000Z',
    last_interaction_at: '2026-08-15T11:59:00.000Z',
    visibility_state: 'visible',
    ended_reason: null,
    ended_at: null,
    ...overrides,
  }
}

function securityEvent(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    org_id: 'org-1',
    device_id: 'device-1',
    event_type: 'session_started',
    public_ip: '203.0.113.10',
    previous_public_ip: null,
    is_new_device: false,
    occurred_at: '2026-08-15T11:55:00.000Z',
    ...overrides,
  }
}

describe('GUARDIAN-3B5 LIVE NOW definitions', () => {
  it('1. Organizations Active Now deduplicates multiple users/sessions in same org', () => {
    const kpis = buildFounderLiveNowKpis([
      session({ session_id: 's1', user_id: 'u1', org_id: 'org-a', device_id: 'd1' }),
      session({ session_id: 's2', user_id: 'u2', org_id: 'org-a', device_id: 'd2' }),
      session({ session_id: 's3', user_id: 'u3', org_id: 'org-b', device_id: 'd3' }),
    ], SERVER_NOW)
    expect(kpis.organizationsActiveNow).toBe(2)
  })

  it('2. Users Active Now deduplicates multiple sessions for same user', () => {
    const kpis = buildFounderLiveNowKpis([
      session({ session_id: 's1', user_id: 'u1', device_id: 'd1' }),
      session({ session_id: 's2', user_id: 'u1', device_id: 'd2' }),
      session({ session_id: 's3', user_id: 'u2', device_id: 'd3' }),
    ], SERVER_NOW)
    expect(kpis.usersActiveNow).toBe(2)
  })

  it('3. Live Devices deduplicates device_id', () => {
    const kpis = buildFounderLiveNowKpis([
      session({ session_id: 's1', device_id: 'device-same' }),
      session({ session_id: 's2', user_id: 'u2', device_id: 'device-same' }),
      session({ session_id: 's3', user_id: 'u3', device_id: 'device-other' }),
    ], SERVER_NOW)
    expect(kpis.liveDevices).toBe(2)
  })

  it('4. Live Sessions counts qualifying live sessions; Locked/Offline excluded', () => {
    const kpis = buildFounderLiveNowKpis([
      session({ session_id: 'live-1' }),
      session({
        session_id: 'locked-1',
        user_id: 'u2',
        device_id: 'd2',
        ended_reason: 'manual_lock',
        ended_at: '2026-08-15T11:59:00.000Z',
      }),
      session({
        session_id: 'offline-1',
        user_id: 'u3',
        device_id: 'd3',
        last_active_at: '2026-08-15T11:50:00.000Z',
      }),
    ], SERVER_NOW)
    expect(kpis.liveSessions).toBe(1)
    expect(kpis.usersActiveNow).toBe(1)
  })
})

describe('GUARDIAN-3B5 ADOPTION definitions', () => {
  const orgs = [
    {
      organizationId: 'org-active',
      createdAt: '2026-01-01T00:00:00.000Z',
      classification: 'normal',
      onboardingStatus: 'complete' as const,
      accountStatus: 'active' as const,
    },
    {
      organizationId: 'org-dormant',
      createdAt: '2026-01-02T00:00:00.000Z',
      classification: 'design_partner',
      onboardingStatus: 'complete' as const,
      accountStatus: 'active' as const,
    },
    {
      organizationId: 'org-pending',
      createdAt: '2026-08-10T00:00:00.000Z',
      classification: 'normal',
      onboardingStatus: 'pending' as const,
      accountStatus: 'active' as const,
    },
    {
      organizationId: 'org-demo',
      createdAt: '2026-08-12T00:00:00.000Z',
      classification: 'demo',
      onboardingStatus: 'complete' as const,
      accountStatus: 'active' as const,
    },
    {
      organizationId: 'org-internal',
      createdAt: '2026-08-14T00:00:00.000Z',
      classification: 'internal',
      onboardingStatus: 'complete' as const,
      accountStatus: 'active' as const,
    },
    {
      organizationId: 'org-new',
      createdAt: '2026-08-05T00:00:00.000Z',
      classification: 'customer_zero',
      onboardingStatus: 'complete' as const,
      accountStatus: 'active' as const,
    },
  ]

  it('5-6. Active Orgs 7D / 30D use correct rolling windows', () => {
    const sessions = [
      {
        org_id: 'org-active',
        session_id: 's1',
        started_at: '2026-08-14T00:00:00.000Z',
        last_interaction_at: '2026-08-14T12:00:00.000Z',
      },
      {
        org_id: 'org-dormant',
        session_id: 's2',
        started_at: '2026-07-01T00:00:00.000Z',
        last_interaction_at: '2026-07-01T00:00:00.000Z',
      },
      {
        // Outside 7d, inside 30d
        org_id: 'org-new',
        session_id: 's3',
        started_at: '2026-07-20T00:00:00.000Z',
        last_interaction_at: '2026-07-20T00:00:00.000Z',
      },
    ]
    const kpis = buildFounderAdoptionKpis({
      organizations: orgs,
      activitySessions: sessions,
      now: SERVER_NOW,
    })
    expect(kpis.activeOrgs7d).toBe(1)
    expect(kpis.activeOrgs30d).toBe(2)
  })

  it('7. demo activity excluded where applicable', () => {
    expect(isExcludedFromAdoptionKpis('demo')).toBe(true)
    const active = collectActiveOrganizationIds(
      [{
        org_id: 'org-demo',
        session_id: 's-demo',
        started_at: '2026-08-14T00:00:00.000Z',
        last_interaction_at: '2026-08-14T00:00:00.000Z',
      }],
      '2026-08-08T00:00:00.000Z',
      new Set(['org-active']),
    )
    expect(active.has('org-demo')).toBe(false)
    const kpis = buildFounderAdoptionKpis({
      organizations: orgs,
      activitySessions: [{
        org_id: 'org-demo',
        session_id: 's-demo',
        started_at: '2026-08-14T00:00:00.000Z',
        last_interaction_at: '2026-08-14T00:00:00.000Z',
      }],
      now: SERVER_NOW,
    })
    expect(kpis.activeOrgs7d).toBe(0)
    expect(kpis.newContractorAccountsThisMonth).toBe(2) // org-pending + org-new; demo/internal excluded
  })

  it('8. heartbeat-only activity does not fabricate contractor engagement', () => {
    expect(sessionHasQualifyingActivity({
      session_id: 's1',
      started_at: '2026-07-01T00:00:00.000Z',
      last_interaction_at: '2026-07-01T00:00:00.000Z',
    }, Date.parse('2026-08-08T00:00:00.000Z'))).toBe(false)
    expect(KPI_SOURCE).toContain('Excludes heartbeat-only freshness (last_active_at alone)')
    expect(KPI_SOURCE).toContain('user_sessions')
  })

  it('9-10. New Contractor Accounts uses current calendar month; founder/demo excluded', () => {
    const kpis = buildFounderAdoptionKpis({
      organizations: orgs,
      activitySessions: [],
      now: SERVER_NOW,
    })
    expect(kpis.newContractorAccountsThisMonth).toBe(2)
    expect(isExcludedFromAdoptionKpis('internal')).toBe(true)
  })

  it('11-12. Dormant is deterministic and pending-never-activated is not dormant', () => {
    const kpis = buildFounderAdoptionKpis({
      organizations: orgs,
      activitySessions: [{
        org_id: 'org-active',
        session_id: 's1',
        started_at: '2026-08-14T00:00:00.000Z',
        last_interaction_at: '2026-08-14T00:00:00.000Z',
      }],
      now: SERVER_NOW,
    })
    // org-dormant complete+active+no 30d activity
    // org-pending is pending setup — not dormant
    // org-new complete but no activity in 30d in this fixture → dormant too
    expect(kpis.dormantAccounts).toBe(2)
    expect(kpis.dormantAccounts).not.toBe(3)
  })
})

describe('GUARDIAN-3B5 SECURITY definitions', () => {
  it('13. Unread Security Alerts matches Security Center authority', () => {
    expect(SURFACE).toContain('countUnreadGuardianSecurityAlerts(presenceAlerts, lastSeenAt)')
    expect(SURFACE).toContain('unreadSecurityAlerts={unreadAlertCount}')
    const alerts = buildFounderSecurityAlerts([
      securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
      securityEvent({
        event_type: 'ip_changed',
        occurred_at: '2026-08-15T11:59:00.000Z',
        previous_public_ip: '203.0.113.9',
      }),
    ], { 'org-1': 'Alpha' })
    expect(countUnreadGuardianSecurityAlerts(alerts, '2026-08-15T11:57:00.000Z')).toBe(1)
  })

  it('14-16. New Devices / known-device / IP Changes 30D authority', () => {
    expect(FUNCTION).toContain("eventType: 'session_started'")
    expect(FUNCTION).toContain('isNewDevice: true')
    expect(FUNCTION).toContain("eventType: 'ip_changed'")
    expect(FUNCTION).toContain('countSecurityEvents')
    const counts = buildFounderSecurityKpiCounts({
      newDevices30d: 4,
      ipChanges30d: 2,
      revokedUsers: 1,
    })
    expect(counts).toEqual({ newDevices30d: 4, ipChanges30d: 2, revokedUsers: 1 })
  })

  it('17-18. Revoked Users counts profiles.is_active=false; employee-only not counted', () => {
    expect(FUNCTION).toContain('countRevokedCanonicalProfiles')
    const fnStart = FUNCTION.indexOf('async function countRevokedCanonicalProfiles')
    const fnEnd = FUNCTION.indexOf('\nasync function ', fnStart + 1)
    const fnBody = FUNCTION.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 500)
    expect(fnBody).toContain(".from('profiles')")
    expect(fnBody).toContain(".eq('is_active', false)")
    expect(fnBody).not.toContain('employee_profiles')
  })
})

describe('GUARDIAN-3B5 ONBOARDING definitions', () => {
  it('19-21. Pending Setup / Completed / Pending Invites use existing authorities', () => {
    const onboarding = buildFounderOnboardingKpis({
      organizations: [
        { onboardingStatus: 'pending', classification: 'normal' },
        { onboardingStatus: 'complete', classification: 'normal' },
        { onboardingStatus: 'complete', classification: 'demo' },
      ],
      invites: [
        { id: '1', email: 'a@example.com', status: 'pending', invitedAt: '2026-08-01T00:00:00.000Z' },
        { id: '2', email: 'b@example.com', status: 'accepted', invitedAt: '2026-08-02T00:00:00.000Z' },
        { id: '3', email: 'c@example.com', status: 'expired', invitedAt: '2026-07-01T00:00:00.000Z' },
        { id: '4', email: 'd@example.com', status: 'revoked', invitedAt: '2026-07-02T00:00:00.000Z' },
      ],
    })
    expect(onboarding.pendingSetup).toBe(1)
    expect(onboarding.completedOnboarding).toBe(1)
    expect(onboarding.pendingInvites).toBe(1)
  })

  it('22-23. conversion numerator/denominator explicit; zero denominator safe', () => {
    const withInvites = buildFounderOnboardingKpis({
      organizations: [],
      invites: [
        { id: '1', email: 'a@example.com', status: 'accepted', invitedAt: '2026-08-01T00:00:00.000Z' },
        { id: '2', email: 'b@example.com', status: 'pending', invitedAt: '2026-08-02T00:00:00.000Z' },
        { id: 'bad', email: '', status: 'accepted', invitedAt: '2026-08-01T00:00:00.000Z' },
      ],
    })
    expect(withInvites.inviteConversionAccepted).toBe(1)
    expect(withInvites.inviteConversionEligible).toBe(2)
    expect(withInvites.inviteConversionRate).toBe(0.5)
    expect(formatInviteConversionDisplay(withInvites.inviteConversionRate)).toBe('50%')

    const empty = buildFounderOnboardingKpis({ organizations: [], invites: [] })
    expect(empty.inviteConversionRate).toBeNull()
    expect(formatInviteConversionDisplay(empty.inviteConversionRate)).toBe('—')
    expect(formatInviteConversionDisplay(Number.NaN)).toBe('—')
    expect(formatInviteConversionDisplay(Number.POSITIVE_INFINITY)).toBe('—')
    expect(isEligibleInviteForConversion({
      id: 'x',
      email: 'ok@example.com',
      status: 'pending',
      invitedAt: '2026-08-01T00:00:00.000Z',
    })).toBe(true)
    expect(isEligibleInviteForConversion({
      id: 'y',
      email: '',
      status: 'pending',
      invitedAt: '2026-08-01T00:00:00.000Z',
    })).toBe(false)
  })
})

describe('GUARDIAN-3B5 UI contracts', () => {
  it('24. four group labels exist exactly', () => {
    expect(SURFACE).toContain("label: 'LIVE NOW'")
    expect(SURFACE).toContain("label: 'ADOPTION'")
    expect(SURFACE).toContain("label: 'SECURITY'")
    expect(SURFACE).toContain("label: 'ONBOARDING'")
  })

  it('25. required supported metrics render', () => {
    for (const label of [
      'Organizations Active Now',
      'Users Active Now',
      'Live Devices',
      'Live Sessions',
      'Active Orgs 7D',
      'Active Orgs 30D',
      'New Contractor Accounts This Month',
      'Dormant Accounts',
      'Unread Security Alerts',
      'New Devices 30D',
      'IP Changes 30D',
      'Revoked Users',
      'Pending Setup',
      'Completed Onboarding',
      'Pending Invites',
      'Invite → Account Conversion',
    ]) {
      expect(SURFACE).toContain(label)
    }
  })

  it('26. KPI strip appears before Contractor Accounts fleet', () => {
    const strip = SURFACE.indexOf('data-testid="founder-kpi-strip"')
    const fleet = SURFACE.indexOf('data-testid="founder-fleet-table"')
    expect(strip).toBeGreaterThan(-1)
    expect(fleet).toBeGreaterThan(strip)
  })

  it('27-30. Security Alerts / Security Center / contractor detail / Revoke restore preserved', () => {
    expect(SURFACE).toContain('Security Alerts')
    expect(SURFACE).toContain('openSecurityCenter()')
    expect(SURFACE).toContain('data-testid="security-center-modal"')
    expect(SURFACE).toContain('data-testid="contractor-detail-modal"')
    expect(SURFACE).toMatch(/Revoke|Restore/)
  })

  it('31. background refresh does not wipe visible KPI data', () => {
    expect(SURFACE).toContain('fleetKpisRef')
    expect(SURFACE).toContain('Preserve prior report/KPI snapshot during background refresh failures')
    expect(SURFACE).toContain('if (!reportStateRef.current)')
  })

  it('32. mobile layout has no forced horizontal grid', () => {
    const stripBlock = SURFACE.slice(
      SURFACE.indexOf('function FounderKpiStrip'),
      SURFACE.indexOf('export function reconcileSelectedOrganizationId'),
    )
    expect(stripBlock).toContain('grid-cols-1')
    expect(stripBlock).toContain('md:grid-cols-2')
    expect(stripBlock).toContain('xl:grid-cols-4')
    expect(stripBlock).not.toContain('grid-cols-4 gap')
  })
})

describe('GUARDIAN-3B5 server aggregation wiring', () => {
  it('aggregates KPIs on founder-only endpoints without downloading unbounded telemetry', () => {
    expect(FUNCTION).toContain('buildFounderLiveNowKpis')
    expect(FUNCTION).toContain('buildFounderAdoptionKpis')
    expect(FUNCTION).toContain('buildFounderOnboardingKpis')
    expect(FUNCTION).toContain('loadFounderActivitySessions')
    expect(FUNCTION).toContain('countSecurityEvents')
    expect(FUNCTION).toContain('countRevokedCanonicalProfiles')
    expect(SERVICE).toContain('kpis?:')
    expect(KPI_SOURCE).not.toContain('pilot_telemetry_events')
  })

  it('does not create a migration or schema change', () => {
    expect(FUNCTION).not.toContain('126_')
    expect(KPI_SOURCE).not.toContain('CREATE TABLE')
  })
})
