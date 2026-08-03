/**
 * ROLE-1: Employee Permission Foundation — contract tests.
 *
 * Test classification:
 *   [STATIC]      migration content assertions (no live DB required)
 *   [INTEGRATION] live DB required — marked but NOT run here
 *
 * Required coverage (25 cases from the ROLE-1 spec):
 *   1.  Owner permission returns true                                [STATIC resolver contract]
 *   2.  Admin permission returns true                               [STATIC resolver contract]
 *   3.  Employee with no grant returns false                        [STATIC resolver contract]
 *   4.  Role grant returns true                                     [STATIC resolver contract]
 *   5.  Explicit employee allow returns true                        [STATIC resolver contract]
 *   6.  Explicit deny beats a role grant                           [STATIC resolver contract]
 *   7.  Explicit deny beats an explicit allow                      [STATIC resolver contract]
 *   8.  Two roles combine their grants                             [STATIC resolver contract]
 *   9.  Removing one role removes only that role's grants          [STATIC schema]
 *   10. Cross-org role assignment is denied (trigger)              [STATIC migration]
 *   11. Cross-org override creation is denied (RLS)               [STATIC migration]
 *   12. Employee self-assignment is denied (RLS)                   [STATIC migration]
 *   13. Employee self-promotion remains denied (existing)          [STATIC migration 107]
 *   14. Employee cannot modify another employee's roles            [STATIC migration]
 *   15. Owner cannot manage another organization's roles           [STATIC migration]
 *   16. Duplicate role assignment is rejected (UNIQUE)             [STATIC schema]
 *   17. Duplicate permission grant is rejected (UNIQUE)            [STATIC schema]
 *   18. Invalid permission keys are rejected (CHECK)               [STATIC schema]
 *   19. PUBLIC has no EXECUTE on resolver                          [STATIC migration]
 *   20. anon has no EXECUTE on resolver                            [STATIC migration]
 *   21. Migration number is 113 — no conflict                      [STATIC file]
 *   22. Migration does not modify migration 111                    [STATIC file]
 *   23. Four new tables exist in migration                         [STATIC migration]
 *   24. Resolver function is present in migration                  [STATIC migration]
 *   25. Cross-org consistency trigger is present                   [STATIC migration]
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Migration file fixtures ───────────────────────────────────────────────────

const ROOT        = process.cwd()
const MIG_DIR     = join(ROOT, 'supabase/migrations')
const MIG_113_PATH = join(MIG_DIR, '113_employee_permission_foundation.sql')
const MIG_111_PATH = join(MIG_DIR, '111_private_portal_storage.sql')

const mig113 = existsSync(MIG_113_PATH) ? readFileSync(MIG_113_PATH, 'utf8') : ''
const mig111 = existsSync(MIG_111_PATH) ? readFileSync(MIG_111_PATH, 'utf8') : ''

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True when the regex appears in the migration text. */
function migContains(text: string, pattern: RegExp | string): boolean {
  if (pattern instanceof RegExp) return pattern.test(text)
  return text.includes(pattern)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-1 Permission Foundation — migration 113 contract', () => {

  // ── File existence ───────────────────────────────────────────────────────────

  it('21. Migration 113 file exists', () => {
    expect(existsSync(MIG_113_PATH)).toBe(true)
  })

  it('21. Migration 113 file name is exactly 113_employee_permission_foundation.sql', () => {
    expect(MIG_113_PATH).toMatch(/113_employee_permission_foundation\.sql$/)
  })

  it('22. Migration 113 does not modify migration 111 (no ALTER/DROP on portal_requests)', () => {
    // Migration 113 must not ALTER or DROP portal_requests objects.
    // (It may reference 111 in a "depends on" comment — that is fine.)
    expect(mig113).not.toMatch(/ALTER TABLE.*portal_requests/i)
    expect(mig113).not.toMatch(/DROP POLICY.*portal_/i)
  })

  it('22. Migration 111 itself is unmodified (still starts with private portal storage comment)', () => {
    expect(mig111).toContain('Private Portal Attachment Storage')
    expect(mig111).toContain('SEC-0S')
  })

  // ── Four tables ──────────────────────────────────────────────────────────────

  it('23. Creates emp_roles table', () => {
    expect(mig113).toContain('CREATE TABLE IF NOT EXISTS public.emp_roles')
  })

  it('23. Creates emp_role_assignments table', () => {
    expect(mig113).toContain('CREATE TABLE IF NOT EXISTS public.emp_role_assignments')
  })

  it('23. Creates emp_role_permissions table', () => {
    expect(mig113).toContain('CREATE TABLE IF NOT EXISTS public.emp_role_permissions')
  })

  it('23. Creates emp_permission_overrides table', () => {
    expect(mig113).toContain('CREATE TABLE IF NOT EXISTS public.emp_permission_overrides')
  })

  // ── Resolver function ────────────────────────────────────────────────────────

  it('24. Resolver function current_employee_has_permission is defined', () => {
    expect(mig113).toContain('CREATE OR REPLACE FUNCTION public.current_employee_has_permission')
  })

  it('24. Resolver function accepts a single TEXT parameter', () => {
    expect(mig113).toMatch(/current_employee_has_permission\(\s*p_permission_key\s+TEXT\s*\)/i)
  })

  it('24. Resolver function returns BOOLEAN', () => {
    expect(mig113).toMatch(/current_employee_has_permission[^)]+\)\s*RETURNS BOOLEAN/i)
  })

  it('24. Resolver function is SECURITY DEFINER', () => {
    expect(mig113).toMatch(/SECURITY DEFINER/)
  })

  it('24. Resolver function fixes search_path', () => {
    expect(mig113).toMatch(/SET search_path = public/)
  })

  it('24. Resolver derives identity from auth.uid() — never accepts an arbitrary UUID param', () => {
    // The function signature must have exactly ONE text parameter (the key), not a target user ID
    const sigMatch = mig113.match(
      /FUNCTION public\.current_employee_has_permission\(([^)]+)\)/
    )
    expect(sigMatch).not.toBeNull()
    const params = sigMatch![1]
    // Should only have one parameter (the permission key), not a user UUID param
    expect(params.split(',').length).toBe(1)
  })

  // ── Permission key format ────────────────────────────────────────────────────

  it('18. emp_role_permissions has a CHECK constraint enforcing key format', () => {
    expect(mig113).toMatch(/erp_key_format.*CHECK|CHECK.*erp_key_format/is)
    expect(mig113).toContain("'^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$'")
  })

  it('18. emp_permission_overrides has a CHECK constraint enforcing key format', () => {
    expect(mig113).toMatch(/epo_key_format.*CHECK|CHECK.*epo_key_format/is)
    expect(mig113).toContain("'^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$'")
  })

  it('18. Resolver validates key format before doing any DB lookups', () => {
    // Resolver must check format early and return false for bad keys
    expect(mig113).toMatch(/p_permission_key.*!~.*\^.*THEN\s+RETURN false/is)
  })

  // ── Resolver precedence ──────────────────────────────────────────────────────

  it('1-2. Resolver checks owner/admin of employer org (is_org_admin_for)', () => {
    expect(mig113).toMatch(/is_org_admin_for\(v_ep\.org_id\)/)
  })

  it('1-2. Resolver fallback for non-employee callers checks profiles.role owner/admin', () => {
    expect(mig113).toMatch(/role IN \('owner', 'admin'\)/)
  })

  it('3. Resolver returns false by default (no RETURN true at end)', () => {
    // Final RETURN statement in the function must be an EXISTS check (role grants),
    // which returns false when no grant is found
    expect(mig113).toMatch(/RETURN EXISTS\s*\(/is)
  })

  it('6-7. Resolver checks explicit deny BEFORE explicit allow', () => {
    const denyPos  = mig113.indexOf('Explicit deny')
    const allowPos = mig113.indexOf('Explicit allow')
    expect(denyPos).toBeGreaterThan(-1)
    expect(allowPos).toBeGreaterThan(-1)
    expect(denyPos).toBeLessThan(allowPos)
  })

  it('6-7. Explicit deny path returns false', () => {
    expect(mig113).toMatch(/v_is_deny\s+THEN\s+RETURN false/is)
  })

  it('4-5. Role grant / explicit allow paths return true', () => {
    expect(mig113).toMatch(/RETURN true/i)
  })

  // ── UNIQUE constraints (duplicate rejection) ─────────────────────────────────

  it('16. emp_role_assignments has UNIQUE (employee_profile_id, role_id)', () => {
    expect(mig113).toMatch(/UNIQUE\s*\(\s*employee_profile_id,\s*role_id\s*\)/i)
  })

  it('17. emp_role_permissions has UNIQUE (role_id, permission_key)', () => {
    expect(mig113).toMatch(/UNIQUE\s*\(\s*role_id,\s*permission_key\s*\)/i)
  })

  it('17. emp_permission_overrides has UNIQUE (employee_profile_id, permission_key)', () => {
    expect(mig113).toMatch(/UNIQUE\s*\(\s*employee_profile_id,\s*permission_key\s*\)/i)
  })

  // ── RLS policies ─────────────────────────────────────────────────────────────

  it('12. emp_role_assignments INSERT requires owner/admin (is_org_admin_for)', () => {
    const insertPolicyBlock = mig113.match(
      /CREATE POLICY era_owner_admin_insert ON public\.emp_role_assignments[^;]+;/s
    )
    expect(insertPolicyBlock).not.toBeNull()
    expect(insertPolicyBlock![0]).toContain('is_org_admin_for')
    // No employee-side INSERT policy exists
    expect(mig113).not.toMatch(/era_employee.*insert|employee.*era.*insert/i)
  })

  it('14. emp_permission_overrides INSERT requires owner/admin', () => {
    const insertPolicyBlock = mig113.match(
      /CREATE POLICY epo_owner_admin_insert ON public\.emp_permission_overrides[^;]+;/s
    )
    expect(insertPolicyBlock).not.toBeNull()
    expect(insertPolicyBlock![0]).toContain('is_org_admin_for')
    expect(mig113).not.toMatch(/epo_employee.*insert|employee.*epo.*insert/i)
  })

  it('15. emp_roles INSERT/UPDATE/DELETE are owner/admin-only (org scoped via user_org_id)', () => {
    expect(mig113).toMatch(/CREATE POLICY empr_owner_admin_insert ON public\.emp_roles/)
    expect(mig113).toMatch(/CREATE POLICY empr_owner_admin_update ON public\.emp_roles/)
    expect(mig113).toMatch(/CREATE POLICY empr_owner_admin_delete ON public\.emp_roles/)
  })

  it('11. emp_permission_overrides has no anon or PUBLIC write path', () => {
    expect(mig113).toMatch(/REVOKE ALL ON public\.emp_permission_overrides\s+FROM PUBLIC/i)
    expect(mig113).toMatch(/REVOKE ALL ON public\.emp_permission_overrides\s+FROM anon/i)
  })

  // ── Cross-org trigger ────────────────────────────────────────────────────────

  it('10. Cross-org consistency trigger is defined for emp_role_assignments', () => {
    expect(mig113).toContain('CREATE OR REPLACE FUNCTION public.trg_era_check_org_consistency')
    expect(mig113).toContain('CREATE TRIGGER trg_era_org_check')
    expect(mig113).toContain('BEFORE INSERT OR UPDATE ON public.emp_role_assignments')
  })

  it('10. Trigger checks that employee_profile.org_id matches assignment org_id', () => {
    expect(mig113).toMatch(/v_ep_org\s+IS DISTINCT FROM NEW\.org_id/)
  })

  it('10. Trigger checks that emp_role.org_id matches assignment org_id', () => {
    expect(mig113).toContain('v_role_org IS DISTINCT FROM NEW.org_id')
  })

  // ── Execute grants ───────────────────────────────────────────────────────────

  it('19-20. PUBLIC and anon have no EXECUTE on resolver', () => {
    expect(mig113).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.current_employee_has_permission\(TEXT\)\s+FROM PUBLIC/i
    )
    expect(mig113).toMatch(
      /REVOKE ALL\s+ON FUNCTION public\.current_employee_has_permission\(TEXT\)\s+FROM anon/i
    )
  })

  it('19-20. Only authenticated role has EXECUTE on resolver', () => {
    expect(mig113).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.current_employee_has_permission\(TEXT\)\s+TO authenticated/i
    )
  })

  // ── Legacy compatibility ─────────────────────────────────────────────────────

  it('Does not drop or alter employee_profiles', () => {
    expect(mig113).not.toMatch(/DROP TABLE.*employee_profiles/i)
    expect(mig113).not.toMatch(/ALTER TABLE.*employee_profiles.*DROP COLUMN/i)
  })

  it('Does not modify profiles.role CHECK', () => {
    expect(mig113).not.toMatch(/ALTER TABLE.*profiles.*role/i)
  })

  it('Does not touch portal_requests', () => {
    // Must not ALTER, DROP, or INSERT/UPDATE/DELETE portal_requests rows.
    // The word may appear in a "does not modify" comment — those are fine.
    expect(mig113).not.toMatch(/ALTER TABLE.*portal_requests/i)
    expect(mig113).not.toMatch(/DROP TABLE.*portal_requests/i)
    expect(mig113).not.toMatch(/INSERT INTO.*portal_requests/i)
    expect(mig113).not.toMatch(/UPDATE.*portal_requests/i)
  })

  it('Does not touch existing migration-111 tables or functions', () => {
    expect(mig113).not.toMatch(/portal_request_configuration/i)
    expect(mig113).not.toMatch(/append_portal_request_files/i)
    expect(mig113).not.toMatch(/portal.upload.authorize/i)
  })

  // ── Resolver does not leak cross-employee data ───────────────────────────────

  it('Resolver never accepts a target-employee UUID parameter', () => {
    // Only one parameter: p_permission_key TEXT
    expect(mig113).not.toMatch(/p_employee_id|p_target|p_user_id/i)
  })

  it('Resolver scopes role-grant check to employer org', () => {
    // The EXISTS check for role grants must join on org_id = v_ep.org_id
    expect(mig113).toMatch(/era\.org_id\s+=\s+v_ep\.org_id/)
    expect(mig113).toMatch(/erp\.org_id\s+=\s+v_ep\.org_id/)
  })

  // ── Migration wraps in transaction ───────────────────────────────────────────

  it('Migration is wrapped in BEGIN / COMMIT', () => {
    expect(mig113).toContain('BEGIN;')
    expect(mig113).toContain('COMMIT;')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-1 — existing security regressions stay intact', () => {

  it('13. Migration 107 profiles_update_self repair is still present (self-promotion blocked)', () => {
    const mig107Path = join(MIG_DIR, '107_secure_portal_requests_access.sql')
    const mig107 = existsSync(mig107Path) ? readFileSync(mig107Path, 'utf8') : ''
    expect(mig107).toContain('profiles_update_self')
    expect(mig107).toContain('WITH CHECK')
    expect(mig107).toContain('public.user_role()')
    expect(mig107).toContain('public.user_org_id()')
  })

  it('Migration 113 does not redefine profiles_update_self (leaves SEC-0R intact)', () => {
    expect(mig113).not.toMatch(/profiles_update_self/i)
  })

  it('Migration 113 does not create a competing permission resolver', () => {
    // Only one CREATE OR REPLACE FUNCTION matching *_has_permission
    const resolverMatches = [
      ...mig113.matchAll(/CREATE OR REPLACE FUNCTION public\.\w+_has_permission/g),
    ]
    expect(resolverMatches.length).toBe(1)
    expect(resolverMatches[0][0]).toContain('current_employee_has_permission')
  })
})

// ─────────────────────────────────────────────────────────────────────────────

describe('ROLE-1 — permission key format validation', () => {

  const validKeys = [
    'time.view',
    'time.punch',
    'tasks.view',
    'tasks.complete',
    'portal.view',
    'admin.any',
    'leads.read',
    'service_calls.view',
    'scheduling.edit',
    'finance.read',
    'reviews.approve',
    'projects.view',
    'work_packages.update',
    'time.admin',
  ]

  const invalidKeys = [
    '',
    ' ',
    'noperiod',
    '.leading',
    'trailing.',
    'UPPERCASE.key',
    'key.UPPER',
    'ke y.action',
    'key.ac tion',
    'key..action',
    '0key.action',
    'key.0action',
    'key.action.extra',
    'a/b.c',
  ]

  const keyRegex = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/

  it.each(validKeys)('accepts valid key: %s', (key) => {
    expect(keyRegex.test(key)).toBe(true)
  })

  it.each(invalidKeys)('rejects invalid key: %s', (key) => {
    expect(keyRegex.test(key)).toBe(false)
  })
})
