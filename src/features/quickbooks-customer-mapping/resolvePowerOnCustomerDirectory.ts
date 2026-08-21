/**
 * src/features/quickbooks-customer-mapping/resolvePowerOnCustomerDirectory.ts
 *
 * QBO-4A.5 / QBO-4A.6 — PURE helpers for the "Resolve PowerOn Customer" flow.
 *
 * When a billing source (Service Call / Project / Field Log) has only a legacy name
 * snapshot and NO canonical PowerOn customer identity, the owner must explicitly bind
 * it to an EXISTING PowerOn relationship account before QuickBooks can be linked.
 *
 * CANONICAL IDENTITY CONTRACT (QBO-4A.6): a valid canonical PowerOn customer identity
 * is relationship_accounts.id — a TEXT PRIMARY KEY (stable, immutable, org-scoped),
 * NOT a UUID. Real ids are legacy TEXT values such as 'gc...' / 'import_gc_...'.
 * Identity is therefore NEVER validated by format here. The selectable set is the
 * customer directory FILTERED to entries whose id is a CANONICAL id — i.e. present in
 * the authoritative canonicalIds set sourced from relationship_accounts (see
 * useCanonicalCustomerDirectory). Local-only / unpersisted ids that are NOT in
 * relationship_accounts, and bare name strings, are EXCLUDED — only a real
 * relationship_accounts.id may be selected and persisted.
 *
 * NOTHING here matches by name, auto-selects, or invents an identity. The owner
 * always chooses. No network, no QBO, no mutation — pure functions only.
 */
import type { CustomerDirectoryEntry } from './qboCustomerMappingTypes'

/**
 * True when `id` is a canonical PowerOn customer identity — present in the
 * authoritative canonicalIds set (sourced from relationship_accounts). This is the
 * single identity predicate used by the Resolve flow and the host identity-state
 * derivation. It is NOT a format check: 'gc2', 'import_gc_7', and a UUID are all
 * canonical when they exist as relationship_accounts.id in the org.
 */
export function isCanonicalCustomerId(
  id: string | null | undefined,
  canonicalIds: ReadonlySet<string>,
): id is string {
  return !!id && canonicalIds.has(id)
}

/**
 * The set of PowerOn customers the owner may bind a source to: only directory
 * entries whose id is a CANONICAL relationship_accounts.id (present in canonicalIds).
 * Local-only / unpersisted ids and bare name strings are excluded so they can never
 * be selected/persisted as a QBO mapping identity.
 */
export function selectableResolveEntries(
  directory: readonly CustomerDirectoryEntry[],
  canonicalIds: ReadonlySet<string>,
): CustomerDirectoryEntry[] {
  return (directory || []).filter((c) => isCanonicalCustomerId(c.id, canonicalIds))
}

/**
 * Case-insensitive substring filter over the safe display fields. Used by the
 * Resolve modal's local search box (no network). An empty term returns every
 * selectable entry so the owner can browse. Never auto-selects anything.
 */
export function filterResolveEntries(
  entries: readonly CustomerDirectoryEntry[],
  term: string,
): CustomerDirectoryEntry[] {
  const q = (term || '').trim().toLowerCase()
  if (!q) return [...entries]
  return entries.filter((c) => {
    const fields = [c.company, c.contact, c.email, c.phone]
      .map((v) => (typeof v === 'string' ? v.toLowerCase() : ''))
      .join('  ')
    return fields.includes(q)
  })
}

/** Safe one-line label for a selectable entry (company preferred, then contact). */
export function formatResolveEntryLabel(entry: CustomerDirectoryEntry): string {
  const company = typeof entry.company === 'string' ? entry.company.trim() : ''
  const contact = typeof entry.contact === 'string' ? entry.contact.trim() : ''
  return company || contact || '(unnamed account)'
}