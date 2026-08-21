/**
 * QBO-3A connection status tests (23–25).
 *
 * Disconnected returns only { connected: false }; connected returns only
 * sanitized metadata; status never contains tokens, encrypted blobs, or realmId.
 */
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  getSanitizedStatus,
  sanitizeConnectionStatus,
  type QboConnectionRepo,
  type QboConnectionRow,
} from '../quickbooksConnectionStore'
import { encryptToken, loadQboTokenEncryptionKey, QBO_TOKEN_ENCRYPTION_KEY_ENV } from '../quickbooksTokenCrypto'

const VALID_KEY_ENV = Buffer.from(new Array(32).fill(7)).toString('base64')
const key = loadQboTokenEncryptionKey({ [QBO_TOKEN_ENCRYPTION_KEY_ENV]: VALID_KEY_ENV })

function fakeRepoWith(row: QboConnectionRow | null): QboConnectionRepo {
  return {
    async upsertConnection() {
      throw new Error('not used')
    },
    async loadConnection() {
      return row
    },
    async applyRefreshResult() {
      return null
    },
    async markDisconnected() {
      /* noop */
    },
  }
}

const connectedRow: QboConnectionRow = {
  id: 'id-1',
  organizationId: 'org-A',
  status: 'connected',
  connectedAt: '2026-01-01T00:00:00.000Z',
  disconnectedAt: null,
  connectedBy: 'user-1',
  environment: 'production',
  companyName: 'Power On Solutions LLC',
  encryptedAccessToken: encryptToken('SECRET-ACCESS-TOKEN', key),
  encryptedRefreshToken: encryptToken('SECRET-REFRESH-TOKEN', key),
  encryptedRealmId: encryptToken('realm-999', key),
  accessTokenExpiresAt: '2026-01-01T01:00:00.000Z',
  refreshTokenExpiresAt: null,
  lastRefreshedAt: null,
  tokenVersion: 3,
}

describe('QBO-3A connection status sanitization', () => {
  it('23: disconnected status returns only { connected: false }', () => {
    expect(sanitizeConnectionStatus(null)).toEqual({ connected: false })
    const disconnected: QboConnectionRow = { ...connectedRow, status: 'disconnected', encryptedAccessToken: null, encryptedRefreshToken: null, encryptedRealmId: null }
    expect(sanitizeConnectionStatus(disconnected)).toEqual({ connected: false })
  })

  it('24: connected status returns only sanitized metadata', async () => {
    const status = await getSanitizedStatus(fakeRepoWith(connectedRow), 'org-A')
    expect(status).toEqual({
      connected: true,
      companyName: 'Power On Solutions LLC',
      connectedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('25: status contains no tokens / encrypted blobs / realmId', async () => {
    const status = await getSanitizedStatus(fakeRepoWith(connectedRow), 'org-A')
    const json = JSON.stringify(status)
    expect(json).not.toContain('SECRET-ACCESS-TOKEN')
    expect(json).not.toContain('SECRET-REFRESH-TOKEN')
    expect(json).not.toContain('realm-999')
    expect(json).not.toContain('encrypted')
    expect(json).not.toContain('v1:')
    expect(json).not.toContain('tokenVersion')
    const obj = status as Record<string, unknown>
    expect(obj.realmId).toBeUndefined()
    expect(obj.encryptedAccessToken).toBeUndefined()
    expect(obj.environment).toBeUndefined()
  })
})