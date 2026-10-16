/**
 * storageOverflowBanner.ts — pure correlation helpers for the storage-quota overflow banner.
 *
 * HOTFIX follow-up: the banner must not claim durable recovery until IndexedDB persistence OR
 * a confirming Supabase sync is observed. Confirmations correlate by the immutable generation
 * embedded in the serialized snapshot — completion timestamps cannot prove payload identity.
 */

/** True only when a persistence acknowledgment names the exact warned snapshot. */
export function isSameGeneration(
  candidateGeneration: string | null | undefined,
  referenceGeneration: string | null | undefined,
): boolean {
  if (!candidateGeneration || !referenceGeneration) return false
  return candidateGeneration === referenceGeneration
}

/**
 * Clear the overflow warning only when a cloud acknowledgment names the exact warned edit.
 */
export function shouldClearOverflowWarningOnSync(
  pendingGeneration: string | null,
  acknowledgedGeneration: string | null | undefined,
): boolean {
  return isSameGeneration(acknowledgedGeneration, pendingGeneration)
}

/**
 * Upgrade the banner to "durably backed up on this device" only when the IndexedDB mirror for
 * the exact warned edit actually persisted. Until then the banner stays cautious.
 */
export function shouldMarkDurableOnPersist(
  pendingGeneration: string | null,
  persistedGeneration: string | null | undefined,
): boolean {
  return isSameGeneration(persistedGeneration, pendingGeneration)
}

/** Generic refresh notifications never prove persistence; only an explicit localStorage ACK does. */
export function shouldClearOverflowWarningOnLocalPersistence(
  pendingGeneration: string | null,
  persistence: string | null | undefined,
  persistedGeneration: string | null | undefined,
): boolean {
  return persistence === 'localStorage' && isSameGeneration(persistedGeneration, pendingGeneration)
}
