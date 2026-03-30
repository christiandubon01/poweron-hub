/**
 * create-checkout — Supabase Edge Function for Stripe Checkout Sessions
 *
 * Creates a Stripe Checkout Session and returns the URL for redirect.
 * Called from PricingPanel.tsx when a user clicks "Upgrade".
 *
 * Environment variables (set in Supabase Dashboard → Edge Functions):
 *   STRIPE_SECRET_KEY        — sk_live_... or sk_test_...
 *   SUPABASE_URL             — auto-injected
 *   SUPABASE_SERVICE_ROLE_KEY — auto-injected
 *
 * Request body:
 *   { tierSlug: 'solo' | 'team' | 'enterprise', billingCycle: 'monthly' | 'annual' }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@13.11.0?target=deno'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Price ID mapping ─────────────────────────────────────────────────────────
// These must match the Stripe Dashboard price IDs.
// Set via env vars; fallback strings are non-functional placeholders.

const PRICE_MAP: Record<string, { monthly: string; annual: string }> = {
  solo: {
    monthly: Deno.env.get('STRIPE_PRICE_SOLO_MONTHLY') ?? '',
    annual:  Deno.env.get('STRIPE_PRICE_SOLO_ANNUAL')  ?? '',
  },
  team: {
    monthly: Deno.env.get('STRIPE_PRICE_TEAM_MONTHLY') ?? '',
    annual:  Deno.env.get('STRIPE_PRICE_TEAM_ANNUAL')  ?? '',
  },
  enterprise: {
    monthly: Deno.env.get('STRIPE_PRICE_ENTERPRISE_MONTHLY') ?? '',
    annual:  Deno.env.get('STRIPE_PRICE_ENTERPRISE_ANNUAL')  ?? '',
  },
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY in Edge Function secrets.' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

    // ── Auth: Verify JWT ───────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Verify the user's JWT
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // ── Get user's org ───────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from('profiles')
      .select('org_id, full_name')
      .eq('id', user.id)
      .single()

    if (!profile?.org_id) {
      return new Response(
        JSON.stringify({ error: 'User has no organization' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // ── Parse request ────────────────────────────────────────────────────
    const { tierSlug, billingCycle } = await req.json() as {
      tierSlug: string
      billingCycle: 'monthly' | 'annual'
    }

    const tierPrices = PRICE_MAP[tierSlug]
    if (!tierPrices) {
      return new Response(
        JSON.stringify({ error: `Unknown tier: ${tierSlug}` }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    const priceId = billingCycle === 'annual' ? tierPrices.annual : tierPrices.monthly
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `No ${billingCycle} price configured for tier ${tierSlug}` }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      )
    }

    // ── Get or create Stripe customer ────────────────────────────────────
    let customerId: string | undefined

    const { data: billing } = await supabase
      .from('billing_customers')
      .select('stripe_customer_id')
      .eq('org_id', profile.org_id)
      .single()

    if (billing?.stripe_customer_id && !billing.stripe_customer_id.startsWith('cus_pending_')) {
      customerId = billing.stripe_customer_id
    } else {
      // Create a real Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile.full_name ?? user.email,
        metadata: {
          org_id: profile.org_id,
          supabase_user_id: user.id,
        },
      })
      customerId = customer.id

      // Upsert the real customer ID
      await supabase
        .from('billing_customers')
        .upsert({
          org_id: profile.org_id,
          stripe_customer_id: customerId,
          email: user.email,
          name: profile.full_name ?? user.email,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'org_id' })
    }

    // ── Create Checkout Session ──────────────────────────────────────────
    const origin = req.headers.get('origin') ?? 'http://localhost:5173'

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/pricing?checkout=canceled`,
      subscription_data: {
        metadata: {
          org_id: profile.org_id,
          tier_slug: tierSlug,
          billing_cycle: billingCycle,
        },
      },
      allow_promotion_codes: true,
    })

    return new Response(
      JSON.stringify({ checkoutUrl: session.url }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('[create-checkout] Error:', err)
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  }
})
