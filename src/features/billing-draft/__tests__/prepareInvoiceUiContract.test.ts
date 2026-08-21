/**
 * QBO-2E focused UI contract tests — Prepare Invoice LUMP-SUM FIRST + AI WORDING.
 *
 * HOUSE STYLE: the vitest environment is node with no DOM renderer, so UI
 * structure/wiring is pinned via source-level contract assertions on the
 * component .tsx (readFileSync + .toContain/.not.toContain), exactly like the
 * existing *UiContract.test.ts files. Live-preview / approval SEMANTICS are
 * pinned against the PURE billing-draft model the component delegates to
 * (prepareBillingDraft) and the pure state helpers (billingDraftModalState) —
 * the component contains no second set of billing formulas (asserted below).
 *
 * QBO-2E corrections pinned here (RUNTIME-DRIVEN UX SIMPLIFICATION over QBO-2D):
 *  - §2/§3   Default = ONE lump-sum invoice line. Project logs supply
 *            DESCRIPTION context, NOT separate lines and NOT the title.
 *  - §4      Itemization is OPTIONAL — the prominent "Add Another Invoice Line"
 *            is GONE; itemization lives behind a de-emphasized
 *            "Add Separate Charge" control.
 *  - §8/§11  "POLISH WITH AI" wording assistant reuses the existing server-side
 *            Claude proxy; USE THIS WORDING / REGENERATE / RESTORE ORIGINAL.
 *  - §14     Simplified screen: WORK / INVOICE (left) + PREVIEW (right); payment
 *            context is visually subordinate reference only.
 *  - §16     Valid approve shows a visible "INVOICE DRAFT READY" confirmation
 *            stating nothing has been sent to QuickBooks.
 *
 * QBO-SIMPLE-1   Project default produces one invoice line.
 * QBO-SIMPLE-3   Project Logs populate description context, not Product/Service.
 * QBO-SIMPLE-7   Optional itemization does not exist in primary workflow.
 * QBO-SIMPLE-14  Polished wording can replace Description (USE THIS WORDING control).
 * QBO-SIMPLE-15  Original wording can be restored (RESTORE ORIGINAL control).
 * QBO-SIMPLE-16  No phase_timeline / getPhasePaymentSchedule values return.
 * QBO-SIMPLE-17  Service Prepare Invoice remains beside Convert to Estimate.
 * QBO-SIMPLE-18  Valid Approve Invoice Draft shows visible "Draft Ready" confirmation.
 * QBO-SIMPLE-19  Confirmation explicitly states nothing has been sent to QuickBooks.
 * QBO-SIMPLE-20  No QBO API request occurs (no fetch / intuit in modal code).
 * QBO-SIMPLE-21  No migration (asserted in owner-workflow test).
 */
import { existsSync, readFileSync } from 'node:fs'
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
import { readServiceBilling } from '../serviceBillingAdapter'
import type { PreparedBillingDraft } from '../billingDraftTypes'
import type { BackupData, BackupLog, BackupProject, BackupServiceLog } from '@/services/backupDataService'

const ROOT = process.cwd()
const readText = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const modalSrc = readText('src/features/billing-draft/components/PrepareInvoiceModal.tsx')
const stateSrc = readText('src/features/billing-draft/billingDraftModalState.ts')
const aiSrc = readText('src/features/billing-draft/invoiceWordingAi.ts')

/** Strip block comments so firewall scans assert against CODE, not doc prose. */
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ')
const modalCode = codeOnly(modalSrc)
const aiCode = codeOnly(aiSrc)

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

function draftFromRead(
  read: ReturnType<typeof readProjectBilling> | ReturnType<typeof readServiceBilling>,
  ui: PrepareInvoiceUiState,
): PreparedBillingDraft {
  return prepareBillingDraft(buildSelection(read, ui))
}

function projectRead(over: Partial<BackupProject> = {}, logs: BackupLog[] = [workLog('w1', 'proj-1', { notes: 'Panel install' }), workLog('w2', 'proj-1', { notes: 'Rough-in' })]) {
  return readProjectBilling({
    project: makeProject({
      contract: 8500, billed: 0, deposit_pct: 10,
      phase_timeline: [
        { phase_name: 'Panel', confirmed_start_date: '2025-01-01', estimated_duration_days: 10,
          actual_start_date: null, actual_end_date: null, quoted_labor_hours: null,
          quoted_material_cost: null, payment_trigger_pct: 45 },
      ],
      ...over,
    }),
    backup: makeBackup(logs),
  })
}

function ui(selected: string[], lines: ReturnType<typeof makeBillingLine>[], descriptionDirty: Record<string, boolean> = {}): PrepareInvoiceUiState {
  return { selectedCandidateIds: selected, lines, descriptionDirty }
}

const L = (id: string, amount: number, description = '', title = PROJECT_DEFAULT_TITLE, candidateIds: string[] = []) =>
  makeBillingLine({ id, title, description, amount, candidateIds })

// ── Lump-sum default + simplified layout (QBO-SIMPLE-1,3,7,14,15,16) ─────────

describe('QBO-2E Prepare Invoice — lump-sum default + layout (QBO-SIMPLE-1,3,7,14,15,16)', () => {
  it('QBO-SIMPLE-1: renders PREPARE INVOICE header, customer, source kind, 3-step WORK/INVOICE/PREVIEW flow', () => {
    expect(modalSrc).toContain('PREPARE INVOICE')
    expect(modalSrc).toContain('read.customerReference')
    expect(modalSrc).toContain('Service Call')
    expect(modalSrc).toContain('Project')
    // Simplified 3-step flow (QBO-2E §14): WORK / INVOICE / PREVIEW.
    expect(modalSrc).toContain('title="WORK"')
    expect(modalSrc).toContain('title="INVOICE"')
    expect(modalSrc).toContain('title="PREVIEW"')
    expect(modalSrc).toContain('role="dialog"')
    expect(modalSrc).toContain('aria-modal="true"')
  })

  it('QBO-SIMPLE-1: project default seeds exactly ONE lump-sum invoice line', () => {
    // On open the modal seeds a single primary line (the lump-sum line).
    expect(modalSrc).toMatch(/lines:\s*\[makeBillingLine\(\{ id, title: defaultTitle/)
    // Project default Product/Service is the stable default constant.
    expect(stateSrc).toContain('Electrical Project - Progress Billing')
  })

  it('QBO-SIMPLE-3: Project Logs populate description context, not Product/Service (title is a stable default)', () => {
    expect(modalSrc).toContain('composeWorkDescription')
    expect(stateSrc).toContain('PROJECT_DEFAULT_TITLE')
    expect(stateSrc).toContain('SERVICE_DEFAULT_TITLE')
    // The title is never derived from candidate notes.
    expect(modalCode).not.toMatch(/title:\s*composeWorkDescription/)
    // The description composer seeds "Work completed:\n- …" from selected logs.
    const read = projectRead()
    const [a, b] = read.candidates
    const seeded = composeWorkDescription({ candidates: read.candidates, selectedIds: [a.id, b.id], sourceKind: 'project' })
    expect(seeded).toBe('Work completed:\n- Panel install\n- Rough-in')
    // Selecting logs reseeds the PRIMARY line description only (title untouched).
    expect(modalSrc).toContain('toggleProjectLog')
  })

  it('QBO-SIMPLE-7: optional itemization does not exist in primary workflow (no prominent "Add Another Invoice Line")', () => {
    // The old prominent primary-workflow line button is GONE.
    expect(modalCode).not.toContain('Add Another Invoice Line')
    expect(modalSrc).not.toContain('Add Another Invoice Line')
    // Itemization is an OPTIONAL, de-emphasized control the owner chooses.
    expect(modalSrc).toContain('Add Separate Charge')
    expect(modalSrc).toContain('addSeparateCharge')
    // Optional control is dashed/low-emphasis, not the prominent blue button.
    expect(modalSrc).toContain('border-dashed')
  })

  it('QBO-SIMPLE-14: polished wording can replace the Description (USE THIS WORDING control)', () => {
    expect(modalSrc).toContain('POLISH WITH AI')
    expect(modalSrc).toContain('USE THIS WORDING')
    expect(modalSrc).toContain('useThisWording')
    expect(modalSrc).toContain('polishInvoiceDescription')
    // Polish applies the generated wording to the description (setLineDescription with wording).
    expect(modalSrc).toContain('setLineDescription(lineId, wording)')
  })

  it('QBO-SIMPLE-15: original wording can be restored (RESTORE ORIGINAL control)', () => {
    expect(modalSrc).toContain('RESTORE ORIGINAL')
    expect(modalSrc).toContain('restoreOriginal')
    // Restore reverts the description to the saved original.
    expect(modalSrc).toContain('setLineDescription(lineId, st.original)')
  })

  it('QBO-SIMPLE-16: no phase_timeline / getPhasePaymentSchedule values return', () => {
    expect(modalCode).not.toContain('paymentScheduleReference')
    expect(modalCode).not.toContain('getPhasePaymentSchedule')
    expect(modalCode).not.toContain('Contract Payment Schedule')
    const read = projectRead()
    expect('paymentScheduleReference' in read).toBe(false)
    expect(read.candidates.every((c) => c.kind === 'project_log')).toBe(true)
  })
})

// ── Approval confirmation (QBO-SIMPLE-18,19) ───────────────────────────────────

describe('QBO-2E Prepare Invoice — approval confirmation (QBO-SIMPLE-18,19)', () => {
  it('QBO-SIMPLE-18: valid Approve Invoice Draft shows a visible "Draft Ready" confirmation', () => {
    expect(modalSrc).toContain('APPROVE INVOICE DRAFT')
    expect(modalSrc).toContain('INVOICE DRAFT READY')
    expect(modalSrc).toContain('DraftReadyConfirmation')
    expect(modalSrc).toContain('Edit Draft')
    // Approval enters the confirmation state (setApproved(true)) after the guard.
    expect(modalSrc).toContain('setApproved(true)')
    expect(modalSrc).toContain('if (!draft || !draft.ready) return')
  })

  it('QBO-SIMPLE-19: confirmation explicitly states nothing has been sent to QuickBooks', () => {
    expect(modalSrc).toContain('Nothing has been sent to QuickBooks yet')
    // No fake QBO invoice id is implied.
    expect(modalCode).not.toMatch(/qboInvoiceId|realmId|qboCustomerId/i)
  })
})

// ── Service button placement (QBO-SIMPLE-17) ───────────────────────────────────

describe('QBO-2E Prepare Invoice — service button placement (QBO-SIMPLE-17)', () => {
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
    // The modal retains both source kinds.
    expect(modalSrc).toMatch(/kind:\s*'service'/)
    expect(modalSrc).toMatch(/kind:\s*'serviceCall'/)
  })
})

// ── Firewall: no QBO API, no mutation, no financial AI authority (QBO-SIMPLE-20) ─

describe('QBO-2E Prepare Invoice — firewall (QBO-SIMPLE-20)', () => {
  it('QBO-SIMPLE-20: no QBO API request occurs (no fetch / intuit / qbo ids in modal code)', () => {
    expect(modalCode).not.toMatch(/intuit|quickbooks\.api|appcenter\.intuit|oauth\.platform\.intuit/i)
    expect(modalCode).not.toMatch(/\bfetch\s*\(/)
    expect(modalCode).not.toMatch(/qboInvoiceId|qboCustomerId|realmId/i)
    // The modal delegates AI to the wording module (no inline AI/fetch).
    expect(modalCode).not.toContain('callClaude')
  })

  it('QBO-SIMPLE-20: the AI wording module never references QBO and only reuses the Claude proxy', () => {
    expect(aiCode).not.toMatch(/intuit|quickbooks\.api|realmId|qboInvoiceId/i)
    // It reuses the existing safe server-side proxy (no new SDK / no direct key).
    expect(aiSrc).toContain("from '@/services/claudeProxy'")
    // It exposes no financial authority — its input/output carry no collected /
    // payment / contract / KPI fields (the only "amount" mention is the prompt
    // rule FORBIDDING dollar amounts, which is the enforcement, not a value).
    expect(aiCode).not.toMatch(/collected|paymentBalance|contractValue|\bkpi\b|realmId/)
    expect(aiCode).not.toMatch(/\bamount\s*:/)
  })

  it('QBO-SIMPLE-20: no payment/KPI mutation authority imported by the modal', () => {
    const protectedMutations = [
      'saveBackupData', 'saveBackupDataAndSync', 'saveBackupWithRemoteBaselineSync',
      'recordServicePayment', 'buildServiceLogWithPayment', 'ensureServicePaymentLedger',
      'createServicePaymentLegacyBaseline', 'resolveServiceLegacyPayments',
      'reconcileServiceCacheFromLedger', 'handleMarkFullPayment', 'handleLogPartialPayment',
      'ensureProjectFinanceBucket', 'recalculateWeeklyData', 'pushState',
    ]
    for (const sym of protectedMutations) {
      expect(modalCode).not.toContain(sym)
    }
    expect(modalSrc).toContain("from '@/services/backupDataService'")
    expect(modalSrc).toContain('getBackupData')
  })

  it('QBO-SIMPLE-20: prose dollar values cannot create billing lines (no prose→amount parsing)', () => {
    expect(modalSrc).toContain('type="number"')
    expect(modalCode).not.toContain('RegExp(')
    expect(parseAmount('an additional $4,500')).toBe(0)
  })
})

// ── Model delegation: no second formulas in JSX ───────────────────────────────

describe('QBO-2E Prepare Invoice — model delegation (no second billing formulas in JSX)', () => {
  it('live totals/balance come from the model, not recomputed in the component', () => {
    expect(modalSrc).toContain('prepareBillingDraft(buildSelection(read, ui))')
    expect(modalSrc).toContain('draft.currentInvoiceAmount')
    expect(modalSrc).toContain('draft.paymentBalance')
    // No line-amount reduction recomputed in JSX.
    expect(modalSrc).not.toMatch(/\.reduce\(\([^)]*amount/)
    expect(modalSrc).toContain('fmt(')
    // Warnings come from the model via reviewWarnings.
    expect(modalSrc).toContain('reviewWarnings')
    // Incomplete vs invalid severity split is preserved.
    expect(modalSrc).toContain("'invalid'")
    expect(modalSrc).toContain("'incomplete'")
  })

  it('payment context is reference only and never an invoice limit', () => {
    expect(modalSrc).toContain('Payment Balance')
    expect(modalSrc).toContain('Not tracked yet')
    expect(modalSrc).toContain('does not limit what you may invoice')
    expect(modalCode).not.toMatch(/collectedSoFar\s*[-+]/)
  })

  it('a valid project draft with one lump-sum line is ready; blank amount is incomplete (not invalid)', () => {
    const read = projectRead()
    const log = read.candidates[0]
    const ready = draftFromRead(read, ui([log.id], [L('l1', 4000, 'Progress billing', PROJECT_DEFAULT_TITLE, [log.id])]))
    expect(ready.lines).toHaveLength(1)
    expect(ready.ready).toBe(true)
    expect(ready.currentInvoiceAmount).toBe(4000)

    const blank = draftFromRead(read, ui([log.id], [L('l1', 0, '')]))
    expect(blank.ready).toBe(false)
    const flag = blank.reviewRequired.find((f) => f.reason === 'line_amount_incomplete')!
    expect(flag.severity).toBe('incomplete')
    expect(blank.reviewRequired.some((f) => f.severity === 'invalid')).toBe(false)
  })

  it('service total is a suggestion; the owner may override (QBO-SIMPLE-5/6 wiring)', () => {
    const read = readServiceBilling({ serviceLog: makeServiceLog({ quoted: 671, mat: 71 }) })
    const total = read.candidates.find((c) => c.kind === 'service_total')!
    // Suggested amount button present and sets the primary amount only.
    expect(modalSrc).toContain('Suggested amount:')
    expect(modalSrc).toContain('useServiceSuggestion')
    // The owner can type a different amount — suggestion never forces the value.
    const override = draftFromRead(read, ui([total.id], [L('l1', 500, 'Service work', SERVICE_DEFAULT_TITLE, [total.id])]))
    expect(override.currentInvoiceAmount).toBe(500)
    expect(override.ready).toBe(true)
  })
})

// ── Blank optional line does not block (QBO-SIMPLE-8/9 via activeLines) ─────────

describe('QBO-2E Prepare Invoice — optional itemization behavior (QBO-SIMPLE-8,9)', () => {
  it('QBO-SIMPLE-8: an untouched blank optional line does not block approval (filtered out by activeLines)', () => {
    const read = projectRead()
    // Primary line valid; an extra untouched line (default title, 0, blank) is inactive.
    const extra = makeBillingLine({ id: 'l2', title: PROJECT_DEFAULT_TITLE, description: '', amount: 0 })
    const d = draftFromRead(read, ui([], [L('l1', 4000, 'Progress billing'), extra]))
    expect(d.lines).toHaveLength(1) // inactive extra excluded
    expect(d.currentInvoiceAmount).toBe(4000)
    expect(d.ready).toBe(true)
    expect(d.reviewRequired.some((f) => f.lineId === 'l2')).toBe(false)
  })

  it('QBO-SIMPLE-9: a populated optional line is validated (becomes active)', () => {
    const read = projectRead()
    // Owner enters a description into the extra line → it becomes active; amount 0 → incomplete.
    const extra = makeBillingLine({ id: 'l2', title: PROJECT_DEFAULT_TITLE, description: 'Extra charge described', amount: 0 })
    const d = draftFromRead(read, ui([], [L('l1', 4000, 'Progress billing'), extra]))
    expect(d.lines).toHaveLength(2)
    expect(d.currentInvoiceAmount).toBe(4000)
    expect(d.ready).toBe(false)
    expect(d.reviewRequired.some((f) => f.lineId === 'l2' && f.severity === 'incomplete')).toBe(true)
    // A populated extra with an amount adds to the total.
    const extra2 = makeBillingLine({ id: 'l2', title: 'Trip charge', description: 'Fuel surcharge', amount: 150 })
    const d2 = draftFromRead(read, ui([], [L('l1', 4000, 'Progress billing'), extra2]))
    expect(d2.currentInvoiceAmount).toBe(4150)
    expect(d2.ready).toBe(true)
  })

  it('activeLines: primary line (index 0) is always active even when blank', () => {
    const read = projectRead()
    const d = draftFromRead(read, ui([], [L('l1', 0, '')]))
    // The blank primary line stays active → incomplete flag (not silently dropped).
    expect(d.lines).toHaveLength(1)
    expect(d.reviewRequired.some((f) => f.lineId === 'l1' && f.reason === 'line_amount_incomplete')).toBe(true)
  })
})

// ── Concurrent safety: referral/Employee/Admin/Guardian + package.json untouched ─

describe('QBO-2E concurrent safety', () => {
  it('referral/Employee/Admin/Guardian files have no billing-draft import', () => {
    const concurrent = [
      'src/services/referral/referralService.ts',
      'src/services/crewPortalService.ts',
      'src/components/admin/EmployeeProfilePanel.tsx',
      'src/views/GuardianView.tsx',
    ]
    for (const f of concurrent) {
      if (existsSync(join(ROOT, f))) {
        expect(readText(f)).not.toContain('features/billing-draft')
      }
    }
  })

  it('package.json has no Intuit dependency added by QBO-2E', () => {
    const pkg = readText('package.json').toLowerCase()
    expect(pkg).not.toContain('intuit')
  })
})