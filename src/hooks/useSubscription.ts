/**
 * useSubscription — React hook for subscription-based feature gating
 *
 * Fetches the org's current subscription tier and exposes:
 *   - subscription object with tier, features, status
 *   - canUse(feature) helper for quick boolean checks
 *   - quota(resource) helper for numeric limit checks
 *   - loading / error states
 *
 * Caches subscription data for the session to avoid repeated queries.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  getOrgSubscription,
  checkQuotaUsage,
  type OrgSubscription,
} from '@/services/stripe'
import { type TierFeatures } from '@/config/subscriptionTiers'

interface UseSubscriptionReturn {
  subscription: OrgSubscription | null
  loading: boolean
  error: string | null
  /** Check if a boolean feature is enabled or a numeric limit is > 0 */
  canUse: (feature: keyof TierFeatures) => boolean
  /** Get quota usage for a numeric resource */
  checkQuota: (resource: 'leads' | 'projects' | 'users' | 'apiCalls') => Promise<{
    used: number
    limit: number
    remaining: number
    percentUsed: number
  }>
  /** Force refresh subscription data */
  refresh: () => Promise<void>
  /** Shorthand: is the subscription active or trialing? */
  isActive: boolean
  /** Current tier name (e.g., 'Solo', 'Team', 'Enterprise', or 'Free') */
  tierName: string
}

// Simple in-memory cache to avoid hitting Supabase on every component mount
const cache: {
  data: OrgSubscription | null
  orgId: string | null
  timestamp: number
} = { data: null, orgId: null, timestamp: 0 }

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function useSubscription(): UseSubscriptionReturn {
  const { profile } = useAuth()
  const orgId = profile?.org_id
  const [subscription, setSubscription] = useState<OrgSubscription | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchSubscription = useCallback(async (forceRefresh = false) => {
    if (!orgId) {
      setLoading(false)
      return
    }

    // Check cache
    const now = Date.now()
    if (
      !forceRefresh &&
      cache.orgId === orgId &&
      cache.data &&
      now - cache.timestamp < CACHE_TTL
    ) {
      setSubscription(cache.data)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const sub = await getOrgSubscription(orgId)
      if (mountedRef.current) {
        setSubscription(sub)
        cache.data = sub
        cache.orgId = orgId
        cache.timestamp = Date.now()
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load subscription')
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [orgId])

  useEffect(() => {
    mountedRef.current = true
    fetchSubscription()
    return () => {
      mountedRef.current = false
    }
  }, [fetchSubscription])

  const canUse = useCallback(
    (feature: keyof TierFeatures): boolean => {
      if (!subscription) return false
      const value = subscription.features[feature]
      return typeof value === 'boolean' ? value : (value as number) > 0
    },
    [subscription],
  )

  const checkQuota = useCallback(
    async (resource: 'leads' | 'projects' | 'users' | 'apiCalls') => {
      if (!orgId) {
        return { used: 0, limit: 0, remaining: 0, percentUsed: 0 }
      }
      return checkQuotaUsage(orgId, resource)
    },
    [orgId],
  )

  const refresh = useCallback(async () => {
    await fetchSubscription(true)
  }, [fetchSubscription])

  return {
    subscription,
    loading,
    error,
    canUse,
    checkQuota,
    refresh,
    isActive: subscription?.isActive ?? false,
    tierName: subscription?.tier?.name ?? 'Free',
  }
}
