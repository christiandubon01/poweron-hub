/**
 * SERVICE-LOG-1 — multi-employee assignment contract.
 */
import { describe, expect, it } from 'vitest'
import {
  OWNER_ASSIGNEE_ID,
  addAssignment,
  assignedProfileIds,
  assignmentKey,
  buildAssignableEmployeeOptions,
  buildServiceCallPortalPayload,
  hydrateAssignmentIdentities,
  isOwnerAssignment,
  normalizeAssignments,
  payloadOmitsFinancials,
  removeAssignment,
  summarizeAssignments,
} from '../serviceAssignments'

const COST_MODEL = [
  { id: 'emp-alex', name: 'Alex Rivera', email: 'alex@example.com' },
  { id: 'emp-sam', name: 'Sam Chen', email: 'sam@example.com' },
  { id: 'emp-nolink', name: 'Jordan Diaz', email: null },
]

const PORTAL = [
  {
    id: 'profile-alex', display_name: 'Alex Rivera', email: 'alex@example.com',
    active: true, user_id: 'user-alex', backup_employee_id: 'emp-alex',
  },
  {
    id: 'profile-sam', display_name: 'Sam Chen', email: 'sam@example.com',
    active: true, user_id: 'user-sam', backup_employee_id: 'emp-sam',
  },
]

describe('assignable employee options', () => {
  it('joins the two rosters on the stable backup_employee_id link', () => {
    const options = buildAssignableEmployeeOptions(COST_MODEL, PORTAL)
    const alex = options.find(o => o.employeeId === 'emp-alex')
    expect(alex?.profileId).toBe('profile-alex')
    expect(alex?.portalLinked).toBe(true)
    // Linked people are not duplicated.
    expect(options.filter(o => o.name === 'Alex Rivera')).toHaveLength(1)
  })

  it('keeps an unlinked cost-model employee selectable but not portal-linked', () => {
    const options = buildAssignableEmployeeOptions(COST_MODEL, PORTAL)
    const jordan = options.find(o => o.employeeId === 'emp-nolink')
    expect(jordan?.profileId).toBeNull()
    expect(jordan?.portalLinked).toBe(false)
  })

  it('never matches people by display name alone', () => {
    const options = buildAssignableEmployeeOptions(
      [{ id: 'emp-x', name: 'Alex Rivera', email: null }],
      PORTAL,
    )
    const x = options.find(o => o.employeeId === 'emp-x')
    expect(x?.profileId).toBeNull()
  })

  it('offers Owner / Me when requested', () => {
    const options = buildAssignableEmployeeOptions(COST_MODEL, PORTAL, { includeOwner: true })
    expect(options[0].employeeId).toBe(OWNER_ASSIGNEE_ID)
    expect(isOwnerAssignment(options[0])).toBe(true)
  })
})

describe('assignment set operations', () => {
  const alex = { employeeId: 'emp-alex', profileId: 'profile-alex', name: 'Alex Rivera' }
  const sam = { employeeId: 'emp-sam', profileId: 'profile-sam', name: 'Sam Chen' }

  it('assigns two employees to one service job', () => {
    const list = addAssignment(addAssignment([], alex), sam)
    expect(list).toHaveLength(2)
    expect(assignedProfileIds(list)).toEqual(['profile-alex', 'profile-sam'])
  })

  it('prevents duplicate assignment of the same employee', () => {
    const list = addAssignment(addAssignment([], alex), { ...alex, name: 'Alex R.' })
    expect(list).toHaveLength(1)
  })

  it('treats the same person selected via either roster id as one assignment', () => {
    const list = addAssignment(
      addAssignment([], alex),
      { employeeId: null, profileId: 'profile-alex', name: 'Alex Rivera' },
    )
    expect(list).toHaveLength(1)
  })

  it('removing one employee leaves the other assignments intact', () => {
    const list = addAssignment(addAssignment([], alex), sam)
    const after = removeAssignment(list, assignmentKey(alex))
    expect(after).toHaveLength(1)
    expect(after[0].profileId).toBe('profile-sam')
  })

  it('round-trips through a stored record so reopening shows both', () => {
    const list = addAssignment(addAssignment([], alex), sam)
    const stored = { id: 'est1', assignedEmployees: list }
    const reopened = normalizeAssignments(stored)
    expect(reopened).toHaveLength(2)
    expect(reopened.map(a => a.profileId)).toEqual(['profile-alex', 'profile-sam'])
  })

  it('stores ids, not names or emails', () => {
    const list = addAssignment([], alex)
    expect(list[0]).toEqual({ employeeId: 'emp-alex', profileId: 'profile-alex', name: 'Alex Rivera' })
    expect(assignedProfileIds(list)).toEqual(['profile-alex'])
  })

  it('drops unlinked people from the portal write without losing the assignment', () => {
    const list = addAssignment([], { employeeId: 'emp-nolink', profileId: null, name: 'Jordan Diaz' })
    expect(list).toHaveLength(1)
    expect(assignedProfileIds(list)).toEqual([])
  })

  it('summarises for list rows', () => {
    const list = addAssignment(addAssignment([], alex), sam)
    expect(summarizeAssignments(list)).toBe('Alex Rivera, Sam Chen')
    expect(summarizeAssignments(list, 1)).toBe('Alex Rivera +1')
  })
})

describe('legacy technician migration', () => {
  it('reads a pre-phase single technician as one assignment', () => {
    const legacy = { id: 'est-old', technicianId: 'emp-alex', technician: 'Alex Rivera' }
    const list = normalizeAssignments(legacy)
    expect(list).toEqual([{ employeeId: 'emp-alex', profileId: null, name: 'Alex Rivera' }])
  })

  it('re-resolves portal identity for a legacy assignment', () => {
    const options = buildAssignableEmployeeOptions(COST_MODEL, PORTAL)
    const hydrated = hydrateAssignmentIdentities(
      normalizeAssignments({ technicianId: 'emp-alex', technician: 'Alex Rivera' }),
      options,
    )
    expect(hydrated[0].profileId).toBe('profile-alex')
  })

  it('returns an empty list for a record with no assignment at all', () => {
    expect(normalizeAssignments({ id: 'svc1' })).toEqual([])
  })
})

describe('employee-facing payload', () => {
  const ownerRecord = {
    id: 'svc-1',
    customer: 'Smith Residence',
    address: '12 Oak St',
    date: '2026-08-04',
    jtype: 'Panel / Service',
    notes: 'Replace main breaker',
    quoted: 685,
    totalQuote: 685,
    suggestedQuote: 437.44,
    quotedManual: true,
    profit: 220.14,
    collected: 300,
    balanceDue: 385,
    mat: 45,
    payStatus: 'P',
  }

  it('carries the job facts an employee needs', () => {
    const payload = buildServiceCallPortalPayload(ownerRecord, 'service_call')
    expect(payload).toEqual({
      serviceCallId: 'svc-1',
      serviceCallKind: 'service_call',
      customerName: 'Smith Residence',
      address: '12 Oak St',
      scheduledDate: '2026-08-04',
      jobType: 'Panel / Service',
      workDescription: 'Replace main breaker',
      status: 'assigned',
    })
  })

  it('omits every internal financial field', () => {
    const payload = buildServiceCallPortalPayload(ownerRecord, 'service_call')
    expect(payloadOmitsFinancials(payload as unknown as Record<string, unknown>)).toBe(true)
    const serialised = JSON.stringify(payload)
    expect(serialised).not.toContain('685')
    expect(serialised).not.toContain('437.44')
    expect(serialised).not.toContain('profit')
  })
})
