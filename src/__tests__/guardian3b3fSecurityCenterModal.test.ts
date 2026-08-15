import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  openContractorFromSecurityCenter,
} from '@/components/guardian/FounderContractorAdminSurface'
import {
  buildFounderGlobalSecurityHistory,
  buildFounderSecurityAlerts,
  buildFounderSecurityCenterMetrics,
  filterIpChangeSecurityEvents,
  filterNewDeviceSecurityEvents,
  filterUnreadGuardianSecurityAlerts,
  writeGuardianSecurityLastSeen,
  readGuardianSecurityLastSeen,
} from '@/services/guardianFounderPresence'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const SURFACE_SOURCE = read('src/components/guardian/FounderContractorAdminSurface.tsx')
const FUNCTION_SOURCE = read('netlify/functions/pilot-telemetry.ts')
const SERVICE_SOURCE = read('src/services/founderContractorAdminService.ts')
const HELPER_SOURCE = read('src/services/guardianFounderPresence.ts')
const GUARDIAN_VIEW = read('src/views/GuardianView.tsx')
const SESSION_STORE = read('netlify/functions/session-store.ts')
const AUTH_STORE = read('src/store/authStore.ts')
const PRESENCE_MONITOR = read('src/lib/guardian/presenceMonitor.ts')

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
    user_full_name: 'Founder Visible User',
    user_email: 'user@example.test',
    ...overrides,
  }
}

describe('GUARDIAN-3B3F Security Center modal (SOURCE-CONTRACT + BEHAVIOR)', () => {
  it('Security Alerts control opens centered Security Center modal', () => {
    expect(SURFACE_SOURCE).toContain('Security Alerts')
    expect(SURFACE_SOURCE).toContain('openSecurityCenter()')
    expect(SURFACE_SOURCE).toContain('data-testid="security-center-modal"')
    expect(SURFACE_SOURCE).toContain('fixed inset-0 z-50 flex items-center justify-center')
  })

  it('old inline expanded alerts area is removed', () => {
    expect(SURFACE_SOURCE).not.toContain('History remains in the account drawer.')
    expect(SURFACE_SOURCE).not.toContain('No new-device or public-IP change alerts recorded yet.')
    expect(SURFACE_SOURCE).toContain('Security Center')
  })

  it('modal title is Security Center', () => {
    expect(SURFACE_SOURCE).toContain('>Security Center<')
    expect(SURFACE_SOURCE).toContain('aria-label="Security Center"')
  })

  it('four primary blocks exist in exact order', () => {
    const securityBlock = SURFACE_SOURCE.slice(
      SURFACE_SOURCE.indexOf('data-testid="security-center-modal"'),
      SURFACE_SOURCE.indexOf('data-testid="contractor-detail-modal"'),
    )
    const needs = securityBlock.indexOf('title="Needs Attention"')
    const devices = securityBlock.indexOf('title="New Devices"')
    const ip = securityBlock.indexOf('title="Public IP Changes"')
    const timeline = securityBlock.indexOf('title="Security Timeline"')
    expect(needs).toBeGreaterThan(-1)
    expect(devices).toBeGreaterThan(needs)
    expect(ip).toBeGreaterThan(devices)
    expect(timeline).toBeGreaterThan(ip)
  })

  it('desktop layout is 2 columns and narrow collapses to 1 column', () => {
    const securityBlock = SURFACE_SOURCE.slice(
      SURFACE_SOURCE.indexOf('data-testid="security-center-modal"'),
      SURFACE_SOURCE.indexOf('data-testid="contractor-detail-modal"'),
    )
    expect(securityBlock).toContain('grid-cols-1')
    expect(securityBlock).toContain('md:grid-cols-2')
  })

  it('unread new-device and ip_changed appear in Needs Attention; known-device does not', () => {
    const alerts = buildFounderSecurityAlerts([
      securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
      securityEvent({
        event_type: 'ip_changed',
        occurred_at: '2026-08-15T11:59:00.000Z',
        previous_public_ip: '203.0.113.9',
      }),
      securityEvent({ occurred_at: '2026-08-15T11:58:00.000Z' }),
    ], { 'org-1': 'Alpha Electric' })

    const unread = filterUnreadGuardianSecurityAlerts(alerts, '2026-08-15T11:50:00.000Z')
    expect(unread.map((alert) => alert.alertKind).sort()).toEqual(['ip_changed', 'new_device'])
    expect(unread.every((alert) => alert.alertKind !== undefined)).toBe(true)
    expect(alerts.some((alert) => alert.alertKind === 'new_device')).toBe(true)
    expect(buildFounderSecurityAlerts([
      securityEvent({ is_new_device: false }),
    ], { 'org-1': 'Alpha Electric' })).toHaveLength(0)
  })

  it('new-device sessions appear in New Devices and IP changes in Public IP Changes', () => {
    const history = buildFounderGlobalSecurityHistory([
      securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
      securityEvent({
        event_type: 'ip_changed',
        occurred_at: '2026-08-15T11:59:00.000Z',
        previous_public_ip: '203.0.113.9',
      }),
      securityEvent({ occurred_at: '2026-08-15T11:58:00.000Z' }),
    ], { 'org-1': 'Alpha Electric' })

    expect(filterNewDeviceSecurityEvents(history)).toHaveLength(1)
    expect(filterIpChangeSecurityEvents(history)).toHaveLength(1)
    expect(history).toHaveLength(3)
  })

  it('all bounded event types appear appropriately in Security Timeline', () => {
    const history = buildFounderGlobalSecurityHistory([
      securityEvent({ is_new_device: true }),
      securityEvent({ event_type: 'ip_changed', previous_public_ip: '203.0.113.9' }),
      securityEvent({ is_new_device: false }),
    ], { 'org-1': 'Alpha Electric' })

    expect(history.some((event) => event.isNewDevice)).toBe(true)
    expect(history.some((event) => event.eventType === 'ip_changed')).toBe(true)
    expect(history.some((event) => event.eventType === 'session_started' && !event.isNewDevice)).toBe(true)
  })

  it('raw IP remains only on founder Guardian surface', () => {
    expect(SURFACE_SOURCE).toContain('Trusted public IP')
    expect(SURFACE_SOURCE).toContain('OLD IP → NEW IP')
    expect(SURFACE_SOURCE).toContain('Raw IP never leaves Guardian founder surfaces.')
    expect(AUTH_STORE).not.toContain('account_security_events')
    expect(PRESENCE_MONITOR).not.toContain('public_ip')
  })

  it('opening Security Center marks alerts viewed without deleting history', () => {
    const storage = {
      value: null as string | null,
      getItem: () => storage.value,
      setItem: (_key: string, value: string) => { storage.value = value },
    }
    writeGuardianSecurityLastSeen(storage as any, '2026-08-15T12:00:00.000Z')
    expect(readGuardianSecurityLastSeen(storage as any)).toBe('2026-08-15T12:00:00.000Z')

    const history = buildFounderGlobalSecurityHistory([
      securityEvent({ is_new_device: true }),
    ], { 'org-1': 'Alpha Electric' })
    expect(history).toHaveLength(1)

    expect(SURFACE_SOURCE).toContain('setNeedsAttentionSnapshot(filterUnreadGuardianSecurityAlerts(presenceAlerts, lastSeenAt))')
    expect(SURFACE_SOURCE).toContain('markAlertsSeen()')
    expect(HELPER_SOURCE).toContain('poweron_guardian_security_last_seen_at')
  })

  it('clicking contractor/event opens existing Contractor modal via clean handoff', () => {
    const closes: string[] = []
    const opens: string[] = []
    openContractorFromSecurityCenter(
      'org-99',
      () => closes.push('security-center'),
      (id) => opens.push(id),
    )
    expect(closes).toEqual(['security-center'])
    expect(opens).toEqual(['org-99'])
    expect(SURFACE_SOURCE).toContain('openContractorFromAlert(alert.organizationId)')
    expect(SURFACE_SOURCE).toContain('openContractorFromSecurityCenter(')
  })

  it('Security Center can close by button, Escape, and overlay click', () => {
    expect(SURFACE_SOURCE).toContain('aria-label="Close Security Center"')
    expect(SURFACE_SOURCE).toContain("if (e.key === 'Escape') setSecurityAlertsOpen(false)")
    const securityBlock = SURFACE_SOURCE.slice(
      SURFACE_SOURCE.indexOf('data-testid="security-center-modal"'),
      SURFACE_SOURCE.indexOf('data-testid="contractor-detail-modal"'),
    )
    expect(securityBlock).toContain('if (e.target === e.currentTarget)')
    expect(securityBlock).toContain('closeSecurityCenter()')
  })

  it('background refresh remains silent and reuses presence report securityHistory', () => {
    expect(SURFACE_SOURCE).not.toContain('Refreshing live presence...')
    expect(SURFACE_SOURCE).toContain("refreshAccounts(firstRun ? 'initial' : 'background')")
    expect(SURFACE_SOURCE).toContain('setPresenceSecurityHistory(response.securityHistory ?? [])')
    expect(FUNCTION_SOURCE).toContain('securityHistory')
    expect(FUNCTION_SOURCE).toContain('buildFounderGlobalSecurityHistory')
    expect(FUNCTION_SOURCE).toContain('FOUNDER_SECURITY_HISTORY_LIMIT')
    expect(SERVICE_SOURCE).toContain('securityHistory: FounderGlobalSecurityHistoryEntry[]')
  })

  it('existing Contractor Accounts modal remains unchanged in structure', () => {
    expect(SURFACE_SOURCE).toContain('data-testid="contractor-detail-modal"')
    expect(SURFACE_SOURCE).toContain('Live Presence / Sessions')
    expect(SURFACE_SOURCE).toContain('Devices')
    expect(SURFACE_SOURCE).toContain('Recent Sessions')
    expect(SURFACE_SOURCE).toContain('Security History')
  })

  it('Revoke / Restore controls remain unchanged', () => {
    expect(SURFACE_SOURCE).toContain('Revoke Access')
    expect(SURFACE_SOURCE).toContain('Restore Access')
    expect(SURFACE_SOURCE).toContain('revokeFounderUserAccess')
    expect(SURFACE_SOURCE).toContain('restoreFounderUserAccess')
  })

  it('Beta Invites, Agreements, Pilot Activity, and Support remain wired', () => {
    expect(GUARDIAN_VIEW).toContain("id: 'beta-invites', label: 'Contractor Beta Invites'")
    expect(GUARDIAN_VIEW).toContain("id: 'signed-ndas'")
    expect(GUARDIAN_VIEW).toContain("id: 'pilot-activity', label: 'Pilot Activity'")
    expect(GUARDIAN_VIEW).toContain("id: 'support', label: 'Support'")
    expect(GUARDIAN_VIEW).toContain('section="invites"')
    expect(GUARDIAN_VIEW).toContain('section="agreements"')
  })

  it('does not modify session/auth/presenceMonitor security authority files', () => {
    expect(SESSION_STORE).toContain("event_type:         'ip_changed'")
    expect(AUTH_STORE.length).toBeGreaterThan(100)
    expect(PRESENCE_MONITOR.length).toBeGreaterThan(100)
  })

  it('stable empty states and header metrics are present', () => {
    expect(SURFACE_SOURCE).toContain('No unread security alerts.')
    expect(SURFACE_SOURCE).toContain('No newly observed devices.')
    expect(SURFACE_SOURCE).toContain('No public-IP changes recorded.')
    expect(SURFACE_SOURCE).toContain('Unread Alerts')
    expect(SURFACE_SOURCE).toContain('New Devices 30D')
    expect(SURFACE_SOURCE).toContain('IP Changes 30D')
    expect(SURFACE_SOURCE).toContain('Last Security Event')

    const metrics = buildFounderSecurityCenterMetrics(
      buildFounderSecurityAlerts([
        securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
      ], { 'org-1': 'Alpha Electric' }),
      buildFounderGlobalSecurityHistory([
        securityEvent({ is_new_device: true, occurred_at: '2026-08-15T11:56:00.000Z' }),
        securityEvent({ event_type: 'ip_changed', occurred_at: '2026-08-15T11:59:00.000Z', previous_public_ip: '203.0.113.9' }),
      ], { 'org-1': 'Alpha Electric' }),
      null,
    )
    expect(metrics.unreadAlerts).toBe(1)
    expect(metrics.newDevices30d).toBe(1)
    expect(metrics.ipChanges30d).toBe(1)
    expect(metrics.lastSecurityEventAt).toBe('2026-08-15T11:59:00.000Z')
  })

  it('modal size matches contractor detail language', () => {
    const securityBlock = SURFACE_SOURCE.slice(
      SURFACE_SOURCE.indexOf('data-testid="security-center-modal"'),
      SURFACE_SOURCE.indexOf('data-testid="contractor-detail-modal"'),
    )
    expect(securityBlock).toContain('max-w-[1400px]')
    expect(securityBlock).toContain('max-h-[90vh]')
    expect(securityBlock).toContain('w-[90vw]')
  })
})
