import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stateful fake database: real services write through it and read back from it.
const db = vi.hoisted(() => ({
  org: 'org-1', user: 'user-1',
  tables: {} as Record<string, any[]>,
  failures: {} as Record<string, string>,
  writes: [] as Array<{ table: string; op: string; payload: any }>,
  seq: 0,
}))

const PROJECT_FACT_COLUMNS = ['billing_type', 'readiness', 'completion_requirement', 'blocked_reason', 'needs_spend',
  'work_hours_remaining', 'expected_collection_date', 'collection_confidence', 'next_action']

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: db.user } }, error: null }) },
    rpc: async () => ({ data: db.org, error: null }),
    from: (table: string) => {
      const filters: Record<string, any> = {}
      const rows = () => (db.tables[table] ??= [])
      const query: any = {
        select: () => query,
        eq: (key: string, value: any) => { filters[key] = value; return query },
        order: () => query,
        range: async (start: number, end: number) => {
          if (db.failures[table]) return { data: null, error: { message: db.failures[table] } }
          return { data: rows().filter(r => Object.entries(filters).every(([k, v]) => r[k] === v)).slice(start, end + 1), error: null }
        },
        single: async () => ({
          data: query._result ?? rows().find(r => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null,
          error: query._error ?? null }),
        maybeSingle: async () => ({ data: rows().find(r => Object.entries(filters).every(([k, v]) => r[k] === v)) ?? null, error: null }),
        insert: (row: any) => {
          db.writes.push({ table, op: 'insert', payload: row })
          if (db.failures[`write:${table}`]) { query._error = { message: db.failures[`write:${table}`] }; return query }
          const saved: any = { id: `${table}-${++db.seq}`, ...row }
          if (table === 'cash_commitments') { saved.project_id ??= null; saved.status = 'scheduled'; saved.reconciliation_state = 'unreconciled' }
          if (table === 'financial_obligations') { saved.project_id ??= null; saved.status = 'active' }
          rows().push(saved); query._result = saved
          return query
        },
        upsert: (row: any, opts: { onConflict: string }) => {
          db.writes.push({ table, op: 'upsert', payload: row })
          if (db.failures[`write:${table}`]) { query._error = { message: db.failures[`write:${table}`] }; return query }
          const keys = opts.onConflict.split(',')
          let existing = rows().find(r => keys.every(k => r[k] === row[k]))
          if (existing) Object.assign(existing, row)
          else {
            existing = { id: `${table}-${++db.seq}`, ...(table === 'cash_project_facts'
              ? Object.fromEntries(PROJECT_FACT_COLUMNS.map(c => [c, null])) : {}), ...row }
            rows().push(existing)
          }
          query._result = existing
          return query
        },
        update: (patch: any) => {
          db.writes.push({ table, op: 'update', payload: patch })
          const chain: any = {
            eq: (key: string, value: any) => { filters[key] = value; return chain },
            then: (resolve: (v: unknown) => void) => {
              rows().filter(r => Object.entries(filters).every(([k, v]) => r[k] === v)).forEach(r => Object.assign(r, patch))
              return Promise.resolve({ error: null }).then(resolve)
            },
          }
          return chain
        },
      }
      return query
    },
  },
}))

vi.mock('@/services/backupDataService', () => ({
  getActiveTenantUserId: () => db.user,
  isTenantDataReady: () => true,
  getBackupData: () => ({ projects: [], logs: [], employees: [], settings: {} }),
}))

import { readCashProjectFacts, upsertCashProjectFacts } from '@/services/cashProjectFactsService'
import {
  createCashCommitment, createFinancialObligation, readCashObligationState, updateCashCommitment, updateFinancialObligation,
} from '@/services/cashObligationService'
import { readLiabilityTerms, upsertLiabilityTerms } from '@/services/liabilityTermsService'
import { readCashOsSources, resolveCashOsScope } from '@/services/cashOsReadService'

beforeEach(() => {
  db.org = 'org-1'; db.user = 'user-1'; db.tables = {}; db.failures = {}; db.writes = []; db.seq = 0
  db.tables.organizations = [{ id: 'org-1', settings: { identity: { timezone: 'America/Los_Angeles' } } }]
  db.tables.financial_accounts = [{ id: 'care', organization_id: 'org-1', account_class: 'liability' }]
})

const commitmentBase = { title: 'Materials', amountMinor: 180000, expectedDate: '2026-10-12', isRequired: true, confidence: 'expected' as const }

describe('project facts persist and read back', () => {
  it('billing type persists and reads back, scoped to the session organization', async () => {
    await upsertCashProjectFacts('ss', { billingType: 'time_and_material' })
    const rows = await readCashProjectFacts()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ organization_id: 'org-1', project_id: 'ss', billing_type: 'time_and_material' })
    expect(db.writes[0].payload.organization_id).toBe('org-1')
  })
  it('a later partial save does not wipe facts the owner did not touch', async () => {
    await upsertCashProjectFacts('ss', { billingType: 'time_and_material' })
    await upsertCashProjectFacts('ss', { blockedReason: '  Waiting on other trades  ' })
    const [row] = await readCashProjectFacts()
    expect(row.billing_type).toBe('time_and_material')
    expect(row.blocked_reason).toBe('Waiting on other trades')
    expect(await readCashProjectFacts()).toHaveLength(1)
  })
  it('blank text clears a fact instead of storing an empty string', async () => {
    await upsertCashProjectFacts('dw', { completionRequirement: 'Install lights', readiness: 'work_required' })
    await upsertCashProjectFacts('dw', { completionRequirement: '   ' })
    expect((await readCashProjectFacts())[0].completion_requirement).toBeNull()
  })
  it('stores the completion requirement and expected collection', async () => {
    await upsertCashProjectFacts('dw', { readiness: 'work_required', completionRequirement: 'Install remaining lights and receptacles',
      workHoursRemaining: 4.25, expectedCollectionDate: '2026-10-12', collectionConfidence: 'high', needsSpend: false })
    expect((await readCashProjectFacts())[0]).toMatchObject({ readiness: 'work_required',
      completion_requirement: 'Install remaining lights and receptacles', work_hours_remaining: 4.3, // rounded to one decimal
      expected_collection_date: '2026-10-12', collection_confidence: 'high', needs_spend: false })
  })
  it('rejects nonsense before any write happens', async () => {
    await expect(upsertCashProjectFacts('dw', { readiness: 'ready_to_bill', blockedReason: 'Waiting on other trades' })).rejects.toThrow('cannot also be ready to bill')
    await expect(upsertCashProjectFacts('dw', { workHoursRemaining: -1 })).rejects.toThrow('hours')
    await expect(upsertCashProjectFacts('dw', { expectedCollectionDate: '2026-02-31' })).rejects.toThrow('date')
    await expect(upsertCashProjectFacts('dw', { billingType: 'cost_plus' as any })).rejects.toThrow('fixed price')
    await expect(upsertCashProjectFacts('', { billingType: 'fixed' })).rejects.toThrow('projectId')
    expect(db.writes).toHaveLength(0)
  })
  it('stores no balance, receivable, or amount of any kind', async () => {
    await upsertCashProjectFacts('mh', { billingType: 'fixed', readiness: 'work_required', needsSpend: true })
    const stored = Object.keys(db.writes[0].payload)
    expect(stored.some(k => /amount|balance|minor|receivable|remaining_balance|cash_required/i.test(k))).toBe(false)
  })
})

describe('project_id linkage on commitments and obligations', () => {
  it('writes project_id for a one-time required spend and reads it back as projectId', async () => {
    const { id } = await createCashCommitment({ ...commitmentBase, projectId: 'mh' })
    expect(db.writes[0].payload.project_id).toBe('mh')
    const state = await readCashObligationState()
    const commitment = state.commitments.find(c => c.id === id)!
    expect(commitment.projectId).toBe('mh')
    expect(commitment.amount.minor).toBe(180000)
  })
  it('does not force a project onto a commitment or obligation', async () => {
    await createCashCommitment({ ...commitmentBase })
    await createFinancialObligation({ name: 'Rent', amountMinor: 100000, schedule: 'monthly', anchorDate: '2026-10-01', isRequired: true, confidence: 'confirmed' })
    expect(db.writes.every(w => !('project_id' in w.payload))).toBe(true)
    const state = await readCashObligationState()
    expect(state.commitments[0].projectId ?? null).toBeNull()
    expect(state.obligations[0].projectId ?? null).toBeNull()
  })
  it('updates and clears the link', async () => {
    const { id } = await createCashCommitment({ ...commitmentBase })
    await updateCashCommitment(id, { projectId: 'mh' })
    expect((await readCashObligationState()).commitments[0].projectId).toBe('mh')
    await updateCashCommitment(id, { projectId: null })
    expect((await readCashObligationState()).commitments[0].projectId).toBeNull()
  })
  it('an obligation can be tied to a job when appropriate', async () => {
    const { id } = await createFinancialObligation({ name: 'Dumpster rental', amountMinor: 25000, schedule: 'monthly',
      anchorDate: '2026-10-01', isRequired: true, confidence: 'expected', projectId: 'mh' })
    expect((await readCashObligationState()).obligations.find(o => o.id === id)!.projectId).toBe('mh')
    await updateFinancialObligation(id, { projectId: null })
    expect((await readCashObligationState()).obligations.find(o => o.id === id)!.projectId).toBeNull()
  })
  it('every write and read is scoped to the caller organization', async () => {
    await createCashCommitment({ ...commitmentBase, projectId: 'mh' })
    expect(db.writes[0].payload.organization_id).toBe('org-1')
    db.tables.cash_commitments.push({ id: 'foreign', organization_id: 'org-2', title: 'x', amount_minor: 1, expected_date: '2026-10-01',
      is_required: true, confidence: 'confirmed', project_id: 'mh', status: 'scheduled', reconciliation_state: 'unreconciled' })
    expect((await readCashObligationState()).commitments.map(c => c.id)).not.toContain('foreign')
  })
})

describe('operational criticality is a stored owner fact', () => {
  it('stores the answer and the reason, reads them back, and clears the reason when unchecked', async () => {
    const { id } = await createCashCommitment({ ...commitmentBase, title: 'Truck', operationallyCritical: true,
      criticalReason: 'Primary work vehicle' })
    expect(db.writes[0].payload).toMatchObject({ operationally_critical: true, critical_reason: 'Primary work vehicle' })
    let commitment = (await readCashObligationState()).commitments.find(c => c.id === id)!
    expect(commitment.operationallyCritical).toBe(true)
    expect(commitment.criticalReason).toBe('Primary work vehicle')
    await updateCashCommitment(id, { operationallyCritical: false, criticalReason: 'ignored' })
    commitment = (await readCashObligationState()).commitments.find(c => c.id === id)!
    expect(commitment.operationallyCritical).toBe(false)
    expect(commitment.criticalReason).toBeNull()
  })
  it('does not send criticality columns when the owner never answered (safe before the migration is applied)', async () => {
    await createCashCommitment({ ...commitmentBase })
    expect('operationally_critical' in db.writes[0].payload).toBe(false)
  })
  it('a row from a database without the columns reads as "no fact", not as false', async () => {
    db.tables.cash_commitments = [{ id: 'legacy', organization_id: 'org-1', title: 'Old', amount_minor: 100, expected_date: '2026-10-01',
      is_required: true, confidence: 'confirmed', status: 'scheduled', reconciliation_state: 'unreconciled' }]
    expect((await readCashObligationState()).commitments[0].operationallyCritical).toBeUndefined()
  })
})

describe('debt catch-up is its own fact', () => {
  it('stores past-due and catch-up separately from the normal payment, and no balance', async () => {
    const row = await upsertLiabilityTerms('care', { minimum_payment_minor: 11300, past_due_minor: 32900, catch_up_minor: 44200,
      consequence_note: 'Late fee', operationally_critical: false })
    expect(row.minimum_payment_minor).toBe(11300)
    expect(row.past_due_minor).toBe(32900)
    expect(row.catch_up_minor).toBe(44200)
    const [read] = await readLiabilityTerms()
    expect(new Set([read.minimum_payment_minor, read.past_due_minor, read.catch_up_minor]).size).toBe(3)
    expect(Object.keys(db.writes[0].payload).some(k => /balance/i.test(k))).toBe(false)
  })
  it('editing ordinary terms without the new fields leaves any stored catch-up untouched', async () => {
    await upsertLiabilityTerms('care', { catch_up_minor: 44200 })
    await upsertLiabilityTerms('care', { minimum_payment_minor: 12000 })
    const [read] = await readLiabilityTerms()
    expect(read.catch_up_minor).toBe(44200)
    expect(read.minimum_payment_minor).toBe(12000)
  })
})

describe('Cash OS keeps working when owner facts cannot be read', () => {
  it('loads every source with empty facts and reports the failure instead of throwing', async () => {
    db.failures.cash_project_facts = 'relation "cash_project_facts" does not exist'
    const source = await readCashOsSources(await resolveCashOsScope(), null, new Date('2026-10-05T20:00:00Z'))
    expect(source.projectFacts).toEqual([])
    expect(source.projectFactsError).toContain('cash_project_facts')
    expect(source.accounts).toBeDefined()
  })
  it('includes stored facts when they can be read', async () => {
    await upsertCashProjectFacts('dw', { readiness: 'work_required', completionRequirement: 'Install lights' })
    const source = await readCashOsSources(await resolveCashOsScope(), null, new Date('2026-10-05T20:00:00Z'))
    expect(source.projectFacts?.[0].project_id).toBe('dw')
    expect(source.projectFactsError).toBeUndefined()
  })
})
