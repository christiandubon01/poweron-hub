/**
 * netlify/functions/stripe-checkout.ts
 * Server-side checkout session creation (keeps secret key server-side)
 */

import { STRIPE_TIERS } from '../../src/services/stripe/StripeConfig';

/**
 * Stripe API type definitions
 */
interface CheckoutSessionData {
  payment_method_types: string[];
  line_items: Array<{
    price: string;
    quantity: number;
  }>;
  mode: 'payment' | 'subscription' | 'setup';
  success_url: string;
  cancel_url: string;
  metadata: Record<string, string>;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { tierId, userId } = JSON.parse(event.body);

    if (!tierId || !userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tierId or userId' }),
      };
    }

    const tier = STRIPE_TIERS[tierId];
    if (!tier) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid tier ID' }),
      };
    }

    // Build the checkout session data
    const sessionData: CheckoutSessionData = {
      payment_method_types: ['card'],
      line_items: [
        {
          price: tier.priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.VITE_APP_URL || 'http://localhost:5173'}/settings?subscription=success`,
      cancel_url: `${process.env.VITE_APP_URL || 'http://localhost:5173'}/settings?subscription=cancelled`,
      metadata: {
        userId,
        tierId,
      },
    };

    // In production, this would call:
    // const session = await stripe.checkout.sessions.create(sessionData);
    // For now, we return a mock session ID with the tier info
    const sessionId = `cs_${Date.now()}_${tierId}_${userId}`;

    return {
      statusCode: 200,
      body: JSON.stringify({ sessionId }),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Checkout session error:', errorMsg);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMsg }),
    };
  }
};
