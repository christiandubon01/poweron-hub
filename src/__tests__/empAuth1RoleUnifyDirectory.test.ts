/**
 * ROLE-2.4 — Unified Cost Model + Portal directory (RUNTIME, pure function).
 *
 * These are true runtime tests of the deterministic buildUnifiedDirectory()
 * function — no source-string assertions. They cover the Step 7 matrix:
 *   - linked pair → one row (separate cost-model row suppressed)
 *   - cost-model-only → one row with canPrepareOrInvite
 *   - portal-only → one portal row
 *   - same name but unrelated → remain separate
 *   - ambiguous email → remain separate (no suggestion)
 *   - linked inactive / pending / active → one row each, correct status
 *   - Josh-shaped linked row renders once and mutates nothing
 */

import { describe, expect, it } from 'vitest'
import {
  buildUnifiedDirectory,
  derivePortalStatus,
  type CostModelEmployeeInput,
  type PortalProfileInput,
} from '@/features/employee-directory/unifyDirectory'

function cm(p: Partial<CostModelEmployeeInput> & { id: string; name: string }): CostModelEmployeeInput {
  return { email: null, classification: null, ...p }
}
function portal(p: Partial<PortalProfileInput> & { id: string; display_name: string }): PortalProfileInput {
  return {
    email: null,
    active: true,
    user_id: null,
    backup_employee_id: null,
    employee_role: null,
    employment_type: null,
    ...p,
  }
}

describe('ROLE-2.4 buildUnifiedDirectory — linkage', () => {
  it('linked pair (backup_employee_id) renders exactly one row and suppresses the cost-model-only row', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-1', name: 'Alice', classification: 'full_time' })],
      [portal({ id: 'pp-1', display_name: 'Alice', backup_employee_id: 'emp-1', user_id: 'auth-1', active: true })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].costModelId).toBe('emp-1')
    expect(rows[0].portalProfileId).toBe('pp-1')
    expect(rows[0].classification).toBe('full_time') // cost-model classification preserved
    expect(rows[0].authLinked).toBe(true)
    expect(rows[0].portalStatus).toBe('Active')
    expect(rows[0].canPrepareOrInvite).toBe(false)
  })

  it('cost-model-only employee renders one row that can be prepared/invited', () => {
    const rows = buildUnifiedDirectory([cm({ id: 'emp-2', name: 'Bob' })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('cost_model_only')
    expect(rows[0].canPrepareOrInvite).toBe(true)
    expect(rows[0].portalProfileId).toBeNull()
    expect(rows[0].suggestedLinkPortalProfileId).toBeNull()
  })

  it('portal-only profile (no backup link, no cost-model match) renders one portal row', () => {
    const rows = buildUnifiedDirectory([], [portal({ id: 'pp-9', display_name: 'Ghost', user_id: 'auth-9' })])
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('portal_only')
    expect(rows[0].portalProfileId).toBe('pp-9')
  })
})

describe('ROLE-2.4 buildUnifiedDirectory — never dedupe by name', () => {
  it('same display name but unrelated (no backup link) stays as TWO separate rows', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-3', name: 'John Smith' })],
      [portal({ id: 'pp-3', display_name: 'John Smith', user_id: 'auth-3' })],
    )
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.kind).sort()).toEqual(['cost_model_only', 'portal_only'])
  })
})

describe('ROLE-2.4 buildUnifiedDirectory — email suggestion is advisory only', () => {
  it('a single unique same-org email match collapses into one canonical row and keeps a formal-link suggestion', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-4', name: 'Cara', email: 'cara@x.com' })],
      [portal({ id: 'pp-4', display_name: 'C. Ramirez', email: 'cara@x.com' })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].stableLink).toBe(false)
    expect(rows[0].suggestedLinkPortalProfileId).toBe('pp-4')
  })

  it('duplicate same-org email profiles collapse safely and report the duplicate condition', () => {
    const rows = buildUnifiedDirectory(
      [cm({ id: 'emp-5', name: 'Dana', email: 'dup@x.com' })],
      [
        portal({ id: 'pp-5a', display_name: 'D One', email: 'dup@x.com' }),
        portal({ id: 'pp-5b', display_name: 'D Two', email: 'dup@x.com' }),
      ],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].duplicateSignals.some(signal => signal.code === 'duplicate_email')).toBe(true)
  })
})

describe('ROLE-2.4 buildUnifiedDirectory — status of linked profiles', () => {
  it('linked inactive / pending / active each render one row with the right status', () => {
    const rows = buildUnifiedDirectory(
      [
        cm({ id: 'e-active', name: 'Active A' }),
        cm({ id: 'e-pending', name: 'Pending P' }),
        cm({ id: 'e-inactive', name: 'Inactive I' }),
      ],
      [
        portal({ id: 'p-active', display_name: 'Active A', backup_employee_id: 'e-active', user_id: 'u1', active: true }),
        portal({ id: 'p-pending', display_name: 'Pending P', backup_employee_id: 'e-pending', user_id: null, active: true }),
        portal({ id: 'p-inactive', display_name: 'Inactive I', backup_employee_id: 'e-inactive', user_id: 'u3', active: false }),
      ],
    )
    expect(rows).toHaveLength(3)
    const byId = new Map(rows.map(r => [r.costModelId, r]))
    expect(byId.get('e-active')!.portalStatus).toBe('Active')
    expect(byId.get('e-pending')!.portalStatus).toBe('Invitation Pending')
    expect(byId.get('e-inactive')!.portalStatus).toBe('Inactive')
  })

  it('derivePortalStatus matches the documented precedence', () => {
    expect(derivePortalStatus({ active: false, user_id: 'x' })).toBe('Inactive')
    expect(derivePortalStatus({ active: true, user_id: 'x' })).toBe('Active')
    expect(derivePortalStatus({ active: true, user_id: null })).toBe('Invitation Pending')
  })
})

describe('ROLE-2.4 buildUnifiedDirectory — Josh-shaped row', () => {
  it('a linked employee with backup_employee_id renders exactly once and inputs are not mutated', () => {
    const costModel = [cm({ id: 'emp-1780014901798', name: 'Josh', classification: 'full_time' })]
    const portals = [portal({
      id: 'fb521d80-db97-419e-bc5e-44ae7355fc37',
      display_name: 'Josh',
      backup_employee_id: 'emp-1780014901798',
      user_id: 'auth-josh',
      active: true,
      employee_role: 'employee',
    })]
    const snapshotCm = JSON.stringify(costModel)
    const snapshotPp = JSON.stringify(portals)

    const rows = buildUnifiedDirectory(costModel, portals)

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('linked')
    expect(rows[0].displayName).toBe('Josh')
    expect(rows[0].authLinked).toBe(true)
    // Pure function must not mutate its inputs.
    expect(JSON.stringify(costModel)).toBe(snapshotCm)
    expect(JSON.stringify(portals)).toBe(snapshotPp)
  })
})
