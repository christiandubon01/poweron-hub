import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: new Proxy({} as any, { get: () => (() => ({})) }),
}))

import {
  buildUnifiedDirectory,
  type CostModelEmployeeInput,
  type PortalProfileInput,
} from '@/features/employee-directory/unifyDirectory'
import {
  selectUnlinkedPortalCandidates,
  derivePortalLinkStatus,
} from '@/services/adminTimecardService'

function cm(partial: Partial<CostModelEmployeeInput> & { id: string; name: string }): CostModelEmployeeInput {
  return { email: null, classification: null, ...partial }
}

function portal(partial: Partial<PortalProfileInput> & { id: string; display_name: string }): PortalProfileInput {
  return {
    email: null,
    active: true,
    user_id: null,
    backup_employee_id: null,
    employee_role: null,
    employment_type: null,
    ...partial,
  }
}

describe('EMP-ADMIN-1 canonical employee identity', () => {
  it('backup-only employee appears once as a pending canonical person', () => {
    const rows = buildUnifiedDirectory([cm({ id: 'emp-a', name: 'Alex' })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].canonicalStatus).toBe('pending')
    expect(rows[0].kind).toBe('cost_model_only')
  })

  it('same employee plus linked portal profile still renders once', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-b', name: 'Blair' })],
      [portal({ id: 'pp-b', display_name: 'Blair', backup_employee_id: 'emp-b', user_id: 'auth-b' })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].stableLink).toBe(true)
    expect(rows[0].canonicalStatus).toBe('active')
  })

  it('same-org duplicate pending email attempts collapse into one canonical row and report the duplicate', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-c', name: 'Casey', email: 'casey@poweron.test' })],
      [
        portal({ id: 'pp-c1', display_name: 'Casey One', email: 'casey@poweron.test' }),
        portal({ id: 'pp-c2', display_name: 'Casey Two', email: 'casey@poweron.test' }),
      ],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].reconciledBy).toBe('same_org_email')
    expect(rows[0].duplicateSignals.some((signal) => signal.code === 'duplicate_email')).toBe(true)
  })

  it('owner-self employee membership collapses to one canonical owner row', () => {
    const rows = buildUnifiedDirectory(
      [
        cm({ id: 'me', name: 'Owner / Me', isOwner: true }),
        cm({ id: 'owner-virtual', name: 'Owner / Me' }),
      ],
      [],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].isOwner).toBe(true)
    expect(rows[0].duplicateSignals.some((signal) => signal.code === 'owner_self_duplicate')).toBe(true)
  })

  it('reactivating an inactive employee preserves the same canonical identity key and role fields', () => {
    const inactive = buildUnifiedDirectory(
      [cm({ id: 'emp-d', name: 'Drew' })],
      [portal({ id: 'pp-d', display_name: 'Drew', backup_employee_id: 'emp-d', user_id: 'auth-d', active: false, employee_role: 'foreman' })],
    )[0]

    const reactivated = buildUnifiedDirectory(
      [cm({ id: 'emp-d', name: 'Drew' })],
      [portal({ id: 'pp-d', display_name: 'Drew', backup_employee_id: 'emp-d', user_id: 'auth-d', active: true, employee_role: 'foreman' })],
    )[0]

    expect(inactive.key).toBe(reactivated.key)
    expect(inactive.employeeRole).toBe('foreman')
    expect(reactivated.employeeRole).toBe('foreman')
    expect(inactive.canonicalStatus).toBe('inactive')
    expect(reactivated.canonicalStatus).toBe('active')
  })
})

describe('EMP-ADMIN-1 cross-org safety helpers', () => {
  it('same-email portal candidates stay scoped to the requested organization', () => {
    const candidates = selectUnlinkedPortalCandidates(
      [
        {
          id: 'pp-org-a',
          org_id: 'org-a',
          display_name: 'Alex A',
          email: 'alex@poweron.test',
          active: true,
          user_id: null,
          backup_employee_id: null,
        },
        {
          id: 'pp-org-b',
          org_id: 'org-b',
          display_name: 'Alex B',
          email: 'alex@poweron.test',
          active: true,
          user_id: null,
          backup_employee_id: null,
        },
      ],
      'org-a',
      'alex@poweron.test',
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0].profileId).toBe('pp-org-a')
    expect(candidates[0].emailMatch).toBe(true)
  })

  it('portal link status keeps inactive separate from pending and active', () => {
    expect(derivePortalLinkStatus({ active: true, user_id: 'auth-1' })).toBe('Active')
    expect(derivePortalLinkStatus({ active: true, user_id: null })).toBe('Invitation Pending')
    expect(derivePortalLinkStatus({ active: false, user_id: 'auth-1' })).toBe('Inactive')
  })
})
