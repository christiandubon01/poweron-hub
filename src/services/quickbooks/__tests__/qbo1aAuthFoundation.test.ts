/**
 * QBO-1A focused tests — QuickBooks Online OAuth 2.0 connection foundation.
 *
 * Covers QBO-AUTH-1..14 and QBO-SEC-1..4. Network is injected (no global fetch),
 * secrets are injected, and source-level proofs assert credentials never enter
 * browser-importable QBO code.
 */
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { loadQuickBooksConfig } from '../quickbooksConfig'
import { QBO_ACCOUNTING_SCOPE } from '../quickbooksConstants'
import { validateCallback } from '../quickbooksCallback'
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  parseTokenResponse,
  refreshTokens,
  revokeTokens,
} from '../quickbooksOAuth'
import type { QboFetchLike } from '../quickbooksOAuth'
import { sanitizeTokenSet } from '../quickbooksSanitize'
import { signState, verifyState } from '../quickbooksState'

const ROOT = process.cwd()

const STATE_SECRET = 'test-state-signing-secret-not-real'
const ENV = {
  INTUIT_CLIENT_ID: 'test-client-id-placeholder',
  INTUIT_CLIENT_SECRET: 'test-client-secret-placeholder',
  INTUIT_REDIRECT_URI: 'https://app.example.test/.netlify/functions/qbo-callback',
  INTUIT_OAUTH_STATE_SECRET: STATE_SECRET,
}
const config = loadQuickBooksConfig(ENV)
const CTX = { userId: 'user-123', orgId: 'org-abc' }

describe('QBO-1A authorization URL', () => {
  it('QBO-AUTH-1: authorization URL requests the accounting scope', () => {
    const { url } = buildAuthorizationUrl(config, CTX)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('scope')).toBe(QBO_ACCOUNTING_SCOPE)
    expect(parsed.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting')
  })

  it('QBO-AUTH-2: configured redirect URI is used', () => {
    const { url } = buildAuthorizationUrl(config, CTX)
    const parsed = new URL(url)
    expect(parsed.searchParams.get('redirect_uri')).toBe(config.redirectUri)
    expect(parsed.searchParams.get('client_id')).toBe(config.clientId)
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.pathname.endsWith('/connect/oauth2')).toBe(true)
  })
})

describe('QBO-1A state / CSRF protection', () => {
  it('QBO-AUTH-3: state tampering is rejected (signature + payload)', () => {
    const { state } = signState(CTX, STATE_SECRET)
    const [payload, sig] = state.split('.')

    // Flip a signature character → signature no longer matches.
    const flippedSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(verifyState(`${payload}.${flippedSig}`, STATE_SECRET)).toEqual({ ok: false, reason: 'invalid_signature' })

    // Flip payload bits → either signature mismatch or malformed, never ok.
    const tamperedPayload = payload.slice(0, -2) + 'AA'
    const tampered = verifyState(`${tamperedPayload}.${sig}`, STATE_SECRET)
    expect(tampered.ok).toBe(false)

    // Wrong secret → invalid signature.
    expect(verifyState(state, 'wrong-secret')).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('QBO-AUTH-4: expired state is rejected', () => {
    const past = 1_700_000_000_000
    const { state } = signState(CTX, STATE_SECRET, { now: past, ttlSeconds: 60 })
    expect(verifyState(state, STATE_SECRET, { now: past + 120_000 })).toEqual({ ok: false, reason: 'expired' })
  })

  it('QBO-AUTH-5: state binds PowerOn user/org context', () => {
    const { state } = signState({ userId: 'user-X', orgId: 'org-Y' }, STATE_SECRET)
    const res = verifyState(state, STATE_SECRET)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.context).toEqual({ userId: 'user-X', orgId: 'org-Y' })

    const { state: state2 } = signState({ userId: 'user-X', orgId: 'org-Z' }, STATE_SECRET)
    const res2 = verifyState(state2, STATE_SECRET)
    expect(res2.ok).toBe(true)
    if (res2.ok) expect(res2.context.orgId).toBe('org-Z')
  })
})

describe('QBO-1A callback validation', () => {
  it('QBO-AUTH-6: missing callback state rejected', () => {
    const res = validateCallback({ code: 'c', realmId: 'r' }, STATE_SECRET)
    expect(res.ok).toBe(false)
    expect(res.error?.category).toBe('missing_state')
  })

  it('QBO-AUTH-7: missing authorization code rejected', () => {
    const { state } = signState(CTX, STATE_SECRET)
    const res = validateCallback({ state, realmId: 'r' }, STATE_SECRET)
    expect(res.ok).toBe(false)
    expect(res.error?.category).toBe('missing_code')
  })

  it('QBO-AUTH-8: missing realmId rejected', () => {
    const { state } = signState(CTX, STATE_SECRET)
    const res = validateCallback({ state, code: 'c' }, STATE_SECRET)
    expect(res.ok).toBe(false)
    expect(res.error?.category).toBe('missing_realm_id')
  })

  it('QBO-AUTH-9: provider-denial/error is sanitized', () => {
    const res = validateCallback({ error: 'access_denied', errorDescription: 'user clicked no' }, STATE_SECRET)
    expect(res.ok).toBe(false)
    expect(res.error?.category).toBe('provider_denied')
    // The raw provider error_description must not be echoed back.
    expect(JSON.stringify(res)).not.toContain('user clicked no')
  })
})

describe('QBO-1A token exchange / refresh / revoke primitives', () => {
  it('QBO-AUTH-10: token parser handles a successful token response', () => {
    const now = 5_000_000_000_000
    const raw = parseTokenResponse(
      {
        access_token: 'AT-123',
        refresh_token: 'RT-456',
        token_type: 'bearer',
        expires_in: 3600,
        x_refresh_token_expires_in: 8640000,
      },
      now,
      'realm-789',
    )
    expect(raw.accessToken).toBe('AT-123')
    expect(raw.refreshToken).toBe('RT-456')
    expect(raw.accessExpiresAt).toBe(now + 3600 * 1000)
    expect(raw.refreshExpiresAt).toBe(now + 8640000 * 1000)
    expect(raw.realmId).toBe('realm-789')
  })

  it('QBO-AUTH-10b: token parser rejects a response missing required fields', () => {
    expect(() => parseTokenResponse({ access_token: 'AT', token_type: 'bearer', expires_in: 3600 }, 1)).toThrow()
  })

  it('QBO exchange: code is exchanged server-side with Basic auth; secret never returned', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'AT', refresh_token: 'RT', token_type: 'bearer', expires_in: 3600 }),
      text: async () => '',
    }))
    const raw = await exchangeAuthorizationCode(config, 'CODE-1', 'realm-1', fetchImpl as unknown as QboFetchLike)
    expect(raw.accessToken).toBe('AT')
    expect(raw.realmId).toBe('realm-1')

    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, { method: string; headers: Record<string, string>; body: string }]
    >
    const init = calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toMatch(/^Basic /)
    expect(init.headers.Authorization).toContain(
      Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
    )
    expect(init.body).toContain('grant_type=authorization_code')
    expect(init.body).toContain('code=CODE-1')
  })

  it('QBO-AUTH-11/12: sanitized result cannot expose access or refresh tokens', () => {
    const raw = parseTokenResponse(
      { access_token: 'SECRET-ACCESS-TOKEN', refresh_token: 'SECRET-REFRESH-TOKEN', token_type: 'bearer', expires_in: 3600 },
      5_000_000_000_000,
      'realm-1',
    )
    const sanitized = sanitizeTokenSet(raw)
    const json = JSON.stringify(sanitized)
    expect(json).not.toContain('SECRET-ACCESS-TOKEN')
    expect(json).not.toContain('SECRET-REFRESH-TOKEN')
    expect(sanitized.realmId).toBe('realm-1')
    expect(sanitized.connected).toBe(true)
    const safe = sanitized as unknown as Record<string, unknown>
    expect(safe.accessToken).toBeUndefined()
    expect(safe.refreshToken).toBeUndefined()
    expect(safe.clientSecret).toBeUndefined()
  })

  it('QBO-AUTH-13: refresh response supports replacement/rotation of the refresh token', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'AT-NEW',
        refresh_token: 'RT-ROTATED',
        token_type: 'bearer',
        expires_in: 3600,
      }),
      text: async () => '',
    }))
    const result = await refreshTokens(config, 'RT-OLD', fetchImpl as unknown as QboFetchLike)
    expect(result.rotated).toBe(true)
    expect(result.tokenSet.refreshToken).toBe('RT-ROTATED')

    // The stale token is NOT echoed in the result — callers must read the new one.
    expect(JSON.stringify(result)).not.toContain('RT-OLD')

    // The request used the old token to refresh.
    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, { method: string; headers: Record<string, string>; body: string }]
    >
    const body = calls[0][1].body
    expect(body).toContain('grant_type=refresh_token')
    expect(body).toContain('refresh_token=RT-OLD')
  })

  it('QBO-AUTH-13b: refresh with no rotation still replaces authoritatively', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'AT-NEW', refresh_token: 'RT-SAME', token_type: 'bearer', expires_in: 3600 }),
      text: async () => '',
    }))
    const result = await refreshTokens(config, 'RT-SAME', fetchImpl as unknown as QboFetchLike)
    expect(result.rotated).toBe(false)
    expect(result.tokenSet.refreshToken).toBe('RT-SAME')
  })

  it('QBO-AUTH-14: revoke primitive fails closed on provider error and network failure', async () => {
    const providerError = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => 'bad token' }))
    await expect(revokeTokens(config, 'RT-OLD', providerError as unknown as QboFetchLike)).rejects.toThrow()

    const networkFailure = vi.fn(async () => {
      throw new Error('network down')
    })
    await expect(revokeTokens(config, 'RT-OLD', networkFailure as unknown as QboFetchLike)).rejects.toThrow()
  })
})

describe('QBO-1A security boundaries', () => {
  it('QBO-SEC-1: realmId cannot choose a PowerOn organization', () => {
    const { state } = signState({ userId: 'user-A', orgId: 'poweron-org-1' }, STATE_SECRET)
    // An attacker supplies an unrelated realmId on the callback.
    const res = validateCallback({ state, code: 'c', realmId: '999999' }, STATE_SECRET)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.context?.orgId).toBe('poweron-org-1')
      expect(res.realmId).toBe('999999')
      expect(res.realmId).not.toBe(res.context?.orgId)
    }
    // realmId alone (no valid state) cannot establish any org context.
    const noState = validateCallback({ code: 'c', realmId: '999999' }, STATE_SECRET)
    expect(noState.ok).toBe(false)
  })

  // Source-level proofs that credentials never enter browser-importable QBO code.
  const qboSrc = readdirSync(join(ROOT, 'src/services/quickbooks'))
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
    .map((f) => readFileSync(join(ROOT, 'src/services/quickbooks', f), 'utf8'))
    .join('\n')

  it('QBO-SEC-2: client secret remains server-side — src QBO modules never access process.env.<key>', () => {
    // Proves no real environment read happens in browser-importable QBO code.
    // (Comments may mention process.env by name; an actual `process.env.X` access must not.)
    expect(qboSrc).not.toMatch(/process\.env\.[A-Za-z_]/)
  })

  it('QBO-SEC-2b: no hardcoded secret literal in src QBO modules', () => {
    expect(qboSrc).not.match(/INTUIT_CLIENT_SECRET\s*=\s*['"][A-Za-z0-9]/)
  })

  it('QBO-SEC-3: tokens are not written to browser storage', () => {
    expect(qboSrc).not.toContain('localStorage')
    expect(qboSrc).not.toContain('sessionStorage')
    expect(qboSrc.toLowerCase()).not.toContain('indexeddb')
  })

  it('QBO-SEC-4: tokens are not logged by the QBO implementation', () => {
    expect(qboSrc).not.toContain('console.log')
    expect(qboSrc).not.toContain('console.error')
    expect(qboSrc).not.toContain('console.warn')
    expect(qboSrc).not.toContain('console.info')
  })
})