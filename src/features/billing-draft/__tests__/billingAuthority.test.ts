/**
 * QBO-2D focused authority tests — Correct Billing Authority (owner workflow).
 *
 * QBO-LOG-1   Project billing candidates originate from real Project Log records.
 * QBO-LOG-2   phase_timeline does not create billing events.
 * QBO-LOG-3   getPhasePaymentSchedule is not read — no schedule reference is exposed.
 * QBO-LOG-4   No phase/estimate schedule can set Billing Now (it is absent entirely).
 * QBO-LOG-5   Project Log descriptions may supply invoice description context.
 * QBO-LOG-6   Dollar values inside Project Log prose cannot become invoice amounts.
 * QBO-LOG-7   Owner can enter Billing Now manually.
 * QBO-LOG-8   Owner can select one Project Log.
 * QBO-LOG-9   Owner can select multiple Project Logs.
 * QBO-LOG-10  Selecting multiple logs does not manufacture per-log dollar values.
 * QBO-LOG-11  Collected Project payment truth is shown separately.
 * QBO-LOG-12  Collected does not become "previously invoiced" (no such field exists).
 * QBO-LOG-13  Invoice history is not fabricated (no previouslyInvoiced / remainingContractAmount).
 * QBO-LOG-14  Service billing originates from actual Service Log (workDescription exposed).
 * QBO-LOG-15  Service structured Total Billable is usable.
 * QBO-LOG-16  Service material/itemized values are used only when structurally present.
 * QBO-LOG-17  Main owner-visible Service Log row exposes Prepare Invoice (ServiceCallCard).
 * QBO-LOG-17b The runtime Service Log surface (V15rFieldLogPanel) exposes Prepare Invoice
 *             next to Convert to Estimate (QBO-2D §16).
 * QBO-LOG-18  Legacy-only placement is not the sole entry point (both surfaces wired).
 * QBO-LOG-19  Billing Now may differ from the Payment Balance (display-only context).
 * QBO-LOG-20  Billing Now may differ from collected value.
 * QBO-LOG-21  No payment/KPI mutation occurs during draft preparation.
 * QBO-LOG-22  No QBO API call occurs.
 * QBO-LOG-23  No migration.
 *
 * These are BEHAVIOR tests against the pure adapters + model (and a few SOURCE-
 * CONTRACT assertions for UI placement / firewall, since vitest runs without a
 * DOM renderer). Runtime validation by the owner is still required.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { makeBillingLine, prepareBillingDraft } from '../billingDraftModel'
import {
  PROJECT_DEFAULT_TITLE,
  SERVICE_DEFAULT_TITLE,
  buildSelection,
  composeWorkDescription,
  parseAmount,
  type PrepareInvoiceUiState,
} from '../billingDraftModalState'
import { readProjectBilling } from '../projectBillingAdapter'
import { readServiceBilling, readServiceCallBilling } from '../serviceBillingAdapter'
import type { BackupData, BackupLog, BackupProject, BackupServiceLog } from '@/services/backupDataService'
import type { ServiceCallRecord, ServiceDayEntry } from '@/services/serviceCallService'

const ROOT = process.cwd()
const readText = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ')

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeProject(over: Partial<BackupProject> = {}): BackupProject {
  return {
    id: 'proj-1', name: 'Beauty Salon', type: 'service', status: 'active',
    contract: 0, billed: 0, paid: 0, mileRT: 0, phases: {}, logs: [], finance: {},
    changeOrders: [], ...over,
  } as BackupProject
}
function makeBackup(logs: BackupLog[] = []): BackupData {
  return { logs, projects: [], serviceLogs: [] } as unknown as BackupData
}
function log(id: string, projId: string, over: Partial<BackupLog> = {}): BackupLog {
  return {
    id, emp: '', hrs: 0, mat: 0, date: '2025-01-05', empId: '', miles: 0, notes: '',
    phase: '', store: '', profit: 0, projId, quoted: 0, projName: '', detailLink: '',
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
function makeDay(over: Partial<ServiceDayEntry> = {}): ServiceDayEntry {
  return {
    id: 'day-1', service_call_id: 'call-1', day_number: 1, date: '2025-01-01',
    labor_hours: 0, labor_cost: 0, materials: [], materials_total: 0,
    transportation_miles: 0, transportation_rate: 0, transportation_cost: 0,
    daily_total: 0, collection_amount: 0, notes: '', ...over,
  } as ServiceDayEntry
}
function makeServiceCall(over: Partial<ServiceCallRecord> = {}): ServiceCallRecord {
  return {
    service_call_id: 'call-1', customer: 'Test Customer', address: '', jtype: 'Other',
    days: [], created_at: '2025-01-01', ...over,
  } as ServiceCallRecord
}

function draftFromRead(
  read: ReturnType<typeof readProjectBilling> | ReturnType<typeof readServiceBilling> | ReturnType<typeof readServiceCallBilling>,
  ui: Partial<PrepareInvoiceUiState>,
) {
  const full: PrepareInvoiceUiState = {
    selectedCandidateIds: ui.selectedCandidateIds ?? [],
    lines: ui.lines ?? [],
    descriptionDirty: ui.descriptionDirty ?? {},
  }
  return prepareBillingDraft(buildSelection(read, full))
}

// A Beauty-Salon-like project: contract $21,790, billed $5,000, a real phase_timeline,
// and real Project Logs (one work log + one payment log). This is the runtime case
// the owner reported as fabricated.
function beautySalonRead() {
  const project = makeProject({
    contract: 21790, billed: 5000, deposit_pct: 10,
    phase_timeline: [
      { phase_name: 'Rough-in', confirmed_start_date: '2025-01-01', estimated_duration_days: 10, actual_start_date: null, actual_end_date: null, quoted_labor_hours: null, quoted_material_cost: null, payment_trigger_pct: 45 },
      { phase_name: 'Site Prep', confirmed_start_date: null, estimated_duration_days: 5, actual_start_date: null, actual_end_date: null, quoted_labor_hours: null, quoted_material_cost: null, payment_trigger_pct: 15 },
    ],
  })
  const backup = makeBackup([
    log('work-1', 'proj-1', { date: '2025-02-01', phase: 'Rough-in', notes: 'Rough-in complete, ready to bill' }),
    log('pay-1', 'proj-1', { date: '2025-01-10', phase: 'Payment', notes: 'Deposit received', collected: 17346 }),
  ])
  return readProjectBilling({ project, backup })
}

// ── Project candidate origin (QBO-LOG-1,2,3,10) ───────────────────────────────

describe('QBO-2D project candidate origin (QBO-LOG-1,2,3,10)', () => {
  it('QBO-LOG-1: project billing candidates originate from real Project Log records', () => {
    const read = beautySalonRead()
    expect(read.candidates).toHaveLength(2)
    expect(read.candidates.every((c) => c.kind === 'project_log')).toBe(true)
    expect(read.candidates.map((c) => c.sourceId).sort()).toEqual(['pay-1', 'work-1'])
  })

  it('QBO-LOG-2: phase_timeline does not create billing events (no milestone/phase/full-remaining candidates)', () => {
    const read = beautySalonRead()
    expect(read.candidates.some((c) => /rough|site|panel|deposit|final|full remaining/i.test(c.label))).toBe(false)
    expect(read.candidates.some((c) => c.kind !== 'project_log')).toBe(false)
    expect(read.candidates.every((c) => c.id.startsWith('projlog:'))).toBe(true)
  })

  it('QBO-LOG-3: getPhasePaymentSchedule is not read — no schedule reference is exposed', () => {
    const read = beautySalonRead()
    // No paymentScheduleReference is produced at all (QBO-2D §2/§21 removed it).
    expect('paymentScheduleReference' in read).toBe(false)
    expect(read.candidates.every((c) => c.structuredAmount === null)).toBe(true)
  })

  it('QBO-LOG-10: selecting multiple logs does not manufacture per-log dollar values', () => {
    const read = beautySalonRead()
    const ids = read.candidates.map((c) => c.id)
    for (const c of read.candidates) expect(c.structuredAmount).toBe(null)
    const d = draftFromRead(read, { selectedCandidateIds: ids, lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Progress billing', amount: 3000, candidateIds: ids })] })
    expect(d.currentInvoiceAmount).toBe(3000) // owner-entered, not manufactured
    expect(d.selectedCandidateIds).toHaveLength(2)
  })
})

// ── Schedule absent vs Billing Now (QBO-LOG-4,19) ─────────────────────────────

describe('QBO-2D no schedule reference; owner controls Billing Now (QBO-LOG-4,19)', () => {
  it('QBO-LOG-4: no phase/estimate schedule can set Billing Now (it is absent entirely)', () => {
    const read = beautySalonRead()
    const d = draftFromRead(read, { lines: [] })
    expect(d.currentInvoiceAmount).toBe(0) // nothing auto-filled
    expect('paymentScheduleReference' in read).toBe(false)
  })

  it('QBO-LOG-19: Billing Now may differ from the Payment Balance (display-only context)', () => {
    const read = beautySalonRead()
    expect(read.contractValue).toBe(21790)
    expect(read.collectedSoFar).toBe(17346)
    // Payment Balance = 21790 − 17346 = 4444 (display only).
    const d0 = draftFromRead(read, { lines: [] })
    expect(d0.paymentBalance).toBe(4444)
    // Owner bills an amount that differs from the payment balance — no flag, allowed.
    const ownerAmount = 8000 // intentionally different from 4444
    const d = draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Custom progress billing', amount: ownerAmount })] })
    expect(d.currentInvoiceAmount).toBe(ownerAmount)
    expect(d.reviewRequired.some((f) => (f.reason as string) === 'invoice_exceeds_contract')).toBe(false)
    expect(d.ready).toBe(true)
  })
})

// ── Project log description + prose (QBO-LOG-5,6) ─────────────────────────────

describe('QBO-2D project log context (QBO-LOG-5,6)', () => {
  it('QBO-LOG-5: Project Log descriptions seed invoice description context (Work completed:)', () => {
    const read = readProjectBilling({
      project: makeProject({ contract: 1000 }),
      backup: makeBackup([log('w1', 'proj-1', { date: '2025-03-01', phase: 'Rough-in', notes: 'Rough-in complete' })]),
    })
    const c = read.candidates[0]
    const seeded = composeWorkDescription({ candidates: read.candidates, selectedIds: [c.id], sourceKind: 'project' })
    expect(seeded).toBe('Work completed:\n- Rough-in complete')
  })

  it('QBO-LOG-6: dollar values inside Project Log prose cannot become invoice amounts', () => {
    const read = readProjectBilling({
      project: makeProject({ contract: 1000 }),
      backup: makeBackup([log('w1', 'proj-1', { date: '2025-03-01', notes: 'Customer asked to bill $5,000 for rough-in' })]),
    })
    expect(read.candidates[0].structuredAmount).toBe(null) // prose "$5,000" did not become an amount
    expect(parseAmount('Customer asked to bill $5,000 for rough-in')).toBe(0)
  })
})

// ── Owner manual Billing Now + log selection (QBO-LOG-7,8,9) ─────────────────

describe('QBO-2D owner control (QBO-LOG-7,8,9)', () => {
  it('QBO-LOG-7: owner can enter Billing Now manually (any intentional amount)', () => {
    const read = beautySalonRead()
    const d = draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Progress billing', amount: 8500 })] })
    expect(d.currentInvoiceAmount).toBe(8500)
    expect(d.ready).toBe(true)
  })

  it('QBO-LOG-8: owner can select one Project Log (selection recorded, no amount manufactured)', () => {
    const read = beautySalonRead()
    const one = read.candidates[0].id
    const d = draftFromRead(read, { selectedCandidateIds: [one], lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Bill this work', amount: 1000, candidateIds: [one] })] })
    expect(d.selectedCandidateIds).toEqual([one])
    expect(d.currentInvoiceAmount).toBe(1000)
  })

  it('QBO-LOG-9: owner can select multiple Project Logs', () => {
    const read = beautySalonRead()
    const ids = read.candidates.map((c) => c.id)
    const d = draftFromRead(read, { selectedCandidateIds: ids, lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Combined billing', amount: 4000, candidateIds: ids })] })
    expect(d.selectedCandidateIds).toHaveLength(2)
    expect(d.currentInvoiceAmount).toBe(4000)
  })
})

// ── Collected vs invoice history (QBO-LOG-11,12,13,20) ───────────────────────

describe('QBO-2D collected & invoice history (QBO-LOG-11,12,13,20)', () => {
  it('QBO-LOG-11: collected Project payment truth is shown separately', () => {
    const read = beautySalonRead()
    expect(read.collectedSoFar).toBe(17346)
  })

  it('QBO-LOG-12: collected does not become "previously invoiced" (no such field exists)', () => {
    const read = beautySalonRead()
    expect(read.collectedSoFar).toBe(17346)
    expect('previouslyInvoiced' in read).toBe(false)
    const d = draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Billing', amount: 1000 })] })
    expect('previouslyInvoiced' in d).toBe(false)
  })

  it('QBO-LOG-13: invoice history is not fabricated (no previouslyInvoiced / remainingContractAmount)', () => {
    const read = beautySalonRead() // project.billed = 5000 in the fixture
    expect('previouslyInvoiced' in read).toBe(false) // p.billed is NOT used as invoice authority
    const d = draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Billing', amount: 1000 })] })
    expect('previouslyInvoiced' in d).toBe(false)
    expect('remainingContractAmount' in d).toBe(false)
    expect(JSON.stringify(d)).not.toMatch(/previouslyInvoiced|remainingContractAmount|remainingToInvoice/i)
  })

  it('QBO-LOG-20: Billing Now may differ from collected value (collected is context only)', () => {
    const read = beautySalonRead()
    const d = draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Bill remaining work', amount: 1000 })] })
    expect(d.currentInvoiceAmount).toBe(1000) // not equal to collected (17346)
    expect(d.collectedSoFar).toBe(17346) // carried unchanged as context
    expect(d.ready).toBe(true)
  })

  it('manualPaidAdjustment is included in collected truth (mirrors getProjectFinancials.paid)', () => {
    const read = readProjectBilling({
      project: makeProject({ contract: 5000, finance: { manualPaidAdjustment: 500 } }),
      backup: makeBackup([log('p1', 'proj-1', { collected: 1000 })]),
    })
    expect(read.collectedSoFar).toBe(1500)
  })
})

// ── Service billing origin (QBO-LOG-14,15,16) ─────────────────────────────────

describe('QBO-2D service billing origin (QBO-LOG-14,15,16)', () => {
  it('QBO-LOG-14: service billing originates from actual Service Log (workDescription exposed)', () => {
    const read = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 671, mat: 71, notes: 'Replaced breaker', jtype: 'Service' }) })
    expect(read.sourceId).toBe('svc-1')
    expect(read.candidates.some((c) => c.kind === 'service_total')).toBe(true)
    expect(read.candidates.some((c) => c.kind === 'service_labor')).toBe(true)
    expect(read.candidates.some((c) => c.kind === 'service_material')).toBe(true)
    // The actual work description is exposed to seed the invoice description (QBO-2D §18).
    expect(read.workDescription).toContain('Replaced breaker')
  })

  it('QBO-LOG-15: service structured Total Billable is usable (bill the total)', () => {
    const read = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 671, mat: 71 }) })
    const total = read.candidates.find((c) => c.kind === 'service_total')!
    expect(total.structuredAmount).toBe(671)
    const d = draftFromRead(read, {
      selectedCandidateIds: [total.id],
      lines: [makeBillingLine({ id: 'l1', title: SERVICE_DEFAULT_TITLE, description: 'Service Work', amount: 671, candidateIds: [total.id] })],
    })
    expect(d.currentInvoiceAmount).toBe(671)
    expect(d.ready).toBe(true)
  })

  it('QBO-LOG-16: service material/itemized values are used only when structurally present', () => {
    const noMat = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 671, mat: 0 }) })
    expect(noMat.candidates.some((c) => c.kind === 'service_material')).toBe(false)
    expect(noMat.candidates.some((c) => c.kind === 'service_labor')).toBe(false)
    expect(noMat.candidates.some((c) => c.kind === 'service_total')).toBe(true)
    const withMat = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 671, mat: 71 }) })
    expect(withMat.candidates.some((c) => c.kind === 'service_material')).toBe(true)
    expect(withMat.candidates.find((c) => c.kind === 'service_material')!.structuredAmount).toBe(71)
  })

  it('multi-day service call with no quote: total amount is owner-entered (no structured cap)', () => {
    const call = makeServiceCall({
      days: [makeDay({ collection_amount: 200, materials: [{ id: 'm1', item_name: 'Conduit', quantity: 2, unit_cost: 10, total: 20 }], materials_total: 20, daily_total: 20 })],
    })
    const read = readServiceCallBilling({ call })
    expect(read.contractValue).toBe(null) // no structured quote → no contract cap
    const total = read.candidates.find((c) => c.kind === 'service_total')!
    expect(total.structuredAmount).toBe(null) // owner must enter
    const material = read.candidates.find((c) => c.kind === 'service_material')!
    expect(material.structuredAmount).toBe(20) // itemized materials ARE structured
    expect(read.collectedSoFar).toBe(200)
    const d = draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: SERVICE_DEFAULT_TITLE, description: 'Service work', amount: 500 })] })
    expect(d.reviewRequired.some((f) => (f.reason as string) === 'invoice_exceeds_contract')).toBe(false)
    expect(d.ready).toBe(true)
  })
})

// ── UI placement source contract (QBO-LOG-17,17b,18,22) ──────────────────────

describe('QBO-2D service button placement + firewall (QBO-LOG-17,17b,18,22)', () => {
  const svcSrc = codeOnly(readText('src/components/v15r/V15rServiceCallsV2.tsx'))
  const fieldLogSrc = codeOnly(readText('src/components/v15r/V15rFieldLogPanel.tsx'))
  const modalSrc = readText('src/features/billing-draft/components/PrepareInvoiceModal.tsx')
  const modalCode = codeOnly(modalSrc)

  it('QBO-LOG-17: main owner-visible Service Log row (ServiceCallCard) exposes the QuickBooks menu', () => {
    const menuSrc = codeOnly(readText('src/features/billing-draft/components/QuickBooksMenu.tsx'))
    expect(svcSrc).toContain('function ServiceCallCard')
    // The standalone Prepare Invoice button is replaced by the reusable QuickBooks menu
    // (consolidating Prepare Invoice + Invoice Drafts behind one button).
    expect(svcSrc).toContain('QuickBooksMenu')
    expect(svcSrc).toContain('onPrepareInvoice')
    expect(svcSrc).toContain('onOpenDrafts')
    // The menu component itself exposes both actions.
    expect(menuSrc).toContain('Prepare Invoice')
    expect(menuSrc).toContain('Invoice Drafts')
    expect(modalSrc).toMatch(/kind:\s*'serviceCall'/)
  })

  it('QBO-LOG-17b: the runtime Service Log surface (V15rFieldLogPanel) exposes the QuickBooks menu next to Convert to Estimate (QBO-2D §16)', () => {
    const menuSrc = codeOnly(readText('src/features/billing-draft/components/QuickBooksMenu.tsx'))
    // The actual runtime surface containing "Convert to Estimate" is V15rFieldLogPanel.
    expect(fieldLogSrc).toContain('Convert to Estimate')
    expect(fieldLogSrc).toContain('PrepareInvoiceModal')
    // The standalone Prepare Invoice button is replaced by the reusable QuickBooks menu.
    expect(fieldLogSrc).toContain('QuickBooksMenu')
    expect(fieldLogSrc).toContain('onPrepareInvoice')
    expect(fieldLogSrc).toContain('onOpenDrafts')
    // It opens from a single service log row (kind 'service').
    expect(fieldLogSrc).toContain("setPrepareSvcLog")
    expect(modalSrc).toMatch(/kind:\s*'service'/)
    // The menu component itself exposes both actions.
    expect(menuSrc).toContain('Prepare Invoice')
    expect(menuSrc).toContain('Invoice Drafts')
  })

  it('QBO-LOG-18: legacy-only placement is not the sole entry point (both surfaces wired via the QuickBooks menu)', () => {
    const legacyIdx = svcSrc.indexOf('function LegacyServiceLogList')
    const cardIdx = svcSrc.indexOf('function ServiceCallCard')
    expect(cardIdx).toBeGreaterThan(-1)
    expect(legacyIdx).toBeGreaterThan(-1)
    // Both the ServiceCallCard and the LegacyServiceLogList surface use the QuickBooks menu.
    const cardMenu = svcSrc.indexOf('QuickBooksMenu', cardIdx)
    expect(cardMenu).toBeGreaterThan(cardIdx)
    const legacyMenu = svcSrc.indexOf('QuickBooksMenu', legacyIdx)
    expect(legacyMenu).toBeGreaterThan(legacyIdx)
    // The FieldLogPanel surface also uses the QuickBooks menu (the main runtime surface).
    expect(fieldLogSrc).toContain('QuickBooksMenu')
  })

  it('QBO-LOG-22: no QBO API call occurs (no Intuit/fetch/qbo ids in modal code)', () => {
    expect(modalCode).not.toMatch(/intuit|quickbooks\.api|appcenter\.intuit|oauth\.platform\.intuit/i)
    expect(modalCode).not.toMatch(/\bfetch\s*\(/)
    const read = beautySalonRead()
    const d = draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Bill', amount: 1000 })] })
    expect(JSON.stringify(d)).not.toMatch(/quickbooks|qbo|intuit|qboInvoiceId|qboCustomerId/i)
  })
})

// ── No mutation + no migration (QBO-LOG-21,23) ───────────────────────────────

describe('QBO-2D no mutation + no migration (QBO-LOG-21,23)', () => {
  it('QBO-LOG-21: no payment/KPI mutation during draft preparation (sources unchanged)', () => {
    const project = makeProject({ contract: 21790, billed: 5000, finance: { manualPaidAdjustment: 100 } })
    const backup = makeBackup([log('p1', 'proj-1', { collected: 5000 })])
    const beforeProject = JSON.parse(JSON.stringify(project))
    const beforeBackup = JSON.parse(JSON.stringify(backup))
    const read = readProjectBilling({ project, backup })
    draftFromRead(read, { lines: [makeBillingLine({ id: 'l1', title: PROJECT_DEFAULT_TITLE, description: 'Bill', amount: 2000 })] })
    expect(project).toEqual(beforeProject)
    expect(backup).toEqual(beforeBackup)
  })

  it('QBO-LOG-21: no mutation authority is imported by the billing-draft feature', () => {
    const files = [
      'src/features/billing-draft/projectBillingAdapter.ts',
      'src/features/billing-draft/serviceBillingAdapter.ts',
      'src/features/billing-draft/billingDraftModel.ts',
      'src/features/billing-draft/components/PrepareInvoiceModal.tsx',
    ]
    const protectedMutations = [
      'saveBackupData', 'saveBackupDataAndSync', 'saveBackupWithRemoteBaselineSync',
      'recordServicePayment', 'buildServiceLogWithPayment', 'ensureServicePaymentLedger',
      'ensureProjectFinanceBucket', 'recalculateWeeklyData', 'pushState',
    ]
    for (const f of files) {
      const src = codeOnly(readText(f))
      for (const sym of protectedMutations) {
        expect(src).not.toContain(sym)
      }
    }
  })

  it('QBO-LOG-23: no migration created (no new supabase migration files reference billing-draft)', () => {
    const migDir = join(ROOT, 'supabase', 'migrations')
    if (existsSync(migDir)) {
      const migs = readdirSync(migDir)
      const offending = migs.filter((m) => /billing-draft|qbo-2d/i.test(m))
      expect(offending).toEqual([])
    }
    const featureSrc = [
      'src/features/billing-draft/projectBillingAdapter.ts',
      'src/features/billing-draft/serviceBillingAdapter.ts',
      'src/features/billing-draft/billingDraftModel.ts',
    ].map((f) => codeOnly(readText(f))).join('\n')
    expect(featureSrc).not.toMatch(/supabase|createMigration|\.from\('invoices'\)/i)
  })
})