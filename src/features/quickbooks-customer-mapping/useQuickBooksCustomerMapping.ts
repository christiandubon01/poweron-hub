/**
 * src/features/quickbooks-customer-mapping/useQuickBooksCustomerMapping.ts
 *
 * QBO-4A.4 — headless React hook that drives the owner QuickBooks customer-mapping
 * experience over the existing QBO-4A.3 endpoints. HEADLESS: it returns state + actions
 * and renders nothing. The presentational modal + status component consume it.
 *
 * This hook is the single network boundary for customer mapping in the UI. It lives
 * OUTSIDE src/features/billing-draft so the QBO-2D firewall (no `fetch(` in
 * billing-draft source) stays intact. It imports only the sanitized client + the
 * existing authedJsonHeaders helper — never a server-only QBO module, never a financial
 * authority.
 *
 * Connection: the host passes `connected` when it already knows the QBO connection
 * state (from the shared useQuickBooksConnection hook — no second connection fetcher).
 * When `connected === false` the hook shows `disconnected` and does NOT fetch. When
 * `connected` is unknown (contextual surfaces without the connection hook), the hook
 * loads the mapping optimistically; a not_connected error from a mutation switches the
 * state to `disconnected`.
 *
 * Identity: a null/empty poweronCustomerId yields `unresolved`. The UI must NEVER
 * match by name; the safe unresolved state is shown instead. Canonical PowerOn
 * customer ids are TEXT (relationship_accounts.id — 'gc...', 'import_gc_...'); they
 * are NOT validated by UUID format here (the server is the org-scoped authority).
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { authedJsonHeaders } from '@/services/authedFetch'

import { createQboCustomerMappingClient } from './qboCustomerMappingClient'
import type {
  CreateCustomerInput,
  QboCustomerMappingState,
  QboCustomerSearchResult,
  QboLinkOrigin,
  QboLinkedCustomer,
  QboMappingResult,
} from './qboCustomerMappingTypes'
import { QboCustomerMappingApiError } from './qboCustomerMappingTypes'

export interface UseQuickBooksCustomerMappingArgs {
  /** Canonical PowerOn customer identity (relationship_accounts.id, a TEXT PK); null for name-only/legacy sources. */
  readonly poweronCustomerId: string | null
  /**
   * Host-known QBO connection state. `false` => disconnected (no fetch). `true` or
   * undefined/null => load mapping (unknown is treated optimistically as connected).
   */
  readonly connected?: boolean | null
}

export interface QuickBooksCustomerMappingApi {
  readonly state: QboCustomerMappingState
  readonly busy: boolean
  readonly refresh: () => Promise<void>
  readonly search: (term: string, options?: { activeOnly?: boolean }) => Promise<QboCustomerSearchResult[]>
  readonly link: (qboCustomerId: string) => Promise<QboMappingResult>
  readonly create: (input: CreateCustomerInput) => Promise<QboMappingResult>
  readonly unlink: () => Promise<void>
  /** The link origin of the current linked state, when linked. */
  readonly linkOrigin: QboLinkOrigin | null
}

function linkedState(customer: QboLinkedCustomer, linkOrigin: QboLinkOrigin): QboCustomerMappingState {
  return { kind: 'linked', customer, linkOrigin }
}

export function useQuickBooksCustomerMapping(
  args: UseQuickBooksCustomerMappingArgs,
): QuickBooksCustomerMappingApi {
  const { poweronCustomerId, connected } = args
  const [state, setState] = useState<QboCustomerMappingState>(() => {
    if (connected === false) return { kind: 'disconnected' }
    if (!poweronCustomerId) return { kind: 'unresolved' }
    return { kind: 'loading' }
  })
  const [busy, setBusy] = useState(false)
  const [linkOrigin, setLinkOrigin] = useState<QboLinkOrigin | null>(null)
  // Monotonic token to ignore stale loadMapping responses (e.g. after a customer change).
  const loadToken = useRef(0)
  const clientRef = useRef(
    createQboCustomerMappingClient({ fetchImpl: fetch, getHeaders: authedJsonHeaders }),
  )

  const load = useCallback(async () => {
    if (connected === false) {
      setState({ kind: 'disconnected' })
      return
    }
    if (!poweronCustomerId) {
      setState({ kind: 'unresolved' })
      return
    }
    const token = ++loadToken.current
    setState({ kind: 'loading' })
    try {
      const res = await clientRef.current.loadMapping(poweronCustomerId)
      if (token !== loadToken.current) return // stale
      if (res.linked) {
        setLinkOrigin(res.linkOrigin)
        setState(linkedState(res.customer, res.linkOrigin))
      } else {
        setLinkOrigin(null)
        setState({ kind: 'unlinked' })
      }
    } catch (err) {
      if (token !== loadToken.current) return
      if (err instanceof QboCustomerMappingApiError && err.category === 'not_connected') {
        setState({ kind: 'disconnected' })
        return
      }
      const message = err instanceof Error ? err.message : 'Could not load the QuickBooks customer mapping.'
      setState({ kind: 'error', message })
    }
  }, [poweronCustomerId, connected])

  // (Re)load when the identity or known connection state changes.
  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    await load()
  }, [load])

  const search = useCallback(async (term: string, options?: { activeOnly?: boolean }) => {
    return clientRef.current.search(term, options)
  }, [])

  const runMutation = useCallback(
    async <T>(fn: () => Promise<T>, onNotConnected?: () => void): Promise<T> => {
      setBusy(true)
      try {
        const result = await fn()
        return result
      } catch (err) {
        if (err instanceof QboCustomerMappingApiError && err.category === 'not_connected') {
          setState({ kind: 'disconnected' })
          onNotConnected?.()
        }
        throw err
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const link = useCallback(
    async (qboCustomerId: string): Promise<QboMappingResult> => {
      if (!poweronCustomerId) throw new QboCustomerMappingApiError('bad_request', 'No PowerOn customer to link.')
      const res = await runMutation(() => clientRef.current.link(poweronCustomerId, qboCustomerId))
      setLinkOrigin(res.linkOrigin)
      setState(linkedState(res.customer, res.linkOrigin))
      return res
    },
    [poweronCustomerId, runMutation],
  )

  const create = useCallback(
    async (input: CreateCustomerInput): Promise<QboMappingResult> => {
      if (!poweronCustomerId) throw new QboCustomerMappingApiError('bad_request', 'No PowerOn customer to link.')
      const res = await runMutation(() => clientRef.current.create(poweronCustomerId, input))
      setLinkOrigin(res.linkOrigin)
      setState(linkedState(res.customer, res.linkOrigin))
      return res
    },
    [poweronCustomerId, runMutation],
  )

  const unlink = useCallback(async () => {
    if (!poweronCustomerId) throw new QboCustomerMappingApiError('bad_request', 'No PowerOn customer to unlink.')
    await runMutation(() => clientRef.current.unlink(poweronCustomerId))
    setLinkOrigin(null)
    setState({ kind: 'unlinked' })
  }, [poweronCustomerId, runMutation])

  return { state, busy, refresh, search, link, create, unlink, linkOrigin }
}