/**
 * QBO-3A single-use OAuth state tests (1–9).
 *
 * Nonce hash-only persistence, valid consume, replay rejection, expiry,
 * consumed rejection, org/user mismatch, tampered state, unsafe return path.
 */
import { describe, expect, it } from 'vitest'

import {
  consumeState,
  createState,
  pruneExpired,
  safeReturnPath,
  type QboStateRepo,
  type QboStateRow,
} from '../quickbooksOauthStateStore'
import { hashNonce } from '../quickbooksTokenCrypto'
import { signState, verifyState } from '../quickbooksState'

const STATE_SECRET = 'test-state-secret-not-real'

/** In-memory fake implementing the QboStateRepo CAS semantics. */
function fakeStateRepo(): { repo: QboStateRepo; rows: Map<string, Record<string, string>> } {
  const rows = new Map<string, Record<string, string>>()
  const repo: QboStateRepo = {
    async insertState(row) {
      rows.set(row.nonceHash, {
        id: `id-${rows.size}`,
        nonce_hash: row.nonceHash,
        organization_id: row.organizationId,
        user_id: row.userId,
        return_path: row.returnPath ?? '',
        expires_at: row.expiresAt,
        consumed_at: '',
      })
    },
    async consumeState(nonceHash, now): Promise<QboStateRow | null> {
      const r = rows.get(nonceHash)
      if (!r) return null
      if (r.consumed_at !== '') return null // already consumed
      if (new Date(r.expires_at).getTime() <= new Date(now).getTime()) return null // expired
      r.consumed_at = now
      return {
        id: r.id,
        organizationId: r.organization_id,
        userId: r.user_id,
        returnPath: r.return_path || null,
        expiresAt: r.expires_at,
        consumedAt: r.consumed_at,
      }
    },
    async pruneStates(now) {
      for (const [k, r] of rows) {
        if (new Date(r.expires_at).getTime() < new Date(now).getTime()) rows.delete(k)
      }
    },
  }
  return { repo, rows }
}

describe('QBO-3A single-use OAuth state', () => {
  it('1: nonce generated and only its hash is persisted', async () => {
    const { repo, rows } = fakeStateRepo()
    const rawNonce = 'raw-nonce-abc-123'
    const { nonceHash } = await createState(repo, {
      nonce: rawNonce,
      organizationId: 'org-1',
      userId: 'user-1',
      returnPath: '/',
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect(nonceHash).toBe(hashNonce(rawNonce))
    const stored = rows.get(nonceHash)!
    expect(stored.nonce_hash).toBe(hashNonce(rawNonce))
    // The raw nonce is never persisted.
    expect(JSON.stringify([...rows.values()])).not.toContain(rawNonce)
  })

  it('2: valid signed state + live nonce accepted', async () => {
    const { repo } = fakeStateRepo()
    const { state } = signState({ userId: 'user-1', orgId: 'org-1' }, STATE_SECRET)
    const verified = verifyState(state, STATE_SECRET)
    expect(verified.ok).toBe(true)
    if (!verified.ok) return
    await createState(repo, {
      nonce: verified.nonce,
      organizationId: 'org-1',
      userId: 'user-1',
      returnPath: '/',
      expiresAt: new Date(verified.expiresAt),
    })
    const consumed = await consumeState(repo, verified.nonce, { userId: 'user-1', orgId: 'org-1' }, new Date())
    expect(consumed).toEqual({ ok: true, returnPath: '/' })
  })

  it('3: same state replay rejected (even inside signed-state TTL)', async () => {
    const { repo } = fakeStateRepo()
    const { state } = signState({ userId: 'user-1', orgId: 'org-1' }, STATE_SECRET)
    const verified = verifyState(state, STATE_SECRET)
    if (!verified.ok) throw new Error('state should verify')
    await createState(repo, {
      nonce: verified.nonce,
      organizationId: 'org-1',
      userId: 'user-1',
      returnPath: '/',
      expiresAt: new Date(verified.expiresAt),
    })
    const ctx = { userId: 'user-1', orgId: 'org-1' }
    const first = await consumeState(repo, verified.nonce, ctx, new Date())
    expect(first.ok).toBe(true)
    const second = await consumeState(repo, verified.nonce, ctx, new Date())
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('replay_or_expired')
  })

  it('4: expired nonce rejected', async () => {
    const { repo } = fakeStateRepo()
    const nonce = 'expired-nonce'
    await createState(repo, {
      nonce,
      organizationId: 'org-1',
      userId: 'user-1',
      returnPath: '/',
      expiresAt: new Date(Date.now() - 1_000), // already expired
    })
    const consumed = await consumeState(repo, nonce, { userId: 'user-1', orgId: 'org-1' }, new Date())
    expect(consumed.ok).toBe(false)
    if (!consumed.ok) expect(consumed.reason).toBe('replay_or_expired')
  })

  it('5: consumed nonce rejected on second use', async () => {
    const { repo } = fakeStateRepo()
    const nonce = 'once-only'
    await createState(repo, {
      nonce,
      organizationId: 'org-1',
      userId: 'user-1',
      returnPath: '/',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const ctx = { userId: 'user-1', orgId: 'org-1' }
    expect((await consumeState(repo, nonce, ctx, new Date())).ok).toBe(true)
    expect((await consumeState(repo, nonce, ctx, new Date())).ok).toBe(false)
  })

  it('6: org mismatch rejected', async () => {
    const { repo } = fakeStateRepo()
    const nonce = 'org-mismatch'
    await createState(repo, {
      nonce,
      organizationId: 'org-real',
      userId: 'user-1',
      returnPath: '/',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const consumed = await consumeState(repo, nonce, { userId: 'user-1', orgId: 'org-attacker' }, new Date())
    expect(consumed.ok).toBe(false)
    if (!consumed.ok) expect(consumed.reason).toBe('org_mismatch')
  })

  it('7: user mismatch rejected', async () => {
    const { repo } = fakeStateRepo()
    const nonce = 'user-mismatch'
    await createState(repo, {
      nonce,
      organizationId: 'org-1',
      userId: 'user-real',
      returnPath: '/',
      expiresAt: new Date(Date.now() + 60_000),
    })
    const consumed = await consumeState(repo, nonce, { userId: 'user-attacker', orgId: 'org-1' }, new Date())
    expect(consumed.ok).toBe(false)
    if (!consumed.ok) expect(consumed.reason).toBe('user_mismatch')
  })

  it('8: tampered signed state is rejected before nonce lookup', () => {
    const { state } = signState({ userId: 'user-1', orgId: 'org-1' }, STATE_SECRET)
    const [payload, sig] = state.split('.')
    const flippedSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(verifyState(`${payload}.${flippedSig}`, STATE_SECRET)).toEqual({ ok: false, reason: 'invalid_signature' })
    // Wrong secret.
    expect(verifyState(state, 'wrong-secret')).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('9: unsafe return path rejected (no open redirect)', () => {
    expect(safeReturnPath('https://evil.com')).toBe('/')
    expect(safeReturnPath('//evil.com')).toBe('/')
    expect(safeReturnPath('javascript:alert(1)')).toBe('/')
    expect(safeReturnPath('/\\evil')).toBe('/')
    expect(safeReturnPath('')).toBe('/')
    expect(safeReturnPath(null)).toBe('/')
    // Safe relative paths survive.
    expect(safeReturnPath('/')).toBe('/')
    expect(safeReturnPath('/field-log')).toBe('/field-log')
    // createState sanitizes an unsafe return path before persistence.
  })
})