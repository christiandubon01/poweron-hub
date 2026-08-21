/**
 * QBO-2F — pure mapping + status-transition authority for persistent invoice drafts.
 *
 * Covers (spec verification numbers in brackets):
 *  #7  approval preserves the record + sets status approved
 *  #8  editing meaningful content after approval reverts to draft
 *  #9  reopening without edits preserves approved
 *  #12 source log ids / provenance survive a save → rehydrate round-trip
 *  #13 separate charges survive a save → rehydrate round-trip
 *  #14 primary amount survives exactly (money-safe, no float drift)
 *
 * All tests are pure: no React, no Supabase, no network. The status-transition
 * authority (applyStatusOnUpdate + meaningfulFieldsChanged) is the single source
 * of truth tested here.
 */
import { describe, expect, it } from 'vitest'

import type { BillingCandidate, BillingLine, PreparedBillingDraft } from '@/features/billing-draft/billingDraftTypes'
import type { BillingRead } from '@/features/billing-draft/billingDraftModalState'

import {
  applyStatusOnUpdate,
  buildDraftRowFields,
  buildSaveInputFromDraft,
  computeTotalAmount,
  mapHydratedToUiLines,
  mapRowToRecord,
  meaningfulFieldsChanged,
  recordToHydratedDraft,
  recordToSaveInput,
  round2,
} from '../invoiceDraftMapping'
import type { InvoiceDraftRecord, InvoiceDraftSaveInput, SeparateCharge } from '../invoiceDraftTypes'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeLine(id: string, amount: number, title = 'Progress Billing', description = '', candidateIds: string[] = []): BillingLine {
  return { id, title, description, amount, candidateIds }
}

function makeRead(sourceId: string, customerReference: string | null, candidates: BillingCandidate[] = []): BillingRead {
  return {
    sourceKind: 'project',
    sourceId,
    customerReference,
    contractValue: 25000,
    collectedSoFar: 5000,
    candidates,
  }
}

function makeDraft(lines: BillingLine[], selectedCandidateIds: string[] = [], sourceId = 'proj-1', customerReference: string | null = 'Acme'): PreparedBillingDraft {
  return {
    authority: 'owner_approved_outbound',
    sourceKind: 'project',
    sourceId,
    customerReference,
    contractValue: 25000,
    currentInvoiceAmount: lines.reduce((s, l) => s + l.amount, 0),
    collectedSoFar: 5000,
    paymentBalance: 20000,
    candidates: [],
    selectedCandidateIds,
    lines,
    reviewRequired: [],
    ready: true,
  }
}

function baseInput(overrides: Partial<InvoiceDraftSaveInput> = {}): InvoiceDraftSaveInput {
  return {
    sourceKind: 'project',
    sourceId: 'proj-1',
    customerReference: 'Acme',
    productOrService: 'Electrical Project - Progress Billing',
    description: 'Phase 1 rough-in',
    primaryAmount: 5000,
    separateCharges: [],
    selectedSourceIds: ['log-a', 'log-b'],
    sourceSnapshot: {
      customerReference: 'Acme',
      contractValue: 25000,
      collectedSoFar: 5000,
      candidates: [],
    },
    ...overrides,
  }
}

function makeRecord(overrides: Partial<InvoiceDraftRecord> = {}): InvoiceDraftRecord {
  return {
    id: 'draft-1',
    organizationId: 'org-1',
    createdBy: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    status: 'draft',
    approvedAt: null,
    sourceType: 'project',
    sourceKind: 'project',
    sourceId: 'proj-1',
    selectedSourceIds: ['log-a', 'log-b'],
    sourceSnapshot: {
      customerReference: 'Acme',
      contractValue: 25000,
      collectedSoFar: 5000,
      candidates: [],
    },
    customerReference: 'Acme',
    customerId: null,
    productOrService: 'Electrical Project - Progress Billing',
    description: 'Phase 1 rough-in',
    primaryAmount: 5000,
    separateCharges: [],
    totalAmount: 5000,
    currency: 'USD',
    ...overrides,
  }
}

// ── Money exactness (#14) ─────────────────────────────────────────────────────

describe('QBO-2F invoice draft mapping — money safety (#14)', () => {
  it('#14: primary amount survives exactly with no floating-point drift', () => {
    const amounts = [0.1, 0.2, 19.99, 100.0, 1234.56, 999999999.99, 0.005, 1.135]
    for (const a of amounts) {
      const fields = buildDraftRowFields(baseInput({ primaryAmount: a }))
      // NUMERIC(14,2) stores 2 decimals; round2 must reproduce it deterministically.
      expect(round2(fields.primary_amount)).toBe(round2(a))
      expect(Number.isFinite(fields.primary_amount)).toBe(true)
    }
  })

  it('computeTotalAmount sums primary + separate charges with no float drift', () => {
    const charges: SeparateCharge[] = [
      { title: 'Permit', description: '', amount: 0.1 },
      { title: 'Travel', description: '', amount: 0.2 },
    ]
    // 5000 + 0.1 + 0.2 = 5000.3 exactly (no 5000.300000000001)
    expect(computeTotalAmount(5000, charges)).toBe(5000.3)
  })
})

// ── Source ids + separate charges survival (#12, #13) ─────────────────────────

describe('QBO-2F invoice draft mapping — round-trip survival (#12, #13)', () => {
  it('#12 + #13: selected source ids, separate charges, and primary amount survive a save → row → record → hydrate → UI round-trip', () => {
    const charges: SeparateCharge[] = [
      { title: 'Permit fee', description: 'City permit', amount: 250 },
      { title: 'Travel', description: 'Mileage', amount: 75.5 },
    ]
    const input = baseInput({
      primaryAmount: 5000,
      separateCharges: charges,
      selectedSourceIds: ['log-a', 'log-b', 'log-c'],
      productOrService: 'Electrical Project - Progress Billing',
      description: 'Phase 1 rough-in',
    })

    // save input → row fields (what would be persisted)
    const fields = buildDraftRowFields(input)
    expect(fields.selected_source_ids).toEqual(['log-a', 'log-b', 'log-c'])
    expect(fields.separate_charges).toHaveLength(2)
    expect(fields.separate_charges[0].title).toBe('Permit fee')
    expect(fields.separate_charges[1].amount).toBe(75.5)
    expect(fields.primary_amount).toBe(5000)
    expect(fields.total_amount).toBe(5325.5)

    // row → record
    const row = {
      id: 'draft-1',
      organization_id: 'org-1',
      created_by: 'user-1',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-02T00:00:00.000Z',
      status: 'draft',
      approved_at: null,
      source_type: 'project',
      source_kind: 'project',
      source_id: 'proj-1',
      selected_source_ids: fields.selected_source_ids,
      source_snapshot: fields.source_snapshot,
      customer_reference: 'Acme',
      customer_id: null,
      product_or_service: fields.product_or_service,
      description: fields.description,
      primary_amount: fields.primary_amount,
      separate_charges: fields.separate_charges,
      total_amount: fields.total_amount,
      currency: 'USD',
    }
    const record = mapRowToRecord(row)

    // record → hydrated draft → UI lines
    const hydrated = recordToHydratedDraft(record)
    expect(hydrated.selectedSourceIds).toEqual(['log-a', 'log-b', 'log-c'])
    expect(hydrated.separateCharges).toHaveLength(2)
    expect(hydrated.separateCharges[1].amount).toBe(75.5)
    expect(hydrated.primaryAmount).toBe(5000)
    expect(hydrated.totalAmount).toBe(5325.5)

    const ui = mapHydratedToUiLines(hydrated)
    // PRIMARY line carries provenance; extra lines are the separate charges.
    expect(ui.lines).toHaveLength(3)
    expect(ui.lines[0].candidateIds).toEqual(['log-a', 'log-b', 'log-c'])
    expect(ui.selectedCandidateIds).toEqual(['log-a', 'log-b', 'log-c'])
    expect(ui.lines[1].title).toBe('Permit fee')
    expect(ui.lines[2].amount).toBe(75.5)
  })

  it('#12: blank separate charges are dropped (not stored as empty lines)', () => {
    const input = baseInput({
      separateCharges: [
        { title: 'Real', description: 'x', amount: 10 },
        { title: '', description: '', amount: 0 }, // fully blank → dropped
        { title: '', description: 'has desc', amount: 0 }, // has desc → kept
      ],
    })
    const fields = buildDraftRowFields(input)
    expect(fields.separate_charges).toHaveLength(2)
    expect(fields.separate_charges[0].title).toBe('Real')
    expect(fields.separate_charges[1].description).toBe('has desc')
  })
})

// ── Status transitions (#7, #8, #9) ───────────────────────────────────────────

describe('QBO-2F invoice draft status-transition authority (#7, #8, #9)', () => {
  const now = '2026-08-17T00:00:00.000Z'

  it('#7: approval preserves the record + sets approved (approved record, no meaningful change → stays approved)', () => {
    const prev = makeRecord({ status: 'approved', approvedAt: '2026-08-10T00:00:00.000Z' })
    const next = recordToSaveInput(prev) // identical content
    const t = applyStatusOnUpdate(prev, next, now)
    expect(t.status).toBe('approved')
    expect(t.approved_at).toBe('2026-08-10T00:00:00.000Z') // preserved
  })

  it('#9: reopening without editing a meaningful field preserves APPROVED', () => {
    const prev = makeRecord({
      status: 'approved',
      approvedAt: '2026-08-10T00:00:00.000Z',
      primaryAmount: 5000,
      productOrService: 'Electrical Project - Progress Billing',
      description: 'Phase 1',
      separateCharges: [{ title: 'Permit', description: 'x', amount: 250 }],
      selectedSourceIds: ['log-a'],
    })
    // Reopen with NO meaningful change (only id/customerReference non-meaningful diffs).
    const next: InvoiceDraftSaveInput = {
      id: prev.id,
      sourceKind: prev.sourceKind,
      sourceId: prev.sourceId,
      customerReference: prev.customerReference,
      customerId: prev.customerId,
      productOrService: prev.productOrService,
      description: prev.description,
      primaryAmount: prev.primaryAmount,
      separateCharges: prev.separateCharges,
      selectedSourceIds: prev.selectedSourceIds,
      sourceSnapshot: prev.sourceSnapshot,
    }
    expect(meaningfulFieldsChanged(prev, next)).toBe(false)
    const t = applyStatusOnUpdate(prev, next, now)
    expect(t.status).toBe('approved')
    expect(t.approved_at).toBe('2026-08-10T00:00:00.000Z')
  })

  it('#8: editing a meaningful billable field after approval reverts to DRAFT + clears approved_at', () => {
    const prev = makeRecord({
      status: 'approved',
      approvedAt: '2026-08-10T00:00:00.000Z',
      primaryAmount: 5000,
    })
    const next: InvoiceDraftSaveInput = { ...recordToSaveInput(prev), primaryAmount: 6000 } // meaningful: invoice amount changed
    const t = applyStatusOnUpdate(prev, next, now)
    expect(t.status).toBe('draft')
    expect(t.approved_at).toBeNull()
  })

  it('#8: editing the Product/Service title reverts to DRAFT', () => {
    const prev = makeRecord({ status: 'approved', approvedAt: '2026-08-10T00:00:00.000Z' })
    const next: InvoiceDraftSaveInput = { ...recordToSaveInput(prev), productOrService: 'Different title' }
    const t = applyStatusOnUpdate(prev, next, now)
    expect(t.status).toBe('draft')
    expect(t.approved_at).toBeNull()
  })

  it('#8: editing the description reverts to DRAFT', () => {
    const prev = makeRecord({ status: 'approved', approvedAt: '2026-08-10T00:00:00.000Z' })
    const next: InvoiceDraftSaveInput = { ...recordToSaveInput(prev), description: 'changed wording' }
    expect(applyStatusOnUpdate(prev, next, now).status).toBe('draft')
  })

  it('#8: changing selected source ids reverts to DRAFT', () => {
    const prev = makeRecord({
      status: 'approved',
      approvedAt: '2026-08-10T00:00:00.000Z',
      selectedSourceIds: ['log-a'],
    })
    const next: InvoiceDraftSaveInput = { ...recordToSaveInput(prev), selectedSourceIds: ['log-a', 'log-b'] }
    expect(applyStatusOnUpdate(prev, next, now).status).toBe('draft')
  })

  it('#8: changing a separate charge (amount) reverts to DRAFT', () => {
    const prev = makeRecord({
      status: 'approved',
      approvedAt: '2026-08-10T00:00:00.000Z',
      separateCharges: [{ title: 'Permit', description: 'x', amount: 250 }],
    })
    const next: InvoiceDraftSaveInput = { ...recordToSaveInput(prev), separateCharges: [{ title: 'Permit', description: 'x', amount: 300 }] }
    expect(applyStatusOnUpdate(prev, next, now).status).toBe('draft')
  })

  it('a DRAFT that is re-saved without approval stays DRAFT', () => {
    const prev = makeRecord({ status: 'draft', approvedAt: null })
    const next: InvoiceDraftSaveInput = { ...recordToSaveInput(prev), primaryAmount: 9999 }
    const t = applyStatusOnUpdate(prev, next, now)
    expect(t.status).toBe('draft')
    expect(t.approved_at).toBeNull()
  })
})

// ── buildSaveInputFromDraft (modal → save input) ───────────────────────────────

describe('QBO-2F buildSaveInputFromDraft (modal artifact → save input)', () => {
  it('primary line = lines[0]; separate charges = lines[1..]; selectedSourceIds = provenance', () => {
    const draft = makeDraft(
      [
        makeLine('line-1', 5000, 'Electrical Project - Progress Billing', 'Phase 1', ['log-a']),
        makeLine('line-2', 250, 'Permit', 'City', []),
        makeLine('line-3', 75.5, 'Travel', 'Mileage', []),
      ],
      ['log-a'],
    )
    const read = makeRead('proj-1', 'Acme')
    const input = buildSaveInputFromDraft({ draft, read, sourceKind: 'project' })
    expect(input.primaryAmount).toBe(5000)
    expect(input.productOrService).toBe('Electrical Project - Progress Billing')
    expect(input.description).toBe('Phase 1')
    expect(input.separateCharges).toHaveLength(2)
    expect(input.separateCharges[0].title).toBe('Permit')
    expect(input.separateCharges[1].amount).toBe(75.5)
    expect(input.selectedSourceIds).toEqual(['log-a'])
    expect(input.sourceId).toBe('proj-1')
    expect(input.customerReference).toBe('Acme')
  })

  it('snapshotOverride preserves the original snapshot when the source is no longer live', () => {
    const draft = makeDraft([makeLine('line-1', 1000)], [], 'proj-gone', 'Ghost')
    const read = makeRead('proj-gone', 'Ghost')
    const savedSnapshot = {
      customerReference: 'Ghost',
      contractValue: 99999,
      collectedSoFar: 1234,
      candidates: [],
    }
    const input = buildSaveInputFromDraft({ draft, read, sourceKind: 'project', snapshotOverride: savedSnapshot })
    // The override wins over the (empty/different) live read snapshot.
    expect(input.sourceSnapshot.contractValue).toBe(99999)
    expect(input.sourceSnapshot.collectedSoFar).toBe(1234)
  })

  // ── QBO-4A.2 Task 7: customer_id propagation ─────────────────────────────────

  it('customer_id is null when the draft carries no reconciled UUID (name-only)', () => {
    const draft = makeDraft([makeLine('line-1', 1000)], [], 'proj-1', 'Acme')
    const read = makeRead('proj-1', 'Acme')
    const input = buildSaveInputFromDraft({ draft, read, sourceKind: 'project' })
    expect(input.customerId).toBeNull()
  })

  it('customer_id propagates the reconciled UUID from the draft on the live path', () => {
    const uuid = '11111111-1111-4111-8111-111111111111'
    const draft: PreparedBillingDraft = { ...makeDraft([makeLine('line-1', 1000)], [], 'proj-1', 'Acme'), customerId: uuid }
    const read = makeRead('proj-1', 'Acme')
    const input = buildSaveInputFromDraft({ draft, read, sourceKind: 'project' })
    expect(input.customerId).toBe(uuid)
  })

  it('customerIdOverride preserves the persisted UUID on a synthetic (source-gone) reopen', () => {
    // Synthetic reopen: the source is no longer live, so the read carries no
    // accountId and draft.customerId is null. The override must preserve the
    // ORIGINAL persisted customer_id instead of nulling it.
    const persistedUuid = '22222222-2222-4222-8222-222222222222'
    const draft = makeDraft([makeLine('line-1', 1000)], [], 'proj-gone', 'Ghost')
    const read = makeRead('proj-gone', 'Ghost')
    const input = buildSaveInputFromDraft({
      draft,
      read,
      sourceKind: 'project',
      snapshotOverride: { customerReference: 'Ghost', contractValue: 99999, collectedSoFar: 1234, candidates: [] },
      customerIdOverride: persistedUuid,
    })
    expect(input.customerId).toBe(persistedUuid)
  })

  it('customerIdOverride null is honored (explicit unlink-style clear), not treated as omitted', () => {
    // `undefined` means "refresh from live"; `null` means "explicitly clear".
    const draft: PreparedBillingDraft = { ...makeDraft([makeLine('line-1', 1000)], [], 'proj-1', 'Acme'), customerId: '33333333-3333-4333-8333-333333333333' }
    const read = makeRead('proj-1', 'Acme')
    const input = buildSaveInputFromDraft({ draft, read, sourceKind: 'project', customerIdOverride: null })
    expect(input.customerId).toBeNull()
  })

  it('recordToHydratedDraft preserves customer_id so a reopened draft keeps its link', () => {
    const record: InvoiceDraftRecord = {
      id: 'd1', organizationId: 'org-1', createdBy: null, createdAt: 't', updatedAt: 't2',
      status: 'draft', approvedAt: null, sourceType: 'project', sourceKind: 'project',
      sourceId: 'proj-1', selectedSourceIds: [],
      sourceSnapshot: { customerReference: 'Acme', contractValue: null, collectedSoFar: 0, candidates: [] },
      customerReference: 'Acme', customerId: '44444444-4444-4444-8444-444444444444',
      productOrService: 'P', description: '', primaryAmount: 100, separateCharges: [],
      totalAmount: 100, currency: 'USD',
    }
    const hydrated = recordToHydratedDraft(record)
    expect(hydrated.customerId).toBe('44444444-4444-4444-8444-444444444444')
  })
})