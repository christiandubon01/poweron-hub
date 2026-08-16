/**
 * SALES-CONVERSION-1: Lead Conversion Tickets and Source Receipt Ledger.
 *
 * Test classification:
 *   [MOCK]   service/bridge behavior against a fake Supabase client
 *   [PURE]   pure normalization / aggregation functions
 *   [STATIC] source + migration content assertions (no live DB required)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Fake Supabase ────────────────────────────────────────────────────────────

const RECEIPTS_TABLE = 'hunter_conversion_receipts'

interface FakeState {
  receipts: any[]
  inserts: Array<{ table: string; payload: any }>
  updates: Array<{ table: string; payload: any }>
  insertError: { code?: string; message: string } | null
  enforceUnique: boolean
  user: { id: string; email?: string; user_metadata?: any } | null
  tenantRow: any
}

const state: FakeState = {
  receipts: [],
  inserts: [],
  updates: [],
  insertError: null,
  enforceUnique: true,
  user: { id: 'user-owner', email: 'owner@example.com', user_metadata: { full_name: 'Owner Name' } },
  tenantRow: { tenant_id: 'tenant-1' },
}

function resetState() {
  state.receipts = []
  state.inserts = []
  state.updates = []
  state.insertError = null
  state.enforceUnique = true
  state.user = {
    id: 'user-owner',
    email: 'owner@example.com',
    user_metadata: { full_name: 'Owner Name' },
  }
  state.tenantRow = { tenant_id: 'tenant-1' }
}

function idempotencyKey(row: any): string {
  return [row.tenant_id, row.lead_id, row.destination_type, row.destination_id].join('|')
}

function makeQuery(table: string) {
  const filters: Record<string, any> = {}
  const query: any = {
    eq(column: string, value: any) {
      filters[column] = value
      return query
    },
    limit() {
      return query
    },
    order() {
      return Promise.resolve({ data: rowsFor(table, filters), error: null })
    },
    maybeSingle() {
      return Promise.resolve({ data: rowsFor(table, filters)[0] ?? null, error: null })
    },
    single() {
      const row = rowsFor(table, filters)[0]
      return Promise.resolve(
        row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } }
      )
    },
    then(onFulfilled: any) {
      return Promise.resolve({ data: rowsFor(table, filters), error: null }).then(onFulfilled)
    },
  }
  return query
}

function rowsFor(table: string, filters: Record<string, any>): any[] {
  if (table === 'user_tenants') return state.tenantRow ? [state.tenantRow] : []
  if (table === 'profiles') return [{ full_name: 'Owner Name' }]
  if (table === RECEIPTS_TABLE) {
    return state.receipts.filter((row) =>
      Object.entries(filters).every(([key, value]) => String(row[key]) === String(value))
    )
  }
  return []
}

const supabaseMock = {
  auth: {
    getUser: async () => ({ data: { user: state.user } }),
  },
  from(table: string) {
    return {
      select: () => makeQuery(table),
      insert: (payload: any) => {
        state.inserts.push({ table, payload })
        const finish = () => {
          if (state.insertError) return { data: null, error: state.insertError }
          if (table === RECEIPTS_TABLE) {
            if (
              state.enforceUnique &&
              payload.lead_id != null &&
              state.receipts.some((row) => idempotencyKey(row) === idempotencyKey(payload))
            ) {
              return {
                data: null,
                error: { code: '23505', message: 'duplicate key value violates unique constraint' },
              }
            }
            const row = {
              id: `receipt-${state.receipts.length + 1}`,
              receipt_number: `CR-${String(state.receipts.length + 1).padStart(6, '0')}`,
              converted_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              ...payload,
            }
            state.receipts.push(row)
            return { data: row, error: null }
          }
          return { data: payload, error: null }
        }
        return {
          select: () => ({ single: async () => finish() }),
          then: (onFulfilled: any) => Promise.resolve(finish()).then(onFulfilled),
        }
      },
      update: (payload: any) => {
        state.updates.push({ table, payload })
        return {
          eq: async () => ({ data: null, error: null }),
        }
      },
    }
  },
}

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }))

vi.mock('@/services/hunter/resolveHunterTenantId', () => ({
  resolveHunterTenantId: async () => {
    if (!state.tenantRow?.tenant_id) {
      const err: any = new Error('hunter_tenant_unmapped')
      err.name = 'HunterTenantAuthorityError'
      err.code = 'hunter_tenant_unmapped'
      throw err
    }
    return state.tenantRow.tenant_id as string
  },
  resolveHunterTenantIdOrNull: async () => state.tenantRow?.tenant_id ?? null,
  HunterTenantAuthorityError: class HunterTenantAuthorityError extends Error {
    code: string
    constructor(code: string, message?: string) {
      super(message ?? code)
      this.name = 'HunterTenantAuthorityError'
      this.code = code
    }
  },
  isHunterTenantAuthorityError: (err: unknown) =>
    !!err && typeof err === 'object' && (err as any).name === 'HunterTenantAuthorityError',
}))

// Imported after the mock is registered.
const {
  buildReceiptDraft,
  fetchConversionReceipts,
  persistConversionReceipt,
  recordConversion,
  shortReceiptId,
} = await import('@/features/sales-intelligence/conversion-receipts/conversionReceiptService')
const { deriveConversionSource, formatSourceLabel } = await import(
  '@/features/sales-intelligence/conversion-receipts/conversionReceiptSource'
)
const { collectProvenLineage, lineageForLead, lineageKey, planHistoricalBackfill, serviceConvertedValueFromTotalQuoted } =
  await import('@/features/sales-intelligence/conversion-receipts/conversionReceiptLineage')
const { resolveTotalQuoted } = await import('@/features/service-quote/serviceQuoteMath')
const { reconcilePipelineConversions, CONVERTED_LEAD_STATUS } = await import(
  '@/features/sales-intelligence/conversion-receipts/conversionReceiptBridge'
)
const {
  availableSourceDetails,
  availableSourceFamilies,
  filterReceipts,
  sortReceiptsNewestFirst,
  summarizeBySource,
} = await import(
  '@/features/sales-intelligence/conversion-receipts/conversionReceiptCalculations'
)

// ── Fixtures ─────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..', '..')

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')
}

const MIGRATION_PATH = 'supabase/migrations/116_sales_conversion_receipts.sql'
const PROJECTS_PANEL_PATH = 'src/components/v15r/V15rProjectsPanel.tsx'
const PIPELINE_TAB_PATH = 'src/components/salesIntel/tabs/PipelineTab.tsx'
const APP_SHELL_PATH = 'src/components/layout/AppShell.tsx'

function portalLead(overrides: Record<string, any> = {}) {
  return {
    id: 'lead-portal-1',
    contact_name: 'Dana Reyes',
    company_name: null,
    source: 'customer_portal',
    source_tag: 'customer_portal',
    source_city: null,
    estimated_value: 4200,
    score: 82,
    status: 'won',
    ...overrides,
  }
}

function tlmaLead(overrides: Record<string, any> = {}) {
  return {
    id: 'lead-tlma-1',
    contact_name: 'Indio Permit 44120',
    source: 'tlma_riverside',
    source_tag: 'tlma_browser_import',
    source_city: 'Indio',
    estimated_value: 9000,
    score: 61,
    status: 'won',
    ...overrides,
  }
}

beforeEach(() => {
  resetState()
})

// ═════════════════════════════════════════════════════════════════════════════
// 1. Project conversion
// ═════════════════════════════════════════════════════════════════════════════

describe('1. Project conversion', () => {
  it('[MOCK] a successful project creation generates exactly one receipt', async () => {
    const result = await recordConversion({
      lead: tlmaLead(),
      destinationType: 'project',
      destinationId: 'proj1712345abcd',
      destinationLabel: 'Indio Panel Upgrade',
      convertedValue: 12500,
      tenantId: 'tenant-1',
    })

    expect(result.ok).toBe(true)
    expect(result.created).toBe(true)
    expect(state.receipts).toHaveLength(1)
  })

  it('[MOCK] the receipt carries the real project id and canonical contract value', async () => {
    const result = await recordConversion({
      lead: tlmaLead(),
      destinationType: 'project',
      destinationId: 'proj1712345abcd',
      destinationLabel: 'Indio Panel Upgrade',
      convertedValue: 12500,
      tenantId: 'tenant-1',
    })

    expect(result.receipt?.destinationType).toBe('project')
    expect(result.receipt?.destinationId).toBe('proj1712345abcd')
    expect(result.receipt?.convertedValue).toBe(12500)
    expect(result.receipt?.leadEstimatedValue).toBe(9000)
    expect(result.receipt?.leadScoreAtConversion).toBe(61)
    expect(result.receipt?.leadStatusBefore).toBe('won')
  })

  it('[STATIC] saveNewProject persists the receipt BEFORE the lead status changes', () => {
    const source = readRepoFile(PROJECTS_PANEL_PATH)
    const receiptAt = source.indexOf('await recordConversion(')
    const statusAt = source.indexOf("await updateLeadStatus(leadId, 'estimated' as any)")
    expect(receiptAt).toBeGreaterThan(-1)
    expect(statusAt).toBeGreaterThan(-1)
    expect(receiptAt).toBeLessThan(statusAt)
  })

  it('[STATIC] a failed receipt returns before the lead is moved out of Pipeline', () => {
    const source = readRepoFile(PROJECTS_PANEL_PATH)
    const failureAt = source.indexOf('if (!receiptResult.ok)')
    const statusAt = source.indexOf("await updateLeadStatus(leadId, 'estimated' as any)")
    expect(failureAt).toBeGreaterThan(-1)
    expect(failureAt).toBeLessThan(statusAt)
    // The guard must actually bail out rather than fall through.
    expect(source.slice(failureAt, statusAt)).toContain('return')
  })

  it('[STATIC] receipt creation is reached only after the project row is persisted', () => {
    const source = readRepoFile(PROJECTS_PANEL_PATH)
    const persistAt = source.indexOf("persist('projects', true)")
    const receiptAt = source.indexOf('await recordConversion(')
    expect(persistAt).toBeGreaterThan(-1)
    expect(persistAt).toBeLessThan(receiptAt)
  })

  it('[PURE] Open Project targets the exact project on the receipt', () => {
    const card = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/ConversionReceiptCard.tsx'
    )
    expect(card).toContain("'poweron:open-project'")
    expect(card).toContain('destinationId: receipt.destinationId')
  })

  it('[STATIC] AppShell routes open-project through the existing project navigation', () => {
    const shell = readRepoFile(APP_SHELL_PATH)
    expect(shell).toContain("window.addEventListener('poweron:open-project'")
    expect(shell).toContain('handleSelectProject(String(destinationId))')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 2. Service Call conversion
// ═════════════════════════════════════════════════════════════════════════════

describe('2. Service Call conversion', () => {
  const backupWithServiceCall = {
    projects: [],
    serviceEstimates: [
      { id: 'est1712999', hunterLeadId: 'lead-portal-1', customer: 'Dana Reyes', totalQuote: 780 },
    ],
  }

  it('[MOCK] a saved service call generates exactly one receipt holding its real id', async () => {
    const result = await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: backupWithServiceCall,
      tenantId: 'tenant-1',
    })

    expect(state.receipts).toHaveLength(1)
    expect(state.receipts[0].destination_type).toBe('service_call')
    expect(state.receipts[0].destination_id).toBe('est1712999')
    expect(result.outcomes[0].created).toBe(true)
  })

  it('[MOCK] the lead may exit Pipeline only once its receipt is durable', async () => {
    const ok = await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: backupWithServiceCall,
      tenantId: 'tenant-1',
    })
    expect(ok.leadsReadyToExit).toEqual(['lead-portal-1'])

    resetState()
    state.insertError = { message: 'network unreachable' }
    const failed = await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: backupWithServiceCall,
      tenantId: 'tenant-1',
    })
    expect(failed.leadsReadyToExit).toEqual([])
    expect(failed.errors).toContain('network unreachable')
  })

  it('[MOCK] LEAD-SRC-5B snapshots Service Total Quoted into converted_value', async () => {
    await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: backupWithServiceCall,
      tenantId: 'tenant-1',
    })
    // Destination totalQuote=780 → resolveTotalQuoted → converted_value snapshot.
    expect(state.receipts[0].converted_value).toBe(780)
  })

  it('[PURE] Open Service Call targets the exact service call on the receipt', () => {
    const card = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/ConversionReceiptCard.tsx'
    )
    expect(card).toContain("'poweron:open-service-call'")
    const shell = readRepoFile(APP_SHELL_PATH)
    expect(shell).toContain("window.addEventListener('poweron:open-service-call'")
  })

  it('[STATIC] the completion path flips the lead only from the Pipeline reconciler', () => {
    const pipeline = readRepoFile(PIPELINE_TAB_PATH)
    const reconcileAt = pipeline.indexOf('await reconcilePipelineConversions(')
    const exitAt = pipeline.indexOf('await completeLeadExit(')
    expect(reconcileAt).toBeGreaterThan(-1)
    expect(exitAt).toBeGreaterThan(reconcileAt)
    expect(CONVERTED_LEAD_STATUS).toBe('estimated')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 3. Cancel and failure behavior
// ═════════════════════════════════════════════════════════════════════════════

describe('3. Cancel and failure behavior', () => {
  it('[STATIC] opening a conversion modal creates no receipt', () => {
    const pipeline = readRepoFile(PIPELINE_TAB_PATH)
    const openHandler = pipeline.slice(
      pipeline.indexOf('const handleOpenEstimate'),
      pipeline.indexOf('const handleReturnToLeads')
    )
    expect(openHandler).toContain('poweron:open-estimate')
    expect(openHandler).not.toContain('recordConversion')
    expect(openHandler).not.toContain('persistConversionReceipt')
  })

  it('[STATIC] AppShell no longer converts the lead at click time', () => {
    const shell = readRepoFile(APP_SHELL_PATH)
    const handler = shell.slice(
      shell.indexOf('const handleOpenEstimate = (event: Event)'),
      shell.indexOf("window.addEventListener('poweron:open-estimate'")
    )
    // The premature status flip / disposition write / portal milestone writes
    // were all removed from the click path.
    expect(handler).not.toContain("updateLeadStatus(lead.id, 'estimated'")
    expect(handler).not.toContain('won_archived')
    expect(handler).not.toContain('A service call has been created for your request.')
  })

  it('[MOCK] cancelling creates no receipt — nothing is written without a destination id', async () => {
    const result = await persistConversionReceipt(
      buildReceiptDraft({
        tenantId: 'tenant-1',
        lead: portalLead(),
        destinationType: 'project',
        destinationId: '',
      })
    )
    expect(result.ok).toBe(false)
    expect(state.inserts).toHaveLength(0)
  })

  it('[MOCK] a failed destination save creates no receipt (no lineage, no receipt)', async () => {
    const result = await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: { projects: [], serviceEstimates: [] },
      tenantId: 'tenant-1',
    })
    expect(state.receipts).toHaveLength(0)
    expect(result.leadsReadyToExit).toEqual([])
  })

  it('[MOCK] a receipt failure surfaces a retryable error instead of a silent exit', async () => {
    state.insertError = { message: 'permission denied for table' }
    const result = await recordConversion({
      lead: portalLead(),
      destinationType: 'project',
      destinationId: 'proj999',
      tenantId: 'tenant-1',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('permission denied for table')
    expect(result.receipt).toBeNull()
  })

  it('[MOCK] a missing tenant refuses the write rather than guessing one', async () => {
    state.tenantRow = null
    const result = await recordConversion({
      lead: portalLead(),
      destinationType: 'project',
      destinationId: 'proj999',
    })
    expect(result.ok).toBe(false)
    expect(state.inserts).toHaveLength(0)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 4. Idempotency
// ═════════════════════════════════════════════════════════════════════════════

describe('4. Idempotency', () => {
  const draft = () =>
    buildReceiptDraft({
      tenantId: 'tenant-1',
      lead: portalLead(),
      destinationType: 'project',
      destinationId: 'proj-double-click',
      destinationLabel: 'Reyes Service Panel',
    })

  it('[MOCK] a double-click creates one receipt', async () => {
    const [first, second] = await Promise.all([
      persistConversionReceipt(draft()),
      persistConversionReceipt(draft()).then((r) => r),
    ])
    // Sequential re-entry is the deterministic form of the same race.
    const third = await persistConversionReceipt(draft())
    expect(state.receipts).toHaveLength(1)
    expect([first.ok, second.ok, third.ok]).toEqual([true, true, true])
    expect(third.created).toBe(false)
  })

  it('[MOCK] retrying the same conversion returns the existing receipt', async () => {
    const first = await persistConversionReceipt(draft())
    const retry = await persistConversionReceipt(draft())
    expect(first.created).toBe(true)
    expect(retry.created).toBe(false)
    expect(retry.receipt?.destinationId).toBe('proj-double-click')
    expect(state.receipts).toHaveLength(1)
  })

  it('[MOCK] repeated reconciliation passes do not duplicate the receipt', async () => {
    const backup = {
      projects: [],
      serviceEstimates: [{ id: 'est-repeat', hunterLeadId: 'lead-portal-1', customer: 'Dana' }],
    }
    await reconcilePipelineConversions({ leads: [portalLead()], backup, tenantId: 'tenant-1' })
    await reconcilePipelineConversions({ leads: [portalLead()], backup, tenantId: 'tenant-1' })
    await reconcilePipelineConversions({ leads: [portalLead()], backup, tenantId: 'tenant-1' })
    expect(state.receipts).toHaveLength(1)
  })

  it('[MOCK] one lead producing two different destinations gets two receipts', async () => {
    const backup = {
      projects: [{ id: 'proj-a', convertedFromLeadId: 'lead-portal-1', name: 'Panel', contract: 900 }],
      serviceEstimates: [{ id: 'est-b', hunterLeadId: 'lead-portal-1', customer: 'Dana' }],
    }
    await reconcilePipelineConversions({ leads: [portalLead()], backup, tenantId: 'tenant-1' })
    expect(state.receipts).toHaveLength(2)
    expect(state.receipts.map((r) => r.destination_type).sort()).toEqual([
      'project',
      'service_call',
    ])
  })

  it('[STATIC] the database enforces the idempotency rule, not just the client', () => {
    const sql = readRepoFile(MIGRATION_PATH)
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX[\s\S]*?\(tenant_id, lead_id, destination_type, destination_id\)/
    )
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 5. Source preservation
// ═════════════════════════════════════════════════════════════════════════════

describe('5. Source preservation', () => {
  it('[PURE] Customer Portal stays Customer Portal', () => {
    const source = deriveConversionSource(portalLead())
    expect(source.family).toBe('Customer Portal')
    expect(source.detail).toBeNull()
    expect(formatSourceLabel(source.family, source.detail)).toBe('Customer Portal')
  })

  it('[PURE] TLMA with an Indio feed displays TLMA / Indio', () => {
    const source = deriveConversionSource(tlmaLead())
    expect(source.family).toBe('TLMA')
    expect(source.detail).toBe('Indio')
    expect(formatSourceLabel(source.family, source.detail)).toBe('TLMA / Indio')
  })

  it('[PURE] TLMA with a Palm Desert feed displays TLMA / Palm Desert', () => {
    const source = deriveConversionSource(
      tlmaLead({ source: 'tlma_publiclookup', source_city: 'Palm Desert' })
    )
    expect(formatSourceLabel(source.family, source.detail)).toBe('TLMA / Palm Desert')
  })

  it('[PURE] raw source values are preserved verbatim on the receipt', () => {
    const source = deriveConversionSource(tlmaLead())
    expect(source.raw).toContain('tlma_riverside')
    expect(source.raw).toContain('tlma_browser_import')
    expect(source.raw).toContain('Indio')
  })

  it('[PURE] a missing source detail never becomes a fake detail', () => {
    expect(deriveConversionSource({ source: 'manual_entry' }).detail).toBeNull()
    // Migration 074 backfilled the literal 'TLMA' marker — it is the family,
    // not a location, so it must not surface as "TLMA / TLMA".
    expect(
      deriveConversionSource({ source: 'tlma_riverside', source_city: 'TLMA' }).detail
    ).toBeNull()
  })

  it('[PURE] the job-site address is never mistaken for an acquisition source', () => {
    const source = deriveConversionSource({
      source: 'manual_entry',
      city: 'Indio',
      address: '123 Indio Blvd',
    })
    expect(source.family).toBe('Manual')
    expect(source.detail).toBeNull()
    expect(source.raw).not.toContain('Indio')
  })

  it('[PURE] an unknown feed is humanized rather than dropped', () => {
    expect(deriveConversionSource({ source: 'new_permit_feed' }).family).toBe('New Permit Feed')
    expect(deriveConversionSource({}).family).toBe('Other')
  })

  it('[PURE] filter options are built from actual receipt data', () => {
    const receipts = [
      { sourceFamily: 'TLMA', sourceDetail: 'Indio' },
      { sourceFamily: 'TLMA', sourceDetail: 'Palm Desert' },
      { sourceFamily: 'Customer Portal', sourceDetail: null },
    ] as any[]
    expect(availableSourceFamilies(receipts)).toEqual(['Customer Portal', 'TLMA'])
    expect(availableSourceDetails(receipts, 'TLMA')).toEqual(['Indio', 'Palm Desert'])
    expect(availableSourceDetails(receipts, 'Customer Portal')).toEqual([])
  })

  it('[PURE] the source summary keeps counts and dollars in separate fields', () => {
    const receipts = [
      { sourceFamily: 'TLMA', sourceDetail: 'Indio', destinationType: 'project', convertedValue: 1000 },
      { sourceFamily: 'TLMA', sourceDetail: 'Indio', destinationType: 'service_call', convertedValue: null },
      { sourceFamily: 'Customer Portal', sourceDetail: null, destinationType: 'project', convertedValue: 500 },
    ] as any[]
    const summary = summarizeBySource(receipts)
    const tlma = summary.find((row) => row.label === 'TLMA / Indio')!
    expect(tlma.conversions).toBe(2)
    expect(tlma.projectConversions).toBe(1)
    expect(tlma.serviceCallConversions).toBe(1)
    expect(tlma.convertedValueTotal).toBe(1000)
    // Only one of the two receipts carried a canonical amount.
    expect(tlma.convertedValueCount).toBe(1)
  })

  it('[PURE] receipts are newest-first by default and filterable by type', () => {
    const receipts = [
      { id: 'a', convertedAt: '2026-01-01T00:00:00Z', createdAt: '', destinationType: 'project' },
      { id: 'b', convertedAt: '2026-06-01T00:00:00Z', createdAt: '', destinationType: 'service_call' },
    ] as any[]
    expect(sortReceiptsNewestFirst(receipts).map((r) => r.id)).toEqual(['b', 'a'])
    const filtered = filterReceipts(receipts as any, {
      search: '',
      sourceFamily: null,
      sourceDetail: null,
      destinationType: 'project',
    })
    expect(filtered.map((r) => r.id)).toEqual(['a'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 6. Historical durability and backfill
// ═════════════════════════════════════════════════════════════════════════════

describe('6. Historical durability', () => {
  it('[MOCK] editing the original lead does not rewrite the receipt snapshot', async () => {
    const lead = tlmaLead()
    await recordConversion({
      lead,
      destinationType: 'project',
      destinationId: 'proj-snapshot',
      destinationLabel: 'Original Name',
      tenantId: 'tenant-1',
    })
    const snapshot = { ...state.receipts[0] }

    // The lead is later renamed, rescored, and re-sourced.
    lead.contact_name = 'Renamed Contact'
    lead.score = 12
    lead.source = 'manual_entry'
    lead.source_city = 'Palm Desert'

    const { receipts } = await fetchConversionReceipts()
    expect(receipts[0].leadName).toBe(snapshot.lead_name)
    expect(receipts[0].leadName).toBe('Indio Permit 44120')
    expect(receipts[0].sourceFamily).toBe('TLMA')
    expect(receipts[0].sourceDetail).toBe('Indio')
    expect(receipts[0].leadScoreAtConversion).toBe(61)
  })

  it('[STATIC] deleting the lead nulls the FK but keeps the receipt row', () => {
    const sql = readRepoFile(MIGRATION_PATH)
    expect(sql).toMatch(/lead_id\s+UUID REFERENCES public\.hunter_leads\(id\) ON DELETE SET NULL/)
    // The snapshot columns that keep it readable afterwards.
    for (const column of [
      'lead_name',
      'lead_company',
      'lead_contact_name',
      'source_family',
      'source_detail',
      'source_raw',
      'destination_id',
      'converted_by_name',
    ]) {
      expect(sql).toContain(column)
    }
  })

  it('[MOCK] a receipt whose lead is gone still renders a usable ticket', () => {
    const orphan = {
      id: 'aabbccdd-0000-1111-2222-333344445555',
      receiptNumber: null,
      leadId: null,
      leadName: 'Indio Permit 44120',
      destinationType: 'project',
      destinationId: 'proj-x',
    } as any
    expect(shortReceiptId(orphan)).toBe('CR-AABBCCDD')
    expect(orphan.leadName).toBe('Indio Permit 44120')
  })

  it('[PURE] backfill uses only proven destination lineage', () => {
    const backup = {
      projects: [
        { id: 'proj-1', convertedFromLeadId: 'lead-tlma-1', name: 'Real', contract: 5000 },
        // Won/archived but with no lineage field — never backfilled.
        { id: 'proj-2', name: 'No lineage' },
      ],
      serviceEstimates: [
        { id: 'est-1', hunterLeadId: 'lead-portal-1', customer: 'Dana' },
        { id: 'est-2', customer: 'No lineage' },
      ],
    }
    const lineage = collectProvenLineage(backup)
    expect(lineage).toHaveLength(2)
    expect(lineage.map((l) => l.destinationId).sort()).toEqual(['est-1', 'proj-1'])
    expect(lineage.find((l) => l.destinationId === 'proj-1')!.convertedValue).toBe(5000)
    expect(lineage.find((l) => l.destinationId === 'est-1')!.convertedValue).toBeNull()
  })

  it('[PURE] backfill skips deleted destination records', () => {
    const backup = {
      projects: [],
      serviceEstimates: [
        { id: 'est-dead', hunterLeadId: 'lead-portal-1', deletedAt: '2026-01-01T00:00:00Z' },
      ],
    }
    expect(collectProvenLineage(backup)).toHaveLength(0)
  })

  it('[PURE] backfill reports unprovable records separately instead of guessing', () => {
    const backup = {
      projects: [{ id: 'proj-1', convertedFromLeadId: 'lead-gone', name: 'Orphan' }],
      serviceEstimates: [{ id: 'est-1', hunterLeadId: 'lead-portal-1', customer: 'Dana' }],
    }
    const plan = planHistoricalBackfill({
      backup,
      leads: [portalLead()],
      existingReceiptKeys: new Set<string>(),
    })
    expect(plan.eligible.map((c) => c.destinationId)).toEqual(['est-1'])
    expect(plan.ineligible).toEqual([
      expect.objectContaining({ destinationId: 'proj-1', reason: 'lead_missing' }),
    ])
  })

  it('[PURE] backfill never duplicates an existing receipt', () => {
    const backup = {
      projects: [{ id: 'proj-1', convertedFromLeadId: 'lead-portal-1', name: 'Already receipted' }],
      serviceEstimates: [],
    }
    const plan = planHistoricalBackfill({
      backup,
      leads: [portalLead()],
      existingReceiptKeys: new Set([lineageKey('lead-portal-1', 'project', 'proj-1')]),
    })
    expect(plan.eligible).toHaveLength(0)
    expect(plan.ineligible[0].reason).toBe('receipt_exists')
  })

  it('[PURE] lineageForLead returns only that lead destinations', () => {
    const backup = {
      projects: [
        { id: 'proj-1', convertedFromLeadId: 'lead-portal-1' },
        { id: 'proj-2', convertedFromLeadId: 'lead-other' },
      ],
      serviceEstimates: [],
    }
    expect(lineageForLead(backup, 'lead-portal-1').map((l) => l.destinationId)).toEqual(['proj-1'])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 7. Tenant isolation
// ═════════════════════════════════════════════════════════════════════════════

describe('7. Tenant isolation', () => {
  const sql = () => readRepoFile(MIGRATION_PATH)

  it('[STATIC] RLS is enabled on the receipts table', () => {
    expect(sql()).toContain(
      'ALTER TABLE public.hunter_conversion_receipts ENABLE ROW LEVEL SECURITY'
    )
  })

  it('[STATIC] reads require tenant membership, denying other organizations', () => {
    const policy = sql().slice(
      sql().indexOf('CREATE POLICY hunter_conversion_receipts_owner_read'),
      sql().indexOf('CREATE POLICY hunter_conversion_receipts_owner_insert')
    )
    expect(policy).toContain('FROM public.user_tenants ut')
    expect(policy).toContain('ut.user_id = auth.uid()')
    expect(policy).toContain('ut.tenant_id = hunter_conversion_receipts.tenant_id')
  })

  it('[STATIC] only owner/admin may read — employee accounts are excluded by default', () => {
    const policy = sql().slice(
      sql().indexOf('CREATE POLICY hunter_conversion_receipts_owner_read'),
      sql().indexOf('CREATE POLICY hunter_conversion_receipts_owner_insert')
    )
    expect(policy).toContain("p.role IN ('owner', 'admin')")
  })

  it('[STATIC] the conversion path may insert, scoped to its own tenant', () => {
    const insertPolicy = sql().slice(sql().indexOf('CREATE POLICY hunter_conversion_receipts_owner_insert'))
    expect(insertPolicy).toContain('FOR INSERT')
    expect(insertPolicy).toContain('WITH CHECK')
    expect(insertPolicy).toContain('ut.tenant_id = hunter_conversion_receipts.tenant_id')
    expect(insertPolicy).toContain("p.role IN ('owner', 'admin')")
  })

  it('[STATIC] receipts are append-only — no UPDATE or DELETE policy exists', () => {
    expect(sql()).not.toMatch(/CREATE POLICY[^;]*FOR UPDATE/)
    expect(sql()).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/)
    expect(sql()).toContain('GRANT SELECT, INSERT ON public.hunter_conversion_receipts')
  })

  it('[STATIC] anon has no access at all', () => {
    expect(sql()).toContain('REVOKE ALL ON public.hunter_conversion_receipts FROM anon')
    expect(sql()).toContain('REVOKE ALL ON public.hunter_conversion_receipts FROM PUBLIC')
  })

  it('[STATIC] no existing Hunter or Sales Intelligence RLS is weakened', () => {
    const text = sql()
    for (const forbidden of [
      'hunter_leads_user_isolation',
      'ALTER TABLE public.hunter_leads',
      'hunter_lead_revisions_tenant_isolation',
      'DISABLE ROW LEVEL SECURITY',
    ]) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('[MOCK] receipts are written with the caller resolved tenant, never a client-chosen one', async () => {
    await recordConversion({
      lead: portalLead(),
      destinationType: 'project',
      destinationId: 'proj-tenant',
    })
    expect(state.inserts[0].payload.tenant_id).toBe('tenant-1')
    expect(state.inserts[0].payload.converted_by).toBe('user-owner')
    expect(state.inserts[0].payload.converted_by_name).toBe('Owner Name')
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// 8. Parallel-agent safety
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// LEAD-SRC-5B — Service converted_value from resolveTotalQuoted
// ═════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-5B Service converted_value from Total Quoted', () => {
  it('[PURE] Project lineage still snapshots project.contract', () => {
    const lineage = collectProvenLineage({
      projects: [{ id: 'proj-c', convertedFromLeadId: 'lead-tlma-1', name: 'Panel', contract: 12500 }],
      serviceEstimates: [],
    })
    expect(lineage).toHaveLength(1)
    expect(lineage[0].destinationType).toBe('project')
    expect(lineage[0].convertedValue).toBe(12500)
  })

  it('[STATIC] Project save path still uses project.contract — not resolveTotalQuoted', () => {
    const source = readRepoFile(PROJECTS_PANEL_PATH)
    const receiptBlock = source.slice(
      source.indexOf('await recordConversion({'),
      source.indexOf('await recordConversion({') + 600
    )
    expect(receiptBlock).toContain('convertedValue: num(newProj.contract) || null')
    expect(receiptBlock).not.toContain('resolveTotalQuoted')
  })

  it('[MOCK] Service totalQuote=5000 → converted_value=5000', async () => {
    await reconcilePipelineConversions({
      leads: [portalLead({ estimated_value: 8000 })],
      backup: {
        serviceEstimates: [
          { id: 'est-5000', hunterLeadId: 'lead-portal-1', customer: 'Dana', totalQuote: 5000 },
        ],
      },
      tenantId: 'tenant-1',
    })
    expect(state.receipts).toHaveLength(1)
    expect(state.receipts[0].converted_value).toBe(5000)
    expect(state.receipts[0].lead_estimated_value).toBe(8000)
  })

  it('[PURE+MOCK] legacy quoted=4200 resolves and snapshots', async () => {
    expect(resolveTotalQuoted({ quoted: 4200 })).toBe(4200)
    expect(serviceConvertedValueFromTotalQuoted({ quoted: 4200 })).toBe(4200)
    await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: {
        serviceEstimates: [
          { id: 'est-legacy', hunterLeadId: 'lead-portal-1', customer: 'Dana', quoted: 4200 },
        ],
      },
      tenantId: 'tenant-1',
    })
    expect(state.receipts[0].converted_value).toBe(4200)
  })

  it('[PURE] no quote / zero / invalid → null (never fabricates from lead estimate)', () => {
    expect(serviceConvertedValueFromTotalQuoted({})).toBeNull()
    expect(serviceConvertedValueFromTotalQuoted({ totalQuote: 0 })).toBeNull()
    expect(serviceConvertedValueFromTotalQuoted({ totalQuote: null })).toBeNull()
    expect(serviceConvertedValueFromTotalQuoted({ quoted: undefined })).toBeNull()
    expect(serviceConvertedValueFromTotalQuoted({ totalQuote: Number.NaN })).toBeNull()
    expect(serviceConvertedValueFromTotalQuoted({ totalQuote: -50 })).toBeNull()
    expect(serviceConvertedValueFromTotalQuoted({ totalQuote: 'nope' })).toBeNull()
  })

  it('[MOCK] Service with no quote keeps converted_value null even when lead_estimated_value exists', async () => {
    await reconcilePipelineConversions({
      leads: [portalLead({ estimated_value: 8000 })],
      backup: {
        serviceEstimates: [{ id: 'est-empty', hunterLeadId: 'lead-portal-1', customer: 'Dana' }],
      },
      tenantId: 'tenant-1',
    })
    expect(state.receipts[0].converted_value).toBeNull()
    expect(state.receipts[0].lead_estimated_value).toBe(8000)
  })

  it('[MOCK] Service quote=0 → converted_value null', async () => {
    await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: {
        serviceEstimates: [
          { id: 'est-zero', hunterLeadId: 'lead-portal-1', customer: 'Dana', totalQuote: 0 },
        ],
      },
      tenantId: 'tenant-1',
    })
    expect(state.receipts[0].converted_value).toBeNull()
  })

  it('[MOCK] append-only: later destination quote change does not update the receipt', async () => {
    const backup = {
      serviceEstimates: [
        { id: 'est-snap', hunterLeadId: 'lead-portal-1', customer: 'Dana', totalQuote: 5000 },
      ],
    }
    await reconcilePipelineConversions({
      leads: [portalLead()],
      backup,
      tenantId: 'tenant-1',
    })
    expect(state.receipts[0].converted_value).toBe(5000)
    const insertCount = state.inserts.length

    backup.serviceEstimates[0].totalQuote = 5500
    const retry = await reconcilePipelineConversions({
      leads: [portalLead()],
      backup,
      tenantId: 'tenant-1',
    })
    expect(retry.outcomes[0].created).toBe(false)
    expect(state.receipts).toHaveLength(1)
    expect(state.receipts[0].converted_value).toBe(5000)
    expect(state.updates.filter((u) => u.table === RECEIPTS_TABLE)).toHaveLength(0)
    // Unique violation path may attempt insert then recover — never mutates stored value.
    expect(state.receipts[0].converted_value).not.toBe(5500)
    expect(state.inserts.length).toBeGreaterThanOrEqual(insertCount)
  })

  it('[PURE] existing receipt key blocks backfill — NULL service values are not rewritten', () => {
    const backup = {
      serviceEstimates: [
        { id: 'est-old', hunterLeadId: 'lead-portal-1', customer: 'Kathryn', totalQuote: 9000 },
      ],
    }
    const plan = planHistoricalBackfill({
      backup,
      leads: [portalLead()],
      existingReceiptKeys: new Set([lineageKey('lead-portal-1', 'service_call', 'est-old')]),
    })
    expect(plan.eligible).toHaveLength(0)
    expect(plan.ineligible[0].reason).toBe('receipt_exists')
    // Lineage would now resolve 9000 for a *new* mint, but existing key prevents rewrite.
    expect(collectProvenLineage(backup)[0].convertedValue).toBe(9000)
  })

  it('[PURE] lineage selects the exact hunterLeadId destination, not a name match', () => {
    const lineage = lineageForLead(
      {
        serviceEstimates: [
          { id: 'est-other', hunterLeadId: 'lead-other', customer: 'Dana', totalQuote: 9999 },
          { id: 'est-mine', hunterLeadId: 'lead-portal-1', customer: 'Dana', totalQuote: 5000 },
        ],
      },
      'lead-portal-1'
    )
    expect(lineage).toHaveLength(1)
    expect(lineage[0].destinationId).toBe('est-mine')
    expect(lineage[0].convertedValue).toBe(5000)
  })

  it('[STATIC] no new receipt table/schema; UI still reads convertedValue; no QuickBooks', () => {
    const card = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/ConversionReceiptCard.tsx'
    )
    expect(card).toContain('receipt.convertedValue')
    expect(card).toContain('Not quoted')
    const lineage = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptLineage.ts'
    )
    expect(lineage).toContain('resolveTotalQuoted')
    expect(lineage).not.toContain('quickbooks')
    const types = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptTypes.ts'
    )
    expect(types).toContain('hunter_conversion_receipts')
    const service = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptService.ts'
    )
    expect(service).toContain('CONVERSION_RECEIPTS_TABLE')
    expect(lineage + service).not.toMatch(/CREATE TABLE/i)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// LEAD-SRC-5C — Conversion receipt eligibility = Pipeline lineage only
// ═════════════════════════════════════════════════════════════════════════════

describe('LEAD-SRC-5C Conversion receipt eligibility boundary', () => {
  it('[PURE] manual Service Estimate with quote but no hunterLeadId is not a receipt candidate', () => {
    const backup = {
      serviceEstimates: [
        {
          id: 'est-manual-10k',
          customer: 'Walk-in Customer',
          phone: '760-555-0100',
          email: 'walkin@example.com',
          accountId: 'acct-1',
          totalQuote: 10000,
        },
      ],
      serviceLogs: [{ id: 'log-1', customer: 'Walk-in Customer', quoted: 10000 }],
    }
    expect(collectProvenLineage(backup)).toEqual([])
  })

  it('[PURE] manual Service Estimate with no quote and no hunterLeadId is not a candidate', () => {
    expect(
      collectProvenLineage({
        serviceEstimates: [{ id: 'est-manual-empty', customer: 'Walk-in Customer' }],
      })
    ).toEqual([])
  })

  it('[MOCK] reconcile never mints a receipt for manual Service work even with won Pipeline leads present', async () => {
    const result = await reconcilePipelineConversions({
      leads: [portalLead()],
      backup: {
        serviceEstimates: [
          {
            id: 'est-manual',
            customer: 'Dana Reyes',
            phone: '760-555-9999',
            email: 'dana@example.com',
            totalQuote: 10000,
          },
        ],
      },
      tenantId: 'tenant-1',
    })
    expect(result.outcomes).toEqual([])
    expect(result.leadsReadyToExit).toEqual([])
    expect(state.receipts).toHaveLength(0)
    expect(state.inserts.filter((i) => i.table === RECEIPTS_TABLE)).toHaveLength(0)
  })

  it('[PURE+MOCK] Pipeline Service destination with hunterLeadId is eligible; quote only sets value', async () => {
    const withQuote = collectProvenLineage({
      serviceEstimates: [
        { id: 'est-pipe', hunterLeadId: 'lead-portal-1', customer: 'Dana', totalQuote: 5000 },
      ],
    })
    expect(withQuote).toHaveLength(1)
    expect(withQuote[0].convertedValue).toBe(5000)

    const noQuote = collectProvenLineage({
      serviceEstimates: [{ id: 'est-pipe-nq', hunterLeadId: 'lead-portal-1', customer: 'Dana' }],
    })
    expect(noQuote).toHaveLength(1)
    expect(noQuote[0].convertedValue).toBeNull()

    await reconcilePipelineConversions({
      leads: [portalLead({ estimated_value: 8000 })],
      backup: {
        serviceEstimates: [
          { id: 'est-pipe-nq', hunterLeadId: 'lead-portal-1', customer: 'Dana' },
        ],
      },
      tenantId: 'tenant-1',
    })
    expect(state.receipts).toHaveLength(1)
    expect(state.receipts[0].destination_id).toBe('est-pipe-nq')
    expect(state.receipts[0].converted_value).toBeNull()
    expect(state.receipts[0].lead_estimated_value).toBe(8000)
  })

  it('[PURE] quote alone never establishes eligibility', () => {
    expect(serviceConvertedValueFromTotalQuoted({ totalQuote: 10000 })).toBe(10000)
    expect(
      collectProvenLineage({
        serviceEstimates: [{ id: 'est-quoted-only', totalQuote: 10000, customer: 'Anyone' }],
      })
    ).toEqual([])
  })

  it('[PURE] customer name / phone / email similarity never establishes lineage', () => {
    const backup = {
      serviceEstimates: [
        {
          id: 'est-similar',
          customer: 'Dana Reyes',
          phone: '555-0100',
          email: 'portal@example.com',
          totalQuote: 4200,
        },
      ],
    }
    expect(collectProvenLineage(backup)).toEqual([])
    expect(lineageForLead(backup, 'lead-portal-1')).toEqual([])
  })

  it('[PURE] unrelated Service Estimate for the same customer cannot be selected', () => {
    const lineage = lineageForLead(
      {
        serviceEstimates: [
          {
            id: 'est-same-name-no-lineage',
            customer: 'Dana Reyes',
            totalQuote: 99999,
          },
          {
            id: 'est-true',
            hunterLeadId: 'lead-portal-1',
            customer: 'Dana Reyes',
            totalQuote: 5000,
          },
        ],
      },
      'lead-portal-1'
    )
    expect(lineage.map((l) => l.destinationId)).toEqual(['est-true'])
    expect(lineage[0].convertedValue).toBe(5000)
  })

  it('[PURE] Project with convertedFromLeadId is eligible; ordinary Project is not', () => {
    const backup = {
      projects: [
        { id: 'proj-ordinary', name: 'Manual Job', client: 'Dana', contract: 20000 },
        {
          id: 'proj-from-lead',
          convertedFromLeadId: 'lead-tlma-1',
          name: 'Pipeline Job',
          contract: 12500,
        },
      ],
    }
    const lineage = collectProvenLineage(backup)
    expect(lineage).toHaveLength(1)
    expect(lineage[0].destinationId).toBe('proj-from-lead')
    expect(lineage[0].convertedValue).toBe(12500)
  })

  it('[STATIC] Project writer only mints when a Hunter/Pipeline lead id is present', () => {
    const source = readRepoFile(PROJECTS_PANEL_PATH)
    const guardAt = source.indexOf('if (prefillFromLead?.leadId || hunterBannerCtx?.leadId)')
    const receiptAt = source.indexOf('await recordConversion({')
    expect(guardAt).toBeGreaterThan(-1)
    expect(receiptAt).toBeGreaterThan(guardAt)
    expect(source.slice(guardAt, receiptAt + 400)).toContain('convertedValue: num(newProj.contract) || null')
  })

  it('[STATIC] Service save stamps hunterLeadId only from portalLeadId; event gated on hunterLeadId', () => {
    const fieldLog = readRepoFile('src/components/v15r/V15rFieldLogPanel.tsx')
    expect(fieldLog).toContain(
      "hunterLeadId: (!editEstimateId && portalLeadId) ? portalLeadId : undefined"
    )
    expect(fieldLog).toContain('if (estimate.hunterLeadId)')
    expect(fieldLog).toContain("poweron:service-call-created")
  })

  it('[STATIC] no source-specific duplicate receipt writers; no customer-match inference', () => {
    const bridge = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptBridge.ts'
    )
    const lineage = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptLineage.ts'
    )
    const service = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptService.ts'
    )
    const corpus = bridge + lineage + service
    expect(corpus).toContain('lineageForLead')
    expect(corpus).toContain('hunterLeadId')
    expect(corpus).toContain('convertedFromLeadId')
    expect(corpus).not.toMatch(/matchBy(Phone|Email|Customer|Name)/i)
    expect(corpus).not.toMatch(/latestService|latestProject|findLeadBy/i)
    expect(corpus).not.toContain('customer_portal_receipt')
    expect(corpus).not.toContain('tlma_receipt')
    // 5B value helper must not gate eligibility — lineage still requires hunterLeadId first.
    expect(lineage.indexOf('nonEmptyString(estimate?.hunterLeadId)')).toBeLessThan(
      lineage.indexOf('serviceConvertedValueFromTotalQuoted(estimate)')
    )
  })

  it('[MOCK] idempotency unchanged for Pipeline Service receipts', async () => {
    const backup = {
      serviceEstimates: [
        { id: 'est-idem', hunterLeadId: 'lead-portal-1', customer: 'Dana', totalQuote: 5000 },
      ],
    }
    await reconcilePipelineConversions({ leads: [portalLead()], backup, tenantId: 'tenant-1' })
    await reconcilePipelineConversions({ leads: [portalLead()], backup, tenantId: 'tenant-1' })
    expect(state.receipts).toHaveLength(1)
    expect(state.receipts[0].converted_value).toBe(5000)
  })

  it('[STATIC] eligibility path does not involve KPI / QuickBooks / referral modules', () => {
    const files = [
      'conversionReceiptLineage.ts',
      'conversionReceiptBridge.ts',
      'conversionReceiptService.ts',
    ]
    for (const file of files) {
      const text = readRepoFile(`src/features/sales-intelligence/conversion-receipts/${file}`)
      expect(text).not.toContain('quickbooks')
      expect(text).not.toContain('ReferralsTab')
      expect(text).not.toContain('kpiService')
      expect(text).not.toContain('MoneyPanel')
    }
  })
})

describe('8. Parallel-agent safety', () => {
  it('[STATIC] this phase created migration 116 and left 115 alone', () => {
    expect(existsSync(resolve(REPO_ROOT, MIGRATION_PATH))).toBe(true)
    const mine = readRepoFile(MIGRATION_PATH)
    expect(mine).toContain('hunter_conversion_receipts')
    expect(mine).not.toContain('service_call_employee_assignments')
  })

  it('[STATIC] no Sales Intelligence code imports or edits the Service Log panel', () => {
    const featureFiles = [
      'conversionReceiptService.ts',
      'conversionReceiptBridge.ts',
      'conversionReceiptLineage.ts',
      'conversionCompletion.ts',
      'ConversionReceiptsPanel.tsx',
      'ConversionReceiptCard.tsx',
    ]
    for (const file of featureFiles) {
      const text = readRepoFile(`src/features/sales-intelligence/conversion-receipts/${file}`)
      // Prose may name the Service Log panel; code must never reach into it.
      // LEAD-SRC-5B allows resolveTotalQuoted via serviceQuoteMath only.
      const imports = text.match(/^\s*(import|export)\s.*from\s+'[^']+'/gm) ?? []
      const dynamicImports = text.match(/import\('[^']+'\)/g) ?? []
      for (const line of [...imports, ...dynamicImports]) {
        expect(line).not.toContain('V15rFieldLogPanel')
        expect(line).not.toContain('serviceCallAssignmentService')
        if (line.includes('service-quote')) {
          expect(line).toContain('serviceQuoteMath')
          expect(file).toBe('conversionReceiptLineage.ts')
        }
      }
    }
  })

  it('[STATIC] the Service Call bridge documents the callback contract it is waiting on', () => {
    const bridge = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptBridge.ts'
    )
    expect(bridge).toContain('poweron:service-call-created')
    expect(bridge).toContain('serviceCallId')
    expect(bridge).toContain('persistServiceCalls()')
  })

  it('[STATIC] the reconciler reads existing lineage rather than requiring a Service Log edit', () => {
    const lineage = readRepoFile(
      'src/features/sales-intelligence/conversion-receipts/conversionReceiptLineage.ts'
    )
    expect(lineage).toContain('hunterLeadId')
    expect(lineage).toContain('convertedFromLeadId')
  })
})
