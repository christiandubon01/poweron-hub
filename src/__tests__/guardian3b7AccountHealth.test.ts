import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCOUNT_HEALTH_LABELS,
  ACCOUNT_HEALTH_YOUNG_ACCOUNT_DAYS,
  deriveContractorAccountHealth,
  isAccountHealthDormant,
  isYoungContractorAccount,
} from '@/services/guardianFounderAccountHealth'
import {
  buildFleetFilterContextFromAccounts,
  summarizeOrgAccess,
} from '@/services/guardianFounderFleet'
import {
  countUnreadGuardianSecurityAlerts,
  filterUnreadGuardianSecurityAlerts,
} from '@/services/guardianFounderPresence'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const SURFACE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const HEALTH = read('src/services/guardianFounderAccountHealth.ts')
const FLEET = read('src/services/guardianFounderFleet.ts')
const KPIS = read('src/services/guardianFounderKpis.ts')
const PRESENCE = read('src/services/guardianFounderPresence.ts')

const NOW = '2026-08-15T12:00:00.000Z'

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    onboardingStatus: 'complete' as const,
    accountStatus: 'active' as const,
    lastActiveAt: '2026-08-14T10:00:00.000Z',
    activeDays30: 6,
    modulesUsed30: ['home', 'projects', 'estimates', 'blueprint'],
    accessActiveCount: 2,
    accessRevokedCount: 0,
    unreadSecurityAlertCount: 0,
    ...overrides,
  }
}

describe('GUARDIAN-3B7 Account Health rules', () => {
  it('1. active + onboarded + recent activity + no unread alerts → Healthy', () => {
    const result = deriveContractorAccountHealth(baseInput(), NOW)
    expect(result.label).toBe('Healthy')
    expect(result.reasonCode).toBe('healthy')
    expect(result.explanation).toBe('Active 6 days in last 30 days · 4 modules · No security alerts')
  })

  it('2. dormant + otherwise normal → Watching', () => {
    const result = deriveContractorAccountHealth(baseInput({
      activeDays30: 0,
      lastActiveAt: '2026-07-12T00:00:00.000Z',
      modulesUsed30: [],
    }), NOW)
    expect(result.label).toBe('Watching')
    expect(result.reasonCode).toBe('dormant')
    expect(result.explanation).toBe('No activity in 34 days')
    expect(result.facts.isDormant).toBe(true)
  })

  it('3. unread security alert → Needs Attention', () => {
    const result = deriveContractorAccountHealth(baseInput({
      unreadSecurityAlertCount: 1,
    }), NOW)
    expect(result.label).toBe('Needs Attention')
    expect(result.reasonCode).toBe('unread_security_alert')
    expect(result.explanation).toBe('1 unread security alert')
  })

  it('4. all canonical users revoked → Needs Attention', () => {
    const result = deriveContractorAccountHealth(baseInput({
      accessActiveCount: 0,
      accessRevokedCount: 2,
      accountStatus: 'inactive',
      activeDays30: 3,
    }), NOW)
    expect(result.label).toBe('Needs Attention')
    expect(result.reasonCode).toBe('all_access_revoked')
    expect(result.explanation).toBe('All canonical user access revoked')
  })

  it('5. restored active account no longer Needs Attention from old revocation', () => {
    const revoked = deriveContractorAccountHealth(baseInput({
      accessActiveCount: 0,
      accessRevokedCount: 1,
      accountStatus: 'inactive',
    }), NOW)
    expect(revoked.label).toBe('Needs Attention')

    const restored = deriveContractorAccountHealth(baseInput({
      accessActiveCount: 1,
      accessRevokedCount: 0,
      accountStatus: 'active',
    }), NOW)
    expect(restored.label).toBe('Healthy')
    expect(restored.reasonCode).toBe('healthy')
  })

  it('6. historical/read security event does not force Needs Attention', () => {
    const alerts = [
      { occurredAt: '2026-08-01T00:00:00.000Z', organizationId: 'org-1' },
      { occurredAt: '2026-08-10T00:00:00.000Z', organizationId: 'org-1' },
    ]
    const lastSeenAt = '2026-08-12T00:00:00.000Z'
    const unread = filterUnreadGuardianSecurityAlerts(alerts, lastSeenAt)
    expect(unread).toHaveLength(0)
    const unreadCount = countUnreadGuardianSecurityAlerts(alerts, lastSeenAt)
    const result = deriveContractorAccountHealth(baseInput({
      unreadSecurityAlertCount: unreadCount,
    }), NOW)
    expect(result.label).toBe('Healthy')
    expect(result.reasonCode).toBe('healthy')
  })

  it('7. new account with sparse telemetry is not incorrectly penalized', () => {
    const result = deriveContractorAccountHealth(baseInput({
      createdAt: '2026-08-10T00:00:00.000Z',
      onboardingStatus: 'pending',
      activeDays30: 0,
      lastActiveAt: null,
      modulesUsed30: [],
      accessActiveCount: 1,
      accessRevokedCount: 0,
    }), NOW)
    expect(result.label).toBe('Watching')
    expect(result.reasonCode).toBe('onboarding_pending')
    expect(result.label).not.toBe('Needs Attention')
    expect(result.facts.isYoungAccount).toBe(true)
    expect(result.explanation).toContain('New account')
  })

  it('8. onboarding pending by itself follows documented Watching rule', () => {
    const result = deriveContractorAccountHealth(baseInput({
      onboardingStatus: 'pending',
      activeDays30: 4,
      modulesUsed30: ['home'],
    }), NOW)
    expect(result.label).toBe('Watching')
    expect(result.reasonCode).toBe('onboarding_pending')
    expect(result.explanation).toBe('Onboarding pending')
  })

  it('9. mixed access follows deterministic Watching rule', () => {
    const access = summarizeOrgAccess(2, 1)
    expect(access.kind).toBe('mixed')
    const result = deriveContractorAccountHealth(baseInput({
      accessActiveCount: 2,
      accessRevokedCount: 1,
    }), NOW)
    expect(result.label).toBe('Watching')
    expect(result.reasonCode).toBe('mixed_access')
    expect(result.explanation).toBe('Mixed access · 2 Active · 1 Revoked')
  })

  it('10. no module telemetry alone does not create false alarm for newly-live telemetry', () => {
    const established = deriveContractorAccountHealth(baseInput({
      modulesUsed30: [],
      activeDays30: 5,
    }), NOW)
    expect(established.label).toBe('Healthy')
    expect(established.explanation).toContain('0 modules')

    const youngSparse = deriveContractorAccountHealth(baseInput({
      createdAt: '2026-08-12T00:00:00.000Z',
      onboardingStatus: 'complete',
      activeDays30: 2,
      modulesUsed30: [],
    }), NOW)
    expect(youngSparse.label).toBe('Healthy')
    expect(youngSparse.label).not.toBe('Needs Attention')
  })

  it('11. health explanation matches actual reason', () => {
    const security = deriveContractorAccountHealth(baseInput({ unreadSecurityAlertCount: 3 }), NOW)
    expect(security.explanation).toBe('3 unread security alerts')
    expect(security.reasonCode).toBe('unread_security_alert')

    const dormant = deriveContractorAccountHealth(baseInput({
      activeDays30: 0,
      lastActiveAt: null,
    }), NOW)
    expect(dormant.explanation).toBe('No qualifying activity in 30 days')
  })

  it('12. same fixture always produces same result', () => {
    const input = baseInput({ unreadSecurityAlertCount: 1, accessRevokedCount: 0 })
    const a = deriveContractorAccountHealth(input, NOW)
    const b = deriveContractorAccountHealth(input, NOW)
    expect(a).toEqual(b)
    expect(ACCOUNT_HEALTH_LABELS).toContain(a.label)
  })
})

describe('GUARDIAN-3B7 authority consistency', () => {
  it('13. same Dormant definition as 3B5/3B6', () => {
    expect(HEALTH).toContain('Exact 3B5/3B6 dormant definition')
    expect(isAccountHealthDormant({
      onboardingStatus: 'complete',
      accountStatus: 'active',
      activeDays30: 0,
    })).toBe(true)
    expect(isAccountHealthDormant({
      onboardingStatus: 'pending',
      accountStatus: 'active',
      activeDays30: 0,
    })).toBe(false)

    const context = buildFleetFilterContextFromAccounts({
      accounts: [{
        organizationId: 'org-1',
        organizationName: 'Acme',
        ownerFullName: null,
        ownerEmail: 'a@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
        onboardingStatus: 'complete',
        classification: 'contractor',
        accountStatus: 'active',
        lastActiveAt: '2026-07-01T00:00:00.000Z',
        activeDays30: 0,
        modulesUsed30: [],
        accessActiveCount: 1,
        accessRevokedCount: 0,
      }],
      now: NOW,
    })
    expect(context.dormantOrgIds.has('org-1')).toBe(true)
    expect(KPIS).toContain('org.onboardingStatus === \'complete\'')
    expect(KPIS).toContain('org.accountStatus === \'active\'')
    expect(FLEET).toContain('(account.activeDays30 ?? 0) === 0')
  })

  it('14. same unread security authority as Security Center', () => {
    expect(HEALTH).toContain('unread security alert')
    expect(HEALTH).toContain('filterUnreadGuardianSecurityAlerts')
    expect(SURFACE).toContain('unreadAlertsByOrg.get(selectedAccount.organizationId)')
    expect(SURFACE).toContain('countUnreadAlertsByOrganization(presenceAlerts, lastSeenAt)')
    expect(PRESENCE).toContain('export function filterUnreadGuardianSecurityAlerts')
  })

  it('15. same canonical access authority as Revoke/Restore', () => {
    expect(HEALTH).toContain('summarizeOrgAccess')
    expect(deriveContractorAccountHealth(baseInput({
      accessActiveCount: 0,
      accessRevokedCount: 1,
    }), NOW).facts.access).toEqual(summarizeOrgAccess(0, 1))
    expect(SURFACE).toContain('Revoke Access')
    expect(SURFACE).toContain('Restore Access')
  })

  it('16. same onboarding authority as KPI/fleet', () => {
    expect(HEALTH).toContain("onboardingStatus: 'complete' | 'pending'")
    expect(SURFACE).toContain('onboardingStatus: selectedAccount.onboardingStatus')
    expect(FLEET).toContain("onboardingStatus: account.onboardingStatus")
  })

  it('17. same active-day/module metrics as fleet', () => {
    expect(SURFACE).toContain('activeDays30: selectedAccount.activeDays30')
    expect(SURFACE).toContain('modulesUsed30: selectedAccount.modulesUsed30')
    expect(SURFACE).toContain('lastActiveAt: selectedAccount.lastActiveAt')
    expect(HEALTH).not.toContain('0-100')
    expect(HEALTH).not.toContain('AI health')
  })
})

describe('GUARDIAN-3B7 UI contracts', () => {
  it('18. Account Health appears in contractor modal header', () => {
    expect(SURFACE).toContain('data-testid="contractor-account-health"')
    expect(SURFACE).toContain('function AccountHealthHeader')
    expect(SURFACE).toContain('selectedAccountHealth ? <AccountHealthHeader')
    const modalIdx = SURFACE.indexOf('data-testid="contractor-detail-modal"')
    const healthRenderIdx = SURFACE.indexOf('selectedAccountHealth ? <AccountHealthHeader')
    const usersIdx = SURFACE.indexOf('Users / Access', modalIdx)
    expect(modalIdx).toBeGreaterThan(-1)
    expect(healthRenderIdx).toBeGreaterThan(modalIdx)
    expect(usersIdx).toBeGreaterThan(healthRenderIdx)
  })

  it('19. label is one of Healthy / Watching / Needs Attention', () => {
    expect(ACCOUNT_HEALTH_LABELS).toEqual(['Healthy', 'Watching', 'Needs Attention'])
    expect(SURFACE).toContain('contractor-account-health-label')
    expect(HEALTH).toContain("ACCOUNT_HEALTH_LABELS = ['Healthy', 'Watching', 'Needs Attention']")
  })

  it('20. explanation is visible', () => {
    expect(SURFACE).toContain('contractor-account-health-explanation')
    expect(SURFACE).toContain('{health.explanation}')
  })

  it('21. visible facts support explanation', () => {
    expect(SURFACE).toContain('contractor-account-health-facts')
    expect(SURFACE).toContain('Last Active')
    expect(SURFACE).toContain('30D Active Days')
    expect(SURFACE).toContain('Modules Used')
    expect(SURFACE).toContain('label="Onboarding"')
    expect(SURFACE).toContain('label="Security"')
    expect(SURFACE).toContain('label="Access"')
  })

  it('22. locked 2x2 modal grid remains unchanged', () => {
    expect(SURFACE).toContain('Live Presence / Sessions')
    expect(SURFACE).toContain('Devices')
    expect(SURFACE).toContain('Recent Sessions')
    expect(SURFACE).toContain('Security History')
    expect(SURFACE).toContain('md:grid-cols-2')
    expect(SURFACE).not.toContain('Access Control History')
  })

  it('23. Users / Access remains available', () => {
    expect(SURFACE).toContain('Users / Access')
    expect(SURFACE).toContain('Canonical profile-backed users for this contractor organization.')
  })

  it('24. Revoke / Restore unchanged', () => {
    expect(SURFACE).toContain('Revoke Access')
    expect(SURFACE).toContain('Restore Access')
  })

  it('25. Security History unchanged', () => {
    const securityIdx = SURFACE.indexOf('title="Security History"')
    expect(securityIdx).toBeGreaterThan(-1)
    expect(SURFACE).toContain('No trusted public-IP security events recorded yet.')
  })

  it('26. fleet filters unchanged', () => {
    expect(SURFACE).toContain('FOUNDER_FLEET_FILTERS')
    expect(SURFACE).toContain('fleetFilterLabel')
    expect(FLEET).toContain("'dormant'")
    expect(FLEET).toContain("'security_alert'")
    expect(FLEET).toContain("'revoked'")
  })

  it('27. KPI strip unchanged', () => {
    expect(SURFACE).toContain('FounderKpiStrip')
    expect(SURFACE).toContain('Dormant Accounts')
    expect(SURFACE).toContain('unreadSecurityAlerts')
  })

  it('28. Security Center unchanged', () => {
    expect(SURFACE).toContain('data-testid="security-center-modal"')
    expect(SURFACE).toContain('buildFounderSecurityCenterMetrics')
    expect(SURFACE).toContain('filterUnreadGuardianSecurityAlerts')
  })

  it('priority: revoked beats unread; unread beats dormant; dormant beats mixed', () => {
    expect(deriveContractorAccountHealth(baseInput({
      accessActiveCount: 0,
      accessRevokedCount: 1,
      unreadSecurityAlertCount: 5,
      activeDays30: 0,
    }), NOW).reasonCode).toBe('all_access_revoked')

    expect(deriveContractorAccountHealth(baseInput({
      unreadSecurityAlertCount: 2,
      activeDays30: 0,
      accessActiveCount: 1,
      accessRevokedCount: 1,
    }), NOW).reasonCode).toBe('unread_security_alert')

    expect(deriveContractorAccountHealth(baseInput({
      activeDays30: 0,
      accessActiveCount: 2,
      accessRevokedCount: 1,
    }), NOW).reasonCode).toBe('dormant')
  })

  it('young-account helper uses documented window', () => {
    expect(ACCOUNT_HEALTH_YOUNG_ACCOUNT_DAYS).toBe(14)
    expect(isYoungContractorAccount('2026-08-10T00:00:00.000Z', NOW)).toBe(true)
    expect(isYoungContractorAccount('2026-01-01T00:00:00.000Z', NOW)).toBe(false)
  })

  it('optional fleet hint stays inside Company cell (no 11th column)', () => {
    expect(SURFACE).toContain('fleet-account-health-hint')
    expect(SURFACE).toContain("health.label !== 'Healthy'")
    expect(FLEET).toContain('FOUNDER_FLEET_COLUMN_LABELS')
    expect(FLEET.match(/FOUNDER_FLEET_COLUMN_LABELS = \[[\s\S]*?\] as const/)?.[0] || '')
      .not.toMatch(/ACCOUNT HEALTH|HEALTH/)
  })

  it('no persisted health schema / score / AI', () => {
    expect(HEALTH).not.toContain('supabase')
    expect(HEALTH).not.toContain('migration')
    expect(HEALTH).not.toMatch(/score\s*[:=]/i)
    expect(HEALTH).not.toContain('openai')
    expect(HEALTH).not.toContain('anthropic')
  })
})
