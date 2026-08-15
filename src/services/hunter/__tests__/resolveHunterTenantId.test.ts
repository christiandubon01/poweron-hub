/**
 * LEAD-SRC-2F — organizations.hunter_tenant_id migration + resolver authority.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATION_PATH = 'supabase/migrations/126_organization_hunter_tenant_authority.sql'

function readMigration(): string {
  return readFileSync(resolve(process.cwd(), MIGRATION_PATH), 'utf8')
}

const state = {
  user: { id: 'user-1' } as { id: string } | null,
  orgId: 'org-a' as string | null,
  mappedTenantId: 'tenant-mapped' as string | null,
  memberships: new Set<string>(['tenant-mapped', 'tenant-other']),
}

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
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

describe('LEAD-SRC-2F migration 126 contract', () => {
  const sql = () => readMigration()

  it('adds organizations.hunter_tenant_id UUID FK to tenants ON DELETE SET NULL', () => {
    const text = sql()
    expect(text).toContain('ADD COLUMN IF NOT EXISTS hunter_tenant_id uuid')
    expect(text).toContain('organizations_hunter_tenant_id_fkey')
    expect(text).toContain('REFERENCES public.tenants(id)')
    expect(text).toContain('ON DELETE SET NULL')
  })

  it('enforces non-null mapping uniqueness with partial unique index', () => {
    const text = sql()
    expect(text).toContain('organizations_hunter_tenant_id_uidx')
    expect(text).toContain('ON public.organizations (hunter_tenant_id)')
    expect(text).toContain('WHERE hunter_tenant_id IS NOT NULL')
  })

  it('backfills only from portal_requests → hunter_leads relational evidence', () => {
    const text = sql()
    expect(text).toContain('portal_requests pr')
    expect(text).toContain('hunter_leads hl')
    expect(text).toContain('hl.id = pr.hunter_lead_id')
    expect(text).toContain('otc.tenant_count = 1')
    expect(text).toContain('toc.org_count = 1')
  })

  it('does not infer using owner_id / owner_user_id / email / LIMIT 1 / settings copy', () => {
    const executable = sql().split('BEGIN;')[1] ?? sql()
    expect(executable).not.toMatch(/\bowner_id\b/)
    expect(executable).not.toMatch(/\bowner_user_id\b/)
    expect(executable).not.toMatch(/\bemail\b/i)
    expect(executable).not.toMatch(/LIMIT\s+1/i)
    expect(executable).not.toContain('tenant_settings')
    expect(executable).not.toContain('INSERT INTO public.user_tenants')
  })

  it('postconditions reject ambiguous org multi-tenant auto-maps', () => {
    const text = sql()
    expect(text).toContain('ambiguous org(s) were auto-mapped')
    expect(text).toContain('mapped to historically shared tenant(s)')
  })

  it('1. org A ↔ tenant X exclusive evidence is eligible (both counts = 1)', () => {
    expect(sql()).toContain('otc.tenant_count = 1')
    expect(sql()).toContain('toc.org_count = 1')
  })

  it('2. org with tenants X and Y remains unmapped (requires tenant_count = 1)', () => {
    expect(sql()).toContain('otc.tenant_count = 1')
  })

  it('3. tenant X shared by org A and B remains unmapped (requires org_count = 1)', () => {
    expect(sql()).toContain('toc.org_count = 1')
  })

  it('4. org with no converted leads is excluded from evidence', () => {
    expect(sql()).toContain('pr.hunter_lead_id IS NOT NULL')
  })
})

describe('LEAD-SRC-2F resolveHunterTenantId', () => {
  beforeEach(() => {
    state.user = { id: 'user-1' }
    state.orgId = 'org-a'
    state.mappedTenantId = 'tenant-mapped'
    state.memberships = new Set(['tenant-mapped', 'tenant-other'])
  })

  it('8. mapped active org + valid membership → exact tenant', async () => {
    const { resolveHunterTenantId } = await import(
      '@/services/hunter/resolveHunterTenantId'
    )
    await expect(resolveHunterTenantId()).resolves.toBe('tenant-mapped')
  })

  it('9. multiple unrelated user_tenants memberships → mapped tenant wins', async () => {
    state.memberships = new Set(['tenant-other', 'tenant-mapped', 'tenant-z'])
    const { resolveHunterTenantId } = await import(
      '@/services/hunter/resolveHunterTenantId'
    )
    await expect(resolveHunterTenantId()).resolves.toBe('tenant-mapped')
  })

  it('10. unmapped org → hunter_tenant_unmapped', async () => {
    state.mappedTenantId = null
    const { resolveHunterTenantId, HunterTenantAuthorityError } = await import(
      '@/services/hunter/resolveHunterTenantId'
    )
    await expect(resolveHunterTenantId()).rejects.toMatchObject({
      code: 'hunter_tenant_unmapped',
    })
    await expect(resolveHunterTenantId()).rejects.toBeInstanceOf(
      HunterTenantAuthorityError
    )
  })

  it('11. mapped tenant but missing membership → hunter_tenant_membership_missing', async () => {
    state.memberships = new Set(['tenant-other'])
    const { resolveHunterTenantId } = await import(
      '@/services/hunter/resolveHunterTenantId'
    )
    await expect(resolveHunterTenantId()).rejects.toMatchObject({
      code: 'hunter_tenant_membership_missing',
    })
  })

  it('12. admin with valid mapped membership works', async () => {
    state.user = { id: 'admin-1' }
    state.memberships = new Set(['tenant-mapped'])
    const { resolveHunterTenantId } = await import(
      '@/services/hunter/resolveHunterTenantId'
    )
    await expect(resolveHunterTenantId()).resolves.toBe('tenant-mapped')
  })

  it('13. admin without membership fails', async () => {
    state.user = { id: 'admin-2' }
    state.memberships = new Set()
    const { resolveHunterTenantId } = await import(
      '@/services/hunter/resolveHunterTenantId'
    )
    await expect(resolveHunterTenantId()).rejects.toMatchObject({
      code: 'hunter_tenant_membership_missing',
    })
  })

  it('14. user cannot use another org mapped tenant without membership', async () => {
    state.mappedTenantId = 'tenant-foreign'
    state.memberships = new Set(['tenant-mapped'])
    const { resolveHunterTenantId } = await import(
      '@/services/hunter/resolveHunterTenantId'
    )
    await expect(resolveHunterTenantId()).rejects.toMatchObject({
      code: 'hunter_tenant_membership_missing',
    })
  })

  it('15. shared resolver source has no LIMIT 1 fallback', async () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/services/hunter/resolveHunterTenantId.ts'),
      'utf8'
    )
    expect(src).not.toMatch(/limit\s*\(\s*1\s*\)/i)
    expect(src).toContain('hunter_tenant_id')
    expect(src).toMatch(/rpc\(\s*['\"]user_org_id['\"]\s*\)/)
    expect(src).toContain(".eq('tenant_id', mappedTenantId)")
  })
})
