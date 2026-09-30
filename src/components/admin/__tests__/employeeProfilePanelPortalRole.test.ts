// @vitest-environment happy-dom
/**
 * EmployeeProfilePanel Portal Role — unit tests for the formatPortalRole helper.
 *
 * The component imports several Supabase-backed service modules whose import
 * graph references `window` (src/lib/supabase.ts). These tests only exercise
 * the pure `formatPortalRole` helper, so the service modules (and the invite
 * modal) are mocked to keep the component loadable in the test environment
 * without a real Supabase client — the same approach used by the component
 * tests under src/components/v15r/__tests__.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/services/employeePerformanceService', () => ({
  getLatestSnapshot: vi.fn(),
  getQualityRatings: vi.fn(),
  getCompensationHistory: vi.fn(),
}))
vi.mock('@/services/crewPortalService', () => ({
  updateEmployeeDisplayName: vi.fn(),
  archiveEmployee: vi.fn(),
  reactivateEmployee: vi.fn(),
  deleteEmployeePortalRecord: vi.fn(),
}))
vi.mock('@/services/employeeInviteService', () => ({
  resendEmployeeInvite: vi.fn(),
}))
vi.mock('@/services/roleService', () => ({
  TRADE_ROLE_LABELS: {},
  TRADE_ROLE_BADGE_CLASS: {},
}))
vi.mock('@/components/admin/EmployeeInviteModal', () => ({
  default: () => null,
}))

import { formatPortalRole } from '../EmployeeProfilePanel'

describe('EmployeeProfilePanel Portal Role', () => {
  it('labels a regular employee with portal access as Employee', () => {
    expect(formatPortalRole(null, true)).toBe('Employee')
  })

  it('shows an em dash when the employee has no portal access', () => {
    expect(formatPortalRole(null, false)).toBe('—')
  })

  it('preserves an explicit portal role', () => {
    expect(formatPortalRole('crew', true)).toBe('crew')
  })
})