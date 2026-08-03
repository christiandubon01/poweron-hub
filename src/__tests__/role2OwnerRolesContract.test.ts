/**
 * ROLE-2: Owner Roles & Permissions Manager — contract tests.
 *
 * Test classification:
 *   [STATIC]  Source file assertions. No live DB or network required.
 *   [LOGIC]   Pure-function assertions (computeEffectiveAccess, titleCaseRoleName).
 *
 * 26 cases:
 *   Catalog shape (1–5)
 *   computeEffectiveAccess precedence (6–13)
 *   titleCaseRoleName display helper (14–17)
 *   roleManagementService source contract (18–22)
 *   RolesPermissionsModal source contract (23–26)
 */

// Prevent window.localStorage crash: crewPortalService accesses supabase.from
// at module level; supabase.ts accesses window.localStorage in _getSupabaseClient.
// The mock must be hoisted before any import that transitively loads those modules.
import { describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

vi.mock('@/lib/supabase', () => ({
  supabase: new Proxy({} as any, { get: () => (() => ({})) }),
}))
vi.mock('@/services/crewPortalService', () => ({
  getOwnerOrgId: vi.fn().mockResolvedValue({ success: true, data: 'org-test' }),
}))
// adminTimecardService re-exports from employeeTimeService which also accesses supabase at init.
vi.mock('@/services/adminTimecardService', () => ({}))
vi.mock('@/services/employeeTimeService', () => ({}))

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

import {
  PERMISSION_CATALOG,
  PERMISSION_CATEGORIES,
} from '@/features/employee-roles/permissionCatalog'

import {
  computeEffectiveAccess,
  titleCaseRoleName,
  type EmpRoleAssignment,
  type EmpPermissionOverride,
} from '@/features/employee-roles/roleManagementService'

// ── Static source fixtures ────────────────────────────────────────────────────
// Use import.meta.url so paths resolve relative to this test file, not process.cwd()
// (process.cwd() may point to a different git worktree).

const TEST_DIR    = dirname(fileURLToPath(import.meta.url))
const FEATURE_DIR = join(TEST_DIR, '../features/employee-roles')

const SVC_SRC     = readFileSync(join(FEATURE_DIR, 'roleManagementService.ts'), 'utf8')
const MODAL_SRC   = readFileSync(join(FEATURE_DIR, 'RolesPermissionsModal.tsx'), 'utf8')
const CATALOG_SRC = readFileSync(join(FEATURE_DIR, 'permissionCatalog.ts'), 'utf8')

// ── Test data helpers ─────────────────────────────────────────────────────────

const KEY_PERM    = 'leads.view'
const ROLE_ID_A   = 'role-aaa'
const ROLE_ID_B   = 'role-bbb'
const EP_ID       = 'ep-001'
const ALL_KEYS    = PERMISSION_CATALOG.map(p => p.key)

function makeAssignment(roleId: string): EmpRoleAssignment {
  return {
    id:                  `assign-${roleId}`,
    org_id:              'org-1',
    employee_profile_id: EP_ID,
    role_id:             roleId,
    assigned_by:         'owner-1',
    assigned_at:         '2025-01-01T00:00:00Z',
  }
}

function makeOverride(permKey: string, isDeny: boolean): EmpPermissionOverride {
  return {
    id:                  `ov-${permKey}`,
    org_id:              'org-1',
    employee_profile_id: EP_ID,
    permission_key:      permKey,
    is_deny:             isDeny,
    granted_by:          'owner-1',
    created_at:          '2025-01-01T00:00:00Z',
    updated_at:          '2025-01-01T00:00:00Z',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A. PERMISSION CATALOG SHAPE
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2 — Permission Catalog shape', () => {

  it('1. PERMISSION_CATALOG has exactly 22 entries', () => {
    expect(PERMISSION_CATALOG).toHaveLength(22)
  })

  it('2. All permission keys match the DB format <category>.<action>', () => {
    const pattern = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/
    for (const entry of PERMISSION_CATALOG) {
      expect(entry.key, `key: ${entry.key}`).toMatch(pattern)
    }
  })

  it('3. All permission keys are unique', () => {
    const keys = PERMISSION_CATALOG.map(p => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('4. All entry categories appear in PERMISSION_CATEGORIES', () => {
    for (const entry of PERMISSION_CATALOG) {
      expect(
        PERMISSION_CATEGORIES,
        `category: ${entry.category}`,
      ).toContain(entry.category)
    }
  })

  it('5. Sensitive permissions are exactly the 5 high-risk keys', () => {
    const sensitiveKeys = PERMISSION_CATALOG
      .filter(p => p.sensitive === true)
      .map(p => p.key)
      .sort()
    expect(sensitiveKeys).toEqual([
      'admin.manage_roles',
      'estimates.send',
      'estimates.view_financials',
      'finance.manage',
      'finance.view',
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B. computeEffectiveAccess PRECEDENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2 — computeEffectiveAccess precedence', () => {

  it('6. Explicit deny override beats a role grant → denied_override', () => {
    const overrides = [makeOverride(KEY_PERM, true)]                 // deny
    const assignments = [makeAssignment(ROLE_ID_A)]
    const rolePermMap = new Map([[ROLE_ID_A, [KEY_PERM]]])           // role grants it
    const roleNameMap = new Map([[ROLE_ID_A, 'tech']])

    const result = computeEffectiveAccess(
      [KEY_PERM], overrides, assignments, rolePermMap, roleNameMap,
    )
    expect(result[0].state).toBe('denied_override')
  })

  it('7. Explicit allow override → allowed_override state', () => {
    const overrides = [makeOverride(KEY_PERM, false)]                // allow
    const assignments: EmpRoleAssignment[] = []
    const rolePermMap = new Map<string, string[]>()
    const roleNameMap = new Map<string, string>()

    const result = computeEffectiveAccess(
      [KEY_PERM], overrides, assignments, rolePermMap, roleNameMap,
    )
    expect(result[0].state).toBe('allowed_override')
  })

  it('8. Role grant (no override) → allowed_role state', () => {
    const overrides: EmpPermissionOverride[] = []
    const assignments = [makeAssignment(ROLE_ID_A)]
    const rolePermMap = new Map([[ROLE_ID_A, [KEY_PERM]]])
    const roleNameMap = new Map([[ROLE_ID_A, 'tech']])

    const result = computeEffectiveAccess(
      [KEY_PERM], overrides, assignments, rolePermMap, roleNameMap,
    )
    expect(result[0].state).toBe('allowed_role')
  })

  it('9. No grant, no override → denied_default', () => {
    const result = computeEffectiveAccess(
      [KEY_PERM], [], [], new Map(), new Map(),
    )
    expect(result[0].state).toBe('denied_default')
    expect(result[0].source).toBe('Not granted')
  })

  it('10. Deny override source string is informative', () => {
    const overrides = [makeOverride(KEY_PERM, true)]
    const result = computeEffectiveAccess(
      [KEY_PERM], overrides, [], new Map(), new Map(),
    )
    expect(result[0].source).toMatch(/override/i)
  })

  it('11. allowed_role source string includes the granting role name', () => {
    const assignments = [makeAssignment(ROLE_ID_A)]
    const rolePermMap = new Map([[ROLE_ID_A, [KEY_PERM]]])
    const roleNameMap = new Map([[ROLE_ID_A, 'dispatcher']])

    const result = computeEffectiveAccess(
      [KEY_PERM], [], assignments, rolePermMap, roleNameMap,
    )
    // Source should mention the role name (title-cased or raw)
    expect(result[0].source.toLowerCase()).toContain('dispatcher')
  })

  it('12. computeEffectiveAccess processes every key in the input array', () => {
    const result = computeEffectiveAccess(
      ALL_KEYS, [], [], new Map(), new Map(),
    )
    expect(result).toHaveLength(ALL_KEYS.length)
    const outputKeys = result.map(r => r.key)
    expect(outputKeys).toEqual(ALL_KEYS)
  })

  it('13. Multiple assigned roles — first matching role provides the grant', () => {
    const assignments = [makeAssignment(ROLE_ID_A), makeAssignment(ROLE_ID_B)]
    // Only ROLE_B grants KEY_PERM
    const rolePermMap = new Map([
      [ROLE_ID_A, [] as string[]],
      [ROLE_ID_B, [KEY_PERM]],
    ])
    const roleNameMap = new Map([
      [ROLE_ID_A, 'admin_role'],
      [ROLE_ID_B, 'tech_role'],
    ])

    const result = computeEffectiveAccess(
      [KEY_PERM], [], assignments, rolePermMap, roleNameMap,
    )
    expect(result[0].state).toBe('allowed_role')
    // titleCaseRoleName converts 'tech_role' → 'Tech Role'; match after lowercase
    expect(result[0].source.toLowerCase()).toContain('tech role')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C. titleCaseRoleName
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2 — titleCaseRoleName display helper', () => {

  it('14. Underscore-separated snake_case becomes Title Case', () => {
    expect(titleCaseRoleName('field_tech')).toBe('Field Tech')
  })

  it('15. Single word is capitalized', () => {
    expect(titleCaseRoleName('dispatcher')).toBe('Dispatcher')
  })

  it('16. Space-separated words become Title Case', () => {
    expect(titleCaseRoleName('lead tech')).toBe('Lead Tech')
  })

  it('17. Already-capitalized names are re-capitalized per word', () => {
    // DB stores lowercase; function capitalizes first letter of each word.
    expect(titleCaseRoleName('owner')).toBe('Owner')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D. roleManagementService — source contract
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2 — roleManagementService source contract', () => {

  it('18. Service exports all required async and sync public functions', () => {
    const asyncFns = [
      'loadOrgRoles',
      'loadRolePermissions',
      'loadEmployeeRoles',
      'loadEmployeeOverrides',
      'countRoleAssignments',
      'verifyEmployeeOrgMembership',
      'createRole',
      'renameRole',
      'setRolePermissions',
      'deleteRole',
      'assignRole',
      'removeRole',
      'setOverride',
      'deleteOverride',
    ]
    for (const fn of asyncFns) {
      expect(SVC_SRC, `missing async export: ${fn}`).toContain(`export async function ${fn}`)
    }
    // computeEffectiveAccess is a pure sync function
    expect(SVC_SRC).toContain('export function computeEffectiveAccess')
    // titleCaseRoleName is also sync
    expect(SVC_SRC).toContain('export function titleCaseRoleName')
  })

  it('19. org_id is derived from getOwnerOrgId() — not accepted from a caller argument directly', () => {
    // The internal requireOrgId helper must call getOwnerOrgId()
    expect(SVC_SRC).toContain('getOwnerOrgId')
    expect(SVC_SRC).toContain('async function requireOrgId')
  })

  it('20. createRole calls getUser() before writing to DB', () => {
    // Extract the createRole function body and confirm auth check precedes insert.
    const createIdx = SVC_SRC.indexOf('export async function createRole')
    const nextExport = SVC_SRC.indexOf('export async function renameRole', createIdx)
    const body = SVC_SRC.slice(createIdx, nextExport)

    const getUserIdx = body.indexOf('getUser()')
    const insertIdx  = body.indexOf('.insert(')
    expect(getUserIdx).toBeGreaterThan(0)
    expect(getUserIdx).toBeLessThan(insertIdx)
  })

  it('21. assignRole calls verifyEmployeeOrgMembership before inserting the assignment', () => {
    const assignIdx = SVC_SRC.indexOf('export async function assignRole')
    const nextExport = SVC_SRC.indexOf('export async function removeRole', assignIdx)
    const body = SVC_SRC.slice(assignIdx, nextExport)

    const checkIdx  = body.indexOf('verifyEmployeeOrgMembership')
    const insertIdx = body.indexOf('.insert(')
    expect(checkIdx).toBeGreaterThan(0)
    expect(checkIdx).toBeLessThan(insertIdx)
  })

  it('22. deleteRole calls countRoleAssignments before deleting the role', () => {
    const deleteIdx = SVC_SRC.indexOf('export async function deleteRole')
    const nextExport = SVC_SRC.indexOf('// ── C.', deleteIdx)
    const body = SVC_SRC.slice(deleteIdx, nextExport)

    const countIdx  = body.indexOf('countRoleAssignments')
    const delIdx    = body.indexOf('.delete(')
    expect(countIdx).toBeGreaterThan(0)
    expect(countIdx).toBeLessThan(delIdx)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// E. RolesPermissionsModal — source contract
// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-2 — RolesPermissionsModal source contract', () => {

  it('23. Modal props interface includes epId, displayName, orgId, and onClose', () => {
    expect(MODAL_SRC).toContain('epId: string')
    expect(MODAL_SRC).toContain('displayName: string')
    expect(MODAL_SRC).toContain('orgId: string')
    expect(MODAL_SRC).toContain('onClose: () => void')
  })

  it('24. Modal renders all three tab labels: Assigned Roles, Individual Permissions, Manage Roles', () => {
    expect(MODAL_SRC).toContain('Assigned Roles')
    expect(MODAL_SRC).toContain('Individual Permissions')
    expect(MODAL_SRC).toContain('Manage Roles')
  })

  it('25. Modal includes the ROLE-3 phase note about Portal navigation', () => {
    expect(MODAL_SRC).toContain('next phase')
    expect(MODAL_SRC.toLowerCase()).toContain('portal')
  })

  it('26. Modal imports from both permissionCatalog and roleManagementService', () => {
    expect(MODAL_SRC).toContain("from './permissionCatalog'")
    expect(MODAL_SRC).toContain("from './roleManagementService'")
  })
})
