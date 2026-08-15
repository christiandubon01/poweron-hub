import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FOUNDER_FLEET_COLUMN_LABELS,
  FOUNDER_FLEET_FILTERS,
  buildFleetAccessCountsFromProfiles,
  buildFleetFilterContext,
  buildFleetFilterContextFromAccounts,
  buildFounderFleetOrgMetrics,
  buildFounderFleetRows,
  collectActiveDaysByOrganization,
  collectModulesUsedByOrganization,
  countOrgActiveDays30,
  countOrganizationsMatchingFleetFilter,
  countUnreadAlertsByOrganization,
  filterFounderFleetRows,
  fleetFilterLabel,
  formatFleetLastActiveLabel,
  formatModulesUsedLabel,
  formatSecurityAlertLabel,
  normalizeFleetPresenceStatus,
  pickOrganizationPresenceStatus,
  resolveOrgLastActiveAt,
  sortFounderFleetRows,
  summarizeOrgAccess,
} from '@/services/guardianFounderFleet'
import {
  buildFounderAdoptionKpis,
  buildFounderLiveNowKpis,
  buildFounderOnboardingKpis,
} from '@/services/guardianFounderKpis'
import {
  buildFounderPresenceSummary,
  buildFounderSecurityAlerts,
  countUnreadGuardianSecurityAlerts,
} from '@/services/guardianFounderPresence'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const FLEET = read('src/services/guardianFounderFleet.ts')
const FUNCTION = read('netlify/functions/pilot-telemetry.ts')
const SERVICE = read('src/services/founderContractorAdminService.ts')

const SERVER_NOW = '2026-08-15T12:00:00.000Z'
const WINDOW_30 = '2026-07-16T12:00:00.000Z'

function session(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session-1',
    user_id: 'user-1',
    org_id: 'org-1',
    device_id: 'device-1',
    device_type: 'web',
    device_info: {},
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

describe('GUARDIAN-3B6 per-org metrics', () => {
  it('1. org presence priority Active > Idle > Locked > Offline', () => {
    expect(pickOrganizationPresenceStatus(['offline', 'locked', 'idle', 'active'])).toBe('active')
    expect(pickOrganizationPresenceStatus(['locked', 'offline'])).toBe('locked')
    expect(normalizeFleetPresenceStatus('no_history')).toBe('offline')
  })

  it('2-3. last active uses qualifying activity; heartbeat alone cannot fabricate it', () => {
    const last = resolveOrgLastActiveAt([
      {
        org_id: 'org-1',
        session_id: 's1',
        started_at: '2026-08-10T00:00:00.000Z',
        last_interaction_at: '2026-08-12T00:00:00.000Z',
      },
    ], 'org-1')
    expect(last).toBe('2026-08-12T00:00:00.000Z')
    expect(FLEET).toContain('Heartbeat (last_active_at) alone')
    expect(formatFleetLastActiveLabel(null, SERVER_NOW)).toBe('No activity')
  })

  it('4-6. activeDays30 distinct days; same day once; outside 30D excluded', () => {
    const sessions = [
      {
        org_id: 'org-1',
        session_id: 'a',
        started_at: '2026-08-14T01:00:00.000Z',
        last_interaction_at: '2026-08-14T03:00:00.000Z',
      },
      {
        org_id: 'org-1',
        session_id: 'b',
        started_at: '2026-08-14T20:00:00.000Z',
        last_interaction_at: '2026-08-14T21:00:00.000Z',
      },
      {
        org_id: 'org-1',
        session_id: 'c',
        started_at: '2026-08-01T00:00:00.000Z',
        last_interaction_at: '2026-08-01T00:00:00.000Z',
      },
      {
        org_id: 'org-1',
        session_id: 'old',
        started_at: '2026-07-01T00:00:00.000Z',
        last_interaction_at: '2026-07-01T00:00:00.000Z',
      },
    ]
    expect(countOrgActiveDays30(sessions, 'org-1', WINDOW_30)).toBe(2)
    expect(collectActiveDaysByOrganization(sessions, WINDOW_30).get('org-1')).toBe(2)
  })

  it('7-10. Modules Used from module_entered only; deduped; no engagement_window; no pre-telemetry invent', () => {
    const modules = collectModulesUsedByOrganization([
      { organization_id: 'org-1', event_name: 'module_entered', module: 'projects' },
      { organization_id: 'org-1', event_name: 'module_entered', module: 'projects' },
      { organization_id: 'org-1', event_name: 'module_entered', module: 'blueprint' },
      { organization_id: 'org-1', event_name: 'engagement_window', module: 'estimates' },
      { organization_id: 'org-1', event_name: 'module_entered', module: '/projects/secret' },
    ])
    expect(modules.get('org-1')).toEqual(['projects', 'blueprint'])
    expect(formatModulesUsedLabel([])).toBe('No module data')
    expect(formatModulesUsedLabel(['projects', 'blueprint', 'estimates', 'home', 'settings'])).toContain('+2')
  })

  it('11-12. onboarding/classification preserve existing authorities', () => {
    expect(SERVICE).toContain("onboardingStatus: 'complete' | 'pending'")
    expect(SURFACE).toContain('row.onboardingStatus')
    expect(SURFACE).toContain('row.classification')
  })

  it('13-14. security unread alert-worthy only; known-device excluded', () => {
    const alerts = buildFounderSecurityAlerts([
      securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
      securityEvent({
        event_type: 'ip_changed',
        occurred_at: '2026-08-15T11:59:00.000Z',
        previous_public_ip: '203.0.113.9',
      }),
      securityEvent({ is_new_device: false, occurred_at: '2026-08-15T11:58:00.000Z' }),
    ], { 'org-1': 'Alpha' })
    expect(alerts).toHaveLength(2)
    expect(countUnreadGuardianSecurityAlerts(alerts, '2026-08-15T11:50:00.000Z')).toBe(2)
    expect(formatSecurityAlertLabel(0)).toBe('Clear')
    expect(formatSecurityAlertLabel(1)).toBe('1 Alert')
    expect(formatSecurityAlertLabel(2)).toBe('2 Alerts')
  })

  it('15-18. access counts from canonical profiles; employee-only excluded; mixed truthful', () => {
    const access = buildFleetAccessCountsFromProfiles([
      { org_id: 'org-1', is_active: true },
      { org_id: 'org-1', is_active: true },
      { org_id: 'org-1', is_active: false },
      { org_id: 'org-2', is_active: false },
    ], ['org-1', 'org-2', 'org-3'])
    expect(access.get('org-1')).toEqual({ activeCount: 2, revokedCount: 1 })
    expect(access.get('org-2')).toEqual({ activeCount: 0, revokedCount: 1 })
    expect(access.get('org-3')).toEqual({ activeCount: 0, revokedCount: 0 })
    expect(summarizeOrgAccess(2, 1).label).toBe('2 Active · 1 Revoked')
    expect(summarizeOrgAccess(1, 0).kind).toBe('active')
    expect(summarizeOrgAccess(0, 1).kind).toBe('revoked')
  })
})

describe('GUARDIAN-3B6 filters', () => {
  const accounts = [
    {
      organizationId: 'org-live',
      organizationName: 'Live Co',
      ownerFullName: 'A',
      ownerEmail: 'a@x.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      onboardingStatus: 'complete' as const,
      classification: 'normal',
      accountStatus: 'active' as const,
      lastActiveAt: '2026-08-14T00:00:00.000Z',
      activeDays30: 3,
      modulesUsed30: ['projects'],
      accessActiveCount: 1,
      accessRevokedCount: 0,
    },
    {
      organizationId: 'org-locked',
      organizationName: 'Locked Co',
      ownerFullName: 'B',
      ownerEmail: 'b@x.com',
      createdAt: '2026-01-02T00:00:00.000Z',
      onboardingStatus: 'complete' as const,
      classification: 'normal',
      accountStatus: 'active' as const,
      lastActiveAt: '2026-08-10T00:00:00.000Z',
      activeDays30: 1,
      modulesUsed30: [],
      accessActiveCount: 1,
      accessRevokedCount: 0,
    },
    {
      organizationId: 'org-dormant',
      organizationName: 'Dormant Co',
      ownerFullName: 'C',
      ownerEmail: 'c@x.com',
      createdAt: '2026-01-03T00:00:00.000Z',
      onboardingStatus: 'complete' as const,
      classification: 'design_partner',
      accountStatus: 'active' as const,
      lastActiveAt: null,
      activeDays30: 0,
      modulesUsed30: [],
      accessActiveCount: 1,
      accessRevokedCount: 0,
    },
    {
      organizationId: 'org-pending',
      organizationName: 'Pending Co',
      ownerFullName: 'D',
      ownerEmail: 'd@x.com',
      createdAt: '2026-08-01T00:00:00.000Z',
      onboardingStatus: 'pending' as const,
      classification: 'normal',
      accountStatus: 'active' as const,
      lastActiveAt: null,
      activeDays30: 0,
      modulesUsed30: [],
      accessActiveCount: 1,
      accessRevokedCount: 0,
    },
    {
      organizationId: 'org-revoked',
      organizationName: 'Revoked Co',
      ownerFullName: 'E',
      ownerEmail: 'e@x.com',
      createdAt: '2026-01-05T00:00:00.000Z',
      onboardingStatus: 'complete' as const,
      classification: 'normal',
      accountStatus: 'inactive' as const,
      lastActiveAt: '2026-08-13T00:00:00.000Z',
      activeDays30: 2,
      modulesUsed30: ['home'],
      accessActiveCount: 0,
      accessRevokedCount: 1,
    },
  ]

  const rows = buildFounderFleetRows({
    accounts,
    presenceByOrg: {
      'org-live': { organizationId: 'org-live', status: 'active' },
      'org-locked': { organizationId: 'org-locked', status: 'locked' },
      'org-dormant': { organizationId: 'org-dormant', status: 'offline' },
      'org-pending': { organizationId: 'org-pending', status: 'offline' },
      'org-revoked': { organizationId: 'org-revoked', status: 'idle' },
    },
    unreadAlertsByOrg: {
      'org-live': 2,
      'org-locked': 0,
      'org-dormant': 0,
      'org-pending': 0,
      'org-revoked': 0,
    },
    now: SERVER_NOW,
  })

  const context = buildFleetFilterContextFromAccounts({ accounts, now: SERVER_NOW })

  it('19. ALL returns full contractor fleet', () => {
    expect(filterFounderFleetRows(rows, 'all', context)).toHaveLength(5)
  })

  it('20-22. ACTIVE NOW uses Active|Idle only; Locked/Offline excluded', () => {
    const activeNow = filterFounderFleetRows(rows, 'active_now', context)
    expect(activeNow.map((row) => row.organizationId).sort()).toEqual(['org-live', 'org-revoked'])
  })

  it('23-25. ACTIVE 7D / DORMANT / PENDING SETUP match 3B5-style authorities', () => {
    expect(filterFounderFleetRows(rows, 'active_7d', context).map((r) => r.organizationId).sort())
      .toEqual(['org-live', 'org-locked', 'org-revoked'])
    expect(filterFounderFleetRows(rows, 'dormant', context).map((r) => r.organizationId))
      .toEqual(['org-dormant'])
    expect(filterFounderFleetRows(rows, 'pending_setup', context).map((r) => r.organizationId))
      .toEqual(['org-pending'])
  })

  it('26-27. SECURITY ALERT and REVOKED filters', () => {
    expect(filterFounderFleetRows(rows, 'security_alert', context).map((r) => r.organizationId))
      .toEqual(['org-live'])
    expect(filterFounderFleetRows(rows, 'revoked', context).map((r) => r.organizationId))
      .toEqual(['org-revoked'])
  })

  it('28. filter state survives silent refresh (state held in React)', () => {
    expect(SURFACE).toContain("useState<FounderFleetFilter>('all')")
    expect(SURFACE).toContain('setFleetFilter(filterId)')
    expect(SURFACE).not.toContain("setFleetFilter('all')")
  })

  it('29. empty filter state renders correctly', () => {
    expect(SURFACE).toContain('No contractor accounts match this filter.')
    expect(SURFACE).toContain('data-testid="founder-fleet-empty-filter"')
  })
})

describe('GUARDIAN-3B6 KPI/filter consistency', () => {
  it('30-33. Active Now / Active 7D / Dormant / Pending Setup agree with KPI on identical fixture', () => {
    const presenceSessions = [
      session({ session_id: 's1', org_id: 'org-a', user_id: 'u1' }),
      session({ session_id: 's2', org_id: 'org-a', user_id: 'u2', device_id: 'd2' }),
      session({
        session_id: 's3',
        org_id: 'org-b',
        user_id: 'u3',
        device_id: 'd3',
        ended_reason: 'manual_lock',
        ended_at: '2026-08-15T11:59:00.000Z',
      }),
    ]
    const liveNow = buildFounderLiveNowKpis(presenceSessions, SERVER_NOW)
    const summaries = buildFounderPresenceSummary(presenceSessions, ['org-a', 'org-b', 'org-c'], SERVER_NOW)
    const accounts = [
      {
        organizationId: 'org-a',
        organizationName: 'A',
        ownerFullName: null,
        ownerEmail: 'a@x.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        onboardingStatus: 'complete' as const,
        classification: 'normal',
        accountStatus: 'active' as const,
        lastActiveAt: '2026-08-14T00:00:00.000Z',
        activeDays30: 2,
        modulesUsed30: [],
        accessActiveCount: 1,
        accessRevokedCount: 0,
      },
      {
        organizationId: 'org-b',
        organizationName: 'B',
        ownerFullName: null,
        ownerEmail: 'b@x.com',
        createdAt: '2026-01-02T00:00:00.000Z',
        onboardingStatus: 'complete' as const,
        classification: 'normal',
        accountStatus: 'active' as const,
        lastActiveAt: null,
        activeDays30: 0,
        modulesUsed30: [],
        accessActiveCount: 1,
        accessRevokedCount: 0,
      },
      {
        organizationId: 'org-c',
        organizationName: 'C',
        ownerFullName: null,
        ownerEmail: 'c@x.com',
        createdAt: '2026-08-01T00:00:00.000Z',
        onboardingStatus: 'pending' as const,
        classification: 'normal',
        accountStatus: 'active' as const,
        lastActiveAt: null,
        activeDays30: 0,
        modulesUsed30: [],
        accessActiveCount: 1,
        accessRevokedCount: 0,
      },
    ]

    const activitySessions = [
      {
        org_id: 'org-a',
        session_id: 'act-1',
        started_at: '2026-08-14T00:00:00.000Z',
        last_interaction_at: '2026-08-14T00:00:00.000Z',
      },
    ]
    const adoption = buildFounderAdoptionKpis({
      organizations: accounts.map((a) => ({
        organizationId: a.organizationId,
        createdAt: a.createdAt,
        classification: a.classification,
        onboardingStatus: a.onboardingStatus,
        accountStatus: a.accountStatus,
      })),
      activitySessions,
      now: SERVER_NOW,
    })
    const onboarding = buildFounderOnboardingKpis({
      organizations: accounts,
      invites: [],
    })

    const rows = buildFounderFleetRows({
      accounts,
      presenceByOrg: {
        'org-a': { organizationId: 'org-a', status: summaries['org-a'].status },
        'org-b': { organizationId: 'org-b', status: summaries['org-b'].status },
        'org-c': { organizationId: 'org-c', status: summaries['org-c'].status },
      },
      unreadAlertsByOrg: {},
      now: SERVER_NOW,
    })
    const context = buildFleetFilterContext({
      accounts,
      activitySessions,
      now: SERVER_NOW,
    })

    expect(countOrganizationsMatchingFleetFilter(rows, 'active_now', context)).toBe(liveNow.organizationsActiveNow)
    expect(countOrganizationsMatchingFleetFilter(rows, 'active_7d', context)).toBe(adoption.activeOrgs7d)
    expect(countOrganizationsMatchingFleetFilter(rows, 'dormant', context)).toBe(adoption.dormantAccounts)
    expect(countOrganizationsMatchingFleetFilter(rows, 'pending_setup', context)).toBe(onboarding.pendingSetup)
  })

  it('34. Security Alert ORGANIZATION count ≠ Unread EVENT count when one org has multiple alerts', () => {
    const alerts = buildFounderSecurityAlerts([
      securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
      securityEvent({
        event_type: 'ip_changed',
        occurred_at: '2026-08-15T11:59:00.000Z',
        previous_public_ip: '203.0.113.9',
      }),
    ], { 'org-1': 'Alpha' })
    const eventCount = countUnreadGuardianSecurityAlerts(alerts, null)
    const orgCount = countUnreadAlertsByOrganization(alerts, null).size
    expect(eventCount).toBe(2)
    expect(orgCount).toBe(1)
    expect(eventCount).not.toBe(orgCount)
  })

  it('35. Revoked ORGANIZATION count ≠ Revoked Users USER count', () => {
    const access = buildFleetAccessCountsFromProfiles([
      { org_id: 'org-1', is_active: false },
      { org_id: 'org-1', is_active: false },
      { org_id: 'org-2', is_active: false },
    ], ['org-1', 'org-2'])
    const revokedOrgs = [...access.values()].filter((entry) => entry.revokedCount > 0).length
    const revokedUsers = [...access.values()].reduce((sum, entry) => sum + entry.revokedCount, 0)
    expect(revokedOrgs).toBe(2)
    expect(revokedUsers).toBe(3)
    expect(revokedOrgs).not.toBe(revokedUsers)
  })
})

describe('GUARDIAN-3B6 UI contracts', () => {
  it('36. KPI strip remains above fleet', () => {
    const strip = SURFACE.indexOf('data-testid="founder-kpi-strip"')
    const filters = SURFACE.indexOf('data-testid="founder-fleet-filter-bar"')
    const table = SURFACE.indexOf('data-testid="founder-fleet-table"')
    expect(strip).toBeGreaterThan(-1)
    expect(filters).toBeGreaterThan(strip)
    expect(table).toBeGreaterThan(filters)
  })

  it('37. target fleet labels exist', () => {
    expect([...FOUNDER_FLEET_COLUMN_LABELS]).toEqual([
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
    ])
    expect(SURFACE).toContain('FOUNDER_FLEET_COLUMN_LABELS')
    expect(FLEET).toContain("'COMPANY'")
    expect(FLEET).toContain("'ACCESS'")
  })

  it('38-39. CREATED and NDA STATE no longer consume primary fleet space', () => {
    const fleetBlock = SURFACE.slice(
      SURFACE.indexOf('data-testid="founder-fleet-table"'),
      SURFACE.indexOf('data-testid="founder-fleet-mobile"'),
    )
    expect(fleetBlock).not.toContain("'Created'")
    expect(fleetBlock).not.toContain("'NDA State'")
    expect(fleetBlock).not.toContain('Account Status')
  })

  it('40. filter controls exist', () => {
    expect(SURFACE).toContain('FOUNDER_FLEET_FILTERS')
    expect(SURFACE).toContain('fleetFilterLabel(filterId)')
    expect(FOUNDER_FLEET_FILTERS.map(fleetFilterLabel)).toEqual([
      'ALL',
      'ACTIVE NOW',
      'ACTIVE 7D',
      'DORMANT',
      'PENDING SETUP',
      'SECURITY ALERT',
      'REVOKED',
    ])
  })

  it('41-43. row opens contractor modal; Security Center; Revoke/Restore in modal', () => {
    expect(SURFACE).toContain('setSelectedOrganizationId(row.organizationId)')
    expect(SURFACE).toContain('data-testid="contractor-detail-modal"')
    expect(SURFACE).toContain('openSecurityCenter()')
    expect(SURFACE).toContain('data-testid="security-center-modal"')
    expect(SURFACE).toMatch(/Revoke|Restore/)
  })

  it('44. no destructive fleet action added', () => {
    const fleetBlock = SURFACE.slice(
      SURFACE.indexOf('data-testid="founder-fleet-filter-bar"'),
      SURFACE.indexOf('data-testid="security-center-modal"'),
    )
    expect(fleetBlock).not.toContain('revokeFounderUserAccess')
    expect(fleetBlock).not.toContain('Restore PowerOn Hub access')
  })

  it('45. narrow layout avoids forced 10-column overflow', () => {
    expect(SURFACE).toContain('data-testid="founder-fleet-mobile"')
    expect(SURFACE).toContain('md:hidden')
    expect(SURFACE).toContain('hidden md:block')
  })
})

describe('GUARDIAN-3B6 server wiring', () => {
  it('aggregates fleet metrics without N+1 and without schema changes', () => {
    expect(FUNCTION).toContain('loadFounderModuleEnteredEvents')
    expect(FUNCTION).toContain("event_name', 'module_entered'")
    expect(FUNCTION).toContain('buildFounderFleetOrgMetrics')
    expect(FUNCTION).toContain('activeDays30')
    expect(FUNCTION).toContain('modulesUsed30')
    expect(FUNCTION).not.toContain('126_')
    expect(FLEET).not.toContain('CREATE TABLE')
  })

  it('sorts with attention-first deterministic order', () => {
    const sorted = sortFounderFleetRows([
      {
        organizationId: 'offline',
        organizationName: 'Z',
        ownerFullName: null,
        ownerEmail: '',
        presence: 'offline',
        lastActiveAt: null,
        lastActiveLabel: 'No activity',
        activeDays30: 0,
        modulesUsed30: [],
        modulesUsedLabel: 'No module data',
        onboardingStatus: 'complete',
        classification: 'normal',
        unreadSecurityAlertCount: 0,
        securityLabel: 'Clear',
        access: { kind: 'active', label: 'Active', activeCount: 1, revokedCount: 0 },
        classificationExcludedFromAdoption: false,
      },
      {
        organizationId: 'alert',
        organizationName: 'A',
        ownerFullName: null,
        ownerEmail: '',
        presence: 'idle',
        lastActiveAt: '2026-08-14T00:00:00.000Z',
        lastActiveLabel: 'Yesterday',
        activeDays30: 1,
        modulesUsed30: [],
        modulesUsedLabel: 'No module data',
        onboardingStatus: 'complete',
        classification: 'normal',
        unreadSecurityAlertCount: 1,
        securityLabel: '1 Alert',
        access: { kind: 'active', label: 'Active', activeCount: 1, revokedCount: 0 },
        classificationExcludedFromAdoption: false,
      },
      {
        organizationId: 'active',
        organizationName: 'B',
        ownerFullName: null,
        ownerEmail: '',
        presence: 'active',
        lastActiveAt: '2026-08-15T11:00:00.000Z',
        lastActiveLabel: 'Now',
        activeDays30: 1,
        modulesUsed30: [],
        modulesUsedLabel: 'No module data',
        onboardingStatus: 'complete',
        classification: 'normal',
        unreadSecurityAlertCount: 0,
        securityLabel: 'Clear',
        access: { kind: 'active', label: 'Active', activeCount: 1, revokedCount: 0 },
        classificationExcludedFromAdoption: false,
      },
    ])
    expect(sorted.map((row) => row.organizationId)).toEqual(['active', 'alert', 'offline'])
  })
})
