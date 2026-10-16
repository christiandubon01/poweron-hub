import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AUTO_SYNC_ACTOR_USER_ID, AUTO_SYNC_BACKGROUND_PATH, AUTO_SYNC_SIGNATURE_WINDOW_MS, autoSyncActor, autoSyncBaseUrl, autoSyncEnabled, kickOffItemSync, signAutoSyncRequest, verifyAutoSyncRequest } from '../autoSync'

const KEY = 'service-role-key-for-tests-only'
const ITEM = '30000000-0000-4000-8000-000000000001'
const OTHER = '30000000-0000-4000-8000-000000000002'
const NOW = Date.parse('2026-10-16T12:00:00Z')

describe('PLAID-2A auto sync: function-to-function authentication', () => {
  it('a fresh signature for the same Item verifies', () => {
    const { timestamp, signature } = signAutoSyncRequest(KEY, ITEM, NOW)
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp, signature }, NOW)).toBe(true)
  })
  it('the signature is bound to the Item id: it does not verify for another Item', () => {
    const { timestamp, signature } = signAutoSyncRequest(KEY, ITEM, NOW)
    expect(verifyAutoSyncRequest(KEY, { itemId: OTHER, timestamp, signature }, NOW)).toBe(false)
  })
  it('the 5-minute window is enforced in both directions', () => {
    const { timestamp, signature } = signAutoSyncRequest(KEY, ITEM, NOW)
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp, signature }, NOW + AUTO_SYNC_SIGNATURE_WINDOW_MS)).toBe(true)
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp, signature }, NOW + AUTO_SYNC_SIGNATURE_WINDOW_MS + 1)).toBe(false)
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp, signature }, NOW - AUTO_SYNC_SIGNATURE_WINDOW_MS - 1)).toBe(false)
  })
  it('a different key, a tampered signature or malformed fields are rejected', () => {
    const { timestamp, signature } = signAutoSyncRequest(KEY, ITEM, NOW)
    expect(verifyAutoSyncRequest('another-key', { itemId: ITEM, timestamp, signature }, NOW)).toBe(false)
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp, signature: signature.replace(/.$/, c => (c === '0' ? '1' : '0')) }, NOW)).toBe(false)
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp, signature: 'nothex' }, NOW)).toBe(false)
    expect(verifyAutoSyncRequest(KEY, { itemId: 'not-a-uuid', timestamp, signature }, NOW)).toBe(false)
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp: 'x', signature }, NOW)).toBe(false)
    expect(verifyAutoSyncRequest('', { itemId: ITEM, timestamp, signature }, NOW)).toBe(false)
    expect(verifyAutoSyncRequest(KEY, { itemId: undefined, timestamp: undefined, signature: undefined }, NOW)).toBe(false)
  })
  it('signs with a DERIVED sub-key, never with the service-role key itself', () => {
    const { timestamp, signature } = signAutoSyncRequest(KEY, ITEM, NOW)
    const direct = createHmac('sha256', KEY).update(`${ITEM}.${timestamp}`).digest('hex')
    const sub = createHmac('sha256', createHmac('sha256', KEY).update('poweron:plaid-auto-sync:v1').digest()).update(`${ITEM}.${timestamp}`).digest('hex')
    expect(signature).not.toBe(direct)
    expect(signature).toBe(sub)
  })
  it('the kill switch is off unless exactly "true"; the system actor is a fixed marker, not a real user', () => {
    expect(autoSyncEnabled({})).toBe(false)
    expect(autoSyncEnabled({ PLAID_AUTO_SYNC_ENABLED: 'yes' })).toBe(false)
    expect(autoSyncEnabled({ PLAID_AUTO_SYNC_ENABLED: ' true ' })).toBe(true)
    expect(autoSyncActor('org-1')).toEqual({ organizationId: 'org-1', userId: AUTO_SYNC_ACTOR_USER_ID, role: 'owner' })
  })
  it('the base URL is the webhook URL origin (https only), else Netlify URL, else nothing', () => {
    expect(autoSyncBaseUrl({ PLAID_WEBHOOK_URL: 'https://app.example.com/.netlify/functions/plaid-webhook', URL: 'https://other.example.com' })).toBe('https://app.example.com')
    expect(autoSyncBaseUrl({ URL: 'https://site.example.com/' })).toBe('https://site.example.com')
    expect(autoSyncBaseUrl({ PLAID_WEBHOOK_URL: 'http://insecure.example.com/x' })).toBeNull()
    expect(autoSyncBaseUrl({})).toBeNull()
  })
  it('the kick-off posts a signed body to the background function, never throws, and reports unavailable on any failure', async () => {
    const calls: any[] = []
    const ok = vi.fn(async (url: string, init: any) => { calls.push({ url, init }); return { status: 202 } as Response })
    expect(await kickOffItemSync({ baseUrl: 'https://s.example.com', serviceRoleKey: KEY, itemId: ITEM, fetcher: ok as any, now: () => NOW })).toBe('accepted')
    expect(calls[0].url).toBe(`https://s.example.com${AUTO_SYNC_BACKGROUND_PATH}`)
    expect(JSON.parse(calls[0].init.body)).toEqual({ itemId: ITEM })
    expect(verifyAutoSyncRequest(KEY, { itemId: ITEM, timestamp: calls[0].init.headers['x-poweron-ts'], signature: calls[0].init.headers['x-poweron-sig'] }, NOW)).toBe(true)
    expect(await kickOffItemSync({ baseUrl: 'https://s.example.com', serviceRoleKey: KEY, itemId: ITEM, fetcher: (async () => ({ status: 404 })) as any })).toBe('unavailable')
    expect(await kickOffItemSync({ baseUrl: 'https://s.example.com', serviceRoleKey: KEY, itemId: ITEM, fetcher: (async () => { throw new Error('boom') }) as any })).toBe('unavailable')
    expect(await kickOffItemSync({ baseUrl: null, serviceRoleKey: KEY, itemId: ITEM, fetcher: ok as any })).toBe('unavailable')
    expect(await kickOffItemSync({ baseUrl: 'https://s.example.com', serviceRoleKey: '', itemId: ITEM, fetcher: ok as any })).toBe('unavailable')
  })
})
