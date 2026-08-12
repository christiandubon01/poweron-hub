/**
 * COMM-PROD-1 Step 9 (defect C) — the PIN save must be confirmed server-side.
 *
 * PostgREST answers an UPDATE that matched no rows with `error: null` and no
 * data. A missing profiles row or a row-level policy miss therefore looked
 * exactly like a successful save, which is how onboarding could report
 * "PIN saved" while profiles.passcode_hash stayed NULL — and why the next reload
 * pushed the owner back through PIN setup.
 *
 * setPasscode now only reports success when the stored hash reads back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  updateResult: { data: null as any, error: null as any },
  captured: { table: '', patch: null as any, id: '' },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      db.captured.table = table
      const builder: any = {
        update: vi.fn((patch: any) => { db.captured.patch = patch; return builder }),
        eq: vi.fn((_column: string, value: unknown) => { db.captured.id = String(value); return builder }),
        select: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => db.updateResult),
      }
      return builder
    }),
  },
}))

vi.mock('@/lib/auth/sessionStoreClient', () => ({ sessionStoreCall: vi.fn(async () => ({})) }))
vi.mock('@/lib/memory/audit', () => ({ logAudit: vi.fn(async () => {}) }))

import { setPasscode } from '../passcode'

beforeEach(() => {
  db.updateResult = { data: null, error: null }
  db.captured = { table: '', patch: null, id: '' }
  vi.stubGlobal('crypto', globalThis.crypto)
})

describe('COMM-PROD-1 D — verified passcode persistence', () => {
  it('reports failure when the profiles UPDATE matched no row', async () => {
    db.updateResult = { data: null, error: null }

    const result = await setPasscode('owner-1', '123456')

    expect(result.success).toBe(false)
    expect(db.captured.table).toBe('profiles')
    expect(db.captured.id).toBe('owner-1')
  })

  it('reports failure when the row came back without the hash that was written', async () => {
    db.updateResult = { data: { id: 'owner-1', passcode_hash: null }, error: null }

    const result = await setPasscode('owner-1', '123456')

    expect(result.success).toBe(false)
  })

  it('reports success only once the stored hash reads back from the database', async () => {
    const from = (await import('@/lib/supabase')).supabase.from as any
    from.mockImplementation((table: string) => {
      db.captured.table = table
      const builder: any = {
        update: vi.fn((patch: any) => {
          db.captured.patch = patch
          // Echo the write back the way a successful RETURNING would.
          db.updateResult = { data: { id: 'owner-1', passcode_hash: patch.passcode_hash }, error: null }
          return builder
        }),
        eq: vi.fn((_c: string, v: unknown) => { db.captured.id = String(v); return builder }),
        select: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => db.updateResult),
      }
      return builder
    })

    const result = await setPasscode('owner-1', '123456')

    expect(result.success).toBe(true)
    // Security posture unchanged: salted PBKDF2 hash, never the plaintext PIN.
    expect(db.captured.patch.passcode_hash).toMatch(/^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/)
    expect(db.captured.patch.passcode_hash).not.toContain('123456')
  })

  it('rejects a passcode that is not exactly six digits before touching the database', async () => {
    const result = await setPasscode('owner-1', '12345')

    expect(result.success).toBe(false)
    expect(db.captured.table).toBe('')
  })
})
