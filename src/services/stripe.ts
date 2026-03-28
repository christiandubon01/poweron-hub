// @ts-nocheck
/**
 * Stripe Subscription Service
 *
 * Backend gating logic for PowerOn Hub subscription tiers.
 * Queries Supabase for the org's active subscription and returns
 * the current tier + feature limits.
 *
 * Does NOT handle Stripe webhooks or billing UI — just reads
 * subscription state from the database.
 */

import { supabase } from '@/lib/supabase'
import {
  SUBSCRIPTION_TIERS,
  getFreeTierFeatures,
  type SubscriptionTier,
  type TierFeatures,
} from '@/config/subscriptionTiers'

// ── Types ─────────────────────────────────────────────────────────────────────

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'none'

export interface OrgSubscription {
  /** Supabase row id */
  id: string
  orgId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  status: SubscriptionStatus
  tierSlug: string
  tier: SubscriptionTier | null
  features: TierFeatures
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  /** True if the org can use paid features right now */
  isActive: boolean
}

// ── Lazy default — avoids calling getFreeTierFeatures() at module scope ──────
// Rollup may evaluate this module before subscriptionTiers.ts in production,
// causing a TDZ crash. Using a function defers the call until runtime.
function getEmptySubscription(orgId = ''): OrgSubscription {
  return {
    id: '',
    orgId,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    status: 'none',
    tierSlug: 'free',
    tier: null,
    features: getFreeTierFeatures(),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    isActive: false,
  }
}

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Fetch the current subscription for an organization.
 * Returns free-tier defaults when no active subscription exists.
 */
export async function getOrgSubscription(orgId: string): Promise<OrgSubscription> {
  if (!orgId) return getEmptySubscription()

  try {
    const { data, error } = await supabase
      .from('subscriptions' as never)
      .select('*')
      .eq('org_id', orgId)
      .in('status', ['active', 'trialing', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (error || !data) {
      return getEmptySubscription(orgId)
    }

    const row = data as Record<string, unknown>
    const tierSlug = (row.tier_slug as string) || 'solo'
    const tier = SUBSCRIPTION_TIERS[tierSlug] ?? null
    const status = (row.status as SubscriptionStatus) || 'none'

    return {
      id: row.id as string,
      orgId,
      stripeCustomerId: (row.stripe_customer_id as string) || null,
      stripeSubscriptionId: (row.stripe_subscription_id as string) || null,
      status,
      tierSlug,
      tier,
      features: tier?.features ?? getFreeTierFeatures(),
      currentPeriodEnd: (row.current_period_end as string) || null,
      cancelAtPeriodEnd: (row.cancel_at_period_end as boolean) ?? false,
      isActive: status === 'active' || status === 'trialing',
    }
  } catch (err) {
    console.error('[stripe] Failed to fetch subscription:', err)
    return getEmptySubscription(orgId)
  }
}

/**
 * Check whether a specific feature is available for the org's current tier.
 */
export async function checkFeatureAccess(
  orgId: string,
  feature: keyof TierFeatures,
): Promise<{ allowed: boolean; currentValue: number | boolean | string; tierName: string }> {
  const sub = await getOrgSubscription(orgId)
  const value = sub.features[feature]
  const allowed = typeof value === 'boolean' ? value : (value as number) > 0

  return {
    allowed,
    currentValue: value,
    tierName: sub.tier?.name ?? 'Free',
  }
}

/**
 * Get the billing customer record for an org, creating one if needed.
 * Used when the org first visits the billing page.
 */
export async function getOrCreateBillingCustomer(
  orgId: string,
  email: string,
  orgName: string,
): Promise<{ customerId: string }> {
  // Check for existing customer
  const { data: existing } = await supabase
    .from('billing_customers' as never)
    .select('stripe_customer_id')
    .eq('org_id', orgId)
    .single()

  if (existing) {
    return { customerId: (existing as Record<string, unknown>).stripe_customer_id as string }
  }

  // Create a pending billing record — the real Stripe customer is created
  // server-side via the create-checkout Edge Function when they first subscribe.
  // The Edge Function replaces this pending ID with the real cus_xxx ID.
  const pendingId = `cus_pending_${orgId.slice(0, 8)}`

  await supabase
    .from('billing_customers' as never)
    .upsert({
      org_id: orgId,
      stripe_customer_id: pendingId,
      email,
      name: orgName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' })

  return { customerId: pendingId }
}

/**
 * Check how much of a numeric quota has been used this billing period.
 * E.g., how many leads created this month vs the tier limit.
 */
export async function checkQuotaUsage(
  orgId: string,
  resource: 'leads' | 'projects' | 'users' | 'apiCalls',
): Promise<{ used: number; limit: number; remaining: number; percentUsed: number }> {
  const sub = await getOrgSubscription(orgId)
  const limit = sub.features[resource] as number

  let used = 0

  try {
    const periodStart = sub.currentPeriodEnd
      ? new Date(new Date(sub.currentPeriodEnd).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

    switch (resource) {
      case 'leads': {
        const { count } = await supabase
          .from('leads' as never)
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .gte('created_at', periodStart)
        used = count ?? 0
        break
      }
      case 'projects': {
        const { count } = await supabase
          .from('projects' as never)
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .in('status', ['active', 'in_progress', 'planning'])
        used = count ?? 0
        break
      }
      case 'users': {
        const { count } = await supabase
          .from('profiles' as never)
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
        used = count ?? 0
        break
      }
      case 'apiCalls': {
        // API call tracking would come from a separate counter table
        // For now, return 0 usage
        used = 0
        break
      }
    }
  } catch (err) {
    console.error(`[stripe] Quota check failed for ${resource}:`, err)
  }

  const remaining = Math.max(0, limit - used)
  const percentUsed = limit > 0 ? Math.round((used / limit) * 100) : 0

  return { used, limit, remaining, percentUsed }
}
