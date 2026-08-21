/**
 * QBO-3A disconnect tests (32–36) + role-gate + normalization source contracts.
 *
 * revokeTokensDetail distinguishes success / already-revoked (400|401) /
 * transient (5xx) / network failure. The disconnect function wires those into
 * markDisconnected (success + 400|401) vs fail-safely 502 (5xx + network).
 * The owner/admin role gate is present in authorize, status, and disconnect.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { loadQuickBooksConfig } from '../quickbooksConfig'
import { QboOAuthError, revokeTokensDetail, type QboFetchLike } from '../quickbooksOAuth'
import { QBO_TOKEN_ENCRYPTION_KEY_ENV } from '../quickbooksTokenCrypto'
import { Buffer } from 'node:buffer'

const ROOT = process.cwd()

const ENV = {
  INTUIT_CLIENT_ID: 'test-client-id',
  INTUIT_CLIENT_SECRET: 'test-client-secret',
  INTUIT_REDIRECT_URI: 'https://app.example.test/.netlify/functions/qbo-callback',
  INTUIT_OAUTH_STATE_SECRET: 'test-state-secret',
  [QBO_TOKEN_ENCRYPTION_KEY_ENV]: Buffer.from(new Array(32).fill(7)).toString('base64'),
}
const config = loadQuickBooksConfig(ENV)

function fetchStatus(status: number): QboFetchLike {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => '' })) as unknown as QboFetchLike
}

describe('QBO-3A disconnect — revokeTokensDetail', () => {
  it('32: provider 200 -> revoked:true', async () => {
    const result = await revokeTokensDetail(config, 'RT-1', fetchStatus(200))
    expect(result).toEqual({ revoked: true })
  })

  it('33: provider 400 -> revoked:false, status:400 (caller normalizes to disconnected)', async () => {
    const result = await revokeTokensDetail(config, 'RT-1', fetchStatus(400))
    expect(result.revoked).toBe(false)
    if (!result.revoked) expect(result.status).toBe(400)
  })

  it('34: provider 401 -> revoked:false, status:401 (already invalid -> normalize)', async () => {
    const result = await revokeTokensDetail(config, 'RT-1', fetchStatus(401))
    expect(result.revoked).toBe(false)
    if (!result.revoked) expect(result.status).toBe(401)
  })

  it('35: provider 5xx -> revoked:false, status:500 (transient -> caller must NOT mark disconnected)', async () => {
    const result = await revokeTokensDetail(config, 'RT-1', fetchStatus(500))
    expect(result.revoked).toBe(false)
    if (!result.revoked) expect(result.status).toBe(500)
  })

  it('36: network failure -> throws QboOAuthError revoke_failed (caller must NOT mark disconnected)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as QboFetchLike
    await expect(revokeTokensDetail(config, 'RT-1', fetchImpl)).rejects.toBeInstanceOf(QboOAuthError)
    try {
      await revokeTokensDetail(config, 'RT-1', fetchImpl)
    } catch (err) {
      expect((err as QboOAuthError).category).toBe('revoke_failed')
      // No token material in the error message.
      expect((err as Error).message).not.toContain('RT-1')
    }
  })
})

describe('QBO-3A disconnect — role gate source contract (authorize / status / disconnect)', () => {
  const files = [
    join(ROOT, 'netlify/functions/quickbooks/qbo-authorize.ts'),
    join(ROOT, 'netlify/functions/quickbooks/qbo-connection-status.ts'),
    join(ROOT, 'netlify/functions/quickbooks/qbo-disconnect.ts'),
  ]
  for (const f of files) {
    it(`owner/admin gate present in ${f.split(/[\\/]/).pop()}`, () => {
      const src = readFileSync(f, 'utf8')
      // Reads org/role from profiles under RLS (never the body).
      expect(src).toMatch(/profiles.*select.*org_id,\s*role,\s*is_active/)
      // is_active false -> 403.
      expect(src).toMatch(/is_active === false/)
      expect(src).toContain('403')
      // Only owner/admin.
      expect(src).toMatch(/\['owner',\s*'admin'\]/)
    })
  }

  it('member (non owner/admin) is rejected with 403 in all three functions', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src).toMatch(/!.*role.*!\[.owner.,\s*.admin.\].includes\(data\.role\)/)
    }
  })
})

describe('QBO-3A disconnect — normalization source contract', () => {
  const disconnect = readFileSync(join(ROOT, 'netlify/functions/quickbooks/qbo-disconnect.ts'), 'utf8')

  it('success + 400/401 -> markDisconnected (access gone, normalize)', () => {
    expect(disconnect).toMatch(/result\.revoked/)
    expect(disconnect).toMatch(/markDisconnected/)
    // 400/401 branch calls markDisconnected.
    expect(disconnect).toMatch(/status === 400 \|\| result\.status === 401/)
  })

  it('5xx + network -> 502 fail-safely, no markDisconnected in that branch', () => {
    expect(disconnect).toContain('502')
    expect(disconnect).toContain('disconnected: false')
    // The catch (network) branch returns 502 without marking disconnected.
    expect(disconnect).toMatch(/catch[\s\S]*?502[\s\S]*?disconnected: false/)
  })

  it('idempotent: already-disconnected returns 200 without a provider call', () => {
    expect(disconnect).toMatch(/isConnectionUsable\(row\)[\s\S]*?disconnected: true/)
  })
})