/**
 * LEAD-SRC-2B/2F — owner job value profiles + portal conversion without fabrication.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('@/services/hunter/resolveHunterTenantId', () => {
  class HunterTenantAuthorityError extends Error {
    code: string
    constructor(code: string, message?: string) {
      super(message ?? code)
      this.name = 'HunterTenantAuthorityError'
      this.code = code
    }
  }
  return {
    HunterTenantAuthorityError,
    isHunterTenantAuthorityError: (err: unknown) =>
      !!err &&
      typeof err === 'object' &&
      (err as any).name === 'HunterTenantAuthorityError',
    resolveHunterTenantId: async () => {
      const { supabase } = await import('@/lib/supabase')
      const tid = (supabase as any).__state?.tenantId as string | null
      if (!tid) throw new HunterTenantAuthorityError('hunter_tenant_unmapped')
      return tid
    },
    resolveHunterTenantIdOrNull: async () => {
      const { supabase } = await import('@/lib/supabase')
      return ((supabase as any).__state?.tenantId as string | null) ?? null
    },
  }
})

vi.mock('@/lib/supabase', () => {
  const state = {
    user: { id: 'user-1' } as { id: string } | null,
    tenantId: 'tenant-a' as string | null,
    rows: new Map<string, { tenant_id: string; setting_key: string; setting_value: unknown }>(),
  }

  const from = (table: string) => {
    if (table === 'tenant_settings') {
      return {
        select: () => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              maybeSingle: async () => {
                const key = `${val1}::${val2}`
                const row = state.rows.get(key)
                return { data: row ? { setting_value: row.setting_value } : null, error: null }
              },
            }),
          }),
        }),
        upsert: async (
          payload: {
            tenant_id: string
            setting_key: string
            setting_value: unknown
            updated_by: string
          },
          _opts?: unknown
        ) => {
          if (payload.tenant_id !== state.tenantId) {
            return { error: { message: 'cross-tenant write denied' } }
          }
          const key = `${payload.tenant_id}::${payload.setting_key}`
          state.rows.set(key, {
            tenant_id: payload.tenant_id,
            setting_key: payload.setting_key,
            setting_value: payload.setting_value,
          })
          return { error: null }
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  }

  return {
    supabase: {
      auth: {
        getUser: async () => ({ data: { user: state.user } }),
      },
      from,
      __state: state,
    },
  }
})

import { supabase } from '@/lib/supabase'
import {
  LEAD_VALUE_PROFILES_SETTING_KEY,
  deleteLeadValueProfile,
  estimatedValueFromProfile,
  getCurrentTenantIdForProfiles,
  loadLeadValueProfiles,
  matchLeadValueProfile,
  resolvePortalLeadEstimatedValue,
  saveLeadValueProfiles,
  upsertLeadValueProfile,
  validateLeadValueProfile,
} from '@/services/portal/leadValueProfiles'
import {
  resolveHunterPanelValueRange,
  sumKnownLeadEstimatedValues,
} from '@/services/hunter/hunterLeadValueDisplay'

const mockState = (supabase as any).__state as {
  user: { id: string } | null
  tenantId: string | null
  rows: Map<string, { tenant_id: string; setting_key: string; setting_value: unknown }>
}

describe('LEAD-SRC-2B lead value profiles', () => {
  beforeEach(() => {
    mockState.user = { id: 'user-1' }
    mockState.tenantId = 'tenant-a'
    mockState.rows.clear()
  })

  it('add persists under lead_value_profiles_v1 for the active tenant', async () => {
    const next = upsertLeadValueProfile([], {
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 500,
      maxValue: 800,
    })
    const saved = await saveLeadValueProfiles('tenant-a', 'user-1', next)
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('EV Charger')

    const loaded = await loadLeadValueProfiles('tenant-a')
    expect(loaded).toEqual(saved)
    expect(
      mockState.rows.get(`tenant-a::${LEAD_VALUE_PROFILES_SETTING_KEY}`)?.setting_value
    ).toMatchObject({ version: 1, profiles: saved })
  })

  it('edit persists updated ranges', async () => {
    const created = upsertLeadValueProfile([], {
      name: 'Panel Upgrade',
      serviceCategory: 'panel_upgrade',
      minValue: 4500,
      maxValue: 6000,
    })
    await saveLeadValueProfiles('tenant-a', 'user-1', created)

    const edited = upsertLeadValueProfile(created, {
      id: created[0].id,
      name: 'Panel Upgrade',
      serviceCategory: 'panel_upgrade',
      minValue: 5000,
      maxValue: 7000,
    })
    await saveLeadValueProfiles('tenant-a', 'user-1', edited)

    const loaded = await loadLeadValueProfiles('tenant-a')
    expect(loaded[0].minValue).toBe(5000)
    expect(loaded[0].maxValue).toBe(7000)
  })

  it('delete persists removal', async () => {
    const created = upsertLeadValueProfile([], {
      name: 'Troubleshoot',
      serviceCategory: 'maintenance',
      minValue: 150,
      maxValue: 300,
    })
    await saveLeadValueProfiles('tenant-a', 'user-1', created)
    const removed = deleteLeadValueProfile(created, created[0].id)
    await saveLeadValueProfiles('tenant-a', 'user-1', removed)
    expect(await loadLeadValueProfiles('tenant-a')).toEqual([])
  })

  it('org/tenant scoping prevents cross-tenant use', async () => {
    const created = upsertLeadValueProfile([], {
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 500,
      maxValue: 800,
    })
    await saveLeadValueProfiles('tenant-a', 'user-1', created)

    // Tenant B has no row and cannot read A's profiles.
    mockState.tenantId = 'tenant-b'
    expect(await loadLeadValueProfiles('tenant-b')).toEqual([])

    await expect(
      saveLeadValueProfiles('tenant-a', 'user-1', created)
    ).rejects.toThrow(/cross-tenant/i)
  })

  it('rejects invalid min/max', () => {
    expect(() =>
      validateLeadValueProfile({
        name: 'Bad',
        serviceCategory: 'ev_charger',
        minValue: -1,
        maxValue: 100,
      })
    ).toThrow(/greater than or equal to 0/i)

    expect(() =>
      validateLeadValueProfile({
        name: 'Bad',
        serviceCategory: 'ev_charger',
        minValue: 800,
        maxValue: 500,
      })
    ).toThrow(/maximum value must be greater/i)
  })

  it('rejects ambiguous duplicate service-category mappings', () => {
    const existing = upsertLeadValueProfile([], {
      name: 'EV A',
      serviceCategory: 'ev_charger',
      minValue: 500,
      maxValue: 800,
    })
    expect(() =>
      upsertLeadValueProfile(existing, {
        name: 'EV B',
        serviceCategory: 'ev_charger',
        minValue: 600,
        maxValue: 900,
      })
    ).toThrow(/already maps to service category/i)
  })
})

describe('LEAD-SRC-2B portal conversion estimated_value', () => {
  it('configured EV 500–800 → 650', () => {
    const profile = validateLeadValueProfile({
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 500,
      maxValue: 800,
    })
    expect(estimatedValueFromProfile(matchLeadValueProfile([profile], 'ev_charger'))).toBe(650)
  })

  it('configured Panel 4500–6000 → 5250', () => {
    const profile = validateLeadValueProfile({
      name: 'Panel Upgrade',
      serviceCategory: 'panel_upgrade',
      minValue: 4500,
      maxValue: 6000,
    })
    expect(estimatedValueFromProfile(matchLeadValueProfile([profile], 'panel_upgrade'))).toBe(5250)
  })

  it('no profile → null', () => {
    expect(estimatedValueFromProfile(matchLeadValueProfile([], 'ev_charger'))).toBeNull()
  })

  it('unknown category → null', () => {
    const profile = validateLeadValueProfile({
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 500,
      maxValue: 800,
    })
    expect(
      estimatedValueFromProfile(matchLeadValueProfile([profile], 'not_a_real_category'))
    ).toBeNull()
  })

  it('no old hardcoded residential/other defaults remain in portalService', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/portal/portalService.ts'),
      'utf8'
    )
    expect(src).not.toContain('VALUE_RANGE_MAP')
    expect(src).not.toMatch(/min:\s*1500,\s*max:\s*6000/)
    expect(src).not.toMatch(/min:\s*2000,\s*max:\s*8000/)
    expect(src).toContain('resolvePortalLeadEstimatedValue')
  })
})

describe('LEAD-SRC-2B downstream null-safe display', () => {
  const workClassEstimates = {
    'panel upgrade': { min: 3500, max: 8000 },
  }

  it('null portal estimated value does not fabricate pipeline dollars or WORK_CLASS fallback', () => {
    expect(
      resolveHunterPanelValueRange({
        estimatedValue: null,
        source: 'customer_portal',
        sourceTag: 'customer_portal',
        workClassCode: 'panel upgrade',
        workClassEstimates,
      })
    ).toBeUndefined()

    expect(
      sumKnownLeadEstimatedValues([
        { estimated_value: null, status: 'new' },
        { estimated_value: 650, status: 'new' },
        { estimated_value: undefined, status: 'new' },
      ])
    ).toBe(650)
  })

  it('null value does not fabricate estimate prefill contract/value band', () => {
    const leadEstimatedValue: number | null = null
    const estValue =
      typeof leadEstimatedValue === 'number' &&
      Number.isFinite(leadEstimatedValue) &&
      leadEstimatedValue > 0
        ? leadEstimatedValue
        : null
    const prefill = {
      ...(estValue != null ? { contract: estValue } : {}),
      hunterContext: {
        value_min: estValue != null ? Math.round(estValue * 0.85) : undefined,
        value_max: estValue != null ? Math.round(estValue * 1.15) : undefined,
      },
    }
    expect(prefill).not.toHaveProperty('contract')
    expect(prefill.hunterContext.value_min).toBeUndefined()
    expect(prefill.hunterContext.value_max).toBeUndefined()
  })

  it('configured value still flows through Hunter display range', () => {
    expect(
      resolveHunterPanelValueRange({
        estimatedValue: 650,
        source: 'customer_portal',
        sourceTag: 'customer_portal',
        workClassEstimates,
      })
    ).toEqual({
      min: Math.round(650 * 0.85),
      max: Math.round(650 * 1.15),
    })
  })

  it('non-portal leads may still use WORK_CLASS estimates when value unset', () => {
    expect(
      resolveHunterPanelValueRange({
        estimatedValue: null,
        source: 'tlma',
        workClassCode: 'panel upgrade',
        workClassEstimates,
      })
    ).toEqual({ min: 3500, max: 8000 })
  })
})

describe('LEAD-SRC-2B conversion receipt nullability unchanged', () => {
  it('leadEstimatedValue stays nullable and convertedValue stays separate', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/features/sales-intelligence/conversion-receipts/conversionReceiptService.ts'
      ),
      'utf8'
    )
    expect(src).toContain('leadEstimatedValue: toNumberOrNull(lead.estimated_value')
    expect(src).toContain('convertedValue: params.convertedValue ?? null')
    expect(src).toContain('lead_estimated_value: draft.leadEstimatedValue ?? null')
    expect(src).toContain('converted_value: draft.convertedValue ?? null')
  })
})

describe('LEAD-SRC-2F shared tenant authority for profiles + conversion', () => {
  beforeEach(() => {
    mockState.user = { id: 'user-1' }
    mockState.tenantId = 'tenant-mapped'
    mockState.rows.clear()
  })

  it('16. Settings and convert use the same shared resolver module', () => {
    const profilesSrc = readFileSync(
      resolve(process.cwd(), 'src/services/portal/leadValueProfiles.ts'),
      'utf8'
    )
    const portalSrc = readFileSync(
      resolve(process.cwd(), 'src/services/portal/portalService.ts'),
      'utf8'
    )
    expect(profilesSrc).toContain('resolveHunterTenantId')
    expect(portalSrc).toContain('resolveHunterTenantId')
    expect(profilesSrc).not.toMatch(/from\('user_tenants'\)[\s\S]{0,120}limit\(1\)/)
    expect(portalSrc).not.toMatch(/from\('user_tenants'\)[\s\S]{0,120}limit\(1\)/)
  })

  it('17. EV profile 450–900 on mapped tenant → estimated_value 675', async () => {
    const profiles = upsertLeadValueProfile([], {
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 450,
      maxValue: 900,
    })
    await saveLeadValueProfiles('tenant-mapped', 'user-1', profiles)
    const value = await resolvePortalLeadEstimatedValue({
      tenantId: 'tenant-mapped',
      serviceCategory: 'ev_charger',
    })
    expect(value).toBe(675)
    expect(await getCurrentTenantIdForProfiles()).toBe('tenant-mapped')
  })

  it('18. unmatched category → null', async () => {
    const profiles = upsertLeadValueProfile([], {
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 450,
      maxValue: 900,
    })
    await saveLeadValueProfiles('tenant-mapped', 'user-1', profiles)
    await expect(
      resolvePortalLeadEstimatedValue({
        tenantId: 'tenant-mapped',
        serviceCategory: 'panel_upgrade',
      })
    ).resolves.toBeNull()
  })

  it('19. lead insert path stamps the same mapped tenant used for profile load', () => {
    const portalSrc = readFileSync(
      resolve(process.cwd(), 'src/services/portal/portalService.ts'),
      'utf8'
    )
    expect(portalSrc).toContain('tenantId = await resolveHunterTenantId()')
    expect(portalSrc).toContain('tenant_id:        tenantId')
    expect(portalSrc).toContain('resolvePortalLeadEstimatedValue({')
    expect(portalSrc).toContain('tenantId,')
    expect(portalSrc).toContain('serviceCategory: request.service_category')
  })

  it('20. multiple user_tenants rows cannot diverge Settings vs convert (shared resolver only)', () => {
    const resolverSrc = readFileSync(
      resolve(process.cwd(), 'src/services/hunter/resolveHunterTenantId.ts'),
      'utf8'
    )
    expect(resolverSrc).not.toMatch(/limit\s*\(\s*1\s*\)/i)
    expect(resolverSrc).toContain('.eq(\'tenant_id\', mappedTenantId)')
  })

  it('21. existing profile JSON format remains compatible', async () => {
    const profiles = upsertLeadValueProfile([], {
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 450,
      maxValue: 900,
    })
    await saveLeadValueProfiles('tenant-mapped', 'user-1', profiles)
    const raw = mockState.rows.get(
      `tenant-mapped::${LEAD_VALUE_PROFILES_SETTING_KEY}`
    )?.setting_value as { version: number; profiles: unknown[] }
    expect(raw.version).toBe(1)
    expect(raw.profiles[0]).toMatchObject({
      name: 'EV Charger',
      serviceCategory: 'ev_charger',
      minValue: 450,
      maxValue: 900,
    })
    await expect(loadLeadValueProfiles('tenant-mapped')).resolves.toEqual(profiles)
  })

  it('22. no historical lead/profile rewrite path added', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'supabase/migrations/126_organization_hunter_tenant_authority.sql'
      ),
      'utf8'
    )
    expect(migration).not.toContain('UPDATE public.hunter_leads')
    expect(migration).not.toContain('UPDATE public.tenant_settings')
    expect(migration).not.toContain('lead_value_profiles_v1')
    expect(migration).not.toContain('INSERT INTO public.user_tenants')
  })
})
