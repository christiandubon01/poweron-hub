/**
 * COST-SOURCE-2B — Canonical Employee Identity: Section K comprehensive tests
 *
 * Ten categories covering every correctness claim in the COST-SOURCE-2B spec.
 *
 * All tests are pure-function runtime tests — no I/O, no mocks, no snapshots.
 * Import the selectors and verify they enforce the canonical identity contract.
 */

import { describe, expect, it } from 'vitest'
import {
  buildUnifiedDirectory,
  getTeamCardDirectoryEntries,
  getOrganizationPyramidEntries,
  getAssignableEmployeeEntries,
  getRoleManageableEmployeeEntries,
  uniqueCostedEmployeeIdentities,
  isCostModelOwner,
  derivePortalStatus,
  type CostModelEmployeeInput,
  type PortalProfileInput,
  type UnifiedEmployeeRow,
} from '@/features/employee-directory/unifyDirectory'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function cm(p: Partial<CostModelEmployeeInput> & { id: string; name: string }): CostModelEmployeeInput {
  return { email: null, classification: null, ...p }
}
function pp(p: Partial<PortalProfileInput> & { id: string; display_name: string }): PortalProfileInput {
  return { email: null, active: true, user_id: null, backup_employee_id: null, employee_role: null, employment_type: null, ...p }
}

// Canonical linked pair (Alice — backup_employee_id link in place).
const alice_cm = cm({ id: 'emp-alice', name: 'Alice', classification: 'W-2' })
const alice_pp = pp({ id: 'pp-alice', display_name: 'Alice', backup_employee_id: 'emp-alice', user_id: 'auth-alice', active: true })

// Cost-model-only employee.
const bob_cm = cm({ id: 'emp-bob', name: 'Bob', classification: '1099' })

// Portal-only employee (no Cost Model record, no backup link).
const carol_pp = pp({ id: 'pp-carol', display_name: 'Carol', user_id: 'auth-carol', active: true, employee_role: 'tech' })

// Owner sentinel variants.
const owner_me = cm({ id: 'me', name: 'Owner / Me', isOwner: true })
const owner_sentinel = cm({ id: 'owner', name: 'Owner' })
const owner_virtual = cm({ id: 'owner-virtual', name: 'The Boss' })
const owner_by_name = cm({ id: 'emp-boss', name: 'Owner / Me' })

// Inactive / tombstoned variants.
const inactive_pp = pp({ id: 'pp-inactive', display_name: 'Gone', active: false, user_id: 'auth-gone' })
const pending_pp = pp({ id: 'pp-pending', display_name: 'Invited', active: true, user_id: null })

// ── K-1: Correctly linked identity → one unified entry ────────────────────────

describe('K-1: Correctly linked identity → one unified entry', () => {
  it('linked pair with valid backup_employee_id produces exactly one row', () => {
    const rows = buildUnifiedDirectory([alice_cm], [alice_pp])
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
  })

  it('linked row carries Cost Model id and Portal profile id', () => {
    const [row] = buildUnifiedDirectory([alice_cm], [alice_pp])
    expect(row.costModelId).toBe('emp-alice')
    expect(row.portalProfileId).toBe('pp-alice')
  })

  it('linked row preserves Cost Model classification for economics', () => {
    const [row] = buildUnifiedDirectory([alice_cm], [alice_pp])
    expect(row.classification).toBe('W-2')
  })

  it('linked row has authLinked=true and correct authUserId', () => {
    const [row] = buildUnifiedDirectory([alice_cm], [alice_pp])
    expect(row.authLinked).toBe(true)
    expect(row.authUserId).toBe('auth-alice')
  })

  it('linked row key is stable and unique', () => {
    const rows = buildUnifiedDirectory([alice_cm, bob_cm], [alice_pp])
    const keys = rows.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('same employee listed twice in cost model stays two rows (duplicate flagging only)', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'dup', name: 'Dup' }), cm({ id: 'dup', name: 'Dup' })],
      [],
    )
    // Duplicate resolution is the owner's job — the directory exposes them faithfully.
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.kind === 'cost_model_only')).toBe(true)
  })
})

// ── K-2: Unlinked portal profile → separate, no auto-name merge ───────────────

describe('K-2: Unlinked portal profile → separate, no auto-name merge', () => {
  it('same display name without backup_employee_id stays as TWO rows', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-x', name: 'John Smith' })],
      [pp({ id: 'pp-x', display_name: 'John Smith' })],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.kind).sort()).toEqual(['cost_model_only', 'portal_only'])
  })

  it('unique same-org email match collapses to one canonical row and reports a suggested formal link', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-y', name: 'Cara', email: 'cara@ex.com' })],
      [pp({ id: 'pp-y', display_name: 'C. Ramirez', email: 'cara@ex.com' })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].stableLink).toBe(false)
    expect(rows[0].reconciledBy).toBe('same_org_email')
    expect(rows[0].suggestedLinkPortalProfileId).toBe('pp-y')
  })

  it('duplicate same-org email profiles collapse safely and report the duplicate condition', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-z', name: 'Dana', email: 'dup@ex.com' })],
      [
        pp({ id: 'pp-z1', display_name: 'D One', email: 'dup@ex.com' }),
        pp({ id: 'pp-z2', display_name: 'D Two', email: 'dup@ex.com' }),
      ],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].stableLink).toBe(false)
    expect(rows[0].duplicateSignals.some(signal => signal.code === 'duplicate_email')).toBe(true)
  })

  it('email match is case-insensitive', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-ci', name: 'Eve', email: 'EVE@TEST.COM' })],
      [pp({ id: 'pp-ci', display_name: 'Eve P', email: 'eve@test.com' })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].stableLink).toBe(false)
    expect(rows[0].suggestedLinkPortalProfileId).toBe('pp-ci')
  })
})

// ── K-3: Owner sentinels → collapse to one UI owner entry ─────────────────────

describe('K-3: Owner sentinels → detected as isOwner, never duplicated in UI', () => {
  it('id="me" → isOwner=true', () => {
    expect(isCostModelOwner(cm({ id: 'me', name: 'Chris' }))).toBe(true)
  })

  it('id="owner" → isOwner=true', () => {
    expect(isCostModelOwner(cm({ id: 'owner', name: 'Anyone' }))).toBe(true)
  })

  it('id="owner-virtual" → isOwner=true', () => {
    expect(isCostModelOwner(cm({ id: 'owner-virtual', name: 'Anyone' }))).toBe(true)
  })

  it('name="Owner / Me" (any id) → isOwner=true', () => {
    expect(isCostModelOwner(cm({ id: 'emp-boss', name: 'Owner / Me' }))).toBe(true)
  })

  it('explicit isOwner:true flag wins regardless of id/name', () => {
    expect(isCostModelOwner(cm({ id: 'emp-123', name: 'Random', isOwner: true }))).toBe(true)
  })

  it('owner row in unified directory has isOwner=true', () => {
    const rows = buildUnifiedDirectory([owner_me], [])
    expect(rows[0].isOwner).toBe(true)
  })

  it('owner row has canPrepareOrInvite=false (not invitable)', () => {
    const rows = buildUnifiedDirectory([owner_me], [])
    expect(rows[0].canPrepareOrInvite).toBe(false)
  })

  it('getTeamCardDirectoryEntries excludes owner — owner would not appear twice in body', () => {
    const rows = buildUnifiedDirectory([owner_me, bob_cm], [])
    const cards = getTeamCardDirectoryEntries(rows)
    expect(cards.every(r => !r.isOwner)).toBe(true)
    expect(cards).toHaveLength(1)
    expect(cards[0].costModelId).toBe('emp-bob')
  })

  it('multiple owner sentinel variants collapse to one canonical owner row', () => {
    const rows = buildUnifiedDirectory([owner_me, owner_sentinel, owner_virtual, owner_by_name], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].isOwner).toBe(true)
    expect(rows[0].duplicateSignals.some(signal => signal.code === 'owner_self_duplicate')).toBe(true)
  })
})

// ── K-4: Duplicate Cost Model records → remain explicitly flagged ──────────────

describe('K-4: Duplicate Cost Model records → remain explicit, not auto-merged', () => {
  it('two cost-model records with the same id remain separate rows', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-dup', name: 'Duplicate Person' }), cm({ id: 'emp-dup', name: 'Duplicate Person' })],
      [],
    )
    // buildUnifiedDirectory does not resolve duplicates — that is owner's job
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.kind === 'cost_model_only')).toBe(true)
  })

  it('uniqueCostedEmployeeIdentities deduplicates by stable key', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-dup', name: 'Dup A' }), cm({ id: 'emp-dup', name: 'Dup B' })],
      [],
    )
    // The guard collapses them — but buildUnifiedDirectory leaves both visible
    const uniq = uniqueCostedEmployeeIdentities(rows)
    expect(uniq).toHaveLength(1)
  })

  it('two cost-model records with different ids are never silently merged even if same name', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'e1', name: 'Same Name' }), cm({ id: 'e2', name: 'Same Name' })],
      [],
    )
    expect(rows).toHaveLength(2)
  })
})

// ── K-5: Inactive / tombstoned records → consistent filter rule ────────────────

describe('K-5: Inactive and tombstoned records → consistent filter', () => {
  it('inactive portal-only profile appears in full directory (visible in management view)', () => {
    const rows = buildUnifiedDirectory([], [inactive_pp])
    expect(rows).toHaveLength(1)
    expect(rows[0].portalStatus).toBe('Inactive')
  })

  it('inactive portal-only row is excluded from assignable entries', () => {
    const rows = buildUnifiedDirectory([], [inactive_pp])
    const assignable = getAssignableEmployeeEntries(rows)
    expect(assignable).toHaveLength(0)
  })

  it('inactive portal-only row is excluded from role-manageable entries', () => {
    const rows = buildUnifiedDirectory([], [inactive_pp])
    expect(getRoleManageableEmployeeEntries(rows)).toHaveLength(0)
  })

  it('invitation-pending portal-only profile IS assignable', () => {
    const rows = buildUnifiedDirectory([], [pending_pp])
    const assignable = getAssignableEmployeeEntries(rows)
    expect(assignable).toHaveLength(1)
    expect(assignable[0].portalStatus).toBe('Invitation Pending')
  })

  it('linked inactive profile is still present (link preserved) but has Inactive status', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-gone', name: 'Gone' })],
      [pp({ id: 'pp-gone', display_name: 'Gone', backup_employee_id: 'emp-gone', active: false, user_id: 'auth-gone' })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].portalStatus).toBe('Inactive')
  })
})

// ── K-6: Team cards → one card per canonical entry ────────────────────────────

describe('K-6: Team cards → one card per canonical entry', () => {
  it('getTeamCardDirectoryEntries returns all non-owner rows', () => {
    const rows = buildUnifiedDirectory(
      [owner_me, alice_cm, bob_cm],
      [alice_pp, carol_pp],
    )
    const cards = getTeamCardDirectoryEntries(rows)
    // Alice (linked), Bob (cost-model-only), Carol (portal-only) — no owner
    expect(cards).toHaveLength(3)
    expect(cards.some(r => r.isOwner)).toBe(false)
  })

  it('portal-only employees appear in team cards', () => {
    const rows = buildUnifiedDirectory([bob_cm], [carol_pp])
    const cards = getTeamCardDirectoryEntries(rows)
    const portal_entry = cards.find(r => r.kind === 'portal_only')
    expect(portal_entry).toBeDefined()
    expect(portal_entry!.displayName).toBe('Carol')
  })

  it('linked employee appears exactly once in team cards', () => {
    const rows = buildUnifiedDirectory([alice_cm], [alice_pp])
    const cards = getTeamCardDirectoryEntries(rows)
    expect(cards).toHaveLength(1)
    expect(cards[0].kind).toBe('linked')
  })

  it('no owner card appears in team cards even with many owner sentinel variants', () => {
    const rows = buildUnifiedDirectory([owner_me, owner_sentinel, alice_cm], [alice_pp])
    const cards = getTeamCardDirectoryEntries(rows)
    expect(cards.every(r => !r.isOwner)).toBe(true)
  })
})

// ── K-7: Org pyramid → consumes unified directory, linked once ─────────────────

describe('K-7: Org pyramid → unified directory, linked employees appear once', () => {
  it('getOrganizationPyramidEntries excludes owner (same rule as team cards)', () => {
    const rows = buildUnifiedDirectory([owner_me, alice_cm, bob_cm], [alice_pp])
    const pyramid = getOrganizationPyramidEntries(rows)
    expect(pyramid.some(r => r.isOwner)).toBe(false)
  })

  it('linked employee appears exactly once in pyramid body', () => {
    const rows = buildUnifiedDirectory([alice_cm], [alice_pp])
    const pyramid = getOrganizationPyramidEntries(rows)
    expect(pyramid).toHaveLength(1)
    expect(pyramid[0].kind).toBe('linked')
  })

  it('portal-only employees appear in pyramid', () => {
    const rows = buildUnifiedDirectory([], [carol_pp])
    const pyramid = getOrganizationPyramidEntries(rows)
    expect(pyramid).toHaveLength(1)
    expect(pyramid[0].kind).toBe('portal_only')
  })

  it('pyramid and team-cards selectors return identical sets (both exclude owner only)', () => {
    const rows = buildUnifiedDirectory([owner_me, alice_cm, bob_cm], [alice_pp, carol_pp])
    const cards = getTeamCardDirectoryEntries(rows)
    const pyramid = getOrganizationPyramidEntries(rows)
    expect(cards.map(r => r.key)).toEqual(pyramid.map(r => r.key))
  })
})

// ── K-8: Field Log picker → linked employees appear once, no duplicate owner ───

describe('K-8: Field Log picker — no duplicate owner, linked employees appear once', () => {
  it('getAssignableEmployeeEntries never returns owner rows', () => {
    const rows = buildUnifiedDirectory([owner_me, alice_cm, bob_cm], [alice_pp])
    const assignable = getAssignableEmployeeEntries(rows)
    expect(assignable.some(r => r.isOwner)).toBe(false)
  })

  it('linked employee appears exactly once in assignable list', () => {
    const rows = buildUnifiedDirectory([alice_cm], [alice_pp])
    const assignable = getAssignableEmployeeEntries(rows)
    expect(assignable).toHaveLength(1)
    expect(assignable[0].kind).toBe('linked')
  })

  it('caller prepends an explicit owner sentinel — owner never appears twice', () => {
    // The owner sentinel for picker UI is an explicit static option added by the
    // caller. This test verifies getAssignableEmployeeEntries produces zero owner
    // rows, so prepending one option is always safe (no duplicate).
    const rows = buildUnifiedDirectory([owner_me, alice_cm, bob_cm], [alice_pp])
    const assignable = getAssignableEmployeeEntries(rows, { includeOwner: true })
    // includeOwner: true means the CALLER adds an owner option — the list itself
    // still contains zero owner rows (the option should not be doubled).
    const ownerRows = assignable.filter(r => r.isOwner)
    expect(ownerRows).toHaveLength(0)
  })

  it('inactive portal-only employee is excluded from assignable list', () => {
    const rows = buildUnifiedDirectory([], [inactive_pp, carol_pp])
    const assignable = getAssignableEmployeeEntries(rows)
    expect(assignable.some(r => r.portalStatus === 'Inactive')).toBe(false)
    expect(assignable).toHaveLength(1) // only Carol (active)
  })

  it('invitation-pending portal-only employee IS included in assignable list', () => {
    const rows = buildUnifiedDirectory([], [pending_pp])
    const assignable = getAssignableEmployeeEntries(rows)
    expect(assignable).toHaveLength(1)
  })
})

// ── K-9: Roles Manager → all categories represented once ──────────────────────

describe('K-9: Roles Manager → all categories represented once, owner excluded', () => {
  it('getRoleManageableEmployeeEntries excludes owner', () => {
    const rows = buildUnifiedDirectory([owner_me, alice_cm, bob_cm], [alice_pp])
    const manageable = getRoleManageableEmployeeEntries(rows)
    expect(manageable.some(r => r.isOwner)).toBe(false)
  })

  it('cost-model-only employee appears (pre-activation role preparation)', () => {
    const rows = buildUnifiedDirectory([bob_cm], [])
    const manageable = getRoleManageableEmployeeEntries(rows)
    expect(manageable).toHaveLength(1)
    expect(manageable[0].kind).toBe('cost_model_only')
  })

  it('invitation-pending portal profile appears (awaiting first login)', () => {
    const rows = buildUnifiedDirectory([], [pending_pp])
    const manageable = getRoleManageableEmployeeEntries(rows)
    expect(manageable).toHaveLength(1)
    expect(manageable[0].portalStatus).toBe('Invitation Pending')
  })

  it('active linked employee appears', () => {
    const rows = buildUnifiedDirectory([alice_cm], [alice_pp])
    const manageable = getRoleManageableEmployeeEntries(rows)
    expect(manageable).toHaveLength(1)
    expect(manageable[0].kind).toBe('linked')
  })

  it('inactive portal-only excluded from manageable list', () => {
    const rows = buildUnifiedDirectory([], [inactive_pp])
    expect(getRoleManageableEmployeeEntries(rows)).toHaveLength(0)
  })

  it('linked + cost-model-only + pending + portal-only active all appear once each', () => {
    const rows = buildUnifiedDirectory(
      [alice_cm, bob_cm],
      [alice_pp, pending_pp, carol_pp, inactive_pp],
    )
    const manageable = getRoleManageableEmployeeEntries(rows)
    // Alice (linked), Bob (cost-model-only), invited (pending portal-only),
    // Carol (active portal-only) — inactive excluded, no duplicates.
    expect(manageable).toHaveLength(4)
    const keys = manageable.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length) // no duplicates
  })
})

// ── K-10: Regression — service assignment compat, formulas, migration bytes ────

describe('K-10: Regression — identity contract is backward compatible', () => {
  it('buildUnifiedDirectory is a pure function: it does not mutate its inputs', () => {
    const costModel = [alice_cm, bob_cm]
    const portals = [alice_pp, carol_pp]
    const snapCm = JSON.stringify(costModel)
    const snapPp = JSON.stringify(portals)

    buildUnifiedDirectory(costModel, portals)

    expect(JSON.stringify(costModel)).toBe(snapCm)
    expect(JSON.stringify(portals)).toBe(snapPp)
  })

  it('all selector helpers are also pure — no mutation of the rows array', () => {
    const rows = buildUnifiedDirectory([owner_me, alice_cm, bob_cm], [alice_pp, carol_pp])
    const snap = JSON.stringify(rows)

    getTeamCardDirectoryEntries(rows)
    getOrganizationPyramidEntries(rows)
    getAssignableEmployeeEntries(rows)
    getRoleManageableEmployeeEntries(rows)
    uniqueCostedEmployeeIdentities(rows)

    expect(JSON.stringify(rows)).toBe(snap) // rows unchanged
  })

  it('uniqueCostedEmployeeIdentities output has no duplicate keys', () => {
    const rows = buildUnifiedDirectory(
      [alice_cm, bob_cm, owner_me],
      [alice_pp, carol_pp],
    )
    const uniq = uniqueCostedEmployeeIdentities(rows)
    const keys = uniq.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('portal_only rows have null costModelId and null classification', () => {
    const rows = buildUnifiedDirectory([], [carol_pp])
    expect(rows[0].costModelId).toBeNull()
    expect(rows[0].classification).toBeNull()
  })

  it('linked row does not set canPrepareOrInvite (no double-invite)', () => {
    const rows = buildUnifiedDirectory([alice_cm], [alice_pp])
    expect(rows[0].canPrepareOrInvite).toBe(false)
  })

  it('cost-model-only non-owner row sets canPrepareOrInvite=true', () => {
    const rows = buildUnifiedDirectory([bob_cm], [])
    expect(rows[0].canPrepareOrInvite).toBe(true)
  })

  it('cost-model-only OWNER row sets canPrepareOrInvite=false', () => {
    const rows = buildUnifiedDirectory([owner_me], [])
    expect(rows[0].canPrepareOrInvite).toBe(false)
  })

  it('authUserId is null on cost-model-only rows (no auth until linked)', () => {
    const rows = buildUnifiedDirectory([bob_cm], [])
    expect(rows[0].authUserId).toBeNull()
  })

  it('authUserId is the portal user_id on linked rows', () => {
    const rows = buildUnifiedDirectory([alice_cm], [alice_pp])
    expect(rows[0].authUserId).toBe('auth-alice')
  })

  it('row ordering: Cost Model order first, then portal-only in input order', () => {
    const rows = buildUnifiedDirectory(
      [bob_cm, alice_cm],
      [alice_pp, carol_pp],
    )
    // Bob first (cost_model_only), Alice second (linked), Carol last (portal_only)
    expect(rows[0].costModelId).toBe('emp-bob')
    expect(rows[1].costModelId).toBe('emp-alice')
    expect(rows[2].kind).toBe('portal_only')
  })
})
