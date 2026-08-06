/**
 * SERVICE-LOG-1 — service-call assignment persistence + Employee Portal read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  authGetUser: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: mocks.authGetUser },
    from: mocks.from,
  },
}))

const {
  SERVICE_CALL_ASSIGNMENT_TABLE,
  getMyServiceCallAssignments,
  listServiceCallAssignments,
  syncServiceCallAssignments,
} = await import('../serviceCallAssignmentService')

const migrationSql = readFileSync(
  join(process.cwd(), 'supabase/migrations/115_service_call_employee_assignments.sql'),
  'utf8',
)

const SERVICE_CALL = {
  id: 'svc-1',
  customer: 'Smith Residence',
  address: '12 Oak St',
  date: '2026-08-04',
  jtype: 'Panel / Service',
  notes: 'Replace main breaker',
  quoted: 685,
  suggestedQuote: 437.44,
  collected: 300,
  balanceDue: 385,
  profit: 220.14,
}

/** Minimal chainable PostgREST double. */
function makeBuilder(result: any = { data: [], error: null }) {
  const calls: any[] = []
  const builder: any = {}
  const chain = (name: string) => (...args: any[]) => {
    calls.push({ name, args })
    return builder
  }
  for (const m of ['select', 'eq', 'in', 'not', 'order', 'upsert', 'delete']) {
    builder[m] = chain(m)
  }
  builder.then = (resolve: any) => Promise.resolve(result).then(resolve)
  builder.__calls = calls
  return builder
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authGetUser.mockResolvedValue({ data: { user: { id: 'owner-user' } } })
})

describe('syncServiceCallAssignments', () => {
  it('writes one row per assigned employee, keyed by employee_profiles.id', async () => {
    const builder = makeBuilder({ data: null, error: null })
    mocks.from.mockReturnValue(builder)

    const res = await syncServiceCallAssignments({
      orgId: 'org-1',
      serviceCallId: 'svc-1',
      kind: 'service_call',
      profileIds: ['profile-alex', 'profile-sam'],
      record: SERVICE_CALL,
    })

    expect(res.success).toBe(true)
    expect(mocks.from).toHaveBeenCalledWith(SERVICE_CALL_ASSIGNMENT_TABLE)
    const upsert = builder.__calls.find((c: any) => c.name === 'upsert')
    expect(upsert.args[0]).toHaveLength(2)
    expect(upsert.args[0].map((r: any) => r.employee_profile_id)).toEqual(['profile-alex', 'profile-sam'])
    expect(upsert.args[1]).toEqual({ onConflict: 'org_id,service_call_id,employee_profile_id' })
  })

  it('never sends quote, profit or collections data to the portal', async () => {
    const builder = makeBuilder({ data: null, error: null })
    mocks.from.mockReturnValue(builder)

    await syncServiceCallAssignments({
      orgId: 'org-1',
      serviceCallId: 'svc-1',
      kind: 'service_call',
      profileIds: ['profile-alex'],
      record: SERVICE_CALL,
    })

    const row = builder.__calls.find((c: any) => c.name === 'upsert').args[0][0]
    for (const forbidden of ['quoted', 'total_quoted', 'suggested_quote', 'profit', 'collected', 'balance_due']) {
      expect(row).not.toHaveProperty(forbidden)
    }
    const serialised = JSON.stringify(row)
    expect(serialised).not.toContain('685')
    expect(serialised).not.toContain('437.44')
  })

  it('deduplicates repeated profile ids', async () => {
    const builder = makeBuilder({ data: null, error: null })
    mocks.from.mockReturnValue(builder)

    const res = await syncServiceCallAssignments({
      orgId: 'org-1',
      serviceCallId: 'svc-1',
      kind: 'service_call',
      profileIds: ['profile-alex', 'profile-alex'],
      record: SERVICE_CALL,
    })

    expect(res.success && res.data.assigned).toBe(1)
    expect(builder.__calls.find((c: any) => c.name === 'upsert').args[0]).toHaveLength(1)
  })

  it('removes only the employees who are no longer assigned', async () => {
    const builder = makeBuilder({ data: null, error: null })
    mocks.from.mockReturnValue(builder)

    await syncServiceCallAssignments({
      orgId: 'org-1',
      serviceCallId: 'svc-1',
      kind: 'service_call',
      profileIds: ['profile-sam'],
      record: SERVICE_CALL,
    })

    const eqCalls = builder.__calls.filter((c: any) => c.name === 'eq')
    expect(eqCalls).toEqual(expect.arrayContaining([
      { name: 'eq', args: ['org_id', 'org-1'] },
      { name: 'eq', args: ['service_call_id', 'svc-1'] },
    ]))
    const notCall = builder.__calls.find((c: any) => c.name === 'not')
    expect(notCall.args).toEqual(['employee_profile_id', 'in', '(profile-sam)'])
  })

  it('clears every assignment when the list is emptied', async () => {
    const builder = makeBuilder({ data: null, error: null })
    mocks.from.mockReturnValue(builder)

    await syncServiceCallAssignments({
      orgId: 'org-1',
      serviceCallId: 'svc-1',
      kind: 'service_call',
      profileIds: [],
      record: SERVICE_CALL,
    })

    expect(builder.__calls.find((c: any) => c.name === 'upsert')).toBeUndefined()
    expect(builder.__calls.find((c: any) => c.name === 'delete')).toBeDefined()
    expect(builder.__calls.find((c: any) => c.name === 'not')).toBeUndefined()
  })

  it('is a no-op without an organization (local-only owner)', async () => {
    const res = await syncServiceCallAssignments({
      orgId: null,
      serviceCallId: 'svc-1',
      kind: 'service_call',
      profileIds: ['profile-alex'],
      record: SERVICE_CALL,
    })
    expect(res.success).toBe(true)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('Employee Portal read', () => {
  it('returns the service calls assigned to the signed-in employee', async () => {
    const row = {
      id: 'row-1', org_id: 'org-1', service_call_id: 'svc-1',
      service_call_kind: 'service_call', employee_profile_id: 'profile-alex',
      customer_name: 'Smith Residence', address: '12 Oak St',
      scheduled_date: '2026-08-04', job_type: 'Panel / Service',
      work_description: 'Replace main breaker', assignment_status: 'assigned',
    }
    const builder = makeBuilder({ data: [row], error: null })
    mocks.from.mockReturnValue(builder)

    const res = await getMyServiceCallAssignments('profile-alex')
    expect(res.success && res.data).toEqual([row])
    expect(builder.__calls).toEqual(expect.arrayContaining([
      { name: 'eq', args: ['employee_profile_id', 'profile-alex'] },
    ]))
  })

  it('returns nothing for an employee with no assignments', async () => {
    const builder = makeBuilder({ data: [], error: null })
    mocks.from.mockReturnValue(builder)
    const res = await getMyServiceCallAssignments('profile-unassigned')
    expect(res.success && res.data).toEqual([])
  })

  it('selects only employee-safe columns', async () => {
    const builder = makeBuilder({ data: [], error: null })
    mocks.from.mockReturnValue(builder)
    await getMyServiceCallAssignments('profile-alex')
    const cols = builder.__calls.find((c: any) => c.name === 'select').args[0]
    for (const forbidden of ['quoted', 'profit', 'margin', 'collected', 'balance']) {
      expect(cols).not.toContain(forbidden)
    }
  })

  it('short-circuits the owner read with no ids', async () => {
    const res = await listServiceCallAssignments([])
    expect(res.success && res.data).toEqual([])
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('migration 115 contract', () => {
  it('scopes assignments to an organization and a canonical employee profile', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS public.service_call_assignments')
    expect(migrationSql).toContain('org_id               UUID NOT NULL REFERENCES public.organizations(id)')
    expect(migrationSql).toContain('employee_profile_id  UUID NOT NULL REFERENCES public.employee_profiles(id)')
  })

  it('enforces one assignment per employee per service call', () => {
    expect(migrationSql).toContain('UNIQUE (org_id, service_call_id, employee_profile_id)')
  })

  it('keeps RLS on with owner/admin management and employee own-row reads', () => {
    expect(migrationSql).toContain('ALTER TABLE public.service_call_assignments ENABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('public.is_org_admin_for(org_id)')
    expect(migrationSql).toContain('sca_employee_select_own')
    expect(migrationSql).toContain('ep.user_id = auth.uid()')
  })

  it('gives employees no write policy', () => {
    expect(migrationSql).not.toMatch(/CREATE POLICY sca_employee_(insert|update|delete)/)
  })

  it('declares no financial columns', () => {
    const tableBlock = migrationSql.slice(
      migrationSql.indexOf('CREATE TABLE IF NOT EXISTS public.service_call_assignments'),
      migrationSql.indexOf('COMMENT ON TABLE public.service_call_assignments'),
    )
    for (const forbidden of ['quote', 'profit', 'margin', 'collected', 'balance', 'cost']) {
      expect(tableBlock.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('backfills the legacy technician through the stable backup_employee_id link only', () => {
    expect(migrationSql).toContain('ep.backup_employee_id = est->>\'technicianId\'')
    expect(migrationSql).toContain('ON CONFLICT ON CONSTRAINT service_call_assignments_unique_member DO NOTHING')
  })

  it('does not touch the Work Order assignment relation', () => {
    expect(migrationSql).not.toContain('ALTER TABLE public.employee_task_assignments')
    expect(migrationSql).not.toContain('DROP POLICY IF EXISTS eta_')
  })
})
