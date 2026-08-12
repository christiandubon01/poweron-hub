import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SERVICE_CALL_MODAL_SUBTITLE } from '@/components/v15r/ServiceCallModalLayout'
import { validateCrewForCosting } from '@/features/service-quote/crewCosting'
import { computeServiceQuote } from '@/features/service-quote/serviceQuoteMath'

/**
 * SERVICE-CALL-UI-2B — dual-compartment Service Call modal contract.
 *
 * New and Edit Service Call already open ONE canonical form (SERVICE-LOG-1);
 * this pass splits that form into a left field-entry compartment and a right
 * costing/pricing compartment behind one shared shell, without touching any
 * Service financial or payment authority.
 */

const ROOT = process.cwd()
function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const PANEL = 'src/components/v15r/V15rFieldLogPanel.tsx'
const LAYOUT = 'src/components/v15r/ServiceCallModalLayout.tsx'
const PROJECT_LAYOUT = 'src/components/v15r/ProjectLogModalLayout.tsx'
const PROJECT_PANEL = 'src/components/v15r/ProjectLogFinancialPanel.tsx'
const HEADER = 'src/components/v15r/V15rLayout.tsx'
const QUOTE_MATH = 'src/features/service-quote/serviceQuoteMath.ts'
const PAYMENT_LEDGER = 'src/features/service-quote/servicePaymentLedger.ts'

const panel = src(PANEL)
const layout = src(LAYOUT)

/**
 * Strip comments so "must not reference X" checks test executable code rather
 * than the prose that documents why X is deliberately NOT used.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const layoutCode = stripComments(layout)

/** The Service Call modal region of the panel. */
function modalSlice(): string {
  const start = panel.indexOf('{/* Service Call Modal')
  const end = panel.indexOf('{/* Collections Queue */}')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return panel.slice(start, end)
}

/** The JSX passed as the layout's `left={...}` compartment. */
function leftSlice(): string {
  const modal = modalSlice()
  const from = modal.indexOf('left={')
  const to = modal.indexOf('right={', from)
  expect(from).toBeGreaterThan(-1)
  expect(to).toBeGreaterThan(from)
  return modal.slice(from, to)
}

/** The JSX passed as the layout's `right={...}` compartment. */
function rightSlice(): string {
  const modal = modalSlice()
  const from = modal.indexOf('right={')
  expect(from).toBeGreaterThan(-1)
  return modal.slice(from)
}

describe('SERVICE-CALL-UI-2B — dual-compartment modal', () => {
  // ── LAYOUT 1..3 ───────────────────────────────────────────────────────────
  it('LAYOUT-1/2: New and Edit both render the dual-compartment shell', () => {
    expect(panel).toContain("import ServiceCallModalLayout, { ServiceCallSection } from './ServiceCallModalLayout'")
    expect(panel).toContain('<ServiceCallModalLayout')
    // One shell, one mode flag — New and Edit cannot render different chrome.
    expect(panel).toContain("mode={editSvcId ? 'edit' : 'new'}")
    expect(layout).toContain("isEdit ? 'Edit Service Call' : 'New Service Call'")
    expect(layout).toContain("isEdit ? '✓ Update Service Call' : '✓ Save Service Call'")
  })

  it('LAYOUT-3: exactly one Service modal shell exists, and the old one is gone', () => {
    expect(panel.match(/<ServiceCallModalLayout/g)).toHaveLength(1)
    const modal = modalSlice()
    // No hand-rolled overlay/card survives at the Service Call call site.
    const shellPrefix = modal.slice(0, modal.indexOf('<ServiceCallModalLayout'))
    expect(shellPrefix).not.toContain('fixed inset-0')
    expect(shellPrefix).not.toContain('backdropFilter')
    expect(shellPrefix).not.toContain('max-w-5xl')
    // Chrome now lives in exactly one file.
    expect(layout).toContain('data-testid="service-call-modal"')
    expect(layout).toContain('backdropFilter')
    expect(SERVICE_CALL_MODAL_SUBTITLE)
      .toBe('Work performed and collected — Total Quoted is the customer amount')
  })

  // ── LAYOUT 4..7 — the split ───────────────────────────────────────────────
  it('LAYOUT-4: the LEFT compartment holds the Service entry fields', () => {
    const left = leftSlice()
    for (const field of [
      'Relationship Account', 'Customer / Job Name', 'Address', 'Job Type',
      'Est. Hours', 'Actual Hours', 'Bill Rate $', 'Miles RT',
      'Collected $', 'Status', 'Date Received', 'Balance remaining:',
      'VoiceMaterialCapture', 'Store', 'Emergency Mat Info', 'Detail Link', 'Notes',
    ]) {
      expect(left, `left compartment is missing ${field}`).toContain(field)
    }
    // Section headings mirror the contracted grouping.
    for (const section of [
      'title="Job / Customer"', 'title="Work Inputs"', 'title="Assignment"',
      'title="Payment"', 'title="Materials + Proof"', 'title="Notes"',
    ]) {
      expect(left).toContain(section)
    }
    // No costing/pricing content bleeds into the entry side.
    expect(left).not.toContain('CostingCrewField')
    expect(left).not.toContain('ServiceQuotePanel')
    expect(left).not.toContain('CrewCostBreakdownPanel')
  })

  it('LAYOUT-5: the RIGHT compartment holds Costing Crew plus the financial outputs', () => {
    const right = rightSlice()
    expect(right).toContain('title="Costing Crew"')
    expect(right).toContain('<CostingCrewField')
    expect(right).toContain('<ServiceQuotePanel')
    expect(right).toContain('<ServiceQuoteMissingPanel')
    expect(right).toContain('<CrewCostBreakdownPanel')
    // Ordered: Costing Crew → quote/profit → crew cost breakdown.
    expect(right.indexOf('<CostingCrewField')).toBeLessThan(right.indexOf('<ServiceQuotePanel'))
    expect(right.indexOf('<ServiceQuotePanel')).toBeLessThan(right.indexOf('<CrewCostBreakdownPanel'))
    // No entry field sneaks into the financial side.
    for (const field of ['Customer / Job Name', 'Collected $', 'Emergency Mat Info', 'Notes']) {
      expect(right).not.toContain(field)
    }
  })

  it('LAYOUT-6: Assigned Employees stays LEFT — it describes job assignment', () => {
    expect(leftSlice()).toContain('<AssignedEmployeesField')
    expect(rightSlice()).not.toContain('<AssignedEmployeesField')
    // Exactly once in the Service CALL modal. (The blue Service ESTIMATE modal
    // has its own copy — a separate, out-of-scope workflow.)
    expect(modalSlice().match(/<AssignedEmployeesField/g)).toHaveLength(1)
  })

  it('LAYOUT-7: Costing Crew stays RIGHT — it determines pricing', () => {
    expect(rightSlice()).toContain('<CostingCrewField')
    expect(leftSlice()).not.toContain('<CostingCrewField')
    expect(modalSlice().match(/<CostingCrewField/g)).toHaveLength(1)
  })

  // ── LAYOUT 8..10 — chrome ─────────────────────────────────────────────────
  it('LAYOUT-8/9/10: one shared footer, one Cancel, one Save/Update', () => {
    const footerIdx = layout.indexOf('data-testid="service-call-modal-footer"')
    const bodyIdx = layout.indexOf('data-testid="service-call-modal-body"')
    const headerIdx = layout.indexOf('data-testid="service-call-modal-header"')
    expect(headerIdx).toBeLessThan(bodyIdx)
    expect(footerIdx).toBeGreaterThan(bodyIdx)
    expect(layout.match(/>\s*Cancel\s*</g)).toHaveLength(1)
    expect(layout.match(/data-testid="save-service-call"/g)).toHaveLength(1)
    // Neither compartment carries its own primary action. (The Payment
    // section's legacy-date editor keeps its own nested Cancel — a pre-existing
    // sub-control, not a second modal dismissal.)
    expect(modalSlice()).not.toContain('data-testid="save-service-call"')
    expect(leftSlice()).not.toContain('onClick={saveSvcEntry}')
    expect(rightSlice()).not.toContain('onClick={saveSvcEntry}')
    expect(rightSlice()).not.toMatch(/>\s*Cancel\s*</)
    // The disable-on-missing-rates gate survived the move.
    expect(panel).toContain('saveDisabled={slMissingRates.length > 0}')
    expect(layout).toContain('disabled={saveDisabled}')
    // Chrome is flex-none so scrolling never hides Save/Update.
    expect(layout.slice(headerIdx - 400, headerIdx)).toContain('flex-shrink-0')
    expect(layout.slice(footerIdx - 400, footerIdx)).toContain('flex-shrink-0')
  })

  // ── LAYOUT 11..12 — scrolling and stacking ────────────────────────────────
  it('LAYOUT-11: desktop panes scroll independently', () => {
    expect(layout).toContain('className="flex-none px-4 sm:px-6 py-5 space-y-4 xl:min-h-0 xl:w-[44%] xl:overflow-y-auto"')
    expect(layout).toContain('xl:min-h-0 xl:w-[56%] xl:overflow-y-auto')
    // At xl the body itself does not scroll, so one pane cannot drag the other.
    expect(layout).toContain('relative flex min-h-0 flex-1 flex-col overflow-y-auto xl:flex-row xl:overflow-hidden')
  })

  it('LAYOUT-12: narrow layouts stack entry above financials with one scrollbar', () => {
    expect(layout).toMatch(/flex-col overflow-y-auto xl:flex-row xl:overflow-hidden/)
    expect(layout.indexOf('service-call-modal-left'))
      .toBeLessThan(layout.indexOf('service-call-modal-right'))
    // Full width until the breakpoint; the divider flips from top to left.
    expect(layout).not.toMatch(/\sw-\[(44|56)%\]/)
    expect(layout).toContain('xl:border-l xl:border-t-0')
    // Readability over density — no sub-10px type in the shell.
    expect(layout).not.toMatch(/text-\[[0-9]px\]/)
  })

  it('matches the Project Log width benchmark without importing Project code', () => {
    expect(layout).toContain("width: 'min(94vw, 1560px)'")
    expect(layout).toContain("maxHeight: '92vh'")
    expect(layout).not.toContain('100vw')
    // Visual contract reused, Project semantics NOT reused. Asserted against
    // executable code — the doc comment names Project Log to explain why.
    expect(layoutCode).not.toContain('ProjectLogModalLayout')
    expect(layoutCode).not.toContain('ProjectLogFinancialPanel')
    // Service keeps its orange identity rather than borrowing Project's teal.
    expect(layout).toContain('rgba(249,115,22,0.35)')
    expect(layout).toContain('bg-orange-600')
  })

  // ── LIVE 1..6 — the right pane stays connected to the form state ──────────
  it('LIVE-1..6: the right pane recomputes from live form state on every render', () => {
    const right = rightSlice()
    // Both helpers are CALLED during render in the right compartment — no
    // memoised or frozen copy sits between the inputs and the outputs.
    expect(right).toContain('serviceCallDisplayQuote()')
    expect(right).toContain('serviceCallCrewQuote()')
    expect(right).toContain('errors={serviceCallCrewQuote().errors}')

    // Those helpers read exactly the state the LEFT inputs write.
    const quoteFn = panel.slice(panel.indexOf('function serviceCallQuote('), panel.indexOf('function estimateCrewQuote('))
    for (const state of ['slEstHrs', 'slHrs', 'slBillRate', 'slMat', 'slMi', 'slQuoted']) {
      expect(quoteFn, `serviceCallQuote must read ${state}`).toContain(state)
    }
    const crewFn = panel.slice(panel.indexOf('function serviceCallCrewQuote('), panel.indexOf('function serviceCallDisplayQuote('))
    for (const state of ['slEstHrs', 'slHrs', 'slMat', 'slMi', 'slCostingSource', 'slPricingCrewIds', 'slQuoted']) {
      expect(crewFn, `serviceCallCrewQuote must read ${state}`).toContain(state)
    }
    // Total Quoted still round-trips through the panel's own setter.
    expect(right).toContain('onTotalQuotedChange={(raw) => { setSlQuoted(raw); setSlQuotedManual(true) }}')
    expect(right).toContain('onUseSuggested={() => { setSlQuoted(String(quote.suggestedQuote)); setSlQuotedManual(false) }}')
  })

  it('LIVE-1..4 (behaviour): hours, bill rate, miles and materials still move the quote', () => {
    const base = { hours: 4, billRate: 95, materials: 100, miles: 20, mileRate: 0.66, taxRatePct: 8.75, opCostRate: 42.45 }
    const q = computeServiceQuote(base)
    expect(computeServiceQuote({ ...base, hours: 8 }).suggestedQuote).not.toBe(q.suggestedQuote)
    expect(computeServiceQuote({ ...base, billRate: 150 }).suggestedQuote).not.toBe(q.suggestedQuote)
    expect(computeServiceQuote({ ...base, miles: 80 }).suggestedQuote).not.toBe(q.suggestedQuote)
    expect(computeServiceQuote({ ...base, materials: 400 }).suggestedQuote).not.toBe(q.suggestedQuote)
  })

  it('LIVE-6 (behaviour): Total Quoted still drives variance and actual profit', () => {
    const base = { hours: 4, billRate: 95, materials: 100, miles: 20, mileRate: 0.66, taxRatePct: 8.75, opCostRate: 42.45 }
    const suggested = computeServiceQuote(base).suggestedQuote
    const higher = computeServiceQuote(base, suggested + 100)
    const lower = computeServiceQuote(base, suggested - 100)
    expect(higher.totalQuoted).toBeGreaterThan(lower.totalQuoted)
    expect(higher.quoteVariance).toBeGreaterThan(lower.quoteVariance)
    expect(higher.actualEstimatedProfit).toBeGreaterThan(lower.actualEstimatedProfit)
  })

  // ── STATE 1..3 — invalid costing stays visible and explains itself ────────
  it('STATE-1/2 (behaviour): zero Site Hours and missing crew still warn', () => {
    const zeroHours = validateCrewForCosting([], 25, 0)
    expect(zeroHours.valid).toBe(false)
    expect(zeroHours.errors).toContain('Site Hours must be greater than 0.')
    expect(zeroHours.errors).toContain('Select a Costed Field Crew or a Pricing Crew before calculating.')
  })

  it('STATE-3: the right pane renders unconditionally, warnings and all', () => {
    const modal = modalSlice()
    // `right={` is a plain prop on the layout — never wrapped in a validity gate.
    const rightProp = modal.slice(modal.indexOf('right={'), modal.indexOf('right={') + 200)
    expect(rightProp).not.toMatch(/right=\{\s*(slCostingMode === 'crew'|.*errors\.length === 0|.*\.valid)\s*&&/)
    expect(rightSlice()).toContain('title="Costing Crew"')
    // The layout always renders both compartments.
    expect(layout).toContain('{left}')
    expect(layout).toContain('{right}')
    expect(layout).not.toMatch(/\{\s*\w+\s*&&\s*\(?\s*\{?right\}?/)
    // Errors are handed to the crew field so the owner sees WHY it is inactive.
    expect(rightSlice()).toContain('errors={serviceCallCrewQuote().errors}')
  })

  // ── PAYMENT 1..3 — untouched ──────────────────────────────────────────────
  it('PAYMENT-1/2/3: collected, date-received and balance behaviour are unchanged', () => {
    const left = leftSlice()
    expect(left).toContain("key={`slCollected-${editSvcId || 'new'}`}")
    expect(left).toContain('readOnly={editingSvcHasLedger}')
    // Date Received is still New-only, exactly as before.
    expect(left).toContain('{!editSvcId && (')
    expect(left).toContain('Date Received')
    expect(left).toContain('value={slReceivedAt}')
    // Balance line and refusal notice still read the same preview helper.
    expect(left).toContain('serviceCallPaymentPreview()')
    expect(left).toContain('Balance remaining:')
    expect(left).toContain('preview.blocked')
    // Status never rewrites cash.
    expect(left).toContain('<option value="Y">Paid in Full</option>')
    expect(left).toContain('<option value="P">Partial</option>')
    expect(left).toContain('<option value="N">Unpaid</option>')
    expect(left).not.toContain('setSlCollected(reconciled.collected')
    // Payment History + legacy resolution travelled with the Payment section.
    expect(left).toContain('Payment History')
    expect(left).toContain('beginLegacyResolve')
    expect(left).toContain('commitResolveLegacyPayments')
  })

  // ── GUARD 1..5 ────────────────────────────────────────────────────────────
  it('GUARD-1/2: Project Log files are not involved in the Service modal', () => {
    const projectLayout = src(PROJECT_LAYOUT)
    const projectPanel = src(PROJECT_PANEL)
    for (const s of [projectLayout, projectPanel]) {
      expect(s).not.toContain('ServiceCallModalLayout')
      expect(s).not.toContain('service-call')
      expect(s).not.toContain('saveSvcEntry')
    }
    // Service does not reach for the Project shell either.
    expect(layoutCode).not.toContain('ProjectLog')
    expect(layoutCode).not.toMatch(/from '\.\/ProjectLog/)
  })

  it('GUARD-3: the app header is not involved', () => {
    const header = src(HEADER)
    expect(header).not.toContain('ServiceCallModalLayout')
    expect(header).not.toContain('service-call-modal')
  })

  it('GUARD-4/5: quote math and the payment ledger are untouched by the layout', () => {
    // The layout owns no math, no state and no persistence.
    for (const forbidden of [
      'computeServiceQuote', 'crewQuote', 'reconcileServicePayment', 'useState',
      'saveBackupData', 'localStorage', 'supabase', 'pushState(',
      'mileRate', 'taxRate', 'opCost',
    ]) {
      expect(layout, `layout must not reference ${forbidden}`).not.toContain(forbidden)
    }
    // The authorities still exist and are still the ones the modal calls.
    expect(src(QUOTE_MATH)).toContain('export function computeServiceQuote')
    expect(src(PAYMENT_LEDGER).length).toBeGreaterThan(0)
    expect(panel).toContain('const payment = reconcileServicePayment(slPayStatus, collected, totalBillableAtSave)')
  })
})
