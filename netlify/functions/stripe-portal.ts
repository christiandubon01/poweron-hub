/**
 * Netlify Function: stripe-portal
 *
 * Creates a Stripe Customer Portal session for subscription management.
 * Called from StripeService.openCustomerPortal().
 *
 * Environment variables:
 *   - STRIPE_SECRET_KEY: Stripe secret key
 *   - SUPABASE_URL: Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 *
 * Response:
 *   { portalUrl: string } or { error: string }
 */

import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
})

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
)

export const handler = async (event: any) => {
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
        body: JSON.stringify({ error: 'Stripe is not configured' }),
      }
    }

    // Get user's Stripe customer ID from Supabase
    // In production, you would extract the user ID from JWT in Authorization header
    const authHeader = event.headers.authorization || ''
    const token = authHeader.replace('Bearer ', '')

    if (!token) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization header' }),
      }
    }

    // Verify JWT and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid or expired token' }),
      }
    }

    // Get user's subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    if (subError || !subscription?.stripe_customer_id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No active subscription found' }),
      }
    }

    const customerId = subscription.stripe_customer_id

    // Create portal session
    const baseUrl = new URL(event.headers.origin || event.headers.referer || 'http://localhost:5173')
      .origin
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/settings`,
    })

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        portalUrl: session.url,
      }),
    }
  } catch (error) {
    console.error('[stripe-portal] Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to create portal session',
      }),
    }
  }
}
