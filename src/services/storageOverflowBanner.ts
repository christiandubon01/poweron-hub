/**
 * storageOverflowBanner.ts — pure correlation helpers for the storage-quota overflow banner.
 *
 * HOTFIX follow-up: the banner must not claim durable recovery until IndexedDB persistence OR
 * a confirming Supabase sync is observed, and a sync/persist confirmation for an OLDER edit
 * must not clear a warning raised by a NEWER, still-pending edit.
 *
 * Every timestamp here is produced by `new Date().toISOString()` on the same device (fixed
 * length, UTC, trailing 'Z'), so lexical string comparison equals chronological comparison.
 */

/** True when `candidateIso` is at least as new as `referenceIso`. Missing values => false. */
export function isAtLeastAsNew(
  candidateIso: string | null | undefined,
  referenceIso: string | null | undefined,
): boolean {
  if (!candidateIso || !referenceIso) return false
  return candidateIso >= referenceIso
}

/**
 * Clear the overflow warning only when a CONFIRMED cloud sync covered the warned edit (or a
 * later one). A sync that was already in flight for an earlier snapshot (its push timestamp is
 * older than the warned edit) must NOT clear the warning — that edit is not in the cloud yet.
 */
export function shouldClearOverflowWarningOnSync(
  pendingWarnAt: string | null,
  syncedAt: string | null | undefined,
): boolean {
  return isAtLeastAsNew(syncedAt ?? null, pendingWarnAt)
}

/**
 * Upgrade the banner to "durably backed up on this device" only when the IndexedDB mirror for
 * the warned edit (or a later one) actually persisted. Until then the banner stays cautious and
 * claims no durable recovery.
 */
export function shouldMarkDurableOnPersist(
  pendingWarnAt: string | null,
  persistedAt: string | null | undefined,
): boolean {
  return isAtLeastAsNew(persistedAt ?? null, pendingWarnAt)
}
