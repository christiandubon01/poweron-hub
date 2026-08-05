/**
 * ROLE-2.2A: Link Existing Account + role-creation persistence — contract tests.
 *
 * 1.  Link Existing Account is owner-only (Crew Portal + Team)
 * 2.  Same-org unlinked profiles are listed
 * 3.  Already-linked profiles are excluded
 * 4.  Cross-org profiles are excluded
 * 5.  Unique email candidate is suggested
 * 6.  Name-only match is never auto-linked (emailMatch false when names collide)
 * 7.  Explicit owner confirmation is required (Confirm Link disabled without checkbox)
 * 8.  Link writes backup_employee_id
 * 9.  Linking does not delete either record
 * 10. Linked employee renders once (unified directory match key)
 * 11. Existing status / projects / time fields remain (update-only path)
 * 12. Role creation fresh-query persistence
 * 13. Failed role insert remains visible as an error
 * 14. Migration 114 unique index exists
 */

import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  selectUnlinkedPortalCandidates,
  derivePortalLinkStatus,
} from '@/services/adminTimecardService'

vi.mock('@/lib/supabase', () => ({
  supabase: new Proxy({} as any, { get: () => (() => ({})) }),
}))

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = join(TEST_DIR, '../..')
const SRC = join(ROOT, 'src')
const MIG_DIR = join(ROOT, 'supabase/migrations')

const TIMECARD_SRC = readFileSync(join(SRC, 'services/adminTimecardService.ts'), 'utf8')
const PORTAL_SRC = readFileSync(join(SRC, 'views/CrewPortal.tsx'), 'utf8')
const TEAM_SRC = readFileSync(join(SRC, 'components/v15r/V15rTeamPanel.tsx'), 'utf8')
const MODAL_SRC = readFileSync(join(SRC, 'features/employee-roles/RolesPermissionsModal.tsx'), 'utf8')
const CREW_SVC = readFileSync(join(SRC, 'services/crewPortalService.ts'), 'utf8')
const MIG_114 = existsSync(join(MIG_DIR, '114_employee_profiles_backup_employee_id_unique.sql'))
  ? readFileSync(join(MIG_DIR, '114_employee_profiles_backup_employee_id_unique.sql'), 'utf8')
  : ''

const ORG_A = 'org-a'
const ORG_B = 'org-b'

function profile(partial: {
  id: string
  org_id: string
  display_name: string
  email?: string | null
  active?: boolean
  user_id?: string | null
  backup_employee_id?: string | null
}) {
  return {
    id: partial.id,
    org_id: partial.org_id,
    display_name: partial.display_name,
    email: partial.email ?? null,
    active: partial.active ?? true,
    user_id: partial.user_id ?? null,
    backup_employee_id: partial.backup_employee_id ?? null,
  }
}

describe('ROLE-2.2A — Link Existing Account owner gate', () => {
  it('1. Link Existing Account is owner-only in Crew Portal and admin-gated in Team', () => {
    expect(PORTAL_SRC).toContain('Link Existing Account')
    expect(PORTAL_SRC).toMatch(/linkTarget && isOwner/)
    expect(PORTAL_SRC).toContain('linkConfirmed')
    expect(TEAM_SRC).toContain('Link Existing Account')
    expect(TEAM_SRC).toMatch(/linkTarget && isAdmin/)
  })
})

describe('ROLE-2.2A — candidate selection logic', () => {
  it('2. Same-org unlinked profiles are listed', () => {
    const candidates = selectUnlinkedPortalCandidates(
      [
        profile({ id: 'p1', org_id: ORG_A, display_name: 'Josh', email: 'josh@x.com', user_id: 'u1' }),
        profile({ id: 'p2', org_id: ORG_A, display_name: 'Test', email: 't@x.com', user_id: 'u2' }),
      ],
      ORG_A,
    )
    expect(candidates).toHaveLength(2)
    expect(candidates.map(c => c.profileId).sort()).toEqual(['p1', 'p2'])
  })

  it('3. Already-linked profiles are excluded', () => {
    const candidates = selectUnlinkedPortalCandidates(
      [
        profile({ id: 'p1', org_id: ORG_A, display_name: 'Josh', backup_employee_id: 'cm-1' }),
        profile({ id: 'p2', org_id: ORG_A, display_name: 'Open', email: 'o@x.com' }),
      ],
      ORG_A,
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].profileId).toBe('p2')
  })

  it('4. Cross-org profiles are excluded', () => {
    const candidates = selectUnlinkedPortalCandidates(
      [
        profile({ id: 'p1', org_id: ORG_A, display_name: 'Josh' }),
        profile({ id: 'p2', org_id: ORG_B, display_name: 'Other Org' }),
      ],
      ORG_A,
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].profileId).toBe('p1')
  })

  it('5. Unique email candidate is suggested', () => {
    const candidates = selectUnlinkedPortalCandidates(
      [
        profile({ id: 'p1', org_id: ORG_A, display_name: 'Josh', email: 'josh@x.com', user_id: 'u1' }),
        profile({ id: 'p2', org_id: ORG_A, display_name: 'Other', email: 'other@x.com' }),
      ],
      ORG_A,
      'josh@x.com',
    )
    expect(candidates.find(c => c.profileId === 'p1')?.emailMatch).toBe(true)
    expect(candidates.find(c => c.profileId === 'p2')?.emailMatch).toBe(false)
  })

  it('6. Name-only match is never auto-linked / suggested', () => {
    const candidates = selectUnlinkedPortalCandidates(
      [
        profile({ id: 'p1', org_id: ORG_A, display_name: 'Josh', email: 'a@x.com' }),
        profile({ id: 'p2', org_id: ORG_A, display_name: 'Joshua', email: 'b@x.com' }),
      ],
      ORG_A,
      null,
    )
    expect(candidates.every(c => c.emailMatch === false)).toBe(true)
    // Service never sets backup_employee_id from display_name alone.
    expect(TIMECARD_SRC).not.toMatch(/backup_employee_id:\s*displayName/)
    expect(TIMECARD_SRC).toContain('linkExistingEmployeeAccount')
  })

  it('7. Explicit owner confirmation is required before Confirm Link', () => {
    expect(PORTAL_SRC).toMatch(/disabled=\{linking \|\| !selectedLinkProfileId \|\| !linkConfirmed/)
    expect(TEAM_SRC).toMatch(/disabled=\{linking \|\| !selectedLinkProfileId \|\| !linkConfirmed/)
    expect(PORTAL_SRC).toContain('I confirm I want to link these two existing records.')
  })
})

describe('ROLE-2.2A — link write semantics', () => {
  it('8. Link writes backup_employee_id via update', () => {
    const fn = TIMECARD_SRC.match(/export async function linkExistingEmployeeAccount[\s\S]+?^}/m)
    expect(fn).toBeTruthy()
    expect(fn![0]).toMatch(/\.update\(\{\s*backup_employee_id:\s*(backupEmployeeId|cleanBackupId)\s*\}\)/)
    expect(fn![0]).toContain(".is('backup_employee_id', null)")
  })

  it('9. Linking does not delete either record', () => {
    const fn = TIMECARD_SRC.match(/export async function linkExistingEmployeeAccount[\s\S]+?^}/m)
    expect(fn).toBeTruthy()
    expect(fn![0]).not.toContain('.delete(')
    expect(PORTAL_SRC).toContain('Records will be linked, not deleted')
    expect(TEAM_SRC).toContain('Records will be linked, not deleted')
  })

  it('10. Linked employee renders once via backup_employee_id match', () => {
    expect(CREW_SVC).toContain('if (p.backup_employee_id) matchedBackupIds.add(p.backup_employee_id)')
    expect(CREW_SVC).toContain('if (matchedBackupIds.has(emp.id)) continue')
  })

  it('11. Existing status / projects / time fields remain (update-only; status helpers preserved)', () => {
    expect(derivePortalLinkStatus({ active: true, user_id: 'u' })).toBe('Active')
    expect(derivePortalLinkStatus({ active: true, user_id: null })).toBe('Invitation Pending')
    expect(derivePortalLinkStatus({ active: false, user_id: 'u' })).toBe('Inactive')
    const fn = TIMECARD_SRC.match(/export async function linkExistingEmployeeAccount[\s\S]+?^}/m)!
    // Only backup_employee_id is written — no status/hours/project/auth fields touched.
    expect(fn[0]).toMatch(/\.update\(\{\s*backup_employee_id:\s*(backupEmployeeId|cleanBackupId)\s*\}\)/)
    expect(fn[0]).not.toMatch(/\.update\(\{[^}]*user_id/)
    expect(fn[0]).not.toMatch(/\.update\(\{[^}]*active:/)
  })
})

describe('ROLE-2.2A — role creation persistence contracts', () => {
  // ROLE-2.4 UPDATE: createRole returns the inserted row in the same request
  // (authoritative), so persistence is trusted from that row — not re-proven by a
  // lagging reload that produced a false "not visible" error.
  it('12. Role creation trusts the authoritative returned row (no reload-gated check)', () => {
    expect(MODAL_SRC).toContain('if (!res.data?.id)')     // validates returned id
    expect(MODAL_SRC).toContain('setOrgRoles(')            // optimistic reflect
    expect(MODAL_SRC).not.toContain('const freshRoles = await loadAll()')
  })

  it('13. Failed role insert remains visible as an error', () => {
    expect(MODAL_SRC).toContain("if (!res.success) throw new Error(res.error)")
    // runMutation surfaces thrown errors into mutError UI state.
    expect(MODAL_SRC).toContain('mutError')
    expect(MODAL_SRC).toMatch(/setMutError/)
  })
})

describe('ROLE-2.2A — stable-link DB uniqueness', () => {
  it('14. Migration 114 adds org-scoped unique index on backup_employee_id', () => {
    expect(MIG_114).toContain('idx_employee_profiles_org_backup_employee_unique')
    expect(MIG_114).toMatch(/CREATE UNIQUE INDEX[\s\S]*\(org_id,\s*backup_employee_id\)/)
    expect(MIG_114).toMatch(/WHERE backup_employee_id IS NOT NULL/)
  })
})
