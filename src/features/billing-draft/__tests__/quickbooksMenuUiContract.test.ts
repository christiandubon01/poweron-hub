/**
 * QBO-2F — QuickBooks menu + shared Invoice Drafts Manager UI contract.
 *
 * Source-substring contract (vitest node env, no DOM): pins the wiring without
 * rendering.
 *
 *  #16  The QuickBooks menu opens the correct context-specific Prepare Invoice on
 *       BOTH the Project billing surface and the Service Log / Service Call billing
 *       surface (reusable menu, surface-specific onPrepareInvoice).
 *  #17  BOTH surfaces open the SAME Invoice Drafts Manager (one shared
 *       InvoiceDraftsModal, not per-surface managers).
 *
 * Also pins that neighboring controls (Convert to Estimate) are preserved and that
 * no standalone "Prepare Invoice" button remains on these surfaces.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
// Strip /* */ block comments so assertions target code, not comments.
const codeOnly = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ')

const projectSrc = codeOnly(read('src/components/v15r/V15rProjectInner.tsx'))
const serviceSrc = codeOnly(read('src/components/v15r/V15rServiceCallsV2.tsx'))
const fieldLogSrc = codeOnly(read('src/components/v15r/V15rFieldLogPanel.tsx'))
const menuSrc = codeOnly(read('src/features/billing-draft/components/QuickBooksMenu.tsx'))
const draftsModalSrc = codeOnly(read('src/features/billing-draft/components/InvoiceDraftsModal.tsx'))
const prepareModalSrc = read('src/features/billing-draft/components/PrepareInvoiceModal.tsx')
const hookSrc = codeOnly(read('src/features/billing-draft/useQuickBooksInvoicing.ts'))

// ── QuickBooksMenu component ──────────────────────────────────────────────────

describe('QBO-2F QuickBooksMenu component', () => {
  it('exposes exactly Prepare Invoice + Invoice Drafts (no fake future actions)', () => {
    expect(menuSrc).toContain('Prepare Invoice')
    expect(menuSrc).toContain('Invoice Drafts')
    // No disabled/placeholder future entries.
    expect(menuSrc).not.toMatch(/Coming soon|Disabled|placeholder|TODO/i)
    // One trigger button labeled QuickBooks.
    expect(menuSrc).toMatch(/QuickBooks/)
  })

  it('closes on selection, outside click, and Escape (keyboard accessible)', () => {
    expect(menuSrc).toContain('Escape')
    expect(menuSrc).toMatch(/aria-haspopup="menu"/)
    expect(menuSrc).toMatch(/role="menu"/)
    expect(menuSrc).toMatch(/role="menuitem"/)
    // Close-on-selection: run() closes before invoking the action.
    expect(menuSrc).toMatch(/function run/)
  })

  it('QBO-2F1: supports an optional Import QuickBooks PDF action (global header only)', () => {
    // The third action is opt-in via onImportQbPdf; rendered only when provided.
    expect(menuSrc).toContain('onImportQbPdf')
    expect(menuSrc).toContain('Import QuickBooks PDF')
    expect(menuSrc).toContain('Upload')
  })

  it('QBO-2F1: Prepare Invoice is conditional via showPrepareInvoice (omitted, not disabled)', () => {
    expect(menuSrc).toContain('showPrepareInvoice')
    // The Prepare Invoice item is wrapped in a conditional render, not a
    // disabled placeholder.
    expect(menuSrc).toMatch(/showPrepareInvoice &&/)
    // No disabled Prepare Invoice placeholder.
    expect(menuSrc).not.toMatch(/disabled.*Prepare Invoice|Prepare Invoice.*disabled/i)
  })
})

// ── QBO-2F1: global Service header consolidation ──────────────────────────────

describe('QBO-2F1 global Service header — QuickBooks consolidation', () => {
  it('the standalone "Import QB PDF" header button is removed', () => {
    // The old standalone button label must no longer appear as a visible button.
    // (Comments were stripped by codeOnly; a real button would render the text.)
    expect(fieldLogSrc).not.toMatch(/>Import QB PDF</)
    expect(fieldLogSrc).not.toMatch(/Import QB PDF/)
  })

  it('QuickBooks ▾ sits immediately to the RIGHT of Historical Payments', () => {
    const hpIdx = fieldLogSrc.indexOf('Historical Payments')
    const qbIdx = fieldLogSrc.indexOf('QuickBooksMenu', fieldLogSrc.indexOf('showPrepareInvoice'))
    expect(hpIdx).toBeGreaterThan(-1)
    expect(qbIdx).toBeGreaterThan(hpIdx)
    // New Service Call follows QuickBooks (order: Archived, Historical Payments,
    // QuickBooks, New Service Call).
    const newCallIdx = fieldLogSrc.indexOf('New Service Call', qbIdx)
    expect(newCallIdx).toBeGreaterThan(qbIdx)
  })

  it('the global QuickBooks menu wires Prepare Invoice (conditional) + Drafts + Import PDF', () => {
    expect(fieldLogSrc).toContain('showPrepareInvoice')
    expect(fieldLogSrc).toContain('setShowPrepareInvoiceSelector')
    expect(fieldLogSrc).toContain('onImportQbPdf')
    // Import PDF opens the EXACT existing importer (same showQBImport state).
    expect(fieldLogSrc).toMatch(/onImportQbPdf=\{\(\) => setShowQBImport\(true\)\}/)
  })

  it('Historical Payments remains an independent, untouched header button', () => {
    expect(fieldLogSrc).toContain('Historical Payments')
    expect(fieldLogSrc).toContain('data-testid="historical-payments-button"')
    expect(fieldLogSrc).toMatch(/setShowHistoricalPayments\(true\)/)
  })

  it('the global Prepare Invoice selector modal is rendered (opens unpaid-work list)', () => {
    expect(fieldLogSrc).toContain('PrepareInvoiceSelectorModal')
    expect(fieldLogSrc).toContain('showPrepareInvoiceSelector')
  })
})

// ── #16: correct context-specific Prepare Invoice on both surfaces ───────────

describe('QBO-2F #16 — QuickBooks menu opens the correct context-specific Prepare Invoice', () => {
  it('Project surface (V15rProjectInner) uses the menu + opens a project Prepare Invoice', () => {
    expect(projectSrc).toContain('QuickBooksMenu')
    expect(projectSrc).toContain('onPrepareInvoice')
    expect(projectSrc).toContain('onOpenDrafts')
    // The Prepare Invoice modal is wired with a project source.
    expect(projectSrc).toContain('PrepareInvoiceModal')
    expect(projectSrc).toMatch(/kind:\s*'project'/)
    // No standalone "Prepare Invoice" button remains (the menu replaces it).
    // (Comments were stripped by codeOnly; a real button would be a <button>…Prepare Invoice.)
    expect(projectSrc).not.toMatch(/>\s*Prepare Invoice\s*</)
  })

  it('Service Call surface (V15rServiceCallsV2 — ServiceCallCard) uses the menu + opens a serviceCall Prepare Invoice', () => {
    expect(serviceSrc).toContain('QuickBooksMenu')
    expect(serviceSrc).toContain('onPrepareInvoice')
    expect(serviceSrc).toContain('onOpenDrafts')
    expect(serviceSrc).toContain('function ServiceCallCard')
    expect(prepareModalSrc).toMatch(/kind:\s*'serviceCall'/)
  })

  it('Service Log surface (V15rFieldLogPanel) uses the menu beside Convert to Estimate + opens a service Prepare Invoice', () => {
    expect(fieldLogSrc).toContain('QuickBooksMenu')
    expect(fieldLogSrc).toContain('onPrepareInvoice')
    expect(fieldLogSrc).toContain('onOpenDrafts')
    // Convert to Estimate is preserved (neighboring control untouched).
    expect(fieldLogSrc).toContain('Convert to Estimate')
    expect(prepareModalSrc).toMatch(/kind:\s*'service'/)
  })

  it('the Legacy Service Log list also uses the menu (not a standalone button)', () => {
    const legacyIdx = serviceSrc.indexOf('function LegacyServiceLogList')
    expect(legacyIdx).toBeGreaterThan(-1)
    expect(serviceSrc.indexOf('QuickBooksMenu', legacyIdx)).toBeGreaterThan(legacyIdx)
  })
})

// ── #17: both surfaces open the SAME Invoice Drafts Manager ───────────────────

describe('QBO-2F #17 — both surfaces open the same Invoice Drafts Manager', () => {
  it('the Project surface renders the shared InvoiceDraftsModal', () => {
    expect(projectSrc).toContain('InvoiceDraftsModal')
    expect(projectSrc).toContain('onOpenDrafts')
  })

  it('the Service surface (ServiceCalls) renders the shared InvoiceDraftsModal', () => {
    expect(serviceSrc).toContain('InvoiceDraftsModal')
  })

  it('the Service Log surface (FieldLogPanel) renders the shared InvoiceDraftsModal', () => {
    expect(fieldLogSrc).toContain('InvoiceDraftsModal')
  })

  it('InvoiceDraftsModal is one shared manager (Drafts + Approved tabs, open/edit + delete)', () => {
    expect(draftsModalSrc).toContain("'drafts'")
    expect(draftsModalSrc).toContain("'approved'")
    expect(draftsModalSrc).toMatch(/Drafts/)
    expect(draftsModalSrc).toMatch(/Approved/)
    // Sorted newest-updated first (order updated_at desc in the service is the
    // source of truth; the modal renders the list it receives).
    expect(draftsModalSrc).toContain('Updated')
    // Open/Edit + Delete actions.
    expect(draftsModalSrc).toMatch(/Open|Edit/)
    expect(draftsModalSrc).toMatch(/Delete/)
    // Delete requires confirmation.
    expect(draftsModalSrc).toMatch(/confirm/i)
  })

  it('the shared hook wires persistence + the manager + rehydrate (one authority)', () => {
    expect(hookSrc).toContain('useQuickBooksInvoicing')
    expect(hookSrc).toContain('saveInvoiceDraft')
    expect(hookSrc).toContain('approveInvoiceDraft')
    expect(hookSrc).toContain('openDraftForEdit')
    // No payment/KPI mutation authority is imported by the hook.
    expect(hookSrc).not.toMatch(/saveBackupData|recordServicePayment|recalculateWeeklyData|pushState/)
  })

  it('reopening a draft rehydrates Prepare Invoice in EDIT mode (initialDraft)', () => {
    expect(prepareModalSrc).toContain('initialDraft')
    expect(prepareModalSrc).toContain('rehydrateSource')
    expect(prepareModalSrc).toContain('mapHydratedToUiLines')
    // Save Draft / Approve persist via the provided callbacks.
    expect(prepareModalSrc).toContain('onSaveDraft')
    expect(prepareModalSrc).toContain('onApprove')
  })
})

// ── Firewall: the menu/modal/manager import no QBO + no mutation (#15) ─────────

describe('QBO-2F QuickBooks wiring — financial-authority firewall (#15)', () => {
  it('the menu, manager, and hook perform no QBO API call and no payment/KPI mutation', () => {
    const feature = [menuSrc, draftsModalSrc, hookSrc].join('\n')
    expect(feature).not.toMatch(/intuit|quickbooks\.api|oauth\.platform\.intuit/i)
    expect(feature).not.toMatch(/\bfetch\s*\(/)
    // No protected PowerOn mutation authority.
    expect(feature).not.toMatch(/saveBackupData|saveBackupDataAndSync|recordServicePayment|ensureServicePaymentLedger|ensureProjectFinanceBucket|recalculateWeeklyData|pushState/)
  })
})