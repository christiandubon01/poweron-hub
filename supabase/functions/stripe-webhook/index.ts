/**
 * stripe-webhook — Supabase Edge Function for Stripe Webhook Events
 *
 * Handles the full subscription lifecycle:
 *   - checkout.session.completed → activate subscription
 *   - customer.subscription.updated → update tier/status
 *   - customer.subscription.deleted → downgrade to free
 *   - invoice.payment_failed → flag account
 *
 * Stripe Dashboard setup:
 *   1. Go to Developers → Webhooks → Add endpoint
 *   2. URL: https://edxxbtyugohtowvslbfo.supabase.co/functions/v1/stripe-webhook
 *   3. Select events: checkout.session.completed, customer.subscription.updated,
 *      customer.subscription.deleted, invoice.payment_failed
 *   4. Copy the signing secret → set as STRIPE_WEBHOOK_SECRET in Edge Function secrets
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY         — sk_live_... or sk_test_...
 *   STRIPE_WEBHOOK_SECRET     — whsec_...
 *   SUPABASE_URL              — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')

  if (!stripeKey || !webhookSecret) {
    console.error('[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
    return new Response(
      JSON.stringify({ error: 'Webhook not configured' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Verify Stripe signature ──────────────────────────────────────────────
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return new Response(
      JSON.stringify({ error: 'Missing stripe-signature header' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err)
    return new Response(
      JSON.stringify({ error: 'Invalid signature' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }

  console.log(`[stripe-webhook] Processing event: ${event.type} (${event.id})`)

  try {
    switch (event.type) {
      // ── Checkout completed → activate subscription ─────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const subscriptionId = session.subscription as string
        const customerId = session.customer as string
        const metadata = session.subscription_data?.metadata ?? (session as any).metadata ?? {}

        const orgId = metadata.org_id
        const tierSlug = metadata.tier_slug || 'solo'
        const billingCycle = metadata.billing_cycle || 'monthly'

        if (!orgId) {
          console.error('[stripe-webhook] No org_id in checkout session metadata')
          break
        }

        // Retrieve the full subscription for period dates
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)

        // Upsert subscription record
        await supabase
          .from('subscriptions')
          .upsert({
            org_id: orgId,
            stripe_subscription_id: subscriptionId,
            status: 'active',
            tier_slug: tierSlug,
            billing_interval: billingCycle,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'org_id' })

        // Update billing_customers with real Stripe customer ID
        await supabase
          .from('billing_customers')
          .upsert({
            org_id: orgId,
            stripe_customer_id: customerId,
            email: session.customer_email || '',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'org_id' })

        // Log the event
        await logSubscriptionEvent(supabase, orgId, 'checkout_completed', {
          stripe_subscription_id: subscriptionId,
          tier_slug: tierSlug,
          billing_cycle: billingCycle,
        })

        console.log(`[stripe-webhook] Activated subscription for org ${orgId}: ${tierSlug}/${billingCycle}`)
        break
      }

      // ── Subscription updated → sync tier/status ────────────────────────
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const orgId = subscription.metadata?.org_id

        if (!orgId) {
          // Try to find org by stripe_subscription_id
          const { data: existing } = await supabase
            .from('subscriptions')
            .select('org_id')
            .eq('stripe_subscription_id', subscription.id)
            .single()

          if (!existing) {
            console.error('[stripe-webhook] Cannot find org for subscription:', subscription.id)
            break
          }

          await updateSubscription(supabase, existing.org_id, subscription)
        } else {
          await updateSubscription(supabase, orgId, subscription)
        }
        break
      }

      // ── Subscription deleted → downgrade to free ───────────────────────
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        // Find the org
        const { data: existing } = await supabase
          .from('subscriptions')
          .select('org_id')
          .eq('stripe_subscription_id', subscription.id)
          .single()

        if (existing) {
          await supabase
            .from('subscriptions')
            .update({
              status: 'canceled',
              tier_slug: 'free',
              canceled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('org_id', existing.org_id)

          await logSubscriptionEvent(supabase, existing.org_id, 'subscription_canceled', {
            stripe_subscription_id: subscription.id,
            previous_tier: subscription.metadata?.tier_slug || 'unknown',
          })

          console.log(`[stripe-webhook] Canceled subscription for org ${existing.org_id}, downgraded to free`)
        }
        break
      }

      // ── Payment failed → flag account ──────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = invoice.subscription as string

        if (!subscriptionId) break

        const { data: existing } = await supabase
          .from('subscriptions')
          .select('org_id, tier_slug')
          .eq('stripe_subscription_id', subscriptionId)
          .single()

        if (existing) {
          // Update status to past_due
          await supabase
            .from('subscriptions')
            .update({
              status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('org_id', existing.org_id)

          await logSubscriptionEvent(supabase, existing.org_id, 'payment_failed', {
            stripe_subscription_id: subscriptionId,
            invoice_id: invoice.id,
            amount_due: invoice.amount_due,
            attempt_count: invoice.attempt_count,
          })

          console.log(`[stripe-webhook] Payment failed for org ${existing.org_id} — marked past_due`)
        }
        break
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[stripe-webhook] Processing error:', err)
    return new Response(
      JSON.stringify({ error: 'Webhook processing failed' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})

// ── Helpers ──────────────────────────────────────────────────────────────────

async function updateSubscription(
  supabase: any,
  orgId: string,
  subscription: Stripe.Subscription
) {
  const tierSlug = subscription.metadata?.tier_slug || 'solo'
  const billingInterval = subscription.items?.data?.[0]?.plan?.interval || 'month'

  // Map Stripe status to our status
  let status = 'active'
  if (subscription.status === 'past_due') status = 'past_due'
  else if (subscription.status === 'canceled') status = 'canceled'
  else if (subscription.status === 'unpaid') status = 'past_due'
  else if (subscription.status === 'trialing') status = 'trialing'

  await supabase
    .from('subscriptions')
    .upsert({
      org_id: orgId,
      stripe_subscription_id: subscription.id,
      status,
      tier_slug: tierSlug,
      billing_interval: billingInterval === 'year' ? 'annual' : 'monthly',
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' })

  await logSubscriptionEvent(supabase, orgId, 'subscription_updated', {
    stripe_subscription_id: subscription.id,
    status,
    tier_slug: tierSlug,
  })

  console.log(`[stripe-webhook] Updated subscription for org ${orgId}: ${status}/${tierSlug}`)
}

async function logSubscriptionEvent(
  supabase: any,
  orgId: string,
  eventType: string,
  details: Record<string, unknown>
) {
  await supabase
    .from('subscription_events')
    .insert({
      org_id: orgId,
      event_type: eventType,
      details,
      created_at: new Date().toISOString(),
    })
}
