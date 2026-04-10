/**
 * Stripe Services — Public API
 *
 * Exports all stripe-related services including subscription management,
 * tier gating, and feature access control.
 */

// Existing stripe service
export { getOrgSubscription, checkQuotaUsage, getOrCreateBillingCustomer } from '../stripe'
export { checkFeatureAccess as checkSubscriptionFeatureAccess } from '../stripe'
export type { SubscriptionStatus, OrgSubscription } from '../stripe'

// Tier gate service
export {
  checkFeatureAccess,
  checkLimitAccess,
  getCurrentTier,
  getUpgradePrompt,
  getLimitValue,
  checkQuota,
  formatFeatureName,
} from './TierGateService'

export type { GatedFeature, GatedLimit } from './TierGateService'
