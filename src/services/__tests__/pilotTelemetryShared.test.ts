import { describe, expect, it } from 'vitest'
import {
  derivePilotActivationSnapshot,
  deriveWeeklyActivitySummary,
  getPilotOrganizationClassification,
  isBlueprintActiveOrganization,
  isEmployeePortalActiveOrganization,
  sanitizeTelemetryMetadata,
} from '@/services/pilotTelemetryShared'

describe('pilot telemetry shared helpers', () => {
  it('classifies design partner and customer zero org settings', () => {
    expect(getPilotOrganizationClassification({ pilot: { classification: 'design_partner' } })).toBe('design_partner')
    expect(getPilotOrganizationClassification({ pilot_classification: 'customer_zero' })).toBe('customer_zero')
  })

  it('sanitizes sensitive telemetry metadata keys and keeps sparse categorical data', () => {
    expect(sanitizeTelemetryMetadata({
      tool: 'circuit_path',
      source: 'blueprint_viewer',
      customerName: 'Blocked Customer',
      address: '123 Main',
      payload: { token: 'secret', category: 'cloud_write_failed' },
    })).toEqual({
      tool: 'circuit_path',
      source: 'blueprint_viewer',
    })
  })

  it('derives activation from the first meaningful business action', () => {
    const snapshot = derivePilotActivationSnapshot({
      organizationCreatedAt: '2026-08-01T00:00:00.000Z',
      firstProjectAt: '2026-08-01T01:00:00.000Z',
      firstEstimateAt: '2026-08-01T02:00:00.000Z',
    })
    expect(snapshot.activated).toBe(true)
    expect(snapshot.firstValueAt).toBe('2026-08-01T01:00:00.000Z')
    expect(snapshot.minutesToFirstValue).toBe(60)
  })

  it('counts only meaningful weekly activity toward active orgs and users', () => {
    const summary = deriveWeeklyActivitySummary([
      { organizationId: 'org-1', userId: 'user-1', occurredAt: '2026-08-10T12:00:00.000Z', eventName: 'blueprint_opened' },
      { organizationId: 'org-1', userId: 'user-1', occurredAt: '2026-08-10T12:05:00.000Z', eventName: 'login_success' },
      { organizationId: 'org-2', userId: 'user-2', occurredAt: '2026-08-11T12:00:00.000Z', eventName: 'work_package_created' },
    ], '2026-08-10T00:00:00.000Z', '2026-08-17T00:00:00.000Z')

    expect(summary).toEqual({
      weeklyActiveOrganizations: 2,
      weeklyActiveUsers: 2,
    })
  })

  it('requires both a real blueprint open and a meaningful blueprint action', () => {
    expect(isBlueprintActiveOrganization({
      hasBlueprintOpen: true,
      measurementCount: 0,
      circuitPathCount: 1,
      circuitArcCount: 0,
      workPackageCount: 0,
    })).toBe(true)
    expect(isBlueprintActiveOrganization({
      hasBlueprintOpen: false,
      measurementCount: 1,
      circuitPathCount: 0,
      circuitArcCount: 0,
      workPackageCount: 0,
    })).toBe(false)
  })

  it('requires accepted employees plus real portal activity for employee portal adoption', () => {
    expect(isEmployeePortalActiveOrganization({ acceptedEmployees: 1, timePunchCount: 2 })).toBe(true)
    expect(isEmployeePortalActiveOrganization({ acceptedEmployees: 1, timePunchCount: 0 })).toBe(false)
  })
})
