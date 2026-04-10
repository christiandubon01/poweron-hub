/**
 * Tier Gate Wrapper
 *
 * React component that wraps any feature panel and gates access based on subscription tier.
 *
 * If user has access:
 *   - Renders children normally
 *
 * If user lacks access:
 *   - Renders upgrade prompt card overlaid
 *   - Shows glassmorphic blur overlay on the blocked content (teaser)
 *   - "Upgrade Now" button links to Stripe checkout
 */

import React, { useMemo } from 'react'
import { useSubscription } from '@/hooks/useSubscription'
import { checkFeatureAccess, getUpgradePrompt, type GatedFeature } from '@/services/stripe/TierGateService'
import UpgradePromptCard from './UpgradePromptCard'

export interface TierGateWrapperProps {
  /** The subscription tier required to use this feature */
  requiredTier?: 'solo' | 'team' | 'enterprise'

  /** The feature name to gate (used to check access) */
  requiredFeature: GatedFeature

  /** Feature display name (shown in upgrade prompt if different from feature key) */
  featureName?: string

  /** Brief description of the feature for the upgrade prompt */
  featureDescription?: string

  /** The content to gate (shown if user has access) */
  children: React.ReactNode

  /** Callback when user clicks upgrade button */
  onUpgradeClick?: () => void

  /** Optional CSS class for wrapper */
  className?: string

  /** Show teaser blur effect on blocked content */
  showTeaser?: boolean
}

/**
 * TierGateWrapper Component
 *
 * Usage:
 * ```tsx
 * <TierGateWrapper
 *   requiredFeature="guardian"
 *   featureName="GUARDIAN"
 *   featureDescription="AI-powered project health monitoring"
 * >
 *   <GuardianView />
 * </TierGateWrapper>
 * ```
 */
export function TierGateWrapper({
  requiredFeature,
  featureName,
  featureDescription,
  children,
  onUpgradeClick,
  className = '',
  showTeaser = true,
}: TierGateWrapperProps) {
  const { subscription, loading, tierName } = useSubscription()

  // Check if user has access to this feature
  const hasAccess = useMemo(() => {
    if (loading || !subscription) return false
    return checkFeatureAccess(requiredFeature, subscription.tier)
  }, [requiredFeature, subscription, loading])

  // Get upgrade information if user lacks access
  const upgradePrompt = useMemo(() => {
    if (hasAccess || !subscription) return null
    return getUpgradePrompt(requiredFeature, subscription.tier)
  }, [hasAccess, requiredFeature, subscription])

  // While loading, show a placeholder
  if (loading) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-slate-700/50 bg-slate-900/30 p-8 ${className}`}>
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400">Loading subscription...</p>
        </div>
      </div>
    )
  }

  // User has access — render children normally
  if (hasAccess) {
    return <div className={className}>{children}</div>
  }

  // User lacks access — render upgrade prompt with teaser
  if (upgradePrompt) {
    return (
      <div className={`relative ${className}`}>
        {/* Blurred background content (teaser) */}
        {showTeaser && (
          <div className="absolute inset-0 rounded-lg pointer-events-none overflow-hidden">
            <div className="blur-sm opacity-30">{children}</div>
            {/* Glassmorphic overlay */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900/60 via-slate-900/40 to-slate-900/60 backdrop-blur-sm" />
          </div>
        )}

        {/* Upgrade prompt card */}
        <div className="relative z-10">
          <UpgradePromptCard
            featureName={featureName || upgradePrompt.featureName}
            description={featureDescription}
            currentTierName={tierName}
            requiredTier={upgradePrompt.requiredTier}
            priceDifference={upgradePrompt.priceDifference}
            onUpgradeClick={onUpgradeClick}
            showBackgroundTease={showTeaser}
          />
        </div>

        {/* Ensure sufficient height for display */}
        {showTeaser && <div className="invisible pointer-events-none">{children}</div>}
      </div>
    )
  }

  // Fallback (shouldn't reach here)
  return <div className={className}>{children}</div>
}

export default TierGateWrapper
