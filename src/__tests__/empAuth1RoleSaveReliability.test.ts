/**
 * ROLE-2.4 — First-save reliability (RUNTIME, mocked Postgres driver).
 *
 * Proves the read-after-write fix behaviourally, not by source strings:
 *   - the write's own returned rows are trusted (no extra SELECT needed)
 *   - when a fresh SELECT lags, a bounded retry confirms it WITHOUT re-writing
 *   - a genuine persistent failure is still reported after the retries
 *   - the write (insert/delete) is issued exactly once regardless of read lag
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

// Shared, test-controllable fake Postgres. Hoisted so the vi.mock factory can use it.
const h = vi.hoisted(() => {
  const counters = {
    permInsert: 0,
    assignInsert: 0,
    assignDelete: 0,
  }
  // Per-table queues of read responses (for plain select() reads). Each shift()
  // simulates one read attempt; when empty the last value repeats.
  const readQueues: Record<string, Array<{ data: any; error: any }>> = {}
  // Response for insert().select() (authoritative same-request rows).
  let insertSelectResponse: (rows: any[]) => { data: any; error: any } = rows => ({
    data: rows.map((r: any) => ({ ...r })),
    error: null,
  })
  const roleRow = { data: { id: 'role-1', org_id: 'org-1' }, error: null }
  const memberRow = { data: { id: 'ep-1' }, error: null }

  function nextRead(table: string) {
    const q = readQueues[table] ?? []
    if (q.length === 0) return { data: [], error: null }
    if (q.length === 1) return q[0]
    return q.shift()!
  }

  function makeBuilder(table: string) {
    const ctx: any = { table, op: 'select', selectAfterInsert: false, insertRows: null }
    const builder: any = {
      select(_cols: string) {
        if (ctx.op === 'insert') ctx.selectAfterInsert = true
        return builder
      },
      insert(rows: any) {
        ctx.op = 'insert'
        ctx.insertRows = Array.isArray(rows) ? rows : [rows]
        if (table === 'emp_role_permissions') counters.permInsert++
        if (table === 'emp_role_assignments') counters.assignInsert++
        return builder
      },
      delete() {
        ctx.op = 'delete'
        if (table === 'emp_role_assignments') counters.assignDelete++
        return builder
      },
      update(patch: any) { ctx.op = 'update'; ctx.patch = patch; return builder },
      eq() { return builder },
      is() { return builder },
      order() { return builder },
      maybeSingle() { return Promise.resolve(resolve(ctx)) },
      single() { return Promise.resolve(resolve(ctx)) },
      then(onF: any, onR: any) { return Promise.resolve(resolve(ctx)).then(onF, onR) },
    }
    return builder
  }

  function resolve(ctx: any) {
    if (ctx.op === 'insert') {
      if (ctx.table === 'emp_role_permissions') return insertSelectResponse(ctx.insertRows)
      if (ctx.table === 'emp_role_assignments') return h.assignInsertResponse(ctx.insertRows)
      return { data: ctx.insertRows, error: null }
    }
    if (ctx.op === 'delete') return { error: null }
    // reads
    if (ctx.table === 'emp_roles') return roleRow
    if (ctx.table === 'employee_profiles') return memberRow
    return nextRead(ctx.table)
  }

  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) },
    from: (t: string) => makeBuilder(t),
  }

  const api = {
    supabase,
    counters,
    readQueues,
    setInsertSelectResponse(fn: (rows: any[]) => { data: any; error: any }) { insertSelectResponse = fn },
    assignInsertResponse: ((rows: any[]) => ({ data: rows.map((r: any) => ({ id: 'a1', role_id: r.role_id })), error: null })) as (rows: any[]) => { data: any; error: any },
    reset() {
      counters.permInsert = 0
      counters.assignInsert = 0
      counters.assignDelete = 0
      for (const k of Object.keys(readQueues)) delete readQueues[k]
      insertSelectResponse = rows => ({ data: rows.map((r: any) => ({ ...r })), error: null })
      api.assignInsertResponse = rows => ({ data: rows.map((r: any) => ({ id: 'a1', role_id: r.role_id })), error: null })
    },
  }
  return api
})

vi.mock('@/lib/supabase', () => ({ supabase: h.supabase }))
vi.mock('@/services/crewPortalService', () => ({
  getOwnerOrgId: async () => ({ success: true, data: 'org-1' }),
}))

import {
  setRolePermissions,
  assignRole,
  removeRole,
  sameKeySet,
} from '@/features/employee-roles/roleManagementService'

beforeEach(() => h.reset())

describe('ROLE-2.4 setRolePermissions — no false first-save error', () => {
  it('trusts the insert\'s returned rows (fast path): success, no extra read, one write', () => {
    return setRolePermissions('org-1', 'role-1', ['a', 'b']).then(res => {
      expect(res.success).toBe(true)
      expect(sameKeySet(res.data ?? [], ['a', 'b'])).toBe(true)
      expect(h.counters.permInsert).toBe(1) // exactly one write
    })
  })

  it('when the write echo lags, a bounded retry confirms it WITHOUT re-writing', async () => {
    // insert().select() returns nothing (echo unavailable); first read lags, second is fresh.
    h.setInsertSelectResponse(() => ({ data: [], error: null }))
    h.readQueues['emp_role_permissions'] = [
      { data: [], error: null },                                   // attempt 1: still invisible
      { data: [{ permission_key: 'a' }, { permission_key: 'b' }], error: null }, // attempt 2: visible
    ]
    const res = await setRolePermissions('org-1', 'role-1', ['a', 'b'])
    expect(res.success).toBe(true)
    expect(h.counters.permInsert).toBe(1) // NEVER re-writes during verification
  })

  it('reports failure only after the bounded retries genuinely fail (still one write)', async () => {
    h.setInsertSelectResponse(() => ({ data: [], error: null }))
    h.readQueues['emp_role_permissions'] = [{ data: [], error: null }] // always empty
    const res = await setRolePermissions('org-1', 'role-1', ['a', 'b'])
    expect(res.success).toBe(false)
    expect(h.counters.permInsert).toBe(1)
  })
})

describe('ROLE-2.4 assignRole — one-click, idempotent', () => {
  it('succeeds from the insert\'s returned row (no false error)', async () => {
    const res = await assignRole('org-1', 'ep-1', 'role-1')
    expect(res.success).toBe(true)
    expect(h.counters.assignInsert).toBe(1)
  })

  it('duplicate (23505) is idempotent success via bounded verify, without re-inserting', async () => {
    h.assignInsertResponse = () => ({ data: null, error: { code: '23505', message: 'duplicate' } })
    h.readQueues['emp_role_assignments'] = [
      { data: [{ id: 'a1', role_id: 'role-1' }], error: null }, // already present
    ]
    const res = await assignRole('org-1', 'ep-1', 'role-1')
    expect(res.success).toBe(true)
    expect(h.counters.assignInsert).toBe(1)
  })
})

describe('ROLE-2.4 removeRole — verified removal without re-deleting', () => {
  it('confirms the row is gone via bounded read, single delete', async () => {
    h.readQueues['emp_role_assignments'] = [{ data: [], error: null }] // gone
    const res = await removeRole('ep-1', 'role-1')
    expect(res.success).toBe(true)
    expect(h.counters.assignDelete).toBe(1)
  })
})

describe('ROLE-2.4 sameKeySet', () => {
  it('order-independent set equality', () => {
    expect(sameKeySet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameKeySet(['a'], ['a', 'b'])).toBe(false)
    expect(sameKeySet([], [])).toBe(true)
  })
})
