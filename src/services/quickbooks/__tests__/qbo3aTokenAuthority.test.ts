/**
 * QBO-3A token refresh authority tests (26–31).
 *
 * Valid token not refreshed; expired refreshes; newest refresh token replaces;
 * token_version increments; concurrent stale refresh cannot overwrite the
 * winner; refresh never returns a token to the browser (source scan).
 */
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { loadQuickBooksConfig } from '../quickbooksConfig'
import { getValidQboAccessToken } from '../quickbooksTokenAuthority'
import { decryptToken, encryptToken, loadQboTokenEncryptionKey, QBO_TOKEN_ENCRYPTION_KEY_ENV } from '../quickbooksTokenCrypto'
import type { QboConnectionRepo, QboConnectionRow, QboRefreshUpdateFields } from '../quickbooksConnectionStore'
import type { QboFetchLike } from '../quickbooksOAuth'

const ROOT = process.cwd()

const ENV = {
  INTUIT_CLIENT_ID: 'test-client-id',
  INTUIT_CLIENT_SECRET: 'test-client-secret',
  INTUIT_REDIRECT_URI: 'https://app.example.test/.netlify/functions/qbo-callback',
  INTUIT_OAUTH_STATE_SECRET: 'test-state-secret',
  [QBO_TOKEN_ENCRYPTION_KEY_ENV]: Buffer.from(new Array(32).fill(7)).toString('base64'),
}
const config = loadQuickBooksConfig(ENV)
const key = loadQboTokenEncryptionKey(ENV)

/** Fake repo carrying one in-memory row, with real CAS semantics. */
function fakeRepo(initial: QboConnectionRow): { repo: QboConnectionRepo; row: () => QboConnectionRow } {
  let row: QboConnectionRow = { ...initial }
  const repo: QboConnectionRepo = {
    async upsertConnection() {
      throw new Error('not used')
    },
    async loadConnection() {
      return row
    },
    async applyRefreshResult(_orgId, expectedVersion, fields: QboRefreshUpdateFields) {
      if (row.tokenVersion !== expectedVersion) return null // race lost
      row = {
        ...row,
        encryptedAccessToken: fields.encryptedAccessToken,
        encryptedRefreshToken: fields.encryptedRefreshToken,
        accessTokenExpiresAt: fields.accessTokenExpiresAt,
        refreshTokenExpiresAt: fields.refreshTokenExpiresAt,
        lastRefreshedAt: fields.lastRefreshedAt,
        tokenVersion: expectedVersion + 1,
      }
      return row.tokenVersion
    },
    async markDisconnected() {
      /* noop */
    },
  }
  return { repo, row: () => row }
}

function connectedRow(overrides: Partial<QboConnectionRow> = {}): QboConnectionRow {
  return {
    id: 'id-1',
    organizationId: 'org-A',
    status: 'connected',
    connectedAt: '2026-01-01T00:00:00.000Z',
    disconnectedAt: null,
    connectedBy: 'user-1',
    environment: 'production',
    companyName: 'Power On Solutions LLC',
    encryptedAccessToken: encryptToken('AT-STORED', key),
    encryptedRefreshToken: encryptToken('RT-STORED', key),
    encryptedRealmId: encryptToken('realm-1', key),
    accessTokenExpiresAt: '2026-01-01T01:00:00.000Z',
    refreshTokenExpiresAt: null,
    lastRefreshedAt: null,
    tokenVersion: 0,
    ...overrides,
  }
}

function refreshFetch(accessToken: string, refreshToken: string): QboFetchLike {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: accessToken, refresh_token: refreshToken, token_type: 'bearer', expires_in: 3600 }),
    text: async () => '',
  })) as unknown as QboFetchLike
}

const NOW = new Date('2026-01-01T00:30:00Z')

describe('QBO-3A token refresh authority', () => {
  it('26: valid token does not refresh unnecessarily', async () => {
    const farFuture = new Date(Date.parse('2026-01-01T01:00:00Z') + 600_000).toISOString() // +10min beyond NOW
    const { repo } = fakeRepo(connectedRow({ accessTokenExpiresAt: farFuture }))
    const fetchImpl = vi.fn()
    const result = await getValidQboAccessToken(config, key, repo, 'org-A', fetchImpl as unknown as QboFetchLike, NOW)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result?.accessToken).toBe('AT-STORED')
    expect(result?.realmId).toBe('realm-1')
  })

  it('27: expired / near-expiry token refreshes', async () => {
    const nearExpiry = new Date(Date.parse('2026-01-01T00:30:10Z')).toISOString() // 10s left < 60s skew
    const { repo } = fakeRepo(connectedRow({ accessTokenExpiresAt: nearExpiry }))
    const fetchImpl = refreshFetch('AT-NEW', 'RT-NEW')
    const result = await getValidQboAccessToken(config, key, repo, 'org-A', fetchImpl, NOW)
    expect(result?.accessToken).toBe('AT-NEW')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('28: newest returned refresh token replaces the previous', async () => {
    const nearExpiry = new Date(Date.parse('2026-01-01T00:30:10Z')).toISOString()
    const { repo, row } = fakeRepo(connectedRow({ accessTokenExpiresAt: nearExpiry }))
    await getValidQboAccessToken(config, key, repo, 'org-A', refreshFetch('AT-NEW', 'RT-ROTATED'), NOW)
    expect(decryptToken(row().encryptedRefreshToken!, key)).toBe('RT-ROTATED')
    // Old refresh token no longer stored.
    expect(decryptToken(row().encryptedRefreshToken!, key)).not.toBe('RT-STORED')
  })

  it('29: token_version increments after refresh', async () => {
    const nearExpiry = new Date(Date.parse('2026-01-01T00:30:10Z')).toISOString()
    const { repo, row } = fakeRepo(connectedRow({ accessTokenExpiresAt: nearExpiry, tokenVersion: 5 }))
    await getValidQboAccessToken(config, key, repo, 'org-A', refreshFetch('AT-NEW', 'RT-NEW'), NOW)
    expect(row().tokenVersion).toBe(6)
  })

  it('30: concurrent stale refresh cannot overwrite the winning refresh', async () => {
    // The stored row already reflects the WINNER's refresh (AT-WINNER, version 1).
    // Our refresh produces AT-REFRESHED, but CAS returns null (race lost) and the
    // authority must return the WINNER's current token, not overwrite it.
    const winnerRow = connectedRow({
      encryptedAccessToken: encryptToken('AT-WINNER', key),
      encryptedRefreshToken: encryptToken('RT-WINNER', key),
      accessTokenExpiresAt: new Date(Date.parse('2026-01-01T01:30:00Z')).toISOString(),
      tokenVersion: 1,
    })
    const raceLostRepo: QboConnectionRepo = {
      async upsertConnection() {
        throw new Error('not used')
      },
      async loadConnection() {
        return winnerRow
      },
      async applyRefreshResult() {
        return null // another process won the race
      },
      async markDisconnected() {
        /* noop */
      },
    }
    const result = await getValidQboAccessToken(
      config,
      key,
      raceLostRepo,
      'org-A',
      refreshFetch('AT-REFRESHED', 'RT-REFRESHED'),
      NOW,
    )
    expect(result?.accessToken).toBe('AT-WINNER')
    // The stale refresh result was NOT persisted over the winner.
    expect(decryptToken(winnerRow.encryptedAccessToken!, key)).toBe('AT-WINNER')
    expect(decryptToken(winnerRow.encryptedRefreshToken!, key)).toBe('RT-WINNER')
  })

  it('31: refresh never returns a token to the browser (no browser import)', () => {
    function walk(dir: string, acc: string[]): void {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        const st = statSync(p)
        if (st.isDirectory()) walk(p, acc)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) acc.push(p)
      }
    }
    const files: string[] = []
    walk(join(ROOT, 'src'), files)
    const offenders: string[] = []
    for (const f of files) {
      if (f.includes(join('src', 'services', 'quickbooks'))) continue // server-only modules
      const src = readFileSync(f, 'utf8')
      if (/quickbooksTokenAuthority/.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})