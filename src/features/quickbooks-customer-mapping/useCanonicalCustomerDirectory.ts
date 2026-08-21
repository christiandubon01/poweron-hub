/**
 * src/features/quickbooks-customer-mapping/useCanonicalCustomerDirectory.ts
 *
 * QBO-4A.6 — headless React hook that is the BROWSER authority for the canonical
 * PowerOn customer identity set. It fetches the org's relationship_accounts (via the
 * existing RLS-gated relationshipAccountService — no new server endpoint, no service
 * role) and exposes:
 *
 *   - canonicalIds : Set<string>   — the authoritative set of relationship_accounts.id
 *                                     values for the authenticated org. This is the
 *     single identity predicate source for the Resolve flow + host identity-state
 *     derivation (isCanonicalCustomerId). NOT a format check.
 *   - directory     : CustomerDirectoryEntry[] — the same rows mapped to the display
 *     shape the ResolvePowerOnCustomerModal renders (so the owner sees the REAL
 *     canonical customers: Hernandez Construction, Martin Pools, ...).
 *   - loading       : boolean — true during the first fetch (the modal shows a loading
 *     state instead of a false "no customers" empty state).
 *
 * MODULE CACHE: the fetch is shared across every surface that mounts the hook for the
 * session (one network request, not one per row/per panel). This mirrors the
 * single-fetcher rule established by useQuickBooksConnection. The cache is keyed only
 * by "the current org's relationship_accounts" — there is no per-customer fetch here.
 *
 * SECURITY: this hook reads ONLY relationship_accounts via the browser's RLS-scoped
 * Supabase client (the owner sees only their own org's rows). It performs NO write,
 * imports no QBO server module, and never sends anything to QuickBooks. The server
 * remains the authority for org-scoped existence at the mapping boundary
 * (assertCanonicalPowerOnCustomerId); this hook is the UI-side projection of the same
 * canonical set so the owner can browse/select real customers.
 */
import { useEffect, useState } from 'react'

import { getRelationshipAccountsNormalized } from '@/services/relationshipAccountService'

import type { CustomerDirectoryEntry } from './qboCustomerMappingTypes'

export interface CanonicalCustomerDirectory {
  /** The authoritative set of canonical relationship_accounts.id values for the org. */
  readonly canonicalIds: ReadonlySet<string>
  /** The same rows as display entries for the Resolve modal. */
  readonly directory: CustomerDirectoryEntry[]
  /** True during the first fetch. */
  readonly loading: boolean
  /** A recoverable load error message, or null. */
  readonly error: string | null
}

const EMPTY: CanonicalCustomerDirectory = {
  canonicalIds: new Set<string>(),
  directory: [],
  loading: false,
  error: null,
}

// Module-level cache: one shared fetch per session. Resolved value is cached; a hard
// refresh is exposed via refreshCanonicalCustomerDirectory for the rare post-resolve
// case (a newly upserted relationship_accounts row should appear after a refresh).
type Cache = { promise: Promise<CustomerDirectoryEntry[]> | null }
const cache: Cache = { promise: null }

function toEntries(rows: { id: string; company?: string | null; contact?: string | null; email?: string | null; phone?: string | null }[]): CustomerDirectoryEntry[] {
  return rows.map((r) => ({
    id: String(r.id || ''),
    company: r.company ?? null,
    contact: r.contact ?? null,
    email: r.email ?? null,
    phone: r.phone ?? null,
  }))
}

function loadDirectory(): Promise<CustomerDirectoryEntry[]> {
  if (cache.promise) return cache.promise
  const p = (async () => {
    const rows = await getRelationshipAccountsNormalized()
    return toEntries(rows as any)
  })()
  cache.promise = p
  // On failure, clear the cache so a later mount can retry.
  p.catch(() => {
    cache.promise = null
  })
  return p
}

/** Force a fresh fetch (e.g. after the owner upserts a new relationship account). */
export function refreshCanonicalCustomerDirectory(): void {
  cache.promise = null
}

export function useCanonicalCustomerDirectory(): CanonicalCustomerDirectory {
  const [state, setState] = useState<CanonicalCustomerDirectory>({ ...EMPTY, loading: true })

  useEffect(() => {
    let active = true
    setState((s) => ({ ...s, loading: true, error: null }))
    void loadDirectory()
      .then((directory) => {
        if (!active) return
        const canonicalIds = new Set<string>(directory.map((d) => d.id).filter(Boolean))
        setState({ canonicalIds, directory, loading: false, error: null })
      })
      .catch((err) => {
        if (!active) return
        cache.promise = null
        const message = err instanceof Error ? err.message : 'Could not load the PowerOn customer directory.'
        setState({ canonicalIds: new Set<string>(), directory: [], loading: false, error: message })
      })
    return () => {
      active = false
    }
  }, [])

  return state
}