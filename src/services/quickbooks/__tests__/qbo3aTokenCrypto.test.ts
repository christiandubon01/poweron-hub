/**
 * QBO-3A token encryption tests (10–16).
 *
 * AES-256-GCM token-at-rest: roundtrips, unique IV, tamper-fail, bad-key
 * fail-closed, and a source-scan proof that browser code never imports the
 * encryption utility.
 */
import { Buffer } from 'node:buffer'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  decryptToken,
  encryptToken,
  loadQboTokenEncryptionKey,
  QuickBooksTokenKeyError,
  QBO_TOKEN_ENCRYPTION_KEY_ENV,
} from '../quickbooksTokenCrypto'

const ROOT = process.cwd()

/** A valid 32-byte base64-encoded secret for tests. */
const VALID_KEY_ENV = Buffer.from(new Array(32).fill(7)).toString('base64')
const key = loadQboTokenEncryptionKey({ [QBO_TOKEN_ENCRYPTION_KEY_ENV]: VALID_KEY_ENV })

describe('QBO-3A token encryption', () => {
  it('10: access token encrypt/decrypt roundtrip', () => {
    const env = encryptToken('ACCESS-TOKEN-SECRET-123', key)
    expect(decryptToken(env, key)).toBe('ACCESS-TOKEN-SECRET-123')
    expect(env).not.toContain('ACCESS-TOKEN-SECRET-123')
  })

  it('11: refresh token encrypt/decrypt roundtrip', () => {
    const env = encryptToken('REFRESH-TOKEN-SECRET-456', key)
    expect(decryptToken(env, key)).toBe('REFRESH-TOKEN-SECRET-456')
    expect(env).not.toContain('REFRESH-TOKEN-SECRET-456')
  })

  it('12: realmId encrypt/decrypt roundtrip', () => {
    const env = encryptToken('realm-123456', key)
    expect(decryptToken(env, key)).toBe('realm-123456')
  })

  it('13: same plaintext produces different ciphertext due to unique IV', () => {
    const a = encryptToken('SAME-PLAINTEXT', key)
    const b = encryptToken('SAME-PLAINTEXT', key)
    expect(a).not.toBe(b)
    expect(decryptToken(a, key)).toBe('SAME-PLAINTEXT')
    expect(decryptToken(b, key)).toBe('SAME-PLAINTEXT')
  })

  it('14: tampered ciphertext fails (auth tag verification)', () => {
    const env = encryptToken('TAMPER-ME', key)
    const parts = env.split(':')
    // Flip the last ciphertext character.
    const ct = parts[3]
    const flipped = (ct[ct.length - 1] === 'A' ? 'B' : 'A') + ct.slice(1)
    // Rebuild a valid-looking but tampered envelope.
    const tampered = [parts[0], parts[1], parts[2], ct.slice(0, -1) + flipped].join(':')
    expect(() => decryptToken(tampered, key)).toThrow()
  })

  it('15: malformed/missing encryption key fails closed', () => {
    // Missing key.
    expect(() => loadQboTokenEncryptionKey({})).toThrow(QuickBooksTokenKeyError)
    // Wrong-length key (16 bytes instead of 32) — must not be truncated/padded.
    const tooShort = Buffer.from(new Array(16).fill(9)).toString('base64')
    expect(() =>
      loadQboTokenEncryptionKey({ [QBO_TOKEN_ENCRYPTION_KEY_ENV]: tooShort }),
    ).toThrow(QuickBooksTokenKeyError)
    // A wrong-length key never yields a working cipher key.
    let badKey: Buffer | null = null
    try {
      badKey = loadQboTokenEncryptionKey({ [QBO_TOKEN_ENCRYPTION_KEY_ENV]: tooShort })
    } catch {
      badKey = null
    }
    expect(badKey).toBeNull()
  })

  it('16: browser/client code never imports the encryption utility', () => {
    // Recursively collect .ts/.tsx source files under src/, excluding tests and
    // the server-only quickbooks service modules themselves.
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
      if (/quickbooksTokenCrypto/.test(src)) offenders.push(f)
    }
    expect(offenders).toEqual([])
    // No VITE_ variant of the encryption key is referenced anywhere in src.
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/VITE_.*QBO_TOKEN_ENCRYPTION_KEY/)
    }
  })

  it('17: browser/client code never imports the server-only QBO-4A mapping/accounting modules', () => {
    // quickbooksCompanyFingerprint imports quickbooksTokenCrypto (node:crypto);
    // quickbooksCustomerMappingStore is the server persistence authority for the
    // RLS-revoked mapping table; qboAccountingClient imports the token authority
    // (which imports node:crypto); qboCustomerContract/qboCustomerCreateInput are
    // the server-only Customer API contract + create-payload authority. None may
    // be imported by browser-reachable code (anything under src/ except the
    // server-only quickbooks service dir).
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
      if (
        /quickbooksCompanyFingerprint|quickbooksCustomerMappingStore|qboAccountingClient|qboCustomerContract|qboCustomerCreateInput/.test(
          src,
        )
      ) {
        offenders.push(f)
      }
    }
    expect(offenders).toEqual([])
  })
})