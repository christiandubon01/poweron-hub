/**
 * Tier Gate Service
 *
 * Client-side feature gating logic that checks the current user's subscription tier
 * against feature and limit requirements.
 *
 * Features gated: crewPortal, guardian, leadScanBasic, leadScanFull, salesDashboard,
 *                 aiReceptionist, blueprintAi, voiceSessions, unlimitedProjects
 *
 * Limits gated: maxUsers, maxProjects, maxVoiceCaptures, maxVoiceSessions
 */

import { getOrgSubscription, checkQuotaUsage, type OrgSubscription } from '@/services/stripe'
import { SUBSCRIPTION_TIERS, type SubscriptionTier } from '@/config/subscriptionTiers'

/**
 * Feature names that can be gated
 */
export type GatedFeature =
  | 'crewPortal'
  | 'guardian'
  | 'leadScanBasic'
  | 'leadScanFull'
  | 'salesDashboard'
  | 'aiReceptionist'
  | 'blueprintAi'
  | 'voiceSessions'
  | 'unlimitedProjects'

/**
 * Limit names that can be gated
 */
export type GatedLimit = 'maxUsers' | 'maxProjects' | 'maxVoiceCaptures' | 'maxVoiceSessions'

/**
 * Feature availability mapping by tier
 * Maps features to the minimum tier slug required
 */
const FEATURE_TIER_MAP: Record<GatedFeature, 'solo' | 'team' | 'enterprise' | 'free'> = {
  crewPortal: 'team',
  guardian: 'team',
  leadScanBasic: 'solo',
  leadScanFull: 'team',
  salesDashboard: 'team',
  aiReceptionist: 'enterprise',
  blueprintAi: 'solo',
  voiceSessions: 'team',
  unlimitedProjects: 'enterprise',
}

/**
 * Limit values by tier
 */
const LIMIT_VALUES: Record<string, Record<GatedLimit, number>> = {
  free: {
    maxUsers: 1,
    maxProjects: 2,
    maxVoiceCaptures: 0,
    maxVoiceSessions: 0,
  },
  solo: {
    maxUsers: 1,
    maxProjects: 5,
    maxVoiceCaptures: 50,
    maxVoiceSessions: 10,
  },
  team: {
    maxUsers: 5,
    maxProjects: 25,
    maxVoiceCaptures: 500,
    maxVoiceSessions: 100,
  },
  enterprise: {
    maxUsers: 50,
    maxProjects: 999,
    maxVoiceCaptures: 99999,
    maxVoiceSessions: 99999,
  },
}

/**
 * Check if the current user has access to a specific feature
 *
 * @param feature - The feature to check access for
 * @param currentTier - The user's current subscription tier
 * @returns boolean indicating if the feature is accessible
 */
export function checkFeatureAccess(feature: GatedFeature, currentTier: SubscriptionTier | null): boolean {
  if (!currentTier) return false

  const requiredTier = FEATURE_TIER_MAP[feature]

  // Tier hierarchy: free < solo < team < enterprise
  const tierHierarchy: Record<string, number> = {
    free: 0,
    solo: 1,
    team: 2,
    enterprise: 3,
  }

  const currentLevel = tierHierarchy[currentTier.slug] ?? -1
  const requiredLevel = tierHierarchy[requiredTier] ?? 0

  return currentLevel >= requiredLevel
}

/**
 * Check if the current user has access to a specific limit
 *
 * @param limit - The limit to check
 * @param currentCount - The current usage count
 * @param tierSlug - The user's tier slug
 * @returns boolean indicating if the limit is not exceeded
 */
export function checkLimitAccess(
  limit: GatedLimit,
  currentCount: number,
  tierSlug: string = 'free',
): boolean {
  const tierLimits = LIMIT_VALUES[tierSlug]
  if (!tierLimits) return false

  const maxAllowed = tierLimits[limit]
  return currentCount < maxAllowed
}

/**
 * Get the current user's subscription tier from the store or Supabase
 *
 * @param orgId - The organization ID
 * @returns Promise resolving to the user's subscription object
 */
export async function getCurrentTier(orgId: string): Promise<OrgSubscription> {
  if (!orgId) {
    return {
      id: '',
      orgId: '',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      status: 'none',
      tierSlug: 'free',
      tier: null,
      features: {
        agents: 3,
        leads: 10,
        projects: 2,
        users: 1,
        apiCalls: 500,
        storageGb: 1,
        voiceEnabled: false,
        supportTier: 'community',
      },
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isActive: false,
    }
  }

  return getOrgSubscription(orgId)
}

/**
 * Get an upgrade message for a locked feature
 *
 * @param feature - The feature that is locked
 * @param currentTier - The user's current tier
 * @returns Object with upgrade information
 */
export function getUpgradePrompt(
  feature: GatedFeature,
  currentTier: SubscriptionTier | null,
): {
  featureName: string
  requiredTier: SubscriptionTier
  currentTierName: string
  priceDifference: number
  message: string
  upgradeUrl: string
} {
  const requiredTierSlug = FEATURE_TIER_MAP[feature]
  const requiredTier = SUBSCRIPTION_TIERS[requiredTierSlug]
  const currentTierName = currentTier?.name ?? 'Free'
  const requiredPrice = requiredTier?.monthlyPrice ?? 0
  const currentPrice = currentTier?.monthlyPrice ?? 0
  const priceDifference = Math.max(0, requiredPrice - currentPrice)

  const featureName = formatFeatureName(feature)

  return {
    featureName,
    requiredTier: requiredTier!,
    currentTierName,
    priceDifference,
    message: `${featureName} requires the ${requiredTier?.name} plan or higher.`,
    upgradeUrl: `/billing/upgrade?target=${requiredTierSlug}`,
  }
}

/**
 * Format feature name for display
 */
export function formatFeatureName(feature: GatedFeature): string {
  const nameMap: Record<GatedFeature, string> = {
    crewPortal: 'Crew Portal',
    guardian: 'GUARDIAN',
    leadScanBasic: 'Lead Scan (Basic)',
    leadScanFull: 'Lead Scan (Full)',
    salesDashboard: 'Sales Dashboard',
    aiReceptionist: 'AI Receptionist',
    blueprintAi: 'Blueprint AI',
    voiceSessions: 'Voice Sessions',
    unlimitedProjects: 'Unlimited Projects',
  }
  return nameMap[feature] ?? feature
}

/**
 * Get current limit value for a tier
 */
export function getLimitValue(limit: GatedLimit, tierSlug: string = 'free'): number {
  const tierLimits = LIMIT_VALUES[tierSlug]
  return tierLimits?.[limit] ?? 0
}

/**
 * Check quota usage for a resource
 */
export async function checkQuota(orgId: string, resource: 'leads' | 'projects' | 'users' | 'apiCalls') {
  return checkQuotaUsage(orgId, resource)
}
