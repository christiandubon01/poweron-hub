import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * FORENSIC-KPI-2B2-2D: source-contract test for the Edit Service Call
 * Payment History + legacy-date resolution UI in V15rFieldLogPanel.
 */
const ROOT = process.cwd()
const fieldLogSrc = readFileSync(join(ROOT, 'src/components/v15r/V15rFieldLogPanel.tsx'), 'utf8')

describe('FORENSIC-KPI-2B2-2D Payment History UI contract', () => {
  it('imports the pure legacy-resolve helper from the canonical ledger module', () => {
    expect(fieldLogSrc).toContain('getServiceLegacyUnknownCash')
    expect(fieldLogSrc).toContain('resolveServiceLegacyPayments')
    expect(fieldLogSrc).toContain("from '@/features/service-quote/servicePaymentLedger'")
  })

  it('renders a read-only Payment History section inside the Edit Service Call modal', () => {
    expect(fieldLogSrc).toContain('Payment History')
    expect(fieldLogSrc).toContain('Payment date unknown')
  })

  it('offers a Resolve Payment Date(s) action for undated historical cash', () => {
    expect(fieldLogSrc).toContain('Resolve Payment Date')
    expect(fieldLogSrc).toContain('beginLegacyResolve')
    expect(fieldLogSrc).toContain('legacyResolveRows')
  })

  it('validates that resolve rows sum to the unknown amount before saving', () => {
    expect(fieldLogSrc).toContain('legacyResolveValidation')
    expect(fieldLogSrc).toContain('must equal')
    expect(fieldLogSrc).toContain('Save resolved dates')
  })

  it('persists through the scoped serviceLogs path and never touches backupDataService backfill', () => {
    // The single legacy-date write path delegates money arithmetic to the helper,
    // then persists via the same scoped save as every other service payment.
    expect(fieldLogSrc).toContain('function commitResolveLegacyPayments')
    expect(fieldLogSrc).toContain('resolveServiceLegacyPayments(target, entries)')
    expect(fieldLogSrc).toContain('persistServiceLogs()')
    // Protected: the legacy resolver must not rewrite the Project paid-scalar backfill.
    expect(fieldLogSrc).not.toContain('log-paidbackfill-')
  })
})