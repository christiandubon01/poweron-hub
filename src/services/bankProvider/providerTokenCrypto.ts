/**
 * src/services/bankProvider/providerTokenCrypto.ts
 *
 * SERVER-ONLY AES-256-GCM encryption for bank-provider access tokens at rest.
 *
 * Mirrors the proven QuickBooks design (the QuickBooks token crypto module) without touching it:
 *  - AES-256-GCM authenticated encryption; fresh random 12-byte IV per call; 16-byte tag verified on decrypt.
 *  - Versioned envelope `v1:<iv>:<tag>:<ciphertext>` (base64 parts) so rotation can coexist later.
 *  - Strict 32-byte key from its OWN server-only variable (key separation from QuickBooks): a wrong-length key is refused,
 *    never truncated or padded; the decoded secret is stretched with a domain-separated scrypt salt.
 *  - NEW: context binding. The organization / provider / provider-item identity is authenticated as GCM additional data,
 *    so a ciphertext copied to a different row, item or organization fails to decrypt (fail closed).
 *  - Errors never include plaintext, keys or ciphertext.
 *
 * Imports node:crypto and is only ever imported by server code (netlify/functions/bank/*, src/services/bankProvider/*)
 * and tests. A source-scan test asserts no browser-reachable code imports it. It never reads process.env directly:
 * the key is injected via loadBankTokenEncryptionKey(env).
 */
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

export const BANK_TOKEN_ENCRYPTION_KEY_ENV = 'POWERON_BANK_TOKEN_ENCRYPTION_KEY'
export const BANK_TOKEN_ENVELOPE_VERSION = 'v1'

const KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export class BankTokenKeyError extends Error {
  readonly reason: 'missing' | 'invalid_length'
  constructor(reason: 'missing' | 'invalid_length') {
    super(reason === 'missing' ? `Bank token encryption key missing: ${BANK_TOKEN_ENCRYPTION_KEY_ENV}` : `Bank token encryption key is not 32 bytes: ${BANK_TOKEN_ENCRYPTION_KEY_ENV}`)
    this.name = 'BankTokenKeyError'
    this.reason = reason
  }
}

/** Raised for malformed, tampered, wrong-key or wrong-context ciphertext. The message is deliberately generic. */
export class BankTokenDecryptError extends Error {
  constructor() {
    super('Bank token could not be decrypted.')
    this.name = 'BankTokenDecryptError'
  }
}

export type EnvLike = Record<string, string | undefined>

/** The identity a credential is bound to. Any change to it invalidates the ciphertext. */
export interface TokenContext {
  organizationId: string
  provider: string
  providerItemId: string
}

function contextBytes(context: TokenContext): Buffer {
  if (!context?.organizationId || !context.provider || !context.providerItemId) throw new BankTokenDecryptError()
  return Buffer.from(['poweron-bank-credential-v1', context.organizationId, context.provider, context.providerItemId].join('\u001f'), 'utf8')
}

export function loadBankTokenEncryptionKey(env: EnvLike): Buffer {
  const raw = env[BANK_TOKEN_ENCRYPTION_KEY_ENV]
  if (!raw || !raw.trim()) throw new BankTokenKeyError('missing')
  const decoded = Buffer.from(raw.trim(), 'base64')
  if (decoded.length !== KEY_BYTES) throw new BankTokenKeyError('invalid_length')
  return scryptSync(decoded, 'poweron-bank-token-aes-256-gcm', KEY_BYTES)
}

export function encryptProviderToken(plaintext: string, key: Buffer, context: TokenContext): string {
  if (key.length !== KEY_BYTES) throw new BankTokenKeyError('invalid_length')
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('A token is required to encrypt.')
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES })
  cipher.setAAD(contextBytes(context))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [BANK_TOKEN_ENVELOPE_VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptProviderToken(envelope: string, key: Buffer, context: TokenContext): string {
  if (key.length !== KEY_BYTES) throw new BankTokenKeyError('invalid_length')
  try {
    const parts = typeof envelope === 'string' ? envelope.split(':') : []
    if (parts.length !== 4 || parts[0] !== BANK_TOKEN_ENVELOPE_VERSION || !parts[1] || !parts[2] || !parts[3]) throw new BankTokenDecryptError()
    const iv = Buffer.from(parts[1], 'base64')
    const tag = Buffer.from(parts[2], 'base64')
    if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES) throw new BankTokenDecryptError()
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES })
    decipher.setAAD(contextBytes(context))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new BankTokenDecryptError() // never reveal why
  }
}

/** Shape check only (no secrets): true when a string looks like a v1 envelope. Used to refuse persisting anything else. */
export function looksLikeEnvelope(value: unknown): boolean {
  return typeof value === 'string' && /^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/.test(value)
}
