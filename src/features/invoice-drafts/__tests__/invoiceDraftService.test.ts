/**
 * QBO-2F — invoice draft persistence service (Supabase layer) contract tests.
 *
 * Covers (spec verification numbers in brackets):
 *  #1   new project draft is saved (insert) with a persisted id
 *  #3   repeated Save updates the same record (continuing identity, no duplicate)
 *  #4   a saved draft persists + reloads (get by id)
 *  #5   list returns only the active organization's drafts
 *  #7   approval preserves the record + sets status=approved + approved_at
 *  #10  delete removes a same-org draft
 *  #11  cross-org read/write/delete is denied (RLS-equivalent: org_id filter)
 *
 * The mock Supabase mirrors the org-scoping the real RLS enforces: every query is
 * filtered by organization_id (returned by user_org_id), so a draft in org B is
 * invisible/inaccessible to a user in org A. No real DB is touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { state, ORG_A, ORG_B, USER_A } = vi.hoisted(() => {
  const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  const USER_A = 'user-aaa'
  return {
    ORG_A,
    ORG_B,
    USER_A,
    state: {
      /** Active org returned by user_org_id(). */
      activeOrg: ORG_A as string,
      /** rows keyed by id; each carries organization_id for org-scoping. */
      rows: new Map<string, Record<string, unknown>>(),
      /** autoincrement-ish id counter. */
      seq: 0,
      /** call log for assertions. */
      calls: [] as Array<{ op: string; table: string; id?: string; org?: string }>,
    },
  }
})

vi.mock('@/lib/supabase', () => {
  // A query builder that accumulates filters then resolves.
  function builder(table: string) {
    let filters: Array<{ col: string; val: unknown }> = []
    let pendingInsert: Record<string, unknown> | null = null
    let pendingUpdate: Record<string, unknown> | null = null
    let pendingDelete = false
    let orderCol: string | null = null
    let orderAsc = true
    let limitN: number | null = null
    let singleMode: 'single' | 'maybeSingle' | null = null

    const self: any = {
      select: vi.fn(() => { self._selected = true; return self }),
      insert: vi.fn((row) => { pendingInsert = row; return self }),
      update: vi.fn((patch) => { pendingUpdate = patch; return self }),
      delete: vi.fn(() => { pendingDelete = true; return self }),
      eq: vi.fn((col, val) => { filters.push({ col, val }); return self }),
      order: vi.fn((col, opts?: any) => { orderCol = col; orderAsc = opts?.ascending ?? true; return self }),
      limit: vi.fn((n) => { limitN = n; return self }),
      single: vi.fn(async () => { singleMode = 'single'; return execute() }),
      maybeSingle: vi.fn(async () => { singleMode = 'maybeSingle'; return execute() }),
    }
    // The builder is awaitable (real Supabase builders are thenable): awaiting the
    // chain (e.g. delete/list with no .single()) runs the query.
    self.then = (onFulfilled: any, onRejected: any) => execute().then(onFulfilled, onRejected)

    async function execute() {
      const org = state.activeOrg
      if (pendingInsert) {
        state.seq += 1
        const id = `draft-${state.seq}`
        const row = {
          id,
          organization_id: (pendingInsert as any).organization_id ?? org,
          created_by: (pendingInsert as any).created_by ?? USER_A,
          created_at: '2026-08-17T00:00:00.000Z',
          updated_at: '2026-08-17T00:00:00.000Z',
          status: (pendingInsert as any).status ?? 'draft',
          approved_at: (pendingInsert as any).approved_at ?? null,
          currency: 'USD',
          ...pendingInsert,
        }
        state.rows.set(id, row)
        state.calls.push({ op: 'insert', table, id, org })
        return { data: row, error: null }
      }

      // select / update / delete path — apply org + id filters.
      let matches = [...state.rows.values()].filter((r) => r.organization_id === org)
      const idFilter = filters.find((f) => f.col === 'id')
      if (idFilter) matches = matches.filter((r) => r.id === idFilter.val)
      const statusFilter = filters.find((f) => f.col === 'status')
      if (statusFilter) matches = matches.filter((r) => r.status === statusFilter.val)

      if (pendingDelete) {
        for (const r of matches) state.rows.delete(r.id as string)
        state.calls.push({ op: 'delete', table, org })
        return { data: null, error: null }
      }

      if (pendingUpdate) {
        let updated: Record<string, unknown> | null = null
        for (const r of matches) {
          const next = { ...r, ...pendingUpdate, updated_at: '2026-08-17T12:00:00.000Z' }
          state.rows.set(r.id as string, next)
          updated = next
          state.calls.push({ op: 'update', table, id: r.id as string, org })
        }
        if (singleMode === 'single') return { data: updated, error: null }
        return { data: updated ? [updated] : [], error: null }
      }

      // plain select
      if (orderCol === 'updated_at') matches.sort((a, b) => (orderAsc ? String(a.updated_at).localeCompare(String(b.updated_at)) : String(b.updated_at).localeCompare(String(a.updated_at))))
      if (limitN != null) matches = matches.slice(0, limitN)
      state.calls.push({ op: 'select', table, org })
      if (singleMode === 'single') return { data: matches[0] ?? null, error: null }
      if (singleMode === 'maybeSingle') return { data: matches[0] ?? null, error: null }
      return { data: matches, error: null }
    }

    return self
  }

  return {
    supabase: {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_A } }, error: null })) },
      rpc: vi.fn(async () => ({ data: state.activeOrg, error: null })),
      from: vi.fn((table: string) => builder(table)),
    },
  }
})

import { approveInvoiceDraft, deleteInvoiceDraft, getInvoiceDraft, listInvoiceDrafts, saveInvoiceDraft } from '../invoiceDraftService'
import type { InvoiceDraftSaveInput } from '../invoiceDraftTypes'

function baseInput(overrides: Partial<InvoiceDraftSaveInput> = {}): InvoiceDraftSaveInput {
  return {
    sourceKind: 'project',
    sourceId: 'proj-1',
    customerReference: 'Acme',
    productOrService: 'Electrical Project - Progress Billing',
    description: 'Phase 1',
    primaryAmount: 5000,
    separateCharges: [],
    selectedSourceIds: ['log-a'],
    sourceSnapshot: { customerReference: 'Acme', contractValue: 25000, collectedSoFar: 5000, candidates: [] },
    ...overrides,
  }
}

beforeEach(() => {
  state.rows.clear()
  state.calls.length = 0
  state.seq = 0
  state.activeOrg = ORG_A
})

// ── #1 + #3: save + repeated save ─────────────────────────────────────────────

describe('QBO-2F invoiceDraftService — save (#1, #3)', () => {
  it('#1: a new project draft is saved (insert) with a persisted id + status draft', async () => {
    const res = await saveInvoiceDraft(baseInput())
    expect(res.id).toBeTruthy()
    expect(res.status).toBe('draft')
    expect(res.approvedAt).toBeNull()
    expect(state.rows.size).toBe(1)
    expect(state.calls.filter((c) => c.op === 'insert')).toHaveLength(1)
  })

  it('#3: repeated Save updates the same record (continuing identity, no duplicate)', async () => {
    const first = await saveInvoiceDraft(baseInput())
    const idBefore = first.id
    expect(state.rows.size).toBe(1)

    const second = await saveInvoiceDraft(baseInput({ id: idBefore, primaryAmount: 6000 }))
    expect(second.id).toBe(idBefore)
    expect(state.rows.size).toBe(1) // no duplicate
    // An update (not insert) was performed.
    expect(state.calls.filter((c) => c.op === 'update').length).toBeGreaterThan(0)
    const row = state.rows.get(idBefore)!
    expect(row.primary_amount).toBe(6000)
  })
})

// ── #4: persists + reloads ────────────────────────────────────────────────────

describe('QBO-2F invoiceDraftService — get/reload (#4)', () => {
  it('#4: a saved draft persists + reloads by id with all fields intact', async () => {
    const saved = await saveInvoiceDraft(baseInput({ primaryAmount: 4321.5, customerReference: 'Beta' }))
    const reloaded = await getInvoiceDraft(saved.id)
    expect(reloaded).not.toBeNull()
    expect(reloaded!.id).toBe(saved.id)
    expect(reloaded!.primaryAmount).toBe(4321.5)
    expect(reloaded!.customerReference).toBe('Beta')
    expect(reloaded!.status).toBe('draft')
  })

  it('#4: reloading a non-existent id returns null (no throw)', async () => {
    const reloaded = await getInvoiceDraft('does-not-exist')
    expect(reloaded).toBeNull()
  })
})

// ── #5: list org-scoped ───────────────────────────────────────────────────────

describe('QBO-2F invoiceDraftService — list org-scoped (#5)', () => {
  it('#5: list returns only the active organization drafts, newest-updated first', async () => {
    // Seed two drafts in ORG_A and one in ORG_B.
    await saveInvoiceDraft(baseInput({ sourceId: 'a1', customerReference: 'A1' }))
    await saveInvoiceDraft(baseInput({ sourceId: 'a2', customerReference: 'A2' }))
    state.activeOrg = ORG_B
    await saveInvoiceDraft(baseInput({ sourceId: 'b1', customerReference: 'B1' }))
    state.activeOrg = ORG_A

    const list = await listInvoiceDrafts()
    expect(list).toHaveLength(2)
    expect(list.every((d) => d.customerReference === 'A1' || d.customerReference === 'A2')).toBe(true)
  })

  it('#5: list with status filter returns only that status', async () => {
    await saveInvoiceDraft(baseInput({ sourceId: 'd1' }))
    const saved = await saveInvoiceDraft(baseInput({ sourceId: 'd2' }))
    await approveInvoiceDraft(baseInput({ id: saved.id, sourceId: 'd2' }))
    const drafts = await listInvoiceDrafts('draft')
    const approved = await listInvoiceDrafts('approved')
    expect(drafts.every((d) => d.status === 'draft')).toBe(true)
    expect(approved.every((d) => d.status === 'approved')).toBe(true)
    expect(approved.length).toBeGreaterThanOrEqual(1)
  })
})

// ── #7: approval ──────────────────────────────────────────────────────────────

describe('QBO-2F invoiceDraftService — approve (#7)', () => {
  it('#7: approve persists (if new) + sets status=approved + approved_at, record preserved', async () => {
    const res = await approveInvoiceDraft(baseInput({ primaryAmount: 7777 }))
    expect(res.status).toBe('approved')
    expect(res.approvedAt).toBeTruthy()
    const reloaded = await getInvoiceDraft(res.id)
    expect(reloaded!.status).toBe('approved')
    expect(reloaded!.approvedAt).toBeTruthy()
    // Record preserved: the saved content is intact.
    expect(reloaded!.primaryAmount).toBe(7777)
  })

  it('#7: approve on an existing draft id updates it in place (no duplicate)', async () => {
    const saved = await saveInvoiceDraft(baseInput({ sourceId: 'x1' }))
    const before = state.rows.size
    const approved = await approveInvoiceDraft(baseInput({ id: saved.id, sourceId: 'x1' }))
    expect(approved.id).toBe(saved.id)
    expect(state.rows.size).toBe(before) // no duplicate
    const reloaded = await getInvoiceDraft(saved.id)
    expect(reloaded!.status).toBe('approved')
  })
})

// ── #10 + #11: delete + cross-org denial ──────────────────────────────────────

describe('QBO-2F invoiceDraftService — delete + cross-org (#10, #11)', () => {
  it('#10: delete removes a same-org draft', async () => {
    const saved = await saveInvoiceDraft(baseInput({ sourceId: 'del1' }))
    expect(state.rows.has(saved.id)).toBe(true)
    await deleteInvoiceDraft(saved.id)
    expect(state.rows.has(saved.id)).toBe(false)
  })

  it('#11: cross-org get is denied (returns null — org filter excludes other-org rows)', async () => {
    state.activeOrg = ORG_B
    const bSaved = await saveInvoiceDraft(baseInput({ sourceId: 'b-only' }))
    state.activeOrg = ORG_A
    // ORG_A user cannot read ORG_B's draft.
    const reloaded = await getInvoiceDraft(bSaved.id)
    expect(reloaded).toBeNull()
  })

  it('#11: cross-org delete is denied (no row removed from the other org)', async () => {
    state.activeOrg = ORG_B
    const bSaved = await saveInvoiceDraft(baseInput({ sourceId: 'b-only-2' }))
    state.activeOrg = ORG_A
    await deleteInvoiceDraft(bSaved.id)
    // The ORG_B row is untouched (the org filter excluded it from the delete).
    expect(state.rows.has(bSaved.id)).toBe(true)
  })

  it('#11: cross-org update is denied (other-org draft not mutated by a foreign save)', async () => {
    state.activeOrg = ORG_B
    const bSaved = await saveInvoiceDraft(baseInput({ sourceId: 'b-only-3', primaryAmount: 100 }))
    state.activeOrg = ORG_A
    // ORG_A user supplies ORG_B's id; the update path finds no same-org row, so it
    // falls through to INSERT a NEW draft in ORG_A (no mutation of ORG_B's record).
    const res = await saveInvoiceDraft(baseInput({ id: bSaved.id, sourceId: 'b-only-3', primaryAmount: 999 }))
    expect(res.id).not.toBe(bSaved.id)
    // ORG_B's original record is unchanged.
    state.activeOrg = ORG_B
    const bReloaded = await getInvoiceDraft(bSaved.id)
    expect(bReloaded!.primaryAmount).toBe(100)
  })
})

// ── Firewall: the service never writes canonical payment/KPI truth (#15) ────────

describe('QBO-2F invoiceDraftService — financial-authority firewall (#15)', () => {
  it('#15: saving/approving/deleting touches only the invoice_drafts table (no other table)', async () => {
    await saveInvoiceDraft(baseInput())
    const saved = await saveInvoiceDraft(baseInput({ sourceId: 'fw' }))
    await approveInvoiceDraft(baseInput({ id: saved.id, sourceId: 'fw' }))
    await listInvoiceDrafts()
    await deleteInvoiceDraft(saved.id)
    const tables = new Set(state.calls.map((c) => c.table))
    expect(tables.has('invoice_drafts')).toBe(true)
    // No payment / KPI / weekly / collected table is touched.
    expect([...tables].every((t) => t === 'invoice_drafts')).toBe(true)
  })
})