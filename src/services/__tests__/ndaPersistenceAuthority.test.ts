import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  readError: null as null | { message: string },
  insertError: null as null | { message: string },
  insertCalls: 0,
  selectArgs: [] as Array<string | undefined>,
}))

vi.mock('@/lib/supabase', () => {
  const builder: any = {
    insert: vi.fn(() => { deps.insertCalls += 1; return builder }),
    select: vi.fn((columns?: string) => { deps.selectArgs.push(columns); return builder }),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: deps.rows, error: deps.readError })),
    single: vi.fn(async () => ({ data: null, error: deps.insertError })),
  }
  return {
    supabase: {
      from: vi.fn(() => builder),
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { user: { id: '11111111-1111-4111-8111-111111111111' } } },
          error: null,
        })),
        getUser: vi.fn(async () => ({
          data: { user: { id: '11111111-1111-4111-8111-111111111111' } },
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

import { SIGNED_NDA_READ_SELECT, getValidSignedNDA, hasValidSignedNDA, saveSignedNDA } from '../ndaService'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

beforeEach(() => {
  deps.rows = []
  deps.readError = null
  deps.insertError = null
  deps.insertCalls = 0
  deps.selectArgs = []
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('COMM-PROD-4 NDA persistence authority', () => {
  it('accepts the real production legacy row shape as a valid legacy NDA', async () => {
    deps.rows = [{
      id: '1775440625984',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-04-06T19:57:05.984Z',
      created_at: '2026-04-06T19:57:05.984Z',
      typed_name: 'Christian Dubon',
      signature_image: 'data:image/png;base64,legacy-signature',
      signature_data: null,
      pdf_url: 'stub-pdf-url-1775440625984',
    }]

    await expect(getValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      kind: 'legacy',
      record: expect.objectContaining({
        agreement_type: 'nda_beta_v1',
        typed_name: 'Christian Dubon',
      }),
    })
    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
  })

  it('accepts a current hardened signed row', async () => {
    deps.rows = [{
      id: 'current-row',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-08-13T09:30:00Z',
      verification_timestamp: '2026-08-13T09:30:01Z',
      pin_verified: true,
      revoked: false,
      pdf_url: 'nda/current-row.pdf',
    }]

    await expect(getValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toMatchObject({
      kind: 'current',
      record: expect.objectContaining({
        id: 'current-row',
        verification_timestamp: '2026-08-13T09:30:01Z',
      }),
    })
    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
  })

  it('does not let a local marker bypass a missing authoritative agreement row', async () => {
    localStorage.setItem('poweron_nda_accepted_11111111-1111-4111-8111-111111111111', '1')

    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)

    expect(localStorage.getItem('poweron_nda_accepted_11111111-1111-4111-8111-111111111111')).toBeNull()
  })

  it('rejects revoked agreements even when the row otherwise looks valid', async () => {
    deps.rows = [{
      id: 'revoked-row',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-06-01T09:30:00Z',
      verification_timestamp: '2026-06-01T09:30:01Z',
      revoked: true,
    }]

    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(false)
  })

  it('keeps same-version historical rows valid when newer metadata was never captured', async () => {
    deps.rows = [{
      id: 'legacy-same-version',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-04-20T12:00:00Z',
      typed_name: 'Pilot Owner',
      revoked: false,
      pdf_url: null,
      verification_timestamp: null,
    }]

    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)
  })

  it('uses a schema-safe wildcard selector so missing future columns cannot break legacy reads', async () => {
    deps.rows = [{
      id: 'legacy-row',
      user_id: '11111111-1111-4111-8111-111111111111',
      agreement_type: 'nda_beta_v1',
      signed_at: '2026-04-06T19:57:05.984Z',
      created_at: '2026-04-06T19:57:05.984Z',
    }]

    await expect(hasValidSignedNDA('11111111-1111-4111-8111-111111111111')).resolves.toBe(true)

    expect(SIGNED_NDA_READ_SELECT).toBe('*')
    expect(deps.selectArgs).toContain('*')
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
