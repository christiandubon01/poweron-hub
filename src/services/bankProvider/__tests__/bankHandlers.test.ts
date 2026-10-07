// @ts-nocheck -- the Netlify handlers under test are themselves untyped (ts-nocheck)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { buildHandler as linkToken } from '../../../../netlify/functions/bank/plaid-link-token'
import { buildHandler as exchange } from '../../../../netlify/functions/bank/plaid-exchange'
import { buildHandler as status } from '../../../../netlify/functions/bank/plaid-connection-status'
import { buildHandler as disconnect } from '../../../../netlify/functions/bank/plaid-disconnect'

const ORG_A = '10000000-0000-4000-8000-00000000000a'
const ORG_B = '10000000-0000-4000-8000-00000000000b'
const ITEM = '30000000-0000-4000-8000-000000000001'
const ACCESS = 'access-sandbox-zzzzzzzz-0000-1111-2222-333333333333'

/** Fake Supabase: profiles under RLS + a minimal service client driven by an in-memory item table. */
function world(profile: Record<string, unknown> | null) {
  const calls: string[] = []
  const userClient = () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) }) })
  const serviceClient = () => ({
    from: (t: string) => { calls.push(`from:${t}`); return { select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }), limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) }), order: async () => ({ data: [], error: null }) }) }) } },
    rpc: async (fn: string) => { calls.push(`rpc:${fn}`); return { data: null, error: { message: 'x' } } },
  })
  return { calls, overrides: { verifyUser: async () => ({ id: 'u1' }), userClient, serviceClient, plaidPort: () => plaid } }
}
const plaid = {
  createLinkToken: vi.fn(async () => ({ linkToken: 'link-1', expiration: 'x' })),
  exchangePublicToken: vi.fn(), getItem: vi.fn(), getInstitutionName: vi.fn(), removeItem: vi.fn(),
}
const ev = (method: string, body?: unknown, headers: Record<string, string> = { authorization: 'Bearer t' }) => ({ httpMethod: method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
const ENV_KEYS = ['PLAID_ENV', 'PLAID_CLIENT_ID', 'PLAID_SECRET', 'POWERON_BANK_TOKEN_ENCRYPTION_KEY']
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))
  process.env.PLAID_ENV = 'sandbox'; process.env.PLAID_CLIENT_ID = 'cid'; process.env.PLAID_SECRET = 'sec'
  process.env.POWERON_BANK_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  plaid.createLinkToken.mockClear(); vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }; vi.restoreAllMocks() })

const handlers: Array<[string, (o?: any) => (e: any) => Promise<any>, string, unknown]> = [
  ['plaid-link-token', linkToken, 'POST', {}],
  ['plaid-exchange', exchange, 'POST', { publicToken: 'public-sandbox-abcdefgh' }],
  ['plaid-connection-status', status, 'GET', undefined],
  ['plaid-disconnect', disconnect, 'POST', { itemId: ITEM }],
]

describe('bank connection endpoints (BANK-2 authorization)', () => {
  for (const [name, build, method, body] of handlers) {
    describe(name, () => {
      it('unauthenticated callers get 401 and touch nothing', async () => {
        const w = world({ org_id: ORG_A, role: 'owner', is_active: true })
        const res = await build({ ...w.overrides, verifyUser: async () => null })(ev(method, body, {}))
        expect(res.statusCode).toBe(401)
        expect(w.calls).toEqual([]); expect(plaid.createLinkToken).not.toHaveBeenCalled()
      })
      for (const role of ['employee', 'viewer', 'crew', '', undefined]) {
        it(`role ${JSON.stringify(role)} is forbidden (403) before any bank call`, async () => {
          const w = world({ org_id: ORG_A, role, is_active: true })
          const res = await build(w.overrides)(ev(method, body))
          expect(res.statusCode).toBe(403)
          expect(w.calls).toEqual([]); expect(plaid.createLinkToken).not.toHaveBeenCalled()
        })
      }
      it('inactive accounts, accounts without an organization and missing profiles are forbidden', async () => {
        for (const profile of [{ org_id: ORG_A, role: 'owner', is_active: false }, { org_id: null, role: 'owner', is_active: true }, null]) {
          const res = await build(world(profile).overrides)(ev(method, body))
          expect(res.statusCode).toBe(403)
        }
      })
      it('fails closed (500, generic) when Plaid or the encryption key is not configured, or the environment is not sandbox', async () => {
        for (const mutate of [() => delete process.env.PLAID_SECRET, () => delete process.env.POWERON_BANK_TOKEN_ENCRYPTION_KEY, () => { process.env.PLAID_ENV = 'production' }, () => { process.env.POWERON_BANK_TOKEN_ENCRYPTION_KEY = 'short' }]) {
          mutate()
          const res = await build(world({ org_id: ORG_A, role: 'owner', is_active: true }).overrides)(ev(method, body))
          expect(res.statusCode).toBe(500)
          expect(res.body).toBe(JSON.stringify({ error: 'Bank connection is not configured.' }))
          process.env.PLAID_ENV = 'sandbox'; process.env.PLAID_SECRET = 'sec'; process.env.POWERON_BANK_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
        }
      })
      it('rejects the wrong HTTP method and answers CORS preflight', async () => {
        const w = world({ org_id: ORG_A, role: 'owner', is_active: true })
        expect((await build(w.overrides)(ev('OPTIONS'))).statusCode).toBe(200)
        expect((await build(w.overrides)(ev('DELETE', body))).statusCode).toBe(405)
        expect(w.calls).toEqual([])
      })
    })
  }

  it('owners and admins are allowed; the organization comes from the profile and a spoofed body organization is ignored', async () => {
    for (const role of ['owner', 'admin']) {
      const res = await linkToken(world({ org_id: ORG_A, role, is_active: true }).overrides)(ev('POST', { mode: 'new', organizationId: ORG_B, org_id: ORG_B }))
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ linkToken: 'link-1', mode: 'new' })
    }
    const clientUser = (plaid.createLinkToken.mock.calls.at(-1) as unknown as [{ clientUserId: string }])[0].clientUserId
    expect(clientUser.startsWith(ORG_A)).toBe(true); expect(clientUser).not.toContain(ORG_B)
  })

  it('cross-organization item ids resolve to 404 for status-adjacent actions (the item is not in the caller\'s organization)', async () => {
    for (const [build, body] of [[disconnect, { itemId: ITEM }], [linkToken, { mode: 'update', itemId: ITEM }], [exchange, { mode: 'update_complete', itemId: ITEM }]] as const) {
      const res = await build(world({ org_id: ORG_B, role: 'owner', is_active: true }).overrides)(ev('POST', body))
      expect(res.statusCode).toBe(404)
    }
  })

  it('malformed or oversized bodies are 400 and nothing secret is echoed', async () => {
    const w = world({ org_id: ORG_A, role: 'owner', is_active: true })
    const bad = await exchange(w.overrides)({ httpMethod: 'POST', headers: { authorization: 'Bearer t' }, body: '{not json' })
    expect(bad.statusCode).toBe(400)
    const big = await exchange(w.overrides)(ev('POST', { publicToken: 'public-' + 'x'.repeat(5000) }))
    expect(big!.statusCode).toBe(400)
    expect(big!.body).not.toContain('xxxx')
  })

  it('responses are never cached and unknown failures expose nothing', async () => {
    plaid.createLinkToken.mockRejectedValueOnce(new Error(`boom ${ACCESS}`))
    const res = await linkToken(world({ org_id: ORG_A, role: 'owner', is_active: true }).overrides)(ev('POST', {}))
    expect(res!.statusCode).toBe(502)
    expect(res!.body).not.toContain(ACCESS); expect(res!.body).not.toContain('boom')
    expect((res as unknown as { headers: Record<string, string> }).headers['Cache-Control']).toBe('no-store')
  })

  it('top-level function entries exist for all four endpoints (Netlify does not route nested files)', () => {
    for (const n of ['plaid-link-token', 'plaid-exchange', 'plaid-connection-status', 'plaid-disconnect']) {
      expect(readFileSync(`netlify/functions/${n}.ts`, 'utf8')).toMatch(new RegExp(`from '\\./bank/${n}'`))
    }
  })
})
