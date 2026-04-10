/**
 * Stripe Subscription Configuration
 *
 * Defines the 5 SaaS tiers for PowerOn Hub:
 *   - Solo: Independent electricians ($49/mo)
 *   - Growth: Small contracting firms ($129/mo)
 *   - Pro: Medium contractors ($299/mo)
 *   - ProPlus: Large contractors ($499/mo)
 *   - Enterprise: Custom pricing
 *
 * Each tier has:
 *   - price: monthly cost in USD
 *   - priceId: Stripe Price ID (configured via env vars)
 *   - features: feature flags per tier
 *   - limits: usage limits (users, projects, voiceCaptures, voiceSessions)
 */

export type TierName = 'solo' | 'growth' | 'pro' | 'proplus' | 'enterprise'

export interface TierLimits {
  users: number
  projects: number
  voiceCaptures: number
  voiceSessions: number
}

export interface TierFeatures {
  crewPortal: boolean
  guardian: boolean
  leadScan: 'none' | 'basic' | 'full'
  salesDashboard: boolean
  aiReceptionist: boolean
  blueprintAi: boolean
}

export interface StripeConfig {
  id: string
  name: string
  slug: TierName
  price: number
  priceId: string
  features: TierFeatures
  limits: TierLimits
}

// ── Tier Definitions ─────────────────────────────────────────────────────────

export const STRIPE_TIERS: Record<TierName, StripeConfig> = {
  solo: {
    id: 'tier_solo',
    name: 'Solo',
    slug: 'solo',
    price: 49,
    priceId: import.meta.env.VITE_STRIPE_PRICE_SOLO || 'price_solo_placeholder',
    features: {
      crewPortal: false,
      guardian: false,
      leadScan: 'none',
      salesDashboard: false,
      aiReceptionist: false,
      blueprintAi: false,
    },
    limits: {
      users: 1,
      projects: 5,
      voiceCaptures: 20,
      voiceSessions: 0,
    },
  },

  growth: {
    id: 'tier_growth',
    name: 'Growth',
    slug: 'growth',
    price: 129,
    priceId: import.meta.env.VITE_STRIPE_PRICE_GROWTH || 'price_growth_placeholder',
    features: {
      crewPortal: true,
      guardian: false,
      leadScan: 'basic',
      salesDashboard: false,
      aiReceptionist: false,
      blueprintAi: false,
    },
    limits: {
      users: 3,
      projects: 15,
      voiceCaptures: 999,
      voiceSessions: 0,
    },
  },

  pro: {
    id: 'tier_pro',
    name: 'Pro',
    slug: 'pro',
    price: 299,
    priceId: import.meta.env.VITE_STRIPE_PRICE_PRO || 'price_pro_placeholder',
    features: {
      crewPortal: true,
      guardian: true,
      leadScan: 'full',
      salesDashboard: true,
      aiReceptionist: false,
      blueprintAi: false,
    },
    limits: {
      users: 5,
      projects: 50,
      voiceCaptures: 999,
      voiceSessions: 2,
    },
  },

  proplus: {
    id: 'tier_proplus',
    name: 'Pro Plus',
    slug: 'proplus',
    price: 499,
    priceId: import.meta.env.VITE_STRIPE_PRICE_PROPLUS || 'price_proplus_placeholder',
    features: {
      crewPortal: true,
      guardian: true,
      leadScan: 'full',
      salesDashboard: true,
      aiReceptionist: true,
      blueprintAi: false,
    },
    limits: {
      users: 10,
      projects: 100,
      voiceCaptures: 999,
      voiceSessions: 999,
    },
  },

  enterprise: {
    id: 'tier_enterprise',
    name: 'Enterprise',
    slug: 'enterprise',
    price: 0, // Custom pricing
    priceId: import.meta.env.VITE_STRIPE_PRICE_ENTERPRISE || 'price_enterprise_placeholder',
    features: {
      crewPortal: true,
      guardian: true,
      leadScan: 'full',
      salesDashboard: true,
      aiReceptionist: true,
      blueprintAi: true,
    },
    limits: {
      users: 999,
      projects: 999,
      voiceCaptures: 999,
      voiceSessions: 999,
    },
  },
}

/**
 * Get a tier config by slug.
 */
export function getTierBySlug(slug: TierName | string): StripeConfig | null {
  const tier = STRIPE_TIERS[slug as TierName]
  return tier || null
}

/**
 * Get free tier defaults (no subscription).
 */
export function getFreeTierLimits(): TierLimits {
  return {
    users: 1,
    projects: 2,
    voiceCaptures: 5,
    voiceSessions: 0,
  }
}

/**
 * Get free tier feature flags.
 */
export function getFreeTierFeatures(): TierFeatures {
  return {
    crewPortal: false,
    guardian: false,
    leadScan: 'none',
    salesDashboard: false,
    aiReceptionist: false,
    blueprintAi: false,
  }
}

/**
 * Check if a feature is enabled for a given tier.
 */
export function isFeatureEnabled(tier: StripeConfig | null, feature: keyof TierFeatures): boolean {
  if (!tier) {
    return getFreeTierFeatures()[feature] as boolean
  }
  return tier.features[feature] as boolean
}

/**
 * Check if a limit is exceeded for a given tier.
 */
export function checkLimit(
  tier: StripeConfig | null,
  limitKey: keyof TierLimits,
  currentValue: number,
): { exceeded: boolean; limit: number; remaining: number } {
  const limits = tier?.limits || getFreeTierLimits()
  const limit = limits[limitKey]
  const remaining = Math.max(0, limit - currentValue)
  const exceeded = currentValue >= limit

  return { exceeded, limit, remaining }
}
