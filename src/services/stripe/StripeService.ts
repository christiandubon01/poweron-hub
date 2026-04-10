/**
 * Stripe Subscription Service (Client-side)
 *
 * Handles Stripe checkout, customer portal, and subscription status.
 * Uses Netlify Functions for server-side operations.
 */

import { getTierBySlug, type TierName } from './StripeConfig'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionStatus {
  plan: TierName | 'free'
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'none'
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

// ── Environment Setup ─────────────────────────────────────────────────────────

/**
 * Initialize Stripe with the publishable key from environment.
 * Returns true if Stripe is available.
 */
export function initializeStripe(): boolean {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  if (!key) {
    console.warn('[Stripe] VITE_STRIPE_PUBLISHABLE_KEY not configured')
    return false
  }
  return true
}

/**
 * Get the Stripe publishable key.
 */
export function getStripePublishableKey(): string | undefined {
  return import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
}

// ── Checkout Session Creation ─────────────────────────────────────────────────

/**
 * Create a Stripe Checkout session for a given tier.
 * Calls netlify/functions/stripe-checkout on the backend.
 *
 * @param tierId - The tier slug to subscribe to (e.g., 'solo', 'growth', 'pro')
 * @returns The checkout URL to redirect to
 */
export async function createCheckoutSession(tierId: TierName): Promise<string> {
  // Validate tier exists
  const tier = getTierBySlug(tierId)
  if (!tier) {
    throw new Error(`Invalid tier: ${tierId}`)
  }

  try {
    // Call the Netlify Function
    const response = await fetch('/.netlify/functions/stripe-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tierId,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create checkout session')
    }

    const { checkoutUrl } = await response.json()
    if (!checkoutUrl) {
      throw new Error('No checkout URL returned from server')
    }

    return checkoutUrl
  } catch (err) {
    console.error('[Stripe] Checkout session creation failed:', err)
    throw err
  }
}

/**
 * Redirect to Stripe-hosted checkout.
 * @param tierId - The tier to redirect to
 */
export async function redirectToCheckout(tierId: TierName): Promise<void> {
  try {
    const checkoutUrl = await createCheckoutSession(tierId)
    window.location.href = checkoutUrl
  } catch (err) {
    console.error('[Stripe] Redirect to checkout failed:', err)
    throw err
  }
}

// ── Customer Portal Session ───────────────────────────────────────────────────

/**
 * Create a Stripe Customer Portal session and redirect to it.
 * Allows users to manage their subscription, update payment methods, etc.
 */
export async function openCustomerPortal(): Promise<void> {
  try {
    const response = await fetch('/.netlify/functions/stripe-portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to create portal session')
    }

    const { portalUrl } = await response.json()
    if (!portalUrl) {
      throw new Error('No portal URL returned from server')
    }

    window.location.href = portalUrl
  } catch (err) {
    console.error('[Stripe] Portal session creation failed:', err)
    throw err
  }
}

// ── Subscription Status ───────────────────────────────────────────────────────

/**
 * Fetch the current subscription status for the authenticated user.
 * Returns subscription plan, status, and billing details.
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    const response = await fetch('/.netlify/functions/stripe-status', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        // Not authenticated
        return {
          plan: 'free',
          status: 'none',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }
      }
      throw new Error(`Failed to fetch subscription status: ${response.statusText}`)
    }

    const data = await response.json()
    return {
      plan: data.tier || 'free',
      status: data.status || 'none',
      currentPeriodEnd: data.currentPeriodEnd || null,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd || false,
    }
  } catch (err) {
    console.error('[Stripe] Failed to fetch subscription status:', err)
    // Return free tier on error
    return {
      plan: 'free',
      status: 'none',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }
  }
}

/**
 * Check if a user has an active subscription (paid tier).
 */
export async function hasActiveSubscription(): Promise<boolean> {
  const status = await getSubscriptionStatus()
  return status.status === 'active' || status.status === 'trialing'
}

/**
 * Get the current subscription tier name.
 * Returns 'free' if no active subscription.
 */
export async function getCurrentTier(): Promise<TierName | 'free'> {
  const status = await getSubscriptionStatus()
  return status.plan
}

// ── Webhook Utilities ────────────────────────────────────────────────────────

/**
 * Verify a Stripe webhook signature (used server-side in Netlify Functions).
 * This is exported for documentation purposes; actual verification happens
 * in the Netlify Function handling webhooks.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  // Note: This is implemented server-side in Netlify Functions.
  // The Stripe SDK handles signature verification.
  // This function is a placeholder for reference.
  console.warn('[Stripe] Webhook signature verification should happen server-side')
  return false
}

// ── Export all named exports ─────────────────────────────────────────────────

export {
  getTierBySlug,
  getFreeTierLimits,
  getFreeTierFeatures,
  isFeatureEnabled,
  checkLimit,
  STRIPE_TIERS,
  type TierName,
  type TierLimits,
  type TierFeatures,
  type StripeConfig,
} from './StripeConfig'
