/**
 * useSubscription Hook
 *
 * React hook that returns the current user's subscription state,
 * with caching in Zustand and auto-refresh on mount.
 *
 * Returns:
 *   - tier: current subscription tier slug
 *   - features: available features from tier
 *   - limits: usage limits for tier
 *   - isLoading: data fetch in progress
 *   - canAccess(feature): check if feature is accessible
 *   - checkLimit(limit, count): check if count is within limit
 */

import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { getCurrentTier, checkFeatureAccess, checkLimitAccess } from '@/services/stripe/TierGateService'
import type { GatedFeature, GatedLimit } from '@/services/stripe/TierGateService'
import { getOrgSubscription } from '@/services/stripe'
import type { OrgSubscription } from '@/services/stripe'

// ── Zustand cache store ───────────────────────────────────────────────────────

interface SubscriptionCacheState {
  subscription: OrgSubscription | null
  lastFetchTime: number | null
  setSubscription: (sub: OrgSubscription) => void
  isExpired: () => boolean
}

const CACHE_DURATION_MS = 5 * 60 * 1000 // 5 minutes

const useSubscriptionCache = create<SubscriptionCacheState>((set, get) => ({
  subscription: null,
  lastFetchTime: null,

  setSubscription: (sub: OrgSubscription) => {
    set({
      subscription: sub,
      lastFetchTime: Date.now(),
    })
  },

  isExpired: () => {
    const { lastFetchTime } = get()
    if (!lastFetchTime) return true
    return Date.now() - lastFetchTime > CACHE_DURATION_MS
  },
}))

// ── Hook implementation ───────────────────────────────────────────────────────

interface UseSubscriptionReturn {
  tier: string
  features: Record<string, number | boolean | string>
  limits: Record<string, number>
  isLoading: boolean
  canAccess: (feature: GatedFeature) => Promise<boolean>
  checkLimit: (limit: GatedLimit, currentCount: number) => Promise<boolean>
  refresh: () => Promise<void>
}

/**
 * Hook to access subscription state.
 *
 * @param orgId - organization ID (required)
 * @returns subscription state and access functions
 */
export function useSubscription(orgId?: string): UseSubscriptionReturn {
  const [isLoading, setIsLoading] = useState(false)
  const { subscription, setSubscription, isExpired } = useSubscriptionCache()

  // Auto-refresh on mount and when orgId changes
  useEffect(() => {
    if (!orgId) return

    const refresh = async () => {
      if (!isExpired()) return // Use cache if fresh

      setIsLoading(true)
      try {
        const sub = await getOrgSubscription(orgId)
        setSubscription(sub)
      } catch (err) {
        console.error('[useSubscription] refresh failed:', err)
      } finally {
        setIsLoading(false)
      }
    }

    refresh()
  }, [orgId, isExpired, setSubscription])

  const currentSub = subscription || {
    id: '',
    orgId: orgId || '',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: 'none' as const,
    tierSlug: 'free',
    tier: null,
    features: {} as Record<string, number | boolean | string>,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    isActive: false,
  }

  const features = (currentSub.features as Record<string, number | boolean | string>) || {}
  const maxUsers = (features && 'users' in features ? Number(features.users) : 1)
  const maxProjects = (features && 'projects' in features ? Number(features.projects) : 2)
  const maxVoiceCaptures = (features && 'apiCalls' in features ? Number(features.apiCalls) : 50)
  const maxVoiceSessions = (features && 'agents' in features ? Number(features.agents) : 3)

  return {
    tier: currentSub.tierSlug,
    features,
    limits: {
      maxUsers,
      maxProjects,
      maxVoiceCaptures,
      maxVoiceSessions,
    },
    isLoading,
    canAccess: async (feature: GatedFeature) => {
      if (!orgId) return false
      return checkFeatureAccess(feature, orgId)
    },
    checkLimit: async (limit: GatedLimit, currentCount: number) => {
      if (!orgId) return false
      return checkLimitAccess(limit, currentCount, orgId)
    },
    refresh: async () => {
      if (!orgId) return
      setIsLoading(true)
      try {
        const sub = await getOrgSubscription(orgId)
        setSubscription(sub)
      } catch (err) {
        console.error('[useSubscription] refresh failed:', err)
      } finally {
        setIsLoading(false)
      }
    },
  }
}

export default useSubscription
