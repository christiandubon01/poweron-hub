/**
 * Netlify Function: stripe-webhook
 *
 * Handles Stripe webhook events:
 *   - checkout.session.completed: Activate subscription
 *   - customer.subscription.updated: Update tier/status
 *   - customer.subscription.deleted: Downgrade to free
 *   - invoice.payment_failed: Flag account
 *
 * Environment variables:
 *   - STRIPE_SECRET_KEY: Stripe secret key (sk_live_... or sk_test_...)
 *   - STRIPE_WEBHOOK_SECRET: Webhook signing secret (whsec_...)
 *   - SUPABASE_URL: Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY: Supabase service role key
 *
 * Stripe Dashboard setup:
 *   1. Go to Developers → Webhooks → Add endpoint
 *   2. URL: https://your-netlify-domain/.netlify/functions/stripe-webhook
 *   3. Select events: checkout.session.completed, customer.subscription.updated,
 *      customer.subscription.deleted, invoice.payment_failed
 *   4. Copy the signing secret and set as STRIPE_WEBHOOK_SECRET
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

// ── Main handler ─────────────────────────────────────────────────────────────

export const handler = async (event: any) => {
  // Validate webhook secret is configured
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET')
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Webhook not configured' }),
    }
  }

  try {
    // Verify Stripe signature
    const signature = event.headers['stripe-signature']
    if (!signature) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing stripe-signature header' }),
      }
    }

    let stripeEvent: Stripe.Event
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body || '',
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
      )
    } catch (err) {
      console.error('[stripe-webhook] Signature verification failed:', err)
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid signature' }),
      }
    }

    console.log(`[stripe-webhook] Processing event: ${stripeEvent.type} (${stripeEvent.id})`)

    // Handle different event types
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(stripeEvent)
        break
      }

      case 'customer.subscription.updated': {
        await handleSubscriptionUpdated(stripeEvent)
        break
      }

      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(stripeEvent)
        break
      }

      case 'invoice.payment_failed': {
        await handlePaymentFailed(stripeEvent)
        break
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${stripeEvent.type}`)
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    }
  } catch (error) {
    console.error('[stripe-webhook] Processing error:', error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Webhook processing failed',
      }),
    }
  }
}

// ── Event Handlers ───────────────────────────────────────────────────────────

/**
 * Handle checkout.session.completed
 * Updates user subscription status and tier in Supabase
 */
async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  const customerId = session.customer as string | undefined
  const subscriptionId = session.subscription as string | undefined
  const tierId = (session.metadata?.tier_id as string) || 'solo'
  const customerEmail = session.customer_email || ''

  if (!customerId || !subscriptionId) {
    console.warn('[stripe-webhook] checkout.session.completed missing customer or subscription')
    return
  }

  try {
    // Fetch subscription details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)

    // Update or create subscription record in Supabase
    const { error } = await supabase.from('subscriptions').upsert({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: 'active',
      subscription_tier: tierId,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[stripe-webhook] Failed to update subscription:', error)
      return
    }

    console.log(`[stripe-webhook] Activated subscription: customer=${customerId}, tier=${tierId}`)
  } catch (err) {
    console.error('[stripe-webhook] Error processing checkout.session.completed:', err)
  }
}

/**
 * Handle customer.subscription.updated
 * Syncs tier changes and status updates to Supabase
 */
async function handleSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription

  const customerId = subscription.customer as string | undefined
  const subscriptionId = subscription.id
  const tierId = (subscription.metadata?.tier_id as string) || 'solo'

  if (!customerId) {
    console.warn('[stripe-webhook] customer.subscription.updated missing customer ID')
    return
  }

  try {
    // Determine status
    let status: 'active' | 'trialing' | 'past_due' | 'canceled' = 'active'
    if (subscription.status === 'trialing') status = 'trialing'
    if (subscription.status === 'past_due') status = 'past_due'
    if (subscription.status === 'canceled') status = 'canceled'

    // Update subscription record in Supabase
    const { error } = await supabase.from('subscriptions').upsert({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: status,
      subscription_tier: tierId,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[stripe-webhook] Failed to update subscription:', error)
      return
    }

    console.log(
      `[stripe-webhook] Updated subscription: customer=${customerId}, status=${status}, tier=${tierId}`,
    )
  } catch (err) {
    console.error('[stripe-webhook] Error processing customer.subscription.updated:', err)
  }
}

/**
 * Handle customer.subscription.deleted
 * Downgrade user to free tier
 */
async function handleSubscriptionDeleted(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription

  const customerId = subscription.customer as string | undefined
  const subscriptionId = subscription.id

  if (!customerId) {
    console.warn('[stripe-webhook] customer.subscription.deleted missing customer ID')
    return
  }

  try {
    // Update subscription to canceled status and free tier
    const { error } = await supabase.from('subscriptions').upsert({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      subscription_status: 'canceled',
      subscription_tier: 'free',
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[stripe-webhook] Failed to update subscription:', error)
      return
    }

    console.log(`[stripe-webhook] Canceled subscription: customer=${customerId}, downgraded to free`)
  } catch (err) {
    console.error('[stripe-webhook] Error processing customer.subscription.deleted:', err)
  }
}

/**
 * Handle invoice.payment_failed
 * Flag account with past_due status
 */
async function handlePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  const subscriptionId = invoice.subscription as string | undefined
  if (!subscriptionId) {
    console.warn('[stripe-webhook] invoice.payment_failed missing subscription ID')
    return
  }

  try {
    // Find subscription by stripe_subscription_id and update status
    const { data: subscription, error: fetchError } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('stripe_subscription_id', subscriptionId)
      .single()

    if (fetchError || !subscription) {
      console.warn('[stripe-webhook] Could not find subscription for payment failure:', subscriptionId)
      return
    }

    const { error } = await supabase.from('subscriptions').upsert({
      stripe_customer_id: subscription.stripe_customer_id,
      stripe_subscription_id: subscriptionId,
      subscription_status: 'past_due',
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error('[stripe-webhook] Failed to mark subscription as past_due:', error)
      return
    }

    console.log(
      `[stripe-webhook] Payment failed: customer=${subscription.stripe_customer_id}, marked past_due`,
    )
  } catch (err) {
    console.error('[stripe-webhook] Error processing invoice.payment_failed:', err)
  }
}
