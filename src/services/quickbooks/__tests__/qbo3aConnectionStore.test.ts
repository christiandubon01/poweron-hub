/**
 * QBO-3A connection persistence tests (17–20).
 *
 * Successful callback persists one org connection; tokens stored encrypted (not
 * plaintext); reconnect updates the same org record; one org cannot replace
 * another org's connection. (Browser-no-direct-read / anon-no-access are covered
 * by the migration source-contract test.)
 */
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import {
  isConnectionUsable,
  markDisconnected,
  upsertConnection,
  loadConnection,
  type QboConnectionRepo,
  type QboConnectionRow,
} from '../quickbooksConnectionStore'
import { decryptToken, encryptToken, loadQboTokenEncryptionKey, QBO_TOKEN_ENCRYPTION_KEY_ENV } from '../quickbooksTokenCrypto'

const VALID_KEY_ENV = Buffer.from(new Array(32).fill(7)).toString('base64')
const key = loadQboTokenEncryptionKey({ [QBO_TOKEN_ENCRYPTION_KEY_ENV]: VALID_KEY_ENV })

function mapRow(r: Record<string, unknown>): QboConnectionRow {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    status: r.status as 'connected' | 'disconnected',
    connectedAt: (r.connected_at as string) ?? null,
    disconnectedAt: (r.disconnected_at as string) ?? null,
    connectedBy: (r.connected_by as string) ?? null,
    environment: r.environment as 'sandbox' | 'production',
    companyName: (r.company_name as string) ?? null,
    encryptedAccessToken: (r.encrypted_access_token as string) ?? null,
    encryptedRefreshToken: (r.encrypted_refresh_token as string) ?? null,
    encryptedRealmId: (r.encrypted_realm_id as string) ?? null,
    accessTokenExpiresAt: (r.access_token_expires_at as string) ?? null,
    refreshTokenExpiresAt: (r.refresh_token_expires_at as string) ?? null,
    lastRefreshedAt: (r.last_refreshed_at as string) ?? null,
    tokenVersion: (r.token_version as number) ?? 0,
  }
}

function fakeConnRepo(): { repo: QboConnectionRepo; table: Map<string, Record<string, unknown>> } {
  const table = new Map<string, Record<string, unknown>>()
  let ids = 0
  const repo: QboConnectionRepo = {
    async upsertConnection(input, now) {
      const existing = table.get(input.organizationId)
      const row: Record<string, unknown> = {
        id: existing?.id ?? `id-${ids++}`,
        organization_id: input.organizationId,
        status: 'connected',
        connected_at: now,
        disconnected_at: null,
        connected_by: input.userId,
        environment: input.environment,
        company_name: input.companyName,
        encrypted_access_token: input.encryptedAccessToken,
        encrypted_refresh_token: input.encryptedRefreshToken,
        encrypted_realm_id: input.encryptedRealmId,
        access_token_expires_at: input.accessTokenExpiresAt,
        refresh_token_expires_at: input.refreshTokenExpiresAt,
        last_refreshed_at: null,
        token_version: 0,
        created_at: existing?.created_at ?? now,
      }
      table.set(input.organizationId, row)
      return mapRow(row)
    },
    async loadConnection(orgId) {
      const r = table.get(orgId)
      return r ? mapRow(r) : null
    },
    async applyRefreshResult(orgId, expectedVersion, fields) {
      const r = table.get(orgId)
      if (!r || (r.token_version as number) !== expectedVersion) return null
      r.encrypted_access_token = fields.encryptedAccessToken
      r.encrypted_refresh_token = fields.encryptedRefreshToken
      r.access_token_expires_at = fields.accessTokenExpiresAt
      r.refresh_token_expires_at = fields.refreshTokenExpiresAt
      r.last_refreshed_at = fields.lastRefreshedAt
      r.token_version = expectedVersion + 1
      return r.token_version as number
    },
    async markDisconnected(orgId, now) {
      const r = table.get(orgId)
      if (!r) return
      r.status = 'disconnected'
      r.disconnected_at = now
      r.connected_by = null
      r.encrypted_access_token = null
      r.encrypted_refresh_token = null
      r.encrypted_realm_id = null
      r.access_token_expires_at = null
      r.refresh_token_expires_at = null
      r.last_refreshed_at = null
    },
  }
  return { repo, table }
}

const NOW = new Date('2026-01-01T00:00:00Z')

function buildInput(orgId: string, encAccessToken: string) {
  return {
    organizationId: orgId,
    userId: 'user-1',
    environment: 'sandbox' as const,
    encryptedAccessToken: encAccessToken,
    encryptedRefreshToken: encryptToken('RT-PLAIN', key),
    encryptedRealmId: encryptToken('realm-1', key),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    refreshTokenExpiresAt: null,
    companyName: 'Power On Solutions LLC',
  }
}

describe('QBO-3A connection persistence', () => {
  it('17: successful callback persists one org connection', async () => {
    const { repo, table } = fakeConnRepo()
    await upsertConnection(repo, buildInput('org-A', encryptToken('AT-PLAIN', key)), NOW)
    expect(table.size).toBe(1)
    expect(table.has('org-A')).toBe(true)
    const row = await loadConnection(repo, 'org-A')
    expect(isConnectionUsable(row)).toBe(true)
    expect(row?.status).toBe('connected')
  })

  it('18: tokens are stored encrypted, not plaintext', async () => {
    const { repo, table } = fakeConnRepo()
    await upsertConnection(repo, buildInput('org-A', encryptToken('AT-PLAIN-SECRET', key)), NOW)
    const stored = table.get('org-A')!
    expect((stored.encrypted_access_token as string).startsWith('v1:')).toBe(true)
    expect((stored.encrypted_refresh_token as string).startsWith('v1:')).toBe(true)
    expect((stored.encrypted_realm_id as string).startsWith('v1:')).toBe(true)
    // No plaintext token material in the stored row.
    const json = JSON.stringify(stored)
    expect(json).not.toContain('AT-PLAIN-SECRET')
    expect(json).not.toContain('RT-PLAIN')
    // Roundtrip decrypt recovers the values server-side.
    const row = await loadConnection(repo, 'org-A')
    expect(decryptToken(row!.encryptedAccessToken!, key)).toBe('AT-PLAIN-SECRET')
    expect(decryptToken(row!.encryptedRefreshToken!, key)).toBe('RT-PLAIN')
  })

  it('19: reconnect updates the SAME organization record (no duplicate)', async () => {
    const { repo, table } = fakeConnRepo()
    const first = await upsertConnection(repo, buildInput('org-A', encryptToken('AT-1', key)), NOW)
    const firstId = first.id
    const second = await upsertConnection(
      repo,
      buildInput('org-A', encryptToken('AT-2', key)),
      new Date('2026-02-01T00:00:00Z'),
    )
    expect(table.size).toBe(1)
    expect(second.id).toBe(firstId)
    const row = await loadConnection(repo, 'org-A')
    expect(decryptToken(row!.encryptedAccessToken!, key)).toBe('AT-2')
  })

  it('20: one org cannot replace another org connection', async () => {
    const { repo, table } = fakeConnRepo()
    await upsertConnection(repo, buildInput('org-A', encryptToken('AT-A', key)), NOW)
    await upsertConnection(repo, buildInput('org-B', encryptToken('AT-B', key)), NOW)
    expect(table.size).toBe(2)
    const a = await loadConnection(repo, 'org-A')
    const b = await loadConnection(repo, 'org-B')
    expect(decryptToken(a!.encryptedAccessToken!, key)).toBe('AT-A')
    expect(decryptToken(b!.encryptedAccessToken!, key)).toBe('AT-B')
  })

  it('34 (helper): markDisconnected clears provider credentials, preserves display metadata', async () => {
    const { repo } = fakeConnRepo()
    await upsertConnection(repo, buildInput('org-A', encryptToken('AT-1', key)), NOW)
    await markDisconnected(repo, 'org-A', new Date('2026-03-01T00:00:00Z'))
    const row = await loadConnection(repo, 'org-A')
    expect(row?.status).toBe('disconnected')
    expect(row?.disconnectedAt).toBe(new Date('2026-03-01T00:00:00Z').toISOString())
    expect(row?.encryptedAccessToken).toBeNull()
    expect(row?.encryptedRefreshToken).toBeNull()
    expect(row?.encryptedRealmId).toBeNull()
    expect(row?.companyName).toBe('Power On Solutions LLC') // preserved
    expect(isConnectionUsable(row)).toBe(false)
  })
})