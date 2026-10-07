import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  BankTokenDecryptError, BankTokenKeyError, decryptProviderToken, encryptProviderToken, loadBankTokenEncryptionKey, looksLikeEnvelope,
} from '../providerTokenCrypto'
import { loadPlaidConfig, PlaidConfigError } from '../plaidConfig'

const keyEnv = () => ({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })
const key = () => loadBankTokenEncryptionKey(keyEnv())
const ctx = { organizationId: 'org-1', provider: 'plaid', providerItemId: 'item-1' }
const TOKEN = 'access-sandbox-8d6f5a0c-1111-2222-3333-444455556666'

describe('provider token encryption', () => {
  it('round-trips plaintext through an authenticated envelope', () => {
    const k = key()
    const envelope = encryptProviderToken(TOKEN, k, ctx)
    expect(envelope).not.toContain(TOKEN)
    expect(envelope).not.toContain('access-sandbox')
    expect(looksLikeEnvelope(envelope)).toBe(true)
    expect(envelope.split(':')).toHaveLength(4)
    expect(envelope.startsWith('v1:')).toBe(true)
    expect(decryptProviderToken(envelope, k, ctx)).toBe(TOKEN)
  })

  it('uses a fresh random IV: the same plaintext never encrypts the same way twice', () => {
    const k = key()
    const a = encryptProviderToken(TOKEN, k, ctx), b = encryptProviderToken(TOKEN, k, ctx)
    expect(a).not.toBe(b)
    expect(a.split(':')[1]).not.toBe(b.split(':')[1])
    expect(decryptProviderToken(a, k, ctx)).toBe(decryptProviderToken(b, k, ctx))
  })

  it('rejects malformed, truncated and tampered ciphertext (fail closed, generic error)', () => {
    const k = key()
    const good = encryptProviderToken(TOKEN, k, ctx)
    const [v, iv, tag, ct] = good.split(':')
    for (const bad of ['', 'garbage', 'v1:a:b', `v2:${iv}:${tag}:${ct}`, `v1::${tag}:${ct}`, `v1:${iv}:${tag}:`, `${v}:${iv}:${tag}`, `${v}:${iv}:${tag}:${ct}:extra`]) {
      expect(() => decryptProviderToken(bad, k, ctx), bad).toThrow(BankTokenDecryptError)
    }
    const flipped = Buffer.from(ct, 'base64'); flipped[0] ^= 0xff
    expect(() => decryptProviderToken(`${v}:${iv}:${tag}:${flipped.toString('base64')}`, k, ctx)).toThrow(BankTokenDecryptError)
    const badTag = Buffer.from(tag, 'base64'); badTag[0] ^= 0xff
    expect(() => decryptProviderToken(`${v}:${iv}:${badTag.toString('base64')}:${ct}`, k, ctx)).toThrow(BankTokenDecryptError)
    try { decryptProviderToken('garbage', k, ctx) } catch (e) { expect(String((e as Error).message)).not.toMatch(/access|garbage|key/i) }
  })

  it('rejects the wrong key', () => {
    const envelope = encryptProviderToken(TOKEN, key(), ctx)
    expect(() => decryptProviderToken(envelope, key(), ctx)).toThrow(BankTokenDecryptError)
  })

  it('binds the ciphertext to its organization, provider and item: a copied credential does not decrypt elsewhere', () => {
    const k = key()
    const envelope = encryptProviderToken(TOKEN, k, ctx)
    expect(() => decryptProviderToken(envelope, k, { ...ctx, organizationId: 'org-2' })).toThrow(BankTokenDecryptError)
    expect(() => decryptProviderToken(envelope, k, { ...ctx, providerItemId: 'item-2' })).toThrow(BankTokenDecryptError)
    expect(() => decryptProviderToken(envelope, k, { ...ctx, provider: 'other' })).toThrow(BankTokenDecryptError)
    expect(() => decryptProviderToken(envelope, k, { organizationId: '', provider: 'plaid', providerItemId: 'item-1' })).toThrow(BankTokenDecryptError)
    expect(decryptProviderToken(envelope, k, ctx)).toBe(TOKEN)
  })

  it('fails closed without a valid key: missing, blank and wrong-length are refused (never padded)', () => {
    expect(() => loadBankTokenEncryptionKey({})).toThrow(BankTokenKeyError)
    expect(() => loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: '   ' })).toThrow(BankTokenKeyError)
    for (const bytes of [16, 24, 31, 33, 64]) {
      expect(() => loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: randomBytes(bytes).toString('base64') }), `${bytes}`).toThrow(BankTokenKeyError)
    }
    expect(() => encryptProviderToken(TOKEN, Buffer.alloc(16), ctx)).toThrow(BankTokenKeyError)
    expect(() => encryptProviderToken('', key(), ctx)).toThrow()
    try { loadBankTokenEncryptionKey({ POWERON_BANK_TOKEN_ENCRYPTION_KEY: 'AAAA' }) } catch (e) { expect(String((e as Error).message)).not.toContain('AAAA') }
  })

  it('uses its own key variable, separate from QuickBooks, and QuickBooks crypto is untouched', () => {
    expect(() => loadBankTokenEncryptionKey({ POWERON_QBO_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64') })).toThrow(BankTokenKeyError)
    const qbo = readFileSync('src/services/quickbooks/quickbooksTokenCrypto.ts', 'utf8')
    expect(qbo).toContain('POWERON_QBO_TOKEN_ENCRYPTION_KEY')
    expect(qbo).not.toMatch(/BANK_TOKEN|bankProvider/)
  })
})

describe('Plaid configuration (sandbox only, fail closed)', () => {
  const ok = { PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'cid', PLAID_SECRET: 'sec' }
  it('accepts sandbox with credentials and records the Transactions product and the locked 90-day window', () => {
    const c = loadPlaidConfig(ok)
    expect(c).toMatchObject({ environment: 'sandbox', countryCodes: ['US'], language: 'en', products: ['transactions'], transactionsDaysRequested: 90 })
    expect((c as unknown as Record<string, unknown>).consentedProducts).toBeUndefined()
    expect(c.clientName.length).toBeLessThanOrEqual(30)
    expect(loadPlaidConfig({ ...ok, PLAID_ENV: ' Sandbox ' }).environment).toBe('sandbox')
  })
  it('never defaults and refuses production or any other environment', () => {
    expect(() => loadPlaidConfig({ PLAID_CLIENT_ID: 'cid', PLAID_SECRET: 'sec' })).toThrow(PlaidConfigError)
    for (const env of ['production', 'development', 'prod', 'live', 'sandbox2', 'true']) expect(() => loadPlaidConfig({ ...ok, PLAID_ENV: env }), env).toThrow(/Unsupported Plaid environment/)
  })
  it('requires both credentials and never echoes their values', () => {
    expect(() => loadPlaidConfig({ PLAID_ENV: 'sandbox', PLAID_SECRET: 'sec' })).toThrow(/PLAID_CLIENT_ID/)
    expect(() => loadPlaidConfig({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'cid' })).toThrow(/PLAID_SECRET/)
    try { loadPlaidConfig({ PLAID_ENV: 'production', PLAID_CLIENT_ID: 'cid-VALUE', PLAID_SECRET: 'sec-VALUE' }) } catch (e) { expect(String((e as Error).message)).not.toMatch(/VALUE/) }
  })
})

describe('server-only boundary', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
  const read = (p: string) => readFileSync(p, 'utf8')

  it('no browser-reachable code imports the Plaid SDK, the crypto helper, the config, the port or the repo', () => {
    const browser = walk('src').filter(f => /\.tsx?$/.test(f) && !/__tests__|\.test\./.test(f) && !f.replace(/\\/g, '/').includes('src/services/bankProvider/'))
    expect(browser.length).toBeGreaterThan(500)
    const offenders = browser.filter(f => /from ['"]plaid['"]|providerTokenCrypto|plaidPort|plaidConfig|bankConnectionRepo|bankConnectionService/.test(read(f)))
    expect(offenders).toEqual([])
  })

  it('no VITE_ variable carries a Plaid or bank secret, and the example documents server-only names', () => {
    const everything = [...walk('src'), 'vite.config.ts', '.env.local.example'].filter(f => !/__tests__/.test(f) && /\.(tsx?|example)$/.test(f))
    expect(everything.filter(f => /VITE_PLAID|VITE_.*BANK_TOKEN/.test(read(f)))).toEqual([])
    const example = read('.env.local.example')
    expect(example).toMatch(/^PLAID_ENV=sandbox$/m)
    expect(example).toMatch(/^PLAID_SECRET=your-plaid-SANDBOX-secret$/m)
    expect(example).toMatch(/^POWERON_BANK_TOKEN_ENCRYPTION_KEY=base64-of-32-random-bytes$/m)
  })

  it('the browser feature calls only the authenticated functions and never a Plaid API host', () => {
    const feature = walk('src/features/bank-connection').map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(feature).not.toMatch(/sandbox\.plaid\.com|production\.plaid\.com|api\.plaid\.com/)
    expect(feature).not.toMatch(/PLAID_SECRET|PLAID_CLIENT_ID|access_token|accessToken|encrypted/)
    expect(feature).toMatch(/cdn\.plaid\.com\/link\/v2\/stable\/link-initialize\.js/)
    expect(feature).not.toMatch(/localStorage|sessionStorage/)
  })

  it('the CSP allows Plaid Link script and frame from cdn.plaid.com and nothing broader', () => {
    const csp = read('netlify.toml').match(/Content-Security-Policy = "([^"]+)"/)![1]
    expect(csp).toMatch(/script-src[^;]*https:\/\/cdn\.plaid\.com/)
    expect(csp).toMatch(/frame-src[^;]*https:\/\/cdn\.plaid\.com/)
    expect(csp).not.toMatch(/\*\.plaid\.com|https:\/\/plaid\.com|plaid\.com\/\*/)
  })
})
