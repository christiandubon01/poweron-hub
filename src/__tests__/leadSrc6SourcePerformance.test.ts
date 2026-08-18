/**
 * LEAD-SRC-6A — Source Performance dashboard proofs.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ConversionReceipt } from '@/features/sales-intelligence/conversion-receipts/conversionReceiptTypes'
import {
  computeSourcePerformance,
  formatConversionRate,
  formatConvertedValue,
} from '@/features/sales-intelligence/source-performance/sourcePerformanceCalculations'
import { familyFromToken } from '@/features/sales-intelligence/conversion-receipts/conversionReceiptSource'

const REPO_ROOT = resolve(__dirname, '..', '..')

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

function lead(partial: Record<string, any>) {
  return {
    id: partial.id,
    source: partial.source ?? 'customer_portal',
    source_tag: partial.source_tag,
    source_city: partial.source_city,
    estimated_value: partial.estimated_value ?? null,
    status: partial.status ?? 'new',
    ...partial,
  }
}

function receipt(partial: Partial<ConversionReceipt> & { id: string }): ConversionReceipt {
  return {
    receiptNumber: partial.receiptNumber ?? `CR-${partial.id}`,
    tenantId: partial.tenantId ?? 'tenant-1',
    leadId: partial.leadId ?? null,
    leadName: partial.leadName ?? 'Lead',
    leadCompany: partial.leadCompany ?? null,
    leadContactName: partial.leadContactName ?? null,
    sourceFamily: partial.sourceFamily ?? 'Customer Portal',
    sourceDetail: partial.sourceDetail ?? null,
    sourceRaw: partial.sourceRaw ?? null,
    destinationType: partial.destinationType ?? 'project',
    destinationId: partial.destinationId ?? `dest-${partial.id}`,
    destinationLabel: partial.destinationLabel ?? null,
    leadEstimatedValue: partial.leadEstimatedValue ?? null,
    convertedValue: partial.convertedValue ?? null,
    leadScoreAtConversion: partial.leadScoreAtConversion ?? null,
    leadStatusBefore: partial.leadStatusBefore ?? null,
    convertedAt: partial.convertedAt ?? '2026-01-01T00:00:00Z',
    convertedBy: partial.convertedBy ?? null,
    convertedByName: partial.convertedByName ?? null,
    createdAt: partial.createdAt ?? '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('LEAD-SRC-6A Source Performance calculations', () => {
  it('one source / one lead / no receipt → 1 / 0 / 0% / $0', () => {
    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: 'customer_portal' })],
      receipts: [],
    })
    expect(report.timeHorizon).toBe('all_time')
    expect(report.totals).toMatchObject({ leads: 1, converted: 0, conversionRate: 0, convertedValue: 0 })
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0].label).toBe('Customer Portal')
    expect(report.rows[0]).toMatchObject({ leads: 1, converted: 0, conversionRate: 0, convertedValue: 0 })
  })

  it('one converted lead / $5000 receipt → 1 / 1 / 100% / $5000', () => {
    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: 'customer_portal', estimated_value: 8000 })],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'Customer Portal',
          convertedValue: 5000,
          leadEstimatedValue: 8000,
        }),
      ],
    })
    expect(report.totals).toMatchObject({
      leads: 1,
      converted: 1,
      conversionRate: 1,
      convertedValue: 5000,
    })
    expect(report.rows[0].convertedValue).toBe(5000)
  })

  it('two leads / one conversion → 50%', () => {
    const report = computeSourcePerformance({
      leads: [
        lead({ id: 'l1', source: 'tlma_riverside', source_city: 'Indio' }),
        lead({ id: 'l2', source: 'tlma_riverside', source_city: 'Indio' }),
      ],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'TLMA',
          sourceDetail: 'Indio',
          convertedValue: 1000,
        }),
      ],
    })
    expect(report.rows[0].leads).toBe(2)
    expect(report.rows[0].converted).toBe(1)
    expect(report.rows[0].conversionRate).toBe(0.5)
    expect(formatConversionRate(report.rows[0].conversionRate)).toBe('50.0%')
  })

  it('null converted_value still counts conversion, value $0', () => {
    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: 'customer_portal' })],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'Customer Portal',
          convertedValue: null,
          destinationType: 'service_call',
        }),
      ],
    })
    expect(report.totals.converted).toBe(1)
    expect(report.totals.convertedValue).toBe(0)
    expect(report.rows[0].converted).toBe(1)
    expect(report.rows[0].convertedValue).toBe(0)
  })

  it('lead_estimated_value never feeds Converted Value', () => {
    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: 'customer_portal', estimated_value: 99999 })],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'Customer Portal',
          convertedValue: null,
          leadEstimatedValue: 99999,
        }),
      ],
    })
    expect(report.totals.convertedValue).toBe(0)
  })

  it('multiple sources remain separated', () => {
    const report = computeSourcePerformance({
      leads: [
        lead({ id: 'l1', source: 'customer_portal' }),
        lead({ id: 'l2', source: 'tlma_riverside', source_city: 'Indio' }),
      ],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'Customer Portal',
          convertedValue: 2000,
        }),
        receipt({
          id: 'r2',
          leadId: 'l2',
          sourceFamily: 'TLMA',
          sourceDetail: 'Indio',
          convertedValue: 8000,
        }),
      ],
    })
    expect(report.rows).toHaveLength(2)
    expect(report.rows[0].label).toBe('TLMA / Indio') // higher value first
    expect(report.rows[0].convertedValue).toBe(8000)
    expect(report.rows[1].label).toBe('Customer Portal')
    expect(report.rows[1].convertedValue).toBe(2000)
  })

  it('normalized portal attribution tokens get human labels', () => {
    expect(familyFromToken('paid_search')).toBe('Paid Search')
    expect(familyFromToken('ai_assistant')).toBe('AI Assistant')
    expect(familyFromToken('gbp')).toBe('Google Business Profile')
    expect(familyFromToken('organic_search')).toBe('Organic Search')
    expect(familyFromToken('direct')).toBe('Direct')
    expect(familyFromToken('other')).toBe('Other')

    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: 'paid_search' })],
      receipts: [],
    })
    expect(report.rows[0].label).toBe('Paid Search')
  })

  it('unknown source falls back to Other', () => {
    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: '', source_tag: '' })],
      receipts: [],
    })
    expect(report.rows[0].label).toBe('Other')
  })

  it('distinct lead IDs prevent duplicate lead counting', () => {
    const report = computeSourcePerformance({
      leads: [
        lead({ id: 'l1', source: 'customer_portal' }),
        lead({ id: 'l1', source: 'customer_portal' }),
      ],
      receipts: [],
    })
    expect(report.totals.leads).toBe(1)
    expect(report.rows[0].leads).toBe(1)
  })

  it('distinct converted lead count prevents duplicate receipt inflation', () => {
    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: 'customer_portal' })],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'Customer Portal',
          destinationType: 'project',
          destinationId: 'proj-1',
          convertedValue: 5000,
        }),
        receipt({
          id: 'r2',
          leadId: 'l1',
          sourceFamily: 'Customer Portal',
          destinationType: 'service_call',
          destinationId: 'est-1',
          convertedValue: 1200,
        }),
      ],
    })
    // One lead, two legitimate destinations → 1 converted, value sums both.
    expect(report.totals.converted).toBe(1)
    expect(report.totals.convertedValue).toBe(6200)
    expect(report.rows[0].converted).toBe(1)
    expect(report.rows[0].receiptCount).toBe(2)
  })

  it('receipt source snapshot remains historical authority (not live lead edit)', () => {
    const report = computeSourcePerformance({
      leads: [lead({ id: 'l1', source: 'tlma_riverside', source_city: 'Indio' })],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'Customer Portal', // snapshotted at conversion; lead later edited
          convertedValue: 4000,
        }),
      ],
    })
    const portal = report.rows.find((r) => r.label === 'Customer Portal')!
    const tlma = report.rows.find((r) => r.label === 'TLMA / Indio')!
    expect(portal.converted).toBe(1)
    expect(portal.convertedValue).toBe(4000)
    expect(portal.leads).toBe(0)
    expect(tlma.leads).toBe(1)
    expect(tlma.converted).toBe(0)
  })

  it('Project and Service receipt converted_value both included', () => {
    const report = computeSourcePerformance({
      leads: [
        lead({ id: 'l1', source: 'customer_portal' }),
        lead({ id: 'l2', source: 'customer_portal' }),
      ],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'l1',
          sourceFamily: 'Customer Portal',
          destinationType: 'project',
          convertedValue: 12500,
        }),
        receipt({
          id: 'r2',
          leadId: 'l2',
          sourceFamily: 'Customer Portal',
          destinationType: 'service_call',
          convertedValue: 780,
        }),
      ],
    })
    expect(report.totals.convertedValue).toBe(13280)
  })

  it('All Sources totals use underlying distinct counts, not summed percentages', () => {
    const report = computeSourcePerformance({
      leads: [
        lead({ id: 'a', source: 'customer_portal' }),
        lead({ id: 'b', source: 'customer_portal' }),
        lead({ id: 'c', source: 'yelp_ad' }),
      ],
      receipts: [
        receipt({ id: 'r1', leadId: 'a', sourceFamily: 'Customer Portal', convertedValue: 100 }),
        receipt({ id: 'r2', leadId: 'c', sourceFamily: 'Yelp Ad', convertedValue: 200 }),
      ],
    })
    expect(report.totals.leads).toBe(3)
    expect(report.totals.converted).toBe(2)
    expect(report.totals.conversionRate).toBeCloseTo(2 / 3)
    expect(report.totals.convertedValue).toBe(300)
  })

  it('zero leads gives 0%, not NaN', () => {
    const report = computeSourcePerformance({ leads: [], receipts: [] })
    expect(report.totals.conversionRate).toBe(0)
    expect(formatConversionRate(report.totals.conversionRate)).toBe('0.0%')
    expect(Number.isNaN(report.totals.conversionRate)).toBe(false)
  })

  it('sorting is deterministic: value desc, then leads, then label', () => {
    const report = computeSourcePerformance({
      leads: [
        lead({ id: '1', source: 'yelp_ad' }),
        lead({ id: '2', source: 'facebook' }),
        lead({ id: '3', source: 'facebook' }),
      ],
      receipts: [
        receipt({ id: 'r1', leadId: '1', sourceFamily: 'Yelp Ad', convertedValue: 100 }),
        receipt({ id: 'r2', leadId: '2', sourceFamily: 'Facebook', convertedValue: 100 }),
      ],
    })
    // Same value: Facebook has more leads → first
    expect(report.rows.map((r) => r.label)).toEqual(['Facebook', 'Yelp Ad'])
  })

  it('formatConvertedValue is stable', () => {
    expect(formatConvertedValue(84500)).toBe('$84,500')
    expect(formatConvertedValue(Number.NaN)).toBe('$0')
  })
})

describe('LEAD-SRC-6A Source Performance boundaries', () => {
  it('[STATIC] Coach tab hosts Source Performance', () => {
    const coach = readRepoFile('src/components/salesIntel/tabs/CoachTab.tsx')
    expect(coach).toContain('SourcePerformancePanel')
    expect(coach).toContain('source-performance')
  })

  it('[STATIC] no KPI / QuickBooks / referral / serviceQuoteMath / project.contract writers', () => {
    const files = [
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts',
      'src/features/sales-intelligence/source-performance/SourcePerformancePanel.tsx',
      'src/features/sales-intelligence/source-performance/index.ts',
      'src/components/salesIntel/tabs/CoachTab.tsx',
    ]
    for (const file of files) {
      const text = readRepoFile(file)
      expect(text).not.toContain('quickbooks')
      expect(text).not.toContain('ReferralsTab')
      expect(text).not.toContain('serviceQuoteMath')
      expect(text).not.toContain('HunterSourceAnalytics')
      expect(text).not.toContain('getProjectFinancials')
      expect(text).not.toContain('MoneyPanel')
      expect(text).not.toMatch(/project\.contract\s*=/)
    }
  })

  it('[STATIC] calculations consume receipt convertedValue and deriveConversionSource only', () => {
    const calc = readRepoFile(
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts'
    )
    expect(calc).toContain('deriveConversionSource')
    expect(calc).toContain('convertedValue')
    expect(calc).not.toContain('leadEstimatedValue')
    expect(calc).not.toContain('lead_estimated_value')
    expect(calc).not.toContain('getBackupData')
    expect(calc).not.toContain('serviceEstimates')
    expect(calc).not.toContain('serviceLogs')
  })

  it('[PURE] manual Service Call / ordinary Project never enter via backup exclusion', () => {
    // Dashboard inputs are hunter_leads + receipts only — no backup scan exists.
    const report = computeSourcePerformance({
      leads: [],
      receipts: [],
    })
    expect(report.rows).toEqual([])
    expect(report.totals.leads).toBe(0)
    // Prove calc file does not import backup / lineage collectors.
    const calc = readRepoFile(
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts'
    )
    expect(calc).not.toContain('collectProvenLineage')
    expect(calc).not.toContain('convertedFromLeadId')
    expect(calc).not.toContain('hunterLeadId')
  })

  it('[STATIC] no migration added for LEAD-SRC-6', () => {
    const calc = readRepoFile(
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts'
    )
    const panel = readRepoFile(
      'src/features/sales-intelligence/source-performance/SourcePerformancePanel.tsx'
    )
    expect(calc + panel).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
  })
})
