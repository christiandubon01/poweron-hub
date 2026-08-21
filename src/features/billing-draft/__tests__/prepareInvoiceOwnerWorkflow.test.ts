/**
 * QBO-2E — Prepare Invoice Owner Workflow (LUMP-SUM FIRST + AI WORDING).
 *
 * This file pins the QBO-2E requirements as enumerated tests QBO-SIMPLE-1..21.
 * Source-contract assertions run against the modal/adapter/model/state/AI source
 * (vitest has no DOM renderer). Behavior assertions run against the PURE model +
 * state helpers the UI delegates to. Per §19, these are NOT interactive DOM
 * tests — the owner must runtime-retest the modal in the browser.
 *
 * QBO-SIMPLE-1   Project default produces one invoice line.
 * QBO-SIMPLE-2   Selecting multiple Project Logs still produces one default financial line.
 * QBO-SIMPLE-3   Project Logs populate description context, not Product/Service.
 * QBO-SIMPLE-4   Project Invoice Amount is owner-entered.
 * QBO-SIMPLE-5   Service Total Billable is suggestion-only.
 * QBO-SIMPLE-6   Owner can override suggested Service amount.
 * QBO-SIMPLE-7   Optional itemization does not exist in primary workflow.
 * QBO-SIMPLE-8   Untouched blank optional item line does not block approval.
 * QBO-SIMPLE-9   Populated optional line is validated.
 * QBO-SIMPLE-16  No phase_timeline / getPhasePaymentSchedule values return.
 * QBO-SIMPLE-17  Service Prepare Invoice remains beside Convert to Estimate.
 * QBO-SIMPLE-18  Valid Approve Invoice Draft shows visible "Draft Ready" confirmation.
 * QBO-SIMPLE-19  Confirmation states nothing has been sent to QuickBooks.
 * QBO-SIMPLE-20  No QBO API request occurs.
 * QBO-SIMPLE-21  No migration.
 * (QBO-SIMPLE-10..15 — AI wording authority/input — are pinned in invoiceWordingAi.test.ts.)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { makeBillingLine, prepareBillingDraft } from '../billingDraftModel'
import {
  PROJECT_DEFAULT_TITLE,
  SERVICE_DEFAULT_TITLE,
  activeLines,
  buildSelection,
  composeWorkDescription,
  parseAmount,
  type PrepareInvoiceUiState,
} from '../billingDraftModalState'
import { readProjectBilling } from '../projectBillingAdapter'
import { readServiceBilling } from '../serviceBillingAdapter'
import type { BackupData, BackupLog, BackupProject, BackupServiceLog } from '@/services/backupDataService'

const ROOT = process.cwd()
const readText = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ')
const modalSrc = readText('src/features/billing-draft/components/PrepareInvoiceModal.tsx')
const modalCode = codeOnly(modalSrc)
const stateSrc = readText('src/features/billing-draft/billingDraftModalState.ts')
const modelSrc = readText('src/features/billing-draft/billingDraftModel.ts')
const typesSrc = readText('src/features/billing-draft/billingDraftTypes.ts')
const aiSrc = readText('src/features/billing-draft/invoiceWordingAi.ts')
const projAdapterSrc = readText('src/features/billing-draft/projectBillingAdapter.ts')

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

function beautySalonRead() {
  const project = makeProject({
    contract: 21790, billed: 5000, deposit_pct: 10,
    phase_timeline: [
      { phase_name: 'Underground', confirmed_start_date: '2025-01-01', estimated_duration_days: 20, actual_start_date: null, actual_end_date: null, quoted_labor_hours: null, quoted_material_cost: null, payment_trigger_pct: 40 },
    ],
  })
  const backup = makeBackup([
    log('work-1', 'proj-1', { date: '2025-02-01', phase: 'Rough-in', notes: 'Rough-in complete' }),
    log('work-2', 'proj-1', { date: '2025-02-05', phase: 'Trim', notes: 'Finished data outlets' }),
    log('pay-1', 'proj-1', { date: '2025-01-10', phase: 'Payment', notes: 'Deposit received', collected: 17346 }),
  ])
  return readProjectBilling({ project, backup })
}

function draft(read: ReturnType<typeof readProjectBilling> | ReturnType<typeof readServiceBilling>, ui: Partial<PrepareInvoiceUiState>) {
  const full: PrepareInvoiceUiState = {
    selectedCandidateIds: ui.selectedCandidateIds ?? [],
    lines: ui.lines ?? [],
    descriptionDirty: ui.descriptionDirty ?? {},
  }
  return prepareBillingDraft(buildSelection(read, full))
}

const PL = (id: string, amount: number, description = '', title = PROJECT_DEFAULT_TITLE, candidateIds: string[] = []) =>
  makeBillingLine({ id, title, description, amount, candidateIds })

// ── Lump-sum project flow (QBO-SIMPLE-1,2,3,4) ──────────────────────────────────

describe('QBO-2E lump-sum project flow (QBO-SIMPLE-1,2,3,4)', () => {
  it('QBO-SIMPLE-1: project default produces ONE invoice line (no per-log lines)', () => {
    const read = beautySalonRead()
    const d = draft(read, { lines: [PL('l1', 5000, 'Progress billing')] })
    expect(d.lines).toHaveLength(1)
    expect(d.currentInvoiceAmount).toBe(5000)
    // The modal seeds a single primary line on open (the lump-sum default).
    expect(modalSrc).toMatch(/lines:\s*\[makeBillingLine\(\{ id, title: defaultTitle/)
  })

  it('QBO-SIMPLE-2: selecting multiple Project Logs still produces one default financial line', () => {
    const read = beautySalonRead()
    const workLogs = read.candidates.filter((c) => c.sourceId !== 'pay-1')
    const ids = workLogs.map((c) => c.id)
    // ONE line references multiple logs; the invoice amount is the owner's single amount.
    const d = draft(read, {
      selectedCandidateIds: ids,
      lines: [PL('l1', 5000, 'Progress billing', PROJECT_DEFAULT_TITLE, ids)],
    })
    expect(d.lines).toHaveLength(1)
    expect(d.selectedCandidateIds).toEqual(ids)
    expect(d.currentInvoiceAmount).toBe(5000)
    // No candidate carried a per-log structured amount.
    expect(read.candidates.every((c) => c.structuredAmount === null)).toBe(true)
  })

  it('QBO-SIMPLE-3: Project Logs populate description context, not Product/Service', () => {
    const read = beautySalonRead()
    const workLogs = read.candidates.filter((c) => c.sourceId !== 'pay-1')
    const seededDesc = composeWorkDescription({ candidates: read.candidates, selectedIds: workLogs.map((c) => c.id), sourceKind: 'project' })
    // Description seeds from the selected work notes (newest-first).
    expect(seededDesc).toBe('Work completed:\n- Finished data outlets\n- Rough-in complete')
    // The title is NEVER derived from log notes.
    expect(modalCode).not.toMatch(/title:\s*composeWorkDescription/)
    expect(stateSrc).toContain('Electrical Project - Progress Billing')
  })

  it('QBO-SIMPLE-4: Project Invoice Amount is owner-entered (never auto-filled from logs/schedule/collected)', () => {
    expect(modalSrc).toContain('Invoice Amount')
    expect(modalSrc).toContain('type="number"')
    expect(parseAmount('')).toBe(0)
    const read = beautySalonRead()
    const d = draft(read, { lines: [PL('l1', 0, '')] })
    expect(d.currentInvoiceAmount).toBe(0)
    // Collected and contract do not auto-fill the amount.
    expect(read.collectedSoFar).toBeGreaterThan(0)
    expect(read.contractValue).toBeGreaterThan(0)
  })
})

// ── Service suggestion + override (QBO-SIMPLE-5,6) ─────────────────────────────

describe('QBO-2E service suggestion + override (QBO-SIMPLE-5,6)', () => {
  it('QBO-SIMPLE-5: Service Total Billable is suggestion-only (USE button present, not forced)', () => {
    expect(modalSrc).toContain('Suggested amount:')
    expect(modalSrc).toContain('useServiceSuggestion')
    // The suggestion is a button the owner chooses — not an auto-fill.
    expect(modalSrc).toContain('Suggestion only')
    const svc = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 461.53, mat: 0 }) })
    const total = svc.candidates.find((c) => c.kind === 'service_total')!
    // With no amount entered, the draft is incomplete (suggestion never auto-applies).
    const blank = draft(svc, { lines: [makeBillingLine({ id: 'l1', title: SERVICE_DEFAULT_TITLE, description: 'Service work', amount: 0, candidateIds: [total.id] })] })
    expect(blank.currentInvoiceAmount).toBe(0)
    expect(blank.ready).toBe(false)
  })

  it('QBO-SIMPLE-6: owner can override the suggested Service amount', () => {
    const svc = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 461.53, mat: 0 }) })
    const total = svc.candidates.find((c) => c.kind === 'service_total')!
    const overridden = draft(svc, {
      selectedCandidateIds: [total.id],
      lines: [makeBillingLine({ id: 'l1', title: SERVICE_DEFAULT_TITLE, description: 'Service work', amount: 400, candidateIds: [total.id] })],
    })
    expect(overridden.currentInvoiceAmount).toBe(400)
    expect(overridden.ready).toBe(true)
  })
})

// ── Optional itemization (QBO-SIMPLE-7,8,9) ─────────────────────────────────────

describe('QBO-2E optional itemization (QBO-SIMPLE-7,8,9)', () => {
  it('QBO-SIMPLE-7: optional itemization does not exist in primary workflow', () => {
    expect(modalCode).not.toContain('Add Another Invoice Line')
    expect(modalSrc).not.toContain('Add Another Invoice Line')
    expect(modalSrc).toContain('Add Separate Charge')
    // Toggling logs never creates new lines (only reseeds the primary description).
    expect(modalSrc).toContain('idx !== 0')
  })

  it('QBO-SIMPLE-8: untouched blank optional line does not block approval', () => {
    const read = beautySalonRead()
    const extra = makeBillingLine({ id: 'l2', title: PROJECT_DEFAULT_TITLE, description: '', amount: 0 })
    const d = draft(read, { lines: [PL('l1', 5000, 'Progress billing'), extra] })
    // The untouched extra is inactive → excluded from the total and from flags.
    expect(activeLines([PL('l1', 5000, 'Progress billing'), extra], 'project')).toHaveLength(1)
    expect(d.lines).toHaveLength(1)
    expect(d.currentInvoiceAmount).toBe(5000)
    expect(d.ready).toBe(true)
    expect(d.reviewRequired.some((f) => f.lineId === 'l2')).toBe(false)
  })

  it('QBO-SIMPLE-9: populated optional line is validated', () => {
    const read = beautySalonRead()
    // A description (content) activates the extra line; amount 0 → incomplete.
    const extra = makeBillingLine({ id: 'l2', title: PROJECT_DEFAULT_TITLE, description: 'Trip charge', amount: 0 })
    const d = draft(read, { lines: [PL('l1', 5000, 'Progress billing'), extra] })
    expect(d.lines).toHaveLength(2)
    expect(d.ready).toBe(false)
    expect(d.reviewRequired.some((f) => f.lineId === 'l2' && f.severity === 'incomplete')).toBe(true)
    // A non-default title also activates the extra line.
    const extra2 = makeBillingLine({ id: 'l2', title: 'Fuel surcharge', description: '', amount: 0 })
    const d2 = draft(read, { lines: [PL('l1', 5000, 'Progress billing'), extra2] })
    expect(d2.lines).toHaveLength(2)
    // A populated extra with an amount adds to the total and is ready.
    const extra3 = makeBillingLine({ id: 'l2', title: 'Trip charge', description: 'Fuel', amount: 150 })
    const d3 = draft(read, { lines: [PL('l1', 5000, 'Progress billing'), extra3] })
    expect(d3.currentInvoiceAmount).toBe(5150)
    expect(d3.ready).toBe(true)
  })
})

// ── Schedule removed + payment balance (QBO-SIMPLE-16) ─────────────────────────

describe('QBO-2E schedule removed + payment balance (QBO-SIMPLE-16)', () => {
  it('QBO-SIMPLE-16: no phase_timeline / getPhasePaymentSchedule values return', () => {
    expect(codeOnly(projAdapterSrc)).not.toContain('getPhasePaymentSchedule')
    expect(codeOnly(projAdapterSrc)).not.toContain('paymentScheduleReference')
    expect(modalCode).not.toContain('paymentScheduleReference')
    expect(modalCode).not.toContain('Contract Payment Schedule')
    const read = beautySalonRead()
    expect('paymentScheduleReference' in read).toBe(false)
    expect(read.candidates.every((c) => c.kind === 'project_log')).toBe(true)
  })

  it('Payment Balance = contract − collected (display only; not an invoice limit)', () => {
    expect(typesSrc).not.toMatch(/previouslyInvoiced|remainingContractAmount|remainingToInvoice/i)
    expect(modelSrc).not.toMatch(/previouslyInvoiced|remainingContractAmount/i)
    const read = beautySalonRead()
    const d = draft(read, { lines: [PL('l1', 0)] })
    expect(d.paymentBalance).toBe(read.contractValue - read.collectedSoFar)
    expect(d.paymentBalance).toBe(21790 - 17346)
    // Billing over the balance is allowed with no flag.
    const over = draft(read, { lines: [PL('l1', 8000, 'Over the balance')] })
    expect(over.ready).toBe(true)
    expect(over.reviewRequired.some((f) => (f.reason as string) === 'invoice_exceeds_contract')).toBe(false)
    expect(modalSrc).toContain('does not limit what you may invoice')
  })
})

// ── Approval confirmation + service button (QBO-SIMPLE-17,18,19) ───────────────

describe('QBO-2E approval confirmation + service button (QBO-SIMPLE-17,18,19)', () => {
  it('QBO-SIMPLE-17: Service surface exposes the QuickBooks menu (Prepare Invoice + Invoice Drafts) beside Convert to Estimate (V15rFieldLogPanel)', () => {
    const fieldLogSrc = codeOnly(readText('src/components/v15r/V15rFieldLogPanel.tsx'))
    const menuSrc = codeOnly(readText('src/features/billing-draft/components/QuickBooksMenu.tsx'))
    // Convert to Estimate is preserved alongside the new menu.
    expect(fieldLogSrc).toContain('Convert to Estimate')
    // The standalone Prepare Invoice button is replaced by the reusable QuickBooks menu.
    expect(fieldLogSrc).toContain('QuickBooksMenu')
    expect(fieldLogSrc).toContain('onPrepareInvoice')
    expect(fieldLogSrc).toContain('onOpenDrafts')
    // The Prepare Invoice modal + service-log entry point are retained.
    expect(fieldLogSrc).toContain('PrepareInvoiceModal')
    expect(fieldLogSrc).toContain('setPrepareSvcLog')
    // The menu component itself exposes both actions.
    expect(menuSrc).toContain('Prepare Invoice')
    expect(menuSrc).toContain('Invoice Drafts')
    expect(modalSrc).toMatch(/kind:\s*'service'/)
  })

  it('QBO-SIMPLE-18: valid Approve Invoice Draft shows a visible "Draft Ready" confirmation', () => {
    expect(modalSrc).toContain('APPROVE INVOICE DRAFT')
    expect(modalSrc).toContain('INVOICE DRAFT READY')
    expect(modalSrc).toContain('Edit Draft')
    expect(modalSrc).toContain('setApproved(true)')
    // A valid draft is approvable.
    const read = beautySalonRead()
    const d = draft(read, { lines: [PL('l1', 5000, 'Progress billing')] })
    expect(d.ready).toBe(true)
  })

  it('QBO-SIMPLE-19: confirmation explicitly states nothing has been sent to QuickBooks', () => {
    expect(modalSrc).toContain('Nothing has been sent to QuickBooks yet')
    expect(modalCode).not.toMatch(/qboInvoiceId|realmId|qboCustomerId/i)
  })
})

// ── Firewall: no QBO / no mutation (QBO-SIMPLE-20) ──────────────────────────────

describe('QBO-2E firewall (QBO-SIMPLE-20)', () => {
  it('QBO-SIMPLE-20: no QBO API request occurs (no fetch / intuit / qbo ids in modal + AI code)', () => {
    const feature = [modalCode, codeOnly(stateSrc), codeOnly(modelSrc), codeOnly(typesSrc), codeOnly(aiSrc)].join('\n')
    expect(feature).not.toMatch(/intuit|quickbooks\.api|appcenter\.intuit|oauth\.platform\.intuit/i)
    expect(modalCode).not.toMatch(/\bfetch\s*\(/)
    expect(feature).not.toMatch(/qboInvoiceId|qboCustomerId|realmId/i)
    // The AI wording module reuses the existing Claude proxy and exposes no key.
    expect(aiSrc).toContain("from '@/services/claudeProxy'")
    expect(codeOnly(aiSrc)).not.toMatch(/ANTHROPIC_API_KEY|VITE_ANTHROPIC|x-api-key/)
  })

  it('QBO-SIMPLE-20: no payment/KPI mutation authority imported by the billing-draft feature', () => {
    const files = [
      'src/features/billing-draft/components/PrepareInvoiceModal.tsx',
      'src/features/billing-draft/projectBillingAdapter.ts',
      'src/features/billing-draft/serviceBillingAdapter.ts',
      'src/features/billing-draft/billingDraftModel.ts',
      'src/features/billing-draft/invoiceWordingAi.ts',
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
})

// ── No migration (QBO-SIMPLE-21) ───────────────────────────────────────────────

describe('QBO-2E no migration (QBO-SIMPLE-21)', () => {
  it('QBO-SIMPLE-21: no migration created by QBO-2E (QBO-2F invoice_drafts is allowed)', () => {
    const migDir = join(ROOT, 'supabase', 'migrations')
    if (existsSync(migDir)) {
      const migs = readdirSync(migDir)
      const numbers = migs.map((f) => parseInt(f.split('_')[0], 10)).filter((n) => Number.isFinite(n))
      expect(numbers.length ? Math.max(...numbers) : 0).toBeLessThanOrEqual(134)
      // QBO-2F owns 131_invoice_drafts.sql; QBO-3A owns 132; QBO-4A.2 owns 133;
      // QBO-4A.6 owns 134. No other qbo/quickbooks/intuit/billing/wording/invoice-
      // named migration exists.
      expect(
        migs.some(
          (f) =>
            /qbo|quickbooks|intuit|billing|wording|invoice/i.test(f) &&
            f !== '131_invoice_drafts.sql' &&
            f !== '132_quickbooks_connections_and_oauth_states.sql' &&
            f !== '133_quickbooks_customer_mappings.sql' &&
            f !== '134_quickbooks_customer_mapping_text_identity.sql',
        ),
      ).toBe(false)
    }
  })
})