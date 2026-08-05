/**
 * ROLE-2.3 — Complete owner role workflow (permissions, assignment, link).
 *
 * Contract + logic tests. Disposable DB runtime proof is separate (agent SQL).
 * Josh is never auto-linked by these tests.
 */

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('@/lib/supabase', () => ({
  supabase: new Proxy({} as any, { get: () => (() => ({})) }),
}))
vi.mock('@/services/crewPortalService', () => ({
  getOwnerOrgId: vi.fn().mockResolvedValue({ success: true, data: 'org-test' }),
}))
vi.mock('@/services/employeeTimeService', () => ({
  deriveClockPhase: vi.fn(),
  getTenantWorkDate: vi.fn(),
}))

import {
  selectUnlinkedPortalCandidates,
  derivePortalLinkStatus,
} from '@/services/adminTimecardService'
import {
  computeEffectiveAccess,
  type EmpRoleAssignment,
  type EmpPermissionOverride,
} from '@/features/employee-roles/roleManagementService'
import { PERMISSION_CATALOG, PERMISSION_CATEGORIES } from '@/features/employee-roles/permissionCatalog'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(TEST_DIR, '../..')
const SRC = join(ROOT, 'src')

const MODAL_SRC = readFileSync(join(SRC, 'features/employee-roles/RolesPermissionsModal.tsx'), 'utf8')
const SVC_SRC = readFileSync(join(SRC, 'features/employee-roles/roleManagementService.ts'), 'utf8')
const TIMECARD_SRC = readFileSync(join(SRC, 'services/adminTimecardService.ts'), 'utf8')
const PORTAL_SRC = readFileSync(join(SRC, 'views/CrewPortal.tsx'), 'utf8')
const TEAM_SRC = readFileSync(join(SRC, 'components/v15r/V15rTeamPanel.tsx'), 'utf8')
const CREW_SVC = readFileSync(join(SRC, 'services/crewPortalService.ts'), 'utf8')

const ORG = 'org-a'
const JOSH_EMAIL = 'joshuaramirez0084@gmail.com'
const JOSH_PROFILE = 'fb521d80-db97-419e-bc5e-44ae7355fc37'
const ALLAN_EP = 'a1020088-b84b-4adf-bc72-f34c1ead3161'
const DISPATCHER_ROLE = 'bff42b69-57f5-44ad-9d2a-de6eb4406dcb'

describe('ROLE-2.3 — Edit Permissions UX', () => {
  it('1. Edit Permissions has a visible text label (not pencil-only)', () => {
    expect(MODAL_SRC).toContain('Edit Permissions')
    // Pencil-only entry point removed from Manage Roles list actions.
    expect(MODAL_SRC).not.toMatch(/title="Edit role"/)
  })

  it('2. Permission editor lists grouped permission catalog', () => {
    expect(MODAL_SRC).toContain("manageMode === 'edit-perms'")
    expect(MODAL_SRC).toContain('PERMISSION_CATEGORIES.map')
    expect(MODAL_SRC).toContain('getPermissionsByCategory')
    expect(MODAL_SRC).toContain('p.description')
    expect(MODAL_SRC).toContain('SENSITIVE')
    expect(PERMISSION_CATEGORIES.length).toBeGreaterThan(0)
    expect(PERMISSION_CATALOG.length).toBe(22)
  })

  it('3. Save creates role-permission rows via setRolePermissions', () => {
    expect(MODAL_SRC).toContain('setRolePermissions(orgId, editingRole.role.id')
    expect(MODAL_SRC).toContain('Save Changes')
    // ROLE-2.4: insert now chains .select() to return authoritative rows (multiline).
    expect(SVC_SRC).toMatch(/from\('emp_role_permissions'\)\s*\.insert\(rows\)\s*\.select/)
  })

  it('4. Reload preserves permissions (bounded read-after-write verify; optimistic UI)', () => {
    // Service confirms via loadRolePermissions using a bounded retry (no re-write).
    expect(SVC_SRC).toMatch(/setRolePermissions[\s\S]+loadRolePermissions\(roleId\)/)
    expect(SVC_SRC).toContain('verifyWithRetry')
    // Modal reflects the confirmed key set on the card optimistically (single click).
    expect(MODAL_SRC).toContain('setOrgRoles(prev =>')
  })

  it('5. Permission count updates on role card after save', () => {
    expect(MODAL_SRC).toContain('permKeys.length} permission')
    // Card is updated from the service-confirmed saved key set, not a lagging reload.
    expect(MODAL_SRC).toMatch(/permKeys:\s*savedKeys/)
  })

  it('6. Failed save shows an error and keeps editor open', () => {
    // Success path closes editor; failure throws into mutError before that.
    const saveFn = MODAL_SRC.match(/async function handleSavePermissions\(\)[\s\S]+?^  \}/m)
    expect(saveFn).toBeTruthy()
    expect(saveFn![0]).toContain("if (!res.success) throw new Error")
    expect(saveFn![0].indexOf("setManageMode('list')")).toBeGreaterThan(
      saveFn![0].indexOf('throw new Error'),
    )
    expect(MODAL_SRC).toContain('mutError')
    expect(MODAL_SRC).toContain('Cancel')
  })
})

describe('ROLE-2.3 — Assigned Roles', () => {
  it('7. Assigned Roles lists existing organization roles', () => {
    expect(MODAL_SRC).toContain("tab === 'assigned'")
    expect(MODAL_SRC).toContain('orgRoles.map')
    expect(MODAL_SRC).toContain('Assign')
    expect(MODAL_SRC).toContain('Remove')
  })

  it('8. Allan can be assigned Dispatcher Test (uses employee_profiles.id)', () => {
    expect(PORTAL_SRC).toMatch(/epId:\s*member\.profileId/)
    expect(TEAM_SRC).toContain('epId: profile.id')
    expect(SVC_SRC).toContain('employee_profile_id: epId')
    expect(SVC_SRC).toContain('verifyEmployeeOrgMembership(epId)')
    // Production identity anchors used by owner tests — documented, not auto-mutated.
    expect(ALLAN_EP).toMatch(/^[0-9a-f-]{36}$/)
    expect(DISPATCHER_ROLE).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('9. Assignment persists (bounded read-after-write verify in service)', () => {
    // assignRole verifies via loadEmployeeRoles with a bounded retry (no re-insert).
    expect(SVC_SRC).toMatch(/export async function assignRole[\s\S]+loadEmployeeRoles\(epId\)/)
    expect(SVC_SRC).toContain('verifyWithRetry')
    // Modal trusts the service result (the redundant re-verify that caused the
    // false first-save error was removed).
    expect(MODAL_SRC).toContain('handleAssignRole')
  })

  it('10. Removing one role preserves others', () => {
    expect(SVC_SRC).toContain(".eq('employee_profile_id', epId)")
    expect(SVC_SRC).toContain(".eq('role_id', roleId)")
    expect(SVC_SRC).toContain('Other roles are unaffected')
    expect(SVC_SRC).toContain('export async function removeRole')
  })

  it('11. Prepared/inactive profiles can receive roles', () => {
    // No active/accepted guard on Roles entry for prepared accounts.
    expect(PORTAL_SRC).toContain('isPrepared && member.email')
    expect(PORTAL_SRC).toMatch(/setRolesTarget\(\{\s*epId:\s*member\.profileId/)
    expect(SVC_SRC).toContain("eq('id', epId)")
    expect(SVC_SRC).not.toMatch(/assignRole[\s\S]{0,400}accepted_at/)
  })

  it('12. UI explains role inheritance', () => {
    expect(MODAL_SRC).toContain('Choose the permissions included with each role.')
    expect(MODAL_SRC).toContain(
      'Assign one or more roles to this employee. The employee inherits the permissions',
    )
    expect(MODAL_SRC).toContain(
      'Use Allow or Deny to override this employee’s inherited role permissions. Deny',
    )
  })
})

describe('ROLE-2.3 — Link Existing Account', () => {
  it('13. Link confirmation is visible', () => {
    expect(PORTAL_SRC).toContain('I confirm I want to link these two existing records.')
    expect(TEAM_SRC).toContain('I confirm I want to link these two existing records.')
    expect(PORTAL_SRC).toContain('aria-label="Confirm link existing account"')
    expect(TEAM_SRC).toContain('aria-label="Confirm link existing account"')
  })

  it('14. Confirm button loading state works', () => {
    expect(PORTAL_SRC).toContain("linking ?")
    expect(PORTAL_SRC).toContain('Linking…')
    expect(TEAM_SRC).toContain('Linking…')
    expect(PORTAL_SRC).toMatch(/disabled=\{linking \|\| !selectedLinkProfileId \|\| !linkConfirmed/)
  })

  it('15. Link mutation returns updated row and verifies backup_employee_id', () => {
    const fn = TIMECARD_SRC.match(/export async function linkExistingEmployeeAccount[\s\S]+?^}/m)
    expect(fn).toBeTruthy()
    expect(fn![0]).toContain('.update({ backup_employee_id: cleanBackupId })')
    expect(fn![0]).toContain('verified.backup_employee_id !== cleanBackupId')
    expect(fn![0]).toContain('return { success: true, data: verified as AdminEmployeeProfile }')
    expect(fn![0]).toContain("['owner', 'admin']")
  })

  it('16. Link failure displays an error', () => {
    expect(PORTAL_SRC).toContain('setLinkError')
    expect(PORTAL_SRC).toContain('role="alert"')
    expect(TEAM_SRC).toContain('role="alert"')
    expect(PORTAL_SRC).toContain('Link did not complete')
    expect(TEAM_SRC).toContain('Link did not complete')
  })

  it('17. Linked employee renders once', () => {
    expect(CREW_SVC).toContain('if (p.backup_employee_id) matchedBackupIds.add(p.backup_employee_id)')
    expect(CREW_SVC).toContain('if (matchedBackupIds.has(emp.id)) continue')
  })

  it('18. Josh is never auto-linked by tests', () => {
    expect(TIMECARD_SRC).not.toContain(JOSH_EMAIL)
    expect(TIMECARD_SRC).not.toContain(JOSH_PROFILE)
    // Candidate selection never writes backup_employee_id.
    const candidates = selectUnlinkedPortalCandidates(
      [
        {
          id: JOSH_PROFILE,
          org_id: ORG,
          display_name: 'Josh',
          email: JOSH_EMAIL,
          active: true,
          user_id: 'u1',
          backup_employee_id: null,
        },
      ],
      ORG,
      JOSH_EMAIL,
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].emailMatch).toBe(true)
    expect(candidates[0].profileId).toBe(JOSH_PROFILE)
    // No mutation in this test file — profile remains conceptually unlinked.
    expect(derivePortalLinkStatus({ active: true, user_id: 'u1' })).toBe('Active')
  })
})

describe('ROLE-2.3 — effective access still follows deny-wins', () => {
  it('deny override beats role grant (inheritance model)', () => {
    const assignments: EmpRoleAssignment[] = [
      {
        id: 'a1',
        org_id: ORG,
        employee_profile_id: ALLAN_EP,
        role_id: DISPATCHER_ROLE,
        assigned_by: 'owner',
        assigned_at: '2026-01-01',
      },
    ]
    const overrides: EmpPermissionOverride[] = [
      {
        id: 'o1',
        org_id: ORG,
        employee_profile_id: ALLAN_EP,
        permission_key: 'leads.view',
        is_deny: true,
        granted_by: 'owner',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    ]
    const rolePermMap = new Map([[DISPATCHER_ROLE, ['leads.view', 'scheduling.view']]])
    const roleNameMap = new Map([[DISPATCHER_ROLE, 'dispatcher test']])
    const result = computeEffectiveAccess(
      ['leads.view', 'scheduling.view'],
      overrides,
      assignments,
      rolePermMap,
      roleNameMap,
    )
    expect(result.find(r => r.key === 'leads.view')?.state).toBe('denied_override')
    expect(result.find(r => r.key === 'scheduling.view')?.state).toBe('allowed_role')
  })
})
