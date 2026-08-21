/**
 * src/features/quickbooks-customer-mapping/resolveCreatePrefill.ts
 *
 * QBO-4A.4 — PURE resolver for the Create-customer-in-QuickBooks form prefill.
 *
 * Prefill comes from the ACTUAL reconciled PowerOn relationship account (the in-memory
 * customer directory, e.g. backup.gcContacts — the projection of relationship_accounts),
 * keyed by the reconciled customer UUID. It is NEVER derived from a project name, a
 * service name, a customer_reference string, or any unrelated snapshot. Missing values
 * are simply null (absent) — they are NEVER invented, NEVER manufactured from another
 * field, and NEVER defaulted from a project/service title.
 *
 * The display name is required to create a QBO customer. When the relationship account
 * has no usable display name (neither contact nor company), the prefill is null and the
 * owner types the name themselves — the UI never guesses.
 *
 * Name-only / legacy sources (no reconciled UUID) never reach this resolver: the caller
 * treats them as `unresolved` and shows the safe unresolved state instead.
 */
import type { CreateCustomerPrefill, CustomerDirectoryEntry } from './qboCustomerMappingTypes'

/**
 * Resolve safe Create-form prefill for a reconciled PowerOn customer.
 *
 * @param poweronCustomerId the canonical relationship_accounts.id (a TEXT PK — already
 *   verified canonical by the caller; null/empty yields null prefill).
 * @param directory the in-memory customer directory (no network).
 * @returns prefill with a non-empty displayName, or null when the customer is not in the
 *   directory or has no usable display name.
 */
export function resolveCreatePrefill(
  poweronCustomerId: string | null,
  directory: readonly CustomerDirectoryEntry[],
): CreateCustomerPrefill | null {
  if (!poweronCustomerId) return null
  const entry = directory.find((c) => c.id === poweronCustomerId)
  if (!entry) return null

  const contact = typeof entry.contact === 'string' ? entry.contact.trim() : ''
  const company = typeof entry.company === 'string' ? entry.company.trim() : ''
  // DisplayName is required. Prefer the contact (person) name; fall back to the company
  // name only when there is no contact. Never combine or invent.
  const displayName = contact || company
  if (!displayName) return null

  return {
    displayName,
    companyName: company || null,
    email: typeof entry.email === 'string' && entry.email.trim() ? entry.email.trim() : null,
    phone: typeof entry.phone === 'string' && entry.phone.trim() ? entry.phone.trim() : null,
  }
}