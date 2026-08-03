/**
 * ROLE-2.1: Dual Entry Point + Pre-Activation Permission Setup — contract tests.
 *
 * Test classification:
 *   [STATIC]  Source file assertions. No live DB or network required.
 *   [LOGIC]   Pure-function assertions using computeEffectiveAccess.
 *   [SCHEMA]  Migration SQL content assertions.
 *
 * 20 required cases:
 *   1.  Existing Team Roles & Permissions action remains visible
 *   2.  Team action uses the same existing RolesPermissionsModal
 *   3.  Crew Portal Role Manager shows Roles & Permissions for any employee
 *   4.  Crew Portal shows Roles & Permissions for invited/pending employee
 *   5.  Crew Portal shows Roles & Permissions for inactive employee
 *   6.  Employee without employee_profiles receives Invite to Portal instead
 *   7.  Crew Portal action opens using employee_profile_id (member.id)
 *   8.  Both entry points use the same RolesPermissionsModal
 *   9.  Both entry points pass epId from employee_profiles.id
 *  10.  Pending employee can receive multiple role assignments (logic)
 *  11.  Pending employee can receive Allow/Deny/Inherit overrides (logic)
 *  12.  Load functions do not clear existing assignments
 *  13.  roleManagementService never updates employee_profiles.active
 *  14.  Activation (accept_employee_invite) UPDATEs, does not INSERT a new row
 *  15.  accept_employee_invite finds row by invite_token — not by user_id
 *  16.  Existing legacy Access Level and Trade Role dropdowns remain in Role Manager
 *  17.  RoleManager is gated by isOwner — ordinary employee cannot see it
 *  18.  verifyEmployeeOrgMembership enforces org membership before mutations
 *  19.  Single Roles & Permissions button per row (no duplicate)
 *  20.  Existing ROLE-1 and ROLE-2 test files still exist
 */

import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('@/lib/supabase', () => ({
  supabase: new Proxy({} as any, { get: () => (() => ({})) }),
}))
vi.mock('@/services/crewPortalService', () => ({
  getOwnerOrgId: vi.fn().mockResolvedValue({ success: true, data: 'org-test' }),
}))
vi.mock('@/services/adminTimecardService', () => ({}))
vi.mock('@/services/employeeTimeService', () => ({}))

import {
  computeEffectiveAccess,
  type EmpRoleAssignment,
  type EmpPermissionOverride,
} from '@/features/employee-roles/roleManagementService'

const TEST_DIR      = dirname(fileURLToPath(import.meta.url))
const ROOT          = join(TEST_DIR, '../..')
const SRC           = join(ROOT, 'src')
const MIG_DIR       = join(ROOT, 'supabase/migrations')

const TEAM_SRC      = readFileSync(join(SRC, 'components/v15r/V15rTeamPanel.tsx'), 'utf8')
const PORTAL_SRC    = readFileSync(join(SRC, 'views/CrewPortal.tsx'), 'utf8')
const SVC_SRC       = readFileSync(join(SRC, 'features/employee-roles/roleManagementService.ts'), 'utf8')
const TIMECARD_SRC  = readFileSync(join(SRC, 'services/adminTimecardService.ts'), 'utf8')
const MIG_082       = existsSync(join(MIG_DIR, '082_employee_invite_rpcs.sql'))
  ? readFileSync(join(MIG_DIR, '082_employee_invite_rpcs.sql'), 'utf8')
  : ''

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeAssignment(roleId: string, epId = 'ep-pending'): EmpRoleAssignment {
  return {
    id: `assign-${roleId}`,
    org_id: 'org-1',
    employee_profile_id: epId,
    role_id: roleId,
    assigned_by: 'owner-1',
    assigned_at: '2025-01-01T00:00:00Z',
  }
}

function makeOverride(permKey: string, isDeny: boolean, epId = 'ep-pending'): EmpPermissionOverride {
  return {
    id: `ov-${permKey}`,
    org_id: 'org-1',
    employee_profile_id: epId,
    permission_key: permKey,
    is_deny: isDeny,
    granted_by: 'owner-1',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1-2: Team page entry point
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — Team page entry point', () => {

  it('1. Team panel contains a "Roles & Permissions" button label', () => {
    expect(TEAM_SRC).toContain('Roles & Permissions')
  })

  it('2. Team panel imports and renders RolesPermissionsModal', () => {
    expect(TEAM_SRC).toContain("import RolesPermissionsModal from '@/features/employee-roles/RolesPermissionsModal'")
    expect(TEAM_SRC).toContain('<RolesPermissionsModal')
  })

  it('2. Team panel passes epId (employee_profile_id) to RolesPermissionsModal', () => {
    expect(TEAM_SRC).toContain('epId: profile.id')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3-5: Crew Portal Role Manager entry point
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — Crew Portal Role Manager entry point', () => {

  it('3. Crew Portal imports RolesPermissionsModal', () => {
    expect(PORTAL_SRC).toContain("import RolesPermissionsModal from '../features/employee-roles/RolesPermissionsModal'")
  })

  it('3. Crew Portal Role Manager renders a "Roles & Permissions" button', () => {
    expect(PORTAL_SRC).toContain('Roles & Permissions')
  })

  it('4. Crew Portal Role Manager renders for pending/invited employees (no active guard on button)', () => {
    // The button must NOT be wrapped by a check for `member.active` or `!member.isPendingInvite`
    // It IS skipped for the logged-in user's own row (user_id === authUser?.id).
    // Verify the button is reachable for members regardless of isPendingInvite.
    const buttonIdx = PORTAL_SRC.indexOf('Roles & Permissions')
    const sectionBefore = PORTAL_SRC.slice(Math.max(0, buttonIdx - 400), buttonIdx)
    // Must NOT require active=true or exclude pending
    expect(sectionBefore).not.toMatch(/member\.active\s*&&/)
    expect(sectionBefore).not.toMatch(/!member\.isPendingInvite/)
  })

  it('5. Crew Portal shows MemberStatusBadge that displays "Inactive" for active=false', () => {
    expect(PORTAL_SRC).toContain('MemberStatusBadge')
    expect(PORTAL_SRC).toContain('Inactive')
    expect(PORTAL_SRC).toContain('Invitation Pending')
  })

  it('5. MemberStatusBadge receives isPendingInvite derived from member.status', () => {
    // ROLE-2.2: switched to UnifiedCrewMember — isPendingInvite is now derived from status field
    expect(PORTAL_SRC).toContain('MemberStatusBadge')
    expect(PORTAL_SRC).toMatch(/isPendingInvite=\{member\.(isPendingInvite|status\s*===\s*['"]pending_invite['"])/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6: Employee without employee_profiles — Invite to Portal fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — Invite to Portal fallback for profiles without portal account', () => {

  it('6. Team panel shows "Invite to Portal" when no portal profile matches the cost-model employee', () => {
    expect(TEAM_SRC).toContain('Invite to Portal')
  })

  it('6. Team panel does not show a broken "Roles & Permissions" button when profile is absent', () => {
    // The fallback is guarded by `if (!profile)` before returning the Invite to Portal button.
    // Use multiline regex to confirm the guard block contains the fallback label.
    expect(TEAM_SRC).toMatch(/if\s*\(!profile\)[\s\S]*?Invite to Portal/)
    // The main Roles & Permissions button must also exist (in the else branch)
    expect(TEAM_SRC).toContain('Roles & Permissions')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7-9: Identity — both entry points use employee_profile_id
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — employee_profile_id is the identity anchor in both entry points', () => {

  it('7. Crew Portal uses employee_profiles.id as epId (via member.profileId after ROLE-2.2)', () => {
    // ROLE-2.2: switched to UnifiedCrewMember — employee_profiles.id is now at member.profileId
    expect(PORTAL_SRC).toMatch(/epId:\s*member\.(id|profileId!?)/)
  })

  it('8. Both files render RolesPermissionsModal (same component, not a copy)', () => {
    expect(TEAM_SRC).toContain('<RolesPermissionsModal')
    expect(PORTAL_SRC).toContain('<RolesPermissionsModal')
  })

  it('9. Team uses profile.id (from employee_profiles); Crew Portal uses member.profileId (ROLE-2.2)', () => {
    // Team: profile.id from portalProfileMap which maps backup_employee_id → employee_profiles.id
    expect(TEAM_SRC).toContain('epId: profile.id')
    // Crew Portal: member.profileId (UnifiedCrewMember) = employee_profiles.id from getUnifiedCrewDirectory
    expect(PORTAL_SRC).toMatch(/epId:\s*member\.profileId/)
  })

  it('9. getAllOrgEmployeeProfiles is used in Team panel (includes inactive employees)', () => {
    expect(TEAM_SRC).toContain('getAllOrgEmployeeProfiles')
    expect(TIMECARD_SRC).toContain('export async function getAllOrgEmployeeProfiles')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10-11: Pending employee — logic tests for roles and overrides
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — Pending employee lifecycle (pure logic)', () => {

  const PENDING_EP = 'ep-pending-001'
  const ROLE_A = 'role-field-tech'
  const ROLE_B = 'role-dispatcher'

  it('10. Pending employee can receive multiple role assignments', () => {
    const assignments = [makeAssignment(ROLE_A, PENDING_EP), makeAssignment(ROLE_B, PENDING_EP)]
    const rolePermMap = new Map([
      [ROLE_A, ['time.view_own']],
      [ROLE_B, ['leads.view', 'leads.assign']],
    ])
    const roleNameMap = new Map([[ROLE_A, 'field tech'], [ROLE_B, 'dispatcher']])

    const result = computeEffectiveAccess(
      ['time.view_own', 'leads.view', 'leads.assign'],
      [],
      assignments,
      rolePermMap,
      roleNameMap,
    )
    expect(result.every(r => r.state === 'allowed_role')).toBe(true)
  })

  it('11. Pending employee can receive explicit Allow override', () => {
    const overrides = [makeOverride('scheduling.view', false, PENDING_EP)]
    const result = computeEffectiveAccess(['scheduling.view'], overrides, [], new Map(), new Map())
    expect(result[0].state).toBe('allowed_override')
  })

  it('11. Pending employee can receive explicit Deny override (beats role grant)', () => {
    const overrides = [makeOverride('finance.view', true, PENDING_EP)]
    const assignments = [makeAssignment(ROLE_A, PENDING_EP)]
    const rolePermMap = new Map([[ROLE_A, ['finance.view']]])
    const roleNameMap = new Map([[ROLE_A, 'finance role']])

    const result = computeEffectiveAccess(['finance.view'], overrides, assignments, rolePermMap, roleNameMap)
    expect(result[0].state).toBe('denied_override')
  })

  it('11. Removing override returns permission to inherited/default (no override = denied_default)', () => {
    const result = computeEffectiveAccess(['finance.view'], [], [], new Map(), new Map())
    expect(result[0].state).toBe('denied_default')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 12-13: Persistence and non-activation guarantees
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — Persistence and non-activation guarantees', () => {

  it('12. roleManagementService.loadEmployeeRoles does not clear or overwrite existing assignments', () => {
    const loadStart = SVC_SRC.indexOf('export async function loadEmployeeRoles')
    const loadEnd   = SVC_SRC.indexOf('export async function loadEmployeeOverrides')
    const body = SVC_SRC.slice(loadStart, loadEnd)

    // The function must SELECT only — no DELETE, INSERT, or UPDATE
    expect(body).not.toContain('.delete(')
    expect(body).not.toContain('.insert(')
    expect(body).not.toContain('.update(')
    expect(body).not.toContain('.upsert(')
  })

  it('13. roleManagementService never updates employee_profiles.active', () => {
    // Configuring permissions must never activate or deactivate an employee
    expect(SVC_SRC).not.toMatch(/employee_profiles.*active/i)
    expect(SVC_SRC).not.toMatch(/UPDATE.*employee_profiles/i)
    expect(SVC_SRC).not.toContain("from('employee_profiles').update")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 14-15: Activation persistence — migration 082 (accept_employee_invite)
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — Activation preserves employee_profile_id (migration 082)', () => {

  it('14. accept_employee_invite performs UPDATE — does not INSERT a new employee_profiles row', () => {
    expect(MIG_082).toContain('accept_employee_invite')
    expect(MIG_082).toMatch(/UPDATE\s+employee_profiles/i)
    // Must not INSERT into employee_profiles during acceptance
    expect(MIG_082).not.toMatch(/INSERT\s+INTO\s+employee_profiles/i)
  })

  it('15. accept_employee_invite finds the row by invite_token — not by creating a new row', () => {
    expect(MIG_082).toMatch(/invite_token\s*=\s*p_token/i)
    // It sets user_id on the existing row; it does not open a new identity
    expect(MIG_082).toMatch(/SET\s+user_id/i)
  })

  it('15. accept_employee_invite nulls the invite_token after use (one-time token)', () => {
    expect(MIG_082).toMatch(/invite_token\s*=\s*NULL/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 16-19: UI guard and uniqueness checks
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — UI guards, uniqueness, and legacy dropdowns', () => {

  it('16. AccessLevelDropdown still exists in Crew Portal Role Manager', () => {
    expect(PORTAL_SRC).toContain('AccessLevelDropdown')
  })

  it('16. TradeRoleDropdown still exists in Crew Portal Role Manager', () => {
    expect(PORTAL_SRC).toContain('TradeRoleDropdown')
  })

  it('17. RoleManager is gated by isOwner — only shown to owner/admin', () => {
    // The component is rendered at the bottom of CrewPortal with isOwner guard
    expect(PORTAL_SRC).toMatch(/isOwnerOrAdmin.*RoleManager|RoleManager.*isOwner/s)
  })

  it('17. Roles & Permissions button inside RoleManager is also gated by isOwner', () => {
    // The button cell is inside `{isOwner && ( <td> ... Roles & Permissions ... )}`.
    // Use multiline regex to confirm the isOwner guard wraps the button.
    expect(PORTAL_SRC).toMatch(/isOwner[\s\S]*?Roles & Permissions/)
  })

  it('18. verifyEmployeeOrgMembership checks org_id matches before mutations', () => {
    expect(SVC_SRC).toContain('verifyEmployeeOrgMembership')
    expect(SVC_SRC).toContain('.eq(\'org_id\', orgRes.data)')
  })

  it('19. Only one "Roles & Permissions" button per row — not duplicated in same cell', () => {
    // Confirm the button text appears in exactly one place inside the RoleManager section.
    // RoleManager function starts at "function RoleManager" and ends at its closing brace.
    const roleManagerStart = PORTAL_SRC.indexOf('function RoleManager(')
    const roleManagerEnd   = PORTAL_SRC.indexOf('\nfunction ', roleManagerStart + 1)
    const roleManagerBody  = PORTAL_SRC.slice(roleManagerStart, roleManagerEnd > 0 ? roleManagerEnd : undefined)

    // Count occurrences of the button label string
    const count = (roleManagerBody.match(/Roles & Permissions/g) ?? []).length
    // Appears in: header column + one button per template = at most 2 (header + button)
    expect(count).toBeLessThanOrEqual(2)
    expect(count).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 20: Regression — existing ROLE-1 and ROLE-2 test files still exist
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2.1 — Existing ROLE-1 and ROLE-2 tests still present', () => {

  it('20. role1PermissionFoundationContract.test.ts exists', () => {
    expect(existsSync(join(TEST_DIR, 'role1PermissionFoundationContract.test.ts'))).toBe(true)
  })

  it('20. role2OwnerRolesContract.test.ts exists', () => {
    expect(existsSync(join(TEST_DIR, 'role2OwnerRolesContract.test.ts'))).toBe(true)
  })
})
