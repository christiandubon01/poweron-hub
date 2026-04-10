/**
 * Stripe Services Index
 *
 * Exports all stripe/subscription-related services and utilities.
 */

// Re-export from stripe.ts (existing service)
export {
  getOrgSubscription,
  checkFeatureAccess,
  checkQuotaUsage,
  getOrCreateBillingCustomer,
  type SubscriptionStatus,
  type OrgSubscription,
} from '../stripe'

// Export TierGateService
export {
  checkFeatureAccess as checkFeatureAccessGate,
  checkLimitAccess,
  getCurrentTier,
  getUpgradePrompt,
  getLimitInfo,
  getAvailableFeaturesForTier,
  type GatedFeature,
  type GatedLimit,
} from './TierGateService'

export { default as TierGateService } from './TierGateService'
