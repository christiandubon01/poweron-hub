/**
 * Tier Gate Service
 *
 * Core feature gating logic for PowerOn Hub subscription tiers.
 * Checks user tier against feature flags and usage limits.
 *
 * Features gated by tier:
 *   - crewPortal      (Solo+)
 *   - guardian        (Team+)
 *   - leadScanBasic   (Solo+)
 *   - leadScanFull    (Team+)
 *   - salesDashboard  (Team+)
 *   - aiReceptionist  (Team+)
 *   - blueprintAi     (Solo+)
 *   - voiceSessions   (Team+)
 *   - unlimitedProjects (Enterprise)
 *
 * Limits gated by tier:
 *   - maxUsers        (Solo: 1, Team: 5, Enterprise: 50)
 *   - maxProjects     (Solo: 5, Team: 25, Enterprise: 999)
 *   - maxVoiceCaptures (Solo: 100, Team: 500, Enterprise: unlimited)
 *   - maxVoiceSessions (Solo: 50, Team: 500, Enterprise: unlimited)
 */

import { getOrgSubscription, checkFeatureAccess as checkFeatureAccessFromStripe, checkQuotaUsage } from '../stripe'
import type { OrgSubscription } from '../stripe'
import { SUBSCRIPTION_TIERS } from '@/config/subscriptionTiers'

// ── Feature gate types ────────────────────────────────────────────────────────

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

export type GatedLimit =
  | 'maxUsers'
  | 'maxProjects'
  | 'maxVoiceCaptures'
  | 'maxVoiceSessions'

// ── Feature gate map ──────────────────────────────────────────────────────────

const FEATURE_GATE_MAP: Record<GatedFeature, string[]> = {
  crewPortal: ['solo', 'team', 'enterprise'],
  guardian: ['team', 'enterprise'],
  leadScanBasic: ['solo', 'team', 'enterprise'],
  leadScanFull: ['team', 'enterprise'],
  salesDashboard: ['team', 'enterprise'],
  aiReceptionist: ['team', 'enterprise'],
  blueprintAi: ['solo', 'team', 'enterprise'],
  voiceSessions: ['team', 'enterprise'],
  unlimitedProjects: ['enterprise'],
}

// ── Limit definitions ─────────────────────────────────────────────────────────

interface LimitDefinition {
  label: string
  free: number
  solo: number
  team: number
  enterprise: number
}

const LIMIT_DEFINITIONS: Record<GatedLimit, LimitDefinition> = {
  maxUsers: {
    label: 'Team Members',
    free: 1,
    solo: 1,
    team: 5,
    enterprise: 50,
  },
  maxProjects: {
    label: 'Concurrent Projects',
    free: 2,
    solo: 5,
    team: 25,
    enterprise: 999,
  },
  maxVoiceCaptures: {
    label: 'Monthly Voice Captures',
    free: 50,
    solo: 100,
    team: 500,
    enterprise: 999999,
  },
  maxVoiceSessions: {
    label: 'Monthly Voice Sessions',
    free: 50,
    solo: 50,
    team: 500,
    enterprise: 999999,
  },
}

// ── Feature upgrade tier map ──────────────────────────────────────────────────

const FEATURE_TIER_UPGRADE_PATH: Record<GatedFeature, string> = {
  crewPortal: 'solo',
  guardian: 'team',
  leadScanBasic: 'solo',
  leadScanFull: 'team',
  salesDashboard: 'team',
  aiReceptionist: 'team',
  blueprintAi: 'solo',
  voiceSessions: 'team',
  unlimitedProjects: 'enterprise',
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Check if a feature is accessible for the given org.
 *
 * @param feature - feature to check
 * @param orgId - organization ID
 * @returns true if feature is accessible, false otherwise
 */
export async function checkFeatureAccess(
  feature: GatedFeature,
  orgId: string,
): Promise<boolean> {
  if (!orgId) return false

  try {
    const sub = await getOrgSubscription(orgId)
    const allowedTiers = FEATURE_GATE_MAP[feature]
    return allowedTiers.includes(sub.tierSlug)
  } catch (err) {
    console.error('[TierGateService] checkFeatureAccess failed:', err)
    return false
  }
}

/**
 * Check if a usage limit has been exceeded.
 *
 * @param limit - limit to check
 * @param currentCount - current usage count
 * @param orgId - organization ID
 * @returns true if within limit, false if exceeded
 */
export async function checkLimitAccess(
  limit: GatedLimit,
  currentCount: number,
  orgId: string,
): Promise<boolean> {
  if (!orgId) return false

  try {
    const sub = await getOrgSubscription(orgId)
    const limitDef = LIMIT_DEFINITIONS[limit]
    const tierSlug = sub.tierSlug as keyof typeof limitDef
    const maxValue = (limitDef[tierSlug] || limitDef.free) as number

    return currentCount < maxValue
  } catch (err) {
    console.error('[TierGateService] checkLimitAccess failed:', err)
    return false
  }
}

/**
 * Get the current user's subscription tier.
 *
 * @param orgId - organization ID
 * @returns subscription object with tier info
 */
export async function getCurrentTier(orgId: string): Promise<OrgSubscription> {
  if (!orgId) {
    return getOrgSubscription('')
  }

  try {
    return await getOrgSubscription(orgId)
  } catch (err) {
    console.error('[TierGateService] getCurrentTier failed:', err)
    return getOrgSubscription('')
  }
}

/**
 * Get an upgrade prompt message for a locked feature.
 *
 * @param feature - feature that is locked
 * @param currentTierSlug - user's current tier slug
 * @returns upgrade prompt with tier info and pricing
 */
export function getUpgradePrompt(feature: GatedFeature, currentTierSlug: string): {
  featureName: string
  description: string
  requiredTierSlug: string
  requiredTierName: string
  currentTierName: string
  currentPrice: number
  upgradePrice: number
  priceDifference: number
  message: string
} {
  const requiredTierSlug = FEATURE_TIER_UPGRADE_PATH[feature]
  const requiredTier = SUBSCRIPTION_TIERS[requiredTierSlug]
  const currentTier = SUBSCRIPTION_TIERS[currentTierSlug] || SUBSCRIPTION_TIERS.solo

  const currentPrice = currentTier.monthlyPrice || 0
  const upgradePrice = requiredTier?.monthlyPrice || 0
  const priceDifference = Math.max(0, upgradePrice - currentPrice)

  // Build feature display names
  const featureNames: Record<GatedFeature, string> = {
    crewPortal: 'Crew Portal',
    guardian: 'GUARDIAN Health Monitor',
    leadScanBasic: 'Lead Scan (Basic)',
    leadScanFull: 'Lead Scan (Full)',
    salesDashboard: 'Sales Dashboard',
    aiReceptionist: 'AI Receptionist',
    blueprintAi: 'Blueprint AI',
    voiceSessions: 'Voice Sessions',
    unlimitedProjects: 'Unlimited Projects',
  }

  const featureName = featureNames[feature]

  const message =
    priceDifference > 0
      ? `Upgrade from ${currentTier.name} to ${requiredTier?.name} for $${priceDifference}/month`
      : `This feature requires ${requiredTier?.name} tier`

  return {
    featureName,
    description: `Access ${featureName} and all ${requiredTier?.name} features`,
    requiredTierSlug,
    requiredTierName: requiredTier?.name ?? 'Unknown',
    currentTierName: currentTier?.name ?? 'Free',
    currentPrice,
    upgradePrice,
    priceDifference,
    message,
  }
}

/**
 * Get the limit definition for a gated limit.
 *
 * @param limit - limit to check
 * @param tierSlug - user's tier slug
 * @returns limit info
 */
export function getLimitInfo(limit: GatedLimit, tierSlug: string): {
  label: string
  limit: number
  tier: string
} {
  const def = LIMIT_DEFINITIONS[limit]
  const key = tierSlug as keyof typeof def
  const value = (def[key] || def.free) as number

  return {
    label: def.label,
    limit: value,
    tier: tierSlug,
  }
}

/**
 * Check all gated features for a given tier and return which are available.
 *
 * @param tierSlug - user's tier slug
 * @returns map of feature -> available
 */
export function getAvailableFeaturesForTier(tierSlug: string): Record<GatedFeature, boolean> {
  const result: Record<GatedFeature, boolean> = {
    crewPortal: false,
    guardian: false,
    leadScanBasic: false,
    leadScanFull: false,
    salesDashboard: false,
    aiReceptionist: false,
    blueprintAi: false,
    voiceSessions: false,
    unlimitedProjects: false,
  }

  Object.keys(FEATURE_GATE_MAP).forEach((feature) => {
    const f = feature as GatedFeature
    const allowedTiers = FEATURE_GATE_MAP[f]
    result[f] = allowedTiers.includes(tierSlug)
  })

  return result
}

export default {
  checkFeatureAccess,
  checkLimitAccess,
  getCurrentTier,
  getUpgradePrompt,
  getLimitInfo,
  getAvailableFeaturesForTier,
}
