/**
 * Netlify Function: stripe-status
 *
 * Returns the current subscription status for the authenticated user.
 * Called from StripeService.getSubscriptionStatus().
 *
 * Environment variables:
 *   - SUPABASE_URL: Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 *
 * Response:
 *   {
 *     tier: string,
 *     status: string,
 *     currentPeriodEnd: string | null,
 *     cancelAtPeriodEnd: boolean
 *   }
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
)

export const handler = async (event: any) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  try {
    // Get user from Authorization header
    const authHeader = event.headers.authorization || ''
    const token = authHeader.replace('Bearer ', '')

    if (!token) {
      // Return free tier if not authenticated
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier: 'free',
          status: 'none',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }),
      }
    }

    // Verify JWT and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      // Return free tier if auth fails
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier: 'free',
          status: 'none',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }),
      }
    }

    // Get user's subscription from Supabase
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('subscription_tier, subscription_status, current_period_end, cancel_at_period_end')
      .eq('user_id', user.id)
      .single()

    if (subError || !subscription) {
      // No subscription found, return free tier
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier: 'free',
          status: 'none',
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
        }),
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tier: subscription.subscription_tier || 'free',
        status: subscription.subscription_status || 'none',
        currentPeriodEnd: subscription.current_period_end || null,
        cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
      }),
    }
  } catch (error) {
    console.error('[stripe-status] Error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to fetch subscription status',
      }),
    }
  }
}
