/**
 * src/lib/uuid.ts
 *
 * Single RFC-4122 UUID format validator shared by server and browser code.
 * Browser-safe: no node:crypto, no secrets, no I/O.
 *
 * Used by:
 *  - the QBO customer-mapping server store (Task 6 safeguard): rejects anything
 *    that is not a real reconciled UUID as poweron_customer_id — names, project
 *    names, customer_reference strings, and temporary 'gc123456' local ids never
 *    pass.
 *  - the billing-draft adapters (Task 7): a customer_id is propagated onto an
 *    invoice draft ONLY when the source record already carries a verified UUID;
 *    it is never inferred from a name.
 *
 * relationship_accounts.id is a UUID (gen_random_uuid). Temporary local ids such
 * as 'gc' + Date.now() are NOT UUIDs and are rejected here.
 */
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** True only when value is a string matching the RFC-4122 UUID format. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}