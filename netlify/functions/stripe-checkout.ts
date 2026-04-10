/**
 * Netlify Function: stripe-checkout
 *
 * Server-side checkout session creation (keeps secret key server-side).
 * Called from StripeService.createCheckoutSession().
 *
 * Environment variables:
 *   - STRIPE_SECRET_KEY: Stripe secret key (sk_live_... or sk_test_...)
 *   - VITE_STRIPE_PRICE_SOLO, VITE_STRIPE_PRICE_GROWTH, etc: Stripe Price IDs
 *
 * Request body:
 *   { tierId: 'solo' | 'growth' | 'pro' | 'proplus' | 'enterprise' }
 *
 * Response:
 *   { checkoutUrl: string } or { error: string }
 */

import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
})

// ── Price ID mapping ─────────────────────────────────────────────────────────

const PRICE_IDS: Record<string, string> = {
  solo: process.env.VITE_STRIPE_PRICE_SOLO || '',
  growth: process.env.VITE_STRIPE_PRICE_GROWTH || '',
  pro: process.env.VITE_STRIPE_PRICE_PRO || '',
  proplus: process.env.VITE_STRIPE_PRICE_PROPLUS || '',
  enterprise: process.env.VITE_STRIPE_PRICE_ENTERPRISE || '',
}

// ── Main handler ─────────────────────────────────────────────────────────────

export const handler = async (event: any) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    }
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  try {
    // Validate Stripe is configured
    if (!process.env.STRIPE_SECRET_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in environment variables.',
        }),
      }
    }

    // Parse request body
    const { tierId } = JSON.parse(event.body || '{}')

    if (!tierId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing tierId in request body' }),
      }
    }

    // Validate tier
    const priceId = PRICE_IDS[tierId]
    if (!priceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Invalid or unconfigured tier: ${tierId}` }),
      }
    }

    // Get the origin from the request (for success/cancel URLs)
    const origin = event.headers.origin || event.headers.referer || 'http://localhost:5173'
    const baseUrl = new URL(origin).origin

    // Extract user context from headers or auth (simplified for example)
    // In production, you would verify JWT from Authorization header
    const customerId = event.queryStringParameters?.customerId // Optional: pass customer ID if already created

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      customer: customerId, // Can be undefined; Stripe will create a new customer
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/settings?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/settings?subscription=cancelled`,
      subscription_data: {
        metadata: {
          tier_id: tierId,
        },
      },
      allow_promotion_codes: true,
    })

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        checkoutUrl: session.url,
      }),
    }
  } catch (error) {
    console.error('[stripe-checkout] Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to create checkout session',
      }),
    }
  }
}
