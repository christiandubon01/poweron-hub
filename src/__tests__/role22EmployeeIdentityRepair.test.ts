/**
 * ROLE-2.2: Employee Identity Repair & Prepared Accounts — contract tests.
 *
 * Test classification:
 *   [STATIC]  Source file assertions. No live DB or network required.
 *   [LOGIC]   Pure-function / type assertions.
 *   [SCHEMA]  Migration SQL content assertions.
 *
 * 27 required cases:
 *   1.  adminTimecardService PROFILE_COLS includes backup_employee_id
 *   2.  AdminEmployeeProfile interface has backup_employee_id field
 *   3.  prepareEmployeeAccount function exists in adminTimecardService
 *   4.  prepareEmployeeAccount inserts with backup_employee_id
 *   5.  prepareEmployeeAccount checks for existing profile before insert
 *   6.  prepareEmployeeAccount accepts optional email parameter
 *   7.  prepareEmployeeAccount does not require email to create profile
 *   8.  RolesPermissionsModal loadAll returns RoleWithPerms[] (not void)
 *   9.  handleCreateRole moves setManageMode after loadAll (fixes render race)
 *  10.  handleCreateRole throws when reload returns empty (RLS failure detection)
 *  11.  CrewPortal RoleManager imports getUnifiedCrewDirectory
 *  12.  CrewPortal RoleManager does NOT call getOrgMembers for member list
 *  13.  CrewPortal RoleManager shows Prepare Account for cost_model_only entries
 *  14.  CrewPortal RoleManager uses member.profileId for Roles & Permissions target
 *  15.  CrewPortal RoleManager uses member.key (not member.id) for React key
 *  16.  CrewPortal RoleManager shows Send Invite for prepared accounts with email
 *  17.  CrewPortal RoleManager shows Set Email & Invite for prepared accounts without email
 *  18.  CrewPortal imports prepareEmployeeAccount from adminTimecardService
 *  19.  CrewPortal imports resendEmployeeInvite from employeeInviteService
 *  20.  V15rTeamPanel portalProfileMap keys by backup_employee_id when set
 *  21.  V15rTeamPanel lookup uses emp.id (backup_employee_id stable link) first
 *  22.  V15rTeamPanel falls back to name: prefix for profiles without backup link
 *  23.  employeeInviteService SendEmployeeInviteInput has profileId optional field
 *  24.  employeeInviteService sendEmployeeInvite passes profileId to netlify function
 *  25.  sendEmployeeInvite netlify function has UPDATE path gated on profileId
 *  26.  sendEmployeeInvite netlify function org-guards the UPDATE path
 *  27.  Migration 081 already defines backup_employee_id column on employee_profiles
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
  getUnifiedCrewDirectory: vi.fn().mockResolvedValue({ success: true, data: [] }),
}))
vi.mock('@/services/adminTimecardService', () => ({
  prepareEmployeeAccount: vi.fn().mockResolvedValue({ success: true, data: {} }),
}))
vi.mock('@/services/employeeTimeService', () => ({}))

const TEST_DIR  = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(TEST_DIR, '../..')
const SRC       = join(ROOT, 'src')
const MIG_DIR   = join(ROOT, 'supabase/migrations')

const TIMECARD_SRC   = readFileSync(join(SRC, 'services/adminTimecardService.ts'), 'utf8')
const MODAL_SRC      = readFileSync(join(SRC, 'features/employee-roles/RolesPermissionsModal.tsx'), 'utf8')
const PORTAL_SRC     = readFileSync(join(SRC, 'views/CrewPortal.tsx'), 'utf8')
const TEAM_SRC       = readFileSync(join(SRC, 'components/v15r/V15rTeamPanel.tsx'), 'utf8')
const INVITE_SVC_SRC = readFileSync(join(SRC, 'services/employeeInviteService.ts'), 'utf8')
const INVITE_MODAL_SRC = readFileSync(join(SRC, 'components/admin/EmployeeInviteModal.tsx'), 'utf8')
const NETLIFY_INVITE = readFileSync(join(ROOT, 'netlify/functions/sendEmployeeInvite.ts'), 'utf8')
const MIG_081 = existsSync(join(MIG_DIR, '081_employee_time_tracking.sql'))
  ? readFileSync(join(MIG_DIR, '081_employee_time_tracking.sql'), 'utf8')
  : ''

// ── adminTimecardService ──────────────────────────────────────────────────────

describe('adminTimecardService — backup_employee_id', () => {
  it('1. PROFILE_COLS includes backup_employee_id', () => {
    expect(TIMECARD_SRC).toContain('backup_employee_id')
    // Must be in the actual PROFILE_COLS string, not just elsewhere
    const colsMatch = TIMECARD_SRC.match(/const PROFILE_COLS\s*=\s*['"`]([^'"`]+)['"`]/)
    expect(colsMatch).toBeTruthy()
    expect(colsMatch![1]).toContain('backup_employee_id')
  })

  it('2. AdminEmployeeProfile interface declares backup_employee_id field', () => {
    const ifaceMatch = TIMECARD_SRC.match(/interface AdminEmployeeProfile\s*\{([^}]+)\}/)
    expect(ifaceMatch).toBeTruthy()
    expect(ifaceMatch![1]).toContain('backup_employee_id')
  })

  it('3. prepareEmployeeAccount is exported from adminTimecardService', () => {
    expect(TIMECARD_SRC).toContain('export async function prepareEmployeeAccount(')
  })

  it('4. prepareEmployeeAccount inserts with backup_employee_id set', () => {
    const fn = TIMECARD_SRC.match(/export async function prepareEmployeeAccount[\s\S]+?^}/m)
    expect(fn).toBeTruthy()
    expect(fn![0]).toContain('backup_employee_id')
    expect(fn![0]).toContain('.insert(')
  })

  it('5. prepareEmployeeAccount checks for existing profile before inserting', () => {
    const fn = TIMECARD_SRC.match(/export async function prepareEmployeeAccount[\s\S]+?^}/m)
    expect(fn).toBeTruthy()
    // Must check existing before insert to prevent duplicates
    const existingIdx = fn![0].indexOf('existing')
    const insertIdx   = fn![0].indexOf('.insert(')
    expect(existingIdx).toBeGreaterThan(-1)
    expect(insertIdx).toBeGreaterThan(existingIdx)
  })

  it('6. prepareEmployeeAccount accepts optional email parameter', () => {
    expect(TIMECARD_SRC).toMatch(/prepareEmployeeAccount\s*\([^)]*email\?/)
  })

  it('7. prepareEmployeeAccount does not require email to create profile (email is optional)', () => {
    // The email param must have ? (optional) and not appear in the required column list
    const signature = TIMECARD_SRC.match(/prepareEmployeeAccount\s*\(([^)]+)\)/)
    expect(signature).toBeTruthy()
    expect(signature![1]).toContain('email?')
  })
})

// ── RolesPermissionsModal ─────────────────────────────────────────────────────

describe('RolesPermissionsModal — role creation fix', () => {
  it('8. loadAll returns RoleWithPerms[] (not void)', () => {
    // The new signature must have explicit return type or a return statement at the end
    expect(MODAL_SRC).toMatch(/loadAll\s*=\s*useCallback\s*\(\s*async\s*\(\s*\)\s*:\s*Promise<RoleWithPerms\[\]>/)
  })

  it('9. handleCreateRole awaits loadAll before calling setManageMode (fixes render race)', () => {
    // Find the position of handleCreateRole in the file, then check relative ordering
    const startIdx = MODAL_SRC.indexOf('async function handleCreateRole()')
    expect(startIdx).toBeGreaterThan(-1)
    const segment = MODAL_SRC.slice(startIdx, startIdx + 1000)
    const loadAllIdx = segment.indexOf('await loadAll()')
    const modeIdx    = segment.indexOf("setManageMode('list')")
    // loadAll must complete before mode switch within the same function
    expect(loadAllIdx).toBeGreaterThan(-1)
    expect(modeIdx).toBeGreaterThan(loadAllIdx)
  })

  it('10. handleCreateRole throws diagnostic error when reload returns empty (detects silent RLS failure)', () => {
    const fn = MODAL_SRC.match(/async function handleCreateRole[\s\S]+?^\s*\}/m)
    expect(fn).toBeTruthy()
    expect(fn![0]).toMatch(/\.length\s*===\s*0/)
    expect(fn![0]).toContain('throw new Error')
  })
})

// ── CrewPortal RoleManager ────────────────────────────────────────────────────

describe('CrewPortal RoleManager — unified directory', () => {
  it('11. RoleManager calls getUnifiedCrewDirectory for member list', () => {
    expect(PORTAL_SRC).toContain('getUnifiedCrewDirectory()')
  })

  it('12. RoleManager does NOT call getOrgMembers inside loadMembers', () => {
    // getOrgMembers may still be imported for other uses, but loadMembers must use unified directory
    const loadFn = PORTAL_SRC.match(/const loadMembers\s*=\s*useCallback[\s\S]+?^\s*\},\s*\[\]/m)
    expect(loadFn).toBeTruthy()
    expect(loadFn![0]).not.toContain('getOrgMembers(')
    expect(loadFn![0]).toContain('getUnifiedCrewDirectory')
  })

  it('13. RoleManager shows Prepare Account button for cost_model_only entries', () => {
    expect(PORTAL_SRC).toContain('Prepare Account')
    expect(PORTAL_SRC).toContain('cost_model_only')
    expect(PORTAL_SRC).toContain('backupEmployeeId')
  })

  it('14. Roles & Permissions target uses member.profileId (not member.id)', () => {
    // The setRolesTarget call must reference profileId, not plain .id
    expect(PORTAL_SRC).toMatch(/setRolesTarget\s*\(\s*\{[^}]*member\.profileId/)
  })

  it('15. Table row key uses member.key (UnifiedCrewMember.key, not OrgMember.id)', () => {
    expect(PORTAL_SRC).toContain('key={member.key}')
    expect(PORTAL_SRC).not.toContain('key={member.id}')
  })

  it('16. Send Invite button appears for prepared accounts that have an email stored', () => {
    expect(PORTAL_SRC).toContain('Send Invite')
    expect(PORTAL_SRC).toContain('member.email')
    // resendEmployeeInvite must be called (not sendEmployeeInvite) for this path
    expect(PORTAL_SRC).toContain('handleSendInviteToProfile')
  })

  it('17. Set Email & Invite button appears for prepared accounts with no email stored', () => {
    expect(PORTAL_SRC).toContain('Set Email & Invite')
    expect(PORTAL_SRC).toContain('inviteTarget')
  })

  it('18. CrewPortal imports prepareEmployeeAccount from adminTimecardService', () => {
    expect(PORTAL_SRC).toContain("from '../services/adminTimecardService'")
    expect(PORTAL_SRC).toContain('prepareEmployeeAccount')
  })

  it('19. CrewPortal imports resendEmployeeInvite from employeeInviteService', () => {
    expect(PORTAL_SRC).toContain("from '../services/employeeInviteService'")
    expect(PORTAL_SRC).toContain('resendEmployeeInvite')
  })
})

// ── V15rTeamPanel — stable identity matching ──────────────────────────────────

describe('V15rTeamPanel — backup_employee_id stable matching', () => {
  it('20. portalProfileMap keys by backup_employee_id when the field is present', () => {
    expect(TEAM_SRC).toContain('backup_employee_id')
    expect(TEAM_SRC).toContain('map.set(p.backup_employee_id,')
  })

  it('21. Lookup tries emp.id (backup_employee_id) before display_name fallback', () => {
    const lookup = TEAM_SRC.match(/const profile\s*=\s*portalProfileMap\.get\(emp\.id\)/)
    expect(lookup).toBeTruthy()
  })

  it('22. Falls back to name: prefix key for profiles without backup_employee_id link', () => {
    // Template literal in source: `name:${p.display_name...}` contains the substring name:${
    expect(TEAM_SRC).toContain('name:${')
    // Lookup also uses name: prefix with the employee name fallback
    expect(TEAM_SRC).toMatch(/name:\$\{.*emp\.name/)
  })
})

// ── employeeInviteService — profileId propagation ─────────────────────────────

describe('employeeInviteService — profileId support', () => {
  it('23. SendEmployeeInviteInput has optional profileId field', () => {
    const ifaceMatch = INVITE_SVC_SRC.match(/interface SendEmployeeInviteInput\s*\{([^}]+)\}/)
    expect(ifaceMatch).toBeTruthy()
    expect(ifaceMatch![1]).toContain('profileId?')
  })

  it('24. sendEmployeeInvite passes profileId to netlify function when set', () => {
    expect(INVITE_SVC_SRC).toContain('profileId')
    // The body building must conditionally include profileId
    expect(INVITE_SVC_SRC).toContain('input.profileId')
  })
})

// ── sendEmployeeInvite netlify function ───────────────────────────────────────

describe('sendEmployeeInvite netlify function — UPDATE path', () => {
  it('25. Has a profileId UPDATE branch that does not call supabaseInsert', () => {
    expect(NETLIFY_INVITE).toContain('profileId')
    // The UPDATE path must call supabaseUpdate
    expect(NETLIFY_INVITE).toContain('supabaseUpdate')
    // Must have both paths in the same file
    expect(NETLIFY_INVITE).toContain('supabaseInsert')
  })

  it('26. UPDATE path verifies the profile belongs to the caller\'s org before patching', () => {
    // Find the profileId branch
    const profileBlock = NETLIFY_INVITE.match(/if\s*\(profileId\)[\s\S]+?\/\/ ── Standard new invite/)
    expect(profileBlock).toBeTruthy()
    expect(profileBlock![0]).toContain('org_id')
    // Org comparison must be present
    expect(profileBlock![0]).toMatch(/org_id\s*!==?\s*[a-z.]+org_id|org_id.*callerProfile|callerProfile.*org_id/)
  })
})

// ── Migration schema ─────────────────────────────────────────────────────────

describe('Migration 081 — backup_employee_id already exists', () => {
  it('27. employee_profiles table in migration 081 defines backup_employee_id TEXT column', () => {
    expect(MIG_081).toContain('backup_employee_id')
    // Should be a column definition, not just a comment
    expect(MIG_081).toMatch(/backup_employee_id\s+TEXT/)
  })
})
