/**
 * StripeConfig.ts
 * Stripe tier definitions and configuration for PowerOn Hub SaaS
 */

export interface TierLimits {
  users: number;
  projects: number;
  voiceCaptures: number;
  voiceSessions: number;
}

export interface TierFeatures {
  crewPortal: boolean;
  guardian: boolean;
  leadScan: 'none' | 'basic' | 'full';
  salesDashboard: boolean;
  aiReceptionist: boolean;
  blueprintAi: boolean;
}

export interface StripeTier {
  id: string;
  name: string;
  price: number;
  priceId: string;
  features: TierFeatures;
  limits: TierLimits;
}

export const STRIPE_TIERS: Record<string, StripeTier> = {
  solo: {
    id: 'solo',
    name: 'Solo',
    price: 49,
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_SOLO || 'price_solo_placeholder',
    features: {
      crewPortal: false,
      guardian: true,
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
    id: 'growth',
    name: 'Growth',
    price: 129,
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_GROWTH || 'price_growth_placeholder',
    features: {
      crewPortal: true,
      guardian: true,
      leadScan: 'basic',
      salesDashboard: false,
      aiReceptionist: false,
      blueprintAi: true,
    },
    limits: {
      users: 3,
      projects: 15,
      voiceCaptures: 999,
      voiceSessions: 2,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 299,
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_PRO || 'price_pro_placeholder',
    features: {
      crewPortal: true,
      guardian: true,
      leadScan: 'full',
      salesDashboard: true,
      aiReceptionist: false,
      blueprintAi: true,
    },
    limits: {
      users: 5,
      projects: 50,
      voiceCaptures: 999,
      voiceSessions: 999,
    },
  },
  proplus: {
    id: 'proplus',
    name: 'Pro Plus',
    price: 499,
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_PROPLUS || 'price_proplus_placeholder',
    features: {
      crewPortal: true,
      guardian: true,
      leadScan: 'full',
      salesDashboard: true,
      aiReceptionist: true,
      blueprintAi: true,
    },
    limits: {
      users: 10,
      projects: 100,
      voiceCaptures: 999,
      voiceSessions: 999,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 0, // Custom pricing
    priceId: import.meta.env.VITE_STRIPE_PRICE_ID_ENTERPRISE || 'price_enterprise_placeholder',
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
};

export function getTierById(tierId: string): StripeTier | undefined {
  return STRIPE_TIERS[tierId];
}

export function getAllTiers(): StripeTier[] {
  return Object.values(STRIPE_TIERS);
}

export function getTierByName(tierName: string): StripeTier | undefined {
  return getAllTiers().find((tier) => tier.name.toLowerCase() === tierName.toLowerCase());
}
