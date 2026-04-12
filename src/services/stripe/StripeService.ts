/**
 * StripeService.ts
 * Stripe integration service for PowerOn Hub SaaS subscriptions
 */

import { getTierById } from './StripeConfig';

let stripePromise: Promise<any | null>;

/**
 * Initialize Stripe with publishable key from environment
 */
async function getStripe(): Promise<any | null> {
  if (!stripePromise) {
    const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      console.error('VITE_STRIPE_PUBLISHABLE_KEY is not set in environment');
      return null;
    }
    
    try {
      // Dynamic import to avoid build-time issues
      const stripe = (window as any).Stripe;
      if (!stripe) {
        console.error('Stripe.js not loaded');
        return null;
      }
      stripePromise = Promise.resolve(stripe(publishableKey));
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
      stripePromise = Promise.resolve(null);
    }
  }
  return stripePromise;
}

/**
 * Create a checkout session for the selected tier
 * @param tierId - The tier ID (solo, growth, pro, proplus, enterprise)
 * @returns Checkout session ID
 */
export async function createCheckoutSession(tierId: string): Promise<string> {
  const tier = getTierById(tierId);
  if (!tier) {
    throw new Error(`Invalid tier ID: ${tierId}`);
  }

  try {
    const response = await fetch('/.netlify/functions/stripe-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tierId,
        userId: localStorage.getItem('poweron_user_id') || 'anonymous',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create checkout session: ${error}`);
    }

    const data = await response.json();
    return data.sessionId;
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
}

/**
 * Redirect to Stripe-hosted checkout page
 * @param tierId - The tier ID
 */
export async function redirectToCheckout(tierId: string): Promise<void> {
  try {
    const stripe = await getStripe();
    if (!stripe) {
      throw new Error('Stripe failed to initialize');
    }

    const sessionId = await createCheckoutSession(tierId);
    
    const { error } = await stripe.redirectToCheckout({
      sessionId,
    });

    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Redirect to checkout failed:', error);
    throw error;
  }
}

/**
 * Create a Stripe Customer Portal session for managing subscription
 * @param stripeCustomerId - The Stripe customer ID from user's subscription
 */
export async function createPortalSession(stripeCustomerId: string): Promise<string> {
  try {
    const response = await fetch('/.netlify/functions/stripe-portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stripeCustomerId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create portal session: ${error}`);
    }

    const data = await response.json();
    return data.portalUrl;
  } catch (error) {
    console.error('Error creating portal session:', error);
    throw error;
  }
}

/**
 * Open the Stripe Customer Portal
 * @param stripeCustomerId - The Stripe customer ID
 */
export async function openCustomerPortal(stripeCustomerId: string): Promise<void> {
  try {
    const portalUrl = await createPortalSession(stripeCustomerId);
    window.location.href = portalUrl;
  } catch (error) {
    console.error('Failed to open customer portal:', error);
    throw error;
  }
}

/**
 * Subscription status interface
 */
export interface SubscriptionStatus {
  tierId: string | null;
  status: 'active' | 'past_due' | 'canceled' | 'unpaid' | 'none';
  stripeCustomerId: string | null;
  nextBillingDate: string | null;
  currentPeriodEnd: string | null;
  sessionId?: string;
}

/**
 * Get current subscription status from local storage or Supabase
 * @returns Current subscription status
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  try {
    // First try to get from localStorage/state
    const storedStatus = localStorage.getItem('poweron_subscription_status');
    if (storedStatus) {
      return JSON.parse(storedStatus);
    }

    // If not in storage, fetch from API
    const userId = localStorage.getItem('poweron_user_id');
    if (!userId) {
      return {
        tierId: null,
        status: 'none',
        stripeCustomerId: null,
        nextBillingDate: null,
        currentPeriodEnd: null,
      };
    }

    const response = await fetch(`/.netlify/functions/stripe-subscription?userId=${userId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch subscription status');
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting subscription status:', error);
    return {
      tierId: null,
      status: 'none',
      stripeCustomerId: null,
      nextBillingDate: null,
      currentPeriodEnd: null,
    };
  }
}

/**
 * Store subscription status in local storage
 * @param status - Subscription status to store
 */
export function storeSubscriptionStatus(status: SubscriptionStatus): void {
  localStorage.setItem('poweron_subscription_status', JSON.stringify(status));
}

/**
 * Clear subscription status from local storage
 */
export function clearSubscriptionStatus(): void {
  localStorage.removeItem('poweron_subscription_status');
}
