/**
 * src/services/quickbooks/quickbooksCompanyFingerprint.ts
 *
 * SERVER-ONLY deterministic fingerprint of the current QuickBooks company/realm.
 *
 * Purpose: scope QBO customer mappings to (organization, PowerOn customer,
 * QBO company, environment) so a Sandbox mapping is never reused in Production
 * and a Company-A mapping is never reused after the owner connects Company B.
 *
 * Design (deviation explained per QBO-4A.2 Task 5):
 *  - The fingerprint is SHA-256 of a DOMAIN-SEPARATED prefix + the decrypted
 *    realmId, reusing the repo's existing server-only `hashNonce` crypto helper
 *    (quickbooksTokenCrypto.ts). It is NOT HMAC keyed by the token encryption
 *    key: a keyed HMAC would couple the fingerprint to the (rotation-sensitive)
 *    POWERON_QBO_TOKEN_ENCRYPTION_KEY, so a future token-key rotation would
 *    silently invalidate every existing mapping. A domain-separated plain hash
 *    is stable forever — mappings survive token-key rotation.
 *  - The domain prefix ('poweron-qbo-company-fingerprint-v1:') defeats plain
 *    realmId rainbow tables; the raw realmId is never stored (it stays encrypted
 *    in quickbooks_connections) and the fingerprint is never browser-visible
 *    (the mapping table is RLS-revoked, service-role only).
 *
 * Security properties:
 *  - Deterministic: same realmId -> same fingerprint (required for scoping/lookup).
 *  - Different realmId -> different fingerprint (collision-resistant SHA-256).
 *  - realmId is never logged, never returned alongside the fingerprint, and
 *    never persisted by this helper.
 *  - Server-only: imports quickbooksTokenCrypto (node:crypto), which a
 *    source-scan test asserts no browser-importable code imports. A parallel
 *    assertion guards this module from browser import.
 *
 * This fingerprint is NOT a substitute for realmId when calling Intuit — the
 * Netlify function still decrypts the real realmId via getValidQboAccessToken
 * for API calls. It is identity/scoping only.
 */
import { hashNonce } from './quickbooksTokenCrypto'

/** Domain-separated prefix so the fingerprint is not a plain sha256(realmId). */
const FINGERPRINT_DOMAIN = 'poweron-qbo-company-fingerprint-v1:'

/**
 * Derive the deterministic QBO company fingerprint from a decrypted realmId.
 * Server-only. The realmId never leaves this call as persisted material; only
 * the hex digest is returned to the caller (and stored in the mapping table).
 */
export function computeQboCompanyFingerprint(realmId: string): string {
  const realm = typeof realmId === 'string' ? realmId.trim() : ''
  if (!realm) {
    // Fail closed: an empty realmId cannot produce a meaningful scoping key.
    throw new Error('QuickBooks company fingerprint requires a non-empty realmId.')
  }
  return hashNonce(FINGERPRINT_DOMAIN + realm)
}