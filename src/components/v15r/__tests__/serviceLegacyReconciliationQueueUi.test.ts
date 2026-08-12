import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * FORENSIC-KPI-2B2-2G: source-contract + regression tests for the Historical
 * Service Payment Reconciliation work queue UI.
 *
 * These tests read the panel + helper module as TEXT (the established source-
 * contract pattern) so we never have to mount the ~6000-line V15rFieldLogPanel.
 * They pin: the queue entry point, that it routes into the EXISTING resolver
 * (no second resolver), the Demo Mode gate, the 52-week note, and that the new
 * queue helper does not reach into the protected financial readers.
 */

const ROOT = process.cwd()
const panelSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rFieldLogPanel.tsx'), 'utf8')
const queueSrc = readFileSync(join(ROOT, 'src/features/service-quote/serviceLegacyReconciliationQueue.ts'), 'utf8')

describe('FORENSIC-KPI-2B2-2G Q11 — queue entry point in the Service Logs toolbar', () => {
  it('renders a Historical Payments button that opens the queue', () => {
    expect(panelSrc).toContain('setShowHistoricalPayments(true)')
    expect(panelSrc).toContain('data-testid="historical-payments-button"')
    expect(panelSrc).toContain('Historical Payments')
  })

  it('surfaces an unresolved-count badge driven by the queue', () => {
    expect(panelSrc).toContain('reconciliationQueue.unresolvedCount > 0')
    expect(panelSrc).toContain('{reconciliationQueue.unresolvedCount}')
  })

  it('builds the queue from serviceLogs via buildServiceLegacyReconciliationQueue', () => {
    expect(panelSrc).toContain('buildServiceLegacyReconciliationQueue(serviceLogs')
    expect(panelSrc).toContain("isActive: isActiveServiceCall")
  })

  it('the queue modal is titled Historical Service Payments and shows the three summary figures', () => {
    expect(panelSrc).toContain('Historical Service Payments')
    expect(panelSrc).toContain('Calls needing dates')
    expect(panelSrc).toContain('Undated collected')
    expect(panelSrc).toContain('With dated payments')
  })

  it('shows dated vs undated dollar progress (Part G) — not yearly reporting', () => {
    expect(panelSrc).toContain('Dated collected:')
    expect(panelSrc).toContain('Still undated:')
    expect(panelSrc).toContain('reconciliationQueue.datedCollected')
    expect(panelSrc).toContain('reconciliationQueue.undatedTotal')
  })
})

describe('FORENSIC-KPI-2B2-2G Q12 — routes into the EXISTING resolver (no second resolver)', () => {
  it('openResolveFromQueue reuses beginSvcEdit + the existing legacy resolve form state', () => {
    expect(panelSrc).toContain('function openResolveFromQueue')
    // The queue opener seeds the existing legacy-resolve rows and opens the existing form.
    expect(panelSrc).toContain('beginSvcEdit(String((log as any).id))')
    expect(panelSrc).toContain('setLegacyResolveRows([{ amount: unknown.amount.toFixed(2), receivedAt: \'\'')
    expect(panelSrc).toContain('setLegacyResolveOpen(true)')
  })

  it('the modal Resolve button calls openResolveFromQueue (no inline resolve)', () => {
    expect(panelSrc).toContain("onClick={() => openResolveFromQueue(entry.log)}")
    expect(panelSrc).toContain('data-testid="historical-payments-resolve"')
  })

  it('the existing writer path is still the only persistence route (commitResolveLegacyPayments + persistServiceLogs)', () => {
    expect(panelSrc).toContain('function commitResolveLegacyPayments')
    expect(panelSrc).toContain('persistServiceLogs()')
    // commitResolveLegacyPayments is the existing 2B2-2D writer — still present and still the writer.
    expect(panelSrc.match(/commitResolveLegacyPayments/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('the queue opener re-derives unknown cash via getServiceLegacyUnknownCash — it does NOT invent a new unknown heuristic', () => {
    expect(panelSrc).toContain('const unknown = getServiceLegacyUnknownCash(log)')
    // Guard: only proceed when there is real resolvable unknown cash and no unexpected null-date event.
    expect(panelSrc).toContain('unknown.amount <= MONEY_EPSILON || unknown.hasUnexpectedNullDateEvent')
  })

  it('warning rows open the existing Edit Service Call modal (no special write path)', () => {
    expect(panelSrc).toContain('function openWarningEditFromQueue')
    expect(panelSrc).toContain('openWarningEditFromQueue(entry.id)')
    // openWarningEditFromQueue only calls beginSvcEdit — it does not write.
    expect(panelSrc).toContain('function openWarningEditFromQueue(logId: string) {\n    if (hasHydrated && isDemoMode) return\n    beginSvcEdit(logId)\n  }')
  })
})

describe('FORENSIC-KPI-2B2-2G Q13 — Demo Mode gate (read-only reconciliation)', () => {
  it('openResolveFromQueue is a no-op in Demo Mode', () => {
    // The demo guard appears inside the queue opener.
    expect(panelSrc).toContain('function openResolveFromQueue(log: any) {\n    // Q14: never mutate from the queue in Demo Mode — reconciliation is read-only there.\n    if (hasHydrated && isDemoMode) return')
  })

  it('openWarningEditFromQueue is a no-op in Demo Mode', () => {
    expect(panelSrc).toContain('function openWarningEditFromQueue(logId: string) {\n    if (hasHydrated && isDemoMode) return')
  })

  it('the queue modal computes demoReadOnly and disables both Resolve and Edit call buttons', () => {
    expect(panelSrc).toContain('const demoReadOnly = hasHydrated && isDemoMode')
    expect(panelSrc).toContain('disabled={demoReadOnly}')
    expect(panelSrc).toContain('Reconciliation is read-only in Demo Mode — Resolve is disabled.')
  })

  it('the queue helper itself is pure (no I/O, no React, no clock) — demo-safe by construction', () => {
    expect(queueSrc).toContain('Pure module: no I/O, no React, no clock.')
    expect(queueSrc).not.toMatch(/\bimport\b[^;]*\bfrom\b[^;]*['"]react['"]/)
    expect(queueSrc).not.toMatch(/localStorage|fetch\(|XMLHttpRequest|new Date\b/)
  })
})

describe('FORENSIC-KPI-2B2-2G Q14 — 52-week note + isolation from protected readers', () => {
  it('tells the owner the 52-week history updates only after recalculation', () => {
    expect(panelSrc).toContain('52-week history updates after recalculation.')
  })

  it('the queue helper imports ONLY servicePaymentLedger + serviceQuoteMath — no protected financial reader', () => {
    // Protected readers it must NOT touch: collectedRevenueRange, weeklyFinancialPolicy, backupDataService.
    expect(queueSrc).not.toContain('collectedRevenueRange')
    expect(queueSrc).not.toContain('weeklyFinancialPolicy')
    expect(queueSrc).not.toContain('backupDataService')
    // It derives membership from getServiceLegacyUnknownCash only.
    expect(queueSrc).toContain('getServiceLegacyUnknownCash')
    expect(queueSrc).toContain('resolveServiceCollected')
    expect(queueSrc).toContain('MONEY_EPSILON')
  })

  it('the queue helper does not independently calculate collected - payments or status === Paid', () => {
    // No hand-rolled "collected - payments" or status string heuristics.
    expect(queueSrc).not.toMatch(/collected\s*-\s*payments/)
    expect(queueSrc).not.toContain("status === 'Paid'")
    expect(queueSrc).not.toContain('status === "Paid"')
  })

  it('regression: the existing legacy-resolve UI entry + Record Service Payment modal are still present', () => {
    expect(panelSrc).toContain('setLegacyResolveOpen')
    expect(panelSrc).toContain('legacyResolveRows')
    expect(panelSrc).toContain('RecordServicePaymentModal')
    // The existing demo guard on the Record Payment path is unchanged.
    expect(panelSrc).toContain('if (hasHydrated && isDemoMode) return')
  })

  it('regression: the queue is additive — it does not alter the existing Archived Service Calls control', () => {
    expect(panelSrc).toContain('Archived Service Calls')
    expect(panelSrc).toContain('setShowArchivedServiceReview')
  })
})