/**
 * Subscription Tier Configuration
 *
 * Defines the three SaaS tiers for PowerOn Hub:
 *   - Solo: Independent electricians ($49/mo)
 *   - Team: Small contracting firms ($199/mo)
 *   - Enterprise: Large organizations ($999/mo)
 *
 * Feature limits are enforced client-side via useSubscription hook
 * and server-side via RLS + subscription_status checks.
 */

export interface TierFeatures {
  agents: number         // Number of AI agents available
  leads: number          // Max leads per month
  projects: number       // Max concurrent projects
  users: number          // Team members
  apiCalls: number       // Monthly API calls
  storageGb: number
  voiceEnabled: boolean  // ECHO voice agent
  supportTier: 'community' | 'email' | '24h_phone'
}

export interface SubscriptionTier {
  id: string
  name: string
  slug: 'solo' | 'team' | 'enterprise'
  description: string
  monthlyPrice: number
  annualPrice: number
  stripePriceIdMonthly: string
  stripePriceIdAnnual: string
  features: TierFeatures
}

export const SUBSCRIPTION_TIERS: Record<string, SubscriptionTier> = {
  solo: {
    id: 'tier_solo',
    name: 'Solo',
    slug: 'solo',
    description: 'For independent electricians',
    monthlyPrice: 49,
    annualPrice: 490,
    stripePriceIdMonthly: import.meta.env.VITE_STRIPE_PRICE_SOLO_MONTHLY || 'price_solo_monthly',
    stripePriceIdAnnual: import.meta.env.VITE_STRIPE_PRICE_SOLO_ANNUAL || 'price_solo_annual',
    features: {
      agents: 8,
      leads: 100,
      projects: 5,
      users: 1,
      apiCalls: 10000,
      storageGb: 5,
      voiceEnabled: false,
      supportTier: 'email',
    },
  },
  team: {
    id: 'tier_team',
    name: 'Team',
    slug: 'team',
    description: 'For small contracting firms (2-10 people)',
    monthlyPrice: 199,
    annualPrice: 1990,
    stripePriceIdMonthly: import.meta.env.VITE_STRIPE_PRICE_TEAM_MONTHLY || 'price_team_monthly',
    stripePriceIdAnnual: import.meta.env.VITE_STRIPE_PRICE_TEAM_ANNUAL || 'price_team_annual',
    features: {
      agents: 11,
      leads: 500,
      projects: 25,
      users: 5,
      apiCalls: 100000,
      storageGb: 50,
      voiceEnabled: true,
      supportTier: '24h_phone',
    },
  },
  enterprise: {
    id: 'tier_enterprise',
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For large organizations',
    monthlyPrice: 999,
    annualPrice: 9990,
    stripePriceIdMonthly: import.meta.env.VITE_STRIPE_PRICE_ENTERPRISE_MONTHLY || 'price_enterprise_monthly',
    stripePriceIdAnnual: import.meta.env.VITE_STRIPE_PRICE_ENTERPRISE_ANNUAL || 'price_enterprise_annual',
    features: {
      agents: 11,
      leads: 99999,
      projects: 999,
      users: 50,
      apiCalls: 1000000,
      storageGb: 500,
      voiceEnabled: true,
      supportTier: '24h_phone',
    },
  },
}

/**
 * Get tier by slug.
 */
export function getTier(slug: string): SubscriptionTier | undefined {
  return SUBSCRIPTION_TIERS[slug]
}

/**
 * Get the default (free trial) tier features.
 * Used when no active subscription exists.
 */
export function getFreeTierFeatures(): TierFeatures {
  return {
    agents: 3,            // Only NEXUS, PULSE, BLUEPRINT
    leads: 10,
    projects: 2,
    users: 1,
    apiCalls: 500,
    storageGb: 1,
    voiceEnabled: false,
    supportTier: 'community',
  }
}

/**
 * Check if a feature is available in the given tier.
 */
export function isFeatureAvailable(
  tier: SubscriptionTier | null,
  feature: keyof TierFeatures
): boolean {
  const features = tier?.features || getFreeTierFeatures()
  const value = features[feature]
  return typeof value === 'boolean' ? value : (value as number) > 0
}
