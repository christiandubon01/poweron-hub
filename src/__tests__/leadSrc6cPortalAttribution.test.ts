/**
 * LEAD-SRC-6C / 6E — Portal acquisition through Hunter + Source Performance recovery.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  deriveConversionSource,
  familyFromToken,
  normalizePortalAcquisitionCategory,
  PORTAL_CHANNEL_TAG,
} from '@/features/sales-intelligence/conversion-receipts/conversionReceiptSource'
import {
  applyExactPortalCategoryRecovery,
  computeSourcePerformance,
  resolveSourcePerformanceBucket,
} from '@/features/sales-intelligence/source-performance/sourcePerformanceCalculations'
import type { ConversionReceipt } from '@/features/sales-intelligence/conversion-receipts/conversionReceiptTypes'

const REPO_ROOT = resolve(__dirname, '..', '..')

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

function receipt(partial: Partial<ConversionReceipt> & { id: string }): ConversionReceipt {
  return {
    receiptNumber: `CR-${partial.id}`,
    tenantId: 'tenant-1',
    leadId: partial.leadId ?? null,
    leadName: 'Lead',
    leadCompany: null,
    leadContactName: null,
    sourceFamily: partial.sourceFamily ?? 'Customer Portal',
    sourceDetail: partial.sourceDetail ?? null,
    sourceRaw: null,
    destinationType: partial.destinationType ?? 'project',
    destinationId: partial.destinationId ?? `dest-${partial.id}`,
    destinationLabel: null,
    leadEstimatedValue: partial.leadEstimatedValue ?? null,
    convertedValue: partial.convertedValue ?? null,
    leadScoreAtConversion: null,
    leadStatusBefore: null,
    convertedAt: '2026-01-01T00:00:00Z',
    convertedBy: null,
    convertedByName: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('LEAD-SRC-6C portal acquisition → Hunter source', () => {
  it.each([
    ['paid_search', 'Paid Search'],
    ['organic_search', 'Organic Search'],
    ['ai_assistant', 'AI Assistant'],
    ['gbp', 'Google Business Profile'],
    ['direct', 'Direct'],
    ['referral_site', 'Referral Site'],
    ['social', 'Social'],
  ] as const)('%s resolves to %s with Customer Portal channel detail', (token, label) => {
    const source = deriveConversionSource({
      source: token,
      source_tag: PORTAL_CHANNEL_TAG,
    })
    expect(source.family).toBe(label)
    expect(source.detail).toBe('Customer Portal')
    expect(normalizePortalAcquisitionCategory(token)).toBe(token)
  })

  it('null/invalid category falls back safely', () => {
    expect(normalizePortalAcquisitionCategory(null)).toBeNull()
    expect(normalizePortalAcquisitionCategory('')).toBeNull()
    expect(normalizePortalAcquisitionCategory('not-a-category')).toBeNull()
    expect(
      deriveConversionSource({
        source: PORTAL_CHANNEL_TAG,
        source_tag: PORTAL_CHANNEL_TAG,
      }).family
    ).toBe('Customer Portal')
  })

  it('Customer Portal channel retained without overriding acquisition', () => {
    const source = deriveConversionSource({
      source: 'paid_search',
      source_tag: 'customer_portal',
    })
    expect(source.family).toBe('Paid Search')
    expect(source.detail).toBe('Customer Portal')
    expect(source.raw).toContain('paid_search')
    expect(source.raw).toContain('customer_portal')
  })

  it('[STATIC] convertToLead writes acquisition on source and channel on source_tag', () => {
    const src = readRepoFile('src/services/portal/portalService.ts')
    expect(src).toContain('normalizePortalAcquisitionCategory')
    expect(src).toContain('PORTAL_CHANNEL_TAG')
    expect(src).toContain('source:           acquisition')
    expect(src).toContain('source_tag:       PORTAL_CHANNEL_TAG')
    expect(src).not.toMatch(/source:\s*'customer_portal',\s*\n\s*source_tag:\s*'customer_portal'/)
  })
})

describe('LEAD-SRC-6C future receipts + Source Performance', () => {
  it('future receipt source from paid_search portal lead is Paid Search (via deriveConversionSource)', () => {
    const source = deriveConversionSource({
      id: 'lead-1',
      source: 'paid_search',
      source_tag: 'customer_portal',
      estimated_value: 8000,
    })
    expect(source.family).toBe('Paid Search')
    expect(source.detail).toBe('Customer Portal')
  })

  it('future receipt source from organic portal lead is Organic Search', () => {
    const source = deriveConversionSource({
      id: 'lead-2',
      source: 'organic_search',
      source_tag: 'customer_portal',
    })
    expect(source.family).toBe('Organic Search')
    expect(source.detail).toBe('Customer Portal')
  })

  it('[STATIC] buildReceiptDraft still snapshots via deriveConversionSource', () => {
    const service = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptService.ts'
    )
    expect(service).toContain('deriveConversionSource(lead)')
    expect(service).toContain('source: deriveConversionSource(lead)')
  })

  it('Source Performance separates Paid Search and Organic Search; no double Customer Portal count', () => {
    const report = computeSourcePerformance({
      leads: [
        { id: 'a', source: 'paid_search', source_tag: 'customer_portal' },
        { id: 'b', source: 'organic_search', source_tag: 'customer_portal' },
      ],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'a',
          sourceFamily: 'Paid Search',
          sourceDetail: 'Customer Portal',
          convertedValue: 5000,
        }),
        receipt({
          id: 'r2',
          leadId: 'b',
          sourceFamily: 'Organic Search',
          sourceDetail: 'Customer Portal',
          convertedValue: 3000,
        }),
      ],
    })
    expect(report.rows.map((r) => r.family).sort()).toEqual(['Organic Search', 'Paid Search'])
    expect(report.rows.every((r) => r.family !== 'Customer Portal')).toBe(true)
    expect(report.totals.leads).toBe(2)
    expect(report.rows.reduce((s, r) => s + r.leads, 0)).toBe(2)
  })

  it('historical recovery does not use name/email/phone and skips non-legacy leads', () => {
    const src = readRepoFile(
      'src/features/sales-intelligence/source-performance/sourcePerformancePortalRecovery.ts'
    )
    expect(src).toContain("select('hunter_lead_id, source_category')")
    expect(src).not.toContain('.eq(')
    expect(src).not.toContain('ilike')
    expect(src).not.toMatch(/select\([^)]*email/)
    expect(src).not.toMatch(/select\([^)]*phone/)

    const untouched = applyExactPortalCategoryRecovery(
      { id: 'x', source: 'tlma_riverside', source_tag: 'tlma_browser_import', source_city: 'Indio' },
      'paid_search'
    )
    expect(untouched.source).toBe('tlma_riverside')
  })

  it('non-portal Hunter source behavior unchanged', () => {
    const tlma = deriveConversionSource({
      source: 'tlma_riverside',
      source_tag: 'permit_B',
      source_city: 'Indio',
    })
    expect(tlma.family).toBe('TLMA')
    expect(tlma.detail).toBe('Indio')
    expect(familyFromToken('yelp_ad')).toBe('Yelp Ad')
  })
})

describe('LEAD-SRC-6E historical portal bucket consistency', () => {
  it('exact bug: legacy paid_search lineage keeps lead+converted+value on Paid Search', () => {
    const recovered = applyExactPortalCategoryRecovery(
      { id: 'lead-1', source: 'customer_portal', source_tag: 'customer_portal' },
      'paid_search'
    )
    expect(recovered.source).toBe('paid_search')
    expect(recovered.source_tag).toBe('customer_portal')

    const report = computeSourcePerformance({
      leads: [{ id: 'lead-1', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [
        receipt({
          id: 'r-old',
          leadId: 'lead-1',
          sourceFamily: 'Customer Portal',
          convertedValue: 4000,
        }),
      ],
      portalCategoryByLeadId: new Map([['lead-1', 'paid_search']]),
    })

    const paid = report.rows.find((r) => r.family === 'Paid Search')!
    expect(paid).toMatchObject({
      leads: 1,
      converted: 1,
      conversionRate: 1,
      convertedValue: 4000,
    })
    expect(report.rows.find((r) => r.family === 'Customer Portal')).toBeUndefined()
  })

  it('historical organic_search lead + receipt → both Organic Search', () => {
    const report = computeSourcePerformance({
      leads: [{ id: 'o1', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [
        receipt({
          id: 'r-o',
          leadId: 'o1',
          sourceFamily: 'Customer Portal',
          convertedValue: 2500,
        }),
      ],
      portalCategoryByLeadId: new Map([['o1', 'organic_search']]),
    })
    const organic = report.rows.find((r) => r.family === 'Organic Search')!
    expect(organic).toMatchObject({ leads: 1, converted: 1, convertedValue: 2500 })
    expect(report.rows.find((r) => r.family === 'Customer Portal')).toBeUndefined()
  })

  it('historical ai_assistant lead + receipt → both AI Assistant', () => {
    const report = computeSourcePerformance({
      leads: [{ id: 'a1', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [
        receipt({
          id: 'r-a',
          leadId: 'a1',
          sourceFamily: 'Customer Portal',
          convertedValue: 1800,
        }),
      ],
      portalCategoryByLeadId: new Map([['a1', 'ai_assistant']]),
    })
    const ai = report.rows.find((r) => r.family === 'AI Assistant')!
    expect(ai).toMatchObject({ leads: 1, converted: 1, convertedValue: 1800 })
    expect(report.rows.find((r) => r.family === 'Customer Portal')).toBeUndefined()
  })

  it('missing portal lineage → stored receipt source remains authoritative', () => {
    const report = computeSourcePerformance({
      leads: [{ id: 'm1', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [
        receipt({
          id: 'r-m',
          leadId: 'm1',
          sourceFamily: 'Customer Portal',
          convertedValue: 900,
        }),
      ],
      portalCategoryByLeadId: new Map(),
    })
    const portal = report.rows.find((r) => r.family === 'Customer Portal')!
    expect(portal).toMatchObject({ leads: 1, converted: 1, convertedValue: 900 })
    expect(report.rows.find((r) => r.family === 'Paid Search')).toBeUndefined()
  })

  it('invalid/null source_category → safe fallback to stored sources', () => {
    const report = computeSourcePerformance({
      leads: [{ id: 'inv', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [
        receipt({
          id: 'r-inv',
          leadId: 'inv',
          sourceFamily: 'Customer Portal',
          convertedValue: 700,
        }),
      ],
      portalCategoryByLeadId: new Map([['inv', 'not-a-category']]),
    })
    expect(normalizePortalAcquisitionCategory('not-a-category')).toBeNull()
    const portal = report.rows.find((r) => r.family === 'Customer Portal')!
    expect(portal).toMatchObject({ leads: 1, converted: 1, convertedValue: 700 })
  })

  it('already-modern paid_search lead + Paid Search receipt remains unchanged', () => {
    const modern = { id: 'mod', source: 'paid_search', source_tag: 'customer_portal' }
    expect(applyExactPortalCategoryRecovery(modern, 'organic_search').source).toBe('paid_search')

    const report = computeSourcePerformance({
      leads: [modern],
      receipts: [
        receipt({
          id: 'r-mod',
          leadId: 'mod',
          sourceFamily: 'Paid Search',
          sourceDetail: 'Customer Portal',
          convertedValue: 5500,
        }),
      ],
      // Even if map has a different category, modern leads are not re-keyed
      portalCategoryByLeadId: new Map([['mod', 'organic_search']]),
    })
    const paid = report.rows.find((r) => r.family === 'Paid Search')!
    expect(paid).toMatchObject({ leads: 1, converted: 1, convertedValue: 5500 })
    expect(report.rows.find((r) => r.family === 'Organic Search')).toBeUndefined()
  })

  it('legacy lead is not counted twice across Customer Portal and Paid Search', () => {
    const report = computeSourcePerformance({
      leads: [{ id: 'd1', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [
        receipt({
          id: 'r-d',
          leadId: 'd1',
          sourceFamily: 'Customer Portal',
          convertedValue: 1000,
        }),
      ],
      portalCategoryByLeadId: new Map([['d1', 'paid_search']]),
    })
    expect(report.rows.reduce((s, r) => s + r.leads, 0)).toBe(1)
    expect(report.rows.reduce((s, r) => s + r.converted, 0)).toBe(1)
    expect(report.totals.leads).toBe(1)
    expect(report.totals.converted).toBe(1)
  })

  it('multiple receipts for same recovered lead: Converted=1, Value=sum', () => {
    const report = computeSourcePerformance({
      leads: [{ id: 'multi', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [
        receipt({
          id: 'r1',
          leadId: 'multi',
          sourceFamily: 'Customer Portal',
          destinationType: 'project',
          destinationId: 'proj-1',
          convertedValue: 3000,
        }),
        receipt({
          id: 'r2',
          leadId: 'multi',
          sourceFamily: 'Customer Portal',
          destinationType: 'service_call',
          destinationId: 'svc-1',
          convertedValue: 1500,
        }),
      ],
      portalCategoryByLeadId: new Map([['multi', 'paid_search']]),
    })
    const paid = report.rows.find((r) => r.family === 'Paid Search')!
    expect(paid).toMatchObject({ leads: 1, converted: 1, convertedValue: 4500, receiptCount: 2 })
    expect(report.rows.find((r) => r.family === 'Customer Portal')).toBeUndefined()
  })

  it('receipt DB objects are not mutated during aggregation', () => {
    const snap = receipt({
      id: 'r-immut',
      leadId: 'im1',
      sourceFamily: 'Customer Portal',
      sourceDetail: null,
      convertedValue: 4000,
    })
    const before = structuredClone(snap)
    computeSourcePerformance({
      leads: [{ id: 'im1', source: 'customer_portal', source_tag: 'customer_portal' }],
      receipts: [snap],
      portalCategoryByLeadId: new Map([['im1', 'paid_search']]),
    })
    expect(snap).toEqual(before)
    expect(snap.sourceFamily).toBe('Customer Portal')
  })

  it('unified bucket helper recovers lead and receipt to the same key', () => {
    const lead = { id: 'u1', source: 'customer_portal', source_tag: 'customer_portal' }
    const leadBucket = resolveSourcePerformanceBucket({
      lead,
      portalCategory: 'paid_search',
    })
    const receiptBucket = resolveSourcePerformanceBucket({
      lead,
      portalCategory: 'paid_search',
      receiptSnapshot: { family: 'Customer Portal', detail: null },
    })
    expect(leadBucket).toEqual(receiptBucket)
    expect(leadBucket.family).toBe('Paid Search')
    expect(leadBucket.detail).toBe('Customer Portal')
  })

  it('[STATIC] Conversion Receipt UI/source snapshot behavior unchanged', () => {
    const service = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptService.ts'
    )
    const calc = readRepoFile(
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts'
    )
    expect(service).toContain('source: deriveConversionSource(lead)')
    expect(service).toContain('source_family: draft.source.family')
    expect(calc).not.toMatch(/\.update\(/)
    expect(calc).not.toMatch(/source_family\s*=/)
    expect(calc).not.toMatch(/from\(['\"]hunter_conversion_receipts/)
  })

  it('non-portal sources ignore portal recovery map', () => {
    const report = computeSourcePerformance({
      leads: [
        {
          id: 'tlma',
          source: 'tlma_riverside',
          source_tag: 'permit_B',
          source_city: 'Indio',
        },
      ],
      receipts: [
        receipt({
          id: 'r-tlma',
          leadId: 'tlma',
          sourceFamily: 'TLMA',
          sourceDetail: 'Indio',
          convertedValue: 2200,
        }),
      ],
      portalCategoryByLeadId: new Map([['tlma', 'paid_search']]),
    })
    const tlma = report.rows.find((r) => r.family === 'TLMA')!
    expect(tlma).toMatchObject({ leads: 1, converted: 1, convertedValue: 2200 })
    expect(report.rows.find((r) => r.family === 'Paid Search')).toBeUndefined()
  })
})

describe('LEAD-SRC-6C boundaries', () => {
  it('[STATIC] no receipt eligibility / converted_value / KPI / QBO changes', () => {
    const portal = readRepoFile('src/services/portal/portalService.ts')
    const source = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptSource.ts'
    )
    const calc = readRepoFile(
      'src/features/sales-intelligence/source-performance/sourcePerformanceCalculations.ts'
    )
    const corpus = portal + source + calc
    expect(corpus).not.toContain('quickbooks')
    expect(corpus).not.toContain('ReferralsTab')
    expect(corpus).not.toContain('serviceQuoteMath')
    expect(corpus).not.toContain('getProjectFinancials')
    expect(corpus).not.toMatch(/CREATE TABLE|ALTER TABLE/i)
    expect(corpus).not.toMatch(/\.update\(\{[^}]*source_family/)
    expect(calc).not.toMatch(/receipts\.push|from\(CONVERSION/)
  })

  it('[STATIC] recovery fetch uses exact hunter_lead_id only', () => {
    const recovery = readRepoFile(
      'src/features/sales-intelligence/source-performance/sourcePerformancePortalRecovery.ts'
    )
    expect(recovery).toContain(".from('portal_requests')")
    expect(recovery).toContain('hunter_lead_id, source_category')
    expect(recovery).toContain(".not('hunter_lead_id', 'is', null)")
  })
})
