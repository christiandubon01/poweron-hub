/**
 * QBO-2D focused tests — Billing Draft owner-workflow model.
 *
 * QBO-2D simplified the QBO-2C model to the REAL owner workflow (§22): selected
 * work candidates are provenance/context; a billing line is owner-created
 * financial truth (title + description + amount); payment data is context;
 * invoice history is unknown. This file pins the corrected model behavior under
 * the QBO-BILL-* namespace.
 *
 * QBO-BILL-1   A single owner billing line produces a draft.
 * QBO-BILL-2   Multiple owner billing lines combine on one draft.
 * QBO-BILL-3   The owner may bill a partial amount (any intentional value).
 * QBO-BILL-4   Invoice amount equals the sum of owner billing lines.
 * QBO-BILL-5   Invoice history is unknown ("Not tracked") — no previouslyInvoiced field.
 * QBO-BILL-6   A blank/zero amount is INCOMPLETE (not silently dropped, not a scary error).
 * QBO-BILL-7   A missing Product/Service title is INCOMPLETE.
 * QBO-BILL-8   A negative amount is a blocking INVALID.
 * QBO-BILL-9   Draft creation does not mutate the source contract object.
 * QBO-BILL-10  Draft creation does not read or return phase_timeline schedule values.
 * QBO-BILL-11  Draft creation does not mutate payment / collected data.
 * QBO-BILL-12  Invoice truth and payment truth are independent (collected ≠ invoice).
 * QBO-BILL-13  Prose containing "$4,500" does not create a $4,500 financial line.
 * QBO-BILL-14  Payment Balance = contractValue − collectedSoFar (display only; NOT an invoice limit).
 * QBO-BILL-15  Owner may invoice more than the Payment Balance (no silent clamp, no flag).
 * QBO-BILL-16  contractValue null → no Payment Balance, no limit (owner may bill any amount).
 * QBO-BILL-17  No QuickBooks API call occurs.
 * QBO-BILL-18  No PowerOn KPI/payment mutation authority is imported by the billing-draft writer.
 * GUARD-1      No migration created.
 * GUARD-2      Referral files untouched.
 * GUARD-3      package.json untouched.
 * GUARD-4      deno.lock untouched.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { makeBillingLine, prepareBillingDraft } from '../billingDraftModel'
import { readProjectBilling } from '../projectBillingAdapter'
import { readServiceBilling } from '../serviceBillingAdapter'
import type { PreparedBillingDraft } from '../billingDraftTypes'
import type { BackupData, BackupLog, BackupProject, BackupServiceLog } from '@/services/backupDataService'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const exists = (p: string): boolean => existsSync(join(ROOT, p))

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
function payLog(id: string, projId: string, collected: number, date = '2025-01-05'): BackupLog {
  return {
    id, emp: '', hrs: 0, mat: 0, date, empId: '', miles: 0, notes: '', phase: 'Payment',
    store: '', profit: 0, projId, quoted: 0, projName: '', detailLink: '', projectQuote: 0,
    emergencyMatInfo: '', collected,
  } as BackupLog
}
function makeServiceLog(over: Partial<BackupServiceLog> = {}): BackupServiceLog {
  return {
    id: 'svc-1', hrs: 0, mat: 0, date: '2025-01-01', jtype: 'Other', miles: 0, notes: '',
    store: '', opCost: 0, profit: 0, quoted: 0, customer: 'Test Customer', collected: 0,
    payStatus: 'N', balanceDue: 0, ...over,
  } as BackupServiceLog
}

/** Build a draft from model-level inputs (owner lines are the invoice truth). */
function draft(opts: {
  lines?: ReturnType<typeof makeBillingLine>[]
  contractValue?: number | null
  collectedSoFar?: number
  selectedCandidateIds?: string[]
  candidates?: ReturnType<typeof readProjectBilling>['candidates']
}): PreparedBillingDraft {
  return prepareBillingDraft({
    sourceKind: 'project',
    sourceId: 'src-1',
    customerReference: 'Test Customer',
    contractValue: opts.contractValue ?? null,
    collectedSoFar: opts.collectedSoFar ?? 0,
    candidates: opts.candidates ?? [],
    selectedCandidateIds: opts.selectedCandidateIds ?? [],
    lines: opts.lines ?? [],
  })
}

const L = (id: string, amount: number, title = 'Electrical Project - Progress Billing', description = '', candidateIds: string[] = []) =>
  makeBillingLine({ id, title, description, amount, candidateIds })

// ── Model: owner lines ────────────────────────────────────────────────────────

describe('QBO-2D billing model — owner lines (QBO-BILL-1..8)', () => {
  it('QBO-BILL-1: a single owner billing line produces a draft', () => {
    const d = draft({ lines: [L('l1', 4000)] })
    expect(d.currentInvoiceAmount).toBe(4000)
    expect(d.lines).toHaveLength(1)
    expect(d.ready).toBe(true)
  })

  it('QBO-BILL-2: multiple owner billing lines combine on one draft', () => {
    const d = draft({ lines: [L('l1', 4500, 'Panel'), L('l2', 4000, 'Rough-in')] })
    expect(d.currentInvoiceAmount).toBe(8500)
    expect(d.lines).toHaveLength(2)
    expect(d.ready).toBe(true)
  })

  it('QBO-BILL-3: the owner may bill a partial amount (any intentional value)', () => {
    const d = draft({ lines: [L('l1', 3000)], contractValue: 10000 })
    expect(d.currentInvoiceAmount).toBe(3000)
    expect(d.ready).toBe(true)
    // No scheduled amount was rewritten — the owner's amount stands.
    expect(d.lines[0].amount).toBe(3000)
  })

  it('QBO-BILL-4: invoice amount equals the sum of owner billing lines', () => {
    const d = draft({ lines: [L('l1', 4500), L('l2', 4000), L('l3', 1000, 'Extra')] })
    expect(d.currentInvoiceAmount).toBe(d.lines.reduce((s, l) => s + l.amount, 0))
    expect(d.currentInvoiceAmount).toBe(9500)
  })

  it('QBO-BILL-5: invoice history is unknown ("Not tracked") — no previouslyInvoiced field', () => {
    const d = draft({ lines: [L('l1', 1000)] })
    // The draft carries no previouslyInvoiced / remainingContractAmount fields.
    expect('previouslyInvoiced' in d).toBe(false)
    expect('remainingContractAmount' in d).toBe(false)
    // No "remaining to invoice" value is manufactured.
    expect(JSON.stringify(d)).not.toMatch(/previouslyInvoiced|remainingToInvoice|remainingContractAmount/i)
  })

  it('QBO-BILL-6: a blank/zero amount is INCOMPLETE (not silently dropped, not a scary error)', () => {
    const d = draft({ lines: [L('l1', 0)] })
    expect(d.ready).toBe(false) // not complete until an amount is entered
    // It is flagged incomplete (subtle), NOT invalid (blocking).
    const flag = d.reviewRequired.find((f) => f.lineId === 'l1' && f.reason === 'line_amount_incomplete')
    expect(flag).toBeTruthy()
    expect(flag!.severity).toBe('incomplete')
    expect(d.reviewRequired.some((f) => f.reason === 'line_amount_negative')).toBe(false)
    // The incomplete line is still present (honest, not silently removed).
    expect(d.lines).toHaveLength(1)
    expect(d.currentInvoiceAmount).toBe(0)
  })

  it('QBO-BILL-7: a missing Product/Service title is INCOMPLETE', () => {
    const d = draft({ lines: [makeBillingLine({ id: 'l1', title: '', description: '', amount: 1000 })] })
    expect(d.ready).toBe(false)
    const flag = d.reviewRequired.find((f) => f.reason === 'line_title_missing')
    expect(flag).toBeTruthy()
    expect(flag!.severity).toBe('incomplete')
  })

  it('QBO-BILL-8: a negative amount is a blocking INVALID', () => {
    const d = draft({ lines: [L('l1', -500)] })
    expect(d.ready).toBe(false)
    const flag = d.reviewRequired.find((f) => f.reason === 'line_amount_negative')
    expect(flag).toBeTruthy()
    expect(flag!.severity).toBe('invalid')
    // The amount is preserved honestly (not clamped to 0).
    expect(d.lines[0].amount).toBe(-500)
    expect(d.currentInvoiceAmount).toBe(-500)
  })
})

// ── Model: truth separation & prose & payment balance ─────────────────────────

describe('QBO-2D billing model — truth separation & payment balance (QBO-BILL-12..16)', () => {
  it('QBO-BILL-12: invoice truth and payment truth are independent (collected ≠ invoice)', () => {
    const d = draft({ lines: [L('l1', 4000)], collectedSoFar: 3000, contractValue: 10000 })
    expect(d.currentInvoiceAmount).toBe(4000) // invoice truth
    expect(d.collectedSoFar).toBe(3000) // payment truth, independent
    expect(d.currentInvoiceAmount).not.toBe(d.collectedSoFar)
  })

  it('QBO-BILL-13: prose containing "$4,500" does not create a $4,500 financial line', () => {
    // A description string carries prose context only — never an amount.
    const d = draft({ lines: [L('l1', 1000, 'Progress billing', 'Optional add-on available for an additional $4,500.')] })
    expect(d.currentInvoiceAmount).toBe(1000) // prose created no charge
    expect(d.lines).toHaveLength(1)
  })

  it('QBO-BILL-14: Payment Balance = contractValue − collectedSoFar (display only; NOT an invoice limit)', () => {
    const d = draft({ lines: [L('l1', 2000)], contractValue: 10000, collectedSoFar: 4000 })
    expect(d.paymentBalance).toBe(6000) // 10000 − 4000
    expect(d.paymentBalance).toBe(d.contractValue! - d.collectedSoFar)
    // No QuickBooks field exists on the draft.
    expect(JSON.stringify(d)).not.toMatch(/quickbooks|qbo|intuit/i)
  })

  it('QBO-BILL-15: owner may invoice more than the Payment Balance (no silent clamp, no flag)', () => {
    // Contract $5,000, collected $4,000 → Payment Balance $1,000. Owner bills $3,000 (over balance).
    const d = draft({ lines: [L('l1', 3000)], contractValue: 5000, collectedSoFar: 4000 })
    expect(d.paymentBalance).toBe(1000)
    expect(d.currentInvoiceAmount).toBe(3000) // preserved, NOT clamped to the balance
    expect(d.ready).toBe(true) // over the payment balance is NOT a flag
    expect(d.reviewRequired.some((f) => (f.reason as string) === 'invoice_exceeds_contract')).toBe(false)
  })

  it('QBO-BILL-16: contractValue null → no Payment Balance, no limit (owner may bill any amount)', () => {
    const d = draft({ lines: [L('l1', 999999)], contractValue: null })
    expect(d.paymentBalance).toBe(null)
    expect(d.ready).toBe(true)
    expect(d.reviewRequired.some((f) => (f.reason as string) === 'invoice_exceeds_contract')).toBe(false)
  })
})

// ── Adapters: no source mutation ─────────────────────────────────────────────

describe('QBO-2D adapters — no source mutation (QBO-BILL-9,10,11)', () => {
  it('QBO-BILL-9: draft creation does not mutate the source contract object', () => {
    const project = makeProject({
      contract: 10000, billed: 5000, deposit_pct: 10,
      phase_timeline: [
        { phase_name: 'Panel', confirmed_start_date: '2025-01-01', estimated_duration_days: 10,
          actual_start_date: null, actual_end_date: null, quoted_labor_hours: null,
          quoted_material_cost: null, payment_trigger_pct: 45 },
      ],
      changeOrders: [
        { id: 'co1', title: 'Extra', description: '', stage: '', requestedBy: '', approvedBy: '',
          createdAt: '', approvalAt: '', laborCost: 0, materialCost: 0, totalCost: 1500,
          permitRelated: false, status: 'Approved' },
      ],
    })
    const backup = makeBackup([payLog('l1', 'proj-1', 3000)])
    const before = JSON.parse(JSON.stringify(project))
    const rd = readProjectBilling({ project, backup })
    prepareBillingDraft({
      sourceKind: rd.sourceKind, sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [], lines: [L('l1', 4500)],
    })
    expect(project).toEqual(before) // source contract object byte-identical
    // Change-order-adjusted contract = 10000 + 1500 = 11500.
    expect(rd.contractValue).toBe(11500)
  })

  it('QBO-BILL-10: draft creation does not read or return phase_timeline schedule values', () => {
    const project = makeProject({
      contract: 8000, billed: 0, deposit_pct: 10,
      phase_timeline: [
        { phase_name: 'Panel', confirmed_start_date: '2025-02-01', estimated_duration_days: 5,
          actual_start_date: null, actual_end_date: null, quoted_labor_hours: null,
          quoted_material_cost: null, payment_trigger_pct: 50 },
      ],
    })
    const rd = readProjectBilling({ project, backup: makeBackup() })
    // No payment schedule reference is exposed (QBO-2D §2/§21 removed it).
    expect('paymentScheduleReference' in rd).toBe(false)
    // The phase_timeline produced no candidate and no structured value.
    expect(rd.candidates.every((c) => c.kind === 'project_log')).toBe(true)
  })

  it('QBO-BILL-11: draft creation does not mutate payment / collected data', () => {
    const project = makeProject({ contract: 8000, billed: 2000, finance: { manualPaidAdjustment: 100 } })
    const backup = makeBackup([payLog('l1', 'proj-1', 2500)])
    const beforeProject = JSON.parse(JSON.stringify(project))
    const beforeBackup = JSON.parse(JSON.stringify(backup))
    const rd = readProjectBilling({ project, backup })
    expect(project).toEqual(beforeProject) // finance unchanged
    expect(backup).toEqual(beforeBackup) // logs / collected data unchanged
    // Collected truth is read-only: 2500 (logs) + 100 (manual adjustment) = 2600.
    expect(rd.collectedSoFar).toBe(2600)
  })
})

// ── Adapter: service billing pattern ──────────────────────────────────────────

describe('QBO-2D adapter — service billing (QBO-BILL service basis + workDescription)', () => {
  it('service billing can represent the total OR itemized labor + materials', () => {
    const sl = makeServiceLog({ quoted: 1000, mat: 250, collected: 0, notes: 'Replaced breaker' })
    const rd = readServiceBilling({ serviceLog: sl })
    const total = rd.candidates.find((c) => c.kind === 'service_total')!
    const labor = rd.candidates.find((c) => c.kind === 'service_labor')!
    const material = rd.candidates.find((c) => c.kind === 'service_material')!
    expect(total.structuredAmount).toBe(1000)
    expect(labor.structuredAmount).toBe(750)
    expect(material.structuredAmount).toBe(250)
    expect(rd.contractValue).toBe(1000)
    // workDescription carries the service log's actual work description.
    expect(rd.workDescription).toBe('Replaced breaker')
    // Bill the total — valid.
    const totalDraft = prepareBillingDraft({
      sourceKind: 'service', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [total.id],
      lines: [makeBillingLine({ id: 'l1', title: 'Electrical Work - Service Work', description: 'Replaced breaker', amount: 1000, candidateIds: [total.id] })],
    })
    expect(totalDraft.currentInvoiceAmount).toBe(1000)
    expect(totalDraft.ready).toBe(true)
    // Itemize — labor + materials, also valid.
    const itemizedDraft = prepareBillingDraft({
      sourceKind: 'service', sourceId: rd.sourceId, customerReference: rd.customerReference,
      contractValue: rd.contractValue, collectedSoFar: rd.collectedSoFar, candidates: rd.candidates,
      selectedCandidateIds: [labor.id, material.id],
      lines: [
        makeBillingLine({ id: 'l1', title: 'Electrical Work - Service Work', description: 'Labor', amount: 750, candidateIds: [labor.id] }),
        makeBillingLine({ id: 'l2', title: 'Electrical Work - Service Work', description: 'Materials', amount: 250, candidateIds: [material.id] }),
      ],
    })
    expect(itemizedDraft.currentInvoiceAmount).toBe(1000)
    expect(itemizedDraft.ready).toBe(true)
  })
})

// ── Firewall: no QBO API, no mutation authority imported ──────────────────────

/** Recursively list non-test .ts source under a dir. */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '__tests__') continue
      listSourceFiles(join(dir, ent.name), out)
    } else if (ent.isFile() && ent.name.endsWith('.ts')) {
      if (/\.test\.ts$/.test(ent.name) || ent.name.endsWith('.d.ts')) continue
      out.push(join(dir, ent.name))
    }
  }
  return out
}

/** Parse imported identifiers + module paths from ES-module source (block comments stripped). */
function parseImports(src: string): Array<{ modulePath: string; bindings: string[] }> {
  const cleaned = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const out: Array<{ modulePath: string; bindings: string[] }> = []
  const re = /\bimport\b(?:\s+type\b)?\s*([\s\S]*?)\bfrom\b\s*['"]([^'"]+)['"]/g
  for (let m = re.exec(cleaned); m !== null; m = re.exec(cleaned)) {
    const clause = m[1] ?? ''
    const bindings = clause.replace(/[{}*,]/g, ' ').replace(/\b(?:as|type|default)\b/g, ' ').match(/[A-Za-z_$][\w$]*/g) ?? []
    out.push({ modulePath: m[2], bindings })
  }
  return out
}

const BILLING_SOURCE = listSourceFiles(join(ROOT, 'src/features/billing-draft')).map((f) => readFileSync(f, 'utf8'))
const BILLING_SOURCE_JOINED = BILLING_SOURCE.join('\n')
const BILLING_IMPORTS = BILLING_SOURCE.flatMap((src) => parseImports(src))

describe('QBO-2D firewall (QBO-BILL-17,18)', () => {
  it('QBO-BILL-17: no QuickBooks API call occurs (no Intuit endpoint, no fetch, no QBO server import)', () => {
    expect(BILLING_SOURCE_JOINED).not.toMatch(/appcenter\.intuit\.com/i)
    expect(BILLING_SOURCE_JOINED).not.toMatch(/oauth\.platform\.intuit\.com/i)
    expect(BILLING_SOURCE_JOINED).not.toMatch(/quickbooks\.api\.intuit\.com/i)
    expect(BILLING_SOURCE_JOINED).not.toMatch(/developer\.api\.intuit\.com/i)
    expect(BILLING_SOURCE_JOINED).not.toMatch(/\bfetch\s*\(/)
    // QBO-4A.4/4A.6: billing-draft MAY import the presentational mapping feature
    // (quickbooks-customer-mapping) for identity-state only. It MUST NOT import
    // the server store/repo, Intuit SDKs, or services/quickbooks/* write paths.
    const bannedQboImports = BILLING_IMPORTS.filter((i) => {
      if (/features\/quickbooks-customer-mapping/i.test(i.modulePath)) return false
      return /intuit|quickbooks|services\/quickbooks|netlify\/functions\/quickbooks/i.test(i.modulePath)
    })
    expect(bannedQboImports).toEqual([])
    expect(BILLING_SOURCE_JOINED).not.toMatch(/qboInvoiceId|qboCustomerId|quickbooksInvoiceId/i)
  })

  it('QBO-BILL-18: no PowerOn KPI/payment mutation authority is imported by the billing-draft writer', () => {
    const protectedMutationSymbols = new Set([
      'recordServicePayment',
      'buildServiceLogWithPayment',
      'ensureServicePaymentLedger',
      'createServicePaymentLegacyBaseline',
      'resolveServiceLegacyPayments',
      'reconcileServiceCacheFromLedger',
      'newServicePaymentEventId',
      'handleMarkFullPayment',
      'handleLogPartialPayment',
      'saveBackupData',
      'saveBackupDataAndSync',
      'saveBackupWithRemoteBaselineSync',
      'ensureProjectFinanceBucket',
      'recalculateWeeklyData',
      'pushState',
    ])
    const importedBindings = new Set(BILLING_IMPORTS.flatMap((i) => i.bindings))
    const breached: string[] = []
    for (const sym of protectedMutationSymbols) {
      if (importedBindings.has(sym)) breached.push(sym)
    }
    // Sanity: the adapters DO import canonical readers (allowed).
    expect(BILLING_IMPORTS.flatMap((i) => i.bindings)).toContain('projectLogsFor')
    expect(BILLING_IMPORTS.flatMap((i) => i.bindings)).toContain('resolveServiceTotalBillable')
    // But no mutation symbol is imported.
    expect(breached).toEqual([])
    // The phase schedule reader is no longer imported (QBO-2D §2/§21).
    expect(BILLING_IMPORTS.flatMap((i) => i.bindings)).not.toContain('getPhasePaymentSchedule')
  })
})

// ── Guardrails ───────────────────────────────────────────────────────────────

describe('QBO-2D guardrails (GUARD-1..4)', () => {
  it('GUARD-1: no Supabase migration was created by QBO-2D', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
    // QBO-3A owns 132; QBO-4A.2 owns 133; QBO-4A.6 owns 134. No OTHER
    // qbo/quickbooks/intuit/billing-named migration was created by QBO-2D.
    const qboNamed = migrations.filter((f) => /qbo|quickbooks|intuit|billing/i.test(f))
    expect(qboNamed).toEqual([
      '132_quickbooks_connections_and_oauth_states.sql',
      '133_quickbooks_customer_mappings.sql',
      '134_quickbooks_customer_mapping_text_identity.sql',
    ])
    const numbers = migrations.map((f) => parseInt(f.split('_')[0], 10)).filter((n) => Number.isFinite(n))
    const max = numbers.length ? Math.max(...numbers) : 0
    // Ceiling is 134 (QBO-4A.6 text-identity correction); no migration beyond 134 exists.
    expect(max).toBeLessThanOrEqual(134)
  })

  it('GUARD-2: referral files untouched — none imports the billing-draft model', () => {
    const referralFiles = [
      'src/services/referral/referralService.ts',
      'src/components/salesIntel/tabs/ReferralsTab.tsx',
      'src/__tests__/leadSrc4hUnlinkedReferrer.test.ts',
      'src/__tests__/leadSrc4iReferralProfiles.test.ts',
      'supabase/migrations/130_referral_profiles.sql',
      'supabase/migrations/129_referral_unlinked_confirmation.sql',
    ]
    for (const f of referralFiles) {
      if (exists(f)) {
        const src = read(f)
        expect(src).not.toContain('features/billing-draft')
        expect(src).not.toContain('billingDraftModel')
        expect(src).not.toContain('projectBillingAdapter')
        expect(src).not.toContain('serviceBillingAdapter')
      }
    }
  })

  it('GUARD-3: package.json untouched by QBO-2D (no QuickBooks/Intuit/billing dependency added)', () => {
    const pkg = read('package.json').toLowerCase()
    expect(pkg).not.toContain('intuit')
    expect(pkg).not.toMatch(/"(intuit|@intuit|quickbooks)[^"]*"\s*:\s*"\^?\d/)
  })

  it('GUARD-4: deno.lock untouched by QBO-2D (no Intuit entry added)', () => {
    if (exists('deno.lock')) {
      expect(read('deno.lock').toLowerCase()).not.toContain('intuit')
    }
  })
})