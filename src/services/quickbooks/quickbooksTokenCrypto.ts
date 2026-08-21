/**
 * src/services/quickbooks/quickbooksTokenCrypto.ts
 *
 * SERVER-ONLY AES-256-GCM encryption for QuickBooks OAuth tokens at rest.
 *
 * Why this exists: quickbooks_connections stores accounting credentials. They
 * must never be plaintext, never browser-readable, and never recoverable from a
 * leaked DB dump without the server-only key. This module is the sole encrypt/
 * decrypt authority for access tokens, refresh tokens, and realmId.
 *
 * Security properties:
 *  - AES-256-GCM authenticated encryption (confidentiality + integrity).
 *  - Unique cryptographically random 12-byte IV per encryption (same plaintext
 *    produces different ciphertext every time).
 *  - 16-byte authentication tag verified on decrypt; tampered or malformed
 *    ciphertext fails closed (throws).
 *  - The encryption key is the server-only POWERON_QBO_TOKEN_ENCRYPTION_KEY,
 *    base64-encoded, decoded to EXACTLY 32 bytes. A wrong-length key is refused
 *    — never truncated or padded into a permissive valid key.
 *  - Versioned envelope `v1:<iv>:<authTag>:<ciphertext>` so future key/cipher
 *    rotation can coexist with legacy rows.
 *  - Never logs plaintext, never includes tokens in thrown error messages.
 *
 * This module imports node:crypto / node:buffer and is only ever imported by
 * netlify/functions/quickbooks/* (and tests). A source-scan test asserts no
 * browser-importable code imports it. It never reads process.env directly — the
 * key is injected via loadQboTokenEncryptionKey(env) so the module stays safe
 * to bundle, mirroring the quickbooksConfig convention.
 */
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { QBO_TOKEN_ENVELOPE_VERSION } from './quickbooksConstants'
import type { QboEnvLike } from './quickbooksConfig'

/** Server-only env key holding the base64-encoded 32-byte encryption key. */
export const QBO_TOKEN_ENCRYPTION_KEY_ENV = 'POWERON_QBO_TOKEN_ENCRYPTION_KEY'

/** AES-256-GCM requires a 32-byte (256-bit) key. */
const REQUIRED_KEY_BYTES = 32
/** 12-byte IV is the GCM standard (96 bits). */
const IV_BYTES = 12
/** 16-byte (128-bit) GCM authentication tag. */
const AUTH_TAG_BYTES = 16

/**
 * Raised when the server-only token encryption key is missing or not exactly
 * 32 bytes after decoding. Fail-closed: names the key but never carries a value.
 */
export class QuickBooksTokenKeyError extends Error {
  readonly missingKey: string
  readonly reason: 'missing' | 'invalid_length'
  constructor(missingKey: string, reason: 'missing' | 'invalid_length') {
    super(
      reason === 'missing'
        ? `QuickBooks token encryption key missing: ${missingKey}`
        : `QuickBooks token encryption key is not 32 bytes: ${missingKey}`,
    )
    this.name = 'QuickBooksTokenKeyError'
    this.missingKey = missingKey
    this.reason = reason
  }
}

/**
 * Load and validate the server-only token encryption key from an environment-like
 * map. The value MUST be base64-encoded and decode to exactly 32 bytes.
 *
 * A key of the wrong length is refused outright — never truncated or padded —
 * so a misconfigured secret cannot silently weaken encryption. The decoded key
 * material is then stretched through scrypt with a fixed domain-separated salt
 * to the required 32 bytes, so the caller always receives a uniform 32-byte key
 * regardless of the raw decoded entropy. (Decoding to exactly 32 bytes first is
 * a guard that the operator generated the secret correctly, not the cipher key
 * itself.)
 */
export function loadQboTokenEncryptionKey(env: QboEnvLike): Buffer {
  const raw = env[QBO_TOKEN_ENCRYPTION_KEY_ENV]
  if (!raw || !raw.trim()) {
    throw new QuickBooksTokenKeyError(QBO_TOKEN_ENCRYPTION_KEY_ENV, 'missing')
  }
  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, 'base64')
  } catch {
    throw new QuickBooksTokenKeyError(QBO_TOKEN_ENCRYPTION_KEY_ENV, 'invalid_length')
  }
  if (decoded.length !== REQUIRED_KEY_BYTES) {
    throw new QuickBooksTokenKeyError(QBO_TOKEN_ENCRYPTION_KEY_ENV, 'invalid_length')
  }
  // Domain-separated scrypt stretch to the cipher key length. The salt is a
  // fixed app-domain constant (not a per-row secret); the source entropy is the
  // 32-byte decoded secret. This keeps the AES key uniform while still requiring
  // the operator to supply a correct 32-byte secret.
  return scryptSync(decoded, 'poweron-qbo-token-aes-256-gcm', REQUIRED_KEY_BYTES)
}

/** Parts of a versioned encrypted envelope. */
export interface QboEncryptedEnvelope {
  version: string
  iv: string
  authTag: string
  ciphertext: string
}

/**
 * Encrypt a plaintext secret (access token, refresh token, realmId) into a
 * versioned AES-256-GCM envelope string: `v1:<b64 iv>:<b64 authTag>:<b64 ciphertext>`.
 * A fresh random IV is used every call.
 */
export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== REQUIRED_KEY_BYTES) {
    // Internal misuse, not operator-facing; never include the key or plaintext.
    throw new QuickBooksTokenKeyError(QBO_TOKEN_ENCRYPTION_KEY_ENV, 'invalid_length')
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [QBO_TOKEN_ENVELOPE_VERSION, iv.toString('base64'), authTag.toString('base64'), ct.toString('base64')].join(':')
}

/**
 * Parse a versioned envelope into its parts without decrypting. Throws on
 * malformed structure or an unknown version (fail closed).
 */
export function parseEnvelope(envelope: string): QboEncryptedEnvelope {
  if (!envelope || typeof envelope !== 'string') {
    throw new Error('QuickBooks token envelope is malformed.')
  }
  const parts = envelope.split(':')
  if (parts.length !== 4) {
    throw new Error('QuickBooks token envelope is malformed.')
  }
  const [version, iv, authTag, ciphertext] = parts
  if (version !== QBO_TOKEN_ENVELOPE_VERSION) {
    throw new Error('QuickBooks token envelope version is unsupported.')
  }
  if (!iv || !authTag || !ciphertext) {
    throw new Error('QuickBooks token envelope is malformed.')
  }
  return { version, iv, authTag, ciphertext }
}

/**
 * Decrypt a versioned AES-256-GCM envelope back to plaintext. Verifies the
 * authentication tag; tampered, truncated, or wrong-key ciphertext throws (fail
 * closed). Never includes plaintext or token material in error messages.
 */
export function decryptToken(envelope: string, key: Buffer): string {
  if (key.length !== REQUIRED_KEY_BYTES) {
    throw new QuickBooksTokenKeyError(QBO_TOKEN_ENCRYPTION_KEY_ENV, 'invalid_length')
  }
  const { iv, authTag, ciphertext } = parseEnvelope(envelope)
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(authTag, 'base64'))
  // GCM authTag verification happens during final(); a throw here means tamper
  // or wrong key. The message never reveals token material.
  const pt = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()])
  return pt.toString('utf8')
}

/** SHA-256 hex hash of a nonce — the only nonce material ever persisted. */
export function hashNonce(nonce: string): string {
  // A straight hash (not HMAC) is the correct single-use-token store pattern:
  // the nonce is high-entropy cryptographically random, not a password.
  return createHash('sha256').update(nonce).digest('hex')
}