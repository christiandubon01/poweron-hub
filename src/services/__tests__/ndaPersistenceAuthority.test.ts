import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  signedRows: [] as Array<Record<string, unknown>>,
  profileRow: null as null | Record<string, unknown>,
  organizationRow: null as null | Record<string, unknown>,
  overrideRow: null as null | Record<string, unknown>,
  agreementReadError: null as null | { message: string; code?: string },
  authorityReadError: null as null | { message: string; code?: string },
  insertError: null as null | { message: string },
  insertCalls: 0,
  selectArgs: [] as Array<string>,
  authUser: {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-05T03:40:15.434857Z',
    last_sign_in_at: '2026-08-14T04:51:41.694269Z',
  } as Record<string, unknown>,
}))

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: any = {
      insert: vi.fn(() => { deps.insertCalls += 1; return builder }),
      select: vi.fn((columns?: string) => {
        deps.selectArgs.push(`${table}:${columns ?? '*'}`)
        return builder
      }),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => ({
        data: table === 'signed_agreements' ? deps.signedRows : [],
        error: table === 'signed_agreements' ? deps.agreementReadError : null,
      })),
      maybeSingle: vi.fn(async () => {
        if (table === 'profiles') return { data: deps.profileRow, error: null }
        if (table === 'organizations') return { data: deps.organizationRow, error: null }
        if (table === 'nda_access_authority' && deps.authorityReadError) {
          return { data: null, error: deps.authorityReadError }
        }
        if (table === 'profiles') return { data: deps.profileRow, error: null }
        if (table === 'organizations') return { data: deps.organizationRow, error: null }
        if (table === 'nda_access_authority') return { data: deps.overrideRow, error: null }
        return { data: null, error: null }
      }),
      single: vi.fn(async () => ({ data: null, error: deps.insertError })),
    }
    return builder
  }

  return {
    supabase: {
      from: vi.fn((table: string) => makeBuilder(table)),
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { user: { id: deps.authUser.id } } },
          error: null,
        })),
        getUser: vi.fn(async () => ({
          data: { user: deps.authUser },
          error: null,
        })),
      },
      storage: { from: vi.fn() },
    },
  }
})

vi.mock('../supabaseService', () => ({
  syncToSupabase: vi.fn(),
  fetchFromSupabase: vi.fn(),
}))

import {
  NDAAuthorityUnavailableError,
  SIGNED_NDA_READ_SELECT,
  getCanonicalNDAStatus,
  getValidSignedNDA,
  hasNDAAccess,
  hasValidSignedNDA,
  isNDAAuthorityUnavailableError,
  saveSignedNDA,
} from '../ndaService'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

beforeEach(() => {
  deps.signedRows = []
  deps.profileRow = {
    id: '11111111-1111-4111-8111-111111111111',
    org_id: 'org-1',
    role: 'owner',
    created_at: '2026-08-05T03:40:15.434516Z',
  }
  deps.organizationRow = {
    id: 'org-1',
    owner_id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-05T03:40:15.434516Z',
  }
  deps.overrideRow = null
  deps.agreementReadError = null
  deps.authorityReadError = null
  deps.insertError = null
  deps.insertCalls = 0
  deps.selectArgs = []
  deps.authUser = {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-05T03:40:15.434857Z',
    last_sign_in_at: '2026-08-14T04:51:41.694269Z',
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('NDA authority persistence', () => {
  it('accepts the real production legacy row shape as SIGNED_LEGACY', async () => {
    deps.signedRows = [{
      id: 'legacy-row',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-04-06T01:57:05.984Z',
      created_at: '2026-04-06T01:57:07.400095Z',
      typed_name: 'Christian Dubon',
      signature_image: 'data:image/png;base64,legacy-signature',
      pdf_url: 'stub-pdf-url-1775440625984',
      email: null,
    }]

    await expect(getCanonicalNDAStatus('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      state: 'SIGNED_LEGACY',
      hasArtifact: false,
    })
    await expect(getValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      kind: 'legacy',
      record: expect.objectContaining({ typed_name: 'Christian Dubon' }),
    })
    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
    await expect(hasNDAAccess('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
  })

  it('classifies a complete current-format row as SIGNED_CURRENT', async () => {
    deps.signedRows = [{
      id: 'current-row',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-08-13T09:30:00Z',
      created_at: '2026-08-13T09:30:01Z',
      typed_name: 'Pilot Owner',
      email: 'owner@example.test',
      signature_image: 'data:image/png;base64,current-signature',
      pdf_url: 'nda/current-row.pdf',
    }]

    await expect(getCanonicalNDAStatus('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      state: 'SIGNED_CURRENT',
      hasArtifact: true,
    })
  })

  it('honors explicit durable grandfather authority when no signed row exists', async () => {
    deps.signedRows = []
    deps.overrideRow = {
      user_id: '11111111-1111-4111-8111-111111111111',
      access_state: 'GRANDFATHERED_LEGACY_ACCESS',
      source_classification: 'manual_legacy_access_review',
      reason: 'Owner verified historical pre-rollout access.',
      effective_at: '2026-08-14T00:00:00Z',
      created_at: '2026-08-14T00:00:00Z',
    }

    await expect(getCanonicalNDAStatus('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      state: 'GRANDFATHERED_LEGACY_ACCESS',
      source: 'override_grandfathered',
    })
    await expect(hasNDAAccess('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)
  })

  it('keeps an older owner without durable NDA authority unsigned', async () => {
    await expect(getCanonicalNDAStatus('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      state: 'UNSIGNED',
    })
    await expect(hasNDAAccess('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)
  })

  it('keeps a truly new owner without server evidence unsigned', async () => {
    deps.authUser = {
      id: '11111111-1111-4111-8111-111111111111',
      created_at: '2026-08-14T12:00:00Z',
      last_sign_in_at: '2026-08-14T12:00:00Z',
    }
    deps.profileRow = {
      id: '11111111-1111-4111-8111-111111111111',
      org_id: 'org-1',
      role: 'owner',
      created_at: '2026-08-14T12:00:00Z',
    }
    deps.organizationRow = {
      id: 'org-1',
      owner_id: '11111111-1111-4111-8111-111111111111',
      created_at: '2026-08-14T12:00:00Z',
    }

    await expect(getCanonicalNDAStatus('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      state: 'UNSIGNED',
    })
    await expect(hasNDAAccess('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)
  })

  it('honors explicit revocation without relying on signed_agreements.revoked', async () => {
    deps.overrideRow = {
      user_id: '11111111-1111-4111-8111-111111111111',
      access_state: 'REVOKED',
      source_classification: 'manual_founder_revocation',
      reason: 'Founder disabled access',
      effective_at: '2026-08-14T00:00:00Z',
      created_at: '2026-08-14T00:00:00Z',
    }

    await expect(getCanonicalNDAStatus('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      state: 'REVOKED',
      source: 'override_revoked',
    })
    await expect(hasNDAAccess('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)
  })

  it('surfaces a missing nda_access_authority relation as an explicit schema failure', async () => {
    deps.authorityReadError = {
      code: '42P01',
      message: 'relation "public.nda_access_authority" does not exist',
    }

    const error = await getCanonicalNDAStatus('11111111-1111-4111-8111-111111111111').catch((err) => err)

    expect(error).toBeInstanceOf(NDAAuthorityUnavailableError)
    expect(isNDAAuthorityUnavailableError(error)).toBe(true)
    expect(error).toMatchObject({
      code: 'NDA_AUTHORITY_SCHEMA_UNAVAILABLE',
      supabaseCode: '42P01',
    })
    await expect(hasNDAAccess('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({
      code: 'NDA_AUTHORITY_SCHEMA_UNAVAILABLE',
    })
  })

  it('recalculates NDA state for the authenticated user instead of trusting another account cache', async () => {
    localStorage.setItem('poweron_nda_accepted_owner-a', '1')
    deps.authUser = {
      id: 'owner-b',
      created_at: '2026-08-05T03:40:15.434857Z',
      last_sign_in_at: '2026-08-14T04:51:41.694269Z',
    }
    deps.profileRow = {
      id: 'owner-b',
      org_id: 'org-b',
      role: 'owner',
      created_at: '2026-08-05T03:40:15.434516Z',
    }
    deps.organizationRow = {
      id: 'org-b',
      owner_id: 'owner-b',
      created_at: '2026-08-05T03:40:15.434516Z',
    }

    await expect(getCanonicalNDAStatus('owner-b')).resolves.toMatchObject({
      state: 'UNSIGNED',
    })
    await expect(hasNDAAccess('owner-b')).resolves.toBe(false)
    expect(localStorage.getItem('poweron_nda_accepted_owner-b')).toBeNull()
  })

  it('uses a schema-safe wildcard selector so missing future columns cannot break legacy reads', async () => {
    deps.signedRows = [{
      id: 'legacy-row',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-04-06T19:57:05.984Z',
      created_at: '2026-04-06T19:57:05.984Z',
    }]

    await expect(hasNDAAccess('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)

    expect(SIGNED_NDA_READ_SELECT).toBe('*')
    expect(deps.selectArgs).toContain('signed_agreements:*')
    expect(deps.selectArgs).not.toContain(expect.stringContaining('pin_verified'))
    expect(deps.selectArgs).not.toContain(expect.stringContaining('verification_timestamp'))
    expect(deps.selectArgs).not.toContain(expect.stringContaining('revoked'))
  })

  it('fails closed when the signed agreement insert never reaches Supabase', async () => {
    vi.useFakeTimers()
    deps.insertError = { message: 'database unavailable' }

    const save = saveSignedNDA(
      'ignored-caller-id',
      'data:image/png;base64,signature',
      'Pilot Owner',
      '127.0.0.1',
      'owner@example.test',
      true,
    )
    const assertion = expect(save).rejects.toThrow('Failed to save NDA agreement')
    await vi.runAllTimersAsync()
    await assertion

    expect(deps.insertCalls).toBe(4)
    expect(localStorage.getItem('poweron_nda_accepted_11111111-1111-4111-8111-111111111111')).toBeNull()
  })
})
