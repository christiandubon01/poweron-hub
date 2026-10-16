import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { contextFor, registerItemWebhook } from '../bankConnectionService'
import { createPlaidSdkPort } from '../plaidPort'
import { encryptProviderToken, loadBankTokenEncryptionKey } from '../providerTokenCrypto'

const ORG = '10000000-0000-4000-8000-00000000000a'
const ITEM = '30000000-0000-4000-8000-000000000001'
const owner = { organizationId: ORG, userId: 'u-owner', role: 'owner' }
const URL_ = 'https://app.example.com/.netlify/functions/plaid-webhook'
const ACCESS = 'access-production-zzzzzzzz-0000-1111-2222-333333333333'
const KEY = loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })

function setup(over: { environment?: 'production' | 'sandbox'; webhook?: string | null; url?: string | null; status?: string } = {}) {
  const env = over.environment ?? 'production'
  const registered = { url: over.webhook === undefined ? null : over.webhook }
  const plaid = {
    getItem: vi.fn(async () => ({ itemId: 'plaid-item', institutionId: 'ins_1', hasError: false, webhook: registered.url })),
    updateItemWebhook: vi.fn(async (_t: string, url: string) => { registered.url = url }),
    removeItem: vi.fn(), createLinkToken: vi.fn(), syncTransactions: vi.fn(), exchangePublicToken: vi.fn(),
  }
  const repo = {
    getItem: vi.fn(async () => ({ id: ITEM, provider: 'plaid', providerItemId: 'plaid-item', status: over.status ?? 'healthy', environment: env })),
    getActiveCredential: vi.fn(async () => encryptProviderToken(ACCESS, KEY, contextFor(owner, 'plaid', 'plaid-item'))),
  }
  const deps = { plaid, repo, key: KEY, environment: env, webhookUrl: over.url === undefined ? URL_ : over.url, log: vi.fn() } as any
  return { plaid, repo, deps }
}

describe('PLAID-2A one-time webhook registration on the EXISTING item', () => {
  it('needs the typed confirmation, an owner/admin, and a configured webhook address; otherwise changes nothing', async () => {
    const s = setup()
    await expect(registerItemWebhook(s.deps, owner, { itemId: ITEM })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(registerItemWebhook(s.deps, owner, { itemId: ITEM, confirm: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(registerItemWebhook(s.deps, { ...owner, role: 'crew' }, { itemId: ITEM, confirm: 'REGISTER' })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(registerItemWebhook(setup({ url: null }).deps, owner, { itemId: ITEM, confirm: 'REGISTER' })).rejects.toMatchObject({ code: 'feature_disabled' })
    expect(s.plaid.updateItemWebhook).not.toHaveBeenCalled(); expect(s.plaid.getItem).not.toHaveBeenCalled()
  })
  it('points the existing item at the webhook address with its own stored credential, without reconnecting, removing or re-linking anything', async () => {
    const s = setup()
    expect(await registerItemWebhook(s.deps, owner, { itemId: ITEM, confirm: 'REGISTER' })).toEqual({ id: ITEM, registered: true, changed: true })
    expect(s.plaid.updateItemWebhook).toHaveBeenCalledTimes(1); expect(s.plaid.updateItemWebhook).toHaveBeenCalledWith(ACCESS, URL_)
    expect(s.plaid.removeItem).not.toHaveBeenCalled(); expect(s.plaid.createLinkToken).not.toHaveBeenCalled(); expect(s.plaid.exchangePublicToken).not.toHaveBeenCalled()
  })
  it('a second press is a no-op once the address is registered', async () => {
    const s = setup()
    await registerItemWebhook(s.deps, owner, { itemId: ITEM, confirm: 'REGISTER' })
    expect(await registerItemWebhook(s.deps, owner, { itemId: ITEM, confirm: 'REGISTER' })).toEqual({ id: ITEM, registered: true, changed: false })
    expect(s.plaid.updateItemWebhook).toHaveBeenCalledTimes(1)
  })
  it('an item that already points at the address is left alone', async () => {
    const s = setup({ webhook: URL_ })
    expect(await registerItemWebhook(s.deps, owner, { itemId: ITEM, confirm: 'REGISTER' })).toMatchObject({ changed: false })
    expect(s.plaid.updateItemWebhook).not.toHaveBeenCalled()
  })
  it('production items only, and not a disconnected one', async () => {
    await expect(registerItemWebhook(setup({ environment: 'sandbox' }).deps, owner, { itemId: ITEM, confirm: 'REGISTER' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(registerItemWebhook(setup({ status: 'disconnected' }).deps, owner, { itemId: ITEM, confirm: 'REGISTER' })).rejects.toMatchObject({ code: 'conflict' })
  })
  it('a Plaid failure is reported safely and the item is unchanged', async () => {
    const s = setup(); s.plaid.updateItemWebhook.mockRejectedValueOnce(new Error('secret detail'))
    await expect(registerItemWebhook(s.deps, owner, { itemId: ITEM, confirm: 'REGISTER' })).rejects.toMatchObject({ code: 'plaid_unavailable', message: expect.not.stringContaining('secret') })
  })
  it('the Plaid adapter uses /item/webhook/update and /item/get only, and exposes the registered address', async () => {
    const api = { itemWebhookUpdate: vi.fn(async () => ({ data: {} })), itemGet: vi.fn(async () => ({ data: { item: { item_id: 'i', institution_id: 'ins_1', webhook: URL_ } } })) }
    const port = createPlaidSdkPort({ environment: 'production', clientId: 'c', secret: 's', clientName: 'x', countryCodes: ['US'], language: 'en', products: ['transactions'], transactionsDaysRequested: 90, webhookUrl: null, redirectUri: null } as any, api as any)
    await port.updateItemWebhook!(ACCESS, URL_)
    expect(api.itemWebhookUpdate).toHaveBeenCalledWith({ access_token: ACCESS, webhook: URL_ })
    expect((await port.getItem(ACCESS)).webhook).toBe(URL_)
  })
  it('the plaid-sync endpoint exposes it as the typed-confirmation action register_webhook, behind the same owner authentication', () => {
    const src = readFileSync('netlify/functions/bank/plaid-sync.ts', 'utf8')
    expect(src).toMatch(/body\.action === 'register_webhook'[^\n]*registerItemWebhook\(auth\.deps, auth\.actor/)
    expect(src.indexOf('resolveBankContext(event')).toBeLessThan(src.indexOf("body.action === 'register_webhook'"))
  })
})
