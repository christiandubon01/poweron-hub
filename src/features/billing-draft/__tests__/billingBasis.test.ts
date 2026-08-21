/**
 * QBO-2D focused tests — Billing Basis (service total-vs-itemized + project log origin).
 *
 * Project billing candidates are real Project Logs (no structured amount, no
 * representation mode); service candidates retain the total-vs-itemized basis
 * exclusivity (that distinction is real for service calls). These tests pin the
 * basis behavior under the QBO-BASIS-* namespace.
 *
 * QBO-BASIS-1   Service total mode is valid.
 * QBO-BASIS-2   Service itemized labor + material mode is valid.
 * QBO-BASIS-3   Service total + labor/material combination is rejected as overlapping representation (INVALID).
 * QBO-BASIS-4   Itemized service total equals the structured service billable total.
 * QBO-BASIS-5   Project billing candidates are real Project Log records (not synthesized events).
 * QBO-BASIS-6   Project log candidates carry no structured amount and no representation mode.
 * QBO-BASIS-7   Multiple project logs are independently selectable.
 * QBO-BASIS-8   Selecting project logs does not manufacture a per-log billing amount.
 * QBO-BASIS-9   The owner may bill any partial amount against selected logs.
 * QBO-BASIS-10  Billing a service call under total + component at once is rejected (double-count).
 * QBO-BASIS-11  No prose dollar value affects the billing amount.
 * QBO-BASIS-12  Payment / collected history does not alter the draft invoice amount.
 * QBO-BASIS-13  No QBO value participates in amount / capacity calculations.
 * QBO-BASIS-14  Source objects remain immutable through draft creation.
 */
import { describe, expect, it } from 'vitest'

import { makeBillingLine, prepareBillingDraft } from '../billingDraftModel'
import { readProjectBilling } from '../projectBillingAdapter'
import { readServiceBilling } from '../serviceBillingAdapter'
import type { BackupData, BackupLog, BackupProject, BackupServiceLog } from '@/services/backupDataService'

const SVC_TITLE = 'Electrical Work - Service Work'
const PROJ_TITLE = 'Electrical Project - Progress Billing'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeProject(over: Partial<BackupProject> = {}): BackupProject {
  return {
    id: 'proj-1', name: 'Test Project', type: 'service', status: 'active',
    contract: 0, billed: 0, paid: 0, mileRT: 0, phases: {}, logs: [], finance: {},
    changeOrders: [], ...over,
  } as BackupProject
}
function makeBackup(logs: BackupLog[] = []): BackupData {
  return { logs, projects: [], serviceLogs: [] } as unknown as BackupData
}
function workLog(id: string, projId: string, over: Partial<BackupLog> = {}): BackupLog {
  return {
    id, emp: '', hrs: 0, mat: 0, date: '2025-01-05', empId: '', miles: 0, notes: 'Work performed',
    phase: 'Rough-in', store: '', profit: 0, projId, quoted: 0, projName: '', detailLink: '',
    projectQuote: 0, emergencyMatInfo: '', collected: 0, ...over,
  } as BackupLog
}
function makeServiceLog(over: Partial<BackupServiceLog> = {}): BackupServiceLog {
  return {
    id: 'svc-1', hrs: 0, mat: 0, date: '2025-01-01', jtype: 'Other', miles: 0, notes: '',
    store: '', opCost: 0, profit: 0, quoted: 0, customer: 'Test Customer', collected: 0,
    payStatus: 'N', balanceDue: 0, ...over,
  } as BackupServiceLog
}

// ── Service: total vs itemized ────────────────────────────────────────────────

describe('QBO-2D service basis (QBO-BASIS-1..4,10)', () => {
  // Structured service: total billable $671, materials $71, labor $600.
  const serviceLog = () => makeServiceLog({ quoted: 671, mat: 71, collected: 0 })

  it('QBO-BASIS-1: service total mode is valid', () => {
    const rd = readServiceBilling({ serviceLog: serviceLog() })
    const total = rd.candidates.find((c) => c.kind === 'service_total')!
    const d = prepareBillingDraft({
      sourceKind: 'service', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [total.id],
      lines: [makeBillingLine({ id: 'l1', title: SVC_TITLE, description: 'Service Work', amount: 671, candidateIds: [total.id] })],
    })
    expect(d.currentInvoiceAmount).toBe(671)
    expect(d.ready).toBe(true)
    expect(d.reviewRequired.some((f) => f.reason === 'overlapping_representation')).toBe(false)
  })

  it('QBO-BASIS-2: service itemized labor + material mode is valid', () => {
    const rd = readServiceBilling({ serviceLog: serviceLog() })
    const labor = rd.candidates.find((c) => c.kind === 'service_labor')!
    const material = rd.candidates.find((c) => c.kind === 'service_material')!
    const d = prepareBillingDraft({
      sourceKind: 'service', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [labor.id, material.id],
      lines: [
        makeBillingLine({ id: 'l1', title: SVC_TITLE, description: 'Labor', amount: 600, candidateIds: [labor.id] }),
        makeBillingLine({ id: 'l2', title: SVC_TITLE, description: 'Materials', amount: 71, candidateIds: [material.id] }),
      ],
    })
    expect(d.currentInvoiceAmount).toBe(671)
    expect(d.ready).toBe(true)
    expect(d.reviewRequired.some((f) => f.reason === 'overlapping_representation')).toBe(false)
  })

  it('QBO-BASIS-3: service total + labor/material combination is rejected as overlapping representation (INVALID)', () => {
    const rd = readServiceBilling({ serviceLog: serviceLog() })
    const total = rd.candidates.find((c) => c.kind === 'service_total')!
    const labor = rd.candidates.find((c) => c.kind === 'service_labor')!
    const material = rd.candidates.find((c) => c.kind === 'service_material')!
    const d = prepareBillingDraft({
      sourceKind: 'service', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [total.id, labor.id, material.id],
      lines: [
        makeBillingLine({ id: 'l1', title: SVC_TITLE, description: 'Total', amount: 671, candidateIds: [total.id] }),
        makeBillingLine({ id: 'l2', title: SVC_TITLE, description: 'Labor', amount: 600, candidateIds: [labor.id] }),
        makeBillingLine({ id: 'l3', title: SVC_TITLE, description: 'Materials', amount: 71, candidateIds: [material.id] }),
      ],
    })
    expect(d.ready).toBe(false)
    const flag = d.reviewRequired.find((f) => f.reason === 'overlapping_representation')!
    expect(flag).toBeTruthy()
    expect(flag.severity).toBe('invalid') // blocking, not subtle
    expect(d.currentInvoiceAmount).toBe(1342) // reported honestly, not reduced to 671
  })

  it('QBO-BASIS-4: itemized service total equals the structured service billable total', () => {
    const rd = readServiceBilling({ serviceLog: serviceLog() })
    const labor = rd.candidates.find((c) => c.kind === 'service_labor')!
    const material = rd.candidates.find((c) => c.kind === 'service_material')!
    const d = prepareBillingDraft({
      sourceKind: 'service', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [labor.id, material.id],
      lines: [
        makeBillingLine({ id: 'l1', title: SVC_TITLE, description: 'Labor', amount: 600, candidateIds: [labor.id] }),
        makeBillingLine({ id: 'l2', title: SVC_TITLE, description: 'Materials', amount: 71, candidateIds: [material.id] }),
      ],
    })
    expect(d.currentInvoiceAmount).toBe(rd.contractValue) // itemized == structured total billable
    expect(d.ready).toBe(true)
  })

  it('QBO-BASIS-10: billing a service call under total + component at once is rejected (double-count)', () => {
    const rd = readServiceBilling({ serviceLog: serviceLog() })
    const total = rd.candidates.find((c) => c.kind === 'service_total')!
    const labor = rd.candidates.find((c) => c.kind === 'service_labor')!
    const d = prepareBillingDraft({
      sourceKind: 'service', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [total.id, labor.id],
      lines: [
        makeBillingLine({ id: 'l1', title: SVC_TITLE, description: 'Total', amount: 671, candidateIds: [total.id] }),
        makeBillingLine({ id: 'l2', title: SVC_TITLE, description: 'Labor', amount: 600, candidateIds: [labor.id] }),
      ],
    })
    expect(d.ready).toBe(false)
    expect(d.reviewRequired.some((f) => f.reason === 'overlapping_representation')).toBe(true)
  })

  it('service call with no materials: only the total candidate exists (no component candidates)', () => {
    const rd = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 671, mat: 0 }) })
    expect(rd.candidates.some((c) => c.kind === 'service_material')).toBe(false)
    expect(rd.candidates.some((c) => c.kind === 'service_labor')).toBe(false)
    expect(rd.candidates.some((c) => c.kind === 'service_total')).toBe(true)
  })
})

// ── Project: candidate origin (real logs, no synthesized events) ──────────────

describe('QBO-2D project candidate origin (QBO-BASIS-5..9)', () => {
  function projectRead(logs: BackupLog[]) {
    const project = makeProject({
      contract: 8500, billed: 0, deposit_pct: 10,
      phase_timeline: [
        { phase_name: 'Panel', confirmed_start_date: '2025-01-01', estimated_duration_days: 10,
          actual_start_date: null, actual_end_date: null, quoted_labor_hours: null,
          quoted_material_cost: null, payment_trigger_pct: 45 },
        { phase_name: 'Rough-In', confirmed_start_date: null, estimated_duration_days: 10,
          actual_start_date: null, actual_end_date: null, quoted_labor_hours: null,
          quoted_material_cost: null, payment_trigger_pct: 40 },
      ],
    })
    return readProjectBilling({ project, backup: makeBackup(logs) })
  }

  it('QBO-BASIS-5: project billing candidates are real Project Log records (not synthesized events)', () => {
    const rd = projectRead([workLog('w1', 'proj-1', { phase: 'Panel' }), workLog('w2', 'proj-1', { phase: 'Rough-In' })])
    // One candidate per real log — no Panel/Rough-In milestone/deposit/final events.
    expect(rd.candidates).toHaveLength(2)
    expect(rd.candidates.every((c) => c.kind === 'project_log')).toBe(true)
    expect(rd.candidates.some((c) => /panel|rough|deposit|final|full remaining/i.test(c.label))).toBe(false)
    // No phase_timeline schedule reference is exposed (QBO-2D §2/§21).
    expect('paymentScheduleReference' in rd).toBe(false)
  })

  it('QBO-BASIS-6: project log candidates carry no structured amount and no representation mode', () => {
    const rd = projectRead([workLog('w1', 'proj-1')])
    const c = rd.candidates[0]
    expect(c.structuredAmount).toBe(null)
    expect(c.representationMode).toBe(null)
    expect(c.capacityGroup).toBe(null)
    expect(c.id.startsWith('projlog:')).toBe(true)
  })

  it('QBO-BASIS-7: multiple project logs are independently selectable', () => {
    const rd = projectRead([workLog('w1', 'proj-1', { notes: 'Panel install' }), workLog('w2', 'proj-1', { notes: 'Rough-in' })])
    const ids = rd.candidates.map((c) => c.id)
    const d = prepareBillingDraft({
      sourceKind: 'project', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: ids,
      lines: [makeBillingLine({ id: 'l1', title: PROJ_TITLE, description: 'Combined billing', amount: 4000, candidateIds: ids })],
    })
    expect(d.selectedCandidateIds).toHaveLength(2)
    expect(d.ready).toBe(true)
    expect(d.reviewRequired.some((f) => f.reason === 'overlapping_representation')).toBe(false)
  })

  it('QBO-BASIS-8: selecting project logs does not manufacture a per-log billing amount', () => {
    const rd = projectRead([workLog('w1', 'proj-1'), workLog('w2', 'proj-1')])
    expect(rd.candidates.every((c) => c.structuredAmount === null)).toBe(true)
    const d = prepareBillingDraft({
      sourceKind: 'project', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: rd.candidates.map((c) => c.id),
      lines: [makeBillingLine({ id: 'l1', title: PROJ_TITLE, description: 'Owner amount', amount: 3200 })],
    })
    expect(d.currentInvoiceAmount).toBe(3200)
  })

  it('QBO-BASIS-9: the owner may bill any partial amount against selected logs', () => {
    const rd = projectRead([workLog('w1', 'proj-1')])
    const c = rd.candidates[0]
    const d = prepareBillingDraft({
      sourceKind: 'project', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [c.id],
      lines: [makeBillingLine({ id: 'l1', title: PROJ_TITLE, description: 'Partial billing', amount: 3000, candidateIds: [c.id] })],
    })
    expect(d.currentInvoiceAmount).toBe(3000)
    expect(d.ready).toBe(true)
  })
})

// ── Capacity authority: prose / payment / QBO / immutability ──────────────────

describe('QBO-2D capacity authority (QBO-BASIS-11..14)', () => {
  it('QBO-BASIS-11: no prose dollar value affects the billing amount', () => {
    const rd = readProjectBilling({
      project: makeProject({ contract: 8500 }),
      backup: makeBackup([workLog('w1', 'proj-1', { notes: 'Optional add-on available for an additional $4,500.' })]),
    })
    expect(rd.candidates[0].structuredAmount).toBe(null)
    const d = prepareBillingDraft({
      sourceKind: 'project', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: rd.candidates.map((c) => c.id),
      lines: [makeBillingLine({ id: 'l1', title: PROJ_TITLE, description: 'Optional add-on available for an additional $4,500.', amount: 4500, candidateIds: rd.candidates.map((c) => c.id) })],
    })
    expect(d.currentInvoiceAmount).toBe(4500) // the owner-entered amount, not the prose
    expect(d.paymentBalance).toBe(8500) // 8500 − 0 collected
  })

  it('QBO-BASIS-12: payment / collected history does not alter the draft invoice amount', () => {
    const rd = readProjectBilling({
      project: makeProject({ contract: 4000, finance: { manualPaidAdjustment: 100 } }),
      backup: makeBackup([{ ...workLog('p1', 'proj-1'), phase: 'Payment', collected: 3000 }]),
    })
    const d = prepareBillingDraft({
      sourceKind: 'project', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [],
      lines: [makeBillingLine({ id: 'l1', title: PROJ_TITLE, description: 'Bill work', amount: 4000 })],
    })
    expect(d.currentInvoiceAmount).toBe(4000) // invoice unchanged by collection history
    expect(d.collectedSoFar).toBe(3100) // carried as read-only context
    // Payment Balance = contract − collected (display only). Collected is NOT subtracted from the invoice.
    expect(d.paymentBalance).toBe(d.contractValue! - d.collectedSoFar)
    expect(d.paymentBalance).toBe(900)
  })

  it('QBO-BASIS-13: no QBO value participates in amount / capacity calculations', () => {
    const rd = readProjectBilling({
      project: makeProject({ contract: 8500 }),
      backup: makeBackup([workLog('w1', 'proj-1'), workLog('w2', 'proj-1')]),
    })
    const d = prepareBillingDraft({
      sourceKind: 'project', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: rd.candidates.map((c) => c.id),
      lines: [
        makeBillingLine({ id: 'l1', title: PROJ_TITLE, description: 'Panel', amount: 4500 }),
        makeBillingLine({ id: 'l2', title: PROJ_TITLE, description: 'Rough-In', amount: 4000 }),
      ],
    })
    expect(d.currentInvoiceAmount).toBe(8500)
    expect(d.paymentBalance).toBe(d.contractValue! - d.collectedSoFar)
    expect(JSON.stringify(d)).not.toMatch(/quickbooks|qbo|intuit|qboInvoiceId|qboCustomerId/i)
  })

  it('QBO-BASIS-14: source objects remain immutable through draft creation', () => {
    const project = makeProject({
      contract: 8500, billed: 1000, deposit_pct: 10,
      phase_timeline: [
        { phase_name: 'Panel', confirmed_start_date: '2025-01-01', estimated_duration_days: 10,
          actual_start_date: null, actual_end_date: null, quoted_labor_hours: null,
          quoted_material_cost: null, payment_trigger_pct: 50 },
      ],
      changeOrders: [
        { id: 'co1', title: 'Extra', description: '', stage: '', requestedBy: '', approvedBy: '',
          createdAt: '', approvalAt: '', laborCost: 0, materialCost: 0, totalCost: 1500,
          permitRelated: false, status: 'Approved' },
      ],
    })
    const backup = makeBackup([workLog('w1', 'proj-1')])
    const beforeProject = JSON.parse(JSON.stringify(project))
    const beforeBackup = JSON.parse(JSON.stringify(backup))
    const rd = readProjectBilling({ project, backup })
    prepareBillingDraft({
      sourceKind: 'project', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: rd.candidates.map((c) => c.id),
      lines: [makeBillingLine({ id: 'l1', title: PROJ_TITLE, description: 'Bill', amount: 5000, candidateIds: rd.candidates.map((c) => c.id) })],
    })
    expect(project).toEqual(beforeProject)
    expect(backup).toEqual(beforeBackup)
  })
})