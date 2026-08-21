/**
 * QBO-2F1 — global QuickBooks actions consolidation + unpaid-work Prepare
 * Invoice selector.
 *
 * Two test layers:
 *  1. PURE unit test of the shared eligibility filter (`filterUnpaidByBalance`)
 *     — proves paid/fully-settled entries are excluded and unpaid entries are
 *     included, sorted biggest-balance-first, with the 0.009 threshold. The
 *     balance itself is INJECTED (a stub), so this test never redefines how a
 *     service balance is computed — it only exercises the filter mechanics.
 *  2. Source-substring contract (vitest node env, no DOM) pinning that:
 *     - the global header conditional Prepare Invoice visibility is wired
 *     - the unpaid selector + Collections queue BOTH derive from the single
 *       `getUnpaidServiceCalls` authority (no duplicate unpaid rule)
 *     - selecting a job opens the EXISTING PrepareInvoiceModal with a service
 *       source (no second editor)
 *     - the PDF importer action + Draft Manager action are preserved
 *     - contextual Project/Service menus are preserved
 *     - Historical Payments is untouched
 *     - the selector/menu/eligibility modules perform no QBO API and no
 *       payment/KPI mutation (firewall)
 *
 * Spec verification numbers covered: #6, #7, #8, #9, #10, #13, #14, #15, #16.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { filterUnpaidByBalance, UNPAID_BALANCE_THRESHOLD } from '@/features/billing-draft/unpaidServiceEligibility'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
// Strip /* */ block comments so assertions target code, not comments.
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ')

const fieldLogSrc = codeOnly(read('src/components/v15r/V15rFieldLogPanel.tsx'))
const selectorSrc = codeOnly(read('src/features/billing-draft/components/PrepareInvoiceSelectorModal.tsx'))
const eligibilitySrc = codeOnly(read('src/features/billing-draft/unpaidServiceEligibility.ts'))
const menuSrc = codeOnly(read('src/features/billing-draft/components/QuickBooksMenu.tsx'))

// ── 1. Pure eligibility filter ────────────────────────────────────────────────

describe('QBO-2F1 filterUnpaidByBalance — pure eligibility (paid excluded, unpaid included)', () => {
  interface Item { id: string; balance: number }
  const balanceOf = (i: Item) => i.balance

  it('paid / fully-settled (balance 0) entries are excluded', () => {
    const items: Item[] = [
      { id: 'paid', balance: 0 },
      { id: 'paid-round', balance: 0.005 }, // below threshold → treated as paid
      { id: 'unpaid', balance: 500 },
    ]
    const out = filterUnpaidByBalance(items, balanceOf)
    expect(out.map((i) => i.id)).toEqual(['unpaid'])
  })

  it('eligible unpaid (balance > threshold) entries are included', () => {
    const items: Item[] = [
      { id: 'a', balance: 100 },
      { id: 'b', balance: 250.5 },
      { id: 'c', balance: 1000 },
    ]
    const out = filterUnpaidByBalance(items, balanceOf)
    expect(out).toHaveLength(3)
    expect(out.map((i) => i.id)).toContain('a')
    expect(out.map((i) => i.id)).toContain('b')
    expect(out.map((i) => i.id)).toContain('c')
  })

  it('sorted biggest balance first (matches the Collections queue ordering)', () => {
    const items: Item[] = [
      { id: 'small', balance: 50 },
      { id: 'big', balance: 5000 },
      { id: 'mid', balance: 750 },
    ]
    const out = filterUnpaidByBalance(items, balanceOf)
    expect(out.map((i) => i.id)).toEqual(['big', 'mid', 'small'])
  })

  it('uses the 0.009 threshold (a balance just above it is included; just below excluded)', () => {
    expect(UNPAID_BALANCE_THRESHOLD).toBe(0.009)
    const items: Item[] = [
      { id: 'just-below', balance: 0.009 }, // not > threshold → excluded
      { id: 'just-above', balance: 0.01 }, // > threshold → included
    ]
    const out = filterUnpaidByBalance(items, balanceOf)
    expect(out.map((i) => i.id)).toEqual(['just-above'])
  })

  it('does not mutate the input array', () => {
    const items: Item[] = [{ id: 'a', balance: 10 }, { id: 'b', balance: 0 }]
    const snapshot = items.map((i) => ({ ...i }))
    filterUnpaidByBalance(items, balanceOf)
    expect(items).toEqual(snapshot)
  })
})

// ── 2. Single unpaid authority — no duplicate rule (#8, #9, #15) ──────────────

describe('QBO-2F1 — single unpaid authority reused by both surfaces (#8, #9, #15)', () => {
  it('the eligibility filter is defined once in a pure module (threshold + sort only)', () => {
    expect(eligibilitySrc).toContain('filterUnpaidByBalance')
    expect(eligibilitySrc).toContain('UNPAID_BALANCE_THRESHOLD')
    // It does NOT redefine a service balance (delegates via injected balanceOf).
    expect(eligibilitySrc).not.toMatch(/serviceBalanceDue|getServiceRollup|balanceDue|remainingDue/i)
  })

  it('FieldLogPanel defines getUnpaidServiceCalls once, delegating to serviceBalanceDue (the balance authority)', () => {
    const defCount = (fieldLogSrc.match(/function getUnpaidServiceCalls\b/g) ?? []).length
    expect(defCount).toBe(1)
    expect(fieldLogSrc).toContain('filterUnpaidByBalance(activeLogs, serviceBalanceDue)')
  })

  it('serviceBalanceDue is defined once (no second balance/outstanding rule introduced)', () => {
    const defCount = (fieldLogSrc.match(/function serviceBalanceDue\b/g) ?? []).length
    expect(defCount).toBe(1)
  })

  it('the Collections queue derives from getUnpaidServiceCalls (no inline duplicate filter)', () => {
    const collectionsIdx = fieldLogSrc.indexOf('const collections = getUnpaidServiceCalls(sorted)')
    expect(collectionsIdx).toBeGreaterThan(-1)
    // The old inline `.filter(l => serviceBalanceDue(l) > 0.009)` on the
    // collections line is gone (the rule now lives in getUnpaidServiceCalls).
    expect(fieldLogSrc).not.toMatch(/const collections = sorted\s*\n?\s*\.filter\(l => serviceBalanceDue\(l\) > 0\.009\)/)
  })

  it('the global selector derives from the SAME getUnpaidServiceCalls authority', () => {
    expect(fieldLogSrc).toContain('const unpaidServiceCalls = getUnpaidServiceCalls(activeServiceLogs)')
  })

  it('the global menu gates Prepare Invoice on unpaidServiceCalls.length > 0 (#6, #7)', () => {
    expect(fieldLogSrc).toMatch(/showPrepareInvoice=\{unpaidServiceCalls\.length > 0\}/)
  })
})

// ── 3. Selector behavior + correct source passed (#10) ────────────────────────

describe('QBO-2F1 selector — correct source passed into Prepare Invoice (#10)', () => {
  it('selecting a job calls openPrepareInvoice(<serviceLog>) then closes the selector', () => {
    // The selector's onSelect finds the log in unpaidServiceCalls and opens the
    // existing PrepareInvoiceModal for it (no second editor).
    const onSelectIdx = fieldLogSrc.indexOf('onSelect={(id)')
    expect(onSelectIdx).toBeGreaterThan(-1)
    const block = fieldLogSrc.slice(onSelectIdx, onSelectIdx + 220)
    expect(block).toContain('unpaidServiceCalls.find')
    expect(block).toContain('openPrepareInvoice(')
    expect(block).toContain('setShowPrepareInvoiceSelector(false)')
  })

  it('opening from the selector reuses the existing PrepareInvoiceModal with a service source', () => {
    // openPrepareInvoice sets prepareSvcLog; the modal opens with kind 'service'.
    expect(fieldLogSrc).toContain('setPrepareSvcLog(l)')
    expect(fieldLogSrc).toMatch(/kind:\s*'service'/)
    // No second invoice editor is introduced — PrepareInvoiceModal is rendered once.
    const modalCount = (fieldLogSrc.match(/<PrepareInvoiceModal/g) ?? []).length
    expect(modalCount).toBe(1)
  })

  it('the selector component is presentational — it receives items and does not recompute balance', () => {
    expect(selectorSrc).toContain('PrepareInvoiceSelectorModal')
    expect(selectorSrc).toContain('items: UnpaidServiceItem')
    expect(selectorSrc).toContain('onSelect: (id: string) => void')
    // No balance/unpaid/outstanding authority is imported or recomputed inside.
    expect(selectorSrc).not.toMatch(/serviceBalanceDue|getServiceRollup|filterUnpaidByBalance|getUnpaidServiceCalls/)
    // It only displays the balance it is handed (balanceDue field), not a calc.
    expect(selectorSrc).toContain('item.balanceDue')
  })

  it('the selector shows an empty state when there is nothing eligible (defensive)', () => {
    expect(selectorSrc).toMatch(/No unpaid service work to invoice/)
  })

  it('the selector uses existing PowerOn visual language + portal + Escape + outside click', () => {
    expect(selectorSrc).toContain('createPortal')
    expect(selectorSrc).toContain('Escape')
    expect(selectorSrc).toContain('aria-modal="true"')
    expect(selectorSrc).toContain('role="dialog"')
    // Outside click closes (mousedown target === currentTarget).
    expect(selectorSrc).toMatch(/e\.target === e\.currentTarget/)
  })
})

// ── 4. PDF importer + Draft Manager actions preserved (#4, #5) ────────────────

describe('QBO-2F1 — PDF importer + Draft Manager actions preserved (#4, #5)', () => {
  it('Import QuickBooks PDF opens the EXACT existing importer (showQBImport, mode="service")', () => {
    expect(fieldLogSrc).toMatch(/onImportQbPdf=\{\(\) => setShowQBImport\(true\)\}/)
    expect(fieldLogSrc).toContain('QuickBooksImportModal')
    expect(fieldLogSrc).toMatch(/mode="service"/)
    // The importer's onImported hook (forceUpdate) is preserved.
    expect(fieldLogSrc).toMatch(/onImported=\{\(\) => \{ forceUpdate\(\) \}\}/)
  })

  it('Invoice Drafts opens the existing shared Draft Manager (no second manager)', () => {
    expect(fieldLogSrc).toContain('onOpenDrafts={qb.openDrafts}')
    expect(fieldLogSrc).toContain('InvoiceDraftsModal')
    const managerCount = (fieldLogSrc.match(/<InvoiceDraftsModal/g) ?? []).length
    expect(managerCount).toBe(1)
  })
})

// ── 5. Contextual Project/Service menus preserved (#11, #12) ──────────────────

describe('QBO-2F1 — contextual menus preserved (#11, #12)', () => {
  it('the per-service-log contextual QuickBooks menu keeps Prepare Invoice + Drafts (no Import)', () => {
    // The contextual menu (beside Convert to Estimate) does not pass Import or
    // a showPrepareInvoice override → Prepare Invoice stays visible there.
    const ctxIdx = fieldLogSrc.indexOf('onPrepareInvoice={() => openPrepareInvoice(l)}')
    expect(ctxIdx).toBeGreaterThan(-1)
    const ctxBlock = fieldLogSrc.slice(ctxIdx, ctxIdx + 160)
    expect(ctxBlock).toContain('onOpenDrafts={qb.openDrafts}')
    expect(ctxBlock).not.toMatch(/onImportQbPdf|showPrepareInvoice/)
  })

  it('the Project surface contextual menu still has Prepare Invoice + Invoice Drafts', () => {
    const projectSrc = codeOnly(read('src/components/v15r/V15rProjectInner.tsx'))
    expect(projectSrc).toContain('QuickBooksMenu')
    expect(projectSrc).toContain('onPrepareInvoice')
    expect(projectSrc).toContain('onOpenDrafts')
  })
})

// ── 6. Historical Payments untouched (#1) ─────────────────────────────────────

describe('QBO-2F1 — Historical Payments untouched (#1)', () => {
  it('Historical Payments remains an independent header button with its own handler', () => {
    expect(fieldLogSrc).toContain('Historical Payments')
    expect(fieldLogSrc).toContain('data-testid="historical-payments-button"')
    expect(fieldLogSrc).toMatch(/onClick=\{\(\) => setShowHistoricalPayments\(true\)\}/)
    // Its reconciliation badge logic is preserved.
    expect(fieldLogSrc).toContain('reconciliationQueue.unresolvedCount')
  })
})

// ── 7. Firewall — no QBO API, no payment/KPI mutation (#13, #14, #15) ──────────

describe('QBO-2F1 — financial-authority firewall (#13, #14, #15)', () => {
  it('the selector + eligibility + menu modules perform no QBO API call', () => {
    const feature = [selectorSrc, eligibilitySrc, menuSrc].join('\n')
    expect(feature).not.toMatch(/intuit|quickbooks\.api|oauth\.platform\.intuit/i)
    expect(feature).not.toMatch(/\bfetch\s*\(/)
  })

  it('the selector + eligibility + menu modules import no payment/KPI mutation authority', () => {
    const feature = [selectorSrc, eligibilitySrc, menuSrc].join('\n')
    expect(feature).not.toMatch(
      /saveBackupData|saveBackupDataAndSync|recordServicePayment|ensureServicePaymentLedger|ensureProjectFinanceBucket|recalculateWeeklyData|pushState/,
    )
  })

  it('opening/using the selector writes no payment/KPI/QBO truth (host delegates to existing editor)', () => {
    // The global menu's Prepare Invoice handler only opens the selector (state).
    const menuHandlerIdx = fieldLogSrc.indexOf('onPrepareInvoice={() => setShowPrepareInvoiceSelector(true)}')
    expect(menuHandlerIdx).toBeGreaterThan(-1)
    const menuHandler = fieldLogSrc.slice(menuHandlerIdx, menuHandlerIdx + 60)
    expect(menuHandler).not.toMatch(/saveBackupData|recordServicePayment|recalculateWeeklyData|pushState/)

    // onSelect only finds the log + openPrepareInvoice + closes (no mutation).
    const onSelectIdx = fieldLogSrc.indexOf('onSelect={(id)')
    expect(onSelectIdx).toBeGreaterThan(-1)
    const onSelectBlock = fieldLogSrc.slice(onSelectIdx, onSelectIdx + 240)
    expect(onSelectBlock).not.toMatch(/saveBackupData|recordServicePayment|recalculateWeeklyData|pushState/)
    // openPrepareInvoice itself only sets the prepare source (no mutation).
    const openIdx = fieldLogSrc.indexOf('const openPrepareInvoice = useCallback')
    const openBlock = fieldLogSrc.slice(openIdx, openIdx + 120)
    expect(openBlock).toContain('setPrepareSvcLog(l)')
    expect(openBlock).not.toMatch(/saveBackupData|recordServicePayment|recalculateWeeklyData|pushState/)
  })
})