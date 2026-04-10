/**
 * netlify/functions/stripe-webhook.ts
 * Handles Stripe webhook events and syncs subscription data to Supabase
 */

import { createClient } from '@supabase/supabase-js';

// Type definitions for Stripe objects
interface StripeCheckoutSession {
  id: string;
  metadata?: Record<string, string>;
  customer?: string;
  subscription?: string;
}

interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  current_period_end: number;
  items: {
    data: Array<{
      price: {
        id: string;
      };
    }>;
  };
}

interface StripeInvoice {
  id: string;
  customer?: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: any;
  };
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

/**
 * Construct webhook event from Stripe signature
 */
function constructWebhookEvent(body: string, signature: string, secret: string): StripeEvent {
  // In production, use: const event = stripe.webhooks.constructEvent(body, signature, secret);
  // For now, we'll validate manually
  const crypto = require('crypto');
  
  const timestamp = signature.split(',')[0]?.split('=')[1];
  const signatures = signature.split(',');
  
  let computedSignature = '';
  for (const sig of signatures) {
    if (sig.includes('v1=')) {
      const signedContent = `${timestamp}.${body}`;
      computedSignature = crypto
        .createHmac('sha256', secret)
        .update(signedContent)
        .digest('hex');
      
      const expectedSig = sig.split('=')[1];
      if (!computedSignature.match(expectedSig)) {
        throw new Error('Invalid webhook signature');
      }
      break;
    }
  }
  
  const event: StripeEvent = JSON.parse(body);
  return event;
}

export const handler = async (event: any) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const signature = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing webhook signature or secret' }),
    };
  }

  let stripeEvent: StripeEvent;

  try {
    stripeEvent = constructWebhookEvent(event.body, signature, webhookSecret);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Webhook Error: ${errorMsg}`);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Webhook Error: ${errorMsg}` }),
    };
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(stripeEvent.data.object as StripeCheckoutSession);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(stripeEvent.data.object as StripeSubscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDelete(stripeEvent.data.object as StripeSubscription);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(stripeEvent.data.object as StripeInvoice);
        break;

      default:
        console.log(`Unhandled event type: ${stripeEvent.type}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ received: true }),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook processing error:', errorMsg);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: errorMsg }),
    };
  }
};

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutComplete(session: StripeCheckoutSession): Promise<void> {
  const { metadata, customer, subscription } = session;

  if (!customer || !subscription) {
    console.error('Missing customer or subscription in checkout session');
    return;
  }

  const customerId = typeof customer === 'string' ? customer : customer;
  const subscriptionId = typeof subscription === 'string' ? subscription : subscription;

  // Map price ID to tier (we'll use the metadata tierId if available)
  const tierId = metadata?.tierId || 'free';

  // Extract userId from metadata
  const userId = metadata?.userId;
  if (!userId) {
    console.error('Missing userId in checkout session metadata');
    return;
  }

  // Update Supabase user record
  const { error } = await supabase
    .from('users')
    .update({
      subscription_tier: tierId,
      stripe_customer_id: customerId,
      subscription_status: 'active',
      subscription_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    console.error('Error updating user subscription:', error);
    throw error;
  }

  console.log(`Subscription created for user ${userId} - tier: ${tierId}`);
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdate(subscription: StripeSubscription): Promise<void> {
  const customerId = subscription.customer;
  const priceId = subscription.items.data[0]?.price.id;
  const tierId = mapPriceIdToTierId(priceId);

  // Find user by stripe_customer_id
  const { data: users, error: fetchError } = await supabase
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .limit(1);

  if (fetchError || !users || users.length === 0) {
    console.error('User not found for Stripe customer:', customerId);
    return;
  }

  const userId = users[0].id;

  // Map subscription status
  const status = mapSubscriptionStatus(subscription.status);

  // Update Supabase user record
  const { error: updateError } = await supabase
    .from('users')
    .update({
      subscription_tier: tierId,
      subscription_status: status,
      subscription_updated_at: new Date().toISOString(),
      subscription_current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    console.error('Error updating subscription:', updateError);
    throw updateError;
  }

  console.log(`Subscription updated for user ${userId} - tier: ${tierId}, status: ${status}`);
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionDelete(subscription: StripeSubscription): Promise<void> {
  const customerId = subscription.customer;

  // Find user by stripe_customer_id
  const { data: users, error: fetchError } = await supabase
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .limit(1);

  if (fetchError || !users || users.length === 0) {
    console.error('User not found for Stripe customer:', customerId);
    return;
  }

  const userId = users[0].id;

  // Downgrade to free/expired state
  const { error: updateError } = await supabase
    .from('users')
    .update({
      subscription_tier: 'free',
      subscription_status: 'canceled',
      subscription_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    console.error('Error downgrading subscription:', updateError);
    throw updateError;
  }

  console.log(`Subscription deleted for user ${userId}`);
}

/**
 * Handle invoice.payment_failed event
 */
async function handlePaymentFailed(invoice: StripeInvoice): Promise<void> {
  const customerId = invoice.customer;
  if (!customerId) {
    console.error('Missing customer in invoice');
    return;
  }

  // Find user by stripe_customer_id
  const { data: users, error: fetchError } = await supabase
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .limit(1);

  if (fetchError || !users || users.length === 0) {
    console.error('User not found for Stripe customer:', customerId);
    return;
  }

  const userId = users[0].id;

  // Flag account with failed payment status
  const { error: updateError } = await supabase
    .from('users')
    .update({
      subscription_status: 'unpaid',
      payment_failed_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateError) {
    console.error('Error updating payment failed status:', updateError);
    throw updateError;
  }

  // TODO: Send notification to user about failed payment

  console.log(`Payment failed for user ${userId}`);
}

/**
 * Map Stripe price ID to tier ID
 */
function mapPriceIdToTierId(priceId?: string): string {
  if (!priceId) return 'free';

  const priceIdMap: Record<string, string> = {
    [process.env.VITE_STRIPE_PRICE_ID_SOLO || 'price_solo_placeholder']: 'solo',
    [process.env.VITE_STRIPE_PRICE_ID_GROWTH || 'price_growth_placeholder']: 'growth',
    [process.env.VITE_STRIPE_PRICE_ID_PRO || 'price_pro_placeholder']: 'pro',
    [process.env.VITE_STRIPE_PRICE_ID_PROPLUS || 'price_proplus_placeholder']: 'proplus',
    [process.env.VITE_STRIPE_PRICE_ID_ENTERPRISE || 'price_enterprise_placeholder']: 'enterprise',
  };

  return priceIdMap[priceId] || 'free';
}

/**
 * Map Stripe subscription status to application status
 */
function mapSubscriptionStatus(stripeStatus: string): 'active' | 'past_due' | 'canceled' | 'unpaid' {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'canceled':
      return 'canceled';
    default:
      return 'unpaid';
  }
}
