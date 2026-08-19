/**
 * LEAD-SRC-3B — phone normalize, entity match, call log service contracts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION_PATH = 'supabase/migrations/127_call_logs.sql'

function readMigration(): string {
  return readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8')
}

const insertCalls: any[] = []
const updateCalls: any[] = []
const fromTables: string[] = []

const state = {
  user: { id: 'user-1' } as { id: string } | null,
  orgId: 'org-a' as string | null,
  mappedTenantId: 'tenant-mapped' as string | null,
  memberships: new Set<string>(['tenant-mapped']),
  insertError: null as { message: string } | null,
  portalRows: [] as any[],
  clientRows: [] as any[],
  leadRows: [] as any[],
  insertedRow: null as any,
  updatedRow: null as any,
}

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    fromTables.push(table)

    if (table === 'organizations') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { hunter_tenant_id: state.mappedTenantId },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === 'user_tenants') {
      const filters: Record<string, string> = {}
      const query: any = {
        select: () => query,
        eq: (col: string, val: string) => {
          filters[col] = val
          return query
        },
        maybeSingle: async () => {
          const tid = filters.tenant_id
          const uid = filters.user_id
          if (uid === state.user?.id && tid && state.memberships.has(tid)) {
            return { data: { tenant_id: tid }, error: null }
          }
          return { data: null, error: null }
        },
      }
      return query
    }

    if (table === 'portal_requests') {
      const query: any = {
        select: () => query,
        eq: () => query,
        not: () => query,
        limit: async () => ({ data: state.portalRows, error: null }),
      }
      return query
    }

    if (table === 'clients') {
      const query: any = {
        select: () => query,
        eq: () => query,
        not: () => query,
        limit: async () => ({ data: state.clientRows, error: null }),
      }
      return query
    }

    if (table === 'hunter_leads') {
      const query: any = {
        select: () => query,
        eq: () => query,
        not: () => query,
        limit: async () => ({ data: state.leadRows, error: null }),
        update: () => {
          throw new Error('hunter_leads must not be mutated by call classification')
        },
      }
      return query
    }

    if (table === 'call_logs') {
      const query: any = {
        insert: (payload: any) => {
          insertCalls.push(payload)
          const row = {
            id: 'call-1',
            created_at: '2026-08-15T12:00:00.000Z',
            updated_at: '2026-08-15T12:00:00.000Z',
            ...payload,
            ...(Array.isArray(payload) ? payload[0] : {}),
          }
          state.insertedRow = row
          const chain: any = {
            select: () => chain,
            single: async () =>
              state.insertError
                ? { data: null, error: state.insertError }
                : { data: row, error: null },
          }
          return chain
        },
        update: (payload: any) => {
          updateCalls.push(payload)
          state.updatedRow = {
            ...(state.insertedRow || {
              id: 'call-1',
              organization_id: 'org-a',
              logged_by: 'user-1',
              occurred_at: '2026-08-15T12:00:00.000Z',
              created_at: '2026-08-15T12:00:00.000Z',
              updated_at: '2026-08-15T12:00:00.000Z',
              direction: 'outbound',
              phone_raw: '7605551212',
              phone_normalized: '7605551212',
              hunter_lead_id: null,
              portal_request_id: null,
              client_id: null,
              hunter_tenant_id: null,
              notes: null,
            }),
            ...payload,
          }
          const chain: any = {
            eq: () => chain,
            select: () => chain,
            single: async () => ({ data: state.updatedRow, error: null }),
          }
          return chain
        },
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: async () => ({ data: [], error: null }),
      }
      return query
    }

    throw new Error(`unexpected table ${table}`)
  }

  return {
    supabase: {
      auth: {
        getUser: async () => ({
          data: { user: state.user },
          error: null,
        }),
      },
      rpc: async (name: string) => {
        if (name !== 'user_org_id') {
          return { data: null, error: { message: 'unknown rpc' } }
        }
        return { data: state.orgId, error: state.orgId ? null : { message: 'no org' } }
      },
      from,
    },
  }
})

vi.mock('@/services/hunter/resolveHunterTenantId', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/hunter/resolveHunterTenantId')
  >('@/services/hunter/resolveHunterTenantId')
  return {
    ...actual,
    resolveHunterTenantId: async () => {
      if (!state.mappedTenantId) {
        throw new actual.HunterTenantAuthorityError('hunter_tenant_unmapped')
      }
      if (!state.user?.id || !state.memberships.has(state.mappedTenantId)) {
        throw new actual.HunterTenantAuthorityError(
          'hunter_tenant_membership_missing',
        )
      }
      return state.mappedTenantId
    },
    resolveHunterTenantIdOrNull: async () => {
      try {
        if (!state.mappedTenantId) return null
        if (!state.user?.id || !state.memberships.has(state.mappedTenantId)) {
          return null
        }
        return state.mappedTenantId
      } catch {
        return null
      }
    },
  }
})

beforeEach(() => {
  insertCalls.length = 0
  updateCalls.length = 0
  fromTables.length = 0
  state.user = { id: 'user-1' }
  state.orgId = 'org-a'
  state.mappedTenantId = 'tenant-mapped'
  state.memberships = new Set(['tenant-mapped'])
  state.insertError = null
  state.portalRows = []
  state.clientRows = []
  state.leadRows = []
  state.insertedRow = null
  state.updatedRow = null
  vi.resetModules()
})

describe('LEAD-SRC-3B phone normalization', () => {
  it('1. (760) 555-1212 → 7605551212', async () => {
    const { normalizePhone } = await import('@/services/calls/phoneNormalize')
    expect(normalizePhone('(760) 555-1212')).toBe('7605551212')
  })

  it('2. +1 760-555-1212 → 7605551212', async () => {
    const { normalizePhone } = await import('@/services/calls/phoneNormalize')
    expect(normalizePhone('+1 760-555-1212')).toBe('7605551212')
  })

  it('3. malformed/short number does not produce a match key', async () => {
    const { normalizePhone } = await import('@/services/calls/phoneNormalize')
    expect(normalizePhone('555-12')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('LEAD-SRC-3B entity matching', () => {
  it('4. exact single entity match works', async () => {
    const { matchEntitiesByNormalizedPhone } = await import(
      '@/services/calls/matchCallEntities'
    )
    const result = matchEntitiesByNormalizedPhone('(760) 555-1212', [
      {
        kind: 'hunter_lead',
        id: 'lead-1',
        label: 'Acme',
        phoneRaw: '760-555-1212',
      },
    ])
    expect(result).toEqual({
      status: 'single',
      match: {
        kind: 'hunter_lead',
        id: 'lead-1',
        label: 'Acme',
        phoneNormalized: '7605551212',
      },
    })
  })

  it('5. duplicate normalized matches do not auto-link', async () => {
    const { matchEntitiesByNormalizedPhone, linksFromMatchResult } =
      await import('@/services/calls/matchCallEntities')
    const result = matchEntitiesByNormalizedPhone('7605551212', [
      {
        kind: 'hunter_lead',
        id: 'lead-1',
        label: 'A',
        phoneRaw: '(760) 555-1212',
      },
      {
        kind: 'client',
        id: 'client-1',
        label: 'B',
        phoneRaw: '+1 760 555 1212',
      },
    ])
    expect(result.status).toBe('ambiguous')
    expect(linksFromMatchResult(result)).toEqual({})
  })

  it('3b. substring/includes is not used for matching', async () => {
    const { matchEntitiesByNormalizedPhone } = await import(
      '@/services/calls/matchCallEntities'
    )
    const result = matchEntitiesByNormalizedPhone('555', [
      {
        kind: 'client',
        id: 'c1',
        label: 'X',
        phoneRaw: '7605551212',
      },
    ])
    expect(result.status).toBe('none')
  })
})

describe('LEAD-SRC-3B call log service', () => {
  it('6. call log requires organization authority', async () => {
    state.orgId = null
    const { createCallLog, CallLogAuthorityError } = await import(
      '@/services/calls/callLogService'
    )
    await expect(
      createCallLog({
        phoneRaw: '7605551212',
        direction: 'inbound',
      }),
    ).rejects.toBeInstanceOf(CallLogAuthorityError)
  })

  it('7. Hunter-linked call uses mapped Hunter tenant authority', async () => {
    const { createCallLog } = await import('@/services/calls/callLogService')
    const log = await createCallLog({
      phoneRaw: '(760) 555-1212',
      direction: 'outbound',
      hunterLeadId: 'lead-99',
      requireHunterTenant: true,
    })
    expect(insertCalls[0].hunter_tenant_id).toBe('tenant-mapped')
    expect(insertCalls[0].hunter_lead_id).toBe('lead-99')
    expect(log.hunterTenantId).toBe('tenant-mapped')
  })

  it('8. no user_tenants LIMIT 1 fallback in call services', () => {
    const service = readFileSync(
      resolve(process.cwd(), 'src/services/calls/callLogService.ts'),
      'utf8',
    )
    const resolver = readFileSync(
      resolve(process.cwd(), 'src/services/hunter/resolveHunterTenantId.ts'),
      'utf8',
    )
    expect(service).not.toMatch(/limit\s*\(\s*1\s*\)/i)
    expect(service).toContain('resolveHunterTenantId')
    expect(resolver).not.toMatch(/limit\s*\(\s*1\s*\)/i)
  })

  it('9. outbound log defaults direction=outbound outcome=unknown classification=unclassified (no auto tel:)', async () => {
    const { initiateHunterOutboundCall } = await import(
      '@/services/calls/callLogService'
    )
    const opened: string[] = []
    const result = await initiateHunterOutboundCall({
      leadId: 'lead-1',
      phone: '(760) 555-1212',
      openHref: (href) => opened.push(href),
    })
    expect(result.dialerOpened).toBe(false)
    expect(opened).toEqual([])
    expect(insertCalls[0].direction).toBe('outbound')
    expect(insertCalls[0].outcome).toBe('unknown')
    expect(insertCalls[0].classification).toBe('unclassified')
    expect(result.callLog?.direction).toBe('outbound')
  })

  it('10. Open Dialer (openDialer=true) invokes tel: and still creates/retains call record', async () => {
    const { initiateHunterOutboundCall } = await import(
      '@/services/calls/callLogService'
    )
    const opened: string[] = []
    const result = await initiateHunterOutboundCall({
      leadId: 'lead-1',
      phone: '7605551212',
      openDialer: true,
      openHref: (href) => opened.push(href),
    })
    expect(opened).toEqual(['tel:7605551212'])
    expect(result.dialerOpened).toBe(true)
    expect(result.callLog).not.toBeNull()
    expect(insertCalls[0].direction).toBe('outbound')
    expect(insertCalls[0].outcome).toBe('unknown')
    expect(insertCalls[0].classification).toBe('unclassified')
  })

  it('10b. Open Dialer still invokes tel: even if logging fails', async () => {
    state.insertError = { message: 'insert blocked' }
    const { initiateHunterOutboundCall } = await import(
      '@/services/calls/callLogService'
    )
    const opened: string[] = []
    const result = await initiateHunterOutboundCall({
      leadId: 'lead-1',
      phone: '7605551212',
      openDialer: true,
      openHref: (href) => opened.push(href),
    })
    expect(opened).toEqual(['tel:7605551212'])
    expect(result.dialerOpened).toBe(true)
    expect(result.callLog).toBeNull()
    expect(result.logError).toContain('insert blocked')
  })

  it('11. classification spam affects call only', async () => {
    const { updateCallLogClassification } = await import(
      '@/services/calls/callLogService'
    )
    const updated = await updateCallLogClassification({
      callLogId: 'call-1',
      classification: 'spam',
    })
    expect(updateCalls[0]).toEqual({ classification: 'spam' })
    expect(updated.classification).toBe('spam')
    expect(fromTables).not.toContain('hunter_leads')
    expect(fromTables.filter((t) => t === 'portal_requests').length).toBe(0)
  })

  it('12. classification existing_customer affects call only', async () => {
    const { updateCallLogClassification } = await import(
      '@/services/calls/callLogService'
    )
    await updateCallLogClassification({
      callLogId: 'call-1',
      classification: 'existing_customer',
      outcome: 'answered',
    })
    expect(updateCalls[0]).toEqual({
      classification: 'existing_customer',
      outcome: 'answered',
    })
    expect(fromTables).not.toContain('clients')
  })

  it('13. manual inbound call works', async () => {
    const { createCallLog } = await import('@/services/calls/callLogService')
    const log = await createCallLog({
      phoneRaw: '7605559999',
      direction: 'inbound',
      classification: 'spam',
      outcome: 'missed',
      notes: 'robocall',
    })
    expect(insertCalls[0].direction).toBe('inbound')
    expect(insertCalls[0].classification).toBe('spam')
    expect(insertCalls[0].outcome).toBe('missed')
    expect(log.notes).toBe('robocall')
  })
})

describe('LEAD-SRC-3B migration / boundary contracts', () => {
  it('14. cross-org call log access denied by RLS policy contract', () => {
    const sql = readMigration()
    expect(sql).toContain('organization_id = public.user_org_id()')
    expect(sql).toContain('public.is_org_admin_for(organization_id)')
    expect(sql).toContain('call_logs_owner_admin_select')
    expect(sql).toContain('logged_by = auth.uid()')
  })

  it('15. phone is not sent to pilot telemetry', () => {
    const service = readFileSync(
      resolve(process.cwd(), 'src/services/calls/callLogService.ts'),
      'utf8',
    )
    const panel = readFileSync(
      resolve(process.cwd(), 'src/components/hunter/HunterPanel.tsx'),
      'utf8',
    )
    expect(service).not.toMatch(/pilotTelemetry|pilot_telemetry/i)
    expect(panel).not.toMatch(/pilotTelemetry|reportPilot/i)
  })

  it('16. no historical-backfill behavior exists', () => {
    const sql = readMigration()
    const service = readFileSync(
      resolve(process.cwd(), 'src/services/calls/callLogService.ts'),
      'utf8',
    )
    expect(sql).not.toMatch(/INSERT INTO public\.call_logs[\s\S]*SELECT/i)
    expect(sql.toLowerCase()).toContain('prospective only')
    expect(service).not.toMatch(/backfill|contactLog|inbound_calls/i)
  })

  it('17. no fake Marketing calls imported', () => {
    const service = readFileSync(
      resolve(process.cwd(), 'src/services/calls/callLogService.ts'),
      'utf8',
    )
    const panel = readFileSync(
      resolve(process.cwd(), 'src/components/hunter/HunterPanel.tsx'),
      'utf8',
    )
    const liveCall = readFileSync(
      resolve(process.cwd(), 'src/components/salesIntel/tabs/LiveCallTab.tsx'),
      'utf8',
    )
    const recent = readFileSync(
      resolve(process.cwd(), 'src/components/hunter/RecentCallsPanel.tsx'),
      'utf8',
    )
    expect(service).not.toContain('MarketingIntegration')
    expect(service).not.toContain('callTrackingService')
    expect(service).not.toContain('inbound_calls')
    expect(panel).not.toContain('callTrackingService')
    expect(panel).not.toContain('MarketingIntegration')
    expect(liveCall).not.toContain('callTrackingService')
    expect(liveCall).not.toContain('MarketingIntegration')
    expect(recent).not.toContain('callTrackingService')
    expect(recent).not.toContain('estimate_scheduled')
  })

  it('migration defines required enums and entity FKs', () => {
    const sql = readMigration()
    expect(sql).toContain("CHECK (direction IN ('inbound', 'outbound'))")
    expect(sql).toContain("'unknown', 'answered', 'missed', 'no_answer', 'voicemail'")
    expect(sql).toContain("'unclassified', 'new_lead', 'existing_customer'")
    expect(sql).toContain('REFERENCES public.hunter_leads(id)')
    expect(sql).toContain('REFERENCES public.portal_requests(id)')
    expect(sql).toContain('REFERENCES public.clients(id)')
    expect(sql).not.toMatch(/ADD COLUMN[\s\S]*source_category/i)
    expect(sql).not.toMatch(/\bsource_category\s+TEXT\b/i)
  })

  it('LEAD-SRC-3D1: logged_by nullable + ON DELETE SET NULL; INSERT still requires auth.uid()', () => {
    const sql = readMigration()
    // Column nullable at rest (no NOT NULL) so logger deletion retains the row.
    expect(sql).toMatch(
      /logged_by\s+UUID\s+REFERENCES\s+auth\.users\(id\)\s+ON DELETE SET NULL/,
    )
    expect(sql).not.toMatch(
      /logged_by\s+UUID\s+NOT NULL\s+REFERENCES\s+auth\.users/,
    )
    expect(sql).not.toMatch(
      /logged_by[\s\S]{0,80}ON DELETE CASCADE/,
    )
    // New inserts still require authenticated attribution.
    expect(sql).toContain('logged_by = auth.uid()')
    expect(sql).toMatch(
      /call_logs_owner_admin_insert[\s\S]*?logged_by = auth\.uid\(\)/,
    )
    // Org teardown may still cascade; entity/tenant FKs unchanged.
    expect(sql).toContain(
      'organization_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE',
    )
    expect(sql).toContain(
      'hunter_tenant_id   UUID REFERENCES public.tenants(id) ON DELETE SET NULL',
    )
    expect(sql).toContain(
      'hunter_lead_id     UUID REFERENCES public.hunter_leads(id) ON DELETE SET NULL',
    )
  })

  it('Hunter Call opens outbound PowerOn log workflow; does not auto-invoke tel:', () => {
    const panel = readFileSync(
      resolve(process.cwd(), 'src/components/hunter/HunterPanel.tsx'),
      'utf8',
    )
    const modal = readFileSync(
      resolve(process.cwd(), 'src/components/hunter/CallLogModal.tsx'),
      'utf8',
    )
    expect(panel).toContain('handleCallLead')
    expect(panel).toContain('onCall={handleCallLead}')
    expect(panel).toContain('CallLogModal')
    expect(panel).toContain('showOptionalDialer')
    expect(panel).toContain('defaultDirection="outbound"')
    expect(panel).toContain('defaultHunterLeadId={callModalLead?.id ?? null}')
    expect(panel).not.toContain('initiateHunterOutboundCall')
    expect(panel).not.toContain('openTelDialer')
    expect(panel).not.toContain('tel:')
    // Header "+ Log Call" must not exist; Add Lead may still use Plus.
    expect(panel).not.toMatch(/>\s*Log Call\s*</)
    expect(panel).not.toContain('RecentCallsPanel')

    expect(modal).toContain("'Log Call'")
    expect(modal).toContain('Open Dialer')
    expect(modal).toContain('data-testid="call-log-save-only"')
    expect(modal).toContain('data-testid="call-log-open-dialer"')
    expect(modal).toContain('openTelDialer(phoneForDial)')
    expect(modal).toContain('dialerDigits')
    // Log Call path must not call openTelDialer
    const logFnStart = modal.indexOf('const handleLogCall')
    const dialerFnStart = modal.indexOf('const handleOpenDialer')
    expect(logFnStart).toBeGreaterThan(-1)
    expect(dialerFnStart).toBeGreaterThan(logFnStart)
    const logFn = modal.slice(logFnStart, dialerFnStart)
    expect(logFn).not.toContain('openTelDialer')
    // Saved call Open Dialer must not create; Open Dialer never saves (COACH-LINK-3A)
    const dialerFn = modal.slice(dialerFnStart)
    expect(dialerFn).toContain('openTelDialer(phoneForDial)')
    expect(dialerFn).not.toContain('saveCreateLog')
    expect(dialerFn).not.toContain('createCallLog')
    expect(modal).toMatch(/Open Dialer never creates a call_log|never creates call_log/)
  })
})
